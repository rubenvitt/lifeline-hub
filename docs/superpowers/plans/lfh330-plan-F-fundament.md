# Fundament: Datensicht + KatalogTabelle-Erweiterung + Überlaufschutz

# LFH‑330 · B2 — Umsetzungsplan Bündel „Fundament: Datensicht + KatalogTabelle‑Erweiterung + Überlaufschutz"

Alle Pfade absolut ab `/Users/rubeen/dev/personal/lifeline-hub/.claude/worktrees/lfh-330-einsatzlisten-primitive/`.
Alle Zeilenangaben unten sind **am Code dieses Worktrees nachgeschlagen**, nicht aus den Berichten übernommen.

---

## 0. Voranstehende Scope‑Aussage — lest das zuerst

**Dieses Bündel liefert `components/Datensicht.tsx` mit NULL Konsumenten.** Alle in der Entscheidung genannten Konsumenten (`FahrzeugePage`, `PersonalPage`, `PersonenPage`, `TierePage`, `MaterialPage`, `uhs/BewegungenTab`, `KraefteuebersichtPage`, `auftraege/BefehlListe`, `pages/LageberichtePage`) liegen in Bündel I/II/III bzw. AP3/AP6/AP7. Die zwei Dateien meines Bündels, die man dafür in Betracht ziehen könnte, sind ausdrücklich ausgeschlossen: `pages/MitgliederAbschnitt.tsx` per E3, `pages/UnfallhilfsstellenPage.tsx`/`pages/bereitstellungsraum/BereitstellungsraeumePage.tsx` per E4/§9‑10 („nur der Tausch auf `KatalogTabelle`").

Drei Folgen, die den Plan formen und in §5 ausgeführt sind: kein e2e‑Nachweis für **irgendeinen** Datensicht‑Zweig ist hier möglich (keine Route rendert einen); die Konsumenten‑Zusicherungen des neuen Guards sind bei Lieferung gegenstandslos; und die „Lieferbedingung, nicht Nachlauf"‑Forderung der Entscheidung (§8, `fixed:'left'` × Aufklapp‑Icon, Druckpfad) ist **in diesem Bündel unerfüllbar**.

Was dagegen hier **beweisbar** ist und in der Entscheidung fehlt: `sorter` landet in genau der Spalte, die `KatalogTabelle.tsx:58-62` **unbedingt** fixiert. `/admin/benutzer` ist die bestehende Messroute mit funktionierendem Harness → Schritt S10.

---

## 1. Reihenfolge der Schritte — erst der Test, dann der Code

### S1 · Guard zuerst: das Inventar von 13 auf 19
**Test:** `frontend/src/components/katalogTabelle.guard.test.ts` — `KATALOGTABELLEN` (`:39-53`) um sechs Pfade erweitern, `expect(QUELLEN).toHaveLength(13)` (`:101`) → `toHaveLength(19)`, Kommentar `:38` („Die dreizehn Katalogtabellen …") nachziehen.

```
'pages/bereitstellungsraum/BereitstellungsraeumePage.tsx',
'pages/PersonenDetailPage.tsx',
'pages/SchaedenPage.tsx',
'pages/uhs/MaterialTab.tsx',
'pages/UnfallhilfsstellenPage.tsx',
'pages/MitgliederAbschnitt.tsx',
```

**Was er beweist:** dass die sechs Dateien über das Primitiv laufen — und zwar drei Zusicherungen je Datei (`<KatalogTabelle` ≥ 1 `:103-104`, `<Table` = 0 `:106-107`, `scroll={{` = 0 `:111-112`).

**Warum ROT und nicht trivial grün:** alle sechs enthalten heute `<Table` (BereitstellungsraeumePage `:97`, PersonenDetailPage `:511`, SchaedenPage `:134`, uhs/MaterialTab `:90`, UnfallhilfsstellenPage `:69`, MitgliederAbschnitt `:124`) und kein `<KatalogTabelle`. `ohnePrimitiv` **und** `mitAntdTabelle` sind beide rot, mit Dateinamen in der Meldung.

**Das ist die Begründung für Guard‑zuerst, nicht Stilfrage:** ich habe die vier vorhandenen Tests der betroffenen Seiten geprüft (`pages/SchaedenPage.test.tsx`, `pages/PersonenDetailPage.test.tsx`, `pages/UnfallhilfsstellenPage.test.tsx`, `pages/MitgliederAbschnitt.test.tsx`) — **keiner** greift Zeilenstruktur (`getAllByRole('row')`, `'cell'`, `.ant-table*` kommen dort 0× vor). Nach dem Tausch laufen sie unverändert grün. Der Inventar‑Guard ist damit der **einzige** mechanische Beleg, dass die Migration überhaupt stattgefunden hat.

### S2 · Die sechs Dateien migrieren
Import‑Tausch + Elementtausch (Details in §2). Danach ist S1 grün, ohne dass eine Zusicherung abgeschwächt wurde.

### S3 · `KatalogTabelle`: Suchfeld, **opt‑in** (nicht opt‑out)
**Test zuerst** in `frontend/src/components/KatalogTabelle.test.tsx`, vier Fälle:
1. ohne `suche`‑Prop → `container.querySelector('input[type="search"]')` ist `null` **und** kein Werkzeugzeilen‑Knoten existiert (`[data-lfh="katalog-werkzeuge"]` fehlt).
2. mit `suche={{ platzhalter: 'Funkrufname, Typ' }}` → Feld da; `userEvent.type(feld, 'LF')` lässt die Zeile mit `typ: 'LF'` stehen und die andere verschwinden (`queryByText` beider Funkrufnamen).
3. **Diskriminierende Fixture:** eine Zeile, deren Suchbegriff **nur** in einer render‑only‑Spalte steht (Muster `stammdaten/FahrzeugeTab.tsx:40` `{ title:'Stärke', key:'staerke', render }` — kein `dataIndex`). Tippen des Begriffs muss die Zeile **ausblenden**. Das pinnt die dokumentierte Grenze statt sie später zu entdecken.
4. `/`‑Fokus: `fireEvent.keyDown(window, { key: '/' })` fokussiert das Feld; derselbe Tastendruck mit `target` = einer `<textarea>` tut es **nicht**.

**Warum ROT:** `suche` existiert nicht, `KatalogTabelleProps<T> = Omit<TableProps<T>,'scroll'|'sticky'>` (`:31`) kennt das Prop nicht → tsc bricht, Vitest bricht.
**Warum nicht trivial grün:** Fall 1 fällt, sobald man default‑AN baut; Fall 3 fällt, sobald man „alle Zellinhalte" statt „Spalten mit auflösbarem `dataIndex`" durchsucht; Fall 4 fällt bei einem nackten `window`‑Listener ohne Target‑Prüfung.

**Die Umkehrung gegenüber bericht‑2 ist bewusst.** bericht‑2 empfiehlt default‑AN mit `suche={false}`, Argument: dann muss nur `etb/EtbTabelle.tsx` angefasst werden, die 13 bleiben unberührt, keine Kollision mit B3. Dieses Argument fällt weg, weil mein Bündel die 13 für `sorter`/`filters` **ohnehin** anfasst (S5). Was bei default‑AN übrig bleibt, ist reiner Schaden: `pages/SchaedenPage.tsx:126-131` hat bereits ein eigenes `Input.Search` mit **anderer** Semantik (`filterSchaeden` über Ort/Beschreibung) → zwei Suchfelder; `etb/EtbTabelle.tsx` hat `etb/EtbFilterleiste.tsx:39` als **serverweite** Suche über ein 100‑Zeilen‑Fenster → semantisch falsches Doppel; vier winzige Tabellen (Bereitstellungsräume, UHS, Mitglieder, Zugriffs‑Audit) bekommen Zeremonie; und **`Datensicht` bekommt im Tabellenzweig ein zweites Suchfeld neben seinem eigenen**, weil es `KatalogTabelle` intern nutzt. Opt‑in ist die additive Variante.

### S4 · Blätterung: das Grenzpaar
**Test zuerst**, drei Fälle in `KatalogTabelle.test.tsx` mit generierten Fixtures:
- 40 Zeilen, **kein** `pagination`‑Prop → `.ant-pagination` ist `null`.
- 60 Zeilen, **kein** `pagination`‑Prop → `.ant-pagination` existiert, `.ant-pagination-options` (Size‑Changer) ist `null`, und `tr.ant-table-row` hat Länge 50.
- 60 Zeilen **mit** `pagination={false}` → `.ant-pagination` ist `null`. (Das ist die Erweiterung des Bestandspins `:67`, der heute nur mit leerer `dataSource` prüft — dort ist er strukturell unfähig zu fallen.)

**Warum ROT:** heute gilt antds Default `DEFAULT_PAGE_SIZE = 10` (`node_modules/antd/es/table/hooks/usePagination.js`), also blättert 40 Zeilen bereits — Fall 1 rot. Und `showSizeChanger = total > totalBoundaryShowSizeChanger` (`@rc-component/pagination@1.4.0/es/Pagination.js:47`, Grenze 50) → bei 60 Zeilen erscheint der Size‑Changer von selbst, Fall 2 rot.
**Code:** `pagination` aus `rest` herausziehen und explizit setzen:
`pagination={pagination ?? (zeilenGesamt > BLAETTER_SCHWELLE ? { pageSize: BLAETTER_SCHWELLE, showSizeChanger: false } : false)}` mit `BLAETTER_SCHWELLE = 50`.
`??` statt `||`, damit ein übergebenes `false` gewinnt. **`zeilenGesamt` kommt aus `dataSource.length`, NICHT aus der gefilterten Menge** — sonst verschwindet die Blätterleiste beim Tippen unter 50 Zeilen und erzeugt genau den Layoutsprung, gegen den Prüflisten‑Kriterium 12 existiert. `hideOnSinglePage` ist aus demselben Grund **nicht** der Mechanismus (es rechnet gegen die gerenderte Menge).

### S5 · `sorter`/`filters` in den 13 Konsumenten
**Test zuerst, zweigeteilt:**

(a) **Verhaltens‑Test im Primitiv** (`KatalogTabelle.test.tsx`), einmal, nicht 13×: eine Spalte mit `sorter` + eine mit `filters` **und** `onFilter`. Klick auf die Kopfzelle sortiert (Reihenfolge von `tr.ant-table-row` vor/nach vergleichen); Öffnen des Filter‑Trichters (`.ant-table-filter-trigger`), Anklicken des Menüeintrags mit dem **eigenen** `text` (deutsch, locale‑unabhängig), Bestätigen über `.ant-table-filter-dropdown-btns .ant-btn-primary` → Zeilenmenge schrumpft. Ein zweiter Fall mit `filters` **ohne** `onFilter` belegt, dass dann **nichts** gefiltert wird — das ist die Falle unten in §3.
(b) **Guard‑Marke je Datei** in `katalogTabelle.guard.test.ts`: neue Zusicherung, dass jede der 13 (nicht: der 19) mindestens ein `sorter:` enthält. Das ist die **umformulierte Abnahme** — §9‑1 der Entscheidung stellt fest, dass `grep -rnE "sorter|filters:|Input.Search"` mit „≥ 1 je Datei" mit einer Suche im Primitiv unerfüllbar ist. Marke: `/\bsorter:/`. Kein `Input.Search` je Datei.

**Warum ROT:** `sorter` = 0 und `filters:` = 0 im gesamten `frontend/src` (gemessen). Beide Zusicherungen fallen sofort.

### S6 · `Datensicht`: die reinen Funktionen zuerst
**Test zuerst** in `frontend/src/components/Datensicht.test.tsx`, als direkte Aufrufe ohne Rendering — genau die Bauform, die `useViewport.guard.test.ts:84` mit dem exportierten `verstoesse()` vorgibt:

| Funktion | Was der Test beweist | Warum nicht trivial |
|---|---|---|
| `zelle()` | `render` mit `RenderedCell`‑Rückgabe (`{props, children}`) wird auf `children` ausgepackt; ein React‑Element mit `props` wird **nicht** ausgepackt | Reihenfolge `isValidElement` vor `'children' in x` ist die Aussage; wer sie tauscht, zerlegt jedes `<Space>` in seiner Kartenzelle |
| `etikettVon()` | `etikett ?? title`, aber nur bei String‑`title`; Funktions‑`title` → `undefined` + genau eine DEV‑Warnung | ohne den Funktions‑Fall wäre `antd/es/table/interface.d.ts` `title?: ReactNode \| (props)=>ReactNode` unabgedeckt |
| `effektiveDaten()` | (1) `baum: true` gibt `daten` **referenzgleich** zurück; (2) `null`/`undefined` aus `sortWert` landen **hinten**, in beiden Richtungen; (3) Gruppenachse ist die **führende** Sortierachse; (4) Suchbegriff trifft nur Spalten mit `suchText` | `toBe` (nicht `toEqual`) für (1); ohne (2) sortiert `undefined` je nach Engine irgendwohin; ohne (4) ist „Freitextsuche" eine Behauptung |
| `gruppiere()` | `reihenfolge` gewinnt; unbekannte Werte hängen in Antreffreihenfolge hinten; Zähler stimmen | eine leere Gruppe aus `reihenfolge` darf nicht erscheinen |
| `sichtbareSpalten()` | **Index 0 ist nie entfernbar** — weder über `verborgen`, noch über `abBreite`, noch über beides; `anzahlVerborgen` zählt beide Ursachen in EINEM Zähler | `KatalogTabelle.tsx:58-62` fixiert unbedingt, was als Spalte 0 ankommt. Fällt Spalte 0 weg, wird still eine **andere** Spalte die fixierte Kennung — kein Fehler, kein roter Test |
| `pruefeKartenplan()` | jeder der sieben gemeldeten Mängel einzeln, und `[]` bei intaktem Plan | Aufruf **direkt**, kein `console`‑Spion: sonst muss man gegen antd‑Fremdwarnungen abgrenzen |

**Warum ROT:** `Datensicht` = 0 Treffer im Repo (gemessen, bestätigt in der Kritik §4).

### S7 · Die zwei Zweige
**Test zuerst**, Bauform wörtlich aus `frontend/src/einsatz/EinsatzLayout.test.tsx:201-213`:
- `describe('unter md', ...)` mit `beforeEach(() => setzeViewportBreite(390))` — **vor** dem Render, weil `setzeViewportBreite` (`frontend/src/test/viewport.ts:112-118`) das ausdrücklich verlangt und `abBreiteAus` „unbekannt" als **breit** liest (`useViewport.ts:72-74`).
- Darin: kein `.ant-table` im Baum; `getByRole('link', { name: … })` für die Titelzelle; höchstens 3 Sekundärfelder; genau ein Aktionsknopf; `Popconfirm` bei gesetzter `bestaetigung`.
- **Gegenprobe im Default 1024:** `.ant-table` da, kein Karten‑Container. Ohne sie wäre der Schmal‑Test auch grün, wenn die Weiche bei **jeder** Breite anspringt — die Lehre steht als Kommentar in `EinsatzLayout.test.tsx:119-120`.
- Ein Fall `form="tabelle"` bei 390 px → Tabelle; ein Fall `form="karte"` bei 1024 px → Karte. Das prüft die Formachse gegen den Viewport, statt sie mit ihm zu verwechseln.
- **Genau ein Zweig im Baum:** bei 390 px zusätzlich `container.querySelectorAll('.ant-table')` = 0 **und** `querySelectorAll('[data-lfh="datensicht-karte"]')` > 0; bei 1024 px umgekehrt. Kein `display:none`‑Doppel.

### S8 · Die Zeilenschleuse (Kriterium 12)
**Test zuerst**, vier Zusicherungen, die zusammen tragen:
1. Fokus in die Sicht (`fireEvent.focusIn` auf den Titel‑Link), dann `rerender` mit zwei zusätzlichen Zeilen → `tr.ant-table-row` bzw. Karten‑Anzahl **unverändert**, Banner mit „2" sichtbar.
2. **Gepaart:** derselbe Rerender ändert eine Zelle einer bestehenden Zeile → der neue Text ist sichtbar. Ohne diese Hälfte wäre „Zeilenzahl ist nicht gewachsen" auch grün, wenn die Komponente neue Daten **komplett ignoriert**.
3. Klick aufs Banner → Zeilen erscheinen, Banner weg.
4. `focusOut` → Zufluss läuft ohne Banner durch.
Zusätzlich: eine **entfallene** Zeile verschwindet sofort, auch mit Fokus in der Sicht.
5. Die Werkzeugzeile existiert **auch ohne** Suche, Filter, Banner und Spaltenschalter (leerer Knoten). Sonst schiebt die erste eintreffende Zeile den Inhalt nach unten — die Sticky‑Reserve‑Lehre aus B1.

### S9 · `components/datensicht.guard.test.ts`
**Bauform:** `useViewport.guard.test.ts`, nicht `katalogTabelle.guard.test.ts`. Also: rekursiver `readdirSync`‑Scan über ganz `frontend/src`, exportierte reine `befunde(dateien: Record<string,string>): string[]`, Selbstbeweise gegen **synthetische Bäume** ohne Dateisystem, Sentinel „> 200 Dateien gescannt", Kommentar‑Stripper **kopiert** aus `theme/gate5.guard.test.ts` (nicht importiert — ein Import aus einer `*.test.ts` registriert deren `describe` doppelt), Ausnahmen `*.test.*` und `*.generated.*`.

**Abweichung von §8 der Entscheidung, begründet:** die Entscheidung will ein handgepflegtes Konsumenten‑Inventar mit `toHaveLength(n)`. Bei Lieferung ist n = **0** (siehe §0) — ein handgepflegtes Inventar wäre auf 0 gepinnt und bewiese damit nichts, **und** jedes Folgebündel müsste dieselbe Datei editieren: genau die Kollision, die die Kritik §6 für `katalogTabelle.guard.test.ts` als „braucht einen benannten Eigentümer" markiert. Deshalb: **das Konsumenten‑Inventar wird aus der Marke `<Datensicht` abgeleitet**, nicht gepflegt. Die Falsch‑Positiv‑Sorge, die den 13er‑Guard handgepflegt macht (`:15-18`, „Modals, Listen, Untertabellen"), existiert hier nicht — die Menge ist durch das Vorkommen der Marke definiert.

Handgepflegt bleiben nur die drei **semantischen** Ausnahmemengen, jede mit `toHaveLength(0)` bei Lieferung und je einem Kommentar, welches Bündel sie füllt:
- `KARTEN_EIGENBAU` — Dateien, die `art: 'eigen'` setzen dürfen.
- `NUR_KARTE` — Dateien, die `form="karte"` tragen müssen (AP7: `auftraege/BefehlListe.tsx`, `pages/LageberichtePage.tsx`).
- `NUR_TABELLE` — Dateien, die `form="tabelle"` tragen müssen (AP6: `pages/KraefteuebersichtPage.tsx`).

Marken **in `Datensicht.tsx`** (die tragenden, weil hier sofort wirksam):

| Marke | Erwartung | Warum |
|---|---|---|
| `<KatalogTabelle` | ≥ 1 | **Die tragende positive Marke.** Ohne sie besteht ein `Datensicht.tsx` mit rohem `<Table>` ohne `scroll` jede negative Prüfung und nimmt allen künftigen Konsumenten still Scroll, stehende Kopfzeile und fixierte Kennung |
| `<Table` | 0 | keine zweite Tabellenwahrheit |
| `scroll={{` | 0 | bleibt bei `KatalogTabelle`; hält zugleich `katalogTabelle.guard.test.ts:117` (`= 1`) intakt |
| `<Card` | 0 | die Kartenform ist `Liste`/`ListenEintrag`, nicht `Card` — sonst doppelter Rahmen zur `<li>`‑Trennlinie (`Liste.tsx:105`) und die 20 `size="small"` der `*Karte.tsx` |
| `size="small"` | 0 | E8 |
| `matchMedia`, `\buseBreakpoint\b` | 0 | Selbstbeweis; `useViewport.guard.test.ts:75` prüft es ohnehin über den Vollscan |
| `KARTEN-AUSNAHME`, `TRENNLINIE` | ≥ 1 | E7 verlangt die schriftliche Begründung. Anwesenheitsprüfung — sie kann ihr eigenes Gate nicht auslösen, im Gegensatz zu einer Verbotszählung |

Je **abgeleiteter** Konsumentendatei: `<Table` = 0, `scroll={{` = 0, `sorter:` = 0, `filters:` = 0, `responsive:` = 0, `spaltenFuer` ≥ 1.

**Warum ROT:** die Datei existiert nicht; nach S6–S8 fällt sie erst, wenn `Datensicht.tsx` `<KatalogTabelle` wirklich benutzt statt selbst `<Table` zu rendern.

### S10 · Der eine Browsernachweis, der hier möglich ist
`frontend/e2e/katalogtabelle-schmal.spec.ts` **erweitern**, keine neue Datei — die Route (`/admin/benutzer`), `test.use({ viewport: { width: 390, height: 844 } })` (`:19`) und der Anmelde‑Helfer stehen dort schon.

Zwei neue Schritte hinter dem bestehenden (f):
- **(g) Sortierung in der FIXIERTEN Kopfzelle wirkt bei 390 px.** `th.ant-table-cell-fix-start` klicken, `aria-sort` prüfen und die Reihenfolge von `tr.ant-table-row td:first-child` vor/nach vergleichen. Die Zelle liegt in `position: sticky` innerhalb eines `overflow: auto`‑Containers; die Schritte (a)–(f) messen dort ausschließlich Position und CSS und klicken nie. Diese Interaktion ist im Repo **unbewiesen** — die Entscheidung quarantäniert `fixed:'left'` × Aufklapp‑Icon und übersieht `fixed:'left'` × `sorter` vollständig. **Vorbedingung im Test mitschreiben:** mindestens zwei Datenzeilen, sonst ist die Reihenfolgemessung leer; der Harness liefert eine → im Spec einen zweiten Benutzer anlegen oder auf `stammdaten`‑Route mit Seed ausweichen.
- **(h) Z13, Katalog‑Hälfte: Fokus nie verdeckt.** Tabulatordurchlauf ab dem Suchfeld über Sortierauslöser und Filtertrichter; je Station `document.activeElement`‑BoundingBox gegen die Rechtecke von `.ant-table-sticky-holder` und `th.ant-table-cell-fix-start` auf Überschneidung prüfen. Trefffläche ≥ 48 px über `haeltTreffflaeche` mit `SUBPIXEL = 0.5`, **kopiert** aus `frontend/e2e/nav-schmal.spec.ts:24-46`. `toHaveCount(1)` vor jeder Zusicherung (Muster `kopfzeile-schmal.spec.ts:49-70`). Neubau ohne Vorbild: `press`/`keyboard` trifft in `frontend/e2e/` nur `command-palette.spec.ts`.

Damit hat Z13 aus `docs/superpowers/specs/2026-07-28-katalogtabellen-pruefliste.md:65` — von B1 an B2 delegiert, in der Kritik §5 als **unbesetzt** markiert — für seine Katalog‑Hälfte einen Eigentümer. Die Drawer‑Hälfte (`…rahmen-pruefliste.md:47`) bleibt B7/LFH‑335; wer Z13 abhakt, muss sagen welche.

---

## 2. Je Datei: was geändert wird, welche Tests brechen

### `frontend/src/components/KatalogTabelle.tsx`
Vier Änderungen, alle additiv:
1. `KatalogTabelleProps<T> = Omit<TableProps<T>,'scroll'|'sticky'> & { suche?: { platzhalter: string } }` (`:31`). E1: **kein** `query`, `dataSource` bleibt `dataSource`, kein neuer `<Empty>`.
2. Signatur (`:47`): zusätzlich `suche`, `dataSource`, `pagination`, `columns` herausziehen. **`{...rest}` steht heute VOR den festen Props (`:74`)** — wer `dataSource`/`pagination` nicht herausnimmt, dessen Ableitung wird von `rest` überschrieben.
3. **EINE benannte Quelle der gerenderten Zeilen:** `const sichtbareZeilen = useMemo(...)`, gefüttert aus `dataSource`, gefiltert am Suchbegriff. Das ist der Seam, an dem LFH‑331/B3 die Herkunft tauscht — als Kommentar so benannt. Bewusst **nicht** `effektiveDaten`: derselbe Name in `Datensicht.tsx` bezeichnet eine andere, größere Operation (Filter+Suche+Gruppen+Sortierung), und zwei gleichnamige Funktionen mit verschiedenem Vertrag in einem Verzeichnis sind eine Falle.
4. Werkzeugzeile **außerhalb** von `<Table>`, nur bei gesetztem `suche`, mit `data-lfh="katalog-werkzeuge"`. Feld: `Input.Search` mit `allowClear`, `style={{ width: '100%', maxWidth: 220 }}` — **kein** `size`‑Prop (E8; die Höhe kommt aus `controlHeight`, `theme/tokens.ts:265`), **keine** feste Zahlbreite. `components/` liegt außerhalb von `feldbreiten.guard.test.ts` (`BEREICHE` `:44`), die fluide Form ist trotzdem die sanktionierte.

**Der Suchwert‑Resolver ist NICHT `bezugsSchluessel`.** bericht‑1 und bericht‑2 empfehlen beide, `bezugsSchluessel` (`:40-45`) für die Suche zu benutzen — das ist falsch: die Funktion gibt bei Pfadform (`['meta','id']`) nur das **letzte** Glied zurück, und `zeile['id']` ist nicht `zeile.meta.id`. Heute unschädlich (`dataIndex: [` = 0 Treffer im Produktivcode, gemessen), aber es ist ein still‑falscher Wert, sobald jemand einen Pfad benutzt. Also ein zweiter, drei Zeilen langer `zellenWert(spalte, zeile)`, der den **vollen** Pfad läuft; `bezugsSchluessel` bleibt ausschließlich für die `id`‑DEV‑Warnung (`:64-72`).

**`showSorterTooltip={false}`** am `<Table>`. Grund: `renderMitProviders` (`frontend/src/test/utils.tsx:31`) montiert ein nacktes `<ConfigProvider>` **ohne Locale**, während die Produktion `deDE` setzt (`frontend/src/theme/ThemeModeProvider.tsx:4,110`). Der Sortier‑Tooltip ist damit im Test englisch und in Produktion deutsch — eine Textzusicherung darauf wäre entweder falsch oder umgebungsabhängig. Der Tooltip trägt am Berührungsgerät ohnehin nichts.

**Dateikopf nachziehen:** `:23` („Blätterung bleibt beim Aufrufer") ist nach S4 falsch. `:27` („Kein Spaltenschalter") bekommt per E2 den Querverweis auf `Datensicht` und behält sein Verdikt „nicht anwendbar" — begründet durch die gemessene Spaltenzahl: Maximum 7 (`FahrzeugeTab`, `PersonalTab`, `OnlineQuellenVerwaltung`, `EtbTabelle`), davon die Aktionsspalte in 12 von 14 admin‑bedingt.

**Was NICHT angefasst wird:** `fixierteSpalten` (`:58-62`) und die Zeichenkette `fixed: 'left'` — `katalogTabelle.guard.test.ts:119` pinnt sie auf **genau 1**. Und kein zweites `scroll={{` (`:117` pinnt auf genau 1).

**Brechende Tests:** `KatalogTabelle.test.tsx` — keiner der drei Bestandstests bricht. `:67` (`.ant-pagination` null bei `pagination={false}`) bleibt gültig und wird in S4 um den aussagekräftigen Fall (60 Zeilen) **ergänzt**, nicht ersetzt.

### `frontend/src/components/katalogTabelle.guard.test.ts`
`:38` Kommentar, `:39-53` Liste +6, `:101` `toHaveLength(19)`, dazu die neue `sorter:`‑Marke über die 13 (nicht die 19 — die sechs Neuzugänge bekommen in diesem Bündel keine Sortierung).

**Widerspruch zur Entscheidung, offen benannt:** §3 sagt „`katalogTabelle.guard.test.ts` bleibt byte‑identisch". Das gilt **nur für die Datensicht‑Hälfte** — `Datensicht.tsx` steht nicht in `QUELLEN`, setzt kein Scroll‑Prop, bewegt keine der drei Zählungen. Die E4‑Hälfte kann nicht byte‑identisch bleiben, sonst ist die Migration ungewacht. §9‑10 nennt **18**; ich komme auf **19**, aus zwei Gründen: §9‑10 zählt `pages/LageberichtePage.tsx` hier mit, obwohl E5 sie zu `Datensicht` mit `form="karte"` schickt (dann gehört sie ins Datensicht‑Inventar, nicht hierher), und §9‑10 lässt `pages/uhs/MaterialTab.tsx` und `pages/MitgliederAbschnitt.tsx` aus, die beide in meinem Bündel stehen. **Eigentümer dieser Datei in diesem Band: dieses Bündel.** AP5 und AP8 fassen sie nicht an.

### Die sechs Überlaufschutz‑Dateien
Je Datei: `Table` aus dem `antd`‑Import entfernen (`type TableColumnsType`/`ColumnsType` bleibt), `import KatalogTabelle from '<rel>/components/KatalogTabelle'`, `<Table…>` → `<KatalogTabelle…>`. **Kein** `scroll`, **kein** `sticky` an der Aufrufstelle (das wäre ein Guard‑Bruch, `:111-112`). Alles Übrige bleibt: `rowKey`, `loading`, `pagination={false}`, `locale.emptyText`, `onRow`, `size`.

| Datei | Elementstelle | Import | Spalte 0 (wird fixiert) | Besonderheit |
|---|---|---|---|---|
| `pages/bereitstellungsraum/BereitstellungsraeumePage.tsx` | `:97` | `:3` `Table` streichen; `../../components/KatalogTabelle` | `bezeichnung` (`:61`, Link) ✓ | `size="middle"` (`:101`) bleibt |
| `pages/PersonenDetailPage.tsx` | `:511` | `:1` `Table` streichen; `../components/KatalogTabelle` | `zugriff_at` (`:285`) | s. Falle unten |
| `pages/SchaedenPage.tsx` | `:134` | `:5` `Table` streichen; `../components/KatalogTabelle` | `registrier_nr` (`:66`) ✓ | **kein** `suche`‑Prop — die Seite hat ihres bei `:126` |
| `pages/uhs/MaterialTab.tsx` | `:90` | `:2` `Table` streichen; `../../components/KatalogTabelle` | `bezeichnung` (`:59`) ✓ | `size="small"` (`:94`) bleibt Bestand (Abbau = B5); `columns` ist untypisiert → generische Form `<KatalogTabelle<EinsatzMaterial>` explizit schreiben |
| `pages/UnfallhilfsstellenPage.tsx` | `:69` | `:1` `Table` streichen; `../components/KatalogTabelle` | `bezeichnung` (`:45`, Link) ✓ | hat **kein** `locale.emptyText` — **nicht nachrüsten**, Leerzustände gehören B3 |
| `pages/MitgliederAbschnitt.tsx` | `:124` | `:1` `Table` streichen; `../components/KatalogTabelle` | `anzeigename` (`:59`) ✓ | `<Table>` ohne Generik → `<KatalogTabelle<MitgliedAnzeige>` explizit, `T extends object` braucht die Bindung; `size="small"` (`:126`) bleibt |

**Brechende Tests:** keine. Geprüft in `pages/SchaedenPage.test.tsx`, `pages/PersonenDetailPage.test.tsx`, `pages/UnfallhilfsstellenPage.test.tsx`, `pages/MitgliederAbschnitt.test.tsx` — 0 Vorkommen von `getAllByRole('row')`, `role: 'cell'`, `.ant-table`, `querySelectorAll`. Für `pages/bereitstellungsraum/BereitstellungsraeumePage.tsx` und `pages/uhs/MaterialTab.tsx` existiert kein Test. `pages/uhs/UhsDetailPage.test.tsx` rendert MaterialTab über Tabs; auch dort keine Strukturzusicherung.

### `sorter`/`filters` je Katalogdatei — die vollständige Enumeration
`sorter` immer als Vergleichsfunktion (`localeCompare` für Text mit `?? ''`, Subtraktion für Zahlen). **Kein `defaultSortOrder` irgendwo** — das löst bericht‑2s offene Frage 4 ohne Nebenwirkung: die fünf reinen Kataloge werden serverseitig `ORDER BY sortier, id` geliefert, und eine erzwungene Anfangssortierung nach `label` ließe die Katalogreihenfolge gegen die Reihenfolge in den Auswahllisten laufen. `filters` **immer mit eigenem `onFilter`** (§3).

| Datei | `sorter` auf | `filters` (+`onFilter`) auf | `suche` | `pagination={false}` entfernen |
|---|---|---|---|---|
| `stammdaten/FahrzeugeTab.tsx` | `funkrufname` `:36`, `fahrzeugtyp` `:37` | `fahrzeugtyp` `:37`, `traeger` `:38`, `dienststatus` `:41-46` (render‑only) | ja | ja |
| `stammdaten/PersonalTab.tsx` | `name` `:30`, `personalnummer` `:31` | `staerke_position` `:43`, `traeger` `:48`, `dienststatus` `:50` (render‑only) | ja | ja |
| `stammdaten/MaterialTab.tsx` | `bezeichnung` `:30` | `kategorie` `:31`, `traeger` `:33`, `dienststatus` `:35` (render‑only) | ja | ja |
| `stammdaten/SprechgruppenTab.tsx` | `bezeichnung` `:32` | `betriebsart` `:34`, `aktiv` `:46` | ja | ja |
| `pages/BenutzerPage.tsx` | `anzeigename` `:80`, `benutzername` `:81` | `rollen` `:82-90` (render‑only), `status` `:93-97` (render‑only) | ja | ja |
| `stammdaten/EtbBausteineTab.tsx` | `label` `:31`, `sortier` `:34` | `typ` `:32` | ja (`inhalt` ist der Nutzen) | nein |
| `karten/OnlineQuellenVerwaltung.tsx` | `name` `:44`, `sortier` `:62` | `typ` `:46`, `aktiv` `:64` | nein | nein |
| `stammdaten/StatusKatalogTab.tsx` | `label` `:78`, `sortier` `:87` | `kategorie` `:80` | nein | nein |
| `stammdaten/PersonalStatusTab.tsx` | `label` `:72`, `sortier` `:80` | `kategorie` `:74` | nein | nein |
| `stammdaten/QualifikationenTab.tsx` | `label` `:59`, `sortier` `:60` | — | nein | nein |
| `stammdaten/EinheitTypenTab.tsx` | `label` `:70`, `sortier` `:72` | — | nein | nein |
| `stammdaten/StichworteTab.tsx` | `text` `:50` | — | nein | nein |
| `karten/OfflineKartenVerwaltung.tsx` | `name` `:149` | `status` `:176` | nein | nein |
| `etb/EtbTabelle.tsx` | **nichts** | **nichts** | **nein** | nein |

`etb/EtbTabelle.tsx` bleibt vollständig unberührt und braucht mit opt‑in‑Suche **keine** Zeile Änderung: `src/etb/repo.rs` liefert `STANDARD_LIMIT = 100`, sortiert `lfd_nr DESC` und `pages/EtbPage.tsx` blättert per `hasNextPage`. Client‑Sortierung oder ‑Suche über ein Serverfenster ordnet nur den Ausschnitt und sieht wie eine vollständige Antwort aus. Sie steht deshalb auch **nicht** in der `sorter:`‑Marke von S5(b) — die gilt für die 13, nicht für die 14.

**Brechende Tests der 13:** keiner. Geprüft: `stammdaten/*.test.tsx`, `karten/OnlineQuellenVerwaltung.test.tsx`, `karten/OfflineKartenVerwaltung.test.tsx`, `pages/BenutzerPage.test.tsx` enthalten **0** `getAllByRole`/`toHaveLength`/Zeilenzählungen. `pages/BenutzerPage.test.tsx` greift Zeilen über `screen.findByText('Eva').closest('tr')` (`:102`, `:150`, `:194-195`) — reihenfolge‑ und blätterungsunabhängig, und die Fixtures liegen weit unter 50 Zeilen, die Blätterung erscheint dort also nicht.

### `frontend/src/components/Datensicht.tsx`
Die API steht in der Entscheidung §2 und wird 1:1 umgesetzt. Drei Punkte, die dort implizit bleiben und hier festgelegt werden müssen:
- **`Datensicht` gibt `KatalogTabelle` explizit `pagination={false}` und setzt `suche` nicht.** Sonst greift der S4‑Default und blättert unter der Zeilenschleuse weg, und das S3‑Suchfeld stünde als zweites neben dem eigenen. Der Guard aus S9 sieht das nicht (er zählt nur `<KatalogTabelle` ≥ 1) → gehört als Zusicherung in `Datensicht.test.tsx`: bei 1024 px und 60 Zeilen ist `.ant-pagination` null und es existiert genau **ein** `input[type="search"]`.
- **Zwei Stellen, an denen `Datensicht` die Spaltenliste vor der Übergabe verändert**, beide seine: `abBreite`‑Auflösung (Spalte streichen) und Injektion von `sorter: true` + kontrolliertem `sortOrder`. `sorter: true` **ohne** `onFilter`‑Analogon ist hier korrekt, weil nur der Pfeil gebraucht wird; sortiert wird in `effektiveDaten`. Genau diese Zeile ist der Grund, warum die `sorter:`‑Marke von S5(b) auf die **13** und nicht auf `Datensicht.tsx` zielt.
- **Der Dateikopf** wird wörtlich aus der Entscheidung §7 übernommen, **inklusive der Umschreibungen**: „kein Scroll‑Prop", „die Kartenform ist `Liste`, nicht `Card`". Wer die verbotenen Marken ausschreibt, füllt sein eigenes Gate — die Lehre steht als Erinnerung im Memory (`gate-kommentar-fuellt-eigenes-gate`). Der Kommentar‑Stripper ist die zweite Verteidigung, nicht die erste.

---

## 3. Die Fallen — Tests, die nach der Änderung grün bleiben, ohne etwas zu belegen

1. **`filters` ohne `onFilter` filtert NICHTS, zeigt aber den Trichter.** Gemessen: `node_modules/antd/es/table/hooks/useFilter/index.js:13` schaltet die Filter‑UI ein, sobald `column.filters` gesetzt ist; `:118` filtert nur bei `onFilter && filteredKeys.length`. Ein Test, der den Trichter oder einen `filters`‑Eintrag im Quelltext prüft, ist grün, während die Filterung ein No‑op ist. Das trifft **alle** `filters`‑Spalten, nicht nur die render‑only — die von bericht‑2/AP2 gezogene Grenze „nur die mit `dataIndex` gehen ohne eigenes Prädikat" ist falsch. Gegenmaßnahme: S5(a) prüft die Zeilenmenge nach dem Filterklick und hat einen Gegenfall ohne `onFilter`.

2. **Die sechs Migrationen sind für die bestehende Suite unsichtbar.** Nach dem Elementtausch laufen `pages/SchaedenPage.test.tsx`, `pages/PersonenDetailPage.test.tsx`, `pages/UnfallhilfsstellenPage.test.tsx`, `pages/MitgliederAbschnitt.test.tsx` unverändert grün — sie zusichern nichts über Scroll, Sticky oder Fixierung. Der Inventar‑Guard ist der einzige Beleg. Deshalb S1 vor S2.

3. **Die Blätterung ist in e2e strukturell unprüfbar.** Jede Playwright‑Fixture und jede Vitest‑Fixture liegt weit unter 50 Zeilen; der Zweig läuft nie. Der ehrliche Nachweis ist das Grenzpaar aus S4 **plus** der Fall „60 Zeilen mit `pagination={false}` → keine Blätterung". Der Bestandspin `KatalogTabelle.test.tsx:67` prüft es mit **leerer** `dataSource` und kann konstruktiv nicht fallen.

4. **`pagination={false}` in allen 14 Aufrufstellen macht jeden Primitiv‑Default zum No‑op.** `KatalogTabelle.tsx:74` spreizt `{...rest}` vor die festen Props, `rest.pagination` erreicht die Table unangefochten. Ein Default, den niemand sieht, ist kein Default. Deshalb wird `pagination={false}` in genau fünf Dateien entfernt (Tabelle in §2) — und nur dort, wo die Zeilenzahl das rechtfertigt.

5. **Ein Suchtest kann grün sein und die falschen Spalten durchsuchen.** Render‑only‑Spalten sind unerreichbar: `Stärke` (`FahrzeugeTab.tsx:40`), `Qualifikationen` (`PersonalTab.tsx:33`), `Status`/`dienststatus` (Fahrzeuge/Material/Personal), `Rollen`+`Status` (`BenutzerPage.tsx:82/93`), `soll` (`EinheitTypenTab.tsx:71`), `Anzeige` (`OfflineKartenVerwaltung.tsx:220`), `Ereigniszeit`+`Von → An` (`EtbTabelle.tsx:45/66`). Ein Test mit einem Begriff, der zufällig auch in einer `dataIndex`‑Spalte steht, belegt nichts. S3 Fall 3 pinnt die Grenze durch eine **negative** Zusicherung.

6. **`bezugsSchluessel` als Suchresolver liefert bei Pfadform still den falschen Wert.** `KatalogTabelle.tsx:40-45` reduziert `['meta','id']` auf `'id'`. Heute ohne Fundstelle im Produktivcode (`dataIndex: [` = 0), aber `KatalogTabelle.test.tsx:121` benutzt genau diese Form — ein Suchtest an dieser Fixture wäre grün und falsch. Voller Pfadlauf in `zellenWert`.

7. **`sorter` sitzt in der Zelle, die das Primitiv unbedingt fixiert.** In allen 13 ist die Leitspalte auch Spalte 0 (`funkrufname`, `bezeichnung`, `label`, `name`, `anzeigename`, `text`) — also im `position: sticky`‑`th` innerhalb eines `overflow: auto`‑Containers. `katalogtabelle-schmal.spec.ts` klickt nirgends in die Kopfzeile; jsdom rechnet kein Layout (`vite.config.ts` `css: false`). Ohne S10(g) geht diese Interaktion unbewiesen in Produktion.

8. **`sichtbareSpalten` darf Index 0 nicht entfernen können.** `KatalogTabelle.tsx:58-62` fixiert, was als Spalte 0 **ankommt**, nicht eine benannte. Wenn `abBreite` oder der Spaltenschalter Spalte 0 streichen kann, wird still eine andere Spalte die fixierte Kennung — kein Fehler, kein roter Test, nur eine falsche Fixierung. `immerSichtbar` ist dafür **nicht** ausreichend (es ist ein Flag, das jemand vergisst); die Invariante gehört in `sichtbareSpalten` und in einen eigenen Testfall.

9. **Der Spaltenzähler darf nicht lügen können.** Wenn antds `responsive` oder `hidden` überlebt, verbirgt antd Spalten, die der Zähler nicht kennt. Beide sind in `AntdErbe<T>` amputiert; der Test prüft, dass `anzahlVerborgen` **beide** Ursachen (Handauswahl + `abBreite`) in einer Zahl addiert. Ein Zähler, der „0 ausgeblendet" meldet, verfehlt Kriterium 14, für das er existiert.

10. **„Zeilenzahl ist nicht gewachsen" ist auch grün, wenn neue Daten komplett ignoriert werden.** S8 Fall 2 (Zellinhalt aktualisiert sich weiter) ist die Pflichthälfte.

11. **Der Schmal‑Zweigtest ohne Breit‑Gegenprobe** ist auch grün, wenn die Weiche bei jeder Breite anspringt — die Lehre steht im Repo, `einsatz/EinsatzLayout.test.tsx:119-120`. Und `setzeViewportBreite` **vor** dem Render (`test/viewport.ts:112-118`), weil `abBreiteAus` „unbekannt" als breit liest (`useViewport.ts:72-74`).

12. **Die Sticky‑Kopfzeile zieht Kopf und Körper in zwei `<table>` und schiebt eine verborgene Messzeile ein** (`KatalogTabelle.tsx:15-17`). Jeder neue Zeilentest verengt auf `tr.ant-table-row`; `getAllByRole('row')` zählt anders als erwartet.

13. **Die Werkzeugzeile muss AUSSERHALB von `.ant-table` liegen.** `katalogtabelle-schmal.spec.ts:80-83` misst `scrollWidth` am `.ant-table`‑Wurzelknoten gegen 390 px; eine Leiste darin zählte in dieses Maß und machte die Messung stumpf. Zusätzlich hängt Schritt (f) an `ziel = kopfVor.y + 20` (`:152`) — eine Zeile darüber verschiebt Startposition **und** Bildlaufreserve um denselben Betrag, der Spec hält, aber wer die Zeile in den Rahmen hineinbaut, bricht (b).

14. **`showSizeChanger` erscheint von selbst.** `@rc-component/pagination@1.4.0/es/Pagination.js:47`: `showSizeChanger = total > totalBoundaryShowSizeChanger` (Grenze 50). Bei genau der Zeilenzahl, ab der geblättert wird, taucht also das breiteste Element der Leiste auf — auf `/admin/benutzer`, das bei 390 px sowohl `gate1-ueberlauf.spec.ts:162` als auch `katalogtabelle-schmal.spec.ts` messen. Explizit `false`.

15. **Locale‑Drift zwischen Test und Produktion.** `test/utils.tsx:31` montiert `<ConfigProvider>` ohne Locale, `theme/ThemeModeProvider.tsx:110` setzt `deDE`. Filter‑Dropdown‑Knöpfe („Reset"/„OK" vs. „Zurücksetzen"/„OK") und der Sortier‑Tooltip sind im Test englisch. Jede Textzusicherung darauf ist eine Zeitbombe → Filtermenüs über die **eigenen** `filters[].text`‑Werte greifen und die Knöpfe über `.ant-table-filter-dropdown-btns .ant-btn-primary`. `showSorterTooltip={false}` nimmt die zweite Hälfte ganz weg.

16. **Ein globales `/`‑Kürzel frisst den Slash der ETB‑Schnellerfassung.** `etb/schnellerfassungModell.ts` erkennt das Slash‑Menü aus dem **Textinhalt** der Textarea, nicht über eine Tastenbindung; `pages/EtbPage.tsx` rendert Schnellerfassung und `EtbTabelle` auf derselben Seite. Pflicht: Abbruch, wenn `event.target` ein `input`/`textarea`/`contenteditable` ist. Zweitens, gemessen: **`pages/uhs/UhsDetailPage.tsx:130` rendert `Tabs` OHNE `destroyOnHidden`** — nach Besuch beider Reiter sind `uhs/MaterialTab` und `uhs/BewegungenTab` gleichzeitig montiert. Zwei Instanzen mit `/`‑Bindung streiten dann um den Fokus. Deshalb: **ein** modulweiter, ref‑gezählter `window`‑Zuhörer, der bei mehr als einer montierten Instanz mit `suche` nichts tut und in DEV warnt. Vorbild für die Auf‑/Abmelde‑Hälfte: `command-palette/CommandPaletteProvider.tsx:22-30`, die einzige globale Tastenbindung des Frontends.

17. **Die DEV‑Warnung des Primitivs prüft nur das Literal `id`.** `pages/PersonenDetailPage.tsx` bekommt `zugriff_at` als fixierte Kennungsspalte (`:285`). Die Warnung schweigt — das ist **kein** Beleg für Kriterium‑14‑Konformität, ein Zeitstempel ist keine Kennung. Bewusste Annahme für ein Zugriffs‑Audit, das chronologisch gelesen wird; als Zeile in der Prüfliste vermerken, nicht stillschweigend abhaken.

18. **`etb/EtbTabelle.tsx` steht nicht im Inventar** (`katalogTabelle.guard.test.ts:39-53` listet 13, sie ist die 14. Konsumentin). Verlangt eine Prop‑Änderung Anpassungen der Konsumenten, driftet sie **still** heraus. Für dieses Bündel bleibt sie unberührt — genau deshalb war die opt‑in‑Suche die Wahl. Ihre Aufnahme ins Inventar ist ein eigener, benannter Restposten (§5).

19. **`feldbreiten.guard.test.ts` erlaubt in `stammdaten/StichworteTab.tsx` und `karten/OfflineKartenVerwaltung.tsx` GENAU EINE numerische `width:`** (`:118-123`, `expect(anzahl, pfad).toBe(1)`), und beide Plätze sind belegt (Spaltenbreite 120 bzw. Progress 120). Eine zusätzliche Spalten‑`width:` in einer dieser zwei Dateien bricht den Guard — auch eine, die nur „aufräumt".

---

## 4. Verifikation — die exakten Kommandos

`pnpm` läuft über `mise exec`, `-C` immer absolut. `rtk proxy` um jedes Kommando, dessen Exit‑Code als Gate zählt (der rtk‑Hook maskiert ihn sonst).

```bash
W=/Users/rubeen/dev/personal/lifeline-hub/.claude/worktrees/lfh-330-einsatzlisten-primitive
P="mise exec pnpm@11.10.0 -- pnpm -C $W/frontend"

# --- während der Arbeit: nur die Dateien dieses Bündels
rtk proxy $P exec vitest run \
  src/components/KatalogTabelle.test.tsx \
  src/components/katalogTabelle.guard.test.ts \
  src/components/Datensicht.test.tsx \
  src/components/datensicht.guard.test.ts \
  src/components/feldbreiten.guard.test.ts \
  src/components/useViewport.guard.test.ts \
  src/components/Liste.test.tsx

# --- Blast-Radius der sechs Migrationen und der 13 Katalogdateien
rtk proxy $P exec vitest run \
  src/pages/SchaedenPage.test.tsx \
  src/pages/PersonenDetailPage.test.tsx \
  src/pages/UnfallhilfsstellenPage.test.tsx \
  src/pages/MitgliederAbschnitt.test.tsx \
  src/pages/uhs/UhsDetailPage.test.tsx \
  src/pages/BenutzerPage.test.tsx \
  src/stammdaten src/karten

# --- Typen und Lint (Lint ist --max-warnings 0, Warnings brechen)
rtk proxy $P exec tsc --noEmit
rtk proxy $P lint

# --- Vollsuite, seriell (unter Last sonst flaky — so auch in check-all.sh Schritt 5)
rtk proxy $P exec vitest run --no-file-parallelism

# --- Browsernachweis S10. Braucht target/debug/lifeline-hub, sonst überspringt
#     playwright.config.ts laut (:17-24) und ein leerer Lauf sähe grün aus.
ls -l $W/target/debug/lifeline-hub
rtk proxy $P exec playwright test e2e/katalogtabelle-schmal.spec.ts
rtk proxy $P exec playwright test e2e/gate1-ueberlauf.spec.ts

# --- Sammel-Gate vor dem Merge
rtk proxy $W/scripts/check-all.sh
```

Gegenproben, die per Hand zu fahren sind, weil kein Test sie erzwingt (Mutationsproben — je einzeln, danach zurücknehmen):
- `scroll={{ x: 'max-content' }}` aus `KatalogTabelle.tsx:74` entfernen → `katalogTabelle.guard.test.ts:117` und `KatalogTabelle.test.tsx:53` müssen rot werden.
- `onFilter` aus einer `filters`‑Spalte entfernen → S5(a) muss rot werden (sonst ist Falle 1 nicht abgedeckt).
- In `sichtbareSpalten` den Index‑0‑Schutz entfernen → S6 muss rot werden.
- In `Datensicht` den `pagination={false}`‑Durchgriff an `KatalogTabelle` entfernen → der 60‑Zeilen‑Fall aus §2 muss rot werden.
- `showSizeChanger: false` entfernen → S4 Fall 2 muss rot werden.

Keine `| tail`‑Pipes um Gate‑Kommandos (maskiert Exit‑Codes). Kein achter Shell‑Schritt in `scripts/` — es gibt dort kein einziges grep‑basiertes Gate; neue Gates sind Vitest‑Guards (Schritt 5) oder Specs (Schritt 7).

---

## 5. Was dieses Bündel NICHT liefert

1. **Keinen einzigen `Datensicht`‑Konsumenten.** Folge: die API ist gegen keine reale Aufrufstelle validiert. Die sechs Aufrufbeispiele der Entscheidung §6 sind ungeprüfter Text. **Empfehlung: das erste Konsumentenbündel (AP3 `FahrzeugePage` oder AP7 `BefehlListe`) läuft unmittelbar danach und darf die API ändern statt um sie herum zu bauen** — insbesondere `TitelBezug`, `PrimaerAktion` und die Baumrekursion sind an drei bis fünf konkreten Stellen entstanden, nicht an fünfzehn.

2. **Keinen e2e‑Nachweis für irgendeinen `Datensicht`‑Zweig.** Es gibt keine Route, die einen rendert. Also: kein `frontend/e2e/datensicht-schmal.spec.ts`, keine 390‑px‑Trefflächenmessung an Titel‑Link/Aktionsknopf/Spaltenschalter, keine Gegenprobe bei 1366. Alle Layout‑, Farb‑ und Trefflächenaussagen zu `Datensicht` bleiben unbewiesen, weil jsdom kein Layout rechnet (`vite.config.ts` `css: false`).

3. **Nicht die „Lieferbedingung, nicht Nachlauf"‑Nachweise der Entscheidung §8** — `fixed:'left'` × Aufklapp‑Icon im Meldebild‑Baum und den Druckpfad der Kräfteübersicht durch den `overflow`‑Container. Beide brauchen `pages/KraefteuebersichtPage.tsx` auf `Datensicht`, das ist AP6. Bis dahin ist `form="tabelle"` am Meldebild **nicht belegt**, und die Entscheidung sagt das selbst. Was ich stattdessen liefere, ist der Nachweis der **verwandten, bisher völlig unbeachteten** Interaktion `fixed:'left'` × `sorter` auf einer Route, die es hier schon gibt (S10).

4. **Keinen Spaltenschalter‑Adressaten.** E2 verlegt den Schalter in `Datensicht`, seine Zielseiten (`pages/PersonalPage.tsx` 9 Spalten, `pages/FahrzeugePage.tsx` 8) liegen in AP3. Der Schalter ist hier gebaut und unit‑getestet, aber nirgends im Produkt sichtbar. Das Z14‑Verdikt der Katalogtabellen‑Prüfliste bleibt „nicht anwendbar" (Maximum 7 Spalten, gemessen).

5. **Keinen Deeplink und keine Persistenz** für Sortierung, Filter, Suche, Spaltenauswahl. Kein `localStorage`, kein `sichtId`, kein `?sort=`. Begründung in der Entscheidung §4 (Freitextschlüssel als Speicherort ist das per AST‑Scanner verbotene Query‑Key‑Muster); Persistenz braucht eine Registry und einen `addInitScript`‑Pfad. → eigenes Ticket.

6. **Kein `art: 'eigen'`‑Nutzer, keine Zeitleiste.** `KARTEN_EIGENBAU` ist bei Lieferung leer mit `toHaveLength(0)`. Die UHS‑Zeitleiste ist AP5 und läuft laut Entscheidung über den Plan‑Modus.

7. **Keine In‑Zeile‑Bedienung im Kartenzweig.** Betrifft mein Bündel nur mittelbar, weil ich keine Konsumenten habe — aber die Zusicherung „genau eine Primäraktion" ist gebaut, und `pages/PersonalPage.tsx`/`pages/FahrzeugePage.tsx` haben keine Detailroute, auf die man Statuswechsel und Bemerkungen verlagern könnte. Der Funktionsverlust unter `md` entsteht in AP3, nicht hier. → B5/LFH‑333.

8. **Keine Aufnahme von `etb/EtbTabelle.tsx` ins Inventar.** Sie ist die 14. Konsumentin und bleibt außerhalb der 19 — sie zu ergänzen wäre richtig, ändert aber die Zahl in einer Datei, die drei Bündel anfassen wollen, ohne dass mein Bündel sie berührt. Als benannter Restposten mit Eigentümer (AP8) statt als stiller Nebeneffekt.

9. **Keine Änderung an `components/Liste.tsx`.** Deren Props‑Interfaces sind alle nicht exportiert (`:38`, `:132`, `:200`), `ListenGroesse` ebenso (`:29`) — ein `Pick<ListeProps<T>,…>` ist nicht möglich. `Datensicht` konsumiert `Liste`/`ListenEintrag`/`ListenEintragMeta` über deren öffentliche Funktionssignaturen und tastet die Datei nicht an. Der `LeerZustand`‑Default an `Liste.tsx:81` ist B3.

10. **Keine Tastaturbedienbarkeit des Karten‑Containers.** `ListenEintrag` (`Liste.tsx:141-161`) ist ein nacktes `<div onClick>` ohne `role`, `tabIndex`, `onKeyDown`. Das Tastaturziel der Karte ist ausschließlich der Titel‑`<Link>` — die klickbare Karte als Ganzes ist B7/LFH‑335 samt `Liste.tsx`. Ebenso: eine Zeile, die verschwindet, während sie den Fokus hält, nimmt ihn mit; die Zeilenschleuse hält nur Zuwachs zurück.

11. **Nicht das Doku‑Paket (Lücke A der Kritik).** Die Listenform‑Regel steht bereits in `CLAUDE.md:57-59` (von A1 eingezogen), aber `docs/superpowers/specs/2026-06-22-drawer-nutzung-reduzieren-design.md:60` regelt weiter nur Route/Modal/Drawer/Inline und kennt keine Listenform‑Regel. Diese Hälfte ist von **keinem** Arbeitspaket besetzt und gehört in LFH‑330, nicht in eine Folge. Ebenso unbesetzt: die ausgefüllte Prüfliste Einsatztauglichkeit für das Gesamtticket (die 15 Zeilen der Entscheidung §9 sind ein Entwurf, kein abgelegtes Dokument).

12. **Nicht die drei zusätzlichen `gate1-ueberlauf.spec.ts`‑Routen** (Kräfteübersicht, Personalseite, Befehle‑Tab). Die zugehörigen Seiten existieren in ihrer neuen Form erst nach AP3/AP6/AP7; ein Anker auf eine noch unveränderte Seite wäre ein Gate, das nichts über dieses Band sagt. Eigentümer: AP8. Meine e2e‑Änderung bleibt auf `katalogtabelle-schmal.spec.ts` beschränkt — dieselbe Datei, dieselbe Route, keine Kollision.