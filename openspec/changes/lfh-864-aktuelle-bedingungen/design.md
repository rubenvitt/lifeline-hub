# Design

## Context

Die Motivation steht in `proposal.md`, die Anforderungen in `specs/lage-wetter-pegel/spec.md`.
Maßgeblich ist der Bestand am 01.10.2026 (`origin/alpha` `c0bfc6e`).

**Wetter heute (LFH-633).** `GET /api/einsaetze/{id}/wetter` liefert `WetterAnzeige` mit zwei
Teilen, `warnungen` und `vorhersage`. Jeder Teil trägt `{ zustand: ok | kein_ort | ausfall,
abgerufen_at?, daten? }`. `src/wetter/abruf.rs` holt beide Teile über einen generischen
`Teil<T>` (Präfix, TTL, Obergrenze, URL, Parser) aus dem Nachschlage-Cache. Das läuft
stale-while-revalidate mit In-flight-Marke und 60 s Abkühlung im Merker `wetter_fehlschlag`.
Schlüssel und Anfrage tragen die auf zwei Stellen gerundete Koordinate, der Schlüssel zusätzlich
die Organisation. `src/wetter/quelle.rs` wertet die Antworten rein aus, ohne Netz und ohne Uhr.

Im Frontend ordnet `wetter/wetterStand.ts` den Stand gegen die Uhr der Anzeige ein. Dazu gehören
„veraltet“, die Obergrenze ein zweites Mal und „kein Ort“. `wetter/wetterText.ts` setzt Werte mit
Einheit, Strich für Fehlendes und U+2212 als Minus. Die Seite `pages/WetterPegelPage.tsx` stellt
Pegel über die volle Breite und darunter Warnungen und Vorhersage ins Raster
`repeat(auto-fit, minmax(min(100%, 380px), 1fr))`.

**Bright Sky `/current_weather`**, gemessen am 01.10.2026 gegen fünf Orte:

- `GET /current_weather?lat&lon&tz=Etc/UTC` liefert ein Objekt `weather` mit `timestamp` (Messzeit,
  hier 06:00Z um 06:07Z) und `source_id`. Die Messwerte sind `temperature`, `dew_point`,
  `relative_humidity`, `pressure_msl`, `visibility` (m) und `cloud_cover` (%). Dazu kommen
  `condition` (`dry|fog|rain|sleet|snow|hail|thunderstorm|null`) und `icon`. Wind, Böen und
  Niederschlag gibt es je als 10-, 30- und 60-min-Wert, etwa `wind_speed_10` und
  `wind_gust_speed_60` in km/h oder `precipitation_60` in mm. `sources[]` nennt
  `station_name`, `distance` (m), `height` und `observation_type: synop`.
- **`fallback_source_ids`**: Fehlt der nächsten Station ein Wert, füllt Bright Sky ihn aus einer
  anderen Station und nennt sie je Feld. Das kam in vier von fünf Stichproben vor. Hameln bezog
  Temperatur und Feuchte aus „Hameln-Hastenbeck“ (11,1 km), Wind aus „Hameln“ (12,1 km) und Sicht
  aus „Alfeld“ (21,4 km). Bremen und Helgoland hatten keinen Rückgriff.
- Ohne Station im Umkreis (`max_dist`, Vorgabe 50 km) antwortet die Quelle mit 404.

## Goals / Non-Goals

**Goals:**

- Das Paneel beantwortet „wie ist es draußen gerade?“ mit gemessenen Werten. Jede Zahl ist
  einer Station zugeordnet, auch wenn sie ergänzt ist.
- Der neue Teil folgt dem Muster der zwei vorhandenen: dieselbe Abruf-Mechanik, dieselben
  Zustände, dieselbe Arbeitsteilung bei der Obergrenze. Es gibt keine zweite Wahrheit.

**Non-Goals:**

- **Keine Bewertung der Werte.** Schwellen wie „Wind über Einsatzgrenze der Drehleiter“ oder
  „Glätte möglich“ fehlen, ebenso Färbung oder Alarm. Die Grenzen hängen am Gerät und am
  Hersteller und wären eine eigene Entscheidung über das Alarmbudget (EEMUA 191).
- **Keine Ikone der Wetterlage** (siehe D5).
- Kein Radar, keine Messreihe und kein Verlauf der Messwerte, nur die jüngste Messung.
- Kein Platz im Kennzahlenband des Lage-Dashboards. Lageplätze entstehen nur per Entscheidung
  am Einsatz (LFH-640), nie per Messwert.
