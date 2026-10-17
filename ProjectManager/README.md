# CodeAlpha_ProjectManager

Project management tool (like a small Trello) built for the **CodeAlpha Full Stack Development **, including the bonus real-time updates and notifications.

## Features
- User registration and login (JWT + hashed passwords)
- Create group projects and add members by username
- Project board with three columns: To do, In progress, Done
- Create tasks, assign them to members, edit and delete them
- Move tasks by drag and drop, or with the arrow buttons
- Comments inside each task
- **Bonus:** real-time updates with WebSockets (Socket.io). When someone changes a task, everyone with that board open sees it instantly
- **Bonus:** notifications when you are assigned a task, added to a project, or someone comments on your task
- SQLite database for users, projects, members, tasks, comments and notifications

## Tech stack
- Frontend: HTML, CSS, JavaScript
- Backend: Node.js, Express.js, Socket.io
- Database: SQLite (better-sqlite3)

## How to run
You need Node.js 18 or newer.

```bash
npm install
npm start
```

Open http://localhost:3000

To see real-time updates, register two users, open the site in two browsers, and add the second user to a project.

## API (all routes except register and login need a login token)
| Method | Route | What it does |
|---|---|---|
| POST | /api/register, /api/login | Create account, login |
| GET, POST | /api/projects | List my projects, create project |
| GET, DELETE | /api/projects/:id | Project with members and tasks, delete (owner) |
| POST | /api/projects/:id/members | Add member (owner) |
| POST | /api/projects/:id/tasks | Create task |
| PUT, DELETE | /api/tasks/:id | Update or delete task |
| GET, POST | /api/tasks/:id/comments | List or add comments |
| GET | /api/notifications | My notifications |
| POST | /api/notifications/read | Mark all as read |

## Folder structure
```
server.js   - Express server, API routes, Socket.io
db.js       - Database tables
auth.js     - JWT helpers
public/     - Frontend (index.html, style.css, app.js)
```
