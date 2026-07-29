# Bündel I — Betroffene/Tiere: Zeit sichtbar und sortierbar

# Umsetzungsplan Bündel I — Betroffene/Tiere: Zeit sichtbar und sortierbar (LFH-330 · B2)

Arbeitswurzel: `/Users/rubeen/dev/personal/lifeline-hub/.claude/worktrees/lfh-330-einsatzlisten-primitive`
Alle Pfade unten relativ zu `frontend/` dieser Wurzel, sofern nicht absolut angegeben.

---

## 0. Ausgangslage — am Code nachgeprüft, nicht aus den Berichten übernommen

| Behauptung | Messung |
|---|---|
| `personenSpalten` ist ein flaches Const mit 7 Spalten | ✅ `personen/personenSpalten.tsx:16-42`; Keys `reg`·`status`·`sk`·`name`·`geschlecht`·`alter`·`antreff_ort` |
| `abgleichSpalte` ist eine Factory, liefert `TableColumnsType<Person>`, `size="small"` bei :53 | ✅ `:46-61`, `size="small"` bei `:53` |
| Genau zwei Konsumenten des Registers | ✅ `PersonenPage.tsx:166` (Patienten) und `:183` (Liste) — sonst nichts im Repo |
| PersonenPage hat **zwei** rohe `<Table>` | ✅ `:163-169` (in `PATIENT_SK.map`, bis 5 Instanzen) und `:179-187` |
| PersonenPage: Inline-Filterkette, kein Suchfeld, keine Sortierung | ✅ `:107-109` (Sicht), `:111` (`gefundene`), `:113-115` (`aktionsSpalte`) |
| TierePage: Spalten lokal, 7 Spalten, ein Spezies-`Select` ohne `aria-label` | ✅ `:92-109`, Select `:134-136`; das `<Typography.Text>Spezies:</Typography.Text>` bei `:133` ist **kein** `<label>` |
| TierePage: eine rohe `<Table>` | ✅ `:143-151` |
| `ZeitAnzeige` kann kein relatives Alter | ✅ `anzeige/ZeitAnzeige.tsx:16` — genau 4 Formate; `anzeige/format.ts:18-19` lädt nur `utc`+`timezone` |
| `TierAnzeige` hat keine Sichtung | ✅ `api/types.generated.ts` — `aktuelle_sichtung*` existiert nur unter `PersonAnzeige` (`:1727-1728`) |
| Erster `sorter`/`filters:` im Frontend | ✅ 0 Treffer — es gibt kein Hausmuster |
| `personenSpalten` hat keine Testdatei | ✅ `personen/` enthält nur `personMeta.test.ts` und `PersonVerlauf.test.tsx` |
| `renderMitProviders` hängt keinen `EinsatzAnzeigeProvider` ein | ✅ `test/utils.tsx` — ConfigProvider/AntApp/Auth/MemoryRouter, sonst nichts ⇒ jede Zeit rendert in Runner-Zeitzone |
| `format="kurz"` ist der Tabellen-Präzedenzfall | ✅ `etb/EtbTabelle.tsx:50`; `dtgVoll` in `PersonenDetailPage.tsx:285`, `uhs/BewegungenTab.tsx:31` |
| Keine der drei Dateien steht im 13er-Inventar von `components/katalogTabelle.guard.test.ts` | ✅ — dieser Guard bleibt **byte-identisch**, nichts daran anzufassen |

**Harte Vorbedingung:** `frontend/src/components/Datensicht.tsx` existiert **nicht** (0 Treffer in `src/`, `e2e/`, `docs/`). Jeder Test, der `<Datensicht>` rendert, ist heute rot wegen Modulauflösung, nicht wegen Verhalten — das ist blockiert, nicht TDD. Der Plan trennt deshalb Phase A (heute vollständig fahrbar) von Phase B (nach AP1).

---

## 1. Reihenfolge der Schritte — erst der Test, dann der Code

### PHASE A — ohne `Datensicht` fahrbar, heute

#### A1 · Testhärtung Spezies-Select (Vorarbeit, keine Funktionsänderung)
- **Test zuerst:** `pages/TierePage.test.tsx:85` von `screen.getByRole('combobox')` auf `screen.getByRole('combobox', { name: 'Spezies' })` umstellen.
- **Warum rot ohne Code:** der Select bei `TierePage.tsx:134` trägt heute keinen zugänglichen Namen (die `Typography.Text` daneben ist kein `<label>`, kein `htmlFor`, kein `aria-label`) → `name`-Filter findet nichts.
- **Code:** `aria-label="Spezies"` am `<Select<Spezies|undefined>` in `TierePage.tsx:134`.
- **Warum nicht trivial grün:** der Namensfilter greift nur bei gesetztem `aria-label`; ohne ihn wirft RTL „unable to find role combobox with name".
- **Warum überhaupt:** die Werkzeugzeile von `Datensicht` (Sortierauslöser, Spaltenschalter bei 8 Spalten) kann ein zweites Combobox-artiges Element mitbringen. Diese Zeile bricht dann in Phase B aus einem Grund, der mit Tieren nichts zu tun hat. Getrennt gefahren ist der Bruch diagnostizierbar.

#### A2 · `seit`-Wertregel als reine Funktion
- **Test zuerst:** neue Datei `personen/personenSpalten.test.tsx`.
  ```
  seitWert(person) → aktuelle_sichtung_at, wenn gesetzt
  seitWert(person ohne Sichtung) → erfasst_at
  seitWert ist NIE undefined (erfasst_at ist Pflichtfeld in PersonAnzeige)
  ```
