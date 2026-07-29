import { getJSON, cached, UpstreamError } from '../http.js';
import { EPIC_BASIC_AUTH } from '../config.js';
import { getSetting } from '../settings.js';

const HOUR = 60 * 60 * 1000;
const VBUCK_USD = 0.008; // 1,000 V-Bucks costs $7.99

const OAUTH = 'https://account-public-service-prod.ol.epicgames.com/account/api/oauth/token';
const PROFILE =
  'https://fortnite-public-service-prod11.ol.epicgames.com/fortnite/api/game/v2/profile';

/**
 * Cosmetics have never had a price in any public API, so we price them from the
 * shop's long-standing rarity/type grid. It is an estimate and the UI says so.
 */
const PRICE_GRID = {
  outfit:   { legendary: 2000, epic: 1500, rare: 1200, uncommon: 800, common: 500 },
  pickaxe:  { legendary: 1500, epic: 1200, rare: 800,  uncommon: 500, common: 500 },
  glider:   { legendary: 1500, epic: 1200, rare: 800,  uncommon: 500, common: 500 },
  emote:    { legendary: 800,  epic: 800,  rare: 500,  uncommon: 200, common: 200 },
  wrap:     { legendary: 800,  epic: 800,  rare: 500,  uncommon: 300, common: 300 },
  backpack: { legendary: 0,    epic: 0,    rare: 0,    uncommon: 0,   common: 0 },
};

function estimatePrice(type, rarity) {
  const row = PRICE_GRID[String(type || '').toLowerCase()];
  if (!row) return 0;
  return row[String(rarity || '').toLowerCase()] ?? 0;
}

/** The full BR cosmetics catalog, keyed by lowercase template id. */
function loadCatalog() {
  return cached('fortnite-catalog', 12 * HOUR, async () => {
    const body = await getJSON('https://fortnite-api.com/v2/cosmetics/br', {
      label: 'Fortnite cosmetics catalog',
      timeoutMs: 25000,
    });
    const map = new Map();
    for (const c of body?.data ?? []) {
      map.set(String(c.id).toLowerCase(), {
        name: c.name,
        description: c.description,
        type: c.type?.value ?? null,
        typeLabel: c.type?.displayValue ?? null,
        rarity: c.rarity?.value ?? null,
        rarityLabel: c.rarity?.displayValue ?? null,
        series: c.series?.value ?? null,
        image: c.images?.icon ?? c.images?.smallIcon ?? null,
        season: c.introduction?.season ?? null,
        shopHistory: c.shopHistory ?? [],
      });
    }
    return map;
  });
}

