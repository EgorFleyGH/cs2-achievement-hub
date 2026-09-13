const express = require("express");
const {
  findUserByUsername,
  createClan,
  getClanById,
  getClanByUserId,
  getClanMembers,
  findClanByName,
  inviteToClan,
  getUserClanInvites,
  getClanInvitesSent,
  acceptClanInvite,
  declineClanInvite,
  leaveClan,
  kickFromClan,
  deleteClan,
  getClanStats,
  getClanLeaderboard,
  createNotification
} = require("../db");

const router = express.Router();

function requireAuth(req, res, next) {
  if (!req.session.userId) {
    return res.status(401).json({ error: "Нужно войти в аккаунт" });
  }
  next();
}

router.get("/clans/mine", requireAuth, async (req, res) => {
  try {
    const clan = await getClanByUserId(req.session.userId);

    if (!clan) {
      return res.json({ clan: null });
    }

    const [members, stats] = await Promise.all([
      getClanMembers(clan.id),
      getClanStats(clan.id)
    ]);

    const isOwner = clan.owner_id === req.session.userId;
    const invitesSent = isOwner ? await getClanInvitesSent(clan.id) : [];

    res.json({
      clan: {
        id: clan.id,
        name: clan.name,
        tag: clan.tag,
        description: clan.description,
        ownerId: clan.owner_id,
        isOwner,
        members: members.map((m) => ({ id: m.id, username: m.username, avatar: m.avatar || "" })),
        stats,
        invitesSent: invitesSent.map((i) => ({ inviteId: i.invite_id, userId: i.user_id, username: i.username }))
      }
    });
  } catch (e) {
    console.error("Ошибка загрузки клана:", e);
    res.status(500).json({ error: "Не удалось загрузить клан" });
  }
});

router.get("/clans-leaderboard", async (req, res) => {
  try {
    const board = await getClanLeaderboard();
    res.json(board);
  } catch (e) {
    console.error("Ошибка загрузки лидеров кланов:", e);
    res.status(500).json({ error: "Не удалось загрузить лидеров" });
  }
});

router.get("/clans/:id", async (req, res) => {
  const id = Number(req.params.id);

  try {
    const clan = await getClanById(id);
    if (!clan) return res.status(404).json({ error: "Клан не найден" });

    const [members, stats] = await Promise.all([getClanMembers(id), getClanStats(id)]);

    res.json({
      id: clan.id,
      name: clan.name,
      tag: clan.tag,
      description: clan.description,
      members: members.map((m) => ({ id: m.id, username: m.username, avatar: m.avatar || "" })),
      stats
    });
  } catch (e) {
    console.error("Ошибка загрузки клана:", e);
    res.status(500).json({ error: "Не удалось загрузить клан" });
  }
});

router.post("/clans", requireAuth, async (req, res) => {
  const existing = await getClanByUserId(req.session.userId);
  if (existing) {
    return res.status(400).json({ error: "Ты уже состоишь в клане — сначала выйди из него" });
  }

  const { name, tag, description } = req.body || {};

  if (typeof name !== "string" || name.trim().length < 3) {
    return res.status(400).json({ error: "Название клана должно быть от 3 символов" });
  }
  if (name.length > 40) {
    return res.status(400).json({ error: "Название слишком длинное" });
  }
  if (typeof tag === "string" && tag.length > 6) {
    return res.status(400).json({ error: "Тег — максимум 6 символов" });
  }
  if (typeof description === "string" && description.length > 300) {
    return res.status(400).json({ error: "Описание слишком длинное" });
  }

  try {
    const dup = await findClanByName(name.trim());
    if (dup) return res.status(409).json({ error: "Клан с таким названием уже существует" });

    const clan = await createClan(
      req.session.userId,
      name.trim(),
      typeof tag === "string" ? tag.trim() : null,
      typeof description === "string" ? description.trim() : null
    );

    res.status(201).json({ id: clan.id, name: clan.name, tag: clan.tag });
  } catch (e) {
    console.error("Ошибка создания клана:", e);
    res.status(500).json({ error: "Не удалось создать клан" });
  }
});

