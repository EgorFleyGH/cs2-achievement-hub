const express = require("express");
const rateLimit = require("express-rate-limit");
const {
  findUserByUsername,
  getFriendshipBetween,
  sendDirectMessage,
  getDirectThread,
  markDirectThreadRead,
  getDirectThreadsList,
  getUnreadDirectCount,
  createNotification
} = require("../db");

const router = express.Router();

const messageLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Слишком много сообщений. Попробуйте позже." }
});

function requireAuth(req, res, next) {
  if (!req.session.userId) {
    return res.status(401).json({ error: "Нужно войти в аккаунт" });
  }
  next();
}

// Личные сообщения разрешены только между друзьями — так меньше спама
// и травли, и это делает добавление в друзья осмысленным.
async function requireFriends(req, res, next) {
  try {
    const target = await findUserByUsername(req.params.username);
    if (!target) return res.status(404).json({ error: "Пользователь не найден" });

    const friendship = await getFriendshipBetween(req.session.userId, target.id);
    if (!friendship || friendship.status !== "accepted") {
      return res.status(403).json({ error: "Написать можно только другу" });
    }

    req.targetUser = target;
    next();
  } catch (e) {
    console.error("Ошибка проверки дружбы:", e);
    res.status(500).json({ error: "Ошибка сервера" });
  }
}

router.get("/messages", requireAuth, async (req, res) => {
  try {
    const threads = await getDirectThreadsList(req.session.userId);
    res.json(
      threads.map((t) => ({
        userId: t.user_id,
        username: t.username,
        avatar: t.avatar || "",
        lastMessage: t.last_message,
        lastMine: t.last_sender_id === req.session.userId,
        lastAt: t.last_at,
        unread: t.unread
      }))
    );
  } catch (e) {
    console.error("Ошибка загрузки диалогов:", e);
    res.status(500).json({ error: "Не удалось загрузить диалоги" });
  }
});

router.get("/messages/unread-count", requireAuth, async (req, res) => {
  try {
    const count = await getUnreadDirectCount(req.session.userId);
    res.json({ count });
  } catch (e) {
    console.error("Ошибка подсчёта непрочитанных сообщений:", e);
    res.status(500).json({ error: "Не удалось получить количество" });
  }
});

router.get("/messages/:username", requireAuth, requireFriends, async (req, res) => {
  try {
    const messages = await getDirectThread(req.session.userId, req.targetUser.id);
    await markDirectThreadRead(req.session.userId, req.targetUser.id);
    res.json(
      messages.map((m) => ({
        id: m.id,
        fromMe: m.sender_id === req.session.userId,
        message: m.message,
        createdAt: m.created_at
      }))
    );
  } catch (e) {
    console.error("Ошибка загрузки переписки:", e);
    res.status(500).json({ error: "Не удалось загрузить переписку" });
  }
});

router.post("/messages/:username", requireAuth, requireFriends, messageLimiter, async (req, res) => {
  const { message } = req.body || {};

  if (typeof message !== "string" || message.trim().length === 0) {
    return res.status(400).json({ error: "Сообщение не может быть пустым" });
  }
  if (message.length > 1000) {
    return res.status(400).json({ error: "Сообщение слишком длинное" });
  }

  try {
    const saved = await sendDirectMessage(req.session.userId, req.targetUser.id, message.trim());

    await createNotification(
      req.targetUser.id,
      "direct_message",
      `${req.session.username} написал(а) тебе: «${message.trim().slice(0, 80)}»`,
      null
    );

    res.status(201).json({
      id: saved.id,
      fromMe: true,
      message: saved.message,
      createdAt: saved.created_at
    });
  } catch (e) {
    console.error("Ошибка отправки сообщения:", e);
    res.status(500).json({ error: "Не удалось отправить сообщение" });
  }
});

module.exports = router;
