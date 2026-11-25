# Objekt aus einer Fremdebene übernehmen — Design

Stand: 25.11.2026 · LLH-2129
Zunder: https://zunder.rubeen.dev/#/aufgabe/vzxkonvuigfqz37jfifcq3gj
Bezug: `docs/superpowers/specs/2026-11-24-qe5jrctd-fremdebenen-design.md` (dort Nicht-Ziel,
hier die Folgeaufgabe).

## Absicht

Eine Fremdebene (LLH-2099/LLH-2100) zeigt fremde Geodaten nur lesend. Oft ist ein einzelnes
Objekt daraus aber Teil der eigenen Lage: das Gefahrengebiet des Nachbarkreises, die
Absperrlinie des THW, ein Sammelpunkt. Heute müsste man es von Hand nachzeichnen. Künftig
übernimmt man es mit einem Klick als **eigene Zeichnung des Einsatzes**, mit nachlesbarer
Herkunft im ETB.

## Ziele

- In der Detailkarte eines Fremdebenen-Objekts gibt es „Übernehmen“ (nur mit Schreibrecht an der
  Lagekarte, nicht in der Verlaufsansicht).
- **Fläche → Zone**, Art wählbar: Gefahrengebiet (vorausgewählt), Absperrbereich, Sperrgebiet,
  freie Skizze.
- **Linie → Linien-Zone**, Art wählbar: Absperrgrenze (vorausgewählt), freie Skizze.
- **Punkt → freies Zeichen**, Zeichen über den bestehenden `ZeichenWahlDialog`.
- **Mehrteilige Objekte** (MultiPolygon, MultiLineString, MultiPoint, gleichartige
  GeometryCollection) werden in Einzelobjekte aufgeteilt, beschriftet „Name (1/3)“ …
- **Herkunft im ETB**, vom Server geschrieben, im selben Schreibvorgang wie das Objekt.
- Das übernommene Objekt ist ein normales Objekt: keine Verbindung zur Fremdebene, es bleibt,
  wenn die Ebene entfernt wird, und lässt sich wie jedes andere bearbeiten und löschen.

## Nicht-Ziele

- Ganze Fremdebene auf einmal übernehmen.
- Evakuierungsbezirk als Ziel (braucht einen eigenen Bezirk).
- Linie als freies Zeichen, Kreis- oder Punktzone.
- Rückverweis vom Objekt auf die Fremdebene (Datenmodell bleibt unverändert, keine Migration).
- Fremde Stile/Farben übernehmen (eine freie Skizze bekommt die Vorgabefarbe).

## Anti-Ziele

- Kein frei wählbarer Text des Browsers in einem System-ETB-Eintrag: die Herkunft baut der Server
  aus der Fremdebene selbst.
- Normales Zeichnen ändert sich nicht: freie Zeichen ohne Herkunft schreiben weiter keinen
  ETB-Eintrag, Zonen-Texte ohne Herkunft bleiben wortgleich.

## Abgestimmt (Phase-1-Checkpoint, 25.11.2026)

Alle sieben Punkte des Vorschlags mit „passt“: Artwahl wie oben, Linie → Linien-Zone, Punkt →
freies Zeichen, Multi aufteilen, Herkunft serverseitig im selben Tx, Name → Beschriftung,
Herkunft und Beschreibung → Notiz (nur Zonen), Ziel ist die aktive Ansicht. Ein Gefahrengebiet
löst wie jedes neue die Benachrichtigung „Neue Gefahr“ aus.

## Ansätze

1. **Bestehende Anlege-Routen mit optionalem Herkunftsfeld (gewählt).** `POST …/zones` und
   `POST …/free-symbols` bekommen `fremdebene_id`. Der Server prüft, dass die Ebene zum Einsatz
   gehört, und hängt die Herkunft an den ETB-Text im selben Tx. Wenig neue Fläche, alle
   Prüfungen, Live-Verteilung und Benachrichtigung der Anlage gelten unverändert.
2. **Eigene Route `POST …/foreign-layers/{id}/features/{index}/adopt`.** Der Server liest die
   Geometrie selbst aus `karte_fremdebene_daten`. Verworfen: verdoppelt Zonen- und Zeichenanlage
   samt ETB, Gefahrengebiet-Gruppe und Benachrichtigung; der Gewinn (Geometrie nicht vom Client)
   zählt wenig, weil jeder mit Schreibrecht ohnehin beliebige Zonen zeichnen darf.
3. **Nutzer-ETB-Eintrag aus dem Browser (`erfasseEtb`).** Verworfen am Checkpoint: nicht atomar,
   steht als Nutzereintrag statt als Systemvermerk.

## Entwurf

### Backend

