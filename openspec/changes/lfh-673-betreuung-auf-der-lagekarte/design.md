# Design

## Context

Anlass und Umfang stehen in `proposal.md`, die Anforderungen in
`specs/betreuung-lagekarte/spec.md`. Hier steht nur der Stand, der den Weg vorgibt:

- `betreuungsstelle` und `evakuierungsbezirk` kommen aus `migrations/0117_betreuung.sql`
  und tragen weder Koordinate noch Flächenbezug. Die Stelle hat nur den Freitext
  `standort`.
- Der PATCH der Stelle (`repo::stelle_aendern_tx`) liest den Rohstand **in derselben
  Transaktion** (`write_retry!`), rechnet `eingabe.x.unwrap_or(roh.x)` und schreibt dann
  **alle** Spalten. Er hat einen Leerlauf-Riegel: Ändert sich nichts, wird nichts
  geschrieben. Ein ETB-Eintrag entsteht nur aus der Stammdaten-Differenz
  (`StelleStammdaten`). Die Route publiziert über `publiziere_wirksam` **nur dann, wenn
  ETB-Einträge entstanden sind**.
- `lage_zone` (`0036`, erweitert um `gefahrengebiet_id` in `0041` und `ansicht_id` in
  `0095`) wurde **noch nie** neu gebaut. Kein Fremdschlüssel zeigt auf sie. Der Typ-CHECK
  kennt fünf Werte, die Passung von Typ und Geometrie prüft die App
  (`lage_zone::geometrie_klasse_passt`).
- Vorbild für die Zuordnung ist das Gefahrengebiet: `lage_zone.gefahrengebiet_id` (n : 1)
  mit Auswahl im `ZonenInspector`, Deeplink `?gefahrengebiet=` und zusätzlichem
  `LiveEvent::Gefahr`, wenn sich die Zuordnung ändert.
- Die Lagekarte lädt je Quelle eine Query (`useLagekarteDaten`). Das Lesen der Betreuung
  ist serverseitig am Modul gesperrt (`EinsatzLesezugriff<Betreuung>`). Das
  Personen-Muster (`personenEbene.ts`, `personenZugriffVon`) zeigt, wie eine gesperrte
  Quelle zur Sperrzeile wird statt zum Quellenfehler.

## Goals / Non-Goals

**Goals:**

- Die Stellen-Verortung folgt dem UHS-Muster bis in die Leiste, ohne dessen CAS zu
  übernehmen.
- Die Bezirksfläche folgt dem Gefahrengebiet-Muster, mit umgekehrter Entstehung: Der
  Bezirk entsteht im Modul, die Fläche wird ihm zugeordnet.
- Die Arbeit ist **in zwei unabhängig lieferbaren Hälften** geschnitten (Stellen-Marker,
  dann Bezirksfläche). Die erste kommt ohne den Rebuild aus.

**Non-Goals:**

- **Keine automatische Bezirksanlage aus einer gezeichneten Zone.** Das Gefahrengebiet
  entsteht beim Zeichnen, ein Bezirk kann das nicht: `plan_personen` ist Pflicht (≥ 1)
  und die Bezeichnung muss eindeutig sein. Eine Zone ohne Bezirk ist ein erlaubter
  Zwischenstand („nicht zugeordnet“).
- **Kein Zeichnen-Deeplink** aus der Betreuungsseite (etwa
  `?zeichnen=evakuierungsbezirk:<id>`). Heute zeichnet man auf der Karte und ordnet im
  Inspector zu. Ein Deeplink wäre eine eigene Bedienentscheidung.
- **Keine Farbe nach Räumungszustand** auf der Fläche. Der Zustand steht als Text in der
  Beschriftung (zweiter Kanal zuerst). Eine Farbachse „Räumung“ wäre eine neue
  Vertragskarte in `statusFarben.ts` und damit eine eigene Entscheidung.
- **Kein Bezug Bezirk → Stelle und keiner zu Personen.** Das bleibt so, wie LFH-639 es
  entschieden hat.
- **Keine Geokodierung** des Freitexts `standort`. Er bleibt neben der Koordinate stehen.
- **Kein CAS** an der Stelle. D3 aus LFH-639 gilt weiter: Der zweite PATCH gewinnt.

