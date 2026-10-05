# Proposal: Bild-Hintergründe der Lagekarte schwärzen (LFH-997)

## Why

`karte_hintergrundbild.daten` bleibt seit LFH-229 bei jeder Schwärzung als „Kartografie-Skelett“
erhalten; gescrubbt wird nur der Dateiname. Das trägt nur für gezeichnete Lagepläne. Ein
hochgeladenes Drohnen- oder Luftbild zeigt Personen, Kennzeichen und Hausansichten und fällt in
Niedersachsen unter § 32b Abs. 3 NKatSG („unverzüglich, spätestens nach zwei Monaten“ zu
löschen). Auch ein Plan kann Personenbezug tragen (eingescannter Objektplan mit Bewohnernamen,
Skizze mit „Familie Müller“), und genau darum wird der Dateiname schon heute geschwärzt. Heute
überdauert ein solches Bild die Schwärzung bis zur endgültigen Löschung des Skeletts, also
Jahre. Die Org-Einstellungen nennen beim Vorschlag für die Kategorie `anhaenge` schon die
Drohnenbild-Frist des NKatSG, die Kategorie erfasst Kartenhintergründe aber gar nicht.

## What Changes

- **Klassifikation:** Jedes Bild der Lagekarte wird bei der Schwärzung entfernt, ohne
  Unterscheidung nach Bildquelle (Option a des Tickets). Die Zeile wird ganz gelöscht; ein
  Datensatz mit Ecken, aber ohne Bild hat keinen Wert, und der SHA-256 wäre ein Fingerabdruck
  des gelöschten Bilds.
- **Zuordnung:** Die Bilder gehören zur Kategorie `anhaenge`. Eine Organisation mit kurzer
  Anhang-Frist (etwa 30 Tage nach NKatSG) erreicht damit auch die Kartenhintergründe; ohne
  Kategorie-Dauer folgen sie wie bisher der Einsatz-Frist.
- **Entfernung in Einzelschritten:** Wie bei Datei-Anhängen (bis 25 MB je Bild) löscht der
  atomare Vorgang die Bilder nicht selbst; sie sind ab dann nicht mehr abrufbar, und der
  Nachlauf löscht jedes Bild in einem eigenen Schreibvorgang. Die endgültige Löschung des
  Skeletts wartet auch auf diese Bilder.
- **Bestand:** Bilder schon geschwärzter Einsätze (und schon geschwärzter Kategorie `anhaenge`)
  entfernt der erste Purge-Lauf nach dem Update. **Unumkehrbar**, aber genau die Folge der neuen
  Klassifikation.
- **Text:** Die Beschreibung der Kategorie `anhaenge` in den Org-Einstellungen, im Frist-Paneel
  und in der Archivakte nennt die Bilder der Lagekarte.

Nicht gewählt: (b) Retain, weil ein Luftbild Personenbezug trägt und das Skelett Jahre lebt;
(c) Kennzeichnung der Bildquelle beim Upload, weil sie von der richtigen Auswahl im Einsatz
abhängt, ein Plan ebenfalls Personenbezug tragen kann und die Registry je Tabelle nur einen
Zeilenfilter kennt (Begründung in `design.md`, D1).

## Capabilities

### New Capabilities

Keine.

### Modified Capabilities

- `aufbewahrung`: neue Anforderung „Bild-Hintergründe der Lagekarte“; „Physische Entfernung
  geschwärzter Werte“ und „Entfernung der Datei-Inhalte in Einzelschritten“ schließen die Bilder
  ein.
- `aufbewahrung-kategorien`: Kategorie `anhaenge` umfasst die Bilder der Lagekarte;
  „Kategorie-Schwärzung“ entfernt sie mit.

## Impact

- Backend: `src/einsatz/schwaerzung_registry.rs` (Regel `karte_hintergrundbild`, Guard für
  `ZeileEinzelnLoeschen`), Nachlauf (`anhang::repo::entferne_vorgesehene` wird auf beide
  Tabellen verallgemeinert), `src/karte_hintergrundbild/repo.rs` (Lesewege übergehen
  vorgesehene Bilder), `src/einsatz/skelett_loeschung.rs` (Phase D wartet),
  `src/einsatz/purge_scheduler.rs` (Test, der den Erhalt des BLOBs festschreibt, kehrt sich um).
- Frontend: nur Text in `frontend/src/aufbewahrung/kategorieText.ts`.
- Keine Migration, keine API-Änderung, kein neuer Typ im Codegen.
- Lage-Stände (Rückblick) verweisen danach auf gelöschte Bild-IDs; das gibt es heute schon nach
  dem Entfernen eines Bilds im laufenden Einsatz.
