import { describe, expect, it } from 'vitest';
import { SEITENGROESSE } from '../api/etb';
import {
  ETB_MAX_SEITEN,
  naechsterSeitenParam,
  sprungRichtung,
  vorigerSeitenParam,
  type EtbSeitenParam,
} from './seitenfenster';

/**
 * Das Seitenfenster der ETB-Zeitachse (LFH-947, design.md D1/D4). Seiten kommen absteigend nach
 * `lfd_nr`; eine Seite ist eine Liste von Einträgen mit `id` und `lfd_nr`.
 */
function seite(von: number, anzahl: number) {
  return Array.from({ length: anzahl }, (_, i) => ({ id: von - i, lfd_nr: von - i }));
}

describe('Seitenfenster der ETB-Zeitachse', () => {
  it('hält höchstens 5 Seiten', () => {
    expect(ETB_MAX_SEITEN).toBe(5);
  });

  it('nächste (ältere) Seite: volle Seite führt weiter, kurze Seite am Ende nicht', () => {
    expect(naechsterSeitenParam(seite(500, SEITENGROESSE), undefined)).toEqual({ aelter: 401 });
    expect(naechsterSeitenParam(seite(50, 50), { aelter: 51 })).toBeUndefined();
  });

  it('nächste Seite nach einer kurzen `neuer`-Seite: darunter liegt noch Älteres', () => {
    expect(naechsterSeitenParam(seite(520, 20), { neuer: 500 })).toEqual({ aelter: 501 });
    // Leere `neuer`-Seite: weiter unter dem Cursor einschließlich.
    expect(naechsterSeitenParam([], { neuer: 500 })).toEqual({ aelter: 501 });
  });

  it('vorige (neuere) Seite: am Kopf keine, sonst direkt über dem jüngsten Eintrag', () => {
    expect(vorigerSeitenParam(seite(500, SEITENGROESSE), undefined)).toBeUndefined();
    expect(vorigerSeitenParam(seite(400, SEITENGROESSE), { aelter: 401 })).toEqual({
      neuer: 400,
    });
    expect(vorigerSeitenParam(seite(500, SEITENGROESSE), { neuer: 400 })).toEqual({ neuer: 500 });
  });

  it('vorige Seite: eine kurze `neuer`-Seite hat den neuesten Eintrag erreicht', () => {
    expect(vorigerSeitenParam(seite(520, 20), { neuer: 500 })).toBeUndefined();
    expect(vorigerSeitenParam([], { neuer: 500 })).toBeUndefined();
  });

  it('vorige Seite nach einer leeren `aelter`-Seite: über dem Cursor', () => {
    expect(vorigerSeitenParam([], { aelter: 401 })).toEqual({ neuer: 400 });
  });

  it('Sprungrichtung aus der Kennung: im Fenster, älter, neuer', () => {
    const seiten = [seite(500, 100), seite(400, 100)];
    expect(sprungRichtung(seiten, 450)).toBe('da');
    expect(sprungRichtung(seiten, 120)).toBe('aelter');
    expect(sprungRichtung(seiten, 900)).toBe('neuer');
    // Eine Kennung innerhalb der Spanne des Fensters, die fehlt (anderer Einsatz, Filter):
    // weder älter noch neuer — nichts zu holen.
    const mitLuecke = [seite(500, 100), seite(390, 90)];
    expect(sprungRichtung(mitLuecke, 395)).toBe('fehlt');
    expect(sprungRichtung([], 5)).toBe('aelter');
  });

  it('der Seitenparameter ist ein Wert, kein Zahl-Cursor (Typ)', () => {
    const p: EtbSeitenParam = { aelter: 1 };
    expect(p).toEqual({ aelter: 1 });
  });
});
