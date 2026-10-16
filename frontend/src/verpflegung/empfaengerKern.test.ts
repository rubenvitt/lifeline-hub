import { describe, expect, it } from 'vitest';
import {
  ABSCHNITT_DEICH,
  GRUPPE_1,
  GRUPPE_2,
  KEINE_EMPFAENGER,
  WASSERRETTUNG,
  ZUG,
  ausgabe,
  empfaenger,
  empfaengerEinheit,
  zeitfenster,
} from '../test/verpflegungDaten';
import {
  empfaengerFelder,
  empfaengerOptionen,
  empfaengerSchluessel,
  empfaengerText,
  empfaengerVon,
  isEmpfaengerWaehlbar,
  parseEmpfaengerSchluessel,
  staerkeVorgabe,
  verpflegungsstand,
} from './empfaengerKern';

/** „Mittag“ 10:00–11:30 UTC mit den gegebenen Ausgaben. */
const mittag = (ausgaben: ReturnType<typeof ausgabe>[] = []) => zeitfenster({ ausgaben });
const namen = (zeilen: readonly { name: string }[]) => zeilen.map((z) => z.name);

describe('verpflegungsstand — „Noch nicht verpflegt“ (LLH-1055)', () => {
  it('drei Einheiten, eine verpflegt: zwei gelistet (AK)', () => {
    const e = {
      einheiten: [
        empfaengerEinheit({ id: 1, name: 'A', eintreffen_at: '2026-09-24 07:00:00' }),
        empfaengerEinheit({ id: 2, name: 'B', eintreffen_at: '2026-09-24 07:00:00' }),
        empfaengerEinheit({ id: 3, name: 'C', eintreffen_at: '2026-09-24 07:00:00' }),
      ],
      abschnitte: [],
    };
    const stand = verpflegungsstand(mittag([ausgabe({ id: 1, menge: 9, einheit_id: 2 })]), e);
    expect(namen(stand.offen)).toEqual(['A', 'C']);
    expect(namen(stand.verpflegt)).toEqual(['B']);
    expect(stand.verpflegt[0].ausgaben).toEqual([
      { menge: 9, zeitpunkt_at: '2026-09-24 09:40:00' },
    ]);
  });

  it('eine zurückgenommene Ausgabe zählt nicht (AK)', () => {
    const stand = verpflegungsstand(
      mittag([
        ausgabe({
          id: 1,
          menge: 9,
          einheit_id: GRUPPE_2,
          zurueckgenommen_at: '2026-09-24 09:45:00',
        }),
      ]),
      empfaenger(),
    );
    expect(namen(stand.offen)).toContain('2. Gruppe');
    expect(stand.verpflegt).toEqual([]);
  });

  it('die Ausgabe an den Zug verpflegt seinen Teilbaum; der Zug nennt die Untereinheiten', () => {
    const stand = verpflegungsstand(
      mittag([ausgabe({ id: 1, menge: 20, einheit_id: ZUG })]),
      empfaenger(),
    );
    expect(namen(stand.offen)).toEqual([]);
    expect(namen(stand.verpflegt)).toEqual(['1. Zug']);
    expect(stand.verpflegt[0].untereinheiten).toBe(2);
  });

  it('eine verpflegte Gruppe lässt Zug und Schwestergruppe stehen; Tiefe nach der Gliederung', () => {
    const stand = verpflegungsstand(
      mittag([ausgabe({ id: 1, menge: 9, einheit_id: GRUPPE_1 })]),
      empfaenger(),
    );
    expect(stand.offen.map((z) => [z.name, z.tiefe])).toEqual([
      ['1. Zug', 0],
      ['2. Gruppe', 1],
    ]);
  });

  it('ohne Eintreffen steht gesondert, nicht geraten', () => {
    const stand = verpflegungsstand(mittag(), empfaenger());
    expect(namen(stand.offen)).toEqual(['1. Zug', '1. Gruppe', '2. Gruppe']);
    expect(namen(stand.ohneEintreffen)).toEqual(['Wasserrettung']);
  });

  it('wer erst nach dem Ende des Zeitfensters eingetroffen ist, fehlt in der Liste', () => {
    const e = {
      einheiten: [
        empfaengerEinheit({ id: 1, name: 'spät', eintreffen_at: '2026-09-24 12:00:00' }),
        empfaengerEinheit({ id: 2, name: 'rechtzeitig', eintreffen_at: '2026-09-24 11:29:00' }),
      ],
      abschnitte: [],
    };
    expect(namen(verpflegungsstand(mittag(), e).offen)).toEqual(['rechtzeitig']);
  });

  it('eine aufgelöste Einheit steht nur unter „verpflegt“, wenn sie eine Ausgabe hat', () => {
    const e = {
      einheiten: [
        empfaengerEinheit({
          id: 1,
          name: 'aufgelöst ohne',
          eintreffen_at: '2026-09-24 07:00:00',
          aufgeloest_at: '2026-09-24 09:00:00',
        }),
        empfaengerEinheit({
          id: 2,
          name: 'aufgelöst mit',
          eintreffen_at: '2026-09-24 07:00:00',
          aufgeloest_at: '2026-09-24 09:50:00',
        }),
      ],
      abschnitte: [],
    };
    const stand = verpflegungsstand(mittag([ausgabe({ id: 1, menge: 4, einheit_id: 2 })]), e);
    expect(stand.offen).toEqual([]);
    expect(stand.ohneEintreffen).toEqual([]);
    expect(stand.verpflegt.map((z) => [z.name, z.aufgeloest])).toEqual([['aufgelöst mit', true]]);
  });

  it('eine vorgemerkte Ausgabe steht „ausstehend“ an der Einheit und nimmt sie nicht aus der Liste (AK)', () => {
    const stand = verpflegungsstand(mittag(), empfaenger(), [
      { menge: 9, einheit_id: GRUPPE_2 },
      { menge: 3, einheit_id: GRUPPE_2 },
      { menge: 5 },
    ]);
    const zeile = stand.offen.find((z) => z.id === GRUPPE_2)!;
    expect(zeile.ausstehend).toBe(12);
    expect(stand.offen.find((z) => z.id === GRUPPE_1)!.ausstehend).toBe(0);
    expect(stand.verpflegt).toEqual([]);
  });

  it('eine Zuführung an den Abschnitt verpflegt keine Einheit, die Zeilen dort nennen sie', () => {
    const stand = verpflegungsstand(
      mittag([ausgabe({ id: 1, menge: 40, abschnitt_id: ABSCHNITT_DEICH })]),
      empfaenger(),
    );
    expect(namen(stand.offen)).toEqual(['1. Zug', '1. Gruppe', '2. Gruppe']);
    expect(stand.offen.every((z) => z.zufuehrung === 'Deich')).toBe(true);
    expect(stand.ohneEintreffen[0].zufuehrung).toBeNull();
    expect(stand.zufuehrungen).toEqual([
      {
        id: ABSCHNITT_DEICH,
        name: 'Deich',
        ausgaben: [{ menge: 40, zeitpunkt_at: '2026-09-24 09:40:00' }],
      },
    ]);
  });

  it('eine Zuführung an einen übergeordneten Abschnitt gilt für die Einheiten darunter', () => {
    const e = {
      einheiten: [
        empfaengerEinheit({
          id: 1,
          name: 'A',
          abschnitt_id: 2,
          abschnitt_name: 'Deich Nord',
          eintreffen_at: '2026-09-24 07:00:00',
        }),
      ],
      abschnitte: [
        { id: 1, name: 'Deich' },
        { id: 2, name: 'Deich Nord', ueber_abschnitt_id: 1 },
      ],
    };
    const stand = verpflegungsstand(mittag([ausgabe({ id: 1, menge: 40, abschnitt_id: 1 })]), e);
    expect(stand.offen[0].zufuehrung).toBe('Deich');
    expect(stand.offen[0].abschnitt).toBe('Deich Nord');
  });

  it('der Abschnitt einer Untereinheit ohne eigenen ist der geerbte', () => {
    const e = empfaenger();
    e.einheiten = e.einheiten.map((x) =>
      x.id === GRUPPE_2 ? { ...x, abschnitt_id: null, abschnitt_name: null } : x,
    );
    const stand = verpflegungsstand(mittag(), e);
    expect(stand.offen.find((z) => z.id === GRUPPE_2)!.abschnitt).toBe('Deich');
    expect(stand.ohneEintreffen.find((z) => z.id === WASSERRETTUNG)!.abschnitt).toBeNull();
  });

  it('nur Ausgaben dieses Zeitfensters, je Einheit nach Zeit', () => {
    const stand = verpflegungsstand(
      mittag([
        ausgabe({ id: 2, menge: 4, einheit_id: GRUPPE_1, zeitpunkt_at: '2026-09-24 10:40:00' }),
        ausgabe({ id: 1, menge: 5, einheit_id: GRUPPE_1, zeitpunkt_at: '2026-09-24 10:10:00' }),
      ]),
      empfaenger(),
    );
    expect(stand.verpflegt[0].ausgaben.map((a) => a.menge)).toEqual([5, 4]);
  });

  it('eine unbekannte Einheit an einer Ausgabe bleibt sichtbar statt still zu fehlen', () => {
    const stand = verpflegungsstand(
      mittag([ausgabe({ id: 1, menge: 4, einheit_id: 99 })]),
      KEINE_EMPFAENGER,
    );
    expect(namen(stand.verpflegt)).toEqual(['Einheit #99']);
  });
});

