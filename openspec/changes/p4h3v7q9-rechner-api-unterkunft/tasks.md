# Tasks

Jede Aufgabe entsteht per `superpowers:test-driven-development`: erst der rote Test, dann der Code.
Vor jeder Änderung `scripts/adr-fuer.sh <pfad>…`. Cargo-Läufe mit dem Bauziel des Checkouts
(`scripts/AGENTS.md`). Kein `| tail` um Gate-Kommandos. Neue Bezeichner nach der Wurzel-`AGENTS.md`,
„Bezeichner-Sprache“.

## 1. Testhelfer für signierte Aufrufe (D8)

- [x] 1.1 `tests/common/maschine.rs` anlegen und in `tests/common/mod.rs` als Untermodul
  eintragen: `schluessel`, `senden`, `einloesen`, `jetzt`, `signiert`, `angebunden` unverändert
  aus `tests/maschinenzugang.rs` übernehmen, dazu `signiert_mit_body` (signiert über den Body und
  sendet ihn). `tests/maschinenzugang.rs` nutzt die Helfer von dort. Eigener `refactor`-Commit.
  Prüfen: `cargo test --test maschinenzugang` ist grün wie vorher, mit derselben Zahl an Tests.

## 2. Basis und Rechenkern (D2, D5)

- [x] 2.1 `src/unterkunft/mod.rs`: `Basiswert` liest zusätzlich `bezeichnung`, `gruppe` und
  `einheit`; `zelttypen()` liefert Typ und Bezeichnung aus der Datei.
  Prüfen: Unit-Test in `src/unterkunft/tests.rs` (erst rot): jeder Basiswert hat eine nicht leere
  Bezeichnung, Gruppe und Einheit; `zelttypen()` nennt `sg20`, `sg30`, `sg40`, `sg50` in dieser
  Reihenfolge.
- [x] 2.2 `src/unterkunft/rechner.rs` anlegen und in `mod.rs` eintragen: Typen `Eingabe` (Enum je
  Weg, gesamt/getrennt im Typ), `Raum`, `Abzug`, `Richtwerte`, `Ergebnis` und die Rundungshelfer
  `glatt`, `auf`, `ab`, `eine_stelle`, `zwei_stellen`, `ganz`; dazu `nutzflaeche` und `zeltmix`.
  Prüfen: Unit-Tests (erst rot) für `nutzflaeche` (nie negativ, zwei Stellen, 0,3 × 40 ergibt 12)
  und `zeltmix` (15 Personen: Rest ins kleinste passende Zelt; 0 Personen: leer).
- [x] 2.3 `rechne(&Eingabe, &Richtwerte) -> Ergebnis` nach `rechnerKern.ts`: Gruppen aus dem Weg,
  Zelte je Typ und Zeltmix je Gruppe, Material, Sanitär, Gesundheit, Versorgung, Verpflegung.
  Prüfen: Unit-Tests der Spec-Szenarien direkt am Kern (erst rot): 50 Männer und 50 Frauen
  (400 m², 100 Feldbetten, 6 Toiletten, 4 Urinale, 20 Waschplätze, 6 Duschen, 2 500 l Wasser);
  zwei Räume mit Abzug (48 + 22 = 70 Plätze).
- [x] 2.4 Wächter: jeder Schlüssel der Basis wird in `src/unterkunft/rechner.rs` gelesen
  (Textsuche über die Datei, Zeltschlüssel über ihr Muster `zelt_<typ>_…`), als Gegenstück zu
  `richtwerte.guard.test.ts`.
  Prüfen: Probe mit einem vorübergehend aus dem Kern entfernten Schlüssel macht den Test rot;
  danach zurücksetzen.

## 3. v1-Schemas, Prüfung und Parität (D3, D4)

- [x] 3.1 `src/public_api/rechner.rs` anlegen und in `public_api/mod.rs` eintragen: `wire_enum!`
  für Weg, Gruppe, Belegung, Zelttyp und Herkunft, Anfrage `UnterkunftRequest`
  (`deny_unknown_fields` auf jeder Ebene, Zahlen als `f64`), Antwort-Typen für das Ergebnis.
  Einträge in `tests/enum_wire_kontrakt.rs`.
  Prüfen: `cargo test --test enum_wire_kontrakt` grün; Unit-Test: der Zelttyp-Enum nennt genau die
  `zelttypen` der Basis.
