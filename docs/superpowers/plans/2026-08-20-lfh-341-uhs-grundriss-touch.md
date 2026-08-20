# LFH-341 · C6 — UHS-Grundriss touch- und schmaltauglich Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Der UHS-Grundriss und die drei übrigen Seitenspalten-Seiten brechen unter ihrem Breakpoint um, die Patientenaufnahme läuft ohne Modulwechsel, und kein roher Wire-Enum steht mehr auf dem Bildschirm.

**Architecture:** Vier unabhängige Achsen, die sich nicht überlappen: (1) der Farbvertrag `theme/statusFarben.ts` bekommt `materialStatus` und wird zur einzigen Quelle für dieses Enum, (2) `Grundriss.tsx` bekommt unter `lg` eine Tabs-Weiche innerhalb desselben `DndContext`, (3) die UHS-Kopfzeile springt `personenAufnahmePfad(einsatzId, { uhs })` an und die Aufnahmeseite bucht danach den Wartebereich-Eintritt, (4) zwei weitere Seiten stapeln unter `md`. Alles läuft über bestehende Primitive — `useViewport`, `Datensicht`, `Datenstand`, `ErfassungsFormular`, `deeplinks.ts`, `queryKeys.ts`.

**Tech Stack:** React 19 · TypeScript · antd 6 · TanStack Query v5 · dnd-kit · Vitest · Playwright · Rust/axum-Backend (nicht angefasst)

**Spec:** ClickUp LFH-341 (`https://app.clickup.com/t/86cawrqza`) · Prüfliste `docs/superpowers/specs/2026-07-30-uhs-grundriss-pruefliste.md` (wird in Task 8 erweitert, **keine zweite angelegt**) · Bedien-Leitlinie `docs/superpowers/specs/2026-07-25-bedien-leitlinie-einsatzkontexte.md`

---

## Global Constraints

Diese gelten für **jede** Task. Sie sind nicht Beiwerk, sondern Teil jeder Anforderung.

- **Sprache:** Bezeichner, Kommentare, Commits und UI-Texte auf Deutsch, mit korrekten Umlauten. Fachbegriffe der BOS-Führungssprache statt generischer Dev-Namen.
- **Keine Inline-Query-Keys.** Cache-Adressierung ausschließlich über `frontend/src/api/queryKeys.ts` (`einsatzKeys.*`). Ein Array-Literal als Query-Key bricht `queryKeys.guard.test.ts` (AST-Scanner).
- **Keine neuen Größen-Props auf interaktiven Elementen.** Kein `size="small"` an `Button`/`Select`/`Input`/`Tabs` — auch nicht innerhalb einer `items={[…]}`-Prop-Expression (`components/dichte.guard.test.ts` sieht die Attributebene). `Grundriss.tsx` ist die letzte Datei in der Schuldmenge; ihre vier Platzkarten-Knöpfe sind die geprüfte Dauerausnahme und bleiben unverändert.
- **`aktionsabstand.guard.test.ts`** deckt **weder `pages/uhs/Grundriss.tsx` noch `pages/uhs/MaterialTab.tsx`** ab — nachgemessen im Abschluss-Review; der `MaterialTab.tsx`-Eintrag seiner Liste ist `stammdaten/MaterialTab.tsx`, eine andere Datei. Wäre die ursprüngliche Behauptung wahr, wäre der Guard heute rot. Mit `pages/uhs/UhsDetailPage.tsx` (Task 2) bekommt der Geltungsbereich seinen **ersten** `uhs/`-Eintrag überhaupt. Die Regel selbst gilt unabhängig vom Guard: eine `<Space>`-Aktionsreihe mit `danger` und mindestens einer weiteren Aktion trägt `size="middle"`.
- **Statusfarbe nur als Punkt/Rand/Beistrich, nie als Textfläche.** Farbwerte kommen ausschließlich aus `theme/tokens.ts` / `theme/rollen.css`, in TSX über `theme.useToken()`, nie über `var(--lfh-*)`.
- **Kein Emoji als Bildzeichen** — `@ant-design/icons` mit `aria-hidden`-Hülle.
- **Lint mit `--max-warnings 0`.** `react-hooks/exhaustive-deps` strukturell lösen (Primitive in die Deps, `useMemo`/`useCallback` zur Identitätsstabilisierung), kein pauschales `eslint-disable`.
- **Gate:** `./scripts/check-all.sh` muss am Ende grün sein. Kein `| tail` um Gate-Kommandos (maskiert den Exit-Code).
- **Frontend-Kommandos** laufen als `mise exec pnpm@11.10.0 -- pnpm -C /Users/rubeen/dev/personal/lifeline-hub/.claude/worktrees/lfh-341/frontend <cmd>` — immer mit absolutem `-C`-Pfad.
- **Arbeitsverzeichnis ist der Worktree** `/Users/rubeen/dev/personal/lifeline-hub/.claude/worktrees/lfh-341`, nicht das Haupt-Repo.

---

## Zuschnitt: was von LFH-341 noch offen ist

Der Ticketstand ist vom 30.07.2026. Seither haben LFH-367/B5g, LFH-330/B2, LFH-339/C4 und LFH-340/C5 Teile davon abgetragen. **Gemessen am Code, nicht angenommen.** Wer eine Task „schon erledigt" findet, prüft gegen diese Tabelle, bevor er etwas baut.

| Ticket-Bullet | Stand | Task |
|---|---|---|
| Breakpoint-Weiche Grundriss (Tabs unter `lg`) | **offen** | 3 |
| Breakpoint `GefahrenPage` | **erledigt** — `useViewport`/`abBreite('lg')`, `GefahrenPage.tsx:66,171` | — |
| Breakpoint `EinsatzabschnittePage`, `KraefteOhneBrSidebar` | **offen** | 4 |
| Patientenaufnahme ohne Modulwechsel (H38) | **offen** | 5 |
| Optimistisches Feedback `belegMut`/`layoutMut` (M52) | **erledigt in B5g** — `onMutate`+`onError`-Rollback an *beiden* Mutationen, `Grundriss.tsx:491,537`, inkl. Schutz gegen Rückrollen eines neueren Stands | — |
| Live-/Offline-Indikator im UHS-Kopf | **offen** (beide Reiter haben `Datenstand`, der Kopf nicht) | 2 |
| Gemeinsamer Modul-Seitenkopf für die UHS-Seiten (Abhängigkeitszeile zu C5) | **offen** — `UnfallhilfsstellenPage` nutzt `EinsatzSeite`, die Detailseite nicht | 2 |
| Rückweg „Patient zurück in den Wartebereich" | **hängt heute allein am Drag** und fällt unter `lg` weg — siehe Task 3 | 3 |
| `BewegungenTab` Sortierung/Filter/Suche/Zeitleiste (M53) | **erledigt in B2** — läuft vollständig über `Datensicht` | — |
| `Grundriss` Verfügbarkeit als Label (M54) | **erledigt in A2** — `verfuegbarkeit[…]` via `StatusTag` | — |
| `MaterialTab` Status, `UhsDetailPage` Typ (M54) | **offen** | 1, 2 |

### Zwei Akzeptanzkriterien sind überholt — Verdikt statt Umsetzung

**AK „Paginierung mit 50 Einträgen je Seite" (BewegungenTab): überholt durch LFH-330/B2.** Das Primitiv setzt `pagination={false}` mit ausgeschriebener Begründung in `components/Datensicht.tsx:1237-1240`: *„Kein Suchfeld und keine Blätterung von `KatalogTabelle`: die Suche steht in der Werkzeugzeile oben, und eine Seitenblätterung schnitte die Zeilenschleuse entzwei."* Ein additives `paginierung`-Prop wäre technisch billig, hebelte aber für genau diesen Tab die Zeilenschleuse aus — die Eigenschaft, für die das Primitiv gebaut wurde. **Es wird nichts gebaut**; das Verdikt kommt in die Prüfliste (Task 8). Die anderen vier Forderungen desselben Bullets (Standardsortierung neueste zuerst, `sorter` auf Zeit, `filters` auf Art, Suche auf Person/Registriernummer) sind **erfüllt** — `BewegungenTab.tsx:150-170`.

**AK „Zeitleiste unter `md`": erfüllt durch die Kartenform von B2.** `BewegungenTab` lässt `form` ungesetzt (Default `'auto'`) und die Karte trägt genau die drei geforderten Elemente: Art-Tag (`status: (b) => belegungsArt[b.art]`), Zeit und Registriernummer (`titel: { spalte: 'person_id' }`, `sekundaer: ['zeitpunkt_at', …]`). Eine separate Zeitleiste daneben wäre eine zweite Bedienform für dieselbe Sache — genau das, was `GefahrenPage.tsx:160` für den Collapse ablehnt.

### Eine Entscheidung des Menschen, die C4 ausdrücklich offen gelassen hat

Das Ticket fordert für `MaterialStatus` farbige Tags. LFH-339/C4 hat dafür bewusst keine Farbrolle gebaut. **Das ist kein Widerspruch, den dieser Plan auflöst, sondern eine Frage, die C4 selbst offen gelassen und benannt hat** (`pages/MaterialPage.tsx:44-47`): *„Die Frage, welche Rollen dieser Katalog bekommen soll, bleibt offen — sie ist eine eigene Entscheidung, kein Nebenprodukt."* Der Mensch hat sie am 20.08.2026 entschieden: **Farben, wörtlich nach Ticket.** Task 1 löst sie ein — und zieht `MaterialPage` im selben Commit mit, weil zwei Farbbehandlungen desselben Enums der Fehlerfall wären, nicht der Kompromiss.

### Eine Falle, die beide e2e-Kriterien betrifft

AK 1 will Drag **und** Klickweg unter Touch, AK 2 will unter `lg` gestapelte Tabs. Bei 390 px liegt „Noch nicht aufgenommen" dann in einem **anderen Tab** als die Fläche — und antd hängt inaktive Panels ab (kein `forceRender`, Task 3 begründet das). Drag von der Warteliste auf einen Platz ist dort **strukturell unmöglich**, nicht kaputt.

