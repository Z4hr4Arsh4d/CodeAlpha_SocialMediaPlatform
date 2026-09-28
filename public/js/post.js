/* Single post with its comment thread — /p/:id */

const MAX_COMMENT = 300;

const view = document.getElementById('view');
const postId = Number(location.pathname.split('/p/')[1]);

function render(post, comments) {
  document.title = `${post.display_name}: "${post.body.slice(0, 40)}…" — CodeAlpha Social`;

  view.innerHTML = `
    <p class="small" style="margin-bottom:16px"><a href="/">&larr; Back to the feed</a></p>

    <div id="post-slot">${postCard(post, { detail: true })}</div>

    <div class="card pad" style="margin-top:18px">
      <h3 style="margin-bottom:14px">
        ${comments.length} comment${comments.length === 1 ? '' : 's'}
      </h3>

      <div id="comments">
        ${comments.length
          ? comments.map(commentCard).join('')
          : '<p class="muted small">No comments yet. Be the first.</p>'}
      </div>

      <div id="comment-form" style="margin-top:18px;padding-top:18px;border-top:1px solid var(--border)"></div>
    </div>`;

  wirePosts(document.getElementById('post-slot'));
  renderCommentForm();
  wireComments();
}

function commentCard(comment) {
  const canDelete = Session.user
    && (Session.user.id === comment.author_id || Session.user.id === window.__postAuthorId);

  return `
    <div class="comment" data-comment="${comment.id}">
      <a href="/u/${encodeURIComponent(comment.username)}">${avatar(comment, 'sm')}</a>
      <div class="bubble">
        <div class="spread">
          <div>
            <a href="/u/${encodeURIComponent(comment.username)}" style="font-weight:600;color:var(--text)">${escapeHtml(comment.display_name)}</a>
            <span class="muted small">@${escapeHtml(comment.username)} · ${timeAgo(comment.created_at)}</span>
          </div>
          ${canDelete ? '<button class="action danger" data-delete-comment title="Delete">✕</button>' : ''}
        </div>
        <div class="body">${escapeHtml(comment.body)}</div>
      </div>
    </div>`;
}

function renderCommentForm() {
  const slot = document.getElementById('comment-form');

  if (!Session.user) {
    slot.innerHTML = `<p class="muted small center">
        <a href="/login?next=${encodeURIComponent(location.pathname)}">Sign in</a> to join the conversation.
      </p>`;
    return;
  }

  slot.innerHTML = `
    <div class="row" style="align-items:flex-start">
      ${avatar(Session.user, 'sm')}
      <div class="grow">
        <textarea id="comment-body" rows="2" maxlength="${MAX_COMMENT + 30}"
                  placeholder="Write a reply…"></textarea>
        <div class="spread" style="margin-top:8px">
          <span class="counter" id="comment-counter">${MAX_COMMENT}</span>
          <button class="btn sm" id="reply" disabled>Reply</button>
        </div>
      </div>
    </div>`;

  const body = document.getElementById('comment-body');
  const counter = document.getElementById('comment-counter');
  const reply = document.getElementById('reply');

  body.addEventListener('input', () => {
    const remaining = MAX_COMMENT - body.value.trim().length;
    counter.textContent = remaining;
    counter.className = 'counter' + (remaining < 0 ? ' over' : remaining < 40 ? ' warn' : '');
    reply.disabled = body.value.trim().length === 0 || remaining < 0;
  });

  body.addEventListener('keydown', (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter' && !reply.disabled) {
      submitComment();
    }
  });

  reply.addEventListener('click', submitComment);
}

async function submitComment() {
  const body = document.getElementById('comment-body');
  const reply = document.getElementById('reply');
  const text = body.value.trim();

  if (!text) return;

  reply.disabled = true;
  reply.textContent = 'Posting…';

  try {
    const { comment, commentCount } = await API.post(
      `/api/posts/${postId}/comments`, { body: text }
    );

    const list = document.getElementById('comments');
    if (list.querySelector('p.muted')) list.innerHTML = '';
    list.insertAdjacentHTML('beforeend', commentCard(comment));

    body.value = '';
    document.getElementById('comment-counter').textContent = MAX_COMMENT;

    const heading = view.querySelector('.card.pad h3');
    heading.textContent = `${commentCount} comment${commentCount === 1 ? '' : 's'}`;

    const badge = view.querySelector('[data-comments]');
    if (badge) badge.textContent = commentCount;

    toast('Reply posted');
  } catch (error) {
    toast(error.message);
  } finally {
    reply.disabled = false;
    reply.textContent = 'Reply';
  }
}

function wireComments() {
  document.getElementById('comments').addEventListener('click', async (event) => {
    const button = event.target.closest('[data-delete-comment]');
    if (!button) return;

    const row = button.closest('[data-comment]');
    if (!confirm('Delete this comment?')) return;

    try {
      await API.delete(`/api/posts/${postId}/comments/${row.dataset.comment}`);
      row.remove();
      toast('Comment deleted');
    } catch (error) {
      toast(error.message);
    }
  });
}

async function load() {
  view.innerHTML = '<div class="skeleton" style="height:260px"></div>';

  await Session.load();

  if (!Number.isInteger(postId)) {
    view.innerHTML = '<div class="empty"><div class="icon">🤔</div><h2>No post specified</h2></div>';
    return;
  }

  try {
    const { post, comments } = await API.get(`/api/posts/${postId}`);
    // Stashed so commentCard can tell whether the viewer owns the post and
    // may therefore delete other people's replies to it.
    window.__postAuthorId = post.author_id;
    render(post, comments);
  } catch (error) {
    view.innerHTML = `<div class="empty">
        <div class="icon">👻</div>
        <h2>${escapeHtml(error.message)}</h2>
        <p style="margin-top:18px"><a class="btn" href="/">Back to the feed</a></p>
      </div>`;
  }
}

load();
