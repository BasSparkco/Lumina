import { useEffect, useState } from 'react';

// Self-ticking "current time" state shared by TimeWidget/DateWidget — each just needs a
// different refresh cadence (TimeWidget re-renders every second so seconds/minutes visibly
// move; DateWidget only needs to notice a day rollover, so a coarse 60s tick is enough) and then
// formats it with its own Intl options, which is where the two widgets genuinely diverge.
export function useNow(intervalMs: number): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}
