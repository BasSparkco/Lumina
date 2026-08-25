import { BadRequestException, Injectable } from '@nestjs/common';
import { APP_PROVIDERS, getProvider } from './providers';

export interface ResolvedApp {
  providerId: string;
  sourceUrl: string;
  title: string;
  thumbnailUrl: string | null;
  embedUrl: string;
  width: number | null;
  height: number | null;
}

const YOUTUBE_HOSTS = ['youtube.com', 'youtu.be', 'm.youtube.com'];

@Injectable()
export class AppsService {
  listProviders() {
    return APP_PROVIDERS;
  }

  async resolve(providerId: string, sourceUrl: string): Promise<ResolvedApp> {
    const provider = getProvider(providerId);
    if (!provider) throw new BadRequestException(`Unknown app: ${providerId}`);
    if (providerId === 'youtube') return this.resolveYoutube(sourceUrl);
    throw new BadRequestException(`No resolver registered for app: ${providerId}`);
  }

  // Used when saving a custom playlist (apps/assets/playlist) — re-resolves every item
  // server-side rather than trusting whatever preview the dashboard showed while building the
  // list, same principle as the single-video create path.
  async resolveMany(providerId: string, sourceUrls: string[]): Promise<ResolvedApp[]> {
    return Promise.all(sourceUrls.map(url => this.resolve(providerId, url)));
  }

  // Note: this only ever calls out to YouTube's own oEmbed endpoint (a fixed host), never
  // fetches the caller-supplied sourceUrl directly, so there's no SSRF surface here — we're
  // asking YouTube to resolve a video it hosts, not fetching an arbitrary URL ourselves.
  private async resolveYoutube(sourceUrl: string): Promise<ResolvedApp> {
    let parsed: URL;
    try {
      parsed = new URL(sourceUrl);
    } catch {
      throw new BadRequestException('That is not a valid URL');
    }
    const host = parsed.hostname.replace(/^www\./, '');
    if (!YOUTUBE_HOSTS.includes(host)) throw new BadRequestException('That is not a YouTube URL');

    const videoId = this.extractVideoId(parsed, host);
    if (!videoId) throw new BadRequestException("Couldn't find a video id in that URL");

    const oembedUrl = `https://www.youtube.com/oembed?url=${encodeURIComponent(sourceUrl)}&format=json`;
    const res = await fetch(oembedUrl);
    if (!res.ok) throw new BadRequestException("Couldn't find that YouTube video — check the link is public and correct");
    const data = (await res.json()) as { title: string; thumbnail_url?: string; width?: number; height?: number };

    return {
      providerId: 'youtube',
      sourceUrl,
      title: data.title,
      thumbnailUrl: data.thumbnail_url ?? null,
      embedUrl: `https://www.youtube-nocookie.com/embed/${videoId}`,
      width: data.width ?? null,
      height: data.height ?? null,
    };
  }

  private extractVideoId(url: URL, host: string): string | null {
    if (host === 'youtu.be') return url.pathname.slice(1).split('/')[0] ?? null;
    if (url.pathname.startsWith('/shorts/')) return url.pathname.split('/')[2] ?? null;
    if (url.pathname.startsWith('/embed/')) return url.pathname.split('/')[2] ?? null;
    return url.searchParams.get('v');
  }
}
