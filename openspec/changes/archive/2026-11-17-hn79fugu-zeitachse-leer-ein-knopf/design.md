# Design

## Context

`SnapshotLeiste` (`frontend/src/pages/lagekarte/SnapshotLeiste.tsx`) kennt heute drei Formen:
nichts (ohne Schreibrecht und ohne Stände), eingeklappt (ein Symbolknopf „Zeitachse einblenden“,
`bandStil('links')`) und das Band (`bandStil('voll', true)`, zwei Gruppen nach LFH-899). Ohne
Stände blendet das Band Abspielen, Schieber und Auswahl aus; übrig bleiben „Zeitachse
ausblenden“ und der Symbolknopf „Stand sichern“ in einem Band über die volle Breite. Ob das Band
ausgeklappt startet, entscheidet `startEingeklappt` (gemerkte Wahl, sonst eingeklappt unter `xl`).

Mehrere e2e-Tests (`lagekarte-smoke`, `lagekarte-touch`, `lagekarte-werkzeugmenue`,
`eingangsband-ausweichen`, Teile von `fokus-verdeckung`) brauchen das ausgeklappte Band als
Fuß-Band und laufen in Einsätzen ohne gesicherten Stand. Abgestimmt mit dem Menschen am
17.11.2026 (Zunder-Kommentar an LLH-1936).

## Goals / Non-Goals

**Goals:**
- Ohne Stände belegt die Zeitachse höchstens die Fläche eines Knopfs mit Wort.
- Der Knopf „Stand sichern“ erklärt sich überall durch sein Wort.

**Non-Goals:**
- Kein neuer Ort für „Stand sichern“ (Werkzeugmenü, Leiste).
- Keine Änderung an Wiedergabe, Auswahl „Stand“ oder Historien-Banner.
- Keine neue Klapp-Logik: die gemerkte Wahl bleibt, wie sie ist, und wird im Leerzustand weder
  gelesen noch überschrieben.

## Decisions

### D1 Leerzustand ist ein eigener Zweig vor der Klappwahl

Ist `darfSichern` wahr und gibt es keinen Stand, gibt `SnapshotLeiste` vor dem Zweig
`eingeklappt` einen einzelnen Knopf zurück: Kamera-Symbol, Wort „Stand sichern“,
`bandStil('links')`, Hintergrund und Schatten wie der Knopf „Zeitachse einblenden“, Stil
`default` (schwebt wie dieser über der Karte; ein `primary`-Knopf wäre auf der Karte das
lauteste Element). Er öffnet denselben Dialog. Kein Chevron: ohne Stand gibt es nichts zu
verbergen, und ein Ausblenden-Knopf neben einem einzigen Knopf hätte die Fläche fast verdoppelt.

- *Verworfen: Klappwahl beachten* (eingeklappt Uhr-Knopf, ausgeklappt Chevron plus Knopf in
  einem schmalen Band). Zwei Knöpfe und Polsterung, und der Uhr-Knopf verbirgt einen einzelnen
  Knopf hinter einem anderen.
- *Verworfen: Zeitachse entfällt, „Stand sichern“ ins Werkzeugmenü.* Meiste Kartenfläche, aber
  ein zweiter Ort für dieselbe Handlung, und die Funktion ist versteckt, bis jemand sie sucht.

### D2 Wort „Stand sichern“ auch im Band; die Gruppenbasis trägt es

Der Knopf im Band bekommt das Wort als Inhalt; der zugängliche Name ist dann sichtbarer Text
(die Hülle des Symbols bleibt `aria-hidden`), ein eigenes `aria-label` und der Tooltip mit
gleichem Text entfallen. `standBasis` in `bandStile` rechnet statt `controlHeight` die Breite des
Knopfs mit Wort je Dichtestufe (Konstante für Symbol, Lücke, Wort und Polsterung, an der
Staffel geprüft). Der Unit-Test „beide Gruppen passen im Fükw in eine Zeile, am Tablet nicht“
bleibt der Wächter dafür, `lagekarte-smoke` (Fükw eine Reihe) und `leisten-flaeche`
(höchstens zwei Reihen, Zielabstand) die Messung.

- *Verworfen: kurz „Sichern“* (spart Breite, aber zwei Namen für dieselbe Handlung und ein
  sichtbares Wort, das nicht am Anfang des zugänglichen Namens steht).
- *Verworfen: Symbol im Band* (die Aufgabe verlangt das Wort wie an den Kartenknöpfen).

### D3 Eigener Griff für den Leerzustand; e2e sichern einen Stand, wo sie das Band brauchen

Der Knopf trägt `data-lfh="zeitachse-sichern"`, nicht `data-lfh="zeitachse"`: Messungen über
das Band (Reihen, Nachgiebigkeit, Beschnitt) sollen nicht still einen Knopf messen. Tests, die
das ausgeklappte Band voraussetzen, sichern vorher per `POST /api/einsaetze/{id}/lage-snapshots`
einen Stand, wie es `lagekarte-smoke` und `fokus-verdeckung` an anderen Stellen schon tun. Ihre
Vorbedingung („Zeitachse ausblenden“ sichtbar) bleibt und wird rot, falls ein Stand fehlt.

### D4 Nach dem ersten Stand gilt die Klappwahl

Nach dem ersten Sichern entscheidet wieder `startEingeklappt`. Unter `xl` ohne gemerkte Wahl
erscheint also der Knopf „Zeitachse einblenden“; die Meldung „Stand gesichert“ bestätigt die
Handlung. Ein automatisches Ausklappen hätte am Handschirm ein Drittel der Karte belegt
(Grund der Vorgabe aus LFH-899).

## Risks / Trade-offs

- [Breiterer Knopf im Band drückt die Auswahl „Stand“ am Handschirm schmaler] → Auswahl ist
  `flex: 1 1 0, minWidth: 0` und kürzt mit Auslassung; `leisten-flaeche` misst Zielabstand und
  Reihen in `handschuh` bei 390 px.
- [Fükw-Einreihigkeit bricht durch die Wortbreite] → Unit-Rechnung vor dem Bau, Messung in
  `lagekarte-smoke` (1366 × 768).
- [e2e, die das leere Band still als Fuß-Band nutzten, werden rot] → Vorbedingungen sind
  vorhanden; jeder betroffene Test bekommt einen gesicherten Stand (Liste in tasks.md).
- [Nach dem ersten Sichern wechselt am Handschirm der Knopf zur Uhr] → bewusst (D4), Meldung
  bestätigt.
