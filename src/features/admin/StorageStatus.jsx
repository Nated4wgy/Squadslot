import { useEffect, useState } from "react";
import { HardDrive, RefreshCw } from "lucide-react";
import { api } from "../../lib/api.js";
import styles from "./storage.module.css";

const size = value => value == null ? "Unavailable" : `${(value / 1024 ** 3).toFixed(2)} GB`;

export default function StorageStatus() {
  const [status, setStatus] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function load() {
    setBusy(true);
    try { setStatus(await api("/api/admin/storage")); setError(""); }
    catch (error) { setError(error.message); }
    finally { setBusy(false); }
  }
  useEffect(() => { load(); }, []);
  return <section className={`table-panel ${styles.panel}`}>
    <div className="panel-heading"><HardDrive size={18} /><h2>Storage</h2>
      <button type="button" className="icon-button" onClick={load} disabled={busy} title="Refresh storage status" aria-label="Refresh storage status"><RefreshCw size={17} /></button>
    </div>
    {error && <p role="alert" className="form-error">{error}</p>}
    {!status && !error && <p className="muted">Checking storage...</p>}
    {status && <>
      <div className={styles.volumes}>{[["Database volume", status.databaseVolume], ["Backup volume", status.backupVolume]].map(([label, disk]) =>
        <div key={label}><strong>{label}</strong>
          <span className={disk.state !== "ok" ? styles.warning : ""}>{disk.state === "unknown" ? "Space check unavailable" : `${size(disk.freeBytes)} free (${disk.freePercent.toFixed(1)}%)`}</span>
          {disk.state === "warning" && <span role="alert" className={styles.warning}>Low disk space</span>}
        </div>)}</div>
      <p className="muted">Database {size(status.databaseBytes)} · Write-ahead log {size(status.walBytes)}</p>
      <p className="muted">Audit history: {status.config.auditDays} days, up to {status.config.auditRows.toLocaleString()} entries. Delivery history: {status.config.deliveryDays} days; upcoming-event records retained.</p>
      {status.maintenance && <p className={status.maintenance.ok ? "muted" : "form-error"}>
        {status.maintenance.ok ? "Last cleanup" : "Cleanup failed"}: {new Date(status.maintenance.at).toLocaleString()}
      </p>}
      <small className="muted">Checked {new Date(status.checkedAt).toLocaleString()}</small>
    </>}
  </section>;
}
