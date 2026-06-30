import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import Redis from 'ioredis';
import { PrismaService } from '../prisma/prisma.service';

interface OpenMeteoResponse {
  current: {
    temperature_2m: number;
    relative_humidity_2m: number;
    weather_code: number;
    wind_speed_10m: number;
    apparent_temperature: number;
  };
}


@Injectable()
export class ConnectorsService implements OnModuleInit {
  private readonly logger = new Logger(ConnectorsService.name);
  private readonly redis: Redis;

  constructor(private readonly prisma: PrismaService) {
    this.redis = new Redis(process.env['REDIS_URL'] ?? 'redis://localhost:6381');
  }

  async onModuleInit() {
    // Warm up connectors at startup
    await Promise.allSettled([this.pollCurrency(), this.pollWeatherForScreens()]);
  }

  // ─── Weather ─────────────────────────────────────────────────────────────────

  @Cron(CronExpression.EVERY_10_MINUTES)
  async pollWeatherForScreens() {
    const screens = await this.prisma.screen.findMany({
      where: { paired: true, latitude: { not: null }, longitude: { not: null } },
      select: { latitude: true, longitude: true },
    });

    const unique = new Map<string, { lat: number; lon: number }>();
    for (const s of screens) {
      if (s.latitude == null || s.longitude == null) continue;
      const key = `${s.latitude.toFixed(3)}:${s.longitude.toFixed(3)}`;
      if (!unique.has(key)) unique.set(key, { lat: s.latitude, lon: s.longitude });
    }

    for (const [, { lat, lon }] of unique) {
      await this.fetchWeather(lat, lon).catch(err =>
        this.logger.warn(`Weather fetch failed for ${lat},${lon}: ${err}`),
      );
    }
  }

  async fetchWeather(lat: number, lon: number) {
    const url = new URL('https://api.open-meteo.com/v1/forecast');
    url.searchParams.set('latitude', lat.toFixed(4));
    url.searchParams.set('longitude', lon.toFixed(4));
    url.searchParams.set('current', 'temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m');
    url.searchParams.set('wind_speed_unit', 'kmh');
    url.searchParams.set('timezone', 'auto');

    const res = await fetch(url.toString());
    if (!res.ok) throw new Error(`Open-Meteo returned ${res.status}`);
    const data = await res.json() as OpenMeteoResponse;

    const normalized = {
      temperature: Math.round(data.current.temperature_2m),
      feelsLike: Math.round(data.current.apparent_temperature),
      humidity: data.current.relative_humidity_2m,
      windKmh: Math.round(data.current.wind_speed_10m),
      weatherCode: data.current.weather_code,
      condition: this.wmoCondition(data.current.weather_code),
      icon: this.wmoIcon(data.current.weather_code),
      fetchedAt: new Date().toISOString(),
    };

    const cacheKey = `feed:weather:${lat.toFixed(3)}:${lon.toFixed(3)}`;
    await this.redis.set(cacheKey, JSON.stringify(normalized), 'EX', 900); // 15 min TTL
    this.logger.debug(`Cached weather for ${lat},${lon}`);
    return normalized;
  }

  // ─── Currency ─────────────────────────────────────────────────────────────────

  @Cron(CronExpression.EVERY_HOUR)
  async pollCurrency() {
    try {
      // ECB daily XML rates (EUR base, free, no key)
      const res = await fetch('https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml');
      if (!res.ok) throw new Error(`ECB returned ${res.status}`);
      const xml = await res.text();

      const rates: Record<string, number> = { EUR: 1 };
      // Simple regex parse — avoids xml2js dependency
      const matches = xml.matchAll(/currency='([A-Z]+)' rate='([\d.]+)'/g);
      for (const m of matches) {
        if (m[1] && m[2]) rates[m[1]] = parseFloat(m[2]);
      }

      const normalized = { base: 'EUR', rates, fetchedAt: new Date().toISOString() };
      await this.redis.set('feed:currency:EUR', JSON.stringify(normalized), 'EX', 7200); // 2h TTL

      // Also pre-compute USD base for convenience
      if (rates['USD']) {
        const usdRates: Record<string, number> = {};
        for (const [cur, rate] of Object.entries(rates)) {
          usdRates[cur] = parseFloat((rate / rates['USD']).toFixed(4));
        }
        usdRates['USD'] = 1;
        const usdNorm = { base: 'USD', rates: usdRates, fetchedAt: normalized.fetchedAt };
        await this.redis.set('feed:currency:USD', JSON.stringify(usdNorm), 'EX', 7200);
      }

      this.logger.log(`Cached ECB currency rates (${Object.keys(rates).length} pairs)`);
    } catch (err) {
      this.logger.warn(`Currency fetch failed: ${err}`);
    }
  }

