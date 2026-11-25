const DB_NAME = 'beq-toolkit';
const DRAFTS = 'drafts';
const FILES = 'files';

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(DRAFTS)) db.createObjectStore(DRAFTS);
      if (!db.objectStoreNames.contains(FILES)) {
        const store = db.createObjectStore(FILES, { keyPath: 'id' });
        store.createIndex('draftKey', 'draftKey');
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

const txDone = (tx) => new Promise((resolve, reject) => {
  tx.oncomplete = resolve;
  tx.onerror = () => reject(tx.error);
  tx.onabort = () => reject(tx.error);
});

export async function loadDraft(key) {
  const db = await openDb();
  try {
    return await new Promise((resolve, reject) => {
      const req = db.transaction(DRAFTS, 'readonly').objectStore(DRAFTS).get(key);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  } finally { db.close(); }
}

export async function loadDraftFiles(key) {
  const db = await openDb();
  try {
    return await new Promise((resolve, reject) => {
      const req = db.transaction(FILES, 'readonly').objectStore(FILES).index('draftKey').getAll(key);
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  } finally { db.close(); }
}

export async function saveDraft(key, draft) {
  const db = await openDb();
  try {
    const tx = db.transaction(DRAFTS, 'readwrite');
    tx.objectStore(DRAFTS).put(draft, key);
    await txDone(tx);
  } finally { db.close(); }
}

export async function saveDraftSnapshot(key, draft, files) {
  const db = await openDb();
  try {
    const tx = db.transaction([DRAFTS, FILES], 'readwrite'), store = tx.objectStore(FILES);
    tx.objectStore(DRAFTS).put(draft, key);
    const keep = new Set(files.map((f) => f.id));
    store.index('draftKey').getAllKeys(key).onsuccess = (e) => { for (const id of e.target.result) if (!keep.has(id)) store.delete(id); };
    for (const f of files) if (f.file) store.put({ id: f.id, draftKey: key, file: f.file, name: f.file.name, type: f.file.type, size: f.file.size, lastModified: f.file.lastModified });
    await txDone(tx);
  } finally { db.close(); }
}

export async function deleteDraft(key) {
  const db = await openDb();
  try {
    const tx = db.transaction([DRAFTS, FILES], 'readwrite');
    tx.objectStore(DRAFTS).delete(key);
    const store = tx.objectStore(FILES);
    store.index('draftKey').getAllKeys(key).onsuccess = (e) => { for (const id of e.target.result) store.delete(id); };
    await txDone(tx);
  } finally { db.close(); }
}

export const newFileId = () => 'M-' + (crypto.randomUUID?.() || `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`).replace(/-/g, '');
export const newRequestId = () => 'C-' + (crypto.randomUUID?.() || `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`).replace(/-/g, '');
