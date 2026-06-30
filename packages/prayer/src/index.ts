import {
  Coordinates,
  CalculationMethod,
  PrayerTimes,
  Prayer,
  Qibla,
  SunnahTimes,
} from 'adhan';

export type PrayerMethod =
  | 'MuslimWorldLeague'
  | 'Egyptian'
  | 'Karachi'
  | 'UmmAlQura'
  | 'Dubai'
  | 'MoonsightingCommittee'
  | 'NorthAmerica'
  | 'Kuwait'
  | 'Qatar'
  | 'Singapore'
  | 'Tehran'
  | 'Turkey';

export interface PrayerTimesConfig {
  latitude: number;
  longitude: number;
  method: PrayerMethod;
  date?: Date;
}

export interface DailyPrayerTimes {
  fajr: Date;
  sunrise: Date;
  dhuhr: Date;
  asr: Date;
  maghrib: Date;
  isha: Date;
  midnight: Date;
  lastThirdOfNight: Date;
  qiblaDirection: number;
}

export function getDailyPrayerTimes(config: PrayerTimesConfig): DailyPrayerTimes {
  const coords = new Coordinates(config.latitude, config.longitude);
  const params = CalculationMethod[config.method]();
  const date = config.date ?? new Date();
  const times = new PrayerTimes(coords, date, params);
  const sunnah = new SunnahTimes(times);

  return {
    fajr: times.fajr,
    sunrise: times.sunrise,
    dhuhr: times.dhuhr,
    asr: times.asr,
    maghrib: times.maghrib,
    isha: times.isha,
    midnight: sunnah.middleOfTheNight,
    lastThirdOfNight: sunnah.lastThirdOfTheNight,
    qiblaDirection: Qibla(coords),
  };
}

export function getNextPrayer(config: PrayerTimesConfig): { name: string; time: Date } | null {
  const coords = new Coordinates(config.latitude, config.longitude);
  const params = CalculationMethod[config.method]();
  const times = new PrayerTimes(coords, config.date ?? new Date(), params);
  const next = times.nextPrayer();
  if (next === Prayer.None) return null;
  const time = times.timeForPrayer(next);
  if (!time) return null;
  return { name: next, time };
}

export { Prayer, Coordinates, CalculationMethod };
