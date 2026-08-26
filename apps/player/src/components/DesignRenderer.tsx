import { useEffect, useRef, useState } from 'react';
import { fontStack, mediaCropStyle, buildImageFilterCss, needsSvgImageFilter } from '@lumina/types';
import { ImageAdjustmentFilter } from '@lumina/ui';
import { ANIMATION_MOTION, EASING_FUNCTIONS, type AnimationPreset, type ResolvedDesignPayload, type ResolvedElement, type ResolvedScene } from '@lumina/design-schema';

interface Props {
  design: ResolvedDesignPayload;
}

// designer.md §13's EasingName values are already valid CSS/WAAPI easing keywords — no JS tween
// function needed here (unlike FabricCanvasAdapter, which animates a canvas object per-frame and
// needs EASING_FUNCTIONS' actual formulas). Same fallback as resolveEasing (in
// packages/design-schema/src/runtime/animations.ts) for an unset/unrecognized name.
function cssEasing(name: string | undefined): string {
  return name && name in EASING_FUNCTIONS ? name : 'ease-out';
}

function restKeyframe(opacity: number): Keyframe {
  return { transform: 'translate(0px, 0px) scale(1)', opacity };
}

function awayKeyframe(preset: AnimationPreset, restOpacity: number, scale: number): Keyframe {
  const motion = ANIMATION_MOTION[preset];
  return {
    transform: `translate(${(motion.dx ?? 0) * scale}px, ${(motion.dy ?? 0) * scale}px) scale(${motion.scaleAway ?? 1})`,
    opacity: motion.opacityAway ?? restOpacity,
  };
}

// One nested div, not two properties on one: entrance/emphasis animate `transform`/`opacity` via
// WAAPI on this middle div, while rotation is its own static `transform: rotate()` on the inner
// div — same reasoning ThemeRenderer's own comment gives (a WAAPI/CSS animation's `transform`
// keyframes would overwrite, not compose with, a static rotation for the animation's duration).
function ElementView({ element, scale }: { element: ResolvedElement; scale: number }) {
  const animRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = animRef.current;
    if (!el) return;
    const animations: Animation[] = [];
    const enter = element.animation?.enter;
    if (enter && enter.preset !== 'none' && enter.durationMs > 0) {
      animations.push(el.animate(
        [awayKeyframe(enter.preset, element.opacity, scale), restKeyframe(element.opacity)],
        { duration: enter.durationMs, delay: enter.delayMs, easing: cssEasing(enter.easing), fill: 'both' },
      ));
    }
    const emphasis = element.animation?.emphasis;
    if (emphasis && emphasis.preset !== 'none' && emphasis.durationMs > 0) {
      animations.push(el.animate(
        [restKeyframe(element.opacity), awayKeyframe(emphasis.preset, element.opacity, scale), restKeyframe(element.opacity)],
        { duration: emphasis.durationMs, delay: emphasis.delayMs, easing: cssEasing(emphasis.easing), iterations: emphasis.repeat ?? Infinity },
      ));
    }
    return () => { for (const a of animations) a.cancel(); };
    // This element instance only ever mounts once per scene activation (DesignRenderer renders
    // just the current scene, unmounting it when the loop moves on and remounting fresh next time
    // it comes back around) — deliberately NOT depending on `element` itself, which gets a new
    // object identity on every ~60s state refresh (PlayerPage's STATE_REFRESH_INTERVAL) even when
    // nothing actually changed; depending on it would replay the entrance animation every refresh.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      style={{
        position: 'absolute',
        left: element.x * scale,
        top: element.y * scale,
        width: element.width * scale,
        height: element.height * scale,
        zIndex: element.zIndex,
      }}
    >
      <div ref={animRef} style={{ width: '100%', height: '100%', opacity: element.opacity }}>
        <div
          style={{
            width: '100%',
            height: '100%',
            overflow: 'hidden',
            transform: element.rotation ? `rotate(${element.rotation}deg)` : undefined,
            transformOrigin: 'center center',
          }}
        >
          <ElementContent element={element} scale={scale} />
        </div>
      </div>
    </div>
  );
}

