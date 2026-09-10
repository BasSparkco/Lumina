import { renderHook, act } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { KeyboardEvent } from 'react';
import { useEditSession, useLiveField } from '../useLiveField';

describe('useEditSession (M5 edit-session engine)', () => {
  it('syncs local value from the external prop while not dirty, and ignores it while dirty', () => {
    const onPreview = vi.fn();
    const onCommit = vi.fn();
    const { result, rerender } = renderHook(
      ({ value }) => useEditSession<number>(value, { onPreview, onCommit }),
      { initialProps: { value: 1 } },
    );
    rerender({ value: 2 });
    expect(result.current.value).toBe(2);

    act(() => result.current.begin());
    act(() => result.current.preview(5));
    rerender({ value: 3 }); // external change while dirty — must not clobber the live edit
    expect(result.current.value).toBe(5);
  });

  it('preview() calls onPreview on every call and never onCommit', () => {
    const onPreview = vi.fn();
    const onCommit = vi.fn();
    const { result } = renderHook(() => useEditSession<number>(0, { onPreview, onCommit }));
    act(() => result.current.begin());
    act(() => result.current.preview(1));
    act(() => result.current.preview(2));
    act(() => result.current.preview(3));
    expect(onPreview).toHaveBeenCalledTimes(3);
    expect(onCommit).not.toHaveBeenCalled();
  });

  it('commit() fires onCommit exactly once per begin -> preview* -> commit cycle', () => {
    const onPreview = vi.fn();
    const onCommit = vi.fn();
    const { result } = renderHook(() => useEditSession<number>(0, { onPreview, onCommit }));
    act(() => result.current.begin());
    act(() => result.current.preview(1));
    act(() => result.current.preview(2));
    act(() => result.current.commit());
    expect(onCommit).toHaveBeenCalledExactlyOnceWith(2);
  });

  it('commit() is a no-op when nothing changed since begin() (focus+blur, no edit)', () => {
    const onPreview = vi.fn();
    const onCommit = vi.fn();
    const { result } = renderHook(() => useEditSession<number>(5, { onPreview, onCommit }));
    act(() => result.current.begin());
    act(() => result.current.commit());
    expect(onCommit).not.toHaveBeenCalled();
  });

  it('commit() is a no-op when the value was typed then reverted back to its original', () => {
    const onPreview = vi.fn();
    const onCommit = vi.fn();
    const { result } = renderHook(() => useEditSession<number>(5, { onPreview, onCommit }));
    act(() => result.current.begin());
    act(() => result.current.preview(9));
    act(() => result.current.preview(5));
    act(() => result.current.commit());
    expect(onCommit).not.toHaveBeenCalled();
  });

  it('cancel() restores the baseline via onPreview and never calls onCommit', () => {
    const onPreview = vi.fn();
    const onCommit = vi.fn();
    const { result } = renderHook(() => useEditSession<number>(5, { onPreview, onCommit }));
    act(() => result.current.begin());
    act(() => result.current.preview(9));
    onPreview.mockClear();
    act(() => result.current.cancel());
    expect(result.current.value).toBe(5);
    expect(onPreview).toHaveBeenCalledExactlyOnceWith(5);
    act(() => result.current.commit());
    expect(onCommit).not.toHaveBeenCalled();
  });

  it('reverts and skips onCommit when the committed value fails isValid', () => {
    const onPreview = vi.fn();
    const onCommit = vi.fn();
    const { result } = renderHook(() =>
      useEditSession<number>(5, { onPreview, onCommit, isValid: (v: number) => v >= 0 }),
    );
    act(() => result.current.begin());
    act(() => result.current.preview(-3));
    act(() => result.current.commit());
    expect(onCommit).not.toHaveBeenCalled();
    expect(result.current.value).toBe(5);
  });
});

describe('useLiveField (backward-compatible NumberField wrapper)', () => {
  it('onChange fires onLive per call, onBlur fires onCommit once', () => {
    const onLive = vi.fn();
    const onCommit = vi.fn();
    const { result } = renderHook(() => useLiveField<number>(10, onLive, onCommit));
    act(() => result.current.onFocus());
    act(() => result.current.onChange(11));
    act(() => result.current.onChange(12));
    expect(onLive).toHaveBeenCalledTimes(2);
    act(() => result.current.onBlur());
    expect(onCommit).toHaveBeenCalledExactlyOnceWith(12);
  });

  it('a no-op blur (no prior onChange) never calls onCommit', () => {
    const onLive = vi.fn();
    const onCommit = vi.fn();
    const { result } = renderHook(() => useLiveField<number>(10, onLive, onCommit));
    act(() => result.current.onFocus());
    act(() => result.current.onBlur());
    expect(onCommit).not.toHaveBeenCalled();
  });

  it('Escape reverts the live value and never calls onCommit', () => {
    const onLive = vi.fn();
    const onCommit = vi.fn();
    const { result } = renderHook(() => useLiveField<number>(10, onLive, onCommit));
    act(() => result.current.onFocus());
    act(() => result.current.onChange(99));
    act(() => result.current.onKeyDown({ key: 'Escape' } as KeyboardEvent));
    expect(result.current.value).toBe(10);
    act(() => result.current.onBlur());
    expect(onCommit).not.toHaveBeenCalled();
  });
});