- [x] 3.2 Prüfung der Anfrage zur Kern-`Eingabe`: erst jedes Feld (400 `invalid_field` mit
  Feldname), dann der Zusammenhang (422 `unprocessable`). Grenzen als Konstanten in
  `src/unterkunft/rechner.rs` (`RAEUME_MAX`, `ABZUEGE_MAX`, `MASS_MAX_M`, `FLAECHE_MAX_M2`,
  `ZELTE_JE_TYP_MAX`, `BEZEICHNUNG_MAX`), Personen über `betreuung::MAX_PERSONEN`.
  Prüfen: Unit-Tests (erst rot), je Zeile der Spec ein Fall:
  - 400: unbekanntes Feld `einsatz_id`, unbekannter `weg`, unbekannte `belegung`, unbekannter
    Zelttyp, negative Zahl, 10,5 Personen, 201 Räume, Abzüge über `ABZUEGE_MAX`, Maß 0 und 1000,5, Fläche über
    1 000 000, 1 000 001 Personen (1 000 000 geht), 1001 Zelte, Bezeichnung mit 81 Zeichen;
    der Text nennt jeweils das Feld.
  - 422: Block fehlt, Block eines anderen Wegs, `gesamt` neben `maenner`, `gesamt` bei Trennung,
    Trennung ohne Gruppe, Raum ohne `belegung` bei Trennung, Raum mit `belegung` ohne Trennung.
  - gültig: ohne Trennung nur `maenner` und `frauen`; leere Raumliste; `personen.gesamt = 0`.
- [x] 3.3 Paritätstest über `tests/fixtures/unterkunft/faelle.json`: je Fall `eingabe` als
  `UnterkunftRequest` einlesen, prüfen, mit Basis plus `richtwerte` rechnen, als `ergebnis`
  serialisieren und mit `erwartet` vergleichen (Zahlen als `f64`, sonst wörtlich, Listen in
  Reihenfolge). Der Test verlangt mindestens 24 Fälle.
  Prüfen: alle Fälle grün. Mutationsproben, jede einzeln und danach zurückgesetzt, machen den Test
  rot: `auf` statt `ab` bei den Plätzen je Raum; Runden vor statt nach dem Summieren der Gruppen
  bei den Toiletten; `glatt` entfernt.
  Befund beim Umsetzen: Ohne `glatt` blieb die Sammlung grün; der Fall `raeume_gleitkomma` braucht
  die Glättung nicht (die Nutzfläche ist schon auf zwei Stellen gerundet). Neu ist der Fall
  `flaeche_gleitkomma_glatt` (220 m² durch 4,4 m², erwartetes Ergebnis aus dem TS-Kern); mit ihm
  ist die Probe rot. Die Sammlung hat damit 25 Fälle.

## 4. Routen (D5, D6)

- [x] 4.1 `POST /api/v1/rechner/unterkunft` in `src/public_api/rechner.rs` und in
  `public_api::router()`: Body aus `client.body`, Prüfung aus 3.2, Org-Werte des Zugangs,
  Werte der Anfrage über `unterkunft::pruefe`, Antwort `UnterkunftResponse` (`ergebnis`,
  `richtwerte` mit `wert` und `herkunft`, `stand`) signiert über `client.antwort`.
  Prüfen: `tests/rechner_api.rs` (erst rot), signiert über `tests/common/maschine.rs`:
  - 100 Personen mit `richtwerte.wasser_je_person_l = 15`: 200, `wasser_l_tag` 1500, Herkunft
    `anfrage`, übrige Schlüssel `basis`, 38 Richtwerte, `stand`, Kopf `lifeline-signature`.
  - `richtwerte.foo = 1`: 400 `invalid_field`, Text nennt `foo`.
  - `richtwerte.wasser_je_person_l = 4`: 400, Text nennt Schlüssel und Grenzen.
  - Org-Wert `flaeche_je_person_m2 = 5` der eigenen Org wirkt mit Herkunft `org`; derselbe Wert
    nur in einer fremden Org wirkt nicht (Herkunft `basis`).
  - `einsatz_id` im Body: 400, Text nennt `einsatz_id`.
  - `weg` `personen` mit Block `raeume`: 422 `unprocessable`.
  - Leerer Body und kaputtes JSON: 400 `invalid_field`.
  - Zugang nur mit `lage:read`: 403 `missing_scope`; ohne Anmeldung: 401 `unauthorized`.
  - Nach einer Rechnung mit eigenem Wert ist `org_unterkunft_richtwert` unverändert.
