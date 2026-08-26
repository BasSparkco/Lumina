# Flutter Player Integration Guide

**Audience:** Hamza — cross-platform Flutter client (Android, Windows, macOS, Linux)
**Scope:** Bridging the `designer2` engine's output and the existing playlist/asset model into the Flutter runtime, plus fixing the YouTube `APP` element crash.
**Status:** Reference spec, grounded in the actual API/schema code as of 2026-08-26 (`apps/api`, `apps/player`, `packages/design-schema`).

> Everything in this document is copied or directly derived from real source in this repo — file
> paths are given throughout so you can cross-check against the TypeScript source of truth at any
> time. Where Dart code is given, it's a **suggested pattern**, not existing code — adapt it to
> your project's structure.

---

## 0. The one thing to internalize before anything else

There are **two different JSON shapes** in this system that look similar but are not
interchangeable:

| | Where it lives | Who parses it | Contains |
|---|---|---|---|
| `DesignDocument` | `DesignAsset.designJson` in Postgres | The **web Designer only** (`designer2`) | Raw author-time data: unresolved `{{variable}}` tokens, bare `assetId` strings, no signed URLs |
| `ResolvedDesignPayload` | `PlaylistItem.design` in the `/player/state` response | **The Player** (your Flutter app) | Post-resolution: variables already substituted, every `assetId` already a real CDN URL (`resolvedSrc`) |

**Your Flutter app must only ever parse `ResolvedDesignPayload`.** It never talks to the Designer
schema, never sees a raw `{{business.name}}` token, and never resolves an `assetId` itself. The
resolution step (`apps/api/src/modules/player/player.service.ts`, method `hydrateDesign`) already
did that work server-side before the JSON reaches you. If you ever find yourself writing code to
look up an asset by id or substitute a `{{...}}` string client-side, stop — that's a sign you're
accidentally consuming the wrong shape.

---

## 1. Top-level contract: `/player/state`

This is the single endpoint that drives everything a screen renders. Full shape (from
`apps/player/src/lib/api.ts:316`, which is itself typed straight off `player.service.ts`'s
`getState()`):

```ts
interface PlayerState {
  screenId: string;
  streamingType: 'ASSET' | 'PLAYLIST' | 'WAYFINDING';
  timezone: string;
  latitude: number | null;
  longitude: number | null;
  prayerMethod: string;
  athanEnabled: boolean;
  stopped: boolean;
  showClock: boolean;
  orientation: 0 | 90 | 180 | 270;
  emergencyActive: boolean;
  emergencyPlaylist: Playlist | null;
  asset: Playlist | null;              // only when streamingType === 'ASSET'
  wayfinding: WayfindingDirectory | null;
  scheduleRules: ScheduleRule[];
  resolvedPlaylistId: string | null;
  defaultPlaylist: Playlist | null;
  poweredOn: boolean;
  powerScheduleRules: PowerRule[];
  volume: number;
}
```

