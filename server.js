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

app.post(
  '/api/auth/signup',
  async (req, res) => {

    try {

      const {
        fullName,
        email,
        username,
        phone,
        countryCode,
        password,
        referralCode,
        agreeTerms
      } = req.body;

      if (
        !fullName ||
        String(fullName)
          .trim()
          .length < 2
      ) {

        return res.status(400).json({

          success:
            false,

          message:
            'Please enter your full name.'

        });

      }

      if (
        !email ||
        !String(email).includes('@')
      ) {

        return res.status(400).json({

          success:
            false,

          message:
            'Please enter a valid email address.'

        });

      }

      if (
        !username ||
        String(username)
          .trim()
          .length < 3
      ) {

        return res.status(400).json({

          success:
            false,

          message:
            'Username must be at least 3 characters.'

        });

      }

      if (
        !phone ||
        String(phone)
          .trim()
          .length < 7
      ) {

        return res.status(400).json({

          success:
            false,

          message:
            'Please enter a valid phone number.'

        });

      }

      if (
        !password ||
        String(password).length < 8
      ) {

        return res.status(400).json({

          success:
            false,

          message:
            'Password must be at least 8 characters.'

        });

      }

      if (!agreeTerms) {

        return res.status(400).json({

          success:
            false,

          message:
            'Please accept the Terms of Service.'

        });

      }

      const cleanUsername =
        String(username)
          .trim()
          .toLowerCase();

      const cleanEmail =
        String(email)
          .trim()
          .toLowerCase();

      const cleanPhone =
        `${countryCode || '+234'}${String(phone).trim()}`;

      const cleanRefInput =
        referralCode
          ? String(
              referralCode
            )
              .trim()
              .toUpperCase()
          : null;

      if (
        await getUserByUsername(
          cleanUsername
        )
      ) {

        return res.status(400).json({

          success:
            false,

          message:
            'Username is already taken.'

        });

      }

      if (
        await getUserByEmail(
          cleanEmail
        )
      ) {

        return res.status(400).json({

          success:
            false,

          message:
            'Email address is already registered.'

        });

      }

      const newUser = {

        id:
          generateUserId(),

        fullName:
          String(fullName).trim(),

        email:
          cleanEmail,

        username:
          cleanUsername,

        phone:
          cleanPhone,

        password:
          String(password),

        telegramId:
          null,

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
          await generateUniqueReferralCode(),

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

      const created =
        await createUser(
          newUser
        );

      await ensureWelcomeBonus(
        created
      );

      const savedUser =
        await getUserById(
          created.id
        );

      if (
        cleanRefInput
      ) {

        const referrer =
          await getUserByReferralCode(
            cleanRefInput
          );

        if (
          referrer &&
          referrer.id !==
          savedUser.id
        ) {

          await processReferral(
            referrer,
            savedUser
          );

        }

      }

      const finalUser =
        await loadUserData(
          await getUserById(
            savedUser.id
          )
        );

      setSessionCookie(
        res,
        createSessionToken(
          finalUser
        )
      );

      await sendTelegramNotification(

        `<b>NEW USER REGISTERED</b>\n\n` +

        `<b>Name:</b> ${finalUser.fullName}\n` +

        `<b>Username:</b> @${finalUser.username}\n` +

        `<b>Email:</b> ${finalUser.email}\n` +

        `<b>Phone:</b> ${finalUser.phone}\n` +

        `<b>Welcome Bonus:</b> ₦${WELCOME_BONUS}\n` +

        `<b>Referral Code:</b> ${finalUser.referralCode}\n` +

        `<b>Balance:</b> ₦${number(
          finalUser.balance
        ).toFixed(2)}`

      );

      return res.json({

        success:
          true,

        message:
          'Signup successful',

        user:
          sanitizeUser(
            finalUser
          )

      });

    } catch (err) {

      console.error(
        'Signup error:',
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
            'That username, email, Telegram account, or referral code is already registered.'

        });

      }

      return res.status(500).json({

        success:
          false,

        message:
          'Server error during signup.'

      });

    }

  }
);

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

