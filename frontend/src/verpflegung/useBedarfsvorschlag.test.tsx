import { afterEach, describe, expect, it, vi } from 'vitest';
import { http, HttpResponse } from 'msw';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClientProvider, type QueryClient } from '@tanstack/react-query';
import dayjs from 'dayjs';
import type { ReactNode } from 'react';
import { server } from '../test/server';
import { neuerQueryClient } from '../test/utils';
import { erzeugeQueryClient } from '../api/queryClient';
import type {
  BelegungKopfzahl,
  BenutzerAnzeige,
  EinsatzPersonal,
  ModulOverrides,
} from '../api/types';
import { useBedarfsvorschlag, type BedarfsvorschlagArgs } from './useBedarfsvorschlag';

/**
 * Bedarfsvorschläge (LFH-634, design.md D8; Spec „Bedarfsvorschläge aus Personal und
 * Betreuung“). Geprüft am Draht: was angefragt wird (Aufrufzähler), was vorbelegt wird und
 * was als Hinweis dasteht. Ein Test der reinen Freigabe-Prüfung sähe nicht, ob sie an der
 * `useQuery` ankommt.
 */

const benutzer: BenutzerAnzeige = {
  id: 1,
  anzeigename: 'E',
  benutzername: 'e',
  system_rolle: 'keiner',
  org_rolle: 'keine',
  aktiv: true,
  erstellt_at: '2026-09-24 08:00:00',
  totp_aktiviert: false,
};

const P_PERSONAL = '/api/einsaetze/7/personal';
const P_KOPFZAHL = '/api/einsaetze/7/betreuung/belegung';

/** Beginn 10:00 UTC (12:00 in Berlin), jetzt 10:30 UTC → hat begonnen. */
const VON = '2026-09-24 10:00:00';
const JETZT_NACH_BEGINN = dayjs('2026-09-24T10:30:00Z');

function override(
  modul_key: string,
  teil: { sichtbar?: boolean; benoetigte_rolle?: 'fuehrungskraft' | null },
): ModulOverrides[string] {
  return {
    einsatz_id: 7,
    modul_key,
    sichtbar: teil.sichtbar ?? true,
    benoetigte_rolle: teil.benoetigte_rolle ?? null,
    geaendert_at: null,
    geaendert_von: null,
  };
}

function personal(n: number): EinsatzPersonal[] {
  return Array.from({ length: n }, (_, i) => ({
    id: i + 1,
    einsatz_id: 7,
    name: `Kraft ${i + 1}`,
    ist_adhoc: false,
    disponiert_at: '2026-09-24 08:00:00',
    // Ohne Position: `verdichte` zählt die Zeile trotzdem einmal (Rückfall Mannschaft).
    staerke_position: i % 3 === 0 ? 'fuehrer' : null,
  }));
}

function kopfzahl(teil: Partial<BelegungKopfzahl>): BelegungKopfzahl {
  return { zeitpunkt_at: VON, summe: 0, stellen_ohne_meldung: 0, stellen: [], ...teil };
}

interface Zaehler {
  personal: number;
  kopfzahl: number;
  zeitpunkte: (string | null)[];
}

function antworte(
  personalAntwort: EinsatzPersonal[] | 403,
  kopfzahlAntwort: BelegungKopfzahl | 403,
): Zaehler {
  const z: Zaehler = { personal: 0, kopfzahl: 0, zeitpunkte: [] };
  server.use(
    http.get(P_PERSONAL, () => {
      z.personal += 1;
      return personalAntwort === 403
        ? HttpResponse.json({ error: 'Kein Zugriff' }, { status: 403 })
        : HttpResponse.json(personalAntwort);
    }),
    http.get(P_KOPFZAHL, ({ request }) => {
      z.kopfzahl += 1;
      z.zeitpunkte.push(new URL(request.url).searchParams.get('zeitpunkt'));
      return kopfzahlAntwort === 403
        ? HttpResponse.json({ error: 'Kein Zugriff' }, { status: 403 })
        : HttpResponse.json(kopfzahlAntwort);
    }),
  );
  return z;
}

function wrapper(client: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}

function rendere(args: Partial<BedarfsvorschlagArgs> = {}, client = neuerQueryClient()) {
  return renderHook(
    () =>
      useBedarfsvorschlag({
        einsatzId: 7,
        vonAt: VON,
        benutzer,
        overrides: {},
        jetzt: JETZT_NACH_BEGINN,
        ...args,
      }),
    { wrapper: wrapper(client) },
  );
}

/** Einen Takt warten, damit ein fälschlich aktiver Abruf ankäme. */
const einTakt = () => new Promise((r) => setTimeout(r, 30));

afterEach(() => {
  vi.restoreAllMocks();
});

