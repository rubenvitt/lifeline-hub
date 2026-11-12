# Tasks

Code-Aufgaben entstehen per `superpowers:test-driven-development`: zuerst der rote Test, dann der
Code; jede neue Prüfung bekommt eine Gegenprobe (Prüfung entfernt → Test rot). Vor jeder Datei
`scripts/adr-fuer.sh <pfad>` und die `AGENTS.md` auf ihrem Weg. Neue Bezeichner nach der
Wurzel-`AGENTS.md`, „Bezeichner-Sprache“.

## 1. Löschvermerk (D4)

- [x] 1.1 Migration `migrations/0335_fuehrung_loeschvermerk.sql` (Tabelle aus design.md D4, ohne Marker) und Einordnung in die Tabellen-Wächter, die eine neue Tabelle verlangen (`einsatz::schwaerzung_registry`, `instanz::spiegel::art`, soweit sie anschlagen). Prüfen: `cargo test --lib db::tests` und die Wächter-Tests grün, `scripts/check-migrationen.sh` nach `git fetch origin alpha`
- [x] 1.2 Modul `src/instanz/fuehrung/loeschvermerk.rs`: `vermerken` (Kennung, Org), `vermerken_einsatz` (liest Kennung und Org vom Einsatz, ohne Kennung nichts) und `belegte` (eine Abfrage per `json_each`: Vermerk mit aktiv zugeordneter Org der Kopplung, und weder Einsatz noch Akte mit der Kennung); dazu `lebensende::geloeschte_akten` (Vermerk oder `ist_geloescht` für das eigene Präfix). Unit-Tests: Vermerk belegt; Vermerk einer nicht zugeordneten Org belegt nicht; vorhandene Akte oder vorhandener Einsatz belegt nicht; unbekannte Kennung belegt nicht; eigenes Präfix mit Löschprotokoll belegt ohne Vermerk. Prüfen: `cargo test --lib instanz::fuehrung::loeschvermerk instanz::spiegel::lebensende`
- [x] 1.3 Vermerk in der Transaktion der Löschung: `einsatz::skelett_loeschung::loeschen` und `einsatz::abraeumen::ausfuehren` rufen `vermerken_einsatz` neben der Protokollzeile. Tests in den Modul-Tests beider Dateien: nach der Löschung eines Einsatzes mit Kennung steht der Vermerk, ohne Kennung keiner; Gegenprobe Aufruf entfernt → rot. Prüfen: `cargo test --lib einsatz::abraeumen einsatz::skelett_loeschung`. Gegenproben für 1.2–4.1 am 12.11.2026 gefahren: elf Mutationen (Vermerk beim Abräumen und bei der Skelett-Löschung, Führer-, Org- und Schalterprüfung der Annahme, die drei Bedingungen des Belegs, Löschen beim Widerruf, Nennung der erreichten Seite, Vermerk beim Löschen der Akte), jede macht ihren Test rot

## 2. Signal im Abgleich, direktes Paar (D1–D3)