Auflösung, die das Ticket selbst anlegt (*„der Klickweg wird hier nicht neu gebaut, sondern unter Touch und im schmalen Viewport nachgewiesen"*):

- **Drag unter Touch** wird bei **Tablet-Breite (1024 px, Kontext „Führungs-Tablet")** nachgewiesen, wo beide Spalten nebeneinander stehen.
- **Klickweg unter Touch** wird bei **390 px** nachgewiesen, wo er der einzige Weg ist.

Wer stattdessen einen 390-px-Drag-Test schreibt, schreibt einen Test, der nicht grün werden kann.

---

## File Structure

**Neu:**
- `frontend/src/pages/uhs/GrundrissTabs.test.tsx` — Vitest für die Breakpoint-Weiche des Grundrisses.

**Geändert:**
- `frontend/src/theme/statusFarben.ts` — `materialStatus`-Vertragskarte (Task 1).
- `frontend/src/theme/statusFarben.test.ts` — Pin der neuen Karte (Task 1).
- `frontend/src/pages/uhs/MaterialTab.tsx` / `.test.tsx` — `render` mit `StatusTag` (Task 1).
- `frontend/src/pages/MaterialPage.tsx` / `.test.tsx` — `STATUS_META` fällt, Vertrag zieht ein (Task 1).
- `CLAUDE.md` — der C4-Absatz zur Materialfarbe wird korrigiert (Task 1).
- `frontend/src/pages/uhs/UhsDetailPage.tsx` / `.test.tsx` — Umzug auf `EinsatzSeite`, Typ-Label, „Patient aufnehmen" (Tasks 2, 5).
- `frontend/src/pages/uhs/Grundriss.tsx` / `.test.tsx` — Tabs-Weiche (Task 3).
- `frontend/src/pages/EinsatzabschnittePage.tsx` / `.test.tsx` — Umbruch unter `md` (Task 4).
- `frontend/src/pages/bereitstellungsraum/KraefteOhneBrSidebar.tsx`, `BrDetailPage.tsx` / `.test.tsx` — Umbruch unter `md` (Task 4).
- `frontend/src/routing/deeplinks.ts` / `.test.ts` — `personenAufnahmePfad` bekommt `{ uhs }` (Task 5).
- `frontend/src/pages/personen/AufnahmePage.tsx` / `.test.tsx` — UHS-Kontext, Wartebereich-Eintritt, Rücksprung (Task 5).
- `frontend/e2e/uhs-grundriss-touch.spec.ts` — **neu** (Task 7).
- `docs/superpowers/specs/2026-07-30-uhs-grundriss-pruefliste.md` — erweitert (Task 8).

---

### Task 1: `materialStatus` in den Farbvertrag, EIN Behandlungsweg

**Files:**
- Modify: `frontend/src/theme/statusFarben.ts` (nach `uhsTyp`, ~Zeile 143)
- Modify: `frontend/src/theme/statusFarben.test.ts`
- Modify: `frontend/src/pages/uhs/MaterialTab.tsx:66` (Statusspalte)
- Modify: `frontend/src/pages/uhs/MaterialTab.test.tsx`
- Modify: `frontend/src/pages/MaterialPage.tsx:28-75` (Kopfkommentar, `STATUS_META`, `statusDarstellung`)
- Modify: `frontend/src/pages/MaterialPage.test.tsx`
- Modify: `CLAUDE.md` (Absatz „Material ist der Grenzfall …")

**Interfaces:**
- Produces: `export const materialStatus: Record<MaterialStatus, StatusDarstellung>` in `frontend/src/theme/statusFarben.ts`. Task 2 und Task 8 verweisen darauf; `MaterialPage.tsx` konsumiert es über `statusDarstellung`.
- Consumes: `StatusDarstellung { rolle: Statusrolle; label: string; form?: … }` und `StatusTag` (`components/StatusTag.tsx`, Prop `darstellung`), beide Bestand.

**Die Rollenzuordnung, und warum sie so lautet:**

| Wert | Rolle | Begründung |
|---|---|---|
| `einsatzbereit` | `normal` | Grün, Ticket wörtlich. |
| `im_einsatz` | `bedien` | Der Punkt, an dem C4 gebrochen ist. `bedien` ist im Vertrag **bereits dreimal Kategoriefarbe für „aktive Beziehung"**: `verfuegbarkeit.reserviert`, `belegungsArt.wechsel`, `etbTyp.meldung`. Material im Einsatz ist derselbe Zustand. Die Rolle wird also **nicht erfunden**, sondern die vorhandene erkannt. |
| `defekt` | `alarm` | Rot, Ticket wörtlich. |
| `verbraucht` | `alarm` | Rot, Ticket wörtlich. Zweiter Kanal (WCAG 1.4.1) ist das Pflichtfeld `label` — es unterscheidet die beiden Rot-Werte. |
| `desinfektion_noetig` | `achtung` | Orange, Ticket wörtlich. |

- [ ] **Step 1: Vertragstest schreiben (rot)**

An `frontend/src/theme/statusFarben.test.ts` anhängen:

```tsx
import { materialStatus } from './statusFarben';
import type { MaterialStatus } from '../api/types';

describe('materialStatus', () => {
  // Byte-Pin gegen HANDGESCHRIEBENE Literale, nie gegen die Konstante selbst:
  // sonst prüfte der Test die Karte gegen sich selbst.
  it('bildet alle fünf Wire-Werte auf Rolle und Label ab', () => {
    expect(materialStatus.einsatzbereit).toEqual({ rolle: 'normal', label: 'einsatzbereit' });
    expect(materialStatus.im_einsatz).toEqual({ rolle: 'bedien', label: 'im Einsatz' });
    expect(materialStatus.defekt).toEqual({ rolle: 'alarm', label: 'defekt' });
    expect(materialStatus.verbraucht).toEqual({ rolle: 'alarm', label: 'verbraucht' });
    expect(materialStatus.desinfektion_noetig).toEqual({
      rolle: 'achtung',
      label: 'Desinfektion nötig',
    });
  });

  it('deckt das Enum vollständig ab — eine sechste Variante bricht hier', () => {
    const alle: MaterialStatus[] = [
      'einsatzbereit', 'im_einsatz', 'defekt', 'verbraucht', 'desinfektion_noetig',
    ];
    expect(Object.keys(materialStatus).sort()).toEqual([...alle].sort());
  });

  it('trägt an jedem Wert den zweiten Kanal — zwei Werte teilen sich `alarm`', () => {
    // `defekt` und `verbraucht` sind beide rot. Ohne unterscheidbares Label wäre die
    // Farbe der einzige Kanal, und genau das verbietet WCAG 1.4.1.
    expect(materialStatus.defekt.label).not.toBe(materialStatus.verbraucht.label);
    for (const d of Object.values(materialStatus)) expect(d.label.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Test laufen lassen, Fehlschlag bestätigen**

```bash
mise exec pnpm@11.10.0 -- pnpm -C /Users/rubeen/dev/personal/lifeline-hub/.claude/worktrees/lfh-341/frontend test --run src/theme/statusFarben.test.ts
```
Erwartet: FAIL — `materialStatus` ist kein Export von `./statusFarben`.

- [ ] **Step 3: Vertragskarte anlegen**

In `frontend/src/theme/statusFarben.ts` direkt nach `uhsTyp` einfügen (Import `MaterialStatus` oben ergänzen, dort stehen die anderen Enum-Typen schon):

```tsx
/**
 * Status eines Einsatzmaterials (früher `STATUS_META`, `pages/MaterialPage.tsx`).
 *
 * ── DIE FRAGE, DIE C4 OFFEN GELASSEN HAT, IST HIER BEANTWORTET (LFH-341 · C6) ────
 *
 * LFH-339/C4 hat für diesen Katalog bewusst KEINE Rolle vergeben und den Grund
 * hingeschrieben: `im_einsatz` war Blau, „Rot bedient nichts, `bedien` ist blau" —
 * also schien es für diesen Zustand keine ehrliche Rolle zu geben. C4 hat daraus
 * nicht „nie" gemacht, sondern „eine eigene Entscheidung, kein Nebenprodukt".
 *
 * Die Entscheidung ist getroffen, und sie erfindet nichts: `bedien` ist in DIESER
 * Datei bereits dreimal Kategoriefarbe für eine aktive Beziehung — `verfuegbarkeit
 * .reserviert`, `belegungsArt.wechsel`, `etbTyp.meldung`. Material im Einsatz ist
 * derselbe Zustand, nicht ein neuer. Die Rolle war da, sie war nur nicht erkannt.
 *
 * `defekt` und `verbraucht` teilen sich `alarm` — dasselbe Muster wie bei
 * {@link warnstufeKarte}, wo fünf Stufen auf drei Rollen fallen. Der zweite Kanal ist
 * das Pflichtfeld `label`; eine sechste Farbe gibt es dafür nicht.
 *
 * EIN Behandlungsweg für dieses Enum: `pages/MaterialPage.tsx` (Kräfte) und
 * `pages/uhs/MaterialTab.tsx` (UHS) lesen beide von hier. Zwei Farbbehandlungen
 * desselben Enums wären der Fehlerfall, nicht der Kompromiss.
 */
export const materialStatus: Record<MaterialStatus, StatusDarstellung> = {
  einsatzbereit: { rolle: 'normal', label: 'einsatzbereit' },
  im_einsatz: { rolle: 'bedien', label: 'im Einsatz' },
  defekt: { rolle: 'alarm', label: 'defekt' },
  verbraucht: { rolle: 'alarm', label: 'verbraucht' },
  desinfektion_noetig: { rolle: 'achtung', label: 'Desinfektion nötig' },
};
```

Im Dateikopf von `statusFarben.ts` steht eine Aufzählung, welche Dateien **draußen** sind; `pages/MaterialPage.tsx` wird dort namentlich genannt. Diese Nennung streichen und durch einen Verweis auf `materialStatus` ersetzen — sonst widerspricht der Kopf dem Inhalt derselben Datei.

- [ ] **Step 4: Das Inventar-Gate derselben Datei nachziehen**

`statusFarben.test.ts` führt zwei Zusicherungen, die ein **zusätzlicher** Export bricht — und zwar an einer Stelle, die mit Material nichts zu tun hat:

- Zeile 32–43: `expect(Object.keys(ALLE_MAPS).sort()).toEqual([…neun Namen…])` unter der Überschrift *„eine zehnte Map rutscht nicht still durch"*.
- Zeile 148: `expect(Object.keys(ALLE_MAPS)).toHaveLength(9)`.

`ALLE_MAPS` sammelt automatisch jeden Export, dessen Werte ein `rolle`-Feld tragen — `materialStatus` landet also von selbst darin. **Das ist der Zweck des Gates, kein Fehlalarm.** Beide Stellen nachziehen: `'materialStatus'` alphabetisch in die Liste (zwischen `etbTyp` und `statusKategorie`), `toHaveLength(9)` → `toHaveLength(10)`, und die beiden Beschreibungstexte „neun"/„zehnte" auf zehn/elfte. Wer stattdessen die Zusicherung lockert, schaltet das Gate ab, statt es zu bedienen.

- [ ] **Step 5: Tests laufen lassen, grün bestätigen**

```bash
mise exec pnpm@11.10.0 -- pnpm -C /Users/rubeen/dev/personal/lifeline-hub/.claude/worktrees/lfh-341/frontend test --run src/theme/statusFarben.test.ts
```
Erwartet: PASS, beide neuen Blöcke und das nachgezogene Inventar.

- [ ] **Step 6: MaterialTab-Test schreiben (rot)**

An `frontend/src/pages/uhs/MaterialTab.test.tsx` anhängen. Der bestehende Test-Setup dieser Datei (Query-Mocks, `renderMitProviders`) wird wiederverwendet — beim Schreiben oben abschauen, wie ein Material mit Status in die Fixture kommt.

```tsx
it('zeigt den Materialstatus als Etikett, nie den rohen Wire-Wert', async () => {
  // Fixture-Material auf `desinfektion_noetig` setzen (der Wert mit Unterstrich).
  renderMitProviders(<MaterialTab uhs={uhsMitMaterial} schreibgeschuetzt={false} />);

  expect(await screen.findByText('Desinfektion nötig')).toBeInTheDocument();
  expect(screen.queryByText('desinfektion_noetig')).not.toBeInTheDocument();
});

it('lässt in keiner Statuszelle einen Unterstrich stehen', async () => {
  renderMitProviders(<MaterialTab uhs={uhsMitAllenStatus} schreibgeschuetzt={false} />);

  // Gegen die ZELLEN, nicht gegen den ganzen Baum: ein Unterstrich in einer
  // Bezeichnung oder einem Testid wäre kein Befund und färbte den Test grundlos rot.
  const zellen = await screen.findAllByTestId('material-status-zelle');
  expect(zellen.length).toBeGreaterThan(0);
  for (const zelle of zellen) expect(zelle.textContent).not.toMatch(/_/);
});
```

- [ ] **Step 7: Test laufen lassen, Fehlschlag bestätigen**

```bash
mise exec pnpm@11.10.0 -- pnpm -C /Users/rubeen/dev/personal/lifeline-hub/.claude/worktrees/lfh-341/frontend test --run src/pages/uhs/MaterialTab.test.tsx
```
Erwartet: FAIL — „Desinfektion nötig" nicht gefunden, `desinfektion_noetig` steht im DOM.

- [ ] **Step 8: Statusspalte umstellen**

`frontend/src/pages/uhs/MaterialTab.tsx`, Zeile 66 ersetzen (Imports `StatusTag` und `materialStatus` ergänzen):

```tsx
{
  title: 'Status',
  dataIndex: 'status',
  key: 'status',
  // Der Wire-Wert ist kein Bildschirmtext (LFH-341 · M54). Farbe und Beschriftung
  // kommen aus `theme/statusFarben.ts` — dieselbe Quelle, aus der `MaterialPage`
  // liest, damit dasselbe Enum nicht zwei Farbbehandlungen bekommt.
  render: (status: MaterialStatus) => (
    <span data-testid="material-status-zelle">
      <StatusTag darstellung={materialStatus[status]} />
    </span>
  ),
},
```

- [ ] **Step 9: Test laufen lassen, grün bestätigen**

```bash
mise exec pnpm@11.10.0 -- pnpm -C /Users/rubeen/dev/personal/lifeline-hub/.claude/worktrees/lfh-341/frontend test --run src/pages/uhs/MaterialTab.test.tsx
```
Erwartet: PASS.

- [ ] **Step 10: MaterialPage auf den Vertrag ziehen**

`frontend/src/pages/MaterialPage.tsx`:

1. Den Kopfkommentar „── WARUM HIER KEINE STATUSROLLE STEHT (LFH-339 · C4) ──" (Zeilen ~28–47) **ersetzen**:

```tsx
/**
 * ── DIE FARBFRAGE IST ENTSCHIEDEN (LFH-341 · C6) ─────────────────────────────────────
 *
 * Hier stand bis zum 20.08.2026 die Begründung, warum dieser Katalog KEINE Statusrolle
 * trägt. Sie endete auf den Satz, die Frage sei „eine eigene Entscheidung, kein
 * Nebenprodukt" — und genau als solche ist sie in C6 getroffen worden. Die Karte liegt
 * jetzt in `theme/statusFarben.ts` (`materialStatus`), samt der Herleitung für
 * `im_einsatz`, an dem C4 gebrochen war.
 *
 * Diese Datei hält davon nur noch die Reihenfolge und die Filterwerte — beide leiten sich
 * aus der Vertragskarte AB und werden nicht abgetippt. Das ist der Punkt: EIN
 * Behandlungsweg für dieses Enum, gemeinsam mit `pages/uhs/MaterialTab.tsx`.
 */
```

2. `STATUS_META` **löschen** und die drei Ableitungen auf den Vertrag stellen:

```tsx
const STATUS_REIHENFOLGE = Object.keys(materialStatus) as MaterialStatus[];

const STATUS_OPTIONEN: StatusOption<MaterialStatus>[] = STATUS_REIHENFOLGE.map((s) => ({
  wert: s,
  label: materialStatus[s].label,
  darstellung: materialStatus[s],
}));

function statusDarstellung(em: EinsatzMaterial): StatusDarstellung {
  return materialStatus[em.status];
}

const STATUS_FILTER_WERTE = STATUS_REIHENFOLGE.map((s) => ({
  value: s,
  text: materialStatus[s].label,
}));
```

3. Den Kommentar über `STATUS_OPTIONEN` („Menüwerte OHNE `darstellung` — … die offene Farbfrage, sichtbar gelassen statt überschrieben") **ersetzen**, er beschreibt sonst das Gegenteil dessen, was darunter steht:

```tsx
/**
 * Menüwerte MIT `darstellung` — der Farbpunkt im Statusmenü kommt jetzt aus dem Vertrag.
 * Bis C6 stand hier keiner, weil die Farbfrage offen war; sie ist es nicht mehr.
 */
```

4. Den Kommentar an der `statusBedienung`-Stelle (~Zeile 430) prüfen: er verweist auf „Rolle `neutral` (ausserhalb des Farbvertrags)" und ist nach dieser Änderung falsch. Auf den Vertrag umschreiben.

5. Import `materialStatus` ergänzen, `MaterialStatus`-Import prüfen.

- [ ] **Step 11: Bestandstests von MaterialPage laufen lassen**

```bash
mise exec pnpm@11.10.0 -- pnpm -C /Users/rubeen/dev/personal/lifeline-hub/.claude/worktrees/lfh-341/frontend test --run src/pages/MaterialPage.test.tsx
```

Erwartet: Tests, die auf `rolle: 'neutral'` oder auf die **Abwesenheit** eines Farbpunkts im Statusmenü pinnen, schlagen jetzt fehl. Das ist der Zweck der Änderung, nicht ein Fehler. Diese Zusicherungen **umschreiben, nicht löschen** — die Gegenaussage lautet jetzt: „das Auslöser-Etikett trägt die Vertragsrolle" und „die Menüeinträge tragen einen Farbpunkt". Wer sie streicht statt umzuschreiben, verliert die Zusicherung, dass der Katalog überhaupt eine Darstellung hat.

- [ ] **Step 12: CLAUDE.md korrigieren**

Im Abschnitt „Frontend — Bedien-Leitlinie", Absatz „**Der Statuswechsel in den Kräfte-Listen ist gebaut**", den Teilabsatz „**Material ist der Grenzfall, und die Linie liegt zwischen Farbe und Anordnung**" ersetzen durch:

```markdown
  **Material war der Grenzfall, und die Linie ist seit LFH-341/C6 gezogen.** C4 hatte für
  `MaterialStatus` bewusst keine Rolle vergeben — `im_einsatz` war **blau**, und Blau ist
  `bedien`, also schien es keine ehrliche Rolle zu geben — und die Frage ausdrücklich als
  „eigene Entscheidung, kein Nebenprodukt" offen gelassen. C6 hat sie entschieden:
  `theme/statusFarben.ts:materialStatus` trägt jetzt alle fünf Werte. `bedien` wird dabei
  **nicht erfunden, sondern erkannt** — die Rolle steht in derselben Datei schon dreimal für
  eine aktive Beziehung (`verfuegbarkeit.reserviert`, `belegungsArt.wechsel`,
  `etbTyp.meldung`). `defekt`/`verbraucht` teilen sich `alarm`, unterschieden durch das
  Pflichtfeld `label` (WCAG 1.4.1), wie die fünf Warnstufen sich drei Rollen teilen.
  **EIN Behandlungsweg:** `pages/MaterialPage.tsx` und `pages/uhs/MaterialTab.tsx` lesen
  beide von dort. Zwei Farbbehandlungen desselben Enums wären der Fehlerfall, nicht der
  Kompromiss — und das ist der Grund, warum C6 die Kräfte-Seite mit angefasst hat, obwohl
  ihr Ticket sie nicht nennt. Die **Anordnung** aus C4 (Menü statt Farbfläche, Etikett als
  Auslöser) bleibt davon unberührt.
```

- [ ] **Step 13: Betroffene Suiten laufen lassen**

```bash
mise exec pnpm@11.10.0 -- pnpm -C /Users/rubeen/dev/personal/lifeline-hub/.claude/worktrees/lfh-341/frontend test --run src/theme src/pages/MaterialPage.test.tsx src/pages/uhs/MaterialTab.test.tsx
```
Erwartet: PASS.

- [ ] **Step 14: Commit**

```bash
git add frontend/src/theme/statusFarben.ts frontend/src/theme/statusFarben.test.ts \
        frontend/src/pages/uhs/MaterialTab.tsx frontend/src/pages/uhs/MaterialTab.test.tsx \
        frontend/src/pages/MaterialPage.tsx frontend/src/pages/MaterialPage.test.tsx CLAUDE.md
git commit -m "$(cat <<'EOF'
feat(lfh-341): gibt dem Materialstatus die Farbrolle, die C4 offen gelassen hat

Die Karte liegt in theme/statusFarben.ts und wird von der Kräfte-Seite und dem
UHS-Materialreiter gemeinsam gelesen — zwei Farbbehandlungen desselben Enums
waeren der Fehlerfall, nicht der Kompromiss. `bedien` fuer `im_einsatz` ist
nicht erfunden: die Rolle steht in derselben Datei dreimal fuer eine aktive
Beziehung.

LFH-341
EOF
)"
```

---

### Task 2: UHS-Detailseite auf den gemeinsamen Modul-Seitenkopf ziehen

**Files:**
- Modify: `frontend/src/pages/uhs/UhsDetailPage.tsx:78-125` (Meta-Zeile, Breadcrumb, Kopfzeile)
- Modify: `frontend/src/pages/uhs/UhsDetailPage.test.tsx`

**Interfaces:**
- Consumes: `EinsatzSeite` aus `components/EinsatzSeite.tsx` (Bestand) mit den Props `titel`, `beschreibung`, `breadcrumb`, `aktionen`, `hinweis`, `dataUpdatedAt`, `breite`, `children`; `uhsTyp` aus `theme/statusFarben.ts` (Bestand, `statusFarben.ts:136-143`); `flaeche.seiteBreit` aus `theme/tokens.ts`.
- Produces: den `aktionen`-Slot der Seite, in den Task 5 den Aufnahme-Knopf hängt.

**Warum die Seite umzieht, statt nur zwei Zeilen zu bekommen.** Die Abhängigkeitszeile des Tickets sagt es ausdrücklich: *„C5 liefert außerdem den gemeinsamen Modul-Seitenkopf, den die UHS-Seiten mitnutzen."* `UnfallhilfsstellenPage` nutzt ihn seit C5, die **Detail**seite nicht — ihr Kopf ist handgebaut. Drei Dinge folgen daraus, und alle drei betreffen diesen Plan:

1. **Der Datenstand kommt umsonst.** `EinsatzSeite` hat einen `dataUpdatedAt`-Prop und rendert den Indikator selbst. Ein eigenes `<Datenstand>` in einen handgebauten Kopf zu hängen wäre die zweite Bauform für dieselbe Sache.
2. **„Genau eine Primäraktion" wird prüfbar, statt gezählt.** Das Gate hängt an `data-lfh="seitenkopf-aktionen"` und der Dev-Warnung des Primitivs (`EinsatzSeite.tsx:42,87-91`) — außerhalb davon ist die Zusicherung eine Handzählung. Task 5 setzt eine zweite Primäraktion in genau diesen Kopf; ohne den Umzug stünde sie in einem Bereich, den kein Gate sieht.
3. **`data-testid="uhs-kopf"` wird überflüssig.** Der Slot trägt bereits eine Marke.

**Was der Umzug NICHT ändert:** der Grundriss bleibt Hauptinhalt mit bemessener Höhe, die Reiter bleiben darunter, die drei Statuswechsel-Knöpfe behalten Beschriftung und Bedingung. `breite={flaeche.seiteBreit}` — der Grundriss ist eine Arbeitsfläche, keine Formularseite.

- [ ] **Step 1: Test schreiben (rot)**

An `frontend/src/pages/uhs/UhsDetailPage.test.tsx` anhängen:

```tsx
it('zeigt den UHS-Typ als Beschriftung, nicht als Wire-Wert', async () => {
  // Fixture-UHS mit typ: 'patientenablage'
  renderMitProviders(<UhsDetailPage />, { route: '/einsaetze/1/unfallhilfsstellen/7' });

  expect(await screen.findByText(/Patientenablage/)).toBeInTheDocument();
  expect(screen.queryByText(/patientenablage/)).not.toBeInTheDocument();
});

it('trägt den Seitenkopf des Moduls, nicht einen eigenen', async () => {
  renderMitProviders(<UhsDetailPage />, { route: '/einsaetze/1/unfallhilfsstellen/7' });

  // Der Slot IST die Zusicherung: an ihm hängt die Primäraktions-Zählung des
  // Primitivs. Ohne ihn ist „genau eine Primäraktion im Kopf" eine Handzählung.
  const aktionen = await screen.findByTestId('uhs-detail-seite');
  expect(aktionen.querySelector('[data-lfh="seitenkopf-aktionen"]')).not.toBeNull();
});

it('zeigt genau eine Primäraktion im Kopf — im Betrieb wie in der Planung', async () => {
  // Beide Zustände, weil die Knöpfe zustandsabhängig sind und sich genau deshalb
  // NICHT gegenseitig aufheben müssen: eine Zählung in nur einem Zustand liesse
  // den anderen offen.
  for (const status of ['geplant', 'aktiv'] as const) {
    const { unmount } = renderMitProviders(<UhsDetailPage />, {
      route: '/einsaetze/1/unfallhilfsstellen/7',
      // UHS-Fixture mit diesem Status — wie, steht in der Bestandssuite.
    });
    const slot = (await screen.findByTestId('uhs-detail-seite'))
      .querySelector('[data-lfh="seitenkopf-aktionen"]')!;
    const primaer = Array.from(slot.querySelectorAll('button')).filter((k) =>
      Array.from(k.classList).some((c) => c.endsWith('-btn-primary')),
    );
    expect(primaer, `Status ${status}`).toHaveLength(1);
    unmount();
  }
});
```

**Vor dem Schreiben prüfen:** trägt `EinsatzSeite` selbst eine greifbare Marke, oder muss `UhsDetailPage` das `data-testid="uhs-detail-seite"` an ein umschließendes Element hängen? In `components/EinsatzSeite.tsx` nachsehen — falls das Primitiv keine Wurzel-Marke hat, ist der `container` aus `renderMitProviders` der ehrlichere Anker. Und: wie setzt die Bestandssuite den UHS-Status in der Fixture? Auch das steht dort.

- [ ] **Step 2: Test laufen lassen, Fehlschlag bestätigen**

```bash
mise exec pnpm@11.10.0 -- pnpm -C /Users/rubeen/dev/personal/lifeline-hub/.claude/worktrees/lfh-341/frontend test --run src/pages/uhs/UhsDetailPage.test.tsx
```
Erwartet: FAIL — „Patientenablage" fehlt, kein `seitenkopf-aktionen` im Baum.

- [ ] **Step 3: Auf `EinsatzSeite` umstellen**

`frontend/src/pages/uhs/UhsDetailPage.tsx` — die Meta-Zeile zuerst:

```tsx
const meta = [
  // Der Typ ist eine Kategorie und trägt im Vertrag durchgängig `neutral` — hier zählt
  // nur seine Beschriftung. `UHS_TYP_LABEL` gab es doppelt (UnfallhilfsstellenPage,
  // UhsAnlegenDrawer); die dritte Kopie wäre eine zu viel gewesen (LFH-341 · M54).
  `Typ: ${uhsTyp[uhs.typ].label}`,
  `Standort: ${uhs.standort ?? '—'}`,
  ...(uhs.notiz ? [`Notiz: ${uhs.notiz}`] : []),
].join('  ·  ');
```

Dann den handgebauten Kopf (Breadcrumb + das `<div>` mit `justifyContent: 'space-between'` + die `Typography.Text`-Metazeile, zusammen ~Zeilen 89–123) durch die Hülle ersetzen. `children` sind der Grundriss-Container und die Reiter, unverändert:

```tsx
<EinsatzSeite
  breite={flaeche.seiteBreit}
  /* Der Titel trägt den Umschalter, nicht bloß den Namen: die UHS-Detailseite ist der
     Ort, an dem zwischen mehreren Hilfsstellen gewechselt wird (LFH-25). */
  titel={
    <Space>
      <UhsSwitcher einsatzId={einsatzId} aktuelleUhs={uhs} />
      <StatusTag darstellung={uhsStatus[uhs.status]} />
    </Space>
  }
  beschreibung={meta}
  /* Betriebs-Feedback im Kopf (B6-Muster): die beiden Reiter tragen es seit B2, die
     Seite selbst nicht — ausgerechnet dort, wo der Grundriss live mitläuft. Das
     Primitiv rendert den Indikator; eine eigene `<Datenstand>`-Zeile daneben wäre die
     zweite Bauform für dieselbe Sache. */
  dataUpdatedAt={detailQuery.dataUpdatedAt}
  breadcrumb={
    <Breadcrumb items={[
      { title: <Link to="/einsaetze">Einsätze</Link> },
      { title: <Link to={`/einsaetze/${einsatzId}`}>{einsatz.bezeichnung}</Link> },
      { title: <Link to={listenPfad}>Unfallhilfsstellen</Link> },
      { title: uhs.bezeichnung },
    ]} />
  }
  aktionen={
    <Space wrap>
      {/* Die Zustände schliessen sich aus — aber das ist ab jetzt nicht mehr
          handgezählt: die Dev-Warnung des Primitivs zählt die Primäraktionen in
          diesem Slot, und der Test daneben prüft beide Zustände. */}
      {!schreibgeschuetzt && uhs.status === 'geplant' && (
        <>
          <Button type="primary" onClick={() => statusMut.mutate('aktiv')} loading={statusMut.isPending}>
            In Betrieb nehmen
          </Button>
          <Popconfirm title="UHS stornieren?" onConfirm={() => stornoMut.mutate()} okButtonProps={{ danger: true }}>
            <Button danger>Stornieren</Button>
          </Popconfirm>
        </>
      )}
      {!schreibgeschuetzt && uhs.status === 'aktiv' && (
        <Popconfirm
          title="UHS auflösen?"
          description="Nur möglich, wenn keine Person mehr belegt ist."
          onConfirm={() => statusMut.mutate('aufgeloest')}
          okButtonProps={{ danger: true }}
        >
          <Button danger>Auflösen</Button>
        </Popconfirm>
      )}
    </Space>
  }
>
```

Zwei Mitnahmen, weil die Datei ohnehin angefasst wird:

- **`okButtonProps={{ danger: true }}` an beiden `Popconfirm`.** CLAUDE.md: *„Jedes `Popconfirm` an einer destruktiven Aktion trägt `okButtonProps={{ danger: true }}` — sonst bestätigt man das Löschen mit einem blauen Knopf."* Beide fehlten. Die Rückfragen selbst **bleiben**: Stornieren und Auflösen sind nicht umkehrbar (es gibt keinen Knopf, der eine aufgelöste UHS zurückholt), und damit fallen sie auf die Seite der Trennlinie aus LFH-363, auf der die Reibung bleibt.
- Die `<Space wrap>`-Reihe trägt `danger` neben mindestens einer weiteren Aktion → **`size="middle"`** setzen, sobald Task 5 den Aufnahme-Knopf dazustellt (`aktionsabstand.guard.test.ts`). Im `geplant`-Zweig gilt das schon jetzt.

Imports: `EinsatzSeite`, `uhsTyp`, `flaeche`. `Typography` und `Datenstand` fallen möglicherweise ganz weg — ungenutzte Importe brechen den Lint.

- [ ] **Step 4: Test laufen lassen, grün bestätigen**

```bash
mise exec pnpm@11.10.0 -- pnpm -C /Users/rubeen/dev/personal/lifeline-hub/.claude/worktrees/lfh-341/frontend test --run src/pages/uhs/UhsDetailPage.test.tsx src/components/aktionsabstand.guard.test.ts
```

Erwartet: PASS. Die Bestandstests der Datei greifen den Kopf womöglich über seine alte Struktur ab — die Abfragen umschreiben, nicht die Aussagen. Und in der Browser-Konsole des Dev-Laufs auf die Dev-Warnung des Primitivs achten: sie ist der eigentliche Gewinn dieses Umzugs.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/uhs/UhsDetailPage.tsx frontend/src/pages/uhs/UhsDetailPage.test.tsx
git commit -m "$(cat <<'EOF'
feat(lfh-341): zieht die UHS-Detailseite auf den gemeinsamen Modul-Seitenkopf

Die Abhaengigkeitszeile des Tickets verlangt es, und drei Dinge folgen daraus:
der Datenstand kommt aus dem Primitiv statt aus einer zweiten Bauform, „genau
eine Primaeraktion" wird vom Gate gezaehlt statt von Hand, und der Typ steht als
Beschriftung statt als Wire-Wert. Beide Popconfirms bekommen den roten
Bestaetigungsknopf nach, den CLAUDE.md fordert.

LFH-341
EOF
)"
```

### Task 3: Grundriss — unter `lg` stapeln statt 504-px-Sockel

**Files:**
- Modify: `frontend/src/pages/uhs/Grundriss.tsx:645-735` (der Layout-Block innerhalb des `DndContext`)
- Create: `frontend/src/pages/uhs/GrundrissTabs.test.tsx`

**Interfaces:**
- Consumes: `useViewport()` → `{ abBreite(punkt: AbBreitePunkt): boolean, … }` aus `components/useViewport.ts` (Bestand); `setzeViewportBreite(px: number)` aus `test/viewport.ts` (Bestand, Muster in `pages/gefahren/GefahrenPage.test.tsx:256`).
- Produces: nichts für spätere Tasks. Task 7 prüft dasselbe Verhalten im Browser.

**Die Bauform, und die drei Entscheidungen darin:**

1. **Der `DndContext` umschließt die Weiche**, nicht umgekehrt. Er tut das heute schon (`Grundriss.tsx:645`) — beim Umbau darf er nicht in einen Tab rutschen, sonst verliert der Drag innerhalb der Fläche seinen Kontext.
2. **Kein `forceRender` an den Tabs.** Das ist dieselbe Entscheidung wie beim Navigations-Drawer aus B1 und die erste der fünf Zusicherungen von `Datensicht`: *„Genau EIN Zweig im Baum. Kein Umschalten per verborgener Fläche."* Ein zweiter, verborgener Zweig machte die Prüfung „unter `lg` stehen die Spalten nicht nebeneinander" bedeutungslos und montierte die Droppables doppelt — zwei Elemente mit `droppableId="drop-inbox"` sind ein stiller Fehler, kein lauter.
3. **Die Fläche ist der Default-Tab.** Wer die UHS auf dem Telefon öffnet, will den Belegungsstand sehen, nicht die Warteliste.
4. **Der Rückweg braucht einen zweiten Pfad** — sonst nimmt der Umbruch eine Bewegung weg. Siehe den Kasten direkt darunter; das ist keine Zugabe, sondern Bedingung dafür, dass Punkt 2 tragbar ist.

**DER RÜCKWEG AUS DEM PLATZ HÄNGT HEUTE AM DRAG, UND ZWAR AUSSCHLIESSLICH.** Gemessen, nicht vermutet: „Person zurück in den Wartebereich" läuft nur über `onDragEnd` → `target.kind === 'inbox'` → `belegMut.mutate({ platzId: null })` (`Grundriss.tsx:635`). Das Droppable `drop-inbox` hängt an der `PersonenSpalte` im Wartebereich-Zweig, und der Kommentar an der Platzkarte sagt es selbst: *„Belegte Person ist ziehbar (→ Wartebereich links oder Transport rechts)"* (`Grundriss.tsx:279`). Die Props der `PlatzKarte` sind `onVerfuegbarkeit`, `onAustritt`, `onTransport`, `onStorno`, `onZuweisen`, `onOeffnen` — **keiner davon setzt `platz_id: null`**. „Austritt" ist etwas anderes: er beendet die Belegung, statt die Person in den Wartebereich zurückzustellen.

Unter `lg` auf dem Reiter „Fläche" ist `drop-inbox` **nicht im Baum** (kein `forceRender`, Punkt 2). Ohne Gegenmaßnahme verliert der schmale Schirm damit eine Bewegung, die es im Betrieb gibt — den Patienten vom Platz zurück in den Wartebereich nehmen. Das wäre eine Verschlechterung durch einen Umbau, der Bedienbarkeit herstellen soll.

**Die Gegenmaßnahme ist ein Menüeintrag an der Platzkarte, kein zweites Droppable.** Er ruft dieselbe Mutation — `belegMut` errechnet `art` selbst aus `aktuelle_uhs_id` und liefert für eine belegte Person korrekt `'wechsel'`. Damit hat `belegMut` **drei** Aufrufer; die Zusicherung aus Task 6 gilt für alle drei, und das AK „für beide Aufrufer" ist damit erfüllt und überschritten. Der Eintrag steht auf **beiden** Breiten, nicht nur schmal: zwei Bedienwege je nach Fensterbreite wären ein Unterschied ohne Bedeutung, und der Klickweg ist auch mit Maus der schnellere.

- [ ] **Step 1: Test schreiben (rot)**

Neue Datei `frontend/src/pages/uhs/GrundrissTabs.test.tsx`. Fixtures und Provider-Setup aus `Grundriss.test.tsx` übernehmen (dort steht bereits eine UHS mit Plätzen und Personen).

```tsx
import { describe, expect, it, beforeEach } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { setzeViewportBreite } from '../../test/viewport';
import { renderMitProviders } from '../../test/utils';
import Grundriss from './Grundriss';

describe('Grundriss — Breakpoint-Weiche (LFH-341 · H40)', () => {
  it('stellt ab lg alle drei Bereiche nebeneinander, ohne Reiter', async () => {
    setzeViewportBreite(1280);
    renderMitProviders(<Grundriss einsatzId={1} uhs={uhsFixture} schreibgeschuetzt={false} />);

    // Beide Seitenspalten UND die Fläche gleichzeitig im Baum — das ist die Aussage
    // „nebeneinander", die unter lg nicht mehr gilt.
    expect(await screen.findByText('Noch nicht aufgenommen')).toBeInTheDocument();
    expect(screen.getByText('Wartebereich (Eingang)')).toBeInTheDocument();
    expect(screen.getByText('Auf Transport gebracht')).toBeInTheDocument();
    expect(screen.queryByRole('tablist')).not.toBeInTheDocument();
  });

  it('stapelt unter lg zu drei Reitern mit der Fläche voran', async () => {
    setzeViewportBreite(800); // < lg (992)
    renderMitProviders(<Grundriss einsatzId={1} uhs={uhsFixture} schreibgeschuetzt={false} />);

    const reiter = await screen.findByRole('tablist');
    expect(within(reiter).getByRole('tab', { name: 'Fläche' })).toHaveAttribute('aria-selected', 'true');
    expect(within(reiter).getByRole('tab', { name: 'Wartebereich' })).toBeInTheDocument();
    expect(within(reiter).getByRole('tab', { name: 'Transport' })).toBeInTheDocument();
  });

  it('hält unter lg genau EINEN Zweig im Baum — der inaktive Reiter ist nicht bloß verborgen', async () => {
    setzeViewportBreite(800);
    renderMitProviders(<Grundriss einsatzId={1} uhs={uhsFixture} schreibgeschuetzt={false} />);

    await screen.findByRole('tablist');
    // Ohne diese Zusicherung wäre `forceRender` eine unbemerkte Rückkehr zum
    // 504-px-Zustand mit anderer Optik: die Spalten STÜNDEN im DOM, nur unsichtbar,
    // und der Wartebereich trüge sein Droppable ein zweites Mal.
    expect(screen.queryByText('Wartebereich (Eingang)')).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('tab', { name: 'Wartebereich' }));
    expect(await screen.findByText('Wartebereich (Eingang)')).toBeInTheDocument();
  });

  it('bietet den Rückweg in den Wartebereich als Menüeintrag — auf beiden Breiten', async () => {
    // Der Drag auf `drop-inbox` ist unter lg strukturell weg (anderer Reiter). Ohne
    // diesen Eintrag hätte der schmale Schirm KEINEN Weg mehr, einen Patienten vom
    // Platz zurückzunehmen — der Umbau nähme eine Bewegung, statt eine zu geben.
    for (const breite of [1280, 800]) {
      setzeViewportBreite(breite);
      const { unmount } = renderMitProviders(
        <Grundriss einsatzId={1} uhs={uhsMitBelegtemPlatz} schreibgeschuetzt={false} />,
      );
      if (breite < 992) await userEvent.click(await screen.findByRole('tab', { name: 'Fläche' }));

      await userEvent.click(await screen.findByRole('button', { name: /Aktionen zu Bett 1/ }));
      // Immer über das GEÖFFNETE Menü greifen: antd lässt die Portale geschlossener
      // Dropdowns im Baum stehen.
      const menue = document.querySelector('.ant-dropdown:not(.ant-dropdown-hidden) [role="menu"]')!;
      expect(
        within(menue as HTMLElement).getByRole('menuitem', { name: /Zurück in den Wartebereich/ }),
        `Breite ${breite}`,
      ).toBeInTheDocument();
      unmount();
    }
  });

  it('schickt den Rückweg über dieselbe Mutation wie Drag und Zuweisungsdialog', async () => {
    setzeViewportBreite(800);
    renderMitProviders(<Grundriss einsatzId={1} uhs={uhsMitBelegtemPlatz} schreibgeschuetzt={false} />);
    await userEvent.click(await screen.findByRole('tab', { name: 'Fläche' }));

    await userEvent.click(await screen.findByRole('button', { name: /Aktionen zu Bett 1/ }));
    const menue = document.querySelector('.ant-dropdown:not(.ant-dropdown-hidden) [role="menu"]')!;
    await userEvent.click(within(menue as HTMLElement).getByRole('menuitem', { name: /Zurück in den Wartebereich/ }));

    // `art: 'wechsel'`, weil die Person bereits an dieser UHS liegt — das rechnet
    // `belegMut` selbst aus, und genau deshalb geht der Eintrag durch die Mutation
    // statt an ihr vorbei.
    await waitFor(() => expect(aenderePersonBelegung).toHaveBeenCalledWith(1, 42, {
      art: 'wechsel', uhs_id: 1, platz_id: null,
    }));
  });

  it('bietet den Rückweg an einem unbelegten Platz gar nicht erst an', async () => {
    setzeViewportBreite(1280);
    renderMitProviders(<Grundriss einsatzId={1} uhs={uhsFixture} schreibgeschuetzt={false} />);

    await userEvent.click(await screen.findByRole('button', { name: /Aktionen zu Bett 1/ }));
    const menue = document.querySelector('.ant-dropdown:not(.ant-dropdown-hidden) [role="menu"]')!;
    expect(
      within(menue as HTMLElement).queryByRole('menuitem', { name: /Zurück in den Wartebereich/ }),
    ).not.toBeInTheDocument();
  });

  it('setzt an keiner Seitenspalte mehr eine feste Breite, wenn gestapelt wird', async () => {
    setzeViewportBreite(800);
    renderMitProviders(<Grundriss einsatzId={1} uhs={uhsFixture} schreibgeschuetzt={false} />);

    // jsdom rechnet kein Layout — prüfbar ist der INLINE-STYLE, nicht ein Pixelwert.
    const rahmen = await screen.findByTestId('grundriss-rahmen');
    expect(rahmen).not.toHaveStyle({ width: '240px' });
    expect(rahmen.style.flexDirection).toBe('column');
  });
});
```

- [ ] **Step 2: Test laufen lassen, Fehlschlag bestätigen**

```bash
mise exec pnpm@11.10.0 -- pnpm -C /Users/rubeen/dev/personal/lifeline-hub/.claude/worktrees/lfh-341/frontend test --run src/pages/uhs/GrundrissTabs.test.tsx
```
Erwartet: FAIL — kein `tablist`, kein `grundriss-rahmen`.

- [ ] **Step 3: Weiche einbauen**

In `frontend/src/pages/uhs/Grundriss.tsx`, innerhalb der Komponente vor dem `return`:

```tsx
const { abBreite } = useViewport();
const breit = abBreite('lg');
```

Die drei Bereiche als benannte Knoten herausziehen, damit beide Zweige **dieselben** Elemente verwenden und nicht zwei Kopien entstehen:

```tsx
// Die drei Bereiche stehen EINMAL. Zwei Zweige mit je eigener Kopie wären zwei
// Wahrheiten über dieselbe Spalte — und die Droppable-IDs kämen doppelt vor,
// sobald irgendwann jemand `forceRender` setzt.
const wartebereich = (
  <div style={{ display: 'flex', flexDirection: 'column', gap: 12, minHeight: 0, overflow: 'auto', height: '100%' }}>
    <PersonenSpalte
      titel="Noch nicht aufgenommen"
      personen={nichtAufgenommen}
      schreibgeschuetzt={schreibgeschuetzt || belegMut.isPending}
      leerText="keine"
      onOeffnen={setDetailPersonId}
    />
    <PersonenSpalte
      titel="Wartebereich (Eingang)"
      personen={wartebereichPersonen}
      schreibgeschuetzt={schreibgeschuetzt || belegMut.isPending}
      droppableId="drop-inbox"
      leerText="leer"
      onOeffnen={setDetailPersonId}
    />
  </div>
);

const flaeche = ( /* der bestehende Mitte-Block, unverändert */ );

const transport = (
  <TransportSpalte
    personen={transportiert}
    schreibgeschuetzt={schreibgeschuetzt || belegMut.isPending}
    onOeffnen={setDetailPersonId}
  />
);
```

Dann die Weiche. Der `DndContext` bleibt **außen**:

```tsx
<DndContext sensors={sensors} onDragStart={onDragStart} onDragEnd={onDragEnd} onDragCancel={onDragCancel}>
  {breit ? (
    <div
      data-testid="grundriss-rahmen"
      style={{ display: 'flex', flexDirection: 'row', gap: 12, height: '100%', minHeight: 0, alignItems: 'stretch' }}
    >
      <div style={{ width: 240, flexShrink: 0, minHeight: 0 }}>{wartebereich}</div>
      {flaeche}
      <div style={{ width: 240, flexShrink: 0, overflow: 'auto' }}>{transport}</div>
    </div>
  ) : (
    /**
     * UNTER `lg` GESTAPELT (LFH-341 · H40). Die beiden Seitenspalten waren mit
     * `width: 240, flexShrink: 0` plus zweimal `gap: 12` ein 504-px-Sockel VOR einer
     * Fläche, deren Innenbreite bei `Math.max(700, …)` beginnt — bei 390 px sprengten
     * allein die Spalten den Schirm.
     *
     * KEIN `forceRender`: das ist dieselbe Entscheidung wie beim Navigations-Drawer aus
     * B1 und die erste Zusicherung von `Datensicht` — genau EIN Zweig im Baum. Ein
     * verborgener zweiter machte die Prüfung „unter lg nicht nebeneinander"
     * bedeutungslos und trüge `drop-inbox` doppelt.
     *
     * FOLGE, und sie ist gewollt: der Drag von der Warteliste auf einen Platz ist hier
     * strukturell unmöglich — Quelle und Ziel liegen in verschiedenen Reitern. Der Weg
     * auf schmalem Schirm ist der Klickweg aus LFH-367/B5g („Patient zuweisen" am
     * unbelegten Platz). Deshalb ist die Fläche der Default-Reiter.
     */
    <div
      data-testid="grundriss-rahmen"
      style={{ display: 'flex', flexDirection: 'column', gap: 12, height: '100%', minHeight: 0 }}
    >
      <Tabs
        defaultActiveKey="flaeche"
        style={{ height: '100%' }}
        items={[
          { key: 'flaeche', label: 'Fläche', children: flaeche },
          { key: 'warte', label: 'Wartebereich', children: wartebereich },
          { key: 'transport', label: 'Transport', children: transport },
        ]}
      />
    </div>
  )}
  {/* DragOverlay und die Dialoge bleiben, wo sie sind */}
</DndContext>
```

**Achtung Guards:** kein `size`-Prop an `Tabs` und keins in den `items`-Objekten — `dichte.guard.test.ts` liest die Attributebene und `Grundriss.tsx` ist seine letzte Schuldzeile. Der `Tabs`-Import kommt aus `antd`.

- [ ] **Step 4: Den Rückweg als Menüeintrag bauen**

`PlatzKarte` bekommt eine sechste Aktions-Prop. In der Props-Schnittstelle (`Grundriss.tsx:157-163`) und im Destructuring der Funktion ergänzen:

```tsx
/** Nur gesetzt, wenn der Platz belegt ist — sonst gibt es nichts zurückzustellen. */
onZurueckInWartebereich?: () => void;
```

Im Menü (`Grundriss.tsx:226-231`), direkt nach dem `zuweisen`-Block:

```tsx
...(onZurueckInWartebereich
  ? [{ key: 'wartebereich', label: 'Zurück in den Wartebereich', icon: <RollbackOutlined /> }]
  : []),
```

Und in `menu.onClick` — die Zuordnung bleibt am **Menü**, nicht je Eintrag, damit der Riegel gegen das Aufsteigen einen Ort hat:

```tsx
onClick: ({ key }: { key: string }) => {
  if (key === 'zuweisen') onZuweisen();
  else if (key === 'wartebereich') onZurueckInWartebereich?.();
  else if (key === 'storno') onStorno();
  else onVerfuegbarkeit(key as Verfuegbarkeit);
},
```

An der Aufrufstelle (`Grundriss.tsx:695-720`), neben den anderen Handlern:

```tsx
onZurueckInWartebereich={
  // Nur bei belegtem Platz und nur mit Schreibrecht. `belegMut` errechnet `art`
  // selbst — für eine Person, die bereits an dieser UHS liegt, ergibt das
  // `'wechsel'`. Der Eintritt in den Wartebereich IST ein Wechsel, kein Austritt.
  (() => {
    const belegt = belegtAn(p.id);
    if (!belegt || schreibgeschuetzt || belegMut.isPending) return undefined;
    return () => belegMut.mutate({ personId: belegt.id, platzId: null });
  })()
}
```

Den Kommentar an `Grundriss.tsx:279` („Belegte Person ist ziehbar (→ Wartebereich links oder Transport rechts)") ergänzen: der Drag ist nicht mehr der einzige Weg, und unter `lg` ist er für diese Richtung gar keiner.

`RollbackOutlined` aus `@ant-design/icons` importieren — die `aria-hidden`-Frage stellt sich hier nicht, ein `icon` im Menü-Item trägt der Eintragstext.

**Bündelungsschwelle prüfen:** das Menü hatte bisher je nach Zustand 1–3 Einträge plus Verfügbarkeiten. Mit dem sechsten steigt keine Regel auf, die vorher keine war — die Aktionen liegen schon gebündelt im Dropdown, das ist der Zielzustand aus LFH-365. Die vier direkten Knöpfe der Platzkarte bleiben unverändert (geprüfte Dauerausnahme, `SCHRITT_Y = 120`).

- [ ] **Step 5: Test laufen lassen, grün bestätigen**

```bash
mise exec pnpm@11.10.0 -- pnpm -C /Users/rubeen/dev/personal/lifeline-hub/.claude/worktrees/lfh-341/frontend test --run src/pages/uhs/GrundrissTabs.test.tsx
```
Erwartet: PASS.

- [ ] **Step 6: Bestandssuite des Grundrisses laufen lassen**

```bash
mise exec pnpm@11.10.0 -- pnpm -C /Users/rubeen/dev/personal/lifeline-hub/.claude/worktrees/lfh-341/frontend test --run src/pages/uhs/Grundriss.test.tsx src/components/dichte.guard.test.ts src/components/aktionsabstand.guard.test.ts
```

Erwartet: PASS. `Grundriss.test.tsx` rendert in der jsdom-Vorgabebreite — prüfen, welche das ist (`test/viewport.ts` bzw. `test/setup.ts`). Liegt sie unter 992, laufen die Bestandstests plötzlich im Tabs-Zweig und finden die Spalten nicht mehr. **Dann nicht die Erwartungen anpassen**, sondern in der Bestandssuite `setzeViewportBreite(1280)` in ein `beforeEach` setzen: die Tests prüfen den breiten Fall, das war vor der Weiche nur nicht sagbar.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/pages/uhs/Grundriss.tsx frontend/src/pages/uhs/Grundriss.test.tsx frontend/src/pages/uhs/GrundrissTabs.test.tsx
git commit -m "$(cat <<'EOF'
feat(lfh-341): bricht den Grundriss unter lg in drei Reiter um

Die beiden Seitenspalten waren ein 504-px-Sockel vor einer 700-px-Mindestflaeche.
Kein forceRender: genau EIN Zweig im Baum, sonst traegt der Wartebereich sein
Droppable doppelt und die Pruefung „nicht nebeneinander" belegt nichts.

LFH-341
EOF
)"
```

---

### Task 4: Gliederungsbaum und BR-Seitenspalte brechen unter `md` um

**Files:**
- Modify: `frontend/src/pages/EinsatzabschnittePage.tsx:250-251` (der `flex`-Container und die Gliederungs-`Card`)
- Modify: `frontend/src/pages/EinsatzabschnittePage.test.tsx`
- Modify: `frontend/src/pages/bereitstellungsraum/KraefteOhneBrSidebar.tsx:49`
- Modify: `frontend/src/pages/bereitstellungsraum/BrDetailPage.tsx` (der Container, der die Sidebar trägt — Stelle beim Umsetzen suchen)
- Modify: `frontend/src/pages/bereitstellungsraum/BrDetailPage.test.tsx`

**Interfaces:**
- Consumes: `useViewport()` und `setzeViewportBreite` wie in Task 3.
- Produces: nichts für spätere Tasks.

**Die Form, und warum sie nicht der Ticket-Wortlaut ist.** Das Ticket verlangt „aufklappbarer Kopfbereich statt fester Spalte". Die Präzedenz im Repo ist eine andere und sie ist begründet: `GefahrenPage.tsx:160` lehnt den Collapse ausdrücklich ab — *„ein Collapse je Gefahrentyp wäre eine zweite Bedienform für dieselbe Sache"* — und stapelt stattdessen (`flexDirection: breit ? 'row' : 'column'`, volle Breite statt fester 240 px). Der dritte Geschwisterfall folgt der Präzedenz seiner beiden Schwestern, nicht einer Ticketformulierung, die vor ihnen geschrieben wurde. **Gestapelt, kein Collapse** — das Verdikt kommt in die Prüfliste (Task 8).

Der Breakpoint ist hier `md`, nicht `lg` — so steht es im Ticket, und er ist auch sachlich richtig: eine 240-px-Liste neben Inhalt trägt ab `md` (768 px), eine 360-px-Karte plus Detailfläche ebenfalls.

- [ ] **Step 1: Test für EinsatzabschnittePage schreiben (rot)**

An `frontend/src/pages/EinsatzabschnittePage.test.tsx` anhängen:

```tsx
it('stellt Gliederung und Detail ab md nebeneinander', async () => {
  setzeViewportBreite(1024);
  renderMitProviders(<EinsatzabschnittePage />, { route: '/einsaetze/1/einsatzabschnitte' });

  const rahmen = await screen.findByTestId('abschnitte-rahmen');
  expect(rahmen.style.flexDirection).toBe('row');
});

it('stapelt unter md und nimmt der Gliederung die feste Breite', async () => {
  setzeViewportBreite(600); // < md (768)
  renderMitProviders(<EinsatzabschnittePage />, { route: '/einsaetze/1/einsatzabschnitte' });

  const rahmen = await screen.findByTestId('abschnitte-rahmen');
  expect(rahmen.style.flexDirection).toBe('column');
  // Die 360-px-Karte ist der halbe Schirm bei 768 und mehr als der ganze bei 390.
  const gliederung = await screen.findByTestId('abschnitte-gliederung');
  expect(gliederung.style.flex).not.toContain('360px');
});
```

- [ ] **Step 2: Test laufen lassen, Fehlschlag bestätigen**

```bash
mise exec pnpm@11.10.0 -- pnpm -C /Users/rubeen/dev/personal/lifeline-hub/.claude/worktrees/lfh-341/frontend test --run src/pages/EinsatzabschnittePage.test.tsx
```
Erwartet: FAIL — `abschnitte-rahmen` existiert nicht.

- [ ] **Step 3: EinsatzabschnittePage umstellen**

```tsx
const { abBreite } = useViewport();
const breit = abBreite('md');
```

```tsx
{/* Unter `md` stapeln statt einer 360-px-Spalte neben dem Detail (LFH-341 · H40).
    Kein Collapse: `GefahrenPage` hat die Frage für den Geschwisterfall entschieden —
    eine zweite Bedienform für dieselbe Liste. Gestapelt trägt die Gliederung dieselbe
    Bedienung wie breit, nur untereinander. */}
<div
  data-testid="abschnitte-rahmen"
  style={{ display: 'flex', flexDirection: breit ? 'row' : 'column', gap: 16, alignItems: breit ? 'flex-start' : 'stretch' }}
>
  <Card
    data-testid="abschnitte-gliederung"
    style={breit ? { flex: '0 0 360px' } : { width: '100%' }}
    size="small"
    title="Gliederung"
  >
```

**`size="small"` an der `Card` bleibt** — `dichte.guard.test.ts` hält nicht-interaktive Flächen (`Card`, `Descriptions`, `Space`) bewusst draußen, dort ist `size` ein Abstandsmaß und keine Trefffläche.

- [ ] **Step 4: Test laufen lassen, grün bestätigen**

```bash
mise exec pnpm@11.10.0 -- pnpm -C /Users/rubeen/dev/personal/lifeline-hub/.claude/worktrees/lfh-341/frontend test --run src/pages/EinsatzabschnittePage.test.tsx
```
Erwartet: PASS.

- [ ] **Step 5: Test für die BR-Seitenspalte schreiben (rot)**

An `frontend/src/pages/bereitstellungsraum/BrDetailPage.test.tsx` anhängen (die Sidebar wird dort gerendert; falls die Suite sie nicht mountet, den Test an eine eigene `KraefteOhneBrSidebar.test.tsx` hängen und die Breite direkt prüfen):

```tsx
it('nimmt der Kräfte-Spalte unter md die feste Breite', async () => {
  setzeViewportBreite(600);
  renderMitProviders(<BrDetailPage />, { route: '/einsaetze/1/bereitstellungsraeume/3' });

  const spalte = await screen.findByTestId('kraefte-ohne-br');
  expect(spalte.style.width).not.toBe('240px');
});

it('behält die Spalte ab md bei 240 px', async () => {
  setzeViewportBreite(1024);
  renderMitProviders(<BrDetailPage />, { route: '/einsaetze/1/bereitstellungsraeume/3' });

  const spalte = await screen.findByTestId('kraefte-ohne-br');
  expect(spalte.style.width).toBe('240px');
});
```

- [ ] **Step 6: Test laufen lassen, Fehlschlag bestätigen**

```bash
mise exec pnpm@11.10.0 -- pnpm -C /Users/rubeen/dev/personal/lifeline-hub/.claude/worktrees/lfh-341/frontend test --run src/pages/bereitstellungsraum/BrDetailPage.test.tsx
```
Erwartet: FAIL.

- [ ] **Step 7: Sidebar und ihren Container umstellen**

`frontend/src/pages/bereitstellungsraum/KraefteOhneBrSidebar.tsx`:

```tsx
const { abBreite } = useViewport();
const breit = abBreite('md');
```

```tsx
{/* Unter `md` volle Breite und gestapelt (LFH-341 · H40) — dieselbe Form wie bei
    Gefahrengebietsliste und Gliederungsbaum. Die Zuweisung läuft hier ohnehin über
    den „zuweisen"-Knopf, nicht über einen Drag: der Umbruch kostet keinen Bedienweg. */}
<Card
  data-testid="kraefte-ohne-br"
  title="Kräfte ohne BR"
  size="small"
  style={breit ? { width: 240, minHeight: 400 } : { width: '100%' }}
>
```

Den Container in `BrDetailPage.tsx`, der die Sidebar neben den Inhalt setzt, ebenfalls auf `flexDirection: breit ? 'row' : 'column'` stellen — sonst quetscht der Flex-Container die 100 %-Karte weiterhin in eine Spalte.

- [ ] **Step 8: Test laufen lassen, grün bestätigen**

```bash
mise exec pnpm@11.10.0 -- pnpm -C /Users/rubeen/dev/personal/lifeline-hub/.claude/worktrees/lfh-341/frontend test --run src/pages/bereitstellungsraum src/pages/EinsatzabschnittePage.test.tsx
```
Erwartet: PASS.

- [ ] **Step 9: Commit**

```bash
git add frontend/src/pages/EinsatzabschnittePage.tsx frontend/src/pages/EinsatzabschnittePage.test.tsx \
        frontend/src/pages/bereitstellungsraum/
git commit -m "$(cat <<'EOF'
feat(lfh-341): laesst Gliederungsbaum und BR-Kraeftespalte unter md umbrechen

Gestapelt statt aufklappbar: GefahrenPage hat die Frage fuer den
Geschwisterfall entschieden — ein Collapse waere eine zweite Bedienform
fuer dieselbe Liste.

LFH-341
EOF
)"
```

---

### Task 5: Patientenaufnahme ohne Modulwechsel (H38)

**Files:**
- Modify: `frontend/src/routing/deeplinks.ts:145-161` (`personenAufnahmePfad`)
- Modify: `frontend/src/routing/deeplinks.test.ts`
- Modify: `frontend/src/pages/uhs/UhsDetailPage.tsx` (Aktionsbereich der Kopfzeile)
- Modify: `frontend/src/pages/uhs/UhsDetailPage.test.tsx`
- Modify: `frontend/src/pages/personen/AufnahmePage.tsx`
- Modify: `frontend/src/pages/personen/AufnahmePage.test.tsx`

**Interfaces:**
- Consumes: `aenderePersonBelegung(einsatzId: number, personId: number, eingabe: { art: 'eintritt' | 'wechsel' | 'austritt'; uhs_id: number; platz_id: number | null })` aus `api/einsatzPerson` (Bestand, so von `Grundriss.tsx:534` gerufen); `erfassePersonOfflineFaehig` aus `offline/schreiben` (Bestand, liefert `{ zustand: 'vorgemerkt' } | { zustand: …; daten: Person }`); `uhsDetailPfad(einsatzId, uhsId)` aus `routing/deeplinks.ts` (Bestand — beim Umsetzen den genauen Namen dort nachsehen).
- Produces: `personenAufnahmePfad(einsatzId: number, opts?: { uhs?: number }): string` — erzeugt `/einsaetze/:id/personen/aufnahme` bzw. `…?uhs=<id>`.

**Der Weg, und die drei Stellen, an denen er ehrlich sein muss:**

1. **Der Auftrag reist im Query-Param**, nicht im Router-State: ein `?uhs=<id>` überlebt einen Neuladen und ist die Adresse, die C5 ausdrücklich vorgesehen hat (`deeplinks.ts:149-153`).
2. **Nach dem Anlegen wird der Eintritt gebucht**, `art: 'eintritt'`, `platz_id: null` → Wartebereich. Serienbetrieb bleibt, wie er ist: die Hülle zählt, jeder Durchlauf bucht.
3. **Offline hat keine Person-ID, und die Zuordnung kommt auch später nicht von selbst.** `erfassePersonOfflineFaehig` liefert bei fehlender Verbindung `{ zustand: 'vorgemerkt', client_id }` und legt die Person in die Queue (`offline/schreiben.ts:21-24`). Es gibt **keinen** Drain-Hook, der danach `aenderePersonBelegung` nachschöbe — der Aufruf steht in `onSuccess` dieser Seite, und die ist beim Drain längst verlassen. **Gemessen, nicht angenommen.**

   Der Wortlaut der Quittung muss das sagen. „Zuordnung folgt nach der Übertragung" wäre ein Versprechen, das kein Code einlöst — und dieselbe Kette, aus der der medizinische Verlauf gelesen wird (`uhs.belegungen`), hätte still eine Lücke. Die Quittung lautet deshalb: **„Offline vorgemerkt — Registriernummer folgt nach der Übertragung, die Zuordnung zur Unfallhilfsstelle muss danach von Hand erfolgen."**

   **Der saubere Weg ist der C5-Weg und er wird vertagt:** so wie die Sichtung seit LFH-340 als optionales Feld am `POST …/personen` mitgeht und serverseitig in derselben Transaktion geschrieben wird, gehörte auch `uhs_id` dorthin — dann trüge die Offline-Vormerkung sie in ihrer `client_id`-Idempotenz mit. Das ist eine **Backend-Erweiterung** und damit außerhalb dieses Tickets; sie wird als Folgeticket angelegt (Task 8, Schritt 3) und in der Prüfliste als offen mit Zielticket geführt.

- [ ] **Step 1: Deeplink-Test schreiben (rot)**

An `frontend/src/routing/deeplinks.test.ts` anhängen:

```tsx
describe('personenAufnahmePfad', () => {
  it('bleibt ohne UHS-Auftrag die nackte Route', () => {
    expect(personenAufnahmePfad(4)).toBe('/einsaetze/4/personen/aufnahme');
  });

  it('trägt den UHS-Auftrag als Query-Param', () => {
    expect(personenAufnahmePfad(4, { uhs: 7 })).toBe('/einsaetze/4/personen/aufnahme?uhs=7');
  });
});
```

- [ ] **Step 2: Test laufen lassen, Fehlschlag bestätigen**

```bash
mise exec pnpm@11.10.0 -- pnpm -C /Users/rubeen/dev/personal/lifeline-hub/.claude/worktrees/lfh-341/frontend test --run src/routing/deeplinks.test.ts
```
Erwartet: FAIL — die Funktion nimmt kein zweites Argument.

- [ ] **Step 3: Deeplink erweitern**

`frontend/src/routing/deeplinks.ts` — den vorhandenen Doc-Kommentar behalten, den Absatz „Noch ohne Produktivkonsumenten" ersetzen (er ist mit dieser Task falsch) und die Signatur erweitern:

```tsx
/**
 * … (bestehender Kopf bleibt) …
 *
 * **Der Konsument ist da (LFH-341 · C6):** die UHS-Kopfzeile springt hierher. Der
 * optionale `uhs`-Auftrag reist im Query-Param, nicht im Router-State — er überlebt
 * damit einen Neuladen, und genau dafür gibt es diese Route statt eines Dialogs.
 * Die Aufnahmeseite bucht nach dem Anlegen den Eintritt in den Wartebereich.
 */
export function personenAufnahmePfad(einsatzId: number, opts: { uhs?: number } = {}): string {
  return mitQuery(`${einsatzModulPfad(einsatzId, 'personen')}/aufnahme`, { uhs: opts.uhs });
}
```

`mitQuery` ist in derselben Datei Bestand und lässt `undefined`-Werte weg.

- [ ] **Step 4: Test laufen lassen, grün bestätigen**

```bash
mise exec pnpm@11.10.0 -- pnpm -C /Users/rubeen/dev/personal/lifeline-hub/.claude/worktrees/lfh-341/frontend test --run src/routing/deeplinks.test.ts
```
Erwartet: PASS.

- [ ] **Step 5: Test für den Kopfzeilen-Knopf schreiben (rot)**

An `frontend/src/pages/uhs/UhsDetailPage.test.tsx`:

```tsx
it('bietet „Patient aufnehmen" und schickt in die Aufnahme mit UHS-Auftrag', async () => {
  renderMitProviders(<UhsDetailPage />, { route: '/einsaetze/1/unfallhilfsstellen/7' });

  await userEvent.click(await screen.findByRole('button', { name: 'Patient aufnehmen' }));
  // Die ADRESSE ist die Zusicherung, nicht der Klick: der `uhs`-Auftrag ist das,
  // woran die Aufnahmeseite den Wartebereich-Eintritt erkennt.
  await waitFor(() => expect(aktuellerPfad()).toBe('/einsaetze/1/personen/aufnahme?uhs=7'));
});

it('bietet die Aufnahme in einer geplanten UHS nicht an', async () => {
  // Eine geplante UHS nimmt niemanden auf — dort ist „In Betrieb nehmen" die
  // Primäraktion. Ohne diese Gegenaussage wäre „genau eine Primäraktion" in Task 2
  // eine Zählung ohne Fall, der sie verletzen könnte.
  renderMitProviders(<UhsDetailPage />, { route: '/einsaetze/1/unfallhilfsstellen/8' }); // Status geplant

  expect(await screen.findByRole('button', { name: 'In Betrieb nehmen' })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Patient aufnehmen' })).not.toBeInTheDocument();
});

it('bietet die Aufnahme ohne Schreibrecht gar nicht erst an', async () => {
  // Der Weg endet in einem POST; ein 403 nach dem Ausfüllen der Maske wäre die
  // spaeteste denkbare Absage.
  renderMitProviders(<UhsDetailPage />, { route: '/einsaetze/1/unfallhilfsstellen/7', benutzer: beobachter });

  expect(await screen.findByText(/Bett/)).toBeInTheDocument(); // Seite ist da
  expect(screen.queryByRole('button', { name: 'Patient aufnehmen' })).not.toBeInTheDocument();
});
```

`aktuellerPfad()` ist ein Platzhalter für den Weg, den die Bestandssuite zum Ablesen der Route nutzt — ein `useLocation`-Anzeiger im Testbaum oder der Router-State. **In `UhsDetailPage.test.tsx` bzw. `AufnahmePage.test.tsx` nachsehen**; `window.location` ist unter einem Memory-Router falsch.

**Vor dem Schreiben prüfen:** wie setzt die Bestandssuite einen Benutzer ohne Schreibrecht (`renderMitProviders`-Option, Mock von `darfImEinsatzSchreiben`)? Das Muster steht in `UhsDetailPage.test.tsx` oder in `Grundriss.test.tsx` — abschauen, nicht erfinden.

- [ ] **Step 6: Test laufen lassen, Fehlschlag bestätigen**

```bash
mise exec pnpm@11.10.0 -- pnpm -C /Users/rubeen/dev/personal/lifeline-hub/.claude/worktrees/lfh-341/frontend test --run src/pages/uhs/UhsDetailPage.test.tsx
```
Erwartet: FAIL — kein Link „Patient aufnehmen".

- [ ] **Step 7: Knopf in die Kopfzeile**

`frontend/src/pages/uhs/UhsDetailPage.tsx`, im rechten `<Space wrap>` der Kopfzeile **vor** den Statuswechsel-Knöpfen:

```tsx
{!schreibgeschuetzt && uhs.status === 'aktiv' && (
  /* Die Aufnahme ohne Modulwechsel (LFH-341 · H38). Nur im Betrieb: eine geplante
     UHS nimmt niemanden auf, und dort steht „In Betrieb nehmen" als Primäraktion.
     Die beiden schliessen sich damit aus — nicht mehr handgezählt, sondern von der
     Dev-Warnung des Seitenkopfs (Task 2) und ihrem Test gedeckt. */
  <Button
    type="primary"
    icon={<UserAddOutlined aria-hidden />}
    onClick={() => navigate(personenAufnahmePfad(einsatzId, { uhs: uhs.id }))}
  >
    Patient aufnehmen
  </Button>
)}
```

**Warum `onClick` und nicht `<Link><Button>`.** Das Verschachteln ergäbe `<button>` in `<a>` — interaktiv in interaktiv, invalides HTML, und Screenreader melden es unterschiedlich. Antds eigener `href`-Weg (`<Button href=…>`) rendert zwar einen sauberen `<a class="ant-btn">`, umgeht aber den Router: react-router fängt nur `<Link>` ab, ein nacktes `href` lädt die SPA komplett neu. `onClick` + `useNavigate` kostet den Cmd-Klick in einen zweiten Tab, und das ist hier verkraftbar — der Aufnahmeweg ist Serienbetrieb **auf** der Zielseite, nicht ein Nachschlagen nebenher. Das Repo hat für Navigations-**Knöpfe** kein anderes Muster; `<Link>` wird durchgängig für Text-Links verwendet (`BefehlDetailPage.tsx:170`, `EinheitenPage.tsx:64`).

**Der Test greift entsprechend `getByRole('button', …)` plus den Navigationsnachweis**, nicht ein `href`-Attribut — Task 5 Schritt 5 ist darauf abzustimmen, wenn es dort noch `getByRole('link')` sagt.

**`size="middle"` an der `<Space wrap>`-Reihe** nachziehen: mit diesem Knopf steht `danger` („Auflösen") neben mindestens einer weiteren Aktion, und `aktionsabstand.guard.test.ts` deckt die Datei ab.

Imports: `personenAufnahmePfad`, `useNavigate`, `UserAddOutlined` aus `@ant-design/icons` (Emoji ist verboten, die `aria-hidden`-Hülle ist Pflicht — sonst trägt der Knopf zusätzlich das englische `user-add` im zugänglichen Namen).

- [ ] **Step 8: Test laufen lassen, grün bestätigen**

```bash
mise exec pnpm@11.10.0 -- pnpm -C /Users/rubeen/dev/personal/lifeline-hub/.claude/worktrees/lfh-341/frontend test --run src/pages/uhs/UhsDetailPage.test.tsx
```
Erwartet: PASS.

- [ ] **Step 9: Test für den Wartebereich-Eintritt schreiben (rot)**

An `frontend/src/pages/personen/AufnahmePage.test.tsx`:

```tsx
it('bucht nach dem Anlegen den Eintritt in den Wartebereich der beauftragten UHS', async () => {
  const belegung = vi.fn().mockResolvedValue({ person_id: 42, uhs_id: 7, platz_id: null });
  vi.mocked(aenderePersonBelegung).mockImplementation(belegung);
  vi.mocked(erfassePersonOfflineFaehig).mockResolvedValue({
    zustand: 'gespeichert',
    daten: { id: 42, registrier_nr: 3, aktuelle_sichtung: 'rot' } as Person,
  });

  renderMitProviders(<AufnahmePage />, { route: '/einsaetze/1/personen/aufnahme?uhs=7' });
  await userEvent.click(await screen.findByRole('button', { name: 'Erfassen', exact: true }));

  await waitFor(() => expect(belegung).toHaveBeenCalledWith(1, 42, {
    art: 'eintritt', uhs_id: 7, platz_id: null,
  }));
});

it('bucht ohne UHS-Auftrag gar keine Belegung', async () => {
  const belegung = vi.fn();
  vi.mocked(aenderePersonBelegung).mockImplementation(belegung);

  renderMitProviders(<AufnahmePage />, { route: '/einsaetze/1/personen/aufnahme' });
  await userEvent.click(await screen.findByRole('button', { name: 'Erfassen', exact: true }));

  await screen.findByText(/Erfasst als/);
  expect(belegung).not.toHaveBeenCalled();
});

it('sagt es, wenn die Zuordnung offline nicht gebucht werden konnte', async () => {
  // Ohne Person-ID gibt es keine Belegung. Eine still ausgefallene Zuordnung
  // waere eine Person, die an der UHS niemand sucht.
  vi.mocked(erfassePersonOfflineFaehig).mockResolvedValue({ zustand: 'vorgemerkt' });
  const belegung = vi.fn();
  vi.mocked(aenderePersonBelegung).mockImplementation(belegung);

  renderMitProviders(<AufnahmePage />, { route: '/einsaetze/1/personen/aufnahme?uhs=7' });
  await userEvent.click(await screen.findByRole('button', { name: 'Erfassen', exact: true }));

  // „muss von Hand erfolgen", NICHT „folgt": die Queue schiebt keine Belegung nach.
  // Ein Test auf /folgt/ waere auch mit dem falschen Versprechen gruen.
  expect(await screen.findByText(/von Hand erfolgen/)).toBeInTheDocument();
  expect(belegung).not.toHaveBeenCalled();
});

it('kehrt mit „Erfassen" zur beauftragenden UHS zurück, nicht in die Personenliste', async () => {
  renderMitProviders(<AufnahmePage />, { route: '/einsaetze/1/personen/aufnahme?uhs=7' });
  await userEvent.click(await screen.findByRole('button', { name: 'Erfassen', exact: true }));

  await waitFor(() => expect(window.location.pathname).toBe('/einsaetze/1/unfallhilfsstellen/7'));
});
```

**Vor dem Schreiben prüfen:** wie mockt die Bestandssuite `erfassePersonOfflineFaehig` und wie liest sie die Navigation (Memory-Router mit Location-Anzeige)? Das Muster steht in derselben Datei — abschauen. `window.location` ist unter einem Memory-Router **falsch**; die Bestandssuite hat einen tragfähigen Weg.

- [ ] **Step 10: Test laufen lassen, Fehlschlag bestätigen**

```bash
mise exec pnpm@11.10.0 -- pnpm -C /Users/rubeen/dev/personal/lifeline-hub/.claude/worktrees/lfh-341/frontend test --run src/pages/personen/AufnahmePage.test.tsx
```
Erwartet: FAIL — keine Belegung, Rücksprung geht in die Personenliste.

- [ ] **Step 11: AufnahmePage um den UHS-Auftrag erweitern**

`frontend/src/pages/personen/AufnahmePage.tsx`:

```tsx
const [searchParams] = useSearchParams();
/**
 * DER UHS-AUFTRAG (LFH-341 · C6). Wer von der UHS-Kopfzeile kommt, erfasst einen
 * PATIENTEN, keine Person im Allgemeinen: nach dem Anlegen wird der Eintritt in den
 * Wartebereich gebucht, und der Rückweg geht zur UHS statt in die Personenliste.
 *
 * Unbrauchbares wird GANZ verworfen, nicht halb übernommen — dieselbe Regel wie beim
 * Platzier-Auftrag der Lagekarte: ein halb gelesener Auftrag bucht auf eine UHS, die
 * es nicht gibt.
 */
const uhsAuftrag = (() => {
  const roh = searchParams.get('uhs');
  if (roh == null) return null;
  const id = Number(roh);
  return Number.isInteger(id) && id > 0 ? id : null;
})();
```

Die Mutation um die Belegung erweitern:

```tsx
onSuccess: async (ergebnis) => {
  if (ergebnis.zustand === 'vorgemerkt') {
    setQuittung(
      uhsAuftrag
        // KEIN Versprechen, das kein Code einlöst: die Queue trägt die Person, aber
        // niemand schiebt danach die Belegung nach (gemessen — `offline/schreiben.ts`
        // hat keinen Drain-Hook für Folgeaktionen). Eine still ausgefallene Zuordnung
        // wäre eine Person, die an der UHS niemand sucht; ein falsches „folgt" wäre
        // schlimmer, weil dann auch niemand nachsieht. Zielticket: uhs_id am POST.
        ? 'Offline vorgemerkt — Registriernummer folgt nach der Übertragung, die Zuordnung zur Unfallhilfsstelle muss danach von Hand erfolgen.'
        : 'Offline vorgemerkt — Registriernummer folgt nach der Übertragung.',
    );
  } else {
    const person = ergebnis.daten;
    let zusatz = '';
    if (uhsAuftrag) {
      try {
        await aenderePersonBelegung(einsatzId, person.id, {
          art: 'eintritt',
          uhs_id: uhsAuftrag,
          platz_id: null,
        });
        zusatz = ' · im Wartebereich';
      } catch (e) {
        // Die Person IST angelegt — das darf die Quittung nicht verschweigen, nur
        // weil der zweite Schritt gescheitert ist.
        message.error(fehlerText(e));
        zusatz = ' · Zuordnung zur Unfallhilfsstelle fehlgeschlagen';
      }
      void qc.invalidateQueries({ queryKey: einsatzKeys.uhsDetail(einsatzId, uhsAuftrag) });
      void qc.invalidateQueries({ queryKey: einsatzKeys.uhs(einsatzId) });
    }
    setQuittung(
      (person.aktuelle_sichtung
        ? `Erfasst als ${registrierAnzeige(person.registrier_nr)} · ${SK_META[person.aktuelle_sichtung].label}`
        : `Erfasst als ${registrierAnzeige(person.registrier_nr)}`) + zusatz,
    );
  }
  void qc.invalidateQueries({ queryKey: einsatzKeys.personen(einsatzId) });
  void qc.invalidateQueries({ queryKey: einsatzKeys.etb(einsatzId) });
},
```

Rückweg und Beschriftung:

```tsx
onFertig={() =>
  navigate(uhsAuftrag ? uhsDetailPfad(einsatzId, uhsAuftrag) : personenPfad(einsatzId))
}
```

Die Seitenbeschreibung und der Breadcrumb sollen den Auftrag zeigen, sonst weiß niemand, wohin der Patient läuft:

```tsx
beschreibung={
  uhsAuftrag
    ? 'Sichtungskategorie zuerst — die Person landet danach im Wartebereich der Unfallhilfsstelle.'
    : 'Sichtungskategorie zuerst — die übrigen Angaben sind optional.'
}
```

Imports: `useSearchParams`, `aenderePersonBelegung`, `uhsDetailPfad`.

- [ ] **Step 12: Test laufen lassen, grün bestätigen**

```bash
mise exec pnpm@11.10.0 -- pnpm -C /Users/rubeen/dev/personal/lifeline-hub/.claude/worktrees/lfh-341/frontend test --run src/pages/personen/AufnahmePage.test.tsx src/pages/uhs/UhsDetailPage.test.tsx src/routing/deeplinks.test.ts
```
Erwartet: PASS.

- [ ] **Step 13: Commit**

```bash
git add frontend/src/routing/deeplinks.ts frontend/src/routing/deeplinks.test.ts \
        frontend/src/pages/uhs/UhsDetailPage.tsx frontend/src/pages/uhs/UhsDetailPage.test.tsx \
        frontend/src/pages/personen/AufnahmePage.tsx frontend/src/pages/personen/AufnahmePage.test.tsx
git commit -m "$(cat <<'EOF'
feat(lfh-341): nimmt Patienten von der UHS-Kopfzeile aus auf

Die Aufnahme-Route aus C5 bekommt ihren ersten Konsumenten: ?uhs=<id> bucht
nach dem Anlegen den Eintritt in den Wartebereich und kehrt zur UHS zurueck.
Der Offline-Fall hat keine Person-ID — das sagt die Quittung, statt die
Zuordnung still ausfallen zu lassen.

LFH-341
EOF
)"
```

---

### Task 6: Vitest für die Zuweisung — alle Aufrufer von `belegMut`

**Files:**
- Modify: `frontend/src/pages/uhs/Grundriss.test.tsx`

**Interfaces:**
- Consumes: die in B5g gebauten `onMutate`/`onError`-Zweige von `belegMut` (`Grundriss.tsx:537-570`), unverändert.
- Produces: nichts.

**Warum diese Task existiert, obwohl die Funktion steht.** Das optimistische Update ist Bestand aus B5g — das AK von C6 verlangt aber den **Nachweis je Aufrufer**. Zum Ticketzeitpunkt waren es zwei (`onDragEnd`, Zuweisungsdialog); mit Task 3 sind es **drei** (der Menüeintrag „Zurück in den Wartebereich"). Erst prüfen, ob die Bestandssuite die ersten beiden schon führt; für den dritten ist die Zusicherung neu.

**Läuft Task 3 vor dieser Task**, deckt deren Test „schickt den Rückweg über dieselbe Mutation" den Aufruf ab, nicht aber das optimistische Verhalten dabei — das ist hier zu ergänzen. Die Reihenfolge im Plan ist so gewählt, dass Task 3 zuerst kommt.

- [ ] **Step 1: Prüfen, was die Bestandssuite belegt**

```bash
grep -n "optimist\|vor der Server-Antwort\|Rollback\|zurückgerollt\|onMutate" \
  frontend/src/pages/uhs/Grundriss.test.tsx
```

Ergibt das für **alle drei** Wege je eine Zusicherung „Karte steht vor der Antwort am Ziel" **und** „bei Ablehnung zurück am Ausgangsplatz", ist die Task erledigt → Schritt 4. Fehlt einer der vier Fälle, weiter mit Schritt 2. **Das Ergebnis dieser Prüfung gehört in die Prüfliste** (Task 8), egal wie es ausfällt.

- [ ] **Step 2: Fehlende Zusicherung schreiben (rot)**

Muster für den Dialog-Weg (den Drag-Weg analog, mit dem dnd-kit-Helfer der Bestandssuite):

```tsx
it('setzt die Karte über den Zuweisungsdialog vor der Server-Antwort an den Platz', async () => {
  // Die Zusage bleibt offen — genau das ist der Punkt: geprüft wird der Zustand
  // ZWISCHEN Klick und Antwort. Mit einer sofort erfüllten Zusage wäre der Test
  // auch ohne `onMutate` grün und belegte nichts.
  let aufloesen: (w: unknown) => void = () => {};
  vi.mocked(aenderePersonBelegung).mockReturnValue(new Promise((res) => { aufloesen = res; }));

  renderMitProviders(<Grundriss einsatzId={1} uhs={uhsFixture} schreibgeschuetzt={false} />);
  await userEvent.click(await screen.findByRole('button', { name: /Patient zuweisen/ }));
  await userEvent.click(await screen.findByRole('option', { name: /Pat-1/ }));
  await userEvent.click(screen.getByRole('button', { name: 'Zuweisen' }));

  const platzKarte = await screen.findByTestId('platz-karte-1');
  expect(within(platzKarte).getByText(/Pat-1/)).toBeInTheDocument();

  aufloesen({ person_id: 1, uhs_id: 1, platz_id: 1 });
});

it('rollt die Karte auf den Ausgangsplatz zurück, wenn der Server ablehnt', async () => {
  vi.mocked(aenderePersonBelegung).mockRejectedValue(new ApiError('abgelehnt', 422));

  renderMitProviders(<Grundriss einsatzId={1} uhs={uhsFixture} schreibgeschuetzt={false} />);
  await userEvent.click(await screen.findByRole('button', { name: /Patient zuweisen/ }));
  await userEvent.click(await screen.findByRole('option', { name: /Pat-1/ }));
  await userEvent.click(screen.getByRole('button', { name: 'Zuweisen' }));

  const platzKarte = await screen.findByTestId('platz-karte-1');
  await waitFor(() => expect(within(platzKarte).queryByText(/Pat-1/)).not.toBeInTheDocument());
  expect(await screen.findByText(/Pat-1/)).toBeInTheDocument(); // wieder in der Warteliste
});
```

**Die genauen Rollen und Beschriftungen des Zuweisungsdialogs stehen in `Grundriss.tsx` (`setZuweisenPlatz`, `zuweisbarePersonen`) und in der Bestandssuite von B5g** — dort nachsehen, nicht raten. Der Dialog ist ein `ErfassungsModal`; die Auswahl ist ein `Select`, dessen Optionen im Portal liegen (`.ant-select-dropdown:not(.ant-select-dropdown-hidden)` + `within`).

- [ ] **Step 3: Test laufen lassen, Fehlschlag bestätigen, dann grün**

```bash
mise exec pnpm@11.10.0 -- pnpm -C /Users/rubeen/dev/personal/lifeline-hub/.claude/worktrees/lfh-341/frontend test --run src/pages/uhs/Grundriss.test.tsx
```

Ein neu geschriebener Test gegen bestehende Funktion ist **sofort grün** — das ist kein TDD-Verstoß, aber es beweist auch nichts. Deshalb die Mutationsprobe: `onMutate` in `belegMut` kurz auskommentieren, Test laufen lassen (muss **rot** werden), wieder einkommentieren. Ohne diese Probe ist unbekannt, ob der Test die Zusicherung überhaupt prüft.

- [ ] **Step 4: Commit (entfällt, wenn nichts geschrieben wurde)**

```bash
git add frontend/src/pages/uhs/Grundriss.test.tsx
git commit -m "$(cat <<'EOF'
test(lfh-341): misst das optimistische Update auf ALLEN Wegen zur Belegung

belegMut hatte seit B5g zwei Aufrufer und hat seit dem Umbruch drei; die
Zusicherung gehoert an die Mutation, nicht an einen der Wege. Per
Mutationsprobe belegt.

LFH-341
EOF
)"
```

---

### Task 7: Playwright — Touch und 390 px

**Files:**
- Create: `frontend/e2e/uhs-grundriss-touch.spec.ts`

**Interfaces:**
- Consumes: das Anmelde- und Setup-Muster aus `frontend/e2e/uhs-grundriss-person-scroll.spec.ts` (`anmelden`, `setupBelegterPlatz`) — **übernehmen, nicht neu erfinden**; dort steht bereits, wie Einsatz, Person, UHS und Platz angelegt werden, samt der C5-Besonderheit, dass „Name" unter „Weitere Angaben" liegt.
- Produces: nichts.

**Die Aufteilung, die aus dem Zuschnitt oben folgt:** Drag unter Touch bei **1024 px**, Klickweg unter Touch bei **390 px**. Ein 390-px-Drag-Test kann nicht grün werden — Quelle und Ziel liegen in verschiedenen Reitern.

- [ ] **Step 1: Spec schreiben**

```ts
import { expect, test, type Page } from '@playwright/test';