**Playlist resolution order** (mirror this exactly — see `PlayerPage.tsx`'s `resolvePlaylist`):

```
1. emergencyActive && emergencyPlaylist  → play this, nothing else matters
2. streamingType === 'ASSET'             → play `state.asset` (already wrapped as a 1-item Playlist)
3. wayfinding != null                    → render the directory board, not a playlist at all
4. scheduleRules matched for "now"       → play that rule's playlist
5. otherwise                             → defaultPlaylist
```

`Playlist` and `PlaylistItem`:

```ts
interface Playlist {
  id: string;
  name: string;
  items: PlaylistItem[];
}

type PlaylistItemKind = 'ASSET' | 'THEME' | 'LAYOUT' | 'DESIGN';

interface PlaylistItem {
  id: string;
  position: number;
  durationSecs: number;
  muted: boolean;
  playFullVideo: boolean;      // true = ignore durationSecs, advance on video "ended"
  cropZoom: number | null;
  cropOffsetX: number | null;
  cropOffsetY: number | null;
  kind: PlaylistItemKind;
  // Exactly ONE of these four is non-null, matching `kind`.
  asset: HydratedAsset | null;
  theme: HydratedTheme | null;
  layout: { id: string; name: string; zones: Zone[] } | null;
  design: ResolvedDesignPayload | null;
}
```

Build your Dart model as a **sealed class over `kind`**, not a single flat object with nullable
fields you branch on ad hoc — this is exactly the shape of bug this guide exists to prevent (see
§3).

---

## 2. `designer2` data model — what changed vs. the legacy Zone/ThemeElement world

Two rendering models coexist in this product today. Your Flutter player needs to handle **both**,
because Playlists can mix `THEME`/`LAYOUT` items (legacy) and `DESIGN` items (new `designer2`) in
the same rotation.

### 2.1 Legacy: Theme / Layout+Zone

- A `Theme` is one full-screen canvas of `HydratedThemeElement[]` (kinds: `TEXT`, `IMAGE`, `VIDEO`,
  `DOCUMENT`, `PLAYLIST`, `SHAPE`, `BRUSH`, `WIDGET`, `ICON`).
- A `Layout` is a grid of `Zone`s, each zone independently playing its own nested `Playlist`.
- Styling lives in a separate `style: ThemeElementStyle` object per element (color, font, crop,
  image adjustments, shape fill) rather than being flattened onto the element.
- Animation is `ThemeElementAnimation` — a different (older, less general) shape than `designer2`'s
  animation model, described in §2.3.

You already need to support this for any playlist containing existing Themes/Layouts — nothing
about it is deprecated, it just isn't `designer2`.

### 2.2 New: `designer2` → `ResolvedDesignPayload`

A `DESIGN`-kind playlist item's `design` field is a `ResolvedDesignPayload`
(`packages/design-schema/src/player-contract.ts`):

```ts
interface ResolvedDesignPayload {
  schemaVersion: 1;
  id: string;
  canvas: { width: number; height: number; backgroundColor: string };
  scenes: ResolvedScene[];
}

interface ResolvedScene {
  id: string;
  durationMs: number;
  background: { type: 'color' | 'image' | 'video'; color?: string; resolvedSrc?: string };
  elements: ResolvedElement[];
}

// DesignElement (below) + resolved media fields
type ResolvedElement = DesignElement & { resolvedSrc?: string; posterResolvedSrc?: string };
```

**Key structural differences from the legacy model:**

| | Legacy (Theme/Zone) | designer2 (`ResolvedDesignPayload`) |
|---|---|---|
| Canvas | Fixed per-Theme `aspectRatio` string | Explicit `canvas.width` / `canvas.height` (pixel design space, e.g. 1920×1080) — scale-to-fit, don't reinterpret as a ratio string |
| Playback unit | One flat element list | **Scenes** — an array, each with its own `durationMs`; a multi-scene design is itself a mini-timeline your player must step through |
| Styling | Separate `style` object per element | Flattened directly onto the element (`fontSize`, `fill`, `x`/`y`/`width`/`height` are all top-level element properties) |
| Element discriminator | `kind: 'TEXT' | 'IMAGE' | ...'` | `type: 'text' | 'image' | 'shape' | 'video' | 'qr'` — **lowercase, different field name** |
| Interaction flags | none (styling implies behavior) | Every element carries `selectable`/`movable`/`resizable`/`deletable`/`editable` — these are **editor-only** concerns (used by the Designer's canvas UI for Template permission enforcement). Your player can safely ignore all five; they never affect rendering or playback. |
| Media reference | `content.url` (already resolved) | `resolvedSrc` (Image/Video/QR) + `posterResolvedSrc` (Video only) |

`DesignElement` is a discriminated union on `type` (`packages/design-schema/src/element.schema.ts`).
There are exactly **five** variants — build your Dart parser as an exhaustive `sealed class`/`enum`
switch over these five, same principle as §3's `AssetKind` fix:

```ts
type DesignElement =
  | TextElement    // type: 'text'
  | ImageElement   // type: 'image'
  | ShapeElement   // type: 'shape'
  | VideoElement   // type: 'video'
  | QrElement;     // type: 'qr'
```

Fields common to all five (`BaseElementSchema`):
`id, name, x, y, width, height, rotation, opacity, visible, zIndex, animation?, dynamicBindings?`
— `dynamicBindings` will already be **empty/irrelevant** by the time you see it; the resolver
substitutes bindings into the actual property values before the payload ever reaches the player.
Don't re-implement variable substitution — `resolveElementBindings` already ran server-side.

Per-type fields you'll actually render:

- **`text`**: `text, fontFamily, fontSize, fontWeight, fontStyle?, fill, textAlign, direction ('ltr'|'rtl'), lineHeight?, charSpacing?`
- **`image`**: `resolvedSrc?, cropZoom?, cropOffsetX?, cropOffsetY?, fit ('contain'|'cover'|'fill'), adjustments? (brightness/contrast/saturation/etc., same shape as legacy `ThemeImageAdjustments`), borderRadius?, flipX?, flipY?`
- **`shape`**: `shape ('rectangle'|'rounded-rectangle'|'circle'|'ellipse'|'triangle'|'line'), fill?, stroke?, strokeWidth?, radius?`
- **`video`**: `resolvedSrc?, posterResolvedSrc?, startOffsetMs, endOffsetMs?, muted, volume, loop, fit, autoplay`
- **`qr`**: `resolvedSrc?` (server pre-renders the QR to a **data URL PNG** via the `qrcode` npm package — you never need a QR-generation library on-device; just decode and paint the data URL like any other image)

### 2.3 Animation

`element.animation` = `{ enter?, emphasis?, exit? }`, each a
`{ preset, durationMs, delayMs, easing? }` (emphasis also has `repeat?`).

`preset` is one of: `'none' | 'fade' | 'fade-up' | 'fade-down' | 'slide-left' | 'slide-right' | 'zoom-in' | 'zoom-out' | 'pulse'`.

The **exact motion definition** for each preset is a shared, framework-agnostic table —
`ANIMATION_MOTION` in `packages/design-schema/src/runtime/animations.ts` — consumed identically by
both the web Designer (Fabric.js canvas) and the web Player (WAAPI). **Port this table verbatim
into Dart** rather than re-deriving your own guess at what "fade-up" looks like, or your Flutter
player will visibly disagree with the web Designer's live preview:

```dart
class AnimationMotion {
  final double? opacityAway;
  final double dx;
  final double dy;
  final double scaleAway;
  const AnimationMotion({this.opacityAway, this.dx = 0, this.dy = 0, this.scaleAway = 1});
}

const slideDistancePx = 60.0;

const Map<String, AnimationMotion> animationMotion = {
  'none':        AnimationMotion(),
  'fade':        AnimationMotion(opacityAway: 0),
  'fade-up':     AnimationMotion(opacityAway: 0, dy: slideDistancePx),
  'fade-down':   AnimationMotion(opacityAway: 0, dy: -slideDistancePx),
  'slide-left':  AnimationMotion(dx: slideDistancePx),
  'slide-right': AnimationMotion(dx: -slideDistancePx),
  'zoom-in':     AnimationMotion(opacityAway: 0, scaleAway: 0.85),
  'zoom-out':    AnimationMotion(opacityAway: 0, scaleAway: 1.15),
  'pulse':       AnimationMotion(scaleAway: 1.06),
};
```

- "Away" state = the animation's start (enter) or end (exit) keyframe; "rest" state is always
  `translate(0,0) scale(1)` at the element's own base opacity.
- `easing` is one of `'linear' | 'ease' | 'ease-in' | 'ease-out' | 'ease-in-out'` — these map
  directly to Flutter's `Curves.linear / .ease / .easeIn / .easeOut / .easeInOut`. Unrecognized/
  missing easing falls back to `ease-out` (match this fallback exactly).
- Use `AnimationController` + `Tween` (dx/dy/scale/opacity) driven by these values — conceptually
  identical to the web's WAAPI keyframe pair.
- **Exit-on-scene-transition auto-trigger is explicitly out of scope for V1** on the web player too
  (documented gap in `player.service.ts`'s Phase 11 amendment) — don't block on it; `enter` and
  `emphasis` (looping) are what's actually shipped and expected to work.

### 2.4 Scene timeline & canvas scaling

A `ResolvedDesignPayload` isn't one static frame — `scenes[]` is itself a loop:

1. Render `scenes[0]` for `durationMs`, then advance to `scenes[1]`, wrapping back to `scenes[0]`
   after the last one (same shape as the web `DesignRenderer`'s `setTimeout`-driven loop).
2. Each scene switch is a full remount of that scene's elements (so `enter` animations replay
   every time a scene comes back around — this is intentional, not a bug to "fix" by keeping state).
3. **Canvas scaling**: `canvas.width`/`canvas.height` is a fixed pixel design space (e.g.
   1920×1080). Measure your actual screen/window size, compute a **uniform scale factor**
   (`min(screenW/canvas.width, screenH/canvas.height)`), and letterbox — do not stretch
   independently on each axis. This is the same "JS-measured, not CSS-container-query" approach
   `CanvasViewport.tsx`/`DesignRenderer.tsx` use; a `LayoutBuilder` + manual `Transform.scale` is
   the Flutter equivalent.
4. Element `x`/`y`/`width`/`height`/`fontSize` are all **already in canvas pixel space** — apply
   your one global scale factor to everything uniformly, never per-element.
5. `rotation` is degrees, clockwise, about the element's own center — keep it as a **separate,
   static transform** from any WAAPI/animation transform, the same way the web renderer nests it
   (`ElementView`'s own doc comment explains why: an active enter/emphasis animation's transform
   keyframes would otherwise silently overwrite a static rotation for the animation's duration).

---

## 3. Fixing the YouTube `APP` parsing bug

### 3.1 Root cause

YouTube isn't a `PlaylistItemKind` — it's an `Asset` whose `type` is `'APP'`, one of six values:

```ts
type AssetType = 'IMAGE' | 'VIDEO' | 'AUDIO' | 'TEXT' | 'DOCUMENT' | 'APP';
```

It reaches a Flutter player exactly the same way an image or video does: as a normal `ASSET`-kind
`PlaylistItem` whose `asset.type` happens to be `"APP"`. **If your `AssetType`/`ElementType` enum
or parsing `switch` only accounts for the "real media" types (`IMAGE`/`VIDEO`/`AUDIO`/`TEXT`/
`DOCUMENT`) and has no `APP` case — and no safe default — deserializing that item throws an
unhandled-enum exception**, which is exactly the crash you're seeing. This is a very common Dart
`json_serializable`/`freezed` pitfall: an exhaustive `switch` (or an enum's `byName`/`values.firstWhere`)
that was written before `APP` existed, or that assumed "asset" always means playable media.

This is **not a server bug** — the web player (`apps/player/src/components/ZonePlayer.tsx:245`)
already branches on `asset?.type === 'APP'` correctly and has since the "Custom Player" phase. The
fix is entirely in the Flutter-side parser.

### 3.2 The exact JSON payload

`asset` on a `PlaylistItem` (from `player.service.ts`'s `hydratePlaylist`, full shape in
`apps/player/src/lib/api.ts:58`):

```json
{
  "id": "asset_abc123",
  "name": "Store Promo Video",
  "type": "APP",
  "mimeType": "application/x-app-embed",
  "url": null,
  "thumbnailUrl": null,
  "pageUrls": [],
  "textContent": null,
  "textFontFamily": null, "textColor": null, "textSize": null, "textBackgroundColor": null,
  "textTickerEnabled": false, "textTickerDirection": "RIGHT_TO_LEFT",
  "textTickerSpeed": null, "textTickerCrossOffset": null,
  "appProviderId": "youtube",
  "appConfig": { "...": "see below — one of two shapes" }
}
```

Note: `url` is **always `null`** for `APP` assets (there is no `storageKey` — nothing was
uploaded; see the `Asset.storageKey` schema comment: *"Unused (synthetic key, nothing ever
uploaded) for TEXT and APP assets, which store their content in textContent / appConfig
instead"*). If your code falls back to treating a null `url` as "broken/missing media" for any
asset type, `APP` items will look empty even after you add the enum case — check `appConfig`
instead for this type.

`appConfig` is a **discriminated union on `kind`**, currently only ever produced from a YouTube
URL (`apps/api/src/modules/apps/apps.service.ts`), but written generically for future providers:

```ts
type AppConfig =
  | { kind: 'video'; title: string; thumbnailUrl: string | null; embedUrl: string; width: number | null; height: number | null }
  | { kind: 'playlist'; playbackOrder: 'SEQUENTIAL' | 'SHUFFLE'; items: { sourceUrl: string; title: string; thumbnailUrl: string | null; embedUrl: string }[] };
```

Single video example:
```json
{
  "kind": "video",
  "title": "Amazing Store Tour",
  "thumbnailUrl": "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg",
  "embedUrl": "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ",
  "width": 480,
  "height": 360
}
```

Playlist-of-videos example:
```json
{
  "kind": "playlist",
  "playbackOrder": "SEQUENTIAL",
  "items": [
    { "sourceUrl": "https://youtu.be/abc123", "title": "Promo 1", "thumbnailUrl": "...", "embedUrl": "https://www.youtube-nocookie.com/embed/abc123" },
    { "sourceUrl": "https://youtu.be/def456", "title": "Promo 2", "thumbnailUrl": "...", "embedUrl": "https://www.youtube-nocookie.com/embed/def456" }
  ]
}
```

`embedUrl` always points at `youtube-nocookie.com/embed/<videoId>` — extract the trailing path
segment as the video id (`embedUrl.split('/').last`, same trick `AppPlayer.tsx`'s
`videoIdFromEmbedUrl` uses) rather than re-parsing the original `sourceUrl` yourself.

### 3.3 Dart fix — enum/model layer

Add `app` to your asset-kind enum (or whatever it's currently called) and make every switch over
it **exhaustive**, so a future sixth `AssetType` fails loudly at compile time instead of crashing
at runtime in prod:

```dart
enum AssetKind { image, video, audio, text, document, app }

AssetKind assetKindFromJson(String raw) => switch (raw) {
  'IMAGE' => AssetKind.image,
  'VIDEO' => AssetKind.video,
  'AUDIO' => AssetKind.audio,
  'TEXT' => AssetKind.text,
  'DOCUMENT' => AssetKind.document,
  'APP' => AssetKind.app,
  _ => throw FormatException('Unknown AssetType: $raw'), // fail fast on a genuinely new value, not silently drop content
};

sealed class AppConfig {
  const AppConfig();
  factory AppConfig.fromJson(Map<String, dynamic> json) => switch (json['kind']) {
    'video' => AppConfigVideo.fromJson(json),
    'playlist' => AppConfigPlaylist.fromJson(json),
    _ => throw FormatException('Unknown appConfig.kind: ${json['kind']}'),
  };
}

class AppConfigVideo extends AppConfig {
  final String title;
  final String? thumbnailUrl;
  final String embedUrl;
  final int? width;
  final int? height;
  const AppConfigVideo({required this.title, this.thumbnailUrl, required this.embedUrl, this.width, this.height});
  factory AppConfigVideo.fromJson(Map<String, dynamic> j) => AppConfigVideo(
    title: j['title'] as String,
    thumbnailUrl: j['thumbnailUrl'] as String?,
    embedUrl: j['embedUrl'] as String,
    width: j['width'] as int?,
    height: j['height'] as int?,
  );
}

class AppConfigPlaylist extends AppConfig {
  final String playbackOrder; // 'SEQUENTIAL' | 'SHUFFLE'
  final List<AppPlaylistEntry> items;
  const AppConfigPlaylist({required this.playbackOrder, required this.items});
  factory AppConfigPlaylist.fromJson(Map<String, dynamic> j) => AppConfigPlaylist(
    playbackOrder: j['playbackOrder'] as String,
    items: (j['items'] as List).map((e) => AppPlaylistEntry.fromJson(e)).toList(),
  );
}

class AppPlaylistEntry {
  final String sourceUrl, title, embedUrl;
  final String? thumbnailUrl;
  AppPlaylistEntry({required this.sourceUrl, required this.title, this.thumbnailUrl, required this.embedUrl});
  factory AppPlaylistEntry.fromJson(Map<String, dynamic> j) => AppPlaylistEntry(
    sourceUrl: j['sourceUrl'] as String,
    title: j['title'] as String,
    thumbnailUrl: j['thumbnailUrl'] as String?,
    embedUrl: j['embedUrl'] as String,
  );
}
```

Route it in your playlist-item renderer:

```dart
Widget buildAssetItem(HydratedAsset asset) => switch (asset.kind) {
  AssetKind.image => ImagePlayerWidget(asset: asset),
  AssetKind.video => VideoPlayerWidget(asset: asset),
  AssetKind.audio => AudioPlayerWidget(asset: asset),
  AssetKind.text  => TextPlayerWidget(asset: asset),
  AssetKind.document => DocumentPagerWidget(asset: asset),
  AssetKind.app => YoutubeAppWidget(asset: asset), // <-- the missing case
};
```

### 3.4 Rendering the embed: platform split

There is **no single Flutter widget that covers Android + Windows + macOS + Linux** for this —
split by platform:

- **Android**: use [`youtube_player_flutter`](https://pub.dev/packages/youtube_player_flutter) (or
  `youtube_player_iframe`, which also works cross-platform via WebView and is generally the safer
  pick going forward) with the extracted video id. Native player, no WebView overhead, matches the
  web player's use of the official IFrame API.
- **Desktop (Windows/macOS/Linux)**: there is no native YouTube SDK for desktop. Embed
  `appConfig.embedUrl` directly (`https://www.youtube-nocookie.com/embed/<id>?autoplay=1&controls=0&mute=<0|1>&playsinline=1`)
  in a WebView (`webview_windows` on Windows, `webview_cocoa`/`flutter_inappwebview` on macOS,
  `webview_linux`/`flutter_inappwebview` on Linux — `flutter_inappwebview` is the one package with
  reasonable coverage across all three if you want a single dependency). This mirrors exactly what
  the query-string driven `<iframe>`/`YT.Player` embed in `AppPlayer.tsx` does — same URL, same
  params.
- **Query params to always set** (matches `AppPlayer.tsx`'s `playerVars`): `autoplay=1`,
  `controls=0`, `modestbranding=1`, `rel=0`, `playsinline=1`, plus `mute=1` unless the item's
  `muted` flag is `false` **and** you've already had a user-gesture interaction on this device
  (browsers/WebViews block unmuted autoplay without one — see §5.3).
- `appConfig.kind === 'playlist'`: advance through `items[]` sequentially (or shuffled if
  `playbackOrder === 'SHUFFLE'`, shuffle once per mount — don't reshuffle every loop), on each
  video's natural "ended" event, same as `AppPlayer.tsx`'s `advance()`. A single non-playlist video
  should loop itself.
- **Video unavailable / embedding-disabled errors**: YouTube's IFrame API reports error codes 2
  (bad id), 5 (embed player failure), 100 (removed/private), 101 & 150 (both mean "owner disabled
  embedding" — historically two codes for the same thing, never unified). Show a legible fallback
  message instead of YouTube's own broken-iframe UI, and — for a multi-item playlist only — auto-skip
  to the next item after **6 seconds** (`ERROR_SKIP_DELAY_MS` in `AppPlayer.tsx`) so one broken
  video doesn't stall the whole rotation. A lone single-video item has nowhere to skip to; just
  leave the message up.

---

## 4. Cross-platform player compatibility checklist

### 4.1 Platform-specific considerations

| Concern | Android | Windows / macOS / Linux |
|---|---|---|
| YouTube rendering | `youtube_player_flutter` / `youtube_player_iframe` (native or lightweight WebView) | `flutter_inappwebview` (or per-OS webview package) pointed at `embedUrl` |
| Video decoding | Hardware decode via platform `MediaCodec` (Flutter's `video_player` uses ExoPlayer under the hood) — confirm HEVC/H.264 hardware support on your target kiosk hardware | Desktop `video_player` backends vary in codec support by OS; test the actual signage-device GPU, not just a dev machine |
| App lifecycle | Signage devices often run as a locked-down launcher/kiosk app — handle `AppLifecycleState` so playback doesn't pause when the OS momentarily backgrounds the activity (e.g. a system dialog) | Windows/Linux kiosks are frequently just a fullscreen window with no OS-level "backgrounding" concept — focus instead on recovering from GPU/driver resets and display sleep/wake |
| Fullscreen/orientation | Respect `PlayerState.orientation` (0/90/180/270°) — a physical portrait-mounted panel reports itself sideways; rotate your render surface, not just the OS orientation setting, so canvas letterboxing (§2.4) still computes against the *visual* width/height | Same `orientation` field applies — desktop kiosks are sometimes portrait-mounted monitors too |
| Local storage for cache | `path_provider`'s app-support directory; make sure the launcher grants persistent storage (not cleared on relaunch) | Same — verify install/update flow doesn't wipe the app-data directory between versions |
| WebView availability | Bundled via the packages above — no separate install needed on modern Android | `webview_windows` requires WebView2 Runtime present on the machine (bundled with Windows 11, **must be provisioned on Windows 10 kiosks**) — check this at first boot, not after a blank YouTube tile in the field |

### 4.2 Media caching

The web player deliberately does **not** maintain an explicit media blob cache — it relies on the
browser's own HTTP cache plus a "preload the next item" pattern (`ZonePlayer.tsx`'s hidden
`<video preload="auto">` that gets `.src` set and `.load()`'d one item ahead;
`DesignRenderer.tsx` does the same for scene-background video). **Flutter has no equivalent
implicit HTTP cache**, so you need an explicit one:

- Use `flutter_cache_manager` (or `cached_network_image` for the image case) keyed by asset `url`/
  `resolvedSrc`, with a reasonably long TTL — these URLs are signed/CDN URLs that don't change
  content once issued for a given asset.
- **Prefetch one item ahead**, same trigger point as the web player: as soon as item *N* starts
  playing, kick off a background download of item *N+1*'s primary media (and, for a `DESIGN` item,
  the *next scene's* background/element media) so the transition never blocks on a cold fetch.
- **What state gets cached, and where** (mirrors `apps/player/src/lib/db.ts`'s IndexedDB stores —
  reproduce this exact shape with `hive`/`sqflite`/`shared_preferences`, whichever your project
  already uses):
  - `state`: the last successful `/player/state` response — restore and render from this on a cold
    boot with no network, rather than showing a blank screen.
  - `playlist`: last resolved playlist (legacy standalone field, largely superseded by `state`
    already containing it).
  - `widgetCache`: per-widget-instance last-known data (weather, currency, ticker) — keyed
    individually so a screen with two different live-data zones restores each independently.
  - `config`: small string key/value pairs (pairing token, device settings).

### 4.3 Dynamic sync polling intervals

Match these exactly (`apps/player/src/pages/PlayerPage.tsx:18-19`) — they were tuned for a
reasonable balance of "feels live" vs. server load across a large device fleet, not arbitrary:

- **Heartbeat**: every **30s** — `POST /player/heartbeat` with `{ currentAssetId, hasContent }`.
  A `401` here means the credential was revoked; clear all local cache and drop back to pairing.
  Any other failure (network blip, 5xx) — just keep playing on cached state, don't react.
- **State refresh**: every **60s** — re-fetch `/player/state` and re-resolve the active playlist +
  power schedule. On failure, fall back to the last cached `state` blob rather than blanking.
- **Push override**: a WebSocket (Socket.IO, `auth: { token }`, `transports: ['websocket', 'polling']`,
  auto-reconnect with backoff up to 30s) delivers immediate `command` events — `publish` (re-fetch
  state right now, don't wait for the next 60s tick), `reload` (full app restart), `clear-cache`.
  Implement this too, not just polling — a Template/Design/Playlist edit going live should reach
  the screen in seconds, not up to a minute later.
- **Schedule re-evaluation**: recompute which schedule/power rule is active whenever one is due to
  change (`msUntilNextTransition` — a precise `Timer` fired at the next boundary), not on a fixed
  poll — a rule that starts at 09:00:00 should flip at 09:00:00, not up to 60s late.

### 4.4 Error fallback behavior

- **State fetch fails, no cache either** (first-ever boot with no network): show a clear
  "connecting…" state, keep retrying — never a raw error screen on a public-facing display.
- **A single media item fails to load** (404, decode error, expired URL): skip to the next
  playlist item rather than freezing the whole rotation — same principle as the YouTube
  error-skip in §3.4, generalized to every media type.
- **`401` on any authenticated call**: treat as revoked pairing — clear cache, return to the
  pairing/QR screen. Do **not** treat this the same as a network error.
- **Design/Theme JSON fails schema validation** server-side: `hydrateDesign` returns `null` for
  that item rather than throwing — your client should treat a `null` `design`/`theme`/`layout` on
  an otherwise-well-formed item as "skip this item," not as a fatal parse error.

### 4.5 RTL

`TextElement.direction` is `'ltr' | 'rtl'` per-element (not a global screen setting — a design can
mix English and Arabic text blocks in the same scene). Wrap each text element's render in
Flutter's own `Directionality` widget scoped to that element, driven by this field — don't rely on
the OS locale or a single app-wide `Directionality` ancestor.

---

## 5. Suggested execution milestones

1. **Model layer**: add the `AssetKind.app` case + `AppConfig` sealed class (§3.3). This alone
   fixes the crash — ship it first, independently of everything else below.
2. **YouTube rendering**: wire `youtube_player_iframe`/`youtube_player_flutter` for Android and a
   WebView-based embed for desktop (§3.4). Verify against a real `embedUrl` from a test playlist
   item, including the error-code fallback UI.
3. **`ResolvedDesignPayload` parser**: model `DesignElement`'s five variants (§2.2) as a sealed
   class; get a single static Text+Image scene rendering correctly at the right scale (§2.4)
   before touching animation or multi-scene timing.
4. **Scene timeline**: multi-scene looping with per-scene `durationMs` (§2.4).
5. **Animation runtime**: port `ANIMATION_MOTION` (§2.3) verbatim; wire enter/emphasis via
   `AnimationController`.
6. **Sync/caching hardening**: polling cadence + WS push (§4.3), media prefetch-one-ahead (§4.2),
   offline cache restore on cold boot (§4.4).
7. **Cross-platform pass**: run the same test playlist (mixed ASSET/APP/THEME/LAYOUT/DESIGN items)
   on Android and at least one desktop target; confirm WebView2 provisioning on a clean Windows 10
   image specifically (§4.1) — this is the most likely first-deploy surprise.

Ping the API team before changing anything under `packages/design-schema` or
`player.service.ts`'s hydration output — that's the shared contract this whole document describes,
and a change there needs to stay in lockstep with whatever Hamza builds against it.
