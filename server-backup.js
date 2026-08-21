const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');


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

// CONFIGURATION
const TELEGRAM_BOT_TOKEN = '8906287436:AAEWSp7G0xCmsCzdafjiGmPqGuceER8vvuc';
const TELEGRAM_CHAT_ID = '7686847796';

// REWARD STRUCTURE CONFIG
const WELCOME_BONUS = 10;
const REFERRAL_REWARD = 15;
const MIN_WITHDRAWAL_LIMIT = 100;

// ======================================================
// PERSISTENT DATABASE
// ======================================================

const DATABASE_FILE = path.join(__dirname, 'payme-data.json');

let users = [];
let activeSessionUserId = null;


// Load saved data when server starts
function loadDatabase() {
  try {
    if (fs.existsSync(DATABASE_FILE)) {
      const data = fs.readFileSync(
        DATABASE_FILE,
        'utf8'
      );

      const database = JSON.parse(data);

      users = Array.isArray(database.users)
        ? database.users
        : [];

      activeSessionUserId =
        database.activeSessionUserId || null;

      console.log(
        `Database loaded successfully. Users: ${users.length}`
      );

    } else {
      users = [];
      activeSessionUserId = null;

      saveDatabase();

      console.log(
        'No existing database found. New database created.'
      );
    }

  } catch (err) {

    console.error(
      'Database loading error:',
      err
    );

    users = [];
    activeSessionUserId = null;
  }
}


// Save everything to disk
function saveDatabase() {
  try {

    const database = {
      users: users,
      activeSessionUserId: activeSessionUserId
    };

    fs.writeFileSync(
      DATABASE_FILE,
      JSON.stringify(database, null, 2),
      'utf8'
    );

  } catch (err) {

    console.error(
      'Database saving error:',
      err
    );
  }
}


// Load database immediately
loadDatabase();

// Helper: Generate Unique 6-Digit Alphanumeric Referral Code
function generateReferralCode() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let code = '';

  for (let i = 0; i < 6; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }

  return code;
}

// Helper: Send Telegram Notification
async function sendTelegramNotification(message) {
  if (!TELEGRAM_BOT_TOKEN || TELEGRAM_BOT_TOKEN.includes('YOUR_TELEGRAM')) {
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
      console.error('Telegram API error:', data);
    }
  } catch (err) {
    console.error('Telegram notification error:', err.message);
  }
}

// Helper: Ensure user gets Welcome Bonus idempotently
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