  // ─── RSS Ticker ──────────────────────────────────────────────────────────────

  async fetchTicker(url: string) {
    const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) throw new Error(`RSS fetch returned ${res.status}`);
    const xml = await res.text();

    // Simple regex extraction — covers standard RSS 2.0 and Atom
    const items: Array<{ title: string; link: string; pubDate?: string }> = [];
    const itemMatches = xml.matchAll(/<item[^>]*>([\s\S]*?)<\/item>/g);
    for (const m of itemMatches) {
      const block = m[1] ?? '';
      const title = (/<title[^>]*><!\[CDATA\[(.*?)\]\]><\/title>/.exec(block) ??
        /<title[^>]*>(.*?)<\/title>/.exec(block))?.[1]?.trim();
      const link = (/<link[^>]*>(.*?)<\/link>/.exec(block))?.[1]?.trim();
      const pubDate = (/<pubDate[^>]*>(.*?)<\/pubDate>/.exec(block))?.[1]?.trim();
      if (title) items.push({ title, link: link ?? '', pubDate });
      if (items.length >= 20) break;
    }

    // Fallback: Atom <entry>
    if (!items.length) {
      const entryMatches = xml.matchAll(/<entry[^>]*>([\s\S]*?)<\/entry>/g);
      for (const m of entryMatches) {
        const block = m[1] ?? '';
        const title = (/<title[^>]*>(.*?)<\/title>/.exec(block))?.[1]?.trim();
        if (title) items.push({ title, link: '' });
        if (items.length >= 20) break;
      }
    }

    const normalized = { url, items, fetchedAt: new Date().toISOString() };
    const cacheKey = `feed:ticker:${Buffer.from(url).toString('base64').slice(0, 64)}`;
    await this.redis.set(cacheKey, JSON.stringify(normalized), 'EX', 300); // 5 min TTL
    return normalized;
  }

  // ─── WMO Weather Interpretation ──────────────────────────────────────────────

  private wmoCondition(code: number): string {
    if (code === 0) return 'Clear sky';
    if (code <= 2) return 'Partly cloudy';
    if (code === 3) return 'Overcast';
    if (code <= 9) return 'Fog';
    if (code <= 19) return 'Drizzle';
    if (code <= 29) return 'Rain';
    if (code <= 39) return 'Snow';
    if (code <= 49) return 'Fog';
    if (code <= 59) return 'Drizzle';
    if (code <= 69) return 'Rain';
    if (code <= 79) return 'Snow';
    if (code <= 82) return 'Rain showers';
    if (code <= 84) return 'Snow showers';
    if (code <= 99) return 'Thunderstorm';
    return 'Unknown';
  }

  private wmoIcon(code: number): string {
    if (code === 0) return '☀️';
    if (code <= 2) return '⛅';
    if (code === 3) return '☁️';
    if (code <= 9) return '🌫️';
    if (code <= 29) return '🌧️';
    if (code <= 39) return '❄️';
    if (code <= 59) return '🌦️';
    if (code <= 69) return '🌧️';
    if (code <= 79) return '🌨️';
    if (code <= 82) return '🌦️';
    if (code <= 84) return '🌨️';
    if (code <= 99) return '⛈️';
    return '🌡️';
  }
}
