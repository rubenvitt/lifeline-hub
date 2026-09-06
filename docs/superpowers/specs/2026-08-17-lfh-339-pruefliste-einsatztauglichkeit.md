# LFH-339 · Prüfliste Einsatztauglichkeit

Angelegt an die Flächen, die LFH-339 (C4) umgebaut hat: das neue Bedienziel
`components/StatusWahl.tsx`, den erweiterten Statusslot in `components/Datensicht.tsx`, die
drei Kräfte-Modulseiten (`pages/{Fahrzeuge,Personal,Material}Page.tsx`), die **neue**
`pages/EinheitDetailPage.tsx`, die auf die Gliederung reduzierte `pages/EinheitenPage.tsx`
und `pages/MitgliederAbschnitt.tsx`.

Kriterien wörtlich aus `docs/superpowers/specs/2026-07-25-bedien-leitlinie-einsatzkontexte.md`
(Festlegung 7). Form nach dem Präzedenzfall
`docs/superpowers/specs/2026-08-11-lfh-338-pruefliste-einsatztauglichkeit.md`.

„Nicht geprüft" ist kein Verdikt (CLAUDE.md). Jede Zeile trägt `erfüllt` / `offen →
Zielticket` / `nicht anwendbar`, je mit Beleg oder Begründung.

**Die drei Kräfteseiten stehen zusätzlich in
`2026-07-28-einsatzlisten-pruefliste.md`.** Deren offene Zeilen Z1/Z2/Z9/Z14/Z15 behalten
ihr dortiges Zielticket — die Zielform-Spec §7 sagt das ausdrücklich. Diese Liste hier
bewertet, was C4 **geändert** hat; `EinheitDetailPage` ist neu und hatte vorher keine.

## Prüfliste

| # | Kriterium | Verdikt | Begründung |
|---|---|---|---|
| 1 | **Treffläche** — Boden ≥ 24 × 24 CSS px oder 24-px-Umkreis frei; zeitkritische Aktion ≥ 48 × 48 px mit ≥ 8 px Abstand. | **erfüllt** | Der Hauptgewinn des Tickets. Der Statuswechsel — die häufigste Einzelaktion des Moduls — sass in einem `<Select>` mit fester `minWidth` (150 px bei Fahrzeug und Personal, **170** bei Material) mitten in der Zeile; auf der 390-px-Karte war er **gar nicht vorhanden**, weil dieselbe Mindestbreite die Karte gesprengt hätte (`Datensicht.tsx:234-236`). Der Auslöser ist jetzt das Statusetikett selbst, ein echter antd-`Button type="text"` — er erbt `controlHeight` vom `ConfigProvider` und schuldet damit nicht die zwei Angaben, die LFH-365 einem handgebauten Ziel auferlegt. Gemessen in `e2e/kraefte-schmal.spec.ts` gegen **die Staffel** (48 im Berührungs-, 72 im Handschuh-Durchgang), nicht gegen die 44 des Ticket-AK: ein Test auf 44 wäre schwächer als der Bestand und liesse eine Regression auf 44–47 px durch — dieselbe Korrektur, die `trefflaeche-tablet.spec.ts:32-41` schon einmal begründet hat. Die **letzte** Klein-Angabe des B5i-Bündels (`InputNumber` in `MaterialPage`) ist gefallen; `components/dichte.guard.test.ts` führt die Datei nicht mehr in `OFFEN`. In `MitgliederAbschnitt` ist der `Button type="link"` ein regulärer Knopf geworden. Die handgebauten Zuordnungszeilen der neuen Detailseite tragen `minHeight: token.controlHeight` **plus** `paddingBlock` — beides, weil die Polsterung allein den Boden nicht trägt. |
| 2 | **Handschuh-Modus** vorhanden und geprüft — Zeilenhöhe ≥ 72 px, Abstand ≥ 16 px. | **erfüllt — LFH-446, Browsermessung 06.09.2026** | `e2e/gate3-trefflaeche.spec.ts` misst die gefüllte Einheiten-Detailroute in allen drei Dichtestufen gegen die Literale **30 / 48 / 72 px**, jeweils in beiden Achsen und mit `data-dichte`-Wache: **21 Grundziele + 4 einblendbare Sprechgruppenfelder**, dazu je eine Personal-, Fahrzeug- und Materialzuordnungszeile. Kleinste Zielachse **29,50 / 48 / 72 px** (0,5 px Subpixeltoleranz), Zuordnungszeilen **38 / 56 / 80 px**. Gemessener Mindestabstand der geprüften benachbarten Felder und Aktionen **11 px komfortabel / 16 px Handschuh**. Die Browserprobe deckte zuvor 11 px zwischen Zuordnung und Auswahl, 7 px zwischen Stärkefeldern sowie 4 px bzw. überlappende Rahmen in der Sprechgruppen-Anlage auf; diese Stellen verwenden jetzt `token.marginSM`, die Inline-Felder dürfen umbrechen. Eine künstlich feste 30-px-Größe fällt trotz aktiver Handschuhstufe durch denselben Messkern; nach Wiederherstellung gilt wieder 72 px. Zusätzlich misst `e2e/fokus-verdeckung.spec.ts` die geöffnete Sprechgruppen-Anlage bei **390 px** komfortabel/Handschuh: alle vier Ziele halten **48/72 px**, alle Paarabstände **8/16 px**, kein horizontaler Dokumentüberlauf. Der vorhandene Statuswechsel-Nachweis bleibt in `e2e/kraefte-schmal.spec.ts`. |
| 3 | **Rückmeldung vor der Serverantwort** — sichtbar ≤ 100 ms; Kommandoreaktion ≤ 2 s; > 15 s nur mit Fortschrittsmeldung. | **erfüllt** | Alle drei Statusmutationen schreiben optimistisch: `onMutate` setzt den neuen Wert per `setQueryData`, bevor der Server antwortet, `onError` rollt auf den alten zurück. Das ist Bestand seit B6 — **neu ist der Beleg in der ANSICHT**: die Tests prüften bisher `client.getQueryData`, was der AK-Formulierung „steht in der Ansicht" nicht entspricht. Jetzt steht in allen drei Seitentests zusätzlich `expect(zeile.textContent).toContain(...)`. Zwei Zustände sind dabei getrennt worden: `laeuft` (Ladeanzeige an **dieser** Zeile) und `gesperrt` (nimmt nichts an, solange **irgendwo** geschrieben wird) — der Bestand hatte beides an einem `Select`, und ein Auslöser, der klickbar aussieht und nichts tut, ist schlechter als ein gesperrter. |
| 4 | **Kritische Aktion hat eine zweite Handlung** — Storno, Abschluss, Löschen, Alarmierung: je 1 zusätzliche Bestätigung. | **erfüllt** | „Auflösen" auf der neuen Detailseite trägt unverändert ein `Popconfirm` mit `okButtonProps={{ danger: true }}` — sonst bestätigte man das Auflösen mit einem blauen Knopf. Ebenso „Mitglied entfernen" in `MitgliederAbschnitt`. Ein Statuswechsel bekommt **bewusst keine** Rückfrage: er ist umkehrbar, die Umkehrung steht im selben Menü, und CLAUDE.md unterscheidet dafür ausdrücklich „umkehrbar → Abstand und `danger`, aber keine zusätzliche Reibung" von „unumkehrbar → Rückfrage". Neu und im engeren Sinn kritisch: **„Einheit bilden" schreibt nicht mehr vor der Eingabe** (Befund M27) — der Dialog IST die zweite Handlung, und vorher gab es gar keine erste. |
| 5 | **Kontrast in beiden Modi** — Text Tag ≥ 7 : 1, Nacht ≥ 5 : 1, nie < 4,5 : 1; Zustände, Rahmen, Fokusring ≥ 3 : 1. | **erfüllt für die Statusdarstellungen — LFH-446, Browsermessung 06.09.2026** | `e2e/kraefte-kontrast.spec.ts` rechnet aus Browserfarben und bis zum opaken Grund komponierten Alpha-Flächen: **72 Messungen** für Material/Fahrzeuge/Personal, je **36 pro Modus**, auf Tabelle (1366 px) und Karte (390 px). Mindestwerte **Text/Rand**: hell Tabelle **18,17 / 5,85 : 1**, hell Karte **15,18 / 4,88 : 1**; dunkel Tabelle **13,47 / 4,92 : 1**, dunkel Karte **15,21 / 5,56 : 1**. Erfasst sind alle fünf auf diesen Flächen erreichbaren Rollen (`normal`, `bedien`, `alarm`, `achtung`, `neutral`); der nullable Statusfall wird gezielt als gültige Wire-Antwort injiziert, alle übrigen Fälle kommen aus der Test-DB. Vor der Korrektur unterschritten farbige Statuswörter das Textziel; `transparent` blendete Wortlaut und Rahmen aus. Jetzt trägt `colorText` den Wortlaut und die kontrollierte Rollenfarbe Rahmen/Formzeichen. Mandantenfreitext bleibt ausschließlich ein redundanter `aria-hidden`-Farbpunkt; Weiß, Schwarz, Transparenz, Alpha, OKLCH und ungültiges CSS werden in Tag und Menü geprüft. Der Browser prüft unverfälschte gültige Farben, unsichtbare ungültige Werte und unveränderten Text-/Rahmenkontrast nach Entfernen des Punktes. Die freie Dekoration bekommt keine eigene Kontrastzusage. Rohwerte stehen im Testanhang `kontrastwerte.json`; Schwarz/Weiß und Alpha-Gegenproben sichern den Messkern. Dieser Nachzug misst die Statusdarstellungen, keinen zusätzlichen Fokusring. |
| 6 | **Kein Status allein über Farbe** — jede Statusfarbe zusätzlich mit Text, Symbol oder Form, 0 Ausnahmen. | **erfüllt, und zwar typerzwungen** | `StatusWahl` nimmt eine `StatusDarstellung`, deren `label` **Pflichtfeld** ist — ein Etikett ohne Text lässt sich hier nicht bauen, das bricht den Typcheck. Im Menü steht die Farbe als **Punkt neben** dem Wortlaut, nie als Zeilenfläche, und der Punkt ist `aria-hidden`: die Bedeutung trägt bereits das Label, sonst läse ein Screenreader sie doppelt. Gepinnt in `StatusWahl.test.tsx` („zeigt die Statusfarbe als Rand und Text, nie als Hintergrundfläche"). **Material ist der Grenzfall und bleibt es:** sein Katalog liegt ausserhalb des A2-Farbvertrags, seine Menüeinträge haben deshalb **keinen** Punkt — nur den Text. Das ist kein Mangel, sondern die offene Farbfrage sichtbar gelassen statt überschrieben. |
| 7 | **Eine Farbe = eine Bedeutung** — Palette auf Doppelbelegung geprüft, gesättigte Farbe nur für abnorme Zustände, Grundfläche weder `#000000` noch `#ffffff`. | **erfüllt** | Tabellen- und Kartenzweig lesen bei allen drei Seiten **denselben** Deskriptor (`statusBedienungVon`) und **dieselbe** Darstellungsfunktion (`statusDarstellung`) — zwei Formen für denselben Status wären ein Unterschied ohne Bedeutung, und genau das war vorher der Fall (Tabelle: Auswahlfeld, Karte: Etikett aus einer zweiten Ableitung). Bei Material sind die fünf **antd-Preset-Farbnamen ersatzlos entfallen**: ein Farbwert ohne Rolle ist die zweite Wahrheit, die A2 aufgeräumt hat. Eine Rollenzuordnung wäre eine Farbentscheidung gewesen und bricht an einem gemessenen Punkt — `im_einsatz` war **blau**, und Blau ist im A0-System `bedien` („Rot bedient nichts"). Für diesen Zustand gibt es keine ehrliche Rolle; es wurde keine erfunden. |
| 8 | **Helligkeits-/Kontrastregler** vorhanden und bei aktiver Warnung nicht bis AUS dimmbar — 1 Regler, 1 Sperre. | **offen → LFH-397** | App-weite Lücke, bereits unter LFH-336/337/338 dokumentiert und dort gebündelt: kein Regler existiert irgendwo in der Anwendung. Nicht seitenspezifisch und nicht im Scope von C4. |
| 9 | **Kritische Anzeigen im Blickfeld** — innerhalb 15° der normalen Blickachse, nicht am Layoutrand. | **erfüllt** | Zwei Befunde adressiert. **(a)** Der Statuswechsel lag in Spalte 5 von 8 hinter einem waagerechten Bildlauf; auf 390 px war er unerreichbar. Er steht jetzt im Kartenkopf neben dem Namen — dort, wo der Status ohnehin abgelesen wird. **(b)** Die Gliederungskarte hatte `flex: '0 0 360px'` **ohne** `flexWrap`: eine Breite, die auf 390 px nicht passt und nicht ausweichen darf (Befund M25). Jetzt `clamp(260px, 30%, 360px)` mit Umbruch. Gemessen in `e2e/kraefte-schmal.spec.ts`: `document.documentElement.scrollWidth ≤ clientWidth` auf **allen vier** Modulrouten. **(c)** Dabei sind zwei echte Bestandsverstöße aufgefallen und behoben worden — `/material` lief um 327 px über, `/fahrzeuge` um 115 px; Ursache und Fix stehen unten unter „Ein Befund, den erst der zweite Anlauf sichtbar machte". Der Messwert ist erst seit der gehärteten Wache belastbar: die erste Fassung wartete auf `body` und maß den Ladezustand. |
| 10 | **Alarmbudget eingehalten** — 1–2 je 10 min im Dauerbetrieb, ≤ 10 je 10-min-Fenster, ~80/15/5 %, 0 flatternde Alarme, ≤ 3 Eskalationsstufen. | **nicht anwendbar** | Keine der Flächen erzeugt Alarme. Die Statusmutationen melden per `message.error` nur den eigenen Fehlschlag — das ist eine Quittung auf eine Benutzeraktion, kein Alarm. |
| 11 | **Warnverhalten** — kein Blinken auf lesbarem Text, ≤ 2 Blinkraten, jede Warnung quittierbar, jeder Ton mit visueller Entsprechung. | **erfüllt** | `grep -rn "animation\|blink\|@keyframes"` über `StatusWahl.tsx`, die drei Kräfteseiten, `EinheitDetailPage.tsx` und `EinheitenPage.tsx` liefert **0 Treffer** — kein Blinken, keine Bewegung, kein Ton. |
| 12 | **Kein Sprung unter dem Cursor** — CLS ≤ 0,1; neue Datensätze nur als opt-in-Sammelbanner. | **erfüllt, und der Umbau hätte es beinahe gebrochen** | Der wichtigste gemessene Punkt dieses Tickets. Die Zeilenschleuse von `Datensicht` friert Reihenfolge und Zeilenmenge ein, solange der Fokus **in der Sicht** liegt (`pruefeVerlassen`, `wurzel.contains`). Das neue Menü liegt in einem **Portal an `document.body`** — also ausserhalb dieser Wurzel —, und antds `autoFocus` schiebt den Fokus beim Öffnen dorthin. Ohne Gegenmassnahme taute die Schleuse damit ausgerechnet in dem Moment auf, für den sie gebaut ist: jemand hält das Menü offen, und die Zeile darunter wandert weg. `pruefeVerlassen` behandelt ein überlagerndes `.ant-dropdown`/`.ant-select-dropdown`/`.ant-picker-dropdown` deshalb **nicht** als Verlassen. **Gemessen und deshalb festgehalten:** in jsdom passiert dieses Fokus-Wandern NICHT — der aktive Knoten bleibt der Auslöser (`ant-dropdown-trigger`, `sicht.contains(...) === true`, nachgemessen am 17.08.2026). Ein Test, der bloss das Menü öffnet und die Reihenfolge prüft, ist deshalb auch ohne den Zweig grün und belegt nichts; geprüft wird der Handler direkt mit einem `relatedTarget` im Portal, **per Mutationsprobe belegt** (Zweig entfernt → Test rot). Die Gegenprobe („Fokus AUS der Sicht taut weiterhin auf") verhindert, dass ein nie auftauendes `pruefeVerlassen` durchginge. |
| 13 | **Fokus nie verdeckt** — 0 vollständig verdeckte Fokusziele beim Tab-Durchlauf hinter fixierten Köpfen, Fußleisten oder Drawern. | **erfüllt — LFH-446, Browsermessung 06.09.2026** | `e2e/fokus-verdeckung.spec.ts` durchläuft die gesäte Einheiten-Detailroute bei **1366×520 und 390×420 px**, jeweils kompakt und Handschuh. Jeder Durchgang besucht per Tab **alle 21 benannten Formular-, Leisten- und Zuordnungsziele**; Ergebnis jeweils **0 vollständig verdeckte Ziele** bei 58–59 Stopps. Zwei weitere 390×420-px-Durchgänge öffnen die Sprechgruppen-Anlage (komfortabel/Handschuh), aktivieren die Anlegen-Aktion durch gültige Eingaben und besuchen exakt **24 Ziele**; ebenfalls **0 Verdeckungen**. Die reale Aktionsleiste muss sticky, im Viewport und kleiner als die vorhandene Bildlaufreserve sein. Der Messkern prüft die sichtbaren AntD-Feldhüllen gegen alle sticky/fixed-Knoten mit Rechteck-Enthaltensein **und** `elementFromPoint`, ohne Vorfahren des Ziels als Verdecker zu zählen. Eine künstlich hinter die echte Leiste gelegte Fokusprobe liefert genau einen Befund; außerhalb der Leiste ist dieselbe Probe frei. Die reale schmale Route war zuvor rot. Ein am Formular begrenzter `scroll-margin-block-end` reserviert nun die per `ResizeObserver` gemessene Leistenhöhe einschließlich Dichteabstand, damit der native Fokus-Bildlauf die Leiste berücksichtigt. |
| 14 | **Tabellenseite vollständig** — fixierte Kopfzeile, fixierte menschenlesbare Identifierspalte, umschaltbarer Spaltensatz mit Zähler, keine Auflösung in Karten, wo verglichen wird. | **erfüllt** | Alle vier Teile liegen bei `Datensicht`/`KatalogTabelle` und sind unangetastet geblieben. Der Kartenzweig unter `md` ist die **begründete Ausnahme** aus AK3b des Drawer-Specs und bleibt es — C4 hat ihn nicht ausgeweitet, sondern **bedienbar gemacht**: bis hierher war er auf den drei Seiten lesend, weil das Auswahlfeld nicht hineinpasste. Bei `MaterialPage` ist der Status dabei aus `sekundaer` in den `status`-Slot gewandert (zwei Sekundärfelder statt drei), sonst stünde er doppelt. **`MitgliederAbschnitt` wird ausdrücklich NICHT zu Karten** — das Ticket verlangt es, CLAUDE.md verbietet es für `KatalogTabelle`-Träger („auf schmalem Schirm wird eine Tabelle angepasst, nicht in Karten aufgelöst"). Was dort tatsächlich drückte, war eine feste `width: 170` am Rollenfeld; sie ist ein `minWidth` geworden. |
| 15 | **Erfassungsmaske vollständig** — Defaults vorbelegt, sichtbar und einzeln überschreibbar, „Speichern und nächsten anlegen" mit gehaltenem Kontext, Sammelliste mit Ändern/Entfernen je Zeile, Labels über dem Feld, volle Tastaturbedienung. | **erfüllt für die neue Maske** | „Einheit bilden" nimmt `ErfassungsModal` (B4-Norm) statt eines handgebauten Dialogs und erbt damit: Absende-Knopf **im** `<form>` (Enter sendet), Fokus im ersten Feld beim Öffnen, Zurücksetzen auf **allen vier** Auswegen. Zwei Felder, `layout="vertical"` also Labels über dem Feld. **Kein `serie`** — bewusst: eine Einheit zu bilden ist keine Minutentakt-Erfassung wie die Ad-hoc-Disposition eines Fahrzeugs; „Speichern und nächste" wäre hier ein Knopf ohne Anlass. Der Reset auf dem Abbrechen-Weg ist gepinnt (verworfener Name ist beim nächsten Öffnen weg) — die schärfere Hälfte, denn ein stehengebliebener Name legte beim nächsten Mal eine Dublette an. |

## Was dieses Ticket am Zustand geändert hat

Von den zehn Befunden des Tickets waren **fünf beim Antritt bereits geschlossen** — durch
B1/B2/B4/B5, die nach der Ticketerstellung geliefert haben. Gemessen am 17.08.2026 gegen
`332307f2`:

| Befund | Lage beim Antritt |
|---|---|
| H20 (kein Breakpoint, kein Karten-Fallback) | erledigt durch B1/B2 (`useViewport`, `Datensicht form="auto"`) |
| M21 (Bemerkung nur als Stift-Icon) | erledigt durch LFH-369/B5i (`BemerkungZelle`) |
| M22 (kein optimistisches Update) | erledigt durch B6 — **die Tests dazu fehlten**, sie sind Teil von C4 |
| M23 (keine Sortierung/Filter/Gruppierung) | erledigt durch B2 (`Datensicht`) |

### Ein Befund, den erst der zweite Anlauf sichtbar machte

**Zwei der vier Routen liefen auf 390 px waagerecht über** — `/material` um **327 px**,
`/fahrzeuge` um **115 px**. Beides Bestand, keins von C4 verursacht; AK 2 war damit
verletzt, während der zugehörige Test **grün meldete**.

**Warum er grün war, und das ist die eigentliche Lehre:** die Wache des Tests wartete auf
`page.locator('main, [role="main"], body')` — und `body` ist **immer** sichtbar. Gemessen
wurde eine Seite, deren Daten noch nicht angekommen waren; ohne Zeilen gibt es keinen
Überlauf. Ein Test, der vor dem Inhalt misst, prüft den Ladebildschirm. Aufgeflogen ist es
nur, weil derselbe Test in einem späteren Lauf zufällig **nach** dem Laden maß und dann
327 px meldete — also durch einen Zufall, nicht durch das Gate.

Die Wache zeigt jetzt je Route auf einen Wortlaut, der erst **mit** den Daten erscheint.

Drei Ursachen, alle über die innerste sprengende Knotenmenge gemessen:

- `components/EinsatzSeite.tsx` stellte Titel und Aktionen unbedingt nebeneinander. `wrap`
  allein genügt **nicht** — ein Flex-Kind hat per Vorgabe `min-width: auto` und schrumpft
  nicht unter seinen Inhalt; es braucht zusätzlich `minWidth: 0` an beiden Kindern.
- Der `aktionen`-Slot von Fahrzeug und Personal trug ein `Select` mit `minWidth: 260` plus
  Knopf in einer `Space`-Reihe **ohne** `wrap`. Der Umbruch im Primitiv schiebt den Block
  nur unter den Titel, wo er weiterhin zu breit ist — beide Ebenen sind nötig.
- `MaterialPage` baut ihren Kopf **von Hand** statt über `EinsatzSeite` (daher der mit
  Abstand grösste Überlauf) und trägt dort zusätzlich ein Mengenfeld. Sie auf das Primitiv
  zu ziehen wäre die gründlichere Antwort und gehört zum Seitenkopf-Bündel (C5).

**Das Bestands-Gate hat mitgezogen:** `e2e/gate1-ueberlauf.spec.ts` führte `/personal` als
namentlich freigestellten Verstoß (79 px, Deckel 130) mit exakt dieser Ursachenbeschreibung
und dem Zielticket B5. Nach dem Fix meldete es den Eintrag als **tot** und erzwang seine
Streichung — genau die Mechanik, für die es gebaut ist. `/fahrzeuge` und `/material` führt
jenes Gate nicht; sie werden seither von `e2e/kraefte-schmal.spec.ts` gemessen und
absichtlich **nicht** zusätzlich dort aufgenommen: eine zweite Messung derselben Zusicherung
an zwei Orten veraltet an einem davon.

### Geschlossen hat C4:

- **H19** — Statuswechsel aus der Tabellenzelle heraus, nach den Festlegungen Z1–Z3 der
  Zielform-Spec. Träger: `components/StatusWahl.tsx` plus `statusBedienung` am Kartenplan.
- **M25** — Gliederungskarte bricht um (`clamp` + `flexWrap`).
- **M26** — Detailansicht auf eigener Route, Zuordnungen ausserhalb des Formulars, sticky
  Aktionsleiste.
- **M27** — „Einheit bilden" persistiert erst beim Absenden.
- **N6** — „Soll-Stärke (F/UF/M)" statt Entwicklersprache.
- **N7** — Aktionsspalte beschriftet, Textlink → Knopf.

## Wo dieses Ticket dem Ticket-Text widerspricht

Drei Stellen, je mit Beleg — sie sind Entscheidungen, keine Auslassungen:

1. **Kein Quick-View-Drawer, kein `Segmented`, keine Statusfarbe als Fläche.** Das Ticket
   verlangt alle drei; die Zielform-Spec verwirft alle drei mit Zahl bzw. Regel (§3/§4/§4b)
   und hält im Kopf fest, dass sie im Konfliktfall gilt. Die zwei Eigenwidersprüche des
   Tickets („read-only Quick-View **mit** Statuswahl" gegen LFH-19) entfallen damit, statt
   umbenannt zu werden.
2. **Kein `responsive: ['lg']` an Spalten.** CLAUDE.md sperrt antds eigenes `responsive` am
   Spaltentyp, damit der Zähler ausgeblendeter Spalten **eine** Wahrheit hat; die
   Projektachse ist `abBreite`. Die Spalten der drei Seiten tragen sie bereits.
3. **Kein „≥ 44 px" als Messschwelle.** Bindend ist Gate 3 mit 30 / 48 / 72. Ein Test auf 44
   wäre schwächer als der Bestand — dieselbe Korrektur hat `trefflaeche-tablet.spec.ts`
   bereits einmal begründet.

## Offene Nachzüge

1. **Kriterium 13 — in LFH-446 nachgewiesen (06.09.2026):** Einheitenroute in vier
   Ansichten mit je 21 besuchten Zielen, 0 vollständigen Verdeckungen und Gegenprobe
   hinter der echten Leiste. Zusätzlich zwei schmale Durchgänge mit geöffneter
   Sprechgruppen-Anlage und je 24 besuchten Zielen. Siehe `e2e/fokus-verdeckung.spec.ts` und Zeile 13.
2. **Kriterium 2 — in LFH-446 nachgewiesen (06.09.2026):** 25 bedingte/ständige Ziele,
   drei Zuordnungsarten, Böden 30/48/72 px und Mindestabstände 11/16 px. Siehe
   `e2e/gate3-trefflaeche.spec.ts` und Zeile 2; feste Kompaktgröße wird erkannt.
3. **Kriterium 5 — in LFH-446 nachgewiesen (06.09.2026):** Statuswortlaut mindestens
   15,18:1 hell / 13,47:1 dunkel, Rahmen mindestens 4,88:1 hell / 4,92:1 dunkel.
   Mandantenfarbe nur als redundanter Punkt. Siehe `e2e/kraefte-kontrast.spec.ts` und Zeile 5.
4. **Die Farbachse des Materialstatus** ist bewusst offen geblieben: der Katalog liegt
   ausserhalb des A2-Vertrags, und `im_einsatz` hat in der A0-Rollenmenge keine ehrliche
   Entsprechung (Blau ist `bedien`). Wer sie schliessen will, entscheidet zuerst, ob die
   Rollenmenge einen Zustand „läuft gerade" braucht — das ist eine A0-Frage, keine C4-Frage.
