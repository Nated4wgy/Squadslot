import styles from "./profile.module.css";
import { useEffect, useState } from "react";
import { CalendarDays, Copy, Moon, RefreshCw, Settings, Sun, Unlink } from "lucide-react";
import { Avatar } from "../../components/PlayerMedia.jsx";
import { api } from "../../lib/api.js";
import PushPreferences from "../../PushPreferences.jsx";
import { PageHeader, FormGrid } from "../../components/PageLayout.jsx";
import { FormField } from "../../components/forms.jsx";
import { MotionSettings } from "../motion/Motion.jsx";

export function ProfileView({ user, onSaved }) {
  const [form, setForm] = useState({ ...user });
  const [message, setMessage] = useState("");
  const [subscription, setSubscription] = useState({ active: false, createdAt: null, lastUsedAt: null });
  const [subscriptionUrls, setSubscriptionUrls] = useState(null);
  const [subscriptionMessage, setSubscriptionMessage] = useState("");

  useEffect(() => {
    api("/api/calendar/subscription")
      .then((payload) => setSubscription(payload.subscription))
      .catch((error) => setSubscriptionMessage(error.message));
  }, []);

  async function save(event) {
    event.preventDefault();
    const payload = await api("/api/profile", { method: "PUT", body: JSON.stringify(form) });
    setForm(payload.profile);
    onSaved(payload.profile);
    setMessage("Profile saved.");
  }

  async function generateSubscription() {
    const payload = await api("/api/calendar/subscription", { method: "POST", body: JSON.stringify({}) });
    setSubscription(payload.subscription);
    setSubscriptionUrls({
      httpsUrl: payload.subscription.httpsUrl,
      webcalUrl: payload.subscription.webcalUrl
    });
    setSubscriptionMessage("Private live calendar link generated.");
  }

  async function copySubscription() {
    if (!subscriptionUrls?.httpsUrl) return;
    try {
      await navigator.clipboard.writeText(subscriptionUrls.httpsUrl);
      setSubscriptionMessage("Subscription URL copied.");
    } catch {
      setSubscriptionMessage("Copy failed. Select the URL manually.");
    }
  }

  async function revokeSubscription() {
    await api("/api/calendar/subscription", { method: "DELETE" });
    setSubscription({ active: false, createdAt: null, lastUsedAt: null });
    setSubscriptionUrls(null);
    setSubscriptionMessage("Live calendar link revoked.");
  }

  return (
    <div className={styles.view}>
      <PageHeader><div><h1>Profile</h1><p>Identity, gaming preferences, timezone, and appearance.</p></div></PageHeader>
      <MotionSettings />
      <form className="profile-editor" onSubmit={save}>
        <section className="profile-preview">
          <Avatar user={form} size="large" />
          <h2>{form.displayName}</h2>
          <span>@{form.username}</span>
          {form.discordUsername && <p>{form.discordUsername}</p>}
        </section>
        <section className="table-panel profile-fields">
          <FormGrid>
            <FormField label="Display name" value={form.displayName} onChange={(event) => setForm({ ...form, displayName: event.target.value })} />
            <FormField label="Discord username" value={form.discordUsername} onChange={(event) => setForm({ ...form, discordUsername: event.target.value })} />
          </FormGrid>
          <FormField label="Discord user ID" inputMode="numeric" value={form.discordUserId || ""} onChange={(event) => setForm({ ...form, discordUserId: event.target.value })} />
          <FormField label="Avatar HTTPS URL" value={form.avatarUrl} onChange={(event) => setForm({ ...form, avatarUrl: event.target.value })} />
          <FormField label="Favourite games" as="textarea" value={form.favoriteGames} onChange={(event) => setForm({ ...form, favoriteGames: event.target.value })} />
          <FormGrid>
            <FormField label="Timezone" value={form.timezone} onChange={(event) => setForm({ ...form, timezone: event.target.value })} />
            <FormField label="Profile colour" type="color" value={form.profileColor} onChange={(event) => setForm({ ...form, profileColor: event.target.value })} />
          </FormGrid>
          <FormGrid>
            <FormField label="Preferred start" type="time" value={form.preferredStart} onChange={(event) => setForm({ ...form, preferredStart: event.target.value })} />
            <FormField label="Preferred end" type="time" value={form.preferredEnd} onChange={(event) => setForm({ ...form, preferredEnd: event.target.value })} />
          </FormGrid>
          <div className="appearance-row">
            <label>Theme
              <select value={form.theme} onChange={(event) => setForm({ ...form, theme: event.target.value })}>
                <option value="dark">Dark</option><option value="light">Light</option><option value="system">System</option>
              </select>
            </label>
            <label>Accent colour<input type="color" value={form.accent} onChange={(event) => setForm({ ...form, accent: event.target.value })} /></label>
            <div className="theme-icons">{form.theme === "light" ? <Sun /> : <Moon />}</div>
          </div>
          <button className="primary-button"><Settings size={16} /> Save profile</button>
          {message && <p className="muted">{message}</p>}
        </section>
        <PushPreferences request={api} />
        <section className="table-panel calendar-subscription-panel">
          <div className="panel-heading">
            <RefreshCw size={18} />
            <div>
              <h2>Live calendar subscription</h2>
              <p>Events, your free time, and matching availability update through a private calendar feed.</p>
            </div>
            <span className={`subscription-state${subscription.active ? " active" : ""}`}>
              {subscription.active ? "Active" : "Off"}
            </span>
          </div>
          {subscription.active && (
            <div className="subscription-meta">
              <span>Created {subscription.createdAt ? new Date(`${subscription.createdAt}${subscription.createdAt.endsWith("Z") ? "" : "Z"}`).toLocaleString() : "recently"}</span>
              <span>{subscription.lastUsedAt ? `Last refreshed ${new Date(`${subscription.lastUsedAt}${subscription.lastUsedAt.endsWith("Z") ? "" : "Z"}`).toLocaleString()}` : "Not refreshed yet"}</span>
            </div>
          )}
          {subscriptionUrls && (
            <div className="subscription-url">
              <input aria-label="Private calendar subscription URL" readOnly value={subscriptionUrls.httpsUrl} />
              <button className="icon-button dark-icon-button" type="button" onClick={copySubscription} aria-label="Copy calendar subscription URL"><Copy size={17} /></button>
              <a className="secondary-button" href={subscriptionUrls.webcalUrl}><CalendarDays size={16} /> Subscribe</a>
            </div>
          )}
          {subscription.active && !subscriptionUrls && (
            <p className="muted">The existing private URL is hidden. Regenerate it to display and copy a new URL.</p>
          )}
          <div className="subscription-actions">
            <button className="primary-button" type="button" onClick={generateSubscription}>
              <RefreshCw size={16} /> {subscription.active ? "Regenerate private link" : "Generate private link"}
            </button>
            {subscription.active && (
              <button className="danger-text-button" type="button" onClick={revokeSubscription}><Unlink size={16} /> Revoke</button>
            )}
          </div>
          <p className="subscription-warning">Treat the subscription URL like a password. Regenerating or revoking it disconnects existing calendar apps.</p>
          {subscriptionMessage && <p className="muted">{subscriptionMessage}</p>}
        </section>
      </form>
    </div>
  );
}
