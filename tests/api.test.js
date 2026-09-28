/**
 * API tests for the social platform.
 *
 * Real server, real temporary SQLite database, no mocks — a mocked database
 * would agree that a follow was recorded when the CHECK constraint rejected
 * it, which is exactly the class of bug worth catching.
 *
 *   npm test
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'social-test-'));
process.env.DB_PATH = path.join(tempDir, 'test.db');
process.env.SESSION_SECRET = 'test-secret';

const app = require('../server');
const { db } = require('../src/db');
const { seed } = require('../src/seed');

let server;
let base;

function client() {
  let cookie = '';

  return async function call(method, url, body) {
    const response = await fetch(base + url, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(cookie ? { Cookie: cookie } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    const setCookie = response.headers.getSetCookie?.() || [];
    if (setCookie.length) cookie = setCookie.map((c) => c.split(';')[0]).join('; ');

    const data = await response.json().catch(() => null);
    return { status: response.status, data };
  };
}

/** Sign in as a seeded demo account — they all share one password. */
async function signIn(username = 'zahra') {
  const call = client();
  const { status } = await call('POST', '/api/auth/login', {
    identifier: username, password: 'demo1234',
  });
  assert.equal(status, 200, `could not sign in as ${username}`);
  return call;
}

/** Register a brand-new account and return a client signed in as them. */
let freshCounter = 0;
async function freshUser() {
  freshCounter += 1;
  const username = `fresh${freshCounter}`;

  const call = client();
  const { status } = await call('POST', '/api/auth/register', {
    username,
    displayName: `Fresh ${freshCounter}`,
    email: `${username}@example.com`,
    password: 'password123',
  });

  assert.equal(status, 201, `could not register ${username}`);
  return { call, username };
}

test.before(async () => {
  seed();
  await new Promise((resolve) => {
    server = app.listen(0, () => {
      base = `http://127.0.0.1:${server.address().port}`;
      resolve();
    });
  });
});

test.after(() => {
  server?.close();
  try { db.close(); } catch { /* already closed */ }
  fs.rmSync(tempDir, { recursive: true, force: true });
});

/* ----------------------------------------------------------------- auth */

test('an account can be registered and is signed in immediately', async () => {
  const call = client();
  const { status, data } = await call('POST', '/api/auth/register', {
    username: 'newperson', displayName: 'New Person',
    email: 'new@example.com', password: 'password123',
  });

  assert.equal(status, 201);
  assert.equal(data.user.username, 'newperson');
  assert.equal(data.user.password_hash, undefined, 'the hash must never be sent');
  assert.ok(data.user.avatar_emoji, 'an avatar is assigned on registration');
});

test('the password is hashed, not stored', async () => {
  const row = db
    .prepare('SELECT password_hash FROM users WHERE username = ?')
    .get('newperson');

  assert.ok(row.password_hash.startsWith('$2'));
  assert.ok(!row.password_hash.includes('password123'));
});

test('usernames are normalised to lowercase', async () => {
  const call = client();
  await call('POST', '/api/auth/register', {
    username: 'MixedCase', displayName: 'Mixed',
    email: 'mixed@example.com', password: 'password123',
  });

  const row = db.prepare('SELECT username FROM users WHERE email = ?').get('mixed@example.com');
  assert.equal(row.username, 'mixedcase');
});

test('reserved usernames are refused', async () => {
  const call = client();
  const { status, data } = await call('POST', '/api/auth/register', {
    username: 'admin', displayName: 'Nope',
    email: 'admin@example.com', password: 'password123',
  });

  assert.equal(status, 422);
  assert.match(data.error, /reserved/i);
});

test('invalid usernames are refused', async () => {
  const call = client();

  for (const username of ['ab', 'has spaces', 'Has-Dashes', 'x'.repeat(30)]) {
    const { status } = await call('POST', '/api/auth/register', {
      username, displayName: 'X', email: `${Date.now()}@example.com`,
      password: 'password123',
    });
    assert.equal(status, 422, `${username} should be rejected`);
  }
});

test('a duplicate username is refused', async () => {
  const call = client();
  const { status } = await call('POST', '/api/auth/register', {
    username: 'zahra', displayName: 'Impostor',
    email: 'impostor@example.com', password: 'password123',
  });
  assert.equal(status, 409);
});

test('sign-in works with either a username or an email', async () => {
  const byUsername = client();
  const byEmail = client();

  const a = await byUsername('POST', '/api/auth/login', {
    identifier: 'priya', password: 'demo1234',
  });
  const b = await byEmail('POST', '/api/auth/login', {
    identifier: 'priya@codealpha.tech', password: 'demo1234',
  });

  assert.equal(a.status, 200);
  assert.equal(b.status, 200);
  assert.equal(a.data.user.id, b.data.user.id);
});

