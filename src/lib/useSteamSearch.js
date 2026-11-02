import { useEffect } from "react";

export function useDebouncedSteamSearch(query, onSearchGames) {
  useEffect(() => {
    const normalized = query.trim();
    if (normalized.length < 2) return undefined;

    const timer = setTimeout(() => onSearchGames(normalized), 350);
    return () => clearTimeout(timer);
  }, [query, onSearchGames]);
}

