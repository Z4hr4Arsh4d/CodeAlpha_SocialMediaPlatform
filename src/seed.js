/**
 * Seeds demo accounts, posts, comments, likes and follows.
 *
 * An empty social app is indistinguishable from a broken one, so the demo
 * data is a small but genuinely connected network — people follow each
 * other, reply to each other, and the timestamps are spread over a fortnight
 * rather than all landing in the same second.
 *
 *   npm run seed    load if empty
 *   npm run reset   wipe and reload
 */

'use strict';

const bcrypt = require('bcryptjs');
const { db } = require('./db');

const force = process.argv.includes('--force');

const PASSWORD = 'demo1234';

const USERS = [
  {
    username: 'zahra', displayName: 'Zahra Arshad',
    email: 'zahra@codealpha.tech',
    bio: 'Full-stack intern at CodeAlpha. Currently arguing with SQLite about foreign keys.',
    location: 'Lahore, PK', avatar: '🦊', colour: '#6366f1',
  },
  {
    username: 'priya', displayName: 'Priya Nair',
    email: 'priya@codealpha.tech',
    bio: 'Backend engineer. I think about database indexes more than is healthy.',
    location: 'Bengaluru, IN', avatar: '🦉', colour: '#14b8a6',
  },
  {
    username: 'marcus', displayName: 'Marcus Bell',
    email: 'marcus@codealpha.tech',
    bio: 'Design systems, typography, and the correct amount of whitespace (more).',
    location: 'Manchester, UK', avatar: '🐙', colour: '#ec4899',
  },
  {
    username: 'aisha', displayName: 'Aisha Rahman',
    email: 'aisha@codealpha.tech',
    bio: 'Learning in public. Currently: WebSockets, and why my CSS grid collapses.',
    location: 'Dhaka, BD', avatar: '🦋', colour: '#f59e0b',
  },
  {
    username: 'devon', displayName: 'Devon Clarke',
    email: 'devon@codealpha.tech',
    bio: 'DevOps. If it is on fire I probably deployed it.',
    location: 'Toronto, CA', avatar: '🐼', colour: '#8b5cf6',
  },
  {
    username: 'linh', displayName: 'Linh Tran',
    email: 'linh@codealpha.tech',
    bio: 'Frontend. Accessibility is not a feature, it is the floor.',
    location: 'Hanoi, VN', avatar: '🐝', colour: '#ef4444',
  },
];

const POSTS = [
  ['zahra', 'Spent two hours debugging why my ON DELETE CASCADE did nothing. SQLite has foreign keys OFF by default. Two hours.', 13],
  ['priya', 'Reminder that an index is not free. Every write pays for every index on that table. Add them because a query is slow, not because a column exists.', 12],
  ['marcus', 'Unpopular opinion: most dashboards would be better as three numbers and a sentence.', 11],
  ['zahra', 'Finished the e-commerce task. The part I did not expect to be hard: making sure two people cannot buy the last item at the same time. Transactions everywhere.', 10],
  ['aisha', 'Day 40 of learning in public. Today I learned that `position: sticky` needs a parent without `overflow: hidden`. Four hours. Four.', 9],
  ['devon', 'The deploy went fine. The rollback went fine. The thing in between went less fine.', 8],
  ['linh', 'If your button only works with a mouse, it is not a button. It is a div wearing a hat.', 7],
  ['priya', 'Storing money as a float is how you end up explaining to a customer why their total is £19.999999998.', 6],
  ['zahra', 'Hot take from an intern: the hardest part of full-stack is not the stack. It is deciding what NOT to build.', 5],
  ['marcus', 'Redesigned the same settings page four times. Version one was closest. This is normal and I hate it.', 4],
  ['aisha', 'Got WebSockets working. Watching two browser windows update each other in real time never stops being a small miracle.', 3],
  ['devon', 'Postmortem finding: the alert fired correctly. Nobody had the pager. The alert was not the problem.', 2],
  ['linh', 'Screen reader users do not want a different site. They want your site, built properly.', 1],
  ['priya', 'A migration that cannot be rolled back is not a migration, it is a leap of faith with a schema attached.', 0],
];

const COMMENTS = [
  [1, 'priya', 'Every single time. I have a snippet just for that pragma now.'],
  [1, 'devon', 'Welcome to the club. Membership is mandatory and the initiation is exactly this.'],
  [2, 'zahra', 'This reframed indexes for me completely, thank you.'],
  [2, 'marcus', 'Same energy as "every component you add is a component you maintain".'],
  [3, 'linh', 'Strongly agree. Most of my dashboard work is deleting charts.'],
  [4, 'priya', 'Did you use a transaction with a stock guard in the UPDATE? That is the bit people miss.'],
  [4, 'zahra', 'Exactly that — WHERE stock >= ? so a race rolls back instead of going negative.'],
  [5, 'marcus', 'The overflow:hidden thing has cost me a genuinely embarrassing amount of my life.'],
  [5, 'linh', 'Bookmarking this for the next person who asks me why sticky is broken.'],
  [6, 'aisha', 'The honesty of this post is unmatched.'],
  [7, 'marcus', 'Putting this on a poster above my desk.'],
  [8, 'zahra', 'Integers in pence. Learned this one the correct way — before shipping.'],
  [9, 'devon', 'The best code I wrote last quarter was a deleted feature.'],
  [11, 'zahra', 'Genuinely the most fun part of the whole project.'],
  [12, 'priya', 'Alert fatigue is a design problem dressed as an ops problem.'],
];

