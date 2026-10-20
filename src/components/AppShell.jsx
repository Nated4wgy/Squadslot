import { Bell, CalendarDays, Check, Clock, Gamepad2, LayoutDashboard, LogOut, Shield, UserRound, UsersRound, Vote, Zap } from "lucide-react";
import { Avatar } from "./PlayerMedia.jsx";
import styles from "./app-shell.module.css";

export default function AppShell({ user, groupName, timezone, activeView, setActiveView, pendingInviteCount, onLogout, children }) {
  const links = [
    ["dashboard", "Dashboard", LayoutDashboard], ["calendar", "Calendar", CalendarDays],
    ["tonight", "Tonight", Zap], ["events", "Events", Clock], ["proposals", "Proposals", Vote],
    ["free-time", "Free Time", Check], ["groups", "Squads", UsersRound],
    ["friends", "Friends", UsersRound], ["games", "Games", Gamepad2], ["profile", "Profile", UserRound],
    ...(user.role === "admin" ? [["admin", "Admin", Shield]] : [])
  ];
  return <div className={styles.shell}>
    <header className={styles.header}>
      <a className={styles.brand} href="/" aria-label="SquadSlot home"><img src="/squadslot-icon.png" alt="" /><strong>SquadSlot</strong></a>
      <div className={styles.account}>
        <button className={styles.bell} onClick={() => setActiveView("invites")} aria-label="Open invites" title="Invites"><Bell size={18} />{pendingInviteCount > 0 && <span>{pendingInviteCount}</span>}</button>
        <button className={styles.person} onClick={() => setActiveView("profile")} aria-label="Your profile"><Avatar user={user} size="small" /><span>{user.displayName}</span></button>
        <button className={styles.signOut} onClick={onLogout} aria-label="Sign out" title="Sign out"><LogOut size={17} /></button>
      </div>
    </header>
    <aside className={styles.sidebar}>
      <span className={styles.squad}>{groupName || "Your squad"}</span>
      <nav aria-label="Main navigation">{links.map(([id, label, Icon]) => <button key={id} aria-label={label} className={["groups", "profile"].includes(id) ? styles.sectionStart : ""} aria-current={activeView === id ? "page" : undefined} onClick={() => setActiveView(id)}><Icon size={17} /><span>{label}</span>{id === "events" && pendingInviteCount > 0 && <small>{pendingInviteCount}</small>}</button>)}</nav>
    </aside>
    <main className={`${styles.workspace} workspace`} data-view={activeView}><p className={styles.schedulingZone}>Squad time: {timezone}</p>{children}</main>
  </div>;
}
