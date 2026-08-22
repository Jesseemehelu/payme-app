const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

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

app.use(express.json({ limit: '15mb' }));
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

const SESSION_SECRET =
  process.env.PAYME_SESSION_SECRET ||
  'sess_sec_9qW2$vL5%nQ8@wZ3_8f8b2c7d4';

// Extend session cookie lifetime so it doesn't expire
const SESSION_MAX_AGE = 10 * 365 * 24 * 60 * 60 * 1000; // 10 years

const isProduction =
  process.env.NODE_ENV === 'production';


// ======================================================
// REWARDS
// ======================================================

const WELCOME_BONUS = 10;
const REFERRAL_REWARD = 15;
const MIN_WITHDRAWAL_LIMIT = 100;
const SPIN_COST = 50;


// ======================================================
// DATABASE
// ======================================================

const DATABASE_FILE =
  path.join(__dirname, 'payme-data.json');

let users = [];
let weeklyCompetitions = [];


// ======================================================
// LOAD DATABASE
// ======================================================

function loadDatabase() {

  try {

    if (!fs.existsSync(DATABASE_FILE)) {

      users = [];
      weeklyCompetitions = [];

      saveDatabase();

      console.log(
        'No existing database found. New database created.'
      );

      return;
    }

    const data =
      fs.readFileSync(
        DATABASE_FILE,
        'utf8'
      );

    if (!data.trim()) {

      users = [];
      weeklyCompetitions = [];

      saveDatabase();

      return;
    }

    const database =
      JSON.parse(data);

    users =
      Array.isArray(database.users)
        ? database.users
        : [];

    weeklyCompetitions =
      Array.isArray(database.weeklyCompetitions)
        ? database.weeklyCompetitions
        : [];


    // ==================================================
    // UPGRADE OLD USERS
    // ==================================================

    users.forEach(user => {

      if (
        typeof user.withdrawableBalance ===
        'undefined'
      ) {
        user.withdrawableBalance =
          Number(
            user.referralEarnings || 0
          );
      }

      if (
        typeof user.depositBalance !==
        'number'
      ) {
        user.depositBalance = 0;
      }

      if (
        typeof user.sessionVersion !==
        'number'
      ) {
        user.sessionVersion = 0;
      }

      if (
        !Array.isArray(
          user.transactions
        )
      ) {
        user.transactions = [];
      }

      if (
        !Array.isArray(
          user.deposits
        )
      ) {
        user.deposits = [];
      }

      if (
        typeof user.totalReferrals !==
        'number'
      ) {
        user.totalReferrals =
          Number(
            user.totalReferrals || 0
          );
      }

      if (
        typeof user.successfulReferrals !==
        'number'
      ) {
        user.successfulReferrals =
          Number(
            user.successfulReferrals || 0
          );
      }

      if (
        typeof user.referralEarnings !==
        'number'
      ) {
        user.referralEarnings =
          Number(
            user.referralEarnings || 0
          );
      }

      if (
        typeof user.balance !==
        'number'
      ) {
        user.balance =
          Number(
            user.balance || 0
          );
      }

      if (
        !Array.isArray(
          user.weeklyReferralEvents
        )
      ) {
        user.weeklyReferralEvents = [];
      }

      if (
        !user.weeklyReferralHistory
      ) {
        user.weeklyReferralHistory = {};
      }

      if (
        typeof user.hasReceivedWelcomeBonus ===
        'undefined'
      ) {
        user.hasReceivedWelcomeBonus = false;
      }

      if (
        typeof user.hasSeenPopup ===
        'undefined'
      ) {
        user.hasSeenPopup = false;
      }

      if (
        typeof user.telegramId ===
        'undefined'
      ) {
        user.telegramId = null;
      }

      user.depositBalance =
        Math.max(
          0,
          Number(
            user.depositBalance || 0
          )
        );

    });

    console.log(
      `Database loaded successfully. Users: ${users.length}`
    );

  } catch (err) {

    console.error(
      'Database loading error:',
      err
    );

    users = [];
    weeklyCompetitions = [];

  }

}


// ======================================================
// SAVE DATABASE
// ======================================================

function saveDatabase() {

  try {

    const database = {
      users,
      weeklyCompetitions
    };

    const tempFile =
      DATABASE_FILE + '.tmp';

    fs.writeFileSync(
      tempFile,
      JSON.stringify(
        database,
        null,
        2
      ),
      'utf8'
    );

    fs.renameSync(
      tempFile,
      DATABASE_FILE
    );

  } catch (err) {

    console.error(
      'Database saving error:',
      err
    );

  }

}


loadDatabase();


// ======================================================
// ID HELPERS
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


function generateUniqueReferralCode() {

  let code =
    generateReferralCode();

  while (
    users.some(
      u =>
        u.referralCode === code
    )
  ) {

    code =
      generateReferralCode();

  }

  return code;

}


// ======================================================
// BALANCE HELPERS
// ======================================================

function getDepositBalance(user) {

  return Math.max(
    0,
    Number(
      user.depositBalance || 0
    )
  );

}


