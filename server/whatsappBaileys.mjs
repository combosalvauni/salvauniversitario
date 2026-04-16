// server/whatsappBaileys.mjs
// ═══════════════════════════════════════════════════════════════
// WhatsApp Baileys — conexão direta, gratuita, sem Evolution API
// Sessão persistida em disco (./whatsapp-session/)
// ═══════════════════════════════════════════════════════════════

import {
  makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  makeCacheableSignalKeyStore,
  fetchLatestBaileysVersion,
} from '@whiskeysockets/baileys';
import { join } from 'path';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'fs';

const SESSION_DIR = join(process.cwd(), 'whatsapp-session');
const QR_FILE = '/tmp/wa_qr.txt';
const PAIRING_CODE_FILE = '/tmp/wa_pairing_code.txt';
if (!existsSync(SESSION_DIR)) mkdirSync(SESSION_DIR, { recursive: true });

let sock = null;
let qrCode = null;
let pairingCode = null;
let pairingPhoneNumber = null;
let pairingCodeRequested = false;
let connectionState = 'close'; // close | connecting | open
let retryCount = 0;
let sessionResetCount = 0;
const MAX_RETRIES = 5;
const MAX_SESSION_RESETS = 2;
const contactNames = new Map(); // jid -> pushName/notify
let onIncomingMessage = null; // callback para processar mensagens recebidas

// ── Registrar callback de mensagem recebida ──
export function setOnIncomingMessage(handler) {
  onIncomingMessage = typeof handler === 'function' ? handler : null;
}

// ── Pino logger silencioso (só erros) ──
const logger = {
  level: 'silent',
  trace() {},
  debug() {},
  info() {},
  warn(...args) { console.warn('[wa-baileys]', ...args); },
  error(...args) { console.error('[wa-baileys]', ...args); },
  fatal(...args) { console.error('[wa-baileys:FATAL]', ...args); },
  child() { return logger; },
};

export function getConnectionState() {
  return connectionState;
}

export function getQrCode() {
  return qrCode;
}

export function getPairingCode() {
  return pairingCode;
}

export function isConnected() {
  return connectionState === 'open' && sock;
}

export async function startWhatsApp({ pairingPhoneNumber: configuredPairingPhoneNumber = pairingPhoneNumber } = {}) {
  const { state, saveCreds } = await useMultiFileAuthState(SESSION_DIR);
  const { version } = await fetchLatestBaileysVersion();
  const normalizedPairingPhoneNumber = normalizePhoneNumber(configuredPairingPhoneNumber);

  pairingPhoneNumber = normalizedPairingPhoneNumber || null;
  pairingCode = null;
  pairingCodeRequested = false;
  clearTransientFiles();

  console.log(`[wa-baileys] Iniciando Baileys v${version.join('.')} | sessão: ${SESSION_DIR}`);
  if (pairingPhoneNumber && !state.creds.registered) {
    console.log(`[wa-baileys] Pareamento por código habilitado para ${pairingPhoneNumber}`);
  }

  sock = makeWASocket({
    version,
    auth: {
      creds: state.creds,
      keys: makeCacheableSignalKeyStore(state.keys, logger),
    },
    logger,
    printQRInTerminal: false,
    generateHighQualityLinkPreview: false,
    syncFullHistory: false,
    markOnlineOnConnect: false,
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      connectionState = 'connecting';

      if (pairingPhoneNumber && !sock.authState.creds.registered) {
        qrCode = null;
        void ensurePairingCode();
      } else {
        qrCode = qr;
        console.log('[wa-baileys] QR code gerado — escaneie com o WhatsApp');
        persistTextFile(QR_FILE, qr);
        console.log(`[wa-baileys] QR salvo em ${QR_FILE}`);
      }
    }

    if (connection === 'close') {
      connectionState = 'close';
      qrCode = null;
      pairingCode = null;
      pairingCodeRequested = false;
      clearTransientFiles();
      const statusCode = (lastDisconnect?.error)?.output?.statusCode;
      const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
      const canResetPairingSession = !shouldReconnect
        && pairingPhoneNumber
        && !sock?.authState?.creds?.registered
        && sessionResetCount < MAX_SESSION_RESETS;

      if (shouldReconnect && retryCount < MAX_RETRIES) {
        retryCount++;
        const delay = Math.min(retryCount * 3000, 15000);
        console.log(`[wa-baileys] Desconectado (code=${statusCode}). Reconectando em ${delay / 1000}s... (tentativa ${retryCount}/${MAX_RETRIES})`);
        setTimeout(() => startWhatsApp({ pairingPhoneNumber }), delay);
      } else if (canResetPairingSession) {
        sessionResetCount++;
        console.warn(`[wa-baileys] Sessão de pareamento inválida. Limpando sessão e gerando novo código... (${sessionResetCount}/${MAX_SESSION_RESETS})`);
        resetSessionDirectory();
        setTimeout(() => startWhatsApp({ pairingPhoneNumber }), 1000);
      } else if (!shouldReconnect) {
        console.log('[wa-baileys] Logged out. Delete a pasta whatsapp-session/ e reinicie para reconectar.');
      } else {
        console.warn(`[wa-baileys] Máximo de tentativas (${MAX_RETRIES}) atingido. Reinicie o servidor.`);
      }
    }

    if (connection === 'open') {
      connectionState = 'open';
      qrCode = null;
      pairingCode = null;
      pairingCodeRequested = false;
      retryCount = 0;
      sessionResetCount = 0;
      clearTransientFiles();
      console.log('[wa-baileys] ✅ Conectado ao WhatsApp!');
    }
  });

  // ── Capturar nomes dos contatos ──
  sock.ev.on('contacts.upsert', (contacts) => {
    for (const c of contacts) {
      const name = c.notify || c.name || c.verifiedName || '';
      if (name && c.id) contactNames.set(c.id, name);
    }
  });
  sock.ev.on('contacts.update', (updates) => {
    for (const c of updates) {
      const name = c.notify || c.name || c.verifiedName || '';
      if (name && c.id) contactNames.set(c.id, name);
    }
  });
  sock.ev.on('messages.upsert', ({ messages, type }) => {
    for (const msg of messages) {
      if (msg.pushName && msg.key?.remoteJid) {
        contactNames.set(msg.key.remoteJid, msg.pushName);
      }
      // Processar apenas mensagens recebidas (não enviadas por nós)
      if (type === 'notify' && !msg.key?.fromMe && msg.message && onIncomingMessage) {
        const text = msg.message?.conversation
          || msg.message?.extendedTextMessage?.text
          || '';
        if (text) {
          try {
            onIncomingMessage({ jid: msg.key.remoteJid, text, pushName: msg.pushName || '' });
          } catch (err) {
            console.warn('[wa-baileys] Erro no handler de mensagem:', err?.message);
          }
        }
      }
    }
  });

  return sock;
}

