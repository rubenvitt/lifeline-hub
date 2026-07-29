## Korrektur der Akzeptanzkriterien — gemessen am gelieferten Code

Stand `fc48f60` (Branch `feat/lfh-330-einsatzlisten-primitive`), Ausgangslage gemessen an
`a06cd0f` (Merge B1). Alle Zahlen unten sind **nachgemessen**, nicht aus dem Ticket
übernommen; wo die Messung dem Ticket widerspricht, steht das ausdrücklich dabei.

Fünf der sieben Akzeptanzkriterien messen am gelieferten Code **nicht das, was sie behaupten** —
teils weil ihre Formel etwas anderes trifft als gemeint, teils weil das Ziel-Design sie
unerfüllbar macht, teils weil sie strukturell nicht rot werden können. Für jedes steht unten
eine Ersatzformulierung, die entweder ein **Kommando mit erwarteter Ausgabe** oder einen
**benannten Test** nennt. Zwei Arbeitspunkte widersprechen der Leitlinie, die dieses Ticket
selbst geschrieben hat; sie werden am Schluss aufgelöst.

---

### AK (a) — „Jede genannte Tabellen-Datei nutzt `Datensicht`/`KatalogTabelle` oder trägt `scroll={{ x: 'max-content' }}`"

**Ist-Formulierung**

> `grep -rL "scroll={{" $(grep -rl "<Table" --include="*.tsx" frontend/src | grep -v .test.)`
> listet keine der genannten Dateien mehr (Ausgangslage: 29 von 30 ohne `scroll`).

**Warum sie am gelieferten Code nicht misst**

Zwei unabhängige Fehler, beide reproduziert:

1. **`<Table` trifft als Teilstring.** Die innere `grep` sucht ohne Wortgrenze und trifft
   deshalb auch Typreferenzen. Gemessen an `fc48f60` liefert sie drei Dateien:

   ```
   frontend/src/components/Datensicht.tsx      ← useMemo<TableColumnsType<T>>(   (:1107)
   frontend/src/components/KatalogTabelle.tsx  ← Omit<TableProps<T>, …>          (:52)
   frontend/src/pages/gefahren/GefahrenMatrix.tsx
   ```

   `Datensicht.tsx` enthält **kein** Tabellenelement — es reicht seinen Tabellenzweig an
   `KatalogTabelle` weiter und setzt deshalb bewusst kein eigenes `scroll`-Prop. Die volle
   Ticket-Formel meldet es trotzdem als Verstoß:

   ```
   $ grep -rL "scroll={{" $(grep -rl "<Table" --include="*.tsx" frontend/src | grep -v .test.)
   frontend/src/components/Datensicht.tsx
   ```

   Das Kriterium ist also **rot, obwohl es erfüllt ist** — und die einzige Möglichkeit, es
   grün zu bekommen, wäre ein überflüssiges zweites `scroll` im Primitiv, das die Regel
   „nur das Primitiv setzt den Bildlaufcontainer" bräche.

2. **Läuft die innere `grep` leer, rekursiert die äußere über das ganze Repo.** `grep -rL`
   ohne Datei-Operand nimmt das Arbeitsverzeichnis. Gemessen an einem Wegwerf-Baum:

   ```
   $ grep -rL "scroll={{" $(grep -rl "<Table" --include="*.tsx" . | grep -v .test.)
   ./unter/b.txt
   ./a.txt
   ```

   Genau der Erfolgsfall (keine rohen Tabellen mehr) macht das Kriterium also zu einer
   Ausgabe über jede Textdatei des Repos.

**Zur Ausgangslage „29 von 30":** die Zahl war nicht falsch, sie ist **vor-B3 gezählt** — damals
trugen die dreizehn Katalog-Tabs ihr Tabellenelement noch selbst. Nach B3/B1 sind es an
`a06cd0f` **17 Dateien mit 18 rohen Tabellenstellen** (`PersonenPage.tsx` 2×), davon **15 ohne
`scroll`** (mit: `components/KatalogTabelle.tsx`, `pages/gefahren/GefahrenMatrix.tsx`).
17 + 13 = 30 — die Rechnung geht auf.

**Ersatzformulierung**

*Primäre Zusicherung (maschinell, das ist die eigentliche Durchsetzung):*

