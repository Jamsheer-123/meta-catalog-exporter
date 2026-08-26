/**
 * popup.js - Controller for Meta Catalog API Stock Exporter Popup Interface
 * Manages token testing, catalog auto-discovery, adaptive safety export loop, stock mismatch reconciliation, and activity logging.
 */

(() => {
  const db = window.MetaDB;
  const api = window.MetaAPI;

  // Elements
  let txtAccessToken, btnToggleToken, btnTestToken, txtCatalogId, btnAutoDetect, selCatalogs;
  let selAvailability, selDelay;
  let statusBadge, rateLimitText, rateLimitFill;
  let requestStats, productStats, etaStats, progressPercent, progressFill;
  let btnStart, btnPause, btnResume, btnStop, btnDownload, btnClear;
  let fileLaravelCSV, btnCompareStock;
  let logFeed, logCount;

  // State
  let isExportRunning = false;
  let isExportPaused = false;
  let laravelParsedData = [];

  let exportState = {
    status: 'idle',
    requestCount: 0,
    totalProducts: 0,
    nextUrl: null,
    startTime: null,
    catalogId: '',
    accessToken: '',
    availability: 'out_of_stock',
    delayMs: 300,
    rateLimitUsagePct: 0
  };

  document.addEventListener('DOMContentLoaded', async () => {
    bindElements();
    setupEventListeners();
    await loadStoredCredentials();
    await refreshUI();

    // Poll UI every 1.5s
    setInterval(refreshUI, 1500);
  });

  function bindElements() {
    txtAccessToken = document.getElementById('txtAccessToken');
    btnToggleToken = document.getElementById('btnToggleToken');
    btnTestToken = document.getElementById('btnTestToken');
    txtCatalogId = document.getElementById('txtCatalogId');
    btnAutoDetect = document.getElementById('btnAutoDetect');
    selCatalogs = document.getElementById('selCatalogs');

    selAvailability = document.getElementById('selAvailability');
    selDelay = document.getElementById('selDelay');

    statusBadge = document.getElementById('statusBadge');
    rateLimitText = document.getElementById('rateLimitText');
    rateLimitFill = document.getElementById('rateLimitFill');

    requestStats = document.getElementById('requestStats');
    productStats = document.getElementById('productStats');
    etaStats = document.getElementById('etaStats');
    progressPercent = document.getElementById('progressPercent');
    progressFill = document.getElementById('progressFill');

    btnStart = document.getElementById('btnStart');
    btnPause = document.getElementById('btnPause');
    btnResume = document.getElementById('btnResume');
    btnStop = document.getElementById('btnStop');
    btnDownload = document.getElementById('btnDownload');
    btnClear = document.getElementById('btnClear');

    fileLaravelCSV = document.getElementById('fileLaravelCSV');
    btnCompareStock = document.getElementById('btnCompareStock');

    logFeed = document.getElementById('logFeed');
    logCount = document.getElementById('logCount');
  }

  async function loadStoredCredentials() {
    chrome.storage.local.get(['metaAccessToken', 'metaCatalogId', 'metaAvailability', 'metaDelay'], (res) => {
      if (res.metaAccessToken) txtAccessToken.value = res.metaAccessToken;
      if (res.metaCatalogId) txtCatalogId.value = res.metaCatalogId;
      if (res.metaAvailability) selAvailability.value = res.metaAvailability;
      if (res.metaDelay) selDelay.value = res.metaDelay;
    });
  }

  function setupEventListeners() {
    // Password toggle
    btnToggleToken.addEventListener('click', () => {
      txtAccessToken.type = txtAccessToken.type === 'password' ? 'text' : 'password';
    });

    txtAccessToken.addEventListener('input', () => {
      chrome.storage.local.set({ metaAccessToken: txtAccessToken.value.trim() });
    });
    txtCatalogId.addEventListener('input', () => {
      chrome.storage.local.set({ metaCatalogId: txtCatalogId.value.trim() });
    });
    selAvailability.addEventListener('change', () => {
      chrome.storage.local.set({ metaAvailability: selAvailability.value });
    });
    selDelay.addEventListener('change', () => {
      chrome.storage.local.set({ metaDelay: selDelay.value });
    });

    btnTestToken.addEventListener('click', handleTestToken);
    btnAutoDetect.addEventListener('click', handleAutoDetectCatalogs);

    selCatalogs.addEventListener('change', () => {
      if (selCatalogs.value) {
        txtCatalogId.value = selCatalogs.value;
        chrome.storage.local.set({ metaCatalogId: selCatalogs.value });
      }
    });

    // Controls
    btnStart.addEventListener('click', startApiExport);
    btnPause.addEventListener('click', pauseApiExport);
    btnResume.addEventListener('click', resumeApiExport);
    btnStop.addEventListener('click', stopApiExport);

    // Actions
    btnDownload.addEventListener('click', () => {
      chrome.runtime.sendMessage({ action: 'TRIGGER_CSV_DOWNLOAD' }, (response) => {
        if (chrome.runtime.lastError) {
          addLocalLog('Error requesting download: ' + chrome.runtime.lastError.message, 'error');
        }
      });
    });

    btnClear.addEventListener('click', async () => {
      if (confirm('Are you sure you want to clear all exported product data and logs?')) {
        await db.clearAllData();
        exportState = {
          status: 'idle',
          requestCount: 0,
          totalProducts: 0,
          nextUrl: null,
          startTime: null,
          catalogId: '',
          accessToken: '',
          availability: 'out_of_stock',
          delayMs: 300,
          rateLimitUsagePct: 0
        };
        await db.saveStateKey('exportState', exportState);
        await refreshUI();
        addLocalLog('All exported catalog data cleared successfully.', 'info');
      }
    });

    // Laravel CSV File Reader for Stock Mismatch Tool
    fileLaravelCSV.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (!file) return;

      const reader = new FileReader();
      reader.onload = (event) => {
        try {
          laravelParsedData = parseCSVString(event.target.result);
          addLocalLog(`Loaded Laravel EC Portal Inventory CSV: ${laravelParsedData.length} records parsed.`, 'success');
          btnCompareStock.disabled = false;
        } catch (err) {
          addLocalLog(`Error parsing CSV: ${err.message}`, 'error');
          alert('Could not parse uploaded CSV file.');
        }
      };
      reader.readAsText(file);
    });

    btnCompareStock.addEventListener('click', handleCompareStock);
  }

  /**
   * Tests the Meta Graph API token and checks granted permissions.
   */
  async function handleTestToken() {
    const token = txtAccessToken.value.trim();
    if (!token) {
      alert('Please enter a valid Meta Access Token.');
      return;
    }

    addLocalLog('Validating Meta Access Token...', 'info');
    btnTestToken.disabled = true;

    try {
      const result = await api.testToken(token);
      const permStr = result.permissions.length > 0 ? result.permissions.join(', ') : 'None';
      addLocalLog(`Token Validated! Connected as: ${result.user.name} (ID: ${result.user.id}). Granted: ${permStr}`, 'success');
      alert(`✅ Meta Access Token Valid!\nUser: ${result.user.name}\nGranted Permissions: ${permStr}`);
    } catch (err) {
      addLocalLog(`Token Validation Failed: ${err.message}`, 'error');
      alert(`❌ Token Validation Error:\n${err.message}`);
    } finally {
      btnTestToken.disabled = false;
    }
  }

  /**
   * Auto-detects Commerce Catalogs linked to the access token.
   */
  async function handleAutoDetectCatalogs() {
    const token = txtAccessToken.value.trim();
    if (!token) {
      alert('Please enter a valid Access Token first.');
      return;
    }

    addLocalLog('Querying Meta Graph API for accessible catalogs...', 'info');
    btnAutoDetect.disabled = true;

    try {
      const catalogs = await api.fetchCatalogs(token);
      if (!catalogs || catalogs.length === 0) {
        addLocalLog('No catalogs found for this token. Enter Catalog ID manually.', 'warn');
        alert('No Commerce Catalogs found for this Access Token. Please verify permissions or enter Catalog ID manually.');
      } else {
        selCatalogs.innerHTML = '<option value="">-- Select Detected Catalog --</option>';
        catalogs.forEach((c) => {
          const opt = document.createElement('option');
          opt.value = c.id;
          opt.textContent = `${c.name || 'Catalog'} (ID: ${c.id}) ${c.product_count !== undefined ? `- ${c.product_count} products` : ''}`;
          selCatalogs.appendChild(opt);
        });
        selCatalogs.style.display = 'block';
        txtCatalogId.value = catalogs[0].id;
        chrome.storage.local.set({ metaCatalogId: catalogs[0].id });
        addLocalLog(`Found ${catalogs.length} Meta catalog(s). Auto-selected Catalog ID: ${catalogs[0].id}`, 'success');
      }
    } catch (err) {
      addLocalLog(`Catalog auto-detection error: ${err.message}`, 'error');
      alert(`Catalog Auto-Detection Error:\n${err.message}`);
    } finally {
      btnAutoDetect.disabled = false;
    }
  }

  /**
   * Initiates Meta Graph API catalog export loop.
   */
  async function startApiExport() {
    const token = txtAccessToken.value.trim();
    const catalogId = txtCatalogId.value.trim();

    if (!token) {
      alert('Please enter a valid Meta Access Token.');
      return;
    }
    if (!catalogId) {
      alert('Please enter or auto-detect a Commerce Catalog ID.');
      return;
    }

    isExportRunning = true;
    isExportPaused = false;

    exportState.status = 'scraping';
    exportState.accessToken = token;
    exportState.catalogId = catalogId;
    exportState.availability = selAvailability.value;
    exportState.delayMs = parseInt(selDelay.value, 10);
    exportState.startTime = Date.now();
    exportState.requestCount = 0;
    exportState.nextUrl = null;
    await db.saveStateKey('exportState', exportState);

    await addLogEvent(`Starting Official Meta Graph API Export for Catalog ID: ${catalogId}...`, 'info');
    refreshUI();

    runApiExportLoop();
  }

  function pauseApiExport() {
    isExportPaused = true;
    isExportRunning = false;
    exportState.status = 'paused';
    db.saveStateKey('exportState', exportState);
    addLogEvent(`API Export paused at request ${exportState.requestCount}.`, 'warn');
    refreshUI();
  }

  function resumeApiExport() {
    if (isExportRunning) return;
    isExportRunning = true;
    isExportPaused = false;
    exportState.status = 'scraping';
    db.saveStateKey('exportState', exportState);
    addLogEvent('Resuming Meta Graph API Export loop...', 'info');
    refreshUI();

    runApiExportLoop();
  }

  function stopApiExport() {
    isExportRunning = false;
    isExportPaused = false;
    exportState.status = 'idle';
    db.saveStateKey('exportState', exportState);
    addLogEvent('API Export stopped by user.', 'warn');
    refreshUI();
  }

  /**
   * Main paginated Meta Graph API fetching control loop with Production Safety Mode.
   */
  async function runApiExportLoop() {
    while (isExportRunning && !isExportPaused) {
      try {
        const { catalogId, accessToken, availability, delayMs, nextUrl } = exportState;

        // Fetch paginated products via official Graph API
        const pageResult = await api.fetchCatalogProductsPage({
          catalogId,
          accessToken,
          filterType: availability,
          nextUrl: nextUrl,
          limit: 250
        });

        const products = pageResult.products || [];
        exportState.requestCount++;
        exportState.nextUrl = pageResult.nextCursor;
        exportState.rateLimitUsagePct = pageResult.rateLimitUsagePct || 0;

        // Batch insert to IndexedDB
        if (products.length > 0) {
          await db.saveProductBatch(products);
        }

        exportState.totalProducts = await db.getProductCount();
        await db.saveStateKey('exportState', exportState);

        // Update Rate Limit Gauge
        updateRateLimitGauge(exportState.rateLimitUsagePct);

        // --- Production Safety Mode Adaptive Scheduler ---
        const adaptive = api.calculateAdaptiveSafetyDelay(exportState.rateLimitUsagePct, delayMs);

        if (adaptive.action === 'pause_exceeded') {
          await addLogEvent(`⚠️ Meta API Rate Limit Usage > 95%! Auto-pausing export to prevent account blocks. Click Resume when usage cools down.`, 'error');
          alert('Meta API Rate Limit Alert:\nUsage exceeded 95%! The export has been paused automatically to protect your account. You can click Resume in a few minutes once usage drops.');
          pauseApiExport();
          break;
        } else if (adaptive.action === 'throttle_2s') {
          await addLogEvent(`Notice: Usage at ${exportState.rateLimitUsagePct}%. Increasing delay to 2.0s for safety.`, 'warn');
        } else if (adaptive.action === 'throttle_1s') {
          await addLogEvent(`Notice: Usage at ${exportState.rateLimitUsagePct}%. Increasing delay to 1.0s for safety.`, 'info');
        }

        await addLogEvent(`Request #${exportState.requestCount}: Fetched ${products.length} products (Total: ${exportState.totalProducts.toLocaleString()}) [Usage: ${exportState.rateLimitUsagePct}%]`, 'success');
        refreshUI();

        // Reached end of catalog (paging.next is null)
        if (!pageResult.nextCursor) {
          await addLogEvent(`Export Complete! Successfully fetched ${exportState.totalProducts.toLocaleString()} total products across ${exportState.requestCount} API requests.`, 'success');
          exportState.status = 'completed';
          isExportRunning = false;
          await db.saveStateKey('exportState', exportState);
          refreshUI();
          break;
        }

        // Apply Adaptive Delay + Jitter (±100ms)
        const jitter = Math.floor(Math.random() * 200) - 100;
        const finalDelay = Math.max(100, adaptive.delay + jitter);
        await new Promise(r => setTimeout(r, finalDelay));

      } catch (err) {
        console.error('[MetaAPI Export Loop Error]:', err);
        await addLogEvent(`API Export Error: ${err.message}`, 'error');
        exportState.status = 'error';
        isExportRunning = false;
        await db.saveStateKey('exportState', exportState);
        refreshUI();
        alert(`Meta Graph API Export Error:\n${err.message}`);
        break;
      }
    }
  }

  /**
   * Compares exported Meta catalog data against uploaded Laravel EC Portal Inventory CSV
   * and generates downloadable Stock Mismatch Report CSV.
   */
  async function handleCompareStock() {
    if (!laravelParsedData || laravelParsedData.length === 0) {
      alert('Please upload a valid Laravel EC Portal Inventory CSV file first.');
      return;
    }

    addLocalLog('Fetching Meta catalog products from database...', 'info');
    const metaProducts = await db.getAllProducts();

    if (!metaProducts || metaProducts.length === 0) {
      alert('No Meta catalog products found in database. Please run Meta API Export first!');
      return;
    }

    addLocalLog(`Reconciling ${metaProducts.length} Meta products against ${laravelParsedData.length} EC Portal records...`, 'info');

    // Create lookup map for Meta products by retailer_id
    const metaMap = new Map();
    metaProducts.forEach((p) => {
      const key = String(p.retailer_id || p.content_id || p.id).trim().toLowerCase();
      metaMap.set(key, p);
    });

    const mismatchRows = [];
    let mismatchCount = 0;

    laravelParsedData.forEach((row) => {
      // Find inventory ID field from CSV
      const id = String(row.inventory_id || row.retailer_id || row.content_id || row.id || row.sku || '').trim();
      if (!id) return;

      const ecStockRaw = String(row.stock || row.availability || row.qty || row.stock_status || 'In Stock').trim();
      const metaItem = metaMap.get(id.toLowerCase());

      const metaAvail = metaItem ? (metaItem.availability || 'Out of stock') : 'Not Found in Meta';
      const productName = metaItem ? metaItem.product_name : (row.product_name || row.name || 'Unknown');

      // Determine Mismatch
      let isMismatch = false;
      const normMeta = metaAvail.toLowerCase();
      const normEC = ecStockRaw.toLowerCase();

      if (normMeta.includes('out') && (normEC.includes('in') || normEC === '1' || parseInt(normEC) > 0)) {
        isMismatch = true;
      } else if (normMeta.includes('in') && (normEC.includes('out') || normEC === '0' || normEC === '0.00')) {
        isMismatch = true;
      }

      if (isMismatch) mismatchCount++;

      mismatchRows.push({
        inventory_id: id,
        product_name: productName,
        meta_availability: metaAvail,
        ec_portal_stock: ecStockRaw,
        is_mismatch: isMismatch ? 'YES' : 'NO'
      });
    });

    // Build CSV
    const csvContent = generateMismatchCSV(mismatchRows);
    const dataUrl = 'data:text/csv;charset=utf-8,' + encodeURIComponent(csvContent);

    const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const filename = `meta_stock_mismatch_report_${dateStr}.csv`;

    chrome.downloads.download({
      url: dataUrl,
      filename: filename,
      saveAs: true
    }, (id) => {
      addLocalLog(`Generated Stock Mismatch Report! Mismatches found: ${mismatchCount} out of ${mismatchRows.length} items.`, 'success');
      alert(`📊 Stock Reconciliation Complete!\n\nTotal Items Analyzed: ${mismatchRows.length}\nStock Mismatches Found: ${mismatchCount}\n\nDownloaded: ${filename}`);
    });
  }

  /**
   * Simple CSV parser for uploaded files.
   */
  function parseCSVString(text) {
    const lines = text.split(/\r\n|\n/).filter(l => l.trim().length > 0);
    if (lines.length === 0) return [];

    const headers = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, '').toLowerCase());
    const result = [];

    for (let i = 1; i < lines.length; i++) {
      const currentline = lines[i].split(',');
      if (currentline.length >= headers.length) {
        const obj = {};
        headers.forEach((h, index) => {
          obj[h] = currentline[index] ? currentline[index].trim().replace(/^"|"$/g, '') : '';
        });
        result.push(obj);
      }
    }
    return result;
  }

  function generateMismatchCSV(rows) {
    const headers = ['inventory_id', 'product_name', 'meta_availability', 'ec_portal_stock', 'is_mismatch'];
    const lines = [headers.join(',')];

    rows.forEach((r) => {
      lines.push([
        escapeCSV(r.inventory_id),
        escapeCSV(r.product_name),
        escapeCSV(r.meta_availability),
        escapeCSV(r.ec_portal_stock),
        escapeCSV(r.is_mismatch)
      ].join(','));
    });

    return lines.join('\r\n');
  }

  function escapeCSV(val) {
    if (val === null || val === undefined) return '""';
    const str = String(val);
    if (/[",\r\n]/.test(str)) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  }

  /**
   * Syncs UI with IndexedDB state and activity logs.
   */
  async function refreshUI() {
    try {
      const totalProducts = await db.getProductCount();
      const savedState = (await db.getStateKey('exportState')) || {};
      const status = savedState.status || 'idle';

      exportState = { ...exportState, ...savedState };

      // Update status badge
      updateStatusBadge(status);

      // Update Statistics
      requestStats.textContent = (exportState.requestCount || 0).toLocaleString();
      productStats.textContent = totalProducts.toLocaleString();

      // Estimate Progress
      if (status === 'scraping' && exportState.startTime && exportState.requestCount > 1) {
        const elapsedMs = Date.now() - exportState.startTime;
        const msPerReq = elapsedMs / exportState.requestCount;
        if (exportState.nextUrl) {
          etaStats.textContent = `Paging (${Math.round(msPerReq)}ms/req)`;
        } else {
          etaStats.textContent = 'Finishing...';
        }
      } else {
        etaStats.textContent = status === 'completed' ? 'Export Complete' : 'ETA: --';
      }

      // Control buttons state toggle
      if (status === 'scraping') {
        btnStart.style.display = 'none';
        btnResume.style.display = 'none';
        btnPause.style.display = 'inline-flex';
        btnPause.disabled = false;
        btnStop.disabled = false;
      } else if (status === 'paused') {
        btnStart.style.display = 'none';
        btnPause.style.display = 'none';
        btnResume.style.display = 'inline-flex';
        btnResume.disabled = false;
        btnStop.disabled = false;
      } else {
        btnStart.style.display = 'inline-flex';
        btnStart.disabled = false;
        btnPause.style.display = 'none';
        btnResume.style.display = 'none';
        btnStop.disabled = true;
      }

      btnDownload.disabled = totalProducts === 0;

      if (status === 'completed') {
        progressFill.style.width = '100%';
        progressPercent.textContent = '100%';
        progressFill.classList.add('completed');
      } else {
        progressFill.classList.remove('completed');
      }

      await renderLogs();
    } catch (err) {
      console.error('[Popup UI Sync Error]:', err);
    }
  }

  function updateRateLimitGauge(pct) {
    let modeLabel = 'Normal';
    if (pct >= 95) {
      modeLabel = 'Auto-Paused (>95%)';
    } else if (pct >= 80) {
      modeLabel = 'Throttled (2s)';
    } else if (pct >= 70) {
      modeLabel = 'Throttled (1s)';
    }

    rateLimitText.textContent = `${pct}% (${modeLabel})`;
    rateLimitFill.style.width = `${pct}%`;
    if (pct > 85) {
      rateLimitFill.style.backgroundColor = 'var(--accent-red)';
    } else if (pct > 60) {
      rateLimitFill.style.backgroundColor = 'var(--accent-amber)';
    } else {
      rateLimitFill.style.backgroundColor = 'var(--accent-green)';
    }
  }

  function updateStatusBadge(status) {
    statusBadge.className = 'status-badge ' + status;
    switch (status) {
      case 'scraping':
        statusBadge.textContent = 'Fetching API...';
        break;
      case 'paused':
        statusBadge.textContent = 'Paused';
        break;
      case 'completed':
        statusBadge.textContent = 'Completed';
        break;
      case 'error':
        statusBadge.textContent = 'Error';
        break;
      default:
        statusBadge.textContent = 'Idle';
        break;
    }
  }

  async function renderLogs() {
    const logs = await db.getRecentLogs(50);
    logCount.textContent = `${logs.length} events`;

    logFeed.innerHTML = '';
    if (logs.length === 0) {
      logFeed.innerHTML = `<div class="log-entry info"><span class="time">--:--:--</span>Ready. Enter Access Token & Catalog ID.</div>`;
      return;
    }

    logs.forEach((log) => {
      const div = document.createElement('div');
      div.className = `log-entry ${log.type || 'info'}`;
      div.innerHTML = `<span class="time">${log.timeStr}</span>${escapeHTML(log.message)}`;
      logFeed.appendChild(div);
    });

    logFeed.scrollTop = logFeed.scrollHeight;
  }

  async function addLogEvent(message, type = 'info') {
    await db.addLog(message, type);
    addLocalLog(message, type);
  }

  function addLocalLog(message, type = 'info') {
    const timeStr = new Date().toLocaleTimeString();
    const div = document.createElement('div');
    div.className = `log-entry ${type}`;
    div.innerHTML = `<span class="time">${timeStr}</span>${escapeHTML(message)}`;
    logFeed.appendChild(div);
    logFeed.scrollTop = logFeed.scrollHeight;
  }

  function escapeHTML(str) {
    return str.replace(/[&<>'"]/g, (tag) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      "'": '&#39;',
      '"': '&quot;'
    }[tag] || tag));
  }
})();