- Die Stationshöhe wird nicht gezeigt (siehe Risiken).

## Decisions

### D1 Gemessene Werte über `/current_weather`, nicht die laufende Vorhersagestunde

Gewählt ist die Messung der nächsten SYNOP-Station über Bright Sky `/current_weather`.

- Das Paneel heißt „aktuell“. Ein Modellwert unter dieser Überschrift gäbe eine Rechnung als
  Beobachtung aus. Die Spec von LFH-633 verlangt, dass jede Angabe ehrlich ihren Stand trägt.
- Die Quelle ist dieselbe wie bei Warnungen und Vorhersage. Es entsteht kein neuer Anbieter und
  keine neue Nutzungsbedingung.

**Verworfen:**

- **(B) Die laufende Stunde der MOSMIX-Vorhersage zeigen.** Das bräuchte keinen Abruf und keine
  Backend-Änderung, und die Daten liegen schon im Frontend. Dagegen spricht, dass der Wert eine
  Vorhersage ist, die bis zu einer Stunde vor der Messung gerechnet wurde. Bei Gewitter oder
  Böenfront weicht sie gerade dann ab, wenn es zählt.
- **(C) DWD-Open-Data-Stationsdaten (10-min-Werte) direkt holen.** Das hieße ZIP- und CSV-Dateien
  je Station und eine eigene Stationssuche mit Entfernungsrechnung. Das ist erheblich mehr Code
  für denselben Inhalt.

**Preis:** Die Abhängigkeit von Bright Sky wächst um einen dritten Teil. Ein Ausfall trifft dann
alle drei Wetterteile, die Pegel bleiben unberührt (wie LFH-633 D1).

### D2 Dritter Teil `aktuell` im vorhandenen Endpunkt

Die Antwort wird um ein Feld erweitert:

```
WetterAnzeige {
  ort?, warnungen, vorhersage,
  aktuell: { zustand: ok | kein_ort | ausfall, abgerufen_at?, daten?: WetterAktuell }
}
```

Ort, Gate und Seite sind dieselben, deshalb bleibt es beim gemeinsamen Endpunkt. Die drei
Abrufe laufen parallel (`tokio::join!`). Ein eigener Endpunkt brächte eine zweite Abfrage mit
eigenem Takt und eigenem Ladezustand auf derselben Seite, ohne Gewinn. Ohne Koordinate sind alle
drei Teile `kein_ort`, und es gibt keinen Abruf. Ein Ausfall eines Teils wird **nicht** zum
HTTP-Fehler.

### D3 Datenform `WetterAktuell`: Werte flach, Ergänzungen je Station

```
WetterAktuell {
  gemessen_at: String,                 // timestamp der Quelle, RFC 3339 UTC
  station: WetterStation,              // die Quelle aus source_id
  wetterlage?: WetterLage,             // trocken|nebel|regen|schneeregen|schnee|hagel|gewitter
  temperatur_c?, taupunkt_c?, luftfeuchte_prozent?, luftdruck_hpa?,
  sicht_m?, bewoelkung_prozent?,
  wind_kmh?, windrichtung_grad?,       // wind_speed_10, wind_direction_10
  boeen_kmh?,                          // wind_gust_speed_60: stärkste Böe der letzten Stunde
  niederschlag_mm?,                    // precipitation_60
  ergaenzt: Vec<WetterErgaenzung>,     // leer, wenn nichts ergänzt ist
}
WetterStation    { name, entfernung_m? }
WetterErgaenzung { station: WetterStation, groessen: Vec<WetterMessgroesse> }
WetterMessgroesse = wetterlage|temperatur|taupunkt|luftfeuchte|luftdruck|sicht|bewoelkung|
                    wind|boeen|niederschlag
```

- **Gewählte Fenster:** Für den mittleren Wind gilt der 10-min-Wert, er ist der jüngste. Für die
  Böe gilt das Maximum der letzten 60 min, denn für eine Einsatzentscheidung zählt die stärkste
  Böe der letzten Stunde, nicht die der letzten zehn Minuten. Für den Niederschlag gilt die Summe
  der letzten 60 min. 30-min-Werte, Sonnenschein, Globalstrahlung und Böenrichtung entfallen.