describe('Empfänger — Wahl, Felder, Texte (LLH-1055)', () => {
  it('Schlüssel hin und zurück; „ohne“ und Unsinn sind kein Empfänger', () => {
    const w = { art: 'einheit' as const, id: 31 };
    expect(empfaengerSchluessel(w)).toBe('einheit:31');
    expect(parseEmpfaengerSchluessel('einheit:31')).toEqual(w);
    expect(parseEmpfaengerSchluessel('abschnitt:41')).toEqual({ art: 'abschnitt', id: 41 });
    expect(empfaengerSchluessel(null)).toBe('ohne');
    for (const s of ['ohne', '', null, undefined, 'person:3', 'einheit:x', 'einheit:-1']) {
      expect(parseEmpfaengerSchluessel(s)).toBeNull();
    }
  });

  it('Felder der Eingabe: höchstens einer', () => {
    expect(empfaengerFelder({ art: 'einheit', id: 31 })).toEqual({ einheit_id: 31 });
    expect(empfaengerFelder({ art: 'abschnitt', id: 41 })).toEqual({ abschnitt_id: 41 });
    expect(empfaengerFelder(null)).toEqual({});
    expect(empfaengerVon({ einheit_id: 31 })).toEqual({ art: 'einheit', id: 31 });
    expect(empfaengerVon({ abschnitt_id: 41, einheit_id: null })).toEqual({
      art: 'abschnitt',
      id: 41,
    });
    expect(empfaengerVon({})).toBeNull();
  });

  it('wählbar beim Zählen: nicht aufgelöste Einheit oder bekannter Abschnitt', () => {
    const e = empfaenger();
    e.einheiten.push(
      empfaengerEinheit({ id: 50, name: 'Alt', aufgeloest_at: '2026-09-24 08:00:00' }),
    );
    expect(isEmpfaengerWaehlbar({ art: 'einheit', id: GRUPPE_2 }, e)).toBe(true);
    expect(isEmpfaengerWaehlbar({ art: 'einheit', id: 50 }, e)).toBe(false);
    expect(isEmpfaengerWaehlbar({ art: 'einheit', id: 99 }, e)).toBe(false);
    expect(isEmpfaengerWaehlbar({ art: 'abschnitt', id: ABSCHNITT_DEICH }, e)).toBe(true);
    expect(isEmpfaengerWaehlbar({ art: 'abschnitt', id: GRUPPE_2 }, e)).toBe(false);
    expect(isEmpfaengerWaehlbar(null, e)).toBe(false);
  });

  it('Text an einer Ausgabe: „an 2. Gruppe“, „Zuführung Deich“', () => {
    const e = empfaenger();
    expect(empfaengerText({ einheit_id: GRUPPE_2 }, e)).toBe('an 2. Gruppe');
    expect(empfaengerText({ abschnitt_id: ABSCHNITT_DEICH }, e)).toBe('Zuführung Deich');
    expect(empfaengerText({ einheit_id: 99 }, e)).toBe('an Einheit #99');
    expect(empfaengerText({}, e)).toBe('');
  });

  it('Stärke als Vorgabe der Menge: der Teilbaum (kumuliert) über summiereStaerke', () => {
    const e = empfaenger();
    const zug = e.einheiten.find((x) => x.id === ZUG)!;
    const gruppe = e.einheiten.find((x) => x.id === GRUPPE_2)!;
    const wr = e.einheiten.find((x) => x.id === WASSERRETTUNG)!;
    expect(staerkeVorgabe(zug)).toBe(20);
    expect(staerkeVorgabe(gruppe)).toBe(9);
    // Ohne Stärke keine Vorgabe (nicht 0).
    expect(staerkeVorgabe(wr)).toBeNull();
  });

  it('Optionen: Einheiten mit Funkrufname und Stärke, dann Abschnitte als Zuführung; aufgelöste nur auf Wunsch', () => {
    const e = empfaenger();
    e.einheiten.push(
      empfaengerEinheit({ id: 50, name: 'Alt', aufgeloest_at: '2026-09-24 08:00:00' }),
    );
    const ohne = empfaengerOptionen(e, { aufgeloeste: false });
    expect(ohne.map((g) => g.label)).toEqual(['Einheiten', 'Zuführung an Abschnitt']);
    expect(ohne[0].options.map((o) => o.label)).toEqual([
      '1. Zug · Florian 1 · 1/2/17//20',
      '1. Gruppe · Florian 1-1 · 0/1/8//9',
      '2. Gruppe · Florian 1-2 · 0/1/8//9',
      'Wasserrettung',
    ]);
    expect(ohne[0].options[0].value).toBe(`einheit:${ZUG}`);
    expect(ohne[1].options).toEqual([
      { value: `abschnitt:${ABSCHNITT_DEICH}`, label: 'Zuführung Deich' },
    ]);
    const mit = empfaengerOptionen(e, { aufgeloeste: true });
    expect(mit.map((g) => g.label)).toEqual(['Einheiten', 'Zuführung an Abschnitt', 'aufgelöst']);
    expect(mit[2].options).toEqual([{ value: 'einheit:50', label: 'Alt' }]);
    expect(empfaengerOptionen(KEINE_EMPFAENGER, { aufgeloeste: true })).toEqual([]);
  });
});
