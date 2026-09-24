import { state, photoCount, allPhotos, replaceAll } from '../store.js';
import { toast, today, blobToDataUrl, shareOrDownload } from '../util.js';
import { BACKUP_KEY } from './home.js';
import { nav } from '../nav.js';

export const VERSION = '0.3.0';

export function render(view) {
  const last = Number(localStorage.getItem(BACKUP_KEY)) || 0;
  view.innerHTML = `
    <header class="top"><h1>設定</h1></header>

    <section class="card">
      <h2>データ</h2>
      <p>ライブ ${state.lives.size}本 · アーティスト ${state.artists.size}組 · 曲 ${state.songs.size}曲 · 会場 ${state.venues.size}か所 · 写真 <span id="ph-count">…</span>枚</p>
      <p class="hint">記録はこのiPhoneの中（このアプリ専用の保存領域）にだけ保存されています。ホーム画面のアイコンを削除するとデータも消えるので注意してください。</p>
    </section>

    <section class="card">
      <h2>バックアップ</h2>
      <p class="hint">機種変更や万一に備えて、ときどき「ファイル」アプリやiCloud Driveに保存してください。</p>
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

  view.addEventListener('click', async e => {
    const act = e.target.closest('[data-act]')?.dataset.act;
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
