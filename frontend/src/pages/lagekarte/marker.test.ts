import { describe, expect, it } from 'vitest';
import { theme } from 'antd';
import { serializeAnySpec } from '@einsatzzeichen/core';
import { PALETTE } from '@einsatzzeichen/schema';
import {
  buildFuehrungsstelleMarker,
  buildMarker,
  buildBetreuungMarker,
  buildBrMarker,
  buildTaktischeMarker,
  buildLageMeldungMarker,
  buildFreieZeichenMarker,
  FREIES_ZEICHEN_TINTE,
  abschnittOhneFlaeche,
  buildAbschnittMarker,
  type TaktischeQuelle,
} from './marker';
import { rollenFarbe } from '../../theme/statusFarben';
import { antdToken, farbenDunkel, type Dichte } from '../../theme/tokens';
import type {
  Betreuungsstelle,
  BrListenEintrag,
  EinsatzAnzeige,
  FreiesZeichen,
  Fuehrungsstelle,
  LageMeldung,
  LageMeldungStand,
  Schaden,
  Uhs,
} from '../../api/types';

/** `buildMarker` ist reine Ableitung — geprüft wird die Rolle, nicht der Tokenwert. */
const token = theme.getDesignToken();

function uhs(partial: Partial<Uhs>): Uhs {
  return {
    id: 1,
    einsatz_id: 1,
    abschnitt_id: null,
    typ: 'behandlungsplatz',
    bezeichnung: 'BHP 50',
    standort: null,
    notiz: null,
    status: 'aktiv',
    lat: null,
    lon: null,
    erfasst_at: '',
    erfasst_von: 1,
    geaendert_at: '',
    geaendert_von: 1,
    storniert_at: null,
    staerke: { fuehrer: 0, unterfuehrer: 0, mannschaft: 0 },
    ...partial,
  };
}
function schaden(partial: Partial<Schaden>): Schaden {
  return {
    id: 1,
    einsatz_id: 1,
    registrier_nr: 7,
    status: 'offen',
    typ: 'sachschaden',
    ausmass: 'gross',
    ort: 'Hauptstr.',
    lat: null,
    lon: null,
    beschreibung: '',
    geschaedigt_person_id: null,
    geschaedigt_personal_id: null,
    geschaedigt_organisation_id: null,
    geschaedigt_kontakt: null,
    uebergeben_an: null,
    uebergeben_at: null,
    abschluss_grund: null,
    abschluss_at: null,
    erfasst_at: '',
    erfasst_von: 1,
    geaendert_at: '',
    geaendert_von: 1,
    storniert_at: null,
    storniert_von: null,
    geschaedigt_registrier_nr: null,
    geschaedigt_storniert_at: null,
    geschaedigt_personal_name: null,
    geschaedigt_organisation_name: null,
    ...partial,
  };
}

