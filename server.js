require('dotenv').config();

const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const compression = require('compression');
const { createClient } = require('@supabase/supabase-js');

const app = express();

app.use(express.static(path.join(__dirname, 'public')));

app.set('trust proxy', 1);

// ======================================================
// MIDDLEWARE
// ======================================================

// Gzip/Brotli-compresses every response body (HTML, JSON, CSS, JS) before it
// goes out over the wire. The dashboard/earn/game pages are large, mostly
// text (HTML+inline CSS/JS) documents, which typically compress down to a
// fraction of their raw size — this is the single biggest lever on egress
// bandwidth, since previously every response left the server uncompressed.
// Requires the "compression" package (npm install compression).
app.use(compression());

app.use(cors({
  origin: true,
  credentials: true
}));

app.use(express.json({
  limit: '15mb',
  verify: (req, res, buf) => {
    // Crypto Pay webhook signatures are calculated over the exact raw body.
    // Keep a copy before express parses JSON so the webhook can be verified.
    req.rawBody = Buffer.from(buf);
  }
}));

app.use(express.urlencoded({
  limit: '15mb',
  extended: true
}));

// maxAge lets the browser skip re-downloading unchanged static assets
// (images, fonts, client-side libs, etc.) for a day instead of fetching
// them fresh on every page load. HTML files are excluded from that cache
// window (they're revalidated every time) so page updates still show up
// immediately after a deploy.
// ======================================================
// DASHBOARD-ONLY 3D NAVIGATION INJECTION
// ======================================================
// The bottom navigation is injected on the dashboard page ONLY.
// Every other page (earn, withdraw, lucky, leaderboard, tap, game,
// etc.) is served without it, so those pages have no bottom nav bar.
const SHARED_NAV_CSS = `
<style id="payme-shared-nav-style">
.payme-shared-nav{
position:fixed;left:calc(10px + env(safe-area-inset-left,0px));right:calc(10px + env(safe-area-inset-right,0px));
bottom:calc(20px + env(safe-area-inset-bottom,0px));height:74px;z-index:20000;display:flex;align-items:center;
justify-content:space-around;padding:7px;overflow:visible;
background:linear-gradient(145deg,rgba(35,55,88,.99),rgba(10,22,42,.99) 55%,rgba(22,32,58,.99));
border:1px solid rgba(148,190,255,.38);border-top-color:rgba(255,255,255,.28);border-radius:24px;
box-shadow:0 25px 55px rgba(0,0,0,.50),0 9px 22px rgba(0,0,0,.34),inset 0 1px 0 rgba(255,255,255,.24),inset 0 -6px 14px rgba(0,0,0,.28);
backdrop-filter:blur(22px);-webkit-backdrop-filter:blur(22px);transform:translateZ(0);animation:paymeNavRise .55s cubic-bezier(.16,1,.3,1) both;
}
.payme-shared-nav:before{content:"";position:absolute;left:12%;right:12%;top:0;height:2px;border-radius:99px;background:linear-gradient(90deg,transparent,#60a5fa,#a78bfa,#60a5fa,transparent);box-shadow:0 0 14px rgba(96,165,250,.55);pointer-events:none}
.payme-shared-nav a{position:relative;width:25%;height:60px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;text-align:center;text-decoration:none;color:#c7d7ee;font-size:.58rem;font-weight:900;border-radius:17px;transition:transform .24s ease,color .24s ease,background .24s ease,box-shadow .24s ease}
.payme-shared-nav a:before{content:"";position:absolute;inset:3px;border-radius:15px;background:linear-gradient(135deg,rgba(96,165,250,.20),rgba(167,139,250,.16));opacity:0;transform:translateX(-18px);pointer-events:none}
.payme-shared-nav a.active{color:#fff;background:linear-gradient(135deg,rgba(59,130,246,.38),rgba(124,58,237,.30));box-shadow:inset 0 1px 0 rgba(255,255,255,.20),0 8px 20px rgba(37,99,235,.28);transform:translateY(-3px)}
.payme-shared-nav a.active:before{opacity:1;animation:paymeNavSwitch .38s cubic-bezier(.16,1,.3,1) both}
.payme-shared-nav a:after{content:"";position:absolute;left:50%;bottom:3px;width:0;height:3px;border-radius:99px;background:linear-gradient(90deg,#60a5fa,#c4b5fd);box-shadow:0 0 14px rgba(96,165,250,.75);transform:translateX(-50%);transition:width .25s ease}
.payme-shared-nav a.active:after{width:28px}
.payme-shared-nav .payme-nav-icon{position:relative;z-index:1;display:block;font-size:1.2rem;line-height:1;filter:drop-shadow(0 3px 5px rgba(0,0,0,.45));transition:transform .24s ease,filter .24s ease}
.payme-shared-nav a span:last-child{position:relative;z-index:1}
.payme-shared-nav a.active .payme-nav-icon{transform:translateY(-1px) scale(1.10);filter:drop-shadow(0 0 10px rgba(96,165,250,.75))}
.payme-shared-nav a:active{transform:translateY(0) scale(.94)}
@keyframes paymeNavSwitch{from{opacity:0;transform:translateX(-18px) scale(.96)}to{opacity:1;transform:translateX(0) scale(1)}}
@keyframes paymeNavRise{from{opacity:0;transform:translateY(30px) scale(.97)}to{opacity:1;transform:translateY(0) scale(1)}}
@media(max-width:899px){.payme-shared-nav{display:flex}}
@media(min-width:900px){.payme-shared-nav{display:none}}
@media(prefers-reduced-motion:reduce){.payme-shared-nav{animation:none}.payme-shared-nav a.active:before{animation:none}}
</style>`;

function sharedNavMarkup(requestPath) {
  const cleanPath = String(requestPath || '').split('?')[0].split('#')[0];
  const isEarn = cleanPath === '/earn' || cleanPath === '/earn.html';
  const isLeaderboard = cleanPath === '/leaderboard.html' || cleanPath === '/leaderboard';
  const isDashboard = cleanPath === '/' || cleanPath === '/dashboard.html';
  return `
<nav class="payme-shared-nav" aria-label="PAYME navigation">
  <a href="/dashboard.html" class="${isDashboard ? 'active' : ''}">
    <span class="payme-nav-icon">🏠</span><span>Home</span>
  </a>
  <a href="/earn" class="${isEarn ? 'active' : ''}">
    <span class="payme-nav-icon">💎</span><span>Earn</span>
  </a>
  <a href="/dashboard.html#referrals">
    <span class="payme-nav-icon">👥</span><span>Refer</span>
  </a>
  <a href="/leaderboard.html" class="${isLeaderboard ? 'active' : ''}">
    <span class="payme-nav-icon">🏆</span><span>Ranking</span>
  </a>
</nav>`;
}

app.use(async (req, res, next) => {
  // Only intercept HTML document requests and known HTML aliases. Static assets continue through
  // express.static unchanged, preserving the existing caching/egress setup.
  const pathname = String(req.path || '');
  const wantsHtml = pathname.endsWith('.html') || pathname === '/' || req.accepts('html');
  if (!wantsHtml) return next();

  let filePath;
  const htmlAliases = {
    '/': 'index.html',
    '/earn': 'earn.html',
    '/withdraw': 'withdraw.html',
    '/lucky': 'lucky.html',
    '/leaderboard': 'leaderboard.html',
    '/tap': 'tap.html',
    '/game': 'game.html'
  };

  if (htmlAliases[pathname]) {
    filePath = path.join(__dirname, 'public', htmlAliases[pathname]);
  } else {
    const relative = pathname.replace(/^\/+/, '');
    if (!relative || relative.includes('..') || !relative.endsWith('.html')) return next();
    filePath = path.join(__dirname, 'public', relative);
  }

  try {
    const stat = await fs.promises.stat(filePath);
    if (!stat.isFile()) return next();

    let html = await fs.promises.readFile(filePath, 'utf8');

    // The bottom nav is now dashboard-only — every other page (earn,
    // withdraw, lucky, leaderboard, tap, game, etc.) is served as-is,
    // with no nav injected at all.
    const cleanPath = pathname.split('?')[0].split('#')[0];
    const isDashboard = cleanPath === '/' || cleanPath === '/dashboard.html';

    if (isDashboard) {
      // Dashboard already contains its own nav. Remove only its old bottom
      // mobile nav so the server-provided version is the single one shown.
      html = html.replace(/<!-- MOBILE NAV -->[\s\S]*?<\/nav>/i, '');

      const injection = SHARED_NAV_CSS + sharedNavMarkup(pathname);
      if (/<\/body>/i.test(html)) {
        html = html.replace(/<\/body>/i, injection + '</body>');
      } else {
        html += injection;
      }
    }

    res.setHeader('Cache-Control', 'no-cache');
    res.type('html').send(html);
  } catch (err) {
    if (err && err.code === 'ENOENT') return next();
    console.error('HTML navigation injection error:', err);
    return next();
  }
});

app.use(express.static(
  path.join(__dirname, 'public'),
  {
    maxAge: '1d',
    setHeaders: (res, filePath) => {
      if (filePath.endsWith('.html')) {
        res.setHeader('Cache-Control', 'no-cache');
      }
    }
  }
));

// ======================================================
// CONFIGURATION
// ======================================================

function normalizeSupabaseUrl(value) {

  const raw =
    String(value || '')
      .trim()
      .replace(/\/+$/, '');

  if (!raw) {
    return '';
  }

  // Prevent accidental:
  // https://project.supabase.co/rest/v1/rest/v1
  return raw.replace(
    /\/rest\/v1$/i,
    ''
  );
}

const SUPABASE_URL =
  normalizeSupabaseUrl(
    process.env.SUPABASE_URL
  );

const SUPABASE_SERVICE_ROLE_KEY =
  String(
    process.env.SUPABASE_SERVICE_ROLE_KEY || ''
  ).trim();

if (
  !SUPABASE_URL ||
  !SUPABASE_SERVICE_ROLE_KEY
) {

  throw new Error(
    'SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be configured. ' +
    'Use .env in Termux or Environment Variables in Render.'
  );

}

const supabase =
  createClient(
    SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false
      }
    }
  );

const TELEGRAM_BOT_TOKEN =
  String(
    process.env.TELEGRAM_BOT_TOKEN || ''
  ).trim();

// Separate bot dedicated to deposit approve/reject callbacks.
// This MUST be a different bot from TELEGRAM_BOT_TOKEN above, because
// that bot is used for Mini App login (initData) and other Telegram
// API calls. A single bot token can only run ONE update method at a
// time (getUpdates polling OR a webhook) — since this deposit flow
// polls with getUpdates, it needs its own bot so it never conflicts
// with a webhook set on the main bot (e.g. by a menu-builder tool).
const TELEGRAM_DEPOSIT_BOT_TOKEN =
  String(
    process.env.TELEGRAM_DEPOSIT_BOT_TOKEN || ''
  ).trim();

const TELEGRAM_CHAT_ID =
  String(
    process.env.TELEGRAM_CHAT_ID || ''
  ).trim();

const SESSION_SECRET =
  String(
    process.env.PAYME_SESSION_SECRET || ''
  ).trim();

if (!SESSION_SECRET) {
  throw new Error(
    'PAYME_SESSION_SECRET must be configured in the environment.'
  );
}

const SESSION_MAX_AGE =
  10 *
  365 *
  24 *
  60 *
  60 *
  1000;

// ======================================================
// CRYPTOBOT / GLOBAL GEMS PAYMENTS
// ======================================================
// CryptoBot uses USD-priced fiat invoices, so the user can pay with a
// supported cryptocurrency while the platform keeps its internal currency
// as Gems. 1 Gem represents the USD value of 1 NGN at the configured rate;
// it is NOT equal to $1.
const CRYPTOBOT_TOKEN = String(process.env.CRYPTOBOT_TOKEN || '').trim();
const CRYPTOBOT_API_BASE = String(
  process.env.CRYPTOBOT_API_BASE || 'https://pay.crypt.bot/api'
).replace(/\/+$/, '');

let NGN_PER_USD = Math.max(1, number(process.env.NGN_PER_USD) || 1500);
let GEM_USD_RATE = Math.max(
  0.00000001,
  number(process.env.GEM_USD_RATE) || (1 / NGN_PER_USD)
);
let liveGemRateUpdatedAt = 0;
const LIVE_GEM_RATE_TTL_MS = 60 * 1000;

const MIN_CRYPTO_USD = 0.50;
const CRYPTO_ASSETS = ['USDT', 'TON', 'BTC', 'ETH', 'LTC', 'BNB', 'TRX', 'USDC'];

const isProduction =
  process.env.NODE_ENV === 'production';

// ======================================================
// REWARDS / LIMITS
// ======================================================

const WELCOME_BONUS = 10;

const REFERRAL_REWARD = 15;

let MIN_WITHDRAWAL_LIMIT = Math.ceil(MIN_CRYPTO_USD / GEM_USD_RATE);

// One withdrawal per rolling 24-hour period. The timestamp is persisted
// in the Supabase transactions table, so it survives Render redeploys.
const WITHDRAWAL_COOLDOWN = 24 * 60 * 60 * 1000;

let MIN_DEPOSIT_AMOUNT = Math.ceil(MIN_CRYPTO_USD / GEM_USD_RATE);

const SPIN_COST = 50;

// ======================================================
// MONETAG REWARDED INTERSTITIAL
// ======================================================
// Monetag zone supplied for PAYME.
const MONETAG_ZONE_ID = '11688228';

// The postback endpoint is intentionally public because Monetag's
// servers must be able to call it. Reward decisions are made here,
// not in dashboard.html.
const MONETAG_POSTBACK_PATH = '/api/monetag/postback';

// A short watch-session window lets us associate a browser ad request
// with the logged-in PAYME user while still allowing Monetag to call
// the postback asynchronously.
const MONETAG_SESSION_TTL = 10 * 60 * 1000;
const MONETAG_REWARD_COOLDOWN = 10 * 1000;

// Shared reward table for every "watch a rewarded ad" surface in the app —
// the dashboard's floating ad reel, the Earn page's "Watch Ads & Earn"
// button, and the game page's "Watch Ad, Claim Free Spins" button all pull
// from this single table now, so all three pay out the same free-spin
// amounts at the exact same odds. 100,000 secure-random slots are used
// server-side. 0.02 and 0.05 are deliberately the overwhelmingly common
// outcomes (together ~85% of plays), 0.1 is fairly common (~11%), and every
// tier above that gets rarer very fast — the top tiers (1 and especially 2
// Free Spins) are made extremely hard to hit. There is no cash payout from
// any of these three ad surfaces anymore.
const AD_WATCH_FREESPIN_REWARD_SLOTS = [
  { max: 50000, key: 'fs_002', label: '0.02 Free Spin', cash: 0, spins: 0.02 },
  { max: 85000, key: 'fs_005', label: '0.05 Free Spin', cash: 0, spins: 0.05 },
  { max: 96000, key: 'fs_01',  label: '0.1 Free Spin',  cash: 0, spins: 0.1 },
  { max: 99000, key: 'fs_02',  label: '0.2 Free Spin',  cash: 0, spins: 0.2 },
  { max: 99800, key: 'fs_05',  label: '0.5 Free Spin',  cash: 0, spins: 0.5 },
  { max: 99970, key: 'fs_1',   label: '1 Free Spin',    cash: 0, spins: 1 },
  { max: 100000,key: 'fs_2',   label: '2 Free Spins',   cash: 0, spins: 2 }
];

// userId -> pending watch session
const monetagPendingSessions = new Map();
const monetagCompletedSessions = new Map();
// Short-lived server marker used only to detect that a newly onboarded user
// actually consumed the free spin before returning to the dashboard. It is
// intentionally in-memory to avoid another Supabase read/write and expires quickly.
const recentFreeSpinCompletions = new Map();

function cleanupMonetagSessions() {
  const now = Date.now();
  for (const [sessionId, session] of monetagPendingSessions.entries()) {
    if (!session || now > number(session.expiresAt)) {
      monetagPendingSessions.delete(sessionId);
    }
  }

  for (const [sessionId, session] of monetagCompletedSessions.entries()) {
    if (!session || now > number(session.expiresAt)) {
      monetagCompletedSessions.delete(sessionId);
    }
  }
}

setInterval(cleanupMonetagSessions, 60 * 1000).unref();


// ======================================================
// LUCKY 3 CONFIGURATION
// ======================================================
// Keep the payout table centralized. The same values are
// validated by the database RPC used by /api/games/lucky3/play.
const LUCKY3_CONFIG = {
  numberMin: 1,
  numberMax: 30,
  stakes: {
    100: { jackpot: 2000, cash: 700, bonusFreeSpins: 2 },
    200: { jackpot: 5000, cash: 1500, bonusFreeSpins: 5 },
    500: { jackpot: 15000, cash: 4000, bonusFreeSpins: 12 }
  }
};


const LUCKY3_GAME_TYPES = new Set([
  'jackpot',
  'cash',
  'bonus'
]);

// ======================================================
// LUCK TICKETS / TREASURE CHESTS
// ======================================================
// Luck Tickets live inside the existing daily_reward JSON column so this
// feature does not require a new Supabase column. The state is server-owned
// and therefore survives page exits and Render redeploys.
// Single chest: 2 rewarded ads to open. A 60-second gap is enforced
// between the first and second ad, and a 24-hour cooldown starts once
// the chest is opened and the ticket reward is granted. Reward is
// weighted heavily toward the low end of the 20-50 range — anything
// above 30 is intentionally rare.
const LUCK_CHEST_CONFIG = {
  chest: {
    ads: 2,
    adGapMs: 60 * 1000,
    cooldownMs: 24 * 60 * 60 * 1000,
    min: 20,
    max: 50,
    rewards: [
      { max: 55, tickets: 20 },
      { max: 78, tickets: 22 },
      { max: 90, tickets: 25 },
      { max: 96, tickets: 28 },
      { max: 98.5, tickets: 30 },
      { max: 99.4, tickets: 35 },
      { max: 99.8, tickets: 40 },
      { max: 100, tickets: 50 }
    ]
  }
};

// Double Your Gems — weighted coin flip.
// The server alone decides the outcome: 20% win / 80% loss.
// The result is independent of stake size and the user's selected side.
const COIN_FLIP_CONFIG = {
  min: 10,
  max: 1000,
  winChance: 0.20
};

const CLAIM_COOLDOWN =
  24 *
  60 *
  60 *
  1000;

// ======================================================
// GENERIC HELPERS
// ======================================================

function generateUserId() {

  return (
    'usr_' +
    Date.now().toString(36) +
    '_' +
    crypto
      .randomBytes(6)
      .toString('hex')
  );

}

function generateTransactionId(
  prefix
) {

  return (
    prefix +
    '_' +
    Date.now().toString(36) +
    '_' +
    crypto
      .randomBytes(5)
      .toString('hex')
  );

}

function generateDepositReference() {

  return (
    'PM-' +
    crypto
      .randomBytes(4)
      .toString('hex')
      .toUpperCase()
  );

}

function generateReferralCode() {

  const chars =
    'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

  let code = '';

  for (
    let i = 0;
    i < 6;
    i++
  ) {

    code +=
      chars.charAt(
        Math.floor(
          Math.random() *
          chars.length
        )
      );

  }

  return code;

}

async function generateUniqueReferralCode() {

  for (
    let attempt = 0;
    attempt < 30;
    attempt++
  ) {

    const code =
      generateReferralCode();

    const {
      data,
      error
    } =
      await supabase
        .from('users')
        .select('id')
        .eq(
          'referral_code',
          code
        )
        .maybeSingle();

    if (error) {
      throw error;
    }

    if (!data) {
      return code;
    }

  }

  throw new Error(
    'Could not generate a unique referral code.'
  );

}

function number(value) {

  const n =
    Number(value);

  return Number.isFinite(n)
    ? n
    : 0;

}

// ======================================================
// LIVE GEM/USD RATE
// ======================================================
// 1 Gem is pegged to the USD value of 1 NGN.
// Since USDT tracks USD closely, the live USD value of one Gem is
// calculated as 1 / the current NGN-per-USD rate.
// The FX result is cached for 60 seconds to avoid unnecessary
// external traffic on dashboard loads.
async function refreshLiveGemRate(force = false) {
  const now = Date.now();

  if (
    !force &&
    liveGemRateUpdatedAt &&
    now - liveGemRateUpdatedAt < LIVE_GEM_RATE_TTL_MS
  ) {
    return {
      ngnPerUsd: NGN_PER_USD,
      gemUsdRate: GEM_USD_RATE
    };
  }

  try {
    const response = await fetch(
      'https://open.er-api.com/v6/latest/USD'
    );

    if (!response.ok) {
      throw new Error(
        `Live FX service returned HTTP ${response.status}`
      );
    }

    const data = await response.json();
    const liveNgnPerUsd = Number(data?.rates?.NGN);

    if (
      !Number.isFinite(liveNgnPerUsd) ||
      liveNgnPerUsd <= 0
    ) {
      throw new Error('Live NGN/USD rate was invalid.');
    }

    NGN_PER_USD = liveNgnPerUsd;
    GEM_USD_RATE = 1 / liveNgnPerUsd;

    MIN_WITHDRAWAL_LIMIT =
      Math.ceil(MIN_CRYPTO_USD / GEM_USD_RATE);

    MIN_DEPOSIT_AMOUNT =
      Math.ceil(MIN_CRYPTO_USD / GEM_USD_RATE);

    liveGemRateUpdatedAt = now;
  } catch (err) {
    // Keep the last known/env-configured rate if the FX service is
    // temporarily unavailable. The dashboard will still function.
    console.warn(
      'Live NGN/USD rate refresh failed; using last known rate:',
      err.message
    );
  }

  return {
    ngnPerUsd: NGN_PER_USD,
    gemUsdRate: GEM_USD_RATE
  };
}

// ======================================================
// USER MAPPING
// ======================================================

function mapUser(row) {

  if (!row) {
    return null;
  }

  const daily =
    row.daily_reward &&
    typeof row.daily_reward === 'object'
      ? row.daily_reward
      : {
          currentDay: 1,
          lastClaimTimestamp: 0,
          claimedDays: []
        };

  return {

    id:
      row.id,

    telegramId:
      row.telegram_id,

    fullName:
      row.full_name || '',

    email:
      row.email || '',

    username:
      row.username || '',

    phone:
      row.phone || '',

    password:
      row.password || '',

    balance:
      number(row.balance),

    depositBalance:
      number(row.deposit_balance),

    withdrawableBalance:
      number(
        row.withdrawable_balance
      ),

    hasReceivedWelcomeBonus:
      !!row.has_received_welcome_bonus,

    hasSeenPopup:
      !!row.has_seen_popup,

    referralCode:
      row.referral_code,

    referredBy:
      row.referred_by,

    totalReferrals:
      number(row.total_referrals),

    successfulReferrals:
      number(
        row.successful_referrals
      ),

    referralEarnings:
      number(
        row.referral_earnings
      ),

    freeSpins:
      number(row.free_spins),

    hasClaimedGiftBox:
      !!row.has_claimed_gift_box,

    sessionVersion:
      number(row.session_version),

    luckTickets:
      number(daily.luckTickets),

    luckChests: {
      chest: {
        progress: Math.max(0, Math.min(2, number(daily.luckChests?.chest?.progress))),
        firstAdAt: Number(daily.luckChests?.chest?.firstAdAt) || 0,
        cooldownUntil: Number(daily.luckChests?.chest?.cooldownUntil) || 0
      }
    },

    dailyReward: {
      ...daily,
      currentDay:
        number(
          daily.currentDay
        ) || 1,
      lastClaimTimestamp:
        number(
          daily.lastClaimTimestamp
        ),
      claimedDays:
        Array.isArray(
          daily.claimedDays
        )
          ? daily.claimedDays.map(Number)
          : []
    },

    createdAt:
      row.created_at

  };

}