- **Warum rot:** `seitWert` existiert nicht.
- **Warum nicht trivial grün:** der zweite Fall fällt bei einer `?.`-Verwechslung (`aktuelle_sichtung_at?.` statt `??`) durch; der erste bei einem stumpfen `erfasst_at`.
- **Code:** `export function seitWert(p: Person): string` in `personen/personenSpalten.tsx` — `p.aktuelle_sichtung_at ?? p.erfasst_at`.

#### A3 · `SkTag` aus dem Inline-`render` herausziehen
- **Test zuerst:** in `personen/personenSpalten.test.tsx`:
  ```
  SkTag mit aktuelle_sichtung='sk2' → Text 'SK II'
  SkTag ohne Sichtung → Text '—'
  ```
- **Warum rot:** die Logik liegt heute als anonymes `render` bei `personenSpalten.tsx:27-30` und ist nicht adressierbar.
- **Code:** `export function SkTag({ p }: { p: Person })` in `personen/personenSpalten.tsx`, Rumpf 1:1 aus `:27-30` (`Tag color={SK_META[...]}`, sonst `Typography.Text type="secondary">—`). **`SK_META` bleibt unverändert** — die antd-Farbnamen sind A2-gepinnt (`personen/personMeta.test.ts:6-10` pinnt Schlüsselmenge + `sk1`/`tot` byte-genau), `personMeta.ts` ist in diesem Bündel **read-only**.

#### A4 · Filterketten als reine Funktionen (Muster `pages/schaeden/schadenHelfer.tsx:57-71`)
- **Test zuerst:** neue Dateien `personen/personenFilter.test.ts` und `pages/tiere/tierHelfer.test.ts`.
  ```
  filterPersonen(alle, 'alle')       → alle
  filterPersonen(alle, 'patienten')  → alle (die SK-Achse filtert Datensicht/gruppen, nicht der Helfer)
  filterPersonen(alle, 'vermisst')   → nur status==='vermisst'
  gefundenePersonen(alle)            → betroffen|verstorben UND storniert_at==null
  gefundenePersonen mit storniert_at → schließt aus            ← der Fall, der bei einem
                                                                  vergessenen !storniert_at fällt
  filterTiere(alle, { sicht:'alle',  spezies: undefined }) → alle
  filterTiere(alle, { sicht:'aktiv', spezies: 'katze' })   → Schnittmenge, nicht Vereinigung
  ```
- **Warum rot:** beide Funktionen existieren nicht.
- **Warum nicht trivial grün:** der `storniert_at`-Fall und der Schnittmengen-Fall scheitern bei den naheliegenden Fehlgriffen.
- **Code:** neu `personen/personenFilter.ts` mit `filterPersonen(alle, sicht)` + `gefundenePersonen(alle)`; neu `pages/tiere/tierHelfer.ts` mit `filterTiere(alle, opts)`. **Kein `Input.Search`-Anteil in diesen Helfern** — die Freitextsuche lebt in `Datensicht` über `suchText` je Spalte (§2 unten). `SchaedenPage` liefert nur die *Semantik* (`suche.trim()`-Kurzschluss, `toLowerCase().includes`), nicht ein zweites Suchfeld.
- **Verdrahten:** `PersonenPage.tsx:107-111` und `TierePage.tsx:88-90` rufen die Helfer. Die bestehenden Tab-Tests (`PersonenPage.test.tsx:73`, `TierePage.test.tsx:74`) bleiben grün und sind der Regressionsnachweis für diesen Umbau.

### PHASE B — ab hier ist `components/Datensicht.tsx` Vorbedingung

#### B1 · Spaltenregister umstellen (`personen/personenSpalten.tsx`)
- **Test zuerst** (`personen/personenSpalten.test.tsx`, reine Register-Prüfungen, kein Rendern):
  ```
  personenSpalten enthält genau einmal key==='seit'
  die seit-Spalte trägt sortWert, und sortWert === seitWert (gleicher Rückgabewert für dieselbe Person)
  die reg-Spalte trägt sortWert (registrier_nr) und suchText (registrierAnzeige → 'R-001')
  die name-Spalte trägt suchText, das bei name=null|vorname=null einen leeren/nullischen Wert liefert
    (sonst matcht die Suche 'unbekannt' als Namen)
  pruefeKartenplan({ spalten: personenSpalten, karte: personenKarte(1) }, 'Personen') === []
  ```
  Die letzte Zeile ist der Riegel gegen das `const K`-Widening: sie ruft `pruefeKartenplan` **direkt** (kein console-Spion), wie in der API-Entscheidung vorgesehen.
