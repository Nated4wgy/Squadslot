import React, { useEffect, useState } from "react";
import { Bell, BellOff, Send } from "lucide-react";

export async function disableDevicePush(request) {
  if (!("serviceWorker" in navigator)) return;
  const registration = await navigator.serviceWorker.getRegistration();
  const subscription = await registration?.pushManager?.getSubscription();
  if (subscription) {
    try { await request("/api/push", { method: "DELETE", body: JSON.stringify({ endpoint: subscription.endpoint }) }); }
    finally { await subscription.unsubscribe(); }
  }
  const notifications = await registration?.getNotifications();
  notifications?.forEach((notification) => notification.close());
}

export default function PushPreferences({ request }) {
  const supported = window.isSecureContext && "Notification" in window && "PushManager" in window && "serviceWorker" in navigator;
  const [config, setConfig] = useState(null);
  const [enabled, setEnabled] = useState(false);
  const [preferences, setPreferences] = useState({ invites: true, reminders: true });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  useEffect(() => {
    let cancelled = false;
    async function load() {
      const info = await request("/api/push");
      if (cancelled) return;
      setConfig(info);
      if (!supported) return;
      const registration = await navigator.serviceWorker.getRegistration();
      const subscription = await registration?.pushManager.getSubscription();
      if (!subscription) return;
      const status = await request("/api/push/status", { method: "POST", body: JSON.stringify({ endpoint: subscription.endpoint }) });
      if (!cancelled && status.subscribed) {
        setEnabled(true);
        setPreferences({ invites: status.invites, reminders: status.reminders });
      }
    }
    load().catch((error) => { if (!cancelled) setMessage(error.message); });
    return () => { cancelled = true; };
  }, [request, supported]);

  async function enable() {
    setBusy(true); setMessage("");
    try {
      if (await window.Notification.requestPermission() !== "granted") throw new Error("Notifications are blocked. Allow them in your browser settings, then try again.");
      await navigator.serviceWorker.register("/service-worker.js");
      const registration = await navigator.serviceWorker.ready;
      const bytes = Uint8Array.from(window.atob(config.publicKey.replaceAll("-", "+").replaceAll("_", "/")), (char) => char.charCodeAt(0));
      let subscription = await registration.pushManager.getSubscription();
      if (subscription && String(new Uint8Array(subscription.options.applicationServerKey || [])) !== String(bytes)) {
        await subscription.unsubscribe(); subscription = null;
      }
      subscription ||= await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: bytes });
      await request("/api/push", { method: "POST", body: JSON.stringify({ subscription: subscription.toJSON(), ...preferences }) });
      setEnabled(true); setMessage("Notifications enabled on this device.");
    } catch (error) { setMessage(error.message); }
    finally { setBusy(false); }
  }

  async function update(next) {
    setBusy(true); setMessage("");
    try {
      if (enabled) {
        const registration = await navigator.serviceWorker.ready;
        const subscription = await registration.pushManager.getSubscription();
        if (!subscription) { setEnabled(false); throw new Error("Enable notifications again on this device."); }
        await request("/api/push", { method: "POST", body: JSON.stringify({ subscription: subscription.toJSON(), ...next }) });
      }
      setPreferences(next);
    } catch (error) { setMessage(error.message); }
    finally { setBusy(false); }
  }

  async function disable() {
    setBusy(true); setMessage("");
    try { await disableDevicePush(request); setEnabled(false); setMessage("Notifications disabled on this device."); }
    catch (error) { setMessage(error.message); }
    finally { setBusy(false); }
  }

  async function test() {
    setBusy(true); setMessage("");
    try {
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();
      await request("/api/push/test", { method: "POST", body: JSON.stringify({ endpoint: subscription?.endpoint }) });
      setMessage("Test accepted by the push service. Check this device's notifications.");
    } catch (error) { setMessage(error.message); }
    finally { setBusy(false); }
  }

  return <section className="table-panel push-preferences">
    <div className="panel-heading"><Bell size={18} /><div><h2>Device notifications</h2><p>{enabled ? "Enabled on this device" : "Not enabled on this device"}</p></div></div>
    <label className="toggle-line"><input type="checkbox" checked={preferences.invites} disabled={busy} onChange={(event) => update({ ...preferences, invites: event.target.checked })} /> Event invites</label>
    <label className="toggle-line"><input type="checkbox" checked={preferences.reminders} disabled={busy} onChange={(event) => update({ ...preferences, reminders: event.target.checked })} /> Event reminders</label>
    <div className="settings-actions">
      <button type="button" className="secondary-button" disabled={busy || !supported || !config?.configured} onClick={enabled ? disable : enable}>{enabled ? <BellOff size={16} /> : <Bell size={16} />}{enabled ? "Disable on this device" : "Enable on this device"}</button>
      {enabled && <button type="button" className="secondary-button" disabled={busy} onClick={test}><Send size={16} /> Send test</button>}
    </div>
    {!supported && <p className="muted">This browser cannot receive push notifications here. On iPhone or iPad, add SquadSlot to the Home Screen and open it there.</p>}
    {config && !config.configured && <p className="muted">An administrator needs to set the public HTTPS App URL before notifications can be enabled.</p>}
    {message && <p className="muted" role="status">{message}</p>}
  </section>;
}
