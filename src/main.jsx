import { FriendsView } from "./features/friends/FriendsView.jsx";
import { InvitesView, EventsView } from "./features/events/EventsView.jsx";
import { GroupsView } from "./features/groups/GroupsView.jsx";
import { ProposalsView } from "./features/proposals/ProposalsView.jsx";
import { GamesView } from "./features/games/GamesView.jsx";
import { DashboardView, TonightView } from "./features/dashboard/TonightView.jsx";
import { ProfileView } from "./features/profile/ProfileView.jsx";
import { useCallback, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { Clock } from "lucide-react";
import "./styles.css";
import "./theme.css";
import "./motion.css";

import { FreeTimeView } from "./features/availability/Availability.jsx";
import { CalendarView } from "./features/calendar/CalendarView.jsx";
import { eventHasEnded } from "./event-time.js";
import { api } from "./lib/api.js";
import { AuthScreen, PasswordChangeScreen } from "./features/auth/AuthScreens.jsx";
import AdminView from "./features/admin/AdminView.jsx";
import AppShell from "./components/AppShell.jsx";
import { SchedulingTimezone, schedulingClock } from "./lib/scheduling-time.jsx";
import { disableDevicePush } from "./PushPreferences.jsx";
import { startOfWeek } from "./lib/dates.js";

function App() {
  const [user, setUser] = useState(null);
  const [activeView, setActiveView] = useState(() => new URL(window.location.href).searchParams.get("view") === "events" ? "events" : "dashboard");
  const [loading, setLoading] = useState(true);
  const [dataLoading, setDataLoading] = useState(false);
  const [weekOffset, setWeekOffset] = useState(0);
  const [calendarMode, setCalendarMode] = useState("squad");
  const [sessionDraft, setSessionDraft] = useState(null);
  const [clock, setClock] = useState(() => new Date());
  const [data, setData] = useState({ availability: [], events: [], games: [], friends: [], groups: [], dashboard: null });
  const squadTimezone = data.groups.find(group => group.id === user?.activeGroupId)?.timezone || "Europe/London";
  const squadDate = schedulingClock(squadTimezone, clock).date;
  const searchRequestId = useRef(0);
  const refreshRequestId = useRef(0);

  const clearAccountData = useCallback(() => {
    searchRequestId.current += 1;
    refreshRequestId.current += 1;
    setData({ availability: [], events: [], games: [], friends: [], groups: [], dashboard: null });
    setDataLoading(false);
    setUser(null);
    setCalendarMode("squad");
    setSessionDraft(null);
  }, []);

  const searchGames = useCallback(async (query = "co-op") => {
    const requestId = ++searchRequestId.current;
    try {
      const payload = await api(`/api/games?q=${encodeURIComponent(query)}`);
      if (requestId !== searchRequestId.current) return;
      setData((current) => ({ ...current, games: payload.games }));
    } catch {
      if (requestId !== searchRequestId.current) return;
      setData((current) => ({ ...current, games: [] }));
    }
  }, []);

  const refresh = useCallback(async (background = false) => {
    const requestId = ++refreshRequestId.current;
    if (!background) setDataLoading(true);
    try {
      const [availability, events, friends, groups, dashboard] = await Promise.all([
        api("/api/availability"),
        api("/api/events"),
        api("/api/friends"),
        api("/api/groups"),
        api("/api/dashboard")
      ]);
      if (requestId !== refreshRequestId.current) return;
      setData((current) => ({
        ...current,
        availability: availability.availability,
        events: events.events,
        friends: friends.users,
        groups: groups.groups,
        dashboard: dashboard.dashboard
      }));
    } catch {
      // Keep the signed-in shell usable if a secondary data request fails.
    } finally {
      if (requestId === refreshRequestId.current) setDataLoading(false);
    }
  }, []);

  useEffect(() => {
    api("/api/me")
      .then((payload) => setUser(payload.user))
      .catch(() => setUser(null))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    window.addEventListener("squadslot:session-expired", clearAccountData);
    return () => window.removeEventListener("squadslot:session-expired", clearAccountData);
  }, [clearAccountData]);

  useEffect(() => {
    if (user && !user.mustChangePassword) {
      refresh();
      searchGames();
    }
  }, [user, refresh, searchGames, squadDate]);

  useEffect(() => {
    const timer = window.setInterval(() => setClock(new Date()), 30 * 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!user || user.mustChangePassword) return;
    const update = () => { if (document.visibilityState === "visible") refresh(true); };
    const timer = window.setInterval(update, 15000);
    window.addEventListener("focus", update);
    document.addEventListener("visibilitychange", update);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", update);
      document.removeEventListener("visibilitychange", update);
    };
  }, [user, refresh]);

  useEffect(() => {
    if (!user) return;
    const preferredTheme = user.theme === "system"
      ? (window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark")
      : user.theme;
    document.documentElement.dataset.theme = preferredTheme || "dark";
    document.documentElement.style.setProperty("--accent", user.accent || "#6bc9ed");
  }, [user]);

  async function logout() {
    await disableDevicePush(api).catch(() => {});
    await api("/api/auth/logout", { method: "POST" });
    clearAccountData();
  }

  async function refreshContext() {
    setSessionDraft(null);
    const payload = await api("/api/me");
    setUser(payload.user);
    await refresh();
  }

  function planSession(draft) {
    const chosenWeek = startOfWeek(new Date(`${draft.date}T12:00:00`));
    const currentWeek = startOfWeek(new Date(`${squadDate}T12:00:00`));
    setWeekOffset(Math.round((chosenWeek - currentWeek) / (7 * 86400000)));
    setSessionDraft(draft); setCalendarMode("squad"); setActiveView("calendar");
  }

  if (loading) return <main className="loading"><Clock /> Loading</main>;
  if (!user) return <AuthScreen onSignedIn={setUser} />;
  if (user.mustChangePassword) return <PasswordChangeScreen user={user} onChanged={setUser} onLogout={logout} />;

  const visibleEvents = data.events.filter((event) => !eventHasEnded(event, clock));
  const visibleData = { ...data, events: visibleEvents };
  const visibleDashboardInvites = data.dashboard?.pendingInvites.filter((event) => !eventHasEnded(event, clock)) || [];
  const visibleDashboard = data.dashboard
    ? {
        ...data.dashboard,
        nextEvent: data.dashboard.nextEvent && !eventHasEnded(data.dashboard.nextEvent, clock)
          ? data.dashboard.nextEvent
          : null,
        pendingInvites: visibleDashboardInvites,
        pendingInviteCount: visibleEvents.filter((event) => event.invites.some((invite) => invite.userId === user.id && invite.status === "invited")).length,
        tonight: {
          ...data.dashboard.tonight,
          events: data.dashboard.tonight.events.filter((event) => !eventHasEnded(event, clock))
        }
      }
    : null;

  const pendingInviteCount = visibleEvents.filter((event) =>
    event.invites.some((invite) => invite.userId === user.id && invite.status === "invited")
  ).length;

  return (
    <SchedulingTimezone.Provider value={squadTimezone}>
    <AppShell user={user} timezone={squadTimezone} groupName={data.groups.find(group => group.id === user.activeGroupId)?.name} activeView={activeView} setActiveView={setActiveView} pendingInviteCount={pendingInviteCount} onLogout={logout}>
        {activeView === "dashboard" && <DashboardView dashboard={visibleDashboard} setActiveView={setActiveView} />}
        {activeView === "calendar" && (
          <CalendarView
            key={user.activeGroupId}
            sessionDraft={sessionDraft}
            onDraftUsed={() => setSessionDraft(null)}
            mode={calendarMode}
            setMode={setCalendarMode}
            user={user}
            data={visibleData}
            weekOffset={weekOffset}
            setWeekOffset={setWeekOffset}
            refresh={refresh}
            searchGames={searchGames}
            onManageAvailability={() => setActiveView("free-time")}
            onOpenEvents={() => setActiveView("events")}
          />
        )}
        {activeView === "tonight" && <TonightView dashboard={visibleDashboard} setActiveView={setActiveView} />}
        {activeView === "events" && (
          <EventsView
            user={user}
            events={visibleEvents}
            refresh={refresh}
            onOpenSubscription={() => setActiveView("profile")}
          />
        )}
        {activeView === "proposals" && <ProposalsView user={user} friends={data.friends} />}
        {activeView === "invites" && <InvitesView user={user} events={visibleEvents} refresh={refresh} />}
        {activeView === "free-time" && <FreeTimeView key={user.activeGroupId} user={user} availability={data.availability} refresh={refresh} onOpenCalendar={() => { setCalendarMode("personal"); setActiveView("calendar"); }} />}
        {activeView === "groups" && <GroupsView user={user} groups={data.groups} onChanged={refreshContext} />}
        {activeView === "friends" && <FriendsView user={user} friends={data.friends} availability={data.availability} events={visibleEvents} onPlan={planSession} />}
        {activeView === "games" && <GamesView games={data.games} searchGames={searchGames} />}
        {activeView === "profile" && <ProfileView user={user} onSaved={setUser} />}
        {activeView === "admin" && user.role === "admin" && <AdminView user={user} />}
        {dataLoading && activeView !== "dashboard" && <div className="loading-indicator"><span /></div>}
    </AppShell>
    </SchedulingTimezone.Provider>
  );
}

createRoot(document.getElementById("root")).render(<App />);

if ("serviceWorker" in navigator && import.meta.env.PROD) {
  navigator.serviceWorker.register("/service-worker.js").catch(() => {});
}
