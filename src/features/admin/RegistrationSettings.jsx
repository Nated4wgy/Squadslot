import { useState } from "react";
import { Check, Shield, X } from "lucide-react";
import { api } from "../../lib/api.js";
import { FormActions, FormField, FormMessage } from "../../components/forms.jsx";
import styles from "./registration.module.css";

export default function RegistrationSettings({ initialMode, users, onChanged }) {
  const [mode, setMode] = useState(initialMode);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState({ type: "", text: "" });
  const pending = users.filter((account) => account.accountStatus === "pending");

  async function save(event) {
    event.preventDefault();
    setBusy(true);
    setMessage({ type: "", text: "" });
    try {
      await api("/api/admin/registration", { method: "PUT", body: JSON.stringify({ registrationMode: mode }) });
      await onChanged();
      setMessage({ type: "success", text: "Registration settings saved." });
    } catch (error) {
      setMessage({ type: "error", text: error.message });
    } finally {
      setBusy(false);
    }
  }

  async function decide(account, decision) {
    if (decision === "reject" && !window.confirm(`Reject and delete the account request for @${account.username}?`)) return;
    setBusy(true);
    setMessage({ type: "", text: "" });
    try {
      await api(`/api/admin/users/${account.id}/approval`, { method: "POST", body: JSON.stringify({ decision }) });
      await onChanged();
      setMessage({ type: "success", text: decision === "approve" ? `${account.displayName} can now sign in.` : "Account request rejected." });
    } catch (error) {
      setMessage({ type: "error", text: error.message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className={`table-panel ${styles.section}`}>
      <h2>Registration</h2>
      <form className={styles.form} onSubmit={save}>
        <FormField label="New accounts" as="select" value={mode} disabled={busy} onChange={(event) => setMode(event.target.value)}>
          <option value="approval">Administrator approval required</option>
          <option value="closed">Registration closed</option>
        </FormField>
        <FormActions><button className="primary-button" disabled={busy}><Shield size={16} /> Save registration</button></FormActions>
      </form>
      <h3>Pending approval <span className="muted">({pending.length})</span></h3>
      {pending.length === 0 && <p className="muted">No pending account requests.</p>}
      <div className={styles.requests}>
        {pending.map((account) => (
          <article className={styles.request} key={account.id}>
            <div className={styles.identity}><strong>{account.displayName}</strong><span className="muted">@{account.username}</span></div>
            <FormActions>
              <button className="secondary-button" type="button" disabled={busy} aria-label={`Approve ${account.username}`} onClick={() => decide(account, "approve")}><Check size={16} /> Approve</button>
              <button className="secondary-button" type="button" disabled={busy} aria-label={`Reject ${account.username}`} onClick={() => decide(account, "reject")}><X size={16} /> Reject</button>
            </FormActions>
          </article>
        ))}
      </div>
      <FormMessage type={message.type}>{message.text}</FormMessage>
    </section>
  );
}
