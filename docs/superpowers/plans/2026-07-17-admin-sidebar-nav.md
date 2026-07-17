# Admin-Sidebar-Navigation Implementation Plan (LFH-284)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Die doppelte Nav-Ebene im Admin-Bereich durch **eine** linke Sidebar ersetzen; jede
Admin-Sektion wird eine eigene, deep-linkbare Route.

**Architecture:** Eine `adminNav`-Registry (Gruppen → Sektionen mit Element + Pfad-Buildern) ist
die einzige Quelle für Sidebar-`Menu` **und** Routen. `AdminLayout` wird `Layout.Sider` + inline
`Menu` + `<Outlet>`. `GlobalEinstellungenPage` zerfällt in 3 Sektions-Komponenten; die
Vollersatz-PUT-Semantik zwingt jeden Teil-Save, den **vollen** Payload (eigene Felder + Rest aus
den geladenen Daten) zu senden. Reiner Frontend-Task.

**Tech Stack:** React 19, react-router v6, antd v6 (`Layout.Sider`, `Menu`, `theme.useToken()`),
@tanstack/react-query, vitest + Testing-Library, msw.

## Global Constraints

- Kein Backend-Change. Bestands-Routen erhalten: `/stammdaten`→`/admin/stammdaten`; **neu**
  `/benutzer`→`/admin/benutzer`; `/profil` unverändert.
