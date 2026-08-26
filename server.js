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

const TELEGRAM_CHAT_ID =
  String(
    process.env.TELEGRAM_CHAT_ID || ''
  ).trim();

const SESSION_SECRET =
  process.env.PAYME_SESSION_SECRET ||
  'sess_sec_9qW2$vL5%nQ8@wZ3_8f8b2c7d4';

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
    data,
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
      )
      .select('*')
      .single();

  if (error) {
    throw error;
  }

  return mapUser(data);

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
    data,
    error
  } =
    await supabase
      .from('transactions')
      .insert(row)
      .select('*')
      .single();

  if (error) {
    throw error;
  }

  return data;

}

async function getTransactions(
  userId,
  limit = 200
) {

  const {
    data,
    error
  } =
    await supabase
      .from('transactions')
      .select('*')
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
      .limit(limit);

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

// ======================================================
// DEPOSITS
// ======================================================

async function getUserDeposits(
  userId
) {

  const {
    data,
    error
  } =
    await supabase
      .from('deposits')
      .select('*')
      .eq(
        'user_id',
        userId
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

      screenshot:
        d.screenshot,

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

    req.user =
      await loadUserData(
        user
      );

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
        await loadUserData(
          await getUserById(
            req.session.userId
          )
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


      const allowedMemberAmounts = [

        10,
        25,
        50,
        100,
        250,
        500

      ];


      if (
        !Number.isInteger(members) ||
        !allowedMemberAmounts.includes(
          members
        )
      ) {

        return res.status(400).json({

          success: false,

          message:
            'Invalid member amount.'

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
      !!user.hasClaimedGiftBox

  };

}

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

    const finalUser = await loadUserData(await getUserById(user.id));

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

        user = await loadUserData(user);
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
          await loadUserData(
            await getUserById(
              savedUser.id
            )
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
          await loadUserData(
            await getUserById(
              user.id
            )
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
        await loadUserData(
          await getUserById(
            user.id
          )
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
            req.user.id
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
        (
          await getTransactions(
            req.user.id
          )
        ).filter(
          t =>
            t.type &&
            t.type.includes('Spin')
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
        ) > 0
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
        (
          await getTransactions(
            user.id
          )
        ).filter(
          t =>
            t.type &&
            t.type.includes('Spin')
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
            req.user.id
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
        !TELEGRAM_BOT_TOKEN ||
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

          `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendPhoto`,

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

      user =
        await getUserById(
          user.id
        );

      const isNewUser =
        !beforeBonus &&
        user.hasReceivedWelcomeBonus &&
        !user.hasSeenPopup;

      if (isNewUser) {

        user.hasSeenPopup =
          true;

        await updateUser(
          user
        );

      }

      user =
        await loadUserData(
          await getUserById(
            user.id
          )
        );

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

      if (
        canClaim &&
        daily.currentDay === 1 &&
        daily.claimedDays.includes(7)
      ) {

        daily.claimedDays =
          [];

      }

      await updateUser(
        user
      );

      return res.json({

        success:
          true,

        user: {

          ...sanitizeUser(
            user
          ),

          isNewUser,

          minWithdrawalLimit:
            MIN_WITHDRAWAL_LIMIT,

          canWithdraw:
            number(
              user.withdrawableBalance
            ) >=
            MIN_WITHDRAWAL_LIMIT,

          transactions:
            user.transactions,

          deposits:
            user.deposits

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

app.get(
  '/api/leaderboard',
  async (req, res) => {

    try {

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

      return res.json({

        success:
          true,

        leaderboard:
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
          )

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
      500,

    description:
      'Weekly Referral Challenge — 1st Place'

  },

  {

    position:
      2,

    amount:
      200,

    description:
      'Weekly Referral Challenge — 2nd Place'

  },

  {

    position:
      3,

    amount:
      50,

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

async function finalizeWeeklyCompetition() {

  const competition =
    getCurrentCompetition();

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

  if (!TELEGRAM_BOT_TOKEN) {
    return;
  }

  try {

    await fetch(

      `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/answerCallbackQuery`,

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

  if (!TELEGRAM_BOT_TOKEN) {
    return;
  }

  try {

    await fetch(

      `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/editMessageCaption`,

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

// ======================================================
// TELEGRAM POLLING
// ======================================================

async function pollTelegramUpdates() {

  if (!TELEGRAM_BOT_TOKEN) {

    console.warn(
      'Telegram polling disabled: TELEGRAM_BOT_TOKEN is missing.'
    );

    return;

  }

  try {

    const response =
      await fetch(

        `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getUpdates?timeout=25&offset=${telegramUpdateOffset}`

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

    finalizeWeeklyCompetition()
      .catch(
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
// TAP RUSH
// ============================================================

const TAP_RUSH_ENTRY_FEE = 100;
const TAP_RUSH_DURATION_MS = 20000;
const TAP_RUSH_GRACE_MS = 2500;
const TAP_RUSH_MAX_EVENTS = 500;


// ============================================================
// TAP RUSH — ACTIVE CHALLENGE
// ============================================================

app.get(
    '/api/games/tap-rush/challenge',
    requireLogin,
    async (req, res) => {

        try {

            const now =
                new Date().toISOString();

            let {
                data: challenge,
                error
            } = await supabase
                .from('game_challenges')
                .select('*')
                .eq(
                    'game_type',
                    'tap_rush'
                )
                .eq(
                    'status',
                    'active'
                )
                .lte(
                    'start_time',
                    now
                )
                .gt(
                    'end_time',
                    now
                )
                .order(
                    'start_time',
                    {
                        ascending: false
                    }
                )
                .limit(1)
                .maybeSingle();

            if (error) {
                throw error;
            }


            // ------------------------------------------------
            // CREATE NEXT CHALLENGE IF NEEDED
            // ------------------------------------------------

            if (!challenge) {

                const {
                    data: latest,
                    error: latestError
                } = await supabase
                    .from(
                        'game_challenges'
                    )
                    .select(
                        'challenge_number,end_time'
                    )
                    .eq(
                        'game_type',
                        'tap_rush'
                    )
                    .order(
                        'challenge_number',
                        {
                            ascending: false
                        }
                    )
                    .limit(1)
                    .maybeSingle();

                if (latestError) {
                    throw latestError;
                }


                let start =
                    new Date();

                if (
                    latest &&
                    latest.end_time
                ) {

                    const latestEnd =
                        new Date(
                            latest.end_time
                        );

                    if (
                        latestEnd >
                        start
                    ) {
                        start =
                            latestEnd;
                    }

                }

                const end =
                    new Date(
                        start.getTime() +
                        48 * 60 * 60 * 1000
                    );

                const challengeNumber =
                    Number(
                        latest?.challenge_number ||
                        0
                    ) + 1;


                const {
                    data: created,
                    error: createError
                } = await supabase
                    .from(
                        'game_challenges'
                    )
                    .insert({
                        game_type:
                            'tap_rush',

                        challenge_number:
                            challengeNumber,

                        start_time:
                            start.toISOString(),

                        end_time:
                            end.toISOString(),

                        status:
                            'active',

                        prize_1:
                            1000,

                        prize_2:
                            500,

                        prize_3:
                            200
                    })
                    .select('*')
                    .single();

                if (createError) {
                    throw createError;
                }

                challenge =
                    created;

            }


            return res.json({

                success:
                    true,

                challenge: {

                    id:
                        challenge.id,

                    number:
                        challenge.challenge_number,

                    startTime:
                        challenge.start_time,

                    endTime:
                        challenge.end_time,

                    status:
                        challenge.status,

                    prizes: {

                        first:
                            Number(
                                challenge.prize_1
                            ),

                        second:
                            Number(
                                challenge.prize_2
                            ),

                        third:
                            Number(
                                challenge.prize_3
                            )

                    }

                }

            });

        } catch (err) {

            console.error(
                'Tap Rush challenge error:',
                err
            );

            return res.status(500).json({

                success:
                    false,

                message:
                    'Unable to load Tap Rush challenge.'

            });

        }

    }
);


// ============================================================
// TAP RUSH — START GAME
// ============================================================

app.post(
    '/api/games/tap-rush/start',
    requireLogin,
    async (req, res) => {

        try {

            const user =
                req.user;

            const challengeId =
                String(
                    req.body?.challengeId ||
                    ''
                ).trim();


            if (!challengeId) {

                return res.status(400).json({

                    success:
                        false,

                    message:
                        'Challenge is required.'

                });

            }


            // ------------------------------------------------
            // CALL ATOMIC SUPABASE FUNCTION
            // ------------------------------------------------

            const {
                data,
                error
            } = await supabase.rpc(
                'start_tap_rush_game',
                {
                    p_user_id:
                        user.id,

                    p_challenge_id:
                        challengeId,

                    p_entry_fee:
                        TAP_RUSH_ENTRY_FEE
                }
            );


            if (error) {

                console.error(
                    'Tap Rush start RPC error:',
                    error
                );

                const message =
                    String(
                        error.message ||
                        ''
                    );


                if (
                    message.includes(
                        'INSUFFICIENT_BALANCE'
                    )
                ) {

                    return res.status(400).json({

                        success:
                            false,

                        message:
                            'Insufficient balance. You need ₦100 to play.'

                    });

                }


                if (
                    message.includes(
                        'ACTIVE_GAME_EXISTS'
                    )
                ) {

                    return res.status(400).json({

                        success:
                            false,

                        message:
                            'You already have an active Tap Rush game.'

                    });

                }


                if (
                    message.includes(
                        'CHALLENGE_EXPIRED'
                    )
                ) {

                    return res.status(400).json({

                        success:
                            false,

                        message:
                            'This challenge has ended.'

                    });

                }


                throw error;

            }


            if (!data) {

                throw new Error(
                    'Tap Rush session was not created.'
                );

            }


            return res.json({

                success:
                    true,

                session: {

                    id:
                        data.sessionId,

                    seed:
                        data.seed,

                    serverStartTime:
                        data.serverStartTime,

                    expiresAt:
                        data.expiresAt,

                    challengeId:
                        challengeId

                },

                entryFee:
                    TAP_RUSH_ENTRY_FEE,

                balance:
                    Number(
                        data.balance || 0
                    )

            });

        } catch (err) {

            console.error(
                'Tap Rush start error:',
                err
            );

            return res.status(500).json({

                success:
                    false,

                message:
                    'Unable to start Tap Rush.'

            });

        }

    }
);


// ============================================================
// TAP RUSH — SCORE CALCULATION
// ============================================================

function calculateTapRushScore(
    events,
    completionTimeMs
) {

    let baseScore = 0;
    let comboScore = 0;
    let bonusScore = 0;
    let goldenScore = 0;
    let streakScore = 0;
    let accuracyScore = 0;
    let speedScore = 0;
    let difficultyScore = 0;

    let hits = 0;
    let misses = 0;

    let highestCombo = 0;

    let currentCombo =
        0;

    let goldenTargets = 0;
    let megaTargets = 0;
    let bonusTargets = 0;
    let fakeTargetsHit = 0;

    let reactionTotal = 0;
    let reactionCount = 0;

    const safeEvents =
        Array.isArray(events)
            ? events
            : [];


    for (
        const event of safeEvents
    ) {

        if (
            !event ||
            typeof event !== 'object'
        ) {
            continue;
        }


        const type =
            String(
                event.type || ''
            );


        if (
            type === 'hit'
        ) {

            hits++;

            currentCombo++;

            highestCombo =
                Math.max(
                    highestCombo,
                    currentCombo
                );


            const size =
                Number(
                    event.targetSize
                );


            let base = 10;


            if (
                event.targetType ===
                'golden'
            ) {

                base =
                    100;

                goldenTargets++;

                goldenScore +=
                    100;

            } else if (
                event.targetType ===
                'mega'
            ) {

                base =
                    250;

                megaTargets++;

                bonusScore +=
                    250;

            } else if (
                event.targetType ===
                'bonus'
            ) {

                base =
                    30;

                bonusTargets++;

                bonusScore +=
                    30;

            } else if (
                size <= 28
            ) {

                base =
                    40;

            } else if (
                size <= 38
            ) {

                base =
                    25;

            } else if (
                size <= 55
            ) {

                base =
                    15;

            }


            baseScore +=
                base;


            let multiplier =
                1;


            if (
                currentCombo >= 30
            ) {

                multiplier =
                    5;

            } else if (
                currentCombo >= 20
            ) {

                multiplier =
                    4;

            } else if (
                currentCombo >= 10
            ) {

                multiplier =
                    3;

            } else if (
                currentCombo >= 5
            ) {

                multiplier =
                    2;

            }


            comboScore +=
                Math.round(
                    base *
                    (
                        multiplier - 1
                    )
                );


            const reaction =
                Number(
                    event.reactionMs
                );


            if (
                Number.isFinite(
                    reaction
                ) &&
                reaction >= 1 &&
                reaction <= 2000
            ) {

                reactionTotal +=
                    reaction;

                reactionCount++;

            }


            if (
                currentCombo === 10 ||
                currentCombo === 20 ||
                currentCombo === 30
            ) {

                streakScore +=
                    currentCombo *
                    3;

            }

        } else {

            misses++;

            currentCombo =
                0;

        }

    }


    const totalAttempts =
        hits +
        misses;


    const accuracy =
        totalAttempts > 0
            ? (
                hits /
                totalAttempts
            ) * 100
            : 0;


    accuracyScore =
        Math.round(
            accuracy *
            1.5
        );


    const averageReaction =
        reactionCount > 0
            ? reactionTotal /
              reactionCount
            : 999;


    if (
        averageReaction < 250
    ) {

        speedScore =
            150;

    } else if (
        averageReaction < 350
    ) {

        speedScore =
            110;

    } else if (
        averageReaction < 500
    ) {

        speedScore =
            75;

    } else if (
        averageReaction < 700
    ) {

        speedScore =
            40;

    }


    const difficulty =
        safeEvents.reduce(
            (
                total,
                event
            ) => {

                const size =
                    Number(
                        event?.targetSize
                    );

                if (
                    !Number.isFinite(size)
                ) {
                    return total;
                }

                if (
                    size <= 28
                ) {
                    return total + 5;
                }

                if (
                    size <= 38
                ) {
                    return total + 3;
                }

                if (
                    size <= 55
                ) {
                    return total + 1;
                }

                return total;

            },
            0
        );


    difficultyScore =
        difficulty;


    const timeBonus =
        completionTimeMs <=
        TAP_RUSH_DURATION_MS + 1000
            ? 50
            : 0;


    const finalScore =
        Math.max(
            0,
            Math.round(
                baseScore +
                comboScore +
                bonusScore +
                goldenScore +
                streakScore +
                accuracyScore +
                speedScore +
                difficultyScore +
                timeBonus
            )
        );


    return {

        score:
            finalScore,

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
// We intentionally do NOT use a Supabase foreign-key join
// between tap_rush_scores and users.
//
// This works with the existing users table even when there is
// no FK relationship exposed in Supabase's schema cache.
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

    const {
        data,
        error
    } = await supabase
        .from('users')
        .select(`
            id,
            username,
            full_name
        `)
        .in('id', ids);

    if (error) {
        throw error;
    }

    const profiles = new Map();

    for (const user of data || []) {

        profiles.set(
            String(user.id),
            {
                username:
                    user.username ||
                    null,

                full_name:
                    user.full_name ||
                    null
            }
        );
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

            const user =
                req.user;


            const sessionId =
                String(
                    req.body?.sessionId ||
                    ''
                ).trim();


            if (!sessionId) {

                return res.status(400).json({

                    success:
                        false,

                    message:
                        'Game session is required.'

                });

            }


            const {
                data: session,
                error: sessionError
            } = await supabase
                .from(
                    'tap_rush_sessions'
                )
                .select(
                    '*'
                )
                .eq(
                    'id',
                    sessionId
                )
                .eq(
                    'user_id',
                    user.id
                )
                .maybeSingle();


            if (sessionError) {
                throw sessionError;
            }


            if (!session) {

                return res.status(404).json({

                    success:
                        false,

                    message:
                        'Game session not found.'

                });

            }


            if (
                session.status !==
                'active'
            ) {

                return res.status(400).json({

                    success:
                        false,

                    message:
                        'This game has already been completed.'

                });

            }


            const now =
                Date.now();


            const serverStart =
                new Date(
                    session.server_start_time
                ).getTime();


            const serverElapsed =
                now -
                serverStart;


            if (
                serverElapsed <
                18000
            ) {

                return res.status(400).json({

                    success:
                        false,

                    message:
                        'Game completed too quickly.'

                });

            }


            if (
                serverElapsed >
                28000
            ) {

                await supabase
                    .from(
                        'tap_rush_sessions'
                    )
                    .update({
                        status:
                            'expired',

                        finished_at:
                            new Date()
                                .toISOString()
                    })
                    .eq(
                        'id',
                        sessionId
                    );

                return res.status(400).json({

                    success:
                        false,

                    message:
                        'Game session expired.'

                });

            }


            const events =
                Array.isArray(
                    req.body?.events
                )
                    ? req.body.events
                    : [];


            if (
                events.length >
                TAP_RUSH_MAX_EVENTS
            ) {

                return res.status(400).json({

                    success:
                        false,

                    message:
                        'Too many gameplay events.'

                });

            }


            const completionTimeMs =
                Number(
                    req.body?.completionTimeMs
                );


            if (
                !Number.isFinite(
                    completionTimeMs
                ) ||
                completionTimeMs <
                    18000 ||
                completionTimeMs >
                    22000
            ) {

                return res.status(400).json({

                    success:
                        false,

                    message:
                        'Invalid game duration.'

                });

            }


            // ------------------------------------------------
            // EVENT VALIDATION
            // ------------------------------------------------

            let previousEventTime =
                -1;

            let impossible =
                false;

            let suspiciousReason =
                null;


            for (
                const event of events
            ) {

                if (
                    !event ||
                    typeof event !== 'object'
                ) {

                    impossible =
                        true;

                    suspiciousReason =
                        'Invalid event';

                    break;

                }


                const at =
                    Number(
                        event.at
                    );


                if (
                    !Number.isFinite(
                        at
                    )
                ) {

                    impossible =
                        true;

                    suspiciousReason =
                        'Invalid event timestamp';

                    break;

                }


                if (
                    at <
                    previousEventTime
                ) {

                    impossible =
                        true;

                    suspiciousReason =
                        'Events out of order';

                    break;

                }


                previousEventTime =
                    at;

            }


            if (
                impossible
            ) {

                await supabase
                    .from(
                        'tap_rush_sessions'
                    )
                    .update({

                        status:
                            'rejected',

                        suspicious:
                            true,

                        suspicious_reason:
                            suspiciousReason,

                        finished_at:
                            new Date()
                                .toISOString()

                    })
                    .eq(
                        'id',
                        sessionId
                    );


                return res.status(400).json({

                    success:
                        false,

                    message:
                        'Suspicious gameplay detected.'

                });

            }


            const calculated =
                calculateTapRushScore(
                    events,
                    completionTimeMs
                );


            // ------------------------------------------------
            // THE CLIENT SCORE IS NEVER USED
            // ------------------------------------------------

            const score =
                calculated.score;


            // ------------------------------------------------
            // SCORE UPPER LIMIT
            // ------------------------------------------------

            if (
                score >
                50000
            ) {

                await supabase
                    .from(
                        'tap_rush_sessions'
                    )
                    .update({

                        status:
                            'rejected',

                        suspicious:
                            true,

                        suspicious_reason:
                            'Score exceeded theoretical limit',

                        finished_at:
                            new Date()
                                .toISOString()

                    })
                    .eq(
                        'id',
                        sessionId
                    );


                return res.status(400).json({

                    success:
                        false,

                    message:
                        'Impossible score detected.'

                });

            }


            // ------------------------------------------------
            // UNIQUE DISPLAY SCORE
            //
            // Base score remains legitimate.
            //
            // If an exact collision occurs, the server
            // deterministically adds a tiny performance
            // derived component.
            // ------------------------------------------------

            let displayedScore =
                score;


            const {
                data: collision
            } = await supabase
                .from(
                    'tap_rush_scores'
                )
                .select(
                    'id,displayed_score,tie_break_value'
                )
                .eq(
                    'challenge_id',
                    session.challenge_id
                )
                .eq(
                    'displayed_score',
                    displayedScore
                )
                .limit(1)
                .maybeSingle();


            let tieBreakValue =
                Number(
                    completionTimeMs
                );


            if (
                collision
            ) {

                const cryptoHash =
                    crypto
                        .createHash(
                            'sha256'
                        )
                        .update(
                            `${user.id}:${sessionId}:${score}:${completionTimeMs}:${events.length}`
                        )
                        .digest('hex');


                const suffix =
                    parseInt(
                        cryptoHash.slice(
                            0,
                            8
                        ),
                        16
                    ) %
                    997;


                displayedScore =
                    score *
                    1000 +
                    suffix;


                tieBreakValue =
                    Number(
                        (
                            completionTimeMs +
                            (
                                suffix /
                                1000
                            )
                        ).toFixed(8)
                    );

            } else {

                displayedScore =
                    score *
                    1000 +
                    (
                        completionTimeMs %
                        997
                    );

            }


            // ------------------------------------------------
            // INSERT SCORE
            // ------------------------------------------------

            const {
                data: savedScore,
                error: scoreError
            } = await supabase
                .from(
                    'tap_rush_scores'
                )
                .insert({

                    challenge_id:
                        session.challenge_id,

                    user_id:
                        user.id,

                    game_session_id:
                        sessionId,

                    score,

                    base_score:
                        calculated.baseScore,

                    combo_score:
                        calculated.comboScore,

                    bonus_score:
                        calculated.bonusScore,

                    golden_score:
                        calculated.goldenScore,

                    streak_score:
                        calculated.streakScore,

                    accuracy_score:
                        calculated.accuracyScore,

                    speed_score:
                        calculated.speedScore,

                    difficulty_score:
                        calculated.difficultyScore,

                    hits:
                        calculated.hits,

                    misses:
                        calculated.misses,

                    accuracy:
                        calculated.accuracy,

                    highest_combo:
                        calculated.highestCombo,

                    golden_targets:
                        calculated.goldenTargets,

                    mega_targets:
                        calculated.megaTargets,

                    bonus_targets:
                        calculated.bonusTargets,

                    fake_targets_hit:
                        calculated.fakeTargetsHit,

                    reaction_score:
                        Math.round(
                            calculated.averageReaction
                        ),

                    completion_time_ms:
                        completionTimeMs,

                    total_events:
                        events.length,

                    displayed_score:
                        displayedScore,

                    tie_break_value:
                        tieBreakValue

                })
                .select(
                    '*'
                )
                .single();


            if (scoreError) {

                throw scoreError;

            }


            // ------------------------------------------------
            // MARK SESSION FINISHED
            // ------------------------------------------------

            await supabase
                .from(
                    'tap_rush_sessions'
                )
                .update({

                    status:
                        'finished',

                    server_end_time:
                        new Date()
                            .toISOString(),

                    client_finished_at:
                        Date.now(),

                    gameplay_hash:
                        crypto
                            .createHash(
                                'sha256'
                            )
                            .update(
                                JSON.stringify(
                                    events
                                )
                            )
                            .digest('hex'),

                    finished_at:
                        new Date()
                            .toISOString()

                })
                .eq(
                    'id',
                    sessionId
                );


            // ------------------------------------------------
            // PLAYER STATS
            // ------------------------------------------------

            const {
                data: existingStats
            } = await supabase
                .from(
                    'player_game_stats'
                )
                .select(
                    '*'
                )
                .eq(
                    'user_id',
                    user.id
                )
                .eq(
                    'game_type',
                    'tap_rush'
                )
                .maybeSingle();


            if (
                existingStats
            ) {

                await supabase
                    .from(
                        'player_game_stats'
                    )
                    .update({

                        games_played:
                            Number(
                                existingStats.games_played
                            ) + 1,

                        best_score:
                            Math.max(
                                Number(
                                    existingStats.best_score
                                ),
                                displayedScore
                            ),

                        total_hits:
                            Number(
                                existingStats.total_hits
                            ) +
                            calculated.hits,

                        total_misses:
                            Number(
                                existingStats.total_misses
                            ) +
                            calculated.misses,

                        golden_targets:
                            Number(
                                existingStats.golden_targets
                            ) +
                            calculated.goldenTargets,

                        highest_combo:
                            Math.max(
                                Number(
                                    existingStats.highest_combo
                                ),
                                calculated.highestCombo
                            ),

                        updated_at:
                            new Date()
                                .toISOString()

                    })
                    .eq(
                        'id',
                        existingStats.id
                    );

            } else {

                await supabase
                    .from(
                        'player_game_stats'
                    )
                    .insert({

                        user_id:
                            user.id,

                        game_type:
                            'tap_rush',

                        games_played:
                            1,

                        best_score:
                            displayedScore,

                        total_hits:
                            calculated.hits,

                        total_misses:
                            calculated.misses,

                        golden_targets:
                            calculated.goldenTargets,

                        highest_combo:
                            calculated.highestCombo

                    });

            }


            // ------------------------------------------------
            // LEADERBOARD
            // ------------------------------------------------


// ------------------------------------------------
// LEADERBOARD
// ------------------------------------------------
// Do NOT use:
// users:user_id(...)
//
// There is no FK relationship exposed between
// tap_rush_scores.user_id and users.id.
//
// Fetch scores first, then fetch users separately.
// ------------------------------------------------

const {
    data: leaderboard,
    error: leaderboardError
} = await supabase
    .from('tap_rush_scores')
    .select(`
        displayed_score,
        score,
        user_id
    `)
    .eq(
        'challenge_id',
        session.challenge_id
    )
    .order(
        'displayed_score',
        {
            ascending: false
        }
    )
    .limit(100);

if (leaderboardError) {
    throw leaderboardError;
}


// ------------------------------------------------
// FETCH USER PROFILES SEPARATELY
// ------------------------------------------------

const leaderboardUserIds =
    (
        leaderboard ||
        []
    ).map(
        row => row.user_id
    );

let userProfiles =
    new Map();

try {

    userProfiles =
        await getTapRushUserProfiles(
            leaderboardUserIds
        );

} catch (profileError) {

    // The score has already been saved.
    // Do NOT turn a successful game into
    // "Unable to submit" just because a
    // display-name lookup failed.

    console.error(
        'Tap Rush profile lookup error:',
        profileError
    );
}


// ------------------------------------------------
// BUILD RANKED LEADERBOARD
// ------------------------------------------------

const ranked =
    (
        leaderboard ||
        []
    ).map(
        (
            row,
            index
        ) => {

            const profile =
                userProfiles.get(
                    String(
                        row.user_id
                    )
                ) || {};

            const username =
                profile.username ||
                profile.full_name ||
                'Player';

            return {

                rank:
                    index + 1,

                score:
                    Number(
                        row.displayed_score
                    ),

                username,

                userId:
                    row.user_id,

                isYou:
                    String(
                        row.user_id
                    ) ===
                    String(
                        user.id
                    )
            };
        }
    );


            const userRank =
                ranked.find(
                    row =>
                        row.isYou
                );


            const pointsToNext =
                userRank &&
                userRank.rank > 1
                    ? Math.max(
                        0,
                        Number(
                            ranked[
                                userRank.rank - 2
                            ]?.score || 0
                        ) -
                        Number(
                            userRank.score
                        )
                    )
                    : null;


            return res.json({

                success:
                    true,

                result: {

                    score:
                        displayedScore,

                    baseScore:
                        calculated.baseScore,

                    hits:
                        calculated.hits,

                    misses:
                        calculated.misses,

                    accuracy:
                        calculated.accuracy,

                    highestCombo:
                        calculated.highestCombo,

                    goldenTargets:
                        calculated.goldenTargets,

                    megaTargets:
                        calculated.megaTargets,

                    rank:
                        userRank?.rank ||
                        null,

                    pointsToNext,

                    personalBest:
                        existingStats
                            ? displayedScore >
                              Number(
                                  existingStats.best_score
                              )
                            : true,

                    leaderboard:
                        ranked.slice(
                            0,
                            10
                        )

                }

            });

        } catch (err) {

            console.error(
                'Tap Rush finish error:',
                err
            );

            return res.status(500).json({

                success:
                    false,

                message:
                    'Unable to submit Tap Rush result.'

            });

        }

    }
);


// ============================================================
// TAP RUSH — LEADERBOARD
// ============================================================

// ============================================================
// TAP RUSH — LEADERBOARD
// ============================================================

app.get(
    '/api/games/tap-rush/leaderboard',
    requireLogin,
    async (req, res) => {

        try {

            // ------------------------------------------------
            // FIND ACTIVE CHALLENGE
            // ------------------------------------------------

            const {
                data: challenge,
                error: challengeError
            } = await supabase
                .from('game_challenges')
                .select('*')
                .eq(
                    'game_type',
                    'tap_rush'
                )
                .eq(
                    'status',
                    'active'
                )
                .lte(
                    'start_time',
                    new Date().toISOString()
                )
                .gt(
                    'end_time',
                    new Date().toISOString()
                )
                .order(
                    'start_time',
                    {
                        ascending: false
                    }
                )
                .limit(1)
                .maybeSingle();


            if (challengeError) {
                throw challengeError;
            }


            // ------------------------------------------------
            // NO ACTIVE CHALLENGE
            // ------------------------------------------------

            if (!challenge) {

                return res.json({

                    success:
                        true,

                    leaderboard:
                        [],

                    yourRank:
                        null

                });
            }


            // ------------------------------------------------
            // GET SCORES
            // ------------------------------------------------

            const {
                data: scores,
                error: scoreError
            } = await supabase
                .from('tap_rush_scores')
                .select(`
                    displayed_score,
                    score,
                    user_id
                `)
                .eq(
                    'challenge_id',
                    challenge.id
                )
                .order(
                    'displayed_score',
                    {
                        ascending: false
                    }
                )
                .limit(100);


            if (scoreError) {
                throw scoreError;
            }


            // ------------------------------------------------
            // GET USER IDs
            // ------------------------------------------------

            const userIds =
                (
                    scores ||
                    []
                ).map(
                    row =>
                        row.user_id
                );


            // ------------------------------------------------
            // GET USER PROFILES
            // ------------------------------------------------

            let profiles =
                new Map();

            try {

                profiles =
                    await getTapRushUserProfiles(
                        userIds
                    );

            } catch (profileError) {

                console.error(
                    'Tap Rush leaderboard profile error:',
                    profileError
                );

                // Keep the leaderboard working even
                // if a profile lookup temporarily fails.
            }


            // ------------------------------------------------
            // BUILD LEADERBOARD
            // ------------------------------------------------

            const ranked =
                (
                    scores ||
                    []
                ).map(
                    (
                        row,
                        index
                    ) => {

                        const profile =
                            profiles.get(
                                String(
                                    row.user_id
                                )
                            ) || {};

                        return {

                            rank:
                                index + 1,

                            score:
                                Number(
                                    row.displayed_score
                                ),

                            username:
                                profile.username ||
                                profile.full_name ||
                                'Player',

                            userId:
                                row.user_id,

                            isYou:
                                String(
                                    row.user_id
                                ) ===
                                String(
                                    req.user.id
                                )
                        };
                    }
                );


            // ------------------------------------------------
            // FIND CURRENT USER
            // ------------------------------------------------

            const yourRank =
                ranked.find(
                    row =>
                        row.isYou
                );


            // ------------------------------------------------
            // RETURN TOP 10 + USER POSITION
            // ------------------------------------------------

            return res.json({

                success:
                    true,

                challenge: {

                    id:
                        challenge.id,

                    number:
                        challenge.challenge_number,

                    startTime:
                        challenge.start_time,

                    endTime:
                        challenge.end_time,

                    prizes: {

                        first:
                            Number(
                                challenge.prize_1
                            ),

                        second:
                            Number(
                                challenge.prize_2
                            ),

                        third:
                            Number(
                                challenge.prize_3
                            )
                    }
                },

                leaderboard:
                    ranked.slice(
                        0,
                        10
                    ),

                yourPosition:
                    yourRank?.rank ||
                    null,

                yourScore:
                    yourRank?.score ||
                    0

            });

        } catch (err) {

            console.error(
                'Tap Rush leaderboard error:',
                err
            );

            return res.status(500).json({

                success:
                    false,

                message:
                    'Unable to load leaderboard.'
            });
        }
    }
);



// ============================================================
// TAP RUSH — MY STATS
// ============================================================

app.get(
    '/api/games/tap-rush/my-stats',
    requireLogin,
    async (req, res) => {

        try {

            const {
                data,
                error
            } = await supabase
                .from(
                    'player_game_stats'
                )
                .select(
                    '*'
                )
                .eq(
                    'user_id',
                    req.user.id
                )
                .eq(
                    'game_type',
                    'tap_rush'
                )
                .maybeSingle();


            if (error) {
                throw error;
            }


            return res.json({

                success:
                    true,

                stats:
                    data || {

                        games_played:
                            0,

                        best_score:
                            0,

                        best_rank:
                            null,

                        total_hits:
                            0,

                        total_misses:
                            0,

                        golden_targets:
                            0,

                        highest_combo:
                            0,

                        wins:
                            0

                    }

            });

        } catch (err) {

            console.error(
                'Tap Rush stats error:',
                err
            );

            return res.status(500).json({

                success:
                    false,

                message:
                    'Unable to load Tap Rush stats.'

            });

        }

    }
);


// ============================================================
// TAP RUSH — HISTORY
// ============================================================

app.get(
    '/api/games/tap-rush/history',
    requireLogin,
    async (req, res) => {

        try {

            const {
                data,
                error
            } = await supabase
                .from(
                    'tap_rush_scores'
                )
                .select(`
                    id,
                    score,
                    displayed_score,
                    hits,
                    misses,
                    accuracy,
                    highest_combo,
                    golden_targets,
                    created_at,
                    game_challenges!inner(
                        challenge_number
                    )
                `)
                .eq(
                    'user_id',
                    req.user.id
                )
                .order(
                    'created_at',
                    {
                        ascending: false
                    }
                )
                .limit(50);


            if (error) {
                throw error;
            }


            return res.json({

                success:
                    true,

                history:
                    data || []

            });

        } catch (err) {

            console.error(
                'Tap Rush history error:',
                err
            );

            return res.status(500).json({

                success:
                    false,

                message:
                    'Unable to load Tap Rush history.'

            });

        }

    }
);


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





