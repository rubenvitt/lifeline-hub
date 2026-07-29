# Prüfliste Einsatztauglichkeit — Einsatzlisten (LFH-330 · B2)

Gate 7 der Bedien-Leitlinie (`2026-07-25-bedien-leitlinie-einsatzkontexte.md`, Festlegung 7)
verlangt diese Liste an **jeder** umgebauten Seite. B2 hat zwei Mengen angefasst, und beide
stünden ohne diese Datei ohne Prüfliste da: `2026-07-28-katalogtabellen-pruefliste.md:9-12`
zählt exakt dreizehn Dateien auf, die fünfzehn hier sind andere.

**Warum eine Liste für zwei Gruppen und nicht fünfzehn Listen.** Die Gruppen teilen sich
nicht bloß die Optik, sondern die **Zusicherung**: alles, was unten bewertet wird, hängt an
genau einem der beiden Primitive — `components/Datensicht.tsx` (Formachse, Spaltenschalter,
Zeilenschleuse) bzw. `components/KatalogTabelle.tsx` (Bildlaufcontainer, stehende Kopfzeile,
fixierte Kennung). Eine Prüfliste je Datei bewertete fünfzehnmal dieselbe Entscheidung und
übersähe genau die Stellen, an denen eine einzelne Seite ausschert. Wo eine Seite ausschert,
steht sie unten **namentlich in der Zeile**.

## Umfang

**Gruppe A — die `Datensicht`-Konsumenten: 9 Dateien, 10 Sichten.** Sie tragen die volle
Fünfzehnerliste.

`auftraege/BefehlListe.tsx` · `pages/FahrzeugePage.tsx` · `pages/KraefteuebersichtPage.tsx` ·
`pages/LageberichtePage.tsx` · `pages/MaterialPage.tsx` · `pages/PersonalPage.tsx` ·
`pages/PersonenPage.tsx` (zwei Sichten) · `pages/TierePage.tsx` ·
`pages/uhs/BewegungenTab.tsx`. Dieselbe Menge steht als `KONSUMENTEN` in
`frontend/src/components/datensicht.guard.test.ts` und wird dort gegen den abgeleiteten Scan
gestellt — überall, wo unten „die neun Dateien" steht, ist genau diese Menge gemessen.

**Gruppe B — nur Überlaufschutz: 6 Dateien.** Sie haben eine rohe antd-Tabelle gegen
`KatalogTabelle` getauscht und sonst nichts. Ihre Verdikte werden **nicht neu hergeleitet**;
sie erben die der Katalogtabellen-Familie durch Konstruktion. Der eigene Abschnitt unten nennt
die Abweichungen.

**Ausnahme, deklariert und mit Totmeldung:** `pages/gefahren/GefahrenMatrix.tsx` bleibt eine
rohe antd-Tabelle. Sie codiert eine **Fläche** (Gefahrentyp × Schutzobjekt), sie vergleicht
keine Datensätze — ein Bildlaufcontainer und eine fixierte Kennungsspalte hätten dort keinen
Gegenstand. Der Eintrag steht als begründete Ausnahme in der Liste `AUSNAHMEN` von
`frontend/src/components/katalogTabelle.guard.test.ts`; wer die Datei doch migriert, wird vom
Guard zur Streichung des Eintrags gezwungen — der Selbstbeweis „tote Ausnahmeeinträge werden
gemeldet" ist dort ausgeschrieben. (Fundstellen als Listennamen statt Zeilennummern: die Datei
wird von einem Nachbarbündel mitgeführt, eine Zeilennummer veraltete beim nächsten Zuwachs.)

**Was B2 geändert hat:** das `Datensicht`-Primitiv mit einer Spaltendefinition für zwei
Darstellungsformen, Sortierung/Suche/Spaltenfilter/Gruppen zentral statt je Seite, der
Spaltenschalter mit Zähler ausgeblendeter Spalten, die Zeilenschleuse gegen Sprünge unter dem
Cursor, und der Umzug von neunzehn Tabellen auf die zwei Primitive. Alles Übrige ist Bestand
und wird hier **bewertet, nicht angefasst**.

Die Liste ist **absichtlich nicht durchgehend grün.** Verdikte: erfüllt / teilweise erfüllt /
offen → Zielticket / nicht anwendbar. „Nicht geprüft" ist kein Verdikt und kommt nicht vor.

## Die fünfzehn Zeilen

