import { describe, expect, it } from 'vitest';
import type {
  BetreuungUebersicht,
  EinsatzAnzeige,
  PersonPerioden,
  Schaden,
  Verpflegung,
} from '../../api/types';
import type { AnzeigeKonventionen } from '../../anzeige/format';
import {
  BETROFFENEN_MERKMALE,
  daten,
  etbEintrag,
  lagebericht,
  periode,
  person,
  rohBericht,
} from './testdaten';
import {
  KEINE_EINTRAEGE,
  NICHT_GENUTZT,
  verdichteEinsatzbericht,
  type Abschnitt,
  type Einsatzbericht,
  type Inhalt,
} from './verdichtung';
import type { BlockSchluessel } from './quellen';

const konv: AnzeigeKonventionen = { zeitzone: 'Europe/Berlin' };

function block(b: Einsatzbericht, s: BlockSchluessel) {
  const gefunden = b.bloecke.find((x) => x.schluessel === s);
  if (!gefunden) throw new Error(`Block ${s} fehlt`);
  return gefunden;
}

function abschnitt(b: Einsatzbericht, s: BlockSchluessel, titel: string): Abschnitt {
  const a = block(b, s).abschnitte.find((x) => x.titel === titel);
  if (!a) throw new Error(`Abschnitt ${titel} fehlt in ${s}`);
  return a;
}

/** Wert einer Zeile über alle Zeilen-Inhalte eines Abschnitts. */
function wert(a: Abschnitt, etikett: string): string | undefined {
  for (const i of a.inhalt) {
    if (i.art === 'zeilen') {
      const z = i.zeilen.find((x) => x.etikett === etikett);
      if (z) return z.wert;
    }
  }
  return undefined;
}

function vermerke(a: Abschnitt): string[] {
  return a.inhalt.flatMap((i: Inhalt) => (i.art === 'vermerk' ? [i.text] : []));
}

function tabelle(a: Abschnitt) {
  const t = a.inhalt.find((i) => i.art === 'tabelle');
  if (!t || t.art !== 'tabelle') throw new Error(`keine Tabelle in ${a.titel}`);
  return t;
}

function einsatz(teil: Partial<EinsatzAnzeige>) {
  const roh = rohBericht();
  if (roh.quellen.einsatz.zustand !== 'daten') throw new Error('Testdaten');
  return daten({ ...roh.quellen.einsatz.daten, ...teil });
}

describe('verdichteEinsatzbericht – Blöcke', () => {
  it('liefert die sieben Blöcke in fester Reihenfolge', () => {
    const b = verdichteEinsatzbericht(rohBericht(), konv);
    expect(b.bloecke.map((x) => x.titel)).toEqual([
      'Stammdaten',
      'Zeiten',
      'Führung',
      'Kräfte',
      'Lage',
      'Bilanz',
      'ETB-Auszug',
    ]);
  });
});

