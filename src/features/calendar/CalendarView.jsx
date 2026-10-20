import { useEffect, useMemo, useState } from "react";
import { Check, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Clock, Plus, UsersRound, Zap } from "lucide-react";
import { api } from "../../lib/api.js";
import { Avatar, EventGameImage } from "../../components/PlayerMedia.jsx";
import { addDays, formatDate, localDate, startOfWeek } from "../../lib/dates.js";
import { AvailabilityForm } from "../availability/Availability.jsx";
import { AvailabilityDialog } from "../availability/AvailabilityDialog.jsx";
import { useAvailabilityRange } from "../availability/useAvailabilityRange.js";
import { EventForm } from "../events/EventForm.jsx";
import { CalendarGrid } from "./CalendarGrid.jsx";
import styles from "./calendar.module.css";
import { useSchedulingTime } from "../../lib/scheduling-time.jsx";

export function calendarRangeLabel(days) {
  const start = days[0];
  const end = days.at(-1);
  const startMonth = new Intl.DateTimeFormat("en-GB", { month: "long" }).format(start);
  const endMonth = new Intl.DateTimeFormat("en-GB", { month: "long" }).format(end);
  if (start.getFullYear() !== end.getFullYear()) return `${start.getDate()} ${startMonth} ${start.getFullYear()}-${end.getDate()} ${endMonth} ${end.getFullYear()}`;
  return startMonth === endMonth
    ? `${start.getDate()}-${end.getDate()} ${endMonth} ${end.getFullYear()}`
    : `${start.getDate()} ${startMonth}-${end.getDate()} ${endMonth} ${end.getFullYear()}`;
}

export function CalendarUtilityRail({ availability, events, onOpenEvents, onManageAvailability }) {
  const scheduling = useSchedulingTime();
  const [tonightOpen, setTonightOpen] = useState(true);
  const [upcomingOpen, setUpcomingOpen] = useState(true);
  const today = scheduling.date;
  const nowTime = scheduling.time;
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
          <div className="pulse-rail-summary"><span>Free players</span><strong>{freePlayers.length} available</strong></div>
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
            return <article key={event.id}><EventGameImage event={event} /><div><strong>{event.title}</strong><span>{formatDate(event.date)} - {event.startTime}</span><small><UsersRound size={12} /> {accepted.length}/{event.maxPlayers} accepted</small></div>{event.ready ? <i><Check size={12} /></i> : null}</article>;
          })}
          {upcoming.length === 0 ? <p>No sessions planned.</p> : null}
          <button className="pulse-view-events" type="button" onClick={onOpenEvents}>View all events</button>
        </div> : null}
      </section>
    </aside>
  );
}

