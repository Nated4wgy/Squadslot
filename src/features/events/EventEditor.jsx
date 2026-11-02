import { useCallback, useEffect, useRef, useState } from "react";
import { DateTime } from "luxon";
import { X } from "lucide-react";
import { EventForm } from "./EventForm.jsx";
import { api } from "../../lib/api.js";
import { useSchedulingTime } from "../../lib/scheduling-time.jsx";

export function EventEditor({ event, onClose, refresh }) {
  const dialog = useRef(null);
  const searchId = useRef(0);
  const [friends, setFriends] = useState(null);
  const [games, setGames] = useState([]);
  const [error, setError] = useState("");
  const { timezone } = useSchedulingTime();
  const [initialValues] = useState(() => {
    const start = DateTime.fromISO(event.startsAtUtc).setZone(timezone);
    const end = DateTime.fromISO(event.endsAtUtc).setZone(timezone);
    return { ...event, date: start.toISODate(), startTime: start.toFormat("HH:mm"), endTime: end.toFormat("HH:mm"),
      inviteIds: event.invites.map(item => item.userId), gameOptions: [],
      rsvpDeadline: event.rsvpDeadline ? DateTime.fromISO(event.rsvpDeadline).setZone(timezone).toFormat("yyyy-MM-dd'T'HH:mm") : "" };
  });
  useEffect(() => {
    const element = dialog.current, previous = document.activeElement;
    element.showModal();
    let active = true;
    api("/api/friends").then(result => { if (active) setFriends(result.users.filter(person => person.id !== event.ownerId)); }).catch(failure => { if (active) setError(failure.message); });
    return () => { active = false; element.close(); if (previous?.isConnected) previous.focus(); };
  }, [event.ownerId]);
  const search = useCallback(async query => {
    const id = ++searchId.current;
    try { const result = await api(`/api/games?q=${encodeURIComponent(query)}`); if (id === searchId.current) setGames(result.games); }
    catch (failure) { if (id === searchId.current) setError(failure.message); }
  }, []);
  return <dialog ref={dialog} className="session-editor" aria-labelledby="session-editor-title" onCancel={event => { event.preventDefault(); onClose(); }}>
    <header><h2 id="session-editor-title">Edit session</h2><button className="icon-button" onClick={onClose} aria-label="Close editor" title="Close"><X size={18} /></button></header>
    <p className="muted">Squad time: {timezone}</p>
    {error && <p className="form-error" role="alert">{error}</p>}
    {friends && <EventForm eventId={event.id} initialValues={initialValues} selectedDate={initialValues.date} friends={friends} games={games} onSearchGames={search} expanded onToggle={() => {}} onCreated={async () => { await refresh(); onClose(); }} />}
  </dialog>;
}
