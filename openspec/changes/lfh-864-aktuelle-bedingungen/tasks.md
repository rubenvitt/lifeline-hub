# Tasks

Jede Aufgabe per `superpowers:test-driven-development`: erst der rote Test, dann der Code.
Wo „Gegenprobe“ steht, wird der Kern der Änderung kurz zurückgenommen und der Test muss rot
werden.

## 1. Backend: Auswertung von `/current_weather`

- [ ] 1.1 Antwort aufzeichnen: `/current_weather?lat=52.00&lon=9.50&tz=Etc/UTC` (Hameln, mit
  Rückgriff auf drei Stationen) nach `src/wetter/testdaten/current_weather.json` speichern, dazu
  `null` an einem Wert der Hauptstation, ein `icon`, das es nicht gibt, und `icon: fog` zu
  einer Nachtstunde in je einer Kopie im Test. Nachweis: Datei liegt vor, Kopf des Tests nennt Herkunft und Ergänzungen.
- [ ] 1.2 DTOs in `src/wetter/mod.rs` anlegen: `WetterAktuell`, `WetterStation`,
  `WetterErgaenzung`, Enums `WetterSymbol` (13 Werte, design.md D5) und `WetterMessgroesse` (per `wire_enum!`),
  `WetterAktuellTeil`, Feld `aktuell` in `WetterAnzeige`. Doku-Kommentare je Feld mit Fenster
  und Einheit (design.md D3). Nachweis: `cargo build` grün.
- [ ] 1.3 `quelle::parse_current_weather` per TDD (design.md D3):
  - Hauptstation aus `source_id`;
  - Fenster 10/60/60 für Wind, Böen, Niederschlag;
  - `null` und fehlende Werte ergeben `None`, nie 0;
  - jedes der zwölf `icon` der Quelle ergibt sein `WetterSymbol`; ein unbekanntes ergibt
    `None` und eine Log-Zeile;
  - `fallback_source_ids` werden nur für gezeigte Felder je Station gruppiert, in fester
    Reihenfolge;
  - eine Quelle ohne Eintrag in `sources[]` fällt aus `ergaenzt` heraus, ihr Wert bleibt;
  - eine Antwort ohne `weather` ergibt `None`.

  Nachweis: Tests in `quelle.rs` grün. Gegenprobe: Böe auf `wind_gust_speed_10` umgestellt
  macht den Test rot.
- [ ] 1.4 `quelle::sonne_ueber_horizont(lat, lon, zeit)` per TDD (NOAA-Näherung, Schwelle
  −0,833°) und Nebel nach Tageszeit in `parse_current_weather` aus der Lage der Hauptstation
  (design.md D5). Ohne Stationslage gilt Tag, und eine Log-Zeile wird geschrieben. Nachweis:
  Bremen am 01.10.2026 (Aufgang etwa 05:24Z, Untergang etwa 17:05Z) um 05:00Z ergibt Nacht,
  um 06:00Z Tag, um 16:30Z Tag und um 17:30Z Nacht (gegen eine Sonnentabelle), dazu Mittag
  und Mitternacht im Juni und im Dezember. `fog` um 02:00Z ergibt `nebel_nacht`. Gegenprobe: Schwelle auf 0° gesetzt
  macht den Grenztest rot.
- [ ] 1.5 `quelle::frische_messung(aktuell, jetzt)` per TDD: Eine Messung, die älter als 3 h ist,
  ergibt `None`. Genau 3 h ist noch gültig, eine unlesbare Messzeit ergibt `None`. Nachweis:
  Grenztests grün.

## 2. Backend: Abruf und Endpunkt

- [ ] 2.1 In `src/wetter/abruf.rs` einen dritten `Teil<WetterAktuell>` anlegen: Präfix
  `wetter-aktuell`, TTL 10 min, Obergrenze 3 h, `aktuell_url` mit
  `/current_weather?lat&lon&tz=Etc/UTC`. `anzeige` holt die drei Teile per `tokio::join!` und
  wendet bei der Antwort `frische_messung` an. Modulkopf um den dritten Teil ergänzen.
  Nachweis: Die vorhandenen Tests sind erweitert und grün:
  - `rundung_von_schluessel_und_anfrage` mit Schlüssel und URL;
  - `ohne_ort_kein_abruf` mit drei Teilen `kein_ort`;
  - `kalt_und_ausfall_ist_ausfall`;
  - `kalter_abruf_schreibt_den_cache` mit drei Anfragen, alle mit gerundeter Koordinate.
- [ ] 2.2 Neue Tests in `abruf.rs` für die Stand-Regel des Teils: Ein Cache jünger als 3 h mit
  einer 4 h alten Messung ergibt `ausfall`. Eine 2 h alte Messung bei frischem Cache ergibt `ok`,
  denn „veraltet“ entscheidet das Frontend. Ein Cache älter als 3 h ergibt `ausfall`, Warnungen und
  Vorhersage bleiben dabei `ok`. Nachweis: grün. Gegenprobe: `frische_messung` ausgelassen macht
  den Test rot.
- [ ] 2.3 Schemas in `src/api_doc.rs` eintragen, `scripts/check-typ-codegen.sh` laufen lassen
  und beide generierten Dateien mitcommitten (`src/AGENTS.md`). In `frontend/src/api/types.ts`
  die Aliase `WetterAktuell`, `WetterSymbol`, `WetterMessgroesse` anlegen. Nachweis: Codegen-Prüfung
  grün, `cargo test wetter` grün.

## 3. Ikonen der Wetterlage (Freigabe 01.10.2026)