app.post(
  '/api/auth/telegram-signup',
  async (req, res) => {

    try {

      const {
        initData,
        referralCode
      } = req.body || {};

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

        // ------------------------------------------------
        // GENERATE UNIQUE REFERRAL CODE
        // IMPORTANT: MUST USE await
        // ------------------------------------------------

        const uniqueRefCode =
          await generateUniqueReferralCode();

        // ------------------------------------------------
        // CREATE USER OBJECT
        // ------------------------------------------------

        const newUser = {

          id:
            generateUserId(),

          telegramId:
            cleanTelegramId,

          fullName:
            fullName,

          // Telegram users do not necessarily have
          // an email address, so create an internal
          // unique email value.
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

        // ------------------------------------------------
        // INSERT USER INTO SUPABASE
        // ------------------------------------------------

        const createdUser =
          await createUser(
            newUser
          );

        console.log(
          'Telegram user created:',
          createdUser.id
        );

        // ------------------------------------------------
        // GIVE WELCOME BONUS
        // ------------------------------------------------

        await ensureWelcomeBonus(
          createdUser
        );

        // ------------------------------------------------
        // RELOAD USER FROM SUPABASE
        // ------------------------------------------------

        let savedUser =
          await getUserById(
            createdUser.id
          );

        if (!savedUser) {

          throw new Error(
            'User was created but could not be loaded from Supabase.'
          );

        }

        // =================================================
        // PROCESS REFERRAL
        // =================================================

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

              console.log(
                'Telegram referral processed:',
                {
                  referrer:
                    referrer.id,

                  newUser:
                    savedUser.id
                }
              );

            } else {

              console.log(
                'Telegram referral code not found or self-referral:',
                cleanRefInput
              );

            }

          } catch (referralError) {

            // Do not destroy the user's signup
            // if referral processing has a problem.

            console.error(
              'Telegram referral processing error:',
              referralError
            );

          }

        }

        // ------------------------------------------------
        // RELOAD FINAL USER
        // ------------------------------------------------

        user =
          await loadUserData(
            await getUserById(
              savedUser.id
            )
          );

        // ------------------------------------------------
        // CREATE SESSION
        // ------------------------------------------------

        const sessionToken =
          createSessionToken(
            user
          );

        setSessionCookie(
          res,
          sessionToken
        );

        // ------------------------------------------------
        // TELEGRAM ADMIN NOTIFICATION
        // ------------------------------------------------

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

        console.log(
          'Existing user found:',
          user.id
        );

        // ------------------------------------------------
        // UPDATE TELEGRAM INFORMATION
        // ------------------------------------------------

        let shouldUpdate =
          false;

        // Always keep the Telegram ID attached
        // to this account.

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

        // Update full name from Telegram.

        if (
          fullName &&
          user.fullName !== fullName
        ) {

          user.fullName =
            fullName;

          shouldUpdate =
            true;

        }

        // ------------------------------------------------
        // SAFELY UPDATE USERNAME
        // ------------------------------------------------
        //
        // Because username is UNIQUE in Supabase,
        // first make sure another account does not
        // already own this username.
        // ------------------------------------------------

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

            // Telegram-generated internal email
            // should only be changed when it is still
            // the old Telegram-generated email.
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

          } else {

            console.log(
              'Telegram username belongs to another account. Keeping existing username.',
              {
                requested:
                  cleanUsername,

                existing:
                  user.username
              }
            );

          }

        }

        // ------------------------------------------------
        // ENSURE REQUIRED ACCOUNT VALUES
        // ------------------------------------------------

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

        // ------------------------------------------------
        // ENSURE WELCOME BONUS
        // ------------------------------------------------

        await ensureWelcomeBonus(
          user
        );

        // ------------------------------------------------
        // UPDATE SESSION VERSION
        // ------------------------------------------------

        user.sessionVersion =
          number(
            user.sessionVersion
          ) + 1;

        shouldUpdate =
          true;

        // ------------------------------------------------
        // SAVE CHANGES TO SUPABASE
        // ------------------------------------------------

        if (shouldUpdate) {

          await updateUser(
            user
          );

        }

        // ------------------------------------------------
        // RELOAD USER FROM SUPABASE
        // ------------------------------------------------

        user =
          await loadUserData(
            await getUserById(
              user.id
            )
          );

      }

      // ==================================================
      // CREATE LOGIN SESSION
      // ==================================================

      const sessionToken =
        createSessionToken(
          user
        );

      setSessionCookie(
        res,
        sessionToken
      );

      // ==================================================
      // FINAL RESPONSE
      // ==================================================

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

    // ====================================================
    // ERROR HANDLER
    // ====================================================

    catch (err) {

      console.error(
        'Telegram signup error:',
        err
      );

      // --------------------------------------------------
      // SUPABASE UNIQUE CONSTRAINT ERROR
      // --------------------------------------------------

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

      // --------------------------------------------------
      // SUPABASE ERROR
      // --------------------------------------------------

      if (
        err &&
        err.message
      ) {

        console.error(
          'Telegram signup error message:',
          err.message
        );

      }

      // --------------------------------------------------
      // GENERIC SERVER ERROR
      // --------------------------------------------------

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
