# Adressindex-Fixture „Testgebiet“ (LLH-1119)

`testgebiet.osm` ist handgeschrieben: Musterstadt (PLZ 12345) und Nachbardorf (PLZ 12399), abseits
der Koordinaten anderer e2e-Specs. Je ein Fall, den der Index-Bau unterscheiden muss: Adress-Node,
Adresse mit Ortsteil, Adresse über `addr:place`, gleichnamige Adresse im Nachbarort, Gebäude-Way mit
Adresse, Orte, und was nicht hineingehört (Hausnummer ohne Straße, Straße ohne Hausnummer, Ort ohne
Namen, Straßen-Way ohne Adresse, Relation mit Adresse).

`testgebiet.osm.pbf` ist daraus erzeugt (Dense Nodes, wie in den Geofabrik-Extrakten):

```bash
osmium cat tests/fixtures/adressindex/testgebiet.osm -o tests/fixtures/adressindex/testgebiet.osm.pbf -O
```

(gleichwertig mit pyosmium: `osmium.SimpleWriter` über `osmium.FileProcessor`.)

`testgebiet.adressen.sqlite` ist der Index, den der karten-service daraus baut; ihn lesen die
Hub-Tests (`src/geocoding/offline.rs`) und die e2e-Spec `lagekarte-offline-adresssuche.spec.ts`:

```bash
cargo run -p karten-service -- adressindex \
  --pbf tests/fixtures/adressindex/testgebiet.osm.pbf \
  --out tests/fixtures/adressindex/testgebiet.adressen.sqlite
```

Wer `testgebiet.osm` oder den Index-Bau ändert, erzeugt beide Dateien neu und committet alle drei;
`adressindex::tests::eingecheckter_fixture_index_ist_aktuell` (karten-service) wird sonst rot.
