import { IconHaus } from '../icons';
import { describe, expect, it } from 'vitest';
import type { ModulFreigaben } from '../api/types';
import type { ModulEintrag } from '../einsatz/modulRegistry';
import { werkzeugeFuer } from './werkzeuge';

/**
 * Registry-STUB statt der echten Registry: es gibt kein `wip`-Modul mehr, an dem sich der
 * Status-Zweig beobachten ließe.
 */
const stub = (over: Partial<ModulEintrag>): ModulEintrag => ({
  key: 'x',
  kategorie: 'fuehrung',
  label: 'X',
  icon: IconHaus,
  route: 'x',
  status: 'fertig',
  ...over,
});
const REGISTER = [
  stub({ key: 'fertig-a', label: 'A', route: 'a' }),
  stub({ key: 'unfertig', label: 'U', route: 'u', status: 'wip' }),
  stub({ key: 'gesperrt', label: 'G', route: 'g' }),
  stub({ key: 'fertig-b', label: 'B', route: 'b' }),
];
/** Freigaben, wie der Server sie liefert: alle Stub-Module frei, `gesperrt` ohne Zugriff. */
const freigabenMit = (abweichend: ModulFreigaben = {}): ModulFreigaben => ({
  'fertig-a': { sichtbar: true, zugriff: true },
  unfertig: { sichtbar: true, zugriff: true },
  gesperrt: { sichtbar: true, zugriff: false },
  'fertig-b': { sichtbar: true, zugriff: true },
  ...abweichend,
});

describe('werkzeugeFuer', () => {
  it('liefert freigegebene Module in der Reihenfolge der Schlüssel', () => {
    expect(
      werkzeugeFuer(['fertig-b', 'fertig-a'], freigabenMit(), REGISTER).map((m) => m.key),
    ).toEqual(['fertig-b', 'fertig-a']);
  });

  it('lässt unfertige, gesperrte und unbekannte Module weg', () => {
    expect(
      werkzeugeFuer(
        ['unfertig', 'gesperrt', 'gibt-es-nicht', 'fertig-a'],
        freigabenMit(),
        REGISTER,
      ).map((m) => m.key),
    ).toEqual(['fertig-a']);
  });

  it('lässt ausgeblendete Module weg', () => {
    const freigaben = freigabenMit({ 'fertig-a': { sichtbar: false, zugriff: true } });
    expect(werkzeugeFuer(['fertig-a', 'fertig-b'], freigaben, REGISTER).map((m) => m.key)).toEqual([
      'fertig-b',
    ]);
  });

  it('zeigt kein Werkzeug, solange die Freigaben unbekannt sind', () => {
    expect(werkzeugeFuer(['fertig-a', 'fertig-b'], undefined, REGISTER)).toEqual([]);
  });
});
