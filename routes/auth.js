const express = require("express");
const bcrypt = require("bcryptjs");
const rateLimit = require("express-rate-limit");
const {
  findUserByUsername,
  createUser,
  setUserAvatar,
  setUserSteamUrl,
  resetUserPassword,
  createNotification,
  getAllBackgrounds,
  setUserBackground
} = require("../db");
const { OWNER_USERNAME } = require("../config");
const { notifyDiscord } = require("../discord");

const router = express.Router();

// Не даём перебирать пароли/логины методом брутфорса.
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 минут
  max: 20,                  // 20 попыток с одного IP на регистрацию+логин
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Слишком много попыток. Попробуйте позже." }
});

const USERNAME_RE = /^[a-zA-Z0-9_]{3,20}$/;

function validateCredentials(username, password) {
  if (typeof username !== "string" || typeof password !== "string") {
    return "Некорректные данные";
  }
  if (!USERNAME_RE.test(username)) {
    return "Ник: 3-20 символов, латиница/цифры/подчёркивание";
  }
  if (password.length < 6 || password.length > 72) {
    return "Пароль должен быть от 6 до 72 символов";
  }
  return null;
}

// =========================
// Регистрация
// =========================
router.post("/register", authLimiter, async (req, res) => {
  const { username, password } = req.body || {};

  const error = validateCredentials(username, password);
  if (error) {
    return res.status(400).json({ error });
  }

  try {
    const existing = await findUserByUsername(username);
    if (existing) {
      return res.status(409).json({ error: "Такой ник уже занят" });
    }

    const hash = bcrypt.hashSync(password, 10);

    const user = await createUser(username, hash);

    req.session.userId = user.id;
    req.session.username = user.username;

    res.status(201).json({ id: user.id, username: user.username, avatar: user.avatar || "", steamUrl: user.steam_url || "", backgroundId: user.background_id || null, isOwner: user.username === OWNER_USERNAME });
  } catch (e) {
    console.error("Ошибка регистрации:", e);
    res.status(500).json({ error: "Не удалось зарегистрироваться, попробуйте позже" });
  }
});

// =========================
// Вход
// =========================
router.post("/login", authLimiter, async (req, res) => {
  const { username, password } = req.body || {};

  if (typeof username !== "string" || typeof password !== "string") {
    return res.status(400).json({ error: "Некорректные данные" });
  }

  try {
    const user = await findUserByUsername(username);

    // Намеренно одинаковое сообщение для "нет юзера" и "неверный пароль" —
    // чтобы нельзя было угадывать существующие ники перебором.
    if (!user || !bcrypt.compareSync(password, user.password_hash)) {
      return res.status(401).json({ error: "Неверный ник или пароль" });
    }

    if (user.banned) {
      return res.status(403).json({ error: "Этот аккаунт заблокирован" });
    }

    req.session.userId = user.id;
    req.session.username = user.username;

    res.json({ id: user.id, username: user.username, avatar: user.avatar || "", steamUrl: user.steam_url || "", backgroundId: user.background_id || null, isOwner: user.username === OWNER_USERNAME });
  } catch (e) {
    console.error("Ошибка входа:", e);
    res.status(500).json({ error: "Не удалось войти, попробуйте позже" });
  }
});

// =========================
// Выход
// =========================
router.post("/logout", (req, res) => {
  req.session.destroy(() => {
    res.clearCookie("connect.sid");
    res.json({ ok: true });
  });
});

// =========================
// Запрос на восстановление пароля
// =========================
// У сайта нет почты, поэтому самостоятельного сброса нет — запрос
// просто уведомляет владельца сайта (в самом приложении и в Discord),
// а дальше он сбрасывает пароль вручную через Админку -> Пользователи
// и присылает новый пароль игроку сам, в личных сообщениях.
const recoveryLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Слишком много запросов. Попробуйте позже." }
});

router.post("/recovery-request", recoveryLimiter, async (req, res) => {
  const { username } = req.body || {};

  if (typeof username !== "string" || username.trim().length === 0) {
    return res.status(400).json({ error: "Укажите ник аккаунта" });
  }

  try {
    const user = await findUserByUsername(username.trim());

    // Специально не сообщаем, найден ли аккаунт — иначе по ответу можно
    // было бы перебором выяснять, какие ники вообще зарегистрированы.
    if (user) {
      const owner = await findUserByUsername(OWNER_USERNAME);
      if (owner) {
        await createNotification(
          owner.id,
          "password_recovery",
          `🔑 Игрок ${user.username} запросил восстановление пароля — сбросьте его в Админке → Пользователи и пришлите новый пароль лично.`,
          null
        );
      }
      notifyDiscord(`🔑 Запрос на восстановление пароля от игрока ${user.username}`);
    }

    res.json({ ok: true });
  } catch (e) {
    console.error("Ошибка запроса на восстановление пароля:", e);
    res.status(500).json({ error: "Не удалось отправить запрос" });
  }
});

