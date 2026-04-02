# GetUnstuck Proxy — Deployment Guide

## What this is
Express.js proxy server that:
- Receives analysis requests from the Chrome extension
- Rate-limits by extension ID (100 calls/day per user)
- Forwards to OpenAI with the API key stored server-side (never in extension)
- Stores Nope signal metadata in Supabase for false positive analysis

---

## Step 1 — Supabase (database)

1. Go to **supabase.com** → New project
2. Name it `getunstuck` → set a strong DB password → create
3. Wait ~2 minutes for provisioning
4. Go to **Settings → Database → Connection string → URI tab**
5. Copy the string — looks like:
   ```
   postgresql://postgres:[YOUR-PASSWORD]@db.abcxyz.supabase.co:5432/postgres
   ```
6. Replace `[YOUR-PASSWORD]` with your actual password
7. Keep this string — you'll paste it into Railway as `DATABASE_URL`

> The server auto-creates the tables on first boot. Nothing to configure in Supabase manually.

**To view Nope signals later:**
- Supabase dashboard → Table Editor → `nope_signals`
- Or use the SQL editor for custom queries

---

## Step 2 — GitHub (host the code)

1. Create a new repo at **github.com/new** — name it `getunstuck-proxy`, private
2. Unzip `getunstuck-proxy.zip`
3. Push to GitHub:
   ```bash
   cd getunstuck-proxy
   git init
   git add .
   git commit -m "initial"
   git remote add origin https://github.com/YOUR-USERNAME/getunstuck-proxy.git
   git push -u origin main
   ```

---

## Step 3 — Railway (hosting)

1. Go to **railway.app** → New Project → Deploy from GitHub repo
2. Select `getunstuck-proxy`
3. Railway auto-detects Node.js and deploys

**Set environment variables** (Railway dashboard → your project → Variables tab):

| Variable | Value |
|----------|-------|
| `OPENAI_API_KEY` | Your new OpenAI key (rotate the old one first) |
| `DATABASE_URL` | Supabase connection string from Step 1 |
| `RATE_LIMIT_DAY` | `100` |

4. Railway redeploys automatically after saving variables
5. Go to **Settings → Networking → Generate Domain** — you'll get a URL like:
   ```
   https://getunstuck-proxy-production.up.railway.app
   ```

---

## Step 4 — Verify deployment

Open in browser — should return `{"status":"ok"}`:
```
https://YOUR-RAILWAY-URL/health
```

Check stats endpoint:
```
https://YOUR-RAILWAY-URL/stats
```

---

## Step 5 — Update the extension

1. Open `v007/config.js`
2. Replace the placeholder URL:
   ```js
   // Before
   proxyUrl: 'https://YOUR-RAILWAY-APP.railway.app',

   // After
   proxyUrl: 'https://getunstuck-proxy-production.up.railway.app',
   ```
3. Rezip the `v007/` folder → that's your shippable extension

---

## Endpoints

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/health` | GET | Health check |
| `/analyze` | POST | OpenAI proxy — rate limited |
| `/nope` | POST | Store false positive signal |
| `/stats` | GET | Aggregate stats (for your analysis) |

All extension requests include `X-Extension-ID` header for rate limiting.

---

## Rotate your OpenAI key

The key in v0.0.6 was exposed in the extension bundle. Before deploying:
1. Go to **platform.openai.com/api-keys**
2. Delete the old key
3. Create a new key
4. Use only the new key in Railway — never put it back in the extension

---

## Monthly costs (estimated)

| Service | Cost |
|---------|------|
| Supabase | Free (500MB, covers beta easily) |
| Railway | ~$5/month (Hobby plan) |
| OpenAI | ~$0.03–0.10/month per active user |
