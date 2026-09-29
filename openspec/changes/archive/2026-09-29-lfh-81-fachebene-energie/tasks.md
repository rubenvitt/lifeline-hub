# Tasks

Jede Aufgabe mit Code entsteht per `superpowers:test-driven-development`: erst ein roter
Test, dann der Code, dann grün.

## 1. Backend: reine Bausteine

- [x] 1.1 `Bbox`: einen Cache-Schlüssel mit Präfix bauen. `kritis:` bleibt byte-gleich.
  Belegt durch einen Unit-Test auf beide Präfixe, einer davon mit handgeschriebenem
  `kritis:`-Literal.
- [x] 1.2 Anlagenart aus MaStR-`EnergietraegerName` und OSM-`plant:source` (erster Wert
  bei `;`, `biogas` wird `biomasse`), dazu das Merkmal „konventionell“. Belegt durch einen
  Tabellentest über alle Werte aus design.md, Entscheidung 3, plus einen unbekannten Wert,
  der `sonstige` ergibt.
- [x] 1.3 Leistungsleser für `plant:output:electricity` (MW, GW, kW, mit oder ohne
  Leerzeichen, Dezimalpunkt). `yes`, leer und `~50` ergeben `None`. Belegt durch einen
  Tabellentest, in dem die Fälle `690 MW`, `1.2 GW`, `12000 kW` und `yes` stehen.
- [x] 1.4 `normalisiere_energie_osm`: Overpass-JSON wird zu Punkten mit Rauschfilter
  (konventionell immer, sonst Leistung ≥ 10 MW, keine Quelle und keine Leistung fällt
  weg). Belegt durch Tests zu den Spec-Szenarien „Kleine Solaranlage“, „Gaskraftwerk ohne
  Leistungsangabe“, „Anlage ohne Quelle und ohne Leistung“ und „Nicht auswertbare
  Leistungsangabe“, plus einen `from_value`-Test gegen `GeoJsonFeatureCollection`.
- [x] 1.5 `normalisiere_energie_mastr`: MaStR-`Data` wird zu Punkten. Eine fehlende
  `Data`-Liste oder eine falsche Form ist ein `Err`, **keine** leere Collection. Belegt
  durch einen Test mit einem echten, gekürzten Antwortausschnitt und einen Formfehler-Test.
- [x] 1.6 Zusammenführung per Nähe und Anlagenart (nächste gleichartige OSM-Anlage im
  Radius, Summen bei mehreren Einheiten, Punkt am OSM-Standort) sowie bbox-Filter der
  MaStR-Punkte. Belegt durch Tests zu „Wasserkraftwerk in beiden Quellen“,
  „Unterschiedliche Anlagenart“, „mehrere Einheiten an einer Anlage“ und „Nur Anlagen im
  Ausschnitt“.
- [x] 1.7 Die Quellennennung aus den beitragenden Teilen bauen. Belegt durch Tests für
  beide Quellen, nur OSM, nur MaStR und keine Quelle.

## 2. Backend: Abruf und Route

- [x] 2.1 MaStR-Abruf mit Upstream-Filter (design.md, Entscheidung 2), eigenem
  30-s-Timeout, Seitenschleife bei `Total > pageSize` und 5-min-Sperre nach Fehlschlag.
  Belegt durch Unit-Tests auf die reinen Teile (Filter-URL als Literal, Entscheidung über
  die Sperre nach dem Muster von `autobahn_darf_starten`).
- [x] 2.2 `fetch_energie`: beide Teile über `liefere_mit_swr` mit den Schlüsseln
  `energie:osm:<bbox>` und `energie:mastr`. Kalte Abrufe laufen als eigene Task weiter;
  die Anfrage wartet höchstens 10 s (Nachtrag aus dem Review). Status `offline` nur ohne
  jeden Teilstand. Belegt durch Tests mit vorbelegtem Cache (Muster
  `swr_tests`/`fachebenen_hochwasser_wird_bedient`) für „nur OSM“, „beide“ und „keine“.
- [x] 2.3 Match-Arm `"energie"` mit Pflicht-bbox in `routes/karte.rs`. Belegt durch
  Integrationstests in `tests/karte.rs`: ohne bbox 400, kaputte bbox 400, vorbelegter
  Cache wird mit korrekter `attribution` ausgeliefert.
- [x] 2.4 Den Zuordnungsradius messen: gegen die Live-Endpunkte an einer Stichprobe von
  Wasser-, Solar- und Speicheranlagen, die in beiden Quellen stehen, den Abstand von der
  OSM-Mitte zur MaStR-Koordinate bestimmen. Den Radius aus design.md, Entscheidung 4,
  bestätigen oder anpassen. Liefert ein Messprotokoll im Commit-Body, und die Konstante
  trägt einen Kommentar mit der Quelle der Zahl.
