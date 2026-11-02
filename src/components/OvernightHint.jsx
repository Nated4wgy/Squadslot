export function OvernightHint({ start, end }) {
  return start && end && end < start ? <small className="muted">Ends the following day</small> : null;
}
