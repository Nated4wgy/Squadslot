export function gameImageSources(src, appId) {
  const id = Number(appId);
  const urls = [src];
  if (Number.isSafeInteger(id) && id > 0) {
    urls.push(`https://cdn.cloudflare.steamstatic.com/steam/apps/${id}/header.jpg`);
    urls.push(`https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/${id}/header.jpg`);
  }
  return [...new Set(urls.filter((url) => typeof url === "string" && url.startsWith("https://")))];
}

export function eventArtwork(event) {
  const options = event.gameOptions || [];
  const selected = options.find((option) => option.id === event.selectedGameOptionId);
  const game = selected || (event.steamAppId ? options.find((option) => option.steamAppId === event.steamAppId) : options.length === 1 ? options[0] : null);
  return { src: game?.imageUrl, appId: game?.steamAppId || (selected ? null : event.steamAppId) };
}
