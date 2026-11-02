import { useState } from "react";
import { CalendarPlus, Search } from "lucide-react";
import { api } from "../../lib/api.js";
import { useSchedulingTime } from "../../lib/scheduling-time.jsx";
import { formatDate } from "../../lib/dates.js";

export function FriendPlanner({ user, friends, onPlan }) {
  const { date, timezone } = useSchedulingTime();
  const [start, setStart] = useState(date);
  const [selected, setSelected] = useState([]);
  const [duration, setDuration] = useState(120);
  const [slots, setSlots] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function find(event) {
    event.preventDefault(); setBusy(true); setError(""); setSlots(null);
    try {
      const end = new Date(`${start}T12:00:00Z`); end.setUTCDate(end.getUTCDate() + 6);
      const result = await api(`/api/availability/best-times?start=${start}&end=${end.toISOString().slice(0, 10)}&players=${[user.id, ...selected].join(",")}&duration=${duration}`);
      setSlots(result.slots);
    } catch (failure) { setError(failure.message); }
    finally { setBusy(false); }
  }
  return <section className="friend-planner">
    <h2>Plan with friends</h2>
    <form onSubmit={find}>
      <fieldset disabled={busy}><legend>Players</legend><span>{user.displayName} (you)</span>
        {friends.filter(friend => friend.id !== user.id).map(friend => <label key={friend.id}><input type="checkbox" checked={selected.includes(friend.id)} onChange={event => { setSlots(null); setSelected(ids => event.target.checked ? [...ids, friend.id] : ids.filter(id => id !== friend.id)); }} />{friend.displayName}</label>)}
      </fieldset>
      <div className="planner-controls"><label>Week starting<input disabled={busy} required type="date" value={start} onChange={event => { setStart(event.target.value); setSlots(null); }} /></label>
        <label>Minimum duration<select disabled={busy} value={duration} onChange={event => { setDuration(Number(event.target.value)); setSlots(null); }}>{[30,60,90,120,180,240].map(minutes => <option key={minutes} value={minutes}>{minutes} minutes</option>)}</select></label>
        <button className="primary-button" disabled={busy || !selected.length}><Search size={16} />{busy ? "Finding..." : "Find shared slots"}</button>
      </div>
    </form>
    {error && <p className="form-error" role="alert">{error}</p>}
    {slots && <div className="planner-results" aria-live="polite">
      <p className="muted">{slots.length ? `Everyone selected is free. Times in ${timezone}.` : "No shared slots this week. Try another week or fewer players."}</p>
      {slots.map(slot => <div key={`${slot.date}-${slot.startTime}`}><span><strong>{formatDate(slot.date)}</strong> {slot.startTime} - {slot.endTime === "24:00" ? "00:00 (+1 day)" : slot.endTime}</span><button className="secondary-button" onClick={() => onPlan({ date: slot.date, startTime: slot.startTime, endTime: slot.endTime === "24:00" ? "00:00" : slot.endTime, inviteIds: selected, minPlayers: selected.length + 1, maxPlayers: Math.max(8, selected.length + 1) })}><CalendarPlus size={16} />Plan session</button></div>)}
    </div>}
  </section>;
}
