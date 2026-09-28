/* People directory with search. */

const view = document.getElementById('view');
const search = document.getElementById('search');

function personRow(user) {
  const action = user.is_me
    ? '<span class="muted small">You</span>'
    : Session.user
      ? `<button class="btn sm ${user.followed_by_me ? 'ghost' : ''}"
                 data-follow="${escapeHtml(user.username)}">
           ${user.followed_by_me ? 'Following' : 'Follow'}
         </button>`
      : '';

  return `
    <div class="person">
      <a href="/u/${encodeURIComponent(user.username)}">${avatar(user)}</a>
      <div class="info">
        <div style="font-weight:600">
          <a href="/u/${encodeURIComponent(user.username)}" style="color:var(--text)">${escapeHtml(user.display_name)}</a>
        </div>
        <div class="muted small">
          @${escapeHtml(user.username)} · ${user.follower_count} follower${user.follower_count === 1 ? '' : 's'}
          ${user.post_count != null ? ` · ${user.post_count} post${user.post_count === 1 ? '' : 's'}` : ''}
        </div>
        ${user.bio ? `<div class="bio">${escapeHtml(user.bio)}</div>` : ''}
      </div>
      ${action}
    </div>`;
}

async function load(term = '') {
  view.innerHTML = '<div class="skeleton" style="height:180px"></div>';

  try {
    const query = term ? `?search=${encodeURIComponent(term)}` : '';
    const { users } = await API.get(`/api/users${query}`);

    view.innerHTML = users.length
      ? users.map(personRow).join('')
      : `<div class="empty">
           <div class="icon">🔍</div>
           <h3>Nobody matched “${escapeHtml(term)}”</h3>
           <p class="muted">Try a different name.</p>
         </div>`;
  } catch (error) {
    view.innerHTML = `<div class="msg error">${escapeHtml(error.message)}</div>`;
  }
}

view.addEventListener('click', (event) => {
  const button = event.target.closest('[data-follow]');
  if (button) toggleFollow(button);
});

let timer = null;
search.addEventListener('input', (event) => {
  clearTimeout(timer);
  timer = setTimeout(() => load(event.target.value.trim()), 280);
});

Session.load().then(() => load());
