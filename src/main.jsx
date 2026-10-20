import React, { useCallback, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  CalendarDays,
  Check,
  ChevronRight,
  Clock,
  Copy,
  Download,
  Dices,
  Trash2,
  Gamepad2,
  Link,
  LogOut,
  Bell,
  MessageSquare,
  Moon,
  Plus,
  RefreshCw,
  Search,
  Send,
  Settings,
  Sparkles,
  Sun,
  Unlink,
  Vote,
  Zap,
  UsersRound
} from "lucide-react";
import "./styles.css";
import "./theme.css";
import { Avatar, Skeleton, SteamImage, EventGameImage } from "./components/PlayerMedia.jsx";
import { useDebouncedSteamSearch } from "./lib/useSteamSearch.js";
import { addDays, formatDate, localDate } from "./lib/dates.js";
import { FreeTimeView } from "./features/availability/Availability.jsx";
import { CalendarView } from "./features/calendar/CalendarView.jsx";
import { eventHasEnded } from "./event-time.js";
import { api } from "./lib/api.js";
import { AuthScreen, PasswordChangeScreen } from "./features/auth/AuthScreens.jsx";
import AdminView from "./features/admin/AdminView.jsx";
import AppShell from "./components/AppShell.jsx";
import { SchedulingTimezone, useSchedulingTime } from "./lib/scheduling-time.jsx";
import PushPreferences, { disableDevicePush } from "./PushPreferences.jsx";











function FriendsView({ friends, availability, events }) {
  return (
    <>
      <header className="topbar">
        <div>
          <h1>Friends</h1>
          <p>Account list, availability counts, and invite activity.</p>
        </div>
      </header>
      <section className="table-panel">
        {friends.length === 0 && <p className="muted">No friends yet. Ask someone to create an account.</p>}
        {friends.map((friend) => {
          const freeCount = availability.filter((item) => item.userId === friend.id).length;
          const inviteCount = events.filter((event) => event.invites.some((invite) => invite.userId === friend.id)).length;
          return (
            <article className="friend-row" key={friend.id}>
              <div className="person-line">
                <Avatar user={friend} size="small" />
                <div>
                <strong>{friend.displayName}</strong>
                <span>@{friend.username}{friend.discordUsername ? ` - ${friend.discordUsername}` : ""}</span>
                </div>
              </div>
              <div><Clock size={16} /> {freeCount} free slots</div>
              <div><Send size={16} /> {inviteCount} invites</div>
            </article>
          );
        })}
      </section>
    </>
  );
}