- [ ] 3.1 Die sieben SVGs aus Icons8 „iOS 27 Outlined“ über den Icons8-MCP nach
  `scripts/ikonen/quellen/` abrufen: 658 `teils-bewoelkt-tag`, 660 `teils-bewoelkt-nacht`,
  2854 `wolke`, 674 `nebel-nacht`, 838 `schneeregen`, 664 `schneewolke`, 666 `hagel`.
  Grundlage ist die Freigabe der PNG-Auswahl am 01.10.2026 (`ikonen-bogen.png`, Schnee B,
  Nebel nach Tageszeit). Nachweis: sieben Dateien, `vergleiche-png.mjs` meldet jede gleich
  dem PNG.
- [ ] 3.2 Register `scripts/ikonen/ikonen.json` um die sieben Einträge ergänzen (Bedeutung
  „Wetter & Pegel; Wetterlage …“, Kennung, `herkunft: icons8`). Bedeutung von `sonne`, `mond`,
  `nebel`, `wind`, `regen` und `gewitterwolke` um die Wetterlage erweitern.
  `erzeuge-ikonen.mjs` laufen lassen. Nachweis: zwei Läufe ohne Diff, Stempel aktualisiert.
  Der Guard ist erst grün, wenn 5.1 die Ikonen verwendet (keine unbenutzte Ikone).

## 4. Frontend: Einordnung und Text

- [ ] 4.1 `wetter/wetterStand.ts`: Teil `aktuell` mit `VERALTET_AB_MS` 90 min und
  `OBERGRENZE_MS` 3 h. `teilStand` nimmt den maßgeblichen Zeitpunkt als Eingabe; für `aktuell`
  ist das `daten.gemessen_at` (design.md D4). Die Meta lautet „Messung 08:00“ statt „Stand …“.
  Nachweis: `wetterStand.test.ts` mit 89/91 min und 2 h 59/3 h 01 grün; Warnungen und
  Vorhersage unverändert.
- [ ] 4.2 `wetter/wetterText.ts`: `wetterSymbolWort` (ein Wort je Wert, design.md D5),
  `sichtText` (unter 1 km in m, sonst km mit einer Stelle), `prozentText`, `druckText` (ganzzahlig hPa) und `ergaenztText` („Station
  Hameln, 12,1 km“ aus `WetterErgaenzung`, über `stationText`). Jede Funktion gibt für einen
  fehlenden Wert einen Strich zurück, nie 0. Nachweis: `wetterText.test.ts` grün, inklusive
  Minus U+2212 beim Taupunkt.

- [ ] 4.3 `wetter/wetterSymbol.ts`: `wetterSymbolIkone` als `Record<WetterSymbol, Ikone>` nach
  der Tabelle in design.md D5. Nachweis: Test je Wert (13 Zeilen), unter anderem `schnee` →
  `IkoneSchneewolke`, `nebel_nacht` → `IkoneNebelNacht`; `tsc -b` schlägt fehl, wenn ein Wert
  fehlt.

## 5. Frontend: Paneel und Seite

- [ ] 5.1 `AktuellPaneel` in `wetter/WetterPaneele.tsx` (design.md D6): `Kennzahlenband` mit
  Temperatur, Wind (Richtung in der Notiz), Böen und Niederschlag in 1 h, darunter
  `Datenraster` mit Wetterlage (Ikone über `wetterSymbolIkone` vor dem Wort), Sicht,
  Bewölkung, Luftfeuchte, Taupunkt und Luftdruck. Ein ergänzter Wert trägt die Station in
  Notiz bzw. Feld. Kopf-Meta mit Station, Messung und
  „veraltet“. Fuß mit Quellenvermerk und „SYNOP“. Für `kein_ort` steht der Satz ohne Knopf, für
  „unbekannt“ „Stand unbekannt“ ohne Werte. Dateikopf ergänzen. Nachweis: Komponententests für
  folgende Fälle:
  - alle Werte vorhanden;
  - ein fehlender Wert zeigt einen Strich;
  - ein ergänzter Wert nennt seine Station, ein Wert der Hauptstation nicht;
  - veraltet;
  - Stand unbekannt ohne Wert;
  - kein Ort ohne Knopf;
  - die Wetterlage zeigt Wort und Ikone, `queryByRole('img')` im Paneel ist leer
    (`aria-hidden`).

  Gegenprobe: Ergänzungshinweis entfernt macht den Test rot.
- [ ] 5.2 `pages/WetterPegelPage.tsx`: Paneel nach den Pegeln, vor Warnungen, im vorhandenen
  Raster. Seitenkopf unverändert. Modulkopf um den dritten Teil ergänzen. Nachweis:
  `WetterPegelPage.test.tsx` erweitert und grün:
  - Literal `wetterOk` mit `aktuell`;
  - Szenario „Ausfall reißt die anderen Teile nicht mit“, also `aktuell: ausfall` neben
    Warnungen und Vorhersage `ok`;
  - Reihenfolge der Paneele.
- [ ] 5.3 `e2e/wetter-pegel.spec.ts`: Literal um `aktuell` ergänzen, mit langem Stationsnamen und
  einer Ergänzung. Querlauf bei 1366/1024/390 px und Kontrast in beiden Modi decken das neue
  Paneel mit ab. Nachweis: Die Spec läuft grün (`mise exec -- pnpm -C frontend exec playwright
  test e2e/wetter-pegel.spec.ts`).

## 6. Abschluss

- [ ] 6.1 Gesamtprüfung: `./scripts/check-all.sh` grün. Belegt wird das durch den lokalen Lauf
  oder die CI des PRs, mit Verweis auf den Lauf.
- [ ] 6.2 Sichtprüfung im Dev-Stack mit einem verorteten Einsatz: Das Paneel zeigt echte Werte
  von Bright Sky. Aufnahme bei 1440 und 390 px, Tag und Nacht, als Anhang am PR. Nachweis:
  Aufnahmen liegen vor.
