// ── BAYZ STORE — app.js ──

// ── STATE ──
let currentUser   = null;
let currentOrder  = null;
let timerInterval = null;
let _importEmails = [];

// ── INIT ──
(async () => {
  const saved = localStorage.getItem('bayz_user');
  if (saved) {
    try { currentUser = JSON.parse(saved); } catch { currentUser = null; }
  }
  renderTopbar();
  await loadStats();
  if (currentUser) {
    document.getElementById('nav-bottom').style.display = 'flex';
    if (currentUser.role === 'admin') {
      document.getElementById('nav-admin').style.display = 'flex';
    }
  }
})();

// ── TOPBAR ──
function renderTopbar() {
  const el = document.getElementById('topbar-right');
  if (currentUser) {
    el.innerHTML = `
      <span class="topbar-user">${escHtml(currentUser.username)}</span>
      ${currentUser.role === 'admin' ? '<span class="badge-admin">ADMIN</span>' : ''}
      <button class="btn-logout" onclick="doLogout()">Keluar</button>
    `;
    document.getElementById('nav-bottom').style.display = 'flex';
    if (currentUser.role === 'admin') {
      document.getElementById('nav-admin').style.display = 'flex';
    }
  } else {
    el.innerHTML = `<button class="btn-login-top" onclick="openAuth('login')">Login</button>`;
    document.getElementById('nav-bottom').style.display = 'none';
  }
}

// ── STATS ──
async function loadStats() {
  try {
    const res  = await fetch('/api/stats');
    const data = await res.json();
    document.getElementById('stat-stok').textContent   = data.stokTersedia ?? '-';
    document.getElementById('stat-terjual').textContent = data.totalTerjual ?? '-';
  } catch (_) {}
}

// ── AUTH ──
function openAuth(mode) {
  document.getElementById('auth-modal').style.display = 'flex';
  switchAuth(mode);
}
function closeAuth() {
  document.getElementById('auth-modal').style.display = 'none';
}
function switchAuth(mode) {
  document.getElementById('auth-login').style.display    = mode === 'login' ? 'block' : 'none';
  document.getElementById('auth-register').style.display = mode === 'register' ? 'block' : 'none';
  document.getElementById('login-err').textContent = '';
  document.getElementById('reg-err').textContent   = '';
}

async function submitLogin() {
  const username = document.getElementById('login-user').value.trim();
  const password = document.getElementById('login-pass').value;
  const btn      = document.getElementById('btn-login');
  const errEl    = document.getElementById('login-err');
  errEl.textContent = '';

  if (!username || !password) { errEl.textContent = '⚠ Isi username dan password dulu'; return; }
  btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Masuk...';

  try {
    const res  = await fetch('/api/login', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ username, password }) });
    const data = await res.json();
    if (!data.ok) { errEl.textContent = '⚠ ' + data.error; return; }
    currentUser = data.user;
    localStorage.setItem('bayz_user', JSON.stringify(currentUser));
    closeAuth();
    renderTopbar();
    await loadStats();
    showToast(`Halo, ${currentUser.username}! 👋`);
    if (currentUser.role === 'admin') await loadAdminData();
  } catch (_) { errEl.textContent = '⚠ Gagal koneksi ke server'; }
  finally { btn.disabled = false; btn.innerHTML = 'Masuk'; }
}

async function submitRegister() {
  const username = document.getElementById('reg-user').value.trim();
  const password = document.getElementById('reg-pass').value;
  const btn      = document.getElementById('btn-reg');
  const errEl    = document.getElementById('reg-err');
  errEl.textContent = '';

  if (!username || !password) { errEl.textContent = '⚠ Isi semua field'; return; }
  btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Daftar...';

  try {
    const res  = await fetch('/api/register', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ username, password }) });
    const data = await res.json();
    if (!data.ok) { errEl.textContent = '⚠ ' + data.error; return; }
    currentUser = data.user;
    localStorage.setItem('bayz_user', JSON.stringify(currentUser));
    closeAuth();
    renderTopbar();
    showToast(`Selamat datang, ${currentUser.username}! 🎉`);
  } catch (_) { errEl.textContent = '⚠ Gagal koneksi ke server'; }
  finally { btn.disabled = false; btn.innerHTML = 'Daftar Sekarang'; }
}

