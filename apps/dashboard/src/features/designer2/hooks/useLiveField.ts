'use client';
import { useEffect, useRef, useState } from 'react';

// designer_modernization_plan.md M5 — begin/preview/commit/cancel edit session. `preview` is the
// per-tick adapter-only write (no store mutation, no canvas rebuild, no history); `commit` is the
// one store write per interaction, called on blur/release, and is itself gated: a `commit()` call
// with nothing changed since `begin()` (a no-op focus+blur, or a value typed then reverted back to
// its original) never reaches `onCommit` at all — this is the primary fix for M5's "continuous
// color drag floods history" / "no-op blur creates a spurious undo step" root causes, with
// useEditorHistory's own no-op suppression (M5) as a shared-hook safety net behind it. `cancel` —
// wired to Escape by callers — rolls the live preview back to the session's baseline without ever
// calling `onCommit`. `value` should come from the store; while a session is dirty, external prop
// changes are ignored so an in-flight canvas rebuild triggered by something else can't stomp on
// what's being edited. Callers should `key` the field by the selected element's id so switching
// selection resets this hook's local state cleanly.
export interface EditSession<T> {
  value: T;
  begin: () => void;
  preview: (next: T) => void;
  commit: (next?: T) => void;
  cancel: () => void;
}

export function useEditSession<T>(
  externalValue: T,
  opts: {
    onPreview: (v: T) => void;
    onCommit: (v: T) => void;
    isEqual?: (a: T, b: T) => boolean;
    isValid?: (v: T) => boolean;
  },
): EditSession<T> {
  const { onPreview, onCommit, isEqual = Object.is, isValid = () => true } = opts;
  const [local, setLocal] = useState(externalValue);
  const dirty = useRef(false);
  const baseline = useRef(externalValue);

  useEffect(() => {
    if (!dirty.current) {
      setLocal(externalValue);
      baseline.current = externalValue;
    }
  }, [externalValue]);

  function begin() {
    if (!dirty.current) baseline.current = local;
  }

  function preview(next: T) {
    dirty.current = true;
    setLocal(next);
    onPreview(next);
  }

  function commit(next?: T) {
    if (!dirty.current) return; // nothing changed since begin() — no-op suppression
    const final = next ?? local;
    if (!isValid(final)) {
      preview(baseline.current);
      dirty.current = false;
      return;
    }
    dirty.current = false;
    if (isEqual(final, baseline.current)) return; // reverted back to its original value
    baseline.current = final;
    onCommit(final);
  }

  function cancel() {
    setLocal(baseline.current);
    onPreview(baseline.current);
    dirty.current = false;
  }

  return { value: local, begin, preview, commit, cancel };
}

// Backward-compatible specialization of useEditSession — every property edit calls `onLive`
// immediately (adapter direct write) and `onCommit` only once, on blur (one commit()-wrapped undo
// step, now also no-op-suppressed — see useEditSession above).
export function useLiveField<T>(value: T, onLive: (v: T) => void, onCommit: (v: T) => void) {
  const session = useEditSession(value, { onPreview: onLive, onCommit });
  return {
    value: session.value,
    onFocus: session.begin,
    onChange: (v: T) => session.preview(v),
    onBlur: () => session.commit(),
    onKeyDown: (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') session.cancel();
    },
  };
}
