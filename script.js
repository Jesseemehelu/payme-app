const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ limit: '10mb', extended: true }));
app.use(express.static('public'));

// HTML PAGE ROUTES
app.get('/earn', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'earn.html'));
});

// ============================================================
// CONFIGURATION
// ============================================================

const TELEGRAM_BOT_TOKEN =
  process.env.TELEGRAM_BOT_TOKEN || '8906287436:AAEWSp7G0xCmsCzdafjiGmPqGuceER8vvuc';

const TELEGRAM_CHAT_ID = '7686847796';

// REWARD STRUCTURE CONFIG
const WELCOME_BONUS = 10;
const REFERRAL_REWARD = 15;
const MIN_WITHDRAWAL_LIMIT = 100;

// Database & Session Store
const users = [];
let activeSessionUserId = null;

// ============================================================
// REFERRAL CODE
// ============================================================

function generateReferralCode() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let code = '';

  for (let i = 0; i < 6; i++) {
    code += chars.charAt(
      Math.floor(Math.random() * chars.length)
    );
  }

  return code;
}

// ============================================================
// TELEGRAM NOTIFICATION HELPER
// ============================================================

async function sendTelegramNotification(message) {
  if (
    !TELEGRAM_BOT_TOKEN ||
    TELEGRAM_BOT_TOKEN.includes('YOUR_TELEGRAM') ||
    TELEGRAM_BOT_TOKEN.includes('PASTE_NEW')
  ) {
    console.error('Telegram bot token is not configured.');
    return;
  }

  try {
    const fetchFn = globalThis.fetch || require('node-fetch');

    const response = await fetchFn(
      `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          chat_id: TELEGRAM_CHAT_ID,
          text: message,
          parse_mode: 'HTML'
        })
      }
    );

    const data = await response.json();

    if (!data.ok) {
      console.error('Telegram error:', data);
    }
  } catch (err) {
    console.error(
      'Telegram notification error:',
      err.message
    );
  }
}

// ============================================================
// WELCOME BONUS
// ============================================================

function ensureWelcomeBonus(user) {
  if (!user.hasReceivedWelcomeBonus) {
    user.balance += WELCOME_BONUS;
    user.hasReceivedWelcomeBonus = true;

    if (!user.transactions) {
      user.transactions = [];
    }

    user.transactions.unshift({
      id: 'tx_welcome_' + Date.now(),
      type: 'welcome_bonus',
      description: 'Welcome Bonus',
      amount: WELCOME_BONUS,
      currency: 'NGN',
      status: 'completed',
      createdAt: new Date().toISOString()
    });
  }
}

// ============================================================
// SIGN UP
// ============================================================

app.post('/api/auth/signup', async (req, res) => {
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
        message: 'Please enter your full name.'
      });
    }

    if (
      !email ||
      !email.includes('@')
    ) {
      return res.status(400).json({
        success: false,
        message: 'Please enter a valid email address.'
      });
    }

    if (
      !username ||
      username.trim().length < 3
    ) {
      return res.status(400).json({
        success: false,
        message: 'Username must be at least 3 characters.'
      });
    }

    if (
      !phone ||
      phone.trim().length < 7
    ) {
      return res.status(400).json({
        success: false,
        message: 'Please enter a valid phone number.'
      });
    }

    if (
      !password ||
      password.length < 8
    ) {
      return res.status(400).json({
        success: false,
        message: 'Password must be at least 8 characters.'
      });
    }

    if (!agreeTerms) {
      return res.status(400).json({
        success: false,
        message: 'Please accept the Terms of Service.'
      });
    }

    const cleanUsername =
      username.trim().toLowerCase();

    const cleanEmail =
      email.trim().toLowerCase();

    const cleanPhone =
      `${countryCode || '+234'}${phone.trim()}`;

    const cleanRefInput =
      referralCode
        ? referralCode.trim().toUpperCase()
        : null;

    if (
      users.find(
        u => u.username === cleanUsername
      )
    ) {
      return res.status(400).json({
        success: false,
        message: 'Username is already taken.'
      });
    }

    if (
      users.find(
        u => u.email === cleanEmail
      )
    ) {
      return res.status(400).json({
        success: false,
        message: 'Email address is already registered.'
      });
    }

    let uniqueRefCode =
      generateReferralCode();

    while (
      users.some(
        u => u.referralCode === uniqueRefCode
      )
    ) {
      uniqueRefCode =
        generateReferralCode();
    }

    const newUser = {
      id: 'usr_' + Date.now(),

      fullName:
        fullName.trim(),

      email:
        cleanEmail,

      username:
        cleanUsername,

      phone:
        cleanPhone,

      password,

      balance:
        0.00,

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
        0.00,

      transactions:
        [],

      deposits:
        [],

      createdAt:
        new Date().toISOString()
    };

    // Credit ₦10 Welcome Bonus
    ensureWelcomeBonus(newUser);

    // Process Referral Reward
    if (newUser.referredBy) {
      const referrer =
        users.find(
          u =>
            u.referralCode ===
            newUser.referredBy
        );

      if (referrer) {
        referrer.balance +=
          REFERRAL_REWARD;

        referrer.totalReferrals += 1;

        referrer.successfulReferrals += 1;

        referrer.referralEarnings +=
          REFERRAL_REWARD;

        referrer.transactions.unshift({
          id:
            'tx_ref_' +
            Date.now(),

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
            new Date().toISOString()
        });
      }
    }

    users.push(newUser);

    activeSessionUserId =
      newUser.id;

    return res.json({
      success: true,
      message: 'Signup successful',

      user: {
        id:
          newUser.id,

        fullName:
          newUser.fullName,

        username:
          newUser.username,

        balance:
          newUser.balance
      }
    });

  } catch (err) {
    console.error(
      'Signup error:',
      err
    );

    return res.status(500).json({
      success: false,
      message:
        'Server error during signup.'
    });
  }
});

// ============================================================
// LOGIN
// ============================================================

app.post('/api/auth/login', async (req, res) => {
  const {
    loginIdentifier,
    password
  } = req.body;

  if (
    !loginIdentifier ||
    !password
  ) {
    return res.status(400).json({
      success: false,
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
        u.username === cleanId ||
        u.email === cleanId
    );

  if (
    !user ||
    user.password !== password
  ) {
    return res.status(401).json({
      success: false,
      message:
        'Invalid credentials.'
    });
  }

  ensureWelcomeBonus(user);

  activeSessionUserId =
    user.id;

  const loginMsg =
    `🔐 <b>User Login Alert</b>\n\n` +
    `👤 <b>Name:</b> ${user.fullName}\n` +
    `🆔 <b>Username:</b> @${user.username}\n` +
    `💰 <b>Current Balance:</b> ₦${user.balance.toFixed(2)}`;

  sendTelegramNotification(
    loginMsg
  ).catch(
    err =>
      console.error(
        'Telegram error:',
        err.message
      )
  );

  return res.json({
    success: true,
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
        user.balance
    }
  });
});

// ============================================================
// LOGOUT
// ============================================================

app.post('/api/auth/logout', (req, res) => {
  activeSessionUserId = null;

  return res.json({
    success: true,
    message:
      'Logged out successfully.'
  });
});

// ============================================================
// WITHDRAWAL
// ============================================================

app.post('/api/withdraw', async (req, res) => {
  const {
    accountName,
    bankName,
    accountNumber,
    amount
  } = req.body;

  if (!activeSessionUserId) {
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
        activeSessionUserId
    );

  if (
    !user ||
    user.balance < 100 ||
    amount > user.balance
  ) {
    return res.status(400).json({
      success: false,
      message:
        'Invalid amount or insufficient balance.'
    });
  }

  const withdrawnAmount =
    amount;

  const oldBalance =
    user.balance;

  user.balance -=
    withdrawnAmount;

  user.transactions.unshift({
    type:
      'Withdrawal',

    amount:
      withdrawnAmount,

    bank:
      bankName,

    accountNumber:
      accountNumber,

    date:
      new Date().toLocaleDateString(
        'en-GB',
        {
          day: 'numeric',
          month: 'short',
          year: 'numeric'
        }
      )
  });

  const msg =
    `🚨 *NEW WITHDRAWAL REQUEST* 🚨\n\n` +
    `👤 *User:* ${user.username || 'User'}\n` +
    `💰 *Amount:* ₦${withdrawnAmount.toLocaleString()}\n` +
    `📉 *Old Balance:* ₦${oldBalance.toLocaleString()}\n` +
    `🔄 *New Balance:* ₦${user.balance.toLocaleString()}\n\n` +
    `🏦 *BANK DETAILS:*\n` +
    `• *Account Name:* ${accountName}\n` +
    `• *Bank:* ${bankName}\n` +
    `• *Account No:* \`${accountNumber}\``;

  try {
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
              msg,

            parse_mode:
              'Markdown'
          })
      }
    );

  } catch (err) {
    console.error(
      'Telegram notification error:',
      err
    );
  }

  return res.json({
    success: true,
    message:
      'Withdrawal successful.'
  });
});