router.post("/clans/:id/invite", requireAuth, async (req, res) => {
  const clanId = Number(req.params.id);
  const { username } = req.body || {};

  try {
    const clan = await getClanById(clanId);
    if (!clan) return res.status(404).json({ error: "Клан не найден" });
    if (clan.owner_id !== req.session.userId) {
      return res.status(403).json({ error: "Приглашать может только владелец клана" });
    }

    const target = await findUserByUsername(username);
    if (!target) return res.status(404).json({ error: "Пользователь не найден" });

    const targetClan = await getClanByUserId(target.id);
    if (targetClan) return res.status(400).json({ error: "Этот игрок уже состоит в клане" });

    const invite = await inviteToClan(clanId, target.id);
    if (!invite) return res.status(409).json({ error: "Приглашение уже отправлено" });

    await createNotification(
      target.id,
      "clan_invite",
      `Клан «${clan.name}» приглашает тебя вступить`,
      null
    );

    res.status(201).json({ ok: true });
  } catch (e) {
    console.error("Ошибка приглашения в клан:", e);
    res.status(500).json({ error: "Не удалось отправить приглашение" });
  }
});

router.get("/clan-invites", requireAuth, async (req, res) => {
  try {
    const invites = await getUserClanInvites(req.session.userId);
    res.json(invites.map((i) => ({ inviteId: i.invite_id, clanId: i.clan_id, name: i.name, tag: i.tag })));
  } catch (e) {
    console.error("Ошибка загрузки приглашений в кланы:", e);
    res.status(500).json({ error: "Не удалось загрузить приглашения" });
  }
});

router.post("/clan-invites/:id/accept", requireAuth, async (req, res) => {
  try {
    const existing = await getClanByUserId(req.session.userId);
    if (existing) return res.status(400).json({ error: "Ты уже состоишь в клане" });

    const clan = await acceptClanInvite(Number(req.params.id), req.session.userId);
    if (!clan) return res.status(404).json({ error: "Приглашение не найдено" });

    res.json({ ok: true, clanId: clan.id });
  } catch (e) {
    console.error("Ошибка принятия приглашения в клан:", e);
    res.status(500).json({ error: "Не удалось принять приглашение" });
  }
});

router.post("/clan-invites/:id/decline", requireAuth, async (req, res) => {
  try {
    const ok = await declineClanInvite(Number(req.params.id), req.session.userId);
    if (!ok) return res.status(404).json({ error: "Приглашение не найдено" });
    res.json({ ok: true });
  } catch (e) {
    console.error("Ошибка отклонения приглашения в клан:", e);
    res.status(500).json({ error: "Не удалось отклонить приглашение" });
  }
});

router.post("/clans/leave", requireAuth, async (req, res) => {
  try {
    const result = await leaveClan(req.session.userId);
    if (!result) return res.status(400).json({ error: "Ты не состоишь в клане" });
    res.json(result);
  } catch (e) {
    console.error("Ошибка выхода из клана:", e);
    res.status(500).json({ error: "Не удалось выйти из клана" });
  }
});

router.post("/clans/:id/kick", requireAuth, async (req, res) => {
  const clanId = Number(req.params.id);
  const { userId } = req.body || {};

  try {
    const ok = await kickFromClan(clanId, req.session.userId, Number(userId));
    if (!ok) return res.status(400).json({ error: "Не удалось исключить участника" });
    res.json({ ok: true });
  } catch (e) {
    console.error("Ошибка исключения из клана:", e);
    res.status(500).json({ error: "Не удалось исключить участника" });
  }
});

router.delete("/clans/:id", requireAuth, async (req, res) => {
  try {
    const ok = await deleteClan(Number(req.params.id), req.session.userId);
    if (!ok) return res.status(400).json({ error: "Не удалось расформировать клан" });
    res.json({ ok: true });
  } catch (e) {
    console.error("Ошибка расформирования клана:", e);
    res.status(500).json({ error: "Не удалось расформировать клан" });
  }
});

module.exports = router;
