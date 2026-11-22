import { describe, expect, it } from 'vitest';
import {
  FENSTER_MAX_SEITEN,
  fensterOptionen,
  kopfAngenommen,
  naechsterParam,
  seitenLimit,
  vorigerParam,
  type CursorAdapter,
} from './fensterBeideRichtungen';

/**
 * Seitenfenster in beide Richtungen für Chat und Infotelefon (LLH-1886, Entwurf
 * `docs/superpowers/specs/2026-11-22-se7ytm9j-chat-infotelefon-seitenfenster-design.md`, D2).
 * Dieselben Übergänge wie `etb/seitenfenster.test.ts`, mit beiden Cursor-Arten.
 */
const GROESSE = 3;

// Chat: Cursor ist die Kennung.
interface Nachricht {
  id: number;
}
const chat: CursorAdapter<Nachricht, number> = {
  cursor: (n) => n.id,
  einschliessendAelter: (c) => c + 1,
  einschliessendNeuer: (c) => c - 1,
};
const nachrichten = (von: number, anzahl: number): Nachricht[] =>
  Array.from({ length: anzahl }, (_, i) => ({ id: von - i }));

// Infotelefon: Cursor ist Eingang + Kennung.
interface Anruf {
  id: number;
  eingang_at: string;
}
interface ZeitCursor {
  zeit: string;
  id: number;
}
const telefon: CursorAdapter<Anruf, ZeitCursor> = {
  cursor: (a) => ({ zeit: a.eingang_at, id: a.id }),
  einschliessendAelter: (c) => ({ zeit: c.zeit, id: c.id + 1 }),
  einschliessendNeuer: (c) => ({ zeit: c.zeit, id: c.id - 1 }),
};
const T = '2026-11-22 10:00:00';

describe('Seitenfenster in beide Richtungen', () => {
  it('hält höchstens 5 Seiten', () => {
    expect(FENSTER_MAX_SEITEN).toBe(5);
    const o = fensterOptionen(chat, GROESSE);
    expect(o.maxPages).toBe(5);
    expect(o.initialPageParam).toBeUndefined();
  });

  it('nächste (ältere) Seite: volle Seite führt weiter, kurze Seite am Ende nicht', () => {
    expect(naechsterParam(chat, GROESSE, nachrichten(10, 3), undefined)).toEqual({ aelter: 8 });
    expect(naechsterParam(chat, GROESSE, nachrichten(2, 2), { aelter: 3 })).toBeUndefined();
  });

  it('nächste Seite nach einer `neuer`-Seite: darunter liegt immer noch Älteres', () => {
    expect(naechsterParam(chat, GROESSE, nachrichten(12, 2), { neuer: 10 })).toEqual({
      aelter: 11,
    });
    // Leere `neuer`-Seite: weiter unter dem Cursor, ihn selbst eingeschlossen.
    expect(naechsterParam(chat, GROESSE, [], { neuer: 10 })).toEqual({ aelter: 11 });
  });

  it('vorige (neuere) Seite: am Kopf keine, sonst direkt über dem jüngsten Eintrag', () => {
    expect(vorigerParam(chat, GROESSE, nachrichten(10, 3), undefined)).toBeUndefined();
    expect(vorigerParam(chat, GROESSE, nachrichten(7, 3), { aelter: 8 })).toEqual({ neuer: 7 });
    // Eine `neuer`-Seite ist erst mit einem Eintrag über der Seitengröße voll.
    expect(vorigerParam(chat, GROESSE, nachrichten(11, 4), { neuer: 7 })).toEqual({ neuer: 11 });
  });

  it('`neuer`-Seiten fragen einen Eintrag mehr an, die anderen genau eine Seite', () => {
    expect(seitenLimit(GROESSE, undefined)).toBe(3);
    expect(seitenLimit(GROESSE, { aelter: 8 })).toBe(3);
    expect(seitenLimit(GROESSE, { neuer: 7 })).toBe(4);
  });

  it('vorige Seite: eine nicht volle `neuer`-Seite hat das Neueste erreicht', () => {
    expect(vorigerParam(chat, GROESSE, nachrichten(12, 2), { neuer: 10 })).toBeUndefined();
    // Genau eine Seitengröße auf dem Rückweg: Kopf erreicht, kein leerer Extraklick.
    expect(vorigerParam(chat, GROESSE, nachrichten(10, 3), { neuer: 7 })).toBeUndefined();
    expect(vorigerParam(chat, GROESSE, [], { neuer: 10 })).toBeUndefined();
  });

  it('vorige Seite nach einer leeren `aelter`-Seite: über dem Cursor, ihn eingeschlossen', () => {
    expect(vorigerParam(chat, GROESSE, [], { aelter: 8 })).toEqual({ neuer: 7 });
  });

  it('Eingang + Kennung: Cursor aus dem ältesten bzw. jüngsten Anruf der Seite', () => {
    const seite: Anruf[] = [
      { id: 9, eingang_at: '2026-11-22 11:00:00' },
      { id: 12, eingang_at: T },
      { id: 4, eingang_at: T },
    ];
    expect(naechsterParam(telefon, GROESSE, seite, undefined)).toEqual({
      aelter: { zeit: T, id: 4 },
    });
    expect(vorigerParam(telefon, GROESSE, seite, { aelter: { zeit: T, id: 3 } })).toEqual({
      neuer: { zeit: '2026-11-22 11:00:00', id: 9 },
    });
    // Leere Seiten: der Cursor-Anruf selbst bleibt in Reichweite.
    expect(naechsterParam(telefon, GROESSE, [], { neuer: { zeit: T, id: 4 } })).toEqual({
      aelter: { zeit: T, id: 5 },
    });
    expect(vorigerParam(telefon, GROESSE, [], { aelter: { zeit: T, id: 4 } })).toEqual({
      neuer: { zeit: T, id: 3 },
    });
  });

  it('die Optionen reichen den Seitenparameter an die Übergänge', () => {
    const o = fensterOptionen(chat, GROESSE);
    expect(o.getNextPageParam(nachrichten(10, 3), [], undefined)).toEqual({ aelter: 8 });
    expect(o.getPreviousPageParam(nachrichten(7, 3), [], { aelter: 8 })).toEqual({ neuer: 7 });
  });

  it('eine nicht volle `neuer`-Seite vorn wird zum Kopf (Parameter `undefined`)', () => {
    const daten = {
      pages: [nachrichten(10, 3), nachrichten(7, 3)],
      pageParams: [{ neuer: 7 }, { aelter: 8 }],
    };
    expect(kopfAngenommen(daten, GROESSE)).toEqual({
      pages: daten.pages,
      pageParams: [undefined, { aelter: 8 }],
    });
    // Voll (eine über der Seitengröße): darüber liegt mehr, nichts umzuschreiben.
    expect(
      kopfAngenommen({ pages: [nachrichten(11, 4)], pageParams: [{ neuer: 7 }] }, GROESSE),
    ).toBeNull();
    // Schon der Kopf, oder eine `aelter`-Seite vorn: nichts zu tun.
    expect(
      kopfAngenommen({ pages: [nachrichten(10, 2)], pageParams: [undefined] }, GROESSE),
    ).toBeNull();
    expect(
      kopfAngenommen({ pages: [nachrichten(7, 3)], pageParams: [{ aelter: 8 }] }, GROESSE),
    ).toBeNull();
    expect(kopfAngenommen(undefined, GROESSE)).toBeNull();
  });
});
