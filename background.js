/**
 * background.js - Service Worker for Meta Catalog API Stock Exporter (Manifest V3)
 * Handles RFC-4180 CSV generation and triggers native Chrome downloads.
 */

// Import IndexedDB database layer synchronously into service worker
importScripts('db.js');

const db = self.MetaDB;

console.log('[MetaAPI Background] Service Worker initialized.');

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'TRIGGER_CSV_DOWNLOAD') {
    handleCSVDownload()
      .then((res) => sendResponse({ success: true, count: res.count }))
      .catch((err) => {
        console.error('[MetaAPI Background] CSV download error:', err);
        sendResponse({ success: false, error: err.message });
      });
    return true; // Async response
  }

  if (message.action === 'LOG_EVENT') {
    db.addLog(message.message, message.type || 'info');
    sendResponse({ success: true });
    return false;
  }
});

/**
 * Fetches products from IndexedDB, builds RFC-4180 CSV, and triggers download.
 */
async function handleCSVDownload() {
  const products = await db.getAllProducts();

  if (!products || products.length === 0) {
    await db.addLog('Download failed: No scraped products found in database.', 'warn');
    throw new Error('No scraped products found to export.');
  }

  await db.addLog(`Preparing RFC-4180 CSV for ${products.length.toLocaleString()} catalog products...`, 'info');

  const csvContent = generateRFC4180CSV(products);
  const dataUrl = 'data:text/csv;charset=utf-8,' + encodeURIComponent(csvContent);

  const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const filename = `meta_catalog_stock_${dateStr}.csv`;

  return new Promise((resolve, reject) => {
    chrome.downloads.download({
      url: dataUrl,
      filename: filename,
      saveAs: true
    }, (downloadId) => {
      if (chrome.runtime.lastError) {
        db.addLog(`CSV download failed: ${chrome.runtime.lastError.message}`, 'error');
        reject(chrome.runtime.lastError);
      } else {
        db.addLog(`Successfully triggered CSV download: ${filename} (${downloadId})`, 'success');
        resolve({ count: products.length, downloadId });
      }
    });
  });
}

/**
 * Formats product records into RFC-4180 compliant CSV string.
 * Columns: retailer_id, product_name, availability, status, price, page_number
 * @param {Array<Object>} products
 * @returns {string}
 */
function generateRFC4180CSV(products) {
  const headers = ['retailer_id', 'product_name', 'availability', 'status', 'price', 'page_number'];
  const rows = [headers.join(',')];

  products.forEach((p, idx) => {
    const pageNum = Math.floor(idx / 250) + 1;

    const row = [
      escapeCSV(p.retailer_id || p.id || ''),
      escapeCSV(p.product_name || p.name || ''),
      escapeCSV(p.availability || 'out of stock'),
      escapeCSV(p.status || 'active'),
      escapeCSV(p.price || 'N/A'),
      escapeCSV(p.page_number || pageNum)
    ];
    rows.push(row.join(','));
  });

  return rows.join('\r\n');
}

/**
 * Escapes a cell value per RFC-4180 specification.
 * Wrap in double quotes if string contains double quote, comma, or newline.
 * Replace internal " with ""
 * @param {string|number} value
 * @returns {string}
 */
function escapeCSV(value) {
  if (value === null || value === undefined) return '""';
  const str = String(value);
  if (/[",\r\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}
