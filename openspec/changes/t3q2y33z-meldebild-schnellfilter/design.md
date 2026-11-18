# Design

## Context

Das Meldebild (`pages/KraefteuebersichtPage.tsx`) filtert in einem Zug über `filtereKraefte`
(`kraefte/kraeftebild.ts`): Das Ergebnis `gefiltertRoh` speist das Raster
(`baueMeldebildRaster`), das Statusband (`einheitBand`, `personalBand`), die Verdichtung der
Auswahlzeile, den Lagebericht-Text und den Druck. Die bisherigen Filter treffen die Mittel; die
Einheiten filtert nur der Abschnitt. Aufträge (`auftraegeQuery`, nur offene) und Rückmeldungen
(`rueckmeldungenQuery`) ruft die Seite schon ab, je mit eigenem Abrufzustand
(`zustandNachFreigabe`: `daten`, `laden`, `fehler`, `gesperrt`). Ob eine Einheit einen Auftrag hat,
liefert `offeneAuftraegeJeEinheit`, den Zustand der Rückmeldung `rueckmeldungZustand` gegen die
Seitenuhr (`useJetzt`). Abgestimmt am 18.11.2026: Schalter im Filter-Menü, „überfällig“ schließt
„nie zurückgemeldet“ ein, alles folgt der Auswahl.

## Goals / Non-Goals

**Goals:**
- Die zwei Einheiten-Filter wirken an derselben Stelle wie die übrigen, damit Statusband,
  Lagebericht und Druck ohne Sonderweg folgen.
- Fehlende Daten machen nie einen falschen Treffer.

**Non-Goals:**
- Kein Sortieren oder Spaltenfilter in der Tabelle (`VOLLMENGE_PFLICHT` bleibt).
- Kein Deeplink-Parameter für die Schalter, kein Merken über einen Seitenwechsel.
- Keine Änderung an der Einheitenliste, am Überblick oder an der Kennzahl „keine Rückmeldung“
  (sie zählt weiter nur die nie zurückgemeldeten und springt in die Meldungen).

## Decisions

**D1 Treffer als Menge von Einheiten-IDs, berechnet vor `filtereKraefte`.** Eine reine Funktion
`einheitenTreffer({ einheiten, ohneAuftrag, rueckmeldungFehlt, auftraege, rueckmeldungen, jetzt })`
in `kraefte/meldebildRaster.ts` liefert `null` (kein wirksamer Einheiten-Filter) oder die Menge der
zutreffenden aktiven Einheiten. `filtereKraefte` bekommt sie als optionales drittes Argument und
beschränkt Einheiten und Mittel darauf. Alternative: das fertige Raster nachträglich beschneiden.
Verworfen, weil dann Statusband, Verdichtung und Lagebericht eigene Wege bräuchten und die
Kumulierung der Stärke über den Baum nicht mehr stimmte.

**D2 Die Schalter stehen in `FilterWerte`** (`ohneAuftrag: boolean`, `rueckmeldungFehlt: boolean`),
`LEERER_FILTER` setzt beide `false`. So greifen Marken (`aktiveFilterChips`), Einzel-Entfernen,
„Filter zurücksetzen“, der Einsatzwechsel und `gefiltert` (Zulauf aus, Auswahl im Druckkopf)
ohne eigenen Zustand. `filterZahl` zählt sie mit.

**D3 Obereinheit als Rahmen.** Trifft eine Untereinheit, nicht aber ihre Obereinheit, bleibt die
Obereinheit in `einheiten` (sonst rückte die Gruppe als eigene Wurzel heraus und verlöre ihren
Abschnitt), ihre eigenen Mittel aber fallen weg. `filtereKraefte` unterscheidet dazu Treffer
(Mittel bleiben) und Rahmen (nur die Zeile). Statusband und Auswahlzeile zählen nur Treffer:
`einheitBand` bekommt die Treffer-Einheiten statt `gefiltertRoh.einheiten`, die Auswahlzeile zählt
Einheitenzeilen mit ID in der Treffermenge. Mittel ohne Einheit („Ohne Einheit“) fallen weg, weil
sie zu keiner zutreffenden Einheit gehören. Alternative: Obereinheit mit allen Mitteln zeigen.
Verworfen, weil dann Kräfte einer Einheit mit Auftrag unter „ohne Auftrag“ mitzählten.

**D4 Nicht lesbare Quelle filtert nicht.** Ist der Abrufzustand der Aufträge bzw. Rückmeldungen
nicht `daten`, zählt der zugehörige Schalter für `einheitenTreffer` als nicht gesetzt; sind dann
beide unwirksam, ist das Ergebnis `null`. Im Menü ist der Schalter deaktiviert, der Grund steht
daneben („Aufträge nicht freigegeben“, „Aufträge laden …“, „Aufträge nicht abrufbar“, ebenso für
Rückmeldungen). Eine gesetzte, unwirksame Marke trägt den Zusatz „wirkt gerade nicht“. Ein leeres
Ergebnis aus fehlenden Daten wäre die Behauptung „keine Einheit ohne Auftrag“ bzw. „alle ohne
Rückmeldung“, beides falsch (gleiche Regel wie in `rueckmeldungDerZeile`).

**D5 Seitenuhr.** `einheitenTreffer` nimmt `jetzt`; der `useMemo` von `gefiltertRoh` hängt nur
dann an `jetzt`, wenn „Rückmeldung fehlt oder überfällig“ wirksam ist, damit die Seite sonst nicht
im 30-s-Takt den Baum neu baut.

**D6 Bedienform.** Zwei `Checkbox` unter den beiden Auswahlen im Popover `meldebild-filter`, mit
Beschriftung als zweitem Kanal; der deaktivierte Zustand nennt den Grund als sichtbaren Text, nicht
nur als Tooltip. Die Werkzeugzeile bleibt bei 1366 px einzeilig (D9 der Bestandsseite).

**D7 Statusband-Vermerk.** Der Vermerk `einheitenHinweis` („ungefiltert“ bzw. „nur nach Abschnitt
gefiltert“) bleibt für die Mittel-Filter. Ist ein Einheiten-Filter wirksam, zählt das
Einheiten-Paneel die Auswahl, und der Vermerk entfällt.

## Risks / Trade-offs

- [Rückmeldung schlägt während der Bedienung um, Zeilen springen] → gewollt (Spec-Szenario
  „Frist läuft ab“); die Auswahlzeile nennt die neue Zahl.
- [Rahmen-Obereinheit wirkt leer] → ihre Stärke zeigt die kumulierte Stärke der Treffer darunter,
  ihre eigenen Mittel fehlen bewusst; die Anwenderdoku sagt das.
- [Mehr Neuberechnung durch `jetzt`] → nur bei wirksamem Rückmeldungs-Filter (D5).