// ======================================================
// USER -> SUPABASE PATCH
// ======================================================
function userDbPatch(user) {
  return {

    // IMPORTANT:
    // Supabase users.id is the PRIMARY KEY.
    // It must be included when creating a new user.
    id:
      user.id || null,

    telegram_id:
      user.telegramId || null,

    full_name:
      user.fullName || null,

    email:
      user.email || null,

    username:
      user.username || null,

    phone:
      user.phone || null,

    password:
      user.password || null,

    balance:
      number(
        user.balance
      ),

    deposit_balance:
      number(
        user.depositBalance
      ),

    withdrawable_balance:
      number(
        user.withdrawableBalance
      ),

    has_received_welcome_bonus:
      !!user.hasReceivedWelcomeBonus,

    has_seen_popup:
      !!user.hasSeenPopup,

    referral_code:
      user.referralCode || null,

    referred_by:
      user.referredBy || null,

    total_referrals:
      number(
        user.totalReferrals
      ),

    successful_referrals:
      number(
        user.successfulReferrals
      ),

    referral_earnings:
      number(
        user.referralEarnings
      ),

    free_spins:
      number(
        user.freeSpins
      ),

    has_claimed_gift_box:
      !!user.hasClaimedGiftBox,

    session_version:
      number(
        user.sessionVersion
      ),

    daily_reward:
      user.dailyReward || {
        currentDay:
          1,

        lastClaimTimestamp:
          0,

        claimedDays:
          []
      }

  };
}

// ======================================================
// SUPABASE USER OPERATIONS
// ======================================================

async function updateUser(user) {

  syncUserBalance(user);

  const {
    error
  } =
    await supabase
      .from('users')
      .update(
        userDbPatch(user)
      )
      .eq(
        'id',
        user.id
      );

  if (error) {
    throw error;
  }

  // The caller already has the updated user object.
  // Avoid selecting the entire row again just to return it.
  return user;

}

async function getUserById(id) {

  if (!id) {
    return null;
  }

  const {
    data,
    error
  } =
    await supabase
      .from('users')
      .select('*')
      .eq(
        'id',
        String(id)
      )
      .maybeSingle();

  if (error) {
    throw error;
  }

  return mapUser(data);

}

async function getUserByTelegramId(
  telegramId
) {

  if (!telegramId) {
    return null;
  }

  const {
    data,
    error
  } =
    await supabase
      .from('users')
      .select('*')
      .eq(
        'telegram_id',
        String(telegramId)
      )
      .maybeSingle();

  if (error) {
    throw error;
  }

  return mapUser(data);

}

async function getUserByUsername(
  username
) {

  if (!username) {
    return null;
  }

  const {
    data,
    error
  } =
    await supabase
      .from('users')
      .select('*')
      .eq(
        'username',
        String(username)
          .toLowerCase()
      )
      .maybeSingle();

  if (error) {
    throw error;
  }

  return mapUser(data);

}

async function getUserByEmail(
  email
) {

  if (!email) {
    return null;
  }

  const {
    data,
    error
  } =
    await supabase
      .from('users')
      .select('*')
      .eq(
        'email',
        String(email)
          .toLowerCase()
      )
      .maybeSingle();

  if (error) {
    throw error;
  }

  return mapUser(data);

}

async function getUserByReferralCode(
  code
) {

  if (!code) {
    return null;
  }

  const {
    data,
    error
  } =
    await supabase
      .from('users')
      .select('*')
      .eq(
        'referral_code',
        String(code).toUpperCase()
      )
      .maybeSingle();

  if (error) {
    throw error;
  }

  return mapUser(data);

}

async function createUser(user) {

  const {
    data,
    error
  } =
    await supabase
      .from('users')
      .insert(
        userDbPatch(user)
      )
      .select('*')
      .single();

  if (error) {
    throw error;
  }

  return mapUser(data);

}

// ======================================================
// TRANSACTIONS
// ======================================================

async function addTransaction(
  userId,
  tx
) {

  const row = {

    id:
      tx.id ||
      generateTransactionId('tx'),

    user_id:
      userId,

    type:
      tx.type ||
      'transaction',

    description:
      tx.description ||
      '',

    amount:
      number(tx.amount),

    currency:
      tx.currency ||
      'GEMS',

    status:
      tx.status ||
      'completed',

    bank:
      tx.bank ||
      null,

    account_name:
      tx.accountName ||
      null,

    account_number:
      tx.accountNumber ||
      null,

    created_at:
      tx.createdAt ||
      new Date().toISOString()

  };

  const {
    error
  } =
    await supabase
      .from('transactions')
      .insert(row);

  if (error) {
    throw error;
  }

  // The inserted row is already available locally.
  // Do not download it back from Supabase.
  return row;

}

async function getTransactions(
  userId,
  limit = 25
) {

  const safeLimit = Math.min(
    Math.max(Number(limit) || 25, 1),
    50
  );

  const {
    data,
    error
  } =
    await supabase
      .from('transactions')
      .select(`
        id,
        type,
        description,
        amount,
        currency,
        status,
        bank,
        account_name,
        account_number,
        created_at
      `)
      .eq(
        'user_id',
        userId
      )
      .order(
        'created_at',
        {
          ascending: false
        }
      )
      .limit(safeLimit);

  if (error) {
    throw error;
  }

  return (
    data || []
  ).map(
    t => ({

      id:
        t.id,

      type:
        t.type,

      description:
        t.description,

      amount:
        number(t.amount),

      currency:
        t.currency,

      status:
        t.status,

      bank:
        t.bank,

      accountName:
        t.account_name,

      accountNumber:
        t.account_number,

      createdAt:
        t.created_at

    })
  );

}

async function getRecentSpins(
  userId,
  limit = 20
) {

  const safeLimit = Math.min(
    Math.max(Number(limit) || 20, 1),
    50
  );

  const {
    data,
    error
  } =
    await supabase
      .from('transactions')
      .select(`
        id,
        type,
        description,
        amount,
        currency,
        status,
        created_at
      `)
      .eq(
        'user_id',
        userId
      )
      .ilike(
        'type',
        '%Spin%'
      )
      .order(
        'created_at',
        {
          ascending: false
        }
      )
      .limit(safeLimit);

  if (error) {
    throw error;
  }

  return (
    data || []
  ).map(
    t => ({
      id: t.id,
      type: t.type,
      description: t.description,
      amount: number(t.amount),
      currency: t.currency,
      status: t.status,
      createdAt: t.created_at
    })
  );

}

// ======================================================
// DEPOSITS
// ======================================================

async function getUserDeposits(
  userId,
  limit = 25
) {

  const safeLimit = Math.min(
    Math.max(Number(limit) || 25, 1),
    50
  );

  const {
    data,
    error
  } =
    await supabase
      .from('deposits')
      .select(`
        reference,
        amount,
        status,
        reason,
        created_at
      `)
      .eq(
        'user_id',
        userId
      )
      .order(
        'created_at',
        {
          ascending: false
        }
      )
      .limit(safeLimit);

  if (error) {
    throw error;
  }

  return (
    data || []
  ).map(
    d => ({

      reference:
        d.reference,

      amount:
        number(d.amount),

      status:
        d.status,

      reason:
        d.reason,

      createdAt:
        d.created_at

    })
  );

}

async function getDeposit(
  reference
) {

  const {
    data,
    error
  } =
    await supabase
      .from('deposits')
      .select('*')
      .eq(
        'reference',
        reference
      )
      .maybeSingle();

  if (error) {
    throw error;
  }

  return data;

}

// ======================================================
// BALANCE HELPERS
// ======================================================

function getDepositBalance(
  user
) {

  return Math.max(
    0,
    number(
      user.depositBalance
    )
  );

}

function getWithdrawableBalance(
  user
) {

  return Math.max(
    0,
    number(
      user.withdrawableBalance
    )
  );

}

function syncUserBalance(
  user
) {

  user.depositBalance =
    getDepositBalance(user);

  user.withdrawableBalance =
    getWithdrawableBalance(user);

  user.balance =
    user.depositBalance +
    user.withdrawableBalance;

  return user.balance;

}

async function loadUserData(
  user
) {

  if (!user) {
    return null;
  }

  const [
    transactions,
    deposits
  ] =
    await Promise.all([

      getTransactions(
        user.id
      ),

      getUserDeposits(
        user.id
      )

    ]);

  user.transactions =
    transactions;

  user.deposits =
    deposits;

  syncUserBalance(user);

  return user;

}

// ======================================================
// SESSION SYSTEM
// ======================================================

function base64UrlEncode(
  value
) {

  return Buffer
    .from(value)
    .toString('base64')
    .replace(
      /\+/g,
      '-'
    )
    .replace(
      /\//g,
      '_'
    )
    .replace(
      /=+$/,
      ''
    );

}

function base64UrlDecode(
  value
) {

  let v =
    String(value)
      .replace(
        /-/g,
        '+'
      )
      .replace(
        /_/g,
        '/'
      );

  while (
    v.length % 4
  ) {
    v += '=';
  }

  return Buffer
    .from(
      v,
      'base64'
    )
    .toString('utf8');

}

function createSignature(
  payload
) {

  return crypto
    .createHmac(
      'sha256',
      SESSION_SECRET
    )
    .update(payload)
    .digest('base64')
    .replace(
      /\+/g,
      '-'
    )
    .replace(
      /\//g,
      '_'
    )
    .replace(
      /=+$/,
      ''
    );

}

function createSessionToken(
  user
) {

  const payload =
    base64UrlEncode(
      JSON.stringify({

        userId:
          user.id,

        sessionVersion:
          number(
            user.sessionVersion
          ),

        expiresAt:
          Date.now() +
          SESSION_MAX_AGE

      })
    );

  return (
    payload +
    '.' +
    createSignature(payload)
  );

}

function verifySessionToken(
  token
) {

  try {

    if (
      !token ||
      typeof token !== 'string'
    ) {
      return null;
    }

    const parts =
      token.split('.');

    if (
      parts.length !== 2
    ) {
      return null;
    }

    const expected =
      createSignature(
        parts[0]
      );

    const a =
      Buffer.from(
        parts[1]
      );

    const b =
      Buffer.from(
        expected
      );

    if (
      a.length !== b.length
    ) {
      return null;
    }

    if (
      !crypto.timingSafeEqual(
        a,
        b
      )
    ) {
      return null;
    }

    const decoded =
      JSON.parse(
        base64UrlDecode(
          parts[0]
        )
      );

    if (
      !decoded.userId ||
      !decoded.expiresAt
    ) {
      return null;
    }

    if (
      Date.now() >
      number(
        decoded.expiresAt
      )
    ) {
      return null;
    }

    return decoded;

  } catch {

    return null;

  }

}

function getCookie(
  req,
  name
) {

  const header =
    req.headers.cookie;

  if (!header) {
    return null;
  }

  for (
    const cookie of
    header.split(';')
  ) {

    const i =
      cookie.indexOf('=');

    if (i === -1) {
      continue;
    }

    const key =
      cookie
        .slice(0, i)
        .trim();

    if (
      key !== name
    ) {
      continue;
    }

    const value =
      cookie
        .slice(i + 1)
        .trim();

    try {

      return decodeURIComponent(
        value
      );

    } catch {

      return value;

    }

  }

  return null;

}

function setSessionCookie(
  res,
  token
) {

  const parts = [

    `payme_session=${encodeURIComponent(token)}`,

    'Path=/',

    `Max-Age=${Math.floor(
      SESSION_MAX_AGE / 1000
    )}`,

    'HttpOnly',

    'SameSite=Lax'

  ];

  if (isProduction) {
    parts.push('Secure');
  }

  res.setHeader(
    'Set-Cookie',
    parts.join('; ')
  );

}

function clearSessionCookie(
  res
) {

  const parts = [

    'payme_session=',

    'Path=/',

    'Max-Age=0',

    'HttpOnly',

    'SameSite=Lax'

  ];

  if (isProduction) {
    parts.push('Secure');
  }

  res.setHeader(
    'Set-Cookie',
    parts.join('; ')
  );

}

// ======================================================
// AUTHENTICATION MIDDLEWARE
// ======================================================

async function authenticateRequest(
  req,
  res,
  next
) {

  req.session = null;
  req.user = null;

  try {

    const token =
      getCookie(
        req,
        'payme_session'
      );

    if (!token) {
      return next();
    }

    const session =
      verifySessionToken(
        token
      );

    if (!session) {

      clearSessionCookie(res);

      return next();

    }

    const user =
      await getUserById(
        session.userId
      );

    if (
      !user ||
      number(
        user.sessionVersion
      ) !==
      number(
        session.sessionVersion
      )
    ) {

      clearSessionCookie(res);

      return next();

    }

    req.session = {
      userId:
        user.id
    };

    // Keep authentication lightweight. Transaction and deposit
    // history is fetched only by endpoints that need it.
    req.user = user;

    return next();

  } catch (err) {

    console.error(
      'Authentication middleware error:',
      err
    );

    clearSessionCookie(res);

    return next();

  }

}


// ======================================================
// CRYPTOBOT API HELPERS
// ======================================================
async function cryptoBotRequest(method, params = {}) {
  if (!CRYPTOBOT_TOKEN) {
    throw new Error('CRYPTOBOT_TOKEN is not configured.');
  }

  const options = {
    method,
    headers: {
      'Crypto-Pay-API-Token': CRYPTOBOT_TOKEN
    }
  };

  let url = `${CRYPTOBOT_API_BASE}/${params._method || ''}`.replace(/\/+$/, '');
  delete params._method;

  if (method === 'GET') {
    const qs = new URLSearchParams();
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== null) qs.set(key, String(value));
    });
    const query = qs.toString();
    if (query) url += `?${query}`;
  } else {
    options.headers['Content-Type'] = 'application/json';
    options.body = JSON.stringify(params);
  }

  const response = await fetch(url, options);
  const data = await response.json().catch(() => ({}));

  if (!response.ok || !data.ok) {
    const message = data?.error?.name || data?.error || `CryptoBot API HTTP ${response.status}`;
    throw new Error(String(message));
  }

  return data.result;
}

async function cryptoBotCreateInvoice({ gems, usd, reference }) {
  return cryptoBotRequest('POST', {
    _method: 'createInvoice',
    currency_type: 'fiat',
    fiat: 'USD',
    amount: usd.toFixed(2),
    accepted_assets: CRYPTO_ASSETS.join(','),
    description: `PAYME wallet funding — ${gems.toLocaleString()} Gems`,
    hidden_message: `PAYME deposit ${reference}`,
    payload: reference,
    allow_comments: false,
    allow_anonymous: false,
    expires_in: 3600
  });
}

async function cryptoBotGetRates() {
  return cryptoBotRequest('GET', { _method: 'getExchangeRates' });
}

async function cryptoBotGetCurrencies() {
  return cryptoBotRequest('GET', { _method: 'getCurrencies' });
}

async function cryptoBotGetBalance() {
  return cryptoBotRequest('GET', { _method: 'getBalance' });
}

async function cryptoBotTransfer({ telegramId, asset, amount, spendId, comment }) {
  return cryptoBotRequest('POST', {
    _method: 'transfer',
    user_id: Number(telegramId),
    asset,
    amount,
    spend_id: spendId,
    comment,
    disable_send_notification: false
  });
}

