import express from "express";
import cookieParser from "cookie-parser";
import path from "node:path";
import { fileURLToPath } from "node:url";
import bcrypt from "bcryptjs";
import { clearSession, readSessionCookie, setSession } from "./auth.js";
import { cleanupDemoOnlyDatabase, db, getSetting, publicUser, setSetting } from "./db.js";
import { isValidDiscordWebhookUrl, postDiscordUpdate } from "./discord.js";
import { getSteamGameDetails, searchSteamGames } from "./steam.js";

if (process.env.SQUADSLOT_CLEAN_DEMO_DATA === "true") {
  cleanupDemoOnlyDatabase();
}

const app = express();
const port = Number(process.env.PORT || 8080);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.join(__dirname, "..", "dist");
const unsafeMethods = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const authAttempts = new Map();

if (process.env.TRUST_PROXY === "1" || process.env.TRUST_PROXY === "true") {
  app.set("trust proxy", 1);
}

app.use((_req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "same-origin");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  res.setHeader(
    "Content-Security-Policy",
    [
      "default-src 'self'",
      "base-uri 'self'",
      "frame-ancestors 'none'",
      "form-action 'self'",
      "script-src 'self'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: https://shared.akamai.steamstatic.com https://*.steamstatic.com",
      "connect-src 'self'"
    ].join("; ")
  );
  next();
});

app.use("/api", (req, res, next) => {
  const hasBody = req.get("content-length") || req.get("transfer-encoding");
  if (unsafeMethods.has(req.method) && hasBody && !req.is("application/json")) {
    return res.status(415).json({ error: "API requests must use application/json." });
  }
  next();
});

app.use(express.json({ limit: "2mb" }));
app.use(cookieParser());

function requestOrigin(req) {
  const protocol = req.get("x-forwarded-proto")?.split(",")[0]?.trim() || req.protocol;
  return `${protocol}://${req.get("host")}`;
}

function allowedOrigins(req) {
  return new Set([requestOrigin(req), process.env.APP_URL].filter(Boolean));
}

app.use("/api", (req, res, next) => {
  if (!unsafeMethods.has(req.method)) return next();

  const origin = req.get("origin");
  const referer = req.get("referer");
  let candidate = origin || "";
  if (!candidate && referer) {
    try {
      candidate = new URL(referer).origin;
    } catch {
      return res.status(403).json({ error: "Invalid request origin." });
    }
  }

  if (!candidate && process.env.NODE_ENV !== "production") return next();
  if (candidate && allowedOrigins(req).has(candidate)) return next();

  return res.status(403).json({ error: "Invalid request origin." });
});

app.use((req, _res, next) => {
  const userId = readSessionCookie(req);
  req.user = userId ? db.prepare("SELECT * FROM users WHERE id = ?").get(userId) : null;
  next();
});

function requireAuth(req, res, next) {
  if (!req.user) return res.status(401).json({ error: "You need to sign in first." });
  next();
}

function requireAdmin(req, res, next) {
  if (!req.user) return res.status(401).json({ error: "You need to sign in first." });
  if (req.user.role !== "admin") return res.status(403).json({ error: "Admin access required." });
  next();
}

function cleanText(value, fallback = "") {
  return String(value ?? fallback).trim();
}

