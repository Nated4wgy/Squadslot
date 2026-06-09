import { db, getSetting, setSetting } from "./db.js";

export const notificationDefinitions = [
  {
    type: "gameSuggested",
    label: "Game suggestions",
    description: "Post when someone suggests a Steam game.",
    variables: ["actor", "title", "steamUrl"],
    enabledDefault: true,
    titleDefault: "New game suggestion",
    messageDefault: "{actor} suggested **{title}**."
  },
  {
    type: "availabilityAdded",
    label: "Free time added",
    description: "Post when someone logs new free time.",
    variables: ["actor", "date", "startTime", "endTime", "note"],
    enabledDefault: true,
    titleDefault: "Availability added",
    messageDefault: "{actor} is free on **{date}** from {startTime} to {endTime}."
  },
  {
    type: "availabilityRemoved",
    label: "Free time removed",
    description: "Post when a free time entry is deleted.",
    variables: ["actor", "player", "date", "startTime", "endTime"],
    enabledDefault: true,
    titleDefault: "Availability removed",
    messageDefault: "{actor} removed {player}'s free time on **{date}**."
  },
  {
    type: "sessionCreated",
    label: "Session invites",
    description: "Post when a new game session is created.",
    variables: ["actor", "title", "game", "date", "startTime", "endTime", "invited", "steamUrl"],
    enabledDefault: true,
    titleDefault: "New session invite",
    messageDefault: "{actor} created **{title}** for {date} from {startTime} to {endTime}."
  },
  {
    type: "sessionRemoved",
    label: "Session removed",
    description: "Post when a planned session is deleted.",
    variables: ["actor", "title", "game", "date", "startTime", "endTime"],
    enabledDefault: true,
    titleDefault: "Session removed",
    messageDefault: "{actor} removed **{title}**."
  },
  {
    type: "inviteResponse",
    label: "Invite responses",
    description: "Post when someone accepts, declines, marks an invite tentative, or leaves an event.",
    variables: ["actor", "status", "title", "game", "date", "startTime", "endTime", "owner"],
    enabledDefault: true,
    titleDefault: "Invite response",
    messageDefault: "{actor} marked **{title}** as {status}."
  },
  {
    type: "sessionReady",
    label: "Session ready",
    description: "Post once an event reaches its minimum player count.",
    variables: ["title", "game", "accepted", "minimum", "date", "startTime"],
    enabledDefault: true,
    titleDefault: "Session ready",
    messageDefault: "**{title}** has {accepted}/{minimum} players and is ready to go."
  },
  {
    type: "eventTomorrow",
    label: "Event tomorrow",
    description: "Send a reminder roughly 24 hours before an event.",
    variables: ["title", "game", "date", "startTime", "endTime", "owner"],
    enabledDefault: true,
    titleDefault: "Gaming tomorrow",
    messageDefault: "**{title}** starts tomorrow at {startTime}."
  },
  {
    type: "eventStartingSoon",
    label: "Event starting soon",
    description: "Send a reminder roughly one hour before an event.",
    variables: ["title", "game", "date", "startTime", "endTime", "owner"],
    enabledDefault: true,
    titleDefault: "Starting in one hour",
    messageDefault: "**{title}** starts at {startTime}. Get ready."
  },
  {
    type: "rsvpDeadline",
    label: "RSVP deadline",
    description: "Post when an event RSVP deadline is reached.",
    variables: ["title", "game", "date", "startTime", "endTime", "owner"],
    enabledDefault: true,
    titleDefault: "RSVP deadline",
    messageDefault: "The response deadline for **{title}** is now."
  },
  {
    type: "weeklySummary",
    label: "Weekly availability summary",
    description: "Post the strongest availability overlaps once each week.",
    variables: ["startDate", "endDate", "summary"],
    enabledDefault: true,
    titleDefault: "This week's best gaming slots",
    messageDefault: "Availability from {startDate} to {endDate}:\n{summary}"
  }
];

const definitionsByType = new Map(notificationDefinitions.map((definition) => [definition.type, definition]));

function settingKey(type, name) {
  return `notification.${type}.${name}`;
}

function boolSetting(type, fallback) {
  return getSetting(settingKey(type, "enabled"), fallback ? "true" : "false") !== "false";
}

function cleanSettingText(value, fallback = "") {
  return String(value ?? fallback).trim();
}

function renderTemplate(template, variables = {}) {
  return template.replace(/\{([a-zA-Z0-9_]+)\}/g, (_match, key) => {
    const value = variables[key];
    return value === undefined || value === null || value === "" ? "" : String(value);
  });
}

export function getNotificationSettings() {
  return notificationDefinitions.map((definition) => ({
    type: definition.type,
    label: definition.label,
    description: definition.description,
    variables: definition.variables,
    enabled: boolSetting(definition.type, definition.enabledDefault),
    title: getSetting(settingKey(definition.type, "title"), definition.titleDefault),
    message: getSetting(settingKey(definition.type, "message"), definition.messageDefault)
  }));
}

export function saveNotificationSettings(notifications) {
  if (!Array.isArray(notifications)) throw new Error("Notification settings must be an array.");

  const normalized = notifications.map((item) => {
    const type = cleanSettingText(item?.type);
    const definition = definitionsByType.get(type);
    if (!definition) throw new Error("Notification settings contain an unknown type.");

    const title = cleanSettingText(item.title, definition.titleDefault);
    const message = cleanSettingText(item.message, definition.messageDefault);
    if (!title || title.length > 120) throw new Error(`${definition.label} title must be 1-120 characters.`);
    if (!message || message.length > 1200) throw new Error(`${definition.label} message must be 1-1200 characters.`);

    return {
      type,
      enabled: Boolean(item.enabled),
      title,
      message
    };
  });

  const save = db.transaction(() => {
    for (const item of normalized) {
      setSetting(settingKey(item.type, "enabled"), item.enabled ? "true" : "false");
      setSetting(settingKey(item.type, "title"), item.title);
      setSetting(settingKey(item.type, "message"), item.message);
    }
  });
  save();
}

export function buildDiscordNotification(type, variables, options = {}) {
  const definition = definitionsByType.get(type);
  if (!definition) throw new Error("Unknown Discord notification type.");
  if (!boolSetting(type, definition.enabledDefault)) return null;

  const titleTemplate = getSetting(settingKey(type, "title"), definition.titleDefault);
  const messageTemplate = getSetting(settingKey(type, "message"), definition.messageDefault);

  return {
    ...options,
    title: renderTemplate(titleTemplate, variables),
    description: renderTemplate(messageTemplate, variables)
  };
}
