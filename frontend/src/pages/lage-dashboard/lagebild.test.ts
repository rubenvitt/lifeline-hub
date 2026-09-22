import { describe, expect, it } from 'vitest';
import type {
  Auftrag,
  EinsatzAnzeige,
  Gefahrengebiet,
  Meldung,
  PegelAnzeige,
  Person,
} from '../../api/types';
import {
  baueLagebild,
  einsatzdauer,
  lagebildZeit,
  standText,
  warnstufeTon,
  wireAlsEpoche,
  type Rohdaten,
} from './lagebild';

/** Feste Zone, damit die Erwartungen nicht von der Maschine abhängen. */
const BERLIN = { zeitzone: 'Europe/Berlin' };

/** 2026-06-11 12:00:00 UTC als Epoche — der „Jetzt"-Punkt der Tests. */
const JETZT = Date.UTC(2026, 5, 11, 12, 0, 0);

const roh = (over: Partial<Rohdaten> = {}): Rohdaten => ({
  einsatz: {
    id: 1,
    bezeichnung: 'Hochwasser',
    begonnen_at: '2026-06-11 05:19:00',
    abgeschlossen_at: null,
    status: 'aktiv',
  } as EinsatzAnzeige,
  personen: [],
  uhs: [],
  schaeden: [],
  gefahren: [],
  lageberichte: [],
  einheiten: [],
  personal: [],
  fahrzeuge: [],
  material: [],
  abschnitte: [],
  auftraege: [],
  meldungen: [],
  pegel: [],
  ...over,
});

describe('einsatzdauer', () => {
  it('rechnet Stunden und Minuten seit Beginn', () => {
    expect(einsatzdauer('2026-06-11 05:19:00', JETZT)).toBe('6:41');
  });

  it('läuft über 24 Stunden hinaus weiter, statt auf null zu springen', () => {
    expect(einsatzdauer('2026-06-10 09:55:00', JETZT)).toBe('26:05');
  });

  it('endet am Abschluss, nicht an der Uhr', () => {
    expect(einsatzdauer('2026-06-11 05:00:00', JETZT, '2026-06-11 07:30:00')).toBe('2:30');
  });

  it('liefert für einen Beginn in der Zukunft oder Unlesbares keine negative Dauer', () => {
    expect(einsatzdauer('2026-06-11 13:00:00', JETZT)).toBe('—:——');
    expect(einsatzdauer('kaputt', JETZT)).toBe('—:——');
  });

  it('liest den Wirestring als UTC', () => {
    expect(wireAlsEpoche('2026-06-11 12:00:00')).toBe(JETZT);
  });
});

describe('standText', () => {
  it('nennt Sekunden, dann Minuten, dann die Uhrzeit in der Anzeigezone', () => {
    expect(standText(JETZT - 40_000, JETZT)).toBe('Stand vor 40 s');
    expect(standText(JETZT - 5 * 60_000, JETZT)).toBe('Stand vor 5 min');
    // 10:00 UTC → 12:00 Sommerzeit in Berlin.
    expect(standText(JETZT - 2 * 3_600_000, JETZT, BERLIN)).toBe('Stand 12:00');
  });

  it('ohne Abruf behauptet sie keinen Stand', () => {
    expect(standText(0, JETZT)).toBe('Stand wird abgerufen');
  });
});

describe('lagebildZeit', () => {
  it('formatiert „TT.MM. HH:MM" in der Anzeigezone', () => {
    expect(lagebildZeit(JETZT, BERLIN)).toBe('11.06. 14:00');
  });
});

describe('warnstufeTon', () => {
  it('liest die Kennzahl-Lesart: keine/niedrig neutral, mittel achtung, hoch/akut alarm', () => {
    expect(
      ['keine', 'niedrig', 'mittel', 'hoch', 'akut'].map((w) => warnstufeTon(w as never)),
    ).toEqual(['neutral', 'neutral', 'achtung', 'alarm', 'alarm']);
  });
});