describe('buildMarker', () => {
  it('trennt verortete von nicht-verorteten Objekten', () => {
    const einsatz = { einsatzort: 'ELW', einsatzort_lat: 50, einsatzort_lon: 8 } as EinsatzAnzeige;
    const { verortet, nichtVerortet } = buildMarker(
      einsatz,
      [
        uhs({ id: 5, lat: 50.1, lon: 8.1 }),
        uhs({ id: 6, bezeichnung: 'PA', lat: null, lon: null }),
      ],
      [
        schaden({ id: 9, registrier_nr: 3, lat: 51, lon: 7 }),
        schaden({ id: 10, registrier_nr: 4 }),
      ],
      token,
    );
    expect(verortet.map((m) => m.schluessel)).toEqual(['einsatzort', 'uhs-5', 'schaden-9']);
    expect(nichtVerortet).toEqual([
      { typ: 'uhs', id: 6, label: 'PA' },
      { typ: 'schaden', id: 10, label: 'S-004' },
    ]);
  });

  it('lässt den Einsatzort weg, wenn er keine Koordinate hat', () => {
    const einsatz = {
      einsatzort: null,
      einsatzort_lat: null,
      einsatzort_lon: null,
    } as EinsatzAnzeige;
    const { verortet } = buildMarker(einsatz, [], [], token);
    expect(verortet).toHaveLength(0);
  });

  it('färbt Schaden-Marker nach Ausmaß', () => {
    const { verortet } = buildMarker(
      undefined,
      [],
      [schaden({ id: 1, ausmass: 'katastrophal', lat: 51, lon: 7 })],
      token,
    );
    expect(verortet[0].farbe).toBe('#f5222d');
  });

  it('nutzt Fallback-Farbe bei unbekanntem Ausmaß', () => {
    const { verortet } = buildMarker(
      undefined,
      [],
      [schaden({ id: 1, ausmass: 'unbekannt' as never, lat: 51, lon: 7 })],
      token,
    );
    expect(verortet[0].farbe).toBe('#8c8c8c');
  });

  it('kommt mit undefined-Einsatz klar', () => {
    expect(buildMarker(undefined, [], [], token)).toEqual({ verortet: [], nichtVerortet: [] });
  });

  it('setzt taktische Zeichen für Einsatzort, UHS (je Typ) und Schaden', () => {
    const einsatz = { einsatzort: 'ELW', einsatzort_lat: 50, einsatzort_lon: 8 } as EinsatzAnzeige;
    const { verortet } = buildMarker(
      einsatz,
      [uhs({ id: 5, typ: 'patientenablage', lat: 50.1, lon: 8.1 })],
      [schaden({ id: 9, ausmass: 'mittel', lat: 51, lon: 7 })],
      token,
    );
    const byKey = (k: string) => verortet.find((m) => m.schluessel === k);
    expect(byKey('einsatzort')?.tz?.grundzeichen).toBe('anlass');
    expect(byKey('uhs-5')?.tz).toEqual({
      grundzeichen: 'stelle',
      symbol: 'sammelplatz-betroffene',
    });
    expect(byKey('schaden-9')?.tz).toEqual({ grundzeichen: 'gefahr', farbe: '#faad14' });
  });

  // Der Einsatzort ist der Ankerpunkt des eigenen Einsatzes (Marke), kein Gefahrenobjekt — mit
  // `alarm` trüge dieselbe Farbe Gefahrengebiet und Ortssignatur. Der Gate-5-Hexscan sieht nur,
  // dass kein Literal dasteht, nicht welche Rolle; deshalb steht die Zuordnung hier.
  it('färbt Einsatzort mit der Marken- und UHS mit der Bedienrolle (nicht Alarm)', () => {
    const einsatz = { einsatzort: 'ELW', einsatzort_lat: 50, einsatzort_lon: 8 } as EinsatzAnzeige;
    const { verortet } = buildMarker(einsatz, [uhs({ id: 5, lat: 50.1, lon: 8.1 })], [], token);
    const byKey = (k: string) => verortet.find((m) => m.schluessel === k);

    expect(byKey('einsatzort')?.farbe).toBe(rollenFarbe('marke', token));
    expect(byKey('einsatzort')?.farbe).not.toBe(rollenFarbe('alarm', token));
    expect(byKey('uhs-5')?.farbe).toBe(rollenFarbe('bedien', token));
    expect(byKey('uhs-5')?.farbe).not.toBe(rollenFarbe('marke', token));
  });

  // UHS tragen keine eigene Organisation; ihr Zeichen steht in der des Betreibers (LLH-1161).
  it('zeichnet die UHS in der Organisations-Vorgabe des Hubs, ohne Vorgabe neutral', () => {
    const liste = [uhs({ id: 5, lat: 50.1, lon: 8.1 })];
    const tz = (org?: string | null) =>
      buildMarker(undefined, liste, [], token, org).verortet.find((m) => m.schluessel === 'uhs-5')
        ?.tz;
    expect(tz('feuerwehr')).toMatchObject({ grundzeichen: 'stelle', organisation: 'feuerwehr' });
    expect(tz(null)).not.toHaveProperty('organisation');
    expect(tz()).not.toHaveProperty('organisation');
  });
});

/** Drahtform eines Lage-Stands von vor LLH-1031: ohne Art, Priorität, Status, Richtung, Gerät. */
function lageMeldung(partial: Partial<LageMeldungStand>): LageMeldungStand {
  return {
    id: 1,
    einsatz_id: 1,
    meldung_id: 3,
    text: 'Brücke gesperrt',
    lat: null,
    lon: null,
    erstellt_von_id: 1,
    erstellt_at: '',
    ereigniszeit: '',
    meldung_lfd_nr: 5,
    meldung_absender: 'Florian Nord 1',
    is_neu: false,
    ...partial,
  };
}

