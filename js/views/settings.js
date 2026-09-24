import { state, photoCount, allPhotos, replaceAll } from '../store.js';
import { toast, today, blobToDataUrl, shareOrDownload } from '../util.js';
import { BACKUP_KEY } from './home.js';
import { nav } from '../nav.js';

export const VERSION = '0.1.0';

export function render(view) {
  const last = Number(localStorage.getItem(BACKUP_KEY)) || 0;
  view.innerHTML = `
    <header class="top"><h1>設定</h1></header>

    <section class="card">
      <h2>データ</h2>
      <p>ライブ ${state.lives.size}件 · アーティスト ${state.artists.size}組 · 写真 <span id="ph-count">…</span>枚</p>
    </section>

    <section class="card">
      <h2>バックアップ</h2>
      <p class="hint">データはこのiPhoneの中にだけ保存されています。機種変更やデータが消えたときに備えて、ときどきバックアップを「ファイル」アプリやiCloud Driveに保存してください。</p>
      <p class="small muted">前回のバックアップ: ${last ? new Date(last).toLocaleString('ja-JP') : 'まだありません'}</p>
      <button class="wide primary" data-act="export">バックアップを保存</button>
      <label class="wide btn">バックアップから復元<input type="file" accept=".json,application/json" hidden data-import></label>
    </section>

    <section class="card">
      <h2>ホーム画面に追加</h2>
      <p class="hint">Safariでこのページを開き、共有ボタン →「ホーム画面に追加」でアプリとして使えます。<br>
      ⚠ ホーム画面のアプリとSafariのページでは、データが別々に保存されます。記録はホーム画面のアプリから行ってください。</p>
      <p class="small muted" id="persist"></p>
    </section>

    <section class="card">
      <h2>全データ削除</h2>
      <button class="wide danger" data-act="wipe">すべてのデータを削除</button>
    </section>

    <p class="center muted small">ライブ記録 v${VERSION}</p>`;

  photoCount().then(n => (view.querySelector('#ph-count').textContent = n));
  navigator.storage?.persisted?.().then(p => {
    view.querySelector('#persist').textContent = p ? '保存領域: 保護されています' : '';
    if (!p) navigator.storage.persist?.();
  });

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
    version: 1,
    exportedAt: new Date().toISOString(),
    artists: [...state.artists.values()],
    lives: [...state.lives.values()],
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
  if (!confirm(`${when} のバックアップ（ライブ${data.lives.length}件）を復元します。\n今のデータはすべて置き換えられます。よろしいですか？`)) return;
  toast('復元中…');
  try {
    const photos = await Promise.all((data.photos || []).map(async p => ({ id: p.id, blob: await (await fetch(p.data)).blob() })));
    await replaceAll({ artists: data.artists, lives: data.lives, photos });
    toast('復元しました');
    nav.rerender();
  } catch (err) {
    toast('復元に失敗しました: ' + err.message);
  }
}