## Decisions

### D1 — Eigener Zonentyp und Verweis Zone → Bezirk (n : 1)

Entschieden am 24.09.2026. Ein Bezirk ist auf der Karte nur dann als Bezirk erkennbar,
wenn er einen eigenen Typ mit eigener Legende hat. Die Alternative „vorhandene Zone
verknüpfen“ hätte einen Räumungsbezirk als „Sperrgebiet“ gezeichnet. Die Richtung
Zone → Bezirk lässt mehrere Teilflächen zu (Straßenzüge beidseits eines Flusses) und nutzt
das Gefahrengebiet-Muster (Inspector-Auswahl, Deeplink, Zusatz-Event) wieder.
`evakuierungsbezirk.lage_zone_id` (1 : 1) wurde verworfen, weil damit ein zweiteiliger
Bezirk unmöglich wäre. Eine eigene Geometriespalte am Bezirk wurde gar nicht erst
angeboten: Sie bräuchte eine vierte terra-draw-Instanz mit eigenem Präfix und liefe an
`lage_zone` vorbei.

### D2 — Zwei Migrationen, der Rebuild ist ein Leaf-Rebuild

- **`0118_betreuungsstelle_lage.sql`:** `ALTER TABLE betreuungsstelle ADD COLUMN lat
  REAL;` und dasselbe für `lon`. Ohne Mehrspalten-CHECK, wie `0034` an der UHS. Das Paar
  sichert die App.
- **`0119_lage_zone_evakuierungsbezirk.sql`:** `-- no-transaction`, `PRAGMA foreign_keys =
  OFF`, `lage_zone_new` mit erweitertem Typ-CHECK **und** der neuen Spalte
  `evakuierungsbezirk_id INTEGER REFERENCES evakuierungsbezirk(id) ON DELETE SET NULL`,
  Kopie mit denselben ids, `DROP`, `RENAME`, Indizes neu anlegen, `PRAGMA foreign_keys =
  ON`. Muster ist `0082`. Weil die neue Spalte in der `_new`-Tabelle entsteht, zeigt beim
  Rebuild noch nichts auf `lage_zone`. Er bleibt ein Leaf-Rebuild.
- **Spalten und Indizes werden aus einer migrierten DB abgelesen** (`PRAGMA
  table_info(lage_zone)`, `sqlite_master`), nicht aus den Migrationen nachgebaut. Sicher
  sind nur `idx_lage_zone_einsatz` und `idx_lage_zone_gebiet` bekannt, `0095` legt eventuell
  einen weiteren an. `lage_zone` hat `INTEGER PRIMARY KEY` ohne `AUTOINCREMENT`, also
  keinen `sqlite_sequence`-Nachzug.
- **Prüfung im Test:** Nach dem Migrieren liefert `PRAGMA foreign_key_check` nichts. Eine
  bestehende Zone mit `gefahrengebiet_id` und `ansicht_id` übersteht den Rebuild
  unverändert. Die Indexliste ist dieselbe wie vorher plus
  `idx_lage_zone_evakuierungsbezirk`.
- **Nummern:** `0118`/`0119` sind heute frei und höher als alles auf `origin/alpha`. Vor
  dem PR läuft `scripts/check-migrationen.sh` nach `git fetch`. Bei Kollision wird mit
  `--umnummerieren` umgelegt.

### D3 — Verortung über den bestehenden PATCH, eigene Differenzachse

- `StelleAenderung` bekommt `lat`/`lon` als `Option<Option<f64>>` (tri-state, wie die
  übrigen optionalen Felder). Einen eigenen Endpunkt `…/verortung` gibt es **nicht**. Die
  UHS, Personal und Personen verorten alle über ihren PATCH, und die Karte ruft je Typ
  ohnehin eine eigene Funktion.
- **Die Paar- und Bereichsprüfung läuft im Repo gegen den Rohstand derselben
  Transaktion**, nicht im Handler gegen einen vorher gelesenen Stand wie bei der UHS.
  Sonst könnte eine parallele Verortung zwischen Prüfung und Schreiben das Paar
  zerreißen.
