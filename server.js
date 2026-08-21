
const express = require('express');
const session = require('express-session');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const app = express();

// Trust Render's reverse proxy (REQUIRED for secure cookies on Render)
app.set('trust proxy', 1);

// Middleware
app.use(cors({
  origin: true,
  credentials: true
}));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ limit: '10mb', extended: true }));
app.use(express.static('public'));

// Session Middleware Configuration
app.use(session({
  secret: 'payme_secret_session_key_2026',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === 'production', // True on HTTPS production
    httpOnly: true,
    maxAge: 7 * 24 * 60 * 60 * 1000 // 7 Days
  }
}));

// HTML PAGE ROUTES
app.get('/earn', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'earn.html'));
});

app.get('/leaderboard.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'leaderboard.html'));
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
global.weeklyCompetitions = [];

// Load saved data when server starts
function loadDatabase() {
  try {
    if (fs.existsSync(DATABASE_FILE)) {
      const data = fs.readFileSync(DATABASE_FILE, 'utf8');
      const database = JSON.parse(data);

      users = Array.isArray(database.users) ? database.users : [];
      global.weeklyCompetitions = Array.isArray(database.weeklyCompetitions)
        ? database.weeklyCompetitions
        : [];

      // Ensure withdrawableBalance exists on all existing users
      users.forEach(user => {
        if (typeof user.withdrawableBalance === 'undefined') {
          user.withdrawableBalance = user.referralEarnings || 0;
        }
      });

      console.log(`Database loaded successfully. Users: ${users.length}`);
    } else {
      users = [];
      saveDatabase();
      console.log('No existing database found. New database created.');
    }
  } catch (err) {
    console.error('Database loading error:', err);
    users = [];
  }
}

// Save everything to disk
function saveDatabase() {
  try {
    const database = {
      users: users,
      weeklyCompetitions: global.weeklyCompetitions || []
    };

    fs.writeFileSync(DATABASE_FILE, JSON.stringify(database, null, 2), 'utf8');
  } catch (err) {
    console.error('Database saving error:', err);
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
        headers: { 'Content-Type': 'application/json' },
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
  if (typeof user.withdrawableBalance === 'undefined') {
    user.withdrawableBalance = user.referralEarnings || 0;
  }

  if (!user.hasReceivedWelcomeBonus) {
    user.balance += WELCOME_BONUS;
    user.withdrawableBalance += WELCOME_BONUS;
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
      return res.status(400).json({ success: false, message: 'Please enter your full name.' });
    }

    if (!email || !email.includes('@')) {
      return res.status(400).json({ success: false, message: 'Please enter a valid email address.' });
    }

    if (!username || username.trim().length < 3) {
      return res.status(400).json({ success: false, message: 'Username must be at least 3 characters.' });
    }

    if (!phone || phone.trim().length < 7) {
      return res.status(400).json({ success: false, message: 'Please enter a valid phone number.' });
    }

    if (!password || password.length < 8) {
      return res.status(400).json({ success: false, message: 'Password must be at least 8 characters.' });
    }

    if (!agreeTerms) {
      return res.status(400).json({ success: false, message: 'Please accept the Terms of Service.' });
    }

    const cleanUsername = username.trim().toLowerCase();
    const cleanEmail = email.trim().toLowerCase();
    const cleanPhone = `${countryCode || '+234'}${phone.trim()}`;
    const cleanRefInput = referralCode ? referralCode.trim().toUpperCase() : null;

    if (users.find(u => u.username === cleanUsername)) {
      return res.status(400).json({ success: false, message: 'Username is already taken.' });
    }

    if (users.find(u => u.email === cleanEmail)) {
      return res.status(400).json({ success: false, message: 'Email address is already registered.' });
    }

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
      withdrawableBalance: 0.00,
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

    ensureWelcomeBonus(newUser);

    if (newUser.referredBy) {
      const referrer = users.find(u => u.referralCode === newUser.referredBy);

      if (referrer && referrer.id !== newUser.id) {
        const competition = ensureWeeklyCompetition();
        const referralConfirmedAt = new Date().toISOString();

        referrer.balance = Number(referrer.balance || 0) + REFERRAL_REWARD;
        referrer.withdrawableBalance = Number(referrer.withdrawableBalance || 0) + REFERRAL_REWARD;
        referrer.totalReferrals = Number(referrer.totalReferrals || 0) + 1;
        referrer.successfulReferrals = Number(referrer.successfulReferrals || 0) + 1;
        referrer.referralEarnings = Number(referrer.referralEarnings || 0) + REFERRAL_REWARD;

        if (!referrer.transactions) {
          referrer.transactions = [];
        }

        referrer.transactions.unshift({
          id: 'tx_ref_' + Date.now(),
          type: 'referral_reward',
          description: `Referral Reward (@${newUser.username})`,
          amount: REFERRAL_REWARD,
          currency: 'NGN',
          status: 'completed',
          createdAt: referralConfirmedAt
        });

        if (!competition.referralCounts) competition.referralCounts = {};
        if (!competition.referralFirstReachedAt) competition.referralFirstReachedAt = {};

        const currentWeeklyCount = Number(competition.referralCounts[referrer.id] || 0);
        const newWeeklyCount = currentWeeklyCount + 1;
        competition.referralCounts[referrer.id] = newWeeklyCount;

        if (!competition.referralFirstReachedAt[referrer.id]) {
          competition.referralFirstReachedAt[referrer.id] = {};
        }

        if (!competition.referralFirstReachedAt[referrer.id][newWeeklyCount]) {
          competition.referralFirstReachedAt[referrer.id][newWeeklyCount] = referralConfirmedAt;
        }

        if (!Array.isArray(referrer.weeklyReferralEvents)) {
          referrer.weeklyReferralEvents = [];
        }

        referrer.weeklyReferralEvents.push({
          referredUserId: newUser.id,
          referredUsername: newUser.username,
          confirmedAt: referralConfirmedAt,
          eligible: true,
          competitionId: competition.competitionId
        });

        if (!referrer.weeklyReferralHistory) {
          referrer.weeklyReferralHistory = {};
        }

        referrer.weeklyReferralHistory[competition.competitionId] = newWeeklyCount;
      }
    }

    users.push(newUser);
    
    // Assign unique user ID to request session
    req.session.userId = newUser.id;
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
      `💰 <b>Balance:</b> ₦${newUser.balance.toFixed(2)}`;

    await sendTelegramNotification(signupMsg);

    return res.json({
      success: true,
      message: 'Signup successful',
      user: {
        id: newUser.id,
        fullName: newUser.fullName,
        username: newUser.username,
        balance: newUser.balance,
        withdrawableBalance: newUser.withdrawableBalance
      }
    });
  } catch (err) {
    console.error('Signup error:', err);
    return res.status(500).json({ success: false, message: 'Server error during signup.' });
  }
});

