import { describe, it, expect, vi, beforeEach } from 'vitest';
import { aktualisierePerson } from './einsatzPerson';
import { aktualisiereTier } from './einsatzTier';
import { normalisierePatch, nurGesetzteFelder, patchBody } from './patchTriState';

/**
 * LFH-266/F12, ausgebaut für LFH-306: PATCH-Tri-State am Wire.
 *
 * Der Backend-Fix allein reicht nicht: antds `Select allowClear` liefert beim Leeren
 * `undefined`, und `JSON.stringify` entfernt undefined-Keys komplett — das Feld käme nie
 * beim Server an. Diese Tests prüfen genau die Stelle, an der das FE das reparieren muss.
 *
 * WARUM DIE ASSERTIONS AUF DER SERIALISIERTEN FORM SITZEN: `{ notiz: null }` und
 * `{ notiz: undefined }` sind auf der Objekt-Ebene mit `toEqual` NICHT unterscheidbar —
 * Vitest behandelt eine Property mit `undefined` wie eine fehlende. Der Unterschied
 * zwischen „leeren" und „nicht anfassen" entsteht aber genau dort und nirgends sonst.
 * Deshalb wird durchgängig gegen `JSON.stringify(...)` bzw. gegen `Object.keys` des
 * geparsten Bodys assertiert, nie gegen das Objekt davor.
 *
 * Kein e2e-Netz: `frontend/e2e/` hat 7 Specs, keine berührt Stamm-/Kopfdaten-Formulare
 * (nachgemessen). Und jsdom bildet antd-Select-Clearing nicht zuverlässig ab. Diese
 * Unit-Tests sind die einzige Absicherung des Umbaus — deshalb liegen sie nah an der
 * Serialisierung und nicht an der UI.
 */

describe('Die Falle selbst (Grund für den ganzen Unterbau)', () => {
  it('JSON.stringify verschluckt einen undefined-Key ersatzlos', () => {
    // Das ist der Ist-Zustand von JavaScript, kein Projektverhalten — und der Grund,
    // warum ein geleertes Select ohne Normalisierung NIE beim Server ankommt.
    expect(JSON.stringify({ notiz: undefined })).toBe('{}');
    expect(JSON.stringify({ notiz: null })).toBe('{"notiz":null}');
  });

  it('macht den Unterschied nach der Normalisierung sichtbar', () => {
    expect(JSON.stringify(normalisierePatch({ notiz: undefined }))).toBe('{"notiz":null}');
  });
});

describe('normalisierePatch — Formular-Lesart (undefined = geleert = löschen)', () => {
  it('WERT GESETZT: reicht den Wert unverändert durch', () => {
    expect(JSON.stringify(normalisierePatch({ notiz: 'Text' }))).toBe('{"notiz":"Text"}');
  });

  it('LÖSCHEN via geleertes Select: undefined wird zu explizitem null', () => {
    expect(JSON.stringify(normalisierePatch({ geschlecht: undefined }))).toBe('{"geschlecht":null}');
  });

  it('LÖSCHEN via geleertes Textfeld: "" und reiner Leerraum werden zu explizitem null', () => {
    expect(JSON.stringify(normalisierePatch({ a: '', b: '   ', c: '\t\n' }))).toBe(
      '{"a":null,"b":null,"c":null}',
    );
  });

  it('UNVERÄNDERT: ergänzt keinen Key, der nicht übergeben wurde', () => {
    // Der Absent-Zustand entsteht ausschließlich dadurch, dass der Key fehlt.
    expect(JSON.stringify(normalisierePatch({ notiz: 'nur das' }))).toBe('{"notiz":"nur das"}');
    expect(JSON.stringify(normalisierePatch({}))).toBe('{}');
  });

  it('unterscheidet alle drei Zustände in EINEM Body', () => {
    // Der eigentliche Tri-State-Beweis: gesetzt, geleert und abwesend nebeneinander.
    const wire = JSON.parse(JSON.stringify(normalisierePatch({ gesetzt: 'A', geleert: undefined })));
    expect(wire.gesetzt).toBe('A');
    expect(wire.geleert).toBeNull();
    expect(Object.keys(wire)).toEqual(['gesetzt', 'geleert']);
    expect('unberuehrt' in wire).toBe(false);
  });

  it('fasst Nicht-String-Werte nicht an (0 und false sind Werte, keine Leere)', () => {
    // Eine Falsy-Prüfung statt der expliziten undefined/Leerraum-Prüfung würde hier
    // `0` und `false` zu null machen — ein stiller Datenverlust bei alter_geschaetzt.
    expect(JSON.stringify(normalisierePatch({ alter_geschaetzt: 0, flag: false }))).toBe(
      '{"alter_geschaetzt":0,"flag":false}',
    );
  });

  it('lässt ein bereits explizites null null (löschen bleibt löschen)', () => {
    expect(JSON.stringify(normalisierePatch({ halter_person_id: null }))).toBe(
      '{"halter_person_id":null}',
    );
  });

  it('trimmt einen nicht-leeren Wert NICHT (Bestandsvertrag, bewusst)', () => {
    expect(JSON.stringify(normalisierePatch({ name: ' Muster ' }))).toBe('{"name":" Muster "}');
  });
});

