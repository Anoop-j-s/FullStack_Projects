const jwt = require('jsonwebtoken');

// Simple setup: secret is written here. Change it if you like.
const SECRET = process.env.JWT_SECRET || 'codealpha-secret-key';

function sign(user) {
  return jwt.sign(user, SECRET, { expiresIn: '7d' });
}

function auth(req, res, next) {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Login required' });
  try {
    req.user = jwt.verify(token, SECRET);
    next();
  } catch (e) {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
}

module.exports = { sign, auth, SECRET };