function doLogout() {
  currentUser = null;
  currentOrder = null;
  localStorage.removeItem('bayz_user');
  renderTopbar();
  document.getElementById('result-wrap').style.display = 'none';
  document.getElementById('result-wrap').innerHTML = '';
  goPage('home');
  showToast('Berhasil logout 👋');
}

// ── NAVIGATION ──
function goPage(page) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  document.getElementById('page-' + page).classList.add('active');
  const navEl = document.getElementById('nav-' + page);
  if (navEl) navEl.classList.add('active');

  if (page === 'riwayat') loadRiwayat();
  if (page === 'admin')   loadAdminData();
}

// ── BELI AKUN ──
async function beliAkun() {
  if (!currentUser) { openAuth('login'); return; }

  const btn = document.getElementById('btn-buy');
  btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Membuat order...';

  try {
    const res  = await fetch('/api/order/create', {
      method: 'POST', headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ userId: currentUser.id, username: currentUser.username })
    });
    const data = await res.json();

    if (!data.ok) { showToast('❌ ' + data.error, 'error'); return; }

    currentOrder = { orderId: data.orderId, expiredAt: data.expiredAt };
    openPayment(data);

  } catch (_) { showToast('❌ Gagal buat order', 'error'); }
  finally { btn.disabled = false; btn.innerHTML = '⚡ Beli Sekarang'; }
}

// ── PAYMENT MODAL ──
function openPayment(data) {
  document.getElementById('qris-amount').textContent = 'Rp ' + data.amount.toLocaleString('id-ID');

  // QRIS image
  const qrisImg = document.getElementById('qris-img');
  if (data.qrisUrl) {
    qrisImg.src = data.qrisUrl;
  } else if (data.qrisString) {
    // Generate QR dari string pakai API publik
    qrisImg.src = `https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(data.qrisString)}`;
  } else {
    qrisImg.src = `https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=NOQRIS`;
  }

  document.getElementById('payment-modal').style.display = 'flex';
  startTimer(data.expiredAt);
}

function closePayment() {
  document.getElementById('payment-modal').style.display = 'none';
  if (timerInterval) { clearInterval(timerInterval); timerInterval = null; }
}