async function epicToken(authorizationCode) {
  const res = await fetch(OAUTH, {
    method: 'POST',
    headers: {
      Authorization: `basic ${EPIC_BASIC_AUTH}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code: authorizationCode,
    }),
  });

  const body = await res.json().catch(() => null);
  if (!res.ok) {
    const msg = body?.errorMessage || '';
    if (/expired|invalid|not valid/i.test(msg) || res.status === 400) {
      throw new UpstreamError(
        'That Epic code was already used or has expired. Codes are single-use and only last a few seconds — grab a fresh one and try again.',
        400
      );
    }
    throw new UpstreamError(msg || `Epic rejected the code (${res.status})`, 502);
  }
  return body; // { access_token, account_id, displayName, expires_in, ... }
}

async function queryProfile(accountId, token, profileId) {
  return getJSON(
    `${PROFILE}/${accountId}/client/QueryProfile?profileId=${profileId}&rvn=-1`,
    {
      method: 'POST',
      headers: {
        Authorization: `bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: '{}',
      label: `Fortnite ${profileId} profile`,
      timeoutMs: 20000,
    }
  );
}

/** Best-effort: revoke the session so the token dies with the request. */
async function killSession(token) {
  try {
    await fetch(`${OAUTH.replace('/token', '')}/sessions/kill/${token}`, {
      method: 'DELETE',
      headers: { Authorization: `bearer ${token}` },
    });
  } catch {
    /* the token expires on its own in ~8 hours regardless */
  }
}

export async function getFortniteLocker(authorizationCode) {
  const auth = await epicToken(authorizationCode);
  const token = auth.access_token;

  try {
    const [athena, core, catalog] = await Promise.all([
      queryProfile(auth.account_id, token, 'athena'),
      queryProfile(auth.account_id, token, 'common_core').catch(() => null),
      loadCatalog().catch(() => new Map()),
    ]);

    const profile = athena?.profileChanges?.[0]?.profile;
    if (!profile) {
      throw new UpstreamError(
        'Epic accepted the login but returned no Fortnite profile. Has this account ever played Fortnite?',
        404
      );
    }

    const attrs = profile.stats?.attributes ?? {};
    let vbucks = 0;
    for (const item of Object.values(core?.profileChanges?.[0]?.profile?.items ?? {})) {
      if (String(item.templateId || '').startsWith('Currency:Mtx')) {
        vbucks += item.quantity ?? 0;
      }
    }

    let estimated = 0;
    const items = [];
    const byType = new Map();

    for (const entry of Object.values(profile.items ?? {})) {
      const templateId = String(entry.templateId || '');
      const [prefix, id] = templateId.split(':');
      // Athena* prefixes are the cosmetic families; everything else is
      // loadout/quest bookkeeping the player never sees as an "item".
      if (!prefix.startsWith('Athena') || !id) continue;

      const meta = catalog.get(id.toLowerCase());
      if (!meta) continue; // unreleased or dev-only asset

      const price = estimatePrice(meta.type, meta.rarity);
      estimated += price;

      byType.set(meta.typeLabel ?? 'Other', (byType.get(meta.typeLabel ?? 'Other') ?? 0) + 1);

      items.push({
        id,
        name: meta.name,
        type: meta.type,
        typeLabel: meta.typeLabel,
        rarity: meta.rarity,
        rarityLabel: meta.rarityLabel,
        series: meta.series,
        season: meta.season,
        image: meta.image,
        vbucks: price,
        lastSeenInShop: meta.shopHistory?.at(-1) ?? null,
        neverInShop: (meta.shopHistory?.length ?? 0) === 0,
      });
    }

    items.sort((a, b) => b.vbucks - a.vbucks || a.name.localeCompare(b.name));

    const rare = items.filter((i) => i.neverInShop && i.type === 'outfit').length;

    return {
      game: 'fortnite',
      profile: {
        id: auth.account_id,
        username: auth.displayName ?? 'Epic account',
        displayName: auth.displayName ?? 'Epic account',
        avatar: null,
        link: null,
      },
      stats: [
        { label: 'Account level', value: attrs.accountLevel ?? null },
        { label: 'Battle pass tier', value: attrs.book_level ?? null },
        { label: 'Cosmetics owned', value: items.length },
        { label: 'V-Bucks', value: vbucks || null },
      ],
      worth: {
        vbucks: estimated,
        usd: estimated * VBUCK_USD,
        basis: 'Item Shop retail price by rarity and type',
        breakdown: [...byType.entries()]
          .sort((a, b) => b[1] - a[1])
          .map(([label, count]) => ({ label, count })),
        caveat:
          'This is what the locker would cost to buy at shop prices — Fortnite cosmetics cannot be sold or traded, so it is a sunk cost, not a resale value.' +
          (rare ? ` ${rare} outfit${rare === 1 ? ' has' : 's have'} never appeared in the shop.` : ''),
      },
      items,
    };
  } finally {
    await killSession(token);
  }
}

/** Name-only fallback: public stats, no locker. Needs a free fortnite-api.com key. */
export async function getFortniteStats(name, platform = 'all') {
  const key = getSetting('fortniteApiKey');
  if (!key) {
    throw new UpstreamError(
      'Looking up Fortnite by username needs a free API key from fortnite-api.com. Add it in Settings, or use the Epic sign-in above to see your full locker instead.',
      412
    );
  }

  let body;
  try {
    body = await getJSON(
      `https://fortnite-api.com/v2/stats/br/v2?name=${encodeURIComponent(name)}&accountType=${platform === 'all' ? 'epic' : platform}`,
      { headers: { Authorization: key }, label: 'Fortnite stats' }
    );
  } catch (err) {
    if (err.upstreamStatus === 404 || err.detail?.status === 404) {
      throw new UpstreamError(
        `No public Fortnite stats for "${name}". The account may not exist, or its match history is set to private in Fortnite's career settings.`,
        404
      );
    }
    throw err;
  }

  const d = body?.data ?? {};
  const all = d.stats?.all?.overall ?? {};

  return {
    game: 'fortnite',
    partial: true,
    profile: {
      id: d.account?.id ?? null,
      username: d.account?.name ?? name,
      displayName: d.account?.name ?? name,
      avatar: null,
      link: null,
    },
    stats: [
      { label: 'Account level', value: d.battlePass?.level ?? null },
      { label: 'Wins', value: all.wins ?? null },
      { label: 'K/D', value: all.kd != null ? all.kd.toFixed(2) : null },
      { label: 'Matches', value: all.matches ?? null },
    ],
    worth: null,
    items: [],
    note: 'Public stats only. Epic does not expose locker contents by username — sign in with Epic above to see your items.',
  };
}