describe('baueLagebild', () => {
  it('liefert das Kennzahl-Set des Neuentwurfs in fester Reihenfolge', () => {
    const bild = baueLagebild(roh(), JETZT, BERLIN);
    // Handgeschrieben: Pegel auf Platz 1, „Höchste Warnstufe" ist raus (LFH-606).
    expect(bild.kennzahlen.map((k) => k.etikett)).toEqual([
      'Pegel',
      'Betroffene',
      'Kräfte',
      'Vermisste',
      'Schäden offen',
      'Einsatzdauer',
    ]);
  });

  it('Einsatzdauer: Wert, Einheit und Beginn in der Anzeigezone', () => {
    const dauer = baueLagebild(roh(), JETZT, BERLIN).kennzahlen[5];
    expect(dauer.wert).toBe('6:41');
    expect(dauer.einheit).toBe('h');
    // 05:19 UTC → 07:19 Berlin; derselbe Tag wie „jetzt" braucht keinen Tag.
    expect(dauer.notiz).toMatch(/^seit (\d{2}\. )?07:19$/);
  });

  it('Betroffene zählen alle, die Notiz nur Patienten (SK I–IV)', () => {
    const p = (s: Person['aktuelle_sichtung'], status: Person['status'] = 'betroffen') =>
      ({ aktuelle_sichtung: s, status }) as Person;
    const bild = baueLagebild(
      roh({ personen: [p('sk1'), p('sk4'), p('unverletzt'), p(null, 'vermisst')] }),
      JETZT,
    );
    expect(bild.kennzahlen[1]).toMatchObject({ wert: '4', notiz: '2 Patienten', ton: 'neutral' });
    expect(bild.kennzahlen[3]).toMatchObject({ wert: '1', ton: 'alarm' });
  });

  it('die Warnstufe kommt aus der Gebiets-Übersicht — für den Kopf-Hinweis, nicht fürs Band', () => {
    const bild = baueLagebild(
      roh({ gefahren: [{ hoechste_warnstufe: 'mittel' } as Gefahrengebiet] }),
      JETZT,
    );
    expect(bild.hoechsteWarnstufe).toBe('mittel');
    expect(bild.kennzahlen.map((k) => k.wert)).not.toContain('mittel');
  });

  it('Pegel: Leitpegel mit Messung auf Platz 1, Ziel ist die Einstellungssektion', () => {
    const p = {
      id: 1,
      station_uuid: '47174d8f-1b8e-4599-8a59-b580dd55bc87',
      name: 'HANN. MÜNDEN',
      gewaesser: 'WESER',
      reihenfolge: 0,
      // 11:05 UTC in Berliner Sommerzeit geschrieben; JETZT ist 12:00 UTC → 55 min alt.
      messung: { wasserstand_cm: 684, zeitpunkt: '2026-06-11T13:05:00+02:00', trend_cm_pro_h: 9 },
    } as PegelAnzeige;
    const k = baueLagebild(roh({ pegel: [p] }), JETZT, BERLIN).kennzahlen[0];
    expect(k).toMatchObject({ etikett: 'Pegel', wert: '6,84', einheit: 'm', ton: 'neutral' });
    expect(k.notiz).toBe('WESER · steigend +9 cm/h · Stand 13:05');
    expect(k.zielPfad).toBe('/einsaetze/1/einstellungen/pegel');
  });

  it('Pegel: keiner festgelegt belegt den Platz trotzdem, mit Weg zur Auswahl', () => {
    const k = baueLagebild(roh(), JETZT, BERLIN).kennzahlen[0];
    expect(k).toMatchObject({
      etikett: 'Pegel',
      wert: '—',
      notiz: 'kein Pegel festgelegt',
      ton: 'neutral',
      zielPfad: '/einsaetze/1/einstellungen/pegel',
    });
  });

  it('Führungsstand: Überfälligkeit ist vom Bearbeitungsstatus unabhängig', () => {
    const a = (bearbeitungsstatus: Auftrag['bearbeitungsstatus'], ist_ueberfaellig = false) =>
      ({ bearbeitungsstatus, ist_ueberfaellig }) as Auftrag;
    const m = (status: Meldung['status'], ist_offen: boolean, ist_ueberfaellig = false) =>
      ({ status, ist_offen, ist_ueberfaellig }) as Meldung;
    const { fuehrung } = baueLagebild(
      roh({
        auftraege: [a('offen'), a('vollzogen', true), a('abgenommen')],
        meldungen: [m('neu', true), m('erledigt', false, true)],
      }),
      JETZT,
    );
    expect(fuehrung).toMatchObject({
      auftraegeOffen: 1,
      auftraegeUeberfaellig: 1,
      meldungenOffen: 1,
      meldungenNeu: 1,
      meldungenUeberfaellig: 1,
      bericht: null,
    });
  });
});
