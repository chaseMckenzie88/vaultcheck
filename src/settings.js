import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { TRACKER_API_KEY, FORTNITE_API_KEY } from './config.js';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data');
const file = path.join(dir, 'settings.json');

// Env wins on first run; after that the file is the source of truth so keys
// entered in the UI survive a restart. This file is gitignored.
let store = { trackerApiKey: TRACKER_API_KEY, fortniteApiKey: FORTNITE_API_KEY };

try {
  const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
  store = { ...store, ...saved };
} catch {
  /* no settings file yet — env defaults stand */
}

export const getSetting = (key) => store[key] || '';

export function setSettings(patch) {
  for (const [key, value] of Object.entries(patch)) {
    if (key in store && typeof value === 'string') store[key] = value.trim();
  }
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(file, JSON.stringify(store, null, 2));
  return status();
}

/** Never send raw keys back to the browser — just whether one is present. */
export function status() {
  return {
    trackerApiKey: Boolean(store.trackerApiKey),
    fortniteApiKey: Boolean(store.fortniteApiKey),
  };
}
