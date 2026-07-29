import { getJSON, cached, UpstreamError } from '../http.js';
import { DEVEX_RATE_USD } from '../config.js';

const HOUR = 60 * 60 * 1000;

/**
 * Rolimons publishes a community-maintained value for every Roblox limited.
 * "Value" is what traders actually pay; "RAP" is the recent average price and
 * is easy to manipulate. We report both and lead with value where it exists.
 */
function loadRolimons() {
  return cached('rolimons', 6 * HOUR, async () => {
    const data = await getJSON('https://www.rolimons.com/itemapi/itemdetails', {
      label: 'Rolimons',
    });
    const map = new Map();
    // Shape: { items: { "1365767": [name, acronym, rap, value, defaultValue,
    //                                demand, trend, projected, hyped, rare] } }
    for (const [assetId, row] of Object.entries(data?.items ?? {})) {
      map.set(Number(assetId), {
        name: row[0],
        acronym: row[1] || null,
        rap: row[2] ?? 0,
        value: row[3] > 0 ? row[3] : null, // -1 means "no assigned value"
        demand: DEMAND[row[5]] ?? null,
        trend: TREND[row[6]] ?? null,
        projected: row[7] === 1,
        rare: row[9] === 1,
      });
    }
    return map;
  });
}

const DEMAND = { 0: 'Terrible', 1: 'Low', 2: 'Normal', 3: 'High', 4: 'Amazing' };
const TREND = { 0: 'Lowering', 1: 'Unstable', 2: 'Stable', 3: 'Raising', 4: 'Fluctuating' };

async function resolveUser(username) {
  const body = await getJSON('https://users.roblox.com/v1/usernames/users', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ usernames: [username], excludeBannedUsers: false }),
    label: 'Roblox user lookup',
  });
  const user = body?.data?.[0];
  if (!user) {
    throw new UpstreamError(`No Roblox user named "${username}"`, 404);
  }
  return user.id;
}

/** Collectibles are paginated at 100/page. Walk the cursor, but cap the walk. */
async function fetchCollectibles(userId) {
  const items = [];
  let cursor = '';
  for (let page = 0; page < 40; page++) {
    const url =
      `https://inventory.roblox.com/v1/users/${userId}/assets/collectibles` +
      `?sortOrder=Asc&limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`;

    let body;
    try {
      body = await getJSON(url, { label: 'Roblox inventory' });
    } catch (err) {
      // 403 here means the user set their inventory to private — that is a
      // normal, expected answer, not a failure of the app.
      if (err.upstreamStatus === 403 || err.detail?.errors) {
        throw new UpstreamError(
          'That account keeps its inventory private. The owner can change this under Settings > Privacy > "Who can see my inventory".',
          403
        );
      }
      throw err;
    }

    items.push(...(body?.data ?? []));
    cursor = body?.nextPageCursor;
    if (!cursor) break;
  }
  return items;
}

async function fetchThumbnails(assetIds) {
  const out = new Map();
  // Roblox caps the thumbnail batch endpoint at 100 ids per request.
  for (let i = 0; i < assetIds.length; i += 100) {
    const batch = assetIds.slice(i, i + 100);
    try {
      const body = await getJSON(
        `https://thumbnails.roblox.com/v1/assets?assetIds=${batch.join(',')}` +
          `&size=150x150&format=Png&isCircular=false`,
        { label: 'Roblox thumbnails' }
      );
      for (const t of body?.data ?? []) {
        if (t.state === 'Completed') out.set(t.targetId, t.imageUrl);
      }
    } catch {
      // Thumbnails are decoration. Never let them sink the whole lookup.
    }
  }
  return out;
}

async function safe(promise, fallback) {
  try {
    return await promise;
  } catch {
    return fallback;
  }
}

export async function getRobloxAccount(username) {
  const userId = /^\d+$/.test(username)
    ? Number(username)
    : await resolveUser(username);

  const [profile, avatar, friends, followers, rolimons, collectibles] =
    await Promise.all([
      getJSON(`https://users.roblox.com/v1/users/${userId}`, {
        label: 'Roblox profile',
      }),
      safe(
        getJSON(
          `https://thumbnails.roblox.com/v1/users/avatar-headshot?userIds=${userId}&size=150x150&format=Png&isCircular=false`,
          { label: 'Roblox avatar' }
        ),
        null
      ),
      safe(
        getJSON(`https://friends.roblox.com/v1/users/${userId}/friends/count`, {
          label: 'Roblox friends',
        }),
        null
      ),
      safe(
        getJSON(
          `https://friends.roblox.com/v1/users/${userId}/followers/count`,
          { label: 'Roblox followers' }
        ),
        null
      ),
      safe(loadRolimons(), new Map()),
      fetchCollectibles(userId),
    ]);

  const thumbs = await fetchThumbnails(collectibles.map((c) => c.assetId));

  let rap = 0;
  let value = 0;
  let projectedCount = 0;

  const items = collectibles.map((c) => {
    const meta = rolimons.get(c.assetId);
    const itemRap = c.recentAveragePrice ?? meta?.rap ?? 0;
    // Fall back to RAP when Rolimons has not assigned a value.
    const itemValue = meta?.value ?? itemRap;

    rap += itemRap;
    value += itemValue;
    if (meta?.projected) projectedCount++;

    return {
      assetId: c.assetId,
      name: c.name,
      acronym: meta?.acronym ?? null,
      serialNumber: c.serialNumber ?? null,
      rap: itemRap,
      value: itemValue,
      hasAssignedValue: meta?.value != null,
      demand: meta?.demand ?? null,
      trend: meta?.trend ?? null,
      projected: meta?.projected ?? false,
      rare: meta?.rare ?? false,
      image: thumbs.get(c.assetId) ?? null,
      link: `https://www.roblox.com/catalog/${c.assetId}`,
    };
  });

  items.sort((a, b) => b.value - a.value);

  return {
    game: 'roblox',
    profile: {
      id: userId,
      username: profile.name,
      displayName: profile.displayName,
      description: profile.description || null,
      created: profile.created,
      banned: Boolean(profile.isBanned),
      avatar: avatar?.data?.[0]?.imageUrl ?? null,
      link: `https://www.roblox.com/users/${userId}/profile`,
    },
    stats: [
      { label: 'Friends', value: friends?.count ?? null },
      { label: 'Followers', value: followers?.count ?? null },
      { label: 'Limiteds owned', value: items.length },
      {
        label: 'Account age',
        value: profile.created
          ? `${Math.floor(
              (Date.now() - new Date(profile.created)) / (365.25 * 24 * HOUR)
            )} yrs`
          : null,
      },
    ],
    worth: {
      robux: value,
      usd: value * DEVEX_RATE_USD,
      basis: 'Rolimons value, falling back to RAP for unvalued items',
      breakdown: [
        { label: 'Rolimons value', robux: value },
        { label: 'Recent average price (RAP)', robux: rap },
      ],
      caveat: projectedCount
        ? `${projectedCount} item${projectedCount === 1 ? ' is' : 's are'} flagged as projected — their listed price is likely inflated and would not resell for this much.`
        : null,
    },
    items,
  };
}
