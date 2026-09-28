/* Shared frontend helpers: API calls, rendering primitives, session, header. */

const API = {
  async request(url, options = {}) {
    const response = await fetch(url, {
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      ...options,
      body: options.body ? JSON.stringify(options.body) : undefined,
    });

    let data = null;
    try {
      data = await response.json();
    } catch {
      throw new Error(`The server returned an unreadable response (${response.status}).`);
    }

    if (!response.ok) {
      const error = new Error(data.error || `Request failed (${response.status}).`);
      error.status = response.status;
      error.code = data.code;
      throw error;
    }

    return data;
  },

  get: (url) => API.request(url),
  post: (url, body) => API.request(url, { method: 'POST', body }),
  patch: (url, body) => API.request(url, { method: 'PATCH', body }),
  delete: (url) => API.request(url, { method: 'DELETE' }),
};

/**
 * Escape before anything reaches innerHTML.
 *
 * In an app whose entire content is user-written, this is the single most
 * important function in the file. A post body containing a <script> tag must
 * render as text, not execute.
 */
function escapeHtml(value) {
  const div = document.createElement('div');
  div.textContent = value == null ? '' : String(value);
  return div.innerHTML;
}

/** "3 minutes ago", "2 days ago", then an actual date. */
function timeAgo(timestamp) {
  // SQLite datetime('now') is UTC without a zone marker; appending Z stops
  // the browser reading it as local time and showing "in 5 hours".
  const then = new Date(String(timestamp).replace(' ', 'T') + 'Z');
  const seconds = Math.floor((Date.now() - then.getTime()) / 1000);

  if (seconds < 45) return 'just now';
  if (seconds < 90) return 'a minute ago';

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} minutes ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;

  const days = Math.floor(hours / 24);
  if (days < 7) return `${days} day${days === 1 ? '' : 's'} ago`;

  return then.toLocaleDateString('en-GB', {
    day: 'numeric', month: 'short',
    year: then.getFullYear() === new Date().getFullYear() ? undefined : 'numeric',
  });
}

function avatar(user, size = '') {
  const colour = user.avatar_colour || '#6366f1';
  return `<div class="avatar ${size}" style="background:${colour}22;color:${colour}"
               title="${escapeHtml(user.display_name)}">${user.avatar_emoji || '🙂'}</div>`;
}

let toastTimer = null;
function toast(message) {
  let element = document.getElementById('toast');
  if (!element) {
    element = document.createElement('div');
    element.id = 'toast';
    document.body.appendChild(element);
  }
  element.textContent = message;
  element.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => element.classList.remove('show'), 2800);
}

const Session = {
  user: null,

  async load() {
    try {
      const { user } = await API.get('/api/auth/me');
      this.user = user;
    } catch {
      this.user = null;
    }
    renderHeader();
    return this.user;
  },

  async logout() {
    await API.post('/api/auth/logout');
    this.user = null;
    location.href = '/';
  },
};

function renderHeader() {
  const nav = document.getElementById('nav');
  if (!nav) return;

  const here = location.pathname.replace(/\/$/, '') || '/';
  const on = (path) => (here === path ? 'active' : '');

  const links = [
    `<a href="/" class="${on('/')}">Feed</a>`,
    `<a href="/explore" class="${on('/explore')}">People</a>`,
  ];

  if (Session.user) {
    links.push(
      `<a href="/u/${encodeURIComponent(Session.user.username)}"
          class="${here.startsWith('/u/' + Session.user.username) ? 'active' : ''}">Profile</a>`
    );
    links.push('<a href="#" id="logout">Sign out</a>');
  } else {
    links.push(`<a href="/login" class="${on('/login')}">Sign in</a>`);
  }

  nav.innerHTML = links.join('');

  const logout = document.getElementById('logout');
  if (logout) {
    logout.addEventListener('click', (event) => {
      event.preventDefault();
      Session.logout();
    });
  }
}

/**
 * One post card. Shared by the feed, profiles and the post page, so a
 * change to how a post looks happens in exactly one place.
 */
