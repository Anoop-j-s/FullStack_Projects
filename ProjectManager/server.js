const express = require('express');
const http = require('http');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const path = require('path');
const { Server } = require('socket.io');
const db = require('./db');
const { sign, auth, SECRET } = require('./auth');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ---------- Helpers ----------
const isMember = (projectId, userId) =>
  !!db.prepare('SELECT 1 FROM members WHERE project_id = ? AND user_id = ?').get(projectId, userId);

const getTask = id => db.prepare('SELECT * FROM tasks WHERE id = ?').get(id);

// Save a notification and push it live to the user
function notify(userId, text, projectId) {
  db.prepare('INSERT INTO notifications (user_id, text, project_id) VALUES (?,?,?)').run(userId, text, projectId);
  io.to('user:' + userId).emit('notification', { text, projectId });
}
// Tell everyone who has this project open to refresh
function changed(projectId, taskId) {
  io.to('project:' + projectId).emit('project-changed', { projectId, taskId });
}

// ---------- WebSockets ----------
io.use((socket, next) => {
  try {
    socket.user = jwt.verify(socket.handshake.auth.token, SECRET);
    next();
  } catch (e) {
    next(new Error('Not logged in'));
  }
});
io.on('connection', socket => {
  socket.join('user:' + socket.user.id);
  socket.on('join-project', pid => { if (isMember(pid, socket.user.id)) socket.join('project:' + pid); });
  socket.on('leave-project', pid => socket.leave('project:' + pid));
});

// ---------- Register and login ----------
app.post('/api/register', (req, res) => {
  const { username, password } = req.body;
  if (!/^[a-zA-Z0-9_]{3,20}$/.test(username || '')) {
    return res.status(400).json({ error: 'Username must be 3-20 letters, numbers or underscores' });
  }
  if (!password || password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });
  if (db.prepare('SELECT id FROM users WHERE username = ? COLLATE NOCASE').get(username)) {
    return res.status(400).json({ error: 'Username is already taken' });
  }
  const info = db.prepare('INSERT INTO users (username, password) VALUES (?,?)').run(username, bcrypt.hashSync(password, 10));
  const user = { id: Number(info.lastInsertRowid), username };
  res.json({ token: sign(user), user });
});

app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  const row = db.prepare('SELECT * FROM users WHERE username = ? COLLATE NOCASE').get(username || '');
  if (!row || !bcrypt.compareSync(password || '', row.password)) {
    return res.status(400).json({ error: 'Wrong username or password' });
  }
  const user = { id: row.id, username: row.username };
  res.json({ token: sign(user), user });
});

// ---------- Projects ----------
app.get('/api/projects', auth, (req, res) => {
  res.json(db.prepare(`
    SELECT p.id, p.name, p.description, p.owner_id,
      (SELECT COUNT(*) FROM tasks WHERE project_id = p.id) AS tasks,
      (SELECT COUNT(*) FROM tasks WHERE project_id = p.id AND status = 'done') AS done,
      (SELECT COUNT(*) FROM members WHERE project_id = p.id) AS members
    FROM projects p JOIN members m ON m.project_id = p.id
    WHERE m.user_id = ? ORDER BY p.id DESC
  `).all(req.user.id));
});

app.post('/api/projects', auth, (req, res) => {
  const name = (req.body.name || '').trim();
  if (!name) return res.status(400).json({ error: 'Project name is required' });
  const create = db.transaction(() => {
    const info = db.prepare('INSERT INTO projects (name, description, owner_id) VALUES (?,?,?)')
      .run(name, (req.body.description || '').trim(), req.user.id);
    db.prepare('INSERT INTO members (project_id, user_id) VALUES (?,?)').run(info.lastInsertRowid, req.user.id);
    return Number(info.lastInsertRowid);
  });
  res.json({ id: create() });
});

app.get('/api/projects/:id', auth, (req, res) => {
  const id = req.params.id;
  if (!isMember(id, req.user.id)) return res.status(404).json({ error: 'Project not found' });
  const project = db.prepare('SELECT id, name, description, owner_id FROM projects WHERE id = ?').get(id);
  const members = db.prepare('SELECT u.id, u.username FROM members m JOIN users u ON u.id = m.user_id WHERE m.project_id = ? ORDER BY u.username').all(id);
  const tasks = db.prepare(`
    SELECT t.id, t.title, t.description, t.status, t.assignee_id, u.username AS assignee,
      (SELECT COUNT(*) FROM comments WHERE task_id = t.id) AS comments
    FROM tasks t LEFT JOIN users u ON u.id = t.assignee_id
    WHERE t.project_id = ? ORDER BY t.id
  `).all(id);
  res.json({ project, members, tasks });
});

app.delete('/api/projects/:id', auth, (req, res) => {
  const r = db.prepare('DELETE FROM projects WHERE id = ? AND owner_id = ?').run(req.params.id, req.user.id);
  if (!r.changes) return res.status(403).json({ error: 'Only the owner can delete a project' });
  res.json({ ok: true });
});