| #   | Verdikt               | Beleg / Zielticket                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| --- | --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| 1   | **teilweise erfüllt** | Der **24-px-Boden ist erfüllt und gemessen**: 30 px auf der Vorgabestufe, gepinnt in `frontend/e2e/datensicht-schmal.spec.ts:304-317` — als eigene Zusicherung geschrieben, weil sie eine andere Aussage ist als die Staffel. Die **48 px kommen nicht von selbst**: `theme/tokens.ts:118-138` staffelt `controlHeight` auf 30/48/72, `ThemeModeProvider` startet auf `kompakt`, und auf dieser Stufe sind 48 px gar nicht darstellbar. Deshalb prüft der Spec die tragfähige Aussage — die Berührungsziele folgen der **gewählten Stufe** über alle drei Stufen (`:86-90`, `:238`), was strenger ist als „≥ 48": ein hartkodiertes `height: 48` bestünde die 48er-Zusicherung und fiele hier durch. Die Dichte hängt an der Benutzerwahl, nicht an der Breite — derselbe offene Punkt, den `2026-07-28-rahmen-pruefliste.md:36` schon führt → **B5 (LFH-333)**. **Messstellen-Abweichung, benannt statt verschwiegen** (`datensicht-schmal.spec.ts:44-57`): Aktionsknopf und Spaltenschalter wurden auf `/personal` gemessen, der Titel-Link auf `/tiere` — der Kartenplan der Personalseite setzt `titel` **ohne** `ziel` (`PersonalPage.tsx:375`, mit Begründung: der Link zeigte auf sich selbst), dort rendert das Primitiv `Typography.Text` statt eines Ankers. Wer Z1 liest, soll nicht glauben, alle drei seien auf einer Fläche gemessen. Punktuelle Klein-Angaben in den neun Dateien: gemessen **1** — `MaterialPage.tsx:43` an einem Mengen-Eingabefeld, Bestand (steht byte-gleich auf `main:41`), und B2 hat in derselben Datei zwei andere entfernt (3 → 1). Neue kommen nicht dazu: das Primitiv verbietet die Form für sich selbst (`datensicht.guard.test.ts`, `VERBOTEN_IM_PRIMITIV`) |
| 2   | **teilweise erfüllt** | Die 72-px-Stufe **existiert und kommt an den Berührungszielen an**: `tokens.ts:132-137` trägt sie, und `datensicht-schmal.spec.ts:238` misst sie als dritte Stufe derselben Staffel an allen drei Zielen, subpixel-tolerant. Der **Abstand ≥ 16 px folgt ihr nicht**: `tokens.ts:142` exportiert `abstand` fest aus der **kompakten** Stufe (3/7/11/18), während die Handschuh-Werte (7/16/26/44) danebenstehen und die Seiten nie erreichen — gemessen beziehen zwei Gruppe-A-Dateien diesen Export (`FahrzeugePage`, `KraefteuebersichtPage`, je drei Stellen), die übrigen sieben gar keinen. Wortgleiche Hälfte wie `2026-07-28-rahmen-pruefliste.md:36` → **B5 (LFH-333)**                                                                                                                                                                                                                                                                                                                                                                                             |
| 3   | **teilweise erfüllt** | Der Ladezustand ist sofort sichtbar: **9 von 10 Sichten** reichen `ladend` durch (gemessen), antd zeigt den Spinner vor der Serverantwort. **Die eine Ausnahme namentlich: das Meldebild.** `KraefteuebersichtPage` setzt kein `ladend`; die Seite hat nur einen Rahmen-Ladezustand (`:214`, `einsatzQuery.isLoading` → `SeitenSkeleton`), während die fünf Listenabfragen dahinter — Einheiten, Personal, Fahrzeuge, Material, Abschnitte (`:160-164`) — keinen eigenen tragen. Das Meldebild steht also vollständig, bevor sie da sind, und füllt sich stumm nach. Optimistische Updates gibt es in keiner der neun Dateien (Baseline 0, wie in beiden Vorgängerlisten) → **B6 (LFH-334)**                                                                                                                                                                                                                                                                                                                                                                                |
| 4   | **erfüllt**           | Genau **drei** der neun Dateien tragen eine entfernende Aktion, und alle drei fragen in **beiden** Zweigen zurück: Tabellenzweig über `Popconfirm title="Aus Einsatz entfernen?"` (`PersonalPage.tsx:298`, `FahrzeugePage.tsx:372`, `MaterialPage.tsx:210`), Kartenzweig über `bestaetigung: 'Aus Einsatz entfernen?'` am Kartenplan (`:387`, `:482`, `:286`), gepinnt von `Datensicht.test.tsx:750` („genau eine Primäraktion, mit Rückfrage bei gesetzter bestaetigung"). Die **sechs übrigen tragen gemessen keine** der vier Aktionen aus dem Kriterium — kein Löschen, kein Storno, kein Abschluss, keine Alarmierung: `BefehlListe`, `LageberichtePage`, `PersonenPage` und `TierePage` haben ausschließlich Anlege-Mutationen, `KraefteuebersichtPage` zusätzlich „In Lagebericht übernehmen" (additiv, `:186`), `uhs/BewegungenTab.tsx` hat **gar keine** Mutation. Die Abwesenheit ist gemessen, nicht vermutet — dieselbe Form wie die Katalogtabellen-Zeile 4 („12 von 13; `StichworteTab` hat als einzige keine löschende Aktion")                                |
| 5   | **teilweise erfüllt** | Die A0-Palette gilt unverändert (13,47 : 1 dunkel / 18,17 : 1 hell); in den fünfzehn Dateien stehen gemessen **0** eigene Farbwerte (Hex-Scan über Gruppe A und B), Farbe kommt ausschließlich über `rollenFarbe()`/`StatusTag` aus `theme/statusFarben.ts`, repoweit abgesichert von `theme/gate5.guard.test.ts`. **Eine benannte Achse bleibt draußen, und sie trifft zwei Sichten dieser Gruppe:** Fahrzeug- und Personalstatus beziehen ihre Farbe aus der **Datenbank** (`status_farbe`), und das Backend trimmt sie nur — keine Wertevalidierung, kein Enum, kein Format-Check (`statusFarben.ts:28-41`, gleichlautend `2026-07-27-token-fundament-statusfarb-vertrag.md:165-178`). Ein Mandant kann dort eine Farbe pflegen, die die A0-Kontrastziele verfehlt; gemessen hat das niemand, weil der Wert erst zur Laufzeit entsteht. → **Folge-Task, in A2 als Befund 1 erfasst** (`…-statusfarb-vertrag.md:374-378`, noch ohne Nummer)                                                                                                                              |
| 6   | **erfüllt**           | Der zweite Kanal ist **am Typ erzwungen, nicht per Konvention**: `StatusDarstellung.label` ist Pflichtfeld (`theme/statusFarben.ts:73-78`, Kommentar „Der Text IST der zweite Kanal"), und der Statusslot des Kartenplans nimmt genau diesen Vertragstyp — **nicht** das `render` der Statusspalte (`Datensicht.tsx:230-237`). Gepinnt von `Datensicht.test.tsx:779` („der Statusslot rendert ein Etikett MIT Text, nicht nur eine Farbe"). Die farbigen Kennzahlen der Kräfteübersicht tragen ihren Text als `title` — „Fzg frei", „Fzg gebunden", „Fzg n. einsatzbereit" (`KraefteuebersichtPage.tsx:266/271/276`), Farbe und Wort stehen nebeneinander. Dieselbe Lesart wie in den beiden B1-Listen: der hervorgehobene Zustand eines Bedienelements ist keine **Status**farbe im Sinn des Kriteriums                                                                                                                                                                                                                                                                        |
| 7   | **teilweise erfüllt** | Die Doppelbelegung im Bestand ist **aufgelöst, nicht behauptet**: `statusKategorie` (`statusFarben.ts:80-90`) vereint fünf getrennt gepflegte Maps, und die gemessene Divergenz — `gebunden` war in `KraefteuebersichtPage` `gold`, in vier anderen Dateien `orange` — steht heute als **eine** Zeile. Gesättigte Farbe trägt nur den abnormen Zustand, der Grund ist weder `#000000` noch `#ffffff` (A0, unverändert). Offen bleibt **dieselbe DB-Achse wie in Zeile 5**: eine mandantengepflegte `status_farbe` kann nicht nur den Kontrast verfehlen, sondern auch eine Rollenbedeutung **doppelt belegen** — genau die Aussage, die dieses Kriterium prüft. → **derselbe Folge-Task wie Zeile 5**                                                                                                                                                                                                                                                                                                                                                                      |
| 8   | **offen**             | Es gibt in der Anwendung keinen Helligkeits-/Kontrastregler. Diese Gruppe ist nicht der Ort, an dem er entstünde (das ist der Rahmen mit der Farbschema-Achse), sie ist aber sein Nutznießer. A0 verweist ihn ausdrücklich weiter → **eigener Folge-Task** („Was diese Leitlinie nicht entscheidet"). Dritte Liste in Folge mit demselben Verdikt                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| 9   | **teilweise erfüllt** | Acht der zehn Sichten sind Dispositions- und Erfassungslisten; ihre kritische Angabe ist der Status **in der Zeile** und wandert mit ihr — es gibt keine ortsfeste Anzeige, die an den Layoutrand rutschen könnte. **Die Kräfteübersicht ist die Ausnahme und fällt durch:** ihr Kennzahlenkopf steht zwar oben, läuft aber in einem eigenen waagerechten Bildlauf (`KraefteuebersichtPage.tsx:248-249`, `styles={{ body: { overflowX: 'auto' } }}` mit dem Kommentar „nicht umbrechend, bei schmalem Viewport horizontal scrollbar") — bei 390 px liegt „Fzg n. einsatzbereit" damit **außerhalb des Schirms**, also außerhalb des Blickfelds, das dieses Kriterium meint. Das widerspricht zugleich der an der Lage-Dashboard-Kennzahlenleiste validierten Umbruch-Entscheidung aus B1. Bestand vor diesem Bündel, fremde Datei → **B5 (LFH-333)**. **Bewusst abweichend vom Plan:** `lfh330-plan-V-gates.md` §5 Punkt 5 (Stand fc48f60: :452) schickt diese Stelle in ein „eigenes Ticket", gebündelt mit der festen Suchfeldbreite derselben Datei. Sie wird hier stattdessen zu B5 zusammengezogen, weil B5 die Umbruch-Entscheidung für Kopfaktions-Leisten ohnehin führt (`gate1-ueberlauf.spec.ts:144-146` schickt die drei freigestellten Routen mit **derselben** Ursache — `Space` ohne `wrap` im Seitenkopf — genau dorthin). Zwei Tickets für einen Griff an derselben Zeile wären zwei halbe Reparaturen. Die feste Suchfeldbreite bleibt davon unberührt beim eigenen Ticket, sie ist eine Feldbreiten- und keine Umbruchfrage                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| 10  | **nicht anwendbar**   | Die fünfzehn Flächen erzeugen keine Alarme — sie zeigen und pflegen Datensätze. Gemessen **0** `notification` in Gruppe A, Gruppe B und den beiden Primitiven. Welches Ereignis welche Priorität und welche Eskalationsstufe trägt, entscheidet **B6 (LFH-334)** am Ereignis-Inventar, so wie A1 es vorsieht und `2026-07-28-rahmen-pruefliste.md:44` es bereits notiert                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| 11  | **erfüllt**           | Gemessen **0** Treffer für `animation`, `keyframes`, `blink` und `Audio` in den fünfzehn Dateien **und** in `components/Datensicht.tsx`/`components/Liste.tsx` — also kein Blinken auf lesbarem Text, keine Blinkrate zu begrenzen, keine tonlose Warnung, für die eine visuelle Entsprechung fehlen könnte. Fehler- und Hinweiszustände erscheinen als Text (`Alert`, `message`). Wie in beiden Vorgängerlisten gilt die Messung für den eigenen Quelltext, nicht für antds Stilblatt; das einzige Bewegungselement auf diesen Flächen ist der Ladespinner, und der ist kein Warnsignal                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| 12  | **teilweise erfüllt** | Die **Struktur ist zugesichert**, und zwar breit: die Zeilenschleuse friert bei Fokus in der Sicht Zeilenmenge (`Datensicht.test.tsx:1123`), Reihenfolge (`:1170`) **und Gruppenzugehörigkeit** (`:1313`, „die Karte wandert nicht unter einen anderen Kopf") ein, während Zellinhalte weiterlaufen (`:1147`) — ein Statuswechsel muss sofort sichtbar sein, nur die Zeile darf nicht wandern. Ein Fokuswechsel innerhalb der Sicht taut nicht auf (`:1194`), außerhalb läuft der Zufluss ohne Banner durch (`:1228`), eine entfallene Zeile verschwindet sofort (`:1260`), und die Schleuse greift auch im Kartenzweig (`:1295`). Das Sammelbanner steht in einer Werkzeugzeile, die **immer** gerendert wird, auch leer (`:1060`) — eine Leiste, die erst beim Eintreffen erscheint, verschöbe Inhalt und arbeitete gegen ihr eigenes Ziel. **Der Zahlenwert CLS ≤ 0,1 ist NICHT gemessen** → **B6 (LFH-334)**: ein `layout-shift`-Observer ist im Repo nirgends gebaut, und `gate1-ueberlauf.spec.ts` misst Breite, nicht Verschiebung — dieselbe Auslassung, die `2026-07-28-rahmen-pruefliste.md:46` schon protokolliert. **Zweiter offener Punkt, namentlich: das Meldebild fährt `zufluss="sofort"`** (`KraefteuebersichtPage.tsx:381`) und läuft damit ohne Schleuse. Der **tragende** Grund hält (`:362-367`): die Schleuse führt nur die Wurzel-Schlüsselfolge, eine neue Disposition landet aber tief im Baum, der erhoffte Schutz träte gar nicht ein und ein Banner erschiene für einen Zufluss, der oben nie ankommt. Der **zweite** Grund im selben Kommentar — „Diese Fläche trägt zudem keine Bedienelemente in der Zeile" — ist **gemessen falsch**: antds Aufklapp-Auslöser ist ein echtes `<button type="button">` mit `aria-expanded` (antd 6.5.2, `es/table/ExpandIcon.js:15-27`), er sitzt in der fixierten ersten Spalte, und `meldebild-tabelle.spec.ts:197` klickt ihn. Die Fläche trägt also sehr wohl ein Fokusziel in der Zeile → **B6 (LFH-334)** entscheidet, ob die Schleuse baumfähig wird oder der Satz fällt |
| 13  | **erfüllt**           | **für die TABELLEN-Hälfte** — und wer Z13 abhakt, muss sagen, welche Hälfte er meint. Nachweis `frontend/e2e/fokus-verdeckung.spec.ts`: ein Tabulaturdurchlauf hinter stehender Kopfzeile und fixierter erster Spalte, einmal an der Katalogtabelle (`:187`) und einmal am `Datensicht`-Tabellenzweig hinter zusätzlicher Werkzeugzeile (`:282`), gemessen gegen **jeden** Knoten mit `position: sticky` bzw. `fixed` statt gegen eine Selektorliste, die still veraltet. Zwei Bedingungen zusammen (Rechteck-Enthaltensein **und** `elementFromPoint`), weil jede einzeln falsch urteilt; Vorbedingungs-Zähler stellen sicher, dass der Durchlauf überhaupt in der Tabelle landet und fixierte Knoten vorfindet — sonst wäre „0 verdeckte Ziele" trivial wahr. Ein **Positivnachweis** (`:156`) belegt, dass der Messkern eine erfundene Verdeckung meldet; bei einem Neubau ohne Vorbild im Repo ist Grün ohne Gegenprobe kein Ergebnis. **Die DRAWER-Hälfte** — Tabulaturdurchlauf bei offenem Navigations-Drawer — bleibt **B7 (LFH-335)**, so von `2026-07-28-rahmen-pruefliste.md:47/90` ausdrücklich getrennt                                                                                                                                                                                                                                                                                                                                                                            |
| 14  | **teilweise erfüllt** | **Tabellenzweig: alle vier Anforderungen erfüllt.** Fixierte Kopfzeile ✓ und fixierte **menschenlesbare** Kennung ✓ — beide zentral aus `KatalogTabelle` (DEV-Warnung, wenn die DB-`id` in Spalte 0 steht), `Datensicht.test.tsx:809` pinnt die Durchreiche. Keine Auflösung in Karten, **wo verglichen wird** ✓: das Meldebild trägt `form="tabelle"` und bleibt bei 390 px Tabelle (`meldebild-tabelle.spec.ts` Schritt (a): genau ein `.ant-table`, null Karten), der Guard erzwingt das Literal über `NUR_TABELLE`. **Spaltenschalter mit Zähler ausgeblendeter Spalten ✓** — und der Zähler kennt **eine** Wahrheit: Handauswahl und breitenabhängige Spalten (`abBreite`) fließen durch dieselbe Funktion (`Datensicht.test.tsx:425` „zählt Handauswahl UND abBreite in EINEM Zähler", `:441` „eine per Hand UND per Breite verborgene Spalte wird nur EINMAL gezählt"), antds eigenes `responsive` ist am Spaltentyp gesperrt und beim Konsumenten verboten. Ein Zähler, der lügen kann, verfehlte genau das Kriterium, für das er existiert. **Der Tastaturweg war gemessen kaputt und ist behoben** (Commit `799dcb4`): am Stand `82c2885` bekam das Dropdown beim Öffnen keinen Fokus, die Eingabetaste schloss das Menü ohne zu schalten, der Zähler stand vorher wie nachher — heute gepinnt von `datensicht-schmal.spec.ts:343`. **Ausdrücklich nur die Eingabetaste ist zugesichert, die Leertaste nicht** (`:339-341`): rc-menu bindet auf dem hervorgehobenen Eintrag nur `Enter`, mit der Leertaste blieb der Zähler gemessen stehen. Ein Tastaturweg ist verlangt, nicht jeder denkbare. **Was fehlt, ist der Kartenzweig unter `md`** — er löst eine Tabelle in Karten auf, was dieses Kriterium für Vergleichsflächen verbietet. Das ist die begründete Ausnahme; sie steht unten in einem eigenen Abschnitt und nicht in einer Fußnote → offener Rest **B5 (LFH-333)** für die Kontextzuweisung |
| 15  | **teilweise erfüllt** | Labels stehen über dem Feld ✓ (gemessen 6× `layout="vertical"`, je einmal in den sechs Gruppe-A-Dateien mit eigenem Erfassungsmodal; `PersonenPage` legt ihre Maske in `personen/PersonErfassungModal.tsx` aus — außerhalb dieses Umfangs, aber ebenfalls `layout="vertical"`; `KraefteuebersichtPage` und `uhs/BewegungenTab` haben gar keine Erfassungsmaske), volle Tastaturbedienung über antds `Form` ✓, und die **Sammelliste mit Aktion je Zeile** liefert das Primitiv selbst ✓ — genau eine Primäraktion je Karte, `Popconfirm` je Tabellenzeile, zeilenweise ausblendbar über `sichtbar()` (`Datensicht.test.tsx:768`). **Defaults nur teilweise vorbelegt:** 4 von 6 tragen `initialValues` (`BefehlListe` `vorlage`, `LageberichtePage` `vorlage`, `MaterialPage` `menge: 1`, `TierePage` `spezies`), `FahrzeugePage` und `PersonalPage` keine. **„Speichern und nächsten anlegen" mit gehaltenem Kontext fehlt vollständig** — gemessen **0** Treffer im ganzen Frontend, nicht nur in dieser Gruppe. Beides → **B5 (LFH-333)**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |

## Gruppe B — die sechs Überlaufschutz-Dateien

`pages/bereitstellungsraum/BereitstellungsraeumePage.tsx` · `pages/MitgliederAbschnitt.tsx` ·
`pages/PersonenDetailPage.tsx` · `pages/SchaedenPage.tsx` · `pages/uhs/MaterialTab.tsx` ·
`pages/UnfallhilfsstellenPage.tsx`

Diese sechs haben **genau eine** Änderung erfahren: rohe antd-Tabelle → `KatalogTabelle`. Sie
bekommen damit dieselben drei Merkmale wie die dreizehn Katalogtabellen — waagerechten
Bildlaufcontainer, stehende Kopfzeile, fixierte menschenlesbare Kennung — aus derselben Quelle.
Dass die Erbschaft wirklich verdrahtet ist und nicht bloß behauptet: alle sechs stehen
namentlich in `UEBERLAUF_NACHZUG` und laufen über `KATALOGTABELLEN` in dieselbe Inventarprüfung
wie die dreizehn (`katalogTabelle.guard.test.ts`, Länge auf 19 gepinnt).

Ihre Verdikte sind deshalb **die der Katalogtabellen-Familie**
(`2026-07-28-katalogtabellen-pruefliste.md`) und werden hier nicht zweitgezählt; das Gate zählt
fünfzehn Zeilen, und eine zweite Fünfzehnertabelle zählte doppelt.

Was von den geerbten Verdikten abweicht, und nur das:

- **Z1/Z2** — zwei der sechs tragen punktuelle Klein-Angaben, Bestand und von B2 unverändert
  (gemessen byte-gleich zu `main`): `MitgliederAbschnitt.tsx:85/127` und
  `uhs/MaterialTab.tsx:75/95`, je einmal an einem Aktionsknopf und einmal am Tabellenelement.
  Damit liegen dort Aktionslinks unter der Dichte-Staffel → **B5 (LFH-333)**, dieselbe
  Burn-down-Liste wie die 26 der Katalogtabellen.
- **Z13** — für diese sechs eingelöst durch dieselbe Messung wie oben: das Konstrukt, hinter dem
  der Fokus verschwinden könnte, ist die stehende Kopfzeile und die fixierte Spalte aus
  `KatalogTabelle`, und genau die misst `fokus-verdeckung.spec.ts:187`. Es ist eine Aussage über
  das Primitiv, nicht über die Aufrufstelle.
- **Z14** — wie die dreizehn: Spaltenschalter **nicht anwendbar**, die Tabellen tragen höchstens
  sieben Spalten und zeigen sie alle. Der Schalter mit Zähler existiert seit B2, er wird hier nur
  nicht gebraucht.

Alle übrigen Zeilen stehen unverändert wie in der Katalogtabellen-Liste.

## Die Karten-Ausnahme (E7) — der Regelbruch, ausgeschrieben

CLAUDE.md und A1/Festlegung 2 sagen: „Auf schmalem Schirm wird eine Tabelle **angepasst, nicht
in Karten aufgelöst** — Karten-Fallback ist die Ausnahme mit Begründung im Task." `form: 'auto'`
löst unterhalb `md` (768 px) genau das auf. Eine Prüfliste, die den Regelbruch nicht nennt,
verschweigt ihn — deshalb steht er hier und nicht in einer Fußnote. Die schriftliche Begründung
lebt im Dateikopf von `frontend/src/components/Datensicht.tsx:30-55` und ist dort von
`datensicht.guard.test.ts` über die Anwesenheitsmarken `KARTEN-AUSNAHME`/`TRENNLINIE`
festgenagelt.

**Träger der Ausnahme** ist der Kontext **mobil** aus A1: ~390 px, einhändig, komfortabel,
**keine Vergleichsansichten**. Dort ist ein Datensatz, der als Einheit erfasst und gelesen wird
— ein Fahrzeug, eine Person, eine Bewegung —, keine Vergleichsaufgabe, und Festlegung 2 sagt für
diesen Fall „Liste/Karte, wenn gelesen wird".

**Die Trennlinie, damit die Ausnahme nicht wandert** — vier Fälle, maschinell auseinandergehalten:

| Form              | Wofür                                                     | Erzwungen durch                                       |
| ----------------- | --------------------------------------------------------- | ----------------------------------------------------- |
| `KatalogTabelle`  | Stammdaten-Vergleichstabellen — keine der 13 wird zu Karten | `katalogTabelle.guard.test.ts` (19 Einträge)          |
| `form="tabelle"`  | Vergleichsflächen, die auch schmal verglichen werden        | `NUR_TABELLE` + Literalprüfung, `meldebild-tabelle.spec.ts` |
| `form="auto"`     | Einsatzmodule, in denen ein Datensatz eine Einheit ist       | die Ausnahme selbst; Weiche gepinnt in `Datensicht.test.tsx:652-688` |
| `form="karte"`    | Module, die heute schon kartenbasiert gelesen werden         | `NUR_KARTE` + Literalprüfung                          |

Das Meldebild der Kräfteübersicht ist der Beweis, dass die Ausnahme **nicht** die Regel gefressen
hat: A1/Festlegung 2 führt es namentlich als „wird verglichen: ja", es trägt `form="tabelle"`,
und `meldebild-tabelle.spec.ts` misst bei 390 px genau ein `.ant-table` und **null** Karten. Was
die Karte nicht kann, ist an der Aufrufstelle sichtbar statt still: `aufklappzeile` läuft nur im
Tabellenzweig (`Datensicht.test.tsx:998`), und eine Spalte ohne Platz im Kartenplan erscheint dort
nicht.

## Die Freistellung im Überlauf-Gate — drei Routen bei 390 px

Das ist kein Nebensatz, deshalb steht es hier sichtbar: **drei Routen verletzen Gate 1 bei
390 px** und laufen nur deshalb nicht rot, weil `frontend/e2e/gate1-ueberlauf.spec.ts` sie
namentlich freistellt (`:148-152`).

| Route                | gemessen | Deckel | Verursacher                                                                                              |
| -------------------- | -------- | ------ | -------------------------------------------------------------------------------------------------------- |
| `/personal`          | 79 px    | 130 px | `Space` ohne `wrap` mit Auswahlfeld `minWidth: 260` + Knopf „Ad-hoc-Person" (`PersonalPage.tsx:329-339`)   |
| `/personen`          | 120 px   | 180 px | `Space` ohne `wrap` mit drei Knöpfen „Schnellerfassung", „Vermisst melden", „Betroffene/n erfassen" (`PersonenPage.tsx:138-144`) |
| `/kraefteuebersicht` | 7 px     | 60 px  | `Space` ohne `wrap` mit „In Lagebericht übernehmen" + „Drucken / als PDF" (`KraefteuebersichtPage.tsx:241-245`) |

**Belegt als Bestand, nicht vermutet** — zwei unabhängige Messungen (`gate1-ueberlauf.spec.ts:121-128`):
auf dem **leeren** Einsatz (0 Personal, 0 Personen, 0 Kräfte) stehen dieselben Werte 79/120/7 px,
die Verursacher rendern also ohne jeden Datensatz; und der Diff `a06cd0f..HEAD` berührt in allen
drei Dateien nur Importe und Spalten — die schuldigen `Space`-Blöcke sind unverändert. `/tiere`
und `/auftraege` messen auf allen drei Breiten 0 px, auf 1366 und 1024 px sind alle neun Routen
sauber.

**Warum freigestellt und nicht rot:** die Reparatur ist `wrap` an drei fremden Seitenköpfen —
Bestandsarbeit in `frontend/src/pages/`, die dieses Bündel nicht besitzt, und ein rot geborenes
Gate wird abgeschaltet statt befolgt (dieselbe Begründung, aus der `cargo clippy -D warnings`
nicht im Sammel-Gate steht).

**Die Freistellung ist keine Generalamnestie**, und das ist maschinell so gebaut
(`gate1-ueberlauf.spec.ts:130-142`): ein Verstoß auf einer **nicht** gelisteten Route × Breite ist
rot; wächst ein gelisteter Verstoß über seinen `deckel`, ist er rot; ist einer behoben (≤ 1 px),
meldet das Gate ihn als **tot** und erzwingt seine Streichung. Der Deckel-Zweig hat in der
protokollierten Mutationsprobe nachweislich gefeuert (`:59-70`). Zielticket: **B5 (LFH-333)**,
wo Kopf- und Bedienflächen ohnehin auf Dichte-Staffel und Umbruch gezogen werden.

## Akzeptanzkriterium 3 — Ist-Formulierung unerfüllbar, Ersatz

Diese Entscheidung steht hier, damit sie durabel ist und nicht nur im Ticketverlauf.

**Ist-Formulierung:** `grep -rnE "sorter|filters:|Input.Search"` mit ≥ 1 Treffer je Datei über
17 Dateien. **Drei unabhängige Gründe, warum das nach B2 nicht mehr geht:**

1. **Die Marken existieren nicht mehr.** `AntdErbe<T>` amputiert `sorter`, `sortOrder`,
   `defaultSortOrder`, `sortDirections`, `filters`, `filteredValue`, `onFilter` und die
   `filter*`-Haken am Spaltentyp. Ein Konsument, der `sorter:` schreibt, bricht `tsc` — das
   Kriterium verlangt genau das, was der Typ verbietet.
2. **Die Suche wohnt einmal, nicht siebzehnmal.** Ein `Input.Search` je Datei ist die falsche
   Richtung; genau das sammelt das Primitiv ein. Die drei Bestandsvorkommen liegen gemessen in
   keiner der dreizehn Katalogdateien — das Kriterium ist heute rot und nach B2 unerreichbar,
   beide Zustände sind wertlos.
3. **„je Datei" ist fachlich falsch.** `KraefteuebersichtPage` darf Suche, Spaltenfilter und
   Sortierung **nicht** haben: die Aggregate der Elternzeilen des Meldebilds sind stromaufwärts
   über die Vollmenge kumuliert (`kraefte/kraeftebild.ts`), eine im Primitiv weggefilterte Zeile
   ließe die Elternzahlen still lügen. Ein „≥ 1 je Datei"-Kriterium erzwingt dort einen Fehler.

**Ersatz — als Inventar-Guard in `frontend/src/components/datensicht.guard.test.ts`, nicht als
Shell-grep:**

- **Positiv, tragend:** `<Datensicht` ≥ 1 und `spaltenFuer` ≥ 1 je Konsumentendatei, dazu die
  Formliteral-Prüfung je gepflegter Ausnahmeliste (`NUR_KARTE`, `NUR_TABELLE`). Ohne die positive
  Marke bestünde eine Datei ohne jede Liste sämtliche Verbotsprüfungen.
- **Negativ, über alle neun Konsumenten** (`VERBOTEN_BEIM_KONSUMENTEN`): rohes Tabellenelement,
  eigenes Bildlauf-Prop, `sorter:`, `filters:`, `responsive:`, `defaultSortOrder` — je 0. Das ist
  die Richtung, die fallen kann; sie fängt den Rückfall auf antd-internen Sortier-/Filterzustand,
  den der Kartenzweig nicht lesen könnte.
- **Die eine Gegenzeile** (`VOLLMENGE_PFLICHT` = `KraefteuebersichtPage`, geprüft über
  `VERBOTEN_BEI_VOLLMENGE`): dort sind `suche=`, `filter: {`, `sortWert:` und
  `standardSortierung=` verboten und `form="tabelle"` Pflicht. `Input.Search` bleibt dort
  **erlaubt** — die Filter-Card liegt außerhalb des Primitivs und filtert weiter stromaufwärts.
  Deshalb ist `Input.Search` = 0 ausdrücklich **keine** repoweite Zusicherung.
- **Kommentar-Stripper mit Blockzustand plus Selbstbeweis** in jeder Zählung — sonst zählt der
  Erklärtext einer Datei ihr eigenes Gate voll (im Repo zweimal passiert, notiert in
  `theme/seitenrinne.guard.test.ts:35-39`).

**Ebenfalls umformuliert:** AK (e) („`<Table`-Zählung 0 in `BefehlListe`") war ein Gate, das nicht
fallen kann — nach dem Umbau liegt das Element ohnehin im Primitiv; Ersatz ist die
Formliteral-Prüfung plus die repoweite Schließung in `katalogTabelle.guard.test.ts`. AK (a)
(`document.body.scrollWidth <= window.innerWidth`) läuft auf dem etablierten Maß
`documentElement.scrollWidth - clientWidth` mit 1-px-Toleranz; die AK-Formel ist im Repo viermal
begründet verworfen. AK (Nr. 1) („jede in diesem Task genannte Tabellen-Datei") lautet jetzt
„**alle 16** Konsumentendateien — 9 `Datensicht` + 6 `KatalogTabelle` + 1 begründete Ausnahme",
sonst wäre das Kriterium erfüllbar, während fünf Tabellen weiter ohne Bildlaufschutz stehen.

## Belege

Maschinell gepinnt sind die Zeilen 1, 2, 4, 6, 12, 13, 14 und die Formhälfte von 15:

- `frontend/src/components/Datensicht.test.tsx` — der Vertrag des Primitivs: Formachse mit
  gemessener `md`-Schwelle (767 px Karten, 768 px Tabelle), genau **ein** Zweig im Baum, der
  Zähler über beide Ausblendungsgründe, die Primäraktion mit Rückfrage, der Statusslot mit
  Pflicht-Etikett, und die zwölf Fälle der Zeilenschleuse einschließlich Gruppenzugehörigkeit.
- `frontend/src/components/datensicht.guard.test.ts` — das Inventar: neun Konsumenten, abgeleitet
  **und** handgepflegt gegeneinander gestellt, die vier Verbotsmengen, die Schlüsselregeln für
  mehrere Sichten und mehrere Reiter, und der Selbstbeweis, dass Kommentar-Fundstellen nicht
  mitzählen.
- `frontend/src/components/katalogTabelle.guard.test.ts` — 19 Einträge (13 Kataloge + 6 Gruppe B),
  die eine deklarierte Ausnahme mit Totmeldung, und die Zusicherung, dass rohe antd-Tabellen
  ausschließlich im Primitiv leben.
- `frontend/e2e/datensicht-schmal.spec.ts` — die Layoutebene des Primitivs: Kartenzweig und
  Tabellenzweig mit Gegenprobe in beide Richtungen, die Trefflächen über alle drei Dichtestufen,
  und der Tastaturweg des Spaltenschalters samt Zähler.
- `frontend/e2e/meldebild-tabelle.spec.ts` — die Vergleichsfläche bei 390 px: Tabelle statt Karten,
  genau eine fixierte Kopfzelle, das Aufklapp-Symbol in der fixierten Spalte, und der Druckpfad.
- `frontend/e2e/fokus-verdeckung.spec.ts` — Z13, Tabellen-Hälfte: Tabulaturdurchlauf hinter
  stehender Kopfzeile, fixierter Spalte und Werkzeugzeile, mit Positivnachweis des Messkerns.
- `frontend/e2e/gate1-ueberlauf.spec.ts` — Gate 1 über neun Routen × drei Prüfbreiten, mit
  gesätem Überlaufstoff (eine leere Liste kann nicht überlaufen), benannten Verursachern und der
  Freistellungsliste oben.

## Was offen bleibt und wohin es geht

Die Zeilennummern stehen hier als `Z…`: das Gate zählt die Zeilen der Prüfliste über ihre
führende Nummer, und eine Zusammenfassung im selben Format zählte doppelt.

| Zeile        | Offener Punkt                                                                        | Zielticket |
| ------------ | ------------------------------------------------------------------------------------ | ---------- |
| Z1, Z2       | 48-px-Kontextzuweisung und Abstand ≥ 16 px folgen der gewählten Stufe nicht           | B5         |
| Z1           | eine punktuelle Klein-Angabe in Gruppe A, vier in Gruppe B (Bestand)                  | B5         |
| Z3           | Meldebild ohne `ladend`; keine optimistischen Updates                                 | B6         |
| Z5, Z7       | mandantengepflegte `status_farbe` ohne Kontrast- und Rollenprüfung                    | Folge-Task (**anzulegen**) |
| Z8           | kein Helligkeits-/Kontrastregler                                                      | Folge-Task |
| Z9           | Kennzahlenkopf der Kräfteübersicht scrollt statt umzubrechen                          | B5         |
| Z12          | CLS-Zahlenwert nicht gemessen; Meldebild ohne Zeilenschleuse trotz Fokusziel in der Zeile | B6      |
| Z13          | Tabulaturdurchlauf bei offenem Navigations-Drawer (Drawer-Hälfte)                     | B7         |
| Z14          | Kartenzweig unter `md` als begründete Ausnahme, Kontextzuweisung offen                | B5         |
| Z15          | „Speichern und nächsten anlegen"; Defaults in 2 von 6 Masken                          | B5         |
| Überlauf-Gate | drei Routen bei 390 px freigestellt (Kopfaktions-Leisten ohne Umbruch)                | B5         |

**Zwei Zeilen ohne Ticketnummer, und das ist eine Bringschuld, keine Formalie.** Z5 und Z7
zeigen auf denselben, in A2 als Befund 1 erfassten, aber **nie angelegten** Folge-Task
(DB-`status_farbe` ohne Format-, Kontrast- und Rollenprüfung). Gate 7 verlangt je offener Zeile
ein Zielticket; solange die Nummer fehlt, ist die Zeile nur per Analogie zu Z8 gedeckt. Der Task
gehört angelegt, bevor diese Liste als abgenommen gilt. Ebenfalls neu und noch ohne eigenen
Eintrag am Zielticket: der in Z12 gemessene Befund, dass der zweite Grund für `zufluss="sofort"`
(„keine Bedienelemente in der Zeile") nicht stimmt — er gehört als Kommentar an **B6 (LFH-334)**,
nicht nur in dieses Dokument.

**Quittierung in der Schwesterliste, noch offen:** `2026-07-28-katalogtabellen-pruefliste.md:65`
(`Z13 → B2`) und `:66` (`Z14 → B2 / B5`) sind mit diesem Bündel eingelöst — Z13 durch
`fokus-verdeckung.spec.ts`, Z14 durch den Spaltenschalter mit Zähler in `Datensicht`, während das
Verdikt für die dreizehn Katalogtabellen selbst **unverändert „nicht anwendbar"** bleibt (max.
sieben Spalten). Eine gepinnte Delegationszeile wird **quittiert, nicht gelöscht**; der Eintrag
gehört in jene Datei und nicht hierher.
