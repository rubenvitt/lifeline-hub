import { describe, expect, it } from 'vitest';
import { http, HttpResponse } from 'msw';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { server } from '../test/server';
import { neuerQueryClient } from '../test/utils';
import { einsatzKeys } from '../api/queryKeys';
import type { BenutzerAnzeige, BetreuungUebersicht, ModulOverrides } from '../api/types';
import { useEvakuierungKennzahl } from './useEvakuierungKennzahl';

/**
 * Der Hook zur Kennzahl (LFH-639, design.md D9): die Hälfte, die die reine Funktion nicht
 * sehen kann — der Query-Zustand. Das tragende Paar steht nebeneinander: „kein Bezirk" ergibt
 * `daten` mit `kennzahl: null`, ein 500 ergibt `fehler` und NIE `kennzahl: null` (Spec:
 * „Ein fehlgeschlagener Abruf MUST als Fehler gelten und nie als ‚keine Kennzahl'").
 *
 * MSW statt `vi.mock` des Clients: nur der Handler belegt die URL mit, und der Zähler ist die
 * einzige Bauform, in der „kein Request" überhaupt prüfbar ist. `onUnhandledRequest: 'error'`
 * (`test/setup.ts`) bricht zusätzlich jeden unerwarteten Abruf.
 */

const benutzer: BenutzerAnzeige = {
  id: 1,
  anzeigename: 'E',
  benutzername: 'e',
  system_rolle: 'keiner',
  org_rolle: 'keine',
  aktiv: true,
  erstellt_at: '2026-09-23 08:00:00',
  totp_aktiviert: false,
};

const PFAD = '/api/einsaetze/7/betreuung';

const UEBERSICHT: BetreuungUebersicht = {
  bezirke: [
    {
      id: 1,
      einsatz_id: 7,
      bezeichnung: 'Uferstraße 12–40',
      plan_personen: 640,
      plan_erhebung: 'gezaehlt',
      raeumung: 'laeuft',
      flaechen: 0,
      angelegt_at: '2026-09-23 08:00:00',
      stand: {
        id: 5,
        evakuiert: 600,
        erhebung: 'gezaehlt',
        zeitpunkt_at: '2026-09-23 10:00:00',
      },
    },
  ],
  stellen: [],
};
const KENNZAHL = { evakuiert: 600, geplant: 640, bezirke: 1, ohneMeldung: 0, geschaetzt: false };

function wrapper(client: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}

function zaehleAbrufe(antwort: () => Response): { anzahl: number } {
  const zaehler = { anzahl: 0 };
  server.use(
    http.get(PFAD, () => {
      zaehler.anzahl += 1;
      return antwort();
    }),
  );
  return zaehler;
}

