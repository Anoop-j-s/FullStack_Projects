const express = require('express');
const bcrypt = require('bcryptjs');
const path = require('path');
const db = require('./db');
const { sign, auth } = require('./auth');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ---------- User registration and login ----------
app.post('/api/register', (req, res) => {
  const { name, email, password } = req.body;
  if (!name || !email || !password) return res.status(400).json({ error: 'Name, email and password are required' });
  if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });

  const mail = email.toLowerCase();
  if (db.prepare('SELECT id FROM users WHERE email = ?').get(mail)) {
    return res.status(400).json({ error: 'This email is already registered' });
  }
  const info = db.prepare('INSERT INTO users (name, email, password) VALUES (?,?,?)')
    .run(name, mail, bcrypt.hashSync(password, 10));
  const user = { id: info.lastInsertRowid, name, email: mail };
  res.json({ token: sign(user), user });
});

app.post('/api/login', (req, res) => {
  const { email, password } = req.body;
  const row = db.prepare('SELECT * FROM users WHERE email = ?').get((email || '').toLowerCase());
  if (!row || !bcrypt.compareSync(password || '', row.password)) {
    return res.status(400).json({ error: 'Wrong email or password' });
  }
  const user = { id: row.id, name: row.name, email: row.email };
  res.json({ token: sign(user), user });
});

// ---------- Products ----------
app.get('/api/products', (req, res) => {
  res.json(db.prepare('SELECT * FROM products ORDER BY id').all());
});

app.get('/api/products/:id', (req, res) => {
  const p = db.prepare('SELECT * FROM products WHERE id = ?').get(req.params.id);
  if (!p) return res.status(404).json({ error: 'Product not found' });
  res.json(p);
});

// ---------- Orders ----------
app.post('/api/orders', auth, (req, res) => {
  const { items, address } = req.body;
  if (!Array.isArray(items) || items.length === 0) return res.status(400).json({ error: 'Cart is empty' });
  if (!address || !address.trim()) return res.status(400).json({ error: 'Delivery address is required' });

  const place = db.transaction(() => {
    let total = 0;
    const lines = [];
    for (const it of items) {
      const p = db.prepare('SELECT * FROM products WHERE id = ?').get(it.productId);
      const qty = parseInt(it.qty, 10);
      if (!p || !(qty > 0)) throw new Error('Invalid item in cart');
      if (p.stock < qty) throw new Error('Not enough stock for ' + p.name);
      total += p.price * qty;
      lines.push({ p, qty });
    }
    const order = db.prepare('INSERT INTO orders (user_id, total, address) VALUES (?,?,?)')
      .run(req.user.id, total, address.trim());
    for (const { p, qty } of lines) {
      db.prepare('INSERT INTO order_items (order_id, product_id, name, price, qty) VALUES (?,?,?,?,?)')
        .run(order.lastInsertRowid, p.id, p.name, p.price, qty);
      db.prepare('UPDATE products SET stock = stock - ? WHERE id = ?').run(qty, p.id);
    }
    return order.lastInsertRowid;
  });

  try {
    res.json({ orderId: place() });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.get('/api/orders', auth, (req, res) => {
  const orders = db.prepare('SELECT * FROM orders WHERE user_id = ? ORDER BY id DESC').all(req.user.id);
  const getItems = db.prepare('SELECT name, price, qty FROM order_items WHERE order_id = ?');
  orders.forEach(o => { o.items = getItems.all(o.id); });
  res.json(orders);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('Store running at http://localhost:' + PORT));