- **Ergänzungen gruppiert je Station:** `fallback_source_ids` bildet Feld auf Quelle ab. Die
  Auswertung übersetzt die gezeigten Felder in `WetterMessgroesse` und gruppiert sie je Station.
  Ein ergänztes Feld, das nicht gezeigt wird, etwa `solar_10`, erscheint nicht. Die Seite nennt
  dann je Wert „Station Hameln, 12,1 km“ statt einer Liste von Quellkennungen. Eine Quelle ohne
  Eintrag in `sources[]` erscheint als Station ohne Namen nicht. Ihr Wert bleibt stehen und wird
  geloggt (lieber zu wenig Herkunft als ein verschwiegener Wert, wie bei LFH-633).
- **Unbekannte `condition`** wird zu keiner Wetterlage (`None`) und geloggt. Sie wird nie zu
  „trocken“, denn ein falsches „trocken“ wäre eine erfundene Angabe.
- Jeder Messwert ist `Option`, aus `null` wird nie 0 (wie `quelle::zahl`).
- Die Messgrößen-Liste der Ergänzung ist nach der Reihenfolge der Enum-Varianten sortiert,
  damit Cache und Antwort deterministisch sind.

### D4 Abruf, Cache und Stand

| Teil | TTL | Obergrenze Cache | Anfrage |
|---|---|---|---|
| Aktuell | 10 min | 3 h | `/current_weather?lat&lon&tz=Etc/UTC` |

- Schlüssel `wetter-aktuell:<org>:<lat>,<lon>`, ein weiterer `Teil<WetterAktuell>` neben
  `WARNUNGEN` und `VORHERSAGE`. In-flight-Marke und Abkühlung laufen je Schlüssel im
  vorhandenen Merker `wetter_fehlschlag`.
- Die TTL beträgt 10 min, weil SYNOP-Messungen höchstens alle 10 min neu sind (gemessen:
  Messzeit 06:00Z, abgerufen 06:07Z). Der Abruf läuft mit dem 5-min-Takt der Seite.
- **Der Stand ist die Messzeit**, nicht die Abrufzeit. Bei einer ausgefallenen Station kann ein
  frischer Abruf eine zwei Stunden alte Messung liefern. Das Spec-Szenario „Alte Messung der
  Station“ verlangt dann „veraltet“.
  - Das **Backend** meldet `ausfall`, wenn der Cache älter als 3 h ist **oder** die Messung
    älter als 3 h ist. Beides wird bei der Antwort geprüft (`quelle::frische_messung`).
  - Das **Frontend** prüft gegen seine Uhr „veraltet“ ab 90 min und die Obergrenze 3 h, beide
    gemessen an `gemessen_at`. Gehaltene Daten ohne neue Antwort laufen sonst nie ab (wie
    LFH-633 D3).
  - `abgerufen_at` bleibt im Draht für die Gleichförmigkeit der Teile. Das Paneel zeigt die
    Messzeit.
- 90 min als Schwelle für „veraltet“: Ein ausgefallener Termin bleibt so noch „aktuell“
  (SYNOP-Stunde plus Verzug), zwei ausgefallene nicht mehr. Nach 3 h ist die Messung für den
  Ist-Stand wertlos.

`wetterStand.ts` bekommt einen Zeitpunkt als Eingabe statt `abgerufen_at` fest zu lesen, damit
die Einordnung eine Funktion bleibt. Für Warnungen und Vorhersage ist der Zeitpunkt weiter
`abgerufen_at`, für `aktuell` ist es `daten.gemessen_at`.

### D5 Wetterlage als Wort, ohne Ikone

Die Wetterlage steht als Wort („Regen“, „Gewitter“). Der Ikonensatz (Spec `ikonensatz`) hat
Gewitterwolke, Regen, Schneeflocke, Nebel und Sonne. Für „trocken und bedeckt“, „teils bewölkt“,
„klar bei Nacht“, Hagel und Schneeregen fehlt eine Ikone. Ein Teil-Satz wäre ein gemischtes Set,
und das ist nach LFH-595 schlechter als keins. Ein voller Satz hieße neue Ikonen über Icons8:
PNG auswählen, Freigabe, SVG abrufen, Kontingent. Das ist ein eigener Schritt mit eigener
Freigabe und gehört nicht in diese Change.

