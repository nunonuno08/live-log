// Cloud sync with Supabase. The phone stays the working copy (works offline); when online,
// changed records are uploaded, other devices' changes downloaded, and the newer change
// of a record wins. Photos go to a private storage folder per account.
import {
  state, RECORD_STORES, changes, readTombs, writeTombs, applyRemote, removeRemote,
  putRemotePhoto, hasPhoto, getPhotoBlob, referencedPhotoIds, FORCE_PUSH_KEY,
} from './store.js';
import { debounce } from './util.js';

const SUPABASE_URL = 'https://orytpvfmcganvnyyruye.supabase.co';
// Publishable key: meant to be public; the database only lets each account see its own rows.
const SUPABASE_KEY = 'sb_publishable_fRfiUN0oxeYd57eNKi1pxQ_kmoYt9j-';
const AUTH_KEY = 'livelog-auth';
const META_KEY = 'livelog-sync';
const UPLOADED_KEY = 'livelog-uploaded-photos';
const PAGE = 1000;
const CHUNK = 300;

/* ---------- status for the settings screen ---------- */

export const status = { state: 'signedOut', email: '', lastSync: 0, error: '' };
export const statusEvents = new EventTarget();
function setStatus(patch) {
  Object.assign(status, patch);
  statusEvents.dispatchEvent(new Event('change'));
}

/* ---------- client ---------- */

let clientPromise;
function client() {
  clientPromise ??= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'js/vendor/supabase.js';
    s.onload = () =>
      resolve(window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { storageKey: AUTH_KEY, persistSession: true, autoRefreshToken: true } }));
    s.onerror = () => {
      clientPromise = null;
      reject(new Error('同期機能を読み込めませんでした'));
    };
    document.head.append(s);
  });
  return clientPromise;
}

const hasSavedSession = () => {
  try {
    return !!localStorage.getItem(AUTH_KEY);
  } catch {
    return false;
  }
};

const readJson = (key, fallback) => {
  try {
    return JSON.parse(localStorage.getItem(key)) ?? fallback;
  } catch {
    return fallback;
  }
};
const writeJson = (key, value) => {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {}
};

/* ---------- account ---------- */

const MESSAGES = [
  [/invalid login credentials/i, 'メールアドレスかパスワードが違います'],
  [/already registered|already been registered/i, 'このメールアドレスはすでに登録されています。「ログイン」してください'],
  [/password should be at least|weak password/i, 'パスワードは6文字以上にしてください'],
  [/signups not allowed|signup is disabled/i, '現在、新しい登録は受け付けていません'],
  [/invalid email|unable to validate email/i, 'メールアドレスの形式が正しくありません'],
  [/rate limit/i, '短時間に何度も試したため、しばらく待ってからもう一度お試しください'],
  [/failed to fetch|network/i, 'ネットに接続できません'],
];
const friendly = err => MESSAGES.find(([re]) => re.test(err?.message || ''))?.[1] || err?.message || 'エラーが発生しました';

export async function signUp(email, password) {
  const sb = await client();
  const { data, error } = await sb.auth.signUp({ email, password });
  if (error) throw new Error(friendly(error));
  if (!data.session) throw new Error('登録しました。確認メールが届いていたら、リンクを開いてから「ログイン」してください');
  await afterLogin(data.session);
}

export async function signIn(email, password) {
  const sb = await client();
  const { data, error } = await sb.auth.signInWithPassword({ email, password });
  if (error) throw new Error(friendly(error));
  await afterLogin(data.session);
}

export async function signOut() {
  const sb = await client();
  await sb.auth.signOut();
  setStatus({ state: 'signedOut', email: '', error: '' });
}

async function afterLogin(session) {
  const meta = readJson(META_KEY, {});
  // Another account than last time: start over, so this phone's data is uploaded to it.
  if (meta.userId !== session.user.id) {
    writeJson(META_KEY, { userId: session.user.id, lastPush: 0, lastPull: '', lastSync: 0 });
    writeJson(UPLOADED_KEY, []);
  }
  setStatus({ state: 'idle', email: session.user.email, error: '' });
  await syncNow();
}

/* ---------- sync ---------- */

let running = null;
let again = false;
let changedDuringSync = false;

/** Runs a sync (or queues one right after the current run). */
export function syncNow() {
  if (running) {
    again = true;
    return running;
  }
  running = run()
    .catch(err => setStatus({ state: 'error', error: friendly(err) }))
    .finally(() => {
      running = null;
      if (again) {
        again = false;
        syncNow();
      }
    });
  return running;
}