- **Die Koordinate ist nicht Teil von `StelleStammdaten`.** Diese Struktur erzeugt den
  ETB-Text, und nach D5 aus LFH-639 steht der Standort nie im ETB. Die Verortung ist eine
  eigene Achse `verortung_neu`. Der Leerlauf-Riegel greift erst, wenn **alle drei**
  Achsen leer sind (Stammdaten, Status, Verortung). Genau das ist die Falle: Hinge die
  Koordinate nur am UPDATE, käme ein Karten-PATCH mit `200` zurück, ohne etwas zu
  speichern.
- **Live ohne ETB:** Das Ergebnis des Repos (`Geschrieben`) meldet zusätzlich, ob
  wirksam geschrieben wurde. `publiziere_wirksam` verteilt, wenn ETB-Einträge entstanden
  sind **oder** sich die Verortung geändert hat. Ohne diese Weiche sähe keine zweite
  Karte den Marker wandern.
- **Kein ETB für die Verortung.** Das folgt der UHS, deren Stammdaten-PATCH ebenfalls
  keinen Eintrag schreibt, und D5 aus LFH-639. Eine Koordinate ist keine Lageaussage.

### D4 — Statuscodes: 422 für Paar und Bereich

Die Paarverletzung ist ein **Zusammenhang** zweier Felder (400 ↔ 422-Linie aus
`src/error.rs`). CLAUDE.md nennt `einsatz_uhs.rs` für „lat/lon-Paar, Koordinaten- und
Mengen-Ranges“ ausdrücklich als legitimes 422. Der Bereich folgt demselben Präzedenzfall,
damit alle Verortungswege gleich antworten. Das weicht von D3 aus LFH-639 ab, wonach das
Modul Feldfehler auf 400 legt. Diese Abweichung wird bewusst genommen und im
Handler-Kommentar mit Verweis auf die UHS begründet.

Zuordnung einer Zone:

| Fall | Code |
|---|---|
| Unbekannter Zonentyp | 400 (Bestand) |
| Typ `evakuierungsbezirk` mit Linie | 422 |
| Zuordnung an Zone anderen Typs | 422 |
| Bezirk fehlt oder gehört zu anderem Einsatz | 404 |
| Bezirk storniert | 409 (Lebenszyklus) |
| Kein Lesezugriff auf Modul Betreuung | 403 |

Die 409-Quelle ist hier **Lebenszyklus, nicht CAS**. Die Zonen-Route hat keinen
Überschreiben-Dialog, die Falle aus LFH-299/300 greift also nicht.

### D5 — Zuordnung an der Zone: POST und PATCH, ohne ETB, mit Zusatz-Event

- `AnlegenBody` und `PatchBody` der Zonen-Route bekommen `evakuierungsbezirk_id`,
  optional bzw. tri-state. `LageZoneAnzeige` trägt den Verweis
  (`skip_serializing_if = "Option::is_none"`), aber **keine** Bezirksangaben. Die liest die
  Karte aus der Betreuungs-Query, und die ist am Modul gesperrt. So verrät die Zone
  weder Bezeichnung noch Räumungszustand.
- Ein Typwechsel weg von `evakuierungsbezirk` setzt den Verweis im selben UPDATE auf
  `NULL`, genau wie beim Gefahrengebiet.
- **Kein eigener ETB-Eintrag für die Zuordnung.** Das Gefahrengebiet schreibt beim Merge
  auch keinen. Anlage, Umbenennung und Aufhebung der Zone schreiben wie bisher
  („Evakuierungsbezirk „…“ angelegt“ über `typ_label`).
- **Zusatz-Event:** Ändert sich die Zuordnung oder wird eine zugeordnete Zone
  aufgehoben, publiziert die Route neben `LiveEvent::LageZone` auch
  `LiveEvent::Betreuung` (`{einsatz_id, bezirk_id}`), für den alten **und** den neuen
  Bezirk. Grund: Wer nur das Modul Betreuung liest, bekommt `lage_zone`-Ereignisse nicht
  (Gate `["lagekarte", "gefahrenzonen"]`), sieht aber `flaechen`. Die Frontend-Zuordnung
  `lage_zone → einsatz-betreuung` in `EINSATZ_STREAM_EVENTS` wäre deshalb die falsche
  Stelle.