describe('useBedarfsvorschlag — Vorschlag aus beiden Quellen', () => {
  it('186 Personen im Personal und 70 in Betreuung stehen vorbelegt, je mit Herkunft', async () => {
    const z = antworte(
      personal(186),
      kopfzahl({
        summe: 70,
        stellen: [
          { stelle_id: 1, bezeichnung: 'Turnhalle Ost', belegt: 50, zeitpunkt_at: VON },
          { stelle_id: 2, bezeichnung: 'Schule', belegt: 20, zeitpunkt_at: VON },
        ],
      }),
    );
    const { result } = rendere();
    await waitFor(() => expect(result.current.kraefte.wert).toBe(186));
    await waitFor(() => expect(result.current.betreute.wert).toBe(70));
    expect(result.current.kraefte.hinweis).toMatch(
      /^Vorschlag: Personal im Einsatz, Stand \d\d:\d\d$/,
    );
    expect(result.current.betreute.hinweis).toBe('Vorschlag: in Betreuung zum Beginn');
    // Der Stichtag der Kopfzahl ist der Beginn als Wire-String (UTC ohne Zonenkennung).
    expect(z.zeitpunkte).toEqual([VON]);
    expect(z.personal).toBe(1);
  });

  it('leeres Personal ergibt keinen Vorschlag statt 0', async () => {
    const z = antworte([], kopfzahl({}));
    const { result } = rendere();
    await waitFor(() => expect(z.personal).toBe(1));
    await einTakt();
    expect(result.current.kraefte).toEqual({ wert: null, hinweis: null });
  });
});

describe('useBedarfsvorschlag — Betreuung ohne Meldung', () => {
  it('keine Betreuungsstelle: Feld leer, Hinweis „keine Belegung gemeldet“', async () => {
    antworte(personal(3), kopfzahl({ stellen: [] }));
    const { result } = rendere();
    await waitFor(() => expect(result.current.betreute.hinweis).toBe('keine Belegung gemeldet'));
    expect(result.current.betreute.wert).toBeNull();
  });

  it('Stellen vorhanden, aber keine hat gemeldet: ebenfalls leer, nicht 0', async () => {
    // `stellen` führt auch Stellen OHNE Meldung (`src/betreuung/repo.rs`, `belegt` fehlt) —
    // `summe = 0` heißt hier „nichts gemeldet“, nicht „niemand in Betreuung“.
    antworte(
      personal(3),
      kopfzahl({
        summe: 0,
        stellen_ohne_meldung: 2,
        stellen: [
          { stelle_id: 1, bezeichnung: 'Turnhalle Ost' },
          { stelle_id: 2, bezeichnung: 'Schule' },
        ],
      }),
    );
    const { result } = rendere();
    await waitFor(() => expect(result.current.betreute.hinweis).toBe('keine Belegung gemeldet'));
    expect(result.current.betreute.wert).toBeNull();
  });

  it('eine gemeldete 0 ist ein Wert, kein leeres Feld', async () => {
    antworte(
      personal(3),
      kopfzahl({
        summe: 0,
        stellen: [{ stelle_id: 1, bezeichnung: 'Turnhalle Ost', belegt: 0, zeitpunkt_at: VON }],
      }),
    );
    const { result } = rendere();
    await waitFor(() => expect(result.current.betreute.wert).toBe(0));
    expect(result.current.betreute.hinweis).toBe('Vorschlag: in Betreuung zum Beginn');
  });
});

describe('useBedarfsvorschlag — Kopfzahl ist eine Untergrenze', () => {
  it('mit Stellen ohne Meldung trägt der Vorschlag den Hinweis „Untergrenze“', async () => {
    antworte(
      personal(3),
      kopfzahl({
        summe: 40,
        stellen_ohne_meldung: 2,
        stellen: [
          { stelle_id: 1, bezeichnung: 'Turnhalle Ost', belegt: 40, zeitpunkt_at: VON },
          { stelle_id: 2, bezeichnung: 'Schule' },
          { stelle_id: 3, bezeichnung: 'Gemeindehaus' },
        ],
      }),
    );
    const { result } = rendere();
    await waitFor(() => expect(result.current.betreute.wert).toBe(40));
    expect(result.current.betreute.hinweis).toBe(
      'Vorschlag: in Betreuung zum Beginn · Untergrenze, 2 Stellen ohne Meldung',
    );
  });

  it('eine einzelne Stelle ohne Meldung steht im Singular', async () => {
    antworte(
      personal(3),
      kopfzahl({
        summe: 40,
        stellen_ohne_meldung: 1,
        stellen: [
          { stelle_id: 1, bezeichnung: 'Turnhalle Ost', belegt: 40, zeitpunkt_at: VON },
          { stelle_id: 2, bezeichnung: 'Schule' },
        ],
      }),
    );
    const { result } = rendere();
    await waitFor(() => expect(result.current.betreute.wert).toBe(40));
    expect(result.current.betreute.hinweis).toContain('Untergrenze, 1 Stelle ohne Meldung');
  });
});

