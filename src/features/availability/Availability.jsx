import { useEffect, useState } from "react";
import { CalendarDays, Check, ChevronLeft, ChevronRight, Pencil, Plus, Repeat, Settings, Sparkles, Trash2 } from "lucide-react";
import { api } from "../../lib/api.js";
import { addDays, localDate, nextWeekday, startOfWeek } from "../../lib/dates.js";
import { AvailabilityDialog } from "./AvailabilityDialog.jsx";
import { availabilityDate, weekdays, weekdayOrder } from "./labels.js";
import { useAvailabilityRange } from "./useAvailabilityRange.js";
import styles from "./availability.module.css";
import { useSchedulingTime } from "../../lib/scheduling-time.jsx";

export { weekdays, weekdayOrder } from "./labels.js";

export function AvailabilityForm({ selectedDate, onCreated, compact = false, draft, onManage }) {
  const scheduling = useSchedulingTime();
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
      date: preset.date || (preset.weekday === null || preset.weekday === undefined ? current.date : nextWeekday(preset.weekday, scheduling.day)),
      weekdays: preset.weekdays || (preset.weekday === null || preset.weekday === undefined ? current.weekdays : [preset.weekday]),
      startDate: preset.startDate || scheduling.date,
      endDate: preset.endDate || "",
      startTime: preset.startTime,
      endTime: preset.endTime,
      note: preset.note || ""
    }));
    setStatus("");
  }

  function applyQuickPreset(value) {
    const today = scheduling.day;
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
    <form className={`utility-form availability-composer availability-mode-${form.mode}${compact ? ` ${styles.compact}` : ""}`} onSubmit={submit}>
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
        <select aria-label="Quick preset" value="" onChange={(event) => applyQuickPreset(event.target.value)}>
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
      {form.mode === "weekly" && <p className="muted">Occurrences with missing or repeated clock-change times are skipped.</p>}
      <button className="secondary-button availability-save" type="submit"><Check size={16} /> Save {form.mode === "weekly" ? "weekly" : ""}</button>
      {status && <p className={`availability-status${status.includes("invalid") || status.includes("required") ? " form-error" : ""}`}>{status}</p>}
    </form>
  );
}

