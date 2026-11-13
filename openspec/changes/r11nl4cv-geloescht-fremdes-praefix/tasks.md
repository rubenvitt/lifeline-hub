# Tasks

Jede Aufgabe per `superpowers:test-driven-development`: erst der Test, rot gesehen, dann der
Code. Gegenprobe heißt: die Änderung zurücknehmen, Test rot, wieder einsetzen.

## 1. Senden: ein Beleg für Stände und Akten (design.md D1)

- [x] 1.1 Unit-Tests in `src/instanz/spiegel/lebensende/tests.rs`: (a) ein genannter Stand mit fremdem Präfix gilt mit Löschvermerk einer Org der Kopplung als gelöscht; (b) ein abgeräumter Spiegel mit eigenem Präfix (Löschprotokoll Art `spiegel`) belegt nichts; (c) Löschprotokoll einer Org, die der Kopplung nicht zugeordnet ist, belegt nichts; (d) ohne Vermerk und Protokoll (Rückkehr aus Sicherung) nichts; (e) steht hier eine Akte mit der Kennung, nichts. Prüfen: Tests rot gegen den heutigen Stand (mindestens a und b). Ergebnis 13.11.2026: `ein_stand_gilt_mit_demselben_beleg_wie_eine_akte_als_geloescht` rot (alter Beleg meldete fremde Org und abgeräumten Spiegel, nicht den Vermerk), danach grün
- [x] 1.2 `geloeschte` bekommt `kopplung_id` und belegt über dieselbe private Funktion wie `geloeschte_akten` (Vermerk über `loeschvermerk::belegte`, sonst `is_altbestand_geloescht`); `ist_geloescht` entfällt; Aufrufe in `abgleich.rs` (Pull in `handle_abgleich`, Push für `geloescht_offen` in `abgleich_einmal`) ziehen nach; Modulkopf von `lebensende.rs` nachgezogen. Prüfen: Tests aus 1.1 grün, `cargo test --lib instanz::spiegel::` grün, Gegenprobe rot

## 2. Annehmen: die Akte entscheidet (design.md D2)

- [x] 2.1 Unit-Tests: (a) Schalter an, Akte nennt den Absender, Kennung mit fremdem Präfix → Spiegel dieser Kopplung vorgemerkt und Vermerk geschrieben; (b) Schalter an, Akte nennt eine andere Instanz, Präfix des Absenders passt → nichts vorgemerkt; (c) Schalter aus oder keine Akte → Präfixregel wie bisher; (d) Spiegel einer anderen Kopplung → nichts. Prüfen: (a) und (b) rot gegen den heutigen Stand. Ergebnis 13.11.2026: `mit_schalter_entscheidet_die_akte_ueber_das_abraeumen` rot, `ohne_schalter_gilt_nur_das_praefix` grün als Regressionsnetz; nach 2.2 beide grün, `cargo test --lib instanz::spiegel::` 95 grün
- [x] 2.2 Führerprüfung neben `fuehrt_laut_akte` in `src/instanz/spiegel/fuehrung.rs` (Akte vor Präfix, nur mit Schalter), in `geloescht_uebernehmen` vor dem Vormerken; Doc-Kommentare nennen die Regel. Prüfen: Tests aus 2.1 grün, Gegenprobe rot

## 3. Integration über zwei Instanzen (Spec-Delta `instanz-fuehrung`)

- [ ] 3.1 `tests/instanz_fuehrung.rs` (Abschnitt neben „Akten ohne Spiegel“): Hub übernimmt einen abgeschlossenen Einsatz des ELW (Notübernahme oder Übergabe über vorhandene Helfer), löscht ihn endgültig (Skelett-Löschung) → nach dem nächsten Abgleich ist der Spiegel am ELW abgeräumt (Pull). Prüfen: Test grün, rot ohne 1.2 oder 2.2
- [ ] 3.2 Umgekehrt: ELW übernimmt einen Einsatz des Hubs und löscht ihn endgültig → der Hub räumt seinen Spiegel mit dem nächsten Abgleich des ELW ab (Push). Prüfen: Test grün, rot ohne 1.2 oder 2.2
- [ ] 3.3 Rückkehr aus einer Sicherung: Hub mit gelöschtem Vermerk und Protokoll (Stand vor der Löschung nachgestellt, Einsatz nicht mehr da) meldet nichts, der Spiegel am ELW bleibt. Prüfen: Test grün
- [ ] 3.4 Zwei ELW an einem Hub: ELW 1 meldet den Einsatz, den laut Akte ELW 2 führt, als gelöscht → der Spiegel am Hub bleibt (Szenario „Ein ELW meldet den Einsatz eines anderen“). Prüfen: Test grün, `tests/instanz_lebensende.rs` ohne Schalter (vorhandene Tests zum Löschen) unverändert grün