// LOGIN ROUTE
app.post('/api/auth/login', async (req, res) => {
  const { loginIdentifier, password } = req.body;

  if (!loginIdentifier || !password) {
    return res.status(400).json({ success: false, message: 'Missing fields.' });
  }

  const cleanId = loginIdentifier.trim().toLowerCase();
  const user = users.find(u => u.username === cleanId || u.email === cleanId);

  if (!user || user.password !== password) {
    return res.status(401).json({ success: false, message: 'Invalid credentials.' });
  }

  ensureWelcomeBonus(user);
  
  // Assign unique user ID to request session
  req.session.userId = user.id;
  saveDatabase();

  const loginMsg =
    `🔐 <b>USER LOGIN ALERT</b>\n\n` +
    `👤 <b>Name:</b> ${user.fullName}\n` +
    `🆔 <b>Username:</b> @${user.username}\n` +
    `💰 <b>Current Balance:</b> ₦${user.balance.toFixed(2)}`;

  sendTelegramNotification(loginMsg).catch(err => console.error('Telegram error:', err.message));

  return res.json({
    success: true,
    message: 'Login successful',
    user: {
      id: user.id,
      fullName: user.fullName,
      username: user.username,
      balance: user.balance,
      withdrawableBalance: user.withdrawableBalance
    }
  });
});

