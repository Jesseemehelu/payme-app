const express = require('express');
const cors = require('cors');
const path = require('path');
const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');

const app = express();

// ======================================================
// RENDER / PRODUCTION
// ======================================================

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

const TELEGRAM_BOT_TOKEN =
  process.env.TELEGRAM_BOT_TOKEN || '';

const TELEGRAM_CHAT_ID =
  process.env.TELEGRAM_CHAT_ID || '';

const SUPABASE_URL =
  process.env.SUPABASE_URL || '';

const SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SERVICE_KEY ||
  '';

if (
  !SUPABASE_URL ||
  !SUPABASE_SERVICE_ROLE_KEY
) {
  console.error(
    'ERROR: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be configured in Render.'
  );
}

const supabase = createClient(
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  }
);

const SESSION_SECRET =
  process.env.PAYME_SESSION_SECRET ||
  'sess_sec_9qW2$vL5%nQ8@wZ3_8f8b2c7d4';

const SESSION_MAX_AGE =
  10 * 365 * 24 * 60 * 60 * 1000;

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
  24 * 60 * 60 * 1000;

// ======================================================
// DATABASE HELPERS
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

function generateTransactionId(prefix) {

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
    attempt < 20;
    attempt++
  ) {

    const code =
      generateReferralCode();

    const {
      data,
      error
    } = await supabase
      .from('users')
      .select('id')
      .eq('referral_code', code)
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

// ======================================================
// NORMALIZE SUPABASE USER
// ======================================================

function normalizeUser(row) {

  if (!row) {
    return null;
  }

  const dailyReward =
    row.daily_reward &&
    typeof row.daily_reward === 'object'
      ? row.daily_reward
      : {};

  if (!dailyReward.currentDay) {
    dailyReward.currentDay = 1;
  }

  if (
    !dailyReward.lastClaimTimestamp
  ) {
    dailyReward.lastClaimTimestamp = 0;
  }

  if (
    !Number.isFinite(
      Number(dailyReward.freeSpins)
    )
  ) {
    dailyReward.freeSpins = 0;
  }

  return {

    ...row,

    id:
      row.id,

    telegramId:
      row.telegram_id,

    fullName:
      row.full_name,

    email:
      row.email,

    username:
      row.username,

    phone:
      row.phone,

    password:
      row.password,

    balance:
      Number(row.balance || 0),

    depositBalance:
      Number(row.deposit_balance || 0),

    withdrawableBalance:
      Number(row.withdrawable_balance || 0),

    hasReceivedWelcomeBonus:
      !!row.has_received_welcome_bonus,

    hasSeenPopup:
      !!row.has_seen_popup,

    referralCode:
      row.referral_code,

    referredBy:
      row.referred_by,

    totalReferrals:
      Number(row.total_referrals || 0),

    successfulReferrals:
      Number(row.successful_referrals || 0),

    referralEarnings:
      Number(row.referral_earnings || 0),

    freeSpins:
      Number(dailyReward.freeSpins || 0),

    hasClaimedGiftBox:
      !!row.has_claimed_gift_box,

    sessionVersion:
      Number(row.session_version || 0),

    dailyReward

  };

}

// ======================================================
// USER -> SUPABASE FORMAT
// ======================================================

function toDbUserFields(user) {

  const dailyReward = {

    ...(user.dailyReward || {}),

    currentDay:
      Number(
        user.dailyReward?.currentDay || 1
      ),

    lastClaimTimestamp:
      Number(
        user.dailyReward?.lastClaimTimestamp || 0
      ),

    freeSpins:
      Number(user.freeSpins || 0)

  };

  return {

    telegram_id:
      user.telegramId ?? null,

    full_name:
      user.fullName ?? null,

    email:
      user.email ?? null,

    username:
      user.username ?? null,

    phone:
      user.phone ?? null,

    password:
      user.password ?? null,

    balance:
      Number(user.balance || 0),

    deposit_balance:
      Number(user.depositBalance || 0),

    withdrawable_balance:
      Number(user.withdrawableBalance || 0),

    has_received_welcome_bonus:
      !!user.hasReceivedWelcomeBonus,

    has_seen_popup:
      !!user.hasSeenPopup,

    referral_code:
      user.referralCode ?? null,

    referred_by:
      user.referredBy ?? null,

    total_referrals:
      Number(user.totalReferrals || 0),

    successful_referrals:
      Number(user.successfulReferrals || 0),

    referral_earnings:
      Number(user.referralEarnings || 0),

    has_claimed_gift_box:
      !!user.hasClaimedGiftBox,

    session_version:
      Number(user.sessionVersion || 0),

    daily_reward:
      dailyReward

  };

}

// ======================================================
// BALANCE HELPERS
// ======================================================

function syncUserBalance(user) {

  user.depositBalance =
    Math.max(
      0,
      Number(
        user.depositBalance || 0
      )
    );

  user.withdrawableBalance =
    Math.max(
      0,
      Number(
        user.withdrawableBalance || 0
      )
    );

  user.balance =
    user.depositBalance +
    user.withdrawableBalance;

  return user.balance;

}

// ======================================================
// UPDATE USER
// ======================================================

async function updateUser(user) {

  syncUserBalance(user);

  const {
    data,
    error
  } = await supabase
    .from('users')
    .update(
      toDbUserFields(user)
    )
    .eq('id', user.id)
    .select('*')
    .single();

  if (error) {
    throw error;
  }

  return normalizeUser(data);

}

// ======================================================
// INSERT USER
// ======================================================

async function insertUser(user) {

  syncUserBalance(user);

  const row = {

    id:
      user.id,

    ...toDbUserFields(user),

    created_at:
      user.createdAt ||
      new Date().toISOString()

  };

  const {
    data,
    error
  } = await supabase
    .from('users')
    .insert(row)
    .select('*')
    .single();

  if (error) {
    throw error;
  }

  return normalizeUser(data);

}

// ======================================================
// GET USER BY ID
// ======================================================

async function getUserById(id) {

  if (!id) {
    return null;
  }

  const {
    data,
    error
  } = await supabase
    .from('users')
    .select('*')
    .eq('id', id)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return normalizeUser(data);

}

// ======================================================
// GET USER BY USERNAME
// ======================================================

async function getUserByUsername(username) {

  if (!username) {
    return null;
  }

  const {
    data,
    error
  } = await supabase
    .from('users')
    .select('*')
    .eq('username', username)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return normalizeUser(data);

}

// ======================================================
// GET USER BY EMAIL
// ======================================================

async function getUserByEmail(email) {

  if (!email) {
    return null;
  }

  const {
    data,
    error
  } = await supabase
    .from('users')
    .select('*')
    .eq('email', email)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return normalizeUser(data);

}

// ======================================================
// GET USER BY TELEGRAM ID
// ======================================================

async function getUserByTelegramId(
  telegramId
) {

  if (!telegramId) {
    return null;
  }

  const {
    data,
    error
  } = await supabase
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

  return normalizeUser(data);

}

// ======================================================
// GET USER BY REFERRAL CODE
// ======================================================

async function getUserByReferralCode(
  code
) {

  if (!code) {
    return null;
  }

  const {
    data,
    error
  } = await supabase
    .from('users')
    .select('*')
    .eq(
      'referral_code',
      code
    )
    .maybeSingle();

  if (error) {
    throw error;
  }

  return normalizeUser(data);

}

// ======================================================
// TRANSACTIONS
// ======================================================

function mapTransactionFromDb(row) {

  return {

    id:
      row.id,

    type:
      row.type,

    description:
      row.description,

    amount:
      Number(row.amount || 0),

    currency:
      row.currency || 'NGN',

    status:
      row.status,

    bank:
      row.bank,

    accountName:
      row.account_name,

    accountNumber:
      row.account_number,

    createdAt:
      row.created_at

  };

}

async function getTransactions(userId) {

  const {
    data,
    error
  } = await supabase
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
    );

  if (error) {
    throw error;
  }

  return (
    data || []
  ).map(
    mapTransactionFromDb
  );

}