- `frontend/src/components/katalogTabelle.guard.test.ts`
  - `it('außerhalb des Primitivs und der Ausnahmen gibt es kein rohes antd-Tabellenelement')`
    — repoweite Schließung über den ganzen `src/`-Korpus, mit Kommentar-Stripper,
    Sentinel-Fall und Totmeldung freigestellter Einträge.
  - `it('nur das Primitiv setzt den waagerechten Scrollcontainer')`
  - `it('alle 19 Tabellen laufen über das Primitiv')` — Inventar `KATALOGE` (13) +
    `UEBERLAUF_NACHZUG` (6).

*Illustrierendes Kommando (positiv formuliert, mit Wortgrenze), Sollergebnis **genau zwei
Zeilen**:*

```bash
rg -n '<Table\b' frontend/src -g '*.tsx' -g '!*.test.*'
# ohne ripgrep (BSD/GNU grep; in fish über `bash -c '…'` fahren, dort bricht
# `--include='*.tsx'` an der Glob-Auflösung):
grep -rnE '<Table([^A-Za-z]|$)' --include='*.tsx' frontend/src | grep -v '\.test\.'
```

Erwartete Ausgabe an `fc48f60`, unverändert:

```
frontend/src/components/KatalogTabelle.tsx:242:      <Table<T>
frontend/src/pages/gefahren/GefahrenMatrix.tsx:91:    <Table<ZeilenDaten> rowKey="typ" …
```

Zeile 1 ist das Primitiv, Zeile 2 die **einzige deklarierte Ausnahme** (Flächencodierung
Gefahrentyp × Schutzobjekt; sie setzt Bildlauf und fixierte Kennungsspalte selbst, es fehlt
nur die stehende Kopfzeile — begründet in `katalogTabelle.guard.test.ts`, `AUSNAHMEN`).

Zwei Hinweise, die zum Kommando gehören: **die Wortgrenze ist nicht optional** (`\b` schließt
`<TableColumnsType`/`<TableProps` aus), und **`git grep -E` kennt `\b` nicht** — es liefert dort
still 0 Treffer und liest wie ein Erfolg. Der `.test.`-Ausschluss ebenfalls nicht: zwölf der
vierzehn repoweiten Fundstellen stehen in Selbstbeweis-Stringkonstanten der Guards, wer ihn
weglässt, misst 14 und schließt das Gegenteil.

---

### AK (b) — „Playwright bei 390 × 844 auf Kräfteübersicht, Personalseite und Befehle-Tab: `document.body.scrollWidth <= window.innerWidth`"

**Ist-Formulierung**

> Playwright-Schritt in `pnpm e2e` bei Viewport 390 × 844 auf Kräfteübersicht, Personalseite
> und Befehle-Tab: `document.body.scrollWidth <= window.innerWidth` (kein horizontales
> Scrollen des Seitenkörpers).

**Warum sie am gelieferten Code nicht misst**

Drei Punkte, der erste ist der wichtigste:

1. **Auf zwei der drei genannten Flächen ist das Kriterium bei 390 px gemessen VERLETZT** und
   nur namentlich freigestellt. Aus `frontend/e2e/gate1-ueberlauf.spec.ts:148-152`
   (`BESTAND_OFFEN`), gemessen als `documentElement.scrollWidth - clientWidth`:

   | Route | 390 px über | Verursacher |
   |---|---|---|
   | `/personal` | **79 px** | `Space` ohne `wrap`: Auswahlfeld `minWidth: 260` + Knopf „Ad-hoc-Person" (`PersonalPage.tsx:329-339`) |
   | `/kraefteuebersicht` | **7 px** | `Space` ohne `wrap`: „In Lagebericht übernehmen" + „Drucken / als PDF" (`KraefteuebersichtPage.tsx:241-245`) |
   | `/auftraege` (Befehle-Tab) | 0 px | — |

   Alle drei Verursacher sind **Bestand des Seitenkopfs**, nicht Werk dieses Tickets: dieselben
   Werte stehen auf dem leeren Einsatz (0 Personal, 0 Kräfte), und `git diff a06cd0f..HEAD`
   berührt in beiden Dateien nur Importe und Spalten. Ein Kriterium, das dies unbedingt
   verlangt, wäre also **rot geboren** — und ein rot geborenes Gate wird abgeschaltet statt
   befolgt.

2. **Die Ticket-Formel ist die lockerere** und misst am falschen Knoten. `body.scrollWidth`
   ist im Repo **vierfach begründet verworfen**: `seitenrinne.spec.ts:17`,
   `kopfzeile-schmal.spec.ts:18`, `lage-dashboard-schmal.spec.ts:26`, `nav-schmal.spec.ts:78-90`.
   Gemessen wird `documentElement.scrollWidth - clientWidth` mit 1-px-Toleranz (Chromium
   rundet auf ganze Pixel).

