const DB_NAME = 'ReadingSecondBrainDB';
const DB_VERSION = 4;

// 對照 PROJECT_SPEC.md：books(第1節) / reading_records(第2節) / outputs(第4節)
// / notes(第7節快速筆記) / groups+nodes+edges(第5節本書圖譜，群組卡片版)
// favorite_authors：喜愛的作者名單，以作者名字比對書籍，不綁定單一 bookId。
// quotes：佳句摘錄，綁定單一 bookId。
const STORE_CONFIG = {
  books: { indexes: [] },
  reading_records: { indexes: ['bookId'] },
  outputs: { indexes: ['bookId'] },
  notes: { indexes: ['bookId'] },
  groups: { indexes: ['bookId'] },
  nodes: { indexes: ['bookId'] },
  edges: { indexes: ['bookId'] },
  favorite_authors: { indexes: [] },
  quotes: { indexes: ['bookId'] },
};

let dbPromise = null;

function openDB() {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      for (const [storeName, config] of Object.entries(STORE_CONFIG)) {
        if (db.objectStoreNames.contains(storeName)) continue;
        const store = db.createObjectStore(storeName, {
          keyPath: 'id',
          autoIncrement: true,
        });
        for (const indexName of config.indexes) {
          store.createIndex(indexName, indexName, { unique: false });
        }
      }
    };

    request.onsuccess = (event) => resolve(event.target.result);
    request.onerror = (event) => reject(event.target.error);
  });

  return dbPromise;
}

function add(storeName, record) {
  return openDB().then((db) => new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    const payload = { ...record, createdAt: record.createdAt || new Date().toISOString() };
    const request = tx.objectStore(storeName).add(payload);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  }));
}

function getById(storeName, id) {
  return openDB().then((db) => new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readonly');
    const request = tx.objectStore(storeName).get(id);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  }));
}

function getAll(storeName) {
  return openDB().then((db) => new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readonly');
    const request = tx.objectStore(storeName).getAll();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  }));
}

function getByIndex(storeName, indexName, value) {
  return openDB().then((db) => new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readonly');
    const index = tx.objectStore(storeName).index(indexName);
    const request = index.getAll(value);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  }));
}

function update(storeName, record) {
  return openDB().then((db) => new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    const request = tx.objectStore(storeName).put(record);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  }));
}

function clear(storeName) {
  return openDB().then((db) => new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    const request = tx.objectStore(storeName).clear();
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  }));
}

async function removeByIndex(storeName, indexName, value) {
  const records = await getByIndex(storeName, indexName, value);
  for (const record of records) {
    await remove(storeName, record.id);
  }
}

function remove(storeName, id) {
  return openDB().then((db) => new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    const request = tx.objectStore(storeName).delete(id);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  }));
}

export const DB = {
  openDB,
  add,
  getById,
  getAll,
  getByIndex,
  update,
  remove,
  removeByIndex,
  clear,
  STORE_NAMES: Object.keys(STORE_CONFIG),
};
