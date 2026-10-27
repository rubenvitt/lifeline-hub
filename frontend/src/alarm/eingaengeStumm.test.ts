import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import {
  EINGANG_ARTEN,
  istStumm,
  setzeStumm,
  stummeArten,
  useStummeArten,
  vergesseStummStand,
} from './eingaengeStumm';

/** „Stumm auf diesem Gerät“ (LLH-1421): eine Geräte-Einstellung im Browserspeicher. */

const SCHLUESSEL = 'lfh:eingaenge:stumm';

afterEach(() => {
  localStorage.removeItem(SCHLUESSEL);
  vergesseStummStand();
});

describe('eingaengeStumm (LLH-1421)', () => {
  it('schaltbar sind nur Eingänge: kein Alarm, keine Org-Art, kein Unwetter', () => {
    expect(EINGANG_ARTEN).toContain('meldung');
    expect(EINGANG_ARTEN).toContain('lagebericht');
    expect(EINGANG_ARTEN).not.toContain('sofortmeldung');
    expect(EINGANG_ARTEN).not.toContain('unwetter');
    setzeStumm('sofortmeldung', true);
    expect(istStumm('sofortmeldung')).toBe(false);
  });

  it('merkt sich den Stand über ein Neuladen', () => {
    setzeStumm('meldung', true);
    setzeStumm('lagebericht', true);
    setzeStumm('meldung', false);
    vergesseStummStand();
    expect(stummeArten()).toEqual(['lagebericht']);
    expect(JSON.parse(localStorage.getItem(SCHLUESSEL) ?? '[]')).toEqual(['lagebericht']);
  });

  it('Unlesbares und Fremdes im Speicher fallen weg', () => {
    localStorage.setItem(SCHLUESSEL, '{kaputt');
    expect(stummeArten()).toEqual([]);
    vergesseStummStand();
    localStorage.setItem(SCHLUESSEL, JSON.stringify(['sofortmeldung', 'quatsch', 'meldung']));
    expect(stummeArten()).toEqual(['meldung']);
  });

  it('der Hook folgt dem Schalter und einem anderen Tab', () => {
    const { result } = renderHook(() => useStummeArten());
    expect(result.current).toEqual([]);
    act(() => setzeStumm('meldung', true));
    expect(result.current).toEqual(['meldung']);
    act(() => {
      window.dispatchEvent(
        new StorageEvent('storage', { key: SCHLUESSEL, newValue: JSON.stringify([]) }),
      );
    });
    expect(result.current).toEqual([]);
  });
});