function verifyCryptoBotWebhook(req) {
  const signature = String(
    req.headers['crypto-pay-api-signature'] ||
    req.headers['tgcryptopay-api-signature'] ||
    ''
  ).trim();
  if (!signature || !req.rawBody || !CRYPTOBOT_TOKEN) return false;

  const secret = crypto.createHash('sha256').update(CRYPTOBOT_TOKEN).digest();
  const expected = crypto.createHmac('sha256', secret).update(req.rawBody).digest('hex');

  if (signature.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
}

function gemUsd(gems) {
  return Number(gems) * GEM_USD_RATE;
}

function usdToGems(usd) {
  return Number(usd) / GEM_USD_RATE;
}

function cryptoAmountFromUsd(usd, asset, rates, currencies) {
  const rate = (rates || []).find(r =>
    String(r.source).toUpperCase() === asset &&
    String(r.target).toUpperCase() === 'USD' &&
    r.is_valid !== false
  );
  if (!rate) throw new Error(`No current USD rate is available for ${asset}.`);

  const numericRate = Number(rate.rate);
  if (!Number.isFinite(numericRate) || numericRate <= 0) {
    throw new Error(`Invalid USD rate for ${asset}.`);
  }

  const currency = (currencies || []).find(c => String(c.code).toUpperCase() === asset);
  const decimals = Number.isInteger(Number(currency?.decimals))
    ? Number(currency.decimals)
    : 8;
  const raw = Number(usd) / numericRate;
  const factor = 10 ** Math.min(decimals, 18);
  return {
    rate: numericRate,
    decimals,
    amount: Math.floor(raw * factor) / factor
  };
}

// ======================================================
// CRYPTOBOT WEBHOOK — DEPOSIT CONFIRMATION
// ======================================================
app.post('/api/crypto/webhook', async (req, res) => {
  try {
    if (!verifyCryptoBotWebhook(req)) {
      return res.status(401).send('invalid signature');
    }

    const update = req.body || {};
    if (update.update_type !== 'invoice_paid') {
      return res.status(200).send('ignored');
    }

    const invoice = update.payload || {};
    const reference = String(invoice.payload || '').trim();
    if (!reference) return res.status(200).send('missing payload');

    const deposit = await getDeposit(reference);
    if (!deposit) return res.status(404).send('deposit not found');

    // Webhooks may be delivered more than once. Only Pending Verification
    // deposits are allowed to credit Gems.
    if (deposit.status !== 'Pending Verification') {
      return res.status(200).send('already processed');
    }

    const gems = number(deposit.amount);
    const usd = gemUsd(gems);
    const paidUsd = number(invoice.paid_usd_rate) > 0
      ? number(invoice.paid_amount) * number(invoice.paid_usd_rate)
      : usd;

    // A fiat invoice is the source of truth for the USD price. Do not credit
    // a payment that is materially below the invoice value.
    if (paidUsd + 0.000001 < usd) {
      await supabase
        .from('deposits')
        .update({
          status: 'Rejected',
          reason: `CryptoBot payment was below the required $${usd.toFixed(2)}.`
        })
        .eq('reference', reference);
      return res.status(200).send('underpaid');
    }

    const user = await getUserById(deposit.user_id);
    if (!user) return res.status(404).send('user not found');

    user.depositBalance = getDepositBalance(user) + gems;
    await updateUser(user);

    const { error } = await supabase
      .from('deposits')
      .update({
        status: 'Approved',
        reason: `CryptoBot paid — ${invoice.paid_amount || ''} ${invoice.paid_asset || ''} — $${usd.toFixed(2)}`
      })
      .eq('reference', reference)
      .eq('status', 'Pending Verification');

    if (error) throw error;

    await addTransaction(user.id, {
      id: generateTransactionId('tx_crypto_deposit'),
      type: 'Deposit Approved',
      description: `CryptoBot Deposit ${reference} — $${usd.toFixed(2)}`,
      amount: gems,
      currency: 'GEMS',
      status: 'completed',
      bank: `CryptoBot ${invoice.paid_asset || ''}`.trim()
    });

    return res.status(200).send('ok');
  } catch (err) {
    console.error('CryptoBot webhook error:', err);
    return res.status(500).send('server error');
  }
});

app.use(
  authenticateRequest
);

// ======================================================
// REQUIRE LOGIN
// ======================================================

async function requireLogin(
  req,
  res,
  next
) {

  if (
    !req.session ||
    !req.session.userId
  ) {

    return res.status(401).json({

      success:
        false,

      message:
        'Unauthorized session.'

    });

  }

  if (!req.user) {

    try {

      req.user =
        await getUserById(
          req.session.userId
        );

    } catch (err) {

      console.error(
        'Require login error:',
        err
      );

      return res.status(401).json({

        success:
          false,

        message:
          'User session not found.'

      });

    }

  }

  return next();

}




// ======================================================
// MONETAG REWARDED INTERSTITIAL API
// ======================================================

// Called by dashboard.html immediately before opening the Monetag ad.
// It does NOT award anything. It only records that this authenticated
// user intentionally requested a rewarded ad.
app.post('/api/monetag/start', requireLogin, async (req, res) => {
  try {
    const user = req.user;

    const recent = await getRecentMonetagReward(user.id);
    if (recent) {
      const nextAllowedAt = new Date(recent.created_at).getTime() + MONETAG_REWARD_COOLDOWN;
      return res.status(429).json({
        success: false,
        message: 'Please wait before watching another rewarded ad.',
        nextAllowedAt
      });
    }

    const rawContext = String(req.body?.context || 'dashboard').trim();
    const context = rawContext === 'luck_chest'
      ? 'luck_chest'
      : rawContext === 'game_free_spin'
      ? 'game_free_spin'
      : rawContext === 'earn_watch_ad'
      ? 'earn_watch_ad'
      : 'dashboard';

    if (context === 'luck_chest') {
      const readiness = checkLuckChestReady(user);
      if (!readiness.ready) {
        return res.status(429).json({
          success: false,
          message: readiness.message,
          nextAllowedAt: readiness.nextAllowedAt
        });
      }
    }

    const sessionId = `monetag_${Date.now().toString(36)}_${crypto.randomBytes(12).toString('hex')}`;
    const now = Date.now();

    monetagPendingSessions.set(sessionId, {
      userId: user.id,
      telegramId: String(user.telegramId || ''),
      context,
      createdAt: now,
      expiresAt: now + MONETAG_SESSION_TTL
    });

    return res.json({
      success: true,
      sessionId,
      zoneId: MONETAG_ZONE_ID,
      createdAt: now,
      expiresAt: now + MONETAG_SESSION_TTL
    });
  } catch (err) {
    console.error('Monetag start error:', err);
    return res.status(500).json({
      success: false,
      message: 'Unable to start the rewarded ad.'
    });
  }
});

// Browser polling endpoint. It never decides the reward; it only reads the
// reward that the server-side postback has already recorded.
app.get('/api/monetag/status', requireLogin, async (req, res) => {
  try {
    const sessionId = String(req.query?.sessionId || '').trim();
    const startedAt = Number(req.query?.startedAt || 0);
    if (!sessionId) {
      return res.status(400).json({ success: false, message: 'Ad session is required.' });
    }

    const completed = monetagCompletedSessions.get(sessionId);
    if (completed && String(completed.userId) === String(req.user.id)) {
      return res.json({
        success: true,
        confirmed: true,
        reward: completed.reward,
        luck: completed.reward?.luck || null,
        tickets: number(completed.reward?.tickets),
        completedAt: completed.completedAt
      });
    }

    const pending = monetagPendingSessions.get(sessionId);
    if (pending && String(pending.userId) === String(req.user.id)) {
      return res.json({ success: true, confirmed: false });
    }

    // If Render restarted after the postback was written to Supabase,
    // recover the reward from the most recent Monetag transaction.
    const { data, error } = await supabase
      .from('transactions')
      .select('id, amount, description, created_at')
      .eq('user_id', req.user.id)
      .eq('type', 'monetag_reward')
      .gte('created_at', new Date(startedAt > 0 ? startedAt : Date.now()).toISOString())
      .order('created_at', { ascending: false })
      .limit(1);

    if (error) throw error;

    if (Array.isArray(data) && data.length) {
      const tx = data[0];
      if (/^Luck Chest Ad$/i.test(String(tx.description || ''))) {
        const freshUser = await getUserById(req.user.id);
        const luck = freshUser ? getLuckChestSnapshot(freshUser) : null;
        return res.json({
          success: true,
          confirmed: true,
          reward: { key: 'luck_chest_ad', label: 'Luck Chest Ad', cash: 0, spins: 0 },
          luck,
          tickets: 0,
          completedAt: tx.created_at
        });
      }
      const description = String(tx.description || 'Monetag Reward');
      const label = description.replace(/^(Monetag Reward|Watch Ad Free Spin|Earn Watch Ad Reward)\s*[—-]?\s*/i, '').trim() || 'Reward confirmed';
      let spins = 0;
      const spinMatch = label.match(/([\d.]+)\s*Free Spins?/i);
      if (spinMatch) spins = Number(spinMatch[1]) || 0;

      return res.json({
        success: true,
        confirmed: true,
        reward: {
          key: 'server_confirmed',
          label,
          cash: number(tx.amount),
          spins
        },
        completedAt: tx.created_at
      });
    }

    return res.json({ success: true, confirmed: false });
  } catch (err) {
    console.error('Monetag status error:', err);
    return res.status(500).json({ success: false, message: 'Unable to check ad reward status.' });
  }
});

// Monetag server-side postback.
// Supports both GET and POST because the postback screen does not require
// us to assume one transport method. Monetag values may arrive in the body
// or query string depending on the configured callback.
app.all('/api/monetag/postback', async (req, res) => {
  try {
    const telegramId = normalizeMonetagTelegramId(
      monetagValue(req, ['telegram_id', 'telegramId', 'telegram_id_int', 'user_id'])
    );

    const zoneId = monetagValue(req, ['zone_id', 'zoneId']);
    const eventType = monetagValue(req, ['event_type', 'eventType']).toLowerCase();
    const rewardEventType = monetagValue(req, [
      'reward_event_type',
      'rewardEventType',
      'rewarded',
      'reward'
    ]).toLowerCase();
    const ymid = monetagValue(req, ['ymid', 'YMID']);
    const requestVar = monetagValue(req, ['request_var', 'requestVar']);
    const subZoneId = monetagValue(req, ['sub_zone_id', 'subZoneId']);
    const estimatedPrice = monetagValue(req, ['estimated_price', 'estimatedPrice']);

    // Always acknowledge malformed/non-reward events without crediting a user.
    if (zoneId && String(zoneId) !== MONETAG_ZONE_ID) {
      console.warn('Rejected Monetag postback: unexpected zone ID', zoneId);
      return res.status(400).send('invalid zone');
    }

    // Monetag currently documents `valued` / `non_valued`; the older
    // publisher UI may show `yes` / `no`. Support both forms.
    if (!['valued', 'yes', 'true', '1'].includes(rewardEventType)) {
      return res.status(200).send('ignored');
    }

    // YMID is the unique identifier we generate for every ad call. It is the
    // primary idempotency key and also lets us map the callback to the pending
    // PAYME watch session even when Telegram ID is not present.
    if (!ymid && !requestVar) {
      console.warn('Rejected Monetag postback: missing YMID/request_var');
      return res.status(400).send('missing ymid');
    }

    const eventId = String(ymid || requestVar).trim();

    let user = null;
    if (telegramId) {
      user = await getUserByTelegramId(telegramId);
    }

    const pending = findMonetagPendingSession({
      userId: user ? user.id : null,
      sessionId: requestVar,
      ymid,
      requestVar
    });

    if (!user && pending) {
      user = await getUserById(pending.session.userId);
    }

    if (!user) {
      console.warn('Monetag postback: user not found', telegramId || eventId);
      return res.status(404).send('user not found');
    }

    // The app-created session is single-use. If Monetag does not echo our
    // session identifier, findMonetagPendingSession() can still associate
    // the callback with this user's pending watch session using Telegram ID.
    if (pending) {
      monetagPendingSessions.delete(pending.id);
    }

    // The database transaction ID is the idempotency key. A duplicate YMID
    // can therefore never produce another reward.
    const transactionId = `tx_monetag_${crypto
      .createHash('sha256')
      .update(eventId)
      .digest('hex')
      .slice(0, 48)}`;

    const { data: existing, error: existingError } = await supabase
      .from('transactions')
      .select('id, amount, description, created_at, status')
      .eq('id', transactionId)
      .maybeSingle();

    if (existingError) throw existingError;

    if (existing) {
      return res.status(200).send('already processed');
    }

    // Server-side reward selection. The browser never decides which reward
    // is won. The context (dashboard cash reel vs. game free-spin reel)
    // comes from the pending session created when the ad was requested.
    const pendingContext = pending && pending.session && pending.session.context;
    const adContext = pendingContext === 'luck_chest'
      ? 'luck_chest'
      : pendingContext === 'game_free_spin'
      ? 'game_free_spin'
      : pendingContext === 'earn_watch_ad'
      ? 'earn_watch_ad'
      : 'dashboard';

    // Chest ads are progress events, not cash/free-spin rewards.
    if (adContext === 'luck_chest') {
      const rewardResult = { key: 'chest', label: 'Luck Chest Ad', cash: 0, spins: 0 };

      // Use the Monetag transaction ID as the idempotency lock before changing
      // progress. A duplicate postback therefore cannot count twice.
      await addTransaction(user.id, {
        id: transactionId,
        type: 'monetag_reward',
        description: `Luck Chest Ad`,
        amount: 0,
        currency: 'LUCK_TICKETS',
        status: 'completed',
        bank: `Monetag ${MONETAG_ZONE_ID}`
      });

      const result = applyLuckChestCompletion(user);
      syncUserBalance(user);
      await updateUser(user);

      if (result.granted) {
        await addTransaction(user.id, {
          id: generateTransactionId('tx_luck_chest_reward'),
          type: 'luck_ticket_reward',
          description: `Luck Chest opened — ${result.tickets} Luck Tickets`,
          amount: result.tickets,
          currency: 'LUCK_TICKETS',
          status: 'completed',
          bank: 'Luck Ticket Wallet'
        });
      }

      if (pending) {
        monetagCompletedSessions.set(pending.id, {
          userId: user.id,
          reward: { ...rewardResult, tickets: result.tickets, granted: result.granted, luck: result.state },
          completedAt: Date.now(),
          expiresAt: Date.now() + 5 * 60 * 1000
        });
      }

      return res.status(200).send('ok');
    }

    const reward = chooseMonetagReward(adContext);
    const rewardResult = buildMonetagRewardResult(reward);

    // Insert the unique transaction first. The primary/unique transaction ID
    // acts as our idempotency lock for duplicate postbacks.
    await addTransaction(user.id, {
      id: transactionId,
      type: 'monetag_reward',
      description: adContext === 'game_free_spin'
        ? `Watch Ad Free Spin — ${rewardResult.label}`
        : adContext === 'earn_watch_ad'
        ? `Earn Watch Ad Reward — ${rewardResult.label}`
        : `Monetag Reward — ${rewardResult.label}`,
      amount: rewardResult.cash,
      currency: 'GEMS',
      status: 'completed',
      bank: `Monetag ${MONETAG_ZONE_ID}`
    });

    if (rewardResult.cash > 0) {
      user.withdrawableBalance =
        getWithdrawableBalance(user) + rewardResult.cash;
    }

    if (rewardResult.spins > 0) {
      user.freeSpins = number(user.freeSpins) + rewardResult.spins;
    }

    syncUserBalance(user);
    await updateUser(user);

    if (pending) {
      monetagCompletedSessions.set(pending.id, {
        userId: user.id,
        reward: rewardResult,
        completedAt: Date.now(),
        expiresAt: Date.now() + 5 * 60 * 1000
      });
    }

    console.log('Monetag reward credited:', {
      userId: user.id,
      telegramId,
      zoneId: zoneId || MONETAG_ZONE_ID,
      eventType,
      rewardEventType,
      ymid: ymid || null,
      requestVar: requestVar || null,
      subZoneId: subZoneId || null,
      estimatedPrice: estimatedPrice || null,
      reward: rewardResult
    });

    return res.status(200).send('ok');
  } catch (err) {
    console.error('Monetag postback error:', err);
    return res.status(500).send('server error');
  }
});

// ======================================================
// MONETAG REWARDED INTERSTITIAL HELPERS
// ======================================================

function monetagValue(req, names) {
  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const query = req.query && typeof req.query === 'object' ? req.query : {};
  const headers = req.headers || {};

  for (const name of names) {
    if (body[name] !== undefined && body[name] !== null && String(body[name]).trim() !== '') {
      return String(body[name]).trim();
    }
    if (query[name] !== undefined && query[name] !== null && String(query[name]).trim() !== '') {
      return String(query[name]).trim();
    }
  }

  return '';
}

function normalizeMonetagTelegramId(value) {
  const clean = String(value || '').trim();
  if (!clean) return '';
  if (!/^-?\d{3,30}$/.test(clean)) return '';
  return clean;
}

function chooseMonetagReward(context) {
  // context ('dashboard' | 'earn_watch_ad' | 'game_free_spin') is still used
  // elsewhere (transaction description text) to indicate where the ad was
  // watched from, but all three now draw from the exact same reward table
  // at the exact same odds — see AD_WATCH_FREESPIN_REWARD_SLOTS above.
  const table = AD_WATCH_FREESPIN_REWARD_SLOTS;
  const roll = crypto.randomInt(0, 100000) + 1;
  for (const reward of table) {
    if (roll <= reward.max) {
      return reward;
    }
  }
  return table[0];
}

function findMonetagPendingSession({ userId, sessionId, ymid, requestVar }) {
  cleanupMonetagSessions();

  const candidates = [sessionId, requestVar, ymid]
    .map(v => String(v || '').trim())
    .filter(Boolean);

  for (const id of candidates) {
    const session = monetagPendingSessions.get(id);
    if (session && (!userId || String(session.userId) === String(userId))) {
      return { id, session };
    }
  }

  if (userId) {
    for (const [id, session] of monetagPendingSessions.entries()) {
      if (String(session.userId) === String(userId)) {
        return { id, session };
      }
    }
  }

  return null;
}

async function getRecentMonetagReward(userId) {
  const since = new Date(Date.now() - MONETAG_REWARD_COOLDOWN).toISOString();

  const { data, error } = await supabase
    .from('transactions')
    .select('id, created_at, status, description')
    .eq('user_id', userId)
    .eq('type', 'monetag_reward')
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(1);

  if (error) throw error;
  return Array.isArray(data) && data.length ? data[0] : null;
}

function buildMonetagRewardResult(reward) {
  return {
    key: reward.key,
    label: reward.label,
    cash: number(reward.cash),
    spins: number(reward.spins)
  };
}

// ======================================================
// TELEGRAM NOTIFICATION
// ======================================================

async function sendTelegramNotification(
  message
) {

  if (
    !TELEGRAM_DEPOSIT_BOT_TOKEN ||
    !TELEGRAM_CHAT_ID
  ) {

    console.warn(
      'Telegram notification disabled: TELEGRAM_DEPOSIT_BOT_TOKEN or TELEGRAM_CHAT_ID is missing.'
    );

    return;

  }

  try {

    const response =
      await fetch(
        `https://api.telegram.org/bot${TELEGRAM_DEPOSIT_BOT_TOKEN}/sendMessage`,
        {

          method:
            'POST',

          headers: {
            'Content-Type':
              'application/json'
          },

          body:
            JSON.stringify({

              chat_id:
                TELEGRAM_CHAT_ID,

              text:
                message,

              parse_mode:
                'HTML'

            })

        }
      );

    const data =
      await response.json();

    if (!data.ok) {

      console.error(
        'Telegram API error:',
        data
      );

    }

  } catch (err) {

    console.error(
      'Telegram notification error:',
      err.message
    );

  }

}


// ======================================================
// MANUAL USDT WITHDRAWAL TELEGRAM HELPERS
// ======================================================

async function sendManualWithdrawalTelegram({
  withdrawalId,
  user,
  gems,
  usd,
  address,
  balance
}) {
  if (!TELEGRAM_DEPOSIT_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
    throw new Error('TELEGRAM_DEPOSIT_BOT_TOKEN or TELEGRAM_CHAT_ID is missing.');
  }

  const username = user.username ? `@${user.username}` : 'No username';
  const safeName = String(user.fullName || username).replace(/[<>&]/g, '');
  const safeUsername = String(username).replace(/[<>&]/g, '');
  const safeAddress = String(address).replace(/[<>&]/g, '');

  const text =
    `🟡 <b>NEW USDT WITHDRAWAL</b>\n\n` +
    `👤 <b>Name:</b> ${safeName}\n` +
    `🆔 <b>Username:</b> ${safeUsername}\n` +
    `🆔 <b>Telegram ID:</b> ${String(user.telegramId || '')}\n\n` +
    `💎 <b>Gems:</b> ${Number(gems).toLocaleString()}\n` +
    `💵 <b>USDT Amount:</b> ${Number(usd).toFixed(2)} USDT\n` +
    `📍 <b>USDT Address:</b>\n<code>${safeAddress}</code>\n\n` +
    `💰 <b>Balance After Request:</b> ${Number(balance).toLocaleString()} Gems\n` +
    `🔖 <b>Withdrawal ID:</b> <code>${withdrawalId}</code>\n\n` +
    `⏳ <b>Status:</b> PENDING\n` +
    `⚠️ <b>Manual payout:</b> Review the address carefully before approving.`;

  const response = await fetch(
    `https://api.telegram.org/bot${TELEGRAM_DEPOSIT_BOT_TOKEN}/sendMessage`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: TELEGRAM_CHAT_ID,
        text,
        parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: [
            [
              {
                text: '✅ APPROVE',
                callback_data: `approve_withdrawal:${withdrawalId}`
              },
              {
                text: '❌ REJECT',
                callback_data: `reject_withdrawal:${withdrawalId}`
              }
            ]
          ]
        }
      })
    }
  );

  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.ok) {
    throw new Error(data?.description || `Telegram API HTTP ${response.status}`);
  }

  return data.result;
}

async function editTelegramTextMessage(chatId, messageId, text) {
  if (!TELEGRAM_DEPOSIT_BOT_TOKEN) return;

  const response = await fetch(
    `https://api.telegram.org/bot${TELEGRAM_DEPOSIT_BOT_TOKEN}/editMessageText`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        message_id: messageId,
        text,
        parse_mode: 'HTML',
        reply_markup: { inline_keyboard: [] }
      })
    }
  );

  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.ok) {
    console.error('Telegram withdrawal message edit error:', data);
  }
}

async function getWithdrawalById(withdrawalId, userId = null) {
  let query = supabase
    .from('transactions')
    .select('id,user_id,type,description,amount,currency,status,bank,account_name,account_number,created_at')
    .eq('id', withdrawalId)
    .eq('type', 'Withdrawal');

  if (userId) query = query.eq('user_id', userId);

  const { data, error } = await query.maybeSingle();
  if (error) throw error;
  return data;
}

async function processManualWithdrawalDecision(
  userId,
  withdrawalId,
  action
) {
  const withdrawal = await getWithdrawalById(withdrawalId, userId);

  if (!withdrawal) {
    throw Object.assign(new Error('Withdrawal not found.'), { status: 404 });
  }

  if (withdrawal.status !== 'Pending') {
    throw Object.assign(
      new Error(`This withdrawal has already been ${String(withdrawal.status).toLowerCase()}.`),
      { status: 400 }
    );
  }

  const targetUser = await getUserById(userId);
  if (!targetUser) {
    throw Object.assign(new Error('User not found.'), { status: 404 });
  }

  const gems = number(withdrawal.amount);
  const usd = gemUsd(gems);

  if (action === 'reject') {
    // Refund exactly the amount reserved when the request was created.
    targetUser.withdrawableBalance =
      getWithdrawableBalance(targetUser) + gems;
    syncUserBalance(targetUser);
    await updateUser(targetUser);

    const { error } = await supabase
      .from('transactions')
      .update({
        status: 'Rejected',
        description:
          `${withdrawal.description || 'USDT Withdrawal'} — Rejected`,
      })
      .eq('id', withdrawalId)
      .eq('status', 'Pending');

    if (error) throw error;

    return {
      user: await getUserById(userId),
      withdrawal: await getWithdrawalById(withdrawalId, userId),
      usd
    };
  }

  if (action === 'approve') {
    const { error } = await supabase
      .from('transactions')
      .update({
        status: 'Approved',
        description:
          `${withdrawal.description || 'USDT Withdrawal'} — Approved`,
      })
      .eq('id', withdrawalId)
      .eq('status', 'Pending');

    if (error) throw error;

    return {
      user: await getUserById(userId),
      withdrawal: await getWithdrawalById(withdrawalId, userId),
      usd
    };
  }

  throw Object.assign(
    new Error('Invalid withdrawal action.'),
    { status: 400 }
  );
}

// ======================================================
// SECURE TELEGRAM WEB APP VERIFICATION
// ======================================================

// ======================================================
// SECURE TELEGRAM WEB APP INIT DATA VERIFICATION
// ======================================================

function verifyTelegramWebAppData(
  initData
) {

  try {

    if (
      !initData ||
      !TELEGRAM_BOT_TOKEN
    ) {
      return null;
    }


    const params =
      new URLSearchParams(
        initData
      );


    const receivedHash =
      params.get('hash');


    if (!receivedHash) {
      return null;
    }


    params.delete('hash');


    const dataCheckString =
      Array.from(
        params.entries()
      )
      .sort(
        ([a], [b]) =>
          a.localeCompare(b)
      )
      .map(
        ([key, value]) =>
          `${key}=${value}`
      )
      .join('\n');


    // Telegram Web App secret key
    const secretKey =
      crypto
        .createHmac(
          'sha256',
          'WebAppData'
        )
        .update(
          TELEGRAM_BOT_TOKEN
        )
        .digest();


    // Calculate Telegram hash
    const calculatedHash =
      crypto
        .createHmac(
          'sha256',
          secretKey
        )
        .update(
          dataCheckString
        )
        .digest('hex');


    const receivedBuffer =
      Buffer.from(
        receivedHash,
        'hex'
      );


    const calculatedBuffer =
      Buffer.from(
        calculatedHash,
        'hex'
      );


    if (
      receivedBuffer.length !==
      calculatedBuffer.length
    ) {
      return null;
    }


    if (
      !crypto.timingSafeEqual(
        receivedBuffer,
        calculatedBuffer
      )
    ) {
      return null;
    }


    // --------------------------------------------------
    // CHECK AUTH DATE
    // --------------------------------------------------

    const authDate =
      Number(
        params.get(
          'auth_date'
        ) || 0
      );


    if (!authDate) {
      return null;
    }


    const currentTime =
      Math.floor(
        Date.now() / 1000
      );


    const age =
      currentTime -
      authDate;


    // Allow 24 hours
    if (
      age < 0 ||
      age > 86400
    ) {
      return null;
    }


    // --------------------------------------------------
    // GET TELEGRAM USER
    // --------------------------------------------------

    const userString =
      params.get(
        'user'
      );


    if (!userString) {
      return null;
    }


    const telegramUser =
      JSON.parse(
        userString
      );


    if (
      !telegramUser ||
      !telegramUser.id
    ) {
      return null;
    }


    return {

      user:
        telegramUser,

      startParam:
        params.get(
          'start_param'
        ) || ''

    };


  } catch (err) {

    console.error(
      'Telegram initData verification error:',
      err.message
    );

    return null;

  }

}


// ======================================================
// WELCOME BONUS
// ======================================================

async function ensureWelcomeBonus(
  user
) {

  if (
    user.hasReceivedWelcomeBonus
  ) {

    syncUserBalance(user);

    return user;

  }

  user.withdrawableBalance =
    getWithdrawableBalance(user) +
    WELCOME_BONUS;

  user.hasReceivedWelcomeBonus =
    true;

  syncUserBalance(user);

  await updateUser(user);

  await addTransaction(
    user.id,
    {

      id:
        generateTransactionId(
          'tx_welcome'
        ),

      type:
        'welcome_bonus',

      description:
        'Welcome Bonus',

      amount:
        WELCOME_BONUS,

      currency:
        'GEMS',

      status:
        'completed'

    }
  );

  return user;

}

// ======================================================
// SANITIZE USER RESPONSE
// ======================================================

function sanitizeUser(
  user
) {

  return {

    id:
      user.id,

    telegramId:
      user.telegramId,

    fullName:
      user.fullName,

    username:
      user.username,

    balance:
      number(
        user.balance
      ),

    withdrawableBalance:
      number(
        user.withdrawableBalance
      ),

    depositBalance:
      number(
        user.depositBalance
      ),

    referralCode:
      user.referralCode,

    totalReferrals:
      number(
        user.totalReferrals
      ),

    successfulReferrals:
      number(
        user.successfulReferrals
      ),

    referralEarnings:
      number(
        user.referralEarnings
      ),

    freeSpins:
      number(
        user.freeSpins
      ),

    luckTickets:
      number(user.luckTickets),

    luckChests:
      user.luckChests || {
        chest: { progress: 0, firstAdAt: 0, cooldownUntil: 0 }
      },

    hasClaimedGiftBox:
      !!user.hasClaimedGiftBox,

    hasReceivedWelcomeBonus:
      !!user.hasReceivedWelcomeBonus,

    hasSeenPopup:
      !!user.hasSeenPopup,

    showOnboardingTutorial:
      !!user.hasReceivedWelcomeBonus &&
      !!user.hasClaimedGiftBox &&
      !user.hasSeenPopup

  };

}

// ======================================================
 // DASHBOARD FIRST-USE TUTORIAL
 // ======================================================
 // `has_seen_popup` is used as the persistent tutorial-complete flag.
 // It is stored in Supabase, so redeploying Render does not make the
 // tutorial reappear for users who already skipped/completed it.
 app.post('/api/user/complete-dashboard-tutorial', requireLogin, async (req, res) => {
   try {
     const user = req.user;

     if (!user.hasSeenPopup) {
       user.hasSeenPopup = true;
       await updateUser(user);
     }

     return res.json({
       success: true,
       tutorialCompleted: true
     });
   } catch (err) {
     console.error('Dashboard tutorial completion error:', err);
     return res.status(500).json({
       success: false,
       message: 'Unable to save tutorial state.'
     });
   }
 });