function EventInviteRow({ event, onStatus, onRemove }) {
  const invite = event.myInvite;

  return (
    <article className="invite-row">
      <div className="event-title-line">
        <EventGameImage event={event} />
        <div>
        <strong>{event.title}</strong>
        <span>{event.gameTitle || "Game TBD"} - {event.date}, {event.startTime} to {event.endTime}</span>
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

function InvitesView({ user, events, refresh }) {
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
    await api(`/api/events/${eventId}/invites/me`, { method: "PATCH", body: JSON.stringify({ status }) });
    refresh();
  }

  async function removeInvite(eventId) {
    await api(`/api/events/${eventId}/invites/me`, { method: "DELETE" });
    refresh();
  }

  return (
    <>
      <header className="topbar">
        <div>
          <h1>Invites</h1>
          <p>Accept, decline, or mark sessions as tentative.</p>
        </div>
      </header>
      <section className="table-panel">
        {invites.length === 0 && <p className="muted">No invites yet.</p>}
        {invites.map((event) => (
          <EventInviteRow event={event} onStatus={setStatus} onRemove={removeInvite} key={event.id} />
        ))}
      </section>
    </>
  );
}

function EventDetails({ user, event, refresh, onDelete, onLeave }) {
  const [expanded, setExpanded] = useState(false);
  const [comments, setComments] = useState([]);
  const [comment, setComment] = useState("");
  const accepted = event.invites.filter((invite) => invite.status === "accepted");
  const waitlisted = event.invites.filter((invite) => invite.status === "waitlisted").sort((a, b) => (a.waitlistedAt ?? 0) - (b.waitlistedAt ?? 0) || a.userId - b.userId);
  const myInvite = event.invites.find((invite) => invite.userId === user.id);
  const canManage = event.ownerId === user.id || user.role === "admin";
  const canLeave = event.ownerId !== user.id && Boolean(myInvite);
  const myVote = event.gameOptions.find((option) => option.voters.includes(user.id))?.id;

  async function loadComments() {
    const payload = await api(`/api/events/${event.id}/comments`);
    setComments(payload.comments);
  }

  async function toggleExpanded() {
    const next = !expanded;
    setExpanded(next);
    if (next) await loadComments();
  }

  async function vote(optionId) {
    await api(`/api/events/${event.id}/votes`, { method: "POST", body: JSON.stringify({ optionId }) });
    refresh();
  }

  async function randomize() {
    await api(`/api/events/${event.id}/games/randomize`, { method: "POST", body: JSON.stringify({}) });
    refresh();
  }

  async function addComment(eventSubmit) {
    eventSubmit.preventDefault();
    await api(`/api/events/${event.id}/comments`, { method: "POST", body: JSON.stringify({ body: comment }) });
    setComment("");
    loadComments();
  }

  return (
    <article className={`event-detail-card${event.ready ? " ready-card" : ""}`}>
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
          <button className="secondary-button" type="button" onClick={toggleExpanded}><MessageSquare size={16} /> {expanded ? "Close" : "Details"}</button>
          <a className="icon-action" href={`/api/events/${event.id}/ics`} title="Download calendar event"><Download size={17} /></a>
          {canLeave && <button className="danger-text-button compact-danger-action" type="button" onClick={() => onLeave(event.id)}><LogOut size={16} /> Leave event</button>}
          {canManage && <button className="danger-button" type="button" onClick={() => onDelete(event.id)} aria-label={`Delete ${event.title}`} title="Delete event"><Trash2 size={16} /></button>}
        </div>
      </div>
      {expanded && (
        <div className="event-expanded">
          <section>
            <div className="panel-heading"><Vote size={17} /><div><h3>Game vote</h3><p>One vote per invited player.</p></div></div>
            <div className="vote-grid">
              {event.gameOptions.map((option) => (
                <button className={`${myVote === option.id ? "selected" : ""} has-image`} type="button" onClick={() => vote(option.id)} key={option.id}>
                  <SteamImage src={option.imageUrl} appId={option.steamAppId} />
                  <span><strong>{option.title}</strong><small>{option.voteCount} vote{option.voteCount === 1 ? "" : "s"}</small></span>
                  {event.selectedGameOptionId === option.id && <Sparkles size={16} />}
                </button>
              ))}
              {event.gameOptions.length === 0 && <p className="muted">No game options were added.</p>}
            </div>
            {canManage && event.gameOptions.length > 0 && (
              <button className="secondary-button" type="button" onClick={randomize}><Dices size={16} /> Pick winner / break tie</button>
            )}
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
      )}
    </article>
  );
}

function EventsView({ user, events, refresh, onOpenSubscription }) {
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
      return event.ownerId === user.id || ["accepted", "tentative", "waitlisted"].includes(mine?.status) || user.role === "admin";
    })
    .sort((a, b) => `${a.date} ${a.startTime}`.localeCompare(`${b.date} ${b.startTime}`));

  async function removeEvent(eventId) {
    await api(`/api/events/${eventId}`, { method: "DELETE" });
    refresh();
  }

  async function leaveEvent(eventId) {
    await api(`/api/events/${eventId}/invites/me`, { method: "DELETE" });
    refresh();
  }

  async function setInviteStatus(eventId, status) {
    setMessage("");
    try {
      const payload = await api(`/api/events/${eventId}/invites/me`, { method: "PATCH", body: JSON.stringify({ status }) });
      if (payload.status === "waitlisted") setMessage("That session is full, so you were added to its waitlist.");
      refresh();
    } catch (error) {
      if (error.code === "EVENT_CONFLICT" && window.confirm(`${error.message} Accept it anyway?`)) {
        await api(`/api/events/${eventId}/invites/me`, { method: "PATCH", body: JSON.stringify({ status, force: true }) });
        refresh();
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
      <header className="topbar">
        <div>
          <h1>Events</h1>
          <p>Respond to invitations and manage sessions you joined or created.</p>
        </div>
        <div className="toolbar">
          <button className="secondary-button" type="button" onClick={onOpenSubscription}><RefreshCw size={16} /> Live calendar</button>
          <a className="secondary-button" href="/api/calendar.ics"><Download size={16} /> Download .ics</a>
        </div>
      </header>
      <div className="segmented-control" aria-label="Event list">
        <button className={tab === "upcoming" ? "active" : ""} onClick={() => changeTab("upcoming")}>Upcoming</button>
        <button className={tab === "history" ? "active" : ""} onClick={() => changeTab("history")}>History</button>
      </div>
      {message && <p className="form-error">{message}</p>}
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
          <EventDetails user={user} event={event} refresh={refresh} onDelete={removeEvent} onLeave={leaveEvent} key={event.id} />
        ))}
      </div>}
      {tab === "history" && <div className="event-detail-list">
        {history.map((event) => (
          <article className="event-detail-card archive-event" key={event.id}>
            <div><strong>{event.title}</strong><span>{event.gameTitle || "Game not selected"}</span></div>
            <div><strong>{formatDate(event.date)}</strong><span>{event.startTime} to {event.endTime}</span></div>
            <span>{event.invites.filter((invite) => invite.status === "accepted").length} attended</span>
          </article>
        ))}
        {history.length === 0 && <section className="table-panel"><p className="muted">No past events yet.</p></section>}
      </div>}
    </>
  );
}

