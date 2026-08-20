# Prüfliste Einsatztauglichkeit — UHS-Grundriss (LFH-367 · B5g)

Gate 7 der Bedien-Leitlinie (`2026-07-25-bedien-leitlinie-einsatzkontexte.md`, Festlegung 7)
verlangt diese Liste an jeder neuen oder umgebauten Seite. B5g trägt **den einzigen echten
Funktionsausfall des B5-Clusters** (Befund H39): die Kernaufgabe „Patient auf Platz legen" war
ausschliesslich per Ziehen erreichbar und damit auf dem Führungs-Tablet nicht verlässlich
ausführbar.

**Umfang:** `pages/uhs/Grundriss.tsx` (Platzkarte, Zuweisungsdialog, Sensorik) ·
`pages/uhs/MaterialTab.tsx` · die Schuldzeilen des Bündels in `components/dichte.guard.test.ts`.

**Gemessene Baseline am 30.07.2026** (Zahlen aus der Scan-Funktion des Dichte-Guards selbst,
nicht per Grep und nicht fortgeschrieben):

| Größe | vorher | nachher |
| --- | --- | --- |
| Wege, eine Person einem Platz zuzuweisen | 1 (nur Ziehen) | **3** (Ziehen · Klick auf die Karte · Menü-Eintrag) |
| Klein-Angaben auf interaktiven Elementen in `pages/uhs/` | 5 in 2 Dateien | **4 in 1 Datei** (alle vier begründet, s. Zeile 1) |
| Schuldzeilen für B5g in `dichte.guard.test.ts` | 2 | **1** |
| Restschuld des Guards über das ganze Frontend | 41 in 20 Dateien | **40 in 19 Dateien** |
| Tests in `Grundriss.test.tsx` | 23 | **35** |
| davon zu Zuweisung / Riegel / Berührung | **0** | **12** |

---