export function CalendarView({ user, data, weekOffset, setWeekOffset, refresh, searchGames, onManageAvailability, onOpenEvents, mode, setMode }) {
  const scheduling = useSchedulingTime();
  const today = scheduling.date;
  const weekStart = useMemo(() => addDays(startOfWeek(new Date(`${today}T12:00:00`)), weekOffset * 7), [weekOffset, today]);
  const days = useMemo(() => Array.from({ length: 7 }, (_, index) => addDays(weekStart, index)), [weekStart]);
  const [bestSlots, setBestSlots] = useState([]);
  const [availabilityDraft, setAvailabilityDraft] = useState(null);
  const [availabilityOpen, setAvailabilityOpen] = useState(false);
  const [sessionComposerOpen, setSessionComposerOpen] = useState(false);
  const [dayCount, setDayCount] = useState(7);
  const [transitionDirection, setTransitionDirection] = useState("next");
  const [error, setError] = useState("");
  const [editing, setEditing] = useState(null);
  const [personId, setPersonId] = useState(user.id);
  const visibleDays = useMemo(() => days.slice(0, dayCount), [days, dayCount]);
  const range = useAvailabilityRange(localDate(days[0]), localDate(days[6]), data.availability);
  const personal = mode === "personal";
  const calendarAvailability = personal ? range.items.filter(item => item.userId === personId) : range.items;
  async function availabilityChanged() { range.reload(); await refresh(); }

  useEffect(() => {
    let active = true;
    const start = localDate(days[0]);
    const end = localDate(days[6]);
    api(`/api/availability/best-times?start=${start}&end=${end}`)
      .then((payload) => { if (active) setBestSlots(payload.slots); })
      .catch(() => { if (active) setBestSlots([]); });
    return () => { active = false; };
  }, [days, data.availability, data.events]);

  function moveWeek(amount) {
    setTransitionDirection(amount < 0 ? "previous" : "next");
    setWeekOffset(weekOffset + amount);
  }

  async function rescheduleEvent(eventId, date, startTime, endTime) {
    setError("");
    try {
      await api(`/api/events/${eventId}`, { method: "PATCH", body: JSON.stringify({ date, startTime, endTime }) });
      await refresh();
    } catch (failure) {
      setError(failure.message);
    }
  }

  function openAvailability(draft = null) {
    if (personal && personId !== user.id) return;
    setAvailabilityDraft(draft);
    setAvailabilityOpen(true);
    window.requestAnimationFrame(() => document.querySelector(".pulse-dock-stack .availability-composer")?.scrollIntoView({ behavior: "smooth", block: "end" }));
  }

  function openSessionComposer() {
    setSessionComposerOpen(true);
    window.requestAnimationFrame(() => document.getElementById("pulse-session-composer")?.scrollIntoView({ behavior: "smooth", block: "end" }));
  }

  return (
    <section className={styles.page}>
      {editing && <AvailabilityDialog items={editing} user={user} onClose={() => setEditing(null)} onSaved={availabilityChanged} />}
      <header className={styles.heading}>
        <div><span className={styles.eyebrow}>{data.groups.find(group => group.id === user.activeGroupId)?.name || "Your squad"}</span><h1>{weekOffset === 0 ? "This week" : "Your week"}</h1></div>
        <span className={styles.timezone}>{scheduling.timezone}</span>
      </header>
      <div className={styles.modeToolbar}>
        <div className={styles.viewSwitch} role="group" aria-label="Calendar audience">
          <button aria-pressed={!personal} onClick={() => setMode("squad")}>Squad</button>
          <button aria-pressed={personal} onClick={() => { setPersonId(user.id); setMode("personal"); }}>My free time</button>
        </div>
        {personal && user.role === "admin" && <label>Manage player<select aria-label="Manage player" value={personId} onChange={event => setPersonId(Number(event.target.value))}>
          <option value={user.id}>Me</option>{data.friends.filter(friend => friend.id !== user.id).map(friend => <option key={friend.id} value={friend.id}>{friend.displayName}</option>)}
        </select></label>}
      </div>
      <div className={styles.toolbar}>
        <div className={styles.dateNav}>
          <button className="icon-button" onClick={() => moveWeek(-1)} aria-label="Previous week"><ChevronLeft size={19} /></button>
          <strong>{calendarRangeLabel(visibleDays)}</strong>
          <button className="icon-button" onClick={() => moveWeek(1)} aria-label="Next week"><ChevronRight size={19} /></button>
        </div>
        <div className={styles.actions}>
          <button className="secondary-button" onClick={() => setWeekOffset(0)}>Today</button>
          <div className={styles.viewSwitch} role="group" aria-label="Calendar view"><button aria-pressed={dayCount === 7} onClick={() => setDayCount(7)}>Week</button><button aria-pressed={dayCount === 5} onClick={() => setDayCount(5)}>5 days</button></div>
          {(!personal || personId === user.id) && <button className="primary-button" aria-label="Log free time" title="Log free time" onClick={() => openAvailability()}><Clock size={16} /> <span>Free time</span></button>}
          {!personal && <button className="secondary-button" aria-label="New session" onClick={openSessionComposer}><Plus size={17} /> <span>New session</span></button>}
        </div>
      </div>
      {error && <p className="form-error" role="alert">{error}</p>}
      {range.error && <p className="form-error" role="alert">{range.error}</p>}
      {range.loading && <p role="status">Loading availability...</p>}
      <div className={styles.calendarMain}>
          <div className={`week-transition week-transition-${transitionDirection}`} key={`${weekOffset}-${mode}-${personId}`}>
            <CalendarGrid
              user={user}
              days={visibleDays}
              availability={calendarAvailability}
              events={personal ? [] : data.events}
              personal={personal}
              onEditAvailability={setEditing}
              bestSlots={bestSlots}
              onAvailabilityDraft={openAvailability}
              onReschedule={rescheduleEvent}
              onOpenEvents={onOpenEvents}
            />
          </div>
      </div>
      <div className={`${styles.composers} pulse-dock-stack`}>
        {availabilityOpen && (!personal || personId === user.id) ? <AvailabilityForm selectedDate={localDate(days[0])} onCreated={() => { availabilityChanged(); setAvailabilityOpen(false); setAvailabilityDraft(null); }} compact draft={availabilityDraft} onManage={onManageAvailability} /> : null}
        {!personal && <EventForm games={data.games} friends={data.friends} selectedDate={localDate(days[0])} onSearchGames={searchGames} onCreated={refresh} expanded={sessionComposerOpen} onToggle={setSessionComposerOpen} />}
      </div>
      {!personal && <CalendarUtilityRail availability={data.availability} events={data.events} onOpenEvents={onOpenEvents} onManageAvailability={onManageAvailability} />}
    </section>
  );
}

