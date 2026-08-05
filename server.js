require("dotenv").config();

const path = require("path");
const express = require("express");
const session = require("express-session");
const cookieParser = require("cookie-parser");

const authRoutes = require("./routes/auth");

const app = express();
const PORT = process.env.PORT || 3000;
const isProd = process.env.NODE_ENV === "production";

// Render (и почти любой PaaS) стоит за прокси — без этого secure-cookie
// не будет выставляться правильно за HTTPS-терминацией.
app.set("trust proxy", 1);

app.use(express.json());
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

// Отдаём фронтенд как статику
app.use(express.static(path.join(__dirname, "public")));

app.listen(PORT, () => {
  console.log(`Сервер запущен: http://localhost:${PORT}`);
});
