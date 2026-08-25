'use client';
import { useEffect, useRef, useState } from 'react';

// designer.md §8 amendment — every property edit calls `onLive` immediately (adapter direct
// write, no store mutation, no canvas rebuild) and `onCommit` only once, on blur (one
// commit()-wrapped undo step). `value` should come from the store; while the user is actively
// editing (`dirty`), external prop changes are ignored so an in-flight canvas rebuild triggered
// by something else can't stomp on what's being typed. Callers should `key` the field by the
// selected element's id so switching selection resets this hook's local state cleanly.
export function useLiveField<T>(value: T, onLive: (v: T) => void, onCommit: (v: T) => void) {
  const [local, setLocal] = useState(value);
  const dirty = useRef(false);

  useEffect(() => {
    if (!dirty.current) setLocal(value);
  }, [value]);

  return {
    value: local,
    onChange: (v: T) => {
      dirty.current = true;
      setLocal(v);
      onLive(v);
    },
    onBlur: () => {
      dirty.current = false;
      onCommit(local);
    },
  };
}
