/**
 * api.js - Official Meta Graph API Commerce Catalog Module
 * Verified against official Meta Graph API Documentation:
 * - GET /{catalog_id}/products (Catalog Product Items Endpoint)
 * - Required Fields: id, retailer_id, name, availability, status, price
 * - Required Permission: catalog_management (or business_management)
 * - Pagination: Cursor-based via response data.paging.next
 * - Rate limit headers: x-app-usage, x-business-use-case-usage (handled safely if absent)
 */

(() => {
  // Centralized Graph API Version (Configurable)
  const GRAPH_API_VERSION = 'v20.0';
  const GRAPH_BASE_URL = `https://graph.facebook.com/${GRAPH_API_VERSION}`;

  /**
   * Tests access token validity and checks granted permissions.
   * Official Meta Doc: GET /me and GET /me/permissions
   * @param {string} accessToken
   * @returns {Promise<{valid: boolean, user: Object, permissions: Array<string>}>}
   */
  async function testToken(accessToken) {
    if (!accessToken || !accessToken.trim()) {
      throw new Error('Access Token is required.');
    }

    const token = accessToken.trim();
    const url = `${GRAPH_BASE_URL}/me?fields=id,name&access_token=${encodeURIComponent(token)}`;

    const response = await fetch(url);
    const data = await response.json();

    if (!response.ok || data.error) {
      const errorMsg = data.error ? data.error.message : `HTTP ${response.status} ${response.statusText}`;
      if (response.status === 401 || (data.error && data.error.code === 190)) {
        throw new Error(`Authentication Failed (Invalid or Expired Token): ${errorMsg}`);
      }
      if (response.status === 403) {
        throw new Error(`Permission Denied (HTTP 403): ${errorMsg}`);
      }
      throw new Error(`Meta API Error: ${errorMsg}`);
    }

    // Fetch permissions list
    let permissions = [];
    try {
      const permUrl = `${GRAPH_BASE_URL}/me/permissions?access_token=${encodeURIComponent(token)}`;
      const permRes = await fetch(permUrl);
      const permData = await permRes.json();
      if (permData.data) {
        permissions = permData.data.filter(p => p.status === 'granted').map(p => p.permission);
      }
    } catch (e) {
      console.warn('[MetaAPI] Could not query token permissions:', e);
    }

    return {
      valid: true,
      user: data,
      permissions
    };
  }

  /**
   * Auto-detects Commerce Catalogs accessible by the access token.
   * Official Meta Doc: GET /me/catalogs & GET /me/owned_catalogs
   * @param {string} accessToken
   * @returns {Promise<Array<{id: string, name: string, product_count: number}>>}
   */
  async function fetchCatalogs(accessToken) {
    if (!accessToken || !accessToken.trim()) {
      throw new Error('Access Token is required.');
    }

    const token = accessToken.trim();
    const endpoints = [
      `${GRAPH_BASE_URL}/me/catalogs?fields=id,name,product_count&access_token=${encodeURIComponent(token)}`,
      `${GRAPH_BASE_URL}/me/owned_catalogs?fields=id,name,product_count&access_token=${encodeURIComponent(token)}`
    ];

    let catalogs = [];

    for (const endpoint of endpoints) {
      try {
        const response = await fetch(endpoint);
        const data = await response.json();
        if (data && data.data && data.data.length > 0) {
          catalogs = data.data;
          break;
        }
      } catch (err) {
        console.warn(`[MetaAPI] Endpoint ${endpoint} failed:`, err);
      }
    }

    return catalogs;
  }

  /**
   * Fetches a single paginated page of catalog products from Meta Graph API.
   * Official Meta Doc: GET /{catalog_id}/products
   * 
   * @param {Object} options
   * @param {string} options.catalogId
   * @param {string} options.accessToken
   * @param {string} options.filterType 'out_of_stock' | 'in_stock' | 'all'
   * @param {string} [options.nextUrl] Dynamic cursor URL for next page (data.paging.next)
   * @param {number} [options.limit=250] Requested batch limit (max 250)
   * @returns {Promise<{products: Array<Object>, nextCursor: string|null, rateLimitUsagePct: number}>}
   */
  async function fetchCatalogProductsPage({ catalogId, accessToken, filterType = 'out_of_stock', nextUrl = null, limit = 250 }) {
    if (!nextUrl && (!catalogId || !catalogId.trim())) {
      throw new Error('Catalog ID is required.');
    }
    if (!accessToken || !accessToken.trim()) {
      throw new Error('Access Token is required.');
    }

    const token = accessToken.trim();
    let requestUrl = nextUrl;

    if (!requestUrl) {
      const cleanCatalogId = catalogId.trim();
      const fields = 'id,retailer_id,name,availability,status,price';
      requestUrl = `${GRAPH_BASE_URL}/${cleanCatalogId}/products?fields=${fields}&limit=${limit}&access_token=${encodeURIComponent(token)}`;

      // Apply Meta Graph API filter parameter
      if (filterType === 'out_of_stock') {
        const filterObj = { availability: { eq: 'out of stock' } };
        requestUrl += `&filter=${encodeURIComponent(JSON.stringify(filterObj))}`;
      } else if (filterType === 'in_stock') {
        const filterObj = { availability: { eq: 'in stock' } };
        requestUrl += `&filter=${encodeURIComponent(JSON.stringify(filterObj))}`;
      }
    }

    let retryCount = 0;
    const maxRetries = 3;

    while (retryCount <= maxRetries) {
      try {
        const response = await fetch(requestUrl);

        // Safe Header Parsing (Gracefully handles missing or null headers)
        const rateLimitUsagePct = parseMetaRateLimitHeaders(response.headers);

        const data = await response.json();

        // Fail-Fast Error Checks (HTTP 401 / 403 / Invalid Token)
        if (response.status === 401 || (data.error && (data.error.code === 190 || data.error.code === 102))) {
          throw new Error(`Authentication Error (401 / Invalid Token): ${data.error ? data.error.message : 'Invalid Access Token'}`);
        }
        if (response.status === 403 || (data.error && data.error.code === 200)) {
          throw new Error(`Permission Denied (403): Missing 'catalog_management' permission. ${data.error ? data.error.message : ''}`);
        }

        // Handle Rate Limit Errors (HTTP 429 or Graph API error codes 4, 17, 613)
        const isRateLimit = response.status === 429 || (data.error && [4, 17, 613].includes(data.error.code));

        if (isRateLimit) {
          retryCount++;
          if (retryCount > maxRetries) {
            throw new Error(`Meta API Rate Limit Exceeded (HTTP 429) after ${maxRetries} retries.`);
          }
          const backoffSec = Math.pow(2, retryCount); // 2s, 4s, 8s
          console.warn(`[MetaAPI] Rate limit hit. Backing off for ${backoffSec}s (Retry ${retryCount}/${maxRetries})...`);
          await new Promise(res => setTimeout(res, backoffSec * 1000));
          continue;
        }

        if (!response.ok || data.error) {
          const msg = data.error ? data.error.message : `HTTP Error ${response.status}`;
          throw new Error(`Meta Graph API Request Failed: ${msg}`);
        }

        // Format Products Array
        const rawProducts = data.data || [];
        let formattedProducts = rawProducts.map((item) => {
          let priceStr = 'N/A';
          if (item.price) {
            if (typeof item.price === 'string') {
              priceStr = item.price;
            } else if (typeof item.price === 'object') {
              priceStr = `${item.price.amount || ''} ${item.price.currency || ''}`.trim();
            }
          }

          return {
            retailer_id: item.retailer_id || item.id || `ID_${item.name}`,
            product_name: item.name || 'Unnamed Product',
            availability: item.availability || 'out of stock',
            status: item.status || 'active',
            price: priceStr || 'N/A'
          };
        });

        // Client-side Availability Filtering Fallback Guard
        if (filterType === 'out_of_stock') {
          formattedProducts = formattedProducts.filter(p => p.availability.toLowerCase().includes('out of stock') || p.availability.toLowerCase().includes('agotado'));
        } else if (filterType === 'in_stock') {
          formattedProducts = formattedProducts.filter(p => p.availability.toLowerCase().includes('in stock') || p.availability.toLowerCase().includes('available'));
        }

        // Follow dynamic paging.next cursor URL directly from official Graph API response
        const nextCursorUrl = (data.paging && data.paging.next) ? data.paging.next : null;

        return {
          products: formattedProducts,
          nextCursor: nextCursorUrl,
          rateLimitUsagePct
        };

      } catch (err) {
        if (err.message.includes('Authentication Error') || err.message.includes('Permission Denied')) {
          throw err; // Stop safely on auth / permission errors
        }

        if (retryCount >= maxRetries) {
          throw err;
        }

        retryCount++;
        const backoffSec = Math.pow(2, retryCount);
        console.warn(`[MetaAPI] Request failed (${err.message}). Retrying in ${backoffSec}s...`);
        await new Promise(res => setTimeout(res, backoffSec * 1000));
      }
    }

    throw new Error('Graph API fetch failed after maximum retries.');
  }

  /**
   * Safely parses Meta API rate limit headers (x-app-usage, x-business-use-case-usage).
   * Safely handles missing, null, or undefined headers without throwing exceptions.
   * 
   * @param {Headers|Object} headers
   * @returns {number} Rate limit usage percentage (0 - 100)
   */
  function parseMetaRateLimitHeaders(headers) {
    if (!headers) return 0;
    let maxUsage = 0;

    try {
      // Header 1: x-app-usage e.g. {"call_count":15,"cpu_time":10,"total_time":12}
      const appUsageStr = typeof headers.get === 'function' ? headers.get('x-app-usage') : (headers['x-app-usage'] || null);
      if (appUsageStr) {
        const parsed = JSON.parse(appUsageStr);
        const callCount = parsed.call_count || 0;
        const cpuTime = parsed.cpu_time || 0;
        const totalTime = parsed.total_time || 0;
        maxUsage = Math.max(maxUsage, callCount, cpuTime, totalTime);
      }

      // Header 2: x-business-use-case-usage
      const bizUsageStr = typeof headers.get === 'function' ? headers.get('x-business-use-case-usage') : (headers['x-business-use-case-usage'] || null);
      if (bizUsageStr) {
        const parsed = JSON.parse(bizUsageStr);
        Object.keys(parsed).forEach((key) => {
          const usageList = parsed[key];
          if (Array.isArray(usageList)) {
            usageList.forEach((u) => {
              const callPct = u.call_count || 0;
              const cpuPct = u.cpu_time || 0;
              const timePct = u.total_time || 0;
              maxUsage = Math.max(maxUsage, callPct, cpuPct, timePct);
            });
          }
        });
      }
    } catch (e) {
      // Graceful fallback on header parse error
    }

    return Math.min(100, Math.round(maxUsage));
  }

  /**
   * Calculates adaptive safety delay based on current Meta API usage.
   * @param {number} usagePct Current API Usage Percentage (0 - 100)
   * @param {number} baseDelayMs User configured base delay (200 - 500ms)
   * @returns {{delay: number, action: 'normal'|'throttle_1s'|'throttle_2s'|'pause_exceeded'}}
   */
  function calculateAdaptiveSafetyDelay(usagePct, baseDelayMs = 300) {
    if (usagePct >= 95) {
      return { delay: 5000, action: 'pause_exceeded' };
    }
    if (usagePct >= 80) {
      return { delay: 2000, action: 'throttle_2s' };
    }
    if (usagePct >= 70) {
      return { delay: 1000, action: 'throttle_1s' };
    }
    return { delay: baseDelayMs, action: 'normal' };
  }

  // Global MetaAPI object
  const MetaAPI = {
    GRAPH_API_VERSION,
    testToken,
    fetchCatalogs,
    fetchCatalogProductsPage,
    parseMetaRateLimitHeaders,
    calculateAdaptiveSafetyDelay
  };

  const scope = typeof self !== 'undefined' ? self : (typeof window !== 'undefined' ? window : this);
  scope.MetaAPI = MetaAPI;
})();
