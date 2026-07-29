import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { PORT, EPIC_AUTH_URL, DEVEX_RATE_USD } from './src/config.js';
import { UpstreamError } from './src/http.js';
import { getSetting, setSettings, status } from './src/settings.js';
import { getRobloxAccount } from './src/providers/roblox.js';
import { getFortniteLocker, getFortniteStats } from './src/providers/fortnite.js';
import { getApexAccount, getCodAccount } from './src/providers/tracker.js';

const root = path.dirname(fileURLToPath(import.meta.url));
const app = express();

app.use(express.json({ limit: '32kb' }));
app.use(express.static(path.join(root, 'public')));

/** Wraps a handler so every thrown UpstreamError becomes a clean JSON error. */
const route = (handler) => async (req, res) => {
  try {
    res.json(await handler(req));
  } catch (err) {
    const status = err instanceof UpstreamError ? err.status : 500;
    if (status >= 500) console.error(`[${req.path}]`, err);
    res.status(status).json({
      error: err.message || 'Something went wrong',
      detail: err instanceof UpstreamError ? err.detail : undefined,
    });
  }
};

app.get('/api/config', (_req, res) => {
  res.json({
    epicAuthUrl: EPIC_AUTH_URL,
    devexRate: DEVEX_RATE_USD,
    keys: status(),
  });
});

app.post('/api/settings', route(async (req) => setSettings(req.body ?? {})));

app.get(
  '/api/roblox',
  route(async (req) => {
    const username = String(req.query.username || '').trim();
    if (!username) throw new UpstreamError('Enter a Roblox username', 400);
    return getRobloxAccount(username);
  })
);

app.get(
  '/api/fortnite',
  route(async (req) => {
    const name = String(req.query.username || '').trim();
    if (!name) throw new UpstreamError('Enter a Fortnite display name', 400);
    return getFortniteStats(name, String(req.query.platform || 'all'));
  })
);

app.post(
  '/api/fortnite/locker',
  route(async (req) => {
    const code = String(req.body?.code || '').trim();
    // Epic's authorizationCode is a 32-char hex string. Catching a bad paste
    // here gives a far better message than Epic's generic 400.
    if (!/^[a-f0-9]{32}$/i.test(code)) {
      throw new UpstreamError(
        'That does not look like an Epic authorization code. Copy just the 32-character value after "authorizationCode": — no quotes.',
        400
      );
    }
    return getFortniteLocker(code);
  })
);

app.get(
  '/api/apex',
  route(async (req) => {
    const username = String(req.query.username || '').trim();
    if (!username) throw new UpstreamError('Enter an Apex username', 400);
    return getApexAccount(username, String(req.query.platform || 'origin'));
  })
);

app.get(
  '/api/cod',
  route(async (req) => {
    const username = String(req.query.username || '').trim();
    if (!username) throw new UpstreamError('Enter an Activision ID', 400);
    return getCodAccount(username, String(req.query.platform || 'atvi'));
  })
);

app.listen(PORT, () => {
  console.log(`\n  VaultCheck  →  http://localhost:${PORT}\n`);
  if (!getSetting('trackerApiKey')) {
    console.log('  Apex + Call of Duty need a Tracker.gg key — add it in Settings.');
  }
  if (!getSetting('fortniteApiKey')) {
    console.log('  Fortnite name lookup needs a fortnite-api.com key (Epic sign-in works without one).');
  }
  console.log('');
});