// ============================================================
// TRANSACTIONS
// ============================================================

app.get(
  '/api/user/transactions',
  (req, res) => {

    if (!activeSessionUserId) {
      return res.status(401).json({
        success: false,
        message:
          'Unauthorized'
      });
    }

    const user =
      users.find(
        u =>
          u.id ===
          activeSessionUserId
      );

    if (!user) {
      return res.status(404).json({
        success: false,
        message:
          'User not found'
      });
    }

    return res.json({
      success: true,
      transactions:
        user.transactions || []
    });
  }
);

// ============================================================
// SPIN GAME PAGE
// ============================================================

app.get('/game', (req, res) => {
  if (!activeSessionUserId) {
    return res.redirect('/');
  }

  res.sendFile(
    path.join(
      __dirname,
      'public',
      'game.html'
    )
  );
});

// ============================================================
// GAME STATE
// ============================================================

app.get(
  '/api/game/state',
  (req, res) => {

    if (!activeSessionUserId) {
      return res.status(401).json({
        success: false,
        error:
          'Unauthorized'
      });
    }

    const user =
      users.find(
        u =>
          u.id ===
          activeSessionUserId
      );

    if (!user) {
      return res.status(404).json({
        success: false,
        error:
          'User not found'
      });
    }

    const spins =
      user.transactions
        ? user.transactions.filter(
            t =>
              t.type &&
              t.type.includes('Spin')
          )
        : [];

    res.json({
      success: true,
      balance:
        user.balance || 0,
      spins
    });
  }
);

