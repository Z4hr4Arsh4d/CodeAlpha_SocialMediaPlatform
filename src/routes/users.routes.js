'use strict';

const express = require('express');
const { db, getProfile, getUserPosts } = require('../db');
const { requireAuth } = require('../auth');

const router = express.Router();

/** Directory / people search. */
router.get('/', (req, res) => {
  const search = String(req.query.search || '').trim();
  const viewer = req.user?.id ?? null;
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 24, 1), 50);

  const where = [];
  const params = { viewer, limit };

  if (search) {
    where.push('(u.username LIKE @term OR u.display_name LIKE @term)');
    params.term = `%${search}%`;
  }

  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const users = db
    .prepare(
      `SELECT
         u.id, u.username, u.display_name, u.bio,
         u.avatar_emoji, u.avatar_colour,
         (SELECT COUNT(*) FROM posts   p WHERE p.user_id = u.id)     AS post_count,
         (SELECT COUNT(*) FROM follows f WHERE f.followee_id = u.id) AS follower_count,
         EXISTS(SELECT 1 FROM follows f
                WHERE f.followee_id = u.id AND f.follower_id = @viewer) AS followed_by_me
       FROM users u
       ${clause}
       ORDER BY follower_count DESC, u.id ASC
       LIMIT @limit`
    )
    .all(params)
    .map((user) => ({
      ...user,
      followed_by_me: Boolean(user.followed_by_me),
      is_me: viewer != null && user.id === viewer,
    }));

  res.json({ users });
});

/**
 * Who to follow — people the viewer does not already follow, ranked by
 * followers. Excludes the viewer, since following yourself is blocked at
 * the schema level anyway.
 */
router.get('/suggestions', requireAuth, (req, res) => {
  const users = db
    .prepare(
      `SELECT
         u.id, u.username, u.display_name, u.bio,
         u.avatar_emoji, u.avatar_colour,
         (SELECT COUNT(*) FROM follows f WHERE f.followee_id = u.id) AS follower_count
       FROM users u
       WHERE u.id != @me
         AND u.id NOT IN (SELECT followee_id FROM follows WHERE follower_id = @me)
       ORDER BY follower_count DESC, RANDOM()
       LIMIT 5`
    )
    .all({ me: req.user.id });

  res.json({ users });
});

/** A profile and its posts. */
router.get('/:username', (req, res) => {
  const viewer = req.user?.id ?? null;
  const profile = getProfile(String(req.params.username).toLowerCase(), viewer);

  if (!profile) {
    return res.status(404).json({ error: 'There is no account with that username.' });
  }

  const posts = getUserPosts({ author: profile.id, viewer, limit: 50, offset: 0 });

  res.json({ profile, posts });
});

/**
 * POST /api/users/:username/follow — toggle.
 *
 * Following yourself is rejected here with a clear message, but the CHECK
 * constraint in the schema is the real guarantee — this is the friendly
 * error, not the enforcement.
 */
router.post('/:username/follow', requireAuth, (req, res) => {
  const target = db
    .prepare('SELECT id, username, display_name FROM users WHERE username = ?')
    .get(String(req.params.username).toLowerCase());

  if (!target) {
    return res.status(404).json({ error: 'There is no account with that username.' });
  }

  if (target.id === req.user.id) {
    return res.status(400).json({ error: 'You cannot follow yourself.' });
  }

  const existing = db
    .prepare('SELECT 1 FROM follows WHERE follower_id = ? AND followee_id = ?')
    .get(req.user.id, target.id);

  if (existing) {
    db.prepare('DELETE FROM follows WHERE follower_id = ? AND followee_id = ?')
      .run(req.user.id, target.id);
  } else {
    db.prepare('INSERT INTO follows (follower_id, followee_id) VALUES (?, ?)')
      .run(req.user.id, target.id);
  }

  const followerCount = db
    .prepare('SELECT COUNT(*) AS n FROM follows WHERE followee_id = ?')
    .get(target.id).n;

  res.json({ following: !existing, followerCount, username: target.username });
});

router.get('/:username/followers', (req, res) => {
  const viewer = req.user?.id ?? null;

  const users = db
    .prepare(
      `SELECT u.id, u.username, u.display_name, u.bio,
              u.avatar_emoji, u.avatar_colour,
              EXISTS(SELECT 1 FROM follows f2
                     WHERE f2.followee_id = u.id AND f2.follower_id = @viewer) AS followed_by_me
       FROM follows f
       JOIN users u ON u.id = f.follower_id
       WHERE f.followee_id = (SELECT id FROM users WHERE username = @username)
       ORDER BY f.followed_at DESC`
    )
    .all({ username: String(req.params.username).toLowerCase(), viewer })
    .map((u) => ({ ...u, followed_by_me: Boolean(u.followed_by_me) }));

  res.json({ users });
});

router.get('/:username/following', (req, res) => {
  const viewer = req.user?.id ?? null;

  const users = db
    .prepare(
      `SELECT u.id, u.username, u.display_name, u.bio,
              u.avatar_emoji, u.avatar_colour,
              EXISTS(SELECT 1 FROM follows f2
                     WHERE f2.followee_id = u.id AND f2.follower_id = @viewer) AS followed_by_me
       FROM follows f
       JOIN users u ON u.id = f.followee_id
       WHERE f.follower_id = (SELECT id FROM users WHERE username = @username)
       ORDER BY f.followed_at DESC`
    )
    .all({ username: String(req.params.username).toLowerCase(), viewer })
    .map((u) => ({ ...u, followed_by_me: Boolean(u.followed_by_me) }));

  res.json({ users });
});

module.exports = router;
