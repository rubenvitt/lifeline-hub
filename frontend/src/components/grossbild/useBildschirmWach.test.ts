import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useBildschirmWach } from './useBildschirmWach';

let freigeben: ReturnType<typeof vi.fn>;
let anfordern: ReturnType<typeof vi.fn>;

beforeEach(() => {
  freigeben = vi.fn(() => Promise.resolve());
  anfordern = vi.fn(() =>
    Promise.resolve({
      release: freigeben,
      addEventListener: vi.fn(),
    } as unknown as WakeLockSentinel),
  );
  Object.defineProperty(navigator, 'wakeLock', {
    configurable: true,
    value: { request: anfordern },
  });
});

afterEach(() => {
  delete (navigator as { wakeLock?: unknown }).wakeLock;
});

describe('useBildschirmWach', () => {
  it('fordert nichts an, solange die Ansicht nicht läuft', () => {
    renderHook(() => useBildschirmWach(false));
    expect(anfordern).not.toHaveBeenCalled();
  });

  it('fordert beim Start an und gibt beim Abbau frei', async () => {
    const { result, unmount } = renderHook(() => useBildschirmWach(true));
    await waitFor(() => expect(result.current).toBe('an'));
    expect(anfordern).toHaveBeenCalledWith('screen');
    unmount();
    expect(freigeben).toHaveBeenCalled();
  });

  it('fordert bei der Rückkehr in den Vordergrund neu an', async () => {
    renderHook(() => useBildschirmWach(true));
    await waitFor(() => expect(anfordern).toHaveBeenCalledTimes(1));
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await waitFor(() => expect(anfordern).toHaveBeenCalledTimes(2));
  });

  it('meldet einen Browser ohne Wachhalten', () => {
    delete (navigator as { wakeLock?: unknown }).wakeLock;
    const { result } = renderHook(() => useBildschirmWach(true));
    expect(result.current).toBe('nicht-unterstuetzt');
  });
});
