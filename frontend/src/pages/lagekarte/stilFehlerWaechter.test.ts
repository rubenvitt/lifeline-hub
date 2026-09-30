import { describe, expect, it } from 'vitest';
import { istStilLadefehler, neuerStilFehlerWaechter } from './stilFehlerWaechter';

describe('istStilLadefehler', () => {
  it('Kachel-Fehler (ErrorEvent mit tile) ist kein Style-Ladefehler', () => {
    expect(istStilLadefehler({ tile: { id: 'irgendwas' } })).toBe(false);
  });

  it('Fehler ohne tile (Style-JSON/Source nicht ladbar) ist ein Style-Ladefehler', () => {
    expect(istStilLadefehler({})).toBe(true);
    expect(istStilLadefehler(undefined)).toBe(true);
  });
});

describe('neuerStilFehlerWaechter', () => {
  const kachelFehler = { tile: { id: '5/16/10' } };
  const stilFehler = {};

  // Das Fehlerbild: zwei 404-Kacheln im Ladefenster stuften online → offline → blind ab, während
  // der Umschalter weiter „Online" zeigte.
  it('zwei Kachel-Fehler vor dem Laden stufen NICHT ab', () => {
    const w = neuerStilFehlerWaechter();
    expect(w.meldeFehler(kachelFehler)).toBe(false);
    expect(w.meldeFehler(kachelFehler)).toBe(false);
  });

  it('ein Style-Ladefehler vor dem Laden stuft genau einmal ab', () => {
    const w = neuerStilFehlerWaechter();
    expect(w.meldeFehler(stilFehler)).toBe(true);
    expect(w.meldeFehler(stilFehler)).toBe(false);
  });

  // Ein neu angewandter Style schärft die eine Abstufung neu. Praktisch greift die zweite Stufe
  // nicht, weil der Ersatz-Style (offline/blind) inline ist und 'style.load' sofort feuert.
  it('nach einem neu angewandten Style ist wieder eine Abstufung möglich', () => {
    const w = neuerStilFehlerWaechter();
    expect(w.meldeFehler(stilFehler)).toBe(true); // online → offline
    w.stilAngewandt();
    expect(w.meldeFehler(stilFehler)).toBe(true);
  });

  it('ein neu angewandter Style hebt die Kachel-Ausnahme nicht auf', () => {
    const w = neuerStilFehlerWaechter();
    w.stilAngewandt();
    expect(w.meldeFehler(kachelFehler)).toBe(false);
  });

  it('nach dem Laden stuft nichts mehr ab — auch kein Style-Fehler', () => {
    const w = neuerStilFehlerWaechter();
    w.stilGeladen();
    expect(w.meldeFehler(stilFehler)).toBe(false);
  });

  // LFH-558, im Browser gemessen: die Karte wird mit dem Blindstil konstruiert, bevor die
  // Kartenansicht hydriert ist; dessen 'style.load' schloss das Fenster, und der 404 des danach
  // angewandten Online-Styles ließ die Karte ganz ohne Style (und ohne Lagedaten) stehen.
  it('jeder angewandte Style öffnet ein eigenes Fenster bis zu SEINEM Laden', () => {
    const w = neuerStilFehlerWaechter();
    w.stilGeladen(); // Platzhalter (Blindstil) geladen
    w.stilAngewandt(); // Online-Style der Ansicht
    expect(w.meldeFehler(stilFehler)).toBe(true);
    w.stilAngewandt(); // Ersatz (offline) …
    w.stilGeladen(); // … geladen: das Fenster ist zu
    expect(w.meldeFehler(stilFehler)).toBe(false);
  });
});
