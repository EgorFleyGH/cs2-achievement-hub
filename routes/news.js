const express = require("express");
const { getAllNews } = require("../db");

const router = express.Router();

// Публично — новости видят все, логин не нужен.
// ?lang=en вернёт английскую версию (с откатом на русскую, если перевода нет).
router.get("/news", async (req, res) => {
  try {
    const lang = req.query.lang === "en" ? "en" : "ru";
    const news = await getAllNews();
    res.json(
      news.map((n) => ({
        id: n.id,
        title: lang === "en" && n.title_en ? n.title_en : n.title,
        body: lang === "en" && n.body_en ? n.body_en : n.body,
        translated: lang === "en" ? !!n.title_en : true,
        createdAt: n.created_at
      }))
    );
  } catch (e) {
    console.error("Ошибка загрузки новостей:", e);
    res.status(500).json({ error: "Не удалось загрузить новости" });
  }
});

module.exports = router;