async function run() {
  const sb = await client();
  const { data: { session } } = await sb.auth.getSession();
  if (!session) return setStatus({ state: 'signedOut', email: '' });
  if (!navigator.onLine) return setStatus({ state: 'offline', email: session.user.email });
  const uid = session.user.id;
  const meta = { lastPush: 0, lastPull: '', ...readJson(META_KEY, {}), userId: uid };
  const force = localStorage.getItem(FORCE_PUSH_KEY) === '1';
  if (force) {
    meta.lastPush = 0;
    writeJson(UPLOADED_KEY, []);
  }
  changedDuringSync = false;
  setStatus({ state: 'syncing', email: session.user.email, error: '' });

  /* 1. upload changed and deleted records */
  const rows = [];
  let pushedUpTo = meta.lastPush;
  for (const kind of RECORD_STORES) {
    for (const r of state[kind].values()) {
      const at = r.updatedAt || 1;
      if (at <= meta.lastPush) continue;
      rows.push({ user_id: uid, kind, id: r.id, data: r, deleted: false, updated_at: at });
      pushedUpTo = Math.max(pushedUpTo, at);
    }
  }
  const tombs = readTombs();
  for (const t of tombs) {
    if (RECORD_STORES.includes(t.kind)) rows.push({ user_id: uid, kind: t.kind, id: t.id, data: null, deleted: true, updated_at: t.at });
  }
  for (let i = 0; i < rows.length; i += CHUNK) {
    const { error } = await sb.from('records').upsert(rows.slice(i, i + CHUNK), { onConflict: 'user_id,kind,id' });
    if (error) throw error;
  }

  /* 2. photos: remove deleted ones, upload new ones */
  const bucket = sb.storage.from('photos');
  const uploaded = new Set(readJson(UPLOADED_KEY, []));
  const removedPhotos = tombs.filter(t => t.kind === 'photos').map(t => t.id);
  if (removedPhotos.length) {
    await bucket.remove(removedPhotos.map(id => `${uid}/${id}.jpg`));
    removedPhotos.forEach(id => uploaded.delete(id));
  }
  for (const id of referencedPhotoIds()) {
    if (uploaded.has(id)) continue;
    const blob = await getPhotoBlob(id);
    if (!blob) continue;
    const { error } = await bucket.upload(`${uid}/${id}.jpg`, blob, { upsert: true, contentType: 'image/jpeg' });
    if (error) throw error;
    uploaded.add(id);
    writeJson(UPLOADED_KEY, [...uploaded]);
  }
  // Only forget tombstones that were sent; deletions made meanwhile stay queued.
  const sent = new Set(tombs.map(t => `${t.kind}:${t.id}:${t.at}`));
  writeTombs(readTombs().filter(t => !sent.has(`${t.kind}:${t.id}:${t.at}`)));

  /* 3. download other devices' changes */
  let from = meta.lastPull || '1970-01-01T00:00:00Z';
  let pulledUpTo = 0;
  let received = 0;
  for (;;) {
    // gte + small overlap: rows saved together share one server time.
    const { data, error } = await sb
      .from('records')
      .select('kind,id,data,deleted,updated_at,server_at')
      .gte('server_at', from)
      .order('server_at')
      .limit(PAGE);
    if (error) throw error;
    for (const row of data) {
      const local = state[row.kind]?.get(row.id);
      const localAt = local?.updatedAt || 0;
      if (row.deleted) {
        if (local && localAt <= row.updated_at) {
          await removeRemote(row.kind, row.id);
          received++;
        }
      } else if (!local || localAt < row.updated_at) {
        await applyRemote(row.kind, row.data);
        received++;
      }
      pulledUpTo = Math.max(pulledUpTo, row.updated_at);
    }
    if (data.length) from = data.at(-1).server_at;
    if (data.length < PAGE) break;
  }

  /* 4. photos this phone doesn't have yet */
  for (const id of referencedPhotoIds()) {
    if (await hasPhoto(id)) continue;
    const { data, error } = await bucket.download(`${uid}/${id}.jpg`);
    if (error || !data) continue;
    await putRemotePhoto(id, data);
    uploaded.add(id);
    received++;
  }
  writeJson(UPLOADED_KEY, [...uploaded]);

  // Records just downloaded don't need to be uploaded back, unless something changed meanwhile.
  meta.lastPush = changedDuringSync ? pushedUpTo : Math.max(pushedUpTo, pulledUpTo);
  meta.lastPull = from;
  meta.lastSync = Date.now();
  writeJson(META_KEY, meta);
  if (force) localStorage.removeItem(FORCE_PUSH_KEY);
  setStatus({ state: 'idle', lastSync: meta.lastSync, error: '' });

  if (received) statusEvents.dispatchEvent(new CustomEvent('received', { detail: received }));
}

/* ---------- start-up ---------- */

const scheduleSync = debounce(() => syncNow(), 4000);

/** Starts automatic syncing if this phone is logged in. Never loads the library otherwise. */
export function initSync() {
  status.lastSync = readJson(META_KEY, {}).lastSync || 0;
  changes.addEventListener('change', () => {
    if (running) changedDuringSync = true;
    if (status.state !== 'signedOut') scheduleSync();
  });
  document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && status.state !== 'signedOut' && syncNow());
  window.addEventListener('online', () => status.state !== 'signedOut' && syncNow());
  if (hasSavedSession()) {
    setStatus({ state: 'idle' });
    syncNow();
  }
}
