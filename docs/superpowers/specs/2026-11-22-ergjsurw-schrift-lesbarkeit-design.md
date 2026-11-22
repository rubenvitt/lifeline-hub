# Schrift und Lesbarkeit, Neuanlauf ohne Dichtekopplung (LLH-1956)

Zunder: https://zunder.rubeen.dev/#/aufgabe/ergjsurw9oppzyth4pxlxv9n
Unteraufgaben: LLH-2043 (Zoom frei), LLH-2044 (Schriftboden 11 px, Seitentitel 16 px),
LLH-2045 (Feldetikett), LLH-2046 (`meta` in Textschrift). Ein gemeinsamer Entwurf, weil alle vier
dieselbe Fähigkeit ändern (`schriftskala`, Gestaltungssprache in `frontend/AGENTS.md`).

## Absicht

Die UI/UX-Analyse vom 12.11.2026 (LLH-1714) fand: ein Viertel bis ein Drittel der Zeichen unter
12 px, Text bis hinunter auf 9 px, Seitentitel so groß wie der Lauftext, Feldetiketten in 10-px-
Versalien mit Sperrung, Wörter in Mono und ein gesperrter Zoom. Wer im Einsatz mit Abstand,
Handschuh oder müden Augen liest, liest das schlecht. PR #1427 (LLH-1719) ging das an, ließ die
Schrift aber zusätzlich mit der Bediendichte wachsen (×1,15 / ×1,25). Das brach rund 20 e2e-
Layoutprüfungen, vor allem weil die Kopfleiste am Handy und Tablet zweizeilig wurde. #1427 wurde
zurückgenommen (2f1599d4).

Seither gilt ADR-0071 (19.11.2026): die Stufen der `schriftskala` hängen **nicht** von der Dichte
ab, Text kommt über `Textstufe`, Mono über `monoStil(stufe)`, neue Größen-Literale verbietet die
Ratsche `theme/schriftgroesse.guard.test.ts` mit Schuld `schriftgroesse.schuld.ts`.

Abgestimmt mit Ruben am 22.11.2026: Neuanlauf **ohne** Dichtekopplung, ADR-0071 bleibt in diesem
Punkt. Übernommen werden die Lesbarkeitspunkte, die nicht an der Kopplung hängen, in vier
Unteraufgaben mit je eigenem PR und voller e2e-Suite (Label `voll`).

## Ziele

- Kein Bildschirmtext unter 11 px.
- Der Seitentitel steht über dem Lauftext (16 statt 14 px).
- Der Zoom ist frei; ein iPhone zoomt trotzdem nicht beim Tippen in ein Feld.
- Feldetiketten sind gemischt geschrieben und lesbar, Versalien bleiben Köpfen.
- Wörter stehen in der Textschrift; Mono trägt nur Zahl, Zeit, Kennung, Funkrufname.
- Jeder PR hat die volle e2e-Suite grün.

## Nicht-Ziele

- Schrift wächst mit der Dichte (ADR-0071 bleibt; die Dichte trägt weiter nur antds Grundschrift
  13,5 / 15 / 15 und die Treffflächen).
- antds Grundschrift anheben (13,5 → 14 brach am Desktop Personal 1440 und Meldebild 1366).
- Die übrigen Stufen umbauen (`kartentitel` 15, `mono` 13, `textKlein` 12 usw. bleiben).
- Druckansichten (pt), Zeichnungen mit eigenem Maßstab (Kartenstile, taktische Zeichen,
  Fernmeldeskizze, Lagekarten-Griffe und Cluster), die Fernsicht-Skala des Lagemonitors.
- Eine eigene Einstellung „Schrift größer“ (der freie Zoom deckt das).
- Die Specs, ADR-0058 und die Wächter aus #1427 wiederbeleben; ADR-0058 bleibt `verworfen`.

## Anti-Ziele

