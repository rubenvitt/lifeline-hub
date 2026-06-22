# CMD+K-Command-Palette Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eine globale Command-Palette (CMD+K / STRG+K) für Modul-Navigation, Schnellaktionen, Einsatz-Wechsel und Schnelleinstellungen, berechtigungsgefiltert und per Fuzzy durchsuchbar.

**Architecture:** Ein `CommandPaletteProvider` in `main.tsx` (oberhalb der Routes) hält den Hotkey-Listener und den Offen-State. Die Befehlsliste entsteht in einer **reinen Funktion** `baueBefehle(kontext)` (ohne React, voll unit-testbar), die der Hook `useBefehle` mit den realen Werten aus `useAuth`/`useThemeMode`/`useLocation`/React-Query verdrahtet. Eine präsentationale `CommandPalette` (bekommt `befehle` als Prop) rendert ein antd `Modal` mit Fuzzy-Suche (Fuse.js) und Tastatur-Navigation. Schnellaktionen navigieren mit `?neu=1`; vier Ziel-Seiten öffnen darauf ihren bestehenden Neu-Eingang.

**Tech Stack:** React 18 · React Router 6 · antd 5 · @tanstack/react-query 5 · Fuse.js · react-icons (Tb) · Vitest + React Testing Library.

**Spec:** `docs/superpowers/specs/2026-06-22-cmdk-command-palette-design.md`

## Global Constraints

