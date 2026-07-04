import express from "express";
import cookieParser from "cookie-parser";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import bcrypt from "bcryptjs";
import { DateTime } from "luxon";
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
const databasePath = process.env.DATABASE_PATH || path.join(process.cwd(), "data", "squadslot.db");
const backupDir = path.resolve(process.env.BACKUP_DIR || path.join(path.dirname(databasePath), "backups"));
const automaticBackupsEnabled = process.env.AUTO_BACKUP_ENABLED === "true";
const backupIntervalHours = Math.max(1, Number(process.env.BACKUP_INTERVAL_HOURS || 24));
const backupRetention = Math.max(1, Number(process.env.BACKUP_RETENTION || 14));

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

app.post("/discord/interactions", express.raw({ type: "application/json", limit: "256kb" }), handleDiscordInteraction);

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
  const session = readSessionCookie(req);
  const user = session ? db.prepare("SELECT * FROM users WHERE id = ?").get(session.userId) : null;
  req.user = user && Number(user.session_version || 0) === session.sessionVersion ? user : null;
  if (req.user) {
    let membership = db.prepare(`
      SELECT gm.group_id AS groupId, gm.role, g.name, g.timezone
      FROM group_members gm
      JOIN groups g ON g.id = gm.group_id
      WHERE gm.user_id = ? AND gm.group_id = ?
    `).get(req.user.id, req.user.active_group_id);
    if (!membership) {
      membership = db.prepare(`
        SELECT gm.group_id AS groupId, gm.role, g.name, g.timezone
        FROM group_members gm
        JOIN groups g ON g.id = gm.group_id
        WHERE gm.user_id = ? ORDER BY gm.joined_at LIMIT 1
      `).get(req.user.id);
    }
    req.group = membership || null;
    req.groupId = membership?.groupId || null;
  }
  next();
});

