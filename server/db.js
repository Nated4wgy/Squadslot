import Database from "better-sqlite3";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { DateTime } from "luxon";

const dbPath = process.env.DATABASE_PATH || path.join(process.cwd(), "data", "squadslot.db");

function openDatabase() {
  try {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    return new Database(dbPath);
  } catch (error) {
    const startupError = new Error(
      `Unable to open SQLite database at ${dbPath}. Check that the Docker /data volume or bind mount is writable by the container. Original error: ${error.message}`
    );
    startupError.cause = error;
    throw startupError;
  }
}

export const db = openDatabase();
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
  CREATE TABLE IF NOT EXISTS groups (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    invite_code TEXT NOT NULL UNIQUE,
    timezone TEXT NOT NULL DEFAULT 'Europe/London',
    created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE COLLATE NOCASE,
    display_name TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'user',
    password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS calendar_subscriptions (
    user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    token_hash TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_used_at TEXT
  );

  CREATE TABLE IF NOT EXISTS availability (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    date TEXT NOT NULL,
    start_time TEXT NOT NULL,
    end_time TEXT NOT NULL,
    note TEXT DEFAULT '',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS games (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL UNIQUE COLLATE NOCASE,
    genre TEXT NOT NULL DEFAULT 'Co-op',
    max_players INTEGER NOT NULL DEFAULT 4,
    suggested_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    game_id INTEGER REFERENCES games(id) ON DELETE SET NULL,
    steam_app_id INTEGER,
    game_title TEXT,
    title TEXT NOT NULL,
    date TEXT NOT NULL,
    start_time TEXT NOT NULL,
    end_time TEXT NOT NULL,
    notes TEXT DEFAULT '',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS event_invites (
    event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'invited',
    PRIMARY KEY (event_id, user_id)
  );

  CREATE TABLE IF NOT EXISTS group_members (
    group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role TEXT NOT NULL DEFAULT 'member',
    joined_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (group_id, user_id)
  );

  CREATE TABLE IF NOT EXISTS app_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS availability_rules (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    weekday INTEGER NOT NULL CHECK (weekday BETWEEN 0 AND 6),
    start_time TEXT NOT NULL,
    end_time TEXT NOT NULL,
    note TEXT DEFAULT '',
    start_date TEXT NOT NULL,
    end_date TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS availability_exceptions (
    rule_id INTEGER NOT NULL REFERENCES availability_rules(id) ON DELETE CASCADE,
    date TEXT NOT NULL,
    PRIMARY KEY (rule_id, date)
  );

  CREATE TABLE IF NOT EXISTS availability_presets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    weekday INTEGER CHECK (weekday BETWEEN 0 AND 6),
    start_time TEXT NOT NULL,
    end_time TEXT NOT NULL,
    note TEXT DEFAULT '',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS event_game_options (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    steam_app_id INTEGER,
    title TEXT NOT NULL,
    image_url TEXT DEFAULT '',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS event_game_votes (
    event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    option_id INTEGER NOT NULL REFERENCES event_game_options(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (event_id, user_id)
  );

  CREATE TABLE IF NOT EXISTS event_comments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    body TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS game_suggestions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    steam_app_id INTEGER NOT NULL,
    title TEXT NOT NULL,
    image_url TEXT DEFAULT '',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS reminder_log (
    reminder_key TEXT PRIMARY KEY,
    sent_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS event_proposals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
    owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    notes TEXT DEFAULT '',
    status TEXT NOT NULL DEFAULT 'open',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    finalized_event_id INTEGER REFERENCES events(id) ON DELETE SET NULL
  );

  CREATE TABLE IF NOT EXISTS proposal_slots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    proposal_id INTEGER NOT NULL REFERENCES event_proposals(id) ON DELETE CASCADE,
    starts_at_utc TEXT NOT NULL,
    ends_at_utc TEXT NOT NULL,
    timezone TEXT NOT NULL,
    label TEXT DEFAULT ''
  );

  CREATE TABLE IF NOT EXISTS proposal_games (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    proposal_id INTEGER NOT NULL REFERENCES event_proposals(id) ON DELETE CASCADE,
    steam_app_id INTEGER,
    title TEXT NOT NULL,
    image_url TEXT DEFAULT ''
  );

  CREATE TABLE IF NOT EXISTS proposal_invites (
    proposal_id INTEGER NOT NULL REFERENCES event_proposals(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    PRIMARY KEY (proposal_id, user_id)
  );

  CREATE TABLE IF NOT EXISTS proposal_votes (
    proposal_id INTEGER NOT NULL REFERENCES event_proposals(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    slot_id INTEGER REFERENCES proposal_slots(id) ON DELETE CASCADE,
    game_id INTEGER REFERENCES proposal_games(id) ON DELETE CASCADE,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (proposal_id, user_id)
  );

  CREATE TABLE IF NOT EXISTS audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    group_id INTEGER REFERENCES groups(id) ON DELETE SET NULL,
    actor_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    action TEXT NOT NULL,
    target_type TEXT NOT NULL,
    target_id TEXT,
    details TEXT DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
`);

const defaultGroup = db.prepare("SELECT id FROM groups ORDER BY id LIMIT 1").get();
if (!defaultGroup) {
  db.prepare("INSERT INTO groups (name, invite_code, timezone) VALUES (?, ?, ?)")
    .run("Main Squad", crypto.randomBytes(12).toString("base64url"), process.env.TZ || "Europe/London");
}
const defaultGroupId = db.prepare("SELECT id FROM groups ORDER BY id LIMIT 1").get().id;

const userColumns = db.prepare("PRAGMA table_info(users)").all().map((column) => column.name);
if (!userColumns.includes("role")) {
  db.exec("ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'user'");
}
if (!userColumns.includes("avatar_url")) {
  db.exec("ALTER TABLE users ADD COLUMN avatar_url TEXT NOT NULL DEFAULT ''");
}
if (!userColumns.includes("timezone")) {
  db.exec("ALTER TABLE users ADD COLUMN timezone TEXT NOT NULL DEFAULT 'Europe/London'");
}
if (!userColumns.includes("favorite_games")) {
  db.exec("ALTER TABLE users ADD COLUMN favorite_games TEXT NOT NULL DEFAULT ''");
}
if (!userColumns.includes("preferred_start")) {
  db.exec("ALTER TABLE users ADD COLUMN preferred_start TEXT NOT NULL DEFAULT '19:00'");
}
if (!userColumns.includes("preferred_end")) {
  db.exec("ALTER TABLE users ADD COLUMN preferred_end TEXT NOT NULL DEFAULT '23:00'");
}
if (!userColumns.includes("profile_color")) {
  db.exec("ALTER TABLE users ADD COLUMN profile_color TEXT NOT NULL DEFAULT '#2fd3ba'");
}
if (!userColumns.includes("theme")) {
  db.exec("ALTER TABLE users ADD COLUMN theme TEXT NOT NULL DEFAULT 'dark'");
}
if (!userColumns.includes("accent")) {
  db.exec("ALTER TABLE users ADD COLUMN accent TEXT NOT NULL DEFAULT '#2fd3ba'");
}
if (!userColumns.includes("discord_username")) {
  db.exec("ALTER TABLE users ADD COLUMN discord_username TEXT NOT NULL DEFAULT ''");
}
if (!userColumns.includes("must_change_password")) {
  db.exec("ALTER TABLE users ADD COLUMN must_change_password INTEGER NOT NULL DEFAULT 0");
}
if (!userColumns.includes("session_version")) {
  db.exec("ALTER TABLE users ADD COLUMN session_version INTEGER NOT NULL DEFAULT 0");
}
if (!userColumns.includes("active_group_id")) {
  db.exec("ALTER TABLE users ADD COLUMN active_group_id INTEGER");
}
if (!userColumns.includes("discord_user_id")) {
  db.exec("ALTER TABLE users ADD COLUMN discord_user_id TEXT NOT NULL DEFAULT ''");
}

const eventColumns = db.prepare("PRAGMA table_info(events)").all().map((column) => column.name);
if (!eventColumns.includes("steam_app_id")) {
  db.exec("ALTER TABLE events ADD COLUMN steam_app_id INTEGER");
}
if (!eventColumns.includes("game_title")) {
  db.exec("ALTER TABLE events ADD COLUMN game_title TEXT");
}
if (!eventColumns.includes("min_players")) {
  db.exec("ALTER TABLE events ADD COLUMN min_players INTEGER NOT NULL DEFAULT 2");
}
if (!eventColumns.includes("max_players")) {
  db.exec("ALTER TABLE events ADD COLUMN max_players INTEGER NOT NULL DEFAULT 8");
}
if (!eventColumns.includes("rsvp_deadline")) {
  db.exec("ALTER TABLE events ADD COLUMN rsvp_deadline TEXT");
}
if (!eventColumns.includes("ready_announced")) {
  db.exec("ALTER TABLE events ADD COLUMN ready_announced INTEGER NOT NULL DEFAULT 0");
}
if (!eventColumns.includes("selected_game_option_id")) {
  db.exec("ALTER TABLE events ADD COLUMN selected_game_option_id INTEGER");
}
if (!eventColumns.includes("updated_at")) {
  db.exec("ALTER TABLE events ADD COLUMN updated_at TEXT");
  db.exec("UPDATE events SET updated_at = created_at WHERE updated_at IS NULL");
}
if (!eventColumns.includes("group_id")) {
  db.exec("ALTER TABLE events ADD COLUMN group_id INTEGER");
}
if (!eventColumns.includes("timezone")) {
  db.exec("ALTER TABLE events ADD COLUMN timezone TEXT");
}
if (!eventColumns.includes("starts_at_utc")) {
  db.exec("ALTER TABLE events ADD COLUMN starts_at_utc TEXT");
}
if (!eventColumns.includes("ends_at_utc")) {
  db.exec("ALTER TABLE events ADD COLUMN ends_at_utc TEXT");
}

for (const table of ["availability", "availability_rules", "availability_presets", "game_suggestions"]) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all().map((column) => column.name);
  if (!columns.includes("group_id")) db.exec(`ALTER TABLE ${table} ADD COLUMN group_id INTEGER`);
}

for (const table of ["availability", "availability_rules"]) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all().map((column) => column.name);
  if (!columns.includes("timezone")) db.exec(`ALTER TABLE ${table} ADD COLUMN timezone TEXT`);
}

db.transaction(() => {
  db.prepare("UPDATE users SET active_group_id = ? WHERE active_group_id IS NULL").run(defaultGroupId);
  db.prepare(`
    INSERT OR IGNORE INTO group_members (group_id, user_id, role)
    SELECT ?, id, CASE WHEN role = 'admin' THEN 'owner' ELSE 'member' END FROM users
  `).run(defaultGroupId);
  for (const table of ["events", "availability", "availability_rules", "availability_presets", "game_suggestions"]) {
    db.prepare(`UPDATE ${table} SET group_id = ? WHERE group_id IS NULL`).run(defaultGroupId);
  }
  db.prepare(`
    UPDATE availability
    SET timezone = COALESCE((SELECT timezone FROM users WHERE users.id = availability.user_id), ?)
    WHERE timezone IS NULL OR timezone = ''
  `).run(process.env.TZ || "Europe/London");
  db.prepare(`
    UPDATE availability_rules
    SET timezone = COALESCE((SELECT timezone FROM users WHERE users.id = availability_rules.user_id), ?)
    WHERE timezone IS NULL OR timezone = ''
  `).run(process.env.TZ || "Europe/London");
})();

const fallbackZone = process.env.TZ || "Europe/London";
const eventsMissingUtc = db.prepare(`
  SELECT e.id, e.date, e.start_time AS startTime, e.end_time AS endTime,
         COALESCE(NULLIF(e.timezone, ''), u.timezone, ?) AS timezone
  FROM events e
  JOIN users u ON u.id = e.owner_id
  WHERE e.starts_at_utc IS NULL OR e.ends_at_utc IS NULL OR e.timezone IS NULL OR e.timezone = ''
`).all(fallbackZone);
const updateEventUtc = db.prepare("UPDATE events SET timezone = ?, starts_at_utc = ?, ends_at_utc = ? WHERE id = ?");
for (const event of eventsMissingUtc) {
  const zone = DateTime.local().setZone(event.timezone).isValid ? event.timezone : fallbackZone;
  const start = DateTime.fromISO(`${event.date}T${event.startTime}`, { zone });
  const end = DateTime.fromISO(`${event.date}T${event.endTime}`, { zone });
  updateEventUtc.run(zone, start.toUTC().toISO(), end.toUTC().toISO(), event.id);
}

db.exec(`
  UPDATE event_invites
  SET status = 'accepted'
  WHERE status = 'invited'
    AND EXISTS (
      SELECT 1 FROM events
      WHERE events.id = event_invites.event_id
        AND events.owner_id = event_invites.user_id
    );

  CREATE INDEX IF NOT EXISTS idx_events_group_utc ON events(group_id, starts_at_utc, ends_at_utc);
  CREATE INDEX IF NOT EXISTS idx_availability_group_date ON availability(group_id, date);
  CREATE INDEX IF NOT EXISTS idx_rules_group_dates ON availability_rules(group_id, start_date, end_date);
  CREATE INDEX IF NOT EXISTS idx_suggestions_group_created ON game_suggestions(group_id, created_at);
  CREATE INDEX IF NOT EXISTS idx_invites_user_status ON event_invites(user_id, status);
  CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_log(created_at);
`);

export function cleanupDemoOnlyDatabase() {
  const users = db.prepare("SELECT username FROM users").all();
  if (users.length === 0) return;

  const demoNames = new Set(["demo", "alex", "jamie"]);
  const containsOnlyDemoUsers = users.every((user) => demoNames.has(user.username));
  if (!containsOnlyDemoUsers) return;

  db.transaction(() => {
    db.prepare("DELETE FROM event_invites").run();
    db.prepare("DELETE FROM events").run();
    db.prepare("DELETE FROM availability").run();
    db.prepare("DELETE FROM availability_rules").run();
    db.prepare("DELETE FROM availability_presets").run();
    db.prepare("DELETE FROM game_suggestions").run();
    db.prepare("DELETE FROM users").run();
    db.prepare("DELETE FROM games").run();
  })();
}

export function getSetting(key, fallback = "") {
  return db.prepare("SELECT value FROM app_settings WHERE key = ?").get(key)?.value ?? fallback;
}

export function setSetting(key, value) {
  db.prepare(`
    INSERT INTO app_settings (key, value)
    VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).run(key, value);
}

export function publicUser(user, includeAuthState = false) {
  if (!user) return null;
  const result = {
    id: user.id,
    username: user.username,
    displayName: user.display_name,
    role: user.role,
    avatarUrl: user.avatar_url || "",
    timezone: user.timezone || "Europe/London",
    favoriteGames: user.favorite_games || "",
    preferredStart: user.preferred_start || "19:00",
    preferredEnd: user.preferred_end || "23:00",
    profileColor: user.profile_color || "#2fd3ba",
    theme: user.theme || "dark",
    accent: user.accent || "#2fd3ba",
    discordUsername: user.discord_username || "",
    discordUserId: user.discord_user_id || "",
    activeGroupId: user.active_group_id || defaultGroupId,
    createdAt: user.created_at
  };
  if (includeAuthState) result.mustChangePassword = Boolean(user.must_change_password);
  return result;
}
