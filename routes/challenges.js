const express = require("express");
const rateLimit = require("express-rate-limit");
const {
  getApprovedChallenges,
  getApprovedChallengesByUsername,
  getChallengesByAuthorId,
  getChallengeById,
  createChallenge,
  updateChallenge,
  likeChallenge,
  toggleChallengeDone,
  getUserPublicByUsername,
  createNotification,
  getUserPendingDemoChallengeIds
} = require("../db");
const { OWNER_USERNAME } = require("../config");
const { notifyDiscord } = require("../discord");

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

// Приводим челлендж к виду, который ждёт фронтенд, добавляя
// личные флаги (лайкнул/выполнил ли ЭТОТ пользователь, ждёт ли
// проверки его демка) и выбирая нужный язык текста — с откатом
// на русский, если перевода нет.
function serializeChallenge(challenge, userId, lang, pendingDemoIds) {
  const useEn = lang === "en" && challenge.titleEn;
  return {
    id: challenge.id,
    icon: challenge.icon,
    iconImage: challenge.iconImage,
    title: useEn ? challenge.titleEn : challenge.title,
    desc: (lang === "en" && challenge.descEn) ? challenge.descEn : challenge.desc,
    translated: lang === "en" ? !!challenge.titleEn : true,
    color: challenge.color,
    authorUsername: challenge.authorUsername,
    authorIsOwner: challenge.authorUsername === OWNER_USERNAME,
    likes: challenge.likedBy.length,
    liked: userId ? challenge.likedBy.includes(userId) : false,
    done: userId ? challenge.completedBy.includes(userId) : false,
    pendingDemo: pendingDemoIds ? pendingDemoIds.has(challenge.id) : false
  };
}

// То же самое, но с добавлением статуса модерации, причины отказа и
// СЫРЫХ RU/EN полей (а не только текста для текущего языка интерфейса) —
// используется в "Мои челленджи" в профиле: и чтобы автор видел весь
// свой список со статусами, и чтобы форма редактирования могла
// предзаполнить оба языка сразу, независимо от текущего языка сайта.
function serializeOwnChallenge(challenge, userId, lang, pendingDemoIds) {
  return {
    ...serializeChallenge(challenge, userId, lang, pendingDemoIds),
    status: challenge.status,
    rejectReason: challenge.rejectReason || null,
    titleRu: challenge.title,
    descRu: challenge.desc,
    titleEn: challenge.titleEn || "",
    descEn: challenge.descEn || ""
  };
}

// =========================
// Список одобренных челленджей (публично, логин не нужен)
// =========================
router.get("/challenges", async (req, res) => {
  try {
    const userId = req.session.userId || null;
    const lang = req.query.lang === "en" ? "en" : "ru";
    const challenges = await getApprovedChallenges();
    const pendingDemoIds = new Set(userId ? await getUserPendingDemoChallengeIds(userId) : []);
    res.json(challenges.map((c) => serializeChallenge(c, userId, lang, pendingDemoIds)));
  } catch (e) {
    console.error("Ошибка загрузки челленджей:", e);
    res.status(500).json({ error: "Не удалось загрузить челленджи" });
  }
});

// =========================
// Мои челленджи (в любом статусе модерации) — для профиля
// =========================
router.get("/challenges/mine", requireAuth, async (req, res) => {
  try {
    const lang = req.query.lang === "en" ? "en" : "ru";
    const mine = await getChallengesByAuthorId(req.session.userId);
    const pendingDemoIds = new Set(await getUserPendingDemoChallengeIds(req.session.userId));
    res.json(mine.map((c) => serializeOwnChallenge(c, req.session.userId, lang, pendingDemoIds)));
  } catch (e) {
    console.error("Ошибка загрузки своих челленджей:", e);
    res.status(500).json({ error: "Не удалось загрузить ваши челленджи" });
  }
});

// =========================
// Публичный профиль другого игрока
// =========================
router.get("/users/:username", async (req, res) => {
  try {
    const user = await getUserPublicByUsername(req.params.username);
    if (!user) {
      return res.status(404).json({ error: "Пользователь не найден" });
    }

    const userId = req.session.userId || null;
    const lang = req.query.lang === "en" ? "en" : "ru";
    const challenges = await getApprovedChallengesByUsername(user.username);
    const serialized = challenges.map((c) => serializeChallenge(c, userId, lang));
    const totalLikes = serialized.reduce((sum, c) => sum + c.likes, 0);

    res.json({
      username: user.username,
      avatar: user.avatar || "",
      steamUrl: user.steam_url || "",
      isOwner: user.username === OWNER_USERNAME,
      createdAt: user.created_at,
      stats: {
        created: serialized.length,
        likes: totalLikes
      },
      challenges: serialized
    });
  } catch (e) {
    console.error("Ошибка загрузки профиля пользователя:", e);
    res.status(500).json({ error: "Не удалось загрузить профиль" });
  }
});

// Общая валидация полей — используется и при публикации, и при
// редактировании, чтобы не дублировать одни и те же проверки.
function validateChallengeFields({ title, desc, titleEn, descEn, iconImage, color }) {
  if (typeof title !== "string" || title.trim().length === 0) {
    return "Название обязательно";
  }
  if (typeof color === "string" && color && !/^#[0-9a-fA-F]{6}$/.test(color)) {
    return "Некорректный цвет";
  }
  // Картинка-аватарка челленджа передаётся как data URL (base64).
  // Ограничиваем размер, чтобы не раздувать базу данных.
  if (typeof iconImage === "string" && iconImage.length > 1_500_000) {
    return "Картинка слишком большая";
  }
  if (typeof iconImage === "string" && iconImage && !iconImage.startsWith("data:image/")) {
    return "Некорректный формат картинки";
  }
  return null;
}