3. **„Kein horizontales Scrollen" ist per `overflow-x: hidden` erfüllbar, ohne dass etwas
   repariert wäre.** Der gelieferte Spec weist deshalb `hidden` getrennt von `auto`/`scroll`
   aus: ein `[GEKLIPPT]` in der Diagnose ist ein Fund, kein Freispruch.

**Ersatzformulierung**

> `frontend/e2e/gate1-ueberlauf.spec.ts`,
> `test('Gate 1: keine tragende Route läuft auf 1366, 1024 oder 390 px waagerecht über')`
> ist grün. Er misst **neun** Routen × **drei** Breiten (1366/1024/390 px) als
> `documentElement.scrollWidth - clientWidth ≤ 1 px`, mit gesätem Inhalt (ein leerer Modul-
> Leerzustand kann nicht überlaufen) und einem form-agnostischen Anker je Route.
>
> Auf 1366 und 1024 px sind **alle neun Routen sauber**. Auf 390 px bleiben **drei
> Bestandsverstöße** — `personal` 79 px, `personen` 120 px, `kraefteuebersicht` 7 px — als
> `BESTAND_OFFEN` (`gate1-ueberlauf.spec.ts:148-152`) freigestellt: **namentlich, je mit
> Deckel** (130/180/60 px) **und mit Totmeldung**. Verursacher ist in allen drei Fällen ein
> `Space` ohne `wrap` im Seitenkopf, nicht der Listeninhalt.
>
> Die Freistellung ist keine Amnestie und kann nicht veralten:
> - ein Verstoß auf einer **nicht gelisteten** Route × Breite ist rot,
> - ein gelisteter Verstoß **über seinem Deckel** ist rot (Verschlechterung),
> - ein **behobener** (≤ 1 px) oder gar nicht mehr gemessener Eintrag wird als **tot** gemeldet
>   und erzwingt seine Streichung.
>
> **Zielticket der drei offenen Zeilen: B5 (LFH-333)** — dort laufen Kopf- und Bedienflächen
> ohnehin auf die Dichte-Staffel und den `size`-Abbau; „Kopfaktionen umbrechen unter `sm`"
> gehört in denselben Griff. Die Zeile steht mit Verursacher und Deckel in
> `docs/superpowers/specs/2026-07-28-einsatzlisten-pruefliste.md:144-146`; die maschinell
> durchgesetzte Fassung ist `BESTAND_OFFEN` in `gate1-ueberlauf.spec.ts:148-152`.

Prüfkommando:

```bash
pnpm -C frontend exec playwright test e2e/gate1-ueberlauf.spec.ts --reporter=list
```

Die Messwerte je Route × Breite stehen als `test.info().annotations` im Lauf — ein grüner Lauf
ohne Zahlen belegte „kein Überlauf" und ließe offen, ob überhaupt gemessen wurde.

---

### AK (c) — „`grep -rnE "sorter|filters:|Input.Search"` liefert je Datei ≥ 1 Treffer"

**Ist-Formulierung**

> `grep -rnE "sorter|filters:|Input.Search"` über die 13 Katalog-Dateien und über
> `FahrzeugePage.tsx`/`PersonalPage.tsx`/`MaterialPage.tsx`/`BewegungenTab.tsx` liefert je
> Datei ≥ 1 Treffer (Ausgangslage: 0 Treffer über alle).

**Warum sie am gelieferten Code nicht misst**

Die siebzehn Dateien zerfallen in **zwei Gruppen mit gegenläufigem Befund**. Gemessen an
`fc48f60` (Trefferzahl der Ticket-Formel je Datei):

| Gruppe | Dateien | Treffer |
|---|---|---|
| A — `Datensicht`-Konsumenten | `FahrzeugePage`, `PersonalPage`, `MaterialPage`, `uhs/BewegungenTab` | **0, 0, 0, 0** |
| B — Katalog-Tabellen | die dreizehn genannten | 1–3, **alle ≥ 1** |