function stelle(partial: Partial<Betreuungsstelle>): Betreuungsstelle {
  return {
    id: 3,
    einsatz_id: 1,
    bezeichnung: 'NU Turnhalle Nord',
    art: 'notunterkunft',
    status: 'in_betrieb',
    angelegt_at: '2026-09-24 08:00:00',
    ...partial,
  };
}

describe('buildBetreuungMarker (LFH-673)', () => {
  it('verortete Stelle wird Marker mit Zeichen Stelle/Betreuung und Bedienrolle', () => {
    const { verortet, nichtVerortet } = buildBetreuungMarker(
      [stelle({ lat: 51.93, lon: 8.87 })],
      token,
    );
    expect(nichtVerortet).toEqual([]);
    expect(verortet).toEqual([
      {
        schluessel: 'betreuungsstelle-3',
        typ: 'betreuungsstelle',
        id: 3,
        lat: 51.93,
        lon: 8.87,
        label: 'NU Turnhalle Nord',
        farbe: rollenFarbe('bedien', token),
        tz: { grundzeichen: 'stelle', fachaufgabe: 'betreuung' },
        trefferDurchmesser: token.controlHeight,
      },
    ]);
  });
  it('unverortete Stelle steht in „Nicht verortet", stornierte nirgends', () => {
    const { verortet, nichtVerortet } = buildBetreuungMarker(
      [
        stelle({ id: 4, bezeichnung: 'AS Rathaus' }),
        stelle({ id: 5, lat: 1, lon: 2, storniert_at: '2026-09-24 09:00:00' }),
        stelle({ id: 6, storniert_at: '2026-09-24 09:00:00' }),
      ],
      token,
    );
    expect(verortet).toEqual([]);
    expect(nichtVerortet).toEqual([{ typ: 'betreuungsstelle', id: 4, label: 'AS Rathaus' }]);
  });
  it('zeichnet die Stelle in der Organisations-Vorgabe des Hubs (LLH-1161)', () => {
    const { verortet } = buildBetreuungMarker([stelle({ lat: 1, lon: 2 })], token, 'thw');
    expect(verortet[0].tz).toEqual({
      grundzeichen: 'stelle',
      fachaufgabe: 'betreuung',
      organisation: 'thw',
    });
  });
});

describe('buildLageMeldungMarker', () => {
  it('erzeugt Marker nur für verortete Lagemeldungen, mit Herkunfts-Info', () => {
    const marker = buildLageMeldungMarker(
      [lageMeldung({ id: 4, lat: 50.3, lon: 8.7 }), lageMeldung({ id: 5, lat: null, lon: null })],
      token,
    );
    expect(marker.map((m) => m.schluessel)).toEqual(['lagemeldung-4']);
    expect(marker[0].typ).toBe('lagemeldung');
    expect(marker[0].lageMeldung).toEqual({
      meldungId: 3,
      meldungLfdNr: 5,
      absender: 'Florian Nord 1',
      inhalt: 'Brücke gesperrt',
    });
  });

  it('zeichnet eine Lagemeldung der heutigen Form wie die eines alten Lage-Stands', () => {
    const heute: LageMeldung = {
      ...lageMeldung({ id: 3, lat: 50.3, lon: 8.7 }),
      meldungsart: 'lagemeldung',
      prioritaet: 'normal',
      meldung_status: 'neu',
      richtung: 'extern',
      is_von_geraet: false,
    };
    const alt = lageMeldung({ id: 3, lat: 50.3, lon: 8.7 });
    expect(buildLageMeldungMarker([heute], token)).toEqual(buildLageMeldungMarker([alt], token));
  });

  it('setzt kein taktisches Zeichen (Lagemeldung bleibt Kreis)', () => {
    const marker = buildLageMeldungMarker([lageMeldung({ id: 4, lat: 50.3, lon: 8.7 })], token);
    expect(marker[0].tz).toBeUndefined();
  });
});

