import crypto from "node:crypto";

const COOKIE_NAME = "squadslot_session";
const secret = process.env.SESSION_SECRET || "dev-secret-change-me";

function base64url(input) {
  return Buffer.from(input).toString("base64url");
}

function sign(payload) {
  return crypto.createHmac("sha256", secret).update(payload).digest("base64url");
}

export function createSessionCookie(userId) {
  const payload = base64url(JSON.stringify({ userId, exp: Date.now() + 1000 * 60 * 60 * 24 * 30 }));
  return `${payload}.${sign(payload)}`;
}

export function readSessionCookie(req) {
  const token = req.cookies?.[COOKIE_NAME];
  if (!token) return null;

  const [payload, signature] = token.split(".");
  if (!payload || !signature || sign(payload) !== signature) return null;

  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (!parsed.userId || parsed.exp < Date.now()) return null;
    return parsed.userId;
  } catch {
    return null;
  }
}

export function setSession(res, userId) {
  res.cookie(COOKIE_NAME, createSessionCookie(userId), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 1000 * 60 * 60 * 24 * 30
  });
}

export function clearSession(res) {
  res.clearCookie(COOKIE_NAME);
}
