import 'dotenv/config';

// Robux -> USD. Roblox's Developer Exchange rate is the only official
// number that converts Robux to real money, so every USD figure in the app
// is "what DevEx would pay", not "what someone would pay you on a trading site".
export const DEVEX_RATE_USD = Number(process.env.DEVEX_RATE_USD || 0.0035);

// Epic's public iOS game client. These are not secrets — they ship inside the
// Fortnite mobile client and are the standard credentials every locker tool
// uses. Kept in config so you can swap in a different client if Epic rotates it.
export const EPIC_CLIENT_ID =
  process.env.EPIC_CLIENT_ID || '3f69e56c7649492c8cc29f1af08a8a12';
export const EPIC_CLIENT_SECRET =
  process.env.EPIC_CLIENT_SECRET || 'b51ee9cb12234f50a69efa67ef53812e';

export const EPIC_BASIC_AUTH = Buffer.from(
  `${EPIC_CLIENT_ID}:${EPIC_CLIENT_SECRET}`
).toString('base64');

// The page that hands the user a one-time authorizationCode after they log in
// on Epic's own domain. We never see their password.
export const EPIC_AUTH_URL =
  `https://www.epicgames.com/id/logout?redirectUrl=` +
  encodeURIComponent(
    `https://www.epicgames.com/id/login?redirectUrl=` +
      encodeURIComponent(
        `https://www.epicgames.com/id/api/redirect?clientId=${EPIC_CLIENT_ID}&responseType=code`
      )
  );

// Optional keys. The app degrades to a "needs key" state instead of failing.
export const TRACKER_API_KEY = process.env.TRACKER_API_KEY || '';
export const FORTNITE_API_KEY = process.env.FORTNITE_API_KEY || '';

export const PORT = Number(process.env.PORT || 3000);