function startTimer(expiredAt) {
  if (timerInterval) clearInterval(timerInterval);
  const el = document.getElementById('qris-timer');
  function tick() {
    const sisa = expiredAt - Date.now();
    if (sisa <= 0) {
      el.textContent = '00:00';
      clearInterval(timerInterval);
      closePayment();
      showToast('⏰ Order expired, silakan buat order baru', 'error');
      return;
    }
    const m = Math.floor(sisa / 60000);
    const s = Math.floor((sisa % 60000) / 1000);
    el.textContent = `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
  }
  tick();
  timerInterval = setInterval(tick, 1000);
}

async function cekPembayaran() {
  if (!currentOrder) return;
  const btn   = document.getElementById('btn-cek');
  const errEl = document.getElementById('pay-err');
  errEl.textContent = '';
  btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Mengecek...';

  try {
    const res  = await fetch('/api/order/check', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ orderId: currentOrder.orderId, userId: currentUser.id })
    });
    const data = await res.json();

    if (data.status === 'success') {
      closePayment();
      showResult(data.akun);
      showToast('✅ Pembayaran berhasil!');
      await loadStats();
    } else if (data.status === 'expired') {
      closePayment();
      showToast('⏰ Order sudah expired', 'error');
    } else {
      errEl.textContent = '⏳ Pembayaran belum terkonfirmasi. Coba lagi sebentar.';
    }
  } catch (_) { errEl.textContent = '⚠ Gagal cek status. Coba lagi.'; }
  finally { btn.disabled = false; btn.innerHTML = '🔍 Cek Status Pembayaran'; }
}

// ── RESULT ──
function showResult(akun) {
  const wrap = document.getElementById('result-wrap');
  if (!akun) {
    wrap.innerHTML = `
      <div class="result-card">
        <div class="result-icon">✅</div>
        <div class="result-title">Pembayaran Berhasil!</div>
        <p style="font-size:13px;color:var(--muted);">Maaf, stok akun habis saat ini. Hubungi admin untuk mendapatkan akun kamu.</p>
      </div>`;
    wrap.style.display = 'block';
    return;
  }

  const accessUrl = akun.emailAccess || ('https://generator.email/' + akun.email);
  wrap.innerHTML = `
    <div class="result-card">
      <div class="result-icon">🎉</div>
      <div class="result-title">Akun AM Kamu!</div>
      <div class="result-email">
        <div class="result-email-label">Email Akun</div>
        <div class="result-email-val" id="res-email">${escHtml(akun.email)}</div>
      </div>
      <button class="btn-copy" onclick="copyEmail('${escHtml(akun.email)}')">📋 Copy Email</button>
      <a class="btn-inbox" href="${escHtml(accessUrl)}" target="_blank" rel="noopener">📬 Buka Inbox Email</a>
      <p style="font-size:11px;color:var(--muted);margin-top:12px;">Simpan email ini baik-baik ya!</p>
    </div>`;
  wrap.style.display = 'block';
  wrap.scrollIntoView({ behavior:'smooth', block:'start' });
}

function copyEmail(email) {
  navigator.clipboard.writeText(email).then(() => showToast('📋 Email berhasil dicopy!')).catch(() => showToast('Gagal copy'));
}

// ── RIWAYAT ──
async function loadRiwayat() {
  const el = document.getElementById('riwayat-list');
  if (!currentUser) { el.innerHTML = '<div class="empty"><div class="empty-icon">🔒</div>Login dulu untuk lihat riwayat</div>'; return; }
  el.innerHTML = '<div class="empty">Memuat...</div>';
  try {
    const res  = await fetch(`/api/order/history/${currentUser.id}`);
    const data = await res.json();
    if (!data.orders || data.orders.length === 0) {
      el.innerHTML = '<div class="empty"><div class="empty-icon">📭</div>Belum ada pembelian</div>';
      return;
    }
    el.innerHTML = data.orders.map(o => `
      <div class="riwayat-item">
        <div class="riwayat-email">${o.akun ? escHtml(o.akun.email) : 'Akun tidak tersedia'}</div>
        <div class="riwayat-meta">
          Rp ${(o.amount||2000).toLocaleString('id-ID')} · ${timeAgo(o.paidAt)}
          ${o.akun?.emailAccess ? `· <a href="${escHtml(o.akun.emailAccess)}" target="_blank" style="color:var(--green);font-weight:600;">Inbox</a>` : ''}
        </div>
      </div>`).join('');
  } catch (_) { el.innerHTML = '<div class="empty">Gagal memuat riwayat</div>'; }
}

// ── ADMIN ──
function switchAdminTab(tab, el) {
  document.querySelectorAll('.admin-tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.admin-section').forEach(s => s.classList.remove('active'));
  el.classList.add('active');
  document.getElementById('admin-' + tab).classList.add('active');
  if (tab === 'akun')   loadAdminAkun();
  if (tab === 'orders') loadAdminOrders();
  if (tab === 'users')  loadAdminUsers();
}

async function loadAdminData() {
  if (!currentUser || currentUser.role !== 'admin') return;
  loadAdminAkun();
}

async function loadAdminAkun() {
  const el = document.getElementById('admin-akun-list');
  try {
    const res      = await fetch('/api/accounts');
    const accounts = await res.json();
    if (!accounts.length) { el.innerHTML = '<div class="empty"><div class="empty-icon">📭</div>Belum ada akun</div>'; return; }
    el.innerHTML = accounts.map(a => `
      <div class="akun-item">
        <div>
          <div class="akun-email">${escHtml(a.email)}</div>
          <span class="akun-status ${a.claimed ? 'claimed' : 'free'}">${a.claimed ? 'Terjual' : 'Tersedia'}</span>
        </div>
        ${!a.claimed ? `<button class="btn-del" onclick="hapusAkun('${a.id}')">Hapus</button>` : ''}
      </div>`).join('');
  } catch (_) { el.innerHTML = '<div class="empty">Gagal memuat</div>'; }
}

async function tambahAkun() {
  const email = document.getElementById('tambah-email').value.trim();
  if (!email) { showToast('❌ Isi email dulu', 'error'); return; }
  const res  = await fetch('/api/accounts', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ email }) });
  const data = await res.json();
  if (data.ok) {
    document.getElementById('tambah-email').value = '';
    showToast('✅ Akun ditambahkan!');
    loadAdminAkun();
  } else { showToast('❌ ' + data.error, 'error'); }
}

async function hapusAkun(id) {
  if (!confirm('Hapus akun ini?')) return;
  await fetch(`/api/accounts/${id}`, { method:'DELETE' });
  showToast('🗑 Akun dihapus');
  loadAdminAkun();
}

function previewImport(event) {
  const file = event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (e) => {
    const lines = e.target.result.split('\n').map(l => l.trim()).filter(l => l.includes('@') && l.includes('.'));
    _importEmails = lines.slice(0, 70);
    const prevEl = document.getElementById('import-preview');
    const btn    = document.getElementById('btn-import');
    if (_importEmails.length === 0) {
      prevEl.innerHTML = '<p style="color:var(--red);font-size:12px;">Tidak ada email valid</p>';
      btn.style.display = 'none'; return;
    }
    prevEl.innerHTML = `<p style="color:var(--green);font-size:12px;margin-bottom:8px;">✅ ${_importEmails.length} email siap diimport${lines.length > 70 ? ' (maks 70)' : ''}</p>`;
    btn.style.display = 'block';
  };
  reader.readAsText(file);
}

async function doImport() {
  if (!_importEmails.length) return;
  const btn = document.getElementById('btn-import');
  btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Mengimport...';
  let added = 0, skip = 0;
  for (const email of _importEmails) {
    const res  = await fetch('/api/accounts', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ email }) });
    const data = await res.json();
    data.ok ? added++ : skip++;
  }
  btn.disabled = false; btn.innerHTML = '⚡ Import Sekarang'; btn.style.display = 'none';
  document.getElementById('import-preview').innerHTML = '';
  document.getElementById('import-txt').value = '';
  _importEmails = [];
  showToast(`✅ +${added} akun diimport${skip ? `, ${skip} duplikat dilewati` : ''}`);
  loadAdminAkun();
}

async function loadAdminOrders() {
  const el = document.getElementById('admin-orders-list');
  try {
    const res  = await fetch('/api/orders');
    const data = await res.json();
    if (!data.orders?.length) { el.innerHTML = '<div class="empty"><div class="empty-icon">📭</div>Belum ada order</div>'; return; }
    el.innerHTML = data.orders.map(o => `
      <div class="akun-item">
        <div>
          <div style="font-size:13px;font-weight:600;">${escHtml(o.username || '-')}</div>
          <div style="font-size:11px;color:var(--muted);">${o.orderId} · ${timeAgo(o.createdAt)}</div>
          ${o.akun ? `<div style="font-size:11px;color:var(--green);">${escHtml(o.akun.email)}</div>` : ''}
        </div>
        <span style="font-size:11px;font-weight:700;color:${o.status==='success'?'var(--green)':o.status==='pending'?'var(--yellow)':'var(--muted)'};">
          ${o.status.toUpperCase()}
        </span>
      </div>`).join('');
  } catch (_) { el.innerHTML = '<div class="empty">Gagal memuat</div>'; }
}

async function loadAdminUsers() {
  const el = document.getElementById('admin-users-list');
  try {
    const res   = await fetch('/api/users');
    const users = await res.json();
    if (!users.length) { el.innerHTML = '<div class="empty"><div class="empty-icon">👤</div>Belum ada user</div>'; return; }
    el.innerHTML = users.map(u => `
      <div class="user-item-row">
        <div>
          <div style="font-size:13px;font-weight:600;">${escHtml(u.username)}</div>
          <div style="font-size:11px;color:var(--muted);">${u.role} · ${timeAgo(u.createdAt)}</div>
        </div>
        <span style="font-size:11px;font-weight:700;color:${u.isActive?'var(--green)':'var(--red)'};">
          ${u.isActive ? 'Aktif' : 'Nonaktif'}
        </span>
      </div>`).join('');
  } catch (_) { el.innerHTML = '<div class="empty">Gagal memuat</div>'; }
}

// ── HELPERS ──
function escHtml(str) {
  return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function timeAgo(ts) {
  if (!ts) return '-';
  const diff = Date.now() - ts;
  if (diff < 60000)  return 'Baru saja';
  if (diff < 3600000) return Math.floor(diff/60000) + ' menit lalu';
  if (diff < 86400000) return Math.floor(diff/3600000) + ' jam lalu';
  return Math.floor(diff/86400000) + ' hari lalu';
}

let _toastTimer = null;
function showToast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg; el.classList.add('show');
  if (_toastTimer) clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => el.classList.remove('show'), 3000);
}

// Enter key support
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter') return;
  if (document.getElementById('auth-login').style.display !== 'none' &&
      document.getElementById('auth-modal').style.display !== 'none') submitLogin();
  if (document.getElementById('auth-register').style.display !== 'none' &&
      document.getElementById('auth-modal').style.display !== 'none') submitRegister();
});
