import React, { useCallback, useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  Clock,
  Trash2,
  Gamepad2,
  Link,
  LogOut,
  Bell,
  Plus,
  Search,
  Send,
  Settings,
  Shield,
  Sparkles,
  UsersRound
} from "lucide-react";
import "./styles.css";

const hours = ["18:00", "19:00", "20:00", "21:00", "22:00", "23:00"];

function startOfWeek(date = new Date()) {
  const day = date.getDay() || 7;
  const copy = new Date(date);
  copy.setDate(copy.getDate() - day + 1);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

function addDays(date, amount) {
  const copy = new Date(date);
  copy.setDate(copy.getDate() + amount);
  return copy;
}

function isoDate(date) {
  return date.toISOString().slice(0, 10);
}

function formatDay(date) {
  return new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric" }).format(date);
}

function useDebouncedSteamSearch(query, onSearchGames) {
  useEffect(() => {
    const normalized = query.trim();
    if (normalized.length < 2) return undefined;

    const timer = setTimeout(() => onSearchGames(normalized), 350);
    return () => clearTimeout(timer);
  }, [query, onSearchGames]);
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || "Something went wrong.");
  return payload;
}

function AuthScreen({ onSignedIn }) {
  const [mode, setMode] = useState("login");
  const [setupKnown, setSetupKnown] = useState(false);
  const [form, setForm] = useState({ username: "", displayName: "", password: "" });
  const [error, setError] = useState("");

  useEffect(() => {
    api("/api/setup")
      .then((payload) => setMode(payload.hasUsers ? "login" : "register"))
      .finally(() => setSetupKnown(true));
  }, []);

  async function submit(event) {
    event.preventDefault();
    setError("");
    try {
      const payload = await api(`/api/auth/${mode}`, { method: "POST", body: JSON.stringify(form) });
      onSignedIn(payload.user);
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <main className="auth-shell">
      <section className="auth-panel">
        <div className="brand-lockup">
          <span className="brand-mark"><Gamepad2 size={26} /></span>
          <span>SquadSlot</span>
        </div>
        <h1>Plan the next session without the chat scroll.</h1>
        <p>{mode === "register" ? "The first account created becomes the admin." : "Sign in to see the group calendar."}</p>
        {!setupKnown && <p className="muted">Checking setup...</p>}
        <form onSubmit={submit} className="auth-form">
          <label>
            Username
            <input value={form.username} onChange={(event) => setForm({ ...form, username: event.target.value })} />
          </label>
          {mode === "register" && (
            <label>
              Display name
              <input value={form.displayName} onChange={(event) => setForm({ ...form, displayName: event.target.value })} />
            </label>
          )}
          <label>
            Password
            <input type="password" value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} />
          </label>
          {error && <p className="form-error">{error}</p>}
          <button className="primary-button" type="submit">{mode === "login" ? "Sign in" : "Create account"}</button>
        </form>
        <button className="text-button" onClick={() => setMode(mode === "login" ? "register" : "login")}>
          {mode === "login" ? "Need an account?" : "Already have an account?"}
        </button>
      </section>
    </main>
  );
}

function Sidebar({ user, activeView, setActiveView, onLogout }) {
  const nav = [
    ["calendar", "Calendar", CalendarDays],
    ["events", "Events", Clock],
    ["friends", "Friends", UsersRound],
    ["games", "Games", Gamepad2],
    ...(user.role === "admin" ? [["admin", "Admin", Shield]] : [])
  ];

  return (
    <aside className="sidebar">
      <div className="brand-lockup compact">
        <span className="brand-mark"><Gamepad2 size={22} /></span>
        <span>SquadSlot</span>
      </div>
      <nav>
        {nav.map(([id, label, Icon]) => (
          <button className={activeView === id ? "active" : ""} key={id} onClick={() => setActiveView(id)}>
            <Icon size={18} /> {label}
          </button>
        ))}
      </nav>
      <div className="profile">
        <div>
          <strong>{user.displayName}</strong>
          <span>@{user.username} {user.role === "admin" ? "- admin" : ""}</span>
        </div>
        <button onClick={onLogout} aria-label="Sign out"><LogOut size={18} /></button>
      </div>
    </aside>
  );
}