// SIGN UP ROUTE
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

    if (!fullName || fullName.trim().length < 2) {
      return res.status(400).json({
        success: false,
        message: 'Please enter your full name.'
      });
    }

    if (!email || !email.includes('@')) {
      return res.status(400).json({
        success: false,
        message: 'Please enter a valid email address.'
      });
    }

    if (!username || username.trim().length < 3) {
      return res.status(400).json({
        success: false,
        message: 'Username must be at least 3 characters.'
      });
    }

    if (!phone || phone.trim().length < 7) {
      return res.status(400).json({
        success: false,
        message: 'Please enter a valid phone number.'
      });
    }

    if (!password || password.length < 8) {
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

    const cleanUsername = username.trim().toLowerCase();
    const cleanEmail = email.trim().toLowerCase();
    const cleanPhone = `${countryCode || '+234'}${phone.trim()}`;
    const cleanRefInput = referralCode
      ? referralCode.trim().toUpperCase()
      : null;

    if (users.find(u => u.username === cleanUsername)) {
      return res.status(400).json({
        success: false,
        message: 'Username is already taken.'
      });
    }

    if (users.find(u => u.email === cleanEmail)) {
      return res.status(400).json({
        success: false,
        message: 'Email address is already registered.'
      });
    }

    // Generate unique referral code
    let uniqueRefCode = generateReferralCode();

    while (users.some(u => u.referralCode === uniqueRefCode)) {
      uniqueRefCode = generateReferralCode();
    }

    const newUser = {
      id: 'usr_' + Date.now(),

      fullName: fullName.trim(),
      email: cleanEmail,
      username: cleanUsername,
      phone: cleanPhone,
      password,

      balance: 0.00,

      hasReceivedWelcomeBonus: false,
      hasSeenPopup: false,

      referralCode: uniqueRefCode,
      referredBy: cleanRefInput,

      totalReferrals: 0,
      successfulReferrals: 0,
      referralEarnings: 0.00,

      transactions: [],
      deposits: [],

      createdAt: new Date().toISOString()
    };

    // Give new user ₦10 welcome bonus
    ensureWelcomeBonus(newUser);

    // Process referral reward
    if (newUser.referredBy) {
      const referrer = users.find(
        u => u.referralCode === newUser.referredBy
      );

      if (referrer) {
        referrer.balance += REFERRAL_REWARD;
        referrer.totalReferrals += 1;
        referrer.successfulReferrals += 1;
        referrer.referralEarnings += REFERRAL_REWARD;

        referrer.transactions.unshift({
          id: 'tx_ref_' + Date.now(),
          type: 'referral_reward',
          description: `Referral Reward (@${newUser.username})`,
          amount: REFERRAL_REWARD,
          currency: 'NGN',
          status: 'completed',
          createdAt: new Date().toISOString()
        });
      }
    }

    users.push(newUser);

    activeSessionUserId = newUser.id;
saveDatabase();

    // New User Telegram Alert
    const signupMsg =
      `🆕 <b>NEW USER REGISTERED</b>\n\n` +
      `👤 <b>Name:</b> ${newUser.fullName}\n` +
      `🆔 <b>Username:</b> @${newUser.username}\n` +
      `📧 <b>Email:</b> ${newUser.email}\n` +
      `📱 <b>Phone:</b> ${newUser.phone}\n` +
      `🎁 <b>Welcome Bonus:</b> ₦${WELCOME_BONUS}\n` +
      `🔗 <b>Referral Code:</b> ${newUser.referralCode}\n` +
      `👥 <b>Referred By:</b> ${newUser.referredBy || 'None'}\n` +
      `💰 <b>Balance:</b> ₦${newUser.balance.toFixed(2)}`;

    await sendTelegramNotification(signupMsg);

    return res.json({
      success: true,
      message: 'Signup successful',
      user: {
        id: newUser.id,
        fullName: newUser.fullName,
        username: newUser.username,
        balance: newUser.balance
      }
    });

  } catch (err) {
    console.error('Signup error:', err);

    return res.status(500).json({
      success: false,
      message: 'Server error during signup.'
    });
  }
});

// LOGIN ROUTE
app.post('/api/auth/login', async (req, res) => {
  const { loginIdentifier, password } = req.body;

  if (!loginIdentifier || !password) {
    return res.status(400).json({
      success: false,
      message: 'Missing fields.'
    });
  }

  const cleanId = loginIdentifier.trim().toLowerCase();

  const user = users.find(
    u => u.username === cleanId || u.email === cleanId
  );

  if (!user || user.password !== password) {
    return res.status(401).json({
      success: false,
      message: 'Invalid credentials.'
    });
  }

  ensureWelcomeBonus(user);

  activeSessionUserId = user.id;
saveDatabase();

  const loginMsg =
    `🔐 <b>USER LOGIN ALERT</b>\n\n` +
    `👤 <b>Name:</b> ${user.fullName}\n` +
    `🆔 <b>Username:</b> @${user.username}\n` +
    `💰 <b>Current Balance:</b> ₦${user.balance.toFixed(2)}`;

  sendTelegramNotification(loginMsg).catch(err =>
    console.error('Telegram error:', err.message)
  );

  return res.json({
    success: true,
    message: 'Login successful',
    user: {
      id: user.id,
      fullName: user.fullName,
      username: user.username,
      balance: user.balance
    }
  });
});

// LOGOUT ROUTE
app.post('/api/auth/logout', (req, res) => {
  activeSessionUserId = null;

saveDatabase();

  return res.json({
    success: true,
    message: 'Logged out successfully.'
  });
});

