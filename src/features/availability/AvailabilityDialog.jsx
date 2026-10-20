import { useEffect, useRef, useState } from "react";
import { ArrowLeft, Check, Trash2, X } from "lucide-react";
import { api } from "../../lib/api.js";
import { FormField, FormMessage, FormActions } from "../../components/forms.jsx";
import { availabilityDate, weekdays } from "./labels.js";
import styles from "./availability-editor.module.css";

export function AvailabilityDialog({ items, user, onClose, onSaved }) {
  const dialog = useRef(null);
  const busy = useRef(false);
  const [selected, setSelected] = useState(items.length === 1 ? items[0] : null);
  useEffect(() => {
    const element = dialog.current;
    const previousFocus = document.activeElement;
    element.showModal();
    return () => {
      element.close();
      if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
    };
  }, []);
  function close() { if (!busy.current) onClose(); }
  return <dialog ref={dialog} className={styles.dialog} aria-labelledby="availability-dialog-title" onCancel={event => { event.preventDefault(); close(); }}>
    <header className={styles.header}>
      {selected && items.length > 1 && <button className="icon-button" aria-label="Back to entries" onClick={() => { if (!busy.current) setSelected(null); }}><ArrowLeft size={18} /></button>}
      <h2 id="availability-dialog-title">Free time</h2>
      <button className="icon-button" aria-label="Close free time" title="Close" onClick={close}><X size={18} /></button>
    </header>
    {selected ? <AvailabilityDetails key={selected.id} item={selected} user={user} onBusy={value => { busy.current = value; }} onSaved={onSaved} onClose={onClose} />
      : <div className={styles.entries}>{items.map(item => <button key={item.id} onClick={() => setSelected(item)}>
        <strong>{item.displayName}</strong><span>{availabilityDate(item.date)}</span><span>{item.startTime}-{item.endTime}{item.recurring ? " · Repeating" : ""}</span>
      </button>)}</div>}
  </dialog>;
}

function AvailabilityDetails({ item, user, onBusy, onSaved, onClose }) {
  const canEdit = item.userId === user.id || user.role === "admin";
  const [scope, setScope] = useState(item.seriesOnly ? "series" : "date");
  const [form, setForm] = useState({ date: item.date, startTime: item.startTime, endTime: item.endTime, note: item.note || "", weekday: item.weekday, startDate: item.startDate, endDate: item.endDate || "" });
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState("");
  const series = scope === "series";
  const change = key => event => setForm(current => ({ ...current, [key]: key === "weekday" ? Number(event.target.value) : event.target.value }));
  async function save(remove = false) {
    if (saving) return;
    setError(""); setSaving(true); onBusy(true);
    try {
      const route = series ? `/api/availability/recurring/${item.ruleId}` : `/api/availability/${item.id}`;
      const body = series
        ? { weekday: form.weekday, startDate: form.startDate, endDate: form.endDate, startTime: form.startTime, endTime: form.endTime, note: form.note }
        : { date: form.date, startTime: form.startTime, endTime: form.endTime, note: form.note };
      await api(route, { method: remove ? "DELETE" : "PATCH", ...(remove ? {} : { body: JSON.stringify(body) }) });
      await onSaved();
      onClose();
    } catch (failure) { setError(failure.message); }
    finally { setSaving(false); onBusy(false); }
  }
  return <form className={styles.form} onSubmit={event => { event.preventDefault(); save(); }}>
    <div className={styles.summary}><strong>{item.displayName}</strong>
      {item.seriesOnly ? <><span>Every {weekdays[item.weekday]}</span><span>{availabilityDate(item.startDate)} - {item.endDate ? availabilityDate(item.endDate) : "No end date"}</span></> : <span>{availabilityDate(item.date)}</span>}
      <span>{item.startTime}-{item.endTime}</span>
    </div>
    {item.recurring && <fieldset className={styles.scope} disabled={saving || !canEdit}>
      <legend>Apply changes to</legend>
      {!item.seriesOnly && <label><input type="radio" name="scope" checked={!series} onChange={() => { setScope("date"); setConfirmDelete(false); }} /> This date only</label>}
      <label><input type="radio" name="scope" checked={series} onChange={() => { setScope("series"); setConfirmDelete(false); }} /> Every {weekdays[item.weekday]} (whole series)</label>
    </fieldset>}
    <fieldset className={styles.fields} disabled={saving || !canEdit || confirmDelete}>
      {series ? <>
        <FormField label="Repeats on" as="select" value={form.weekday} onChange={change("weekday")}>{weekdays.map((day, i) => <option key={day} value={i}>{day}</option>)}</FormField>
        <div className={styles.columns}><FormField label="Starts" type="date" required value={form.startDate} onChange={change("startDate")} /><FormField label="Ends (optional)" type="date" min={form.startDate} value={form.endDate} onChange={change("endDate")} /></div>
      </> : <FormField label="Date" type="date" required value={form.date} onChange={change("date")} />}
      <div className={styles.columns}><FormField label="Start time" type="time" required value={form.startTime} onChange={change("startTime")} /><FormField label="End time" type="time" required value={form.endTime} onChange={change("endTime")} /></div>
      <FormField label="Note" as="textarea" maxLength={200} value={form.note} onChange={change("note")} />
    </fieldset>
    {error && <FormMessage type="error">{error}</FormMessage>}
    {canEdit && (confirmDelete ? <div className={styles.confirm}>
      <p>{series ? `Delete every ${weekdays[item.weekday]} in this series?` : `Remove free time on ${availabilityDate(item.date)}?`}</p>
      <FormActions><button type="button" className="secondary-button" disabled={saving} onClick={() => setConfirmDelete(false)}>Cancel</button><button type="button" className="danger-button" disabled={saving} onClick={() => save(true)}><Trash2 size={16} /> Confirm delete</button></FormActions>
    </div> : <FormActions>
      <button type="button" className="danger-button" disabled={saving} onClick={() => setConfirmDelete(true)}><Trash2 size={16} /> {series ? "Delete series" : item.recurring ? "Skip this date" : "Delete entry"}</button>
      <button type="submit" className="primary-button" disabled={saving}><Check size={16} /> {saving ? "Saving..." : "Save changes"}</button>
    </FormActions>)}
  </form>;
}
