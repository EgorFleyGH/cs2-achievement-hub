const express = require("express");
const { getLeaderboard } = require("../db");

const router = express.Router();

// Публично — таблица лидеров видна всем, логин не нужен.
router.get("/leaderboard", async (req, res) => {
  try {
    const board = await getLeaderboard();
    res.json(board);
  } catch (e) {
    console.error("Ошибка загрузки таблицы лидеров:", e);
    res.status(500).json({ error: "Не удалось загрузить таблицу лидеров" });
  }
});

module.exports = router;