function VideoElementContent({ element }: { element: Extract<ResolvedElement, { type: 'video' }> }) {
  const videoRef = useRef<HTMLVideoElement | null>(null);

  // Mirrors FabricCanvasAdapter.createVideoOverlay's exact start/end-offset semantics — same
  // trim-and-loop-within-clip behavior for the Designer's DOM video overlay and the Player's.
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    video.volume = element.volume;
    const startSec = element.startOffsetMs / 1000;
    const endSec = element.endOffsetMs !== undefined ? element.endOffsetMs / 1000 : undefined;
    const onLoadedMetadata = () => { if (startSec > 0) video.currentTime = startSec; };
    const onTimeUpdate = () => {
      if (endSec === undefined || video.currentTime < endSec) return;
      if (element.loop) video.currentTime = startSec;
      else video.pause();
    };
    video.addEventListener('loadedmetadata', onLoadedMetadata);
    if (endSec !== undefined) video.addEventListener('timeupdate', onTimeUpdate);
    return () => {
      video.removeEventListener('loadedmetadata', onLoadedMetadata);
      video.removeEventListener('timeupdate', onTimeUpdate);
    };
  }, [element.startOffsetMs, element.endOffsetMs, element.loop, element.volume]);

  if (!element.resolvedSrc) return null;
  return (
    <video
      ref={videoRef}
      src={element.resolvedSrc}
      poster={element.posterResolvedSrc}
      muted={element.muted}
      loop={element.loop}
      autoPlay={element.autoplay}
      playsInline
      crossOrigin="anonymous"
      style={{ width: '100%', height: '100%', objectFit: element.fit }}
    />
  );
}

// Same filter-composition pattern as ThemeRenderer's IMAGE case: an SVG url() for the
// temperature/tint/duotone half of adjustments, plain CSS filter functions for the rest.
function ElementContent({ element, scale }: { element: ResolvedElement; scale: number }) {
  if (element.type === 'text') {
    return (
      <div
        dir={element.direction}
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: element.textAlign === 'left' ? 'flex-start' : element.textAlign === 'right' ? 'flex-end' : 'center',
          textAlign: element.textAlign,
          color: element.fill,
          fontFamily: fontStack(element.fontFamily),
          fontSize: element.fontSize * scale,
          fontWeight: element.fontWeight,
          fontStyle: element.fontStyle,
          lineHeight: element.lineHeight,
          letterSpacing: element.charSpacing !== undefined ? `${element.charSpacing}px` : undefined,
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
        }}
      >
        {element.text}
      </div>
    );
  }

  if (element.type === 'image') {
    if (!element.resolvedSrc) return null;
    const svgFilterId = `design-img-adj-${element.id}`;
    const filter = [
      element.adjustments && needsSvgImageFilter(element.adjustments) ? `url(#${svgFilterId})` : null,
      buildImageFilterCss(element.adjustments),
    ].filter(Boolean).join(' ') || undefined;
    return (
      <>
        {element.adjustments && <ImageAdjustmentFilter id={svgFilterId} adjustments={element.adjustments} />}
        <img
          src={element.resolvedSrc}
          alt=""
          crossOrigin="anonymous"
          style={{
            width: '100%',
            height: '100%',
            objectFit: element.fit,
            borderRadius: element.borderRadius ? element.borderRadius * scale : undefined,
            transform: element.flipX || element.flipY ? `scale(${element.flipX ? -1 : 1}, ${element.flipY ? -1 : 1})` : undefined,
            filter,
            ...mediaCropStyle(element),
          }}
        />
      </>
    );
  }

  if (element.type === 'video') return <VideoElementContent element={element} />;

  if (element.type === 'qr') {
    if (!element.resolvedSrc) return null;
    return <img src={element.resolvedSrc} alt="" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />;
  }

  // shape — designer.md §6's six kinds. 'line' is drawn corner-to-corner (0,0)→(width,height),
  // matching FabricObjectFactory's own fabric.Line([0, 0, element.width, element.height]), not a
  // horizontal divider.
  if (element.shape === 'line') {
    return (
      <svg width="100%" height="100%" viewBox={`0 0 ${element.width} ${element.height}`} preserveAspectRatio="none" style={{ display: 'block' }}>
        <line x1={0} y1={0} x2={element.width} y2={element.height} stroke={element.stroke ?? element.fill ?? '#000000'} strokeWidth={element.strokeWidth ?? 1} />
      </svg>
    );
  }
  const shapeStyle: React.CSSProperties = {
    width: '100%',
    height: '100%',
    backgroundColor: element.fill,
    border: element.stroke ? `${element.strokeWidth ?? 1}px solid ${element.stroke}` : undefined,
    boxSizing: 'border-box',
  };
  if (element.shape === 'circle' || element.shape === 'ellipse') return <div style={{ ...shapeStyle, borderRadius: '50%' }} />;
  if (element.shape === 'rounded-rectangle') return <div style={{ ...shapeStyle, borderRadius: (element.radius ?? 12) * scale }} />;
  if (element.shape === 'triangle') return <div style={{ ...shapeStyle, backgroundColor: element.fill, border: undefined, clipPath: 'polygon(50% 0%, 0% 100%, 100% 100%)' }} />;
  return <div style={shapeStyle} />; // rectangle
}

