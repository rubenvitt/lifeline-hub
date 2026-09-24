# Prüfliste Einsatztauglichkeit — Modul „Betreuung" (LFH-639)

Gate 7 der Bedien-Leitlinie (`2026-07-25-bedien-leitlinie-einsatzkontexte.md`, Festlegung 7)
verlangt diese Liste an jeder neuen Seite. Planung und Spec liegen in
`openspec/changes/lfh-639-fachmodul-betreuung/`.

## Geltungsbereich

| Angabe | Wert |
| --- | --- |
| Route | `/einsaetze/:id/betreuung` (`frontend/src/pages/BetreuungPage.tsx`) |
| Stand | Code-Stand Commit `fc58fee2` auf `claude/lfh-639-048ca8` (letzter Fix der abschließenden Review-Runde); die Prüfliste selbst ist der Commit danach |
| Zielkontext | Fükw (1366 px, Tastatur + Maus); Führungs-Tablet in `komfortabel`/`handschuh` für Stand- und Belegungsmeldungen; ortsfeste Stelle (Betreuungsstelle, Anlaufstelle) für die Belegung; mobil 390 px lesend und für Einzelmeldungen |
| Nicht enthalten | Lagekarte (LFH-673), Personenverknüpfung (LFH-674), Offline-Erfassung (LFH-675), Verlaufsansicht der Meldereihen (LFH-676) — Non-Goals aus design.md, als Nachzüge angelegt (Aufgabe 5.3) |

| Fläche | Stellvertreter | Browser-Messung |
| --- | --- | --- |
| **1 · Seite mit Kopf, Block „Evakuierung" (Karten) und Block „Betreuungsstellen" (Tabelle)** | `pages/BetreuungPage.tsx`, `betreuung/EvakuierungBlock.tsx`, `betreuung/StellenBlock.tsx`, Menüslot `weitere` in `components/Datensicht.tsx` | ja: Gate 1 (Überlauf), Gate 3 (Trefffläche, Abstand) |
| **2 · Erfassungsdialoge** (Bezirk anlegen/bearbeiten, Räumung, Stand melden, Stelle anlegen/bearbeiten, Belegung melden, Stornieren) | `betreuung/BetreuungDialoge.tsx` | nein (Vitest) |
| **3 · Modulzähler und Kennzahl-Hook** (Rahmen, künftige Dashboard-Zelle LFH-607) | `einsatz/useModulZaehler.ts`, `betreuung/useEvakuierungKennzahl.ts` | nein (Vitest) |

**Verdikte:** **erfüllt** (nur mit Beleg: Testdatei + Testname oder Messung + Commit) ·
**offen → Zielticket** · **nicht anwendbar** (mit Begründung). Gerechnetes und aus Quelltext
Geschlossenes trägt **[abgeleitet]**. Alle Zieltickets sind angelegt.

## Die Nachweise

Die Browser-Messungen (Gate 1, Gate 3) stammen von `e8b357d1`/`5f5375ae`. Die abschließende
Review-Runde (`256cbba0` Backend-ETB-Texte, `fc58fee2` Frontend) ändert an den gemessenen
Flächen nur Wortlaute (Kopf der Stellentabelle „keine Meldung", „≈" an der Plangröße) und
den Fehlerpfad der Rücknahme. Danach lief `./scripts/check-all.sh` auf `fabd40b0` mit Exit 0,
einschließlich der vollen e2e-Suite mit Gate 1 und Gate 3 (204 bestanden, 0 übersprungen)
und Vitest (420 Dateien, 5 380 Tests). Die Messwerte oben gelten damit auch für den
Code-Stand `fc58fee2`.

