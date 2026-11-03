import { useEffect, useRef, useState } from "react";
import { Download, Dices, Trash2, LogOut, Bell, MessageSquare, RefreshCw, Send, Sparkles, Vote, Link, Pencil } from "lucide-react";
import { EventEditor } from "./EventEditor.jsx";
import { Avatar, SteamImage, EventGameImage } from "../../components/PlayerMedia.jsx";
import { formatDate } from "../../lib/dates.js";
import { api } from "../../lib/api.js";
import { PageHeader } from "../../components/PageLayout.jsx";
import { overnightLabel } from "../../lib/overnight.js";
import { useMotion, ReadyCelebration, WinnerReveal } from "../motion/Motion.jsx";

export function EventInviteRow({ event, onStatus, onRemove }) {
  const invite = event.myInvite;

  return (
    <article className="invite-row">
      <div className="event-title-line">
        <EventGameImage event={event} />
        <div>
        <strong>{event.title}</strong>
        <span>{event.gameTitle || "Game TBD"} - {event.date}, {event.startTime} to {event.endTime}{overnightLabel(event.startTime, event.endTime)}</span>
        <small>From {event.ownerName} - current: {invite.status}</small>
        </div>
      </div>
      <div className="invite-actions">
        <button className={invite.status === "accepted" ? "selected" : ""} type="button" onClick={() => onStatus(event.id, "accepted")}>Accept</button>
        <button className={invite.status === "tentative" ? "selected" : ""} type="button" onClick={() => onStatus(event.id, "tentative")}>Tentative</button>
        <button className={invite.status === "declined" ? "selected danger" : "danger"} type="button" onClick={() => onStatus(event.id, "declined")}>Decline</button>
        <button className="remove-invite-button" type="button" onClick={() => onRemove(event.id)}><LogOut size={15} /> Remove</button>
      </div>
    </article>
  );
}

export function InvitesView({ user, events, refresh }) {
  const [message, setMessage] = useState("");
  const invites = events
    .filter((event) => (
      event.ownerId !== user.id
      && event.invites.some((invite) => invite.userId === user.id && invite.status === "invited")
    ))
    .map((event) => ({
      ...event,
      myInvite: event.invites.find((invite) => invite.userId === user.id)
    }));

  async function setStatus(eventId, status) {
    try {
    await api(`/api/events/${eventId}/invites/me`, { method: "PATCH", body: JSON.stringify({ status }) });
    refresh();
    setMessage("");
    } catch (failure) { setMessage(failure.message); }
  }

  async function removeInvite(eventId) {
    try {
    await api(`/api/events/${eventId}/invites/me`, { method: "DELETE" });
    refresh();
    setMessage("");
    } catch (failure) { setMessage(failure.message); }
  }

  return (
    <>
      <PageHeader>
        <div>
          <h1>Invites</h1>
          <p>Accept, decline, or mark sessions as tentative.</p>
        </div>
      </PageHeader>
      <section className="table-panel">
        {message && <p className="form-error" role="alert">{message}</p>}
        {invites.length === 0 && <p className="muted">No invites yet.</p>}
        {invites.map((event) => (
          <EventInviteRow event={event} onStatus={setStatus} onRemove={removeInvite} key={event.id} />
        ))}
      </section>
    </>
  );
}