function GroupsView({ user, groups, onChanged }) {
  const [createForm, setCreateForm] = useState({ name: "", timezone: user.timezone || "Europe/London" });
  const [inviteCode, setInviteCode] = useState("");
  const [message, setMessage] = useState("");

  async function createGroup(event) {
    event.preventDefault();
    await api("/api/groups", { method: "POST", body: JSON.stringify(createForm) });
    setCreateForm({ ...createForm, name: "" });
    setMessage("Squad created and activated.");
    onChanged();
  }

  async function joinGroup(event) {
    event.preventDefault();
    await api("/api/groups/join", { method: "POST", body: JSON.stringify({ inviteCode }) });
    setInviteCode("");
    setMessage("Squad joined and activated.");
    onChanged();
  }

  async function activate(id) {
    await api(`/api/groups/${id}/activate`, { method: "PUT", body: JSON.stringify({}) });
    onChanged();
  }

  async function rotate(id) {
    await api(`/api/groups/${id}/invite-code`, { method: "POST", body: JSON.stringify({}) });
    setMessage("Invite code rotated.");
    onChanged();
  }

  return (
    <>
      <header className="topbar"><div><h1>Squads</h1><p>Keep calendars, friends, events, and suggestions separate for each group.</p></div></header>
      <div className="group-layout">
        <section className="table-panel">
          <div className="panel-heading"><UsersRound size={18} /><div><h2>Your squads</h2><p>Switching squad refreshes every shared view.</p></div></div>
          <div className="group-list">
            {groups.map((group) => (
              <article className={group.id === user.activeGroupId ? "active" : ""} key={group.id}>
                <div><strong>{group.name}</strong><span>{group.memberCount} members - {group.timezone}</span><small>{group.role}</small></div>
                <div className="settings-actions">
                  {group.id !== user.activeGroupId && <button className="secondary-button" onClick={() => activate(group.id)}>Open</button>}
                  {group.id === user.activeGroupId && (user.role === "admin" || ["owner", "admin"].includes(group.role)) && <button className="icon-button dark-icon-button" title="Rotate invite code" onClick={() => rotate(group.id)}><RefreshCw size={16} /></button>}
                </div>
                {group.id === user.activeGroupId && (user.role === "admin" || ["owner", "admin"].includes(group.role)) && <code>{group.inviteCode}</code>}
              </article>
            ))}
          </div>
        </section>
        <div>
          <form className="table-panel admin-form" onSubmit={createGroup}>
            <h2>Create squad</h2>
            <label>Name<input required value={createForm.name} onChange={(event) => setCreateForm({ ...createForm, name: event.target.value })} /></label>
            <label>Scheduling timezone<input required value={createForm.timezone} onChange={(event) => setCreateForm({ ...createForm, timezone: event.target.value })} /></label>
            <button className="primary-button"><Plus size={16} /> Create</button>
          </form>
          <form className="table-panel admin-form" onSubmit={joinGroup}>
            <h2>Join squad</h2>
            <label>Invite code<input required value={inviteCode} onChange={(event) => setInviteCode(event.target.value)} /></label>
            <button className="secondary-button"><Link size={16} /> Join</button>
          </form>
          {message && <p className="muted">{message}</p>}
        </div>
      </div>
    </>
  );
}

