# Design

## Context

Motivation steht in `proposal.md`. Heutiger Stand, gemessen im Code:

- `src/karte/quellen.rs::fetch_kritis` fragt je Raster-bbox Overpass (zwei Endpunkte,
  30 s Timeout) und legt die Antwort unter `kritis:<bbox>` in `fachebenen_cache` ab
  (TTL 24 h, Stale-while-revalidate über `liefere_mit_swr`).
- `Bbox::parse` (`src/karte/typen.rs`) lehnt jede bbox über 1° × 1° ab, die Route
  (`src/routes/karte.rs::fachebenen`) verlangt `bbox` und liefert sonst 400.
- Das Frontend meldet die bbox erst ab `KRITIS_MIN_ZOOM = 10` (`Kartenflaeche.tsx`), rastert
  sie auf 0,05° (`rasterBbox`) und sammelt die Treffer in `useFachebenen.ts` auf höchstens
  `KRITIS_MAX = 4000` Punkte (`mergeFeatures`, Dedup über die Koordinate).
- Alle Punkt-Ebenen teilen denselben Circle-Layer in `fachebenenLayer.ts`; der Klick-Handler
  in `Kartenflaeche.tsx` hängt an `fachebeneClickLayerId`.
- Fachebenen-Caches liegen in einer eigenen SQLite-Datei (`src/cache_db.rs`,
  `nachschlage-cache.db`, Schema per `CREATE TABLE IF NOT EXISTS`, keine sqlx-Migration),
  damit sie nicht um den operativen Writer konkurrieren.
- Es gibt einen Streaming-Download-Kern mit Plattenplatz-Vorabprüfung
  (`src/karte/download.rs::lade_datei`, `fs4::available_space`) und ein
  Scheduler-Muster mit testbarem `tick_einmal` (`src/backup/scheduler.rs`,
  `einsatz::purge_scheduler`).
- Schalter kommen über clap mit `env` (`src/config.rs`) und werden in `main.rs`
  protokolliert; Integrationstests bauen `AppState` ohne `main`, starten also keine
  Scheduler. Die e2e-Suite startet das echte Binary (`frontend/playwright.config.ts:210`).

## Goals / Non-Goals

**Goals:**
- Import des Deutschland-Extrakts ohne Zusatzdienst, im Single-Binary.
- Route beantwortet jede bbox aus einem lokalen Bestand in deutlich unter einer Sekunde.
- Antwortgröße nach oben begrenzt (5 000 Features), unabhängig vom Ausschnitt.
- Import ist Default-an und in Tests/e2e abschaltbar.

**Non-Goals:**
- Kein Overpass-Rückfall. Ohne Bestand ist die Ebene `offline` (Entscheidung 6).
- Keine neue Kategorie, kein Kategorie-Filter im Panel, keine Änderung am Detail-Panel.
- Keine Vektorkacheln/MVT; keine Offline-Auslieferung des Extrakts an Clients.
- Kein Import anderer Länder; die Extrakt-URL ist zwar konfigurierbar, geprüft wird DE.
- Keine Admin-Oberfläche für den Importstatus (Log + `stand` genügen für v1).

## Decisions

### 1. Weg (a): Geofabrik-PBF + `osmpbf`, nicht eigene Overpass-Instanz
Eine eigene Overpass-Instanz wäre ein zweiter Dienst mit eigener Datenbank (~Dutzende GB),
eigenem Update-Prozess und eigener Überwachung — das widerspricht dem Single-Binary-Betrieb.
`osmpbf` (0.3.x, reines Rust, MIT/Apache) liest die PBF-Datei direkt, parallel über
`par_map_reduce`. Der Import läuft in `tokio::task::spawn_blocking`, damit die CPU-Last
den Runtime-Executor nicht blockiert.

### 2. Drei Durchläufe für Ways und Relations
OSM speichert Koordinaten nur an Nodes. Damit Flächenobjekte (Krankenhausgelände als Way
oder Multipolygon-Relation) einen Punkt bekommen:
1. Durchlauf: getaggte Nodes → direkt Objekt; getaggte Ways → Node-Referenzen merken;
   getaggte Relations → Member-Way-IDs merken.
2. Durchlauf: Ways aus den Relation-Membern → deren Node-Referenzen merken.
3. Durchlauf: Koordinaten aller gemerkten Node-IDs einsammeln.
Punkt eines Ways/einer Relation = **Mittelpunkt der Bounding-Box** seiner Nodes — dasselbe,
was Overpass mit `out center` liefert, die Punkte liegen also dort, wo sie heute liegen.
Speicher: die gemerkten Node-IDs sind grob einige Millionen (`HashMap<i64, (f64, f64)>`),
also wenige hundert MB Spitze während des Imports; gemessen wird das im Task.
Die Tag-Auswahl ist exakt die der bisherigen Overpass-Query
(`amenity=hospital|clinic|nursing_home|school|kindergarten|fire_station|police`,
`social_facility=*`, `man_made=water_works|water_tower`, `power=substation`).

