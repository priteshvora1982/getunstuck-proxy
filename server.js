'use strict';

const express = require('express');
const cors    = require('cors');
const { Pool } = require('pg');

const app  = express();
const PORT = process.env.PORT || 3000;

// ── CONFIG ────────────────────────────────────────────────────────────────
const OPENAI_API_KEY   = process.env.OPENAI_API_KEY;
const DATABASE_URL     = process.env.DATABASE_URL;
const RATE_LIMIT_DAY   = parseInt(process.env.RATE_LIMIT_DAY || '100');
const ALLOWED_ORIGINS  = (process.env.ALLOWED_ORIGINS || '').split(',').filter(Boolean);

if (!OPENAI_API_KEY) {
  console.error('FATAL: OPENAI_API_KEY env var not set');
  process.exit(1);
}
if (!DATABASE_URL) {
  console.error('FATAL: DATABASE_URL env var not set');
  process.exit(1);
}

// ── DATABASE ──────────────────────────────────────────────────────────────
const db = new Pool({
  connectionString: DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function initDB() {
  await db.query(`
    CREATE TABLE IF NOT EXISTS rate_limits (
      extension_id  TEXT        NOT NULL,
      day           DATE        NOT NULL DEFAULT CURRENT_DATE,
      call_count    INTEGER     NOT NULL DEFAULT 0,
      PRIMARY KEY (extension_id, day)
    );
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS nope_signals (
      id                    SERIAL      PRIMARY KEY,
      extension_id          TEXT        NOT NULL,
      created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      url                   TEXT,
      semantic_intent       TEXT,
      semantic_expansion    TEXT,
      regex_confidence      INTEGER,
      regex_patterns        TEXT[],
      api_confidence        INTEGER,
      q1_mode               TEXT
    );
  `);

  await db.query(`
    CREATE INDEX IF NOT EXISTS idx_nope_signals_extension
      ON nope_signals (extension_id);
    CREATE INDEX IF NOT EXISTS idx_nope_signals_created
      ON nope_signals (created_at);
    CREATE INDEX IF NOT EXISTS idx_rate_limits_day
      ON rate_limits (day);
  `);

  console.log('DB initialised');
}

// ── MIDDLEWARE ────────────────────────────────────────────────────────────
app.use(express.json({ limit: '32kb' }));

// CORS — allow Chrome extension and any configured origins
app.use((req, res, next) => {
  const origin = req.headers.origin || '';
  // Chrome extensions use chrome-extension:// origins
  const isChromeExt = origin.startsWith('chrome-extension://');
  const isAllowed   = ALLOWED_ORIGINS.includes(origin);

  if (isChromeExt || isAllowed || ALLOWED_ORIGINS.length === 0) {
    res.setHeader('Access-Control-Allow-Origin', origin || '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Extension-ID');
  }

  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// ── HELPERS ───────────────────────────────────────────────────────────────

// Extract and validate extension ID from header
function getExtensionID(req) {
  const id = (req.headers['x-extension-id'] || '').trim();
  if (!id || id.length < 8 || id.length > 128) return null;
  // Basic sanitise — alphanumeric + hyphens only
  if (!/^[a-z0-9-]+$/i.test(id)) return null;
  return id;
}

// Check and increment rate limit. Returns { allowed, remaining, resetAt }
async function checkRateLimit(extensionId) {
  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD

  const result = await db.query(`
    INSERT INTO rate_limits (extension_id, day, call_count)
    VALUES ($1, $2, 1)
    ON CONFLICT (extension_id, day)
    DO UPDATE SET call_count = rate_limits.call_count + 1
    RETURNING call_count
  `, [extensionId, today]);

  const count = result.rows[0].call_count;
  const allowed = count <= RATE_LIMIT_DAY;

  // Reset is midnight UTC
  const tomorrow = new Date();
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  tomorrow.setUTCHours(0, 0, 0, 0);

  return {
    allowed,
    count,
    remaining: Math.max(0, RATE_LIMIT_DAY - count),
    limit: RATE_LIMIT_DAY,
    resetAt: tomorrow.toISOString()
  };
}

// Forward prompt to OpenAI and return raw response
async function callOpenAI(body) {
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + OPENAI_API_KEY
    },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    const msg = err?.error?.message || response.statusText;
    throw Object.assign(new Error('OpenAI error: ' + msg), { status: response.status });
  }

  return response.json();
}

// ── ROUTES ────────────────────────────────────────────────────────────────

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', version: '1.0.0', ts: new Date().toISOString() });
});

