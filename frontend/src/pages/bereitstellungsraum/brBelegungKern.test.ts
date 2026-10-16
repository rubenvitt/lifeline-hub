import { describe, expect, it } from 'vitest';
import dayjs from 'dayjs';
import type { BrVerlaufEintrag } from '../../api/types';
import { folgeSchluessel, seitText, verlaufText, wartezeitMinuten } from './brBelegungKern';

/** 14:30 Berliner Sommerzeit = 12:30 UTC. */
const JETZT = dayjs('2026-10-15T14:30:00+02:00');

describe('Wartezeit in Minuten (LLH-1095 D10)', () => {
  it('liest `seit_at` als UTC: 11:42 UTC um 14:30 Berliner Sommerzeit sind 48 min, nicht 168', () => {
    expect(wartezeitMinuten('2026-10-15 11:42:00', JETZT)).toBe(48);
  });

  it('läuft mit der Uhr: eine Minute später 49 min', () => {
    expect(wartezeitMinuten('2026-10-15 11:42:00', JETZT.add(60, 'second'))).toBe(49);
  });

  it('rundet ab: 59 s sind 0 min', () => {
    expect(wartezeitMinuten('2026-10-15 12:29:01', JETZT)).toBe(0);
  });

  it('wird nie negativ, wenn die Geräteuhr hinter der Serverzeit liegt', () => {
    expect(wartezeitMinuten('2026-10-15 12:35:00', JETZT)).toBe(0);
  });
});

describe('„seit …“ als Text', () => {
  it('nennt Uhrzeit und Dauer: „seit 1342 · 48 min“', () => {
    expect(seitText('1342', 48)).toBe('seit 1342 · 48 min');
  });

  it('ab einer Stunde in Stunden und Minuten', () => {
    expect(seitText('1050', 220)).toBe('seit 1050 · 3 h 40');
  });
});

describe('Folge nach Wartezeit (LLH-1095 D11)', () => {
  type Kraft = { id: number; name: string; seit_at?: string | null };
  const ordne = (liste: Kraft[]) =>
    [...liste]
      .sort((a, b) => {
        const ka = folgeSchluessel(a.seit_at, a.name);
        const kb = folgeSchluessel(b.seit_at, b.name);
        return ka < kb ? -1 : ka > kb ? 1 : a.id - b.id;
      })
      .map((k) => k.name);

  it('am längsten wartend zuerst, die neue Kraft ans Ende', () => {
    expect(
      ordne([
        { id: 1, name: 'Alpha', seit_at: '2026-10-15 12:05:00' },
        { id: 2, name: 'Zulu', seit_at: '2026-10-15 11:42:00' },
        { id: 3, name: 'Bravo', seit_at: '2026-10-15 12:20:00' },
      ]),
    ).toEqual(['Zulu', 'Alpha', 'Bravo']);
  });

  it('ohne „seit“ ans Ende, untereinander nach Name', () => {
    expect(
      ordne([
        { id: 1, name: 'Charlie', seit_at: null },
        { id: 2, name: 'Alpha' },
        { id: 3, name: 'Zulu', seit_at: '2026-10-15 12:20:00' },
      ]),
    ).toEqual(['Zulu', 'Alpha', 'Charlie']);
  });

  it('gleicher Zeitpunkt: nach Name wie die feste Folge (Zahlen nach Wert)', () => {
    const seit = '2026-10-15 12:00:00';
    expect(
      ordne([
        { id: 1, name: 'Florian 10', seit_at: seit },
        { id: 2, name: 'Florian 2', seit_at: seit },
      ]),
    ).toEqual(['Florian 2', 'Florian 10']);
  });
});

describe('Art eines Verlaufseintrags als Wort', () => {
  const eintrag = (over: Partial<BrVerlaufEintrag>): BrVerlaufEintrag => ({
    id: 1,
    art: 'eintritt',
    objekt_typ: 'einheit',
    objekt_id: 10,
    objekt_name: '1. Zug',
    zeitpunkt_at: '2026-10-15 11:42:00',
    ...over,
  });

  it('Eintritt und Austritt', () => {
    expect(verlaufText(eintrag({ art: 'eintritt' }))).toBe('Eintritt');
    expect(verlaufText(eintrag({ art: 'austritt' }))).toBe('Austritt');
  });

  it('Wechsel nennen den anderen Raum', () => {
    expect(verlaufText(eintrag({ art: 'wechsel_hinaus', ziel: 'BR Schule' }))).toBe(
      'Wechsel nach BR Schule',
    );
    expect(verlaufText(eintrag({ art: 'wechsel_herein', herkunft: 'BR Sportplatz' }))).toBe(
      'Wechsel von BR Sportplatz',
    );
  });

  it('Abruf nennt Ziel und Auftrag, der Austritt danach das Ziel (LLH-1085)', () => {
    expect(verlaufText(eintrag({ art: 'abruf', ziel: 'EA Deich', auftrag_nr: 7 }))).toBe(
      'Abruf nach EA Deich (Auftrag Nr. 7)',
    );
    expect(verlaufText(eintrag({ art: 'abruf', ziel: null, auftrag_nr: null }))).toBe('Abruf');
    expect(verlaufText(eintrag({ art: 'austritt', ziel: 'EA Deich' }))).toBe(
      'Austritt nach EA Deich',
    );
    expect(verlaufText(eintrag({ art: 'abruf_aufgehoben' }))).toBe('Abruf zurückgenommen');
  });

  it('Wechsel ohne Bezeichnung des anderen Raums bleibt ein Wechsel', () => {
    expect(verlaufText(eintrag({ art: 'wechsel_hinaus' }))).toBe('Wechsel hinaus');
    expect(verlaufText(eintrag({ art: 'wechsel_herein', herkunft: null }))).toBe('Wechsel herein');
  });
});
