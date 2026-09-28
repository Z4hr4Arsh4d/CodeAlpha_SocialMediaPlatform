/* Sign in / create account. */

const form = document.getElementById('form');
const alertBox = document.getElementById('alert');
const tabLogin = document.getElementById('tab-login');
const tabRegister = document.getElementById('tab-register');

let mode = 'login';

function nextUrl() {
  const next = new URLSearchParams(location.search).get('next');
  // Same-site paths only. An absolute URL here would make this an open
  // redirect — a phishing primitive that borrows the site's credibility.
  if (next && next.startsWith('/') && !next.startsWith('//')) return next;
  return '/';
}

function renderForm() {
  alertBox.innerHTML = '';

  form.innerHTML = mode === 'login'
    ? `
      <div class="field">
        <label for="identifier">Username or email</label>
        <input id="identifier" required autocomplete="username" value="zahra">
      </div>
      <div class="field">
        <label for="password">Password</label>
        <input id="password" type="password" required autocomplete="current-password" value="demo1234">
      </div>
      <button class="btn block lg" type="submit" style="margin-top:6px">Sign in</button>`
    : `
      <div class="field">
        <label for="username">Username</label>
        <input id="username" required autocomplete="username" placeholder="zahra_dev"
               pattern="[a-z0-9_]{3,20}">
        <p class="small muted" style="margin:6px 0 0">
          3–20 characters. Lowercase letters, numbers and underscores.
        </p>
      </div>
      <div class="field">
        <label for="displayName">Display name</label>
        <input id="displayName" required autocomplete="name" placeholder="Zahra Arshad" maxlength="50">
      </div>
      <div class="field">
        <label for="email">Email</label>
        <input id="email" type="email" required autocomplete="email">
      </div>
      <div class="field">
        <label for="password">Password</label>
        <input id="password" type="password" required autocomplete="new-password" minlength="8">
        <p class="small muted" style="margin:6px 0 0">At least 8 characters.</p>
      </div>
      <button class="btn block lg" type="submit" style="margin-top:6px">Create account</button>`;
}

function setMode(next) {
  mode = next;
  tabLogin.classList.toggle('on', mode === 'login');
  tabRegister.classList.toggle('on', mode === 'register');
  document.title = mode === 'login'
    ? 'Sign in — CodeAlpha Social'
    : 'Create account — CodeAlpha Social';
  renderForm();
}

tabLogin.addEventListener('click', () => setMode('login'));
tabRegister.addEventListener('click', () => setMode('register'));

form.addEventListener('submit', async (event) => {
  event.preventDefault();

  const button = form.querySelector('button[type=submit]');
  const label = button.textContent;

  alertBox.innerHTML = '';
  button.disabled = true;
  button.textContent = mode === 'login' ? 'Signing in…' : 'Creating your account…';

  const payload = mode === 'login'
    ? {
        identifier: document.getElementById('identifier').value,
        password: document.getElementById('password').value,
      }
    : {
        username: document.getElementById('username').value.toLowerCase(),
        displayName: document.getElementById('displayName').value,
        email: document.getElementById('email').value,
        password: document.getElementById('password').value,
      };

  try {
    await API.post(`/api/auth/${mode}`, payload);
    location.href = nextUrl();
  } catch (error) {
    alertBox.innerHTML = `<div class="msg error">${escapeHtml(error.message)}</div>`;
    button.disabled = false;
    button.textContent = label;
  }
});

Session.load().then((user) => {
  if (user) location.href = nextUrl();
});

setMode('login');
