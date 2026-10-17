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

// ---------- Project manager app ----------
let socket = null;
let currentProject = null;   // id of the board that is open
let openTask = null;         // id of the task modal that is open
let notes = [];
let notesOpen = false;

const STATUSES = [['todo', 'To do'], ['doing', 'In progress'], ['done', 'Done']];

// ----- Navigation and notifications -----
function renderNav() {
  const nav = document.getElementById('nav');
  if (!state.user) {
    nav.innerHTML = '<a href="#/login">Login</a><a href="#/register">Register</a>';
    return;
  }
  const unread = notes.filter(n => !n.is_read).length;
  nav.innerHTML = `<a href="#/">My projects</a>
    <button class="bell" onclick="toggleNotes()" aria-label="Notifications">🔔${unread ? `<span class="count">${unread}</span>` : ''}</button>
    <span class="hello">@${esc(state.user.username)}</span>
    <a href="#" onclick="logout();return false">Logout</a>`;
}

async function loadNotes() {
  try { notes = await api('/api/notifications'); } catch (e) { notes = []; }
  renderNav();
}
async function toggleNotes() {
  const old = document.getElementById('notes');
  if (old) { old.remove(); notesOpen = false; return; }
  notesOpen = true;
  const box = document.createElement('div');
  box.id = 'notes';
  box.className = 'notes';
  box.innerHTML = notes.length
    ? notes.map(n => `<div class="note ${n.is_read ? '' : 'unread'}" onclick="goProject(${n.project_id})">${esc(n.text)}<div class="muted">${timeAgo(n.created_at)}</div></div>`).join('')
    : '<p class="muted" style="padding:8px">No notifications yet.</p>';
  document.body.appendChild(box);
  if (notes.some(n => !n.is_read)) {
    await api('/api/notifications/read', 'POST');
    notes = notes.map(n => ({ ...n, is_read: 1 }));
    renderNav();
  }
}
function goProject(id) {
  const box = document.getElementById('notes');
  if (box) box.remove();
  if (id) location.hash = '#/project/' + id;
}

// ----- Real-time connection -----
function connectSocket() {
  if (socket || !state.token) return;
  socket = io({ auth: { token: state.token } });
  socket.on('connect', () => { if (currentProject) socket.emit('join-project', currentProject); });
  socket.on('notification', n => {
    toast('🔔 ' + n.text);
    loadNotes();
  });
  socket.on('project-changed', d => {
    if (d.projectId === currentProject) {
      refreshBoard();
      if (openTask) loadComments(openTask);
    } else if (!currentProject) {
      // On the project list page: refresh the list
      if (location.hash === '#/' || location.hash === '') projectsPage();
    }
  });
}
function onLogin() { connectSocket(); loadNotes(); }
function onLogout() {
  if (socket) { socket.disconnect(); socket = null; }
  currentProject = null; openTask = null; notes = [];
  closeModal();
  const box = document.getElementById('notes');
  if (box) box.remove();
}

// ----- Projects list -----
async function projectsPage() {
  const list = await api('/api/projects');
  const keep = document.getElementById('pname') ? [v('pname'), v('pdesc')] : ['', ''];
  app.innerHTML = `<h2>My projects</h2>
    <div class="card top-row">
      <div><label>Project name</label><input id="pname" placeholder="e.g. Website redesign"></div>
      <div><label>Description (optional)</label><input id="pdesc" placeholder="What is this project about?"></div>
      <button class="btn" onclick="createProject()">Create project</button>
    </div>
    <div class="projects">${list.length ? list.map(p => `<a class="card project" href="#/project/${p.id}" style="color:inherit;text-decoration:none">
      <h3>${esc(p.name)}</h3>
      <div class="muted">${esc(p.description) || 'No description'}</div>
      <div class="bar"><span style="width:${p.tasks ? Math.round(p.done / p.tasks * 100) : 0}%"></span></div>
      <div class="muted">${p.done} of ${p.tasks} tasks done · ${p.members} member${p.members === 1 ? '' : 's'}</div>
    </a>`).join('') : '<p class="muted">No projects yet. Create your first one above.</p>'}</div>`;
  document.getElementById('pname').value = keep[0];
  document.getElementById('pdesc').value = keep[1];
}
async function createProject() {
  try {
    const r = await api('/api/projects', 'POST', { name: v('pname'), description: v('pdesc') });
    location.hash = '#/project/' + r.id;
  } catch (e) { toast(e.message); }
}

