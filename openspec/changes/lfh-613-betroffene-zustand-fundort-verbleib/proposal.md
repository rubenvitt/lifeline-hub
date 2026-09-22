# Proposal

## Why

Der Neuentwurf „Instrumententafel“ (S7 Erfassung Betroffene, S3 Lage-Dashboard) braucht vier
Angaben, die das Personenmodell nicht oder nur als Freitext kennt: Zustand, Fundort als
Koordinate, einen strukturierten Verbleib und „vermisst seit“. Die Umsetzung vom 21.09.2026
hat die zugehörigen Elemente deshalb weggelassen und an sechs Stellen im Frontend auf
LFH-613 verwiesen. Das sind die Spalte „Zustand“, `#Koordinate` in der Schnellerfassung, die
Ansicht „Karte“, die Verbleib-Zählung nach Ziel, „Transportiert / offen“ und
„Vermisste – n seit über 4 h“. Dieser Change liefert die Datenquelle und rüstet die Elemente
nach.

## What Changes

- **Zustand**: neue Freitext-Spalte `zustand` an `einsatz_person`, z. B. „gehfähig,
  unterkühlt“. Sie wird im Anlege-POST und im PATCH (Tri-State) gesetzt und beim Schwärzen
  genullt.
- **Fundort-Koordinate**: neues Paar `antreff_lat`/`antreff_lon` an `einsatz_person`. Beide
  Werte werden gemeinsam gesetzt oder gemeinsam geleert, sonst antwortet der Server mit 422.
  Ein Wert außerhalb des gültigen Bereichs ergibt ebenfalls 422. Beim PATCH wird gegen den
  effektiven Zustand geprüft. Beim Schwärzen werden beide genullt.
- **Strukturierter Verbleib**: neue Cache-Spalten `aktuelle_verbleib_art` und
  `aktuelles_verbleib_ziel`. Sie werden in derselben Transaktion wie `aktueller_verbleib`
  gepflegt und in der Migration aus dem jüngsten Verbleib-Ereignis nachgetragen.
  `VerbleibArt` bekommt die neue Art **`notunterkunft`**, die wie `transport`/`entlassung`
  den UHS-Auto-Austritt auslöst. Dafür wird `person_verbleib` per CHECK-Rebuild neu gebaut.
  `aktueller_verbleib` bleibt als Kurzform erhalten, ist also kein Breaking Change.
- **vermisst seit**: neue Spalte `vermisst_seit`. Sie ist optional im Anlege-POST (nur mit
  Status `vermisst`) und im PATCH. Fehlt die Angabe, setzt der Server die Zeit des Übergangs
  nach `vermisst`, bei der Anlage ebenso wie beim Statuswechsel. Ein Zeitpunkt in der Zukunft
  ergibt 400.
- Die offlinefähige Erfassung (`client_id`) und die Erst-Sichtung im selben POST bleiben
  unverändert. Die neuen Felder gehen im selben POST mit, ein Replay schreibt nichts doppelt.
- **Frontend**:
  - Spalte „Zustand“ in der Betroffenenliste, inline bearbeitbar.
  - `#lat/lon` im Parser der Schnellerfassungszeile.
  - Koordinate in der Fundort-Spalte, in der Maske und im Detail.
  - Verbleib-Zählung nach Art bzw. Unfallhilfsstelle (UHS), Notunterkunft als eigener Posten.
  - Neue Ansicht **„Karte“** auf der Betroffenen-Seite mit Personen-Markern nach Sichtung.
  - Im Dashboard der Fuß „Transportiert / offen“ und die Kennzahl-Notiz
    „n seit über 4 h“ an „Vermisste“.
- Codegen (`openapi.json`, `types.generated.ts`) und die Enum-Wire-Pins werden nachgezogen.

## Capabilities

### New Capabilities
- `betroffene-lagedaten`: Zustand, Fundort-Koordinate, strukturierter Verbleib und
  „vermisst seit“ an einer Person im Einsatz. Deckt Erfassung, Bearbeitung, Schwärzung und
  die daraus abgeleiteten Anzeigen ab (Betroffenenliste, Kartenansicht, Dashboard).

### Modified Capabilities
<!-- keine: `lagekarte-fachebenen` betrifft externe Fachebenen, nicht Einsatzpersonen -->

## Impact

- **Backend**:
  - Migrationen: Spalten an `einsatz_person` samt Backfill und ein no-tx-Rebuild von
    `person_verbleib`.
  - `src/person/{mod,repo,verbleib_repo}.rs`, `src/routes/einsatz_person.rs`,
    `src/einsatz/schwaerzung_registry.rs`, `tests/enum_wire_kontrakt.rs`, `src/api_doc.rs`.
- **API**:
  - Additive Felder an `PersonAnzeige`, `AnlegenBody` und `PatchBody`.
  - `VerbleibArt` bekommt den neuen Wert `notunterkunft`. Das ist additiv, Clients mit
    exhaustivem Switch brauchen aber einen Nachtrag.
- **Frontend**:
  - `personen/` (Parser, Spalten, Bilanz, Maske, Detail) und `pages/PersonenPage.tsx`.
  - Neue Kartenansicht über den Lagekarten-Bestand.
  - `pages/lage-dashboard/`, `api/einsatzPerson.ts`, Offline-Queue-Typen.
- **Datenschutz**: Zustand ist Gesundheitsdatum, die Koordinate ein Aufenthaltsort. Beide
  gehören in die Schwärzung, sonst bleibt nach Ablauf der Aufbewahrungsfrist Personenbezug
  stehen.