| #  | Verdikt | Beleg / Zielticket |
| -- | ------- | ------------------ |
| 1 · Treffläche | **erfüllt über den Bedienweg, NICHT über die Grösse — und das ist der Kern dieses Bündels** | Die Zuweisung hat jetzt ein Ziel von **140 × 116 px**: die ganze Platzkarte. Das ist die Antwort auf H39, und sie war nötig, weil die Grössenachse hier verschlossen ist. Die Rechnung (Dateikopf `Grundriss.tsx:27-56`, LFH-328/A2; der B5g-Nachtrag ab :44) ist unter LFH-367 **nachgerechnet und bestätigt**, nicht bloss übernommen: Innenraum = 116 − 12 − 4 = 100 px, belegt von Titel 30 + Tags 24 + Belegung 24 + Aktionen 24 = 102 px. Seit LFH-361 liegt die kleine Steuerhöhe auf 24 / 48 / 72, die volle auf 30 / 48 / 72 — in **keiner** Stufe passt eine Aktionszeile auf voller Höhe. Auch der naheliegende Ausweg „alles ins Dropdown" scheidet damit aus: dessen Auslöser ist selbst ein Knopf. Die vier Angaben bleiben deshalb als **benannte, dauerhafte** Ausnahme in der Schuldliste; sie fallen mit einer Änderung an `SCHRITT_Y` im Backend, nicht mit einem Frontend-Umbau. `MaterialTab.tsx` dagegen ist abgeräumt — dessen Lösen-Knopf sass in einer Tabellenzelle, die mitwachsen darf |
| 2 · Handschuh-Modus | **erfüllt für den neuen Weg, unverändert für die Karte** | Der Zuweisungsdialog erbt die Dichtestufe vollständig (`ErfassungsModal` + `Select` ohne Grössen-Prop), ebenso der Menü-Eintrag. Die Kartenfläche selbst ist mit 116 px in **jeder** Stufe über dem Handschuh-Boden von 72 px — ein Berührungsziel, das nicht mitwachsen muss, weil es schon gross genug ist. **Offen wie überall:** die Ableitung der Stufe aus dem Einsatzkontext hängt weiter an `localStorage['lifeline-hub.dichte']` mit Vorbelegung über die Zeigerart → **B5-Restpunkt (LFH-333)** |
| 3 · Rückmeldung vor der Serverantwort | **erfüllt** | `laeuft={belegMut.isPending}` am Zuweisungsdialog; die Hülle sperrt den Knopf und zeigt den Ladezustand. `onErfassen` ruft **`mutateAsync`**, nicht `mutate` — ein abgelehnter Serverruf lässt die Auswahl stehen statt sie stillschweigend zu leeren (Vertrag aus LFH-332/B4). Die übrigen Mutationen der Seite melden über Toast; optimistische Updates gibt es hier so wenig wie sonst im Repo → **B6 (LFH-334)** |
| 4 · Kritische Aktion hat eine zweite Handlung | **erfüllt** | Die Zuweisung ist umkehrbar und war es schon: eine falsch platzierte Person zieht man in den Wartebereich zurück (`art: 'wechsel'`/`platz_id: null`), und der neue Weg nutzt dieselbe Mutation. Deshalb trägt er **keine** Rückfrage — nach der Trennlinie aus LFH-363 (umkehrbar → kein zusätzlicher Reibungsschritt) wäre sie hier falsch, nicht fehlend. Die einzige unumkehrbare Aktion der Karte bleibt „Platz löschen", die im Bearbeiten-Modus liegt |
| 5 · Kontrast in beiden Modi | **erfüllt** | B5g führt keinen Farbwert ein. Der neue Menü-Eintrag und der Dialog liegen im Theme; die Kartenfarben (`colorPrimaryBg` bei Drop-Hover, `colorInfoBg` bei Belegung, Rahmen aus `rollenFarbe`) sind unverändert |
| 6 · Kein Status allein über Farbe | **erfüllt, unverändert** | Belegung trägt Tag **„belegt"** plus Hintergrund, Verfügbarkeit einen `StatusTag` mit Text. Der neue Klickweg fügt keinen farbcodierten Zustand hinzu; die Zuweisbarkeit zeigt sich am Mauszeiger (`pointer`) und am Menü-Eintrag, nicht an einer Farbe |
| 7 · Eine Farbe = eine Bedeutung | **erfüllt** | Keine neue Farbbelegung. Das einzige `danger` im Umfang bleibt „zurückweisen" bzw. „Platz löschen"; der neue Eintrag „Patient zuweisen" ist neutral. In `MaterialTab.tsx` trägt das Popconfirm des Lösen-Knopfes jetzt `okButtonProps={{ danger: true }}` — vorher bestätigte man die destruktive Aktion mit einem blauen Knopf. **Offener Widerspruch dahinter, im Review gefunden:** CLAUDE.md nennt „eine gelöste Zuordnung" wörtlich als **umkehrbar** → keine zusätzliche Reibung, Rückfragen sind Unumkehrbarem vorbehalten. Genau genommen gehörte das Popconfirm also weg statt gehärtet. B5g hat es **nicht** entfernt, weil das Streichen einer bestehenden Rückfrage eine Bedienentscheidung im Bestand ist und in keinem AK dieses Bündels steht → **LFH-378** |
| 8 · Helligkeits-/Kontrastregler | **offen** | Weiterhin keiner in der Anwendung; A0 hat ihn ausdrücklich weiterverwiesen → **Folge-Task aus A0** |
| 9 · Kritische Anzeigen im Blickfeld | **erfüllt** | Die Drei-Spalten-Ordnung bleibt: Eingang/Wartebereich links, Fläche in der Mitte, Transport rechts. Der Zuweisungsdialog ist ein Modal über der Fläche und trägt den Zielplatz **im Titel** („Patient zuweisen — Bett 1"), sodass der Bezug nicht verloren geht, wenn die Karte darunter verdeckt ist |
| 10 · Alarmbudget | **nicht anwendbar** | Der Grundriss erzeugt keine Alarme |
| 11 · Warnverhalten | **erfüllt** | Kein Blinken, kein Ton. Fehler kommen als Toast mit Text |
| 12 · Kein Sprung unter dem Cursor | **erfüllt für diesen Umbau** | Der neue Weg verändert kein Layout: Der Dialog liegt über der Fläche, die Karten behalten ihre feste Grösse (`PLATZ_KARTE_HOEHE`, `overflow: hidden`), und die Aktionszeile bekommt kein zusätzliches Element. **Offen, Bestand:** Belegungsänderungen anderer Stellen fahren über den SSE-Fan-out direkt in die Fläche, ohne Sammelbanner → **B6 (LFH-334)** |
| 13 · Fokus nie verdeckt | **teilweise erfüllt** | Der Dialog bringt den Fokus ins erste Feld und gibt ihn beim Schliessen zurück (Vertrag der Erfassungshülle). Der Menü-Eintrag ist über Tastatur **gedacht** und das Menü trägt `autoFocus` — belegt ist beides nicht: ein antd-Dropdown mit `trigger={['click']}` liess sich in jsdom nicht per Tastatur öffnen, und `autoFocus` ist dort nach LFH-365 ohnehin nicht messbar. Der Test heisst deshalb nicht mehr „Tastaturweg". **Ebenfalls nicht belegt:** ob ein Fokusziel beim Durchtabben durch die absolut positionierten Karten hinter dem Rand des Scrollcontainers landet — jsdom rechnet kein Layout → **noch nicht getickt**, siehe Tabelle unten |
| 14 · Tabellenseite vollständig | **nicht anwendbar für den Grundriss, erfüllt für den Materialreiter** | Die Fläche ist bewusst **keine** Tabelle: sie bildet die räumliche Anordnung der Plätze ab, hier wird nicht verglichen, sondern verortet. Der Materialreiter nutzt `KatalogTabelle` mit Scrollcontainer und stehender Kopfzeile ✓; ein Spaltenschalter mit Zähler fehlt dort (`KatalogTabelle` statt `Datensicht`) — Bestand, nicht von B5g verursacht → **noch nicht getickt** |
| 15a · Erfassungsmaske — Zuweisungsdialog | **erfüllt** | Der Zuweisungsdialog ist **nicht handgebaut**: er nimmt `ErfassungsModal` (LFH-332/B4) und erbt damit Enter-Absenden, Fokus im ersten Feld und Rücksetzen auf jedem Weg hinaus. **Ein Feld** — das Budget (Modal ≤ ~3) ist weit eingehalten; der Zielplatz steht im Titel statt als zweites Feld. Kein Serienmodus, und das ist eine Entscheidung: der Zielplatz ist je Vorgang ein anderer, ein „und nächste" hätte kein sinnvolles Nächstes. Das Auswahlfeld nutzt den Projekt-`Select` und ist damit tippbar durchsuchbar (LFH-288). Ist **niemand** zuweisbar, öffnet der Klick **gar keinen** Dialog, sondern meldet es: ein Dialog trüge dort einen Primär-Knopf, der nichts erfasst und nur schliesst — eine tote Hauptaktion in neuem Code. Die Hülle kennt keinen Weg, den Knopf zu unterdrücken, und sie dafür umzubauen träfe alle ihre Aufrufer |
| 15b · Erfassungsmaske — „Material zuordnen" | **offen** | Der zweite Erfassungsdialog im Umfang (`MaterialTab.tsx:106-124`) ist genau das Muster, gegen das LFH-332 antritt: `<Modal onOk>` mit dem Absende-Knopf **ausserhalb** des Formulars (Enter tot), ein nacktes `<Select>` ohne `<Form>`, kein Fokus ins erste Feld, Rücksetzen von Hand und nur auf zwei der vier Auswege. B5g hat in dieser Datei die **Tabellenzelle** angefasst (Knopfgrösse, Popconfirm), nicht die Maske — die Norm „oder eine bestehende ohnehin anfasst" greift damit nicht zwingend. Aber ein Verdikt, das die Hälfte seines Umfangs übergeht, ist das, was Gate 7 verhindern soll: deshalb ist die Zeile geteilt statt pauschal erfüllt → **LFH-378** |
| 1a · Nachtrag: die Sensorik | **bewusst UNVERÄNDERT — das AK des Elterntickets forderte eine Regression; ZUR HÄLFTE belegt** | LFH-333/AK5 verlangte `touchAction: 'none'` auf beiden Draggables. Alle drei Träger liegen in `overflow: auto`-Containern; die Angabe schaltet natives Scrollen auf dem Element ab — das Tablet könnte die Platzliste **nicht mehr scrollen**, während die Suite grün meldet. Der `PointerSensor` deckt Berührung über Pointer Events bereits ab; dnd-kit empfiehlt `PointerSensor` **oder** `MouseSensor`+`TouchSensor`, nicht beides nebeneinander. Eine Umstellung bewegte zudem die 5-px-Aktivierungsdistanz, auf der **drei** `onClick`-Koexistenzen ruhen (Personenkarte, Platzkarte, neuer Zuweisungsweg). Festlegung: **B5g macht nicht das Ziehen berührungstauglich, sondern die Aufgabe ohne Ziehen erledigbar** — was der Tickeltitel sagt. **Belegt ist die Scroll-Hälfte:** zwei Zusicherungen halten fest, dass Platz- und Personenkarte keine solche Angabe tragen; geprüft wird der Inline-Style, nicht ein Pixel, und beide fallen genau auf die Mutation, die das Eltern-AK gefordert hätte. **Nicht belegt ist die zweite Hälfte** („und der Drag startet trotzdem") → siehe Tabelle unten |
| 1b · Nachtrag: der Riegel gegen Fehlauslösung | **erfüllt, mit einem gemessenen Gegenbefund** | Ein Wurzel-`onClick` auf der Karte feuert bei jedem Klick auf ein Element **darin** mit — die vier Aktions-Knöpfe stoppten bisher nur `pointerdown`, was den folgenden `click` nicht aufhält. Der naheliegende Riegel am `menu.onClick` (`domEvent.stopPropagation()`) **wirkt nicht**: mit ihm allein blieb der Regressionstest rot, der Callback läuft zu spät für die Ausbreitung. Wirksam ist **ein** `click`-Riegel an der Aktionszeile, in deren Teilbaum auch das Dropdown hängt; er fängt beide Fälle. Beide Regressionstests sind per **Mutationsprobe** belegt (Riegel entfernt → beide rot) |

**0 Zeilen ohne Verdikt.** Ein offener, drei teilweise erfüllte — jede mit Ziel:

| Zeile | offen woran | Ziel |
| --- | --- | --- |
| 3, 12 | Sammelbanner statt eingeschobener Live-Änderungen; optimistische Updates | **B6 (LFH-334)** — Ticket existiert |
| 8 | kein Helligkeitsregler in der Anwendung | Folge-Task aus A0, dort ausdrücklich weiterverwiesen |
| 2 | Dichtestufe wird nicht aus dem Einsatzkontext abgeleitet | B5-Restpunkt (LFH-333) |
| **13** | Fokus-Sichtbarkeit beim Durchtabben der absolut positionierten Karten | **noch nicht getickt** — nur im Browser messbar, wäre der erste Dichte-/Fokus-e2e-Nachweis des Repos |
| **14** | Spaltenschalter mit Zähler im Materialreiter | **noch nicht getickt** — Bestand, nicht von B5g verursacht |
| **1a** | zweite AK-Hälfte: dass der Drag trotz des neuen Wurzel-`onClick` **ankommt** — in jsdom nicht fahrbar (unten begründet, mit dem gemessenen Teilergebnis) | **LFH-341/C6** — dessen AK1 fordert den Touch-e2e-Nachweis ohnehin |
| 15b, „Ein Befund, der aus dem Umfang fällt" | handgebauter „Material zuordnen"-Dialog; `gap: 4` in der Aktionszeile; die Popconfirm-Frage an „Material lösen" | **LFH-378 — erledigt 31.07.2026**, siehe Nachtrag unten. Zwei der dortigen Messungen korrigieren diese Prüfliste; der verbliebene Überlauf der Aktionszeile ist **LFH-379** |

Die fett markierten Zeilen zeigen auf **kein** Ticket, und das steht hier ausdrücklich so statt
als „→ Zielticket". Ein Verweis auf eine Nummer, die es nicht gibt, liest sich wie erledigte
Planung.

> **DIESE BEIDEN TABELLEN SIND DER STAND VOM 30.07.2026 UND TEILWEISE ÜBERHOLT.** Drei der
> dort genannten Ziele sind seither **shipped** (B6/LFH-334, B5/LFH-333) oder falsch adressiert
> — ein Verdikt „offen → Ticket X", dessen X erledigt ist, liest sich wie geplante Arbeit, die
> in Wahrheit niemand mehr tut. Die **gültigen** Verdikte und Zieltickets stehen im
> C6-Nachtrag am Ende dieses Dokuments; die Tabellen hier bleiben als Messpunkt stehen, nicht
> als Arbeitsvorrat.

---

## Ein Befund, der aus dem Umfang fällt

**Die destruktive Nachbarschaft in der Aktionszeile bleibt bestehen.** „zurückweisen" (`danger`)
steht 4 px neben „Verbleib / Entlassung erfassen". Die Leitlinie fordert dort mindestens
`token.marginSM`. Der heutige Wert ist `gap: 4` (`Grundriss.tsx`, Aktionszeile) und liegt damit
in **jeder** Stufe unter dem Boden.

**Nachgemessen, und die naheliegende Ausrede hält nicht:** `marginSM` ist `abstand.sm` und steht
auf **7 / 11 / 16 px** (`theme/tokens.ts`, gemappt bei `:305`). Bei vier Knöpfen à 24 px in einer
128 px breiten Zeile bleiben für drei Abstände 32 px, also rund 10,7 px je Lücke — in der
**kompakten** Stufe (7 px) passt der geforderte Abstand also bequem, in `komfortabel` (11 px)
fehlt 1 px, und erst im Handschuh-Betrieb (16 px) bricht es. „Nicht umsetzbar" gilt damit **nicht
für die Basisstufe**, und eine Zahl ohne die Stufe, für die sie gilt, ist genau der Mangel, den
dieses Dokument an anderer Stelle anprangert.

Warum es trotzdem hier stehen bleibt statt behoben zu werden: der Abstand müsste dichteabhängig
gedeckelt werden, sonst überlaufen die Knöpfe ab `komfortabel` die Zeile, die `overflow: hidden`
dann abschneidet — also derselbe `SCHRITT_Y`-Deckel wie in Zeile 1, nur an anderer Stelle. Ein
Eintrag im `aktionsabstand.guard.test.ts` wäre zudem falsch: dessen Prüfung zielt auf
`<Space>`-Reihen, und diese Zeile ist keine. Der Fall ist benannt und **nicht** stillschweigend
umgangen → **LFH-378**.

### Nachtrag 31.07.2026 — erledigt in LFH-378, und die Rechnung oben war falsch

Alle drei Befunde sind umgesetzt. Zwei davon **korrigieren, was hier steht**, und das gehört an
die Stelle statt in ein Erfolgsprotokoll:

**Die 10,7 px je Lücke gelten nur in der kompakten Stufe.** Der Absatz oben rechnet mit „vier
Knöpfen à 24 px" über alle Stufen hinweg. Nachgemessen: antd gibt einem **icon-only**-Knopf
`width: controlHeight` — bei `size="small"` also `controlHeightSM`, und das ist über die Staffel
**24 / 48 / 72 px** (`antd/lib/button/style/index.js`, `genButtonStyle` +
`genSizeSmallButtonStyle`). Die Knöpfe sind ausserdem Flex-Items **ohne** `flex-shrink: 0` — sie
laufen also gar nicht über, sie **schrumpfen**. Ab `komfortabel` brauchen vier Knöpfe allein
4 × 48 = 192 px in einer 124 px breiten Zeile (140 − 2×2 Rand − 2×6 Polsterung; die „128 px" oben
vergessen den Rand). Folge: dort ginge **jede** Lücke direkt von der Trefffläche ab, und ein
ungedeckeltes `marginSM` wäre nominell regelkonform und in der Bedienung **schlechter**.

Umgesetzt ist deshalb ein Deckel: `aktionsabstand()` in `Grundriss.tsx` nimmt `token.marginSM`
als **Obergrenze**, Ergebnis **7 / 0 / 0**. Rein und exportiert nach dem Muster von
`bedienzielStil`, geprüft gegen Literale je Dichtestufe und über zwei Stufen **ungleich**.

Dass die Zeile ab `komfortabel` überhaupt überläuft und die Knöpfe unter den Trefflächenboden
schrumpfen, ist damit **nicht** behoben — es ist ein eigener Befund, den weder B5g noch LFH-378
im Umfang hatten, und liegt als **LFH-379** auf dem Board.

**„Enter ist tot" ist bei einem `Select` nicht behebbar.** Zeile 15b oben nennt es als Mangel des
handgebauten Dialogs. Der Umbau auf `ErfassungsModal` ist erfolgt, aber Enter sendet weiterhin
nicht ab: `@rc-component/select` ruft in `BaseSelect/index.js:246` bei **jedem** Enter
`event.preventDefault()`, solange der Modus nicht `combobox` ist („Do not submit form when type in
the input"). Ein `Select` ist damit von der Enter-Zusicherung ausgenommen wie eine
`Input.TextArea`. Belegt wird stattdessen die **Struktur** — kein `.ant-modal-footer`, und der
Absende-Knopf hat ein `form` als Vorfahr.

**„Nur auf zwei der vier Auswege" stimmt für diese Maske nicht.** Ebenfalls Zeile 15b. antds
`Modal` ruft `onCancel` für **alle vier** Auswege, und der Bestand leerte dort seinen `useState` —
die Maske war also nie lückenhaft. Der gemessene Reset-Fehler aus LFH-332 traf Masken mit einem
`Form`-Speicher, der das Abhängen der Kinder überlebt; einen solchen bekommt diese Maske durch den
Umbau **erst**. Der Escape-Test ist deshalb kein Fix-Beleg, sondern der Riegel dagegen, dass der
Umbau eine Lücke einbaut, die vorher nicht da war.

**Die Rückfrage an „Material lösen" ist entfernt**, mit Begründung am Code: die Aktion ist über
„Material zuordnen" umkehrbar, CLAUDE.md nennt „eine gelöste Zuordnung" wörtlich als Beispiel. Sie
war zugleich der einzige Riegel gegen einen zweiten Klick — der liegt jetzt als `loading` je Zeile
dort, nicht je Mutation (die bedient alle Zeilen).

## Was diese Prüfliste nicht beweist

**Die Zahlen der Baseline sind Scanner-Zahlen, keine Verhaltensbelege.** „4 Stellen in
`pages/uhs/`" heisst: der Dichte-Guard findet dort vier. Er sieht nach seinem eigenen
Kopfkommentar weiterhin kein gespreiztes `{...props}`, keine Grösse aus einer Variablen und
keine Wrapper-Komponente, die die Prop intern setzt.

**Die Trefflächen-Aussage der Karte ist gerechnet, nicht gemessen.** 140 × 116 px steht als
Inline-Style im Quelltext; ein gerendertes Pixel belegt das nicht, weil jsdom kein Layout
rechnet und `test/utils.tsx` ein nacktes `ConfigProvider` ohne Theme mountet. Was belegt ist:
dass der Klickweg ohne jedes Drag-Ereignis zum Ziel führt und **welchen Rumpf** er dabei
abschickt (`art`/`uhs_id`/`platz_id`, über msw abgefangen, in beiden Ableitungen `eintritt` und
`wechsel`) — nicht bloss „eine Mutation wurde gerufen". Ein Mock auf `useMutation` wäre auch dann
grün gewesen, wenn der Klickweg nur den bestehenden DragEnd-Handler synthetisch ausgelöst hätte.

**DREI Tests waren zuerst blind, und das ist der Grund für ihre heutige Form.** Die beiden
Regressionstests gegen die Fehlauslösung prüften anfangs auf das *Auswahlfeld* und renderten
ohne zuweisbare Person — dann zeigt der Dialog „Niemand zuweisbar" statt einer Auswahl, und die
Prüfung war unwiderlegbar. Gemessen: mit entferntem Riegel blieben beide grün. Der **dritte** war
derselbe Fehler an anderer Stelle: „reagiert nicht, wenn der Platz belegt ist" rendert nur den
Belegenden, und der steht in keiner der beiden Kandidatenlisten — auch dort wäre kein Auswahlfeld
erschienen. Gemessen: ohne die `belegtVon`-Bedingung blieb er grün. Alle drei prüfen jetzt auf
den **Dialog** und rendern mit Kandidat; die Mutationsprobe färbt jeden einzeln rot.

**Der Tastaturweg ist NICHT belegt, nur der Menü-Eintrag.** Der Test dazu wird mit der Maus
gefahren und heisst seit dieser Korrektur auch so. Ein antd-Dropdown mit `trigger={['click']}`
liess sich in jsdom nicht per Tastatur öffnen (gemessen: Enter auf dem Auslöser, dann Pfeil und
Enter im Menü — der Dialog bleibt zu). Belegt ist, dass der Eintrag existiert und den Dialog
öffnet; dass eine Tastatur ihn erreicht, ist eine Absichts-Aussage.

**Und der Drag-Nachweis fehlt ganz.** Versucht wurde er über den `KeyboardSensor` mit
gefälschten Rechtecken und einem meldenden `ResizeObserver` (`test/setup.ts` stellt bewusst einen
No-op-Stub bereit, aber dnd-kit misst seine Drop-Ziele darüber). Der Zug **hebt** dabei
nachweislich **ab** — die Live-Region von dnd-kit meldete „Picked up draggable item person-5" —,
kommt aber nie an: `over` bleibt null, weil jsdom kein Layout rechnet. Ein grüner Test dafür
prüfte den Mock, nicht die Anwendung; deshalb steht hier keiner.

---

# Nachtrag 20.08.2026 — LFH-341 · C6 (Touch-Nachweis, Umbruch unter `lg`, Aufnahme ohne Modulwechsel)

**Die Prüfliste wird fortgeschrieben, nicht ersetzt.** B5g hat den Klickweg gebaut, C6 hat ihn
unter Berührung nachgewiesen, den Grundriss unter `lg` umgebrochen, die Aufnahme an die
UHS-Kopfzeile geholt und dem Materialstatus die Farbrolle gegeben, die C4 ausdrücklich offen
gelassen hatte. Die Zeile **1a** — die einzige, die das Ticket namentlich zitiert — wird hier
geschlossen.

**Umfang von C6:** `pages/uhs/Grundriss.tsx` (Reiter-Weiche, Rückweg-Menüeintrag) ·
`pages/uhs/UhsDetailPage.tsx` (Seitenkopf-Primitiv, Aufnahme-Knopf) · `pages/uhs/MaterialTab.tsx`
und `pages/MaterialPage.tsx` (eine Farbquelle) · `theme/statusFarben.ts` (`materialStatus`) ·
`pages/personen/AufnahmePage.tsx` (`?uhs=`-Auftrag) · `pages/EinsatzabschnittePage.tsx` und
`pages/bereitstellungsraum/` (je eine Layout-Weiche) · `routing/deeplinks.ts` ·
`frontend/e2e/uhs-grundriss-touch.spec.ts` (neu).

## Was C6 gemessen verändert hat

| Größe | vor C6 | nach C6 |
| --- | --- | --- |
| Wege, eine Person einem Platz zuzuweisen (breit) | 3 (Ziehen · Klick auf die Karte · Menü-Eintrag) | **3**, unverändert |
| Wege **unter `lg`** | 2 (Klick · Menü-Eintrag; der Drag ist dort strukturell keiner) | **2**, plus der **Rückweg** im Menü |
| Aufrufer von `belegMut` | 2 (DragEnd, Zuweisungsdialog) | **3** (+ „Zurück in den Wartebereich") |
| davon mit Nachweis des optimistischen Updates (beide Richtungen) | 1 von 2 | **3 von 3** — 2 in Vitest, 1 in Playwright |
| Primäraktionen im gezählten Kopf-Slot, Status `aktiv` | 0 (kein `EinsatzSeite`-Kopf) | **1** („Patient aufnehmen") |
| Rohe Wire-Werte auf dem Schirm (`MaterialTab`, `UhsDetailPage`, `Grundriss`) | 3 | **0** |
| Farbquellen für `MaterialStatus` | 2 (`MaterialPage` lokal, `MaterialTab` ohne) | **1** (`theme/statusFarben.ts`) |
| e2e-Fälle über den UHS-Grundriss | 7 | **11** |

**Kopfhöhe der UHS-Detailseite, im Browser gemessen** (Playwright/Chromium, 20.08.2026; Oberkante
des Grundriss-Containers im Viewport — der Wert, den die feste Reserve `calc(100vh - 300px)`
treffen müsste):

| Breite | Stufe | Kopf ist | Reserve | Differenz |
| --- | --- | --- | --- | --- |
| 1366 / 1024 | kompakt | **210 px** | 300 | 90 px verschenkt |
| 1024 | komfortabel | **263 px** | 300 | 37 px verschenkt |
| 1024 | handschuh | **331 px** | 300 | 31 px zu wenig |
| 390 | kompakt | **260 px** | 300 | 40 px verschenkt |
| 390 | handschuh | **440 px** | 300 | 140 px zu wenig |

Das ist der Browser-Blick, den das Ruling zur Höhenrechnung (LFH-341 · Task 2) an diese Stelle
verwiesen hat — dort stand eine **Schätzung** („+40–60 px, NICHT gemessen"), hier steht die
Messung. Nichts wird abgeschnitten und nichts überlappt; die Seite scrollt bewusst. Der Mangel
ist, dass ein fester Pixelwert eine **dichteabhängige** Größe schätzt und dabei in beide
Richtungen danebenliegt → **LFH-459**.

## Die 15 Kriterien, neu verdiktet für C6

| #  | Verdikt | Beleg / Zielticket |
| -- | ------- | ------------------ |
| 1 · Treffläche | **erfüllt über den Bedienweg, unverändert über die Grösse** | Die Kartenfläche von 140 × 116 px bleibt das Ziel (Zeile 1 oben, unverändert gültig). **Neu hinzugekommen unter `lg`:** drei Reiterköpfe („Fläche | Wartebereich | Transport"), die ihre Höhe vom `ConfigProvider` erben — keine Grössen-Prop, kein neuer Eintrag in der Schuldliste; `dichte.guard.test.ts` zählt für `pages/uhs/` weiterhin **vier** Stellen in **einer** Datei, alle vier die geprüfte Dauerausnahme. Der Deckel selbst bleibt an `SCHRITT_Y = 120` → **LFH-359** |
| 2 · Handschuh-Modus | **erfüllt für die neuen Wege, mit einem gemessenen Nebenbefund** | Reiter, Menü-Eintrag und Aufnahme-Knopf tragen keine Grössen-Prop und erben die Stufe. Gemessen wurde diesmal wirklich im Browser: die Seite steht in allen drei Stufen ohne Überlappung. **Zwei Befunde daraus, beide ausserhalb des C6-Umfangs:** die Höhenreserve ist dichteblind → **LFH-459**, und die **globale Kopfzeile** läuft in der Handschuh-Stufe quer über den Schirm hinaus (71 px bei 1024, 18 px bei 390, 0 bei 1366) → **LFH-460**. Die Ableitung der Stufe aus dem Einsatzkontext hängt weiter an der gespeicherten Wahl mit Vorbelegung über die Zeigerart — LFH-333/B5 ist **shipped**, der Grundriss-Sonderfall lebt in **LFH-359** weiter |
| 3 · Rückmeldung vor der Serverantwort | **erfüllt — und das ist die Korrektur an der alten Zeile 3** | Sie sagte „optimistische Updates gibt es hier so wenig wie sonst im Repo → B6". Das stimmt nicht mehr: `belegMut` und `layoutMut` tragen `onMutate` mit `setQueryData` und Rollback im `onError` (gemessen an `main` vor diesem Branch: 2 Treffer). **C6 hat nicht das Feature gebaut, sondern den Nachweis geführt** — und die Bestandsaufnahme aus Task 6 sagt, wie schmal der war: von sechs Fällen (drei Aufrufer × zwei Richtungen) waren **zwei** belegt (Zuweisungsdialog, `Grundriss.test.tsx`), **zwei** hat C6 in Vitest ergänzt (Rückweg-Menüeintrag, `GrundrissTabs.test.tsx`), **zwei** waren in jsdom strukturell unmöglich und stehen jetzt in Playwright (`uhs-grundriss-touch.spec.ts`, Vorbehalt A unten). B6/LFH-334 ist **shipped** und ist kein offenes Ziel mehr |
| 4 · Kritische Aktion hat eine zweite Handlung | **erfüllt, und der Rückweg ist jetzt vollständig** | Die Zuweisung bleibt umkehrbar — aber unter `lg` hing die Umkehrung **allein am Drag auf `drop-inbox`**, und den gibt es im Reiter-Zweig nicht mehr (Quelle und Ziel liegen in verschiedenen Reitern). Ohne Nacharbeit hätte der Umbruch eine Bewegung **genommen**. „Zurück in den Wartebereich" im Platzaktionen-Menü ist diese Nacharbeit (`Grundriss.tsx:247`, nur am belegten Platz). Weiterhin **keine** Rückfrage: umkehrbar → kein zusätzlicher Reibungsschritt (LFH-363) |
| 5 · Kontrast in beiden Modi | **erfüllt** | C6 führt keinen Farbwert ein. `materialStatus` (`theme/statusFarben.ts:168-174`) bildet auf **bestehende** Rollen ab; `bedien` für `im_einsatz` wird nicht erfunden, sondern erkannt (dieselbe Rolle trägt `verfuegbarkeit.reserviert`, `belegungsArt.wechsel`, `etbTyp.meldung`). Reiter und Aufnahme-Knopf liegen im Theme |
| 6 · Kein Status allein über Farbe | **erfüllt** | Jeder der fünf `materialStatus`-Werte trägt ein Pflicht-`label`; `defekt` und `verbraucht` teilen sich `alarm` und werden **über das Wort** unterschieden — dasselbe Muster, mit dem sich die fünf Warnstufen drei Rollen teilen. Der UHS-Typ trägt `neutral` und existiert nur als Beschriftung. Der Reiter-Zweig fügt keinen farbcodierten Zustand hinzu |
| 7 · Eine Farbe = eine Bedeutung | **erfüllt, und eine doppelte Behandlung ist beseitigt** | `MaterialStatus` hatte **zwei** Farbbehandlungen: eine lokale in `pages/MaterialPage.tsx` und gar keine in `pages/uhs/MaterialTab.tsx`. Beide lesen jetzt aus `theme/statusFarben.ts`. Zwei Behandlungen desselben Enums sind der Fehlerfall, nicht der Kompromiss — deshalb hat C6 die Kräfte-Seite mit angefasst, obwohl sein Ticket sie nicht nennt. Kein neues `danger` im Umfang; die Reihe im UHS-Kopf trägt `size="middle"` und steht in `aktionsabstand.guard.test.ts` |
| 8 · Helligkeits-/Kontrastregler | **offen** | Unverändert: es gibt keinen in der Anwendung, A0 hat ihn ausdrücklich weiterverwiesen → **Folge-Task aus A0**. C6 ändert daran nichts und behauptet es auch nicht |
| 9 · Kritische Anzeigen im Blickfeld | **erfüllt — die alte Zeile 9 ist durch den Umbruch falsch geworden** | Sie sagte „Die Drei-Spalten-Ordnung bleibt". Unter `lg` bleibt sie **nicht**: es sind drei Reiter, und ohne `forceRender` stehen die beiden anderen gar nicht im Baum. Genau deshalb ist die **Fläche der Default-Reiter** (`Grundriss.tsx:833`) — die Arbeitsfläche des BHP ist die kritische Anzeige, die anderen beiden sind eine Berührung entfernt. Breit ist die Ordnung unverändert. Der Zuweisungsdialog trägt den Zielplatz weiterhin im Titel |
| 10 · Alarmbudget | **nicht anwendbar** | Der Grundriss erzeugt keine Alarme |
| 11 · Warnverhalten | **erfüllt** | Kein Blinken, kein Ton. Neu und bewusst: der Offline-Fall der Aufnahme meldet über `message.warning` statt stumm zu bleiben (`AufnahmePage.tsx:130`) — Text, keine Bewegung |
| 12 · Kein Sprung unter dem Cursor | **erfüllt für den Umbau, offen im Bestand — und das Ziel ist nicht mehr B6** | Der Reiter-Wechsel verändert kein Layout unter dem Finger, die Karten behalten ihre feste Grösse, und der Rückweg-Eintrag erscheint nur am belegten Platz. **Offen bleibt:** Belegungsänderungen anderer Stellen fahren über den SSE-Fan-out direkt in die handgebauten Personenspalten des Grundrisses. B6/LFH-334 ist **shipped** und hat den Sammelbanner im `Datensicht`-Primitiv gebaut (`Datensicht.tsx:754`, `zufluss: 'sammelbanner'`); die Spalten des Grundrisses sind **kein** `Datensicht` und haben ihn nie bekommen. Die **Fläche** braucht ihn nicht — ihre Karten stehen absolut auf `pos_x`/`pos_y` und schieben einander nicht. → **noch nicht getickt**, und das steht hier so, statt auf ein erledigtes Ticket zu zeigen |
| 13 · Fokus nie verdeckt | **teilweise erfüllt** | Unverändert gilt: der Dialog führt den Fokus, der Menü-Eintrag ist über Tastatur gedacht und in jsdom nicht belegbar. **Neu:** die drei Reiterköpfe sind reguläre antd-Tabs mit ihrer Tastaturbedienung; die Reihenfolge im Tab-Durchlauf ist Fläche → Wartebereich → Transport, also die der sichtbaren Köpfe. **Offen bleibt** die Frage, ob ein Fokusziel beim Durchtabben der absolut positionierten Platzkarten hinter dem Rand des Scrollcontainers landet. Die alte Fassung nannte das „wäre der erste Dichte-/Fokus-e2e-Nachweis des Repos" — **das stimmt nicht mehr**: `frontend/e2e/fokus-verdeckung.spec.ts` führt das Verfahren samt Selbstbeweis, für `KatalogTabelle` und den Tabellenzweig der `Datensicht`. Es fehlt nur die Anwendung auf den Grundriss → **noch nicht getickt** |
| 14 · Tabellenseite vollständig | **dreigeteilt: nicht anwendbar / erfüllt / offen** | **Grundriss:** nicht anwendbar — hier wird verortet, nicht verglichen. **Bewegungen-Reiter:** **erfüllt**, und das ist die Korrektur an der alten Zeile: er ist seit B2 kein handgebautes `Table` mehr, sondern `Datensicht` mit Standardsortierung, Art-Filter und Suche (`BewegungenTab.tsx:148-169`). Ein Spaltenschalter fehlt dort **absichtlich** — alle fünf Spalten tragen `immerSichtbar`, weil es keine gibt, die man sinnvoll abwählt; ein Schalter samt Zähler wäre ein Bedienelement für eine Entscheidung, die niemand treffen muss. Das steht als Begründung im Code. **Material-Reiter:** **offen** — er nutzt weiterhin `KatalogTabelle` (Scrollcontainer und stehende Kopfzeile ✓, Spaltenschalter mit Zähler ✗) → **noch nicht getickt**, Bestand, weder von B5g noch von C6 verursacht |
| 15a · Erfassungsmaske — Zuweisungsdialog | **erfüllt, unverändert** | `ErfassungsModal`, ein Feld, Zielplatz im Titel, kein Serienmodus mit Begründung. C6 fasst die Maske nicht an |
| 15b · Erfassungsmaske — „Material zuordnen" | **erfüllt seit LFH-378** | Umgebaut auf `ErfassungsModal`. Die Enter-Zusicherung greift dort nicht, weil das einzige Feld ein `Select` ist — das ist eine Bibliothekseigenschaft, kein Umsetzungsfehler (Nachtrag 31.07.2026 oben). Geprüft wird die Struktur |
| 15c · Erfassungsmaske — Patientenaufnahme (**neu mit C6**) | **erfüllt, mit einer benannten Lücke** | Die Aufnahme an der UHS baut **kein zweites Formular**: „Patient aufnehmen" navigiert auf die gemeinsame Route aus C5 (`personenAufnahmePfad(einsatzId, { uhs })` → `?uhs=<id>`), die `personen/AufnahmeFelder.tsx` und den Serienbetrieb der Erfassungshülle mitbringt. Breadcrumb und Seitenbeschreibung tragen den UHS-Auftrag, der Abschluss führt auf die UHS zurück. **Die Lücke ist offline und sie ist ehrlich benannt statt behauptet** — Vorbehalt B unten → **LFH-458** |
| **1a · Nachtrag: die Sensorik** | **GESCHLOSSEN — beide Hälften belegt, unter dem Vorbehalt synthetischer Pointer-Events** | Die zweite Hälfte („und der Drag kommt trotzdem an") ist das, was B5g offen liess und dieses Ticket als AK1 forderte. Belegt in `frontend/e2e/uhs-grundriss-touch.spec.ts`: der Touch-Drag bei 1024 px legt eine Person auf „Bett 1" (`:175`), eine abgelehnte Zuordnung rollt zurück (`:221`), und die Warteliste **scrollt bei angehaltenem Drag weiter** (`:278`) — das ist die Gegenprobe zu der Regression, die das ursprüngliche Eltern-AK mit `touchAction: 'none'` verlangt hätte. Die Entscheidung von B5g ist damit nicht nur begründet, sondern **gemessen richtig**. Bei 390 px trägt der Klickweg (`:374`). **Der Vorbehalt gehört in dieses Verdikt, nicht in eine Fussnote:** synthetische Pointer-Events sind untrusted — belegt ist, dass der Code-Pfad unter `pointerType: 'touch'` feuert, **nicht**, dass ein echter Finger den Drag zu Ende bringt (Vorbehalt A) |
| **1b · Nachtrag: der Riegel gegen Fehlauslösung** | **erfüllt, unverändert** | Der `click`-Riegel an der Aktionszeile trägt weiter; C6 hat die Zeile nicht bewegt. Der neue Rückweg-Eintrag hängt im selben Teilbaum und ist damit mitgedeckt |

**0 Zeilen ohne Verdikt.** Eine Zeile ist geschlossen (1a), eine ist hinzugekommen (15c), drei
alte Verdikte sind **korrigiert** statt fortgeschrieben (3, 9, 14) — in allen drei Fällen, weil
die Begründung von 2026 heute nicht mehr stimmt.

### Offene Zeilen, mit gültigem Ziel

| Zeile | offen woran | Ziel |
| --- | --- | --- |
| 1, 2 | Der Trefflächen-Deckel der Platzkarte hängt an `SCHRITT_Y = 120` im Backend | **LFH-359** — Ticket existiert, Status `backlog` |
| 2 | Höhenreserve der UHS-Seite dichteblind (gemessen 210 / 263 / 331 gegen 300) | **LFH-459** — neu angelegt |
| 2 | Kopfzeile läuft im Handschuh-Modus quer (71 px bei 1024) | **LFH-460** — neu angelegt |
| 8 | kein Helligkeitsregler in der Anwendung | Folge-Task aus A0 |
| 12 | Sammelbanner für die handgebauten Personenspalten des Grundrisses | **noch nicht getickt** — B6/LFH-334 ist shipped und hat ihn im `Datensicht`-Primitiv gebaut, das der Grundriss nicht nutzt |
| 13 | Fokus-Sichtbarkeit beim Durchtabben der absolut positionierten Platzkarten | **noch nicht getickt** — das Verfahren steht seit `fokus-verdeckung.spec.ts`, nur die Anwendung auf den Grundriss fehlt |
| 14 | Spaltenschalter mit Zähler im Material-Reiter | **noch nicht getickt** — Bestand |
| 15c | Offline-Zuordnung zur UHS bei der Aufnahme | **LFH-458** — neu angelegt |

Die drei „noch nicht getickt" zeigen weiterhin bewusst auf **keine** Nummer. Sie auf ein
erledigtes Ticket zu richten wäre schlimmer als sie ohne Ziel zu lassen: eine Nummer im Status
`shipped` liest sich wie geplante Arbeit, die niemand mehr tut.

## Sieben Verdikte zum Zuschnitt — was gebaut wurde und was nicht

Diese sieben sind **keine** Kriterienzeilen. Sie halten fest, wo C6 vom Ticketwortlaut abweicht
und warum — damit ein späterer Leser, der ein unerfülltes Akzeptanzkriterium sucht, die Antwort
an einer Stelle findet statt sie zwischen den 15 Zeilen zu suchen.

**1 · „Paginierung 50" im Bewegungen-Reiter — überholt durch LFH-330/B2, nicht gebaut.** Das
Ticket verlangt „Paginierung 50" wörtlich. `components/Datensicht.tsx:1237-1240` setzt
`pagination={false}` und begründet es: „eine Seitenblätterung schnitte die Zeilenschleuse
entzwei". Der Reiter ist seit B2 ein `Datensicht`-Konsument; eine Blätterung nachzurüsten hiesse,
eine Zusicherung des Primitivs für einen Konsumenten aufzuheben. Das Kriterium dahinter — die
Tabelle muss bedienbar sein — ist über Sortierung, Art-Filter und Suche erfüllt.

**2 · „Unter `md` eine Zeitleiste" — erfüllt durch die Kartenform von B2, nicht als zweite
Bauform.** Das Ticket beschreibt „eine Zeile je Bewegung mit farbigem Art-Tag, Uhrzeit und
Registriernummer". Genau das rendert der Kartenzweig der `Datensicht` bereits
(`BewegungenTab.tsx:160-168`): Kartentitel ist die Person samt Registriernummer, `status` trägt
das Art-Tag aus `belegungsArt`, `sekundaer` die Zeit. Eine handgebaute Zeitleiste daneben wäre
eine zweite Bauform für dieselbe Sache — dieselbe Begründung, mit der `GefahrenPage.tsx:160` den
Collapse verwirft.

**3 · Gliederungsbaum und BR-Kräftespalte — gestapelt statt aufklappbarer Kopfbereich.** Das
Ticket verlangt „aufklappbarer Kopfbereich statt fester Spalte". Gebaut ist **gestapelt**, nach
der Präzedenz `GefahrenPage.tsx:160`, die den Geschwisterfall im Bestand schon entschieden hat:
ein Collapse wäre „eine zweite Bedienform für dieselbe Sache". Gestapelt trägt die Gliederung
dieselbe Bedienung wie breit, nur untereinander — ein Aufklapper verlangte auf dem schmalsten
Schirm eine zusätzliche Berührung vor jeder Auswahl.

**4 · Die Materialfarbe löst C4s offene Frage ein, sie dreht sie nicht zurück.** LFH-339/C4 hatte
für `MaterialStatus` bewusst **keine** Rolle vergeben — `im_einsatz` war blau, Blau ist `bedien`,
und eine ehrliche Rolle schien es nicht zu geben — und die Frage ausdrücklich als „eigene
Entscheidung, kein Nebenprodukt" offen gelassen. C6 entscheidet sie: `bedien` steht in derselben
Datei schon dreimal für eine **aktive Beziehung**. `pages/MaterialPage.tsx` ist im selben Commit
mitgezogen worden, obwohl das Ticket die Kräfte-Seite nicht nennt — zwei Farbbehandlungen eines
Enums wären der Fehlerfall, nicht der Kompromiss.

**5 · Der Rückweg in den Wartebereich hat einen zweiten Pfad bekommen.** Er hing allein am Drag
auf `drop-inbox` und wäre unter `lg` **ersatzlos** entfallen — der Umbruch hätte eine Bewegung
genommen, statt eine zu geben. Das stand in keinem Akzeptanzkriterium und ist beim Planen
gefunden worden, nicht beim Testen. Folge: `belegMut` hat **drei** Aufrufer; das AK „für beide
Aufrufer" ist erfüllt und überschritten.

**6 · Die Offline-Zuordnung ist ehrlich benannt, nicht gelöst.** Siehe Vorbehalt B → **LFH-458**.

**7 · Die UHS-Detailseite nutzt den gemeinsamen Modul-Seitenkopf.** Die Abhängigkeitszeile des
Tickets verlangte es („C5 liefert ausserdem den gemeinsamen Modul-Seitenkopf, den die UHS-Seiten
mitnutzen"), und ohne ihn wäre „genau eine Primäraktion" auf dieser Seite **nicht prüfbar**
gewesen, sondern gezählt: die Zusicherung hängt an `data-lfh="seitenkopf-aktionen"`, das nur das
Primitiv setzt. Gemessen und gepinnt sind die Ist-Zahlen je Zustand — `geplant` = 1, `aktiv` = 1;
der zweite Wert war vor C6 **null** und ist der Befund H38 in einer Zahl.

## Zwei Vorbehalte

**A · Der Drag-Nachweis des optimistischen Updates ist in jsdom strukturell unmöglich, und der
Playwright-Ersatz belegt nicht dasselbe.** Der Layout-Drag (`kind: 'platz'`) läuft ohne Drop-Ziel
über `delta`, der Personen-Drop (`kind: 'person'`) braucht zwingend ein `over`-Ziel aus dnd-kits
Kollisionserkennung — und die beruht auf `getBoundingClientRect`, das in jsdom immer
`{0,0,0,0}` liefert. Ein Vitest-Nachweis wäre kein strenger Test, sondern ein Test gegen einen
Mock. Geführt ist er deshalb in Playwright, mit **angehaltener Anfrage** statt verzögerter
Antwort — der erste Anlauf hielt die Antwort zurück und blieb auch mit abgeschaltetem `onMutate`
grün, weil der Server die Belegung längst geschrieben hatte und sein SSE-Ereignis die Karte
setzte. Das ist die Art Attrappe, die diese Prüfliste sichtbar machen soll.

**B · Synthetische Pointer-Events sind untrusted.** Die e2e-Spec belegt, dass der Code-Pfad unter
`pointerType: 'touch'` feuert — **nicht**, dass ein echter Finger den Drag zu Ende bringt. Auf
einem `overflow: auto`-Container ohne `touch-action: none` scrollt ein echter Browser bei einer
Wischbewegung und schickt `pointercancel`; ob dnd-kits 5-px-Aktivierungsdistanz davor greift, ist
eine Frage an das Gerät und nicht an die Spec. **Ein Blick auf echtem Gerät steht aus** und ist
die Grenze der Methode, nicht ihres Ergebnisses. Genau deshalb steht der Vorbehalt in Zeile 1a
selbst und nicht nur hier.

**C · Und eine offline gelassene Zuordnung.** `AufnahmePage` bucht den Wartebereich-Eintritt als
**zweiten** Request. Offline geht er verloren: `erfassePersonOfflineFaehig` legt die Person mit
`client_id`-Idempotenz in die Queue, aber kein Drain-Hook schiebt die Belegung nach (gemessen in
`offline/useOfflineSync.ts` — die Queue-Aktion trägt keine `uhs_id`). Die Quittung sagt das
deshalb: „die Zuordnung zur Unfallhilfsstelle muss danach von Hand erfolgen", zusätzlich als
`message.warning`, weil der Wortlaut auf dem Primärweg die Navigation überleben muss. Der saubere
Weg ist der, den LFH-340/C5 für die **Sichtung** gewählt hat und den `CLAUDE.md` als Regel führt:
das Feld geht **mit** dem Anlegen mit, serverseitig in derselben Transaktion → **LFH-458**.

## Warum es keine zweite Prüfliste gibt

`pages/EinsatzabschnittePage.tsx` und `pages/bereitstellungsraum/BrDetailPage.tsx` (mit
`KraefteOhneBrSidebar.tsx`) haben in C6 **je eine Layout-Weiche** bekommen — `useViewport`,
`flexDirection` und eine Breite, sonst nichts. Kein Bedienweg ist entstanden oder entfallen, kein
Datensatz wird anders erfasst, keine Farbe anders vergeben.

Gate 7 verlangt die Prüfliste an jeder neuen oder **umgebauten Seite**. Ein Umbruch ist keine
neue Seite, und eine Prüfliste, die fünfzehn Kriterien an eine geänderte `flexDirection` anlegt,
produziert vierzehn „nicht anwendbar" und einen falschen Eindruck von Sorgfalt. **Wer diese
beiden Seiten das nächste Mal inhaltlich anfasst, legt eine an** — diese Einschätzung steht hier,
damit sie nachprüfbar ist statt stillschweigend.

## Was dieser Nachtrag nicht beweist

**Die e2e-Suite ist unter kumulierter Last nicht verlässlich, und das ist kein Nebensatz.** Zwei
Stellen in `uhs-grundriss-person-scroll.spec.ts` sind während dieser Umsetzung gerissen:

* **`:151`** (Klick auf einen Platzaktionen-Menüeintrag kurz nach einer Belegung) — dreimal
  nachgemessen, 2 × grün / 1 × rot, gegen den Stand **ohne** die C6-Änderung 1 × grün / 2 × rot.
  Also **Bestand, kein Regress**. Gedämpft auf **Testebene** (bounded Re-Open über
  `expect(async).toPass()`), mit einem Kommentar an Ort und Stelle, der sagt, dass hier ein
  echter **Bedienbefund** gedämpft wird: wer im Betrieb unmittelbar nach einer Belegung ein
  Platzmenü öffnet, verliert es → **LFH-457**, dort steht auch die Rücknahme der Dämpfung als
  eigene Zu-tun-Zeile.
* **`:82`** (`toBeHidden()` im Test „belegte Person in den Wartebereich ziehen") — riss in
  **1 von 8** Sammelläufen und ist **bewusst nicht gedämpft**: die Ursache ist nicht gemessen,
  und eine zweite Dämpfung ohne Befund wäre genau das Weichklopfen, das die erste vermeiden
  soll. Diese Datei ist als Ganzes bekannt lastempfindlich → **LFH-398**, dessen
  Akzeptanzkriterium bereits lautet, dass Schritt 7 **zweimal hintereinander** grün laufen muss.

**Die Kopfhöhen sind gemessen, die Trefflächen der Platzkarte weiterhin gerechnet.** 140 × 116 px
steht als Inline-Style im Quelltext; die Browser-Messung dieses Nachtrags galt der Seitenhöhe und
dem Querlauf, nicht der Kartenfläche.

**Und die vier Knöpfe der Platzkarte sind weiterhin die einzige Klein-Angabe des Bündels.** Sie
fallen mit einer Änderung an `SCHRITT_Y`, nicht mit einem Frontend-Umbau — C6 hat daran nichts
geändert und nichts hinzugefügt.
