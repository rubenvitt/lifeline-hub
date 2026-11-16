# Design

## Context

- `verdichte` (`src/routes/lagemonitor.rs`) trägt drei Abrufe: den gekoppelten Lagemonitor
  (`GET …/lagemonitor`, Antwort `LagemonitorAnzeige` direkt), das Lagebild für Externe und
  `GET /api/v1/lage`. Die beiden letzten bauen ihre Karte über `load_karten_features` aus
  ausgewählten Feldern (`KartenFeatureArt::Zone { id, typ }`), die Form ist Byte für Byte
  gepinnt (`karte_des_lagebilds_bleibt_byte_fuer_byte`). Ein neues Feld an `LagemonitorZone`
  erreicht sie also nur, wenn jemand es dort ausdrücklich aufnimmt.
- `LagemonitorZone` ist heute `{ id, typ, geometrie }`. Die Begründung (LLH-1153): `/zonen` trägt
  Beschriftung und Notiz als Freitext; der Monitor ist für Wände ohne Personenbezug gedacht.
- Warnstufe und Beurteilung hängen nicht an der Zone, sondern am Gefahrengebiet
  (`gefahrengebiet`, Matrix in `gefahr_bewertung`, Zone über `lage_zone.gefahrengebiet_id`).
  `gefahr::repo::gebiete_liste` liefert je Gebiet `label`, `zonen_ids`, `hoechste_warnstufe` und
  `beurteilt_at` (dazu `beurteilt_von_name`, einen Personennamen).
- Die Lagekarte färbt eine Zone mit Gebiet über `gefahrengebietStil(warnstufe, token)`
  (`warnstufeKarte`: niedrig/mittel → achtung, keine/hoch/akut → alarm) und beschriftet über
  `zonenBeschriftung`; eine Gefahrengebiet-Zone ohne Gebiet behält `zoneStil` und nur ihren Namen.
- Der Monitor zeigt Abschnittsflächen schon mit DOM-Marken in 28 px (`LagemonitorKarte`,
  `flaechen.marken`), weil die Symbol-Ebene der Lagekarte 10 px setzt.
- Die Kachel „Belegung“ sortiert nach `belegt` absteigend und zeigt höchstens sechs Stellen; die
  UHS-Marke der Karte zeigt `Name · belegt`. Dieselbe Karte nutzt das Lagebild für Externe
  (`extern/lagebildKarte.ts` baut `LagemonitorZone` und `LagemonitorUhs` aus der Feature-Form).

## Goals / Non-Goals

**Goals:**

- Ein Gefahrengebiet ist an der Wand nach Name und Stufe lesbar, ohne den Monitor-Endpunkt zu
  verlassen und ohne Freitext der Zone.
- Eine überbelegte UHS ist auf beiden Wegen (Kachel und Karte) als Alarm erkennbar, mit Wort
  und Farbe.

**Non-Goals:**

- Kachel „Achtung“, Abschnittszustände, Überfälliges (LLH-1743).
- Beschriftete Zonen im Lagebild für Externe und in `GET /api/v1/lage`: deren Kartenform bleibt
  gepinnt; ob Externe die Stufe sehen sollen, ist eine eigene Entscheidung.
- Ein Zustand „voll“ (Belegte = Plätze): steht nicht im Auftrag.

## Decisions

### D1 Gebietsangaben als optionales Unterobjekt `gebiet` an der Zone

`LagemonitorZone` bekommt `gebiet: Option<LagemonitorGefahrengebiet>` mit `bezeichnung:
Option<String>` (Label des Gebiets), `warnstufe: gefahr::Warnstufe` und `bestaetigt: bool`
(`beurteilt_at` gesetzt). Gesetzt nur bei Typ `gefahrengebiet` mit zugeordnetem Gebiet. Gelesen
über `gefahr::repo::gebiete_liste` (ein Abruf je Verdichtung, dieselbe Rang-Regel wie überall),
der Name des Beurteilenden wird nicht übernommen.

- *Verworfen: flache Felder `warnstufe`, `bestaetigt`, `gebiet_bezeichnung` an jeder Zone.* Für
  Absperrungen wären alle drei leer; das Unterobjekt sagt „gehört zu keinem Gebiet“ mit einem
  Feld, und der Client fragt eine Stelle.
- *Verworfen: eigener SQL-Join in `verdichte`.* Er wiederholte die Rang-Regel der Matrix
  (`akut` 4 … `keine` 0); `gebiete_liste` ist die eine Stelle.
- Feldname `bezeichnung` statt `label`: der Pin `lagemonitor_zeigt_gefahrenzonen_und_abschnittsflaechen`
  verbietet den Schlüssel `"label"` in der Antwort, weil er der Freitext der Zone ist. So bleibt
  der Pin scharf, und das Wort entspricht `LagemonitorAbschnitt.bezeichnung`.

### D2 Beschriftung als DOM-Marke, Text aus einer reinen Funktion