function SceneBackgroundView({ background }: { background: ResolvedScene['background'] }) {
  if (background.type === 'color') {
    return <div style={{ position: 'absolute', inset: 0, background: background.color }} />;
  }
  if (background.resolvedSrc && background.type === 'image') {
    return <img src={background.resolvedSrc} alt="" crossOrigin="anonymous" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />;
  }
  if (background.resolvedSrc && background.type === 'video') {
    return <video src={background.resolvedSrc} autoPlay muted loop playsInline crossOrigin="anonymous" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />;
  }
  return null;
}

function SceneView({ scene, scale }: { scene: ResolvedScene; scale: number }) {
  const visible = scene.elements.filter(el => el.visible !== false).sort((a, b) => a.zIndex - b.zIndex);
  return (
    <div style={{ width: '100%', height: '100%', position: 'relative', overflow: 'hidden' }}>
      <SceneBackgroundView background={scene.background} />
      {visible.map(el => <ElementView key={el.id} element={el} scale={scale} />)}
    </div>
  );
}

// designer.md Phase 11 — the Player's own DOM/CSS runtime for a Design (designer.md §23.2:
// "Editor = Fabric.js, Player = Lumina DOM/CSS runtime"). Scene timeline mirrors the exact
// setTimeout-loop pattern Phase 6 built for the Designer's own scene preview
// (DesignerShell.tsx), just running continuously instead of manually toggled.
export default function DesignRenderer({ design }: Props) {
  const [sceneIndex, setSceneIndex] = useState(0);
  const [scale, setScale] = useState(0);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const preloadVideoRef = useRef<HTMLVideoElement | null>(null);
  // Read by the timer effect below without being one of its dependencies — see that effect's own
  // comment for why (avoids restarting a scene's dwell timer on every ~60s state refresh).
  const designRef = useRef(design);
  useEffect(() => { designRef.current = design; }, [design]);

  useEffect(() => {
    setSceneIndex(0);
  }, [design.id]);

  useEffect(() => {
    const sceneCount = designRef.current.scenes.length;
    if (!sceneCount) return;
    const scene = designRef.current.scenes[sceneIndex % sceneCount];
    if (!scene) return;

    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      setSceneIndex(i => (i + 1) % sceneCount);
    }, scene.durationMs);

    // Warm the SW media-cache for the next scene's media, mirroring PlayerPage's own
    // prefetchWayfindingImages() (fire-and-forget `new Image().src = url`) plus ZonePlayer's
    // preloadRef pattern for video.
    const next = designRef.current.scenes[(sceneIndex + 1) % sceneCount];
    if (next) {
      if (next.background.type === 'image' && next.background.resolvedSrc) new Image().src = next.background.resolvedSrc;
      if (next.background.type === 'video' && next.background.resolvedSrc && preloadVideoRef.current) {
        preloadVideoRef.current.src = next.background.resolvedSrc;
        preloadVideoRef.current.load();
      }
      for (const el of next.elements) {
        if ((el.type === 'image' || el.type === 'video' || el.type === 'qr') && el.resolvedSrc) new Image().src = el.resolvedSrc;
      }
    }

    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
    // Deliberately keyed on sceneIndex/design.id only, not the whole `design` object (see
    // designRef above) — design.id is stable across a refresh of the same Design asset, so this
    // only actually re-arms the timer on a real scene transition.
  }, [sceneIndex, design.id]);

  // JS-measured scale (ResizeObserver), same convention CanvasViewport uses for the Designer's
  // own zoom — no CSS container-query units needed for a fixed-aspect-ratio letterboxed fit.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const measure = () => {
      const rect = el.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;
      setScale(Math.min(rect.width / design.canvas.width, rect.height / design.canvas.height));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [design.canvas.width, design.canvas.height]);

  const scene = design.scenes.length ? design.scenes[sceneIndex % design.scenes.length] : undefined;

  return (
    <div ref={containerRef} style={{ width: '100%', height: '100%', position: 'relative', overflow: 'hidden', background: design.canvas.backgroundColor }}>
      {scene && scale > 0 && (
        <div
          style={{
            position: 'absolute',
            left: '50%',
            top: '50%',
            width: design.canvas.width * scale,
            height: design.canvas.height * scale,
            transform: 'translate(-50%, -50%)',
          }}
        >
          <SceneView key={scene.id} scene={scene} scale={scale} />
        </div>
      )}
      <video ref={preloadVideoRef} style={{ display: 'none' }} preload="auto" muted />
    </div>
  );
}