describe('nurGesetzteFelder — Spread-Lesart (undefined = nicht angefasst)', () => {
  it('UNVERÄNDERT: entfernt einen undefined-Key GANZ, statt ihn zu leeren', () => {
    // Exakt gegenläufig zu normalisierePatch — das ist der Sinn der zweiten Funktion.
    expect(JSON.stringify(nurGesetzteFelder({ halter_kontakt: undefined }))).toBe('{}');
  });

  it('LÖSCHEN: lässt ein explizites null stehen', () => {
    // „Löschen" ist eine Absicht, keine Lücke — sie darf nicht mit weggefiltert werden.
    expect(JSON.stringify(nurGesetzteFelder({ halter_person_id: null }))).toBe(
      '{"halter_person_id":null}',
    );
  });

  it('WERT GESETZT: reicht Werte unverändert durch, inkl. Leerstring', () => {
    // Anders als normalisierePatch: hier bleibt '' ein '' — wer diese Funktion wählt,
    // baut den Body selbst und meint, was er schreibt.
    expect(JSON.stringify(nurGesetzteFelder({ a: 7, b: '' }))).toBe('{"a":7,"b":""}');
  });

  it('unterscheidet alle drei Zustände in EINEM Body', () => {
    const wire = JSON.parse(
      JSON.stringify(nurGesetzteFelder({ gesetzt: 'A', geleert: null, unberuehrt: undefined })),
    );
    expect(wire.gesetzt).toBe('A');
    expect(wire.geleert).toBeNull();
    expect(Object.keys(wire)).toEqual(['gesetzt', 'geleert']);
    expect('unberuehrt' in wire).toBe(false);
  });
});

describe('patchBody — Steuerfeld basis_geaendert_at', () => {
  it('hängt die Baseline NACH der Normalisierung an', () => {
    const wire = JSON.parse(JSON.stringify(patchBody({ notiz: '' }, '2026-07-19 10:00:00')));
    expect(wire.notiz).toBeNull();
    expect(wire.basis_geaendert_at).toBe('2026-07-19 10:00:00');
  });

  it('setzt den Key GAR NICHT, wenn keine Baseline übergeben wurde', () => {
    // Zwingend absent, nicht null: `basis_geaendert_at: null` hieße für den Server
    // „kein Lock, bewusstes Overwrite" — aus 409-Schutz würde stilles Überschreiben.
    const roh = JSON.stringify(patchBody({ notiz: 'x' }));
    expect(roh).toBe('{"notiz":"x"}');
    expect(roh).not.toContain('basis_geaendert_at');
  });

  it('normalisiert die Baseline selbst nicht (Steuerfeld, kein Spaltenwert)', () => {
    // Liefe sie durch normalisierePatch, würde ein leerer String zu null — und damit
    // aus „Lock mitschicken" ein „Overwrite erzwingen".
    const wire = JSON.parse(JSON.stringify(patchBody({ notiz: 'x' }, '   ')));
    expect(wire.basis_geaendert_at).toBe('   ');
  });
});

describe('PATCH-Tri-State am echten Wire (durch apiSend/fetch)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  function fetchMock() {
    return vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', { status: 200 }));
  }

  /** Der tatsächlich gesendete Body als String — vor jedem Parsen. */
  function rohBody(mock: ReturnType<typeof fetchMock>): string {
    const [, init] = mock.mock.calls[0];
    return init!.body as string;
  }

  function body(mock: ReturnType<typeof fetchMock>): Record<string, unknown> {
    return JSON.parse(rohBody(mock));
  }

  it('macht aus einem geleerten Select (undefined) ein explizites null', async () => {
    const mock = fetchMock();
    // So sieht das Wertobjekt aus, wenn der Nutzer das Geschlechts-Select leert.
    await aktualisierePerson(1, 2, { geschlecht: undefined, name: 'Muster' });
    // Auf der ROHEN Form: hier — und nur hier — wäre der undefined-Key verschwunden.
    expect(rohBody(mock)).toContain('"geschlecht":null');
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

  it('sendet die drei Zustände unterscheidbar in EINEM PATCH', async () => {
    const mock = fetchMock();
    // gesetzt: name — geleert: geschlecht — unverändert: notiz (Key fehlt)
    await aktualisierePerson(1, 2, { name: 'Muster', geschlecht: undefined });
    const b = body(mock);
    expect(b.name).toBe('Muster');
    expect(b).toHaveProperty('geschlecht', null);
    expect('notiz' in b).toBe(false);
  });

  it('lässt basis_geaendert_at unangetastet (Steuerfeld, kein Spaltenwert)', async () => {
    const mock = fetchMock();
    await aktualisierePerson(1, 2, { notiz: '' }, '2026-07-19 10:00:00');
    const b = body(mock);
    expect(b.notiz).toBeNull();
    expect(b.basis_geaendert_at).toBe('2026-07-19 10:00:00');
  });

  it('schickt ohne Baseline gar kein basis_geaendert_at mit', async () => {
    const mock = fetchMock();
    await aktualisierePerson(1, 2, { notiz: 'x' });
    expect(rohBody(mock)).not.toContain('basis_geaendert_at');
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
