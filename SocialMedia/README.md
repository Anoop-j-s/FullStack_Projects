# CodeAlpha_SocialMedia

Mini social media platform built for the **CodeAlpha Full Stack Development**.

## Features
- User registration and login (JWT + hashed passwords)
- User profiles with bio, post count, followers and following
- Create and delete posts (up to 280 characters)
- Comments on posts
- Like and unlike posts
- Follow and unfollow users
- Feed with two tabs: Everyone and Following
- Search people by username
- SQLite database for users, posts, comments, likes and follows

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

Open http://localhost:3000 and register two accounts to try follow, like and comment.

## API (all routes except register and login need a login token)
| Method | Route | What it does |
|---|---|---|
| POST | /api/register | Create account |
| POST | /api/login | Login, returns token |
| GET | /api/feed?mode=all or following | Get posts |
| POST | /api/posts | Create post |
| DELETE | /api/posts/:id | Delete my post |
| POST | /api/posts/:id/like | Like or unlike |
| GET, POST | /api/posts/:id/comments | List or add comments |
| GET | /api/users?q= | Search users |
| GET | /api/users/:username | Profile with posts |
| POST | /api/users/:username/follow | Follow or unfollow |
| PUT | /api/me | Update my bio |

## Folder structure
```
server.js   - Express server and API routes
db.js       - Database tables
auth.js     - JWT helpers
public/     - Frontend (index.html, style.css, app.js)
```
