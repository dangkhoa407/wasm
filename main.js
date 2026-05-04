// main.js - MB Bank WASM Encryption Service
// Node.js/Express port of Python Flask main.py

'use strict';

const express = require('express');
const multer = require('multer');
const fetch = require('node-fetch');
const { wasmEncrypt } = require('./wasm_helper');

const app = express();
const upload = multer({ storage: multer.memoryStorage() });

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

const DEFAULT_WASM_URL = 'https://online.mbbank.com.vn/assets/wasm/main.wasm';

/**
 * Generate timestamp string in format YYYYMMDDHHmm{2-digit-centisecond}
 * Mirrors Python get_now_time()
 */
function getNowTime() {
  const now = new Date();
  const pad = (n, len = 2) => String(n).padStart(len, '0');

  const year = now.getFullYear();
  const month = pad(now.getMonth() + 1);
  const day = pad(now.getDate());
  const hours = pad(now.getHours());
  const minutes = pad(now.getMinutes());
  // Python takes first 2 digits of microseconds → equivalent to Math.floor(milliseconds / 10)
  const centisecond = pad(Math.floor(now.getMilliseconds() / 10));

  return `${year}${month}${day}${hours}${minutes}${centisecond}`;
}

/**
 * POST /encrypt
 *
 * Accepts JSON body:
 *   { "payload": {...}, "wasm_url": "https://..." (optional) }
 *
 * Or multipart/form-data:
 *   - payload: JSON string
 *   - wasm_file: .wasm file upload
 *
 * Returns:
 *   { "success": true, "dataEnc": "..." }
 *   or
 *   { "success": false, "error": "..." }
 */
app.post(
  '/encrypt',
  upload.single('wasm_file'),
  async (req, res) => {
    let payload = null;
    let wasmBytes = null;

    try {
      // ── JSON body ──────────────────────────────────────────────────────────
      if (req.is('application/json')) {
        payload = req.body.payload;
        const wasmUrl = req.body.wasm_url;

        if (wasmUrl) {
          const resp = await fetch(wasmUrl, { timeout: 30000 });
          if (!resp.ok) throw new Error(`Failed to fetch WASM from ${wasmUrl}: ${resp.status}`);
          wasmBytes = Buffer.from(await resp.arrayBuffer());
        }
      }
      // ── multipart/form-data (file upload) ──────────────────────────────────
      else if (req.file || req.body.payload) {
        try {
          payload = JSON.parse(req.body.payload || '{}');
        } catch {
          return res.status(400).json({ error: "Invalid JSON in 'payload' field" });
        }

        if (req.file) {
          wasmBytes = req.file.buffer;
        }
      }

      if (!payload) {
        return res.status(400).json({ error: "Missing 'payload'" });
      }

      // ── Fallback: download default WASM ────────────────────────────────────
      if (!wasmBytes) {
        const resp = await fetch(DEFAULT_WASM_URL, { timeout: 30000 });
        if (!resp.ok) throw new Error(`Failed to fetch default WASM: ${resp.status}`);
        wasmBytes = Buffer.from(await resp.arrayBuffer());
      }

      // ── Build request data ─────────────────────────────────────────────────
      const nowTime = getNowTime();
      const rid = `api-${nowTime}`;
      const deviceId = `abi2jojr-mbib-0000-0000-${nowTime}`;

      const jsonData = {
        sessionId: '',
        refNo: rid,
        deviceIdCommon: deviceId,
        ...payload,
      };

      // ── Encrypt ────────────────────────────────────────────────────────────
      const encryptedData = await wasmEncrypt(wasmBytes, jsonData);

      return res.json({
        success: true,
        dataEnc: encryptedData,
      });

    } catch (err) {
      console.error('[/encrypt] Error:', err);
      return res.status(500).json({
        success: false,
        error: err.message || String(err),
      });
    }
  }
);

// ── Start server ─────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 5000;
const HOST = process.env.HOST || '0.0.0.0';

app.listen(PORT, HOST, () => {
  console.log(`MB Bank WASM Encrypt service running at http://${HOST}:${PORT}`);
  console.log(`  POST /encrypt  — JSON body or multipart form`);
});

module.exports = app; // for testing