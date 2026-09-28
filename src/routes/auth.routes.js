'use strict';

const express = require('express');
const { db } = require('../db');
const { register, login, publicUser, requireAuth, AuthError } = require('../auth');

const router = express.Router();

router.post('/register', (req, res) => {
  try {
    const user = register(req.body || {});
    req.session.userId = user.id;
    res.status(201).json({ user });
  } catch (error) {
    if (error instanceof AuthError) {
      return res.status(error.status).json({ error: error.message });
    }
    throw error;
  }
});

router.post('/login', (req, res) => {
  try {
    const user = login(req.body || {});

    // Rotate the session id on sign-in, or session fixation works.
    req.session.regenerate((err) => {
      if (err) return res.status(500).json({ error: 'Could not sign you in.' });
      req.session.userId = user.id;
      res.json({ user });
    });
  } catch (error) {
    if (error instanceof AuthError) {
      return res.status(error.status).json({ error: error.message });
    }
    throw error;
  }
});

router.post('/logout', (req, res) => {
  req.session.destroy(() => {
    res.clearCookie('social.sid');
    res.json({ ok: true });
  });
});

router.get('/me', (req, res) => {
  res.json({ user: req.user });
});

/** Edit your own profile. Username and email are deliberately not editable. */
router.patch('/me', requireAuth, (req, res) => {
  const { displayName, bio, location, avatarEmoji, avatarColour } = req.body || {};

  const updates = [];
  const params = [];

  if (displayName !== undefined) {
    const value = String(displayName).trim();
    if (!value || value.length > 50) {
      return res.status(422).json({
        error: 'Your display name must be between 1 and 50 characters.',
      });
    }
    updates.push('display_name = ?');
    params.push(value);
  }

  if (bio !== undefined) {
    const value = String(bio).trim();
    if (value.length > 200) {
      return res.status(422).json({ error: 'Your bio must be 200 characters or fewer.' });
    }
    updates.push('bio = ?');
    params.push(value);
  }

  if (location !== undefined) {
    const value = String(location).trim();
    if (value.length > 60) {
      return res.status(422).json({ error: 'That location is too long.' });
    }
    updates.push('location = ?');
    params.push(value);
  }

  if (avatarEmoji !== undefined) {
    // Cap the length rather than validating "is this an emoji" — the answer
    // involves surrogate pairs and skin-tone modifiers, and getting it wrong
    // rejects perfectly good characters.
    const value = String(avatarEmoji).trim().slice(0, 8);
    if (value) { updates.push('avatar_emoji = ?'); params.push(value); }
  }

  if (avatarColour !== undefined) {
    const value = String(avatarColour).trim();
    if (!/^#[0-9a-fA-F]{6}$/.test(value)) {
      return res.status(422).json({ error: 'The colour must be a hex value like #6366f1.' });
    }
    updates.push('avatar_colour = ?');
    params.push(value);
  }

  if (updates.length === 0) {
    return res.status(400).json({ error: 'Nothing to update.' });
  }

  params.push(req.user.id);
  db.prepare(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`).run(...params);

  res.json({ user: publicUser(req.user.id) });
});

module.exports = router;
