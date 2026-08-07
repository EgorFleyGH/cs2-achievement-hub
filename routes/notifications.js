const express = require("express");
const {
  getNotifications,
  getUnreadNotificationCount,
  markAllNotificationsRead
} = require("../db");

const router = express.Router();

function requireAuth(req, res, next) {
  if (!req.session.userId) {
    return res.status(401).json({ error: "Нужно войти в аккаунт" });
  }
  next();
}

router.get("/notifications", requireAuth, async (req, res) => {
  try {
    const notifications = await getNotifications(req.session.userId);
    res.json(notifications);
  } catch (e) {
    console.error("Ошибка загрузки уведомлений:", e);
    res.status(500).json({ error: "Не удалось загрузить уведомления" });
  }
});

router.get("/notifications/unread-count", requireAuth, async (req, res) => {
  try {
    const count = await getUnreadNotificationCount(req.session.userId);
    res.json({ count });
  } catch (e) {
    console.error("Ошибка подсчёта уведомлений:", e);
    res.status(500).json({ error: "Не удалось получить количество уведомлений" });
  }
});

router.post("/notifications/read", requireAuth, async (req, res) => {
  try {
    await markAllNotificationsRead(req.session.userId);
    res.json({ ok: true });
  } catch (e) {
    console.error("Ошибка отметки уведомлений:", e);
    res.status(500).json({ error: "Не удалось отметить уведомления" });
  }
});

module.exports = router;