function getWithdrawableBalance(user) {

  return Math.max(
    0,
    Number(
      user.withdrawableBalance || 0
    )
  );

}


function syncUserBalance(user) {

  user.depositBalance =
    getDepositBalance(user);

  user.withdrawableBalance =
    getWithdrawableBalance(user);

  user.balance =
    user.depositBalance +
    user.withdrawableBalance;

  return user.balance;

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
    .from(value, 'base64')
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


function createSessionToken(user) {

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

  const signature =
    createSignature(
      payload
    );

  return (
    `${payload}.${signature}`
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

    const providedSignature =
      parts[1];

    const expectedSignature =
      createSignature(
        payload
      );

    const providedBuffer =
      Buffer.from(
        providedSignature
      );

    const expectedBuffer =
      Buffer.from(
        expectedSignature
      );

    if (
      providedBuffer.length !==
      expectedBuffer.length
    ) {
      return null;
    }

    if (
      !crypto.timingSafeEqual(
        providedBuffer,
        expectedBuffer
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

  const cookies =
    cookieHeader.split(';');

  for (
    const cookie of cookies
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


function clearSessionCookie(res) {

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

function authenticateRequest(
  req,
  res,
  next
) {

  req.session = null;

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
    users.find(
      u =>
        u.id ===
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

  next();

}


app.use(
  authenticateRequest
);


// ======================================================
// REQUIRE LOGIN
// ======================================================

function requireLogin(
  req,
  res,
  next
) {

  if (
    !req.session ||
    !req.session.userId
  ) {

    return res.status(401).json({

      success: false,

      message:
        'Unauthorized session.'

    });

  }

  const user =
    users.find(
      u =>
        u.id ===
        req.session.userId
    );

  if (!user) {

    clearSessionCookie(res);

    return res.status(401).json({

      success: false,

      message:
        'User session not found.'

    });

  }

  if (
    typeof user.depositBalance !==
    'number'
  ) {
    user.depositBalance = 0;
  }

  if (
    typeof user.withdrawableBalance !==
    'number'
  ) {
    user.withdrawableBalance =
      Number(
        user.referralEarnings || 0
      );
  }

  syncUserBalance(user);

  req.user =
    user;

  next();

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
          method: 'POST',

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

    // Reject data older than 24 hours.
    const age =
      Math.floor(
        Date.now() / 1000
      ) - authDate;

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
        params.get('start_param') || ''

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

function ensureWelcomeBonus(user) {

  if (
    typeof user.withdrawableBalance ===
    'undefined'
  ) {

    user.withdrawableBalance =
      Number(
        user.referralEarnings || 0
      );

  }

  if (
    typeof user.depositBalance !==
    'number'
  ) {
    user.depositBalance = 0;
  }

  if (
    !user.hasReceivedWelcomeBonus
  ) {

    user.withdrawableBalance =
      Number(
        user.withdrawableBalance || 0
      ) +
      WELCOME_BONUS;

    user.hasReceivedWelcomeBonus =
      true;

    if (
      !Array.isArray(
        user.transactions
      )
    ) {
      user.transactions = [];
    }

    user.transactions.unshift({

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
        'completed',

      createdAt:
        new Date().toISOString()

    });

  }

  syncUserBalance(user);

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

          success: false,

          message:
            'Please enter your full name.'

        });

      }


      if (
        !email ||
        !email.includes('@')
      ) {

        return res.status(400).json({

          success: false,

          message:
            'Please enter a valid email address.'

        });

      }


      if (
        !username ||
        username.trim().length < 3
      ) {

        return res.status(400).json({

          success: false,

          message:
            'Username must be at least 3 characters.'

        });

      }


      if (
        !phone ||
        phone.trim().length < 7
      ) {

        return res.status(400).json({

          success: false,

          message:
            'Please enter a valid phone number.'

        });

      }


      if (
        !password ||
        password.length < 8
      ) {

        return res.status(400).json({

          success: false,

          message:
            'Password must be at least 8 characters.'

        });

      }


      if (!agreeTerms) {

        return res.status(400).json({

          success: false,

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
        users.find(
          u =>
            u.username ===
            cleanUsername
        )
      ) {

        return res.status(400).json({

          success: false,

          message:
            'Username is already taken.'

        });

      }


      if (
        users.find(
          u =>
            u.email ===
            cleanEmail
        )
      ) {

        return res.status(400).json({

          success: false,

          message:
            'Email address is already registered.'

        });

      }


      const newUser = {

        id:
          generateUserId(),

        fullName:
          fullName.trim(),

        email:
          cleanEmail,

        username:
          cleanUsername,

        phone:
          cleanPhone,

        password,

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
          generateUniqueReferralCode(),

        referredBy:
          cleanRefInput,

        totalReferrals:
          0,

        successfulReferrals:
          0,

        referralEarnings:
          0,

        transactions:
          [],

        deposits:
          [],

        weeklyReferralEvents:
          [],

        weeklyReferralHistory:
          {},

        sessionVersion:
          0,

        createdAt:
          new Date().toISOString()

      };


      ensureWelcomeBonus(
        newUser
      );


      // ==================================================
      // REFERRAL
      // ==================================================

      if (
        newUser.referredBy
      ) {

        const referrer =
          users.find(
            u =>
              u.referralCode ===
              newUser.referredBy
          );

        if (
          referrer &&
          referrer.id !==
          newUser.id
        ) {

          const competition =
            ensureWeeklyCompetition();

          const referralConfirmedAt =
            new Date().toISOString();


          referrer.withdrawableBalance =
            Number(
              referrer.withdrawableBalance || 0
            ) +
            REFERRAL_REWARD;


          referrer.totalReferrals =
            Number(
              referrer.totalReferrals || 0
            ) + 1;


          referrer.successfulReferrals =
            Number(
              referrer.successfulReferrals || 0
            ) + 1;


          referrer.referralEarnings =
            Number(
              referrer.referralEarnings || 0
            ) +
            REFERRAL_REWARD;


          syncUserBalance(
            referrer
          );


          referrer.transactions.unshift({

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
              referralConfirmedAt

          });


          if (
            !competition.referralCounts
          ) {
            competition.referralCounts = {};
          }

          if (
            !competition.referralFirstReachedAt
          ) {
            competition.referralFirstReachedAt = {};
          }


          const currentWeeklyCount =
            Number(
              competition
                .referralCounts[
                  referrer.id
                ] || 0
            );


          const newWeeklyCount =
            currentWeeklyCount + 1;


          competition
            .referralCounts[
              referrer.id
            ] =
            newWeeklyCount;


          if (
            !competition
              .referralFirstReachedAt[
                referrer.id
              ]
          ) {

            competition
              .referralFirstReachedAt[
                referrer.id
              ] = {};

          }


          if (
            !competition
              .referralFirstReachedAt[
                referrer.id
              ][newWeeklyCount]
          ) {

            competition
              .referralFirstReachedAt[
                referrer.id
              ][newWeeklyCount] =
              referralConfirmedAt;

          }


          referrer.weeklyReferralEvents.push({

            referredUserId:
              newUser.id,

            referredUsername:
              newUser.username,

            confirmedAt:
              referralConfirmedAt,

            eligible:
              true,

            competitionId:
              competition.competitionId

          });


          referrer.weeklyReferralHistory[
            competition.competitionId
          ] =
            newWeeklyCount;

        }

      }


      newUser.sessionVersion =
        1;


      syncUserBalance(
        newUser
      );


      users.push(
        newUser
      );


      const sessionToken =
        createSessionToken(
          newUser
        );


      setSessionCookie(
        res,
        sessionToken
      );


      saveDatabase();


      const signupMsg =
        `🆕 <b>NEW USER REGISTERED</b>\n\n` +
        `👤 <b>Name:</b> ${newUser.fullName}\n` +
        `🆔 <b>Username:</b> @${newUser.username}\n` +
        `📧 <b>Email:</b> ${newUser.email}\n` +
        `📱 <b>Phone:</b> ${newUser.phone}\n` +
        `🎁 <b>Welcome Bonus:</b> ₦${WELCOME_BONUS}\n` +
        `🔗 <b>Referral Code:</b> ${newUser.referralCode}\n` +
        `👥 <b>Referred By:</b> ${newUser.referredBy || 'None'}\n` +
        `💰 <b>Balance:</b> ₦${Number(newUser.balance).toFixed(2)}\n` +
        `💵 <b>Earnings:</b> ₦${Number(newUser.withdrawableBalance).toFixed(2)}\n` +
        `💳 <b>Deposit Balance:</b> ₦${Number(newUser.depositBalance).toFixed(2)}`;


      sendTelegramNotification(
        signupMsg
      ).catch(() => {});


      return res.json({

        success:
          true,

        message:
          'Signup successful',

        user: {

          id:
            newUser.id,

          fullName:
            newUser.fullName,

          username:
            newUser.username,

          balance:
            newUser.balance,

          withdrawableBalance:
            newUser.withdrawableBalance,

          depositBalance:
            newUser.depositBalance

        }

      });

    } catch (err) {

      console.error(
        'Signup error:',
        err
      );

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
// TELEGRAM SIGN UP / AUTHENTICATION
// ======================================================

// TELEGRAM SIGN UP / AUTHENTICATION
app.post('/api/auth/telegram-signup', async (req, res) => {
    try {
        const { telegramId, username, firstName, lastName, referralCode } = req.body;

        if (!telegramId) {
            return res.status(400).json({ success: false, message: 'Telegram account information could not be detected.' });
        }

        const cleanTelegramId = String(telegramId);
        const cleanUsername = String(username || `user_${cleanTelegramId}`).trim().replace(/^@/, '').toLowerCase();
        const cleanFirstName = String(firstName || '').trim();
        const cleanLastName = String(lastName || '').trim();
        const cleanRefInput = referralCode ? String(referralCode).trim().toUpperCase() : null;
        const fullName = `${cleanFirstName} ${cleanLastName}`.trim() || cleanUsername;

        let user = users.find(u => String(u.telegramId || '') === cleanTelegramId);

        if (!user) {
            user = users.find(u => String(u.username || '').toLowerCase() === cleanUsername);
        }

        if (!user) {
            const uniqueRefCode = generateUniqueReferralCode();
            user = {
                id: generateUserId(),
                telegramId: cleanTelegramId,
                fullName: fullName,
                email: `${cleanUsername}@telegram.user`,
                username: cleanUsername,
                phone: 'N/A',
                password: crypto.randomBytes(16).toString('hex'),
                balance: 0,
                depositBalance: 0,
                withdrawableBalance: 0,
                hasReceivedWelcomeBonus: false,
                hasSeenPopup: false,
                referralCode: uniqueRefCode,
                referredBy: cleanRefInput,
                totalReferrals: 0,
                successfulReferrals: 0,
                referralEarnings: 0,
                transactions: [],
                deposits: [],
                weeklyReferralEvents: [],
                weeklyReferralHistory: {},
                sessionVersion: 0,
                createdAt: new Date().toISOString()
            };

            ensureWelcomeBonus(user);

            // PROCESS REFERRAL IF PROVIDED
            if (user.referredBy) {
                const referrer = users.find(u => u.referralCode === user.referredBy);
                if (referrer && referrer.id !== user.id) {
                    referrer.withdrawableBalance = Number(referrer.withdrawableBalance || 0) + REFERRAL_REWARD;
                    referrer.totalReferrals = Number(referrer.totalReferrals || 0) + 1;
                    referrer.successfulReferrals = Number(referrer.successfulReferrals || 0) + 1;
                    referrer.referralEarnings = Number(referrer.referralEarnings || 0) + REFERRAL_REWARD;

                    syncUserBalance(referrer);
                    if (!Array.isArray(referrer.transactions)) referrer.transactions = [];

                    referrer.transactions.unshift({
                        id: generateTransactionId('tx_ref'),
                        type: 'referral_reward',
                        description: `Referral Reward (@${user.username})`,
                        amount: REFERRAL_REWARD,
                        currency: 'NGN',
                        status: 'completed',
                        createdAt: new Date().toISOString()
                    });
                }
            }

            users.push(user);

            const signupMsg = `<b>NEW TELEGRAM USER REGISTERED</b>\n\n` +
                `<b>Name:</b> ${user.fullName}\n` +
                `<b>Username:</b> @${user.username}\n` +
                `<b>Telegram ID:</b> ${user.telegramId}\n` +
                `<b>Welcome Bonus:</b> ₦${WELCOME_BONUS}\n` +
                `<b>Referral Code:</b> ${user.referralCode}\n` +
                `<b>Referred By:</b> ${user.referredBy || 'None'}\n` +
                `<b>Balance:</b> ₦${Number(user.balance).toFixed(2)}`;

            sendTelegramNotification(signupMsg).catch(() => {});
        } else {
            user.telegramId = cleanTelegramId;
            if (fullName) user.fullName = fullName;
            if (cleanUsername && !cleanUsername.startsWith('user_')) user.username = cleanUsername;
            ensureWelcomeBonus(user);
        }

        user.sessionVersion = Number(user.sessionVersion || 0) + 1;
        syncUserBalance(user);

        const sessionToken = createSessionToken(user);
        setSessionCookie(res, sessionToken);
        saveDatabase();

        return res.json({
            success: true,
            message: 'Telegram authentication successful',
            user: {
                id: user.id,
                telegramId: user.telegramId,
                fullName: user.fullName,
                username: user.username,
                balance: user.balance,
                withdrawableBalance: user.withdrawableBalance,
                depositBalance: user.depositBalance,
                referralCode: user.referralCode
            }
        });
    } catch (err) {
        console.error('Telegram signup error:', err);
        return res.status(500).json({ success: false, message: 'Server error during Telegram signup.' });
    }
});



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


      const user =
        users.find(
          u =>
            u.username ===
            cleanId ||
            u.email ===
            cleanId
        );


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


      ensureWelcomeBonus(
        user
      );


      user.sessionVersion =
        Number(
          user.sessionVersion || 0
        ) + 1;


      syncUserBalance(
        user
      );


      const sessionToken =
        createSessionToken(
          user
        );


      setSessionCookie(
        res,
        sessionToken
      );


      saveDatabase();


      const loginMsg =
        `🔐 <b>USER LOGIN ALERT</b>\n\n` +
        `👤 <b>Name:</b> ${user.fullName}\n` +
        `🆔 <b>Username:</b> @${user.username}\n` +
        `💰 <b>Current Balance:</b> ₦${Number(user.balance).toFixed(2)}\n` +
        `💵 <b>Earnings:</b> ₦${Number(user.withdrawableBalance).toFixed(2)}\n` +
        `💳 <b>Deposit Balance:</b> ₦${Number(user.depositBalance).toFixed(2)}`;


      sendTelegramNotification(
        loginMsg
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
  (req, res) => {

    try {

      if (
        req.session &&
        req.session.userId
      ) {

        const user =
          users.find(
            u =>
              u.id ===
              req.session.userId
          );

        if (user) {

          user.sessionVersion =
            Number(
              user.sessionVersion || 0
            ) + 1;

          saveDatabase();

        }

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

    } catch (err) {

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


      const withdrawable =
        getWithdrawableBalance(
          user
        );


      const withdrawnAmount =
        Number(amount);


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


      syncUserBalance(
        user
      );


      if (
        !Array.isArray(
          user.transactions
        )
      ) {
        user.transactions = [];
      }


      user.transactions.unshift({

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

        date:
          new Date().toLocaleString(),

        createdAt:
          new Date().toISOString()

      });


      const msg =
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
        `• <b>Account No:</b> ${accountNumber}`;


      await sendTelegramNotification(
        msg
      );


      saveDatabase();


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
  (req, res) => {

    return res.json({

      success:
        true,

      transactions:
        req.user.transactions ||
        []

    });

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
// GAME STATE
// ======================================================

app.get(
  '/api/game/state',
  requireLogin,
  (req, res) => {

    const user =
      req.user;


    const spins =
      user.transactions
        ? user.transactions.filter(
            t =>
              t.type &&
              t.type.includes(
                'Spin'
              )
          )
        : [];


    syncUserBalance(
      user
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

      spins

    });

  }
);


// ======================================================
// SPIN GAME
// ======================================================

app.post(
  '/api/game/spin',
  requireLogin,
  (req, res) => {

    try {

      const user =
        req.user;


      syncUserBalance(
        user
      );


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
            'Insufficient balance. You need at least ₦50.'

        });

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


      // ==================================================
      // DEDUCT SPIN COST
      // ==================================================

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

        remainingSpinCost =
          0;

      } else {

        remainingSpinCost =
          remainingSpinCost -
          currentDepositBalance;

        user.depositBalance =
          0;


        if (
          currentEarnings <
          remainingSpinCost
        ) {

          user.depositBalance =
            currentDepositBalance;

          syncUserBalance(
            user
          );

          return res.status(400).json({

            success:
              false,

            error:
              'Insufficient balance.'

          });

        }


        user.withdrawableBalance =
          currentEarnings -
          remainingSpinCost;

      }


      syncUserBalance(
        user
      );


      user.transactions.unshift({

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

        date:
          new Date().toLocaleString(),

        createdAt:
          new Date().toISOString()

      });


      // ==================================================
      // SELECT PRIZE
      // ==================================================

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
        const prize of prizes
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


      // ==================================================
      // ADD WINNINGS
      // ==================================================

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


      syncUserBalance(
        user
      );


      user.transactions.unshift({

        id:
          generateTransactionId(
            'tx_spin_reward'
          ),

        type:
          'Spin Reward',

        bank:
          'PAYME Wallet',

        amount:
          selectedPrize.amount,

        date:
          new Date().toLocaleString(),

        createdAt:
          new Date().toISOString()

      });


      saveDatabase();


      const recentSpins =
        user.transactions.filter(
          t =>
            t.type &&
            t.type.includes(
              'Spin'
            )
        );


      return res.json({

        success:
          true,

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
  (req, res) => {

    const user =
      req.user;


    if (
      !Array.isArray(
        user.deposits
      )
    ) {
      user.deposits = [];
    }


    return res.json({

      success:
        true,

      deposits:
        user.deposits

    });

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
        Number(amount);


      if (
        !Number.isFinite(
          depositAmount
        ) ||
        depositAmount <= 0
      ) {

        return res.status(400).json({

          success:
            false,

          error:
            'Invalid deposit amount.'

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


      const newDeposit = {

        reference,

        amount:
          depositAmount,

        status:
          'Pending Verification',

        date:
          new Date().toLocaleString(),

        screenshot,

        reason:
          null,

        createdAt:
          new Date().toISOString()

      };


      if (
        !Array.isArray(
          user.deposits
        )
      ) {
        user.deposits = [];
      }


      user.deposits.unshift(
        newDeposit
      );


      saveDatabase();


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
// ADMIN DEPOSIT VERIFY
// ======================================================

app.post(
  '/api/admin/deposits/verify',
  async (req, res) => {

    const {
      adminSecret,
      userId,
      reference,
      action,
      reason
    } = req.body;


    if (
      adminSecret !==
      (
        process.env.PAYME_ADMIN_SECRET ||
        'payme_admin_secret_2026'
      )
    ) {

      return res.status(403).json({

        success:
          false,

        error:
          'Forbidden'

      });

    }


    const targetUser =
      users.find(
        u =>
          u.id ===
          userId
      );


    if (
      !targetUser ||
      !Array.isArray(
        targetUser.deposits
      )
    ) {

      return res.status(404).json({

        success:
          false,

        error:
          'User or deposits not found'

      });

    }


    const deposit =
      targetUser.deposits.find(
        d =>
          d.reference ===
          reference
      );


    if (
      !deposit ||
      deposit.status !==
      'Pending Verification'
    ) {

      return res.status(400).json({

        success:
          false,

        error:
          'Deposit not found or already verified'

      });

    }


    if (
      action ===
      'approve'
    ) {

      deposit.status =
        'Approved';

      deposit.reason =
        null;

      deposit.verifiedAt =
        new Date().toISOString();


      const approvedDepositAmount =
        Number(
          deposit.amount || 0
        );


      targetUser.depositBalance =
        Number(
          targetUser.depositBalance || 0
        ) +
        approvedDepositAmount;


      syncUserBalance(
        targetUser
      );


      targetUser.transactions.unshift({

        id:
          generateTransactionId(
            'tx_deposit'
          ),

        type:
          'Deposit Approved',

        description:
          `Deposit ${deposit.reference}`,

        amount:
          approvedDepositAmount,

        currency:
          'NGN',

        bank:
          'PalmPay',

        reference:
          deposit.reference,

        status:
          'completed',

        date:
          new Date().toLocaleString(),

        createdAt:
          new Date().toISOString()

      });


      saveDatabase();

    } else if (
      action ===
      'reject'
    ) {

      deposit.status =
        'Rejected';

      deposit.reason =
        reason ||
        'Payment proof could not be verified.';

      deposit.rejectedAt =
        new Date().toISOString();


      saveDatabase();

    } else {

      return res.status(400).json({

        success:
          false,

        error:
          'Invalid action. Use approve or reject.'

      });

    }


    return res.json({

      success:
        true,

      message:
        `Deposit ${deposit.status.toLowerCase()} successfully.`,

      deposit,

      balance:
        targetUser.balance,

      withdrawableBalance:
        targetUser.withdrawableBalance,

      depositBalance:
        targetUser.depositBalance

    });

  }
);




// DASHBOARD API
app.post('/api/user/dashboard', async (req, res) => {
    try {
        let user = null;
        if (req.session && req.session.userId) {
            user = users.find(u => u.id === req.session.userId);
        }

        const { telegramId, username } = req.body;
        if (!user && telegramId) {
            const cleanTelegramId = String(telegramId);
            user = users.find(u => String(u.telegramId || '') === cleanTelegramId);
            if (!user && username) {
                user = users.find(u => String(u.username || '').toLowerCase() === String(username).toLowerCase());
                if (user) user.telegramId = cleanTelegramId;
            }
        }

        if (!user) {
            return res.status(401).json({ success: false, message: 'Unauthorized session.' });
        }

        req.session = { userId: user.id };
        const sessionToken = createSessionToken(user);
        setSessionCookie(res, sessionToken);

        ensureWelcomeBonus(user);
        const isNewUser = user.hasReceivedWelcomeBonus && !user.hasSeenPopup;
        if (isNewUser) {
            user.hasSeenPopup = true;
            saveDatabase();
        }

        syncUserBalance(user);

        return res.json({
            success: true,
            user: {
                id: user.id,
                fullName: user.fullName,
                username: user.username,
                balance: Number(user.balance || 0),
                withdrawableBalance: Number(user.withdrawableBalance || 0),
                depositBalance: Number(user.depositBalance || 0),
                isNewUser,
                referralCode: user.referralCode,
                totalReferrals: Number(user.totalReferrals || 0),
                successfulReferrals: Number(user.successfulReferrals || 0),
                referralEarnings: Number(user.referralEarnings || 0),
                minWithdrawalLimit: MIN_WITHDRAWAL_LIMIT,
                canWithdraw: Number(user.withdrawableBalance || 0) >= MIN_WITHDRAWAL_LIMIT,
                transactions: user.transactions || [],
                deposits: user.deposits || []
            }
        });
    } catch (err) {
        console.error('Dashboard error:', err);
        return res.status(500).json({ success: false, message: 'Server error loading dashboard.' });
    }
});



// ======================================================
// TELEGRAM CALLBACKS
// ======================================================

let telegramUpdateOffset = 0;


async function answerTelegramCallback(
  callbackId,
  text
) {

  try {

    if (
      !TELEGRAM_BOT_TOKEN
    ) {
      return;
    }


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
      err
    );

  }

}


async function editTelegramMessage(
  chatId,
  messageId,
  text
) {

  try {

    if (
      !TELEGRAM_BOT_TOKEN
    ) {
      return;
    }


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
      err
    );


  }

}


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
      parts[2];


    const targetUser =
      users.find(
        u =>
          u.id ===
          userId
      );


    if (
      !targetUser ||
      !Array.isArray(
        targetUser.deposits
      )
    ) {

      await answerTelegramCallback(
        callbackQuery.id,
        '❌ User or deposit not found.'
      );

      return;

    }


    const deposit =
      targetUser.deposits.find(
        d =>
          d.reference ===
          reference
      );


    if (!deposit) {

      await answerTelegramCallback(
        callbackQuery.id,
        '❌ Deposit not found.'
      );

      return;

    }


    if (
      deposit.status !==
      'Pending Verification'
    ) {

      await answerTelegramCallback(
        callbackQuery.id,
        `⚠️ Already ${deposit.status}.`
      );

      return;

    }


    // ==================================================
    // APPROVE
    // ==================================================

    if (
      action ===
      'approve_deposit'
    ) {

      deposit.status =
        'Approved';

      deposit.reason =
        null;

      deposit.verifiedAt =
        new Date().toISOString();


      const approvedDepositAmount =
        Number(
          deposit.amount || 0
        );


      targetUser.depositBalance =
        Number(
          targetUser.depositBalance || 0
        ) +
        approvedDepositAmount;


      syncUserBalance(
        targetUser
      );


      targetUser.transactions.unshift({

        id:
          generateTransactionId(
            'tx_deposit'
          ),

        type:
          'Deposit Approved',

        description:
          `Deposit ${deposit.reference}`,

        amount:
          approvedDepositAmount,

        currency:
          'NGN',

        bank:
          'PalmPay',

        reference:
          deposit.reference,

        status:
          'completed',

        date:
          new Date().toLocaleString(),

        createdAt:
          new Date().toISOString()

      });


      saveDatabase();


      await answerTelegramCallback(
        callbackQuery.id,
        '✅ Deposit approved!'
      );


      await editTelegramMessage(

        callbackQuery.message.chat.id,

        callbackQuery.message.message_id,

        `✅ <b>DEPOSIT APPROVED</b>\n\n` +

        `👤 <b>Name:</b> ${targetUser.fullName}\n` +

        `🆔 <b>Username:</b> @${targetUser.username}\n` +

        `💰 <b>Amount:</b> ₦${Number(
          deposit.amount
        ).toLocaleString()}\n` +

        `🔖 <b>Reference:</b> ${deposit.reference}\n` +

        `💳 <b>New Balance:</b> ₦${Number(
          targetUser.balance
        ).toLocaleString()}\n` +

        `💵 <b>Earnings:</b> ₦${Number(
          targetUser.withdrawableBalance
        ).toLocaleString()}\n` +

        `💳 <b>Deposit Balance:</b> ₦${Number(
          targetUser.depositBalance
        ).toLocaleString()}\n` +

        `✅ <b>Status:</b> Approved`

      );


      return;

    }


    // ==================================================
    // REJECT
    // ==================================================

    if (
      action ===
      'reject_deposit'
    ) {

      deposit.status =
        'Rejected';

      deposit.reason =
        'Payment proof was rejected.';

      deposit.rejectedAt =
        new Date().toISOString();


      saveDatabase();


      await answerTelegramCallback(
        callbackQuery.id,
        '❌ Deposit rejected.'
      );


      await editTelegramMessage(

        callbackQuery.message.chat.id,

        callbackQuery.message.message_id,

        `❌ <b>DEPOSIT REJECTED</b>\n\n` +

        `👤 <b>Name:</b> ${targetUser.fullName}\n` +

        `🆔 <b>Username:</b> @${targetUser.username}\n` +

        `💰 <b>Amount:</b> ₦${Number(
          deposit.amount
        ).toLocaleString()}\n` +

        `🔖 <b>Reference:</b> ${deposit.reference}\n` +

        `❌ <b>Status:</b> Rejected\n` +

        `📝 <b>Reason:</b> Payment proof was rejected.`

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
  (req, res) => {

    try {

      const leaderboard =
        users

          .map(
            user => ({

              username:
                user.username,

              totalReferrals:
                Number(
                  user.totalReferrals || 0
                ),

              referralEarnings:
                Number(
                  user.referralEarnings || 0
                )

            })
          )

          .filter(
            user =>
              user.totalReferrals >
              0
          )

          .sort(
            (a, b) =>
              b.referralEarnings -
              a.referralEarnings
          )

          .slice(
            0,
            10
          );


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


  // Lagos = UTC+1
  const wat =
    new Date(
      now.getTime() +
      60 * 60 * 1000
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
// COMPETITION DATABASE
// ======================================================

function ensureWeeklyCompetition() {

  return ensureCompetitionDatabase();

}


function ensureCompetitionDatabase() {

  if (
    !Array.isArray(
      weeklyCompetitions
    )
  ) {
    weeklyCompetitions = [];
  }


  const current =
    getCurrentCompetition();


  let competition =
    weeklyCompetitions.find(
      c =>
        c.competitionId ===
        current.competitionId
    );


  if (!competition) {

    competition = {

      competitionId:
        current.competitionId,

      startTime:
        current.startTime,

      endTime:
        current.endTime,

      status:
        'active',

      winners:
        [],

      finalizedAt:
        null,

      referralCounts:
        {},

      referralFirstReachedAt:
        {}

    };


    weeklyCompetitions.push(
      competition
    );


    saveDatabase();

  }


  return competition;

}


// ======================================================
// WEEKLY ELIGIBLE REFERRALS
// ======================================================

function getWeeklyEligibleReferrals(
  user,
  competition
) {

  if (
    !Array.isArray(
      user.weeklyReferralEvents
    )
  ) {
    return [];
  }


  const start =
    new Date(
      competition.startTime
    ).getTime();


  const end =
    new Date(
      competition.endTime
    ).getTime();


  return user.weeklyReferralEvents.filter(
    event => {

      const eventTime =
        new Date(
          event.confirmedAt
        ).getTime();


      return (

        event.eligible ===
        true &&

        eventTime >=
        start &&

        eventTime <
        end

      );

    }
  );

}


// ======================================================
// WEEKLY LEADERBOARD
// ======================================================

function buildWeeklyLeaderboard(
  competition
) {

  return users

    .map(
      user => {

        const events =
          getWeeklyEligibleReferrals(
            user,
            competition
          );


        let lastReferralAt =
          null;


        if (
          events.length >
          0
        ) {

          const sorted =
            [
              ...events
            ].sort(
              (a, b) =>
                new Date(
                  a.confirmedAt
                ).getTime() -
                new Date(
                  b.confirmedAt
                ).getTime()
            );


          lastReferralAt =
            sorted[
              sorted.length - 1
            ].confirmedAt;

        }


        return {

          userId:
            user.id,

          username:
            user.username,

          fullName:
            user.fullName,

          eligibleReferrals:
            events.length,

          lastReferralAt

        };

      }
    )

    .filter(
      user =>
        user.eligibleReferrals >
        0
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


        if (!a.lastReferralAt) {
          return 1;
        }


        if (!b.lastReferralAt) {
          return -1;
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
// FINALIZE WEEKLY COMPETITION
// ======================================================

function finalizeWeeklyCompetition(
  competition
) {

  if (
    !competition ||
    competition.status ===
    'completed'
  ) {
    return;
  }


  const leaderboard =
    buildWeeklyLeaderboard(
      competition
    );


  const winners = [];


  for (
    const prize of WEEKLY_PRIZES
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


    const targetUser =
      users.find(
        user =>
          user.id ===
          winner.userId
      );


    if (!targetUser) {
      continue;
    }


    if (
      !Array.isArray(
        targetUser.transactions
      )
    ) {
      targetUser.transactions = [];
    }


    const alreadyPaid =
      targetUser.transactions.some(
        tx =>
          tx.type ===
          'weekly_referral_reward' &&

          tx.competitionId ===
          competition.competitionId &&

          tx.status ===
          'completed'
      );


    if (!alreadyPaid) {

      targetUser.withdrawableBalance =
        Number(
          targetUser.withdrawableBalance || 0
        ) +
        prize.amount;


      syncUserBalance(
        targetUser
      );


      targetUser.transactions.unshift({

        id:
          'tx_weekly_referral_' +
          competition.competitionId +
          '_' +
          targetUser.id,

        type:
          'weekly_referral_reward',

        amount:
          prize.amount,

        currency:
          'NGN',

        status:
          'completed',

        description:
          prize.description,

        competitionId:
          competition.competitionId,

        position:
          prize.position,

        eligibleReferrals:
          winner.eligibleReferrals,

        date:
          new Date().toLocaleString(),

        createdAt:
          new Date().toISOString()

      });

    }


    winners.push({

      position:
        prize.position,

      userId:
        targetUser.id,

      username:
        targetUser.username,

      eligibleReferrals:
        winner.eligibleReferrals,

      amount:
        prize.amount

    });

  }


  competition.winners =
    winners;

  competition.status =
    'completed';

  competition.finalizedAt =
    new Date().toISOString();


  saveDatabase();

}


// ======================================================
// WEEKLY CHECK
// ======================================================

function checkWeeklyCompetition() {

  try {

    const competition =
      ensureCompetitionDatabase();


    const now =
      Date.now();


    const end =
      new Date(
        competition.endTime
      ).getTime();


    if (
      competition.status ===
      'active' &&
      now >= end
    ) {

      finalizeWeeklyCompetition(
        competition
      );

    }


    ensureCompetitionDatabase();

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
  (req, res) => {

    try {

      const competition =
        ensureCompetitionDatabase();


      const leaderboard =
        buildWeeklyLeaderboard(
          competition
        );


      let userPosition =
        null;


      let userEligibleReferrals =
        0;


      const currentUserId =
        req.session
          ? req.session.userId
          : null;


      if (
        currentUserId
      ) {

        const index =
          leaderboard.findIndex(
            user =>
              user.userId ===
              currentUserId
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
            users.find(
              user =>
                user.id ===
                currentUserId
            );


          if (
            currentUser
          ) {

            userEligibleReferrals =
              getWeeklyEligibleReferrals(
                currentUser,
                competition
              ).length;

          }

        }

      }


      const now =
        Date.now();


      const endTime =
        new Date(
          competition.endTime
        ).getTime();


      const remainingMs =
        Math.max(
          0,
          endTime -
          now
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
  (req, res) => {

    try {

      const history =
        weeklyCompetitions

          .filter(
            competition =>
              competition.status ===
              'completed'
          )

          .sort(
            (a, b) =>
              new Date(
                b.startTime
              ).getTime() -
              new Date(
                a.startTime
              ).getTime()
          )

          .map(
            competition => ({

              competitionId:
                competition.competitionId,

              startTime:
                competition.startTime,

              endTime:
                competition.endTime,

              winners:
                competition.winners ||
                []

            })
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


    if (!data.ok) {

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
      const update of data.result
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

ensureCompetitionDatabase();

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
  (req, res) => {

    res.json({

      success:
        true,

      users:
        users.length,

      authenticated:
        !!(
          req.session &&
          req.session.userId
        )

    });

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
      `Users loaded: ${users.length}`
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