function EventPopover({ event }) {
  const accepted = event.invites.filter((invite) => invite.status === "accepted");
  const tentative = event.invites.filter((invite) => invite.status === "tentative");

  return (
    <div className="event-popover" role="tooltip">
      <strong>{event.title}</strong>
      <span>{event.gameTitle || "Game TBD"}</span>
      <span>{event.date}, {event.startTime} to {event.endTime}</span>
      <span>Created by {event.ownerName}</span>
      <div>
        <small>Accepted</small>
        <p>{accepted.map((invite) => invite.displayName).join(", ") || "No one yet"}</p>
      </div>
      {tentative.length > 0 && (
        <div>
          <small>Tentative</small>
          <p>{tentative.map((invite) => invite.displayName).join(", ")}</p>
        </div>
      )}
    </div>
  );
}

function CalendarGrid({ days, availability, events }) {
  return (
    <section className="calendar-panel">
      <div className="section-title">
        <div>
          <h2>Shared calendar</h2>
          <p>Availability and invites for this week.</p>
        </div>
        <span className="live-chip"><Sparkles size={15} /> Tonight</span>
      </div>
      <div className="calendar-grid">
        <div className="time-col" />
        {days.map((day) => <div className="day-head" key={day.toISOString()}>{formatDay(day)}</div>)}
        {hours.map((hour) => (
          <React.Fragment key={hour}>
            <div className="time-cell">{hour}</div>
            {days.map((day) => {
              const date = isoDate(day);
              const dayAvailability = availability.filter((item) => item.date === date && item.startTime <= hour && item.endTime > hour);
              const dayEvents = events.filter((item) => item.date === date && item.startTime <= hour && item.endTime > hour);
              return (
                <div className="slot" key={`${date}-${hour}`}>
                  {dayAvailability.slice(0, 2).map((item) => (
                    <div className="availability-block" key={`a-${item.id}`}>
                      <strong>{item.displayName}</strong>
                      <span>{item.note || "Free"}</span>
                    </div>
                  ))}
                  {dayEvents.slice(0, 1).map((item) => (
                    <div className="event-block event-with-popover" key={`e-${item.id}`} tabIndex={0}>
                      <strong>{item.title}</strong>
                      <span>{item.gameTitle || "Game TBD"}</span>
                      <EventPopover event={item} />
                    </div>
                  ))}
                </div>
              );
            })}
          </React.Fragment>
        ))}
      </div>
    </section>
  );
}

function EventList({ user, events, refresh }) {
  async function removeEvent(eventId) {
    await api(`/api/events/${eventId}`, { method: "DELETE" });
    refresh();
  }

  if (events.length === 0) {
    return (
      <section className="table-panel">
        <h3>Sessions</h3>
        <p className="muted">No sessions created yet.</p>
      </section>
    );
  }

  return (
    <section className="table-panel">
      <h3>Sessions</h3>
      <div className="session-list">
        {events.slice(0, 8).map((event) => {
          const canDelete = event.ownerId === user.id || user.role === "admin";
          return (
            <article className="session-row" key={event.id}>
              <div>
                <strong>{event.title}</strong>
                <span>{event.gameTitle || "Game TBD"} - {event.date}, {event.startTime} to {event.endTime}</span>
              </div>
              {canDelete && (
                <button className="danger-button" onClick={() => removeEvent(event.id)} aria-label={`Remove ${event.title}`}>
                  <Trash2 size={16} />
                </button>
              )}
            </article>
          );
        })}
      </div>
    </section>
  );
}

function AvailabilityForm({ selectedDate, onCreated }) {
  const [form, setForm] = useState({ date: selectedDate, startTime: "19:00", endTime: "22:00", note: "" });

  useEffect(() => setForm((current) => ({ ...current, date: selectedDate })), [selectedDate]);

  async function submit(event) {
    event.preventDefault();
    await api("/api/availability", { method: "POST", body: JSON.stringify(form) });
    setForm({ ...form, note: "" });
    onCreated();
  }

  return (
    <form className="utility-form" onSubmit={submit}>
      <h3>Log free time</h3>
      <input type="date" value={form.date} onChange={(event) => setForm({ ...form, date: event.target.value })} />
      <div className="two-col">
        <input type="time" value={form.startTime} onChange={(event) => setForm({ ...form, startTime: event.target.value })} />
        <input type="time" value={form.endTime} onChange={(event) => setForm({ ...form, endTime: event.target.value })} />
      </div>
      <input placeholder="Note" value={form.note} onChange={(event) => setForm({ ...form, note: event.target.value })} />
      <button className="secondary-button" type="submit"><Check size={16} /> Save</button>
    </form>
  );
}