describe('3.1 Stammdaten, Zeiten, Führung', () => {
  it('nennt die Stammdaten, fehlende Felder als „—“', () => {
    const b = verdichteEinsatzbericht(
      rohBericht({ einsatz: einsatz({ stichwort: null, leitstellen_nr: undefined }) }),
      konv,
    );
    const a = block(b, 'stammdaten').abschnitte[0];
    expect(wert(a, 'Bezeichnung')).toBe('Großbrand Halle 3');
    expect(wert(a, 'Einsatznummer')).toBe('E-2026-17');
    expect(wert(a, 'Einsatzart')).toBe('Realeinsatz');
    expect(wert(a, 'Einsatzort')).toBe('Hafenstraße 3');
    expect(wert(a, 'Meldende Stelle')).toBe('ILS Nord');
    expect(wert(a, 'Sachverhalt')).toBe('Vollbrand einer Lagerhalle');
    expect(wert(a, 'Stichwort')).toBe('—');
    expect(wert(a, 'Leitstellennummer')).toBe('—');
  });

  it('laufender Einsatz: vorläufig, Ende „läuft“, Dauer bis zum Stand über die Sommerzeitgrenze', () => {
    // Beginn 00:30 UTC = 01:30 MEZ, Stand 02:00 UTC = 04:00 MESZ (Umstellung 29.03.2026).
    const b = verdichteEinsatzbericht(rohBericht(), konv);
    expect(b.vorlaeufig).toBe(true);
    const a = block(b, 'zeiten').abschnitte[0];
    expect(wert(a, 'Beginn')).toBe('29.03.2026 01:30');
    expect(wert(a, 'Ende')).toBe('läuft');
    expect(wert(a, 'Dauer')).toBe('01:30 h (bis Stand)');
    expect(b.stand).toBe('290400MÄR2026');
  });

  it('abgeschlossener Einsatz: Ende und Dauer bis zum Abschluss, nicht vorläufig', () => {
    const b = verdichteEinsatzbericht(
      rohBericht({
        einsatz: einsatz({ status: 'abgeschlossen', abgeschlossen_at: '2026-03-29T01:10:00' }),
      }),
      konv,
    );
    expect(b.vorlaeufig).toBe(false);
    const a = block(b, 'zeiten').abschnitte[0];
    expect(wert(a, 'Ende')).toBe('29.03.2026 03:10');
    expect(wert(a, 'Dauer')).toBe('00:40 h');
  });

  it('Führung: Einsatzleitung aus den Mitgliedern, Stab S1–S6, Lagebesprechungen', () => {
    const b = verdichteEinsatzbericht(rohBericht(), konv);
    expect(wert(abschnitt(b, 'fuehrung', 'Einsatzleitung'), 'Einsatzleitung')).toBe('Max Leiter');
    const stab = abschnitt(b, 'fuehrung', 'Stab');
    expect(wert(stab, 'S1')).toBe('bei der Einsatzleitung');
    expect(wert(stab, 'S2')).toBe('Sven Lage');
    expect(wert(stab, 'S6')).toBe('nicht vergeben');
    const lb = tabelle(abschnitt(b, 'fuehrung', 'Lagebesprechungen'));
    expect(lb.zeilen).toEqual([['1', '29.03.2026 03:15', 'Riegelstellung halten']]);
  });

  it('Stab im Einsatz ausgeblendet: Vermerk statt Besetzung', () => {
    const b = verdichteEinsatzbericht(
      rohBericht({
        stab: { zustand: 'nicht-genutzt' },
        lagebesprechungen: { zustand: 'nicht-genutzt' },
      }),
      konv,
    );
    expect(vermerke(abschnitt(b, 'fuehrung', 'Stab'))).toEqual([NICHT_GENUTZT]);
    expect(vermerke(abschnitt(b, 'fuehrung', 'Lagebesprechungen'))).toEqual([NICHT_GENUTZT]);
  });
});

