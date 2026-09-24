# Proposal

## Why

Kriterium 14 der Bedien-Leitlinie verlangt von einer Tabellenseite vier Dinge: stehende
Kopfzeile, fixierte menschenlesbare Kennung, einen **umschaltbaren Spaltensatz mit Zähler
ausgeblendeter Spalten** und keine Auflösung in Karten, wo verglichen wird. Die beiden
Kartenverwaltungen im Admin-Bereich (`karten/OfflineKartenVerwaltung.tsx`, sechs Spalten;
`karten/OnlineQuellenVerwaltung.tsx`, sieben Spalten) erfüllen drei davon über
`KatalogTabelle`. Den Spaltenschalter gibt es heute nur in `Datensicht`, also fehlt er dort.
Die B5f-Prüfliste führt das als „teilweise erfüllt → LFH-374“.

Ursprünglich betraf das Ticket auch das Einsatztagebuch. Dieser Teil ist **gegenstandslos**:
LFH-342 · C7 hat die ETB-Chronologie auf `Datensicht` samt Spaltenschalter gehoben, und seit
dem Neuentwurf (22.09.2026) ist das ETB eine Zeitachse, keine Tabelle mehr. `EtbTabelle.tsx`
und `EtbTabelle.test.tsx` gibt es nicht mehr. Übrig sind die zwei Kartenverwaltungen.

Entscheidung des Auftraggebers (24.09.2026): Der Schalter wird **als Opt-in in
`KatalogTabelle`** nachgerüstet. Die Tabellen werden nicht auf `Datensicht` gehoben. Beide
Seiten fahren antds eigene Kopfsortierung und Spaltenfilter, und ihre Tests bedienen genau
diese Bedienelemente. `Datensicht` sperrt beides.

## What Changes

- **Eine Zählwahrheit für zwei Träger.** `sichtbareSpalten`, `hatWaehlbareSpalten` und die
  Komponente `SpaltenSchalter` ziehen aus `Datensicht.tsx` in ein eigenes Modul, das
  `KatalogTabelle` und `Datensicht` beide importieren. Sie arbeiten dort auf einem minimalen
  strukturellen Spaltentyp (`key`, `etikett`, `immerSichtbar`, `abBreite`). `Datensicht`
  exportiert die Namen weiter, damit sich für bestehende Importe nichts ändert. Eine zweite
  Zählfunktion entsteht nicht.
- **`KatalogTabelle` bekommt ein Opt-in `spaltenSchalter`.** Ohne dieses Prop ändert sich an
  den übrigen sechzehn Katalogtabellen nichts. Mit dem Prop steht der Schalter
  „Spalten · n ausgeblendet“ in der Werkzeugzeile neben der Suche. Handauswahl und
  breitenabhängiges Wegfallen (`abBreite`) laufen durch dieselbe Funktion. Spalte 0 und
  `immerSichtbar` sind nicht abwählbar. Die Kommandopalette bietet „Spalten“ nur an, solange
  es etwas zu schalten gibt.
- **`KatalogSpalte` lernt `etikett`, `immerSichtbar` und `abBreite`**: dieselben Namen wie an
  `DatensichtSpalte`, also ein Begriff mit zwei Trägern (Muster `suchText`, `mindestBreite`,
  `zahl`). `abBreite` ohne `spaltenSchalter` wirkt nicht und meldet sich in DEV: eine Spalte,
  die ohne Zähler wegfällt, wäre der Fehler, gegen den das Kriterium steht. antds
  `responsive` und `hidden` sind am Typ gesperrt, und ein Guard hält sie aus den
  Konsumentendateien fern. Beide verbärgen Spalten, die der Zähler nicht kennt.
- **Beide Kartenverwaltungen schalten den Schalter ein.** Die gekappten Freitextspalten (URL,
  Attribution) tragen `abBreite`. Die Aktionsspalte ist `immerSichtbar`. Filter und
  Sortierung bleiben antds eigene, und die Tabellen bleiben auf jeder Breite Tabellen.
- **Die Ausnahme für die übrigen Katalogtabellen bleibt bestehen und wird neu begründet.**
  Der Dateikopf von `KatalogTabelle` („Kein Spaltenschalter … nicht anwendbar“) wird durch
  die neue Regel ersetzt: Opt-in steht jeder Katalogtabelle offen. Ohne Opt-in gilt die
  Ausnahme nur, solange alle Spalten sichtbar sind und kein `abBreite` gesetzt ist.
- **Prüflisten:** Eine neue 15-Zeilen-Prüfliste für beide Kartenverwaltungen liegt in diesem
  Change-Ordner. In den beiden Alt-Prüflisten unter `docs/superpowers/specs/` bekommt Zeile 14
  nur einen Vorwärtsverweis (Entscheidung des Auftraggebers). Beim ETB lautet er „eingelöst
  durch LFH-342, seit dem Neuentwurf gegenstandslos“.

## Capabilities

### New Capabilities
- `katalogtabelle-spaltenschalter`: umschaltbarer Spaltensatz mit Zähler ausgeblendeter
  Spalten an Katalogtabellen. Er ist opt-in, hat eine Zählwahrheit für Handauswahl und
  Breite und gilt für beide Kartenverwaltungen.

### Modified Capabilities
<!-- keine: für Tabellen-Primitive gibt es bisher keine Spec -->

## Impact

- `frontend/src/components/`: neues Modul für Zählung und Schalter, `KatalogTabelle.tsx`
  (Prop, Werkzeugzeile, Tastaturebene, Dateikopf), `Datensicht.tsx` (Import statt eigener
  Definition, Re-Export), Guards `katalogTabelle.guard.test.ts` (Verbot `responsive`/`hidden`
  bei Konsumenten, `spaltenSchalter` nie aus `Datensicht`).
- `frontend/src/karten/`: `OfflineKartenVerwaltung.tsx`, `OnlineQuellenVerwaltung.tsx` samt
  Tests.
- Doku: CLAUDE.md (Absatz „Tabelle nur, wenn verglichen wird“) und Zeile 14 der zwei
  Alt-Prüflisten (Verweis). Die LFH-346-Prüfliste mit ihrem Merker „sieben von sieben“ bleibt
  als eingefrorenes Archiv unverändert. Der neu gefasste Dateikopf löst den Merker ab.
- Kein Backend, keine API, keine Migration.