// ======================================================
// HTML ROUTES
// ======================================================

app.get(
  '/earn',
  (req, res) => {

    res.sendFile(
      path.join(
        __dirname,
        'public',
        'earn.html'
      )
    );

  }
);

app.get(
  '/leaderboard.html',
  (req, res) => {

    res.sendFile(
      path.join(
        __dirname,
        'public',
        'leaderboard.html'
      )
    );

  }
);

app.get(
  '/Luck.html',
  requireLogin,
  (req, res) => {
    res.sendFile(
      path.join(
        __dirname,
        'public',
        'Luck.html'
      )
    );
  }
);

app.get(
  '/dashboard.html',
  requireLogin,
  (req, res) => {

    res.sendFile(
      path.join(
        __dirname,
        'public',
        'dashboard.html'
      )
    );

  }
);

app.get(
  '/public/dashboard.html',
  (req, res) => {

    res.redirect(
      '/dashboard.html'
    );

  }
);

app.get(
  '/game',
  (req, res) => {

    if (
      !req.session ||
      !req.session.userId
    ) {

      return res.redirect('/');

    }

    res.sendFile(
      path.join(
        __dirname,
        'public',
        'game.html'
      )
    );

  }
);

app.get(
  '/deposit.html',
  (req, res) => {

    if (
      !req.session ||
      !req.session.userId
    ) {

      return res.redirect('/');

    }

    res.sendFile(
      path.join(
        __dirname,
        'public',
        'deposit.html'
      )
    );

  }
);

// ======================================================
// NORMAL SIGNUP
// ======================================================


// ======================================================
// LOCAL TEST & NORMAL SIGNUP
// ======================================================

// Express route specifically for the #localtest signup trigger
app.post('/api/auth/localtest-signup', async (req, res) => {
  try {
    const { username } = req.body;

    const cleanUsername = String(username || 'localtester')
      .trim()
      .toLowerCase();

    // Check if local tester already exists
    let user = await getUserByUsername(cleanUsername);

    if (!user) {
      const newUser = {
        id: generateUserId(),
        fullName: 'Local Tester',
        email: `${cleanUsername}@local.test`,
        username: cleanUsername,
        phone: '+2340000000000',
        password: 'localtestpassword123',
        telegramId: null,
        balance: 0,
        depositBalance: 0,
        withdrawableBalance: 0,
        hasReceivedWelcomeBonus: false,
        hasSeenPopup: false,
        referralCode: await generateUniqueReferralCode(),
        referredBy: null,
        totalReferrals: 0,
        successfulReferrals: 0,
        referralEarnings: 0,
        freeSpins: 5, // Give free spins for testing
        hasClaimedGiftBox: false,
        sessionVersion: 1,
        dailyReward: {
          currentDay: 1,
          lastClaimTimestamp: 0,
          claimedDays: [],
          luckTickets: 0,
          luckChests: {
            chest: { progress: 0, firstAdAt: 0, cooldownUntil: 0 }
          }
        }
      };

      const created = await createUser(newUser);
      await ensureWelcomeBonus(created);
      user = await getUserById(created.id);
    } else {
      user.sessionVersion = number(user.sessionVersion) + 1;
      await updateUser(user);
    }

    const finalUser = await getUserById(user.id);

    // Set authentication session cookie
    setSessionCookie(res, createSessionToken(finalUser));

    return res.json({
      success: true,
      message: 'Local test signup successful',
      redirectTo: '/dashboard.html',
      user: sanitizeUser(finalUser)
    });
  } catch (err) {
    console.error('Local test signup error:', err);
    return res.status(500).json({
      success: false,
      message: 'Server error during local test signup.'
    });
  }
});



// ======================================================
// PROCESS REFERRAL
// ======================================================

async function processReferral(
  referrer,
  newUser
) {

  const confirmedAt =
    new Date().toISOString();

  referrer.withdrawableBalance =
    getWithdrawableBalance(
      referrer
    ) +
    REFERRAL_REWARD;

  referrer.totalReferrals =
    number(
      referrer.totalReferrals
    ) +
    1;

  referrer.successfulReferrals =
    number(
      referrer.successfulReferrals
    ) +
    1;

  referrer.referralEarnings =
    number(
      referrer.referralEarnings
    ) +
    REFERRAL_REWARD;

  await updateUser(
    referrer
  );

  await addTransaction(
    referrer.id,
    {

      id:
        generateTransactionId(
          'tx_ref'
        ),

      type:
        'referral_reward',

      description:
        `Referral Reward (@${newUser.username})`,

      amount:
        REFERRAL_REWARD,

      currency:
        'GEMS',

      status:
        'completed',

      createdAt:
        confirmedAt

    }
  );

}

// ======================================================
// TELEGRAM SIGN UP / AUTHENTICATION
// SUPABASE VERSION
// SECURE TELEGRAM WEB APP INITDATA
// ======================================================


// ======================================================
// TELEGRAM SIGN UP / AUTHENTICATION (LOCAL TESTER READY)
// ======================================================

app.post(
  '/api/auth/telegram-signup',
  async (req, res) => {

    try {

      let {
        initData,
        referralCode
      } = req.body || {};

      // --------------------------------------------------
      // LOCAL TESTING BYPASS (Termux / Non-Production)
      // --------------------------------------------------
      const isLocal = !isProduction || req.headers.host?.includes('localhost') || req.headers.host?.includes('127.0.0.1');

      if (isLocal && (!initData || initData === 'local_test' || initData === '')) {
        console.log('⚡ Running locally: Bypassing Telegram initData verification for Local Tester...');
        
        const localTelegramId = '999999999';
        const localUsername = 'local_tester';
        
        let user = await getUserByTelegramId(localTelegramId);

        if (!user) {
          const newUser = {
            id: generateUserId(),
            telegramId: localTelegramId,
            fullName: 'Local Tester',
            email: 'local_tester@telegram.user',
            username: localUsername,
            phone: '+2340000000000',
            password: crypto.randomBytes(16).toString('hex'),
            balance: 0,
            depositBalance: 0,
            withdrawableBalance: 0,
            hasReceivedWelcomeBonus: false,
            hasSeenPopup: false,
            referralCode: await generateUniqueReferralCode(),
            referredBy: referralCode || null,
            totalReferrals: 0,
            successfulReferrals: 0,
            referralEarnings: 0,
            freeSpins: 5, // Granted extra spins for testing
            hasClaimedGiftBox: false,
            sessionVersion: 1,
            dailyReward: {
              currentDay: 1,
              lastClaimTimestamp: 0,
              claimedDays: []
            }
          };

          const createdUser = await createUser(newUser);
          await ensureWelcomeBonus(createdUser);
          user = await getUserById(createdUser.id);
        }

        // User is already loaded; no transaction history is needed for authentication.
        const sessionToken = createSessionToken(user);
        setSessionCookie(res, sessionToken);

        return res.json({
          success: true,
          message: 'Local tester authentication successful',
          user: sanitizeUser(user)
        });
      }

      // --------------------------------------------------
      // TELEGRAM BOT TOKEN CHECK
      // --------------------------------------------------

      if (!TELEGRAM_BOT_TOKEN) {

        console.error(
          'TELEGRAM_BOT_TOKEN is missing.'
        );

        return res.status(500).json({
          success: false,
          message:
            'Telegram authentication is not configured on the server.'
        });

      }

      // --------------------------------------------------
      // INIT DATA CHECK
      // --------------------------------------------------

      if (
        !initData ||
        typeof initData !== 'string'
      ) {

        return res.status(401).json({
          success: false,
          message:
            'Invalid or expired Telegram authentication data.'
        });

      }

      // --------------------------------------------------
      // VERIFY TELEGRAM WEB APP DATA
      // --------------------------------------------------

      const telegramAuth =
        verifyTelegramWebAppData(
          initData
        );

      if (!telegramAuth) {

        console.error(
          'Telegram Web App authentication verification failed.'
        );

        return res.status(401).json({
          success: false,
          message:
            'Invalid or expired Telegram authentication data.'
        });

      }

      // --------------------------------------------------
      // GET TELEGRAM USER
      // --------------------------------------------------

      const telegramUser =
        telegramAuth.user;

      if (
        !telegramUser ||
        !telegramUser.id
      ) {

        return res.status(401).json({
          success: false,
          message:
            'Telegram account information could not be detected.'
        });

      }

      // --------------------------------------------------
      // CLEAN TELEGRAM DATA
      // --------------------------------------------------

      const cleanTelegramId =
        String(
          telegramUser.id
        ).trim();

      const cleanUsername =
        String(
          telegramUser.username ||
          `user_${cleanTelegramId}`
        )
          .trim()
          .replace(/^@/, '')
          .toLowerCase();

      const cleanFirstName =
        String(
          telegramUser.first_name || ''
        ).trim();

      const cleanLastName =
        String(
          telegramUser.last_name || ''
        ).trim();

      const fullName =
        `${cleanFirstName} ${cleanLastName}`
          .trim() ||
        cleanUsername;

      // --------------------------------------------------
      // GET REFERRAL CODE
      // --------------------------------------------------

      const cleanRefInput =
        referralCode
          ? String(
              referralCode
            )
              .trim()
              .toUpperCase()
          : (
              telegramAuth.startParam
                ? String(
                    telegramAuth.startParam
                  )
                    .trim()
                    .toUpperCase()
                : null
            );

      console.log(
        'Telegram signup request:',
        {
          telegramId: cleanTelegramId,
          username: cleanUsername,
          referralCode: cleanRefInput || null
        }
      );

      // ==================================================
      // FIND USER IN SUPABASE
      // ==================================================

      let user =
        await getUserByTelegramId(
          cleanTelegramId
        );

      // --------------------------------------------------
      // IF TELEGRAM ID DOES NOT EXIST,
      // CHECK USERNAME
      // --------------------------------------------------

      if (!user) {

        const usernameUser =
          await getUserByUsername(
            cleanUsername
          );

        if (usernameUser) {

          user =
            usernameUser;

        }

      }

      // ==================================================
      // CREATE NEW TELEGRAM USER
      // ==================================================

      if (!user) {

        console.log(
          'Creating new Telegram user in Supabase...'
        );

        const uniqueRefCode =
          await generateUniqueReferralCode();

        const newUser = {

          id:
            generateUserId(),

          telegramId:
            cleanTelegramId,

          fullName:
            fullName,

          email:
            `${cleanUsername}@telegram.user`,

          username:
            cleanUsername,

          phone:
            'N/A',

          password:
            crypto
              .randomBytes(16)
              .toString('hex'),

          balance:
            0,

          depositBalance:
            0,

          withdrawableBalance:
            0,

          hasReceivedWelcomeBonus:
            false,

          hasSeenPopup:
            false,

          referralCode:
            uniqueRefCode,

          referredBy:
            cleanRefInput,

          totalReferrals:
            0,

          successfulReferrals:
            0,

          referralEarnings:
            0,

          freeSpins:
            0,

          hasClaimedGiftBox:
            false,

          sessionVersion:
            1,

          dailyReward: {

            currentDay:
              1,

            lastClaimTimestamp:
              0,

            claimedDays:
              [],

            luckTickets:
              0,

            luckChests: {
              chest: {
                progress: 0,
                firstAdAt: 0,
                cooldownUntil: 0
              }
            }

          }

        };

        const createdUser =
          await createUser(
            newUser
          );

        await ensureWelcomeBonus(
          createdUser
        );

        let savedUser =
          await getUserById(
            createdUser.id
          );

        if (!savedUser) {

          throw new Error(
            'User was created but could not be loaded from Supabase.'
          );

        }

        if (cleanRefInput) {

          try {

            const referrer =
              await getUserByReferralCode(
                cleanRefInput
              );

            if (
              referrer &&
              referrer.id !== savedUser.id
            ) {

              await processReferral(
                referrer,
                savedUser
              );

            }

          } catch (referralError) {

            console.error(
              'Telegram referral processing error:',
              referralError
            );

          }

        }

        user =
          await getUserById(
            savedUser.id
          );

        const sessionToken =
          createSessionToken(
            user
          );

        setSessionCookie(
          res,
          sessionToken
        );

        try {

          await sendTelegramNotification(

            `<b>NEW TELEGRAM USER REGISTERED</b>\n\n` +

            `<b>Name:</b> ${user.fullName}\n` +

            `<b>Username:</b> @${user.username}\n` +

            `<b>Telegram ID:</b> ${user.telegramId}\n` +

            `<b>Welcome Bonus:</b> Gems💎${WELCOME_BONUS}\n` +

            `<b>Referral Code:</b> ${user.referralCode}\n` +

            `<b>Referred By:</b> ${
              user.referredBy || 'None'
            }\n` +

            `<b>Balance:</b> Gems💎${number(
              user.balance
            ).toFixed(3)}`

          );

        } catch (notificationError) {

          console.error(
            'Telegram signup notification error:',
            notificationError
          );

        }

      }

      // ==================================================
      // EXISTING TELEGRAM / USER ACCOUNT
      // ==================================================

      else {

        let shouldUpdate = false;

        if (
          String(
            user.telegramId || ''
          ) !== cleanTelegramId
        ) {

          user.telegramId =
            cleanTelegramId;

          shouldUpdate =
            true;

        }

        if (
          fullName &&
          user.fullName !== fullName
        ) {

          user.fullName =
            fullName;

          shouldUpdate =
            true;

        }

        if (
          cleanUsername &&
          !cleanUsername.startsWith('user_') &&
          user.username !== cleanUsername
        ) {

          const usernameOwner =
            await getUserByUsername(
              cleanUsername
            );

          if (
            !usernameOwner ||
            usernameOwner.id === user.id
          ) {

            user.username =
              cleanUsername;

            if (
              user.email &&
              user.email.endsWith(
                '@telegram.user'
              )
            ) {

              user.email =
                `${cleanUsername}@telegram.user`;

            }

            shouldUpdate =
              true;

          }

        }

        if (
          !user.referralCode
        ) {

          user.referralCode =
            await generateUniqueReferralCode();

          shouldUpdate =
            true;

        }

        if (
          !user.dailyReward ||
          typeof user.dailyReward !== 'object'
        ) {

          user.dailyReward = {

            currentDay:
              1,

            lastClaimTimestamp:
              0,

            claimedDays:
              []

          };

          shouldUpdate =
            true;

        }

        if (
          !Array.isArray(
            user.dailyReward.claimedDays
          )
        ) {

          user.dailyReward.claimedDays =
            [];

          shouldUpdate =
            true;

        }

        await ensureWelcomeBonus(
          user
        );

        user.sessionVersion =
          number(
            user.sessionVersion
          ) + 1;

        shouldUpdate =
          true;

        if (shouldUpdate) {

          await updateUser(
            user
          );

        }

        user =
          await getUserById(
            user.id
          );

      }

      const sessionToken =
        createSessionToken(
          user
        );

      setSessionCookie(
        res,
        sessionToken
      );

      return res.json({

        success:
          true,

        message:
          'Telegram authentication successful',

        user:
          sanitizeUser(
            user
          )

      });

    }

    catch (err) {

      console.error(
        'Telegram signup error:',
        err
      );

      if (
        err &&
        err.code === '23505'
      ) {

        return res.status(400).json({

          success:
            false,

          message:
            'This Telegram account, username, email, or referral code is already registered.'

        });

      }

      return res.status(500).json({

        success:
          false,

        message:
          'Server error during Telegram signup.'

      });

    }

  }
);




// ======================================================
// CHECK TELEGRAM USER
// ======================================================

app.get(
  '/api/auth/check-user',
  async (req, res) => {

    try {

      const telegramId =
        String(
          req.query.telegramId || ''
        ).trim();

      if (!telegramId) {

        return res.json({

          exists:
            false

        });

      }

      const user =
        await getUserByTelegramId(
          telegramId
        );

      if (user) {

        return res.json({

          exists:
            true,

          username:
            user.username,

          fullName:
            user.fullName

        });

      }

      return res.json({

        exists:
          false

      });

    } catch (err) {

      console.error(
        'Check user status error:',
        err
      );

      return res.status(500).json({

        exists:
          false,

        error:
          'Server error checking account.'

      });

    }

  }
);

// ======================================================
// NORMAL LOGIN
// ======================================================

app.post(
  '/api/auth/login',
  async (req, res) => {

    try {

      const {
        loginIdentifier,
        password
      } = req.body;

      if (
        !loginIdentifier ||
        !password
      ) {

        return res.status(400).json({

          success:
            false,

          message:
            'Missing fields.'

        });

      }

      const cleanId =
        String(
          loginIdentifier
        )
          .trim()
          .toLowerCase();

      let user =
        await getUserByUsername(
          cleanId
        );

      if (!user) {

        user =
          await getUserByEmail(
            cleanId
          );

      }

      if (
        !user ||
        user.password !==
        String(password)
      ) {

        return res.status(401).json({

          success:
            false,

          message:
            'Invalid credentials.'

        });

      }

      await ensureWelcomeBonus(
        user
      );

      user.sessionVersion =
        number(
          user.sessionVersion
        ) +
        1;

      await updateUser(
        user
      );

      const finalUser =
        await getUserById(
          user.id
        );

      setSessionCookie(
        res,
        createSessionToken(
          finalUser
        )
      );

      return res.json({

        success:
          true,

        message:
          'Login successful',

        user:
          sanitizeUser(
            finalUser
          )

      });

    } catch (err) {

      console.error(
        'Login error:',
        err
      );

      return res.status(500).json({

        success:
          false,

        message:
          'Server error during login.'

      });

    }

  }
);

// ======================================================
// LOGOUT
// ======================================================

app.post(
  '/api/auth/logout',
  async (req, res) => {

    try {

      if (
        req.session &&
        req.session.userId
      ) {

        const user =
          await getUserById(
            req.session.userId
          );

        if (user) {

          user.sessionVersion =
            number(
              user.sessionVersion
            ) +
            1;

          await updateUser(
            user
          );

        }

      }

    } catch (err) {

      console.error(
        'Logout error:',
        err
      );

    }

    clearSessionCookie(
      res
    );

    return res.json({

      success:
        true,

      message:
        'Logged out successfully.'

    });

  }
);

// ======================================================
// WITHDRAWAL COOLDOWN HELPERS
// ======================================================

async function getLastWithdrawalCreatedAt(userId) {
  const { data, error } = await supabase
    .from('transactions')
    .select('created_at')
    .eq('user_id', userId)
    .eq('type', 'Withdrawal')
    .neq('status', 'Rejected')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return data?.created_at || null;
}

async function getWithdrawalCooldownStatus(userId) {
  const lastWithdrawalAt = await getLastWithdrawalCreatedAt(userId);

  if (!lastWithdrawalAt) {
    return {
      canWithdraw: true,
      lastWithdrawalAt: null,
      nextAllowedAt: 0,
      remainingMs: 0
    };
  }

  const lastTime = new Date(lastWithdrawalAt).getTime();

  if (!Number.isFinite(lastTime)) {
    return {
      canWithdraw: true,
      lastWithdrawalAt: null,
      nextAllowedAt: 0,
      remainingMs: 0
    };
  }

  const nextAllowedAt =
    lastTime + WITHDRAWAL_COOLDOWN;

  const remainingMs =
    Math.max(0, nextAllowedAt - Date.now());

  return {
    canWithdraw: remainingMs <= 0,
    lastWithdrawalAt,
    nextAllowedAt,
    remainingMs
  };
}

// Lightweight endpoint used only by the withdrawal page.
// It downloads one timestamp instead of the user's transaction history.
app.get(
  '/api/withdraw/status',
  requireLogin,
  async (req, res) => {

    try {

      const status =
        await getWithdrawalCooldownStatus(
          req.user.id
        );

      const { data: latestWithdrawal, error: latestWithdrawalError } =
        await supabase
          .from('transactions')
          .select(
            'id,type,description,amount,currency,status,bank,account_name,account_number,created_at'
          )
          .eq('user_id', req.user.id)
          .eq('type', 'Withdrawal')
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();

      if (latestWithdrawalError) throw latestWithdrawalError;

      return res.json({
        success: true,
        cooldownMs: WITHDRAWAL_COOLDOWN,
        ...status,
        latestWithdrawal: latestWithdrawal
          ? {
              id: latestWithdrawal.id,
              amount: number(latestWithdrawal.amount),
              usd: gemUsd(number(latestWithdrawal.amount)),
              asset: 'USDT',
              status: latestWithdrawal.status,
              address: latestWithdrawal.account_number,
              createdAt: latestWithdrawal.created_at
            }
          : null
      });

    } catch (err) {

      console.error(
        'Withdrawal status error:',
        err
      );

      return res.status(500).json({
        success: false,
        message:
          'Unable to check withdrawal availability.'
      });

    }
  }
);

