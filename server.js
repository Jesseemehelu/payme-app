require('dotenv').config();

const express = require('express');
const cors = require('cors');
const path = require('path');
const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');

const app = express();

app.set('trust proxy', 1);

// ======================================================
// MIDDLEWARE
// ======================================================

app.use(cors({
  origin: true,
  credentials: true
}));

app.use(express.json({
  limit: '15mb'
}));

app.use(express.urlencoded({
  limit: '15mb',
  extended: true
}));

app.use(express.static(
  path.join(__dirname, 'public')
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

const isProduction =
  process.env.NODE_ENV === 'production';

// ======================================================
// REWARDS / LIMITS
// ======================================================

const WELCOME_BONUS = 10;

const REFERRAL_REWARD = 15;

const MIN_WITHDRAWAL_LIMIT = 100;

const MIN_DEPOSIT_AMOUNT = 200;

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

// Reward table. 100,000 secure-random slots are used server-side.
// No free-spin rewards come from this reel anymore — cash only.
// Higher cash tiers are intentionally made extremely rare so the vast
// majority of plays land on "Try Again" or the smallest cash amount.
const MONETAG_REWARD_SLOTS = [
  { max: 78000, key: 'try_again', label: 'Try Again',      cash: 0,   spins: 0 },
  { max: 96000, key: 'cash_5',    label: '₦5',              cash: 5,   spins: 0 },
  { max: 99000, key: 'cash_10',   label: '₦10',             cash: 10,  spins: 0 },
  { max: 99700, key: 'cash_20',   label: '₦20',             cash: 20,  spins: 0 },
  { max: 99930, key: 'cash_50',   label: '₦50',             cash: 50,  spins: 0 },
  { max: 99985, key: 'cash_100',  label: '₦100',            cash: 100, spins: 0 },
  { max: 100000,key: 'cash_500',  label: '₦500',            cash: 500, spins: 0 }
];

// Reward table for the game page's "Watch Ad" free-spin fraction reward.
// 100,000 secure-random slots. 0.02 and 0.05 are deliberately the
// overwhelmingly common outcomes (together ~85% of plays), 0.1 is fairly
// common (~11%), and every tier above that gets rarer very fast — the top
// tiers (1 and especially 2 Free Spins) are made extremely hard to hit.
const GAME_FREESPIN_AD_REWARD_SLOTS = [
  { max: 50000, key: 'fs_002', label: '0.02 Free Spin', cash: 0, spins: 0.02 },
  { max: 85000, key: 'fs_005', label: '0.05 Free Spin', cash: 0, spins: 0.05 },
  { max: 96000, key: 'fs_01',  label: '0.1 Free Spin',  cash: 0, spins: 0.1 },
  { max: 99000, key: 'fs_02',  label: '0.2 Free Spin',  cash: 0, spins: 0.2 },
  { max: 99800, key: 'fs_05',  label: '0.5 Free Spin',  cash: 0, spins: 0.5 },
  { max: 99970, key: 'fs_1',   label: '1 Free Spin',    cash: 0, spins: 1 },
  { max: 100000,key: 'fs_2',   label: '2 Free Spins',   cash: 0, spins: 2 }
];

// Reward table for the Earn page's "Watch Ads & Earn" button. Same cash
// tiers/labels as the dashboard reel, but skewed far more aggressively
// toward "Try Again" — the higher cash tiers are made deliberately,
// extremely rare so meaningfully high payouts are a near-never event.
const EARN_WATCH_AD_REWARD_SLOTS = [
  { max: 95000, key: 'try_again', label: 'Try Again',      cash: 0,   spins: 0 },
  { max: 99000, key: 'cash_5',    label: '₦5',              cash: 5,   spins: 0 },
  { max: 99700, key: 'cash_10',   label: '₦10',             cash: 10,  spins: 0 },
  { max: 99920, key: 'cash_20',   label: '₦20',             cash: 20,  spins: 0 },
  { max: 99980, key: 'cash_50',   label: '₦50',             cash: 50,  spins: 0 },
  { max: 99997, key: 'cash_100',  label: '₦100',            cash: 100, spins: 0 },
  { max: 100000,key: 'cash_500',  label: '₦500',            cash: 500, spins: 0 }
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
    200: { jackpot: 5000, cash: 1500, bonusFreeSpins: 5 },
    500: { jackpot: 15000, cash: 4000, bonusFreeSpins: 12 }
  }
};


const LUCKY3_GAME_TYPES = new Set([
  'jackpot',
  'cash',
  'bonus'
]);

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

    dailyReward: {

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
      'NGN',

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
    const context = rawContext === 'game_free_spin'
      ? 'game_free_spin'
      : rawContext === 'earn_watch_ad'
      ? 'earn_watch_ad'
      : 'dashboard';

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
    const adContext = pendingContext === 'game_free_spin'
      ? 'game_free_spin'
      : pendingContext === 'earn_watch_ad'
      ? 'earn_watch_ad'
      : 'dashboard';
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
      currency: 'NGN',
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
  const table = context === 'game_free_spin'
    ? GAME_FREESPIN_AD_REWARD_SLOTS
    : context === 'earn_watch_ad'
    ? EARN_WATCH_AD_REWARD_SLOTS
    : MONETAG_REWARD_SLOTS;
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
// TELEGRAM ADVERTISING SYSTEM
// ======================================================

const TELEGRAM_AD_PRICE_PER_JOIN = 50;
const TELEGRAM_AD_MEMBER_REWARD = 25;
const TELEGRAM_AD_PLATFORM_FEE = 25;


// ======================================================
// TELEGRAM API HELPER
// ======================================================

async function telegramApi(
  method,
  params = {}
) {

  if (!TELEGRAM_BOT_TOKEN) {

    throw new Error(
      'TELEGRAM_BOT_TOKEN is not configured.'
    );

  }


  const response =
    await fetch(
      `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/${method}`,
      {
        method: 'POST',

        headers: {
          'Content-Type':
            'application/json'
        },

        body:
          JSON.stringify(params)
      }
    );


  const data =
    await response.json();


  if (!data.ok) {

    const description =
      data.description ||
      'Telegram API request failed.';


    const error =
      new Error(description);


    error.telegramResponse =
      data;


    throw error;

  }


  return data.result;

}


// ======================================================
// PARSE TELEGRAM PUBLIC LINK
// ======================================================

function parseTelegramLink(
  value
) {

  const raw =
    String(value || '')
      .trim();


  if (!raw) {

    return null;

  }


  let url;


  try {

    url =
      new URL(raw);

  } catch {

    return null;

  }


  const hostname =
    url.hostname
      .toLowerCase()
      .replace(/^www\./, '');


  if (
    hostname !== 't.me' &&
    hostname !== 'telegram.me'
  ) {

    return null;

  }


  const parts =
    url.pathname
      .split('/')
      .filter(Boolean);


  if (!parts.length) {

    return null;

  }


  /*
    For this first version we intentionally support
    public Telegram usernames:

      https://t.me/examplegroup
      https://t.me/examplechannel

    Private invite links such as:

      https://t.me/+ABC123...

    will be added separately because Telegram's Bot API
    cannot simply resolve an arbitrary private invite link
    with getChat().
  */


  const username =
    parts[0];


  if (
    username.startsWith('+') ||
    username.startsWith('joinchat')
  ) {

    return {
      valid: false,
      reason:
        'Private Telegram invite links are not supported yet. Please use your public @username link.'
    };

  }


  if (
    !/^[a-zA-Z0-9_]{5,32}$/
      .test(username)
  ) {

    return {
      valid: false,
      reason:
        'Invalid Telegram username.'
    };

  }


  return {

    valid: true,

    username:
      '@' + username

  };

}


// ======================================================
// VERIFY TELEGRAM COMMUNITY
// ======================================================

async function verifyTelegramAdvertisingCommunity(
  telegramLink,
  expectedType,
  advertiserTelegramId
) {

  const parsed =
    parseTelegramLink(
      telegramLink
    );


  if (!parsed || !parsed.valid) {

    return {

      success: false,

      message:
        parsed?.reason ||
        'Invalid Telegram link.'

    };

  }


  if (!advertiserTelegramId) {

    return {

      success: false,

      message:
        'Your Telegram account is not connected to PAYME.'

    };

  }


  try {

    // ----------------------------------------------------
    // GET COMMUNITY
    // ----------------------------------------------------

    const chat =
      await telegramApi(
        'getChat',
        {
          chat_id:
            parsed.username
        }
      );


    // ----------------------------------------------------
    // CHECK TYPE
    // ----------------------------------------------------

    let actualType;


    if (
      chat.type === 'channel'
    ) {

      actualType =
        'channel';

    } else if (
      chat.type === 'group' ||
      chat.type === 'supergroup'
    ) {

      actualType =
        'group';

    } else {

      return {

        success: false,

        message:
          'That Telegram link is not a group or channel.'

      };

    }


    if (
      actualType !==
      expectedType
    ) {

      return {

        success: false,

        message:
          `You selected a Telegram ${expectedType}, but this link belongs to a Telegram ${actualType}.`

      };

    }


    // ----------------------------------------------------
    // GET BOT INFORMATION
    // ----------------------------------------------------

    const bot =
      await telegramApi(
        'getMe'
      );


    // ----------------------------------------------------
    // CHECK BOT ADMIN STATUS
    // ----------------------------------------------------

    const botMember =
      await telegramApi(
        'getChatMember',
        {

          chat_id:
            chat.id,

          user_id:
            bot.id

        }
      );


    const botIsAdmin =
      [
        'administrator',
        'creator'
      ].includes(
        botMember.status
      );


    if (!botIsAdmin) {

      return {

        success: false,

        message:
          'PAYME Bot has not been added as an administrator of this Telegram community.'

      };

    }


    // ----------------------------------------------------
    // CHECK ADVERTISER ADMIN STATUS
    // ----------------------------------------------------

    const advertiserMember =
      await telegramApi(
        'getChatMember',
        {

          chat_id:
            chat.id,

          user_id:
            Number(
              advertiserTelegramId
            )

        }
      );


    const advertiserIsAdmin =
      [
        'administrator',
        'creator'
      ].includes(
        advertiserMember.status
      );


    if (!advertiserIsAdmin) {

      return {

        success: false,

        message:
          'You must be an administrator of this Telegram community.'

      };

    }


    // ----------------------------------------------------
    // SUCCESS
    // ----------------------------------------------------

    return {

      success: true,

      chatId:
        String(chat.id),

      username:
        chat.username
          ? '@' + chat.username
          : parsed.username,

      title:
        chat.title ||
        parsed.username,

      telegramType:
        actualType,

      botIsAdmin: true,

      advertiserIsAdmin: true

    };


  } catch (error) {

    console.error(
      'Telegram advertising verification error:',
      error
    );


    return {

      success: false,

      message:
        error.message ||
        'Telegram verification failed.'

    };

  }

}


// ======================================================
// VERIFY ADVERTISER TELEGRAM COMMUNITY
// ======================================================

app.post(
  '/api/telegram-ads/verify',
  requireLogin,
  async (
    req,
    res
  ) => {

    try {

      const {
        telegramType,
        telegramLink
      } =
        req.body || {};


      if (
        ![
          'group',
          'channel'
        ].includes(
          telegramType
        )
      ) {

        return res.status(400).json({

          success: false,

          message:
            'Please select a Telegram group or channel.'

        });

      }


      if (
        !telegramLink
      ) {

        return res.status(400).json({

          success: false,

          message:
            'Telegram link is required.'

        });

      }


      if (
        !req.user.telegramId
      ) {

        return res.status(400).json({

          success: false,

          message:
            'Your Telegram account could not be found. Please open PAYME through Telegram.'

        });

      }


      const result =
        await verifyTelegramAdvertisingCommunity(

          telegramLink,

          telegramType,

          req.user.telegramId

        );


      if (!result.success) {

        return res.status(400).json({

          success: false,

          verified: false,

          message:
            result.message

        });

      }


      /*
        Do not create the campaign yet.

        Verification only proves that:

        - community exists
        - correct type
        - advertiser is admin
        - PAYME bot is admin

        The actual campaign is created after the
        advertiser chooses the number of members.
      */


      return res.json({

        success: true,

        verified: true,

        chatId:
          result.chatId,

        username:
          result.username,

        title:
          result.title,

        telegramType:
          result.telegramType,

        botIsAdmin:
          result.botIsAdmin,

        advertiserIsAdmin:
          result.advertiserIsAdmin,

        message:
          'Telegram community verified successfully.'

      });


    } catch (error) {

      console.error(
        'POST /api/telegram-ads/verify error:',
        error
      );


      return res.status(500).json({

        success: false,

        verified: false,

        message:
          'Unable to verify the Telegram community right now.'

      });

    }

  }
);


// ======================================================
// CREATE TELEGRAM AD
// ======================================================

app.post(
  '/api/telegram-ads/create',
  requireLogin,
  async (
    req,
    res
  ) => {

    try {

      const {

        telegramType,

        telegramLink,

        telegramChatId,

        telegramUsername,

        targetMembers

      } =
        req.body || {};


      // --------------------------------------------------
      // BASIC VALIDATION
      // --------------------------------------------------

      if (
        ![
          'group',
          'channel'
        ].includes(
          telegramType
        )
      ) {

        return res.status(400).json({

          success: false,

          message:
            'Invalid Telegram community type.'

        });

      }


      if (
        !telegramLink
      ) {

        return res.status(400).json({

          success: false,

          message:
            'Telegram link is required.'

        });

      }


      const members =
        Number(
          targetMembers
        );


      if (
        !Number.isInteger(members) ||
        members < 20
      ) {

        return res.status(400).json({

          success: false,

          message:
            'Minimum campaign size is 20 members.'

        });

      }


      // --------------------------------------------------
      // CALCULATE PRICE ON SERVER
      // --------------------------------------------------

      const totalCost =
        members *
        TELEGRAM_AD_PRICE_PER_JOIN;


      // --------------------------------------------------
      // RE-VERIFY TELEGRAM
      //
      // Never trust the verification result sent by
      // advertise.html.
      // --------------------------------------------------

      const verification =
        await verifyTelegramAdvertisingCommunity(

          telegramLink,

          telegramType,

          req.user.telegramId

        );


      if (
        !verification.success
      ) {

        return res.status(400).json({

          success: false,

          message:
            verification.message

        });

      }


      // --------------------------------------------------
      // USE VERIFIED TELEGRAM INFORMATION
      // --------------------------------------------------

      const verifiedChatId =
        verification.chatId;


      const verifiedUsername =
        verification.username;


      // --------------------------------------------------
      // ATOMIC PAYMENT + AD CREATION
      // --------------------------------------------------

      const {
        data,
        error
      } =
        await supabase.rpc(
          'create_telegram_ad_campaign',
          {

            p_advertiser_id:
              String(
                req.user.id
              ),

            p_telegram_type:
              telegramType,

            p_telegram_link:
              telegramLink,

            p_telegram_chat_id:
              verifiedChatId,

            p_telegram_username:
              verifiedUsername,

            p_target_members:
              members,

            p_total_cost:
              totalCost

          }
        );


      if (error) {

        console.error(
          'Telegram ad creation RPC error:',
          error
        );


        const message =
          String(
            error.message ||
            ''
          );


        if (
          message
            .toLowerCase()
            .includes(
              'insufficient balance'
            )
        ) {

          return res.status(400).json({

            success: false,

            message:
              `You need ${formatNairaForAds(totalCost)} to run this campaign.`

          });

        }


        return res.status(500).json({

          success: false,

          message:
            'Unable to create advertising campaign.'

        });

      }


      // --------------------------------------------------
      // RECORD THE ADVERTISING DEBIT
      // --------------------------------------------------

      try {
        await addTransaction(req.user.id,{
          id:generateTransactionId('tx_ad'),
          type:'Telegram Advertising Debit',
          description:`Telegram advertising campaign${verifiedUsername ? ` — @${String(verifiedUsername).replace(/^@/,'')}` : ''}`,
          amount:totalCost,
          status:'completed'
        });
      } catch (transactionError) {
        console.error('Telegram advertising debit transaction error:',transactionError);
      }

      // --------------------------------------------------
      // SUCCESS
      // --------------------------------------------------

      return res.json({

        success: true,

        adId:
          data?.ad_id,

        targetMembers:
          members,

        pricePerJoin:
          TELEGRAM_AD_PRICE_PER_JOIN,

        memberReward:
          TELEGRAM_AD_MEMBER_REWARD,

        platformFee:
          TELEGRAM_AD_PLATFORM_FEE,

        totalCost:
          totalCost,

        depositUsed:
          Number(
            data?.deposit_used || 0
          ),

        withdrawableUsed:
          Number(
            data?.withdrawable_used || 0
          ),

        remainingDeposit:
          Number(
            data?.remaining_deposit || 0
          ),

        remainingWithdrawable:
          Number(
            data?.remaining_withdrawable || 0
          ),

        status:
          'active',

        message:
          'Your Telegram advertising campaign is now live.'

      });


    } catch (error) {

      console.error(
        'POST /api/telegram-ads/create error:',
        error
      );


      return res.status(500).json({

        success: false,

        message:
          'Unable to create advertising campaign right now.'

      });

    }

  }
);


// ======================================================
// ADVERTISER CAMPAIGNS
// ======================================================

app.get('/api/telegram-ads/my-campaigns',requireLogin,async(req,res)=>{
  try{
    const {data,error}=await supabase.from('telegram_ads').select(`
      id, advertiser_id, telegram_type, telegram_link, telegram_username,
      target_members, completed_members, price_per_join, total_cost, status, created_at
    `).eq('advertiser_id',String(req.user.id)).order('created_at',{ascending:false}).limit(50);
    if(error) throw error;
    return res.json({success:true,campaigns:data||[]});
  }catch(error){
    console.error('GET /api/telegram-ads/my-campaigns error:',error);
    return res.status(500).json({success:false,message:'Unable to load your campaigns.'});
  }
});


// ======================================================
// TOP UP ADVERTISER CAMPAIGN
// ======================================================
// TOP-UP EXTENDS THE EXISTING CAMPAIGN.
// It NEVER creates a second/duplicate campaign.
//
// The advertiser pays for the extra members, then the existing
// telegram_ads row is extended by increasing target_members and
// total_cost. A completed campaign is reactivated when topped up.
// ======================================================
app.post('/api/telegram-ads/top-up',requireLogin,async(req,res)=>{
  try{
    const adId=String(req.body?.adId||'').trim();
    const members=Number(req.body?.members);

    if(!adId){
      return res.status(400).json({
        success:false,
        message:'Campaign ID is required.'
      });
    }

    if(!Number.isInteger(members)||members<20){
      return res.status(400).json({
        success:false,
        message:'Minimum campaign top-up is 20 members.'
      });
    }

    // --------------------------------------------------
    // LOAD THE EXISTING CAMPAIGN
    // --------------------------------------------------
    const {data:ad,error:adError}=await supabase
      .from('telegram_ads')
      .select(`
        id,
        advertiser_id,
        telegram_type,
        telegram_link,
        telegram_chat_id,
        telegram_username,
        target_members,
        completed_members,
        price_per_join,
        total_cost,
        status
      `)
      .eq('id',adId)
      .eq('advertiser_id',String(req.user.id))
      .maybeSingle();

    if(adError) throw adError;

    if(!ad){
      return res.status(404).json({
        success:false,
        message:'Campaign not found.'
      });
    }

    if(ad.status==='cancelled'){
      return res.status(400).json({
        success:false,
        message:'Cancelled campaigns cannot be topped up.'
      });
    }

    const target=Number(ad.target_members||0);
    const completed=Number(ad.completed_members||0);
    const pricePerJoin=Number(
      ad.price_per_join || TELEGRAM_AD_PRICE_PER_JOIN
    );
    const additionalCost=members*pricePerJoin;
    const currentTotalCost=Number(
      ad.total_cost || target*pricePerJoin
    );

    // --------------------------------------------------
    // VERIFY THE SAME TELEGRAM COMMUNITY
    // --------------------------------------------------
    const verification=await verifyTelegramAdvertisingCommunity(
      ad.telegram_link,
      ad.telegram_type,
      req.user.telegramId
    );

    if(!verification.success){
      return res.status(400).json({
        success:false,
        message:verification.message
      });
    }

    const verifiedChatId=verification.chatId;
    const verifiedUsername=verification.username;

    // --------------------------------------------------
    // CHECK CURRENT BALANCE
    // --------------------------------------------------
    const freshUser=await getUserById(req.user.id);

    if(!freshUser){
      return res.status(401).json({
        success:false,
        message:'User account could not be found.'
      });
    }

    syncUserBalance(freshUser);

    const availableDeposit=getDepositBalance(freshUser);
    const availableWithdrawable=getWithdrawableBalance(freshUser);
    const availableTotal=availableDeposit+availableWithdrawable;

    if(availableTotal<additionalCost){
      return res.status(400).json({
        success:false,
        message:`You need ${formatNairaForAds(additionalCost)} to top up this campaign.`
      });
    }

    // --------------------------------------------------
    // DEBIT THE ADVERTISER BALANCE
    // Deposit balance is used first, then withdrawable balance.
    // --------------------------------------------------
    let remainingCharge=additionalCost;

    const depositUsed=Math.min(
      availableDeposit,
      remainingCharge
    );

    remainingCharge-=depositUsed;

    const withdrawableUsed=Math.min(
      availableWithdrawable,
      remainingCharge
    );

    const newDepositBalance=availableDeposit-depositUsed;
    const newWithdrawableBalance=availableWithdrawable-withdrawableUsed;

    const {data:updatedUser,error:balanceError}=await supabase
      .from('users')
      .update({
        balance:newDepositBalance+newWithdrawableBalance,
        deposit_balance:newDepositBalance,
        withdrawable_balance:newWithdrawableBalance
      })
      .eq('id',String(req.user.id))
      .eq('deposit_balance',availableDeposit)
      .eq('withdrawable_balance',availableWithdrawable)
      .select('*')
      .maybeSingle();

    if(balanceError) throw balanceError;

    // The conditional balance check protects against two top-ups
    // spending the same balance at the same time.
    if(!updatedUser){
      return res.status(409).json({
        success:false,
        message:'Your balance changed. Please refresh and try the top-up again.'
      });
    }

    // --------------------------------------------------
    // EXTEND THE EXISTING CAMPAIGN — NO NEW ROW
    // --------------------------------------------------
    const newTarget=target+members;
    const newTotalCost=currentTotalCost+additionalCost;

    const {data:updatedAd,error:updateError}=await supabase
      .from('telegram_ads')
      .update({
        telegram_chat_id:verifiedChatId || ad.telegram_chat_id,
        telegram_username:verifiedUsername || ad.telegram_username,
        target_members:newTarget,
        total_cost:newTotalCost,
        status:'active'
      })
      .eq('id',adId)
      .eq('advertiser_id',String(req.user.id))
      .in('status',['active','completed'])
      .select(`
        id,
        target_members,
        completed_members,
        total_cost,
        price_per_join,
        status
      `)
      .maybeSingle();

    if(updateError || !updatedAd){
      // Refund the balance if extending the campaign failed.
      try{
        await supabase
          .from('users')
          .update({
            balance:availableDeposit+availableWithdrawable,
            deposit_balance:availableDeposit,
            withdrawable_balance:availableWithdrawable
          })
          .eq('id',String(req.user.id))
          .eq('deposit_balance',newDepositBalance)
          .eq('withdrawable_balance',newWithdrawableBalance);
      }catch(refundError){
        console.error(
          'Telegram ad top-up refund error:',
          refundError
        );
      }

      if(updateError){
        console.error(
          'Telegram ad top-up campaign update error:',
          updateError
        );
      }

      return res.status(500).json({
        success:false,
        message:'Unable to extend the existing campaign. Your balance was not charged.'
      });
    }

    // --------------------------------------------------
    // RECORD THE TOP-UP TRANSACTION
    // --------------------------------------------------
    try{
      await addTransaction(req.user.id,{
        id:generateTransactionId('tx_ad_topup'),
        type:'Telegram Advertising Top Up',
        description:`Telegram advertising campaign top up — ${members.toLocaleString('en-NG')} additional members${verifiedUsername ? ` — @${String(verifiedUsername).replace(/^@/,'')}` : ''}`,
        amount:additionalCost,
        status:'completed'
      });
    }catch(transactionError){
      console.error(
        'Telegram advertising top-up transaction error:',
        transactionError
      );
    }

    return res.json({
      success:true,
      adId:updatedAd.id,
      addedMembers:members,
      targetMembers:Number(updatedAd.target_members||newTarget),
      completedMembers:Number(updatedAd.completed_members||completed),
      pricePerJoin:Number(updatedAd.price_per_join||pricePerJoin),
      memberReward:TELEGRAM_AD_MEMBER_REWARD,
      platformFee:TELEGRAM_AD_PLATFORM_FEE,
      additionalCost,
      totalCost:Number(updatedAd.total_cost||newTotalCost),
      depositUsed,
      withdrawableUsed,
      status:updatedAd.status||'active',
      message:'Your existing campaign has been extended successfully.'
    });

  }catch(error){
    console.error(
      'POST /api/telegram-ads/top-up error:',
      error
    );

    return res.status(500).json({
      success:false,
      message:'Unable to top up the campaign right now.'
    });
  }
});


// ======================================================
// CANCEL ADVERTISER CAMPAIGN
// ======================================================

app.post('/api/telegram-ads/cancel',requireLogin,async(req,res)=>{
  try{
    const adId=String(req.body?.adId||'').trim();
    if(!adId) return res.status(400).json({success:false,message:'Campaign ID is required.'});

    const {data:ad,error:adError}=await supabase.from('telegram_ads').select(`
      id, advertiser_id, telegram_type, telegram_link, telegram_username,
      target_members, completed_members, price_per_join, total_cost, status
    `).eq('id',adId).eq('advertiser_id',String(req.user.id)).maybeSingle();
    if(adError) throw adError;
    if(!ad) return res.status(404).json({success:false,message:'Campaign not found.'});
    if(ad.status!=='active') return res.status(400).json({success:false,message:'This campaign is no longer active.'});

    const target=Number(ad.target_members||0);
    const completed=Number(ad.completed_members||0);
    if(completed>=target) return res.status(400).json({success:false,message:'This campaign has already reached its target.'});

    const pricePerJoin=Number(ad.price_per_join||TELEGRAM_AD_PRICE_PER_JOIN);
    const totalCost=Number(ad.total_cost||target*pricePerJoin);
    const usedBudget=Math.min(totalCost,completed*pricePerJoin);
    const unusedBudget=Math.max(0,totalCost-usedBudget);
    const refund=Math.floor(unusedBudget*.85);

    const {error:updateError}=await supabase.from('telegram_ads').update({status:'cancelled'})
      .eq('id',adId).eq('advertiser_id',String(req.user.id)).eq('status','active');
    if(updateError) throw updateError;

    if(refund>0){
      req.user.depositBalance=getDepositBalance(req.user)+refund;
      await updateUser(req.user);
      try{
        await addTransaction(req.user.id,{
          id:generateTransactionId('tx_ad_refund'),
          type:'Telegram Advertising Refund',
          description:`85% unused budget refund${ad.telegram_username?` — @${String(ad.telegram_username).replace(/^@/,'')}`:''}`,
          amount:refund,
          status:'completed'
        });
      }catch(transactionError){console.error('Telegram advertising refund transaction error:',transactionError);}
    }

    return res.json({success:true,refund,status:'cancelled',depositBalance:req.user.depositBalance});
  }catch(error){
    console.error('POST /api/telegram-ads/cancel error:',error);
    return res.status(500).json({success:false,message:'Unable to cancel the campaign right now.'});
  }
});


// ======================================================
// FORMAT NAIRA FOR ADVERTISING
// ======================================================

function formatNairaForAds(
  amount
) {

  return (
    '₦' +
    Number(
      amount || 0
    ).toLocaleString(
      'en-NG'
    )
  );

}




// ======================================================
// GET ACTIVE TELEGRAM ADS
// ======================================================

app.get(
  '/api/telegram-ads',
  requireLogin,
  async (
    req,
    res
  ) => {

    try {

      const {
        data,
        error
      } =
        await supabase
          .from(
            'telegram_ads'
          )
          .select(
            [
              'id',
              'telegram_type',
              'telegram_link',
              'telegram_username',
              'target_members',
              'completed_members',
              'price_per_join',
              'member_reward',
              'created_at'
            ].join(',')
          )
          .eq(
            'status',
            'active'
          )
          .order(
            'created_at',
            {
              ascending: false
            }
          );

      if (error) {
        throw error;
      }

      // --------------------------------------------------
      // NEVER SHOW AN AD THE USER HAS ALREADY COMPLETED
      // --------------------------------------------------
      // The claim RPC already prevents a second payment, but
      // the available-ads endpoint must also hide an ad after
      // the user has successfully earned from it. This is read
      // from the existing telegram_ad_joins records, so the
      // exclusion survives page reloads, closing/reopening the
      // page, and logging in from another device.
      let completedAdIds = new Set();

      try {
        const {
          data: joins,
          error: joinsError
        } = await supabase
          .from('telegram_ad_joins')
          .select('ad_id')
          .eq('user_id', String(req.user.id));

        if (joinsError) {
          throw joinsError;
        }

        completedAdIds = new Set(
          (joins || [])
            .map(join => String(join.ad_id || '').trim())
            .filter(Boolean)
        );
      } catch (joinLookupError) {
        // Do not silently show previously completed ads if the
        // completion lookup fails. The claim endpoint remains
        // protected by the atomic database RPC, while this request
        // fails safely instead of exposing completed tasks.
        console.error(
          'GET /api/telegram-ads completed-join lookup error:',
          joinLookupError
        );

        return res.status(500).json({
          success: false,
          message: 'Unable to load Telegram advertisements right now.'
        });
      }

      const ads =
        (data || [])
          .filter(
            ad =>
              Number(
                ad.completed_members || 0
              ) <
              Number(
                ad.target_members || 0
              )
          )
          .filter(
            ad => !completedAdIds.has(String(ad.id))
          );

      return res.json({

        success: true,
        ads

      });

    } catch (error) {

      console.error(
        'GET /api/telegram-ads error:',
        error
      );

      return res.status(500).json({

        success: false,
        message:
          'Unable to load Telegram advertisements.'

      });

    }

  }
);


// ======================================================
// CLAIM TELEGRAM AD REWARD
// ======================================================

app.post(
  '/api/telegram-ads/claim',
  requireLogin,
  async (req, res) => {

    try {

      const {
        adId
      } = req.body || {};

      if (!adId) {
        return res.status(400).json({
          success: false,
          message: 'Advertisement ID is required.'
        });
      }

      const user = req.user;

      if (!user) {
        return res.status(401).json({
          success: false,
          message: 'Please log in again.'
        });
      }

      if (!user.telegramId) {
        return res.status(400).json({
          success: false,
          message:
            'Your Telegram account could not be found. Please open PAYME through Telegram.'
        });
      }

      if (!TELEGRAM_BOT_TOKEN) {
        return res.status(500).json({
          success: false,
          message:
            'Telegram bot is not configured on the server.'
        });
      }

      // --------------------------------------------------
      // GET ACTIVE AD
      // --------------------------------------------------

      const {
        data: ad,
        error: adError
      } = await supabase
        .from('telegram_ads')
        .select(`
          id,
          advertiser_id,
          telegram_type,
          telegram_link,
          telegram_chat_id,
          telegram_username,
          target_members,
          completed_members,
          member_reward,
          status
        `)
        .eq('id', adId)
        .maybeSingle();

      if (adError) {
        throw adError;
      }

      if (!ad) {
        return res.status(404).json({
          success: false,
          message: 'Advertisement not found.'
        });
      }

      if (ad.status !== 'active') {
        return res.status(400).json({
          success: false,
          message:
            'This advertisement is no longer active.'
        });
      }

      if (
        Number(ad.completed_members || 0) >=
        Number(ad.target_members || 0)
      ) {
        return res.status(400).json({
          success: false,
          message:
            'This advertisement has already reached its target.'
        });
      }

      if (!ad.telegram_chat_id) {
        return res.status(400).json({
          success: false,
          message:
            'This advertisement cannot be verified because its Telegram chat ID is missing.'
        });
      }

      // --------------------------------------------------
      // VERIFY MEMBERSHIP WITH TELEGRAM
      // --------------------------------------------------

      let member;

      try {

        member = await telegramApi(
          'getChatMember',
          {
            chat_id:
              ad.telegram_chat_id,

            user_id:
              Number(user.telegramId)
          }
        );

      } catch (telegramError) {

        console.error(
          'Telegram getChatMember error:',
          telegramError.telegramResponse ||
          telegramError
        );

        const telegramDescription =
          telegramError.telegramResponse?.description ||
          telegramError.message ||
          '';

        return res.status(400).json({
          success: false,
          joined: false,
          message:
            'We could not verify your Telegram membership right now. Please make sure you joined the group/channel and try again.',
          telegramError:
            process.env.NODE_ENV === 'production'
              ? undefined
              : telegramDescription
        });

      }

      const memberStatus =
        member?.status;

      const isMember =
        [
          'creator',
          'administrator',
          'member'
        ].includes(memberStatus)
        ||
        (
          memberStatus === 'restricted' &&
          member?.is_member === true
        );

      if (!isMember) {

        return res.status(400).json({
          success: false,
          joined: false,
          message:
            'You have not joined this Telegram group/channel yet. Please join it first, then tap Earn again.'
        });

      }

      // --------------------------------------------------
      // ATOMIC REWARD PAYMENT
      // --------------------------------------------------

      const {
        data: result,
        error: claimError
      } = await supabase.rpc(
        'claim_telegram_ad_reward',
        {
          p_ad_id:
            ad.id,

          p_user_id:
            String(user.id),

          p_telegram_user_id:
            Number(user.telegramId)
        }
      );

      if (claimError) {

        console.error(
          'claim_telegram_ad_reward RPC error:',
          claimError
        );

        const message =
          String(
            claimError.message ||
            ''
          );

        if (
          message
            .toLowerCase()
            .includes('already earned')
        ) {
          return res.status(400).json({
            success: false,
            alreadyClaimed: true,
            message:
              'You have already earned from this advertisement.'
          });
        }

        if (
          message
            .toLowerCase()
            .includes('already been processed')
        ) {
          return res.status(400).json({
            success: false,
            alreadyClaimed: true,
            message:
              'Your reward has already been processed.'
          });
        }

        if (
          message
            .toLowerCase()
            .includes('target')
        ) {
          return res.status(400).json({
            success: false,
            message:
              'This advertisement has already reached its target.'
          });
        }

        if (
          message
            .toLowerCase()
            .includes('transaction_type')
          ||
          message
            .toLowerCase()
            .includes('check constraint')
        ) {
          return res.status(500).json({
            success: false,
            message:
              'Membership was verified, but the reward transaction could not be recorded. Please contact PAYME support.'
          });
        }

        return res.status(500).json({
          success: false,
          message:
            'Your membership was verified, but we could not process the reward. Please try again.'
        });

      }

      const reward =
        Number(
          result?.reward ||
          ad.member_reward ||
          25
        );

      return res.json({
        success: true,
        joined: true,
        reward,
        completed_members:
          Number(
            result?.completed_members ||
            Number(ad.completed_members || 0) + 1
          ),
        message:
          `You joined successfully. ₦${reward.toLocaleString('en-NG')} has been added to your balance.`
      });

    } catch (error) {

      console.error(
        'POST /api/telegram-ads/claim error:',
        error
      );

      return res.status(500).json({
        success: false,
        message:
          'Unable to verify your Telegram membership right now.'
      });

    }

  }
);


// ======================================================
// TELEGRAM NOTIFICATION
// ======================================================

async function sendTelegramNotification(
  message
) {

  if (
    !TELEGRAM_BOT_TOKEN ||
    !TELEGRAM_CHAT_ID
  ) {

    console.warn(
      'Telegram notification disabled: TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID is missing.'
    );

    return;

  }

  try {

    const response =
      await fetch(
        `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,
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
        'NGN',

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
          claimedDays: []
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
        'NGN',

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
              []

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

            `<b>Welcome Bonus:</b> ₦${WELCOME_BONUS}\n` +

            `<b>Referral Code:</b> ${user.referralCode}\n` +

            `<b>Referred By:</b> ${
              user.referredBy || 'None'
            }\n` +

            `<b>Balance:</b> ₦${number(
              user.balance
            ).toFixed(2)}`

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
// WITHDRAW
// ======================================================

app.post(
  '/api/withdraw',
  requireLogin,
  async (req, res) => {

    try {

      const {
        accountName,
        bankName,
        accountNumber,
        amount
      } = req.body;

      const user =
        req.user;

      const withdrawnAmount =
        number(amount);

      const withdrawable =
        getWithdrawableBalance(
          user
        );

      if (
        !Number.isFinite(
          withdrawnAmount
        ) ||
        withdrawnAmount <
        MIN_WITHDRAWAL_LIMIT
      ) {

        return res.status(400).json({

          success:
            false,

          message:
            `Minimum withdrawal amount is ₦${MIN_WITHDRAWAL_LIMIT}.`

        });

      }

      if (
        withdrawnAmount >
        withdrawable
      ) {

        return res.status(400).json({

          success:
            false,

          message:
            `Insufficient withdrawable earnings. Deposited funds cannot be withdrawn directly (Deposit Balance: ₦${getDepositBalance(user).toLocaleString()}).`

        });

      }

      if (
        !accountName ||
        !bankName ||
        !accountNumber
      ) {

        return res.status(400).json({

          success:
            false,

          message:
            'Please provide complete bank details.'

        });

      }

      const oldBalance =
        number(
          user.balance
        );

      user.withdrawableBalance =
        withdrawable -
        withdrawnAmount;

      await updateUser(
        user
      );

      await addTransaction(
        user.id,
        {

          id:
            generateTransactionId(
              'tx_withdraw'
            ),

          type:
            'Withdrawal',

          amount:
            withdrawnAmount,

          bank:
            bankName,

          accountName:
            accountName,

          accountNumber:
            accountNumber,

          status:
            'Pending',

          description:
            'Withdrawal request'

        }
      );

      await sendTelegramNotification(

        `<b>NEW WITHDRAWAL REQUEST</b>\n\n` +

        `<b>User:</b> @${user.username || 'User'}\n` +

        `<b>Amount:</b> ₦${withdrawnAmount.toLocaleString()}\n` +

        `<b>Old Balance:</b> ₦${oldBalance.toLocaleString()}\n` +

        `<b>New Balance:</b> ₦${number(user.balance).toLocaleString()}\n` +

        `<b>Account Name:</b> ${accountName}\n` +

        `<b>Bank:</b> ${bankName}\n` +

        `<b>Account No:</b> ${accountNumber}`

      );

      return res.json({

        success:
          true,

        message:
          'Withdrawal request submitted successfully.',

        balance:
          user.balance,

        withdrawableBalance:
          user.withdrawableBalance,

        depositBalance:
          user.depositBalance

      });

    } catch (err) {

      console.error(
        'Withdrawal error:',
        err
      );

      return res.status(500).json({

        success:
          false,

        message:
          'Server error during withdrawal.'

      });

    }

  }
);

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

      if (!TELEGRAM_BOT_TOKEN) {

        return res.status(500).json({

          success:
            false,

          message:
            'Telegram bot is not configured on the server.'

        });

      }

      const response =
        await fetch(

          `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getChatMember?chat_id=@paymechannel&user_id=${encodeURIComponent(user.telegramId)}`

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
              `Insufficient balance. You need at least ₦${SPIN_COST} or a free spin.`

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
          weight: 2000,
          label: '₦0'
        },

        {
          amount: 10,
          weight: 2500,
          label: '₦10'
        },

        {
          amount: 20,
          weight: 2500,
          label: '₦20'
        },

        {
          amount: 50,
          weight: 1800,
          label: '₦50'
        },

        {
          amount: 100,
          weight: 800,
          label: '₦100'
        },

        {
          amount: 250,
          weight: 250,
          label: '₦250'
        },

        {
          amount: 500,
          weight: 100,
          label: '₦500'
        },

        {
          amount: 1000,
          weight: 45,
          label: '₦1000'
        },

        {
          amount: 2000,
          weight: 5,
          label: '₦2000'
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
            selectedPrize.amount,

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

      const gameType = String(
        body.gameType || ''
      ).trim().toLowerCase();

      if (!LUCKY3_GAME_TYPES.has(gameType)) {
        return res.status(400).json({
          success: false,
          message: 'Invalid Lucky 3 game type.'
        });
      }

      const stake = Number(body.stake);
      if (!Object.prototype.hasOwnProperty.call(LUCKY3_CONFIG.stakes, stake)) {
        return res.status(400).json({
          success: false,
          message: 'Invalid Lucky 3 stake.'
        });
      }

      // This ID is generated by the server when the client does not provide
      // one. For full retry/idempotency protection, Luck.html should send the
      // same requestId when retrying the same user action.
      const requestId = String(
        body.requestId || generateTransactionId('l3req')
      ).trim();

      if (!/^[A-Za-z0-9_-]{8,160}$/.test(requestId)) {
        return res.status(400).json({
          success: false,
          message: 'Invalid Lucky 3 request ID.'
        });
      }

      const winningNumbers = lucky3GenerateNumbers();
      const matchCount = selectedNumbers.filter(
        n => winningNumbers.includes(n)
      ).length;

      const payoutConfig = LUCKY3_CONFIG.stakes[stake];
      let payout = 0;
      let freeSpinsAwarded = 0;

      if (gameType === 'jackpot' && matchCount === 3) {
        payout = payoutConfig.jackpot;
      } else if (gameType === 'cash' && matchCount >= 2) {
        payout = payoutConfig.cash;
      } else if (gameType === 'bonus' && matchCount >= 1) {
        freeSpinsAwarded = payoutConfig.bonusFreeSpins;
      }

      const gameId = generateTransactionId('lucky3');
      const entryTransactionId = generateTransactionId('tx_lucky3_entry');
      const rewardTransactionId = payout > 0 || freeSpinsAwarded > 0
        ? generateTransactionId('tx_lucky3_reward')
        : null;

      // The RPC is the authoritative commit point. It locks the user row,
      // re-checks the balance and inputs, applies the debit/reward, inserts
      // the Lucky 3 game record and transactions, then returns the committed
      // wallet state. The service-role key never leaves this server.
      const { data, error } = await supabase.rpc(
        'play_lucky3_atomic',
        {
          p_game_id: gameId,
          p_request_id: requestId,
          p_user_id: user.id,
          p_selected_numbers: selectedNumbers,
          p_winning_numbers: winningNumbers,
          p_game_type: gameType,
          p_stake: stake,
          p_match_count: matchCount,
          p_payout: payout,
          p_free_spins_awarded: freeSpinsAwarded,
          p_entry_transaction_id: entryTransactionId,
          p_reward_transaction_id: rewardTransactionId
        }
      );

      if (error) {
        console.error('Lucky 3 RPC error:', error);

        const message = String(error.message || 'Lucky 3 transaction failed.');

        if (/insufficient balance/i.test(message)) {
          return res.status(400).json({
            success: false,
            code: 'INSUFFICIENT_BALANCE',
            message: 'Insufficient balance for this Lucky 3 stake.'
          });
        }

        if (/duplicate|unique|request/i.test(message)) {
          return res.status(409).json({
            success: false,
            code: 'DUPLICATE_REQUEST',
            message: 'This Lucky 3 request has already been processed.'
          });
        }

        return res.status(500).json({
          success: false,
          code: 'TRANSACTION_FAILED',
          message: 'Lucky 3 could not be completed. No entry was confirmed.'
        });
      }

      const result = Array.isArray(data) ? data[0] : data;

      if (!result) {
        throw new Error('Lucky 3 returned an empty transaction result.');
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
        payout: number(result.payout),
        freeSpinsAwarded: number(result.free_spins_awarded),
        balance: number(result.balance),
        depositBalance: number(result.deposit_balance),
        withdrawableBalance: number(result.withdrawable_balance),
        freeSpins: number(result.free_spins)
      });
    } catch (err) {
      console.error('Lucky 3 error:', err);

      return res.status(500).json({
        success: false,
        code: 'LUCKY3_SERVER_ERROR',
        message: 'Something went wrong while processing Lucky 3.'
      });
    }
  }
);

// ======================================================
// GET DEPOSITS
// ======================================================

app.get(
  '/api/deposits',
  requireLogin,
  async (req, res) => {

    try {

      return res.json({

        success:
          true,

        deposits:
          await getUserDeposits(
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
        'Get deposits error:',
        err
      );

      return res.status(500).json({

        success:
          false,

        message:
          'Failed to load deposits.'

      });

    }

  }
);

// ======================================================
// SUBMIT DEPOSIT
// ======================================================

app.post(
  '/api/deposits',
  requireLogin,
  async (req, res) => {

    try {

      const amount =
        number(
          req.body?.amount
        );

      const screenshot =
        req.body?.screenshot;

      if (
        !Number.isFinite(amount) ||
        amount <
        MIN_DEPOSIT_AMOUNT
      ) {

        return res.status(400).json({

          success:
            false,

          error:
            `Minimum deposit amount is ₦${MIN_DEPOSIT_AMOUNT}.`

        });

      }

      if (!screenshot) {

        return res.status(400).json({

          success:
            false,

          error:
            'Payment screenshot is required.'

        });

      }

      const matches =
        String(screenshot).match(
          /^data:image\/([a-zA-Z0-9.+-]+);base64,(.+)$/
        );

      if (!matches) {

        return res.status(400).json({

          success:
            false,

          error:
            'Invalid screenshot format.'

        });

      }

      const reference =
        generateDepositReference();

      const {
        error: depositError
      } =
        await supabase
          .from('deposits')
          .insert({

            reference,

            user_id:
              req.user.id,

            amount,

            status:
              'Pending Verification',

            screenshot,

            reason:
              null

          });

      if (depositError) {
        throw depositError;
      }

      const caption =

        `<b>NEW DEPOSIT REQUEST</b>\n\n` +

        `<b>Name:</b> ${req.user.fullName}\n` +

        `<b>Username:</b> @${req.user.username}\n` +

        `<b>Email:</b> ${req.user.email}\n` +

        `<b>Amount:</b> ₦${amount.toLocaleString()}\n` +

        `<b>Reference:</b> ${reference}\n` +

        `<b>Status:</b> Pending Verification`;

      if (
        !TELEGRAM_DEPOSIT_BOT_TOKEN ||
        !TELEGRAM_CHAT_ID
      ) {

        return res.status(500).json({

          success:
            false,

          error:
            'Deposit saved, but Telegram is not configured.'

        });

      }

      const imageBuffer =
        Buffer.from(
          matches[2],
          'base64'
        );

      const formData =
        new FormData();

      formData.append(
        'chat_id',
        TELEGRAM_CHAT_ID
      );

      formData.append(
        'caption',
        caption
      );

      formData.append(
        'photo',
        new Blob(
          [imageBuffer],
          {
            type:
              `image/${matches[1]}`
          }
        ),
        `deposit-${reference}.${matches[1]}`
      );

      formData.append(
        'reply_markup',
        JSON.stringify({

          inline_keyboard: [[

            {

              text:
                'APPROVE',

              callback_data:
                `approve_deposit:${req.user.id}:${reference}`

            },

            {

              text:
                'REJECT',

              callback_data:
                `reject_deposit:${req.user.id}:${reference}`

            }

          ]]

        })
      );

      const telegramResponse =
        await fetch(

          `https://api.telegram.org/bot${TELEGRAM_DEPOSIT_BOT_TOKEN}/sendPhoto`,

          {

            method:
              'POST',

            body:
              formData

          }

        );

      const telegramData =
        await telegramResponse.json();

      if (
        !telegramData.ok
      ) {

        console.error(
          'Telegram deposit error:',
          telegramData
        );

        return res.status(500).json({

          success:
            false,

          error:
            'Deposit saved, but Telegram notification failed.'

        });

      }

      return res.json({

        success:
          true,

        reference,

        message:
          'Deposit submitted successfully.'

      });

    } catch (err) {

      console.error(
        'Deposit error:',
        err
      );

      return res.status(500).json({

        success:
          false,

        error:
          'Server error during deposit submission.'

      });

    }

  }
);

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
          'NGN',

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

  return user.dailyReward;

}