function ProposalsView({ user, friends }) {
  const scheduling = useSchedulingTime();
  const tomorrow = localDate(addDays(scheduling.day, 1));
  const [proposals, setProposals] = useState([]);
  const [form, setForm] = useState({
    title: "",
    notes: "",
    slots: [{ date: tomorrow, startTime: "19:00", endTime: "22:00" }],
    games: [{ title: "", steamAppId: "" }],
    inviteIds: []
  });
  const [message, setMessage] = useState("");

  const load = useCallback(() => api("/api/proposals").then((payload) => setProposals(payload.proposals)), []);
  useEffect(() => { load().catch((error) => setMessage(error.message)); }, [load]);
  const updateItem = (key, index, patch) => setForm((current) => ({
    ...current,
    [key]: current[key].map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item)
  }));

  async function createProposal(event) {
    event.preventDefault();
    await api("/api/proposals", { method: "POST", body: JSON.stringify(form) });
    setForm({ ...form, title: "", notes: "" });
    setMessage("Proposal created.");
    load();
  }

  async function vote(id, patch) {
    await api(`/api/proposals/${id}/vote`, { method: "PUT", body: JSON.stringify(patch) });
    load();
  }

  async function finalize(id) {
    await api(`/api/proposals/${id}/finalize`, { method: "POST", body: JSON.stringify({}) });
    setMessage("Winning time and game turned into an event.");
    load();
  }

  async function remove(id) {
    await api(`/api/proposals/${id}`, { method: "DELETE" });
    load();
  }

  return (
    <>
      <header className="topbar"><div><h1>Proposals</h1><p>Vote on the date and game before committing to an event.</p></div></header>
      <div className="proposal-layout">
        <form className="table-panel proposal-form" onSubmit={createProposal}>
          <h2>New proposal</h2>
          <label>Title<input required value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} /></label>
          <label>Notes<textarea value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} /></label>
          <h3>Time options</h3>
          {form.slots.map((slot, index) => <div className="proposal-option-row" key={index}>
            <input type="date" value={slot.date} onChange={(event) => updateItem("slots", index, { date: event.target.value })} />
            <input type="time" value={slot.startTime} onChange={(event) => updateItem("slots", index, { startTime: event.target.value })} />
            <input type="time" value={slot.endTime} onChange={(event) => updateItem("slots", index, { endTime: event.target.value })} />
          </div>)}
          <button className="text-button inline-text-button" type="button" onClick={() => setForm({ ...form, slots: [...form.slots, { date: tomorrow, startTime: "19:00", endTime: "22:00" }] })}><Plus size={15} /> Add time</button>
          <h3>Game options</h3>
          {form.games.map((game, index) => <div className="proposal-option-row" key={index}>
            <input placeholder="Game title" value={game.title} onChange={(event) => updateItem("games", index, { title: event.target.value })} />
            <input placeholder="Steam app ID" inputMode="numeric" value={game.steamAppId} onChange={(event) => updateItem("games", index, { steamAppId: event.target.value })} />
          </div>)}
          <button className="text-button inline-text-button" type="button" onClick={() => setForm({ ...form, games: [...form.games, { title: "", steamAppId: "" }] })}><Plus size={15} /> Add game</button>
          <div className="invite-grid">{friends.map((friend) => <label key={friend.id}><input type="checkbox" checked={form.inviteIds.includes(friend.id)} onChange={() => setForm({ ...form, inviteIds: form.inviteIds.includes(friend.id) ? form.inviteIds.filter((id) => id !== friend.id) : [...form.inviteIds, friend.id] })} /> {friend.displayName}</label>)}</div>
          <button className="primary-button"><Vote size={16} /> Create proposal</button>
        </form>
        <div className="proposal-list">
          {proposals.map((proposal) => {
            const myVote = proposal.votes.find((voteItem) => voteItem.userId === user.id) || {};
            const canManage = proposal.ownerId === user.id || user.role === "admin";
            const canVote = proposal.status === "open" && proposal.inviteIds.includes(user.id);
            return <article className="table-panel proposal-card" key={proposal.id}>
              <div className="section-title compact-title"><div><h2>{proposal.title}</h2><p>By {proposal.ownerName} - {proposal.status}</p></div>{canManage && <button className="danger-button" onClick={() => remove(proposal.id)}><Trash2 size={15} /></button>}</div>
              {proposal.notes && <p>{proposal.notes}</p>}
              <h3>Times</h3>
              <div className="proposal-votes">{proposal.slots.map((slot) => <button className={myVote.slotId === slot.id ? "selected" : ""} disabled={!canVote} onClick={() => vote(proposal.id, { slotId: slot.id })} key={slot.id}><span>{formatDate(slot.date)} {slot.startTime}-{slot.endTime}</span><strong>{slot.voters.length}</strong></button>)}</div>
              {proposal.games.length > 0 && <><h3>Games</h3><div className="proposal-votes">{proposal.games.map((game) => <button className={myVote.gameId === game.id ? "selected" : ""} disabled={!canVote} onClick={() => vote(proposal.id, { gameId: game.id })} key={game.id}><span>{game.title}</span><strong>{game.voters.length}</strong></button>)}</div></>}
              {canManage && proposal.status === "open" && <button className="primary-button" onClick={() => finalize(proposal.id)}><Check size={16} /> Finalize winner</button>}
            </article>;
          })}
          {proposals.length === 0 && <section className="table-panel"><p className="muted">No proposals yet.</p></section>}
          {message && <p className="muted">{message}</p>}
        </div>
      </div>
    </>
  );
}

