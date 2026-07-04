import React, { useCallback, useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  CalendarDays,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Clock,
  Copy,
  Download,
  Dices,
  Trash2,
  Gamepad2,
  Link,
  LayoutDashboard,
  KeyRound,
  LogOut,
  Bell,
  MessageSquare,
  Moon,
  Plus,
  Repeat,
  RefreshCw,
  Search,
  Send,
  Settings,
  Shield,
  Sparkles,
  Sun,
  UserRound,
  Unlink,
  Vote,
  Zap,
  UsersRound
} from "lucide-react";
import "./styles.css";

const calendarStartHour = 17;
const calendarEndHour = 24;
const hours = Array.from({ length: calendarEndHour - calendarStartHour }, (_, index) => (
  `${String(calendarStartHour + index).padStart(2, "0")}:00`
));

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

function nextWeekday(weekday) {
  const date = new Date();
  const delta = (weekday - date.getDay() + 7) % 7;
  date.setDate(date.getDate() + delta);
  return localDate(date);
}

function localDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatDay(date) {
  return new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric" }).format(date);
}

function formatDate(value, options = { weekday: "short", day: "numeric", month: "short" }) {
  return new Intl.DateTimeFormat("en-GB", options).format(new Date(`${value}T12:00:00`));
}

function eventHasEnded(event, now = new Date()) {
  return new Date(`${event.date}T${event.endTime}:00`).getTime() <= now.getTime();
}

