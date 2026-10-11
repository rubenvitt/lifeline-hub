import { checkAnySpec, drawAnySpec, serializeAnySpec } from '@einsatzzeichen/core';
import {
  PALETTE,
  TECHNICAL_FILL_TOKENS,
  type AnySpec,
  type SymbolKind,
  type SymbolSpec,
} from '@einsatzzeichen/schema';
import { describe, expect, it } from 'vitest';
import {
  GRUNDZEICHEN_NAMEN,
  START_ZEICHEN_SPEC,
  detailOptionen,
  grundzeichenOptionen,
  grundzeichenVon,
  leseEntwurf,
  mitDetail,
  mitGrundzeichen,
  mitSymbol,
  symbolOptionen,
  symbolVon,
  zeichenName,
} from './zeichenWahl';

// Zeichenwahl aus dem Vokabular (LFH-836, design.md D7, Spec `lagekarte-zeichenwahl`): angeboten
// wird nur, was @einsatzzeichen mit dem gerade gewählten Zeichen zeichnet.

const kinds = Object.keys(GRUNDZEICHEN_NAMEN) as SymbolKind[];

describe('grundzeichenOptionen', () => {
  it('bietet die Grundzeichenarten des Vokabulars an, jede mit deutschem Namen', () => {
    const optionen = grundzeichenOptionen();
    expect(optionen.length).toBe(19);
    for (const o of optionen) {
      expect(o.label.length, o.id).toBeGreaterThan(0);
      expect(o.label).toBe(GRUNDZEICHEN_NAMEN[o.id as SymbolKind]);
      expect(() => drawAnySpec(o.spec)).not.toThrow();
    }
  });

  it('findet ein Grundzeichen auch über den Alltagsbegriff der Bibliothek', () => {
    const behaelter = grundzeichenOptionen().find((o) => o.id === 'container')!;
    expect(behaelter.suche.toLowerCase()).toContain('funkgerät');
  });
});

describe('symbolOptionen mit Grundzeichen', () => {
  it('bietet Fähigkeiten und Zustände an, die das Vokabular am Körper erlaubt', () => {
    const optionen = symbolOptionen({ kind: 'formation' });
    const ids = optionen.map((o) => o.id);
    expect(ids).toContain('cap:fire-fighting');
    expect(ids).toContain('st:damaged');
    expect(optionen.find((o) => o.id === 'cap:rescue-aerial-ladder')?.label).toMatch(/Drehleiter/);
  });

  it('bietet an der Person die Personenzustände an', () => {
    const ids = symbolOptionen({ kind: 'person' }).map((o) => o.id);
    expect(ids).toContain('st:person-injured');
  });
});

describe('symbolOptionen ohne Grundzeichen', () => {
  const optionen = symbolOptionen(null);
  const ids = optionen.map((o) => o.id);

  it('bietet freistehende Piktogramme, Zustände und Tierzustände an', () => {
    expect(ids).toContain('pic:capability.rescue-aerial-ladder');
    expect(ids).toContain('state:damaged');
    expect(ids).toContain('tier:sick-animal');
  });

  it('bietet nichts an, was freistehend nicht kanonisch ist', () => {
    // Personenzustände gehören an das Grundzeichen Person (freestandingRedirect).
    expect(ids).not.toContain('state:person-injured');
    expect(ids).not.toContain('pic:state.damaged');
  });

  it('setzt das Piktogramm „Drehleiter“ ohne Grundzeichen', () => {
    const drehleiter = optionen.find((o) => /Drehleiter/.test(o.label))!;
    expect(mitSymbol(null, drehleiter.id)).toEqual({
      kind: 'pictogram',
      pictogram: 'capability.rescue-aerial-ladder',
    });
  });
});

describe('detailOptionen', () => {
  it('bietet am Landfahrzeug keine Stärke an, die die Bibliothek ablehnt', () => {
    const einheiten = detailOptionen({ kind: 'vehicle-land' }).einheit.map((o) => o.value);
    expect(einheiten.some((v) => v.startsWith('strength:'))).toBe(false);
    // Die Formation trägt sie.
    expect(detailOptionen({ kind: 'formation' }).einheit.map((o) => o.value)).toContain(
      'strength:zug',
    );
  });

  it('bietet die Farbe nur aus der Palette an, mit den Farben der Bibliothek', () => {
    const farben = detailOptionen({ kind: 'hazard' }).farbe;
    expect(farben.length).toBeGreaterThan(0);
    for (const f of farben) {
      expect(TECHNICAL_FILL_TOKENS).toContain(f.value);
      expect(f.farbe).toBe(PALETTE[f.value as keyof typeof PALETTE]);
    }
  });

  it('bietet Organisationen mit ihren deutschen Namen an', () => {
    const org = detailOptionen({ kind: 'formation' }).organisation;
    expect(org.find((o) => o.value === 'thw')?.label).toBe('Technisches Hilfswerk');
  });

  it('hat ohne Grundzeichen keine Achsen außer der Bezeichnung', () => {
    const d = detailOptionen({ kind: 'pictogram', pictogram: 'capability.lighting' });
    expect(d).toEqual({ organisation: [], fachaufgabe: [], einheit: [], farbe: [] });
  });
});

