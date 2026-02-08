const { downloadContentFromMessage } = require("@whiskeysockets/baileys");
const FileType = require("file-type");

function unwrapViewOnce(quotedMsg) {
  const msg = quotedMsg?.message;
  if (!msg) return null;

  // Baileys biasanya: viewOnceMessageV2 / viewOnceMessageV2Extension
  const v1 = msg.viewOnceMessage?.message;
  const v2 = msg.viewOnceMessageV2?.message;
  const v2x = msg.viewOnceMessageV2Extension?.message;

  return v2x || v2 || v1 || null;
}

async function downloadAnyMediaMessage(messageNode) {
  // messageNode is something like { imageMessage: {...} } or { videoMessage: {...} }
  const type = Object.keys(messageNode)[0];
  const content = messageNode[type];

  const stream = await downloadContentFromMessage(content, type.replace("Message", ""));
  let buffer = Buffer.from([]);
  for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk]);

  const ft = await FileType.fileTypeFromBuffer(buffer);
  return { buffer, mime: ft?.mime || content.mimetype || "application/octet-stream" };
}

async function handleRvoCommand(sock, m, quoted) {
  const from = m.key.remoteJid;
  if (!quoted?.message) {
    return sock.sendMessage(from, { text: "Reply dulu pesan *view once*-nya, terus ketik: !rvo" }, { quoted: m });
  }

  const unwrapped = unwrapViewOnce(quoted);
  if (!unwrapped) {
    return sock.sendMessage(from, { text: "Itu bukan pesan view once (atau udah gak kebaca)." }, { quoted: m });
  }

  // cari image/video
  const node =
    unwrapped.imageMessage ? { imageMessage: unwrapped.imageMessage } :
    unwrapped.videoMessage ? { videoMessage: unwrapped.videoMessage } :
    unwrapped.audioMessage ? { audioMessage: unwrapped.audioMessage } :
    null;

  if (!node) {
    return sock.sendMessage(from, { text: "RVO cuma support media (foto/video/audio) yang view once." }, { quoted: m });
  }

  const { buffer, mime } = await downloadAnyMediaMessage(node);

  if (mime.startsWith("image/")) {
    await sock.sendMessage(from, { image: buffer, caption: "✅ RVO: nih fotonya (udah jadi normal)." }, { quoted: m });
  } else if (mime.startsWith("video/")) {
    await sock.sendMessage(from, { video: buffer, caption: "✅ RVO: nih videonya (udah jadi normal)." }, { quoted: m });
  } else if (mime.startsWith("audio/")) {
    await sock.sendMessage(from, { audio: buffer, mimetype: mime }, { quoted: m });
  } else {
    await sock.sendMessage(from, { document: buffer, mimetype: mime, fileName: "rvo.bin" }, { quoted: m });
  }
}

module.exports = { handleRvoCommand };