- **Warum rot:** `seit` existiert nicht, `sortWert`/`suchText` existieren am Spaltentyp nicht, `personenKarte` existiert nicht.
- **Code:**
  - `personenSpalten` wird `spaltenFuer<Person>()([...])`; Reihenfolge und Rendern der sieben Bestandsspalten bleiben **unverändert**, `sk` nutzt jetzt `<SkTag p={p} />`.
  - neue Spalte `{ key: 'seit', title: 'seit', sortWert: seitWert, render: (_t, p) => <ZeitAnzeige wert={seitWert(p)} /> }` — Position **hinter `alter`, vor `antreff_ort`**, damit `antreff_ort` (der schmalste Nutzwert) das `abBreite: 'xl'` trägt.
  - `abBreite`: `geschlecht`/`alter` → `'lg'`, `antreff_ort` → `'xl'`. `reg` → `immerSichtbar: true`.
  - `export type PersonenSpaltenKey = (typeof personenSpalten)[number]['key']`.
  - `export const personenKarte = (einsatzId: number): Kartenplan<Person, PersonenSpaltenKey> => ({ art:'plan', titel:{ spalte:'reg', ziel:(p)=>personDetailPfad(einsatzId,p.id) }, sekundaer:['name','sk','seit'] })` — **kein `status`-Slot**: `STATUS_META`/`SK_META` sind antd-Farbnamen außerhalb des A2-Vertrags, sie in `StatusDarstellung` zu zwingen wäre der von A2 verbotene Bestands-Sweep.
  - `abgleichSpalte` → `abgleichSpalten(gefundene, onAbgleich)`, Rückgabe `spaltenFuer<Person>()([{ key:'abgleich', immerSichtbar:true, … }])`. Das `size="small"` bei `:53` **bleibt** (Abbau ist LFH-333/B5); der `onClick={(e)=>e.stopPropagation()}` bleibt, weil `onZeileKlick` weiterhin am `onRow` hängt.

- **Format-Entscheidung, begründet:** die `seit`-Spalte nutzt `ZeitAnzeige` **ohne `format`-Prop**, also `dtgVoll` — wie in der festgelegten API §6. `format="kurz"` wäre schmaler, aber `formatZeitKurz` (`anzeige/format.ts:102-111`) liest über `dayjs()` die **echte Wanduhr**, um „heute" zu bestimmen; jede Assertion darauf wäre an den Ausführungszeitpunkt gekoppelt. `taktischeDtgVoll` ist eine reine Funktion des Wire-Strings. `kurz` bleibt ein Folgekandidat, falls die 390-px-Messung die Breite beanstandet.

#### B2 · `pages/PersonenPage.tsx` auf zwei `Datensicht`-Instanzen
- **Test zuerst** (`pages/PersonenPage.test.tsx`, drei neue Fälle):
  1. **Sortierung ist echt, nicht die Serverordnung.** Fixture in *absichtlich falscher* Lieferreihenfolge (`[R-003, R-001, R-002]`, msw gibt das Array verbatim heraus), Sicht „Alle", Assertion auf die **Zeilenfolge** der R-Nummern via `screen.getAllByText(/^R-\d{3}$/).map(e => e.textContent)` → `['R-001','R-002','R-003']`.
     *Warum nicht trivial grün:* die Backend-Ordnung ist `ORDER BY registrier_nr` ASC (`src/person/repo.rs:60`) — ein Test mit serverseitig sortierter Fixture wäre auch ohne jede Sortierung grün. Nur die verdrehte Lieferung beweist die clientseitige Sortierung.
  2. **`seit` ist sichtbar und trägt die Patienten-Ordnung.** Zwei Personen **derselben** SK mit *unterschiedlichen* `aktuelle_sichtung_at` (`09:10` / `09:40`), verdreht geliefert; Patienten-Tab; Assertion Zeilenfolge = ältester zuerst.
     *Warum nicht trivial grün:* heute existiert die Spalte nicht und die Gruppentabelle rendert in Lieferreihenfolge. **Achtung — die messbare Falle:** alle Bestandsfixtures sind aus `person` gespreizt und teilen `erfasst_at: '2026-05-27 09:00:00'` (`:40`); ein Zeitsortier-Test auf ihnen ist ohne eine Zeile Sortiercode grün. Die neuen Fixtures müssen **verschiedene** Zeitstempel tragen.
  3. **Nur nicht-leere SK-Gruppen bekommen einen Kopf.** Fixture: je eine Person in `sk2` und `tot`, keine in `sk1`/`sk3`/`sk4`. Assertion: `getByRole('heading', { name: /SK II/ })` und `/tot/` vorhanden, `queryByRole('heading', { name: /SK I\b/ })` **nicht** (`\b` trennt „SK I" von „SK II"), ebenso `/SK III/`, `/SK IV/`.
     *Warum nicht trivial grün:* wenn `gruppiere` leere Gruppen mit Zähler 0 emittiert, ist der Test rot — genau das ist heute per `if (gruppe.length === 0) return null` (`:154`) das Verhalten, das erhalten bleiben muss. Das macht aus einer Koordinationshoffnung ein Gate.
- **Code:**
  - Patienten-Zweig: `PATIENT_SK.map`+5×`<Table>`+`<Spin>`+`<Alert>` (`:150-177`) → **eine** `<Datensicht>` mit `daten={alle.filter(istPatient)}`, `gruppen={{ schluessel: p => p.aktuelle_sichtung ?? 'ohne', etikett: sk => sk === 'ohne' ? 'ohne SK' : SK_META[sk as Sichtungskategorie].label, reihenfolge: [...PATIENT_SK] }}`, `standardSortierung={{ spalte:'seit', richtung:'auf' }}`, `ladend={personenQuery.isLoading}`, `leerText="Keine Patienten in diesem Einsatz."`.
    `istPatient` wird aus `personen/personMeta.ts:10` importiert statt lokal bei `:20-22` dupliziert (die lokale Kopie fällt weg — sie ist byte-gleich).
  - Listen-Zweig: `<Table>` (`:179-187`) → `<Datensicht>` mit `daten={filterPersonen(alle, sicht)}`, `suche={{ platzhalter: 'R-Nr. oder Name' }}`, `standardSortierung={{ spalte:'reg', richtung:'auf' }}`, `leerText="Keine Personen in dieser Sicht"`, `onZeileKlick={p => navigate(personDetailPfad(einsatzId, p.id))}`, `spalten` als **explizit typisierte** Verbundliste (§3, Falle 1).
  - `karte`: Patienten `personenKarte(einsatzId)`; Liste `{ ...personenKarte(einsatzId), aktion: darfSchreiben && sicht==='vermisst' ? { etikett:'Abgleich vorschlagen …', onKlick: p => setAbgleichFuer(p) } : undefined }`.
  - **Neu** `personen/AbgleichVorschlagModal.tsx`: der Kartenzweig kann das `<Select style={{width:200}} size="small">` aus `abgleichSpalten` nicht tragen (feste Breite, ~24 px Höhe → Kriterium 1 und Gate 1 bei 390 px). Der Deskriptor **ersetzt** es durch einen Knopf, der ein Modal mit demselben `Select` (ohne `size`) öffnet — ein Feld, also Modal nach LFH-19. State `abgleichFuer: Person | null` in `PersonenPage`.
  - `<LagebildStreifen alle={alle} />` (`:147`) bleibt unangetastet — es ist die Kennzahlenzeile, keine Liste.