const ADMIN = 'admin';
const PW = process.env.E2E_ADMIN_PW ?? 'e2e-admin-pw';

// Touch-Kontext für die ganze Datei: dnd-kits PointerSensor hört auf Pointer Events,
// und erst mit `hasTouch` erzeugt der Browser welche mit `pointerType: 'touch'`.
test.use({ hasTouch: true });

/** … `anmelden` und `setupPatientUndPlatz` aus uhs-grundriss-person-scroll.spec.ts … */

/**
 * Touch-Drag von Hand: Playwright hat keine Touch-Drag-API. `page.touchscreen` kann
 * tippen, nicht ziehen — deshalb die drei Pointer-Events einzeln, mit `pointerType:
 * 'touch'`. Ein Drag über `page.mouse` wäre `pointerType: 'mouse'` und belegte
 * genau das nicht, was hier zu belegen ist.
 */
async function ziehePerTouch(page: Page, vonSel: string, nachSel: string) {
  await page.evaluate(([a, b]) => {
    const quelle = document.querySelector(a)!;
    const ziel = document.querySelector(b)!;
    const qr = quelle.getBoundingClientRect();
    const zr = ziel.getBoundingClientRect();
    const opt = (x: number, y: number) => ({
      pointerId: 1, pointerType: 'touch', isPrimary: true,
      clientX: x, clientY: y, bubbles: true, cancelable: true,
    });
    const x0 = qr.x + qr.width / 2, y0 = qr.y + qr.height / 2;
    const x1 = zr.x + zr.width / 2, y1 = zr.y + zr.height / 2;
    quelle.dispatchEvent(new PointerEvent('pointerdown', opt(x0, y0)));
    // Mehrere Schritte, damit dnd-kit den 5-px-Activation-Constraint nimmt.
    for (let i = 1; i <= 10; i++) {
      const x = x0 + ((x1 - x0) * i) / 10, y = y0 + ((y1 - y0) * i) / 10;
      document.dispatchEvent(new PointerEvent('pointermove', opt(x, y)));
    }
    document.dispatchEvent(new PointerEvent('pointerup', opt(x1, y1)));
  }, [vonSel, nachSel]);
}

