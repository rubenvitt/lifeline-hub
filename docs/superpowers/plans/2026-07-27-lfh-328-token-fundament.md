# LFH-328 · A2 Token-Fundament, Statusfarb-Vertrag und Seiten-Primitive — Implementierungsplan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task.
> Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Die in A0 (LFH-352) gelegte Token-Schicht technisch durchsetzen — Dichte-Staffel als
Träger, ein getypter Statusfarb-Vertrag mit erzwungenem zweitem Kanal, geteilte Seiten-Primitive
— und die Konsumenten nachziehen, die A2 dabei ohnehin anfasst.

**Architecture:** `frontend/src/theme/` bleibt die einzige Quelle für Farb-, Abstands- und
Dichtewerte. TSX liest `theme.useToken()`, handgeschriebenes CSS liest `var(--lfh-*)` aus
`rollen.css` — `cssVar` bleibt aus (Begründung in der Spec). Neue Primitive liegen in
`frontend/src/components/`, der Statusfarb-Vertrag in `frontend/src/theme/statusFarben.ts`.
Jede Regel ist durch einen Test oder ein Grep-Gate gedeckt, nicht durch einen Kommentar.

**Tech Stack:** React 19 · TypeScript · antd 6 · TanStack Query v5 · Vitest + Testing Library ·
Vite · Rust/axum-Backend (nur für die Mutationsprobe in Task 17).

**Spec:** `docs/superpowers/specs/2026-07-27-token-fundament-statusfarb-vertrag.md` — sie trifft
die vier Entscheidungen (cssVar, Rot-Zuordnung, Vertragsgrenze, Prüfliste) und hält den
gemessenen Ist-Zustand fest. **Bei Widerspruch zwischen ClickUp-Task und Spec gilt die Spec** —
sie ist gegen HEAD gemessen, der Task-Text stammt von vor A0.

---

## Global Constraints

Diese gelten für **jeden** Task, ohne dass sie dort wiederholt werden:

- **Sprache:** Bezeichner, Kommentare und UI-Texte auf Deutsch, BOS-Fachsprache (`Einsatz`,
  `Kräfte`, `Meldung`), nicht generisches Dev-Vokabular. Umlaute korrekt.
- **Kein Farbwert außerhalb `frontend/src/theme/`.** Gate 5 (A1):
  `grep -rniE '#(b02318|ff7a7f|f5b942|5cc48d|1c6640|7a5200|1a5fa0|6fb4ec|a8071a|e04552)' frontend/src | grep -v '/theme/'` = 0.
- **Kein neues `size="small"` auf interaktiven Elementen.** Gate 4 (A1): in jeder angefassten
  Datei `grep -c 'size="small"' <datei>` = 0; repo-weit ≤ **236**.
  `grep -rn "controlHeight" frontend/src | grep -v '/theme/'` = 0.
- **`cssVar` bleibt aus.** Kein neues `var(--ant-*)` im Frontend.
- **Norm auf ohnehin Angefasstes** (Spec §7.1): Wer eine Datei für diesen Task öffnet, zieht sie
  **vollständig** auf die Zielzustände — Seitenkopf über das Primitiv, Farben aus den Rollen,
  Abstände aus `abstand`/`flaeche`, `size="small"` weg. Dateien, die kein Task nennt, werden
  **nicht** aufgesucht.
- **Query-Keys** ausschließlich über `frontend/src/api/queryKeys.ts`, **Deeplinks** ausschließlich
  über `frontend/src/routing/deeplinks.ts` (CLAUDE.md).
- **Lint:** `pnpm lint` läuft mit `--max-warnings 0`. `eslint-disable` nur zeilengenau **mit
  Begründung**, niemals datei- oder blockweit.
- **pnpm-Aufruf:** `mise exec pnpm@<ver> -- pnpm -C /Users/rubeen/dev/personal/lifeline-hub/frontend <cmd>`
  — immer absoluter Pfad.
- **Gate-Kommandos über `rtk proxy`** (der rtk-Hook maskiert sonst Exit-Codes), **kein `| tail`**.
- **Commits** referenzieren `LFH-328` im Body.

**Verbotene Nebenwirkungen** — diese Dinge sind ausdrücklich NICHT Teil von A2:

- Die zwei Distanzformatierer (`geo.ts/formatLaenge` `'1,5 km'` vs.
  `anzeige/format.ts/formatDistanz` `'1.50 km'`) **nicht** vereinheitlichen — beide sind
  gepinnt, die Zusammenführung ist ein eigenes Ticket.
- `--md-*` / `--me-*` (Markdown-CSS-Schicht) **nicht** auflösen — nur der Akzentwert wandert.
- Die ~20 Farb-/Label-Maps außerhalb der Vertrags-Enums (`personMeta`, `schadenHelfer`,
  `kommunikation/phase`, Tier/Material/Cluster) **nicht** anfassen.
- Keine Dichte-**Umschaltung** bauen (Kontext-Erkennung, Benutzereinstellung) — das ist B5.
- `pnpm build` vor `cargo test`/e2e nicht vergessen, falls `frontend/dist` fehlt (rust-embed).

---

# Phase 1 — Fundament

### Task 1: Dichte-Staffel und `flaeche` in `tokens.ts`

**Files:**
- Modify: `frontend/src/theme/tokens.ts`
- Modify: `frontend/src/theme/rollen.css`
- Modify: `frontend/src/theme/ThemeModeProvider.tsx:70-76`
- Modify: `frontend/src/theme/rollen.guard.test.ts`
- Test: `frontend/src/theme/tokens.test.ts` (neu)

**Interfaces:**
- Produces: `export type Dichte = 'kompakt' | 'komfortabel' | 'handschuh'`;
  `export const dichten: Record<Dichte, Dichtestufe>`;
  `export interface Dichtestufe { zeilenhoehe: number; schriftgroesse: number; abstand: Abstandsraster }`;
  `export const flaeche` (Nicht-antd-Block);
  `antdToken(farben: Farbrollen, dichte?: Dichte): ThemeConfig['token']` — **zweiter Parameter
  optional mit Default `'kompakt'`**, damit bestehende Aufrufe unverändert compilieren.
- Consumes: nichts.

Werte aus A1 Festlegung 4 (zitiert, nicht neu entschieden):

| | kompakt | komfortabel | Handschuh |
|---|---|---|---|
| `zeilenhoehe` (`controlHeight`) | 30 | 48 | 72 |
| `schriftgroesse` | 13.5 | 15 | 15 |
| `abstand.xs/sm/md/lg` | 3/7/11/18 | 5/11/18/28 | 7/16/26/44 |

Die `xs`/`sm`-Werte sind `[abgeleitet]` (× 1,6 / × 2,4, auf ganze Pixel gerundet) und tragen im
Code einen Kommentar, der das sagt.

- [ ] **Step 1: Failing test schreiben** — `frontend/src/theme/tokens.test.ts`

