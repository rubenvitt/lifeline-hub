# Tasks

Jede Aufgabe entsteht per TDD (Test zuerst rot, dann grün). Bezüge: `design.md` D1–D6, Delta-Specs
`eingabegrenzen` und `instanz-fuehrung`.

## 1. Grenze am Anzeigenamen (Backend)

- [x] 1.1 `auth::ANZEIGENAME_MAX = 200` und `auth::truncate_anzeigename` anlegen (D1, D3); Unit-Test in `src/auth/mod.rs`: 200 Zeichen bleiben, 201 werden zu 200, „ä“ zählt als ein Zeichen
- [x] 1.2 Anlegen und PATCH in `src/routes/benutzer.rs` über `pflicht_max` prüfen (D2); Tests in `tests/benutzer.rs`: Anlegen mit 201 Zeichen ist 400 mit „Anzeigename“ und 200 im Text und ohne neues Konto, 200 „ä“ wird angenommen, PATCH mit 201 Zeichen ist 400 und Name wie Rollen bleiben
- [x] 1.3 `plane_anzeigename` kürzt über `truncate_anzeigename`; Unit-Test in `src/auth/oidc/provisioning.rs`: Claim `name` aus 300 Zeichen ergibt 200
- [x] 1.4 Stammdaten-Übernahme kürzt den Anzeigenamen der Art Konto vor dem Upsert, ohne Hinweis; Test in `tests/instanz_stammdaten.rs` (dort liegen die Tests der Übernahme, `uebernehmen/tests.rs` ist leer): geliefertes Konto mit 300 Zeichen steht mit 200 in `benutzer`, die Kopplung bekommt keinen Hinweis
- [x] 1.5 `spiegel::abbildung::stellvertreter` nutzt `truncate_anzeigename` statt der Zahl 200; die vorhandenen Spiegel-Tests bleiben grün (`cargo test instanz::spiegel`)

## 2. Erklärung der Notübernahme (Backend)

- [x] 2.1 `austausch::ERKLAERUNG_MAX` im Modul `fuehrung` sichtbar machen und `dienst::erklaerung_text` anlegen (D4); Unit-Test: Text mit genau `ERKLAERUNG_MAX` Byte kommt zurück, ein Byte mehr ist 422 mit dem Text aus D4
- [x] 2.2 Beide Baustellen der Erklärung setzen den Unterzeichner über `truncate_anzeigename`; alle drei Stellen aus D4 rufen `erklaerung_text`, kein `e.to_text()` geht mehr ungeprüft in die Akte (`git grep -n 'Some(e.to_text())' src/instanz/fuehrung/dienst.rs` ist leer)
- [x] 2.3 Tests in `tests/instanz_fuehrung.rs`, gegen die erreichte Seite: Erklärung mit genau 4096 Byte gilt und der Hub nimmt die Akte bei der nächsten Meldung an; mit 4097 Byte ist es 422, Führung und Verlauf am ELW sind unverändert (Grund aus Steuerzeichen und ASCII so gewählt, dass die Länge trifft)
- [x] 2.4 Test in `tests/instanz_fuehrung.rs`: Admin mit Bestandsnamen aus 3000 Zeichen (per SQL gesetzt) übernimmt, die gespeicherte Erklärung nennt die ersten 200 Zeichen, der Hub nimmt die Akte an
- [x] 2.5 Tests in `tests/instanz_fuehrung.rs`, am Hub gegen die meldende Seite: `…/notuebernahme/start` und `…/notuebernahme/code` sind bei zu großer Erklärung 422, die Führung bleibt beim ELW, es entsteht kein Verlaufseintrag (dass keine Zeremonie entsteht, trägt die Reihenfolge in `run_start`: der Zeremonie-Speicher ist prozessweit und von einem Test aus nicht abzufragen); dazu am Hub die Kürzung des Unterzeichners vor der Unterschrift (`langer_bestandsname_am_hub_…`)
- [x] 2.6 Mutationsprobe: die Prüfung in `erklaerung_text` und die Kürzung des Unterzeichners je einmal entfernen; mindestens ein Test aus 2.3–2.5 wird jeweils rot, danach zurücknehmen (Ergebnis im Commit-Body). Ergebnis 12.11.2026: ohne Prüfung und ohne Grenzen werden 8 Tests rot (2 Unit-Tests in `dienst`, `erklaerung_ueber_der_grenze_…`, `zu_grosse_erklaerung_am_hub_…`, beide Benutzer-Tests, SSO- und Stammdaten-Test), ohne Kürzung des Unterzeichners die beiden `langer_bestandsname_…`

