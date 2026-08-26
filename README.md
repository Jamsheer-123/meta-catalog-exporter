# Meta Catalog API Stock Exporter

> A production-ready Chrome Extension (Manifest V3) designed to safely export catalog inventory stock (Out of Stock / In Stock / All) from Meta Commerce Catalogs via the official Meta Graph API into RFC-4180 compliant CSV files.

---

## 🌟 Key Features

- **Official Meta Graph API v20.0 Integration**: Uses read-only `GET /{catalog_id}/products` endpoints with cursor-based pagination.
- **High-Volume Catalog Scalability**: Efficiently handles large-scale catalogs (**65,000+ products**) using IndexedDB storage.
- **Adaptive Safety Rate Limiter**: Monitors Meta response headers (`x-app-usage` and `x-business-use-case-usage`) in real-time to automatically throttle requests or pause before hitting Meta rate limits.
- **Stock Mismatch Reconciliation Tool**: Compares exported Meta Catalog availability against your EC Portal / ERP inventory CSV (e.g., Laravel inventory system) and generates an automated **Stock Mismatch Report**.
- **RFC-4180 Compliant CSV Export**: Generates standardized CSV exports with escaped fields, supporting seamless Excel and database imports.
- **Deduplication & Local Persistence**: Guarantees no duplicate entries by indexing products by `retailer_id` in local IndexedDB.

---

## 🔑 Required Meta Graph API Permissions

To use this extension, your Meta Access Token (User Access Token or System User Token) must have the following granted permissions:

1. **`catalog_management`** *(Required)*: Grants read access to Commerce Catalogs, product items, pricing, and availability status.
2. **`business_management`** *(Recommended)*: Required when accessing catalogs owned by Meta Business Manager accounts or using System User tokens.

### How to Obtain a Token:
- **System User Token (Recommended for Production)**:
  1. Open [Meta Business Manager Settings](https://business.facebook.com/settings).
  2. Navigate to **Users** -> **System Users**.
  3. Assign catalog assets (**Manage Catalog** / **View Catalog**).
  4. Generate token with `catalog_management` and `business_management` permissions.
- **Graph API Explorer (For Testing)**:
  1. Visit the [Meta Graph API Explorer](https://developers.facebook.com/tools/explorer/).
  2. Select your App, add `catalog_management` permission, and click **Generate Access Token**.

---

## 🛡️ Adaptive Safety Throttle Matrix

| Rate Limit Header Usage | System Action | Request Delay |
| :--- | :--- | :--- |
| **< 70%** | Normal Operation | Base delay (200ms – 500ms + random jitter) |
| **70% – 80%** | Light Throttle | **1,000 ms** (1.0 second delay) |
| **80% – 95%** | Heavy Throttle | **2,000 ms** (2.0 seconds delay) |
| **> 95%** | **Auto-Pause Safety Block** | Export automatically pauses to prevent account flag |

---

## 🛠️ Installation Instructions (Chrome Developer Mode)

Follow these steps to install the extension in Google Chrome or any Chromium-based browser:

1. **Download / Clone Repository**:
   Ensure you have cloned or unzipped this repository locally.

2. **Open Chrome Extensions Page**:
   Navigate to `chrome://extensions` in your Chrome browser address bar (or go to **Menu** -> **Extensions** -> **Manage Extensions**).

3. **Enable Developer Mode**:
   Toggle the **Developer mode** switch in the top-right corner of the Extensions page.

4. **Load Extension**:
   - Click the **Load unpacked** button in the top-left header.
   - Select the `meta-export-extension` project folder containing `manifest.json`.

5. **Pin & Launch**:
   - Click the extension icon (puzzle piece) in the Chrome toolbar and pin **Meta Catalog API Stock Exporter**.
   - Click the extension icon to open the popup UI.

---

## 📊 How to Run Stock Mismatch Reconciliation

1. Paste your **Meta Access Token** and **Catalog ID** in the extension popup.
2. Click **Test Token** to verify permissions.
3. Select your desired availability filter (*Out of Stock Only*, *In Stock Only*, or *All Catalog Products*).
4. Click **Start API Export**.
5. Once the export completes, navigate to the **EC Portal Stock Mismatch Tool** section in the popup.
6. Upload your EC Portal / ERP inventory CSV (containing `inventory_id` / `retailer_id` and `stock`).
7. Click **Compare & Generate Mismatch Report CSV** to instantly download `meta_stock_mismatch_report_YYYYMMDD.csv`.

---

## 📁 Repository Structure

```
meta-export-extension/
├── manifest.json       # Manifest V3 extension configuration
├── api.js              # Graph API v20.0 module & adaptive rate throttle engine
├── db.js               # IndexedDB database manager (deduplication by retailer_id)
├── background.js       # Service worker for RFC-4180 CSV generation & download
├── popup.html          # Extension popup UI
├── popup.js            # UI controller & stock mismatch reconciliation engine
├── styles.css          # Dark theme CSS design system
├── .gitignore          # Git exclusion patterns
└── README.md           # Documentation & user guide
```

---

## 📄 License

This project is licensed under the **MIT License**. See below for details:

```text
MIT License

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