#### B3 · `pages/TierePage.tsx` auf eine `Datensicht`
- **Test zuerst** (`pages/TierePage.test.tsx`, zwei neue Fälle):
  1. **Sortierung.** Drei Tiere aufsteigend geliefert (`T-001, T-002, T-003`), Sicht „Alle", Assertion Zeilenfolge `['T-003','T-002','T-001']`.
     *Warum nicht trivial grün:* das Backend liefert `ORDER BY t.registrier_nr DESC` (`src/tier/repo.rs:75`); die aufsteigende Lieferung erzwingt, dass die Umkehrung im Client passiert.
  2. **`seit` ist sichtbar.** Ein Tier mit `erfasst_at: '2026-05-29 09:00:00'`, Assertion `getByText(/^\d{6}(JAN|…|DEZ)2026$/)` — Muster, nicht Fixwert, weil ohne `EinsatzAnzeigeProvider` in Runner-Zeitzone gerendert wird.
- **Code:** `<Table>` (`:143-151`) → `<Datensicht>`; `spalten` als `spaltenFuer<Tier>()([...])` mit den sieben Bestandsspalten plus `{ key:'seit', title:'seit', sortWert: t => t.erfasst_at, render: (_t, tier) => <ZeitAnzeige wert={tier.erfasst_at} /> }`; `suche={{ platzhalter: 'T-Nr., Rufname, Rasse' }}` mit `suchText` an `reg`/`rufname`/`rasse`/`halter`; `standardSortierung={{ spalte:'reg', richtung:'ab' }}`; `abBreite`: `rasse`→`'lg'`, `antreff_ort`→`'xl'`; `daten={filterTiere(alle, { sicht, spezies: speziesFilter })}`; `leerText="Keine Tiere in dieser Sicht"`; `onZeileKlick`→`tiereDetailPfad`.
  `karte`: `{ art:'plan', titel:{ spalte:'reg', ziel: t => tiereDetailPfad(einsatzId, t.id) }, sekundaer:['rufname','status','seit'] }` — **kein `status`-Slot**, weil `TierStatus` nicht im A2-Vertrag steht (`theme/statusFarben.ts:43-47` listet `TierePage` ausdrücklich als bewusst draußen).
  Der Spezies-`Select` bleibt eine **Seiten**-Steuerung neben den Tabs (wie die Filter-Card der Kräfteübersicht außerhalb von `Datensicht` bleibt) — er wird nicht zu einem Spalten-`filter`. Damit bleiben `TierePage.test.tsx:82-92` und die A1-Härtung tragfähig, und die Ersatz-Akzeptanzmarke ist über `suche={{` + `sortWert:` erfüllt (§9.1 der API-Entscheidung nennt die drei alternativ, nicht kumulativ).

#### B4 · Bestandstests anpassen (nicht löschen)
Siehe §2, Tabelle „bricht / Anpassung".

---

## 2. Je Datei: Änderung, brechende Tests, Anpassung

### `personen/personenSpalten.tsx`
**Änderung:** Register → `spaltenFuer<Person>()`; `seit`-Spalte + `sortWert`/`suchText`/`abBreite`/`immerSichtbar`; neue Exporte `seitWert`, `SkTag`, `PersonenSpaltenKey`, `personenKarte`; `abgleichSpalte` → `abgleichSpalten` (gleiche Semantik, neuer Rückgabetyp).
**Brechende Tests:** keine — die Datei hat heute keine Testdatei. Neu: `personen/personenSpalten.test.tsx`.
**tsc-Bruch:** `PersonenPage.tsx:14/114/166/183` (Import- und Spread-Stellen) — wird in B2 mitgezogen.

### `pages/PersonenPage.tsx`
**Änderung:** zwei `<Table>` → zwei `<Datensicht>`; `PATIENT_SK.map`-Schleife, `<Spin>` und `<Alert type="info" title="Keine Patienten…">` (`:150-177`) fallen weg; lokales `istPatient` (`:20-22`) → Import aus `personMeta`; Filterkette (`:107-111`) → `filterPersonen`/`gefundenePersonen`; neuer State `abgleichFuer` + `<AbgleichVorschlagModal>`.