describe('useBedarfsvorschlag — Zeitfenster in der Zukunft', () => {
  const MIT_MELDUNG = kopfzahl({
    summe: 70,
    stellen: [{ stelle_id: 1, bezeichnung: 'Turnhalle Ost', belegt: 70, zeitpunkt_at: VON }],
  });

  it('beginnt es nach jetzt, zeigt der Vorschlag den heutigen Stand und sagt das', async () => {
    antworte(personal(3), MIT_MELDUNG);
    const { result } = rendere({ jetzt: dayjs('2026-09-24T09:59:59Z') });
    await waitFor(() => expect(result.current.betreute.wert).toBe(70));
    expect(result.current.betreute.hinweis).toBe(
      'Vorschlag: in Betreuung, Stand jetzt, nicht zum Beginn',
    );
  });

  it('genau zum Beginn ist es nicht mehr Zukunft', async () => {
    antworte(personal(3), MIT_MELDUNG);
    const { result } = rendere({ jetzt: dayjs('2026-09-24T10:00:00Z') });
    await waitFor(() => expect(result.current.betreute.wert).toBe(70));
    expect(result.current.betreute.hinweis).toBe('Vorschlag: in Betreuung zum Beginn');
  });

  it('liest den Beginn als UTC: 11:59 in Berlin (UTC+2) liegt VOR 10:00 UTC', async () => {
    antworte(personal(3), MIT_MELDUNG);
    const { result } = rendere({ jetzt: dayjs('2026-09-24T11:59:00+02:00') });
    await waitFor(() => expect(result.current.betreute.wert).toBe(70));
    expect(result.current.betreute.hinweis).toContain('Stand jetzt, nicht zum Beginn');
  });
});

describe('useBedarfsvorschlag — Quelle nicht zugänglich', () => {
  it('Betreuung ausgeblendet: keine Anfrage an die Kopfzahl, Feld ohne Vorschlag', async () => {
    const z = antworte(personal(5), kopfzahl({ summe: 70 }));
    const { result } = rendere({
      overrides: { betreuung: override('betreuung', { sichtbar: false }) },
    });
    // Gemischter Fall: Personal ist frei und wird genau einmal gefragt.
    await waitFor(() => expect(result.current.kraefte.wert).toBe(5));
    await einTakt();
    expect(z.kopfzahl).toBe(0);
    expect(z.personal).toBe(1);
    expect(result.current.betreute).toEqual({ wert: null, hinweis: null });
  });

  it('Betreuung per Rolle gesperrt: ebenfalls keine Anfrage', async () => {
    const z = antworte(personal(5), kopfzahl({ summe: 70 }));
    const { result } = rendere({
      overrides: { betreuung: override('betreuung', { benoetigte_rolle: 'fuehrungskraft' }) },
    });
    await waitFor(() => expect(result.current.kraefte.wert).toBe(5));
    await einTakt();
    expect(z.kopfzahl).toBe(0);
    expect(result.current.betreute).toEqual({ wert: null, hinweis: null });
  });

  it('Personal ausgeblendet: keine Anfrage an das Personal', async () => {
    const z = antworte(personal(5), kopfzahl({}));
    const { result } = rendere({
      overrides: { personal: override('personal', { sichtbar: false }) },
    });
    await waitFor(() => expect(z.kopfzahl).toBe(1));
    await einTakt();
    expect(z.personal).toBe(0);
    expect(result.current.kraefte).toEqual({ wert: null, hinweis: null });
  });

  it('Personal per Rolle gesperrt: keine Anfrage an das Personal', async () => {
    const z = antworte(personal(5), kopfzahl({}));
    rendere({
      overrides: { personal: override('personal', { benoetigte_rolle: 'fuehrungskraft' }) },
    });
    await waitFor(() => expect(z.kopfzahl).toBe(1));
    await einTakt();
    expect(z.personal).toBe(0);
  });

  it('Freigaben noch unbekannt (`overrides` undefined): keine der beiden Quellen wird gefragt', async () => {
    const z = antworte(personal(5), kopfzahl({ summe: 70 }));
    const { result } = rendere({ overrides: undefined });
    await einTakt();
    expect(z).toMatchObject({ personal: 0, kopfzahl: 0 });
    expect(result.current).toEqual({
      kraefte: { wert: null, hinweis: null },
      betreute: { wert: null, hinweis: null },
    });
  });

  it('403 trotz Freigabe: Felder leer, keine Fehlermeldung, kein Wiederholungsversuch', async () => {
    const fehlerAusgabe = vi.spyOn(console, 'error');
    const z = antworte(403, 403);
    // Ein Client, der wiederholen WÜRDE — mit `neuerQueryClient()` (retry: false global) wäre
    // der Zähler auch ohne `retry: false` am Hook bei 1 und belegte nichts.
    const client = erzeugeQueryClient({ queries: { retry: 2, retryDelay: 0, gcTime: 0 } });
    const { result } = rendere({}, client);
    await waitFor(() => expect(z).toMatchObject({ personal: 1, kopfzahl: 1 }));
    await new Promise((r) => setTimeout(r, 60));
    expect(z).toMatchObject({ personal: 1, kopfzahl: 1 });
    expect(result.current).toEqual({
      kraefte: { wert: null, hinweis: null },
      betreute: { wert: null, hinweis: null },
    });
    expect(fehlerAusgabe).not.toHaveBeenCalled();
  });
});