test('a bad password does not reveal whether the account exists', async () => {
  const call = client();

  const wrongPassword = await call('POST', '/api/auth/login', {
    identifier: 'zahra', password: 'notthepassword',
  });
  const noSuchUser = await call('POST', '/api/auth/login', {
    identifier: 'ghostaccount', password: 'notthepassword',
  });

  assert.equal(wrongPassword.status, 401);
  assert.equal(noSuchUser.status, 401);
  assert.equal(wrongPassword.data.error, noSuchUser.data.error);
});

/* ---------------------------------------------------------------- posts */

test('the public timeline is visible without signing in', async () => {
  const call = client();
  const { status, data } = await call('GET', '/api/posts');

  assert.equal(status, 200);
  assert.equal(data.scope, 'everyone', 'anonymous visitors see everyone');
  assert.ok(data.posts.length > 0);
});

test('posting requires authentication', async () => {
  const call = client();
  const { status, data } = await call('POST', '/api/posts', { body: 'hello' });

  assert.equal(status, 401);
  assert.equal(data.code, 'AUTH_REQUIRED');
});

test('a post can be created and comes back with author details', async () => {
  const call = await signIn('zahra');
  const { status, data } = await call('POST', '/api/posts', {
    body: 'Testing the posting endpoint.',
  });

  assert.equal(status, 201);
  assert.equal(data.post.body, 'Testing the posting endpoint.');
  assert.equal(data.post.username, 'zahra');
  assert.equal(data.post.like_count, 0);
  assert.equal(data.post.liked_by_me, false);
});

test('an empty post is refused', async () => {
  const call = await signIn('zahra');
  const { status } = await call('POST', '/api/posts', { body: '    ' });
  assert.equal(status, 422);
});

test('an over-long post is refused with the length in the message', async () => {
  const call = await signIn('zahra');
  const { status, data } = await call('POST', '/api/posts', { body: 'x'.repeat(501) });

  assert.equal(status, 422);
  assert.match(data.error, /501/);
});

test('post bodies are stored verbatim, so escaping is the frontend’s job', async () => {
  const call = await signIn('zahra');
  const payload = '<script>alert("xss")</script>';

  const { data } = await call('POST', '/api/posts', { body: payload });

  // The API must not silently mangle what someone wrote. The defence is
  // escapeHtml() before innerHTML in the browser, which is where the risk
  // actually lives — an API that strips tags breaks legitimate code snippets.
  assert.equal(data.post.body, payload);
});

test('you can delete your own post', async () => {
  const call = await signIn('marcus');
  const { data } = await call('POST', '/api/posts', { body: 'Temporary post.' });

  const { status } = await call('DELETE', `/api/posts/${data.post.id}`);
  assert.equal(status, 200);

  const gone = await call('GET', `/api/posts/${data.post.id}`);
  assert.equal(gone.status, 404);
});

test('you cannot delete somebody else’s post', async () => {
  const marcus = await signIn('marcus');
  const priya = await signIn('priya');

  const { data } = await marcus('POST', '/api/posts', { body: 'Marcus owns this.' });
  const attempt = await priya('DELETE', `/api/posts/${data.post.id}`);

  assert.equal(attempt.status, 404, 'not 403 — do not confirm it exists');

  const still = await marcus('GET', `/api/posts/${data.post.id}`);
  assert.equal(still.status, 200, 'the post survives');
});

test('deleting a post removes its comments and likes', async () => {
  const call = await signIn('devon');
  const { data } = await call('POST', '/api/posts', { body: 'Cascade test.' });
  const postId = data.post.id;

  await call('POST', `/api/posts/${postId}/comments`, { body: 'A comment' });
  await call('POST', `/api/posts/${postId}/like`);

  await call('DELETE', `/api/posts/${postId}`);

  const comments = db
    .prepare('SELECT COUNT(*) AS n FROM comments WHERE post_id = ?').get(postId).n;
  const likes = db
    .prepare('SELECT COUNT(*) AS n FROM likes WHERE post_id = ?').get(postId).n;

  assert.equal(comments, 0, 'ON DELETE CASCADE needs foreign_keys = ON');
  assert.equal(likes, 0);
});

/* ---------------------------------------------------------------- likes */

test('liking toggles, and the count follows', async () => {
  const call = await signIn('linh');
  const { data: created } = await call('POST', '/api/posts', { body: 'Like me.' });
  const postId = created.post.id;

  const liked = await call('POST', `/api/posts/${postId}/like`);
  assert.equal(liked.data.liked, true);
  assert.equal(liked.data.likeCount, 1);

  const unliked = await call('POST', `/api/posts/${postId}/like`);
  assert.equal(unliked.data.liked, false);
  assert.equal(unliked.data.likeCount, 0);
});

