# Privacy Policy for Meta Catalog API Stock Exporter

**Effective Date**: August 26, 2026

## 1. Overview
The **Meta Catalog API Stock Exporter** Chrome Extension ("the Extension") is committed to respecting user privacy. This privacy policy describes how the Extension handles data when installed and used by users.

## 2. No Data Collection or Remote Storage
- **Local Operation Only**: The Extension operates entirely within your local web browser.
- **No Third-Party Analytics**: We do NOT track, collect, log, or transmit any personally identifiable information (PII), usage metrics, browsing history, or catalog data to any external servers, databases, or analytics providers.
- **No Sale of Data**: User data is never sold, rented, shared, or transferred to any third party under any circumstances.

## 3. Data Processing & Permissions
The Extension requests the following browser permissions solely to deliver its core functionality:

- **`storage`**: Used exclusively to store user settings (e.g., token preferences, catalog selection) and temporary product inventory records locally in your browser's IndexedDB. Data remains 100% local to your machine.
- **`downloads`**: Used to save generated RFC-4180 CSV export files and Stock Mismatch reconciliation reports directly to your local computer.
- **`activeTab`**: Used to present the extension popup user interface cleanly over the active tab.
- **Host Permissions (`https://graph.facebook.com/*`, `https://business.facebook.com/*`)**: Used exclusively to send read-only HTTP GET requests directly from your browser to official Meta Graph API endpoints to retrieve your Commerce Catalog inventory data.

## 4. Security & API Tokens
- Access tokens entered into the Extension are stored locally in your browser session/storage.
- Tokens are transmitted exclusively via encrypted HTTPS directly to official Meta Graph API servers (`graph.facebook.com`).
- Tokens are never sent to any intermediate proxy servers or third-party locations.

## 5. Third-Party Services
The Extension interacts only with:
- **Meta (Facebook) Graph API**: To fetch catalog inventory requested by the user. Usage is governed by [Meta's Privacy Policy](https://www.facebook.com/privacy/policy).

## 6. Data Deletion
Users can clear all stored catalog data and logs at any time by clicking **Clear Stored Data** within the extension popup or by uninstalling the Extension. Uninstalling the Extension completely removes all locally stored IndexedDB database records.

## 7. Contact Information
If you have any questions about this Privacy Policy, please contact the publisher via GitHub issues at:
`https://github.com/Jamsheer-123/meta-catalog-exporter/issues`