// WITHDRAWAL API ROUTE
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
      message: 'Unauthorized session.'
    });
  }

  const user = users.find(u => u.id === activeSessionUserId);

  if (!user) {
    return res.status(404).json({
      success: false,
      message: 'User not found.'
    });
  }

  const withdrawnAmount = Number(amount);

  if (
    !Number.isFinite(withdrawnAmount) ||
    withdrawnAmount < MIN_WITHDRAWAL_LIMIT ||
    withdrawnAmount > user.balance
  ) {
    return res.status(400).json({
      success: false,
      message: `Minimum withdrawal is ₦${MIN_WITHDRAWAL_LIMIT} and amount cannot exceed your balance.`
    });
  }

  if (!accountName || !bankName || !accountNumber) {
    return res.status(400).json({
      success: false,
      message: 'Please provide complete bank details.'
    });
  }

  const oldBalance = user.balance;

  // Deduct balance
  user.balance -= withdrawnAmount;

  if (!user.transactions) {
    user.transactions = [];
  }

  user.transactions.unshift({
    id: 'tx_withdraw_' + Date.now(),
    type: 'Withdrawal',
    amount: withdrawnAmount,
    bank: bankName,
    accountName,
    accountNumber,
    status: 'Pending',
    date: new Date().toLocaleString()
  });

  // Telegram Alert
  const msg =
    `🚨 <b>NEW WITHDRAWAL REQUEST</b> 🚨\n\n` +
    `👤 <b>User:</b> @${user.username || 'User'}\n` +
    `💰 <b>Amount:</b> ₦${withdrawnAmount.toLocaleString()}\n` +
    `📉 <b>Old Balance:</b> ₦${oldBalance.toLocaleString()}\n` +
    `🔄 <b>New Balance:</b> ₦${user.balance.toLocaleString()}\n\n` +
    `🏦 <b>BANK DETAILS</b>\n` +
    `• <b>Account Name:</b> ${accountName}\n` +
    `• <b>Bank:</b> ${bankName}\n` +
    `• <b>Account No:</b> ${accountNumber}`;

  await sendTelegramNotification(msg);

saveDatabase();

  return res.json({
    success: true,
    message: 'Withdrawal request submitted successfully.',
    balance: user.balance
  });
});

// TRANSACTIONS API ROUTE
app.get('/api/user/transactions', (req, res) => {
  if (!activeSessionUserId) {
    return res.status(401).json({
      success: false,
      message: 'Unauthorized'
    });
  }

  const user = users.find(u => u.id === activeSessionUserId);

  if (!user) {
    return res.status(404).json({
      success: false,
      message: 'User not found'
    });
  }

  return res.json({
    success: true,
    transactions: user.transactions || []
  });
});

// SPIN GAME PAGE
app.get('/game', (req, res) => {
  if (!activeSessionUserId) {
    return res.redirect('/');
  }

  res.sendFile(path.join(__dirname, 'public', 'game.html'));
});

// GAME STATE
app.get('/api/game/state', (req, res) => {
  if (!activeSessionUserId) {
    return res.status(401).json({
      success: false,
      error: 'Unauthorized'
    });
  }

  const user = users.find(u => u.id === activeSessionUserId);

  if (!user) {
    return res.status(404).json({
      success: false,
      error: 'User not found'
    });
  }

  const spins = user.transactions
    ? user.transactions.filter(
        t => t.type && t.type.includes('Spin')
      )
    : [];

  return res.json({
    success: true,
    balance: user.balance || 0,
    spins
  });
});