## 4. Doku und Regeln

- [x] 4.1 Neue ADR (nächste freie Nummer, heute `ADR-0039`, design.md D5) mit Regeln und Prüfung (`verbiete 'fn ist_geloescht\('`, `verlange` auf die Führerprüfung in `lebensende.rs`); ADR-0036 bleibt unverändert. Prüfen: `scripts/check-architektur.sh` grün, `scripts/adr-fuer.sh src/instanz/spiegel/lebensende.rs` nennt die neue ADR
- [x] 4.2 Laufzeitsicht (Kapitel 6, „Lebensende“: Beleg über Vermerk auch für Stände, Annahme laut Akte) und Glossar („Löschvermerk“: Beleg auch für Stände von Spiegeln). Prüfen: `scripts/check-architektur.sh` grün
- [x] 4.3 `src/AGENTS.md`, „Instanzkopplung“ → „Lebensende“ und „Akten ohne Spiegel“: Satz zum Beleg für `geloescht` und zur Annahme nach der Akte, Verweis „(Spiegel mit fremdem Präfix: LLH-1852)“ ersetzt durch die Regel samt Herleitung auf diese Change. Prüfen: Verweise per `grep -rn "LLH-1852" src docs .claude` stimmig
- [x] 4.4 Anwenderdoku `docs/anwender/kapitel/instanzkopplung.md` („Stehen bleibt auch ein Einsatz, dessen Führung abgegeben wurde und den die übernehmende Installation löscht“ entfällt) und, falls nötig, `aufbewahrung.md` (Satz zum Löschen beim Führer), `quellen:` geprüft; Regeln aus `docs/anwender/AGENTS.md`. Prüfen: Anwenderdoku-Wächter grün (`pnpm exec vitest run src/hilfe/anwenderdoku.guard.test.ts` in `frontend/`, über `mise exec`)

## 5. Abschluss

- [ ] 5.1 `cargo test --lib instanz::` und `--lib einsatz::`, `--test instanz_fuehrung --test instanz_lebensende --test instanz_spiegel`, `scripts/check-fmt.sh`, dann `./scripts/check-all.sh` im Bündel, das die Umgebung trägt (der volle Lauf ist die CI des PRs). Prüfen: alles grün, Messung hier vermerkt
- [ ] 5.2 Review vor dem PR über den ganzen Branch (`dev-zunder-ausfuehren`, „Review vor dem PR“), bestätigte Befunde behandelt und im PR unter „Review“. Prüfen: Verbleib je Befund festgehalten
- [ ] 5.3 Bilder der Änderung: keine sichtbare Wirkung außer einer verschwundenen Zeile in „Einsätze beim Gegenüber“; der Bildlauf kennt keine zwei gekoppelten Instanzen. Im PR ein Satz, warum es kein Bild gibt. Prüfen: Satz steht im PR

## 6. Aus dem Review vor dem PR

- [x] 6.1 Befund „eine Runde mehr je Abgleich, wenn die erreichte Seite ein Ende mit fremdem Präfix ablehnt“ (bestätigt): mit Ruben hingenommen, in design.md „Risks“ und ADR-0039 „Konsequenzen“ festgehalten. Prüfen: beide Stellen nennen den Fall, `scripts/check-architektur.sh` grün
- [x] 6.2 Befund „Anwenderdoku verschweigt die Ausnahme bei ausgeschalteter Führung“ (bestätigt) und „Modulkopf `loeschvermerk.rs` nennt nur Akten“ (bestätigt): behoben in f9ee2fb3 (`instanzkopplung.md`, auch Abschnitt „Ende eines Spiegels“, `aufbewahrung.md`, Modulkopf). Prüfen: Anwenderdoku-Wächter 9/9 grün
- [x] 6.3 Verworfen: Sicherungstest baue nicht den Spec-Fall (prüft gewollt den strengeren Fall ohne Einsatz; „Einsatz oder Akte wieder da“ decken Unit-Tests ab, Testkommentar geschärft) und fehlende Zunder-Zeile in zwei Zwischencommits (Regel gilt je Aufgabe, PR trägt sie). Prüfen: Verbleib im PR unter „Review“

## Workflow follow-up

- `/opsx:archive r11nl4cv-geloescht-fremdes-praefix` im selben Branch vor dem PR (Spec-Sync nach `openspec/specs/instanz-fuehrung`)
- PR gegen `alpha`, Zunder LLH-1852 auf `review` samt `pr_url`
