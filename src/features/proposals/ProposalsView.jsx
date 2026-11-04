import { useCallback, useEffect, useState } from "react";
import { Check, Trash2, Plus, Vote, X, UsersRound } from "lucide-react";
import { Avatar } from "../../components/PlayerMedia.jsx";
import { ProposalGamePicker } from "./ProposalGamePicker.jsx";
import styles from "./proposals.module.css";
import { addDays, formatDate, localDate } from "../../lib/dates.js";
import { api } from "../../lib/api.js";
import { useSchedulingTime } from "../../lib/scheduling-time.jsx";
import { PageHeader } from "../../components/PageLayout.jsx";
import { OvernightHint } from "../../components/OvernightHint.jsx";
import { overnightLabel } from "../../lib/overnight.js";

export function ProposalsView({ user, friends }) {
  const scheduling = useSchedulingTime();
  const tomorrow = localDate(addDays(scheduling.day, 1));
  const [proposals, setProposals] = useState([]);
  const [form, setForm] = useState({
    title: "",
    notes: "",
    slots: [{ date: tomorrow, startTime: "19:00", endTime: "22:00" }],
    games: [],
    inviteIds: []
  });
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  async function perform(action) {
    if (busy) return;
    setBusy(true); setMessage("");
    try { await action(); await load(); }
    catch (error) { setMessage(error.message); }
    finally { setBusy(false); }
  }

  const load = useCallback(() => api("/api/proposals").then((payload) => setProposals(payload.proposals)), []);
  useEffect(() => { load().catch((error) => setMessage(error.message)); }, [load]);
  const updateItem = (key, index, patch) => setForm((current) => ({
    ...current,
    [key]: current[key].map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item)
  }));

  async function createProposal(event) {
    event.preventDefault();
    await perform(async () => {
    await api("/api/proposals", { method: "POST", body: JSON.stringify(form) });
    setForm({ ...form, title: "", notes: "" });
    setMessage("Proposal created.");
    });
  }

  async function vote(id, patch) {
    await perform(async () => {
    await api(`/api/proposals/${id}/vote`, { method: "PUT", body: JSON.stringify(patch) });
    });
  }

  async function finalize(id) {
    await perform(async () => {
    await api(`/api/proposals/${id}/finalize`, { method: "POST", body: JSON.stringify({}) });
    setMessage("Winning time and game turned into an event.");
    });
  }

  async function remove(id) {
    await perform(async () => {
    await api(`/api/proposals/${id}`, { method: "DELETE" });
    });
  }

  return (
    <>
      <PageHeader><div><h1>Proposals</h1><p>Vote on the date and game before committing to an event.</p></div></PageHeader>
      {message && <p role="status" className={styles.message}>{message}</p>}
      <div className={styles.layout}>
        <form className={styles.form} onSubmit={createProposal}>
          <fieldset disabled={busy} className={styles.fields}>
          <h2>New proposal</h2>
          <label>Title<input required maxLength={120} value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} /></label>
          <label>Notes<textarea rows={2} maxLength={1000} value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} /></label>
          <h3>Time options</h3>
          {form.slots.map((slot, index) => <div className={styles.timeOption} key={index}>
            <label>Date<input required aria-label={`Date option ${index + 1}`} type="date" value={slot.date} onChange={(event) => updateItem("slots", index, { date: event.target.value })} /></label>
            <label>Start<input required aria-label={`Start option ${index + 1}`} type="time" value={slot.startTime} onChange={(event) => updateItem("slots", index, { startTime: event.target.value })} /></label>
            <label>End<input required aria-label={`End option ${index + 1}`} type="time" value={slot.endTime} onChange={(event) => updateItem("slots", index, { endTime: event.target.value })} /></label>
            <button type="button" className="icon-button" disabled={form.slots.length === 1} aria-label={`Remove time option ${index + 1}`} title="Remove time" onClick={() => setForm(current => ({...current, slots:current.slots.filter((_, i) => i !== index)}))}><X size={16} /></button>
            <OvernightHint start={slot.startTime} end={slot.endTime} />
          </div>)}
          <button className="secondary-button" type="button" disabled={form.slots.length >= 12} onClick={() => setForm({ ...form, slots: [...form.slots, { date: tomorrow, startTime: "19:00", endTime: "22:00" }] })}><Plus size={15} /> Add time</button>
          <h3>Game options</h3>
          <ProposalGamePicker disabled={busy} games={form.games} onChange={games => setForm(current => ({...current, games}))} />
          <div className={styles.inviteHeading}><h3><UsersRound size={17} /> Players</h3><small>{form.inviteIds.length} invited</small></div>
          <div className={styles.players}>{friends.filter(friend => friend.id !== user.id).map(friend => <button type="button" key={friend.id} aria-pressed={form.inviteIds.includes(friend.id)} onClick={() => setForm(current => ({ ...current, inviteIds: current.inviteIds.includes(friend.id) ? current.inviteIds.filter(id => id !== friend.id) : [...current.inviteIds, friend.id] }))}><Avatar user={friend} size="small" /><span>{friend.displayName}</span><Check size={16} className={styles.selectionMark} /></button>)}</div>
          {friends.filter(friend => friend.id !== user.id).length === 0 && <small className="muted">No other squad members yet.</small>}
          <button className="primary-button"><Vote size={16} /> {busy ? "Saving..." : "Create proposal"}</button>
          </fieldset>
        </form>
        <div className={styles.list}>
          {proposals.map((proposal) => {
            const myVote = proposal.votes.find((voteItem) => voteItem.userId === user.id) || {};
            const canManage = proposal.ownerId === user.id || user.role === "admin";
            const canVote = proposal.status === "open" && proposal.inviteIds.includes(user.id);
            return <article className={`proposal-card ${styles.card}`} key={proposal.id}>
              <div className="section-title compact-title"><div><h2>{proposal.title}</h2><p>By {proposal.ownerName} - {proposal.status}</p></div>{canManage && <button className="danger-button" disabled={busy} aria-label={`Delete ${proposal.title}`} title="Delete proposal" onClick={() => remove(proposal.id)}><Trash2 size={15} /></button>}</div>
              {proposal.notes && <p>{proposal.notes}</p>}
              <h3>Times</h3>
              <div className="proposal-votes">{proposal.slots.map((slot) => <button className={myVote.slotId === slot.id ? "selected" : ""} disabled={!canVote} onClick={() => vote(proposal.id, { slotId: slot.id })} key={slot.id}><span>{formatDate(slot.date)} {slot.startTime}-{slot.endTime}{overnightLabel(slot.startTime, slot.endTime)}</span><strong>{slot.voters.length}</strong></button>)}</div>
              {proposal.games.length > 0 && <><h3>Games</h3><div className="proposal-votes">{proposal.games.map((game) => <button className={myVote.gameId === game.id ? "selected" : ""} disabled={!canVote} onClick={() => vote(proposal.id, { gameId: game.id })} key={game.id}><span>{game.title}</span><strong>{game.voters.length}</strong></button>)}</div></>}
              {canManage && proposal.status === "open" && <button className="primary-button" onClick={() => finalize(proposal.id)}><Check size={16} /> Finalize winner</button>}
            </article>;
          })}
          {proposals.length === 0 && <section className="table-panel"><p className="muted">No proposals yet.</p></section>}
        </div>
      </div>
    </>
  );
}
