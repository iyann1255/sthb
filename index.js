const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  makeInMemoryStore,
  jidNormalizedUser,
  downloadContentFromMessage
} = require("@whiskeysockets/baileys");
const pino = require("pino");
const qrcode = require("qrcode-terminal");

const { handleRvoCommand } = require("./lib/rvo");
const { handleStickerCommand } = require("./lib/sticker");

const PREFIXES = ["!", ".", "/"]; // bebas
const OWNER_ONLY = false; // kalau mau owner only, set true & isi OWNER_JID
const OWNER_JID = ""; // contoh: "62812xxxx@s.whatsapp.net"

function pickPrefix(text) {
  if (!text) return null;
  return PREFIXES.find((p) => text.startsWith(p)) || null;
}

function getText(m) {
  return (
    m.message?.conversation ||
    m.message?.extendedTextMessage?.text ||
    m.message?.imageMessage?.caption ||
    m.message?.videoMessage?.caption ||
    ""
  ).trim();
}

function getQuotedMessage(m) {
  const ext = m.message?.extendedTextMessage;
  const ctx = ext?.contextInfo;
  if (!ctx?.quotedMessage) return null;

  // Bentuk “fake message object” minimal buat handler downstream
  return {
    key: {
      remoteJid: m.key.remoteJid,
      fromMe: false,
      id: ctx.stanzaId,
      participant: ctx.participant
    },
    message: ctx.quotedMessage
  };
}

async function startSock() {
  const logger = pino({ level: "silent" });
  const store = makeInMemoryStore({ logger });
  store.readFromFile("./baileys_store.json");
  setInterval(() => store.writeToFile("./baileys_store.json"), 10_000);

  const { state, saveCreds } = await useMultiFileAuthState("./session");
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    logger,
    printQRInTerminal: false,
    auth: state,
    version,
    generateHighQualityLinkPreview: true,
    syncFullHistory: false
  });

  store.bind(sock.ev);

  // pairing mode
  if (process.argv.includes("--pairing")) {
    const phone = process.env.PAIRING_NUMBER; // format: 62812xxxx
    if (!phone) {
      console.log("Set env PAIRING_NUMBER=62812xxxx dulu.");
    } else {
      const code = await sock.requestPairingCode(phone);
      console.log("Pairing code:", code);
    }
  }

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) qrcode.generate(qr, { small: true });

    if (connection === "close") {
      const code = lastDisconnect?.error?.output?.statusCode;
      const shouldReconnect = code !== DisconnectReason.loggedOut;
      console.log("Connection closed:", code, "reconnect?", shouldReconnect);
      if (shouldReconnect) startSock();
    } else if (connection === "open") {
      console.log("✅ Bot online.");
    }
  });

  sock.ev.on("messages.upsert", async ({ messages, type }) => {
    if (type !== "notify") return;
    const m = messages[0];
    if (!m?.message) return;
    if (m.key?.remoteJid === "status@broadcast") return;

    const from = m.key.remoteJid;
    const sender = jidNormalizedUser(m.key.participant || m.key.remoteJid);

    // owner only gate
    if (OWNER_ONLY && sender !== OWNER_JID) return;

    const text = getText(m);
    const pfx = pickPrefix(text);
    if (!pfx) {
      // Auto RVO mode? (kalau mau otomatis tanpa command, bisa aktifkan di sini)
      return;
    }

    const [cmdRaw, ...rest] = text.slice(pfx.length).trim().split(/\s+/);
    const cmd = (cmdRaw || "").toLowerCase();
    const args = rest.join(" ");

    const quoted = getQuotedMessage(m);

    try {
      if (cmd === "rvo") {
        await handleRvoCommand(sock, m, quoted);
      } else if (cmd === "s" || cmd === "sticker") {
        await handleStickerCommand(sock, m, quoted, args);
      } else if (cmd === "menu" || cmd === "help") {
        await sock.sendMessage(from, {
          text:
            "🧩 *Mini Bot*\n\n" +
            `• ${pfx}rvo (reply view-once)\n` +
            `• ${pfx}sticker / ${pfx}s (reply foto/video)\n\n` +
            "Gen Z summary: cuma 2 fitur, tapi niat 😎"
        }, { quoted: m });
      }
    } catch (e) {
      await sock.sendMessage(from, { text: `Error: ${String(e?.message || e)}` }, { quoted: m });
    }
  });
}

startSock();
