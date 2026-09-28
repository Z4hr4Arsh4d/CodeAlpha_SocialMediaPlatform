# CodeAlpha Task 2 — Social Media Platform

A working mini social network: profiles, posts, comments, likes and a
follow-based feed.

**Stack:** Express.js · SQLite · vanilla HTML/CSS/JavaScript — no framework,
no build step.

---

## Run it

Requires **Node 18 or newer** (check with `node --version`).

```bash
npm install
npm run seed      # 6 accounts, 14 posts, 15 comments, 49 likes, 20 follows
npm start
```

Open **http://localhost:4000**

**Demo accounts** — every seeded account uses the password `demo1234`:

| Username | Who |
|---|---|
| `zahra` | Full-stack intern |
| `priya` | Backend engineer |
| `marcus` | Design systems |
| `aisha` | Learning in public |
| `devon` | DevOps |
| `linh` | Frontend / accessibility |

```bash
npm test          # 42 API tests
npm run reset     # wipe and reload the demo network
```

> Run this alongside Task 1 if you like — the store uses port 3000, this uses
> 4000, so they do not collide.

---

## Brief requirements

| Required | Where |
|---|---|
| User profiles | `/u/:username` — bio, location, avatar, counts, editable |
| Posts | `/` — composer with live character count, Ctrl+Enter to post |
| Comments | `/p/:id` — threaded under each post, deletable |
| Like system | Toggle on every post card, optimistic UI |
| Follow system | Toggle on profiles and the people directory |
| Database for users, posts, comments, followers | SQLite, 5 tables, foreign keys enforced |

---

## How it is put together

```
server.js              Express app, sessions, pretty URLs (/u/:name, /p/:id)
src/
  db.js                Schema and the feed / profile queries
  auth.js              Registration, login, session middleware
  seed.js              A small but genuinely connected demo network
  routes/
    auth.routes.js     register · login · logout · me · edit profile
    posts.routes.js    feed · create · delete · like · comments
    users.routes.js    directory · suggestions · profile · follow · followers
public/
  index.html           Feed, composer, who-to-follow
  profile.html         /u/:username
  post.html            /p/:id — single post and its comment thread
  explore.html         People directory with search
  login.html           Sign in / create account
  css/styles.css       One stylesheet, light and dark
  js/api.js            Shared helpers — and the single post-card renderer
  js/*.js              One script per page
tests/api.test.js      42 tests against a real server
```

---

## Decisions worth explaining

**A like is a relationship, not a counter.** `likes` is a join table with a
composite primary key on `(user_id, post_id)`. Storing a number on the post
would make "have I liked this?" unanswerable and double-likes impossible to
prevent; the composite key makes liking twice a no-op *at the database level*
rather than an application rule somebody has to remember. There is a test
that likes the same post three times and asserts at most one row exists.

**Following yourself is blocked in the schema.** `CHECK (follower_id !=
followee_id)` on the `follows` table. The endpoint also returns a friendly
message, but the constraint is the actual guarantee — and there is a test
that bypasses the route entirely and asserts the database still refuses.

**Every post query carries the viewer's id.** `like_count`, `comment_count`
and `liked_by_me` come back in the same pass as the post, via correlated
subqueries. The alternative — fetching posts and then asking "did I like
this?" once per row — is the N+1 query problem, and it is the reason feeds
get slow.

**The feed includes your own posts.** A new user who has posted once and
follows nobody should not see an empty screen and conclude the app is broken.

**Anonymous visitors see the public timeline, not a locked door.** Showing a
"follow some people" empty state to someone who cannot follow anybody is a
dead end that makes the whole app look broken from the front door.

**Likes update optimistically.** The heart fills immediately and rolls back
if the request fails. Waiting for a round trip before anything moves makes an
app feel broken; a like is cheap enough to be worth the optimism. The server's
count then overwrites the guess, in case somebody else liked it in the same
second.

**A post author can delete comments on their own post.** Not just their own
comments — someone should be able to remove an unpleasant reply from under
their own post without waiting for a moderator.

**Deletions return 404, not 403.** Confirming that a post exists but belongs
to someone else is information the requester has not earned. The ownership
check lives in the `WHERE` clause, so there is no code path that deletes the
wrong row and then regrets it.

**Escaping happens in the browser, not the API.** Post bodies are stored
exactly as written — an API that strips tags breaks every legitimate code
snippet. The defence is `escapeHtml()` before anything reaches `innerHTML`,
which is where the risk actually lives. There is a test that posts a
`<script>` tag and asserts the API returns it unchanged.

---

## API

| Method | Path | Notes |
|---|---|---|
| `POST` | `/api/auth/register` | `{username, displayName, email, password}` |
| `POST` | `/api/auth/login` | `{identifier, password}` — username **or** email |
| `POST` | `/api/auth/logout` | |
| `GET` | `/api/auth/me` | Current user or `null` |
| `PATCH` | `/api/auth/me` | 🔒 Edit display name, bio, location, avatar |
| `GET` | `/api/posts` | `?scope=following\|everyone &page= &limit=` |
| `POST` | `/api/posts` | 🔒 `{body}` — 500 characters |
| `GET` | `/api/posts/:id` | Post plus its comments |
| `DELETE` | `/api/posts/:id` | 🔒 Author only |
| `POST` | `/api/posts/:id/like` | 🔒 Toggle |
| `GET` | `/api/posts/:id/likes` | Who liked it |
| `GET` | `/api/posts/:id/comments` | |
| `POST` | `/api/posts/:id/comments` | 🔒 `{body}` — 300 characters |
| `DELETE` | `/api/posts/:postId/comments/:id` | 🔒 Comment author or post author |
| `GET` | `/api/users` | `?search=` — directory |
| `GET` | `/api/users/suggestions` | 🔒 Who to follow |
| `GET` | `/api/users/:username` | Profile plus posts |
| `POST` | `/api/users/:username/follow` | 🔒 Toggle |
| `GET` | `/api/users/:username/followers` | |
| `GET` | `/api/users/:username/following` | |
| `GET` | `/api/health` | Counts |

🔒 = requires a session. Returns `401 {code: "AUTH_REQUIRED"}` otherwise.

---

## Tests

```bash
npm test
```

42 tests against a real Express server and a real temporary SQLite database.

They cover password hashing, reserved and malformed usernames, timing-safe
login messages, sign-in by username or email, post length limits, delete
authorisation, cascade deletion of comments and likes, like toggling and
double-like prevention, per-viewer `liked_by_me`, comment moderation rights,
follow toggling, the self-follow CHECK constraint, feed composition
(includes your own posts, excludes strangers'), profile editing limits, and
user search.

---

## Configuration

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `4000` | Server port |
| `SESSION_SECRET` | dev default | **Change before deploying** |
| `DB_PATH` | `./data/social.db` | SQLite file |
| `NODE_ENV` | `development` | `production` requires HTTPS for cookies |

---

## What this would need before production

- **Real-time updates.** The brief's bonus suggestion. Likes and comments
  need a refresh; WebSockets would make them live.
- **Images.** Text posts only. Uploads mean storage, resizing and
  content scanning.
- **Pagination in the UI.** The API pages; the feed loads 30 and stops.
  Infinite scroll or a "load more" button is the next step.
- **Notifications.** Nothing tells you when somebody follows or replies.
- **Blocking and reporting.** A social platform without them is not one.
- **Rate limiting.** Nothing stops a script posting a thousand times a minute.

---

**Zahra Arshad** · CodeAlpha Full Stack Development Internship