describe('3.2 Kräfte', () => {
  it('Stärke zum Druckzeitpunkt über die Wurzeln, Einheiten und Fahrzeuge', () => {
    const b = verdichteEinsatzbericht(rohBericht(), konv);
    const a = abschnitt(b, 'kraefte', 'Stärke zum Druckzeitpunkt');
    // Gruppe 1 ist Zug 1 unterstellt und zählt nicht doppelt.
    expect(wert(a, 'Stärke')).toBe('1/2/9//12');
    expect(wert(a, 'Einheiten')).toBe('2');
    expect(wert(a, 'Fahrzeuge')).toBe('2');
  });

  it('insgesamt eingesetzt: Kräfte mit Periode, Helferstunden und Abdeckung', () => {
    const b = verdichteEinsatzbericht(rohBericht(), konv);
    const a = abschnitt(b, 'kraefte', 'Insgesamt eingesetzt');
    expect(wert(a, 'Einheiten')).toBe('1');
    expect(wert(a, 'Personen')).toBe('2');
    // 60 min (abgeschlossen) + 60 min (offen bis Stand 02:00 UTC).
    expect(wert(a, 'Helferstunden')).toBe('2 h 00');
    expect(vermerke(a)).toContain('Zeitachse für 2 von 3 Personen erfasst');
  });

  it('ohne jede Periode: „keine Zeitachse erfasst“ statt 0', () => {
    const b = verdichteEinsatzbericht(
      rohBericht({ personalPerioden: daten([] as PersonPerioden[]), einheitenPerioden: daten([]) }),
      konv,
    );
    const a = abschnitt(b, 'kraefte', 'Insgesamt eingesetzt');
    expect(wert(a, 'Einheiten')).toBe('keine Zeitachse erfasst');
    expect(wert(a, 'Personen')).toBe('keine Zeitachse erfasst');
    expect(wert(a, 'Helferstunden')).toBe('keine Zeitachse erfasst');
  });

  it('eine offene Periode endet in einem abgeschlossenen Einsatz beim Abschluss', () => {
    const b = verdichteEinsatzbericht(
      rohBericht({
        einsatz: einsatz({ status: 'abgeschlossen', abgeschlossen_at: '2026-03-29T01:30:00' }),
        personalPerioden: daten([
          { personal_id: 12, perioden: [periode('2026-03-29T01:00:00', null)] },
        ] as PersonPerioden[]),
      }),
      konv,
    );
    expect(wert(abschnitt(b, 'kraefte', 'Insgesamt eingesetzt'), 'Helferstunden')).toBe('30 min');
  });

  it('nach Freigabe des Personals aller Einheiten Stärke 0/0/0//0, Einheiten insgesamt bleibt', () => {
    const leer = { fuehrer: 0, unterfuehrer: 0, mannschaft: 0 };
    const b = verdichteEinsatzbericht(
      rohBericht({
        einheiten: daten([
          { id: 1, ueber_einheit_id: null, ist_kumuliert: leer },
          { id: 2, ueber_einheit_id: 1, ist_kumuliert: leer },
        ] as never),
      }),
      konv,
    );
    expect(wert(abschnitt(b, 'kraefte', 'Stärke zum Druckzeitpunkt'), 'Stärke')).toBe('0/0/0//0');
    expect(wert(abschnitt(b, 'kraefte', 'Insgesamt eingesetzt'), 'Einheiten')).toBe('1');
  });

  it('Fahrzeuge im Einsatz ausgeblendet: die Zeile sagt es, die übrigen bleiben', () => {
    const b = verdichteEinsatzbericht(
      rohBericht({ fahrzeuge: { zustand: 'nicht-genutzt' } }),
      konv,
    );
    const a = abschnitt(b, 'kraefte', 'Stärke zum Druckzeitpunkt');
    expect(wert(a, 'Fahrzeuge')).toBe(NICHT_GENUTZT);
    expect(wert(a, 'Stärke')).toBe('1/2/9//12');
  });
});

describe('3.3 Lage', () => {
  it('Verzeichnis der freigegebenen Berichte nach Zeitstand, ohne Entwurf; letzter im Volltext', () => {
    const b = verdichteEinsatzbericht(
      rohBericht({
        lageberichte: daten([
          lagebericht({
            id: 3,
            titel: 'Lage 3',
            zeitstand: '2026-03-29T01:40:00',
            freigegeben_at: '2026-03-29T01:45:00',
            abschnitte: [{ schluessel: 'lage', text: 'Feuer aus.' }],
          }),
          lagebericht({ id: 1, titel: 'Erstlage' }),
          lagebericht({
            id: 2,
            titel: 'Lage 2',
            zeitstand: '2026-03-29T01:00:00',
            freigegeben_at: '2026-03-29T01:05:00',
          }),
          lagebericht({
            id: 4,
            titel: 'Entwurf',
            status: 'entwurf',
            freigegeben_at: null,
            zeitstand: '2026-03-29T01:50:00',
          }),
        ]),
      }),
      konv,
    );
    const verzeichnis = tabelle(abschnitt(b, 'lage', 'Verzeichnis der Lageberichte'));
    expect(verzeichnis.zeilen.map((z) => z[1])).toEqual(['Erstlage', 'Lage 2', 'Lage 3']);
    expect(verzeichnis.zeilen[0]).toEqual(['29.03.2026 01:45', 'Erstlage', 'v1', 'Max Leiter']);
    const voll = abschnitt(b, 'lage', 'Letzter Lagebericht: Lage 3');
    const md = voll.inhalt.find((i) => i.art === 'markdown');
    expect(md && md.art === 'markdown' ? md.abschnitte.map((x) => x.text) : []).toEqual([
      'Feuer aus.',
    ]);
  });

  it('eine Kette mit freigegebener v1 und Entwurf v2 erscheint mit v1', () => {
    const b = verdichteEinsatzbericht(
      rohBericht({
        lageberichte: daten([
          lagebericht({ id: 1, version: 1 }),
          lagebericht({
            id: 2,
            version: 2,
            vorgaenger_id: 1,
            status: 'entwurf',
            freigegeben_at: null,
          }),
        ]),
      }),
      konv,
    );
    const verzeichnis = tabelle(abschnitt(b, 'lage', 'Verzeichnis der Lageberichte'));
    expect(verzeichnis.zeilen).toHaveLength(1);
    expect(verzeichnis.zeilen[0][2]).toBe('v1');
  });

  it('fortgeschriebene und freigegebene v2 steht einmal mit v2', () => {
    const b = verdichteEinsatzbericht(
      rohBericht({
        lageberichte: daten([
          lagebericht({ id: 1, version: 1 }),
          lagebericht({
            id: 2,
            version: 2,
            vorgaenger_id: 1,
            freigegeben_at: '2026-03-29T01:20:00',
          }),
        ]),
      }),
      konv,
    );
    const verzeichnis = tabelle(abschnitt(b, 'lage', 'Verzeichnis der Lageberichte'));
    expect(verzeichnis.zeilen.map((z) => z[2])).toEqual(['v2']);
  });

  it('ohne freigegebenen Bericht „keine Einträge“', () => {
    const b = verdichteEinsatzbericht(
      rohBericht({
        lageberichte: daten([lagebericht({ status: 'entwurf', freigegeben_at: null })]),
      }),
      konv,
    );
    expect(vermerke(block(b, 'lage').abschnitte[0])).toEqual([KEINE_EINTRAEGE]);
  });
});