| Test | Zeile | bricht? | Anpassung |
|---|---|---|---|
| „Patienten-Tab gruppiert SK I–IV + tot" | `:129` `getAllByText('1 Patient')).toHaveLength(2)` | **ja** — der Gruppenkopf hat unter `gruppen` nicht mehr das Format „`<Tag>` + N Patient(en)" | ersetzt durch die Kopf-Assertion aus B2/Fall 3: `getByRole('heading', { name: /SK II/ })` + `/tot/` vorhanden, `/SK I\b/`, `/SK III/`, `/SK IV/` nicht. Der **Zähler** wird als Teil des Kopfnamens mitgeprüft (`{ name: /SK II.*1/ }`). Die übrigen Assertions des Falls (`:126-135`, R-003/R-004 sichtbar, R-005/R-001 nicht, Achsen-Überlappung im Verstorben-Tab) bleiben unverändert |
| „Patienten-Tab zeigt einen Leer-Hinweis" | `:142` `findByText(/Keine Patienten/)` | **nein**, aber die Quelle wechselt | unverändert lassen; der Text kommt jetzt aus `leerText` statt aus dem `<Alert>`. E1 ist gewahrt: `locale.emptyText`/`Liste emptyText`, **kein neuer `<Empty>`-Knoten** |
| „filtert per Tab auf Vermisst und zeigt ‚unbekannt'" | `:78` `getByText('unbekannt')` | **nein** — Eindeutigkeit bleibt | unverändert. Grund: Zusicherung 1 der API (genau EIN Zweig im Baum) ⇒ Tabellen- und Kartenzelle existieren nie gleichzeitig; `ZeitAnzeige` rendert bei fehlendem Wert `''`, nie „unbekannt"; die `abgleichSpalten`-Optionen (`g.name ?? 'unbekannt'`) liegen im geschlossenen Select-Dropdown. **Als Bestätigung im Gate führen, nicht als erwarteten Bruch** |
| „navigiert beim Klick auf eine Zeile" | `:175` `findAllByText('Mustermann, Max')[0]` | **nein** | unverändert — `onZeileKlick` hängt am `onRow` des Tabellenzweigs, bei 1024 px (`VIEWPORT_STANDARD`) ist das der gemountete Zweig |
| „zeigt SK-Badge und Lagebild-Zählungen" | `:109` `findByText('SK II')` | **nein** — Sicht „Alle" hat keine `gruppen`, also keinen zweiten „SK II"-Knoten | unverändert |
| Deep-Link `?person=`, `?neu=1`, Rollen-Tests | `:81-100`, `:158-170` | **nein** | unverändert |

### `pages/TierePage.tsx`
**Änderung:** `aria-label="Spezies"` (A1); Spalten → `spaltenFuer<Tier>()` + `seit`; `<Table>` → `<Datensicht>`; Filterkette → `filterTiere`; `tierKarte` lokal.

| Test | Zeile | bricht? | Anpassung |
|---|---|---|---|
| „filtert nach Spezies" | `:85` `getByRole('combobox')` **ohne** Namensfilter | **ja, schon in A1** | `{ name: 'Spezies' }` ergänzen; die `.closest('.ant-select-item-option')`-Auflösung bei `:87` bleibt nötig und unverändert |
| „zeigt aktive Tiere", „filtert per Tab", „navigiert beim Klick" | `:66-80`, `:132-137` | **nein** | unverändert |
| „Halter-R-Nr und ‚storniert'" | `:142` `findByText(/Halter \(storniert\): R-007/)` | **nein** | unverändert — `halterAnzeige` (`:37-46`) wandert unverändert in das `render` der `halter`-Spalte |
| Schnellerfassung / Vermisst-Meldung | `:107-130` | **nein** | unverändert (Modal, nicht Liste) |

### `anzeige/ZeitAnzeige.tsx`, `anzeige/format.ts`
**Änderung: keine.** Begründung in §5. `anzeige/ZeitAnzeige.test.tsx` und `anzeige/format.test.ts` bleiben unangetastet — dort und nur dort werden Formate assertiert, und zwar per Muster statt Fixwert (`ZeitAnzeige.test.tsx:13/18/23`), was die Zeitzonen-Kopplung schon heute korrekt umgeht.

### `personen/personMeta.ts`
**Änderung: keine (read-only).** `SK_META`/`STATUS_META` sind A2-gepinnt, `personMeta.test.ts:6-10` pinnt Schlüsselmenge und zwei Einträge byte-genau. `PATIENT_SK` und `istPatient` werden nur **gelesen**. `unverletzt`/ungesichtet bekommen **keinen** Dringlichkeitsrang — sie sind per `istPatient` gar nicht im Patienten-Datensatz (offene Frage bleibt offen, siehe §5).

### Neue Dateien
`personen/personenSpalten.test.tsx` · `personen/personenFilter.ts` + `.test.ts` · `personen/AbgleichVorschlagModal.tsx` (+ Verhalten über `PersonenPage.test.tsx` geprüft) · `pages/tiere/tierHelfer.ts` + `.test.ts`.

### Nicht angefasst
`components/katalogTabelle.guard.test.ts` (byte-identisch; keine der drei Dateien steht in seinen 13 Pfaden) · `components/KatalogTabelle.tsx` · `theme/statusFarben.ts` · `pages/SchaedenPage.tsx` (nur Muster) · `pages/PersonenDetailPage.tsx` (Zugriffs-Audit, keine Betroffenenliste — dessen fehlender `scroll` ist E4, nicht dieses Bündel).

---

## 3. Die Fallen — am Code gefunden

