# Gefahrenmatrix — bedienbare Bewertung (LFH-368 · B5h)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Die 65 Zellen der Gefahrenmatrix werden von einem 22,5 px hohen Mini-Select auf einen
dichte-treuen Auslöser je Zelle umgestellt, und die Flächenskala der Warnstufen zieht aus
`pages/` nach `theme/` — mit dem Dunkelmodus-Paar, das sie heute nicht hat.

**Architecture:** Drei Schichten, in dieser Reihenfolge. (1) `theme/`: zwei neue
Füllungs-Intensitäten in `Farbrollen` und eine benannte vierte Warnstufen-Lesart
(`warnstufeFlaeche`) in `statusFarben.ts` — die dritte Darstellungssorte wandert damit **in** den
Vertrag, statt als Ausnahme daneben zu stehen. (2) `pages/gefahren/`: jede Zelle trägt EINEN
Auslöser, der Stufe **und** Details bündelt (`Dropdown` nach dem Muster aus LFH-365/B5e); die
Detailfelder laufen über `ErfassungsModal` statt über einen handgebauten Popover. (3) Buchhaltung:
Dichte-Schuldmenge, Guard-Ausnahmen, CLAUDE.md-Zahl, Prüfliste Einsatztauglichkeit.

**Tech Stack:** React 19 · antd 6 · TanStack Query 5 · Vitest 4 / jsdom 29 / Testing Library ·
react-icons (`tb`)

## Global Constraints

- **Dichte-Staffel 30 / 48 / 72 px** kommt vom `ConfigProvider`. **Neues punktuelles
  `size="small"` auf interaktiven Elementen ist verboten** (`components/dichte.guard.test.ts`).
- **Farbwerte ausschließlich in `theme/tokens.ts` / `theme/rollen.css`.** TSX liest
  `theme.useToken()`, handgeschriebenes CSS liest `var(--lfh-*)`. Kein Hex, kein `rgba(...)` in
  `pages/` (`theme/gate5.guard.test.ts` — sein rgba-Blindfleck ist keine Erlaubnis).
- **`statusFarben.ts` trägt keinen Farbwert** (eigener Dateikopf, Zeile 18-21, und
  `statusFarben.test.ts:69`). Werte gehören in `tokens.ts`, Abbildungen hierher.
- **Jede Statusfarbe braucht einen zweiten Kanal** (Text/Symbol/Form, WCAG 1.4.1).
- **Rot bedient nichts** — `bedien` und Fokusring sind blau.
- **Erfassungsmasken nehmen `components/Erfassung.tsx`**, kein handgebautes `<Modal>` + `<Form>`.
  `onErfassen` nutzt `mutateAsync`, nicht `mutate`.
- **Ab drei Aktionen an einer Zeile: `Dropdown` mit `menu={{ items }}`, `trigger={['click']}`,
  `autoFocus`**, Zuordnung per `onClick` **am Menü**, zugänglicher Name mit Zeilenkennung.
- **Keine Höhen-/Trefferflächen-Behauptung in Vitest** — `test/utils.tsx` rendert ein nacktes
  `ConfigProvider`. Der Nachweis gehört nach Playwright (LFH-370 · B5j).
- **Im Test wird ein Menüeintrag immer über das geöffnete Menü gegriffen:**
  `.ant-dropdown:not(.ant-dropdown-hidden) [role="menu"]` + `within`. antd lässt die Portale
  geschlossener Dropdowns im Baum stehen.
- **Gate:** `./scripts/check-all.sh` vor dem Merge. Frontend-Teilgate:
  `mise exec pnpm@10 -- pnpm -C <abs>/frontend exec vitest run <pfad>`.

## Die beiden Widersprüche des Tickets — entschieden und gemessen

**1 · Geometrie.** Das Ticket rechnet mit ≥44 px je Fläche und kommt auf 1280 px Matrixbreite.
Gemessen am Code ist das Budget kleiner als die Zahl, gegen die es gestellt wird:

