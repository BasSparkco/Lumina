export interface ScheduleRule {
  id: string;
  priority: number;
  startTime: string | null;
  endTime: string | null;
  daysOfWeek: number[];
  startDate: string | null;
  endDate: string | null;
  playlistId: string;
}

/** Returns the playlistId that matches right now, or null if no rule applies. */
export function resolveSchedule(rules: ScheduleRule[], now: Date): string | null {
  const day = now.getDay();
  const hhmm = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;

  const matching = rules.filter(r => {
    if (r.startDate && now < new Date(r.startDate)) return false;
    if (r.endDate && now > new Date(r.endDate)) return false;
    if (r.daysOfWeek.length > 0 && !r.daysOfWeek.includes(day)) return false;

    if (r.startTime && r.endTime) {
      if (r.startTime <= r.endTime) {
        if (hhmm < r.startTime || hhmm >= r.endTime) return false;
      } else {
        // Crosses midnight (e.g. 22:00–06:00)
        if (hhmm < r.startTime && hhmm >= r.endTime) return false;
      }
    }
    return true;
  });

  matching.sort((a, b) => b.priority - a.priority);
  return matching[0]?.playlistId ?? null;
}

/** Returns ms until the next schedule transition (max 60s to keep it responsive). */
export function msUntilNextTransition(rules: ScheduleRule[], now: Date): number {
  const nextMinute = new Date(now);
  nextMinute.setSeconds(0, 0);
  nextMinute.setMinutes(nextMinute.getMinutes() + 1);
  return Math.max(1000, nextMinute.getTime() - now.getTime());
}