1. **Für Gruppe A ist das Kriterium am Typ unerfüllbar.** `DatensichtSpalte<T>` amputiert
   antds Sortier- und Filterhaken (`Datensicht.tsx:127-145`: `sorter`, `sortOrder`,
   `defaultSortOrder`, `sortDirections`, `filters`, `filteredValue`, `defaultFilteredValue`,
   `onFilter` und die vier `filter*`-Haken). Grund: antd hält deren Zustand **intern**, der
   Kartenzweig könnte ihn nicht lesen und zeigte still eine andere Reihenfolge und Menge.

   **Mutationsprobe** (`sorter: true` an die Zeit-Spalte in `pages/uhs/BewegungenTab.tsx`
   gesetzt, `tsc --noEmit`, danach per `cp` zurückgesetzt — Datei bytegleich):

   ```
   src/pages/uhs/BewegungenTab.tsx(72,11): error TS2561: Object literal may only specify
   known properties, but 'sorter' does not exist in type 'DatensichtSpalte<…>'.
   Did you mean to write 'sortWert'?
   ```

   Das Kriterium verlangt in Gruppe A also genau das, was der Typ verbietet: ein Konsument,
   der es erfüllt, bricht `tsc`.

2. **Das Muster ist kommentarblind und damit WERTLOS erfüllbar.** Zweite Mutationsprobe,
   dieselbe Datei: ein Satz Prosa mit dem Wort `sorter` eingefügt —

   ```
   // Diese Spalte braucht kein antd-sorter — Datensicht sortiert extern.
   ```

   → Trefferzahl **0 → 1**, `tsc` bleibt grün. Das Kriterium ist damit durch einen Kommentar
   erfüllbar, ohne dass sich am Verhalten irgendetwas ändert. (Dieselbe Falle ist im Repo
   zweimal zugeschlagen, protokolliert in `theme/seitenrinne.guard.test.ts`.)

3. **„je Datei" ist für eine der genannten Flächen fachlich falsch** — nicht für die vier oben,
   aber die Formulierung lädt zur Übertragung ein: `pages/KraefteuebersichtPage.tsx` darf
   Suche, Spaltenfilter und Sortierung **im Primitiv nicht** haben. Die Aggregate der
   Elternzeilen des Meldebilds werden stromaufwärts über die **Vollmenge** kumuliert; fiele
   im Primitiv eine Zeile weg, behielten die Eltern Zahlen über nicht mehr sichtbare Kinder —
   die Ampelzahlen lügen still, ohne Fehler und ohne roten Test.

4. **`Input.Search` je Datei ist die falsche Richtung.** Ein Suchfeld pro Datei ist genau das,
   was das Primitiv einsammelt.

**Ersatzformulierung — zwei getrennte Zusicherungen**

**(c1) Gruppe B, die dreizehn Kataloge — maschinell erzwungen, heute erfüllt.**

> `frontend/src/components/katalogTabelle.guard.test.ts`,
> `it('jeder Katalog trägt Sortierung, Suche und — bis auf drei begründete — eine Filterachse')`
> ist grün. Er prüft **auf entkommentiertem Text** (`ohneKommentare`, Blockzustand über
> Zeilengrenzen) je Katalogdatei:
> - `sorter:` ≥ 1,
> - `suche={` ≥ 1 (das Prop ist opt-in — ohne es gibt es weder Feld noch `/`-Kürzel),
> - `filters:` ≥ 1 **und** `filters:` == `onFilter:` — eine Spalte mit `filters` ohne
>   `onFilter` malt das Aufklappmenü und siebt nichts; das ist der Ausgangsbefund dieses
>   Tickets im Kleinen (Fähigkeit sichtbar, nicht angeschlossen).
>
> Drei Kataloge sind von der Filterachse **namentlich mit Begründung** freigestellt
> (`OHNE_FILTERACHSE`): `StichworteTab` (der Datensatz trägt keine siebbare Achse),
> `QualifikationenTab` und `EinheitTypenTab` (Aktiv-Achse serverseitig gesiebt,
> `personal/qualifikation_repo.rs:55` bzw. `einheit/typ_repo.rs:70`, je `WHERE aktiv = 1`).
> Rüstet einer von ihnen später eine Filterachse nach, meldet der Guard den Eintrag als
> **tot** und erzwingt seine Streichung; ein Eintrag auf eine ungeprüfte Datei fällt ebenfalls auf.
> `it('die dreizehn Kataloge sind vollzählig')` pinnt die Liste gegen stilles Schrumpfen.

**(c2) Gruppe A, die vier `Datensicht`-Konsumenten — die Marken heißen anders.**

Was der Ersatz **nicht** sagen darf: dass Gruppe A heute im Guard positiv gepinnt wäre. Ist sie
nicht. Erzwungen ist heute die **negative** Hälfte plus die Form:

> `frontend/src/components/datensicht.guard.test.ts`,
> `it('das Primitiv und alle abgeleiteten Konsumenten halten den Vertrag')` ist grün. Über
> **alle neun** `Datensicht`-Konsumenten gilt auf entkommentiertem Text: `sorter:` = 0,
> `filters:` = 0, `defaultSortOrder` = 0, `responsive:` = 0 — und `spaltenFuer` ≥ 1
> (schließt das `const K`-Widening). Zusätzlich pinnt
> `it('der Scan sieht genau die neun geplanten Konsumenten')` das Inventar in **beide**
> Richtungen.

Die **positive** Hälfte für Gruppe A ist ein benannter Restposten. Bis sie im Guard steht,
gilt als Prüfkommando mit erwarteter Ausgabe (gemessen an `fc48f60`):

```bash
# Ausdrücklich über `bash -c`: die Standardschale dieser Arbeitsumgebung ist fish,
# dort bricht sowohl die for-Schleife als auch die {a,b}-Klammerform.
bash -c 'for f in frontend/src/pages/FahrzeugePage.tsx frontend/src/pages/PersonalPage.tsx \
                  frontend/src/pages/MaterialPage.tsx frontend/src/pages/uhs/BewegungenTab.tsx; do
  printf "%-46s sortWert=%s suche=%s filter=%s\n" "$f" \
    "$(grep -c "sortWert:" "$f")" "$(grep -c "suche={" "$f")" "$(grep -c "filter: {" "$f")"
done'
```

```
frontend/src/pages/FahrzeugePage.tsx           sortWert=2 suche=1 filter=1
frontend/src/pages/PersonalPage.tsx            sortWert=2 suche=1 filter=1
frontend/src/pages/MaterialPage.tsx            sortWert=2 suche=1 filter=1
frontend/src/pages/uhs/BewegungenTab.tsx       sortWert=1 suche=1 filter=1
```

**Konkrete Nachrüstung** (ein Ticket wert, nicht mehr): eine Liste `ORDNUNG_PFLICHT` in
`datensicht.guard.test.ts` nach dem Bauplan von `OHNE_FILTERACHSE` — je Datei `sortWert:` ≥ 1,
`suche={` ≥ 1, `filter: {` ≥ 1, mit namentlicher Freistellung dort, wo eine Achse fehlt, und
mit Totmeldung. Wichtig für die Formulierung: die Zusicherung gilt **je Datei, nicht je
Gruppe** — `pages/PersonenPage.tsx` misst selbst `sortWert:` = 0, weil seine Spalten in
`personen/personenSpalten.tsx` liegen (dort `sortWert:` = 2). Eine Liste, die stumpf über alle
neun Konsumenten liefe, wäre falsch rot.

**(c3) Die Gegenzeile, die den Regelbruch verhindert — bereits erzwungen.**
`pages/KraefteuebersichtPage.tsx` steht in `VOLLMENGE_PFLICHT` und muss `suche={` = 0,
`filter: {` = 0, `sortWert:` = 0, `standardSortierung=` = 0 tragen. `Input.Search` bleibt dort
**erlaubt** — die Filter-Card liegt außerhalb von `Datensicht` und filtert weiter über
`filtereKraefte`; „`Input.Search` = 0" ist deshalb **keine** repoweite Zusicherung.

---

### AK (d) — „Vitest belegt für `Datensicht` Kartenform und Tabelle, `useViewport` gemockt"

**Ist-Formulierung**

> Vitest belegt für `Datensicht`, dass bei schmalem Viewport die Kartenform und ab `md` die
> Tabelle gerendert wird (ein Test je Zweig, `useViewport` gemockt).

**Warum sie am gelieferten Code nicht misst**

Zwei Punkte:

1. **„`useViewport` gemockt" beschreibt etwas, das der Code bewusst NICHT tut.** Die Breite
   kommt über den `matchMedia`-Stub aus `test/viewport.ts` (`setzeViewportBreite`) durch den
   **echten** Hook. Begründung im Test selbst: ein Mock des Hooks pinnte die Schwelle im Mock
   statt im Produktivcode, und eine Regression in `abBreiteAus` bliebe unsichtbar. Ein
   Kriterium, das den Mock verlangt, verlangt die schwächere Prüfung.

