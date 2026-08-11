# LFH-338 · C3 — Kräfteübersicht als belastbares Meldebild

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Die Kräfteübersicht so umbauen, dass die abgelesene Zahl nie eine Teilstärke als Gesamtstärke ausgibt, der Ausdruck ein vollständiges Meldeblatt ist, der Monitoring-Kopf ohne Horizontalscroll auf einen 13"-Fükw-Schirm passt, das Blatt aufgeklappt startet und die vier Kräfte-Modulseiten auf die Verdichtung zeigen.

**Architecture:** Alle Rechenarbeit bleibt in `frontend/src/kraefte/kraeftebild.ts` als reine Funktionen (heute schon der Ort von `filtereKraefte`/`baueKraeftebild`); die Seite rendert nur. Die Verdichtung wird aus `baueKraeftebild` herausgezogen, damit sie ein zweites Mal über die **ungefilterten** Rohdaten laufen kann (Bezugswert im Kopf) und ein drittes Mal in einer neuen, selbstladenden Kleinkomponente auf den vier Modulseiten. Die Zeile-als-Trefferziel-Regel wird im Primitiv `components/Datensicht.tsx` verdrahtet, nicht seitenlokal.

**Tech Stack:** React 19, TypeScript, antd 6, TanStack Query 5, Vitest + Testing Library (jsdom), Playwright, MSW.

## Global Constraints

- `pnpm lint` läuft mit `--max-warnings 0`; Warnings brechen wie Errors. `eslint-disable` nur zeilengenau mit Begründung.
- **Kein punktuelles `size="small"` auf interaktiven Elementen.** `frontend/src/components/dichte.guard.test.ts` führt eine Schuldmenge, die nur schrumpfen darf. Neue Buttons/Segmented/Selects/Tags bekommen **keine** `size`-Prop.
- Eine `<Space>`-Aktionsreihe mit `danger`-Knopf braucht `size="middle"` (`components/aktionsabstand.guard.test.ts`). In diesem Ticket entsteht kein `danger`-Knopf — die Regel wird hier nur nicht verletzt.
- **Kein Emoji als Ikone.** Bildzeichen kommen aus `@ant-design/icons`, in einer `aria-hidden`-Hülle (der Icon-Knoten bringt `role="img"` mit englischem `aria-label` mit).
- **Farbwerte nur aus `theme/tokens.ts` / `theme/statusFarben.ts`**, nie roh. Statusfarbe braucht immer einen zweiten Kanal (Text/Symbol).
- **Kein Inline-Pfad** für Einsatz-Routen — alles über `frontend/src/routing/deeplinks.ts`.
- **Kein Inline-String-Array als Query-Key** — nur `einsatzKeys`/`globalKeys` aus `api/queryKeys.ts` (erzwungen von `queryKeys.guard.test.ts`).
- jsdom rechnet **kein Layout** und wertet **kein `@media print`** aus. Layout- und Druckmedien-Aussagen gehören nach `frontend/e2e/`; CSS-**Text** ist per `readFileSync` prüfbar (Präzedenz: `KraefteuebersichtPage.test.tsx:355`).
- Commit-Stil: deutsche Conventional Commits mit Ticketbezug, z. B. `feat(lfh-338): …`. Ein Commit je Task.
- Gate: `./scripts/check-all.sh`. Während der Umsetzung reichen gescopte Läufe (siehe Tasks); das volle Gate läuft einmal am Ende.

## Bekannte Abweichungen vom Ticketwortlaut (gemessen gegen HEAD, 11.08.2026)

Diese vier Punkte sind **entschieden**, nicht offen. Sie gehören in die Commit-Bodys bzw. den Abschlusskommentar:

1. **Alle Zeilennummern im Ticket sind veraltet.** `KraefteuebersichtPage.tsx` hat heute 398 Zeilen; der Monitoring-Kopf liegt bei 260–310, `expandedKeys` bei 159, die Filter-Selects bei 313–357, `alleKeys` bei 146. Der Plan nennt die heutigen Stellen.
2. **`LageDashboardPage.tsx:118-125` nutzt kein `Row`/`Col`.** Grep über `pages/lage-dashboard/` nach `<Row`, `<Col`, `gridTemplateColumns`: 0 Treffer — das Dashboard arbeitet mit den CSS-Klassen `lfh-kachel` aus `theme/sprache.css`. Das im Ticket genannte Vorbild existiert nicht mehr. Bindend bleibt das **Messbare**: `grep -c "flexWrap: 'nowrap'"` = 0 und `scrollWidth <= clientWidth` am Kopf. Umgesetzt wird mit antd `Row`/`Col` — das ist die Form, die das Ticket nennt, und sie ist im Repo (`pages/admin/…`, `EinsatzdatenPage`) gebräuchlich.
3. **B3 hat kein Kopfzeilen-Primitiv für „X von Y" oder Filter-Chips.** `components/SeitenZustand.tsx` liefert `SeitenLeer` mit **einer** Aktion — das ist Zurücksetzen *im Leerzustand* (Idiom aus `pages/EtbPage.tsx:207`), nicht im Kopf. Die Filterzeile wird deshalb **seitenlokal** gebaut, mit der Begründung im Dateikopf (ein Konsument; Repo-Norm „Primitiv erst ab dem zweiten Konsumenten"). Der echte Wiederverwendungsfall dieses Tickets ist die **Verdichtungszeile** mit vier Aufrufern (Task 7) — sie wird Komponente.
4. **`Datensicht` reicht `expandRowByClick` heute nicht durch** (`Datensicht.tsx:1215-1224` setzt nur `childrenColumnName`, `expandedRowKeys`, `onExpandedRowsChange`). Die Zeile-als-Trefferziel-Regel wird deshalb im Primitiv verdrahtet (Task 6), nicht per `onRow` auf der Seite.

**Nicht in Konflikt:** C1 (LFH-336) und C2 (LFH-337) sind beide bereits in `main` gemergt (`git log --all --grep`), `routing/deeplinks.ts` ist frei.

---

## Dateiplan

| Datei | Rolle in diesem Ticket |
|---|---|
| `frontend/src/kraefte/kraeftebild.ts` | **ändern** — `verdichte()` als exportierte reine Funktion herauslösen; `baueKraeftebild` ruft sie |
| `frontend/src/kraefte/kraeftebild.test.ts` | **ändern** — Unit-Tests für `verdichte()` |
| `frontend/src/routing/deeplinks.ts` | **ändern** — `kraefteuebersichtPfad(einsatzId)` |
| `frontend/src/routing/deeplinks.test.ts` | **ändern** — Unit-Test dafür |
| `frontend/src/pages/KraefteuebersichtPage.tsx` | **ändern** — Filterwahrheit, Druckkopf, Kopf-Umbruch, Aufklappen |
| `frontend/src/pages/kraefteuebersichtPrint.css` | **ändern** — `.kraefte-nur-print`, `thead`/`tr`-Regeln |
| `frontend/src/pages/KraefteuebersichtPage.test.tsx` | **ändern** — Filter-, Druckkopf-, Aufklapp-Nachweise |
| `frontend/src/components/Datensicht.tsx` | **ändern** — `expandRowByClick` im Baum-Zweig + Ausschluss `baum` × `onZeileKlick` |
| `frontend/src/components/Datensicht.test.tsx` | **ändern** — Nachweis Zeilenklick + Ausschlussbefund |
| `frontend/src/kraefte/Verdichtungszeile.tsx` | **neu** — selbstladende Kennzahlenzeile mit Link auf die Übersicht |
| `frontend/src/kraefte/Verdichtungszeile.test.tsx` | **neu** — Zustände + Link |
| `frontend/src/pages/{Fahrzeuge,Personal,Material,Einheiten}Page.tsx` | **ändern** — Verdichtungszeile über der Tabelle |
| `frontend/src/pages/{Fahrzeuge,Personal,Material,Einheiten}Page.test.tsx` | **ändern** — MSW-Handler für die neuen Abrufe + Link-Nachweis |
| `frontend/e2e/meldebild-tabelle.spec.ts` | **ändern** — Kopf ohne Horizontalscroll auf schmalem Führungsschirm |

**Reihenfolge:** 1 → 2 → 3 → 4 → 5 → 6 → 7. Tasks 3–6 hängen alle an `KraefteuebersichtPage.tsx`; sie werden nacheinander ausgeführt, nicht parallel.

---

### Task 1: `verdichte()` aus `baueKraeftebild` herauslösen

Die Verdichtung wird dreimal gebraucht: gefiltert (Kopfzahlen, heute), ungefiltert (Bezugswert, Task 3) und auf den Modulseiten (Task 7). Heute steckt sie fest im Rumpf von `baueKraeftebild`.

**Files:**
- Modify: `frontend/src/kraefte/kraeftebild.ts:741-770`
- Test: `frontend/src/kraefte/kraeftebild.test.ts`

