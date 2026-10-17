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

// ---------- Social media app ----------
let feedMode = 'all';

function renderNav() {
  document.getElementById('nav').innerHTML = state.user
    ? `<a href="#/">Home</a><a href="#/people">People</a><a href="#/profile/${esc(state.user.username)}">My profile</a><a href="#" onclick="logout();return false">Logout</a>`
    : `<a href="#/login">Login</a><a href="#/register">Register</a>`;
}

// ----- Post card (used on feed and profile pages) -----
function postHTML(p) {
  const mine = p.username === state.user.username;
  return `<div class="card post" id="post-${p.id}">
    <div class="post-head">
      <a href="#/profile/${esc(p.username)}">@${esc(p.username)}</a>
      <span class="muted">${timeAgo(p.created_at)}</span>
    </div>
    <div class="post-body">${esc(p.content)}</div>
    <div class="post-actions">
      <button id="like-${p.id}" onclick="toggleLike(${p.id})">${p.liked ? '❤️' : '🤍'} ${p.likes}</button>
      <button id="cm-${p.id}" onclick="toggleComments(${p.id})">💬 ${p.comments}</button>
      ${mine ? `<button onclick="deletePost(${p.id})">Delete</button>` : ''}
    </div>
    <div class="comments" id="c-${p.id}" hidden></div>
  </div>`;
}

// ----- Feed -----
async function feedPage() {
  app.innerHTML = `<div class="card compose">
      <textarea id="newpost" rows="3" maxlength="280" placeholder="What is on your mind?"></textarea>
      <div class="compose-foot"><span class="muted" id="count">0 / 280</span><button class="btn small" onclick="createPost()">Post</button></div>
    </div>
    <div class="tabs">
      <button class="tab ${feedMode === 'all' ? 'active' : ''}" onclick="setMode('all')">Everyone</button>
      <button class="tab ${feedMode === 'following' ? 'active' : ''}" onclick="setMode('following')">Following</button>
    </div>
    <div id="feed"></div>`;
  document.getElementById('newpost').addEventListener('input', e => {
    document.getElementById('count').textContent = e.target.value.length + ' / 280';
  });
  await loadFeed();
}
function setMode(m) { feedMode = m; feedPage(); }

async function loadFeed() {
  const posts = await api('/api/feed?mode=' + feedMode);
  document.getElementById('feed').innerHTML = posts.length
    ? posts.map(postHTML).join('')
    : `<p class="muted">${feedMode === 'following' ? 'Nothing here yet. Follow people from the People page.' : 'No posts yet. Write the first one.'}</p>`;
}

async function createPost() {
  try {
    await api('/api/posts', 'POST', { content: v('newpost') });
    toast('Posted');
    feedPage();
  } catch (e) { toast(e.message); }
}
async function deletePost(id) {
  if (!confirm('Delete this post?')) return;
  try {
    await api('/api/posts/' + id, 'DELETE');
    document.getElementById('post-' + id).remove();
    toast('Deleted');
  } catch (e) { toast(e.message); }
}

// ----- Likes -----
async function toggleLike(id) {
  try {
    const r = await api(`/api/posts/${id}/like`, 'POST');
    document.getElementById('like-' + id).textContent = `${r.liked ? '❤️' : '🤍'} ${r.likes}`;
  } catch (e) { toast(e.message); }
}

// ----- Comments -----
async function toggleComments(id) {
  const box = document.getElementById('c-' + id);
  if (!box.hidden) { box.hidden = true; return; }
  box.hidden = false;
  await loadComments(id);
}
async function loadComments(id) {
  const box = document.getElementById('c-' + id);
  const list = await api(`/api/posts/${id}/comments`);
  box.innerHTML = list.map(c => `<div class="comment"><b><a href="#/profile/${esc(c.username)}">@${esc(c.username)}</a></b> ${esc(c.content)} <span class="muted">${timeAgo(c.created_at)}</span></div>`).join('') +
    `<div class="comment-form"><input id="ci-${id}" maxlength="200" placeholder="Write a comment"><button class="btn small" onclick="addComment(${id})">Send</button></div>`;
  document.getElementById('cm-' + id).textContent = '💬 ' + list.length;
}
async function addComment(id) {
  try {
    await api(`/api/posts/${id}/comments`, 'POST', { content: v('ci-' + id) });
    await loadComments(id);
  } catch (e) { toast(e.message); }
}

