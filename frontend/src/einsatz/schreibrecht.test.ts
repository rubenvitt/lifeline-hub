import { describe, expect, it } from 'vitest';
import {
  darfEinsatzLeiten,
  darfImEinsatzSchreiben,
  istAdmin,
  istBeobachter,
  istEinsatzLeitung,
} from './schreibrecht';

// Wahrheitstabelle für die zentrale Schreibrecht-Regel (LFH-234). Sie ist das Sicherheitsnetz
// für die 4→1-Vereinheitlichung der zuvor 29-fach kopierten Inline-Varianten (A/B/C/D) und
// pinnt die beiden bewussten Verhaltens-Deltas: (a) Admin-global-WRITE, (b) Null-Rolle-Tightening.

const aktiv = { status: 'aktiv' as const };
const zu = { status: 'abgeschlossen' as const };
const admin = { system_rolle: 'admin' as const };
const keiner = { system_rolle: 'keiner' as const };

describe('darfImEinsatzSchreiben', () => {
  it('erlaubt Einsatzleitung im aktiven Einsatz', () => {
    expect(darfImEinsatzSchreiben({ ...aktiv, meine_rolle: 'einsatzleitung' })).toBe(true);
  });

  it('erlaubt Führungspersonal im aktiven Einsatz', () => {
    expect(darfImEinsatzSchreiben({ ...aktiv, meine_rolle: 'fuehrungspersonal' })).toBe(true);
  });

  it('erlaubt System-Admin im aktiven Einsatz unabhängig von der Einsatz-Rolle (admin-global)', () => {
    expect(darfImEinsatzSchreiben({ ...aktiv, meine_rolle: 'beobachter' }, admin)).toBe(true);
    expect(darfImEinsatzSchreiben({ ...aktiv, meine_rolle: null }, admin)).toBe(true);
  });

  it('verweigert Beobachter ohne Admin', () => {
    expect(darfImEinsatzSchreiben({ ...aktiv, meine_rolle: 'beobachter' }, keiner)).toBe(false);
  });

  it('verweigert fehlende Einsatz-Rolle ohne Admin (Null-Leak-Tightening ggü. alter B/C-Semantik)', () => {
    expect(darfImEinsatzSchreiben({ ...aktiv, meine_rolle: null })).toBe(false);
    expect(darfImEinsatzSchreiben({ ...aktiv, meine_rolle: null }, keiner)).toBe(false);
  });

  it('verweigert im abgeschlossenen Einsatz auch für Einsatzleitung und Admin (aktiv bleibt vorausgesetzt)', () => {
    expect(darfImEinsatzSchreiben({ ...zu, meine_rolle: 'einsatzleitung' })).toBe(false);
    expect(darfImEinsatzSchreiben({ ...zu, meine_rolle: 'beobachter' }, admin)).toBe(false);
  });

  it('ist fail-closed bei fehlendem Einsatz', () => {
    expect(darfImEinsatzSchreiben(undefined)).toBe(false);
    expect(darfImEinsatzSchreiben(null)).toBe(false);
    expect(darfImEinsatzSchreiben(undefined, admin)).toBe(false);
  });
});

describe('darfEinsatzLeiten', () => {
  it('erlaubt Einsatzleitung und Admin im aktiven Einsatz', () => {
    expect(darfEinsatzLeiten({ ...aktiv, meine_rolle: 'einsatzleitung' })).toBe(true);
    expect(darfEinsatzLeiten({ ...aktiv, meine_rolle: 'beobachter' }, admin)).toBe(true);
  });

  it('verweigert Führungspersonal und Beobachter', () => {
    expect(darfEinsatzLeiten({ ...aktiv, meine_rolle: 'fuehrungspersonal' })).toBe(false);
    expect(darfEinsatzLeiten({ ...aktiv, meine_rolle: 'beobachter' })).toBe(false);
  });

  it('verweigert im abgeschlossenen Einsatz', () => {
    expect(darfEinsatzLeiten({ ...zu, meine_rolle: 'einsatzleitung' })).toBe(false);
    expect(darfEinsatzLeiten({ ...zu, meine_rolle: 'einsatzleitung' }, admin)).toBe(false);
  });

  it('ist fail-closed bei fehlendem Einsatz', () => {
    expect(darfEinsatzLeiten(undefined)).toBe(false);
  });
});

describe('istEinsatzLeitung (strikt EL, aktiv-frei, ohne Admin)', () => {
  it('ist wahr für die Einsatzleitung – unabhängig vom Status', () => {
    expect(istEinsatzLeitung({ ...aktiv, meine_rolle: 'einsatzleitung' })).toBe(true);
    expect(istEinsatzLeitung({ ...zu, meine_rolle: 'einsatzleitung' })).toBe(true);
  });

  it('schließt Admin und Führungspersonal/Beobachter aus (EL-Read-Gate ohne Admin-Delta)', () => {
    expect(istEinsatzLeitung({ ...aktiv, meine_rolle: 'fuehrungspersonal' })).toBe(false);
    expect(istEinsatzLeitung({ ...aktiv, meine_rolle: 'beobachter' })).toBe(false);
    expect(istEinsatzLeitung({ ...aktiv, meine_rolle: null })).toBe(false);
  });

  it('ist fail-closed bei fehlendem Einsatz', () => {
    expect(istEinsatzLeitung(undefined)).toBe(false);
  });
});

describe('istBeobachter', () => {
  it('unterscheidet Beobachter von anderen Rollen', () => {
    expect(istBeobachter({ ...aktiv, meine_rolle: 'beobachter' })).toBe(true);
    expect(istBeobachter({ ...aktiv, meine_rolle: 'einsatzleitung' })).toBe(false);
    expect(istBeobachter({ ...aktiv, meine_rolle: null })).toBe(false);
    expect(istBeobachter(undefined)).toBe(false);
  });
});

describe('istAdmin', () => {
  it('erkennt die System-Admin-Rolle', () => {
    expect(istAdmin(admin)).toBe(true);
    expect(istAdmin(keiner)).toBe(false);
    expect(istAdmin(undefined)).toBe(false);
    expect(istAdmin(null)).toBe(false);
  });
});
