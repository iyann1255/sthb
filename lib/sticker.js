const fs = require("fs");
const path = require("path");
const os = require("os");
const { spawn } = require("child_process");
const { downloadContentFromMessage } = require("@whiskeysockets/baileys");

function tmpFile(ext) {
  return path.join(os.tmpdir(), `miniwa_${Date.now()}_${Math.random().toString(16).slice(2)}.${ext}`);
}

async function downloadQuotedMedia(quoted) {
  const msg = quoted?.message;
  if (!msg) return null;

  // bisa reply image/video
  const image = msg.imageMessage ? { type: "image", content: msg.imageMessage } : null;
  const video = msg.videoMessage ? { type: "video", content: msg.videoMessage } : null;
  const sticker = msg.stickerMessage ? { type: "sticker", content: msg.stickerMessage } : null;
  const pick = image || video || sticker;
  if (!pick) return null;

  const stream = await downloadContentFromMessage(pick.content, pick.type);
  let buffer = Buffer.from([]);
  for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk]);
  return { buffer, kind: pick.type };
}

function runFfmpeg(args) {
  return new Promise((resolve, reject) => {
    const p = spawn("ffmpeg", args, { stdio: "ignore" });
    p.on("error", reject);
    p.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg exit ${code}`))));
  });
}

/**
 * Sticker spec aman:
 * - webp
 * - max 512x512
 * - fps 15 untuk anim (video)
 * - durasi dibatesin
 */
async function toWebpSticker(inputPath, outputPath, isVideo) {
  if (!isVideo) {
    // image -> webp
    await runFfmpeg([
      "-y",
      "-i", inputPath,
      "-vf", "scale=512:512:force_original_aspect_ratio=decrease,fps=15,pad=512:512:-1:-1:color=0x00000000",
      "-vcodec", "libwebp",
      "-lossless", "1",
      "-qscale", "80",
      "-preset", "default",
      "-an",
      "-vsync", "0",
      outputPath
    ]);
  } else {
    // video -> webp (anim sticker)
    await runFfmpeg([
      "-y",
      "-i", inputPath,
      "-t", "8", // batas durasi biar ga barbar
      "-vf", "scale=512:512:force_original_aspect_ratio=decrease,fps=15,pad=512:512:-1:-1:color=0x00000000",
      "-vcodec", "libwebp",
      "-lossless", "0",
      "-qscale", "70",
      "-preset", "default",
      "-an",
      "-vsync", "0",
      outputPath
    ]);
  }
}

async function handleStickerCommand(sock, m, quoted, args) {
  const from = m.key.remoteJid;

  if (!quoted?.message) {
    return sock.sendMessage(from, { text: "Reply foto/video dulu, terus ketik: !sticker" }, { quoted: m });
  }

  const media = await downloadQuotedMedia(quoted);
  if (!media) {
    return sock.sendMessage(from, { text: "Yang kamu reply bukan foto/video/stiker." }, { quoted: m });
  }

  // kalau reply stiker, kita convert jadi stiker lagi (basically re-sticker)
  const isVideo = media.kind === "video";
  const inExt = isVideo ? "mp4" : (media.kind === "sticker" ? "webp" : "jpg");

  const inPath = tmpFile(inExt);
  const outPath = tmpFile("webp");

  fs.writeFileSync(inPath, media.buffer);

  await toWebpSticker(inPath, outPath, isVideo);

  const stickerBuf = fs.readFileSync(outPath);

  // cleanup
  fs.unlinkSync(inPath);
  fs.unlinkSync(outPath);

  await sock.sendMessage(from, { sticker: stickerBuf }, { quoted: m });
}

module.exports = { handleStickerCommand };