test.describe('UHS-Grundriss unter Touch', () => {
  test('Führungs-Tablet (1024 px): Patient per Touch-Drag auf einen Platz', async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 900 });
    const { personName } = await setupPatientUndPlatz(page);

    const platz = page.locator('[data-testid="platz-karte"]', { hasText: 'Bett 1' });
    await expect(platz).toBeVisible();

    const patch = page.waitForRequest(
      (r) => r.method() === 'POST' && /\/api\/einsaetze\/\d+\/personen\/\d+\/belegung/.test(r.url()),
    );
    await ziehePerTouch(page, `[data-testid="person-karte-${personName}"]`, '[data-testid="platz-karte"]');
    const req = await patch;
    expect(JSON.parse(req.postData() ?? '{}')).toMatchObject({ art: expect.any(String) });

    await expect(platz).toContainText(personName);
  });

  test('Führungs-Tablet: die Warteliste scrollt bei ANGEHALTENEM Drag weiter', async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 900 });
    const { personName } = await setupPatientUndPlatz(page);

    // Das AK verlangt den Scroll WÄHREND des Drags. Ein Scrolltest ohne laufenden
    // Drag prüft etwas anderes — und `touchAction !== 'none'` allein halten die
    // beiden Bestands-Zusicherungen aus B5g in `Grundriss.test.tsx` schon billiger.
    // Deshalb: pointerdown + Moves, dann scrollen, ERST DANN pointerup.
    const spalte = page.locator('[data-testid="warteliste-scroll"]');
    await spalte.evaluate((el) => { el.scrollTop = 0; });

    await page.evaluate((sel) => {
      const quelle = document.querySelector(sel)!;
      const r = quelle.getBoundingClientRect();
      const opt = (x: number, y: number) => ({
        pointerId: 1, pointerType: 'touch', isPrimary: true,
        clientX: x, clientY: y, bubbles: true, cancelable: true,
      });
      const x = r.x + r.width / 2, y = r.y + r.height / 2;
      quelle.dispatchEvent(new PointerEvent('pointerdown', opt(x, y)));
      for (let i = 1; i <= 6; i++) {
        document.dispatchEvent(new PointerEvent('pointermove', opt(x + i * 4, y + i * 4)));
      }
    }, `[data-testid="person-karte-${personName}"]`);

    // Der Drag läuft jetzt (dnd-kit hat den 5-px-Constraint genommen).
    await expect(page.locator('.uhs-drag-overlay, [data-testid="drag-overlay"]')).toBeVisible();

    const box = (await spalte.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.wheel(0, 300);
    await expect.poll(async () => spalte.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);

    // Drag sauber beenden, damit der nächste Test nicht auf einem hängenden
    // Pointer-Capture aufsetzt.
    await page.evaluate(() => {
      document.dispatchEvent(new PointerEvent('pointerup', {
        pointerId: 1, pointerType: 'touch', isPrimary: true, bubbles: true, cancelable: true,
      }));
    });
  });

  test('Mobil (390 px): der Klickweg weist zu, und der Body scrollt nicht waagerecht', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const { personName } = await setupPatientUndPlatz(page);

    // AK 2: kein waagerechter Ueberlauf. Gemessen am Dokument, nicht am Augenschein.
    const ueberlauf = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(ueberlauf).toBeLessThanOrEqual(1); // 1 px Subpixel-Toleranz

    // AK 2: die Seitenspalten sind Reiter, nicht Nachbarn.
    await expect(page.getByRole('tab', { name: 'Fläche' })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Wartebereich' })).toBeVisible();

    // AK 1: der in B5g gebaute Klickweg, hier per echtem Touch-Tap.
    await page.getByRole('tab', { name: 'Fläche' }).tap();
    await page.locator('[data-testid="platz-karte"]', { hasText: 'Bett 1' }).tap();
    await page.getByRole('button', { name: /Patient zuweisen/ }).tap();
    await page.getByRole('combobox').tap();
    await page.getByTitle(personName).tap();
    await page.getByRole('button', { name: 'Zuweisen' }).tap();

    await expect(page.locator('[data-testid="platz-karte"]', { hasText: 'Bett 1' }))
      .toContainText(personName);
  });
});
```

**Zwei Dinge sind beim Umsetzen zu prüfen und ggf. anzupassen, nicht zu raten:**
- Die Testids `person-karte-<name>` und `warteliste-scroll` gibt es heute womöglich nicht. Dann in `Grundriss.tsx` ergänzen (das ist zulässig) oder auf eine vorhandene Abfrage umstellen. `platz-karte` ist Bestand (`uhs-grundriss-dnd.spec.ts:46`).
- Der Wortlaut der Zuweisungs-Bedienung („Patient zuweisen", „Zuweisen") kommt aus B5g — in `Grundriss.tsx` nachlesen. Ebenso der neue Menüeintrag „Zurück in den Wartebereich" aus Task 3, falls er im 390-px-Test mitgeprüft werden soll.
- Der Selektor für den laufenden `DragOverlay` ist ein Platzhalter. Antds/dnd-kits Overlay hat im Repo heute keine Marke — entweder eine setzen (`data-testid="drag-overlay"` am `<DragOverlay>`-Kind in `Grundriss.tsx`) oder auf die Personenkarte im Portal abfragen. Ohne eine Zusicherung, dass der Drag WIRKLICH läuft, fällt der Test auf den billigen Scrolltest zurück, den B5g schon hat.

- [ ] **Step 2: Backend-Binary bereitstellen und Suite laufen lassen**

```bash
cargo build
mise exec pnpm@11.10.0 -- pnpm -C /Users/rubeen/dev/personal/lifeline-hub/.claude/worktrees/lfh-341/frontend e2e uhs-grundriss-touch
```

Die Suite ist selbsttragend (LFH-309): sie startet Backend und Vite selbst auf freien Ports. Sie braucht aber ein gebautes `target/debug/lifeline-hub` — sonst überspringt sie mit lautem Hinweis. **Ein „übersprungen" ist kein grüner Lauf.**

Sollte das Binary aus einem `bacon`-Lauf mit `--features dev-seeds` stammen, scheitern alle Logins. Dann `cargo build` ohne Features neu fahren.

- [ ] **Step 3: Bestehende UHS-e2e mitlaufen lassen**

```bash
mise exec pnpm@11.10.0 -- pnpm -C /Users/rubeen/dev/personal/lifeline-hub/.claude/worktrees/lfh-341/frontend e2e uhs-grundriss
```

Erwartet: PASS für alle drei Specs. `uhs-grundriss-dnd.spec.ts` und `uhs-grundriss-person-scroll.spec.ts` laufen in der Playwright-Vorgabebreite — liegt die unter 992, treffen sie jetzt den Tabs-Zweig. Dann in beiden Specs die Viewport-Größe **explizit** setzen (`page.setViewportSize({ width: 1280, height: 900 })`), nicht die Erwartungen abschwächen.

- [ ] **Step 4: Commit**

```bash
git add frontend/e2e/ frontend/src/pages/uhs/Grundriss.tsx
git commit -m "$(cat <<'EOF'
test(lfh-341): weist Drag und Klickweg unter Touch nach, jeder in seiner Breite

