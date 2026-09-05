import { useEffect, useMemo, useRef, useState } from 'react';
import { X, Search, Send } from 'lucide-react';
import type { WayfindingAiResolution } from '@lumina/types';
import type { WayfindingDirectory, WayfindingPoi, WayfindingRouteNode } from '../lib/api';
import { WayfindingAiClient } from '../lib/wayfindingAiClient';
import { appendTurn, pickNearestReachableCandidate, type ConversationTurn } from '../lib/wayfindingAiSession';
import WayfindingKeyboard from './WayfindingKeyboard';
import type { WayfindingLang } from '../lib/wayfindingLang';

interface DisplayMessage {
  role: 'user' | 'assistant';
  text: string;
  alternatives?: { poiId: string; label: string; floorLabel: string }[];
}

const STRINGS: Record<WayfindingLang, {
  title: string; placeholder: string; useDirectory: string; send: string;
}> = {
  en: { title: 'Ask the Assistant', placeholder: 'Ask where something is…', useDirectory: 'Use Directory Instead', send: 'Send' },
  ar: { title: 'اسأل المساعد', placeholder: 'اسأل عن مكان شيء ما…', useDirectory: 'استخدم الدليل بدلاً من ذلك', send: 'إرسال' },
};

// docs/modules/ai_wayfinding_module_plan.md §9 — additive overlay opened from the existing
// Wayfinding kiosk header (§3.2), not a second application. Every destination it resolves is
// handed to the exact same `onSelect` callback the ordinary Directory panel already uses
// (WayfindingKioskMap's `selectFromDirectory`), so floor switching, route opening, and
// accessibility-route selection are never duplicated — only the deterministic local route engine
// ever computes a route, never this component or the AI provider.
export default function WayfindingAiAssistant({
  directory, lang, attractActive, kioskNode, onClose, onSelect, onUseDirectory,
}: {
  directory: WayfindingDirectory;
  lang: WayfindingLang;
  attractActive: boolean;
  kioskNode: WayfindingRouteNode | null;
  onClose: () => void;
  onSelect: (poi: WayfindingPoi) => void;
  onUseDirectory: () => void;
}) {
  const config = directory.aiAssistant;
  const s = STRINGS[lang];
  const maxTurns = config?.maxTurns ?? 8;

  const clientRef = useRef<WayfindingAiClient | null>(null);
  clientRef.current ??= new WayfindingAiClient();

  const [turns, setTurns] = useState<ConversationTurn[]>([]);
  const [messages, setMessages] = useState<DisplayMessage[]>([]);
  const [input, setInput] = useState('');
  const [keyboardOpen, setKeyboardOpen] = useState(false);
  const [pending, setPending] = useState(false);

  const welcomeMessage = useMemo(
    () => (lang === 'ar' ? config?.welcomeMessageAr : config?.welcomeMessage) ?? '',
    [config, lang],
  );

  // §9.3 — reset the conversation after the existing idle/attract timeout so the next visitor
  // never sees a stranger's turns; also aborts any in-flight request rather than letting a
  // response land after the kiosk has already moved on to attract mode.
  useEffect(() => {
    if (!attractActive) return;
    clientRef.current?.abort();
    setTurns([]);
    setMessages([]);
    setInput('');
    setPending(false);
  }, [attractActive]);

  // Abort on unmount (screen reload / streaming-mode change / emergency closing the assistant).
  useEffect(() => () => clientRef.current?.abort(), []);

  function handleResolution(resolution: WayfindingAiResolution) {
    if (resolution.type === 'DESTINATION') {
      const poi = directory.pois.find((p) => p.id === resolution.poiId);
      if (poi) {
        onSelect(poi);
        onClose();
        return;
      }
      setMessages((m) => [...m, { role: 'assistant', text: resolution.message }]);
      return;
    }
    if (resolution.type === 'NEAREST_DESTINATION') {
      if (kioskNode) {
        const nearest = pickNearestReachableCandidate(
          resolution.candidatePoiIds, directory.pois, directory.routeNodes, directory.routeEdges, kioskNode,
        );
        if (nearest) {
          onSelect(nearest);
          onClose();
          return;
        }
      }
      setMessages((m) => [...m, { role: 'assistant', text: resolution.message }]);
      return;
    }
    if (resolution.type === 'CLARIFICATION') {
      setMessages((m) => [...m, { role: 'assistant', text: resolution.message, alternatives: resolution.alternatives }]);
      return;
    }
    // NO_MATCH / UNAVAILABLE — never clear the Wayfinding presentation; just show the message
    // and keep the ordinary Directory reachable via the permanent action below (§9.4).
    setMessages((m) => [...m, { role: 'assistant', text: resolution.message }]);
  }

  async function submit(message: string) {
    const trimmed = message.trim();
    if (!trimmed || pending) return; // §9.3 — disable repeated submission while a request is active
    setInput('');
    setMessages((m) => [...m, { role: 'user', text: trimmed }]);
    const nextTurns = appendTurn(turns, { role: 'user', text: trimmed }, maxTurns);
    setPending(true);
    try {
      const resolution = await clientRef.current!.resolve(trimmed, lang, turns);
      setTurns(appendTurn(nextTurns, { role: 'assistant', text: resolution.message }, maxTurns));
      handleResolution(resolution);
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return; // superseded by a newer request or a reset
    } finally {
      setPending(false);
    }
  }

  function selectAlternative(poiId: string) {
    const poi = directory.pois.find((p) => p.id === poiId);
    if (poi) {
      onSelect(poi);
      onClose();
    }
  }

  return (
    <div style={styles.overlay} dir={lang === 'ar' ? 'rtl' : 'ltr'}>
      <header style={styles.header}>
        <div style={styles.title}>{s.title}</div>
        <button style={styles.closeButton} onClick={onClose}>
          <X size={24} color="#f1f5f9" />
        </button>
      </header>

      <div style={styles.messages}>
        {welcomeMessage && messages.length === 0 && (
          <div style={styles.assistantBubble}>{welcomeMessage}</div>
        )}
        {messages.map((m, i) => (
          <div key={i} style={m.role === 'user' ? styles.userBubble : styles.assistantBubble}>
            {m.text}
            {m.alternatives && (
              <div style={styles.alternatives}>
                {m.alternatives.map((alt) => (
                  <button key={alt.poiId} style={styles.alternativeButton} onClick={() => selectAlternative(alt.poiId)}>
                    <span>{alt.label}</span>
                    <span style={styles.alternativeFloor}>{alt.floorLabel}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        ))}
        {pending && <div style={styles.assistantBubble}>…</div>}
      </div>

      <button style={styles.directoryFallback} onClick={onUseDirectory}>
        <Search size={16} /> {s.useDirectory}
      </button>

      <button
        style={styles.inputBar}
        onClick={() => setKeyboardOpen(true)}
      >
        <span style={input ? styles.inputText : styles.inputPlaceholder}>{input || s.placeholder}</span>
        <span
          role="button"
          style={styles.sendButton}
          onClick={(e) => { e.stopPropagation(); void submit(input); }}
        >
          <Send size={18} color="#0f172a" />
        </span>
      </button>

      {keyboardOpen && (
        <WayfindingKeyboard
          lang={lang}
          onKey={(ch) => setInput((v) => v + ch)}
          onSpace={() => setInput((v) => v + ' ')}
          onBackspace={() => setInput((v) => v.slice(0, -1))}
          onCollapse={() => setKeyboardOpen(false)}
        />
      )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  overlay: {
    position: 'absolute', inset: 0, background: '#0f172a', color: '#f1f5f9',
    fontFamily: 'system-ui, sans-serif', display: 'flex', flexDirection: 'column',
    padding: '2vh 3vw', boxSizing: 'border-box', zIndex: 5,
  },
  header: { flex: '0 0 auto', display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.5vh' },
  title: { fontSize: '2.2vw', fontWeight: 800 },
  closeButton: {
    background: 'rgba(255,255,255,0.1)', border: 'none', borderRadius: '50%', width: 44, height: 44,
    display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
  },
  messages: {
    flex: '1 1 auto', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '1.2vh',
    paddingBottom: '2vh',
  },
  assistantBubble: {
    alignSelf: 'flex-start', maxWidth: '80%', background: 'rgba(255,255,255,0.08)', borderRadius: '4px 16px 16px 16px',
    padding: '1.2vh 1.4vw', fontSize: '1.3vw', lineHeight: 1.4,
  },
  userBubble: {
    alignSelf: 'flex-end', maxWidth: '80%', background: '#2563eb', color: '#fff', borderRadius: '16px 4px 16px 16px',
    padding: '1.2vh 1.4vw', fontSize: '1.3vw', lineHeight: 1.4,
  },
  alternatives: { display: 'flex', flexDirection: 'column', gap: '0.6vh', marginTop: '1vh' },
  alternativeButton: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '1vw',
    background: 'rgba(255,255,255,0.1)', border: 'none', borderRadius: 10, padding: '1vh 1vw',
    color: '#f1f5f9', fontSize: '1.2vw', fontWeight: 600, cursor: 'pointer', textAlign: 'start',
  },
  alternativeFloor: { fontSize: '1vw', opacity: 0.6, fontWeight: 500 },
  directoryFallback: {
    flex: '0 0 auto', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5vw',
    background: 'none', border: '2px solid rgba(255,255,255,0.15)', borderRadius: 999, color: '#cbd5e1',
    fontSize: '1.1vw', fontWeight: 600, padding: '0.8vh 1.2vw', cursor: 'pointer', marginBottom: '1.2vh',
  },
  inputBar: {
    flex: '0 0 auto', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.8vw',
    background: 'rgba(255,255,255,0.08)', border: 'none', borderRadius: 14, padding: '1.4vh 1.4vw',
    cursor: 'pointer', width: '100%', boxSizing: 'border-box', textAlign: 'start',
  },
  inputText: { fontSize: '1.4vw', color: '#f1f5f9', flex: 1 },
  inputPlaceholder: { fontSize: '1.4vw', color: '#64748b', flex: 1 },
  sendButton: {
    flex: '0 0 auto', width: 36, height: 36, borderRadius: '50%', background: '#f1f5f9',
    display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
  },
};
