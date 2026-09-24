# Proposal

## Why

Das Fachmodul Betreuung (LFH-639) führt Betreuungsstellen und Evakuierungsbezirke bisher
ohne Verortung, die Lagekarte hat es in v1 ausdrücklich ausgeklammert (`design.md`
LFH-639, Non-Goal „Keine Lagekarte“). Im Einsatz lautet die Frage aber meistens „wo“:
Wo liegt die nächste Notunterkunft zum Bezirk, der gerade geräumt wird? Welche Straßenzüge
gehören zum Bezirk? Solange beides nur als Freitext in einer Liste steht, muss die
Führung diese Zuordnung im Kopf behalten. Die Tabellen sind so geschnitten, dass die
Verortung additiv nachkommen kann. LFH-673 ist der dafür angelegte Nachzug.

## What Changes

- **Betreuungsstelle bekommt eine Koordinate.** Neue Spalten `lat` und `lon` an
  `betreuungsstelle` (per `ADD COLUMN`). Der bestehende PATCH der Stelle nimmt sie als
  Paar an, mit Paar- und Bereichsprüfung wie bei der UHS. Eine reine Verortung schreibt
  keinen ETB-Eintrag, verteilt die Änderung aber live.
- **Marker auf der Lagekarte.** Neuer Markertyp `betreuungsstelle` mit taktischem Zeichen
  Grundzeichen `stelle` und Fachaufgabe `betreuung`, eigener Ebene, Cluster-Farbe,
  Inspector-Zeile und Sprung „Im Fachmodul öffnen“. Nicht verortete Stellen stehen in der
  Leiste unter „Nicht verortet“. Der Deeplink `?platzieren=betreuungsstelle:<id>` schickt
  die Karte in den Platziermodus. Die Betreuungsseite bekommt dafür den Einstieg „Auf
  Karte verorten“.
- **Die Ebene respektiert die Modulsperre.** Wer das Modul Betreuung nicht lesen darf,
  bekommt eine Sperrzeile in der Ebenenliste statt eines roten Quellenfehlers, wie bei der
  Personenebene.
- **Evakuierungsbezirk als Fläche.** Neuer Zonentyp `evakuierungsbezirk` in `lage_zone`
  (nur Polygon, eigener Stil, eigene Legende) und neuer Verweis
  `lage_zone.evakuierungsbezirk_id` auf den Bezirk (n : 1, Vorbild Gefahrengebiet). Ein
  Bezirk darf aus mehreren Teilflächen bestehen. Zugeordnet wird im Zonen-Inspector. Die
  Zone zeigt Bezirk und Räumungszustand als Text. Die Betreuungsseite zeigt je Bezirk die
  Zahl seiner Teilflächen und bietet „Auf Karte zeigen“ an
  (`?evakuierungsbezirk=<id>`). Das braucht den **ersten CHECK-Rebuild von `lage_zone`**
  (Leaf-Rebuild, kein Fremdschlüssel zeigt bisher auf die Tabelle).
- **Storno löst die Flächenzuordnung.** Wird ein Bezirk storniert, verlieren seine Zonen
  im selben Vorgang den Verweis. Sie bleiben als nicht zugeordnete Bezirksfläche stehen.
- **Lage-Snapshot und Schwärzung.** Der Snapshot friert Betreuungsstellen und Bezirke mit
  ein, redigiert nach der Modulfreigabe Betreuung. Für die Schwärzung werden `lat`/`lon`
  als Geo-Skelett (`G_GEO`) und `evakuierungsbezirk_id` als Verweis (`G_FK`) erhalten.

Keine Änderung ist **BREAKING**. Alle neuen Felder sind optional und additiv, und der
neue Zonentyp erweitert nur die Wertemenge.

## Capabilities

### New Capabilities

- `betreuung-lagekarte`: Verortung von Betreuungsstellen (Koordinate, Marker, Platzieren,
  nicht verortete Stellen), Evakuierungsbezirke als Flächen der Lagekarte (Zonentyp,
  Zuordnung n : 1, Storno-Verhalten, Sprünge in beide Richtungen), Modulsperre auf der
  Karte, Lage-Snapshot und Schwärzung der neuen Felder.

### Modified Capabilities

(keine; `openspec/specs/` führt bisher nur `lagekarte-fachebenen` für externe
Fachebenen, das hier nicht berührt wird. Die Spec des Betreuungsmoduls liegt noch im
nicht archivierten Change `lfh-639-fachmodul-betreuung`. Deshalb landet das Neue in
einer eigenen Capability statt als Delta auf eine Spec, die es in `openspec/specs/` noch
nicht gibt.)

## Impact

- **Migrationen:** zwei neue Migrationen am Ende der Folge (`0118`, `0119`, vor dem PR
  gegen `origin/alpha` geprüft): `ADD COLUMN` an `betreuungsstelle`, FK-sicherer Rebuild
  von `lage_zone` mit neuem CHECK-Wert und neuer Spalte.
- **Backend:** `src/betreuung/{mod,repo}.rs`, `src/routes/betreuung.rs`,
  `src/lage_zone/{mod,repo}.rs`, `src/routes/lage_zone.rs`,
  `src/lage_snapshot/repo.rs`, `src/routes/lage_snapshot.rs`,
  `src/einsatz/schwaerzung_registry.rs`, `src/geocoding/marker.rs`,
  `tests/enum_wire_kontrakt.rs`, Codegen (`openapi.json`, `types.generated.ts`).
- **Frontend:** `pages/lagekarte/*` (Marker, Ebenen, Cluster, Inspector, ZonenInspector,
  Zonenstil, Leiste, Daten-Hook, Interaktion, Snapshot-Daten), `routing/deeplinks.ts`,
  `api/betreuung.ts`, `api/types.ts`, `betreuung/StellenBlock.tsx`,
  `betreuung/EvakuierungBlock.tsx`.
- **API:** neue optionale Felder (`lat`/`lon` an Stelle und Stellen-PATCH,
  `evakuierungsbezirk_id` an Zone und Zonen-PATCH/-POST, `flaechen` am Bezirk), neuer
  Enum-Wert `evakuierungsbezirk` in `LageZoneTyp`.
- **Keine neuen Abhängigkeiten.**
