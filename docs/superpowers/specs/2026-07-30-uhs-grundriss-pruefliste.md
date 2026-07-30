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
| Tests in `Grundriss.test.tsx` | 18 | **35** |
| davon zu Zuweisung / Riegel / Berührung | **0** | **12** |

---

| #  | Verdikt | Beleg / Zielticket |
| -- | ------- | ------------------ |
| 1 · Treffläche | **erfüllt über den Bedienweg, NICHT über die Grösse — und das ist der Kern dieses Bündels** | Die Zuweisung hat jetzt ein Ziel von **140 × 116 px**: die ganze Platzkarte. Das ist die Antwort auf H39, und sie war nötig, weil die Grössenachse hier verschlossen ist. Die Rechnung (Dateikopf `Grundriss.tsx:27-45`, LFH-328/A2) ist unter LFH-367 **nachgerechnet und bestätigt**, nicht bloss übernommen: Innenraum = 116 − 12 − 4 = 100 px, belegt von Titel 30 + Tags 24 + Belegung 24 + Aktionen 24 = 102 px. Seit LFH-361 liegt die kleine Steuerhöhe auf 24 / 48 / 72, die volle auf 30 / 48 / 72 — in **keiner** Stufe passt eine Aktionszeile auf voller Höhe. Auch der naheliegende Ausweg „alles ins Dropdown" scheidet damit aus: dessen Auslöser ist selbst ein Knopf. Die vier Angaben bleiben deshalb als **benannte, dauerhafte** Ausnahme in der Schuldliste; sie fallen mit einer Änderung an `SCHRITT_Y` im Backend, nicht mit einem Frontend-Umbau. `MaterialTab.tsx` dagegen ist abgeräumt — dessen Lösen-Knopf sass in einer Tabellenzelle, die mitwachsen darf |
| 2 · Handschuh-Modus | **erfüllt für den neuen Weg, unverändert für die Karte** | Der Zuweisungsdialog erbt die Dichtestufe vollständig (`ErfassungsModal` + `Select` ohne Grössen-Prop), ebenso der Menü-Eintrag. Die Kartenfläche selbst ist mit 116 px in **jeder** Stufe über dem Handschuh-Boden von 72 px — ein Berührungsziel, das nicht mitwachsen muss, weil es schon gross genug ist. **Offen wie überall:** die Ableitung der Stufe aus dem Einsatzkontext hängt weiter an `localStorage['lifeline-hub.dichte']` mit Vorbelegung über die Zeigerart → **B5-Restpunkt (LFH-333)** |
| 3 · Rückmeldung vor der Serverantwort | **erfüllt** | `laeuft={belegMut.isPending}` am Zuweisungsdialog; die Hülle sperrt den Knopf und zeigt den Ladezustand. `onErfassen` ruft **`mutateAsync`**, nicht `mutate` — ein abgelehnter Serverruf lässt die Auswahl stehen statt sie stillschweigend zu leeren (Vertrag aus LFH-332/B4). Die übrigen Mutationen der Seite melden über Toast; optimistische Updates gibt es hier so wenig wie sonst im Repo → **B6 (LFH-334)** |
| 4 · Kritische Aktion hat eine zweite Handlung | **erfüllt** | Die Zuweisung ist umkehrbar und war es schon: eine falsch platzierte Person zieht man in den Wartebereich zurück (`art: 'wechsel'`/`platz_id: null`), und der neue Weg nutzt dieselbe Mutation. Deshalb trägt er **keine** Rückfrage — nach der Trennlinie aus LFH-363 (umkehrbar → kein zusätzlicher Reibungsschritt) wäre sie hier falsch, nicht fehlend. Die einzige unumkehrbare Aktion der Karte bleibt „Platz löschen", die im Bearbeiten-Modus liegt |
| 5 · Kontrast in beiden Modi | **erfüllt** | B5g führt keinen Farbwert ein. Der neue Menü-Eintrag und der Dialog liegen im Theme; die Kartenfarben (`colorPrimaryBg` bei Drop-Hover, `colorInfoBg` bei Belegung, Rahmen aus `rollenFarbe`) sind unverändert |
| 6 · Kein Status allein über Farbe | **erfüllt, unverändert** | Belegung trägt Tag **„belegt"** plus Hintergrund, Verfügbarkeit einen `StatusTag` mit Text. Der neue Klickweg fügt keinen farbcodierten Zustand hinzu; die Zuweisbarkeit zeigt sich am Mauszeiger (`pointer`) und am Menü-Eintrag, nicht an einer Farbe |
| 7 · Eine Farbe = eine Bedeutung | **erfüllt** | Keine neue Farbbelegung. Das einzige `danger` im Umfang bleibt „zurückweisen" bzw. „Platz löschen"; der neue Eintrag „Patient zuweisen" ist neutral. In `MaterialTab.tsx` trägt das Popconfirm des Lösen-Knopfes jetzt `okButtonProps={{ danger: true }}` — vorher bestätigte man die destruktive Aktion mit einem blauen Knopf |
| 8 · Helligkeits-/Kontrastregler | **offen** | Weiterhin keiner in der Anwendung; A0 hat ihn ausdrücklich weiterverwiesen → **Folge-Task aus A0** |
| 9 · Kritische Anzeigen im Blickfeld | **erfüllt** | Die Drei-Spalten-Ordnung bleibt: Eingang/Wartebereich links, Fläche in der Mitte, Transport rechts. Der Zuweisungsdialog ist ein Modal über der Fläche und trägt den Zielplatz **im Titel** („Patient zuweisen — Bett 1"), sodass der Bezug nicht verloren geht, wenn die Karte darunter verdeckt ist |
| 10 · Alarmbudget | **nicht anwendbar** | Der Grundriss erzeugt keine Alarme |
| 11 · Warnverhalten | **erfüllt** | Kein Blinken, kein Ton. Fehler kommen als Toast mit Text |
| 12 · Kein Sprung unter dem Cursor | **erfüllt für diesen Umbau** | Der neue Weg verändert kein Layout: Der Dialog liegt über der Fläche, die Karten behalten ihre feste Grösse (`PLATZ_KARTE_HOEHE`, `overflow: hidden`), und die Aktionszeile bekommt kein zusätzliches Element. **Offen, Bestand:** Belegungsänderungen anderer Stellen fahren über den SSE-Fan-out direkt in die Fläche, ohne Sammelbanner → **B6 (LFH-334)** |
| 13 · Fokus nie verdeckt | **teilweise erfüllt** | Der Dialog bringt den Fokus ins erste Feld und gibt ihn beim Schliessen zurück (Vertrag der Erfassungshülle). Der Menü-Eintrag ist über Tastatur erreichbar, das Menü trägt `autoFocus`. **Nicht belegt:** ob ein Fokusziel beim Durchtabben durch die absolut positionierten Karten hinter dem Rand des Scrollcontainers landet — jsdom rechnet kein Layout → **noch nicht getickt**, siehe Tabelle unten |
| 14 · Tabellenseite vollständig | **nicht anwendbar für den Grundriss, erfüllt für den Materialreiter** | Die Fläche ist bewusst **keine** Tabelle: sie bildet die räumliche Anordnung der Plätze ab, hier wird nicht verglichen, sondern verortet. Der Materialreiter nutzt `KatalogTabelle` mit Scrollcontainer und stehender Kopfzeile ✓; ein Spaltenschalter mit Zähler fehlt dort (`KatalogTabelle` statt `Datensicht`) — Bestand, nicht von B5g verursacht → **noch nicht getickt** |
| 15 · Erfassungsmaske vollständig | **erfüllt** | Der Zuweisungsdialog ist **nicht handgebaut**: er nimmt `ErfassungsModal` (LFH-332/B4) und erbt damit Enter-Absenden, Fokus im ersten Feld und Rücksetzen auf jedem Weg hinaus. **Ein Feld** — das Budget (Modal ≤ ~3) ist weit eingehalten; der Zielplatz steht im Titel statt als zweites Feld. Kein Serienmodus, und das ist eine Entscheidung: der Zielplatz ist je Vorgang ein anderer, ein „und nächste" hätte kein sinnvolles Nächstes. Das Auswahlfeld nutzt den Projekt-`Select` und ist damit tippbar durchsuchbar (LFH-288). Bei leerer Kandidatenmenge steht ein benannter Hinweis statt einer leeren Liste |
| 1a · Nachtrag: die Sensorik | **bewusst UNVERÄNDERT — das AK des Elterntickets forderte eine Regression** | LFH-333/AK5 verlangte `touchAction: 'none'` auf beiden Draggables. Alle drei Träger liegen in `overflow: auto`-Containern; die Angabe schaltet natives Scrollen auf dem Element ab — das Tablet könnte die Platzliste **nicht mehr scrollen**, während die Suite grün meldet. Der `PointerSensor` deckt Berührung über Pointer Events bereits ab; dnd-kit empfiehlt `PointerSensor` **oder** `MouseSensor`+`TouchSensor`, nicht beides nebeneinander. Eine Umstellung bewegte zudem die 5-px-Aktivierungsdistanz, auf der **drei** `onClick`-Koexistenzen ruhen (Personenkarte, Platzkarte, neuer Zuweisungsweg). Festlegung: **B5g macht nicht das Ziehen berührungstauglich, sondern die Aufgabe ohne Ziehen erledigbar** — was der Tickeltitel sagt. Zwei Zusicherungen halten das fest (kein `touchAction` auf Platz- und Personenkarte); geprüft wird der **Inline-Style**, nicht ein Pixel |
| 1b · Nachtrag: der Riegel gegen Fehlauslösung | **erfüllt, mit einem gemessenen Gegenbefund** | Ein Wurzel-`onClick` auf der Karte feuert bei jedem Klick auf ein Element **darin** mit — die vier Aktions-Knöpfe stoppten bisher nur `pointerdown`, was den folgenden `click` nicht aufhält. Der naheliegende Riegel am `menu.onClick` (`domEvent.stopPropagation()`) **wirkt nicht**: mit ihm allein blieb der Regressionstest rot, der Callback läuft zu spät für die Ausbreitung. Wirksam ist **ein** `click`-Riegel an der Aktionszeile, in deren Teilbaum auch das Dropdown hängt; er fängt beide Fälle. Beide Regressionstests sind per **Mutationsprobe** belegt (Riegel entfernt → beide rot) |

**0 Zeilen ohne Verdikt.** Ein offener, drei teilweise erfüllte — jede mit Ziel:

| Zeile | offen woran | Ziel |
| --- | --- | --- |
| 3, 12 | Sammelbanner statt eingeschobener Live-Änderungen; optimistische Updates | **B6 (LFH-334)** — Ticket existiert |
| 8 | kein Helligkeitsregler in der Anwendung | Folge-Task aus A0, dort ausdrücklich weiterverwiesen |
| 2 | Dichtestufe wird nicht aus dem Einsatzkontext abgeleitet | B5-Restpunkt (LFH-333) |
| **13** | Fokus-Sichtbarkeit beim Durchtabben der absolut positionierten Karten | **noch nicht getickt** — nur im Browser messbar, wäre der erste Dichte-/Fokus-e2e-Nachweis des Repos |
| **14** | Spaltenschalter mit Zähler im Materialreiter | **noch nicht getickt** — Bestand, nicht von B5g verursacht |

Die fett markierten Zeilen zeigen auf **kein** Ticket, und das steht hier ausdrücklich so statt
als „→ Zielticket". Ein Verweis auf eine Nummer, die es nicht gibt, liest sich wie erledigte
Planung.

---

## Ein Befund, der aus dem Umfang fällt

**Die destruktive Nachbarschaft in der Aktionszeile bleibt bestehen.** „zurückweisen" (`danger`)
steht 4 px neben „Verbleib / Entlassung erfassen". Die Leitlinie fordert dort mindestens
`token.marginSM`. Das ist hier **nicht** umsetzbar, ohne dieselbe Grenze zu reissen wie in
Zeile 1: bei vier Knöpfen à 24 px in einer 128 px breiten Zeile bleiben für drei Abstände 32 px,
und `marginSM` wächst mit der Dichtestufe. Der Fall gehört damit zu derselben `SCHRITT_Y`-Frage
und fällt mit ihr — nicht mit einem Abstandswert. Er ist hier benannt und **nicht** stillschweigend
umgangen; ein Eintrag im `aktionsabstand.guard.test.ts` wäre falsch, weil dessen Prüfung auf
`<Space>`-Reihen zielt und diese Zeile keine ist.

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

**Zwei Tests waren zuerst blind, und das ist der Grund für ihre heutige Form.** Die beiden
Regressionstests gegen die Fehlauslösung prüften anfangs auf das *Auswahlfeld* und rendertem
ohne zuweisbare Person — dann zeigt der Dialog „Niemand zuweisbar" statt einer Auswahl, und die
Prüfung war unwiderlegbar. Gemessen: mit entferntem Riegel blieben beide grün. Sie prüfen
deshalb jetzt auf den **Dialog** und rendern mit Kandidat; die Mutationsprobe färbt beide rot.