// ======================================================
// ADD TRANSACTION
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
      tx.type || null,

    description:
      tx.description || null,

    amount:
      Number(tx.amount || 0),

    currency:
      tx.currency || 'NGN',

    status:
      tx.status || null,

    bank:
      tx.bank || null,

    account_name:
      tx.accountName || null,

    account_number:
      tx.accountNumber || null,

    created_at:
      tx.createdAt ||
      new Date().toISOString()

  };

  const {
    data,
    error
  } = await supabase
    .from('transactions')
    .insert(row)
    .select('*')
    .single();

  if (error) {
    throw error;
  }

  return mapTransactionFromDb(data);

}

// ======================================================
// DEPOSITS
// ======================================================

function mapDepositFromDb(row) {

  return {

    reference:
      row.reference,

    amount:
      Number(row.amount || 0),

    status:
      row.status,

    screenshot:
      row.screenshot,

    reason:
      row.reason,

    createdAt:
      row.created_at

  };

}

async function getDeposits(userId) {

  const {
    data,
    error
  } = await supabase
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
    mapDepositFromDb
  );

}

async function getDeposit(
  userId,
  reference
) {

  const {
    data,
    error
  } = await supabase
    .from('deposits')
    .select('*')
    .eq(
      'user_id',
      userId
    )
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
// SESSION SYSTEM
// ======================================================

function base64UrlEncode(value) {

  return Buffer
    .from(value)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

}

function base64UrlDecode(value) {

  value =
    value
      .replace(/-/g, '+')
      .replace(/_/g, '/');

  while (
    value.length % 4
  ) {
    value += '=';
  }

  return Buffer
    .from(
      value,
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
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

}

function createSessionToken(
  user
) {

  const payloadObject = {

    userId:
      user.id,

    sessionVersion:
      Number(
        user.sessionVersion || 0
      ),

    expiresAt:
      Date.now() +
      SESSION_MAX_AGE

  };

  const payload =
    base64UrlEncode(
      JSON.stringify(
        payloadObject
      )
    );

  return (
    `${payload}.${createSignature(payload)}`
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

    const payload =
      parts[0];

    const provided =
      Buffer.from(
        parts[1]
      );

    const expected =
      Buffer.from(
        createSignature(
          payload
        )
      );

    if (
      provided.length !==
      expected.length
    ) {
      return null;
    }

    if (
      !crypto.timingSafeEqual(
        provided,
        expected
      )
    ) {
      return null;
    }

    const decoded =
      JSON.parse(
        base64UrlDecode(
          payload
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
      Number(
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

  const cookieHeader =
    req.headers.cookie;

  if (!cookieHeader) {
    return null;
  }

  for (
    const cookie of
    cookieHeader.split(';')
  ) {

    const separatorIndex =
      cookie.indexOf('=');

    if (
      separatorIndex === -1
    ) {
      continue;
    }

    const key =
      cookie
        .slice(
          0,
          separatorIndex
        )
        .trim();

    if (
      key !== name
    ) {
      continue;
    }

    const value =
      cookie
        .slice(
          separatorIndex + 1
        )
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

  const cookieParts = [

    `payme_session=${encodeURIComponent(token)}`,

    'Path=/',

    `Max-Age=${Math.floor(
      SESSION_MAX_AGE / 1000
    )}`,

    'HttpOnly',

    'SameSite=Lax'

  ];

  if (isProduction) {
    cookieParts.push('Secure');
  }

  res.setHeader(
    'Set-Cookie',
    cookieParts.join('; ')
  );

}

function clearSessionCookie(
  res
) {

  const cookieParts = [

    'payme_session=',

    'Path=/',

    'Max-Age=0',

    'HttpOnly',

    'SameSite=Lax'

  ];

  if (isProduction) {
    cookieParts.push('Secure');
  }

  res.setHeader(
    'Set-Cookie',
    cookieParts.join('; ')
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

    const sessionData =
      verifySessionToken(
        token
      );

    if (!sessionData) {

      clearSessionCookie(res);

      return next();

    }

    const user =
      await getUserById(
        sessionData.userId
      );

    if (!user) {

      clearSessionCookie(res);

      return next();

    }

    if (
      Number(
        user.sessionVersion || 0
      ) !==
      Number(
        sessionData.sessionVersion || 0
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
      user;

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

  try {

    const user =
      await getUserById(
        req.session.userId
      );

    if (!user) {

      clearSessionCookie(res);

      return res.status(401).json({

        success:
          false,

        message:
          'User session not found.'

      });

    }

    req.user =
      user;

    return next();

  } catch (err) {

    console.error(
      'Require login error:',
      err
    );

    return res.status(500).json({

      success:
        false,

      message:
        'Authentication error.'

    });

  }

}

// ======================================================
// TELEGRAM API
// ======================================================

async function sendTelegramNotification(
  message
) {

  if (
    !TELEGRAM_BOT_TOKEN ||
    !TELEGRAM_CHAT_ID
  ) {

    console.warn(
      'Telegram environment variables are not configured.'
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
// TELEGRAM WEB APP VERIFICATION
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

    const authDate =
      Number(
        params.get('auth_date') || 0
      );

    if (!authDate) {
      return null;
    }

    const age =
      Math.floor(
        Date.now() / 1000
      ) -
      authDate;

    if (
      age < 0 ||
      age > 86400
    ) {
      return null;
    }

    const userString =
      params.get('user');

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
// USER HELPERS
// ======================================================

function getDepositBalance(
  user
) {

  return Math.max(
    0,
    Number(
      user.depositBalance || 0
    )
  );

}

function getWithdrawableBalance(
  user
) {

  return Math.max(
    0,
    Number(
      user.withdrawableBalance || 0
    )
  );

}

// ======================================================
// FREE SPINS
// Stored inside daily_reward JSONB because the
// supplied users table has no free_spins column.
// ======================================================

function getFreeSpins(
  user
) {

  return Math.max(
    0,
    Number(
      user.freeSpins ||
      user.dailyReward?.freeSpins ||
      0
    )
  );

}

function setFreeSpins(
  user,
  value
) {

  user.freeSpins =
    Math.max(
      0,
      Number(value || 0)
    );

  user.dailyReward = {

    ...(user.dailyReward || {}),

    freeSpins:
      user.freeSpins

  };

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
    return user;
  }

  user.withdrawableBalance =
    Number(
      user.withdrawableBalance || 0
    ) +
    WELCOME_BONUS;

  user.hasReceivedWelcomeBonus =
    true;

  syncUserBalance(user);

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

  return updateUser(user);

}

// ======================================================
// REFERRAL PROCESSING
// ======================================================

async function processReferral(
  referrer,
  newUser
) {

  if (
    !referrer ||
    referrer.id === newUser.id
  ) {
    return;
  }

  const confirmedAt =
    new Date().toISOString();

  referrer.withdrawableBalance =
    Number(
      referrer.withdrawableBalance || 0
    ) +
    REFERRAL_REWARD;

  referrer.totalReferrals =
    Number(
      referrer.totalReferrals || 0
    ) +
    1;

  referrer.successfulReferrals =
    Number(
      referrer.successfulReferrals || 0
    ) +
    1;

  referrer.referralEarnings =
    Number(
      referrer.referralEarnings || 0
    ) +
    REFERRAL_REWARD;

  syncUserBalance(
    referrer
  );

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
        fullName.trim().length < 2
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
        !email.includes('@')
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
        username.trim().length < 3
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
        phone.trim().length < 7
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
        password.length < 8
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
        username
          .trim()
          .toLowerCase();

      const cleanEmail =
        email
          .trim()
          .toLowerCase();

      const cleanPhone =
        `${countryCode || '+234'}${phone.trim()}`;

      const cleanRefInput =
        referralCode
          ? referralCode
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

      const newUser =
        normalizeUser({

          id:
            generateUserId(),

          telegram_id:
            null,

          full_name:
            fullName.trim(),

          email:
            cleanEmail,

          username:
            cleanUsername,

          phone:
            cleanPhone,

          password,

          balance:
            0,

          deposit_balance:
            0,

          withdrawable_balance:
            0,

          has_received_welcome_bonus:
            false,

          has_seen_popup:
            false,

          referral_code:
            await generateUniqueReferralCode(),

          referred_by:
            cleanRefInput,

          total_referrals:
            0,

          successful_referrals:
            0,

          referral_earnings:
            0,

          has_claimed_gift_box:
            false,

          session_version:
            1,

          daily_reward: {

            currentDay:
              1,

            lastClaimTimestamp:
              0,

            freeSpins:
              0

          },

          created_at:
            new Date().toISOString()

        });

      await insertUser(
        newUser
      );

      let savedUser =
        await getUserById(
          newUser.id
        );

      savedUser =
        await ensureWelcomeBonus(
          savedUser
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

          savedUser =
            await getUserById(
              savedUser.id
            );

        }

      }

      savedUser.sessionVersion =
        1;

      savedUser =
        await updateUser(
          savedUser
        );

      setSessionCookie(
        res,
        createSessionToken(
          savedUser
        )
      );

      sendTelegramNotification(

        `🆕 <b>NEW USER REGISTERED</b>\n\n` +

        `👤 <b>Name:</b> ${savedUser.fullName}\n` +

        `🆔 <b>Username:</b> @${savedUser.username}\n` +

        `📧 <b>Email:</b> ${savedUser.email}\n` +

        `📱 <b>Phone:</b> ${savedUser.phone}\n` +

        `🎁 <b>Welcome Bonus:</b> ₦${WELCOME_BONUS}\n` +

        `🔗 <b>Referral Code:</b> ${savedUser.referralCode}\n` +

        `👥 <b>Referred By:</b> ${savedUser.referredBy || 'None'}\n` +

        `💰 <b>Balance:</b> ₦${savedUser.balance.toFixed(2)}\n` +

        `💵 <b>Earnings:</b> ₦${savedUser.withdrawableBalance.toFixed(2)}\n` +

        `💳 <b>Deposit Balance:</b> ₦${savedUser.depositBalance.toFixed(2)}`

      ).catch(() => {});

      return res.json({

        success:
          true,

        message:
          'Signup successful',

        user: {

          id:
            savedUser.id,

          fullName:
            savedUser.fullName,

          username:
            savedUser.username,

          balance:
            savedUser.balance,

          withdrawableBalance:
            savedUser.withdrawableBalance,

          depositBalance:
            savedUser.depositBalance

        }

      });

    } catch (err) {

      console.error(
        'Signup error:',
        err
      );

      if (
        err?.code ===
        '23505'
      ) {

        return res.status(400).json({

          success:
            false,

          message:
            'Username, email, Telegram ID, or referral code is already in use.'

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
// TELEGRAM SIGNUP / AUTHENTICATION
// ======================================================

app.post(
  '/api/auth/telegram-signup',
  async (req, res) => {

    try {

      const {
        telegramId,
        username,
        firstName,
        lastName,
        referralCode
      } = req.body;

      if (!telegramId) {

        return res.status(400).json({

          success:
            false,

          message:
            'Telegram account information could not be detected.'

        });

      }

      const cleanTelegramId =
        String(
          telegramId
        );

      const cleanUsername =
        String(
          username ||
          `user_${cleanTelegramId}`
        )
          .trim()
          .replace(
            /^@/,
            ''
          )
          .toLowerCase();

      const cleanFirstName =
        String(
          firstName || ''
        ).trim();

      const cleanLastName =
        String(
          lastName || ''
        ).trim();

      const cleanRefInput =
        referralCode
          ? String(
              referralCode
            )
              .trim()
              .toUpperCase()
          : null;

      const fullName =
        `${cleanFirstName} ${cleanLastName}`
          .trim() ||
        cleanUsername;

      let user =
        await getUserByTelegramId(
          cleanTelegramId
        );

      if (
        !user &&
        cleanUsername
      ) {

        user =
          await getUserByUsername(
            cleanUsername
          );

      }

      if (!user) {

        user =
          normalizeUser({

            id:
              generateUserId(),

            telegram_id:
              cleanTelegramId,

            full_name:
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

            deposit_balance:
              0,

            withdrawable_balance:
              0,

            has_received_welcome_bonus:
              false,

            has_seen_popup:
              false,

            referral_code:
              await generateUniqueReferralCode(),

            referred_by:
              cleanRefInput,

            total_referrals:
              0,

            successful_referrals:
              0,

            referral_earnings:
              0,

            has_claimed_gift_box:
              false,

            session_version:
              0,

            daily_reward: {

              currentDay:
                1,

              lastClaimTimestamp:
                0,

              freeSpins:
                0

            },

            created_at:
              new Date().toISOString()

          });

        await insertUser(
          user
        );

        user =
          await getUserById(
            user.id
          );

        user =
          await ensureWelcomeBonus(
            user
          );

        if (
          user.referredBy
        ) {

          const referrer =
            await getUserByReferralCode(
              user.referredBy
            );

          if (
            referrer &&
            referrer.id !==
            user.id
          ) {

            await processReferral(
              referrer,
              user
            );

          }

        }

        sendTelegramNotification(

          `<b>NEW TELEGRAM USER REGISTERED</b>\n\n` +

          `<b>Name:</b> ${user.fullName}\n` +

          `<b>Username:</b> @${user.username}\n` +

          `<b>Telegram ID:</b> ${user.telegramId}\n` +

          `<b>Welcome Bonus:</b> ₦${WELCOME_BONUS}\n` +

          `<b>Referral Code:</b> ${user.referralCode}\n` +

          `<b>Referred By:</b> ${user.referredBy || 'None'}\n` +

          `<b>Balance:</b> ₦${Number(user.balance).toFixed(2)}`

        ).catch(() => {});

      } else {

        user.telegramId =
          cleanTelegramId;

        if (fullName) {

          user.fullName =
            fullName;

        }

        if (
          cleanUsername &&
          !cleanUsername.startsWith(
            'user_'
          )
        ) {

          user.username =
            cleanUsername;

        }

      }

      user =
        await ensureWelcomeBonus(
          user
        );

      user.sessionVersion =
        Number(
          user.sessionVersion || 0
        ) +
        1;

      user =
        await updateUser(
          user
        );

      setSessionCookie(
        res,
        createSessionToken(
          user
        )
      );

      return res.json({

        success:
          true,

        message:
          'Telegram authentication successful',

        user: {

          id:
            user.id,

          telegramId:
            user.telegramId,

          fullName:
            user.fullName,

          username:
            user.username,

          balance:
            user.balance,

          withdrawableBalance:
            user.withdrawableBalance,

          depositBalance:
            user.depositBalance,

          referralCode:
            user.referralCode

        }

      });

    } catch (err) {

      console.error(
        'Telegram signup error:',
        err
      );

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
// CHECK USER
// ======================================================

app.get(
  '/api/auth/check-user',
  async (req, res) => {

    try {

      const {
        telegramId
      } = req.query;

      if (!telegramId) {

        return res.json({
          exists: false
        });

      }

      const user =
        await getUserByTelegramId(
          String(
            telegramId
          ).trim()
        );

      if (!user) {

        return res.json({
          exists: false
        });

      }

      return res.json({

        exists:
          true,

        username:
          user.username,

        fullName:
          user.fullName

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
        loginIdentifier
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
        password
      ) {

        return res.status(401).json({

          success:
            false,

          message:
            'Invalid credentials.'

        });

      }

      user =
        await ensureWelcomeBonus(
          user
        );

      user.sessionVersion =
        Number(
          user.sessionVersion || 0
        ) +
        1;

      user =
        await updateUser(
          user
        );

      setSessionCookie(
        res,
        createSessionToken(
          user
        )
      );

      sendTelegramNotification(

        `🔐 <b>USER LOGIN ALERT</b>\n\n` +

        `👤 <b>Name:</b> ${user.fullName}\n` +

        `🆔 <b>Username:</b> @${user.username}\n` +

        `💰 <b>Current Balance:</b> ₦${user.balance.toFixed(2)}\n` +

        `💵 <b>Earnings:</b> ₦${user.withdrawableBalance.toFixed(2)}\n` +

        `💳 <b>Deposit Balance:</b> ₦${user.depositBalance.toFixed(2)}`

      ).catch(() => {});

      return res.json({

        success:
          true,

        message:
          'Login successful',

        user: {

          id:
            user.id,

          fullName:
            user.fullName,

          username:
            user.username,

          balance:
            user.balance,

          withdrawableBalance:
            user.withdrawableBalance,

          depositBalance:
            user.depositBalance

        }

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
            Number(
              user.sessionVersion || 0
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

      let user =
        req.user;

      const withdrawable =
        getWithdrawableBalance(
          user
        );

      const withdrawnAmount =
        Number(
          amount
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
        Number(
          user.balance || 0
        );

      user.withdrawableBalance =
        withdrawable -
        withdrawnAmount;

      user =
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

        `🚨 <b>NEW WITHDRAWAL REQUEST</b> 🚨\n\n` +

        `👤 <b>User:</b> @${user.username || 'User'}\n` +

        `💰 <b>Amount:</b> ₦${withdrawnAmount.toLocaleString()}\n` +

        `📉 <b>Old Balance:</b> ₦${oldBalance.toLocaleString()}\n` +

        `🔄 <b>New Balance:</b> ₦${Number(user.balance).toLocaleString()}\n` +

        `💵 <b>Earnings Remaining:</b> ₦${Number(user.withdrawableBalance).toLocaleString()}\n` +

        `💳 <b>Deposit Balance:</b> ₦${Number(user.depositBalance).toLocaleString()}\n\n` +

        `🏦 <b>BANK DETAILS</b>\n` +

        `• <b>Account Name:</b> ${accountName}\n` +

        `• <b>Bank:</b> ${bankName}\n` +

        `• <b>Account No:</b> ${accountNumber}`

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
// GAME PAGE
// ======================================================

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

// ======================================================
// TELEGRAM CHANNEL GIFT
// ======================================================

app.post(
  '/api/user/verify-telegram-join',
  requireLogin,
  async (req, res) => {

    try {

      let user =
        req.user;

      const isLocal =
        req.body?.isLocal ||
        process.env.NODE_ENV !== 'production';

      if (isLocal) {

        if (
          !user.hasClaimedGiftBox
        ) {

          user.hasClaimedGiftBox =
            true;

          setFreeSpins(
            user,
            getFreeSpins(user) + 1
          );

          user =
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
            getFreeSpins(user)

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
            'Telegram bot is not configured.'

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

          setFreeSpins(
            user,
            getFreeSpins(user) + 1
          );

          user =
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
            getFreeSpins(user)

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

      const user =
        req.user;

      const transactions =
        await getTransactions(
          user.id
        );

      const spins =
        transactions.filter(
          t =>
            t.type &&
            t.type.includes(
              'Spin'
            )
        );

      return res.json({

        success:
          true,

        balance:
          user.balance,

        withdrawableBalance:
          user.withdrawableBalance,

        depositBalance:
          user.depositBalance,

        spins,

        freeSpins:
          getFreeSpins(user),

        hasClaimedGiftBox:
          !!user.hasClaimedGiftBox

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

      let user =
        req.user;

      let usedFreeSpin =
        false;

      if (
        getFreeSpins(user) > 0
      ) {

        setFreeSpins(
          user,
          getFreeSpins(user) - 1
        );

        usedFreeSpin =
          true;

      } else {

        if (
          Number(
            user.balance || 0
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

        let remainingSpinCost =
          SPIN_COST;

        const currentDepositBalance =
          getDepositBalance(
            user
          );

        const currentEarnings =
          getWithdrawableBalance(
            user
          );

        if (
          currentDepositBalance >=
          remainingSpinCost
        ) {

          user.depositBalance =
            currentDepositBalance -
            remainingSpinCost;

        } else {

          remainingSpinCost -=
            currentDepositBalance;

          user.depositBalance =
            0;

          user.withdrawableBalance =
            currentEarnings -
            remainingSpinCost;

        }

        user =
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

            status:
              'completed',

            description:
              'Spin Entry'

          }
        );

      }

      const prizes = [

        {
          amount:
            0,

          weight:
            2000,

          label:
            'NO'

        },

        {
          amount:
            10,

          weight:
            2500,

          label:
            '₦10'

        },

        {
          amount:
            20,

          weight:
            2500,

          label:
            '₦20'

        },

        {
          amount:
            50,

          weight:
            1800,

          label:
            '₦50'

        },

        {
          amount:
            100,

          weight:
            800,

          label:
            '₦100'

        },

        {
          amount:
            250,

          weight:
            250,

          label:
            '₦250'

        },

        {
          amount:
            500,

          weight:
            100,

          label:
            '₦500'

        },

        {
          amount:
            1000,

          weight:
            45,

          label:
            '₦1000'

        },

        {
          amount:
            2000,

          weight:
            5,

          label:
            '₦2000'

        }

      ];

      const totalWeight =
        prizes.reduce(
          (
            total,
            prize
          ) =>
            total +
            prize.weight,
          0
        );

      const randomWeight =
        Math.floor(
          Math.random() *
          totalWeight
        );

      let cumulativeWeight =
        0;

      let selectedPrize =
        prizes[0];

      for (
        const prize of
        prizes
      ) {

        cumulativeWeight +=
          prize.weight;

        if (
          randomWeight <
          cumulativeWeight
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
          Number(
            user.withdrawableBalance || 0
          ) +
          Number(
            selectedPrize.amount
          );

      }

      user =
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

          status:
            'completed',

          description:
            usedFreeSpin
              ? 'Free Spin Reward'
              : 'Spin Reward'

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
            t.type.includes(
              'Spin'
            )
        );

      return res.json({

        success:
          true,

        usedFreeSpin,

        freeSpins:
          getFreeSpins(user),

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
// DEPOSIT PAGE
// ======================================================

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
// GET USER DEPOSITS
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
          await getDeposits(
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

      const {
        amount,
        screenshot
      } = req.body;

      const depositAmount =
        Number(
          amount
        );

      if (
        !Number.isFinite(
          depositAmount
        ) ||
        depositAmount <
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
        screenshot.match(
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

      const user =
        req.user;

      const reference =
        'PM-' +
        crypto
          .randomBytes(4)
          .toString('hex')
          .toUpperCase();

      const {
        error: insertError
      } = await supabase
        .from('deposits')
        .insert({

          reference,

          user_id:
            user.id,

          amount:
            depositAmount,

          status:
            'Pending Verification',

          screenshot,

          reason:
            null,

          created_at:
            new Date().toISOString()

        });

      if (insertError) {
        throw insertError;
      }

      const imageType =
        matches[1];

      const base64Data =
        matches[2];

      const imageBuffer =
        Buffer.from(
          base64Data,
          'base64'
        );

      const caption =

        `📥 <b>NEW DEPOSIT REQUEST</b>\n\n` +

        `👤 <b>Name:</b> ${user.fullName}\n` +

        `🆔 <b>Username:</b> @${user.username}\n` +

        `📧 <b>Email:</b> ${user.email}\n` +

        `💰 <b>Amount:</b> ₦${depositAmount.toLocaleString()}\n` +

        `🔖 <b>Reference:</b> ${reference}\n` +

        `⏳ <b>Status:</b> Pending Verification`;

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

      const imageBlob =
        new Blob(
          [imageBuffer],
          {
            type:
              `image/${imageType}`
          }
        );

      formData.append(
        'photo',
        imageBlob,
        `deposit-${reference}.${imageType}`
      );

      formData.append(
        'reply_markup',
        JSON.stringify({

          inline_keyboard: [

            [

              {

                text:
                  '✅ APPROVE',

                callback_data:
                  `approve_deposit:${user.id}:${reference}`

              },

              {

                text:
                  '❌ REJECT',

                callback_data:
                  `reject_deposit:${user.id}:${reference}`

              }

            ]

          ]

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
          'Deposit saved, but Telegram notification failed.'

      });

    }

  }
);

// ======================================================
// ADMIN DEPOSIT VERIFICATION
// ======================================================

async function verifyDepositAction({
  userId,
  reference,
  action,
  reason
}) {

  const deposit =
    await getDeposit(
      userId,
      reference
    );

  if (!deposit) {

    return {

      error:
        'Deposit not found or already verified.',

      status:
        400

    };

  }

  if (
    deposit.status !==
    'Pending Verification'
  ) {

    return {

      error:
        'Deposit not found or already verified.',

      status:
        400

    };

  }

  if (
    action ===
    'approve'
  ) {

    const amount =
      Number(
        deposit.amount || 0
      );

    const user =
      await getUserById(
        userId
      );

    if (!user) {

      return {

        error:
          'User not found.',

        status:
          404

      };

    }

    const {
      data:
        updatedDeposit,
      error:
        depositError
    } = await supabase
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
      )
      .eq(
        'user_id',
        userId
      )
      .eq(
        'status',
        'Pending Verification'
      )
      .select('*')
      .maybeSingle();

    if (depositError) {
      throw depositError;
    }

    if (!updatedDeposit) {

      return {

        error:
          'Deposit was already processed.',

        status:
          409

      };

    }

    user.depositBalance =
      Number(
        user.depositBalance || 0
      ) +
      amount;

    await updateUser(
      user
    );

    await addTransaction(
      user.id,
      {

        id:
          generateTransactionId(
            'tx_deposit'
          ),

        type:
          'Deposit Approved',

        description:
          `Deposit ${reference}`,

        amount:
          amount,

        currency:
          'NGN',

        bank:
          'PalmPay',

        status:
          'completed'

      }
    );

    return {

      deposit:
        mapDepositFromDb(
          updatedDeposit
        ),

      user:
        await getUserById(
          userId
        )

    };

  }

  if (
    action ===
    'reject'
  ) {

    const {
      data:
        updatedDeposit,
      error
    } = await supabase
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
      )
      .eq(
        'user_id',
        userId
      )
      .eq(
        'status',
        'Pending Verification'
      )
      .select('*')
      .maybeSingle();

    if (error) {
      throw error;
    }

    if (!updatedDeposit) {

      return {

        error:
          'Deposit was already processed.',

        status:
          409

      };

    }

    return {

      deposit:
        mapDepositFromDb(
          updatedDeposit
        ),

      user:
        await getUserById(
          userId
        )

    };

  }

  return {

    error:
      'Invalid action. Use approve or reject.',

    status:
      400

  };

}

app.post(
  '/api/admin/deposits/verify',
  async (req, res) => {

    try {

      const {
        adminSecret,
        userId,
        reference,
        action,
        reason
      } = req.body;

      const expectedSecret =
        process.env.PAYME_ADMIN_SECRET ||
        'payme_admin_secret_2026';

      if (
        adminSecret !==
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
        await verifyDepositAction({

          userId,
          reference,
          action,
          reason

        });

      if (
        result.error
      ) {

        return res.status(
          result.status || 400
        ).json({

          success:
            false,

          error:
            result.error

        });

      }

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

      return res.status(500).json({

        success:
          false,

        error:
          'Server error verifying deposit.'

      });

    }

  }
);

// ======================================================
// DASHBOARD API
// ======================================================

app.post(
  '/api/user/dashboard',
  async (req, res) => {

    try {

      let user =
        null;

      if (
        req.session &&
        req.session.userId
      ) {

        user =
          await getUserById(
            req.session.userId
          );

      }

      const {
        telegramId,
        username
      } = req.body || {};

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
            String(
              username
            ).toLowerCase()
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
        String(
          user.telegramId || ''
        ) !==
        String(
          telegramId
        )
      ) {

        user.telegramId =
          String(
            telegramId
          );

        user =
          await updateUser(
            user
          );

      }

      req.session = {
        userId:
          user.id
      };

      setSessionCookie(
        res,
        createSessionToken(
          user
        )
      );

      const wasPopupSeen =
        user.hasSeenPopup;

      user =
        await ensureWelcomeBonus(
          user
        );

      const isNewUser =
        !wasPopupSeen &&
        user.hasReceivedWelcomeBonus;

      if (isNewUser) {

        user.hasSeenPopup =
          true;

        user =
          await updateUser(
            user
          );

      }

      const lastClaim =
        Number(
          user.dailyReward
            ?.lastClaimTimestamp || 0
        );

      const currentDay =
        Number(
          user.dailyReward
            ?.currentDay || 1
        );

      const canClaim =
        lastClaim === 0 ||
        Date.now() -
          lastClaim >=
          CLAIM_COOLDOWN;

      const nextClaimTime =
        canClaim
          ? 0
          : lastClaim +
            CLAIM_COOLDOWN;

      const [
        transactions,
        deposits
      ] =
        await Promise.all([

          getTransactions(
            user.id
          ),

          getDeposits(
            user.id
          )

        ]);

      return res.json({

        success:
          true,

        user: {

          id:
            user.id,

          fullName:
            user.fullName,

          username:
            user.username,

          balance:
            Number(
              user.balance || 0
            ),

          withdrawableBalance:
            Number(
              user.withdrawableBalance || 0
            ),

          depositBalance:
            Number(
              user.depositBalance || 0
            ),

          isNewUser,

          hasClaimedGiftBox:
            !!user.hasClaimedGiftBox,

          referralCode:
            user.referralCode,

          totalReferrals:
            Number(
              user.totalReferrals || 0
            ),

          successfulReferrals:
            Number(
              user.successfulReferrals || 0
            ),

          referralEarnings:
            Number(
              user.referralEarnings || 0
            ),

          minWithdrawalLimit:
            MIN_WITHDRAWAL_LIMIT,

          canWithdraw:
            Number(
              user.withdrawableBalance || 0
            ) >=
            MIN_WITHDRAWAL_LIMIT,

          transactions,

          deposits

        },

        dailyReward: {

          currentDay,

          lastClaimTime:
            lastClaim,

          nextClaimTime,

          canClaim

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
// SERVER ENFORCES DAY 1 -> DAY 2 -> ... -> DAY 7
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
          req.body.day
        );

      const now =
        Date.now();

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
            'Invalid reward day.'

        });

      }

      const lastClaim =
        Number(
          user.dailyReward
            ?.lastClaimTimestamp || 0
        );

      const currentDay =
        Number(
          user.dailyReward
            ?.currentDay || 1
        );

      // ===============================================
      // DATABASE IS THE AUTHORITY
      // ===============================================

      if (
        lastClaim > 0 &&
        now -
          lastClaim <
          CLAIM_COOLDOWN
      ) {

        const remainingMs =
          CLAIM_COOLDOWN -
          (
            now -
            lastClaim
          );

        const hoursLeft =
          Math.ceil(
            remainingMs /
            (
              1000 *
              60 *
              60
            )
          );

        return res.status(400).json({

          success:
            false,

          message:
            `Reward not available yet. Please wait ${hoursLeft} hours.`,

          dailyReward: {

            currentDay,

            lastClaimTime:
              lastClaim,

            nextClaimTime:
              lastClaim +
              CLAIM_COOLDOWN,

            canClaim:
              false

          }

        });

      }

      // ===============================================
      // STRICT SEQUENCE
      // ===============================================

      if (
        reqDay !==
        currentDay
      ) {

        return res.status(400).json({

          success:
            false,

          message:
            `Invalid claim day sequence. The next available day is Day ${currentDay}.`,

          dailyReward: {

            currentDay,

            lastClaimTime:
              lastClaim,

            nextClaimTime:
              lastClaim
                ? lastClaim +
                  CLAIM_COOLDOWN
                : 0,

            canClaim:
              lastClaim === 0 ||
              now -
                lastClaim >=
                CLAIM_COOLDOWN

          }

        });

      }

      // ===============================================
      // DAY 1 - DAY 6
      // ===============================================

      if (
        reqDay >= 1 &&
        reqDay <= 6
      ) {

        user.withdrawableBalance =
          Number(
            user.withdrawableBalance || 0
          ) +
          10;

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

      }

      // ===============================================
      // DAY 7 = FREE SPIN
      // ===============================================

      else {

        setFreeSpins(

          user,

          getFreeSpins(user) + 1

        );

      }

      // ===============================================
      // ADVANCE TO NEXT DAY
      // ===============================================

      user.dailyReward = {

        ...(user.dailyReward || {}),

        currentDay:
          reqDay >= 7
            ? 1
            : reqDay + 1,

        lastClaimTimestamp:
          now,

        freeSpins:
          getFreeSpins(user)

      };

      user =
        await updateUser(
          user
        );

      return res.json({

        success:
          true,

        user: {

          balance:
            user.balance,

          withdrawableBalance:
            user.withdrawableBalance,

          depositBalance:
            user.depositBalance,

          freeSpins:
            getFreeSpins(user)

        },

        dailyReward: {

          currentDay:
            user.dailyReward
              .currentDay,

          lastClaimTime:
            now,

          nextClaimTime:
            now +
            CLAIM_COOLDOWN,

          canClaim:
            false

        }

      });

    } catch (error) {

      console.error(
        'Daily claim server error:',
        error
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
// TELEGRAM CALLBACKS
// ======================================================

let telegramUpdateOffset = 0;

async function answerTelegramCallback(
  callbackId,
  text
) {

  if (
    !TELEGRAM_BOT_TOKEN
  ) {
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

  if (
    !TELEGRAM_BOT_TOKEN
  ) {
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
      callbackQuery.data || '';

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
      parts
        .slice(2)
        .join(':');

    const result =
      await verifyDepositAction({

        userId,

        reference,

        action:
          action ===
          'approve_deposit'
            ? 'approve'
            : 'reject',

        reason:
          'Payment proof was rejected.'

      });

    if (
      result.error
    ) {

      await answerTelegramCallback(

        callbackQuery.id,

        result.error

      );

      return;

    }

    const user =
      result.user;

    const deposit =
      result.deposit;

    if (
      deposit.status ===
      'Approved'
    ) {

      await answerTelegramCallback(

        callbackQuery.id,

        'Deposit approved!'

      );

      await editTelegramMessage(

        callbackQuery.message.chat.id,

        callbackQuery.message.message_id,

        `✅ <b>DEPOSIT APPROVED</b>\n\n` +

        `👤 <b>Name:</b> ${user.fullName}\n` +

        `🆔 <b>Username:</b> @${user.username}\n` +

        `💰 <b>Amount:</b> ₦${Number(
          deposit.amount
        ).toLocaleString()}\n` +

        `🔖 <b>Reference:</b> ${deposit.reference}\n` +

        `💳 <b>New Balance:</b> ₦${Number(
          user.balance
        ).toLocaleString()}\n` +

        `💵 <b>Earnings:</b> ₦${Number(
          user.withdrawableBalance
        ).toLocaleString()}\n` +

        `💳 <b>Deposit Balance:</b> ₦${Number(
          user.depositBalance
        ).toLocaleString()}\n` +

        `✅ <b>Status:</b> Approved`

      );

    } else {

      await answerTelegramCallback(

        callbackQuery.id,

        'Deposit rejected.'

      );

      await editTelegramMessage(

        callbackQuery.message.chat.id,

        callbackQuery.message.message_id,

        `❌ <b>DEPOSIT REJECTED</b>\n\n` +

        `👤 <b>Name:</b> ${user.fullName}\n` +

        `🆔 <b>Username:</b> @${user.username}\n` +

        `💰 <b>Amount:</b> ₦${Number(
          deposit.amount
        ).toLocaleString()}\n` +

        `🔖 <b>Reference:</b> ${deposit.reference}\n` +

        `❌ <b>Status:</b> Rejected\n` +

        `📝 <b>Reason:</b> ${deposit.reason || 'Payment proof was rejected.'}`

      );

    }

  } catch (err) {

    console.error(
      'Telegram callback error:',
      err
    );

  }

}

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
      } = await supabase

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
            user => ({

              username:
                user.username,

              totalReferrals:
                Number(
                  user.total_referrals || 0
                ),

              referralEarnings:
                Number(
                  user.referral_earnings || 0
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

// ======================================================
// WEEKLY DATE HELPERS
// ======================================================

function getCompetitionStart(
  date = new Date()
) {

  const now =
    new Date(date);

  const lagos =
    new Date(
      now.getTime() +
      60 * 60 * 1000
    );

  const day =
    lagos.getUTCDay();

  const daysSinceMonday =
    day === 0
      ? 6
      : day - 1;

  lagos.setUTCDate(
    lagos.getUTCDate() -
    daysSinceMonday
  );

  lagos.setUTCHours(
    0,
    0,
    0,
    0
  );

  return new Date(
    lagos.getTime() -
    60 * 60 * 1000
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

function competitionFromStart(
  start
) {

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
      Date.now() >=
      end.getTime()
        ? 'completed'
        : 'active'

  };

}

function getCurrentCompetition() {

  return competitionFromStart(
    getCompetitionStart()
  );

}

// ======================================================
// WEEKLY REFERRALS FROM SUPABASE
// ======================================================

async function getWeeklyEligibleReferrals(
  referrer,
  competition
) {

  const {
    data,
    error
  } = await supabase

    .from('users')

    .select(
      'id,username,full_name,created_at'
    )

    .eq(
      'referred_by',
      referrer.referralCode
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

  return data || [];

}

// ======================================================
// BUILD WEEKLY LEADERBOARD
// ======================================================

async function buildWeeklyLeaderboard(
  competition
) {

  const {
    data:
      referrers,
    error
  } = await supabase

    .from('users')

    .select(
      'id,username,full_name,referral_code'
    )

    .gt(
      'total_referrals',
      0
    );

  if (error) {
    throw error;
  }

  const leaderboard =
    [];

  for (
    const referrer of
    referrers || []
  ) {

    const normalized =
      normalizeUser(
        referrer
      );

    const events =
      await getWeeklyEligibleReferrals(
        normalized,
        competition
      );

    if (
      !events.length
    ) {
      continue;
    }

    const lastReferralAt =
      events[
        events.length - 1
      ].created_at;

    leaderboard.push({

      userId:
        referrer.id,

      username:
        referrer.username,

      fullName:
        referrer.full_name,

      eligibleReferrals:
        events.length,

      lastReferralAt

    });

  }

  leaderboard.sort(
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
  );

  return leaderboard.map(
    (
      user,
      index
    ) => {

      const position =
        index + 1;

      const prize =
        WEEKLY_PRIZES.find(
          p =>
            p.position ===
            position
        );

      return {

        ...user,

        position,

        prize:
          prize
            ? prize.amount
            : 0

      };

    }
  );

}

// ======================================================
// CHECK IF WEEKLY PRIZE ALREADY PAID
// ======================================================

async function hasWeeklyReward(
  userId,
  competitionId
) {

  const marker =
    `[${competitionId}]`;

  const {
    data,
    error
  } = await supabase

    .from('transactions')

    .select('id')

    .eq(
      'user_id',
      userId
    )

    .eq(
      'type',
      'weekly_referral_reward'
    )

    .ilike(
      'description',
      `%${marker}%`
    )

    .eq(
      'status',
      'completed'
    )

    .limit(1);

  if (error) {
    throw error;
  }

  return !!(
    data &&
    data.length
  );

}

// ======================================================
// FINALIZE WEEKLY COMPETITION
// ======================================================

async function finalizeWeeklyCompetition(
  competition
) {

  if (
    !competition ||
    Date.now() <
    new Date(
      competition.endTime
    ).getTime()
  ) {

    return;

  }

  const leaderboard =
    await buildWeeklyLeaderboard(
      competition
    );

  const winners =
    [];

  for (
    const prize of
    WEEKLY_PRIZES
  ) {

    const winner =
      leaderboard.find(
        user =>
          user.position ===
          prize.position
      );

    if (!winner) {
      continue;
    }

    const alreadyPaid =
      await hasWeeklyReward(
        winner.userId,
        competition.competitionId
      );

    if (!alreadyPaid) {

      const targetUser =
        await getUserById(
          winner.userId
        );

      if (!targetUser) {
        continue;
      }

      targetUser.withdrawableBalance =
        Number(
          targetUser.withdrawableBalance || 0
        ) +
        prize.amount;

      await updateUser(
        targetUser
      );

      await addTransaction(

        targetUser.id,

        {

          id:
            `tx_weekly_referral_${competition.competitionId}_${targetUser.id}`,

          type:
            'weekly_referral_reward',

          amount:
            prize.amount,

          currency:
            'NGN',

          status:
            'completed',

          description:
            `${prize.description} [${competition.competitionId}] Position ${prize.position} — ${winner.eligibleReferrals} referrals`

        }

      );

    }

    winners.push({

      position:
        prize.position,

      userId:
        winner.userId,

      username:
        winner.username,

      eligibleReferrals:
        winner.eligibleReferrals,

      amount:
        prize.amount

    });

  }

  return winners;

}

// ======================================================
// WEEKLY CHECK
// ======================================================

async function checkWeeklyCompetition() {

  try {

    const currentStart =
      getCompetitionStart();

    const previousStart =
      new Date(
        currentStart.getTime() -
        7 * 24 * 60 * 60 * 1000
      );

    const previousCompetition =
      competitionFromStart(
        previousStart
      );

    if (
      Date.now() >=
      new Date(
        previousCompetition.endTime
      ).getTime()
    ) {

      await finalizeWeeklyCompetition(
        previousCompetition
      );

    }

  } catch (err) {

    console.error(
      'Weekly competition error:',
      err
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
        await buildWeeklyLeaderboard(
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

        const index =
          leaderboard.findIndex(
            user =>
              user.userId ===
              req.session.userId
          );

        if (
          index !== -1
        ) {

          userPosition =
            index + 1;

          userEligibleReferrals =
            leaderboard[index]
              .eligibleReferrals;

        } else {

          const currentUser =
            await getUserById(
              req.session.userId
            );

          if (currentUser) {

            userEligibleReferrals =
              (
                await getWeeklyEligibleReferrals(
                  currentUser,
                  competition
                )
              ).length;

          }

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

          competitionId:
            competition.competitionId,

          startTime:
            competition.startTime,

          endTime:
            competition.endTime,

          status:
            competition.status,

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
      } = await supabase

        .from('transactions')

        .select(
          'user_id,description,amount,created_at'
        )

        .eq(
          'type',
          'weekly_referral_reward'
        )

        .eq(
          'status',
          'completed'
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

      const groups =
        new Map();

      for (
        const tx of
        data || []
      ) {

        const match =
          String(
            tx.description || ''
          ).match(
            /\[(weekly_[^\]]+)\]/
          );

        if (!match) {
          continue;
        }

        const competitionId =
          match[1];

        if (
          !groups.has(
            competitionId
          )
        ) {

          groups.set(
            competitionId,
            []
          );

        }

        const positionMatch =
          String(
            tx.description || ''
          ).match(
            /Position (\d+)/
          );

        const referralMatch =
          String(
            tx.description || ''
          ).match(
            /— (\d+) referrals/
          );

        groups
          .get(
            competitionId
          )
          .push({

            position:
              positionMatch
                ? Number(
                    positionMatch[1]
                  )
                : null,

            userId:
              tx.user_id,

            amount:
              Number(
                tx.amount || 0
              ),

            eligibleReferrals:
              referralMatch
                ? Number(
                    referralMatch[1]
                  )
                : 0

          });

      }

      const history =
        [];

      for (
        const [
          competitionId,
          winners
        ] of groups.entries()
      ) {

        const datePart =
          competitionId.replace(
            'weekly_',
            ''
          );

        const start =
          new Date(
            `${datePart}T00:00:00.000Z`
          );

        const end =
          getCompetitionEnd(
            start
          );

        const userIds =
          winners.map(
            w =>
              w.userId
          );

        const {
          data:
            usersForHistory
        } = await supabase

          .from('users')

          .select(
            'id,username'
          )

          .in(
            'id',
            userIds
          );

        const usernames =
          new Map(

            (
              usersForHistory ||
              []
            ).map(
              u =>
                [
                  u.id,
                  u.username
                ]
            )

          );

        winners.sort(
          (a, b) =>
            (
              a.position || 99
            ) -
            (
              b.position || 99
            )
        );

        history.push({

          competitionId,

          startTime:
            start.toISOString(),

          endTime:
            end.toISOString(),

          winners:
            winners.map(
              w => ({

                ...w,

                username:
                  usernames.get(
                    w.userId
                  ) ||
                  'User'

              })
            )

        });

      }

      history.sort(
        (a, b) =>
          new Date(
            b.startTime
          ).getTime() -
          new Date(
            a.startTime
          ).getTime()
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
// TELEGRAM POLLING
// ======================================================

async function pollTelegramUpdates() {

  try {

    if (
      !TELEGRAM_BOT_TOKEN
    ) {

      console.warn(
        'Telegram polling disabled: TELEGRAM_BOT_TOKEN is missing.'
      );

      setTimeout(
        pollTelegramUpdates,
        10000
      );

      return;

    }

    const response =
      await fetch(

        `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getUpdates?timeout=25&offset=${telegramUpdateOffset}`

      );

    const data =
      await response.json();

    if (
      !data.ok
    ) {

      console.error(
        'Telegram polling error:',
        data
      );

      setTimeout(
        pollTelegramUpdates,
        5000
      );

      return;

    }

    for (
      const update of
      data.result || []
    ) {

      telegramUpdateOffset =
        update.update_id + 1;

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
// INITIALIZE
// ======================================================

setInterval(
  checkWeeklyCompetition,
  10000
);

pollTelegramUpdates();

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
      } = await supabase

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

      res.json({

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
        'Health check database error:',
        err
      );

      res.status(500).json({

        success:
          false,

        database:
          'supabase',

        error:
          'Database connection failed.'

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
