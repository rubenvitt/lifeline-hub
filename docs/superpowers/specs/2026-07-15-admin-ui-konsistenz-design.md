# Admin-UI-Konsistenz — Design (LFH-281)

**Goal:** Alle vier Verwaltungs-Seiten (Stammdaten, Globale Einstellungen, Karten, Benutzer)
teilen einen einheitlichen Seiten-Rahmen + Header und geteilte Binnen-Gliederungs-Komponenten;
Schluss mit dupliziertem, divergierendem Container-/Header-Markup.

**Architektur:** Drei neue geteilte Komponenten unter `frontend/src/components/`, danach Migration
der vier Seiten darauf. **Reiner Frontend-Task, kein Backend-Change.** Basiert auf der
Parallel-Analyse (Workflow `wf_de4c6f16-07e`).

## Ist-Zustand / Problem

`AdminLayout` (`src/admin/AdminLayout.tsx`) rendert oben Tabs (Stammdaten/Einstellungen/Karten)
+ `<Outlet>`. Jede Seite wiederholt darunter eine große `Typography.Title level={3}`, die den
aktiven Top-Tab dupliziert, in uneinheitlichen Containern (maxWidth 960/860/960/800, paddingTop
teils fehlend, margin auto teils fehlend). Einstellungen (LFH-280) hat zusätzlich verschachtelte
Links-Tabs. Benutzer (`/benutzer`) liegt außerhalb des AdminLayout mit eigenem Header-Muster.
Es existiert **keine** geteilte Seiten-Header-/Rahmen-Komponente.

## Geteilte Komponenten (neu, `src/components/`)

