const express = require("express");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const rateLimit = require("express-rate-limit");
const {
  getChallengeById,
  createDemoSubmission,
  getPendingSubmissionForUserChallenge,
  findUserByUsername,
  createNotification
} = require("../db");
const { OWNER_USERNAME } = require("../config");
const { notifyDiscord } = require("../discord");

const router = express.Router();

// Демки CS2 хранятся на диске сервера (не в базе — они слишком большие
// для этого). ВАЖНО: если хостинг (например, Render на бесплатном плане)
// использует эфемерную файловую систему, файлы пропадут при передеплое —
// для долгосрочного хранения понадобится внешнее хранилище (S3 и т.п.).
const DEMOS_DIR = path.join(__dirname, "..", "uploads", "demos");
fs.mkdirSync(DEMOS_DIR, { recursive: true });

function requireAuth(req, res, next) {
  if (!req.session.userId) {
    return res.status(401).json({ error: "Нужно войти в аккаунт" });
  }
  next();
}

// Файлы весят до 500 МБ каждый — без лимита по частоте один аккаунт
// мог бы забить весь диск сервера, закинув демки/видео по многим
// разным челленджам подряд (по одному челленджу от повтора и так
// защищает getPendingSubmissionForUserChallenge, но не от заливки
// сразу на десятки разных). Считаем попытки по userId, а не по IP —
// так несколько игроков за одним роутером не мешают друг другу.
const demoUploadLimiter = rateLimit({
  windowMs: 30 * 60 * 1000, // 30 минут
  max: 5,                   // 5 загрузок с одного аккаунта за окно
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => String(req.session.userId),
  message: { error: "Слишком много загрузок подряд. Попробуйте позже." }
});

// Демки весят десятки, иногда сотни мегабайт — принимаем сырое бинарное
// тело запроса, а не JSON/base64 (это было бы почти в 1.5 раза тяжелее).
const rawDemoBody = express.raw({
  type: "*/*",
  limit: "500mb"
});

router.post("/challenges/:id/submit-demo", requireAuth, demoUploadLimiter, rawDemoBody, async (req, res) => {
  const challengeId = Number(req.params.id);
  const buffer = req.body;

  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    return res.status(400).json({ error: "Файл не получен" });
  }

  if (buffer.length < 1024) {
    return res.status(400).json({ error: "Файл подозрительно маленький" });
  }

  // Имя исходного файла присылает фронтенд отдельным заголовком —
  // по расширению решаем, что за файл и как его проверять.
  let originalName = "";
  try {
    originalName = decodeURIComponent(req.get("X-File-Name") || "").toLowerCase();
  } catch (e) {
    originalName = "";
  }

  const isDem = originalName.endsWith(".dem");
  const isVideo = originalName.endsWith(".mp4");

  if (!isDem && !isVideo) {
    return res.status(400).json({ error: "Разрешены только файлы .dem или .mp4" });
  }

  if (isDem) {
    // Настоящие демки Source/CS2 начинаются с сигнатуры "HL2DEMO" —
    // это не проверка содержимого игры, а базовая проверка, что файл
    // действительно является демкой, а не случайной подделкой.
    const signature = buffer.subarray(0, 7).toString("latin1");
    if (signature !== "HL2DEMO") {
      return res.status(400).json({ error: "Это не похоже на файл демки CS2 (.dem)" });
    }
  } else {
    // MP4-контейнер почти всегда содержит блок "ftyp" в первых байтах —
    // так же, как с демкой, это проверка подлинности формата, а не
    // содержимого видео.
    const box = buffer.subarray(4, 8).toString("latin1");
    if (box !== "ftyp") {
      return res.status(400).json({ error: "Это не похоже на видео формата .mp4" });
    }
  }

  const kind = isVideo ? "video" : "dem";

  try {
    const challenge = await getChallengeById(challengeId);
    if (!challenge || challenge.status !== "approved") {
      return res.status(404).json({ error: "Челлендж не найден" });
    }

    if (challenge.completedBy.includes(req.session.userId)) {
      return res.status(400).json({ error: "Этот челлендж уже засчитан" });
    }

    const existing = await getPendingSubmissionForUserChallenge(challengeId, req.session.userId);
    if (existing) {
      return res.status(400).json({ error: "У вас уже есть запись на проверке по этому челленджу" });
    }

    const storedFilename = crypto.randomUUID() + (isVideo ? ".mp4" : ".dem");
    await fs.promises.writeFile(path.join(DEMOS_DIR, storedFilename), buffer);

    const submission = await createDemoSubmission(
      challengeId,
      req.session.userId,
      req.session.username,
      storedFilename,
      buffer.length,
      kind
    );

    // Уведомляем владельца сайта — файл нужно скачать (или посмотреть,
    // если это видео) и проверить вручную, автоматического разбора
    // содержимого демки/видео здесь не делается.
    const owner = await findUserByUsername(OWNER_USERNAME);
    const label = isVideo ? "видео" : "демку";
    if (owner) {
      await createNotification(
        owner.id,
        "demo_submitted",
        `🎬 Игрок ${req.session.username} прислал ${label} на проверку по челленджу «${challenge.title}»`,
        challengeId
      );
    }

    notifyDiscord(
      `🎬 Игрок ${req.session.username} прислал ${label} на проверку по челленджу «${challenge.title}» (${(buffer.length / 1024 / 1024).toFixed(1)} МБ)`
    );

    res.status(201).json({ ok: true, submissionId: submission.id });
  } catch (e) {
    console.error("Ошибка загрузки файла подтверждения:", e);
    res.status(500).json({ error: "Не удалось загрузить файл" });
  }
});

module.exports = router;
