import { createContext, useContext, useEffect, useState } from "react";
import { Sparkles, Trophy } from "lucide-react";
import { Avatar, SteamImage } from "../../components/PlayerMedia.jsx";
import "./motion-effects.css";

const MotionContext = createContext({ mode: "full", effective: "full", setMode: () => {} });
export function useMotion() { return useContext(MotionContext); }

export function MotionProvider({ children }) {
  const [mode, setMode] = useState(() => {
    try { const saved = window.localStorage.getItem("squadslot-motion"); return ["full", "subtle", "off"].includes(saved) ? saved : "full"; }
    catch { return "full"; }
  });
  const [reduced, setReduced] = useState(() => window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  const effective = reduced ? "off" : mode;
  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const change = () => setReduced(media.matches);
    media.addEventListener("change", change);
    return () => media.removeEventListener("change", change);
  }, []);
  useEffect(() => {
    document.documentElement.dataset.motion = effective;
    try { window.localStorage.setItem("squadslot-motion", mode); } catch { /* Private browsing can block persistence. */ }
    if (effective === "off") document.getAnimations().forEach(animation => animation.cancel());
  }, [effective, mode]);
  return <MotionContext.Provider value={{ mode, effective, setMode }}>{children}</MotionContext.Provider>;
}

export function MotionSettings() {
  const { mode, effective, setMode } = useMotion();
  return <fieldset className="motion-settings"><legend>Motion on this device</legend>
    <div className="segmented-control" role="group" aria-label="Motion intensity">
      {["full", "subtle", "off"].map(value => <button key={value} type="button" aria-pressed={mode === value} className={mode === value ? "active" : ""} onClick={() => setMode(value)}>{value[0].toUpperCase() + value.slice(1)}</button>)}
    </div>
    {effective === "off" && mode !== "off" && <small role="status">Device preference: reduced motion</small>}
  </fieldset>;
}

export function ReadyCelebration({ players = [] }) {
  return <div className="squad-celebration" role="status">
    <div className="squad-confetti" aria-hidden="true">{Array.from({ length: 16 }, (_, index) => <i key={index} style={{ "--piece": index, "--flight-x": `${(index % 2 ? 1 : -1) * (28 + index * 9)}px`, "--flight-y": `${-32 - (index % 5) * 14}px`, "--turn": `${index * 41}deg` }} />)}</div>
    <Sparkles size={22} /><strong>Squad ready</strong>
    <div className="ready-players">{players.slice(0, 6).map((player, index) => <span key={player.userId || player.id} style={{ "--arrival": index }}><Avatar user={player} size="small" /></span>)}</div>
  </div>;
}

export function WinnerReveal({ choice }) {
  if (!choice) return null;
  return <div className="winner-reveal" role="status">
    <SteamImage appId={choice.steamAppId} src={choice.imageUrl} alt={choice.title} />
    <div><span><Trophy size={16} /> Selected game</span><strong>{choice.title}</strong></div>
  </div>;
}
