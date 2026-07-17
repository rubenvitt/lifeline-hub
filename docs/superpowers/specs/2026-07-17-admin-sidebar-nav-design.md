# Admin-Sidebar-Navigation — Design (LFH-284)

**Goal:** Die verschachtelten Navigationsleisten im Admin-/Settings-Bereich durch **eine**
kohärente Nav-Ebene ersetzen — eine linke Sidebar (gruppiertes `Menu`), aus der jede Sektion
über eine eigene Route adressierbar (deep-linkbar) ist. Reiner Frontend-Task, kein
Backend-Change. Baut auf den geteilten Komponenten aus LFH-281 (`AdminPage`, `SektionHeader`)
auf; löst die zweite Nav-Ebene (`AdminLayout`-Top-Tabs + `SegmentSektionen`/Stammdaten-Tabs) ab.

## Ist-Zustand / Problem

Zwei Nav-Ebenen übereinander:

1. **Oben:** `AdminLayout` (`src/admin/AdminLayout.tsx`) rendert `<Tabs>`
   (Stammdaten / Einstellungen / Karten) + `<Outlet>`.
2. **In der Seite:** nochmal eine Umschalt-Leiste — Stammdaten **11 `antd`-Tabs**,
   Einstellungen 3 `SegmentSektionen`-Pillen, Karten 2.

Zusätzlich: `/benutzer` und `/profil` liegen **außerhalb** des `AdminLayout` (eigene
Top-Level-Routen unter `AppLayout`, je ein eigener Topbar-Link). Die Sektionen sind heute reiner
Client-State (uncontrolled Tabs/Segmented) — **nicht** per URL adressierbar; das
Akzeptanzkriterium „Deep-Link-fähig" ist neu zu erfüllen.

## Zielbild

Innerhalb von `/admin` eine linke **Sidebar** (`antd Layout.Sider` + inline `Menu` mit
Gruppen-Überschriften) als einzige Nav-Ebene. Die globale Topbar (`AppLayout`) bleibt; ihr
**„Benutzer"-Link entfällt** (Benutzer wandert in die Sidebar), „Verwaltung" bleibt. Jede
Sektion ist eine eigene Route → deep-linkbar, Browser-Back/Refresh-fest. `AdminPage` /
`SektionHeader` bleiben tragende Content-Rahmen.

```
┌────────────────────────────────────────────┐
│ lifeline-hub   Verwaltung            ⚙  👤 │  globale Topbar (AppLayout) — bleibt
├───────────────┬────────────────────────────┤
│ STAMMDATEN    │  Fahrzeuge                  │  AdminLayout = Layout.Sider + Menu
│  Stichworte   │  ┌──────────────────────┐   │  + <Content><Outlet/></Content>
│ ▸Fahrzeuge    │  │  Tabelle / Formular  │   │
│  Material     │  └──────────────────────┘   │
│  … (11)       │                             │
│ EINSTELLUNGEN │                             │
│  Anzeige      │                             │
│  Einsatz-Def. │                             │
│  Anmeldeverf. │                             │
│ KARTEN        │                             │
│  Online       │                             │
│  Offline      │                             │
│ Benutzer      │                             │
└───────────────┴────────────────────────────┘
```

## Admin-Nav-Registry (eine Quelle der Wahrheit)

Neu: `src/admin/adminNav.tsx` — eine Registry, die **Sidebar-Menu, Routen und Pfad-Builder**
speist (Muster wie `einsatz/modulRegistry`). Kein doppeltes Pflegen von Menu-Items und Routen.

```ts
interface AdminSektion { key: string; label: string; element: React.ReactNode; }
interface AdminGruppe  { key: 'stammdaten' | 'einstellungen' | 'karten'; label: string;
                         sektionen: AdminSektion[]; }

export const adminGruppen: AdminGruppe[] = [ /* stammdaten(11), einstellungen(3), karten(2) */ ];
// Benutzer ist ein Sonder-Eintrag (eigene Route, strengeres admin-only-Gate) — separat, nicht in einer Gruppe.
```

- **Stammdaten (11):** stichworte, fahrzeuge, material, status, personal, qualifikationen,
  personal-status, etb-bausteine, einheit-typen, organisation, sprechgruppen (Keys wie die
  bisherigen Tab-Keys — Bestands-Deep-Links bleiben stabil). `element` = bestehende `*Tab`-
  Komponente, gewrappt in `<AdminPage titel={label}>`.
