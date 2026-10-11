# Proposal

## Why

Freie Lagekarten-Zeichen und ihr Picker hängen als letzter Teil des Hubs am fremden, auf npm
als veraltet markierten Paket `taktische-zeichen-react`. Damit gibt es zwei Bibliotheken, zwei
Vokabulare und zwei Renderwege. Der asynchrone `tz|`-Weg hat das Problem „Bild fehlt bis zum
nächsten Neu-Layout“. Die Bibliothekslücken, die LFH-836 blockiert haben, sind seit
`@einsatzzeichen` 5.2 geschlossen: Freistehende Zustände und Piktogramme gibt es als Spec-Arten
`state` und `pictogram`, dazu ein Vokabular für freistehende Zeichen (LFH-798, LFH-834, LFH-804,
einsatzzeichen#95). Jetzt lässt sich der Umzug abschließen.

## What Changes

- **Upgrade** aller vier `@einsatzzeichen`-Pakete von 4.3.0 auf 5.2.0 (erschienen am 11.10.2026 mit
  einsatzzeichen#95), exakt und gleich gepinnt.
- **Speichern als Spec:** Ein freies Zeichen bekommt die Spalte `zeichen_spec` mit der
  kanonischen Serialisierung (`serializeAnySpec`). Sie nimmt ein Zeichen mit Grundzeichen
  (`SymbolSpec`) oder ein freistehendes Zeichen auf. Die Altspalten (`grundzeichen`,
  `organisation`, `fachaufgabe`, `symbol`, `einheit`, `funktion`, `farbe`) werden nullable und
  für neue Zeichen nicht mehr beschrieben.
- **Bestand lesen:** Ein Leseadapter übersetzt die Alt-Kennungen beim Lesen in eine Spec, mit
  Rückfallkaskade. Das gilt für DB-Zeilen, Lage-Snapshots, Offline-Stände und die Leiste
  „zuletzt verwendet“. Es gibt keinen Backfill. Eine Altzeile bekommt ihre Spec beim nächsten
  Schreiben durch einen neuen Client.
- **Picker und Inspector** werden aus `vocabulary()` bzw. `freestandingVocabulary()` gespeist,
  statt aus dem `accepts`-Katalog. Angeboten wird nur, was die Bibliothek zeichnet. Freie
  Piktogramme und Zustände („nur Symbol“) kommen über die freistehenden Arten.
- **BREAKING (Bedienung):** Es gibt keine freie Hexfarbe mehr. Die Farbe kommt aus der
  Organisation oder, wo das Zeichen eine technische Füllung trägt, aus der festen Palette der
  Bibliothek. Eine gespeicherte Hexfarbe wird beim Lesen auf das nächste Palettentoken
  abgebildet.
- **Karte:** Freie Zeichen laufen über den synchronen `ez|`-Weg wie die Fachobjekte. Der
  `tz|`-Zweig, `grundzeichenAkzeptiert` und das Gating `baueFreiesZeichenTz` entfallen.
- **Server:** Er prüft Form und Wertezugehörigkeit der Spec gegen eine aus `@einsatzzeichen`
  erzeugte Werteliste und antwortet bei einem Fehler mit 400. In einer Übergangszeit nimmt er
  zusätzlich den alten Body an (genau einer von beiden), damit veraltete PWA- und
  Desktop-Clients nicht brechen.
- **Altpaket entfernen:** `taktische-zeichen-react` und `taktische-zeichen-core` fallen aus
  `frontend/package.json` heraus, samt aller Importe. Die `TzProps`-Typen der Fachobjekte stehen
  danach lokal.

## Capabilities

### New Capabilities
- `lagekarte-freie-zeichen`: Speicherung und Schreibvertrag der freien Lagekarten-Zeichen. Das
  umfasst die Spec als gespeicherte Form, die Prüfung am Server mit 400, den Übergang für
  Clients mit altem Body und die Lesbarkeit des Altbestands.

### Modified Capabilities
- `lagekarte-zeichenwahl`: Raster, Achsen und „Details“ folgen dem Vokabular der Bibliothek.
  Die Farbe kommt aus der festen Palette statt frei. „Zuletzt verwendet“ führt Specs und
  übernimmt Alteinträge.
- `lagekarte-taktische-zeichen`: Kartenzeichen in Bildschirmschärfe und definierter Rückfall
  gelten auch für freie Zeichen. Die Anforderung an die Symbolkachel eines farblosen freien
  Zeichens wird an die Palettenfarbe angepasst.

## Impact

- **Frontend:**
  - `pages/lagekarte/`: `FreiesZeichenPicker.tsx`, `FreiesZeichenInspector.tsx`,
    `taktischesZeichen.ts`, `marker.ts`, `markerIcons.ts`, `kartenbildResolver.ts`,
    `Kartenflaeche.tsx`, `Inspector.tsx`, `zuletztVerwendet.ts`, `useKartenInteraktion.ts`,
    `Sidebar.tsx`, `ZeichenHierDialog.tsx`, `snapshotDaten.ts`
  - neuer Leseadapter unter `zeichen/`
  - `api/types.ts`, `offline/geraetRaeumung.ts`
  - Tests dieser Dateien
- **Backend:**
  - Migration ≥ 0172 (neue Spalte, Altspalten nullable per Tabellen-Rebuild)
  - `src/freies_zeichen/{mod,repo}.rs`, `src/routes/freies_zeichen.rs`
  - `src/einsatz/schwaerzung_registry.rs`, `tests/freies_zeichen.rs`
  - generierte Typen (`scripts/check-typ-codegen.sh`)
- **e2e:** `lagekarte-kartengrundlage`, `lagekarte-touch`, `lagekarte-smoke`,
  `lagekarte-offline-precache`, `doku-bilder/lagekarte.bilder.ts`
- **Anwenderdoku:** `docs/anwender/kapitel/lagekarte.md` samt Bild (Mitänderungsregel)
- **Abhängigkeiten:**
  - `@einsatzzeichen/*` 4.3.0 → 5.2.0. Laut Abgleich gibt es für die Fachobjekte keine
    Bruchstelle; neu sind nur Sperrregeln.
  - `taktische-zeichen-react` entfällt, der Lagekarten-Chunk wird kleiner.
