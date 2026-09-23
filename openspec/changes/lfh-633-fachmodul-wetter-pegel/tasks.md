# Tasks

Jede Aufgabe entsteht test-first (`superpowers:test-driven-development`): erst der rote Test,
dann der Code. Die Berührpunkte eines neuen Moduls folgen dem Muster LFH-635
(`openspec/changes/lfh-635-fachmodul-abloesung/tasks.md`). Kein Test geht ins Netz: Bright
Sky und PEGELONLINE werden über `FachebenenState`-Basis-URLs auf lokale Stubs gelenkt.

## 1. Backend: Pegelverlauf

- [x] 1.1 `src/pegel/abruf.rs`:
  - `messungen_url` fragt `start=P1D` ab (Test `url_und_schluessel` angepasst);
  - neu: `reihen(fe, pool, uuids, modus) -> HashMap<String, Vec<Messpunkt>>` über denselben
    `reihe_fuer`-Weg;
  - `messungen` baut darauf auf.

  Verifiziert durch `cargo test --lib pegel::abruf`. Die Bestandstests bleiben grün, der neue
  Test „reihen liefert die Cache-Reihe unverändert“ kommt dazu.
- [x] 1.2 `src/pegel/trend.rs`: reine Funktion `verlauf(reihe) -> Vec<Messpunkt>`:
  - sortiert aufsteigend;
  - schneidet alles älter als 24 h vor dem jüngsten Punkt ab;
  - dünnt über 288 Punkten auf 288 Buckets aus, je Bucket der letzte Punkt, der jüngste
    Punkt bleibt erhalten.

  Verifiziert durch Unit-Tests: unsortierte Eingabe, 25-h-Reihe, 1-min-Reihe mit 1440
  Punkten → ≤ 288, jüngster Punkt erhalten, leere Reihe.
- [x] 1.3 DTOs `PegelVerlauf { pegel_id, punkte }` und `PegelVerlaufPunkt { zeitpunkt,
  wasserstand_cm }` in `src/pegel/mod.rs`. Route `GET /api/einsaetze/{id}/pegel/verlauf`
  (`EinsatzLesezugriff<OhneModul>`, Reihenfolge der Pegel, Station ohne Stand → leere
  `punkte`) in `src/routes/pegel.rs` + `src/app.rs`. Verifiziert durch `tests/pegel.rs`:
  - Verlauf aus vorbelegtem Cache in Pegel-Reihenfolge;
  - Station ohne Cache → leere Reihe, kein Warten über die Frist;
  - Beobachter liest (200);
  - fremde Org → 403 (Org-Floor; Spec angeglichen), unbekannter Einsatz → 404.

  Umgesetzt mit einer Abweichung: eine fremde Org bekommt **403**, nicht 404. Das ist der
  Org-Floor des Einsatz-Kontexts (`berechtigung::fordere_org_zugehoerigkeit`), plattformweit
  und auch für `GET …/pegel`. Ein unbekannter Einsatz ist 404. Gleiches gilt für 3.2.

## 2. Backend: Wetter-Unterbau

- [x] 2.1 `src/karte/mod.rs`:
  - `FachebenenState` erhält `wetter_basis_url` mit Vorgabe
    `BRIGHTSKY_BASIS_URL = "https://api.brightsky.dev"` und dem Setter `mit_wetter_basis_url`;
  - neu ist das eigene Abkühlungsfeld `wetter_fehlschlag`.

  Verifiziert durch `cargo test --lib karte` und den Build aller Test-Konstruktionen (Memory
  `appstate-feld-bricht-test-konstruktionen`).