describe('Entwurf ändern', () => {
  it('verwirft beim Grundzeichenwechsel, was die neue Art ablehnt, und behält den Rest', () => {
    const zug: SymbolSpec = { kind: 'formation', organization: 'thw', strength: 'zug' };
    expect(mitGrundzeichen(zug, 'vehicle-land')).toEqual({
      kind: 'vehicle-land',
      organization: 'thw',
    });
  });

  it('setzt ein Symbol an Stelle des alten, Fähigkeit oder Zustand', () => {
    const mitLeiter = mitSymbol({ kind: 'formation' }, 'cap:rescue-aerial-ladder');
    expect(mitLeiter).toEqual({ kind: 'formation', capabilities: ['rescue-aerial-ladder'] });
    expect(mitSymbol(mitLeiter!, 'st:damaged')).toEqual({ kind: 'formation', states: ['damaged'] });
    expect(mitSymbol(mitLeiter!, null)).toEqual({ kind: 'formation' });
    expect(symbolVon(mitLeiter!)).toBe('cap:rescue-aerial-ladder');
  });

  it('setzt Fachaufgabe randbündig, Einheit und Farbe', () => {
    let s: AnySpec = { kind: 'formation' };
    s = mitDetail(s, 'fachaufgabe', 'fire-fighting');
    s = mitDetail(s, 'einheit', 'strength:zug');
    expect(s).toEqual({ kind: 'formation', bodyMarks: ['fire-fighting'], strength: 'zug' });
    s = mitDetail(s, 'einheit', 'unitGrouping:verband-i');
    expect(s).toMatchObject({ unitGrouping: 'verband-i' });
    expect(s).not.toHaveProperty('strength');
    expect(mitDetail({ kind: 'hazard' }, 'farbe', 'rot')).toEqual({
      kind: 'hazard',
      technicalFill: 'rot',
    });
    expect(mitDetail({ kind: 'hazard', technicalFill: 'rot' }, 'farbe', null)).toEqual({
      kind: 'hazard',
    });
  });

  it('liest den Entwurf aus der Serialisierung, Unlesbares über den Leseadapter', () => {
    expect(leseEntwurf(START_ZEICHEN_SPEC)).toEqual({ kind: 'formation' });
    expect(leseEntwurf('kaputt')).toEqual({ kind: 'point' });
    expect(grundzeichenVon({ kind: 'pictogram', pictogram: 'capability.lighting' })).toBeNull();
    expect(grundzeichenVon({ kind: 'person' })).toBe('person');
  });
});

describe('zeichenName', () => {
  it('benennt ein Zeichen vom Träger zum Beiwerk', () => {
    expect(
      zeichenName({
        kind: 'formation',
        organization: 'thw',
        bodyMarks: ['fire-fighting'],
        strength: 'zug',
      }),
    ).toBe(`${GRUNDZEICHEN_NAMEN.formation} · Technisches Hilfswerk · Brandbekämpfung · Zug`);
  });

  it('benennt ein freistehendes Zeichen mit dem Titel seines Piktogramms', () => {
    expect(
      zeichenName({ kind: 'pictogram', pictogram: 'capability.rescue-aerial-ladder' }),
    ).toMatch(/Drehleiter/);
  });
});

// Eigenschaftstest (Aufgabe 5.1): jede angebotene Option zeichnet, angewandt auf den Entwurf, ohne
// Wurf — für jede Grundzeichenart und ohne Grundzeichen.
describe('Eigenschaft: jede angebotene Option zeichnet', () => {
  const pruefe = (spec: AnySpec, was: string) => {
    const befund = checkAnySpec(spec);
    expect(befund.ok, `${was}: ${serializeAnySpec(spec)}`).toBe(true);
  };

  it('ohne Grundzeichen', () => {
    for (const o of symbolOptionen(null)) pruefe(mitSymbol(null, o.id)!, o.id);
  });

  it.each(kinds)('am Grundzeichen %s', (kind) => {
    const basis: SymbolSpec = { kind };
    pruefe(basis, 'Körper');
    for (const o of symbolOptionen(basis)) pruefe(mitSymbol(basis, o.id)!, o.id);
    const d = detailOptionen(basis);
    for (const o of d.organisation) pruefe(mitDetail(basis, 'organisation', o.value), o.value);
    for (const o of d.fachaufgabe) pruefe(mitDetail(basis, 'fachaufgabe', o.value), o.value);
    for (const o of d.einheit) pruefe(mitDetail(basis, 'einheit', o.value), o.value);
    for (const o of d.farbe) pruefe(mitDetail(basis, 'farbe', o.value), o.value);
  });
});
