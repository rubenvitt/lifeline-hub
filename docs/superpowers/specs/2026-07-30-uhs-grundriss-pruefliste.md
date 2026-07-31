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
