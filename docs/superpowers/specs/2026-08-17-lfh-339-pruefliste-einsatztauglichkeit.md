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
| 2 | **Handschuh-Modus** vorhanden und geprüft — Zeilenhöhe ≥ 72 px, Abstand ≥ 16 px. | **erfüllt für den Statuswechsel, sonst offen → LFH-446** | `e2e/kraefte-schmal.spec.ts` fährt den Statusauslöser in **beiden** Stufen (`komfortabel` 48, `handschuh` 72) und stellt die `data-dichte`-Wache voran — ohne sie hätte jedes „zu klein" zwei mögliche Ursachen. Der zweite Durchgang ist nicht Zierde: ohne ihn bestünde ein hartkodiertes `minHeight: 48` den Test. **Nicht** in der Handschuh-Stufe gemessen sind die Felder der neuen `EinheitDetailPage` und die Zuordnungszeilen; der Mechanismus greift (alle Elemente hängen am `ConfigProvider`, keine punktuelle Größe), die Pixel sind es nicht. LFH-396 trägt dieselbe Lücke für Lage-Dashboard und Einsatzauswahl, ist aber namentlich auf **deren** Ziele gescopt (`a.lfh-zeile`, `.lfh-kz`, Einsatzkarten) — diese Route gab es beim Anlegen jenes Tickets noch nicht. Ein Zielticket, das den Posten nicht kennt, ist ein toter Verweis; deshalb ein eigener Nachzug: **LFH-446**. |
| 3 | **Rückmeldung vor der Serverantwort** — sichtbar ≤ 100 ms; Kommandoreaktion ≤ 2 s; > 15 s nur mit Fortschrittsmeldung. | **erfüllt** | Alle drei Statusmutationen schreiben optimistisch: `onMutate` setzt den neuen Wert per `setQueryData`, bevor der Server antwortet, `onError` rollt auf den alten zurück. Das ist Bestand seit B6 — **neu ist der Beleg in der ANSICHT**: die Tests prüften bisher `client.getQueryData`, was der AK-Formulierung „steht in der Ansicht" nicht entspricht. Jetzt steht in allen drei Seitentests zusätzlich `expect(zeile.textContent).toContain(...)`. Zwei Zustände sind dabei getrennt worden: `laeuft` (Ladeanzeige an **dieser** Zeile) und `gesperrt` (nimmt nichts an, solange **irgendwo** geschrieben wird) — der Bestand hatte beides an einem `Select`, und ein Auslöser, der klickbar aussieht und nichts tut, ist schlechter als ein gesperrter. |
| 4 | **Kritische Aktion hat eine zweite Handlung** — Storno, Abschluss, Löschen, Alarmierung: je 1 zusätzliche Bestätigung. | **erfüllt** | „Auflösen" auf der neuen Detailseite trägt unverändert ein `Popconfirm` mit `okButtonProps={{ danger: true }}` — sonst bestätigte man das Auflösen mit einem blauen Knopf. Ebenso „Mitglied entfernen" in `MitgliederAbschnitt`. Ein Statuswechsel bekommt **bewusst keine** Rückfrage: er ist umkehrbar, die Umkehrung steht im selben Menü, und CLAUDE.md unterscheidet dafür ausdrücklich „umkehrbar → Abstand und `danger`, aber keine zusätzliche Reibung" von „unumkehrbar → Rückfrage". Neu und im engeren Sinn kritisch: **„Einheit bilden" schreibt nicht mehr vor der Eingabe** (Befund M27) — der Dialog IST die zweite Handlung, und vorher gab es gar keine erste. |
| 5 | **Kontrast in beiden Modi** — Text Tag ≥ 7 : 1, Nacht ≥ 5 : 1, nie < 4,5 : 1; Zustände, Rahmen, Fokusring ≥ 3 : 1. | **erfüllt für die Rollenachse, offen → LFH-446 für die Mandantenfarbe** | Die Rollenachse kommt vollständig aus dem Vertrag (`rollenFarbe`, `statusKategorie`); `StatusWahl` trägt kein Farbliteral. **Verbessert** hat sich die DB-Achse: `status_farbe` ist mandantengepflegter, ungeprüfter Freitext und wurde bisher über antds `color`-Prop als **Vollfläche mit erzwungen weissem Text** gerendert. Genau dort ist Kontrast (WCAG 1.4.11) nicht zugesichert — eine Lesbarkeitszusage, die niemand geben kann. Sie steht jetzt auf Rand und Text (`StatusTag`-`farbe`-Prop); dort trägt die Farbe keine Textlesbarkeit. **Nicht gemessen** sind die tatsächlichen Kontrastwerte in beiden Modi: jsdom rechnet keine Farbmischung, und der Playwright-Topf führt diesen Nachweis für keine Fläche. Gleiche Lage wie bei den Warnstufen-Füllungen aus LFH-368/B5h — hier gebündelt in **LFH-446**. |
| 6 | **Kein Status allein über Farbe** — jede Statusfarbe zusätzlich mit Text, Symbol oder Form, 0 Ausnahmen. | **erfüllt, und zwar typerzwungen** | `StatusWahl` nimmt eine `StatusDarstellung`, deren `label` **Pflichtfeld** ist — ein Etikett ohne Text lässt sich hier nicht bauen, das bricht den Typcheck. Im Menü steht die Farbe als **Punkt neben** dem Wortlaut, nie als Zeilenfläche, und der Punkt ist `aria-hidden`: die Bedeutung trägt bereits das Label, sonst läse ein Screenreader sie doppelt. Gepinnt in `StatusWahl.test.tsx` („zeigt die Statusfarbe als Rand und Text, nie als Hintergrundfläche"). **Material ist der Grenzfall und bleibt es:** sein Katalog liegt ausserhalb des A2-Farbvertrags, seine Menüeinträge haben deshalb **keinen** Punkt — nur den Text. Das ist kein Mangel, sondern die offene Farbfrage sichtbar gelassen statt überschrieben. |
| 7 | **Eine Farbe = eine Bedeutung** — Palette auf Doppelbelegung geprüft, gesättigte Farbe nur für abnorme Zustände, Grundfläche weder `#000000` noch `#ffffff`. | **erfüllt** | Tabellen- und Kartenzweig lesen bei allen drei Seiten **denselben** Deskriptor (`statusBedienungVon`) und **dieselbe** Darstellungsfunktion (`statusDarstellung`) — zwei Formen für denselben Status wären ein Unterschied ohne Bedeutung, und genau das war vorher der Fall (Tabelle: Auswahlfeld, Karte: Etikett aus einer zweiten Ableitung). Bei Material sind die fünf **antd-Preset-Farbnamen ersatzlos entfallen**: ein Farbwert ohne Rolle ist die zweite Wahrheit, die A2 aufgeräumt hat. Eine Rollenzuordnung wäre eine Farbentscheidung gewesen und bricht an einem gemessenen Punkt — `im_einsatz` war **blau**, und Blau ist im A0-System `bedien` („Rot bedient nichts"). Für diesen Zustand gibt es keine ehrliche Rolle; es wurde keine erfunden. |
| 8 | **Helligkeits-/Kontrastregler** vorhanden und bei aktiver Warnung nicht bis AUS dimmbar — 1 Regler, 1 Sperre. | **offen → LFH-397** | App-weite Lücke, bereits unter LFH-336/337/338 dokumentiert und dort gebündelt: kein Regler existiert irgendwo in der Anwendung. Nicht seitenspezifisch und nicht im Scope von C4. |
| 9 | **Kritische Anzeigen im Blickfeld** — innerhalb 15° der normalen Blickachse, nicht am Layoutrand. | **erfüllt** | Zwei Befunde adressiert. **(a)** Der Statuswechsel lag in Spalte 5 von 8 hinter einem waagerechten Bildlauf; auf 390 px war er unerreichbar. Er steht jetzt im Kartenkopf neben dem Namen — dort, wo der Status ohnehin abgelesen wird. **(b)** Die Gliederungskarte hatte `flex: '0 0 360px'` **ohne** `flexWrap`: eine Breite, die auf 390 px nicht passt und nicht ausweichen darf (Befund M25). Jetzt `clamp(260px, 30%, 360px)` mit Umbruch. Gemessen in `e2e/kraefte-schmal.spec.ts`: `document.documentElement.scrollWidth ≤ clientWidth` auf **allen vier** Modulrouten. |
| 10 | **Alarmbudget eingehalten** — 1–2 je 10 min im Dauerbetrieb, ≤ 10 je 10-min-Fenster, ~80/15/5 %, 0 flatternde Alarme, ≤ 3 Eskalationsstufen. | **nicht anwendbar** | Keine der Flächen erzeugt Alarme. Die Statusmutationen melden per `message.error` nur den eigenen Fehlschlag — das ist eine Quittung auf eine Benutzeraktion, kein Alarm. |
| 11 | **Warnverhalten** — kein Blinken auf lesbarem Text, ≤ 2 Blinkraten, jede Warnung quittierbar, jeder Ton mit visueller Entsprechung. | **erfüllt** | `grep -rn "animation\|blink\|@keyframes"` über `StatusWahl.tsx`, die drei Kräfteseiten, `EinheitDetailPage.tsx` und `EinheitenPage.tsx` liefert **0 Treffer** — kein Blinken, keine Bewegung, kein Ton. |
| 12 | **Kein Sprung unter dem Cursor** — CLS ≤ 0,1; neue Datensätze nur als opt-in-Sammelbanner. | **erfüllt, und der Umbau hätte es beinahe gebrochen** | Der wichtigste gemessene Punkt dieses Tickets. Die Zeilenschleuse von `Datensicht` friert Reihenfolge und Zeilenmenge ein, solange der Fokus **in der Sicht** liegt (`pruefeVerlassen`, `wurzel.contains`). Das neue Menü liegt in einem **Portal an `document.body`** — also ausserhalb dieser Wurzel —, und antds `autoFocus` schiebt den Fokus beim Öffnen dorthin. Ohne Gegenmassnahme taute die Schleuse damit ausgerechnet in dem Moment auf, für den sie gebaut ist: jemand hält das Menü offen, und die Zeile darunter wandert weg. `pruefeVerlassen` behandelt ein überlagerndes `.ant-dropdown`/`.ant-select-dropdown`/`.ant-picker-dropdown` deshalb **nicht** als Verlassen. **Gemessen und deshalb festgehalten:** in jsdom passiert dieses Fokus-Wandern NICHT — der aktive Knoten bleibt der Auslöser (`ant-dropdown-trigger`, `sicht.contains(...) === true`, nachgemessen am 17.08.2026). Ein Test, der bloss das Menü öffnet und die Reihenfolge prüft, ist deshalb auch ohne den Zweig grün und belegt nichts; geprüft wird der Handler direkt mit einem `relatedTarget` im Portal, **per Mutationsprobe belegt** (Zweig entfernt → Test rot). Die Gegenprobe („Fokus AUS der Sicht taut weiterhin auf") verhindert, dass ein nie auftauendes `pruefeVerlassen` durchginge. |
| 13 | **Fokus nie verdeckt** — 0 vollständig verdeckte Fokusziele beim Tab-Durchlauf hinter fixierten Köpfen, Fußleisten oder Drawern. | **offen → LFH-446** | **Neu entstanden ist ein `position: sticky`-Element:** die Aktionsleiste am Fuss des Formularblocks in `EinheitDetailPage`. Sie ist die Antwort auf Befund M26 (Speichern-Knopf mitten im Inhalt, bei neun Feldern aus dem Bild gescrollt) — sie schafft aber zugleich genau die Konstellation, die Kriterium 13 misst: ein Tabulaturziel kann hinter ihr verschwinden. `e2e/fokus-verdeckung.spec.ts` deckt heute den `Datensicht`-Tabellenzweig und die Katalogtabelle ab, **nicht** diese Route. Der Nachweis steht aus und gehört zum selben Topf wie die Drawer-Hälfte aus LFH-335. Was dafür spricht, dass es hält: die Leiste sitzt am **Ende** des Formulars, ihre eigenen Knöpfe sind die letzten Tabulaturziele davor, und die Zuordnungssektionen darunter liegen ausserhalb des Formulars in eigenen Karten. Belegt ist das nicht. |
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

Geschlossen hat C4:

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

1. **Kriterium 13 für die sticky Aktionsleiste** der neuen `EinheitDetailPage` — ein
   Tabulaturdurchlauf hinter dem neu entstandenen `position: sticky`-Element ist nicht
   gemessen. → **LFH-446**
2. **Kriterium 2 für die Felder der Detailseite** in der Handschuh-Stufe. Der Statuswechsel
   ist in beiden Stufen belegt, die Formularfelder und Zuordnungszeilen nicht. → **LFH-446**
3. **Kriterium 5, gerechneter Kontrast** in beiden Modi — betrifft die Rollenfarben auf
   Karten- und Tabellengrund sowie die auf Rand/Text verlegte Mandantenfarbe. jsdom rechnet
   keine Farbmischung. → **LFH-446**
4. **Die Farbachse des Materialstatus** ist bewusst offen geblieben: der Katalog liegt
   ausserhalb des A2-Vertrags, und `im_einsatz` hat in der A0-Rollenmenge keine ehrliche
   Entsprechung (Blau ist `bedien`). Wer sie schliessen will, entscheidet zuerst, ob die
   Rollenmenge einen Zustand „läuft gerade" braucht — das ist eine A0-Frage, keine C4-Frage.
