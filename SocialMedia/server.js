const express = require('express');
const bcrypt = require('bcryptjs');
const path = require('path');
const db = require('./db');
const { sign, auth } = require('./auth');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

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

// ---------- Posts ----------
// Returns posts with like count, comment count and whether I liked them
function getPosts(me, where = '', params = []) {
  return db.prepare(`
    SELECT p.id, p.content, p.created_at, u.username,
      (SELECT COUNT(*) FROM likes WHERE post_id = p.id) AS likes,
      (SELECT COUNT(*) FROM comments WHERE post_id = p.id) AS comments,
      EXISTS(SELECT 1 FROM likes WHERE post_id = p.id AND user_id = ?) AS liked
    FROM posts p JOIN users u ON u.id = p.user_id
    WHERE 1 = 1 ${where}
    ORDER BY p.id DESC LIMIT 50
  `).all(me, ...params);
}

app.get('/api/feed', auth, (req, res) => {
  const me = req.user.id;
  if (req.query.mode === 'following') {
    return res.json(getPosts(me,
      'AND (p.user_id = ? OR p.user_id IN (SELECT following_id FROM follows WHERE follower_id = ?))', [me, me]));
  }
  res.json(getPosts(me));
});

app.post('/api/posts', auth, (req, res) => {
  const content = (req.body.content || '').trim();
  if (!content) return res.status(400).json({ error: 'Post cannot be empty' });
  if (content.length > 280) return res.status(400).json({ error: 'Post can be at most 280 characters' });
  db.prepare('INSERT INTO posts (user_id, content) VALUES (?,?)').run(req.user.id, content);
  res.json({ ok: true });
});

app.delete('/api/posts/:id', auth, (req, res) => {
  const r = db.prepare('DELETE FROM posts WHERE id = ? AND user_id = ?').run(req.params.id, req.user.id);
  if (!r.changes) return res.status(404).json({ error: 'Post not found or not yours' });
  res.json({ ok: true });
});

// ---------- Likes (toggle) ----------
app.post('/api/posts/:id/like', auth, (req, res) => {
  const id = req.params.id;
  if (!db.prepare('SELECT id FROM posts WHERE id = ?').get(id)) return res.status(404).json({ error: 'Post not found' });
  const has = db.prepare('SELECT 1 FROM likes WHERE user_id = ? AND post_id = ?').get(req.user.id, id);
  if (has) db.prepare('DELETE FROM likes WHERE user_id = ? AND post_id = ?').run(req.user.id, id);
  else db.prepare('INSERT INTO likes (user_id, post_id) VALUES (?,?)').run(req.user.id, id);
  const likes = db.prepare('SELECT COUNT(*) AS c FROM likes WHERE post_id = ?').get(id).c;
  res.json({ liked: !has, likes });
});

// ---------- Comments ----------
app.get('/api/posts/:id/comments', auth, (req, res) => {
  res.json(db.prepare(`
    SELECT c.id, c.content, c.created_at, u.username
    FROM comments c JOIN users u ON u.id = c.user_id
    WHERE c.post_id = ? ORDER BY c.id
  `).all(req.params.id));
});

app.post('/api/posts/:id/comments', auth, (req, res) => {
  const content = (req.body.content || '').trim();
  if (!content) return res.status(400).json({ error: 'Comment cannot be empty' });
  if (content.length > 200) return res.status(400).json({ error: 'Comment can be at most 200 characters' });
  if (!db.prepare('SELECT id FROM posts WHERE id = ?').get(req.params.id)) return res.status(404).json({ error: 'Post not found' });
  db.prepare('INSERT INTO comments (post_id, user_id, content) VALUES (?,?,?)').run(req.params.id, req.user.id, content);
  res.json({ ok: true });
});

// ---------- Profiles and follow ----------
app.get('/api/users', auth, (req, res) => {
  const q = '%' + (req.query.q || '') + '%';
  res.json(db.prepare(`
    SELECT u.username, u.bio,
      (SELECT COUNT(*) FROM follows WHERE following_id = u.id) AS followers,
      EXISTS(SELECT 1 FROM follows WHERE follower_id = ? AND following_id = u.id) AS following
    FROM users u WHERE u.id != ? AND u.username LIKE ? ORDER BY u.username LIMIT 50
  `).all(req.user.id, req.user.id, q));
});

app.get('/api/users/:username', auth, (req, res) => {
  const u = db.prepare('SELECT id, username, bio, created_at FROM users WHERE username = ? COLLATE NOCASE').get(req.params.username);
  if (!u) return res.status(404).json({ error: 'User not found' });
  const count = sql => db.prepare(sql).get(u.id).c;
  res.json({
    username: u.username,
    bio: u.bio,
    joined: u.created_at,
    followers: count('SELECT COUNT(*) AS c FROM follows WHERE following_id = ?'),
    following: count('SELECT COUNT(*) AS c FROM follows WHERE follower_id = ?'),
    postCount: count('SELECT COUNT(*) AS c FROM posts WHERE user_id = ?'),
    isMe: u.id === req.user.id,
    isFollowing: !!db.prepare('SELECT 1 FROM follows WHERE follower_id = ? AND following_id = ?').get(req.user.id, u.id),
    posts: getPosts(req.user.id, 'AND p.user_id = ?', [u.id])
  });
});

app.put('/api/me', auth, (req, res) => {
  const bio = (req.body.bio || '').trim().slice(0, 160);
  db.prepare('UPDATE users SET bio = ? WHERE id = ?').run(bio, req.user.id);
  res.json({ ok: true });
});

app.post('/api/users/:username/follow', auth, (req, res) => {
  const target = db.prepare('SELECT id FROM users WHERE username = ? COLLATE NOCASE').get(req.params.username);
  if (!target) return res.status(404).json({ error: 'User not found' });
  if (target.id === req.user.id) return res.status(400).json({ error: 'You cannot follow yourself' });
  const has = db.prepare('SELECT 1 FROM follows WHERE follower_id = ? AND following_id = ?').get(req.user.id, target.id);
  if (has) db.prepare('DELETE FROM follows WHERE follower_id = ? AND following_id = ?').run(req.user.id, target.id);
  else db.prepare('INSERT INTO follows (follower_id, following_id) VALUES (?,?)').run(req.user.id, target.id);
  res.json({ following: !has });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('Social app running at http://localhost:' + PORT));