describe('useEvakuierungKennzahl', () => {
  it('kein Bezirk → Zustand `daten` mit `kennzahl: null` (keine geplante Evakuierung)', async () => {
    zaehleAbrufe(() => HttpResponse.json({ bezirke: [], stellen: [] }));
    const { result } = renderHook(() => useEvakuierungKennzahl({ einsatzId: 7, benutzer }), {
      wrapper: wrapper(neuerQueryClient()),
    });
    await waitFor(() => expect(result.current.zustand).toBe('daten'));
    expect(result.current).toEqual({ zustand: 'daten', kennzahl: null });
  });

  it('Abruffehler → Zustand `fehler`, nie `kennzahl: null`', async () => {
    zaehleAbrufe(() => HttpResponse.json({ error: 'kaputt' }, { status: 500 }));
    const { result } = renderHook(() => useEvakuierungKennzahl({ einsatzId: 7, benutzer }), {
      wrapper: wrapper(neuerQueryClient()),
    });
    await waitFor(() => expect(result.current.zustand).toBe('fehler'));
    expect(result.current).not.toHaveProperty('kennzahl');
  });

  it('ein Fehler hat Vorrang vor Altdaten im Cache — keine Kennzahl aus einem Stand, der vielleicht nicht mehr gilt (LFH-682)', async () => {
    // Plain `QueryClient` statt `neuerQueryClient()`: dessen `gcTime: 0` räumte den per
    // `setQueryData` gesetzten Eintrag weg, bevor der Hook ihn beobachtet (CLAUDE.md,
    // Query-Key-Registry) — dann gäbe es keine Altdaten, und der Test prüfte nur den
    // Fehlerfall ohne Cache, den der Test darüber schon abdeckt.
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.setQueryData(einsatzKeys.betreuung(7), UEBERSICHT);
    zaehleAbrufe(() => HttpResponse.json({ error: 'kaputt' }, { status: 500 }));
    const { result } = renderHook(() => useEvakuierungKennzahl({ einsatzId: 7, benutzer }), {
      wrapper: wrapper(client),
    });
    // Vorbedingung: die Altdaten sind wirklich da und wurden gelesen …
    expect(result.current).toEqual({ zustand: 'daten', kennzahl: KENNZAHL });
    // … der Neuabruf (Daten sind sofort veraltet, `staleTime` 0) scheitert …
    await waitFor(() => expect(result.current.zustand).toBe('fehler'));
    // … und die Daten stehen weiter im Cache. Genau diese Lage entscheidet der Hook.
    expect(client.getQueryData(einsatzKeys.betreuung(7))).toEqual(UEBERSICHT);
    expect(result.current).not.toHaveProperty('kennzahl');
  });

  it('lädt zuerst und liefert dann die Kennzahl aus der Übersicht', async () => {
    zaehleAbrufe(() => HttpResponse.json(UEBERSICHT));
    const { result } = renderHook(() => useEvakuierungKennzahl({ einsatzId: 7, benutzer }), {
      wrapper: wrapper(neuerQueryClient()),
    });
    expect(result.current).toEqual({ zustand: 'laden' });
    await waitFor(() => expect(result.current.zustand).toBe('daten'));
    expect(result.current).toEqual({ zustand: 'daten', kennzahl: KENNZAHL });
  });

  it('lädt NICHT bei ausgeblendetem Modul — kein Abruf, Zustand `aus` (weder fehler noch null)', async () => {
    const abrufe = zaehleAbrufe(() => HttpResponse.json({ bezirke: [], stellen: [] }));
    const versteckt: ModulOverrides = {
      betreuung: {
        einsatz_id: 7,
        modul_key: 'betreuung',
        sichtbar: false,
        benoetigte_rolle: null,
        geaendert_at: null,
        geaendert_von: null,
      },
    };
    const { result } = renderHook(
      () => useEvakuierungKennzahl({ einsatzId: 7, benutzer, overrides: versteckt }),
      { wrapper: wrapper(neuerQueryClient()) },
    );
    // Einen Tick Zeit lassen, damit ein fälschlich aktivierter Abruf den Handler erreicht.
    await new Promise((r) => setTimeout(r, 20));
    expect(abrufe.anzahl).toBe(0);
    expect(result.current).toEqual({ zustand: 'aus' });
  });

  it('lädt NICHT bei rollen-gesperrtem Modul', async () => {
    const abrufe = zaehleAbrufe(() => HttpResponse.json({ bezirke: [], stellen: [] }));
    const gesperrt: ModulOverrides = {
      betreuung: {
        einsatz_id: 7,
        modul_key: 'betreuung',
        sichtbar: true,
        benoetigte_rolle: 'fuehrungskraft',
        geaendert_at: null,
        geaendert_von: null,
      },
    };
    const { result } = renderHook(
      () => useEvakuierungKennzahl({ einsatzId: 7, benutzer, overrides: gesperrt }),
      { wrapper: wrapper(neuerQueryClient()) },
    );
    await new Promise((r) => setTimeout(r, 20));
    expect(abrufe.anzahl).toBe(0);
    expect(result.current).toEqual({ zustand: 'aus' });
  });

  it('`bereit: false` (Freigaben noch unbekannt) → `laden` OHNE Abruf, danach entscheidet das Recht (LFH-607)', async () => {
    // Ohne diesen Riegel liefe der Abruf, bevor die Overrides da sind — bei ausgeblendetem
    // Modul ein 403, den der Zähler gerade vermeiden soll.
    const abrufe = zaehleAbrufe(() => HttpResponse.json({ bezirke: [], stellen: [] }));
    const { result, rerender } = renderHook(
      ({ bereit }: { bereit: boolean }) =>
        useEvakuierungKennzahl({ einsatzId: 7, benutzer, bereit }),
      { wrapper: wrapper(neuerQueryClient()), initialProps: { bereit: false } },
    );
    await new Promise((r) => setTimeout(r, 20));
    expect(abrufe.anzahl).toBe(0);
    expect(result.current).toEqual({ zustand: 'laden' });

    rerender({ bereit: true });
    await waitFor(() => expect(result.current.zustand).toBe('daten'));
    expect(abrufe.anzahl).toBe(1);
  });
});