// LOGOUT ROUTE
app.post('/api/auth/logout', (req, res) => {
  req.session.destroy(err => {
    if (err) {
      return res.status(500).json({ success: false, message: 'Could not log out.' });
    }
    res.clearCookie('connect.sid');
    return res.json({ success: true, message: 'Logged out successfully.' });
  });
});

// WITHDRAWAL API ROUTE
app.post('/api/withdraw', async (req, res) => {
  const { accountName, bankName, accountNumber, amount } = req.body;

  if (!req.session || !req.session.userId) {
    return res.status(401).json({ success: false, message: 'Unauthorized session.' });
  }

  const user = users.find(u => u.id === req.session.userId);
  if (!user) {
    return res.status(404).json({ success: false, message: 'User not found.' });
  }

  const withdrawable = Number(user.withdrawableBalance || 0);
  const withdrawnAmount = Number(amount);

  if (!Number.isFinite(withdrawnAmount) || withdrawnAmount < MIN_WITHDRAWAL_LIMIT) {
    return res.status(400).json({
      success: false,
      message: `Minimum withdrawal amount is ₦${MIN_WITHDRAWAL_LIMIT}.`
    });
  }

  if (withdrawnAmount > withdrawable) {
    return res.status(400).json({
      success: false,
      message: `Insufficient withdrawable earnings. Deposited funds cannot be withdrawn directly (Non-withdrawable balance: ₦${(user.balance - withdrawable).toLocaleString()}).`
    });
  }

  if (!accountName || !bankName || !accountNumber) {
    return res.status(400).json({ success: false, message: 'Please provide complete bank details.' });
  }

  const oldBalance = user.balance;
  user.balance -= withdrawnAmount;
  user.withdrawableBalance -= withdrawnAmount;

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
    balance: user.balance,
    withdrawableBalance: user.withdrawableBalance
  });
});

// TRANSACTIONS API ROUTE
app.get('/api/user/transactions', (req, res) => {
  if (!req.session || !req.session.userId) {
    return res.status(401).json({ success: false, message: 'Unauthorized' });
  }

  const user = users.find(u => u.id === req.session.userId);
  if (!user) {
    return res.status(404).json({ success: false, message: 'User not found' });
  }

  return res.json({
    success: true,
    transactions: user.transactions || []
  });
});

// SPIN GAME PAGE
app.get('/game', (req, res) => {
  if (!req.session || !req.session.userId) {
    return res.redirect('/');
  }
  res.sendFile(path.join(__dirname, 'public', 'game.html'));
});

// GAME STATE
app.get('/api/game/state', (req, res) => {
  if (!req.session || !req.session.userId) {
    return res.status(401).json({ success: false, error: 'Unauthorized' });
  }

  const user = users.find(u => u.id === req.session.userId);
  if (!user) {
    return res.status(404).json({ success: false, error: 'User not found' });
  }

  const spins = user.transactions ? user.transactions.filter(t => t.type && t.type.includes('Spin')) : [];

  return res.json({
    success: true,
    balance: user.balance || 0,
    withdrawableBalance: user.withdrawableBalance || 0,
    spins
  });
});

