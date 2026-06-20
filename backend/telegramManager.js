const { TelegramClient, Api } = require('telegram');
const { StringSession } = require('telegram/sessions');
const { getDb } = require('./db');

class TelegramManager {
  constructor() {
    this.clients = new Map(); // user_id -> client instance
    this.authStates = new Map(); // user_id -> { phoneCodeHash, phone, password_required }
  }

  async startSavedSessions() {
    const db = getDb();
    const accounts = await db.all(`SELECT * FROM telegram_accounts WHERE status = 'connected' AND session_string IS NOT NULL`);
    for (let acc of accounts) {
      await this.connectUser(acc.user_id, acc.api_id, acc.api_hash, acc.session_string);
    }
    console.log(`Started ${accounts.length} saved Telegram sessions`);
  }

  async connectUser(userId, apiId, apiHash, sessionStr = '') {
    if (this.clients.has(userId)) {
      return this.clients.get(userId);
    }
    
    const stringSession = new StringSession(sessionStr);
    const client = new TelegramClient(stringSession, parseInt(apiId), apiHash, {
      connectionRetries: 5,
    });
    
    await client.connect();
    
    // Add event handler for incoming messages
    client.addEventHandler(async (update) => {
      await this.handleIncomingMessage(userId, update);
    });

    this.clients.set(userId, client);
    return client;
  }

  async sendCode(userId, apiId, apiHash, phone) {
    const cleanPhone = phone.replace(/[^\d+]/g, '');
    const client = await this.connectUser(userId, apiId, apiHash, '');
    try {
      const result = await client.sendCode({
        apiId: parseInt(apiId),
        apiHash: apiHash,
      }, cleanPhone);
      
      this.authStates.set(userId, { phoneCodeHash: result.phoneCodeHash, phone: cleanPhone });
      return { success: true, needsCode: true, isCodeViaApp: result.isCodeViaApp };
    } catch (err) {
      console.error(err);
      return { success: false, error: err.message };
    }
  }

  async verifyCode(userId, code, password = '') {
    if (!this.clients.has(userId) || !this.authStates.has(userId)) {
      return { success: false, error: 'No active login session' };
    }
    const client = this.clients.get(userId);
    const state = this.authStates.get(userId);

    try {
      await client.invoke(new Api.auth.SignIn({
        phoneNumber: state.phone,
        phoneCodeHash: state.phoneCodeHash,
        phoneCode: code,
      }));
    } catch (err) {
      if (err.errorMessage === 'SESSION_PASSWORD_NEEDED') {
        if (!password) {
          return { success: true, needsPassword: true };
        }
        try {
          await client.signInWithPassword({
            apiId: client.apiId,
            apiHash: client.apiHash,
          }, { password: password, onError: (e) => { throw e; } });
        } catch (pwErr) {
          return { success: false, error: pwErr.message };
        }
      } else {
        return { success: false, error: err.message };
      }
    }

    const sessionString = client.session.save();
    const db = getDb();
    
    // Fetch user info to make sure it's valid
    const me = await client.getMe();
    
    await db.run(`UPDATE telegram_accounts SET session_string = ?, status = 'connected' WHERE user_id = ?`, 
      [sessionString, userId]);
      
    this.authStates.delete(userId);
    
    // Fetch initial chat list
    await this.fetchInitialChats(userId, client);
    
    return { success: true, sessionString, user: me.username || me.firstName };
  }

  async fetchInitialChats(userId, client) {
    const db = getDb();
    const dialogs = await client.getDialogs();
    for (let dialog of dialogs) {
      const type = dialog.isGroup ? 'group' : dialog.isChannel ? 'channel' : 'user';
      try {
        await db.run(`
          INSERT INTO chats (user_id, telegram_chat_id, title, type) 
          VALUES (?, ?, ?, ?)
          ON CONFLICT(user_id, telegram_chat_id) DO UPDATE SET title=excluded.title
        `, [userId, dialog.id.toString(), dialog.title, type]);
      } catch (e) {
        console.error("Error inserting chat", e);
      }
    }
  }