describe('buildTaktischeMarker', () => {
  it('leitet taktische Marker + nicht-verortet ab', () => {
    const einheiten = [
      {
        id: 1,
        name: 'Zug 1',
        typ_label: 'Zug',
        lat: 50.1,
        lon: 8.6,
        tz_fachaufgabe: 'rettungswesen',
        tz_organisation: null,
      },
      {
        id: 2,
        name: 'Gruppe 2',
        typ_label: 'Gruppe',
        lat: null,
        lon: null,
        tz_fachaufgabe: null,
        tz_organisation: null,
      },
    ] as unknown as TaktischeQuelle['einheiten'];
    const { verortet, nichtVerortet } = buildTaktischeMarker(
      {
        einheiten,
        fahrzeuge: [],
        fuehrungskraefte: [],
        orgDefault: 'hilfsorganisation',
      },
      token,
    );
    expect(verortet.find((m) => m.schluessel === 'einheit-1')?.tz?.grundzeichen).toBe(
      'taktische-formation',
    );
    expect(nichtVerortet.some((o) => o.typ === 'einheit' && o.id === 2)).toBe(true);
  });

  it('reicht Fahrzeugtyp/OPTA/Träger an die TZ-Ableitung durch (LFH-171)', () => {
    const fahrzeuge = [
      {
        id: 7,
        funkrufname: 'Florian 1',
        lat: 50.2,
        lon: 8.7,
        tz_fachaufgabe: null,
        tz_organisation: null,
        status_farbe: null,
        fahrzeugtyp: 'MZB',
        opta: null,
        traegerorganisation: 'Feuerwehr',
      },
    ] as unknown as TaktischeQuelle['fahrzeuge'];
    const { verortet } = buildTaktischeMarker(
      {
        einheiten: [],
        fahrzeuge,
        fuehrungskraefte: [],
        orgDefault: null,
      },
      token,
    );
    const tz = verortet.find((m) => m.schluessel === 'fahrzeug-7')?.tz;
    expect(tz?.grundzeichen).toBe('wasserfahrzeug');
    expect(tz?.organisation).toBe('feuerwehr');
  });

  it('reicht Funktion + Führungskraft-Flag an die Personen-TZ-Ableitung durch (LFH-172)', () => {
    const fuehrungskraefte = [
      {
        id: 3,
        name: 'Müller',
        lat: 50.4,
        lon: 8.9,
        tz_fachaufgabe: null,
        tz_organisation: null,
        funktion: 'Notfallsanitäter, Gruppenführer',
        ist_einheitsfuehrer: true,
        ist_abschnittsleiter: false,
      },
    ] as unknown as TaktischeQuelle['fuehrungskraefte'];
    const { verortet } = buildTaktischeMarker(
      {
        einheiten: [],
        fahrzeuge: [],
        fuehrungskraefte,
        orgDefault: null,
      },
      token,
    );
    const tz = verortet.find((m) => m.schluessel === 'fuehrung-3')?.tz;
    expect(tz?.funktion).toBe('fuehrungskraft');
    expect(tz?.fachaufgabe).toBe('rettungswesen');
  });

  it('leitet das Zeichen nur aus der Qualifikation ab, nie aus der Einsatzfunktion (LLH-1239)', () => {
    const person = (id: number, funktion: string | null) => ({
      id,
      name: `Person ${id}`,
      lat: 50.4,
      lon: 8.9,
      tz_fachaufgabe: null,
      tz_organisation: null,
      funktion,
      einsatzfunktion: 'Sprechfunker',
      ist_einheitsfuehrer: false,
      ist_abschnittsleiter: false,
    });
    const { verortet } = buildTaktischeMarker(
      {
        einheiten: [],
        fahrzeuge: [],
        fuehrungskraefte: [
          person(4, 'Notfallsanitäter'),
          person(5, null),
        ] as unknown as TaktischeQuelle['fuehrungskraefte'],
        orgDefault: null,
      },
      token,
    );
    const mitQualifikation = verortet.find((m) => m.schluessel === 'fuehrung-4');
    // „Sprechfunker“ ergäbe über `fachaufgabeAusFunktion` IuK.
    expect(mitQualifikation?.tz?.fachaufgabe).toBe('rettungswesen');
    expect(mitQualifikation?.label).toBe('Person 4');
    expect(verortet.find((m) => m.schluessel === 'fuehrung-5')?.tz?.fachaufgabe).toBe('fuehrung');
  });
});

function freiesZeichen(partial: Partial<FreiesZeichen>): FreiesZeichen {
  return {
    id: 1,
    einsatz_id: 1,
    lat: 50,
    lon: 8,
    grundzeichen: 'taktische-formation',
    organisation: null,
    fachaufgabe: null,
    symbol: null,
    einheit: null,
    funktion: null,
    farbe: null,
    label: null,
    erstellt_von: 1,
    erstellt_at: '',
    geaendert_at: '',
    ...partial,
  };
}