2. **„ein Test je Zweig" lässt die Schwelle offen.** Zwei Zweigtests bei 390 und 1024 px sind
   mit **jeder** Schwelle dazwischen grün. Erst ein Grenzpaar pinnt die Zahl.

**Ersatzformulierung**

> `frontend/src/components/Datensicht.test.tsx`, `describe('Datensicht · Formachse')` ist grün.
> Er belegt vier Aussagen, jede über `setzeViewportBreite` (`matchMedia`-Stub) durch den
> **echten** `useViewport` — nicht über einen Hook-Mock:
> - `it('unter md genau EIN Zweig: Karten, keine Tabelle')` — 390 px: 0 Tabellen, 3 Karten,
> - `it('bei 1024 px genau EIN Zweig: Tabelle, keine Karte')` — 1 Tabelle, 0 Karten,
> - `it('die md-Schwelle sitzt bei 768: 767 px Karten, 768 px Tabelle')` — **das Grenzpaar**
>   pinnt antds `screenMD` = 768; gemessen: kippt die Weiche auf `abBreite('lg')`, wird die
>   768er Hälfte rot, während 1024 grün bliebe,
> - `it('form="tabelle" bleibt bei 390 px eine Tabelle')` und
>   `it('form="karte" bleibt bei 1024 px eine Karte')` — die Formachse schlägt die Breite.
>
> Jeder Zweigtest zählt **beide** Formen (`toHaveLength(1)` **und** `toHaveLength(0)`): ein
> Schmal-Test, der nur die Karten zählt, bliebe auch grün, wenn die Weiche bei jeder Breite in
> den Kartenzweig kippt.

```bash
pnpm -C frontend exec vitest run src/components/Datensicht.test.tsx
```

---

### AK (e) — „`grep -c "<Table" frontend/src/auftraege/BefehlListe.tsx` = 0"

**Ist-Formulierung**

> `grep -c "<Table" frontend/src/auftraege/BefehlListe.tsx` = 0; ein Vitest-Test belegt die
> Gruppenköpfe „Entwürfe" und „Freigegeben" mit Zähler.

**Warum sie am gelieferten Code nicht misst**

Die zweite Hälfte (Gruppenköpfe mit Zähler) ist in Ordnung. Die erste ist ein **Gate, das nicht
fallen kann**: nach dem Umbau liegt das Tabellenelement in `KatalogTabelle.tsx`, und damit ist
`<Table` = 0 für **jeden** `Datensicht`-Konsumenten **strukturell wahr** — unabhängig davon, ob
die Datei eine Tabelle oder Karten rendert.

Gegenbeispiel aus demselben Ticket: `pages/KraefteuebersichtPage.tsx` misst ebenfalls
`<Table` = 0 und rendert **nachweislich in jeder Breite eine Tabelle** (`form="tabelle"`,
`:375`; belegt in `frontend/e2e/meldebild-tabelle.spec.ts`). Ein Maß, das für Tabelle und Karte
denselben Wert liefert, misst die Formwahl nicht.

**Ersatzformulierung**

> Die Formwahl trägt die **Anwesenheit des Formliterals**, nicht die Abwesenheit des
> Tabellenelements. `frontend/src/components/datensicht.guard.test.ts`,
> `it('das Primitiv und alle abgeleiteten Konsumenten halten den Vertrag')` ist grün und
> erzwingt:
> - `NUR_KARTE` = `['/src/auftraege/BefehlListe.tsx', '/src/pages/LageberichtePage.tsx']` —
>   jede dieser Dateien **muss** das Literal `form="karte"` tragen,
> - `NUR_TABELLE` = `['/src/pages/KraefteuebersichtPage.tsx']` — muss `form="tabelle"` tragen
>   (Kriterium 14 verbietet dort die Auflösung in Karten ausdrücklich),
> - `it('die fünf gepflegten Listen stehen auf dem entschiedenen Stand')` pinnt die Längen
>   (2 / 1), damit niemand still einträgt oder streicht.
>
> Der Selbstbeweis `it('Selbstbeweis: eine Formliste ohne das passende Literal fällt auf')`
> belegt, dass die Prüfung rot werden kann.
>
> Ergänzend gilt weiterhin die repoweite Schließung aus AK (a): rohe antd-Tabellen leben
> ausschließlich im Primitiv und in einer einzigen deklarierten Ausnahme. Zusammen sagen
> beide, was AK (e) sagen wollte — und einzeln kann keines von beiden durch Wegschauen erfüllt
> werden.

