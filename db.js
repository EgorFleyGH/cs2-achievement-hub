const fs = require("fs");
const path = require("path");

// Все данные (пользователи + квесты) хранятся в одном JSON-файле рядом
// с проектом. Никакой компиляции не требует — работает на чистом
// Node.js из коробки.
const DATA_PATH = path.join(__dirname, "data.json");

function loadData() {
  if (!fs.existsSync(DATA_PATH)) {
    return { users: [], nextUserId: 1, challenges: [], nextChallengeId: 1 };
  }
  try {
    const raw = fs.readFileSync(DATA_PATH, "utf-8");
    const data = JSON.parse(raw);

    // На случай старого файла без раздела квестов — дополняем на лету,
    // чтобы не потерять уже существующих пользователей.
    if (!Array.isArray(data.challenges)) data.challenges = [];
    if (!data.nextChallengeId) data.nextChallengeId = 1;
    if (!data.nextUserId) data.nextUserId = data.nextId || 1;

    return data;
  } catch (e) {
    // Файл повреждён или пуст — начинаем с чистого состояния,
    // чтобы сервер не падал.
    return { users: [], nextUserId: 1, challenges: [], nextChallengeId: 1 };
  }
}

function saveData(data) {
  fs.writeFileSync(DATA_PATH, JSON.stringify(data, null, 2), "utf-8");
}

// =========================
// Пользователи
// =========================

function findUserByUsername(username) {
  const data = loadData();
  return data.users.find((u) => u.username === username) || null;
}

function createUser(username, passwordHash) {
  const data = loadData();

  const user = {
    id: data.nextUserId,
    username,
    password_hash: passwordHash,
    created_at: new Date().toISOString()
  };

  data.users.push(user);
  data.nextUserId += 1;

  saveData(data);

  return user;
}

// =========================
// Квесты (общие для всех)
// =========================

function getAllChallenges() {
  const data = loadData();
  // Новые — сверху
  return [...data.challenges].sort((a, b) => b.id - a.id);
}

function createChallenge(authorId, authorUsername, { icon, title, desc, rarity }) {
  const data = loadData();

  const challenge = {
    id: data.nextChallengeId,
    authorId,
    authorUsername,
    icon: icon || "❓",
    title: title || "Без названия",
    desc: desc || "Нет описания",
    rarity: rarity === "rarity-gold" ? "rarity-gold" : "rarity-common",
    likedBy: [],
    completedBy: [],
    createdAt: new Date().toISOString()
  };

  data.challenges.push(challenge);
  data.nextChallengeId += 1;

  saveData(data);

  return challenge;
}

function likeChallenge(challengeId, userId) {
  const data = loadData();
  const challenge = data.challenges.find((c) => c.id === challengeId);

  if (!challenge) return null;

  // Лайк можно поставить только один раз на аккаунт, снять нельзя —
  // как и было в локальной версии.
  if (!challenge.likedBy.includes(userId)) {
    challenge.likedBy.push(userId);
    saveData(data);
  }

  return challenge;
}

function toggleChallengeDone(challengeId, userId) {
  const data = loadData();
  const challenge = data.challenges.find((c) => c.id === challengeId);

  if (!challenge) return null;

  const idx = challenge.completedBy.indexOf(userId);

  if (idx === -1) {
    challenge.completedBy.push(userId);
  } else {
    challenge.completedBy.splice(idx, 1);
  }

  saveData(data);

  return challenge;
}

module.exports = {
  findUserByUsername,
  createUser,
  getAllChallenges,
  createChallenge,
  likeChallenge,
  toggleChallengeDone
};
