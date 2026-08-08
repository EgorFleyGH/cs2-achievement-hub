require("dotenv").config();

const path = require("path");
const express = require("express");
const session = require("express-session");
const cookieParser = require("cookie-parser");

const authRoutes = require("./routes/auth");
const challengeRoutes = require("./routes/challenges");
const newsRoutes = require("./routes/news");
const adminRoutes = require("./routes/admin");
const notificationRoutes = require("./routes/notifications");
const leaderboardRoutes = require("./routes/leaderboard");
const supportRoutes = require("./routes/support");
const demoRoutes = require("./routes/demos");
const { initDb } = require("./db");

const app = express();
const PORT = process.env.PORT || 3000;
const isProd = process.env.NODE_ENV === "production";

// Render (и почти любой PaaS) стоит за прокси — без этого secure-cookie
// не будет выставляться правильно за HTTPS-терминацией.
app.set("trust proxy", 1);

// Увеличенный лимит — аватарки и картинки-иконки челленджей
// приходят как base64 (data URL) прямо в теле JSON-запроса.
app.use(express.json({ limit: "2mb" }));
app.use(cookieParser());

app.use(
  session({
    name: "connect.sid",
    secret: process.env.SESSION_SECRET || "dev-secret-change-me",
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      secure: isProd, // https только в проде
      maxAge: 7 * 24 * 60 * 60 * 1000 // 7 дней
    }
  })
);

app.use("/api", authRoutes);
app.use("/api", challengeRoutes);
app.use("/api", newsRoutes);
app.use("/api", notificationRoutes);
app.use("/api", leaderboardRoutes);
app.use("/api", supportRoutes);
app.use("/api", demoRoutes);
app.use("/api/admin", adminRoutes);

// Отдаём фронтенд как статику
app.use(express.static(path.join(__dirname, "public")));

// Сначала создаём таблицы (если их ещё нет), и только потом
// начинаем принимать запросы — иначе первые же обращения к базе
// могут упасть с ошибкой "relation does not exist".
initDb()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`Сервер запущен: http://localhost:${PORT}`);
    });
  })
  .catch((err) => {
    console.error("Не удалось подключиться к базе данных:", err);
    process.exit(1);
  });