describe('buildFreieZeichenMarker', () => {
  it('baut Karten-Marker mit stabilem Schlüssel, Typ und dem gespeicherten Zeichen', () => {
    const zeichen_spec = serializeAnySpec({ kind: 'hazard', technicalFill: 'gelb' });
    const marker = buildFreieZeichenMarker(
      [
        freiesZeichen({
          id: 7,
          lat: 50.1,
          lon: 8.1,
          grundzeichen: null,
          zeichen_spec,
          label: 'Sammelplatz',
        }),
      ],
      token,
    );
    expect(marker).toHaveLength(1);
    expect(marker[0].schluessel).toBe('freies_zeichen-7');
    expect(marker[0].typ).toBe('freies_zeichen');
    expect(marker[0].id).toBe(7);
    expect(marker[0].lat).toBe(50.1);
    expect(marker[0].label).toBe('Sammelplatz');
    // Die Füllung aus der Palette ist die Markerfarbe (D6).
    expect(marker[0].farbe).toBe(PALETTE.gelb);
    expect(marker[0].freiesZeichen?.zeichen_spec).toBe(zeichen_spec);
    // Kein Hub-Vokabular am freien Zeichen: das Bild kommt allein aus dem Leseadapter (D8).
    expect(marker[0].tz).toBeUndefined();
  });

  it('trägt die Altfelder eines Altzeichens unverändert zum Leseadapter', () => {
    const [m] = buildFreieZeichenMarker(
      [freiesZeichen({ grundzeichen: 'gefahr', symbol: 'abc', farbe: '#cc0000' })],
      token,
    );
    expect(m.freiesZeichen).toMatchObject({
      grundzeichen: 'gefahr',
      symbol: 'abc',
      farbe: '#cc0000',
    });
    // Alt-Hex an der Gefahr → Palettenrot.
    expect(m.farbe).toBe(PALETTE.rot);
  });

  it('nutzt sinnvolle Defaults für label und farbe, wenn nicht gesetzt', () => {
    const marker = buildFreieZeichenMarker(
      [freiesZeichen({ id: 2, label: null, farbe: null })],
      token,
    );
    expect(marker[0].label).toBe('(freies Zeichen)');
    // Ohne Füllung die Kartentinte wie ein Fachobjekt-Zeichen (Spec `lagekarte-taktische-zeichen`).
    expect(marker[0].farbe).toBe(FREIES_ZEICHEN_TINTE);
  });
});

/**
 * Trefferzone der Kräfte- und Objektmarker: jeder Builder der Lagekarte setzt `trefferDurchmesser`
 * aus `controlHeight`. Staffel aus dem echten Dichte-Helfer (`antdToken`), die Böden als Literale.
 */
