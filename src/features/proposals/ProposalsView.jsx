import { useCallback, useEffect, useState } from "react";
import { Check, Trash2, Plus, Vote } from "lucide-react";
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
      <PageHeader><div><h1>Proposals</h1><p>Vote on the date and game before committing to an event.</p></div></PageHeader>
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
            <OvernightHint start={slot.startTime} end={slot.endTime} />
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
              <div className="proposal-votes">{proposal.slots.map((slot) => <button className={myVote.slotId === slot.id ? "selected" : ""} disabled={!canVote} onClick={() => vote(proposal.id, { slotId: slot.id })} key={slot.id}><span>{formatDate(slot.date)} {slot.startTime}-{slot.endTime}{overnightLabel(slot.startTime, slot.endTime)}</span><strong>{slot.voters.length}</strong></button>)}</div>
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