// =========================
// Публикация нового челленджа (уходит на модерацию)
// =========================
router.post("/challenges", requireAuth, publishLimiter, async (req, res) => {
  const { icon, iconImage, title, desc, titleEn, descEn, color } = req.body || {};

  const validationError = validateChallengeFields({ title, desc, titleEn, descEn, iconImage, color });
  if (validationError) {
    return res.status(400).json({ error: validationError });
  }

  try {
    const challenge = await createChallenge(req.session.userId, req.session.username, {
      icon,
      iconImage: typeof iconImage === "string" && iconImage ? iconImage : null,
      title: title.trim(),
      desc: typeof desc === "string" ? desc.trim() : "",
      titleEn: typeof titleEn === "string" && titleEn.trim() ? titleEn.trim() : null,
      descEn: typeof descEn === "string" && descEn.trim() ? descEn.trim() : null,
      color: typeof color === "string" && color ? color : null
    });

    notifyDiscord(
      `📝 Новый челлендж на модерации: «${challenge.title}» от ${req.session.username}`
    );

    // Челлендж ещё не виден в общей ленте — только после одобрения владельцем.
    res.status(201).json({
      ...serializeChallenge(challenge, req.session.userId, "ru"),
      pending: true
    });
  } catch (e) {
    console.error("Ошибка публикации челленджа:", e);
    res.status(500).json({ error: "Не удалось опубликовать челлендж" });
  }
});

// =========================
// Редактирование своего челленджа (уходит обратно на модерацию)
// =========================
router.put("/challenges/:id", requireAuth, publishLimiter, async (req, res) => {
  const id = Number(req.params.id);
  const { icon, iconImage, title, desc, titleEn, descEn, color } = req.body || {};

  const validationError = validateChallengeFields({ title, desc, titleEn, descEn, iconImage, color });
  if (validationError) {
    return res.status(400).json({ error: validationError });
  }

  try {
    const existing = await getChallengeById(id);
    if (!existing || existing.authorId !== req.session.userId) {
      return res.status(404).json({ error: "Челлендж не найден" });
    }

    const challenge = await updateChallenge(id, req.session.userId, {
      icon,
      iconImage: typeof iconImage === "string" && iconImage ? iconImage : null,
      title: title.trim(),
      desc: typeof desc === "string" ? desc.trim() : "",
      titleEn: typeof titleEn === "string" && titleEn.trim() ? titleEn.trim() : null,
      descEn: typeof descEn === "string" && descEn.trim() ? descEn.trim() : null,
      color: typeof color === "string" && color ? color : null
    });

    if (!challenge) {
      return res.status(404).json({ error: "Челлендж не найден" });
    }

    notifyDiscord(
      `✏️ Челлендж отредактирован и снова ждёт проверки: «${challenge.title}» от ${req.session.username}`
    );

    res.json({
      ...serializeOwnChallenge(challenge, req.session.userId, "ru"),
      pending: true
    });
  } catch (e) {
    console.error("Ошибка редактирования челленджа:", e);
    res.status(500).json({ error: "Не удалось сохранить изменения" });
  }
});

// =========================
// Лайк
// =========================
router.post("/challenges/:id/like", requireAuth, async (req, res) => {
  const id = Number(req.params.id);

  try {
    const result = await likeChallenge(id, req.session.userId);

    if (!result) {
      return res.status(404).json({ error: "Челлендж не найден" });
    }

    const { challenge, isNewLike } = result;

    // Уведомляем автора о новом лайке — и отдельным, особым сообщением,
    // если лайк поставил сам владелец сайта.
    if (isNewLike && challenge.authorId !== req.session.userId) {
      const likerIsOwner = req.session.username === OWNER_USERNAME;
      const message = likerIsOwner
        ? `👑 Сам владелец сайта оценил ваш челлендж «${challenge.title}»!`
        : `❤️ Пользователь ${req.session.username} оценил ваш челлендж «${challenge.title}»`;

      await createNotification(
        challenge.authorId,
        likerIsOwner ? "owner_like" : "like",
        message,
        challenge.id
      );
    }

    res.json(serializeChallenge(challenge, req.session.userId, "ru"));
  } catch (e) {
    console.error("Ошибка лайка:", e);
    res.status(500).json({ error: "Не удалось поставить лайк" });
  }
});

// =========================
// Отметить выполненным / снять отметку
// =========================
// ВАЖНО: этот роут разрешает только СНЯТЬ уже одобренную отметку
// (отменить своё выполнение). Поставить отметку впервые можно только
// через markChallengeCompletedForUser — а её вызывает исключительно
// владелец сайта после одобрения демки/видео (routes/admin.js).
// Раньше здесь был простой toggle без этой проверки — это позволяло
// засчитать себе любой челлендж выполненным одним запросом к API,
// без всякой демки. Дыру закрыли.
router.post("/challenges/:id/done", requireAuth, async (req, res) => {
  const id = Number(req.params.id);

  try {
    const challenge = await getChallengeById(id);

    if (!challenge) {
      return res.status(404).json({ error: "Челлендж не найден" });
    }

    if (!challenge.completedBy.includes(req.session.userId)) {
      return res.status(400).json({
        error: "Выполнение подтверждается через демку или видео — используйте кнопку «Выполнить»"
      });
    }

    const updated = await toggleChallengeDone(id, req.session.userId);
    res.json(serializeChallenge(updated, req.session.userId, "ru"));
  } catch (e) {
    console.error("Ошибка отметки выполнения:", e);
    res.status(500).json({ error: "Не удалось обновить статус" });
  }
});

module.exports = router;