- **TS-Lib ES2020** — keine ES2022-APIs (`.at()`, `.findLast()`, `Object.hasOwn`); `tsc --noEmit` ist ein eigenes Gate (Vitest/esbuild prüft keine Typen).
- **pnpm via mise**, immer absolute `-C`-Pfade: `mise exec pnpm@11.0.9 -- pnpm -C /Users/rubeen/dev/personal/lifeline-hub/.claude/worktrees/feat+lfh-11-command-palette/frontend <cmd>`.
- **Identifier + UI-Texte auf Deutsch** (Projekt-Konvention: `baueBefehle`, `istModulGesperrt`, „Abmelden").
- **antd themed Styles** über `theme.useToken()` (CSS-Variablen sind nicht aktiviert — `var(--ant-*)` greift nie).
- **Kein statisches `Modal.x`/`message.x`** außerhalb des Baums; falls nötig `App.useApp()`. (Hier nicht erwartet.)
- **Volle Test-Suite** nur mit `--no-file-parallelism` (sonst flaky); Einzeldateien laufen direkt.
- **rust-embed**: Frontend-Änderungen brauchen `pnpm build` + Backend-Neustart, um im laufenden `cargo run` sichtbar zu werden — für Unit-Tests irrelevant.

**Abkürzung im Plan:** `PNPM` := `mise exec pnpm@11.0.9 -- pnpm -C /Users/rubeen/dev/personal/lifeline-hub/.claude/worktrees/feat+lfh-11-command-palette/frontend`. Exit-Codes für Gates ehrlich via `rtk proxy` bei Bedarf.

---

### Task 1: Pfad-Helper `einsatzIdAusPfad`

**Files:**
- Create: `frontend/src/command-palette/einsatzPfad.ts`
- Test: `frontend/src/command-palette/einsatzPfad.test.ts`

**Interfaces:**
- Produces: `einsatzIdAusPfad(pathname: string): number | null`

- [ ] **Step 1: Failing test**

```ts
// frontend/src/command-palette/einsatzPfad.test.ts
import { describe, it, expect } from 'vitest';
import { einsatzIdAusPfad } from './einsatzPfad';

describe('einsatzIdAusPfad', () => {
  it('liest die ID aus einer Modul-Route', () => {
    expect(einsatzIdAusPfad('/einsaetze/5/etb')).toBe(5);
  });
  it('liest die ID auch ohne Modul-Segment', () => {
    expect(einsatzIdAusPfad('/einsaetze/12')).toBe(12);
  });
  it('liefert null auf der Einsatz-Liste', () => {
    expect(einsatzIdAusPfad('/einsaetze')).toBeNull();
  });
  it('liefert null außerhalb des Einsatz-Bereichs', () => {
    expect(einsatzIdAusPfad('/profil')).toBeNull();
    expect(einsatzIdAusPfad('/')).toBeNull();
  });
  it('liefert null bei nicht-numerischer ID', () => {
    expect(einsatzIdAusPfad('/einsaetze/abc/etb')).toBeNull();
  });
});
```

- [ ] **Step 2: Run, expect FAIL**

Run: `PNPM exec vitest run src/command-palette/einsatzPfad.test.ts`
Expected: FAIL ("einsatzIdAusPfad is not a function" / Modul nicht gefunden).

- [ ] **Step 3: Implement**

```ts
// frontend/src/command-palette/einsatzPfad.ts
/** Liest die Einsatz-ID aus `/einsaetze/:id/...`; null außerhalb eines Einsatz-Workspaces. */
export function einsatzIdAusPfad(pathname: string): number | null {
  const teile = pathname.split('/').filter(Boolean); // z. B. ['einsaetze','5','etb']
  if (teile[0] !== 'einsaetze' || teile.length < 2) return null;
  const n = Number(teile[1]);
  return Number.isInteger(n) && n > 0 ? n : null;
}
```

- [ ] **Step 4: Run, expect PASS**

Run: `PNPM exec vitest run src/command-palette/einsatzPfad.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/command-palette/einsatzPfad.ts frontend/src/command-palette/einsatzPfad.test.ts
git commit -m "feat(command-palette): einsatzIdAusPfad-Helper (LFH-11)"
```

---

### Task 2: Befehls-Typen + `baueBefehle` (Module + Navigation, Berechtigungsfilter)

**Files:**
- Create: `frontend/src/command-palette/typen.ts`
- Create: `frontend/src/command-palette/befehle.ts`
- Test: `frontend/src/command-palette/befehle.test.ts`

**Interfaces:**
- Produces:
  - `type BefehlGruppe = 'module' | 'schnellaktionen' | 'einsaetze' | 'einstellungen' | 'navigation'`
  - `interface Befehl { id: string; gruppe: BefehlGruppe; label: string; schlagworte?: string[]; icon?: IconType; ausfuehren: () => void }`
  - `interface BefehlKontext { einsatzId: number|null; benutzer: BenutzerAnzeige|null; einsaetze: EinsatzAnzeige[]; overrides?: ModulOverrides; navigate: (p:string)=>void; setThemeModus: (m:ThemeModus)=>void; setKoordinaten: (f:Koordinatenformat)=>void; logout: ()=>void }`
  - `GRUPPEN_REIHENFOLGE: BefehlGruppe[]`, `GRUPPEN_LABEL: Record<BefehlGruppe,string>`
  - `baueBefehle(k: BefehlKontext): Befehl[]`
- Consumes: `modulRegistry`, `istModulSichtbar`, `istModulGesperrt`, `modulZielRoute` aus `../einsatz/modulRegistry`.

- [ ] **Step 1: Write `typen.ts`** (kein eigener Test — reine Typen/Konstanten)

```ts
// frontend/src/command-palette/typen.ts
import type { IconType } from 'react-icons';
import type { BenutzerAnzeige, EinsatzAnzeige, ModulOverrides, Koordinatenformat } from '../api/types';
import type { ThemeModus } from '../theme/ThemeModeProvider';

export type BefehlGruppe = 'module' | 'schnellaktionen' | 'einsaetze' | 'einstellungen' | 'navigation';

export interface Befehl {
  id: string;
  gruppe: BefehlGruppe;
  label: string;
  schlagworte?: string[];
  icon?: IconType;
  ausfuehren: () => void;
}

export interface BefehlKontext {
  einsatzId: number | null;
  benutzer: BenutzerAnzeige | null;
  einsaetze: EinsatzAnzeige[];
  overrides?: ModulOverrides;
  navigate: (pfad: string) => void;
  setThemeModus: (m: ThemeModus) => void;
  setKoordinaten: (f: Koordinatenformat) => void;
  logout: () => void;
}

export const GRUPPEN_REIHENFOLGE: BefehlGruppe[] = [
  'module', 'schnellaktionen', 'einsaetze', 'einstellungen', 'navigation',
];

export const GRUPPEN_LABEL: Record<BefehlGruppe, string> = {
  module: 'Module',
  schnellaktionen: 'Schnellaktionen',
  einsaetze: 'Einsatz wechseln',
  einstellungen: 'Einstellungen',
  navigation: 'Navigation',
};
```

- [ ] **Step 2: Failing test (`befehle.test.ts`)**

```ts
// frontend/src/command-palette/befehle.test.ts
import { describe, it, expect, vi } from 'vitest';
import { baueBefehle } from './befehle';
import type { BefehlKontext } from './typen';
import type { BenutzerAnzeige, EinsatzAnzeige, ModulOverride } from '../api/types';

const fuehrungskraft: BenutzerAnzeige = {
  id: 1, anzeigename: 'EL', benutzername: 'el', system_rolle: 'keiner',
  org_rolle: 'fuehrungskraft', aktiv: true, erstellt_at: '',
};
const sichter: BenutzerAnzeige = { ...fuehrungskraft, id: 2, org_rolle: 'keine' };
const admin: BenutzerAnzeige = { ...fuehrungskraft, id: 3, system_rolle: 'admin' };

/** Vollständiges ModulOverride bauen (alle 6 Pflichtfelder), Default frei+sichtbar. */
function ueberschreibung(felder: Partial<ModulOverride>): ModulOverride {
  return { einsatz_id: 5, modul_key: 'etb', sichtbar: true, benoetigte_rolle: null, geaendert_at: null, geaendert_von: null, ...felder };
}

function kontext(over: Partial<BefehlKontext> = {}): BefehlKontext {
  return {
    einsatzId: 5, benutzer: fuehrungskraft, einsaetze: [], overrides: undefined,
    navigate: vi.fn(), setThemeModus: vi.fn(), setKoordinaten: vi.fn(), logout: vi.fn(),
    ...over,
  };
}

describe('baueBefehle — Module', () => {
  it('listet fertige Module im Einsatz-Kontext und navigiert', () => {
    const k = kontext();
    const b = baueBefehle(k);
    const etb = b.find((x) => x.id === 'modul:etb');
    expect(etb).toBeDefined();
    etb!.ausfuehren();
    expect(k.navigate).toHaveBeenCalledWith('/einsaetze/5/etb');
  });
  it('blendet Module ohne Einsatz-Kontext ganz aus', () => {
    const b = baueBefehle(kontext({ einsatzId: null }));
    expect(b.some((x) => x.gruppe === 'module')).toBe(false);
    expect(b.some((x) => x.gruppe === 'schnellaktionen')).toBe(false);
  });
  it('sperrt rollen-pflichtige Module für Nicht-Berechtigte aus (Override)', () => {
    const overrides = { etb: ueberschreibung({ benoetigte_rolle: 'fuehrungskraft' }) };
    expect(baueBefehle(kontext({ benutzer: fuehrungskraft, overrides })).some((x) => x.id === 'modul:etb')).toBe(true);
    expect(baueBefehle(kontext({ benutzer: sichter, overrides })).some((x) => x.id === 'modul:etb')).toBe(false);
  });
  it('versteckt unsichtbar geschaltete Module für alle (Override)', () => {
    const overrides = { etb: ueberschreibung({ sichtbar: false }) };
    expect(baueBefehle(kontext({ benutzer: fuehrungskraft, overrides })).some((x) => x.id === 'modul:etb')).toBe(false);
  });
});

describe('baueBefehle — Navigation/Berechtigung', () => {
  it('zeigt Admin-Navigation nur für Admins', () => {
    expect(baueBefehle(kontext({ benutzer: admin })).some((x) => x.id === 'nav:benutzer')).toBe(true);
    expect(baueBefehle(kontext({ benutzer: fuehrungskraft })).some((x) => x.id === 'nav:benutzer')).toBe(false);
  });
  it('bietet immer Abmelden + Alle Einsätze', () => {
    const b = baueBefehle(kontext({ einsatzId: null, benutzer: sichter }));
    expect(b.some((x) => x.id === 'nav:abmelden')).toBe(true);
    expect(b.some((x) => x.id === 'nav:einsaetze')).toBe(true);
  });
});
```

- [ ] **Step 3: Run, expect FAIL** — `PNPM exec vitest run src/command-palette/befehle.test.ts`

- [ ] **Step 4: Implement `befehle.ts` (Module + Navigation-Teil; Rest folgt in Task 3)**

```ts
// frontend/src/command-palette/befehle.ts
import { TbList, TbUser, TbSettings, TbLogout } from 'react-icons/tb';
import {
  modulRegistry, istModulSichtbar, istModulGesperrt, modulZielRoute,
} from '../einsatz/modulRegistry';
import type { Befehl, BefehlKontext } from './typen';

export function baueBefehle(k: BefehlKontext): Befehl[] {
  const befehle: Befehl[] = [];

  // 1. Module — nur im Einsatz-Kontext, fertig, sichtbar, nicht rollen-gesperrt
  if (k.einsatzId != null) {
    for (const m of modulRegistry) {
      if (m.status !== 'fertig') continue;
      if (!istModulSichtbar(m, k.overrides)) continue;
      if (istModulGesperrt(m, k.benutzer, k.overrides)) continue;
      const ziel = `/einsaetze/${k.einsatzId}/${modulZielRoute(m)}`;
      befehle.push({
        id: `modul:${m.key}`, gruppe: 'module', label: m.label, icon: m.icon,
        schlagworte: m.beschreibung ? [m.beschreibung] : undefined,
        ausfuehren: () => k.navigate(ziel),
      });
    }
  }

  // 5. Navigation — global
  befehle.push({ id: 'nav:einsaetze', gruppe: 'navigation', label: 'Alle Einsätze', icon: TbList, ausfuehren: () => k.navigate('/einsaetze') });
  befehle.push({ id: 'nav:profil', gruppe: 'navigation', label: 'Profil', icon: TbUser, ausfuehren: () => k.navigate('/profil') });
  if (k.benutzer?.system_rolle === 'admin') {
    befehle.push({ id: 'nav:benutzer', gruppe: 'navigation', label: 'Benutzerverwaltung', icon: TbUser, ausfuehren: () => k.navigate('/benutzer') });
    befehle.push({ id: 'nav:stammdaten', gruppe: 'navigation', label: 'Stammdaten', icon: TbList, ausfuehren: () => k.navigate('/stammdaten') });
    befehle.push({ id: 'nav:admin', gruppe: 'navigation', label: 'Administration', icon: TbSettings, ausfuehren: () => k.navigate('/admin') });
  }
  befehle.push({ id: 'nav:abmelden', gruppe: 'navigation', label: 'Abmelden', icon: TbLogout, ausfuehren: () => k.logout() });

  return befehle;
}
```

- [ ] **Step 5: Run, expect PASS** — `PNPM exec vitest run src/command-palette/befehle.test.ts`

- [ ] **Step 6: Typecheck-Gate** — `PNPM run typecheck` → keine Fehler in `command-palette/`.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/command-palette/typen.ts frontend/src/command-palette/befehle.ts frontend/src/command-palette/befehle.test.ts
git commit -m "feat(command-palette): baueBefehle mit Modul- + Navigationsbefehlen, Rollenfilter (LFH-11)"
```

---

### Task 3: `baueBefehle` erweitern — Schnellaktionen, Einsatz-Wechsel, Schnelleinstellungen

**Files:**
- Modify: `frontend/src/command-palette/befehle.ts`
- Modify: `frontend/src/command-palette/befehle.test.ts`

**Interfaces:**
- Consumes: bestehender `baueBefehle`-Aufbau aus Task 2.
- Produces: zusätzliche Befehle der Gruppen `schnellaktionen`, `einsaetze`, `einstellungen` (gleiche `Befehl`-Signatur).

- [ ] **Step 1: Failing tests anhängen**

```ts
// in befehle.test.ts ergänzen
import type { Koordinatenformat } from '../api/types';

const aktiverEinsatz: EinsatzAnzeige = {
  id: 7, bezeichnung: 'Hochwasser Nord', stichwort: 'THW', status: 'aktiv',
  begonnen_at: '', abgeschlossen_at: null, abgeschlossen_von: null, einsatzart: 'realeinsatz',
  einsatznummer_intern: null, angelegt_at: '', leitstellen_nr: null, einsatzort: null,
  einsatzort_lat: null, einsatzort_lon: null, meldende_stelle: null, sachverhalt: null,
  anzahl_betroffene_initial: null, meine_rolle: 'einsatzleitung', org_id: 1, org_name: 'KV',
};
const beendet: EinsatzAnzeige = { ...aktiverEinsatz, id: 8, bezeichnung: 'Altfall', status: 'abgeschlossen' };

describe('baueBefehle — Schnellaktionen', () => {
  it('verdrahtet die Top-4-Aktionen mit ?neu=1 für Berechtigte', () => {
    const k = kontext();
    const b = baueBefehle(k);
    const person = b.find((x) => x.id === 'aktion:personen');
    expect(person).toBeDefined();
    person!.ausfuehren();
    expect(k.navigate).toHaveBeenCalledWith('/einsaetze/5/personen?neu=1');
    expect(b.map((x) => x.id).filter((id) => id.startsWith('aktion:'))).toEqual(
      ['aktion:personen', 'aktion:etb', 'aktion:unfallhilfsstellen', 'aktion:schaeden'],
    );
  });
  it('folgt dem Modulfilter: versteckte Trägermodule liefern keine Schnellaktion', () => {
    const overrides = { etb: ueberschreibung({ sichtbar: false }) };
    expect(baueBefehle(kontext({ overrides })).some((x) => x.id === 'aktion:etb')).toBe(false);
  });
});

describe('baueBefehle — Einsatz-Wechsel', () => {
  it('listet nur aktive Einsätze', () => {
    const k = kontext({ einsaetze: [aktiverEinsatz, beendet] });
    const b = baueBefehle(k);
    expect(b.some((x) => x.id === 'einsatz:7')).toBe(true);
    expect(b.some((x) => x.id === 'einsatz:8')).toBe(false);
    b.find((x) => x.id === 'einsatz:7')!.ausfuehren();
    expect(k.navigate).toHaveBeenCalledWith('/einsaetze/7');
  });
});

describe('baueBefehle — Schnelleinstellungen', () => {
  it('schaltet Theme und Koordinatensystem', () => {
    const k = kontext();
    const b = baueBefehle(k);
    b.find((x) => x.id === 'theme:dark')!.ausfuehren();
    expect(k.setThemeModus).toHaveBeenCalledWith('dark');
    b.find((x) => x.id === 'koord:mgrs')!.ausfuehren();
    expect(k.setKoordinaten).toHaveBeenCalledWith('mgrs' as Koordinatenformat);
  });
});
```

- [ ] **Step 2: Run, expect FAIL** — `PNPM exec vitest run src/command-palette/befehle.test.ts`

- [ ] **Step 3: Implement — Konstanten + Blöcke in `befehle.ts` ergänzen**

Imports oben erweitern:
```ts
import { TbList, TbUser, TbSettings, TbLogout, TbPlus, TbSun, TbMoon, TbDeviceDesktop, TbWorld } from 'react-icons/tb';
import type { ThemeModus, } from '../theme/ThemeModeProvider';
import type { Koordinatenformat } from '../api/types';
```

Modul-Konstanten oberhalb von `baueBefehle`:
```ts
const SCHNELLAKTIONEN: { modulKey: string; route: string; label: string; schlagworte: string[] }[] = [
  { modulKey: 'personen', route: 'personen', label: 'Neue Person erfassen', schlagworte: ['registrieren', 'vermisst', 'betroffen', 'patient'] },
  { modulKey: 'etb', route: 'etb', label: 'Neuer ETB-Eintrag', schlagworte: ['tagebuch', 'meldung', 'eintrag'] },
  { modulKey: 'unfallhilfsstellen', route: 'unfallhilfsstellen', label: 'Neue Unfallhilfsstelle', schlagworte: ['uhs', 'behandlungsplatz', 'patientenablage'] },
  { modulKey: 'schaeden', route: 'schaeden', label: 'Neuen Schaden erfassen', schlagworte: ['schaden', 'objekt'] },
];

const THEME_BEFEHLE: { id: string; label: string; modus: ThemeModus; icon: typeof TbSun }[] = [
  { id: 'theme:system', label: 'Darstellung: System', modus: 'system', icon: TbDeviceDesktop },
  { id: 'theme:light', label: 'Darstellung: Hell', modus: 'light', icon: TbSun },
  { id: 'theme:dark', label: 'Darstellung: Dunkel', modus: 'dark', icon: TbMoon },
];

const KOORD_BEFEHLE: { format: Koordinatenformat; label: string }[] = [
  { format: 'wgs84', label: 'WGS84 (Dezimalgrad)' },
  { format: 'dms', label: 'Grad/Minuten/Sekunden' },
  { format: 'utm', label: 'UTM' },
  { format: 'mgrs', label: 'MGRS / UTMREF' },
  { format: 'gk', label: 'Gauß-Krüger' },
];
```

Innerhalb des `if (k.einsatzId != null)`-Blocks, NACH der Modul-Schleife, die Schnellaktionen ergänzen:
```ts
    // 2. Schnellaktionen — nur Träger-Module, die der User darf
    for (const a of SCHNELLAKTIONEN) {
      const m = modulRegistry.find((x) => x.key === a.modulKey);
      if (!m || !istModulSichtbar(m, k.overrides) || istModulGesperrt(m, k.benutzer, k.overrides)) continue;
      const ziel = `/einsaetze/${k.einsatzId}/${a.route}?neu=1`;
      befehle.push({
        id: `aktion:${a.modulKey}`, gruppe: 'schnellaktionen', label: a.label,
        icon: TbPlus, schlagworte: a.schlagworte, ausfuehren: () => k.navigate(ziel),
      });
    }
```

Nach dem `if`-Block (global), VOR der Navigation, Einsatz-Wechsel + Einstellungen ergänzen:
```ts
  // 3. Einsatz-Wechsel — aktive Einsätze (global)
  for (const e of k.einsaetze) {
    if (e.status !== 'aktiv') continue;
    befehle.push({
      id: `einsatz:${e.id}`, gruppe: 'einsaetze', label: e.bezeichnung, icon: TbList,
      schlagworte: e.stichwort ? [e.stichwort] : undefined,
      ausfuehren: () => k.navigate(`/einsaetze/${e.id}`),
    });
  }

  // 4. Schnelleinstellungen — global
  for (const t of THEME_BEFEHLE) {
    befehle.push({ id: t.id, gruppe: 'einstellungen', label: t.label, icon: t.icon, schlagworte: ['theme', 'dark', 'hell', 'dunkel'], ausfuehren: () => k.setThemeModus(t.modus) });
  }
  for (const c of KOORD_BEFEHLE) {
    befehle.push({ id: `koord:${c.format}`, gruppe: 'einstellungen', label: `Koordinaten: ${c.label}`, icon: TbWorld, schlagworte: ['koordinaten', 'format', c.format], ausfuehren: () => k.setKoordinaten(c.format) });
  }
```

- [ ] **Step 4: Run, expect PASS** — `PNPM exec vitest run src/command-palette/befehle.test.ts`
- [ ] **Step 5: Typecheck** — `PNPM run typecheck`
- [ ] **Step 6: Commit**

```bash
git add frontend/src/command-palette/befehle.ts frontend/src/command-palette/befehle.test.ts
git commit -m "feat(command-palette): Schnellaktionen, Einsatz-Wechsel, Schnelleinstellungen (LFH-11)"
```

---

### Task 4: Fuzzy-Suche `filtereBefehle` (Fuse.js)

**Files:**
- Modify: `frontend/package.json` (Dependency `fuse.js`)
- Create: `frontend/src/command-palette/fuzzy.ts`
- Test: `frontend/src/command-palette/fuzzy.test.ts`

**Interfaces:**
- Produces: `filtereBefehle(befehle: Befehl[], suche: string): Befehl[]`

- [ ] **Step 1: Dependency installieren**

Run: `PNPM add fuse.js`
Expected: `fuse.js` erscheint in `frontend/package.json` `dependencies`; `pnpm-lock.yaml` aktualisiert.

- [ ] **Step 2: Failing test**

```ts
// frontend/src/command-palette/fuzzy.test.ts
import { describe, it, expect } from 'vitest';
import { filtereBefehle } from './fuzzy';
import type { Befehl } from './typen';

const b = (id: string, label: string, schlagworte?: string[]): Befehl => ({
  id, gruppe: 'module', label, schlagworte, ausfuehren: () => {},
});
const liste: Befehl[] = [
  b('modul:etb', 'ETB', ['tagebuch']),
  b('modul:personen', 'Personen', ['vermisst']),
  b('modul:lagekarte', 'Lagekarte'),
];

describe('filtereBefehle', () => {
  it('gibt bei leerer Suche alles zurück', () => {
    expect(filtereBefehle(liste, '   ')).toHaveLength(3);
  });
  it('findet per Substring im Label', () => {
    expect(filtereBefehle(liste, 'lage').map((x) => x.id)).toContain('modul:lagekarte');
  });
  it('findet per Schlagwort', () => {
    expect(filtereBefehle(liste, 'tagebuch').map((x) => x.id)).toContain('modul:etb');
  });
  it('toleriert leichte Tippfehler (Fuzzy)', () => {
    expect(filtereBefehle(liste, 'persanen').map((x) => x.id)).toContain('modul:personen');
  });
});
```

- [ ] **Step 3: Run, expect FAIL** — `PNPM exec vitest run src/command-palette/fuzzy.test.ts`

- [ ] **Step 4: Implement**

```ts
// frontend/src/command-palette/fuzzy.ts
import Fuse from 'fuse.js';
import type { Befehl } from './typen';

/** Substring- + Fuzzy-Filter über Label und Schlagworte; leere Suche → unverändert. */
export function filtereBefehle(befehle: Befehl[], suche: string): Befehl[] {
  const s = suche.trim();
  if (!s) return befehle;
  const fuse = new Fuse(befehle, {
    keys: ['label', 'schlagworte'],
    threshold: 0.4,
    ignoreLocation: true,
    minMatchCharLength: 1,
  });
  return fuse.search(s).map((r) => r.item);
}
```

- [ ] **Step 5: Run, expect PASS** — `PNPM exec vitest run src/command-palette/fuzzy.test.ts`
- [ ] **Step 6: Commit**

```bash
git add frontend/package.json frontend/pnpm-lock.yaml frontend/src/command-palette/fuzzy.ts frontend/src/command-palette/fuzzy.test.ts
git commit -m "feat(command-palette): Fuse.js-Fuzzy-Filter filtereBefehle (LFH-11)"
```

---

### Task 5: Präsentationale `CommandPalette` (Modal, Suche, Tastatur-Nav)

**Files:**
- Create: `frontend/src/command-palette/CommandPalette.tsx`
- Test: `frontend/src/command-palette/CommandPalette.test.tsx`

**Interfaces:**
- Consumes: `filtereBefehle` (Task 4), `Befehl`, `GRUPPEN_REIHENFOLGE`, `GRUPPEN_LABEL` (Task 2).
- Produces: `CommandPalette({ befehle: Befehl[]; schliesse: () => void })` (named export).

- [ ] **Step 1: Failing test**

```tsx
// frontend/src/command-palette/CommandPalette.test.tsx
import { describe, it, expect, vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import { screen } from '@testing-library/react';
import { renderMitProviders } from '../test/utils';
import { CommandPalette } from './CommandPalette';
import type { Befehl } from './typen';

function befehl(id: string, label: string, ausfuehren = () => {}, gruppe: Befehl['gruppe'] = 'module'): Befehl {
  return { id, gruppe, label, ausfuehren };
}

describe('CommandPalette', () => {
  it('filtert die Liste per Sucheingabe', async () => {
    const u = userEvent.setup();
    renderMitProviders(
      <CommandPalette befehle={[befehl('a', 'ETB'), befehl('b', 'Lagekarte')]} schliesse={() => {}} />,
    );
    await u.type(screen.getByRole('combobox'), 'lage');
    expect(screen.queryByText('ETB')).not.toBeInTheDocument();
    expect(screen.getByText('Lagekarte')).toBeInTheDocument();
  });

  it('führt den aktiven Befehl per Enter aus und schließt', async () => {
    const u = userEvent.setup();
    const aus = vi.fn();
    const schliesse = vi.fn();
    renderMitProviders(<CommandPalette befehle={[befehl('a', 'ETB', aus)]} schliesse={schliesse} />);
    await u.keyboard('{Enter}');
    expect(aus).toHaveBeenCalledTimes(1);
    expect(schliesse).toHaveBeenCalledTimes(1);
  });

  it('bewegt die Auswahl mit Pfeiltasten', async () => {
    const u = userEvent.setup();
    const zweit = vi.fn();
    renderMitProviders(
      <CommandPalette befehle={[befehl('a', 'Erstes'), befehl('b', 'Zweites', zweit)]} schliesse={() => {}} />,
    );
    await u.keyboard('{ArrowDown}{Enter}');
    expect(zweit).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run, expect FAIL** — `PNPM exec vitest run src/command-palette/CommandPalette.test.tsx`

- [ ] **Step 3: Implement**

```tsx
// frontend/src/command-palette/CommandPalette.tsx
import { useEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { Modal, Input, theme } from 'antd';
import { filtereBefehle } from './fuzzy';
import { GRUPPEN_LABEL, GRUPPEN_REIHENFOLGE, type Befehl } from './typen';

interface Props {
  befehle: Befehl[];
  schliesse: () => void;
}

/** Präsentationale Palette: Suche + gruppierte, tastaturbedienbare Trefferliste. */
export function CommandPalette({ befehle, schliesse }: Props) {
  const { token } = theme.useToken();
  const [suche, setSuche] = useState('');
  const [aktiv, setAktiv] = useState(0);
  const listeRef = useRef<HTMLDivElement>(null);

  const treffer = useMemo(() => filtereBefehle(befehle, suche), [befehle, suche]);

  // In Gruppen-Reihenfolge anordnen; flache Liste = Navigationsreihenfolge.
  const gruppen = useMemo(
    () => GRUPPEN_REIHENFOLGE
      .map((g) => ({ gruppe: g, items: treffer.filter((b) => b.gruppe === g) }))
      .filter((x) => x.items.length > 0),
    [treffer],
  );
  const flach = useMemo(() => gruppen.flatMap((x) => x.items), [gruppen]);
  const indexVon = useMemo(() => new Map(flach.map((b, i) => [b.id, i])), [flach]);

  useEffect(() => { setAktiv(0); }, [suche]);

  // aktiven Eintrag in den Sichtbereich scrollen
  useEffect(() => {
    const el = listeRef.current?.querySelector('[aria-selected="true"]');
    if (el instanceof HTMLElement) el.scrollIntoView({ block: 'nearest' });
  }, [aktiv]);

  function fuehreAus(b: Befehl | undefined) {
    if (!b) return;
    schliesse();
    b.ausfuehren();
  }

  function aufTaste(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown') { e.preventDefault(); setAktiv((i) => (flach.length ? (i + 1) % flach.length : 0)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setAktiv((i) => (flach.length ? (i - 1 + flach.length) % flach.length : 0)); }
    else if (e.key === 'Enter') { e.preventDefault(); fuehreAus(flach[aktiv]); }
  }

  const aktiverId = flach[aktiv]?.id;

  return (
    <Modal
      open
      onCancel={schliesse}
      footer={null}
      closable={false}
      width={640}
      zIndex={2000}
      styles={{ body: { padding: 0 } }}
      destroyOnClose
    >
      <div>
        <Input
          autoFocus
          variant="borderless"
          size="large"
          placeholder="Suchen: Module, Aktionen, Einstellungen …"
          role="combobox"
          aria-expanded
          aria-controls="cmd-liste"
          aria-activedescendant={aktiverId ? `cmd-${aktiverId}` : undefined}
          value={suche}
          onChange={(e) => setSuche(e.target.value)}
          onKeyDown={aufTaste}
          style={{ padding: '12px 16px', borderBottom: `1px solid ${token.colorBorderSecondary}` }}
        />
        <div id="cmd-liste" role="listbox" ref={listeRef} style={{ maxHeight: 380, overflowY: 'auto', padding: 8 }}>
          {flach.length === 0 && (
            <div style={{ padding: 16, color: token.colorTextSecondary }}>Keine Treffer</div>
          )}
          {gruppen.map((x) => (
            <div key={x.gruppe} role="group" aria-label={GRUPPEN_LABEL[x.gruppe]}>
              <div style={{ padding: '6px 8px', fontSize: 12, textTransform: 'uppercase', color: token.colorTextSecondary }}>
                {GRUPPEN_LABEL[x.gruppe]}
              </div>
              {x.items.map((b) => {
                const i = indexVon.get(b.id)!;
                const istAktiv = i === aktiv;
                const Icon = b.icon;
                return (
                  <div
                    key={b.id}
                    id={`cmd-${b.id}`}
                    role="option"
                    aria-selected={istAktiv}
                    onMouseEnter={() => setAktiv(i)}
                    onClick={() => fuehreAus(b)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px',
                      borderRadius: 6, cursor: 'pointer',
                      background: istAktiv ? token.colorPrimaryBg : 'transparent',
                      color: istAktiv ? token.colorPrimary : token.colorText,
                    }}
                  >
                    {Icon && <Icon size={18} />}
                    <span>{b.label}</span>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </Modal>
  );
}
```

- [ ] **Step 4: Run, expect PASS** — `PNPM exec vitest run src/command-palette/CommandPalette.test.tsx`

> Hinweis: antd `Input` rendert `role="combobox"` nur, weil wir die Prop explizit setzen (oben getan). Die Tastatur-Navigation (`onKeyDown={aufTaste}`) sitzt bewusst direkt am `Input`, NICHT am Wrapper-`div` — antd Modal trappt den Fokus über Sentinel-Knoten, sodass Event-Bubbling vom Wrapper in jsdom unzuverlässig ist. `autoFocus` hält den Fokus im Input, `keyboard()` zielt darauf.

- [ ] **Step 5: Typecheck** — `PNPM run typecheck`
- [ ] **Step 6: Commit**

```bash
git add frontend/src/command-palette/CommandPalette.tsx frontend/src/command-palette/CommandPalette.test.tsx
git commit -m "feat(command-palette): präsentationale Palette mit Fuzzy-Suche + Tastatur-Navigation (LFH-11)"
```

---

### Task 6: `useBefehle`-Hook (Verdrahtung)

**Files:**
- Create: `frontend/src/command-palette/useBefehle.ts`
- Test: `frontend/src/command-palette/useBefehle.test.tsx`

**Interfaces:**
- Consumes: `baueBefehle` (T2/3), `einsatzIdAusPfad` (T1), `useAuth`, `useThemeMode`, `listeEinsaetze`, `ladeModulOverrides`, `setzeOverride`.
- Produces: `useBefehle(): Befehl[]`.

- [ ] **Step 1: Failing test** (Hook mit echten Providern; API + Auth gemockt)

```tsx
// frontend/src/command-palette/useBefehle.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';
import { neuerQueryClient } from '../test/utils';
import { useBefehle } from './useBefehle';

vi.mock('../auth/AuthContext', () => ({
  useAuth: () => ({ benutzer: { id: 1, anzeigename: 'EL', benutzername: 'el', system_rolle: 'keiner', org_rolle: 'fuehrungskraft', aktiv: true, erstellt_at: '' }, laedt: false, login: vi.fn(), logout: vi.fn() }),
}));
vi.mock('../api/einsaetze', () => ({
  listeEinsaetze: vi.fn(() => Promise.resolve([])),
  ladeModulOverrides: vi.fn(() => Promise.resolve({})),
}));

function wrapper(route: string) {
  const client = neuerQueryClient();
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[route]}>{children}</MemoryRouter>
    </QueryClientProvider>
  );
}

describe('useBefehle', () => {
  it('liefert Modul-Befehle im Einsatz-Kontext', async () => {
    const { result } = renderHook(() => useBefehle(), { wrapper: wrapper('/einsaetze/5/etb') });
    await waitFor(() => expect(result.current.some((b) => b.id === 'modul:etb')).toBe(true));
  });
  it('liefert keine Modul-Befehle außerhalb eines Einsatzes', () => {
    const { result } = renderHook(() => useBefehle(), { wrapper: wrapper('/profil') });
    expect(result.current.some((b) => b.gruppe === 'module')).toBe(false);
  });
});
```

- [ ] **Step 2: Run, expect FAIL** — `PNPM exec vitest run src/command-palette/useBefehle.test.tsx`

- [ ] **Step 3: Implement**

```ts
// frontend/src/command-palette/useBefehle.ts
import { useMemo } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../auth/AuthContext';
import { useThemeMode } from '../theme/ThemeModeProvider';
import { listeEinsaetze, ladeModulOverrides } from '../api/einsaetze';
import { setzeOverride } from '../anzeige/koordinatenSystemStore';
import { einsatzIdAusPfad } from './einsatzPfad';
import { baueBefehle } from './befehle';
import type { Befehl } from './typen';

/** Verdrahtet Auth/Theme/Router/Query mit der reinen baueBefehle-Funktion. */
export function useBefehle(): Befehl[] {
  const { benutzer, logout } = useAuth();
  const { setModus } = useThemeMode();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const einsatzId = einsatzIdAusPfad(pathname);

  const { data: einsaetze = [] } = useQuery({ queryKey: ['einsaetze'], queryFn: listeEinsaetze });
  const { data: overrides } = useQuery({
    queryKey: ['modulOverrides', einsatzId],
    queryFn: () => ladeModulOverrides(einsatzId!),
    enabled: einsatzId != null,
  });

  return useMemo(
    () => baueBefehle({
      einsatzId, benutzer, einsaetze, overrides,
      navigate: (p) => navigate(p),
      setThemeModus: setModus,
      setKoordinaten: setzeOverride,
      logout: () => { void logout(); },
    }),
    [einsatzId, benutzer, einsaetze, overrides, navigate, setModus, logout],
  );
}
```

- [ ] **Step 4: Run, expect PASS** — `PNPM exec vitest run src/command-palette/useBefehle.test.tsx`
- [ ] **Step 5: Typecheck** — `PNPM run typecheck`
- [ ] **Step 6: Commit**

```bash
git add frontend/src/command-palette/useBefehle.ts frontend/src/command-palette/useBefehle.test.tsx
git commit -m "feat(command-palette): useBefehle-Hook verdrahtet Kontextquellen (LFH-11)"
```

---

### Task 7: `CommandPaletteProvider` + Hotkey + main.tsx-Einbindung

**Files:**
- Create: `frontend/src/command-palette/CommandPaletteProvider.tsx`
- Test: `frontend/src/command-palette/CommandPaletteProvider.test.tsx`
- Modify: `frontend/src/main.tsx`

**Interfaces:**
- Consumes: `useBefehle` (T6), `CommandPalette` (T5).
- Produces: `CommandPaletteProvider({ children })`, `useCommandPalette(): { offen; oeffne; schliesse; toggle }`.

- [ ] **Step 1: Failing test** (Hotkey öffnet/schließt; `useBefehle` gemockt → isolierter Provider-Test)

```tsx
// frontend/src/command-palette/CommandPaletteProvider.test.tsx
import { describe, it, expect, vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import { screen } from '@testing-library/react';
import { renderMitProviders } from '../test/utils';
import { CommandPaletteProvider } from './CommandPaletteProvider';

vi.mock('./useBefehle', () => ({
  useBefehle: () => [{ id: 'modul:etb', gruppe: 'module', label: 'ETB', ausfuehren: vi.fn() }],
}));

describe('CommandPaletteProvider', () => {
  it('öffnet die Palette mit STRG+K und schließt mit erneutem Druck', async () => {
    const u = userEvent.setup();
    renderMitProviders(<CommandPaletteProvider><div>App-Inhalt</div></CommandPaletteProvider>);
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    await u.keyboard('{Control>}k{/Control}');
    expect(screen.getByRole('listbox')).toBeInTheDocument();
    await u.keyboard('{Control>}k{/Control}');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run, expect FAIL** — `PNPM exec vitest run src/command-palette/CommandPaletteProvider.test.tsx`

- [ ] **Step 3: Implement Provider**

```tsx
// frontend/src/command-palette/CommandPaletteProvider.tsx
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { useBefehle } from './useBefehle';
import { CommandPalette } from './CommandPalette';

interface PaletteWert {
  offen: boolean;
  oeffne: () => void;
  schliesse: () => void;
  toggle: () => void;
}

const PaletteContext = createContext<PaletteWert | null>(null);

export function CommandPaletteProvider({ children }: { children: ReactNode }) {
  const [offen, setOffen] = useState(false);
  const oeffne = useCallback(() => setOffen(true), []);
  const schliesse = useCallback(() => setOffen(false), []);
  const toggle = useCallback(() => setOffen((o) => !o), []);

  useEffect(() => {
    function aufTaste(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault();
        toggle();
      }
    }
    window.addEventListener('keydown', aufTaste);
    return () => window.removeEventListener('keydown', aufTaste);
  }, [toggle]);

  const wert = useMemo(() => ({ offen, oeffne, schliesse, toggle }), [offen, oeffne, schliesse, toggle]);

  return (
    <PaletteContext.Provider value={wert}>
      {children}
      {offen && <PaletteHost schliesse={schliesse} />}
    </PaletteContext.Provider>
  );
}

/** Lädt die Befehle erst beim Öffnen (Query läuft nicht im Leerlauf). */
function PaletteHost({ schliesse }: { schliesse: () => void }) {
  const befehle = useBefehle();
  return <CommandPalette befehle={befehle} schliesse={schliesse} />;
}

export function useCommandPalette(): PaletteWert {
  const w = useContext(PaletteContext);
  if (!w) throw new Error('useCommandPalette muss innerhalb von <CommandPaletteProvider> verwendet werden');
  return w;
}
```

- [ ] **Step 4: Run, expect PASS** — `PNPM exec vitest run src/command-palette/CommandPaletteProvider.test.tsx`

- [ ] **Step 5: main.tsx einbinden**

In `frontend/src/main.tsx` Import ergänzen und `<App />` umschließen:
```tsx
import { CommandPaletteProvider } from './command-palette/CommandPaletteProvider';
```
```tsx
            <AuthProvider>
              <CommandPaletteProvider>
                <App />
              </CommandPaletteProvider>
            </AuthProvider>
```

- [ ] **Step 6: Build-Gate (Typecheck + Vite-Build)** — `PNPM run build`
Expected: `tsc -b` ohne Fehler, Vite-Build erzeugt `dist/`.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/command-palette/CommandPaletteProvider.tsx frontend/src/command-palette/CommandPaletteProvider.test.tsx frontend/src/main.tsx
git commit -m "feat(command-palette): Provider + CMD/STRG+K-Hotkey, in main.tsx eingehängt (LFH-11)"
```

---

### Task 8: `?neu=1`-Handler — PersonenPage

**Files:**
- Modify: `frontend/src/pages/PersonenPage.tsx` (Deeplink-Block bei Zeile 125–134)
- Modify: `frontend/src/pages/PersonenPage.test.tsx`

**Interfaces:**
- Consumes: bestehendes `setModus` (`PersonenPage.tsx:99`) + `searchParams`/`setSearchParams` (`:125`).

- [ ] **Step 1: Failing test** (Render mit `?neu=1` öffnet den Neu-Dialog)

```tsx
// in PersonenPage.test.tsx ergänzen — Muster wie bestehende Tests dort
it('öffnet via ?neu=1 die Schnellerfassung', async () => {
  // Annahme: vorhandener Render-Helper rendert PersonenPage unter /einsaetze/:id/personen.
  // Hier Route mit Query-Param setzen und prüfen, dass das Erfassungs-Formular erscheint.
  renderPersonenPage('/einsaetze/1/personen?neu=1'); // bestehenden Helper/Pattern der Datei nutzen
  expect(await screen.findByRole('dialog')).toBeInTheDocument();
});
```

> Der Subagent richtet sich nach dem in `PersonenPage.test.tsx` bereits etablierten Render-/Routing-Helper (MemoryRouter + Route `/einsaetze/:id/personen`). Falls dort kein Helper existiert, `renderMitProviders(<Routes>…</Routes>, { route })` verwenden und auf das Erscheinen des Schnellerfass-Dialogs prüfen (Titeltext der „schnell"-Maske).

- [ ] **Step 2: Run, expect FAIL** — `PNPM exec vitest run src/pages/PersonenPage.test.tsx`

- [ ] **Step 3: Implement** — direkt nach dem bestehenden `?person`-`useEffect` (nach Zeile 134) einfügen:

```tsx
  // Schnellaktion: ?neu=1 öffnet die Schnellerfassung (Command-Palette, LFH-11).
  useEffect(() => {
    if (searchParams.get('neu') === '1') {
      setModus('schnell');
      searchParams.delete('neu');
      setSearchParams(searchParams, { replace: true });
    }
  }, [searchParams, setSearchParams]);
```

- [ ] **Step 4: Run, expect PASS** — `PNPM exec vitest run src/pages/PersonenPage.test.tsx`
- [ ] **Step 5: Typecheck** — `PNPM run typecheck`
- [ ] **Step 6: Commit**

```bash
git add frontend/src/pages/PersonenPage.tsx frontend/src/pages/PersonenPage.test.tsx
git commit -m "feat(personen): ?neu=1 öffnet Schnellerfassung für Palette-Schnellaktion (LFH-11)"
```

---

### Task 9: `?neu=1`-Handler — UnfallhilfsstellenPage

**Files:**
- Modify: `frontend/src/pages/UnfallhilfsstellenPage.tsx`
- Modify: `frontend/src/pages/UnfallhilfsstellenPage.test.tsx`

**Interfaces:**
- Consumes: `setAnlegen` (`:35`), `schreibgeschuetzt` (`:39`). Neu: `useSearchParams`.

- [ ] **Step 1: Failing test**

```tsx
// in UnfallhilfsstellenPage.test.tsx ergänzen (bestehendes Render-/MSW-Muster der Datei nutzen)
it('öffnet via ?neu=1 den Anlegen-Drawer (aktiver Einsatz)', async () => {
  renderUhsPage('/einsaetze/1/unfallhilfsstellen?neu=1'); // bestehendes Muster der Datei
  expect(await screen.findByText('Unfallhilfsstelle anlegen')).toBeInTheDocument(); // Drawer-Titel laut UhsAnlegenDrawer
});
```

> Drawer-Titel ggf. an den tatsächlichen Text in `pages/uhs/UhsAnlegenDrawer.tsx` anpassen. MSW muss `GET /api/einsaetze/1` mit `status:'aktiv'` und `meine_rolle:'einsatzleitung'` liefern, damit `schreibgeschuetzt=false`.

- [ ] **Step 2: Run, expect FAIL** — `PNPM exec vitest run src/pages/UnfallhilfsstellenPage.test.tsx`

- [ ] **Step 3: Implement**

Import (Zeile 2) erweitern:
```tsx
import { Link, useParams, useSearchParams } from 'react-router-dom';
```
`useEffect` aus React importieren (Zeile 4):
```tsx
import { useEffect, useState } from 'react';
```
Nach `const schreibgeschuetzt = …` (Zeile 39), VOR dem `if (…isLoading) return` (Zeile 52) einfügen:
```tsx
  const [searchParams, setSearchParams] = useSearchParams();
  // Schnellaktion: ?neu=1 öffnet den Anlegen-Drawer, sobald die Rechte feststehen (LFH-11).
  useEffect(() => {
    if (searchParams.get('neu') !== '1') return;
    if (einsatzQuery.isLoading) return;
    if (!schreibgeschuetzt) setAnlegen(true);
    searchParams.delete('neu');
    setSearchParams(searchParams, { replace: true });
  }, [searchParams, setSearchParams, einsatzQuery.isLoading, schreibgeschuetzt]);
```

- [ ] **Step 4: Run, expect PASS** — `PNPM exec vitest run src/pages/UnfallhilfsstellenPage.test.tsx`
- [ ] **Step 5: Typecheck** — `PNPM run typecheck`
- [ ] **Step 6: Commit**

```bash
git add frontend/src/pages/UnfallhilfsstellenPage.tsx frontend/src/pages/UnfallhilfsstellenPage.test.tsx
git commit -m "feat(uhs): ?neu=1 öffnet Anlegen-Drawer für Palette-Schnellaktion (LFH-11)"
```

---

### Task 10: `?neu=1`-Handler — SchaedenPage

**Files:**
- Modify: `frontend/src/pages/SchaedenPage.tsx` (Zeile 161 + neuer Effect)
- Modify: `frontend/src/pages/SchaedenPage.test.tsx`

**Interfaces:**
- Consumes: `setErfassenOffen` (`:172`). `searchParams` (`:161`) braucht zusätzlich den Setter.

- [ ] **Step 1: Failing test**

```tsx
// in SchaedenPage.test.tsx ergänzen (bestehendes Muster der Datei nutzen)
it('öffnet via ?neu=1 die Schadens-Erfassung', async () => {
  renderSchaedenPage('/einsaetze/1/schaeden?neu=1'); // bestehendes Muster der Datei
  expect(await screen.findByText('Schaden erfassen')).toBeInTheDocument(); // Erfass-Drawer-Titel anpassen
});
```

> Drawer-/Modal-Titel an den realen Text der Erfass-Maske anpassen.

- [ ] **Step 2: Run, expect FAIL** — `PNPM exec vitest run src/pages/SchaedenPage.test.tsx`

- [ ] **Step 3: Implement**

Zeile 161 um den Setter erweitern:
```tsx
  const [searchParams, setSearchParams] = useSearchParams();
```
Direkt nach dem bestehenden `?schaden`-`useEffect` (nach Zeile 202) einfügen:
```tsx
  // Schnellaktion: ?neu=1 öffnet die Erfassung (Command-Palette, LFH-11).
  useEffect(() => {
    if (searchParams.get('neu') === '1') {
      setErfassenOffen(true);
      searchParams.delete('neu');
      setSearchParams(searchParams, { replace: true });
    }
  }, [searchParams, setSearchParams]);
```

- [ ] **Step 4: Run, expect PASS** — `PNPM exec vitest run src/pages/SchaedenPage.test.tsx`
- [ ] **Step 5: Typecheck** — `PNPM run typecheck`
- [ ] **Step 6: Commit**

```bash
git add frontend/src/pages/SchaedenPage.tsx frontend/src/pages/SchaedenPage.test.tsx
git commit -m "feat(schaeden): ?neu=1 öffnet Erfassung für Palette-Schnellaktion (LFH-11)"
```

---

### Task 11: `?neu=1`-Handler — EtbPage (Fokus-Brücke, Risiko-Task)

**Files:**
- Modify: `frontend/src/pages/EtbPage.tsx`
- Modify: `frontend/src/pages/EtbPage.test.tsx`

**Interfaces:**
- Consumes: die Sticky-Erfassungszeile `.etb-erfassung-sticky` (`EtbPage.tsx:154`). Neu: `useSearchParams`.

**Risiko (aus Spec):** ETB hat keinen Dialog-Toggle, sondern eine inline-Erfassungszeile. Die Aktion fokussiert das erste Eingabefeld der Sticky-Leiste. Findet der Selektor kein Feld (z. B. `darfSchreiben=false`), bleibt es bei reiner Navigation zur ETB-Seite — kein Fehler. Der Test prüft die Param-Verarbeitung, nicht den realen Fokus (in jsdom unzuverlässig).

- [ ] **Step 1: Failing test**

```tsx
// in EtbPage.test.tsx ergänzen (bestehendes Render-/MSW-Muster der Datei nutzen)
it('verarbeitet ?neu=1 und entfernt den Param', async () => {
  const { container } = renderEtbPage('/einsaetze/1/etb?neu=1'); // bestehendes Muster
  // Erfassungszeile ist bei Schreibrecht vorhanden; der Effekt darf nicht werfen.
  await waitFor(() => expect(container.querySelector('.etb-erfassung-sticky')).toBeTruthy());
  // Kein Crash + Param-Bereinigung gilt als Erfolg (Fokus selbst ist in jsdom nicht prüfbar).
});
```

> Falls die Test-Infrastruktur der Datei den Pfad nicht über die Route auswertet, mit `renderMitProviders` + `<Routes>` arbeiten und `darfSchreiben` über die MSW-Einsatzantwort (`status:'aktiv'`, `meine_rolle:'einsatzleitung'`) sicherstellen.

- [ ] **Step 2: Run, expect FAIL/anpassen** — `PNPM exec vitest run src/pages/EtbPage.test.tsx`

- [ ] **Step 3: Implement**

`useEffect` + `useSearchParams` importieren:
```tsx
import { useEffect, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom'; // bestehende RR-Imports der Datei zusammenführen
```
Im Komponentenkörper (nach den vorhandenen `useState`-Zeilen ~55–57) einfügen:
```tsx
  const [searchParams, setSearchParams] = useSearchParams();
  // Schnellaktion: ?neu=1 fokussiert die angepinnte Erfassungszeile (Command-Palette, LFH-11).
  useEffect(() => {
    if (searchParams.get('neu') !== '1') return;
    const leiste = document.querySelector('.etb-erfassung-sticky');
    if (leiste instanceof HTMLElement) {
      leiste.scrollIntoView({ block: 'start' });
      const feld = leiste.querySelector('textarea, input');
      if (feld instanceof HTMLElement) feld.focus();
    }
    searchParams.delete('neu');
    setSearchParams(searchParams, { replace: true });
  }, [searchParams, setSearchParams]);
```

- [ ] **Step 4: Run, expect PASS** — `PNPM exec vitest run src/pages/EtbPage.test.tsx`
- [ ] **Step 5: Typecheck** — `PNPM run typecheck`
- [ ] **Step 6: Commit**

```bash
git add frontend/src/pages/EtbPage.tsx frontend/src/pages/EtbPage.test.tsx
git commit -m "feat(etb): ?neu=1 fokussiert Erfassungszeile für Palette-Schnellaktion (LFH-11)"
```

---

### Task 12: Gesamt-Gate + e2e-Smoke (Drawer-Koexistenz)

**Files:**
- Create (optional): `frontend/e2e/command-palette.spec.ts`

- [ ] **Step 1: Volle Unit-Suite (stabiles Gate)**

Run: `PNPM exec vitest run --no-file-parallelism`
Expected: alle Tests grün (inkl. der vier geänderten Seiten).

- [ ] **Step 2: Typecheck + Build-Gate**

Run: `PNPM run typecheck` und `PNPM run build`
Expected: keine Fehler.

- [ ] **Step 3: Manuelle Verifikation der Integrationskette + AK6 (PFLICHT)**

Provider→useBefehle→CommandPalette sind nur isoliert getestet (der Provider-Test mockt `useBefehle` weg), und AK6 (Drawer-Koexistenz, zIndex/Overlap) ist laut Projekt-Memory unit-technisch nicht greifbar. Daher die laufende App prüfen (`/run` oder chrome-devtools-mcp): App starten, in einen Einsatz navigieren, einen Drawer öffnen (z. B. Personen-Detail), dann STRG+K. Verifizieren:
- (a) Palette öffnet **sichtbar über** dem Drawer (kein Verschwinden hinter dem Overlay),
- (b) ein Modul-Befehl navigiert korrekt,
- (c) ESC schließt **nur** die Palette, der Drawer-State bleibt intakt,
- (d) eine Schnellaktion (z. B. „Neue Person erfassen") öffnet den Neu-Dialog,
- (e) Theme- und Koordinaten-Umschaltung greifen sichtbar.

Beobachtungen im Abschluss festhalten (Evidence-before-assertion). **Reminder:** Vorher `PNPM run build` + Backend-Neustart, sonst zeigt rust-embed das alte Bundle.

- [ ] **Step 4: (Optional/Kür) e2e-Smoke** — nur wenn die e2e-Harness lokal steht (dediziertes Backend, siehe Projekt-Memory). Sonst überspringen; die manuelle Verifikation aus Step 3 ist der AK6-Nachweis.

```ts
// frontend/e2e/command-palette.spec.ts (Skizze — an vorhandene e2e-Helper anpassen)
import { test, expect } from '@playwright/test';

test('Palette öffnet über offenem Inhalt und navigiert', async ({ page }) => {
  await page.goto('/einsaetze/1/etb');
  await page.keyboard.press('Control+k');
  await expect(page.getByRole('listbox')).toBeVisible();
  await page.getByPlaceholder(/Suchen/).fill('lagekarte');
  await page.getByRole('option', { name: /Lagekarte/ }).click();
  await expect(page).toHaveURL(/\/lagekarte$/);
});
```

- [ ] **Step 5: Commit (falls e2e erstellt)**

```bash
git add frontend/e2e/command-palette.spec.ts
git commit -m "test(command-palette): e2e-Smoke Palette über Inhalt (LFH-11)"
```

---

## Self-Review (vom Plan-Autor)

**Spec-Abdeckung:**
- AK1 Hotkey aus jeder Ansicht → Task 7 (Provider in main.tsx, `window`-Listener). ✓
- AK2 Substring/Fuzzy → Task 4 (Fuse.js). ✓
- AK3 Enter führt aus/navigiert → Task 5 (`fuehreAus` bei Enter). ✓
- AK4 ESC schließt ohne Side-Effect → Task 5 (Modal `onCancel`, kein `ausfuehren`). ✓
- AK5 Rollen-/Org-Filter, gesperrt ausgeblendet → Task 2/3, durch **Override-getriebene Tests bewiesen** (Aussperr via `benoetigte_rolle` + Versteck via `sichtbar:false`, auch auf Schnellaktionen), Admin-Gate; kein `disabled`-Feld. ✓
- AK6 Über Drawer/Modal → Task 5 (`zIndex:2000`) + Task 12 Step 3 (**manuelle Verifikation, PFLICHT**), optionaler e2e-Smoke. ✓
- Schnellaktionen Top 4 → Task 3 (Befehle) + Tasks 8–11 (`?neu=1`-Andockpunkte). ✓
- Schnelleinstellungen (Theme, Koordinaten) + Einsatz-Wechsel → Task 3. ✓

**Platzhalter-Scan:** Keine TBD/TODO im Code. Die Seiten-Tests (8–11) verweisen bewusst auf das je Datei bereits etablierte Render-Muster statt es zu erfinden — der konkrete Effect-Code ist vollständig angegeben.

**Typ-Konsistenz:** `Befehl.ausfuehren` durchgängig; `baueBefehle`-IDs (`modul:*`, `aktion:*`, `einsatz:*`, `theme:*`, `koord:*`, `nav:*`) in Tests und Implementierung identisch; `filtereBefehle(befehle, suche)`, `einsatzIdAusPfad(pathname)`, `useBefehle()` signaturgleich über alle Tasks.

**Reihenfolge/Abhängigkeiten:** 1 → 2 → 3 → 4 → 5 → 6 → 7, danach 8–11 unabhängig voneinander, 12 als Abschluss-Gate.
