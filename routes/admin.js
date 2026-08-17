const express = require("express");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const {
  getAllUsers,
  setUserBanned,
  resetUserPassword,
  getPendingChallenges,
  setChallengeStatus,
  deleteChallenge,
  getStats,
  getAllNews,
  createNews,
  updateNews,
  deleteNews,
  createNotification,
  getSupportThreadsList,
  getSupportThread,
  createSupportMessage,
  markSupportRead,
  getPendingDemoSubmissions,
  getDemoSubmissionById,
  setDemoSubmissionStatus,
  markChallengeCompletedForUser,
  getChallengeById,
  getAllBackgrounds,
  createBackground,
  deleteBackground
} = require("../db");
const { OWNER_USERNAME } = require("../config");

const DEMOS_DIR = path.join(__dirname, "..", "uploads", "demos");

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

// Сброс пароля игроку, потерявшему доступ (у сайта нет почты для
// самостоятельного восстановления). Новый пароль возвращается только
// один раз в этом ответе, в открытом виде — сохраняется у нас только
// его хеш. Владелец сайта должен сам переслать пароль игроку в личку.
function generateTempPassword() {
  // 10 читаемых случайных символов (без похожих друг на друга 0/O/1/l).
  const alphabet = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789";
  let result = "";
  for (let i = 0; i < 10; i++) {
    result += alphabet[crypto.randomInt(alphabet.length)];
  }
  return result;
}

router.post("/users/:id/reset-password", async (req, res) => {
  const id = Number(req.params.id);

  try {
    const newPassword = generateTempPassword();
    const hash = bcrypt.hashSync(newPassword, 10);

    const user = await resetUserPassword(id, hash);
    if (!user) return res.status(404).json({ error: "Пользователь не найден" });

    res.json({ username: user.username, newPassword });
  } catch (e) {
    console.error("Ошибка сброса пароля:", e);
    res.status(500).json({ error: "Не удалось сбросить пароль" });
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
        iconImage: c.iconImage,
        title: c.title,
        desc: c.desc,
        color: c.color,
        authorUsername: c.authorUsername
      }))
    );
  } catch (e) {
    console.error("Ошибка загрузки челленджей на модерации:", e);
    res.status(500).json({ error: "Не удалось загрузить челленджи на модерации" });
  }
});

router.post("/challenges/:id/approve", async (req, res) => {
  const id = Number(req.params.id);

  try {
    const challenge = await setChallengeStatus(id, "approved");
    if (!challenge) return res.status(404).json({ error: "Челлендж не найден" });

    await createNotification(
      challenge.authorId,
      "approved",
      `✅ Ваш челлендж «${challenge.title}» одобрен и опубликован в общей ленте!`,
      challenge.id
    );

    res.json({ ok: true });
  } catch (e) {
    console.error("Ошибка одобрения челленджа:", e);
    res.status(500).json({ error: "Не удалось одобрить челлендж" });
  }
});

router.post("/challenges/:id/reject", async (req, res) => {
  const id = Number(req.params.id);
  const { reason } = req.body || {};

  if (typeof reason === "string" && reason.length > 300) {
    return res.status(400).json({ error: "Причина отклонения слишком длинная" });
  }

  try {
    const challenge = await setChallengeStatus(id, "rejected", typeof reason === "string" ? reason.trim() : "");
    if (!challenge) return res.status(404).json({ error: "Челлендж не найден" });

    const reasonText = challenge.rejectReason ? ` Причина: ${challenge.rejectReason}` : "";
    await createNotification(
      challenge.authorId,
      "rejected",
      `❌ Ваш челлендж «${challenge.title}» был отклонён.${reasonText}`,
      challenge.id
    );

    res.json({ ok: true });
  } catch (e) {
    console.error("Ошибка отклонения челленджа:", e);
    res.status(500).json({ error: "Не удалось отклонить челлендж" });
  }
});

