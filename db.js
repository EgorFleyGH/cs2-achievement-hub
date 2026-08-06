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
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  console.log("База данных готова (таблицы users, challenges)");
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
    completedBy: r.completed_by || []
  };
}

async function getAllChallenges() {
  const { rows } = await pool.query(
    "SELECT * FROM challenges ORDER BY id DESC"
  );
  return rows.map(mapChallenge);
}

async function createChallenge(authorId, authorUsername, { icon, title, desc, rarity }) {
  const { rows } = await pool.query(
    `INSERT INTO challenges
      (author_id, author_username, icon, title, description, rarity, liked_by, completed_by)
     VALUES ($1, $2, $3, $4, $5, $6, '[]'::jsonb, '[]'::jsonb)
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

module.exports = {
  initDb,
  findUserByUsername,
  createUser,
  getAllChallenges,
  createChallenge,
  likeChallenge,
  toggleChallengeDone
};