Alle Farben/Abstände über `theme.useToken()` — **nie** Hex/px hartkodieren, **nie** `var(--ant-*)`
(cssVar greift im Repo nicht; Memory „antd cssVar nicht aktiviert"). Typography.Title trägt große
Default-`margin-block` → überall `style={{ margin: 0 }}` resetten (hier zentralisiert).

### 1. `AdminPage.tsx`

Geteilter schlanker Seiten-Rahmen + Header für alle vier Seiten.

```ts
interface AdminPageProps {
  titel: React.ReactNode;
  beschreibung?: React.ReactNode;   // einzeilig, gedämpft
  aktionen?: React.ReactNode;       // rechter Header-Slot (außerhalb jedes <Form>!)
  hinweis?: React.ReactNode;        // optional, unter dem Header (z.B. read-only-Alert)
  breite?: number;                  // Default 900
  children: React.ReactNode;
}
```

Aufbau: äußeres `div` mit `maxWidth={breite}`, `margin: '0 auto'`; Header-Zeile als
`<Flex justify="space-between" align="flex-start">` — links `<Typography.Title level={4}
style={{ margin: 0 }}>{titel}` + darunter `beschreibung` als `<Typography.Text type="secondary">`,
rechts `{aktionen}`; optionaler `{hinweis}` unter dem Header; darunter `{children}`.

**KRITISCH:** `{aktionen}` wird außerhalb jedes `<Form>` gerendert. Ein Speichern-Button dort
darf **nicht** `htmlType="submit"` tragen (submittet als DOM-Geschwister außerhalb des
`<form>`-Elements nichts). Verdrahtung: die Seite hält `Form.useForm()`, gibt
`<Button onClick={() => form.submit()}>` in `aktionen` und legt `<Form form={form}>` in `children`.

### 2. `SegmentSektionen.tsx`

Binnen-Gliederung via antd `Segmented` (Pillen) statt Tabs. Referenzmuster für antd-v6-Segmented:
`src/components/ThemeToggle.tsx`.

```ts
interface SegmentSektionenProps {
  sektionen: { key: string; label: React.ReactNode; inhalt: React.ReactNode }[];
  ariaLabel: string;
  standardKey?: string;             // uncontrolled Default
  block?: boolean;
}
```

Rendert `<Segmented options={sektionen.map(s => ({ value: s.key, label: s.label }))}
value={aktiv} onChange={setAktiv} aria-label={ariaLabel} block={block} />` + je Sektion
`<div style={{ display: aktiv === s.key ? 'block' : 'none' }}>{s.inhalt}</div>`.

**Alle Panels bleiben gemountet** (inaktiv `display:none`, kein conditional unmount) — nötig,
damit (a) ein seitenweites Form-Submit alle Felder erfasst und (b) `getByText`/`getByLabelText`
hidden-Inhalte finden. Interaktive Section-Tests klicken erst die Pille
(`fireEvent.click(getByText('<Label>'))`), dann tippen. Rolle wechselt zu `radio`/`radiogroup`
(nicht `tab`).

### 3. `SektionHeader.tsx`

Wiederkehrender Sektions-Titel (höchste Wiederholung).

```ts
interface SektionHeaderProps {
  titel: React.ReactNode;
  beschreibung?: React.ReactNode;
  extra?: React.ReactNode;          // rechter Slot (Sektions-Aktion)
  children?: React.ReactNode;
}
```

`<Typography.Title level={5} style={{ margin: 0 }}>` + `beschreibung` als
`<Typography.Paragraph type="secondary">` mit Abständen aus `useToken`.

## Migration der vier Seiten

| Seite | Rahmen | Binnen-Gliederung | Header-Aktion |
|---|---|---|---|
| **GlobalEinstellungen** | AdminPage | SegmentSektionen (Anzeige/Einsatz-Defaults/Anmeldeverfahren) | „Speichern" via `form.submit()` |
| **Karten** | AdminPage | SegmentSektionen (Online-Quellen/Offline-Karten) | keine (CTAs bleiben in Kind-Komponenten) |
| **Benutzer** | AdminPage | — (Single-Section) | „Benutzer anlegen" |
| **Stammdaten** | AdminPage | **behält horizontale Tabs** (11 Sektionen — Segmented wäre schlechte UX + 11 parallele Queries) | keine |

### Seiten-Details & Test-Impact

- **GlobalEinstellungen:** Save-Button aus dem Form-Ende in den Header-Slot (`form.submit()`).
  Die 3 Sektionen als `SegmentSektionen` (alle gemountet — das seitenweite `<Form>` braucht es;
  belegt durch die 2 Payload-Tests). Tests: `findByRole('tab', {name})` (4×) →
  `fireEvent.click(getByText('Einsatz-Defaults'|'Anmeldeverfahren'))`. `getByText`/`getByLabelText`/
  `getByRole('combobox')`-Checks bleiben (display:none, nicht unmount). Kein Test referenziert den
  Seitentitel → Header-Umbau bricht nichts.
- **Karten:** kein `KartenVerwaltungPage.test.tsx`; Kind-Tests rendern die Kinder direkt → 0-Impact,
  solange die Sektions-Toolbars in den Kindern bleiben. SegmentSektionen „alle gemountet" wegen
  `refetchInterval`-Polling (Download-/Bau-Fortschritt) in `OfflineKartenVerwaltung`. Die
  Offline-Erklär-Beschreibung bleibt IM Offline-Panel (SektionHeader), nicht im Seiten-Header.
- **Benutzer:** liegt außerhalb AdminLayout → Titel „Benutzer" bleibt (trägt die Benennung, da
  kein Top-Tab); „Benutzer anlegen" in den `aktionen`-Slot. **Strengeres Gate** (`system_rolle ===
  'admin'`, NICHT `darfAdmin`) muss als früher Return **vor** dem AdminPage-JSX bleiben (Redirect-Test).
  Tests: `findByRole('heading', {name:'Admin'})` ist die Listen-Zeile (≠ Seitentitel „Benutzer") →
  bleibt eindeutig; „Benutzer anlegen"-Label unverändert lassen.
- **Stammdaten:** nur Rahmen-Umbau (AdminPage) + H3 raus; **innere Tabs unverändert** (lazy).
  Titel-Text „Stammdaten" muss erhalten bleiben (`getByText('Stammdaten')`, Z. 30). Keine neuen
  msw-Mocks nötig, da Tabs lazy bleiben (kein all-mount).

## Nicht in Scope (YAGNI)

- Table→Liste-Migration der Stammdaten-CRUD-Tabs / Karten-Tabellen (riskant, eigener Task).
- `useIstSystemAdmin`-Hook-Konsolidierung (dupliziertes `system_rolle==='admin'`) — separater Cleanup.
- Neue read-only-Banner, wo bisher keine sind (kein Verhaltens-Zusatz).
- Benutzer in die Admin-Tabs holen (Navigations-Änderung) — Nav bleibt.

## Tests & Gates

Komponenten-Unit-Tests für AdminPage/SegmentSektionen/SektionHeader (Rendering, Slots,
Segmented-Umschaltung, `form.submit()`-Verdrahtung). Seiten-Tests angepasst (Tab→Segmented).
Gates: vitest grün, `pnpm lint` (`--max-warnings 0`), `pnpm typecheck`.