// =========================
// Текущая сессия
// =========================
router.get("/me", async (req, res) => {
  if (!req.session.userId) {
    return res.status(401).json({ error: "Не авторизован" });
  }

  try {
    const user = await findUserByUsername(req.session.username);

    if (!user || user.banned) {
      req.session.destroy(() => {});
      return res.status(403).json({ error: "Этот аккаунт заблокирован" });
    }

    res.json({
      id: req.session.userId,
      username: req.session.username,
      avatar: user.avatar || "",
      steamUrl: user.steam_url || "",
      backgroundId: user.background_id || null,
      isOwner: req.session.username === OWNER_USERNAME
    });
  } catch (e) {
    console.error("Ошибка проверки сессии:", e);
    res.status(500).json({ error: "Ошибка сервера" });
  }
});

// =========================
// Загрузка аватара (сохраняется на сервере — нужен, чтобы другие
// игроки могли видеть его в вашем публичном профиле)
// =========================
router.post("/profile/avatar", async (req, res) => {
  if (!req.session.userId) {
    return res.status(401).json({ error: "Нужно войти в аккаунт" });
  }

  const { avatar } = req.body || {};

  if (typeof avatar !== "string" || !avatar.startsWith("data:image/")) {
    return res.status(400).json({ error: "Некорректный формат картинки" });
  }
  if (avatar.length > 1_500_000) {
    return res.status(400).json({ error: "Картинка слишком большая" });
  }

  try {
    const user = await setUserAvatar(req.session.userId, avatar);
    res.json({ avatar: user.avatar });
  } catch (e) {
    console.error("Ошибка загрузки аватара:", e);
    res.status(500).json({ error: "Не удалось сохранить аватар" });
  }
});

// =========================
// Ссылка на Steam-профиль (или любую другую ссылку профиля)
// =========================
router.post("/profile/steam", async (req, res) => {
  if (!req.session.userId) {
    return res.status(401).json({ error: "Нужно войти в аккаунт" });
  }

  const { steamUrl } = req.body || {};

  if (steamUrl !== "" && typeof steamUrl === "string") {
    if (steamUrl.length > 200) {
      return res.status(400).json({ error: "Ссылка слишком длинная" });
    }
    if (!/^https?:\/\//i.test(steamUrl)) {
      return res.status(400).json({ error: "Ссылка должна начинаться с http:// или https://" });
    }
  } else if (steamUrl !== "") {
    return res.status(400).json({ error: "Некорректная ссылка" });
  }

  try {
    const user = await setUserSteamUrl(req.session.userId, steamUrl || null);
    res.json({ steamUrl: user.steam_url || "" });
  } catch (e) {
    console.error("Ошибка сохранения Steam-ссылки:", e);
    res.status(500).json({ error: "Не удалось сохранить ссылку" });
  }
});

// =========================
// Фоны профиля
// =========================

// Публично — список доступных фонов виден всем, логин не нужен.
router.get("/backgrounds", async (req, res) => {
  try {
    const backgrounds = await getAllBackgrounds();
    res.json(backgrounds.map((b) => ({ id: b.id, name: b.name, imageUrl: b.image_url })));
  } catch (e) {
    console.error("Ошибка загрузки фонов:", e);
    res.status(500).json({ error: "Не удалось загрузить фоны" });
  }
});

router.post("/profile/background", async (req, res) => {
  if (!req.session.userId) {
    return res.status(401).json({ error: "Нужно войти в аккаунт" });
  }

  const { backgroundId } = req.body || {};
  const id = backgroundId === null ? null : Number(backgroundId);

  if (id !== null && (!Number.isInteger(id) || id <= 0)) {
    return res.status(400).json({ error: "Некорректный фон" });
  }

  try {
    await setUserBackground(req.session.userId, id);
    res.json({ backgroundId: id });
  } catch (e) {
    console.error("Ошибка сохранения фона:", e);
    res.status(500).json({ error: "Не удалось сохранить фон" });
  }
});

// =========================
// Смена пароля самим игроком (пока он залогинен)
// =========================
// Требуем текущий пароль — иначе тот, кто получил доступ к чужой
// открытой сессии (забытый вход на общем компьютере и т.п.), мог бы
// перехватить аккаунт навсегда, просто сменив пароль без проверки.
router.post("/profile/password", authLimiter, async (req, res) => {
  if (!req.session.userId) {
    return res.status(401).json({ error: "Нужно войти в аккаунт" });
  }

  const { currentPassword, newPassword } = req.body || {};

  if (typeof currentPassword !== "string" || typeof newPassword !== "string") {
    return res.status(400).json({ error: "Некорректные данные" });
  }
  if (newPassword.length < 6 || newPassword.length > 72) {
    return res.status(400).json({ error: "Новый пароль должен быть от 6 до 72 символов" });
  }

  try {
    const user = await findUserByUsername(req.session.username);
    if (!user) {
      return res.status(404).json({ error: "Аккаунт не найден" });
    }

    if (!bcrypt.compareSync(currentPassword, user.password_hash)) {
      return res.status(401).json({ error: "Текущий пароль указан неверно" });
    }

    const hash = bcrypt.hashSync(newPassword, 10);
    await resetUserPassword(req.session.userId, hash);

    res.json({ ok: true });
  } catch (e) {
    console.error("Ошибка смены пароля:", e);
    res.status(500).json({ error: "Не удалось сменить пароль" });
  }
});

module.exports = router;