function addTime(time, hoursToAdd) {
  const [hours, minutes] = time.split(":").map(Number);
  const total = Math.min((23 * 60) + 59, (hours * 60) + minutes + (hoursToAdd * 60));
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

function timeMinutes(time) {
  const [hour, minute] = time.split(":").map(Number);
  return (hour * 60) + minute;
}

function calendarPlacement(startTime, endTime) {
  const start = Math.max(calendarStartHour * 60, timeMinutes(startTime));
  const end = Math.min(calendarEndHour * 60, timeMinutes(endTime));
  const total = (calendarEndHour - calendarStartHour) * 60;
  return {
    top: `${((start - (calendarStartHour * 60)) / total) * 100}%`,
    height: `${Math.max(0, ((end - start) / total) * 100)}%`
  };
}

function eventDurationHours(event) {
  const [startHour, startMinute] = event.startTime.split(":").map(Number);
  const [endHour, endMinute] = event.endTime.split(":").map(Number);
  return Math.max(1, Math.ceil(((endHour * 60 + endMinute) - (startHour * 60 + startMinute)) / 60));
}

function Avatar({ user, size = "medium" }) {
  const name = user.displayName || user.ownerName || "?";
  if (user.avatarUrl || user.ownerAvatarUrl) {
    return <img className={`avatar avatar-${size}`} src={user.avatarUrl || user.ownerAvatarUrl} alt="" />;
  }
  return (
    <span className={`avatar avatar-${size} avatar-initials`} style={{ "--avatar-color": user.profileColor || user.ownerColor || "#2fd3ba" }}>
      {name.slice(0, 2).toUpperCase()}
    </span>
  );
}

function Skeleton({ rows = 3 }) {
  return (
    <div className="skeleton-list" aria-label="Loading">
      {Array.from({ length: rows }, (_, index) => <span className="skeleton-row" key={index} />)}
    </div>
  );
}

function SteamImage({ src, alt = "", className = "" }) {
  const [failedSrc, setFailedSrc] = useState("");

  if (!src || failedSrc === src) {
    return <span className={`image-fallback ${className}`.trim()}><Gamepad2 size={18} /></span>;
  }

  return <img className={className} src={src} alt={alt} onError={() => setFailedSrc(src)} />;
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
  if (response.status === 401 && !path.startsWith("/api/auth/")) {
    window.dispatchEvent(new window.Event("squadslot:session-expired"));
  }
  if (!response.ok) {
    const error = new Error(payload.error || "Something went wrong.");
    Object.assign(error, payload);
    throw error;
  }
  return payload;
}

function PasswordChangeScreen({ user, onChanged, onLogout }) {
  const [form, setForm] = useState({ currentPassword: "", newPassword: "", confirmPassword: "" });
  const [error, setError] = useState("");

  async function submit(event) {
    event.preventDefault();
    setError("");
    if (form.newPassword !== form.confirmPassword) {
      setError("New passwords do not match.");
      return;
    }

    try {
      const payload = await api("/api/me/password", {
        method: "PUT",
        body: JSON.stringify({ currentPassword: form.currentPassword, newPassword: form.newPassword })
      });
      onChanged(payload.user);
    } catch (changeError) {
      setError(changeError.message);
    }
  }

  return (
    <main className="auth-shell">
      <section className="auth-panel password-change-panel">
        <div className="brand-lockup"><img className="brand-logo" src="/squadslot-logo-transparent.png" alt="SquadSlot" /></div>
        <div className="password-change-heading">
          <KeyRound size={22} />
          <div>
            <h1>Choose a new password</h1>
            <p>Signed in as {user.displayName}. Replace the temporary password to continue.</p>
          </div>
        </div>
        <form className="auth-form" onSubmit={submit}>
          <label>Temporary password<input type="password" autoComplete="current-password" value={form.currentPassword} onChange={(event) => setForm({ ...form, currentPassword: event.target.value })} /></label>
          <label>New password<input type="password" autoComplete="new-password" value={form.newPassword} onChange={(event) => setForm({ ...form, newPassword: event.target.value })} /></label>
          <label>Confirm new password<input type="password" autoComplete="new-password" value={form.confirmPassword} onChange={(event) => setForm({ ...form, confirmPassword: event.target.value })} /></label>
          {error && <p className="form-error">{error}</p>}
          <button className="primary-button" type="submit"><KeyRound size={16} /> Save new password</button>
        </form>
        <button className="text-button" type="button" onClick={onLogout}>Sign out</button>
      </section>
    </main>
  );
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
          <img className="brand-logo" src="/squadslot-logo-transparent.png" alt="SquadSlot" />
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
    ["dashboard", "Dashboard", LayoutDashboard],
    ["calendar", "Calendar", CalendarDays],
    ["tonight", "Tonight", Zap],
    ["events", "Events", Clock],
    ["proposals", "Proposals", Vote],
    ["free-time", "Free Time", Check],
    ["groups", "Squads", UsersRound],
    ["friends", "Friends", UsersRound],
    ["games", "Games", Gamepad2],
    ["profile", "Profile", UserRound],
    ...(user.role === "admin" ? [["admin", "Admin", Shield]] : [])
  ];

  return (
    <aside className="sidebar">
      <div className="brand-lockup compact">
        <img className="brand-logo" src="/squadslot-logo-transparent.png" alt="SquadSlot" />
      </div>
      <nav>
        {nav.map(([id, label, Icon]) => (
          <button className={activeView === id ? "active" : ""} key={id} onClick={() => setActiveView(id)}>
            <Icon size={18} /> {label}
          </button>
        ))}
      </nav>
      <div className="profile">
        <div className="profile-identity">
          <Avatar user={user} size="small" />
          <div>
          <strong>{user.displayName}</strong>
          <span>@{user.username} {user.role === "admin" ? "- admin" : ""}</span>
          </div>
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
      <span>{accepted.length}/{event.maxPlayers} accepted, minimum {event.minPlayers}</span>
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

function AvailabilityPopover({ freeItems }) {
  return (
    <div className="availability-popover" role="tooltip">
      <strong>Free players</strong>
      {freeItems.map((item) => (
        <div key={item.id}>
          <span className="person-line"><Avatar user={item} size="tiny" /> {item.displayName}</span>
          <small>{item.startTime} to {item.endTime}{item.note ? ` - ${item.note}` : ""}</small>
        </div>
      ))}
    </div>
  );
}

function samePlayers(left, right) {
  return left.length === right.length && left.every((id, index) => id === right[index]);
}

function availabilityBlocksForDay(date, availability, events, bestSlots) {
  const dayAvailability = availability.filter((item) => item.date === date);
  const dayEvents = events.filter((item) => item.date === date);
  const minMinute = calendarStartHour * 60;
  const maxMinute = calendarEndHour * 60;
  const boundaries = new Set([minMinute, maxMinute]);

  for (const item of [...dayAvailability, ...dayEvents]) {
    boundaries.add(Math.max(minMinute, Math.min(maxMinute, timeMinutes(item.startTime))));
    boundaries.add(Math.max(minMinute, Math.min(maxMinute, timeMinutes(item.endTime))));
  }
  for (let hour = calendarStartHour; hour <= calendarEndHour; hour += 1) boundaries.add(hour * 60);

  const ordered = [...boundaries].sort((a, b) => a - b);
  const bestMinutes = bestSlots.filter((slot) => slot.date === date).map((slot) => timeMinutes(slot.startTime));
  const blocks = [];

  for (let index = 0; index < ordered.length - 1; index += 1) {
    const start = ordered[index];
    const end = ordered[index + 1];
    if (start >= end || end <= minMinute || start >= maxMinute) continue;
    const committed = new Set(
      dayEvents
        .filter((event) => timeMinutes(event.startTime) < end && timeMinutes(event.endTime) > start)
        .flatMap((event) => event.invites
          .filter((invite) => ["accepted", "tentative"].includes(invite.status))
          .map((invite) => invite.userId))
    );
    const freeItems = [...new Map(
      dayAvailability
        .filter((item) => timeMinutes(item.startTime) < end && timeMinutes(item.endTime) > start && !committed.has(item.userId))
        .map((item) => [item.userId, item])
    ).values()];
    if (freeItems.length === 0) continue;
    const playerIds = freeItems.map((item) => item.userId).sort((a, b) => a - b);
    const isBest = bestMinutes.some((minute) => minute >= start && minute < end);
    const previous = blocks.at(-1);

    if (previous && previous.end === start && previous.isBest === isBest && samePlayers(previous.playerIds, playerIds)) {
      previous.end = end;
    } else {
      blocks.push({ start, end, freeItems, playerIds, isBest });
    }
  }
  return blocks;
}

function minutesLabel(value) {
  if (value >= calendarEndHour * 60) return "24:00";
  return `${String(Math.floor(value / 60)).padStart(2, "0")}:${String(value % 60).padStart(2, "0")}`;
}

function CalendarGrid({ user, days, availability, events, bestSlots, onAvailabilityDraft, onReschedule }) {
  const [dragSelection, setDragSelection] = useState(null);
  const [selectedDate, setSelectedDate] = useState(() => {
    const today = localDate(new Date());
    const visibleDates = new Set(days.map(localDate));
    return visibleDates.has(today) ? today : events.find((event) => visibleDates.has(event.date))?.date || localDate(days[0]);
  });

  useEffect(() => {
    const visibleDates = new Set(days.map(localDate));
    if (!visibleDates.has(selectedDate)) {
      const today = localDate(new Date());
      setSelectedDate(visibleDates.has(today) ? today : events.find((event) => visibleDates.has(event.date))?.date || localDate(days[0]));
    }
  }, [days, events, selectedDate]);

  function finishAvailabilityDrag() {
    if (!dragSelection) return;
    const firstDayIndex = Math.min(dragSelection.startDayIndex, dragSelection.endDayIndex);
    const lastDayIndex = Math.max(dragSelection.startDayIndex, dragSelection.endDayIndex);
    const selectedDays = days.slice(firstDayIndex, lastDayIndex + 1);
    const startHour = Math.min(dragSelection.startHour, dragSelection.endHour);
    const endHour = Math.max(dragSelection.startHour, dragSelection.endHour);
    onAvailabilityDraft({
      mode: selectedDays.length > 1 ? "weekly" : "once",
      date: localDate(selectedDays[0]),
      dates: selectedDays.map(localDate),
      weekdays: [...new Set(selectedDays.map((day) => day.getDay()))],
      startDate: localDate(selectedDays[0]),
      startTime: `${String(startHour).padStart(2, "0")}:00`,
      endTime: endHour >= 23 ? "23:59" : `${String(endHour + 1).padStart(2, "0")}:00`
    });
    setDragSelection(null);
  }

  useEffect(() => {
    function handleMouseUp() {
      finishAvailabilityDrag();
    }
    window.addEventListener("mouseup", handleMouseUp);
    return () => window.removeEventListener("mouseup", handleMouseUp);
  });

  const maxOverlap = Math.max(1, ...bestSlots.map((slot) => slot.count));

  return (
    <section className="calendar-panel pulse-calendar-panel">
      <div className="best-slot-runway">
        <strong><Sparkles size={16} /> Best slots this week</strong>
        <div>
          {bestSlots.slice(0, 3).map((slot, index) => (
            <button
              type="button"
              onClick={() => onAvailabilityDraft({ mode: "once", date: slot.date, startTime: slot.startTime, endTime: slot.endTime })}
              key={`${slot.date}-${slot.startTime}`}
            >
              <span>{index + 1}</span>
              <b>{formatDate(slot.date, { weekday: "short" })} {slot.startTime}</b>
              <small>{slot.count} free</small>
            </button>
          ))}
          {bestSlots.length === 0 ? <small className="runway-empty">Add availability to reveal the strongest overlap.</small> : null}
        </div>
      </div>
      <div className={`pulse-calendar-scroll pulse-days-${days.length}`}>
        <div className="pulse-week-head">
          <span />
          {days.map((day) => {
            const date = localDate(day);
            return <button className={date === selectedDate ? "selected" : ""} onClick={() => setSelectedDate(date)} key={date}>{formatDay(day)}</button>;
          })}
        </div>
        <div className="pulse-calendar-body">
          <div className="pulse-time-axis">
            {Array.from({ length: (calendarEndHour - calendarStartHour) + 1 }, (_, index) => (
              <span style={{ top: `${(index / (calendarEndHour - calendarStartHour)) * 100}%` }} key={index}>
                {String(calendarStartHour + index).padStart(2, "0")}:00
              </span>
            ))}
          </div>
          <div className="pulse-day-grid">
            {days.map((day, dayIndex) => {
              const date = localDate(day);
              const dayEvents = events.filter((item) => item.date === date && timeMinutes(item.endTime) > calendarStartHour * 60 && timeMinutes(item.startTime) < calendarEndHour * 60);
              const availabilityBlocks = availabilityBlocksForDay(date, availability, events, bestSlots);
              return (
                <div className={`pulse-day-column${date === selectedDate ? " selected" : ""}`} key={date}>
                  <div className="pulse-hour-slots">
                    {hours.map((hour) => {
                      const hourNumber = Number(hour.slice(0, 2));
                      const selected = dragSelection
                        && dayIndex >= Math.min(dragSelection.startDayIndex, dragSelection.endDayIndex)
                        && dayIndex <= Math.max(dragSelection.startDayIndex, dragSelection.endDayIndex)
                        && hourNumber >= Math.min(dragSelection.startHour, dragSelection.endHour)
                        && hourNumber <= Math.max(dragSelection.startHour, dragSelection.endHour);
                      return <div
                        className={`pulse-hour-slot${selected ? " selecting" : ""}`}
                        key={`${date}-${hour}`}
                        data-calendar-slot
                        data-date={date}
                        data-hour={hour}
                        title={`Drag from here to add availability on ${formatDay(day)} at ${hour}`}
                        onMouseDown={(event) => {
                          if (event.button !== 0 || event.target.closest(".event-block, .availability-block")) return;
                          event.preventDefault();
                          setDragSelection({ startDayIndex: dayIndex, endDayIndex: dayIndex, startHour: hourNumber, endHour: hourNumber });
                        }}
                        onMouseEnter={() => setDragSelection((current) => current ? { ...current, endDayIndex: dayIndex, endHour: hourNumber } : current)}
                        onDragOver={(event) => event.preventDefault()}
                        onDrop={(event) => {
                          event.preventDefault();
                          const eventId = Number(event.dataTransfer.getData("text/event-id"));
                          const duration = Number(event.dataTransfer.getData("text/event-duration")) || 1;
                          if (eventId) onReschedule(eventId, date, hour, addTime(hour, duration));
                        }}
                      />;
                    })}
                  </div>
                  <div className="pulse-block-layer">
                    {availabilityBlocks.map((block) => {
                      const placement = calendarPlacement(minutesLabel(block.start), minutesLabel(block.end));
                      const overlap = block.freeItems.length / maxOverlap;
                      return <div
                        className={`availability-block pulse-availability-block availability-with-popover${block.isBest ? " best" : ""}`}
                        style={{ ...placement, "--overlap-opacity": 0.32 + (overlap * 0.48) }}
                        tabIndex={0}
                        key={`${date}-${block.start}-${block.playerIds.join("-")}`}
                      >
                        <strong>{block.freeItems.length} free {block.isBest ? <Check size={12} /> : null}</strong>
                        <div className="pulse-avatar-row">
                          {block.freeItems.slice(0, 3).map((item) => <Avatar user={item} size="tiny" key={item.userId} />)}
                          {block.freeItems.length > 3 ? <span>+{block.freeItems.length - 3}</span> : null}
                        </div>
                        <AvailabilityPopover freeItems={block.freeItems} />
                      </div>;
                    })}
                    {dayEvents.map((item, eventIndex) => {
                      const accepted = item.invites.filter((invite) => invite.status === "accepted");
                      const canMove = item.ownerId === user.id || user.role === "admin";
                      const selectedOption = item.gameOptions.find((option) => option.id === item.selectedGameOptionId) || item.gameOptions.find((option) => option.imageUrl);
                      const placement = calendarPlacement(item.startTime, item.endTime);
                      return <div
                        className={`event-block pulse-event-block event-with-popover${item.ready ? " event-ready" : ""}`}
                        style={{ ...placement, "--event-offset": `${Math.min(eventIndex, 2) * 5}px` }}
                        key={`e-${item.id}`}
                        tabIndex={0}
                        draggable={canMove}
                        onDragStart={(event) => {
                          event.stopPropagation();
                          event.dataTransfer.setData("text/event-id", String(item.id));
                          event.dataTransfer.setData("text/event-duration", String(eventDurationHours(item)));
                        }}
                      >
                        {selectedOption?.imageUrl ? <SteamImage src={selectedOption.imageUrl} className="pulse-event-art" /> : null}
                        <div className="pulse-event-copy">
                          <strong>{item.title}</strong>
                          <span>{item.gameTitle || "Game TBD"}</span>
                          <small><UsersRound size={12} /> {accepted.length}/{item.maxPlayers} accepted</small>
                        </div>
                        {item.ready ? <span className="ready-mark"><Check size={13} /></span> : null}
                        <div className="pulse-event-avatars">
                          {accepted.slice(0, 3).map((invite) => <Avatar user={invite} size="tiny" key={invite.userId} />)}
                          {accepted.length > 3 ? <span>+{accepted.length - 3}</span> : null}
                        </div>
                        <EventPopover event={item} />
                      </div>;
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
}

const weekdays = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const weekdayOrder = [1, 2, 3, 4, 5, 6, 0];

function AvailabilityForm({ selectedDate, onCreated, compact = false, draft, onManage }) {
  const [form, setForm] = useState({
    mode: "once",
    date: selectedDate,
    weekdays: [new Date(`${selectedDate}T12:00:00`).getDay()],
    startDate: selectedDate,
    endDate: "",
    startTime: "19:00",
    endTime: "22:00",
    note: ""
  });
  const [presets, setPresets] = useState([]);
  const [status, setStatus] = useState("");

  useEffect(() => setForm((current) => (
    current.mode === "once" ? { ...current, date: selectedDate } : current
  )), [selectedDate]);
  useEffect(() => {
    api("/api/availability/presets").then((payload) => setPresets(payload.presets)).catch(() => {});
  }, []);
  useEffect(() => {
    if (!draft) return;
    setForm((current) => ({
      ...current,
      ...draft,
      weekdays: draft.weekdays?.length ? draft.weekdays : current.weekdays
    }));
    setStatus(draft.dates?.length > 1
      ? `${draft.dates.length} days selected. Saving will repeat these weekdays.`
      : "Calendar time selected.");
  }, [draft]);

  async function submit(event) {
    event.preventDefault();
    setStatus("");
    try {
      if (form.mode === "weekly") {
        await api("/api/availability/recurring", {
          method: "POST",
          body: JSON.stringify({
            weekdays: form.weekdays,
            startTime: form.startTime,
            endTime: form.endTime,
            note: form.note,
            startDate: form.startDate,
            endDate: form.endDate
          })
        });
        setStatus(`Weekly availability saved for ${form.weekdays.length} day${form.weekdays.length === 1 ? "" : "s"}.`);
      } else {
        await api("/api/availability", { method: "POST", body: JSON.stringify(form) });
        setStatus("Free time saved.");
      }
      setForm((current) => ({ ...current, note: "" }));
      onCreated();
    } catch (error) {
      setStatus(error.message);
    }
  }

  function applyPreset(preset) {
    setForm((current) => ({
      ...current,
      mode: preset.mode || "once",
      date: preset.date || (preset.weekday === null || preset.weekday === undefined ? current.date : nextWeekday(preset.weekday)),
      weekdays: preset.weekdays || (preset.weekday === null || preset.weekday === undefined ? current.weekdays : [preset.weekday]),
      startDate: preset.startDate || localDate(new Date()),
      endDate: preset.endDate || "",
      startTime: preset.startTime,
      endTime: preset.endTime,
      note: preset.note || ""
    }));
    setStatus("");
  }

  function applyQuickPreset(value) {
    const today = new Date();
    const tomorrow = addDays(today, 1);
    const builtIns = {
      tonight: { mode: "once", date: localDate(today), startTime: "19:00", endTime: "23:00", note: "Tonight" },
      tomorrow: { mode: "once", date: localDate(tomorrow), startTime: "19:00", endTime: "22:00", note: "Tomorrow evening" },
      weeknights: { mode: "weekly", weekdays: [1, 2, 3, 4, 5], startTime: "19:00", endTime: "22:00", note: "Weeknight" },
      friday: { mode: "weekly", weekdays: [5], startTime: "19:00", endTime: "23:00", note: "Friday night" },
      saturday: { mode: "weekly", weekdays: [6], startTime: "19:00", endTime: "23:00", note: "Saturday night" },
      weekend: { mode: "weekly", weekdays: [6, 0], startTime: "19:00", endTime: "23:00", note: "Weekend evening" }
    };
    if (builtIns[value]) {
      applyPreset({ ...builtIns[value], startDate: localDate(today) });
      return;
    }
    const savedPreset = presets.find((item) => `saved-${item.id}` === value);
    if (savedPreset) applyPreset(savedPreset);
  }

  function toggleWeekday(weekday) {
    setForm((current) => {
      const exists = current.weekdays.includes(weekday);
      if (exists && current.weekdays.length === 1) return current;
      return {
        ...current,
        weekdays: exists
          ? current.weekdays.filter((item) => item !== weekday)
          : [...current.weekdays, weekday]
      };
    });
  }

  return (
    <form className={`utility-form availability-composer availability-mode-${form.mode}${compact ? " utility-form-compact" : ""}`} onSubmit={submit}>
      <div className="availability-form-head">
        <h3>Log free time</h3>
        <div className="availability-form-actions">
          <div className="segmented-control" aria-label="Availability type">
            <button type="button" className={form.mode === "once" ? "active" : ""} onClick={() => setForm({ ...form, mode: "once" })}>Once</button>
            <button type="button" className={form.mode === "weekly" ? "active" : ""} onClick={() => setForm({ ...form, mode: "weekly" })}><Repeat size={14} /> Weekly</button>
          </div>
          {onManage && <button type="button" className="manage-availability-button" onClick={onManage}><Settings size={15} /> Advanced</button>}
        </div>
      </div>
      <label className="quick-preset-field">
        <span>Quick preset</span>
        <select value="" onChange={(event) => applyQuickPreset(event.target.value)}>
          <option value="">Choose a preset...</option>
          <option value="tonight">Tonight</option>
          <option value="tomorrow">Tomorrow evening</option>
          <option value="weeknights">Every weeknight</option>
          <option value="friday">Every Friday night</option>
          <option value="saturday">Every Saturday night</option>
          <option value="weekend">Every weekend evening</option>
          {presets.map((preset) => <option value={`saved-${preset.id}`} key={preset.id}>{preset.name}</option>)}
        </select>
      </label>
      {form.mode === "once" ? (
        <label className="availability-date-field">
          <span>Date</span>
          <input type="date" value={form.date} onChange={(event) => setForm({ ...form, date: event.target.value })} />
        </label>
      ) : (
        <>
          <div className="weekday-picker" aria-label="Repeat on weekdays">
            {weekdayOrder.map((weekday) => (
              <button
                type="button"
                className={form.weekdays.includes(weekday) ? "active" : ""}
                onClick={() => toggleWeekday(weekday)}
                key={weekday}
                aria-pressed={form.weekdays.includes(weekday)}
                title={weekdays[weekday]}
              >
                {weekdays[weekday].slice(0, 2)}
              </button>
            ))}
          </div>
          <div className="availability-range">
            <label><span>Starts</span><input type="date" value={form.startDate} onChange={(event) => setForm({ ...form, startDate: event.target.value })} /></label>
            <label><span>Ends</span><input type="date" value={form.endDate} onChange={(event) => setForm({ ...form, endDate: event.target.value })} /></label>
          </div>
        </>
      )}
      <div className="availability-time-fields">
        <input type="time" value={form.startTime} onChange={(event) => setForm({ ...form, startTime: event.target.value })} />
        <input type="time" value={form.endTime} onChange={(event) => setForm({ ...form, endTime: event.target.value })} />
      </div>
      <input placeholder="Note" value={form.note} onChange={(event) => setForm({ ...form, note: event.target.value })} />
      <button className="secondary-button availability-save" type="submit"><Check size={16} /> Save {form.mode === "weekly" ? "weekly" : ""}</button>
      {status && <p className={`availability-status${status.includes("invalid") || status.includes("required") ? " form-error" : ""}`}>{status}</p>}
    </form>
  );
}

function RecurringAvailability({ refresh }) {
  const [rules, setRules] = useState([]);
  const [presets, setPresets] = useState([]);
  const [rule, setRule] = useState({
    weekdays: [5],
    startTime: "19:00",
    endTime: "23:00",
    note: "",
    startDate: localDate(new Date()),
    endDate: ""
  });
  const [preset, setPreset] = useState({ name: "", weekday: 5, startTime: "19:00", endTime: "23:00", note: "" });

  async function load() {
    const [rulesPayload, presetsPayload] = await Promise.all([
      api("/api/availability/recurring"),
      api("/api/availability/presets")
    ]);
    setRules(rulesPayload.rules);
    setPresets(presetsPayload.presets);
  }

  useEffect(() => { load(); }, []);

  async function addRule(event) {
    event.preventDefault();
    await api("/api/availability/recurring", { method: "POST", body: JSON.stringify(rule) });
    setRule({ ...rule, note: "" });
    await load();
    refresh();
  }

  async function removeRule(id) {
    await api(`/api/availability/recurring/${id}`, { method: "DELETE" });
    await load();
    refresh();
  }

  async function addPreset(event) {
    event.preventDefault();
    await api("/api/availability/presets", { method: "POST", body: JSON.stringify(preset) });
    setPreset({ ...preset, name: "", note: "" });
    load();
  }

  async function removePreset(id) {
    await api(`/api/availability/presets/${id}`, { method: "DELETE" });
    load();
  }

  function toggleRuleWeekday(weekday) {
    setRule((current) => {
      const exists = current.weekdays.includes(weekday);
      if (exists && current.weekdays.length === 1) return current;
      return {
        ...current,
        weekdays: exists
          ? current.weekdays.filter((item) => item !== weekday)
          : [...current.weekdays, weekday]
      };
    });
  }

  return (
    <section className="recurring-panel">
      <form className="table-panel compact-form" onSubmit={addRule}>
        <div className="panel-heading"><Repeat size={18} /><div><h2>Advanced recurring schedule</h2><p>Choose several weekdays, then skip individual dates from the availability list.</p></div></div>
        <div className="weekday-picker weekday-picker-large" aria-label="Recurring weekdays">
          {weekdayOrder.map((weekday) => (
            <button
              type="button"
              className={rule.weekdays.includes(weekday) ? "active" : ""}
              onClick={() => toggleRuleWeekday(weekday)}
              key={weekday}
              aria-pressed={rule.weekdays.includes(weekday)}
            >
              {weekdays[weekday].slice(0, 3)}
            </button>
          ))}
        </div>
        <div className="two-col">
          <input type="time" value={rule.startTime} onChange={(event) => setRule({ ...rule, startTime: event.target.value })} />
          <input type="time" value={rule.endTime} onChange={(event) => setRule({ ...rule, endTime: event.target.value })} />
        </div>
        <div className="two-col">
          <label>Starts<input type="date" value={rule.startDate} onChange={(event) => setRule({ ...rule, startDate: event.target.value })} /></label>
          <label>Ends (optional)<input type="date" value={rule.endDate} onChange={(event) => setRule({ ...rule, endDate: event.target.value })} /></label>
        </div>
        <input placeholder="Note" value={rule.note} onChange={(event) => setRule({ ...rule, note: event.target.value })} />
        <button className="secondary-button"><Repeat size={16} /> Add weekly rule</button>
        <div className="rule-list">
          {rules.map((item) => (
            <div key={item.id}>
              <span><strong>{weekdays[item.weekday]}</strong> {item.startTime}-{item.endTime}</span>
              <button type="button" className="danger-button" onClick={() => removeRule(item.id)} aria-label="Delete recurring rule"><Trash2 size={15} /></button>
            </div>
          ))}
        </div>
      </form>
      <form className="table-panel compact-form" onSubmit={addPreset}>
        <div className="panel-heading"><Sparkles size={18} /><div><h2>Saved presets</h2><p>Create one-click availability shortcuts.</p></div></div>
        <input placeholder="Preset name" value={preset.name} onChange={(event) => setPreset({ ...preset, name: event.target.value })} />
        <select value={preset.weekday} onChange={(event) => setPreset({ ...preset, weekday: Number(event.target.value) })}>
          {weekdays.map((day, index) => <option value={index} key={day}>{day}</option>)}
        </select>
        <div className="two-col">
          <input type="time" value={preset.startTime} onChange={(event) => setPreset({ ...preset, startTime: event.target.value })} />
          <input type="time" value={preset.endTime} onChange={(event) => setPreset({ ...preset, endTime: event.target.value })} />
        </div>
        <input placeholder="Note" value={preset.note} onChange={(event) => setPreset({ ...preset, note: event.target.value })} />
        <button className="secondary-button"><Plus size={16} /> Save preset</button>
        <div className="rule-list">
          {presets.map((item) => (
            <div key={item.id}>
              <span><strong>{item.name}</strong> {item.startTime}-{item.endTime}</span>
              <button type="button" className="danger-button" onClick={() => removePreset(item.id)} aria-label="Delete preset"><Trash2 size={15} /></button>
            </div>
          ))}
        </div>
      </form>
    </section>
  );
}

function FreeTimeView({ user, availability, refresh }) {
  const [selectedDate, setSelectedDate] = useState(localDate(new Date()));
  const visibleAvailability = availability
    .filter((item) => user.role === "admin" || item.userId === user.id)
    .sort((a, b) => `${a.date} ${a.startTime}`.localeCompare(`${b.date} ${b.startTime}`));

  async function removeAvailability(id) {
    await api(`/api/availability/${id}`, { method: "DELETE" });
    refresh();
  }

  return (
    <>
      <header className="topbar">
        <div>
          <h1>Availability</h1>
          <p>Add one-off free time, build a weekly schedule, and manage exceptions.</p>
        </div>
      </header>
      <RecurringAvailability refresh={refresh} />
      <div className="free-time-layout">
        <AvailabilityForm selectedDate={selectedDate} onCreated={refresh} />
        <section className="table-panel">
          <div className="section-title compact-title">
            <div>
              <h2>{user.role === "admin" ? "All availability" : "My availability"}</h2>
              <p>Delete entries that are no longer accurate.</p>
            </div>
            <input type="date" value={selectedDate} onChange={(event) => setSelectedDate(event.target.value)} />
          </div>
          {visibleAvailability.length === 0 && <p className="muted">No free time logged yet.</p>}
          <div className="free-time-list">
            {visibleAvailability.map((item) => {
              const canDelete = item.userId === user.id || user.role === "admin";
              return (
                <article className="free-time-row" key={item.id}>
                  <div>
                    <strong>{item.displayName}</strong>
                    <span>{item.date}, {item.startTime} to {item.endTime}</span>
                    <small>{item.recurring ? "Recurring - delete to skip this date" : "One-off"}{item.note ? ` - ${item.note}` : ""}</small>
                  </div>
                  {canDelete && (
                    <button className="danger-button" onClick={() => removeAvailability(item.id)} aria-label={`Delete free time for ${item.displayName}`}>
                      <Trash2 size={16} />
                    </button>
                  )}
                </article>
              );
            })}
          </div>
        </section>
      </div>
    </>
  );
}

function EventForm({ games, friends, selectedDate, onSearchGames, onCreated, expanded, onToggle }) {
  const [form, setForm] = useState({
    title: "New session",
    steamAppId: "",
    gameTitle: "",
    date: selectedDate,
    startTime: "20:00",
    endTime: "22:30",
    inviteIds: [],
    minPlayers: 2,
    maxPlayers: 8,
    rsvpDeadline: "",
    notes: "",
    gameOptions: []
  });
  const [query, setQuery] = useState("co-op");

  useDebouncedSteamSearch(query, onSearchGames);
  useEffect(() => setForm((current) => ({ ...current, date: selectedDate })), [selectedDate]);

  function chooseGame(appId) {
    const game = games.find((item) => item.appId === Number(appId));
    setForm({ ...form, steamAppId: game?.appId || "", gameTitle: game?.title || "" });
  }

  function addGameOption() {
    const game = games.find((item) => item.appId === Number(form.steamAppId));
    if (!game || form.gameOptions.some((option) => option.steamAppId === game.appId)) return;
    setForm({
      ...form,
      gameTitle: form.gameOptions.length === 0 ? game.title : form.gameTitle,
      gameOptions: [...form.gameOptions, { steamAppId: game.appId, title: game.title, imageUrl: game.image || "" }]
    });
  }

  async function submit(event) {
    event.preventDefault();
    await api("/api/events", { method: "POST", body: JSON.stringify(form) });
    onCreated();
    onToggle(false);
  }

  function toggleFriend(id) {
    const inviteIds = form.inviteIds.includes(id)
      ? form.inviteIds.filter((item) => item !== id)
      : [...form.inviteIds, id];
    setForm({ ...form, inviteIds });
  }

  return (
    <form className={`pulse-session-dock${expanded ? " expanded" : ""}`} id="pulse-session-composer" onSubmit={submit}>
      <button className="pulse-dock-label" type="button" onClick={() => onToggle(!expanded)}><Plus size={18} /><span>New session</span></button>
      <label><span>Date</span><input type="date" value={form.date} onChange={(event) => setForm({ ...form, date: event.target.value })} /></label>
      <label className="pulse-time-field"><span>Time</span><div><input type="time" value={form.startTime} onChange={(event) => setForm({ ...form, startTime: event.target.value })} /><i>-</i><input type="time" value={form.endTime} onChange={(event) => setForm({ ...form, endTime: event.target.value })} /></div></label>
      <label className="pulse-game-field"><span>Game</span><select value={form.steamAppId} onChange={(event) => chooseGame(event.target.value)}><option value="">Select a game</option>{games.map((game) => <option value={game.appId} key={game.appId}>{game.title}</option>)}</select></label>
      <button className="pulse-invite-trigger" type="button" onClick={() => onToggle(true)}><UsersRound size={17} /> {form.inviteIds.length ? `${form.inviteIds.length} invited` : "Select players"}</button>
      <button className="pulse-create-session" type="submit"><Send size={16} /> Create session</button>
      <button className="pulse-expand-dock" type="button" onClick={() => onToggle(!expanded)} aria-label={expanded ? "Collapse session options" : "Expand session options"}>{expanded ? <ChevronDown size={18} /> : <ChevronUp size={18} />}</button>
      {expanded ? <div className="pulse-session-details">
        <label>Session title<input value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} /></label>
        <label>Search Steam<div className="search-inline"><input placeholder="Search Steam" value={query} onChange={(event) => setQuery(event.target.value)} /><button type="button" onClick={() => onSearchGames(query)} aria-label="Search games"><Search size={17} /></button></div></label>
        <div className="pulse-game-options"><button className="secondary-button" type="button" onClick={addGameOption}><Plus size={16} /> Add voting option</button><div className="game-option-chips">{form.gameOptions.map((option) => <button type="button" key={option.steamAppId} onClick={() => setForm({ ...form, gameOptions: form.gameOptions.filter((item) => item.steamAppId !== option.steamAppId) })}>{option.title} <span>×</span></button>)}{form.gameOptions.length === 0 ? <small>Add multiple games if invitees should vote.</small> : null}</div></div>
        <div className="two-col"><label>Minimum players<input type="number" min="1" max="100" value={form.minPlayers} onChange={(event) => setForm({ ...form, minPlayers: Number(event.target.value) })} /></label><label>Maximum players<input type="number" min={form.minPlayers} max="100" value={form.maxPlayers} onChange={(event) => setForm({ ...form, maxPlayers: Number(event.target.value) })} /></label></div>
        <label>RSVP deadline<input type="datetime-local" value={form.rsvpDeadline} onChange={(event) => setForm({ ...form, rsvpDeadline: event.target.value })} /></label>
        <label>Session notes<textarea placeholder="Server details, mods, DLC, or voice channel" value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} /></label>
        <div className="invite-list"><span>Invite friends</span>{friends.length === 0 ? <small>No other accounts yet.</small> : null}{friends.map((friend) => <button type="button" className={form.inviteIds.includes(friend.id) ? "selected" : ""} onClick={() => toggleFriend(friend.id)} key={friend.id}><Avatar user={friend} size="tiny" /> {friend.displayName}</button>)}</div>
      </div> : null}
    </form>
  );
}

function calendarRangeLabel(days) {
  const start = days[0];
  const end = days.at(-1);
  const startMonth = new Intl.DateTimeFormat("en-GB", { month: "long" }).format(start);
  const endMonth = new Intl.DateTimeFormat("en-GB", { month: "long" }).format(end);
  return startMonth === endMonth
    ? `${start.getDate()}-${end.getDate()} ${endMonth}`
    : `${start.getDate()} ${startMonth}-${end.getDate()} ${endMonth}`;
}

function CalendarUtilityRail({ availability, events, onOpenEvents, onManageAvailability }) {
  const [tonightOpen, setTonightOpen] = useState(true);
  const [upcomingOpen, setUpcomingOpen] = useState(true);
  const today = localDate(new Date());
  const nowTime = new Date().toTimeString().slice(0, 5);
  const todayItems = availability.filter((item) => item.date === today && item.endTime > nowTime);
  const visibleItems = todayItems.some((item) => item.startTime <= nowTime)
    ? todayItems.filter((item) => item.startTime <= nowTime)
    : todayItems;
  const freePlayers = [...new Map(visibleItems.map((item) => [item.userId, item])).values()];
  const upcoming = events.slice(0, 3);

  return (
    <aside className="pulse-utility-rail">
      <section>
        <button className="pulse-rail-heading" type="button" onClick={() => setTonightOpen(!tonightOpen)}><span><Zap size={18} /> Tonight</span>{tonightOpen ? <ChevronUp size={16} /> : <ChevronDown size={16} />}</button>
        {tonightOpen ? <div className="pulse-free-list">
          <div className="pulse-rail-summary"><span>Free players</span><strong>{freePlayers.length} online</strong></div>
          {freePlayers.slice(0, 6).map((player) => <div className="pulse-free-person" key={player.userId}><Avatar user={player} size="small" /><strong>{player.displayName}</strong><span>{player.startTime <= nowTime ? "Free" : player.startTime}</span></div>)}
          {freePlayers.length === 0 ? <p>No availability logged for tonight.</p> : null}
          <button className="pulse-rail-action" type="button" onClick={onManageAvailability}>Manage free time</button>
        </div> : null}
      </section>
      <section>
        <button className="pulse-rail-heading" type="button" onClick={() => setUpcomingOpen(!upcomingOpen)}><span><Clock size={18} /> Upcoming</span>{upcomingOpen ? <ChevronUp size={16} /> : <ChevronDown size={16} />}</button>
        {upcomingOpen ? <div className="pulse-upcoming-list">
          {upcoming.map((event) => {
            const accepted = event.invites.filter((invite) => invite.status === "accepted");
            const selectedOption = event.gameOptions.find((option) => option.id === event.selectedGameOptionId) || event.gameOptions.find((option) => option.imageUrl);
            return <article key={event.id}>{selectedOption?.imageUrl ? <SteamImage src={selectedOption.imageUrl} /> : <span className="image-fallback"><Gamepad2 size={18} /></span>}<div><strong>{event.title}</strong><span>{formatDate(event.date)} - {event.startTime}</span><small><UsersRound size={12} /> {accepted.length}/{event.maxPlayers} accepted</small></div>{event.ready ? <i><Check size={12} /></i> : null}</article>;
          })}
          {upcoming.length === 0 ? <p>No sessions planned.</p> : null}
          <button className="pulse-view-events" type="button" onClick={onOpenEvents}>View all events</button>
        </div> : null}
      </section>
    </aside>
  );
}

function CalendarView({ user, data, weekOffset, setWeekOffset, refresh, searchGames, onManageAvailability, onOpenEvents }) {
  const weekStart = useMemo(() => addDays(startOfWeek(), weekOffset * 7), [weekOffset]);
  const days = useMemo(() => Array.from({ length: 7 }, (_, index) => addDays(weekStart, index)), [weekStart]);
  const [bestSlots, setBestSlots] = useState([]);
  const [availabilityDraft, setAvailabilityDraft] = useState(null);
  const [availabilityOpen, setAvailabilityOpen] = useState(false);
  const [sessionComposerOpen, setSessionComposerOpen] = useState(false);
  const [dayCount, setDayCount] = useState(7);
  const [transitionDirection, setTransitionDirection] = useState("next");
  const visibleDays = useMemo(() => days.slice(0, dayCount), [days, dayCount]);

  useEffect(() => {
    const start = localDate(days[0]);
    const end = localDate(days[6]);
    api(`/api/availability/best-times?start=${start}&end=${end}`)
      .then((payload) => setBestSlots(payload.slots))
      .catch(() => setBestSlots([]));
  }, [days, data.availability, data.events]);

  function moveWeek(amount) {
    setTransitionDirection(amount < 0 ? "previous" : "next");
    setWeekOffset(weekOffset + amount);
  }

  async function rescheduleEvent(eventId, date, startTime, endTime) {
    await api(`/api/events/${eventId}`, { method: "PATCH", body: JSON.stringify({ date, startTime, endTime }) });
    refresh();
  }

  function openAvailability(draft = null) {
    setAvailabilityDraft(draft);
    setAvailabilityOpen(true);
    window.requestAnimationFrame(() => document.querySelector(".pulse-dock-stack .availability-composer")?.scrollIntoView({ behavior: "smooth", block: "end" }));
  }

  function openSessionComposer() {
    setSessionComposerOpen(true);
    window.requestAnimationFrame(() => document.getElementById("pulse-session-composer")?.scrollIntoView({ behavior: "smooth", block: "end" }));
  }

  return (
    <section className="pulse-calendar-page">
      <header className="pulse-calendar-toolbar">
        <h1>Calendar</h1>
        <div className="pulse-date-nav">
          <button className="icon-button" onClick={() => moveWeek(-1)} aria-label="Previous week"><ChevronLeft size={19} /></button>
          <strong>{calendarRangeLabel(days)}</strong>
          <button className="icon-button" onClick={() => moveWeek(1)} aria-label="Next week"><ChevronRight size={19} /></button>
        </div>
        <div className="pulse-toolbar-actions">
          <button className="pulse-today-button" onClick={() => setWeekOffset(0)}>Today</button>
          <div className="pulse-view-switch"><button className={dayCount === 7 ? "active" : ""} onClick={() => setDayCount(7)}>Week</button><button className={dayCount === 5 ? "active" : ""} onClick={() => setDayCount(5)}>5 days</button></div>
          <button className="pulse-free-button" onClick={() => openAvailability()}><Clock size={16} /> Log free time</button>
          <button className="pulse-new-session" onClick={openSessionComposer}><Plus size={17} /> New session</button>
        </div>
      </header>
      <div className="pulse-calendar-layout">
        <div className="pulse-calendar-main">
          <div className={`week-transition week-transition-${transitionDirection}`} key={weekOffset}>
            <CalendarGrid
              user={user}
              days={visibleDays}
              availability={data.availability}
              events={data.events}
              bestSlots={bestSlots}
              onAvailabilityDraft={openAvailability}
              onReschedule={rescheduleEvent}
            />
          </div>
        </div>
        <CalendarUtilityRail availability={data.availability} events={data.events} onOpenEvents={onOpenEvents} onManageAvailability={onManageAvailability} />
      </div>
      <div className="pulse-dock-stack">
        {availabilityOpen ? <AvailabilityForm selectedDate={localDate(days[0])} onCreated={() => { refresh(); setAvailabilityOpen(false); setAvailabilityDraft(null); }} compact draft={availabilityDraft} onManage={onManageAvailability} /> : null}
        <EventForm games={data.games} friends={data.friends} selectedDate={localDate(days[0])} onSearchGames={searchGames} onCreated={refresh} expanded={sessionComposerOpen} onToggle={setSessionComposerOpen} />
      </div>
    </section>
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
      <div>
        <strong>{event.title}</strong>
        <span>{event.gameTitle || "Game TBD"} - {event.date}, {event.startTime} to {event.endTime}</span>
        <small>From {event.ownerName} - current: {invite.status}</small>
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
  const waitlisted = event.invites.filter((invite) => invite.status === "waitlisted");
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
          <Avatar user={{ displayName: event.ownerName, avatarUrl: event.ownerAvatarUrl, profileColor: event.ownerColor }} size="small" />
          <div>
            <strong>{event.title}</strong>
            <span>{event.gameTitle || "Vote pending"} - {formatDate(event.date)}, {event.startTime} to {event.endTime}</span>
            <small>Host: {event.ownerName}</small>
            {myInvite?.status === "waitlisted" && <small className="status-waitlist">You are on the waitlist</small>}
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
                <button className={`${myVote === option.id ? "selected" : ""}${option.imageUrl ? " has-image" : ""}`} type="button" onClick={() => vote(option.id)} key={option.id}>
                  {option.imageUrl && <SteamImage src={option.imageUrl} />}
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
  const tomorrow = localDate(addDays(new Date(), 1));
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
            return <article className="table-panel proposal-card" key={proposal.id}>
              <div className="section-title compact-title"><div><h2>{proposal.title}</h2><p>By {proposal.ownerName} - {proposal.status}</p></div>{canManage && <button className="danger-button" onClick={() => remove(proposal.id)}><Trash2 size={15} /></button>}</div>
              {proposal.notes && <p>{proposal.notes}</p>}
              <h3>Times</h3>
              <div className="proposal-votes">{proposal.slots.map((slot) => <button className={myVote.slotId === slot.id ? "selected" : ""} disabled={proposal.status !== "open"} onClick={() => vote(proposal.id, { slotId: slot.id })} key={slot.id}><span>{formatDate(slot.date)} {slot.startTime}-{slot.endTime}</span><strong>{slot.voters.length}</strong></button>)}</div>
              {proposal.games.length > 0 && <><h3>Games</h3><div className="proposal-votes">{proposal.games.map((game) => <button className={myVote.gameId === game.id ? "selected" : ""} disabled={proposal.status !== "open"} onClick={() => vote(proposal.id, { gameId: game.id })} key={game.id}><span>{game.title}</span><strong>{game.voters.length}</strong></button>)}</div></>}
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
                <SteamImage src={game.image} />
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
                <SteamImage src={selected.image} className="game-detail-image" />
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
            <button className="dashboard-row" onClick={() => setActiveView("invites")} key={event.id}>
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
          </div>
        </section>
        <section className="table-panel dashboard-panel">
          <div className="panel-heading"><Gamepad2 size={18} /><div><h2>Recent suggestions</h2><p>Games your group wants to play.</p></div></div>
          <div className="suggestion-grid">
            {dashboard.recentSuggestions.map((game) => (
              <a href={`https://store.steampowered.com/app/${game.steamAppId}/`} target="_blank" rel="noreferrer" key={game.id}>
                <SteamImage src={game.imageUrl} />
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
  const tonight = dashboard?.tonight;
  const currentTime = new Date().toTimeString().slice(0, 5);
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
          <span className="eyebrow">{formatDate(tonight?.date || localDate(new Date()), { weekday: "long", day: "numeric", month: "long" })}</span>
          <h2>{uniquePlayers.length} player{uniquePlayers.length === 1 ? "" : "s"} free tonight</h2>
          <div className="tonight-people">
            {uniquePlayers.map((player) => <div key={player.userId}><Avatar user={player} size="large" /><strong>{player.displayName}</strong><span>{player.startTime}-{player.endTime}</span></div>)}
          </div>
          {uniquePlayers.length === 0 && <p>No one has logged remaining free time tonight.</p>}
        </section>
        <section className="table-panel">
          <div className="panel-heading"><Clock size={18} /><div><h2>Tonight sessions</h2><p>Accepted and planned events.</p></div></div>
          {(tonight?.events || []).map((event) => (
            <button className="dashboard-row" onClick={() => setActiveView("events")} key={event.id}>
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

function AdminView({ user }) {
  const [users, setUsers] = useState([]);
  const [settings, setSettings] = useState({ appUrl: "", discordWebhookUrl: "", discordBotName: "SquadSlot", discordApplicationId: "", discordPublicKey: "", discordChannelId: "", discordBotToken: "" });
  const [backups, setBackups] = useState({ backups: [], config: {} });
  const [auditEntries, setAuditEntries] = useState([]);
  const [notifications, setNotifications] = useState([]);
  const [reminders, setReminders] = useState({
    eventTomorrow: true,
    eventStartingSoon: true,
    rsvpDeadline: true,
    weeklySummary: true,
    weeklyDay: 1,
    weeklyTime: "09:00"
  });
  const [message, setMessage] = useState({ type: "", text: "" });
  const [notificationMessage, setNotificationMessage] = useState({ type: "", text: "" });
  const [backupMessage, setBackupMessage] = useState("");
  const [passwordReset, setPasswordReset] = useState({ userId: null, temporaryPassword: "", confirmPassword: "" });
  const [accountMessage, setAccountMessage] = useState({ type: "", text: "" });

  async function load() {
    const [usersPayload, settingsPayload, notificationsPayload, remindersPayload, backupsPayload, auditPayload] = await Promise.all([
      api("/api/admin/users"),
      api("/api/admin/settings"),
      api("/api/admin/notifications"),
      api("/api/admin/reminders"),
      api("/api/admin/backups"),
      api("/api/admin/audit")
    ]);
    setUsers(usersPayload.users);
    setSettings(settingsPayload.settings);
    setNotifications(notificationsPayload.notifications);
    setReminders(remindersPayload.reminders);
    setBackups(backupsPayload);
    setAuditEntries(auditPayload.entries);
  }

  useEffect(() => {
    load().catch((error) => setMessage({ type: "error", text: error.message }));
  }, []);

  async function saveSettings(event) {
    event.preventDefault();
    setMessage({ type: "", text: "" });
    try {
      await api("/api/admin/settings", { method: "PUT", body: JSON.stringify(settings) });
      setMessage({ type: "success", text: "Settings saved." });
    } catch (error) {
      setMessage({ type: "error", text: error.message });
    }
  }

  async function testDiscord() {
    setMessage({ type: "", text: "" });
    try {
      await api("/api/admin/discord/test", { method: "POST", body: JSON.stringify({}) });
      setMessage({ type: "success", text: "Discord test message sent." });
    } catch (error) {
      setMessage({ type: "error", text: error.message });
    }
  }

  function updateNotification(type, patch) {
    setNotifications((current) => current.map((notification) => (
      notification.type === type ? { ...notification, ...patch } : notification
    )));
  }

  async function saveNotifications(event) {
    event.preventDefault();
    setNotificationMessage({ type: "", text: "" });
    try {
      const payload = await api("/api/admin/notifications", { method: "PUT", body: JSON.stringify({ notifications }) });
      setNotifications(payload.notifications);
      setNotificationMessage({ type: "success", text: "Notification rules saved." });
    } catch (error) {
      setNotificationMessage({ type: "error", text: error.message });
    }
  }

  async function setRole(id, role) {
    await api(`/api/admin/users/${id}`, { method: "PATCH", body: JSON.stringify({ role }) });
    load();
  }

  function togglePasswordReset(accountId) {
    setAccountMessage({ type: "", text: "" });
    setPasswordReset((current) => ({
      userId: current.userId === accountId ? null : accountId,
      temporaryPassword: "",
      confirmPassword: ""
    }));
  }

  async function resetPassword(event, account) {
    event.preventDefault();
    setAccountMessage({ type: "", text: "" });
    if (passwordReset.temporaryPassword !== passwordReset.confirmPassword) {
      setAccountMessage({ type: "error", text: "Temporary passwords do not match." });
      return;
    }

    try {
      await api(`/api/admin/users/${account.id}/password`, {
        method: "PUT",
        body: JSON.stringify({ temporaryPassword: passwordReset.temporaryPassword })
      });
      setPasswordReset({ userId: null, temporaryPassword: "", confirmPassword: "" });
      setAccountMessage({ type: "success", text: `Temporary password set for ${account.displayName}.` });
      await load();
    } catch (resetError) {
      setAccountMessage({ type: "error", text: resetError.message });
    }
  }

  async function saveReminders(event) {
    event.preventDefault();
    setNotificationMessage({ type: "", text: "" });
    try {
      const payload = await api("/api/admin/reminders", { method: "PUT", body: JSON.stringify({ reminders }) });
      setReminders(payload.reminders);
      setNotificationMessage({ type: "success", text: "Reminder schedule saved." });
    } catch (error) {
      setNotificationMessage({ type: "error", text: error.message });
    }
  }

  async function runReminders() {
    await api("/api/admin/reminders/run", { method: "POST", body: JSON.stringify({}) });
    setNotificationMessage({ type: "success", text: "Reminder check completed." });
  }

  async function exportBackup() {
    setBackupMessage("");
    const response = await fetch("/api/admin/backup");
    if (!response.ok) throw new Error("Backup export failed.");

    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `squadslot-backup-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    setBackupMessage("Backup exported.");
  }

  async function restoreBackup(event) {
    const file = event.target.files?.[0];
    if (!file) return;

    setBackupMessage("");
    try {
      const parsed = JSON.parse(await file.text());
      await api("/api/admin/backup/restore", { method: "POST", body: JSON.stringify(parsed) });
      setBackupMessage("Backup restored. Refresh or sign in again if your current session changed.");
      await load();
    } catch (error) {
      setBackupMessage(error.message);
    } finally {
      event.target.value = "";
    }
  }

  async function runEncryptedBackup() {
    setBackupMessage("");
    try {
      const payload = await api("/api/admin/backups/run", { method: "POST", body: JSON.stringify({}) });
      setBackupMessage(`Encrypted backup created: ${payload.backup.name}`);
      await load();
    } catch (error) {
      setBackupMessage(error.message);
    }
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
          <div className="account-list">
            {users.map((account) => (
              <article className="account-card" key={account.id}>
                <div className="account-summary">
                  <div className="account-identity">
                    <strong>{account.displayName}</strong>
                    <span>@{account.username}</span>
                    {Boolean(account.mustChangePassword) && <small>Password change required</small>}
                  </div>
                  <span className="account-stat">{account.availabilityCount} free slots</span>
                  <div className="account-controls">
                    <select aria-label={`Role for ${account.displayName}`} value={account.role} disabled={account.id === user.id && account.role === "admin"} onChange={(event) => setRole(account.id, event.target.value)}>
                      <option value="user">User</option>
                      <option value="admin">Admin</option>
                    </select>
                    <button className="secondary-button" type="button" disabled={account.id === user.id} onClick={() => togglePasswordReset(account.id)}>
                      <KeyRound size={16} /> Reset password
                    </button>
                  </div>
                </div>
                {passwordReset.userId === account.id && (
                  <form className="account-password-form" onSubmit={(event) => resetPassword(event, account)}>
                    <label>Temporary password<input type="password" autoComplete="new-password" value={passwordReset.temporaryPassword} onChange={(event) => setPasswordReset({ ...passwordReset, temporaryPassword: event.target.value })} /></label>
                    <label>Confirm password<input type="password" autoComplete="new-password" value={passwordReset.confirmPassword} onChange={(event) => setPasswordReset({ ...passwordReset, confirmPassword: event.target.value })} /></label>
                    <div className="settings-actions">
                      <button className="primary-button" type="submit"><KeyRound size={16} /> Set temporary password</button>
                      <button className="text-button inline-text-button" type="button" onClick={() => togglePasswordReset(account.id)}>Cancel</button>
                    </div>
                  </form>
                )}
              </article>
            ))}
          </div>
          {accountMessage.text && <p className={accountMessage.type === "error" ? "form-error" : "muted"}>{accountMessage.text}</p>}
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
          <div className="two-col">
            <label>Application ID<input value={settings.discordApplicationId || ""} onChange={(event) => setSettings({ ...settings, discordApplicationId: event.target.value })} /></label>
            <label>Channel ID<input value={settings.discordChannelId || ""} onChange={(event) => setSettings({ ...settings, discordChannelId: event.target.value })} /></label>
          </div>
          <label>Public key<input value={settings.discordPublicKey || ""} onChange={(event) => setSettings({ ...settings, discordPublicKey: event.target.value })} /></label>
          <label>Bot token<input type="password" placeholder={settings.discordBotTokenConfigured ? "Configured - leave blank to keep" : "Discord bot token"} value={settings.discordBotToken || ""} onChange={(event) => setSettings({ ...settings, discordBotToken: event.target.value })} /></label>
          <label>Interactions endpoint<input readOnly value={settings.discordInteractionUrl || ""} /></label>
          <div className="settings-actions">
            <button className="primary-button" type="submit"><Settings size={16} /> Save settings</button>
            <button className="secondary-button" type="button" onClick={testDiscord}><Send size={16} /> Send test</button>
          </div>
          {message.text && <p className={message.type === "error" ? "form-error" : "muted"}>{message.text}</p>}
        </form>
        <form className="table-panel admin-form" onSubmit={saveReminders}>
          <h2>Discord reminders</h2>
          {[
            ["eventTomorrow", "Event tomorrow"],
            ["eventStartingSoon", "Starting in one hour"],
            ["rsvpDeadline", "RSVP deadline"],
            ["weeklySummary", "Weekly availability summary"]
          ].map(([key, label]) => (
            <label className="toggle-line" key={key}>
              <input type="checkbox" checked={reminders[key]} onChange={(event) => setReminders({ ...reminders, [key]: event.target.checked })} />
              <span><strong>{label}</strong></span>
            </label>
          ))}
          <div className="two-col">
            <label>
              Weekly day
              <select value={reminders.weeklyDay} onChange={(event) => setReminders({ ...reminders, weeklyDay: Number(event.target.value) })}>
                {weekdays.map((day, index) => <option value={index} key={day}>{day}</option>)}
              </select>
            </label>
            <label>Weekly time<input type="time" value={reminders.weeklyTime} onChange={(event) => setReminders({ ...reminders, weeklyTime: event.target.value })} /></label>
          </div>
          <div className="settings-actions">
            <button className="primary-button"><Settings size={16} /> Save reminders</button>
            <button className="secondary-button" type="button" onClick={runReminders}><Zap size={16} /> Run check now</button>
          </div>
        </form>
        <form className="table-panel admin-form notification-panel" onSubmit={saveNotifications}>
          <div className="section-title compact-title">
            <div>
              <h2>Notification rules</h2>
              <p>Choose Discord posts and edit message templates with variables.</p>
            </div>
            <button className="primary-button" type="submit"><Bell size={16} /> Save rules</button>
          </div>
          <div className="notification-list">
            {notifications.map((notification) => (
              <article className="notification-row" key={notification.type}>
                <label className="toggle-line">
                  <input
                    type="checkbox"
                    checked={notification.enabled}
                    onChange={(event) => updateNotification(notification.type, { enabled: event.target.checked })}
                  />
                  <span>
                    <strong>{notification.label}</strong>
                    <small>{notification.description}</small>
                  </span>
                </label>
                <div className="template-grid">
                  <label>
                    Title
                    <input value={notification.title} onChange={(event) => updateNotification(notification.type, { title: event.target.value })} />
                  </label>
                  <label>
                    Message
                    <textarea value={notification.message} onChange={(event) => updateNotification(notification.type, { message: event.target.value })} />
                  </label>
                </div>
                <small className="template-vars">Variables: {notification.variables.map((variable) => `{${variable}}`).join(", ")}</small>
              </article>
            ))}
          </div>
          {notificationMessage.text && <p className={notificationMessage.type === "error" ? "form-error" : "muted"}>{notificationMessage.text}</p>}
        </form>
        <section className="table-panel admin-form">
          <h2>Backup and restore</h2>
          <p className="muted">Complete exports include squads, accounts, password hashes, schedules, proposals, settings, and audit records.</p>
          <div className="settings-actions">
            <button className="secondary-button" type="button" onClick={exportBackup}>Export JSON</button>
            <button className="primary-button" type="button" onClick={runEncryptedBackup}><Shield size={16} /> Run encrypted backup</button>
          </div>
          <p className="muted">Automatic: {backups.config.enabled ? `every ${backups.config.intervalHours} hours` : "off"} - retention {backups.config.retention || 0} - encryption {backups.config.encrypted ? "ready" : "needs BACKUP_ENCRYPTION_KEY"}</p>
          <div className="backup-list">{backups.backups.slice(0, 8).map((backup) => <a href={`/api/admin/backups/${backup.name}`} key={backup.name}><Download size={15} /> <span>{backup.name}</span><small>{Math.ceil(backup.size / 1024)} KB</small></a>)}</div>
          <label>
            Restore backup JSON
            <input type="file" accept="application/json,.json" onChange={restoreBackup} />
          </label>
          {backupMessage && <p className="muted">{backupMessage}</p>}
        </section>
        <section className="table-panel admin-form audit-panel">
          <h2>Audit log</h2>
          <div className="audit-list">{auditEntries.map((entry) => <article key={entry.id}><div><strong>{entry.actorName}</strong><span>{entry.action}</span></div><small>{new Date(`${entry.createdAt}Z`).toLocaleString()} - {entry.targetType}{entry.targetId ? ` #${entry.targetId}` : ""}</small></article>)}</div>
        </section>
      </div>
    </>
  );
}

function App() {
  const [user, setUser] = useState(null);
  const [activeView, setActiveView] = useState("dashboard");
  const [loading, setLoading] = useState(true);
  const [dataLoading, setDataLoading] = useState(false);
  const [weekOffset, setWeekOffset] = useState(0);
  const [clock, setClock] = useState(() => new Date());
  const [data, setData] = useState({ availability: [], events: [], games: [], friends: [], groups: [], dashboard: null });

  const searchGames = useCallback(async (query = "co-op") => {
    try {
      const payload = await api(`/api/games?q=${encodeURIComponent(query)}`);
      setData((current) => ({ ...current, games: payload.games }));
    } catch {
      setData((current) => ({ ...current, games: [] }));
    }
  }, []);

  const refresh = useCallback(async () => {
    setDataLoading(true);
    try {
      const [availability, events, friends, groups, dashboard] = await Promise.all([
        api("/api/availability"),
        api("/api/events"),
        api("/api/friends"),
        api("/api/groups"),
        api("/api/dashboard")
      ]);
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
      setDataLoading(false);
    }
  }, []);

  useEffect(() => {
    api("/api/me")
      .then((payload) => setUser(payload.user))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    const handleExpiredSession = () => setUser(null);
    window.addEventListener("squadslot:session-expired", handleExpiredSession);
    return () => window.removeEventListener("squadslot:session-expired", handleExpiredSession);
  }, []);

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
    document.documentElement.style.setProperty("--accent", user.accent || "#2fd3ba");
  }, [user]);

  async function logout() {
    await api("/api/auth/logout", { method: "POST" });
    setUser(null);
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
        pendingInviteCount: visibleDashboardInvites.length,
        tonight: {
          ...data.dashboard.tonight,
          events: data.dashboard.tonight.events.filter((event) => !eventHasEnded(event, clock))
        }
      }
    : null;

  const pendingInviteCount = visibleEvents.filter((event) =>
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
        {activeView === "dashboard" && <DashboardView dashboard={visibleDashboard} setActiveView={setActiveView} />}
        {activeView === "calendar" && (
          <CalendarView
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
        {activeView === "free-time" && <FreeTimeView user={user} availability={data.availability} refresh={refresh} />}
        {activeView === "groups" && <GroupsView user={user} groups={data.groups} onChanged={refreshContext} />}
        {activeView === "friends" && <FriendsView friends={data.friends} availability={data.availability} events={visibleEvents} />}
        {activeView === "games" && <GamesView games={data.games} searchGames={searchGames} />}
        {activeView === "profile" && <ProfileView user={user} onSaved={setUser} />}
        {activeView === "admin" && user.role === "admin" && <AdminView user={user} />}
        {dataLoading && activeView !== "dashboard" && <div className="loading-indicator"><span /></div>}
      </main>
    </div>
  );
}

createRoot(document.getElementById("root")).render(<App />);

if ("serviceWorker" in navigator && import.meta.env.PROD) {
  navigator.serviceWorker.register("/service-worker.js").catch(() => {});
}