app.post('/api/projects/:id/members', auth, (req, res) => {
  const id = req.params.id;
  const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(id);
  if (!project || project.owner_id !== req.user.id) return res.status(403).json({ error: 'Only the owner can add members' });
  const u = db.prepare('SELECT id, username FROM users WHERE username = ? COLLATE NOCASE').get(req.body.username || '');
  if (!u) return res.status(404).json({ error: 'No user with that username' });
  if (isMember(id, u.id)) return res.status(400).json({ error: u.username + ' is already a member' });
  db.prepare('INSERT INTO members (project_id, user_id) VALUES (?,?)').run(id, u.id);
  notify(u.id, `${req.user.username} added you to "${project.name}"`, Number(id));
  changed(id);
  res.json({ ok: true });
});

// ---------- Tasks ----------
app.post('/api/projects/:id/tasks', auth, (req, res) => {
  const pid = req.params.id;
  if (!isMember(pid, req.user.id)) return res.status(404).json({ error: 'Project not found' });
  const title = (req.body.title || '').trim();
  if (!title) return res.status(400).json({ error: 'Task title is required' });
  const assignee = req.body.assignee_id ? Number(req.body.assignee_id) : null;
  if (assignee && !isMember(pid, assignee)) return res.status(400).json({ error: 'Assignee must be a project member' });

  const info = db.prepare('INSERT INTO tasks (project_id, title, description, assignee_id, created_by) VALUES (?,?,?,?,?)')
    .run(pid, title, (req.body.description || '').trim(), assignee, req.user.id);
  if (assignee && assignee !== req.user.id) {
    notify(assignee, `${req.user.username} assigned you "${title}"`, Number(pid));
  }
  changed(pid, Number(info.lastInsertRowid));
  res.json({ id: Number(info.lastInsertRowid) });
});

app.put('/api/tasks/:id', auth, (req, res) => {
  const t = getTask(req.params.id);
  if (!t || !isMember(t.project_id, req.user.id)) return res.status(404).json({ error: 'Task not found' });
  const b = req.body;
  const title = (b.title ?? t.title).trim();
  const description = b.description ?? t.description;
  const status = b.status ?? t.status;
  let assignee = t.assignee_id;
  if ('assignee_id' in b) assignee = b.assignee_id ? Number(b.assignee_id) : null;

  if (!title) return res.status(400).json({ error: 'Task title is required' });
  if (!['todo', 'doing', 'done'].includes(status)) return res.status(400).json({ error: 'Invalid status' });
  if (assignee && !isMember(t.project_id, assignee)) return res.status(400).json({ error: 'Assignee must be a project member' });

  db.prepare('UPDATE tasks SET title = ?, description = ?, status = ?, assignee_id = ? WHERE id = ?')
    .run(title, description, status, assignee, t.id);
  if (assignee && assignee !== t.assignee_id && assignee !== req.user.id) {
    notify(assignee, `${req.user.username} assigned you "${title}"`, t.project_id);
  }
  changed(t.project_id, t.id);
  res.json({ ok: true });
});

app.delete('/api/tasks/:id', auth, (req, res) => {
  const t = getTask(req.params.id);
  if (!t || !isMember(t.project_id, req.user.id)) return res.status(404).json({ error: 'Task not found' });
  db.prepare('DELETE FROM tasks WHERE id = ?').run(t.id);
  changed(t.project_id, t.id);
  res.json({ ok: true });
});

// ---------- Comments inside tasks ----------
app.get('/api/tasks/:id/comments', auth, (req, res) => {
  const t = getTask(req.params.id);
  if (!t || !isMember(t.project_id, req.user.id)) return res.status(404).json({ error: 'Task not found' });
  res.json(db.prepare(`
    SELECT c.id, c.content, c.created_at, u.username
    FROM comments c JOIN users u ON u.id = c.user_id
    WHERE c.task_id = ? ORDER BY c.id
  `).all(t.id));
});

app.post('/api/tasks/:id/comments', auth, (req, res) => {
  const t = getTask(req.params.id);
  if (!t || !isMember(t.project_id, req.user.id)) return res.status(404).json({ error: 'Task not found' });
  const content = (req.body.content || '').trim();
  if (!content) return res.status(400).json({ error: 'Comment cannot be empty' });
  db.prepare('INSERT INTO comments (task_id, user_id, content) VALUES (?,?,?)').run(t.id, req.user.id, content);
  if (t.assignee_id && t.assignee_id !== req.user.id) {
    notify(t.assignee_id, `${req.user.username} commented on "${t.title}"`, t.project_id);
  }
  changed(t.project_id, t.id);
  res.json({ ok: true });
});

// ---------- Notifications ----------
app.get('/api/notifications', auth, (req, res) => {
  res.json(db.prepare('SELECT * FROM notifications WHERE user_id = ? ORDER BY id DESC LIMIT 20').all(req.user.id));
});
app.post('/api/notifications/read', auth, (req, res) => {
  db.prepare('UPDATE notifications SET is_read = 1 WHERE user_id = ?').run(req.user.id);
  res.json({ ok: true });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log('Project manager running at http://localhost:' + PORT));
