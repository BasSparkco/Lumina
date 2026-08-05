'use client';
import { useCallback, useState } from 'react';

const STORAGE_KEY = 'lumina_rotate_handle_style';

export type RotateHandleStyle = 'corners' | 'single';

/** Controls how the rotate grip is drawn on a selected zone/element in the Layouts and Themes
 * editors: 'corners' (default) shows a curved-arrow handle at each of the four corners, 'single'
 * restores the original single grip above the shape's top edge. */
export function useRotateHandleStyle() {
  const [style, setStyleState] = useState<RotateHandleStyle>(() => {
    if (typeof window === 'undefined') return 'corners';
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored === 'single' ? 'single' : 'corners';
  });

  const setStyle = useCallback((v: RotateHandleStyle) => {
    setStyleState(v);
    localStorage.setItem(STORAGE_KEY, v);
  }, []);

  return { style, setStyle };
}