- [x] 2.2 `src/wetter/mod.rs` + `src/wetter/quelle.rs`:
  - DTOs `WetterAnzeige`, `WetterOrt`, `WetterTeilZustand` (`ok|kein_ort|ausfall`),
    `WetterWarnungen`, `WetterWarnung`, `WetterVorhersage`, `WetterStunde`;
  - Enum `WetterWarnstufe` (`gering|maessig|schwer|extrem`, `as_str`);
  - reine Parser `parse_alerts(&Value) -> Option<(Option<WetterOrt>, Vec<WetterWarnung>)>`
    und `parse_weather(&Value) -> Option<WetterVorhersage>`;
  - reiner Filter `gueltige(warnungen, jetzt)`, der abgelaufene entfernt und nach Stufe
    absteigend, dann nach Beginn sortiert.

  Verifiziert durch Unit-Tests mit **mitgeschnittenen** Bright-Sky-Antworten als Testdaten
  (`src/wetter/testdaten/`, Abruf am 23.09.2026, Koordinaten gerundet). Die Tests decken ab:
  - Abbildung aller vier `severity`-Werte;
  - unbekannte `severity` → `gering`;
  - `category=health` gefiltert;
  - `expires` in der Vergangenheit gefiltert;
  - `null`-Werte bleiben `None` und werden nicht zu 0;
  - Station und Entfernung aus `sources`.
- [x] 2.3 `src/wetter/abruf.rs`: SWR nach dem Muster von `pegel::abruf`:
  - Schlüssel `wetter-warnungen:<lat2>,<lon2>` / `wetter-vorhersage:<lat2>,<lon2>`;
  - TTL 5 min / 30 min;
  - Obergrenze 6 h / 12 h → `ausfall`;
  - In-flight-Marke mit Drop-Guard, Abkühlung 60 s, Frist 8 s;
  - `abgerufen_at` = jetzt − Cache-Alter;
  - `kein_ort` ohne Abruf.

  Verifiziert durch Tests mit lokalem Stub (Muster `stumme_quelle`/`quelle_404` in
  `pegel::abruf`):
  - frisch ohne Netz;
  - abgelaufen → sofort alter Stand und genau ein Hintergrundabruf;
  - kalt + Ausfall → `ausfall`;
  - Cache älter als die Obergrenze → `ausfall`;
  - Abkühlung;
  - abgebrochener Abruf gibt die Marke frei;
  - abgelaufene Warnung verschwindet aus altem Stand;
  - Rundung des Schlüssels.

## 3. Backend: Route, Gates, Codegen

- [x] 3.1 `src/einsatz/modul.rs`:
  - `wetter-pegel` in `MODUL_KEYS` (29) hinter `gefahrenzonen`;
  - Marker `WetterPegel => "wetter-pegel"`;
  - `PFAD_KEY` `("/api/einsaetze/{id}/wetter", Some("wetter-pegel"))`;
  - Doc-Kommentar zum Drift-Test auf `tests/modul_override.rs` korrigiert.

  Verifiziert durch die Unit-Tests in `modul.rs`.
- [x] 3.2 `src/routes/wetter.rs` + `routes/mod.rs` + `app.rs`: `GET /api/einsaetze/{id}/wetter`
  mit `EinsatzLesezugriff<WetterPegel>`. Der Einsatzort kommt aus `einsatzort_lat/lon`. Der
  Nachschlage-Cache-Pool wird gewählt wie in `routes::pegel::anzeige`. Verifiziert durch
  `tests/wetter.rs` (Stub-Quelle):
  - ohne Ort → `kein_ort` für beide Teile und keine Anfrage am Stub;
  - mit Ort → Warnungen samt Gemeindename und Vorhersage;
  - Stub tot → `ausfall` für beide, trotzdem 200;
  - Beobachter liest;
  - Modul ausgeblendet → 403;
  - fremde Org → 403 (Org-Floor; Spec angeglichen), unbekannter Einsatz → 404.
- [x] 3.3 Guards:
  - `MODUL_GET_PFADE` in `tests/modul_override.rs` bekommt `("wetter-pegel", "wetter")`;
  - `einsatz_kontext_guard` bleibt ohne Ausnahme grün.

  Verifiziert durch `cargo test --test modul_override --test einsatz_kontext_guard`.
- [x] 3.4 OpenAPI:
  - Schemas der neuen DTOs und `WetterWarnstufe`/`WetterTeilZustand` in `src/api_doc.rs`;
  - `enum_wire!`-Blöcke in `tests/enum_wire_kontrakt.rs`;
  - `scripts/check-typ-codegen.sh` laufen lassen und `openapi.json`/`types.generated.ts`
    mitcommitten;
  - Re-Exporte in `frontend/src/api/types.ts`.

  Verifiziert durch `cargo test --test enum_wire_kontrakt`, `cargo test --test
  openapi_spec_aktuell` und das grüne Codegen-Skript.

  Stand vor dem Commit: `enum_wire_kontrakt`, `openapi_spec_aktuell` und `tsc` sind grün,
  die Dateien sind regeneriert. Rot ist nur der Diff-Schritt des Skripts, weil die
  regenerierten Dateien noch nicht committet sind.

