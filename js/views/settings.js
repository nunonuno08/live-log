import { state, photoCount, allPhotos, replaceAll } from '../store.js';
import { esc, toast, today, blobToDataUrl, shareOrDownload } from '../util.js';
import { status, statusEvents, signIn, signUp, signOut, syncNow } from '../sync.js';
import { BACKUP_KEY } from './home.js';
import { nav } from '../nav.js';

export const VERSION = '0.6.0';

function cloudHtml() {
  if (status.state === 'signedOut') {
    return `<section class="card" id="cloud">
      <h2>クラウド同期</h2>
      <p class="hint">ログインすると記録と写真がクラウドにも保存され、機種変更しても同じアカウントでログインすれば元どおりになります。初めてログインしたときは、今このiPhoneにある記録がそのままアップロードされます。</p>
      <form id="login" onsubmit="return false">
        <label class="field"><span>メールアドレス</span><input type="email" name="email" autocomplete="email" inputmode="email" autocapitalize="off" autocorrect="off"></label>
        <label class="field"><span>パスワード（6文字以上）</span><input type="password" name="password" autocomplete="current-password"></label>
        <div class="btn-row"><button type="button" data-act="signup">新規登録</button><button type="button" class="primary" data-act="signin">ログイン</button></div>
        <p class="small danger" id="auth-error"></p>
      </form>
    </section>`;
  }
  const label = { idle: '同期済み', syncing: '同期中…', offline: 'オフライン（つながったら自動で同期します）', error: '同期できませんでした' }[status.state] || '';
  return `<section class="card" id="cloud">
    <h2>クラウド同期</h2>
    <p><b>${esc(status.email)}</b> でログイン中</p>
    <p class="small ${status.state === 'error' ? 'danger' : 'muted'}">${label}${status.lastSync ? ` · 最終同期 ${new Date(status.lastSync).toLocaleString('ja-JP')}` : ''}${status.error ? `<br>${esc(status.error)}` : ''}</p>
    <div class="btn-row"><button type="button" data-act="sync">今すぐ同期</button><button type="button" class="txt" data-act="signout">ログアウト</button></div>
    <p class="hint">記録や編集をすると、数秒後に自動で同期されます。</p>
  </section>`;
}