- `ZoneBody` und `freies_zeichen::AnlegenBody` bekommen `fremdebene_id: Option<i64>` (Feldname
  deutsch wie der übrige Body, `AGENTS.md`, „Bezeichner-Sprache“).
- Ist sie gesetzt: `karte_fremdebene::repo::laden(einsatz_id, id)`; fremde oder unbekannte Ebene
  → 404 (wie `ansicht_id`). Daraus ein Baustein
  `karte_fremdebene::herkunft_text(&Fremdebene) -> String`:
  `übernommen aus Fremdebene «Name», Datei` bzw. `…, von <host>` (Host, nie die ganze URL).
- **Zone:** ETB-Text wird `<bisheriger Text> (<herkunft>)`, z. B.
  `Gefahrengebiet «Brandfläche Nord» eingerichtet (übernommen aus Fremdebene «Lage Kreis X», Datei)`.
- **Freies Zeichen:** nur mit `fremdebene_id` wird die Anlage zu einem Tx mit
  `etb::system_audit_tx` (Muster der Zonen-Route, `write_retry!`, `etb_startwert`), Text
  `Freies Zeichen «Label» übernommen aus Fremdebene «…», Datei` (ohne Label
  `Freies Zeichen übernommen aus …`); danach `etb_verteilen` und SSE. Ohne `fremdebene_id`
  bleibt der Weg wie heute.
- Länge: Name ≤ 120 und Label begrenzt, der Text bleibt weit unter `etb::INHALT_MAX`; der neue
  Weg prüft die Grenze trotzdem selbst (`src/AGENTS.md`).
- Typ-Codegen nur, falls Request-Typen generiert werden (`scripts/check-typ-codegen.sh`).

### Frontend

- **Klick:** `Kartenflaeche` gibt beim Fremdebenen-Klick zusätzlich den Feature-Index weiter
  (MapLibre-`id` = Index dank `generateId: true`); `LagekartePage` merkt sich
  `{ebeneId, properties, index}` und reicht `daten.features[index]` (volle Geometrie, nicht die
  gekachelte aus `queryRenderedFeatures`) und `darfSchreiben` an `FremdebeneDetail`.
- **Zerlegen** in einer reinen Funktion (`fremdebeneUebernahme.ts`): Geometrie → Liste
  `{art: 'flaeche'|'linie'|'punkt', geometrie}`. Multi* und gleichartige GeometryCollection
  werden aufgeteilt; gemischte Collection → nicht übernehmbar (Knopf deaktiviert, Tooltip).
  **Höchstens 20 Teile** (meine Festlegung, damit ein MultiPoint nicht 500 Zeichen anlegt);
  darüber deaktiviert mit Hinweis.
- **Dialog „Übernehmen als …“** für Fläche/Linie: Auswahl der Zonenart aus `ZONE_TYPEN` (einzige
  Quelle, `lagekarte/AGENTS.md`), gefiltert nach Geometrie. Für Punkte direkt
  `ZeichenWahlDialog`.
- **Anlegen:** je Teil nacheinander `legeZoneAn` bzw. `legeFreiesZeichenAn` mit
  `fremdebene_id`, `ansicht_id` der aktiven Ansicht, Label = Objektname (bzw. Ebenenname, wenn
  keiner), bei mehreren Teilen ` (i/n)`; Notiz (Zonen) = `Übernommen aus Fremdebene «…».` +
  Leerzeile + Beschreibung, auf die Notiz-Grenze gekürzt. Freie Skizze mit
  `FREIE_SKIZZE_VORGABEFARBE`. Danach Invalidierung wie beim normalen Zeichnen, Detailkarte
  schließen, Erfolgsmeldung „n Objekte übernommen“. Ein Fehler (z. B. 422: zu viele Ringe)
  bricht ab und meldet, wie viele schon angelegt sind.

### Tests

- Rust: Zone mit `fremdebene_id` → ETB-Text mit Herkunft; fremde Ebene → 404; freies Zeichen mit
  `fremdebene_id` → System-ETB-Eintrag, ohne → keiner; Zone ohne Feld → Text unverändert.
- Vitest: Zerlegen (alle Geometriearten, Löcher erhalten, gemischt, > 20 Teile); Detailkarte
  zeigt Knopf nur mit Schreibrecht; Dialog ruft die Anlage mit richtigem Body.

## Dem Bauenden überlassen

- Genaue Form des Dialogs (Modal oder Popover), im Stil der vorhandenen Lagekarten-Dialoge.
- Ob die Mehrfach-Anlage einen Fortschritt zeigt.
- Anwenderdoku: Abschnitt im Fremdebenen-Kapitel ergänzen, falls `docs/anwender/AGENTS.md` es
  verlangt.