- [x] 4.2 `GET /api/v1/rechner/unterkunft/richtwerte`: `UnterkunftRichtwerteResponse` mit `stand`,
  `zelttypen` und je Richtwert `schluessel`, `bezeichnung`, `gruppe`, `einheit`, `min`, `max`,
  `ganzzahl`, `basis`, `wert`, `herkunft`.
  Prüfen in `tests/rechner_api.rs` (erst rot): Org-Wert `wasser_je_person_l = 30` ergibt Basis 25,
  Wert 30, Herkunft `org`, Einheit `l`, Grenzen 5 und 500; vier Zelttypen mit Bezeichnung; kein
  Feld `quelle`; ohne Scope 403.
- [x] 4.3 Vertrag nachziehen: `#[utoipa::path]` beider Routen mit `security(("machine" = []))`,
  Tag „Rechner“, Antworten 400, 401, 403, 422, 429 und `default`; Schemas in `PublicApiDoc`;
  `src/public_api/description.md` (Namenstabelle: Pfade `rechner`, `unterkunft`, `richtwerte`;
  Felder `weg`, `trennung`, `richtwerte`, `herkunft`).
  Prüfen: `cargo test --test public_api_spec_aktuell` schreibt `docs/api/public-v1.json` neu und
  ist im zweiten Lauf grün; `cargo test --test public_api` und `cargo test --test maschinenzugang`
  (`jede_route_mit_maschinenanmeldung_traegt_eine_scope_angabe`) grün; die Datei ist committet.

## 5. Doku und Anleitungen

- [x] 5.1 `docs/api/maschinenzugang.md`: Zeile `rechner:use` nennt die beiden Routen; kurzer
  Abschnitt „Rechner Unterkunft“ mit einer Beispielanfrage (ein Fall der Fallsammlung), den
  Ebenen der Richtwerte und dem Hinweis, dass `einsatz_id` noch fehlt.
  Prüfen: die Beispielanfrage steht wörtlich als Fall in `tests/rechner_api.rs` und ergibt 200.
- [x] 5.2 Architektur `docs/architektur/05-bausteinsicht.md`: Zeile `src/unterkunft` nennt den
  Rechenkern, Zeile `src/public_api` die beiden Routen.
  Prüfen: `scripts/check-architektur.sh` grün.
- [x] 5.3 Anwenderdoku: `docs/anwender/kapitel/anbindungen.md` (das Recht „Rechner nutzen“ öffnet
  jetzt die Unterkunftsrechnung mit den Richtwerten der Organisation; der Satz „Heute nutzt ein
  Fremdsystem nur die Prüfung seiner Anmeldung“ wird berichtigt) und
  `docs/anwender/kapitel/betreuung.md` (Abschnitt „Unterkunftsrechner“: Fremdsysteme rechnen über
  eine Anbindung mit denselben Regeln und den Werten der Organisation, nicht mit denen eines
  Einsatzes).
  Prüfen: die Wächter der Anwenderdoku aus `docs/anwender/AGENTS.md` sind grün.