function EventForm({ games, friends, selectedDate, onSearchGames, onCreated }) {
  const [form, setForm] = useState({
    title: "New session",
    steamAppId: "",
    gameTitle: "",
    date: selectedDate,
    startTime: "20:00",
    endTime: "22:30",
    inviteIds: []
  });
  const [query, setQuery] = useState("co-op");

  useDebouncedSteamSearch(query, onSearchGames);
  useEffect(() => setForm((current) => ({ ...current, date: selectedDate })), [selectedDate]);

  function chooseGame(appId) {
    const game = games.find((item) => item.appId === Number(appId));
    setForm({ ...form, steamAppId: game?.appId || "", gameTitle: game?.title || "" });
  }

  async function submit(event) {
    event.preventDefault();
    await api("/api/events", { method: "POST", body: JSON.stringify(form) });
    onCreated();
  }

  function toggleFriend(id) {
    const inviteIds = form.inviteIds.includes(id)
      ? form.inviteIds.filter((item) => item !== id)
      : [...form.inviteIds, id];
    setForm({ ...form, inviteIds });
  }

  return (
    <form className="session-drawer" onSubmit={submit}>
      <div className="drawer-head">
        <div>
          <h3>New session</h3>
          <p>Search Steam, pick a game, invite friends.</p>
        </div>
        <Plus size={18} />
      </div>
      <input value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} />
      <div className="search-inline">
        <input placeholder="Search Steam" value={query} onChange={(event) => setQuery(event.target.value)} />
        <button type="button" onClick={() => onSearchGames(query)} aria-label="Search games"><Search size={17} /></button>
      </div>
      <select value={form.steamAppId} onChange={(event) => chooseGame(event.target.value)}>
        <option value="">Pick a Steam game</option>
        {games.map((game) => <option value={game.appId} key={game.appId}>{game.title}</option>)}
      </select>
      <input type="date" value={form.date} onChange={(event) => setForm({ ...form, date: event.target.value })} />
      <div className="two-col">
        <input type="time" value={form.startTime} onChange={(event) => setForm({ ...form, startTime: event.target.value })} />
        <input type="time" value={form.endTime} onChange={(event) => setForm({ ...form, endTime: event.target.value })} />
      </div>
      <div className="invite-list">
        <span>Invite friends</span>
        {friends.length === 0 && <small>No other accounts yet.</small>}
        {friends.map((friend) => (
          <button type="button" className={form.inviteIds.includes(friend.id) ? "selected" : ""} onClick={() => toggleFriend(friend.id)} key={friend.id}>
            {friend.displayName}
          </button>
        ))}
      </div>
      <button className="primary-button" type="submit"><Send size={16} /> Create invite</button>
    </form>
  );
}

function CalendarView({ user, data, weekOffset, setWeekOffset, refresh, searchGames }) {
  const weekStart = useMemo(() => addDays(startOfWeek(), weekOffset * 7), [weekOffset]);
  const days = useMemo(() => Array.from({ length: 7 }, (_, index) => addDays(weekStart, index)), [weekStart]);

  return (
    <>
      <header className="topbar">
        <div>
          <h1>Calendar</h1>
          <p>{formatDay(days[0])} to {formatDay(days[6])}</p>
        </div>
        <div className="toolbar">
          <button className="icon-button" onClick={() => setWeekOffset(weekOffset - 1)} aria-label="Previous week"><ChevronLeft /></button>
          <button className="secondary-button" onClick={() => setWeekOffset(0)}>Today</button>
          <button className="icon-button" onClick={() => setWeekOffset(weekOffset + 1)} aria-label="Next week"><ChevronRight /></button>
        </div>
      </header>
      <div className="content-layout">
        <div className="main-stack">
          <CalendarGrid days={days} availability={data.availability} events={data.events} />
          <AvailabilityForm selectedDate={isoDate(days[0])} onCreated={refresh} />
        </div>
        <div className="side-stack">
          <EventForm games={data.games} friends={data.friends} selectedDate={isoDate(days[0])} onSearchGames={searchGames} onCreated={refresh} />
          <GameRail games={data.games} onSearchGames={searchGames} />
          <EventList user={user} events={data.events} refresh={refresh} />
        </div>
      </div>
    </>
  );
}

function GameRail({ games, onSearchGames }) {
  const [query, setQuery] = useState("co-op");
  useDebouncedSteamSearch(query, onSearchGames);

  return (
    <aside className="right-rail">
      <section>
        <h3>Steam games</h3>
        <form className="suggest-form" onSubmit={(event) => { event.preventDefault(); onSearchGames(query); }}>
          <input placeholder="Search Steam" value={query} onChange={(event) => setQuery(event.target.value)} />
          <button aria-label="Search Steam"><Search size={17} /></button>
        </form>
        <div className="game-list">
          {games.slice(0, 6).map((game) => (
            <article key={game.appId}>
              {game.image ? <img src={game.image} alt="" /> : <Gamepad2 size={17} />}
              <div>
                <strong>{game.title}</strong>
                <span>{game.price || "Steam app"} - #{game.appId}</span>
              </div>
            </article>
          ))}
        </div>
      </section>
    </aside>
  );
}

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
              <div>
                <strong>{friend.displayName}</strong>
                <span>@{friend.username}</span>
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

