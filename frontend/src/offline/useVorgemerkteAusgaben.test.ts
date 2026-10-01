import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  QUEUE_KANAL,
  queueKanalZuruecksetzenFuerTests,
  queueLeerenFuerTests,
  schreibaktionAblehnen,
  schreibaktionEinreihen,
  schreibaktionEntfernen,
  schreibaktionenLaden,
} from './queue';
import { useVorgemerkteAusgaben } from './useVorgemerkteAusgaben';

const ausgabe = (zeitfenster_id: number, client_id: string) => ({
  art: 'ausgabe' as const,
  zeitfenster_id,
  bezeichnung: 'Mittag',
  daten: { menge: 120, zeitpunkt_at: '2026-09-24 09:40:00', client_id },
});

beforeEach(async () => {
  await queueLeerenFuerTests();
});
afterEach(() => {
  queueKanalZuruecksetzenFuerTests();
  vi.restoreAllMocks();
});

describe('useVorgemerkteAusgaben (LFH-688)', () => {
  it('zeigt die vorgemerkten Ausgaben des Benutzers im Einsatz und folgt der Queue', async () => {
    await schreibaktionEinreihen(11, 7, ausgabe(9, 'eigen'));
    await schreibaktionEinreihen(11, 8, ausgabe(9, 'anderer-einsatz'));
    await schreibaktionEinreihen(22, 7, ausgabe(9, 'anderer-benutzer'));
    await schreibaktionEinreihen(11, 7, {
      art: 'belegung',
      stelle_id: 4,
      bezeichnung: 'Turnhalle',
      daten: { belegt: 3 },
    });

    const { result } = renderHook(() => useVorgemerkteAusgaben(11, 7));
    await waitFor(() =>
      expect(result.current.map((a) => a.aktion.daten.client_id)).toEqual(['eigen']),
    );
    expect(result.current[0].aktion.zeitfenster_id).toBe(9);

    await schreibaktionEinreihen(11, 7, ausgabe(10, 'zweite'));
    await waitFor(() => expect(result.current).toHaveLength(2));

    const [erste] = await schreibaktionenLaden(11, 7);
    await schreibaktionEntfernen(11, erste.id!);
    await waitFor(() =>
      expect(result.current.map((a) => a.aktion.daten.client_id)).toEqual(['zweite']),
    );
  });

  it('zeigt abgelehnte Ausgaben nicht als ausstehend', async () => {
    await schreibaktionEinreihen(11, 7, ausgabe(9, 'abgelehnt'));
    const { result } = renderHook(() => useVorgemerkteAusgaben(11, 7));
    await waitFor(() => expect(result.current).toHaveLength(1));
    const [zeile] = await schreibaktionenLaden(11, 7);
    await schreibaktionAblehnen(11, zeile, 'Nicht gefunden');
    await waitFor(() => expect(result.current).toHaveLength(0));
  });

  it('folgt auch einem Flush in einem anderen Tab (BroadcastChannel)', async () => {
    await schreibaktionEinreihen(11, 7, ausgabe(9, 'anderer-tab'));
    const { result } = renderHook(() => useVorgemerkteAusgaben(11, 7));
    await waitFor(() => expect(result.current).toHaveLength(1));

    // Der andere Tab entfernt die Zeile: hier kommt kein lokales Fenster-Ereignis an …
    const lokal = vi.spyOn(window, 'dispatchEvent').mockImplementation(() => true);
    const [zeile] = await schreibaktionenLaden(11, 7);
    await schreibaktionEntfernen(11, zeile.id!);
    lokal.mockRestore();
    await new Promise((r) => setTimeout(r, 20));
    expect(result.current).toHaveLength(1);

    // … nur sein datenloses Signal über den Kanal.
    const andererTab = new BroadcastChannel(QUEUE_KANAL);
    andererTab.postMessage({ typ: 'queue-geaendert' });
    await waitFor(() => expect(result.current).toHaveLength(0));
    andererTab.close();
  });

  it('liefert ohne Benutzer nichts', async () => {
    await schreibaktionEinreihen(11, 7, ausgabe(9, 'eigen'));
    const { result } = renderHook(() => useVorgemerkteAusgaben(undefined, 7));
    await new Promise((r) => setTimeout(r, 20));
    expect(result.current).toEqual([]);
  });
});