| Nachweis | Ergebnis | Stand |
| --- | --- | --- |
| Gate 3, `e2e/gate3-trefflaeche.spec.ts` „Betreuung: Karten- und Zeilenaktionen folgen der Dichte-Staffel 30 / 48 / 72 px", 1366 px, zwei gesäte Bezirke, drei Stellen (eine geschlossen) | „Stand melden" **30 / 48 / 72** px (2 Knoten) · Dreipunkt Bezirk **30 / 48 / 72** (2) · „Belegung melden" **30 / 48 / 72** (2) · Dreipunkt Stelle **30 / 48 / 72** (3) · Kopfaktion **30 / 48 / 72** (1) · „Betreuungsstelle anlegen" **30 / 48 / 72** (1) · Abstand Karte **15 / 23 / 33** px · Abstand Tabellenzeile **11 / 18 / 26** px. Die Knotenzahlen sind seit `5f5375ae` zusätzlich mit `toHaveCount` genau gepinnt (2 / 2 / 2 / 3) | `e8b357d1`, `5f5375ae` |
| Gate 3, erster Lauf (vor dem Fix) | **rot**: „Abstand Zeilenaktionen (handschuh, gemessen 7px)". Ursache: `Space wrap` ohne `size` führt auf `abstand.xs` (3 / 5 / 7 px). Fix `size="middle"` in `StellenBlock.tsx` | Fix `8fd7d96d` |
| Gate 3, Mutationsprobe „Stufe festgenagelt" | `stelleDichte` schreibt immer `'kompakt'`, `data-dichte`-Wache entfernt, `STAFFEL` nur `handschuh` → **rot** an der ersten Höhenmessung: „Stand melden (handschuh) #1 (gemessen 30px hoch, Soll ≥ 72)" (JSON-Reporter, `unexpected: 1`). Zurückgesetzt, `git diff --quiet` auf den Spec | `066a8707` |
| Gate 1, `e2e/gate1-ueberlauf.spec.ts` „Gate 1: keine tragende Route …", Bezirk und Stelle mit langen Namen, Abschnitt, Stand und Auslastungswort „fast voll" | `/betreuung` **0 px** auf 1366 / 1024 / 390 px; Anker ist die Bezirkskarte | `e8b357d1` |
| Grep über `betreuung/` (ohne Tests) und `pages/BetreuungPage.tsx` | Farbliterale **0** · `animation`/`blink`/`keyframes`/`transition` **0** · `sticky`/`fixed` **0** · `danger` **1** (`okButtonProps` des Storno-Dialogs) · `size=` **1** (`Space size="middle"`, Abstandsmaß, nicht interaktiv) · `zufluss` nur im Kommentar (beide Blöcke laufen mit der Vorgabe `sammelbanner`) | `e8b357d1`, auf `fc58fee2` wiederholt, unverändert [abgeleitet] |

---

## Tabelle 1 — Seite mit beiden Blöcken