test('liking twice cannot produce two likes', async () => {
  const call = await signIn('aisha');
  const { data } = await call('POST', '/api/posts', { body: 'Double tap.' });
  const postId = data.post.id;

  await call('POST', `/api/posts/${postId}/like`);
  await call('POST', `/api/posts/${postId}/like`);
  await call('POST', `/api/posts/${postId}/like`);

  const rows = db
    .prepare('SELECT COUNT(*) AS n FROM likes WHERE post_id = ?').get(postId).n;

  assert.ok(rows <= 1, 'the composite primary key makes this impossible');
});

test('liked_by_me is correct per viewer', async () => {
  const zahra = await signIn('zahra');
  const priya = await signIn('priya');

  const { data } = await zahra('POST', '/api/posts', { body: 'Whose like is it anyway.' });
  await zahra('POST', `/api/posts/${data.post.id}/like`);

  const asZahra = await zahra('GET', `/api/posts/${data.post.id}`);
  const asPriya = await priya('GET', `/api/posts/${data.post.id}`);

  assert.equal(asZahra.data.post.liked_by_me, true);
  assert.equal(asPriya.data.post.liked_by_me, false);
  assert.equal(asZahra.data.post.like_count, asPriya.data.post.like_count);
});

test('liking requires authentication', async () => {
  const call = client();
  const { status } = await call('POST', '/api/posts/1/like');
  assert.equal(status, 401);
});

/* ------------------------------------------------------------- comments */

test('a comment can be added and the count updates', async () => {
  const call = await signIn('priya');
  const { data: created } = await call('POST', '/api/posts', { body: 'Comment on me.' });

  const { status, data } = await call(
    'POST', `/api/posts/${created.post.id}/comments`, { body: 'First!' }
  );

  assert.equal(status, 201);
  assert.equal(data.comment.body, 'First!');
  assert.equal(data.comment.username, 'priya');
  assert.equal(data.commentCount, 1);
});

test('an empty comment is refused', async () => {
  const call = await signIn('priya');
  const { data: created } = await call('POST', '/api/posts', { body: 'Host post.' });

  const { status } = await call(
    'POST', `/api/posts/${created.post.id}/comments`, { body: '   ' }
  );
  assert.equal(status, 422);
});

test('commenting on a post that does not exist is a 404', async () => {
  const call = await signIn('priya');
  const { status } = await call('POST', '/api/posts/999999/comments', { body: 'Hello?' });
  assert.equal(status, 404);
});

test('a post author can delete a comment on their own post', async () => {
  const author = await signIn('marcus');
  const commenter = await signIn('devon');

  const { data: created } = await author('POST', '/api/posts', { body: 'My post, my rules.' });
  const { data: comment } = await commenter(
    'POST', `/api/posts/${created.post.id}/comments`, { body: 'Unwanted reply' }
  );

  // Not the comment's author, but the post's — moderation of your own space
  // should not require waiting for a moderator.
  const { status } = await author(
    'DELETE', `/api/posts/${created.post.id}/comments/${comment.comment.id}`
  );

  assert.equal(status, 200);
});

test('an unrelated user cannot delete a comment', async () => {
  const author = await signIn('marcus');
  const commenter = await signIn('devon');
  const stranger = await signIn('linh');

  const { data: created } = await author('POST', '/api/posts', { body: 'Another post.' });
  const { data: comment } = await commenter(
    'POST', `/api/posts/${created.post.id}/comments`, { body: 'A reply' }
  );

  const { status } = await stranger(
    'DELETE', `/api/posts/${created.post.id}/comments/${comment.comment.id}`
  );

  assert.equal(status, 404);
});

/* -------------------------------------------------------------- follows */

test('following toggles and updates the follower count', async () => {
  const { call } = await freshUser();

  const followed = await call('POST', '/api/users/marcus/follow');
  assert.equal(followed.data.following, true);

  const unfollowed = await call('POST', '/api/users/marcus/follow');
  assert.equal(unfollowed.data.following, false);
  assert.equal(unfollowed.data.followerCount, followed.data.followerCount - 1);
});

test('you cannot follow yourself', async () => {
  const call = await signIn('zahra');
  const { status, data } = await call('POST', '/api/users/zahra/follow');

  assert.equal(status, 400);
  assert.match(data.error, /yourself/i);
});

