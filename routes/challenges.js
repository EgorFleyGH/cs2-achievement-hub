const express = require("express");
const rateLimit = require("express-rate-limit");
const {
  getAllChallenges,
  createChallenge,
  likeChallenge,
  toggleChallengeDone
} = require("../db");
const { OWNER_USERNAME } = require("../config");

const router = express.Router();

// Публикация не должна происходить пачками — защита от спама.
const publishLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Слишком много публикаций. Попробуйте позже." }
});

function requireAuth(req, res, next) {
  if (!req.session.userId) {
    return res.status(401).json({ error: "Нужно войти в аккаунт" });
  }
  next();
}

// Приводим квест к виду, который ждёт фронтенд, добавляя
// личные флаги (лайкнул/выполнил ли ЭТОТ пользователь).
function serializeChallenge(challenge, userId) {
  return {
    id: challenge.id,
    icon: challenge.icon,
    title: challenge.title,
    desc: challenge.desc,
    rarity: challenge.rarity,
    authorUsername: challenge.authorUsername,
    authorIsOwner: challenge.authorUsername === OWNER_USERNAME,
    likes: challenge.likedBy.length,
    liked: userId ? challenge.likedBy.includes(userId) : false,
    done: userId ? challenge.completedBy.includes(userId) : false
  };
}

// =========================
// Список всех квестов (публично, логин не нужен)
// =========================
router.get("/challenges", (req, res) => {
  const userId = req.session.userId || null;
  const challenges = getAllChallenges().map((c) => serializeChallenge(c, userId));
  res.json(challenges);
});

// =========================
// Публикация нового квеста
// =========================
router.post("/challenges", requireAuth, publishLimiter, (req, res) => {
  const { icon, title, desc, rarity } = req.body || {};

  if (typeof title !== "string" || title.trim().length === 0) {
    return res.status(400).json({ error: "Название обязательно" });
  }
  if (title.length > 35) {
    return res.status(400).json({ error: "Название слишком длинное" });
  }
  if (typeof desc === "string" && desc.length > 140) {
    return res.status(400).json({ error: "Описание слишком длинное" });
  }

  const challenge = createChallenge(req.session.userId, req.session.username, {
    icon,
    title: title.trim(),
    desc: typeof desc === "string" ? desc.trim() : "",
    rarity
  });

  res.status(201).json(serializeChallenge(challenge, req.session.userId));
});

// =========================
// Лайк
// =========================
router.post("/challenges/:id/like", requireAuth, (req, res) => {
  const id = Number(req.params.id);

  const challenge = likeChallenge(id, req.session.userId);

  if (!challenge) {
    return res.status(404).json({ error: "Квест не найден" });
  }

  res.json(serializeChallenge(challenge, req.session.userId));
});

// =========================
// Отметить выполненным / снять отметку
// =========================
router.post("/challenges/:id/done", requireAuth, (req, res) => {
  const id = Number(req.params.id);

  const challenge = toggleChallengeDone(id, req.session.userId);

  if (!challenge) {
    return res.status(404).json({ error: "Квест не найден" });
  }

  res.json(serializeChallenge(challenge, req.session.userId));
});

module.exports = router;