Drag auf Tablet-Breite, Klickweg bei 390 px — dort liegen Quelle und Ziel in
verschiedenen Reitern, ein Drag koennte dort gar nicht gruen werden. Der
Scroll-Nachweis haelt die touchAction-Entscheidung aus B5g fest.

LFH-341
EOF
)"
```

---

### Task 8: Prüfliste erweitern, Gate fahren

**Files:**
- Modify: `docs/superpowers/specs/2026-07-30-uhs-grundriss-pruefliste.md`

**Interfaces:** keine.

**Die Prüfliste wird ERWEITERT, keine zweite angelegt.** Sie existiert seit B5g und ihre Zeile 1a ist im Ticket namentlich zitiert. `EinsatzabschnittePage` und `BrDetailPage` bekommen **keine eigene** — sie sind in C6 mit je einer Layout-Weiche angefasst, nicht umgebaut; die Prüfliste ist für neue oder umgebaute **Seiten** gedacht, und ein Umbruch ist keine neue Seite. Diese Einschätzung gehört als Satz in die Prüfliste, damit sie nachprüfbar ist statt stillschweigend.

- [ ] **Step 1: Die 15 Kriterien für den Grundriss neu durchgehen**

Jede Zeile trägt ein Verdikt: **erfüllt** / **offen → Zielticket** / **nicht anwendbar**. „Nicht geprüft" ist keins. Die Kriterien stehen in `docs/superpowers/specs/2026-07-25-bedien-leitlinie-einsatzkontexte.md`.

- [ ] **Step 2: Die vier Verdikte aus diesem Plan aufnehmen**

Wörtlich, mit Begründung und Fundstelle:

1. **„Paginierung 50" — überholt durch LFH-330/B2.** `components/Datensicht.tsx:1237-1240` begründet `pagination={false}` mit der Zeilenschleuse. Nicht gebaut.
2. **„Zeitleiste unter `md`" — erfüllt durch die Kartenform von B2.** `BewegungenTab.tsx:150-170`, Karte trägt Art-Tag, Zeit und Registriernummer.
3. **„Aufklappbarer Kopfbereich" für Gliederungsbaum und BR-Spalte — gestapelt statt Collapse**, nach der Präzedenz `GefahrenPage.tsx:160`.
4. **Materialfarbe — C4s offene Frage ist entschieden**, nicht zurückgedreht; `MaterialPage` ist im selben Commit mitgezogen worden, weil zwei Farbbehandlungen eines Enums der Fehlerfall wären.

5. **Der Rückweg in den Wartebereich hat einen zweiten Pfad bekommen** (Task 3). Er hing allein am Drag auf `drop-inbox` und wäre unter `lg` ersatzlos entfallen — der Umbruch hätte eine Bewegung genommen, statt eine zu geben. `belegMut` hat damit **drei** Aufrufer; das AK „für beide Aufrufer" ist erfüllt und überschritten.
6. **Die Offline-Zuordnung ist ehrlich benannt, nicht gelöst** (Task 5). Die Quittung verspricht nichts, was kein Code einlöst; der saubere Weg (`uhs_id` am POST, in derselben Transaktion wie bei der Sichtung in C5) liegt als Folgeticket vor.
7. **Die UHS-Detailseite nutzt jetzt den gemeinsamen Modul-Seitenkopf** (Task 2) — die Abhängigkeitszeile des Tickets verlangte es, und ohne ihn wäre „genau eine Primäraktion" auf dieser Seite nicht prüfbar gewesen, sondern gezählt.

Dazu das Ergebnis der Prüfung aus Task 6, Schritt 1: was die Bestandssuite für die `belegMut`-Aufrufer schon belegte und was C6 ergänzt hat.

**Und der Satz, warum es keine zweite Prüfliste gibt:** `EinsatzabschnittePage` und `BrDetailPage` haben in C6 je eine Layout-Weiche bekommen, keinen Umbau. Die Prüfliste gilt neuen oder umgebauten **Seiten**; ein Umbruch ist keine neue Seite. Wer diese beiden Seiten das nächste Mal inhaltlich anfasst, legt eine an.

- [ ] **Step 3: Das vertagte Backend-Ticket anlegen**

Über den Skill `clickup-task-anlegen` auf dem Entwicklungsboard (`901523554968`), unter das lebende Sammel-Epic, in das die C-Band-Nachzüge gehören:

> **`uhs_id` optional am `POST /api/einsaetze/{id}/personen` — Wartebereich-Eintritt in derselben Transaktion**
>
> LFH-341/C6 schickt Patienten von der UHS-Kopfzeile in die Aufnahme (`?uhs=<id>`) und bucht danach `aenderePersonBelegung({ art: 'eintritt', uhs_id, platz_id: null })` als zweiten Request. **Offline geht diese Zuordnung verloren:** `erfassePersonOfflineFaehig` legt die Person mit `client_id`-Idempotenz in die Queue, aber es gibt keinen Drain-Hook, der die Belegung nachschöbe — die Quittung sagt deshalb heute ehrlich „muss danach von Hand erfolgen".
>
> Die Lösung ist dieselbe, die LFH-340/C5 für die **Sichtung** gewählt hat und die CLAUDE.md als Regel führt: das Feld geht **mit** dem Anlegen mit und wird serverseitig in derselben Transaktion geschrieben. Dann trägt die Offline-Vormerkung es in ihrer `client_id` mit, und der Replay legt die Belegung nicht doppelt in die Kette, aus der der medizinische Verlauf gelesen wird.
>
> Umfang: `uhs_id: Option<i64>` am Anlege-DTO, Belegung unter `war_neu` in derselben Transaktion, Antwort **nach** der Belegung laden (sonst trägt die Quittung einen Zustand, den es nie gab); 422 bei `status: 'vermisst'`, 404 bei unbekannter UHS. Frontend: den zweiten Request in `pages/personen/AufnahmePage.tsx` ersetzen und den Offline-Wortlaut zurücknehmen.

Die Ticketnummer in die Prüfliste eintragen — ein Verdikt „offen" ohne Zielticket ist keins.

- [ ] **Step 4: Volles Gate fahren**

```bash
./scripts/check-all.sh
```

Erwartet: alle sieben Schritte grün. Kein `| tail`. Bei Rot: die Ursache beheben, nicht die Erwartung.

- [ ] **Step 5: Commit**

```bash
git add docs/superpowers/specs/2026-07-30-uhs-grundriss-pruefliste.md
git commit -m "$(cat <<'EOF'
docs(lfh-341): schreibt die Pruefliste fort und begruendet vier Verdikte

