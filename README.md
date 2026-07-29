# VaultCheck

See what's in your game accounts — items, account level, and what it's worth — across
Roblox, Fortnite, Apex Legends, and Call of Duty.

**No passwords, ever.** This app has no password field and never will. Every game here
either exposes the data publicly or provides its own sign-in page. Entering your game
password into a third-party site is how accounts get stolen, and Roblox and Epic both
ban for it.

## Quick start

```bash
npm install
npm start          # → http://localhost:3000
```

Roblox works immediately with no setup. The other three are covered below.

## What you actually get, per game

### Roblox — the good one

Type a username. No login, no API key. You get the full limiteds inventory with real
valuations pulled from [Rolimons](https://www.rolimons.com/), plus friends, followers,
and account age.

Two numbers matter and the app shows both:

- **Value** — what traders actually pay. Community-maintained, resistant to manipulation.
- **RAP** — recent average price. Easy to inflate by trading an item back and forth at
  a fake price, which is exactly what "projected" items are. Items flagged
  `Projected` are called out, and the total warns you when any are present.

USD conversion uses Roblox's DevEx rate ($0.0035/Robux), the only official Robux→cash
number. It answers "what would Roblox pay me for this", not "what would a trader pay".

Requires the account's inventory privacy to be anything other than *Only me*.

### Fortnite — full locker via Epic's own sign-in

Epic publishes no inventory API, but it does have a real OAuth flow. The app walks you
through it:

1. Click **Open Epic sign-in** → goes to `epicgames.com`, Epic's own domain.
2. Sign in there. You land on a page of raw JSON.
3. Copy the `authorizationCode` value and paste it back.

That code is single-use and expires in seconds. The server trades it for a token,
reads your locker, then **kills the session immediately** — nothing is stored.

You get every cosmetic you own with rarity, season, and shop history, plus account
level, battle pass tier, and V-Bucks balance.

The worth figure is what the locker would **cost at shop prices**. Fortnite cosmetics
can't be sold or traded, so that's a sunk cost, not a resale value. Cosmetic prices
have never appeared in any public API, so they're derived from the shop's rarity/type
grid — accurate for typical items, approximate for bundles and crossovers.

> **Worth knowing:** the locker endpoint is the same undocumented Epic API every locker
> checker uses. It's your own account and your own login, but it isn't a *published*
> API, so treat it as unsupported and use it at your own discretion. The username
> lookup below uses fully public data if you'd rather stay on documented ground.

**Fallback:** username lookup gives level and stats but no items. Needs a free key from
[dash.fortnite-api.com](https://dash.fortnite-api.com/).

### Apex Legends — stats, not skins

Respawn has never shipped an inventory API. **No app can read your Apex skins or
heirlooms** — anything claiming otherwise is guessing or lying. What's real: account
level, rank, and per-legend kill/damage/win stats.

Needs a free [Tracker.gg](https://tracker.gg/developers) key (Settings → paste → save).

### Call of Duty — the thin one

Activision shut down its public account APIs in 2023. All that survives is aggregated
Warzone stats, and only while the Activision profile is set to public. Same Tracker.gg
key as Apex. Enter your Activision ID including the numbers (`Name#1234567`).

## Setup for Apex / CoD / Fortnite-by-name

Either click **Settings** in the app and paste your keys, or copy `.env.example` to
`.env`. The UI writes to `data/settings.json`, which is gitignored and never sent back
to the browser — the app only ever reports whether a key exists.

## Layout

```
server.js               routes + error-to-JSON wrapper
src/config.js           Epic client, DevEx rate, env
src/http.js             fetch with timeout, TTL cache, UpstreamError
src/settings.js         persisted API keys
src/providers/
  roblox.js             inventory + Rolimons valuation
  fortnite.js           Epic OAuth, locker, cosmetics catalog
  tracker.js            Apex + CoD via Tracker.gg
public/                 vanilla HTML/CSS/JS, no build step
```

Upstream responses are cached in-process — Rolimons for 6h, the Fortnite catalog
(≈15,800 cosmetics) for 12h — so lookups stay well inside every rate limit.

## Honest limits

- Item **values** only exist for Roblox limiteds. Roblox UGC, Fortnite, Apex, and CoD
  items have no resale market, so "worth" means retail cost there.
- Private profiles return a clear explanation instead of an error. That's the account's
  privacy setting, not a bug.
- Rolimons values are community estimates. Nobody is obligated to pay them.