// ----- Profile -----
async function profilePage(username) {
  const u = await api('/api/users/' + encodeURIComponent(username));
  app.innerHTML = `<div class="card">
      <div class="profile-head">
        <div style="display:flex;gap:14px;align-items:center">
          <div class="avatar">${esc(u.username[0].toUpperCase())}</div>
          <div><h2 style="margin:0">@${esc(u.username)}</h2><span class="muted">Joined ${esc(u.joined.slice(0, 10))}</span></div>
        </div>
        ${u.isMe ? '' : `<button class="btn small ${u.isFollowing ? 'light' : ''}" onclick="toggleFollow('${esc(u.username)}')">${u.isFollowing ? 'Unfollow' : 'Follow'}</button>`}
      </div>
      <div class="stats">
        <div><b>${u.postCount}</b><span class="muted">Posts</span></div>
        <div><b>${u.followers}</b><span class="muted">Followers</span></div>
        <div><b>${u.following}</b><span class="muted">Following</span></div>
      </div>
      ${u.isMe
        ? `<label>Your bio</label><textarea id="bio" rows="2" maxlength="160">${esc(u.bio)}</textarea><button class="btn small" style="margin-top:8px" onclick="saveBio()">Save bio</button>`
        : `<p>${u.bio ? esc(u.bio) : '<span class="muted">No bio yet.</span>'}</p>`}
    </div>
    <h3 class="section-title">Posts</h3>
    ${u.posts.length ? u.posts.map(postHTML).join('') : '<p class="muted">No posts yet.</p>'}`;
}
async function saveBio() {
  try { await api('/api/me', 'PUT', { bio: v('bio') }); toast('Bio saved'); } catch (e) { toast(e.message); }
}
async function toggleFollow(username) {
  try { await api(`/api/users/${encodeURIComponent(username)}/follow`, 'POST'); profilePage(username); } catch (e) { toast(e.message); }
}

// ----- People (find users to follow) -----
async function peoplePage() {
  app.innerHTML = `<h2>People</h2><input id="q" placeholder="Search by username" oninput="loadPeople()"><div id="people" style="margin-top:16px"></div>`;
  loadPeople();
}
async function loadPeople() {
  const list = await api('/api/users?q=' + encodeURIComponent(document.getElementById('q').value));
  document.getElementById('people').innerHTML = list.length ? list.map(u => `<div class="card person">
      <div><a href="#/profile/${esc(u.username)}"><b>@${esc(u.username)}</b></a><div class="muted">${esc(u.bio) || 'No bio'} · ${u.followers} followers</div></div>
      <button class="btn small ${u.following ? 'light' : ''}" onclick="followFromList('${esc(u.username)}')">${u.following ? 'Unfollow' : 'Follow'}</button>
    </div>`).join('') : '<p class="muted">No users found.</p>';
}
async function followFromList(username) {
  try { await api(`/api/users/${encodeURIComponent(username)}/follow`, 'POST'); loadPeople(); } catch (e) { toast(e.message); }
}

// ----- Router -----
async function router() {
  const [, page, arg] = location.hash.slice(1).split('/');
  if (page === 'register') return authPage('register', ['username', 'password']);
  if (page === 'login') return authPage('login', ['username', 'password']);
  if (!state.user) { location.hash = '#/login'; return; }
  try {
    if (page === 'profile') await profilePage(decodeURIComponent(arg || state.user.username));
    else if (page === 'people') await peoplePage();
    else await feedPage();
  } catch (e) {
    app.innerHTML = `<p class="error">${esc(e.message)}</p>`;
  }
}
window.addEventListener('hashchange', router);
renderNav();
router();
