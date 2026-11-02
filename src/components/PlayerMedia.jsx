import { useState } from "react";
import { Gamepad2 } from "lucide-react";
import { eventArtwork, gameImageSources } from "../game-art.js";

export function Avatar({ user, size = "medium" }) {
  const name = user.displayName || user.ownerName || "?";
  if (user.avatarUrl || user.ownerAvatarUrl) {
    return <img className={`avatar avatar-${size}`} src={user.avatarUrl || user.ownerAvatarUrl} alt="" />;
  }
  return (
    <span className={`avatar avatar-${size} avatar-initials`} style={{ "--avatar-color": user.profileColor || user.ownerColor || "#2fd3ba" }}>
      {name.slice(0, 2).toUpperCase()}
    </span>
  );
}

export function Skeleton({ rows = 3 }) {
  return (
    <div className="skeleton-list" aria-label="Loading">
      {Array.from({ length: rows }, (_, index) => <span className="skeleton-row" key={index} />)}
    </div>
  );
}

export function SteamImage({ src, appId, alt = "", className = "" }) {
  const sources = gameImageSources(src, appId);
  return <SteamImageAttempt key={JSON.stringify(sources)} sources={sources} alt={alt} className={className} />;
}

export function SteamImageAttempt({ sources, alt, className }) {
  const [attempt, setAttempt] = useState(0);
  if (attempt >= sources.length) {
    return <span className={`image-fallback ${className}`.trim()}><Gamepad2 size={18} /></span>;
  }
  return <img className={className} src={sources[attempt]} alt={alt} loading="lazy" decoding="async" onError={() => setAttempt((current) => current + 1)} />;
}

export function EventGameImage({ event, className = "event-game-image" }) {
  return <SteamImage {...eventArtwork(event)} className={className} />;
}

