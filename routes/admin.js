const express = require("express");
const {
  getAllUsers,
  setUserBanned,
  getPendingChallenges,
  setChallengeStatus,
  deleteChallenge,
  getStats,
  getAllNews,
  createNews,
  updateNews,
  deleteNews
} = require("../db");
const { OWNER_USERNAME } = require("../config");

const router = express.Router();

// Все роуты этого файла доступны только владельцу сайта.
// Проверка — на сервере, поэтому спрятать вкладку в интерфейсе
// недостаточно само по себе, но и обойти это из консоли браузера нельзя.
function requireOwner(req, res, next) {
  if (!req.session.userId || req.session.username !== OWNER_USERNAME) {
    return res.status(403).json({ error: "Доступ только для владельца сайта" });
  }
  next();
}

router.use(requireOwner);

// =========================
// Статистика
// =========================
router.get("/stats", async (req, res) => {
  try {
    const stats = await getStats();
    res.json(stats);
  } catch (e) {
    console.error("Ошибка статистики:", e);
    res.status(500).json({ error: "Не удалось получить статистику" });
  }
});

// =========================
// Пользователи (бан/разбан)
// =========================
router.get("/users", async (req, res) => {
  try {
    const users = await getAllUsers();
    res.json(users);
  } catch (e) {
    console.error("Ошибка списка пользователей:", e);
    res.status(500).json({ error: "Не удалось получить список пользователей" });
  }
});

router.post("/users/:id/ban", async (req, res) => {
  const id = Number(req.params.id);

  try {
    const user = await setUserBanned(id, true);
    if (!user) return res.status(404).json({ error: "Пользователь не найден" });
    if (user.username === OWNER_USERNAME) {
      return res.status(400).json({ error: "Нельзя заблокировать владельца" });
    }
    res.json(user);
  } catch (e) {
    console.error("Ошибка бана:", e);
    res.status(500).json({ error: "Не удалось заблокировать пользователя" });
  }
});

router.post("/users/:id/unban", async (req, res) => {
  const id = Number(req.params.id);

  try {
    const user = await setUserBanned(id, false);
    if (!user) return res.status(404).json({ error: "Пользователь не найден" });
    res.json(user);
  } catch (e) {
    console.error("Ошибка разбана:", e);
    res.status(500).json({ error: "Не удалось разблокировать пользователя" });
  }
});

// =========================
// Модерация квестов
// =========================
router.get("/challenges/pending", async (req, res) => {
  try {
    const pending = await getPendingChallenges();
    res.json(
      pending.map((c) => ({
        id: c.id,
        icon: c.icon,
        title: c.title,
        desc: c.desc,
        rarity: c.rarity,
        authorUsername: c.authorUsername
      }))
    );
  } catch (e) {
    console.error("Ошибка загрузки квестов на модерации:", e);
    res.status(500).json({ error: "Не удалось загрузить квесты на модерации" });
  }
});

router.post("/challenges/:id/approve", async (req, res) => {
  const id = Number(req.params.id);

  try {
    const challenge = await setChallengeStatus(id, "approved");
    if (!challenge) return res.status(404).json({ error: "Квест не найден" });
    res.json({ ok: true });
  } catch (e) {
    console.error("Ошибка одобрения квеста:", e);
    res.status(500).json({ error: "Не удалось одобрить квест" });
  }
});

router.post("/challenges/:id/reject", async (req, res) => {
  const id = Number(req.params.id);

  try {
    const challenge = await setChallengeStatus(id, "rejected");
    if (!challenge) return res.status(404).json({ error: "Квест не найден" });
    res.json({ ok: true });
  } catch (e) {
    console.error("Ошибка отклонения квеста:", e);
    res.status(500).json({ error: "Не удалось отклонить квест" });
  }
});

// Полное удаление — в том числе уже одобренных квестов.
router.delete("/challenges/:id", async (req, res) => {
  const id = Number(req.params.id);

  try {
    const deleted = await deleteChallenge(id);
    if (!deleted) return res.status(404).json({ error: "Квест не найден" });
    res.json({ ok: true });
  } catch (e) {
    console.error("Ошибка удаления квеста:", e);
    res.status(500).json({ error: "Не удалось удалить квест" });
  }
});

// =========================
// Новости
// =========================
router.get("/news", async (req, res) => {
  try {
    const news = await getAllNews();
    res.json(news);
  } catch (e) {
    console.error("Ошибка списка новостей:", e);
    res.status(500).json({ error: "Не удалось получить новости" });
  }
});

router.post("/news", async (req, res) => {
  const { title, body, titleEn, bodyEn } = req.body || {};

  if (typeof title !== "string" || title.trim().length === 0) {
    return res.status(400).json({ error: "Заголовок обязателен" });
  }
  if (title.length > 80) {
    return res.status(400).json({ error: "Заголовок слишком длинный" });
  }
  if (typeof body !== "string" || body.trim().length === 0) {
    return res.status(400).json({ error: "Текст новости обязателен" });
  }
  if (body.length > 500) {
    return res.status(400).json({ error: "Текст новости слишком длинный" });
  }
  if (typeof titleEn === "string" && titleEn.length > 80) {
    return res.status(400).json({ error: "Английский заголовок слишком длинный" });
  }
  if (typeof bodyEn === "string" && bodyEn.length > 500) {
    return res.status(400).json({ error: "Английский текст слишком длинный" });
  }

  try {
    const news = await createNews(
      title.trim(),
      body.trim(),
      typeof titleEn === "string" ? titleEn.trim() : "",
      typeof bodyEn === "string" ? bodyEn.trim() : ""
    );
    res.status(201).json(news);
  } catch (e) {
    console.error("Ошибка публикации новости:", e);
    res.status(500).json({ error: "Не удалось опубликовать новость" });
  }
});

router.put("/news/:id", async (req, res) => {
  const id = Number(req.params.id);
  const { title, body, titleEn, bodyEn } = req.body || {};

  if (typeof title !== "string" || title.trim().length === 0) {
    return res.status(400).json({ error: "Заголовок обязателен" });
  }
  if (typeof body !== "string" || body.trim().length === 0) {
    return res.status(400).json({ error: "Текст новости обязателен" });
  }

  try {
    const news = await updateNews(
      id,
      title.trim(),
      body.trim(),
      typeof titleEn === "string" ? titleEn.trim() : "",
      typeof bodyEn === "string" ? bodyEn.trim() : ""
    );
    if (!news) return res.status(404).json({ error: "Новость не найдена" });
    res.json(news);
  } catch (e) {
    console.error("Ошибка редактирования новости:", e);
    res.status(500).json({ error: "Не удалось обновить новость" });
  }
});

router.delete("/news/:id", async (req, res) => {
  const id = Number(req.params.id);

  try {
    const deleted = await deleteNews(id);
    if (!deleted) return res.status(404).json({ error: "Новость не найдена" });
    res.json({ ok: true });
  } catch (e) {
    console.error("Ошибка удаления новости:", e);
    res.status(500).json({ error: "Не удалось удалить новость" });
  }
});

module.exports = router;
