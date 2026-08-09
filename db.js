const { Pool } = require("pg");

// Все данные теперь хранятся в настоящей PostgreSQL-базе (Supabase),
// а не на диске сервера — поэтому они переживают любой передеплой.
//
// DATABASE_URL берётся из переменной окружения — никогда не хранится
// в коде и не попадает в Git.
if (!process.env.DATABASE_URL) {
  console.error(
    "ОШИБКА: не задана переменная окружения DATABASE_URL. " +
    "Добавь её в .env (локально) или в Render → Environment."
  );
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false } // Supabase требует SSL
});

// =========================
// Инициализация таблиц (выполняется один раз при старте сервера)
// =========================

async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      banned BOOLEAN NOT NULL DEFAULT false,
      avatar TEXT,
      steam_url TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS challenges (
      id SERIAL PRIMARY KEY,
      author_id INTEGER NOT NULL REFERENCES users(id),
      author_username TEXT NOT NULL,
      icon TEXT,
      icon_image TEXT,
      title TEXT NOT NULL,
      description TEXT,
      title_en TEXT,
      description_en TEXT,
      rarity TEXT,
      color TEXT,
      liked_by JSONB NOT NULL DEFAULT '[]'::jsonb,
      completed_by JSONB NOT NULL DEFAULT '[]'::jsonb,
      status TEXT NOT NULL DEFAULT 'approved',
      reject_reason TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS notifications (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id),
      type TEXT NOT NULL,
      message TEXT NOT NULL,
      challenge_id INTEGER,
      read BOOLEAN NOT NULL DEFAULT false,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS demo_submissions (
      id SERIAL PRIMARY KEY,
      challenge_id INTEGER NOT NULL REFERENCES challenges(id),
      user_id INTEGER NOT NULL REFERENCES users(id),
      username TEXT NOT NULL,
      filename TEXT NOT NULL,
      file_size INTEGER NOT NULL,
      kind TEXT NOT NULL DEFAULT 'dem',
      status TEXT NOT NULL DEFAULT 'pending',
      reject_reason TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS news (
      id SERIAL PRIMARY KEY,
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      title_en TEXT,
      body_en TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS support_messages (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id),
      from_owner BOOLEAN NOT NULL DEFAULT false,
      message TEXT NOT NULL,
      read BOOLEAN NOT NULL DEFAULT false,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  // На случай, если таблица news уже существовала без английских полей.
  await pool.query(`ALTER TABLE news ADD COLUMN IF NOT EXISTS title_en TEXT`);
  await pool.query(`ALTER TABLE news ADD COLUMN IF NOT EXISTS body_en TEXT`);

  // На случай, если таблицы уже существовали до этого обновления —
  // добавляем недостающие колонки, не трогая существующие данные.
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS banned BOOLEAN NOT NULL DEFAULT false`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar TEXT`);
  await pool.query(`ALTER TABLE challenges ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'approved'`);
  await pool.query(`ALTER TABLE challenges ADD COLUMN IF NOT EXISTS icon_image TEXT`);
  await pool.query(`ALTER TABLE challenges ADD COLUMN IF NOT EXISTS color TEXT`);
  await pool.query(`ALTER TABLE challenges ADD COLUMN IF NOT EXISTS reject_reason TEXT`);
  await pool.query(`ALTER TABLE challenges ADD COLUMN IF NOT EXISTS title_en TEXT`);
  await pool.query(`ALTER TABLE challenges ADD COLUMN IF NOT EXISTS description_en TEXT`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS steam_url TEXT`);
  await pool.query(`ALTER TABLE demo_submissions ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'dem'`);

  // Наполняем новости стартовым содержимым один раз, если пусто —
  // дальше владелец сайта полностью управляет ими через админ-панель.
  const { rows } = await pool.query("SELECT COUNT(*)::int AS count FROM news");
  if (rows[0].count === 0) {
    await pool.query(
      `INSERT INTO news (title, body, title_en, body_en) VALUES
        ($1, $2, $3, $4),
        ($5, $6, $7, $8),
        ($9, $10, $11, $12)`,
      [
        "🚀 Открытый бета-тест!",
        "Сайт запущен в открытом бета-тестировании. Часть функций может работать нестабильно — если найдёте баг или есть идея, пишите через раздел «Поддержка».",
        "🚀 Open Beta!",
        "The site is now in open beta. Some features may be unstable — if you find a bug or have an idea, please reach out via the Support section.",

        "Интерактивная лента",
        "Создавайте испытания для матчей CS2, публикуйте их и оценивайте работы других игроков.",
        "Interactive feed",
        "Create challenges for your CS2 matches, publish them, and rate other players' work.",

        "Система отметок",
        "Выполняйте задания в игре и отмечайте их кнопкой «Выполнено».",
        "Completion tracking",
        "Complete tasks in-game and mark them done with the \"Completed\" button."
      ]
    );
  }

  console.log("База данных готова (таблицы users, challenges, news, notifications)");
}

// =========================
// Пользователи
// =========================

async function findUserByUsername(username) {
  const { rows } = await pool.query(
    "SELECT * FROM users WHERE username = $1",
    [username]
  );
  return rows[0] || null;
}

async function createUser(username, passwordHash) {
  const { rows } = await pool.query(
    "INSERT INTO users (username, password_hash) VALUES ($1, $2) RETURNING *",
    [username, passwordHash]
  );
  return rows[0];
}

async function getAllUsers() {
  const { rows } = await pool.query(
    "SELECT id, username, banned, created_at FROM users ORDER BY id ASC"
  );
  return rows;
}

async function setUserBanned(userId, banned) {
  const { rows } = await pool.query(
    "UPDATE users SET banned = $1 WHERE id = $2 RETURNING id, username, banned",
    [banned, userId]
  );
  return rows[0] || null;
}

// Сброс пароля администратором (при потере доступа игроком — у сайта
// нет почты для самостоятельного сброса). Возвращаем только id/username,
// сам новый пароль наружу не передаём — его хеш уже сохранён здесь же.
async function resetUserPassword(userId, passwordHash) {
  const { rows } = await pool.query(
    "UPDATE users SET password_hash = $1 WHERE id = $2 RETURNING id, username",
    [passwordHash, userId]
  );
  return rows[0] || null;
}

async function setUserAvatar(userId, avatar) {
  const { rows } = await pool.query(
    "UPDATE users SET avatar = $1 WHERE id = $2 RETURNING id, username, avatar",
    [avatar, userId]
  );
  return rows[0] || null;
}

async function setUserSteamUrl(userId, steamUrl) {
  const { rows } = await pool.query(
    "UPDATE users SET steam_url = $1 WHERE id = $2 RETURNING id, username, steam_url",
    [steamUrl, userId]
  );
  return rows[0] || null;
}

// Публичный профиль — по нику. Отдаём только то, что не приватно:
// без пароля, без статуса бана (это внутренняя информация).
async function getUserPublicByUsername(username) {
  const { rows } = await pool.query(
    "SELECT id, username, avatar, steam_url, created_at FROM users WHERE username = $1",
    [username]
  );
  return rows[0] || null;
}

// =========================
// Квесты (общие для всех)
// =========================

function mapChallenge(r) {
  return {
    id: r.id,
    authorId: r.author_id,
    authorUsername: r.author_username,
    icon: r.icon,
    iconImage: r.icon_image,
    title: r.title,
    desc: r.description,
    titleEn: r.title_en,
    descEn: r.description_en,
    rarity: r.rarity,
    color: r.color,
    likedBy: r.liked_by || [],
    completedBy: r.completed_by || [],
    status: r.status,
    rejectReason: r.reject_reason
  };
}

async function getApprovedChallenges() {
  const { rows } = await pool.query(
    "SELECT * FROM challenges WHERE status = 'approved' ORDER BY id DESC"
  );
  return rows.map(mapChallenge);
}

async function getApprovedChallengesByUsername(username) {
  const { rows } = await pool.query(
    "SELECT * FROM challenges WHERE status = 'approved' AND author_username = $1 ORDER BY id DESC",
    [username]
  );
  return rows.map(mapChallenge);
}

// Все челленджи пользователя (в любом статусе) — для раздела
// "Мои челленджи" в профиле, чтобы автор видел и то, что на
// модерации или отклонено (с причиной).
async function getChallengesByAuthorId(authorId) {
  const { rows } = await pool.query(
    "SELECT * FROM challenges WHERE author_id = $1 ORDER BY id DESC",
    [authorId]
  );
  return rows.map(mapChallenge);
}

async function getPendingChallenges() {
  const { rows } = await pool.query(
    "SELECT * FROM challenges WHERE status = 'pending' ORDER BY id ASC"
  );
  return rows.map(mapChallenge);
}

async function getChallengeById(id) {
  const { rows } = await pool.query("SELECT * FROM challenges WHERE id = $1", [id]);
  return rows[0] ? mapChallenge(rows[0]) : null;
}

// Редактирование своего челленджа автором. Любое изменение отправляет
// челлендж обратно на модерацию (status='pending', причина прошлого
// отклонения очищается) — даже если он уже был одобрен. Иначе автор
// мог бы незаметно подменить одобренный текст на что угодно.
// WHERE author_id = $... прямо в запросе — так что чужой челлендж
// отредактировать этой функцией невозможно даже при ошибке на уровне роута.
async function updateChallenge(challengeId, authorId, { icon, iconImage, title, desc, titleEn, descEn, color }) {
  const { rows } = await pool.query(
    `UPDATE challenges SET
       icon = $1,
       icon_image = $2,
       title = $3,
       description = $4,
       title_en = $5,
       description_en = $6,
       color = $7,
       status = 'pending',
       reject_reason = NULL
     WHERE id = $8 AND author_id = $9
     RETURNING *`,
    [
      icon || "❓",
      iconImage || null,
      title || "Без названия",
      desc || "",
      titleEn || null,
      descEn || null,
      typeof color === "string" && color ? color : null,
      challengeId,
      authorId
    ]
  );
  return rows[0] ? mapChallenge(rows[0]) : null;
}

async function createChallenge(authorId, authorUsername, { icon, iconImage, title, desc, titleEn, descEn, color }) {
  const { rows } = await pool.query(
    `INSERT INTO challenges
      (author_id, author_username, icon, icon_image, title, description, title_en, description_en, color, liked_by, completed_by, status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, '[]'::jsonb, '[]'::jsonb, 'pending')
     RETURNING *`,
    [
      authorId,
      authorUsername,
      icon || "❓",
      iconImage || null,
      title || "Без названия",
      desc || "",
      titleEn || null,
      descEn || null,
      typeof color === "string" && color ? color : null
    ]
  );
  return mapChallenge(rows[0]);
}

async function likeChallenge(challengeId, userId) {
  const { rows } = await pool.query(
    "SELECT * FROM challenges WHERE id = $1",
    [challengeId]
  );
  if (!rows[0]) return null;

  const likedBy = rows[0].liked_by || [];

  // Лайк можно поставить только один раз на аккаунт, снять нельзя.
  if (!likedBy.includes(userId)) {
    likedBy.push(userId);

    const updated = await pool.query(
      "UPDATE challenges SET liked_by = $1 WHERE id = $2 RETURNING *",
      [JSON.stringify(likedBy), challengeId]
    );
    return { challenge: mapChallenge(updated.rows[0]), isNewLike: true };
  }

  return { challenge: mapChallenge(rows[0]), isNewLike: false };
}

async function toggleChallengeDone(challengeId, userId) {
  const { rows } = await pool.query(
    "SELECT * FROM challenges WHERE id = $1",
    [challengeId]
  );
  if (!rows[0]) return null;

  const completedBy = rows[0].completed_by || [];
  const idx = completedBy.indexOf(userId);

  if (idx === -1) {
    completedBy.push(userId);
  } else {
    completedBy.splice(idx, 1);
  }

  const updated = await pool.query(
    "UPDATE challenges SET completed_by = $1 WHERE id = $2 RETURNING *",
    [JSON.stringify(completedBy), challengeId]
  );

  return mapChallenge(updated.rows[0]);
}

// В отличие от toggleChallengeDone (переключатель), эта функция
// только ДОБАВЛЯЕТ пользователя в список выполнивших — используется
// после того, как владелец сайта одобрил присланную демку.
async function markChallengeCompletedForUser(challengeId, userId) {
  const { rows } = await pool.query(
    "SELECT * FROM challenges WHERE id = $1",
    [challengeId]
  );
  if (!rows[0]) return null;

  const completedBy = rows[0].completed_by || [];
  if (!completedBy.includes(userId)) {
    completedBy.push(userId);
  }

  const updated = await pool.query(
    "UPDATE challenges SET completed_by = $1 WHERE id = $2 RETURNING *",
    [JSON.stringify(completedBy), challengeId]
  );

  return mapChallenge(updated.rows[0]);
}

// =========================
// Проверка демок (.dem) и видео (.mp4) для подтверждения выполнения челленджа
// =========================

async function createDemoSubmission(challengeId, userId, username, filename, fileSize, kind) {
  const { rows } = await pool.query(
    `INSERT INTO demo_submissions (challenge_id, user_id, username, filename, file_size, kind)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
    [challengeId, userId, username, filename, fileSize, kind === "video" ? "video" : "dem"]
  );
  return rows[0];
}

// Есть ли у пользователя уже отправленная (на проверке) демка по
// этому челленджу — чтобы не давать засылать дубли, пока не разобрали.
async function getPendingSubmissionForUserChallenge(challengeId, userId) {
  const { rows } = await pool.query(
    "SELECT * FROM demo_submissions WHERE challenge_id = $1 AND user_id = $2 AND status = 'pending' LIMIT 1",
    [challengeId, userId]
  );
  return rows[0] || null;
}

// Список ID челленджей, по которым у пользователя сейчас демка на проверке —
// нужно фронтенду, чтобы показать "⏳ На проверке" вместо кнопки "Выполнить".
async function getUserPendingDemoChallengeIds(userId) {
  const { rows } = await pool.query(
    "SELECT challenge_id FROM demo_submissions WHERE user_id = $1 AND status = 'pending'",
    [userId]
  );
  return rows.map((r) => r.challenge_id);
}

async function getPendingDemoSubmissions() {
  const { rows } = await pool.query(`
    SELECT ds.*, c.title AS challenge_title, c.title_en AS challenge_title_en
    FROM demo_submissions ds
    JOIN challenges c ON c.id = ds.challenge_id
    WHERE ds.status = 'pending'
    ORDER BY ds.id ASC
  `);
  return rows;
}

async function getDemoSubmissionById(id) {
  const { rows } = await pool.query(
    "SELECT * FROM demo_submissions WHERE id = $1",
    [id]
  );
  return rows[0] || null;
}

async function setDemoSubmissionStatus(id, status, rejectReason) {
  const { rows } = await pool.query(
    "UPDATE demo_submissions SET status = $1, reject_reason = $2 WHERE id = $3 RETURNING *",
    [status, status === "rejected" ? (rejectReason || null) : null, id]
  );
  return rows[0] || null;
}

async function setChallengeStatus(challengeId, status, rejectReason) {
  const { rows } = await pool.query(
    "UPDATE challenges SET status = $1, reject_reason = $2 WHERE id = $3 RETURNING *",
    [status, status === "rejected" ? (rejectReason || null) : null, challengeId]
  );
  return rows[0] ? mapChallenge(rows[0]) : null;
}

async function deleteChallenge(challengeId) {
  const { rows } = await pool.query(
    "DELETE FROM challenges WHERE id = $1 RETURNING id",
    [challengeId]
  );
  return rows.length > 0;
}

// =========================
// Статистика сайта
// =========================

async function getStats() {
  const usersResult = await pool.query("SELECT COUNT(*)::int AS count FROM users");
  const challengesResult = await pool.query(
    "SELECT COUNT(*)::int AS count FROM challenges WHERE status = 'approved'"
  );
  const pendingResult = await pool.query(
    "SELECT COUNT(*)::int AS count FROM challenges WHERE status = 'pending'"
  );
  const likesResult = await pool.query(
    `SELECT COALESCE(SUM(jsonb_array_length(liked_by)), 0)::int AS total
     FROM challenges WHERE status = 'approved'`
  );

  return {
    users: usersResult.rows[0].count,
    challenges: challengesResult.rows[0].count,
    pendingChallenges: pendingResult.rows[0].count,
    totalLikes: likesResult.rows[0].total
  };
}

// =========================
// Новости
// =========================

async function getAllNews() {
  const { rows } = await pool.query(
    "SELECT * FROM news ORDER BY id DESC"
  );
  return rows;
}

async function createNews(title, body, titleEn, bodyEn) {
  const { rows } = await pool.query(
    "INSERT INTO news (title, body, title_en, body_en) VALUES ($1, $2, $3, $4) RETURNING *",
    [title, body, titleEn || null, bodyEn || null]
  );
  return rows[0];
}

async function updateNews(id, title, body, titleEn, bodyEn) {
  const { rows } = await pool.query(
    "UPDATE news SET title = $1, body = $2, title_en = $3, body_en = $4 WHERE id = $5 RETURNING *",
    [title, body, titleEn || null, bodyEn || null, id]
  );
  return rows[0] || null;
}

async function deleteNews(id) {
  const { rows } = await pool.query(
    "DELETE FROM news WHERE id = $1 RETURNING id",
    [id]
  );
  return rows.length > 0;
}

// =========================
// Уведомления
// =========================

async function createNotification(userId, type, message, challengeId) {
  const { rows } = await pool.query(
    `INSERT INTO notifications (user_id, type, message, challenge_id)
     VALUES ($1, $2, $3, $4) RETURNING *`,
    [userId, type, message, challengeId || null]
  );
  return rows[0];
}

async function getNotifications(userId) {
  const { rows } = await pool.query(
    "SELECT * FROM notifications WHERE user_id = $1 ORDER BY id DESC LIMIT 50",
    [userId]
  );
  return rows;
}

async function getUnreadNotificationCount(userId) {
  const { rows } = await pool.query(
    "SELECT COUNT(*)::int AS count FROM notifications WHERE user_id = $1 AND read = false",
    [userId]
  );
  return rows[0].count;
}

async function markAllNotificationsRead(userId) {
  await pool.query(
    "UPDATE notifications SET read = true WHERE user_id = $1 AND read = false",
    [userId]
  );
}

// =========================
// Таблица лидеров
// =========================

async function getLeaderboard() {
  const topCreators = await pool.query(`
    SELECT author_username AS username, COUNT(*)::int AS count
    FROM challenges
    WHERE status = 'approved'
    GROUP BY author_username
    ORDER BY count DESC
    LIMIT 10
  `);

  const topLiked = await pool.query(`
    SELECT author_username AS username, COALESCE(SUM(jsonb_array_length(liked_by)), 0)::int AS count
    FROM challenges
    WHERE status = 'approved'
    GROUP BY author_username
    ORDER BY count DESC
    LIMIT 10
  `);

  // "Выполнил больше всего" — это про пользователя, который отмечал
  // чужие (и свои) челленджи выполненными, а не про автора.
  const topCompleted = await pool.query(`
    SELECT u.username AS username, COUNT(*)::int AS count
    FROM challenges c,
         LATERAL jsonb_array_elements_text(c.completed_by) AS uid
    JOIN users u ON u.id = uid::int
    WHERE c.status = 'approved'
    GROUP BY u.username
    ORDER BY count DESC
    LIMIT 10
  `);

  return {
    topCreators: topCreators.rows,
    topLiked: topLiked.rows,
    topCompleted: topCompleted.rows
  };
}

// =========================
// Поддержка (чат с владельцем сайта)
// =========================

async function createSupportMessage(userId, fromOwner, message) {
  const { rows } = await pool.query(
    `INSERT INTO support_messages (user_id, from_owner, message)
     VALUES ($1, $2, $3) RETURNING *`,
    [userId, fromOwner, message]
  );
  return rows[0];
}

async function getSupportThread(userId) {
  const { rows } = await pool.query(
    "SELECT * FROM support_messages WHERE user_id = $1 ORDER BY id ASC",
    [userId]
  );
  return rows;
}

// Список диалогов для админ-панели: по одному на пользователя,
// с последним сообщением и числом непрочитанных (владельцем) сообщений.
async function getSupportThreadsList() {
  const { rows } = await pool.query(`
    SELECT
      u.id AS user_id,
      u.username,
      u.avatar,
      (SELECT message FROM support_messages sm WHERE sm.user_id = u.id ORDER BY sm.id DESC LIMIT 1) AS last_message,
      (SELECT created_at FROM support_messages sm WHERE sm.user_id = u.id ORDER BY sm.id DESC LIMIT 1) AS last_at,
      (SELECT COUNT(*)::int FROM support_messages sm WHERE sm.user_id = u.id AND sm.from_owner = false AND sm.read = false) AS unread_count
    FROM users u
    WHERE EXISTS (SELECT 1 FROM support_messages sm WHERE sm.user_id = u.id)
    ORDER BY last_at DESC
  `);
  return rows;
}

// Отмечает прочитанными сообщения от игрока (когда их читает владелец)
// или от владельца (когда их читает сам игрок).
async function markSupportRead(userId, readerIsOwner) {
  await pool.query(
    "UPDATE support_messages SET read = true WHERE user_id = $1 AND from_owner = $2 AND read = false",
    [userId, !readerIsOwner]
  );
}

async function getSupportUnreadCountForUser(userId) {
  const { rows } = await pool.query(
    "SELECT COUNT(*)::int AS count FROM support_messages WHERE user_id = $1 AND from_owner = true AND read = false",
    [userId]
  );
  return rows[0].count;
}

module.exports = {
  initDb,
  findUserByUsername,
  createUser,
  getAllUsers,
  setUserBanned,
  resetUserPassword,
  setUserAvatar,
  setUserSteamUrl,
  getUserPublicByUsername,
  getApprovedChallenges,
  getApprovedChallengesByUsername,
  getChallengesByAuthorId,
  getPendingChallenges,
  getChallengeById,
  createChallenge,
  updateChallenge,
  likeChallenge,
  toggleChallengeDone,
  markChallengeCompletedForUser,
  setChallengeStatus,
  deleteChallenge,
  getStats,
  getAllNews,
  createNews,
  updateNews,
  deleteNews,
  createNotification,
  getNotifications,
  getUnreadNotificationCount,
  markAllNotificationsRead,
  getLeaderboard,
  createDemoSubmission,
  getPendingSubmissionForUserChallenge,
  getUserPendingDemoChallengeIds,
  getPendingDemoSubmissions,
  getDemoSubmissionById,
  setDemoSubmissionStatus,
  createSupportMessage,
  getSupportThread,
  getSupportThreadsList,
  markSupportRead,
  getSupportUnreadCountForUser

};