  async handleIncomingMessage(userId, update) {
    if (update.className === 'UpdateShortMessage' || update.className === 'UpdateShortChatMessage' || update.className === 'UpdateNewMessage' || update.className === 'UpdateNewChannelMessage') {
      let msg = update.message || update;
      if (!msg || !msg.message) return;
      
      const db = getDb();
      let chatId = msg.peerId ? (msg.peerId.channelId || msg.peerId.chatId || msg.peerId.userId) : (msg.chatId || msg.userId);
      if (!chatId) return;
      
      // Attempt to link it if the chat is monitored
      const chat = await db.get(`SELECT * FROM chats WHERE user_id = ? AND telegram_chat_id = ? AND is_active = 1`, [userId, `-${chatId}`.replace('--', '-')]);
      if (!chat) {
         // also try raw id
         const chatRaw = await db.get(`SELECT * FROM chats WHERE user_id = ? AND telegram_chat_id = ? AND is_active = 1`, [userId, chatId.toString()]);
         if (!chatRaw) return;
         chatId = chatId.toString();
      } else {
         chatId = `-${chatId}`.replace('--', '-');
      }

      const senderId = msg.fromId ? (msg.fromId.userId || msg.fromId).toString() : 'unknown';
      const text = msg.message || '';
      const date = msg.date;

      try {
        await db.run(`
          INSERT INTO messages (user_id, chat_id, telegram_message_id, sender_id, text, date)
          VALUES (?, ?, ?, ?, ?, ?)
        `, [userId, chatId, msg.id, senderId, text, date]);
      } catch (e) {
        if(e.code !== 'SQLITE_CONSTRAINT') {
           console.error("Error saving message", e);
        }
      }
    }
  }

  async syncPastMonth(userId, telegramChatId) {
    const db = getDb();
    const client = this.clients.get(userId);
    if (!client) throw new Error('Client not connected');

    await db.run(`UPDATE chats SET sync_status = 'syncing' WHERE user_id = ? AND telegram_chat_id = ?`, [userId, telegramChatId]);

    try {
      // Find the oldest message we have for this chat
      const oldestMsg = await db.get(`SELECT date FROM messages WHERE user_id = ? AND chat_id = ? ORDER BY date ASC LIMIT 1`, [userId, telegramChatId]);
      
      let maxDate = oldestMsg ? oldestMsg.date : Math.floor(Date.now() / 1000);
      const minDate = maxDate - (30 * 24 * 60 * 60); // 30 days back

      let offsetId = 0;
      let hasMore = true;

      // Ensure entity is cached
      const entity = await client.getEntity(telegramChatId.startsWith('-100') ? parseInt(telegramChatId) : telegramChatId);

      while (hasMore) {
        const history = await client.invoke(new Api.messages.GetHistory({
          peer: entity,
          offsetId: offsetId,
          offsetDate: maxDate,
          addOffset: 0,
          limit: 100,
          maxId: 0,
          minId: 0,
          hash: 0n,
        }));

        if (!history.messages || history.messages.length === 0) {
          hasMore = false;
          break;
        }

        for (let msg of history.messages) {
          if (!msg.message) continue;
          if (msg.date < minDate) {
            hasMore = false;
            break;
          }
          
          const senderId = msg.fromId ? (msg.fromId.userId || msg.fromId).toString() : 'unknown';
          try {
            await db.run(`
              INSERT INTO messages (user_id, chat_id, telegram_message_id, sender_id, text, date)
              VALUES (?, ?, ?, ?, ?, ?)
            `, [userId, telegramChatId, msg.id, senderId, msg.message, msg.date]);
          } catch (e) {
            // ignore duplicate constraints
          }
          offsetId = msg.id;
        }
        
        // Wait a bit to prevent flood
        await new Promise(r => setTimeout(r, 1000));
      }

      await db.run(`UPDATE chats SET sync_status = 'completed' WHERE user_id = ? AND telegram_chat_id = ?`, [userId, telegramChatId]);
      return { success: true };
    } catch (err) {
      console.error(err);
      await db.run(`UPDATE chats SET sync_status = 'failed' WHERE user_id = ? AND telegram_chat_id = ?`, [userId, telegramChatId]);
      return { success: false, error: err.message };
    }
  }
}

module.exports = new TelegramManager();