```ts
import { describe, expect, it } from 'vitest';
import { antdToken, dichten, farbenHell, flaeche } from './tokens';

describe('Dichte-Staffel (A1 Festlegung 4)', () => {
  it('trägt die drei in A1 festgelegten Steuerhöhen', () => {
    expect(dichten.kompakt.zeilenhoehe).toBe(30);
    expect(dichten.komfortabel.zeilenhoehe).toBe(48);
    expect(dichten.handschuh.zeilenhoehe).toBe(72);
  });

  it('lässt die Grundschrift nur einmal steigen — Handschuh ändert die Hand, nicht das Auge', () => {
    expect(dichten.kompakt.schriftgroesse).toBe(13.5);
    expect(dichten.komfortabel.schriftgroesse).toBe(15);
    expect(dichten.handschuh.schriftgroesse).toBe(15);
  });

  it('setzt controlHeight und fontSize aus der gewählten Stufe', () => {
    expect(antdToken(farbenHell, 'handschuh').controlHeight).toBe(72);
    expect(antdToken(farbenHell, 'komfortabel').fontSize).toBe(15);
  });

  it('bleibt ohne Dichte-Argument auf der kompakten Stufe (A0-Verhalten unverändert)', () => {
    expect(antdToken(farbenHell)).toEqual(antdToken(farbenHell, 'kompakt'));
  });

  it('exportiert Flächenmaße als Token statt als verstreute Pixel', () => {
    expect(flaeche.seiteSchmal).toBeGreaterThan(0);
    expect(flaeche.zustandOben).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Test laufen lassen, Fehlschlag bestätigen**

Run: `mise exec pnpm@<ver> -- pnpm -C /Users/rubeen/dev/personal/lifeline-hub/frontend vitest run src/theme/tokens.test.ts`
Expected: FAIL — `dichten`/`flaeche` sind nicht exportiert.

- [ ] **Step 3: `tokens.ts` erweitern**

`abstand` (heute ein `as const`-Objekt) wird zur `kompakt`-Stufe der neuen Staffel. **Der
bestehende `export const abstand` bleibt bestehen** und zeigt auf `dichten.kompakt.abstand` —
sonst brechen die A0-Konsumenten. `antdToken` bekommt den zweiten Parameter und liest
`controlHeight`, `fontSize`, `padding*`, `margin*` aus der Stufe statt aus den Modulkonstanten.
`flaeche` trägt mindestens: `seiteSchmal` (900, heute `AdminPage`-Default), `seiteBreit` (960,
heute `EinsaetzePage`), `zustandOben` (80, heute der 32-fach kopierte `paddingTop`),
`kachelMin` (260) und `kachelMinKlein` (220).

- [ ] **Step 4: `rollen.css` spiegeln** — A1 verlangt „`rollen.css` spiegelt sie als
  `--lfh-*`-Properties". Die kompakte Stufe bleibt unter `:root` wie heute; die beiden anderen
  kommen als eigene Blöcke (`[data-dichte='komfortabel']`, `[data-dichte='handschuh']`), die
  nur die abweichenden Properties überschreiben. **Kein Umschalter** — der Block existiert, wird
  in A2 aber von nichts gesetzt (B5).

- [ ] **Step 5: `rollen.guard.test.ts` erweitern** — der Guard prüft heute 18 Farbrollen × 2 Modi
  plus 5 Strukturprüfungen. Ergänzen: die drei Dichteblöcke sind wertgleich mit `dichten`, und
  die beiden Nicht-`:root`-Dichteblöcke überschreiben **nur** Dichte-Properties (XOR-Partition
  nach dem Muster der Zeilen 85-89). **Wichtig:** `block()` sucht den Selektor am
  **Zeilenanfang** — den neuen Selektoren keine Einrückung geben, sonst findet der Guard sie
  nicht (gemessener Fehlschlag, dokumentiert im Kopfkommentar der Datei).

- [ ] **Step 6: Tests laufen lassen**

Run: `mise exec pnpm@<ver> -- pnpm -C /Users/rubeen/dev/personal/lifeline-hub/frontend vitest run src/theme/`
Expected: PASS, alle Dateien in `src/theme/`.

- [ ] **Step 7: Gate 4 prüfen und committen**

```bash
rtk proxy grep -rn "controlHeight" frontend/src | grep -v '/theme/'   # muss leer sein
git add frontend/src/theme/
git commit -m "feat(lfh-328): Dichte-Staffel und Flächen-Token im Fundament

A1 Festlegung 4 gibt den Weg vor: tokens.ts bekommt die Staffel, antdToken()
nimmt sie als Parameter, rollen.css spiegelt sie. A2 baut den Träger, nicht
die Umschaltung — die ist B5.

LFH-328"
```

---

### Task 2: Statusfarb-Vertrag `theme/statusFarben.ts` + `StatusTag`

**Files:**
- Create: `frontend/src/theme/statusFarben.ts`
- Create: `frontend/src/theme/statusFarben.test.ts`
- Create: `frontend/src/components/StatusTag.tsx`
- Create: `frontend/src/components/StatusTag.test.tsx`

**Interfaces:**
- Consumes: `Dichte`/`Farbrollen` aus Task 1 nicht nötig; die Rollen-**Namen** aus
  `theme/tokens.ts` und `pages/lage-dashboard/lagebild.ts:45` (`Dringlichkeit`).
- Produces:

```ts
export type Statusrolle = 'alarm' | 'achtung' | 'normal' | 'neutral' | 'bedien' | 'marke';

/** Zweiter Kanal ist Pflicht (WCAG 1.4.1) — `label` trägt ihn immer. */
export interface StatusDarstellung {
  rolle: Statusrolle;
  label: string;
  form?: 'dreieck' | 'kreis' | 'balken';
}

export const statusKategorie: Record<StatusKategorie, StatusDarstellung>;
export const verfuegbarkeit: Record<Verfuegbarkeit, StatusDarstellung>;
export const etbTyp: Record<EtbTyp, StatusDarstellung>;
export const uhsStatus: Record<UhsStatus, StatusDarstellung>;
export const uhsTyp: Record<UhsTyp, StatusDarstellung>;
export const brStatus: Record<BrStatus, StatusDarstellung>;
export const belegungsArt: Record<BelegungsArt, StatusDarstellung>;
/** Objektsignatur auf der Karte — `keine` ist bewusst `alarm` (unbewertet = vorsichtshalber Gefahr). */
export const warnstufeKarte: Record<Warnstufe, StatusDarstellung>;
/** Verdichtung im Lagebild — `keine` ist `normal`. Siehe Spec §1.3. */
export const warnstufeKennzahl: Record<Warnstufe, StatusDarstellung>;

/** Übersetzt eine Rolle in den antd-Tag-Farbwert des aktiven Modus. */
export function rollenFarbe(rolle: Statusrolle, token: GlobalToken): string;
```

**Der Kopfkommentar der Datei ist Teil des Vertrags** und nennt die Grenze wörtlich (Spec §1.3):
`status_farbe` aus der DB ist mandantengepflegter Freitext ohne Format-Check im Backend
(`src/routes/fahrzeug_status.rs`, `personal_status.rs`); der Vertrag deckt die **Fallback**-Achse,
nicht die DB-Achse.

- [ ] **Step 1: Failing test** — `frontend/src/theme/statusFarben.test.ts`

```ts
import { describe, expect, it } from 'vitest';
import * as sf from './statusFarben';