- [x] 2.5 Bei laufendem Backend ein Live-Abruf `GET /api/karte/fachebenen/energie?bbox=`
  im Ruhrgebiet. Belegt dadurch, dass Scholven und GuD Herne erscheinen und keine
  PV-Kleinanlage.

## 3. Frontend: bbox-Pfad verallgemeinern

- [x] 3.1 `KRITIS_MIN_ZOOM` wird zu `BBOX_MIN_ZOOM`. `Kartenflaeche` meldet die bbox, sobald
  eine bbox-abhängige Ebene sichtbar ist. `LagekartePage` hängt `onBboxAenderung` an
  „irgendeine `istBboxAbhaengig`-Ebene sichtbar“. Belegt durch einen Test „KRITIS aus,
  Energie an → bbox wird gemeldet“, dazu die Mutationsprobe: die alte KRITIS-Bedingung
  zurückgesetzt färbt ihn rot.
- [x] 3.2 `useFachebenen`: ein gemeinsamer `viewportBbox`, eine Akkumulation je bbox-Ebene
  und `zoomZuKlein` als Record. `Sidebar` zeigt den Zoom-Hinweis für jede bbox-Ebene.
  Belegt dadurch, dass die Bestandstests von KRITIS in `useFachebenen.test.tsx` und
  `Sidebar.test.tsx` grün bleiben, plus ein neuer Test für den Energie-Zoom-Hinweis.

## 4. Frontend: die Ebene selbst

- [x] 4.1 `'energie'` kommt in `FachebeneQuelle`, `FACHEBENEN`, `fachebeneKeys()` und
  `globalKeys.fachebeneEnergie(bbox)`, mit Byte-Pin als Literal in `globalKeys.test.ts`.
  Die Farbe wird gegen `theme/tokens.ts` geprüft. Belegt durch die Registry-Invarianten in
  `fachebenen.test.ts` und einen Test „Farbe ungleich den Bestandsebenen“.
- [x] 4.2 Ein siebter literaler `useQueries`-Eintrag mit `placeholderData: keepPreviousData`
  und langer `staleTime`, `byKey` in Reihenfolge. Belegt durch einen Test in
  `useFachebenen.test.tsx`, dass die Energie-Query mit bbox feuert und ihre Features
  akkumuliert.
- [x] 4.3 `FachebenenInspector`: ein Zweig `EnergieInhalt` mit Titel, Anlagenart, Leistung
  oder „unbekannt“, Betreiber, Status, Herkunft sowie MaStR-Nummer und Link bei
  MaStR-Herkunft. Belegt durch einen Test „Energie-Punkt zeigt Energie-Inhalt, nicht
  KRITIS“ und einen Test für die Leistung „unbekannt“.
- [x] 4.4 Persistenz: `defaultFachebenenSichtbar` und `leseFachebenen` bekommen `energie`.
  `FACHEBENE_KEYS` wird aus `fachebeneKeys()` abgeleitet (damit fällt auch die Lücke bei
  `hochwasser` weg). Belegt durch zwei Tests in `useKartenAnsicht.test.tsx`: ein alter
  Stand ohne Schlüssel liest „aus“, und das Umschalten von `hochwasser` und `energie` gilt
  jeweils als ungespeicherte Änderung.

## 5. Doku und Abschluss

- [x] 5.1 `docs/fachebenen-quellen.md`: eine Zeile für `energie` (beide Endpunkte, TTL,
  Lizenzen mit Link auf dl-de/by-2-0 und den Datensatz) und ein Anbindungshinweis
  (inoffizieller Endpunkt, fehlende Koordinaten bei konventionellen Anlagen, Ausweichweg
  Gesamtexport). **Kein Handeintrag in `CHANGELOG.md`**: semantic-release schreibt die
  Datei und übernimmt den Eintrag aus der `feat`-Commit-Botschaft. Belegt durch
  Sichtprüfung im Diff.
- [x] 5.2 `./scripts/check-all.sh` ist grün. Belegt durch die Ausgabe des Laufs.
- [x] 5.3 Browser-Blick auf die Lagekarte bei 1280 px (Vite-Dev plus Backend): „Energie“
  einschalten, KRITIS bleibt aus, im Ruhrgebiet auf Zoom 11 gehen, einen Punkt anklicken,
  die Attributionszeile prüfen. Belegt durch einen Screenshot für die Abschlussmeldung.
