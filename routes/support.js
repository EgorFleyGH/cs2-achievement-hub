const express = require("express");
const rateLimit = require("express-rate-limit");
const {
  createSupportMessage,
  getSupportThread,
  markSupportRead,
  getSupportUnreadCountForUser
} = require("../db");
const { OWNER_USERNAME } = require("../config");
const { notifyDiscord } = require("../discord");

const router = express.Router();

const messageLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 15,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Слишком много сообщений. Подождите немного." }
});

function requireAuth(req, res, next) {
  if (!req.session.userId) {
    return res.status(401).json({ error: "Нужно войти в аккаунт" });
  }
  next();
}

// Свой диалог с поддержкой (владельцем сайта).
router.get("/support/messages", requireAuth, async (req, res) => {
  try {
    const thread = await getSupportThread(req.session.userId);
    // Сообщения владельца, которые видит игрок, отмечаем прочитанными.
    await markSupportRead(req.session.userId, false);
    res.json(thread);
  } catch (e) {
    console.error("Ошибка загрузки чата поддержки:", e);
    res.status(500).json({ error: "Не удалось загрузить сообщения" });
  }
});

router.get("/support/unread-count", requireAuth, async (req, res) => {
  try {
    const count = await getSupportUnreadCountForUser(req.session.userId);
    res.json({ count });
  } catch (e) {
    console.error("Ошибка подсчёта сообщений поддержки:", e);
    res.status(500).json({ error: "Не удалось получить количество сообщений" });
  }
});

router.post("/support/messages", requireAuth, messageLimiter, async (req, res) => {
  const { message } = req.body || {};

  if (typeof message !== "string" || message.trim().length === 0) {
    return res.status(400).json({ error: "Сообщение не может быть пустым" });
  }
  if (message.length > 1000) {
    return res.status(400).json({ error: "Сообщение слишком длинное" });
  }

  try {
    const fromOwner = req.session.username === OWNER_USERNAME;
    const saved = await createSupportMessage(req.session.userId, fromOwner, message.trim());

    // В Discord пингуем только сообщения ОТ игроков — иначе твои же
    // ответы в поддержку будут пинговать тебя самого.
    if (!fromOwner) {
      notifyDiscord(`💬 Новое сообщение в поддержку от ${req.session.username}: ${message.trim().slice(0, 200)}`);
    }

    res.status(201).json(saved);
  } catch (e) {
    console.error("Ошибка отправки сообщения поддержки:", e);
    res.status(500).json({ error: "Не удалось отправить сообщение" });
  }
});

module.exports = router;