describe('Trefferzone je Dichtestufe (LFH-711)', () => {
  const STUFEN = [
    { dichte: 'kompakt', boden: 30 },
    { dichte: 'handschuh', boden: 72 },
  ] as const;
  const tokenFuer = (dichte: Dichte) =>
    theme.getDesignToken({ token: antdToken(farbenDunkel, dichte) });

  function alleLagekartenMarker(t: ReturnType<typeof tokenFuer>) {
    const einsatz = {
      einsatzort_lat: 50,
      einsatzort_lon: 8,
      einsatzort: 'Marktplatz',
    } as unknown as EinsatzAnzeige;
    const objekte = buildMarker(
      einsatz,
      [uhs({ id: 5, lat: 50.1, lon: 8.1 })],
      [schaden({ id: 9, lat: 50.2, lon: 8.2 })],
      t,
    ).verortet;
    const stellen = buildBetreuungMarker([stelle({ lat: 51.93, lon: 8.87 })], t).verortet;
    const kraefte = buildTaktischeMarker(
      {
        einheiten: [
          { id: 1, name: 'Zug 1', typ_label: 'Zug', lat: 50.1, lon: 8.6 },
        ] as unknown as TaktischeQuelle['einheiten'],
        fahrzeuge: [
          { id: 7, funkrufname: 'Florian 1', lat: 50.2, lon: 8.7, status_farbe: '#0a0' },
        ] as unknown as TaktischeQuelle['fahrzeuge'],
        fuehrungskraefte: [
          { id: 3, name: 'Meier', lat: 50.3, lon: 8.8 },
        ] as unknown as TaktischeQuelle['fuehrungskraefte'],
        orgDefault: null,
      },
      t,
    ).verortet;
    const abschnitt = buildAbschnittMarker(
      { id: 4, name: 'EA Nord', tz_fachaufgabe: null, tz_organisation: null },
      {
        type: 'Polygon',
        coordinates: [
          [
            [8, 50],
            [8.1, 50],
            [8.1, 50.1],
            [8, 50],
          ],
        ],
      },
      [8.05, 50.05],
      null,
      t,
    );
    const meldungen = buildLageMeldungMarker([lageMeldung({ id: 4, lat: 50.3, lon: 8.7 })], t);
    const zeichen = buildFreieZeichenMarker([freiesZeichen({ id: 2, lat: 50.4, lon: 8.4 })], t);
    return [...objekte, ...stellen, ...kraefte, abschnitt, ...meldungen, ...zeichen];
  }

  it('deckt jede Markersorte der Lagekarte ab (außer den Betroffenen, die LFH-650 trägt)', () => {
    // Selbstprobe: fehlt hier eine Sorte, prüfte der nächste Test sie nicht.
    const typen = new Set(alleLagekartenMarker(tokenFuer('kompakt')).map((m) => m.typ));
    expect([...typen].sort()).toEqual(
      [
        'abschnitt',
        'betreuungsstelle',
        'einheit',
        'einsatzort',
        'fahrzeug',
        'freies_zeichen',
        'fuehrung',
        'lagemeldung',
        'schaden',
        'uhs',
      ].sort(),
    );
  });

  for (const { dichte, boden } of STUFEN) {
    it(`setzt trefferDurchmesser = controlHeight in „${dichte}" (${boden} px)`, () => {
      for (const m of alleLagekartenMarker(tokenFuer(dichte))) {
        expect(m.trefferDurchmesser, m.schluessel).toBe(boden);
      }
    });
  }

  it('die Stufe schlägt durch: kompakt ist streng kleiner als handschuh', () => {
    // Gegenprobe: ein Boden allein belegte nicht, dass die Zone der Stufe folgt.
    const k = alleLagekartenMarker(tokenFuer('kompakt'))[0].trefferDurchmesser!;
    const h = alleLagekartenMarker(tokenFuer('handschuh'))[0].trefferDurchmesser!;
    expect(k).toBeLessThan(h);
  });
});

describe('buildFuehrungsstelleMarker (LFH-1181)', () => {
  const fs = (p: Partial<Fuehrungsstelle> = {}): Fuehrungsstelle => ({
    art: 'mobil',
    sprechgruppen: [],
    verbindungen: [],
    fahrzeug_ids: [],
    ...p,
  });

  it('setzt mit Koordinate das Zeichen „Befehlsstelle“ und die Bezeichnung', () => {
    const m = buildFuehrungsstelleMarker(
      fs({ bezeichnung: 'ELW 2 Musterstadt', standort_lat: 52.1, standort_lon: 9.9 }),
      token,
    );
    expect(m).toMatchObject({
      schluessel: 'fuehrungsstelle',
      typ: 'fuehrungsstelle',
      id: 0,
      lat: 52.1,
      lon: 9.9,
      label: 'ELW 2 Musterstadt',
      tz: { grundzeichen: 'befehlsstelle' },
      trefferDurchmesser: token.controlHeight,
    });
  });

  it('heißt ohne Bezeichnung „Führungsstelle“', () => {
    const m = buildFuehrungsstelleMarker(fs({ standort_lat: 52.1, standort_lon: 9.9 }), token);
    expect(m?.label).toBe('Führungsstelle');
  });

  it('fehlt ohne Koordinate, auch mit Adresse', () => {
    expect(buildFuehrungsstelleMarker(fs({ standort_adresse: 'Rathaus' }), token)).toBeNull();
    expect(buildFuehrungsstelleMarker(undefined, token)).toBeNull();
  });
});

function raum(partial: Partial<BrListenEintrag>): BrListenEintrag {
  return {
    id: 7,
    einsatz_id: 1,
    bezeichnung: 'BR Sportplatz',
    status: 'aktiv',
    erfasst_at: '2026-10-16 08:00:00',
    erfasst_von: 1,
    geaendert_at: '2026-10-16 08:00:00',
    geaendert_von: 1,
    belegung: { einheiten: 0, fahrzeuge: 0 },
    einheit_ids: [],
    abrufe: [],
    ...partial,
  };
}

