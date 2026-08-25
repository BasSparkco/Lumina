import type { PrayerMethod } from '@lumina/prayer';
import type { PlayerState, Zone } from '../lib/api';
import ZonePlayer from './ZonePlayer';
import PrayerZoneWidget from './PrayerZoneWidget';
import WeatherWidget from './WeatherWidget';
import CurrencyWidget from './CurrencyWidget';
import TickerWidget from './TickerWidget';
import TimeWidget from './TimeWidget';
import DateWidget from './DateWidget';
import QrCodeWidget from './QrCodeWidget';
import Splash from './Splash';

// Whether a given zone actually has something to show, mirroring each widget's own "nothing
// configured" fallback in ZoneRenderer below (a Prayer/Weather zone with no location, or a
// Ticker with no feed URL, is exactly the kind of gap the "Awaiting content" badge exists to
// flag — it just wasn't ever being reported to the dashboard).
export function zoneHasContent(zone: Zone, state: PlayerState): boolean {
  const cfg = zone.widgetConfig ?? {};
  switch (zone.zoneType) {
    case 'PRAYER':
    case 'WEATHER': {
      const lat = (cfg.latitude as number | undefined) ?? state.latitude;
      const lon = (cfg.longitude as number | undefined) ?? state.longitude;
      return lat != null && lon != null;
    }
    case 'TICKER':
      return !!cfg.feedUrl || !!(cfg.staticText as string | undefined)?.trim();
    case 'CURRENCY':
    case 'TIME':
    case 'DATE':
      return true;
    case 'QR':
      return !!(cfg.value as string | undefined)?.trim();
    default:
      return !!zone.playlist && zone.playlist.items.length > 0;
  }
}

// Renders one Layout zone's content — a widget for a widget zone, or a nested ZonePlayer for a
// MEDIA zone's playlist. Used both for a screen's top-level Layout (PlayerPage) and for a
// LAYOUT-kind playlist item's own zones (ZonePlayer), which is why `state` (needed by the
// location/timezone-aware widgets) is always threaded in rather than assumed to be the top-level
// screen state.
export default function ZoneRenderer({ zone, state, onAssetChange, volume, forceMuted }: {
  zone: Zone; state: PlayerState; onAssetChange: (id: string) => void; volume: number; forceMuted: boolean;
}) {
  const cfg = zone.widgetConfig ?? {};
  const lat = (cfg.latitude as number | undefined) ?? state.latitude;
  const lon = (cfg.longitude as number | undefined) ?? state.longitude;
  const lang = (cfg.lang as 'en' | 'ar' | undefined) ?? 'en';

  switch (zone.zoneType) {
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
    case 'QR':
      if (!(cfg.value as string | undefined)?.trim()) return <Splash text="QR zone: no content set" />;
      return (
        <QrCodeWidget
          value={cfg.value as string | undefined}
          color={cfg.color as string | undefined}
          background={cfg.background as string | undefined}
          sizePercent={cfg.sizePercent as number | undefined}
        />
      );
    default:
      return zone.playlist
        ? <ZonePlayer playlist={zone.playlist} state={state} volume={volume} forceMuted={forceMuted} onAssetChange={onAssetChange} />
        : null;
  }
}
