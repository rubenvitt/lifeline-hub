import { describe, it, expect } from 'vitest';
import type { KarteMarker, MarkerTyp } from './marker';
import { OBJEKTART } from './leistenDaten';
import { TYP_REIHENFOLGE, gruppiereTreffer, suchbareMarker } from './objektsuche';

const m = (typ: MarkerTyp, id: number, label: string): KarteMarker => ({
  schluessel: `${typ}-${id}`,
  typ,
  id,
  lat: 50,
  lon: 8,
  label,
  farbe: '#000',
});

const UHS = m('uhs', 1, 'UHS Süd');
const STELLE = m('betreuungsstelle', 2, 'Turnhalle Mitte');
const PERSON = m('person', 3, 'Müller, Anna');

describe('suchbareMarker — Modulsperren (LFH-716, D1)', () => {
  const basis = {
    verortet: [UHS, STELLE],
    personen: [PERSON],
    personenZugriff: 'frei' as const,
    personenEbeneAn: true,
    betreuungZugriff: 'frei' as const,
  };
  const namen = (a: typeof basis | Parameters<typeof suchbareMarker>[0]) =>
    suchbareMarker(a).map((x) => x.label);

  it('mit Betreuungsrecht: die Betreuungsstelle ist suchbar', () => {
    expect(namen(basis)).toContain('Turnhalle Mitte');
  });

  it.each(['gesperrt', 'ausgeblendet'] as const)(
    'ohne Betreuungsrecht (%s): kein Name der Betreuung, auch wenn die Stelle in den Daten stünde',
    (zugriff) => {
      const liste = namen({ ...basis, betreuungZugriff: zugriff });
      expect(liste).not.toContain('Turnhalle Mitte');
      // Gegenaussage: gesperrt ist nur das Modul, nicht die Suche.
      expect(liste).toContain('UHS Süd');
    },
  );

  it('mit Personenrecht und eingeschalteter Ebene: Betroffene sind suchbar', () => {
    expect(namen(basis)).toContain('Müller, Anna');
  });

  it.each(['gesperrt', 'ausgeblendet', 'rueckblick'] as const)(
    'ohne Personenrecht (%s): kein Name einer betroffenen Person',
    (zugriff) => {
      expect(namen({ ...basis, personenZugriff: zugriff })).not.toContain('Müller, Anna');
    },
  );

  it('bei ausgeschalteter Ebene „Betroffene": kein Name, obwohl das Modul frei ist', () => {
    expect(namen({ ...basis, personenEbeneAn: false })).not.toContain('Müller, Anna');
  });

  it('lässt eine Person, die fälschlich in der allgemeinen Liste steht, ohne Recht ebenfalls weg', () => {
    // Die Prüfung hängt am Typ, nicht an der Herkunftsliste — sonst bräche eine Person in
    // `verortet` die Sperre still.
    const liste = namen({
      ...basis,
      verortet: [UHS, PERSON],
      personen: [],
      personenZugriff: 'gesperrt',
    });
    expect(liste).toEqual(['UHS Süd']);
  });
});

describe('gruppiereTreffer', () => {
  it('filtert auf die Beschriftung, ohne Rücksicht auf Groß-/Kleinschreibung', () => {
    const gruppen = gruppiereTreffer(
      [m('einheit', 1, 'Florian Nord 1'), m('schaden', 2, 'Keller Nordstraße'), UHS],
      'NORD',
    );
    expect(gruppen.map((g) => `${g.label} (${g.treffer.length})`)).toEqual([
      'Schaden (1)',
      'Einheit (1)',
    ]);
  });

  it('findet auch über die Objektart — ein unbenanntes Zeichen heißt überall gleich', () => {
    // „(freies Zeichen)" ist unter „takt" zu finden.
    const marker = [
      m('freies_zeichen', 1, '(freies Zeichen)'),
      m('fahrzeug', 2, 'Florian 11-1'),
      UHS,
    ];
    expect(gruppiereTreffer(marker, 'takt').map((g) => g.typ)).toEqual(['freies_zeichen']);
    expect(gruppiereTreffer(marker, 'fahrzeug').map((g) => g.typ)).toEqual(['fahrzeug']);
  });

  it('lässt leere Gruppen weg und zeigt bei leerer Suche alles', () => {
    const marker = [UHS, m('einheit', 1, 'Florian 1')];
    expect(gruppiereTreffer(marker, 'florian').map((g) => g.typ)).toEqual(['einheit']);
    expect(
      gruppiereTreffer(marker, '  ')
        .map((g) => g.typ)
        .sort(),
    ).toEqual(['einheit', 'uhs']);
  });

  it('sortiert nach Trefferzahl absteigend', () => {
    const gruppen = gruppiereTreffer(
      [UHS, m('einheit', 1, 'A'), m('einheit', 2, 'B'), m('einheit', 3, 'C')],
      '',
    );
    expect(gruppen.map((g) => g.typ)).toEqual(['einheit', 'uhs']);
  });

  it('ordnet gleich große Gruppen nach fester Reihenfolge, nicht nach Eingabereihenfolge', () => {
    const a = gruppiereTreffer([m('fahrzeug', 1, 'F'), m('einsatzort', 0, 'E')], '');
    const b = gruppiereTreffer([m('einsatzort', 0, 'E'), m('fahrzeug', 1, 'F')], '');
    expect(a.map((g) => g.typ)).toEqual(['einsatzort', 'fahrzeug']);
    expect(b.map((g) => g.typ)).toEqual(['einsatzort', 'fahrzeug']);
  });

  it('beschriftet jede Gruppe mit der Objektart der Leiste', () => {
    expect(gruppiereTreffer([STELLE], '')[0].label).toBe(OBJEKTART.betreuungsstelle);
  });
});

describe('TYP_REIHENFOLGE', () => {
  it('trägt genau die Markertypen, die OBJEKTART beschriftet — in beide Richtungen', () => {
    const typen = Object.keys(OBJEKTART).sort();
    expect([...TYP_REIHENFOLGE].sort()).toEqual(typen);
    expect(new Set(TYP_REIHENFOLGE).size).toBe(TYP_REIHENFOLGE.length);
  });
});