const zug = {
  id: 10,
  ueber_einheit_id: null,
  ist: { fuehrer: 0, unterfuehrer: 2, mannschaft: 9 },
};

describe('buildBrMarker (LLH-1107)', () => {
  it('verorteter Raum wird Marker mit Bedienrolle und Trefferzone', () => {
    const { verortet, nichtVerortet } = buildBrMarker([raum({ lat: 51.93, lon: 8.87 })], [], token);
    expect(nichtVerortet).toEqual([]);
    expect(verortet).toEqual([
      {
        schluessel: 'bereitstellungsraum-7',
        typ: 'bereitstellungsraum',
        id: 7,
        lat: 51.93,
        lon: 8.87,
        label: 'BR Sportplatz',
        farbe: rollenFarbe('bedien', token),
        trefferDurchmesser: token.controlHeight,
      },
    ]);
  });

  it('beschriftet mit Stärke und Fahrzeugen aus der Belegung („Eine Heimat je Zahl")', () => {
    const { verortet } = buildBrMarker(
      [
        raum({
          lat: 51.93,
          lon: 8.87,
          einheit_ids: [10],
          belegung: { einheiten: 1, fahrzeuge: 3 },
        }),
      ],
      [zug],
      token,
    );
    expect(verortet[0].beschriftungZusatz).toBe('0/2/9//11 · 3 Fz');
  });

  it('lässt eine unvollständige Stärke weg statt einer zu kleinen Zahl, die Fahrzeuge bleiben', () => {
    const { verortet } = buildBrMarker(
      [raum({ lat: 1, lon: 2, einheit_ids: [10, 99], belegung: { einheiten: 2, fahrzeuge: 1 } })],
      [zug],
      token,
    );
    expect(verortet[0].beschriftungZusatz).toBe('1 Fz');
    // Ohne Einheitenliste (Modul gesperrt) ebenso.
    const ohneListe = buildBrMarker(
      [raum({ lat: 1, lon: 2, einheit_ids: [10], belegung: { einheiten: 1, fahrzeuge: 0 } })],
      undefined,
      token,
    );
    expect(ohneListe.verortet[0].beschriftungZusatz).toBeUndefined();
  });

  it('geplanter Raum ist gestrichelt und sagt es als Wort', () => {
    const { verortet } = buildBrMarker([raum({ lat: 1, lon: 2, status: 'geplant' })], [], token);
    expect(verortet[0].isGeplant).toBe(true);
    expect(verortet[0].beschriftungZusatz).toBe('geplant');
    const aktiv = buildBrMarker([raum({ lat: 1, lon: 2 })], [], token);
    expect(aktiv.verortet[0].isGeplant).toBeUndefined();
  });

  it('unverorteter Raum steht in „Nicht verortet", aufgelöste und stornierte nirgends', () => {
    const { verortet, nichtVerortet } = buildBrMarker(
      [
        raum({ id: 8, bezeichnung: 'BR Nord', status: 'geplant' }),
        raum({ id: 9, lat: 1, lon: 2, status: 'aufgeloest' }),
        raum({ id: 11, status: 'aufgeloest' }),
        raum({ id: 12, lat: 1, lon: 2, status: 'geplant', storniert_at: '2026-10-16 09:00:00' }),
      ],
      [],
      token,
    );
    expect(verortet).toEqual([]);
    expect(nichtVerortet).toEqual([{ typ: 'bereitstellungsraum', id: 8, label: 'BR Nord' }]);
  });
});

describe('abschnittOhneFlaeche (LLH-1033)', () => {
  it('trägt Schlüssel, Namen und Zeichen wie der Flächen-Abschnitt, aber keine Geometrie', () => {
    const m = abschnittOhneFlaeche(
      { id: 5, name: 'EA Süd', tz_fachaufgabe: null, tz_organisation: null },
      null,
    );
    expect(m).toMatchObject({
      schluessel: 'abschnitt-5',
      typ: 'abschnitt',
      id: 5,
      label: 'EA Süd',
    });
    expect(m.geometrie).toBeUndefined();
    expect(m.tz).toBeDefined();
  });
});
