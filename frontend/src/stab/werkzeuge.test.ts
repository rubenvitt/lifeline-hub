import { IconHaus } from '../icons';
import { describe, expect, it } from 'vitest';
import type { ModulFreigaben } from '../api/types';
import type { ModulEintrag } from '../einsatz/modulRegistry';
import { werkzeugZustand } from './werkzeuge';

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
  stub({ key: 'verweis', label: 'V', route: 'v', verweistAuf: 'ziel' }),
];
/** Freigaben, wie der Server sie liefert: alle Stub-Module frei, `gesperrt` ohne Zugriff. */
const freigabenMit = (abweichend: ModulFreigaben = {}): ModulFreigaben => ({
  'fertig-a': { sichtbar: true, zugriff: true },
  unfertig: { sichtbar: true, zugriff: true },
  gesperrt: { sichtbar: true, zugriff: false },
  verweis: { sichtbar: true, zugriff: true },
  stab: { sichtbar: true, zugriff: true },
  fernmeldewesen: { sichtbar: true, zugriff: true },
  ...abweichend,
});

const modul = (key: string) => ({ art: 'modul', key }) as const;
const seite = (key: string) => ({ art: 'seite', key }) as const;

describe('werkzeugZustand', () => {
  it('ein freies Modul springt in seine Route, mit dem Label der Registry', () => {
    const z = werkzeugZustand('s1', modul('fertig-a'), freigabenMit(), REGISTER);
    expect(z.zustand).toBe('frei');
    if (z.zustand === 'fehlt') return;
    expect(z.label).toBe('A');
    expect(z.modulKey).toBe('fertig-a');
    expect(z.pfad(7)).toBe('/einsaetze/7/a');
  });

  it('ein Modul mit `verweistAuf` springt in das Ziel', () => {
    const z = werkzeugZustand('s1', modul('verweis'), freigabenMit(), REGISTER);
    expect(z.zustand !== 'fehlt' && z.pfad(7)).toBe('/einsaetze/7/ziel');
  });

  it('ein gesperrtes Modul bleibt als gesperrtes Werkzeug stehen (design.md D2)', () => {
    expect(werkzeugZustand('s1', modul('gesperrt'), freigabenMit(), REGISTER).zustand).toBe(
      'gesperrt',
    );
  });

  it('ein ausgeblendetes, unfertiges oder unbekanntes Modul fehlt', () => {
    const freigaben = freigabenMit({ 'fertig-a': { sichtbar: false, zugriff: true } });
    expect(werkzeugZustand('s1', modul('fertig-a'), freigaben, REGISTER).zustand).toBe('fehlt');
    expect(werkzeugZustand('s1', modul('unfertig'), freigabenMit(), REGISTER).zustand).toBe(
      'fehlt',
    );
    expect(werkzeugZustand('s1', modul('gibt-es-nicht'), freigabenMit(), REGISTER).zustand).toBe(
      'fehlt',
    );
  });

  it('solange die Freigaben unbekannt sind, fehlt jedes Werkzeug', () => {
    expect(werkzeugZustand('s1', modul('fertig-a'), undefined, REGISTER).zustand).toBe('fehlt');
    expect(werkzeugZustand('s6', seite('funkplan'), undefined, REGISTER).zustand).toBe('fehlt');
  });

  it('eine Unterseite erbt Sperre und Sichtbarkeit ihres Moduls', () => {
    const frei = werkzeugZustand('s6', seite('fernmeldeskizze'), freigabenMit(), REGISTER);
    expect(frei.zustand).toBe('frei');
    if (frei.zustand === 'fehlt') return;
    expect(frei.label).toBe('Fernmeldeskizze');
    expect(frei.modulKey).toBe('fernmeldewesen');
    expect(frei.pfad(7)).toBe('/einsaetze/7/fernmeldewesen?ansicht=skizze');

    const gesperrt = freigabenMit({ fernmeldewesen: { sichtbar: true, zugriff: false } });
    expect(werkzeugZustand('s6', seite('funkplan'), gesperrt, REGISTER).zustand).toBe('gesperrt');
    const aus = freigabenMit({ fernmeldewesen: { sichtbar: false, zugriff: false } });
    expect(werkzeugZustand('s6', seite('funkplan'), aus, REGISTER).zustand).toBe('fehlt');
    expect(werkzeugZustand('s5', seite('presse'), freigabenMit(), REGISTER).zustand).toBe('frei');
  });

  it('eine Unterseite, die das Sachgebiet nicht führt, fehlt', () => {
    expect(werkzeugZustand('s1', seite('funkplan'), freigabenMit(), REGISTER).zustand).toBe(
      'fehlt',
    );
  });
});