describe('Statusfarb-Vertrag', () => {
  it('gibt jedem Eintrag einen zweiten Kanal (WCAG 1.4.1)', () => {
    const alle = [sf.statusKategorie, sf.verfuegbarkeit, sf.etbTyp, sf.uhsStatus,
                  sf.uhsTyp, sf.brStatus, sf.belegungsArt,
                  sf.warnstufeKarte, sf.warnstufeKennzahl];
    for (const map of alle) {
      for (const [schluessel, d] of Object.entries(map)) {
        expect(d.label, `${schluessel} ohne Text`).toBeTruthy();
      }
    }
  });

  it('hält die zwei Warnstufen-Lesarten getrennt — der Widerspruch ist benannt, nicht zufällig', () => {
    expect(sf.warnstufeKarte.keine.rolle).toBe('alarm');
    expect(sf.warnstufeKennzahl.keine.rolle).toBe('normal');
  });

  it('nutzt keine gesättigte Farbe für den Normalzustand (ASM, A1 Festlegung 5)', () => {
    expect(sf.uhsStatus.aktiv.rolle).toBe('normal');
    expect(sf.statusKategorie.verfuegbar.rolle).toBe('normal');
  });
});
```

- [ ] **Step 2: Fehlschlag bestätigen** — Run wie Task 1 Step 2, Expected: FAIL (Modul fehlt).

- [ ] **Step 3: `statusFarben.ts` schreiben.** Werte je Enum aus dem gemessenen Bestand
  übernehmen (Spec §1.3-Tabellen), **auf Rollen abbilden**, nicht auf antd-Preset-Namen.
  Divergenz `gebunden` (heute `'gold'` in `KraefteuebersichtPage`, `'orange'` in vier anderen
  Maps) wird zu **einer** Zeile: `gebunden → achtung`.

- [ ] **Step 4: `StatusTag.tsx`** — `<Tag>` mit `rollenFarbe(d.rolle, token)`, Text `d.label`,
  optional das Formzeichen. Kein `size="small"`. Props:
  `{ darstellung: StatusDarstellung; title?: string }`.

- [ ] **Step 5: `StatusTag.test.tsx`** — belegt, dass der Text **immer** gerendert wird (auch
  wenn nur die Farbe gesetzt wäre) und dass zwei verschiedene Rollen unterscheidbare Ausgaben
  erzeugen. **Falle:** antd-Farbklassen sind im Test nicht eindeutig (`.ant-tag-green` &Co.) —
  über den Textinhalt und `toHaveStyle`/Attribut prüfen, nicht über die Klasse.

- [ ] **Step 6: Tests grün, committen** (Message: „feat(lfh-328): Statusfarb-Vertrag mit
  erzwungenem zweitem Kanal").

---

### Task 3: Rot auseinandersortieren — Gate 5 grün machen

**Files:**
- Modify: `frontend/src/einsatz/IconRail.tsx:33` (→ **Bedienung**, `token.colorPrimary`)
- Modify: `frontend/src/index.css:59` (→ **Bedienung**, `var(--lfh-bedien)`; den irreführenden
  Kommentar :56-57 mitziehen — er behauptet „colorPrimary" und meint Rot)
- Modify: `frontend/src/components/BenutzerMenu.tsx:14` (→ **Marke**)
- Modify: `frontend/src/components/Markdown.css:6` und `:14-20` (→ **Marke**; der
  Dunkelmodus-Sonderfall für `--md-akzent` entfällt, A0 liefert beide Werte)
- Modify: `frontend/src/pages/lagekarte/marker.ts:36-37` (Einsatzort → **Marke**,
  `UHS_FARBE #1677ff` → **Bedienung**)
- Modify: `frontend/src/pages/lagekarte/zonenStil.ts:51-59` (`WARNSTUFE_KARTE` → Task 2)
- Test: `frontend/src/theme/gate5.guard.test.ts` (neu)

**Interfaces:**
- Consumes: `warnstufeKarte`, `rollenFarbe` aus Task 2; `farbenHell`/`farbenDunkel` aus `tokens.ts`.

**`IconRail.tsx:33` ist der wichtigste Fall** — eine Bedienfläche in Gefahrenrot, genau das, was
„Rot bedient nichts" meint. Der Task ordnet sie unter „Marke" ein; das ist gegen HEAD falsch
(Spec §1.2). Dabei mitziehen (Norm auf Angefasstes): `borderRadius: 6` → `form.radiusSteuer`,
`color: '#fff'` und `rgba(255,255,255,0.65)` → Rollen.

**`marker.ts`/`zonenStil.ts` sind Kartenstil-Module** — sie erzeugen MapLibre-`paint`-Werte, keine
DOM-Styles, und haben keinen `useToken`-Zugang. Sie lesen die Rollen deshalb direkt aus
`farbenHell`/`farbenDunkel` über den aktiven Modus, den die aufrufende Ebene kennt. **Nicht** über
`document.documentElement.dataset.theme` raten.

- [ ] **Step 1: Gate-5-Guard als Test schreiben** — `frontend/src/theme/gate5.guard.test.ts`,
  Muster von `schreibrecht.guard.test.ts` (`import.meta.glob('/src/**/*', {query:'?raw', eager:true})`,
  zeilenweiser Scan, Sammelliste, `expect(verstoesse, <Handlungsanweisung>).toEqual([])`).
  Er scannt **auch `.css`** — die Hälfte der Fundstellen sind CSS-Dateien. Ausnahmen: alles unter
  `/src/theme/`, `*.test.*`, `*.generated.*`, Kommentarzeilen.
  **Der Kopfkommentar nennt die bekannte Grenze:** rgba-getarnte Werte (`rgba(22,119,255,.06)`
  in `Sidebar.tsx:462`, `,.5`-Kurznotation in `bildHandles.ts`) entgehen dem Hex-Scan — das ist
  Teil des Vertrags, nicht Beiwerk.

- [ ] **Step 2: Test laufen lassen** — Expected: **FAIL mit 6 Verstößen** (die lebenden Stellen
  aus Spec §1.2). Das ist der Beweis, dass der Guard greift.

- [ ] **Step 3: Die sechs Stellen umstellen**, jede nach ihrer Zuordnung aus Spec §1.2.

- [ ] **Step 4: Test grün** + `rtk proxy` auf das Gate-5-Kommando aus den Global Constraints.

- [ ] **Step 5: Vitest der berührten Bereiche**

Run: `… vitest run src/pages/lagekarte/ src/einsatz/ src/components/ src/theme/`
Expected: PASS. `useLagekarteDaten.test.tsx:107-108` pinnt die Zonenfarbe — die Erwartung zieht
auf den Rollenwert mit, das ist eine gewollte Änderung und keine Reparatur.

