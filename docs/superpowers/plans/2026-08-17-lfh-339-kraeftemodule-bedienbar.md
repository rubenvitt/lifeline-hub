# LFH-339 · C4 — Kräftemodule bedienbar machen

> **Für agentische Bearbeiter:** REQUIRED SUB-SKILL: `superpowers:executing-plans`.
> Schritte tragen Checkbox-Syntax (`- [ ]`).

**Ziel:** Der Statuswechsel der Kräfte-Module wird ein dichte-treues Bedienziel an der
Stelle, an der der Status schon steht; die Einheiten-Detailansicht bekommt eine eigene
Route und verliert den Platzhalter-Datensatz.

**Architektur:** Ein neues Primitiv `kraefte/StatusWahl.tsx` (Statusanzeige IST der
Auslöser, senkrechtes Menü im Portal) wird vom `status`-Slot der `Datensicht` als
**Deskriptor** konsumiert — nicht als `ReactNode`-Slot, damit das Primitiv Form, Höhe und
Trefffläche behält. Die drei Kräfteseiten tauschen ihr `<Select>` gegen dieses Primitiv.
Die Einheiten-Detailansicht zieht auf `/einsaetze/:id/einheiten/:einheitId`.

**Tech-Stack:** React 19, antd 6, TanStack Query 5, react-router 7, Vitest 4 + RTL,
Playwright.

**Spec:** `docs/superpowers/specs/2026-07-30-kraefte-listen-statuswechsel-zielform.md`
(Festlegungen Z1/Z2/Z3 — **sie gilt, wo das Ticket ihr widerspricht**, so ausdrücklich in
ihrem Kopf vermerkt).

---

## Global Constraints

Verbindlich für **jeden** Task. Verstöße brechen Gates, nicht nur den Geschmack.

- **Zielform des Statuswechsels** (Spec §3–§5): Auslöser **ist** die Statusanzeige;
  senkrechtes `Dropdown` mit `menu={{ items }}`, `trigger={['click']}`, `autoFocus`.
  **Kein** `Segmented`, **kein** `Popover`, **kein** neuer Drawer, **kein** zweiter
  Primäraktions-Slot.
- **Statusfarbe nur als Punkt/Rand/Beistrich, nie als Textfläche** (Spec §4b). Textlabel
  ist Pflicht (zweiter Kanal, WCAG 1.4.1). Farbwerte ausschließlich aus
  `theme/tokens.ts` / `theme/statusFarben.ts`.