// ── Enviar mensagem de texto ──
export async function sendText(phone, text) {
  if (!isConnected()) throw new Error('WhatsApp não conectado');
  const jid = formatJid(phone);
  const result = await sock.sendMessage(jid, { text });
  return { messageId: result?.key?.id || null, to: jid };
}

// ── Enviar áudio como voice note ──
export async function sendAudio(phone, audioUrl) {
  if (!isConnected()) throw new Error('WhatsApp não conectado');
  const jid = formatJid(phone);
  const result = await sock.sendMessage(jid, {
    audio: { url: audioUrl },
    mimetype: 'audio/ogg; codecs=opus',
    ptt: true, // envia como voice note (bolinha verde)
  });
  return { messageId: result?.key?.id || null, to: jid };
}

// ── Obter nome do contato (push name do WhatsApp) ──
export function getContactName(phone) {
  const jid = `${normalizePhoneNumber(phone)}@s.whatsapp.net`;
  return contactNames.get(jid) || null;
}

// ── Formatar para JID ──
function formatJid(phone) {
  const number = normalizePhoneNumber(phone);
  if (!number) throw new Error('Número de telefone inválido');
  return `${number}@s.whatsapp.net`;
}

async function ensurePairingCode() {
  if (!sock || !pairingPhoneNumber || sock.authState.creds.registered || pairingCodeRequested) {
    return pairingCode;
  }

  pairingCodeRequested = true;
  try {
    const code = await sock.requestPairingCode(pairingPhoneNumber);
    pairingCode = code;
    persistTextFile(PAIRING_CODE_FILE, code);
    console.log(`[wa-baileys] Código de pareamento para ${pairingPhoneNumber}: ${code}`);
    console.log(`[wa-baileys] Código salvo em ${PAIRING_CODE_FILE}`);
    return code;
  } catch (error) {
    pairingCodeRequested = false;
    console.error('[wa-baileys] Falha ao gerar código de pareamento:', error?.message || error);
    throw error;
  }
}

function normalizePhoneNumber(phone) {
  const digits = String(phone || '').replace(/\D/g, '');
  if (!digits) return '';
  if (digits.startsWith('55')) return digits;
  if (digits.length === 10 || digits.length === 11) return `55${digits}`;
  return digits;
}

function persistTextFile(filePath, value) {
  try {
    writeFileSync(filePath, value, 'utf8');
  } catch {
    // ignore persistence failures; logs are enough to continue pairing
  }
}

function clearTransientFiles() {
  try {
    rmSync(QR_FILE, { force: true });
  } catch {
    // ignore cleanup failures
  }

  try {
    rmSync(PAIRING_CODE_FILE, { force: true });
  } catch {
    // ignore cleanup failures
  }
}

function resetSessionDirectory() {
  try {
    rmSync(SESSION_DIR, { recursive: true, force: true });
    mkdirSync(SESSION_DIR, { recursive: true });
  } catch {
    // ignore reset failures; follow-up logs will show whether restart succeeds
  }
}