**Interfaces:**
- Consumes: `StaerkeSumme`, `StatusVerteilung`, `Verdichtung`, `MaterialStatus`, die modulprivaten `leereStaerke()`, `leereVert()`, `addPosition()`, `addKategorie()` (alle bereits in der Datei).
- Produces:
  ```ts
  export type Kurzverdichtung = Omit<Verdichtung, 'soll'>;
  export function verdichte(
    personal: EinsatzPersonal[],
    fahrzeuge: EinsatzFahrzeug[],
    material: EinsatzMaterial[],
  ): Kurzverdichtung;
  ```
  `baueKraeftebild` liefert weiterhin `verdichtung: { ...verdichte(...), soll: gesammeltesSoll }` — die öffentliche Form von `Kraeftebild` ändert sich **nicht**.

- [ ] **Step 1: Failing test schreiben**

An `frontend/src/kraefte/kraeftebild.test.ts` anhängen (Fixture-Bauer der Datei wiederverwenden, falls vorhanden — sonst wie unten inline):

```ts
import { verdichte } from './kraeftebild';

describe('verdichte', () => {
  it('summiert Stärke, Fahrzeugstatus und Materialstatus über die Rohlisten', () => {
    const v = verdichte(
      [
        { staerke_position: 'fuehrer', status_kategorie: 'gebunden' },
        { staerke_position: 'mannschaft', status_kategorie: 'gebunden' },
        { staerke_position: 'mannschaft', status_kategorie: 'verfuegbar' },
      ] as never,
      [
        { status_kategorie: 'verfuegbar' },
        { status_kategorie: 'nicht_verfuegbar' },
      ] as never,
      [{ status: 'einsatzbereit' }, { status: 'defekt' }, { status: 'defekt' }] as never,
    );

    expect(v.staerke).toEqual({ fuehrer: 1, unterfuehrer: 0, mannschaft: 2, gesamt: 3 });
    expect(v.fahrzeugStatus.verfuegbar).toBe(1);
    expect(v.fahrzeugStatus.nicht_verfuegbar).toBe(1);
    expect(v.personalStatus.gebunden).toBe(2);
    expect(v.materialStatus.defekt).toBe(2);
    expect(v.anzahlPersonal).toBe(3);
    expect(v.anzahlFahrzeuge).toBe(2);
    expect(v.anzahlMaterialPositionen).toBe(3);
  });

  it('liefert auf leeren Listen Nullen statt undefined', () => {
    const v = verdichte([], [], []);
    expect(v.staerke.gesamt).toBe(0);
    expect(v.anzahlPersonal).toBe(0);
    expect(v.materialStatus.einsatzbereit).toBe(0);
  });
});
```

- [ ] **Step 2: Test laufen lassen, Rot bestätigen**

```bash
mise exec pnpm@11.10.0 -- pnpm -C /Users/rubeen/dev/personal/lifeline-hub/.claude/worktrees/dev-clickup-execution-eed38c/frontend vitest run src/kraefte/kraeftebild.test.ts
```
Erwartet: FAIL — `verdichte is not a function` / TS-Fehler „has no exported member".

- [ ] **Step 3: Funktion herauslösen**

In `kraeftebild.ts` **vor** `baueKraeftebild` einfügen:

```ts
/** Verdichtung ohne `soll` — der Teil, der sich allein aus den drei Mittel-Listen ergibt. */
export type Kurzverdichtung = Omit<Verdichtung, 'soll'>;

/**
 * Kopfzahlen aus den ROHLISTEN, nicht aus dem Baum.
 *
 * Herausgelöst (LFH-338 · C3), weil dieselbe Rechnung dreimal gebraucht wird: gefiltert
 * für die Kopfzahlen, UNGEFILTERT als Bezugswert daneben (sonst meldet jemand die
 * Teilstärke eines Abschnitts als Gesamtstärke des Einsatzes) und ein drittes Mal in der
 * Verdichtungszeile der vier Kräfte-Modulseiten. `soll` bleibt draußen: es kumuliert über
 * den Einheitenbaum und ist ohne ihn nicht bestimmbar.
 */
export function verdichte(
  personal: EinsatzPersonal[],
  fahrzeuge: EinsatzFahrzeug[],
  material: EinsatzMaterial[],
): Kurzverdichtung {
  const staerke = leereStaerke();
  const personalStatus = leereVert();
  const fahrzeugStatus = leereVert();
  const materialStatus: Record<MaterialStatus, number> = {
    einsatzbereit: 0,
    im_einsatz: 0,
    defekt: 0,
    verbraucht: 0,
    desinfektion_noetig: 0,
  };

  for (const ep of personal) {
    addPosition(staerke, ep.staerke_position);
    addKategorie(personalStatus, ep.status_kategorie);
  }
  for (const ef of fahrzeuge) {
    addKategorie(fahrzeugStatus, ef.status_kategorie);
  }
  for (const em of material) {
    materialStatus[em.status] += 1;
  }

  return {
    staerke,
    personalStatus,
    fahrzeugStatus,
    materialStatus,
    anzahlPersonal: personal.length,
    anzahlFahrzeuge: fahrzeuge.length,
    anzahlMaterialPositionen: material.length,
  };
}
```

Dann in `baueKraeftebild` den Block ab `// ── Verdichtung: computed from raw lists (NOT from tree) ─────────────────` bis unmittelbar vor `return {` **löschen** und den Rückgabewert ersetzen:

```ts
  return {
    baum,
    verdichtung: { ...verdichte(personal, fahrzeuge, material), soll: gesammeltesSoll },
  };
```

- [ ] **Step 4: Tests grün**

```bash
mise exec pnpm@11.10.0 -- pnpm -C /Users/rubeen/dev/personal/lifeline-hub/.claude/worktrees/dev-clickup-execution-eed38c/frontend vitest run src/kraefte/ src/pages/KraefteuebersichtPage.test.tsx
```
Erwartet: PASS. Die Bestandstests von `baueKraeftebild` müssen **unverändert** grün sein — das ist der Beweis, dass die Auslösung verhaltensgleich ist.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/kraefte/kraeftebild.ts frontend/src/kraefte/kraeftebild.test.ts && git commit -m "refactor(lfh-338): löst verdichte() als reine Funktion aus baueKraeftebild"
```

---

### Task 2: Deeplink-Builder `kraefteuebersichtPfad`

**Files:**
- Modify: `frontend/src/routing/deeplinks.ts`
- Test: `frontend/src/routing/deeplinks.test.ts`

**Interfaces:**
- Consumes: `einsatzModulPfad(einsatzId, modulRoute)` (bereits vorhanden, `deeplinks.ts:40`).
- Produces: `export function kraefteuebersichtPfad(einsatzId: number): string` → `/einsaetze/<id>/kraefteuebersicht`.

- [ ] **Step 1: Failing test**

An `frontend/src/routing/deeplinks.test.ts` anhängen:

```ts
import { kraefteuebersichtPfad } from './deeplinks';

describe('kraefteuebersichtPfad', () => {
  it('baut den Modulpfad der Kräfteübersicht', () => {
    expect(kraefteuebersichtPfad(7)).toBe('/einsaetze/7/kraefteuebersicht');
  });
});
```

- [ ] **Step 2: Rot bestätigen**

```bash
mise exec pnpm@11.10.0 -- pnpm -C /Users/rubeen/dev/personal/lifeline-hub/.claude/worktrees/dev-clickup-execution-eed38c/frontend vitest run src/routing/deeplinks.test.ts
```
Erwartet: FAIL — „has no exported member 'kraefteuebersichtPfad'".

- [ ] **Step 3: Builder ergänzen**

In `deeplinks.ts` neben `lageberichtePfad`/`bereitstellungsraeumePfad` (Listen-Pfade-Block):

```ts
/** Aggregierende Kräfteübersicht (Meldebild) eines Einsatzes. */
export function kraefteuebersichtPfad(einsatzId: number): string {
  return einsatzModulPfad(einsatzId, 'kraefteuebersicht');
}
```

Der Routen-Schlüssel `kraefteuebersicht` ist der aus `einsatz/modulRegistry.ts:78` und `App.tsx:95` — nicht raten, dort nachsehen.

- [ ] **Step 4: Grün**

```bash
mise exec pnpm@11.10.0 -- pnpm -C /Users/rubeen/dev/personal/lifeline-hub/.claude/worktrees/dev-clickup-execution-eed38c/frontend vitest run src/routing/deeplinks.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add frontend/src/routing/deeplinks.ts frontend/src/routing/deeplinks.test.ts && git commit -m "feat(lfh-338): ergänzt den Deeplink-Builder kraefteuebersichtPfad"
```

---

### Task 3: Filterwahrheit im Kopf

Der Kern des Tickets. Heute steht über gefilterten Zahlen unverändert „Gesamtstärke (F/UF/M//Ges)".

**Files:**
- Modify: `frontend/src/pages/KraefteuebersichtPage.tsx` (Kopfbereich ab Z. 260)
- Test: `frontend/src/pages/KraefteuebersichtPage.test.tsx`

**Interfaces:**
- Consumes: `verdichte()` aus Task 1, `FilterWerte`, `staerkeText`.
- Produces: seitenlokale reine Funktion, exportiert für den Test:
  ```ts
  export interface FilterChip { schluessel: keyof FilterWerte; label: string; }
  export function aktiveFilterChips(filter: FilterWerte, abschnittName: (id: number) => string): FilterChip[];
  export const LEERER_FILTER: FilterWerte;
  ```

**Entscheidung, die im Dateikopf festgehalten wird:** „X von Y **Kräften**" zählt **Personal + Fahrzeuge**, nicht Material. Material ist Mittel, keine Kraft — und `filtereKraefte` unterwirft Material bewusst nicht dem Kategorie-Filter (`kraeftebild.ts:386`). Ein Zähler, der Material mitzählte, spränge bei gesetztem Statusfilter aus einem Grund, den die Zeile nicht nennt.

- [ ] **Step 1: Failing tests**

An `KraefteuebersichtPage.test.tsx` anhängen (`mitBaum()` und `setup()` sind vorhanden):

```ts
import { aktiveFilterChips, LEERER_FILTER } from './KraefteuebersichtPage';

