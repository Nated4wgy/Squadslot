import { useEffect, useState } from "react";
import { api } from "../../lib/api.js";

export function useAvailabilityRange(start, end, refreshKey) {
  const [items, setItems] = useState([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const controller = new window.AbortController();
    setLoading(true); setError(""); setItems([]);
    api(`/api/availability?start=${start}&end=${end}`, { signal: controller.signal })
      .then(payload => { if (!controller.signal.aborted) setItems(payload.availability); })
      .catch(failure => { if (!controller.signal.aborted) setError(failure.message); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [start, end, refreshKey, revision]);
  return { items, error, loading, reload: () => setRevision(value => value + 1) };
}
