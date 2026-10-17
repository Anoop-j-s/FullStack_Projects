# CodeAlpha_EcommerceStore

Simple e-commerce store built for the **CodeAlpha Full Stack Development**.

## Features
- Product listing with search and category filter
- Product details page
- Shopping cart (saved in the browser)
- User registration and login (JWT + hashed passwords)
- Order processing with stock check
- Order history for each user
- SQLite database for users, products and orders

## Tech stack
- Frontend: HTML, CSS, JavaScript
- Backend: Node.js, Express.js
- Database: SQLite (better-sqlite3)

## How to run
You need Node.js 18 or newer.

```bash
npm install
npm start
```

Open http://localhost:3000

Sample products are added automatically the first time you run it.

## API
| Method | Route | Auth | What it does |
|---|---|---|---|
| POST | /api/register | No | Create account |
| POST | /api/login | No | Login, returns token |
| GET | /api/products | No | List products |
| GET | /api/products/:id | No | Product details |
| POST | /api/orders | Yes | Place an order |
| GET | /api/orders | Yes | My orders |

## Folder structure
```
server.js   - Express server and API routes
db.js       - Database tables and sample data
auth.js     - JWT helpers
public/     - Frontend (index.html, style.css, app.js)
```