// ----- Project board -----
let boardData = null;

async function boardPage(id) {
  currentProject = Number(id);
  connectSocket();
  if (socket && socket.connected) socket.emit('join-project', currentProject);
  boardData = await api('/api/projects/' + id);
  drawBoard();
}
async function refreshBoard() {
  if (!currentProject) return;
  try { boardData = await api('/api/projects/' + currentProject); drawBoard(); } catch (e) { /* ignore */ }
}

function drawBoard() {
  const { project, members, tasks } = boardData;
  const isOwner = project.owner_id === state.user.id;
  const keepTitle = document.getElementById('ttitle') ? v('ttitle') : '';
  const keepAssignee = document.getElementById('tassign') ? document.getElementById('tassign').value : '';
  app.innerHTML = `<p><a href="#/">← All projects</a></p>
    <div class="board-head">
      <div>
        <h2 style="margin:0">${esc(project.name)}</h2>
        <div class="muted">${esc(project.description)}</div>
        <div class="chips">${members.map(m => `<span class="chip">@${esc(m.username)}</span>`).join('')}</div>
      </div>
      ${isOwner ? `<div class="inline-form" style="margin:0">
        <input id="mname" placeholder="Add member by username" style="min-width:190px">
        <button class="btn small" onclick="addMember()">Add member</button>
        <button class="btn small danger" onclick="deleteProject()">Delete project</button>
      </div>` : ''}
    </div>
    <div class="inline-form">
      <input id="ttitle" placeholder="New task title" onkeydown="if(event.key==='Enter')addTask()">
      <select id="tassign"><option value="">Unassigned</option>${members.map(m => `<option value="${m.id}">@${esc(m.username)}</option>`).join('')}</select>
      <button class="btn" onclick="addTask()">Add task</button>
    </div>
    <div class="columns">
      ${STATUSES.map(([key, label]) => {
        const list = tasks.filter(t => t.status === key);
        return `<div class="column" data-status="${key}" ondragover="dragOver(event)" ondragleave="dragLeave(event)" ondrop="dropTask(event,'${key}')">
          <h3>${label}<span class="muted">${list.length}</span></h3>
          ${list.map(taskCard).join('')}
        </div>`;
      }).join('')}
    </div>`;
  document.getElementById('ttitle').value = keepTitle;
  document.getElementById('tassign').value = keepAssignee;
}

function taskCard(t) {
  const i = STATUSES.findIndex(s => s[0] === t.status);
  return `<div class="task" draggable="true" ondragstart="dragStart(event,${t.id})" ondragend="this.classList.remove('dragging')" onclick="openTaskModal(${t.id})">
    <div class="task-title">${esc(t.title)}</div>
    <div class="task-meta">
      <span>${t.assignee ? '@' + esc(t.assignee) : 'Unassigned'}${t.comments ? ' · 💬 ' + t.comments : ''}</span>
      <span class="move" onclick="event.stopPropagation()">
        ${i > 0 ? `<button onclick="moveTask(${t.id},'${STATUSES[i - 1][0]}')" aria-label="Move left">◀</button>` : ''}
        ${i < 2 ? `<button onclick="moveTask(${t.id},'${STATUSES[i + 1][0]}')" aria-label="Move right">▶</button>` : ''}
      </span>
    </div>
  </div>`;
}

async function addTask() {
  try {
    await api(`/api/projects/${currentProject}/tasks`, 'POST', { title: v('ttitle'), assignee_id: document.getElementById('tassign').value });
    document.getElementById('ttitle').value = '';
    await refreshBoard();
  } catch (e) { toast(e.message); }
}
async function moveTask(id, status) {
  try { await api('/api/tasks/' + id, 'PUT', { status }); await refreshBoard(); } catch (e) { toast(e.message); }
}
async function addMember() {
  try {
    await api(`/api/projects/${currentProject}/members`, 'POST', { username: v('mname') });
    toast('Member added');
    await refreshBoard();
  } catch (e) { toast(e.message); }
}
async function deleteProject() {
  if (!confirm('Delete this project and all its tasks?')) return;
  try { await api('/api/projects/' + currentProject, 'DELETE'); location.hash = '#/'; } catch (e) { toast(e.message); }
}

