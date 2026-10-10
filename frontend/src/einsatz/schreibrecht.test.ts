import { describe, expect, it } from 'vitest';
import {
  darfEinsatzLeiten,
  darfImEinsatzSchreiben,
  darfEinsatzVerwalten,
  darfModuleVerwalten,
  darfOriginalLaden,
  darfVerwaltung,
  istAdmin,
  istBeobachter,
  istEinsatzLeitung,
} from './schreibrecht';

// Wahrheitstabelle für die zentrale Schreibrecht-Regel (LFH-234). Pinnt die beiden bewussten
// Verhaltensentscheidungen: (a) Modul-Schreibwege nur mit Einsatzrolle, die System-Rolle Admin
// zählt dort nicht (LFH-1118, wie der Server), (b) Null-Rolle ohne Schreibrecht.

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

  it('verweigert Beobachter', () => {
    expect(darfImEinsatzSchreiben({ ...aktiv, meine_rolle: 'beobachter' })).toBe(false);
  });

  it('verweigert fehlende Einsatz-Rolle (Null-Leak-Tightening ggü. alter B/C-Semantik)', () => {
    expect(darfImEinsatzSchreiben({ ...aktiv, meine_rolle: null })).toBe(false);
  });

  it('kennt keinen Admin-Zweig: der Server lehnt den Admin ohne Schreibrolle mit 403 ab (LFH-1118)', () => {
    // Die Regel nimmt nur den Einsatz; ein Benutzer-Argument (und damit ein Admin-Zweig) passt
    // nicht in die Signatur.
    expect(darfImEinsatzSchreiben).toHaveLength(1);
    // @ts-expect-error — kein Benutzer-Parameter
    expect(darfImEinsatzSchreiben({ ...aktiv, meine_rolle: null }, admin)).toBe(false);
  });

  it('verweigert im abgeschlossenen Einsatz auch der Einsatzleitung (aktiv bleibt vorausgesetzt)', () => {
    expect(darfImEinsatzSchreiben({ ...zu, meine_rolle: 'einsatzleitung' })).toBe(false);
  });

  it('ist fail-closed bei fehlendem Einsatz', () => {
    expect(darfImEinsatzSchreiben(undefined)).toBe(false);
    expect(darfImEinsatzSchreiben(null)).toBe(false);
  });
});

describe('darfEinsatzLeiten', () => {
  it('erlaubt die Einsatzleitung im aktiven Einsatz', () => {
    expect(darfEinsatzLeiten({ ...aktiv, meine_rolle: 'einsatzleitung' })).toBe(true);
  });

  it('kennt keinen Admin-Zweig: der Server lehnt den Admin ohne Einsatzleitung mit 403 ab (LFH-1118)', () => {
    expect(darfEinsatzLeiten).toHaveLength(1);
    // @ts-expect-error — kein Benutzer-Parameter
    expect(darfEinsatzLeiten({ ...aktiv, meine_rolle: 'fuehrungspersonal' }, admin)).toBe(false);
  });

  it('verweigert Führungspersonal und Beobachter', () => {
    expect(darfEinsatzLeiten({ ...aktiv, meine_rolle: 'fuehrungspersonal' })).toBe(false);
    expect(darfEinsatzLeiten({ ...aktiv, meine_rolle: 'beobachter' })).toBe(false);
  });

  it('verweigert im abgeschlossenen Einsatz', () => {
    expect(darfEinsatzLeiten({ ...zu, meine_rolle: 'einsatzleitung' })).toBe(false);
  });

  it('ist fail-closed bei fehlendem Einsatz', () => {
    expect(darfEinsatzLeiten(undefined)).toBe(false);
  });
});

describe('darfModuleVerwalten (LFH-995)', () => {
  const eigeneOrg = { ...aktiv, org_id: 1 };
  const adminOrg1 = { system_rolle: 'admin' as const, org_id: 1 };
  const adminOrg2 = { system_rolle: 'admin' as const, org_id: 2 };

  it('erlaubt die Einsatzleitung, auch als Admin einer fremden Org', () => {
    expect(darfModuleVerwalten({ ...eigeneOrg, meine_rolle: 'einsatzleitung' }, undefined)).toBe(
      true,
    );
    expect(darfModuleVerwalten({ ...eigeneOrg, meine_rolle: 'einsatzleitung' }, adminOrg2)).toBe(
      true,
    );
  });

  it('erlaubt den Admin nur in der Org des Einsatzes', () => {
    expect(darfModuleVerwalten({ ...eigeneOrg, meine_rolle: null }, adminOrg1)).toBe(true);
    expect(darfModuleVerwalten({ ...eigeneOrg, meine_rolle: null }, adminOrg2)).toBe(false);
    expect(darfModuleVerwalten({ ...eigeneOrg, meine_rolle: 'fuehrungspersonal' }, adminOrg2)).toBe(
      false,
    );
  });

  it('verweigert im abgeschlossenen Einsatz und ohne Einsatz', () => {
    expect(
      darfModuleVerwalten(
        { status: 'abgeschlossen', org_id: 1, meine_rolle: 'einsatzleitung' },
        adminOrg1,
      ),
    ).toBe(false);
    expect(darfModuleVerwalten(undefined, adminOrg1)).toBe(false);
  });
});

