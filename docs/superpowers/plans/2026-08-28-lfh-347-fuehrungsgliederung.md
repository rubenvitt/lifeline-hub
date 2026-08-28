# LFH-347 · C12 Führungsgliederung — Implementierungsplan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Die Führungsgliederung zeigt kumulierte Stärken (Abschnitt inkl. Unterabschnitte, Bereitstellungsraum), der Gliederungsbaum trägt Führungsinformation aus Theme-Tokens, „Abschnitt anlegen" schreibt erst beim Speichern, und der Bereitstellungsraum bekommt denselben Direkteinstieg wie die UHS.

**Architecture:** Reine, exportierte Rechenfunktionen (`summiereStaerke`, `abschnittStaerken`, `waehleDefaultEintrag`, `gruppiereFreieKraefte`) tragen die Zusicherungen und sind ohne Render prüfbar; die Seiten konsumieren sie. Der UHS-Direkteinstieg (`UnfallhilfsstellenDefault` + `UhsSwitcher` + `uhsAuswahl`) wird zu generischen Bausteinen (`components/Direkteinstieg.tsx`, `components/EinstiegSwitcher.tsx`, `components/direkteinstieg.ts`) verallgemeinert; UHS und BR sind danach zwei dünne Konsumenten. Kein Backend-Umbau: alle benötigten Felder (`ist_kumuliert`, `typ_label`, `fahrzeugtyp`, `aktueller_br_id`) liegen bereits in den Listen-Queries, die die Seiten ohnehin laden.

**Tech Stack:** React 19, antd 6, TanStack Query 5, react-router 7, Vitest + Testing Library + msw, Playwright.

**Spec:** ClickUp LFH-347 (Beschreibung, 7 Punkte H37/H41/M51/M55/M56/M58/M59, 6 Akzeptanzkriterien). Kein separates Spec-Dokument.

## Global Constraints

- **Kein neues `size="small"` auf interaktiven Elementen** (`components/dichte.guard.test.ts`); `Liste`/`Card`/`Descriptions` sind ausgenommen (dort Abstandsmaß).
- **Farbwerte nur aus `theme.useToken()` / `theme/statusFarben.ts`** — kein Literal wie `#888`. AK: `grep -rn "#888" frontend/src/pages/` = 0.
- **Ein Emoji ist keine Ikone** — `👤`/`☎` werden beim Anfassen durch `@ant-design/icons` in einer `aria-hidden`-Hülle ersetzt.
- **Statusfarbe nur als Punkt/Rand, nie als Textfläche**, immer mit zweitem Kanal (WCAG 1.4.1).
- **Einsatz-Pfade nur über `frontend/src/routing/deeplinks.ts`**, keine Template-Literale in Seiten.
- **Query-Keys nur über `api/queryKeys.ts`** (`queryKeys.guard.test.ts`).
- **Erfassungsmasken über `components/Erfassung.tsx`** (`ErfassungsFormular`), kein handgebautes `<Modal onOk>`.
- **Commits mit `LFH-347` im Body** (Conventional Type `feat(lfh-347)`/`refactor(lfh-347)`/`test(lfh-347)`), Trailer:
  `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>` und
  `Claude-Session: https://claude.ai/code/session_01Av3wVEyh3w7pSvvem5yeur`.
- **Tests laufen mit** `mise exec pnpm@11.10.0 -- pnpm -C <ABS>/frontend exec vitest run <pfad>`; `<ABS>` = `/Users/rubeen/dev/personal/lifeline-hub/.claude/worktrees/feat+lfh-347-fuehrungsgliederung-staerke-datenzustaende`. Pass/Fail-Gates über `rtk proxy …` (der rtk-Hook maskiert Exit-Codes).
- **Board-Wortlaut des Fehler-Knopfs ist „Erneut abrufen"** (`SeitenFehler`, LFH-331/B3) — das Ticket schreibt „Erneut laden"; der Primitiv-Wortlaut bleibt, das Ticket wird nicht zum zweiten Wortlaut.

---

## Vorab-Befund: was das Ticket verlangt und der Bestand schon trägt

Das Ticket entstand vor Band B. Drei seiner sieben Punkte sind **ganz oder teilweise eingelöst**;
der Plan baut nur das, was fehlt, und benennt den Rest hier, damit die Prüfliste (Task 10)
nicht ins Leere zeigt.