| Posten | px | Quelle |
| --- | --- | --- |
| Fükw-Viewport (13–15", Untergrenze) | 1280 | Bedien-Leitlinie, Kontext „Fükw" |
| − Seitenrinne 24 × 2 | 48 | `theme/tokens.ts:212`, `rollen.css` Media-Block |
| − IconRail (48 + `abstand.sm` × 2) | ~62 | `einsatz/IconRail.tsx:45`, `:28` |
| − ModulPanel (220 + Rand) | ~221 | `einsatz/ModulPanel.tsx:106` |
| − Gebietsliste 240 + `gap` 16 | 256 | `GefahrenPage.tsx:107/109` |
| **verfügbar für die Matrix** | **~693** | (ModulPanel eingeklappt: ~914) |
| ⇒ zulässige Zellbreite `(693 − 180) / 5` | **~103** | (eingeklappt: ~147) |

Ein 5-Wege-`Segmented` braucht kompakt ~174 px je Zelle (5 × ~34) ⇒ Matrix ~1050 px, in
`komfortabel`/`handschuh` ~1420/~1980. **Entscheidung: ein Auslöser je Zelle** (`min-width` =
`controlHeight`, also 30/48/72) ⇒ Zellbreite ~40/58/82 ⇒ Matrix ~380/470/590 px. Damit trägt die
Matrix in **jeder** Dichtestufe innerhalb des Budgets, und die Staffel greift dort, wo sie zählt:
an Auslöser und Menüeinträgen. Der Bildlauf (`scroll={{ x: 'max-content' }}`) bleibt als Netz,
wird im Fükw aber nicht mehr gebraucht. Die Klickzahl bleibt bei zwei — wie heute (Select öffnen,
Option wählen) —, aber der zweite Auslöser je Zelle (Details) entfällt: er zieht ins selbe Menü.

**2 · Farbe.** `statusFarben.ts:49-60` erklärt die Flächenskala bereits als eigene, legitime
Darstellungssorte; der Absatz 166-169 („nicht eine sechste Farbe") bindet `warnstufeKarte`, nicht
die Fläche. Offen war allein der Ort der Werte. **Entscheidung: keine fünf neuen Farbwerte,
sondern zwei Intensitäten der zwei vorhandenen Füllungsrollen.** `alarmFuellung`,
`achtungFuellung`, `normalFuellung` existieren seit LFH-352 je Modus in `tokens.ts:38-40` und
haben heute **null Konsumenten** außerhalb von `tokens.ts`/`rollen.css`/`rollen.guard.test.ts` —
sie sind für genau diesen Fall gebaut:

| Warnstufe | Fläche | Kürzel (zweiter Kanal) |
| --- | --- | --- |
| keine | `transparent` | `–` |
| niedrig | `achtungFuellung` | `N` |
| mittel | `achtungFuellungStark` (neu) | `M` |
| hoch | `alarmFuellung` | `H` |
| akut | `alarmFuellungStark` (neu) | `A` |

Fünf unterscheidbare Flächen, **drei** Farbtöne, kein neuer Farbton — der Satz „nicht eine sechste
Farbe" hält, und das Dunkelmodus-Paar kommt automatisch. Heute fehlt es ganz: `warnstufeFarbe`
liefert `#fff7e6`/`#ffd591`/`#ffa39e`/`#ff4d4f` **ohne Modus-Zweig**, also im Nachtmodus vier
grelle Helligkeitsblöcke. Das ist der eigentliche Gewinn des Umzugs, nicht die Ordnung.

**Tragendes Detail:** `rollenFarbe()` kann eine Füllung **nicht** liefern — `antdToken()`
(`tokens.ts:262-312`) bildet nur `bedien/alarm/achtung/normal` ab, die Füllungsrollen erreichen
keinen antd-Token. Die neue Funktion folgt deshalb dem **`marke`-Präzedenzfall**
(`statusFarben.ts:230`): sie liest `farbenHell`/`farbenDunkel` direkt über `istDunklerModus(token)`.
Weil dieser Helfer privat ist (`:236`), lebt sie in `statusFarben.ts` — nicht in `theme/` daneben.

## Weitere Entscheidungen, die dieser Plan trifft

- **`pending` sperrt künftig nur die betroffene Zelle.** Heute setzt `GefahrenMatrix.tsx:71`
  `disabled={… || pending}` — ein laufender PUT friert alle 58 bedienbaren Zellen in einer Maske,
  die im Minutentakt bedient wird. In Scope (Task 3), nicht als Folgeticket: die Zeile wird ohnehin
  neu geschrieben.
- **Das rohe `<Table>` bleibt.** `katalogTabelle.guard.test.ts:271-275` stellt die Matrix
  begründet frei („jede Zelle ein eigener Sachverhalt — kein Listenvergleich"). Der Umbau ändert
  die Zelle, nicht die Tabellensorte; die Ausnahme bleibt damit belegt und wird **nicht** tot. Der
  benannte Restposten „es fehlt allein die stehende Kopfzeile" wird in Task 3 eingelöst
  (`sticky`), der Kommentar entsprechend nachgezogen.
- **Kein zweites Schmalschirm-Layout ohne Messung.** Bei ~380 px trägt die Matrix auch auf ~390 px;
  gestapelt wird nur die Gebietsliste über der Matrix (Task 4). Ein Collapse-Layout je Gefahrentyp
  wird nur gebaut, wenn die Messung es erzwingt — und das Ergebnis wird in der Prüfliste notiert.
- **Der Doc-Fehler im Kopfkommentar wird mitkorrigiert:** `GefahrenMatrix.tsx:45` verspricht
  „GefahrenPage + Karten-Drawer"; gemessen ist `GefahrenPage.tsx` der **einzige** Konsument.

## Dateien

| Datei | Rolle in diesem Umbau |
| --- | --- |
| `frontend/src/theme/tokens.ts` | +2 Füllungsrollen in `Farbrollen`, `farbenHell`, `farbenDunkel` |
| `frontend/src/theme/rollen.css` | dieselben 2 Properties in `:root` **und** `[data-theme='dark']` |
| `frontend/src/theme/rollen.guard.test.ts` | 2 Zeilen in `FARB_ABBILDUNG` |
| `frontend/src/theme/statusFarben.ts` | `Fuellungsrolle`, `Flaechendarstellung`, `warnstufeFlaeche`, `flaechenFarbe`; Vertragsabsatz 49-66 umgeschrieben |
| `frontend/src/theme/statusFarben.test.ts` | Byte-Pin der 2 neuen Werte + Struktur-/Kanal-Test der neuen Skala |
| `frontend/src/pages/gefahren/gefahrenSchema.ts` | `warnstufeFarbe` entfällt |
| `frontend/src/pages/gefahren/gefahrenSchema.test.ts` | Byte-Pin `:31-32` zieht um, wird nicht gelöscht |
| `frontend/src/pages/lage-dashboard/lagebild.ts` | Vertragsabsatz `:127` umgeschrieben |
| `frontend/src/pages/gefahren/GefahrenPage.tsx` | `Tag`-Fehlanwendung `:120`, `rgba` `:117`, `size="small"` `:141`, Schmalschirm-Stapel |
| `frontend/src/pages/gefahren/GefahrenMatrix.tsx` | Zell-Dropdown, Spaltenköpfe, `sticky`, `pending` je Zelle, 4 × `size="small"` weg |
| `frontend/src/pages/gefahren/GefahrenZelleDetails.tsx` | **neu** — Detailfelder über `ErfassungsModal` |
| `frontend/src/pages/gefahren/GefahrenMatrix.test.tsx` | 3 der 4 Fälle neu geschrieben, Fall 1 bleibt |
| `frontend/src/components/dichte.guard.test.ts` | B5h-Block (`:151-153`) entfällt vollständig |
| `frontend/src/components/katalogTabelle.guard.test.ts` | Ausnahme-Kommentar `:271-275` nachgezogen |
| `CLAUDE.md` | Schuldmengenzahl 41/20 → 36/18, B5h-Festlegungen |
| `docs/superpowers/specs/2026-07-30-gefahrenmatrix-pruefliste.md` | **neu** — Prüfliste Einsatztauglichkeit (15 Kriterien) |

---

### Task 1: Flächenskala nach `theme/` — zwei Intensitäten, ein Vertrag

**Files:**
- Modify: `frontend/src/theme/tokens.ts:22-83`
- Modify: `frontend/src/theme/rollen.css` (`:root`-Block bei `--lfh-*-fuellung`, `[data-theme='dark']`-Block ebenso)
- Modify: `frontend/src/theme/rollen.guard.test.ts:104-106`
- Modify: `frontend/src/theme/statusFarben.ts:49-66` (Vertragstext) und Ende der Datei (neue Exporte)
- Test: `frontend/src/theme/statusFarben.test.ts`, `frontend/src/theme/rollen.guard.test.ts`

**Interfaces:**
- Consumes: `farbenHell`/`farbenDunkel`/`Farbrollen` aus `theme/tokens.ts`; `istDunklerModus` (privat, in derselben Datei wie die neue Funktion).
- Produces:
  - `export type Fuellungsrolle = 'achtungFuellung' | 'achtungFuellungStark' | 'alarmFuellung' | 'alarmFuellungStark' | 'normalFuellung'`
  - `export interface Flaechendarstellung { fuellung: Fuellungsrolle | null; label: string; kuerzel: string }`
  - `export const warnstufeFlaeche: Record<Warnstufe, Flaechendarstellung>`
  - `export function flaechenFarbe(w: Warnstufe, token: GlobalToken): string`

- [ ] **Step 1: Die zwei Farbwerte in `tokens.ts` ergänzen**

In `interface Farbrollen` direkt hinter `alarmFuellung`/`achtungFuellung` je eine Zeile, und in
**beiden** Rollenobjekten den Wert. Die Deckkraft steigt von 7–10 % auf 18–20 %: die Zelle trägt
künftig einen Kürzel-Knopf auf der Fläche, und zwei Stufen derselben Rolle müssen ohne
Farbtonwechsel unterscheidbar bleiben.

```ts
export interface Farbrollen {
  // … unverändert bis:
  alarmFuellung: string;
  /** Zweite Intensität derselben Rolle — die obere Hälfte einer Flächenskala
   *  (LFH-368 · B5h). KEIN neuer Farbton: `alarm` in stärkerer Füllung. */
  alarmFuellungStark: string;
  achtungFuellung: string;
  /** Zweite Intensität von `achtung` — Gegenstück zu {@link Farbrollen.alarmFuellungStark}. */
  achtungFuellungStark: string;
  normalFuellung: string;
}

export const farbenHell: Farbrollen = {
  // … unverändert bis:
  alarmFuellung: 'rgba(176, 35, 24, 0.07)',
  alarmFuellungStark: 'rgba(176, 35, 24, 0.2)',
  achtungFuellung: 'rgba(122, 82, 0, 0.08)',
  achtungFuellungStark: 'rgba(122, 82, 0, 0.2)',
  normalFuellung: 'rgba(28, 102, 64, 0.07)',
};

export const farbenDunkel: Farbrollen = {
  // … unverändert bis:
  alarmFuellung: 'rgba(255, 122, 127, 0.1)',
  alarmFuellungStark: 'rgba(255, 122, 127, 0.24)',
  achtungFuellung: 'rgba(245, 185, 66, 0.1)',
  achtungFuellungStark: 'rgba(245, 185, 66, 0.24)',
  normalFuellung: 'rgba(92, 196, 141, 0.1)',
};
```

- [ ] **Step 2: `rollen.guard.test.ts` laufen lassen — er MUSS rot werden**

Run: `mise exec pnpm@10 -- pnpm -C <abs>/frontend exec vitest run src/theme/rollen.guard.test.ts`
Expected: FAIL — `FARB_ABBILDUNG` ist ein `Record<keyof Farbrollen, string>` und kennt die zwei
neuen Schlüssel nicht (TS-Fehler bzw. `undefined` im Vergleich). Das ist der Beweis, dass die
Deckungsgleich-Pflicht greift; ohne diesen Lauf weiß niemand, ob der Guard die Erweiterung
überhaupt sieht.

- [ ] **Step 3: `rollen.css` in BEIDEN Blöcken nachziehen**

Im `:root`-Block (bei `--lfh-alarm-fuellung`, Zeile ~40) und im `[data-theme='dark']`-Block
(Zeile ~109) je zwei Properties, Werte byte-identisch zu Step 1:

```css
  --lfh-alarm-fuellung: rgba(176, 35, 24, 0.07);
  --lfh-alarm-fuellung-stark: rgba(176, 35, 24, 0.2);
  --lfh-achtung-fuellung: rgba(122, 82, 0, 0.08);
  --lfh-achtung-fuellung-stark: rgba(122, 82, 0, 0.2);
```

```css
  --lfh-alarm-fuellung: rgba(255, 122, 127, 0.1);
  --lfh-alarm-fuellung-stark: rgba(255, 122, 127, 0.24);
  --lfh-achtung-fuellung: rgba(245, 185, 66, 0.1);
  --lfh-achtung-fuellung-stark: rgba(245, 185, 66, 0.24);
```

- [ ] **Step 4: `FARB_ABBILDUNG` ergänzen**

```ts
  alarmFuellung: '--lfh-alarm-fuellung',
  alarmFuellungStark: '--lfh-alarm-fuellung-stark',
  achtungFuellung: '--lfh-achtung-fuellung',
  achtungFuellungStark: '--lfh-achtung-fuellung-stark',
  normalFuellung: '--lfh-normal-fuellung',
```

- [ ] **Step 5: Guard grün**

Run: `mise exec pnpm@10 -- pnpm -C <abs>/frontend exec vitest run src/theme/rollen.guard.test.ts`
Expected: PASS, und die Fallzahl ist um 4 gestiegen (2 Rollen × 2 Modi).

- [ ] **Step 6: Den fehlschlagenden Test der neuen Skala schreiben**

An `frontend/src/theme/statusFarben.test.ts` anhängen. Drei Behauptungen, jede mit eigenem Grund:
der **Byte-Pin** (eine geänderte Deckkraft ist eine Entscheidung, kein Versehen), die
**Struktur** (welche Stufe welche Rolle bekommt) und der **Modus-Wechsel** (das, was der alten
`warnstufeFarbe` fehlte). Der Pin steht als Literal — aus dem Token zurückgelesen prüfte er den
Token gegen sich selbst.

```ts
describe('Warnstufe als Fläche (LFH-368 · B5h)', () => {
  it('pinnt die zwei neuen Intensitäten byte-genau', () => {
    expect(farbenHell.achtungFuellungStark).toBe('rgba(122, 82, 0, 0.2)');
    expect(farbenHell.alarmFuellungStark).toBe('rgba(176, 35, 24, 0.2)');
    expect(farbenDunkel.achtungFuellungStark).toBe('rgba(245, 185, 66, 0.24)');
    expect(farbenDunkel.alarmFuellungStark).toBe('rgba(255, 122, 127, 0.24)');
  });

  it('nutzt DREI Farbtöne für fünf Stufen — keine sechste Farbe', () => {
    expect(sf.warnstufeFlaeche.keine.fuellung).toBeNull();
    expect(sf.warnstufeFlaeche.niedrig.fuellung).toBe('achtungFuellung');
    expect(sf.warnstufeFlaeche.mittel.fuellung).toBe('achtungFuellungStark');
    expect(sf.warnstufeFlaeche.hoch.fuellung).toBe('alarmFuellung');
    expect(sf.warnstufeFlaeche.akut.fuellung).toBe('alarmFuellungStark');
  });

  it('gibt jeder Stufe einen zweiten Kanal — Text UND Kürzel', () => {
    for (const [stufe, d] of Object.entries(sf.warnstufeFlaeche)) {
      expect(d.label.trim(), `${stufe} ohne Text`).not.toBe('');
      expect(d.kuerzel.trim(), `${stufe} ohne Kürzel`).not.toBe('');
    }
    // Fünf Kürzel, fünf verschiedene — sonst trägt der Kanal nichts.
    const kuerzel = Object.values(sf.warnstufeFlaeche).map((d) => d.kuerzel);
    expect(new Set(kuerzel).size).toBe(kuerzel.length);
  });

  it('folgt dem Modus — genau das konnte `warnstufeFarbe` nicht', () => {
    expect(sf.flaechenFarbe('akut', hellToken)).toBe(farbenHell.alarmFuellungStark);
    expect(sf.flaechenFarbe('akut', dunkelToken)).toBe(farbenDunkel.alarmFuellungStark);
    expect(sf.flaechenFarbe('akut', hellToken)).not.toBe(sf.flaechenFarbe('akut', dunkelToken));
  });

  it('liefert für `keine` eine leere Fläche, keinen Farbwert', () => {
    expect(sf.flaechenFarbe('keine', hellToken)).toBe('transparent');
    expect(sf.flaechenFarbe('keine', dunkelToken)).toBe('transparent');
  });

  it('bleibt aus der Etikett-Abdeckung heraus — die Neun-Enum-Zusicherung gilt weiter', () => {
    // `warnstufeFlaeche`-Einträge tragen KEIN `rolle`-Feld und werden von `ALLE_MAPS`
    // deshalb nicht erfasst. Das ist Absicht: eine Fläche ist keine Statusrolle, und
    // `StatusDarstellung` hineinzubiegen hätte den Kanal-Vertrag verwässert.
    expect(Object.keys(ALLE_MAPS)).not.toContain('warnstufeFlaeche');
    expect(Object.keys(ALLE_MAPS)).toHaveLength(9);
  });
});
```

- [ ] **Step 7: Lauf zur Bestätigung, dass er fehlschlägt**

Run: `mise exec pnpm@10 -- pnpm -C <abs>/frontend exec vitest run src/theme/statusFarben.test.ts`
Expected: FAIL — `sf.warnstufeFlaeche`/`sf.flaechenFarbe` existieren nicht.

- [ ] **Step 8: Die Skala in `statusFarben.ts` implementieren**

Ans Dateiende, **hinter** `istDunklerModus` (die Funktion ist privat und wird gebraucht):

```ts
/** Eine Flächen-Füllungsrolle. Bewusst enger als `keyof Farbrollen`: `markeGlut` ist
 *  ein Schatten, keine Fläche, und `text` schon gar nicht. */
export type Fuellungsrolle =
  | 'achtungFuellung'
  | 'achtungFuellungStark'
  | 'alarmFuellung'
  | 'alarmFuellungStark'
  | 'normalFuellung';

/**
 * Die dritte Darstellungssorte: eine FLÄCHE, kein Etikett.
 *
 * Eigener Typ statt {@link StatusDarstellung}, weil eine Füllung keine
 * {@link Statusrolle} ist. Sie in `rolle` zu pressen hätte den Kanal-Vertrag der
 * Etikett-Maps verwässert und `rollenFarbe` einen Fall gegeben, den es nicht
 * bedienen kann (`antdToken()` bildet die Füllungsrollen nicht ab).
 */
export interface Flaechendarstellung {
  /** `null` = keine Fläche. Kein `'transparent'` als Rollenname — das ist ein Wert. */
  fuellung: Fuellungsrolle | null;
  /** Pflicht, zweiter Kanal (WCAG 1.4.1). */
  label: string;
  /** Ein Zeichen für die Zelle, in der der volle Text nicht steht. Zweiter Kanal dort. */
  kuerzel: string;
}

/**
 * Warnstufe als **Fläche der Gefahrenmatrix** (LFH-368 · B5h; früher
 * `pages/gefahren/gefahrenSchema.ts:warnstufeFarbe`).
 *
 * FÜNF STUFEN AUF DREI FARBTÖNE, unterschieden durch die INTENSITÄT derselben Rolle
 * und durch {@link Flaechendarstellung.kuerzel}. Damit hält die Festlegung bei
 * {@link warnstufeKarte} („nicht eine sechste Farbe") auch hier, wo fünf Flächen
 * gebraucht werden.
 *
 * `keine` ist leer und NICHT `alarm` wie auf der Karte: dort steht ein unbewertetes
 * Gebiet (⇒ vorsichtshalber Gefahr), hier bedeutet die Stufe ausdrücklich „für dieses
 * Schutzobjekt besteht keine Gefahr". Eine Matrix, in der 58 unbewertete Zellen rot
 * stehen, zeigt nichts an.
 */
export const warnstufeFlaeche: Record<Warnstufe, Flaechendarstellung> = {
  keine: { fuellung: null, label: 'keine', kuerzel: '–' },
  niedrig: { fuellung: 'achtungFuellung', label: 'niedrig', kuerzel: 'N' },
  mittel: { fuellung: 'achtungFuellungStark', label: 'mittel', kuerzel: 'M' },
  hoch: { fuellung: 'alarmFuellung', label: 'hoch', kuerzel: 'H' },
  akut: { fuellung: 'alarmFuellungStark', label: 'akut', kuerzel: 'A' },
};

/**
 * Fläche → Farbwert des aktiven Modus.
 *
 * Folgt dem `marke`-Zweig in {@link rollenFarbe}, nicht dem antd-Zweig: `antdToken()`
 * bildet die Füllungsrollen auf KEINEN antd-Token ab, ein `token.colorXxx` gibt es
 * hier also nicht. Der Modus kommt deshalb über {@link istDunklerModus} — dieselbe
 * Helligkeitsprobe, mit demselben Verhalten bei fremdem Theme (Rückfall auf Hell,
 * statt zu werfen).
 */
export function flaechenFarbe(w: Warnstufe, token: GlobalToken): string {
  const rolle = warnstufeFlaeche[w].fuellung;
  if (rolle === null) return 'transparent';
  return (istDunklerModus(token) ? farbenDunkel : farbenHell)[rolle];
}
```

- [ ] **Step 9: Beide Test-Dateien grün**

Run: `mise exec pnpm@10 -- pnpm -C <abs>/frontend exec vitest run src/theme/`
Expected: PASS (inkl. `gate5.guard.test.ts` — die neuen Werte liegen in `theme/`, wo sie erlaubt sind).

- [ ] **Step 10: Den Vertragsabsatz umschreiben, nicht umbiegen**

`statusFarben.ts:49-66`. Der Absatz argumentiert heute, die Ausnahme existiere, WEIL ein
gesättigter Rollenton den Zellinhalt unlesbar machte — eine Füllung bei 7–20 % ist genau die
Antwort darauf. Er bekommt deshalb eine neue **Schlussfolgerung**, keinen neuen Pfad:

```
 * ── DIE DRITTE DARSTELLUNGSSORTE: FLÄCHE (aufgelöst mit LFH-368 · B5h) ──────────
 *
 * Bis B5h lag sie außerhalb dieses Vertrags: `pages/gefahren/gefahrenSchema.ts`
 * hielt vier Pastell-Hex für die Matrixzellen — begründet (ein gesättigter Rollenton
 * macht den Zellinhalt unlesbar), aber am falschen Ort und OHNE Nachtmodus-Gegenwert.
 * Beides ist erledigt: {@link warnstufeFlaeche} bildet die Stufen auf die
 * Füllungsrollen aus `tokens.ts` ab, {@link flaechenFarbe} löst sie je Modus auf.
 *
 * Die Sorte bleibt getrennt, der Ort nicht mehr: „eine Quelle für Statusfarbe" gilt
 * jetzt für Etikett UND Fläche, und die Fläche kommt mit einem eigenen Typ
 * ({@link Flaechendarstellung}), weil eine Füllung keine {@link Statusrolle} ist.
 * Wer eine VIERTE Sorte braucht, benennt sie hier — still danebenzubauen ist der
 * Fehler, nicht das Danebenbauen selbst.
 *
 * Gefunden im Code-Review zu LFH-328: `pages/lagekarte/ZonenInspector.tsx` benutzte
 * `warnstufeFarbe` für ein Status-Etikett und ist auf {@link warnstufeKarte} gezogen
 * worden. LFH-368 hat denselben Fehlgriff in `pages/gefahren/GefahrenPage.tsx`
 * gefunden und ebenso behandelt — ein Guard „kein `Tag color=` über einem
 * Vertrags-Enum außerhalb `theme/`" wäre die maschinelle Fassung dieser Grenze und
 * ist als Folge-Ticket erfasst.
```

- [ ] **Step 11: Commit**

```bash
git add frontend/src/theme/
git commit -m "feat(lfh-368): die Warnstufen-Flaeche zieht in den Farbvertrag, mit Nachtmodus

Zwei Intensitaeten der vorhandenen Fuellungsrollen statt fuenf neuer Farbwerte:
fuenf unterscheidbare Flaechen, drei Farbtoene. Die Pastelltoene in pages/ hatten
kein Nachtmodus-Paar — vier grelle Helligkeitsblocke im Dunkelmodus.

Beruehrt die A0-Schicht (Farbrollen) und ist damit breiter als das B5h-Buendel,
aber rein additiv: kein bestehender Konsument aendert sich. LFH-368"
```

---

### Task 2: Die zwei Neubefunde in `GefahrenPage.tsx` — und `warnstufeFarbe` fällt

**Files:**
- Modify: `frontend/src/pages/gefahren/GefahrenPage.tsx:13/117/120/141`
- Modify: `frontend/src/pages/gefahren/gefahrenSchema.ts:54-64` (löschen)
- Modify: `frontend/src/pages/gefahren/gefahrenSchema.test.ts:2/27-33`
- Modify: `frontend/src/pages/lage-dashboard/lagebild.ts:122-137`
- Test: `frontend/src/pages/gefahren/GefahrenPage.test.tsx`, `frontend/src/pages/gefahren/gefahrenSchema.test.ts`

**Interfaces:**
- Consumes: `warnstufeKarte`, `rollenFarbe` aus Task 1 bzw. Bestand.
- Produces: `gefahrenSchema.ts` exportiert nur noch `GEFAHRENTYPEN`, `SCHUTZOBJEKTE`, `WARNSTUFEN`, `kombinationGueltig`, `Katalogeintrag`.

- [ ] **Step 1: Den Byte-Pin umziehen, nicht löschen**

`gefahrenSchema.test.ts`: Import und der dritte Fall verlieren `warnstufeFarbe`. Der Pin ist in
Task 1 Step 6 bereits als Literal in `statusFarben.test.ts` angekommen — hier bleibt ein Zeiger
darauf, damit niemand ihn ein zweites Mal erfindet:

```ts
import { GEFAHRENTYPEN, SCHUTZOBJEKTE, WARNSTUFEN, kombinationGueltig } from './gefahrenSchema';
```

```ts
  // `warnstufeFarbe` war hier byte-genau gepinnt (`akut` = '#ff4d4f'). Die Skala liegt
  // seit LFH-368 als `warnstufeFlaeche`/`flaechenFarbe` in `theme/statusFarben.ts`,
  // der Pin steht dort auf den zwei neuen Fuellungswerten. Nicht hier neu aufbauen —
  // sonst prueft eine Kopie in `pages/` wieder Farbwerte, die `theme/` besitzt.
```

- [ ] **Step 2: Den fehlschlagenden Test für die Tag-Fehlanwendung schreiben**

In `GefahrenPage.test.tsx`. Der Befund ist nicht „falsche Farbe", sondern **falsche
Darstellungssorte**: ein Etikett trägt eine Flächenfarbe. Prüfbar ist, dass der Tag den Text der
Stufe trägt und keinen `rgba(...)`-Inline-Wert im `style` — das ist die Signatur des Fehlgriffs.

Die Datei hat dafür schon ein Gerüst: `renderPage()` (Zeile ~30) rendert die Seite unter ihrer
echten Route, `handlers(gebiete, matrix)` setzt die MSW-Antworten. Beide benutzen, keine zweite
Variante bauen. Das Gebiet aus `handlers()` braucht `hoechste_warnstufe: 'hoch'` — steht es dort
auf `'keine'`, den Fall mit einem eigenen `server.use(...handlers([{ ...gebiet,
hoechste_warnstufe: 'hoch' }]))` vorbereiten.

```tsx
it('zeigt die höchste Warnstufe als Etikett, nicht als Flächenfarbe (LFH-368)', async () => {
  renderPage();
  const tag = await screen.findByText('hoch');
  // Der PASTELLWERT ist die Signatur des Fehlgriffs: `warnstufeFarbe('hoch')` = '#ffa39e'
  // landete als Inline-Hintergrund am Etikett. Geprüft wird seine ABWESENHEIT, nicht der
  // neue Wert — den positiv zu pinnen prüfte antds Vorgaben, weil `test/utils.tsx` ein
  // nacktes `ConfigProvider` rendert (dieselbe Falle wie bei Höhen).
  expect(tag.closest('.ant-tag')!.getAttribute('style') ?? '').not.toContain('#ffa39e');
});
```

Der Text taugt hier **nicht** als Behauptung: `warnstufeKarte.hoch.label` ist ebenfalls `'hoch'`,
das Etikett liest sich vor und nach dem Fix gleich.

- [ ] **Step 3: Lauf zur Bestätigung, dass er fehlschlägt**

Run: `mise exec pnpm@10 -- pnpm -C <abs>/frontend exec vitest run src/pages/gefahren/GefahrenPage.test.tsx`
Expected: FAIL — heute steht `#ffa39e` im `style` des Tags. **Wenn er grün startet, ist die
Behauptung falsch gebaut, nicht der Code schon richtig:** dann per Mutationsprobe klären (Wert im
`style` suchen, den antd aus `color=` erzeugt) statt weiterzugehen.

- [ ] **Step 4: Beide Neubefunde beheben**

`GefahrenPage.tsx`: Import umstellen, Etikett auf die Rolle ziehen, das hartkodierte antd-Blau
durch die Rolle `bedien` ersetzen. `token` kommt aus `theme.useToken()` — die Datei hat ihn noch
nicht, also oben ergänzen.

```tsx
import { Alert, App, Button, Space, Spin, Tag, Typography, theme } from 'antd';
import { rollenFarbe, warnstufeKarte } from '../../theme/statusFarben';
```

```tsx
  const { token } = theme.useToken();
```

```tsx
          <ListenEintrag
            onClick={() => setGewaehlt(g.id)}
            style={{
              cursor: 'pointer',
              // Die Rolle `bedien`, nicht antds Default-Blau: `rgba(22,119,255,0.08)`
              // stand hier hartkodiert und blieb im Nachtmodus derselbe helle Schleier
              // auf dunklem Grund (LFH-368). `colorPrimaryBg` leitet antd aus
              // `colorPrimary` ab — also aus unserer Rolle, in beiden Modi.
              background: g.id === gewaehlt ? token.colorPrimaryBg : undefined,
            }}
          >
            <Space>
              {/* Etikett, nicht Fläche: `warnstufeKarte` liefert die Rolle, `rollenFarbe`
                  den Wert des aktiven Modus. Vorher stand hier `warnstufeFarbe` — dieselbe
                  Sortenverwechslung, die LFH-328 in `ZonenInspector.tsx` behoben hat. */}
              <Tag color={rollenFarbe(warnstufeKarte[g.hoechste_warnstufe].rolle, token)}>
                {warnstufeKarte[g.hoechste_warnstufe].label}
              </Tag>
```

- [ ] **Step 5: `warnstufeFarbe` aus `gefahrenSchema.ts` entfernen**

Die Funktion `:54-64` und den Import von `Warnstufe` löschen (er wird sonst zu einem ungenutzten
Import und bricht `pnpm lint` mit `--max-warnings 0`). `Gefahrentyp`/`Schutzobjekt` bleiben.

- [ ] **Step 6: Test grün, Lint sauber**

Run: `mise exec pnpm@10 -- pnpm -C <abs>/frontend exec vitest run src/pages/gefahren/ src/pages/lage-dashboard/`
Expected: PASS
Run: `mise exec pnpm@10 -- pnpm -C <abs>/frontend run lint`
Expected: keine Warnung (`--max-warnings 0`).

- [ ] **Step 7: Den zweiten Vertragsabsatz mitziehen**

`lagebild.ts:127`. Der Satz „Es GIBT eine dritte, und sie ist bewusst draußen" ist ab Task 1
falsch:

```
 * Es GIBT eine dritte — die FLÄCHE der Gefahrenmatrix —, und sie liegt seit LFH-368
 * nicht mehr draußen: `theme/statusFarben.ts:warnstufeFlaeche` bildet die Stufen auf
 * die Füllungsrollen ab, `flaechenFarbe` löst sie je Modus auf. Alle drei Lesarten
 * stehen damit im selben Vertrag; welche gilt, entscheidet die Darstellungssorte
 * (Kennzahl · Objektsignatur · Fläche), nicht der Aufrufort.
```

- [ ] **Step 8: Commit**

```bash
git add frontend/src/pages/gefahren/ frontend/src/pages/lage-dashboard/lagebild.ts
git commit -m "fix(lfh-368): das Gebiets-Etikett trug eine Flaechenfarbe, die Auswahl antds Blau

Zwei Befunde, die kein Gate sieht: Tag color= mit warnstufeFarbe (dieselbe
Sortenverwechslung wie LFH-328 in ZonenInspector) und rgba(22,119,255,0.08)
hartkodiert — im Nachtmodus derselbe helle Schleier auf dunklem Grund.

warnstufeFarbe entfaellt damit; der Byte-Pin zieht mit statt zu verschwinden,
und beide Vertragsabsaetze (statusFarben, lagebild) bekommen eine neue
Schlussfolgerung statt eines neuen Pfades. LFH-368"
```

---

### Task 3: Eine Zelle, ein Auslöser — Stufe und Details gebündelt

**Files:**
- Modify: `frontend/src/pages/gefahren/GefahrenMatrix.tsx` (vollständig neu aufgebaut)
- Create: `frontend/src/pages/gefahren/GefahrenZelleDetails.tsx`
- Modify: `frontend/src/pages/gefahren/GefahrenMatrix.test.tsx` (Fall 1 bleibt, 3 Fälle neu)
- Modify: `frontend/src/pages/gefahren/GefahrenPage.tsx:151-156` (neue Prop `laufendeZelle`)

**Interfaces:**
- Consumes: `warnstufeFlaeche`, `flaechenFarbe` (Task 1) · `kombinationGueltig`, `GEFAHRENTYPEN`,
  `SCHUTZOBJEKTE`, `WARNSTUFEN` (`gefahrenSchema.ts`) · `ErfassungsModal` (`components/Erfassung.tsx`).
- Produces:
  - `GefahrenMatrixProps` **geändert**: `pending: boolean` → `laufendeZelle: string | null`
    (Format `` `${Gefahrentyp}×${Schutzobjekt}` ``), plus **neu** `onDetailsSpeichern:
    (daten: BewertungEingabe) => Promise<unknown>` und unveränderte `matrix`, `darfSchreiben`,
    `onSetzen`.
  - `export function zellSchluessel(typ: Gefahrentyp, objekt: Schutzobjekt): string` — dieselbe
    Funktion bildet den Schlüssel in Matrix und Seite, damit die Sperre nicht an zwei
    Schreibweisen hängt.
  - `GefahrenZelleDetails`-Props: `{ offen: boolean; zelle: GefahrBewertung | null; titel: string;
    laeuft: boolean; onSpeichern: (b: string | null, g: string | null) => Promise<unknown>;
    onSchliessen: () => void }`

- [ ] **Step 1: Die drei brechenden Testfälle neu schreiben**

`GefahrenMatrix.test.tsx`. Fall 1 (`rendert 13 Zeilen × 5 Spalten`) behält seinen **Rumpf** — er
nutzt nur `getAllByText` und überlebt jeden Bedienformwechsel —, **seine Props-Zeile aber nicht**:
`pending={false}` heißt jetzt `laufendeZelle={null}`, sonst bricht `tsc`. Der Fall wird also
angefasst, nur nicht neu erfunden. Die anderen drei greifen auf antd-Select-Internals zu und
werden ersetzt. Neu dazu: die Zeilenkennung im zugänglichen Namen und die Zell-Sperre.

```tsx
/** Der Eintrag wird IMMER über das geöffnete Menü gegriffen: antd lässt die Portale
 *  geschlossener Dropdowns im Baum stehen, ein globales getByText träfe auch sie. */
function imMenue() {
  const menue = document.querySelector('.ant-dropdown:not(.ant-dropdown-hidden) [role="menu"]');
  if (!menue) throw new Error('kein offenes Menü im Baum');
  return within(menue as HTMLElement);
}

/** Ein Ort für die Pflichtprops. Ohne den trägt jeder der sechs Fälle vier Zeilen
 *  Gerüst, und eine neue Prop hieße sechs Änderungen. */
function rendereMatrix(over: Partial<GefahrenMatrixProps> = {}) {
  return renderMitProviders(
    <GefahrenMatrix
      matrix={[]}
      darfSchreiben
      laufendeZelle={null}
      onSetzen={() => {}}
      onDetailsSpeichern={async () => {}}
      {...over}
    />,
  );
}

it('setzt eine Warnstufe über das Zellmenü und ruft onSetzen mit vollem Zell-Zustand', async () => {
  const onSetzen = vi.fn();
  rendereMatrix({ onSetzen });
  await userEvent.click(screen.getByRole('button', { name: 'Bewertung Brand × Menschen: keine' }));
  await userEvent.click(imMenue().getByRole('menuitem', { name: /hoch/ }));
  await waitFor(() => expect(onSetzen).toHaveBeenCalledWith({
    gefahrentyp: 'brand', schutzobjekt: 'menschen', warnstufe: 'hoch',
    beschreibung: null, gemeldet_von: null,
  }));
});

it('gibt jeder Zelle einen eigenen Namen — 65 gleichnamige Knöpfe wären keine Bedienung', () => {
  rendereMatrix();
  const namen = screen.getAllByRole('button').map((b) => b.getAttribute('aria-label'));
  const bewertungen = namen.filter((n) => n?.startsWith('Bewertung '));
  expect(bewertungen).toHaveLength(58); // 65 − 7 ungültige Kombinationen
  expect(new Set(bewertungen).size).toBe(bewertungen.length);
});

it('macht die 7 ungültigen Kombinationen ohne Farbe erkennbar — und unbedienbar', () => {
  rendereMatrix();
  // Zweiter Kanal ist TEXT: die Zelle sagt „nicht anwendbar", statt nur blass zu sein.
  expect(screen.getAllByText('n. a.')).toHaveLength(7);
  expect(
    screen.queryByRole('button', { name: /Bewertung Atemgifte × Sachwerte/ }),
  ).not.toBeInTheDocument();
});

it('behält beschreibung/gemeldet_von bei Warnstufen-Wechsel', async () => {
  const onSetzen = vi.fn();
  const matrix = [zelle({ warnstufe: 'hoch', beschreibung: 'Dachstuhl', gemeldet_von: 'KdoW' })];
  rendereMatrix({ matrix, onSetzen });
  await userEvent.click(screen.getByRole('button', { name: 'Bewertung Brand × Menschen: hoch' }));
  await userEvent.click(imMenue().getByRole('menuitem', { name: /akut/ }));
  await waitFor(() => expect(onSetzen).toHaveBeenCalledWith({
    gefahrentyp: 'brand', schutzobjekt: 'menschen', warnstufe: 'akut',
    beschreibung: 'Dachstuhl', gemeldet_von: 'KdoW',
  }));
});

it('sperrt beim laufenden PUT NUR die betroffene Zelle, nicht die anderen 57', () => {
  rendereMatrix({ laufendeZelle: 'brand×menschen' });
  // antd klont den Auslöser mit `disabled` (`antd/es/dropdown/dropdown.js:125`:
  // `disabled: child.props.disabled ?? disabled`) — die Prop am Dropdown erreicht
  // also wirklich den Knopf, nicht nur das Popup.
  expect(screen.getByRole('button', { name: 'Bewertung Brand × Menschen: keine' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Bewertung Brand × Tiere: keine' })).toBeEnabled();
});

it('zeigt die Stufe als Kürzel — die Fläche allein wäre der einzige Kanal', () => {
  rendereMatrix({ matrix: [zelle({ warnstufe: 'akut' })] });
  const knopf = screen.getByRole('button', { name: 'Bewertung Brand × Menschen: akut' });
  expect(knopf).toHaveTextContent('A');
});
```

`within` in die Import-Zeile der Testdatei aufnehmen, `GefahrenMatrixProps` für den Helfer:

```tsx
import { screen, waitFor, within } from '@testing-library/react';
import GefahrenMatrix, { type GefahrenMatrixProps } from './GefahrenMatrix';
```

- [ ] **Step 2: Lauf zur Bestätigung, dass sie fehlschlagen**

Run: `mise exec pnpm@10 -- pnpm -C <abs>/frontend exec vitest run src/pages/gefahren/GefahrenMatrix.test.tsx`
Expected: FAIL — `laufendeZelle` ist keine Prop, es gibt keine `button`-Rolle mit diesen Namen.

- [ ] **Step 3: Den Detail-Dialog anlegen**

`GefahrenZelleDetails.tsx` — zwei Felder, damit im Feldbudget (Modal ≤ ~3). Die Hülle bringt
Enter-Absenden, Fokus im ersten Feld und Zurücksetzen auf allen Wegen mit; `onSpeichern` gibt ein
Promise zurück, weil die Hülle bei Ablehnung die Werte stehen lassen muss.

```tsx
import { Form, Input } from 'antd';
import { useEffect } from 'react';
import { ErfassungsModal } from '../../components/Erfassung';
import type { GefahrBewertung } from '../../api/types';

interface Werte {
  beschreibung?: string;
  gemeldet_von?: string;
}

export interface GefahrenZelleDetailsProps {
  offen: boolean;
  /** Die bewertete Zelle. `null`, solange keine gewählt ist. */
  zelle: GefahrBewertung | null;
  /** „Brand × Menschen" — steht im Dialogtitel. */
  titel: string;
  laeuft: boolean;
  onSpeichern: (beschreibung: string | null, gemeldetVon: string | null) => Promise<unknown>;
  onSchliessen: () => void;
}

/**
 * Beschreibung und Meldeweg einer Matrixzelle. Nimmt `ErfassungsModal` statt eines
 * handgebauten `<Modal>` + `<Form>` (Erfassungs-Norm LFH-332/B4) — vorher war das ein
 * `Popover` mit einem Knopf AUSSERHALB des Formulars, in dem Enter tot war.
 *
 * Vorbelegen zum Bearbeiten ist ausdrücklich kein Reset (Norm B4): `setFieldsValue`
 * beim Öffnen bleibt Aufgabe des Aufrufers, das Leeren übernimmt die Hülle.
 */
export default function GefahrenZelleDetails({
  offen, zelle, titel, laeuft, onSpeichern, onSchliessen,
}: GefahrenZelleDetailsProps) {
  const [form] = Form.useForm<Werte>();

  useEffect(() => {
    if (offen) {
      form.setFieldsValue({
        beschreibung: zelle?.beschreibung ?? '',
        gemeldet_von: zelle?.gemeldet_von ?? '',
      });
    }
  }, [offen, zelle, form]);

  return (
    <ErfassungsModal
      offen={offen}
      titel={`Details ${titel}`}
      form={form}
      laeuft={laeuft}
      erfassenText="Speichern"
      onErfassen={(w) =>
        onSpeichern(w.beschreibung?.trim() || null, w.gemeldet_von?.trim() || null)
      }
      onFertig={onSchliessen}
      onAbbrechen={onSchliessen}
    >
      <Form.Item name="beschreibung" label="Beschreibung">
        <Input.TextArea rows={3} />
      </Form.Item>
      <Form.Item name="gemeldet_von" label="Gemeldet von">
        <Input />
      </Form.Item>
    </ErfassungsModal>
  );
}
```

- [ ] **Step 4: Die Matrix neu aufbauen**

`GefahrenMatrix.tsx` vollständig. Vier Punkte, die dabei zusammenfallen: kein `size="small"` mehr
(4 Stellen), ein Auslöser je Zelle statt Select + Popover, Spaltenköpfe als Icon + Kurzlabel,
`sticky` für die stehende Kopfzeile (der benannte Restposten der Guard-Ausnahme).

```tsx
import { useState } from 'react';
import { Button, Dropdown, Space, Table, Tooltip, Typography, theme } from 'antd';
import { TbBuildingCommunity, TbPaw, TbPlant2, TbShieldHalf, TbUsers } from 'react-icons/tb';
import type { IconType } from 'react-icons';
import type { TableColumnsType } from 'antd';
import type { GefahrBewertung, Gefahrentyp, Schutzobjekt, Warnstufe } from '../../api/types';
import type { BewertungEingabe } from '../../api/gefahren';
import { flaechenFarbe, warnstufeFlaeche } from '../../theme/statusFarben';
import { GEFAHRENTYPEN, SCHUTZOBJEKTE, WARNSTUFEN, kombinationGueltig } from './gefahrenSchema';
import GefahrenZelleDetails from './GefahrenZelleDetails';

interface ZeilenDaten { typ: Gefahrentyp; label: string; }

/** Symbol + Kurzform je Schutzobjekt. Der Kopf trug vorher das volle Wort und war mit
 *  ~85 px nie breitenbestimmend — die Zelle ist es. Das Symbol ist deshalb Gewinn an
 *  Lesbarkeit, nicht an Breite; das Kurzwort bleibt als zweiter Kanal daneben stehen. */
const SPALTENKOPF: Record<Schutzobjekt, { icon: IconType; kurz: string }> = {
  menschen: { icon: TbUsers, kurz: 'Mensch' },
  tiere: { icon: TbPaw, kurz: 'Tier' },
  umwelt: { icon: TbPlant2, kurz: 'Umwelt' },
  sachwerte: { icon: TbBuildingCommunity, kurz: 'Sache' },
  einsatzkraefte: { icon: TbShieldHalf, kurz: 'Kraft' },
};

/** EINE Schreibweise für die Zell-Identität. Die Seite bildet den Schlüssel der
 *  laufenden Mutation mit derselben Funktion — zwei Schreibweisen und die Sperre
 *  greift stillschweigend nie. */
export function zellSchluessel(typ: Gefahrentyp, objekt: Schutzobjekt): string {
  return `${typ}×${objekt}`;
}

export interface GefahrenMatrixProps {
  matrix: GefahrBewertung[];
  darfSchreiben: boolean;
  /**
   * Die Zelle, deren PUT unterwegs ist (`zellSchluessel`), oder `null`.
   *
   * Vorher stand hier `pending: boolean` und sperrte alle 58 bedienbaren Zellen —
   * in einer Maske, die im Minutentakt bedient wird, ein Vollstopp pro Klick.
   */
  laufendeZelle: string | null;
  /** Stufenwechsel aus dem Menü. Kein Formularzustand zu schützen → `mutate` genügt. */
  onSetzen: (daten: BewertungEingabe) => void;
  /**
   * Speichern aus dem Detail-Dialog. **Muss bei Ablehnung ablehnen** — also
   * `mutateAsync`, nicht `mutate` (`components/Erfassung.tsx:121-124`).
   *
   * Zwei Wege statt einem, weil sie verschieden enden: ein abgelehnter Stufenwechsel
   * kostet nichts, ein abgelehntes Detail-Speichern kostet den getippten Wortlaut. Gäbe
   * es hier nur `onSetzen` (`=> void`), löste die Hülle sofort auf, leerte die Felder
   * und schlösse den Dialog — auch bei 422. Genau der Fehler, gegen den die Hülle
   * gebaut wurde.
   */
  onDetailsSpeichern: (daten: BewertungEingabe) => Promise<unknown>;
}

/** Das 13×5-Raster eines Gefahrengebiets. Einziger Konsument ist `GefahrenPage`;
 *  der frühere Hinweis auf einen „Karten-Drawer" beschrieb keinen. */
export default function GefahrenMatrix({
  matrix, darfSchreiben, laufendeZelle, onSetzen, onDetailsSpeichern,
}: GefahrenMatrixProps) {
  const { token } = theme.useToken();
  const [detailZelle, setDetailZelle] = useState<GefahrBewertung | null>(null);

  const zelleVon = (typ: Gefahrentyp, objekt: Schutzobjekt) =>
    matrix.find((m) => m.gefahrentyp === typ && m.schutzobjekt === objekt);

  const spalten: TableColumnsType<ZeilenDaten> = [
    { title: 'Gefahr', dataIndex: 'label', key: 'label', fixed: 'left', width: 180 },
    ...SCHUTZOBJEKTE.map((obj) => {
      const { icon: Icon, kurz } = SPALTENKOPF[obj.wert];
      return {
        key: obj.wert,
        title: (
          <Tooltip title={obj.label}>
            <Space size={token.marginXS}>
              <Icon aria-hidden size={16} />
              <span>{kurz}</span>
            </Space>
          </Tooltip>
        ),
        onCell: (zeile: ZeilenDaten) => ({
          style: {
            backgroundColor: flaechenFarbe(
              zelleVon(zeile.typ, obj.wert)?.warnstufe ?? 'keine',
              token,
            ),
            textAlign: 'center' as const,
          },
        }),
        render: (_: unknown, zeile: ZeilenDaten) => {
          if (!kombinationGueltig(zeile.typ, obj.wert)) {
            // Zweiter Kanal für den gesperrten Zustand ist TEXT, nicht Blässe (WCAG 1.4.1):
            // eine ausgegraute Fläche ohne Wort ist von „noch nicht bewertet" nicht zu
            // unterscheiden. Kein Knopf — ein deaktivierter Auslöser gibt vor, es gäbe
            // hier eine Entscheidung.
            return (
              <Typography.Text type="secondary" aria-label={`${zeile.label} × ${obj.label}: nicht anwendbar`}>
                n. a.
              </Typography.Text>
            );
          }
          const zelle = zelleVon(zeile.typ, obj.wert);
          const aktuell: Warnstufe = zelle?.warnstufe ?? 'keine';
          const schluessel = zellSchluessel(zeile.typ, obj.wert);
          const items = [
            ...WARNSTUFEN.map((w) => ({
              key: w.wert,
              label: `${warnstufeFlaeche[w.wert].kuerzel} · ${w.label}`,
            })),
            ...(zelle ? [{ type: 'divider' as const }, { key: 'details', label: 'Details …' }] : []),
          ];
          return (
            <Dropdown
              trigger={['click']}
              disabled={!darfSchreiben || laufendeZelle === schluessel}
              menu={{
                items,
                autoFocus: true,
                // Zuordnung AM MENÜ, nicht je Eintrag: ein Riegel hat dann einen Ort,
                // und das Synthetic Event des Portals steigt nicht in einen klickbaren
                // Elternteil (Muster und Falle aus LFH-365).
                onClick: ({ key }) => {
                  if (key === 'details') { setDetailZelle(zelle ?? null); return; }
                  onSetzen({
                    gefahrentyp: zeile.typ,
                    schutzobjekt: obj.wert,
                    warnstufe: key as Warnstufe,
                    beschreibung: zelle?.beschreibung ?? null,
                    gemeldet_von: zelle?.gemeldet_von ?? null,
                  });
                },
              }}
            >
              <Button
                type="text"
                // Der Name trägt die ZEILENKENNUNG und die Stufe: 58 gleichnamige
                // Knöpfe wären für Screenreader und Test gleich unbrauchbar.
                aria-label={`Bewertung ${zeile.label} × ${obj.label}: ${warnstufeFlaeche[aktuell].label}`}
                // Keine Größen-Prop: die Trefffläche kommt vom ConfigProvider
                // (30/48/72). `minWidth` = Höhe hält die Zelle quadratisch, damit die
                // Matrix in jeder Dichtestufe im Breitenbudget bleibt.
                style={{ minWidth: token.controlHeight }}
              >
                {warnstufeFlaeche[aktuell].kuerzel}
              </Button>
            </Dropdown>
          );
        },
      };
    }),
  ];
  const zeilen: ZeilenDaten[] = GEFAHRENTYPEN.map((g) => ({ typ: g.wert, label: g.label }));

  return (
    <>
      <Table<ZeilenDaten>
        rowKey="typ"
        columns={spalten}
        dataSource={zeilen}
        pagination={false}
        // Stehende Kopfzeile — der benannte Restposten der Guard-Ausnahme in
        // `katalogTabelle.guard.test.ts`. 13 Zeilen scrollen im Fükw nicht, auf dem
        // Handschirm schon.
        sticky
        scroll={{ x: 'max-content' }}
      />
      <GefahrenZelleDetails
        offen={detailZelle !== null}
        zelle={detailZelle}
        titel={
          detailZelle
            ? `${GEFAHRENTYPEN.find((g) => g.wert === detailZelle.gefahrentyp)?.label ?? detailZelle.gefahrentyp}`
              + ` × ${SCHUTZOBJEKTE.find((s) => s.wert === detailZelle.schutzobjekt)?.label ?? detailZelle.schutzobjekt}`
            : ''
        }
        laeuft={detailZelle !== null && laufendeZelle === zellSchluessel(detailZelle.gefahrentyp, detailZelle.schutzobjekt)}
        // `onDetailsSpeichern`, NICHT `onSetzen`: die Hülle darf die Felder nur leeren,
        // wenn der PUT angenommen wurde. Das zurückgegebene Promise ist die Zusage —
        // ein `async`-Wrapper um ein `=> void` wäre eine Zusage ohne Deckung.
        onSpeichern={(beschreibung, gemeldetVon) =>
          onDetailsSpeichern({
            gefahrentyp: detailZelle!.gefahrentyp,
            schutzobjekt: detailZelle!.schutzobjekt,
            warnstufe: detailZelle!.warnstufe,
            beschreibung,
            gemeldet_von: gemeldetVon,
          })
        }
        onSchliessen={() => setDetailZelle(null)}
      />
    </>
  );
}
```

- [ ] **Step 5: Die Seite auf die neue Prop ziehen**

`GefahrenPage.tsx`. Die Mutation muss wissen, welche Zelle läuft — `useMutation` trägt die
Variablen bereits mit (`setzen.variables`), ein zweiter State wäre eine zweite Wahrheit.

```tsx
import GefahrenMatrix, { zellSchluessel } from './GefahrenMatrix';
```

```tsx
          <GefahrenMatrix
            matrix={matrixQuery.data ?? []}
            darfSchreiben={darfSchreiben}
            // Nur die Zelle des laufenden PUT sperren. `variables` kommt von TanStack
            // Query und ist genau die Eingabe der laufenden Mutation — kein
            // Parallel-State, der auseinanderlaufen kann.
            laufendeZelle={
              setzen.isPending && setzen.variables
                ? zellSchluessel(setzen.variables.gefahrentyp, setzen.variables.schutzobjekt)
                : null
            }
            onSetzen={(d) => setzen.mutate(d)}
            // `mutateAsync`: der Detail-Dialog braucht die Ablehnung, sonst leert die
            // Erfassungshülle den getippten Wortlaut trotz 422. Den Toast macht weiterhin
            // `onError: fehler`; die abgelehnte Zusage fängt `abschicken` in der Hülle
            // (`Erfassung.tsx`, `catch {}`) — also keine unbehandelte Ablehnung.
            onDetailsSpeichern={(d) => setzen.mutateAsync(d)}
          />
```

- [ ] **Step 5b: Die Zusage prüfen, nicht nur behaupten**

Ein Kommentar „muss bei Ablehnung ablehnen" ist keine Zusicherung. Der Fall gehört in
`GefahrenMatrix.test.tsx` — er ist der einzige, der den Unterschied zwischen `mutate` und
`mutateAsync` überhaupt sichtbar macht:

```tsx
it('hält den Detail-Wortlaut, wenn das Speichern abgelehnt wird', async () => {
  const onDetailsSpeichern = vi.fn().mockRejectedValue(new Error('422'));
  rendereMatrix({ matrix: [zelle({ warnstufe: 'hoch' })], onDetailsSpeichern });
  await userEvent.click(screen.getByRole('button', { name: 'Bewertung Brand × Menschen: hoch' }));
  await userEvent.click(imMenue().getByRole('menuitem', { name: 'Details …' }));
  const feld = await screen.findByLabelText('Beschreibung');
  await userEvent.type(feld, 'Dachstuhl brennt');
  await userEvent.click(screen.getByRole('button', { name: 'Speichern' }));
  await waitFor(() => expect(onDetailsSpeichern).toHaveBeenCalled());
  // Nicht geleert, nicht geschlossen — der Wortlaut ist teurer als der Klick.
  expect(await screen.findByLabelText('Beschreibung')).toHaveValue('Dachstuhl brennt');
});
```

Mutationsprobe dazu: `onDetailsSpeichern` in der Matrix versuchsweise auf `onSetzen` umbiegen
(also die Zusage entwerten) — dieser Fall **muss** dann rot werden. Wird er es nicht, prüft er
etwas anderes als gedacht.

- [ ] **Step 6: Tests grün**

Run: `mise exec pnpm@10 -- pnpm -C <abs>/frontend exec vitest run src/pages/gefahren/`
Expected: PASS (alle Fälle beider Dateien).

- [ ] **Step 7: Den Dichte-Guard messen, nicht schätzen**

Run: `mise exec pnpm@10 -- pnpm -C <abs>/frontend exec vitest run src/components/dichte.guard.test.ts`
Expected: FAIL mit `tote Schuld-Ausnahme` für **beide** Gefahren-Dateien — der Beweis, dass die 5
Stellen weg sind. Bleibt eine Datei ohne Befund unerwähnt, ist noch eine Größen-Prop drin.

- [ ] **Step 8: Commit**

```bash
git add frontend/src/pages/gefahren/
git commit -m "feat(lfh-368): eine Matrixzelle, ein Ausloeser — Stufe und Details im selben Menue

65 Mini-Selects (22,5 px) werden zu 58 dichte-treuen Auslosern; der zweite
Ausloeser je Zelle (Details-Popover) zieht als Menueeintrag mit ein und laeuft
jetzt ueber ErfassungsModal, wo Enter sendet.

Gemessenes Breitenbudget: 693 px stehen zur Verfuegung (Fuekw 1280 minus Rinne,
Rail, Modulpanel, Gebietsliste) — ein 5-Wege-Segmented braucht 1050. Der eine
Ausloeser je Zelle traegt die Matrix in JEDER Dichtestufe darunter.

Nebenher: pending sperrt nicht mehr alle 58 Zellen, sondern die eine, deren PUT
unterwegs ist. LFH-368"
```

---

### Task 4: Schmalschirm — messen, dann festschreiben

**Files:**
- Modify: `frontend/src/pages/gefahren/GefahrenPage.tsx:107-129`
- Test: `frontend/src/pages/gefahren/GefahrenPage.test.tsx`

**Interfaces:**
- Consumes: `useViewport().abBreite` (`components/useViewport.ts`) — dieselbe Achse, die
  `EinsatzLayout.tsx:100-101` liest. Kein eigener `matchMedia`-Aufruf: `useViewport` hat das
  Monopol (`components/useViewport.guard.test.ts`).

- [ ] **Step 1: Den fehlschlagenden Test für die Stapelung schreiben**

Die Behauptung ist die **Richtung des Flex-Containers**, nicht eine Pixelbreite — jsdom rechnet
kein Layout, eine Höhen- oder Überlappungsaussage wäre hier wertlos.

Der Helfer heißt `setzeViewportBreite(px)` und kommt aus `frontend/src/test/viewport.ts` — dem
breitenbewussten `matchMedia`-Stub aus LFH-329/B1. Er wird **vor** dem Render gesetzt (er feuert
kein Änderungsereignis, für den ersten Paint genügt der Zustand), und `setup.ts` setzt ihn im
globalen `afterEach` selbst zurück. Kein eigener `matchMedia`-Stub, kein `window.innerWidth` von
Hand: `useViewport` hat das Monopol, und der Default des Stubs ist `VIEWPORT_STANDARD` = 1024 —
also bereits „breit" auf beiden Achsen.

```tsx
import { setzeViewportBreite } from '../../test/viewport';
```

```tsx
it('stapelt Gebietsliste und Matrix unter lg, statt sie nebeneinander zu quetschen', async () => {
  setzeViewportBreite(800); // < lg (992)
  renderPage();
  const rahmen = (await screen.findByRole('list')).closest('[data-gefahren-rahmen]')!;
  expect(rahmen).toHaveStyle({ flexDirection: 'column' });
});

it('stellt sie ab lg nebeneinander', async () => {
  setzeViewportBreite(1280);
  renderPage();
  const rahmen = (await screen.findByRole('list')).closest('[data-gefahren-rahmen]')!;
  expect(rahmen).toHaveStyle({ flexDirection: 'row' });
});
```

Die zwei Fälle sind **zusammen** die Behauptung: nur „column bei 800" wäre auch erfüllt, wenn die
Richtung fest `column` stünde.

- [ ] **Step 2: Lauf zur Bestätigung, dass er fehlschlägt**

Run: `mise exec pnpm@10 -- pnpm -C <abs>/frontend exec vitest run src/pages/gefahren/GefahrenPage.test.tsx`
Expected: FAIL — es gibt kein `data-gefahren-rahmen`, die Richtung ist fest `row`.

- [ ] **Step 3: Die Stapelung umsetzen**

```tsx
  const { abBreite } = useViewport();
  const breit = abBreite('lg');
```

```tsx
    <div
      data-gefahren-rahmen
      style={{
        display: 'flex',
        // Unter `lg` stapeln — dieselbe Schwelle, an der der Einsatzrahmen seine
        // Navigation in den Drawer legt (`EinsatzLayout.tsx`). KEIN zweites Layout für
        // die Matrix selbst: mit einem Auslöser je Zelle liegt sie bei ~380 px und
        // trägt damit auch auf ~390 px. Ein Collapse je Gefahrentyp wäre eine zweite
        // Bedienform für dieselbe Sache — begründet in der Prüfliste, Kriterium 2.
        flexDirection: breit ? 'row' : 'column',
        gap: 16,
        alignItems: breit ? 'flex-start' : 'stretch',
      }}
    >
      <Liste
        style={breit ? { width: 240, flexShrink: 0 } : { width: '100%' }}
```

- [ ] **Step 4: Tests grün**

Run: `mise exec pnpm@10 -- pnpm -C <abs>/frontend exec vitest run src/pages/gefahren/`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/gefahren/GefahrenPage.tsx frontend/src/pages/gefahren/GefahrenPage.test.tsx
git commit -m "feat(lfh-368): unter lg stapeln Gebietsliste und Matrix

Kein zweites Layout fuer die Matrix: mit einem Ausloeser je Zelle liegt sie bei
~380 px und traegt auch auf ~390 px. Geprueft wird die Flex-Richtung, nicht eine
Pixelbreite — jsdom rechnet kein Layout. LFH-368"
```

---

### Task 5: Buchhaltung — Guards, CLAUDE.md, Prüfliste

**Files:**
- Modify: `frontend/src/components/dichte.guard.test.ts:151-153`
- Modify: `frontend/src/components/katalogTabelle.guard.test.ts:271-275`
- Modify: `CLAUDE.md`
- Create: `docs/superpowers/specs/2026-07-30-gefahrenmatrix-pruefliste.md`

- [ ] **Step 1: Den B5h-Block aus der Schuldmenge nehmen — vollständig**

Beide Dateizeilen **und** die Überschrift `── B5h · Gefahren (LFH-368) ──` fallen weg. Ein
Eintrag ohne Verstoß gilt selbst als Verstoß; ein Kommentar ohne Einträge ist toter Text.
Stattdessen bleibt eine Zeile in der Erledigt-Reihe darüber:

```ts
  // ── B5h · Gefahren (LFH-368) ── ABGERÄUMT, 5 Stellen in 2 Dateien.
  // Darunter das rohe `<Table>` selbst (`Table` steht in {@link INTERAKTIV}); die
  // `Liste size="small"` in `GefahrenPage.tsx` zählte korrekt NICHT mit — sie steht in
  // {@link EIGENE_SEMANTIK} und trägt dort ein Abstandsmaß.
```

- [ ] **Step 2: Guard-Lauf über alles**

Run: `mise exec pnpm@10 -- pnpm -C <abs>/frontend exec vitest run src/components/dichte.guard.test.ts src/components/katalogTabelle.guard.test.ts`
Expected: PASS. Die verbleibende Schuld ist **36 in 18 Dateien** — wenn der Guard eine andere Zahl
nennt, gilt seine.

- [ ] **Step 3: Den Ausnahme-Kommentar der Katalogtabelle nachziehen**

`katalogTabelle.guard.test.ts:271-275`. Der Restposten ist eingelöst, die Freistellung bleibt:

```ts
  // Flächencodierung Gefahrentyp × Schutzobjekt: eine Matrix, in der jede Zelle ein eigener
  // Sachverhalt ist — kein Listenvergleich, also auch keine Katalogtabelle. Sie trägt
  // waagerechten Bildlauf, die fixierte Kennungsspalte (`fixed: 'left'`) und seit
  // LFH-368/B5h auch die stehende Kopfzeile (`sticky`) selbst. Der Restposten von LFH-330
  // ist damit eingelöst; die Freistellung bleibt, weil die Sorte bleibt.
  '/src/pages/gefahren/GefahrenMatrix.tsx',
```

- [ ] **Step 3b: Die `sticky`-Behauptung absichern, sonst ist sie nur Prosa**

Der Kommentar in Step 3 sagt, der Restposten sei eingelöst — geprüft wird das von niemandem:
jsdom rechnet kein Layout, und der Guard sucht nur nach `<Table`. Also dieselbe Bauart wie
`aktionsabstand.guard.test.ts`: **der Prop-Wert im Quelltext**. In
`katalogTabelle.guard.test.ts` hinter die Rohtabellen-Hälfte:

```ts
describe('Freistellungen tragen ihre Begründung (LFH-368 · B5h)', () => {
  it('die Gefahrenmatrix hat die stehende Kopfzeile, die ihre Ausnahme verspricht', () => {
    // Prop im QUELLTEXT, kein Pixel: jsdom rechnet kein Layout, und der Kommentar bei
    // `AUSNAHMEN` behauptet seit LFH-368 `sticky`. Ein Versprechen ohne Prüfung ist
    // genau die tote Ausnahme, die die andere Hälfte dieser Datei verhindert.
    const quelle = KORPUS['/src/pages/gefahren/GefahrenMatrix.tsx'];
    expect(quelle).toMatch(/^\s*sticky\s*$/m);
  });
});
```

Run: `mise exec pnpm@10 -- pnpm -C <abs>/frontend exec vitest run src/components/katalogTabelle.guard.test.ts`
Expected: PASS. Mutationsprobe: `sticky` in der Matrix entfernen → dieser Fall wird rot.

- [ ] **Step 4: CLAUDE.md — die Zahl und die zwei Festlegungen**

Im Dichte-Absatz die Schuldmenge fortschreiben: `41 Stellen in 20 Dateien` → **`36 Stellen in 18
Dateien`**, Stand-Klammer auf `nach LFH-363 + LFH-364 + LFH-365 + LFH-368`. Im Statusfarb-Absatz
(„Rot bedient nichts") einen Satz ergänzen:

```markdown
  **Die Fläche ist die dritte Darstellungssorte, und sie liegt seit LFH-368/B5h im Vertrag**:
  `theme/statusFarben.ts:warnstufeFlaeche` bildet die fünf Warnstufen auf **drei** Farbtöne ab —
  zwei Intensitäten von `achtung`/`alarm` plus leer —, `flaechenFarbe` löst sie je Modus auf.
  Damit hält „nicht eine sechste Farbe" auch dort, wo fünf Flächen gebraucht werden. Eine Füllung
  ist **keine** `Statusrolle`: sie hat einen eigenen Typ (`Flaechendarstellung`) und erreicht
  bewusst keinen antd-Token — `rollenFarbe` kann sie nicht liefern, `antdToken()` bildet die
  Füllungsrollen nicht ab. Wer eine vierte Sorte braucht, benennt sie dort, statt sie in `pages/`
  daneben zu bauen: die Pastelltöne, die dort lagen, hatten **kein Nachtmodus-Paar** und standen
  im Dunkelmodus als vier grelle Helligkeitsblöcke.
```

- [ ] **Step 5: Die Prüfliste schreiben**

`docs/superpowers/specs/2026-07-30-gefahrenmatrix-pruefliste.md`, Aufbau nach
`2026-07-30-etb-pruefliste.md`: Umfang, gemessene Baseline als Tabelle (vorher/nachher), dann die
15 Kriterien mit je einem Verdikt. **Die Liste ist vorgegeben, nicht zu erfinden** — sie steht in
`2026-07-25-bedien-leitlinie-einsatzkontexte.md`, **Festlegung 7** (Zeile 372-415), in dieser
Reihenfolge:

1 Treffläche · 2 Handschuh-Modus · 3 Rückmeldung vor der Serverantwort · 4 kritische Aktion hat
eine zweite Handlung · 5 Kontrast in beiden Modi · 6 kein Status allein über Farbe · 7 eine Farbe =
eine Bedeutung · 8 Helligkeits-/Kontrastregler · 9 kritische Anzeigen im Blickfeld · 10
Alarmbudget · 11 Warnverhalten · 12 kein Sprung unter dem Cursor · 13 Fokus nie verdeckt · 14
Tabellenseite vollständig · 15 Erfassungsmaske vollständig.

Die Normbezüge (WCAG-/MIL-/EEMUA-Nummern) je Zeile aus Festlegung 7 übernehmen, nicht aus dem
Gedächtnis. Auflagen:

- Jede Zeile trägt **erfüllt / offen → Zielticket / nicht anwendbar**. „Nicht geprüft" ist kein Verdikt.
- Jede „offen"-Zeile nennt ein Ticket, das **existiert** — vor dem Schreiben mit
  `mcp__…clickup_get_task` prüfen. Auf LFH-365 musste genau das nachträglich korrigiert werden
  (Commit `1c9aca4`).
- Der **Trefferflächen-Nachweis** ist *offen → LFH-370 (B5j)*: `test/utils.tsx` rendert ein
  nacktes `ConfigProvider`, eine Höhenbehauptung im Vitest misst antd-Vorgaben. Ebenso der
  **Kontrast von Kürzel auf Füllung** in beiden Modi — jsdom rechnet keine Farbmischung.
- Kriterium **14** (Tabellenseite vollständig) trägt die Begründung, warum die Matrix **Tabelle
  bleibt** und unter `lg` nicht in Karten aufgelöst wird — samt dem Verweis auf die Freistellung in
  `katalogTabelle.guard.test.ts` und die neue `sticky`-Zusicherung. Kriterium **15** ist mit dem
  Detail-Dialog **nicht** mehr „nicht anwendbar": er läuft über `ErfassungsModal`, also gelten
  Labels über dem Feld, Enter-Absenden und Tastaturbedienung.
- Die Baseline-Tabelle nennt: Klein-Angaben in `pages/gefahren/` **5 → 0**, Schuldzeilen **2 → 0**,
  Restschuld des Guards **41/20 → 36/18**, Zellbreite **~142,5 → ~40** (kompakt), Auslöser je Zelle
  **2 → 1**.

- [ ] **Step 6: Volles Gate**

Run: `./scripts/check-all.sh`
Expected: alle Schritte grün. Kein `| tail` darum — das maskiert den Exit-Code.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/components/ CLAUDE.md docs/superpowers/specs/2026-07-30-gefahrenmatrix-pruefliste.md
git commit -m "docs(lfh-368): Schuldmenge 41/20 auf 36/18, die Pruefliste fuer die Gefahrenmatrix

Gemessen mit der Scan-Funktion des Guards, nicht fortgeschrieben. Der B5h-Block
faellt vollstaendig — Kopfzeile eingeschlossen, sonst bleibt toter Text stehen.

Die Freistellung der Matrix vom Roh-Table-Verbot bleibt, ihr Restposten
(stehende Kopfzeile) ist eingeloest. Zwei Nachweise stehen offen und zeigen auf
LFH-370/B5j: Trefferflaechen und der Kontrast Kuerzel-auf-Fuellung — beides
misst jsdom nicht. LFH-368"
```

---

## Self-Review

**Spec-Abdeckung** — jeder Ticket-Punkt hat eine Aufgabe:

| Ticket-Punkt | Task |
| --- | --- |
| Bewertung in einem Tipp statt Tipp → Layer → Tipp | 3 (ein Auslöser, Details im selben Menü) |
| Spaltenköpfe als Icon + Kurzlabel | 3 (`SPALTENKOPF`) |
| `warnstufeFarbe` verorten + **beide** Vertragsabsätze mitziehen | 1 (Text), 2 (`lagebild.ts`) |
| Zwei Neubefunde in `GefahrenPage.tsx` (`:117`, `:120`) | 2 |
| Umbruch unter `lg` | 4 |
| Testdatei neu schreiben (3 von 4 Fällen; Fall 1 überlebt) | 3 |
| `katalogTabelle.guard.test.ts:275` mitziehen | 5 (Freistellung bleibt, Kommentar nachgezogen) |
| `gefahrenSchema.test.ts:32` bewusst mitziehen | 1 (Pin), 2 (Zeiger) |
| Keine Höhenbehauptung in Vitest | Global Constraints + 5 (Prüfliste → LFH-370) |
| 7 disabled-Kombinationen bleiben erkennbar (zweiter Kanal) | 3 (`n. a.` als Text, kein Knopf) |
| Widerspruch 1 (Geometrie) prüfen und festschreiben | Kopf dieses Plans + Commit-Text Task 3 |
| Widerspruch 2 (Farbe) entscheiden | Kopf dieses Plans + Task 1 |
| Warnung „kein Gate schützt den Bereich" | 3 (6 neue Fälle), 1 (5 neue Fälle), 4 (2 Fälle) |
| Prüfliste Einsatztauglichkeit (CLAUDE.md-Pflicht, im Ticket nicht genannt) | 5 |

**Typkonsistenz:** `zellSchluessel` heißt in Matrix (Definition), Test und Seite gleich.
`laufendeZelle` ersetzt `pending` an allen drei Stellen (Props, Test, Aufrufer).
`warnstufeFlaeche`/`flaechenFarbe`/`Fuellungsrolle`/`Flaechendarstellung` tragen in Task 1
(Definition), Task 1 Step 6 (Test) und Task 3 (Konsum) dieselben Namen. `alarmFuellungStark`/
`achtungFuellungStark` erscheinen in `tokens.ts`, `rollen.css` (als `--lfh-*-fuellung-stark`),
`FARB_ABBILDUNG` und im Byte-Pin — vier Stellen, eine Schreibweise.

**Zwei Stellen, die beim Ausführen zu prüfen sind, weil der Plan sie annimmt:**
`screen.findByRole('list')` in Task 4 setzt voraus, dass das `Liste`-Primitiv mit `bordered` +
`header` genau **eine** `list`-Rolle liefert — trifft mehr als eine zu, auf den Kopftext
(`Gefahrengebiete`) verankern. Und `imMenue()` verlangt, dass die Menüeinträge die Rolle
`menuitem` tragen; das gilt für `Dropdown` mit `menu={{ items }}` (deshalb steht dort kein
`Popover` — der liefert im Repo ausschließlich Inhalt).

**Reihenfolge ist zwingend sequenziell.** Task 3 braucht die Exporte aus Task 1, und Tasks 2, 3
und 4 fassen alle `GefahrenPage.tsx` an. Keine parallele Ausführung — die Dateimengen sind nicht
disjunkt.

**Offen gelassen, mit Absicht:** der Kontrast von Kürzel auf Füllung in beiden Modi. Er ist mit
jsdom nicht messbar und gehört in denselben Playwright-Topf wie der Trefferflächen-Nachweis
(LFH-370 · B5j). Die gewählten Deckkräfte (18–20 % hell, 24 % dunkel) sind eine begründete
Setzung, kein gemessener Wert — das steht so in der Prüfliste.