- **Trefflächen kommen aus der Dichte-Staffel 30 / 48 / 72** (`controlHeight`), nicht aus
  der Zahl 44 des Ticket-AK. Präzedenz und Begründung:
  `e2e/trefflaeche-tablet.spec.ts:32-41` („Ein Test auf 44 wäre SCHWÄCHER als der
  Bestand"). Neues punktuelles `size="small"` auf interaktiven Elementen ist verboten.
- **Kein `responsive: ['lg']` am Spaltentyp** — antds eigenes `responsive` ist gesperrt,
  damit der Zähler ausgeblendeter Spalten eine Wahrheit hat. Projektachse ist `abBreite`.
- **Cache-Adressierung ausschließlich über `api/queryKeys.ts`** (`einsatzKeys.*` /
  `globalKeys.*`). Ein Inline-String-Array bricht `queryKeys.guard.test.ts`.
- **URL-Bau ausschließlich über `routing/deeplinks.ts`.** Kein Inline-Template-Literal.
- **Der zugängliche Name eines zeilenweisen Auslösers trägt die Zeilenkennung**
  („Status von Florian 44/1 ändern") — n Zeilen liefern sonst n gleichnamige Knöpfe.
- **Ein Emoji ist keine Ikone** — `@ant-design/icons` mit `aria-hidden`-Hülle.
- **Menü-Test greift immer über das GEÖFFNETE Menü:**
  `.ant-dropdown:not(.ant-dropdown-hidden) [role="menu"]` + `within`, Eintrag per
  **Teilstring** (ein antd-Icon im Eintrag trägt ein eigenes `aria-label`).
- **`pnpm lint` läuft mit `--max-warnings 0`.** `exhaustive-deps` strukturell lösen, kein
  pauschales `eslint-disable`.

**Gate-Kommando:** `./scripts/check-all.sh` (aus dem Worktree-Root).

---

## Was der Bestand schon kann — und deshalb NICHT gebaut wird

Gemessen am 2026-08-17 gegen `332307f2`. Das Ticket beschreibt einen Stand vor B1/B2/B4/B5.

| Ticketpunkt | Ist-Stand | Folge |
|---|---|---|
| M22 optimistisches Update + Rollback | vorhanden in allen drei Seiten (`onMutate` + `setQueryData` + `onError`-Rollback) | nur **Tests** fehlen (AK 3) → Task 3/4 |
| M23 Sortierung/Filter/Gruppierung | vorhanden über `Datensicht` (`gruppen`, `filter`, `suche`) | nichts zu tun |
| H20 Karten-Fallback / Breakpoint | vorhanden (`Datensicht form="auto"`, `useViewport`) | nichts zu tun |
| M21 Bemerkung sichtbar | vorhanden (`components/BemerkungZelle.tsx`, LFH-369) | nichts zu tun |
| AK „0 Treffer `size="small"`" | offen: `MaterialPage.tsx:49` (`InputNumber`). `MitgliederAbschnitt.tsx:129` sitzt an `KatalogTabelle` und ist nach CLAUDE.md **erlaubt** (Abstandsmaß, keine Trefffläche) | Task 5 |

---

## File Structure

**Neu**
- `frontend/src/kraefte/StatusWahl.tsx` — das Bedienziel: Statusanzeige als Auslöser +
  senkrechtes Menü. Eine Datei, eine Verantwortung.
- `frontend/src/kraefte/StatusWahl.test.tsx`
- `frontend/src/pages/EinheitDetailPage.tsx` — Vollseiten-Detail je Einheit.
- `frontend/src/pages/EinheitDetailPage.test.tsx`
- `frontend/e2e/kraefte-schmal.spec.ts` — 390 px: kein H-Scroll, Trefffläche nach Staffel.
- `docs/superpowers/specs/2026-08-17-lfh-339-pruefliste-einsatztauglichkeit.md`

**Geändert**
- `frontend/src/components/Datensicht.tsx` — `status`-Slot bekommt einen Bedienweg.
- `frontend/src/pages/FahrzeugePage.tsx` · `PersonalPage.tsx` · `MaterialPage.tsx`
- `frontend/src/pages/MitgliederAbschnitt.tsx`
- `frontend/src/pages/EinheitenPage.tsx` — Layout + Dialog + Label, Detail zieht aus.
- `frontend/src/routing/deeplinks.ts` · `frontend/src/App.tsx`
- `frontend/src/components/dichte.guard.test.ts` — `OFFEN`-Zeile streichen.
- `CLAUDE.md` — Nachtrag zur Zielform.

---

## Task 1: Primitiv `StatusWahl` — die Statusanzeige wird der Auslöser

**Files:**
- Create: `frontend/src/kraefte/StatusWahl.tsx`
- Test: `frontend/src/kraefte/StatusWahl.test.tsx`

**Interfaces:**
- Consumes: `StatusDarstellung`, `rollenFarbe` aus `theme/statusFarben`; `StatusTag` aus
  `components/StatusTag`.
- Produces:

```ts
export interface StatusOption<W> {
  wert: W;
  label: string;
  /** Rollenachse für den Farbpunkt im Menüeintrag. Fehlt = kein Punkt. */
  darstellung?: StatusDarstellung;
}

export interface StatusWahlProps<W> {
  /** Aktueller Stand als Etikett. `null` = kein Status gesetzt. */
  darstellung: StatusDarstellung | null;
  optionen: readonly StatusOption<W>[];
  /** Menschenlesbare Zeilenkennung für den zugänglichen Namen. */
  kennung: string;
  onWaehlen: (wert: W) => void;
  /** Schreibt gerade — Auslöser gesperrt, Ladeanzeige. */
  laeuft?: boolean;
  /** Ohne Schreibrecht wird ein reines Etikett gerendert, KEIN Auslöser. */
  darfSchreiben: boolean;
}

export default function StatusWahl<W extends string | number>(p: StatusWahlProps<W>): ReactElement;
```

**Warum ein `Button type="text"` als Auslöser und kein `<div onClick>`:** ein antd-Knopf
erbt `controlHeight` vom `ConfigProvider` und schuldet damit nicht die zwei Angaben plus
Dichte-Zusicherung, die LFH-365 einem handgebauten Bedienziel auferlegt. Dieselbe
Begründung wie bei `BemerkungZelle`.

- [ ] **Step 1: Die fünf failing tests schreiben**

`frontend/src/kraefte/StatusWahl.test.tsx` — Fälle, jeder eine eigene Aussage:

1. `mit Schreibrecht öffnet der Klick auf das Statusetikett das Menü mit allen Optionen`
2. `die Wahl eines Eintrags meldet den Wert und schliesst das Menü`
   — Zugriff über `.ant-dropdown:not(.ant-dropdown-hidden) [role="menu"]` + `within`,
   Eintrag per Teilstring.
3. `ohne Schreibrecht gibt es KEINEN Auslöser, aber weiterhin das Etikett`
   — `queryByRole('button')` ist `null`, `getByText(label)` steht.
4. `der zugängliche Name des Auslösers trägt die Zeilenkennung`
   — `getByRole('button', { name: /Florian 44\/1/ })`.
5. `die Statusfarbe steht als Rand/Text, nicht als Hintergrundfläche`
   — der Etikettknoten trägt `background: transparent` (Muster `StatusTag`), und
   `queryByRole('img')` innerhalb des Auslösers ist `null` (Emoji-/Icon-Regel).

- [ ] **Step 2: Tests laufen lassen, Rot bestätigen**

`mise exec pnpm@11.10.0 -- pnpm -C <frontend> vitest run src/kraefte/StatusWahl.test.tsx`
Erwartung: FAIL — Modul existiert nicht.

- [ ] **Step 3: `StatusWahl.tsx` implementieren**

Kern: `darfSchreiben === false` → nur `<StatusTag>`. Sonst `<Dropdown menu={{ items,
onClick, selectable: true, selectedKeys }} trigger={['click']} autoFocus>` um einen
`<Button type="text" aria-label={\`Status von ${kennung} ändern\`} loading={laeuft}
disabled={laeuft}>` mit `<StatusTag>` als Kind.
`onClick` liegt am **Menü**, nicht je Eintrag (LFH-365 — ein Riegel braucht einen Ort).
Menüeintrag = Farbpunkt (`●`, `aria-hidden`, Farbe aus `rollenFarbe`) + Label.

- [ ] **Step 4: Tests grün**

- [ ] **Step 5: Commit** — `feat(lfh-339): macht die Statusanzeige zum Auslöser der Statuswahl`

---

## Task 2: `Datensicht` — der `status`-Slot bekommt einen Bedienweg

**Files:**
- Modify: `frontend/src/components/Datensicht.tsx` (Kartenplan-Typ + Kartenzweig-Render)
- Test: `frontend/src/components/Datensicht.test.tsx`

**Interfaces:**
- Consumes: `StatusWahl` aus Task 1.
- Produces: Erweiterung am Kartenplan `art: 'plan'`:

```ts
/**
 * Bedienweg am Statusetikett (LFH-339 · C4, Spec §5). Deskriptor, KEIN ReactNode-Slot —
 * damit behält das Primitiv Form, Höhe und Trefffläche. Fehlt das Feld, bleibt das
 * Etikett rein anzeigend.
 *
 * Die Ein-Aktion-Zusicherung des `aktion`-Slots bleibt unangetastet: hier entsteht KEIN
 * zweiter Primäraktions-Slot, es wird bedient, wo der Status schon steht.
 */
statusBedienung?: (zeile: T) => StatusBedienung | null;
```

wobei — in `kraefte/StatusWahl.tsx` neben `StatusWahl` exportiert, damit Primitiv und
Konsument dieselbe Wahrheit lesen:

```ts
/**
 * Existenziell über den Wertetyp gekapselt: `Datensicht` reicht den Deskriptor nur
 * durch und darf ihn nicht kennen müssen. Ein `StatusOption<string | number>` am
 * Slot zwänge jeden Konsumenten zu einer Verbreiterung seines eigenen Werttyps.
 */
export interface StatusBedienung {
  optionen: readonly StatusOption<string | number>[];
  onWaehlen: (wert: string | number) => void;
  laeuft?: boolean;
  kennung: string;
}
```

- [ ] **Step 1: Failing tests in `Datensicht.test.tsx`**

1. `im Kartenzweig macht statusBedienung das Statusetikett bedienbar`
2. `ohne statusBedienung bleibt das Etikett rein anzeigend (kein Auslöser)`
   — die zweite Hälfte ist die, die den Test widerlegbar macht.

- [ ] **Step 2: Rot bestätigen** — Erwartung: `statusBedienung` existiert nicht (TS-Fehler).

- [ ] **Step 3: Implementieren** — im Kartenzweig dort, wo heute `<StatusTag>` aus
`karte.status` gerendert wird: liegt `statusBedienung` vor und liefert nicht `null`,
`<StatusWahl>` statt `<StatusTag>`.
`datensicht.guard.test.ts` prüfen: das Primitiv darf sich selbst kein `size="small"`
einbauen (`VERBOTEN_IM_PRIMITIV`).

- [ ] **Step 4: Grün** — `vitest run src/components/Datensicht.test.tsx`

- [ ] **Step 5: Commit** — `feat(lfh-339): gibt dem Statusslot der Datensicht einen Bedienweg`

---

## Task 3: FahrzeugePage — Select raus, StatusWahl rein (Tabelle **und** Karte)

**Files:**
- Modify: `frontend/src/pages/FahrzeugePage.tsx` (Statusspalte ~:415-441, Kartenplan ~:601-624)
- Test: `frontend/src/pages/FahrzeugePage.test.tsx`

**Interfaces:** Consumes Task 1 + Task 2. Kein neues Export.

Der Fahrzeugkatalog ist **mandantengepflegt** — die Optionen kommen aus `statusQuery.data`,
nicht aus einer Konstante. `fms_anker` bleibt Sortier-Anker, **nicht** tragende Bedienform
(Spec §4: die Spalte ist nullable).

- [ ] **Step 1: Failing tests**

1. `der Statuswechsel läuft über das Menü am Statusetikett, nicht über ein Auswahlfeld`
   — `queryByRole('combobox')` in der Statusspalte ist `null`.
2. **AK 3, Richtung A:** `der neue Status steht VOR der Server-Antwort in der Ansicht`
   — Mutation hängen lassen (`Promise`, der nicht auflöst), Menüeintrag klicken, Etikett
   zeigt sofort den neuen Wert.
3. **AK 3, Richtung B:** `ein abgelehnter Statuswechsel rollt auf den alten Wert zurück`
   — Server antwortet 422, danach steht wieder der alte Wert.
4. `ohne Schreibrecht gibt es keinen Auslöser` (Gegenaussage).

- [ ] **Step 2: Rot bestätigen** (Test 1 fällt am noch vorhandenen `combobox`).

- [ ] **Step 3: Umbauen** — Statusspalten-`render` auf `<StatusWahl>`;
`statusBedienung` am Kartenplan setzen. `Select`-Import entfernen, falls unbenutzt.
`minWidth: 150` fällt ersatzlos weg — das ist der Grund, warum das Feld nicht in die
390-px-Karte passte (`Datensicht.tsx:234-236`).

- [ ] **Step 4: Grün** — `vitest run src/pages/FahrzeugePage.test.tsx`

- [ ] **Step 5: Commit** — `feat(lfh-339): löst den Fahrzeug-Statuswechsel aus dem Auswahlfeld`

---

## Task 4: PersonalPage — dieselbe Umstellung

**Files:**
- Modify: `frontend/src/pages/PersonalPage.tsx` (Statusspalte, Kartenplan ~:503)
- Test: `frontend/src/pages/PersonalPage.test.tsx`

**Interfaces:** wie Task 3.

Personal hat **6** Katalogwerte (`migrations/0012:18-30`) — ebenfalls über jeder
waagerechten Schwelle (Spec §3).

- [ ] **Step 1: Failing test** — `der Statuswechsel läuft über das Menü am Statusetikett`
      plus die Gegenaussage ohne Schreibrecht.
- [ ] **Step 2: Rot bestätigen**
- [ ] **Step 3: Umbauen** (Muster Task 3)
- [ ] **Step 4: Grün**
- [ ] **Step 5: Commit** — `feat(lfh-339): löst den Personal-Statuswechsel aus dem Auswahlfeld`

---

## Task 5: MaterialPage — Statuswahl, letzte Klein-Angabe, Schuldzeile

**Files:**
- Modify: `frontend/src/pages/MaterialPage.tsx` (Statusspalte ~:256-278, Zeile 49, Kartenplan ~:387-394)
- Modify: `frontend/src/components/dichte.guard.test.ts` (`OFFEN`-Eintrag streichen)
- Test: `frontend/src/pages/MaterialPage.test.tsx`

**Interfaces:** wie Task 3.

**Drei Dinge, die nur hier zusammenfallen:**

1. Material hat **keinen** `karte.status`-Slot — `STATUS_META` sind rohe antd-Preset-Farben
   außerhalb des A2-Vertrags, der Status steht in `sekundaer: ['kategorie','menge','status']`.
   Spec §4: **dort** wird er zum Auslöser. Also entweder `karte.status` +
   `statusBedienung` neu setzen und `status` aus `sekundaer` nehmen — **das ist die
   Entscheidung dieses Plans**, weil ein Sekundärfeld kein Bedienziel trägt. Die
   Rollenachse dafür: `STATUS_META` auf `StatusDarstellung` heben (lokal in der Datei,
   **kein** Eintrag in `statusFarben.ts` — A2 verbietet den Bestands-Sweep ausdrücklich).
2. `MaterialPage.tsx:49` — `<InputNumber size="small">` fällt. Das ist die letzte
   Einzelstelle der B5i-Schuld.
3. **Im selben Commit** die Zeile `'/src/pages/MaterialPage.tsx'` aus `OFFEN` in
   `dichte.guard.test.ts` streichen — ein Eintrag ohne Verstoß gilt selbst als Verstoß
   („tote Schuld-Ausnahme"), der Guard würde sonst rot.

- [ ] **Step 1: Failing tests**
  1. `der Statuswechsel läuft über das Menü am Statusetikett`
  2. `die Mengeneingabe folgt der Dichtestufe` — kein `size="small"` mehr
- [ ] **Step 2: Rot bestätigen**
- [ ] **Step 3: Umbauen** — Statusspalte, Kartenplan, `InputNumber`, `OFFEN`-Zeile.
- [ ] **Step 4: Beide Guards fahren**
      `vitest run src/components/dichte.guard.test.ts src/components/aktionsabstand.guard.test.ts src/pages/MaterialPage.test.tsx`
      **Prüfen:** entsteht durch die gewachsene Mengeneingabe eine `<Space>`-Reihe mit
      `danger` + mindestens einer weiteren Aktion? Dann gehört `MaterialPage.tsx` in den
      Bereich von `aktionsabstand.guard.test.ts` (Präzedenz LFH-370: eine Klein-Angabe
      abzubauen kann eine Abstandsfrage aufwerfen, die vorher keine war).
- [ ] **Step 5: Commit** — `feat(lfh-339): löst den Materialstatus aus dem Auswahlfeld und trägt die letzte Klein-Angabe ab`

---

## Task 6: MitgliederAbschnitt — Aktionsspalte benennen (N7)

**Files:**
- Modify: `frontend/src/pages/MitgliederAbschnitt.tsx` (Spalte `aktion` :74-91, Rollen-`Select` :67)
- Test: `frontend/src/pages/MitgliederAbschnitt.test.tsx`

**Interfaces:** keine neuen Exports.

Drei Änderungen: `title: ''` → `title: 'Aktion'`; `Button type="link" danger` → regulärer
`<Button danger>`; feste `width: 170` am Rollen-`Select` → `minWidth` über `useViewport`,
damit die Zelle unter `md` nicht drückt.
`size="small"` an `KatalogTabelle` (:129) **bleibt** — CLAUDE.md führt die
Projekt-Primitive ausdrücklich aus dem Verbot heraus, dort ist `size` ein Abstandsmaß.

- [ ] **Step 1: Failing tests**
  1. `die Aktionsspalte trägt eine Überschrift`
  2. `der Entfernen-Auslöser ist ein regulärer Knopf, kein Textlink`
     — `.ant-btn-link` ist nicht am Knopf.
- [ ] **Step 2: Rot bestätigen**
- [ ] **Step 3: Umbauen**
- [ ] **Step 4: Grün**
- [ ] **Step 5: Commit** — `fix(lfh-339): beschriftet die Aktionsspalte der Zugriffsliste`

---

## Task 7: „Einheit bilden" ohne Platzhalter-Datensatz (M27) + Soll-Stärke (N6)

**Files:**
- Modify: `frontend/src/pages/EinheitenPage.tsx` (`bilden`-Mutation :146-150, Knopf :292,
  Leerzustands-Aktion :329, Label :381)
- Test: `frontend/src/pages/EinheitenPage.test.tsx`

**Interfaces:** Consumes `ErfassungsModal` aus `components/Erfassung.tsx`.

Heute schreibt der Knopf sofort `bildeEinheit(einsatzId, { name: 'Neue Einheit' })` in die
Datenbank. Ersatz: `ErfassungsModal` mit **zwei** Feldern (Name Pflicht + `autoFocus`, Typ
optional) — Feldbudget ≤ 3 gehalten. **Kein** `serie`: eine Einheit zu bilden ist keine
Minutentakt-Erfassung.
`onErfassen` nimmt `mutateAsync`, nicht `mutate` — sonst leert die Hülle die Felder auch
bei 422.

**Beide Auslöser umstellen** (Kopfknopf :292 **und** Leerzustands-Aktion :329) — der
Wortlaut ist dort byte-gleich, weil es dieselbe Handlung ist; nur einen umzustellen hieße,
es halb zu tun.

**N6:** Label „Soll-Override (vollständig oder leer)" → **„Soll-Stärke (F/UF/M)"**, die
Eingaberegel als gedämpfte Hilfszeile. AK: `grep -c 'Override' EinheitenPage.tsx` = **0**.

- [ ] **Step 1: Failing tests**
  1. `„Einheit bilden" öffnet einen Dialog und legt noch nichts an`
     — nach dem Klick 0 POST-Aufrufe.
  2. `erst das Absenden mit Namen legt die Einheit an — und nie als „Neue Einheit"`
  3. `Abbrechen legt nichts an`
  4. `das Stärke-Feld heißt „Soll-Stärke (F/UF/M)"`
- [ ] **Step 2: Rot bestätigen**
- [ ] **Step 3: Umbauen**
- [ ] **Step 4: Grün** + `grep -c 'Override'` = 0
- [ ] **Step 5: Commit** — `feat(lfh-339): fragt den Einheitennamen ab, statt einen Platzhalter anzulegen`

---

## Task 8: Einheiten-Detailseite auf eigener Route (M26)

**Files:**
- Create: `frontend/src/pages/EinheitDetailPage.tsx`
- Create: `frontend/src/pages/EinheitDetailPage.test.tsx`
- Modify: `frontend/src/routing/deeplinks.ts` · `frontend/src/App.tsx`
- Modify: `frontend/src/pages/EinheitenPage.tsx` (Detailhälfte zieht aus)

**Interfaces:**
- Produces in `deeplinks.ts`:

```ts
/**
 * Item-Route je Einheit (LFH-339 · C4). Löst die frühere Query-Param-Selektion
 * `?einheit=` als ZIEL ab; der Query-Param bleibt für Bestands-Deeplinks lesbar.
 */
export function einheitDetailPfad(einsatzId: number, einheitId: number): string {
  return `${einsatzModulPfad(einsatzId, 'einheiten')}/${einheitId}`;
}
```
- Produces in `App.tsx`: `<Route path="einheiten/:einheitId" element={<EinheitDetailPage />} />`
  neben dem Muster `personen/:personId` (:174).
- Consumes: `parseRouteId` aus `routing/deeplinks.ts` (Redirect auf die Liste bei
  ungültiger ID), `SektionHeader` aus `components/SektionHeader.tsx`.

**Aufbau der neuen Seite** — die Entwirrung ist der eigentliche Inhalt:

- **Kopfdaten im `<Form>`** (Name, Typ, Abschnitt, Über-Einheit, Soll-Stärke, Funk,
  Bemerkung), abgeschlossen von einer **sticky Aktionsleiste** (Speichern · Auflösen).
- **Die drei Zuordnungen liegen AUSSERHALB des `<Form>`** — sie wirken sofort und haben in
  einem Formular mit „Speichern" nichts zu suchen; das ist Befund M26. Je Sektion ein
  `SektionHeader`, nicht ein handgebautes `Typography.Title level={5}`.
- `?einheit=<id>` auf der Listenseite **leitet weiter** auf die Item-Route, damit
  Bestands-Deeplinks nicht brechen.

- [ ] **Step 1: Failing tests**
  1. `die Route /einsaetze/1/einheiten/7 zeigt die Kopfdaten der Einheit`
  2. `eine ungültige Einheiten-ID leitet auf die Liste zurück`
  3. `die Zuordnungen liegen ausserhalb des Formulars`
     — `getByRole('button', { name: /Person zuordnen/ }).closest('form')` ist `null`;
     der Speichern-Knopf dagegen liegt **im** Formular.
  4. `?einheit=7 auf der Listenseite leitet auf die Item-Route weiter`
- [ ] **Step 2: Rot bestätigen**
- [ ] **Step 3: Implementieren** — Datei anlegen, Route registrieren, Builder ergänzen,
      Detailhälfte aus `EinheitenPage.tsx` entfernen.
- [ ] **Step 4: Grün** — inkl. `vitest run src/routing/deeplinks.test.ts`
- [ ] **Step 5: Commit** — `feat(lfh-339): gibt der Einheiten-Detailansicht eine eigene Route`

---

## Task 9: EinheitenPage bricht um (M25)

**Files:**
- Modify: `frontend/src/pages/EinheitenPage.tsx` (Flex-Container :299, Gliederungs-Karte :300)
- Test: `frontend/src/pages/EinheitenPage.test.tsx`

**Interfaces:** Consumes `useViewport` aus `components/useViewport.ts` und
`einheitDetailPfad` aus Task 8.

Nach Task 8 trägt die Seite nur noch die Gliederung — die feste `flex: '0 0 360px'` wird zu
`flex: '0 0 clamp(260px, 30%, 360px)'` mit `flexWrap: 'wrap'`, unter `lg` einspaltig. Die
Baumknoten werden zu `<Link>` auf die Item-Route.
**Das Emoji `👤` in `baueBaum` (:50) fällt** — „Ein Emoji ist keine Ikone": `UserOutlined`
in `aria-hidden`-Hülle. Es wird ohnehin angefasst.

- [ ] **Step 1: Failing tests**
  1. `unter lg steht die Gliederung einspaltig`
  2. `ein Baumknoten führt auf die Detailroute der Einheit`
  3. `der Führername trägt eine Ikone, kein Emoji` — `queryByText('👤')` ist `null`
- [ ] **Step 2: Rot bestätigen**
- [ ] **Step 3: Umbauen**
- [ ] **Step 4: Grün**
- [ ] **Step 5: Commit** — `fix(lfh-339): lässt die Einheiten-Gliederung umbrechen`

---

## Task 10: e2e — 390 px ohne Querlauf, Trefffläche nach der Staffel (AK 2)

**Files:**
- Create: `frontend/e2e/kraefte-schmal.spec.ts`

**Interfaces:** keine — Playwright-Spec.

**Zwei Aussagen, getrennt gehalten:**

1. **Kein horizontaler Querlauf** bei 390 px auf `/fahrzeuge`, `/personal`, `/material`,
   `/einheiten` — `document.body.scrollWidth <= clientWidth`. Dichteunabhängig.
2. **Der Statuswechsel-Auslöser hält die Dichtestufe.** `test.use({ hasTouch: true })` auf
   Dateiebene — ohne das meldet die Seite `(pointer: fine)`, `zeigerIstGrob()` bleibt
   falsch und die Stufe bliebe `kompakt` (30 px). Mit grobem Zeiger belegt
   `ThemeModeProvider` `komfortabel` vor → **48**.
   Gemessen wird gegen die **Staffel als Literal** (48 / 72), nicht gegen die 44 des
   AK-Textes: ein Test auf 44 wäre schwächer als der Bestand und liesse eine Regression auf
   44–47 px durch (`trefflaeche-tablet.spec.ts:32-41`). Damit ist das AK übererfüllt, nicht
   verfehlt.
   Erste Zusicherung jedes Durchgangs ist die `data-dichte`-Wache — sonst ist „Knopf zu
   klein" nicht von „Stufe gar nicht angekommen" zu unterscheiden.
   `SUBPIXEL = 0.5` und `expect.poll` übernehmen (antds Einblendung misst sonst 80 %).
   **Kein** `waitForLoadState('networkidle')` — auf Einsatzrouten bleibt ein SSE-Strom offen.

3. **AK 5 — „Einheit bilden" persistiert nichts vor dem Absenden.** Klick auf „Einheit
   bilden", Dialog **abbrechen** → die Zahl der Knoten in der Gliederung ist unverändert;
   erst der Absendeklick mit gefülltem Namensfeld erzeugt einen Datensatz, und der heißt
   **nie** „Neue Einheit". Das AK verlangt ausdrücklich e2e — der Vitest aus Task 7 misst
   den Aufruf, dieser hier den persistierten Bestand.

- [ ] **Step 1: Spec schreiben** (alle drei Aussagen, zwei Dichtestufen für die zweite)
- [ ] **Step 2: Laufen lassen**
      `mise exec pnpm@11.10.0 -- pnpm -C <frontend> e2e kraefte-schmal`
- [ ] **Step 3: Grün** — bei Rot: erst messen, ob die Stufe ankam, dann die Höhe.
- [ ] **Step 4: Commit** — `test(lfh-339): misst Querlauf und Trefffläche der Kräfte-Module bei 390 px`

---

## Task 11: Prüfliste Einsatztauglichkeit + Doku

**Files:**
- Create: `docs/superpowers/specs/2026-08-17-lfh-339-pruefliste-einsatztauglichkeit.md`
- Modify: `CLAUDE.md`

Ein Modul-Task ohne ausgefüllte Prüfliste gilt nicht als fertig. Muster:
`2026-08-11-lfh-338-pruefliste-einsatztauglichkeit.md`.

**15 Kriterien, jede Zeile mit Verdikt** (erfüllt / offen → Zielticket / nicht anwendbar) —
„nicht geprüft" ist keins. Jede Zahl mit Quelle, Gerechnetes als `[abgeleitet]`.

Abzudecken sind die **vier** Flächen: die drei Kräfteseiten (dort ergänzend zur
bestehenden `2026-07-28-einsatzlisten-pruefliste.md`, deren Zeilen Z1/Z2/Z9/Z14/Z15 laut
Zielform-Spec §7 ihr Zielticket **behalten**) und die **neue** `EinheitDetailPage`, für die
noch keine existiert.

**CLAUDE.md-Nachtrag:** der Absatz „Die Zielform des Statuswechsels … liegt fest, gebaut
wird sie in LFH-339/C4" wird auf **gebaut** umgeschrieben, mit den Trägern
(`kraefte/StatusWahl.tsx`, `Datensicht`-`statusBedienung`) und dem, was beim Bauen
gemessen wurde.

- [ ] **Step 1: Prüfliste schreiben**
- [ ] **Step 2: CLAUDE.md nachtragen**
- [ ] **Step 3: Commit** — `docs(lfh-339): füllt die Prüfliste Einsatztauglichkeit für die Kräftemodule`

---

## Task 12: Vollständiges Gate

- [ ] **Step 1:** `./scripts/check-all.sh` aus dem Worktree-Root
- [ ] **Step 2:** Rote Stellen beheben — **kein `| tail`** um Gate-Kommandos (maskiert den
      Exit-Code, eine rote Suite sähe grün aus).
- [ ] **Step 3:** `superpowers:requesting-code-review`, Board auf `in review`
- [ ] **Step 4:** Merge über `superpowers:finishing-a-development-branch`, Board auf `shipped`
