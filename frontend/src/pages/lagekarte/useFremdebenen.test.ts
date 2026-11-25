import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { createElement, type ReactNode } from 'react';
import type { FeatureCollection } from '../../api/fachebenen';
import {
  ladeFremdebeneDaten,
  ladeStandFremdebeneDaten,
  listeFremdebenen,
  type Fremdebene,
} from '../../api/fremdebenen';
import { ladeLageSnapshot } from '../../api/lageSnapshot';
import type { LageSnapshotDokument } from '../../api/types';
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
  ladeStandFremdebeneDaten: vi.fn(),
}));
vi.mock('../../api/lageSnapshot', async (original) => ({
  ...(await original<typeof import('../../api/lageSnapshot')>()),
  ladeLageSnapshot: vi.fn(),
}));
const liste = vi.mocked(listeFremdebenen);
const daten = vi.mocked(ladeFremdebeneDaten);
const standDaten = vi.mocked(ladeStandFremdebeneDaten);
const dokument = vi.mocked(ladeLageSnapshot);

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

describe('Fremdebenen im gesicherten Stand (LLH-2130)', () => {
  const SHA = 'a'.repeat(64);
  const stand = (fremdebenen?: unknown[]) =>
    ({
      id: 11,
      einsatz_id: 9,
      stand_at: '2026-11-25T10:00:00Z',
      schema_version: 1,
      erstellt_von: 1,
      erstellt_at: '2026-11-25T10:00:00Z',
      daten: { version: 1, ...(fremdebenen ? { fremdebenen } : {}) },
    }) as unknown as LageSnapshotDokument;
  const IM_STAND = {
    id: 4,
    name: 'Pegel damals',
    color: 'fremd-3',
    source: 'url',
    url_host: 'geo.example.org',
    feature_count: 1,
    dropped_count: 0,
    sha256: SHA,
  };

  function rendereStand() {
    const client = neuerQueryClient();
    const wrapper = ({ children }: { children: ReactNode }) =>
      createElement(QueryClientProvider, { client }, children);
    return renderHook(() => useFremdebenen(9, { quelle: { typ: 'snapshot', id: 11 } }), {
      wrapper,
    });
  }

  beforeEach(() => {
    liste.mockReset();
    daten.mockReset();
    standDaten.mockReset();
    dokument.mockReset();
  });
  afterEach(() => localStorage.clear());

  it('rueckblick_zeichnet_eingefrorene_ebene über ihren Hash', async () => {
    dokument.mockResolvedValue(stand([IM_STAND]));
    standDaten.mockResolvedValue(FC());
    const { result } = rendereStand();
    await waitFor(() => expect(result.current.aktive).toHaveLength(1));
    expect(standDaten).toHaveBeenCalledWith(9, 11, SHA);
    expect(result.current.ebenen[0]).toMatchObject({ id: 4, name: 'Pegel damals' });
    expect(result.current.aktive[0].name).toBe('Pegel damals');
  });

  it('rueckblick_ruft_live_routen_nicht', async () => {
    dokument.mockResolvedValue(stand([IM_STAND]));
    standDaten.mockResolvedValue(FC());
    const { result } = rendereStand();
    await waitFor(() => expect(result.current.aktive).toHaveLength(1));
    expect(liste).not.toHaveBeenCalled();
    expect(daten).not.toHaveBeenCalled();
  });

  it('aelterer_stand_ohne_feld zeigt keine Fremdebenen und keinen Fehler', async () => {
    dokument.mockResolvedValue(stand());
    const { result } = rendereStand();
    await waitFor(() => expect(dokument).toHaveBeenCalled());
    expect(result.current.ebenen).toEqual([]);
    expect(result.current.listenFehler).toBeNull();
  });

  it('ebene_ohne_id_ist_immer_sichtbar und nicht ausblendbar', async () => {
    dokument.mockResolvedValue(stand([{ ...IM_STAND, id: null }]));
    standDaten.mockResolvedValue(FC());
    const { result } = rendereStand();
    await waitFor(() => expect(result.current.aktive).toHaveLength(1));
    const id = result.current.ebenen[0].id;
    expect(id).toBeLessThan(0);
    act(() => result.current.toggle(id));
    expect(result.current.sichtbar.has(id)).toBe(true);
  });
});
