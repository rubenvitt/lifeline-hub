import { describe, it, expect, vi, beforeEach } from 'vitest';
import { aktualisierePerson } from './einsatzPerson';
import { aktualisiereTier } from './einsatzTier';

/**
 * LFH-266/F12: PATCH-Tri-State am Wire.
 *
 * Der Backend-Fix allein reicht nicht: antds `Select allowClear` liefert beim Leeren
 * `undefined`, und `JSON.stringify` entfernt undefined-Keys komplett — das Feld käme nie
 * beim Server an. Diese Tests prüfen genau die Stelle, an der das FE das reparieren muss.
 */
describe('PATCH-Tri-State-Normalisierung', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  function fetchMock() {
    return vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', { status: 200 }));
  }

  function body(mock: ReturnType<typeof fetchMock>): Record<string, unknown> {
    const [, init] = mock.mock.calls[0];
    return JSON.parse(init!.body as string);
  }

  it('macht aus einem geleerten Select (undefined) ein explizites null', async () => {
    const mock = fetchMock();
    // So sieht das Wertobjekt aus, wenn der Nutzer das Geschlechts-Select leert.
    await aktualisierePerson(1, 2, { geschlecht: undefined, name: 'Muster' });
    const b = body(mock);
    expect(b).toHaveProperty('geschlecht', null);
    expect(b.name).toBe('Muster');
  });

  it('macht aus einem geleerten Textfeld ("") ein explizites null', async () => {
    const mock = fetchMock();
    await aktualisierePerson(1, 2, { notiz: '   ', antreff_ort: 'Brücke' });
    const b = body(mock);
    expect(b).toHaveProperty('notiz', null);
    expect(b.antreff_ort).toBe('Brücke');
  });

  it('ergänzt KEINE Keys, die nicht übergeben wurden', async () => {
    const mock = fetchMock();
    await aktualisierePerson(1, 2, { notiz: 'nur das' });
    expect(Object.keys(body(mock))).toEqual(['notiz']);
  });

  it('lässt basis_geaendert_at unangetastet (Steuerfeld, kein Spaltenwert)', async () => {
    const mock = fetchMock();
    await aktualisierePerson(1, 2, { notiz: '' }, '2026-07-19 10:00:00');
    const b = body(mock);
    expect(b.notiz).toBeNull();
    expect(b.basis_geaendert_at).toBe('2026-07-19 10:00:00');
  });

  /**
   * Schutz für die Partial-Patches aus PersonenDetailPage: `aktualisiereTier` wird dort nur
   * mit den Halter-Feldern aufgerufen. Würde die Normalisierung über eine feste Feldliste
   * statt über die vorhandenen Keys laufen, kämen die neun Identitätsfelder als `null` mit
   * und das Halter-Entfernen leerte still den halben Tierdatensatz.
   */
  it('injiziert bei einem Tier-Partial-Patch keine Identitätsfelder', async () => {
    const mock = fetchMock();
    await aktualisiereTier(1, 2, { halter_person_id: null });
    expect(Object.keys(body(mock))).toEqual(['halter_person_id']);
  });

  it('normalisiert auch beim Tier ein geleertes Feld zu null', async () => {
    const mock = fetchMock();
    await aktualisiereTier(1, 2, { rufname: undefined, kennzeichnung: 'Chip 123' });
    const b = body(mock);
    expect(b).toHaveProperty('rufname', null);
    expect(b.kennzeichnung).toBe('Chip 123');
  });
});
