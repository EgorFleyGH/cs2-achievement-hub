const express = require("express");
const bcrypt = require("bcryptjs");
const rateLimit = require("express-rate-limit");
const { findUserByUsername, createUser } = require("../db");
const { OWNER_USERNAME } = require("../config");

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

    res.status(201).json({ id: user.id, username: user.username, isOwner: user.username === OWNER_USERNAME });
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

    req.session.userId = user.id;
    req.session.username = user.username;

    res.json({ id: user.id, username: user.username, isOwner: user.username === OWNER_USERNAME });
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
// Текущая сессия
// =========================
router.get("/me", (req, res) => {
  if (!req.session.userId) {
    return res.status(401).json({ error: "Не авторизован" });
  }
  res.json({ id: req.session.userId, username: req.session.username, isOwner: req.session.username === OWNER_USERNAME });
});

module.exports = router;
