import express from "express";
import cookieParser from "cookie-parser";
import path from "node:path";
import { fileURLToPath } from "node:url";
import bcrypt from "bcryptjs";
import { clearSession, readSessionCookie, setSession } from "./auth.js";
import { cleanupDemoOnlyDatabase, db, getSetting, publicUser, setSetting } from "./db.js";
import { isValidDiscordWebhookUrl, postDiscordUpdate } from "./discord.js";
import { buildDiscordNotification, getNotificationSettings, saveNotificationSettings } from "./notifications.js";
import {
  addDateDays,
  dateString,
  eventsToIcs,
  expandAvailability,
  findBestSlots,
  getReminderSettings,
  runReminderSweep,
  saveReminderSettings
} from "./scheduling.js";
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
      "img-src 'self' data: https:",
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

function firstForwardedHeader(value) {
  return value?.split(",")[0]?.trim();
}

function originFromUrl(value) {
  if (!value) return "";
  try {
    return new URL(value).origin;
  } catch {
    return "";
  }
}

function addHostOrigins(origins, host) {
  if (!host) return;
  origins.add(`http://${host}`);
  origins.add(`https://${host}`);
}

function allowedOrigins(req) {
  const origins = new Set();
  const host = req.get("host");
  const forwardedHost = firstForwardedHeader(req.get("x-forwarded-host"));
  const forwardedProto = firstForwardedHeader(req.get("x-forwarded-proto"));

  addHostOrigins(origins, host);
  addHostOrigins(origins, forwardedHost);
  if (host) origins.add(`${req.protocol}://${host}`);
  if (forwardedHost && forwardedProto) origins.add(`${forwardedProto}://${forwardedHost}`);

  origins.add(originFromUrl(process.env.APP_URL));
  origins.add(originFromUrl(getSetting("appUrl", "")));
  origins.delete("");
  return origins;
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

function isValidOptionalImageUrl(value) {
  if (!value) return true;
  try {
    const url = new URL(value);
    return url.protocol === "https:";
  } catch {
    return false;
  }
}

function isHexColor(value) {
  return /^#[0-9a-f]{6}$/i.test(value);
}

function isValidTimeZone(value) {
  try {
    new Intl.DateTimeFormat("en-GB", { timeZone: value }).format();
    return true;
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
      .prepare(`
        SELECT id, username, display_name AS displayName, role, password_hash AS passwordHash,
               avatar_url AS avatarUrl, timezone, favorite_games AS favoriteGames,
               preferred_start AS preferredStart, preferred_end AS preferredEnd,
               profile_color AS profileColor, theme, accent, discord_username AS discordUsername,
               created_at AS createdAt
        FROM users ORDER BY id
      `)
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
               title, date, start_time AS startTime, end_time AS endTime, notes,
               min_players AS minPlayers, max_players AS maxPlayers, rsvp_deadline AS rsvpDeadline,
               ready_announced AS readyAnnounced, selected_game_option_id AS selectedGameOptionId,
               created_at AS createdAt
        FROM events
        ORDER BY id
      `)
      .all(),
    eventInvites: db
      .prepare("SELECT event_id AS eventId, user_id AS userId, status FROM event_invites ORDER BY event_id, user_id")
      .all(),
    availabilityRules: db.prepare(`
      SELECT id, user_id AS userId, weekday, start_time AS startTime, end_time AS endTime,
             note, start_date AS startDate, end_date AS endDate, created_at AS createdAt
      FROM availability_rules ORDER BY id
    `).all(),
    availabilityExceptions: db.prepare("SELECT rule_id AS ruleId, date FROM availability_exceptions ORDER BY rule_id, date").all(),
    availabilityPresets: db.prepare(`
      SELECT id, user_id AS userId, name, weekday, start_time AS startTime,
             end_time AS endTime, note, created_at AS createdAt
      FROM availability_presets ORDER BY id
    `).all(),
    eventGameOptions: db.prepare(`
      SELECT id, event_id AS eventId, steam_app_id AS steamAppId, title, image_url AS imageUrl, created_at AS createdAt
      FROM event_game_options ORDER BY id
    `).all(),
    eventGameVotes: db.prepare(`
      SELECT event_id AS eventId, option_id AS optionId, user_id AS userId, created_at AS createdAt
      FROM event_game_votes ORDER BY event_id, user_id
    `).all(),
    eventComments: db.prepare(`
      SELECT id, event_id AS eventId, user_id AS userId, body, created_at AS createdAt
      FROM event_comments ORDER BY id
    `).all(),
    gameSuggestions: db.prepare(`
      SELECT id, user_id AS userId, steam_app_id AS steamAppId, title, image_url AS imageUrl, created_at AS createdAt
      FROM game_suggestions ORDER BY id
    `).all(),
    reminderLog: db.prepare("SELECT reminder_key AS reminderKey, sent_at AS sentAt FROM reminder_log ORDER BY reminder_key").all(),
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
  for (const optionalName of [
    "availabilityRules",
    "availabilityExceptions",
    "availabilityPresets",
    "eventGameOptions",
    "eventGameVotes",
    "eventComments",
    "gameSuggestions",
    "reminderLog"
  ]) {
    if (tables[optionalName] !== undefined) assertArray(tables[optionalName], optionalName);
  }

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
    db.prepare("DELETE FROM reminder_log").run();
    db.prepare("DELETE FROM game_suggestions").run();
    db.prepare("DELETE FROM event_comments").run();
    db.prepare("DELETE FROM event_game_votes").run();
    db.prepare("DELETE FROM event_game_options").run();
    db.prepare("DELETE FROM event_invites").run();
    db.prepare("DELETE FROM events").run();
    db.prepare("DELETE FROM availability_exceptions").run();
    db.prepare("DELETE FROM availability_presets").run();
    db.prepare("DELETE FROM availability_rules").run();
    db.prepare("DELETE FROM availability").run();
    db.prepare("DELETE FROM games").run();
    db.prepare("DELETE FROM app_settings").run();
    db.prepare("DELETE FROM users").run();

    const insertUser = db.prepare(`
      INSERT INTO users (
        id, username, display_name, role, password_hash, avatar_url, timezone,
        favorite_games, preferred_start, preferred_end, profile_color, theme,
        accent, discord_username, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const user of tables.users) {
      insertUser.run(
        user.id,
        user.username,
        user.displayName || user.username,
        user.role,
        user.passwordHash,
        user.avatarUrl || "",
        user.timezone || "Europe/London",
        user.favoriteGames || "",
        user.preferredStart || "19:00",
        user.preferredEnd || "23:00",
        user.profileColor || "#2fd3ba",
        user.theme || "dark",
        user.accent || "#2fd3ba",
        user.discordUsername || "",
        user.createdAt
      );
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
      INSERT INTO events (
        id, owner_id, game_id, steam_app_id, game_title, title, date, start_time,
        end_time, notes, min_players, max_players, rsvp_deadline, ready_announced,
        selected_game_option_id, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
        event.minPlayers || 2,
        event.maxPlayers || 8,
        event.rsvpDeadline || null,
        event.readyAnnounced || 0,
        event.selectedGameOptionId || null,
        event.createdAt
      );
    }

    const insertInvite = db.prepare("INSERT INTO event_invites (event_id, user_id, status) VALUES (?, ?, ?)");
    for (const invite of tables.eventInvites) {
      insertInvite.run(invite.eventId, invite.userId, invite.status || "invited");
    }

    const insertRule = db.prepare(`
      INSERT INTO availability_rules (id, user_id, weekday, start_time, end_time, note, start_date, end_date, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const rule of tables.availabilityRules || []) {
      insertRule.run(rule.id, rule.userId, rule.weekday, rule.startTime, rule.endTime, rule.note || "", rule.startDate, rule.endDate || null, rule.createdAt);
    }
    const insertException = db.prepare("INSERT INTO availability_exceptions (rule_id, date) VALUES (?, ?)");
    for (const exception of tables.availabilityExceptions || []) insertException.run(exception.ruleId, exception.date);
    const insertPreset = db.prepare(`
      INSERT INTO availability_presets (id, user_id, name, weekday, start_time, end_time, note, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const preset of tables.availabilityPresets || []) {
      insertPreset.run(preset.id, preset.userId, preset.name, preset.weekday ?? null, preset.startTime, preset.endTime, preset.note || "", preset.createdAt);
    }
    const insertOption = db.prepare(`
      INSERT INTO event_game_options (id, event_id, steam_app_id, title, image_url, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    for (const option of tables.eventGameOptions || []) {
      insertOption.run(option.id, option.eventId, option.steamAppId || null, option.title, option.imageUrl || "", option.createdAt);
    }
    const insertVote = db.prepare(`
      INSERT INTO event_game_votes (event_id, option_id, user_id, created_at)
      VALUES (?, ?, ?, ?)
    `);
    for (const vote of tables.eventGameVotes || []) insertVote.run(vote.eventId, vote.optionId, vote.userId, vote.createdAt);
    const insertComment = db.prepare(`
      INSERT INTO event_comments (id, event_id, user_id, body, created_at)
      VALUES (?, ?, ?, ?, ?)
    `);
    for (const comment of tables.eventComments || []) {
      insertComment.run(comment.id, comment.eventId, comment.userId, comment.body, comment.createdAt);
    }
    const insertSuggestion = db.prepare(`
      INSERT INTO game_suggestions (id, user_id, steam_app_id, title, image_url, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    for (const suggestion of tables.gameSuggestions || []) {
      insertSuggestion.run(suggestion.id, suggestion.userId, suggestion.steamAppId, suggestion.title, suggestion.imageUrl || "", suggestion.createdAt);
    }
    const insertReminder = db.prepare("INSERT INTO reminder_log (reminder_key, sent_at) VALUES (?, ?)");
    for (const reminder of tables.reminderLog || []) insertReminder.run(reminder.reminderKey, reminder.sentAt);

    const insertSetting = db.prepare("INSERT INTO app_settings (key, value) VALUES (?, ?)");
    for (const setting of tables.settings) {
      insertSetting.run(setting.key, setting.value);
    }
  });

  restore();
}

async function notifyDiscord(type, variables, options) {
  const update = buildDiscordNotification(type, variables, options);
  if (!update) return { sent: false, skipped: true, disabled: true };

  try {
    return await postDiscordUpdate(update);
  } catch (error) {
    console.error("Discord notification failed:", error.message);
    return { sent: false, skipped: false, error: error.message };
  }
}

function eventRows(where = "", params = []) {
  const events = db
    .prepare(`
      SELECT e.id, e.owner_id AS ownerId, owner.display_name AS ownerName, owner.avatar_url AS ownerAvatarUrl,
             owner.profile_color AS ownerColor, e.title, e.date, e.start_time AS startTime,
             e.end_time AS endTime, e.notes, e.steam_app_id AS steamAppId,
             COALESCE(e.game_title, g.title) AS gameTitle, e.min_players AS minPlayers,
             e.max_players AS maxPlayers, e.rsvp_deadline AS rsvpDeadline,
             e.ready_announced AS readyAnnounced, e.selected_game_option_id AS selectedGameOptionId
      FROM events e
      JOIN users owner ON owner.id = e.owner_id
      LEFT JOIN games g ON g.id = e.game_id
      ${where}
      ORDER BY e.date, e.start_time
    `)
    .all(...params);
  if (events.length === 0) return [];

  const ids = events.map((event) => event.id);
  const placeholders = ids.map(() => "?").join(",");
  const invites = db
    .prepare(`
      SELECT ei.event_id AS eventId, ei.user_id AS userId, u.display_name AS displayName,
             u.avatar_url AS avatarUrl, u.profile_color AS profileColor, ei.status
      FROM event_invites ei
      JOIN users u ON u.id = ei.user_id
      WHERE ei.event_id IN (${placeholders})
    `)
    .all(...ids);
  const options = db
    .prepare(`
      SELECT o.id, o.event_id AS eventId, o.steam_app_id AS steamAppId, o.title, o.image_url AS imageUrl,
             COUNT(v.user_id) AS voteCount
      FROM event_game_options o
      LEFT JOIN event_game_votes v ON v.option_id = o.id
      WHERE o.event_id IN (${placeholders})
      GROUP BY o.id
      ORDER BY o.id
    `)
    .all(...ids);
  const votes = db
    .prepare(`SELECT event_id AS eventId, option_id AS optionId, user_id AS userId FROM event_game_votes WHERE event_id IN (${placeholders})`)
    .all(...ids);

  return events.map((event) => ({
    ...event,
    ready: invites.filter((invite) => invite.eventId === event.id && invite.status === "accepted").length >= event.minPlayers,
    invites: invites.filter((invite) => invite.eventId === event.id),
    gameOptions: options
      .filter((option) => option.eventId === event.id)
      .map((option) => ({
        ...option,
        voters: votes.filter((vote) => vote.optionId === option.id).map((vote) => vote.userId)
      }))
  }));
}

async function announceReadyIfNeeded(eventId) {
  const event = eventRows("WHERE e.id = ?", [eventId])[0];
  if (!event || event.readyAnnounced || !event.ready) return;

  const accepted = event.invites.filter((invite) => invite.status === "accepted").length;
  const discord = await notifyDiscord("sessionReady", {
    title: event.title,
    game: event.gameTitle || "TBD",
    accepted,
    minimum: event.minPlayers,
    date: event.date,
    startTime: event.startTime
  }, {
    fields: [
      { name: "Players", value: `${accepted}/${event.minPlayers}`, inline: true },
      { name: "When", value: `${event.date}, ${event.startTime}`, inline: true }
    ],
    color: 0x2fd3ba
  });
  if (discord.sent || discord.disabled || discord.skipped) {
    db.prepare("UPDATE events SET ready_announced = 1 WHERE id = ?").run(eventId);
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
  const users = db.prepare("SELECT * FROM users ORDER BY display_name").all();
  res.json({ users: users.map(publicUser).filter((user) => user.id !== req.user.id) });
});

app.get("/api/profile", requireAuth, (req, res) => {
  res.json({ profile: publicUser(req.user) });
});

app.put("/api/profile", requireAuth, (req, res) => {
  const displayName = cleanText(req.body.displayName, req.user.display_name);
  const avatarUrl = cleanText(req.body.avatarUrl);
  const timezone = cleanText(req.body.timezone, "Europe/London");
  const favoriteGames = cleanText(req.body.favoriteGames).slice(0, 500);
  const preferredStart = cleanText(req.body.preferredStart, "19:00");
  const preferredEnd = cleanText(req.body.preferredEnd, "23:00");
  const profileColor = cleanText(req.body.profileColor, "#2fd3ba");
  const theme = cleanText(req.body.theme, "dark");
  const accent = cleanText(req.body.accent, "#2fd3ba");
  const discordUsername = cleanText(req.body.discordUsername).slice(0, 80);

  if (!displayName || displayName.length > 60) return res.status(400).json({ error: "Display name must be 1-60 characters." });
  if (!isValidOptionalImageUrl(avatarUrl)) return res.status(400).json({ error: "Avatar URL must be an HTTPS URL." });
  if (!isValidTimeZone(timezone)) return res.status(400).json({ error: "Timezone is invalid." });
  if (!isTimeString(preferredStart) || !isTimeString(preferredEnd) || preferredStart >= preferredEnd) {
    return res.status(400).json({ error: "Preferred times are invalid." });
  }
  if (!isHexColor(profileColor) || !isHexColor(accent)) return res.status(400).json({ error: "Profile and accent colours must be hex colours." });
  if (!["dark", "light", "system"].includes(theme)) return res.status(400).json({ error: "Theme is invalid." });

  db.prepare(`
    UPDATE users
    SET display_name = ?, avatar_url = ?, timezone = ?, favorite_games = ?,
        preferred_start = ?, preferred_end = ?, profile_color = ?, theme = ?,
        accent = ?, discord_username = ?
    WHERE id = ?
  `).run(
    displayName,
    avatarUrl,
    timezone,
    favoriteGames,
    preferredStart,
    preferredEnd,
    profileColor,
    theme,
    accent,
    discordUsername,
    req.user.id
  );
  const user = db.prepare("SELECT * FROM users WHERE id = ?").get(req.user.id);
  res.json({ profile: publicUser(user) });
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
  const imageUrl = cleanText(req.body.image);
  if (!steamAppId || !title) return res.status(400).json({ error: "Steam app and title are required." });

  try {
    db.prepare("INSERT INTO game_suggestions (user_id, steam_app_id, title, image_url) VALUES (?, ?, ?, ?)")
      .run(req.user.id, steamAppId, title.slice(0, 160), imageUrl.slice(0, 500));
    const steamUrl = `https://store.steampowered.com/app/${steamAppId}/`;
    const discord = await notifyDiscord("gameSuggested", {
      actor: req.user.display_name,
      title,
      steamUrl
    }, {
      fields: [
        { name: "Steam", value: steamUrl, inline: false }
      ],
      color: 0xd7fb6d
    });
    res.status(201).json({ ok: true, discord });
  } catch (error) {
    res.status(502).json({ error: error.message });
  }
});

app.get("/api/availability", requireAuth, (req, res) => {
  const start = isDateString(req.query.start) ? req.query.start : addDateDays(dateString(new Date()), -14);
  const end = isDateString(req.query.end) ? req.query.end : addDateDays(start, 120);
  res.json({ availability: expandAvailability(start, end) });
});

app.get("/api/availability/best-times", requireAuth, (req, res) => {
  const start = isDateString(req.query.start) ? req.query.start : dateString(new Date());
  const end = isDateString(req.query.end) ? req.query.end : addDateDays(start, 6);
  res.json({ slots: findBestSlots(start, end) });
});

app.get("/api/availability/recurring", requireAuth, (req, res) => {
  const where = req.user.role === "admin" ? "" : "WHERE r.user_id = ?";
  const params = req.user.role === "admin" ? [] : [req.user.id];
  const rules = db
    .prepare(`
      SELECT r.id, r.user_id AS userId, u.display_name AS displayName, r.weekday,
             r.start_time AS startTime, r.end_time AS endTime, r.note,
             r.start_date AS startDate, r.end_date AS endDate
      FROM availability_rules r
      JOIN users u ON u.id = r.user_id
      ${where}
      ORDER BY r.weekday, r.start_time
    `)
    .all(...params);
  res.json({ rules });
});

app.post("/api/availability/recurring", requireAuth, (req, res) => {
  const requestedWeekdays = Array.isArray(req.body.weekdays)
    ? req.body.weekdays.map(Number)
    : [Number(req.body.weekday)];
  const weekdays = [...new Set(requestedWeekdays)];
  const startTime = cleanText(req.body.startTime);
  const endTime = cleanText(req.body.endTime);
  const note = cleanText(req.body.note).slice(0, 200);
  const startDate = cleanText(req.body.startDate, dateString(new Date()));
  const endDate = cleanText(req.body.endDate) || null;
  if (
    weekdays.length === 0
    || weekdays.some((weekday) => !Number.isInteger(weekday) || weekday < 0 || weekday > 6)
  ) {
    return res.status(400).json({ error: "At least one valid weekday is required." });
  }
  if (!isTimeString(startTime) || !isTimeString(endTime) || startTime >= endTime) return res.status(400).json({ error: "Recurring times are invalid." });
  if (!isDateString(startDate) || (endDate && (!isDateString(endDate) || endDate < startDate))) return res.status(400).json({ error: "Recurring date range is invalid." });

  const insertRule = db.prepare(`
    INSERT INTO availability_rules (user_id, weekday, start_time, end_time, note, start_date, end_date)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  const insertRules = db.transaction((days) => days.map((weekday) => (
    insertRule.run(req.user.id, weekday, startTime, endTime, note, startDate, endDate).lastInsertRowid
  )));
  const ids = insertRules(weekdays);
  res.status(201).json({ id: ids[0], ids });
});

app.delete("/api/availability/recurring/:id", requireAuth, (req, res) => {
  const rule = db.prepare("SELECT user_id AS userId FROM availability_rules WHERE id = ?").get(Number(req.params.id));
  if (!rule) return res.status(404).json({ error: "Recurring rule not found." });
  if (rule.userId !== req.user.id && req.user.role !== "admin") return res.status(403).json({ error: "Only the owner or an admin can remove this rule." });
  db.prepare("DELETE FROM availability_rules WHERE id = ?").run(Number(req.params.id));
  res.json({ ok: true });
});

app.get("/api/availability/presets", requireAuth, (req, res) => {
  const presets = db.prepare(`
    SELECT id, name, weekday, start_time AS startTime, end_time AS endTime, note
    FROM availability_presets WHERE user_id = ? ORDER BY name
  `).all(req.user.id);
  res.json({ presets });
});

app.post("/api/availability/presets", requireAuth, (req, res) => {
  const name = cleanText(req.body.name).slice(0, 50);
  const weekday = req.body.weekday === "" || req.body.weekday === null || req.body.weekday === undefined ? null : Number(req.body.weekday);
  const startTime = cleanText(req.body.startTime);
  const endTime = cleanText(req.body.endTime);
  const note = cleanText(req.body.note).slice(0, 200);
  if (!name) return res.status(400).json({ error: "Preset name is required." });
  if (weekday !== null && (!Number.isInteger(weekday) || weekday < 0 || weekday > 6)) return res.status(400).json({ error: "Preset weekday is invalid." });
  if (!isTimeString(startTime) || !isTimeString(endTime) || startTime >= endTime) return res.status(400).json({ error: "Preset times are invalid." });
  const result = db.prepare(`
    INSERT INTO availability_presets (user_id, name, weekday, start_time, end_time, note)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(req.user.id, name, weekday, startTime, endTime, note);
  res.status(201).json({ id: result.lastInsertRowid });
});

app.delete("/api/availability/presets/:id", requireAuth, (req, res) => {
  db.prepare("DELETE FROM availability_presets WHERE id = ? AND user_id = ?").run(Number(req.params.id), req.user.id);
  res.json({ ok: true });
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
  const discord = await notifyDiscord("availabilityAdded", {
    actor: req.user.display_name,
    date,
    startTime,
    endTime,
    note: note || "Free"
  }, {
    fields: [
      { name: "Time", value: `${startTime} - ${endTime}`, inline: true },
      { name: "Note", value: note || "Free", inline: true }
    ]
  });
  res.status(201).json({ id: result.lastInsertRowid, discord });
});

app.delete("/api/availability/:id", requireAuth, async (req, res) => {
  const recurringMatch = /^rule-(\d+)-(\d{4}-\d{2}-\d{2})$/.exec(req.params.id);
  if (recurringMatch) {
    const ruleId = Number(recurringMatch[1]);
    const date = recurringMatch[2];
    const rule = db
      .prepare(`
        SELECT r.user_id AS userId, u.display_name AS displayName, r.start_time AS startTime,
               r.end_time AS endTime
        FROM availability_rules r
        JOIN users u ON u.id = r.user_id
        WHERE r.id = ?
      `)
      .get(ruleId);
    if (!rule) return res.status(404).json({ error: "Recurring free time rule not found." });
    if (rule.userId !== req.user.id && req.user.role !== "admin") {
      return res.status(403).json({ error: "Only the owner or an admin can skip this recurring entry." });
    }
    db.prepare("INSERT OR IGNORE INTO availability_exceptions (rule_id, date) VALUES (?, ?)").run(ruleId, date);
    return res.json({ ok: true, exception: true });
  }

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
  const discord = await notifyDiscord("availabilityRemoved", {
    actor: req.user.display_name,
    player: row.displayName,
    date: row.date,
    startTime: row.startTime,
    endTime: row.endTime
  }, {
    fields: [
      { name: "Player", value: row.displayName, inline: true },
      { name: "When", value: `${row.date}, ${row.startTime} - ${row.endTime}`, inline: true }
    ],
    color: 0x7c8790
  });
  res.json({ ok: true, discord });
});

app.get("/api/events", requireAuth, (_req, res) => {
  res.json({ events: eventRows() });
});

app.patch("/api/events/:id/invites/me", requireAuth, async (req, res) => {
  const eventId = Number(req.params.id);
  const status = cleanText(req.body.status);
  if (!["accepted", "declined", "tentative"].includes(status)) {
    return res.status(400).json({ error: "Invalid invite status." });
  }

  const invite = db
    .prepare("SELECT event_id AS eventId, status FROM event_invites WHERE event_id = ? AND user_id = ?")
    .get(eventId, req.user.id);
  if (!invite) return res.status(404).json({ error: "Invite not found." });
  if (invite.status === status) return res.json({ ok: true, discord: { sent: false, skipped: true, unchanged: true } });
  if (status === "accepted") {
    const capacity = db.prepare(`
      SELECT e.max_players AS maxPlayers,
             SUM(CASE WHEN ei.status = 'accepted' THEN 1 ELSE 0 END) AS accepted
      FROM events e
      LEFT JOIN event_invites ei ON ei.event_id = e.id
      WHERE e.id = ?
      GROUP BY e.id
    `).get(eventId);
    if (capacity && capacity.accepted >= capacity.maxPlayers) return res.status(409).json({ error: "This event is already full." });
  }

  db.prepare("UPDATE event_invites SET status = ? WHERE event_id = ? AND user_id = ?").run(status, eventId, req.user.id);
  const event = db
    .prepare(`
      SELECT e.title, e.date, e.start_time AS startTime, e.end_time AS endTime,
             owner.display_name AS ownerName, COALESCE(e.game_title, g.title) AS gameTitle
      FROM events e
      JOIN users owner ON owner.id = e.owner_id
      LEFT JOIN games g ON g.id = e.game_id
      WHERE e.id = ?
    `)
    .get(eventId);
  const discord = await notifyDiscord("inviteResponse", {
    actor: req.user.display_name,
    status,
    title: event.title,
    game: event.gameTitle || "TBD",
    date: event.date,
    startTime: event.startTime,
    endTime: event.endTime,
    owner: event.ownerName
  }, {
    fields: [
      { name: "Game", value: event.gameTitle || "TBD", inline: true },
      { name: "When", value: `${event.date}, ${event.startTime} - ${event.endTime}`, inline: true },
      { name: "Host", value: event.ownerName, inline: true }
    ],
    color: status === "accepted" ? 0x2fd3ba : status === "tentative" ? 0xd7fb6d : 0x7c8790
  });
  await announceReadyIfNeeded(eventId);
  res.json({ ok: true, discord });
});

app.patch("/api/events/:id", requireAuth, (req, res) => {
  const eventId = Number(req.params.id);
  const event = db.prepare("SELECT owner_id AS ownerId, start_time AS startTime, end_time AS endTime FROM events WHERE id = ?").get(eventId);
  if (!event) return res.status(404).json({ error: "Event not found." });
  if (event.ownerId !== req.user.id && req.user.role !== "admin") return res.status(403).json({ error: "Only the creator or an admin can reschedule this event." });

  const date = cleanText(req.body.date);
  const startTime = cleanText(req.body.startTime);
  const endTime = cleanText(req.body.endTime);
  if (!isDateString(date) || !isTimeString(startTime) || !isTimeString(endTime) || startTime >= endTime) {
    return res.status(400).json({ error: "Event date or time is invalid." });
  }
  db.prepare("UPDATE events SET date = ?, start_time = ?, end_time = ?, ready_announced = 0 WHERE id = ?")
    .run(date, startTime, endTime, eventId);
  res.json({ ok: true });
});

app.post("/api/events/:id/votes", requireAuth, (req, res) => {
  const eventId = Number(req.params.id);
  const optionId = Number(req.body.optionId);
  const invited = db.prepare("SELECT 1 FROM event_invites WHERE event_id = ? AND user_id = ?").get(eventId, req.user.id);
  const option = db.prepare("SELECT 1 FROM event_game_options WHERE id = ? AND event_id = ?").get(optionId, eventId);
  if (!invited) return res.status(403).json({ error: "Only invited players can vote." });
  if (!option) return res.status(404).json({ error: "Game option not found." });
  db.prepare(`
    INSERT INTO event_game_votes (event_id, option_id, user_id)
    VALUES (?, ?, ?)
    ON CONFLICT(event_id, user_id) DO UPDATE SET option_id = excluded.option_id, created_at = CURRENT_TIMESTAMP
  `).run(eventId, optionId, req.user.id);
  res.json({ ok: true });
});

app.post("/api/events/:id/games/randomize", requireAuth, (req, res) => {
  const eventId = Number(req.params.id);
  const event = db.prepare("SELECT owner_id AS ownerId FROM events WHERE id = ?").get(eventId);
  if (!event) return res.status(404).json({ error: "Event not found." });
  if (event.ownerId !== req.user.id && req.user.role !== "admin") return res.status(403).json({ error: "Only the creator or an admin can choose the game." });

  const options = db.prepare(`
    SELECT o.id, o.title, o.steam_app_id AS steamAppId, COUNT(v.user_id) AS voteCount
    FROM event_game_options o
    LEFT JOIN event_game_votes v ON v.option_id = o.id
    WHERE o.event_id = ?
    GROUP BY o.id
  `).all(eventId);
  if (options.length === 0) return res.status(400).json({ error: "This event has no game options." });
  const topVotes = Math.max(...options.map((option) => option.voteCount));
  const tied = options.filter((option) => option.voteCount === topVotes);
  const chosen = tied[Math.floor(Math.random() * tied.length)];
  db.prepare("UPDATE events SET selected_game_option_id = ?, steam_app_id = ?, game_title = ? WHERE id = ?")
    .run(chosen.id, chosen.steamAppId || null, chosen.title, eventId);
  res.json({ ok: true, chosen });
});

app.get("/api/events/:id/comments", requireAuth, (req, res) => {
  const eventId = Number(req.params.id);
  const invited = db.prepare("SELECT 1 FROM event_invites WHERE event_id = ? AND user_id = ?").get(eventId, req.user.id);
  if (!invited && req.user.role !== "admin") return res.status(403).json({ error: "Only invited players can view comments." });
  const comments = db.prepare(`
    SELECT c.id, c.user_id AS userId, u.display_name AS displayName, u.avatar_url AS avatarUrl,
           u.profile_color AS profileColor, c.body, c.created_at AS createdAt
    FROM event_comments c
    JOIN users u ON u.id = c.user_id
    WHERE c.event_id = ?
    ORDER BY c.created_at
  `).all(eventId);
  res.json({ comments });
});

app.post("/api/events/:id/comments", requireAuth, (req, res) => {
  const eventId = Number(req.params.id);
  const body = cleanText(req.body.body);
  const invited = db.prepare("SELECT 1 FROM event_invites WHERE event_id = ? AND user_id = ?").get(eventId, req.user.id);
  if (!invited && req.user.role !== "admin") return res.status(403).json({ error: "Only invited players can comment." });
  if (!body || body.length > 1000) return res.status(400).json({ error: "Comment must be 1-1000 characters." });
  const result = db.prepare("INSERT INTO event_comments (event_id, user_id, body) VALUES (?, ?, ?)").run(eventId, req.user.id, body);
  res.status(201).json({ id: result.lastInsertRowid });
});

app.delete("/api/events/:eventId/comments/:commentId", requireAuth, (req, res) => {
  const comment = db.prepare("SELECT user_id AS userId FROM event_comments WHERE id = ? AND event_id = ?")
    .get(Number(req.params.commentId), Number(req.params.eventId));
  if (!comment) return res.status(404).json({ error: "Comment not found." });
  if (comment.userId !== req.user.id && req.user.role !== "admin") return res.status(403).json({ error: "Only the author or an admin can delete this comment." });
  db.prepare("DELETE FROM event_comments WHERE id = ?").run(Number(req.params.commentId));
  res.json({ ok: true });
});

app.get("/api/events/:id/ics", requireAuth, (req, res) => {
  const eventId = Number(req.params.id);
  const invited = db.prepare("SELECT 1 FROM event_invites WHERE event_id = ? AND user_id = ?").get(eventId, req.user.id);
  if (!invited && req.user.role !== "admin") return res.status(403).json({ error: "Only invited players can export this event." });
  const event = eventRows("WHERE e.id = ?", [eventId])[0];
  if (!event) return res.status(404).json({ error: "Event not found." });
  res.setHeader("Content-Type", "text/calendar; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="squadslot-${event.id}.ics"`);
  res.send(eventsToIcs([event], event.title));
});

app.get("/api/calendar.ics", requireAuth, (req, res) => {
  const events = eventRows().filter((event) => (
    event.ownerId === req.user.id
    || event.invites.some((invite) => invite.userId === req.user.id && ["accepted", "tentative"].includes(invite.status))
  ));
  res.setHeader("Content-Type", "text/calendar; charset=utf-8");
  res.setHeader("Content-Disposition", 'attachment; filename="squadslot-calendar.ics"');
  res.send(eventsToIcs(events));
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
  const discord = await notifyDiscord("sessionRemoved", {
    actor: req.user.display_name,
    title: event.title,
    game: event.gameTitle || "TBD",
    date: event.date,
    startTime: event.startTime,
    endTime: event.endTime
  }, {
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
  const minPlayers = Number(req.body.minPlayers || 2);
  const maxPlayers = Number(req.body.maxPlayers || Math.max(4, minPlayers));
  const rsvpDeadline = cleanText(req.body.rsvpDeadline) || null;
  const gameOptions = Array.isArray(req.body.gameOptions)
    ? req.body.gameOptions
      .map((option) => ({
        steamAppId: Number(option.steamAppId) || null,
        title: cleanText(option.title).slice(0, 160),
        imageUrl: cleanText(option.imageUrl).slice(0, 500)
      }))
      .filter((option) => option.title)
      .slice(0, 8)
    : [];

  if (!title || !date || !startTime || !endTime) return res.status(400).json({ error: "Title, date, start, and end time are required." });
  if (!isDateString(date) || !isTimeString(startTime) || !isTimeString(endTime) || startTime >= endTime) {
    return res.status(400).json({ error: "Event date or time is invalid." });
  }
  if (!Number.isInteger(minPlayers) || !Number.isInteger(maxPlayers) || minPlayers < 1 || maxPlayers < minPlayers || maxPlayers > 100) {
    return res.status(400).json({ error: "Player capacity is invalid." });
  }
  if (rsvpDeadline && Number.isNaN(new Date(rsvpDeadline).getTime())) return res.status(400).json({ error: "RSVP deadline is invalid." });

  const create = db.transaction(() => {
    const result = db
      .prepare(`
        INSERT INTO events (
          owner_id, steam_app_id, game_title, title, date, start_time, end_time, notes,
          min_players, max_players, rsvp_deadline
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(req.user.id, steamAppId, gameTitle, title, date, startTime, endTime, notes, minPlayers, maxPlayers, rsvpDeadline);
    const invite = db.prepare("INSERT OR IGNORE INTO event_invites (event_id, user_id, status) VALUES (?, ?, ?)");
    invite.run(result.lastInsertRowid, req.user.id, "accepted");
    for (const id of inviteIds) invite.run(result.lastInsertRowid, id, "invited");
    const insertOption = db.prepare(`
      INSERT INTO event_game_options (event_id, steam_app_id, title, image_url)
      VALUES (?, ?, ?, ?)
    `);
    const options = gameOptions.length > 0
      ? gameOptions
      : gameTitle
        ? [{ steamAppId, title: gameTitle, imageUrl: "" }]
        : [];
    let firstOptionId = null;
    for (const option of options) {
      const inserted = insertOption.run(result.lastInsertRowid, option.steamAppId, option.title, option.imageUrl);
      firstOptionId ??= inserted.lastInsertRowid;
    }
    if (firstOptionId && options.length === 1) {
      db.prepare("UPDATE events SET selected_game_option_id = ? WHERE id = ?").run(firstOptionId, result.lastInsertRowid);
    }
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
  const invited = invitees.map((invitee) => invitee.displayName).join(", ") || "No extra invitees";
  const steamUrl = event.steamAppId ? `https://store.steampowered.com/app/${event.steamAppId}/` : "";
  const discord = await notifyDiscord("sessionCreated", {
    actor: req.user.display_name,
    title: event.title,
    game: event.gameTitle || "TBD",
    date: event.date,
    startTime: event.startTime,
    endTime: event.endTime,
    invited,
    steamUrl
  }, {
    fields: [
      { name: "Game", value: event.gameTitle || "TBD", inline: true },
      { name: "When", value: `${event.date}, ${event.startTime} - ${event.endTime}`, inline: true },
      { name: "Players", value: `${minPlayers}-${maxPlayers}`, inline: true },
      event.steamAppId ? { name: "Steam", value: steamUrl, inline: false } : null,
      { name: "Invited", value: invited, inline: false }
    ].filter(Boolean),
    color: 0xff6b55
  });

  res.status(201).json({ id: eventId, discord });
});

app.get("/api/dashboard", requireAuth, (req, res) => {
  const today = dateString(new Date());
  const now = new Date();
  const nowKey = `${today} ${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
  const weekEnd = addDateDays(today, 6);
  const events = eventRows();
  const myEvents = events.filter((event) => (
    event.ownerId === req.user.id
    || event.invites.some((invite) => invite.userId === req.user.id && ["accepted", "tentative"].includes(invite.status))
  ));
  const nextEvent = myEvents.find((event) => `${event.date} ${event.startTime}` >= nowKey) || null;
  const pendingInvites = events.filter((event) => (
    event.invites.some((invite) => invite.userId === req.user.id && invite.status === "invited")
  ));
  const suggestions = db.prepare(`
    SELECT s.id, s.steam_app_id AS steamAppId, s.title, s.image_url AS imageUrl,
           s.created_at AS createdAt, u.display_name AS suggestedBy
    FROM game_suggestions s
    JOIN users u ON u.id = s.user_id
    ORDER BY s.created_at DESC
    LIMIT 8
  `).all();
  const todayAvailability = expandAvailability(today, today);
  const tonightEvents = events.filter((event) => event.date === today);

  res.json({
    dashboard: {
      nextEvent,
      pendingInviteCount: pendingInvites.length,
      pendingInvites: pendingInvites.slice(0, 4),
      bestSlots: findBestSlots(today, weekEnd),
      recentSuggestions: suggestions,
      tonight: {
        date: today,
        availability: todayAvailability,
        events: tonightEvents
      }
    }
  });
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

app.post("/api/admin/discord/test", requireAdmin, async (req, res) => {
  let discord;
  try {
    discord = await postDiscordUpdate({
      title: "SquadSlot Discord test",
      description: `${req.user.display_name} sent a test message from SquadSlot.`,
      fields: [
        { name: "Sent by", value: req.user.display_name, inline: true },
        { name: "Purpose", value: "Webhook configuration test", inline: true }
      ],
      color: 0x2fd3ba
    });
  } catch (error) {
    console.error("Discord test failed:", error.message);
    return res.status(502).json({ error: error.message });
  }

  if (discord.skipped) return res.status(400).json({ error: "Discord webhook is not configured." });

  res.json({ ok: true, discord });
});

app.get("/api/admin/notifications", requireAdmin, (_req, res) => {
  res.json({ notifications: getNotificationSettings() });
});

app.put("/api/admin/notifications", requireAdmin, (req, res) => {
  try {
    saveNotificationSettings(req.body.notifications);
    res.json({ ok: true, notifications: getNotificationSettings() });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.get("/api/admin/reminders", requireAdmin, (_req, res) => {
  res.json({ reminders: getReminderSettings() });
});

app.put("/api/admin/reminders", requireAdmin, (req, res) => {
  try {
    saveReminderSettings(req.body.reminders || {});
    res.json({ ok: true, reminders: getReminderSettings() });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.post("/api/admin/reminders/run", requireAdmin, async (_req, res) => {
  await runReminderSweep(notifyDiscord);
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

const reminderTimer = setInterval(() => {
  runReminderSweep(notifyDiscord).catch((error) => console.error("Reminder sweep failed:", error.message));
}, 60 * 1000);
reminderTimer.unref();