Zwei Akzeptanzkriterien sind durch B2 ueberholt, eines folgt der Praezedenz
aus GefahrenPage statt dem Ticketwortlaut, und die Materialfarbe loest eine
Frage ein, die C4 ausdruecklich offen gelassen hat.

LFH-341
EOF
)"
```

---

## Self-Review

**Spec coverage.** Die fünf Ticket-Bullets und sechs Akzeptanzkriterien sind je einer Task oder einem Verdikt zugeordnet — die Tabelle unter „Zuschnitt" ist die Abdeckungsliste. Nicht enthalten und bewusst so: die Touch-Grundlage (H39, gehört B5g laut Ticket-Zuschnitt vom 30.07.2026), das optimistische Feedback (M52, Bestand aus B5g), Sortierung/Filter/Suche im Bewegungen-Tab (M53, Bestand aus B2), die Verfügbarkeitsanzeige im Grundriss (Teil von M54, Bestand aus A2) und die `GefahrenPage`-Weiche (Teil von H40, Bestand).

**Placeholder-Scan.** Vier Stellen sagen ausdrücklich „nachsehen, nicht raten" statt eine Fixture oder einen Wortlaut zu erfinden: das `data-testid` von `Datenstand` (Task 2), das Muster für einen Benutzer ohne Schreibrecht (Task 5), der Navigations-Nachweis unter dem Memory-Router (Task 5) und die Beschriftungen des Zuweisungsdialogs (Tasks 6, 7). Das sind keine Platzhalter — es sind Bestandsdetails, die im Code stehen und deren Erfindung schlechter wäre als ihr Nachschlagen. Jede Stelle nennt die Datei, in der die Antwort steht.

**Typkonsistenz.** `personenAufnahmePfad(einsatzId, { uhs })` heißt in Task 5 Schritt 3, Schritt 5 und Schritt 7 gleich. `materialStatus` ist in Task 1 definiert und wird in Task 1 Schritt 9 sowie Task 8 unter demselben Namen konsumiert. `aenderePersonBelegung(einsatzId, personId, { art, uhs_id, platz_id })` ist in Task 5 mit derselben Signatur gerufen, mit der `Grundriss.tsx:534` sie heute ruft. Die Testids `grundriss-rahmen` (Task 3), `abschnitte-rahmen`/`abschnitte-gliederung` (Task 4), `kraefte-ohne-br` (Task 4), `uhs-kopf` (Task 2) und `material-status-zelle` (Task 1) kommen je genau einmal vor.

**Reihenfolge.** Tasks 1, 2, 3 und 4 sind untereinander unabhängig. Task 5 setzt auf Task 2 auf (der `aktionen`-Slot, in den der Knopf kommt — ohne den Umzug stünde er in einem Kopf, den kein Gate zählt). Task 6 setzt auf Task 3 auf (der dritte `belegMut`-Aufrufer). Task 7 setzt auf Task 3 (die Reiter und der Rückweg, die sie prüft) und Task 5 (nicht zwingend, aber der 390-px-Test läuft leichter, wenn der Aufnahmeweg steht). Task 8 kommt zuletzt und braucht das Ergebnis aller anderen.

**Was sich nach dem ersten Advisor-Durchgang geändert hat** — drei Befunde, alle am Code gemessen, alle vor dem ersten Handgriff eingearbeitet: der Rückweg in den Wartebereich hing allein am Drag und wäre unter `lg` weggefallen (Task 3); die Offline-Quittung versprach eine Zuordnung, die kein Code nachschiebt (Task 5 plus Folgeticket); und die UHS-Detailseite hatte gar keinen `EinsatzSeite`-Kopf, in dem „genau eine Primäraktion" prüfbar gewesen wäre (Task 2). Dazu zwei kleinere: das Inventar-Gate in `statusFarben.test.ts` bricht bei einem zehnten Export (Task 1, Schritt 4), und der Scroll-Nachweis prüfte am AK vorbei, weil er ohne laufenden Drag scrollte (Task 7).
