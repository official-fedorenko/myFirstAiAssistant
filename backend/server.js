const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { initDb, getDb } = require('./db');
const telegramManager = require('./telegramManager');

const app = express();
app.use(cors());
app.use(express.json());

const JWT_SECRET = process.env.JWT_SECRET || 'super_secret_dev_key_123';

// Middleware to authenticate JWT
const authMiddleware = (req, res, next) => {
  const token = req.header('Authorization')?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Access denied' });
  try {
    const verified = jwt.verify(token, JWT_SECRET);
    req.user = verified;
    next();
  } catch (err) {
    res.status(400).json({ error: 'Invalid token' });
  }
};

// --- AUTH ROUTES ---
app.post('/api/auth/register', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Missing fields' });
  const db = getDb();
  const salt = await bcrypt.genSalt(10);
  const hash = await bcrypt.hash(password, salt);
  try {
    const result = await db.run('INSERT INTO users (username, password_hash) VALUES (?, ?)', [username, hash]);
    const token = jwt.sign({ id: result.lastID }, JWT_SECRET, { expiresIn: '7d' });
    res.json({ token });
  } catch (err) {
    if (err.code === 'SQLITE_CONSTRAINT') return res.status(400).json({ error: 'Username taken' });
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/auth/login', async (req, res) => {
  const { username, password } = req.body;
  const db = getDb();
  const user = await db.get('SELECT * FROM users WHERE username = ?', [username]);
  if (!user) return res.status(400).json({ error: 'User not found' });
  const validPass = await bcrypt.compare(password, user.password_hash);
  if (!validPass) return res.status(400).json({ error: 'Invalid password' });
  const token = jwt.sign({ id: user.id }, JWT_SECRET, { expiresIn: '7d' });
  res.json({ token });
});

app.get('/api/auth/me', authMiddleware, async (req, res) => {
  res.json({ id: req.user.id });
});

app.get('/api/telegram/status', authMiddleware, async (req, res) => {
  const db = getDb();
  const acc = await db.get('SELECT api_id, api_hash, phone, status FROM telegram_accounts WHERE user_id = ?', [req.user.id]);
  res.json({ 
    status: acc ? acc.status : 'disconnected', 
    hasAccount: !!acc,
    config: acc ? { apiId: acc.api_id, apiHash: acc.api_hash, phone: acc.phone } : null
  });
});

app.post('/api/telegram/connect', authMiddleware, async (req, res) => {
  const { apiId, apiHash, phone } = req.body;
  const db = getDb();
  
  // Save or update config
  await db.run(`
    INSERT INTO telegram_accounts (user_id, api_id, api_hash, phone, status) 
    VALUES (?, ?, ?, ?, 'code_requested')
    ON CONFLICT(user_id) DO UPDATE SET api_id=excluded.api_id, api_hash=excluded.api_hash, phone=excluded.phone, status='code_requested'
  `, [req.user.id, apiId, apiHash, phone]);

  const result = await telegramManager.sendCode(req.user.id, apiId, apiHash, phone);
  res.json(result);
});

app.post('/api/telegram/verify-code', authMiddleware, async (req, res) => {
  const { code, password } = req.body;
  const result = await telegramManager.verifyCode(req.user.id, code, password);
  res.json(result);
});

// --- CHATS & ANALYTICS ---
app.get('/api/chats', authMiddleware, async (req, res) => {
  const db = getDb();
  const chats = await db.all('SELECT * FROM chats WHERE user_id = ? ORDER BY type, title', [req.user.id]);
  res.json(chats);
});

app.post('/api/chats/:id/sync-month', authMiddleware, async (req, res) => {
  const { id } = req.params;
  // Background processing to not block request
  telegramManager.syncPastMonth(req.user.id, id).catch(console.error);
  res.json({ success: true, message: 'Sync started' });
});

app.get('/api/analytics', authMiddleware, async (req, res) => {
  const db = getDb();
  const stats = await db.all(`
    SELECT DATE(date, 'unixepoch') as day, COUNT(*) as count 
    FROM messages 
    WHERE user_id = ? 
    GROUP BY day 
    ORDER BY day DESC 
    LIMIT 30
  `, [req.user.id]);
  res.json(stats);
});

const PORT = process.env.PORT || 5000;
initDb().then(() => {
  telegramManager.startSavedSessions().catch(console.error);
  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });
});