test('the schema refuses a self-follow even if the route is bypassed', async () => {
  const zahra = db.prepare('SELECT id FROM users WHERE username = ?').get('zahra');

  assert.throws(
    () => db.prepare('INSERT INTO follows (follower_id, followee_id) VALUES (?, ?)')
            .run(zahra.id, zahra.id),
    /CHECK constraint/i,
    'the guarantee lives in the schema, not only in the endpoint'
  );
});

test('following someone who does not exist is a 404', async () => {
  const call = await signIn('zahra');
  const { status } = await call('POST', '/api/users/nobodyhere/follow');
  assert.equal(status, 404);
});

test('the feed contains posts from people you follow', async () => {
  const { call } = await freshUser();

  await call('POST', '/api/users/marcus/follow');

  const marcus = await signIn('marcus');
  const { data: created } = await marcus('POST', '/api/posts', {
    body: 'A post that should reach my followers.',
  });

  const { data } = await call('GET', '/api/posts?scope=following');
  const ids = data.posts.map((p) => p.id);

  assert.ok(ids.includes(created.post.id));
});

test('the feed includes your own posts', async () => {
  const { call } = await freshUser();
  const { data: created } = await call('POST', '/api/posts', { body: 'My own post.' });

  const { data } = await call('GET', '/api/posts?scope=following');

  // A new user who has posted once and follows nobody should not see an
  // empty feed and conclude the app is broken.
  assert.ok(data.posts.map((p) => p.id).includes(created.post.id));
});

test('the feed excludes posts from people you do not follow', async () => {
  const loner = client();
  await loner('POST', '/api/auth/register', {
    username: 'loner', displayName: 'Loner',
    email: 'loner@example.com', password: 'password123',
  });

  const { data } = await loner('GET', '/api/posts?scope=following');

  assert.ok(
    data.posts.every((post) => post.username === 'loner'),
    'only their own posts, and they have none'
  );
});

/* ------------------------------------------------------------- profiles */

test('a profile carries counts and the viewer’s follow state', async () => {
  const call = await signIn('aisha');
  const { status, data } = await call('GET', '/api/users/zahra');

  assert.equal(status, 200);
  assert.equal(data.profile.username, 'zahra');
  assert.ok(data.profile.post_count > 0);
  assert.equal(typeof data.profile.followed_by_me, 'boolean');
  assert.equal(data.profile.is_me, false);
  assert.equal(data.profile.password_hash, undefined);
});

test('your own profile is marked is_me', async () => {
  const call = await signIn('zahra');
  const { data } = await call('GET', '/api/users/zahra');
  assert.equal(data.profile.is_me, true);
});

test('an unknown profile is a 404', async () => {
  const call = client();
  const { status } = await call('GET', '/api/users/doesnotexist');
  assert.equal(status, 404);
});

test('a profile can be updated', async () => {
  const call = await signIn('linh');
  const { status, data } = await call('PATCH', '/api/auth/me', {
    displayName: 'Linh T.',
    bio: 'Updated bio.',
    location: 'Ha Noi',
  });

  assert.equal(status, 200);
  assert.equal(data.user.display_name, 'Linh T.');
  assert.equal(data.user.bio, 'Updated bio.');
});

test('an over-long bio is refused', async () => {
  const call = await signIn('linh');
  const { status } = await call('PATCH', '/api/auth/me', { bio: 'x'.repeat(201) });
  assert.equal(status, 422);
});

test('user search matches username and display name', async () => {
  const call = client();

  const byUsername = await call('GET', '/api/users?search=zahra');
  const byName = await call('GET', '/api/users?search=Nair');

  assert.ok(byUsername.data.users.some((u) => u.username === 'zahra'));
  assert.ok(byName.data.users.some((u) => u.username === 'priya'));
});

test('suggestions exclude yourself and people you already follow', async () => {
  const call = await signIn('zahra');
  const { data } = await call('GET', '/api/users/suggestions');

  const following = db
    .prepare(
      `SELECT u.username FROM follows f JOIN users u ON u.id = f.followee_id
       WHERE f.follower_id = (SELECT id FROM users WHERE username = 'zahra')`
    )
    .all()
    .map((row) => row.username);

  for (const user of data.users) {
    assert.notEqual(user.username, 'zahra');
    assert.ok(!following.includes(user.username));
  }
});

/* ------------------------------------------------------------ plumbing */

test('an unknown API path returns JSON, not the HTML shell', async () => {
  const call = client();
  const { status, data } = await call('GET', '/api/nothing-here');

  assert.equal(status, 404);
  assert.ok(data.error);
});

test('the health endpoint reports real counts', async () => {
  const call = client();
  const { data } = await call('GET', '/api/health');

  assert.ok(data.counts.users >= 6);
  assert.ok(data.counts.posts >= 14);
  assert.ok(data.counts.follows >= 20);
});