- [x] 5.4 `frontend/src/betreuung/AGENTS.md`, Punkt „Unterkunftsrechner“: zwei Kerne
  (`rechnerKern.ts`, `src/unterkunft/rechner.rs`), eine Fallsammlung für beide, die API prüft
  streng, Ebenen der API ohne Einsatz. Kommentare nachziehen, die den Rust-Kern als „später“
  ankündigen: `src/unterkunft/mod.rs`, `rechnerKern.ts`, `rechnerFixture.test.ts`, `_zweck` in
  `faelle.json`.
  Prüfen: `grep -rn "folgt in LLH-1524\|folgt mit LLH-1524\|spätere Rechner-API\|später auch vom Rust-Kern" src frontend/src tests`
  findet nichts mehr; `mise exec -- pnpm -C frontend exec prettier --check src/betreuung/AGENTS.md`
  grün; der Fixture-Test der Oberfläche (`rechnerFixture.test.ts`) grün.

## 6. Befunde des Reviews vor dem PR

- [x] 6.1 Feldgrenzen gegen die Body-Grenze: `ABZUEGE_MAX` 5; Spec und Anleitung nennen die
  64 KiB als zweite Grenze. Prüfen: `groesste_anfrage_passt_in_den_body` in `tests/rechner_api.rs`
  (200 Räume mit je 5 Abzügen ergeben 200, eine Anfrage über 64 KiB ergibt 413).
- [x] 6.2 Keine negative Null: `glatt` hängt `+ 0.0` an, die Prüfung normalisiert `-0.0` der
  Richtwerte der Anfrage, der Paritätstest vergleicht Bit für Bit. Prüfen:
  `die_antwort_traegt_keine_negative_null`; Probe ohne das `+ 0.0` in `glatt` macht diesen Test
  und den Fall `personen_null` rot. Das `+ 0.0` in `nutzflaeche` sichert nur gegen das bei
  gemischten Nullen offene Vorzeichen von `f64::max`; auf x86-64 lässt es sich nicht rot proben.
- [x] 6.3 Einlesen: Feldpfad über `serde_path_to_error` auch bei falschem Typ, `1e999` als Zahl am
  Feld, doppelte Schlüssel und Listen statt Objekten sind 400. Prüfen:
  `das_einlesen_ist_streng_und_nennt_den_pfad`.
- [x] 6.4 Gruppen als Paar: eine fehlende Gruppe ist 422, mit und ohne Trennung; Spec, Design und
  Anleitung nennen alle 422-Fälle, auch Zelte ohne Trennung und den leeren Block. Prüfen:
  `eine_widerspruechliche_grundlage_ist_422`, `gueltige_randfaelle`.
- [x] 6.5 Anleitung: Fälle der Fallsammlung mit `richtwerte` und ohne Werte der Organisation.
- [x] 6.6 Nachreview des Fix-Commits: Listen-Fälle in voller Feldlänge und für jeden Block, Hinweis
  zur leeren Gruppe je Block (`0` oder `{}`), „Block ohne Angabe“ statt „leer“ (eine leere
  Raumliste ist gültig), Body-Grenze mit „zwei Nachkommastellen“, technische Bezeichner englisch
  (`ObjectOnly`, `normalize_zero`). Prüfen: `das_einlesen_ist_streng_und_nennt_den_pfad`,
  `eine_widerspruechliche_grundlage_ist_422`.

## 7. Gesamtprüfung

- [ ] 7.1 `scripts/check-typ-codegen.sh` grün, `frontend/src/api/openapi.json` und
  `types.generated.ts` unverändert (keine v1-Typen in `api_doc.rs`).
- [ ] 7.2 `./scripts/check-all.sh` grün; ersatzweise in der Cloud-Sitzung die Bündel, die dort
  laufen, und der Rest über die CI des PRs (mit Verweis auf den Lauf abhaken).

## Workflow follow-up

- Folgeaufgabe in Zunder anlegen: `einsatz_id` an der Rechner-API, blockiert durch die
  Einsatz-Freigabe für Zugänge (LLH-1638, LLH-1655); Link in den PR.
- Review vor dem PR (`dev-zunder-ausfuehren`, „Review vor dem PR“), Befunde behandeln.
- `/opsx:archive` im selben Branch, dann der PR gegen `alpha` mit dem Abschnitt „Review“.
