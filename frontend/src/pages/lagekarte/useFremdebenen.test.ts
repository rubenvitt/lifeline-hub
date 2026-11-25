import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { createElement, type ReactNode } from 'react';
import type { FeatureCollection } from '../../api/fachebenen';
import { ladeFremdebeneDaten, listeFremdebenen, type Fremdebene } from '../../api/fremdebenen';
import { einsatzKeys } from '../../api/queryKeys';
import { sicherLesen } from '../../lib/sichererSpeicher';
import { neuerQueryClient } from '../../test/utils';
import {
  FREMDEBENEN_SICHT_SCHLUESSEL,
  fremdebeneTakt,
  leseAusgeblendet,
  schreibeAusgeblendet,
  useFremdebenen,
} from './useFremdebenen';

vi.mock('../../api/fremdebenen', async (original) => ({
  ...(await original<typeof import('../../api/fremdebenen')>()),
  listeFremdebenen: vi.fn(),
  ladeFremdebeneDaten: vi.fn(),
}));
const liste = vi.mocked(listeFremdebenen);
const daten = vi.mocked(ladeFremdebeneDaten);

const URL_EBENE = { id: 5, source: 'url' } as Fremdebene;
const DATEI = { id: 4, source: 'datei' } as Fremdebene;

describe('Abruftakt einer Fremdebene (LLH-2099)', () => {
  afterEach(() => vi.restoreAllMocks());

  it('holt eine sichtbare URL-Ebene im Minutentakt, solange der Tab sichtbar ist', () => {
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
    expect(fremdebeneTakt(URL_EBENE, true)).toBe(60_000);
    expect(fremdebeneTakt(URL_EBENE, false)).toBe(false);
    expect(fremdebeneTakt(DATEI, true)).toBe(false);
  });

  it('pausiert im verborgenen Tab', () => {
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    expect(fremdebeneTakt(URL_EBENE, true)).toBe(false);
  });
});

describe('Sichtbarkeit je Arbeitsplatz (LLH-2099)', () => {
  afterEach(() => localStorage.clear());

  it('merkt die ausgeblendeten Ebenen je Einsatz; neue Ebenen sind sichtbar', () => {
    expect(leseAusgeblendet(3)).toEqual(new Set());
    schreibeAusgeblendet(3, new Set([5]));
    expect(sicherLesen(`${FREMDEBENEN_SICHT_SCHLUESSEL}:3`)).toBe('[5]');
    expect(leseAusgeblendet(3)).toEqual(new Set([5]));
    expect(leseAusgeblendet(4)).toEqual(new Set());
  });

  it('übersteht einen kaputten Eintrag', () => {
    localStorage.setItem(`${FREMDEBENEN_SICHT_SCHLUESSEL}:3`, 'kaputt');
    expect(leseAusgeblendet(3)).toEqual(new Set());
    localStorage.setItem(`${FREMDEBENEN_SICHT_SCHLUESSEL}:3`, '[5,"x",7]');
    expect(leseAusgeblendet(3)).toEqual(new Set([5, 7]));
  });
});

const EBENE: Fremdebene = {
  id: 4,
  name: 'Lage Nachbarkreis',
  color: 'fremd-1',
  source: 'datei',
  feature_count: 1,
  dropped_count: 0,
  created_at: '2026-11-24T10:00:00Z',
};
const FC = (): FeatureCollection => ({
  type: 'FeatureCollection',
  features: [
    { type: 'Feature', geometry: { type: 'Point', coordinates: [13, 52] }, properties: {} },
  ],
});

function rendereHook() {
  const client = neuerQueryClient();
  const wrapper = ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client }, children);
  return { client, ...renderHook(() => useFremdebenen(9), { wrapper }) };
}

describe('Daten der sichtbaren Ebenen (LLH-2099)', () => {
  beforeEach(() => {
    liste.mockReset();
    daten.mockReset();
    liste.mockResolvedValue([EBENE]);
  });
  afterEach(() => localStorage.clear());

  it('ein Ladefehler der Daten steht als Zustand der Ebene, mit erneutem Abruf', async () => {
    daten.mockRejectedValueOnce(new Error('kaputt'));
    const { result } = rendereHook();
    await waitFor(() => expect(result.current.datenZustand.get(4)?.art).toBe('fehler'));
    expect(result.current.aktive).toEqual([]);
    const zustand = result.current.datenZustand.get(4);
    expect(zustand?.art === 'fehler' && (zustand.fehler as Error).message).toBe('kaputt');

    daten.mockResolvedValue(FC());
    act(() => {
      if (zustand?.art === 'fehler') zustand.neuLaden();
    });
    await waitFor(() => expect(result.current.aktive).toHaveLength(1));
    expect(result.current.datenZustand.has(4)).toBe(false);
  });

  it('solange die Daten laden, sagt die Ebene „lädt“', async () => {
    daten.mockReturnValue(new Promise(() => {}));
    const { result } = rendereHook();
    await waitFor(() => expect(result.current.datenZustand.get(4)?.art).toBe('laedt'));
  });

  it('ein Abruf mit gleichem Inhalt lässt die gezeigten Ebenen stehen', async () => {
    daten.mockImplementation(() => Promise.resolve(FC()));
    const { result, client } = rendereHook();
    await waitFor(() => expect(result.current.aktive).toHaveLength(1));
    const vorher = result.current.aktive;
    await act(() =>
      client.refetchQueries({ queryKey: einsatzKeys.fremdebeneDaten(9, 4), exact: true }),
    );
    await waitFor(() => expect(daten).toHaveBeenCalledTimes(2));
    expect(result.current.aktive).toBe(vorher);
  });
});
