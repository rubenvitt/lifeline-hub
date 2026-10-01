# Tasks

Jede Aufgabe per `superpowers:test-driven-development`: erst der rote Test, dann der Code.
Wo „Gegenprobe“ steht, wird der Kern der Änderung kurz zurückgenommen und der Test muss rot
werden.

## 1. Backend: Auswertung von `/current_weather`

- [ ] 1.1 Antwort aufzeichnen: `/current_weather?lat=52.00&lon=9.50&tz=Etc/UTC` (Hameln, mit
  Rückgriff auf drei Stationen) nach `src/wetter/testdaten/current_weather.json` speichern, dazu
  `null` an einem Wert der Hauptstation und eine `condition`, die es nicht gibt, in einer
  Kopie im Test. Nachweis: Datei liegt vor, Kopf des Tests nennt Herkunft und Ergänzungen.
- [ ] 1.2 DTOs in `src/wetter/mod.rs` anlegen: `WetterAktuell`, `WetterStation`,
  `WetterErgaenzung`, Enums `WetterLage` und `WetterMessgroesse` (per `wire_enum!`),
  `WetterAktuellTeil`, Feld `aktuell` in `WetterAnzeige`. Doku-Kommentare je Feld mit Fenster
  und Einheit (design.md D3). Nachweis: `cargo build` grün.
- [ ] 1.3 `quelle::parse_current_weather` per TDD (design.md D3):
  - Hauptstation aus `source_id`;
  - Fenster 10/60/60 für Wind, Böen, Niederschlag;
  - `null` und fehlende Werte ergeben `None`, nie 0;
  - unbekannte `condition` ergibt `None` und eine Log-Zeile;
  - `fallback_source_ids` werden nur für gezeigte Felder je Station gruppiert, in fester
    Reihenfolge;
  - eine Quelle ohne Eintrag in `sources[]` fällt aus `ergaenzt` heraus, ihr Wert bleibt;
  - eine Antwort ohne `weather` ergibt `None`.

  Nachweis: Tests in `quelle.rs` grün. Gegenprobe: Böe auf `wind_gust_speed_10` umgestellt
  macht den Test rot.
- [ ] 1.4 `quelle::frische_messung(aktuell, jetzt)` per TDD: Eine Messung, die älter als 3 h ist,
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
  die Aliase `WetterAktuell`, `WetterLage`, `WetterMessgroesse` anlegen. Nachweis: Codegen-Prüfung
  grün, `cargo test wetter` grün.

## 3. Frontend: Einordnung und Text

- [ ] 3.1 `wetter/wetterStand.ts`: Teil `aktuell` mit `VERALTET_AB_MS` 90 min und
  `OBERGRENZE_MS` 3 h. `teilStand` nimmt den maßgeblichen Zeitpunkt als Eingabe; für `aktuell`
  ist das `daten.gemessen_at` (design.md D4). Die Meta lautet „Messung 08:00“ statt „Stand …“.
  Nachweis: `wetterStand.test.ts` mit 89/91 min und 2 h 59/3 h 01 grün; Warnungen und
  Vorhersage unverändert.
- [ ] 3.2 `wetter/wetterText.ts`: `wetterlageWort`, `sichtText` (unter 1 km in m, sonst km mit
  einer Stelle), `prozentText`, `druckText` (ganzzahlig hPa) und `ergaenztText` („Station
  Hameln, 12,1 km“ aus `WetterErgaenzung`, über `stationText`). Jede Funktion gibt für einen
  fehlenden Wert einen Strich zurück, nie 0. Nachweis: `wetterText.test.ts` grün, inklusive
  Minus U+2212 beim Taupunkt.

## 4. Frontend: Paneel und Seite

- [ ] 4.1 `AktuellPaneel` in `wetter/WetterPaneele.tsx` (design.md D6): `Kennzahlenband` mit
  Temperatur, Wind (Richtung in der Notiz), Böen und Niederschlag in 1 h, darunter
  `Datenraster` mit Wetterlage, Sicht, Bewölkung, Luftfeuchte, Taupunkt und Luftdruck. Ein
  ergänzter Wert trägt die Station in Notiz bzw. Feld. Kopf-Meta mit Station, Messung und
  „veraltet“. Fuß mit Quellenvermerk und „SYNOP“. Für `kein_ort` steht der Satz ohne Knopf, für
  „unbekannt“ „Stand unbekannt“ ohne Werte. Dateikopf ergänzen. Nachweis: Komponententests für
  folgende Fälle:
  - alle Werte vorhanden;
  - ein fehlender Wert zeigt einen Strich;
  - ein ergänzter Wert nennt seine Station, ein Wert der Hauptstation nicht;
  - veraltet;
  - Stand unbekannt ohne Wert;
  - kein Ort ohne Knopf.

  Gegenprobe: Ergänzungshinweis entfernt macht den Test rot.
- [ ] 4.2 `pages/WetterPegelPage.tsx`: Paneel nach den Pegeln, vor Warnungen, im vorhandenen
  Raster. Seitenkopf unverändert. Modulkopf um den dritten Teil ergänzen. Nachweis:
  `WetterPegelPage.test.tsx` erweitert und grün:
  - Literal `wetterOk` mit `aktuell`;
  - Szenario „Ausfall reißt die anderen Teile nicht mit“, also `aktuell: ausfall` neben
    Warnungen und Vorhersage `ok`;
  - Reihenfolge der Paneele.
- [ ] 4.3 `e2e/wetter-pegel.spec.ts`: Literal um `aktuell` ergänzen, mit langem Stationsnamen und
  einer Ergänzung. Querlauf bei 1366/1024/390 px und Kontrast in beiden Modi decken das neue
  Paneel mit ab. Nachweis: Die Spec läuft grün (`mise exec -- pnpm -C frontend exec playwright
  test e2e/wetter-pegel.spec.ts`).

## 5. Abschluss

- [ ] 5.1 Gesamtprüfung: `./scripts/check-all.sh` grün. Belegt wird das durch den lokalen Lauf
  oder die CI des PRs, mit Verweis auf den Lauf.
- [ ] 5.2 Sichtprüfung im Dev-Stack mit einem verorteten Einsatz: Das Paneel zeigt echte Werte
  von Bright Sky. Aufnahme bei 1440 und 390 px, Tag und Nacht, als Anhang am PR. Nachweis:
  Aufnahmen liegen vor.