- **Einstellungen (3):** anzeige, einsatz, anmeldung (Keys wie bisherige Segmented-Keys).
- **Karten (2):** online, offline.

**Pfad-Builder** (zentral, kein inline-Template — analog `routing/deeplinks.ts`, aber
Admin-Familie; entweder in `adminNav.tsx` oder als Ergänzung in `deeplinks.ts`):
`adminSektionPfad(gruppe, sektion) → /admin/${gruppe}/${sektion}`, `adminBenutzerPfad() →
/admin/benutzer`. Default-Sektion je Gruppe = erstes Registry-Element.

## Routing + Redirects (`App.tsx`)

Aus der Registry generiert:

```
/admin                       → AdminLayout (Sider + Menu + Outlet), Gate darfAdmin
  index                      → Navigate → /admin/stammdaten/stichworte  (Default)
  <gruppe>                   → Navigate → erste Sektion der Gruppe        (je Gruppe)
  <gruppe>/<sektion>         → Sektions-Element                          (16 Leaf-Routen)
  benutzer                   → BenutzerPage (admin-only Gate als früher Return, bleibt)
```

**Bestands-Routen/Redirects erhalten (AK):**
- `/stammdaten` → `/admin/stammdaten` (bleibt; landet via Gruppen-Redirect auf erste Sektion).
- **Neu:** `/benutzer` → `/admin/benutzer` (Redirect, damit externe Links / `BenutzerMenu`
  weiterfunktionieren).
- `/profil` bleibt unverändert außerhalb des Admin-Bereichs.

## Shell — `AdminLayout` (umgeschrieben)

`<Tabs>` raus; stattdessen `<Layout><Sider><Menu/></Sider><Content><Outlet/></Content></Layout>`.

- **Menu:** inline, Gruppen als `ItemGroup`-Überschriften (flach, alle Einträge sichtbar,
  Sider scrollt) + Benutzer als eigener Eintrag unten (nur wenn `system_rolle==='admin'`).
- **Aktiver Eintrag / Navigation:** `selectedKeys` aus `useLocation().pathname` ableiten
  (`<gruppe>/<sektion>` bzw. `benutzer`), `onClick` → `navigate(adminSektionPfad(...))`.
  Kein eigener Nav-State — die URL ist die Wahrheit.
