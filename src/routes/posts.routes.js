'use strict';

const express = require('express');
const {
  db, getFeed, getPublicTimeline, getPost, getComments,
} = require('../db');
const { requireAuth } = require('../auth');

const router = express.Router();

const MAX_POST_LENGTH = 500;
const MAX_COMMENT_LENGTH = 300;

function paging(query) {
  const limit = Math.min(Math.max(parseInt(query.limit, 10) || 20, 1), 50);
  const page = Math.max(parseInt(query.page, 10) || 1, 1);
  return { limit, offset: (page - 1) * limit, page };
}

/**
 * GET /api/posts — the feed.
 *
 * ?scope=following (default when signed in) or ?scope=everyone.
 *
 * An anonymous visitor always gets the public timeline: showing an empty
 * "follow some people" screen to someone who cannot follow anybody is a dead
 * end, and the whole app looks broken from the front door.
 */
router.get('/', (req, res) => {
  const { limit, offset, page } = paging(req.query);
  const viewer = req.user?.id ?? null;

  const scope = !viewer || req.query.scope === 'everyone' ? 'everyone' : 'following';

  const posts = scope === 'everyone'
    ? getPublicTimeline({ viewer, limit, offset })
    : getFeed({ viewer, limit, offset });

  res.json({ posts, scope, pagination: { page, limit } });
});

/** POST /api/posts  { body } */
router.post('/', requireAuth, (req, res) => {
  const body = String(req.body?.body ?? '').trim();

  if (!body) {
    return res.status(422).json({ error: 'Your post cannot be empty.' });
  }
  if (body.length > MAX_POST_LENGTH) {
    return res.status(422).json({
      error: `Posts are limited to ${MAX_POST_LENGTH} characters — yours is ${body.length}.`,
    });
  }

  const result = db
    .prepare('INSERT INTO posts (user_id, body) VALUES (?, ?)')
    .run(req.user.id, body);

  res.status(201).json({ post: getPost(result.lastInsertRowid, req.user.id) });
});

/** One post, with its comments. */
router.get('/:id', (req, res) => {
  const viewer = req.user?.id ?? null;
  const post = getPost(Number(req.params.id), viewer);

  if (!post) {
    return res.status(404).json({ error: 'That post does not exist.' });
  }

  res.json({ post, comments: getComments(post.id) });
});

/** Delete your own post. Cascades to its comments and likes. */
router.delete('/:id', requireAuth, (req, res) => {
  // The author check is in the WHERE clause, not an if-statement afterwards.
  // There is then no code path that deletes somebody else's post and
  // hopefully regrets it.
  const result = db
    .prepare('DELETE FROM posts WHERE id = ? AND user_id = ?')
    .run(Number(req.params.id), req.user.id);

  if (result.changes === 0) {
    // 404 rather than 403: confirming the post exists but belongs to someone
    // else is information the requester has not earned.
    return res.status(404).json({ error: 'That post does not exist.' });
  }

  res.json({ ok: true });
});

/* ---------------------------------------------------------------- likes */

/**
 * POST /api/posts/:id/like — toggle.
 *
 * One endpoint rather than a like/unlike pair. The client does not have to
 * track which one to call, and a double tap cannot produce two likes: the
 * composite primary key on (user_id, post_id) makes that impossible anyway.
 */
router.post('/:id/like', requireAuth, (req, res) => {
  const postId = Number(req.params.id);

  const post = db.prepare('SELECT id FROM posts WHERE id = ?').get(postId);
  if (!post) {
    return res.status(404).json({ error: 'That post does not exist.' });
  }

  const existing = db
    .prepare('SELECT 1 FROM likes WHERE user_id = ? AND post_id = ?')
    .get(req.user.id, postId);

  if (existing) {
    db.prepare('DELETE FROM likes WHERE user_id = ? AND post_id = ?')
      .run(req.user.id, postId);
  } else {
    db.prepare('INSERT INTO likes (user_id, post_id) VALUES (?, ?)')
      .run(req.user.id, postId);
  }

  const count = db
    .prepare('SELECT COUNT(*) AS n FROM likes WHERE post_id = ?')
    .get(postId).n;

  res.json({ liked: !existing, likeCount: count });
});

/** Who liked this. */
router.get('/:id/likes', (req, res) => {
  const users = db
    .prepare(
      `SELECT u.id, u.username, u.display_name, u.avatar_emoji, u.avatar_colour
       FROM likes l
       JOIN users u ON u.id = l.user_id
       WHERE l.post_id = ?
       ORDER BY l.liked_at DESC`
    )
    .all(Number(req.params.id));

  res.json({ users });
});

/* ------------------------------------------------------------- comments */

router.get('/:id/comments', (req, res) => {
  res.json({ comments: getComments(Number(req.params.id)) });
});

router.post('/:id/comments', requireAuth, (req, res) => {
  const postId = Number(req.params.id);
  const body = String(req.body?.body ?? '').trim();

  if (!body) {
    return res.status(422).json({ error: 'Your comment cannot be empty.' });
  }
  if (body.length > MAX_COMMENT_LENGTH) {
    return res.status(422).json({
      error: `Comments are limited to ${MAX_COMMENT_LENGTH} characters.`,
    });
  }

  const post = db.prepare('SELECT id FROM posts WHERE id = ?').get(postId);
  if (!post) {
    return res.status(404).json({ error: 'That post does not exist.' });
  }

  const result = db
    .prepare('INSERT INTO comments (post_id, user_id, body) VALUES (?, ?, ?)')
    .run(postId, req.user.id, body);

  const comment = db
    .prepare(
      `SELECT c.id, c.body, c.created_at,
              u.id AS author_id, u.username, u.display_name,
              u.avatar_emoji, u.avatar_colour
       FROM comments c JOIN users u ON u.id = c.user_id
       WHERE c.id = ?`
    )
    .get(result.lastInsertRowid);

  const count = db
    .prepare('SELECT COUNT(*) AS n FROM comments WHERE post_id = ?')
    .get(postId).n;

  res.status(201).json({ comment, commentCount: count });
});

/**
 * Delete a comment.
 *
 * Allowed for the comment's author OR the post's author — someone should be
 * able to remove an unpleasant comment from under their own post without
 * waiting for a moderator.
 */
router.delete('/:postId/comments/:commentId', requireAuth, (req, res) => {
  const result = db
    .prepare(
      `DELETE FROM comments
       WHERE id = @commentId
         AND post_id = @postId
         AND (user_id = @me
              OR @me = (SELECT user_id FROM posts WHERE id = @postId))`
    )
    .run({
      commentId: Number(req.params.commentId),
      postId: Number(req.params.postId),
      me: req.user.id,
    });

  if (result.changes === 0) {
    return res.status(404).json({ error: 'That comment does not exist.' });
  }

  res.json({ ok: true });
});

module.exports = router;