- [x] 2.1 `SpiegelPaket.akten` mit `serde(default)` und Grenzen in `check` (höchstens `EINSAETZE_MAX`, Kennung höchstens 500 Zeichen); Tests in `paket::tests`: Paket ohne das Feld lesbar, Liste über der Grenze und überlange Kennung ungültig. Prüfen: `cargo test --lib instanz::spiegel::paket`
- [x] 2.2 `fuehrung::repo::list_ohne_spiegel` (Schalter an, aktive Zuordnungen der Kopplung, `einsatz_id IS NULL`; an der erreichten Seite nur mit dem Gegenüber als Führer) samt Auswahl reihum; Unit-Tests für beide Richtungen, Schalter aus und mehr als `EINSAETZE_MAX`. Prüfen: `cargo test --lib instanz::fuehrung::repo`
- [x] 2.3 Annahme in `lebensende::geloescht_uebernehmen`: Zweig für Akten ohne Spiegel nach design.md D3 (löscht Akte, schreibt Vermerk; Spiegel-Zweig unverändert). Unit-Tests in `lebensende/tests.rs`: Akte des Gegenübers wird gelöscht und vermerkt; an der erreichten Seite bleibt die Akte eines anderen Führers; Akte einer nicht zugeordneten Org bleibt; Akte mit lokalem Einsatz bleibt; Schalter aus → bleibt. Gegenprobe je Bedingung. Prüfen: `cargo test --lib instanz::spiegel::lebensende`
- [x] 2.4 Abgleich verdrahten (`abgleich.rs`): meldende Seite nennt in der Anfrage und übernimmt `geloescht` aus der Antwort; erreichte Seite belegt die genannten Akten in der Antwort, nennt ihre eigenen dort, und die meldende Seite belegt sie für die nächste Runde (`geloescht_offen`). Integrationstests in `tests/instanz_fuehrung.rs` mit zwei Instanzen: „der Hub löscht einen nie gespiegelten Einsatz“ (Pull), „der ELW löscht einen nie gespiegelten Einsatz“ (Push), „der Einsatz besteht weiter“, „Rückkehr aus einer Sicherung“ (Einsatz am Führer ohne Protokoll und Vermerk entfernt → Akte bleibt). Prüfen: `cargo test --test instanz_fuehrung akte_ohne_spiegel`
- [x] 2.5 Älteres Gegenüber: Test, dass ein Paket ohne `akten` am neuen Stand nichts löscht und eine Antwort ohne `geloescht` die Akte stehen lässt (Unit-Test am Handler oder Integrationstest mit geleertem Feld). Prüfen: derselbe Lauf wie 2.4, dazu `cargo test --test instanz_lebensende --test instanz_spiegel` unverändert grün. Umgesetzt als: `paket::tests` (Paket ohne `akten` lesbar und leer), `ohne_schalter_bleibt_jede_akte`, `akte_ohne_spiegel_bleibt_wenn_dem_gegenueber_der_beleg_fehlt` (keine Antwort → Akte bleibt); beide Suiten unverändert grün

## 3. Weitergabe über die erreichte Seite (D4)

- [x] 3.1 Integrationstest mit drei Instanzen (`weiterer_elw`): „ELW 1“ führt einen abgeschlossenen Einsatz, „ELW 2“ hält nur die Akte über den Hub; nach der Löschung an „ELW 1“ verliert erst der Hub, dann „ELW 2“ die Akte. Dazu: „ELW 2“ meldet die Kennung von „ELW 1“ als gelöscht → Akte am Hub bleibt (als Unit-Test `die_erreichte_seite_loescht_nur_akten_die_der_absender_fuehrt`: Der Hub nennt „ELW 2“ diese Akte gar nicht, über die Leitung lässt sich der Fall nicht auslösen). Prüfen: `cargo test --test instanz_fuehrung zwei_elw_loesch`
- [x] 3.2 Integrationstest „verwahrter Einsatz mit der Kennung des ELW“: Der Hub übernimmt einen Einsatz von „ELW 1“ zur Verwahrung, löscht ihn später endgültig, und „ELW 2“ verliert die Akte (Beleg über den Vermerk trotz fremdem Präfix). Prüfen: derselbe Lauf wie 3.1
- [x] 3.3 Test „die Akte kommt wieder“: Vermerk vorhanden, Akte neu geliefert → die Kennung wird nicht belegt und die Akte bleibt beim Gegenüber (`nach_neuer_kopplung_stehen_die_akten_wieder_und_bleiben`, dazu `eine_genannte_akte_gilt_nur_mit_beleg_als_geloescht`). Prüfen: `cargo test --test instanz_fuehrung nach_neuer_kopplung`

## 4. Widerruf (D5)

