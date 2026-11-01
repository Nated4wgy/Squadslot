import styles from "./dashboard.module.css";
import { CalendarDays, ChevronRight, Clock, Gamepad2, Bell, Sparkles, Zap } from "lucide-react";
import { Avatar, Skeleton, SteamImage, EventGameImage } from "../../components/PlayerMedia.jsx";
import { formatDate } from "../../lib/dates.js";
import { useSchedulingTime } from "../../lib/scheduling-time.jsx";
import { PageHeader } from "../../components/PageLayout.jsx";

export function DashboardView({ dashboard, setActiveView }) {
  if (!dashboard) {
    return (
      <div className={styles.view}>
        <PageHeader><div><h1>Dashboard</h1><p>Your next session and strongest overlaps.</p></div></PageHeader>
        <div className="dashboard-grid"><section className="table-panel"><Skeleton rows={4} /></section><section className="table-panel"><Skeleton rows={5} /></section></div>
      </div>
    );
  }

  return (
    <div className={styles.view}>
      <PageHeader>
        <div><h1>Dashboard</h1><p>Your next session, invites, and best times to play.</p></div>
        <button className="secondary-button" onClick={() => setActiveView("tonight")}><Zap size={16} /> Tonight</button>
      </PageHeader>
      <div className="dashboard-grid">
        <section className={`dashboard-feature next-event${dashboard.nextEvent?.ready ? " ready-card" : ""}`}>
          <span className="eyebrow">Next accepted event</span>
          {dashboard.nextEvent ? (
            <>
              <EventGameImage event={dashboard.nextEvent} className="next-event-art" />
              <h2>{dashboard.nextEvent.title}</h2>
              <p>{dashboard.nextEvent.gameTitle || "Game vote pending"}</p>
              <strong>{formatDate(dashboard.nextEvent.date)} at {dashboard.nextEvent.startTime}</strong>
              <div className="avatar-stack">
                {dashboard.nextEvent.invites.filter((invite) => invite.status === "accepted").slice(0, 6).map((invite) => <Avatar user={invite} size="small" key={invite.userId} />)}
              </div>
              <button className="primary-button" onClick={() => setActiveView("events")}>Open event</button>
            </>
          ) : <><h2>No session booked</h2><p>Use the calendar to create the next one.</p><button className="primary-button" onClick={() => setActiveView("calendar")}>Open calendar</button></>}
        </section>
        <section className="table-panel dashboard-panel">
          <div className="panel-heading"><Bell size={18} /><div><h2>Pending invites</h2><p>{dashboard.pendingInviteCount} waiting for your response.</p></div></div>
          {dashboard.pendingInvites.map((event) => (
            <button className="dashboard-row with-art" onClick={() => setActiveView("invites")} key={event.id}>
              <EventGameImage event={event} />
              <span><strong>{event.title}</strong><small>{formatDate(event.date)} at {event.startTime}</small></span>
              <ChevronRight size={17} />
            </button>
          ))}
          {dashboard.pendingInvites.length === 0 && <p className="muted">You are caught up.</p>}
        </section>
        <section className="table-panel dashboard-panel">
          <div className="panel-heading"><Sparkles size={18} /><div><h2>Best upcoming overlap</h2><p>Highest number of free players.</p></div></div>
          <div className="best-time-list">
            {dashboard.bestSlots.slice(0, 4).map((slot, index) => (
              <button onClick={() => setActiveView("calendar")} key={`${slot.date}-${slot.startTime}`}>
                <span className="rank">{index + 1}</span>
                <span><strong>{formatDate(slot.date)}</strong><small>{slot.startTime}</small></span>
                <span className="overlap-count">{slot.count} free</span>
              </button>
            ))}
            {dashboard.bestSlots.length === 0 && <p className="muted">No shared free time this week.</p>}
          </div>
        </section>
        <section className="table-panel dashboard-panel">
          <div className="panel-heading"><Gamepad2 size={18} /><div><h2>Recent suggestions</h2><p>Games your group wants to play.</p></div></div>
          <div className="suggestion-grid">
            {dashboard.recentSuggestions.map((game) => (
              <a href={`https://store.steampowered.com/app/${game.steamAppId}/`} target="_blank" rel="noreferrer" key={game.id}>
                <SteamImage src={game.imageUrl} appId={game.steamAppId} />
                <span><strong>{game.title}</strong><small>{game.suggestedBy}</small></span>
              </a>
            ))}
            {dashboard.recentSuggestions.length === 0 && <p className="muted">No games suggested yet.</p>}
          </div>
        </section>
      </div>
    </div>
  );
}

export function TonightView({ dashboard, setActiveView }) {
  const scheduling = useSchedulingTime();
  const tonight = dashboard?.tonight;
  const currentTime = scheduling.time;
  const available = tonight?.availability.filter((item) => item.endTime > currentTime) || [];
  const uniquePlayers = [...new Map(available.map((item) => [item.userId, item])).values()];

  return (
    <div className={styles.view}>
      <PageHeader>
        <div><h1>Tonight</h1><p>A compact view of who is free and what is planned.</p></div>
        <button className="secondary-button" onClick={() => setActiveView("calendar")}><CalendarDays size={16} /> Full calendar</button>
      </PageHeader>
      <div className="tonight-layout">
        <section className="tonight-hero">
          <span className="eyebrow">{formatDate(tonight?.date || scheduling.date, { weekday: "long", day: "numeric", month: "long" })}</span>
          <h2>{uniquePlayers.length} player{uniquePlayers.length === 1 ? "" : "s"} free tonight</h2>
          <div className="tonight-people">
            {uniquePlayers.map((player) => <div key={player.userId}><Avatar user={player} size="large" /><strong>{player.displayName}</strong><span>{player.startTime}-{player.endTime}</span></div>)}
          </div>
          {uniquePlayers.length === 0 && <p>No one has logged remaining free time tonight.</p>}
        </section>
        <section className="table-panel">
          <div className="panel-heading"><Clock size={18} /><div><h2>Tonight sessions</h2><p>Accepted and planned events.</p></div></div>
          {(tonight?.events || []).map((event) => (
            <button className="dashboard-row with-art" onClick={() => setActiveView("events")} key={event.id}>
              <EventGameImage event={event} />
              <span><strong>{event.title}</strong><small>{event.startTime}-{event.endTime} - {event.gameTitle || "Vote pending"}</small></span>
              <span>{event.invites.filter((invite) => invite.status === "accepted").length}/{event.maxPlayers}</span>
            </button>
          ))}
          {tonight?.events.length === 0 && <p className="muted">No sessions planned tonight.</p>}
        </section>
      </div>
    </div>
  );
}
