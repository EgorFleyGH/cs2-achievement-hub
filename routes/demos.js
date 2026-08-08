const express = require("express");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const {
  getChallengeById,
  createDemoSubmission,
  getPendingSubmissionForUserChallenge,
  findUserByUsername,
  createNotification
} = require("../db");
const { OWNER_USERNAME } = require("../config");

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

// Демки весят десятки, иногда сотни мегабайт — принимаем сырое бинарное
// тело запроса, а не JSON/base64 (это было бы почти в 1.5 раза тяжелее).
const rawDemoBody = express.raw({
  type: "*/*",
  limit: "500mb"
});

router.post("/challenges/:id/submit-demo", requireAuth, rawDemoBody, async (req, res) => {
  const challengeId = Number(req.params.id);
  const buffer = req.body;

  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    return res.status(400).json({ error: "Файл не получен" });
  }

  if (buffer.length < 1024) {
    return res.status(400).json({ error: "Файл демки подозрительно маленький" });
  }

  // Настоящие демки Source/CS2 начинаются с сигнатуры "HL2DEMO" —
  // это не проверка содержимого игры, а базовая проверка, что файл
  // действительно является демкой, а не случайной подделкой.
  const signature = buffer.subarray(0, 7).toString("latin1");
  if (signature !== "HL2DEMO") {
    return res.status(400).json({ error: "Это не похоже на файл демки CS2 (.dem)" });
  }

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
      return res.status(400).json({ error: "У вас уже есть демка на проверке по этому челленджу" });
    }

    const storedFilename = crypto.randomUUID() + ".dem";
    await fs.promises.writeFile(path.join(DEMOS_DIR, storedFilename), buffer);

    const submission = await createDemoSubmission(
      challengeId,
      req.session.userId,
      req.session.username,
      storedFilename,
      buffer.length
    );

    // Уведомляем владельца сайта — демку нужно скачать и проверить вручную,
    // автоматический разбор игровых событий внутри .dem здесь не делается.
    const owner = await findUserByUsername(OWNER_USERNAME);
    if (owner) {
      await createNotification(
        owner.id,
        "demo_submitted",
        `🎬 Игрок ${req.session.username} прислал демку на проверку по челленджу «${challenge.title}»`,
        challengeId
      );
    }

    res.status(201).json({ ok: true, submissionId: submission.id });
  } catch (e) {
    console.error("Ошибка загрузки демки:", e);
    res.status(500).json({ error: "Не удалось загрузить демку" });
  }
});

module.exports = router;
