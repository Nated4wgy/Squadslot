import { isIP } from "node:net";

export function normalizeIp(value) {
  if (typeof value !== "string") return "";
  const ip = value.startsWith("::ffff:") ? value.slice(7) : value;
  if (!isIP(ip)) return "";
  return isIP(ip) === 6 ? new URL(`http://[${ip}]`).hostname : ip;
}

export function configureProxy(app, env = process.env) {
  const addresses = (env.TRUSTED_TUNNEL_IPS || "").split(",").map((ip) => ip.trim()).filter(Boolean);
  const trusted = new Set(addresses.map((ip) => {
    const normalized = normalizeIp(ip);
    if (!normalized) throw new Error("TRUSTED_TUNNEL_IPS must contain exact IP addresses, not ranges or hostnames.");
    return normalized;
  }));
  if (trusted.size) {
    app.set("trust proxy", (ip, hop) => hop === 0 && trusted.has(normalizeIp(ip)));
    app.use((req, _res, next) => {
      if (trusted.has(normalizeIp(req.socket.remoteAddress))) {
        // Ignore user-supplied chains; only the tunnel's Cloudflare visitor header is authoritative.
        const visitor = req.headers["cf-connecting-ip"];
        if (normalizeIp(visitor)) req.headers["x-forwarded-for"] = visitor;
        else delete req.headers["x-forwarded-for"];
        delete req.headers["x-forwarded-host"];
      }
      next();
    });
  } else if (env.TRUST_PROXY === "1" || env.TRUST_PROXY === "true") {
    app.set("trust proxy", 1);
    console.warn("Legacy TRUST_PROXY=1 trusts any direct peer. Use TRUSTED_TUNNEL_IPS for mixed tunnel/LAN access.");
  }
}

// Fixed windows bound memory per client. Fail closed for new keys when full rather than
// evicting active buckets, which would let address churn reset another client's limit.
export function createLimiter({ limit, windowMs, maxKeys = 10000, now = Date.now }) {
  const buckets = new Map();
  let nextCleanup = 0;
  return (key) => {
    const time = now();
    if (time >= nextCleanup) {
      for (const [id, bucket] of buckets) if (bucket.until <= time) buckets.delete(id);
      nextCleanup = time + Math.min(windowMs, 60000);
    }
    let bucket = buckets.get(key);
    if (bucket?.until <= time) {
      buckets.delete(key);
      bucket = null;
    }
    if (!bucket) {
      if (buckets.size >= maxKeys) return Math.max(1, Math.ceil((nextCleanup - time) / 1000));
      bucket = { count: 0, until: time + windowMs };
      buckets.set(key, bucket);
    }
    if (bucket.count >= limit) return Math.max(1, Math.ceil((bucket.until - time) / 1000));
    bucket.count += 1;
    return 0;
  };
}

export function rateLimit(options, key = (req) => normalizeIp(req.ip) || "unknown") {
  const consume = createLimiter(options);
  return (req, res, next) => {
    const retry = consume(key(req));
    if (!retry) return next();
    res.setHeader("Retry-After", String(retry));
    return res.status(429).json({ error: "Too many requests. Please try again shortly." });
  };
}

export function installStorageLimits(db) {
  const limits = {
    users: 500, groups: 100, availability: 50000, availability_rules: 10000,
    availability_presets: 10000, availability_exceptions: 50000,
    events: 20000, event_comments: 100000, game_suggestions: 10000,
    event_proposals: 10000
  };
  for (const [table, limit] of Object.entries(limits)) {
    db.exec(`
      CREATE TRIGGER IF NOT EXISTS quota_${table} BEFORE INSERT ON ${table}
      WHEN (SELECT COUNT(*) FROM ${table}) >= ${limit}
      BEGIN SELECT RAISE(ABORT, 'Storage limit reached. Ask an administrator to remove unused records.'); END;
    `);
  }
  db.exec(`
    CREATE TRIGGER IF NOT EXISTS quota_pending_users BEFORE INSERT ON users
    WHEN NEW.account_status = 'pending' AND (SELECT COUNT(*) FROM users WHERE account_status = 'pending') >= 100
    BEGIN SELECT RAISE(ABORT, 'Pending account limit reached. Contact an administrator.'); END;
  `);
  for (const [table, owner, limit] of [
    ["availability", "user_id", 2000], ["availability_rules", "user_id", 100],
    ["availability_presets", "user_id", 50], ["events", "owner_id", 1000],
    ["event_proposals", "owner_id", 200], ["game_suggestions", "user_id", 200]
  ]) {
    db.exec(`
      CREATE INDEX IF NOT EXISTS quota_owner_${table} ON ${table} (${owner});
      CREATE TRIGGER IF NOT EXISTS quota_owner_${table} BEFORE INSERT ON ${table}
      WHEN (SELECT COUNT(*) FROM ${table} WHERE ${owner} = NEW.${owner}) >= ${limit}
      BEGIN SELECT RAISE(ABORT, 'Personal storage limit reached. Remove unused records before adding more.'); END;
    `);
  }
  for (const [table, column] of [["availability", "note"], ["events", "notes"]]) {
    for (const operation of ["INSERT", "UPDATE"]) {
      db.exec(`
        CREATE TRIGGER IF NOT EXISTS text_limit_${table}_${operation} BEFORE ${operation === "UPDATE" ? `UPDATE OF ${column}` : operation} ON ${table}
        WHEN length(CAST(NEW.${column} AS BLOB)) > 4000
        BEGIN SELECT RAISE(ABORT, 'Notes must not exceed 4000 bytes.'); END;
      `);
    }
  }
}