// SPIN ENDPOINT
app.post('/api/game/spin', (req, res) => {
  if (!activeSessionUserId) {
    return res.status(401).json({
      success: false,
      error: 'Unauthorized'
    });
  }

  const user = users.find(u => u.id === activeSessionUserId);

  if (!user) {
    return res.status(404).json({
      success: false,
      error: 'User not found'
    });
  }

  const spinCost = 50;

  if (user.balance < spinCost) {
    return res.status(400).json({
      success: false,
      error: 'Insufficient balance. You need at least ₦50.'
    });
  }

  const prizes = [
    { amount: 0, weight: 2000, label: '₦0' },
    { amount: 10, weight: 2500, label: '₦10' },
    { amount: 20, weight: 2500, label: '₦20' },
    { amount: 50, weight: 1800, label: '₦50' },
    { amount: 100, weight: 800, label: '₦100' },
    { amount: 250, weight: 250, label: '₦250' },
    { amount: 500, weight: 100, label: '₦500' },
    { amount: 1000, weight: 45, label: '₦1000' },
    { amount: 2000, weight: 5, label: '₦2000' }
  ];

  // Deduct spin cost
  user.balance -= spinCost;

  if (!user.transactions) {
    user.transactions = [];
  }

  user.transactions.unshift({
    id: 'tx_spin_entry_' + Date.now(),
    type: 'Spin Entry',
    bank: 'PAYME Wallet',
    amount: spinCost,
    date: new Date().toLocaleString()
  });

  // Weighted random outcome
  const totalWeight = prizes.reduce(
    (total, prize) => total + prize.weight,
    0
  );

  const randomWeight = Math.floor(
    Math.random() * totalWeight
  );

  let cumulativeWeight = 0;
  let selectedPrize = prizes[0];

  for (const prize of prizes) {
    cumulativeWeight += prize.weight;

    if (randomWeight < cumulativeWeight) {
      selectedPrize = prize;
      break;
    }
  }

  // Credit prize
  if (selectedPrize.amount > 0) {
    user.balance += selectedPrize.amount;
  }

  user.transactions.unshift({
    id: 'tx_spin_reward_' + Date.now(),
    type: 'Spin Reward',
    bank: 'PAYME Wallet',
    amount: selectedPrize.amount,
    date: new Date().toLocaleString()
  });

saveDatabase();

  const recentSpins = user.transactions.filter(
    t => t.type && t.type.includes('Spin')
  );

  return res.json({
    success: true,
    prize: selectedPrize.amount,
    prizeIndex: prizes.indexOf(selectedPrize),
    newBalance: user.balance,
    spins: recentSpins
  });
});

// DEPOSIT PAGE
app.get('/deposit.html', (req, res) => {
  if (!activeSessionUserId) {
    return res.redirect('/');
  }

  res.sendFile(path.join(__dirname, 'public', 'deposit.html'));
});

// GET USER DEPOSITS
app.get('/api/deposits', (req, res) => {
  if (!activeSessionUserId) {
    return res.status(401).json({
      success: false,
      error: 'Unauthorized'
    });
  }

  const user = users.find(u => u.id === activeSessionUserId);

  if (!user) {
    return res.status(404).json({
      success: false,
      error: 'User not found'
    });
  }

  if (!user.deposits) {
    user.deposits = [];
  }

  return res.json({
    success: true,
    deposits: user.deposits
  });
});