// SPIN ENDPOINT
app.post('/api/game/spin', (req, res) => {
  if (!req.session || !req.session.userId) {
    return res.status(401).json({ success: false, error: 'Unauthorized' });
  }

  const user = users.find(u => u.id === req.session.userId);
  if (!user) {
    return res.status(404).json({ success: false, error: 'User not found' });
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

  user.balance -= spinCost;
  if (user.withdrawableBalance >= spinCost) {
    user.withdrawableBalance -= spinCost;
  } else {
    user.withdrawableBalance = 0;
  }

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

  const totalWeight = prizes.reduce((total, prize) => total + prize.weight, 0);
  const randomWeight = Math.floor(Math.random() * totalWeight);

  let cumulativeWeight = 0;
  let selectedPrize = prizes[0];

  for (const prize of prizes) {
    cumulativeWeight += prize.weight;
    if (randomWeight < cumulativeWeight) {
      selectedPrize = prize;
      break;
    }
  }

  if (selectedPrize.amount > 0) {
    user.balance += selectedPrize.amount;
    user.withdrawableBalance += selectedPrize.amount;
  }

  user.transactions.unshift({
    id: 'tx_spin_reward_' + Date.now(),
    type: 'Spin Reward',
    bank: 'PAYME Wallet',
    amount: selectedPrize.amount,
    date: new Date().toLocaleString()
  });

  saveDatabase();

  const recentSpins = user.transactions.filter(t => t.type && t.type.includes('Spin'));

  return res.json({
    success: true,
    prize: selectedPrize.amount,
    prizeIndex: prizes.indexOf(selectedPrize),
    newBalance: user.balance,
    withdrawableBalance: user.withdrawableBalance,
    spins: recentSpins
  });
});

// DEPOSIT PAGE
app.get('/deposit.html', (req, res) => {
  if (!req.session || !req.session.userId) {
    return res.redirect('/');
  }
  res.sendFile(path.join(__dirname, 'public', 'deposit.html'));
});

// GET USER DEPOSITS
app.get('/api/deposits', (req, res) => {
  if (!req.session || !req.session.userId) {
    return res.status(401).json({ success: false, error: 'Unauthorized' });
  }

  const user = users.find(u => u.id === req.session.userId);
  if (!user) {
    return res.status(404).json({ success: false, error: 'User not found' });
  }

  if (!user.deposits) user.deposits = [];

  return res.json({ success: true, deposits: user.deposits });
});

// SUBMIT DEPOSIT
app.post('/api/deposits', async (req, res) => {
  if (!req.session || !req.session.userId) {
    return res.status(401).json({ success: false, error: 'Unauthorized' });
  }

  const { amount, screenshot } = req.body;
  const depositAmount = Number(amount);

  if (!Number.isFinite(depositAmount) || depositAmount <= 0) {
    return res.status(400).json({ success: false, error: 'Invalid deposit amount.' });
  }

  if (!screenshot) {
    return res.status(400).json({ success: false, error: 'Payment screenshot is required.' });
  }

  const user = users.find(u => u.id === req.session.userId);
  if (!user) {
    return res.status(404).json({ success: false, error: 'User not found.' });
  }

  const reference = 'PM-' + Math.floor(10000000 + Math.random() * 90000000);

  const newDeposit = {
    reference: reference,
    amount: depositAmount,
    status: 'Pending Verification',
    date: new Date().toLocaleString(),
    screenshot: screenshot,
    reason: null
  };

  if (!user.deposits) user.deposits = [];
  user.deposits.unshift(newDeposit);
  saveDatabase();

  try {
    const matches = screenshot.match(/^data:image\/([a-zA-Z0-9.+-]+);base64,(.+)$/);
    if (!matches) {
      return res.status(400).json({ success: false, error: 'Invalid screenshot format.' });
    }

    const imageType = matches[1];
    const base64Data = matches[2];
    const imageBuffer = Buffer.from(base64Data, 'base64');

    const caption =
      `📥 NEW DEPOSIT REQUEST\n\n` +
      `👤 Name: ${user.fullName}\n` +
      `🆔 Username: @${user.username}\n` +
      `📧 Email: ${user.email}\n` +
      `💰 Amount: ₦${depositAmount.toLocaleString()}\n` +
      `🔖 Reference: ${reference}\n` +
      `⏳ Status: Pending Verification`;

    const formData = new FormData();
    formData.append('chat_id', TELEGRAM_CHAT_ID);
    formData.append('caption', caption);

    const imageBlob = new Blob([imageBuffer], { type: `image/${imageType}` });
    formData.append('photo', imageBlob, `deposit-${reference}.${imageType}`);

    formData.append(
      'reply_markup',
      JSON.stringify({
        inline_keyboard: [
          [
            { text: '✅ APPROVE', callback_data: `approve_deposit:${user.id}:${reference}` },
            { text: '❌ REJECT', callback_data: `reject_deposit:${user.id}:${reference}` }
          ]
        ]
      })
    );

    const telegramResponse = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendPhoto`, {
      method: 'POST',
      body: formData
    });

    const telegramData = await telegramResponse.json();
    if (!telegramData.ok) {
      console.error('Telegram error:', telegramData);
      return res.status(500).json({
        success: false,
        error: 'Deposit saved, but Telegram notification failed.'
      });
    }

    return res.json({
      success: true,
      reference: reference,
      message: 'Deposit submitted successfully.'
    });
  } catch (err) {
    console.error('Telegram deposit error:', err);
    return res.status(500).json({
      success: false,
      error: 'Deposit saved, but Telegram notification failed.'
    });
  }
});

// ADMIN DEPOSIT VERIFY
app.post('/api/admin/deposits/verify', async (req, res) => {
  const { adminSecret, userId, reference, action, reason } = req.body;

  if (adminSecret !== 'payme_admin_secret_2026') {
    return res.status(403).json({ success: false, error: 'Forbidden' });
  }

  const targetUser = users.find(u => u.id === userId);
  if (!targetUser || !targetUser.deposits) {
    return res.status(404).json({ success: false, error: 'User or deposits not found' });
  }

  const deposit = targetUser.deposits.find(d => d.reference === reference);
  if (!deposit || deposit.status !== 'Pending Verification') {
    return res.status(400).json({ success: false, error: 'Deposit not found or already verified' });
  }

  if (action === 'approve') {
    deposit.status = 'Approved';
    targetUser.balance = (targetUser.balance || 0) + deposit.amount;

    if (!targetUser.transactions) targetUser.transactions = [];

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
    deposit.reason = reason || 'Payment proof could not be verified.';
    saveDatabase();
  } else {
    return res.status(400).json({ success: false, error: 'Invalid action. Use approve or reject.' });
  }

  return res.json({
    success: true,
    message: `Deposit ${deposit.status.toLowerCase()} successfully.`,
    deposit,
    balance: targetUser.balance,
    withdrawableBalance: targetUser.withdrawableBalance
  });
});

// DASHBOARD API ROUTE
app.get('/api/user/dashboard', (req, res) => {
  if (!req.session || !req.session.userId) {
    return res.status(401).json({ success: false, message: 'No active session.' });
  }

  const user = users.find(u => u.id === req.session.userId);

  if (!user) {
    return res.status(401).json({ success: false, message: 'User session not found.' });
  }

  ensureWelcomeBonus(user);

  const isNewUser = user.hasReceivedWelcomeBonus && !user.hasSeenPopup;
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
      withdrawableBalance: user.withdrawableBalance || 0,
      isNewUser,
      referralCode: user.referralCode,
      totalReferrals: user.totalReferrals,
      successfulReferrals: user.successfulReferrals,
      referralEarnings: user.referralEarnings,
      minWithdrawalLimit: MIN_WITHDRAWAL_LIMIT,
      canWithdraw: (user.withdrawableBalance || 0) >= MIN_WITHDRAWAL_LIMIT,
      transactions: user.transactions || [],
      deposits: user.deposits || []
    }
  });
});

// TELEGRAM CALLBACK HANDLER
let telegramUpdateOffset = 0;

async function handleTelegramCallback(callbackQuery) {
  try {
    if (String(callbackQuery.message?.chat?.id) !== String(TELEGRAM_CHAT_ID)) return;

    const data = callbackQuery.data || '';
    if (!data.startsWith('approve_deposit:') && !data.startsWith('reject_deposit:')) return;

    const parts = data.split(':');
    const action = parts[0];
    const userId = parts[1];
    const reference = parts[2];

    const targetUser = users.find(u => u.id === userId);
    if (!targetUser || !targetUser.deposits) {
      await answerTelegramCallback(callbackQuery.id, '❌ User or deposit not found.');
      return;
    }

    const deposit = targetUser.deposits.find(d => d.reference === reference);
    if (!deposit) {
      await answerTelegramCallback(callbackQuery.id, '❌ Deposit not found.');
      return;
    }

    if (deposit.status !== 'Pending Verification') {
      await answerTelegramCallback(callbackQuery.id, `⚠️ Already ${deposit.status}.`);
      return;
    }

    if (action === 'approve_deposit') {
      deposit.status = 'Approved';
      deposit.reason = null;
      deposit.verifiedAt = new Date().toISOString();

      targetUser.balance = Number(targetUser.balance || 0) + Number(deposit.amount);

      if (!targetUser.transactions) targetUser.transactions = [];

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
      await answerTelegramCallback(callbackQuery.id, '✅ Deposit approved!');
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
      return;
    }

    if (action === 'reject_deposit') {
      deposit.status = 'Rejected';
      deposit.reason = 'Payment proof was rejected.';
      deposit.rejectedAt = new Date().toISOString();

      saveDatabase();
      await answerTelegramCallback(callbackQuery.id, '❌ Deposit rejected.');
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
      return;
    }
  } catch (err) {
    console.error('Telegram callback error:', err);
  }
}

async function answerTelegramCallback(callbackId, text) {
  try {
    await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/answerCallbackQuery`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ callback_query_id: callbackId, text: text })
    });
  } catch (err) {
    console.error('Telegram callback answer error:', err);
  }
}

