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
  darstellungsName,
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
    expect(optionen.length).toBe(29);
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

  it('bietet die zweite Darstellung als eigene Kachel an: leitergebunden „(Draht)“, drahtlos „(Funk)“', () => {
    // Anhang J: die erste Darstellung ist drahtlos (Zickzack), die zweite leitergebunden
    // (`pictograms/comms/01-connections.ts` der Bibliothek, Asset `…_leitergebunden.svg`).
    const funk = optionen.find((o) => o.id === 'pic:comms.voice')!;
    const draht = optionen.find((o) => o.id === 'pic:comms.voice:alternative')!;
    expect(funk.label).toBe('Sprache (Funk)');
    expect(draht.label).toBe('Sprache (Draht)');
    // Die Draht-Kachel steht direkt hinter ihrer Funk-Kachel.
    expect(ids.indexOf(draht.id)).toBe(ids.indexOf(funk.id) + 1);
    expect(mitSymbol(null, draht.id)).toEqual({
      kind: 'pictogram',
      pictogram: 'comms.voice',
      variant: 'alternative',
    });
    expect(mitSymbol(null, funk.id)).toEqual({ kind: 'pictogram', pictogram: 'comms.voice' });
    expect(symbolVon(mitSymbol(null, draht.id)!)).toBe(draht.id);
    expect(zeichenName(mitSymbol(null, draht.id)!)).toBe('Sprache (Draht)');
  });

  it('bietet die Altbestände nach SKK 2010 und die Drohne mit Namen an (LLH-1159)', () => {
    const name = (id: string) => optionen.find((o) => o.id === id)?.label;
    expect(name('pic:comms.teleprinter-transmission')).toBe('Fernschreiben (Funk)');
    expect(name('pic:comms.teleprinter-transmission:alternative')).toBe('Fernschreiben (Draht)');
    expect(name('pic:comms.still-image-transmission')).toBe('Festbildübertragung (Funk)');
    expect(name('pic:comms.still-image-transmission:alternative')).toBe(
      'Festbildübertragung (Draht)',
    );
    expect(name('pic:site.affected-persons-assembly-point')).toBe('Sammelplatz für Betroffene');
    expect(name('pic:special-form.drone')).toBe('Grundzeichen Drohne');
  });

  it('nennt andere zweite Darstellungen „(zweite Darstellung)“, auch an Zustand und Tierzustand', () => {
    const name = (id: string) => optionen.find((o) => o.id === id)?.label;
    expect(name('pic:capability.chemical-materials:alternative')).toBe(
      'Chemische Stoffe (zweite Darstellung)',
    );
    expect(name('pic:capability.chemical-materials')).toBe('Chemische Stoffe');
    // 5.8.6.2: die Register-Datei trägt nur den Buchstaben „K“, kein Wort — Rückfall.
    expect(name('tier:contaminated-animal:alternative')).toMatch(/\(zweite Darstellung\)$/);
    expect(mitSymbol(null, 'tier:contaminated-animal:alternative')).toEqual({
      kind: 'animal-state',
      state: 'contaminated-animal',
      variant: 'alternative',
    });
    // 5.8.8.6: die erste Darstellung gehört an die Person, die zweite zeichnet nur freistehend.
    expect(ids).not.toContain('state:person-contaminated');
    expect(ids).toContain('state:person-contaminated:alternative');
  });

  it('nennt die zweite Darstellung nach dem Register, wo es sie benennt (5.8.1.7 „Chlor“)', () => {
    const name = (id: string) => optionen.find((o) => o.id === id)?.label;
    expect(name('state:hazardous-substances:alternative')).toBe('Gefährliche Stoffe (Chlor)');
    expect(name('state:hazardous-substances')).toBe('Gefährliche Stoffe');
    expect(
      zeichenName({ kind: 'state', state: 'hazardous-substances', variant: 'alternative' }),
    ).toBe('Gefährliche Stoffe (Chlor)');
  });

  it('bietet keine zweite Darstellung an, die die Bibliothek freistehend nicht zeichnet', () => {
    // 5.8.1.13/14: die zweite Darstellung ist die Gefahr mit Zustand (`state-not-canonical`).
    expect(ids).not.toContain('state:suspected-situation:alternative');
    expect(ids).not.toContain('state:acute-situation:alternative');
    // Ohne zweite Darstellung im Register keine Variante.
    expect(ids).not.toContain('pic:capability.rescue-aerial-ladder:alternative');
  });

  it('setzt das Piktogramm „Drehleiter“ ohne Grundzeichen', () => {
    const drehleiter = optionen.find((o) => /Drehleiter/.test(o.label))!;
    expect(mitSymbol(null, drehleiter.id)).toEqual({
      kind: 'pictogram',
      pictogram: 'capability.rescue-aerial-ladder',
    });
  });
});

describe('darstellungsName', () => {
  const erste = 'Gefährliche Stoffe';
  const eintrag = (titel: string, datei: string) => ({
    id: 'state.hazardous-substances',
    titel: erste,
    zweite: { titel, datei },
  });

  it('nimmt einen eigenen Titel der zweiten Darstellung, wo er sich von der ersten unterscheidet', () => {
    expect(darstellungsName(eintrag('Chlorgas', '5.8.1.7_x.svg'), true)).toBe('Chlorgas');
    expect(darstellungsName(eintrag('Chlorgas', '5.8.1.7_x.svg'), false)).toBe(erste);
  });

  it('nimmt sonst das Wort hinter dem Titel in der Register-Datei', () => {
    expect(darstellungsName(eintrag(erste, '5.8.1.7_Gefährliche Stoffe_Chlor.svg'), true)).toBe(
      'Gefährliche Stoffe (Chlor)',
    );
  });

  it('fällt auf „(zweite Darstellung)“ zurück: kein Wort, nur ein Buchstabe, eine Zahl oder „Alternative“', () => {
    for (const datei of ['a_b_Alternative.svg', 'a_b_2.svg', 'a_b_K.svg', 'a_b.svg']) {
      expect(darstellungsName(eintrag(erste, datei), true), datei).toBe(
        'Gefährliche Stoffe (zweite Darstellung)',
      );
    }
  });

  it('nennt Anhang J nach Funk und Draht, und ohne zweite Darstellung nur den Titel', () => {
    const j = {
      id: 'comms.voice',
      titel: 'Sprache',
      zweite: { titel: 'Sprache', datei: 'J.1.1_Sprache_leitergebunden.svg' },
    };
    expect(darstellungsName(j, false)).toBe('Sprache (Funk)');
    expect(darstellungsName(j, true)).toBe('Sprache (Draht)');
    expect(darstellungsName({ id: 'comms.radio', titel: 'Funk' }, false)).toBe('Funk');
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

  it('benennt eine Bewegung aus einer Altzeile mit dem Titel ihres Pfeils (LLH-1159)', () => {
    expect(
      zeichenName({
        kind: 'movement',
        movement: 'movement-both-directions',
        path: {
          points: [
            [2, 16],
            [30, 16],
          ],
        },
      }),
    ).toBe('Bewegung in zwei Richtungen');
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