| Nr. | Kriterium | Verdikt | Beleg / Begründung | Zielticket |
| --- | --- | --- | --- | --- |
| 1 | **Treffläche** ≥ 24 × 24 px; zeitkritische Aktion ≥ 48 px mit ≥ 8 px Abstand | **erfüllt** | Gate 3: alle sechs Zielarten 30 / 48 / 72 px. Zeitkritisch sind „Stand melden" und „Belegung melden": in `komfortabel` 48 px, Abstand zum Dreipunkt 23 px (Karte) bzw. 18 px (Zeile). Kein handgebautes Bedienziel, alle Ziele sind antd-`Button` | — |
| 2 | **Handschuh-Modus** — Ziel ≥ 72 px, Abstand ≥ 16 px | **erfüllt** | Gate 3 `handschuh`: 72 px an allen Zielen, Abstand 33 px (Karte, `ListenEintrag` trägt `marginSM` + Trennlinie + `marginSM`) und 26 px (Tabellenzeile); der Test erzwingt ≥ 16 an beiden. Vor `8fd7d96d` maß die Tabellenzeile 7 px (siehe Nachweise) | — |
| 3 | **Rückmeldung vor der Serverantwort** ≤ 100 ms | **erfüllt** | Der Dialog bleibt bis zur Serverantwort offen und hält bei Ablehnung Felder und Grund: `BetreuungDialoge.test.tsx` „eine Ablehnung (422) lässt die Felder stehen und zeigt den Grund im Dialog". **[abgeleitet]** aus dem Quelltext: die Dialogknöpfe laufen mit `loading` (`laeuft` an `ErfassungsModal`), die Blöcke zeigen beim Laden die Ladeanzeige der `Datensicht`. Kein optimistisches Update. Eine abgelehnte Rücknahme aus dem Rückgängig-Hinweis steht als Fehler über der Seite, eine spätere Ablehnung der anderen Rücknahme ersetzt ihn, eine erfolgreiche Meldung räumt ihn: `BetreuungPage.test.tsx` „eine spätere Ablehnung der anderen Rücknahme wird gezeigt, nicht vom alten Fehler verdeckt", „nach einer erfolgreichen Meldung ist der Fehler der Rücknahme weg" | — |
| 4 | **Kritische Aktion hat eine zweite Handlung** | **erfüllt** | Stornieren (unumkehrbar) über eigenen Dialog mit rotem Knopf: `BetreuungPage.test.tsx` „Stornieren über das Menü: eigener Dialog mit rotem Knopf, dann POST", `BetreuungDialoge.test.tsx` „ist ein Modal mit rotem Bestätigungsknopf; Abbrechen sendet nichts". Stand- und Belegungsmeldung sind umkehrbar, der Rückweg ist der Rückgängig-Hinweis (LFH-343): „„Rückgängig" nimmt die GERADE gemeldete Standmeldung zurück, nicht die aktuelle"; serverseitig `tests/betreuung.rs` `durchstich_bezirk_stand_fortschreibung_ruecknahme`, `stelle_belegung_kopfzahl_und_ruecknahme`. Das Schließen einer Stelle ist umkehrbar (Wiederöffnen, design.md D4) und bekommt deshalb keine Rückfrage | — |
| 5 | **Kontrast in beiden Modi** — Text Tag ≥ 7:1, Nacht ≥ 5:1; Zustände ≥ 3:1 | **offen** | Entlastend, aber nicht gemessen: keine Farbliterale (Grep), Etiketten über `StatusTag` (Rolle am Rand, `colorText` als Schrift, LFH-446). Einen Kontrast-Spec für die Route gibt es nicht; Muster wären `e2e/dokumente.spec.ts` „Kontrast …" und `e2e/betroffene-kontrast.spec.ts` | LFH-677 |
| 6 | **Kein Status allein über Farbe** | **erfüllt** | Räumungszustand und Stellenstatus tragen ein Pflicht-Label (`StatusDarstellung`), die Auslastung ein Wort („fast voll" / „voll" / „überbelegt"); unter 90 % gibt es weder Wort noch Farbe. Geschätzte Mengen tragen „≈" — in der Kennzahl auch dann, wenn noch kein Stand gemeldet ist (dann an der Plangröße) —, fehlende Meldungen das Wort „keine Meldung", auch im Kopf der Stellentabelle statt „0 untergebracht". `statusFarben.test.ts` „bildet die vier Räumungszustände ab …", „bildet die drei Stellenstatus ab …", „Grenzen bei Kapazität 100: 89 % nichts, 90 % fast voll, 100 % voll, 101 % überbelegt"; `BetreuungPage.test.tsx` „Block Evakuierung: Karte mit Status, „N · von M geplant", ≈ und „keine Meldung"", „Block Betreuungsstellen: Tabelle, „frei" nur mit Kapazität, Auslastungswort als zweiter Kanal", „Kopf Betreuungsstellen ohne jede Meldung: „keine Meldung", nicht „0 untergebracht""; `betreuungText.test.ts` „Kennzahltext ohne Meldung: eine geschätzte Plangröße bleibt gekennzeichnet (≈ an M)", „Kennzahltext „nur Plan geschätzt": der Vorgabeweg des Anlegen-Dialogs, noch ohne Stand" | — |
| 7 | **Eine Farbe = eine Bedeutung** | **erfüllt** | `achtung` nur für Handlungsbedarf (Räumung angeordnet/läuft, Stelle fast voll), `alarm` nur für erschöpfte Kapazität (voll/überbelegt), `bedien` wird nie vergeben: `statusFarben.test.ts` „vergibt in beiden Karten nie `bedien`". Die Art der Stelle ist eine Kategorie und bekommt keine Farbe (D8). Genau eine Primärgestalt im Kopf: „genau EINE Primäraktion im Kopf; „Betreuungsstelle anlegen" steht sekundär im Block". Rot nur im Storno-Dialog und am Storno-Eintrag hinter dem Menü-Trenner | — |
| 8 | **Helligkeits-/Kontrastregler** | **offen** | App-weite Lücke, wie in allen Prüflisten seit LFH-336 | LFH-397 |
| 9 | **Kritische Anzeigen im Blickfeld** | **erfüllt** (LFH-678) | **Trägt:** die Evakuierungskennzahl steht im Kopf des ersten Blocks, oben unter dem Seitenkopf (`EvakuierungBlock.tsx`, `Bereichskopf meta`); die Stand-Zeit steht auf jeder Karte. **Volle Stellen** (Auslastung „voll“/„überbelegt“, Rolle `alarm`) zählt `volleStellen` (`betreuung/betreuungText.ts`, abgeleitet aus `auslastung`, „fast voll“ zählt nicht). Die Zahl steht als „· n voll“ in der `meta` des **Seitenkopfs** („2 Bezirke · 5 Betreuungsstellen · 2 voll“) und im Blockkopf „Betreuungsstellen“, bei 0 steht nichts da. Der Seitenkopf ist die einzige Zeile, die auch bei vielen Bezirkskarten über der Falz bleibt [abgeleitet]. Die Tabelle darunter liegt ab etwa vier Bezirkskarten im Fükw (768 px hoch) weiterhin darunter. Die Vorgabesortierung bleibt bewusst die Anlagereihenfolge: Nach Auslastung sortiert, sprängen die Zeilen bei jeder Belegungsmeldung unter dem Cursor (Live-Regel der Bedien-Leitlinie). Kein Alarm, kein Toast (Non-Goal „Stelle voll“). Belege: `pages/BetreuungPage.test.tsx` „volle Stellen im Blickfeld: „n voll“ im Seitenkopf und im Blockkopf, „fast voll“ zählt nicht (LFH-678)“ und „ohne volle Stelle kein „0 voll“ — weder im Seitenkopf noch im Blockkopf (LFH-678)“; `betreuung/betreuungText.test.ts` „volle Stellen: „voll“ und „überbelegt“ zählen, „fast voll“ und Stellen ohne Einstufung nicht (LFH-678)“. Mutationsprobe: Mitzählen von „fast voll“ färbt diese drei und den Bestandstest „Kopf Betreuungsstellen: gemeldete Summe …“ rot. Code-Stand dieser Zeile: `d2a682c3` | — |
| 10 | **Alarmbudget** | **nicht anwendbar** | Das Modul erzeugt keine Alarme. Das Live-Ereignis `betreuung` invalidiert nur die Query (`api/queryKeys.ts`, `EINSATZ_STREAM_EVENTS.betreuung`), es gibt keinen Toast und keinen Ton für fremde Änderungen. Ein Alarm „Stelle voll" ist ausdrücklich Non-Goal (design.md). Die Erfolgs-Toasts erscheinen nur nach eigener Aktion | — |
| 11 | **Warnverhalten** — kein Blinken, jede Warnung quittierbar, jeder Ton mit visueller Entsprechung | **erfüllt** | Kein Blinken (Grep `animation`/`blink`/`keyframes`/`transition` 0), kein Ton. Die einzige warnende Anzeige ist die Auslastungs-Etikette in der Zeile; sie ist Zustand, keine Meldung, und braucht keine Quittung | — |
| 12 | **Kein Sprung unter dem Cursor** | **erfüllt** | Neue Bezirke und Stellen kommen über den Query-Refetch; beide Blöcke laufen mit der `Datensicht`-Vorgabe `zufluss="sammelbanner"` (kein `sofort`, Grep). Solange der Fokus in einer Sicht liegt, bleiben Zeilenmenge und Reihenfolge stehen und ein Banner erscheint: `Datensicht.test.tsx` „mit Fokus in der Sicht bleibt die Zeilenmenge stehen und ein Banner erscheint", „die Schleuse greift auch im Kartenzweig". Geänderte Zahlen an bestehenden Zeilen verschieben kein Layout; die Reihenfolge ist serverseitig die Anlagereihenfolge (`ORDER BY id`, `src/betreuung/repo.rs`), ein neuer Datensatz landet also unten. **Nicht gedeckt:** wer mit der Maus liest, ohne dass der Fokus in der Sicht liegt, bekommt Neuzugänge direkt eingeschoben — der Vertrag des Primitivs („verlässt der Fokus die Sicht, läuft der Zufluss ohne Banner durch"), gleich für jeden `Datensicht`-Konsumenten und hier nicht gemessen. Das Verdikt gilt für den Fokusfall, wie in `2026-09-22-lfh-632-pruefliste.md` | — |
| 13 | **Fokus nie verdeckt** | **offen** | Die Stellentabelle trägt die stehende Kopfzeile aus `KatalogTabelle` — genau das Konstrukt, auf das WCAG 2.4.11 zielt. Ein Tab-Durchlauf darunter ist nicht gemessen; der Grep „kein `sticky`" gilt nur für die Modulquellen, nicht für das Primitiv. Muster: `e2e/dokumente.spec.ts` „Fokus nie verdeckt: Tab-Durchlauf durch die Liste unter der stehenden Kopfzeile" | LFH-677 |
| 14 | **Tabellenseite vollständig** | **erfüllt** | Nur Block „Betreuungsstellen" ist Tabelle — dort wird verglichen („welche Stelle hat noch Platz?"); die Bezirke sind Karten, weil gelesen wird (D7). Tabelle über `Datensicht form="tabelle"` in jeder Breite: `datensicht.guard.test.ts` führt `StellenBlock` in `NUR_TABELLE` (keine Auflösung in Karten). Stehende Kopfzeile und fixierte Kennung aus `KatalogTabelle`; die Kennung ist die **Bezeichnung** (`immerSichtbar`), nie die DB-`id`. „Stand" (`abBreite: 'lg'`) und „Abschnitt" (`'xl'`) laufen durch den Spaltenschalter mit Zähler: `Datensicht.test.tsx` „abBreite streicht die Spalte und der Schalter meldet den Zähler als TEXT", „zählt Handauswahl UND abBreite in EINEM Zähler". Filter auf Art und Status | — |
| 15 | **Erfassungsmaske vollständig** | **nicht anwendbar** | Keine Erfassung auf der Fläche; die Masken sind Fläche 2 | — |

**Bilanz:** 10 erfüllt · 3 offen · 2 nicht anwendbar (Zeile 9 nachgezogen mit LFH-678).

### Zwei Entscheidungen aus dem Task-Review

**(a) Eine geschlossene Stelle zeigt ein Zeilenmenü mit zwei Einträgen** — Verdikt **erfüllt,
als begründete Abweichung**. Die wörtliche Regel aus LFH-366 („fällt die Menge nach der
Rechteprüfung unter drei, ist ein Menü keine Bündelung, sondern ein Umweg") hieße für die
geschlossene Stelle: „Bearbeiten" und „Stornieren" direkt in die Zeile. Das wird bewusst nicht
getan, aus zwei Gründen:

1. **Aufgelöst stünde ein roter „Stornieren"-Knopf in der Zeile.** Damit griffe die Regel „Rot
   steht nicht bündig neben Neutralem" (LFH-363) samt `aktionsabstand.guard.test.ts`, und die
   unumkehrbare Aktion läge einen Klick näher als an jeder offenen Stelle. Im Menü steht sie
   hinter dem Trenner (`menueEintraege`, `Datensicht.tsx`).
2. **Die Aktionsspalte behält ihre Form.** Der Zeilenzustand wechselt im Einsatz (schließen,
   wieder öffnen); gezählt wird nach der Rechteprüfung, nicht nach dem Zustand der Zeile —
   sonst wechselten Zahl und Art der Ziele in derselben Spalte mit jedem Statuswechsel.

Die Begründung steht im Dateikopf von `betreuung/StellenBlock.tsx`. Gate 3 pinnt den Fall:
drei Dreipunkt-Auslöser bei drei Stellen, davon eine geschlossen, und nur zwei „Belegung
melden".

**(b) Beim Schließen einer belegten Stelle zeigt der Dialog vier Steuerelemente** (Status,
Häkchen „Alle haben die Stelle verlassen — Belegung 0 melden", Kapazität, Art) gegen das
Modal-Budget ≈ 3 — Verdikt **erfüllt, als begründete Abweichung**. Im Regelfall zeigt
„Stelle bearbeiten" drei Felder. Das vierte Element erscheint nur, wenn der Status auf
„geschlossen" wechselt und die Stelle belegt ist, und es kann das Absenden blockieren (ohne
Häkchen lehnt die Formularprüfung ab). Nach der Festlegung aus LFH-343 · C8 (Befund H49)
gehört ein Element, das eine Ablehnung auslösen kann, nie hinter den Collapse. Die
Alternative, „Art" in diesem Fall einzuklappen, wurde verworfen: ein Feld, das je nach
Statuswahl zwischen sichtbar und eingeklappt springt, verschiebt die Maske unter der Hand.
Beleg: `BetreuungDialoge.test.tsx` „bietet die Leermeldung im selben Dialog an; ohne Häkchen
wird nicht gesendet", „eine unbelegte Stelle schließt ohne Leermeldung".

## Tabelle 2 — Erfassungsdialoge

Nur die Zeilen, die sich von Tabelle 1 unterscheiden. Nr. 5, 7, 8, 10 und 11 gelten wie dort.

| Nr. | Kriterium | Verdikt | Beleg / Begründung | Zielticket |
| --- | --- | --- | --- | --- |
| 1/2 | Trefffläche, Handschuh | **erfüllt [abgeleitet]** | Die Masken nutzen ausschließlich antd-Felder (`InputNumber`, `Radio` in Knopfform, `Select`, `Checkbox`, `DatePicker`) und `ErfassungsModal` und erben die Staffel vom `ConfigProvider`. Im Browser ist das nicht gemessen; es ist dieselbe Hülle, die Gate 3 an anderen Masken belegt | — |
| 3 | Rückmeldung | **erfüllt** | Knopf `loading`, Fehler bleiben **im** Dialog (`SpeicherFehler`), Felder bleiben stehen (`mutateAsync`): „eine Ablehnung (422) lässt die Felder stehen und zeigt den Grund im Dialog" | — |
| 4 | Zweite Handlung | **erfüllt** | Siehe Tabelle 1, Nr. 4. Die Leermeldung beim Schließen ist ein ausdrückliches Häkchen, keine stille Vorgabe; ein zweiter Versuch meldet die 0 nicht erneut: „scheitert das Schließen, meldet der zweite Versuch die 0 NICHT noch einmal" | — |
| 6 | Nicht nur Farbe | **erfüllt** | Die Status- und Räumungswahl zeigt die Labels als Knopftext; die Rolle trägt nur die Anzeige außerhalb des Dialogs | — |
| 9 | Blickfeld | **nicht anwendbar** | Dialog ohne kritische Anzeige | — |
| 12 | Kein Sprung | **nicht anwendbar** | Dialog ohne Live-Inhalt | — |
| 13 | Fokus nie verdeckt | **offen** | Nicht gemessen; im Handschuh-Betrieb bei 390 px kann ein Dialog höher als der Schirm sein. Muster: `e2e/dokumente.spec.ts` „Fokus nie verdeckt im Ablegen-Dialog …" | LFH-677 |
| 14 | Tabellenseite | **nicht anwendbar** | Maske, keine Menge | — |
| 15 | **Erfassungsmaske vollständig** | **erfüllt** | **Feldbudget** ≤ 3 sichtbar, Rest eingeklappt, samt „Aufklappen → Zahl steigt": „zwei Felder sichtbar, Zeitpunkt eingeklappt; Knopf im <form>; sendet die Anzahl", „ein Feld sichtbar, Zeitpunkt eingeklappt; sendet die Belegung", „Bezeichnung, Plangröße, Erhebung sichtbar; Abschnitt, Sammelstelle, Notiz eingeklappt", „Bezeichnung, Art, Kapazität sichtbar; der Rest eingeklappt; ohne Kapazität kein Schlüssel" (Ausnahme beim Schließen siehe (b)). **Vorgaben sichtbar und überschreibbar:** Erhebung (`geschaetzt` bei der Plangröße, `gezaehlt` beim Stand) und Art (`betreuungsstelle`) als sichtbare Wahl; leere Felder sagen, was sie bedeuten („Leer: jetzt …", „Leer: keine Kapazität …"). **Enter-Struktur** (Knopf im `<form>`, kein antd-Fuß) in denselben Tests. **Labels über dem Feld** (`ErfassungsModal`). **Kein Serienmodus**, begründet: Bezirke und Stellen werden einmal eingerichtet, Meldungen gelten je Bezirk bzw. Stelle und werden aus deren Zeile geöffnet — es gibt keinen Minutentakt gleichartiger Datensätze. Die Sammelliste mit Ändern/Entfernen je Zeile ist die Seite selbst (Tabelle 1) | — |

## Tabelle 3 — Modulzähler und Kennzahl-Hook

| Nr. | Kriterium | Verdikt | Beleg / Begründung | Zielticket |
| --- | --- | --- | --- | --- |
| 6 | Nicht nur Farbe | **erfüllt** | Der Modulzähler ist eine Zahl ohne Statusfarbe (Zahl der aktiven Bezirke): `useModulZaehler.test.ts` „zählt die aktiven Evakuierungsbezirke — ohne aufgehobene und stornierte (LFH-639)" | — |
| 10 | Alarmbudget | **nicht anwendbar** | Zähler und Hook erzeugen keine Meldung | — |
| — | Sichtbarkeit | **erfüllt** | Ohne sichtbares Modul keine Anfrage, am Draht gezählt (MSW): `useModulZaehler.abruf.test.tsx` „Modul ausgeblendet → keine Anfrage an …/betreuung, kein Zähler", „Modul sichtbar → genau eine Anfrage, Zähler der aktiven Bezirke" — Mutationsprobe `enabled: betreuungAktiv` entfernt → der erste Test wird rot („expected 1 to be +0"). Die reine Entscheidung dazu: `useModulZaehler.test.ts` „lädt den Betreuungszähler nur bei sichtbarem Modul (LFH-639)"; `useEvakuierungKennzahl.test.tsx` „lädt NICHT bei ausgeblendetem Modul — kein Abruf, Zustand `aus` (weder fehler noch null)", „lädt NICHT bei rollen-gesperrtem Modul". Live-Ereignis `betreuung` nur an Modul-Leser: `tests/betreuung.rs` `live_ereignis_nur_an_leser_mit_modulrecht` | — |
| — | Fehler ist nicht leer | **erfüllt** | „Abruffehler → Zustand `fehler`, nie `kennzahl: null`"; „kein Bezirk → Zustand `daten` mit `kennzahl: null` (keine geplante Evakuierung)" | — |

## Offene Punkte

| Zeile | Befund | Zielticket |
| --- | --- | --- |
| T1-5, T1-13, T2-13 | Kontrast und Fokus-Verdeckung im Browser nicht gemessen | LFH-677 |
| T1-8 | kein Helligkeitsregler in der Anwendung | LFH-397, app-weit |
| ~~T1-9~~ | ~~volle und überbelegte Stellen nur in der Tabellenzeile, Tabelle ggf. unter der Falz~~ — erledigt: „· n voll“ im Seitenkopf und im Blockkopf | LFH-678 |

### Nachzüge (Aufgabe 5.3)

| Ticket | Inhalt |
| --- | --- |
| LFH-673 | Lagekarte für Betreuung: Stellen als Marker, Bezirk als Fläche |
| LFH-674 | Verbleib einer Person → Betreuungsstelle (FK `person_verbleib.betreuungsstelle_id`) |
| LFH-675 | Offline-Erfassung von Stand und Belegung |
| LFH-676 | Verlaufsansicht der Meldereihen |
| LFH-677 | Browser-Nachweis Kontrast und Fokus-Verdeckung (Zeilen T1-5, T1-13, T2-13) |
| LFH-678 | volle und überbelegte Stellen im Blickfeld (Zeile T1-9) |
| LFH-679 | Kopfzahl „ohne Meldung" |
| LFH-680 | Eingaberänder |
| LFH-681 | Dialoge gegen aktuelle Daten |
| LFH-682 | Testlücken |
| LFH-683 | `MenueAusloeser` |
| LFH-684 | AGENTS.md |