export function EventDetails({ user, event, refresh, onDelete, onLeave, focused = false }) {
  const { effective } = useMotion();
  const [celebration, setCelebration] = useState(0);
  const [winner, setWinner] = useState(null);
  const [drawing, setDrawing] = useState(false);
  const drawingLock = useRef(false);
  const [expanded, setExpanded] = useState(focused);
  const [editing, setEditing] = useState(false);
  const [message, setMessage] = useState("");
  const card = useRef(null);
  const previous = useRef(JSON.stringify(event));
  const wasReady = useRef(event.ready);
  const [comments, setComments] = useState([]);
  const [comment, setComment] = useState("");
  const accepted = event.invites.filter((invite) => invite.status === "accepted");
  const waitlisted = event.invites.filter((invite) => invite.status === "waitlisted").sort((a, b) => (a.waitlistedAt ?? 0) - (b.waitlistedAt ?? 0) || a.userId - b.userId);
  const myInvite = event.invites.find((invite) => invite.userId === user.id);
  const canManage = event.ownerId === user.id || user.role === "admin";
  const canLeave = event.ownerId !== user.id && Boolean(myInvite);
  const myVote = event.gameOptions.find((option) => option.voters.includes(user.id))?.id;

  useEffect(() => {
    if (focused) card.current?.scrollIntoView({ block: "center" });
  }, [focused]);
  useEffect(() => {
    const value = JSON.stringify(event);
    if (!wasReady.current && event.ready) setCelebration(count => count + 1);
    if (previous.current !== value && effective !== "off" && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      card.current?.animate([
        { boxShadow: `inset 0 0 0 2px ${!wasReady.current && event.ready ? "#63dbc3" : "#6bc9ed"}` },
        { boxShadow: "inset 0 0 0 2px transparent" }
      ], { duration: 1000, easing: "ease-out" });
    }
    previous.current = value; wasReady.current = event.ready;
  }, [event, effective]);
  useEffect(() => {
    if (!expanded) return;
    let active = true;
    const update = async () => {
      if (document.visibilityState !== "visible") return;
      try { const payload = await api(`/api/events/${event.id}/comments`); if (active) setComments(payload.comments); }
      catch (failure) { if (active) setMessage(failure.message); }
    };
    update();
    const timer = window.setInterval(update, 15000);
    return () => { active = false; window.clearInterval(timer); };
  }, [expanded, event.id]);

  async function share() {
    const url = new URL("/", window.location.origin);
    url.searchParams.set("view", "events"); url.searchParams.set("event", String(event.id));
    try { await navigator.clipboard.writeText(url.href); setMessage("Event link copied. Squad membership is required to view it."); }
    catch { setMessage(url.href); }
  }

  async function loadComments() {
    const payload = await api(`/api/events/${event.id}/comments`);
    setComments(payload.comments);
  }

  async function toggleExpanded() {
    const next = !expanded;
    setExpanded(next);
  }

  async function vote(optionId) {
    try {
    await api(`/api/events/${event.id}/votes`, { method: "POST", body: JSON.stringify({ optionId }) });
    refresh();
    setMessage("");
    } catch (failure) { setMessage(`${failure.message} Your vote was not confirmed; you can try again.`); }
  }

  async function randomize() {
    if (drawingLock.current) return;
    drawingLock.current = true;
    setDrawing(true);
    try {
    const result = await api(`/api/events/${event.id}/games/randomize`, { method: "POST", body: JSON.stringify({}) });
    setWinner({ ...result.chosen, revealKey: Date.now() });
    refresh();
    setMessage("");
    } catch (failure) { setMessage(`${failure.message} Refresh before trying the draw again.`); }
    finally { drawingLock.current = false; setDrawing(false); }
  }

  async function addComment(eventSubmit) {
    eventSubmit.preventDefault();
    try {
    await api(`/api/events/${event.id}/comments`, { method: "POST", body: JSON.stringify({ body: comment }) });
    setComment("");
    await loadComments();
    setMessage("");
    } catch (failure) { setMessage(`${failure.message} Check the discussion before resending.`); }
  }

  return (
    <article ref={card} id={`event-${event.id}`} className={`event-detail-card${event.ready ? " ready-card" : ""}`}>
      <div className="event-summary">
        <div className="event-title-line">
          <EventGameImage event={event} />
          <div>
            <strong>{event.title}</strong>
            <span>{event.gameTitle || "Vote pending"} - {formatDate(event.date)}, {event.startTime} to {event.crossesDay ? `${formatDate(event.endDate)}, ` : ""}{event.endTime}</span>
            <small>Host: {event.ownerName}</small>
            {myInvite?.status === "waitlisted" && <small className="status-waitlist">Waitlist position: {waitlisted.findIndex(invite => invite.userId === user.id) + 1}</small>}
          </div>
        </div>
        <div className="capacity-meter">
          <span>{accepted.length}/{event.maxPlayers} accepted</span>
          <div><i style={{ width: `${Math.min(100, (accepted.length / event.maxPlayers) * 100)}%` }} /></div>
          <small>{event.ready ? "Minimum reached" : `${Math.max(0, event.minPlayers - accepted.length)} more needed`}</small>
          {waitlisted.length > 0 && <small>{waitlisted.length} waitlisted</small>}
        </div>
        <div className="event-card-actions">
          <button className="icon-button" type="button" onClick={share} aria-label={`Copy link to ${event.title}`} title="Copy event link"><Link size={17} /></button>
          {canManage && <button className="icon-button" type="button" onClick={() => setEditing(true)} aria-label={`Edit ${event.title}`} title="Edit session"><Pencil size={17} /></button>}
          <button className="secondary-button" type="button" onClick={toggleExpanded}><MessageSquare size={16} /> {expanded ? "Close" : "Details"}</button>
          <a className="icon-action" href={`/api/events/${event.id}/ics`} title="Download calendar event"><Download size={17} /></a>
          {canLeave && <button className="danger-text-button compact-danger-action" type="button" onClick={() => onLeave(event.id)}><LogOut size={16} /> Leave event</button>}
          {canManage && <button className="danger-button" type="button" onClick={() => onDelete(event.id)} aria-label={`Delete ${event.title}`} title="Delete event"><Trash2 size={16} /></button>}
        </div>
      </div>
      {message && <p className="event-feedback" role="status">{message}</p>}
      {celebration > 0 && event.ready && <ReadyCelebration key={celebration} players={accepted} />}
      {editing && <EventEditor event={event} refresh={refresh} onClose={() => setEditing(false)} />}
      <div className={`event-reveal${expanded ? " is-open" : ""}`} inert={!expanded} aria-hidden={!expanded}><div>
        <div className="event-expanded">
          <section>
            <div className="panel-heading"><Vote size={17} /><div><h3>Game vote</h3><p>One vote per invited player.</p></div></div>
            <div className="vote-grid">
              {event.gameOptions.map((option) => (
                <button className={`${myVote === option.id ? "selected" : ""} has-image`} type="button" onClick={() => vote(option.id)} key={option.id}>
                  <SteamImage src={option.imageUrl} appId={option.steamAppId} />
                  <span><strong>{option.title}</strong><small>{option.voteCount} vote{option.voteCount === 1 ? "" : "s"}</small></span>
                  <span className="vote-progress" aria-hidden="true"><i style={{ width: `${Math.min(100, option.voteCount / Math.max(1, event.invites.length) * 100)}%` }} /></span>
                  {event.selectedGameOptionId === option.id && <Sparkles size={16} />}
                </button>
              ))}
              {event.gameOptions.length === 0 && <p className="muted">No game options were added.</p>}
            </div>
            {canManage && event.gameOptions.length > 0 && (
              <button className="secondary-button" type="button" disabled={drawing} onClick={randomize}><Dices size={16} /> {drawing ? "Choosing..." : "Pick winner / break tie"}</button>
            )}
            <WinnerReveal key={winner?.revealKey} choice={winner} />
          </section>
          <section>
            <div className="panel-heading"><MessageSquare size={17} /><div><h3>Session comments</h3><p>Server details, mods, DLC, and voice chat.</p></div></div>
            <div className="comment-list">
              {comments.map((item) => (
                <div className="comment" key={item.id}>
                  <Avatar user={item} size="tiny" />
                  <div><strong>{item.displayName}</strong><p>{item.body}</p><small>{new Date(`${item.createdAt}Z`).toLocaleString()}</small></div>
                </div>
              ))}
              {comments.length === 0 && <p className="muted">No comments yet.</p>}
            </div>
            <form className="comment-form" onSubmit={addComment}>
              <input placeholder="Add a comment" value={comment} onChange={(eventInput) => setComment(eventInput.target.value)} />
              <button className="primary-button"><Send size={16} /></button>
            </form>
          </section>
          {event.notes && <p className="event-notes"><strong>Session notes:</strong> {event.notes}</p>}
        </div>
      </div></div>
    </article>
  );
}

