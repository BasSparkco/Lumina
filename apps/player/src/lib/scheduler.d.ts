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
export declare function resolveSchedule(rules: ScheduleRule[], now: Date): string | null;
/** Returns ms until the next schedule transition (max 60s to keep it responsive). */
export declare function msUntilNextTransition(rules: ScheduleRule[], now: Date): number;
//# sourceMappingURL=scheduler.d.ts.map