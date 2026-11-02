export async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options
  });
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