`lagemonitorFlaechen.ts` liefert neben den Abschnittsmarken Zonenmarken `{ id, text, rolle,
lat, lon }`: Text „<Bezeichnung oder ‚Gefahrengebiet‘> · <warnstufeKarte[stufe].label>“, bei
`bestaetigt = false` „ · unbestätigt“ (`UNBESTAETIGT` aus `pages/gefahren/beurteilung.ts`);
Absperrbereich, Absperrgrenze und Sperrgebiet `zoneTypLabel(typ)`; eine Gefahrengebiet-Zone ohne
`gebiet` „Gefahrengebiet“ ohne Stufe (wie die Lagekarte: ohne Gebiet keine Stufe). Ort: Schwerpunkt
des Polygons (`polygonZentroid`), bei einer Linie die Mitte zwischen ihren mittleren Stützpunkten. Die Karte zeichnet sie
wie die Abschnittsmarken in `schrift` (28 px am Monitor), Rand in der Rolle der Stufe
(`rollenFarbe`), Text in `rollen.text`.

- *Verworfen: Symbol-Ebene `zonen-label` der Lagekarte mit größerer Schrift.* Sie ist für 10 px
  mit Plakette gebaut und wird mit der Lagekarte geteilt; eine Monitor-Größe dort wäre ein
  Sonderfall in fremdem Code. DOM-Marken gibt es am Monitor schon.
- Mehrere Zonen desselben Gebiets tragen je eine Marke. Das ist der Ist-Stand der Lagekarte
  (je Zone ein Label) und hält die Zuordnung „diese Fläche ist gemeint“ eindeutig.

### D3 Farbe wie die Lagekarte

Hat eine Zone `gebiet`, nimmt `baueMonitorFlaechen` den Stil aus `gefahrengebietStil(warnstufe,
token)`; sonst `zoneStil(typ, null)` wie bisher. Den Token reicht `LagemonitorKarte` aus
`useRollen()` hinein, damit die Funktion rein bleibt (wie `useLagekarteDaten`).

### D4 Überbelegung: eine Regel, drei Stellen

`istUeberbelegt(u) = u.plaetze > 0 && u.belegt > u.plaetze` in `lagemonitorFlaechen.ts` (rein,
getestet). Die Kachel sortiert überbelegte zuerst, dann wie bisher nach `belegt` und Name, damit
eine kleine überbelegte Stelle nicht hinter „+n weitere“ verschwindet. Die Zahl nutzt die
vorhandene Alarmfläche von `Zahl` (`hervorgehoben`, ohne die 60-s-Frist: sie gilt, solange die
Lage es ist), die Titelzeile `zusatz` = „n überbelegt“ mit `zusatzAlarm`. Die Kartenmarke zeigt
`Name · belegt/plaetze` (ohne Plätze `Name · belegt`), überbelegt auf `rollen.alarmFuellung` mit
Rand und Text in `rollen.alarmText` (dieselbe Alarmfläche wie die Zahl in der Kachel).

- *Verworfen: „8 von 5 Plätzen“ ausgeschrieben* (Abstimmung 16.11.2026): bei 72 px nur in zwei
  Spalten mit vier Stellen.
- `hervorgehoben` wird an der UHS-Zahl gesetzt (`ja`/`nein`), damit Test und e2e die Alarmrolle
  über `data-hervorgehoben` lesen wie bei SK I.

### D5 Lagebild für Externe

`extern/lagebildKarte.ts` setzt kein `gebiet`: die Zonen dort bleiben unbeschriftet und im
statischen Stil, wie heute. Die UHS-Marke mit `belegt/plaetze` und Alarmrolle gilt dort mit,
weil die Feature-Form `plaetze` schon trägt; das ist dieselbe Information wie in der UHS-Liste
dieser Seite und kein neues Feld.

## Risks / Trade-offs

- [Viele Zonen → viele 28-px-Marken überdecken die Karte] → Monitor-Einsätze haben wenige
  Gefahrenzonen; die Marken stehen wie die Abschnittsmarken ohne Bedienung. Wird es eng, ist das
  ein Folgeticket, kein Grund für kleinere Schrift (Großbild-Regel).
- [Bezeichnung des Gefahrengebiets ist Freitext und könnte einen Namen tragen] → Abstimmung
  16.11.2026: sie hat denselben Rang wie die Abschnittsbezeichnung und steht schon im System-ETB;
  der Freitext der Zone (Beschriftung, Notiz) bleibt draußen, gepinnt im Server-Test.
- [`gebiete_liste` lädt `beurteilt_von_name` mit] → wird in `verdichte` verworfen; der Pin prüft,
  dass der Name nicht in der Antwort steht.
- [Neue Marken ändern Markerzahlen in e2e und Bildlauf] → `geraet-lagemonitor.spec.ts` und
  `lagemonitor.bilder.ts` zählen Marken; beide werden im selben Schritt nachgezogen.

## Migration Plan

Keine Datenmigration. Ein älterer Client ignoriert `gebiet`; ein neuer Client gegen einen älteren
Server bekommt kein `gebiet` und zeigt die Zonen wie bisher.