/** Follow edges: [follower, followee] */
const FOLLOWS = [
  ['zahra', 'priya'], ['zahra', 'marcus'], ['zahra', 'linh'], ['zahra', 'devon'],
  ['priya', 'zahra'], ['priya', 'devon'], ['priya', 'linh'],
  ['marcus', 'zahra'], ['marcus', 'linh'], ['marcus', 'aisha'],
  ['aisha', 'zahra'], ['aisha', 'priya'], ['aisha', 'marcus'],
  ['aisha', 'linh'], ['aisha', 'devon'],
  ['devon', 'priya'], ['devon', 'zahra'],
  ['linh', 'marcus'], ['linh', 'aisha'], ['linh', 'priya'],
];

/** Likes: [postIndex (1-based), ...usernames] */
const LIKES = [
  [1, 'priya', 'devon', 'aisha', 'marcus', 'linh'],
  [2, 'zahra', 'devon', 'aisha', 'marcus'],
  [3, 'linh', 'zahra', 'aisha'],
  [4, 'priya', 'devon', 'marcus', 'aisha', 'linh'],
  [5, 'zahra', 'marcus', 'linh', 'priya'],
  [6, 'zahra', 'priya', 'aisha'],
  [7, 'marcus', 'aisha', 'zahra', 'priya'],
  [8, 'zahra', 'devon', 'marcus'],
  [9, 'marcus', 'aisha', 'linh', 'devon', 'priya'],
  [10, 'linh', 'zahra'],
  [11, 'zahra', 'linh', 'priya'],
  [12, 'priya', 'zahra', 'linh'],
  [13, 'marcus', 'aisha', 'zahra'],
  [14, 'devon', 'zahra'],
];

function daysAgo(days) {
  const date = new Date(Date.now() - days * 86400000 - Math.random() * 43200000);
  return date.toISOString().slice(0, 19).replace('T', ' ');
}

function seed() {
  const existing = db.prepare('SELECT COUNT(*) AS n FROM users').get().n;

  if (existing > 0 && !force) {
    console.log(`\n  There are already ${existing} accounts — nothing to do.`);
    console.log('  To wipe and reload:  npm run reset\n');
    return;
  }

  const load = db.transaction(() => {
    if (force) {
      db.exec(`
        DELETE FROM likes;
        DELETE FROM comments;
        DELETE FROM follows;
        DELETE FROM posts;
        DELETE FROM users;
      `);
      console.log('  Cleared existing data.');
    }

    const hash = bcrypt.hashSync(PASSWORD, 12);
    const ids = {};

    const insertUser = db.prepare(
      `INSERT INTO users
         (username, display_name, email, password_hash, bio, location,
          avatar_emoji, avatar_colour, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );

    for (const user of USERS) {
      const result = insertUser.run(
        user.username, user.displayName, user.email, hash,
        user.bio, user.location, user.avatar, user.colour, daysAgo(60)
      );
      ids[user.username] = result.lastInsertRowid;
    }

    const insertPost = db.prepare(
      'INSERT INTO posts (user_id, body, created_at) VALUES (?, ?, ?)'
    );

    const postIds = [];
    for (const [username, body, age] of POSTS) {
      const result = insertPost.run(ids[username], body, daysAgo(age));
      postIds.push(result.lastInsertRowid);
    }

    const insertComment = db.prepare(
      'INSERT INTO comments (post_id, user_id, body, created_at) VALUES (?, ?, ?, ?)'
    );

    for (const [postIndex, username, body] of COMMENTS) {
      insertComment.run(
        postIds[postIndex - 1], ids[username], body,
        daysAgo(Math.max(0, POSTS[postIndex - 1][2] - 0.4))
      );
    }

    const insertFollow = db.prepare(
      'INSERT INTO follows (follower_id, followee_id, followed_at) VALUES (?, ?, ?)'
    );

    for (const [follower, followee] of FOLLOWS) {
      insertFollow.run(ids[follower], ids[followee], daysAgo(30 + Math.random() * 20));
    }

    const insertLike = db.prepare(
      'INSERT INTO likes (user_id, post_id, liked_at) VALUES (?, ?, ?)'
    );

    for (const [postIndex, ...usernames] of LIKES) {
      for (const username of usernames) {
        insertLike.run(
          ids[username], postIds[postIndex - 1],
          daysAgo(Math.max(0, POSTS[postIndex - 1][2] - 0.2))
        );
      }
    }
  });

  load();

  const n = (table) => db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n;

  console.log(
    `\n  Seeded ${n('users')} accounts, ${n('posts')} posts, ` +
    `${n('comments')} comments, ${n('likes')} likes, ${n('follows')} follows.`
  );
  console.log(`  Sign in as any username with the password: ${PASSWORD}`);
  console.log('  For example:  zahra / demo1234');
  console.log('\n  Start the server with:  npm start\n');
}

if (require.main === module) seed();

module.exports = { seed, USERS, POSTS, PASSWORD };
