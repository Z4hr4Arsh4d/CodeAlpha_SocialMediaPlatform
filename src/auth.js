/**
 * Authentication — registration, login, session middleware.
 *
 * Same principles as any login system worth trusting: bcrypt hashing,
 * identical messages for "no such account" and "wrong password", and only
 * the user id kept in the session so a renamed or deleted account cannot
 * keep acting through a stale cookie.
 *
 * The one addition here is the username: it is part of the public URL
 * (/u/zahra), so it needs its own validation and a reserved-word list.
 */

'use strict';

const bcrypt = require('bcryptjs');
const { db } = require('./db');

const BCRYPT_ROUNDS = 12;
const MIN_PASSWORD_LENGTH = 8;

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const USERNAME_PATTERN = /^[a-z0-9_]{3,20}$/;

/** Words that would collide with a route, or impersonate the platform. */
const RESERVED_USERNAMES = new Set([
  'admin', 'root', 'api', 'login', 'logout', 'register', 'settings',
  'explore', 'feed', 'home', 'post', 'posts', 'user', 'users', 'u',
  'about', 'help', 'support', 'system', 'moderator', 'official', 'null',
  'undefined', 'me', 'you', 'everyone', 'staff',
]);

const AVATARS = ['🦊', '🐼', '🦉', '🐙', '🦋', '🐝', '🦜', '🐢', '🦝', '🐬',
  '🦚', '🐳', '🦩', '🐨', '🦡', '🐧'];
const COLOURS = ['#6366f1', '#ec4899', '#14b8a6', '#f59e0b', '#8b5cf6',
  '#ef4444', '#10b981', '#0ea5e9', '#f43f5e', '#a855f7'];

class AuthError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

function validate({ username, displayName, email, password }) {
  const errors = [];

  const cleanUsername = String(username || '').trim().toLowerCase();

  if (!USERNAME_PATTERN.test(cleanUsername)) {
    errors.push(
      'Your username must be 3–20 characters, using lowercase letters, numbers or underscores.'
    );
  } else if (RESERVED_USERNAMES.has(cleanUsername)) {
    errors.push('That username is reserved. Please choose another.');
  }

  if (!displayName || !String(displayName).trim()) {
    errors.push('A display name is required.');
  } else if (String(displayName).trim().length > 50) {
    errors.push('Your display name must be 50 characters or fewer.');
  }

  if (!EMAIL_PATTERN.test(String(email || '').trim())) {
    errors.push('A valid email address is required.');
  }

  if (String(password || '').length < MIN_PASSWORD_LENGTH) {
    errors.push(`Your password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
  }

  return errors;
}

function register({ username, displayName, email, password }) {
  const errors = validate({ username, displayName, email, password });
  if (errors.length) throw new AuthError(errors.join(' '), 422);

  const cleanUsername = String(username).trim().toLowerCase();
  const cleanEmail = String(email).trim().toLowerCase();

  if (db.prepare('SELECT id FROM users WHERE username = ?').get(cleanUsername)) {
    throw new AuthError('That username is already taken.', 409);
  }

  if (db.prepare('SELECT id FROM users WHERE email = ?').get(cleanEmail)) {
    throw new AuthError('An account with that email already exists.', 409);
  }

  const hash = bcrypt.hashSync(String(password), BCRYPT_ROUNDS);

  // Pick an avatar deterministically from the username, so the same person
  // gets the same face every time the database is reseeded.
  const seed = [...cleanUsername].reduce((sum, ch) => sum + ch.charCodeAt(0), 0);

  const result = db
    .prepare(
      `INSERT INTO users
         (username, display_name, email, password_hash, avatar_emoji, avatar_colour)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(
      cleanUsername,
      String(displayName).trim(),
      cleanEmail,
      hash,
      AVATARS[seed % AVATARS.length],
      COLOURS[seed % COLOURS.length]
    );

  return publicUser(result.lastInsertRowid);
}

/** Accepts either a username or an email in the same field. */
function login({ identifier, password }) {
  const key = String(identifier || '').trim().toLowerCase();

  const user = db
    .prepare('SELECT * FROM users WHERE username = ? OR email = ?')
    .get(key, key);

  // Compare against a dummy hash when no user was found, so a missing
  // account is not measurably faster to reject than a wrong password.
  const hash = user
    ? user.password_hash
    : '$2a$12$abcdefghijklmnopqrstuvwxyz012345678901234567890123456';

  const matches = bcrypt.compareSync(String(password || ''), hash);

  if (!user || !matches) {
    throw new AuthError('Those details are not correct.', 401);
  }

  return publicUser(user.id);
}

function publicUser(id) {
  return db
    .prepare(
      `SELECT id, username, display_name, email, bio, location,
              avatar_emoji, avatar_colour, created_at
       FROM users WHERE id = ?`
    )
    .get(id);
}

function attachUser(req, res, next) {
  req.user = req.session?.userId ? publicUser(req.session.userId) : null;

  if (req.session?.userId && !req.user) {
    req.session.destroy(() => next());
    return;
  }

  next();
}

function requireAuth(req, res, next) {
  if (!req.user) {
    return res.status(401).json({
      error: 'Please sign in to do that.',
      code: 'AUTH_REQUIRED',
    });
  }
  next();
}

module.exports = {
  register,
  login,
  publicUser,
  attachUser,
  requireAuth,
  AuthError,
  USERNAME_PATTERN,
  RESERVED_USERNAMES,
  MIN_PASSWORD_LENGTH,
  AVATARS,
  COLOURS,
};
