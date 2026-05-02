const express = require('express');
const fs      = require('fs');
const path    = require('path');
const crypto  = require('crypto');

const app  = express();
const PORT = process.env.PORT || 3000;

// ── CONFIG ──
const PAKASIR_SLUG   = process.env.PAKASIR_SLUG   || 'bayyzofc';
const PAKASIR_APIKEY = process.env.PAKASIR_APIKEY  || 'pRPQmKpKKvYo4lH4WwGfbQfo1TaLtkSg';
const HARGA_AKUN     = 500; // TESTING // Rp 2.000

// ── DATA FILES ──
const DATA_DIR      = path.join(__dirname, 'data');
const USERS_FILE    = path.join(DATA_DIR, 'users.json');
const ACCOUNTS_FILE = path.join(DATA_DIR, 'accounts.json');
const ORDERS_FILE   = path.join(DATA_DIR, 'orders.json');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

function readJSON(f) {
  try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return []; }
}
function writeJSON(f, d) {
  fs.writeFileSync(f, JSON.stringify(d, null, 2), 'utf8');
}

app.use(express.json());
app.use(express.static(__dirname));

// ══════════════════════════════════════
//  AUTH
// ══════════════════════════════════════

app.post('/api/register', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password)
    return res.status(400).json({ error: 'Username dan password wajib diisi' });
  if (username.length < 3)
    return res.status(400).json({ error: 'Username minimal 3 karakter' });
  if (password.length < 6)
    return res.status(400).json({ error: 'Password minimal 6 karakter' });

  const users = readJSON(USERS_FILE);
  if (users.find(u => u.username.toLowerCase() === username.toLowerCase()))
    return res.status(400).json({ error: 'Username sudah dipakai' });

  const user = {
    id:        'u-' + Date.now(),
    username:  username.trim(),
    password,
    role:      'user',
    isActive:  true,
    createdAt: Date.now(),
  };
  users.push(user);
  writeJSON(USERS_FILE, users);

  res.json({ ok: true, user: { id: user.id, username: user.username, role: user.role } });
});

app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password)
    return res.status(400).json({ error: 'Username dan password wajib diisi' });

  const users = readJSON(USERS_FILE);
  const user  = users.find(u =>
    u.username.toLowerCase() === username.trim().toLowerCase() && u.password === password
  );

  if (!user) return res.status(401).json({ error: 'Username atau password salah' });
  if (!user.isActive) return res.status(403).json({ error: 'Akun kamu dinonaktifkan. Hubungi Admin.' });

  res.json({ ok: true, user: { id: user.id, username: user.username, role: user.role } });
});

// ══════════════════════════════════════
//  PAKASIR — CREATE ORDER (QRIS)
// ══════════════════════════════════════

app.post('/api/order/create', async (req, res) => {
  const { userId, username } = req.body;
  if (!userId) return res.status(400).json({ error: 'userId wajib' });

  // Cek stok
  const accounts = readJSON(ACCOUNTS_FILE);
  const stok = accounts.filter(a => !a.claimed);
  if (stok.length === 0)
    return res.status(400).json({ error: 'Stok akun AM sedang habis. Coba lagi nanti!' });

  const orderId = 'ORD-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6).toUpperCase();

  try {
    // Format Pakasir: POST /api/transactioncreate/qris
    const response = await fetch(`https://app.pakasir.com/api/transactioncreate/qris`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        project:  PAKASIR_SLUG,
        order_id: orderId,
        amount:   HARGA_AKUN,
        api_key:  PAKASIR_APIKEY,
      }),
    });

    const data = await response.json();
    console.log('Pakasir response:', JSON.stringify(data));

    // Response: { payment: { payment_number, payment_url, expired_at, ... } }
    if (!data || !data.payment) {
      console.error('Pakasir error:', data);
      return res.status(500).json({ error: 'Gagal membuat transaksi. Coba lagi.' });
    }

    const qrisString   = data.payment.payment_number || null;
    const fee          = data.payment.fee          || 0;
    const totalPayment = data.payment.total_payment || HARGA_AKUN;
    const expiredAt    = data.payment.expired_at
      ? new Date(data.payment.expired_at).getTime()
      : Date.now() + 15 * 60 * 1000;

    // Simpan order ke file
    const orders = readJSON(ORDERS_FILE);
    orders.push({
      orderId,
      userId,
      username,
      amount:       HARGA_AKUN,
      fee,
      totalPayment,
      status:       'pending',
      qrisString,
      createdAt:    Date.now(),
      expiredAt,
    });
    writeJSON(ORDERS_FILE, orders);

    res.json({
      ok:           true,
      orderId,
      qrisString,
      amount:       HARGA_AKUN,
      fee,
      totalPayment,
      expiredAt,
    });

  } catch (err) {
    console.error('Create order error:', err);
    res.status(500).json({ error: 'Server error. Coba lagi.' });
  }
});

// ══════════════════════════════════════
//  PAKASIR — CEK STATUS PEMBAYARAN
// ══════════════════════════════════════

