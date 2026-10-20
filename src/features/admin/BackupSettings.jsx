import { useState } from "react";
import { Download, Shield, Upload } from "lucide-react";
import { api } from "../../lib/api.js";
import { FormActions, FormMessage } from "../../components/forms.jsx";
import styles from "./backup.module.css";

export default function BackupSettings({ backups, onChanged }) {
  const [message, setMessage] = useState({});
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState(null);
  const [confirmed, setConfirmed] = useState(false);
  const [revoke, setRevoke] = useState(true);

  async function run(action) {
    setBusy(true);
    setMessage({});
    try { await action(); }
    catch (error) { setMessage({ type: "error", text: error.message }); }
    finally { setBusy(false); }
  }

  function download() {
    run(async () => {
      const response = await fetch("/api/admin/backup");
      if (!response.ok) {
        const payload = await response.json();
        throw new Error(payload.error || "Backup export failed.");
      }
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement("a");
      link.href = url;
      link.download = `squadslot-backup-${new Date().toISOString().slice(0, 10)}.json.enc`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setMessage({ text: "Encrypted backup downloaded. Keep the encryption key separately." });
    });
  }

  async function selectFile(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    setSelected(null);
    setConfirmed(false);
    setRevoke(true);
    if (!file) return;
    await run(async () => {
      if (file.size > 32 * 1024 * 1024) throw new Error("Backup must be no larger than 32 MB.");
      const backup = JSON.parse(await file.text());
      if (backup?.format !== "squadslot-encrypted-backup" && backup?.app !== "SquadSlot") throw new Error("This is not a SquadSlot backup.");
      setSelected({ name: file.name, backup });
    });
  }

  function restore() {
    if (!confirmed || !selected) return;
    run(async () => {
      await api("/api/admin/backup/restore", {
        method: "POST", body: JSON.stringify({ backup: selected.backup, confirmRestore: true, revokeCalendarLinks: revoke })
      });
      window.dispatchEvent(new window.Event("squadslot:session-expired"));
    });
  }

  return <section className={`table-panel admin-form ${styles.backup}`}>
    <h2>Backup and restore</h2>
    <p className="muted">Backups contain accounts, password hashes, schedules and configuration secrets. Downloads are encrypted.</p>
    {!backups.config.encrypted && <FormMessage type="error">Encryption is not configured. Set BACKUP_ENCRYPTION_KEY in the server environment to a separate secret of at least 16 characters, then restart.</FormMessage>}
    <FormActions>
      <button className="primary-button" type="button" disabled={busy || !backups.config.encrypted} onClick={download}><Download size={16} /> Download encrypted backup</button>
      <button className="secondary-button" type="button" disabled={busy || !backups.config.encrypted} onClick={() => run(async () => {
        await api("/api/admin/backups/run", { method: "POST", body: "{}" });
        setMessage({ text: "Encrypted backup saved on the server." });
        await onChanged();
      })}><Shield size={16} /> Save on server</button>
    </FormActions>
    <p className="muted">Automatic: {backups.config.enabled ? `every ${backups.config.intervalHours} hours` : "off"}. Retention: {backups.config.retention || 0} files.</p>
    <div className="backup-list">{backups.backups.slice(0, 8).map((backup) => <a href={`/api/admin/backups/${backup.name}`} key={backup.name}><Download size={15} /><span>{backup.name}</span><small>{Math.ceil(backup.size / 1024)} KB</small></a>)}</div>
    <label>Restore from file<input type="file" accept=".enc,.json,application/json" disabled={busy} onChange={selectFile} /></label>
    <p className="muted">Encrypted files require their original BACKUP_ENCRYPTION_KEY. Older unencrypted JSON backups are also accepted. Maximum 32 MB.</p>
    {selected && <div className={styles.confirmation}>
      <h3>Replace current data?</h3>
      <p className={styles.filename}>{selected.name}</p>
      <p>This replaces all squads, accounts, settings and schedules. Everyone will be signed out. Download a current backup first.</p>
      {selected.backup.app === "SquadSlot" && <p>Warning: this legacy file is not encrypted. Store it securely.</p>}
      <label className={styles.option}><input type="checkbox" checked={revoke} disabled={busy} onChange={(event) => setRevoke(event.target.checked)} /><span>Revoke calendar subscription links</span></label>
      <p className="muted">{revoke ? "Members must create new links and resubscribe on their devices." : "Links from this backup will work again. Only preserve links from a trusted, unexposed backup."}</p>
      <label className={styles.option}><input type="checkbox" checked={confirmed} disabled={busy} onChange={(event) => setConfirmed(event.target.checked)} /><span>I understand this replaces all current data.</span></label>
      <FormActions>
        <button className="primary-button" type="button" disabled={busy || !confirmed} onClick={restore}><Upload size={16} /> Restore and sign out</button>
        <button className="secondary-button" type="button" disabled={busy} onClick={() => { setSelected(null); setConfirmed(false); }}>Cancel</button>
      </FormActions>
    </div>}
    <FormMessage type={message.type}>{busy ? "Working..." : message.text}</FormMessage>
  </section>;
}
