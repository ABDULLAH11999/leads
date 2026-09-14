require('dotenv').config();

const makeWASocket = require('@whiskeysockets/baileys').default;
const {
  DisconnectReason,
  fetchLatestBaileysVersion,
  useMultiFileAuthState
} = require('@whiskeysockets/baileys');
const qrcode = require('qrcode');
const pino = require('pino');

const { pool, query } = require('./db');
const { generateQualifierReply } = require('./ai');

const logger = pino({
  level: process.env.LOG_LEVEL || 'info'
});

let socket = null;
let qrCodeDataUrl = null;
let starting = null;
let connectionOpen = false;

function getQRCode() {
  return qrCodeDataUrl;
}

function getSocket() {
  return socket;
}

function isBotConnected() {
  return Boolean(socket && connectionOpen);
}

async function checkWhatsAppNumber(phone) {
  if (!isBotConnected()) {
    return {
      available: null,
      method: 'not_connected'
    };
  }

  const normalizedPhone = String(phone || '').replace(/\D/g, '');
  if (!normalizedPhone) {
    return {
      available: false,
      method: 'invalid'
    };
  }

  const result = await socket.onWhatsApp(`${normalizedPhone}@s.whatsapp.net`);
  return {
    available: Boolean(result?.[0]?.exists),
    jid: result?.[0]?.jid || null,
    method: 'baileys_onWhatsApp'
  };
}

function normalizeIncomingJid(jid) {
  return (jid || '').split('@')[0].replace(/\D/g, '');
}

function extractMessageText(message) {
  const content = message.message || {};

  if (content.conversation) return content.conversation;
  if (content.extendedTextMessage?.text) return content.extendedTextMessage.text;
  if (content.imageMessage?.caption) return content.imageMessage.caption;
  if (content.videoMessage?.caption) return content.videoMessage.caption;
  if (content.buttonsResponseMessage?.selectedDisplayText) {
    return content.buttonsResponseMessage.selectedDisplayText;
  }
  if (content.listResponseMessage?.title) return content.listResponseMessage.title;
  if (content.templateButtonReplyMessage?.selectedDisplayText) {
    return content.templateButtonReplyMessage.selectedDisplayText;
  }

  return '';
}

async function handleIncomingMessage(msg) {
  if (!msg?.message || msg.key?.fromMe) return;

  const remoteJid = msg.key.remoteJid;
  if (!remoteJid || remoteJid === 'status@broadcast' || remoteJid.endsWith('@g.us')) return;

  const rawNumber = normalizeIncomingJid(remoteJid);
  if (!rawNumber) return;

  const messageText = extractMessageText(msg).trim();
  if (!messageText) return;

  if (process.env.ENABLE_AUTO_REPLY !== 'true') {
    const result = await query('SELECT id FROM leads WHERE phone = $1 LIMIT 1', [rawNumber]);
    const lead = result.rows[0];

    if (lead) {
      await query('UPDATE leads SET last_message = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2', [messageText, lead.id]);
      logger.info({ leadId: lead.id, rawNumber }, '[BOT] Auto reply disabled. Message recorded silently.');
    }
    return;
  }

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const result = await client.query('SELECT * FROM leads WHERE phone = $1 LIMIT 1 FOR UPDATE', [rawNumber]);
    const lead = result.rows[0];

    if (!lead) {
      await client.query('COMMIT');
      logger.info({ rawNumber }, '[BOT] Message ignored because sender is not in leads table.');
      return;
    }

    if (lead.bot_active === false) {
      await client.query('UPDATE leads SET last_message = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2', [messageText, lead.id]);
      await client.query('COMMIT');
      logger.info({ leadId: lead.id, rawNumber }, '[BOT] Bot inactive for lead. Message recorded silently.');
      return;
    }

    const reply = await generateQualifierReply(messageText, lead.store_name);
    await socket.sendMessage(remoteJid, { text: reply });

    await client.query(
      "UPDATE leads SET bot_active = FALSE, status = 'REPLIED', last_message = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2",
      [messageText, lead.id]
    );
    await client.query('COMMIT');

    console.log(`[HOT LEAD ALERT] Lead ${lead.store_name} (${rawNumber}) replied. Bot MUTED for manual takeover.`);
  } catch (error) {
    await client.query('ROLLBACK').catch((rollbackError) => {
      logger.error({ error: rollbackError.message }, '[BOT] Failed to roll back message transaction.');
    });
    throw error;
  } finally {
    client.release();
  }
}

async function connectSocket() {
  const { state, saveCreds } = await useMultiFileAuthState('auth_session');
  const { version } = await fetchLatestBaileysVersion();

  socket = makeWASocket({
    auth: state,
    version,
    logger: pino({ level: process.env.BAILEYS_LOG_LEVEL || 'silent' }),
    browser: ['lead-engine', 'Chrome', '1.0.0']
  });

  socket.ev.on('creds.update', saveCreds);

  socket.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      try {
        qrCodeDataUrl = await qrcode.toDataURL(qr);
        logger.info('[BOT] QR code refreshed. Open /qr to scan.');
      } catch (error) {
        logger.error({ error: error.message }, '[BOT] Failed to generate QR code.');
      }
    }

    if (connection === 'open') {
      qrCodeDataUrl = null;
      connectionOpen = true;
      logger.info('[BOT] WhatsApp connection opened.');
    }

    if (connection === 'close') {
      const statusCode = lastDisconnect?.error?.output?.statusCode;
      const loggedOut = statusCode === DisconnectReason.loggedOut;

      socket = null;
      connectionOpen = false;
      logger.warn({ statusCode, loggedOut }, '[BOT] WhatsApp connection closed.');

      if (!loggedOut) {
        setTimeout(() => {
          starting = null;
          startBot().catch((error) => logger.error({ error: error.message }, '[BOT] Reconnect failed.'));
        }, 5000);
      } else {
        logger.error('[BOT] Logged out. Delete auth_session and scan QR again.');
      }
    }
  });

  socket.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;

    for (const msg of messages) {
      try {
        await handleIncomingMessage(msg);
      } catch (error) {
        logger.error({ error: error.message }, '[BOT] Incoming message handling failed.');
      }
    }
  });

  return socket;
}

async function startBot() {
  if (socket) return socket;
  if (!starting) {
    starting = connectSocket().finally(() => {
      starting = null;
    });
  }
  return starting;
}

module.exports = {
  getQRCode,
  getSocket,
  checkWhatsAppNumber,
  isBotConnected,
  startBot
};