## 4. Frontend: Unterbau

- [x] 4.1 API und Keys:
  - `api/pegel.ts` bekommt `ladeVerlauf(einsatzId)` und `pegelVerlaufAbfrage`;
  - neu `api/wetter.ts` mit `ladeWetter` und `wetterAbfrage`, Nachfrage `PEGEL_ABRUF_MS`;
  - `queryKeys.ts` bekommt `einsatzKeys.pegelVerlauf(id)` als Sub-Key von `einsatz-pegel`
    und `EINSATZ_KEYS.wetter = 'einsatz-wetter'` in `NICHT_LIVE_KEYS`;
  - `routing/deeplinks.ts` bekommt `wetterPegelPfad`.

  Verifiziert durch:
  - `queryKeys.test.ts` (Literal-Pin der zwei neuen Keys);
  - `queryKeys.guard.test.ts`;
  - `liveEvent.contract.test.ts` (Klassifikation genau einmal);
  - `deeplinks.test.ts`.
- [x] 4.2 `pegel/pegelKennzahl.ts`:
  - neue exportierte Ableitung `pegelZeile(p, jetzt, konv)` für **eine** Station: Wert,
    Einheit, Trendtext, Stand, veraltet, Ausfall, Prognosetext;
  - `pegelKennzahl` nutzt sie für den Leitpegel.

  Verifiziert durch `pegelKennzahl.test.ts`. Die Bestandstests bleiben unverändert grün, neu
  kommen Tests für eine Station ohne Messung, mit veralteter und mit frischer Messung dazu.
- [x] 4.3 `wetter/wetterStand.ts`:
  - reine Einordnung eines Teils mit `ok` + `abgerufen_at` gegen `jetzt`: aktuell, veraltet
    ab 30 min bzw. 3 h;
  - `ausfall` → „Stand unbekannt“;
  - Aufteilung der Warnungen in „gilt jetzt“ und „angekündigt“;
  - 3-h-Auswahl der Vorhersagestunden;
  - Windrichtung als Himmelsrichtung.

  Verifiziert durch Unit-Tests mit Grenzfällen: genau 30 min, 30 min + 1 s, Beginn = jetzt,
  0°/359°/null.
- [x] 4.4 `theme/statusFarben.ts`: Vertragskarte `dwdWarnstufe` nach design.md D6. Der
  Abdeckungstest wächst von 20 auf 21, samt Literal-Liste. Verifiziert durch `pnpm vitest
  run src/theme`.
- [x] 4.5 `wetter/Verlaufslinie.tsx` mit reiner, exportierter `verlaufsPfad(punkte, breite,
  hoehe)`. Vor dem Bauen den Skill `dataviz` laden. Verifiziert durch Tests:
  - Pfad für drei Punkte;
  - waagerechte Reihe ohne Division durch 0;
  - ein Punkt;
  - Prognose-Hilfslinie nur bei gültiger Prognose;
  - `aria-label` mit Spanne und Richtung;
  - keine Farbe als einziger Träger.

## 5. Frontend: Seite und Wege

- [x] 5.1 Registry und Router:
  - Registry-Eintrag `wetter-pegel`: Kategorie `lage`, Label „Wetter & Pegel“, Ikone aus
    `react-icons/tb`, Route `wetter-pegel`, Status `fertig`, hinter `gefahrenzonen`;
  - `App.tsx` `MODUL_ELEMENTE`;
  - `EinsatzLayout.test.tsx` bekommt die Lage-Key-Liste mit neuem Key, ohne den veralteten
    `kraefteuebersicht`.

  Verifiziert durch `modulRegistry.test.ts`, `EinsatzLayout.test.tsx` und den Backend-Guard
  `backend_modul_keys_decken_frontend_registry`.