export function RecurringAvailability({ refresh, user, ownerFilter, refreshKey }) {
  const scheduling = useSchedulingTime();
  const [rules, setRules] = useState([]);
  const [presets, setPresets] = useState([]);
  const [editing, setEditing] = useState(null);
  const [error, setError] = useState("");
  const [rule, setRule] = useState({
    weekdays: [5],
    startTime: "19:00",
    endTime: "23:00",
    note: "",
    startDate: scheduling.date,
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

  useEffect(() => { load().catch(failure => setError(failure.message)); }, [refreshKey]);

  async function addRule(event) {
    event.preventDefault();
    await api("/api/availability/recurring", { method: "POST", body: JSON.stringify(rule) });
    setRule({ ...rule, note: "" });
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
      {editing && <AvailabilityDialog items={[editing]} user={user} onClose={() => setEditing(null)} onSaved={async () => { await load(); await refresh(); }} />}
      {error && <p role="alert" className="form-error">{error}</p>}
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
        <p className="muted">Occurrences with missing or repeated clock-change times are skipped.</p>
        <button className="secondary-button"><Repeat size={16} /> Add weekly rule</button>
        <div className="rule-list">
          {rules.filter(item => ownerFilter === "all" || item.userId === user.id).map((item) => (
            <div key={item.id}>
              <span className={styles.ruleSummary}><strong>Every {weekdays[item.weekday]} · {item.startTime}-{item.endTime}</strong>
                {ownerFilter === "all" && <small>{item.displayName}</small>}
                <small>{availabilityDate(item.startDate)} - {item.endDate ? availabilityDate(item.endDate) : "No end date"}</small>
                <small>{item.nextDate ? `Next: ${availabilityDate(item.nextDate)}` : "No upcoming dates"}</small>
              </span>
              <button type="button" className="icon-button" title="Edit repeating schedule" onClick={() => setEditing({ ...item, id: `rule-${item.id}-${item.nextDate || item.startDate}`, ruleId: item.id, date: item.nextDate || item.startDate, recurring: true, seriesOnly: true })} aria-label={`Edit every ${weekdays[item.weekday]} for ${item.displayName}`}><Pencil size={15} /></button>
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

export function FreeTimeView({ user, availability, refresh, onOpenCalendar }) {
  const scheduling = useSchedulingTime();
  const [selectedDate, setSelectedDate] = useState(scheduling.date);
  const [ownerFilter, setOwnerFilter] = useState("mine");
  const [editing, setEditing] = useState(null);
  const start = localDate(startOfWeek(new Date(`${selectedDate}T12:00:00`)));
  const end = localDate(addDays(new Date(`${start}T12:00:00`), 6));
  const range = useAvailabilityRange(start, end, availability);
  const visibleAvailability = range.items.filter(item => ownerFilter === "all" || item.userId === user.id);
  const dates = [...new Set(visibleAvailability.map(item => item.date))];
  async function changed() { range.reload(); await refresh(); }

  return (
    <>
      <header className="topbar">
        <div>
          <h1>Availability</h1>
          <p>My free time</p>
        </div>
        <button className="secondary-button" onClick={onOpenCalendar}><CalendarDays size={17} /> Personal calendar</button>
      </header>
      {editing && <AvailabilityDialog items={[editing]} user={user} onClose={() => setEditing(null)} onSaved={changed} />}
      <div className="free-time-layout">
        <AvailabilityForm selectedDate={selectedDate} onCreated={changed} />
        <section className="table-panel">
          <div className="section-title compact-title">
            <div>
              <h2>{ownerFilter === "all" ? "Squad availability" : "My availability"}</h2>
            </div>
          </div>
          <div className={styles.agendaToolbar}>
            <button className="icon-button" aria-label="Previous availability week" onClick={() => setSelectedDate(localDate(addDays(new Date(`${start}T12:00:00`), -7)))}><ChevronLeft size={18} /></button>
            <label>Week of<input type="date" value={selectedDate} onChange={event => { if (event.target.value) setSelectedDate(event.target.value); }} /></label>
            <button className="icon-button" aria-label="Next availability week" onClick={() => setSelectedDate(localDate(addDays(new Date(`${start}T12:00:00`), 7)))}><ChevronRight size={18} /></button>
            {user.role === "admin" && <label>Show<select aria-label="Show" value={ownerFilter} onChange={event => setOwnerFilter(event.target.value)}><option value="mine">My free time</option><option value="all">All squad members</option></select></label>}
          </div>
          {range.error && <p className="form-error" role="alert">{range.error}</p>}
          {range.loading && <p role="status">Loading availability...</p>}
          {!range.loading && visibleAvailability.length === 0 && <p className="muted">No free time this week.</p>}
          <div className="free-time-list" aria-label="Availability agenda">
            {dates.map(date => <section key={date} className={styles.agendaDay}><h3>{availabilityDate(date)}</h3>{visibleAvailability.filter(item => item.date === date).map(item => (
                <article className="free-time-row" key={item.id}>
                  <div>
                    <strong>{item.startTime} to {item.endTime}</strong>
                    {ownerFilter === "all" && <span>{item.displayName}</span>}
                    <small>{item.recurring ? `Every ${weekdays[item.weekday]}` : "One-off"}{item.note ? ` - ${item.note}` : ""}</small>
                  </div>
                  <button className="icon-button" title="Edit free time" onClick={() => setEditing(item)} aria-label={`Edit free time for ${item.displayName} on ${availabilityDate(item.date)} at ${item.startTime}`}><Pencil size={16} /></button>
                </article>
              ))}</section>)}
          </div>
        </section>
      </div>
      <RecurringAvailability refresh={changed} user={user} ownerFilter={ownerFilter} refreshKey={availability} />
    </>
  );
}

