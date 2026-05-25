import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

const dbPath = process.env.DATABASE_PATH || path.join(process.cwd(), "data", "squadslot.db");
fs.mkdirSync(path.dirname(dbPath), { recursive: true });

export const db = new Database(dbPath);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE COLLATE NOCASE,
    display_name TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'user',
    password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
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
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS event_invites (
    event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'invited',
    PRIMARY KEY (event_id, user_id)
  );

  CREATE TABLE IF NOT EXISTS app_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
`);

const userColumns = db.prepare("PRAGMA table_info(users)").all().map((column) => column.name);
if (!userColumns.includes("role")) {
  db.exec("ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'user'");
}

const eventColumns = db.prepare("PRAGMA table_info(events)").all().map((column) => column.name);
if (!eventColumns.includes("steam_app_id")) {
  db.exec("ALTER TABLE events ADD COLUMN steam_app_id INTEGER");
}
if (!eventColumns.includes("game_title")) {
  db.exec("ALTER TABLE events ADD COLUMN game_title TEXT");
}

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

export function publicUser(user) {
  if (!user) return null;
  return {
    id: user.id,
    username: user.username,
    displayName: user.display_name,
    role: user.role,
    createdAt: user.created_at
  };
}