// ----- Drag and drop -----
function dragStart(e, id) { e.dataTransfer.setData('text/plain', String(id)); e.target.classList.add('dragging'); }
function dragOver(e) { e.preventDefault(); e.currentTarget.classList.add('over'); }
function dragLeave(e) { e.currentTarget.classList.remove('over'); }
function dropTask(e, status) {
  e.preventDefault();
  e.currentTarget.classList.remove('over');
  const id = Number(e.dataTransfer.getData('text/plain'));
  const t = boardData.tasks.find(x => x.id === id);
  if (t && t.status !== status) moveTask(id, status);
}

// ----- Task details and comments -----
function openTaskModal(id) {
  const t = boardData.tasks.find(x => x.id === id);
  if (!t) return;
  openTask = id;
  document.getElementById('modal-box').innerHTML = `
    <label>Title</label><input id="mtitle" value="${esc(t.title)}">
    <label>Description</label><textarea id="mdesc" rows="3">${esc(t.description)}</textarea>
    <div class="modal-row">
      <div><label>Status</label><select id="mstatus">${STATUSES.map(s => `<option value="${s[0]}" ${s[0] === t.status ? 'selected' : ''}>${s[1]}</option>`).join('')}</select></div>
      <div><label>Assigned to</label><select id="massign"><option value="">Unassigned</option>${boardData.members.map(m => `<option value="${m.id}" ${m.id === t.assignee_id ? 'selected' : ''}>@${esc(m.username)}</option>`).join('')}</select></div>
    </div>
    <div class="modal-actions">
      <button class="btn danger small" onclick="deleteTask(${id})">Delete task</button>
      <div><button class="btn light small" onclick="closeModal()">Close</button> <button class="btn small" onclick="saveTask(${id})">Save changes</button></div>
    </div>
    <h3 style="margin-top:20px">Comments</h3>
    <div id="comments"></div>
    <div class="inline-form" style="margin:10px 0 0">
      <input id="cinput" placeholder="Write a comment" onkeydown="if(event.key==='Enter')addComment(${id})">
      <button class="btn small" onclick="addComment(${id})">Send</button>
    </div>`;
  document.getElementById('modal').hidden = false;
  loadComments(id);
}
function closeModal() { document.getElementById('modal').hidden = true; openTask = null; }
document.getElementById('modal').addEventListener('click', e => { if (e.target.id === 'modal') closeModal(); });

async function saveTask(id) {
  try {
    await api('/api/tasks/' + id, 'PUT', {
      title: v('mtitle'), description: document.getElementById('mdesc').value,
      status: document.getElementById('mstatus').value, assignee_id: document.getElementById('massign').value
    });
    closeModal();
    await refreshBoard();
    toast('Task saved');
  } catch (e) { toast(e.message); }
}
async function deleteTask(id) {
  if (!confirm('Delete this task?')) return;
  try { await api('/api/tasks/' + id, 'DELETE'); closeModal(); await refreshBoard(); } catch (e) { toast(e.message); }
}
async function loadComments(id) {
  const box = document.getElementById('comments');
  if (!box) return;
  try {
    const list = await api(`/api/tasks/${id}/comments`);
    box.innerHTML = list.length
      ? list.map(c => `<div class="comment"><b>@${esc(c.username)}</b> <span class="muted">${timeAgo(c.created_at)}</span><div>${esc(c.content)}</div></div>`).join('')
      : '<p class="muted">No comments yet.</p>';
  } catch (e) { /* task may be deleted */ }
}
async function addComment(id) {
  try {
    await api(`/api/tasks/${id}/comments`, 'POST', { content: v('cinput') });
    document.getElementById('cinput').value = '';
    await loadComments(id);
    await refreshBoard();
  } catch (e) { toast(e.message); }
}

// ----- Router -----
async function router() {
  const [, page, arg] = location.hash.slice(1).split('/');
  if (page !== 'project' && currentProject && socket) socket.emit('leave-project', currentProject);
  if (page !== 'project') { currentProject = null; closeModal(); }
  if (page === 'register') return authPage('register', ['username', 'password']);
  if (page === 'login') return authPage('login', ['username', 'password']);
  if (!state.user) { location.hash = '#/login'; return; }
  try {
    if (page === 'project') await boardPage(arg);
    else await projectsPage();
  } catch (e) {
    app.innerHTML = `<p class="error">${esc(e.message)}</p><a href="#/">← Back to projects</a>`;
  }
}
window.addEventListener('hashchange', router);
renderNav();
if (state.user) { connectSocket(); loadNotes(); }
router();
