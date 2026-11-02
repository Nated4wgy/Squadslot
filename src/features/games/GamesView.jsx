import { useState } from "react";
import { Link, Search, Send } from "lucide-react";
import { SteamImage } from "../../components/PlayerMedia.jsx";
import { useDebouncedSteamSearch } from "../../lib/useSteamSearch.js";
import { api } from "../../lib/api.js";
import { PageHeader } from "../../components/PageLayout.jsx";

export function GamesView({ games, searchGames }) {
  const [query, setQuery] = useState("co-op");
  const [selected, setSelected] = useState(null);
  useDebouncedSteamSearch(query, searchGames);

  async function loadDetails(appId) {
    const payload = await api(`/api/games/${appId}`);
    setSelected(payload.game);
  }

  async function suggest(game) {
    await api("/api/games/suggest", {
      method: "POST",
      body: JSON.stringify({ steamAppId: game.appId, title: game.title, image: game.image || "" })
    });
  }

  return (
    <>
      <PageHeader>
        <div>
          <h1>Games</h1>
          <p>Search Steam directly and post suggestions to Discord.</p>
        </div>
      </PageHeader>
      <section className="table-panel">
        <form className="search-bar" onSubmit={(event) => { event.preventDefault(); searchGames(query); }}>
          <input placeholder="Search Steam games" value={query} onChange={(event) => setQuery(event.target.value)} />
          <button className="primary-button"><Search size={17} /> Search</button>
        </form>
        <div className="games-browser">
          <div className="steam-results">
            {games.map((game) => (
              <button className="steam-result" key={game.appId} onClick={() => loadDetails(game.appId)}>
                <SteamImage src={game.image} appId={game.appId} />
                <div>
                  <strong>{game.title}</strong>
                  <span>{game.price || "Steam app"} - #{game.appId}</span>
                </div>
              </button>
            ))}
          </div>
          <aside className="game-detail">
            {selected ? (
              <>
                <SteamImage src={selected.image} appId={selected.appId} className="game-detail-image" />
                <h2>{selected.title}</h2>
                <p>{selected.shortDescription || "No Steam description available."}</p>
                <div className="tag-list">
                  {selected.genres.slice(0, 5).map((genre) => <span key={genre}>{genre}</span>)}
                </div>
                <div className="detail-actions">
                  <a className="secondary-button" href={selected.steamUrl} target="_blank" rel="noreferrer"><Link size={16} /> Steam</a>
                  <button className="primary-button" onClick={() => suggest(selected)}><Send size={16} /> Suggest</button>
                </div>
              </>
            ) : (
              <p className="muted">Select a game to inspect details.</p>
            )}
          </aside>
        </div>
      </section>
    </>
  );
}