// Полное удаление — в том числе уже одобренных челленджей.
router.delete("/challenges/:id", async (req, res) => {
  const id = Number(req.params.id);

  try {
    const deleted = await deleteChallenge(id);
    if (!deleted) return res.status(404).json({ error: "Челлендж не найден" });
    res.json({ ok: true });
  } catch (e) {
    console.error("Ошибка удаления челленджа:", e);
    res.status(500).json({ error: "Не удалось удалить челлендж" });
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

// =========================
// Чат поддержки — все диалоги игроков с владельцем сайта
// =========================

router.get("/support/threads", async (req, res) => {
  try {
    const threads = await getSupportThreadsList();
    res.json(threads);
  } catch (e) {
    console.error("Ошибка загрузки диалогов поддержки:", e);
    res.status(500).json({ error: "Не удалось загрузить диалоги" });
  }
});

router.get("/support/:userId", async (req, res) => {
  const userId = Number(req.params.userId);

  try {
    const thread = await getSupportThread(userId);
    // Сообщения игрока, которые сейчас читает владелец, отмечаем прочитанными.
    await markSupportRead(userId, true);
    res.json(thread);
  } catch (e) {
    console.error("Ошибка загрузки диалога поддержки:", e);
    res.status(500).json({ error: "Не удалось загрузить диалог" });
  }
});

router.post("/support/:userId", async (req, res) => {
  const userId = Number(req.params.userId);
  const { message } = req.body || {};

  if (typeof message !== "string" || message.trim().length === 0) {
    return res.status(400).json({ error: "Сообщение не может быть пустым" });
  }
  if (message.length > 1000) {
    return res.status(400).json({ error: "Сообщение слишком длинное" });
  }

  try {
    const saved = await createSupportMessage(userId, true, message.trim());
    res.status(201).json(saved);
  } catch (e) {
    console.error("Ошибка отправки ответа в поддержку:", e);
    res.status(500).json({ error: "Не удалось отправить ответ" });
  }
});

// =========================
// Проверка демок (.dem), присланных игроками как подтверждение выполнения
// =========================

router.get("/demos", async (req, res) => {
  try {
    const pending = await getPendingDemoSubmissions();
    res.json(
      pending.map((d) => ({
        id: d.id,
        challengeId: d.challenge_id,
        challengeTitle: d.challenge_title,
        username: d.username,
        filename: d.filename,
        fileSize: d.file_size,
        kind: d.kind || "dem",
        createdAt: d.created_at
      }))
    );
  } catch (e) {
    console.error("Ошибка загрузки демок на проверке:", e);
    res.status(500).json({ error: "Не удалось загрузить список демок" });
  }
});

// Скачивание файла демки/видео — только владельцу, чтобы вручную
// посмотреть её в игре/аналитическом инструменте перед решением.
router.get("/demos/:id/download", async (req, res) => {
  const id = Number(req.params.id);

  try {
    const submission = await getDemoSubmissionById(id);
    if (!submission) return res.status(404).json({ error: "Файл не найден" });

    const filePath = path.join(DEMOS_DIR, submission.filename);
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: "Файл не найден на сервере" });
    }

    const ext = submission.kind === "video" ? "mp4" : "dem";
    res.download(filePath, `${submission.username}_${submission.challenge_id}.${ext}`);
  } catch (e) {
    console.error("Ошибка скачивания файла:", e);
    res.status(500).json({ error: "Не удалось скачать файл" });
  }
});

// Потоковая отдача видео для предпросмотра прямо в админке (без
// принудительного скачивания) — работает только для .mp4-записей.
router.get("/demos/:id/stream", async (req, res) => {
  const id = Number(req.params.id);

  try {
    const submission = await getDemoSubmissionById(id);
    if (!submission || submission.kind !== "video") {
      return res.status(404).json({ error: "Видео не найдено" });
    }

    const filePath = path.join(DEMOS_DIR, submission.filename);
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: "Файл не найден на сервере" });
    }

    res.setHeader("Content-Type", "video/mp4");
    res.sendFile(filePath);
  } catch (e) {
    console.error("Ошибка стриминга видео:", e);
    res.status(500).json({ error: "Не удалось загрузить видео" });
  }
});