**Alternative**, falls am Checkpoint gewünscht: Die Ikone über das Feld `icon` der Quelle
(`clear-day`, `partly-cloudy-night`, `cloudy`, `fog`, `wind`, `rain`, `sleet`, `snow`, `hail`,
`thunderstorm`, zehn Werte), mit Auswahl und Freigabe der fehlenden Icons8-Ikonen als eigene
Aufgabengruppe. Das kostet eine Freigaberunde mehr.

### D6 Darstellung: Kennzahlenband für vier Werte, Datenraster für den Rest

- **Ort im Raster:** Das Paneel steht direkt nach den Pegeln, vor Warnungen und Vorhersage. Die
  Reihenfolge ist Wasser, dann Wetter jetzt, dann was kommt. Es teilt sich das
  `auto-fit`-Raster mit den beiden anderen Wetterpaneelen. Auf breiten Flächen stehen sie zu
  dritt, sonst brechen sie um.
- **„Zahl führt“:** Ein `Kennzahlenband` trägt vier Kennzahlen: Temperatur, Wind (Richtung als
  Wort in der Notiz), Böen und Niederschlag in 1 h. Darunter stehen in einem `Datenraster`
  Wetterlage, Sicht, Bewölkung, Luftfeuchte, Taupunkt und Luftdruck. Alle Kennzahlen bleiben
  ohne Ton und ohne Kante, denn eine Bewertung entfällt (Non-Goal).
- Ein **ergänzter Wert** trägt in seiner Notiz bzw. seinem Datenfeld „Station Hameln, 12,1 km“.
  Die Notiz ist Text und keine Fußnote mit Zeichen, damit sie vorlesbar ist.
- **Kopf-Meta:** „Station Bremen, 3,9 km · Messung 08:00“ und bei Bedarf „· veraltet“. Der Fuß
  trägt den Quellenvermerk „Datenbasis: Deutscher Wetterdienst · über Bright Sky“ und „SYNOP“.
- `kein_ort` zeigt den Satz ohne Knopf. Den Weg zu den Einsatzdaten trägt weiter nur das
  Warnpaneel, damit keine zwei gleichnamigen Knöpfe entstehen (wie beim Vorhersagepaneel).
- Der Seitenkopf zählt keine neue Abfrage, denn der Stand der Wetterabfrage ist derselbe.
- Sicht wird unter 1 km in Metern gezeigt, sonst in km mit einer Stelle (wie `entfernungText`).
  Der Luftdruck steht ganzzahlig in hPa.

## Risks / Trade-offs

- [Station weit weg oder an anderem Ort, etwa auf einem Berg, an der Küste oder im Tal] →
  Entfernung und Name stehen immer dabei. Die Stationshöhe wird nicht gezeigt, weil die Höhe des
  Einsatzorts unbekannt ist und der Vergleich fehlen würde. Fällt das im Betrieb auf, ist es ein
  Folgeticket. Ein Grenzfall aus der Stichprobe: Für einen Punkt bei Garmisch war die nächste
  Station die Zugspitze (0,4 km, 2.964 m).
- [Keine Station im Umkreis von 50 km, Quelle antwortet 404] → Der Teil ist `ausfall` mit
  „Stand unbekannt“, wie bei jedem Quellfehler. Ein eigener Zustand „keine Station“ lohnt sich
  in Deutschland nicht, denn das SYNOP-Netz ist dichter.
- [Werte aus bis zu fünf Stationen in einem Paneel] → Die Herkunft steht je Wert (D3/D6).
  Gezeigt wird, was die Quelle tut, statt es zu verbergen.
- [Dritter Abruf je Ort bei Bright Sky] → TTL 10 min, Abruf je Organisation und Ort geteilt.
  Bei Ausfall gilt die Abkühlung von 60 s je Schlüssel.
- [Breaking für Konsumenten der Antwort?] → Nur das Frontend liest sie. Das Feld ist neu und
  im TS-Typ Pflicht. Testliterale (`WetterPegelPage.test.tsx`, `e2e/wetter-pegel.spec.ts`)
  bekommen es dazu.

## Migration Plan

Es gibt keine Migration und kein neues Schema. Der Cache-Eintrag ist neu und entsteht beim
ersten Abruf. Zum Rückbau wird der Commit zurückgenommen. Verwaiste Einträge
`wetter-aktuell:*` im Nachschlage-Cache sind harmlos und werden mit dem Cache geräumt.
