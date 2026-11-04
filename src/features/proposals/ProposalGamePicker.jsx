import { useEffect, useState } from "react";
import { Plus, Search, X } from "lucide-react";
import { api } from "../../lib/api.js";
import { SteamImage } from "../../components/PlayerMedia.jsx";
import styles from "./proposals.module.css";

export function ProposalGamePicker({ games, onChange, disabled }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    const controller = new window.AbortController();
    setResults([]); setError("");
    if (query.trim().length < 2) { setLoading(false); return; }
    setLoading(true);
    const timer = window.setTimeout(async () => {
      try {
        const payload = await api(`/api/games?q=${encodeURIComponent(query.trim())}`, { signal: controller.signal });
        if (!controller.signal.aborted) setResults(payload.games);
      } catch (failure) { if (!controller.signal.aborted) setError(failure.message); }
      finally { if (!controller.signal.aborted) setLoading(false); }
    }, 350);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [query]);
  const has = game => games.some(item => game.appId ? Number(item.steamAppId) === game.appId : item.title.toLowerCase() === game.title.toLowerCase());
  function add(game) {
    if (has(game) || games.length >= 12) return;
    onChange([...games, { title: game.title, steamAppId: game.appId || null, imageUrl: game.image || "" }]);
    setQuery("");
  }
  return <div className={styles.gamePicker}>
    <label htmlFor="proposal-steam-search">Search games</label>
    <div className={styles.search}><Search size={17} aria-hidden="true" /><input id="proposal-steam-search" type="search" placeholder="Search Steam..." maxLength={160} value={query} disabled={disabled || games.length >= 12} onChange={event => setQuery(event.target.value)} /></div>
    {loading && <small role="status">Searching Steam...</small>}
    {error && <p className="form-error" role="alert">{error}</p>}
    {query.trim().length >= 2 && <div className={styles.searchResults} aria-label="Steam search results">
      {results.map(game => <button type="button" key={game.appId} disabled={disabled || has(game) || games.length >= 12} onClick={() => add(game)}><SteamImage src={game.image} appId={game.appId} /><span>{game.title}</span><Plus size={16} /></button>)}
      {!loading && !error && results.length === 0 && <small>No Steam matches.</small>}
      <button type="button" disabled={disabled || games.length >= 12 || has({title:query.trim()})} onClick={() => add({title:query.trim()})}><Plus size={16} /><span>Add custom game: {query.trim()}</span></button>
    </div>}
    <div className={styles.selectedGames} aria-label="Selected games">{games.map((game, index) => <div key={`${game.steamAppId}-${game.title}`}><SteamImage src={game.imageUrl} appId={game.steamAppId} /><span>{game.title}</span><button type="button" className="icon-button" disabled={disabled} title={`Remove ${game.title}`} aria-label={`Remove ${game.title}`} onClick={() => onChange(games.filter((_, i) => i !== index))}><X size={15} /></button></div>)}</div>
    {games.length >= 12 && <small role="status">12 games selected (maximum).</small>}
  </div>;
}