- **Modulprüfung beim Setzen:** Wer `evakuierungsbezirk_id` setzt oder ändert, braucht
  neben dem Schreibrecht auf die Karte den Lesezugriff auf `betreuung` (dieselbe
  Auswertung wie `EinsatzLesezugriff<Betreuung>`). Ohne diese Prüfung ließen sich fremde
  Bezirks-ids per 404/409 abtasten. Das Lösen (`null`) und der implizite Wegfall beim
  Typwechsel prüfen das nicht, weil sie keine Bezirksangabe offenlegen.

### D6 — Storno löst im selben Vorgang

`bezirk_stornieren_tx` setzt `UPDATE lage_zone SET evakuierungsbezirk_id = NULL WHERE
evakuierungsbezirk_id = ?` in derselben Transaktion und gibt die betroffenen Zonen-ids
zurück. Die Route publiziert nach dem Commit für jede von ihnen `LiveEvent::LageZone`.
Die Alternative „Verweis stehen lassen und beim Zeichnen filtern“ wurde verworfen. Sie
hätte jede lesende Stelle (Karte, Snapshot, `flaechen`) mit einem Filter belastet, und
ein vergessener Filter zeigt einen Fehlanlage-Bezirk als lebende Fläche.
`ON DELETE SET NULL` greift nur beim Hard-Delete, das es für Bezirke nicht gibt.

### D7 — `flaechen` am Bezirk als Zählung im Select

`EvakuierungsbezirkAnzeige.flaechen: i64` (immer gesetzt, 0 ohne Fläche) entsteht als
Unterabfrage in `bezirk_select!`
(`(SELECT COUNT(*) FROM lage_zone z WHERE z.evakuierungsbezirk_id = b.id)`). Die
Betreuungsseite braucht damit keine Zonen-Query, und die Zonen-Query würde am Modul
Lagekarte hängen, nicht am Modul Betreuung. „Auf Karte zeigen“ erscheint nur bei
`flaechen > 0`, und zwar als Eintrag im gebündelten Menü der Bezirkskarte, auch für
Lesende. Ein eigenes Feld „keine Fläche“ gibt es nicht: der Plan-Modus trägt höchstens drei
Sekundärfelder (Evakuiert, Stand, Abschnitt), und keins davon ist entbehrlicher.

### D8 — Frontend-Kette für den Marker

- **`MarkerTyp` bekommt `'betreuungsstelle'`.** Dazu alle exhaustiven Stellen:
  `LayerSichtbar`, `LAYER_DEFAULT` (sichtbar), `OBJEKTART`, `CLUSTER_TYP_FARBE`,
  `Inspector`-Switch, `PLATZIEREN_ZIEL_ERLAUBT`. Außerdem die nicht exhaustiven Stellen
  aus dem Scope-Bericht (`LAYER_KEYS`, `EBENEN`, `TYP_REIHENFOLGE`, Plaketten-Rang,
  `markerToUrl`, `NichtVerortet['typ']`, `NICHT_VERORTET_LABEL`, `ortVorschauExclude`,
  `snapshotDaten.ts`).
- **Nicht in der Peilung der Ort-Vorschau.** `src/geocoding/marker.rs` prüft nur den
  Einsatz-Lesezugriff. Stünde die Stelle dort als Bezugspunkt, nannte die Vorschau ihren
  Namen auch Personen ohne das Modul Betreuung. Die Stelle bleibt deshalb draußen, wie die
  Betroffenen (LFH-648). `ortVorschauExclude`/`inspectorExclude` liefern für sie
  `undefined`, weil es nichts auszuschließen gibt. (Beim Umsetzen gefunden, 24.09.2026.)
- **Startausschnitt und Kopfzahl** zählen die Stellen mit, wie die UHS. Anders als bei den
  Betroffenen: Stellen sind wenige Lageobjekte. Dass der Startausschnitt einer Person ohne
  Modulrecht sie nicht kennt, wird hingenommen.
