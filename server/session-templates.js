import { randomUUID } from "node:crypto";
import { db, getSetting, setSetting } from "./db.js";

export function addSessionTemplateRoutes(app, requireAuth) {
  const key = req => `sessionTemplates:${req.user.id}:${req.groupId}`;
  const read = req => {
    try { const value = JSON.parse(getSetting(key(req), "[]")); return Array.isArray(value) ? value : []; }
    catch { return []; }
  };
  app.get("/api/session-templates", requireAuth, (req, res) => res.json({ templates: read(req) }));
  app.post("/api/session-templates", requireAuth, (req, res) => {
    const source = req.body;
    const text = (value, max) => typeof value === "string" ? value.trim().slice(0, max) : "";
    const name = text(source.name, 80);
    const title = text(source.title, 160);
    const minPlayers = Number(source.minPlayers), maxPlayers = Number(source.maxPlayers);
    const time = value => typeof value === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
    const steamAppId = source.steamAppId ? Number(source.steamAppId) : null;
    const inviteIds = Array.isArray(source.inviteIds) ? [...new Set(source.inviteIds)] : [];
    if (!name || !title || !time(source.startTime) || !time(source.endTime) || source.startTime === source.endTime
      || !Number.isInteger(minPlayers) || !Number.isInteger(maxPlayers) || minPlayers < 1 || maxPlayers < minPlayers || maxPlayers > 100
      || (steamAppId !== null && (!Number.isSafeInteger(steamAppId) || steamAppId <= 0))
      || inviteIds.length > 100 || inviteIds.some(id => !Number.isSafeInteger(id) || !db.prepare("SELECT 1 FROM group_members WHERE user_id = ? AND group_id = ?").get(id, req.groupId))) {
      return res.status(400).json({ error: "Check the template name, times, players and capacity." });
    }
    const templates = read(req);
    if (templates.length >= 20) return res.status(409).json({ error: "Delete a template before adding another (limit 20)." });
    templates.push({ id: randomUUID(), name, title, startTime: source.startTime, endTime: source.endTime,
      steamAppId, gameTitle: text(source.gameTitle, 160), notes: text(source.notes, 4000), minPlayers, maxPlayers, inviteIds });
    setSetting(key(req), JSON.stringify(templates));
    res.status(201).json({ templates });
  });
  app.delete("/api/session-templates/:id", requireAuth, (req, res) => {
    const templates = read(req).filter(item => item.id !== req.params.id);
    setSetting(key(req), JSON.stringify(templates));
    res.json({ templates });
  });
}
