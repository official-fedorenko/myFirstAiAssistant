const sqlite3 = require('sqlite3').verbose();
const { open } = require('sqlite');
const path = require('path');
const bcrypt = require('bcryptjs');

let db = null;

async function initDb() {
  db = await open({
    filename: path.join(__dirname, 'database.sqlite'),
    driver: sqlite3.Database
  });

  await db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS telegram_accounts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER UNIQUE NOT NULL,
      api_id INTEGER NOT NULL,
      api_hash TEXT NOT NULL,
      phone TEXT NOT NULL,
      session_string TEXT,
      status TEXT DEFAULT 'disconnected',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS chats (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      telegram_chat_id TEXT NOT NULL,
      title TEXT,
      type TEXT,
      member_count INTEGER DEFAULT 0,
      sync_status TEXT DEFAULT 'idle',
      is_active INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(user_id, telegram_chat_id),
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      chat_id TEXT NOT NULL,
      telegram_message_id INTEGER NOT NULL,
      sender_id TEXT,
      sender_name TEXT,
      text TEXT,
      date INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(user_id, chat_id, telegram_message_id),
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY(user_id, chat_id) REFERENCES chats(user_id, telegram_chat_id) ON DELETE CASCADE
    );
  `);
  
  // Add is_admin column if it doesn't exist
  try {
    const tableInfo = await db.all("PRAGMA table_info(users)");
    const hasAdminCol = tableInfo.some(col => col.name === 'is_admin');
    if (!hasAdminCol) {
      await db.exec("ALTER TABLE users ADD COLUMN is_admin INTEGER DEFAULT 0");
    }
  } catch(e) {
    console.error("Error checking or adding is_admin col", e);
  }

  // Ensure superadmin exists
  try {
    const adminExists = await db.get("SELECT id FROM users WHERE username = 'superadmin'");
    if (!adminExists) {
      const salt = await bcrypt.genSalt(10);
      const hash = await bcrypt.hash('RSS77tesla', salt);
      await db.run("INSERT INTO users (username, password_hash, is_admin) VALUES (?, ?, 1)", ['superadmin', hash]);
      console.log("Superadmin user created: superadmin");
    }
  } catch(e) {
    console.error("Error creating superadmin", e);
  }

  console.log("Database initialized");
  return db;
}

function getDb() {
  if (!db) {
    throw new Error('Database not initialized');
  }
  return db;
}

module.exports = { initDb, getDb };
