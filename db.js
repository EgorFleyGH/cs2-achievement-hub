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
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS challenges (
      id SERIAL PRIMARY KEY,
      author_id INTEGER NOT NULL REFERENCES users(id),
      author_username TEXT NOT NULL,
      icon TEXT,
      title TEXT NOT NULL,
      description TEXT,
      rarity TEXT,
      liked_by JSONB NOT NULL DEFAULT '[]'::jsonb,
      completed_by JSONB NOT NULL DEFAULT '[]'::jsonb,
      status TEXT NOT NULL DEFAULT 'approved',
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

  // На случай, если таблица news уже существовала без английских полей.
  await pool.query(`ALTER TABLE news ADD COLUMN IF NOT EXISTS title_en TEXT`);
  await pool.query(`ALTER TABLE news ADD COLUMN IF NOT EXISTS body_en TEXT`);

  // На случай, если таблицы уже существовали до этого обновления —
  // добавляем недостающие колонки, не трогая существующие данные.
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS banned BOOLEAN NOT NULL DEFAULT false`);
  await pool.query(`ALTER TABLE challenges ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'approved'`);

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

  console.log("База данных готова (таблицы users, challenges, news)");
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

// =========================
// Квесты (общие для всех)
// =========================

function mapChallenge(r) {
  return {
    id: r.id,
    authorId: r.author_id,
    authorUsername: r.author_username,
    icon: r.icon,
    title: r.title,
    desc: r.description,
    rarity: r.rarity,
    likedBy: r.liked_by || [],
    completedBy: r.completed_by || [],
    status: r.status
  };
}

async function getApprovedChallenges() {
  const { rows } = await pool.query(
    "SELECT * FROM challenges WHERE status = 'approved' ORDER BY id DESC"
  );
  return rows.map(mapChallenge);
}

async function getPendingChallenges() {
  const { rows } = await pool.query(
    "SELECT * FROM challenges WHERE status = 'pending' ORDER BY id ASC"
  );
  return rows.map(mapChallenge);
}

async function createChallenge(authorId, authorUsername, { icon, title, desc, rarity }) {
  const { rows } = await pool.query(
    `INSERT INTO challenges
      (author_id, author_username, icon, title, description, rarity, liked_by, completed_by, status)
     VALUES ($1, $2, $3, $4, $5, $6, '[]'::jsonb, '[]'::jsonb, 'pending')
     RETURNING *`,
    [
      authorId,
      authorUsername,
      icon || "❓",
      title || "Без названия",
      desc || "",
      rarity === "rarity-gold" ? "rarity-gold" : "rarity-common"
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
    return mapChallenge(updated.rows[0]);
  }

  return mapChallenge(rows[0]);
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

async function setChallengeStatus(challengeId, status) {
  const { rows } = await pool.query(
    "UPDATE challenges SET status = $1 WHERE id = $2 RETURNING *",
    [status, challengeId]
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

module.exports = {
  initDb,
  findUserByUsername,
  createUser,
  getAllUsers,
  setUserBanned,
  getApprovedChallenges,
  getPendingChallenges,
  createChallenge,
  likeChallenge,
  toggleChallengeDone,
  setChallengeStatus,
  deleteChallenge,
  getStats,
  getAllNews,
  createNews,
  updateNews,
  deleteNews
};