| Befund | Stand im Bestand (gemessen 28.08.2026) | Was der Plan noch tut |
| --- | --- | --- |
| **H41** Fehlerzustand listentragender Queries | **Erledigt durch LFH-331/B3.** Alle drei Seiten tragen `SeitenFehler` (= `Alert type="error"` + „Erneut abrufen") und `SeitenStandVeraltet`; die Vitest-Paare „zeigt bei gescheitertem Abruf den Fehler und NICHT den Leertext" existieren in `EinsatzabschnittePage.test.tsx:253`, `UnfallhilfsstellenPage.test.tsx:169`, `BereitstellungsraeumePage.test.tsx:87`. UHS-Tabelle hat `locale.emptyText`. | Nur der **handlungsleitende Leerzustand des BR** fehlt (Tabelle zeigt bloß Text) — kommt mit dem BR-Direkteinstieg in Task 6 (`SeitenLeer` + „Ersten BR anlegen"). |
| **M51** Gefahrenmatrix-Zelle | **Entschieden in LFH-368/B5h** (gemessen): Breitenbudget der Matrix im Fükw ist ~693 px, ein 5-Wege-Segmentcontrol bräuchte ~1050 px. Gewählt: ein Auslöser je Zelle (Dropdown, Kürzel + Fläche, Ikonen-Spaltenköpfe). `size="small"` steht in `pages/gefahren/` nur noch an `<Liste>` (Abstandsmaß, guard-konform). | **Kein Umbau auf Segmentcontrol** — das wäre das Zurückdrehen einer gemessenen Entscheidung. Task 9 liefert den fehlenden **e2e-Nachweis** (Zellhöhe ≥ 44 px auf dem Führungs-Tablet, Stufe `komfortabel` = 48 px) und dokumentiert die Abweichung vom AK „ein Tipp" (es sind zwei: öffnen, wählen). |
| **M56** BR-Direkteinstieg | Nicht vorhanden. | Tasks 5–6. |
| **H37, M55, M58, M59** | Nicht vorhanden. | Tasks 1–4, 7–8. |

**Zur 44-px-Marke:** die Dichte-Staffel ist 30 / 48 / 72 px (kompakt / komfortabel / handschuh).
„≥ 44 px" gilt für Touch-Kontexte (Führungs-Tablet, mobil), dort steht die Stufe `komfortabel`
oder `handschuh`. Im Fükw (Maus, kompakt) sind 30 px die Festlegung aus LFH-352 — ein Test, der
dort 44 verlangte, widerspräche der Leitlinie.

---

## Dateistruktur

**Neu:**
- `frontend/src/anzeige/staerke.ts` — `summiereStaerke(einheiten)`: eine Summe, drei Konsumenten (Abschnitt eigene, Abschnitt inkl., BR).
- `frontend/src/pages/einsatzabschnitte/abschnittStaerke.ts` — `nachfahrenInkl` (umgezogen) + `abschnittStaerken`.
- `frontend/src/pages/einsatzabschnitte/AbschnittKnoten.tsx` — Baumknoten mit Führungsinformation (Token-Farben).
- `frontend/src/pages/farbliteral.guard.test.ts` — Grep-Gate `#888` = 0 in `pages/`.
- `frontend/src/components/direkteinstieg.ts` — generische Auswahl + `localStorage`-Speicher.
- `frontend/src/components/Direkteinstieg.tsx` — generische Index-Route (Weiterleitung / Leerzustand / Fehler).
- `frontend/src/components/EinstiegSwitcher.tsx` — generischer Kopf-Switcher.
- `frontend/src/pages/bereitstellungsraum/BrAnlegenDrawer.tsx` — aus `BereitstellungsraeumePage` extrahiert.
- `frontend/src/pages/bereitstellungsraum/brAuswahl.ts` — BR-Belegung des generischen Bausteins.
- `frontend/src/pages/bereitstellungsraum/BereitstellungsraeumeDefault.tsx` — Index-Route BR.
- `frontend/src/pages/bereitstellungsraum/BrSwitcher.tsx` — Kopf-Switcher BR.
- `frontend/src/pages/bereitstellungsraum/freieKraefte.ts` — `gruppiereFreieKraefte` (Suche + Gruppierung, rein).
- `frontend/e2e/gefahren-matrix-zelle.spec.ts` — Zellhöhe auf dem Tablet.
- `docs/superpowers/specs/2026-08-28-lfh-347-pruefliste.md` — Prüfliste Einsatztauglichkeit.

**Geändert:**
- `frontend/src/pages/EinsatzabschnittePage.tsx` — zwei Stärken, Knoten, lokaler Entwurf.
- `frontend/src/pages/EinheitenPage.tsx:71` — `#888` → Token.
- `frontend/src/pages/uhs/uhsAuswahl.ts`, `pages/UnfallhilfsstellenDefault.tsx`, `pages/uhs/UhsSwitcher.tsx` — dünne Konsumenten der generischen Bausteine.
- `frontend/src/pages/bereitstellungsraum/BereitstellungsraeumePage.tsx` — Drawer raus, Leerzustand mit Aktion.
- `frontend/src/pages/bereitstellungsraum/BrDetailPage.tsx` — Typ/Stärke/Summenzeile, Switcher, `merkeLetztenBr`.
- `frontend/src/pages/bereitstellungsraum/KraefteOhneBrSidebar.tsx` — Suche, Scroll, Gruppen.
- `frontend/src/routing/deeplinks.ts` — `bereitstellungsraeumeListePfad`.
- `frontend/src/App.tsx` — BR-Index → Default, `bereitstellungsraeume/liste`.

---

### Task 1: `summiereStaerke` und `abschnittStaerken` (H37, Rechenkern)

**Files:**
- Create: `frontend/src/anzeige/staerke.ts`
- Create: `frontend/src/anzeige/staerke.test.ts`
- Create: `frontend/src/pages/einsatzabschnitte/abschnittStaerke.ts`
- Create: `frontend/src/pages/einsatzabschnitte/abschnittStaerke.test.ts`
- Modify: `frontend/src/pages/EinsatzabschnittePage.tsx:48-65` (`nachfahrenInkl` entfernen, importieren)

**Interfaces:**
- Produces: `summiereStaerke(einheiten: ReadonlyArray<{ ist_kumuliert: Staerke }>): Staerke | null` — `null` bei leerer Liste (byte-gleich zum bisherigen Verhalten in `EinsatzabschnittePage.tsx:159`).
- Produces: `nachfahrenInkl(abschnitte: Einsatzabschnitt[], id: number): Set<number>` (unverändert, nur umgezogen und exportiert).
- Produces: `abschnittStaerken(abschnitte: Einsatzabschnitt[], einheiten: Einheit[], abschnittId: number): { eigene: Staerke | null; inklUnter: Staerke | null }`.

- [ ] **Step 1: Failing Tests für `summiereStaerke`**

```ts
// frontend/src/anzeige/staerke.test.ts
import { describe, expect, it } from 'vitest';
import { summiereStaerke } from './staerke';

describe('summiereStaerke', () => {
  it('liefert null bei leerer Liste — „keine Einheit" ist nicht „0/0/0"', () => {
    expect(summiereStaerke([])).toBeNull();
  });

  it('summiert je Achse über ist_kumuliert', () => {
    expect(summiereStaerke([
      { ist_kumuliert: { fuehrer: 1, unterfuehrer: 2, mannschaft: 3 } },
      { ist_kumuliert: { fuehrer: 0, unterfuehrer: 1, mannschaft: 5 } },
    ])).toEqual({ fuehrer: 1, unterfuehrer: 3, mannschaft: 8 });
  });
});
```

- [ ] **Step 2: Failing Tests für `abschnittStaerken`**

```ts
// frontend/src/pages/einsatzabschnitte/abschnittStaerke.test.ts
import { describe, expect, it } from 'vitest';
import type { Einheit, Einsatzabschnitt } from '../../api/types';
import { abschnittStaerken, nachfahrenInkl } from './abschnittStaerke';

function abschnitt(id: number, ueber: number | null): Einsatzabschnitt {
  return {
    id, einsatz_id: 1, ueber_abschnitt_id: ueber, name: `A${id}`, leiter_id: null,
    leiter_name: null, bemerkung: null, sortier: 0, sprechgruppen: [],
  } as unknown as Einsatzabschnitt;
}
function einheit(id: number, abschnittId: number | null, f: number, uf: number, m: number): Einheit {
  return {
    id, einsatz_id: 1, name: `E${id}`, abschnitt_id: abschnittId,
    ist: { fuehrer: f, unterfuehrer: uf, mannschaft: m },
    ist_kumuliert: { fuehrer: f, unterfuehrer: uf, mannschaft: m },
    sortier: 0, sprechgruppen: [], fahrzeug_mitglieder: [], personal_mitglieder: [], material_mitglieder: [],
  } as unknown as Einheit;
}

describe('nachfahrenInkl', () => {
  it('enthält den Abschnitt selbst und alle Nachfahren, nicht die Geschwister', () => {
    const a = [abschnitt(1, null), abschnitt(2, 1), abschnitt(3, 2), abschnitt(4, null)];
    expect([...nachfahrenInkl(a, 1)].sort()).toEqual([1, 2, 3]);
  });
});

describe('abschnittStaerken', () => {
  const a = [abschnitt(5, null), abschnitt(6, 5), abschnitt(7, 6)];
  const e = [einheit(1, 5, 1, 2, 3), einheit(2, 6, 0, 1, 1), einheit(3, 7, 0, 0, 2), einheit(4, null, 9, 9, 9)];

  it('„eigene" zählt nur die direkt zugeordneten Einheiten', () => {
    expect(abschnittStaerken(a, e, 5).eigene).toEqual({ fuehrer: 1, unterfuehrer: 2, mannschaft: 3 });
  });

  it('„inkl. Unterabschnitte" summiert über nachfahrenInkl — nicht zugeordnete Einheiten bleiben draußen', () => {
    expect(abschnittStaerken(a, e, 5).inklUnter).toEqual({ fuehrer: 1, unterfuehrer: 3, mannschaft: 6 });
  });

  it('ein Abschnitt ohne Unterabschnitte hat beide Werte gleich', () => {
    const s = abschnittStaerken(a, e, 7);
    expect(s.eigene).toEqual(s.inklUnter);
  });

  it('ohne Einheiten in der ganzen Teilgliederung sind beide null', () => {
    expect(abschnittStaerken([abschnitt(9, null)], e, 9)).toEqual({ eigene: null, inklUnter: null });
  });
});
```

- [ ] **Step 3: Run — beide rot**

Run: `mise exec pnpm@11.10.0 -- pnpm -C <ABS>/frontend exec vitest run src/anzeige/staerke.test.ts src/pages/einsatzabschnitte/abschnittStaerke.test.ts`
Expected: FAIL — „Failed to resolve import".

- [ ] **Step 4: Implementierung**

```ts
// frontend/src/anzeige/staerke.ts
import type { Staerke } from '../api/types';

/**
 * Summe der kumulierten Ist-Stärke einer Einheitenmenge, oder `null` bei leerer Menge.
 *
 * `null` und nicht `0/0/0`: „keine Einheit zugeordnet" ist eine andere Aussage als „eine
 * Einheit mit null Personen". `StaerkeAnzeige` zeigt dafür „—". Verhalten byte-gleich zur
 * früheren Inline-Reduktion in `EinsatzabschnittePage` (LFH-347 · C12 hat sie herausgezogen,
 * weil dieselbe Summe jetzt drei Konsumenten hat).
 */
export function summiereStaerke(
  einheiten: ReadonlyArray<{ ist_kumuliert: Staerke }>,
): Staerke | null {
  if (einheiten.length === 0) return null;
  return einheiten.reduce<Staerke>(
    (acc, e) => ({
      fuehrer: acc.fuehrer + (e.ist_kumuliert?.fuehrer ?? 0),
      unterfuehrer: acc.unterfuehrer + (e.ist_kumuliert?.unterfuehrer ?? 0),
      mannschaft: acc.mannschaft + (e.ist_kumuliert?.mannschaft ?? 0),
    }),
    { fuehrer: 0, unterfuehrer: 0, mannschaft: 0 },
  );
}
```

```ts
// frontend/src/pages/einsatzabschnitte/abschnittStaerke.ts
import type { Einheit, Einsatzabschnitt, Staerke } from '../../api/types';
import { summiereStaerke } from '../../anzeige/staerke';

/** Der Abschnitt selbst plus alle Nachfahren (Tiefensuche, zyklussicher). */
export function nachfahrenInkl(abschnitte: Einsatzabschnitt[], id: number): Set<number> {
  const kinder = new Map<number, number[]>();
  for (const a of abschnitte) {
    if (a.ueber_abschnitt_id != null) {
      if (!kinder.has(a.ueber_abschnitt_id)) kinder.set(a.ueber_abschnitt_id, []);
      kinder.get(a.ueber_abschnitt_id)!.push(a.id);
    }
  }
  const ergebnis = new Set<number>();
  const stack = [id];
  while (stack.length) {
    const n = stack.pop()!;
    if (ergebnis.has(n)) continue;
    ergebnis.add(n);
    for (const c of kinder.get(n) ?? []) stack.push(c);
  }
  return ergebnis;
}

export interface AbschnittStaerken {
  /** Nur direkt zugeordnete Einheiten — die Bedeutung der Bestandszeile „Stärke (F/UF/M//Σ)". */
  eigene: Staerke | null;
  /** Über `nachfahrenInkl` — der Wert, den der Einsatzleiter sonst im Kopf addieren muss (H37). */
  inklUnter: Staerke | null;
}

export function abschnittStaerken(
  abschnitte: Einsatzabschnitt[],
  einheiten: Einheit[],
  abschnittId: number,
): AbschnittStaerken {
  const menge = nachfahrenInkl(abschnitte, abschnittId);
  return {
    eigene: summiereStaerke(einheiten.filter((e) => e.abschnitt_id === abschnittId)),
    inklUnter: summiereStaerke(einheiten.filter((e) => e.abschnitt_id != null && menge.has(e.abschnitt_id))),
  };
}
```

In `EinsatzabschnittePage.tsx`: Zeilen 48–65 (`function nachfahrenInkl …`) löschen, dafür
`import { nachfahrenInkl } from './einsatzabschnitte/abschnittStaerke';` ergänzen.

- [ ] **Step 5: Run — grün, plus Seitentest unverändert grün**

Run: `mise exec pnpm@11.10.0 -- pnpm -C <ABS>/frontend exec vitest run src/anzeige src/pages/einsatzabschnitte src/pages/EinsatzabschnittePage.test.tsx`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/anzeige/staerke.ts frontend/src/anzeige/staerke.test.ts frontend/src/pages/einsatzabschnitte/ frontend/src/pages/EinsatzabschnittePage.tsx
git commit -m "feat(lfh-347): rechnet die Abschnitts-Stärke eigene und inkl. Unterabschnitte als reine Funktion

LFH-347 · H37. nachfahrenInkl lag ungenutzt in der Seite; jetzt trägt es die
kumulierte Stärke, und summiereStaerke ist die eine Summe für drei Konsumenten.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Av3wVEyh3w7pSvvem5yeur"
```

---

### Task 2: Zwei Stärken in der Abschnitts-Detailkarte (H37, Anzeige)

**Files:**
- Modify: `frontend/src/pages/EinsatzabschnittePage.tsx:156-168, 355`
- Test: `frontend/src/pages/EinsatzabschnittePage.test.tsx`

**Interfaces:**
- Consumes: `abschnittStaerken` aus Task 1.
- Produces: zwei `Descriptions.Item`-Labels, byte-genau: `Stärke (F/UF/M//Σ)` (eigene — Bestandslabel, Bedeutung unverändert) und `Stärke inkl. Unterabschnitte (F/UF/M//Σ)`.

- [ ] **Step 1: Failing Test**

Im `describe('EinsatzabschnittePage')` ergänzen (nach dem Test „weist Abschnitt, zugeordnete Einheiten …", Zeile ~116):

```tsx
  /**
   * AK1 (LFH-347 · H37). Zwei Zeilen, zwei Bedeutungen: die Bestandszeile „Stärke (F/UF/M//Σ)"
   * zählt weiter NUR die direkt zugeordneten Einheiten — sie wechselt nicht still die
   * Bedeutung —, die neue Zeile summiert über die Unterabschnitte. Beide Labels sind im DOM
   * verschieden, und die Zahlen belegen die Trennung: Süd hängt unter Nord und trägt 0/1/1.
   */
  it('zeigt die eigene Stärke und die inkl. Unterabschnitte getrennt beschriftet', async () => {
    server.use(...handlers('einsatzleitung', 'aktiv', [
      { id: 5, einsatz_id: 1, ueber_abschnitt_id: null, name: 'Nord', leiter_id: null, leiter_name: null, bemerkung: null, sortier: 0 },
      { id: 6, einsatz_id: 1, ueber_abschnitt_id: 5, name: 'Süd', leiter_id: null, leiter_name: null, bemerkung: null, sortier: 1 },
    ]));
    server.use(http.get('/api/einsaetze/1/einheiten', () => HttpResponse.json([
      { id: 1, einsatz_id: 1, name: 'Zug Nord', abschnitt_id: 5, ist: { fuehrer: 1, unterfuehrer: 2, mannschaft: 3 }, ist_kumuliert: { fuehrer: 1, unterfuehrer: 2, mannschaft: 3 }, sortier: 0, sprechgruppen: [], fahrzeug_mitglieder: [], personal_mitglieder: [], material_mitglieder: [] },
      { id: 2, einsatz_id: 1, name: 'Trupp Süd', abschnitt_id: 6, ist: { fuehrer: 0, unterfuehrer: 1, mannschaft: 1 }, ist_kumuliert: { fuehrer: 0, unterfuehrer: 1, mannschaft: 1 }, sortier: 1, sprechgruppen: [], fahrzeug_mitglieder: [], personal_mitglieder: [], material_mitglieder: [] },
    ])));
    renderPage();
    await userEvent.click(await screen.findByText('Nord'));

    const eigene = screen.getByText('Stärke (F/UF/M//Σ)').closest('tr')!;
    const inkl = screen.getByText('Stärke inkl. Unterabschnitte (F/UF/M//Σ)').closest('tr')!;
    expect(eigene).not.toBe(inkl);
    expect(within(eigene).getByText('1/2/3//6')).toBeInTheDocument();
    expect(within(inkl).getByText('1/3/4//8')).toBeInTheDocument();
  });
```

Hinweis: `Tree`-Titel tragen ab Task 3 selbst eine Stärke; `getByText('1/3/4//8')` ohne `within`
wäre dann mehrdeutig — deshalb die Zeilen-Einschränkung schon jetzt.

- [ ] **Step 2: Run — rot**

Run: `mise exec pnpm@11.10.0 -- pnpm -C <ABS>/frontend exec vitest run src/pages/EinsatzabschnittePage.test.tsx -t "getrennt beschriftet"`
Expected: FAIL — „Unable to find … Stärke inkl. Unterabschnitte".

- [ ] **Step 3: Seite umstellen**

Zeilen 156–168 ersetzen durch:

```tsx
  const zugeordneteEinheiten = (einheitenQuery.data ?? []).filter((e) => e.abschnitt_id === aktuell?.id);

  // ZWEI Werte, getrennt beschriftet (LFH-347 · H37): „eigene" ist die Bedeutung der
  // Bestandszeile und bleibt es; „inkl. Unterabschnitte" ist das, was der Einsatzleiter
  // im Fükw bisher im Kopf addieren musste.
  const staerken = aktuell
    ? abschnittStaerken(abschnitte, einheitenQuery.data ?? [], aktuell.id)
    : { eigene: null, inklUnter: null };
```

Import: `import { abschnittStaerken, nachfahrenInkl } from './einsatzabschnitte/abschnittStaerke';`
(den `nachfahrenInkl`-Import aus Task 1 zusammenführen). `Staerke`-Typimport aus Zeile 16
entfernen, wenn er danach ungenutzt ist.

Zeile 355 ersetzen durch:

```tsx
                <Descriptions.Item label="Stärke (F/UF/M//Σ)"><StaerkeAnzeige wert={staerken.eigene} /></Descriptions.Item>
                <Descriptions.Item label="Stärke inkl. Unterabschnitte (F/UF/M//Σ)"><StaerkeAnzeige wert={staerken.inklUnter} /></Descriptions.Item>
```

- [ ] **Step 4: Run — grün, ganze Datei grün**

Run: `mise exec pnpm@11.10.0 -- pnpm -C <ABS>/frontend exec vitest run src/pages/EinsatzabschnittePage.test.tsx`
Expected: PASS (alle bisherigen + neuer Test).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/EinsatzabschnittePage.tsx frontend/src/pages/EinsatzabschnittePage.test.tsx
git commit -m "feat(lfh-347): zeigt die Abschnitts-Stärke eigene und inkl. Unterabschnitte getrennt

LFH-347 · H37. Die Bestandszeile behält ihre Bedeutung (direkt zugeordnet), die
kumulierte steht als eigene Zeile darunter.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Av3wVEyh3w7pSvvem5yeur"
```

---

### Task 3: Gliederungsbaum mit Führungsinformation aus Tokens (M59) + `#888`-Gate

**Files:**
- Create: `frontend/src/pages/einsatzabschnitte/AbschnittKnoten.tsx`
- Create: `frontend/src/pages/einsatzabschnitte/AbschnittKnoten.test.tsx`
- Create: `frontend/src/pages/farbliteral.guard.test.ts`
- Modify: `frontend/src/pages/EinsatzabschnittePage.tsx:26-46, 152` (`baueBaum`)
- Modify: `frontend/src/pages/EinheitenPage.tsx:60-80`
- Test: `frontend/src/pages/EinsatzabschnittePage.test.tsx` (Test „zeigt den Abschnitts-Baum mit Leiter" bleibt — `getByText(/Leiter Nord/)` ankert auf Text, nicht auf dem Emoji)

**Interfaces:**
- Produces: `AbschnittKnoten({ abschnitt, staerke, anzahlEinheiten }: { abschnitt: Einsatzabschnitt; staerke: Staerke | null; anzahlEinheiten: number })`.
- Produces (EinheitenPage): `baueBaum(einheiten, einsatzId, sekundaerFarbe: string)`.

Festlegung **„Führungslage"**: der farbige Punkt sagt, ob die Führung des Abschnitts besetzt ist
(`leiter_id != null` → Rolle `normal`, sonst `achtung`). Zweiter Kanal: `aria-label`
„Führung besetzt" / „Führung unbesetzt" am Punkt (`role="img"`) **und** der Leitername als Text.
Farben ausschließlich über `rollenFarbe(rolle, token)` (`theme/statusFarben.ts`) — das ist
die Stelle, die im Dunkelmodus den Kontrast hält.

- [ ] **Step 1: Failing Test für den Knoten**

```tsx
// frontend/src/pages/einsatzabschnitte/AbschnittKnoten.test.tsx
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ConfigProvider, theme } from 'antd';
import type { Einsatzabschnitt } from '../../api/types';
import { rollenFarbe } from '../../theme/statusFarben';
import AbschnittKnoten from './AbschnittKnoten';

const nord = {
  id: 5, einsatz_id: 1, ueber_abschnitt_id: null, name: 'Nord', leiter_id: 3,
  leiter_name: 'Leiter Nord', bemerkung: null, sortier: 0, sprechgruppen: [],
  kommunikationsmittel: null, erreichbarkeit: '0151 1',
} as unknown as Einsatzabschnitt;

/** Liest die Tokens desselben Providers, in dem der Knoten steht — der Vergleich prüft den
 *  Token gegen die Anzeige, nicht ein Literal gegen ein Literal. */
function TokenSonde() {
  const { token } = theme.useToken();
  return (
    <span
      data-testid="sonde"
      data-sekundaer={token.colorTextSecondary}
      data-normal={rollenFarbe('normal', token)}
      data-achtung={rollenFarbe('achtung', token)}
    />
  );
}

function renderKnoten(abschnitt: Einsatzabschnitt, staerke = { fuehrer: 1, unterfuehrer: 3, mannschaft: 4 }, anzahl = 2) {
  render(
    <ConfigProvider>
      <TokenSonde />
      <AbschnittKnoten abschnitt={abschnitt} staerke={staerke} anzahlEinheiten={anzahl} />
    </ConfigProvider>,
  );
  return screen.getByTestId('sonde');
}

describe('AbschnittKnoten', () => {
  it('trägt Name, kumulierte Stärke und Einheitenzahl', () => {
    renderKnoten(nord);
    expect(screen.getByText('Nord')).toBeInTheDocument();
    expect(screen.getByText('1/3/4//8')).toBeInTheDocument();
    expect(screen.getByText('2 Einh.')).toBeInTheDocument();
  });

  it('färbt den Leitername aus dem Sekundär-Token, nicht aus einem Literal', () => {
    const sonde = renderKnoten(nord);
    const leiter = screen.getByText(/Leiter Nord/);
    expect(leiter.style.color).toBe(sonde.dataset.sekundaer);
    expect(leiter.style.color).not.toBe('#888');
  });

  it('zeigt die besetzte Führung als Punkt aus der Rolle „normal" — mit Wort als zweitem Kanal', () => {
    const sonde = renderKnoten(nord);
    const punkt = screen.getByRole('img', { name: 'Führung besetzt' });
    expect(punkt.style.backgroundColor).toBe(sonde.dataset.normal);
  });

  it('zeigt die unbesetzte Führung als Punkt aus der Rolle „achtung"', () => {
    const sonde = renderKnoten({ ...nord, leiter_id: null, leiter_name: null });
    const punkt = screen.getByRole('img', { name: 'Führung unbesetzt' });
    expect(punkt.style.backgroundColor).toBe(sonde.dataset.achtung);
  });

  it('versteckt die Ikonen vor dem Vorleser — die Gruppe heißt nach dem Namen, nicht nach „user"', () => {
    renderKnoten(nord);
    // Genau EIN role=img: der Führungspunkt. Die antd-Ikonen (user/phone) dürfen keinen eigenen liefern.
    expect(screen.getAllByRole('img')).toHaveLength(1);
  });
});
```

Hinweis zum Farbvergleich: jsdom normalisiert `style.color` bei Hex-Werten zu `rgb(...)`. Falls
`toBe` an der Schreibweise scheitert, beide Seiten über ein Hilfselement normalisieren:
`const el = document.createElement('i'); el.style.color = wert; return el.style.color;` — im
Test als `normalisiere(wert)` und beide Seiten damit vergleichen. Das ist eine Eigenheit des
Test-DOMs, keine Zusicherungslücke.

- [ ] **Step 2: Failing Guard**

```ts
// frontend/src/pages/farbliteral.guard.test.ts
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * AK3 (LFH-347 · C12): kein `#888` in `pages/`. Der Wert war die eine Stelle, an der eine
 * Seite ihre Sekundärfarbe selbst erfand statt sie vom Theme zu nehmen — und im Dunkelmodus
 * damit Kontrast verlor. Farbwerte kommen aus `theme.useToken()` / `theme/statusFarben.ts`.
 * Bewusst ein enger Grep (nur dieses Literal) — ein Gate gegen jedes Hex-Literal wäre rot
 * geboren (`flaechenFarbe` u. a. tragen begründete Werte) und würde abgeschaltet statt befolgt.
 */
function dateien(verz: string): string[] {
  return readdirSync(verz).flatMap((n) => {
    const p = join(verz, n);
    if (statSync(p).isDirectory()) return dateien(p);
    return /\.(tsx?|css)$/.test(n) ? [p] : [];
  });
}

describe('Farbliteral-Gate', () => {
  it('kennt kein #888 in pages/', () => {
    const treffer = dateien(join(__dirname))
      .filter((p) => !p.endsWith('farbliteral.guard.test.ts'))
      .filter((p) => readFileSync(p, 'utf8').includes('#888'));
    expect(treffer).toEqual([]);
  });
});
```

- [ ] **Step 3: Run — beide rot**

Run: `mise exec pnpm@11.10.0 -- pnpm -C <ABS>/frontend exec vitest run src/pages/einsatzabschnitte/AbschnittKnoten.test.tsx src/pages/farbliteral.guard.test.ts`
Expected: FAIL — Import nicht auflösbar; Guard listet `EinsatzabschnittePage.tsx` und `EinheitenPage.tsx`.

- [ ] **Step 4: Knoten bauen**

```tsx
// frontend/src/pages/einsatzabschnitte/AbschnittKnoten.tsx
import { Space, Tag, theme } from 'antd';
import { PhoneOutlined, UserOutlined } from '@ant-design/icons';
import type { Einsatzabschnitt, Staerke } from '../../api/types';
import StaerkeAnzeige from '../../anzeige/StaerkeAnzeige';
import { rollenFarbe } from '../../theme/statusFarben';

interface Props {
  abschnitt: Einsatzabschnitt;
  /** Kumuliert über die Unterabschnitte (`abschnittStaerken(...).inklUnter`). */
  staerke: Staerke | null;
  /** Direkt zugeordnete Einheiten. */
  anzahlEinheiten: number;
}

/**
 * Ein Knoten des Gliederungsbaums als Übersicht (LFH-347 · M59): Name · Stärke inkl.
 * Unterabschnitte · Einheitenzahl · Führungspunkt · Leiter · Funk. Vorher trug er nur
 * Name, Personen-Emoji und Telefonzeichen in `#888` — 6–8 Klicks für eine Frage, die ein
 * Blick beantworten muss.
 *
 * **Farben nur aus Tokens.** `colorTextSecondary` für Beiwerk, `rollenFarbe` für den Punkt:
 * beide halten im Dunkelmodus den Kontrast, ein Literal tat es nicht.
 *
 * **Der Punkt ist Statusfarbe als Punkt, nie als Textfläche**, und er trägt sein Wort im
 * `aria-label` (WCAG 1.4.1) — die Farbe allein sagte einem Vorleser und einem
 * Farbfehlsichtigen nichts. „Führungslage" heißt hier: ist ein Abschnittsleiter gesetzt.
 *
 * **Ikonen in `aria-hidden`-Hülle:** antds Icons bringen `role="img"` mit englischem
 * Namen („user", „phone") mit und stünden sonst in jeder Zeile als eigenes Vorleseziel.
 */
export default function AbschnittKnoten({ abschnitt, staerke, anzahlEinheiten }: Props) {
  const { token } = theme.useToken();
  const besetzt = abschnitt.leiter_id != null;
  return (
    <Space size={token.marginXXS} wrap>
      <span
        role="img"
        aria-label={besetzt ? 'Führung besetzt' : 'Führung unbesetzt'}
        style={{
          display: 'inline-block',
          width: token.fontSizeSM,
          height: token.fontSizeSM,
          borderRadius: '50%',
          backgroundColor: rollenFarbe(besetzt ? 'normal' : 'achtung', token),
        }}
      />
      <span>{abschnitt.name}</span>
      <Tag color="blue"><StaerkeAnzeige wert={staerke} /></Tag>
      <span style={{ color: token.colorTextSecondary }}>{anzahlEinheiten} Einh.</span>
      {abschnitt.leiter_name && (
        <span style={{ color: token.colorTextSecondary }}>
          <span aria-hidden="true"><UserOutlined /></span> {abschnitt.leiter_name}
        </span>
      )}
      {abschnitt.erreichbarkeit && (
        <span aria-hidden="true" style={{ color: token.colorTextSecondary }}><PhoneOutlined /></span>
      )}
    </Space>
  );
}
```

- [ ] **Step 5: `baueBaum` in `EinsatzabschnittePage.tsx` umstellen**

Zeilen 26–46 ersetzen durch:

```tsx
function baueBaum(abschnitte: Einsatzabschnitt[], einheiten: Einheit[]): TreeDataNode[] {
  const kinder = new Map<number | null, Einsatzabschnitt[]>();
  for (const a of abschnitte) {
    const key = a.ueber_abschnitt_id ?? null;
    if (!kinder.has(key)) kinder.set(key, []);
    kinder.get(key)!.push(a);
  }
  const baue = (parent: number | null): TreeDataNode[] =>
    (kinder.get(parent) ?? []).map((a) => ({
      key: a.id,
      title: (
        <AbschnittKnoten
          abschnitt={a}
          staerke={abschnittStaerken(abschnitte, einheiten, a.id).inklUnter}
          anzahlEinheiten={einheiten.filter((e) => e.abschnitt_id === a.id).length}
        />
      ),
      children: baue(a.id),
    }));
  return baue(null);
}
```

Imports: `import type { Einheit, Einsatzabschnitt } from '../api/types';` (Zeile 16 anpassen),
`import AbschnittKnoten from './einsatzabschnitte/AbschnittKnoten';`. `Space`/`Tag` bleiben
importiert (werden unten in der Seite weiter genutzt).

Zeile 152 ersetzen: `const baumDaten = useMemo(() => baueBaum(abschnitte, einheitenQuery.data ?? []), [abschnitte, einheitenQuery.data]);`

- [ ] **Step 6: `EinheitenPage.tsx` — `#888` durch Token**

`baueBaum` dort bekommt einen dritten Parameter. Signatur (Zeile ~55) ändern zu
`function baueBaum(einheiten: Einheit[], einsatzId: number, sekundaerFarbe: string): TreeDataNode[]`
(die tatsächliche Parameterliste vorher mit `sed -n 50,60p frontend/src/pages/EinheitenPage.tsx`
prüfen und den neuen Parameter **anhängen**). Zeile 71: `style={{ color: sekundaerFarbe }}`.
Im Aufrufer: `const { token } = theme.useToken();` (Import `theme` aus `antd`) und
`baueBaum(…, token.colorTextSecondary)` — den `useMemo` um `token.colorTextSecondary` in den
Deps ergänzen.

- [ ] **Step 7: Run — alles grün**

Run: `mise exec pnpm@11.10.0 -- pnpm -C <ABS>/frontend exec vitest run src/pages/einsatzabschnitte src/pages/farbliteral.guard.test.ts src/pages/EinsatzabschnittePage.test.tsx src/pages/EinheitenPage.test.tsx`
Expected: PASS. Sollte ein Bestandstest in `EinheitenPage.test.tsx` per `getByText` auf
Stärke-Zahlen mehrdeutig werden: mit `within(...)` einschränken, nicht den Knoten ändern.

- [ ] **Step 8: Commit**

```bash
git add frontend/src/pages/einsatzabschnitte/ frontend/src/pages/farbliteral.guard.test.ts frontend/src/pages/EinsatzabschnittePage.tsx frontend/src/pages/EinheitenPage.tsx frontend/src/pages/EinsatzabschnittePage.test.tsx frontend/src/pages/EinheitenPage.test.tsx
git commit -m "feat(lfh-347): gibt dem Gliederungsbaum Stärke, Einheitenzahl und Führungspunkt aus Tokens

LFH-347 · M59. Kein #888 mehr in pages/ (Guard), Ikonen statt Emoji, Punkt mit
Wort als zweitem Kanal.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Av3wVEyh3w7pSvvem5yeur"
```

---

### Task 4: „Abschnitt anlegen" als lokaler Entwurf (M55)

**Files:**
- Modify: `frontend/src/pages/EinsatzabschnittePage.tsx` (State, Mutationen, Baum, Detailkarte)
- Test: `frontend/src/pages/EinsatzabschnittePage.test.tsx` (Test „bietet im leeren Baum genau eine Primäraktion, und die legt einen Abschnitt an", Zeile ~303, anpassen; neue Tests)

**Interfaces:**
- Produces: Baumknoten mit `key: 'entwurf'` und Titel `Neuer Abschnitt (ungespeichert)`, Detailkarten-Titel `Neuer Abschnitt`, `Input` Name mit `autoFocus`.

Entwurf ist ein **eigener State** (`entwurf: boolean`), kein Fake-Datensatz in der Query: ein
Objekt mit `id: -1` in `abschnitte` liefe durch `nachfahrenInkl`, `parentOptionen`, die
Stärke-Rechnung und den Deeplink-Abgleich — jede dieser Stellen müsste den Fall kennen.

- [ ] **Step 1: Bestandstest umschreiben und neue Tests schreiben**

Den Test ab Zeile ~303 lesen (`sed -n 300,330p`). Er klickt heute die Leerzustands-Aktion und
erwartet vermutlich einen POST. Ihn so ändern, dass er nach dem Klick den Entwurf erwartet und
erst nach „Speichern" den POST. Zusätzlich:

```tsx
  /**
   * M55 (LFH-347 · C12). Vorher schrieb der Klick sofort `POST …/abschnitte` mit dem Namen
   * „Neuer Abschnitt" — samt ETB-Eintrag —, und Abbrechen ließ den Datensatz stehen.
   * Jetzt entsteht er erst beim Speichern; Abbrechen hinterlässt nichts, auch keine
   * Invalidierung des Tagebuchs.
   */
  it('legt beim Öffnen und Abbrechen des Entwurfs nichts an — 0 POST, 0 ETB-Invalidierung', async () => {
    let posts = 0;
    server.use(...handlers(), http.post('/api/einsaetze/1/abschnitte', () => { posts += 1; return HttpResponse.json({}); }));
    const { client } = renderPage();
    const invalidieren = vi.spyOn(client, 'invalidateQueries');
    await userEvent.click(await screen.findByRole('button', { name: 'Abschnitt anlegen' }));

    expect(screen.getByText('Neuer Abschnitt (ungespeichert)')).toBeInTheDocument();
    expect(screen.getByLabelText('Name')).toHaveFocus();
    await userEvent.click(screen.getByRole('button', { name: 'Abbrechen' }));

    expect(screen.queryByText('Neuer Abschnitt (ungespeichert)')).not.toBeInTheDocument();
    expect(posts).toBe(0);
    expect(invalidieren.mock.calls.some(([arg]) => JSON.stringify(arg?.queryKey) === JSON.stringify(einsatzKeys.etb(1)))).toBe(false);
  });

  it('schreibt den Abschnitt erst beim Speichern und wählt ihn dann aus', async () => {
    const bodies: unknown[] = [];
    server.use(...handlers(), http.post('/api/einsaetze/1/abschnitte', async ({ request }) => {
      bodies.push(await request.json());
      return HttpResponse.json({ id: 9, einsatz_id: 1, ueber_abschnitt_id: null, name: 'Ost', leiter_id: null, leiter_name: null, bemerkung: null, sortier: 1, sprechgruppen: [] });
    }));
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: 'Abschnitt anlegen' }));
    await userEvent.type(screen.getByLabelText('Name'), 'Ost');
    await userEvent.click(screen.getByRole('button', { name: 'Speichern' }));

    await waitFor(() => expect(bodies).toHaveLength(1));
    expect(bodies[0]).toMatchObject({ name: 'Ost' });
    expect(screen.queryByText('Neuer Abschnitt (ungespeichert)')).not.toBeInTheDocument();
  });

  it('verwirft den Entwurf, wenn im Baum ein bestehender Abschnitt gewählt wird', async () => {
    server.use(...handlers());
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: 'Abschnitt anlegen' }));
    await userEvent.click(screen.getByText('Nord'));
    expect(screen.queryByText('Neuer Abschnitt (ungespeichert)')).not.toBeInTheDocument();
    expect(screen.getByText('Abschnitt: Nord')).toBeInTheDocument();
  });
```

`vi` in den Vitest-Import aufnehmen. `getByLabelText('Name')` setzt voraus, dass es im DOM nur
ein Feld mit diesem Label gibt — im Entwurfsmodus ist das so (die Lese-Ansicht rendert keins).

- [ ] **Step 2: Run — rot**

Run: `mise exec pnpm@11.10.0 -- pnpm -C <ABS>/frontend exec vitest run src/pages/EinsatzabschnittePage.test.tsx -t "Entwurf"`
Expected: FAIL — „Neuer Abschnitt (ungespeichert)" nicht gefunden.

- [ ] **Step 3: Seite umbauen**

State (nach Zeile 84): `const [entwurf, setEntwurf] = useState(false);`

Mutation `anlegen` (Zeilen 125–129) **löschen**. Speichern-Mutation (Zeile 120) ändern:
`return aktuell && !entwurf ? aktualisiereAbschnitt(einsatzId, aktuell.id, daten) : legeAbschnittAn(einsatzId, daten);`
und `onSuccess`: `{ invalidate(); setEntwurf(false); setGewaehlt(a.id); setBearbeiten(false); message.success('Gespeichert'); }`.

Vorbelegen-Effekt (Zeile 141): Bedingung `if (aktuell && bearbeiten && !entwurf)`, Deps um `entwurf` ergänzen.

Entwurf öffnen — eine Funktion, von Kopfknopf und Leerzustand gemeinsam gerufen:

```tsx
  /** Lokaler Entwurf statt Server-Datensatz (LFH-347 · M55): der POST — und damit der
   *  ETB-Eintrag — entsteht erst beim Speichern. Abbrechen hinterlässt nichts. */
  function entwurfOeffnen() {
    setGewaehlt(null);
    setBearbeiten(false);
    form.resetFields();
    setEntwurf(true);
  }
```

Kopfknopf (Zeile 247): `onClick={entwurfOeffnen}`. Leerzustand (Zeile 291): `onClick: entwurfOeffnen`.

Baum: `const baumDaten = useMemo(() => { const knoten = baueBaum(abschnitte, einheitenQuery.data ?? []); return entwurf ? [...knoten, { key: 'entwurf', title: <i>Neuer Abschnitt (ungespeichert)</i>, selectable: false }] : knoten; }, [abschnitte, einheitenQuery.data, entwurf]);`
`Tree`: `selectedKeys={entwurf ? ['entwurf'] : gewaehlt != null ? [gewaehlt] : []}` und
`onSelect={(keys) => { setEntwurf(false); setGewaehlt(keys.length ? Number(keys[0]) : null); }}`.
Der Leerzustand-Zweig (`abschnitte.length === 0`) muss bei offenem Entwurf den Baum zeigen:
Bedingung auf `abschnitte.length === 0 && !entwurf` ändern.

Detailkarte: `title={entwurf ? 'Neuer Abschnitt' : aktuell ? \`Abschnitt: ${aktuell.name}\` : 'Kein Abschnitt gewählt'}`,
Zweigbedingung `!aktuell && !entwurf ? <SeitenLeer …/> : (entwurf || bearbeiten) ? <Form …> : (…)`.
Im Formular: `<Input autoFocus />` beim Namen; Abbrechen: `onClick={() => { setEntwurf(false); setBearbeiten(false); }}`;
das `Popconfirm`/„Auflösen" im Formular nur `{!entwurf && aktuell && (…)}` rendern.
`AbschnittEingabe`-Typ für `legeAbschnittAn` prüfen (`rg "export function legeAbschnittAn" src/api/einsatzabschnitte.ts`) — er nimmt bereits `AbschnittEingabe`, das Speichern schickt alle Felder.

- [ ] **Step 4: Run — ganze Datei grün**

Run: `mise exec pnpm@11.10.0 -- pnpm -C <ABS>/frontend exec vitest run src/pages/EinsatzabschnittePage.test.tsx`
Expected: PASS. Falls „bietet im leeren Baum genau eine Primäraktion" noch einen POST erwartet: auf den Entwurf umschreiben (Step 1).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/EinsatzabschnittePage.tsx frontend/src/pages/EinsatzabschnittePage.test.tsx
git commit -m "feat(lfh-347): legt einen Abschnitt erst beim Speichern an statt beim Klick

LFH-347 · M55. Lokaler Entwurf im Baum mit Fokus im Namen; Abbrechen hinterlässt
weder Datensatz noch ETB-Eintrag.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Av3wVEyh3w7pSvvem5yeur"
```

---

### Task 5: Generische Direkteinstiegs-Bausteine, UHS als erster Konsument (M56a)

**Files:**
- Create: `frontend/src/components/direkteinstieg.ts`
- Create: `frontend/src/components/direkteinstieg.test.ts`
- Create: `frontend/src/components/Direkteinstieg.tsx`
- Create: `frontend/src/components/EinstiegSwitcher.tsx`
- Modify: `frontend/src/pages/uhs/uhsAuswahl.ts` (delegiert)
- Modify: `frontend/src/pages/UnfallhilfsstellenDefault.tsx` (dünn)
- Modify: `frontend/src/pages/uhs/UhsSwitcher.tsx` (dünn)
- Tests (bestehen, müssen grün bleiben): `pages/uhs/uhsAuswahl.test.ts`, `pages/UnfallhilfsstellenDefault.test.tsx`, `pages/uhs/UhsSwitcher.test.tsx`, `pages/UnfallhilfsstellenPage.test.tsx`

**Interfaces:**
- Produces: `waehleDefaultEintrag<T extends { id: number }>(liste: T[], letzteId: number | null, istAktiv: (t: T) => boolean): number | null`.
- Produces: `letzteAuswahlSpeicher(praefix: string): { merke(einsatzId: number, id: number): void; lies(einsatzId: number): number | null }` — Schlüssel `${praefix}:letzteAuswahl:${einsatzId}` (für `praefix = 'uhs'` byte-gleich zum Bestand, gespeicherte Auswahlen überleben).
- Produces: `Direkteinstieg<T>` Props: `{ query: UseQueryResult<T[]>; waehle: (liste: T[]) => number | null; detailPfad: (id: number) => string; fehlerText: string; leerTitel: string; leerAktionLabel: string; anlegen: (a: { open: boolean; onClose: () => void; onAngelegt: (eintrag: T) => void }) => ReactNode }`.
- Produces: `EinstiegSwitcher` Props: `{ aktuell: { id: number; bezeichnung: string }; eintraege: Array<{ id: number; bezeichnung: string; darstellung: StatusDarstellung; rang: number }>; onWechsel: (id: number) => void; neuLabel: string; onNeu: () => void }` — sortiert nach `rang`, dann `bezeichnung` (`localeCompare`, `'de'`).

- [ ] **Step 1: Failing Test für den Rechenkern**

```ts
// frontend/src/components/direkteinstieg.test.ts
import { beforeEach, describe, expect, it } from 'vitest';
import { letzteAuswahlSpeicher, waehleDefaultEintrag } from './direkteinstieg';

type E = { id: number; status: 'aktiv' | 'geplant' };
const aktiv = (e: E) => e.status === 'aktiv';

describe('waehleDefaultEintrag', () => {
  it('liefert null bei leerer Liste', () => {
    expect(waehleDefaultEintrag<E>([], null, aktiv)).toBeNull();
  });
  it('bevorzugt die gemerkte Auswahl, auch vor einer aktiven', () => {
    expect(waehleDefaultEintrag<E>([{ id: 1, status: 'aktiv' }, { id: 2, status: 'geplant' }], 2, aktiv)).toBe(2);
  });
  it('ignoriert eine gemerkte Auswahl, die nicht mehr in der Liste ist', () => {
    expect(waehleDefaultEintrag<E>([{ id: 3, status: 'aktiv' }, { id: 1, status: 'aktiv' }], 99, aktiv)).toBe(1);
  });
  it('wählt sonst den ältesten aktiven (kleinste id)', () => {
    expect(waehleDefaultEintrag<E>([{ id: 5, status: 'aktiv' }, { id: 2, status: 'aktiv' }, { id: 8, status: 'geplant' }], null, aktiv)).toBe(2);
  });
  it('wählt den zuletzt angelegten (größte id), wenn keiner aktiv ist', () => {
    expect(waehleDefaultEintrag<E>([{ id: 2, status: 'geplant' }, { id: 7, status: 'geplant' }], null, aktiv)).toBe(7);
  });
});

describe('letzteAuswahlSpeicher', () => {
  beforeEach(() => localStorage.clear());
  it('trennt Präfixe und Einsätze', () => {
    const uhs = letzteAuswahlSpeicher('uhs');
    const br = letzteAuswahlSpeicher('br');
    uhs.merke(1, 42); br.merke(1, 7);
    expect(uhs.lies(1)).toBe(42);
    expect(br.lies(1)).toBe(7);
    expect(uhs.lies(2)).toBeNull();
  });
  it('schreibt den Bestandsschlüssel der UHS byte-gleich — gespeicherte Auswahlen überleben', () => {
    letzteAuswahlSpeicher('uhs').merke(3, 5);
    expect(localStorage.getItem('uhs:letzteAuswahl:3')).toBe('5');
  });
});
```

- [ ] **Step 2: Run — rot**

Run: `mise exec pnpm@11.10.0 -- pnpm -C <ABS>/frontend exec vitest run src/components/direkteinstieg.test.ts`
Expected: FAIL — Import nicht auflösbar.

- [ ] **Step 3: Rechenkern + UHS-Delegation**

```ts
// frontend/src/components/direkteinstieg.ts
/**
 * Direkteinstieg in „den richtigen" Datensatz eines Moduls (LFH-347 · M56).
 *
 * Verallgemeinert aus `pages/uhs/uhsAuswahl.ts`: dieselbe Aufgabenklasse — mehrere Orte
 * (UHS, BR), einer ist gerade der wichtige — hatte zwei Einstiegsmuster: UHS sprang direkt
 * hinein, BR zeigte eine Tabelle. Priorität: (1) gemerkte Auswahl, falls noch in der Liste,
 * (2) ältester aktiver (kleinste id — Anlage-Reihenfolge ist die id, unabhängig von
 * `erfasst_at`), (3) zuletzt angelegter. `null` bei leerer Liste.
 */
export function waehleDefaultEintrag<T extends { id: number }>(
  liste: T[],
  letzteId: number | null,
  istAktiv: (eintrag: T) => boolean,
): number | null {
  if (liste.length === 0) return null;
  if (letzteId != null && liste.some((e) => e.id === letzteId)) return letzteId;
  const aktive = liste.filter(istAktiv);
  if (aktive.length > 0) return Math.min(...aktive.map((e) => e.id));
  return Math.max(...liste.map((e) => e.id));
}

/** Merkt die zuletzt geöffnete Auswahl je Einsatz (überlebt Reload); ohne localStorage stumm. */
export function letzteAuswahlSpeicher(praefix: string) {
  const schluessel = (einsatzId: number) => `${praefix}:letzteAuswahl:${einsatzId}`;
  return {
    merke(einsatzId: number, id: number): void {
      try { localStorage.setItem(schluessel(einsatzId), String(id)); } catch { /* ohne Persistenz weiter */ }
    },
    lies(einsatzId: number): number | null {
      try {
        const wert = localStorage.getItem(schluessel(einsatzId));
        return wert ? Number(wert) : null;
      } catch { return null; }
    },
  };
}
```

`pages/uhs/uhsAuswahl.ts` vollständig ersetzen (öffentliche Signaturen bleiben):

```ts
import type { Uhs } from '../../api/types';
import { letzteAuswahlSpeicher, waehleDefaultEintrag } from '../../components/direkteinstieg';

const speicher = letzteAuswahlSpeicher('uhs');

/** UHS-Belegung des generischen Direkteinstiegs (`components/direkteinstieg.ts`). */
export function waehleDefaultUhs(liste: Uhs[], letzteId: number | null): number | null {
  return waehleDefaultEintrag(liste, letzteId, (u) => u.status === 'aktiv');
}
export const merkeLetzteUhs = speicher.merke;
export const liesLetzteUhs = speicher.lies;
```

- [ ] **Step 4: Run — Rechenkern und UHS-Tests grün**

Run: `mise exec pnpm@11.10.0 -- pnpm -C <ABS>/frontend exec vitest run src/components/direkteinstieg.test.ts src/pages/uhs/uhsAuswahl.test.ts`
Expected: PASS.

- [ ] **Step 5: Generische Index-Route**

```tsx
// frontend/src/components/Direkteinstieg.tsx
import { Navigate, useNavigate } from 'react-router';
import { useRef, useState, type ReactNode } from 'react';
import type { UseQueryResult } from '@tanstack/react-query';
import { SeitenFehler, SeitenLeer, SeitenSkeleton } from './SeitenZustand';

interface AnlegenSlot<T> {
  open: boolean;
  onClose: () => void;
  onAngelegt: (eintrag: T) => void;
}

export interface DirekteinstiegProps<T extends { id: number }> {
  query: UseQueryResult<T[]>;
  /** Trifft die Wahl aus der ersten geladenen Liste — meist `waehleDefaultEintrag` mit gemerkter id. */
  waehle: (liste: T[]) => number | null;
  /** Aus `routing/deeplinks.ts`; das Primitiv kennt keine Einsatz-Routen. */
  detailPfad: (id: number) => string;
  fehlerText: string;
  leerTitel: string;
  leerAktionLabel: string;
  /** Der Anlegen-Drawer des Moduls; er läuft über lokalen Zustand, nicht über eine Route. */
  anlegen: (slot: AnlegenSlot<T>) => ReactNode;
}

/**
 * Index-Route eines Orts-Moduls: springt in den passenden Datensatz oder zeigt bei leerer
 * Menge einen Leerzustand mit Anlegen-Aktion (LFH-347 · M56, aus `UnfallhilfsstellenDefault`).
 *
 * **Bewusst kein Live-Resync der Auswahl:** die Entscheidung fällt einmal aus dem ersten
 * geladenen Stand (`entscheidung`-Ref). Eine live angelegte UHS/ein BR reißt die Ansicht so
 * nicht weg — wer gerade im Leerzustand steht und anlegt, wird über `onAngelegt` geführt.
 */
export default function Direkteinstieg<T extends { id: number }>({
  query, waehle, detailPfad, fehlerText, leerTitel, leerAktionLabel, anlegen,
}: DirekteinstiegProps<T>) {
  const navigate = useNavigate();
  const entscheidung = useRef<{ id: number | null } | null>(null);
  if (!entscheidung.current && query.data) entscheidung.current = { id: waehle(query.data) };
  const [offen, setOffen] = useState(false);

  if (!entscheidung.current) {
    if (query.error) {
      return <SeitenFehler text={fehlerText} ursache={query.error} onWiederholen={() => void query.refetch()} />;
    }
    return <SeitenSkeleton />;
  }
  const { id } = entscheidung.current;
  if (id != null) return <Navigate to={detailPfad(id)} replace />;

  return (
    <div style={{ padding: 16 }}>
      <SeitenLeer titel={leerTitel} aktion={{ label: leerAktionLabel, onClick: () => setOffen(true) }} />
      {anlegen({ open: offen, onClose: () => setOffen(false), onAngelegt: (e) => navigate(detailPfad(e.id)) })}
    </div>
  );
}
```

`pages/UnfallhilfsstellenDefault.tsx` vollständig ersetzen:

```tsx
import { useParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { listeUhs } from '../api/einsatzUhs';
import { einsatzKeys } from '../api/queryKeys';
import { uhsDetailPfad } from '../routing/deeplinks';
import Direkteinstieg from '../components/Direkteinstieg';
import UhsAnlegenDrawer from './uhs/UhsAnlegenDrawer';
import { liesLetzteUhs, waehleDefaultUhs } from './uhs/uhsAuswahl';

/** Index-Route /einsaetze/:id/unfallhilfsstellen — UHS-Belegung von `Direkteinstieg`. */
export default function UnfallhilfsstellenDefault() {
  const { id } = useParams();
  const einsatzId = Number(id);
  const uhsQuery = useQuery({ queryKey: einsatzKeys.uhs(einsatzId), queryFn: () => listeUhs(einsatzId) });
  return (
    <Direkteinstieg
      query={uhsQuery}
      waehle={(liste) => waehleDefaultUhs(liste, liesLetzteUhs(einsatzId))}
      detailPfad={(uhsId) => uhsDetailPfad(einsatzId, uhsId)}
      fehlerText="Unfallhilfsstellen konnten nicht geladen werden"
      leerTitel="Noch keine Unfallhilfsstellen erfasst"
      leerAktionLabel="Erste UHS anlegen"
      anlegen={(slot) => <UhsAnlegenDrawer einsatzId={einsatzId} {...slot} />}
    />
  );
}
```

- [ ] **Step 6: Generischer Switcher**

```tsx
// frontend/src/components/EinstiegSwitcher.tsx
import { Button, Dropdown, Space, Typography, type MenuProps } from 'antd';
import { DownOutlined } from '@ant-design/icons';
import StatusTag from './StatusTag';
import type { StatusDarstellung } from '../theme/statusFarben';

export interface SwitcherEintrag {
  id: number;
  bezeichnung: string;
  darstellung: StatusDarstellung;
  /** Sortierrang — fachliche Reihenfolge des Moduls (aktiv zuerst …), bleibt beim Aufrufer. */
  rang: number;
}

interface Props {
  aktuell: { id: number; bezeichnung: string };
  eintraege: SwitcherEintrag[];
  onWechsel: (id: number) => void;
  neuLabel: string;
  onNeu: () => void;
}

/** Kopf-Switcher eines Orts-Moduls: aktueller Datensatz + Wechsel + Neuanlage
 *  (LFH-347 · M56, aus `pages/uhs/UhsSwitcher.tsx`). */
export default function EinstiegSwitcher({ aktuell, eintraege, onWechsel, neuLabel, onNeu }: Props) {
  const sortiert = [...eintraege].sort((a, b) => a.rang - b.rang || a.bezeichnung.localeCompare(b.bezeichnung, 'de'));
  const items: MenuProps['items'] = [
    ...sortiert.map((e) => ({
      key: `eintrag-${e.id}`,
      label: <Space>{e.bezeichnung}<StatusTag darstellung={e.darstellung} /></Space>,
    })),
    { type: 'divider' as const },
    { key: 'neu', label: neuLabel },
  ];
  const onClick: MenuProps['onClick'] = ({ key }) => {
    if (key === 'neu') onNeu();
    else if (key.startsWith('eintrag-')) onWechsel(Number(key.slice('eintrag-'.length)));
  };
  return (
    <Dropdown menu={{ items, onClick }} trigger={['click']}>
      <Button type="text" style={{ padding: 0, height: 'auto' }}>
        <Typography.Text strong style={{ fontSize: 20 }}>
          {aktuell.bezeichnung} <DownOutlined style={{ fontSize: 14 }} />
        </Typography.Text>
      </Button>
    </Dropdown>
  );
}
```

`pages/uhs/UhsSwitcher.tsx` ersetzen (`STATUS_RANG` bleibt lokal — der Kommentar dort begründet es):

```tsx
import { useNavigate } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { uhsDetailPfad } from '../../routing/deeplinks';
import { listeUhs } from '../../api/einsatzUhs';
import { einsatzKeys } from '../../api/queryKeys';
import UhsAnlegenDrawer from './UhsAnlegenDrawer';
import type { Uhs, UhsStatus } from '../../api/types';
import { uhsStatus } from '../../theme/statusFarben';
import EinstiegSwitcher from '../../components/EinstiegSwitcher';

/** Sortierrang — fachliche Reihenfolge dieser Liste, keine Darstellung (bleibt lokal, s. Bestand). */
const STATUS_RANG: Record<UhsStatus, number> = { aktiv: 0, geplant: 1, aufgeloest: 2 };

/** Header-Switcher im UHS-Detail — UHS-Belegung von `EinstiegSwitcher`. */
export default function UhsSwitcher({ einsatzId, aktuelleUhs }: { einsatzId: number; aktuelleUhs: Uhs }) {
  const navigate = useNavigate();
  const [anlegen, setAnlegen] = useState(false);
  const { data: liste = [] } = useQuery({ queryKey: einsatzKeys.uhs(einsatzId), queryFn: () => listeUhs(einsatzId) });
  return (
    <>
      <EinstiegSwitcher
        aktuell={aktuelleUhs}
        eintraege={liste.map((u) => ({ id: u.id, bezeichnung: u.bezeichnung, darstellung: uhsStatus[u.status], rang: STATUS_RANG[u.status] }))}
        onWechsel={(uhsId) => navigate(uhsDetailPfad(einsatzId, uhsId))}
        neuLabel="+ Neue UHS"
        onNeu={() => setAnlegen(true)}
      />
      <UhsAnlegenDrawer einsatzId={einsatzId} open={anlegen} onClose={() => setAnlegen(false)} onAngelegt={(uhs) => navigate(uhsDetailPfad(einsatzId, uhs.id))} />
    </>
  );
}
```

`StatusDarstellung`-Export prüfen: `rg "export (type|interface) StatusDarstellung" src/theme/statusFarben.ts`.

- [ ] **Step 7: Run — alle UHS-Bestandstests grün**

Run: `mise exec pnpm@11.10.0 -- pnpm -C <ABS>/frontend exec vitest run src/pages/UnfallhilfsstellenDefault.test.tsx src/pages/uhs src/pages/UnfallhilfsstellenPage.test.tsx src/components/direkteinstieg.test.ts`
Expected: PASS ohne Änderung an den Bestandstests — das ist der Beleg, dass die Verallgemeinerung verhaltensgleich ist.

- [ ] **Step 8: Commit**

```bash
git add frontend/src/components/direkteinstieg.ts frontend/src/components/direkteinstieg.test.ts frontend/src/components/Direkteinstieg.tsx frontend/src/components/EinstiegSwitcher.tsx frontend/src/pages/uhs/uhsAuswahl.ts frontend/src/pages/UnfallhilfsstellenDefault.tsx frontend/src/pages/uhs/UhsSwitcher.tsx
git commit -m "refactor(lfh-347): zieht Direkteinstieg und Kopf-Switcher der UHS als generische Bausteine

LFH-347 · M56. Verhaltensgleich — die UHS-Bestandstests laufen unverändert.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Av3wVEyh3w7pSvvem5yeur"
```

---

### Task 6: Bereitstellungsraum-Direkteinstieg, Switcher, Listenroute (M56b + H41-Rest)

**Files:**
- Create: `frontend/src/pages/bereitstellungsraum/BrAnlegenDrawer.tsx`
- Create: `frontend/src/pages/bereitstellungsraum/brAuswahl.ts` + `brAuswahl.test.ts`
- Create: `frontend/src/pages/bereitstellungsraum/BereitstellungsraeumeDefault.tsx` + `.test.tsx`
- Create: `frontend/src/pages/bereitstellungsraum/BrSwitcher.tsx`
- Modify: `frontend/src/routing/deeplinks.ts:112` (+ `bereitstellungsraeumeListePfad`), `routing/deeplinks.test.ts`
- Modify: `frontend/src/App.tsx:93, 227`
- Modify: `frontend/src/pages/bereitstellungsraum/BereitstellungsraeumePage.tsx` (Drawer raus, Leerzustand)
- Modify: `frontend/src/pages/bereitstellungsraum/BrDetailPage.tsx:29, 120-125` (+ `merkeLetztenBr`)
- Tests: `BereitstellungsraeumePage.test.tsx`, `BrDetailPage.test.tsx`, `e2e/deeplinks-smoke.spec.ts` (prüfen, ob `bereitstellungsraeume` dort angesprungen wird)

**Interfaces:**
- Produces: `bereitstellungsraeumeListePfad(einsatzId): string` = `/einsaetze/${id}/bereitstellungsraeume/liste`. `bereitstellungsraeumePfad` bleibt (Modul-Index = Direkteinstieg).
- Produces: `waehleDefaultBr(liste: Bereitstellungsraum[], letzteId)`, `merkeLetztenBr`, `liesLetztenBr` (Präfix `'br'`, aktiv = `status === 'aktiv' && !storniert_at`).
- Produces: `BrAnlegenDrawer({ einsatzId, open, onClose, onAngelegt? })` — Form-Felder byte-gleich zu `BereitstellungsraeumePage.tsx:225-237`.

- [ ] **Step 1: Failing Tests**

`brAuswahl.test.ts` — Kopie von `uhsAuswahl.test.ts` mit `Bereitstellungsraum`-Fabrik
(`{ id, einsatz_id: 1, bezeichnung, standort: null, notiz: null, status, storniert_at: null, … }` —
Pflichtfelder aus `rg -n -A14 "        BrAnzeige: {" src/api/types.generated.ts` übernehmen) und einem
zusätzlichen Fall: `it('behandelt einen stornierten aktiven BR nicht als aktiv', …)` → erwartet den
Fallback auf die größte id.

`BereitstellungsraeumeDefault.test.tsx` — Kopie von `UnfallhilfsstellenDefault.test.tsx` mit Pfad
`/einsaetze/1/bereitstellungsraeume`, Endpoint `/api/einsaetze/1/bereitstellungsraeume`,
Leerzustand-Texten `Noch keine Bereitstellungsräume erfasst` / `Ersten BR anlegen`, Drawer-Titel
`Bereitstellungsraum anlegen`, Cache-Key `['einsatz-br', 1]` (Wire-String aus `api/queryKeys.ts`
ablesen: `rg "br:" src/api/queryKeys.ts`).

`deeplinks.test.ts`: `expect(bereitstellungsraeumeListePfad(3)).toBe('/einsaetze/3/bereitstellungsraeume/liste')`.

- [ ] **Step 2: Run — rot**

Run: `mise exec pnpm@11.10.0 -- pnpm -C <ABS>/frontend exec vitest run src/pages/bereitstellungsraum/brAuswahl.test.ts src/pages/bereitstellungsraum/BereitstellungsraeumeDefault.test.tsx src/routing/deeplinks.test.ts`
Expected: FAIL.

- [ ] **Step 3: Deeplink, Auswahl, Drawer**

`deeplinks.ts` nach Zeile 114:

```ts
/** Tabellenansicht aller Bereitstellungsräume — der Modul-Index springt seit LFH-347 · M56
 *  direkt in den zuletzt gewählten BR (wie `unfallhilfsstellen/liste`). */
export function bereitstellungsraeumeListePfad(einsatzId: number): string {
  return `${einsatzModulPfad(einsatzId, 'bereitstellungsraeume')}/liste`;
}
```

```ts
// frontend/src/pages/bereitstellungsraum/brAuswahl.ts
import type { Bereitstellungsraum } from '../../api/types';
import { letzteAuswahlSpeicher, waehleDefaultEintrag } from '../../components/direkteinstieg';

const speicher = letzteAuswahlSpeicher('br');

/** BR-Belegung des generischen Direkteinstiegs. Storniert zählt nicht als aktiv. */
export function waehleDefaultBr(liste: Bereitstellungsraum[], letzteId: number | null): number | null {
  return waehleDefaultEintrag(liste, letzteId, (b) => b.status === 'aktiv' && !b.storniert_at);
}
export const merkeLetztenBr = speicher.merke;
export const liesLetztenBr = speicher.lies;
```

`BrAnlegenDrawer.tsx`: nach dem Muster von `UhsAnlegenDrawer.tsx` (oben vollständig abgedruckt)
mit `legeBrAn`/`BrEingabe` aus `api/einsatzBereitstellungsraum`, Invalidierung
`einsatzKeys.br(einsatzId)` + `einsatzKeys.etb(einsatzId)`, Erfolgstoast
`'Bereitstellungsraum angelegt'`, Drawer-Titel `"Bereitstellungsraum anlegen"`, ohne
`initialValues`, Felder Bezeichnung (`z. B. BR Ost`) / Standort (optional) / Notiz (optional) —
byte-gleich zu `BereitstellungsraeumePage.tsx:225-237`.

- [ ] **Step 4: Default + Switcher + Routen**

`BereitstellungsraeumeDefault.tsx` — wie `UnfallhilfsstellenDefault` mit `listeBr`, `einsatzKeys.br`,
`bereitstellungsraumDetailPfad`, `waehleDefaultBr`/`liesLetztenBr`, Texten aus Step 1, `BrAnlegenDrawer`.

`BrSwitcher.tsx` — wie `UhsSwitcher` mit `listeBr`, `brStatus`, `STATUS_RANG: Record<BrStatus, number> = { aktiv: 0, geplant: 1, aufgeloest: 2 }`,
Liste ohne stornierte (`.filter((b) => !b.storniert_at)`), `neuLabel="+ Neuer BR"`, `BrAnlegenDrawer`.

`App.tsx`: Zeile 93 `bereitstellungsraeume: <BereitstellungsraeumeDefault />`; nach Zeile 225
`<Route path="bereitstellungsraeume/liste" element={<BereitstellungsraeumePage />} />` (vor `:brId`, wie bei UHS); Import ergänzen.

`BereitstellungsraeumePage.tsx`: den Drawer (Zeilen 194–239) samt `anlegenMut`, `anlegenAbbrechen`,
`drawerSchliessen`, den Refs und dem `useEffect` (Zeilen 54–89) durch
`<BrAnlegenDrawer einsatzId={einsatzId} open={anlegen} onClose={() => setAnlegen(false)} onAngelegt={(br) => navigate(bereitstellungsraumDetailPfad(einsatzId, br.id))} />`
ersetzen; ungenutzte Imports (`Drawer`, `Form`, `Input`, `ErfassungsFormular`, `useMutation`, `useQueryClient`, `App`, `ApiError`, `legeBrAn`, `useCallback`, `useEffect`, `useRef`) entfernen.
Leerzustand (H41-Rest): im `else`-Zweig **vor** der Tabelle
`{brQuery.isSuccess && sichtbar.length === 0 && <SeitenLeer titel="Noch keine Bereitstellungsräume erfasst" hinweis="Lege einen Bereitstellungsraum an, um Kräfte zu sammeln." aktion={schreibgeschuetzt ? undefined : { label: 'Ersten BR anlegen', onClick: () => setAnlegen(true) }} />}`
und die Tabelle nur rendern, wenn `sichtbar.length > 0 || brQuery.isLoading`. Das `locale.emptyText`
bleibt (Ladephase). Die Bestandstests, die den Drawer über die Seite prüfen (Zeilen 194–291),
laufen weiter — der Drawer ist derselbe, nur ausgelagert; scheitert einer an
`abbruchGeneration`-Semantik, ist das ein Hinweis, dass der Drawer nicht byte-gleich gezogen wurde.

`BrDetailPage.tsx`: `listenPfad = bereitstellungsraeumeListePfad(einsatzId)`; Import anpassen;
nach den Queries `useEffect(() => { if (detailQuery.isSuccess) merkeLetztenBr(einsatzId, brId); }, [detailQuery.isSuccess, einsatzId, brId]);`
(Muster `UhsDetailPage.tsx:47`); `titel` → `<Space><BrSwitcher einsatzId={einsatzId} aktuellerBr={br} /><StatusTag …/></Space>`.

- [ ] **Step 5: Run — BR-Suite, Routing, Deeplinks grün**

Run: `mise exec pnpm@11.10.0 -- pnpm -C <ABS>/frontend exec vitest run src/pages/bereitstellungsraum src/routing src/App.test.tsx`
Expected: PASS. Zusätzlich `rg "bereitstellungsraeume" e2e/` — trifft eine Spec den Modulpfad und erwartet die Tabelle, auf `/liste` umstellen (Begründung im Commit).

- [ ] **Step 6: Commit**

```bash
git add frontend/src/pages/bereitstellungsraum frontend/src/routing frontend/src/App.tsx frontend/e2e
git commit -m "feat(lfh-347): gibt dem Bereitstellungsraum den Direkteinstieg der UHS

LFH-347 · M56. Modul-Index springt in den zuletzt gewählten BR, Kopf-Switcher im
Detail, Tabelle bleibt unter …/bereitstellungsraeume/liste; leere Liste führt zur
Anlage (H41).

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Av3wVEyh3w7pSvvem5yeur"
```

---

### Task 7: BR-Detail — Typ, Stärke, Summenzeile (M58a)

**Files:**
- Modify: `frontend/src/pages/bereitstellungsraum/BrDetailPage.tsx:175-229`
- Test: `frontend/src/pages/bereitstellungsraum/BrDetailPage.test.tsx`

**Interfaces:**
- Consumes: `summiereStaerke` (Task 1).
- Produces: Summenzeile-Text `Bereitgestellt: <F/UF/M//Σ> · <n> Fahrzeuge` (bei 1: `1 Fahrzeug`), `data-testid="br-summe"`.

Stärke und Typ kommen aus `einheitenQuery`/`fahrzeugeQuery` — beide lädt die Seite ohnehin für
die Sidebar. `BrEinheitKurz` (`id`, `name`) bleibt schlank; ein Backend-Umbau wäre ein zweites
Cache-Fach für Bytes, die schon da sind (dieselbe Abwägung wie LFH-346 · H36).

- [ ] **Step 1: Failing Test**

```tsx
  it('zeigt je bereitgestellter Einheit Typ und Stärke sowie die Summenzeile', async () => {
    const zug = einheit({ id: 10, name: 'Zug 1', typ_label: 'Zug', ist_kumuliert: { fuehrer: 1, unterfuehrer: 3, mannschaft: 18 } });
    const trupp = einheit({ id: 11, name: 'Trupp 2', typ_label: 'Trupp', ist_kumuliert: { fuehrer: 0, unterfuehrer: 1, mannschaft: 2 } });
    server.use(
      ...handlers({ einheiten: [{ id: 10, name: 'Zug 1' }, { id: 11, name: 'Trupp 2' }], fahrzeuge: [{ id: 5, funkrufname: 'Florian 1' }] }),
      http.get('/api/einsaetze/1/einheiten', () => HttpResponse.json([zug, trupp])),
      http.get('/api/einsaetze/1/fahrzeuge', () => HttpResponse.json([{ id: 5, einsatz_id: 1, funkrufname: 'Florian 1', fahrzeugtyp: 'LF 20', einheit_id: null, aktueller_br_id: 1 }])),
    );
    renderPage();
    const summe = await screen.findByTestId('br-summe');
    expect(summe).toHaveTextContent('Bereitgestellt: 1/4/20//25 · 1 Fahrzeug');
    expect(screen.getByText('Zug')).toBeInTheDocument();
    expect(screen.getByText('1/3/18//22')).toBeInTheDocument();
    expect(screen.getByText('LF 20')).toBeInTheDocument();
  });
```

Die `handlers`-Fabrik und `einheit`-Fabrik der Datei vorher lesen (`sed -n 1,105p`) und die
Aufrufsignatur übernehmen — die obige Form ist die Absicht, nicht die exakte Signatur.

- [ ] **Step 2: Run — rot.** Run: `… vitest run src/pages/bereitstellungsraum/BrDetailPage.test.tsx -t "Summenzeile"`. Expected: FAIL.

- [ ] **Step 3: Seite**

Vor dem `return` (nach `onEntfernenFahrzeug`):

```tsx
  // Typ und Stärke aus der Einheiten-/Fahrzeugliste (LFH-347 · M58): `BrEinheitKurz` trägt nur
  // id+name, die vollen Daten liegen in Queries, die die Sidebar ohnehin braucht.
  const einheitVon = new Map((einheitenQuery.data ?? []).map((e) => [e.id, e]));
  const fahrzeugVon = new Map((fahrzeugeQuery.data ?? []).map((f) => [f.id, f]));
  const bereitgestellt = br.einheiten.map((e) => einheitVon.get(e.id)).filter((e): e is Einheit => e != null);
  const summe = summiereStaerke(bereitgestellt);
  const fahrzeugZahl = br.fahrzeuge.length;
```

Über `SektionHeader titel="Bereitgestellte Einheiten"`:

```tsx
          <Typography.Text strong data-testid="br-summe" style={{ display: 'block', marginBottom: abstand.md }}>
            Bereitgestellt: <StaerkeAnzeige wert={summe} /> · {fahrzeugZahl} {fahrzeugZahl === 1 ? 'Fahrzeug' : 'Fahrzeuge'}
          </Typography.Text>
```

Einheiten-Eintrag (`{e.name}` Zeile 199) → 
```tsx
                <Space wrap>
                  <span>{e.name}</span>
                  {einheitVon.get(e.id)?.typ_label && <Tag>{einheitVon.get(e.id)!.typ_label}</Tag>}
                  <Tag color="blue"><StaerkeAnzeige wert={einheitVon.get(e.id)?.ist_kumuliert ?? null} /></Tag>
                </Space>
```
Fahrzeug-Eintrag (`{f.funkrufname}`) → `<Space wrap><span>{f.funkrufname}</span>{fahrzeugVon.get(f.id)?.fahrzeugtyp && <Tag>{fahrzeugVon.get(f.id)!.fahrzeugtyp}</Tag>}</Space>`.
Imports: `Tag`, `Typography` aus antd; `StaerkeAnzeige` aus `../../anzeige/StaerkeAnzeige`; `summiereStaerke` aus `../../anzeige/staerke`.

- [ ] **Step 4: Run — Datei grün.** Run: `… vitest run src/pages/bereitstellungsraum/BrDetailPage.test.tsx`. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/bereitstellungsraum/BrDetailPage.tsx frontend/src/pages/bereitstellungsraum/BrDetailPage.test.tsx
git commit -m "feat(lfh-347): zeigt im Bereitstellungsraum Typ, Stärke und Summenzeile

LFH-347 · M58. Aus den ohnehin geladenen Listen — kein zweiter Endpunkt.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Av3wVEyh3w7pSvvem5yeur"
```

---

### Task 8: Sidebar freie Kräfte — Suche, Scroll, Gruppen (M58b)

**Files:**
- Create: `frontend/src/pages/bereitstellungsraum/freieKraefte.ts` + `freieKraefte.test.ts`
- Modify: `frontend/src/pages/bereitstellungsraum/KraefteOhneBrSidebar.tsx`
- Test: `frontend/src/pages/bereitstellungsraum/BrDetailPage.test.tsx` (Bestand grün + Suche)

**Interfaces:**
- Produces: `gruppiereFreieKraefte(einheiten: Einheit[], fahrzeuge: EinsatzFahrzeug[], suche: string): Array<{ titel: string; einheiten: Einheit[]; fahrzeuge: EinsatzFahrzeug[] }>` — Gruppen nach `typ_label ?? 'Ohne Typ'` (alphabetisch, `'de'`), Fahrzeuge ohne Einheit als letzte Gruppe `Fahrzeuge ohne Einheit`; Suche case-insensitiv über `name` / `funkrufname` / `fahrzeugtyp`; leere Gruppen fallen weg.

- [ ] **Step 1: Failing Test**

```ts
// frontend/src/pages/bereitstellungsraum/freieKraefte.test.ts
import { describe, expect, it } from 'vitest';
import type { Einheit, EinsatzFahrzeug } from '../../api/types';
import { gruppiereFreieKraefte } from './freieKraefte';

const e = (id: number, name: string, typ_label: string | null): Einheit => ({ id, name, typ_label } as unknown as Einheit);
const f = (id: number, funkrufname: string, fahrzeugtyp: string | null): EinsatzFahrzeug => ({ id, funkrufname, fahrzeugtyp } as unknown as EinsatzFahrzeug);

describe('gruppiereFreieKraefte', () => {
  const einheiten = [e(1, 'Zug Nord', 'Zug'), e(2, 'Trupp A', 'Trupp'), e(3, 'Sonder', null), e(4, 'Zug Süd', 'Zug')];
  const fahrzeuge = [f(9, 'Florian 1', 'LF 20')];

  it('gruppiert nach Typ (alphabetisch), Ohne Typ und Fahrzeuge zuletzt', () => {
    expect(gruppiereFreieKraefte(einheiten, fahrzeuge, '').map((g) => g.titel))
      .toEqual(['Trupp', 'Zug', 'Ohne Typ', 'Fahrzeuge ohne Einheit']);
  });

  it('filtert über Name, Funkrufname und Fahrzeugtyp — leere Gruppen fallen weg', () => {
    expect(gruppiereFreieKraefte(einheiten, fahrzeuge, 'süd').map((g) => g.titel)).toEqual(['Zug']);
    expect(gruppiereFreieKraefte(einheiten, fahrzeuge, 'lf 20').map((g) => g.titel)).toEqual(['Fahrzeuge ohne Einheit']);
  });
});
```

- [ ] **Step 2: Run — rot.** Run: `… vitest run src/pages/bereitstellungsraum/freieKraefte.test.ts`.

- [ ] **Step 3: Rechenkern + Sidebar**

```ts
// frontend/src/pages/bereitstellungsraum/freieKraefte.ts
import type { Einheit, EinsatzFahrzeug } from '../../api/types';

export interface KraefteGruppe { titel: string; einheiten: Einheit[]; fahrzeuge: EinsatzFahrzeug[]; }

const OHNE_TYP = 'Ohne Typ';
const FAHRZEUGE = 'Fahrzeuge ohne Einheit';

/** Gruppierung + Suche der freien Kräfte (LFH-347 · M58), rein und ohne Render prüfbar. */
export function gruppiereFreieKraefte(einheiten: Einheit[], fahrzeuge: EinsatzFahrzeug[], suche: string): KraefteGruppe[] {
  const q = suche.trim().toLocaleLowerCase('de');
  const trifft = (...felder: Array<string | null | undefined>) =>
    q === '' || felder.some((s) => s != null && s.toLocaleLowerCase('de').includes(q));

  const nachTyp = new Map<string, Einheit[]>();
  for (const e of einheiten) {
    if (!trifft(e.name, e.typ_label)) continue;
    const t = e.typ_label ?? OHNE_TYP;
    if (!nachTyp.has(t)) nachTyp.set(t, []);
    nachTyp.get(t)!.push(e);
  }
  const typen = [...nachTyp.keys()].filter((t) => t !== OHNE_TYP).sort((a, b) => a.localeCompare(b, 'de'));
  if (nachTyp.has(OHNE_TYP)) typen.push(OHNE_TYP);
  const gruppen: KraefteGruppe[] = typen.map((t) => ({ titel: t, einheiten: nachTyp.get(t)!, fahrzeuge: [] }));

  const fz = fahrzeuge.filter((f) => trifft(f.funkrufname, f.fahrzeugtyp));
  if (fz.length) gruppen.push({ titel: FAHRZEUGE, einheiten: [], fahrzeuge: fz });
  return gruppen;
}
```

`KraefteOhneBrSidebar.tsx`: `const [suche, setSuche] = useState('');`, `const gruppen = gruppiereFreieKraefte(freieEinheiten, freiFahrzeuge, suche);`.
Card-Inhalt:

```tsx
      <Input allowClear placeholder="Kräfte suchen" aria-label="Kräfte suchen" value={suche} onChange={(e) => setSuche(e.target.value)} style={{ marginBottom: token.marginSM }} />
      {/* Eigener Scroll mit begrenzter Höhe (M58): die Höhenkette endet hier an der Karte selbst,
          nicht am Layout (Falle aus LFH-343 · H51) — deshalb ein Maß in dvh direkt am Container. */}
      <div style={{ maxHeight: 'min(60dvh, 560px)', overflowY: 'auto' }}>
        {leer && <Typography.Text type="secondary">keine freien Kräfte</Typography.Text>}
        {!leer && gruppen.length === 0 && <Typography.Text type="secondary">keine Treffer</Typography.Text>}
        {gruppen.map((g) => (
          <div key={g.titel} style={{ marginBottom: token.marginSM }}>
            <Typography.Text type="secondary" strong style={{ display: 'block', marginBottom: token.marginXXS }}>{g.titel}</Typography.Text>
            {g.einheiten.map((e) => (… bisherige Zeile …))}
            {g.fahrzeuge.map((f) => (… bisherige Zeile …))}
          </div>
        ))}
      </div>
```

`const { token } = theme.useToken();` (Import `theme`, `Input` aus antd; `useState` aus react).
Die bisherigen Zeilen (Tag + „zuweisen"-Knopf) unverändert übernehmen.

- [ ] **Step 4: Test an der Seite** — in `BrDetailPage.test.tsx`:

```tsx
  it('filtert die freien Kräfte über das Suchfeld', async () => {
    const a = einheit({ id: 30, name: 'Zug Nord', aktueller_br_id: null });
    const b = einheit({ id: 31, name: 'Trupp Süd', aktueller_br_id: null });
    server.use(...handlers(), http.get('/api/einsaetze/1/einheiten', () => HttpResponse.json([a, b])));
    renderPage();
    await screen.findByText('Zug Nord');
    await userEvent.type(screen.getByLabelText('Kräfte suchen'), 'süd');
    expect(screen.queryByText('Zug Nord')).not.toBeInTheDocument();
    expect(screen.getByText('Trupp Süd')).toBeInTheDocument();
  });
```

- [ ] **Step 5: Run — grün.** Run: `… vitest run src/pages/bereitstellungsraum`. Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/pages/bereitstellungsraum
git commit -m "feat(lfh-347): gibt der Sidebar der freien Kräfte Suche, Scroll und Typgruppen

LFH-347 · M58.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Av3wVEyh3w7pSvvem5yeur"
```

---

### Task 9: Gefahrenmatrix — e2e-Nachweis Zellhöhe auf dem Tablet (M51-Rest)

**Files:**
- Create: `frontend/e2e/gefahren-matrix-zelle.spec.ts`

**Interfaces:**
- Consumes: Zell-Knopf `getByRole('button', { name: /^Bewertung / })` (`GefahrenMatrix.tsx:159`), Dichte-Schlüssel `lifeline-hub.dichte`, Login-Helfer wie `trefflaeche-tablet.spec.ts:25-38`.

- [ ] **Step 1: Endpunkt für ein Gefahrengebiet ermitteln**

Run: `rg -n "gefahrengebiet" <ABS>/src/routes/lage_zone.rs | head -20` und `rg -n "zonen|lage_zone" <ABS>/src/routes/mod.rs | head`.
Der Test legt das Gebiet **über die API** an (`page.request.post`), nicht über die Karte (WebGL, s. Memory). Body nach dem Rust-Struct `NeueLageZone` (`rg -n "struct NeueLageZone" -A12 <ABS>/src`): `typ: 'gefahrengebiet'`, `geometrie_typ: 'polygon'`, ein kleines GeoJSON-Polygon, `label`.

- [ ] **Step 2: Spec schreiben**

```ts
import { expect, test, type Page } from '@playwright/test';

/**
 * M51 (LFH-347 · C12), Nachweis zur Entscheidung aus LFH-368 · B5h: die Zelle der
 * Gefahrenmatrix ist EIN Auslöser (Dropdown), kein 5-Wege-Segmentcontrol — das Breitenbudget
 * im Fükw (~693 px) trägt keins. Was das Ticket verlangt und hier gemessen wird: auf dem
 * Führungs-Tablet (Stufe komfortabel) ist jede bedienbare Zelle ≥ 44 px hoch. Im Fükw
 * (kompakt, Maus) sind es 30 — das ist die Staffel aus LFH-352, kein Mangel.
 */
test.use({ hasTouch: true, viewport: { width: 1024, height: 768 } });

const DICHTE = 'lifeline-hub.dichte';
const PW = process.env.E2E_ADMIN_PW ?? 'e2e-admin-pw';

async function anmelden(page: Page) {
  await page.goto('/login');
  await page.getByLabel('Benutzername').fill('admin');
  await page.getByLabel('Passwort').fill(PW);
  await page.getByRole('button', { name: 'Anmelden', exact: true }).click();
  await expect(page).toHaveURL(/\/einsaetze/);
}

test('jede Matrix-Zelle misst auf dem Tablet mindestens 44 px', async ({ page }) => {
  await page.addInitScript(([k, v]) => window.localStorage.setItem(k, v), [DICHTE, 'komfortabel'] as const);
  await anmelden(page);
  await page.getByRole('button', { name: 'Neuer Einsatz' }).click();
  await page.getByLabel('Bezeichnung').fill('C12 Matrix');
  await page.getByRole('button', { name: 'Anlegen', exact: true }).click();
  await expect(page).toHaveURL(/\/einsaetze\/\d+/);
  const einsatzId = page.url().match(/\/einsaetze\/(\d+)/)![1];

  // Gefahrengebiet über die API (Pfad/Body aus Step 1 eintragen).
  const antwort = await page.request.post(`/api/einsaetze/${einsatzId}/<PFAD-AUS-STEP-1>`, { data: { /* Body aus Step 1 */ } });
  expect(antwort.ok()).toBeTruthy();

  await page.goto(`/einsaetze/${einsatzId}/gefahren`);
  const zellen = page.getByRole('button', { name: /^Bewertung / });
  await expect(zellen.first()).toBeVisible();
  const n = await zellen.count();
  expect(n).toBeGreaterThanOrEqual(58);
  for (let i = 0; i < n; i += 1) {
    const box = await zellen.nth(i).boundingBox();
    expect(box?.height ?? 0, `Zelle ${i}`).toBeGreaterThanOrEqual(44);
  }
});
```

`<PFAD-AUS-STEP-1>` und den Body **vor dem ersten Lauf** durch die in Step 1 ermittelten Werte
ersetzen — der Spec darf nicht mit dem Platzhalter committet werden.

- [ ] **Step 3: Laufen lassen**

Run (Backend-Binary muss existieren, `cargo test` aus der Baseline hat es gebaut):
`mise exec pnpm@11.10.0 -- pnpm -C <ABS>/frontend exec playwright test e2e/gefahren-matrix-zelle.spec.ts`
Expected: 1 passed.

- [ ] **Step 4: Commit**

```bash
git add frontend/e2e/gefahren-matrix-zelle.spec.ts
git commit -m "test(lfh-347): misst die Höhe jeder Gefahrenmatrix-Zelle auf dem Führungs-Tablet

LFH-347 · M51. Nachweis zur Dropdown-Entscheidung aus LFH-368: ≥ 44 px in Stufe
komfortabel, ein Auslöser je Zelle statt Segmentcontrol (Breitenbudget ~693 px).

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Av3wVEyh3w7pSvvem5yeur"
```

---

### Task 10: Prüfliste, CLAUDE.md-Absatz, volles Gate

**Files:**
- Create: `docs/superpowers/specs/2026-08-28-lfh-347-pruefliste.md`
- Modify: `CLAUDE.md` (ein Absatz im Abschnitt „Bedien-Leitlinie", nach dem C11-Block)

- [ ] **Step 1: Prüfliste schreiben**

Format wie `docs/superpowers/specs/2026-08-25-lfh-346-pruefliste.md` (Kopf, Tabelle der gemessenen
Zahlen, 15 Zeilen mit Verdikt). Zwei Flächen, zwei Tabellen: **Gliederungsseite**
(`EinsatzabschnittePage`, Stellvertreter für Baum + Detail) und **BR-Detail** (`BrDetailPage`
mit Sidebar). Pflichtinhalt: die M51-Abweichung („ein Tipp" → zwei, Begründung LFH-368,
gemessener Wert aus Task 9), das Führungspunkt-Verdikt (Kriterium Statusfarbe/zweiter Kanal:
erfüllt, `aria-label`), Live-Aktualisierung (Direkteinstieg ohne Resync: erfüllt), Tabelle
(Kriterium 14: nicht anwendbar — Baum und Listen, keine Vergleichsfläche außer `…/liste`, die
`KatalogTabelle` unverändert trägt).

- [ ] **Step 2: CLAUDE.md-Absatz** (nach dem Absatz „Ein Collapse im Erfassungsformular …", vor „Live-Updates springen nicht"):

```markdown
- **Ein Direkteinstieg ist ein Baustein, kein UHS-Sonderfall** (LFH-347 · C12, M56).
  `components/Direkteinstieg.tsx` + `components/EinstiegSwitcher.tsx` + `components/direkteinstieg.ts`
  tragen „spring in den zuletzt gewählten Datensatz, sonst in den ältesten aktiven, sonst den
  jüngsten; bei leerer Menge Leerzustand mit Anlage". UHS und Bereitstellungsraum sind zwei
  dünne Belegungen; die Tabelle liegt jeweils unter `…/liste`. Der `localStorage`-Schlüssel
  `<praefix>:letzteAuswahl:<einsatzId>` ist für `uhs` byte-gleich zum Bestand — gespeicherte
  Auswahlen überleben den Umbau, und `direkteinstieg.test.ts` pinnt ihn.
  **Eine Stärke wird EINMAL summiert** (`anzeige/staerke.ts:summiereStaerke`, `null` bei
  leerer Menge — „keine Einheit" ist nicht „0/0/0"); Abschnitt eigene, Abschnitt inkl.
  Unterabschnitte (`pages/einsatzabschnitte/abschnittStaerke.ts`) und BR-Summenzeile lesen alle
  von dort. Die Bestandszeile `Stärke (F/UF/M//Σ)` behält ihre Bedeutung (direkt zugeordnet);
  die kumulierte ist eine **zweite** Zeile, kein stiller Bedeutungswechsel.
  **„Abschnitt anlegen" ist ein lokaler Entwurf** (M55): eigener `entwurf`-State, kein
  Fake-Datensatz in der Query — ein Objekt mit `id: -1` liefe durch `nachfahrenInkl`, die
  Stärke-Rechnung und den Deeplink-Abgleich. Der POST (und der ETB-Eintrag) entsteht beim
  Speichern; Abbrechen hinterlässt nichts, und der Test zählt beides (0 POST, 0
  ETB-Invalidierung).
  **M51 bleibt bei einem Auslöser je Zelle** — das Ticket verlangte ein 5-Wege-Segmentcontrol
  mit einem Tipp, LFH-368 hat gemessen, dass das Breitenbudget (~693 px) es nicht trägt. Der
  e2e-Nachweis (`e2e/gefahren-matrix-zelle.spec.ts`) misst ≥ 44 px auf dem Tablet in Stufe
  `komfortabel`; im Fükw sind 30 px die Staffel, kein Mangel.
```

- [ ] **Step 3: Volles Gate**

Run: `rtk proxy ./scripts/check-all.sh` aus `<ABS>`.
Expected: alle Schritte grün (fmt, lint, typ-codegen/tsc, cargo test, vitest, deps, e2e). Bei
Vitest-/e2e-Flakes unter Last (Memory `frontend-testsuite-parallel-timeouts`): die betroffene
Spec einzeln wiederholen; ein wandernder Timeout ist kein Regressionsbeweis, ein stehender schon.

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/specs/2026-08-28-lfh-347-pruefliste.md CLAUDE.md
git commit -m "docs(lfh-347): Prüfliste Einsatztauglichkeit und Festlegungen zu C12

LFH-347.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Av3wVEyh3w7pSvvem5yeur"
```

---

## Self-Review

**Spec-Abdeckung:** H37 → T1+T2 · H41 → Bestand (belegt, s. Vorab-Befund) + T6 (BR-Leerzustand) ·
M59 → T3 · M58 → T7+T8 · M56 → T5+T6 · M55 → T4 · M51 → T9 (mit begründeter Abweichung, T10
dokumentiert). AK1 → T2-Test · AK2 → Bestandstests (Zeilen im Vorab-Befund genannt) · AK3 →
T3 Guard + Token-Test · AK4 → Guard `dichte.guard.test.ts` (Bestand) + T9 e2e; „ein Tipp" bewusst
nicht erfüllt, s. o. · AK5 → T4 · AK6 → T6 (Vitest analog `uhsAuswahl`), Route `…/liste`, T7 (Typ-Tag,
`StaerkeAnzeige`, Summenzeile).

**Typkonsistenz:** `summiereStaerke` (T1) wird in T2 über `abschnittStaerken` und in T7 direkt
konsumiert; `letzteAuswahlSpeicher`/`waehleDefaultEintrag` (T5) in `uhsAuswahl` und `brAuswahl`
(T6); `bereitstellungsraeumeListePfad` (T6) in `BrDetailPage` (T6). `Direkteinstieg`-Slot-Props
(`open`/`onClose`/`onAngelegt`) entsprechen den Drawer-Props von `UhsAnlegenDrawer` und
`BrAnlegenDrawer`.

**Offen benannt, nicht versteckt:** T9 Step 1 ermittelt den API-Pfad für das Gefahrengebiet zur
Laufzeit — das ist die eine Stelle, die der Plan nicht vorab festnageln konnte, und der Spec darf
den Platzhalter nicht committen.
