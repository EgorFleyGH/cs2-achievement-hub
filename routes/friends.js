const express = require("express");
const {
  findUserByUsername,
  sendFriendRequest,
  getFriendshipBetween,
  acceptFriendRequest,
  removeFriendship,
  getFriendsList,
  getIncomingFriendRequests,
  getOutgoingFriendRequests,
  createNotification
} = require("../db");

const router = express.Router();

function requireAuth(req, res, next) {
  if (!req.session.userId) {
    return res.status(401).json({ error: "Нужно войти в аккаунт" });
  }
  next();
}

router.get("/friends", requireAuth, async (req, res) => {
  try {
    const friends = await getFriendsList(req.session.userId);
    res.json(friends.map((f) => ({ id: f.user_id, username: f.username, avatar: f.avatar || "", friendshipId: f.friendship_id })));
  } catch (e) {
    console.error("Ошибка загрузки списка друзей:", e);
    res.status(500).json({ error: "Не удалось загрузить друзей" });
  }
});

router.get("/friends/requests", requireAuth, async (req, res) => {
  try {
    const [incoming, outgoing] = await Promise.all([
      getIncomingFriendRequests(req.session.userId),
      getOutgoingFriendRequests(req.session.userId)
    ]);
    res.json({
      incoming: incoming.map((f) => ({ id: f.user_id, username: f.username, avatar: f.avatar || "", friendshipId: f.friendship_id })),
      outgoing: outgoing.map((f) => ({ id: f.user_id, username: f.username, avatar: f.avatar || "", friendshipId: f.friendship_id }))
    });
  } catch (e) {
    console.error("Ошибка загрузки заявок в друзья:", e);
    res.status(500).json({ error: "Не удалось загрузить заявки" });
  }
});

router.post("/friends/request/:username", requireAuth, async (req, res) => {
  try {
    const target = await findUserByUsername(req.params.username);
    if (!target) return res.status(404).json({ error: "Пользователь не найден" });
    if (target.id === req.session.userId) return res.status(400).json({ error: "Нельзя добавить самого себя" });

    const existing = await getFriendshipBetween(req.session.userId, target.id);
    if (existing) return res.status(409).json({ error: "Заявка уже существует или вы уже друзья" });

    await sendFriendRequest(req.session.userId, target.id);

    await createNotification(
      target.id,
      "friend_request",
      `${req.session.username} хочет добавить тебя в друзья`,
      null
    );

    res.status(201).json({ ok: true });
  } catch (e) {
    console.error("Ошибка отправки заявки в друзья:", e);
    res.status(500).json({ error: "Не удалось отправить заявку" });
  }
});

router.post("/friends/:id/accept", requireAuth, async (req, res) => {
  try {
    const friendship = await acceptFriendRequest(Number(req.params.id), req.session.userId);
    if (!friendship) return res.status(404).json({ error: "Заявка не найдена" });

    await createNotification(
      friendship.requester_id,
      "friend_accepted",
      `${req.session.username} принял(а) твою заявку в друзья`,
      null
    );

    res.json({ ok: true });
  } catch (e) {
    console.error("Ошибка принятия заявки в друзья:", e);
    res.status(500).json({ error: "Не удалось принять заявку" });
  }
});

router.delete("/friends/:id", requireAuth, async (req, res) => {
  try {
    const removed = await removeFriendship(Number(req.params.id), req.session.userId);
    if (!removed) return res.status(404).json({ error: "Не найдено" });
    res.json({ ok: true });
  } catch (e) {
    console.error("Ошибка удаления заявки/дружбы:", e);
    res.status(500).json({ error: "Не удалось выполнить действие" });
  }
});

module.exports = router;