// SUBMIT DEPOSIT
// SUBMIT DEPOSIT + SEND SCREENSHOT TO TELEGRAM
app.post('/api/deposits', async (req, res) => {
  if (!activeSessionUserId) {
    return res.status(401).json({
      success: false,
      error: 'Unauthorized'
    });
  }

  const { amount, screenshot } = req.body;

  const depositAmount = Number(amount);

  if (!Number.isFinite(depositAmount) || depositAmount <= 0) {
    return res.status(400).json({
      success: false,
      error: 'Invalid deposit amount.'
    });
  }

  if (!screenshot) {
    return res.status(400).json({
      success: false,
      error: 'Payment screenshot is required.'
    });
  }

  const user = users.find(u => u.id === activeSessionUserId);

  if (!user) {
    return res.status(404).json({
      success: false,
      error: 'User not found.'
    });
  }

  // Generate deposit reference
  const reference =
    'PM-' + Math.floor(10000000 + Math.random() * 90000000);

  // Create deposit record
  const newDeposit = {
    reference: reference,
    amount: depositAmount,
    status: 'Pending Verification',
    date: new Date().toLocaleString(),
    screenshot: screenshot,
    reason: null
  };

  if (!user.deposits) {
    user.deposits = [];
  }

  user.deposits.unshift(newDeposit);

saveDatabase();

  try {
    // Check that screenshot is a valid Base64 image
    const matches = screenshot.match(
      /^data:image\/([a-zA-Z0-9.+-]+);base64,(.+)$/
    );

    if (!matches) {
      return res.status(400).json({
        success: false,
        error: 'Invalid screenshot format.'
      });
    }

    const imageType = matches[1];
    const base64Data = matches[2];

    // Convert Base64 image into a Buffer
    const imageBuffer = Buffer.from(base64Data, 'base64');

    // Create Telegram message
    const caption =
      `📥 NEW DEPOSIT REQUEST\n\n` +
      `👤 Name: ${user.fullName}\n` +
      `🆔 Username: @${user.username}\n` +
      `📧 Email: ${user.email}\n` +
      `💰 Amount: ₦${depositAmount.toLocaleString()}\n` +
      `🔖 Reference: ${reference}\n` +
      `⏳ Status: Pending Verification`;

    // Use Node's built-in FormData
    const formData = new FormData();

    formData.append(
      'chat_id',
      TELEGRAM_CHAT_ID
    );

    formData.append(
      'caption',
      caption
    );

    // Convert Buffer to Blob for FormData
    const imageBlob = new Blob(
      [imageBuffer],
      {
        type: `image/${imageType}`
      }
    );

    formData.append(
      'photo',
      imageBlob,
      `deposit-${reference}.${imageType}`
    );

    // Send photo to Telegram
    formData.append(
  'reply_markup',
  JSON.stringify({
    inline_keyboard: [
      [
        {
          text: '✅ APPROVE',
          callback_data: `approve_deposit:${user.id}:${reference}`
        },
        {
          text: '❌ REJECT',
          callback_data: `reject_deposit:${user.id}:${reference}`
        }
      ]
    ]
  })
);

const telegramResponse = await fetch(
  `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendPhoto`,
  {
    method: 'POST',
    body: formData
  }
);

    const telegramData = await telegramResponse.json();

    console.log('Telegram response:', telegramData);

    if (!telegramData.ok) {
      console.error(
        'Telegram error:',
        telegramData
      );

      return res.status(500).json({
        success: false,
        error: 'Deposit saved, but Telegram notification failed.'
      });
    }

    console.log(
      `Deposit ${reference} sent to Telegram successfully.`
    );

    return res.json({
      success: true,
      reference: reference,
      message: 'Deposit submitted successfully.'
    });

  } catch (err) {

    console.error(
      'Telegram deposit error:',
      err
    );

    return res.status(500).json({
      success: false,
      error: 'Deposit saved, but Telegram notification failed.'
    });
  }
});

// ADMIN DEPOSIT APPROVAL / REJECTION
app.post('/api/admin/deposits/verify', async (req, res) => {
  const {
    adminSecret,
    userId,
    reference,
    action,
    reason
  } = req.body;

  if (adminSecret !== 'payme_admin_secret_2026') {
    return res.status(403).json({
      success: false,
      error: 'Forbidden'
    });
  }

  const targetUser = users.find(u => u.id === userId);

  if (!targetUser || !targetUser.deposits) {
    return res.status(404).json({
      success: false,
      error: 'User or deposits not found'
    });
  }

  const deposit = targetUser.deposits.find(
    d => d.reference === reference
  );

  if (
    !deposit ||
    deposit.status !== 'Pending Verification'
  ) {
    return res.status(400).json({
      success: false,
      error: 'Deposit not found or already verified'
    });
  }

  if (action === 'approve') {
    deposit.status = 'Approved';

    targetUser.balance =
      (targetUser.balance || 0) + deposit.amount;

    if (!targetUser.transactions) {
      targetUser.transactions = [];
    }

    targetUser.transactions.unshift({
      id: 'tx_deposit_' + Date.now(),
      type: 'Deposit Approved',
      bank: 'PalmPay',
      amount: deposit.amount,
      reference: deposit.reference,
      status: 'completed',
      date: new Date().toLocaleString()
    });

saveDatabase();

  } else if (action === 'reject') {
    deposit.status = 'Rejected';
    deposit.reason =
      reason || 'Payment proof could not be verified.';
saveDatabase();


  } else {
    return res.status(400).json({
      success: false,
      error: 'Invalid action. Use approve or reject.'
    });
  }

  return res.json({
    success: true,
    message:
      `Deposit ${deposit.status.toLowerCase()} successfully.`,
    deposit,
    balance: targetUser.balance
  });
});