- [x] 5.2 `pages/WetterPegelPage.tsx` mit Paneel Pegel:
  - `EinsatzSeite` mit `dataUpdatedAt` und Primäraktion „Pegel festlegen“ als Link;
  - Liste je Pegel aus `pegelZeile` mit `Verlaufslinie`;
  - Leerzustand „kein Pegel festgelegt“ mit Weg zu den Einstellungen;
  - Ausfall „—“ und „Stand unbekannt“ ohne Linie.

  Verifiziert durch `WetterPegelPage.test.tsx`: Reihenfolge, veraltet-Marke, Ausfall ohne
  Linie, Leerzustand, genau eine Primäraktion im Kopf-Slot.
- [x] 5.3 Paneele Warnungen und Vorhersage:
  - Gemeinde und Stand im Kopf;
  - Abschnitte „gilt jetzt“/„angekündigt“;
  - `StatusChip` mit Stufenwort;
  - Inline-Expander für Beschreibung und Handlungsempfehlung;
  - Vorhersage in 3-h-Zeilen mit Station, Entfernung und Quellenvermerk;
  - Zustände `kein_ort` (Hinweis + Link Einsatzdaten), `ausfall` („Stand unbekannt“, keine
    Liste) und veraltet.

  Verifiziert durch Tests je Zustand, darunter: Ausfall der Warnungen lässt den Pegelbereich
  unberührt, und ein fehlender Einzelwert zeigt „—“ statt 0.
- [x] 5.4 Wege:
  - `lagebild.ts` nimmt `pegelZiel` als Eingabe;
  - `LageDashboardPage` und die Überblick-Marke `pegelprognose` entscheiden über
    `darfZaehlerLaden('wetter-pegel', …)` zwischen `wetterPegelPfad` und
    `einsatzEinstellungenPfad(id, 'pegel')`.

  Verifiziert durch die Testpaare „Modul sichtbar → Modulseite“ und „Modul ausgeblendet →
  Einstellungen“ in `lagebild.test.ts` und `UeberblickPage.test.tsx`.

## 6. Abschluss

- [x] 6.1 e2e: neue hermetische Spec `e2e/wetter-pegel.spec.ts` (`page.route`-Fixtures nach
  dem Muster `pegel-pruefliste.spec.ts`). Sie prüft:
  - „Stand unbekannt“ bei Wetterausfall, während die Pegelwerte stehen bleiben;
  - veraltet-Marke;
  - kein waagerechter Überlauf bei 390/1024/1366 px;
  - Trefffläche der Links über zwei Dichtestufen (Böden als Literale);
  - Kontrast der Stufen-Chips mit `kontrast-kern.ts` (Tag ≥ 7:1, Nacht ≥ 5:1).

  Die Route kommt außerdem in `gate1-ueberlauf.spec.ts`. Verifiziert durch `pnpm e2e` auf
  diese Specs.
- [ ] 6.2 Prüfliste Einsatztauglichkeit `docs/superpowers/specs/2026-09-23-lfh-633-pruefliste.md`
  nach dem Muster LFH-635: 15 Kriterien, jede Zeile mit Verdikt und Beleg. Sie enthält das
  bewertete Restrisiko „Koordinate an Dritten“ aus design.md. Verifiziert durch Lesen: keine
  Zeile „nicht geprüft“.
- [x] 6.3 Folgetickets per `clickup-task-anlegen`:
  - DWD-Kartenebene ohne Alterskennzeichnung sowie Farb-/Emoji-Abweichung im
    `FachebenenInspector`;
  - Unwetterwarnung als Modulzähler/Hinweis (Alarmbudget).

  Verifiziert durch die angelegten Task-IDs im Abschlussbericht.
- [ ] 6.4 Browser-Sichtprüfung im Dev-Stack mit Seeds:
  - Einsatz mit Einsatzort und festgelegtem Pegel: Verlauf, Warnungen, Vorhersage;
  - Einsatz ohne Ort;
  - Hell/Dunkel.

  Verifiziert durch Screenshots.
- [ ] 6.5 Voller Gate-Lauf `./scripts/check-all.sh` grün. Verifiziert durch Exit-Code 0.
