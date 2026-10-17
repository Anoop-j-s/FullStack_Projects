// ---------- Shared helpers ----------
const app = document.getElementById('app');
const state = {
  token: localStorage.getItem('token'),
  user: JSON.parse(localStorage.getItem('user') || 'null')
};

async function api(url, method = 'GET', body) {
  const headers = { 'Content-Type': 'application/json' };
  if (state.token) headers.Authorization = 'Bearer ' + state.token;
  const res = await fetch(url, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && state.token) { logout(); throw new Error('Please login again'); }
  if (!res.ok) throw new Error(data.error || 'Something went wrong');
  return data;
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function v(id) { return document.getElementById(id).value.trim(); }
function toast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => t.classList.remove('show'), 2500);
}
function timeAgo(d) {
  const s = Math.floor((Date.now() - new Date(d.replace(' ', 'T') + 'Z')) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return Math.floor(s / 60) + 'm ago';
  if (s < 86400) return Math.floor(s / 3600) + 'h ago';
  return Math.floor(s / 86400) + 'd ago';
}

function saveAuth(r) {
  state.token = r.token;
  state.user = r.user;
  localStorage.setItem('token', r.token);
  localStorage.setItem('user', JSON.stringify(r.user));
}
function logout() {
  localStorage.removeItem('token');
  localStorage.removeItem('user');
  state.token = null;
  state.user = null;
  if (typeof onLogout === 'function') onLogout();
  renderNav();
  location.hash = '#/login';
}

function authPage(mode, fields) {
  const labels = { name: 'Name', username: 'Username', email: 'Email', password: 'Password' };
  const login = mode === 'login';
  app.innerHTML = `<div class="box">
    <h2>${login ? 'Login' : 'Create account'}</h2>
    ${fields.map(f => `<label>${labels[f]}</label><input id="${f}" type="${f === 'password' ? 'password' : f === 'email' ? 'email' : 'text'}">`).join('')}
    <p id="msg" class="error"></p>
    <button class="btn" onclick="submitAuth('${mode}')">${login ? 'Login' : 'Register'}</button>
    <p class="muted">${login ? 'New here? <a href="#/register">Create an account</a>' : 'Already registered? <a href="#/login">Login</a>'}</p>
  </div>`;
}

async function submitAuth(mode) {
  const body = {};
  ['name', 'username', 'email', 'password'].forEach(k => {
    const el = document.getElementById(k);
    if (el) body[k] = k === 'password' ? el.value : el.value.trim();
  });
  try {
    const r = await api('/api/' + mode, 'POST', body);
    saveAuth(r);
    if (typeof onLogin === 'function') onLogin();
    renderNav();
    if (location.hash === '#/' || location.hash === '') router();
    else location.hash = '#/';
  } catch (e) {
    document.getElementById('msg').textContent = e.message;
  }
}
// ---------- End shared helpers ----------

// ---------- E-commerce app ----------
state.cart = JSON.parse(localStorage.getItem('cart') || '[]');
let allProducts = [];

function money(n) { return '₹' + Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
function saveCart() { localStorage.setItem('cart', JSON.stringify(state.cart)); renderNav(); }

function renderNav() {
  const count = state.cart.reduce((s, i) => s + i.qty, 0);
  document.getElementById('nav').innerHTML =
    `<a href="#/">Shop</a><a href="#/cart">Cart (${count})</a>` +
    (state.user
      ? `<a href="#/orders">My orders</a><span class="hello">Hi, ${esc(state.user.name)}</span><a href="#" onclick="logout();return false">Logout</a>`
      : `<a href="#/login">Login</a><a href="#/register">Register</a>`);
}

// ----- Product list -----
function card(p) {
  return `<div class="card product">
    <a href="#/product/${p.id}" class="emoji">${p.emoji}</a>
    <span class="tag">${esc(p.category)}</span>
    <h3><a href="#/product/${p.id}">${esc(p.name)}</a></h3>
    <span class="price">${money(p.price)}</span>
    <button class="btn small" onclick="addToCart(${p.id})">Add to cart</button>
  </div>`;
}

async function home() {
  allProducts = await api('/api/products');
  const cats = [...new Set(allProducts.map(p => p.category))];
  app.innerHTML = `<div class="filters">
      <input id="search" placeholder="Search products" oninput="filterProducts()">
      <select id="cat" onchange="filterProducts()">
        <option value="">All categories</option>${cats.map(c => `<option>${esc(c)}</option>`).join('')}
      </select>
    </div><div id="grid" class="grid"></div>`;
  filterProducts();
}

function filterProducts() {
  const q = document.getElementById('search').value.toLowerCase();
  const c = document.getElementById('cat').value;
  const list = allProducts.filter(p => (!c || p.category === c) && p.name.toLowerCase().includes(q));
  document.getElementById('grid').innerHTML = list.length ? list.map(card).join('') : '<p class="muted">No products match your search.</p>';
}

// ----- Product details page -----
async function productPage(id) {
  const p = await api('/api/products/' + id);
  app.innerHTML = `<p><a href="#/">← Back to shop</a></p>
    <div class="detail">
      <div class="emoji">${p.emoji}</div>
      <div class="info">
        <span class="tag">${esc(p.category)}</span>
        <h2>${esc(p.name)}</h2>
        <p>${esc(p.description)}</p>
        <p class="price">${money(p.price)}</p>
        <p class="muted">${p.stock > 0 ? p.stock + ' in stock' : 'Out of stock'}</p>
        <button class="btn" ${p.stock < 1 ? 'disabled' : ''} onclick="addToCart(${p.id})">Add to cart</button>
      </div>
    </div>`;
}

// ----- Cart -----
async function addToCart(id) {
  try {
    const p = await api('/api/products/' + id);
    const found = state.cart.find(i => i.id === id);
    if (found) found.qty++;
    else state.cart.push({ id: p.id, name: p.name, price: p.price, emoji: p.emoji, qty: 1 });
    saveCart();
    toast(p.name + ' added to cart');
  } catch (e) { toast(e.message); }
}
function changeQty(id, d) {
  const i = state.cart.find(x => x.id === id);
  i.qty += d;
  if (i.qty < 1) state.cart = state.cart.filter(x => x.id !== id);
  saveCart(); cartPage();
}
function removeItem(id) { state.cart = state.cart.filter(x => x.id !== id); saveCart(); cartPage(); }

function cartPage() {
  if (!state.cart.length) {
    app.innerHTML = '<h2>Your cart</h2><p>Your cart is empty. <a href="#/">Browse products</a></p>';
    return;
  }
  const total = state.cart.reduce((s, i) => s + i.price * i.qty, 0);
  app.innerHTML = `<h2>Your cart</h2>
    ${state.cart.map(i => `<div class="row">
      <span class="emoji">${i.emoji}</span>
      <div class="grow"><b>${esc(i.name)}</b><div class="muted">${money(i.price)} each</div></div>
      <div class="qty"><button onclick="changeQty(${i.id},-1)">−</button><span>${i.qty}</span><button onclick="changeQty(${i.id},1)">+</button></div>
      <b>${money(i.price * i.qty)}</b>
      <button class="link" onclick="removeItem(${i.id})">Remove</button>
    </div>`).join('')}
    <div class="total">Total: ${money(total)}</div>
    <div style="text-align:right"><a class="btn" href="#/checkout">Checkout</a></div>`;
}

// ----- Checkout and order processing -----
function checkoutPage() {
  if (!state.user) { toast('Please login to checkout'); location.hash = '#/login'; return; }
  if (!state.cart.length) { location.hash = '#/cart'; return; }
  const total = state.cart.reduce((s, i) => s + i.price * i.qty, 0);
  app.innerHTML = `<div class="box" style="max-width:480px">
    <h2>Checkout</h2>
    ${state.cart.map(i => `<div class="muted">${esc(i.name)} × ${i.qty} — ${money(i.price * i.qty)}</div>`).join('')}
    <p class="price">Total: ${money(total)}</p>
    <label>Delivery address</label>
    <textarea id="addr" rows="3"></textarea>
    <button class="btn" onclick="placeOrder()">Place order</button>
  </div>`;
}

async function placeOrder() {
  const address = v('addr');
  if (!address) return toast('Please enter your delivery address');
  try {
    const r = await api('/api/orders', 'POST', { items: state.cart.map(i => ({ productId: i.id, qty: i.qty })), address });
    state.cart = []; saveCart();
    app.innerHTML = `<div class="center"><h2>Order placed 🎉</h2><p>Your order number is #${r.orderId}</p><a class="btn" href="#/orders">View my orders</a></div>`;
  } catch (e) { toast(e.message); }
}

async function ordersPage() {
  if (!state.user) { location.hash = '#/login'; return; }
  const orders = await api('/api/orders');
  app.innerHTML = '<h2>My orders</h2>' + (orders.length ? orders.map(o => `<div class="card order">
      <div class="order-head"><b>Order #${o.id}</b><span class="status">${esc(o.status)}</span></div>
      ${o.items.map(i => `<div>${esc(i.name)} × ${i.qty} <span class="muted">— ${money(i.price * i.qty)}</span></div>`).join('')}
      <p><b>Total: ${money(o.total)}</b></p>
      <div class="muted">Ship to: ${esc(o.address)}</div>
    </div>`).join('') : '<p>No orders yet. <a href="#/">Start shopping</a></p>');
}

// ----- Router -----
async function router() {
  const [, page, arg] = location.hash.slice(1).split('/');
  try {
    if (page === 'product') await productPage(arg);
    else if (page === 'cart') cartPage();
    else if (page === 'checkout') checkoutPage();
    else if (page === 'orders') await ordersPage();
    else if (page === 'login') authPage('login', ['email', 'password']);
    else if (page === 'register') authPage('register', ['name', 'email', 'password']);
    else await home();
  } catch (e) {
    app.innerHTML = `<p class="error">${esc(e.message)}</p>`;
  }
}
window.addEventListener('hashchange', router);
renderNav();
router();
