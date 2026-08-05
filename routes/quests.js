const express = require("express");
const router = express.Router();
const db = require("../db");

// Получить все квесты
router.get("/", (req, res) => {
    const data = db.readData();

    if (!data.quests) data.quests = [];

    res.json(data.quests);
});

// Создать квест
router.post("/", (req, res) => {

    if (!req.session.user) {
        return res.status(401).json({ error: "Не авторизован" });
    }

    const data = db.readData();

    if (!data.quests)
        data.quests = [];

    const quest = {
        id: Date.now(),
        title: req.body.title,
        desc: req.body.desc,
        icon: req.body.icon,
        rarity: req.body.rarity,
        likes: 0,
        author: req.session.user.username,
        created: new Date().toISOString()
    };

    data.quests.unshift(quest);

    db.writeData(data);

    res.json(quest);
});

module.exports = router;