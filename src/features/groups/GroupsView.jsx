import { useState } from "react";
import { Link, Plus, RefreshCw, UsersRound } from "lucide-react";
import { api } from "../../lib/api.js";
import { PageHeader } from "../../components/PageLayout.jsx";

export function GroupsView({ user, groups, onChanged }) {
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
      <PageHeader><div><h1>Squads</h1><p>Keep calendars, friends, events, and suggestions separate for each group.</p></div></PageHeader>
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