```bash
pnpm -C frontend exec vitest run src/components/datensicht.guard.test.ts
```

---

### Nicht zu korrigieren: AK (f) `getByLabelText('Personal')`/`('Fahrzeuge')`

Der Vollständigkeit halber, weil eine Zwischennotiz dieses Bündels das Gegenteil behauptete:
das Kriterium ist **schreibbar und erfüllt**. `kraefte/AmpelZelle.tsx:50` trägt
`<span className="lfh-ampel" role="group" aria-label={bezeichnung}>`; die Abfrage steht wörtlich
in `pages/KraefteuebersichtPage.test.tsx:226/231` (innerhalb `within(zeile)`) und in
`kraefte/AmpelZelle.test.tsx:21`. Der zweite Kanal ist der Kurztext neben der Zahl (WCAG 1.4.1),
das Emoji hängt an einem eigenen `aria-hidden="true"`-Knoten.

---

## Zwei Arbeitspunkte, die der gelieferten Leitlinie widersprechen

### P7 (M1/M2) — „Meldebild-Tabelle: unter `md` gruppierte Statusliste"

**Ist-Formulierung**

> Meldebild-Tabelle (`:256`) auf `Datensicht` heben: **unter `md` gruppierte Statusliste** aus
> `bild.baum` (ein Block je Abschnitt, Einheiten als Zeilen mit Stärke und Ampel), darüber
> `scroll={{ x: 'max-content' }}`.

**Warum das nicht mehr gilt**