- Deep-Link-Pfade nur über zentrale Builder (kein inline-Template-Literal).
- antd: Abstände/Farben aus `theme.useToken()`, **nie** Hex/px hartkodiert, **nie**
  `var(--ant-*)` (Memory „antd cssVar nicht aktiviert").
- **PUT `/api/org-einstellungen` = Vollersatz** (verifiziert `src/routes/org_einstellungen.rs`):
  jeder Einstellungs-Save sendet den vollen `OrgEinstellungenUpdate`.
- Benutzer-Gate bleibt strenger als Admin-Gate: Seite nur für `system_rolle==='admin'`
  (früher Return → Redirect), Rest des Admin-Bereichs `darfAdmin` (admin ODER fuehrungskraft).
- Gates grün: `vitest` (volle Suite via `--no-file-parallelism`, Memory), `pnpm lint`
  (`--max-warnings 0`), `pnpm typecheck` (`lib ES2020`). pnpm via `mise exec` mit absolutem
  `-C`-Pfad (Memory „pnpm via mise exec").

**Sektions-Registry (Keys unverändert = Bestands-Kompatibilität):**
- stammdaten: stichworte, fahrzeuge, material, status, personal, qualifikationen,
  personal-status, etb-bausteine, einheit-typen, organisation, sprechgruppen
- einstellungen: anzeige, einsatz, anmeldung
- karten: online, offline
- benutzer (Sonder-Eintrag, eigenes Gate)

---

## Task 1: Einstellungen in 3 Sektions-Komponenten aufteilen

Der korrektheitskritische Kern zuerst (Vollersatz-Merge-Save). `GlobalEinstellungenPage` bleibt
vorerst bestehen (wird erst in Task 5 entfernt) — hier entstehen die 3 neuen Komponenten.

**Files:**
- Create: `frontend/src/pages/einstellungen/AnzeigeEinstellungen.tsx`
- Create: `frontend/src/pages/einstellungen/EinsatzDefaults.tsx`
- Create: `frontend/src/pages/einstellungen/Anmeldeverfahren.tsx`
- Create: `frontend/src/pages/einstellungen/orgEinstellungenForm.ts` (geteilte Feld-Maps/Merge)
- Test: `frontend/src/pages/einstellungen/AnzeigeEinstellungen.test.tsx`
- Test: `frontend/src/pages/einstellungen/EinsatzDefaults.test.tsx`
- Test: `frontend/src/pages/einstellungen/Anmeldeverfahren.test.tsx`

**Interfaces:**
- Consumes: `ladeOrgEinstellungen`, `speichereOrgEinstellungen`, `ladeOrgModulEinstellungen`,
  `setzeOrgModulEinstellung`, `providerListeAdmin`, `providerSchalten` (`api/*`), `AdminPage`,
  `SektionHeader`, `useAuth`, `modulRegistry`.
- Produces: default-exported Komponenten `AnzeigeEinstellungen`, `EinsatzDefaults`,
  `Anmeldeverfahren` (je `() => JSX`, ohne Props). `orgEinstellungenForm.ts` exportiert:
  `zuUpdate(einstellungen): OrgEinstellungenUpdate` (voll, aus geladenen Daten), die
  `initialWerte`-Mapper je Sektion **und die Feld-Normalizer** je Sektion
  (`normalisiereAnzeige(formWerte)`, `normalisiereEinsatz(formWerte)`) — sie tragen die
  **exakte** Alt-Semantik: Strings `?.trim() || null`, Numbers `?? null`, `auto_etb_eintraege`
  als Bool. Jede Sektion speichert `{ ...zuUpdate(loaded), ...normalisiere<Sektion>(formWerte) }`
  — **nie** rohe `form.getFieldsValue()` spreaden (sonst geht ein geleertes Feld als `''` statt
  `null` raus und kippt „leer = Fallback").

**Kernlogik `orgEinstellungenForm.ts` (Vollersatz-sicher):**
```ts
import type { OrgEinstellungen, OrgEinstellungenUpdate } from '../../api/types';

/** Voller Update-Payload aus dem geladenen Zustand (Basis für Merge-Save, PUT=Vollersatz). */
export function zuUpdate(e: OrgEinstellungen): OrgEinstellungenUpdate {
  return {
    zeitzone: e.zeitzone ?? null,
    zeitformat: e.zeitformat ?? null,
    einheiten: e.einheiten ?? null,
    koordinatenformat: e.koordinatenformat ?? null,
    geocoder_url: e.geocoder_url ?? null,
    retention_dauer_tage: e.retention_dauer_tage ?? null,
    etb_nummer_praefix: e.etb_nummer_praefix ?? null,
    meldung_nummer_praefix: e.meldung_nummer_praefix ?? null,
    auftrag_nummer_praefix: e.auftrag_nummer_praefix ?? null,
    meldung_bestaetigung_frist_min: e.meldung_bestaetigung_frist_min ?? null,
    auftrag_quittierung_frist_min: e.auftrag_quittierung_frist_min ?? null,
    auto_etb_eintraege: e.auto_etb_eintraege !== 0,
  };
}
```
Jede Sektion baut beim Speichern `{ ...zuUpdate(geladeneDaten), ...eigeneEditierteFelder }` und
ruft `speichereOrgEinstellungen`. So kann Anzeige-Save nie die Einsatz-Default-Spalten nullen.
Feld↔Sektion-Mapping (aus dem alten `GlobalEinstellungenPage`):
- **Anzeige:** zeitzone, zeitformat, einheiten, koordinatenformat, geocoder_url.
- **Einsatz-Defaults:** retention_dauer_tage, etb/meldung/auftrag_nummer_praefix,
  meldung_bestaetigung_frist_min, auftrag_quittierung_frist_min, auto_etb_eintraege +
  Modul-Rollen-Liste (Sofort-Save via `setzeOrgModulEinstellung`, kein Form-Feld).
- **Anmeldeverfahren:** Provider-Toggles (Sofort-Save via `providerSchalten`), kein Form/Button.

Jede Komponente rendert ihren Inhalt in `<AdminPage titel=… aktionen={istAdmin? Speichern-Button}>`
(Button nur bei Anzeige/Einsatz-Defaults; `onClick={() => form.submit()}`, **kein**
`htmlType="submit"`). Read-only für Nicht-Admins (`disabled` am `<Form>` / Switches) bleibt.

- [ ] **Step 1: Failing test — Anzeige-Save sendet vollen Payload**

`AnzeigeEinstellungen.test.tsx`: msw mockt GET `/api/org-einstellungen` mit gesetzten
Einsatz-Default-Werten (z. B. `etb_nummer_praefix: 'EB-'`, `retention_dauer_tage: 30`) und
leerer Anzeige. Ändere die Zeitzone, klicke „Speichern", fange den PUT-Body ab (msw handler):
```ts
expect(putBody.zeitzone).toBe('Europe/Berlin');
expect(putBody.etb_nummer_praefix).toBe('EB-');      // andere Sektion NICHT genullt
expect(putBody.retention_dauer_tage).toBe(30);
```

- [ ] **Step 2: Run — verify FAIL** (`mise exec pnpm@… -- pnpm -C <abs> vitest run src/pages/einstellungen/AnzeigeEinstellungen.test.tsx`) → FAIL (Komponente/Datei fehlt).

- [ ] **Step 3: Implement** `orgEinstellungenForm.ts` + `AnzeigeEinstellungen.tsx` (Form mit den 5 Anzeige-`Form.Item` aus dem alten Code, Merge-Save wie oben).

- [ ] **Step 4: Run — verify PASS.**

- [ ] **Step 4b: Failing test — geleertes Feld → `null` (Normalizer)** in `EinsatzDefaults.test.tsx`:
  GET mockt `etb_nummer_praefix: 'EB-'`; im Einsatz-Defaults-Form das Präfix **leeren**, speichern:
  `expect(putBody.etb_nummer_praefix).toBeNull();` (nicht `''`). Deckt die trim/leer→null-Semantik ab.
- [ ] **Step 5: Failing test — EinsatzDefaults-Save merged Anzeige-Werte** (analog: geladene Anzeige-Werte bleiben im PUT-Body erhalten; ein Präfix-Feld wird geändert und landet im Body). Dann **EinsatzDefaults implementieren** (7 Form-Felder + Modul-Rollen-Liste mit Sofort-Save; Normalizer aus `orgEinstellungenForm.ts`). Run → PASS (inkl. Step 4b).

- [ ] **Step 6: Failing test — Anmeldeverfahren** (Provider-Liste gerendert, Toggle ruft `providerSchalten`, Passwort-Provider disabled). **Implementieren** (kein Form/Button). Run → PASS.

- [ ] **Step 7: Commit** `git add frontend/src/pages/einstellungen && git commit -m "feat(lfh-284): Einstellungen in 3 Sektions-Komponenten (Vollersatz-sicherer Merge-Save)"`

---

## Task 2: Stammdaten- & Karten-Sektionen als Routen-Elemente

**Files:**
- Create: `frontend/src/karten/KartenOnlineSektion.tsx`, `frontend/src/karten/KartenOfflineSektion.tsx`
  (je `AdminPage`-Wrap um `OnlineQuellenVerwaltung`/`OfflineKartenVerwaltung` inkl. read-only-Hinweis
  + Sektions-Beschreibungstext aus dem alten `KartenVerwaltungPage`).
- Test: `frontend/src/karten/KartenOnlineSektion.test.tsx` (rendert Kind, read-only-Alert nur für Nicht-Admin).

**Interfaces:**
- Produces: default-exported `KartenOnlineSektion`, `KartenOfflineSektion` (`() => JSX`).
- Stammdaten braucht **keine** neue Datei: die 11 `*Tab` existieren; das Registry-Element wird
  `<AdminPage titel={label}><XTab/></AdminPage>` (statisch, kein Auth nötig).

- [ ] **Step 1: Failing test** `KartenOnlineSektion.test.tsx` — für Nicht-Admin erscheint der
  „Nur lesend"-Alert, `OnlineQuellenVerwaltung` wird gerendert; für Admin kein Alert.
- [ ] **Step 2: Run — FAIL.**
- [ ] **Step 3: Implement** beide Karten-Sektions-Komponenten (Markup aus altem `KartenVerwaltungPage`, `hinweis` je Sektion; `useAuth` für `istAdmin`).
- [ ] **Step 4: Run — PASS.**
- [ ] **Step 5: Commit** `feat(lfh-284): Karten-Sektionen als eigenständige Routen-Elemente`

---

## Task 3: `adminNav`-Registry + Pfad-Builder

**Files:**
- Create: `frontend/src/admin/adminNav.tsx`
- Test: `frontend/src/admin/adminNav.test.ts`

**Interfaces:**
- Consumes: alle 16 Sektions-Elemente (11 `*Tab` gewrappt, 3 Einstellungen-, 2 Karten-Komponenten).
- Produces:
```ts
export interface AdminSektion { key: string; label: string; element: React.ReactNode; }
export interface AdminGruppe { key: string; label: string; sektionen: AdminSektion[]; }
export const adminGruppen: AdminGruppe[];               // stammdaten, einstellungen, karten
export const adminBenutzer: { key: 'benutzer'; label: 'Benutzer' };
export function adminSektionPfad(gruppe: string, sektion: string): string; // /admin/${g}/${s}
export function adminBenutzerPfad(): string;                                // /admin/benutzer
export function defaultAdminPfad(): string;   // erste Gruppe, erste Sektion
export function ersteSektionPfad(gruppe: string): string; // Gruppen-Redirect-Ziel
```

- [ ] **Step 1: Failing test** `adminNav.test.ts`:
```ts
expect(adminSektionPfad('stammdaten', 'fahrzeuge')).toBe('/admin/stammdaten/fahrzeuge');
expect(adminBenutzerPfad()).toBe('/admin/benutzer');
expect(defaultAdminPfad()).toBe('/admin/stammdaten/stichworte');
expect(adminGruppen.flatMap(g => g.sektionen).length).toBe(16);
// Keys je Gruppe eindeutig; stammdaten hat 11 Sektionen
```
- [ ] **Step 2: Run — FAIL.**
- [ ] **Step 3: Implement** `adminNav.tsx` (importiert die Elemente; Gruppen/Sektionen wie Registry oben; reine Pfad-Builder).
- [ ] **Step 4: Run — PASS.**
- [ ] **Step 5: Commit** `feat(lfh-284): Admin-Nav-Registry + zentrale Pfad-Builder`

---

## Task 4: Cutover — `AdminLayout` Sidebar + `App.tsx` Routen/Redirects (atomar)

Die eigentliche Umstellung. AdminLayout-Shell + Routing zusammen (gekoppelt: Sidebar-Klick
braucht die neuen Routen). Danach ist die neue Nav live.

**Files:**
- Modify: `frontend/src/admin/AdminLayout.tsx` (Tabs → `Layout.Sider` + `Menu` aus `adminGruppen`)
- Modify: `frontend/src/App.tsx:106-111` (Routen aus Registry generieren + Redirects; `/benutzer`→`/admin/benutzer`; Benutzer unter `/admin`)
- Modify: `frontend/src/admin/AdminLayout.test.tsx` (Sidebar statt Tabs)
- Modify: `frontend/src/pages/BenutzerPage.test.tsx` (Route-Kontext `/admin/benutzer`, Gate-Redirect bleibt)

**AdminLayout-Kern:**
```tsx
const { pathname } = useLocation();               // z.B. /admin/stammdaten/fahrzeuge → selected 'stammdaten/fahrzeuge'
const selected = pathname.replace(/^\/admin\//, '') || defaultKey;
// Menu items: adminGruppen → ItemGroup{ label, children: sektionen.map(s => ({key:`${g.key}/${s.key}`, label})) }
// + (istSystemAdmin ? benutzer-Item {key:'benutzer'} : nichts)
// onClick: navigate('/admin/' + key)
// <Layout><Sider breakpoint="lg" collapsedWidth="0"><Menu mode="inline" selectedKeys={[selected]} .../></Sider>
//   <Content><Outlet/></Content></Layout>   — Gate darfAdmin bleibt früher Return
```

**App.tsx-Routen (aus Registry):**
```tsx
<Route path="/benutzer" element={<Navigate to="/admin/benutzer" replace />} />
<Route path="/admin" element={<AdminLayout />}>
  <Route index element={<Navigate to={defaultAdminPfad()} replace />} />
  {adminGruppen.map((g) => (
    <Fragment key={g.key}>
      <Route path={g.key} element={<Navigate to={ersteSektionPfad(g.key)} replace />} />
      {g.sektionen.map((s) => (
        <Route key={s.key} path={`${g.key}/${s.key}`} element={s.element} />
      ))}
    </Fragment>
  ))}
  <Route path="benutzer" element={<BenutzerPage />} />
</Route>
```
(`/stammdaten`→`/admin/stammdaten`-Redirect Zeile bleibt unverändert bestehen.)

- [ ] **Step 1: Failing test** `AdminLayout.test.tsx` — rendert Gruppen-Überschriften (Stammdaten/Einstellungen/Karten) + Einträge; bei Route `/admin/karten/offline` ist „Offline-Karten" aktiv (`aria-selected`/`ant-menu-item-selected`); Klick auf „Fahrzeuge" navigiert nach `/admin/stammdaten/fahrzeuge`; Benutzer-Eintrag nur für `system_rolle==='admin'`; Nicht-`darfAdmin` → Redirect `/einsaetze`.
- [ ] **Step 2: Run — FAIL.**
- [ ] **Step 3: Implement** AdminLayout-Umbau + App.tsx-Routen + `/benutzer`-Redirect.
- [ ] **Step 4: Run** AdminLayout- + BenutzerPage-Test → **PASS** (BenutzerPage-Test-Route auf `/admin/benutzer` ziehen; Gate-Redirect-Assertion bleibt).
- [ ] **Step 5: Failing test — Redirects** (in `AdminLayout.test.tsx` oder neuem `adminRouting.test.tsx`): `/admin`→`/admin/stammdaten/stichworte`, `/admin/einstellungen`→`…/anzeige`, `/benutzer`→`/admin/benutzer`. Implementieren falls nötig, Run → PASS.
- [ ] **Step 6: Commit** `feat(lfh-284): Admin-Sidebar scharfschalten — Sider+Menu + registry-getriebene Routen`

---

## Task 5: Alt-Code entfernen + Seiten-Tests umstellen

**Files:**
- Delete: `frontend/src/components/SegmentSektionen.tsx`, `frontend/src/components/SegmentSektionen.test.tsx`
- Delete: `frontend/src/pages/StammdatenPage.tsx`, `frontend/src/pages/GlobalEinstellungenPage.tsx`, `frontend/src/karten/KartenVerwaltungPage.tsx`
- Delete/Replace: `frontend/src/pages/StammdatenPage.test.tsx`, `frontend/src/pages/GlobalEinstellungenPage.test.tsx`, `frontend/src/karten/KartenVerwaltungPage.test.tsx` (durch die Sektions-/AdminLayout-Tests abgedeckt; Payload-Prüfungen leben jetzt in den Einstellungen-Sektions-Tests aus Task 1)
- Modify: `frontend/src/components/AppLayout.tsx` (Benutzer-`GlobalLink` entfernen), `frontend/src/components/AppLayout.test.tsx`

- [ ] **Step 1:** `rg` bestätigt: keine Importe mehr auf die zu löschenden Dateien (außer den zu löschenden Tests). Falls doch → Import auf Registry/Sektion umbiegen.
- [ ] **Step 2: Failing test** `AppLayout.test.tsx` — „Verwaltung"-Link vorhanden, **kein** „Benutzer"-Topbar-Link mehr.
- [ ] **Step 3: Run — FAIL.**
- [ ] **Step 4: Implement** — Benutzer-`GlobalLink` aus `AppLayout` entfernen; die 6 Alt-Dateien löschen.
- [ ] **Step 5: Run — PASS** (AppLayout-Test).
- [ ] **Step 6: Commit** `refactor(lfh-284): Alt-Nav entfernen (SegmentSektionen, Wrapper-Seiten, Topbar-Benutzer-Link)`

---

## Task 6: Vollständige Gate-Runde + `deeplinks`-Ergänzung

- [ ] **Step 1:** Falls Admin-Pfad-Builder in `routing/deeplinks.ts` statt `adminNav` gewünscht — hier konsolidieren; sonst `adminNav`-Tests genügen. (Entscheidung: bleibt in `adminNav`, `deeplinks.ts` unangetastet.)
- [ ] **Step 2: Typecheck** — `mise exec pnpm@… -- pnpm -C <abs> typecheck` → 0 Fehler (bes. entfernte Importe/tote Referenzen).
- [ ] **Step 3: Lint** — `pnpm -C <abs> lint` (`--max-warnings 0`) → 0.
- [ ] **Step 4: Volle Vitest-Suite** — `pnpm -C <abs> vitest run --no-file-parallelism` → grün.
- [ ] **Step 5:** Manuelle Verifikation (verify-Skill): App bauen/starten, `/admin` → Sidebar, Sektion wechseln (URL ändert sich), `/stammdaten` + `/benutzer` Redirects, Einstellungen-Save je Sektion prüft anderen Bereich nicht nullen.
- [ ] **Step 6: Commit** (falls Fixes) `test(lfh-284): FE-Gates grün nach Sidebar-Umbau`

---

## Self-Review (gegen Spec)

- **Nav-Ebene aufgelöst:** Task 4 (Sidebar) + Task 5 (Alt-Leisten weg). ✓
- **Alle Sektionen deep-linkbar:** Task 3 (Pfade) + Task 4 (Routen). ✓ inkl. 11 Stammdaten (Task 2/4).
- **Bestands-Routen/Redirects:** Task 4 (`/stammdaten`, `/benutzer`, `/admin`, Gruppen-Redirects). ✓
- **Einstellungen voll flach + Vollersatz-sicher:** Task 1 (Merge-Save-Tests). ✓
- **Benutzer rein / Profil außen:** Task 4/5. ✓
- **FE-Gates:** Task 6. ✓
- **Typen konsistent:** `adminSektionPfad`/`ersteSektionPfad`/`defaultAdminPfad`/`adminBenutzerPfad`
  einheitlich in Task 3 definiert, in Task 4 konsumiert. ✓
- **Offen (bewusst, im Plan verlinkt):** `Menu` `ItemGroup` (flach) vs. `SubMenu` — Default flach,
  Refinement bei Höhe.