// ── POST /analyze ─────────────────────────────────────────────────────────
// Receives the OpenAI request body from the extension, forwards it,
// returns the OpenAI response. API key never leaves the server.
//
// Request headers:
//   X-Extension-ID: <chrome extension id>
// Request body:
//   Standard OpenAI /v1/chat/completions payload
// Response:
//   OpenAI response body + rate limit headers
app.post('/analyze', async (req, res) => {
  try {
    // 1. Validate extension ID
    const extId = getExtensionID(req);
    if (!extId) {
      return res.status(400).json({ error: 'Missing or invalid X-Extension-ID header' });
    }

    // 2. Check rate limit
    const limit = await checkRateLimit(extId);
    res.setHeader('X-RateLimit-Limit',     limit.limit);
    res.setHeader('X-RateLimit-Remaining', limit.remaining);
    res.setHeader('X-RateLimit-Reset',     limit.resetAt);

    if (!limit.allowed) {
      return res.status(429).json({
        error: 'Daily rate limit exceeded',
        limit: limit.limit,
        remaining: 0,
        resetAt: limit.resetAt
      });
    }

    // 3. Validate request body
    const body = req.body;
    if (!body || !body.messages || !Array.isArray(body.messages)) {
      return res.status(400).json({ error: 'Invalid request body — messages array required' });
    }

    // 4. Forward to OpenAI (key injected server-side)
    const result = await callOpenAI(body);

    // 5. Return result
    return res.json(result);

  } catch (err) {
    console.error('[/analyze] error:', err.message);
    const status = err.status || 500;
    return res.status(status).json({ error: err.message || 'Internal server error' });
  }
});


// ── POST /nope ────────────────────────────────────────────────────────────
// Stores a false-positive signal from the extension.
// No prompt text stored — metadata only.
//
// Request headers:
//   X-Extension-ID: <chrome extension id>
// Request body: {
//   url:                string (hostname only, e.g. "claude.ai")
//   semantic_intent:    string ("paralysis" | "execution" | etc.)
//   semantic_expansion: string ("scope_creep" | "task_accumulation" | etc.)
//   regex_confidence:   number (0-100)
//   regex_patterns:     string[] (pattern type names)
//   api_confidence:     number (0-100)
//   q1_mode:            string ("expanding" | "deepening" | "looping")
// }
app.post('/nope', async (req, res) => {
  try {
    // 1. Validate extension ID
    const extId = getExtensionID(req);
    if (!extId) {
      return res.status(400).json({ error: 'Missing or invalid X-Extension-ID header' });
    }

    // 2. Extract metadata — no prompt text accepted
    const {
      url,
      semantic_intent,
      semantic_expansion,
      regex_confidence,
      regex_patterns,
      api_confidence,
      q1_mode
    } = req.body || {};

    // 3. Store — intentionally no prompt text
    await db.query(`
      INSERT INTO nope_signals
        (extension_id, url, semantic_intent, semantic_expansion,
         regex_confidence, regex_patterns, api_confidence, q1_mode)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    `, [
      extId,
      typeof url === 'string'             ? url.slice(0, 100)             : null,
      typeof semantic_intent === 'string' ? semantic_intent.slice(0, 50)  : null,
      typeof semantic_expansion === 'string' ? semantic_expansion.slice(0, 50) : null,
      typeof regex_confidence === 'number'   ? Math.round(regex_confidence)    : null,
      Array.isArray(regex_patterns)          ? regex_patterns.slice(0, 20)     : null,
      typeof api_confidence === 'number'     ? Math.round(api_confidence)      : null,
      typeof q1_mode === 'string'            ? q1_mode.slice(0, 20)            : null
    ]);

    return res.json({ stored: true });

  } catch (err) {
    console.error('[/nope] error:', err.message);
    return res.status(500).json({ error: 'Failed to store signal' });
  }
});


// ── GET /stats ────────────────────────────────────────────────────────────
// Basic aggregate stats — useful for your own analysis.
// No individual user data exposed.
app.get('/stats', async (req, res) => {
  try {
    const [signals, topIntents, topModes, dailyCalls] = await Promise.all([
      db.query('SELECT COUNT(*) AS total FROM nope_signals'),
      db.query(`
        SELECT semantic_intent, COUNT(*) AS count
        FROM nope_signals
        WHERE semantic_intent IS NOT NULL
        GROUP BY semantic_intent ORDER BY count DESC LIMIT 10
      `),
      db.query(`
        SELECT q1_mode, COUNT(*) AS count
        FROM nope_signals
        WHERE q1_mode IS NOT NULL
        GROUP BY q1_mode ORDER BY count DESC
      `),
      db.query(`
        SELECT day, SUM(call_count) AS calls
        FROM rate_limits
        WHERE day >= CURRENT_DATE - INTERVAL '7 days'
        GROUP BY day ORDER BY day DESC
      `)
    ]);

    return res.json({
      nope_signals: {
        total: parseInt(signals.rows[0].total),
        by_intent: topIntents.rows,
        by_q1_mode: topModes.rows
      },
      api_calls: {
        last_7_days: dailyCalls.rows
      }
    });

  } catch (err) {
    console.error('[/stats] error:', err.message);
    return res.status(500).json({ error: 'Failed to fetch stats' });
  }
});


// ── BOOT ──────────────────────────────────────────────────────────────────
async function start() {
  await initDB();
  app.listen(PORT, () => {
    console.log('GetUnstuck proxy running on port', PORT);
    console.log('Rate limit:', RATE_LIMIT_DAY, 'calls/day per extension');
  });
}

start().catch(err => {
  console.error('Startup failed:', err);
  process.exit(1);
});
