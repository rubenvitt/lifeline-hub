import { describe, expect, it } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useErstBeiBedarf } from './useErstBeiBedarf';

describe('useErstBeiBedarf (LLH-1974)', () => {
  it('ist falsch, solange nie geöffnet wurde', () => {
    const { result } = renderHook(({ offen }) => useErstBeiBedarf(offen), {
      initialProps: { offen: false },
    });
    expect(result.current).toBe(false);
  });

  it('wird im selben Render wahr, in dem offen wahr wird', () => {
    const { result, rerender } = renderHook(({ offen }) => useErstBeiBedarf(offen), {
      initialProps: { offen: false },
    });
    rerender({ offen: true });
    expect(result.current).toBe(true);
  });

  it('bleibt wahr, wenn offen wieder falsch wird', () => {
    const { result, rerender } = renderHook(({ offen }) => useErstBeiBedarf(offen), {
      initialProps: { offen: true },
    });
    rerender({ offen: false });
    expect(result.current).toBe(true);
  });
});
