import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  queueKanalZuruecksetzenFuerTests,
  queueLeerenFuerTests,
  schreibaktionAblehnen,
  schreibaktionEinreihen,
  schreibaktionenLaden,
} from './queue';
import { useVorgemerkteEintreffen } from './useVorgemerkteSchreibaktionen';

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