### 3. Eine Normalisierung, zwei Eingaben entfallen zu einer
`normalisiere_overpass` bildet heute Overpass-JSON auf Properties ab. Die Tag-Logik
(`kritis_kategorie`, `kategorie_label`, `baue_adresse`, Notaufnahme) wird auf eine Funktion
über eine Tag-Map umgestellt, die der Import aufruft. Die Overpass-Hülle entfällt mit dem
Overpass-Pfad; ihre Tests werden auf die Tag-Funktion umgeschrieben, damit die gepinnten
Kategorie-Wörter erhalten bleiben.

### 4. Bestand als eigene Tabelle in `nachschlage-cache.db`, Austausch atomar
`kritis_objekt(osm_typ, osm_id, lon, lat, kategorie, properties_json)` mit Index auf
`(lon, lat)`, plus `kritis_import(stand, quelle_url, last_modified, etag, importiert_at,
anzahl)` als Ein-Zeilen-Metadaten. Geschrieben wird in `kritis_objekt_neu`; erst am Ende
eines vollständigen Laufs `DROP` alt + `ALTER TABLE … RENAME` in einer Transaktion. Damit
sieht die Route nie einen halben Bestand, und ein Abbruch hinterlässt nur eine
Staging-Tabelle, die der nächste Lauf verwirft.
Nicht in `fachebenen_cache`: dessen Prune-on-Write (`MAX_ALTER_SEKUNDEN` = 2 Tage) würde
einen Wochenbestand wegräumen, und ein JSON-Blob je bbox kann nicht nach Ausschnitt
abfragen. Nicht in der operativen DB: der Bestand ist regenerierbar, gehört nicht in
Sicherungen und nicht unter die Writer-Disziplin.

### 5. Verdichtung serverseitig über ein fest verankertes Raster
Deutschland hat grob einige hunderttausend passende Objekte (Schulen, Kitas und
Umspannwerke dominieren). Alles an den Client zu schicken hieße zweistellige MB je
Deutschland-Ansicht und einen Cluster-Index über ~10⁵ Punkte im Browser eines
Führungsgeräts — deshalb begrenzt der Server:
- `COUNT(*)` im Ausschnitt; ≤ 5 000 → Einzelobjekte.
- sonst Sammelpunkte je Rasterzelle: Zellgröße aus einer festen Leiter
  (z. B. 0,01° · 0,02° · 0,05° · 0,1° · 0,2° · 0,5°), gewählt als kleinste Stufe, bei
  der höchstens 5 000 Zellen auf die bbox fallen. Zelle = `floor(lon/g), floor(lat/g)`,
  also vom Ausschnitt unabhängig verankert (Spec: gleiche Zelle → gleicher Sammelpunkt).
  Punkt = Mittel der Objektkoordinaten der Zelle, `anzahl` = Zahl der Objekte.
- `GROUP BY` über einen Index-Scan ist für die DE-Ansicht der teuerste Fall; das Ziel
  < 300 ms wird im Task gemessen. Reicht es nicht, werden die Zellen je Leiterstufe beim
  Import vorberechnet (`kritis_zelle(g, x, y, lon, lat, anzahl)`) — die Schnittstelle
  ändert sich dadurch nicht.
**Umgesetzt wurde Plan B** (Messung Aufgabe 3.2, Release-Build, 400 000 Objekte): zur
Abfragezeit gerechnet brauchte die DE-Ansicht 384 ms; mit `kritis_zelle` (beim Tausch je
Leiterstufe per `INSERT … SELECT … GROUP BY` gefüllt, mitgetauscht) und einer auf 5 001
gedeckelten Zählung sind es 4,5 ms. Die Zellen zählen immer ganz — die Spec ist entsprechend
präzisiert.
Verworfen: Vorberechnung von Anfang an (mehr Code, bevor klar ist, dass sie nötig ist);
MVT (neuer Kachelpfad, neuer Layer-Typ, bricht das einheitliche Fachebenen-Umschlag-Muster).

### 6. Kein Overpass-Rückfall
Ein Rückfall bräuchte zwei Betriebsarten mit unterschiedlichen bbox-Regeln, und das
Frontend müsste wissen, welche gerade gilt (Mindest-Zoom ja/nein). Der Nutzen ist klein:
abgeschaltet ist der Import nur in Tests; in der Aufwärmphase des ersten Starts ist die
Ebene einige Minuten `offline` und füllt sich dann über den Aufwärm-Poll (Entscheidung 8).
Damit hält auch das Akzeptanzkriterium „Overpass nicht periodisch belasten" trivial.

