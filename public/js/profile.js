/* Profile page — /u/:username */

const view = document.getElementById('view');

// The username comes from the path, not a query string, because a profile
// link is the most-shared URL in an app like this and /u/zahra reads better
// than /profile?username=zahra.
const username = decodeURIComponent(location.pathname.split('/u/')[1] || '').replace(/\/$/, '');

let profile = null;

function render(data, posts) {
  profile = data;
  document.title = `${data.display_name} (@${data.username}) — CodeAlpha Social`;

  const joined = new Date(data.created_at.replace(' ', 'T') + 'Z')
    .toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });

  view.innerHTML = `
    <div class="layout">
      <div class="feed">
        <div class="profile-head">
          <div class="cover" style="background:linear-gradient(120deg, ${data.avatar_colour}, ${data.avatar_colour}55)"></div>
          <div class="inner">
            <div class="spread" style="align-items:flex-end">
              ${avatar(data, 'lg')}
              <div id="action-slot"></div>
            </div>

            <div style="margin-top:12px">
              <h1 style="margin-bottom:2px">${escapeHtml(data.display_name)}</h1>
              <div class="muted">@${escapeHtml(data.username)}</div>
            </div>

            ${data.bio ? `<p style="margin:12px 0 0">${escapeHtml(data.bio)}</p>` : ''}

            <div class="muted small" style="margin-top:10px">
              ${data.location ? `📍 ${escapeHtml(data.location)} · ` : ''}Joined ${joined}
            </div>

            <div class="stats">
              <div class="stat"><strong>${data.post_count}</strong><span class="muted">posts</span></div>
              <div class="stat">
                <strong data-follower-count>${data.follower_count}</strong>
                <span class="muted">followers</span>
              </div>
              <div class="stat"><strong>${data.following_count}</strong><span class="muted">following</span></div>
            </div>
          </div>
        </div>

        <h2 style="font-size:1.1rem;margin-bottom:14px">Posts</h2>
        <div id="posts">
          ${posts.length
            ? posts.map((post) => postCard(post)).join('')
            : `<div class="empty">
                 <div class="icon">🍃</div>
                 <p>${data.is_me ? 'You have not posted yet.' : 'No posts yet.'}</p>
                 ${data.is_me ? '<p style="margin-top:14px"><a class="btn" href="/">Write your first post</a></p>' : ''}
               </div>`}
        </div>
      </div>

      <aside class="side" id="side"></aside>
    </div>`;

  renderAction();
  wirePosts(document.getElementById('posts'));
  loadConnections();
}

function renderAction() {
  const slot = document.getElementById('action-slot');
  if (!slot) return;

  if (profile.is_me) {
    slot.innerHTML = '<button class="btn ghost" id="edit">Edit profile</button>';
    document.getElementById('edit').addEventListener('click', openEditor);
    return;
  }

  if (!Session.user) {
    slot.innerHTML = '<a class="btn" href="/login">Sign in to follow</a>';
    return;
  }

  slot.innerHTML = `
    <button class="btn ${profile.followed_by_me ? 'ghost' : ''}"
            data-follow="${escapeHtml(profile.username)}">
      ${profile.followed_by_me ? 'Following' : 'Follow'}
    </button>`;

  slot.querySelector('[data-follow]')
    .addEventListener('click', (event) => toggleFollow(event.currentTarget));
}

function openEditor() {
  const slot = document.getElementById('action-slot');
  slot.innerHTML = '';

  const panel = document.createElement('div');
  panel.className = 'card pad';
  panel.style.marginTop = '16px';
  panel.innerHTML = `
    <h3>Edit your profile</h3>
    <div id="edit-alert" style="margin:10px 0"></div>
    <div class="field">
      <label for="displayName">Display name</label>
      <input id="displayName" value="${escapeHtml(profile.display_name)}" maxlength="50">
    </div>
    <div class="field">
      <label for="bio">Bio</label>
      <textarea id="bio" rows="3" maxlength="200">${escapeHtml(profile.bio)}</textarea>
    </div>
    <div class="field-row" style="margin-top:14px">
      <div class="field" style="margin:0">
        <label for="location">Location</label>
        <input id="location" value="${escapeHtml(profile.location)}" maxlength="60">
      </div>
      <div class="field" style="margin:0">
        <label for="avatarEmoji">Avatar</label>
        <input id="avatarEmoji" value="${escapeHtml(profile.avatar_emoji)}" maxlength="8">
      </div>
    </div>
    <div class="row" style="margin-top:18px">
      <button class="btn grow" id="save">Save changes</button>
      <button class="btn ghost" id="cancel">Cancel</button>
    </div>`;

  document.querySelector('.profile-head').after(panel);

  document.getElementById('cancel').addEventListener('click', () => {
    panel.remove();
    renderAction();
  });

  document.getElementById('save').addEventListener('click', async () => {
    const button = document.getElementById('save');
    button.disabled = true;
    button.textContent = 'Saving…';

    try {
      await API.patch('/api/auth/me', {
        displayName: document.getElementById('displayName').value,
        bio: document.getElementById('bio').value,
        location: document.getElementById('location').value,
        avatarEmoji: document.getElementById('avatarEmoji').value,
      });
      toast('Profile updated');
      location.reload();
    } catch (error) {
      document.getElementById('edit-alert').innerHTML =
        `<div class="msg error">${escapeHtml(error.message)}</div>`;
      button.disabled = false;
      button.textContent = 'Save changes';
    }
  });
}

async function loadConnections() {
  const side = document.getElementById('side');
  if (!side) return;

  try {
    const [followers, following] = await Promise.all([
      API.get(`/api/users/${encodeURIComponent(username)}/followers`),
      API.get(`/api/users/${encodeURIComponent(username)}/following`),
    ]);

    const list = (users, empty) => users.length
      ? users.slice(0, 5).map((user) => `
          <div class="person">
            <a href="/u/${encodeURIComponent(user.username)}">${avatar(user, 'sm')}</a>
            <div class="info">
              <div style="font-weight:600;font-size:.9rem">
                <a href="/u/${encodeURIComponent(user.username)}" style="color:var(--text)">${escapeHtml(user.display_name)}</a>
              </div>
              <div class="muted small">@${escapeHtml(user.username)}</div>
            </div>
          </div>`).join('')
      : `<p class="muted small" style="margin:8px 0 0">${empty}</p>`;

    side.innerHTML = `
      <div class="card pad" style="margin-bottom:18px">
        <h3>Followers</h3>
        ${list(followers.users, 'Nobody yet.')}
      </div>
      <div class="card pad">
        <h3>Following</h3>
        ${list(following.users, 'Not following anyone yet.')}
      </div>`;
  } catch {
    side.innerHTML = '';
  }
}

async function load() {
  view.innerHTML = '<div class="skeleton" style="height:320px"></div>';

  await Session.load();

  if (!username) {
    view.innerHTML = '<div class="empty"><div class="icon">🤔</div><h2>No username given</h2></div>';
    return;
  }

  try {
    const { profile: data, posts } = await API.get(`/api/users/${encodeURIComponent(username)}`);
    render(data, posts);
  } catch (error) {
    view.innerHTML = `<div class="empty">
        <div class="icon">👻</div>
        <h2>${escapeHtml(error.message)}</h2>
        <p style="margin-top:18px"><a class="btn" href="/explore">Find people</a></p>
      </div>`;
  }
}

load();
