import { useEffect, useRef, useState } from "react";
import { CalendarDays, Check, Clock, Repeat, Sparkles, UsersRound } from "lucide-react";
import { Avatar, EventGameImage } from "../../components/PlayerMedia.jsx";
import { addTime, calendarStartHour, calendarEndHour, calendarPlacement, eventDurationHours, formatDate, formatDay, localDate, timeMinutes } from "../../lib/dates.js";
import { availabilityDate } from "../availability/labels.js";
import { availabilityBlocksForDay, eventLanes, minutesLabel } from "./calendar-logic.js";
import styles from "./calendar.module.css";

export function CalendarGrid({ user, days, availability, events, bestSlots, onAvailabilityDraft, onReschedule, onOpenEvents, personal = false, onEditAvailability }) {
  const scheduling = useSchedulingTime();
  const [drag, setDrag] = useState(null);
  const dragRef = useRef(null);
  const draggedEventRef = useRef(null);
  const [selection, setSelection] = useState(null);
  const [dropError, setDropError] = useState("");
  const visibleDates = new Set(days.map(localDate));
  const slots = bestSlots.filter(slot => visibleDates.has(slot.date));
  const maxOverlap = Math.max(1, ...slots.map(slot => slot.count));
  const startHour = personal ? Math.min(calendarStartHour, ...availability.map(item => Math.floor(timeMinutes(item.startTime) / 60))) : calendarStartHour;
  const hourCount = calendarEndHour - startHour;
  const hours = Array.from({ length: hourCount }, (_, i) => minutesLabel((startHour + i) * 60));
  const placement = (start, end) => calendarPlacement(start, end, startHour);

  // Pointer movement can outpace React rendering, especially in WebKit.
  function updateDrag(value) {
    dragRef.current = value;
    setDrag(value);
  }

  function finishDrag() {
    const drag = dragRef.current;
    if (!drag) return;
    const first = Math.min(drag.startDay, drag.endDay);
    const last = Math.max(drag.startDay, drag.endDay);
    const selectedDays = days.slice(first, last + 1);
    const start = Math.min(drag.startHour, drag.endHour);
    const end = Math.max(drag.startHour, drag.endHour);
    onAvailabilityDraft({
      mode: selectedDays.length > 1 ? "weekly" : "once",
      date: localDate(selectedDays[0]), dates: selectedDays.map(localDate),
      weekdays: [...new Set(selectedDays.map(day => day.getDay()))],
      startDate: localDate(selectedDays[0]), startTime: minutesLabel(start * 60),
      endTime: end >= 23 ? "23:59" : minutesLabel((end + 1) * 60)
    });
    updateDrag(null);
  }
  useEffect(() => {
    window.addEventListener("mouseup", finishDrag);
    const cancel = () => updateDrag(null);
    window.addEventListener("blur", cancel);
    return () => { window.removeEventListener("mouseup", finishDrag); window.removeEventListener("blur", cancel); };
  });

  const selectedEvent = selection?.kind === "event" ? events.find(event => event.id === selection.id && visibleDates.has(event.date)) : null;
  const selectedBlock = selection?.kind === "free" && visibleDates.has(selection.date)
    ? availabilityBlocksForDay(selection.date, availability, events, bestSlots).find(block => block.start === selection.start) : null;
  const selectedSlot = selection?.kind === "slot" ? slots.find(slot => slot.date === selection.date && slot.startTime === selection.startTime) : null;
  const accepted = selectedEvent?.invites.filter(invite => invite.status === "accepted") || [];
  const people = selectedBlock?.freeItems || selectedSlot?.players || [];
  const best = slots[0];

  return (
    <section className={styles.board} aria-label="Shared calendar">
      {dropError && <p className="form-error" role="alert">{dropError}</p>}
      {!personal && <div className={styles.bestSlots}>
        <div className={styles.bestHeading}><Sparkles size={18} /><div><strong>Best slots this week</strong><small>{best ? `${formatDate(best.date, { weekday: "long" })} is your best bet` : "No shared availability yet"}</small></div></div>
        <div className={styles.bestOptions}>
          {slots.slice(0, 3).map(slot => <button type="button" key={`${slot.date}-${slot.startTime}`} onClick={() => setSelection({ kind: "slot", date: slot.date, startTime: slot.startTime })}>
            <span>{formatDate(slot.date)} {slot.startTime}</span><strong>{slot.count} free</strong>
          </button>)}
        </div>
      </div>}
      <div className={`${styles.scroll} pulse-calendar-scroll`} style={{ "--day-count": days.length }}>
        <div className={styles.weekHead}>
          <span />
          {days.map(day => <div key={localDate(day)} className={localDate(day) === scheduling.date ? styles.today : ""}>
            <span>{new Intl.DateTimeFormat("en-GB", { weekday: "short" }).format(day)}</span><strong>{new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short" }).format(day)}</strong>
          </div>)}
        </div>
        <div className={styles.gridBody} style={{ height: Math.max(560, hourCount * 60) }}>
          <div className={styles.timeAxis}>{Array.from({ length: hourCount + 1 }, (_, index) => <span key={index} style={{ top: `${index / hourCount * 100}%` }}>{minutesLabel((startHour + index) * 60)}</span>)}</div>
          <div className={styles.days}>
            {days.map((day, dayIndex) => {
              const date = localDate(day);
              const dayEvents = events.filter(event => event.date === date && timeMinutes(event.endTime) > calendarStartHour * 60 && timeMinutes(event.startTime) < calendarEndHour * 60);
              const blocks = personal ? [] : availabilityBlocksForDay(date, availability, events, bestSlots);
              const personalLanes = eventLanes(availability.filter(item => item.date === date));
              const lanes = eventLanes(dayEvents);
              const freeLane = blocks.some(block => dayEvents.some(event => timeMinutes(event.startTime) < block.end && timeMinutes(event.endTime) > block.start)) ? 1 : 0;
              const columns = lanes.count + freeLane;
              return <div className={styles.day} key={date} onMouseMove={event => {
                const current = dragRef.current;
                if (!current) return;
                const rect = event.currentTarget.getBoundingClientRect();
                const hour = Math.min(23, Math.max(startHour, startHour + Math.floor((event.clientY - rect.top) / rect.height * hourCount)));
                if (current.endDay !== dayIndex || current.endHour !== hour) updateDrag({ ...current, endDay: dayIndex, endHour: hour });
              }}>
                <div className={styles.hourSlots} style={{ gridTemplateRows: `repeat(${hourCount}, minmax(0, 1fr))` }}>{hours.map(hour => {
                  const hourNumber = Number(hour.slice(0, 2));
                  const selected = drag && dayIndex >= Math.min(drag.startDay, drag.endDay) && dayIndex <= Math.max(drag.startDay, drag.endDay)
                    && hourNumber >= Math.min(drag.startHour, drag.endHour) && hourNumber <= Math.max(drag.startHour, drag.endHour);
                  return <button type="button" className={`${styles.hourSlot} ${selected ? styles.selecting : ""}`} key={hour}
                    data-calendar-slot data-date={date} data-hour={hour}
                    aria-label={`Add free time on ${formatDay(day)} at ${hour}`}
                    onMouseDown={event => { if (event.button !== 0) return; event.preventDefault(); updateDrag({ startDay: dayIndex, endDay: dayIndex, startHour: hourNumber, endHour: hourNumber }); }}
                    onClick={event => { if (event.detail === 0) onAvailabilityDraft({ mode: "once", date, startTime: hour, endTime: addTime(hour, 1) }); }}
                    onDragOver={event => event.preventDefault()} onDrop={event => {
                      event.preventDefault();
                      const draggedEvent = draggedEventRef.current;
                      if (!draggedEvent) return;
                      const { id, duration } = draggedEvent;
                      setDropError("");
                      if (timeMinutes(hour) + Math.round(duration * 60) > 1439) {
                        setDropError("Choose an earlier start so the full session ends before midnight.");
                        return;
                      }
                      if (id) onReschedule(id, date, hour, addTime(hour, duration));
                    }} />;
                })}</div>
                <div className={styles.blockLayer}>
                  {personal && personalLanes.entries.map(({event: item, lane}) => <button key={item.id} type="button" data-personal-availability data-availability-id={item.id}
                    className={`${styles.freeBlock} ${timeMinutes(item.endTime) - timeMinutes(item.startTime) < 60 ? styles.short : ""}`}
                    style={{ ...placement(item.startTime, item.endTime), "--lane": lane, "--lanes": personalLanes.count, "--intensity": "20%" }}
                    aria-label={`Edit free time on ${availabilityDate(item.date)}, ${item.startTime} to ${item.endTime}`} onClick={event => { event.currentTarget.focus(); onEditAvailability([item]); }}>
                    <span className={styles.blockContent}><strong>{item.startTime}-{item.endTime}</strong><small>{formatDate(item.date)}</small><span>{item.recurring ? <Repeat size={14} /> : null} {item.note || "Free time"}</span></span>
                  </button>)}
                  {blocks.map(block => {
                    const hasEvent = dayEvents.some(event => timeMinutes(event.startTime) < block.end && timeMinutes(event.endTime) > block.start);
                    const detail = { kind: "free", date, start: block.start };
                    return <button type="button" data-availability-block key={block.start}
                      className={`${styles.freeBlock} ${block.isBest ? styles.best : ""} ${block.end - block.start < 60 ? styles.short : ""}`}
                      style={{ ...placement(minutesLabel(block.start), minutesLabel(block.end)), "--lane": 0, "--lanes": hasEvent ? columns : 1, "--intensity": `${12 + Math.min(1, block.freeItems.length / maxOverlap) * 12}%` }}
                      aria-label={`${block.freeItems.length} free on ${formatDay(day)}, ${minutesLabel(block.start)} to ${minutesLabel(block.end)}: ${block.freeItems.map(player => player.displayName).join(", ")}`}
                      onClick={event => {
                        event.currentTarget.focus();
                        setSelection(detail);
                        onEditAvailability(availability.filter(item => item.date === date && block.playerIds.includes(item.userId) && timeMinutes(item.startTime) < block.end && timeMinutes(item.endTime) > block.start));
                      }} onFocus={() => setSelection(detail)} onMouseEnter={() => { if (!drag) setSelection(detail); }}>
                      <span className={styles.blockContent}><strong>{block.freeItems.length} free {block.isBest && <Sparkles size={12} />}</strong><small>{minutesLabel(block.start)}-{minutesLabel(block.end)}</small>
                        <span className={styles.playerNames}>{block.freeItems.map(player => player.displayName).join(", ")}</span>
                        <span className={styles.avatars}>{block.freeItems.slice(0, 3).map(player => <Avatar user={player} size="tiny" key={player.userId} />)}{block.freeItems.length > 3 && <small>+{block.freeItems.length - 3}</small>}</span>
                      </span>
                    </button>;
                  })}
                  {lanes.entries.map(({ event, lane }) => {
                    const guests = event.invites.filter(invite => invite.status === "accepted");
                    const detail = { kind: "event", id: event.id };
                    return <button type="button" data-event-block data-event-id={event.id} key={event.id}
                      className={`${styles.eventBlock} ${timeMinutes(event.endTime) - timeMinutes(event.startTime) < 60 ? styles.short : ""}`}
                      style={{ ...placement(event.startTime, event.endTime), "--lane": lane + freeLane, "--lanes": columns }}
                      aria-label={`${event.title}, ${event.startTime} to ${event.endTime}, ${guests.length} accepted`}
                      draggable={event.ownerId === user.id || user.role === "admin"}
                      onDragStart={dragEvent => {
                        draggedEventRef.current = { id: event.id, duration: eventDurationHours(event) };
                        dragEvent.dataTransfer.effectAllowed = "move";
                        dragEvent.dataTransfer.setData("text/plain", String(event.id));
                      }}
                      onDragEnd={() => { draggedEventRef.current = null; }}
                      onClick={() => setSelection(detail)} onFocus={() => setSelection(detail)} onMouseEnter={() => { if (!drag) setSelection(detail); }}>
                      <span className={styles.blockContent}><strong>{event.title}</strong><small>{event.startTime}-{event.endTime}</small>
                        <span className={styles.eventGame}>{event.gameTitle || "Game TBD"}</span>
                        <span className={styles.accepted}><UsersRound size={12} />{guests.length}/{event.maxPlayers}{event.ready && <Check size={13} />}</span>
                        <span className={styles.avatars}>{guests.slice(0, 3).map(guest => <Avatar user={guest} size="tiny" key={guest.userId} />)}</span>
                      </span>
                    </button>;
                  })}
                </div>
              </div>;
            })}
          </div>
        </div>
      </div>
      <div className={styles.legend}><span><i /> Free time</span>{!personal && <><span><i /> Planned session</span><span><Sparkles size={13} /> Best overlap</span></>}</div>
      {!personal && <div className={styles.inspector} aria-label="Calendar details" aria-live="polite">
        {selectedEvent ? <>
          <EventGameImage event={selectedEvent} />
          <div className={styles.detailCopy}><strong>{selectedEvent.title}</strong><span>{selectedEvent.gameTitle || "Game TBD"} · {formatDate(selectedEvent.date)} · {selectedEvent.startTime}-{selectedEvent.endTime}</span><span>{accepted.length}/{selectedEvent.maxPlayers} accepted: {accepted.map(guest => guest.displayName).join(", ") || "No one yet"}</span></div>
          <button type="button" className="secondary-button" onClick={onOpenEvents}><CalendarDays size={16} /> Events</button>
        </> : selectedBlock || selectedSlot ? <>
          <UsersRound size={20} />
          <div className={styles.detailCopy}><strong>{formatDate(selection.date)} · {selectedBlock ? `${minutesLabel(selectedBlock.start)}-${minutesLabel(selectedBlock.end)}` : `${selectedSlot.startTime}-${selectedSlot.endTime}`}</strong><span>{people.map(player => player.displayName).join(", ")}</span></div>
          <button type="button" className="secondary-button" onClick={() => onAvailabilityDraft({ mode: "once", date: selection.date, startTime: selectedBlock ? minutesLabel(selectedBlock.start) : selectedSlot.startTime, endTime: selectedBlock ? minutesLabel(Math.min(selectedBlock.end, 1439)) : selectedSlot.endTime })}><Clock size={16} /> Add free time</button>
        </> : <><CalendarDays size={20} /><div className={styles.detailCopy}><strong>{events.filter(event => visibleDates.has(event.date)).length} sessions this week</strong><span>{best ? `Best overlap: ${formatDate(best.date)}, ${best.startTime}-${best.endTime}, ${best.count} players` : "No shared slots yet"}</span></div></>}
      </div>}
    </section>
  );
}

import { useSchedulingTime } from "../../lib/scheduling-time.jsx";
