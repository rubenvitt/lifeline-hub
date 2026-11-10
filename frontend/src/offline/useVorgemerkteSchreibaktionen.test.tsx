import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import type { SpiegelAntragAnzeige } from '../api/types';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  queueKanalZuruecksetzenFuerTests,
  queueLeerenFuerTests,
  schreibaktionAblehnen,
  schreibaktionEinreihen,
  schreibaktionenLaden,
} from './queue';
import {
  useVorgemerktePersonEintraege,
  useVorgemerkteEintreffen,
} from './useVorgemerkteSchreibaktionen';

const eintreffen = (br_id: number, client_id: string) => ({
  art: 'eintreffen' as const,
  br_id,
  bezeichnung: 'BR Sportplatz',
  name: 'HLF 20',
  daten: { kraft: { objekt_typ: 'einheit' as const, objekt_id: 30 }, client_id },
});

beforeEach(async () => {
  await queueLeerenFuerTests();
});
afterEach(() => {
  queueKanalZuruecksetzenFuerTests();
});

describe('useVorgemerkteEintreffen (LLH-1075 Teil III)', () => {
  it('zeigt nur die ausstehenden Eintreffen des Benutzers im Einsatz und folgt der Queue', async () => {
    await schreibaktionEinreihen(11, 7, eintreffen(4, 'eigen'));
    await schreibaktionEinreihen(11, 7, eintreffen(5, 'anderer-raum'));
    await schreibaktionEinreihen(11, 8, eintreffen(4, 'anderer-einsatz'));
    await schreibaktionEinreihen(22, 7, eintreffen(4, 'anderer-benutzer'));
    await schreibaktionEinreihen(11, 7, {
      art: 'belegung',
      stelle_id: 4,
      bezeichnung: 'Turnhalle',
      daten: { belegt: 3 },
    });

    const { result } = renderHook(() => useVorgemerkteEintreffen(11, 7));
    await waitFor(() =>
      expect(result.current.map((v) => v.aktion.daten.client_id)).toEqual([
        'eigen',
        'anderer-raum',
      ]),
    );

    // Eine Ablehnung gehört in den Wiederherstellungsbereich, nicht als „vorgemerkt“ an den Raum.
    const [erste] = await schreibaktionenLaden(11, 7);
    await schreibaktionAblehnen(11, erste, 'Bereitstellungsraum ist nicht aktiv');
    await waitFor(() =>
      expect(result.current.map((v) => v.aktion.daten.client_id)).toEqual(['anderer-raum']),
    );
  });

  it('ohne Benutzer bleibt die Liste leer', async () => {
    await schreibaktionEinreihen(11, 7, eintreffen(4, 'eigen'));
    const { result } = renderHook(() => useVorgemerkteEintreffen(undefined, 7));
    await new Promise((r) => setTimeout(r, 20));
    expect(result.current).toEqual([]);
  });
});

describe('useVorgemerktePersonEintraege (LLH-1138, design.md D8)', () => {
  it('zeigt alle vorgemerkten Einträge an Personen des Einsatzes, keine anderen Arten', async () => {
    await schreibaktionEinreihen(11, 7, {
      art: 'sichtung',
      person_id: 10,
      bezeichnung: 'R-012',
      daten: { kategorie: 'sk1', client_id: 's-1' },
    });
    await schreibaktionEinreihen(11, 7, {
      art: 'notiz',
      person_id: 11,
      bezeichnung: 'R-013',
      daten: { text: 'Infusion läuft', client_id: 'n-1' },
    });
    await schreibaktionEinreihen(11, 7, eintreffen(4, 'kein-personeneintrag'));
    await schreibaktionEinreihen(11, 8, {
      art: 'verbleib',
      person_id: 10,
      bezeichnung: 'R-012',
      daten: { art: 'transport', client_id: 'anderer-einsatz' },
    });

    const { result } = renderHook(() => useVorgemerktePersonEintraege(11, 7));
    await waitFor(() =>
      expect(result.current.map((v) => [v.aktion.art, v.aktion.person_id])).toEqual([
        ['sichtung', 10],
        ['notiz', 11],
      ]),
    );
  });
});

describe('Anträge am Spiegel stehen bei den vorgemerkten (LLH-1492, design.md D13)', () => {
  function mitAntraegen(antraege: SpiegelAntragAnzeige[]) {
    const qc = new QueryClient();
    qc.setQueryData(['einsatz-antraege', 7], antraege);
    return {
      qc,
      wrapper: ({ children }: { children: ReactNode }) => (
        <QueryClientProvider client={qc}>{children}</QueryClientProvider>
      ),
    };
  }
  const antrag = (
    id: number,
    art: string,
    zustand: string,
    ziel: Record<string, unknown>,
    daten: Record<string, unknown>,
  ) =>
    ({
      id,
      art,
      zustand,
      ziel,
      daten,
      erfasst_at: '2026-11-10 08:00:00',
    }) as unknown as SpiegelAntragAnzeige;

  it('nimmt offene Anträge derselben Art dazu, mit lokalem Ziel, ohne abgelehnte', async () => {
    await schreibaktionEinreihen(11, 7, {
      art: 'sichtung',
      person_id: 10,
      bezeichnung: 'R-012',
      daten: { kategorie: 'sk1', client_id: 's-1' },
    });
    const { wrapper } = mitAntraegen([
      antrag(1, 'sichtung', 'ausstehend', { pid: 12 }, { kategorie: 'sk2', client_id: 'a-1' }),
      antrag(2, 'notiz', 'abgelehnt', { pid: 12 }, { text: 'x', client_id: 'a-2' }),
      antrag(3, 'eintreffen', 'ausstehend', { bid: 4 }, { client_id: 'a-3' }),
      antrag(4, 'notiz', 'uebernommen', { pid: 13 }, { text: 'y', client_id: 'a-4' }),
    ]);
    const { result } = renderHook(() => useVorgemerktePersonEintraege(11, 7), { wrapper });
    await waitFor(() =>
      expect(
        result.current.map((v) => [v.aktion.art, v.aktion.person_id, v.antrag?.id ?? null]),
      ).toEqual([
        ['sichtung', 10, null],
        ['sichtung', 12, 1],
        ['notiz', 13, 4],
      ]),
    );
  });

  it('lässt Verweise auf Zeilen der führenden Instanz weg', async () => {
    const { wrapper } = mitAntraegen([
      antrag(
        5,
        'eintreffen',
        'ausstehend',
        { bid: 4 },
        { client_id: 'a-5', kraft: { objekt_typ: 'einheit', objekt_id: 999 } },
      ),
    ]);
    const { result } = renderHook(() => useVorgemerkteEintreffen(11, 7), { wrapper });
    await waitFor(() => expect(result.current).toHaveLength(1));
    expect(result.current[0].aktion.br_id).toBe(4);
    expect(result.current[0].aktion.daten).toEqual({ client_id: 'a-5' });
  });

  it('folgt dem Cache: ein übernommener Antrag verschwindet mit der neuen Liste', async () => {
    const { qc, wrapper } = mitAntraegen([
      antrag(6, 'eintreffen', 'ausstehend', { bid: 4 }, { client_id: 'a-6' }),
    ]);
    const { result } = renderHook(() => useVorgemerkteEintreffen(11, 7), { wrapper });
    await waitFor(() => expect(result.current).toHaveLength(1));
    act(() => qc.setQueryData(['einsatz-antraege', 7], []));
    await waitFor(() => expect(result.current).toEqual([]));
  });
});