## 3. Maske der Benutzerverwaltung (Frontend)

- [x] 3.1 `ANZEIGENAME_MAX` in `frontend/src/api/eingabegrenzen.ts` und im Spiegeltest `tests/eingabegrenzen_spiegel.rs` eintragen; `cargo test --test eingabegrenzen_spiegel` grün
- [x] 3.2 Beide Felder „Anzeigename“ in `frontend/src/pages/BenutzerPage.tsx` mit `zeichenGrenze` und `zeichenRegel` (D6); Tests in `BenutzerPage.test.tsx`: 201 Zeichen im Anlegen-Dialog zeigen „201 / 200“ und „zu lang“ und senden nicht; ein vorbelegter Bestandsname über der Grenze bleibt im Bearbeiten-Dialog vollständig stehen und sperrt das Speichern
- [x] 3.3 Der Dialog „Notübernahme …“ im Paneel „Führung“ zeigt den Text des 422; Test in `frontend/src/instanz/FuehrungPaneel.test.tsx` (ergänzen, falls der Fall dort noch nicht belegt ist)

## 4. Doku und Entscheidung

- [x] 4.1 ADR nach D5 anlegen (`docs/architektur/entscheidungen/`, nächste freie Nummer nach `git fetch origin alpha`, Vorlage `VORLAGE.md`); `scripts/adr-fuer.sh src/instanz/fuehrung/dienst.rs` nennt sie, ihr Prüfblock läuft grün
- [x] 4.2 Anwenderkapitel `docs/anwender/kapitel/benutzer.md` (Grenze 200 Zeichen bei Anlegen und Bearbeiten, gekürzte Namen von Hub und SSO) und `instanzkopplung.md` (Notübernahme: Unterzeichner gekürzt, Meldung „Grund kürzen“) nachziehen; der Wächter `anwenderdoku.guard.test.ts` bleibt grün. Bilder des Kapitels `benutzer` nur neu erzeugen, wenn sich die gezeigte Ansicht ändert (der Zähler erscheint erst ab 160 Zeichen)
- [x] 4.3 `docs/architektur/11-risiken-und-technische-schulden.md` prüfen: führt es den Befund aus LLH-1672, als behoben nachziehen; sonst bleibt es unverändert (Ergebnis im Commit-Body). Ergebnis: das Kapitel führt den Befund nicht, keine Änderung

## 5. Gesamtprüfung

- [x] 5.1 `scripts/check-typ-codegen.sh` zeigt keinen Drift (keine DTO-Änderung erwartet). Belegt über die Schritte 1 und 2 des Skripts (`openapi_json_ist_aktuell`, `public_v1_json_ist_aktuell` grün); die Schritte 3 bis 5 brauchen `mise`, das der Cloud-Sitzung fehlt, und fährt die CI des PRs
- [ ] 5.2 `./scripts/check-all.sh --geaendert` grün
- [x] 5.3 Bilder für PR und Meldung aufnehmen: Dialog „Neuen Benutzer anlegen“ mit Anzeigename über der Grenze (Zähler, „zu lang“) und der Dialog „Notübernahme …“ mit der Meldung des 422

## Workflow follow-up

- Review vor dem PR mit frischem Kontext samt Gegenprüfung (`dev-zunder-ausfuehren`, „Review vor dem PR“).
- `/opsx:archive a13nxa2k-notuebernahme-erklaerung-begrenzen` im selben Branch, vor dem PR.
- PR gegen `alpha` mit der Zeile `Zunder: https://zunder.rubeen.dev/#/aufgabe/a13nxa2kw0cmscsasc5mg6x0`, Board-Status `review`.
