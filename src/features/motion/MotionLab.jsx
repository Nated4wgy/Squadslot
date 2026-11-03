import { useState } from "react";
import { ChevronDown, Dices, RotateCcw, Sparkles } from "lucide-react";
import { MotionSettings, ReadyCelebration, WinnerReveal } from "./Motion.jsx";
import { SteamImage } from "../../components/PlayerMedia.jsx";
import "./motion-lab.css";

const players = ["Alex", "Jamie", "Sam", "Riley"].map((displayName, id) => ({ id: id + 1, displayName, profileColor: ["#75c8bc", "#6bc9ed", "#c5b4f6", "#e4bcdb"][id] }));
const games = [{ title: "Deep Rock Galactic", steamAppId: 548430 }, { title: "Valheim", steamAppId: 892970 }, { title: "Helldivers 2", steamAppId: 553850 }].map(game => ({ ...game, imageUrl: `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${game.steamAppId}/header.jpg` }));

export function MotionLab() {
  const [ready, setReady] = useState(0);
  const [draw, setDraw] = useState(0);
  const [open, setOpen] = useState(false);
  const [week, setWeek] = useState(0);
  return <main className="motion-lab">
    <header><div><span className="motion-eyebrow">SquadSlot / local preview</span><h1>Motion lab</h1></div><a className="secondary-button" href="/">Back to SquadSlot</a></header>
    <MotionSettings />
    <section className="motion-demo">
      <div className="motion-demo-heading"><h2>Event expansion</h2><button className="secondary-button" aria-expanded={open} onClick={() => setOpen(value => !value)}><ChevronDown size={18} />{open ? "Close event" : "Open event"}</button></div>
      <div className="motion-sample-summary"><SteamImage src={games[0].imageUrl} appId={548430} alt="Deep Rock Galactic" /><div><strong>Friday co-op</strong><span>20:00 - 23:00 / 4 players</span></div></div>
      <div className={`event-reveal${open ? " is-open" : ""}`} inert={!open} aria-hidden={!open}><div><div className="event-expanded"><section><h3>Deep Rock Galactic</h3><p>Alex, Jamie, Sam and Riley</p><p>Voice channel: Game night</p></section><section><h3>Session notes</h3><p>Hazard 4. No mods. Everyone welcome.</p></section></div></div></div>
    </section>
    <section className="motion-demo">
      <div className="motion-demo-heading"><h2>Squad ready</h2><button className="secondary-button" onClick={() => setReady(value => value + 1)}><Sparkles size={18} />{ready ? "Replay celebration" : "Complete squad"}</button></div>
      <div className="motion-ready-stage">{ready ? <ReadyCelebration key={ready} players={players} /> : <span className="muted">3/4 accepted</span>}</div>
    </section>
    <section className="motion-demo">
      <div className="motion-demo-heading"><h2>Game reveal</h2><button className="secondary-button" onClick={() => setDraw(value => value + 1)}><Dices size={18} />Reveal sample winner</button></div>
      <div className="motion-game-strip">{games.map(game => <div key={game.steamAppId}><SteamImage src={game.imageUrl} appId={game.steamAppId} alt={game.title} /><span>{game.title}</span></div>)}</div>
      <div className="motion-winner-stage">{draw > 0 && <WinnerReveal key={draw} choice={games[(draw - 1) % games.length]} />}</div>
    </section>
    <section className="motion-demo">
      <div className="motion-demo-heading"><h2>Calendar entrance</h2><button className="secondary-button" onClick={() => setWeek(value => value + 1)}><RotateCcw size={18} />Replay week</button></div>
      <div className="motion-week" key={week}>{["Mon", "Tue", "Wed", "Thu", "Fri"].map((day, index) => <div className="motion-calendar-day" key={day} style={{ "--day-index": index }}><strong>{day}</strong><div className="motion-free-slot" style={{ marginTop: `${20 + index % 3 * 24}px` }}>4 free<span>19:00 - 23:00</span></div></div>)}</div>
    </section>
  </main>;
}
