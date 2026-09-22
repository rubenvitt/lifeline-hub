# Neuentwurf „Instrumententafel“ — Umsetzungsgrundlage (21.09.2026)

Quelle: Claude-Design-Projekt „App-Design Überarbeitung“, hier abgelegt als
`neuentwurf.dc.html` (Systemkarte S1 + Screens S2–S7) und `shell.dc.html` (Rahmen).
Die Dateien sind inline-gestyltes HTML; die Beispieldaten stehen in `renderVals()` am
Dateiende. **Maßgeblich sind die Inline-Styles dieser beiden Dateien.** Das mitgelieferte
`_ds/…/tokens/*.css` beschreibt den ALTEN antd-v5-Stand (Radius 4, Systemschrift, Rot als
Primärfarbe) und wird ausdrücklich NICHT übernommen.

Das Projekt hat die Richtung schon (LFH-352 „E · Lagekarte nachts“: dunkel, Radius 0,
Archivo/JetBrains Mono, Bedienfarbe blau). Der Neuentwurf ist deshalb keine neue
Grundlage, sondern: neutralere, tiefere Palette · Nachtbetrieb als Vorgabe · neuer
Shell-Rahmen · neue Bausteine · neu gedachte Screens.

## Entscheidungen des Auftraggebers (verbindlich)

1. **Nachtbetrieb ist die Vorgabe.** Ohne gespeicherte Wahl startet die App dunkel
   (nicht mehr `system`). Der Umschalter bleibt; die Hell-Palette wird passend zu den
   neuen neutralen Tönen **abgeleitet** (gleiche Rollen, Kontrast mind. wie bisher).
2. **Bei Konflikten mit bestehenden Regeln gewinnt das Design — außer bei der Sichtung.**
   - Sichtung bleibt BBK: SK I rot, II gelb, III grün, IV blau, tot schwarz, unverletzt
     ohne Farbe (`SichtungsTag`, `sichtungsfarben`). Die Design-Farben (II orange,
     III gelb, IV grau) werden NICHT übernommen.
   - Übernommen werden dagegen: **Status als getönte Fläche mit getöntem Text**
     („Ampel als Fläche, Zahl bleibt lesbar“), **roter 2-px-Marker an der aktiven
     Rail-Kategorie** (Rot = Marke), **ETB-Typfarben** Meldung blau, Anordnung orange,
     Entscheidung violett, Lage cyan, Berichtigung rot, System neutral — als **farbige
     Kante + Typwort**, nicht als Etikett, **Glyphen ⧖ (nachgetragen) und ↗
     (Deeplink)** als Textzeichen. Betroffene Regeln, Guards und Tests werden
     angepasst, CLAUDE.md wird fortgeschrieben.
   - Weiterhin gilt: **Rot bedient nichts** — primäre Schaltflächen sind blau
     (`#4d94d6`, Text `#08090b`). Zweiter Kanal (Wort/Zahl/Kürzel) bleibt Pflicht.
3. **Die UI wird neu gedacht**, nicht nur umgefärbt:
   - neue Seite **Führung · Überblick** (S2) und sie ist die **Startseite** eines Einsatzes;
   - **Meldebild** (heutige Kräfteübersicht) wandert unter **Kräfte & Mittel**;
   - das **ETB ist eine Zeitachse** auf allen Breiten, Schnellerfassung **unten**,
     Seitenleiste „Tagesbilanz“ (Regeländerung zu `tabelleAb="xl"`).