// ======================================================
// MANUAL USDT WITHDRAWAL
// ======================================================
//
// Withdrawals are NOT sent automatically by CryptoBot.
// The user's Gems are reserved immediately and a Pending
// withdrawal is sent to the PAYME deposit/admin Telegram bot.
// Only an administrator in TELEGRAM_CHAT_ID can approve/reject it.
// Approval marks the request Approved; the actual USDT transfer is
// performed manually outside this application.
// ======================================================
app.post('/api/withdraw', requireLogin, async (req, res) => {
  try {
    await refreshLiveGemRate();

    const user = req.user;
    const gems = number(req.body?.gems);
    const asset = String(req.body?.asset || '').trim().toUpperCase();
    const address = String(req.body?.address || '').trim();
    const usd = gemUsd(gems);

    const withdrawalStatus = await getWithdrawalCooldownStatus(user.id);
    if (!withdrawalStatus.canWithdraw) {
      const remainingHours = Math.floor(withdrawalStatus.remainingMs / 3600000);
      const remainingMinutes = Math.ceil(
        (withdrawalStatus.remainingMs % 3600000) / 60000
      );

      return res.status(429).json({
        success: false,
        message: `You can withdraw again in ${remainingHours}h ${remainingMinutes}m.`,
        nextAllowedAt: withdrawalStatus.nextAllowedAt,
        remainingMs: withdrawalStatus.remainingMs
      });
    }

    // This endpoint accepts USDT only.
    if (asset !== 'USDT') {
      return res.status(400).json({
        success: false,
        message: 'Only USDT withdrawals are accepted.'
      });
    }

    if (!Number.isFinite(gems) || gems <= 0 || usd < MIN_CRYPTO_USD) {
      return res.status(400).json({
        success: false,
        message:
          `Minimum withdrawal is $${MIN_CRYPTO_USD.toFixed(2)} ` +
          `(${Math.ceil(MIN_CRYPTO_USD / GEM_USD_RATE).toLocaleString()} Gems).`
      });
    }

    if (!Number.isInteger(gems)) {
      return res.status(400).json({
        success: false,
        message: 'Withdrawal Gems must be a whole number.'
      });
    }

    // Basic address sanity check. The administrator still verifies the
    // network/address before sending the manual USDT payout.
    if (
      address.length < 20 ||
      address.length > 128 ||
      /\s/.test(address)
    ) {
      return res.status(400).json({
        success: false,
        message: 'Enter a valid USDT wallet address.'
      });
    }

    const withdrawable = getWithdrawableBalance(user);
    if (gems > withdrawable) {
      return res.status(400).json({
        success: false,
        message:
          `Insufficient withdrawable earnings. ` +
          `You have ${withdrawable.toLocaleString()} Gems available.`
      });
    }

    // Reserve the user's earnings immediately. They remain reserved while
    // the request is Pending. A rejection refunds them automatically.
    const oldWithdrawable = withdrawable;
    const oldBalance = number(user.balance);

    user.withdrawableBalance = oldWithdrawable - gems;
    syncUserBalance(user);
    await updateUser(user);

    const withdrawalCreatedAt = new Date().toISOString();
    const withdrawalId = generateTransactionId('withdrawal_usdt');

    try {
      await addTransaction(user.id, {
        id: withdrawalId,
        type: 'Withdrawal',
        description:
          `Manual USDT Withdrawal — ${gems.toLocaleString()} Gems ($${usd.toFixed(2)})`,
        amount: gems,
        currency: 'GEMS',
        status: 'Pending',
        bank: 'USDT',
        accountName: user.username
          ? `@${user.username}`
          : user.fullName || null,
        accountNumber: address,
        createdAt: withdrawalCreatedAt
      });

      let telegramMessage = null;

      try {
        telegramMessage = await sendManualWithdrawalTelegram({
          withdrawalId,
          user,
          gems,
          usd,
          address,
          balance: user.balance
        });
      } catch (telegramError) {
        // If the admin request cannot be delivered, do not leave the user's
        // Gems locked in a withdrawal nobody can review.
        await supabase
          .from('transactions')
          .delete()
          .eq('id', withdrawalId)
          .eq('status', 'Pending');

        user.withdrawableBalance = oldWithdrawable;
        user.balance = oldBalance;
        await updateUser(user);

        throw telegramError;
      }

      return res.json({
        success: true,
        message:
          'Withdrawal request submitted. It is now pending manual approval.',
        gems,
        usd,
        asset: 'USDT',
        cryptoAmount: usd,
        address,
        status: 'Pending',
        withdrawalId,
        telegramMessageId: telegramMessage?.message_id || null,
        balance: user.balance,
        withdrawableBalance: user.withdrawableBalance,
        depositBalance: user.depositBalance,
        lastWithdrawalAt: withdrawalCreatedAt,
        nextAllowedAt:
          Date.parse(withdrawalCreatedAt) + WITHDRAWAL_COOLDOWN
      });
    } catch (requestError) {
      // If transaction insertion itself failed, restore the reservation.
      const existing = await getWithdrawalById(withdrawalId, user.id).catch(() => null);

      if (existing) {
        await supabase
          .from('transactions')
          .delete()
          .eq('id', withdrawalId)
          .eq('status', 'Pending')
          .catch(() => {});
      }

      const currentUser = await getUserById(user.id).catch(() => null);
      if (
        currentUser &&
        number(currentUser.withdrawableBalance) === oldWithdrawable - gems
      ) {
        currentUser.withdrawableBalance = oldWithdrawable;
        currentUser.balance = oldBalance;
        await updateUser(currentUser).catch(() => {});
      }

      throw requestError;
    }
  } catch (err) {
    console.error('Manual USDT withdrawal error:', err);

    return res.status(
      Number(err?.status) >= 400 && Number(err?.status) < 600
        ? Number(err.status)
        : 500
    ).json({
      success: false,
      message:
        err.message ||
        'Unable to submit the withdrawal request.'
    });
  }
});

// ======================================================
// TRANSACTIONS
// ======================================================

app.get(
  '/api/user/transactions',
  requireLogin,
  async (req, res) => {

    try {

      return res.json({

        success:
          true,

        transactions:
          await getTransactions(
            req.user.id,
            Math.min(
              Math.max(
                Number(req.query.limit) || 25,
                1
              ),
              50
            )
          )

      });

    } catch (err) {

      console.error(
        'Transactions error:',
        err
      );

      return res.status(500).json({

        success:
          false,

        message:
          'Failed to load transactions.'

      });

    }

  }
);

// ======================================================
// TELEGRAM JOIN VERIFICATION
// ======================================================

app.post(
  '/api/user/verify-telegram-join',
  requireLogin,
  async (req, res) => {

    try {

      const user =
        req.user;

      const isLocal =
        req.body?.isLocal ||
        process.env.NODE_ENV !==
        'production';

      if (isLocal) {

        if (
          !user.hasClaimedGiftBox
        ) {

          user.hasClaimedGiftBox =
            true;

          user.freeSpins =
            number(
              user.freeSpins
            ) +
            1;

          await updateUser(
            user
          );

        }

        return res.json({

          success:
            true,

          message:
            'Telegram channel verified successfully!',

          freeSpins:
            user.freeSpins

        });

      }

      if (!user.telegramId) {

        return res.status(400).json({

          success:
            false,

          message:
            'Please open this app via Telegram or connect your account.'

        });

      }

      if (!TELEGRAM_DEPOSIT_BOT_TOKEN) {

        return res.status(500).json({

          success:
            false,

          message:
            'Telegram bot is not configured on the server.'

        });

      }

      const response =
        await fetch(

          `https://api.telegram.org/bot${TELEGRAM_DEPOSIT_BOT_TOKEN}/getChatMember?chat_id=@paymechannel&user_id=${encodeURIComponent(user.telegramId)}`

        );

      const data =
        await response.json();

      if (
        data.ok &&
        [
          'creator',
          'administrator',
          'member'
        ].includes(
          data.result?.status
        )
      ) {

        if (
          !user.hasClaimedGiftBox
        ) {

          user.hasClaimedGiftBox =
            true;

          user.freeSpins =
            number(
              user.freeSpins
            ) +
            1;

          await updateUser(
            user
          );

        }

        return res.json({

          success:
            true,

          message:
            'Telegram channel verified successfully!',

          freeSpins:
            user.freeSpins

        });

      }

      return res.json({

        success:
          false,

        message:
          'You have not joined the channel yet. Please join to claim your spin.'

      });

    } catch (err) {

      console.error(
        'Telegram join verification error:',
        err
      );

      return res.status(500).json({

        success:
          false,

        message:
          'Failed to verify Telegram channel membership.'

      });

    }

  }
);

// ======================================================
// GAME STATE
// ======================================================

app.get(
  '/api/game/state',
  requireLogin,
  async (req, res) => {

    try {

      const spins =
        await getRecentSpins(
          req.user.id,
          20
        );

      return res.json({

        success:
          true,

        balance:
          req.user.balance,

        withdrawableBalance:
          req.user.withdrawableBalance,

        depositBalance:
          req.user.depositBalance,

        spins,

        freeSpins:
          req.user.freeSpins || 0,

        luckTickets:
          number(normalizeDailyReward(req.user).luckTickets),

        hasClaimedGiftBox:
          !!req.user.hasClaimedGiftBox

      });

    } catch (err) {

      console.error(
        'Game state error:',
        err
      );

      return res.status(500).json({

        success:
          false,

        message:
          'Failed to load game state.'

      });

    }

  }
);

// ======================================================
// SPIN GAME
// ======================================================

app.post(
  '/api/game/spin',
  requireLogin,
  async (req, res) => {

    try {

      const user =
        req.user;

      let usedFreeSpin =
        false;

      if (
        number(
          user.freeSpins
        ) >= 1
      ) {

        user.freeSpins -= 1;

        usedFreeSpin =
          true;

      } else {

        if (
          number(
            user.balance
          ) <
          SPIN_COST
        ) {

          return res.status(400).json({

            success:
              false,

            error:
              `Insufficient balance. You need at least Gems💎${SPIN_COST} or a free spin.`

          });

        }

        let remaining =
          SPIN_COST;

        const deposit =
          getDepositBalance(
            user
          );

        const earnings =
          getWithdrawableBalance(
            user
          );

        if (
          deposit >=
          remaining
        ) {

          user.depositBalance =
            deposit -
            remaining;

        } else {

          remaining -=
            deposit;

          user.depositBalance =
            0;

          user.withdrawableBalance =
            Math.max(
              0,
              earnings -
              remaining
            );

        }

        await updateUser(
          user
        );

        await addTransaction(
          user.id,
          {

            id:
              generateTransactionId(
                'tx_spin_entry'
              ),

            type:
              'Spin Entry',

            bank:
              'PAYME Wallet',

            amount:
              SPIN_COST,

            description:
              'Spin entry'

          }
        );

      }

      const prizes = [

        {
          amount: 0,
          ticketAmount: 2,
          weight: 3849,
          label: '2 Luck Tickets'
        },

        {
          amount: 10,
          ticketAmount: 0,
          weight: 2000,
          label: 'Gems💎10'
        },

        {
          amount: 20,
          ticketAmount: 0,
          weight: 2000,
          label: 'Gems💎20'
        },

        {
          amount: 50,
          ticketAmount: 0,
          weight: 1300,
          label: 'Gems💎50'
        },

        {
          amount: 100,
          ticketAmount: 0,
          weight: 350,
          label: 'Gems💎100'
        },

        {
          amount: 0,
          ticketAmount: 300,
          weight: 250,
          label: '300 Luck Tickets'
        },

        {
          amount: 0,
          ticketAmount: 500,
          weight: 100,
          label: '500 Luck Tickets'
        },

        {
          amount: 0,
          ticketAmount: 1000,
          weight: 150,
          label: '1000 Luck Tickets'
        },

        {
          amount: 2000,
          ticketAmount: 0,
          weight: 1,
          label: 'Gems💎2000'
        }

      ];

      const totalWeight =
        prizes.reduce(
          (
            sum,
            prize
          ) =>
            sum +
            prize.weight,
          0
        );

      const randomWeight =
        Math.floor(
          Math.random() *
          totalWeight
        );

      let cumulative =
        0;

      let selectedPrize =
        prizes[0];

      for (
        const prize of prizes
      ) {

        cumulative +=
          prize.weight;

        if (
          randomWeight <
          cumulative
        ) {

          selectedPrize =
            prize;

          break;

        }

      }

      if (
        selectedPrize.amount >
        0
      ) {

        user.withdrawableBalance =
          getWithdrawableBalance(
            user
          ) +
          selectedPrize.amount;

      }

      // Luck Ticket prizes are stored in the existing daily_reward JSON
      // wallet so the reward survives page exits and Render redeploys.
      if (
        Number(selectedPrize.ticketAmount || 0) >
        0
      ) {

        const daily =
          normalizeDailyReward(user);

        daily.luckTickets =
          number(daily.luckTickets) +
          Number(selectedPrize.ticketAmount);

        user.dailyReward = daily;
        user.luckTickets = number(daily.luckTickets);
        user.luckChests = daily.luckChests;

      }

      await updateUser(
        user
      );

      if (usedFreeSpin) {
        recentFreeSpinCompletions.set(String(user.id), Date.now() + (10 * 60 * 1000));
        setTimeout(() => recentFreeSpinCompletions.delete(String(user.id)), 10 * 60 * 1000).unref();
      }

      await addTransaction(
        user.id,
        {

          id:
            generateTransactionId(
              'tx_spin_reward'
            ),

          type:
            usedFreeSpin
              ? 'Free Spin Reward'
              : 'Spin Reward',

          bank:
            'PAYME Wallet',

          amount:
            selectedPrize.ticketAmount > 0
              ? selectedPrize.ticketAmount
              : selectedPrize.amount,

          currency:
            selectedPrize.ticketAmount > 0
              ? 'LUCK_TICKETS'
              : 'GEMS',

          description:
            selectedPrize.label

        }
      );

      const recentSpins =
        await getRecentSpins(
          user.id,
          20
        );

      return res.json({

        success:
          true,

        usedFreeSpin,

        freeSpins:
          user.freeSpins || 0,

        prize:
          selectedPrize.amount,

        ticketReward:
          Number(selectedPrize.ticketAmount || 0),

        prizeLabel:
          selectedPrize.label,

        luckTickets:
          number(user.dailyReward?.luckTickets),

        prizeIndex:
          prizes.indexOf(
            selectedPrize
          ),

        newBalance:
          user.balance,

        withdrawableBalance:
          user.withdrawableBalance,

        depositBalance:
          user.depositBalance,

        spins:
          recentSpins

      });

    } catch (err) {

      console.error(
        'Spin error:',
        err
      );

      return res.status(500).json({

        success:
          false,

        error:
          'Server error during spin.'

      });

    }

  }
);

// ======================================================
// LUCK TICKET TREASURE CHESTS
// ======================================================

function chooseLuckTicketReward() {
  const cfg = LUCK_CHEST_CONFIG.chest;
  const roll = crypto.randomInt(0, 100000) / 1000; // 0.000 - 99.999
  for (const tier of cfg.rewards) {
    if (roll < tier.max) return tier.tickets;
  }
  return cfg.rewards[0].tickets;
}

function getLuckChestSnapshot(user) {
  const daily = normalizeDailyReward(user);
  const cfg = LUCK_CHEST_CONFIG.chest;
  const c = daily.luckChests.chest;
  const now = Date.now();

  const onCooldown = c.cooldownUntil > now;
  const nextAdReadyAt =
    c.progress >= 1 && c.firstAdAt
      ? c.firstAdAt + cfg.adGapMs
      : 0;

  return {
    luckTickets: number(daily.luckTickets),
    chest: {
      requiredAds: cfg.ads,
      progress: number(c.progress),
      onCooldown,
      cooldownUntil: onCooldown ? c.cooldownUntil : 0,
      waitingForGap: nextAdReadyAt > now,
      nextAdReadyAt: nextAdReadyAt > now ? nextAdReadyAt : 0
    },
    serverNow: now
  };
}

// Called before a chest ad is allowed to start. Enforces the 60-second
// gap between ad 1 and ad 2, and the 24-hour cooldown after a claim.
function checkLuckChestReady(user) {
  const snapshot = getLuckChestSnapshot(user);
  if (snapshot.chest.onCooldown) {
    return {
      ready: false,
      message: 'The chest is already open. Come back after the cooldown.',
      nextAllowedAt: snapshot.chest.cooldownUntil
    };
  }
  if (snapshot.chest.waitingForGap) {
    return {
      ready: false,
      message: 'Please wait before watching the next ad.',
      nextAllowedAt: snapshot.chest.nextAdReadyAt
    };
  }
  return { ready: true };
}

function applyLuckChestCompletion(user) {
  const cfg = LUCK_CHEST_CONFIG.chest;
  const daily = normalizeDailyReward(user);
  const chest = daily.luckChests.chest;
  const now = Date.now();

  if (chest.cooldownUntil > now || chest.progress >= cfg.ads) {
    return { granted: false, tickets: 0, state: getLuckChestSnapshot(user) };
  }

  chest.progress += 1;
  if (chest.progress === 1) {
    chest.firstAdAt = now;
  }

  let granted = false;
  let tickets = 0;

  if (chest.progress >= cfg.ads) {
    tickets = chooseLuckTicketReward();
    daily.luckTickets = number(daily.luckTickets) + tickets;
    // The chest re-locks for 24 hours after opening.
    chest.progress = 0;
    chest.firstAdAt = 0;
    chest.cooldownUntil = now + cfg.cooldownMs;
    granted = true;
  }

  user.dailyReward = daily;
  user.luckTickets = number(daily.luckTickets);
  user.luckChests = daily.luckChests;
  return { granted, tickets, state: getLuckChestSnapshot(user) };
}

app.get('/api/luck/chests', requireLogin, async (req, res) => {
  try {
    return res.json({ success: true, ...getLuckChestSnapshot(req.user) });
  } catch (err) {
    console.error('Luck chest state error:', err);
    return res.status(500).json({ success: false, message: 'Unable to load Luck Chest progress.' });
  }
});

// ======================================================
// DOUBLE YOUR GEMS — COIN FLIP
// ======================================================
// A weighted coin flip. The server alone decides the outcome using
// cryptographically secure randomness: 20% win / 80% loss.
 // It is never influenced by stake size or any client-supplied value.
app.post('/api/games/coinflip/play', requireLogin, async (req, res) => {
  try {
    const user = req.user;
    const choice = String(req.body?.choice || '').trim().toLowerCase();
    const amount = Math.floor(Number(req.body?.amount));

    if (!['heads', 'tails'].includes(choice)) {
      return res.status(400).json({
        success: false,
        message: 'Choose heads or tails.'
      });
    }

    if (
      !Number.isFinite(amount) ||
      amount < COIN_FLIP_CONFIG.min ||
      amount > COIN_FLIP_CONFIG.max
    ) {
      return res.status(400).json({
        success: false,
        message: `Choose an amount between Gems💎${COIN_FLIP_CONFIG.min} and Gems💎${COIN_FLIP_CONFIG.max}.`
      });
    }

    syncUserBalance(user);

    if (number(user.balance) < amount) {
      return res.status(400).json({
        success: false,
        code: 'INSUFFICIENT_BALANCE',
        message: `Insufficient balance. You need Gems💎${amount} to play.`
      });
    }

    // Deduct the stake up front — deposit balance first, then withdrawable
    // balance, matching the spend order used by Tap Rush / Lucky 3.
    let remaining = amount;
    const deposit = getDepositBalance(user);
    const earnings = getWithdrawableBalance(user);

    if (deposit >= remaining) {
      user.depositBalance = deposit - remaining;
    } else {
      remaining -= deposit;
      user.depositBalance = 0;
      user.withdrawableBalance = Math.max(0, earnings - remaining);
    }

    syncUserBalance(user);
    await updateUser(user);

    await addTransaction(user.id, {
      id: generateTransactionId('tx_coinflip_stake'),
      type: 'coinflip_stake',
      description: `Double Your Gems — Gems💎${amount} wagered on ${choice}`,
      amount,
      currency: 'GEMS',
      status: 'completed',
      bank: 'PAYME Wallet'
    });

    // First decide whether this play is a win (20%) or a loss (80%).
    // Only after that do we choose the displayed side. On a win the
    // result matches the user's choice; on a loss it is the opposite.
    // This preserves a natural coin-flip animation while enforcing the
    // configured 20/80 outcome rate server-side.
    const won = crypto.randomInt(0, 10000) < Math.round(COIN_FLIP_CONFIG.winChance * 10000);
    const result = won
      ? choice
      : (choice === 'heads' ? 'tails' : 'heads');
    let payout = 0;

    if (won) {
      payout = amount * 2;
      user.withdrawableBalance = getWithdrawableBalance(user) + payout;
      syncUserBalance(user);
      await updateUser(user);

      await addTransaction(user.id, {
        id: generateTransactionId('tx_coinflip_win'),
        type: 'coinflip_win',
        description: `Double Your Gems — Won Gems💎${payout} (landed ${result})`,
        amount: payout,
        currency: 'GEMS',
        status: 'completed',
        bank: 'PAYME Wallet'
      });
    }

    return res.json({
      success: true,
      result,
      won,
      amount,
      payout,
      balance: user.balance,
      withdrawableBalance: user.withdrawableBalance,
      depositBalance: user.depositBalance
    });

  } catch (err) {
    console.error('Coin flip error:', err);
    return res.status(500).json({
      success: false,
      message: 'Unable to play Double Your Gems right now.'
    });
  }
});

// ======================================================
// LUCKY 3 — SECURE INSTANT GAME
// ======================================================
// IMPORTANT:
// The browser submits only the player's selection. The server
// generates the winning numbers with Node's cryptographically
// secure crypto.randomInt(). The wallet debit, reward/free-spin
// credit, game record and transaction rows are committed by the
// Supabase RPC play_lucky3_atomic in one database transaction.
//
// The SQL function is supplied separately with this build. Do not
// replace this with client-side Math.random() or direct balance edits.
// ======================================================

function lucky3GenerateNumbers() {
  const values = new Set();

  while (values.size < 3) {
    values.add(
      crypto.randomInt(
        LUCKY3_CONFIG.numberMin,
        LUCKY3_CONFIG.numberMax + 1
      )
    );
  }

  return Array.from(values).sort((a, b) => a - b);
}

function lucky3ValidateNumbers(values, fieldName) {
  if (!Array.isArray(values) || values.length !== 3) {
    throw new Error(`${fieldName} must contain exactly 3 numbers.`);
  }

  const clean = values.map(Number);

  if (
    clean.some(
      n =>
        !Number.isInteger(n) ||
        n < LUCKY3_CONFIG.numberMin ||
        n > LUCKY3_CONFIG.numberMax
    )
  ) {
    throw new Error(`${fieldName} contains an invalid number.`);
  }

  if (new Set(clean).size !== 3) {
    throw new Error(`${fieldName} must contain 3 unique numbers.`);
  }

  return clean.sort((a, b) => a - b);
}

