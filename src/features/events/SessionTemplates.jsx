import { useEffect, useState } from "react";
import { Save, Trash2 } from "lucide-react";
import { api } from "../../lib/api.js";

export function SessionTemplates({ form, friends, onApply }) {
  const [templates, setTemplates] = useState([]);
  const [selected, setSelected] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true;
    api("/api/session-templates").then(result => { if (active) setTemplates(result.templates); }).catch(failure => { if (active) setError(failure.message); });
    return () => { active = false; };
  }, []);
  async function save(remove = false, update = false) {
    setBusy(true); setError("");
    try {
      const result = await api(remove || update ? `/api/session-templates/${selected}` : "/api/session-templates", {
        method: remove ? "DELETE" : update ? "PUT" : "POST", ...(remove ? {} : { body: JSON.stringify({ ...form, name }) })
      });
      setTemplates(result.templates); setSelected(""); setName("");
    } catch (failure) { setError(failure.message); }
    finally { setBusy(false); }
  }
  return <fieldset className="session-templates" disabled={busy}>
    <legend>My session templates</legend>
    <div className="template-controls">
      <label>Saved template<select value={selected} onChange={event => {
        const id = event.target.value; setSelected(id);
        const template = templates.find(item => item.id === id);
        setName(template?.name || "");
        if (template) onApply({ ...template, inviteIds: template.inviteIds.filter(id => friends.some(friend => friend.id === id)) });
      }}><option value="">Choose a template</option>{templates.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
      <button className="icon-button" type="button" disabled={!selected} title="Delete template" aria-label="Delete template" onClick={() => save(true)}><Trash2 size={17} /></button>
      <label>New template name<input value={name} maxLength={80} onChange={event => setName(event.target.value)} /></label>
      <button className="icon-button" type="button" disabled={!name.trim()} title="Save current session as template" aria-label="Save template" onClick={() => save()}><Save size={17} /></button>
    </div>
    {selected && <button type="button" className="secondary-button" disabled={!name.trim()} onClick={() => save(false, true)}><Save size={16} />Update selected template</button>}
    {error && <p className="form-error" role="alert">{error}</p>}
  </fieldset>;
}