function GamesView({ games, searchGames }) {
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
      <header className="topbar">
        <div>
          <h1>Games</h1>
          <p>Search Steam directly and post suggestions to Discord.</p>
        </div>
      </header>
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

function DashboardView({ dashboard, setActiveView }) {
  if (!dashboard) {
    return (
      <>
        <header className="topbar"><div><h1>Dashboard</h1><p>Your next session and strongest overlaps.</p></div></header>
        <div className="dashboard-grid"><section className="table-panel"><Skeleton rows={4} /></section><section className="table-panel"><Skeleton rows={5} /></section></div>
      </>
    );
  }

  return (
    <>
      <header className="topbar">
        <div><h1>Dashboard</h1><p>Your next session, invites, and best times to play.</p></div>
        <button className="secondary-button" onClick={() => setActiveView("tonight")}><Zap size={16} /> Tonight</button>
      </header>
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
    </>
  );
}

function TonightView({ dashboard, setActiveView }) {
  const scheduling = useSchedulingTime();
  const tonight = dashboard?.tonight;
  const currentTime = scheduling.time;
  const available = tonight?.availability.filter((item) => item.endTime > currentTime) || [];
  const uniquePlayers = [...new Map(available.map((item) => [item.userId, item])).values()];

  return (
    <>
      <header className="topbar">
        <div><h1>Tonight</h1><p>A compact view of who is free and what is planned.</p></div>
        <button className="secondary-button" onClick={() => setActiveView("calendar")}><CalendarDays size={16} /> Full calendar</button>
      </header>
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
    </>
  );
}

function ProfileView({ user, onSaved }) {
  const [form, setForm] = useState({ ...user });
  const [message, setMessage] = useState("");
  const [subscription, setSubscription] = useState({ active: false, createdAt: null, lastUsedAt: null });
  const [subscriptionUrls, setSubscriptionUrls] = useState(null);
  const [subscriptionMessage, setSubscriptionMessage] = useState("");

  useEffect(() => {
    api("/api/calendar/subscription")
      .then((payload) => setSubscription(payload.subscription))
      .catch((error) => setSubscriptionMessage(error.message));
  }, []);

  async function save(event) {
    event.preventDefault();
    const payload = await api("/api/profile", { method: "PUT", body: JSON.stringify(form) });
    setForm(payload.profile);
    onSaved(payload.profile);
    setMessage("Profile saved.");
  }

  async function generateSubscription() {
    const payload = await api("/api/calendar/subscription", { method: "POST", body: JSON.stringify({}) });
    setSubscription(payload.subscription);
    setSubscriptionUrls({
      httpsUrl: payload.subscription.httpsUrl,
      webcalUrl: payload.subscription.webcalUrl
    });
    setSubscriptionMessage("Private live calendar link generated.");
  }

  async function copySubscription() {
    if (!subscriptionUrls?.httpsUrl) return;
    try {
      await navigator.clipboard.writeText(subscriptionUrls.httpsUrl);
      setSubscriptionMessage("Subscription URL copied.");
    } catch {
      setSubscriptionMessage("Copy failed. Select the URL manually.");
    }
  }

  async function revokeSubscription() {
    await api("/api/calendar/subscription", { method: "DELETE" });
    setSubscription({ active: false, createdAt: null, lastUsedAt: null });
    setSubscriptionUrls(null);
    setSubscriptionMessage("Live calendar link revoked.");
  }

  return (
    <>
      <header className="topbar"><div><h1>Profile</h1><p>Identity, gaming preferences, timezone, and appearance.</p></div></header>
      <form className="profile-editor" onSubmit={save}>
        <section className="profile-preview">
          <Avatar user={form} size="large" />
          <h2>{form.displayName}</h2>
          <span>@{form.username}</span>
          {form.discordUsername && <p>{form.discordUsername}</p>}
        </section>
        <section className="table-panel profile-fields">
          <div className="two-col">
            <label>Display name<input value={form.displayName} onChange={(event) => setForm({ ...form, displayName: event.target.value })} /></label>
            <label>Discord username<input value={form.discordUsername} onChange={(event) => setForm({ ...form, discordUsername: event.target.value })} /></label>
          </div>
          <label>Discord user ID<input inputMode="numeric" value={form.discordUserId || ""} onChange={(event) => setForm({ ...form, discordUserId: event.target.value })} /></label>
          <label>Avatar HTTPS URL<input value={form.avatarUrl} onChange={(event) => setForm({ ...form, avatarUrl: event.target.value })} /></label>
          <label>Favourite games<textarea value={form.favoriteGames} onChange={(event) => setForm({ ...form, favoriteGames: event.target.value })} /></label>
          <div className="two-col">
            <label>Timezone<input value={form.timezone} onChange={(event) => setForm({ ...form, timezone: event.target.value })} /></label>
            <label>Profile colour<input type="color" value={form.profileColor} onChange={(event) => setForm({ ...form, profileColor: event.target.value })} /></label>
          </div>
          <div className="two-col">
            <label>Preferred start<input type="time" value={form.preferredStart} onChange={(event) => setForm({ ...form, preferredStart: event.target.value })} /></label>
            <label>Preferred end<input type="time" value={form.preferredEnd} onChange={(event) => setForm({ ...form, preferredEnd: event.target.value })} /></label>
          </div>
          <div className="appearance-row">
            <label>Theme
              <select value={form.theme} onChange={(event) => setForm({ ...form, theme: event.target.value })}>
                <option value="dark">Dark</option><option value="light">Light</option><option value="system">System</option>
              </select>
            </label>
            <label>Accent colour<input type="color" value={form.accent} onChange={(event) => setForm({ ...form, accent: event.target.value })} /></label>
            <div className="theme-icons">{form.theme === "light" ? <Sun /> : <Moon />}</div>
          </div>
          <button className="primary-button"><Settings size={16} /> Save profile</button>
          {message && <p className="muted">{message}</p>}
        </section>
        <PushPreferences request={api} />
        <section className="table-panel calendar-subscription-panel">
          <div className="panel-heading">
            <RefreshCw size={18} />
            <div>
              <h2>Live calendar subscription</h2>
              <p>Events, your free time, and matching availability update through a private calendar feed.</p>
            </div>
            <span className={`subscription-state${subscription.active ? " active" : ""}`}>
              {subscription.active ? "Active" : "Off"}
            </span>
          </div>
          {subscription.active && (
            <div className="subscription-meta">
              <span>Created {subscription.createdAt ? new Date(`${subscription.createdAt}${subscription.createdAt.endsWith("Z") ? "" : "Z"}`).toLocaleString() : "recently"}</span>
              <span>{subscription.lastUsedAt ? `Last refreshed ${new Date(`${subscription.lastUsedAt}${subscription.lastUsedAt.endsWith("Z") ? "" : "Z"}`).toLocaleString()}` : "Not refreshed yet"}</span>
            </div>
          )}
          {subscriptionUrls && (
            <div className="subscription-url">
              <input aria-label="Private calendar subscription URL" readOnly value={subscriptionUrls.httpsUrl} />
              <button className="icon-button dark-icon-button" type="button" onClick={copySubscription} aria-label="Copy calendar subscription URL"><Copy size={17} /></button>
              <a className="secondary-button" href={subscriptionUrls.webcalUrl}><CalendarDays size={16} /> Subscribe</a>
            </div>
          )}
          {subscription.active && !subscriptionUrls && (
            <p className="muted">The existing private URL is hidden. Regenerate it to display and copy a new URL.</p>
          )}
          <div className="subscription-actions">
            <button className="primary-button" type="button" onClick={generateSubscription}>
              <RefreshCw size={16} /> {subscription.active ? "Regenerate private link" : "Generate private link"}
            </button>
            {subscription.active && (
              <button className="danger-text-button" type="button" onClick={revokeSubscription}><Unlink size={16} /> Revoke</button>
            )}
          </div>
          <p className="subscription-warning">Treat the subscription URL like a password. Regenerating or revoking it disconnects existing calendar apps.</p>
          {subscriptionMessage && <p className="muted">{subscriptionMessage}</p>}
        </section>
      </form>
    </>
  );
}


function App() {
  const [user, setUser] = useState(null);
  const [activeView, setActiveView] = useState(() => new URL(window.location.href).searchParams.get("view") === "events" ? "events" : "dashboard");
  const [loading, setLoading] = useState(true);
  const [dataLoading, setDataLoading] = useState(false);
  const [weekOffset, setWeekOffset] = useState(0);
  const [calendarMode, setCalendarMode] = useState("squad");
  const [clock, setClock] = useState(() => new Date());
  const [data, setData] = useState({ availability: [], events: [], games: [], friends: [], groups: [], dashboard: null });
  const searchRequestId = useRef(0);
  const refreshRequestId = useRef(0);

  const clearAccountData = useCallback(() => {
    searchRequestId.current += 1;
    refreshRequestId.current += 1;
    setData({ availability: [], events: [], games: [], friends: [], groups: [], dashboard: null });
    setDataLoading(false);
    setUser(null);
    setCalendarMode("squad");
  }, []);

  const searchGames = useCallback(async (query = "co-op") => {
    const requestId = ++searchRequestId.current;
    try {
      const payload = await api(`/api/games?q=${encodeURIComponent(query)}`);
      if (requestId !== searchRequestId.current) return;
      setData((current) => ({ ...current, games: payload.games }));
    } catch {
      if (requestId !== searchRequestId.current) return;
      setData((current) => ({ ...current, games: [] }));
    }
  }, []);

  const refresh = useCallback(async () => {
    const requestId = ++refreshRequestId.current;
    setDataLoading(true);
    try {
      const [availability, events, friends, groups, dashboard] = await Promise.all([
        api("/api/availability"),
        api("/api/events"),
        api("/api/friends"),
        api("/api/groups"),
        api("/api/dashboard")
      ]);
      if (requestId !== refreshRequestId.current) return;
      setData((current) => ({
        ...current,
        availability: availability.availability,
        events: events.events,
        friends: friends.users,
        groups: groups.groups,
        dashboard: dashboard.dashboard
      }));
    } catch {
      // Keep the signed-in shell usable if a secondary data request fails.
    } finally {
      if (requestId === refreshRequestId.current) setDataLoading(false);
    }
  }, []);

  useEffect(() => {
    api("/api/me")
      .then((payload) => setUser(payload.user))
      .catch(() => setUser(null))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    window.addEventListener("squadslot:session-expired", clearAccountData);
    return () => window.removeEventListener("squadslot:session-expired", clearAccountData);
  }, [clearAccountData]);

  useEffect(() => {
    if (user && !user.mustChangePassword) {
      refresh();
      searchGames();
    }
  }, [user, refresh, searchGames]);

  useEffect(() => {
    const timer = window.setInterval(() => setClock(new Date()), 30 * 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!user) return;
    const preferredTheme = user.theme === "system"
      ? (window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark")
      : user.theme;
    document.documentElement.dataset.theme = preferredTheme || "dark";
    document.documentElement.style.setProperty("--accent", user.accent || "#6bc9ed");
  }, [user]);

  async function logout() {
    await disableDevicePush(api).catch(() => {});
    await api("/api/auth/logout", { method: "POST" });
    clearAccountData();
  }

  async function refreshContext() {
    const payload = await api("/api/me");
    setUser(payload.user);
    await refresh();
  }

  if (loading) return <main className="loading"><Clock /> Loading</main>;
  if (!user) return <AuthScreen onSignedIn={setUser} />;
  if (user.mustChangePassword) return <PasswordChangeScreen user={user} onChanged={setUser} onLogout={logout} />;

  const visibleEvents = data.events.filter((event) => !eventHasEnded(event, clock));
  const visibleData = { ...data, events: visibleEvents };
  const visibleDashboardInvites = data.dashboard?.pendingInvites.filter((event) => !eventHasEnded(event, clock)) || [];
  const visibleDashboard = data.dashboard
    ? {
        ...data.dashboard,
        nextEvent: data.dashboard.nextEvent && !eventHasEnded(data.dashboard.nextEvent, clock)
          ? data.dashboard.nextEvent
          : null,
        pendingInvites: visibleDashboardInvites,
        pendingInviteCount: visibleEvents.filter((event) => event.invites.some((invite) => invite.userId === user.id && invite.status === "invited")).length,
        tonight: {
          ...data.dashboard.tonight,
          events: data.dashboard.tonight.events.filter((event) => !eventHasEnded(event, clock))
        }
      }
    : null;

  const pendingInviteCount = visibleEvents.filter((event) =>
    event.invites.some((invite) => invite.userId === user.id && invite.status === "invited")
  ).length;

  const squadTimezone = data.groups.find(group => group.id === user.activeGroupId)?.timezone || "Europe/London";
  return (
    <SchedulingTimezone.Provider value={squadTimezone}>
    <AppShell user={user} timezone={squadTimezone} groupName={data.groups.find(group => group.id === user.activeGroupId)?.name} activeView={activeView} setActiveView={setActiveView} pendingInviteCount={pendingInviteCount} onLogout={logout}>
        {activeView === "dashboard" && <DashboardView dashboard={visibleDashboard} setActiveView={setActiveView} />}
        {activeView === "calendar" && (
          <CalendarView
            key={user.activeGroupId}
            mode={calendarMode}
            setMode={setCalendarMode}
            user={user}
            data={visibleData}
            weekOffset={weekOffset}
            setWeekOffset={setWeekOffset}
            refresh={refresh}
            searchGames={searchGames}
            onManageAvailability={() => setActiveView("free-time")}
            onOpenEvents={() => setActiveView("events")}
          />
        )}
        {activeView === "tonight" && <TonightView dashboard={visibleDashboard} setActiveView={setActiveView} />}
        {activeView === "events" && (
          <EventsView
            user={user}
            events={visibleEvents}
            refresh={refresh}
            onOpenSubscription={() => setActiveView("profile")}
          />
        )}
        {activeView === "proposals" && <ProposalsView user={user} friends={data.friends} />}
        {activeView === "invites" && <InvitesView user={user} events={visibleEvents} refresh={refresh} />}
        {activeView === "free-time" && <FreeTimeView key={user.activeGroupId} user={user} availability={data.availability} refresh={refresh} onOpenCalendar={() => { setCalendarMode("personal"); setActiveView("calendar"); }} />}
        {activeView === "groups" && <GroupsView user={user} groups={data.groups} onChanged={refreshContext} />}
        {activeView === "friends" && <FriendsView friends={data.friends} availability={data.availability} events={visibleEvents} />}
        {activeView === "games" && <GamesView games={data.games} searchGames={searchGames} />}
        {activeView === "profile" && <ProfileView user={user} onSaved={setUser} />}
        {activeView === "admin" && user.role === "admin" && <AdminView user={user} />}
        {dataLoading && activeView !== "dashboard" && <div className="loading-indicator"><span /></div>}
    </AppShell>
    </SchedulingTimezone.Provider>
  );
}

createRoot(document.getElementById("root")).render(<App />);

if ("serviceWorker" in navigator && import.meta.env.PROD) {
  navigator.serviceWorker.register("/service-worker.js").catch(() => {});
}
