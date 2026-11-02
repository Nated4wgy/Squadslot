import crypto from "node:crypto";

export const MAX_BACKUP_BYTES = 32 * 1024 * 1024;
const format = "squadslot-encrypted-backup";
const algorithm = "aes-256-gcm";

export function backupEncryptionReady(secret = process.env.BACKUP_ENCRYPTION_KEY) {
  return typeof secret === "string" && secret.trim().length >= 16;
}

function encryptionSecret(secret) {
  if (!backupEncryptionReady(secret)) throw new Error("Set BACKUP_ENCRYPTION_KEY to a separate secret of at least 16 characters before using encrypted backups.");
  return secret;
}

function decode(value, length) {
  if (typeof value !== "string" || !value || value.length > MAX_BACKUP_BYTES) throw new Error("Invalid encrypted backup field.");
  const bytes = Buffer.from(value, "base64");
  if (bytes.toString("base64") !== value || (length !== undefined && bytes.length !== length)) {
    throw new Error("Invalid encrypted backup field.");
  }
  return bytes;
}

export function encryptBackup(payload, secret = process.env.BACKUP_ENCRYPTION_KEY) {
  encryptionSecret(secret);
  const plaintext = JSON.stringify(payload);
  if (Buffer.byteLength(plaintext) > MAX_BACKUP_BYTES * 0.74) throw new Error("Backup exceeds the 32 MB encrypted-file limit.");
  const salt = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12);
  const key = crypto.scryptSync(secret, salt, 32);
  const cipher = crypto.createCipheriv(algorithm, key, iv, { authTagLength: 16 });
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return JSON.stringify({
    format, version: 2, algorithm, kdf: "scrypt",
    salt: salt.toString("base64"), iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"), data: encrypted.toString("base64")
  });
}

export function decryptBackup(contents, secret = process.env.BACKUP_ENCRYPTION_KEY) {
  const text = typeof contents === "string" ? contents : JSON.stringify(contents);
  if (!text || Buffer.byteLength(text) > MAX_BACKUP_BYTES) throw new Error("Backup must be no larger than 32 MB.");
  const envelope = JSON.parse(text);
  if (envelope?.app === "SquadSlot" && !Object.hasOwn(envelope, "format")) return envelope;
  if (envelope?.format !== format || ![1, 2].includes(envelope.version) || envelope.algorithm !== algorithm) {
    throw new Error("Unsupported encrypted backup format or version.");
  }
  encryptionSecret(secret);
  if (envelope.version === 2 && envelope.kdf !== "scrypt") throw new Error("Unsupported backup key derivation.");
  const salt = envelope.version === 1 ? "squadslot-backup-v1" : decode(envelope.salt, 16);
  const iv = decode(envelope.iv, 12);
  const tag = decode(envelope.tag, 16);
  const data = decode(envelope.data);
  const key = crypto.scryptSync(secret, salt, 32);
  try {
    const decipher = crypto.createDecipheriv(algorithm, key, iv, { authTagLength: 16 });
    decipher.setAuthTag(tag);
    return JSON.parse(Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8"));
  } catch {
    throw new Error("Cannot decrypt backup. The encryption key is wrong or the file is damaged.");
  }
}

export function restoreOptions(body) {
  if (body?.confirmRestore !== true) throw new Error("Confirm that restoring replaces all current data and signs everyone out.");
  if (body.revokeCalendarLinks !== undefined && typeof body.revokeCalendarLinks !== "boolean") {
    throw new Error("Calendar link revocation must be true or false.");
  }
  return { revokeCalendarLinks: body.revokeCalendarLinks !== false };
}
