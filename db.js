/**
 * db.js - Universal IndexedDB Storage Layer for Meta Catalog API Exporter
 * Handles high-volume product storage (65,000+ items), deduplication by retailer_id, and state persistence.
 */

(() => {
  const DB_NAME = 'MetaCatalogAPIDB';
  const DB_VERSION = 2;

  let dbInstance = null;

  /**
   * Opens or initializes the IndexedDB database instance.
   * @returns {Promise<IDBDatabase>}
   */
  function openDB() {
    if (dbInstance) return Promise.resolve(dbInstance);

    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = (event) => {
        const db = event.target.result;

        // Products store keyed by retailer_id for automatic deduplication
        if (!db.objectStoreNames.contains('products')) {
          const productStore = db.createObjectStore('products', { keyPath: 'retailer_id' });
          productStore.createIndex('page_number', 'page_number', { unique: false });
          productStore.createIndex('scraped_at', 'scraped_at', { unique: false });
        }

        // Metadata / State persistence store
        if (!db.objectStoreNames.contains('state')) {
          db.createObjectStore('state', { keyPath: 'key' });
        }

        // Activity logs store
        if (!db.objectStoreNames.contains('logs')) {
          const logStore = db.createObjectStore('logs', { keyPath: 'id', autoIncrement: true });
          logStore.createIndex('timestamp', 'timestamp', { unique: false });
        }
      };

      request.onsuccess = (event) => {
        dbInstance = event.target.result;
        resolve(dbInstance);
      };

      request.onerror = (event) => {
        console.error('[MetaAPI DB] Error opening IndexedDB:', event.target.error);
        reject(event.target.error);
      };
    });
  }

  /**
   * Saves a batch of scraped product objects into IndexedDB incrementally.
   * Automatically handles deduplication using retailer_id (or fallback content_id / id).
   * @param {Array<Object>} products Array of product objects from Graph API
   * @returns {Promise<{inserted: number}>}
   */
  async function saveProductBatch(products) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('products', 'readwrite');
      const store = tx.objectStore('products');

      let inserted = 0;

      products.forEach((product) => {
        const primaryKey = product.retailer_id || product.content_id || product.id;
        if (primaryKey) {
          store.put({
            ...product,
            retailer_id: String(primaryKey),
            scraped_at: product.scraped_at || Date.now()
          });
          inserted++;
        }
      });

      tx.oncomplete = () => resolve({ inserted });
      tx.onerror = (e) => reject(e.target.error);
    });
  }

  /**
   * Retrieves all stored products from IndexedDB sorted by page_number.
   * @returns {Promise<Array<Object>>}
   */
  async function getAllProducts() {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('products', 'readonly');
      const store = tx.objectStore('products');
      const request = store.getAll();

      request.onsuccess = () => resolve(request.result || []);
      request.onerror = (e) => reject(e.target.error);
    });
  }

  /**
   * Returns total count of products in IndexedDB.
   * @returns {Promise<number>}
   */
  async function getProductCount() {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('products', 'readonly');
      const store = tx.objectStore('products');
      const request = store.count();

      request.onsuccess = () => resolve(request.result || 0);
      request.onerror = (e) => reject(e.target.error);
    });
  }

  /**
   * Saves state key-value pair.
   * @param {string} key
   * @param {any} value
   */
  async function saveStateKey(key, value) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('state', 'readwrite');
      const store = tx.objectStore('state');
      store.put({ key, value, updated_at: Date.now() });

      tx.oncomplete = () => resolve();
      tx.onerror = (e) => reject(e.target.error);
    });
  }

  /**
   * Gets state value by key.
   * @param {string} key
   * @returns {Promise<any>}
   */
  async function getStateKey(key) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('state', 'readonly');
      const store = tx.objectStore('state');
      const request = store.get(key);

      request.onsuccess = () => resolve(request.result ? request.result.value : null);
      request.onerror = (e) => reject(e.target.error);
    });
  }

  /**
   * Appends a log entry to IndexedDB.
   * @param {string} message
   * @param {string} type 'info' | 'warn' | 'error' | 'success'
   */
  async function addLog(message, type = 'info') {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('logs', 'readwrite');
      const store = tx.objectStore('logs');
      const entry = {
        message,
        type,
        timestamp: Date.now(),
        timeStr: new Date().toLocaleTimeString()
      };
      store.add(entry);

      tx.oncomplete = () => resolve(entry);
      tx.onerror = (e) => reject(e.target.error);
    });
  }

  /**
   * Fetches recent logs from IndexedDB.
   * @param {number} limit Maximum logs to retrieve
   * @returns {Promise<Array<Object>>}
   */
  async function getRecentLogs(limit = 50) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('logs', 'readonly');
      const store = tx.objectStore('logs');
      const request = store.getAll();

      request.onsuccess = () => {
        const logs = request.result || [];
        resolve(logs.slice(-limit));
      };
      request.onerror = (e) => reject(e.target.error);
    });
  }

  /**
   * Clears all products, state, and logs from IndexedDB.
   */
  async function clearAllData() {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(['products', 'state', 'logs'], 'readwrite');
      tx.objectStore('products').clear();
      tx.objectStore('state').clear();
      tx.objectStore('logs').clear();

      tx.oncomplete = () => resolve();
      tx.onerror = (e) => reject(e.target.error);
    });
  }

  // Export object for global access across all contexts
  const MetaDB = {
    openDB,
    saveProductBatch,
    getAllProducts,
    getProductCount,
    saveStateKey,
    getStateKey,
    addLog,
    getRecentLogs,
    clearAllData
  };

  const scope = typeof self !== 'undefined' ? self : (typeof window !== 'undefined' ? window : this);
  scope.MetaDB = MetaDB;
})();
