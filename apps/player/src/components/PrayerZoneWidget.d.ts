export type PrayerMethod = 'MuslimWorldLeague' | 'Egyptian' | 'Karachi' | 'UmmAlQura' | 'Dubai' | 'MoonsightingCommittee' | 'NorthAmerica' | 'Kuwait' | 'Qatar' | 'Singapore' | 'Tehran' | 'Turkey';
interface Props {
    latitude: number;
    longitude: number;
    method: PrayerMethod;
    athanEnabled?: boolean;
    athanUrl?: string;
    lang?: 'en' | 'ar';
}
export default function PrayerZoneWidget({ latitude, longitude, method, athanEnabled, athanUrl, lang }: Props): import("react").JSX.Element;
export {};
//# sourceMappingURL=PrayerZoneWidget.d.ts.map