Die Kartenauflösung widerspricht der Leitlinie, die **dieses Ticket selbst geschrieben hat**:
das Meldebild ist eine **Vergleichsfläche** („welcher Abschnitt ist der kritische?"), und für
Vergleichsflächen gilt „auf schmalem Schirm wird eine Tabelle **angepasst, nicht in Karten
aufgelöst**" (Bedien-Leitlinie Festlegung 2; AK3b im Drawer-Spec, `:88-94`). Der
Karten-Fallback unter `md` ist dort ausdrücklich die begründungspflichtige **Ausnahme**, nicht
der Normalfall.

Der Code folgt der Leitlinie: `KraefteuebersichtPage.tsx:375` setzt `form="tabelle"`, und
`datensicht.guard.test.ts` erzwingt es über `NUR_TABELLE`.

**Ersatzformulierung**

> Meldebild-Tabelle auf `Datensicht` mit **`form="tabelle"`** heben — in **jeder** Breite eine
> Tabelle, keine Auflösung in Karten (Kriterium 14). Der Bildlaufcontainer, die stehende
> Kopfzeile und die fixierte menschenlesbare Kennungsspalte kommen aus `KatalogTabelle`;
> schmale Schirme werden über `abBreite` an den Spalten bedient („weniger Spalten, aber weiter
> Tabelle"), nicht über eine zweite Form.
>
> Belege: `datensicht.guard.test.ts` (`NUR_TABELLE`, Formliteral erzwungen) und
> `frontend/e2e/meldebild-tabelle.spec.ts` — dort **im Browser** gemessen, dass der Baum in der
> fixierten Tabelle auch auf 390 px bedienbar bleibt (Aufklapp-Symbol × fixierte Spalte 0) und
> dass der Druckpfad durch den Bildlaufcontainer trägt. Beide Aussagen sind reine
> Layoutaussagen und in Vitest strukturell unfähig, rot zu werden.

### P6 (M53) — „BewegungenTab: Paginierung 50; unter `md` eine Zeitleiste"

**Ist-Formulierung**

> Standardsortierung neueste zuerst, `sorter` auf Zeit, `filters` auf Art, Suche auf
> Person/Registriernummer, **Paginierung 50**; unter `md` statt der 5-Spalten-Tabelle eine
> **Zeitleiste** (eine Zeile je Bewegung mit farbigem Art-Tag, Uhrzeit, Registriernummer).

**Entscheidung: umformulieren, kein Restposten.** Beide Hälften sind gemessen aufgelöst.

**Warum „Paginierung 50" nicht gilt.** Im `Datensicht`-Zweig ist Seitenblätterung
**strukturell ausgeschlossen**: `Datensicht.tsx:1166` setzt `pagination={false}` an
`KatalogTabelle`, mit der Begründung, dass eine Seitenblätterung die **Zeilenschleuse**
(Prüflisten-Kriterium 12 — neue Datensätze kommen als Sammelbanner, sie springen nicht unter
dem Cursor ein) entzweischnitte. Die Zeilenschleuse hat Vorrang; sie ist die Zusicherung, für
die die Blätterung weichen musste. Die Blätterungsschwelle 50 lebt weiter, aber dort, wo sie
hingehört: `KatalogTabelle.BLAETTER_SCHWELLE = 50` für die Katalog-Konsumenten
(`katalogTabelle.guard.test.ts`, `it('die Blätterungsschwelle der Kataloge hat lebende
Konsumenten')`).

**Warum „Zeitleiste" nicht als eigene Form gebaut wurde.** Die verlangten Inhalte einer
Zeitleistenzeile — farbiger Art-Tag, Uhrzeit, Registriernummer — liefert die **generische
Kartenform** vollständig: `BewegungenTab.tsx:156-165` fährt `karte={{ art: 'plan' }}` mit
`status: (b) => belegungsArt[b.art]` (der farbige Art-Kanal), `titel: { spalte: 'person_id' }`
(und `personEtikett` rendert `«Registriernummer» · «Name»`, `:26-32`) und
`sekundaer: ['zeitpunkt_at', 'platz_id', 'notiz']` (die Uhrzeit über `ZeitAnzeige`). Ein
eigener Renderer brächte dieselbe Zeile mit einer zweiten Codebasis. Das ist auch die im Repo
schriftlich festgehaltene Entscheidung: `datensicht.guard.test.ts`, `KARTEN_EIGENBAU` — die
Liste der Dateien, die einen eigenen Kartenrenderer setzen dürfen — steht auf **Länge 0**, mit
dem Kommentar „Die UHS-Zeitleiste läuft über den Plan-Modus, weil `Liste` mit ihren
Trennlinien bereits die Struktur von `personen/PersonVerlauf.tsx` liefert."

**Ersatzformulierung**

> `frontend/src/pages/uhs/BewegungenTab.tsx` auf `Datensicht` mit `form="auto"` heben:
> Standardsortierung neueste zuerst, `sortWert` auf der Zeit, `filter: { werte, trifft }` auf
> der Art (aus `belegungsArt` **abgeleitet**, nicht abgetippt — eine vierte Art erscheint von
> selbst), `suchText` auf Person/Registriernummer.
>
> Unter `md` trägt die **generische Kartenform im Plan-Modus** die Zeitleistenzeile: Titel =
> `«Registriernummer» · «Name»`, Statuskanal = farbiger Art-Tag, Sekundärfelder = Uhrzeit,
> Platz, Notiz. **Kein eigener Kartenrenderer** — `KARTEN_EIGENBAU` bleibt auf Länge 0, gepinnt
> von `datensicht.guard.test.ts`,
> `it('die fünf gepflegten Listen stehen auf dem entschiedenen Stand')`.
>
> **Keine Seitenblätterung** in dieser Sicht: `Datensicht` setzt `pagination={false}`, weil die
> Zeilenschleuse (Kriterium 12) sonst entzweigeschnitten würde. Die Schwelle 50 gilt für die
> Katalog-Konsumenten von `KatalogTabelle` (`BLAETTER_SCHWELLE`), nicht für den
> `Datensicht`-Zweig.
>
> Belege: `datensicht.guard.test.ts` (`KARTEN_EIGENBAU`, Konsumenten-Inventar),
> `Datensicht.test.tsx` `describe('Datensicht · Zeilenschleuse')`.

---

## Was mit dieser Korrektur NICHT gesagt ist

- **AK (g)** (`./scripts/check-all.sh` grün) bleibt unverändert gültig und ist nicht Gegenstand
  dieser Korrektur.
- Die drei 390-px-Bestandsverstöße aus AK (b) sind **nicht behoben**, sondern namentlich mit
  Deckel und Totmeldung nach **B5 (LFH-333)** delegiert. Wer AK (b) in der neuen Fassung als
  „erfüllt" abhakt, hakt damit **nicht** „kein Überlauf auf 390 px" ab.
- Die positive Ordnungs-Zusicherung für die vier `Datensicht`-Konsumenten aus AK (c2) steht
  heute **nicht** im Guard. Sie ist als konkrete Nachrüstung benannt, nicht als erledigt.
- `etb/EtbTabelle.tsx` ist die **zwanzigste** `KatalogTabelle`-Konsumentin und steht bewusst
  nicht im Inventar der 19 — sie arbeitet auf einem serverseitigen 100-Zeilen-Fenster. Benannter
  Restposten, kein stiller Nebeneffekt.