### 7. Schalter und Scheduler
- `--kritis-extrakt <bool>` / `LIFELINE_KRITIS_EXTRAKT`, Vorgabe `true`
  (`ArgAction::Set`, damit `--kritis-extrakt false` geht).
- `--kritis-extrakt-url` / `LIFELINE_KRITIS_EXTRAKT_URL`, Vorgabe
  `https://download.geofabrik.de/europe/germany-latest.osm.pbf`.
- `--kritis-extrakt-intervall-stunden` / `LIFELINE_KRITIS_EXTRAKT_INTERVALL_STUNDEN`,
  Vorgabe 168.
- Scheduler nach dem Muster von `backup::scheduler`: dünner `tokio::time::interval`-Task,
  Logik in `tick_einmal(pool, dir, config, jetzt)`. Beim Start: 60 s Verzögerung (Start und
  erste Anfragen nicht belasten), dann Lauf, wenn kein Bestand oder Bestand älter als das
  Intervall. Danach stündlicher Tick mit derselben Fälligkeitsprüfung — so überlebt die
  Fälligkeit Neustarts, ohne dass der Tick selbst Zustand trägt.
- Vor dem Download ein `HEAD`: sind `Last-Modified`/`ETag` gleich den gespeicherten, wird
  nur `importiert_at` fortgeschrieben (Spec „Unveränderter Extrakt").
- Download über `download::lade_datei` (https-Pflicht über den Redirect-Client,
  Plattenplatz-Vorabprüfung, `.part`-Datei) nach `<karten_dir>/kritis/`. Die Datei wird
  nach dem Import immer gelöscht, auch bei Fehler.
- `stand` = `Last-Modified` des Extrakts (Geofabrik setzt ihn auf den Stand der Daten);
  fehlt er, der Import-Zeitpunkt.
- Ein prozessweiter `AtomicBool` verhindert parallele Läufe.
- e2e: `playwright.config.ts` hängt `--kritis-extrakt false` an. Vitest und
  `cargo test` starten `main` nicht und brauchen nichts.

### 8. Frontend
- `FACHEBENEN.kritis`: `pollMs` bleibt 0 (bbox-getrieben), neu `aufwaermPollMs` für
  `offline` wie bei Autobahn — sonst erschiene der erste Bestand erst beim nächsten Pannen.
- `KRITIS_MIN_ZOOM`, `mergeFeatures`, `KRITIS_MAX`, `kritisZoomZuKlein` entfallen;
  die bbox wird in jeder Zoomstufe gemeldet. `rasterBbox` bleibt, das Raster wächst mit
  der bbox-Breite, damit beim Pannen auf DE-Ebene nicht jede Bewegung einen neuen Key
  erzeugt. `keepPreviousData` hält das Bild beim Nachladen stehen.
- KRITIS bekommt eine eigene Source mit `cluster: true`, `clusterRadius` ~50,
  `clusterMaxZoom` 14 und `clusterProperties: { anzahl: ['+', ['coalesce', ['get',
  'anzahl'], 1]] }` — so zählt ein Client-Bündel Server-Sammelpunkte mit ihrem Gewicht.
  Drei Layer: Bündel-Kreis, Bündel-Zahl (`symbol`, Text aus `anzahl`), Einzelpunkt
  (`['!', ['has', 'point_count']]` und kein `sammelpunkt`). Ein Server-Sammelpunkt, der
  allein bleibt, wird wie ein Bündel gezeichnet (Filter auf `sammelpunkt`).
- Klick: Client-Bündel → `getClusterExpansionZoom` + `easeTo`; Server-Sammelpunkt →
  `easeTo` auf den Punkt mit Zoom + 2; Einzelpunkt → bestehender
  `onFachebeneKlick`-Pfad. Der Bündel-Zahl-Layer braucht eine Glyphen-Quelle; welche der
  Basiskarten-Styles mitbringt, wird im Task geprüft (Offline-Style inklusive).
- Farben: Bündel in der Ebenenfarbe mit Kontur, die Zahl mit einem Text/Halo-Paar aus
  `theme/tokens.ts`, kein neuer Farbwert.

## Risks / Trade-offs

- [4–5 GB Download je Lauf, auch im Dev-Stack] → HEAD-Vergleich vermeidet Leerläufe;
  wöchentlicher Takt; Plattenplatz-Vorabprüfung bricht sauber ab; Datei wird immer
  gelöscht. Wer im Dev ohne Download arbeiten will, setzt `LIFELINE_KRITIS_EXTRAKT=false`.
- [Erster Start: Ebene minutenlang `offline`] → Aufwärm-Poll; ein fester `geltung`-Text
  im Panel sagt, dass die Ebene OSM-Daten mit wöchentlichem Stand zeigt (keine amtliche
  KRITIS-Liste, nicht vollständig). Ohne Netz (Einsatz ohne Internet) bleibt der letzte Bestand
  unbegrenzt gültig — das ist besser als heute, wo Overpass ohne Netz gar nichts liefert.
- [Speicherspitze beim Import] → drei Durchläufe statt eines Node-Index über ganz DE;
  gemessen im Task, bei Bedarf Node-IDs als sortierter `Vec` statt `HashMap`.
- [DE-Aggregation zu langsam] → Messziel im Task, vorberechnete Zellen als benannter
  Plan B ohne Schnittstellenänderung.
- [Geofabrik-Fair-Use] → ein Download je Woche und Instanz, mit HEAD davor; eigener
  User-Agent. Viele Instanzen können die URL auf einen eigenen Spiegel legen.
- [Abweichung Punktlage gegenüber heute] → Bounding-Box-Mitte wie Overpass `center`.
- [Kategorie `social_facility=*` ist breit] → unverändert übernommen, um den Bestand nicht
  still zu ändern; Schärfung ist ein eigenes Ticket, falls gewünscht.

## Prüfliste Einsatztauglichkeit

Keine neue Seite; umgebaut ist eine Ebene der Lagekarte (Bündel statt Einzelpunkte, Laden in
jeder Zoomstufe, ein Hinweis entfällt). Präzedenz LFH-77/78 hat für eine Fachebene keine
Liste angelegt — hier wird sie trotzdem geführt, weil sich Bedienweg (Klick auf Bündel) und
Darstellung (Zahl auf Kreis) ändern.

| #  | Verdikt | Beleg / Begründung |
| -- | ------- | ------------------ |
| 1  | erfüllt | Kleinster Bündel-Kreis Radius 12 px = 24 × 24 CSS px (`BUENDEL_RADIUS`); Einzelpunkte unverändert (Radius 5 + Kontur, Bestand aller Punkt-Ebenen) — keine zeitkritische Aktion. |
| 2  | nicht anwendbar | Kartenobjekte folgen nicht der Dichte-Staffel (MapLibre-Layer, kein antd-Element); das Panel (Schalter) ist unverändert. |
| 3  | erfüllt | `keepPreviousData` (eigene `useQuery`): beim Pannen bleibt das Bild stehen, bis die neue Antwort da ist; Antwortzeit gemessen ≤ 28 ms (Aufgabe 3.2). |
| 4  | nicht anwendbar | Keine kritische oder irreversible Aktion — lesen und zoomen. |
| 5  | erfüllt | Zahl in `farbenHell.flaeche` mit Halo `farbenHell.text` auf dem Ebenen-Violett, fest in beiden Modi, weil sie auf dem Kreis und nicht auf dem Kartengrund steht; Sichtprüfung Hell/Dunkel in Aufgabe 6.3. |
| 6  | erfüllt | Die Ebene trägt keinen Status über Farbe; Bündel unterscheiden sich vom Einzelobjekt durch Zahl und Radius, nicht nur durch Farbe. |
| 7  | erfüllt | Ebenenfarbe `#531dab` unverändert, keine neue Farbe. |
| 8  | offen → Folge-Task der Leitlinie | Kein Helligkeitsregler in der Anwendung (seitenübergreifend, s. Referenzvalidierung der Leitlinie). |
| 9  | nicht anwendbar | Keine kritische Anzeige; Fachebenen sind Zusatzinformation. |
| 10 | nicht anwendbar | Die Ebene erzeugt keine Alarme. |
| 11 | erfüllt | Kein Blinken; offline wird als Panel-Status angezeigt. |
| 12 | erfüllt | Neue Daten ersetzen die Ebene auf der Karte, nicht Listeneinträge unter dem Cursor; das Karten-Layout verschiebt sich nicht (kein Layout-Element, kein CLS). |
| 13 | nicht anwendbar | Kein neues fixiertes Element; der entfallene Zoom-Hinweis war das einzige hinzugekommene/entfernte Element. |
| 14 | nicht anwendbar | Keine Tabelle. |
| 15 | nicht anwendbar | Keine Erfassungsmaske. |

## Migration Plan

- Kein Datenmigrationsschritt: die Tabellen entstehen per `CREATE TABLE IF NOT EXISTS` in
  der Cache-DB. Alte `kritis:<bbox>`-Einträge in `fachebenen_cache` laufen über den
  bestehenden Prune-on-Write aus.
- Rollback: Revert des Changes; die zusätzlichen Tabellen in der Cache-DB stören die alte
  Version nicht.

## Open Questions

- Exakte Leiterstufen und `clusterRadius` werden nach Browser-Messung auf DE-, Landes- und
  Stadtebene festgezogen; die 5 000er-Grenze der Spec bleibt davon unberührt.