app.post(
  '/api/games/lucky3/play',
  requireLogin,
  async (req, res) => {
    try {
      const user = req.user;
      const body = req.body || {};

      const selectedNumbers = lucky3ValidateNumbers(
        body.numbers,
        'Selected numbers'
      );

      const gameType = String(body.gameType || '').trim().toLowerCase();
      if (!LUCKY3_GAME_TYPES.has(gameType)) {
        return res.status(400).json({
          success: false,
          message: 'Invalid Lucky 3 game type.'
        });
      }

      const stake = Number(body.stake);
      if (![100, 200, 500].includes(stake)) {
        return res.status(400).json({
          success: false,
          message: 'Choose 100, 200, or 500 Luck Tickets.'
        });
      }

      const requestId = String(
        body.requestId || generateTransactionId('l3req')
      ).trim();

      if (!/^[A-Za-z0-9_-]{8,160}$/.test(requestId)) {
        return res.status(400).json({
          success: false,
          message: 'Invalid Lucky 3 request ID.'
        });
      }

      // Payout table is centralized in LUCKY3_CONFIG.stakes above.
      const payoutConfig = LUCKY3_CONFIG.stakes[stake];

      // Generate the draw on the server with cryptographically secure randomness.
      const winningNumbers = lucky3GenerateNumbers();
      const matchCount = selectedNumbers.filter(
        n => winningNumbers.includes(n)
      ).length;

      let payout = 0;
      let freeSpinsAwarded = 0;
      if (gameType === 'jackpot' && matchCount === 3) {
        payout = payoutConfig.jackpot;
      } else if (gameType === 'cash' && matchCount >= 2) {
        payout = payoutConfig.cash;
      } else if (gameType === 'bonus' && matchCount >= 1) {
        freeSpinsAwarded = payoutConfig.bonusFreeSpins;
      }

      // Idempotency: reject a repeated request before touching the ticket wallet.
      const { data: existingRequest, error: requestLookupError } = await supabase
        .from('transactions')
        .select('id, description, amount, created_at')
        .eq('user_id', user.id)
        .eq('type', 'lucky3_ticket_entry')
        .eq('description', `Lucky 3 Request — ${requestId}`)
        .maybeSingle();

      if (requestLookupError) throw requestLookupError;
      if (existingRequest) {
        return res.status(409).json({
          success: false,
          code: 'DUPLICATE_REQUEST',
          message: 'This Lucky 3 request has already been processed.'
        });
      }

      const daily = normalizeDailyReward(user);
      let oldDaily = JSON.parse(JSON.stringify(daily));
      const tickets = number(daily.luckTickets);

      if (tickets < stake) {
        return res.status(400).json({
          success: false,
          code: 'INSUFFICIENT_TICKETS',
          message: `You need ${stake} Luck Tickets to play.`
        });
      }

      daily.luckTickets = tickets - stake;
      user.dailyReward = daily;
      user.luckTickets = daily.luckTickets;
      user.luckChests = daily.luckChests;

      // Optimistic concurrency check prevents two rapid clicks from spending
      // the same ticket balance. Retry against the newest row if necessary.
      let committed = false;
      for (let attempt = 0; attempt < 3 && !committed; attempt++) {
        const { data: updatedRows, error: updateError } = await supabase
          .from('users')
          .update({ daily_reward: user.dailyReward })
          .eq('id', user.id)
          .eq('daily_reward', JSON.stringify(oldDaily))
          .select('id');

        if (updateError) throw updateError;
        committed = Array.isArray(updatedRows) && updatedRows.length > 0;

        if (!committed) {
          const fresh = await getUserById(user.id);
          if (!fresh) throw new Error('User session not found.');
          const freshDaily = normalizeDailyReward(fresh);
          if (number(freshDaily.luckTickets) < stake) {
            return res.status(400).json({
              success: false,
              code: 'INSUFFICIENT_TICKETS',
              message: `You need ${stake} Luck Tickets to play.`
            });
          }
          oldDaily = JSON.parse(JSON.stringify(freshDaily));
          freshDaily.luckTickets = number(freshDaily.luckTickets) - stake;
          fresh.dailyReward = freshDaily;
          user.dailyReward = freshDaily;
          user.luckTickets = freshDaily.luckTickets;
          user.luckChests = freshDaily.luckChests;
        }
      }

      if (!committed) {
        return res.status(409).json({
          success: false,
          code: 'RETRY',
          message: 'Please try Lucky 3 again.'
        });
      }

      const gameId = generateTransactionId('lucky3');
      await addTransaction(user.id, {
        id: generateTransactionId('tx_lucky3_entry'),
        type: 'lucky3_ticket_entry',
        description: `Lucky 3 Request — ${requestId}`,
        amount: stake,
        currency: 'LUCK_TICKETS',
        status: 'completed',
        bank: 'Luck Ticket Wallet'
      });

      if (payout > 0) {
        user.withdrawableBalance = getWithdrawableBalance(user) + payout;
      }
      if (freeSpinsAwarded > 0) {
        user.freeSpins = number(user.freeSpins) + freeSpinsAwarded;
      }
      await updateUser(user);

      if (payout > 0 || freeSpinsAwarded > 0) {
        await addTransaction(user.id, {
          id: generateTransactionId('tx_lucky3_reward'),
          type: 'lucky3_reward',
          description: payout > 0
            ? `Lucky 3 Reward — ${gameType} — Gems💎${payout}`
            : `Lucky 3 Reward — ${gameType} — ${freeSpinsAwarded} Free Spins`,
          amount: payout,
          currency: payout > 0 ? 'GEMS' : 'LUCK_TICKETS',
          status: 'completed',
          bank: 'Lucky 3'
        });
      }

      return res.json({
        success: true,
        gameId,
        requestId,
        selectedNumbers,
        winningNumbers,
        matchCount,
        gameType,
        stake,
        payout,
        freeSpinsAwarded,
        luckTickets: number(user.dailyReward.luckTickets),
        balance: number(user.balance),
        depositBalance: number(user.depositBalance),
        withdrawableBalance: number(user.withdrawableBalance),
        freeSpins: number(user.freeSpins)
      });
    } catch (err) {
      console.error('Lucky 3 ticket error:', err);
      return res.status(500).json({
        success: false,
        code: 'LUCKY3_SERVER_ERROR',
        message: 'Something went wrong while processing Lucky 3.'
      });
    }
  }
);

// ======================================================
// CRYPTO DEPOSIT CONFIG
// ======================================================
app.get('/api/crypto/config', requireLogin, async (req, res) => {
  try {
    await refreshLiveGemRate();
    return res.json({
      success: true,
      gemUsdRate: GEM_USD_RATE,
      ngnPerUsd: NGN_PER_USD,
      minUsd: MIN_CRYPTO_USD,
      minGems: Math.ceil(MIN_CRYPTO_USD / GEM_USD_RATE),
      assets: CRYPTO_ASSETS,
      cryptobotConfigured: !!CRYPTOBOT_TOKEN
    });
  } catch (err) {
    console.error('Crypto config error:', err);
    return res.status(500).json({ success: false, message: 'Unable to load crypto payment settings.' });
  }
});

// ======================================================
// GET DEPOSITS
// ======================================================
app.get('/api/deposits', requireLogin, async (req, res) => {
  try {
    return res.json({
      success: true,
      deposits: await getUserDeposits(
        req.user.id,
        Math.min(Math.max(Number(req.query.limit) || 25, 1), 50)
      )
    });
  } catch (err) {
    console.error('Get deposits error:', err);
    return res.status(500).json({ success: false, message: 'Failed to load deposits.' });
  }
});

// ======================================================
// CREATE CRYPTO DEPOSIT INVOICE
// ======================================================
app.post('/api/crypto/deposit', requireLogin, async (req, res) => {
  try {
    await refreshLiveGemRate();
    if (!CRYPTOBOT_TOKEN) {
      return res.status(503).json({ success: false, message: 'Crypto payments are not configured yet.' });
    }

    const gems = number(req.body?.gems);
    const usd = gemUsd(gems);

    if (!Number.isFinite(gems) || gems <= 0 || usd < MIN_CRYPTO_USD) {
      return res.status(400).json({
        success: false,
        message: `Minimum deposit is $${MIN_CRYPTO_USD.toFixed(2)} (${Math.ceil(MIN_CRYPTO_USD / GEM_USD_RATE).toLocaleString()} Gems).`
      });
    }

    const reference = generateDepositReference();
    const invoice = await cryptoBotCreateInvoice({ gems, usd, reference });

    const { error } = await supabase.from('deposits').insert({
      reference,
      user_id: req.user.id,
      amount: gems,
      status: 'Pending Verification',
      screenshot: null,
      reason: `CryptoBot invoice ${invoice.invoice_id} — $${usd.toFixed(2)}`
    });
    if (error) throw error;

    return res.json({
      success: true,
      reference,
      invoiceId: invoice.invoice_id,
      gems,
      usd,
      invoiceUrl: invoice.mini_app_invoice_url || invoice.bot_invoice_url || invoice.web_app_invoice_url
    });
  } catch (err) {
    console.error('Crypto deposit error:', err);
    return res.status(500).json({ success: false, message: err.message || 'Unable to create crypto deposit invoice.' });
  }
});

// ======================================================
// CRYPTO DEPOSIT STATUS
// ======================================================
app.get('/api/crypto/deposit-status/:reference', requireLogin, async (req, res) => {
  try {
    const reference = String(req.params.reference || '').trim();
    const deposit = await getDeposit(reference);

    if (!deposit || String(deposit.user_id) !== String(req.user.id)) {
      return res.status(404).json({ success: false, message: 'Deposit not found.' });
    }

    return res.json({
      success: true,
      reference,
      status: deposit.status,
      gems: number(deposit.amount),
      usd: gemUsd(number(deposit.amount)),
      reason: deposit.reason || null
    });
  } catch (err) {
    console.error('Crypto deposit status error:', err);
    return res.status(500).json({ success: false, message: 'Unable to check deposit status.' });
  }
});

// ======================================================
// VERIFY DEPOSIT
// ======================================================

async function verifyDeposit(
  userId,
  reference,
  action,
  reason
) {

  const targetUser =
    await getUserById(
      userId
    );

  if (!targetUser) {

    throw Object.assign(
      new Error(
        'User not found'
      ),
      {
        status:
          404
      }
    );

  }

  const deposit =
    await getDeposit(
      reference
    );

  if (
    !deposit ||
    deposit.user_id !==
    targetUser.id
  ) {

    throw Object.assign(
      new Error(
        'Deposit not found'
      ),
      {
        status:
          404
      }
    );

  }

  if (
    deposit.status !==
    'Pending Verification'
  ) {

    throw Object.assign(
      new Error(
        'Deposit not found or already verified'
      ),
      {
        status:
          400
      }
    );

  }

  if (
    action ===
    'approve'
  ) {

    const amount =
      number(
        deposit.amount
      );

    targetUser.depositBalance =
      getDepositBalance(
        targetUser
      ) +
      amount;

    await updateUser(
      targetUser
    );

    const {
      error
    } =
      await supabase
        .from('deposits')
        .update({

          status:
            'Approved',

          reason:
            null

        })
        .eq(
          'reference',
          reference
        );

    if (error) {
      throw error;
    }

    await addTransaction(
      targetUser.id,
      {

        id:
          generateTransactionId(
            'tx_deposit'
          ),

        type:
          'Deposit Approved',

        description:
          `Deposit ${reference}`,

        amount,

        currency:
          'GEMS',

        status:
          'completed',

        bank:
          'PalmPay'

      }
    );

  } else if (
    action ===
    'reject'
  ) {

    const {
      error
    } =
      await supabase
        .from('deposits')
        .update({

          status:
            'Rejected',

          reason:
            reason ||
            'Payment proof was rejected.'

        })
        .eq(
          'reference',
          reference
        );

    if (error) {
      throw error;
    }

  } else {

    throw Object.assign(
      new Error(
        'Invalid action. Use approve or reject.'
      ),
      {
        status:
          400
      }
    );

  }

  return {

    user:
      await getUserById(
        targetUser.id
      ),

    deposit:
      await getDeposit(
        reference
      )

  };

}

// ======================================================
// ADMIN DEPOSIT VERIFY
// ======================================================

app.post(
  '/api/admin/deposits/verify',
  async (req, res) => {

    try {

      const expectedSecret =
        process.env.PAYME_ADMIN_SECRET ||
        'payme_admin_secret_2026';

      if (
        req.body.adminSecret !==
        expectedSecret
      ) {

        return res.status(403).json({

          success:
            false,

          error:
            'Forbidden'

        });

      }

      const result =
        await verifyDeposit(

          req.body.userId,

          req.body.reference,

          req.body.action,

          req.body.reason

        );

      return res.json({

        success:
          true,

        message:
          `Deposit ${result.deposit.status.toLowerCase()} successfully.`,

        deposit:
          result.deposit,

        balance:
          result.user.balance,

        withdrawableBalance:
          result.user.withdrawableBalance,

        depositBalance:
          result.user.depositBalance

      });

    } catch (err) {

      console.error(
        'Admin deposit verification error:',
        err
      );

      return res.status(
        err.status || 500
      ).json({

        success:
          false,

        error:
          err.message ||
          'Failed to verify deposit.'

      });

    }

  }
);

// ======================================================
// DAILY REWARD HELPERS
// ======================================================

function normalizeDailyReward(
  user
) {

  if (
    !user.dailyReward ||
    typeof user.dailyReward !==
    'object'
  ) {

    user.dailyReward = {

      currentDay:
        1,

      lastClaimTimestamp:
        0,

      claimedDays:
        []

    };

  }

  if (
    !Array.isArray(
      user.dailyReward.claimedDays
    )
  ) {

    user.dailyReward.claimedDays =
      [];

  }

  user.dailyReward.claimedDays =
    [
      ...new Set(
        user.dailyReward.claimedDays
          .map(Number)
          .filter(
            d =>
              Number.isInteger(d) &&
              d >= 1 &&
              d <= 7
          )
      )
    ]
      .sort(
        (a, b) =>
          a - b
      );

  let currentDay =
    number(
      user.dailyReward.currentDay
    ) || 1;

  if (
    currentDay < 1 ||
    currentDay > 7
  ) {

    currentDay =
      1;

  }

  user.dailyReward.currentDay =
    currentDay;

  if (!Number.isFinite(Number(user.dailyReward.luckTickets))) {
    user.dailyReward.luckTickets = 0;
  }

  if (!user.dailyReward.luckChests || typeof user.dailyReward.luckChests !== 'object') {
    user.dailyReward.luckChests = {};
  }

  {
    const cfg = LUCK_CHEST_CONFIG.chest;
    const existing = user.dailyReward.luckChests.chest || {};
    user.dailyReward.luckChests = {
      chest: {
        progress: Math.max(0, Math.min(cfg.ads, number(existing.progress))),
        firstAdAt: Number(existing.firstAdAt) || 0,
        cooldownUntil: Number(existing.cooldownUntil) || 0
      }
    };
  }

  return user.dailyReward;

}

// ======================================================
// DASHBOARD
// ======================================================

app.post(
  '/api/user/dashboard',
  async (req, res) => {

    try {

      await refreshLiveGemRate();

      let user =
        req.user;

      const {
        telegramId,
        username
      } =
        req.body || {};

      if (
        !user &&
        telegramId
      ) {

        user =
          await getUserByTelegramId(
            String(
              telegramId
            )
          );

      }

      if (
        !user &&
        username
      ) {

        user =
          await getUserByUsername(
            String(username)
              .toLowerCase()
          );

      }

      if (!user) {

        return res.status(401).json({

          success:
            false,

          message:
            'Unauthorized session.'

        });

      }

      if (
        telegramId &&
        user.telegramId !==
        String(telegramId)
      ) {

        user.telegramId =
          String(telegramId);

        await updateUser(
          user
        );

      }

      const beforeBonus =
        user.hasReceivedWelcomeBonus;

      await ensureWelcomeBonus(
        user
      );

      // ensureWelcomeBonus() mutates and persists `user` in place when it
      // grants the bonus, so re-reading the row here was a duplicate
      // Supabase query on every single dashboard poll. The in-memory
      // object already reflects the persisted state.
      const isNewUser =
        !beforeBonus &&
        user.hasReceivedWelcomeBonus;

      // Same reasoning: `user` already carries the up-to-date fields
      // (mutated + persisted above when relevant), so a second re-fetch
      // here was redundant on every poll.
      // dashboard.html's own response handler never reads `.transactions`
      // or `.deposits` from THIS endpoint's payload — it only reads
      // `.success`, `.user`, and `.dailyReward`. Transaction history is
      // rendered by a separate on-demand modal that calls the dedicated
      // /api/user/transactions endpoint when the user actually opens it,
      // and deposit history likewise has its own /api/deposits endpoint.
      // Fetching both full lists here on every single dashboard load (or
      // every tab-return) was pure wasted Supabase egress for data that
      // was silently discarded on arrival.

      const justCompletedFreeSpin =
        Number(recentFreeSpinCompletions.get(String(user.id)) || 0) > Date.now();

      const daily =
        normalizeDailyReward(
          user
        );

      const lastClaimTimestamp =
        number(
          daily.lastClaimTimestamp
        );

      const canClaim =
        !lastClaimTimestamp ||
        Date.now() -
        lastClaimTimestamp >=
        CLAIM_COOLDOWN;

      let dailyRewardCycleReset =
        false;

      if (
        canClaim &&
        daily.currentDay === 1 &&
        daily.claimedDays.includes(7)
      ) {

        daily.claimedDays =
          [];

        dailyRewardCycleReset =
          true;

      }

      // Only write to Supabase here when something actually changed
      // (the once-per-cycle claimedDays reset). Every other field on
      // `user` was already persisted by its own updateUser() call above
      // (or hasn't changed at all), so writing unconditionally on every
      // 5-30s poll from every active user was pure wasted egress.
      if (dailyRewardCycleReset) {

        await updateUser(
          user
        );

      }

      return res.json({

        success:
          true,

        user: {

          ...sanitizeUser(
            user
          ),

          showOnboardingTutorial:
            !!user.hasReceivedWelcomeBonus &&
            !!user.hasClaimedGiftBox &&
            !user.hasSeenPopup &&
            justCompletedFreeSpin,

          isNewUser,

          minWithdrawalLimit:
            MIN_WITHDRAWAL_LIMIT,

          gemUsdRate:
            GEM_USD_RATE,

          ngnPerUsd:
            NGN_PER_USD,

          canWithdraw:
            number(
              user.withdrawableBalance
            ) >=
            MIN_WITHDRAWAL_LIMIT

        },

        gemUsdRate:
          GEM_USD_RATE,

        ngnPerUsd:
          NGN_PER_USD,

        dailyReward: {

          currentDay:
            daily.currentDay,

          lastClaimTime:
            lastClaimTimestamp,

          nextClaimTime:
            canClaim
              ? 0
              : lastClaimTimestamp +
                CLAIM_COOLDOWN,

          canClaim,

          claimedDays:
            daily.claimedDays,

          luckTickets:
            number(
              daily.luckTickets
            ),

          lastClaimedDay:
            daily.claimedDays.length
              ? Math.max(
                  ...daily.claimedDays
                )
              : 0

        }

      });

    } catch (err) {

      console.error(
        'Dashboard error:',
        err
      );

      return res.status(500).json({

        success:
          false,

        message:
          'Server error loading dashboard.'

      });

    }

  }
);

// ======================================================
// CLAIM DAILY REWARD
// ======================================================

app.post(
  '/api/user/claim-daily',
  requireLogin,
  async (req, res) => {

    try {

      let user =
        req.user;

      const reqDay =
        Number(
          req.body?.day
        );

      if (
        !Number.isInteger(
          reqDay
        ) ||
        reqDay < 1 ||
        reqDay > 7
      ) {

        return res.status(400).json({

          success:
            false,

          message:
            'Invalid daily reward day.'

        });

      }

      const daily =
        normalizeDailyReward(
          user
        );

      const now =
        Date.now();

      const lastClaim =
        number(
          daily.lastClaimTimestamp
        );

      const canClaim =
        !lastClaim ||
        now -
        lastClaim >=
        CLAIM_COOLDOWN;

      // BACKEND ENFORCES THE EXACT NEXT DAY.
      if (
        reqDay !==
        daily.currentDay
      ) {

        return res.status(400).json({

          success:
            false,

          message:
            `You must claim Day ${daily.currentDay} next.`,

          dailyReward: {

            currentDay:
              daily.currentDay,

            lastClaimTime:
              lastClaim,

            nextClaimTime:
              canClaim
                ? 0
                : lastClaim +
                  CLAIM_COOLDOWN,

            canClaim,

            claimedDays:
              daily.claimedDays

          }

        });

      }

      // BACKEND ENFORCES 24-HOUR WAIT.
      if (
        lastClaim &&
        !canClaim
      ) {

        const remaining =
          Math.max(
            0,
            lastClaim +
            CLAIM_COOLDOWN -
            now
          );

        const hours =
          Math.floor(
            remaining /
            3600000
          );

        const minutes =
          Math.ceil(
            (
              remaining %
              3600000
            ) /
            60000
          );

        return res.status(400).json({

          success:
            false,

          message:
            `Day ${daily.currentDay} is not available yet. Please wait ${hours}h ${minutes}m.`,

          dailyReward: {

            currentDay:
              daily.currentDay,

            lastClaimTime:
              lastClaim,

            nextClaimTime:
              lastClaim +
              CLAIM_COOLDOWN,

            canClaim:
              false,

            claimedDays:
              daily.claimedDays

          }

        });

      }

      let rewardMessage;

      if (
        reqDay <= 6
      ) {

        user.withdrawableBalance =
          getWithdrawableBalance(
            user
          ) +
          10;

        await updateUser(
          user
        );

        await addTransaction(
          user.id,
          {

            id:
              generateTransactionId(
                'tx_daily_reward'
              ),

            type:
              'daily_reward',

            description:
              `Daily Reward (Day ${reqDay})`,

            amount:
              10,

            currency:
              'GEMS',

            status:
              'completed'

          }
        );

        rewardMessage =
          'Gems💎10 daily reward claimed.';

      } else {

        // Day 7 special bonus: 200 Luck Tickets.
        // Luck Tickets live inside daily_reward so the existing wallet
        // structure is preserved and the balance survives redeploys.
        daily.luckTickets =
          number(daily.luckTickets) +
          200;

        user.dailyReward =
          daily;

        user.luckTickets =
          number(daily.luckTickets);

        await updateUser(
          user
        );

        await addTransaction(
          user.id,
          {

            id:
              generateTransactionId(
                'tx_daily_reward'
              ),

            type:
              'daily_reward',

            description:
              'Daily Reward (Day 7) - 200 Luck Tickets',

            amount:
              200,

            currency:
              'LUCK_TICKETS',

            status:
              'completed'

          }
        );

        rewardMessage =
          'You earned 200 Luck Tickets!';

      }

      if (
        !daily.claimedDays.includes(
          reqDay
        )
      ) {

        daily.claimedDays.push(
          reqDay
        );

      }

      daily.claimedDays =
        [
          ...new Set(
            daily.claimedDays
          )
        ]
          .sort(
            (a, b) =>
              a - b
          );

      daily.lastClaimTimestamp =
        now;

      daily.currentDay =
        reqDay >= 7
          ? 1
          : reqDay + 1;

      user.dailyReward =
        daily;

      await updateUser(
        user
      );

      if (
        Number(recentFreeSpinCompletions.get(String(user.id)) || 0) > Date.now()
      ) {
        recentFreeSpinCompletions.delete(String(user.id));
      }

      return res.json({

        success:
          true,

        message:
          rewardMessage,

        user: {

          id:
            user.id,

          balance:
            user.balance,

          withdrawableBalance:
            user.withdrawableBalance,

          depositBalance:
            user.depositBalance,

          freeSpins:
            user.freeSpins,

          luckTickets:
            number(
              user.dailyReward?.luckTickets
            )

        },

        ticketReward:
          reqDay === 7
            ? 200
            : 0,

        dailyReward: {

          currentDay:
            daily.currentDay,

          lastClaimTime:
            now,

          nextClaimTime:
            now +
            CLAIM_COOLDOWN,

          canClaim:
            false,

          claimedDays:
            daily.claimedDays,

          lastClaimedDay:
            reqDay

        }

      });

    } catch (err) {

      console.error(
        'Daily claim server error:',
        err
      );

      return res.status(500).json({

        success:
          false,

        message:
          'Internal server error.'

      });

    }

  }
);

// ======================================================
// LEADERBOARD
// ======================================================
// The leaderboard is identical for every visitor, but it was being
// re-queried from Supabase on every single request from every user
// (every 5 seconds, per open tab). With thousands of active users that
// is thousands of duplicate reads per minute for data that only needs
// to be a few seconds fresh. A tiny in-memory cache means Supabase is
// only actually hit once per cache window, no matter how many users
// are polling.
let leaderboardCache = {
  data: null,
  expiresAt: 0
};
const LEADERBOARD_CACHE_TTL_MS = 20000;

