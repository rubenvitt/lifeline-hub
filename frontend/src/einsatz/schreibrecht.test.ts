import { describe, expect, it } from 'vitest';
import {
  darfBeantragen,
  darfEinsatzLeiten,
  darfImEinsatzSchreiben,
  darfEinsatzVerwalten,
  darfFuehrungBedienen,
  darfModuleVerwalten,
  darfOriginalLaden,
  darfVerwaltung,
  istAdmin,
  istBeobachter,
  istEinsatzLeitung,
  fuehrtHier,
  istSpiegel,
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

// Führung je Einsatz (LLH-1491, Spec `instanz-fuehrung`): führt eine gekoppelte Instanz, lehnt der
// Server jeden Schreibweg mit 409 ab; die Schreib-UI sperrt mit. Bedienen darf die Führung die
// Einsatzleitung oder der Admin der Einsatz-Org, auch am abgeschlossenen Einsatz.
describe('Führung je Einsatz (LLH-1491)', () => {
  const hier = { fuehrend: true, bei: 'ELW 1', epoche: 1, offen: false };
  const hub = { fuehrend: false, bei: 'Hub Nord', epoche: 3, offen: false };
  const el = { ...aktiv, meine_rolle: 'einsatzleitung' as const };
  const orgAdmin = { ...admin, org_id: 1 };
  const orgKeiner = { ...keiner, org_id: 1 };

  it('ohne Akte und mit eigener Führung schreibt die Instanz', () => {
    expect(fuehrtHier(undefined)).toBe(true);
    expect(fuehrtHier({})).toBe(true);
    expect(fuehrtHier({ fuehrung: hier })).toBe(true);
    expect(darfImEinsatzSchreiben({ ...el, fuehrung: hier })).toBe(true);
  });

  it('führt eine andere Instanz, sind Schreiben, Leiten und Verwalten gesperrt', () => {
    expect(fuehrtHier({ fuehrung: hub })).toBe(false);
    expect(darfImEinsatzSchreiben({ ...el, fuehrung: hub })).toBe(false);
    expect(darfEinsatzLeiten({ ...el, fuehrung: hub })).toBe(false);
    expect(darfEinsatzVerwalten({ ...el, org_id: 1, fuehrung: hub }, orgAdmin)).toBe(false);
    expect(darfModuleVerwalten({ ...el, org_id: 1, fuehrung: hub }, orgAdmin)).toBe(false);
    expect(darfBeantragen({ ...el, fuehrung: hub })).toBe(false);
  });

  it('am Spiegel bleibt Beantragen trotz fremder Führung offen (LLH-1492)', () => {
    const spiegel = { gegenstelle: 'Hub Nord', beendet: false, antraege_ausstehend: 0, antraege_abgelehnt: 0 };
    expect(darfBeantragen({ ...el, fuehrung: hub, spiegel })).toBe(true);
    expect(darfImEinsatzSchreiben({ ...el, fuehrung: hub, spiegel })).toBe(false);
  });

  it('die Führung bedienen Einsatzleitung und Admin der Einsatz-Org, unabhängig von Status und Führung', () => {
    expect(darfFuehrungBedienen({ ...el, org_id: 1, fuehrung: hub }, orgKeiner)).toBe(true);
    expect(
      darfFuehrungBedienen({ ...zu, meine_rolle: 'einsatzleitung', org_id: 1 }, orgKeiner),
    ).toBe(true);
    expect(
      darfFuehrungBedienen({ ...aktiv, meine_rolle: null, org_id: 1 }, { ...admin, org_id: 1 }),
    ).toBe(true);
    expect(
      darfFuehrungBedienen({ ...aktiv, meine_rolle: null, org_id: 1 }, { ...admin, org_id: 2 }),
    ).toBe(false);
    expect(
      darfFuehrungBedienen(
        { ...aktiv, meine_rolle: 'fuehrungspersonal', org_id: 1 },
        { ...keiner, org_id: 1 },
      ),
    ).toBe(false);
    expect(darfFuehrungBedienen(undefined, orgAdmin)).toBe(false);
  });
});

// Spiegel (LLH-1492, design.md D13): eine andere Instanz führt den Einsatz. Die Bedienung ist wie
// beim Beobachter, nur die beantragbaren Erfassungen bleiben offen (`darfBeantragen`).
describe('Spiegel (LLH-1492, D13)', () => {
  const spiegel = {
    gegenstelle: 'ELW 1',
    letzter_abgleich_at: '2026-11-10 08:00:00',
    beendet: false,
    antraege_ausstehend: 0,
    antraege_abgelehnt: 0,
  };
  const el = { ...aktiv, meine_rolle: 'einsatzleitung' as const, spiegel };
  const fuePers = { ...aktiv, meine_rolle: 'fuehrungspersonal' as const, spiegel };

  it('erkennt den Spiegel am Feld spiegel', () => {
    expect(istSpiegel(el)).toBe(true);
    expect(istSpiegel({ ...aktiv, meine_rolle: 'einsatzleitung', spiegel: null })).toBe(false);
    expect(istSpiegel({ ...aktiv, meine_rolle: 'einsatzleitung' })).toBe(false);
    expect(istSpiegel(undefined)).toBe(false);
  });

  it('sperrt Schreiben und Leiten wie beim Beobachter', () => {
    expect(darfImEinsatzSchreiben(el)).toBe(false);
    expect(darfImEinsatzSchreiben(fuePers)).toBe(false);
    expect(darfEinsatzLeiten(el)).toBe(false);
  });

  it('sperrt Verwaltung und Module, auch für den Admin der Org', () => {
    const adminOrg1 = { system_rolle: 'admin' as const, org_id: 1 };
    expect(darfEinsatzVerwalten({ ...el, org_id: 1 }, adminOrg1)).toBe(false);
    expect(darfModuleVerwalten({ ...el, org_id: 1 }, adminOrg1)).toBe(false);
    expect(darfEinsatzVerwalten({ ...el, meine_rolle: null, org_id: 1 }, adminOrg1)).toBe(false);
  });

  it('darfBeantragen: Schreibrollen im aktiven Spiegel', () => {
    expect(darfBeantragen(el)).toBe(true);
    expect(darfBeantragen(fuePers)).toBe(true);
  });

  it('darfBeantragen: nicht für Beobachter, ohne Rolle, abgeschlossen oder nach beendetem Abgleich', () => {
    expect(darfBeantragen({ ...el, meine_rolle: 'beobachter' })).toBe(false);
    expect(darfBeantragen({ ...el, meine_rolle: null })).toBe(false);
    expect(darfBeantragen({ ...el, status: 'abgeschlossen' })).toBe(false);
    expect(darfBeantragen({ ...el, spiegel: { ...spiegel, beendet: true } })).toBe(false);
    expect(darfBeantragen(undefined)).toBe(false);
  });

  it('darfBeantragen gleicht ohne Spiegel dem Schreibrecht', () => {
    for (const meine_rolle of [
      'einsatzleitung',
      'fuehrungspersonal',
      'beobachter',
      null,
    ] as const) {
      for (const status of ['aktiv', 'abgeschlossen'] as const) {
        const e = { status, meine_rolle };
        expect(darfBeantragen(e)).toBe(darfImEinsatzSchreiben(e));
      }
    }
  });
});