router.post("/demos/:id/approve", async (req, res) => {
  const id = Number(req.params.id);

  try {
    const submission = await getDemoSubmissionById(id);
    if (!submission || submission.status !== "pending") {
      return res.status(404).json({ error: "Демка не найдена или уже проверена" });
    }

    const challenge = await getChallengeById(submission.challenge_id);
    await markChallengeCompletedForUser(submission.challenge_id, submission.user_id);
    await setDemoSubmissionStatus(id, "approved");

    await createNotification(
      submission.user_id,
      "demo_approved",
      `✅ Демка подтверждена! Челлендж «${challenge ? challenge.title : ""}» засчитан как выполненный.`,
      submission.challenge_id
    );

    // Файл больше не нужен после проверки — освобождаем место на диске.
    const filePath = path.join(DEMOS_DIR, submission.filename);
    fs.promises.unlink(filePath).catch(() => {});

    res.json({ ok: true });
  } catch (e) {
    console.error("Ошибка одобрения демки:", e);
    res.status(500).json({ error: "Не удалось одобрить демку" });
  }
});

router.post("/demos/:id/reject", async (req, res) => {
  const id = Number(req.params.id);
  const { reason } = req.body || {};

  if (typeof reason === "string" && reason.length > 300) {
    return res.status(400).json({ error: "Причина отклонения слишком длинная" });
  }

  try {
    const submission = await getDemoSubmissionById(id);
    if (!submission || submission.status !== "pending") {
      return res.status(404).json({ error: "Демка не найдена или уже проверена" });
    }

    const challenge = await getChallengeById(submission.challenge_id);
    await setDemoSubmissionStatus(id, "rejected", typeof reason === "string" ? reason.trim() : "");

    const reasonText = reason ? ` Причина: ${reason.trim()}` : "";
    await createNotification(
      submission.user_id,
      "demo_rejected",
      `❌ Демка по челленджу «${challenge ? challenge.title : ""}» отклонена.${reasonText} Можете отправить демку заново.`,
      submission.challenge_id
    );

    const filePath = path.join(DEMOS_DIR, submission.filename);
    fs.promises.unlink(filePath).catch(() => {});

    res.json({ ok: true });
  } catch (e) {
    console.error("Ошибка отклонения демки:", e);
    res.status(500).json({ error: "Не удалось отклонить демку" });
  }
});

// =========================
// Фоны интерфейса (каталог, управляет владелец)
// =========================
router.get("/backgrounds", async (req, res) => {
  try {
    const backgrounds = await getAllBackgrounds();
    res.json(backgrounds.map((b) => ({ id: b.id, name: b.name, imageUrl: b.image_url })));
  } catch (e) {
    console.error("Ошибка загрузки фонов:", e);
    res.status(500).json({ error: "Не удалось загрузить фоны" });
  }
});

router.post("/backgrounds", async (req, res) => {
  const { name, imageUrl } = req.body || {};

  if (typeof name !== "string" || name.trim().length === 0) {
    return res.status(400).json({ error: "Название обязательно" });
  }
  if (name.length > 60) {
    return res.status(400).json({ error: "Название слишком длинное" });
  }
  if (typeof imageUrl !== "string" || !imageUrl.startsWith("data:image/")) {
    return res.status(400).json({ error: "Нужна картинка" });
  }
  if (imageUrl.length > 3_000_000) {
    return res.status(400).json({ error: "Картинка слишком большая" });
  }

  try {
    const bg = await createBackground(name.trim(), imageUrl);
    res.status(201).json({ id: bg.id, name: bg.name, imageUrl: bg.image_url });
  } catch (e) {
    console.error("Ошибка добавления фона:", e);
    res.status(500).json({ error: "Не удалось добавить фон" });
  }
});

router.delete("/backgrounds/:id", async (req, res) => {
  try {
    const deleted = await deleteBackground(Number(req.params.id));
    if (!deleted) return res.status(404).json({ error: "Фон не найден" });
    res.json({ ok: true });
  } catch (e) {
    console.error("Ошибка удаления фона:", e);
    res.status(500).json({ error: "Не удалось удалить фон" });
  }
});

module.exports = router;
