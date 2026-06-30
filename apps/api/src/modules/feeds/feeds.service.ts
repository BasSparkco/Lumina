import { Injectable, Inject } from '@nestjs/common';
import Redis from 'ioredis';

export const REDIS = 'REDIS_CLIENT';

@Injectable()
export class FeedsService {
  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  async getWeather(lat: number, lon: number) {
    const key = `feed:weather:${lat.toFixed(3)}:${lon.toFixed(3)}`;
    const raw = await this.redis.get(key);
    return raw ? (JSON.parse(raw) as unknown) : null;
  }

  async getCurrency(base: string) {
    const key = `feed:currency:${base.toUpperCase()}`;
    const raw = await this.redis.get(key);
    return raw ? (JSON.parse(raw) as unknown) : null;
  }

  async getWeatherDirect(lat: number, lon: number) {
    const cached = await this.getWeather(lat, lon);
    if (cached) return cached;
    // On cache miss, fetch directly (worker will pre-warm next cycle)
    return this.fetchWeatherDirect(lat, lon);
  }

  private async fetchWeatherDirect(lat: number, lon: number) {
    const url = new URL('https://api.open-meteo.com/v1/forecast');
    url.searchParams.set('latitude', lat.toFixed(4));
    url.searchParams.set('longitude', lon.toFixed(4));
    url.searchParams.set('current', 'temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m');
    url.searchParams.set('wind_speed_unit', 'kmh');
    url.searchParams.set('timezone', 'auto');

    try {
      const res = await fetch(url.toString());
      if (!res.ok) return null;
      const data = await res.json() as { current: { temperature_2m: number; apparent_temperature: number; relative_humidity_2m: number; weather_code: number; wind_speed_10m: number } };
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
      const key = `feed:weather:${lat.toFixed(3)}:${lon.toFixed(3)}`;
      await this.redis.set(key, JSON.stringify(normalized), 'EX', 900);
      return normalized;
    } catch {
      return null;
    }
  }

  async getTicker(url: string) {
    const key = `feed:ticker:${Buffer.from(url).toString('base64').slice(0, 64)}`;
    const raw = await this.redis.get(key);
    if (raw) return JSON.parse(raw) as unknown;
    return this.fetchTickerDirect(url, key);
  }

  private async fetchTickerDirect(url: string, cacheKey: string) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
      if (!res.ok) return null;
      const xml = await res.text();
      const items: Array<{ title: string; link: string }> = [];
      const matches = xml.matchAll(/<item[^>]*>([\s\S]*?)<\/item>/g);
      for (const m of matches) {
        const block = m[1] ?? '';
        const title = (/<title[^>]*><!\[CDATA\[(.*?)\]\]><\/title>/.exec(block) ??
          /<title[^>]*>(.*?)<\/title>/.exec(block))?.[1]?.trim();
        const link = (/<link[^>]*>(.*?)<\/link>/.exec(block))?.[1]?.trim();
        if (title) items.push({ title, link: link ?? '' });
        if (items.length >= 20) break;
      }
      const normalized = { url, items, fetchedAt: new Date().toISOString() };
      await this.redis.set(cacheKey, JSON.stringify(normalized), 'EX', 300);
      return normalized;
    } catch {
      return null;
    }
  }

  private wmoCondition(code: number): string {
    if (code === 0) return 'Clear sky';
    if (code <= 2) return 'Partly cloudy';
    if (code === 3) return 'Overcast';
    if (code <= 49) return 'Fog';
    if (code <= 69) return 'Rain';
    if (code <= 79) return 'Snow';
    if (code <= 82) return 'Rain showers';
    if (code <= 99) return 'Thunderstorm';
    return 'Unknown';
  }

  private wmoIcon(code: number): string {
    if (code === 0) return '☀️';
    if (code <= 2) return '⛅';
    if (code === 3) return '☁️';
    if (code <= 49) return '🌫️';
    if (code <= 69) return '🌧️';
    if (code <= 79) return '❄️';
    if (code <= 82) return '🌦️';
    if (code <= 99) return '⛈️';
    return '🌡️';
  }
}
