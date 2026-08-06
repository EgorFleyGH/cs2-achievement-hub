const fs = require("fs");
const path = require("path");

// Данные пользователей хранятся в обычном JSON-файле рядом с проектом.
// Никакой компиляции не требует — работает на чистом Node.js из коробки.
const DATA_PATH = path.join(__dirname, "data.json");

function loadData() {
  if (!fs.existsSync(DATA_PATH)) {
    return { users: [], nextId: 1 };
  }
  try {
    const raw = fs.readFileSync(DATA_PATH, "utf-8");
    return JSON.parse(raw);
  } catch (e) {
    // Файл повреждён или пуст — начинаем с чистого состояния,
    // чтобы сервер не падал.
    return { users: [], nextId: 1 };
  }
}

function saveData(data) {
  fs.writeFileSync(DATA_PATH, JSON.stringify(data, null, 2), "utf-8");
}

function findUserByUsername(username) {
  const data = loadData();
  return data.users.find((u) => u.username === username) || null;
}

function createUser(username, passwordHash) {
  const data = loadData();

  const user = {
    id: data.nextId,
    username,
    password_hash: passwordHash,
    created_at: new Date().toISOString()
  };

  data.users.push(user);
  data.nextId += 1;

  saveData(data);

  return user;
}

module.exports = { findUserByUsername, createUser };
