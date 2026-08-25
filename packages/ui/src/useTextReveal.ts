import { useEffect, useState } from 'react';
import type { ThemeElementAnimation } from '@lumina/types';

// Splits into individual characters for 'typewriter', or into whitespace-preserving word chunks
// for 'wordByWord' (the regex capture group keeps the separators in the array, so re-joining
// never loses or collapses spaces).
function splitIntoUnits(text: string, preset: 'typewriter' | 'wordByWord'): string[] {
  return preset === 'typewriter' ? Array.from(text) : text.split(/(\s+)/);
}

/**
 * Progressively reveals `text` one character/word at a time on mount, at `speedMsPerUnit` per
 * step — the JS-driven half of per-element animation (typewriter/word-by-word can't be expressed
 * as a CSS `@keyframes`, unlike entrance/emphasis/exit, see buildEntranceAnimationStyle et al. in
 * @lumina/types). Returns the text unchanged, immediately, when reveal is unset or 'none'.
 * Shared by the dashboard's ThemeCanvasPanel and the player's ThemeRenderer so both reveal at
 * the same pace.
 */
export function useTextReveal(text: string, reveal: ThemeElementAnimation['textReveal'] | undefined): string {
  const preset = reveal?.preset;
  const speedMsPerUnit = reveal?.speedMsPerUnit;
  const [count, setCount] = useState(0);

  useEffect(() => {
    if (!preset || preset === 'none') return;
    setCount(0);
    const totalUnits = splitIntoUnits(text, preset).length;
    if (totalUnits === 0) return;
    const id = setInterval(() => {
      setCount((c) => {
        const next = c + 1;
        if (next >= totalUnits) clearInterval(id);
        return next;
      });
    }, speedMsPerUnit);
    return () => clearInterval(id);
  }, [text, preset, speedMsPerUnit]);

  if (!preset || preset === 'none') return text;
  return splitIntoUnits(text, preset).slice(0, count).join('');
}