describe('Filterwahrheit im Kopf', () => {
  it('nennt den Kopf ungefiltert „Gesamtstärke" und mit Filter nicht mehr so', async () => {
    mitBaum();
    setup();
    expect(await screen.findByText(/Gesamtstärke/)).toBeInTheDocument();

    fireEvent.mouseDown(screen.getByRole('combobox', { name: /Abschnitt/i }));
    fireEvent.click(await screen.findByTitle('Abschnitt Nord'));

    await waitFor(() => expect(screen.queryByText(/Gesamtstärke/)).toBeNull());
    expect(screen.getByText(/Stärke \(gefiltert\)/)).toBeInTheDocument();
  });

  it('zeigt „X von Y Kräften" und setzt mit einem Klick alle vier Filter zurück', async () => {
    // Zwei Kräfte: eine in Einheit E10 (Abschnitt Nord), eine ohne Abschnitt.
    vi.mocked(listeAbschnitte).mockResolvedValue([ABSCHNITT_A1]);
    vi.mocked(listeEinheiten).mockResolvedValue([EINHEIT_E10]);
    vi.mocked(listeEinsatzFahrzeuge).mockResolvedValue([FAHRZEUG_F1]);      // einheit_id 20
    vi.mocked(listeEinsatzPersonal).mockResolvedValue([PERSON_P1]);          // einheit_id null
    setup();

    expect(await screen.findByText('2 von 2 Kräften')).toBeInTheDocument();

    fireEvent.mouseDown(screen.getByRole('combobox', { name: /Abschnitt/i }));
    fireEvent.click(await screen.findByTitle('Abschnitt Nord'));
    expect(await screen.findByText('1 von 2 Kräften')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Filter zurücksetzen' }));
    expect(await screen.findByText('2 von 2 Kräften')).toBeInTheDocument();
  });

  it('führt die ungefilterte Gesamtstärke als Bezugswert weiter, wenn gefiltert wird', async () => {
    vi.mocked(listeAbschnitte).mockResolvedValue([ABSCHNITT_A1]);
    vi.mocked(listeEinheiten).mockResolvedValue([EINHEIT_E10]);
    vi.mocked(listeEinsatzPersonal).mockResolvedValue([PERSON_P1]); // 0/0/1//1, ohne Abschnitt
    setup();

    fireEvent.mouseDown(screen.getByRole('combobox', { name: /Abschnitt/i }));
    fireEvent.click(await screen.findByTitle('Abschnitt Nord'));

    // Gefiltert bleibt niemand übrig; der Bezugswert steht trotzdem da.
    expect(await screen.findByText(/ungefiltert 0\/0\/1\/\/1/)).toBeInTheDocument();
  });
});

describe('aktiveFilterChips', () => {
  it('ist leer ohne Filter', () => {
    expect(aktiveFilterChips(LEERER_FILTER, () => 'egal')).toEqual([]);
  });

  it('führt jeden gesetzten Filter mit sprechendem Label', () => {
    const chips = aktiveFilterChips(
      { abschnittId: 10, traeger: 'FF Musterstadt', kategorie: 'verfuegbar', suche: 'HLF' },
      () => 'Abschnitt Nord',
    );
    expect(chips.map((c) => c.label)).toEqual([
      'Abschnitt: Abschnitt Nord',
      'Träger: FF Musterstadt',
      'Status: Verfügbar',
      'Suche: „HLF"',
    ]);
  });
});
```

Beim Schreiben des letzten Erwartungswerts das **echte** Label aus `kraefte/statusAchse.ts` (`KATEGORIE_WERTE`, Feld `text`) nachsehen und wörtlich übernehmen — nicht raten.

- [ ] **Step 2: Rot bestätigen**

```bash
mise exec pnpm@11.10.0 -- pnpm -C /Users/rubeen/dev/personal/lifeline-hub/.claude/worktrees/dev-clickup-execution-eed38c/frontend vitest run src/pages/KraefteuebersichtPage.test.tsx
```
Erwartet: FAIL — kein Export `aktiveFilterChips`, kein Text „X von Y Kräften".

- [ ] **Step 3: Implementieren**

In `KraefteuebersichtPage.tsx` oberhalb der Komponente:

```ts
/** Der leere Filterzustand — EINE Quelle für Startwert und Zurücksetzen. */
export const LEERER_FILTER: FilterWerte = { abschnittId: null, traeger: null, kategorie: null, suche: '' };

export interface FilterChip {
  schluessel: keyof FilterWerte;
  label: string;
}

/**
 * Die gesetzten Filter als Beschriftungen — rein, damit die Aussage ohne Rendern prüfbar ist.
 *
 * Reihenfolge fest (Abschnitt · Träger · Status · Suche): eine Chip-Leiste, deren Einträge
 * je nach Setzreihenfolge springen, ist beim Ablesen unter Zeitdruck schlechter als keine.
 */
export function aktiveFilterChips(filter: FilterWerte, abschnittName: (id: number) => string): FilterChip[] {
  const chips: FilterChip[] = [];
  if (filter.abschnittId != null) {
    chips.push({ schluessel: 'abschnittId', label: `Abschnitt: ${abschnittName(filter.abschnittId)}` });
  }
  if (filter.traeger) chips.push({ schluessel: 'traeger', label: `Träger: ${filter.traeger}` });
  if (filter.kategorie) {
    const wert = KATEGORIE_WERTE.find((w) => w.value === filter.kategorie);
    chips.push({ schluessel: 'kategorie', label: `Status: ${wert?.text ?? filter.kategorie}` });
  }
  if (filter.suche.trim()) chips.push({ schluessel: 'suche', label: `Suche: „${filter.suche.trim()}"` });
  return chips;
}
```

Im Komponentenrumpf, direkt nach dem bestehenden `bild`-`useMemo`:

```tsx
  // Der BEZUGSWERT: dieselbe Rechnung über die UNGEFILTERTEN Rohlisten. Ohne ihn verschwindet
  // die Gesamtstärke des Einsatzes in dem Moment, in dem jemand einen Abschnitt anwählt —
  // und genau dann wird sie an die übergeordnete Führungsstelle gemeldet.
  const gesamt = useMemo(
    () => verdichte(personalQuery.data ?? [], fahrzeugeQuery.data ?? [], materialQuery.data ?? []),
    [personalQuery.data, fahrzeugeQuery.data, materialQuery.data],
  );

  const abschnittName = (id: number) =>
    (abschnitteQuery.data ?? []).find((a) => a.id === id)?.name ?? `Abschnitt ${id}`;
  const chips = aktiveFilterChips(filter, abschnittName);
  const gefiltert = chips.length > 0;
  const sichtbareKraefte = bild.verdichtung.anzahlPersonal + bild.verdichtung.anzahlFahrzeuge;
  const alleKraefte = gesamt.anzahlPersonal + gesamt.anzahlFahrzeuge;
```

Das `<Statistic title="Gesamtstärke (F/UF/M//Ges)" …>` (heute Z. 265) ersetzen:

```tsx
            <Statistic
              title={gefiltert ? 'Stärke (gefiltert, F/UF/M//Ges)' : 'Gesamtstärke (F/UF/M//Ges)'}
              value={staerkeText(v.staerke)}
            />
```

Und **innerhalb der Kopf-Card, über den Kennzahlen**, die Wahrheitszeile einfügen:

```tsx
        <div style={{ marginBlockEnd: abstand.md }}>
          <Space wrap align="center">
            <span style={{ color: token.colorTextSecondary }}>
              {sichtbareKraefte} von {alleKraefte} Kräften
            </span>
            {gefiltert && (
              <span style={{ color: token.colorTextTertiary }}>
                (ungefiltert {staerkeText(gesamt.staerke)})
              </span>
            )}
            {chips.map((chip) => (
              <Tag
                key={chip.schluessel}
                closable
                onClose={() => setFilter((f) => ({ ...f, [chip.schluessel]: LEERER_FILTER[chip.schluessel] }))}
              >
                {chip.label}
              </Tag>
            ))}
            {gefiltert && (
              <Button type="link" onClick={() => setFilter(LEERER_FILTER)}>
                Filter zurücksetzen
              </Button>
            )}
          </Space>
        </div>
```

Den `useState`-Startwert auf `LEERER_FILTER` umstellen (`useState<FilterWerte>(LEERER_FILTER)`). Import von `verdichte` aus `../kraefte/kraeftebild` ergänzen.

**Keine `size`-Prop** an `Tag` oder `Button` — die Dichte kommt vom `ConfigProvider`.

- [ ] **Step 4: Grün**

```bash
mise exec pnpm@11.10.0 -- pnpm -C /Users/rubeen/dev/personal/lifeline-hub/.claude/worktrees/dev-clickup-execution-eed38c/frontend vitest run src/pages/KraefteuebersichtPage.test.tsx
```

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/KraefteuebersichtPage.tsx frontend/src/pages/KraefteuebersichtPage.test.tsx && git commit -m "feat(lfh-338): beschriftet den Kopf ehrlich und führt den ungefilterten Bezugswert mit"
```

---

### Task 4: Druckkopf und Print-CSS

**Files:**
- Modify: `frontend/src/pages/KraefteuebersichtPage.tsx`
- Modify: `frontend/src/pages/kraefteuebersichtPrint.css`
- Test: `frontend/src/pages/KraefteuebersichtPage.test.tsx`

**Interfaces:**
- Consumes: `taktischeDtgVoll(utcStr)` aus `../anzeige/format` (Format `DDHHmm` + dt. Monatskürzel + `YYYY`, z. B. `111430AUG2026`), `benutzer.anzeigename` aus `useAuth()`, `aktiveFilterChips` aus Task 3, `einsatz.bezeichnung`.
- Produces: nichts für andere Tasks.

**Der Einsatznummer-Feldname wird nachgesehen, nicht geraten:** in `frontend/src/api/types.generated.ts` unter `EinsatzAnzeige` prüfen, ob es eine Nummer gibt (Kandidaten `einsatznummer`, `nummer`). Existiert keine, entfällt sie und der Kommentar hält fest, dass das DTO sie nicht führt — eine erfundene Nummer auf einem Meldeblatt ist schlimmer als keine.

- [ ] **Step 1: Failing tests**

```ts
describe('Druckkopf', () => {
  it('trägt Einsatzbezeichnung, taktischen Zeitstand und Ersteller', async () => {
    mitBaum();
    setup();
    const kopf = await screen.findByTestId('kraefte-druckkopf');
    expect(within(kopf).getByText(/Testeinsatz/)).toBeInTheDocument();
    // Taktische DTG: DDHHmm + drei Monatsbuchstaben + JJJJ
    expect(within(kopf).getByText(/Stand: \d{6}[A-ZÄÖÜ]{3}\d{4}/)).toBeInTheDocument();
  });

  it('nennt die Auswahl im Druckkopf, sobald gefiltert wird — und sonst nicht', async () => {
    mitBaum();
    setup();
    const kopf = await screen.findByTestId('kraefte-druckkopf');
    expect(within(kopf).queryByText(/^Auswahl:/)).toBeNull();

    fireEvent.mouseDown(screen.getByRole('combobox', { name: /Abschnitt/i }));
    fireEvent.click(await screen.findByTitle('Abschnitt Nord'));

    expect(await within(kopf).findByText(/Auswahl: Abschnitt: Abschnitt Nord/)).toBeInTheDocument();
  });

  it('wiederholt im Druck die Spaltenköpfe und bricht keine Zeile um', () => {
    const css = readFileSync(join(hier, 'kraefteuebersichtPrint.css'), 'utf-8');
    expect(css).toMatch(/thead\s*{[^}]*display:\s*table-header-group/);
    expect(css).toMatch(/tr\s*{[^}]*break-inside:\s*avoid/);
    // Der Druckkopf ist am Schirm unsichtbar und NUR im Druck sichtbar.
    expect(css).toMatch(/\.kraefte-nur-print\s*{[^}]*display:\s*none/);
  });
});
```

`hier` ist im Bestand der Datei bereits definiert (`dirname(fileURLToPath(import.meta.url))`, Z. 1–3) — nicht neu anlegen.

- [ ] **Step 2: Rot bestätigen**

```bash
mise exec pnpm@11.10.0 -- pnpm -C /Users/rubeen/dev/personal/lifeline-hub/.claude/worktrees/dev-clickup-execution-eed38c/frontend vitest run src/pages/KraefteuebersichtPage.test.tsx
```
Erwartet: FAIL — `kraefte-druckkopf` nicht gefunden, CSS-Regeln fehlen.

- [ ] **Step 3: Druckkopf rendern**

In `KraefteuebersichtPage.tsx` als **erstes Kind** innerhalb von `<EinsatzSeite>` (also direkt vor der Kopf-`Card`):

```tsx
      {/* NUR im Druck sichtbar (`display: none` am Schirm, Regel in kraefteuebersichtPrint.css).
          Bis LFH-338 stand die Einsatzbezeichnung ausschließlich in der Breadcrumb — und die
          trägt `.kraefte-no-print`. Das gedruckte Meldeblatt ging also ohne Einsatzbezug,
          ohne Zeitstand und ohne Angabe der Auswahl an die übergeordnete Führungsstelle. */}
      <div className="kraefte-nur-print" data-testid="kraefte-druckkopf">
        <div style={{ fontWeight: 600 }}>Kräfteübersicht — {einsatz.bezeichnung}</div>
        <div>Stand: {taktischeDtgVoll(new Date().toISOString())}</div>
        <div>Erstellt von: {benutzer?.anzeigename ?? '—'}</div>
        {chips.length > 0 && <div>Auswahl: {chips.map((c) => c.label).join(' · ')}</div>}
      </div>
```

`data-testid` ist nötig, weil der Knoten am Schirm per CSS versteckt ist und jsdom kein CSS auswertet — eine Textabfrage allein könnte den Schirm- und den Druckzweig nicht auseinanderhalten.

- [ ] **Step 4: Print-CSS ergänzen**

In `kraefteuebersichtPrint.css` **außerhalb** des `@media print`-Blocks, ganz oben:

```css
/* Nur im Druck sichtbar. Gegenstück zu `.kraefte-no-print`: der Ausdruck ist ein
   Meldeblatt, das ohne Einsatzbezug, Zeitstand und Angabe der Auswahl wertlos ist —
   am Schirm stehen dieselben Angaben in Breadcrumb und Kopfzeile. */
.kraefte-nur-print { display: none; }
```

**Innerhalb** von `@media print`, am Ende des Blocks:

```css
  .kraefte-nur-print { display: block !important; }

  /* Mehrseitige Bäume: Spaltenköpfe je Blatt, keine Zeile über den Blattrand.
     Beide Regeln sind für jsdom unsichtbar (`@media print` wird dort nicht
     ausgewertet) — geprüft wird deshalb der CSS-TEXT, wie beim Neutralisierer-Block. */
  .kraefte-print-root thead { display: table-header-group; }
  .kraefte-print-root tr { break-inside: avoid; }
```

- [ ] **Step 5: Grün**

```bash
mise exec pnpm@11.10.0 -- pnpm -C /Users/rubeen/dev/personal/lifeline-hub/.claude/worktrees/dev-clickup-execution-eed38c/frontend vitest run src/pages/KraefteuebersichtPage.test.tsx
```

- [ ] **Step 6: Commit**

```bash
git add frontend/src/pages/KraefteuebersichtPage.tsx frontend/src/pages/kraefteuebersichtPrint.css frontend/src/pages/KraefteuebersichtPage.test.tsx && git commit -m "feat(lfh-338): gibt dem Ausdruck Einsatzbezug, Zeitstand und Auswahl"
```

---

### Task 5: Monitoring-Kopf umbrechen statt scrollen

**Files:**
- Modify: `frontend/src/pages/KraefteuebersichtPage.tsx:260-310`
- Test: `frontend/src/pages/KraefteuebersichtPage.test.tsx`, `frontend/e2e/meldebild-tabelle.spec.ts`

**Interfaces:**
- Consumes: `verdichte`-Ergebnis (`v`), `rollenFarbe`, `statusKategorie`, `MAT_STATUS_ANZEIGE`.
- Produces: nichts für andere Tasks. `achsenTrenner()` entfällt ersatzlos (Row/Col trennt selbst) — die Funktion wird **gelöscht**, nicht verwaist stehen gelassen.

**Abweichung, die im Commit-Body steht:** Das AK nennt „950 px Inhaltsbreite". Der e2e misst bei Viewport **1024 × 768** (Führungs-Tablet), wo die Inhaltsbreite gemessen **unter** 950 px liegt. Wer bei weniger als 950 px nicht scrollt, scrollt bei 950 px erst recht nicht — die Aussage ist stärker als das AK und hängt nicht an einer Sidebar-Breite, die sich ändern kann. Die gemessene Breite wird im Test als Diagnose ausgegeben.

- [ ] **Step 1: Failing tests**

Vitest (prüft die Struktur, nicht das Layout — jsdom rechnet keines):

```ts
it('setzt den Monitoring-Kopf umbrechend statt in einen Horizontalscroll', async () => {
  mitBaum();
  const { container } = setup();
  await screen.findByText(/Gesamtstärke/);
  // antds Row bringt `.ant-row` mit; ein nicht umbrechender Space tut das nicht.
  expect(container.querySelector('.ant-row')).not.toBeNull();
});
```

Quelltext-Gate (an dieselbe `describe` wie die CSS-Prüfung, mit `readFileSync`):

```ts
it('trägt kein flexWrap: nowrap und keinen Card-internen Horizontalscroll mehr', () => {
  const quelle = readFileSync(join(hier, 'KraefteuebersichtPage.tsx'), 'utf-8');
  expect(quelle).not.toMatch(/flexWrap:\s*'nowrap'/);
  expect(quelle).not.toMatch(/overflowX:\s*'auto'/);
});
```

e2e in `frontend/e2e/meldebild-tabelle.spec.ts` (Helfer `anmelden`, `einsatzAnlegen`, `seedeKraefte`, Konstante `SUBPIXEL` sind vorhanden):

```ts
/** Führungs-Tablet — schmaler als der 13"-Fükw-Schirm des AK („950 px Inhaltsbreite").
 *  Bewusst der schärfere Fall: hält der Kopf hier, hält er auf dem Fükw erst recht. */
const FUEHRUNGSSCHIRM = { width: 1024, height: 768 };

test('Monitoring-Kopf der Kräfteübersicht bricht um statt waagerecht zu scrollen', async ({ page }) => {
  await page.setViewportSize(FUEHRUNGSSCHIRM);
  await anmelden(page);
  const einsatzId = await einsatzAnlegen(page, `LFH-338 Kopf ${Date.now()}`);
  await seedeKraefte(page, einsatzId, 4);
  await page.goto(`/einsaetze/${einsatzId}/kraefteuebersicht`);

  const kopf = page.locator('.ant-card').first();
  await expect(kopf.getByText(/Gesamtstärke/)).toBeVisible();

  const mass = await kopf.evaluate((el) => {
    const leib = el.querySelector('.ant-card-body')!;
    return { scrollWidth: leib.scrollWidth, clientWidth: leib.clientWidth };
  });
  expect(
    mass.scrollWidth,
    `Kopf scrollt waagerecht: ${mass.scrollWidth} > ${mass.clientWidth} (Inhaltsbreite ${mass.clientWidth} px)`,
  ).toBeLessThanOrEqual(mass.clientWidth + SUBPIXEL);
  expect(mass.clientWidth, 'Messung soll bei höchstens 950 px Inhaltsbreite laufen').toBeLessThanOrEqual(950);

  // Alle drei Achsen ohne Scrollen erreichbar.
  await expect(kopf.getByText(/Gesamtstärke/)).toBeInViewport();
  await expect(kopf.getByText('Fahrzeuge', { exact: true })).toBeInViewport();
  await expect(kopf.getByText(/Material \(Pos\.\)/)).toBeInViewport();
});
```

- [ ] **Step 2: Rot bestätigen**

```bash
mise exec pnpm@11.10.0 -- pnpm -C /Users/rubeen/dev/personal/lifeline-hub/.claude/worktrees/dev-clickup-execution-eed38c/frontend vitest run src/pages/KraefteuebersichtPage.test.tsx
```
Erwartet: FAIL bei beiden neuen Vitest-Fällen.

- [ ] **Step 3: Kopf umbauen**

`Row`/`Col` zum antd-Import ergänzen, `Statistic` bleibt. Die Kopf-`Card` ersetzen (heute Z. 260–310):

```tsx
      <Card style={{ marginBottom: abstand.lg }}>
        {/* Wahrheitszeile aus Task 3 steht hier drüber, unverändert. */}

        {/* UMBRECHEND statt scrollend (LFH-338 · C3): bis dahin lagen bis zu 12 Kennzahlen
            in einem `Space` mit `flexWrap: 'nowrap'` hinter einem Card-internen
            `overflowX: 'auto'` — auf einem 13"-Fükw-Schirm lag die komplette Materialachse
            unsichtbar rechts, ohne jede optische Andeutung. Innerhalb einer Achse wird jetzt
            kompakt gesetzt (eine Zeile je Statusachse) statt vier gleich großer `Statistic`. */}
        <Row gutter={[abstand.lg, abstand.md]}>
          <Col xs={24} md={12} xl={8}>
            <Statistic
              title={gefiltert ? 'Stärke (gefiltert, F/UF/M//Ges)' : 'Gesamtstärke (F/UF/M//Ges)'}
              value={staerkeText(v.staerke)}
            />
            <div style={{ color: token.colorTextSecondary, marginBlockStart: token.marginXXS }}>
              Personal {v.anzahlPersonal}
            </div>
          </Col>

          <Col xs={24} md={12} xl={8}>
            <Statistic title="Fahrzeuge" value={v.anzahlFahrzeuge} />
            {/* Farbe ist der ZWEITE Kanal, nicht der einzige: jede Zahl trägt ihr Wort
                daneben (WCAG 1.4.1). Rollen wie in der Statusspalte der Tabelle. */}
            <Space size="small" wrap style={{ marginBlockStart: token.marginXXS }}>
              <span style={{ color: rollenFarbe(statusKategorie.verfuegbar.rolle, token) }}>
                {v.fahrzeugStatus.verfuegbar} frei
              </span>
              <span aria-hidden>·</span>
              <span style={{ color: rollenFarbe(statusKategorie.gebunden.rolle, token) }}>
                {v.fahrzeugStatus.gebunden} gebunden
              </span>
              <span aria-hidden>·</span>
              <span style={{ color: rollenFarbe(statusKategorie.nicht_verfuegbar.rolle, token) }}>
                {v.fahrzeugStatus.nicht_verfuegbar} n. einsatzbereit
              </span>
            </Space>
          </Col>

          <Col xs={24} md={12} xl={8}>
            <Statistic title="Material (Pos.)" value={v.anzahlMaterialPositionen} />
            <Space size="small" wrap style={{ marginBlockStart: token.marginXXS }}>
              {MAT_STATUS_ANZEIGE.filter(({ key }) => v.materialStatus[key] > 0).map(({ key, label, rolle }) => (
                <span key={key} style={rolle ? { color: rollenFarbe(rolle, token) } : undefined}>
                  {v.materialStatus[key]} {label.replace('Mtl. ', '')}
                </span>
              ))}
            </Space>
          </Col>
        </Row>
      </Card>
```

`achsenTrenner()` samt seines Kopfkommentars löschen und den `GlobalToken`-Typimport entfernen, falls er danach ungenutzt ist (`--max-warnings 0` meldet das sonst).

`Space size="small"` ist hier **kein** Verstoß gegen die Dichte-Regel: `Space` ist keine interaktive Fläche, `size` ist dort ein Abstandsmaß — genau die Trennung, aus der `dichte.guard.test.ts` `Card`/`Descriptions`/`Space` heraushält. Zur Sicherheit den Guard mitlaufen lassen (Step 4).

- [ ] **Step 4: Grün, inklusive Dichte-Guard**

```bash
mise exec pnpm@11.10.0 -- pnpm -C /Users/rubeen/dev/personal/lifeline-hub/.claude/worktrees/dev-clickup-execution-eed38c/frontend vitest run src/pages/KraefteuebersichtPage.test.tsx src/components/dichte.guard.test.ts src/components/datensicht.guard.test.ts
```

Und das Ticket-Gate wörtlich:

```bash
grep -c "flexWrap: 'nowrap'" frontend/src/pages/KraefteuebersichtPage.tsx
```
Erwartet: `0` (grep endet mit Exit 1 — das ist hier der Erfolgsfall).

- [ ] **Step 5: e2e laufen lassen**

Setzt ein gebautes Backend voraus (`target/debug/lifeline-hub`); sonst vorher `cargo build`.

```bash
mise exec pnpm@11.10.0 -- pnpm -C /Users/rubeen/dev/personal/lifeline-hub/.claude/worktrees/dev-clickup-execution-eed38c/frontend e2e meldebild-tabelle
```
Erwartet: der neue Fall grün. Bei Fehlschlag zeigt die Diagnose-Meldung die gemessene Inhaltsbreite — **erst messen, dann ändern**.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/pages/KraefteuebersichtPage.tsx frontend/src/pages/KraefteuebersichtPage.test.tsx frontend/e2e/meldebild-tabelle.spec.ts && git commit -m "feat(lfh-338): lässt den Monitoring-Kopf umbrechen statt waagerecht zu scrollen"
```

---

### Task 6: Aufgeklappt starten, ganze Zeile als Trefferziel

**Files:**
- Modify: `frontend/src/components/Datensicht.tsx` (`BaumSicht`-Typ ~Z. 278, `pruefeKartenplan` ~Z. 578-630, `expandable` ~Z. 1215)
- Modify: `frontend/src/pages/KraefteuebersichtPage.tsx`
- Test: `frontend/src/components/Datensicht.test.tsx`, `frontend/src/pages/KraefteuebersichtPage.test.tsx`

**Interfaces:**
- Consumes: `alleKeys(zeilen)` (bereits in `KraefteuebersichtPage.tsx:146`, bisher nur von `handleDrucken` genutzt).
- Produces: `Datensicht` klappt im Baum-Zweig bei Klick auf die **Zeile** auf/zu; `baum` und `onZeileKlick` schließen sich aus (neuer Befund in `pruefeKartenplan`).

- [ ] **Step 1: Failing tests im Primitiv**

An `frontend/src/components/Datensicht.test.tsx` anhängen (Baum-Fixture der Datei wiederverwenden, sonst nach dem Muster der bestehenden Baum-Tests bauen):

```ts
it('klappt eine Baumzeile beim Klick auf die ZEILE auf, nicht nur am Symbol', async () => {
  const onAufgeklappt = vi.fn();
  renderMitProviders(
    <Datensicht
      bezeichnung="Baum"
      form="tabelle"
      spalten={baumSpalten}
      daten={baumDaten}
      zeilenSchluessel="key"
      baum={{ kinder: 'children', aufgeklappt: [], onAufgeklappt }}
      karte={{ art: 'plan', titel: { spalte: 'bez' } }}
    />,
  );
  // Auf die TEXTZELLE klicken, nicht auf `.ant-table-row-expand-icon`.
  await userEvent.click(screen.getByText('Wurzel'));
  expect(onAufgeklappt).toHaveBeenCalledWith(['w1']);
});

it('meldet baum zusammen mit onZeileKlick als Kartenplan-Befund', () => {
  const befunde = pruefeKartenplan({
    bezeichnung: 'Baum',
    spalten: baumSpalten,
    karte: { art: 'plan', titel: { spalte: 'bez' } },
    baum: { kinder: 'children', aufgeklappt: [], onAufgeklappt: () => {} },
    onZeileKlick: () => {},
  } as never);
  expect(befunde.join(' ')).toMatch(/onZeileKlick und baum schließen sich aus/);
});
```

Vor dem Schreiben: den **echten** Namen und die **echte** Signatur von `pruefeKartenplan` in `Datensicht.tsx` (~Z. 578) nachlesen und den Aufruf daran anpassen; das `Pick<>`-Argument muss um `onZeileKlick` erweitert werden.

- [ ] **Step 2: Rot bestätigen**

```bash
mise exec pnpm@11.10.0 -- pnpm -C /Users/rubeen/dev/personal/lifeline-hub/.claude/worktrees/dev-clickup-execution-eed38c/frontend vitest run src/components/Datensicht.test.tsx
```

- [ ] **Step 3: Primitiv verdrahten**

In `Datensicht.tsx` am `expandable`-Ausdruck (Z. 1215–1224):

```tsx
      expandable={
        baum
          ? {
              childrenColumnName: baum.kinder,
              expandedRowKeys: [...baum.aufgeklappt],
              onExpandedRowsChange: (schluessel) => baum.onAufgeklappt([...schluessel]),
              // Die ganze Zeile ist das Trefferziel, nicht das ~16 px breite Symbol
              // (LFH-338 · C3, Dichte-Politik aus B5). Deshalb schließen sich `baum` und
              // `onZeileKlick` aus: sonst wäre der Zeilenklick doppelt belegt und welche
              // Wirkung einträte, hinge an der Reihenfolge im DOM.
              expandRowByClick: true,
            }
          : aufklappzeile
            ? { expandedRowRender: (zeile) => aufklappzeile(zeile) }
            : undefined
      }
```

Im `Pick<>` der `pruefeKartenplan`-Signatur `'onZeileKlick'` ergänzen, die Destrukturierung erweitern und im `if (baum) { … }`-Zweig neben den vorhandenen Befunden ergänzen:

```ts
    if (onZeileKlick) befunde.push('onZeileKlick und baum schließen sich aus.');
```

Die Aufrufstelle des `useMemo` (~Z. 991) um `onZeileKlick` in Objekt **und** Dependency-Array erweitern — sonst meldet `react-hooks/exhaustive-deps` unter `--max-warnings 0`.

- [ ] **Step 4: Failing test auf der Seite**

An `KraefteuebersichtPage.test.tsx`:

```ts
it('startet aufgeklappt, sobald der erste Baum geladen ist', async () => {
  mitBaum();
  setup();
  // Abschnitt → Einheit → Fahrzeug: die tiefste Zeile ist ohne Zutun sichtbar.
  expect(await screen.findByText('FW 1/44-1')).toBeInTheDocument();
});

it('klappt „Nur Abschnitte" auf die oberste Ebene zurück und wieder auf', async () => {
  mitBaum();
  setup();
  await screen.findByText('FW 1/44-1');

  fireEvent.click(screen.getByRole('radio', { name: 'Nur Abschnitte' }));
  await waitFor(() => expect(screen.queryByText('FW 1/44-1')).toBeNull());
  expect(screen.getByText('Abschnitt Nord')).toBeInTheDocument();

  fireEvent.click(screen.getByRole('radio', { name: 'Alles aufklappen' }));
  expect(await screen.findByText('FW 1/44-1')).toBeInTheDocument();
});
```

Die Rolle des `Segmented`-Eintrags vor dem Festschreiben in antd 6 nachmessen (`screen.debug()` oder `logRoles`) — trägt es `radio`, bleibt der Test; trägt es `option`/`button`, wird die Abfrage angepasst, **nicht** die Komponente.

- [ ] **Step 5: Seite umbauen**

Importe: `Segmented` aus antd, `useRef` aus react.

```tsx
  // Aufgeklappt starten — EINMAL, beim ersten geladenen Baum. Ein Effekt ohne Riegel
  // klappte jede vom Benutzer zugeklappte Zeile bei der nächsten SSE-Invalidierung wieder
  // auf; das Meldeblatt startete bis LFH-338 vollständig ZUgeklappt, was die Verdichtung,
  // für die es existiert, hinter n Klicks legte.
  const initialAufgeklappt = useRef(false);
  useEffect(() => {
    if (initialAufgeklappt.current || bild.baum.length === 0) return;
    initialAufgeklappt.current = true;
    setExpandedKeys(alleKeys(bild.baum));
  }, [bild.baum]);
```

In den `aktionen`-Slot, **vor** die vorhandenen Knöpfe:

```tsx
            <Segmented
              value={expandedKeys.length > 0 ? 'alle' : 'abschnitte'}
              onChange={(wert) =>
                setExpandedKeys(wert === 'alle' ? alleKeys(bild.baum) : [])
              }
              options={[
                { value: 'alle', label: 'Alles aufklappen' },
                { value: 'abschnitte', label: 'Nur Abschnitte' },
              ]}
            />
```

Keine `size`-Prop am `Segmented`.

- [ ] **Step 6: Grün**

```bash
mise exec pnpm@11.10.0 -- pnpm -C /Users/rubeen/dev/personal/lifeline-hub/.claude/worktrees/dev-clickup-execution-eed38c/frontend vitest run src/components/ src/pages/KraefteuebersichtPage.test.tsx
```
Erwartet: PASS, **inklusive** aller Bestands-Guards von `Datensicht` (54 KB `datensicht.guard.test.ts`, 31 KB `katalogTabelle.guard.test.ts`). Bricht dort etwas, ist die Ursache das neue `expandRowByClick` — dann erst lesen, was der Guard zusichert, bevor irgendetwas angepasst wird.

- [ ] **Step 7: e2e gegenprüfen**

`meldebild-tabelle.spec.ts` klickt in Nachweis 1 gezielt auf `.ant-table-row-expand-icon`. Mit `expandRowByClick` bleibt dieser Weg gültig, aber der Zustand nach dem Klick kann sich unterscheiden.

```bash
mise exec pnpm@11.10.0 -- pnpm -C /Users/rubeen/dev/personal/lifeline-hub/.claude/worktrees/dev-clickup-execution-eed38c/frontend e2e meldebild-tabelle
```

- [ ] **Step 8: Commit**

```bash
git add frontend/src/components/Datensicht.tsx frontend/src/components/Datensicht.test.tsx frontend/src/pages/KraefteuebersichtPage.tsx frontend/src/pages/KraefteuebersichtPage.test.tsx && git commit -m "feat(lfh-338): startet das Meldebild aufgeklappt und macht die Zeile zum Trefferziel"
```

---

### Task 7: Verdichtungszeile auf den vier Kräfte-Modulseiten

**Files:**
- Create: `frontend/src/kraefte/Verdichtungszeile.tsx`
- Create: `frontend/src/kraefte/Verdichtungszeile.test.tsx`
- Modify: `frontend/src/pages/FahrzeugePage.tsx`, `PersonalPage.tsx`, `MaterialPage.tsx`, `EinheitenPage.tsx`
- Modify: die vier zugehörigen `*.test.tsx`

**Interfaces:**
- Consumes: `verdichte()` (Task 1), `kraefteuebersichtPfad()` (Task 2), `staerkeText`, `einsatzKeys.personal`/`.fahrzeuge`, `listeEinsatzPersonal`, `listeEinsatzFahrzeuge`, `rollenFarbe`, `statusKategorie`.
- Produces: `export default function Verdichtungszeile({ einsatzId }: { einsatzId: number })`.

**Warum die Komponente ihre Daten selbst lädt:** Von den vier Seiten führt heute nur `EinheitenPage` alle nötigen Listen; `MaterialPage` führt weder Personal noch Fahrzeuge, `FahrzeugePage` kein Material. Die Alternative wäre, jeder Seite 1–3 Queries zu verpassen und die Zeile über Props zu füttern — vier Mal dieselbe Verdrahtung. Die Komponente lädt deshalb selbst, nach dem Muster der Dashboard-Kacheln (`LageDashboardPage.tsx:15` „jede Kachel hängt an ihren eigenen Queries"). Da sie **dieselben** `einsatzKeys` nutzt, dedupliziert TanStack Query den Abruf gegen die schon laufende Query der Seite — kein zweiter Netzabruf, wo die Seite die Liste bereits hält.

**Sie lädt nur Personal und Fahrzeuge, kein Material:** die Zeile zeigt Σ-Stärke und Fahrzeugverfügbarkeit; `verdichte()` nimmt Material als dritten Parameter und bekommt `[]`. Das hält die Zahl der neuen MSW-Handler in den vier Testdateien bei höchstens zwei je Datei.

- [ ] **Step 1: Failing tests der Komponente**

`frontend/src/kraefte/Verdichtungszeile.test.tsx` neu:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import { Routes, Route } from 'react-router';
import { renderMitProviders } from '../test/utils';
import Verdichtungszeile from './Verdichtungszeile';
import { listeEinsatzPersonal } from '../api/einsatzPersonal';
import { listeEinsatzFahrzeuge } from '../api/einsatzFahrzeuge';

vi.mock('../api/einsatzPersonal', () => ({ listeEinsatzPersonal: vi.fn() }));
vi.mock('../api/einsatzFahrzeuge', () => ({ listeEinsatzFahrzeuge: vi.fn() }));

beforeEach(() => {
  vi.mocked(listeEinsatzPersonal).mockResolvedValue([]);
  vi.mocked(listeEinsatzFahrzeuge).mockResolvedValue([]);
});

function setup() {
  return renderMitProviders(
    <Routes>
      <Route path="/einsaetze/:id/fahrzeuge" element={<Verdichtungszeile einsatzId={1} />} />
    </Routes>,
    { route: '/einsaetze/1/fahrzeuge' },
  );
}

describe('Verdichtungszeile', () => {
  it('zeigt Stärke und Fahrzeugverfügbarkeit und verlinkt auf die Kräfteübersicht', async () => {
    vi.mocked(listeEinsatzPersonal).mockResolvedValue([
      { staerke_position: 'fuehrer', status_kategorie: 'gebunden' },
      { staerke_position: 'mannschaft', status_kategorie: 'gebunden' },
    ] as never);
    vi.mocked(listeEinsatzFahrzeuge).mockResolvedValue([
      { status_kategorie: 'verfuegbar' },
      { status_kategorie: 'gebunden' },
    ] as never);
    setup();

    expect(await screen.findByText('1/0/1//2')).toBeInTheDocument();
    expect(screen.getByText(/1 frei/)).toBeInTheDocument();
    expect(screen.getByText(/1 gebunden/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Kräfteübersicht/ })).toHaveAttribute(
      'href',
      '/einsaetze/1/kraefteuebersicht',
    );
  });

  it('bleibt bei gescheitertem Abruf stumm statt eine Null zu behaupten', async () => {
    vi.mocked(listeEinsatzFahrzeuge).mockRejectedValue(new Error('kaputt'));
    const { container } = setup();
    // Kein „0/0/0//0" — eine erfundene Nullstärke auf einer Führungsfläche ist schlimmer
    // als keine Angabe.
    await new Promise((r) => setTimeout(r, 0));
    expect(container.textContent).not.toContain('0/0/0//0');
  });
});
```

- [ ] **Step 2: Rot bestätigen**

```bash
mise exec pnpm@11.10.0 -- pnpm -C /Users/rubeen/dev/personal/lifeline-hub/.claude/worktrees/dev-clickup-execution-eed38c/frontend vitest run src/kraefte/Verdichtungszeile.test.tsx
```

- [ ] **Step 3: Komponente schreiben**

`frontend/src/kraefte/Verdichtungszeile.tsx`:

```tsx
import { Space, theme } from 'antd';
import { Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { einsatzKeys } from '../api/queryKeys';
import { listeEinsatzPersonal } from '../api/einsatzPersonal';
import { listeEinsatzFahrzeuge } from '../api/einsatzFahrzeuge';
import { kraefteuebersichtPfad } from '../routing/deeplinks';
import { rollenFarbe, statusKategorie } from '../theme/statusFarben';
import { staerkeText, verdichte } from './kraeftebild';

/**
 * Die Führungsantwort im Kopf einer Kräfte-Modulseite — Σ-Stärke und Fahrzeugverfügbarkeit,
 * verlinkt auf das volle Meldebild (LFH-338 · C3, Befund H21: keine der vier Kräfte-Modulseiten
 * verlinkte die aggregierende Übersicht).
 *
 * LÄDT SELBST, nach dem Muster der Lage-Dashboard-Kacheln: von den vier Seiten führt nur
 * `EinheitenPage` beide Listen, `MaterialPage` führt keine. Über dieselben `einsatzKeys`
 * dedupliziert TanStack den Abruf gegen die Query der Seite — wo die Liste schon da ist,
 * entsteht kein zweiter Netzabruf.
 *
 * KEIN Materialabruf: die Zeile beantwortet „welche Kräfte habe ich", nicht „welches Gerät".
 * `verdichte` bekommt deshalb eine leere Materialliste.
 *
 * STUMM BEI FEHLER — bewusst kein Nullwert: „0/0/0//0" auf einer Führungsfläche liest sich
 * wie eine Meldung und ist keine.
 */
export default function Verdichtungszeile({ einsatzId }: { einsatzId: number }) {
  const { token } = theme.useToken();
  const personalQuery = useQuery({
    queryKey: einsatzKeys.personal(einsatzId),
    queryFn: () => listeEinsatzPersonal(einsatzId),
  });
  const fahrzeugeQuery = useQuery({
    queryKey: einsatzKeys.fahrzeuge(einsatzId),
    queryFn: () => listeEinsatzFahrzeuge(einsatzId),
  });

  if (personalQuery.isError || fahrzeugeQuery.isError) return null;
  if (!personalQuery.data || !fahrzeugeQuery.data) return null;

  const v = verdichte(personalQuery.data, fahrzeugeQuery.data, []);
  return (
    <Space wrap align="center" style={{ marginBlockEnd: token.margin }}>
      <span style={{ color: token.colorTextSecondary }}>Stärke</span>
      <strong>{staerkeText(v.staerke)}</strong>
      <span aria-hidden>·</span>
      <span style={{ color: token.colorTextSecondary }}>Fzg {v.anzahlFahrzeuge}</span>
      <span style={{ color: rollenFarbe(statusKategorie.verfuegbar.rolle, token) }}>
        {v.fahrzeugStatus.verfuegbar} frei
      </span>
      <span style={{ color: rollenFarbe(statusKategorie.gebunden.rolle, token) }}>
        {v.fahrzeugStatus.gebunden} gebunden
      </span>
      <span style={{ color: rollenFarbe(statusKategorie.nicht_verfuegbar.rolle, token) }}>
        {v.fahrzeugStatus.nicht_verfuegbar} n. verf.
      </span>
      <Link to={kraefteuebersichtPfad(einsatzId)}>Kräfteübersicht</Link>
    </Space>
  );
}
```

- [ ] **Step 4: Grün**

```bash
mise exec pnpm@11.10.0 -- pnpm -C /Users/rubeen/dev/personal/lifeline-hub/.claude/worktrees/dev-clickup-execution-eed38c/frontend vitest run src/kraefte/Verdichtungszeile.test.tsx
```

- [ ] **Step 5: Auf allen vier Seiten einhängen**

In jeder der vier Seiten `import Verdichtungszeile from '../kraefte/Verdichtungszeile';` ergänzen und die Zeile **unmittelbar über** dem `<Datensicht …>` bzw. der Haupttabelle rendern:

```tsx
      <Verdichtungszeile einsatzId={einsatzId} />
```

Stellen (heutiger Stand): `FahrzeugePage.tsx:569`, `PersonalPage.tsx:482`, `MaterialPage.tsx:374`, `EinheitenPage.tsx` — dort liegt die Tabelle in der Detailspalte; die Zeile gehört über den Einheitenbaum, oberhalb von Z. 318.

**`kraefteuebersichtPfad` wird in den vier Seiten nicht importiert** — die Komponente besitzt den Pfad. Das AK verlangt `grep -rc 'kraefteuebersichtPfad' …` = je 1 pro Seite; das ist mit dieser Aufteilung **nicht** erfüllt. Deshalb: in jeder der vier Seiten zusätzlich ein sekundärer Kopf-Link mit dem Builder, dort wo die Seite ihre Aktionen führt:

- `FahrzeugePage.tsx:504` und `PersonalPage.tsx:417` haben einen `aktionen`-Slot von `EinsatzSeite` — dort einhängen:

```tsx
            <Link to={kraefteuebersichtPfad(einsatzId)}>Kräfteübersicht</Link>
```

- `MaterialPage.tsx` und `EinheitenPage.tsx` nutzen **kein** `EinsatzSeite` (gemessen: kein Treffer). Dort steht der Link in derselben Zeile wie die Verdichtungszeile, direkt darüber, nach demselben Muster — **keine** Umstellung dieser beiden Seiten auf `EinsatzSeite`; das ist ein eigener Umbau und gehört nicht in dieses Ticket.

Danach genau nachzählen:

```bash
grep -c 'kraefteuebersichtPfad' frontend/src/pages/FahrzeugePage.tsx frontend/src/pages/PersonalPage.tsx frontend/src/pages/MaterialPage.tsx frontend/src/pages/EinheitenPage.tsx
```
Erwartet: **je 1**. Steht irgendwo 2, ist der Pfad zweimal berechnet — dann in eine lokale Konstante ziehen. Steht 0, fehlt der Link.

Und die Gegenprobe auf Inline-Literale:

```bash
grep -rn "'/einsaetze/.*kraefteuebersicht\|\`/einsaetze/.*kraefteuebersicht" frontend/src --include='*.tsx' --include='*.ts' | grep -v deeplinks
```
Erwartet: keine Treffer außerhalb von `deeplinks.ts` und den Testdateien.

- [ ] **Step 6: MSW-Handler in den vier Seitentests nachziehen**

`src/test/setup.ts:94` fährt `onUnhandledRequest: 'error'` — jeder neue Abruf ohne Handler bricht die Tests der Seite. Pro Testdatei in **jedem** `server.use(...)`-Setup-Block ergänzen, was dort noch fehlt:

```ts
    http.get('/api/einsaetze/1/personal', () => HttpResponse.json([])),
    http.get('/api/einsaetze/1/fahrzeuge', () => HttpResponse.json([])),
```

Bestand (gemessen): `MaterialPage` braucht **beide**, `FahrzeugePage` nur `personal` fehlt nicht (führt beide bereits), `PersonalPage` und `EinheitenPage` führen beide bereits — dort ist nur zu prüfen, ob jeder Setup-Block sie hat, nicht nur der erste. Die genauen Pfade aus `api/einsatzPersonal.ts` bzw. `api/einsatzFahrzeuge.ts` ablesen, nicht raten.

Je Seite einen Nachweis für den Link ergänzen, z. B. in `MaterialPage.test.tsx`:

```ts
it('verlinkt die Kräfteübersicht', async () => {
  zeige();
  const links = await screen.findAllByRole('link', { name: /Kräfteübersicht/ });
  expect(links[0]).toHaveAttribute('href', '/einsaetze/1/kraefteuebersicht');
});
```

`findAllByRole` statt `findByRole`: die Verdichtungszeile **und** der Kopf-Link tragen beide diesen Namen. Wer hier `findByRole` schreibt, bekommt „found multiple elements" und hält es fälschlich für einen Fehler der Seite.

- [ ] **Step 7: Alle betroffenen Suiten grün**

```bash
mise exec pnpm@11.10.0 -- pnpm -C /Users/rubeen/dev/personal/lifeline-hub/.claude/worktrees/dev-clickup-execution-eed38c/frontend vitest run src/kraefte/ src/pages/FahrzeugePage.test.tsx src/pages/PersonalPage.test.tsx src/pages/MaterialPage.test.tsx src/pages/EinheitenPage.test.tsx
```

- [ ] **Step 8: Commit**

```bash
git add frontend/src/kraefte/Verdichtungszeile.tsx frontend/src/kraefte/Verdichtungszeile.test.tsx frontend/src/pages/FahrzeugePage.tsx frontend/src/pages/PersonalPage.tsx frontend/src/pages/MaterialPage.tsx frontend/src/pages/EinheitenPage.tsx frontend/src/pages/FahrzeugePage.test.tsx frontend/src/pages/PersonalPage.test.tsx frontend/src/pages/MaterialPage.test.tsx frontend/src/pages/EinheitenPage.test.tsx && git commit -m "feat(lfh-338): führt die Verdichtung im Kopf der vier Kräfte-Modulseiten"
```

---

### Task 8: Prüfliste Einsatztauglichkeit + volles Gate

Ein Modul-Task ohne ausgefüllte Prüfliste gilt laut CLAUDE.md nicht als fertig.

**Files:**
- Create: `docs/superpowers/pruefliste/2026-08-11-lfh-338-kraefteuebersicht.md`

- [ ] **Step 1: Vorlage finden**

```bash
rtk ls docs/superpowers/ && rtk grep -rln "Prüfliste Einsatztauglichkeit" docs/
```
Die zuletzt ausgefüllte Prüfliste als Muster nehmen (Format, Kriterienreihenfolge, Verdikt-Wortlaut) — **nicht** aus dem Kopf nachbauen.

- [ ] **Step 2: Alle 15 Kriterien mit Verdikt füllen**

Je Zeile genau eines von: `erfüllt` (mit dem Beleg — Testname oder Datei:Zeile) · `offen → <Ticketnummer>` · `nicht anwendbar` (mit Grund). „nicht geprüft" ist kein Verdikt.

- [ ] **Step 3: Volles Gate**

```bash
./scripts/check-all.sh
```
Läuft alle sieben Schritte. **Kein `| tail`** — das maskiert den Exit-Code.

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/pruefliste/ && git commit -m "docs(lfh-338): füllt die Prüfliste Einsatztauglichkeit für die Kräfteübersicht"
```

---

## Selbstprüfung gegen das Ticket

| AK aus LFH-338 | Task |
|---|---|
| Kopftitel bei Filter nicht „Gesamtstärke", „X von Y Kräften", Zurücksetzen leert alle vier | 3 |
| Druckkopf mit Bezeichnung + `taktischeDtgVoll`-Stand, bei Filter „Auswahl: …" | 4 |
| `thead`/`tr`-Regeln im Print-CSS | 4 |
| e2e 950 px: `scrollWidth <= clientWidth`, drei Achsen sichtbar, `flexWrap: 'nowrap'` = 0 | 5 |
| `expandedKeys` nach erstem Baum nicht leer; Klick auf die Zeile klappt um | 6 |
| `kraefteuebersichtPfad` existiert, je 1 Treffer in vier Seiten, 0 Inline-Literale | 2 + 7 |
| Verdichtungszeile über der Tabelle der vier Modulseiten | 7 |
| `./scripts/check-all.sh` grün, `pnpm lint --max-warnings 0` grün | 8 |

**Bewusst nicht enthalten:** eine Umstellung von `MaterialPage`/`EinheitenPage` auf `EinsatzSeite` (eigener Umbau, nicht im Ticket) und ein Kontrastnachweis der Kopf-Farbwerte (jsdom rechnet keine Farbmischung; der offene Playwright-Nachweis gehört zu LFH-370/B5j).
