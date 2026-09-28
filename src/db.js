/**
 * Database layer — schema and the queries complex enough to deserve a name.
 *
 * The interesting design problem in a social app is not storing posts; it is
 * answering "does the person reading this already like it, and do they
 * follow the author" without running two extra queries per row. Every query
 * below that returns posts carries the viewer's id so those flags come back
 * in the same pass.
 */

'use strict';

const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const DB_PATH = process.env.DB_PATH
  || path.join(__dirname, '..', 'data', 'social.db');

fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new Database(DB_PATH);

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');   // OFF by default — every CASCADE below needs it

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    username      TEXT    NOT NULL UNIQUE COLLATE NOCASE,
    display_name  TEXT    NOT NULL,
    email         TEXT    NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT    NOT NULL,
    bio           TEXT    NOT NULL DEFAULT '',
    location      TEXT    NOT NULL DEFAULT '',
    avatar_emoji  TEXT    NOT NULL DEFAULT '🙂',
    avatar_colour TEXT    NOT NULL DEFAULT '#6366f1',
    created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS posts (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    body       TEXT    NOT NULL,
    created_at TEXT    NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS comments (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    post_id    INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    body       TEXT    NOT NULL,
    created_at TEXT    NOT NULL DEFAULT (datetime('now'))
  );

  -- A like is the RELATIONSHIP between a user and a post, not a counter on
  -- the post. Storing a number would make "have I liked this?" unanswerable
  -- and double-likes impossible to prevent; the composite primary key makes
  -- liking twice a no-op at the database level rather than an application
  -- rule somebody has to remember.
  CREATE TABLE IF NOT EXISTS likes (
    user_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    post_id   INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
    liked_at  TEXT    NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (user_id, post_id)
  );

  CREATE TABLE IF NOT EXISTS follows (
    follower_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    followee_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    followed_at TEXT    NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (follower_id, followee_id),
    -- Following yourself would put your own posts in your feed twice and
    -- inflate your follower count. Refuse it in the schema, not in a
    -- validator that a future endpoint might forget to call.
    CHECK (follower_id != followee_id)
  );

  CREATE INDEX IF NOT EXISTS idx_posts_user     ON posts(user_id, id DESC);
  CREATE INDEX IF NOT EXISTS idx_posts_recent   ON posts(id DESC);
  CREATE INDEX IF NOT EXISTS idx_comments_post  ON comments(post_id, id);
  CREATE INDEX IF NOT EXISTS idx_likes_post     ON likes(post_id);
  CREATE INDEX IF NOT EXISTS idx_follows_followee ON follows(followee_id);
`);

/**
 * The columns every post needs, with counts and the viewer's own state.
 *
 * `liked_by_me` is a correlated subquery rather than a LEFT JOIN, so it stays
 * correct when the viewer is anonymous (?viewer = null yields 0) without a
 * second code path.
 */
const POST_COLUMNS = `
  p.id,
  p.body,
  p.created_at,
  u.id           AS author_id,
  u.username,
  u.display_name,
  u.avatar_emoji,
  u.avatar_colour,
  (SELECT COUNT(*) FROM likes    l WHERE l.post_id = p.id) AS like_count,
  (SELECT COUNT(*) FROM comments c WHERE c.post_id = p.id) AS comment_count,
  EXISTS(SELECT 1 FROM likes l WHERE l.post_id = p.id AND l.user_id = @viewer)
    AS liked_by_me
`;

/**
 * The home feed: the viewer's own posts plus everyone they follow.
 *
 * Including your own posts matters — a new user who has posted once and
 * follows nobody should not see an empty feed and conclude the app is broken.
 */
const feedQuery = db.prepare(`
  SELECT ${POST_COLUMNS}
  FROM posts p
  JOIN users u ON u.id = p.user_id
  WHERE p.user_id = @viewer
     OR p.user_id IN (SELECT followee_id FROM follows WHERE follower_id = @viewer)
  ORDER BY p.id DESC
  LIMIT @limit OFFSET @offset
`);

/** Everything, newest first — the Explore tab, and the anonymous view. */
const publicTimelineQuery = db.prepare(`
  SELECT ${POST_COLUMNS}
  FROM posts p
  JOIN users u ON u.id = p.user_id
  ORDER BY p.id DESC
  LIMIT @limit OFFSET @offset
`);

const userPostsQuery = db.prepare(`
  SELECT ${POST_COLUMNS}
  FROM posts p
  JOIN users u ON u.id = p.user_id
  WHERE p.user_id = @author
  ORDER BY p.id DESC
  LIMIT @limit OFFSET @offset
`);

const singlePostQuery = db.prepare(`
  SELECT ${POST_COLUMNS}
  FROM posts p
  JOIN users u ON u.id = p.user_id
  WHERE p.id = @id
`);

const commentsQuery = db.prepare(`
  SELECT
    c.id, c.body, c.created_at,
    u.id AS author_id, u.username, u.display_name,
    u.avatar_emoji, u.avatar_colour
  FROM comments c
  JOIN users u ON u.id = c.user_id
  WHERE c.post_id = ?
  ORDER BY c.id ASC
`);

/** SQLite has no booleans; normalise 0/1 before it reaches the browser. */
function normalisePost(post) {
  if (!post) return null;
  return { ...post, liked_by_me: Boolean(post.liked_by_me) };
}

function getFeed({ viewer, limit = 20, offset = 0 }) {
  return feedQuery.all({ viewer, limit, offset }).map(normalisePost);
}

function getPublicTimeline({ viewer, limit = 20, offset = 0 }) {
  return publicTimelineQuery.all({ viewer, limit, offset }).map(normalisePost);
}

function getUserPosts({ author, viewer, limit = 20, offset = 0 }) {
  return userPostsQuery.all({ author, viewer, limit, offset }).map(normalisePost);
}

function getPost(id, viewer) {
  return normalisePost(singlePostQuery.get({ id, viewer }));
}

function getComments(postId) {
  return commentsQuery.all(postId);
}

/** A profile, with counts and whether the viewer follows them. */
function getProfile(username, viewer) {
  const profile = db
    .prepare(
      `SELECT
         u.id, u.username, u.display_name, u.bio, u.location,
         u.avatar_emoji, u.avatar_colour, u.created_at,
         (SELECT COUNT(*) FROM posts   p WHERE p.user_id = u.id)     AS post_count,
         (SELECT COUNT(*) FROM follows f WHERE f.followee_id = u.id) AS follower_count,
         (SELECT COUNT(*) FROM follows f WHERE f.follower_id = u.id) AS following_count,
         EXISTS(SELECT 1 FROM follows f
                WHERE f.followee_id = u.id AND f.follower_id = @viewer) AS followed_by_me
       FROM users u
       WHERE u.username = @username`
    )
    .get({ username, viewer });

  if (!profile) return null;

  return {
    ...profile,
    followed_by_me: Boolean(profile.followed_by_me),
    is_me: viewer != null && profile.id === viewer,
  };
}

module.exports = {
  db,
  DB_PATH,
  getFeed,
  getPublicTimeline,
  getUserPosts,
  getPost,
  getComments,
  getProfile,
  normalisePost,
};