describe('3.4 Bilanz', () => {
  it('Personen nur als Zählung: Sichtung, Verbleib, Transporte, Status', () => {
    const b = verdichteEinsatzbericht(
      rohBericht({
        personen: daten([
          person({ id: 1, aktuelle_sichtung: 'sk1', aktuelle_verbleib_art: 'transport' }),
          person({ id: 2, aktuelle_sichtung: 'sk2' }),
          person({ id: 3, aktuelle_sichtung: null, status: 'vermisst' }),
        ]),
      }),
      konv,
    );
    const a = abschnitt(b, 'bilanz', 'Personen');
    expect(wert(a, 'Erfasst')).toBe('3');
    expect(wert(a, 'Patienten (SK I–IV)')).toBe('2');
    expect(wert(a, 'SK I')).toBe('1');
    expect(wert(a, 'SK II')).toBe('1');
    expect(wert(a, 'ohne Sichtung')).toBe('1');
    expect(wert(a, 'vermisst')).toBe('1');
    expect(wert(a, 'Transportiert')).toBe('1');
  });

  it('enthält keinen Namen, kein Geburtsdatum, keine Registriernummer Betroffener', () => {
    const text = JSON.stringify(verdichteEinsatzbericht(rohBericht(), konv));
    for (const merkmal of BETROFFENEN_MERKMALE) expect(text).not.toContain(merkmal);
  });

  it('Schäden nach Status und Ausmaß; ohne Schaden „keine Einträge“', () => {
    const b = verdichteEinsatzbericht(rohBericht(), konv);
    const a = abschnitt(b, 'bilanz', 'Schäden');
    expect(wert(a, 'Erfasst')).toBe('1');
    expect(wert(a, 'offen')).toBe('1');
    expect(wert(a, 'mittel')).toBe('1');
    const leer = verdichteEinsatzbericht(rohBericht({ schaeden: daten([] as Schaden[]) }), konv);
    expect(vermerke(abschnitt(leer, 'bilanz', 'Schäden'))).toEqual([KEINE_EINTRAEGE]);
  });

  it('Betreuung und Evakuierung aus Bezirken und Stellen; ausgeblendet mit Vermerk', () => {
    const b = verdichteEinsatzbericht(
      rohBericht({
        betreuung: daten({
          bezirke: [
            {
              raeumung: 'laufend',
              storniert_at: null,
              plan_personen: 40,
              plan_erhebung: 'gezaehlt',
              stand: { evakuiert: 25, erhebung: 'gezaehlt' },
            },
            {
              raeumung: 'laufend',
              storniert_at: null,
              plan_personen: 10,
              plan_erhebung: 'gezaehlt',
              stand: null,
            },
          ],
          stellen: [
            { storniert_at: null, kapazitaet_personen: 100, belegung: { belegt: 30 } },
            {
              storniert_at: '2026-03-29T01:00:00',
              kapazitaet_personen: 50,
              belegung: { belegt: 5 },
            },
          ],
        } as unknown as BetreuungUebersicht),
      }),
      konv,
    );
    const a = abschnitt(b, 'bilanz', 'Betreuung und Evakuierung');
    expect(wert(a, 'Evakuiert')).toBe('25 von 50 geplant');
    expect(wert(a, 'Bezirke ohne Standmeldung')).toBe('1');
    expect(wert(a, 'Betreuungsstellen')).toBe('1');
    expect(wert(a, 'Belegt')).toBe('30 von 100 Plätzen');
    const aus = verdichteEinsatzbericht(
      rohBericht({ betreuung: { zustand: 'nicht-genutzt' } }),
      konv,
    );
    expect(vermerke(abschnitt(aus, 'bilanz', 'Betreuung und Evakuierung'))).toEqual([
      NICHT_GENUTZT,
    ]);
  });

  it('Verpflegung als Summe über die Zeitfenster', () => {
    const b = verdichteEinsatzbericht(
      rohBericht({
        verpflegung: daten({
          zeitfenster: [
            { bedarf: { gesamt: 50 }, ausgegeben: { gesamt: 45 }, fehlmenge: { gesamt: 5 } },
            { bedarf: { gesamt: 30 }, ausgegeben: { gesamt: 30 }, fehlmenge: { gesamt: 0 } },
          ],
        } as unknown as Verpflegung),
      }),
      konv,
    );
    const a = abschnitt(b, 'bilanz', 'Verpflegung');
    expect(wert(a, 'Zeitfenster')).toBe('2');
    expect(wert(a, 'Bedarf (Portionen)')).toBe('80');
    expect(wert(a, 'Ausgegeben')).toBe('75');
    expect(wert(a, 'Fehlmenge')).toBe('5');
  });
});

