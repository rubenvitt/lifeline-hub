import { beforeEach, describe, expect, it } from 'vitest';
import type { NeuerEintrag } from '../api/etb';
import {
  abgelehntLaden,
  abgelehntWiederholen,
  queueAblehnen,
  queueAlleLaden,
  queueEinreihen,
  queueLaden,
  queueLegacyEinreihenFuerTests,
  queueLeerenFuerTests,
  queueNichtZugeordnetAlleVerwerfen,
  queueNichtZugeordnetZaehlen,
  queueZaehlerLaden,
  schreibaktionAblehnen,
  schreibaktionAbgelehntVerwerfen,
  schreibaktionAbgelehntWiederholen,
  schreibaktionEinreihen,
  schreibaktionenAbgelehntLaden,
  schreibaktionenLaden,
} from './queue';

const BENUTZER_A = 11;
const BENUTZER_B = 22;
const eintrag: NeuerEintrag = { typ: 'meldung', inhalt: 'x' };

beforeEach(async () => {
  await queueLeerenFuerTests();
});

describe('benutzergebundene Offline-Queue (LFH-334)', () => {
  it('mintet eine fehlende client_id, überschreibt eine vorgegebene aber nicht', async () => {
    await queueEinreihen(BENUTZER_A, 7, eintrag);
    await queueEinreihen(BENUTZER_A, 7, { ...eintrag, client_id: 'vorgegeben-1' });

    const [gemintet, vorgegeben] = await queueLaden(BENUTZER_A, 7);
    expect(gemintet.eintrag.client_id).toBeTruthy();
    expect(vorgegeben.eintrag.client_id).toBe('vorgegeben-1');
  });

  it('filtert Pending, Zähler und globalen Flush strikt nach Benutzer und Einsatz', async () => {
    await queueEinreihen(BENUTZER_A, 7, { ...eintrag, client_id: 'a-7' });
    await queueEinreihen(BENUTZER_A, 8, { ...eintrag, client_id: 'a-8' });
    await queueEinreihen(BENUTZER_B, 7, { ...eintrag, client_id: 'b-7' });
    await schreibaktionEinreihen(BENUTZER_A, 7, {
      art: 'person',
      daten: { name: 'Muster', status: 'vermisst', client_id: 'person-a' },
    });

    expect((await queueLaden(BENUTZER_A, 7)).map((wert) => wert.eintrag.client_id)).toEqual([
      'a-7',
    ]);
    expect((await queueAlleLaden(BENUTZER_A)).map((wert) => wert.eintrag.client_id)).toEqual([
      'a-7',
      'a-8',
    ]);
    expect(await queueZaehlerLaden(BENUTZER_A, 7)).toEqual({
      ausstehend: 2,
      abgelehnt: 0,
      nicht_zugeordnet: 0,
    });
    expect(await queueZaehlerLaden(BENUTZER_B, 7)).toEqual({
      ausstehend: 1,
      abgelehnt: 0,
      nicht_zugeordnet: 0,
    });
  });

  it('verschiebt ETB-Ablehnungen atomar und lässt nur den Eigentümer wiederholen', async () => {
    await queueEinreihen(BENUTZER_A, 7, { ...eintrag, client_id: 'etb-a' });
    const [pending] = await queueLaden(BENUTZER_A, 7);

    expect(await queueAblehnen(BENUTZER_B, pending, 'Fremd')).toBe(false);
    expect(await queueAblehnen(BENUTZER_A, pending, 'Keine Berechtigung')).toBe(true);
    expect(await queueLaden(BENUTZER_A, 7)).toHaveLength(0);
    const [abgelehnt] = await abgelehntLaden(BENUTZER_A, 7);
    expect(abgelehnt).toMatchObject({
      benutzer_id: BENUTZER_A,
      grund: 'Keine Berechtigung',
      eintrag: { client_id: 'etb-a' },
    });

    expect(await abgelehntWiederholen(BENUTZER_B, abgelehnt.id!)).toBe(false);
    expect(await abgelehntWiederholen(BENUTZER_A, abgelehnt.id!)).toBe(true);
    expect(await abgelehntLaden(BENUTZER_A, 7)).toHaveLength(0);
    expect(await queueLaden(BENUTZER_A, 7)).toHaveLength(1);
  });

  it('unterstützt Wiederholen und bewusstes Verwerfen abgelehnter Fachaktionen', async () => {
    await schreibaktionEinreihen(BENUTZER_A, 7, {
      art: 'person',
      daten: { client_id: 'person-2' },
    });
    let [aktion] = await schreibaktionenLaden(BENUTZER_A, 7);
    expect(await schreibaktionAblehnen(BENUTZER_A, aktion, 'Status unzulässig')).toBe(true);
    let [abgelehnt] = await schreibaktionenAbgelehntLaden(BENUTZER_A, 7);
    expect(await schreibaktionAbgelehntWiederholen(BENUTZER_B, abgelehnt.id!)).toBe(false);
    expect(await schreibaktionAbgelehntWiederholen(BENUTZER_A, abgelehnt.id!)).toBe(true);

    [aktion] = await schreibaktionenLaden(BENUTZER_A, 7);
    await schreibaktionAblehnen(BENUTZER_A, aktion, 'Noch immer unzulässig');
    [abgelehnt] = await schreibaktionenAbgelehntLaden(BENUTZER_A, 7);
    expect(await schreibaktionAbgelehntVerwerfen(BENUTZER_B, abgelehnt.id!)).toBe(false);
    expect(await schreibaktionAbgelehntVerwerfen(BENUTZER_A, abgelehnt.id!)).toBe(true);
    expect(await queueZaehlerLaden(BENUTZER_A, 7)).toEqual({
      ausstehend: 0,
      abgelehnt: 0,
      nicht_zugeordnet: 0,
    });
  });

  it('sendet Legacy-Zeilen nie und gibt davon nur einen globalen anonymen Zähler preis', async () => {
    await queueLegacyEinreihenFuerTests(7, {
      ...eintrag,
      inhalt: 'streng vertraulicher Legacy-Inhalt',
      client_id: 'legacy',
    });
    await queueEinreihen(BENUTZER_B, 7, { ...eintrag, client_id: 'fremd' });

    expect(await queueAlleLaden(BENUTZER_A)).toEqual([]);
    expect(await queueNichtZugeordnetZaehlen()).toBe(1);
    expect(await queueZaehlerLaden(BENUTZER_A, 7)).toEqual({
      ausstehend: 0,
      abgelehnt: 0,
      nicht_zugeordnet: 1,
    });
    // Auch ein anderer Einsatz sieht nur denselben globalen Warnzähler. Damit
    // verrät die Quarantäne nicht, welchem Einsatz die Alt-Daten zugeordnet waren.
    expect((await queueZaehlerLaden(BENUTZER_A, 999)).nicht_zugeordnet).toBe(1);
    expect(await queueLaden(BENUTZER_A, 7)).toEqual([]);
    expect(await queueLaden(BENUTZER_B, 7)).toHaveLength(1);
  });

  it('verwirft Legacy-Zeilen nur gesammelt und lässt attribuierte Daten unangetastet', async () => {
    await queueLegacyEinreihenFuerTests(7, { ...eintrag, client_id: 'legacy-discard' });
    await queueEinreihen(BENUTZER_B, 7, { ...eintrag, client_id: 'bleibt-erhalten' });

    expect(await queueNichtZugeordnetAlleVerwerfen()).toBe(1);
    expect(await queueNichtZugeordnetAlleVerwerfen()).toBe(0);
    expect(await queueNichtZugeordnetZaehlen()).toBe(0);
    expect((await queueLaden(BENUTZER_B, 7))[0].eintrag.client_id).toBe('bleibt-erhalten');
  });
});