export function render(view) {
  const last = Number(localStorage.getItem(BACKUP_KEY)) || 0;
  view.innerHTML = `
    <header class="top"><h1>設定</h1></header>

    ${cloudHtml()}

    <section class="card">
      <h2>データ</h2>
      <p>ライブ ${state.lives.size}本 · アーティスト ${state.artists.size}組 · 曲 ${state.songs.size}曲 · 会場 ${state.venues.size}か所 · 写真 <span id="ph-count">…</span>枚</p>
      <p class="hint">記録はこのiPhoneの中（このアプリ専用の保存領域）に保存されています。クラウド同期を使っていない場合、ホーム画面のアイコンを削除するとデータも消えるので注意してください。</p>
    </section>

    <section class="card">
      <h2>バックアップ</h2>
      <p class="hint">クラウド同期とは別に、手元にファイルとして保存しておくこともできます。</p>
      <p class="small muted">前回のバックアップ: ${last ? new Date(last).toLocaleString('ja-JP') : 'まだありません'}</p>
      <button class="wide primary" data-act="export">バックアップを保存</button>
      <label class="wide btn">バックアップから復元<input type="file" accept=".json,application/json" hidden data-import></label>
    </section>

    <section class="card">
      <h2>使い方のヒント</h2>
      <p class="hint">
        ・Safariで開き、共有ボタン →「ホーム画面に追加」でアプリとして使えます（Safariで開いたページとはデータが別々です）。<br>
        ・同じ曲や会場が2つに分かれてしまったら、曲・会場のページ右上の「⋯」から1つにまとめられます。<br>
        ・曲の候補とジャケット写真はiTunesの情報、アーティスト写真はDeezerの情報を使っています。
      </p>
    </section>

    <section class="card">
      <h2>全データ削除</h2>
      <button class="wide txt danger" data-act="wipe">すべてのデータを削除</button>
    </section>

    <p class="center muted small">ライブ記録 v${VERSION}</p>`;

  photoCount().then(n => (view.querySelector('#ph-count').textContent = n));
  navigator.storage?.persisted?.().then(p => !p && navigator.storage.persist?.());

  const redrawCloud = () => {
    const el = view.querySelector('#cloud');
    // Don't wipe what the user is typing in the login form.
    if (el && !(status.state === 'signedOut' && el.querySelector('#login'))) el.outerHTML = cloudHtml();
  };
  statusEvents.addEventListener('change', redrawCloud);

  async function auth(act) {
    const form = view.querySelector('#login');
    const email = form.email.value.trim();
    const password = form.password.value;
    const err = form.querySelector('#auth-error');
    if (!email || !password) return (err.textContent = 'メールアドレスとパスワードを入力してください');
    form.querySelectorAll('button').forEach(b => (b.disabled = true));
    err.textContent = '';
    try {
      await (act === 'signup' ? signUp(email, password) : signIn(email, password));
      toast(act === 'signup' ? '登録しました。同期を始めます' : 'ログインしました');
      nav.rerender();
    } catch (e) {
      err.textContent = e.message;
      form.querySelectorAll('button').forEach(b => (b.disabled = false));
    }
  }

  view.addEventListener('click', async e => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'signin' || act === 'signup') await auth(act);
    if (act === 'sync') syncNow();
    if (act === 'signout' && confirm('ログアウトしますか？\n（このiPhoneの記録はそのまま残ります）')) {
      await signOut();
      nav.rerender();
    }
    if (act === 'export') await exportData();
    if (act === 'wipe') {
      if (!confirm('すべての記録と写真を削除します。元に戻せません。よろしいですか？')) return;
      if (!confirm('本当に削除しますか？（先にバックアップを保存することをおすすめします）')) return;
      await replaceAll({});
      toast('削除しました');
      nav.rerender();
    }
  });
  view.addEventListener('change', async e => {
    if (!e.target.matches('[data-import]') || !e.target.files[0]) return;
    await importData(e.target.files[0]);
    e.target.value = '';
  });

  return () => statusEvents.removeEventListener('change', redrawCloud);
}

async function exportData() {
  toast('バックアップを作成中…');
  const photos = await allPhotos();
  const data = {
    app: 'livelog',
    version: 2,
    exportedAt: new Date().toISOString(),
    artists: [...state.artists.values()],
    lives: [...state.lives.values()],
    songs: [...state.songs.values()],
    venues: [...state.venues.values()],
    photos: await Promise.all(photos.map(async p => ({ id: p.id, data: await blobToDataUrl(p.blob) }))),
  };
  const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
  if (await shareOrDownload(blob, `live-backup-${today()}.json`)) {
    localStorage.setItem(BACKUP_KEY, String(Date.now()));
    nav.rerender();
  }
}

async function importData(file) {
  let data;
  try {
    data = JSON.parse(await file.text());
  } catch {
    return toast('ファイルを読み込めませんでした');
  }
  if (data?.app !== 'livelog' || !Array.isArray(data.lives) || !Array.isArray(data.artists)) {
    return toast('このアプリのバックアップファイルではありません');
  }
  const when = data.exportedAt ? new Date(data.exportedAt).toLocaleString('ja-JP') : '不明';
  if (!confirm(`${when} のバックアップ（ライブ${data.lives.length}本）を復元します。\n今のデータはすべて置き換えられます。よろしいですか？`)) return;
  toast('復元中…');
  try {
    const photos = await Promise.all((data.photos || []).map(async p => ({ id: p.id, blob: await (await fetch(p.data)).blob() })));
    // Backups from the first version have no songs/venues; loading converts them.
    await replaceAll({ artists: data.artists, lives: data.lives, songs: data.songs || [], venues: data.venues || [], photos });
    toast('復元しました');
    nav.rerender();
  } catch (err) {
    toast('復元に失敗しました: ' + err.message);
  }
}