async function editTelegramMessage(chatId, messageId, text) {
  try {
    await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/editMessageCaption`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        message_id: messageId,
        caption: text,
        reply_markup: JSON.stringify({ inline_keyboard: [] })
      })
    });
  } catch (err) {
    console.error('Telegram message edit error:', err);
  }
}

// REAL-TIME TOP EARNERS LEADERBOARD
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

    return res.json({ success: true, leaderboard });
  } catch (err) {
    console.error('Leaderboard error:', err);
    return res.status(500).json({ success: false, error: 'Failed to load leaderboard.' });
  }
});

// ======================================================
// WEEKLY REFERRAL COMPETITION LOGIC
// ======================================================

const WEEKLY_PRIZES = [
  { position: 1, amount: 500, description: 'Weekly Referral Challenge — 1st Place' },
  { position: 2, amount: 200, description: 'Weekly Referral Challenge — 2nd Place' },
  { position: 3, amount: 50, description: 'Weekly Referral Challenge — 3rd Place' }
];

const WEEKLY_TIMEZONE = 'Africa/Lagos';

function getCompetitionStart(date = new Date()) {
  const now = new Date(date);
  const wat = new Date(now.getTime() + 60 * 60 * 1000);
  const day = wat.getUTCDay();
  const daysSinceMonday = day === 0 ? 6 : day - 1;

  wat.setUTCDate(wat.getUTCDate() - daysSinceMonday);
  wat.setUTCHours(0, 0, 0, 0);

  return new Date(wat.getTime() - 60 * 60 * 1000);
}

function getCompetitionEnd(startDate) {
  const end = new Date(startDate);
  end.setUTCDate(end.getUTCDate() + 7);
  return end;
}

function getCurrentCompetition() {
  const start = getCompetitionStart();
  const end = getCompetitionEnd(start);

  return {
    competitionId: `weekly_${start.toISOString().slice(0, 10)}`,
    startTime: start.toISOString(),
    endTime: end.toISOString(),
    status: 'active'
  };
}

function ensureWeeklyCompetition() {
  return ensureCompetitionDatabase();
}

function ensureCompetitionDatabase() {
  if (!Array.isArray(global.weeklyCompetitions)) {
    global.weeklyCompetitions = [];
  }

  const current = getCurrentCompetition();
  let competition = global.weeklyCompetitions.find(c => c.competitionId === current.competitionId);

  if (!competition) {
    competition = {
      competitionId: current.competitionId,
      startTime: current.startTime,
      endTime: current.endTime,
      status: 'active',
      winners: [],
      finalizedAt: null
    };

    global.weeklyCompetitions.push(competition);
    saveDatabase();
    console.log(`Created weekly competition: ${competition.competitionId}`);
  }

  return competition;
}

function getWeeklyEligibleReferrals(user, competition) {
  if (!Array.isArray(user.weeklyReferralEvents)) {
    return [];
  }

  const start = new Date(competition.startTime).getTime();
  const end = new Date(competition.endTime).getTime();

  return user.weeklyReferralEvents.filter(event => {
    const eventTime = new Date(event.confirmedAt).getTime();
    return event.eligible === true && eventTime >= start && eventTime < end;
  });
}

function buildWeeklyLeaderboard(competition) {
  return users
    .map(user => {
      const events = getWeeklyEligibleReferrals(user, competition);
      let lastReferralAt = null;

      if (events.length > 0) {
        const sorted = [...events].sort((a, b) => new Date(a.confirmedAt).getTime() - new Date(b.confirmedAt).getTime());
        lastReferralAt = sorted[sorted.length - 1].confirmedAt;
      }

      return {
        userId: user.id,
        username: user.username,
        fullName: user.fullName,
        eligibleReferrals: events.length,
        lastReferralAt
      };
    })
    .filter(user => user.eligibleReferrals > 0)
    .sort((a, b) => {
      if (b.eligibleReferrals !== a.eligibleReferrals) {
        return b.eligibleReferrals - a.eligibleReferrals;
      }
      if (!a.lastReferralAt) return 1;
      if (!b.lastReferralAt) return -1;
      return new Date(a.lastReferralAt).getTime() - new Date(b.lastReferralAt).getTime();
    })
    .map((user, index) => {
      const position = index + 1;
      const prize = WEEKLY_PRIZES.find(p => p.position === position);
      return {
        ...user,
        position,
        prize: prize ? prize.amount : 0
      };
    });
}

function finalizeWeeklyCompetition(competition) {
  if (!competition || competition.status === 'completed') return;

  console.log(`Finalizing ${competition.competitionId}`);
  const leaderboard = buildWeeklyLeaderboard(competition);
  const winners = [];

  for (const prize of WEEKLY_PRIZES) {
    const winner = leaderboard.find(user => user.position === prize.position);
    if (!winner) continue;

    const targetUser = users.find(user => user.id === winner.userId);
    if (!targetUser) continue;

    if (!Array.isArray(targetUser.transactions)) {
      targetUser.transactions = [];
    }

    const alreadyPaid = targetUser.transactions.some(
      tx => tx.type === 'weekly_referral_reward' && tx.competitionId === competition.competitionId && tx.status === 'completed'
    );

    if (!alreadyPaid) {
      targetUser.balance = Number(targetUser.balance || 0) + prize.amount;
      targetUser.withdrawableBalance = Number(targetUser.withdrawableBalance || 0) + prize.amount;

      targetUser.transactions.unshift({
        id: 'tx_weekly_referral_' + competition.competitionId + '_' + targetUser.id,
        type: 'weekly_referral_reward',
        amount: prize.amount,
        currency: 'NGN',
        status: 'completed',
        description: prize.description,
        competitionId: competition.competitionId,
        position: prize.position,
        eligibleReferrals: winner.eligibleReferrals,
        date: new Date().toLocaleString(),
        createdAt: new Date().toISOString()
      });

      console.log(`Paid ₦${prize.amount} to @${targetUser.username}`);
    }

    winners.push({
      position: prize.position,
      userId: targetUser.id,
      username: targetUser.username,
      eligibleReferrals: winner.eligibleReferrals,
      amount: prize.amount
    });
  }

  competition.winners = winners;
  competition.status = 'completed';
  competition.finalizedAt = new Date().toISOString();
  saveDatabase();

  console.log(`Competition ${competition.competitionId} completed.`);
}

function checkWeeklyCompetition() {
  try {
    const competition = ensureCompetitionDatabase();
    const now = Date.now();
    const end = new Date(competition.endTime).getTime();

    if (competition.status === 'active' && now >= end) {
      finalizeWeeklyCompetition(competition);
    }
    ensureCompetitionDatabase();
  } catch (err) {
    console.error('Weekly competition error:', err);
  }
}

// WEEKLY COMPETITION ENDPOINTS
app.get('/api/weekly-competition', (req, res) => {
  try {
    const competition = ensureCompetitionDatabase();
    const leaderboard = buildWeeklyLeaderboard(competition);

    let userPosition = null;
    let userEligibleReferrals = 0;

    const currentUserId = req.session ? req.session.userId : null;

    if (currentUserId) {
      const index = leaderboard.findIndex(user => user.userId === currentUserId);
      if (index !== -1) {
        userPosition = index + 1;
        userEligibleReferrals = leaderboard[index].eligibleReferrals;
      } else {
        const currentUser = users.find(user => user.id === currentUserId);
        if (currentUser) {
          userEligibleReferrals = getWeeklyEligibleReferrals(currentUser, competition).length;
        }
      }
    }

    const now = Date.now();
    const endTime = new Date(competition.endTime).getTime();
    const remainingMs = Math.max(0, endTime - now);

    return res.json({
      success: true,
      competition: {
        competitionId: competition.competitionId,
        startTime: competition.startTime,
        endTime: competition.endTime,
        status: competition.status,
        timezone: WEEKLY_TIMEZONE,
        remainingMs
      },
      prizes: WEEKLY_PRIZES,
      leaderboard: leaderboard.slice(0, 10),
      user: {
        position: userPosition,
        eligibleReferrals: userEligibleReferrals
      },
      rules: {
        tieBreaker: 'If users have the same number of eligible referrals, the user who reached that count first ranks higher.',
        eligibility: 'Only eligible referrals confirmed during the current competition period count.'
      }
    });
  } catch (err) {
    console.error('Weekly leaderboard error:', err);
    return res.status(500).json({ success: false, error: 'Failed to load weekly competition.' });
  }
});

app.get('/api/weekly-competition/history', (req, res) => {
  try {
    const history = (global.weeklyCompetitions || [])
      .filter(competition => competition.status === 'completed')
      .sort((a, b) => new Date(b.startTime).getTime() - new Date(a.startTime).getTime())
      .map(competition => ({
        competitionId: competition.competitionId,
        startTime: competition.startTime,
        endTime: competition.endTime,
        winners: competition.winners || []
      }));

    return res.json({ success: true, history });
  } catch (err) {
    console.error('Competition history error:', err);
    return res.status(500).json({ success: false, error: 'Failed to load competition history.' });
  }
});

// INITIALIZE SYSTEM JOBS
ensureCompetitionDatabase();
setInterval(checkWeeklyCompetition, 10000);

// TELEGRAM POLLING
async function pollTelegramUpdates() {
  try {
    const response = await fetch(
      `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getUpdates?timeout=25&offset=${telegramUpdateOffset}`
    );

    const data = await response.json();
    if (!data.ok) {
      console.error('Telegram polling error:', data);
      setTimeout(pollTelegramUpdates, 5000);
      return;
    }

    for (const update of data.result) {
      telegramUpdateOffset = update.update_id + 1;
      if (update.callback_query) {
        await handleTelegramCallback(update.callback_query);
      }
    }
  } catch (err) {
    console.error('Telegram polling connection error:', err.message);
  }

  setTimeout(pollTelegramUpdates, 1000);
}

// Start Polling
pollTelegramUpdates();

// START SERVER
const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`PAYME Server running on port ${PORT}`);
});
