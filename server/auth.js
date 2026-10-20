import crypto from "node:crypto";

const COOKIE_NAME = "squadslot_session";
const defaultSecret = "dev-secret-change-me";
const secret = process.env.SESSION_SECRET || defaultSecret;

if (process.env.NODE_ENV === "production" && (secret === defaultSecret || secret.length < 32)) {
  throw new Error("SESSION_SECRET must be set to at least 32 characters in production. Put it in the deployment .env file or pass it to docker run.");
}

function base64url(input) {
  return Buffer.from(input).toString("base64url");
}

function sign(payload) {
  return crypto.createHmac("sha256", secret).update(payload).digest("base64url");
}

export function createSessionCookie(userId, sessionVersion = 0) {
  const payload = base64url(JSON.stringify({
    userId,
    sessionVersion,
    exp: Date.now() + 1000 * 60 * 60 * 24 * 30
  }));
  return `${payload}.${sign(payload)}`;
}

export function readSessionCookie(req) {
  const token = req.cookies?.[COOKIE_NAME];
  if (!token) return null;

  const [payload, signature, extra] = token.split(".");
  if (!payload || !signature || extra !== undefined) return null;
  const expected = Buffer.from(sign(payload));
  const supplied = Buffer.from(signature);
  if (expected.length !== supplied.length || !crypto.timingSafeEqual(expected, supplied)) return null;

  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (!Number.isSafeInteger(parsed.userId) || parsed.userId <= 0
      || !Number.isFinite(parsed.exp) || parsed.exp <= Date.now()
      || !Number.isSafeInteger(parsed.sessionVersion ?? 0) || (parsed.sessionVersion ?? 0) < 0) return null;
    return {
      userId: parsed.userId,
      sessionVersion: Number(parsed.sessionVersion || 0)
    };
  } catch {
    return null;
  }
}

export function setSession(res, userId, sessionVersion = 0) {
  res.cookie(COOKIE_NAME, createSessionCookie(userId, sessionVersion), {
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 1000 * 60 * 60 * 24 * 30
  });
}

export function clearSession(res) {
  res.clearCookie(COOKIE_NAME);
}