// DASHBOARD API ROUTE
app.get('/api/user/dashboard', (req, res) => {
  const user =
    users.find(u => u.id === activeSessionUserId) ||
    users[users.length - 1];

  if (!user) {
    return res.status(401).json({
      success: false,
      message: 'No active session.'
    });
  }

  ensureWelcomeBonus(user);

  const isNewUser =
    user.hasReceivedWelcomeBonus &&
    !user.hasSeenPopup;

  if (isNewUser) {
    user.hasSeenPopup = true;
saveDatabase();
  }

  return res.json({
    success: true,

    user: {
      id: user.id,
      fullName: user.fullName,
      username: user.username,

      balance: user.balance,

      isNewUser,

      referralCode: user.referralCode,
      totalReferrals: user.totalReferrals,
      successfulReferrals: user.successfulReferrals,
      referralEarnings: user.referralEarnings,

      minWithdrawalLimit: MIN_WITHDRAWAL_LIMIT,
      canWithdraw:
        user.balance >= MIN_WITHDRAWAL_LIMIT,

      transactions: user.transactions || [],
      deposits: user.deposits || []
    }
  });
});


// ======================================================
// TELEGRAM DEPOSIT APPROVAL / REJECTION BUTTON HANDLER
// ======================================================

let telegramUpdateOffset = 0;

async function handleTelegramCallback(callbackQuery) {
  try {
    // Only allow your configured Telegram admin chat
    if (String(callbackQuery.message?.chat?.id) !== String(TELEGRAM_CHAT_ID)) {
      return;
    }

    const data = callbackQuery.data || '';

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

    const targetUser = users.find(u => u.id === userId);

    if (!targetUser || !targetUser.deposits) {
      await answerTelegramCallback(
        callbackQuery.id,
        '❌ User or deposit not found.'
      );
      return;
    }

    const deposit = targetUser.deposits.find(
      d => d.reference === reference
    );

    if (!deposit) {
      await answerTelegramCallback(
        callbackQuery.id,
        '❌ Deposit not found.'
      );
      return;
    }

    // Prevent approving/rejecting the same deposit twice
    if (deposit.status !== 'Pending Verification') {
      await answerTelegramCallback(
        callbackQuery.id,
        `⚠️ Already ${deposit.status}.`
      );
      return;
    }

    // ==================================================
    // APPROVE DEPOSIT
    // ==================================================

    if (action === 'approve_deposit') {

      deposit.status = 'Approved';
      deposit.reason = null;
      deposit.verifiedAt = new Date().toISOString();

      // Add deposit amount to user's balance
      targetUser.balance =
        Number(targetUser.balance || 0) +
        Number(deposit.amount);

      // Add transaction
      if (!targetUser.transactions) {
        targetUser.transactions = [];
      }

      targetUser.transactions.unshift({
        id: 'tx_deposit_' + Date.now(),
        type: 'Deposit Approved',
        description: `Deposit ${deposit.reference}`,
        amount: Number(deposit.amount),
        currency: 'NGN',
        bank: 'PalmPay',
        reference: deposit.reference,
        status: 'completed',
        date: new Date().toLocaleString(),
        createdAt: new Date().toISOString()
      });

saveDatabase();

      // Tell Telegram
      await answerTelegramCallback(
        callbackQuery.id,
        '✅ Deposit approved!'
      );

      // Update Telegram message
      await editTelegramMessage(
        callbackQuery.message.chat.id,
        callbackQuery.message.message_id,
        `✅ DEPOSIT APPROVED\n\n` +
        `👤 Name: ${targetUser.fullName}\n` +
        `🆔 Username: @${targetUser.username}\n` +
        `💰 Amount: ₦${Number(deposit.amount).toLocaleString()}\n` +
        `🔖 Reference: ${deposit.reference}\n` +
        `💳 New Balance: ₦${Number(targetUser.balance).toLocaleString()}\n` +
        `✅ Status: Approved`
      );

      console.log(
        `Deposit ${reference} approved for ${targetUser.username}`
      );

      return;
    }

    // ==================================================
    // REJECT DEPOSIT
    // ==================================================

    if (action === 'reject_deposit') {

      deposit.status = 'Rejected';
      deposit.reason = 'Payment proof was rejected.';
      deposit.rejectedAt = new Date().toISOString();
saveDatabase();
      await answerTelegramCallback(
        callbackQuery.id,
        '❌ Deposit rejected.'
      );

      await editTelegramMessage(
        callbackQuery.message.chat.id,
        callbackQuery.message.message_id,
        `❌ DEPOSIT REJECTED\n\n` +
        `👤 Name: ${targetUser.fullName}\n` +
        `🆔 Username: @${targetUser.username}\n` +
        `💰 Amount: ₦${Number(deposit.amount).toLocaleString()}\n` +
        `🔖 Reference: ${deposit.reference}\n` +
        `❌ Status: Rejected\n` +
        `📝 Reason: Payment proof was rejected.`
      );

      console.log(
        `Deposit ${reference} rejected for ${targetUser.username}`
      );

      return;
    }

  } catch (err) {
    console.error(
      'Telegram callback error:',
      err
    );
  }
}


