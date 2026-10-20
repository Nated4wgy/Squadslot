import { useEffect, useState } from "react";
import { KeyRound } from "lucide-react";
import { api } from "../../lib/api.js";
import { FormField, FormMessage } from "../../components/forms.jsx";

export function PasswordChangeScreen({ user, onChanged, onLogout }) {
  const [form, setForm] = useState({ currentPassword: "", newPassword: "", confirmPassword: "" });
  const [error, setError] = useState("");

  async function submit(event) {
    event.preventDefault();
    setError("");
    if (form.newPassword !== form.confirmPassword) {
      setError("New passwords do not match.");
      return;
    }

    try {
      const payload = await api("/api/me/password", {
        method: "PUT",
        body: JSON.stringify({ currentPassword: form.currentPassword, newPassword: form.newPassword })
      });
      onChanged(payload.user);
    } catch (changeError) {
      setError(changeError.message);
    }
  }

  return (
    <main className="auth-shell">
      <section className="auth-panel password-change-panel">
        <div className="brand-lockup"><img className="brand-logo" src="/squadslot-logo-transparent.png" alt="SquadSlot" /></div>
        <div className="password-change-heading">
          <KeyRound size={22} />
          <div>
            <h1>Choose a new password</h1>
            <p>Signed in as {user.displayName}. Replace the temporary password to continue.</p>
          </div>
        </div>
        <form className="auth-form" onSubmit={submit}>
          <FormField label="Temporary password" type="password" autoComplete="current-password" value={form.currentPassword} onChange={(event) => setForm({ ...form, currentPassword: event.target.value })} />
          <FormField label="New password" type="password" autoComplete="new-password" value={form.newPassword} onChange={(event) => setForm({ ...form, newPassword: event.target.value })} />
          <FormField label="Confirm new password" type="password" autoComplete="new-password" value={form.confirmPassword} onChange={(event) => setForm({ ...form, confirmPassword: event.target.value })} />
          <FormMessage type="error">{error}</FormMessage>
          <button className="primary-button" type="submit"><KeyRound size={16} /> Save new password</button>
        </form>
        <button className="text-button" type="button" onClick={onLogout}>Sign out</button>
      </section>
    </main>
  );
}

export function AuthScreen({ onSignedIn }) {
  const [mode, setMode] = useState("login");
  const [setupKnown, setSetupKnown] = useState(false);
  const [setup, setSetup] = useState({ hasUsers: true, registrationMode: "closed" });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [form, setForm] = useState({ username: "", displayName: "", password: "" });
  const [error, setError] = useState("");

  useEffect(() => {
    api("/api/setup")
      .then((payload) => {
        setSetup(payload);
        setMode(payload.hasUsers ? "login" : "register");
      })
      .catch(() => setError("Unable to check registration settings. Please reload to try again."))
      .finally(() => setSetupKnown(true));
  }, []);

  async function submit(event) {
    event.preventDefault();
    setError("");
    setMessage("");
    setBusy(true);
    try {
      const payload = await api(`/api/auth/${mode}`, { method: "POST", body: JSON.stringify(form) });
      if (payload.pendingApproval) {
        setMessage(payload.message);
        setForm((current) => ({ ...current, password: "" }));
        setMode("login");
        return;
      }
      onSignedIn(payload.user);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="auth-shell">
      <section className="auth-panel">
        <div className="brand-lockup">
          <img className="brand-logo" src="/squadslot-logo-transparent.png" alt="SquadSlot" />
        </div>
        <h1>Plan the next session without the chat scroll.</h1>
        <p>{mode === "register" ? (setup.hasUsers ? "New accounts require administrator approval." : "The first account created becomes the admin.") : "Sign in to see the group calendar."}</p>
        {!setupKnown && <p className="muted">Checking setup...</p>}
        <form onSubmit={submit} className="auth-form">
          <FormField label="Username" autoComplete="username" required maxLength={24} value={form.username} onChange={(event) => setForm({ ...form, username: event.target.value })} />
          {mode === "register" && (
            <FormField label="Display name" required maxLength={60} value={form.displayName} onChange={(event) => setForm({ ...form, displayName: event.target.value })} />
          )}
          <FormField label="Password" type="password" required autoComplete={mode === "login" ? "current-password" : "new-password"} value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} />
          <FormMessage type="error">{error}</FormMessage>
          <FormMessage>{message}</FormMessage>
          <button className="primary-button" type="submit" disabled={busy || !setupKnown}>{busy ? "Please wait..." : mode === "login" ? "Sign in" : setup.hasUsers ? "Request an account" : "Create account"}</button>
        </form>
        {setupKnown && (!setup.hasUsers || setup.registrationMode !== "closed" || mode === "register") && <button className="text-button" disabled={busy} onClick={() => { setMode(mode === "login" ? "register" : "login"); setError(""); setMessage(""); }}>
          {mode === "login" ? "Need an account?" : "Already have an account?"}
        </button>}
        {setupKnown && setup.hasUsers && setup.registrationMode === "closed" && <p className="muted">Registration is closed.</p>}
      </section>
    </main>
  );
}

