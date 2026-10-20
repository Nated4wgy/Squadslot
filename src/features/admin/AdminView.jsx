import { useEffect, useState } from "react";
import { Bell, KeyRound, Send, Settings, Zap } from "lucide-react";
import { api } from "../../lib/api.js";
import RegistrationSettings from "./RegistrationSettings.jsx";
import BackupSettings from "./BackupSettings.jsx";

const weekdays = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export default function AdminView({ user }) {
  const [users, setUsers] = useState([]);
  const [settings, setSettings] = useState({ appUrl: "", discordWebhookUrl: "", discordBotName: "SquadSlot", discordApplicationId: "", discordPublicKey: "", discordChannelId: "", discordBotToken: "" });
  const [backups, setBackups] = useState({ backups: [], config: {} });
  const [auditEntries, setAuditEntries] = useState([]);
  const [notifications, setNotifications] = useState([]);
  const [reminders, setReminders] = useState({
    eventTomorrow: true,
    eventStartingSoon: true,
    rsvpDeadline: true,
    weeklySummary: true,
    weeklyDay: 1,
    weeklyTime: "09:00"
  });
  const [message, setMessage] = useState({ type: "", text: "" });
  const [notificationMessage, setNotificationMessage] = useState({ type: "", text: "" });
  const [passwordReset, setPasswordReset] = useState({ userId: null, temporaryPassword: "", confirmPassword: "" });
  const [accountMessage, setAccountMessage] = useState({ type: "", text: "" });

  async function load() {
    const [usersPayload, settingsPayload, notificationsPayload, remindersPayload, backupsPayload, auditPayload] = await Promise.all([
      api("/api/admin/users"),
      api("/api/admin/settings"),
      api("/api/admin/notifications"),
      api("/api/admin/reminders"),
      api("/api/admin/backups"),
      api("/api/admin/audit")
    ]);
    setUsers(usersPayload.users);
    setSettings(settingsPayload.settings);
    setNotifications(notificationsPayload.notifications);
    setReminders(remindersPayload.reminders);
    setBackups(backupsPayload);
    setAuditEntries(auditPayload.entries);
  }

  useEffect(() => {
    load().catch((error) => setMessage({ type: "error", text: error.message }));
  }, []);

  async function saveSettings(event) {
    event.preventDefault();
    setMessage({ type: "", text: "" });
    try {
      await api("/api/admin/settings", { method: "PUT", body: JSON.stringify(settings) });
      setMessage({ type: "success", text: "Settings saved." });
    } catch (error) {
      setMessage({ type: "error", text: error.message });
    }
  }

  async function testDiscord() {
    setMessage({ type: "", text: "" });
    try {
      await api("/api/admin/discord/test", { method: "POST", body: JSON.stringify({}) });
      setMessage({ type: "success", text: "Discord test message sent." });
    } catch (error) {
      setMessage({ type: "error", text: error.message });
    }
  }

  function updateNotification(type, patch) {
    setNotifications((current) => current.map((notification) => (
      notification.type === type ? { ...notification, ...patch } : notification
    )));
  }

  async function saveNotifications(event) {
    event.preventDefault();
    setNotificationMessage({ type: "", text: "" });
    try {
      const payload = await api("/api/admin/notifications", { method: "PUT", body: JSON.stringify({ notifications }) });
      setNotifications(payload.notifications);
      setNotificationMessage({ type: "success", text: "Notification rules saved." });
    } catch (error) {
      setNotificationMessage({ type: "error", text: error.message });
    }
  }

  async function setRole(id, role) {
    await api(`/api/admin/users/${id}`, { method: "PATCH", body: JSON.stringify({ role }) });
    load();
  }

  function togglePasswordReset(accountId) {
    setAccountMessage({ type: "", text: "" });
    setPasswordReset((current) => ({
      userId: current.userId === accountId ? null : accountId,
      temporaryPassword: "",
      confirmPassword: ""
    }));
  }

  async function resetPassword(event, account) {
    event.preventDefault();
    setAccountMessage({ type: "", text: "" });
    if (passwordReset.temporaryPassword !== passwordReset.confirmPassword) {
      setAccountMessage({ type: "error", text: "Temporary passwords do not match." });
      return;
    }

    try {
      await api(`/api/admin/users/${account.id}/password`, {
        method: "PUT",
        body: JSON.stringify({ temporaryPassword: passwordReset.temporaryPassword })
      });
      setPasswordReset({ userId: null, temporaryPassword: "", confirmPassword: "" });
      setAccountMessage({ type: "success", text: `Temporary password set for ${account.displayName}.` });
      await load();
    } catch (resetError) {
      setAccountMessage({ type: "error", text: resetError.message });
    }
  }

  async function saveReminders(event) {
    event.preventDefault();
    setNotificationMessage({ type: "", text: "" });
    try {
      const payload = await api("/api/admin/reminders", { method: "PUT", body: JSON.stringify({ reminders }) });
      setReminders(payload.reminders);
      setNotificationMessage({ type: "success", text: "Reminder schedule saved." });
    } catch (error) {
      setNotificationMessage({ type: "error", text: error.message });
    }
  }

  async function runReminders() {
    await api("/api/admin/reminders/run", { method: "POST", body: JSON.stringify({}) });
    setNotificationMessage({ type: "success", text: "Reminder check completed." });
  }

  return (
    <>
      <header className="topbar">
        <div>
          <h1>Admin</h1>
          <p>Manage accounts and Discord channel updates.</p>
        </div>
      </header>
      <div className="admin-grid">
        {settings.registrationMode && <RegistrationSettings initialMode={settings.registrationMode} users={users} onChanged={load} />}
        <section className="table-panel">
          <h2>Accounts</h2>
          <div className="account-list">
            {users.filter((account) => account.accountStatus !== "pending").map((account) => (
              <article className="account-card" key={account.id}>
                <div className="account-summary">
                  <div className="account-identity">
                    <strong>{account.displayName}</strong>
                    <span>@{account.username}</span>
                    {Boolean(account.mustChangePassword) && <small>Password change required</small>}
                  </div>
                  <span className="account-stat">{account.availabilityCount} free slots</span>
                  <div className="account-controls">
                    <select aria-label={`Role for ${account.displayName}`} value={account.role} disabled={account.id === user.id && account.role === "admin"} onChange={(event) => setRole(account.id, event.target.value)}>
                      <option value="user">User</option>
                      <option value="admin">Admin</option>
                    </select>
                    <button className="secondary-button" type="button" disabled={account.id === user.id} onClick={() => togglePasswordReset(account.id)}>
                      <KeyRound size={16} /> Reset password
                    </button>
                  </div>
                </div>
                {passwordReset.userId === account.id && (
                  <form className="account-password-form" onSubmit={(event) => resetPassword(event, account)}>
                    <label>Temporary password<input type="password" autoComplete="new-password" value={passwordReset.temporaryPassword} onChange={(event) => setPasswordReset({ ...passwordReset, temporaryPassword: event.target.value })} /></label>
                    <label>Confirm password<input type="password" autoComplete="new-password" value={passwordReset.confirmPassword} onChange={(event) => setPasswordReset({ ...passwordReset, confirmPassword: event.target.value })} /></label>
                    <div className="settings-actions">
                      <button className="primary-button" type="submit"><KeyRound size={16} /> Set temporary password</button>
                      <button className="text-button inline-text-button" type="button" onClick={() => togglePasswordReset(account.id)}>Cancel</button>
                    </div>
                  </form>
                )}
              </article>
            ))}
          </div>
          {accountMessage.text && <p className={accountMessage.type === "error" ? "form-error" : "muted"}>{accountMessage.text}</p>}
        </section>
        <form className="table-panel admin-form" onSubmit={saveSettings}>
          <h2>Discord</h2>
          <label>
            App URL
            <input value={settings.appUrl} onChange={(event) => setSettings({ ...settings, appUrl: event.target.value })} />
          </label>
          <label>
            Webhook URL
            <input value={settings.discordWebhookUrl} onChange={(event) => setSettings({ ...settings, discordWebhookUrl: event.target.value })} />
          </label>
          <label>
            Bot name
            <input value={settings.discordBotName} onChange={(event) => setSettings({ ...settings, discordBotName: event.target.value })} />
          </label>
          <div className="two-col">
            <label>Application ID<input value={settings.discordApplicationId || ""} onChange={(event) => setSettings({ ...settings, discordApplicationId: event.target.value })} /></label>
            <label>Channel ID<input value={settings.discordChannelId || ""} onChange={(event) => setSettings({ ...settings, discordChannelId: event.target.value })} /></label>
          </div>
          <label>Public key<input value={settings.discordPublicKey || ""} onChange={(event) => setSettings({ ...settings, discordPublicKey: event.target.value })} /></label>
          <label>Bot token<input type="password" placeholder={settings.discordBotTokenConfigured ? "Configured - leave blank to keep" : "Discord bot token"} value={settings.discordBotToken || ""} onChange={(event) => setSettings({ ...settings, discordBotToken: event.target.value })} /></label>
          <label>Interactions endpoint<input readOnly value={settings.discordInteractionUrl || ""} /></label>
          <div className="settings-actions">
            <button className="primary-button" type="submit"><Settings size={16} /> Save settings</button>
            <button className="secondary-button" type="button" onClick={testDiscord}><Send size={16} /> Send test</button>
          </div>
          {message.text && <p className={message.type === "error" ? "form-error" : "muted"}>{message.text}</p>}
        </form>
        <form className="table-panel admin-form" onSubmit={saveReminders}>
          <h2>Discord reminders</h2>
          {[
            ["eventTomorrow", "Event tomorrow"],
            ["eventStartingSoon", "Starting in one hour"],
            ["rsvpDeadline", "RSVP deadline"],
            ["weeklySummary", "Weekly availability summary"]
          ].map(([key, label]) => (
            <label className="toggle-line" key={key}>
              <input type="checkbox" checked={reminders[key]} onChange={(event) => setReminders({ ...reminders, [key]: event.target.checked })} />
              <span><strong>{label}</strong></span>
            </label>
          ))}
          <div className="two-col">
            <label>
              Weekly day
              <select value={reminders.weeklyDay} onChange={(event) => setReminders({ ...reminders, weeklyDay: Number(event.target.value) })}>
                {weekdays.map((day, index) => <option value={index} key={day}>{day}</option>)}
              </select>
            </label>
            <label>Weekly time<input type="time" value={reminders.weeklyTime} onChange={(event) => setReminders({ ...reminders, weeklyTime: event.target.value })} /></label>
          </div>
          <div className="settings-actions">
            <button className="primary-button"><Settings size={16} /> Save reminders</button>
            <button className="secondary-button" type="button" onClick={runReminders}><Zap size={16} /> Run check now</button>
          </div>
        </form>
        <form className="table-panel admin-form notification-panel" onSubmit={saveNotifications}>
          <div className="section-title compact-title">
            <div>
              <h2>Notification rules</h2>
              <p>Choose Discord posts and edit message templates with variables.</p>
            </div>
            <button className="primary-button" type="submit"><Bell size={16} /> Save rules</button>
          </div>
          <div className="notification-list">
            {notifications.map((notification) => (
              <article className="notification-row" key={notification.type}>
                <label className="toggle-line">
                  <input
                    type="checkbox"
                    checked={notification.enabled}
                    onChange={(event) => updateNotification(notification.type, { enabled: event.target.checked })}
                  />
                  <span>
                    <strong>{notification.label}</strong>
                    <small>{notification.description}</small>
                  </span>
                </label>
                <div className="template-grid">
                  <label>
                    Title
                    <input value={notification.title} onChange={(event) => updateNotification(notification.type, { title: event.target.value })} />
                  </label>
                  <label>
                    Message
                    <textarea value={notification.message} onChange={(event) => updateNotification(notification.type, { message: event.target.value })} />
                  </label>
                </div>
                <small className="template-vars">Variables: {notification.variables.map((variable) => `{${variable}}`).join(", ")}</small>
              </article>
            ))}
          </div>
          {notificationMessage.text && <p className={notificationMessage.type === "error" ? "form-error" : "muted"}>{notificationMessage.text}</p>}
        </form>
        <BackupSettings backups={backups} onChanged={load} />
        <section className="table-panel admin-form audit-panel">
          <h2>Audit log</h2>
          <div className="audit-list">{auditEntries.map((entry) => <article key={entry.id}><div><strong>{entry.actorName}</strong><span>{entry.action}</span></div><small>{new Date(`${entry.createdAt}Z`).toLocaleString()} - {entry.targetType}{entry.targetId ? ` #${entry.targetId}` : ""}</small></article>)}</div>
        </section>
      </div>
    </>
  );
}