app.get(
  '/api/leaderboard',
  async (req, res) => {

    try {

      const now =
        Date.now();

      let leaderboard;

      if (
        leaderboardCache.data &&
        leaderboardCache.expiresAt > now
      ) {

        leaderboard =
          leaderboardCache.data;

      } else {

        const {
          data,
          error
        } =
          await supabase
            .from('users')
            .select(
              'username,total_referrals,referral_earnings'
            )
            .gt(
              'total_referrals',
              0
            )
            .order(
              'referral_earnings',
              {
                ascending:
                  false
              }
            )
            .limit(10);

        if (error) {
          throw error;
        }

        leaderboard =
          (
            data || []
          ).map(
            u => ({

              username:
                u.username,

              totalReferrals:
                number(
                  u.total_referrals
                ),

              referralEarnings:
                number(
                  u.referral_earnings
                )

            })
          );

        leaderboardCache = {
          data: leaderboard,
          expiresAt:
            now +
            LEADERBOARD_CACHE_TTL_MS
        };

      }

      return res.json({

        success:
          true,

        leaderboard

      });

    } catch (err) {

      console.error(
        'Leaderboard error:',
        err
      );

      return res.status(500).json({

        success:
          false,

        error:
          'Failed to load leaderboard.'

      });

    }

  }
);

// ======================================================
// WEEKLY REFERRAL COMPETITION
// ======================================================

const WEEKLY_PRIZES = [

  {

    position:
      1,

    amount:
      1000,

    description:
      'Weekly Referral Challenge — 1st Place'

  },

  {

    position:
      2,

    amount:
      500,

    description:
      'Weekly Referral Challenge — 2nd Place'

  },

  {

    position:
      3,

    amount:
      200,

    description:
      'Weekly Referral Challenge — 3rd Place'

  }

];

const WEEKLY_TIMEZONE =
  'Africa/Lagos';

function getCompetitionStart(
  date = new Date()
) {

  const wat =
    new Date(
      new Date(date).getTime() +
      60 *
      60 *
      1000
    );

  const day =
    wat.getUTCDay();

  const daysSinceMonday =
    day === 0
      ? 6
      : day - 1;

  wat.setUTCDate(
    wat.getUTCDate() -
    daysSinceMonday
  );

  wat.setUTCHours(
    0,
    0,
    0,
    0
  );

  return new Date(
    wat.getTime() -
    60 *
    60 *
    1000
  );

}

function getCompetitionEnd(
  startDate
) {

  const end =
    new Date(
      startDate
    );

  end.setUTCDate(
    end.getUTCDate() +
    7
  );

  return end;

}

function getCurrentCompetition() {

  const start =
    getCompetitionStart();

  const end =
    getCompetitionEnd(
      start
    );

  return {

    competitionId:
      `weekly_${start
        .toISOString()
        .slice(0, 10)}`,

    startTime:
      start.toISOString(),

    endTime:
      end.toISOString(),

    status:
      'active'

  };

}

// ======================================================
// WEEKLY LEADERBOARD FROM SUPABASE
// ======================================================

async function getWeeklyLeaderboard(
  competition =
    getCurrentCompetition()
) {

  const {
    data: referrals,
    error
  } =
    await supabase
      .from('transactions')
      .select(
        'user_id,created_at,description'
      )
      .eq(
        'type',
        'referral_reward'
      )
      .gte(
        'created_at',
        competition.startTime
      )
      .lt(
        'created_at',
        competition.endTime
      )
      .order(
        'created_at',
        {
          ascending:
            true
        }
      );

  if (error) {
    throw error;
  }

  const groups =
    new Map();

  for (
    const tx of
    referrals || []
  ) {

    if (
      !groups.has(
        tx.user_id
      )
    ) {

      groups.set(
        tx.user_id,
        []
      );

    }

    groups
      .get(
        tx.user_id
      )
      .push(tx);

  }

  if (
    !groups.size
  ) {

    return [];

  }

  const ids =
    [
      ...groups.keys()
    ];

  const {
    data: users,
    error: usersError
  } =
    await supabase
      .from('users')
      .select(
        'id,username,full_name'
      )
      .in(
        'id',
        ids
      );

  if (usersError) {
    throw usersError;
  }

  const byId =
    new Map(
      (
        users || []
      ).map(
        u =>
          [
            u.id,
            u
          ]
      )
    );

  return [

    ...groups.entries()

  ]

    .map(
      ([userId, events]) => ({

        userId,

        username:
          byId.get(
            userId
          )?.username ||
          'User',

        fullName:
          byId.get(
            userId
          )?.full_name ||
          '',

        eligibleReferrals:
          events.length,

        lastReferralAt:
          events[
            events.length - 1
          ]?.created_at ||
          null

      })
    )

    .sort(
      (a, b) => {

        if (
          b.eligibleReferrals !==
          a.eligibleReferrals
        ) {

          return (
            b.eligibleReferrals -
            a.eligibleReferrals
          );

        }

        return (
          new Date(
            a.lastReferralAt
          ).getTime() -
          new Date(
            b.lastReferralAt
          ).getTime()
        );

      }
    )

    .map(
      (u, i) => ({

        ...u,

        position:
          i + 1,

        prize:
          WEEKLY_PRIZES.find(
            p =>
              p.position ===
              i + 1
          )?.amount ||
          0

      })
    );

}

// ======================================================
// FINALIZE WEEKLY COMPETITION
// ======================================================

async function finalizeWeeklyCompetition(
  competition = getCurrentCompetition()
) {

  if (
    Date.now() <
    new Date(
      competition.endTime
    ).getTime()
  ) {

    return;

  }

  const leaderboard =
    await getWeeklyLeaderboard(
      competition
    );

  for (
    const prize of
    WEEKLY_PRIZES
  ) {

    const winner =
      leaderboard.find(
        u =>
          u.position ===
          prize.position
      );

    if (!winner) {
      continue;
    }

    const uniqueId =
      `tx_weekly_referral_${competition.competitionId}_${winner.userId}`;

    const {
      data: alreadyPaid,
      error
    } =
      await supabase
        .from('transactions')
        .select('id')
        .eq(
          'id',
          uniqueId
        )
        .maybeSingle();

    if (error) {
      throw error;
    }

    if (alreadyPaid) {
      continue;
    }

    const user =
      await getUserById(
        winner.userId
      );

    if (!user) {
      continue;
    }

    user.withdrawableBalance =
      getWithdrawableBalance(
        user
      ) +
      prize.amount;

    await updateUser(
      user
    );

    await addTransaction(
      user.id,
      {

        id:
          uniqueId,

        type:
          'weekly_referral_reward',

        description:
          `${prize.description} (${competition.competitionId})`,

        amount:
          prize.amount,

        currency:
          'GEMS',

        status:
          'completed'

      }
    );

  }

}

// ======================================================
// WEEKLY COMPETITION API
// ======================================================

app.get(
  '/api/weekly-competition',
  async (req, res) => {

    try {

      const competition =
        getCurrentCompetition();

      const leaderboard =
        await getWeeklyLeaderboard(
          competition
        );

      let userPosition =
        null;

      let userEligibleReferrals =
        0;

      if (
        req.session &&
        req.session.userId
      ) {

        const row =
          leaderboard.find(
            u =>
              u.userId ===
              req.session.userId
          );

        if (row) {

          userPosition =
            row.position;

          userEligibleReferrals =
            row.eligibleReferrals;

        }

      }

      const remainingMs =
        Math.max(
          0,
          new Date(
            competition.endTime
          ).getTime() -
          Date.now()
        );

      return res.json({

        success:
          true,

        competition: {

          ...competition,

          timezone:
            WEEKLY_TIMEZONE,

          remainingMs

        },

        prizes:
          WEEKLY_PRIZES,

        leaderboard:
          leaderboard.slice(
            0,
            10
          ),

        user: {

          position:
            userPosition,

          eligibleReferrals:
            userEligibleReferrals

        },

        rules: {

          tieBreaker:
            'If users have the same number of eligible referrals, the user who reached that count first ranks higher.',

          eligibility:
            'Only eligible referrals confirmed during the current competition period count.'

        }

      });

    } catch (err) {

      console.error(
        'Weekly leaderboard error:',
        err
      );

      return res.status(500).json({

        success:
          false,

        error:
          'Failed to load weekly competition.'

      });

    }

  }
);

// ======================================================
// WEEKLY HISTORY
// ======================================================

app.get(
  '/api/weekly-competition/history',
  async (req, res) => {

    try {

      const {
        data,
        error
      } =
        await supabase
          .from('transactions')
          .select(
            'id,user_id,type,description,amount,created_at'
          )
          .eq(
            'type',
            'weekly_referral_reward'
          )
          .order(
            'created_at',
            {
              ascending:
                false
            }
          );

      if (error) {
        throw error;
      }

      const historyMap =
        new Map();

      for (
        const tx of
        data || []
      ) {

        const match =
          String(
            tx.description || ''
          ).match(
            /(weekly_\d{4}-\d{2}-\d{2})/
          );

        const competitionId =
          match
            ? match[1]
            : 'unknown';

        if (
          !historyMap.has(
            competitionId
          )
        ) {

          historyMap.set(
            competitionId,
            []
          );

        }

        historyMap
          .get(
            competitionId
          )
          .push({

            userId:
              tx.user_id,

            amount:
              number(
                tx.amount
              ),

            createdAt:
              tx.created_at

          });

      }

      const history =
        [
          ...historyMap.entries()
        ]
          .map(
            ([competitionId, winners]) => ({

              competitionId,

              startTime:
                competitionId
                  .replace(
                    'weekly_',
                    ''
                  ) +
                'T00:00:00+01:00',

              endTime:
                '',

              winners

            })
          )
          .slice(
            0,
            20
          );

      return res.json({

        success:
          true,

        history

      });

    } catch (err) {

      console.error(
        'Competition history error:',
        err
      );

      return res.status(500).json({

        success:
          false,

        error:
          'Failed to load competition history.'

      });

    }

  }
);

// ======================================================
// TELEGRAM CALLBACKS
// ======================================================

let telegramUpdateOffset =
  0;

async function answerTelegramCallback(
  callbackId,
  text
) {

  if (!TELEGRAM_DEPOSIT_BOT_TOKEN) {
    return;
  }

  try {

    await fetch(

      `https://api.telegram.org/bot${TELEGRAM_DEPOSIT_BOT_TOKEN}/answerCallbackQuery`,

      {

        method:
          'POST',

        headers: {

          'Content-Type':
            'application/json'

        },

        body:
          JSON.stringify({

            callback_query_id:
              callbackId,

            text

          })

      }

    );

  } catch (err) {

    console.error(
      'Telegram callback answer error:',
      err.message
    );

  }

}

async function editTelegramMessage(
  chatId,
  messageId,
  text
) {

  if (!TELEGRAM_DEPOSIT_BOT_TOKEN) {
    return;
  }

  try {

    await fetch(

      `https://api.telegram.org/bot${TELEGRAM_DEPOSIT_BOT_TOKEN}/editMessageCaption`,

      {

        method:
          'POST',

        headers: {

          'Content-Type':
            'application/json'

        },

        body:
          JSON.stringify({

            chat_id:
              chatId,

            message_id:
              messageId,

            caption:
              text,

            reply_markup:
              JSON.stringify({

                inline_keyboard:
                  []

              })

          })

      }

    );

  } catch (err) {

    console.error(
      'Telegram message edit error:',
      err.message
    );

  }

}

// ======================================================
// HANDLE TELEGRAM DEPOSIT CALLBACK
// ======================================================

async function handleTelegramCallback(
  callbackQuery
) {
  try {
    if (
      String(callbackQuery.message?.chat?.id) !==
      String(TELEGRAM_CHAT_ID)
    ) {
      return;
    }

    const data = String(callbackQuery.data || '');

    // ------------------------------------------------------
    // MANUAL USDT WITHDRAWAL APPROVE / REJECT
    // ------------------------------------------------------
    if (
      data.startsWith('approve_withdrawal:') ||
      data.startsWith('reject_withdrawal:')
    ) {
      const parts = data.split(':');
      const action =
        parts[0] === 'approve_withdrawal'
          ? 'approve'
          : 'reject';
      const withdrawalId = parts[1];

      if (!withdrawalId) {
        await answerTelegramCallback(
          callbackQuery.id,
          'Invalid withdrawal request.'
        );
        return;
      }

      const existingWithdrawal = await getWithdrawalById(withdrawalId);
      if (!existingWithdrawal) {
        await answerTelegramCallback(
          callbackQuery.id,
          'Withdrawal not found.'
        );
        return;
      }

      const userId = existingWithdrawal.user_id;

      const result = await processManualWithdrawalDecision(
        userId,
        withdrawalId,
        action
      );

      const targetUser = result.user;
      const withdrawal = result.withdrawal;
      const status = String(withdrawal.status || '').toUpperCase();
      const isApproved = withdrawal.status === 'Approved';

      await answerTelegramCallback(
        callbackQuery.id,
        isApproved
          ? 'Withdrawal approved.'
          : 'Withdrawal rejected and Gems refunded.'
      );

      const username = targetUser.username
        ? `@${targetUser.username}`
        : 'No username';

      const address = String(
        withdrawal.account_number || ''
      ).replace(/[<>&]/g, '');

      const text =
        `${isApproved ? '✅' : '❌'} <b>USDT WITHDRAWAL ${status}</b>\n\n` +
        `👤 <b>Name:</b> ${String(targetUser.fullName || 'User').replace(/[<>&]/g, '')}\n` +
        `🆔 <b>Username:</b> ${String(username).replace(/[<>&]/g, '')}\n` +
        `🆔 <b>Telegram ID:</b> ${String(targetUser.telegramId || '')}\n\n` +
        `💎 <b>Gems:</b> ${number(withdrawal.amount).toLocaleString()}\n` +
        `💵 <b>USDT Amount:</b> ${gemUsd(number(withdrawal.amount)).toFixed(2)} USDT\n` +
        `📍 <b>USDT Address:</b>\n<code>${address}</code>\n\n` +
        `💰 <b>Current Balance:</b> ${number(targetUser.balance).toLocaleString()} Gems\n` +
        `🔖 <b>Withdrawal ID:</b> <code>${withdrawal.id}</code>\n\n` +
        (
          isApproved
            ? `🚨 <b>Action:</b> Approved for manual payout.\n` +
              `📤 <b>Next:</b> Send the USDT manually to the address above.`
            : `↩️ <b>Action:</b> Request rejected.\n` +
              `💎 <b>Refunded:</b> ${number(withdrawal.amount).toLocaleString()} Gems`
        );

      await editTelegramTextMessage(
        callbackQuery.message.chat.id,
        callbackQuery.message.message_id,
        text
      );

      return;
    }

    // ------------------------------------------------------
    // EXISTING MANUAL DEPOSIT APPROVE / REJECT
    // ------------------------------------------------------
    if (
      !data.startsWith('approve_deposit:') &&
      !data.startsWith('reject_deposit:')
    ) {
      return;
    }

    const parts = data.split(':');
    const action = parts[0];
    const userId = parts[1];
    const reference = parts[2];

    const result = await verifyDeposit(
      userId,
      reference,
      action === 'approve_deposit'
        ? 'approve'
        : 'reject',
      'Payment proof was rejected.'
    );

    const targetUser = result.user;
    const deposit = result.deposit;

    await answerTelegramCallback(
      callbackQuery.id,
      action === 'approve_deposit'
        ? 'Deposit approved!'
        : 'Deposit rejected.'
    );

    const status = deposit.status;

    await editTelegramMessage(
      callbackQuery.message.chat.id,
      callbackQuery.message.message_id,
      `${status === 'Approved' ? '✅' : '❌'} <b>DEPOSIT ${status.toUpperCase()}</b>\n\n` +
      `👤 <b>Name:</b> ${targetUser.fullName}\n` +
      `🆔 <b>Username:</b> @${targetUser.username}\n` +
      `💰 <b>Amount:</b> Gems💎${number(
        deposit.amount
      ).toLocaleString()}\n` +
      `🔖 <b>Reference:</b> ${deposit.reference}\n` +
      `💳 <b>Balance:</b> Gems💎${number(
        targetUser.balance
      ).toLocaleString()}\n` +
      `💵 <b>Earnings:</b> Gems💎${number(
        targetUser.withdrawableBalance
      ).toLocaleString()}\n` +
      `💳 <b>Deposit Balance:</b> Gems💎${number(
        targetUser.depositBalance
      ).toLocaleString()}`
    );
  } catch (err) {
    console.error('Telegram callback error:', err);

    if (callbackQuery?.id) {
      await answerTelegramCallback(
        callbackQuery.id,
        err.message || 'Could not process this request.'
      );
    }
  }
}

// ============================================================
// TAP RUSH — WEEKLY PRIZE FINALIZATION CHECK
// ============================================================
// Pays the previous week's top-2 scorers once the week rolls over.
// Mirrors the referral competition's rollover check below, reusing
// the same Monday-00:00-WAT week boundary via getCurrentCompetition().
//
// EGRESS FIX: finalizeTapRushWeek() has no early-return guard of its
// own, so calling it on every 60s tick meant an unconditional
// tap_rush_scores read (+ an alreadyPaid read per winner) forever,
// even though the payout only ever needs to happen once per week.
// `lastFinalizedTapRushCompetitionId` remembers the last week we
// successfully finalized so every subsequent tick for that same week
// is a no-op with zero Supabase calls. It only touches Supabase again
// once competitionId actually changes (i.e. once a week), or again
// next tick if the previous attempt errored.
let lastFinalizedTapRushCompetitionId = null;

setInterval(
    () => {
        const currentCompetition = getCurrentCompetition();

        const previousStart = new Date(
            new Date(currentCompetition.startTime).getTime() -
            7 * 24 * 60 * 60 * 1000
        );

        const previousCompetition = {
            competitionId: `weekly_${previousStart.toISOString().slice(0, 10)}`,
            startTime: previousStart.toISOString(),
            endTime: currentCompetition.startTime,
            status: 'completed'
        };

        if (previousCompetition.competitionId === lastFinalizedTapRushCompetitionId) {
            return;
        }

        finalizeTapRushWeek(previousCompetition).then(
            () => {
                lastFinalizedTapRushCompetitionId = previousCompetition.competitionId;
            }
        ).catch(
            err =>
                console.error(
                    'Tap Rush weekly prize finalization error:',
                    err
                )
        );
    },
    60000
);


// ======================================================
// TELEGRAM POLLING
// ======================================================

async function pollTelegramUpdates() {

  if (!TELEGRAM_DEPOSIT_BOT_TOKEN) {

    console.warn(
      'Telegram polling disabled: TELEGRAM_DEPOSIT_BOT_TOKEN is missing.'
    );

    return;

  }

  try {

    const response =
      await fetch(

        `https://api.telegram.org/bot${TELEGRAM_DEPOSIT_BOT_TOKEN}/getUpdates?timeout=25&offset=${telegramUpdateOffset}`

      );

    const data =
      await response.json();

    if (!data.ok) {

      console.error(
        'Telegram polling error:',
        data
      );

      return setTimeout(
        pollTelegramUpdates,
        5000
      );

    }

    for (
      const update of
      data.result || []
    ) {

      telegramUpdateOffset =
        update.update_id +
        1;

      if (
        update.callback_query
      ) {

        await handleTelegramCallback(
          update.callback_query
        );

      }

    }

  } catch (err) {

    console.error(
      'Telegram polling connection error:',
      err.message
    );

  }

  setTimeout(
    pollTelegramUpdates,
    1000
  );

}

// ======================================================
// HEALTH CHECK
// ======================================================

app.get(
  '/api/health',
  async (req, res) => {

    try {

      const {
        count,
        error
      } =
        await supabase
          .from('users')
          .select(
            'id',
            {
              count:
                'exact',

              head:
                true
            }
          );

      if (error) {
        throw error;
      }

      return res.json({

        success:
          true,

        users:
          count || 0,

        authenticated:
          !!(
            req.session &&
            req.session.userId
          ),

        database:
          'supabase'

      });

    } catch (err) {

      console.error(
        'Health database error:',
        err
      );

      return res.status(500).json({

        success:
          false,

        database:
          'supabase',

        error:
          err.message

      });

    }

  }
);

// ======================================================
// START WEEKLY CHECK
// ======================================================
// EGRESS FIX: finalizeWeeklyCompetition()'s own early-return guard
// compares Date.now() against the *previous* week's endTime, which by
// construction has already passed — so it never actually short-
// circuits here. That meant every 30s tick ran a full
// getWeeklyLeaderboard() Supabase read plus one alreadyPaid Supabase
// read per prize, forever, long after that week's prizes were paid.
// `lastFinalizedReferralCompetitionId` remembers the last week we
// successfully finalized so repeat ticks for the same week are a
// no-op with zero Supabase calls, and it only queries again once the
// competitionId actually changes (once a week) or after an error.
let lastFinalizedReferralCompetitionId = null;

setInterval(

  () => {
    /*
     * Finalize the competition that has just ended.
     * getCurrentCompetition() rolls over to the new week when
     * the countdown reaches zero, so the previous competition
     * must be finalized explicitly.
     */
    const currentCompetition =
      getCurrentCompetition();

    const previousStart =
      new Date(
        new Date(currentCompetition.startTime).getTime() -
        7 * 24 * 60 * 60 * 1000
      );

    const previousCompetition = {
      competitionId:
        `weekly_${previousStart.toISOString().slice(0, 10)}`,
      startTime:
        previousStart.toISOString(),
      endTime:
        new Date(
          currentCompetition.startTime
        ).toISOString(),
      status:
        'completed'
    };

    if (
      previousCompetition.competitionId ===
      lastFinalizedReferralCompetitionId
    ) {
      return;
    }

    finalizeWeeklyCompetition(
      previousCompetition
    ).then(
      () => {
        lastFinalizedReferralCompetitionId =
          previousCompetition.competitionId;
      }
    ).catch(
      err =>
        console.error(
          'Weekly competition error:',
          err
        )
    );

  },

  30000

);

// ======================================================
// TELEGRAM POLLING
// ======================================================

pollTelegramUpdates();



// ============================================================
// TAP RUSH — STAKE-BASED REWARD GAME
// ============================================================
// Redesigned away from the old "pay Gems💎100, rank in a 2-day
// challenge" format. Players now choose a stake (Gems💎200/Gems💎500/Gems💎1000)
// and are rewarded immediately based on the score they reach in
// that single 20-second match:
//   score 5000+  -> cash reward = stake x 2
//   score 3000+  -> cash reward = stake x 0.5
//   score 1000+  -> free spins (tier depends on stake)
//   below 1000   -> no reward (stake is lost)
//
// A lightweight weekly leaderboard (top 2 scorers of the week)
// still exists purely for bragging rights + a small prize
// (Gems💎1000 / Gems💎500), paid out automatically when the week rolls
// over. It reuses the same Monday-00:00-WAT week boundary as the
// existing referral competition (getCurrentCompetition()).
//
// EGRESS NOTE: Tap Rush sessions (the anti-cheat "start -> finish"
// handshake) are now tracked in server memory instead of a
// Supabase table. A session is short-lived (under a minute) and
// single-use, so there is nothing worth persisting about it — this
// removes 2 Supabase round-trips per match with zero loss of
// anti-cheat integrity. The only two things that still hit
// Supabase per match are the things that actually need to survive
// server restarts: the wallet balance change, and the score row
// used for the weekly leaderboard.
// ============================================================

const TAP_RUSH_DURATION_MS = 20000;
const TAP_RUSH_GRACE_MS = 2500;
const TAP_RUSH_MAX_EVENTS = 1000;
const TAP_RUSH_STAKES = [200, 500, 1000];