app.post('/api/order/check', async (req, res) => {
  const { orderId, userId } = req.body;
  if (!orderId) return res.status(400).json({ error: 'orderId wajib' });

  const orders = readJSON(ORDERS_FILE);
  const order  = orders.find(o => o.orderId === orderId);

  if (!order) return res.status(404).json({ error: 'Order tidak ditemukan' });
  if (order.userId !== userId) return res.status(403).json({ error: 'Forbidden' });

  // Sudah success sebelumnya
  if (order.status === 'success') {
    return res.json({ ok: true, status: 'success', akun: order.akun || null });
  }

  // Expired
  if (Date.now() > order.expiredAt) {
    const idx = orders.findIndex(o => o.orderId === orderId);
    orders[idx].status = 'expired';
    writeJSON(ORDERS_FILE, orders);
    return res.json({ ok: true, status: 'expired' });
  }

  try {
    // Cek ke Pakasir: GET /api/transactiondetail
    const params = new URLSearchParams({
      project:  PAKASIR_SLUG,
      order_id: orderId,
      amount:   order.amount,
      api_key:  PAKASIR_APIKEY,
    });
    const response = await fetch(`https://app.pakasir.com/api/transactiondetail?${params}`);
    const data = await response.json();
    console.log('Pakasir check:', JSON.stringify(data));

    const paid = data?.transaction?.status === 'completed';

    if (paid) {
      // Ambil akun dari stok
      const accounts  = readJSON(ACCOUNTS_FILE);
      const akunIdx   = accounts.findIndex(a => !a.claimed);

      if (akunIdx === -1) {
        return res.json({ ok: true, status: 'success', akun: null, error: 'Stok habis! Hubungi admin.' });
      }

      accounts[akunIdx].claimed   = true;
      accounts[akunIdx].claimedBy = userId;
      accounts[akunIdx].claimedAt = Date.now();
      writeJSON(ACCOUNTS_FILE, accounts);

      const akun = { email: accounts[akunIdx].email, emailAccess: accounts[akunIdx].emailAccess };

      // Update order
      const idx = orders.findIndex(o => o.orderId === orderId);
      orders[idx].status  = 'success';
      orders[idx].akun    = akun;
      orders[idx].paidAt  = Date.now();
      writeJSON(ORDERS_FILE, orders);

      return res.json({ ok: true, status: 'success', akun });
    }

    res.json({ ok: true, status: 'pending' });

  } catch (err) {
    console.error('Check order error:', err);
    res.status(500).json({ error: 'Gagal cek status. Coba lagi.' });
  }
});

// ══════════════════════════════════════
//  RIWAYAT ORDER USER
// ══════════════════════════════════════

app.get('/api/order/history/:userId', (req, res) => {
  const orders = readJSON(ORDERS_FILE)
    .filter(o => o.userId === req.params.userId && o.status === 'success')
    .map(o => ({ orderId: o.orderId, akun: o.akun, paidAt: o.paidAt, amount: o.amount }))
    .sort((a, b) => b.paidAt - a.paidAt);
  res.json({ ok: true, orders });
});

// ══════════════════════════════════════
//  ADMIN ENDPOINTS
// ══════════════════════════════════════

// GET semua akun
app.get('/api/accounts', (req, res) => {
  res.json(readJSON(ACCOUNTS_FILE));
});

// POST tambah akun
app.post('/api/accounts', (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: 'Email wajib diisi' });

  const accounts    = readJSON(ACCOUNTS_FILE);
  const emailAccess = req.body.emailAccess || ('https://generator.email/' + email.trim());

  if (accounts.find(a => a.email === email.trim()))
    return res.status(400).json({ error: 'Email sudah ada di daftar' });

  const akun = {
    id:         'a-' + Date.now(),
    email:      email.trim(),
    emailAccess,
    claimed:    false,
    claimedBy:  null,
    claimedAt:  null,
    addedAt:    Date.now(),
  };
  accounts.push(akun);
  writeJSON(ACCOUNTS_FILE, accounts);
  res.json({ ok: true, akun });
});

// DELETE akun
app.delete('/api/accounts/:id', (req, res) => {
  const accounts = readJSON(ACCOUNTS_FILE).filter(a => a.id !== req.params.id);
  writeJSON(ACCOUNTS_FILE, accounts);
  res.json({ ok: true });
});

// GET semua users (admin)
app.get('/api/users', (req, res) => {
  const users = readJSON(USERS_FILE).map(u => ({
    id:        u.id,
    username:  u.username,
    role:      u.role,
    isActive:  u.isActive,
    createdAt: u.createdAt,
  }));
  res.json(users);
});

// Toggle aktif user
app.put('/api/users/:id/active', (req, res) => {
  const { isActive } = req.body;
  const users = readJSON(USERS_FILE);
  const idx   = users.findIndex(u => u.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'User tidak ditemukan' });
  users[idx].isActive = !!isActive;
  writeJSON(USERS_FILE, users);
  res.json({ ok: true });
});

// GET stats admin
app.get('/api/stats', (req, res) => {
  const accounts = readJSON(ACCOUNTS_FILE);
  const orders   = readJSON(ORDERS_FILE);
  const users    = readJSON(USERS_FILE);
  res.json({
    totalAkun:   accounts.length,
    stokTersedia: accounts.filter(a => !a.claimed).length,
    totalTerjual: accounts.filter(a => a.claimed).length,
    totalOrder:  orders.filter(o => o.status === 'success').length,
    totalUser:   users.filter(u => u.role !== 'admin').length,
    totalRevenue: orders.filter(o => o.status === 'success').length * HARGA_AKUN,
  });
});

// GET semua orders (admin)
app.get('/api/orders', (req, res) => {
  const orders = readJSON(ORDERS_FILE)
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, 100);
  res.json({ ok: true, orders });
});

app.listen(PORT, () => console.log(`Bayz Store running on port ${PORT}`));