// ======================================================
// ANSWER TELEGRAM BUTTON
// ======================================================

async function answerTelegramCallback(callbackId, text) {
  try {
    await fetch(
      `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/answerCallbackQuery`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          callback_query_id: callbackId,
          text: text
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


// ======================================================
// EDIT TELEGRAM DEPOSIT MESSAGE
// ======================================================

async function editTelegramMessage(
  chatId,
  messageId,
  text
) {
  try {
    await fetch(
      `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/editMessageCaption`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          chat_id: chatId,
          message_id: messageId,
          caption: text,
          reply_markup: JSON.stringify({
            inline_keyboard: []
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


// ======================================================
// REAL-TIME TOP EARNERS LEADERBOARD
// ======================================================

app.get('/api/leaderboard', (req, res) => {
  try {
    const leaderboard = users
      .map(user => ({
        username: user.username,
        totalReferrals: Number(user.totalReferrals || 0),
        referralEarnings: Number(user.referralEarnings || 0)
      }))
      .filter(user => user.totalReferrals > 0)
      .sort((a, b) => b.referralEarnings - a.referralEarnings)
      .slice(0, 10);

    return res.json({
      success: true,
      leaderboard
    });

  } catch (err) {
    console.error('Leaderboard error:', err);

    return res.status(500).json({
      success: false,
      error: 'Failed to load leaderboard.'
    });
  }
});




// ======================================================
// TELEGRAM LONG POLLING
// ======================================================

async function pollTelegramUpdates() {

  try {

    const response = await fetch(
      `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getUpdates?` +
      `timeout=25&offset=${telegramUpdateOffset}`
    );

    const data = await response.json();

    if (!data.ok) {
      console.error(
        'Telegram polling error:',
        data
      );

      setTimeout(pollTelegramUpdates, 5000);
      return;
    }

    for (const update of data.result) {

      telegramUpdateOffset =
        update.update_id + 1;

      if (update.callback_query) {
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


// Start Telegram polling
pollTelegramUpdates();


// SERVER
const PORT = 3000;

app.listen(PORT, '0.0.0.0', () => {
  console.log(
    `PAYME Server running on http://localhost:${PORT}`
  );
});
