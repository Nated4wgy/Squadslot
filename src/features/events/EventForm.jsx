import { useEffect, useState } from "react";
import { ChevronDown, ChevronUp, Plus, Search, Send, UsersRound } from "lucide-react";
import { api } from "../../lib/api.js";
import { Avatar } from "../../components/PlayerMedia.jsx";
import { useDebouncedSteamSearch } from "../../lib/useSteamSearch.js";
import { FormMessage } from "../../components/forms.jsx";
import styles from "./event-form.module.css";

import { OvernightHint } from "../../components/OvernightHint.jsx";
import { SessionTemplates } from "./SessionTemplates.jsx";

export function EventForm({ games, friends, selectedDate, onSearchGames, onCreated, expanded, onToggle, initialValues, onDraftUsed, eventId }) {
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
    gameOptions: [],
    ...initialValues
  });
  const [query, setQuery] = useState("co-op");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  useDebouncedSteamSearch(query, onSearchGames);
  useEffect(() => {
    if (!initialValues) setForm((current) => ({ ...current, date: selectedDate }));
  }, [selectedDate, initialValues]);

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
    setError("");
    setSaving(true);
    try {
      await api(eventId ? `/api/events/${eventId}` : "/api/events", { method: eventId ? "PATCH" : "POST", body: JSON.stringify(form) });
      await onCreated();
      onDraftUsed?.();
      onToggle(false);
    } catch (failure) {
      setError(failure.message);
    } finally {
      setSaving(false);
    }
  }

  function toggleFriend(id) {
    const inviteIds = form.inviteIds.includes(id)
      ? form.inviteIds.filter((item) => item !== id)
      : [...form.inviteIds, id];
    setForm({ ...form, inviteIds });
  }

  return (
    <form className={`${styles.form} pulse-session-dock${expanded ? " expanded" : ""}`} id="pulse-session-composer" onSubmit={submit}>
      <button className="pulse-dock-label" type="button" onClick={() => onToggle(!expanded)}><Plus size={18} /><span>{eventId ? "Edit session" : "New session"}</span></button>
      <label className="pulse-date-field"><span>Date</span><input type="date" value={form.date} onChange={(event) => setForm({ ...form, date: event.target.value })} /></label>
      <label className="pulse-time-field"><span>Time</span><div><input type="time" value={form.startTime} onChange={(event) => setForm({ ...form, startTime: event.target.value })} /><i>-</i><input type="time" value={form.endTime} onChange={(event) => setForm({ ...form, endTime: event.target.value })} /></div></label>
      <OvernightHint start={form.startTime} end={form.endTime} />
      <label className="pulse-game-field"><span>Game</span><select value={form.steamAppId || ""} onChange={(event) => chooseGame(event.target.value)}><option value="">Select a game</option>{form.steamAppId && !games.some(game => game.appId === Number(form.steamAppId)) && <option value={form.steamAppId}>{form.gameTitle}</option>}{games.map((game) => <option value={game.appId} key={game.appId}>{game.title}</option>)}</select></label>
      <button className="pulse-invite-trigger" type="button" onClick={() => onToggle(true)}><UsersRound size={17} /> {form.inviteIds.length ? `${form.inviteIds.length} invited` : "Select players"}</button>
      <button className="pulse-create-session" type="submit" disabled={saving}><Send size={16} /> {saving ? "Saving..." : eventId ? "Save changes" : "Create session"}</button>
      <button className="pulse-expand-dock" type="button" onClick={() => onToggle(!expanded)} aria-label={expanded ? "Collapse session options" : "Expand session options"}>{expanded ? <ChevronDown size={18} /> : <ChevronUp size={18} />}</button>
      {expanded ? <div className="pulse-session-details">
        {!eventId && <SessionTemplates form={form} friends={friends} onApply={template => setForm(current => ({ ...current, ...template, date: current.date, rsvpDeadline: "", gameOptions: template.gameOptions || [] }))} />}
        <label>Session title<input value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} /></label>
        <label>Search Steam<div className="search-inline"><input placeholder="Search Steam" value={query} onChange={(event) => setQuery(event.target.value)} /><button type="button" onClick={() => onSearchGames(query)} aria-label="Search games"><Search size={17} /></button></div></label>
        {!eventId && <div className="pulse-game-options"><button className="secondary-button" type="button" onClick={addGameOption}><Plus size={16} /> Add voting option</button><div className="game-option-chips">{form.gameOptions.map((option) => <button type="button" key={option.steamAppId} onClick={() => setForm({ ...form, gameOptions: form.gameOptions.filter((item) => item.steamAppId !== option.steamAppId) })}>{option.title} <span>×</span></button>)}{form.gameOptions.length === 0 ? <small>Add multiple games if invitees should vote.</small> : null}</div></div>}
        <div className="two-col"><label>Minimum players<input type="number" min="1" max="100" value={form.minPlayers} onChange={(event) => setForm({ ...form, minPlayers: Number(event.target.value) })} /></label><label>Maximum players<input type="number" min={form.minPlayers} max="100" value={form.maxPlayers} onChange={(event) => setForm({ ...form, maxPlayers: Number(event.target.value) })} /></label></div>
        <label>RSVP deadline<input type="datetime-local" value={form.rsvpDeadline} onChange={(event) => setForm({ ...form, rsvpDeadline: event.target.value })} /></label>
        <label>Session notes<textarea placeholder="Server details, mods, DLC, or voice channel" value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} /></label>
        <div className="invite-list"><span>Invite friends</span>{friends.length === 0 ? <small>No other accounts yet.</small> : null}{friends.map((friend) => <button type="button" className={form.inviteIds.includes(friend.id) ? "selected" : ""} onClick={() => toggleFriend(friend.id)} key={friend.id}><Avatar user={friend} size="tiny" /> {friend.displayName}</button>)}</div>
      </div> : null}
      {error && <div className={styles.error}><FormMessage type="error">{error}</FormMessage></div>}
    </form>
  );
}

