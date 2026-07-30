import type { PlayerState } from '../lib/api';
import Splash from './Splash';
import PrayerZoneWidget, { type PrayerMethod } from './PrayerZoneWidget';
import WeatherWidget from './WeatherWidget';
import CurrencyWidget from './CurrencyWidget';
import TickerWidget from './TickerWidget';
import TimeWidget from './TimeWidget';
import DateWidget from './DateWidget';

export type LiveWidgetType = 'PRAYER' | 'WEATHER' | 'CURRENCY' | 'TICKER' | 'TIME' | 'DATE';

interface Props {
  widgetType: LiveWidgetType;
  widgetConfig: Record<string, unknown>;
  state: PlayerState;
}

// Shared by layout Zones (zoneType PRAYER/WEATHER/CURRENCY/TICKER) and theme WIDGET
// elements — one implementation of "how does a live-data widget render" for both.
export default function LiveWidget({ widgetType, widgetConfig: cfg, state }: Props) {
  const lat = (cfg.latitude as number | undefined) ?? state.latitude;
  const lon = (cfg.longitude as number | undefined) ?? state.longitude;
  const lang = (cfg.lang as 'en' | 'ar' | undefined) ?? 'en';

  switch (widgetType) {
    case 'PRAYER':
      if (lat == null || lon == null) return <Splash text="Prayer zone: no location set" />;
      return (
        <PrayerZoneWidget
          latitude={lat}
          longitude={lon}
          method={((cfg.method as string | undefined) ?? state.prayerMethod) as PrayerMethod}
          athanEnabled={(cfg.athanEnabled as boolean | undefined) ?? state.athanEnabled}
          athanUrl={(cfg.athanUrl as string | undefined)}
          lang={lang}
        />
      );
    case 'WEATHER':
      if (lat == null || lon == null) return <Splash text="Weather zone: no location set" />;
      return <WeatherWidget latitude={lat} longitude={lon} lang={lang} />;
    case 'CURRENCY':
      return (
        <CurrencyWidget
          base={(cfg.base as string | undefined) ?? 'USD'}
          currencies={cfg.currencies as string[] | undefined}
          lang={lang}
        />
      );
    case 'TICKER':
      if (!cfg.feedUrl && !cfg.staticText) return <Splash text="Ticker zone: no content source set" />;
      return (
        <TickerWidget
          feedUrl={cfg.feedUrl as string | undefined}
          staticText={cfg.staticText as string | undefined}
          direction={(cfg.direction as 'horizontal' | 'vertical' | undefined) ?? 'horizontal'}
          lang={lang}
        />
      );
    case 'TIME':
      return (
        <TimeWidget
          timezone={(cfg.timezone as string | undefined) ?? state.timezone}
          hour12={(cfg.hour12 as boolean | undefined) ?? true}
          showSeconds={!!cfg.showSeconds}
          lang={lang}
        />
      );
    case 'DATE':
      return (
        <DateWidget
          timezone={(cfg.timezone as string | undefined) ?? state.timezone}
          format={(cfg.format as 'short' | 'long' | undefined) ?? 'long'}
          lang={lang}
        />
      );
    default:
      return null;
  }
}