- [x] 4.1 `fuehrung::repo::release_nach_widerruf` löscht und vermerkt die Akten ohne Spiegel, die das widerrufene Gegenüber führt; Unit-Test in `fuehrung::repo::tests` (Akte des Gegenübers weg samt Vermerk, Akte eines Dritten und Akte mit Einsatz bleiben), Gegenprobe. Prüfen: `cargo test --lib instanz::fuehrung::repo`
- [x] 4.2 Integrationstest mit drei Instanzen: Widerruf von „ELW 1“ am Hub → der Hub zeigt nur noch die Einsätze von „ELW 2“, „ELW 2“ verliert die Akten von „ELW 1“ nach seinem Abgleich; neue Zuordnung → die Akten von „ELW 1“ stehen wieder am Hub (zwei Tests: `widerruf_einer_von_zwei_elw_…`, `nach_neuer_kopplung_…`). Prüfen: `cargo test --test instanz_fuehrung widerruf_einer nach_neuer_kopplung`
- [x] 4.3 Kommentar an `list_fremde_der_org` berichtigen (kein Verweis mehr auf LLH-1699, Restfall „ELW an zwei Hubs“ genannt). Prüfen: `git grep -n "LLH-1699" src` zeigt nur gewollte Stellen

## 5. Doku und Regeln

- [x] 5.1 `docs/anwender/kapitel/instanzkopplung.md`, Hintergrund zu „Einsätze beim Gegenüber“: Der Satz „… bleibt stehen“ wird ersetzt (ein beim Gegenüber gelöschter Einsatz verschwindet mit dem nächsten Abgleich; beim Widerruf fallen die Einsätze des widerrufenen Gegenübers heraus); `quellen:` um die geänderten Dateien. Regeln aus `docs/anwender/AGENTS.md` beachten. Prüfen: Anwenderdoku-Wächter grün (`pnpm exec vitest run src/hilfe/anwenderdoku.guard.test.ts` in `frontend/`)
- [x] 5.2 `src/AGENTS.md`, „Instanzkopplung“ → „Lebensende“: Wer einen Einsatz endgültig löscht, schreibt neben dem Löschprotokoll den Löschvermerk; `geloescht` für eine genannte Akte nur mit Beleg; Annahmeregel der erreichten Seite. Herleitung verweist auf diese Change. Prüfen: Prettier/Markdown-Gates aus `check-all.sh` grün, Datei bleibt lesbar gegliedert
- [x] 5.3 Architekturdoku nach `docs/architektur/AGENTS.md` (Mitänderungsregel, design.md D6): neue `ADR-0029` (Entscheidung der Route `entwurf`) mit Regeln und Prüfung, Laufzeitsicht (Kapitel 6, Lebensende) um das Ende einer Akte ohne Spiegel, Glossar (Kapitel 12) um „Löschvermerk“. Prüfen: `scripts/check-architektur.sh` grün, `scripts/adr-fuer.sh src/instanz/fuehrung/loeschvermerk.rs` nennt ADR-0029

## 6. Abschluss

- [ ] 6.1 `cargo test` für die Bereiche (`--lib instanz::`, `--lib einsatz::`, `--test instanz_fuehrung --test instanz_lebensende --test instanz_spiegel --test instanz_kopplung`), `scripts/check-fmt.sh`, dann `./scripts/check-all.sh` (in der Cloud-Sitzung das Bündel, das die Umgebung trägt; der volle Lauf ist die CI des PRs)
- [ ] 6.2 Review vor dem PR über den ganzen Branch (`dev-zunder-ausfuehren`, „Review vor dem PR“), bestätigte Befunde behandelt
- [ ] 6.3 Bilder der Änderung: „Einsätze beim Gegenüber“ vor und nach dem Abgleich, sofern der Bildlauf zwei gekoppelte Instanzen trägt; sonst im PR ein Satz, warum es kein Bild gibt (die Liste verliert nur eine Zeile, belegt durch die Integrationstests)

## Workflow follow-up

- `/opsx:archive h7shm5au-loeschsignal-spiegellose-akten` im selben Branch vor dem PR (Spec-Sync nach `openspec/specs/instanz-fuehrung`)
- PR gegen `alpha`, Zunder LLH-1699 auf `review` samt `pr_url`; Folgeaufgabe LLH-1852 im PR verlinken