- `alpha` wird rot. Darum jeder Teil einzeln mit `voll`.
- Die Kopfleiste bricht am Handy oder Tablet um (der Kernfehler von #1427).
- Die Schuld der Ratsche wächst oder bekommt einen neuen Eintrag.

## Ansätze

1. **Rücknahme der Rücknahme** (`git revert 2f1599d4`) und nacharbeiten. *Verworfen:* 284
   Nicht-Bild-Dateien mit 945 Konfliktblöcken, zwei Größen-APIs nebeneinander, Widerspruch zu
   ADR-0071.
2. **Neuaufbau mit Dichtekopplung** (neue ADR löst ADR-0071 ab). *Verworfen* von Ruben am
   22.11.: größter Gewinn am Handschirm, aber das Bruchbild von #1427 kehrte zurück.
3. **Neuaufbau ohne Kopplung auf den Bausteinen `Textstufe`/`monoStil`, in vier Teilen.**
   *Gewählt:* die teure Bestandsumstellung ist seit LLH-1810/LLH-1972 erledigt, die Werte ändern
   sich an wenigen Stellen in `theme/` und in einer überschaubaren Zahl von Aufrufern; jeder Teil
   ist für sich prüfbar.

## Reihenfolge und Schnitt

Ein Branch nach dem anderen; der nächste PR beginnt nach dem Merge des vorigen auf `alpha`.

1. **LLH-2043 Zoom frei** — kleinster Teil, trägt Design-Doc und Plan in den ersten PR.
2. **LLH-2045 Feldetikett** — neuer Baustein, wenige Bausteine als Träger.
3. **LLH-2044 Boden 11 px, Seitentitel 16 px** — Werte in `theme/`, Rail, Schuldabbau; neue ADR.
4. **LLH-2046 `meta` in Textschrift** — Mono-Grenze; neue ADR.

**Plan:** eine Datei `docs/superpowers/plans/2026-11-22-ergjsurw-schrift-lesbarkeit.md`. Jetzt
entsteht nur der Abschnitt für Teil 1; jeder weitere Teil bekommt seinen Abschnitt zu Beginn
seines Branches, auf dem dann aktuellen Stand von `alpha` (Zahlen und Fundstellen veralten
sonst). Dieser Entwurf ist für alle vier Teile freigegeben; ein späterer Abschnitt wird zur
Kenntnis vorgelegt, ein neuer Freigabe-Halt entsteht nur, wenn ein Teil vom Entwurf abweichen
muss. Die Zunder-Unteraufgabe trägt den Plan-Pfad in `plan`. *(Meine Wahl nach dem Builder-Check.)*

Feldetikett vor dem Boden, weil der Boden sonst die 10-px-Augenbrauen als Feldetikett erst auf
11 hebt und LLH-2045 sie danach ersetzt (doppelte Bilder, doppelte e2e-Runde). Die Reihenfolge
ist meine Wahl.

## Teil 1 — Zoom frei (LLH-2043)

- `frontend/index.html`: Viewport `width=device-width, initial-scale=1.0`, ohne
  `maximum-scale` und `user-scalable`. `touch-action: manipulation` und `text-size-adjust: 100%`
  auf `html` (`index.css`) bleiben (kein Doppeltipp-Zoom, kein Klickverzug).
- **Felder 16 px auf Touch** (Entscheidung Ruben 22.11.): auf grobem Zeiger
  (`@media (pointer: coarse)`) bekommen Eingabefelder 16 px Schrift, damit iOS beim Fokus nicht
  zoomt. Gemeint sind Elemente, in die getippt wird: antd `Input`, `Input.Password`,
  `Input.Search`, `InputNumber`, `TextArea`, `Select`/`AutoComplete` mit Suche, `DatePicker`/
  `TimePicker`, `Mentions`, dazu rohe `<input>`/`<textarea>`/`<select>`. Knöpfe, Etiketten und
  Lauftext bleiben. Der Wert 16 ist ein benannter Wert in `theme/tokens.ts` (z. B.
  `feldSchriftTouch`), gespiegelt als CSS-Variable in `rollen.css` und von
  `rollen.guard.test.ts` gleich gehalten; die CSS-Regel liest nur die Variable (kein Literal,
  keine neue Schuld). Ob die Regel in CSS oder über antds Komponenten-Token gesetzt wird,
  entscheidet der Plan; Bedingung ist, dass sie beim ersten Bild greift und nicht von der Dichte,
  sondern vom Zeiger abhängt (`startDichte` liest die Zeigerart nur beim Start).
- Die Regel gilt auch für Felder mit eigener Inline-Schriftgröße (etwa das Code-Feld in
  `instanz/InstanzkopplungSeite.tsx` mit `monoStil('monoGross')`): sie setzt sich innerhalb der
  Media-Query mit `!important` durch, denn das Ziel ist „kein Fokus-Zoom“ ohne Ausnahme. Der Plan
  sichtet die Eingabefelder mit Inline-Größe und prüft, dass Felder mit Breite in `ch` bei 16 px
  ihren Inhalt noch zeigen. *(Meine Wahl nach dem Builder-Check.)*
- Die Feldhöhe folgt weiter `controlHeight` der Dichte. In `kompakt` auf einem Touchgerät
  (30 px, nur auf Wahl) darf ein 16-px-Feld höher werden; das ist hingenommen, muss aber in
  `komfortabel` (48) und `handschuh` (72) die Höhe halten.
- Wächter: `theme/keinZoom.guard.test.ts` wird `theme/zoomFrei.guard.test.ts` (kein
  `maximum-scale`, kein `user-scalable=no`, `manipulation` bleibt, die Touch-Feldregel liest die
  Variable). Regel „Kein Zoom wie in einer App“ in `frontend/AGENTS.md` wird zu „Zoom frei,
  Felder 16 px auf Touch“, mit Marke „umgekehrt 22.11.2026 (LLH-2043)“; der Satz „kein Feld wird
  dafür auf 16 px gehoben“ fällt.
- e2e: eine Spec misst bei 390 px Touch in `komfortabel` die berechnete Schriftgröße eines
  Eingabefelds (16 px) und eines Knopfs daneben (unverändert); der Viewport-Inhalt wird gelesen.
- Die iOS-Hülle (`ios/`) zeigt die Web-App; ob der WKWebView den Viewport ebenso befolgt, prüft
  der Plan an `ios/AGENTS.md`. Eine Änderung in `ios/` gehört nicht in diesen Teil, sondern wird
  bei Bedarf eine eigene Aufgabe.

## Teil 2 — Feldetikett (LLH-2045)

- Neuer Baustein `components/instrument/Feldetikett.tsx`: Stufe `textKlein` (12 px), Ton
  `gedaempft`, gemischt geschrieben, ohne Sperrung, `als="dt" | "label" | "span"`, ohne `style`
  (wie `Textstufe`, ADR-0071). Export über `components/instrument/index.ts`.
- `Datenraster.tsx` (`Datenfeld`), `DatenfeldEingabe.tsx` und `components/FeldLabel.tsx` nutzen
  ihn statt `<Augenbraue als="dt">` bzw. Versalien in `token.fontSizeSM`. Ebenso die direkten
  `als="dt"`-Stellen in `pages/EinsatzdatenPage.tsx` und `pages/lagekarte/Inspector.tsx`.
- `Augenbraue` verliert `'dt'` aus ihrem Elementtyp; ein Feldetikett per Augenbraue kompiliert
  nicht mehr. Die übrigen Augenbrauen bleiben Köpfe: Paneelköpfe, Kennzahl-Titel,
  Tabellenköpfe, Gruppenköpfe, Rail-Etikett. Augenbrauen als `span`, die ein Feld benennen,
  werden beim Durchgang gesichtet und umgestellt; Köpfe bleiben.
- Die Kontrastmessung der Augenbraue (e2e `textstufen-kontrast`) zieht auf eine verbleibende
  Augenbraue um, falls ihre Messstelle ein Feldetikett wird.
- Regel in `frontend/AGENTS.md`, Abschnitt „Bausteine“: Feldetikett für Feldnamen, Augenbraue nur
  für Köpfe.
- Höhenwirkung: Etiketten werden 10 → 12 px, gut 2 px pro Datenfeld. Handy-Specs, die „erste
  Karte ganz im Bild“ oder Menülängen messen, sind die Risikostellen.

## Teil 3 — Boden 11 px, Seitentitel 16 px (LLH-2044)

- `theme/tokens.ts`, `schriftskala` (und `rollen.css`, `rollen.guard.test.ts` gleich):
  - `augenbraue` 10 → 11, Sperrung .14em → .08em (hält die Breite etwa, wie in #1427 abgestimmt);
  - `railEtikett` 9 → 11, Sperrung .06em → .04em;
  - `metaKlein` 10 entfällt; ihre Aufrufer nehmen `meta` (11). Fällt damit eine Stufe aus der
    Prüfung von ADR-0071, ersetzt die neue ADR sie.
  - `seitentitel` 14 → 16.
- **Rail 64 px** (Entscheidung Ruben 22.11.): Boden `RAIL_BREITE` in `components/Kopfleiste.tsx`
  60 → 64; `railBreite` bleibt `max(Boden, controlHeight + Linie)`, also 64 / 64 / 73. Die
  Markenzelle folgt wie bisher. Nachweis: e2e misst in jeder Dichte, dass kein Rail-Etikett
  überläuft (gerendertes `scrollWidth` ≤ `clientWidth`), mit dem längsten Etikett.
- Seitentitel: passt in den 44-px-Seitenkopf (16 × 1,4 = 22,4 px bei 37 px Innenhöhe); die
  Messung des Seitenkopfs (`einsatztauglichkeit-layout`, 44 px in `kompakt`) muss halten.
  Einsatzname und Uhr in der Kopfleiste sind nicht `seitentitel` und bleiben.
- **Schuldabbau unter 11 px:** jedes Literal der Schuld und jede `monoStil(<Zahl>)` unter 11 px
  rastet auf eine Stufe ≥ 11 ein; die Schuld sinkt im selben Commit. Ausgenommen bleiben die
  Nicht-Ziele (Druck, Zeichnungsmaßstab, Lagemonitor); dort wird nichts angefasst.
- Neue ADR (nächste freie Nummer, `docs/architektur/AGENTS.md`): ersetzt ADR-0071, übernimmt
  deren Regeln und fügt „MUST NOT: eine Stufe unter 11 px“ hinzu; ADR-0071 bekommt
  `status: ersetzt`. Regeltext in `frontend/AGENTS.md`, „`schriftskala`“, nachgezogen.
- Ein Wächter (Unit) hält den Boden: keine Stufe der `schriftskala` unter 11.

## Teil 4 — `meta` in Textschrift (LLH-2046)

- `schriftskala.meta` wechselt auf die Textschrift (Archivo), 11 px, mit `tabular-nums`.
  `schriftStil` gibt `fontVariantNumeric: 'tabular-nums'` für `meta` mit (Archivo hat `tnum`).
- Für Zahlen und Zeiten in 11 px entsteht die Mono-Stufe `monoFein` (11, 400, `zahl`).
- Jeder Aufruf `monoStil('meta')` (heute rund 68, nach Teil 3 plus die früheren `metaKlein`)
  wird nach Inhalt umgestellt: ganz Zahl, Zeit, Kennung oder Funkrufname → `monoStil('monoFein')`;
  sonst Text → `Textstufe stufe="meta"` bzw. `schriftStil('meta')`. Gemischte Knoten stehen ganz in
  der Textschrift, keine Zerlegung in Spans.
- `MetaZeile`: Teile in Textschrift, `Teil mono` und `MetaZeile.Zahl` auf `monoFein`.
- `paneelMetaStil`, `seitenMetaStil` und die Metazeilen der Bausteine wechseln damit zentral.
- Neue ADR ersetzt die aus Teil 3: Mono-Familie ohne `meta`, mit `monoFein`.
  `frontend/AGENTS.md` („`schriftskala`“, Seitenkopf „`meta` Mono“) nachgezogen.
- **Die Grenze gilt für jede Mono-Stufe** (Entscheidung Ruben 22.11., nach dem Builder-Check):
  Mono trägt nur Zahl, Zeit, Kennung und Funkrufname, egal in welcher Stufe. Teil 4 sichtet deshalb
  auch die übrigen rund 330 Aufrufe von `monoStil` (`mono`, `monoKlein`, `monoGross`,
  `datenwert*`) nach Wort-Inhalt und stellt Wörter auf die Textschrift um (Beispiel
  `pages/EinsatzleiterAngabe.tsx`: „seit 14:32“ in `mono` → Textschrift, nur die Zeit bleibt Mono,
  sofern sie ein eigener Knoten ist; sonst steht der Knoten ganz in Textschrift). Der Kommentar an
  `schriftskala.mono` („seit …“) wird nachgezogen. Die Regel steht allgemein in der ADR und in
  `frontend/AGENTS.md`.
- Durchsetzung: e2e auf Überblick, ETB, Einsatzdaten und Betroffenen prüft jeden Textknoten in
  Mono-Schrift: kein Wort aus vier oder mehr Kleinbuchstaben, außer in einem Element mit
  `data-schrift="kennung"` (Funkrufnamen; die Funkrufnamen-Bausteine setzen es).
- Teil 4 ist damit der größte Teil (Bilder, Breitenrisiko); er darf beim Planen in zwei PRs
  geschnitten werden (erst `meta`, dann die übrigen Stufen), wenn der Diff zu groß wird.
- Breitenwirkung: Archivo ist schmaler als JetBrains Mono. Specs, die einen Umbruch als
  Vorbedingung erwarten (in #1427: `e2e/stab-schmal.spec.ts`, Sichtung am Trenner), werden
  geprüft und mit neuen Daten wieder zum Umbruch gebracht, nicht abgeschwächt.

## Für jeden Teil gleich

- TDD je Aufgabe des Plans; Wächter zuerst.
- Vor dem PR `./scripts/check-all.sh --geaendert --ohne-e2e`; im PR Label `voll` (Akzeptanz).
  Risiko-Specs vorher lokal: `kopfzeile-schmal`, `rahmen-stehen-bleiben`, `benutzermenue`,
  `command-palette`, `leisten-flaeche`, `dialoge-handy`, `alarmton-freischalten`,
  `gate1-ueberlauf`, `meldebild-tabelle`, `betroffene-handy`, `rail-etikett` (falls vorhanden).
- Bricht eine e2e-Prüfung, bekommt die Stelle Platz (Umbruch zulassen, Breite, Kürzung mit
  Tooltip); eine Messung wird nicht abgeschwächt, um grün zu werden. Pinnt eine Prüfung einen
  alten Pixelwert, der hier bewusst geändert wird, zieht sie mit Verweis auf die Unteraufgabe
  nach.
- Anwender-Doku-Bilder und Design System im selben PR neu erzeugen (`docs/anwender/AGENTS.md`,
  `frontend/AGENTS.md` „Größere UI-Entwürfe über das Design System“).
- Bilder der Änderung (vorher/nachher) in PR und Meldung.

## Dem Builder überlassen

- Name und Ort der Touch-Feldregel und des Werts 16 (Teil 1), solange sie aus `theme/` kommen.
- Wie das Rail-Etikett im Test gemessen wird.
- Die Sichtung je Augenbraue (Feld oder Kopf) in Teil 2 und je `monoStil('meta')` (Wort oder
  Zahl) in Teil 4, nach den Regeln oben.
- Wie Platz geschaffen wird, wo eine e2e-Prüfung bricht, im Rahmen „nicht abschwächen“.

## Meine Wahl (zur Prüfung)

- Reihenfolge Zoom → Feldetikett → Boden → `meta`.
- Feldetikett 12 px / `gedaempft` (wie in #1427).
- Augenbraue Sperrung .08em, Rail-Etikett .04em (wie in #1427).
- `metaKlein` entfällt (fiele mit 11 ohnehin auf `meta`); `meta` bleibt 11 px, nicht 12.
- Neue Mono-Stufe `monoFein` 11 für Zahlen in Meta-Größe.
- Zwei neue ADRs (Teil 3 und Teil 4) statt einer, weil jede zum Stand ihres PRs passen muss.
- Touch-Feldregel mit `!important` auch gegen Inline-Größen (Teil 1).
- Ein Plan-Dokument, Abschnitt je Teil erst zu Beginn seines Branches.
