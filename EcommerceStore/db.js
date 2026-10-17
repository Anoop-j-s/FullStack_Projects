const Database = require('better-sqlite3');
const path = require('path');

const db = new Database(path.join(__dirname, 'store.db'));
db.pragma('journal_mode = WAL');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  password TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  description TEXT,
  price REAL NOT NULL,
  emoji TEXT,
  category TEXT,
  stock INTEGER DEFAULT 50
);
CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  total REAL NOT NULL,
  address TEXT NOT NULL,
  status TEXT DEFAULT 'Placed',
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS order_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL,
  product_id INTEGER NOT NULL,
  name TEXT,
  price REAL,
  qty INTEGER
);
`);

// Add sample products the first time
if (db.prepare('SELECT COUNT(*) AS c FROM products').get().c === 0) {
  const add = db.prepare('INSERT INTO products (name, description, price, emoji, category, stock) VALUES (?,?,?,?,?,?)');
  const items = [
    ['Wireless Headphones', 'Over-ear Bluetooth headphones with 30 hour battery and deep bass.', 2499, '🎧', 'Electronics', 25],
    ['Smart Watch', 'Tracks steps, sleep and heart rate. Water resistant.', 3999, '⌚', 'Electronics', 15],
    ['Mechanical Keyboard', 'Compact 75% keyboard with blue switches and RGB backlight.', 2899, '⌨️', 'Electronics', 20],
    ['Gaming Mouse', 'Lightweight mouse with 6 buttons and adjustable DPI.', 1199, '🖱️', 'Electronics', 40],
    ['Backpack', 'Water resistant 25L backpack with laptop sleeve.', 1499, '🎒', 'Fashion', 30],
    ['Sunglasses', 'UV400 polarized sunglasses with light frame.', 799, '🕶️', 'Fashion', 35],
    ['Running Shoes', 'Cushioned everyday running shoes. Breathable mesh.', 2199, '👟', 'Fashion', 18],
    ['Coffee Mug', 'Ceramic mug, 350 ml. Dishwasher safe.', 299, '☕', 'Home', 60],
    ['Desk Lamp', 'LED desk lamp with three brightness levels and USB port.', 899, '💡', 'Home', 22],
    ['Notebook Set', 'Pack of 3 ruled notebooks, 200 pages each.', 349, '📓', 'Stationery', 80],
    ['Water Bottle', 'Steel bottle, 750 ml. Keeps drinks cold for 24 hours.', 599, '🍶', 'Home', 45],
    ['Yoga Mat', 'Non-slip 6 mm mat with carry strap.', 999, '🧘', 'Fitness', 28]
  ];
  const tx = db.transaction(list => list.forEach(i => add.run(...i)));
  tx(items);
}

module.exports = db;