app.use("/api", (req, res, next) => {
  if (!req.user?.must_change_password) return next();
  const allowed = (
    (req.method === "GET" && req.path === "/me")
    || (req.method === "POST" && req.path === "/auth/logout")
    || (req.method === "PUT" && req.path === "/me/password")
  );
  if (allowed) return next();
  return res.status(403).json({
    error: "You must change your temporary password before continuing.",
    code: "PASSWORD_CHANGE_REQUIRED"
  });
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

function requireGroupOwner(req, res, next) {
  if (!req.user) return res.status(401).json({ error: "You need to sign in first." });
  if (!req.group || (req.user.role !== "admin" && !["owner", "admin"].includes(req.group.role))) {
    return res.status(403).json({ error: "Group owner access required." });
  }
  next();
}

function audit(actorId, action, targetType, targetId = null, details = {}, groupId = null) {
  db.prepare(`
    INSERT INTO audit_log (group_id, actor_id, action, target_type, target_id, details)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(groupId, actorId, action, targetType, targetId === null ? null : String(targetId), JSON.stringify(details));
}

function discordInteractionReply(res, content) {
  return res.json({ type: 4, data: { content, flags: 64 } });
}

function handleDiscordInteraction(req, res) {
  const publicKeyHex = getSetting("discordPublicKey", process.env.DISCORD_PUBLIC_KEY || "");
  const signature = req.get("x-signature-ed25519") || "";
  const timestamp = req.get("x-signature-timestamp") || "";
  if (!/^[0-9a-f]{64}$/i.test(publicKeyHex) || !/^[0-9a-f]+$/i.test(signature) || !timestamp) {
    return res.status(401).send("Invalid request signature.");
  }
  try {
    const prefix = Buffer.from("302a300506032b6570032100", "hex");
    const key = crypto.createPublicKey({
      key: Buffer.concat([prefix, Buffer.from(publicKeyHex, "hex")]),
      format: "der",
      type: "spki"
    });
    const valid = crypto.verify(
      null,
      Buffer.concat([Buffer.from(timestamp), req.body]),
      key,
      Buffer.from(signature, "hex")
    );
    if (!valid) return res.status(401).send("Invalid request signature.");
  } catch {
    return res.status(401).send("Invalid request signature.");
  }

  let interaction;
  try {
    interaction = JSON.parse(req.body.toString("utf8"));
  } catch {
    return res.status(400).send("Invalid JSON.");
  }
  if (interaction.type === 1) return res.json({ type: 1 });
  const match = /^event:(\d+):(accepted|tentative|declined)$/.exec(interaction.data?.custom_id || "");
  if (interaction.type !== 3 || !match) return discordInteractionReply(res, "That SquadSlot action is no longer supported.");

  const discordUserId = interaction.member?.user?.id || interaction.user?.id;
  const user = db.prepare("SELECT * FROM users WHERE discord_user_id = ?").get(discordUserId);
  if (!user) return discordInteractionReply(res, "Link your Discord user ID in your SquadSlot profile first.");
  const eventId = Number(match[1]);
  let status = match[2];
  const event = db.prepare(`
    SELECT id, group_id AS groupId, title, starts_at_utc AS startsAtUtc, ends_at_utc AS endsAtUtc,
           max_players AS maxPlayers FROM events WHERE id = ?
  `).get(eventId);
  if (!event) return discordInteractionReply(res, "This event no longer exists.");
  const membership = db.prepare("SELECT 1 FROM group_members WHERE group_id = ? AND user_id = ?").get(event.groupId, user.id);
  const invite = db.prepare("SELECT status FROM event_invites WHERE event_id = ? AND user_id = ?").get(eventId, user.id);
  if (!membership || !invite) return discordInteractionReply(res, "You are not invited to this event.");

  if (status === "accepted") {
    const conflicts = eventConflicts(user.id, event.groupId, event.startsAtUtc, event.endsAtUtc, eventId);
    if (conflicts.length) return discordInteractionReply(res, `Conflict: you already have ${conflicts[0].title} during this time. Resolve it in SquadSlot.`);
    const accepted = db.prepare("SELECT COUNT(*) AS count FROM event_invites WHERE event_id = ? AND status = 'accepted'").get(eventId).count;
    if (accepted >= event.maxPlayers) status = "waitlisted";
  }
  db.prepare("UPDATE event_invites SET status = ? WHERE event_id = ? AND user_id = ?").run(status, eventId, user.id);
  db.prepare("UPDATE events SET updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(eventId);
  if (["declined", "tentative"].includes(status) && invite.status === "accepted") promoteWaitlist(eventId);
  audit(user.id, `event.rsvp.${status}`, "event", eventId, { source: "discord" }, event.groupId);
  return discordInteractionReply(res, status === "waitlisted" ? `The event is full. You are now on the waitlist for ${event.title}.` : `Your response for ${event.title} is now ${status}.`);
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

function calendarTokenHash(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function publicBaseUrl(req) {
  const configured = cleanText(process.env.APP_URL || getSetting("appUrl", "")).replace(/\/+$/, "");
  if (configured && isValidHttpUrl(configured)) return configured;

  const forwardedHost = firstForwardedHeader(req.get("x-forwarded-host"));
  const forwardedProto = firstForwardedHeader(req.get("x-forwarded-proto"));
  const host = forwardedHost || req.get("host");
  const protocol = forwardedProto || req.protocol;
  return `${protocol}://${host}`;
}

function calendarSubscriptionUrls(req, token) {
  const httpsUrl = `${publicBaseUrl(req)}/calendar/${token}.ics`;
  return {
    httpsUrl,
    webcalUrl: httpsUrl.replace(/^https?:\/\//, "webcal://")
  };
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
               discord_user_id AS discordUserId, active_group_id AS activeGroupId,
               must_change_password AS mustChangePassword, session_version AS sessionVersion,
               created_at AS createdAt
        FROM users ORDER BY id
      `)
      .all(),
    availability: db
      .prepare("SELECT id, group_id AS groupId, user_id AS userId, date, start_time AS startTime, end_time AS endTime, note, timezone, created_at AS createdAt FROM availability ORDER BY id")
      .all(),
    games: db
      .prepare("SELECT id, title, genre, max_players AS maxPlayers, suggested_by AS suggestedBy, created_at AS createdAt FROM games ORDER BY id")
      .all(),
    events: db
      .prepare(`
        SELECT id, group_id AS groupId, owner_id AS ownerId, game_id AS gameId, steam_app_id AS steamAppId, game_title AS gameTitle,
               title, date, start_time AS startTime, end_time AS endTime, notes,
               min_players AS minPlayers, max_players AS maxPlayers, rsvp_deadline AS rsvpDeadline,
               ready_announced AS readyAnnounced, selected_game_option_id AS selectedGameOptionId,
               timezone, starts_at_utc AS startsAtUtc, ends_at_utc AS endsAtUtc,
               created_at AS createdAt, COALESCE(updated_at, created_at) AS updatedAt
        FROM events
        ORDER BY id
      `)
      .all(),
    eventInvites: db
      .prepare("SELECT event_id AS eventId, user_id AS userId, status FROM event_invites ORDER BY event_id, user_id")
      .all(),
    availabilityRules: db.prepare(`
      SELECT id, group_id AS groupId, user_id AS userId, weekday, start_time AS startTime, end_time AS endTime,
             note, start_date AS startDate, end_date AS endDate, timezone, created_at AS createdAt
      FROM availability_rules ORDER BY id
    `).all(),
    availabilityExceptions: db.prepare("SELECT rule_id AS ruleId, date FROM availability_exceptions ORDER BY rule_id, date").all(),
    availabilityPresets: db.prepare(`
      SELECT id, group_id AS groupId, user_id AS userId, name, weekday, start_time AS startTime,
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
      SELECT id, group_id AS groupId, user_id AS userId, steam_app_id AS steamAppId, title, image_url AS imageUrl, created_at AS createdAt
      FROM game_suggestions ORDER BY id
    `).all(),
    calendarSubscriptions: db.prepare(`
      SELECT user_id AS userId, token_hash AS tokenHash, created_at AS createdAt, last_used_at AS lastUsedAt
      FROM calendar_subscriptions ORDER BY user_id
    `).all(),
    groups: db.prepare(`
      SELECT id, name, invite_code AS inviteCode, timezone, created_by AS createdBy, created_at AS createdAt
      FROM groups ORDER BY id
    `).all(),
    groupMembers: db.prepare(`
      SELECT group_id AS groupId, user_id AS userId, role, joined_at AS joinedAt
      FROM group_members ORDER BY group_id, user_id
    `).all(),
    proposals: db.prepare(`
      SELECT id, group_id AS groupId, owner_id AS ownerId, title, notes, status,
             finalized_event_id AS finalizedEventId, created_at AS createdAt
      FROM event_proposals ORDER BY id
    `).all(),
    proposalSlots: db.prepare(`
      SELECT id, proposal_id AS proposalId, starts_at_utc AS startsAtUtc,
             ends_at_utc AS endsAtUtc, timezone, label FROM proposal_slots ORDER BY id
    `).all(),
    proposalGames: db.prepare(`
      SELECT id, proposal_id AS proposalId, steam_app_id AS steamAppId, title, image_url AS imageUrl
      FROM proposal_games ORDER BY id
    `).all(),
    proposalInvites: db.prepare("SELECT proposal_id AS proposalId, user_id AS userId FROM proposal_invites ORDER BY proposal_id, user_id").all(),
    proposalVotes: db.prepare(`
      SELECT proposal_id AS proposalId, user_id AS userId, slot_id AS slotId, game_id AS gameId, updated_at AS updatedAt
      FROM proposal_votes ORDER BY proposal_id, user_id
    `).all(),
    auditLog: db.prepare(`
      SELECT id, group_id AS groupId, actor_id AS actorId, action, target_type AS targetType,
             target_id AS targetId, details, created_at AS createdAt FROM audit_log ORDER BY id
    `).all(),
    reminderLog: db.prepare("SELECT reminder_key AS reminderKey, sent_at AS sentAt FROM reminder_log ORDER BY reminder_key").all(),
    settings: db.prepare("SELECT key, value FROM app_settings ORDER BY key").all()
  };
}

function backupPayload() {
  return {
    app: "SquadSlot",
    version: 1,
    exportedAt: new Date().toISOString(),
    note: "Password values are bcrypt hashes, not plaintext passwords.",
    tables: backupTables()
  };
}

function encryptBackup(payload) {
  const secret = process.env.BACKUP_ENCRYPTION_KEY;
  if (!secret || secret.length < 16) throw new Error("BACKUP_ENCRYPTION_KEY must contain at least 16 characters.");
  const iv = crypto.randomBytes(12);
  const key = crypto.scryptSync(secret, "squadslot-backup-v1", 32);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(payload), "utf8"), cipher.final()]);
  return JSON.stringify({
    format: "squadslot-encrypted-backup",
    version: 1,
    algorithm: "aes-256-gcm",
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    data: encrypted.toString("base64")
  });
}

function decryptBackup(contents) {
  const envelope = JSON.parse(contents);
  if (envelope.format !== "squadslot-encrypted-backup") return envelope;
  const secret = process.env.BACKUP_ENCRYPTION_KEY;
  if (!secret) throw new Error("BACKUP_ENCRYPTION_KEY is required to restore this backup.");
  const key = crypto.scryptSync(secret, "squadslot-backup-v1", 32);
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(envelope.iv, "base64"));
  decipher.setAuthTag(Buffer.from(envelope.tag, "base64"));
  return JSON.parse(Buffer.concat([
    decipher.update(Buffer.from(envelope.data, "base64")),
    decipher.final()
  ]).toString("utf8"));
}

function backupFiles() {
  fs.mkdirSync(backupDir, { recursive: true });
  return fs.readdirSync(backupDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && /^squadslot-\d{8}T\d{6}Z\.json\.enc$/.test(entry.name))
    .map((entry) => {
      const stats = fs.statSync(path.join(backupDir, entry.name));
      return { name: entry.name, size: stats.size, createdAt: stats.birthtime.toISOString() };
    })
    .sort((a, b) => b.name.localeCompare(a.name));
}

function createEncryptedBackup(actorId = null) {
  fs.mkdirSync(backupDir, { recursive: true });
  const payload = backupPayload();
  const stamp = payload.exportedAt.replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const name = `squadslot-${stamp}.json.enc`;
  const destination = path.join(backupDir, name);
  const temporary = `${destination}.tmp`;
  fs.writeFileSync(temporary, encryptBackup(payload), { encoding: "utf8", mode: 0o600 });
  fs.renameSync(temporary, destination);
  for (const stale of backupFiles().slice(backupRetention)) fs.unlinkSync(path.join(backupDir, stale.name));
  audit(actorId, "backup.created", "backup", name, { encrypted: true, automatic: actorId === null });
  return { name, exportedAt: payload.exportedAt };
}

function safeBackupPath(name) {
  if (!/^squadslot-\d{8}T\d{6}Z\.json\.enc$/.test(name)) throw new Error("Backup filename is invalid.");
  return path.join(backupDir, name);
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
    "calendarSubscriptions",
    "reminderLog",
    "groups",
    "groupMembers",
    "proposals",
    "proposalSlots",
    "proposalGames",
    "proposalInvites",
    "proposalVotes",
    "auditLog"
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
    db.prepare("DELETE FROM audit_log").run();
    db.prepare("DELETE FROM proposal_votes").run();
    db.prepare("DELETE FROM proposal_invites").run();
    db.prepare("DELETE FROM proposal_games").run();
    db.prepare("DELETE FROM proposal_slots").run();
    db.prepare("DELETE FROM event_proposals").run();
    db.prepare("DELETE FROM calendar_subscriptions").run();
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
    db.prepare("DELETE FROM group_members").run();
    db.prepare("DELETE FROM users").run();
    db.prepare("DELETE FROM groups").run();

    const insertUser = db.prepare(`
      INSERT INTO users (
        id, username, display_name, role, password_hash, avatar_url, timezone,
        favorite_games, preferred_start, preferred_end, profile_color, theme,
        accent, discord_username, discord_user_id, active_group_id,
        must_change_password, session_version, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
        user.discordUserId || "",
        user.activeGroupId || null,
        user.mustChangePassword ? 1 : 0,
        Number(user.sessionVersion || 0),
        user.createdAt
      );
    }

    const restoredGroups = tables.groups?.length ? tables.groups : [{
      id: 1,
      name: "Main Squad",
      inviteCode: crypto.randomBytes(12).toString("base64url"),
      timezone: "Europe/London",
      createdBy: tables.users.find((user) => user.role === "admin")?.id,
      createdAt: new Date().toISOString()
    }];
    const insertGroup = db.prepare(`
      INSERT INTO groups (id, name, invite_code, timezone, created_by, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    for (const group of restoredGroups) {
      insertGroup.run(group.id, group.name, group.inviteCode, group.timezone || "Europe/London", group.createdBy || null, group.createdAt);
    }
    const memberships = tables.groupMembers?.length
      ? tables.groupMembers
      : tables.users.map((user) => ({ groupId: restoredGroups[0].id, userId: user.id, role: user.role === "admin" ? "owner" : "member", joinedAt: user.createdAt }));
    const insertMember = db.prepare("INSERT INTO group_members (group_id, user_id, role, joined_at) VALUES (?, ?, ?, ?)");
    for (const member of memberships) insertMember.run(member.groupId, member.userId, member.role || "member", member.joinedAt);
    for (const user of tables.users) {
      if (!user.activeGroupId) db.prepare("UPDATE users SET active_group_id = ? WHERE id = ?").run(restoredGroups[0].id, user.id);
    }

    const insertCalendarSubscription = db.prepare(`
      INSERT INTO calendar_subscriptions (user_id, token_hash, created_at, last_used_at)
      VALUES (?, ?, ?, ?)
    `);
    for (const subscription of tables.calendarSubscriptions || []) {
      insertCalendarSubscription.run(
        subscription.userId,
        subscription.tokenHash,
        subscription.createdAt,
        subscription.lastUsedAt || null
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
      INSERT INTO availability (id, group_id, user_id, date, start_time, end_time, note, timezone, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const item of tables.availability) {
      insertAvailability.run(item.id, item.groupId || restoredGroups[0].id, item.userId, item.date, item.startTime, item.endTime, item.note || "", item.timezone || restoredGroups[0].timezone, item.createdAt);
    }

    const insertEvent = db.prepare(`
      INSERT INTO events (
        id, group_id, owner_id, game_id, steam_app_id, game_title, title, date, start_time,
        end_time, notes, min_players, max_players, rsvp_deadline, ready_announced,
        selected_game_option_id, timezone, starts_at_utc, ends_at_utc, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const event of tables.events) {
      insertEvent.run(
        event.id,
        event.groupId || restoredGroups[0].id,
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
        event.timezone || restoredGroups[0].timezone,
        event.startsAtUtc || utcEventRange(event.date, event.startTime, event.endTime, event.timezone || restoredGroups[0].timezone)?.startsAtUtc,
        event.endsAtUtc || utcEventRange(event.date, event.startTime, event.endTime, event.timezone || restoredGroups[0].timezone)?.endsAtUtc,
        event.createdAt,
        event.updatedAt || event.createdAt
      );
    }

    const insertInvite = db.prepare("INSERT INTO event_invites (event_id, user_id, status) VALUES (?, ?, ?)");
    for (const invite of tables.eventInvites) {
      insertInvite.run(invite.eventId, invite.userId, invite.status || "invited");
    }

    const insertRule = db.prepare(`
      INSERT INTO availability_rules (id, group_id, user_id, weekday, start_time, end_time, note, start_date, end_date, timezone, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const rule of tables.availabilityRules || []) {
      insertRule.run(rule.id, rule.groupId || restoredGroups[0].id, rule.userId, rule.weekday, rule.startTime, rule.endTime, rule.note || "", rule.startDate, rule.endDate || null, rule.timezone || restoredGroups[0].timezone, rule.createdAt);
    }
    const insertException = db.prepare("INSERT INTO availability_exceptions (rule_id, date) VALUES (?, ?)");
    for (const exception of tables.availabilityExceptions || []) insertException.run(exception.ruleId, exception.date);
    const insertPreset = db.prepare(`
      INSERT INTO availability_presets (id, group_id, user_id, name, weekday, start_time, end_time, note, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const preset of tables.availabilityPresets || []) {
      insertPreset.run(preset.id, preset.groupId || restoredGroups[0].id, preset.userId, preset.name, preset.weekday ?? null, preset.startTime, preset.endTime, preset.note || "", preset.createdAt);
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
      INSERT INTO game_suggestions (id, group_id, user_id, steam_app_id, title, image_url, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    for (const suggestion of tables.gameSuggestions || []) {
      insertSuggestion.run(suggestion.id, suggestion.groupId || restoredGroups[0].id, suggestion.userId, suggestion.steamAppId, suggestion.title, suggestion.imageUrl || "", suggestion.createdAt);
    }
    const insertProposal = db.prepare(`
      INSERT INTO event_proposals (id, group_id, owner_id, title, notes, status, finalized_event_id, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const proposal of tables.proposals || []) {
      insertProposal.run(proposal.id, proposal.groupId, proposal.ownerId, proposal.title, proposal.notes || "", proposal.status || "open", proposal.finalizedEventId || null, proposal.createdAt);
    }
    const insertProposalSlot = db.prepare(`
      INSERT INTO proposal_slots (id, proposal_id, starts_at_utc, ends_at_utc, timezone, label)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    for (const slot of tables.proposalSlots || []) {
      insertProposalSlot.run(slot.id, slot.proposalId, slot.startsAtUtc, slot.endsAtUtc, slot.timezone, slot.label || "");
    }
    const insertProposalGame = db.prepare(`
      INSERT INTO proposal_games (id, proposal_id, steam_app_id, title, image_url)
      VALUES (?, ?, ?, ?, ?)
    `);
    for (const game of tables.proposalGames || []) insertProposalGame.run(game.id, game.proposalId, game.steamAppId || null, game.title, game.imageUrl || "");
    const insertProposalInvite = db.prepare("INSERT INTO proposal_invites (proposal_id, user_id) VALUES (?, ?)");
    for (const invite of tables.proposalInvites || []) insertProposalInvite.run(invite.proposalId, invite.userId);
    const insertProposalVote = db.prepare(`
      INSERT INTO proposal_votes (proposal_id, user_id, slot_id, game_id, updated_at)
      VALUES (?, ?, ?, ?, ?)
    `);
    for (const vote of tables.proposalVotes || []) insertProposalVote.run(vote.proposalId, vote.userId, vote.slotId || null, vote.gameId || null, vote.updatedAt);
    const insertAudit = db.prepare(`
      INSERT INTO audit_log (id, group_id, actor_id, action, target_type, target_id, details, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const entry of tables.auditLog || []) {
      insertAudit.run(entry.id, entry.groupId || null, entry.actorId || null, entry.action, entry.targetType, entry.targetId || null, entry.details || "{}", entry.createdAt);
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

function eventRows(where = "", params = [], groupId = null) {
  const clauses = [];
  if (groupId) clauses.push("e.group_id = ?");
  if (where) clauses.push(where.replace(/^WHERE\s+/i, ""));
  const whereClause = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const queryParams = groupId ? [groupId, ...params] : params;
  const events = db
    .prepare(`
      SELECT e.id, e.owner_id AS ownerId, owner.display_name AS ownerName, owner.avatar_url AS ownerAvatarUrl,
             owner.profile_color AS ownerColor, e.title, e.date, e.start_time AS startTime,
             e.end_time AS endTime, e.notes, e.steam_app_id AS steamAppId,
             COALESCE(e.game_title, g.title) AS gameTitle, e.min_players AS minPlayers,
             e.max_players AS maxPlayers, e.rsvp_deadline AS rsvpDeadline,
             e.ready_announced AS readyAnnounced, e.selected_game_option_id AS selectedGameOptionId,
             e.group_id AS groupId, e.timezone, e.starts_at_utc AS startsAtUtc,
             e.ends_at_utc AS endsAtUtc, e.created_at AS createdAt,
             COALESCE(e.updated_at, e.created_at) AS updatedAt
      FROM events e
      JOIN users owner ON owner.id = e.owner_id
      LEFT JOIN games g ON g.id = e.game_id
      ${whereClause}
      ORDER BY COALESCE(e.starts_at_utc, e.date || 'T' || e.start_time)
    `)
    .all(...queryParams);
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

function calendarEventsForUser(userId, groupId) {
  return eventRows("", [], groupId).flatMap((event) => {
    if (event.ownerId === userId) return [{ ...event, calendarStatus: "accepted" }];
    const invite = event.invites.find((item) => item.userId === userId);
    return ["accepted", "tentative"].includes(invite?.status)
      ? [{ ...event, calendarStatus: invite.status }]
      : [];
  });
}

function currentDateTimeKey(now = new Date()) {
  const date = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0")
  ].join("-");
  return `${date} ${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
}

function isUpcomingEvent(event, nowKey = currentDateTimeKey()) {
  if (event.endsAtUtc) return DateTime.fromISO(event.endsAtUtc).toMillis() > Date.now();
  return `${event.date} ${event.endTime}` > nowKey;
}

function eventForTimezone(event, timezone) {
  if (!event.startsAtUtc || !event.endsAtUtc) return event;
  const start = DateTime.fromISO(event.startsAtUtc, { zone: "utc" }).setZone(timezone);
  const end = DateTime.fromISO(event.endsAtUtc, { zone: "utc" }).setZone(timezone);
  if (!start.isValid || !end.isValid) return event;
  return {
    ...event,
    date: start.toISODate(),
    startTime: start.toFormat("HH:mm"),
    endTime: end.toFormat("HH:mm"),
    displayTimezone: timezone,
    crossesDay: start.toISODate() !== end.toISODate()
  };
}

function eventsForTimezone(events, timezone) {
  return events.map((event) => eventForTimezone(event, timezone));
}

function utcEventRange(date, startTime, endTime, timezone) {
  const start = DateTime.fromISO(`${date}T${startTime}`, { zone: timezone });
  let end = DateTime.fromISO(`${date}T${endTime}`, { zone: timezone });
  if (!start.isValid || !end.isValid || end <= start) return null;
  return { startsAtUtc: start.toUTC().toISO(), endsAtUtc: end.toUTC().toISO() };
}

function eventInActiveGroup(eventId, groupId) {
  return db.prepare(`
    SELECT id, owner_id AS ownerId, group_id AS groupId, title, date,
           start_time AS startTime, end_time AS endTime, timezone,
           starts_at_utc AS startsAtUtc, ends_at_utc AS endsAtUtc,
           min_players AS minPlayers, max_players AS maxPlayers
    FROM events WHERE id = ? AND group_id = ?
  `).get(eventId, groupId);
}

function eventConflicts(userId, groupId, startsAtUtc, endsAtUtc, excludeEventId = null) {
  return db.prepare(`
    SELECT e.id, e.title, e.starts_at_utc AS startsAtUtc, e.ends_at_utc AS endsAtUtc
    FROM events e
    JOIN event_invites ei ON ei.event_id = e.id
    WHERE e.group_id = ? AND ei.user_id = ?
      AND ei.status IN ('accepted', 'tentative')
      AND e.starts_at_utc < ? AND e.ends_at_utc > ?
      AND (? IS NULL OR e.id != ?)
    ORDER BY e.starts_at_utc
  `).all(groupId, userId, endsAtUtc, startsAtUtc, excludeEventId, excludeEventId);
}

function promoteWaitlist(eventId) {
  const capacity = db.prepare(`
    SELECT e.max_players AS maxPlayers,
           SUM(CASE WHEN ei.status = 'accepted' THEN 1 ELSE 0 END) AS accepted
    FROM events e LEFT JOIN event_invites ei ON ei.event_id = e.id
    WHERE e.id = ? GROUP BY e.id
  `).get(eventId);
  if (!capacity || Number(capacity.accepted || 0) >= capacity.maxPlayers) return null;
  const next = db.prepare(`
    SELECT user_id AS userId FROM event_invites
    WHERE event_id = ? AND status = 'waitlisted'
    ORDER BY rowid LIMIT 1
  `).get(eventId);
  if (!next) return null;
  db.prepare("UPDATE event_invites SET status = 'accepted' WHERE event_id = ? AND user_id = ?")
    .run(eventId, next.userId);
  return next.userId;
}

function proposalRows(groupId, timezone) {
  const proposals = db.prepare(`
    SELECT p.id, p.owner_id AS ownerId, u.display_name AS ownerName, p.title, p.notes,
           p.status, p.finalized_event_id AS finalizedEventId, p.created_at AS createdAt
    FROM event_proposals p JOIN users u ON u.id = p.owner_id
    WHERE p.group_id = ? ORDER BY p.status = 'open' DESC, p.created_at DESC
  `).all(groupId);
  return proposals.map((proposal) => {
    const slots = db.prepare(`
      SELECT id, starts_at_utc AS startsAtUtc, ends_at_utc AS endsAtUtc, timezone, label
      FROM proposal_slots WHERE proposal_id = ? ORDER BY starts_at_utc
    `).all(proposal.id).map((slot) => {
      const start = DateTime.fromISO(slot.startsAtUtc, { zone: "utc" }).setZone(timezone);
      const end = DateTime.fromISO(slot.endsAtUtc, { zone: "utc" }).setZone(timezone);
      return {
        ...slot,
        date: start.toISODate(),
        startTime: start.toFormat("HH:mm"),
        endTime: end.toFormat("HH:mm"),
        displayTimezone: timezone
      };
    });
    const games = db.prepare(`
      SELECT id, steam_app_id AS steamAppId, title, image_url AS imageUrl
      FROM proposal_games WHERE proposal_id = ? ORDER BY id
    `).all(proposal.id);
    const votes = db.prepare(`
      SELECT user_id AS userId, slot_id AS slotId, game_id AS gameId
      FROM proposal_votes WHERE proposal_id = ?
    `).all(proposal.id);
    const inviteIds = db.prepare("SELECT user_id AS userId FROM proposal_invites WHERE proposal_id = ?")
      .all(proposal.id).map((row) => row.userId);
    return {
      ...proposal,
      slots: slots.map((slot) => ({ ...slot, voters: votes.filter((vote) => vote.slotId === slot.id).map((vote) => vote.userId) })),
      games: games.map((game) => ({ ...game, voters: votes.filter((vote) => vote.gameId === game.id).map((vote) => vote.userId) })),
      inviteIds,
      votes
    };
  });
}

function timeToMinutes(value) {
  const [hours, minutes] = value.split(":").map(Number);
  return (hours * 60) + minutes;
}

function minutesToTime(value) {
  const clamped = Math.max(0, Math.min((23 * 60) + 59, value));
  return `${String(Math.floor(clamped / 60)).padStart(2, "0")}:${String(clamped % 60).padStart(2, "0")}`;
}

function subtractCommittedTime(item, committed) {
  let segments = [[timeToMinutes(item.startTime), timeToMinutes(item.endTime)]];
  for (const blocker of committed.filter((entry) => entry.date === item.date)) {
    const blockStart = timeToMinutes(blocker.startTime);
    const blockEnd = timeToMinutes(blocker.endTime);
    segments = segments.flatMap(([start, end]) => {
      if (blockEnd <= start || blockStart >= end) return [[start, end]];
      const remainder = [];
      if (blockStart > start) remainder.push([start, Math.min(blockStart, end)]);
      if (blockEnd < end) remainder.push([Math.max(blockEnd, start), end]);
      return remainder;
    });
  }

  return segments
    .filter(([start, end]) => start < end)
    .map(([start, end]) => ({
      ...item,
      startMinutes: start,
      endMinutes: end,
      startTime: minutesToTime(start),
      endTime: minutesToTime(end)
    }));
}

function mergeAvailabilitySegments(items) {
  const grouped = new Map();
  for (const item of items) {
    const key = `${item.userId}:${item.date}`;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(item);
  }

  const merged = [];
  for (const entries of grouped.values()) {
    entries.sort((a, b) => a.startMinutes - b.startMinutes || a.endMinutes - b.endMinutes);
    for (const item of entries) {
      const previous = merged.at(-1);
      if (
        previous
        && previous.userId === item.userId
        && previous.date === item.date
        && item.startMinutes <= previous.endMinutes
      ) {
        previous.endMinutes = Math.max(previous.endMinutes, item.endMinutes);
        previous.endTime = minutesToTime(previous.endMinutes);
        previous.notes = [...new Set([...previous.notes, item.note].filter(Boolean))];
        if (item.createdAt && (!previous.createdAt || item.createdAt < previous.createdAt)) previous.createdAt = item.createdAt;
      } else {
        merged.push({
          ...item,
          notes: item.note ? [item.note] : []
        });
      }
    }
  }
  return merged;
}

function calendarAvailabilityForUser(userId, startDate, endDate, groupId) {
  const availability = expandAvailability(startDate, endDate, groupId);
  const committedByUser = new Map();

  function commit(user, event) {
    if (!committedByUser.has(user)) committedByUser.set(user, []);
    committedByUser.get(user).push({
      date: event.date,
      startTime: event.startTime,
      endTime: event.endTime
    });
  }

  for (const event of eventRows("", [], groupId).filter((item) => item.date >= startDate && item.date <= endDate)) {
    commit(event.ownerId, event);
    for (const invite of event.invites) {
      if (["accepted", "tentative"].includes(invite.status)) commit(invite.userId, event);
    }
  }

  const usable = availability.flatMap((item) => (
    subtractCommittedTime(item, committedByUser.get(item.userId) || [])
  ));
  const merged = mergeAvailabilitySegments(usable);
  const mine = merged.filter((item) => item.userId === userId);
  const others = merged.filter((item) => item.userId !== userId);
  const feedItems = mine.map((item) => ({
    kind: "free",
    uid: `${userId}-${item.date}-${item.startTime}-${item.endTime}`,
    date: item.date,
    startTime: item.startTime,
    endTime: item.endTime,
    createdAt: item.createdAt,
    summary: "Free to play",
    description: item.notes.length
      ? `Your SquadSlot availability. ${item.notes.join(" / ")}`
      : "Your SquadSlot availability."
  }));

  for (const own of mine) {
    const candidates = others.filter((item) => (
      item.date === own.date
      && item.startMinutes < own.endMinutes
      && item.endMinutes > own.startMinutes
    ));
    const boundaries = new Set([own.startMinutes, own.endMinutes]);
    for (const item of candidates) {
      boundaries.add(Math.max(own.startMinutes, item.startMinutes));
      boundaries.add(Math.min(own.endMinutes, item.endMinutes));
    }
    const ordered = [...boundaries].sort((a, b) => a - b);
    const windows = [];

    for (let index = 0; index < ordered.length - 1; index += 1) {
      const start = ordered[index];
      const end = ordered[index + 1];
      const players = new Map();
      for (const item of candidates) {
        if (item.startMinutes < end && item.endMinutes > start) {
          players.set(item.userId, item.displayName);
        }
      }
      if (players.size === 0) continue;

      const ids = [...players.keys()].sort((a, b) => a - b);
      const names = ids.map((id) => players.get(id));
      const previous = windows.at(-1);
      if (previous && previous.end === start && previous.ids.join(",") === ids.join(",")) {
        previous.end = end;
      } else {
        windows.push({ start, end, ids, names });
      }
    }

    for (const window of windows) {
      const startTime = minutesToTime(window.start);
      const endTime = minutesToTime(window.end);
      feedItems.push({
        kind: "overlap",
        uid: `${userId}-${own.date}-${startTime}-${endTime}-${window.ids.join("-")}`,
        date: own.date,
        startTime,
        endTime,
        createdAt: own.createdAt,
        summary: `Also free: ${window.names.join(", ")}`,
        description: `${window.names.join(", ")} ${window.names.length === 1 ? "is" : "are"} also free during your SquadSlot availability.`
      });
    }
  }

  return feedItems.sort((a, b) => (
    `${a.date} ${a.startTime} ${a.kind}`.localeCompare(`${b.date} ${b.startTime} ${b.kind}`)
  ));
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
      const inserted = db
        .prepare("INSERT INTO users (username, display_name, role, password_hash) VALUES (?, ?, ?, ?)")
        .run(username, displayName, role, passwordHash);
      const group = db.prepare("SELECT id FROM groups ORDER BY id LIMIT 1").get();
      db.prepare("INSERT INTO group_members (group_id, user_id, role) VALUES (?, ?, ?)")
        .run(group.id, inserted.lastInsertRowid, userCount === 0 ? "owner" : "member");
      db.prepare("UPDATE users SET active_group_id = ? WHERE id = ?").run(group.id, inserted.lastInsertRowid);
      if (userCount === 0) db.prepare("UPDATE groups SET created_by = ? WHERE id = ?").run(inserted.lastInsertRowid, group.id);
      return inserted;
    })();
  } catch (error) {
    if (error.code === "SQLITE_CONSTRAINT_UNIQUE") {
      return res.status(409).json({ error: "That username is already taken." });
    }
    throw error;
  }

  const user = db.prepare("SELECT * FROM users WHERE id = ?").get(result.lastInsertRowid);
  setSession(res, user.id, Number(user.session_version || 0));
  res.status(201).json({ user: publicUser(user, true) });
});

app.post("/api/auth/login", authRateLimit, (req, res) => {
  const username = cleanText(req.body.username).toLowerCase();
  const password = String(req.body.password ?? "");
  const user = db.prepare("SELECT * FROM users WHERE username = ?").get(username);

  if (password.length > 128 || !user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ error: "Invalid username or password." });
  }
  setSession(res, user.id, Number(user.session_version || 0));
  res.json({ user: publicUser(user, true) });
});

app.post("/api/auth/logout", (_req, res) => {
  clearSession(res);
  res.json({ ok: true });
});

app.get("/api/me", (req, res) => res.json({ user: publicUser(req.user, true) }));

app.get("/api/groups", requireAuth, (req, res) => {
  const groups = db.prepare(`
    SELECT g.id, g.name, g.timezone, g.invite_code AS inviteCode, gm.role,
           g.created_at AS createdAt, COUNT(members.user_id) AS memberCount
    FROM group_members gm
    JOIN groups g ON g.id = gm.group_id
    LEFT JOIN group_members members ON members.group_id = g.id
    WHERE gm.user_id = ?
    GROUP BY g.id, gm.role
    ORDER BY g.name
  `).all(req.user.id);
  res.json({ groups, activeGroupId: req.groupId });
});

app.post("/api/groups", requireAuth, (req, res) => {
  const name = cleanText(req.body.name).slice(0, 60);
  const timezone = cleanText(req.body.timezone, req.user.timezone || "Europe/London");
  if (!name) return res.status(400).json({ error: "Group name is required." });
  if (!isValidTimeZone(timezone)) return res.status(400).json({ error: "Group timezone is invalid." });
  const created = db.transaction(() => {
    const result = db.prepare("INSERT INTO groups (name, invite_code, timezone, created_by) VALUES (?, ?, ?, ?)")
      .run(name, crypto.randomBytes(12).toString("base64url"), timezone, req.user.id);
    db.prepare("INSERT INTO group_members (group_id, user_id, role) VALUES (?, ?, 'owner')")
      .run(result.lastInsertRowid, req.user.id);
    db.prepare("UPDATE users SET active_group_id = ? WHERE id = ?").run(result.lastInsertRowid, req.user.id);
    return result.lastInsertRowid;
  })();
  audit(req.user.id, "group.created", "group", created, { name, timezone }, created);
  res.status(201).json({ id: created });
});

app.post("/api/groups/join", requireAuth, (req, res) => {
  const inviteCode = cleanText(req.body.inviteCode);
  const group = db.prepare("SELECT id, name FROM groups WHERE invite_code = ?").get(inviteCode);
  if (!group) return res.status(404).json({ error: "Group invite code not found." });
  db.transaction(() => {
    db.prepare("INSERT OR IGNORE INTO group_members (group_id, user_id, role) VALUES (?, ?, 'member')")
      .run(group.id, req.user.id);
    db.prepare("UPDATE users SET active_group_id = ? WHERE id = ?").run(group.id, req.user.id);
  })();
  audit(req.user.id, "group.joined", "group", group.id, {}, group.id);
  res.json({ ok: true, group });
});

app.put("/api/groups/:id/activate", requireAuth, (req, res) => {
  const groupId = Number(req.params.id);
  const membership = db.prepare("SELECT 1 FROM group_members WHERE group_id = ? AND user_id = ?")
    .get(groupId, req.user.id);
  if (!membership) return res.status(403).json({ error: "You are not a member of that group." });
  db.prepare("UPDATE users SET active_group_id = ? WHERE id = ?").run(groupId, req.user.id);
  const user = db.prepare("SELECT * FROM users WHERE id = ?").get(req.user.id);
  res.json({ ok: true, user: publicUser(user, true) });
});

app.post("/api/groups/:id/invite-code", requireAuth, requireGroupOwner, (req, res) => {
  const groupId = Number(req.params.id);
  if (groupId !== req.groupId) return res.status(409).json({ error: "Activate the group before managing it." });
  const inviteCode = crypto.randomBytes(12).toString("base64url");
  db.prepare("UPDATE groups SET invite_code = ? WHERE id = ?").run(inviteCode, groupId);
  audit(req.user.id, "group.invite_rotated", "group", groupId, {}, groupId);
  res.json({ ok: true, inviteCode });
});

app.put("/api/me/password", requireAuth, (req, res) => {
  const currentPassword = String(req.body.currentPassword ?? "");
  const newPassword = String(req.body.newPassword ?? "");

  if (currentPassword.length > 128 || !bcrypt.compareSync(currentPassword, req.user.password_hash)) {
    return res.status(401).json({ error: "Current password is incorrect." });
  }
  if (newPassword.length < 8 || newPassword.length > 128) {
    return res.status(400).json({ error: "New password must be 8-128 characters." });
  }
  if (bcrypt.compareSync(newPassword, req.user.password_hash)) {
    return res.status(400).json({ error: "New password must be different from the temporary password." });
  }

  const passwordHash = bcrypt.hashSync(newPassword, 12);
  db.prepare(`
    UPDATE users
    SET password_hash = ?, must_change_password = 0, session_version = session_version + 1
    WHERE id = ?
  `).run(passwordHash, req.user.id);

  const user = db.prepare("SELECT * FROM users WHERE id = ?").get(req.user.id);
  setSession(res, user.id, Number(user.session_version || 0));
  res.json({ ok: true, user: publicUser(user, true) });
});

app.get("/api/friends", requireAuth, (req, res) => {
  const users = db.prepare(`
    SELECT u.* FROM users u
    JOIN group_members gm ON gm.user_id = u.id
    WHERE gm.group_id = ?
    ORDER BY u.display_name
  `).all(req.groupId);
  res.json({ users: users.map((user) => publicUser(user)).filter((user) => user.id !== req.user.id) });
});

app.get("/api/profile", requireAuth, (req, res) => {
  res.json({ profile: publicUser(req.user, true) });
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
  const discordUserId = cleanText(req.body.discordUserId).slice(0, 32);

  if (!displayName || displayName.length > 60) return res.status(400).json({ error: "Display name must be 1-60 characters." });
  if (!isValidOptionalImageUrl(avatarUrl)) return res.status(400).json({ error: "Avatar URL must be an HTTPS URL." });
  if (!isValidTimeZone(timezone)) return res.status(400).json({ error: "Timezone is invalid." });
  if (!isTimeString(preferredStart) || !isTimeString(preferredEnd) || preferredStart >= preferredEnd) {
    return res.status(400).json({ error: "Preferred times are invalid." });
  }
  if (!isHexColor(profileColor) || !isHexColor(accent)) return res.status(400).json({ error: "Profile and accent colours must be hex colours." });
  if (!["dark", "light", "system"].includes(theme)) return res.status(400).json({ error: "Theme is invalid." });
  if (discordUserId && !/^\d{15,22}$/.test(discordUserId)) return res.status(400).json({ error: "Discord user ID is invalid." });

  db.prepare(`
    UPDATE users
    SET display_name = ?, avatar_url = ?, timezone = ?, favorite_games = ?,
        preferred_start = ?, preferred_end = ?, profile_color = ?, theme = ?,
        accent = ?, discord_username = ?, discord_user_id = ?
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
    discordUserId,
    req.user.id
  );
  const user = db.prepare("SELECT * FROM users WHERE id = ?").get(req.user.id);
  res.json({ profile: publicUser(user, true) });
});

app.get("/api/calendar/subscription", requireAuth, (req, res) => {
  const subscription = db.prepare(`
    SELECT created_at AS createdAt, last_used_at AS lastUsedAt
    FROM calendar_subscriptions
    WHERE user_id = ?
  `).get(req.user.id);
  res.json({
    subscription: subscription
      ? { active: true, createdAt: subscription.createdAt, lastUsedAt: subscription.lastUsedAt }
      : { active: false, createdAt: null, lastUsedAt: null }
  });
});

app.post("/api/calendar/subscription", requireAuth, (req, res) => {
  const token = crypto.randomBytes(32).toString("base64url");
  db.prepare(`
    INSERT INTO calendar_subscriptions (user_id, token_hash, created_at, last_used_at)
    VALUES (?, ?, CURRENT_TIMESTAMP, NULL)
    ON CONFLICT(user_id) DO UPDATE SET
      token_hash = excluded.token_hash,
      created_at = CURRENT_TIMESTAMP,
      last_used_at = NULL
  `).run(req.user.id, calendarTokenHash(token));
  res.status(201).json({
    subscription: {
      active: true,
      createdAt: new Date().toISOString(),
      lastUsedAt: null,
      ...calendarSubscriptionUrls(req, token)
    }
  });
});

app.delete("/api/calendar/subscription", requireAuth, (req, res) => {
  db.prepare("DELETE FROM calendar_subscriptions WHERE user_id = ?").run(req.user.id);
  res.json({ ok: true });
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
    db.prepare("INSERT INTO game_suggestions (group_id, user_id, steam_app_id, title, image_url) VALUES (?, ?, ?, ?, ?)")
      .run(req.groupId, req.user.id, steamAppId, title.slice(0, 160), imageUrl.slice(0, 500));
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
  res.json({ availability: expandAvailability(start, end, req.groupId) });
});

app.get("/api/availability/best-times", requireAuth, (req, res) => {
  const start = isDateString(req.query.start) ? req.query.start : dateString(new Date());
  const end = isDateString(req.query.end) ? req.query.end : addDateDays(start, 6);
  res.json({ slots: findBestSlots(start, end, null, req.groupId) });
});

app.get("/api/availability/recurring", requireAuth, (req, res) => {
  const where = req.user.role === "admin" ? "WHERE r.group_id = ?" : "WHERE r.group_id = ? AND r.user_id = ?";
  const params = req.user.role === "admin" ? [req.groupId] : [req.groupId, req.user.id];
  const rules = db
    .prepare(`
      SELECT r.id, r.user_id AS userId, u.display_name AS displayName, r.weekday,
             r.start_time AS startTime, r.end_time AS endTime, r.note,
             r.start_date AS startDate, r.end_date AS endDate, r.timezone
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
    INSERT INTO availability_rules (group_id, user_id, weekday, start_time, end_time, note, start_date, end_date, timezone)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertRules = db.transaction((days) => days.map((weekday) => (
    insertRule.run(req.groupId, req.user.id, weekday, startTime, endTime, note, startDate, endDate, req.group.timezone).lastInsertRowid
  )));
  const ids = insertRules(weekdays);
  res.status(201).json({ id: ids[0], ids });
});

app.delete("/api/availability/recurring/:id", requireAuth, (req, res) => {
  const rule = db.prepare("SELECT user_id AS userId FROM availability_rules WHERE id = ? AND group_id = ?")
    .get(Number(req.params.id), req.groupId);
  if (!rule) return res.status(404).json({ error: "Recurring rule not found." });
  if (rule.userId !== req.user.id && req.user.role !== "admin") return res.status(403).json({ error: "Only the owner or an admin can remove this rule." });
  db.prepare("DELETE FROM availability_rules WHERE id = ?").run(Number(req.params.id));
  res.json({ ok: true });
});

app.get("/api/availability/presets", requireAuth, (req, res) => {
  const presets = db.prepare(`
    SELECT id, name, weekday, start_time AS startTime, end_time AS endTime, note
    FROM availability_presets WHERE user_id = ? AND group_id = ? ORDER BY name
  `).all(req.user.id, req.groupId);
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
    INSERT INTO availability_presets (group_id, user_id, name, weekday, start_time, end_time, note)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(req.groupId, req.user.id, name, weekday, startTime, endTime, note);
  res.status(201).json({ id: result.lastInsertRowid });
});

app.delete("/api/availability/presets/:id", requireAuth, (req, res) => {
  db.prepare("DELETE FROM availability_presets WHERE id = ? AND user_id = ? AND group_id = ?")
    .run(Number(req.params.id), req.user.id, req.groupId);
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
    .prepare("INSERT INTO availability (group_id, user_id, date, start_time, end_time, note, timezone) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .run(req.groupId, req.user.id, date, startTime, endTime, note, req.group.timezone);
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
        WHERE r.id = ? AND r.group_id = ?
      `)
      .get(ruleId, req.groupId);
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
      WHERE a.id = ? AND a.group_id = ?
    `)
    .get(availabilityId, req.groupId);
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

app.get("/api/events", requireAuth, (req, res) => {
  const nowKey = currentDateTimeKey();
  const events = eventRows("", [], req.groupId).filter((event) => isUpcomingEvent(event, nowKey));
  res.json({ events: eventsForTimezone(events, req.user.timezone) });
});

app.get("/api/events/history", requireAuth, (req, res) => {
  const history = eventRows("", [], req.groupId)
    .filter((event) => !isUpcomingEvent(event))
    .filter((event) => (
      event.ownerId === req.user.id
      || event.invites.some((invite) => invite.userId === req.user.id && invite.status !== "declined")
      || req.user.role === "admin"
    ))
    .sort((a, b) => String(b.endsAtUtc || b.date).localeCompare(String(a.endsAtUtc || a.date)))
    .slice(0, 200);
  res.json({ events: eventsForTimezone(history, req.user.timezone) });
});

app.patch("/api/events/:id/invites/me", requireAuth, async (req, res) => {
  const eventId = Number(req.params.id);
  let status = cleanText(req.body.status);
  if (!["accepted", "declined", "tentative"].includes(status)) {
    return res.status(400).json({ error: "Invalid invite status." });
  }

  const activeEvent = eventInActiveGroup(eventId, req.groupId);
  if (!activeEvent) return res.status(404).json({ error: "Event not found." });
  const invite = db.prepare("SELECT event_id AS eventId, status FROM event_invites WHERE event_id = ? AND user_id = ?")
    .get(eventId, req.user.id);
  if (!invite) return res.status(404).json({ error: "Invite not found." });
  if (invite.status === status) return res.json({ ok: true, discord: { sent: false, skipped: true, unchanged: true } });
  if (status === "accepted") {
    const conflicts = eventConflicts(
      req.user.id,
      req.groupId,
      activeEvent.startsAtUtc,
      activeEvent.endsAtUtc,
      eventId
    );
    if (conflicts.length > 0 && req.body.force !== true) {
      return res.status(409).json({
        error: "This overlaps another event you have accepted.",
        code: "EVENT_CONFLICT",
        conflicts: eventsForTimezone(conflicts, req.user.timezone)
      });
    }
    const capacity = db.prepare(`
      SELECT e.max_players AS maxPlayers,
             SUM(CASE WHEN ei.status = 'accepted' THEN 1 ELSE 0 END) AS accepted
      FROM events e
      LEFT JOIN event_invites ei ON ei.event_id = e.id
      WHERE e.id = ?
      GROUP BY e.id
    `).get(eventId);
    if (capacity && capacity.accepted >= capacity.maxPlayers) status = "waitlisted";
  }

  db.prepare("UPDATE event_invites SET status = ? WHERE event_id = ? AND user_id = ?").run(status, eventId, req.user.id);
  db.prepare("UPDATE events SET updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(eventId);
  const promotedUserId = invite.status === "accepted" && status !== "accepted" ? promoteWaitlist(eventId) : null;
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
  if (status === "accepted") await announceReadyIfNeeded(eventId);
  audit(req.user.id, `event.rsvp.${status}`, "event", eventId, {}, req.groupId);
  res.status(status === "waitlisted" ? 202 : 200).json({ ok: true, status, promotedUserId, discord });
});

app.delete("/api/events/:id/invites/me", requireAuth, async (req, res) => {
  const eventId = Number(req.params.id);
  const invite = db
    .prepare(`
      SELECT ei.status, e.owner_id AS ownerId, e.title, e.date, e.start_time AS startTime,
             e.end_time AS endTime, owner.display_name AS ownerName,
             COALESCE(e.game_title, g.title) AS gameTitle
      FROM event_invites ei
      JOIN events e ON e.id = ei.event_id
      JOIN users owner ON owner.id = e.owner_id
      LEFT JOIN games g ON g.id = e.game_id
      WHERE ei.event_id = ? AND ei.user_id = ? AND e.group_id = ?
    `)
    .get(eventId, req.user.id, req.groupId);
  if (!invite) return res.status(404).json({ error: "You are not part of this event." });
  if (invite.ownerId === req.user.id) {
    return res.status(409).json({ error: "Event creators must delete the event instead of leaving it." });
  }

  db.transaction(() => {
    db.prepare("DELETE FROM event_game_votes WHERE event_id = ? AND user_id = ?").run(eventId, req.user.id);
    db.prepare("DELETE FROM event_invites WHERE event_id = ? AND user_id = ?").run(eventId, req.user.id);
    db.prepare(`
      UPDATE events
      SET updated_at = CURRENT_TIMESTAMP,
          ready_announced = CASE
            WHEN (
              SELECT COUNT(*)
              FROM event_invites
              WHERE event_id = ? AND status = 'accepted'
            ) < min_players THEN 0
            ELSE ready_announced
          END
      WHERE id = ?
    `).run(eventId, eventId);
  })();
  const promotedUserId = promoteWaitlist(eventId);

  const discord = await notifyDiscord("inviteResponse", {
    actor: req.user.display_name,
    status: "left",
    title: invite.title,
    game: invite.gameTitle || "TBD",
    date: invite.date,
    startTime: invite.startTime,
    endTime: invite.endTime,
    owner: invite.ownerName
  }, {
    fields: [
      { name: "Game", value: invite.gameTitle || "TBD", inline: true },
      { name: "When", value: `${invite.date}, ${invite.startTime} - ${invite.endTime}`, inline: true },
      { name: "Host", value: invite.ownerName, inline: true }
    ],
    color: 0x7c8790
  });
  audit(req.user.id, "event.left", "event", eventId, { promotedUserId }, req.groupId);
  res.json({ ok: true, promotedUserId, discord });
});

app.patch("/api/events/:id", requireAuth, (req, res) => {
  const eventId = Number(req.params.id);
  const event = eventInActiveGroup(eventId, req.groupId);
  if (!event) return res.status(404).json({ error: "Event not found." });
  if (event.ownerId !== req.user.id && req.user.role !== "admin") return res.status(403).json({ error: "Only the creator or an admin can reschedule this event." });

  const date = cleanText(req.body.date);
  const startTime = cleanText(req.body.startTime);
  const endTime = cleanText(req.body.endTime);
  if (!isDateString(date) || !isTimeString(startTime) || !isTimeString(endTime) || startTime >= endTime) {
    return res.status(400).json({ error: "Event date or time is invalid." });
  }
  const range = utcEventRange(date, startTime, endTime, event.timezone || req.group.timezone);
  if (!range) return res.status(400).json({ error: "Event date or time is invalid in the squad timezone." });
  db.prepare(`
    UPDATE events
    SET date = ?, start_time = ?, end_time = ?, starts_at_utc = ?, ends_at_utc = ?,
        ready_announced = 0, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `)
    .run(date, startTime, endTime, range.startsAtUtc, range.endsAtUtc, eventId);
  audit(req.user.id, "event.rescheduled", "event", eventId, { date, startTime, endTime }, req.groupId);
  res.json({ ok: true });
});

app.post("/api/events/:id/votes", requireAuth, (req, res) => {
  const eventId = Number(req.params.id);
  const optionId = Number(req.body.optionId);
  const activeEvent = eventInActiveGroup(eventId, req.groupId);
  if (!activeEvent) return res.status(404).json({ error: "Event not found." });
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
  const event = eventInActiveGroup(eventId, req.groupId);
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
  db.prepare(`
    UPDATE events
    SET selected_game_option_id = ?, steam_app_id = ?, game_title = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `)
    .run(chosen.id, chosen.steamAppId || null, chosen.title, eventId);
  res.json({ ok: true, chosen });
});

app.get("/api/events/:id/comments", requireAuth, (req, res) => {
  const eventId = Number(req.params.id);
  if (!eventInActiveGroup(eventId, req.groupId)) return res.status(404).json({ error: "Event not found." });
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
  if (!eventInActiveGroup(eventId, req.groupId)) return res.status(404).json({ error: "Event not found." });
  const body = cleanText(req.body.body);
  const invited = db.prepare("SELECT 1 FROM event_invites WHERE event_id = ? AND user_id = ?").get(eventId, req.user.id);
  if (!invited && req.user.role !== "admin") return res.status(403).json({ error: "Only invited players can comment." });
  if (!body || body.length > 1000) return res.status(400).json({ error: "Comment must be 1-1000 characters." });
  const result = db.prepare("INSERT INTO event_comments (event_id, user_id, body) VALUES (?, ?, ?)").run(eventId, req.user.id, body);
  res.status(201).json({ id: result.lastInsertRowid });
});

app.delete("/api/events/:eventId/comments/:commentId", requireAuth, (req, res) => {
  if (!eventInActiveGroup(Number(req.params.eventId), req.groupId)) return res.status(404).json({ error: "Event not found." });
  const comment = db.prepare("SELECT user_id AS userId FROM event_comments WHERE id = ? AND event_id = ?")
    .get(Number(req.params.commentId), Number(req.params.eventId));
  if (!comment) return res.status(404).json({ error: "Comment not found." });
  if (comment.userId !== req.user.id && req.user.role !== "admin") return res.status(403).json({ error: "Only the author or an admin can delete this comment." });
  db.prepare("DELETE FROM event_comments WHERE id = ?").run(Number(req.params.commentId));
  res.json({ ok: true });
});

app.get("/api/events/:id/ics", requireAuth, (req, res) => {
  const eventId = Number(req.params.id);
  if (!eventInActiveGroup(eventId, req.groupId)) return res.status(404).json({ error: "Event not found." });
  const invited = db.prepare("SELECT 1 FROM event_invites WHERE event_id = ? AND user_id = ?").get(eventId, req.user.id);
  if (!invited && req.user.role !== "admin") return res.status(403).json({ error: "Only invited players can export this event." });
  const event = eventRows("WHERE e.id = ?", [eventId], req.groupId)[0];
  if (!event) return res.status(404).json({ error: "Event not found." });
  res.setHeader("Content-Type", "text/calendar; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="squadslot-${event.id}.ics"`);
  res.send(eventsToIcs([event], event.title));
});

app.get("/api/calendar.ics", requireAuth, (req, res) => {
  const events = calendarEventsForUser(req.user.id, req.groupId);
  const today = dateString(new Date());
  const availability = calendarAvailabilityForUser(req.user.id, addDateDays(today, -7), addDateDays(today, 120), req.groupId);
  res.setHeader("Content-Type", "text/calendar; charset=utf-8");
  res.setHeader("Content-Disposition", 'attachment; filename="squadslot-calendar.ics"');
  res.send(eventsToIcs(events, `${req.user.display_name} - SquadSlot`, { availability }));
});

app.get("/calendar/:token.ics", (req, res) => {
  const token = cleanText(req.params.token);
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return res.status(404).send("Calendar subscription not found.");

  const subscription = db.prepare(`
    SELECT cs.user_id AS userId, u.display_name AS displayName, u.active_group_id AS groupId
    FROM calendar_subscriptions cs
    JOIN users u ON u.id = cs.user_id
    WHERE cs.token_hash = ?
  `).get(calendarTokenHash(token));
  if (!subscription) return res.status(404).send("Calendar subscription not found.");

  db.prepare("UPDATE calendar_subscriptions SET last_used_at = CURRENT_TIMESTAMP WHERE user_id = ?")
    .run(subscription.userId);
  const sourceUrl = calendarSubscriptionUrls(req, token).httpsUrl;
  const events = calendarEventsForUser(subscription.userId, subscription.groupId);
  const today = dateString(new Date());
  const availability = calendarAvailabilityForUser(
    subscription.userId,
    addDateDays(today, -7),
    addDateDays(today, 120),
    subscription.groupId
  );
  res.setHeader("Content-Type", "text/calendar; charset=utf-8");
  res.setHeader("Content-Disposition", 'inline; filename="squadslot-live.ics"');
  res.setHeader("Cache-Control", "private, no-cache, max-age=0");
  res.setHeader("X-Robots-Tag", "noindex, nofollow");
  res.send(eventsToIcs(events, `${subscription.displayName} - SquadSlot`, { sourceUrl, availability }));
});

app.delete("/api/events/:id", requireAuth, async (req, res) => {
  const eventId = Number(req.params.id);
  const event = db
    .prepare(`
      SELECT e.id, e.owner_id AS ownerId, e.title, e.date, e.start_time AS startTime,
             e.end_time AS endTime, COALESCE(e.game_title, g.title) AS gameTitle
      FROM events e
      LEFT JOIN games g ON g.id = e.game_id
      WHERE e.id = ? AND e.group_id = ?
    `)
    .get(eventId, req.groupId);
  if (!event) return res.status(404).json({ error: "Event not found." });
  if (event.ownerId !== req.user.id && req.user.role !== "admin") {
    return res.status(403).json({ error: "Only the creator or an admin can remove this event." });
  }

  db.prepare("DELETE FROM events WHERE id = ?").run(eventId);
  audit(req.user.id, "event.deleted", "event", eventId, { title: event.title }, req.groupId);
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
  const rsvpDeadlineInput = cleanText(req.body.rsvpDeadline) || null;
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
  const rsvpDateTime = rsvpDeadlineInput ? DateTime.fromISO(rsvpDeadlineInput, { zone: req.group.timezone }) : null;
  if (rsvpDateTime && !rsvpDateTime.isValid) return res.status(400).json({ error: "RSVP deadline is invalid." });
  const rsvpDeadline = rsvpDateTime ? rsvpDateTime.toUTC().toISO() : null;

  const range = utcEventRange(date, startTime, endTime, req.group.timezone);
  if (!range) return res.status(400).json({ error: "Event date or time is invalid in the squad timezone." });
  const validInviteIds = inviteIds.length
    ? db.prepare(`
      SELECT user_id AS userId FROM group_members
      WHERE group_id = ? AND user_id IN (${inviteIds.map(() => "?").join(",")})
    `).all(req.groupId, ...inviteIds).map((row) => row.userId)
    : [];
  if (validInviteIds.length !== new Set(inviteIds).size) {
    return res.status(400).json({ error: "Every invitee must be a member of the active squad." });
  }

  const create = db.transaction(() => {
    const result = db
      .prepare(`
        INSERT INTO events (
          group_id, owner_id, steam_app_id, game_title, title, date, start_time, end_time, notes,
          min_players, max_players, rsvp_deadline, timezone, starts_at_utc, ends_at_utc
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        req.groupId, req.user.id, steamAppId, gameTitle, title, date, startTime, endTime,
        notes, minPlayers, maxPlayers, rsvpDeadline, req.group.timezone, range.startsAtUtc, range.endsAtUtc
      );
    const invite = db.prepare("INSERT OR IGNORE INTO event_invites (event_id, user_id, status) VALUES (?, ?, ?)");
    invite.run(result.lastInsertRowid, req.user.id, "accepted");
    for (const id of validInviteIds) invite.run(result.lastInsertRowid, id, "invited");
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
      db.prepare(`
        UPDATE events
        SET selected_game_option_id = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(firstOptionId, result.lastInsertRowid);
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
  const invitees = validInviteIds.length
    ? db.prepare(`SELECT display_name AS displayName FROM users WHERE id IN (${validInviteIds.map(() => "?").join(",")})`).all(...validInviteIds)
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
    color: 0xff6b55,
    components: [{
      type: 1,
      components: [
        { type: 2, style: 3, label: "Accept", custom_id: `event:${eventId}:accepted` },
        { type: 2, style: 1, label: "Tentative", custom_id: `event:${eventId}:tentative` },
        { type: 2, style: 4, label: "Decline", custom_id: `event:${eventId}:declined` }
      ]
    }]
  });

  audit(req.user.id, "event.created", "event", eventId, { title, inviteCount: validInviteIds.length }, req.groupId);

  res.status(201).json({ id: eventId, discord });
});

app.get("/api/proposals", requireAuth, (req, res) => {
  res.json({ proposals: proposalRows(req.groupId, req.user.timezone) });
});

app.post("/api/proposals", requireAuth, (req, res) => {
  const title = cleanText(req.body.title).slice(0, 120);
  const notes = cleanText(req.body.notes).slice(0, 1000);
  const slots = Array.isArray(req.body.slots) ? req.body.slots.slice(0, 12) : [];
  const games = Array.isArray(req.body.games) ? req.body.games.slice(0, 12) : [];
  const inviteIds = Array.isArray(req.body.inviteIds) ? [...new Set(req.body.inviteIds.map(Number).filter(Boolean))] : [];
  if (!title || slots.length < 1) return res.status(400).json({ error: "A title and at least one time option are required." });

  const parsedSlots = slots.map((slot) => {
    const date = cleanText(slot.date);
    const startTime = cleanText(slot.startTime);
    const endTime = cleanText(slot.endTime);
    if (!isDateString(date) || !isTimeString(startTime) || !isTimeString(endTime)) return null;
    const range = utcEventRange(date, startTime, endTime, req.group.timezone);
    return range ? { ...range, label: cleanText(slot.label).slice(0, 80) } : null;
  });
  if (parsedSlots.some((slot) => !slot)) return res.status(400).json({ error: "One or more proposal times are invalid." });
  const parsedGames = games.map((game) => ({
    steamAppId: Number(game.steamAppId) || null,
    title: cleanText(game.title).slice(0, 160),
    imageUrl: cleanText(game.imageUrl).slice(0, 500)
  })).filter((game) => game.title);
  const members = inviteIds.length
    ? db.prepare(`SELECT user_id AS userId FROM group_members WHERE group_id = ? AND user_id IN (${inviteIds.map(() => "?").join(",")})`)
      .all(req.groupId, ...inviteIds).map((row) => row.userId)
    : [];
  if (members.length !== inviteIds.length) return res.status(400).json({ error: "Every invitee must be in the active squad." });

  const proposalId = db.transaction(() => {
    const result = db.prepare("INSERT INTO event_proposals (group_id, owner_id, title, notes) VALUES (?, ?, ?, ?)")
      .run(req.groupId, req.user.id, title, notes);
    const addSlot = db.prepare(`
      INSERT INTO proposal_slots (proposal_id, starts_at_utc, ends_at_utc, timezone, label)
      VALUES (?, ?, ?, ?, ?)
    `);
    for (const slot of parsedSlots) addSlot.run(result.lastInsertRowid, slot.startsAtUtc, slot.endsAtUtc, req.group.timezone, slot.label);
    const addGame = db.prepare("INSERT INTO proposal_games (proposal_id, steam_app_id, title, image_url) VALUES (?, ?, ?, ?)");
    for (const game of parsedGames) addGame.run(result.lastInsertRowid, game.steamAppId, game.title, game.imageUrl);
    const invite = db.prepare("INSERT INTO proposal_invites (proposal_id, user_id) VALUES (?, ?)");
    for (const userId of new Set([req.user.id, ...members])) invite.run(result.lastInsertRowid, userId);
    return result.lastInsertRowid;
  })();
  audit(req.user.id, "proposal.created", "proposal", proposalId, { title }, req.groupId);
  res.status(201).json({ id: proposalId });
});

app.put("/api/proposals/:id/vote", requireAuth, (req, res) => {
  const proposalId = Number(req.params.id);
  const proposal = db.prepare("SELECT id, status FROM event_proposals WHERE id = ? AND group_id = ?")
    .get(proposalId, req.groupId);
  if (!proposal) return res.status(404).json({ error: "Proposal not found." });
  if (proposal.status !== "open") return res.status(409).json({ error: "This proposal is already closed." });
  const slotId = req.body.slotId ? Number(req.body.slotId) : null;
  const gameId = req.body.gameId ? Number(req.body.gameId) : null;
  if (slotId && !db.prepare("SELECT 1 FROM proposal_slots WHERE id = ? AND proposal_id = ?").get(slotId, proposalId)) {
    return res.status(400).json({ error: "Time option is invalid." });
  }
  if (gameId && !db.prepare("SELECT 1 FROM proposal_games WHERE id = ? AND proposal_id = ?").get(gameId, proposalId)) {
    return res.status(400).json({ error: "Game option is invalid." });
  }
  const current = db.prepare("SELECT slot_id AS slotId, game_id AS gameId FROM proposal_votes WHERE proposal_id = ? AND user_id = ?")
    .get(proposalId, req.user.id);
  db.prepare(`
    INSERT INTO proposal_votes (proposal_id, user_id, slot_id, game_id)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(proposal_id, user_id) DO UPDATE SET
      slot_id = excluded.slot_id, game_id = excluded.game_id, updated_at = CURRENT_TIMESTAMP
  `).run(proposalId, req.user.id, slotId ?? current?.slotId ?? null, gameId ?? current?.gameId ?? null);
  res.json({ ok: true });
});

app.post("/api/proposals/:id/finalize", requireAuth, (req, res) => {
  const proposalId = Number(req.params.id);
  const proposal = db.prepare(`
    SELECT id, owner_id AS ownerId, title, notes, status FROM event_proposals
    WHERE id = ? AND group_id = ?
  `).get(proposalId, req.groupId);
  if (!proposal) return res.status(404).json({ error: "Proposal not found." });
  if (proposal.ownerId !== req.user.id && req.user.role !== "admin") return res.status(403).json({ error: "Only the organiser or an admin can finalize this proposal." });
  if (proposal.status !== "open") return res.status(409).json({ error: "This proposal is already closed." });

  const slots = db.prepare(`
    SELECT s.*, COUNT(v.user_id) AS voteCount FROM proposal_slots s
    LEFT JOIN proposal_votes v ON v.slot_id = s.id WHERE s.proposal_id = ? GROUP BY s.id
  `).all(proposalId);
  const games = db.prepare(`
    SELECT g.*, COUNT(v.user_id) AS voteCount FROM proposal_games g
    LEFT JOIN proposal_votes v ON v.game_id = g.id WHERE g.proposal_id = ? GROUP BY g.id
  `).all(proposalId);
  const chooseTop = (items) => {
    if (!items.length) return null;
    const top = Math.max(...items.map((item) => item.voteCount));
    const tied = items.filter((item) => item.voteCount === top);
    return tied[Math.floor(Math.random() * tied.length)];
  };
  const slot = chooseTop(slots);
  const game = chooseTop(games);
  const localStart = DateTime.fromISO(slot.starts_at_utc, { zone: "utc" }).setZone(req.group.timezone);
  const localEnd = DateTime.fromISO(slot.ends_at_utc, { zone: "utc" }).setZone(req.group.timezone);
  const inviteIds = db.prepare("SELECT user_id AS userId FROM proposal_invites WHERE proposal_id = ?").all(proposalId).map((row) => row.userId);
  const minPlayers = Number(req.body.minPlayers || 2);
  const maxPlayers = Number(req.body.maxPlayers || Math.max(4, inviteIds.length));
  if (!Number.isInteger(minPlayers) || !Number.isInteger(maxPlayers) || minPlayers < 1 || maxPlayers < minPlayers || maxPlayers > 100) {
    return res.status(400).json({ error: "Player capacity is invalid." });
  }

  const eventId = db.transaction(() => {
    const result = db.prepare(`
      INSERT INTO events (
        group_id, owner_id, steam_app_id, game_title, title, date, start_time, end_time, notes,
        min_players, max_players, timezone, starts_at_utc, ends_at_utc
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      req.groupId, proposal.ownerId, game?.steam_app_id || null, game?.title || null,
      proposal.title, localStart.toISODate(), localStart.toFormat("HH:mm"), localEnd.toFormat("HH:mm"), proposal.notes,
      minPlayers, maxPlayers, req.group.timezone, slot.starts_at_utc, slot.ends_at_utc
    );
    const invite = db.prepare("INSERT INTO event_invites (event_id, user_id, status) VALUES (?, ?, ?)");
    for (const userId of new Set([proposal.ownerId, ...inviteIds])) invite.run(result.lastInsertRowid, userId, userId === proposal.ownerId ? "accepted" : "invited");
    const addGame = db.prepare("INSERT INTO event_game_options (event_id, steam_app_id, title, image_url) VALUES (?, ?, ?, ?)");
    let selectedOptionId = null;
    for (const option of games) {
      const inserted = addGame.run(result.lastInsertRowid, option.steam_app_id, option.title, option.image_url || "");
      if (option.id === game?.id) selectedOptionId = inserted.lastInsertRowid;
    }
    if (selectedOptionId) db.prepare("UPDATE events SET selected_game_option_id = ? WHERE id = ?").run(selectedOptionId, result.lastInsertRowid);
    db.prepare("UPDATE event_proposals SET status = 'finalized', finalized_event_id = ? WHERE id = ?")
      .run(result.lastInsertRowid, proposalId);
    return result.lastInsertRowid;
  })();
  audit(req.user.id, "proposal.finalized", "proposal", proposalId, { eventId }, req.groupId);
  res.status(201).json({ ok: true, eventId });
});

app.delete("/api/proposals/:id", requireAuth, (req, res) => {
  const proposalId = Number(req.params.id);
  const proposal = db.prepare("SELECT owner_id AS ownerId FROM event_proposals WHERE id = ? AND group_id = ?")
    .get(proposalId, req.groupId);
  if (!proposal) return res.status(404).json({ error: "Proposal not found." });
  if (proposal.ownerId !== req.user.id && req.user.role !== "admin") return res.status(403).json({ error: "Only the organiser or an admin can remove this proposal." });
  db.prepare("DELETE FROM event_proposals WHERE id = ?").run(proposalId);
  audit(req.user.id, "proposal.deleted", "proposal", proposalId, {}, req.groupId);
  res.json({ ok: true });
});

app.get("/api/dashboard", requireAuth, (req, res) => {
  const nowKey = currentDateTimeKey();
  const today = DateTime.now().setZone(req.group.timezone).toISODate();
  const weekEnd = addDateDays(today, 6);
  const rawEvents = eventRows("", [], req.groupId).filter((event) => isUpcomingEvent(event, nowKey));
  const events = eventsForTimezone(rawEvents, req.user.timezone);
  const myEvents = events.filter((event) => (
    event.ownerId === req.user.id
    || event.invites.some((invite) => invite.userId === req.user.id && ["accepted", "tentative"].includes(invite.status))
  ));
  const nextEvent = myEvents[0] || null;
  const pendingInvites = events.filter((event) => (
    event.invites.some((invite) => invite.userId === req.user.id && invite.status === "invited")
  ));
  const suggestions = db.prepare(`
    SELECT s.id, s.steam_app_id AS steamAppId, s.title, s.image_url AS imageUrl,
           s.created_at AS createdAt, u.display_name AS suggestedBy
    FROM game_suggestions s
    JOIN users u ON u.id = s.user_id
    WHERE s.group_id = ?
    ORDER BY s.created_at DESC
    LIMIT 8
  `).all(req.groupId);
  const todayAvailability = expandAvailability(today, today, req.groupId);
  const tonightEvents = events.filter((event) => event.date === today);

  res.json({
    dashboard: {
      nextEvent,
      pendingInviteCount: pendingInvites.length,
      pendingInvites: pendingInvites.slice(0, 4),
      bestSlots: findBestSlots(today, weekEnd, null, req.groupId),
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
             u.must_change_password AS mustChangePassword,
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
  audit(req.user.id, "account.role_changed", "user", userId, { role });
  res.json({ ok: true });
});

app.put("/api/admin/users/:id/password", requireAdmin, (req, res) => {
  const userId = Number(req.params.id);
  const temporaryPassword = String(req.body.temporaryPassword ?? "");
  const account = db.prepare("SELECT id, display_name AS displayName FROM users WHERE id = ?").get(userId);

  if (!account) return res.status(404).json({ error: "Account not found." });
  if (userId === req.user.id) {
    return res.status(400).json({ error: "The signed-in admin password cannot be reset from account management." });
  }
  if (temporaryPassword.length < 8 || temporaryPassword.length > 128) {
    return res.status(400).json({ error: "Temporary password must be 8-128 characters." });
  }

  const passwordHash = bcrypt.hashSync(temporaryPassword, 12);
  db.prepare(`
    UPDATE users
    SET password_hash = ?, must_change_password = 1, session_version = session_version + 1
    WHERE id = ?
  `).run(passwordHash, userId);

  audit(req.user.id, "account.password_reset", "user", userId, {});
  res.json({ ok: true, userId, displayName: account.displayName, mustChangePassword: true });
});

app.get("/api/admin/settings", requireAdmin, (_req, res) => {
  const appUrl = getSetting("appUrl", process.env.APP_URL || "http://localhost:8080");
  res.json({
    settings: {
      appUrl,
      discordWebhookUrl: getSetting("discordWebhookUrl", process.env.DISCORD_WEBHOOK_URL || ""),
      discordBotName: getSetting("discordBotName", process.env.DISCORD_BOT_NAME || "SquadSlot"),
      discordApplicationId: getSetting("discordApplicationId", process.env.DISCORD_APPLICATION_ID || ""),
      discordPublicKey: getSetting("discordPublicKey", process.env.DISCORD_PUBLIC_KEY || ""),
      discordChannelId: getSetting("discordChannelId", process.env.DISCORD_CHANNEL_ID || ""),
      discordBotTokenConfigured: Boolean(getSetting("discordBotToken", process.env.DISCORD_BOT_TOKEN || "")),
      discordInteractionUrl: `${appUrl.replace(/\/+$/, "")}/discord/interactions`
    }
  });
});

app.put("/api/admin/settings", requireAdmin, (req, res) => {
  const appUrl = cleanText(req.body.appUrl);
  const discordWebhookUrl = cleanText(req.body.discordWebhookUrl);
  const discordBotName = cleanText(req.body.discordBotName, "SquadSlot") || "SquadSlot";
  const discordApplicationId = cleanText(req.body.discordApplicationId);
  const discordPublicKey = cleanText(req.body.discordPublicKey);
  const discordChannelId = cleanText(req.body.discordChannelId);
  const discordBotToken = cleanText(req.body.discordBotToken);

  if (!isValidHttpUrl(appUrl)) return res.status(400).json({ error: "App URL must be http or https." });
  if (!isValidDiscordWebhookUrl(discordWebhookUrl)) return res.status(400).json({ error: "Discord webhook URL must be a Discord webhook URL." });
  if (discordBotName.length > 80) return res.status(400).json({ error: "Discord bot name is too long." });
  if (discordApplicationId && !/^\d{15,22}$/.test(discordApplicationId)) return res.status(400).json({ error: "Discord application ID is invalid." });
  if (discordChannelId && !/^\d{15,22}$/.test(discordChannelId)) return res.status(400).json({ error: "Discord channel ID is invalid." });
  if (discordPublicKey && !/^[0-9a-f]{64}$/i.test(discordPublicKey)) return res.status(400).json({ error: "Discord public key must be 64 hexadecimal characters." });
  if (discordBotToken.length > 300) return res.status(400).json({ error: "Discord bot token is invalid." });

  if (appUrl) setSetting("appUrl", appUrl);
  setSetting("discordWebhookUrl", discordWebhookUrl);
  setSetting("discordBotName", discordBotName);
  setSetting("discordApplicationId", discordApplicationId);
  setSetting("discordPublicKey", discordPublicKey);
  setSetting("discordChannelId", discordChannelId);
  if (discordBotToken) setSetting("discordBotToken", discordBotToken);
  if (req.body.clearDiscordBotToken === true) setSetting("discordBotToken", "");

  audit(req.user.id, "settings.discord_updated", "settings", "discord", {});
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
    audit(req.user.id, "settings.notifications_updated", "settings", "notifications", {});
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
    audit(req.user.id, "settings.reminders_updated", "settings", "reminders", {});
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
  const backup = backupPayload();

  res.setHeader("Content-Type", "application/json");
  res.setHeader("Content-Disposition", `attachment; filename="squadslot-backup-${backup.exportedAt.slice(0, 10)}.json"`);
  res.json(backup);
});

app.post("/api/admin/backup/restore", requireAdmin, (req, res) => {
  try {
    const tables = validateBackup(req.body);
    restoreBackupTables(tables);
    audit(req.user.id, "backup.restored", "backup", "upload", {});
    res.json({ ok: true });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.get("/api/admin/backups", requireAdmin, (_req, res) => {
  res.json({
    backups: backupFiles(),
    config: {
      enabled: automaticBackupsEnabled,
      encrypted: Boolean(process.env.BACKUP_ENCRYPTION_KEY),
      intervalHours: backupIntervalHours,
      retention: backupRetention
    }
  });
});

app.post("/api/admin/backups/run", requireAdmin, (req, res) => {
  try {
    res.status(201).json({ ok: true, backup: createEncryptedBackup(req.user.id) });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.get("/api/admin/backups/:name", requireAdmin, (req, res) => {
  try {
    const file = safeBackupPath(req.params.name);
    if (!fs.existsSync(file)) return res.status(404).json({ error: "Backup not found." });
    res.download(file, req.params.name);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.post("/api/admin/backups/:name/restore", requireAdmin, (req, res) => {
  try {
    const file = safeBackupPath(req.params.name);
    if (!fs.existsSync(file)) return res.status(404).json({ error: "Backup not found." });
    const payload = decryptBackup(fs.readFileSync(file, "utf8"));
    const tables = validateBackup(payload);
    restoreBackupTables(tables);
    audit(req.user.id, "backup.restored", "backup", req.params.name, {});
    res.json({ ok: true });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.get("/api/admin/audit", requireAdmin, (req, res) => {
  const limit = Math.min(500, Math.max(1, Number(req.query.limit || 200)));
  const entries = db.prepare(`
    SELECT a.id, a.group_id AS groupId, a.action, a.target_type AS targetType,
           a.target_id AS targetId, a.details, a.created_at AS createdAt,
           COALESCE(u.display_name, 'System') AS actorName
    FROM audit_log a LEFT JOIN users u ON u.id = a.actor_id
    ORDER BY a.id DESC LIMIT ?
  `).all(limit).map((entry) => {
    try {
      return { ...entry, details: JSON.parse(entry.details || "{}") };
    } catch {
      return { ...entry, details: {} };
    }
  });
  res.json({ entries });
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

if (automaticBackupsEnabled) {
  const runBackup = () => {
    try {
      createEncryptedBackup();
    } catch (error) {
      console.error("Automatic backup failed:", error.message);
    }
  };
  runBackup();
  const backupTimer = setInterval(runBackup, backupIntervalHours * 60 * 60 * 1000);
  backupTimer.unref();
}