describe('darfEinsatzVerwalten (LFH-1066)', () => {
  const eigeneOrg = { ...aktiv, org_id: 1 };
  const adminOrg1 = { system_rolle: 'admin' as const, org_id: 1 };
  const adminOrg2 = { system_rolle: 'admin' as const, org_id: 2 };
  const keinerOrg2 = { system_rolle: 'keiner' as const, org_id: 2 };

  it('erlaubt Einsatzleitung und Führungspersonal, auch über die Org-Grenze', () => {
    for (const meine_rolle of ['einsatzleitung', 'fuehrungspersonal'] as const) {
      expect(darfEinsatzVerwalten({ ...eigeneOrg, meine_rolle }, keinerOrg2)).toBe(true);
      expect(darfEinsatzVerwalten({ ...eigeneOrg, meine_rolle }, adminOrg2)).toBe(true);
    }
  });

  it('erlaubt den Admin ohne Schreibrolle nur in der Org des Einsatzes', () => {
    expect(darfEinsatzVerwalten({ ...eigeneOrg, meine_rolle: null }, adminOrg1)).toBe(true);
    expect(darfEinsatzVerwalten({ ...eigeneOrg, meine_rolle: 'beobachter' }, adminOrg1)).toBe(true);
    expect(darfEinsatzVerwalten({ ...eigeneOrg, meine_rolle: null }, adminOrg2)).toBe(false);
    expect(darfEinsatzVerwalten({ ...eigeneOrg, meine_rolle: 'beobachter' }, adminOrg2)).toBe(
      false,
    );
  });

  it('verweigert Beobachter ohne Admin, den abgeschlossenen Einsatz und fehlende Daten', () => {
    expect(darfEinsatzVerwalten({ ...eigeneOrg, meine_rolle: 'beobachter' }, keinerOrg2)).toBe(
      false,
    );
    expect(
      darfEinsatzVerwalten(
        { status: 'abgeschlossen', org_id: 1, meine_rolle: 'einsatzleitung' },
        adminOrg1,
      ),
    ).toBe(false);
    expect(darfEinsatzVerwalten(undefined, adminOrg1)).toBe(false);
    expect(darfEinsatzVerwalten({ ...eigeneOrg, meine_rolle: null }, undefined)).toBe(false);
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

// ORG-Achse (LFH-328) — bewusst ohne Einsatz-Argument: `darfVerwaltung` kennt weder `status`
// noch `meine_rolle`. Wahrheitstabelle über die zwei Benutzer-Felder.
describe('darfVerwaltung', () => {
  it('öffnet die Verwaltung für System-Admin UND Führungskraft', () => {
    expect(darfVerwaltung({ system_rolle: 'admin', org_rolle: 'keine' })).toBe(true);
    expect(darfVerwaltung({ system_rolle: 'keiner', org_rolle: 'fuehrungskraft' })).toBe(true);
    expect(darfVerwaltung({ system_rolle: 'admin', org_rolle: 'fuehrungskraft' })).toBe(true);
  });
  it('sperrt Benutzer ohne beide Rollen und fehlende Kontexte', () => {
    expect(darfVerwaltung({ system_rolle: 'keiner', org_rolle: 'keine' })).toBe(false);
    expect(darfVerwaltung(undefined)).toBe(false);
    expect(darfVerwaltung(null)).toBe(false);
  });
});

describe('darfOriginalLaden (LFH-747)', () => {
  it('erlaubt die Einsatzleitung, auch im abgeschlossenen Einsatz', () => {
    expect(darfOriginalLaden({ ...aktiv, meine_rolle: 'einsatzleitung' })).toBe(true);
    expect(darfOriginalLaden({ ...zu, meine_rolle: 'einsatzleitung' })).toBe(true);
  });

  it('erlaubt den System-Admin ohne Einsatz-Rolle', () => {
    expect(darfOriginalLaden({ ...zu, meine_rolle: null }, admin)).toBe(true);
  });

  it('verweigert Führungspersonal, Beobachter und Unbekannte', () => {
    expect(darfOriginalLaden({ ...aktiv, meine_rolle: 'fuehrungspersonal' }, keiner)).toBe(false);
    expect(darfOriginalLaden({ ...aktiv, meine_rolle: 'beobachter' }, keiner)).toBe(false);
    expect(darfOriginalLaden(undefined, undefined)).toBe(false);
  });
});