4. **Keine erfundenen Daten.** Was keine Datenquelle hat, wird weggelassen (nicht als
   Platzhalter gebaut) und als ClickUp-Task erfasst. Der Pegel ist seit LFH-606 da (Platz 1
   im Kennzahlenband statt „Höchste Warnstufe", Entscheidung 22.09.2026), der erwartete
   Höchststand seit LFH-628 (Zusatz in der Kennzahl, Marke im Überblick). Bekannte Lücken:
   Evakuiert,
   Fortschritt je Abschnitt, Abschnittsfarbe, FMS-Status/„Seit“/Rückmeldung je Einheit,
   „keine Rückmeldung“, ETB-Lesemarke „seit Ihrer letzten Sichtung“, ETB-Gesamtzahl und
   Tagesbilanz-Summen (serverseitig), Folgeauftrag-Verweis am ETB-Eintrag (geschlossen
   mit LFH-636), Funktion des Nutzers (nur Sachgebiete vorhanden), Satellit-Basemap,
   Messwerkzeug. Geschlossen seit LFH-613: Zustand und Fundort-Koordinate an der Person,
   strukturierter Verbleib (mit Notunterkunft), „vermisst seit“ — samt Ansicht „Karte“ der
   Betroffenen, „Transportiert / offen“ und „Vermisste – n seit über 4 h“.

## Palette Nachtbetrieb (aus den Inline-Styles)

| Rolle | Wert | Verwendung im Entwurf |
|---|---|---|
| grund | `#08090b` | Seitengrund, Inhaltsfläche |
| kopf / rail | `#0c0e11` | Kopfzeile 52 px, Rail 60 px, Tabellenkopf, Erfassungsleiste |
| paneel | `#0a0c0e` | Modulpanel, Seitenleisten, Kachel-Paneele |
| flaeche | `#0f1215` | Kennzahl-Zellen, Karten |
| flaeche2 | `#14171b` | Eingabefelder, aktive Segmente, aktive Modulzeile |
| flaeche3 | `#16191d` | aktive Rail, leere Balkenspur, Zeilentrenner |
| linie | `#22262b` | Haarlinien, Paneelrahmen |
| linieStark | `#2e343a` | Steuerrahmen, sekundäre Knöpfe |
| text | `#e8ebee` | Primärtext, Datenwerte |
| text2 | `#c6ccd2` / `#dfe4e9` | Lauftext in Listen |
| gedaempft | `#9aa2ab` | Sekundärtext, Mono-Meta |
| schwach | `#5f676f` | Augenbrauen, Tertiärtext |
| bedien | `#4d94d6` (Hover `#7db3e8`) | Primärknopf, Fokus, aktive Modulmarke, Links |
| marke | `#a8071a` | Logo-Quadrat, aktive Rail-Marke, SK-I-Balken, akut |
| alarm (Text) | `#ff6b6b` | überfällig, Ausfall |
| achtung (Text) | `#e8cc3a` | Warnstufe hoch, Anfahrt |
| normal | `#52c41a` / Text `#7ddc4a` | einsatzbereit, SYNC |
| bedien-Text auf Fläche | `#8ec2f0` | gebunden/Einsatzort |
| Statusflächen | normal `#0d1a0a` · achtung `#1c1705` · alarm `#1c0a0d` · bedien `#0d1620` | Statuszelle/Status-Chip |
| Banner bedien | Grund `#0d1520`, Linie `#1d3a5c` | Sammelbanner |
| ETB-Typ | Meldung `#1677ff` · Anordnung `#d46b08` · Entscheidung `#722ed1` · Lage `#13c2c2` · Berichtigung `#cf1322` (Zeile `#160d0f`) | Typkante 2 px + Typwort |
| Warnstufe | niedrig `#d4b106` · mittel `#d46b08` · hoch `#cf1322` · akut `#a8071a` | Gefahrenmatrix-Balken |

Werte, die in Nachtmodus- und Hellfassung existieren müssen, gehören als Rollen nach
`theme/tokens.ts` + `theme/rollen.css` (Gate 5: keine Hex-Literale außerhalb `theme/`).

## Form & Typografie

- Radius 0 überall. Trennung über Haarlinien; Raster aus Zellen mit `gap:1px` auf
  Linienfarbe („Fugenraster“).
- Archivo 400/500/600, JetBrains Mono 400/500 (fehlende Schnitte lokal nachliefern, kein CDN).
- Skala: Überschrift 30 · Seitentitel 14/600 · Datenwert 22–40 Mono 500 · Text 12–14 ·
  **Augenbraue 10 px, 600, Versalien, Sperrung .12–.14em, Farbe schwach**.
- Zahlen, Zeiten, Funkrufnamen, Koordinaten, Nr. immer Mono (`tabular-nums`).
- Dichte-Staffel 30/48/72 bleibt (Gate 3). Die 22/30/46 des Entwurfs sind Skizze.

## Rahmen (shell.dc.html)

- Kopf 52 px `#0c0e11`: Markenzelle 60 px (Quadrat 14 px marke) · Wortmarke
  `lifeline-hub` Mono 12 · Statuspunkt + Einsatznummer (Mono) + Einsatzname ·
  Suchfeld (max 520, „Modul, Einheit, Meldung, Koordinate …“, ⌘K) · SYNC-Anzeige ·
  Uhr Mono 14 · Initialen + Funktion.
- Rail 60 px: Ikone 20 + Etikett 9 px Versalien darunter, Zeile 62 px; aktiv: Fläche
  `#16191d`, Text hell, 2-px-Marke links in **marke**. Einstellungen unten abgesetzt.
- Modulpanel 208 px `#0a0c0e`: Kopf 42 px Augenbraue; Zeilen 34 px (Dichte-Boden
  beachten), 2×16-px-Marke in bedien bei aktiv, Zähler Mono rechts; Fuß „Einsatzdauer“
  Mono 18.
- Seitenkopf 44 px, Rinne 24: links Breadcrumb bzw. Titel 14/600 + Mono-Meta, rechts
  Aktionen (sekundär umrandet, primär blau gefüllt, 28 px Skizze → Staffel).
- Sprungpalette (⌘K): Maske `rgba(5,6,8,.72)`, 640 breit, 120 px von oben, Rahmen
  bedien, Kopf 52 mit Suchikone blau + ESC, Gruppen-Augenbraue, Zeile 38 mit Ikone ·
  Label · Kontext · Taste, Fußzeile mit Hinweisen.

## Bausteine (S1 „Neue Bausteine“ + wiederkehrende Muster)

- **Kennzahl-Kachel**: Augenbraue · Zahl Mono groß · Einheit Mono klein · Notiz ·
  optional Aufgliederungsbalken (2 px Fugen) + Mono-Legende. Zahl führt.
- **Kennzahlenband**: n Zellen im Fugenraster.
- **Paneel**: Rahmen linie, Grund paneel, Kopf 36–38 px mit Augenbraue links und
  Mono-Meta rechts, Zeilen mit Trenner `#16191d`.
- **Zeitachsen-Eintrag**: Zeit Mono (+ Nr.) · 2-px-Typkante · Typwort Mono Versalien in
  Typfarbe + Meta · Text · Hinweiszeile · rechts Verfasser/Weg.
- **Statuszelle / Status-Chip**: getönte Fläche + getönte Zahl/Code + Wort.
- **Balken** (Fortschritt/Anteil): 4–6 px, Spur `#16191d`.
- **Segmentleiste**: Segmente im Fugenraster, aktiv flaeche2 + text, optional Farbpunkt.
- **Schnellerfassungszeile**: Feld mit Rahmen bedien, Mono-Befehl `/typ` in bedien,
  Hinweiszeile Mono darunter; `@` Einheit, `#` Koordinate. Die Erfassungs-Norm
  (Enter sendet, Offline-Queue mit `client_id`, Sichtung im selben POST) gilt weiter.
- **Sammelbanner**: Grund bedien-dunkel, Pfeilikone, Text, rechts Mono-Aktion.

## Module aus dem Entwurf ohne Gegenstück (LFH-620, 22.09.2026)

Das Modulpanel des Entwurfs führt acht Module, die es in der App nicht gab. Entscheidung je Modul:

| Modul | Entscheidung | Umsetzung |
|---|---|---|
| Entscheidungen (Führung) | Sicht auf vorhandene Daten | Sprungmarke → ETB `?typ=entscheidung`. Der Folgeauftrag-Verweis steht seit LFH-636 am ETB-Eintrag (Wire `folgeauftraege`, Zeitachse „Folgeauftrag Nr. … ↗“, Zähler im Überblick); ob eine eigene Übersicht (Beschlusslage mit Umsetzungsstand) die Sprungmarke ersetzt, ist neu zu entscheiden |
| Patienten (Erfassung) | Sicht auf vorhandene Daten | Sprungmarke → Personen `?ansicht=raster` (Sichtungsraster, „Patient" = SK I–IV/tot, `istPatient`) |
| Vermisste (Erfassung) | Sicht auf vorhandene Daten | Sprungmarke → Personen `?filter=vermisst` (inkl. Abgleich). „vermisst seit" gibt es seit LFH-613 (Dashboard-Notiz „n seit über 4 h") |
| Dokumente (Führung) | Fachmodul, hier verworfen | Folgetask LFH-632 (Dokumentenablage) |
| Wetter & Pegel (Lage) | Fachmodul nach LFH-606 | Folgetask LFH-633, wartet auf LFH-606 |
| Prognose (Lage) | kein eigenes Modul | geht in LFH-628 (Pegelprognose/Höchststand) und LFH-633 auf |
| Verpflegung (Kräfte) | Fachmodul, hier verworfen | Folgetask LFH-634 |
| Ablösung (Kräfte) | Fachmodul, hier verworfen | Folgetask LFH-635 |

Eine Sprungmarke ist **kein Modul** (`frontend/src/einsatz/sprungmarken.ts`). Sie erbt Sichtbarkeit und Sperre ihres Zielmoduls, ist nie `aria-current` und trägt keinen Zähler, weil es für 7/144/9 keine Quelle gibt (LFH-612).

## Einheitenstatus und „Seit“ (LFH-609, 22.09.2026)

Die Lücke „FMS-Status/„Seit“ je Einheit“ ist geschlossen. Die Entscheidung des Auftraggebers:

- Der Status einer Einheit wird **aus ihren Fahrzeugen abgeleitet**, und zwar serverseitig
  (`einheit::repo::leite_status_ab`). Tragen alle Fahrzeuge denselben Status, gilt er.
  „Seit“ ist dann der jüngste Wechsel und bleibt leer, sobald ein Fahrzeug keinen
  Zeitpunkt kennt. Sonst gilt **„gemischt“** mit Verteilung („1× S3 · 2× S4“) und ohne „Seit“.
- Eine Einheit **ohne Fahrzeug** führt ihren Status **von Hand**
  (`PUT …/einheiten/{eid}/status`, mit Fahrzeug 422).
- Das Fahrzeug trägt `status_seit`. Er springt nur bei einem echten Wechsel. Bestandszeilen
  bleiben leer, weil ein nachgefüllter Wert erfunden wäre.
- Im Meldebild zählen die Kacheln Einheiten je Status wie im Entwurf S6. Die Zeile zeigt
  Status und „Seit“, die Verteilung der Mittel steht als eigene Spalte „Mittel“ (ab `xl`).
  Auf der Lagekarte zeigt „Ausgewählt“ Status und „Seit“. Im Überblick zählt das Raster je
  Abschnitt die Einheiten nach der Kategorie ihres Status.
- Nicht Teil davon: das FMS-Tableau (LFH-642), die Rückmeldung bzw. „keine Rückmeldung“
  (LFH-610) und der Funkrufname der Einheit (LFH-614).

## Rückmeldung je Einheit und Abschnitt (LFH-610, 22.09.2026)

Die Lücke „Rückmeldung je Einheit“ / „keine Rückmeldung“ ist geschlossen. Entscheidungen des
Auftraggebers:

- Eine Meldung kann an **eine Einheit oder einen Einsatzabschnitt** gebunden werden
  (`meldung.einheit_id`/`abschnitt_id`, höchstens einer, `ON DELETE SET NULL`). Der Freitext
  `absender` bleibt Pflicht und trägt den Namen zum Eingangszeitpunkt.
- **Als Rückmeldung zählt jede gebundene Meldung**, gleich welcher Meldungsart. Maßgeblich ist
  die jüngste Ereigniszeit.
- **Rückmeldefrist 60 Minuten**, überschreibbar je Organisation und je Einsatz
  (`rueckmeldung_frist_min`). Ist die letzte Rückmeldung älter, steht die Zeit in `achtung`.
- Die Kachel **„keine Rückmeldung“ zählt nur Einheiten, von denen nie eine kam** („—“ in
  `alarm`); eine überfällige Einheit hat zurückgemeldet und zählt nicht mit.
- Quelle ist `GET …/meldungen/rueckmeldungen` (Lesezugriff Meldungen). Ohne dieses Recht
  entfällt die Spalte im Meldebild — es gibt kein falsches Rot.
- Eine Zuordnung zu einer inzwischen aufgelösten oder fremden Einheit wird beim Anlegen zu
  „ungebunden“ herabgestuft statt abgelehnt: sonst fiele eine offline erfasste Meldung samt
  ETB-Eintrag in die abgelehnten Aktionen.
- Die Lagekarte zeigt „Letzte Meldung“ im taktischen Zeitformat (`1411`) wie der Rest des
  Paneels, nicht `14:11` wie im Entwurf.
