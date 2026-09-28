/**
 * CodeAlpha Task 2 — Social Media Platform
 * Express + SQLite + vanilla HTML/CSS/JS
 */

'use strict';

const path = require('path');
const express = require('express');
const session = require('express-session');
const SQLiteStore = require('connect-sqlite3')(session);

const { attachUser } = require('./src/auth');
const { db } = require('./src/db');

const app = express();
const PORT = Number(process.env.PORT) || 4000;

app.use(express.json({ limit: '100kb' }));
app.use(express.urlencoded({ extended: true, limit: '100kb' }));

app.use(
  session({
    name: 'social.sid',
    store: new SQLiteStore({
      db: 'sessions.db',
      dir: path.join(__dirname, 'data'),
    }),
    secret: process.env.SESSION_SECRET || 'codealpha-dev-secret-change-me',
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      maxAge: 1000 * 60 * 60 * 24 * 7,
    },
  })
);

app.use(attachUser);

app.use('/api/auth', require('./src/routes/auth.routes'));
app.use('/api/posts', require('./src/routes/posts.routes'));
app.use('/api/users', require('./src/routes/users.routes'));

app.get('/api/health', (req, res) => {
  const count = (table) =>
    db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n;

  res.json({
    status: 'ok',
    signedInAs: req.user ? req.user.username : null,
    counts: {
      users: count('users'),
      posts: count('posts'),
      comments: count('comments'),
      likes: count('likes'),
      follows: count('follows'),
    },
  });
});

app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'] }));

/**
 * Pretty profile URLs: /u/zahra serves the profile page, which then reads
 * the username back out of the path. Without this the address bar would
 * show /profile?username=zahra, and a profile link is the single most
 * shared URL in an app like this.
 */
app.get('/u/:username', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'profile.html'));
});

app.get('/p/:id', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'post.html'));
});

// Unknown /api/* must answer in JSON, or fetch() gets HTML to parse.
app.use('/api', (req, res) => {
  res.status(404).json({
    error: `No such endpoint: ${req.method} ${req.originalUrl}`,
  });
});

app.use((req, res) => {
  res.status(404).sendFile(path.join(__dirname, 'public', '404.html'));
});

// eslint-disable-next-line no-unused-vars
app.use((error, req, res, next) => {
  console.error('[error]', error);
  res.status(error.status || 500).json({
    error:
      process.env.NODE_ENV === 'production'
        ? 'Something went wrong on our side.'
        : error.message,
  });
});

if (require.main === module) {
  const users = db.prepare('SELECT COUNT(*) AS n FROM users').get().n;
  const posts = db.prepare('SELECT COUNT(*) AS n FROM posts').get().n;

  if (users === 0) {
    console.log('\n  No accounts yet. Run  npm run seed  to load demo data.\n');
  }

  app.listen(PORT, () => {
    console.log(`\n  CodeAlpha Social`);
    console.log(`  ${'-'.repeat(46)}`);
    console.log(`  Running at  http://localhost:${PORT}`);
    console.log(`  Accounts    ${users}   Posts  ${posts}`);
    console.log(`  Demo login  zahra / demo1234`);
    console.log(`  ${'-'.repeat(46)}\n`);
  });
}

module.exports = app;