export function EventsView({ user, events, refresh, onOpenSubscription }) {
  const targetId = Number(new URL(window.location.href).searchParams.get("event"));
  const [tab, setTab] = useState("upcoming");
  const [history, setHistory] = useState([]);
  const [message, setMessage] = useState("");
  const pendingInvites = events
    .filter((event) => event.invites.some((invite) => invite.userId === user.id && invite.status === "invited"))
    .map((event) => ({
      ...event,
      myInvite: event.invites.find((invite) => invite.userId === user.id)
    }))
    .sort((a, b) => `${a.date} ${a.startTime}`.localeCompare(`${b.date} ${b.startTime}`));
  const managedEvents = events
    .filter((event) => {
      const mine = event.invites.find((invite) => invite.userId === user.id);
      return event.id === targetId || event.ownerId === user.id || ["accepted", "tentative", "waitlisted"].includes(mine?.status) || user.role === "admin";
    })
    .sort((a, b) => `${a.date} ${a.startTime}`.localeCompare(`${b.date} ${b.startTime}`));

  async function removeEvent(eventId) {
    try {
    await api(`/api/events/${eventId}`, { method: "DELETE" });
    refresh();
    } catch (failure) { setMessage(failure.message); }
  }

  async function leaveEvent(eventId) {
    try {
    await api(`/api/events/${eventId}/invites/me`, { method: "DELETE" });
    refresh();
    } catch (failure) { setMessage(failure.message); }
  }

  async function setInviteStatus(eventId, status) {
    setMessage("");
    try {
      const payload = await api(`/api/events/${eventId}/invites/me`, { method: "PATCH", body: JSON.stringify({ status }) });
      if (payload.status === "waitlisted") setMessage("That session is full, so you were added to its waitlist.");
      refresh();
    } catch (error) {
      if (error.code === "EVENT_CONFLICT" && window.confirm(`${error.message} Accept it anyway?`)) {
        try {
        await api(`/api/events/${eventId}/invites/me`, { method: "PATCH", body: JSON.stringify({ status, force: true }) });
        refresh();
        } catch (failure) { setMessage(failure.message); }
      } else {
        setMessage(error.message);
      }
    }
  }

  async function changeTab(nextTab) {
    setTab(nextTab);
    if (nextTab === "history") {
      try {
        const payload = await api("/api/events/history");
        setHistory(payload.events);
      } catch (error) {
        setMessage(error.message);
      }
    }
  }

  return (
    <>
      <PageHeader>
        <div>
          <h1>Events</h1>
          <p>Respond to invitations and manage sessions you joined or created.</p>
        </div>
        <div className="toolbar">
          <button className="secondary-button" type="button" onClick={onOpenSubscription}><RefreshCw size={16} /> Live calendar</button>
          <a className="secondary-button" href="/api/calendar.ics"><Download size={16} /> Download .ics</a>
        </div>
      </PageHeader>
      <div className="segmented-control" aria-label="Event list">
        <button className={tab === "upcoming" ? "active" : ""} onClick={() => changeTab("upcoming")}>Upcoming</button>
        <button className={tab === "history" ? "active" : ""} onClick={() => changeTab("history")}>History</button>
      </div>
      {message && <p className="form-error">{message}</p>}
      {targetId > 0 && !events.some(event => event.id === targetId) && <p role="status" className="muted">This event is not in the upcoming events for your active squad. Check your squad or the event history.</p>}
      {tab === "upcoming" && <section className="table-panel events-invite-panel">
        <div className="panel-heading">
          <Bell size={18} />
          <div>
            <h2>Pending invites</h2>
            <p>{pendingInvites.length > 0 ? `${pendingInvites.length} waiting for your response.` : "No invitations are waiting."}</p>
          </div>
        </div>
        {pendingInvites.map((event) => (
          <EventInviteRow event={event} onStatus={setInviteStatus} onRemove={leaveEvent} key={event.id} />
        ))}
      </section>}
      {tab === "upcoming" && managedEvents.length === 0 && <section className="table-panel"><p className="muted">No accepted or tentative events yet.</p></section>}
      {tab === "upcoming" && <div className="event-detail-list">
        {managedEvents.map((event) => (
          <EventDetails focused={event.id === targetId} user={user} event={event} refresh={refresh} onDelete={removeEvent} onLeave={leaveEvent} key={event.id} />
        ))}
      </div>}
      {tab === "history" && <div className="event-detail-list">
        {history.map((event) => (
          <article className="event-detail-card archive-event" key={event.id}>
            <div><strong>{event.title}</strong><span>{event.gameTitle || "Game not selected"}</span></div>
            <div><strong>{formatDate(event.date)}</strong><span>{event.startTime} to {event.endTime}{overnightLabel(event.startTime, event.endTime)}</span></div>
            <span>{event.invites.filter((invite) => invite.status === "accepted").length} attended</span>
          </article>
        ))}
        {history.length === 0 && <section className="table-panel"><p className="muted">No past events yet.</p></section>}
      </div>}
    </>
  );
}