const TAP_RUSH_REWARD_TABLE = {
    200: { jackpotScore: 5000, jackpotMultiplier: 2, midScore: 3000, midMultiplier: 0.5, spinScore: 1000, freeSpins: 1 },
    500: { jackpotScore: 5000, jackpotMultiplier: 2, midScore: 3000, midMultiplier: 0.5, spinScore: 1000, freeSpins: 3 },
    1000: { jackpotScore: 5000, jackpotMultiplier: 2, midScore: 3000, midMultiplier: 0.5, spinScore: 1000, freeSpins: 7 }
};

function resolveTapRushReward(stake, score) {
    const table = TAP_RUSH_REWARD_TABLE[stake];
    if (!table) {
        return { type: 'none', cashAmount: 0, freeSpins: 0, tier: 'none' };
    }
    if (score >= table.jackpotScore) {
        return { type: 'cash', cashAmount: Math.round(stake * table.jackpotMultiplier), freeSpins: 0, tier: 'jackpot' };
    }
    if (score >= table.midScore) {
        return { type: 'cash', cashAmount: Math.round(stake * table.midMultiplier), freeSpins: 0, tier: 'mid' };
    }
    if (score >= table.spinScore) {
        return { type: 'freespins', cashAmount: 0, freeSpins: table.freeSpins, tier: 'spins' };
    }
    return { type: 'none', cashAmount: 0, freeSpins: 0, tier: 'none' };
}

// In-memory session store. userId -> sessionId keeps the "one active
// game at a time" rule enforceable without a database round trip.
const tapRushSessions = new Map();
const tapRushActiveByUser = new Map();

function purgeExpiredTapRushSession(userId) {
    const key = String(userId);
    const existingId = tapRushActiveByUser.get(key);
    if (!existingId) return;
    const existing = tapRushSessions.get(existingId);
    if (!existing || Date.now() > existing.expiresAt) {
        tapRushSessions.delete(existingId);
        tapRushActiveByUser.delete(key);
    }
}

// Periodically sweep abandoned sessions (user closed the tab mid-game)
// so the in-memory maps never grow unbounded.
setInterval(() => {
    const now = Date.now();
    for (const [sessionId, session] of tapRushSessions.entries()) {
        if (now > session.expiresAt) {
            tapRushSessions.delete(sessionId);
            tapRushActiveByUser.delete(String(session.userId));
        }
    }
}, 60000);

// ============================================================
// TAP RUSH — START GAME
// ============================================================

app.post(
    '/api/games/tap-rush/start',
    requireLogin,
    async (req, res) => {

        try {

            const user = req.user;
            const stake = Number(req.body?.stake);

            if (!TAP_RUSH_STAKES.includes(stake)) {
                return res.status(400).json({
                    success: false,
                    message: 'Choose a valid stake: Gems💎200, Gems💎500, or Gems💎1000.'
                });
            }

            purgeExpiredTapRushSession(user.id);

            if (tapRushActiveByUser.has(String(user.id))) {
                return res.status(400).json({
                    success: false,
                    message: 'You already have an active Tap Rush game.'
                });
            }

            if (number(user.balance) < stake) {
                return res.status(400).json({
                    success: false,
                    code: 'INSUFFICIENT_BALANCE',
                    message: `Insufficient balance. You need Gems💎${stake} to play.`
                });
            }

            // Deduct the stake — deposit balance first, then withdrawable
            // balance, matching the same spend order used by the spin
            // wheel game elsewhere in this file.
            let remaining = stake;
            const deposit = getDepositBalance(user);
            const earnings = getWithdrawableBalance(user);

            if (deposit >= remaining) {
                user.depositBalance = deposit - remaining;
            } else {
                remaining -= deposit;
                user.depositBalance = 0;
                user.withdrawableBalance = Math.max(0, earnings - remaining);
            }

            syncUserBalance(user);
            await updateUser(user);

            await addTransaction(user.id, {
                id: generateTransactionId('tx_tap_rush_entry'),
                type: 'tap_rush_entry',
                description: `Tap Rush Entry — Gems💎${stake} stake`,
                amount: stake,
                currency: 'GEMS',
                status: 'completed',
                bank: 'PAYME Wallet'
            });

            const sessionId = generateTransactionId('tap_rush_session');
            const serverStart = Date.now();
            const expiresAt = serverStart + TAP_RUSH_DURATION_MS + TAP_RUSH_GRACE_MS + 30000;

            tapRushSessions.set(sessionId, {
                userId: user.id,
                stake,
                serverStart,
                expiresAt
            });
            tapRushActiveByUser.set(String(user.id), sessionId);

            return res.json({
                success: true,
                session: {
                    id: sessionId,
                    stake,
                    serverStartTime: new Date(serverStart).toISOString(),
                    expiresAt: new Date(expiresAt).toISOString()
                },
                balance: user.balance
            });

        } catch (err) {

            console.error('Tap Rush start error:', err);

            return res.status(500).json({
                success: false,
                message: 'Unable to start Tap Rush.'
            });

        }

    }
);

// ============================================================
// TAP RUSH — SCORE CALCULATION
// ============================================================
// The server replays the raw tap-event log using the exact same scoring
// rules as the live Tap11 client. The client-reported total is never used.
// This keeps the displayed in-game score, final popup, reward and leaderboard
// score synchronized while retaining server-side validation.
// ============================================================

function calculateTapRushScore(
    events,
    completionTimeMs
) {
    /*
     * IMPORTANT:
     * The live score shown in Tap11 is the score players actually earn
     * during the 20-second match. The server MUST reproduce that exact
     * scoring formula so the final popup, reward and leaderboard all use
     * the same number.
     *
     * Client scoring:
     *   normal target: <=32 = 40, <=48 = 25, otherwise 15
     *   golden: 100
     *   mega: 250
     *   bonus: uses the normal target-size value
     *   combo multiplier: 1x at <5 hits, 2x at 5+, 3x at 12+, 4x at 25+
     *   difficulty multiplier: 1 + (stage - 1) * 0.15
     *   normal miss: -5 points, minimum 0
     *   fake target: counts as a miss but does NOT subtract 5
     */

    let score = 0;
    let baseScore = 0;
    let comboScore = 0;
    let goldenScore = 0;
    let bonusScore = 0;

    let hits = 0;
    let misses = 0;
    let highestCombo = 0;
    let currentCombo = 1;

    let goldenTargets = 0;
    let megaTargets = 0;
    let bonusTargets = 0;
    let fakeTargetsHit = 0;

    let reactionTotal = 0;
    let reactionCount = 0;

    const safeEvents = Array.isArray(events) ? events : [];

    function getClientBaseValue(targetType, size) {
        if (targetType === 'golden') return 100;
        if (targetType === 'mega') return 250;

        if (size <= 32) return 40;
        if (size <= 48) return 25;
        return 15;
    }

    function getClientComboMultiplier(totalSuccessfulHits) {
        if (totalSuccessfulHits >= 25) return 4;
        if (totalSuccessfulHits >= 12) return 3;
        if (totalSuccessfulHits >= 5) return 2;
        return 1;
    }

    function getClientDifficultyMultiplier(stage) {
        return 1 + (stage - 1) * 0.15;
    }

    for (const event of safeEvents) {
        if (!event || typeof event !== 'object') continue;

        const type = String(event.type || '');

        if (type === 'hit') {
            hits++;
            currentCombo = Math.min(10, currentCombo + 1);
            highestCombo = Math.max(highestCombo, currentCombo);

            const targetType = String(event.targetType || 'normal');
            const size = Number(event.targetSize);
            const difficultyStage = Number(event.difficultyStage);

            if (!Number.isFinite(size) || size < 24 || size > 81) {
                return { invalid: true, reason: 'Invalid target data.' };
            }

            if (!Number.isInteger(difficultyStage) || difficultyStage < 1 || difficultyStage > 5) {
                return { invalid: true, reason: 'Invalid difficulty data.' };
            }

            /*
             * The client generates these size ranges after its 0.95
             * difficulty-size scaling. This prevents a submitted event
             * from claiming an impossible difficulty stage.
             */
            const stageRanges = {
                1: [62, 81],
                2: [48, 67],
                3: [38, 52],
                4: [30, 46],
                5: [24, 38]
            };

            const [minSize, maxSize] = stageRanges[difficultyStage];
            if (size < minSize || size > maxSize) {
                console.warn(
                    'Tap Rush target validation mismatch:',
                    { size, difficultyStage, minSize, maxSize }
                );
                return { invalid: true, reason: 'Target difficulty mismatch.' };
            }

            let base = getClientBaseValue(targetType, size);

            if (targetType === 'golden') {
                goldenTargets++;
                goldenScore += base;
            } else if (targetType === 'mega') {
                megaTargets++;
                bonusScore += base;
            } else if (targetType === 'bonus') {
                bonusTargets++;
                // The live client treats bonus targets as normal size-based
                // targets, so no extra bonus points are added here.
            }

            baseScore += base;

            const comboMultiplier = getClientComboMultiplier(hits);
            const difficultyMultiplier = getClientDifficultyMultiplier(difficultyStage);
            const earned = Math.round(base * comboMultiplier * difficultyMultiplier);

            score += earned;
            comboScore += earned - base;

            const reaction = Number(event.reactionMs);
            if (Number.isFinite(reaction) && reaction >= 1 && reaction <= 2000) {
                reactionTotal += reaction;
                reactionCount++;
            }

        } else if (type === 'fake') {
            fakeTargetsHit++;
            misses++;
            currentCombo = 1;

        } else if (type === 'miss') {
            misses++;
            currentCombo = 1;
            score = Math.max(0, score - 5);

        } else {
            return { invalid: true, reason: 'Unknown gameplay event.' };
        }
    }

    const totalAttempts = hits + misses;
    const accuracy = totalAttempts > 0 ? (hits / totalAttempts) * 100 : 0;
    const averageReaction = reactionCount > 0 ? reactionTotal / reactionCount : 999;

    /*
     * These values are retained for the existing Supabase columns and
     * result payload. They are informational only; the actual score is
     * the exact live-game score calculated above.
     */
    const accuracyScore = 0;
    const speedScore = 0;
    const difficultyScore = 0;
    const streakScore = 0;

    return {
        score: Math.max(0, Math.round(score)),
        baseScore,
        comboScore,
        bonusScore,
        goldenScore,
        streakScore,
        accuracyScore,
        speedScore,
        difficultyScore,
        hits,
        misses,
        accuracy,
        highestCombo,
        goldenTargets,
        megaTargets,
        bonusTargets,
        fakeTargetsHit,
        averageReaction
    };
}

// ============================================================
// TAP RUSH — USER PROFILE HELPER
// ============================================================
// There is no FK relationship exposed between tap_rush_scores.user_id
// and users.id, so scores and profiles are fetched separately.
// ============================================================

async function getTapRushUserProfiles(userIds) {

    const ids = [
        ...new Set(
            (Array.isArray(userIds) ? userIds : [])
                .filter(Boolean)
                .map(String)
        )
    ];

    if (!ids.length) {
        return new Map();
    }

    const { data, error } = await supabase
        .from('users')
        .select('id, username, full_name')
        .in('id', ids);

    if (error) {
        throw error;
    }

    const profiles = new Map();

    for (const u of data || []) {
        profiles.set(String(u.id), {
            username: u.username || null,
            full_name: u.full_name || null
        });
    }

    return profiles;
}

// ============================================================
// TAP RUSH — FINISH GAME
// ============================================================

app.post(
    '/api/games/tap-rush/finish',
    requireLogin,
    async (req, res) => {

        try {

            const user = req.user;

            const sessionId = String(req.body?.sessionId || '').trim();

            if (!sessionId) {
                return res.status(400).json({
                    success: false,
                    message: 'Game session is required.'
                });
            }

            const session = tapRushSessions.get(sessionId);

            if (!session || String(session.userId) !== String(user.id)) {
                return res.status(404).json({
                    success: false,
                    message: 'Game session not found.'
                });
            }

            // Single-use: remove immediately so the same session can never
            // be submitted twice.
            tapRushSessions.delete(sessionId);
            tapRushActiveByUser.delete(String(user.id));

            const now = Date.now();
            const serverElapsed = now - session.serverStart;

            if (serverElapsed < 18000) {
                return res.status(400).json({
                    success: false,
                    message: 'Game completed too quickly.'
                });
            }

            if (serverElapsed > TAP_RUSH_DURATION_MS + TAP_RUSH_GRACE_MS + 30000) {
                return res.status(400).json({
                    success: false,
                    message: 'Game session expired.'
                });
            }

            const events = Array.isArray(req.body?.events) ? req.body.events : [];

            if (events.length > TAP_RUSH_MAX_EVENTS) {
                return res.status(400).json({
                    success: false,
                    message: 'Too many gameplay events.'
                });
            }

            const completionTimeMs = Number(req.body?.completionTimeMs);

            if (
                !Number.isFinite(completionTimeMs) ||
                completionTimeMs < 18000 ||
                completionTimeMs > 22000
            ) {
                return res.status(400).json({
                    success: false,
                    message: 'Invalid game duration.'
                });
            }

            // ------------------------------------------------
            // EVENT SANITY CHECK
            // ------------------------------------------------

            let previousEventTime = -1;

            for (const event of events) {

                if (!event || typeof event !== 'object') {
                    return res.status(400).json({
                        success: false,
                        message: 'Suspicious gameplay detected.'
                    });
                }

                const at = Number(event.at);

                if (
                    !Number.isFinite(at) ||
                    at < previousEventTime ||
                    at < 0 ||
                    at > completionTimeMs + 250
                ) {
                    return res.status(400).json({
                        success: false,
                        message: 'Suspicious gameplay detected.'
                    });
                }

                previousEventTime = at;

            }

            const calculated = calculateTapRushScore(events, completionTimeMs);

            if (calculated.invalid) {
                return res.status(400).json({
                    success: false,
                    message: calculated.reason || 'Invalid gameplay data.'
                });
            }

            const score = calculated.score;

            if (score > 50000) {
                return res.status(400).json({
                    success: false,
                    message: 'Impossible score detected.'
                });
            }

            // ------------------------------------------------
            // SAVE SCORE (drives the weekly leaderboard only —
            // no per-challenge bookkeeping needed any more)
            // ------------------------------------------------

            const { error: scoreError } = await supabase
                .from('tap_rush_scores')
                .insert({
                    challenge_id: null,
                    user_id: user.id,
                    score,
                    base_score: calculated.baseScore,
                    combo_score: calculated.comboScore,
                    bonus_score: calculated.bonusScore,
                    golden_score: calculated.goldenScore,
                    streak_score: calculated.streakScore,
                    accuracy_score: calculated.accuracyScore,
                    speed_score: calculated.speedScore,
                    difficulty_score: calculated.difficultyScore,
                    hits: calculated.hits,
                    misses: calculated.misses,
                    accuracy: calculated.accuracy,
                    highest_combo: calculated.highestCombo,
                    golden_targets: calculated.goldenTargets,
                    mega_targets: calculated.megaTargets,
                    bonus_targets: calculated.bonusTargets,
                    fake_targets_hit: calculated.fakeTargetsHit,
                    reaction_score: Math.round(calculated.averageReaction),
                    completion_time_ms: completionTimeMs,
                    total_events: events.length,
                    displayed_score: score
                });

            if (scoreError) {
                throw scoreError;
            }

            // ------------------------------------------------
            // RESOLVE + CREDIT REWARD
            // ------------------------------------------------

            const reward = resolveTapRushReward(session.stake, score);

            if (reward.type === 'cash' && reward.cashAmount > 0) {

                user.withdrawableBalance = getWithdrawableBalance(user) + reward.cashAmount;
                syncUserBalance(user);
                await updateUser(user);

                await addTransaction(user.id, {
                    id: generateTransactionId('tx_tap_rush_reward'),
                    type: 'tap_rush_reward',
                    description: `Tap Rush Reward — Score ${score} on a Gems💎${session.stake} play`,
                    amount: reward.cashAmount,
                    currency: 'GEMS',
                    status: 'completed',
                    bank: 'PAYME Wallet'
                });

            } else if (reward.type === 'freespins' && reward.freeSpins > 0) {

                user.freeSpins = number(user.freeSpins) + reward.freeSpins;
                await updateUser(user);

            }

            return res.json({

                success: true,

                result: {
                    score,
                    stake: session.stake,
                    hits: calculated.hits,
                    misses: calculated.misses,
                    accuracy: calculated.accuracy,
                    highestCombo: calculated.highestCombo,
                    goldenTargets: calculated.goldenTargets,
                    megaTargets: calculated.megaTargets,
                    reward: {
                        type: reward.type,
                        tier: reward.tier,
                        cashAmount: reward.cashAmount,
                        freeSpins: reward.freeSpins
                    },
                    balance: user.balance,
                    freeSpins: number(user.freeSpins)
                }

            });

        } catch (err) {

            console.error('Tap Rush finish error:', err);

            return res.status(500).json({
                success: false,
                message: 'Unable to submit Tap Rush result.'
            });

        }

    }
);

// ============================================================
// TAP RUSH — WEEKLY LEADERBOARD (top 2, current week)
// ============================================================
// Cached in server memory for a short window so that many users
// opening/returning to the page within the same ~20s only cost one
// Supabase read total, instead of one per person.
// ============================================================

let tapRushLeaderboardCache = {
    data: null,
    expiresAt: 0,
    weekEndsAt: null,
    competitionId: null
};
const TAP_RUSH_LEADERBOARD_CACHE_TTL_MS = 20000;

async function loadTapRushWeeklyLeaderboard() {

    const competition = getCurrentCompetition();

    const { data: scores, error } = await supabase
        .from('tap_rush_scores')
        .select('user_id,score,created_at')
        .gte('created_at', competition.startTime)
        .lt('created_at', competition.endTime)
        .order('score', { ascending: false })
        .limit(100);

    if (error) {
        throw error;
    }

    const bestByUser = new Map();

    for (const row of scores || []) {
        const key = String(row.user_id);
        const existing = bestByUser.get(key);
        const rowScore = Number(row.score);
        if (!existing || rowScore > existing.score) {
            bestByUser.set(key, { userId: row.user_id, score: rowScore });
        }
    }

    const top2 = Array.from(bestByUser.values())
        .sort((a, b) => b.score - a.score)
        .slice(0, 2);

    const profiles = await getTapRushUserProfiles(top2.map(row => row.userId));

    const leaderboard = top2.map((row, index) => {
        const profile = profiles.get(String(row.userId)) || {};
        return {
            rank: index + 1,
            username: profile.username || profile.full_name || 'Player',
            score: row.score,
            prize: index === 0 ? 1000 : 500
        };
    });

    return { leaderboard, weekEndsAt: competition.endTime };
}

function payloadWeekIsStillActive(weekEndsAt, now = Date.now()) {
    const end = new Date(weekEndsAt || 0).getTime();
    return Number.isFinite(end) && end > now;
}

app.get(
    '/api/games/tap-rush/leaderboard',
    requireLogin,
    async (req, res) => {

        try {

            const now = Date.now();
            const currentCompetition = getCurrentCompetition();
            let payload;

            if (
                tapRushLeaderboardCache.data &&
                tapRushLeaderboardCache.expiresAt > now &&
                tapRushLeaderboardCache.competitionId === currentCompetition.competitionId &&
                payloadWeekIsStillActive(tapRushLeaderboardCache.weekEndsAt, now)
            ) {
                payload = tapRushLeaderboardCache;
            } else {
                const fresh = await loadTapRushWeeklyLeaderboard();
                payload = {
                    data: fresh.leaderboard,
                    weekEndsAt: fresh.weekEndsAt,
                    competitionId: currentCompetition.competitionId,
                    expiresAt: now + TAP_RUSH_LEADERBOARD_CACHE_TTL_MS
                };
                tapRushLeaderboardCache = payload;
            }

            return res.json({
                success: true,
                leaderboard: payload.data,
                weekEndsAt: payload.weekEndsAt,
                serverNow: new Date().toISOString()
            });

        } catch (err) {

            console.error('Tap Rush leaderboard error:', err);

            return res.status(500).json({
                success: false,
                message: 'Unable to load leaderboard.'
            });

        }

    }
);

// ============================================================
// TAP RUSH — WEEKLY PRIZE PAYOUT
// ============================================================
// Pays the top 2 scorers of the week that just ended: Gems💎1000 for
// 1st, Gems💎500 for 2nd. Idempotent via a deterministic transaction id
// (same pattern as the existing weekly referral payout), so it is
// safe to call this repeatedly.
// ============================================================

async function finalizeTapRushWeek(competition) {

    const { data: scores, error } = await supabase
        .from('tap_rush_scores')
        .select('user_id,score,created_at')
        .gte('created_at', competition.startTime)
        .lt('created_at', competition.endTime)
        .order('score', { ascending: false })
        .order('created_at', { ascending: true })
        .limit(200);

    if (error) {
        throw error;
    }

    const bestByUser = new Map();

    for (const row of scores || []) {
        const key = String(row.user_id);
        const existing = bestByUser.get(key);
        const rowScore = Number(row.score);
        if (!existing || rowScore > existing.score) {
            bestByUser.set(key, { userId: row.user_id, score: rowScore });
        }
    }

    const winners = Array.from(bestByUser.values())
        .sort((a, b) => b.score - a.score)
        .slice(0, 2);

    const prizes = [1000, 500];
    const labels = ['1st', '2nd'];

    for (let i = 0; i < winners.length; i++) {

        const winner = winners[i];
        const prize = prizes[i];

        const uniqueId = `tx_tap_rush_weekly_${competition.competitionId}_${winner.userId}_${i + 1}`;

        const { data: alreadyPaid, error: paidCheckError } = await supabase
            .from('transactions')
            .select('id')
            .eq('id', uniqueId)
            .maybeSingle();

        if (paidCheckError) throw paidCheckError;
        if (alreadyPaid) continue;

        const user = await getUserById(winner.userId);
        if (!user) continue;

        user.withdrawableBalance = getWithdrawableBalance(user) + prize;
        syncUserBalance(user);
        await updateUser(user);

        await addTransaction(user.id, {
            id: uniqueId,
            type: 'tap_rush_weekly_prize',
            description: `Tap Rush Weekly Leaderboard — ${labels[i]} Place Prize`,
            amount: prize,
            currency: 'GEMS',
            status: 'completed',
            bank: 'PAYME Wallet'
        });

    }

}



// ======================================================
// START SERVER
// ======================================================

const PORT =
  process.env.PORT ||
  3000;

app.listen(

  PORT,

  '0.0.0.0',

  () => {

    console.log(
      `PAYME Server running on port ${PORT}`
    );

    console.log(
      `Environment: ${
        isProduction
          ? 'production'
          : 'development'
      }`
    );

    console.log(
      'Database: Supabase'
    );

    console.log(
      'User authentication: signed cookie sessions'
    );

    console.log(
      'Telegram Web App authentication: SECURE initData verification'
    );

    console.log(
      'Balance system: Deposit Balance + Withdrawable Earnings'
    );

  }

);




























