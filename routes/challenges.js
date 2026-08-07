const express = require("express");
const rateLimit = require("express-rate-limit");
const {
  getApprovedChallenges,
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
// Список одобренных квестов (публично, логин не нужен)
// =========================
router.get("/challenges", async (req, res) => {
  try {
    const userId = req.session.userId || null;
    const challenges = await getApprovedChallenges();
    res.json(challenges.map((c) => serializeChallenge(c, userId)));
  } catch (e) {
    console.error("Ошибка загрузки квестов:", e);
    res.status(500).json({ error: "Не удалось загрузить испытания" });
  }
});

// =========================
// Публикация нового квеста (уходит на модерацию)
// =========================
router.post("/challenges", requireAuth, publishLimiter, async (req, res) => {
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

  try {
    const challenge = await createChallenge(req.session.userId, req.session.username, {
      icon,
      title: title.trim(),
      desc: typeof desc === "string" ? desc.trim() : "",
      rarity
    });

    // Квест ещё не виден в общей ленте — только после одобрения владельцем.
    res.status(201).json({
      ...serializeChallenge(challenge, req.session.userId),
      pending: true
    });
  } catch (e) {
    console.error("Ошибка публикации квеста:", e);
    res.status(500).json({ error: "Не удалось опубликовать испытание" });
  }
});

// =========================
// Лайк
// =========================
router.post("/challenges/:id/like", requireAuth, async (req, res) => {
  const id = Number(req.params.id);

  try {
    const challenge = await likeChallenge(id, req.session.userId);

    if (!challenge) {
      return res.status(404).json({ error: "Квест не найден" });
    }

    res.json(serializeChallenge(challenge, req.session.userId));
  } catch (e) {
    console.error("Ошибка лайка:", e);
    res.status(500).json({ error: "Не удалось поставить лайк" });
  }
});

// =========================
// Отметить выполненным / снять отметку
// =========================
router.post("/challenges/:id/done", requireAuth, async (req, res) => {
  const id = Number(req.params.id);

  try {
    const challenge = await toggleChallengeDone(id, req.session.userId);

    if (!challenge) {
      return res.status(404).json({ error: "Квест не найден" });
    }

    res.json(serializeChallenge(challenge, req.session.userId));
  } catch (e) {
    console.error("Ошибка отметки выполнения:", e);
    res.status(500).json({ error: "Не удалось обновить статус" });
  }
});

module.exports = router;