function InvitesView({ user, events, refresh }) {
  const invites = events
    .filter((event) => event.invites.some((invite) => invite.userId === user.id))
    .map((event) => ({
      ...event,
      myInvite: event.invites.find((invite) => invite.userId === user.id)
    }));

  async function setStatus(eventId, status) {
    await api(`/api/events/${eventId}/invites/me`, { method: "PATCH", body: JSON.stringify({ status }) });
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
          <article className="invite-row" key={event.id}>
            <div>
              <strong>{event.title}</strong>
              <span>{event.gameTitle || "Game TBD"} - {event.date}, {event.startTime} to {event.endTime}</span>
              <small>From {event.ownerName} - current: {event.myInvite.status}</small>
            </div>
            <div className="invite-actions">
              <button className={event.myInvite.status === "accepted" ? "selected" : ""} onClick={() => setStatus(event.id, "accepted")}>Accept</button>
              <button className={event.myInvite.status === "tentative" ? "selected" : ""} onClick={() => setStatus(event.id, "tentative")}>Tentative</button>
              <button className={event.myInvite.status === "declined" ? "selected danger" : "danger"} onClick={() => setStatus(event.id, "declined")}>Decline</button>
            </div>
          </article>
        ))}
      </section>
    </>
  );
}

function EventsView({ user, events, refresh }) {
  const managedEvents = events
    .filter((event) => {
      const mine = event.invites.find((invite) => invite.userId === user.id);
      return event.ownerId === user.id || ["accepted", "tentative"].includes(mine?.status) || user.role === "admin";
    })
    .sort((a, b) => `${a.date} ${a.startTime}`.localeCompare(`${b.date} ${b.startTime}`));

  async function removeEvent(eventId) {
    await api(`/api/events/${eventId}`, { method: "DELETE" });
    refresh();
  }

  return (
    <>
      <header className="topbar">
        <div>
          <h1>Events</h1>
          <p>Manage sessions you created, accepted, or marked tentative.</p>
        </div>
      </header>
      <section className="table-panel">
        {managedEvents.length === 0 && <p className="muted">No accepted or tentative events yet.</p>}
        <div className="event-management-list">
          {managedEvents.map((event) => {
            const myInvite = event.invites.find((invite) => invite.userId === user.id);
            const accepted = event.invites.filter((invite) => invite.status === "accepted");
            const canDelete = event.ownerId === user.id || user.role === "admin";
            return (
              <article className="managed-event" key={event.id}>
                <div>
                  <strong>{event.title}</strong>
                  <span>{event.gameTitle || "Game TBD"} - {event.date}, {event.startTime} to {event.endTime}</span>
                  <small>Owner: {event.ownerName} - Your status: {myInvite?.status || "creator"}</small>
                </div>
                <div className="accepted-people">
                  <span>Accepted</span>
                  <p>{accepted.map((invite) => invite.displayName).join(", ") || "No one yet"}</p>
                </div>
                {canDelete && (
                  <button className="danger-button" onClick={() => removeEvent(event.id)} aria-label={`Remove ${event.title}`}>
                    <Trash2 size={16} />
                  </button>
                )}
              </article>
            );
          })}
        </div>
      </section>
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
    await api("/api/games/suggest", { method: "POST", body: JSON.stringify({ steamAppId: game.appId, title: game.title }) });
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
                {game.image ? <img src={game.image} alt="" /> : <span className="image-fallback"><Gamepad2 /></span>}
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
                {selected.image && <img src={selected.image} alt="" />}
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

function AdminView({ user }) {
  const [users, setUsers] = useState([]);
  const [settings, setSettings] = useState({ appUrl: "", discordWebhookUrl: "", discordBotName: "SquadSlot" });
  const [message, setMessage] = useState("");

  async function load() {
    const [usersPayload, settingsPayload] = await Promise.all([api("/api/admin/users"), api("/api/admin/settings")]);
    setUsers(usersPayload.users);
    setSettings(settingsPayload.settings);
  }

  useEffect(() => { load(); }, []);

  async function saveSettings(event) {
    event.preventDefault();
    await api("/api/admin/settings", { method: "PUT", body: JSON.stringify(settings) });
    setMessage("Settings saved.");
  }

  async function setRole(id, role) {
    await api(`/api/admin/users/${id}`, { method: "PATCH", body: JSON.stringify({ role }) });
    load();
  }

  return (
    <>
      <header className="topbar">
        <div>
          <h1>Admin</h1>
          <p>Manage accounts and Discord channel updates.</p>
        </div>
      </header>
      <div className="admin-grid">
        <section className="table-panel">
          <h2>Accounts</h2>
          {users.map((account) => (
            <article className="friend-row" key={account.id}>
              <div>
                <strong>{account.displayName}</strong>
                <span>@{account.username}</span>
              </div>
              <div>{account.availabilityCount} free slots</div>
              <select value={account.role} disabled={account.id === user.id && account.role === "admin"} onChange={(event) => setRole(account.id, event.target.value)}>
                <option value="user">User</option>
                <option value="admin">Admin</option>
              </select>
            </article>
          ))}
        </section>
        <form className="table-panel admin-form" onSubmit={saveSettings}>
          <h2>Discord</h2>
          <label>
            App URL
            <input value={settings.appUrl} onChange={(event) => setSettings({ ...settings, appUrl: event.target.value })} />
          </label>
          <label>
            Webhook URL
            <input value={settings.discordWebhookUrl} onChange={(event) => setSettings({ ...settings, discordWebhookUrl: event.target.value })} />
          </label>
          <label>
            Bot name
            <input value={settings.discordBotName} onChange={(event) => setSettings({ ...settings, discordBotName: event.target.value })} />
          </label>
          <button className="primary-button"><Settings size={16} /> Save settings</button>
          {message && <p className="muted">{message}</p>}
        </form>
      </div>
    </>
  );
}

function App() {
  const [user, setUser] = useState(null);
  const [activeView, setActiveView] = useState("calendar");
  const [loading, setLoading] = useState(true);
  const [weekOffset, setWeekOffset] = useState(0);
  const [data, setData] = useState({ availability: [], events: [], games: [], friends: [] });

  const searchGames = useCallback(async (query = "co-op") => {
    try {
      const payload = await api(`/api/games?q=${encodeURIComponent(query)}`);
      setData((current) => ({ ...current, games: payload.games }));
    } catch {
      setData((current) => ({ ...current, games: [] }));
    }
  }, []);

  const refresh = useCallback(async () => {
    try {
      const [availability, events, friends] = await Promise.all([
        api("/api/availability"),
        api("/api/events"),
        api("/api/friends")
      ]);
      setData((current) => ({ ...current, availability: availability.availability, events: events.events, friends: friends.users }));
    } catch {
      // Keep the signed-in shell usable if a secondary data request fails.
    }
  }, []);

  useEffect(() => {
    api("/api/me")
      .then((payload) => setUser(payload.user))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (user) {
      refresh();
      searchGames();
    }
  }, [user, refresh, searchGames]);

  async function logout() {
    await api("/api/auth/logout", { method: "POST" });
    setUser(null);
  }

  if (loading) return <main className="loading"><Clock /> Loading</main>;
  if (!user) return <AuthScreen onSignedIn={setUser} />;

  const pendingInviteCount = data.events.filter((event) =>
    event.invites.some((invite) => invite.userId === user.id && invite.status === "invited")
  ).length;

  return (
    <div className="app-shell">
      <Sidebar user={user} activeView={activeView} setActiveView={setActiveView} onLogout={logout} />
      <main className="workspace">
        <button className="bell-button" onClick={() => setActiveView("invites")} aria-label="Open invites">
          <Bell size={18} />
          {pendingInviteCount > 0 && <span>{pendingInviteCount}</span>}
        </button>
        {activeView === "calendar" && <CalendarView user={user} data={data} weekOffset={weekOffset} setWeekOffset={setWeekOffset} refresh={refresh} searchGames={searchGames} />}
        {activeView === "events" && <EventsView user={user} events={data.events} refresh={refresh} />}
        {activeView === "invites" && <InvitesView user={user} events={data.events} refresh={refresh} />}
        {activeView === "friends" && <FriendsView friends={data.friends} availability={data.availability} events={data.events} />}
        {activeView === "games" && <GamesView games={data.games} searchGames={searchGames} />}
        {activeView === "admin" && user.role === "admin" && <AdminView user={user} />}
      </main>
    </div>
  );
}

createRoot(document.getElementById("root")).render(<App />);