- **Gate:** `darfAdmin` bleibt am `AdminLayout` (früher Return → Redirect `/einsaetze`).
- **Responsiv:** `Sider` mit `breakpoint`/`collapsedWidth` → auf schmal einklappen
  (collapsible). Zahlenwerte über `theme.useToken()`, keine Hex/px hartkodiert (Memory
  „antd cssVar nicht aktiviert").

## Seiten-Migration

- **Stammdaten:** `StammdatenPage`/`<Tabs>` entfällt als Umschalter. Jede der 11 `*Tab`-
  Komponenten wird ein Routen-Element (`<AdminPage titel><XTab/></AdminPage>`), lädt lazy
  einzeln (statt 11 parallele Queries im Tab-Block). Tab-Keys → Sektions-Keys (unverändert).
- **Karten:** `KartenVerwaltungPage`/`SegmentSektionen` entfällt; `OnlineQuellenVerwaltung` und
  `OfflineKartenVerwaltung` werden je ein Routen-Element (in `AdminPage` gewrappt). Sektions-
  Toolbars/`refetchInterval`-Polling bleiben in den Kind-Komponenten. Offline-Erklär-Text
  bleibt im Offline-Panel (`SektionHeader`).
- **Einstellungen (voll flach, 3 Routen):** `GlobalEinstellungenPage` zerfällt in drei
  eigenständige Sektions-Komponenten:
  - **Anzeige** — eigenes gescoptes `<Form>` (Felder zeitzone, zeitformat, einheiten,
    koordinatenformat) + „Speichern" im `AdminPage`-`aktionen`-Slot (`form.submit()`).
  - **Einsatz-Defaults** — eigenes gescoptes `<Form>` (retention_dauer_tage, *_nummer_praefix,
    *_frist_min, auto_etb_eintraege, geocoder_url) + „Speichern"; die Modul-Rollen-Liste
    speichert weiterhin **sofort** (`modulMutation`, kein Form-Feld).
  - **Anmeldeverfahren** — **kein** Form/`aktionen`-Button; Provider-Toggles speichern sofort
    (`schaltenMutation`). Passwort-Provider bleibt garantiert nicht-deaktivierbar (Tooltip).
  - Jede Komponente hält ihre eigene(n) `useQuery` (react-query-Cache über die bestehenden
    Query-Keys geteilt). `speichereOrgEinstellungen` nimmt ein partielles
    `OrgEinstellungenUpdate` → zwei getrennte Teil-Saves sind wire-korrekt. `istAdmin`-
    Read-only-Verhalten (Führungskräfte sehen Werte, können nicht editieren) je Sektion
    erhalten.
- **Benutzer:** Route `/admin/benutzer`, in die Sidebar; strengeres `system_rolle==='admin'`-
  Gate bleibt als **früher Return vor** dem `AdminPage`-JSX (Redirect-Verhalten unverändert).
  „Benutzer anlegen" bleibt im `aktionen`-Slot.

## Aufräumen / Entfernungen

- `SegmentSektionen.tsx` + `SegmentSektionen.test.tsx` **entfernen** — nach der Migration
  nirgends mehr genutzt (verifiziert: nur die 2 Admin-Seiten importierten es).
- `AdminLayout` Top-`<Tabs>` + `TAB_ITEMS` entfallen (Datei wird zur Sider-Shell).
- `AppLayout`: „Benutzer"-`GlobalLink` entfernen (jetzt in der Admin-Sidebar); „Verwaltung"
  bleibt. Das `darfAdmin`-Duplikat in `AppLayout`/`AdminLayout` bleibt vorerst (keine
  Hook-Konsolidierung in diesem Task — YAGNI).

## Tests & Gates

- **Shell-Test** (`AdminLayout`): Sidebar-Gruppen + Einträge gerendert; aktiver Eintrag folgt
  der Route; Klick navigiert; Benutzer-Eintrag nur für Admin; `darfAdmin`-Redirect.
- **Routing/Redirect-Test:** `/admin` → Default-Sektion; `/admin/<gruppe>` → erste Sektion;
  `/stammdaten` → `/admin/stammdaten`; `/benutzer` → `/admin/benutzer`.
- **Seiten-Tests umstellen:** bisher Tab-/Segmented-Klick → jetzt Route-Navigation
  (`MemoryRouter initialEntries={['/admin/…/<sektion>']}` + Registry-Routen). Die 2
  Einstellungen-Payload-Tests je Sektion neu verdrahten (getrennte Forms). Bestehende
  `getByText`/`getByLabelText`/`getByRole('combobox')`-Checks bleiben, sind aber jetzt pro
  Sektions-Route statt „alle gemountet".
- **Pfad-Builder-Unit-Test** (`adminNav`/`deeplinks`): Pfade + Default-Sektion.
- **Gates:** `vitest` grün (Memory: volle Suite via `--no-file-parallelism`), `pnpm lint`
  (`--max-warnings 0`), `pnpm typecheck` (eigenes Gate, `lib ES2020`).

## Nicht in Scope (YAGNI)

- Table→Liste-Migration der Stammdaten-CRUD / Karten-Tabellen (eigener Task, riskant).
- `darfAdmin`/`istSystemAdmin`-Hook-Konsolidierung (dupliziertes Gate) — separater Cleanup.
- Profil in den Admin-Bereich holen (Profil ist persönlich, kein Admin-Recht).
- Backend-Änderungen (Routing/DTOs unverändert).
- Neue Berechtigungs-/Verhaltensänderungen über die reine Nav-/Layout-Umstellung hinaus.

## Offene Umsetzungsdetails (für den Plan)

- Exaktes Feld↔Sektion-Mapping in `GlobalEinstellungenPage` beim Aufteilen (Tab-JSX lesen).
- Genaue Test-Dateien + msw-Mocks je Sektions-Route (bestehende Seiten-Tests inventarisieren).
- `Menu`-Feinschliff: `ItemGroup` (flach) vs. collapsible `SubMenu` bei langer Stammdaten-Liste
  — Default flach; bei Höhe/Scroll-Problemen collapsible als Refinement.