function isDateString(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function isTimeString(value) {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

function isValidHttpUrl(value) {
  if (!value) return true;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function authRateLimit(req, res, next) {
  const key = req.ip || req.socket.remoteAddress || "unknown";
  const now = Date.now();
  const windowMs = 15 * 60 * 1000;
  const attempts = (authAttempts.get(key) || []).filter((timestamp) => now - timestamp < windowMs);

  if (attempts.length >= 25) {
    return res.status(429).json({ error: "Too many auth attempts. Try again later." });
  }

  attempts.push(now);
  authAttempts.set(key, attempts);
  next();
}

function isPositiveInteger(value) {
  return Number.isInteger(Number(value)) && Number(value) > 0;
}

function assertArray(value, name) {
  if (!Array.isArray(value)) throw new Error(`Backup ${name} must be an array.`);
  return value;
}

function backupTables() {
  return {
    users: db
      .prepare("SELECT id, username, display_name AS displayName, role, password_hash AS passwordHash, created_at AS createdAt FROM users ORDER BY id")
      .all(),
    availability: db
      .prepare("SELECT id, user_id AS userId, date, start_time AS startTime, end_time AS endTime, note, created_at AS createdAt FROM availability ORDER BY id")
      .all(),
    games: db
      .prepare("SELECT id, title, genre, max_players AS maxPlayers, suggested_by AS suggestedBy, created_at AS createdAt FROM games ORDER BY id")
      .all(),
    events: db
      .prepare(`
        SELECT id, owner_id AS ownerId, game_id AS gameId, steam_app_id AS steamAppId, game_title AS gameTitle,
               title, date, start_time AS startTime, end_time AS endTime, notes, created_at AS createdAt
        FROM events
        ORDER BY id
      `)
      .all(),
    eventInvites: db
      .prepare("SELECT event_id AS eventId, user_id AS userId, status FROM event_invites ORDER BY event_id, user_id")
      .all(),
    settings: db.prepare("SELECT key, value FROM app_settings ORDER BY key").all()
  };
}

function validateBackup(payload) {
  if (!payload || typeof payload !== "object") throw new Error("Backup must be a JSON object.");
  if (payload.app !== "SquadSlot") throw new Error("Backup is not a SquadSlot backup.");
  if (payload.version !== 1) throw new Error("Unsupported backup version.");

  const tables = payload.tables;
  if (!tables || typeof tables !== "object") throw new Error("Backup is missing tables.");

  const users = assertArray(tables.users, "users");
  assertArray(tables.availability, "availability");
  assertArray(tables.games, "games");
  assertArray(tables.events, "events");
  assertArray(tables.eventInvites, "eventInvites");
  assertArray(tables.settings, "settings");

  if (users.length === 0) throw new Error("Backup must contain at least one user.");
  if (!users.some((user) => user.role === "admin")) throw new Error("Backup must contain at least one admin user.");

  for (const user of users) {
    if (!isPositiveInteger(user.id)) throw new Error("Backup contains an invalid user id.");
    if (!/^[a-z0-9_.-]{3,24}$/.test(String(user.username || ""))) throw new Error("Backup contains an invalid username.");
    if (!["admin", "user"].includes(user.role)) throw new Error("Backup contains an invalid user role.");
    if (!user.passwordHash || typeof user.passwordHash !== "string") throw new Error("Backup contains an invalid password hash.");
  }

  return tables;
}

function restoreBackupTables(tables) {
  const restore = db.transaction(() => {
    db.prepare("DELETE FROM event_invites").run();
    db.prepare("DELETE FROM events").run();
    db.prepare("DELETE FROM availability").run();
    db.prepare("DELETE FROM games").run();
    db.prepare("DELETE FROM app_settings").run();
    db.prepare("DELETE FROM users").run();

    const insertUser = db.prepare(`
      INSERT INTO users (id, username, display_name, role, password_hash, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    for (const user of tables.users) {
      insertUser.run(user.id, user.username, user.displayName || user.username, user.role, user.passwordHash, user.createdAt);
    }

    const insertGame = db.prepare(`
      INSERT INTO games (id, title, genre, max_players, suggested_by, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    for (const game of tables.games) {
      insertGame.run(game.id, game.title, game.genre || "Co-op", game.maxPlayers || 4, game.suggestedBy || null, game.createdAt);
    }

    const insertAvailability = db.prepare(`
      INSERT INTO availability (id, user_id, date, start_time, end_time, note, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    for (const item of tables.availability) {
      insertAvailability.run(item.id, item.userId, item.date, item.startTime, item.endTime, item.note || "", item.createdAt);
    }

    const insertEvent = db.prepare(`
      INSERT INTO events (id, owner_id, game_id, steam_app_id, game_title, title, date, start_time, end_time, notes, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const event of tables.events) {
      insertEvent.run(
        event.id,
        event.ownerId,
        event.gameId || null,
        event.steamAppId || null,
        event.gameTitle || null,
        event.title,
        event.date,
        event.startTime,
        event.endTime,
        event.notes || "",
        event.createdAt
      );
    }

    const insertInvite = db.prepare("INSERT INTO event_invites (event_id, user_id, status) VALUES (?, ?, ?)");
    for (const invite of tables.eventInvites) {
      insertInvite.run(invite.eventId, invite.userId, invite.status || "invited");
    }

    const insertSetting = db.prepare("INSERT INTO app_settings (key, value) VALUES (?, ?)");
    for (const setting of tables.settings) {
      insertSetting.run(setting.key, setting.value);
    }
  });

  restore();
}

async function notifyDiscord(update) {
  try {
    return await postDiscordUpdate(update);
  } catch (error) {
    console.error("Discord notification failed:", error.message);
    return { sent: false, skipped: false, error: error.message };
  }
}

app.get("/api/health", (_req, res) => res.json({ ok: true }));

app.get("/api/setup", (_req, res) => {
  const userCount = db.prepare("SELECT COUNT(*) AS count FROM users").get().count;
  res.json({ hasUsers: userCount > 0 });
});

app.post("/api/auth/register", authRateLimit, (req, res) => {
  const username = cleanText(req.body.username).toLowerCase();
  const displayName = cleanText(req.body.displayName, username);
  const password = String(req.body.password ?? "");

  if (!/^[a-z0-9_.-]{3,24}$/.test(username)) {
    return res.status(400).json({ error: "Username must be 3-24 characters using letters, numbers, dots, dashes, or underscores." });
  }
  if (displayName.length < 1 || displayName.length > 60) return res.status(400).json({ error: "Display name must be 1-60 characters." });
  if (password.length < 8 || password.length > 128) return res.status(400).json({ error: "Password must be 8-128 characters." });

  const passwordHash = bcrypt.hashSync(password, 12);

  let result;
  try {
    result = db.transaction(() => {
      const userCount = db.prepare("SELECT COUNT(*) AS count FROM users").get().count;
      const role = userCount === 0 ? "admin" : "user";
      return db
        .prepare("INSERT INTO users (username, display_name, role, password_hash) VALUES (?, ?, ?, ?)")
        .run(username, displayName, role, passwordHash);
    })();
  } catch (error) {
    if (error.code === "SQLITE_CONSTRAINT_UNIQUE") {
      return res.status(409).json({ error: "That username is already taken." });
    }
    throw error;
  }

  const user = db.prepare("SELECT * FROM users WHERE id = ?").get(result.lastInsertRowid);
  setSession(res, user.id);
  res.status(201).json({ user: publicUser(user) });
});

app.post("/api/auth/login", authRateLimit, (req, res) => {
  const username = cleanText(req.body.username).toLowerCase();
  const password = String(req.body.password ?? "");
  const user = db.prepare("SELECT * FROM users WHERE username = ?").get(username);

  if (password.length > 128 || !user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ error: "Invalid username or password." });
  }
  setSession(res, user.id);
  res.json({ user: publicUser(user) });
});

app.post("/api/auth/logout", (_req, res) => {
  clearSession(res);
  res.json({ ok: true });
});

app.get("/api/me", (req, res) => res.json({ user: publicUser(req.user) }));

app.get("/api/friends", requireAuth, (req, res) => {
  const users = db.prepare("SELECT id, username, display_name, created_at FROM users ORDER BY display_name").all();
  res.json({ users: users.map(publicUser).filter((user) => user.id !== req.user.id) });
});

app.get("/api/games", requireAuth, async (req, res) => {
  const query = cleanText(req.query.q, "co-op").slice(0, 80);
  try {
    const games = await searchSteamGames(query);
    res.json({ games, source: "steam" });
  } catch (error) {
    res.status(502).json({ error: error.message });
  }
});

app.get("/api/games/:appId", requireAuth, async (req, res) => {
  try {
    const game = await getSteamGameDetails(req.params.appId);
    if (!game) return res.status(404).json({ error: "Game not found on Steam." });
    res.json({ game, source: "steam" });
  } catch (error) {
    res.status(502).json({ error: error.message });
  }
});

app.post("/api/games/suggest", requireAuth, async (req, res) => {
  const steamAppId = Number(req.body.steamAppId);
  const title = cleanText(req.body.title);
  if (!steamAppId || !title) return res.status(400).json({ error: "Steam app and title are required." });

  try {
    const discord = await notifyDiscord({
      title: "New game suggestion",
      description: `${req.user.display_name} suggested **${title}**.`,
      fields: [
        { name: "Steam", value: `https://store.steampowered.com/app/${steamAppId}/`, inline: false }
      ],
      color: 0xd7fb6d
    });
    res.status(201).json({ ok: true, discord });
  } catch (error) {
    res.status(502).json({ error: error.message });
  }
});

app.get("/api/availability", requireAuth, (_req, res) => {
  const rows = db
    .prepare(`
      SELECT a.id, a.user_id AS userId, u.display_name AS displayName, a.date, a.start_time AS startTime,
             a.end_time AS endTime, a.note
      FROM availability a
      JOIN users u ON u.id = a.user_id
      ORDER BY a.date, a.start_time
    `)
    .all();
  res.json({ availability: rows });
});

app.post("/api/availability", requireAuth, async (req, res) => {
  const date = cleanText(req.body.date);
  const startTime = cleanText(req.body.startTime);
  const endTime = cleanText(req.body.endTime);
  const note = cleanText(req.body.note);
  if (!date || !startTime || !endTime) return res.status(400).json({ error: "Date, start, and end time are required." });
  if (!isDateString(date) || !isTimeString(startTime) || !isTimeString(endTime)) return res.status(400).json({ error: "Invalid date or time." });
  if (startTime >= endTime) return res.status(400).json({ error: "End time must be after start time." });

  const result = db
    .prepare("INSERT INTO availability (user_id, date, start_time, end_time, note) VALUES (?, ?, ?, ?, ?)")
    .run(req.user.id, date, startTime, endTime, note);
  const discord = await notifyDiscord({
    title: "Availability added",
    description: `${req.user.display_name} is free on **${date}**.`,
    fields: [
      { name: "Time", value: `${startTime} - ${endTime}`, inline: true },
      { name: "Note", value: note || "Free", inline: true }
    ]
  });
  res.status(201).json({ id: result.lastInsertRowid, discord });
});

app.delete("/api/availability/:id", requireAuth, async (req, res) => {
  const availabilityId = Number(req.params.id);
  const row = db
    .prepare(`
      SELECT a.id, a.user_id AS userId, u.display_name AS displayName, a.date,
             a.start_time AS startTime, a.end_time AS endTime
      FROM availability a
      JOIN users u ON u.id = a.user_id
      WHERE a.id = ?
    `)
    .get(availabilityId);
  if (!row) return res.status(404).json({ error: "Free time entry not found." });
  if (row.userId !== req.user.id && req.user.role !== "admin") {
    return res.status(403).json({ error: "Only the owner or an admin can delete this free time entry." });
  }

  db.prepare("DELETE FROM availability WHERE id = ?").run(availabilityId);
  const discord = await notifyDiscord({
    title: "Availability removed",
    description: `${req.user.display_name} removed a free time entry.`,
    fields: [
      { name: "Player", value: row.displayName, inline: true },
      { name: "When", value: `${row.date}, ${row.startTime} - ${row.endTime}`, inline: true }
    ],
    color: 0x7c8790
  });
  res.json({ ok: true, discord });
});

app.get("/api/events", requireAuth, (_req, res) => {
  const events = db
    .prepare(`
      SELECT e.id, e.owner_id AS ownerId, owner.display_name AS ownerName, e.title, e.date,
             e.start_time AS startTime, e.end_time AS endTime, e.notes,
             e.steam_app_id AS steamAppId, COALESCE(e.game_title, g.title) AS gameTitle
      FROM events e
      JOIN users owner ON owner.id = e.owner_id
      LEFT JOIN games g ON g.id = e.game_id
      ORDER BY e.date, e.start_time
    `)
    .all();
  const invites = db
    .prepare(`
      SELECT ei.event_id AS eventId, ei.user_id AS userId, u.display_name AS displayName, ei.status
      FROM event_invites ei
      JOIN users u ON u.id = ei.user_id
    `)
    .all();
  res.json({
    events: events.map((event) => ({
      ...event,
      invites: invites.filter((invite) => invite.eventId === event.id)
    }))
  });
});

app.patch("/api/events/:id/invites/me", requireAuth, (req, res) => {
  const eventId = Number(req.params.id);
  const status = cleanText(req.body.status);
  if (!["accepted", "declined", "tentative"].includes(status)) {
    return res.status(400).json({ error: "Invalid invite status." });
  }

  const invite = db
    .prepare("SELECT event_id AS eventId FROM event_invites WHERE event_id = ? AND user_id = ?")
    .get(eventId, req.user.id);
  if (!invite) return res.status(404).json({ error: "Invite not found." });

  db.prepare("UPDATE event_invites SET status = ? WHERE event_id = ? AND user_id = ?").run(status, eventId, req.user.id);
  res.json({ ok: true });
});

app.delete("/api/events/:id", requireAuth, async (req, res) => {
  const eventId = Number(req.params.id);
  const event = db
    .prepare(`
      SELECT e.id, e.owner_id AS ownerId, e.title, e.date, e.start_time AS startTime,
             e.end_time AS endTime, COALESCE(e.game_title, g.title) AS gameTitle
      FROM events e
      LEFT JOIN games g ON g.id = e.game_id
      WHERE e.id = ?
    `)
    .get(eventId);
  if (!event) return res.status(404).json({ error: "Event not found." });
  if (event.ownerId !== req.user.id && req.user.role !== "admin") {
    return res.status(403).json({ error: "Only the creator or an admin can remove this event." });
  }

  db.prepare("DELETE FROM events WHERE id = ?").run(eventId);
  const discord = await notifyDiscord({
    title: "Session removed",
    description: `${req.user.display_name} removed **${event.title}**.`,
    fields: [
      { name: "Game", value: event.gameTitle || "TBD", inline: true },
      { name: "When", value: `${event.date}, ${event.startTime} - ${event.endTime}`, inline: true }
    ],
    color: 0x7c8790
  });
  res.json({ ok: true, discord });
});

app.post("/api/events", requireAuth, async (req, res) => {
  const title = cleanText(req.body.title);
  const date = cleanText(req.body.date);
  const startTime = cleanText(req.body.startTime);
  const endTime = cleanText(req.body.endTime);
  const notes = cleanText(req.body.notes);
  const steamAppId = req.body.steamAppId ? Number(req.body.steamAppId) : null;
  const gameTitle = cleanText(req.body.gameTitle) || null;
  const inviteIds = Array.isArray(req.body.inviteIds) ? req.body.inviteIds.map(Number).filter(Boolean) : [];

  if (!title || !date || !startTime || !endTime) return res.status(400).json({ error: "Title, date, start, and end time are required." });

  const create = db.transaction(() => {
    const result = db
      .prepare("INSERT INTO events (owner_id, steam_app_id, game_title, title, date, start_time, end_time, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
      .run(req.user.id, steamAppId, gameTitle, title, date, startTime, endTime, notes);
    const invite = db.prepare("INSERT OR IGNORE INTO event_invites (event_id, user_id) VALUES (?, ?)");
    invite.run(result.lastInsertRowid, req.user.id);
    for (const id of inviteIds) invite.run(result.lastInsertRowid, id);
    return result.lastInsertRowid;
  });

  const eventId = create();
  const event = db
    .prepare(`
      SELECT e.id, e.title, e.date, e.start_time AS startTime, e.end_time AS endTime,
             e.steam_app_id AS steamAppId, COALESCE(e.game_title, g.title) AS gameTitle
      FROM events e
      LEFT JOIN games g ON g.id = e.game_id
      WHERE e.id = ?
    `)
    .get(eventId);
  const invitees = inviteIds.length
    ? db.prepare(`SELECT display_name AS displayName FROM users WHERE id IN (${inviteIds.map(() => "?").join(",")})`).all(...inviteIds)
    : [];
  const discord = await notifyDiscord({
    title: "New session invite",
    description: `${req.user.display_name} created **${event.title}**.`,
    fields: [
      { name: "Game", value: event.gameTitle || "TBD", inline: true },
      { name: "When", value: `${event.date}, ${event.startTime} - ${event.endTime}`, inline: true },
      event.steamAppId ? { name: "Steam", value: `https://store.steampowered.com/app/${event.steamAppId}/`, inline: false } : null,
      { name: "Invited", value: invitees.map((invitee) => invitee.displayName).join(", ") || "No extra invitees", inline: false }
    ].filter(Boolean),
    color: 0xff6b55
  });

  res.status(201).json({ id: eventId, discord });
});

app.get("/api/admin/users", requireAdmin, (_req, res) => {
  const users = db
    .prepare(`
      SELECT u.id, u.username, u.display_name AS displayName, u.role, u.created_at AS createdAt,
             COUNT(DISTINCT a.id) AS availabilityCount,
             COUNT(DISTINCT e.id) AS eventCount
      FROM users u
      LEFT JOIN availability a ON a.user_id = u.id
      LEFT JOIN events e ON e.owner_id = u.id
      GROUP BY u.id
      ORDER BY u.created_at
    `)
    .all();
  res.json({ users });
});

app.patch("/api/admin/users/:id", requireAdmin, (req, res) => {
  const userId = Number(req.params.id);
  const role = cleanText(req.body.role);
  if (!["admin", "user"].includes(role)) return res.status(400).json({ error: "Invalid role." });

  const adminCount = db.prepare("SELECT COUNT(*) AS count FROM users WHERE role = 'admin'").get().count;
  if (req.user.id === userId && role !== "admin" && adminCount <= 1) {
    return res.status(400).json({ error: "You cannot remove the last admin." });
  }

  db.prepare("UPDATE users SET role = ? WHERE id = ?").run(role, userId);
  res.json({ ok: true });
});

app.get("/api/admin/settings", requireAdmin, (_req, res) => {
  res.json({
    settings: {
      appUrl: getSetting("appUrl", process.env.APP_URL || "http://localhost:8080"),
      discordWebhookUrl: getSetting("discordWebhookUrl", process.env.DISCORD_WEBHOOK_URL || ""),
      discordBotName: getSetting("discordBotName", process.env.DISCORD_BOT_NAME || "SquadSlot")
    }
  });
});

app.put("/api/admin/settings", requireAdmin, (req, res) => {
  const appUrl = cleanText(req.body.appUrl);
  const discordWebhookUrl = cleanText(req.body.discordWebhookUrl);
  const discordBotName = cleanText(req.body.discordBotName, "SquadSlot") || "SquadSlot";

  if (!isValidHttpUrl(appUrl)) return res.status(400).json({ error: "App URL must be http or https." });
  if (!isValidDiscordWebhookUrl(discordWebhookUrl)) return res.status(400).json({ error: "Discord webhook URL must be a Discord webhook URL." });
  if (discordBotName.length > 80) return res.status(400).json({ error: "Discord bot name is too long." });

  if (appUrl) setSetting("appUrl", appUrl);
  setSetting("discordWebhookUrl", discordWebhookUrl);
  setSetting("discordBotName", discordBotName);

  res.json({ ok: true });
});

app.get("/api/admin/backup", requireAdmin, (_req, res) => {
  const exportedAt = new Date().toISOString();
  const backup = {
    app: "SquadSlot",
    version: 1,
    exportedAt,
    note: "Password values are bcrypt hashes, not plaintext passwords.",
    tables: backupTables()
  };

  res.setHeader("Content-Type", "application/json");
  res.setHeader("Content-Disposition", `attachment; filename="squadslot-backup-${exportedAt.slice(0, 10)}.json"`);
  res.json(backup);
});

app.post("/api/admin/backup/restore", requireAdmin, (req, res) => {
  try {
    const tables = validateBackup(req.body);
    restoreBackupTables(tables);
    res.json({ ok: true });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.use("/api", (error, _req, res, next) => {
  void next;
  console.error(error);
  res.status(500).json({ error: "Server error." });
});

if (process.env.NODE_ENV === "production") {
  app.use(express.static(distDir));
  app.get("*", (_req, res) => res.sendFile(path.join(distDir, "index.html")));
}

app.listen(port, () => {
  console.log(`SquadSlot listening on port ${port}`);
});
