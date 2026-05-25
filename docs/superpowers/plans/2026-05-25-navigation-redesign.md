# Navigations-Redesign — Implementierungsplan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Die flache Top-Leiste wird durch ein Drei-Ebenen-Navigationsmodell (Global → Einsatz-Workspace → Modul) ersetzt; alle geplanten Module sind ab Tag 1 als Nav-Einträge sichtbar, unfertige als WIP-Stub.

**Architecture:** Eine zentrale `modulRegistry` (single source of truth) speist Nav-Rail, Modul-Panel und Routen-Registrierung. `AppLayout` wird zur globalen Shell (Ebene 1, Topbar). Ein neuer `EinsatzLayout` bildet Ebene 2 (Icon-Rail + Modul-Panel + Switcher-Header) und hängt die bestehende `EtbPage` unverändert als ETB-Modul ein. Module ohne Implementierung rendern einen einheitlichen `ModulStub`.

**Tech Stack:** React 18, react-router-dom v6, antd v5, @tanstack/react-query, react-icons/tb (Tabler), Vitest + Testing-Library + MSW.

---

## Verbindliche Architektur-Entscheidungen

Diese Punkte lässt die Spec offen; sie sind hier festgelegt und dürfen in späteren Tasks nicht still gekippt werden:

1. **Einsatz-Kachel navigiert nach `/einsaetze/:id`** (nicht `/etb`). Spec-Zeile 114 garantiert die *Stabilität* der Route `/einsaetze/:id/etb`, nicht den Literal-Aufruf in `EinsaetzePage.tsx:60`. Das Ziel `/:id` triggert den Default-Redirect, den die Spec testen will.
2. **`EtbPage` bleibt unverändert** (Spec: „unverändert"). Die Breadcrumb-Zeile + Überschrift duplizieren sichtbar den Switcher-Header von `EinsatzLayout`. Das ist ein **bekannter Folge-Punkt** — kein Task in diesem Plan löscht die Breadcrumb (das bräche die Heading-Assertion in `EtbPage.test.tsx`).
3. **Stammdaten/Profil sind einfache Platzhalter-Seiten, KEINE Registry-Einträge.** Die `modulRegistry` ist Workspace-scoped (Kategorien). Globale Topbar-Einträge leben in `AppLayout`. Ein generischer `Platzhalter` rendert beide Welten, ohne sie zu vermischen.
4. **`DefaultModulRedirect` leitet das Ziel aus der Registry ab**, nicht hartcodiert: Lage-Dashboard, falls dessen `status === 'fertig'`, sonst Fallback `etb`. Heute ist Dashboard `geplant` → ETB.
5. **`istModulGesperrt` existiert ab jetzt**, auch wenn heute alle Workspace-Module für alle sichtbar sind (`benoetigteRolle` meist `undefined`). Getestet wird die Funktion direkt mit konstruierten Einträgen, nicht über die echte Registry.

## Dateistruktur

Neues Verzeichnis `frontend/src/einsatz/` für alle Workspace-Bausteine (Ebene 2). Geteilte/globale Bausteine bleiben in `components/` bzw. `pages/`.

| Datei | Verantwortung |
|---|---|
| `einsatz/modulRegistry.ts` | Typen, Kategorien, Modul-Daten, Helfer (`moduleNachKategorie`, `istModulGesperrt`, `redirectZiel`) |
| `components/Platzhalter.tsx` | Generische Platzhalter-Darstellung (🚧 + Titel + Beschreibung) |
| `einsatz/ModulStub.tsx` | WIP-/geplant-Modul-Seite; rendert `Platzhalter` aus einem `ModulEintrag` |
| `einsatz/EinsatzSwitcher.tsx` | Dropdown im Header: aktive Einsätze + „Alle Einsätze …" + „Stammdaten" |
| `einsatz/IconRail.tsx` | Vertikale Kategorie-Rail (präsentational) |
| `einsatz/ModulPanel.tsx` | Modul-Liste der offenen Kategorie (präsentational) |
| `einsatz/EinsatzLayout.tsx` | Ebene-2-Shell: Switcher-Header + IconRail + ModulPanel + `<Outlet/>` |
| `einsatz/DefaultModulRedirect.tsx` | Index-Route `/einsaetze/:id` → leitet auf Default-Modul um |
| `pages/StammdatenPage.tsx` | Globale Platzhalter-Seite Stammdaten |
| `pages/ProfilPage.tsx` | Globale Platzhalter-Seite Profil |
| `components/AppLayout.tsx` (Umbau) | Globale Topbar (Ebene 1) |
| `pages/EinsaetzePage.tsx` (Umbau) | Heim-/Einsatzauswahl als Kachel-Grid |
| `App.tsx` (Umbau) | Drei-Ebenen-Routing, Registry-abgeleitete Modul-Routen |

**Konventionen** (aus dem Bestand übernehmen): deutsche Bezeichner & Tests, `renderMitProviders` aus `test/utils.tsx`, MSW-Handler via `server.use(...)`, antd-Komponenten, `useAuth()` für den Benutzer. Paketmanager ist **pnpm** (`pnpm-lock.yaml` + `pnpm-workspace.yaml` sind der neue Stand; `package-lock.json` ist veraltet — **nicht** `npm install` benutzen).

---

## Task 1: react-icons Dependency

**Files:**
- Modify: `frontend/package.json` (dependencies)

- [ ] **Step 1: react-icons installieren**

Run (im Verzeichnis `frontend/`):
```bash
cd frontend && pnpm add react-icons
```
Erwartet: `package.json` enthält danach `"react-icons"` unter `dependencies`, `pnpm-lock.yaml` aktualisiert.

- [ ] **Step 2: Import verifizieren**

Run:
```bash
cd frontend && node -e "import('react-icons/tb').then(m => console.log('TbMap2' in m ? 'OK' : 'FEHLT'))"
```
Erwartet: Ausgabe `OK`.

- [ ] **Step 3: Commit**

```bash
cd frontend && git add package.json pnpm-lock.yaml
git commit -m "build: react-icons (Tabler) als Icon-System ergaenzen" -m "Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Modul-Registry (single source of truth)

**Files:**
- Create: `frontend/src/einsatz/modulRegistry.ts`
- Test: `frontend/src/einsatz/modulRegistry.test.ts`

Die Registry trägt Nav, Routing, WIP-Status, Sichtbarkeit. Icon-Namen sind Tabler-Exporte aus `react-icons/tb`; ein Tippfehler bricht `tsc` (Step 5) — bei einem nicht auflösbaren Namen das nächstliegende Icon von https://tabler.io/icons wählen.

- [ ] **Step 1: Failing test schreiben**

```ts
// frontend/src/einsatz/modulRegistry.test.ts
import { describe, expect, it } from 'vitest';
import {
  modulRegistry,
  kategorien,
  moduleNachKategorie,
  istModulGesperrt,
  redirectZiel,
  type ModulEintrag,
} from './modulRegistry';
import type { BenutzerAnzeige } from '../api/types';

const admin: BenutzerAnzeige = {
  id: 1, anzeigename: 'A', benutzername: 'a', system_rolle: 'admin',
  org_rolle: 'keine', aktiv: true, erstellt_at: '2026-05-23 10:00:00',
};
const ohne: BenutzerAnzeige = { ...admin, system_rolle: 'keiner', org_rolle: 'keine' };
const fk: BenutzerAnzeige = { ...admin, system_rolle: 'keiner', org_rolle: 'fuehrungskraft' };

const offen: ModulEintrag = {
  key: 'x', kategorie: 'erfassung', label: 'X', icon: modulRegistry[0].icon,
  route: 'x', status: 'geplant',
};
const adminModul: ModulEintrag = { ...offen, benoetigteRolle: 'admin' };
const fkModul: ModulEintrag = { ...offen, benoetigteRolle: 'fuehrungskraft' };

describe('modulRegistry', () => {
  it('enthaelt das fertige ETB-Modul in der Kategorie Erfassung', () => {
    const etb = modulRegistry.find((m) => m.key === 'etb');
    expect(etb).toBeDefined();
    expect(etb?.status).toBe('fertig');
    expect(etb?.kategorie).toBe('erfassung');
    expect(etb?.route).toBe('etb');
  });

  it('liefert jede Kategorie aus der Reihenfolge mit mindestens einem Modul', () => {
    for (const k of kategorien) {
      expect(moduleNachKategorie(k.key).length).toBeGreaterThan(0);
    }
  });

  it('moduleNachKategorie filtert nach Kategorie', () => {
    expect(moduleNachKategorie('erfassung').every((m) => m.kategorie === 'erfassung')).toBe(true);
  });

  it('istModulGesperrt: ohne benoetigteRolle nie gesperrt', () => {
    expect(istModulGesperrt(offen, ohne)).toBe(false);
    expect(istModulGesperrt(offen, null)).toBe(false);
  });

  it('istModulGesperrt: admin-Modul nur fuer Admin frei', () => {
    expect(istModulGesperrt(adminModul, admin)).toBe(false);
    expect(istModulGesperrt(adminModul, fk)).toBe(true);
    expect(istModulGesperrt(adminModul, ohne)).toBe(true);
  });

  it('istModulGesperrt: fuehrungskraft-Modul fuer Admin und Fuehrungskraft frei', () => {
    expect(istModulGesperrt(fkModul, admin)).toBe(false);
    expect(istModulGesperrt(fkModul, fk)).toBe(false);
    expect(istModulGesperrt(fkModul, ohne)).toBe(true);
  });

  it('redirectZiel: Fallback ETB solange Dashboard nicht fertig', () => {
    expect(redirectZiel(modulRegistry)).toBe('etb');
  });

  it('redirectZiel: Dashboard sobald es fertig ist', () => {
    const mitFertigemDashboard = modulRegistry.map((m) =>
      m.key === 'lage-dashboard' ? { ...m, status: 'fertig' as const } : m,
    );
    expect(redirectZiel(mitFertigemDashboard)).toBe('lage-dashboard');
  });
});
```

- [ ] **Step 2: Test laufen lassen — muss fehlschlagen**

Run:
```bash
cd frontend && pnpm test src/einsatz/modulRegistry.test.ts
```
Erwartet: FAIL — Modul `./modulRegistry` kann nicht aufgelöst werden.

- [ ] **Step 3: Registry implementieren**

```ts
// frontend/src/einsatz/modulRegistry.ts
import type { IconType } from 'react-icons';
import {
  TbHierarchy, TbFileDescription, TbSitemap, TbUsers, TbBuildingCommunity,
  TbUsersGroup, TbUser, TbTruck, TbBox, TbPackages,
  TbClipboardText, TbFirstAidKit, TbPaw, TbHome,
  TbMap2, TbLayoutDashboard, TbReport, TbListDetails, TbAlertTriangle,
  TbMessage, TbMessageCircle, TbBell, TbClipboardList, TbInbox,
  TbSettings,
} from 'react-icons/tb';
import type { BenutzerAnzeige } from '../api/types';

export type ModulStatus = 'fertig' | 'geplant' | 'wip';
export type KategorieKey =
  | 'fuehrung' | 'kraefte' | 'erfassung' | 'lage' | 'kommunikation' | 'einstellungen';
export type BenoetigteRolle = 'admin' | 'fuehrungskraft';

export interface Kategorie {
  key: KategorieKey;
  label: string;
  icon: IconType;
}

export interface ModulEintrag {
  key: string;
  kategorie: KategorieKey;
  label: string;
  icon: IconType;
  /** Relativer Pfad-Abschnitt unter /einsaetze/:id (z. B. 'etb'). */
  route: string;
  status: ModulStatus;
  /** Kurztext für die WIP-/Platzhalter-Seite. */
  beschreibung?: string;
  /** Fehlt sie, ist das Modul für alle frei. */
  benoetigteRolle?: BenoetigteRolle;
}

/** Reihenfolge der Icon-Rail (eine Zeile je Kategorie). */
export const kategorien: Kategorie[] = [
  { key: 'fuehrung', label: 'Führung', icon: TbHierarchy },
  { key: 'kraefte', label: 'Kräfte & Mittel', icon: TbTruck },
  { key: 'erfassung', label: 'Erfassung', icon: TbClipboardText },
  { key: 'lage', label: 'Lage', icon: TbMap2 },
  { key: 'kommunikation', label: 'Kommunikation', icon: TbMessage },
  { key: 'einstellungen', label: 'Einstellungen', icon: TbSettings },
];

export const modulRegistry: ModulEintrag[] = [
  // Führung
  { key: 'einsatzdaten', kategorie: 'fuehrung', label: 'Einsatzdaten', icon: TbFileDescription, route: 'einsatzdaten', status: 'geplant', beschreibung: 'Stammdaten des Einsatzes: Bezeichnung, Stichwort, Zeiten, Leitung.' },
  { key: 'einsatzabschnitte', kategorie: 'fuehrung', label: 'Einsatzabschnitte', icon: TbSitemap, route: 'einsatzabschnitte', status: 'geplant', beschreibung: 'Gliederung des Einsatzes in Abschnitte und Zuordnung von Einheiten.' },
  { key: 'stab', kategorie: 'fuehrung', label: 'Stab', icon: TbBuildingCommunity, route: 'stab', status: 'wip', beschreibung: 'Stabsarbeit (S1–S6). Wird später ausgearbeitet.' },
  // Kräfte & Mittel
  { key: 'einheiten', kategorie: 'kraefte', label: 'Einheiten', icon: TbUsersGroup, route: 'einheiten', status: 'geplant', beschreibung: 'Taktische Einheiten: Führer, Mannschaft, Fahrzeug, Abschnittszuordnung.' },
  { key: 'personal', kategorie: 'kraefte', label: 'Personal', icon: TbUser, route: 'personal', status: 'geplant', beschreibung: 'Im Einsatz aktive Personen aus dem Stammdaten-Pool plus Ad-hoc-Kräfte.' },
  { key: 'fahrzeuge', kategorie: 'kraefte', label: 'Fahrzeuge', icon: TbTruck, route: 'fahrzeuge', status: 'geplant', beschreibung: 'Disponierte Fahrzeuge des Einsatzes.' },
  { key: 'abrollbehaelter', kategorie: 'kraefte', label: 'Abrollbehälter', icon: TbBox, route: 'abrollbehaelter', status: 'geplant', beschreibung: 'Abrollbehälter und deren Träger-Fahrzeuge.' },
  { key: 'material', kategorie: 'kraefte', label: 'Material', icon: TbPackages, route: 'material', status: 'geplant', beschreibung: 'Material und Verbrauchsgüter im Einsatz.' },
  // Erfassung
  { key: 'etb', kategorie: 'erfassung', label: 'ETB', icon: TbClipboardText, route: 'etb', status: 'fertig', beschreibung: 'Einsatztagebuch.' },
  { key: 'personen', kategorie: 'erfassung', label: 'Personen', icon: TbUsers, route: 'personen', status: 'geplant', beschreibung: 'Ein Personenstamm mit Status-Lebenszyklus (vermisst → betroffen → Patient → verstorben).' },
  { key: 'unfallhilfsstellen', kategorie: 'erfassung', label: 'Unfallhilfsstellen', icon: TbFirstAidKit, route: 'unfallhilfsstellen', status: 'geplant', beschreibung: 'Behandlungs-/Sammelstellen als Örtlichkeiten.' },
  { key: 'tiere', kategorie: 'erfassung', label: 'Tiere', icon: TbPaw, route: 'tiere', status: 'geplant', beschreibung: 'Betroffene Tiere, getrennt vom Personenstamm.' },
  { key: 'sachschaeden', kategorie: 'erfassung', label: 'Sachschäden', icon: TbHome, route: 'sachschaeden', status: 'wip', beschreibung: 'Erfassung von Sachschäden (optional). Wird später ausgearbeitet.' },
  // Lage
  { key: 'lage-dashboard', kategorie: 'lage', label: 'Dashboard', icon: TbLayoutDashboard, route: 'lage-dashboard', status: 'geplant', beschreibung: 'Verdichtete Lageübersicht des Einsatzes.' },
  { key: 'lagekarte', kategorie: 'lage', label: 'Lagekarte', icon: TbMap2, route: 'lagekarte', status: 'geplant', beschreibung: 'Taktische Karte mit Zeichen, Einheiten und Zonen.' },
  { key: 'lageberichte', kategorie: 'lage', label: 'Lageberichte', icon: TbReport, route: 'lageberichte', status: 'geplant', beschreibung: 'Strukturierte Lageberichte.' },
  { key: 'kraefteuebersicht', kategorie: 'lage', label: 'Kräfteübersicht', icon: TbListDetails, route: 'kraefteuebersicht', status: 'geplant', beschreibung: 'Meldebild der eingesetzten Kräfte.' },
  { key: 'gefahrenzonen', kategorie: 'lage', label: 'Gefahren-/Absperrzonen', icon: TbAlertTriangle, route: 'gefahrenzonen', status: 'geplant', beschreibung: 'Gefahren- und Absperrbereiche.' },
  // Kommunikation
  { key: 'chat', kategorie: 'kommunikation', label: 'Chat', icon: TbMessageCircle, route: 'chat', status: 'geplant', beschreibung: 'Einsatzinterner Chat (pro Einsatz, nicht einsatzübergreifend).' },
  { key: 'erinnerungen', kategorie: 'kommunikation', label: 'Erinnerungen', icon: TbBell, route: 'erinnerungen', status: 'geplant', beschreibung: 'Terminierte Erinnerungen.' },
  { key: 'auftraege', kategorie: 'kommunikation', label: 'Aufträge/Befehle', icon: TbClipboardList, route: 'auftraege', status: 'geplant', beschreibung: 'Aufträge und Befehle mit Quittierung.' },
  { key: 'meldungen', kategorie: 'kommunikation', label: 'Meldungen (eingehend)', icon: TbInbox, route: 'meldungen', status: 'geplant', beschreibung: 'Eingehende Meldungen zur Bearbeitung.' },
  // Einstellungen
  { key: 'einsatz-einstellungen', kategorie: 'einstellungen', label: 'Einstellungen', icon: TbSettings, route: 'einstellungen', status: 'geplant', beschreibung: 'Einsatzbezogene Einstellungen.' },
];

export function moduleNachKategorie(kategorie: KategorieKey): ModulEintrag[] {
  return modulRegistry.filter((m) => m.kategorie === kategorie);
}

/** Grundsatz „disabled statt versteckt": liefert, ob das Modul für den Benutzer gesperrt ist. */
export function istModulGesperrt(modul: ModulEintrag, benutzer: BenutzerAnzeige | null): boolean {
  if (!modul.benoetigteRolle) return false;
  const istAdmin = benutzer?.system_rolle === 'admin';
  if (modul.benoetigteRolle === 'admin') return !istAdmin;
  // 'fuehrungskraft': Admin oder org_rolle fuehrungskraft
  return !(istAdmin || benutzer?.org_rolle === 'fuehrungskraft');
}

/** Ziel der Default-Route /einsaetze/:id: Lage-Dashboard sobald fertig, sonst ETB-Fallback. */
export function redirectZiel(register: ModulEintrag[] = modulRegistry): string {
  const dashboard = register.find((m) => m.key === 'lage-dashboard');
  return dashboard && dashboard.status === 'fertig' ? dashboard.route : 'etb';
}
```

- [ ] **Step 4: Test laufen lassen — muss bestehen**

Run:
```bash
cd frontend && pnpm test src/einsatz/modulRegistry.test.ts
```
Erwartet: PASS (8 Tests grün).

- [ ] **Step 5: Typecheck (Icon-Namen prüfen)**

Run:
```bash
cd frontend && pnpm typecheck
```
Erwartet: keine Fehler. Bei „Module '"react-icons/tb"' has no exported member 'TbXY'" das nächste passende Icon wählen.

- [ ] **Step 6: Commit**

```bash
cd frontend && git add src/einsatz/modulRegistry.ts src/einsatz/modulRegistry.test.ts
git commit -m "feat: Modul-Registry als zentrale Nav-/Routing-Quelle" -m "Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Platzhalter-Komponente

**Files:**
- Create: `frontend/src/components/Platzhalter.tsx`
- Test: `frontend/src/components/Platzhalter.test.tsx`

Generische Platzhalter-Darstellung für noch nicht gebaute Bereiche (Workspace-Module wie globale Seiten).

- [ ] **Step 1: Failing test schreiben**

```tsx
// frontend/src/components/Platzhalter.test.tsx
import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { renderMitProviders } from '../test/utils';
import Platzhalter from './Platzhalter';

describe('Platzhalter', () => {
  it('zeigt Titel, Bauarbeiter-Marker und Beschreibung', () => {
    renderMitProviders(<Platzhalter titel="Stab" beschreibung="Kommt später." />);
    expect(screen.getByText('Stab')).toBeInTheDocument();
    expect(screen.getByText(/🚧/)).toBeInTheDocument();
    expect(screen.getByText('Kommt später.')).toBeInTheDocument();
  });

  it('funktioniert ohne Beschreibung', () => {
    renderMitProviders(<Platzhalter titel="Profil" />);
    expect(screen.getByText('Profil')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Test laufen lassen — muss fehlschlagen**

Run:
```bash
cd frontend && pnpm test src/components/Platzhalter.test.tsx
```
Erwartet: FAIL — `./Platzhalter` nicht auflösbar.

- [ ] **Step 3: Komponente implementieren**

```tsx
// frontend/src/components/Platzhalter.tsx
import { Empty, Typography } from 'antd';

interface Props {
  titel: string;
  beschreibung?: string;
}

/** Einheitlicher Platzhalter für noch nicht implementierte Bereiche. */
export default function Platzhalter({ titel, beschreibung }: Props) {
  return (
    <div style={{ textAlign: 'center', paddingTop: 64 }}>
      <Typography.Title level={3} style={{ marginBottom: 8 }}>
        🚧 {titel}
      </Typography.Title>
      {beschreibung && (
        <Typography.Paragraph type="secondary" style={{ maxWidth: 480, margin: '0 auto' }}>
          {beschreibung}
        </Typography.Paragraph>
      )}
      <Empty description="In Arbeit" image={Empty.PRESENTED_IMAGE_SIMPLE} />
    </div>
  );
}
```

- [ ] **Step 4: Test laufen lassen — muss bestehen**

Run:
```bash
cd frontend && pnpm test src/components/Platzhalter.test.tsx
```
Erwartet: PASS.

- [ ] **Step 5: Commit**

```bash
cd frontend && git add src/components/Platzhalter.tsx src/components/Platzhalter.test.tsx
git commit -m "feat: generische Platzhalter-Komponente" -m "Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: ModulStub

**Files:**
- Create: `frontend/src/einsatz/ModulStub.tsx`
- Test: `frontend/src/einsatz/ModulStub.test.tsx`

- [ ] **Step 1: Failing test schreiben**

```tsx
// frontend/src/einsatz/ModulStub.test.tsx
import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { renderMitProviders } from '../test/utils';
import ModulStub from './ModulStub';
import { modulRegistry } from './modulRegistry';

describe('ModulStub', () => {
  it('rendert Label und Beschreibung des Moduls mit WIP-Marker', () => {
    const stab = modulRegistry.find((m) => m.key === 'stab')!;
    renderMitProviders(<ModulStub modul={stab} />);
    expect(screen.getByText('Stab')).toBeInTheDocument();
    expect(screen.getByText(/🚧/)).toBeInTheDocument();
    expect(screen.getByText(stab.beschreibung!)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Test laufen lassen — muss fehlschlagen**

Run:
```bash
cd frontend && pnpm test src/einsatz/ModulStub.test.tsx
```
Erwartet: FAIL — `./ModulStub` nicht auflösbar.

- [ ] **Step 3: Komponente implementieren**

```tsx
// frontend/src/einsatz/ModulStub.tsx
import Platzhalter from '../components/Platzhalter';
import type { ModulEintrag } from './modulRegistry';

/** Stub-Seite für geplante/WIP-Module. Route existiert, Inhalt ist Platzhalter. */
export default function ModulStub({ modul }: { modul: ModulEintrag }) {
  return <Platzhalter titel={modul.label} beschreibung={modul.beschreibung} />;
}
```

- [ ] **Step 4: Test laufen lassen — muss bestehen**

Run:
```bash
cd frontend && pnpm test src/einsatz/ModulStub.test.tsx
```
Erwartet: PASS.

- [ ] **Step 5: Commit**

```bash
cd frontend && git add src/einsatz/ModulStub.tsx src/einsatz/ModulStub.test.tsx
git commit -m "feat: ModulStub fuer geplante/WIP-Module" -m "Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: EinsatzSwitcher

**Files:**
- Create: `frontend/src/einsatz/EinsatzSwitcher.tsx`
- Test: `frontend/src/einsatz/EinsatzSwitcher.test.tsx`

Dropdown im Header. Lädt Einsätze über `listeEinsaetze`, zeigt nur **aktive**, darunter Trenner, dann „Alle Einsätze …" und „Stammdaten". Auswahl navigiert.

- [ ] **Step 1: Failing test schreiben**

```tsx
// frontend/src/einsatz/EinsatzSwitcher.test.tsx
import { http, HttpResponse } from 'msw';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { Route, Routes } from 'react-router-dom';
import { server } from '../test/server';
import { renderMitProviders } from '../test/utils';
import EinsatzSwitcher from './EinsatzSwitcher';

function einsatz(over: Partial<Record<string, unknown>> = {}) {
  return {
    id: 7, bezeichnung: 'Hochwasser', stichwort: null, status: 'aktiv',
    begonnen_at: '2026-05-23 09:00:00', abgeschlossen_at: null,
    abgeschlossen_von: null, meine_rolle: 'einsatzleitung', ...over,
  };
}

function setup() {
  return renderMitProviders(
    <Routes>
      <Route path="/einsaetze/:id/*" element={<EinsatzSwitcher aktuellName="Hochwasser" />} />
      <Route path="/einsaetze" element={<div>Heim-Seite</div>} />
      <Route path="/stammdaten" element={<div>Stammdaten-Seite</div>} />
    </Routes>,
    { route: '/einsaetze/7/etb' },
  );
}

describe('EinsatzSwitcher', () => {
  it('zeigt nur aktive Einsaetze plus Aktionen', async () => {
    server.use(
      http.get('/api/einsaetze', () =>
        HttpResponse.json([
          einsatz({ id: 7, bezeichnung: 'Hochwasser' }),
          einsatz({ id: 8, bezeichnung: 'MANV B14' }),
          einsatz({ id: 9, bezeichnung: 'Alt-Einsatz', status: 'abgeschlossen' }),
        ]),
      ),
    );
    setup();
    await userEvent.click(screen.getByRole('button', { name: /Hochwasser/ }));
    await waitFor(() => expect(screen.getByText('MANV B14')).toBeInTheDocument());
    expect(screen.queryByText('Alt-Einsatz')).not.toBeInTheDocument();
    expect(screen.getByText('Alle Einsätze …')).toBeInTheDocument();
    expect(screen.getByText('Stammdaten')).toBeInTheDocument();
  });

  it('navigiert ueber „Alle Einsätze …" zur Heim-Seite', async () => {
    server.use(http.get('/api/einsaetze', () => HttpResponse.json([einsatz()])));
    setup();
    await userEvent.click(screen.getByRole('button', { name: /Hochwasser/ }));
    await userEvent.click(await screen.findByText('Alle Einsätze …'));
    await waitFor(() => expect(screen.getByText('Heim-Seite')).toBeInTheDocument());
  });
});
```

- [ ] **Step 2: Test laufen lassen — muss fehlschlagen**

Run:
```bash
cd frontend && pnpm test src/einsatz/EinsatzSwitcher.test.tsx
```
Erwartet: FAIL — `./EinsatzSwitcher` nicht auflösbar.

- [ ] **Step 3: Komponente implementieren**

```tsx
// frontend/src/einsatz/EinsatzSwitcher.tsx
import { Button, Dropdown, type MenuProps } from 'antd';
import { DownOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { listeEinsaetze } from '../api/einsaetze';

/** Switcher im Einsatz-Header: aktive Einsätze + Rückwege. */
export default function EinsatzSwitcher({ aktuellName }: { aktuellName: string }) {
  const navigate = useNavigate();
  const { data: einsaetze = [] } = useQuery({
    queryKey: ['einsaetze'],
    queryFn: listeEinsaetze,
  });

  const aktive = einsaetze.filter((e) => e.status === 'aktiv');

  const items: MenuProps['items'] = [
    ...aktive.map((e) => ({ key: `einsatz-${e.id}`, label: e.bezeichnung })),
    { type: 'divider' as const },
    { key: 'alle', label: 'Alle Einsätze …' },
    { key: 'stammdaten', label: 'Stammdaten' },
  ];

  const onClick: MenuProps['onClick'] = ({ key }) => {
    if (key === 'alle') navigate('/einsaetze');
    else if (key === 'stammdaten') navigate('/stammdaten');
    else if (key.startsWith('einsatz-')) navigate(`/einsaetze/${key.slice('einsatz-'.length)}`);
  };

  return (
    <Dropdown menu={{ items, onClick }} trigger={['click']}>
      <Button type="text" style={{ color: '#fff', fontWeight: 600, fontSize: 16 }}>
        {aktuellName} <DownOutlined />
      </Button>
    </Dropdown>
  );
}
```

- [ ] **Step 4: Test laufen lassen — muss bestehen**

Run:
```bash
cd frontend && pnpm test src/einsatz/EinsatzSwitcher.test.tsx
```
Erwartet: PASS (2 Tests grün).

- [ ] **Step 5: Commit**

```bash
cd frontend && git add src/einsatz/EinsatzSwitcher.tsx src/einsatz/EinsatzSwitcher.test.tsx
git commit -m "feat: EinsatzSwitcher mit aktiven Einsaetzen und Rueckwegen" -m "Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: IconRail

**Files:**
- Create: `frontend/src/einsatz/IconRail.tsx`
- Test: `frontend/src/einsatz/IconRail.test.tsx`

Präsentationale vertikale Rail. Props: Kategorien, aktive Kategorie, Klick-Handler. Aktive Kategorie via Farbe/Hintergrund + `aria-current`.

- [ ] **Step 1: Failing test schreiben**

```tsx
// frontend/src/einsatz/IconRail.test.tsx
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { renderMitProviders } from '../test/utils';
import IconRail from './IconRail';
import { kategorien } from './modulRegistry';

describe('IconRail', () => {
  it('rendert je Kategorie einen Button mit Label als aria-label', () => {
    renderMitProviders(
      <IconRail kategorien={kategorien} aktiveKategorie={null} onKategorieKlick={() => {}} />,
    );
    for (const k of kategorien) {
      expect(screen.getByRole('button', { name: k.label })).toBeInTheDocument();
    }
  });

  it('markiert die aktive Kategorie via aria-current', () => {
    renderMitProviders(
      <IconRail kategorien={kategorien} aktiveKategorie="lage" onKategorieKlick={() => {}} />,
    );
    expect(screen.getByRole('button', { name: 'Lage' })).toHaveAttribute('aria-current', 'true');
    expect(screen.getByRole('button', { name: 'Führung' })).not.toHaveAttribute('aria-current');
  });

  it('meldet Klick mit dem Kategorie-Key', async () => {
    const onKlick = vi.fn();
    renderMitProviders(
      <IconRail kategorien={kategorien} aktiveKategorie={null} onKategorieKlick={onKlick} />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Erfassung' }));
    expect(onKlick).toHaveBeenCalledWith('erfassung');
  });
});
```

- [ ] **Step 2: Test laufen lassen — muss fehlschlagen**

Run:
```bash
cd frontend && pnpm test src/einsatz/IconRail.test.tsx
```
Erwartet: FAIL — `./IconRail` nicht auflösbar.

- [ ] **Step 3: Komponente implementieren**

```tsx
// frontend/src/einsatz/IconRail.tsx
import { Tooltip } from 'antd';
import type { Kategorie, KategorieKey } from './modulRegistry';

interface Props {
  kategorien: Kategorie[];
  aktiveKategorie: KategorieKey | null;
  onKategorieKlick: (key: KategorieKey) => void;
}

/** Schmale vertikale Kategorie-Rail (Ebene 2). */
export default function IconRail({ kategorien, aktiveKategorie, onKategorieKlick }: Props) {
  return (
    <nav
      aria-label="Kategorien"
      style={{
        display: 'flex', flexDirection: 'column', gap: 4, padding: 8,
        background: '#001529', minHeight: '100%',
      }}
    >
      {kategorien.map((k) => {
        const aktiv = k.key === aktiveKategorie;
        const Icon = k.icon;
        return (
          <Tooltip key={k.key} title={k.label} placement="right">
            <button
              type="button"
              aria-label={k.label}
              aria-current={aktiv ? 'true' : undefined}
              onClick={() => onKategorieKlick(k.key)}
              style={{
                width: 48, height: 48, border: 'none', cursor: 'pointer',
                borderRadius: 6, display: 'grid', placeItems: 'center',
                background: aktiv ? '#a8071a' : 'transparent',
                color: aktiv ? '#fff' : 'rgba(255,255,255,0.65)',
              }}
            >
              <Icon size={24} />
            </button>
          </Tooltip>
        );
      })}
    </nav>
  );
}
```

- [ ] **Step 4: Test laufen lassen — muss bestehen**

Run:
```bash
cd frontend && pnpm test src/einsatz/IconRail.test.tsx
```
Erwartet: PASS (3 Tests grün).

- [ ] **Step 5: Commit**

```bash
cd frontend && git add src/einsatz/IconRail.tsx src/einsatz/IconRail.test.tsx
git commit -m "feat: IconRail fuer Kategorie-Navigation" -m "Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: ModulPanel

**Files:**
- Create: `frontend/src/einsatz/ModulPanel.tsx`
- Test: `frontend/src/einsatz/ModulPanel.test.tsx`

Präsentational. Listet injizierte Module einer Kategorie. Gesperrte Module (`istModulGesperrt`) erscheinen ausgegraut mit 🔒 (disabled statt versteckt). WIP-Module sind klickbar und tragen einen 🚧-Marker. Aktives Modul hervorgehoben.

- [ ] **Step 1: Failing test schreiben**

```tsx
// frontend/src/einsatz/ModulPanel.test.tsx
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { renderMitProviders } from '../test/utils';
import ModulPanel from './ModulPanel';
import type { ModulEintrag } from './modulRegistry';
import type { BenutzerAnzeige } from '../api/types';

const ohne: BenutzerAnzeige = {
  id: 1, anzeigename: 'E', benutzername: 'e', system_rolle: 'keiner',
  org_rolle: 'keine', aktiv: true, erstellt_at: '2026-05-23 10:00:00',
};

const basis = (over: Partial<ModulEintrag>): ModulEintrag => ({
  key: 'k', kategorie: 'erfassung', label: 'L', icon: () => null, route: 'k', status: 'geplant', ...over,
});

const module: ModulEintrag[] = [
  basis({ key: 'etb', label: 'ETB', route: 'etb', status: 'fertig' }),
  basis({ key: 'sach', label: 'Sachschäden', route: 'sach', status: 'wip' }),
  basis({ key: 'geheim', label: 'Geheim', route: 'geheim', benoetigteRolle: 'admin' }),
];

describe('ModulPanel', () => {
  it('listet Module, markiert WIP, sperrt rollengeschuetzte', () => {
    renderMitProviders(
      <ModulPanel
        titel="Erfassung" module={module} benutzer={ohne}
        aktiverModulKey="etb" onModulKlick={() => {}}
      />,
    );
    expect(screen.getByText('Erfassung')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /ETB/ })).toBeEnabled();
    expect(screen.getByRole('button', { name: /Sachschäden/ })).toBeEnabled();
    expect(screen.getByText(/🚧/)).toBeInTheDocument();
    const geheim = screen.getByRole('button', { name: /Geheim/ });
    expect(geheim).toBeDisabled();
    expect(screen.getByText(/🔒/)).toBeInTheDocument();
  });

  it('meldet Klick auf ein freies Modul', async () => {
    const onKlick = vi.fn();
    renderMitProviders(
      <ModulPanel
        titel="Erfassung" module={module} benutzer={ohne}
        aktiverModulKey={null} onModulKlick={onKlick}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: /ETB/ }));
    expect(onKlick).toHaveBeenCalledWith(expect.objectContaining({ key: 'etb' }));
  });
});
```

- [ ] **Step 2: Test laufen lassen — muss fehlschlagen**

Run:
```bash
cd frontend && pnpm test src/einsatz/ModulPanel.test.tsx
```
Erwartet: FAIL — `./ModulPanel` nicht auflösbar.

- [ ] **Step 3: Komponente implementieren**

```tsx
// frontend/src/einsatz/ModulPanel.tsx
import { Typography } from 'antd';
import { istModulGesperrt, type ModulEintrag } from './modulRegistry';
import type { BenutzerAnzeige } from '../api/types';

interface Props {
  titel: string;
  module: ModulEintrag[];
  benutzer: BenutzerAnzeige | null;
  aktiverModulKey: string | null;
  onModulKlick: (modul: ModulEintrag) => void;
}

/** Liste der Module einer Kategorie (Ebene 2). */
export default function ModulPanel({ titel, module, benutzer, aktiverModulKey, onModulKlick }: Props) {
  return (
    <div style={{ width: 220, padding: 12, borderRight: '1px solid #f0f0f0' }}>
      <Typography.Text type="secondary" style={{ fontSize: 12, textTransform: 'uppercase' }}>
        {titel}
      </Typography.Text>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2, marginTop: 8 }}>
        {module.map((m) => {
          const gesperrt = istModulGesperrt(m, benutzer);
          const aktiv = m.key === aktiverModulKey;
          const Icon = m.icon;
          return (
            <button
              key={m.key}
              type="button"
              disabled={gesperrt}
              title={gesperrt ? 'Keine Berechtigung' : undefined}
              onClick={() => !gesperrt && onModulKlick(m)}
              style={{
                display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px',
                border: 'none', borderRadius: 6, textAlign: 'left', width: '100%',
                cursor: gesperrt ? 'not-allowed' : 'pointer',
                background: aktiv ? '#fff1f0' : 'transparent',
                color: gesperrt ? 'rgba(0,0,0,0.25)' : aktiv ? '#a8071a' : 'inherit',
              }}
            >
              <Icon size={18} />
              <span>{m.label}</span>
              {m.status === 'wip' && <span title="In Arbeit">🚧</span>}
              {gesperrt && <span style={{ marginLeft: 'auto' }}>🔒</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Test laufen lassen — muss bestehen**

Run:
```bash
cd frontend && pnpm test src/einsatz/ModulPanel.test.tsx
```
Erwartet: PASS (2 Tests grün).

- [ ] **Step 5: Commit**

```bash
cd frontend && git add src/einsatz/ModulPanel.tsx src/einsatz/ModulPanel.test.tsx
git commit -m "feat: ModulPanel mit disabled-statt-versteckt-Logik" -m "Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 8: EinsatzLayout

**Files:**
- Create: `frontend/src/einsatz/EinsatzLayout.tsx`
- Test: `frontend/src/einsatz/EinsatzLayout.test.tsx`

Ebene-2-Shell: Header mit `EinsatzSwitcher`, links `IconRail`, daneben `ModulPanel` der offenen Kategorie, rechts `<Outlet/>`. Die offene Kategorie initialisiert sich aus dem aktuellen Modul (abgeleitet aus dem letzten Pfad-Segment).

- [ ] **Step 1: Failing test schreiben**

```tsx
// frontend/src/einsatz/EinsatzLayout.test.tsx
import { http, HttpResponse } from 'msw';
import { screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Route, Routes } from 'react-router-dom';
import { server } from '../test/server';
import { renderMitProviders } from '../test/utils';
import { AuthProvider } from '../auth/AuthContext';
import EinsatzLayout from './EinsatzLayout';

const admin = {
  id: 1, anzeigename: 'Chef', benutzername: 'chef', system_rolle: 'admin',
  org_rolle: 'keine', aktiv: true, erstellt_at: '2026-05-23 10:00:00',
};
const einsatz = {
  id: 7, bezeichnung: 'Hochwasser Nord', stichwort: null, status: 'aktiv',
  begonnen_at: '2026-05-23 09:00:00', abgeschlossen_at: null,
  abgeschlossen_von: null, meine_rolle: 'einsatzleitung',
};

function setup() {
  server.use(
    http.get('/api/auth/me', () => HttpResponse.json(admin)),
    http.get('/api/einsaetze', () => HttpResponse.json([einsatz])),
    http.get('/api/einsaetze/7', () => HttpResponse.json(einsatz)),
  );
  return renderMitProviders(
    <AuthProvider>
      <Routes>
        <Route path="/einsaetze/:id" element={<EinsatzLayout />}>
          <Route path="etb" element={<div>ETB-Inhalt</div>} />
        </Route>
      </Routes>
    </AuthProvider>,
    { route: '/einsaetze/7/etb' },
  );
}

describe('EinsatzLayout', () => {
  it('zeigt Switcher mit Einsatznamen, Kategorie-Rail und Outlet-Inhalt', async () => {
    setup();
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /Hochwasser Nord/ })).toBeInTheDocument(),
    );
    expect(screen.getByRole('navigation', { name: 'Kategorien' })).toBeInTheDocument();
    expect(screen.getByText('ETB-Inhalt')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Test laufen lassen — muss fehlschlagen**

Run:
```bash
cd frontend && pnpm test src/einsatz/EinsatzLayout.test.tsx
```
Erwartet: FAIL — `./EinsatzLayout` nicht auflösbar.

- [ ] **Step 3: Komponente implementieren**

```tsx
// frontend/src/einsatz/EinsatzLayout.tsx
import { useState } from 'react';
import { Layout, Spin } from 'antd';
import { Outlet, useLocation, useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ladeEinsatz } from '../api/einsaetze';
import { useAuth } from '../auth/AuthContext';
import {
  kategorien, modulRegistry, moduleNachKategorie,
  type KategorieKey, type ModulEintrag,
} from './modulRegistry';
import EinsatzSwitcher from './EinsatzSwitcher';
import IconRail from './IconRail';
import ModulPanel from './ModulPanel';

const { Header, Content } = Layout;

/** Ebene 2: Einsatz-Workspace mit Switcher-Header, Icon-Rail und Modul-Panel. */
export default function EinsatzLayout() {
  const { id } = useParams();
  const einsatzId = Number(id);
  const { benutzer } = useAuth();
  const navigate = useNavigate();
  const { pathname } = useLocation();

  const aktuellesSegment = pathname.split('/').filter(Boolean).pop();
  const aktuellesModul = modulRegistry.find((m) => m.route === aktuellesSegment);
  const aktiveKategorie: KategorieKey | null = aktuellesModul?.kategorie ?? null;

  const [offeneKategorie, setOffeneKategorie] = useState<KategorieKey | null>(aktiveKategorie);

  const { data: einsatz, isLoading } = useQuery({
    queryKey: ['einsatz', einsatzId],
    queryFn: () => ladeEinsatz(einsatzId),
  });

  function onKategorieKlick(key: KategorieKey) {
    setOffeneKategorie((aktuell) => (aktuell === key ? null : key));
  }

  function onModulKlick(modul: ModulEintrag) {
    navigate(`/einsaetze/${einsatzId}/${modul.route}`);
  }

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Header style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
        {isLoading ? (
          <Spin />
        ) : (
          <EinsatzSwitcher aktuellName={einsatz?.bezeichnung ?? 'Einsatz'} />
        )}
      </Header>
      <Layout>
        <IconRail
          kategorien={kategorien}
          aktiveKategorie={offeneKategorie ?? aktiveKategorie}
          onKategorieKlick={onKategorieKlick}
        />
        {offeneKategorie && (
          <ModulPanel
            titel={kategorien.find((k) => k.key === offeneKategorie)!.label}
            module={moduleNachKategorie(offeneKategorie)}
            benutzer={benutzer}
            aktiverModulKey={aktuellesModul?.key ?? null}
            onModulKlick={onModulKlick}
          />
        )}
        <Content style={{ padding: 24 }}>
          <Outlet />
        </Content>
      </Layout>
    </Layout>
  );
}
```

- [ ] **Step 4: Test laufen lassen — muss bestehen**

Run:
```bash
cd frontend && pnpm test src/einsatz/EinsatzLayout.test.tsx
```
Erwartet: PASS.

- [ ] **Step 5: Commit**

```bash
cd frontend && git add src/einsatz/EinsatzLayout.tsx src/einsatz/EinsatzLayout.test.tsx
git commit -m "feat: EinsatzLayout als Ebene-2-Workspace-Shell" -m "Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 9: DefaultModulRedirect

**Files:**
- Create: `frontend/src/einsatz/DefaultModulRedirect.tsx`
- Test: `frontend/src/einsatz/DefaultModulRedirect.test.tsx`

Index-Route von `/einsaetze/:id`. Leitet relativ auf das Default-Modul um (`redirectZiel`).

- [ ] **Step 1: Failing test schreiben**

```tsx
// frontend/src/einsatz/DefaultModulRedirect.test.tsx
import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Route, Routes } from 'react-router-dom';
import { renderMitProviders } from '../test/utils';
import DefaultModulRedirect from './DefaultModulRedirect';

describe('DefaultModulRedirect', () => {
  it('leitet ohne Modul auf das ETB-Fallback um', () => {
    renderMitProviders(
      <Routes>
        <Route path="/einsaetze/:id" element={<DefaultModulRedirect />} />
        <Route path="/einsaetze/:id/etb" element={<div>ETB-Inhalt</div>} />
      </Routes>,
      { route: '/einsaetze/7' },
    );
    expect(screen.getByText('ETB-Inhalt')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Test laufen lassen — muss fehlschlagen**

Run:
```bash
cd frontend && pnpm test src/einsatz/DefaultModulRedirect.test.tsx
```
Erwartet: FAIL — `./DefaultModulRedirect` nicht auflösbar.

- [ ] **Step 3: Komponente implementieren**

```tsx
// frontend/src/einsatz/DefaultModulRedirect.tsx
import { Navigate } from 'react-router-dom';
import { redirectZiel } from './modulRegistry';

/** Index-Route /einsaetze/:id → relatives Default-Modul (Dashboard sobald fertig, sonst ETB). */
export default function DefaultModulRedirect() {
  return <Navigate to={redirectZiel()} replace />;
}
```

- [ ] **Step 4: Test laufen lassen — muss bestehen**

Run:
```bash
cd frontend && pnpm test src/einsatz/DefaultModulRedirect.test.tsx
```
Erwartet: PASS.

- [ ] **Step 5: Commit**

```bash
cd frontend && git add src/einsatz/DefaultModulRedirect.tsx src/einsatz/DefaultModulRedirect.test.tsx
git commit -m "feat: Default-Modul-Redirect fuer /einsaetze/:id" -m "Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 10: Globale Platzhalter-Seiten (Stammdaten, Profil)

**Files:**
- Create: `frontend/src/pages/StammdatenPage.tsx`
- Create: `frontend/src/pages/ProfilPage.tsx`
- Test: `frontend/src/pages/StammdatenPage.test.tsx`

- [ ] **Step 1: Failing test schreiben**

```tsx
// frontend/src/pages/StammdatenPage.test.tsx
import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { renderMitProviders } from '../test/utils';
import StammdatenPage from './StammdatenPage';
import ProfilPage from './ProfilPage';

describe('Globale Platzhalter-Seiten', () => {
  it('Stammdaten zeigt Titel und Platzhalter', () => {
    renderMitProviders(<StammdatenPage />);
    expect(screen.getByText('Stammdaten')).toBeInTheDocument();
  });

  it('Profil zeigt Titel und Platzhalter', () => {
    renderMitProviders(<ProfilPage />);
    expect(screen.getByText('Profil')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Test laufen lassen — muss fehlschlagen**

Run:
```bash
cd frontend && pnpm test src/pages/StammdatenPage.test.tsx
```
Erwartet: FAIL — `./StammdatenPage` nicht auflösbar.

- [ ] **Step 3: Seiten implementieren**

```tsx
// frontend/src/pages/StammdatenPage.tsx
import Platzhalter from '../components/Platzhalter';

export default function StammdatenPage() {
  return (
    <Platzhalter
      titel="Stammdaten"
      beschreibung="Organisationsweiter Stamm an Personal, Fahrzeugen und Einheiten — Quelle für die Disposition in den Einsatz."
    />
  );
}
```

```tsx
// frontend/src/pages/ProfilPage.tsx
import Platzhalter from '../components/Platzhalter';

export default function ProfilPage() {
  return (
    <Platzhalter
      titel="Profil"
      beschreibung="Eigener Account und app-weite Einstellungen."
    />
  );
}
```

- [ ] **Step 4: Test laufen lassen — muss bestehen**

Run:
```bash
cd frontend && pnpm test src/pages/StammdatenPage.test.tsx
```
Erwartet: PASS (2 Tests grün).

- [ ] **Step 5: Commit**

```bash
cd frontend && git add src/pages/StammdatenPage.tsx src/pages/ProfilPage.tsx src/pages/StammdatenPage.test.tsx
git commit -m "feat: globale Platzhalter-Seiten Stammdaten und Profil" -m "Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 11: AppLayout → globale Topbar (Umbau)

**Files:**
- Modify: `frontend/src/components/AppLayout.tsx`
- Modify: `frontend/src/components/AppLayout.test.tsx`

Topbar (Ebene 1): `lifeline-hub` · **Stammdaten** · **Benutzer** · (rechts) **Profil** + Name + Abmelden. Grundsatz **disabled statt versteckt**: Stammdaten (frei für admin|fuehrungskraft), Benutzer (frei für admin) erscheinen für Unberechtigte ausgegraut mit 🔒, statt zu verschwinden. Der frühere zweite „Einsätze"-Reiter entfällt.

- [ ] **Step 1: Test umschreiben (neue Topbar-Erwartungen)**

Ersetze den kompletten Inhalt von `frontend/src/components/AppLayout.test.tsx` durch:

```tsx
import { http, HttpResponse } from 'msw';
import { screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Route, Routes } from 'react-router-dom';
import { server } from '../test/server';
import { renderMitProviders } from '../test/utils';
import { AuthProvider } from '../auth/AuthContext';
import AppLayout from './AppLayout';

const admin = {
  id: 1, anzeigename: 'Chef', benutzername: 'chef', system_rolle: 'admin',
  org_rolle: 'keine', aktiv: true, erstellt_at: '2026-05-23 10:00:00',
};

function setup(me: Record<string, unknown>) {
  server.use(http.get('/api/auth/me', () => HttpResponse.json(me)));
  return renderMitProviders(
    <AuthProvider>
      <Routes>
        <Route element={<AppLayout />}>
          <Route path="/" element={<div>Inhalt</div>} />
        </Route>
      </Routes>
    </AuthProvider>,
  );
}

describe('AppLayout (globale Topbar)', () => {
  it('Admin: Stammdaten und Benutzer sind Links, Profil sichtbar', async () => {
    setup(admin);
    await waitFor(() => expect(screen.getByText('Chef')).toBeInTheDocument());
    expect(screen.getByRole('link', { name: 'Stammdaten' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Benutzer' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Profil' })).toBeInTheDocument();
    expect(screen.getByText('Inhalt')).toBeInTheDocument();
  });

  it('Fuehrungskraft: Stammdaten frei, Benutzer gesperrt (🔒, kein Link)', async () => {
    setup({ ...admin, system_rolle: 'keiner', org_rolle: 'fuehrungskraft', anzeigename: 'Eva' });
    await waitFor(() => expect(screen.getByText('Eva')).toBeInTheDocument());
    expect(screen.getByRole('link', { name: 'Stammdaten' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Benutzer' })).not.toBeInTheDocument();
    expect(screen.getByText('Benutzer 🔒')).toBeInTheDocument();
  });

  it('Sonstige: Stammdaten und Benutzer gesperrt, kein Admin-Tag', async () => {
    setup({ ...admin, system_rolle: 'keiner', org_rolle: 'keine', anzeigename: 'Max' });
    await waitFor(() => expect(screen.getByText('Max')).toBeInTheDocument());
    expect(screen.queryByRole('link', { name: 'Stammdaten' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Benutzer' })).not.toBeInTheDocument();
    expect(screen.getByText('Stammdaten 🔒')).toBeInTheDocument();
    expect(screen.getByText('Benutzer 🔒')).toBeInTheDocument();
    expect(screen.queryByText('Admin')).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Test laufen lassen — muss fehlschlagen**

Run:
```bash
cd frontend && pnpm test src/components/AppLayout.test.tsx
```
Erwartet: FAIL — z. B. „Stammdaten" nicht gefunden / `🔒`-Text fehlt.

- [ ] **Step 3: AppLayout umbauen**

Ersetze den kompletten Inhalt von `frontend/src/components/AppLayout.tsx` durch:

```tsx
import { Button, Layout, Space, Tag, Typography } from 'antd';
import { Link, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import type { BenutzerAnzeige } from '../api/types';

const { Header, Content } = Layout;

/** Topbar-Eintrag: Link wenn frei, sonst ausgegraut mit 🔒 (disabled statt versteckt). */
function GlobalLink({ to, label, gesperrt }: { to: string; label: string; gesperrt: boolean }) {
  if (gesperrt) {
    return (
      <Typography.Text
        title="Keine Berechtigung"
        style={{ color: 'rgba(255,255,255,0.35)', cursor: 'not-allowed' }}
      >
        {label} 🔒
      </Typography.Text>
    );
  }
  return (
    <Link to={to} style={{ color: '#fff' }}>
      {label}
    </Link>
  );
}

function darfStammdaten(b: BenutzerAnzeige | null): boolean {
  return b?.system_rolle === 'admin' || b?.org_rolle === 'fuehrungskraft';
}

export default function AppLayout() {
  const { benutzer, logout } = useAuth();
  const navigate = useNavigate();

  async function abmelden() {
    await logout();
    navigate('/login', { replace: true });
  }

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Header style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
        <Link to="/einsaetze" style={{ color: '#fff', fontWeight: 600, fontSize: 18 }}>
          lifeline-hub
        </Link>
        <GlobalLink to="/stammdaten" label="Stammdaten" gesperrt={!darfStammdaten(benutzer)} />
        <GlobalLink to="/benutzer" label="Benutzer" gesperrt={benutzer?.system_rolle !== 'admin'} />
        <Space style={{ marginLeft: 'auto' }}>
          <GlobalLink to="/profil" label="Profil" gesperrt={false} />
          <Typography.Text style={{ color: '#fff' }}>{benutzer?.anzeigename}</Typography.Text>
          {benutzer?.system_rolle === 'admin' && <Tag color="gold">Admin</Tag>}
          <Button size="small" onClick={abmelden}>
            Abmelden
          </Button>
        </Space>
      </Header>
      <Content style={{ padding: 24 }}>
        <Outlet />
      </Content>
    </Layout>
  );
}
```

- [ ] **Step 4: Test laufen lassen — muss bestehen**

Run:
```bash
cd frontend && pnpm test src/components/AppLayout.test.tsx
```
Erwartet: PASS (3 Tests grün).

- [ ] **Step 5: Commit**

```bash
cd frontend && git add src/components/AppLayout.tsx src/components/AppLayout.test.tsx
git commit -m "feat: AppLayout als globale Topbar (Stammdaten/Benutzer/Profil)" -m "Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 12: EinsaetzePage → Kachel-Grid (Umbau)

**Files:**
- Modify: `frontend/src/pages/EinsaetzePage.tsx`
- Modify: `frontend/src/pages/EinsaetzePage.test.tsx`

Die Liste wird zu einem Kachel-Grid (antd `Card`). Klick auf eine Kachel öffnet den Workspace via `navigate('/einsaetze/:id')` (Entscheidung 1). Erhalten bleiben — die bestehenden Tests hängen daran — diese Strings/Elemente: Überschrift „Einsätze", Button „Einsatz anlegen", Modal mit Feld-Label „Bezeichnung" und OK-Button „Anlegen", sowie pro Einsatz die `bezeichnung`, der Status-Text und der `meine_rolle`-Text.

- [ ] **Step 1: Navigations-Test ergänzen**

Füge in `frontend/src/pages/EinsaetzePage.test.tsx` diese imports hinzu (oben, neben den bestehenden):

```tsx
import { Route, Routes } from 'react-router-dom';
```

Und ergänze innerhalb von `describe('EinsaetzePage', () => { ... })` diesen Test:

```tsx
  it('oeffnet beim Klick auf eine Kachel den Workspace unter /einsaetze/:id', async () => {
    server.use(
      http.get('/api/auth/me', () => HttpResponse.json(admin)),
      http.get('/api/einsaetze', () => HttpResponse.json([einsatz()])),
    );
    renderMitProviders(
      <AuthProvider>
        <Routes>
          <Route path="/" element={<EinsaetzePage />} />
          <Route path="/einsaetze/:id" element={<div>Workspace-7</div>} />
        </Routes>
      </AuthProvider>,
    );
    await userEvent.click(await screen.findByText('Hochwasser Nord'));
    await waitFor(() => expect(screen.getByText('Workspace-7')).toBeInTheDocument());
  });
```

- [ ] **Step 2: Test laufen lassen — neuer Test muss fehlschlagen, Rest grün**

Run:
```bash
cd frontend && pnpm test src/pages/EinsaetzePage.test.tsx
```
Erwartet: Der neue Test schlägt fehl (Klick auf die Liste navigiert noch nicht nach `/einsaetze/7`), die anderen bleiben grün.

- [ ] **Step 3: EinsaetzePage auf Kachel-Grid umbauen**

Ersetze den `return (...)`-Block (ab `return (` bis zum schließenden `);` der Komponente) in `frontend/src/pages/EinsaetzePage.tsx`. Der `List`-Block wird durch ein Card-Grid ersetzt; der `import` von `List` entfällt, `Card` und `Empty` kommen hinzu. Setze die Importzeile 1 auf:

```tsx
import { App, Button, Card, Empty, Form, Input, Modal, Space, Tag, Typography } from 'antd';
```

Und ersetze den JSX-Body durch:

```tsx
  return (
    <div style={{ maxWidth: 960, margin: '0 auto' }}>
      <Space style={{ width: '100%', justifyContent: 'space-between', marginBottom: 16 }}>
        <Typography.Title level={3} style={{ margin: 0 }}>
          Einsätze
        </Typography.Title>
        {darfAnlegen && (
          <Button type="primary" onClick={() => setDialogOffen(true)}>
            Einsatz anlegen
          </Button>
        )}
      </Space>

      {einsaetze.length === 0 && !isLoading ? (
        <Empty description="Keine Einsätze" />
      ) : (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
            gap: 16,
          }}
        >
          {einsaetze.map((e: EinsatzAnzeige) => (
            <Card
              key={e.id}
              hoverable
              loading={isLoading}
              title={e.bezeichnung}
              onClick={() => navigate(`/einsaetze/${e.id}`)}
            >
              <Space direction="vertical">
                <Space>
                  <Tag color={STATUS_FARBE[e.status]}>{e.status}</Tag>
                  {e.meine_rolle && <Tag>{e.meine_rolle}</Tag>}
                </Space>
                {e.stichwort && <Typography.Text type="secondary">{e.stichwort}</Typography.Text>}
              </Space>
            </Card>
          ))}
        </div>
      )}

      <Modal
        title="Neuen Einsatz anlegen"
        open={dialogOffen}
        onCancel={() => {
          setDialogOffen(false);
          form.resetFields();
        }}
        onOk={() => form.submit()}
        okText="Anlegen"
        confirmLoading={anlegen.isPending}
      >
        <Form form={form} layout="vertical" onFinish={(w) => anlegen.mutate(w)}>
          <Form.Item
            label="Bezeichnung"
            name="bezeichnung"
            rules={[{ required: true, message: 'Bitte Bezeichnung eingeben' }]}
          >
            <Input autoFocus />
          </Form.Item>
          <Form.Item label="Stichwort" name="stichwort">
            <Input placeholder="optional, z.B. THW / RD" />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
```

- [ ] **Step 4: Test laufen lassen — alle grün**

Run:
```bash
cd frontend && pnpm test src/pages/EinsaetzePage.test.tsx
```
Erwartet: PASS (4 Tests grün, inkl. neuem Navigations-Test).

- [ ] **Step 5: Commit**

```bash
cd frontend && git add src/pages/EinsaetzePage.tsx src/pages/EinsaetzePage.test.tsx
git commit -m "feat: Einsaetze-Heimseite als Kachel-Grid mit Workspace-Navigation" -m "Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 13: Routing verdrahten (App.tsx)

**Files:**
- Modify: `frontend/src/App.tsx`
- Modify: `frontend/src/App.test.tsx`

Drei-Ebenen-Routing. Globale Seiten unter `AppLayout`. Workspace unter `EinsatzLayout` mit Index-Redirect und **registry-abgeleiteten Modul-Routen** (ETB → echte `EtbPage`, alle anderen → `ModulStub`).

- [ ] **Step 1: App-Routing-Tests ergänzen**

Ersetze den kompletten Inhalt von `frontend/src/App.test.tsx` durch:

```tsx
import { screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { renderMitProviders } from './test/utils';
import { AuthProvider } from './auth/AuthContext';
import App from './App';
import { http, HttpResponse } from 'msw';
import { server } from './test/server';

const admin = {
  id: 1, anzeigename: 'Admin', benutzername: 'admin', system_rolle: 'admin',
  org_rolle: 'keine', aktiv: true, erstellt_at: '2026-05-23 10:00:00',
};
const einsatz = {
  id: 7, bezeichnung: 'Hochwasser Nord', stichwort: null, status: 'aktiv',
  begonnen_at: '2026-05-23 09:00:00', abgeschlossen_at: null,
  abgeschlossen_von: null, meine_rolle: 'einsatzleitung',
};

function renderApp(route: string) {
  return renderMitProviders(
    <AuthProvider>
      <App />
    </AuthProvider>,
    { route },
  );
}

describe('App-Routing', () => {
  it('leitet ohne Anmeldung zu /login um', async () => {
    server.use(http.get('/api/auth/me', () => HttpResponse.json({ error: 'x' }, { status: 401 })));
    server.use(http.get('/api/dev/users', () => HttpResponse.json([])));
    renderApp('/');
    expect(await screen.findByRole('button', { name: 'Anmelden' })).toBeInTheDocument();
  });

  it('Default-Route /einsaetze/:id landet (Fallback) im ETB', async () => {
    server.use(
      http.get('/api/auth/me', () => HttpResponse.json(admin)),
      http.get('/api/einsaetze', () => HttpResponse.json([einsatz])),
      http.get('/api/einsaetze/7', () => HttpResponse.json(einsatz)),
      http.get('/api/einsaetze/7/etb', () => HttpResponse.json([])),
    );
    renderApp('/einsaetze/7');
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: 'Hochwasser Nord' })).toBeInTheDocument(),
    );
  });

  it('WIP-Modul-Route rendert den Stub', async () => {
    server.use(
      http.get('/api/auth/me', () => HttpResponse.json(admin)),
      http.get('/api/einsaetze', () => HttpResponse.json([einsatz])),
      http.get('/api/einsaetze/7', () => HttpResponse.json(einsatz)),
    );
    renderApp('/einsaetze/7/stab');
    await waitFor(() => expect(screen.getByText('Stab')).toBeInTheDocument());
    expect(screen.getByText(/🚧/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Test laufen lassen — muss fehlschlagen**

Run:
```bash
cd frontend && pnpm test src/App.test.tsx
```
Erwartet: FAIL — `/einsaetze/7` und `/einsaetze/7/stab` rendern noch nicht den Workspace.

- [ ] **Step 3: App.tsx auf Drei-Ebenen-Routing umbauen**

Ersetze den kompletten Inhalt von `frontend/src/App.tsx` durch:

```tsx
import { Navigate, Route, Routes } from 'react-router-dom';
import type { ReactElement } from 'react';
import RequireAuth from './routes/RequireAuth';
import AppLayout from './components/AppLayout';
import LoginPage from './pages/LoginPage';
import EinsaetzePage from './pages/EinsaetzePage';
import BenutzerPage from './pages/BenutzerPage';
import StammdatenPage from './pages/StammdatenPage';
import ProfilPage from './pages/ProfilPage';
import EtbPage from './pages/EtbPage';
import EinsatzLayout from './einsatz/EinsatzLayout';
import DefaultModulRedirect from './einsatz/DefaultModulRedirect';
import ModulStub from './einsatz/ModulStub';
import { modulRegistry } from './einsatz/modulRegistry';

/** Module mit echter Implementierung; alle übrigen rendern den ModulStub. */
const MODUL_ELEMENTE: Record<string, ReactElement> = {
  etb: <EtbPage />,
};

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route element={<RequireAuth />}>
        {/* Ebene 1 — globale Shell */}
        <Route element={<AppLayout />}>
          <Route path="/einsaetze" element={<EinsaetzePage />} />
          <Route path="/benutzer" element={<BenutzerPage />} />
          <Route path="/stammdaten" element={<StammdatenPage />} />
          <Route path="/profil" element={<ProfilPage />} />
        </Route>
        {/* Ebene 2 — Einsatz-Workspace */}
        <Route path="/einsaetze/:id" element={<EinsatzLayout />}>
          <Route index element={<DefaultModulRedirect />} />
          {modulRegistry.map((m) => (
            <Route
              key={m.key}
              path={m.route}
              element={MODUL_ELEMENTE[m.key] ?? <ModulStub modul={m} />}
            />
          ))}
        </Route>
      </Route>
      <Route path="*" element={<Navigate to="/einsaetze" replace />} />
    </Routes>
  );
}
```

- [ ] **Step 4: Test laufen lassen — muss bestehen**

Run:
```bash
cd frontend && pnpm test src/App.test.tsx
```
Erwartet: PASS (3 Tests grün).

- [ ] **Step 5: Commit**

```bash
cd frontend && git add src/App.tsx src/App.test.tsx
git commit -m "feat: Drei-Ebenen-Routing mit registry-abgeleiteten Modul-Routen" -m "Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 14: Gesamtlauf & Abschluss

**Files:** keine neuen — Verifikation des Gesamtstands.

- [ ] **Step 1: Vollständige Test-Suite**

Run:
```bash
cd frontend && pnpm test
```
Erwartet: alle Tests grün — insbesondere die unveränderten ETB-/Einsatz-Tests (`EtbPage.test.tsx`, `EtbPage.abschliessen.test.tsx`, `EinsaetzePage.test.tsx`, `useEtbStream`, `MitgliederPanel`, …) sowie alle neuen.

- [ ] **Step 2: Typecheck & Lint**

Run:
```bash
cd frontend && pnpm typecheck && pnpm lint
```
Erwartet: keine Fehler.

- [ ] **Step 3: Build (verifiziert Tabler-Imports & Bundling)**

Run:
```bash
cd frontend && pnpm build
```
Erwartet: erfolgreicher Build ohne unaufgelöste Imports.

- [ ] **Step 4: Manuelle Sichtprüfung (optional, empfohlen)**

Run:
```bash
cd frontend && pnpm dev
```
Prüfen: Heim-Kacheln → Klick öffnet Workspace; Icon-Rail öffnet Modul-Panel; ETB lädt unter `/einsaetze/:id/etb`; WIP-Module (Stab, Sachschäden) zeigen 🚧; Switcher listet nur aktive Einsätze; Topbar zeigt gesperrte Einträge mit 🔒.

---

## Bekannte Folge-Punkte (kein Scope dieses Plans)

- **Header-Duplikat im ETB:** `EtbPage` behält Breadcrumb + Überschrift, die mit dem Switcher-Header doppeln. Deduplizieren in einer Folge-Spec (würde sonst `EtbPage.test.tsx` brechen).
- Innere Modul-Implementierungen, Datenmodelle (Personen-Lebenszyklus, taktische Einheiten, Disposition), feinkörnige Schreibrechte — je eigene Spec.
