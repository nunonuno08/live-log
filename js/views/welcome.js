// First screen on a phone with no records and no login. Starting from the cloud copy keeps
// the same artists and songs from being registered a second time on this phone.
import { status, syncNow } from '../sync.js';
import { esc } from '../util.js';
import { loginFormHtml, submitLogin } from './settings.js';

export const LOCAL_ONLY_KEY = 'livelog-local-only';

export function localOnly() {
  try {
    return localStorage.getItem(LOCAL_ONLY_KEY) === '1';
  } catch {
    return false;
  }
}

/** `done` opens the app once the cloud copy is here (or the user chose to go without). */
export function render(view, done) {
  view.innerHTML = `
    <section class="welcome">
      <img class="welcome-icon" src="icons/icon-192.png" alt="">
      <h1>ライブ記録</h1>
      <p class="hint">ログインすると、クラウドにある記録をこの端末でも使えます。iPhoneを替えても、別の端末でも、同じアカウントなら同じ記録になります。</p>
      <div class="card" id="welcome-body">${loginFormHtml()}</div>
      <p class="small muted center" id="welcome-wait" hidden>ログインして、クラウドの記録を読み込んでいます…</p>
      <button type="button" class="txt small" data-act="local">ログインせずに使う</button>
    </section>`;
  const body = view.querySelector('#welcome-body');

  const finish = () => {
    if (status.state !== 'error') return done();
    body.innerHTML = `<p class="small danger">記録を読み込めませんでした。<br>${esc(status.error)}</p>
      <div class="btn-row"><button type="button" data-act="retry">もう一度</button><button type="button" class="primary" data-act="go">このまま始める</button></div>
      <p class="hint">このまま始めても、つながったときに自動で読み込みます。</p>`;
  };

  view.addEventListener('click', async e => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'signin' || act === 'signup') {
      const form = body.querySelector('#login');
      // Logging in also downloads everything, which can take a moment.
      const wait = view.querySelector('#welcome-wait');
      wait.hidden = !(form.email.value.trim() && form.password.value);
      const ok = await submitLogin(form, act);
      wait.hidden = true;
      if (ok) finish();
    }
    if (act === 'retry') {
      body.innerHTML = '<p class="center muted">クラウドから記録を読み込んでいます…</p>';
      await syncNow();
      finish();
    }
    if (act === 'go') done();
    if (act === 'local' && confirm('ログインしないと、記録はこの端末の中だけに保存されます。\nあとから「設定」でログインすることもできます。')) {
      try {
        localStorage.setItem(LOCAL_ONLY_KEY, '1');
      } catch {}
      done();
    }
  });
}
