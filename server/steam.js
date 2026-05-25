const searchCache = new Map();
const detailsCache = new Map();
const cacheTtlMs = 1000 * 60 * 30;

function cached(map, key) {
  const item = map.get(key);
  if (!item || Date.now() - item.createdAt > cacheTtlMs) return null;
  return item.value;
}

function store(map, key, value) {
  map.set(key, { value, createdAt: Date.now() });
  return value;
}

function toGameSummary(item) {
  return {
    appId: Number(item.id),
    title: item.name,
    image: item.tiny_image || item.header_image || "",
    price: item.price?.final
      ? `${item.price.currency || ""} ${(item.price.final / 100).toFixed(2)}`.trim()
      : item.price?.final === 0
        ? "Free"
        : ""
  };
}

function toGameDetails(appId, payload) {
  const data = payload?.[appId]?.data;
  if (!data) return null;

  return {
    appId: Number(appId),
    title: data.name,
    image: data.header_image || "",
    capsuleImage: data.capsule_image || "",
    shortDescription: data.short_description || "",
    genres: Array.isArray(data.genres) ? data.genres.map((genre) => genre.description) : [],
    categories: Array.isArray(data.categories) ? data.categories.map((category) => category.description) : [],
    releaseDate: data.release_date?.date || "",
    website: data.website || "",
    steamUrl: `https://store.steampowered.com/app/${appId}/`
  };
}

export async function searchSteamGames(term) {
  const query = String(term || "").trim();
  if (query.length < 2) return [];

  const key = query.toLowerCase();
  const hit = cached(searchCache, key);
  if (hit) return hit;

  const url = new URL("https://store.steampowered.com/api/storesearch/");
  url.searchParams.set("term", query);
  url.searchParams.set("l", "english");
  url.searchParams.set("cc", "GB");

  const response = await fetch(url);
  if (!response.ok) throw new Error(`Steam search failed with ${response.status}`);

  const payload = await response.json();
  const games = Array.isArray(payload.items)
    ? payload.items.filter((item) => item.type === "app").slice(0, 20).map(toGameSummary)
    : [];

  return store(searchCache, key, games);
}

export async function getSteamGameDetails(appId) {
  const id = Number(appId);
  if (!Number.isInteger(id) || id <= 0) return null;

  const hit = cached(detailsCache, id);
  if (hit) return hit;

  const url = new URL("https://store.steampowered.com/api/appdetails/");
  url.searchParams.set("appids", String(id));
  url.searchParams.set("l", "english");
  url.searchParams.set("cc", "GB");

  const response = await fetch(url);
  if (!response.ok) throw new Error(`Steam details failed with ${response.status}`);

  const payload = await response.json();
  return store(detailsCache, id, toGameDetails(id, payload));
}
