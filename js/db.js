// Thin promise wrapper around IndexedDB. Every store uses `id` as its key.
const DB_NAME = 'livelog';
const DB_VERSION = 2;
// catalogs: cached song lists from iTunes per artist (re-downloadable, never backed up).
const STORES = ['artists', 'lives', 'songs', 'venues', 'photos', 'catalogs'];

let dbPromise;

function open() {
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      for (const name of STORES) {
        if (!req.result.objectStoreNames.contains(name)) req.result.createObjectStore(name, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function result(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function done(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = tx.onabort = () => reject(tx.error);
  });
}

export async function getAll(store) {
  const db = await open();
  return result(db.transaction(store).objectStore(store).getAll());
}

export async function getAllKeys(store) {
  const db = await open();
  return result(db.transaction(store).objectStore(store).getAllKeys());
}

export async function get(store, id) {
  const db = await open();
  return result(db.transaction(store).objectStore(store).get(id));
}

export async function count(store) {
  const db = await open();
  return result(db.transaction(store).objectStore(store).count());
}

export async function put(store, ...values) {
  const db = await open();
  const tx = db.transaction(store, 'readwrite');
  const os = tx.objectStore(store);
  values.forEach(v => os.put(v));
  return done(tx);
}

export async function del(store, ...ids) {
  const db = await open();
  const tx = db.transaction(store, 'readwrite');
  const os = tx.objectStore(store);
  ids.forEach(id => os.delete(id));
  return done(tx);
}

export async function clear(...stores) {
  const db = await open();
  const tx = db.transaction(stores, 'readwrite');
  stores.forEach(s => tx.objectStore(s).clear());
  return done(tx);
}