- **Zeichen:** `{grundzeichen: 'stelle', fachaufgabe: 'betreuung'}` für alle vier Arten.
  Die Art steht in der Unterzeile. Eine eigene Zeichenvariante je Einrichtungsstufe gibt
  der Katalog nicht her.
- **Farbe:** Die Markerrolle ist `bedien` wie bei der UHS (Rot bedient nichts, und eine
  neue Rolle wird nicht erfunden). Das Zeichen und die eigene Ebene unterscheiden die
  Stelle von der UHS. Die Clusterfarbe ist ein neues Literal in `CLUSTER_TYP_FARBE` (die
  Tabelle ist per Dateikopf bewusst rollenfrei). Es darf nicht rot, orange oder amber sein
  und muss sich von `uhs` unterscheiden. Vorschlag: Cyan `#0891b2`.
- **Modulsperre:** Die Betreuungs-Query läuft nur, wenn das Modul lesbar ist
  (`enabled`). Die Ableitung erfolgt über dieselbe Overrides-Auswertung wie
  `personenZugriffVon` und steht als reine Funktion neben `personenEbene.ts`. Gesperrt
  heißt: Sperrzeile in `EBENEN`, keine Marker, kein Eintrag in `fehlerhafteQuellen`.
- **Platzieren:** Der Zweig in `useKartenInteraktion` ruft `aendereStelle(e, id, {lat,
  lon})` und invalidiert `einsatzKeys.betreuung`. „Verortung löschen“ schickt beide
  `null`.
- **Betreuungsseite:** Die Zeilenaktion „Auf Karte verorten“ an nicht verorteten Stellen
  erscheint nur mit Schreibrecht. Vor dem Einbau werden die Zeilenaktionen **nach der
  Rechteprüfung** gezählt. Ab drei kommt sie ins gebündelte Menü (`weitere`, LFH-365),
  nicht in die Reihe.

### D9 — Frontend für die Fläche

- `ZONE_TYPEN` bekommt `{typ: 'evakuierungsbezirk', label: 'Evakuierungsbezirk', geometrie:
  'Polygon'}`, und `STILE` ein neues Literal (der Dateikopf hält die Zonenstile bewusst
  rollenfrei). Vorschlag: Violett `#722ed1`, Füllung 0,15, Linie 2, durchgezogen. Das
  ist kein Rot (Gefahr), kein Orange (Absperrbereich) und kein Grau (Sperrgebiet).
- `zonenBeschriftung` bekommt einen Zweig für zugeordnete Bezirke: Zonenname, sonst die
  Bezirksbezeichnung, sonst das Typwort, und darunter „Räumung: <Zustand>“. Das Wort kommt
  aus dem Label, das die Betreuungsseite schon benutzt, damit es an einer Stelle steht.
  Ohne Modulrecht oder ohne Zuordnung bleibt es beim Namen bzw. Typwort, ohne zweite
  Zeile.
- `ZonenInspector`: Bei Typ `evakuierungsbezirk` steht eine Auswahl der nicht stornierten
  Bezirke plus „nicht zugeordnet“ (nur mit Modulrecht, sonst der Satz „Zuordnung nur mit
  Zugriff auf das Modul Betreuung“). Bei zugeordneter Zone zeigt er als `Datenraster`
  Räumungszustand und „evakuiert N von M“ und den Sprung „Im Fachmodul öffnen ↗“
  (`betreuungPfad(e, {bezirk})`), nach der Regel „ein Sprung ist keine Handlung“
  (LFH-616).
- **Deeplink `?evakuierungsbezirk=`:** `lagekartePfad` und der Leseweg in
  `LagekartePage` funktionieren wie `?gefahrengebiet=` (erste passende Zone wählen,
  hinfliegen, Parameter räumen). Ein Parser verwirft Unbrauchbares ganz.

### D10 — Snapshot