- [ ] **Step 6: Committen** („fix(lfh-328): Rot ist Marke oder Gefahr, nie Bedienung").

---

# Phase 2 — Primitive

### Task 4: `FeldLabel`

**Files:**
- Create: `frontend/src/components/FeldLabel.tsx` + `.test.tsx`
- Modify: `frontend/src/pages/lagekarte/Inspector.tsx:107-130`
- Modify: `frontend/src/pages/lagekarte/ZonenInspector.tsx:106`
- Modify: `frontend/src/pages/lagekarte/AnsichtZuordnung.tsx:24-27`

**Interfaces:**
- Produces: `export default function FeldLabel({ text, htmlFor, children }: { text: string; htmlFor?: string; children: ReactNode })`
  — rendert ein echtes `<label>`, darin die Beschriftung in der Metadaten-Stimme aus E
  (gesperrte Versalien `form.versalSperrung`, `token.fontSizeSM`, `token.colorTextSecondary`),
  darunter `children`.

Von den drei Bauweisen gewinnt die **Inspector-Variante ihre `<label>`-Assoziation** (die einzige
korrekte) und die **Token-Farbe der anderen beiden**. Der hartkodierte `rgba(0,0,0,0.45)`-Wert
(`Inspector.tsx:109`/`:120`) verschwindet damit — er ist der im Task genannte Dunkelmodus-Defekt.

- [ ] **Step 1** Test: rendert ein `<label>`, dessen Accessible Name den Text enthält; setzt
  keine hartkodierte Farbe (`style` enthält kein `rgba(`/`#`).
- [ ] **Step 2** Fehlschlag bestätigen.
- [ ] **Step 3** Komponente schreiben.
- [ ] **Step 4** Die drei Stellen umziehen. **Vorsicht:** die Selects tragen heute `aria-label`;
  mit einem echten `<label>` entsteht sonst eine doppelte Benennung — `aria-label` an diesen
  Stellen entfernen, wenn das `<label>` es trägt.
- [ ] **Step 5** `vitest run src/pages/lagekarte/ src/components/FeldLabel.test.tsx` — die
  bestehenden `Inspector.test.tsx`/`ZonenInspector.test.tsx` müssen grün bleiben.
- [ ] **Step 6** Committen.

---

### Task 5: `GeoKennzahlen`

**Files:**
- Create: `frontend/src/components/GeoKennzahlen.tsx` + `.test.tsx`
- Modify: `frontend/src/pages/lagekarte/Inspector.tsx:96-104`
- Modify: `frontend/src/pages/lagekarte/FachebenenInspector.tsx:17-28` (lokale
  `GeoKennzahlenBlock`-Komponente entfällt)
- Modify: `frontend/src/pages/lagekarte/ZonenInspector.tsx:16-23` (`KennzahlZeile`) und `:64-94`
- Modify: `frontend/src/pages/lagekarte/AnsichtSwitcher.tsx:186` — nur `Space direction=` →
  `orientation=` (letzte verbliebene Stelle im Frontend; **kein** GeoKennzahlen-Kandidat)

**Interfaces:**
- Consumes: `geoKennzahlen`, `formatFlaeche`, `formatLaenge` aus `pages/lagekarte/geo.ts` —
  **unverändert**. Die Vereinheitlichung mit `anzeige/format.ts:formatDistanz` ist verboten
  (Global Constraints).
- Produces: `export default function GeoKennzahlen({ kennzahlen, zusatz }: { kennzahlen: GeoKennzahlenWerte | null; zusatz?: ReactNode })`

`ZonenInspector` nutzt `KennzahlZeile` **über** die Geo-Werte hinaus (Warnstufe, Zonen-Anzahl) —
dafür ist der `zusatz`-Slot da, sonst müsste die Seite zwei Layouts mischen. Zahlen tragen
`tabular-nums` in `schrift.zahl` (Signatur-Element 3 aus A0).

- [ ] **Step 1** Test: rendert Fläche/Umfang/Länge nur, wenn vorhanden; die Zahl steht in der
  Zahlenschrift mit `font-variant-numeric: tabular-nums`.
- [ ] **Step 2** Fehlschlag bestätigen.
- [ ] **Step 3** Komponente schreiben (eine Form — die `Descriptions`-Variante der zwei
  Inspektoren oder die Flex-Variante des dritten; **entscheide für die Flex-Variante**, weil sie
  den `zusatz`-Fall trägt und `Descriptions size="small"` gegen Gate 4 läuft).
- [ ] **Step 4** Die drei Stellen umziehen + die `direction`→`orientation`-Zeile.
- [ ] **Step 5** `vitest run src/pages/lagekarte/ src/components/GeoKennzahlen.test.tsx`.
- [ ] **Step 6** Committen.

---

### Task 6: `EinsatzSeite` (Seitenkopf-Primitiv)

**Files:**
- Create: `frontend/src/components/EinsatzSeite.tsx` + `.test.tsx`
- Modify: `frontend/src/theme/sprache.css` (Akzentstrich-Klasse, falls nicht vorhanden)

**Interfaces:**
- Produces: `export default function EinsatzSeite({ titel, beschreibung, breadcrumb, aktionen, hinweis, breite, children })`
- Consumes: `SektionHeader` (für Sektionen **innerhalb** der Seite), `flaeche.seiteSchmal`.

**Vertrag, wörtlich von `AdminPage` übernommen (inkl. Falle):** der `aktionen`-Slot wird
**außerhalb jedes `<Form>`** gerendert. Ein Speichern-Button dort trägt **kein**
`htmlType="submit"`, sondern verdrahtet über `form.submit()`. `AdminPage.test.tsx:28` pinnt das;
`EinsatzSeite` bekommt denselben Test.

**Überschriftenebene:** H4, wie `AdminPage`. Im eigenen Test gepinnt
(`expect(heading.tagName).toBe('H4')`). `AdminPage.test.tsx:21` **nicht** anfassen.

**Die begründete Abweichung von der Referenzseite** (AC 11): `EinsatzSeite` behält den
`titel`-Slot, obwohl A0 auf dem Lage-Dashboard die Seitenüberschrift entfernt hat — Begründung
in Spec §3.1 (Dashboard hat ein Instrumentenband, Modul-Arbeitsseiten haben keins).
**`EinsatzSeite` wird nicht auf das Lage-Dashboard angewandt.**

- [ ] **Step 1** Test: rendert Titel (H4), Beschreibung, Breadcrumb, Aktionen, Hinweis, Children;
  zweiter Test nach dem Muster `AdminPage.test.tsx:28` (Header-Button löst `form.submit()` aus);
  dritter Test: genau **eine** Primäraktion (`type="primary"`) im `aktionen`-Slot ist erlaubt —
  mehr bricht (der Task verlangt „genau eine Primäraktion, rechts").
- [ ] **Step 2** Fehlschlag bestätigen.
- [ ] **Step 3** Komponente schreiben, Akzentstrich als Signatur.
- [ ] **Step 4** Tests grün.
- [ ] **Step 5** Committen.

---

### Task 7: Zustands-Primitive `SeitenSkeleton` und `SeitenFehler`

**Files:**
- Create: `frontend/src/components/SeitenZustand.tsx` (beide Exporte) + `.test.tsx`
- Modify: `frontend/src/pages/EinsatzdatenPage.tsx:77-85`
- Modify: `frontend/src/pages/EinsatzEinstellungenPage.tsx:127-135`
- Modify: `frontend/src/pages/einstellungen/EinsatzDefaults.tsx:75-84`
- Modify: `frontend/src/pages/einstellungen/AnzeigeEinstellungen.tsx:72-81`

**Interfaces:**
- Produces: `export function SeitenSkeleton({ zeilen }: { zeilen?: number })` — Skelettbalken in
  Kachelform (A0-Referenzseite `.lfh-skelett`), **nicht** ein drehender `Spin`;
  `export function SeitenFehler({ text, onWiederholen }: { text: string; onWiederholen?: () => void })`.
- Consumes: `flaeche.zustandOben`.

**Der Fehler-Zweig gehört mit dazu:** an allen vier Stellen steht direkt unter dem `Spin` ein
byte-gleiches `<Alert type="error" …>`. Das Ladebild ohne das Fehlerbild zu extrahieren ließe die
Hälfte der Duplikation stehen.

**Baseline, die Baseline bleibt** (Spec §5): 32 `paddingTop: 80`-Stellen + 8 Ausreißer. A2 zieht
die **4** genannten um; der Rest ist **B3**. `SeitenZustand.tsx` trägt diesen Satz im
Kopfkommentar samt Zielticket, damit der nächste Leser nicht denkt, jemand habe schlampig
gearbeitet.

- [ ] **Step 1** Test: `SeitenSkeleton` rendert `aria-busy` und **kein** „Laden…"-Textduplikat;
  `SeitenFehler` rendert `role="alert"`, den Text und — falls `onWiederholen` gesetzt — einen
  Knopf, dessen Klick den Callback feuert.
- [ ] **Step 2** Fehlschlag bestätigen.
- [ ] **Step 3** Komponente schreiben.
- [ ] **Step 4** Die vier Seiten umziehen. **Norm auf Angefasstes:** diese vier Dateien dabei
  vollständig ziehen — Seitenkopf auf `EinsatzSeite`/`SektionHeader`, `size="small"` auf 0.
- [ ] **Step 5** `vitest run src/pages/ src/components/SeitenZustand.test.tsx`.
- [ ] **Step 6** Committen.

---

# Phase 3 — Konsumenten

### Task 8: Statusfarb-Konsumenten auf den Vertrag ziehen

**Files (alle Modify):** `pages/KraefteuebersichtPage.tsx:32` · `stammdaten/StatusKatalogTab.tsx:14,19` ·
`stammdaten/PersonalStatusTab.tsx:14,19` · `etb/typFarben.ts` (Datei entfällt, Konsumenten
`etb/EtbTabelle.tsx:59`, `etb/Schnellerfassung.tsx:32`, `etb/EtbFilterleiste.tsx:13`,
`stammdaten/EtbBausteinFormModal.tsx:87`, `stammdaten/EtbBausteineTab.tsx:30`) ·
`pages/uhs/BewegungenTab.tsx:10,16` · `pages/uhs/Grundriss.tsx:24` · `pages/EinsaetzePage.tsx:12` ·
`pages/UnfallhilfsstellenPage.tsx:14,21` · `pages/uhs/UhsSwitcher.tsx:12` ·
`pages/uhs/UhsDetailPage.tsx:19` · `pages/uhs/UhsAnlegenDrawer.tsx:9` ·
`pages/bereitstellungsraum/BereitstellungsraeumePage.tsx:17` ·
`pages/bereitstellungsraum/BrDetailPage.tsx:17` · `pages/FahrzeugePage.tsx:22,30` ·
`pages/PersonalPage.tsx:23,31` · `pages/lage-dashboard/lagebild.ts:93,101`

**Interfaces:**
- Consumes: alles aus Task 2.

**Drei Stellen brauchen Sorgfalt:**

1. **`UhsSwitcher.tsx:12` trägt ein `rang`-Feld** für die Sortierung, das die vier anderen
   Kopien nicht haben. Die Sortierung ist **fachliche Reihenfolge, keine Darstellung** — sie
   bleibt lokal in `UhsSwitcher`, nur Label und Farbe kommen aus dem Vertrag.
2. **`FahrzeugePage:30` / `PersonalPage:31`** lesen `status_farbe` aus der DB und nutzen die Map
   nur als Fallback (`ef.status_farbe ?? KATEGORIE_FALLBACK[…]`). **Dieser Ausdruck bleibt
   stehen** — nur der Fallback-Zweig zieht auf den Vertrag. Das ist die Vertragsgrenze aus
   Spec §1.3, nicht eine übersehene Stelle.
3. **`lagebild.ts:93` `WARNSTUFE_STUFE`** wird zu einer Ableitung aus `warnstufeKennzahl` statt
   einer zweiten Liste — sonst entsteht die sechste Migrationsklasse.

- [ ] **Step 1** Für jede Datei zuerst den bestehenden Test lesen; wo einer die Farbe pinnt,
  die Erwartung auf den Rollenwert ziehen (gewollte Änderung, keine Reparatur).
- [ ] **Step 2** Maps ersetzen, `<Tag color=…>` durch `<StatusTag>` — dabei überall den **Text**
  mitliefern: `EinsaetzePage:56` und `Grundriss:162` rendern heute den **rohen Enum-String** als
  Tag-Inhalt (`{e.status}`), das wird ein echtes Label.
- [ ] **Step 3** AC-Grep prüfen:
  `rtk proxy grep -rn "KATEGORIE_FARBEN\|KAT_FARBE\|STATUS_META\|STATUS_LABEL\|UHS_TYP_LABEL" --include="*.tsx" --include="*.ts" frontend/src | grep -v .test. | grep -v theme/statusFarben.ts`
  — **eingeschränkt auf die Vertrags-Enums** (Spec AC 5): `STATUS_META` in `personMeta`,
  `schadenHelfer`, `MaterialPage`, `TierePage`, `TiereDetailPage` bleibt stehen und ist **kein**
  Verstoß.
- [ ] **Step 4** `vitest run src/` (voller Lauf, dieser Task hat den größten Blast-Radius).
- [ ] **Step 5** Committen.

---

### Task 9: Optionslisten, `ModulEinstellungsListe`, `EinsatzEinstellungenPage`

**Files:**
- Create: `frontend/src/pages/einstellungen/optionen.ts`
- Create: `frontend/src/pages/einstellungen/ModulEinstellungsListe.tsx` + `.test.tsx`
- Modify: `frontend/src/pages/EinsatzEinstellungenPage.tsx` (Blöcke :20-49, :281, :323, :399, :420-485)
- Modify: `frontend/src/pages/einstellungen/AnzeigeEinstellungen.tsx:17-39`
- Modify: `frontend/src/pages/einstellungen/EinsatzDefaults.tsx:23-28, :180-215`

**Gemessene Faktenlage:** die Optionsblöcke sind **byte-identisch** — es gibt keine subtile
Wertabweichung, die man beim Zusammenziehen verlieren könnte. Die Divergenz sitzt woanders:

- **Placeholder**: `EinsatzEinstellungenPage` sagt „(Standard)", `AnzeigeEinstellungen` sagt
  „(Fallback)". Das ist **fachlich richtig so** — die eine Seite erbt von der Org, die andere
  *ist* die Org-Ebene. Der Placeholder bleibt an der Aufrufstelle, nur die Optionen wandern.
- **Dritte Kopie**: `command-palette/befehle.ts:24-30` (`KOORD_BEFEHLE`) hat dieselben fünf
  Werte mit **anderen Labels** („WGS84 (Dezimalgrad)" vs. „WGS84 dezimal"). **Nicht in A2
  auflösen** — die Labels sind für den Palettenkontext geschrieben. Als Befund erfasst (Spec §5).

`ModulEinstellungsListe` braucht die Unterschiede beider Aufrufer als Props: Spaltenzahl (3 vs. 2),
`Sichtbar`-Switch (nur EEP), Org-Erb-Hinweis unter dem Select (nur EEP), unterschiedliche
Disable-Gates und Mutations-Payloads.

- [ ] **Step 1** Test für `ModulEinstellungsListe`: rendert mit `sichtbarSpalte` einen Switch je
  Modul, ohne sie nicht; feuert die Mutation mit dem erwarteten Payload.
- [ ] **Step 2** Fehlschlag bestätigen.
- [ ] **Step 3** `optionen.ts` + Komponente schreiben, beide Aufrufer umziehen.
- [ ] **Step 4** `EinsatzEinstellungenPage` auf `EinsatzSeite` + `SektionHeader` ziehen — die
  **6 rohen `Typography.Title`** und die drei `Typography.Paragraph style={{ marginTop: -8 }}`
  (:281, :323, :399) verschwinden dabei; ebenso `:476` (`var(--ant-color-text-secondary, …)`,
  der einzige lebende `var(--ant-*)`-Konsument) → `<Typography.Text type="secondary">`.
- [ ] **Step 5** `vitest run src/pages/`.
- [ ] **Step 6** Committen.

---

### Task 10: `EinsaetzePage` — Laden, Fehler, Leer

**Files:**
- Modify: `frontend/src/pages/EinsaetzePage.tsx:22-27, :64-107`
- Modify: `frontend/src/pages/EinsaetzePage.test.tsx`

**Gemessener Ist-Zustand:** `useQuery` destrukturiert nur `{ data, isLoading }` — `isError`,
`error`, `refetch` sind verfügbar und werden **nirgends** benutzt. `isLoading` wirkt nur im
`!darfAnlegen`-Zweig (`:72`), Anlegeberechtigte sehen während des Ladens eine leere Seite mit
nur dem Knopf. Das Karten-Raster ist rohes CSS-Grid, **zweimal mit verschiedenen Werten**
(`minmax(260px…)` gap 16 für aktive, `minmax(220px…)` gap 12 für abgeschlossene).

- [ ] **Step 1: Drei failing tests** — je ein eigener Test, unterscheidbar gerendert:

```tsx
it('zeigt beim Laden Karten-Skeletons und noch keinen Anlegen-Knopf', async () => {
  // MSW: /api/einsaetze verzögert (delay), /api/auth/me = admin
  // erwartet: Skeleton sichtbar, queryByRole('button', {name:/Neuer Einsatz/}) === null
});

it('zeigt bei einem Fehler einen Alert mit Wiederholen-Aktion', async () => {
  // MSW: /api/einsaetze -> 500
  // erwartet: role="alert", Knopf "Erneut versuchen", Klick löst refetch aus
});

it('zeigt bei leerer Liste den Empty-Zustand, auch für Anlegeberechtigte', async () => {
  // MSW: /api/einsaetze -> []
  // erwartet: Empty sichtbar UND der Anlegen-Knopf sichtbar
});
```

**Setup-Muster der Datei übernehmen:** MSW (`test/server`) + `renderMitProviders`. Achtung, die
Datei wickelt heute einen **zweiten** `AuthProvider` um die Seite, obwohl `renderMitProviders`
selbst schon einen rendert — beim Anfassen bereinigen.

- [ ] **Step 2** Fehlschlag bestätigen (alle drei rot).
- [ ] **Step 3** Umbauen: `isPending`/`isError`/`refetch` destrukturieren; bei `isPending`
  Skeletons **im selben Raster** (gleiche Kachelhöhe → CLS klein, Prüflistenzeile 12);
  bei `isError` `SeitenFehler` mit `onWiederholen={() => refetch()}`; den Anlegen-Knopf erst
  nach Auflösung des Ladezustands zeigen. Die zwei Rasterdefinitionen auf `flaeche.kachelMin`/
  `kachelMinKlein` und `abstand` ziehen.
- [ ] **Step 4** Tests grün, die 5 bestehenden Tests der Datei bleiben grün.
- [ ] **Step 5** Committen.

---

### Task 11: Sackgasse im Modul „Stab"

**Files:**
- Modify: `frontend/src/components/Platzhalter.tsx`
- Modify: `frontend/src/einsatz/ModulPanel.tsx:62` (das 🚧-`<span>` hat nur `title`, **kein**
  `aria-label` — der Emoji-Text landet im Accessible Name des Buttons)
- Test: `frontend/src/components/Platzhalter.test.tsx`

**Entscheidung zwischen den zwei vom Task angebotenen Wegen:** `Result status="info"` mit
Erwartungshorizont und Primärknopf zurück auf das Standardmodul — **nicht** den Eintrag
ausblenden. Grund: `stab` ist über `App.tsx:141` als Route erreichbar und in
`App.test.tsx:62` gepinnt; ein ausgeblendeter Navigationseintrag ließe die Route als
unerreichbare Sackgasse zurück, statt sie aufzulösen. Die Kommandopalette filtert `status !== 'fertig'`
bereits (`befehle.ts:38`) — diese Asymmetrie bleibt bewusst: die Palette ist ein Schnellzugriff
für Arbeitsfähiges, die Rail zeigt den Modulbestand.

Das Ziel des Rückweg-Knopfes ist `aufloeseStandardModul(einstellungen?.standard_modul)`
(`einsatz/modulRegistry.ts:152`), **nicht** ein hartkodiertes `/etb`.

- [ ] **Step 1** Test: `Platzhalter` rendert einen Knopf, dessen Klick auf das aufgelöste
  Standardmodul navigiert; der Erwartungshorizont-Text ist sichtbar.
- [ ] **Step 2** Fehlschlag bestätigen.
- [ ] **Step 3** Umbauen. Der zweite Konsument `pages/ProfilPage.tsx:236` muss weiter
  funktionieren — der Rückweg-Slot ist optional.
- [ ] **Step 4** `vitest run src/components/ src/einsatz/ src/App.test.tsx`.
- [ ] **Step 5** Committen.

---

### Task 12: `PersonVerlauf` extrahieren

**Files:**
- Create: `frontend/src/personen/PersonVerlauf.tsx` + `.test.tsx`
- Modify: `frontend/src/personen/PersonDetailDrawer.tsx:19-64`
- Modify: `frontend/src/pages/PersonenDetailPage.tsx:305-372` (**`pages/`**, nicht `personen/`)

**Gemessene Unterschiede der beiden Kopien** — der Vertrag der neuen Komponente ist die
DetailPage-Variante:

| | Drawer | DetailPage | Ziel |
|---|---|---|---|
| Zeitstempel | roher Wire-String `{e.at}` | `<ZeitAnzeige format="dtgVoll" />` | `ZeitAnzeige` |
| Position der Zeit | unter dem Eintrag | vor dem Eintrag | vor dem Eintrag |
| Leer-Text | „noch kein Verlauf" | „ noch leer" | „noch kein Verlauf" |
| `<li>`-Trennlinie | `1px solid #f0f0f0` | identisch hart | `token.colorSplit` |

**Mitzunehmen (Norm auf Angefasstes):** `PATIENT_SK`, `istPatient` und `kurzVerbleib` existieren
dreifach — `personen/personMeta.ts:6` exportiert `PATIENT_SK` bereits, Drawer und DetailPage
definieren beide lokal neu. Beim Anfassen auf `personMeta` ziehen.

- [ ] **Step 1** Test: rendert Sichtungen, Notizen und Verbleib chronologisch (neueste zuerst);
  der Zeitstempel ist **kein** ISO-String (`expect(text).not.toMatch(/\d{4}-\d{2}-\d{2}T/)`).
- [ ] **Step 2** Fehlschlag bestätigen.
- [ ] **Step 3** Komponente schreiben, beide Stellen umziehen.
- [ ] **Step 4** `vitest run src/personen/ src/pages/PersonenDetailPage.test.tsx`.
- [ ] **Step 5** Committen.

---

### Task 13: `darfVerwaltung` + Guard-Test

**Files:**
- Modify: `frontend/src/einsatz/schreibrecht.ts` (neue Funktion neben den bestehenden)
- Modify: `frontend/src/components/AppLayout.tsx:29-31,42`
- Modify: `frontend/src/admin/AdminLayout.tsx:11-13,37`
- Modify: `frontend/src/command-palette/befehle.ts:84`
- Create: `frontend/src/einsatz/verwaltungsrecht.guard.test.ts`

**Interfaces:**
- Produces: `export function darfVerwaltung(benutzer?: BenutzerVerwaltungskontext): boolean` —
  `system_rolle === 'admin' || org_rolle === 'fuehrungskraft'`.

**Achtung, `schreibrecht.ts` hat eine dokumentierte Zwei-Achsen-Trennung:** die Datei kennt heute
**nur** die Einsatz-Achse und enthält keinen `org_rolle`-Begriff. `darfVerwaltung` ist die
**Org-Achse** — sie kommt in dieselbe Datei (der Task verlangt es: „neben `einsatz/schreibrecht.ts`
heben"), aber mit einem eigenen Typ `BenutzerVerwaltungskontext = Pick<BenutzerAnzeige, 'system_rolle' | 'org_rolle'>`
und einem Kommentar, der die Achse benennt — sonst weicht die dokumentierte Trennung auf.

**Gemessen existiert die Formel dreimal:** `AppLayout.tsx:30` (privat), `AdminLayout.tsx:11`
(exportiert, wird von AppLayout **nicht** importiert), `EinsaetzePage.tsx:22` (byte-gleich,
anderer Name `darfAnlegen`). A2 löst die ersten beiden; `EinsaetzePage:22` zieht mit, weil
Task 10 die Datei ohnehin öffnet.

**Was der Guard NICHT scannt** (im Kopfkommentar zu nennen, wie es
`schreibrecht.guard.test.ts:13-14` vormacht): die 24 inline `system_rolle === 'admin'`-Stellen.
Sie sind legitime **System**-Admin-Gates (Stammdaten, Karten), keine Verwaltungs-Gates. Der
Guard sucht die **Kombination** `org_rolle`-Vergleich zusammen mit `system_rolle`-Vergleich —
das ist die Formel, die dupliziert wurde.

- [ ] **Step 1** Guard-Test schreiben, Muster `schreibrecht.guard.test.ts` (raw-glob,
  zeilenweiser Scan, Sammelliste mit Handlungsanweisung). **Er muss bei den heutigen 3 Stellen
  fehlschlagen** — das beweist, dass er greift.
- [ ] **Step 2** Fehlschlag mit 3 Verstößen bestätigen.
- [ ] **Step 3** `darfVerwaltung` schreiben, die drei Stellen umziehen, `befehle.ts:84` aufrufen.
- [ ] **Step 4** Guard grün; `vitest run src/einsatz/ src/components/ src/admin/ src/command-palette/`.
- [ ] **Step 5** Committen.

---

### Task 14: Magische Pixel in `Liste.tsx` + hartkodierte Restfarben

**Files:**
- Modify: `frontend/src/components/Liste.tsx:66, :135`
- Modify: `frontend/src/pages/lagekarte/Sidebar.tsx:218, :393, :462`

**`Liste.tsx`**: `headerPaddingInline = bordered ? (size === 'small' ? 16 : 24) : 0` (:66) und
`paddingInline = size === 'small' ? 16 : bordered ? 24 : 0` (:135) → `token.paddingContentHorizontalSM`
/ `token.paddingContentHorizontal`. Damit ziehen die 10 Konsumenten bei einer Dichteumschaltung mit.

**Blindfleck, der zu schließen ist:** kein Liste-Test berührt heute `size`, `bordered` oder einen
Abstandswert. Ein Test, der die beiden Werte aus dem Token liest statt sie zu pinnen, ist
wertlos — stattdessen prüfen, dass **kein numerisches Literal** mehr im Padding-Ausdruck steht
(die Zeile ist über den Guard aus Task 3 nicht erreichbar, weil sie keine Farbe ist).
Pragmatisch: die zwei Zeilen im Vitest über `getComputedStyle` in beiden `size`-Varianten
vergleichen — jsdom liefert Inline-Styles zurück, das reicht für „unterschiedlich und aus Token".

**`Sidebar.tsx:462`** ist `rgba(22,119,255,.06)` = `#1677ff` in rgba-Schreibweise und fällt durch
jedes Hex-Grep — die Stelle nur deshalb hier explizit gelistet.

- [ ] **Step 1** Test für `Liste` (size-Varianten erzeugen unterschiedliches Padding).
- [ ] **Step 2** Fehlschlag bestätigen (heute identisch/hart).
- [ ] **Step 3** Umbauen.
- [ ] **Step 4** AC-Grep: in den angefassten Dateien `grep -cE "rgba\(0,0,0,0\.|#f0f0f0|#1677ff"` = 0.
- [ ] **Step 5** `vitest run src/components/ src/pages/lagekarte/`.
- [ ] **Step 6** Committen.

---

# Phase 4 — Nachweis

### Task 15: Norm auf alle angefassten Dateien anwenden (AC 7)

**Files:** alle in Task 3–14 geänderten Dateien, die noch einen rohen `Typography.Title`,
ein `size="small"` oder eine Inline-Farbe tragen.

Dies ist **kein Sweep** — es ist die Spec-§7.1-Auslegung: wer eine Datei geöffnet hat, macht
sie fertig. Erwartete Menge: `EinsatzEinstellungenPage` · `EinsatzDefaults` ·
`AnzeigeEinstellungen` · `EinsatzdatenPage` · `EinsaetzePage` · `UnfallhilfsstellenPage` ·
`uhs/UhsDetailPage` · `bereitstellungsraum/BereitstellungsraeumePage` ·
`bereitstellungsraum/BrDetailPage` · `KraefteuebersichtPage` · `PersonenDetailPage`.

- [ ] **Step 1** `git diff --name-only main...HEAD -- 'frontend/src/**'` → Arbeitsliste.
- [ ] **Step 2** Je Datei: `grep -n "Typography.Title\|size=\"small\"\|#[0-9a-fA-F]\{3,8\}" <datei>`.
- [ ] **Step 3** Umziehen, Datei für Datei, mit je einem Commit.
- [ ] **Step 4** AC prüfen:
  `rtk proxy grep -rl "SektionHeader\|EinsatzSeite" --include="*.tsx" frontend/src | grep -v .test. | wc -l` — **≥ 10**.
- [ ] **Step 5** Gate 4: `grep -rn 'size="small"' frontend/src --include='*.tsx' | wc -l` ≤ 236.

---

### Task 16: Mutationsprobe für das Exhaustivitäts-AC

**Files:** temporär `src/` (Rust) — **wird zurückgenommen**, nichts davon wird committet.

Das AC verlangt: „eine testweise hinzugefügte Enum-Variante lässt `scripts/check-typ-codegen.sh`
fehlschlagen". Ein handgeschriebenes lokales Union-Widening beweist **nichts** — die Varianten
kommen aus `types.generated.ts` und ändern sich nur über eine Rust-Änderung plus Regen.

- [ ] **Step 1** Eine Variante zu einem Vertrags-Enum in Rust hinzufügen (z. B. `UhsStatus`),
  Compilerfehler im Backend beheben, soweit nötig.
- [ ] **Step 2** `rtk proxy ./scripts/check-typ-codegen.sh` — regeneriert `openapi.json` und
  `types.generated.ts`, fährt `tsc`.
- [ ] **Step 3** **Erwartung: `tsc` schlägt fehl**, weil `Record<UhsStatus, StatusDarstellung>`
  in `statusFarben.ts` den neuen Schlüssel nicht hat. Die Fehlermeldung wörtlich festhalten.
- [ ] **Step 4** `git checkout -- .` + `check-typ-codegen.sh` erneut → grün. **Verifizieren, dass
  `openapi.json` und `types.generated.ts` wieder dem committeten Stand entsprechen**
  (`git status` sauber).
- [ ] **Step 5** Ergebnis in die Spec eintragen (§7 AC 4) — mit der echten Fehlermeldung, nicht
  mit einer Behauptung.

---

### Task 17: Gates, Prüfliste, Abschluss

- [ ] **Step 1** Alle Gates einzeln, jedes über `rtk proxy`, **kein `| tail`**:

```bash
# Gate 5 (A1) — muss 0 sein
rtk proxy grep -rniE '#(b02318|ff7a7f|f5b942|5cc48d|1c6640|7a5200|1a5fa0|6fb4ec|a8071a|e04552)' frontend/src | grep -v '/theme/'
# cssVar-Zweig „AUS"
rtk proxy grep -rn "var(--ant-color-" frontend/src | grep -v .test.
# Gate 4
rtk proxy grep -rn "controlHeight" frontend/src | grep -v '/theme/'
rtk proxy grep -rn 'size="small"' frontend/src --include='*.tsx' | wc -l    # ≤ 236
# AC 7
rtk proxy grep -rl "SektionHeader\|EinsatzSeite" --include="*.tsx" frontend/src | grep -v .test. | wc -l   # ≥ 10
```

- [ ] **Step 2** `mise exec pnpm@<ver> -- pnpm -C /Users/rubeen/dev/personal/lifeline-hub/frontend build`
  (rust-embed braucht `frontend/dist`, bevor `cargo test` läuft).
- [ ] **Step 3** `rtk proxy ./scripts/check-all.sh` — alle sieben Schritte.
- [ ] **Step 4** Die Prüfliste in Spec §6 gegen den **tatsächlich gebauten** Zustand
  nachziehen; Verdikte, die sich geändert haben, korrigieren.
- [ ] **Step 5** Spec-Nachträge committen: Mutationsprobe-Ergebnis, erreichte AC-Zahlen,
  Prüflisten-Korrekturen.
- [ ] **Step 6** LFH-315 schließen — A2 hat das Fokus-Token verankert (`colorPrimary = bedien`,
  blau), die Farbentscheidung selbst kam aus A0.

---

## Self-Review

**Spec-Abdeckung** — die 15 Task-Positionen gegen die Plan-Tasks:

| Task-Position | Plan |
|---|---|
| Token-Fundament vervollständigen | T1 |
| Statusfarb-Vertrag + `StatusTag` | T2, Konsumenten T8 |
| Rot auseinandersortieren | T3 |
| Hartkodierte Farben auf Tokens | T3 (Rot), T4 (Inspector-Labels), T14 (Sidebar), T12 (Trennlinien), T9 (`var(--ant-*)`) |
| cssVar-Weiche entscheiden | Spec §1.1 — **erledigt**, nicht mehr im Plan |
| `FeldLabel` | T4 |
| `GeoKennzahlen` + `direction`→`orientation` | T5 |
| `EinsatzSeite` | T6, Anwendung T9/T15 |
| Optionslisten + `ModulEinstellungsListe` | T9 |
| `SeitenSkeleton` | T7 (inkl. Fehler-Zweig) |
| Lade-/Fehlerzustand Einsatzliste | T10 |
| Sackgasse „Stab" | T11 |
| `PersonVerlauf` | T12 |
| `darfVerwaltung` + Guard | T13 |
| Magische Pixel `Liste.tsx` | T14 |

Kein Platzhalter, keine „TBD"-Schritte. Typkonsistenz: `StatusDarstellung`/`Statusrolle` aus T2
werden in T8 unter demselben Namen konsumiert; `flaeche` aus T1 in T7/T10; `SeitenFehler` aus T7
in T10.

**Reihenfolge-Abhängigkeiten:** T2 vor T3 (WARNSTUFE_KARTE) und vor T8. T1 vor T7. T6 vor T9/T15.
T7 vor T10. T16 nach T2. T15 und T17 zuletzt. T4, T5, T11, T12, T13, T14 sind untereinander
unabhängig und können parallel laufen — ihre Dateimengen sind disjunkt.
