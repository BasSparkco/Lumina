import type { PlayerState } from '../lib/api';
import Splash from './Splash';
import PrayerZoneWidget, { type PrayerMethod } from './PrayerZoneWidget';
import WeatherWidget from './WeatherWidget';
import CurrencyWidget from './CurrencyWidget';
import TickerWidget from './TickerWidget';

export type LiveWidgetType = 'PRAYER' | 'WEATHER' | 'CURRENCY' | 'TICKER';

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
      if (!cfg.feedUrl) return <Splash text="Ticker zone: no RSS URL set" />;
      return <TickerWidget feedUrl={cfg.feedUrl as string} lang={lang} />;
    default:
      return null;
  }
}