describe('3.5 ETB-Auszug', () => {
  it('Einträge je Typ und Entscheidungen nach Nummer, berichtigte gekennzeichnet', () => {
    const b = verdichteEinsatzbericht(
      rohBericht({
        etbEntscheidungen: daten({
          eintraege: [
            etbEintrag({ id: 102, lfd_nr: 52, inhalt: 'Abschnitt Süd bilden' }),
            etbEintrag({ id: 100, lfd_nr: 37 }),
          ],
          berichtigungen: [
            etbEintrag({ id: 200, lfd_nr: 60, typ: 'berichtigung', berichtigt_eintrag_id: 100 }),
          ],
          hoechsteLfdNr: 52,
          geladenAt: '2026-03-29T02:00:00.000Z',
        }),
      }),
      konv,
    );
    const typen = abschnitt(b, 'etb', 'Einträge je Typ');
    expect(wert(typen, 'Gesamt')).toBe('3');
    expect(wert(typen, 'Meldung')).toBe('2');
    expect(wert(typen, 'Entscheidung')).toBe('1');
    const t = tabelle(abschnitt(b, 'etb', 'Entscheidungen'));
    expect(t.zeilen.map((z) => z[0])).toEqual(['37', '52']);
    expect(t.zeilen[0][3]).toBe('berichtigt durch Nr. 60');
    expect(t.zeilen[1][3]).toBe('');
  });

  it('ohne Entscheidungen „keine Einträge“', () => {
    const b = verdichteEinsatzbericht(
      rohBericht({
        etbEntscheidungen: daten({
          eintraege: [],
          berichtigungen: [],
          hoechsteLfdNr: null,
          geladenAt: '2026-03-29T02:00:00.000Z',
        }),
      }),
      konv,
    );
    expect(vermerke(abschnitt(b, 'etb', 'Entscheidungen'))).toEqual([KEINE_EINTRAEGE]);
  });
});
