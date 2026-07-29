import { getJSON, UpstreamError } from '../http.js';
import { getSetting } from '../settings.js';

const BASE = 'https://public-api.tracker.gg/v2';

async function trackerProfile(game, platform, identifier) {
  const key = getSetting('trackerApiKey');
  if (!key) {
    throw new UpstreamError(
      'Apex Legends and Call of Duty need a free Tracker.gg API key. Open Settings to add one — it takes about two minutes at tracker.gg/developers.',
      412
    );
  }

  const url = `${BASE}/${game}/standard/profile/${platform}/${encodeURIComponent(identifier)}`;

  try {
    return await getJSON(url, {
      headers: { 'TRN-Api-Key': key },
      label: 'Tracker.gg',
      timeoutMs: 20000,
    });
  } catch (err) {
    if (err.upstreamStatus === 404) {
      throw new UpstreamError(
        `Tracker.gg has no profile for "${identifier}" on ${platform}. Check the spelling and platform — and note the account has to have played recently enough to be indexed.`,
        404
      );
    }
    if (err.upstreamStatus === 429) {
      throw new UpstreamError(
        'Tracker.gg rate-limited us. Wait a minute and try again.',
        429
      );
    }
    if (err.upstreamStatus === 401 || err.upstreamStatus === 403) {
      throw new UpstreamError(
        'Tracker.gg rejected the API key. Check it in Settings — keys are tied to an approved app, and a brand new one can take a few minutes to activate.',
        401
      );
    }
    throw err;
  }
}

const num = (seg, key) => seg?.stats?.[key]?.value ?? null;
const disp = (seg, key) => seg?.stats?.[key]?.displayValue ?? null;

export async function getApexAccount(identifier, platform = 'origin') {
  const body = await trackerProfile('apex', platform, identifier);
  const data = body?.data ?? {};
  const overview = data.segments?.find((s) => s.type === 'overview');

  // Apex has no inventory API at all — no public endpoint exposes skins.
  // Legends are the closest real thing, so we surface those instead of faking it.
  const legends = (data.segments ?? [])
    .filter((s) => s.type === 'legend' && s.metadata?.name)
    .map((s) => ({
      id: s.attributes?.id ?? s.metadata.name,
      name: s.metadata.name,
      image: s.metadata.portraitImageUrl ?? s.metadata.imageUrl ?? null,
      typeLabel: 'Legend',
      rarityLabel: s.metadata.isActive ? 'Active' : null,
      detail: [
        num(s, 'kills') != null ? `${disp(s, 'kills')} kills` : null,
        num(s, 'damage') != null ? `${disp(s, 'damage')} damage` : null,
        num(s, 'wins') != null ? `${disp(s, 'wins')} wins` : null,
      ].filter(Boolean),
    }))
    .sort((a, b) => b.detail.length - a.detail.length);

  return {
    game: 'apex',
    profile: {
      id: data.platformInfo?.platformUserId ?? null,
      username: data.platformInfo?.platformUserHandle ?? identifier,
      displayName: data.platformInfo?.platformUserHandle ?? identifier,
      avatar: data.platformInfo?.avatarUrl ?? null,
      link: null,
    },
    stats: [
      { label: 'Account level', value: disp(overview, 'level') },
      { label: 'Kills', value: disp(overview, 'kills') },
      { label: 'Rank', value: overview?.stats?.rankScore?.metadata?.rankName ?? null },
      { label: 'Legends played', value: legends.length || null },
    ],
    worth: null,
    items: legends,
    itemsLabel: 'Legends',
    note: 'Respawn publishes no inventory API, so skins and heirlooms cannot be read by any third-party app. Level and per-legend stats are the real data available.',
  };
}

export async function getCodAccount(identifier, platform = 'atvi') {
  const body = await trackerProfile('warzone', platform, identifier);
  const data = body?.data ?? {};
  const overview = data.segments?.find((s) => s.type === 'overview');

  return {
    game: 'cod',
    partial: true,
    profile: {
      id: data.platformInfo?.platformUserId ?? null,
      username: data.platformInfo?.platformUserHandle ?? identifier,
      displayName: data.platformInfo?.platformUserHandle ?? identifier,
      avatar: data.platformInfo?.avatarUrl ?? null,
      link: null,
    },
    stats: [
      { label: 'Level', value: disp(overview, 'level') },
      { label: 'Wins', value: disp(overview, 'wins') },
      { label: 'K/D', value: disp(overview, 'kdRatio') },
      { label: 'Kills', value: disp(overview, 'kills') },
    ],
    worth: null,
    items: [],
    note: 'Activision shut down public account APIs in 2023. Only aggregated Warzone stats remain, and only while the Activision profile is set to public.',
  };
}