function postCard(post, { detail = false } = {}) {
  const mine = Session.user && Session.user.id === post.author_id;

  return `
    <article class="post" data-post="${post.id}">
      <div class="head">
        <a href="/u/${encodeURIComponent(post.username)}">${avatar(post)}</a>
        <div class="who">
          <div class="name">
            <a href="/u/${encodeURIComponent(post.username)}">${escapeHtml(post.display_name)}</a>
          </div>
          <div class="handle">
            @${escapeHtml(post.username)} · ${timeAgo(post.created_at)}
          </div>
        </div>
        ${mine ? '<button class="action danger" data-delete title="Delete this post">✕</button>' : ''}
      </div>

      <div class="body">${escapeHtml(post.body)}</div>

      <div class="actions">
        <button class="action ${post.liked_by_me ? 'liked' : ''}" data-like>
          <span data-heart>${post.liked_by_me ? '♥' : '♡'}</span>
          <span data-likes>${post.like_count}</span>
        </button>

        ${detail
          ? `<span class="action" style="cursor:default">💬 <span data-comments>${post.comment_count}</span></span>`
          : `<a class="action" href="/p/${post.id}">💬 <span data-comments>${post.comment_count}</span></a>`}
      </div>
    </article>`;
}

/**
 * Like handling, shared by every page that shows a post.
 *
 * The UI updates immediately and rolls back if the request fails. Waiting
 * for a round trip before the heart fills makes the whole app feel broken,
 * and a like is cheap enough to be worth optimism.
 */
async function toggleLike(article) {
  if (!Session.user) {
    toast('Sign in to like posts.');
    setTimeout(() => {
      location.href = `/login?next=${encodeURIComponent(location.pathname)}`;
    }, 900);
    return;
  }

  const button = article.querySelector('[data-like]');
  const heart = article.querySelector('[data-heart]');
  const count = article.querySelector('[data-likes]');

  const wasLiked = button.classList.contains('liked');
  const previous = Number(count.textContent);

  button.classList.toggle('liked', !wasLiked);
  heart.textContent = wasLiked ? '♡' : '♥';
  count.textContent = wasLiked ? previous - 1 : previous + 1;

  try {
    const result = await API.post(`/api/posts/${article.dataset.post}/like`);
    // Trust the server's number over our guess — somebody else may have
    // liked it in the same second.
    count.textContent = result.likeCount;
    button.classList.toggle('liked', result.liked);
    heart.textContent = result.liked ? '♥' : '♡';
  } catch (error) {
    button.classList.toggle('liked', wasLiked);
    heart.textContent = wasLiked ? '♥' : '♡';
    count.textContent = previous;
    toast(error.message);
  }
}

async function deletePost(article) {
  if (!confirm('Delete this post? Its comments and likes go with it.')) return;

  try {
    await API.delete(`/api/posts/${article.dataset.post}`);
    article.style.transition = 'opacity .2s';
    article.style.opacity = '0';
    setTimeout(() => article.remove(), 200);
    toast('Post deleted');
  } catch (error) {
    toast(error.message);
  }
}

/** Wire like and delete on any container holding post cards. */
function wirePosts(container) {
  container.addEventListener('click', (event) => {
    const article = event.target.closest('[data-post]');
    if (!article) return;

    if (event.target.closest('[data-like]')) return toggleLike(article);
    if (event.target.closest('[data-delete]')) return deletePost(article);
  });
}

/** Follow / unfollow, shared by profiles and the people directory. */
async function toggleFollow(button) {
  if (!Session.user) {
    toast('Sign in to follow people.');
    setTimeout(() => {
      location.href = `/login?next=${encodeURIComponent(location.pathname)}`;
    }, 900);
    return;
  }

  const username = button.dataset.follow;
  button.disabled = true;

  try {
    const result = await API.post(`/api/users/${encodeURIComponent(username)}/follow`);

    button.textContent = result.following ? 'Following' : 'Follow';
    button.classList.toggle('ghost', result.following);

    const counter = document.querySelector('[data-follower-count]');
    if (counter) counter.textContent = result.followerCount;
  } catch (error) {
    toast(error.message);
  } finally {
    button.disabled = false;
  }
}

document.addEventListener('DOMContentLoaded', () => Session.load());
