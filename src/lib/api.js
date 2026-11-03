export async function api(path, options = {}) {
  let response;
  try {
    response = await fetch(path, {
      ...options,
      headers: { "Content-Type": "application/json", ...(options.headers || {}) },
      signal: options.signal || window.AbortSignal.timeout(60000)
    });
  } catch {
    const changed = options.method && !["GET", "HEAD"].includes(options.method.toUpperCase());
    throw new Error(changed
      ? "The result could not be confirmed. Check your connection and refresh before trying again."
      : "Could not reach SquadSlot. Check your connection and try again.");
  }
  const payload = await response.json().catch(() => ({}));
  if (response.status === 401 && !path.startsWith("/api/auth/")) {
    window.dispatchEvent(new window.Event("squadslot:session-expired"));
  }
  if (!response.ok) {
    const error = new Error(payload.error || "Something went wrong.");
    Object.assign(error, payload);
    throw error;
  }
  return payload;
}