// ======================================================
// DASHBOARD
// ======================================================

app.post(
  '/api/user/dashboard',
  async (req, res) => {

    try {

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

          canWithdraw:
            number(
              user.withdrawableBalance
            ) >=
            MIN_WITHDRAWAL_LIMIT

        },

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
              'NGN',

            status:
              'completed'

          }
        );

        rewardMessage =
          '₦10 daily reward claimed.';

      } else {

        user.freeSpins =
          number(
            user.freeSpins
          ) +
          1;

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
              'Daily Reward (Day 7) - Free Spin',

            amount:
              0,

            currency:
              'NGN',

            status:
              'completed'

          }
        );

        rewardMessage =
          'You earned 1 FREE SPIN!';

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
            user.freeSpins

        },

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
          'NGN',

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
      String(
        callbackQuery.message?.chat?.id
      ) !==
      String(
        TELEGRAM_CHAT_ID
      )
    ) {

      return;

    }

    const data =
      callbackQuery.data ||
      '';

    if (
      !data.startsWith(
        'approve_deposit:'
      ) &&
      !data.startsWith(
        'reject_deposit:'
      )
    ) {

      return;

    }

    const parts =
      data.split(':');

    const action =
      parts[0];

    const userId =
      parts[1];

    const reference =
      parts[2];

    const result =
      await verifyDeposit(

        userId,

        reference,

        action ===
        'approve_deposit'
          ? 'approve'
          : 'reject',

        'Payment proof was rejected.'

      );

    const targetUser =
      result.user;

    const deposit =
      result.deposit;

    await answerTelegramCallback(

      callbackQuery.id,

      action ===
      'approve_deposit'
        ? 'Deposit approved!'
        : 'Deposit rejected.'

    );

    const status =
      deposit.status;

    await editTelegramMessage(

      callbackQuery.message.chat.id,

      callbackQuery.message.message_id,

      `${status === 'Approved' ? '✅' : '❌'} <b>DEPOSIT ${status.toUpperCase()}</b>\n\n` +

      `👤 <b>Name:</b> ${targetUser.fullName}\n` +

      `🆔 <b>Username:</b> @${targetUser.username}\n` +

      `💰 <b>Amount:</b> ₦${number(
        deposit.amount
      ).toLocaleString()}\n` +

      `🔖 <b>Reference:</b> ${deposit.reference}\n` +

      `💳 <b>Balance:</b> ₦${number(
        targetUser.balance
      ).toLocaleString()}\n` +

      `💵 <b>Earnings:</b> ₦${number(
        targetUser.withdrawableBalance
      ).toLocaleString()}\n` +

      `💳 <b>Deposit Balance:</b> ₦${number(
        targetUser.depositBalance
      ).toLocaleString()}`

    );

  } catch (err) {

    console.error(
      'Telegram callback error:',
      err
    );

    if (
      callbackQuery?.id
    ) {

      await answerTelegramCallback(

        callbackQuery.id,

        'Could not process this deposit.'

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

        finalizeTapRushWeek(previousCompetition).catch(
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

    finalizeWeeklyCompetition(
      previousCompetition
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
// Redesigned away from the old "pay ₦100, rank in a 2-day
// challenge" format. Players now choose a stake (₦200/₦500/₦1000)
// and are rewarded immediately based on the score they reach in
// that single 20-second match:
//   score 5000+  -> cash reward = stake x 2
//   score 3000+  -> cash reward = stake x 0.5
//   score 1000+  -> free spins (tier depends on stake)
//   below 1000   -> no reward (stake is lost)
//
// A lightweight weekly leaderboard (top 2 scorers of the week)
// still exists purely for bragging rights + a small prize
// (₦1000 / ₦500), paid out automatically when the week rolls
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
                    message: 'Choose a valid stake: ₦200, ₦500, or ₦1000.'
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
                    message: `Insufficient balance. You need ₦${stake} to play.`
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
                description: `Tap Rush Entry — ₦${stake} stake`,
                amount: stake,
                currency: 'NGN',
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
                    description: `Tap Rush Reward — Score ${score} on a ₦${session.stake} play`,
                    amount: reward.cashAmount,
                    currency: 'NGN',
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
// Pays the top 2 scorers of the week that just ended: ₦1000 for
// 1st, ₦500 for 2nd. Idempotent via a deterministic transaction id
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
            currency: 'NGN',
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


