**F1 · `abgleichSpalten` und das `K`-Literal beim Spread.**
`spalten={[...personenSpalten, ...abgleichSpalten(…)]}` erzeugt eine Union von Elementtypen; die `K`-Inferenz von `Datensicht<T, K>` darüber ist nicht verlässlich, und die in der API benannte FALLE (Annotation weitet `K` auf `string`) schlägt zu, sobald man mit `readonly DatensichtSpalte<Person>[]` nachhilft. **Lösung:** eine *explizite Union* annotieren, nicht den Default:
`type PersonenListeKey = PersonenSpaltenKey | 'abgleich';`
`const listenSpalten: readonly DatensichtSpalte<Person, PersonenListeKey>[] = [...personenSpalten, ...abgleichSpalten(…)];`
Das pinnt `K` statt es zu weiten. Der Riegel dahinter bleibt `pruefeKartenplan` im DEV-Effekt plus die Register-Assertion aus B1.

**F2 · Zeit-Sortier-Tests sind mit den Bestandsfixtures ohne eine Zeile Code grün.** Gemessen: jedes Tier ist aus `tierBasis` gespreizt und erbt `erfasst_at: '2026-05-29 09:00:00'` (`TierePage.test.tsx:42`); `unbekannt` erbt `person.erfasst_at: '2026-05-27 09:00:00'` (`PersonenPage.test.tsx:40`). Eine Sortierbehauptung über gleiche Zeitstempel ist eine Attrappe. Neue Fixtures brauchen **verschiedene** Stempel.

**F3 · `standardSortierung` reproduziert die Serverordnung — Personen ASC, Tiere DESC.** `src/person/repo.rs:60` = `ORDER BY registrier_nr`, `src/tier/repo.rs:75` = `ORDER BY t.registrier_nr DESC`. Ein Test, dessen Fixture in Backend-Reihenfolge geliefert wird, kann nicht fehlschlagen. Deshalb liefern die neuen Tests **verdreht** und assertieren die **Zeilenfolge**. (Dieselbe Falle nennt die API-Entscheidung für `BewegungenTab`; sie gilt hier zweifach.)

