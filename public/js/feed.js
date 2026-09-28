/* The home feed: composer, Following / Everyone tabs, who-to-follow. */

const MAX_POST = 500;

const composer = document.getElementById('composer');
const tabs = document.getElementById('tabs');
const posts = document.getElementById('posts');
const side = document.getElementById('side');

let scope = 'following';

function renderComposer() {
  if (!Session.user) {
    composer.innerHTML = `
      <div class="card pad center" style="margin-bottom:22px">
        <h3>Join the conversation</h3>
        <p class="muted small">Sign in to post, comment, like and follow.</p>
        <a class="btn" href="/login" style="margin-top:12px">Sign in or create an account</a>
      </div>`;
    return;
  }

  composer.innerHTML = `
    <div class="card pad composer">
      <div class="row" style="align-items:flex-start">
        ${avatar(Session.user)}
        <textarea id="body" class="grow" maxlength="${MAX_POST + 50}"
                  placeholder="What are you working on, ${escapeHtml(Session.user.display_name.split(' ')[0])}?"></textarea>
      </div>
      <div class="foot">
        <span class="counter" id="counter">${MAX_POST}</span>
        <button class="btn" id="publish" disabled>Post</button>
      </div>
    </div>`;

  const body = document.getElementById('body');
  const counter = document.getElementById('counter');
  const publish = document.getElementById('publish');

  body.addEventListener('input', () => {
    const remaining = MAX_POST - body.value.trim().length;

    counter.textContent = remaining;
    counter.className = 'counter' + (remaining < 0 ? ' over' : remaining < 60 ? ' warn' : '');

    publish.disabled = body.value.trim().length === 0 || remaining < 0;

    // Grow to fit rather than showing a scrollbar inside a small box.
    body.style.height = 'auto';
    body.style.height = `${Math.min(body.scrollHeight, 320)}px`;
  });

  // Ctrl/Cmd+Enter posts — the shortcut anyone who types a lot will try.
  body.addEventListener('keydown', (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter' && !publish.disabled) {
      submit();
    }
  });

  publish.addEventListener('click', submit);
}

async function submit() {
  const body = document.getElementById('body');
  const publish = document.getElementById('publish');
  const text = body.value.trim();

  if (!text) return;

  publish.disabled = true;
  publish.textContent = 'Posting…';

  try {
    const { post } = await API.post('/api/posts', { body: text });

    body.value = '';
    body.style.height = 'auto';
    document.getElementById('counter').textContent = MAX_POST;

    // Prepend rather than reloading the feed: the new post appears exactly
    // where the author expects, and nothing else on screen moves.
    posts.insertAdjacentHTML('afterbegin', postCard(post));

    const fresh = posts.firstElementChild;
    fresh.style.animation = 'none';
    fresh.style.background = 'var(--accent-soft)';
    setTimeout(() => { fresh.style.transition = 'background .8s'; fresh.style.background = ''; }, 60);

    toast('Posted');
  } catch (error) {
    toast(error.message);
  } finally {
    publish.disabled = false;
    publish.textContent = 'Post';
  }
}

function renderTabs() {
  if (!Session.user) { tabs.innerHTML = ''; return; }

  tabs.innerHTML = `
    <button class="tab ${scope === 'following' ? 'on' : ''}" data-scope="following">Following</button>
    <button class="tab ${scope === 'everyone' ? 'on' : ''}" data-scope="everyone">Everyone</button>`;
}

async function loadPosts() {
  posts.innerHTML = Array.from({ length: 3 })
    .map(() => '<div class="skeleton" style="height:150px;margin-bottom:14px"></div>')
    .join('');

  try {
    const data = await API.get(`/api/posts?scope=${scope}&limit=30`);

    if (data.posts.length === 0) {
      posts.innerHTML = scope === 'following'
        ? `<div class="empty">
             <div class="icon">🌱</div>
             <h3>Your feed is quiet</h3>
             <p>Follow a few people, or switch to <strong>Everyone</strong> to see what is happening.</p>
             <p style="margin-top:16px"><a class="btn ghost" href="/explore">Find people</a></p>
           </div>`
        : `<div class="empty">
             <div class="icon">✍️</div>
             <h3>Nothing here yet</h3>
             <p>Be the first to post.</p>
           </div>`;
      return;
    }

    posts.innerHTML = data.posts.map((post) => postCard(post)).join('');
  } catch (error) {
    posts.innerHTML = `<div class="msg error">${escapeHtml(error.message)}</div>`;
  }
}

async function loadSuggestions() {
  if (!Session.user) {
    side.innerHTML = '';
    return;
  }

  try {
    const { users } = await API.get('/api/users/suggestions');

    if (users.length === 0) {
      side.innerHTML = `<div class="card pad">
          <h3>Who to follow</h3>
          <p class="muted small" style="margin:8px 0 0">
            You already follow everyone here. Impressive.
          </p>
        </div>`;
      return;
    }

    side.innerHTML = `
      <div class="card pad">
        <h3>Who to follow</h3>
        <div style="margin-top:8px">
          ${users.map((user) => `
            <div class="person">
              <a href="/u/${encodeURIComponent(user.username)}">${avatar(user, 'sm')}</a>
              <div class="info">
                <div style="font-weight:600;font-size:.9rem">
                  <a href="/u/${encodeURIComponent(user.username)}" style="color:var(--text)">${escapeHtml(user.display_name)}</a>
                </div>
                <div class="muted small">@${escapeHtml(user.username)}</div>
              </div>
              <button class="btn sm" data-follow="${escapeHtml(user.username)}">Follow</button>
            </div>`).join('')}
        </div>
        <p class="small center" style="margin:12px 0 0"><a href="/explore">See everyone</a></p>
      </div>`;
  } catch {
    side.innerHTML = '';
  }
}

/* ------------------------------------------------------------- events */

tabs.addEventListener('click', (event) => {
  const tab = event.target.closest('[data-scope]');
  if (!tab || tab.dataset.scope === scope) return;
  scope = tab.dataset.scope;
  renderTabs();
  loadPosts();
});

side.addEventListener('click', (event) => {
  const button = event.target.closest('[data-follow]');
  if (button) toggleFollow(button);
});

wirePosts(posts);

Session.load().then(() => {
  scope = Session.user ? 'following' : 'everyone';
  renderComposer();
  renderTabs();
  loadPosts();
  loadSuggestions();
});
