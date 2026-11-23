import { describe, expect, it } from 'vitest';
import { SEITENGROESSE } from '../api/etb';
import {
  FENSTER_MAX_SEITEN,
  fensterOptionen,
  type FensterParam,
} from '../components/fensterBeideRichtungen';
import { ETB_CURSOR, etbSeitenAbfrage, sprungRichtung } from './seitenfenster';

/**
 * Das Seitenfenster der ETB-Zeitachse (LFH-947, design.md D1/D4; seit LLH-2036 über
 * `components/fensterBeideRichtungen.ts`). Seiten kommen absteigend nach `lfd_nr`; eine Seite ist
 * eine Liste von Einträgen mit `id` und `lfd_nr`.
 */
function seite(von: number, anzahl: number) {
  return Array.from({ length: anzahl }, (_, i) => ({ id: von - i, lfd_nr: von - i }));
}

const fenster = fensterOptionen(ETB_CURSOR, SEITENGROESSE);
const naechster = (letzte: ReturnType<typeof seite>, param: FensterParam<number>) =>
  fenster.getNextPageParam(letzte, [], param);
const voriger = (erste: ReturnType<typeof seite>, param: FensterParam<number>) =>
  fenster.getPreviousPageParam(erste, [], param);

describe('Seitenfenster der ETB-Zeitachse', () => {
  it('hält höchstens 5 Seiten', () => {
    expect(fenster.maxPages).toBe(FENSTER_MAX_SEITEN);
    expect(FENSTER_MAX_SEITEN).toBe(5);
  });

  it('Cursor ist die laufende Nummer, nicht die Kennung', () => {
    expect(ETB_CURSOR.cursor({ id: 9, lfd_nr: 4 })).toBe(4);
  });

  it('Seitenparameter mit Richtung werden zu `before_lfd_nr` bzw. `after_lfd_nr`', () => {
    expect(etbSeitenAbfrage(undefined)).toEqual({ limit: SEITENGROESSE });
    expect(etbSeitenAbfrage({ aelter: 401 })).toEqual({
      before_lfd_nr: 401,
      limit: SEITENGROESSE,
    });
    // Nach oben einer mehr: kommt die Seite nicht voll, ist der Kopf erreicht (LLH-2036).
    expect(etbSeitenAbfrage({ neuer: 400 })).toEqual({
      after_lfd_nr: 400,
      limit: SEITENGROESSE + 1,
    });
  });

  it('nächste (ältere) Seite: volle Seite führt weiter, kurze Seite am Ende nicht', () => {
    expect(naechster(seite(500, SEITENGROESSE), undefined)).toEqual({ aelter: 401 });
    expect(naechster(seite(50, 50), { aelter: 51 })).toBeUndefined();
  });

  it('nächste Seite nach einer kurzen `neuer`-Seite: darunter liegt noch Älteres', () => {
    expect(naechster(seite(520, 20), { neuer: 500 })).toEqual({ aelter: 501 });
    // Leere `neuer`-Seite: weiter unter dem Cursor einschließlich.
    expect(naechster([], { neuer: 500 })).toEqual({ aelter: 501 });
  });

  it('vorige (neuere) Seite: am Kopf keine, sonst direkt über dem jüngsten Eintrag', () => {
    expect(voriger(seite(500, SEITENGROESSE), undefined)).toBeUndefined();
    expect(voriger(seite(400, SEITENGROESSE), { aelter: 401 })).toEqual({ neuer: 400 });
    expect(voriger(seite(501, SEITENGROESSE + 1), { neuer: 400 })).toEqual({ neuer: 501 });
  });

  it('vorige Seite: eine `neuer`-Seite mit bis zu einer Seitengröße hat den Kopf erreicht', () => {
    // Genau eine Seitengröße über dem Cursor: angefragt war eine mehr, also lag darüber nichts.
    expect(voriger(seite(500, SEITENGROESSE), { neuer: 400 })).toBeUndefined();
    expect(voriger(seite(520, 20), { neuer: 500 })).toBeUndefined();
    expect(voriger([], { neuer: 500 })).toBeUndefined();
  });

  it('vorige Seite nach einer leeren `aelter`-Seite: über dem Cursor', () => {
    expect(voriger([], { aelter: 401 })).toEqual({ neuer: 400 });
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
});