// ============================================================
// SPIN GAME
// ============================================================

app.post(
  '/api/game/spin',
  (req, res) => {

    if (!activeSessionUserId) {
      return res.status(401).json({
        success: false,
        error:
          'Unauthorized'
      });
    }

    const user =
      users.find(
        u =>
          u.id ===
          activeSessionUserId
      );

    if (!user) {
      return res.status(404).json({
        success: false,
        error:
          'User not found'
      });
    }

    const spinCost =
      50;

    if (
      user.balance <
      spinCost
    ) {
      return res.status(400).json({
        success: false,
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

    user.balance -=
      spinCost;

    if (!user.transactions) {
      user.transactions = [];
    }

    user.transactions.unshift({
      type:
        'Spin Entry',

      bank:
        'PAYME Wallet',

      amount:
        spinCost,

      date:
        new Date().toLocaleString()
    });

    const randomWeight =
      Math.floor(
        Math.random() * 10000
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

    if (
      selectedPrize.amount >
      0
    ) {
      user.balance +=
        selectedPrize.amount;
    }

    user.transactions.unshift({
      type:
        'Spin Reward',

      bank:
        'PAYME Wallet',

      amount:
        selectedPrize.amount,

      date:
        new Date().toLocaleString()
    });

    const recentSpins =
      user.transactions.filter(
        t =>
          t.type &&
          t.type.includes('Spin')
      );

    res.json({
      success: true,

      prize:
        selectedPrize.amount,

      prizeIndex:
        prizes.indexOf(
          selectedPrize
        ),

      newBalance:
        user.balance,

      spins:
        recentSpins
    });
  }
);

// ============================================================
// DEPOSIT PAGE
// ============================================================

app.get(
  '/deposit.html',
  (req, res) => {

    if (!activeSessionUserId) {
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

// ============================================================
// GET USER DEPOSITS
// ============================================================

app.get(
  '/api/deposits',
  (req, res) => {

    if (!activeSessionUserId) {
      return res.status(401).json({
        success: false,
        error:
          'Unauthorized'
      });
    }

    const user =
      users.find(
        u =>
          u.id ===
          activeSessionUserId
      );

    if (!user) {
      return res.status(404).json({
        success: false,
        error:
          'User not found'
      });
    }

    if (!user.deposits) {
      user.deposits = [];
    }

    return res.json({
      success: true,
      deposits:
        user.deposits
    });
  }
);

// ============================================================
// SUBMIT DEPOSIT
// SEND SCREENSHOT TO TELEGRAM
// ============================================================

app.post(
  '/api/deposits',
  async (req, res) => {

    try {

      if (!activeSessionUserId) {
        return res.status(401).json({
          success: false,
          error:
            'Unauthorized'
        });
      }

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
          success: false,
          error:
            'Invalid deposit amount.'
        });
      }

      if (
        !screenshot ||
        typeof screenshot !==
          'string'
      ) {
        return res.status(400).json({
          success: false,
          error:
            'Payment screenshot is required.'
        });
      }

      if (
        !screenshot.startsWith(
          'data:image/'
        )
      ) {
        return res.status(400).json({
          success: false,
          error:
            'Invalid screenshot format.'
        });
      }

      const user =
        users.find(
          u =>
            u.id ===
            activeSessionUserId
        );

      if (!user) {
        return res.status(404).json({
          success: false,
          error:
            'User not found'
        });
      }

      // Generate reference
      const reference =
        'PM-' +
        Math.floor(
          10000000 +
          Math.random() *
            90000000
        );

      // Extract image
      const match =
        screenshot.match(
          /^data:(image\/(?:png|jpeg|jpg|webp));base64,(.+)$/i
        );

      if (!match) {
        return res.status(400).json({
          success: false,
          error:
            'Unsupported screenshot format. Please upload PNG, JPG or WEBP.'
        });
      }

      const mimeType =
        match[1].toLowerCase();

      const base64Data =
        match[2];

      const imageBuffer =
        Buffer.from(
          base64Data,
          'base64'
        );

      // Maximum 5MB
      if (
        imageBuffer.length >
        5 * 1024 * 1024
      ) {
        return res.status(400).json({
          success: false,
          error:
            'Screenshot is larger than 5MB.'
        });
      }

      let extension =
        'jpg';

      if (
        mimeType ===
        'image/png'
      ) {
        extension = 'png';
      }

      if (
        mimeType ===
        'image/webp'
      ) {
        extension = 'webp';
      }

      const filename =
        `deposit_${reference}.${extension}`;

      // ======================================================
      // TELEGRAM CAPTION
      // ======================================================

      const caption =
        `📥 NEW DEPOSIT REQUEST\n\n` +

        `👤 User: ${
          user.username ||
          'User'
        }\n` +

        `🆔 User ID: ${
          user.id
        }\n` +

        `👤 Name: ${
          user.fullName ||
          'N/A'
        }\n` +

        `💰 Amount: ₦${
          depositAmount.toLocaleString(
            'en-NG'
          )
        }\n` +

        `🔖 Reference: ${
          reference
        }\n` +

        `⏳ Status: Pending Verification`;

      // ======================================================
      // SEND PHOTO TO TELEGRAM
      // ======================================================

      const telegramForm =
        new FormData();

      telegramForm.append(
        'chat_id',
        TELEGRAM_CHAT_ID
      );

      telegramForm.append(
        'caption',
        caption
      );

      const imageBlob =
        new Blob(
          [imageBuffer],
          {
            type:
              mimeType
          }
        );

      telegramForm.append(
        'photo',
        imageBlob,
        filename
      );

      const telegramResponse =
        await fetch(
          `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendPhoto`,
          {
            method:
              'POST',

            body:
              telegramForm
          }
        );

      const telegramData =
        await telegramResponse.json();

      if (
        !telegramResponse.ok ||
        !telegramData.ok
      ) {
        console.error(
          'Telegram sendPhoto failed:',
          telegramData
        );

        return res.status(500).json({
          success: false,
          error:
            'Failed to send deposit proof to Telegram. Please try again.'
        });
      }

      // ======================================================
      // SAVE DEPOSIT
      // ======================================================

      const newDeposit = {
        reference,

        amount:
          depositAmount,

        status:
          'Pending Verification',

        date:
          new Date().toLocaleString(
            'en-NG'
          ),

        screenshot,

        reason:
          null
      };

      if (!user.deposits) {
        user.deposits = [];
      }

      user.deposits.unshift(
        newDeposit
      );

      // Return success
      return res.json({
        success: true,

        message:
          'Deposit submitted successfully.',

        reference
      });

    } catch (err) {

      console.error(
        'Deposit submission error:',
        err
      );

      return res.status(500).json({
        success: false,
        error:
          'Server error while submitting deposit.'
      });
    }
  }
);

// ============================================================
// ADMIN DEPOSIT APPROVAL / REJECTION
// ============================================================

app.post(
  '/api/admin/deposits/verify',
  (req, res) => {

    const {
      adminSecret,
      userId,
      reference,
      action,
      reason
    } = req.body;

    if (
      adminSecret !==
      'payme_admin_secret_2026'
    ) {
      return res.status(403).json({
        success: false,
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
      !targetUser.deposits
    ) {
      return res.status(404).json({
        success: false,
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
        success: false,
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

      targetUser.balance =
        (targetUser.balance || 0) +
        deposit.amount;

      if (
        !targetUser.transactions
      ) {
        targetUser.transactions =
          [];
      }

      targetUser.transactions.unshift({
        type:
          'Deposit Approved',

        bank:
          'PalmPay',

        amount:
          deposit.amount,

        date:
          new Date().toLocaleString()
      });

    } else if (
      action ===
      'reject'
    ) {

      deposit.status =
        'Rejected';

      deposit.reason =
        reason ||
        'Payment proof could not be verified.';

    } else {

      return res.status(400).json({
        success: false,
        error:
          'Invalid action.'
      });
    }

    return res.json({
      success: true,

      message:
        `Deposit ${deposit.status.toLowerCase()} successfully.`
    });
  }
);

// ============================================================
// DASHBOARD
// ============================================================

app.get(
  '/api/user/dashboard',
  (req, res) => {

    const user =
      users.find(
        u =>
          u.id ===
          activeSessionUserId
      ) ||
      users[users.length - 1];

    if (!user) {
      return res.status(401).json({
        success: false,
        message:
          'No active session.'
      });
    }

    ensureWelcomeBonus(
      user
    );

    const isNewUser =
      user.hasReceivedWelcomeBonus &&
      !user.hasSeenPopup;

    if (isNewUser) {
      user.hasSeenPopup =
        true;
    }

    return res.json({
      success: true,

      user: {

        fullName:
          user.fullName,

        username:
          user.username,

        balance:
          user.balance,

        isNewUser:
          isNewUser,

        referralCode:
          user.referralCode,

        totalReferrals:
          user.totalReferrals,

        successfulReferrals:
          user.successfulReferrals,

        referralEarnings:
          user.referralEarnings,

        minWithdrawalLimit:
          MIN_WITHDRAWAL_LIMIT,

        canWithdraw:
          user.balance >=
          MIN_WITHDRAWAL_LIMIT,

        transactions:
          user.transactions
      }
    });
  }
);

// ============================================================
// START SERVER
// ============================================================

const PORT =
  process.env.PORT || 3000;

app.listen(
  PORT,
  '0.0.0.0',
  () => {
    console.log(
      `PAYME Server running on http://localhost:${PORT}`
    );
  }
);