**F4 · Assertions auf gerenderte Zeitstrings prüfen die Zeitzone des Testrechners.** `renderMitProviders` (`test/utils.tsx`) hängt keinen `EinsatzAnzeigeProvider` ein; `useAnzeigeKonventionen` fällt bewusst auf Defaults zurück, also **Lokalzeit**. Ein `expect(getByText('271100MAI2026'))` wäre CI-abhängig. Deshalb: Zeilen**folge** assertieren (das ist auch, was „sortierbar" behauptet), Format nur als Muster.

**F5 · Leere Gruppen.** Heute schneidet `PersonenPage.tsx:154` (`if (gruppe.length === 0) return null`) leere SK-Abschnitte weg. Ob `gruppiere` in `Datensicht` das ebenso tut, ist in der API **nicht festgelegt**. Ohne den Test aus B2/Fall 3 würde ein „SK I · 0"-Kopf lautlos einziehen und niemand sähe es. Der Test verwandelt die Annahme in ein Gate.

**F6 · `TierePage.test.tsx:85` ist heute nur zufällig eindeutig** — der Spezies-Select ist die einzige Combobox der Seite. Bei 8 Spalten kann die Werkzeugzeile einen Spaltenschalter mitbringen; dessen Bauform (Dropdown? Select?) legt die API nicht fest. A1 nimmt die Zufälligkeit vorweg heraus.

**F7 · Ein Test, der die `seit`-Spalte gar nicht assertiert, bleibt grün, während sie kaputt ist.** Kein Bestandstest von `PersonenPage`/`TierePage` prüft Spaltenzahl oder -inhalt jenseits einzelner Textknoten. Die Spalte braucht mindestens eine eigene Assertion je Seite, sonst belegt das ganze Bündel nur, dass nichts Bestehendes zerbrochen ist.

**F8 · `personen-detail.spec.ts:56`: `page.getByText('Mustermann, Max').click()` ohne `.first()`** — Playwright-Strict-Mode. Nach der Umstellung darf der Name **nicht** ein zweites Mal im Baum stehen. Das ist durch Zusicherung 1 (genau ein Zweig gemountet) und dadurch gedeckt, dass `sekundaer` in der Karte den `name`-Slot nur im Kartenzweig zieht. **Als Browser-Gate-Bestätigung führen**, nicht als erwarteten Bruch. `uhs-grundriss-person-scroll.spec.ts:40/56` nutzt `.first()` und ist unkritisch.

**F9 · `pnpm lint --max-warnings 0`.** Der neue Such-/Sortierzustand liegt in `Datensicht`, aber `filterPersonen`/`filterTiere` werden je Render neu aufgerufen und fließen als `daten` in ein Prop. Wenn eine `useMemo`-Stabilisierung nötig wird, dann über **Primitive** in den Deps (`sicht`, `speziesFilter`, `alle`), nicht über ein Filterobjekt und **kein** pauschales `eslint-disable`. Neues punktuelles `size="small"` auf interaktiven Elementen ist verboten (E8) — das `Select` im neuen `AbgleichVorschlagModal` bekommt **kein** `size`.

**F10 · `/personen` und `/tiere` stehen in keinem Überlauf-Gate.** `e2e/gate1-ueberlauf.spec.ts` prüft `/einsaetze`, `/…/lage-dashboard`, `/…/etb`, `/admin/benutzer`. Eine achte Spalte kann die Personenliste bei 390 px überlaufen lassen, ohne dass etwas rot wird — und unter `md` ist dort ohnehin der **Kartenzweig**, dessen Überlauf niemand messen würde. Siehe §6 (Abgabe an AP8).

---

## 4. Verifikation — exakte Kommandos

Absolute Pfade, `mise exec` (mise steht nicht im PATH des Agenten), `rtk proxy` überall, wo ein **ehrlicher Exit-Code** gebraucht wird (der rtk-Hook maskiert ihn sonst), und **kein `| tail`**.

```bash
W=/Users/rubeen/dev/personal/lifeline-hub/.claude/worktrees/lfh-330-einsatzlisten-primitive

# ── Phase A: reine Einheitstests, laufen heute
mise exec pnpm@11.10.0 -- pnpm -C $W/frontend exec vitest run \
  src/personen/personenSpalten.test.tsx \
  src/personen/personenFilter.test.ts \
  src/pages/tiere/tierHelfer.test.ts \
  src/personen/personMeta.test.ts \
  src/anzeige/ZeitAnzeige.test.tsx \
  src/anzeige/format.test.ts

# ── Phase B: die zwei Seiten-Suiten, eng gescopt (die volle Suite ist unter Last flaky)
mise exec pnpm@11.10.0 -- pnpm -C $W/frontend exec vitest run \
  src/pages/PersonenPage.test.tsx \
  src/pages/TierePage.test.tsx \
  src/pages/PersonenDetailPage.test.tsx \
  src/pages/TiereDetailPage.test.tsx \
  src/personen/PersonVerlauf.test.tsx

# ── Guards, die von diesem Bündel NICHT bewegt werden dürfen (Negativnachweis)
mise exec pnpm@11.10.0 -- pnpm -C $W/frontend exec vitest run \
  src/components/katalogTabelle.guard.test.ts \
  src/components/useViewport.guard.test.ts \
  src/theme/statusFarben.test.ts \
  src/components/StatusTag.test.tsx

# ── Typecheck (fängt jeden Rest des alten TableColumnsType-Vertrags)
mise exec pnpm@11.10.0 -- pnpm -C $W/frontend typecheck

# ── Lint, hart
mise exec pnpm@11.10.0 -- pnpm -C $W/frontend lint

# ── Struktur-Nachweise (Exit-Code muss ehrlich sein → rtk proxy)
rtk proxy grep -c '<Table' $W/frontend/src/pages/PersonenPage.tsx $W/frontend/src/pages/TierePage.tsx   # erwartet: 0 / 0
rtk proxy grep -c 'spaltenFuer' $W/frontend/src/personen/personenSpalten.tsx $W/frontend/src/pages/TierePage.tsx   # erwartet: >=1
rtk proxy grep -rn 'Input.Search' $W/frontend/src/pages/PersonenPage.tsx $W/frontend/src/pages/TierePage.tsx        # erwartet: 0 Treffer
rtk proxy grep -rn 'size="small"' $W/frontend/src/personen/AbgleichVorschlagModal.tsx                               # erwartet: 0 Treffer
rtk proxy grep -c 'size="small"' $W/frontend/src/personen/personenSpalten.tsx                                       # erwartet: genau 1 (Bestand, LFH-333)

# ── e2e, nur die von diesem Bündel berührten Specs (braucht target/debug/lifeline-hub)
mise exec pnpm@11.10.0 -- pnpm -C $W/frontend exec playwright test \
  personen-detail.spec.ts uhs-grundriss-person-scroll.spec.ts deeplinks-smoke.spec.ts command-palette.spec.ts

# ── Sammel-Gate vor dem Merge (nicht vom Bündel allein zu erfüllen)
$W/scripts/check-all.sh
```

---

## 5. Was dieses Bündel NICHT liefert

1. **Kein relatives Zeitalter („vor 20 min").** Gemessen: `ZeitAnzeige` hat genau vier Formate (`anzeige/ZeitAnzeige.tsx:16`), `format.ts` lädt nur `utc`+`timezone` (`:18-19`), und repoweit importiert nichts ein dayjs-Locale — `relativeTime` ohne `dayjs/locale/de` liefert englischen Text („2 months ago"), ein stiller Sprachbruch, den kein Test fängt. **Kosten des Nachrüstens:** ein fünfter `ZeitFormat`-Wert + ein Formatter (nach dem `MONATE_DE`-Präzedenzfall handgeschrieben, `format.ts:56-60`, statt Plugin+Locale) + eine Entscheidung, ob die Spalte **tickt**. Genau dieses Ticken kollidiert mit Prüflisten-Kriterium 12 (kein Sprung unter dem Cursor) und braucht die Zeilenschleuse aus `Datensicht`. Der Bündelauftrag fragte nach den Kosten, nicht nach dem Feature — hier sind sie. → eigenes Ticket.
2. **Keine Dringlichkeitssortierung für Tiere.** `TierAnzeige` trägt keine Sichtung (der Rust-Doc sagt „Bewusst schlank — keine Sichtungskette wie bei Personen"), also gibt es keine SK-Achse und keinen Sichtungszeitpunkt. „seit" kommt aus `erfasst_at`; `geaendert_at` wäre falsch (es ändert sich bei jeder Notiz). = **E3**, hier bestätigt.
3. **Kein Dringlichkeitsrang für `unverletzt` und ungesichtet.** `PATIENT_SK` (`personMeta.ts:6`) deckt 5 von 6 Enum-Werten; ungesichtet hat gar keinen Rang. Beide fallen per `istPatient` aus dem Patienten-Datensatz — die fachliche Frage („gehört ungesichtet an den Anfang?") bleibt **offen** und wird hier nicht durch eine Implementierungsentscheidung stillschweigend beantwortet.
4. **Keine deeplinkbare Suche/Sortierung.** Kein `?suche=`, kein `?sort=`. Das Deeplink-Muster reserviert Query-Params für Selektion (`?person=`, `?neu=1`); §9.4 der API-Entscheidung vertagt das ausdrücklich.
5. **Kein Spaltenschalter-Zustand über Navigation hinaus** (§9.5) und **keine In-Zeile-Bedienung im Kartenzweig** (§9.6): unter `md` sind Personen und Tiere **lesend plus eine Primäraktion**. Konkret verlorene Felder auf der Karte: `geschlecht`, `alter`, `antreff_ort`, `status` (Personen) bzw. `spezies`, `rasse`, `halter`, `antreff_ort` (Tiere). Der Verlust ist an der Aufrufstelle sichtbar (`sekundaer`-Tupel, max. 3), nicht überraschend.
6. **Kein Statusfarb-Umbau.** `SK_META`/`STATUS_META` (Personen) und `STATUS_META` (TierePage `:15-19`) bleiben antd-Farbnamen außerhalb des A2-Vertrags. Konsequenz und offener Prüflisten-Rest: in `personenSpalten` bedeutet `red` in der Statusspalte „verstorben" und in der SK-Spalte „SK I" — Kriterium 7 bleibt dort **offen** (Folgeticket „modul-lokale Farbmaps in den A2-Vertrag"). Sie hier hineinzuziehen wäre der von A2 verbotene Bestands-Sweep.
7. **Kein `scroll`/`sticky`-Nachtrag für `pages/PersonenDetailPage.tsx`** (Zugriffs-Audit, `:511`) — E4-Arbeit, nicht diese.
8. **Keine Änderung an `components/Datensicht.tsx`, `components/KatalogTabelle.tsx`, `components/katalogTabelle.guard.test.ts`, `components/datensicht.guard.test.ts`** — fremdes Eigentum.

---

## 6. Anforderungen an AP1 und AP8 — Vertrag, nicht Annahme

Diese Punkte sind **Vorbedingungen für Phase B**, keine Hoffnungen. Wenn AP1 anders entscheidet, ändert sich Phase B, nicht dieses Bündel im Nachhinein.

**An AP1 (`components/Datensicht.tsx` + `datensicht.guard.test.ts`):**
1. **`gruppiere` emittiert keine leeren Gruppen.** Eine in `reihenfolge` genannte Gruppe ohne Zeilen bekommt **keinen** Kopf und **keinen** Zähler. Heutiges Verhalten: `PersonenPage.tsx:154`. Prüfung liegt in `PersonenPage.test.tsx` (B2/Fall 3).
2. **Der Gruppenkopf trägt die Rolle `heading`** mit dem Etikett und dem Zähler im zugänglichen Namen. Heute ist er `Typography.Title level={5}` (`PersonenPage.tsx:157`), also ein `<h5>` — das ist Erhalt, keine neue Forderung.
3. **`spaltenFuer<T>()` muss über `type K = (typeof register)[number]['key']` ableitbar sein**, und eine mit *expliziter Union* annotierte Verbundliste (`readonly DatensichtSpalte<Person, PersonenSpaltenKey | 'abgleich'>[]`) darf `K` **nicht** auf `string` weiten. Ohne das ist `abgleichSpalten` nicht anschließbar.
4. **Guard-Inventar: zwei Listen, nicht eine.** `personen/personenSpalten.tsx` ist eine **Registerdatei** (`spaltenFuer` ≥ 1, kein `<Datensicht`), `pages/PersonenPage.tsx` ist ein **Konsument, der sein Register importiert** (`<Datensicht` ≥ 1, `<Table` = 0, **kein** `spaltenFuer`), `pages/TierePage.tsx` ist beides. Ein einziges Inventar mit „`spaltenFuer` ≥ 1 je Konsumentendatei" macht `PersonenPage.tsx` unerfüllbar rot. Zu ergänzende Pfade: `personen/personenSpalten.tsx`, `pages/PersonenPage.tsx`, `pages/TierePage.tsx` — jeweils `<Table` = 0, `scroll={{` = 0, `sorter:` = 0, `filters:` = 0, `responsive:` = 0. `KARTEN_EIGENBAU` bleibt von diesem Bündel **leer** (kein `art: 'eigen'`).
5. **Schwelle des Spaltenschalters benennen.** Personen erreichen 8 (+1 mit `abgleich`), Tiere 8. Ob der Schalter dort erscheint und in welcher Bauform (Dropdown/Select), entscheidet, ob `TierePage.test.tsx:85` und `PersonenPage.test.tsx` einen zweiten Combobox-Knoten sehen. A1 nimmt das Risiko vorweg heraus, aber die Zahl gehört in die API.

**An AP8 (e2e-/Gate-Landschaft):**
6. `e2e/gate1-ueberlauf.spec.ts` um `/einsaetze/:id/personen` und `/einsaetze/:id/tiere` erweitern, seiteneigener Anker `tr.ant-table-row` (breite Stufen) bzw. — unterhalb `md` gibt es dort **keine Tabelle** — der Kartencontainer. Maß bleibt `documentElement.scrollWidth - clientWidth` mit 1-px-Toleranz.
7. `e2e/datensicht-schmal.spec.ts` (390 × 844) soll `/personen` mitnehmen: kein `.ant-table`, Gegenprobe bei 1366, Treffläche von Titel-Link und Aktionsknopf ≥ 48 px über `haeltTreffflaeche` (`nav-schmal.spec.ts`, 0,5-px-Subpixeltoleranz), `toHaveCount(1)` vor jeder Zusicherung.
8. Bestätigung im Browser-Gate (nicht erwarteter Bruch): `personen-detail.spec.ts:56` bleibt strict-mode-eindeutig.