`SnapshotDaten` bekommt `betreuungsstellen` und `evakuierungsbezirke`, befüllt aus
`betreuung::repo::uebersicht` im selben Lesestand. Beide Schlüssel kommen in
`REDIGIERBARE_MODUL_FELDER` mit Modul `betreuung`, sonst umginge der Rückblick die
Modulfreigabe. Die Guard-Liste in `tests/lage_snapshot.rs` wird ergänzt. `schema_version`
bleibt 1, weil die Felder additiv sind. Das Frontend liest die Stellen im Rückblick aus
dem Snapshot. Fehlt das Feld in einem alten Snapshot, gilt `[]` („keine“, nicht Fehler).

### D11 — Schwärzung

`schwaerzung_registry.rs` bekommt am Block `betreuungsstelle` `retain("lat", G_GEO),
retain("lon", G_GEO)` und am Block `lage_zone` `retain("evakuierungsbezirk_id", G_FK)`. Der
Inventar-Guard `jede_einsatz_scoped_spalte_ist_klassifiziert` wird dafür zuerst rot und
ist damit der Test, der die Eintragung erzwingt. Der Rebuild ändert nichts am Scoping
(`einsatz_id` CASCADE bleibt).

## Risks / Trade-offs

- **[Rebuild bricht eine Bestandsspalte oder einen Index]** → Spalten und Indizes aus
  `sqlite_master` einer migrierten DB ablesen. Ein Migrationstest prüft Zeilen-Erhalt,
  FK-Check und die Indexliste. Kein Einschieben: Die Nummer liegt hinter `origin/alpha`,
  geprüft von `check-migrationen.sh`.
- **[Karten-PATCH überschreibt eine parallele Änderung]** → Der Rohstand wird in
  derselben Transaktion gelesen (`write_retry!`), das UPDATE übernimmt nur Felder aus der
  Eingabe. Ein Test setzt zuerst Status und Kapazität, danach nur die Koordinate, und
  prüft beide.
- **[Stiller Leerlauf]** → Ein Test schickt nur lat/lon und liest danach per GET zurück.
  Ein zweiter Test prüft das Live-Ereignis ohne ETB.
- **[Gesperrte Quelle färbt die Karte rot]** → Die Query läuft nur bei Modulrecht. Ein
  Test mit einem Nutzer ohne Betreuung prüft Sperrzeile und leere Fehlerliste.
- **[Breiter Frontend-Testradius]** → `onUnhandledRequest: 'error'` macht jeden
  Lagekarte-Test ohne `/betreuung`-Handler rot, und die Quellreihenfolge ist in
  `useLagekarteDaten.test.tsx` gepinnt. Das wird mit einem gemeinsamen Handler in den
  Testhilfen gelöst. Es ist Aufwand, kein Risiko fürs Verhalten.
- **[Zwei Farbliterale außerhalb der Tokens]** → Beide Tabellen sind per Dateikopf
  bewusst rollenfrei (Grenze Rollenfarbe/Kartensignatur). Die Werte werden im Test
  gepinnt wie die bestehenden.
- **[Zone zeigt einen Bezirk, den die Person nicht lesen darf]** → Die Zone trägt nur die
  id. Name und Zustand kommen aus der gesperrten Query. Ohne sie greift der Beschriftungs-
  und Inspector-Zweig „ohne Modulrecht“.

## Migration Plan

- Beide Migrationen laufen beim Start automatisch (sqlx). Sie sind rein additiv bzw. ein
  werterhaltender Rebuild, Bestandsdaten brauchen keinen Nachzug.
- **Rollback:** Ein Zurückdrehen des Binärs lässt die Spalten stehen. Ältere Binärstände
  lesen sie nicht und brechen nicht. Zonen mit Typ `evakuierungsbezirk` würde ein altes
  Binär allerdings nicht parsen (`LageZoneTyp::parse`). Ein Rollback nach Nutzung braucht
  deshalb vorher ein `DELETE`/Umtypisieren dieser Zonen. Das ist ein Hinweis für den
  Betrieb, kein Automatismus.

## Open Questions

- Die genauen Farbliterale (`#0891b2`, `#722ed1`) werden beim Umsetzen im Browser gegen
  die Nacht- und Tagkarte geprüft und können sich innerhalb der Grenzen aus D8/D9
  verschieben. Das ändert weder Spec noch Schnitt.
