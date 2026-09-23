import { describe, expect, it } from 'vitest';
import { http, HttpResponse } from 'msw';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClientProvider, type QueryClient } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { server } from '../test/server';
import { neuerQueryClient } from '../test/utils';
import type { BenutzerAnzeige, ModulOverrides } from '../api/types';
import { useModulZaehler } from './useModulZaehler';

/**
 * Der Hook des Modulzählers am Draht (LFH-639, Prüfliste Tabelle 3 „Sichtbarkeit"). Der Test
 * der reinen Funktion `darfZaehlerZeigen` in `useModulZaehler.test.ts` sieht NICHT, ob die
 * Entscheidung an der `useQuery` ankommt — fiele `enabled: betreuungAktiv` weg, bliebe er grün,
 * und die Navigation fragte ein verstecktes Modul ab (403-Rauschen, Seitenkanal). Deshalb hier
 * der MSW-Anfragezähler als Paar: versteckt → 0 Anfragen, sichtbar → genau 1.
 *
 * Die anderen Zählermodule sind in beiden Fällen ausgeblendet, damit der Test keine fremden
 * Module mitprüft; die Serverabfrage `modul-zaehler` (LFH-612) beantwortet der Vorgabe-Handler
 * aus `test/server.ts`.
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

const ANDERE = ['meldungen', 'auftraege', 'erinnerungen', 'chat', 'dokumente', 'abloesung'];

function ausgeblendet(keys: readonly string[]): ModulOverrides {
  return Object.fromEntries(
    keys.map((modul_key) => [
      modul_key,
      {
        einsatz_id: 7,
        modul_key,
        sichtbar: false,
        benoetigte_rolle: null,
        geaendert_at: null,
        geaendert_von: null,
      },
    ]),
  );
}

function wrapper(client: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}

function zaehleAbrufe(): { anzahl: number } {
  const zaehler = { anzahl: 0 };
  server.use(
    http.get(PFAD, () => {
      zaehler.anzahl += 1;
      return HttpResponse.json({
        bezirke: [
          {
            id: 1,
            einsatz_id: 7,
            bezeichnung: 'Uferstraße 12–40',
            plan_personen: 640,
            plan_erhebung: 'gezaehlt',
            raeumung: 'laeuft',
            angelegt_at: '2026-09-23 08:00:00',
          },
        ],
        stellen: [],
      });
    }),
  );
  return zaehler;
}

describe('useModulZaehler am Draht — Betreuung (LFH-639)', () => {
  it('Modul ausgeblendet → keine Anfrage an …/betreuung, kein Zähler', async () => {
    const abrufe = zaehleAbrufe();
    const { result } = renderHook(
      () =>
        useModulZaehler({
          einsatzId: 7,
          benutzer,
          overrides: ausgeblendet([...ANDERE, 'betreuung']),
        }),
      { wrapper: wrapper(neuerQueryClient()) },
    );
    // Wie im Kennzahl-Hook: einen Takt warten, damit ein fälschlich aktiver Abruf ankäme.
    await new Promise((r) => setTimeout(r, 20));
    expect(abrufe.anzahl).toBe(0);
    expect(result.current.betreuung).toBeUndefined();
  });

  it('Modul sichtbar → genau eine Anfrage, Zähler der aktiven Bezirke', async () => {
    const abrufe = zaehleAbrufe();
    const { result } = renderHook(
      () => useModulZaehler({ einsatzId: 7, benutzer, overrides: ausgeblendet(ANDERE) }),
      { wrapper: wrapper(neuerQueryClient()) },
    );
    await waitFor(() => expect(result.current.betreuung).toBeDefined());
    expect(result.current.betreuung).toEqual({
      wert: 1,
      beschreibung: '1 aktiver Evakuierungsbezirk',
    });
    expect(abrufe.anzahl).toBe(1);
  });
});
