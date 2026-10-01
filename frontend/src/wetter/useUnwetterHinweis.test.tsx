import { QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ModulOverrides } from '../api/types';
import { einsatzKeys } from '../api/queryKeys';
import { benutzerFixture } from '../test/fixtures';
import { server } from '../test/server';
import { neuerQueryClient } from '../test/utils';
import { useUnwetterHinweis } from './useUnwetterHinweis';

const ton = vi.hoisted(() => vi.fn());
vi.mock('../alarm/alarmTon', async (original) => ({
  ...(await original<typeof import('../alarm/alarmTon')>()),
  spieleAlarmTon: ton,
}));

/**
 * Die Erkennung „neu" am Draht (LFH-663, design.md D4–D6): EIN Ereignis beim ersten Stand, keins
 * nach einem Neuladen mit demselben Gedächtnis, keins bei unbekanntem Stand, keine Anfrage bei
 * ausgeblendetem Modul.
 */

const benutzer = benutzerFixture({ anzeigename: 'E' });
const PFAD = '/api/einsaetze/7/wetter';
const STUNDE = 3_600_000;

function antwort(alterMs: number) {
  const jetzt = Date.now();
  const um = (ms: number) => new Date(jetzt + ms).toISOString();
  return {
    ort: { name: 'Hann. Münden' },
    warnungen: {
      zustand: 'ok',
      abgerufen_at: um(-alterMs),
      daten: [
        {
          stufe: 'schwer',
          ereignis: 'SCHWERES GEWITTER',
          ueberschrift: 'Amtliche UNWETTERWARNUNG vor SCHWEREM GEWITTER',
          beginn: um(-STUNDE),
          ende: um(2 * STUNDE),
        },
        {
          stufe: 'maessig',
          ereignis: 'STURMBÖEN',
          ueberschrift: 'Amtliche WARNUNG vor STURMBÖEN',
          beginn: um(-STUNDE),
          ende: um(2 * STUNDE),
        },
      ],
    },
    vorhersage: { zustand: 'ausfall' },
  };
}

function liefere(alterMs = 60_000): { anzahl: number } {
  const zaehler = { anzahl: 0 };
  server.use(
    http.get(PFAD, () => {
      zaehler.anzahl += 1;
      return HttpResponse.json(antwort(alterMs));
    }),
  );
  return zaehler;
}

let client = neuerQueryClient();
function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
beforeEach(() => {
  client = neuerQueryClient();
});

const ausgeblendet: ModulOverrides = {
  'wetter-pegel': {
    einsatz_id: 7,
    modul_key: 'wetter-pegel',
    sichtbar: false,
    benoetigte_rolle: null,
    geaendert_at: null,
    geaendert_von: null,
  },
};

const ereignisse: CustomEvent[] = [];
const merke = (ev: Event) => ereignisse.push(ev as CustomEvent);

beforeEach(() => window.addEventListener('lfh:unwetter-alarm', merke));
afterEach(() => {
  window.removeEventListener('lfh:unwetter-alarm', merke);
  ereignisse.length = 0;
  ton.mockReset();
  localStorage.clear();
});

const warteTakt = () => new Promise((r) => setTimeout(r, 30));

describe('useUnwetterHinweis', () => {
  it('meldet eine neue Unwetterwarnung genau einmal, mit dezentem Ton, ohne „mäßig"', async () => {
    const abrufe = liefere();
    renderHook(() => useUnwetterHinweis({ einsatzId: 7, benutzer, overrides: {} }), { wrapper });
    await waitFor(() => expect(ereignisse).toHaveLength(1));
    expect(ereignisse[0].detail).toMatchObject({
      schluessel: 'schwer|SCHWERES GEWITTER',
      titel: 'Unwetterwarnung',
    });
    expect(ereignisse[0].detail.beschreibung).toMatch(/^Schweres Gewitter, seit /);
    expect(ton).toHaveBeenCalledWith('dezent');
    expect(abrufe.anzahl).toBe(1);
  });

  it('nach einem Neuladen mit demselben Gedächtnis: kein weiterer Hinweis', async () => {
    liefere();
    const erster = renderHook(() => useUnwetterHinweis({ einsatzId: 7, benutzer, overrides: {} }), {
      wrapper,
    });
    await waitFor(() => expect(ereignisse).toHaveLength(1));
    erster.unmount();
    const abrufe = liefere();
    renderHook(() => useUnwetterHinweis({ einsatzId: 7, benutzer, overrides: {} }), { wrapper });
    await waitFor(() => expect(abrufe.anzahl).toBe(1));
    await warteTakt();
    expect(ereignisse).toHaveLength(1);
  });

  it('eine andere Person am selben Browser bekommt den Hinweis', async () => {
    liefere();
    const erster = renderHook(() => useUnwetterHinweis({ einsatzId: 7, benutzer, overrides: {} }), {
      wrapper,
    });
    await waitFor(() => expect(ereignisse).toHaveLength(1));
    erster.unmount();
    const andere = benutzerFixture({ id: benutzer.id + 1, anzeigename: 'F' });
    renderHook(() => useUnwetterHinweis({ einsatzId: 7, benutzer: andere, overrides: {} }), {
      wrapper,
    });
    await waitFor(() => expect(ereignisse).toHaveLength(2));
  });

  it('bei „Stand unbekannt" kein Hinweis', async () => {
    const abrufe = liefere(7 * STUNDE);
    renderHook(() => useUnwetterHinweis({ einsatzId: 7, benutzer, overrides: {} }), { wrapper });
    await waitFor(() => expect(abrufe.anzahl).toBe(1));
    await warteTakt();
    expect(ereignisse).toHaveLength(0);
    expect(ton).not.toHaveBeenCalled();
  });

  it('Modul ausgeblendet: keine Anfrage, kein Hinweis', async () => {
    const abrufe = liefere();
    renderHook(() => useUnwetterHinweis({ einsatzId: 7, benutzer, overrides: ausgeblendet }), {
      wrapper,
    });
    await warteTakt();
    expect(abrufe.anzahl).toBe(0);
    expect(ereignisse).toHaveLength(0);
  });

  it('solange die Modul-Overrides laden: keine Anfrage (kein 403 bei ausgeblendetem Modul)', async () => {
    const abrufe = liefere();
    renderHook(() => useUnwetterHinweis({ einsatzId: 7, benutzer, overrides: undefined }), {
      wrapper,
    });
    await warteTakt();
    expect(abrufe.anzahl).toBe(0);
  });

  it('fragt auch im Hintergrund-Tab nach — sonst griffe die Desktop-Meldung nie', async () => {
    liefere();
    renderHook(() => useUnwetterHinweis({ einsatzId: 7, benutzer, overrides: {} }), { wrapper });
    await waitFor(() => expect(ereignisse).toHaveLength(1));
    const query = client.getQueryCache().find({ queryKey: einsatzKeys.wetter(7) });
    expect(query?.observers.some((o) => o.options.refetchIntervalInBackground === true)).toBe(true);
  });
});
