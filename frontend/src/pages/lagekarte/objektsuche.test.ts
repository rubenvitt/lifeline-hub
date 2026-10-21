import { describe, it, expect } from 'vitest';
import type { KarteMarker, MarkerTyp } from './marker';
import { OBJEKTART } from './leistenDaten';
import {
  OBJEKT_GRUPPEN,
  TYP_REIHENFOLGE,
  gruppiereObjekte,
  istWaehlbar,
  objektEintraege,
  suchbareMarker,
  zielSchluessel,
  type ObjektEintrag,
} from './objektsuche';

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
const RAUM = m('bereitstellungsraum', 4, 'BR Sportplatz');
const PERSON = m('person', 3, 'Müller, Anna');
const TIER = m('tier', 5, 'T-005 (Hund)');

describe('suchbareMarker — Modulsperren (LFH-716, D1)', () => {
  const basis = {
    verortet: [UHS, STELLE, RAUM, TIER],
    personen: [PERSON],
    personenZugriff: 'frei' as const,
    personenEbeneAn: true,
    betreuungZugriff: 'frei' as const,
    brZugriff: 'frei' as const,
    tierZugriff: 'frei' as const,
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

  it('mit Recht auf Bereitstellungsräume: der Raum ist suchbar (LLH-1107)', () => {
    expect(namen(basis)).toContain('BR Sportplatz');
  });

  it.each(['gesperrt', 'ausgeblendet'] as const)(
    'ohne Recht auf Bereitstellungsräume (%s): kein Name eines Raums (LLH-1107)',
    (zugriff) => {
      const liste = namen({ ...basis, brZugriff: zugriff });
      expect(liste).not.toContain('BR Sportplatz');
      expect(liste).toContain('Turnhalle Mitte');
    },
  );

  it('mit Recht auf Tiere: das Tier ist suchbar (LLH-1123)', () => {
    expect(namen(basis)).toContain('T-005 (Hund)');
  });

  it.each(['gesperrt', 'ausgeblendet'] as const)(
    'ohne Recht auf Tiere (%s): kein Tier in der Suche (LLH-1123)',
    (zugriff) => {
      const liste = namen({ ...basis, tierZugriff: zugriff });
      expect(liste).not.toContain('T-005 (Hund)');
      expect(liste).toContain('BR Sportplatz');
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

const e = (typ: MarkerTyp, id: number, label: string, verortet = true): ObjektEintrag => ({
  schluessel: typ === 'einsatzort' ? 'einsatzort' : `${typ}-${id}`,
  typ,
  id,
  label,
  verortet,
});

describe('objektEintraege — eine Liste für verortet und nicht verortet (LLH-1033)', () => {
  const basis = {
    suchbar: [UHS, STELLE],
    nichtVerortet: [
      { typ: 'fahrzeug' as const, id: 7, label: 'Musterstadt 83-1' },
      { typ: 'betreuungsstelle' as const, id: 8, label: 'AS Rathaus' },
      { typ: 'bereitstellungsraum' as const, id: 9, label: 'BR Nord' },
      { typ: 'tier' as const, id: 10, label: 'T-010 (Katze)' },
    ],
    einsatzortOhneOrt: false,
    betreuungZugriff: 'frei' as const,
    brZugriff: 'frei' as const,
    tierZugriff: 'frei' as const,
  };
  const namen = (a: Parameters<typeof objektEintraege>[0]) =>
    objektEintraege(a).map((x) => x.label);

  it('führt verortete und nicht verortete Objekte mit Schlüssel im Markerschema', () => {
    const liste = objektEintraege(basis);
    expect(liste).toContainEqual(e('uhs', 1, 'UHS Süd'));
    expect(liste).toContainEqual(e('fahrzeug', 7, 'Musterstadt 83-1', false));
  });

  it('der Einsatzort ohne Koordinate steht als nicht verortet in der Liste', () => {
    expect(objektEintraege({ ...basis, einsatzortOhneOrt: true })).toContainEqual(
      e('einsatzort', 0, 'Einsatzort', false),
    );
    expect(namen(basis)).not.toContain('Einsatzort');
  });

  it.each([
    ['betreuungZugriff', 'AS Rathaus'],
    ['brZugriff', 'BR Nord'],
    ['tierZugriff', 'T-010 (Katze)'],
  ] as const)(
    'Modulsperre je Typ auch für nicht verortete: ohne %s fehlt „%s“',
    (schluessel, name) => {
      for (const zugriff of ['gesperrt', 'ausgeblendet'] as const) {
        const liste = namen({ ...basis, [schluessel]: zugriff });
        expect(liste).not.toContain(name);
        // Gegenaussage: gesperrt ist nur das eine Modul.
        expect(liste).toContain('Musterstadt 83-1');
      }
    },
  );

  it('eine verortete Betreuungsstelle bleibt ohne Recht ebenso draußen', () => {
    expect(namen({ ...basis, betreuungZugriff: 'gesperrt' })).not.toContain('Turnhalle Mitte');
  });
});

describe('gruppiereObjekte (LLH-1033)', () => {
  const ohne = { suche: '', nurNichtVerortet: false, angeheftet: null };
  const liste = [
    e('einsatzort', 0, 'Hauptstraße 1'),
    e('einheit', 1, 'Florian Nord 1'),
    e('schaden', 2, 'Keller Nordstraße'),
    e('uhs', 3, 'UHS Süd'),
    e('fahrzeug', 4, 'Musterstadt 83-1', false),
    e('fahrzeug', 5, 'Musterstadt 11-1'),
    e('abschnitt', 6, 'EA Süd', false),
    e('person', 7, 'Müller, Anna'),
  ];

  it('ohne Begriff: Einsatzort als eigene Zeile, Gruppen in fester Reihenfolge', () => {
    const r = gruppiereObjekte(liste, ohne);
    expect(r.einsatzort?.label).toBe('Hauptstraße 1');
    expect(r.gruppen.map((g) => g.typ)).toEqual([
      'einheit',
      'fahrzeug',
      'abschnitt',
      'uhs',
      'schaden',
      'person',
    ]);
  });

  it('die feste Reihenfolge hängt nicht an der Eingabereihenfolge', () => {
    const umgekehrt = gruppiereObjekte([...liste].reverse(), ohne);
    expect(umgekehrt.gruppen.map((g) => g.typ)).toEqual(
      gruppiereObjekte(liste, ohne).gruppen.map((g) => g.typ),
    );
  });

  it('zählt verortet/gesamt je Gruppe und nennt Gruppen, die nur verortet geführt werden', () => {
    const r = gruppiereObjekte(liste, ohne);
    const fahrzeuge = r.gruppen.find((g) => g.typ === 'fahrzeug')!;
    expect([fahrzeuge.verortet, fahrzeuge.gesamt, fahrzeuge.nurVerortet]).toEqual([1, 2, false]);
    expect(r.gruppen.find((g) => g.typ === 'person')!.nurVerortet).toBe(true);
  });

  it('beschriftet die Gruppen wie die Ebenen', () => {
    const r = gruppiereObjekte(liste, ohne);
    expect(r.gruppen.map((g) => g.label)).toEqual([
      'Einheiten',
      'Fahrzeuge',
      'Abschnitte',
      'UHS',
      'Schäden',
      'Betroffene',
    ]);
  });

  it('ordnet die Zeilen einer Gruppe nach Namen, Zahlen natürlich', () => {
    const r = gruppiereObjekte(liste, ohne);
    expect(r.gruppen.find((g) => g.typ === 'fahrzeug')!.eintraege.map((x) => x.label)).toEqual([
      'Musterstadt 11-1',
      'Musterstadt 83-1',
    ]);
  });

  it('Begriff grenzt über alle Objektarten ein, ohne Groß-/Kleinschreibung', () => {
    const r = gruppiereObjekte(liste, { ...ohne, suche: 'NORD' });
    expect(r.gruppen.map((g) => g.typ)).toEqual(['einheit', 'schaden']);
    expect(r.einsatzort).toBeNull();
  });

  it('Begriff findet auch nicht verortete Objekte', () => {
    const r = gruppiereObjekte(liste, { ...ohne, suche: '83' });
    expect(r.gruppen).toHaveLength(1);
    expect(r.gruppen[0].eintraege).toEqual([e('fahrzeug', 4, 'Musterstadt 83-1', false)]);
  });

  it('findet über die Objektart — ein unbenanntes Zeichen und der Gruppenname', () => {
    const zeichen = [e('freies_zeichen', 1, '(freies Zeichen)'), ...liste];
    expect(gruppiereObjekte(zeichen, { ...ohne, suche: 'takt' }).gruppen.map((g) => g.typ)).toEqual(
      ['freies_zeichen'],
    );
    expect(
      gruppiereObjekte(liste, { ...ohne, suche: 'fahrzeuge' }).gruppen.map((g) => g.typ),
    ).toEqual(['fahrzeug']);
    expect(gruppiereObjekte(liste, { ...ohne, suche: 'einsatzort' }).einsatzort).not.toBeNull();
  });

  it('mit Begriff: nach Trefferzahl absteigend, Gleichstand in fester Reihenfolge', () => {
    const r = gruppiereObjekte(
      [
        e('uhs', 1, 'A Süd'),
        e('uhs', 2, 'B Süd'),
        e('einheit', 3, 'Süd 1'),
        e('schaden', 4, 'Süd'),
      ],
      { ...ohne, suche: 'süd' },
    );
    expect(r.gruppen.map((g) => g.typ)).toEqual(['uhs', 'einheit', 'schaden']);
  });

  it('Filter „nur nicht verortet“ lässt nur nicht verortete stehen', () => {
    const r = gruppiereObjekte(
      [...liste.filter((x) => x.typ !== 'einsatzort'), e('einsatzort', 0, 'Einsatzort', false)],
      { ...ohne, nurNichtVerortet: true },
    );
    expect(r.gruppen.flatMap((g) => g.eintraege.map((x) => x.label))).toEqual([
      'Musterstadt 83-1',
      'EA Süd',
    ]);
    expect(r.einsatzort?.verortet).toBe(false);
    expect(gruppiereObjekte(liste, { ...ohne, nurNichtVerortet: true }).einsatzort).toBeNull();
  });

  it('zählt die nicht verorteten über die ganze Liste, unabhängig von Begriff und Filter', () => {
    const mitOrt = [...liste, e('einsatzort', 0, 'Einsatzort', false)].filter(
      (x) => x.schluessel !== 'einsatzort' || !x.verortet,
    );
    expect(gruppiereObjekte(mitOrt, { ...ohne, suche: 'xyz' }).nichtVerortet).toBe(3);
  });

  it('das laufende Platzierungsziel bleibt bei jedem Begriff und Filter stehen', () => {
    const r = gruppiereObjekte(liste, {
      suche: 'xyz',
      nurNichtVerortet: true,
      angeheftet: 'fahrzeug-4',
    });
    expect(r.gruppen.map((g) => g.typ)).toEqual(['fahrzeug']);
    expect(r.gruppen[0].angeheftet).toBe(true);
  });

  it('der Einsatzort als Platzierungsziel bleibt ebenso stehen', () => {
    const r = gruppiereObjekte(liste, { ...ohne, suche: 'xyz', angeheftet: 'einsatzort' });
    expect(r.einsatzort?.label).toBe('Hauptstraße 1');
  });
});

describe('zielSchluessel', () => {
  it('bildet das Platzierungsziel auf den Schlüssel der Liste ab', () => {
    expect(zielSchluessel({ typ: 'einsatzort', id: 0 })).toBe('einsatzort');
    expect(zielSchluessel({ typ: 'fuehrung', id: 3 })).toBe('fuehrung-3');
    expect(zielSchluessel(null)).toBeNull();
  });
});

describe('istWaehlbar', () => {
  it('verortete Zeilen und Abschnitte ohne Fläche sind ein Auswahlziel, andere nicht verortete nicht', () => {
    expect(istWaehlbar(e('uhs', 1, 'U'))).toBe(true);
    expect(istWaehlbar(e('abschnitt', 2, 'EA', false))).toBe(true);
    expect(istWaehlbar(e('fahrzeug', 3, 'F', false))).toBe(false);
    expect(istWaehlbar(e('einsatzort', 0, 'Einsatzort', false))).toBe(false);
  });
});

describe('TYP_REIHENFOLGE', () => {
  it('trägt genau die Markertypen, die OBJEKTART beschriftet — in beide Richtungen', () => {
    const typen = Object.keys(OBJEKTART).sort();
    expect([...TYP_REIHENFOLGE].sort()).toEqual(typen);
    expect(new Set(TYP_REIHENFOLGE).size).toBe(TYP_REIHENFOLGE.length);
  });

  it('beginnt mit dem Einsatzort, danach die Gruppen der Liste in ihrer Reihenfolge', () => {
    expect(TYP_REIHENFOLGE[0]).toBe('einsatzort');
    expect(TYP_REIHENFOLGE.slice(1)).toEqual(OBJEKT_GRUPPEN.map((g) => g.typ));
  });
});
