# Tasks

## 1. Ein Spiegel hört nur auf Zuordnungen seiner Org

- [x] 1.1 Die Nachstellung in `tests/instanz_spiegel.rs` wird zum Test „neue Zuordnung an eine andere Org“: Ausgaben und `#[ignore]` entfallen, er prüft, dass `einsatz.org_id`, `kopplung_org_id`, `beendet_at` und die Mitgliedschaften des Spiegels unverändert bleiben, dass der Eintrag „Nach der Neuzuordnung“ fehlt, dass ein Konto der Org Y ohne Systemrolle den Einsatz nicht liest (403) und dass der Absender für die Zuordnung der Org Y keinen Stand über 0 hat (design.md D2). Zuerst rot gegen den heutigen Code (`cargo test --test instanz_spiegel neue_zuordnung_an_eine_andere_org`).
- [x] 1.2 Test „neue Zuordnung an dieselbe Org“: Widerruf, erneutes Koppeln derselben Org X, Abgleich. Der Spiegel lebt wieder auf (`beendet_at` leer, neuer ETB-Eintrag da). Belegt, dass D1 den bisherigen Weg nicht bricht; grün vor und nach der Änderung.
- [x] 1.3 In `src/instanz/spiegel/uebernehmen.rs` (`uebernehmen`) die Prüfung aus design.md D1–D3 einbauen: Org des vorhandenen Spiegels gegen `Empfaenger::org_id`, bei Abweichung Hinweis, `stand = 0`, keine `einsatz_id`, Rückkehr vor dem Umhängen. 1.1 wird grün, 1.2 bleibt grün.
- [x] 1.4 Einheitentest in `src/instanz/spiegel/tests.rs` neben den bestehenden `Empfaenger`-Fällen: eine Lieferung über einen `Empfaenger` mit fremder `org_id` an einen vorhandenen Spiegel ändert nichts und liefert `stand = 0` samt Hinweis (`cargo test --lib instanz::spiegel::tests`).
- [x] 1.5 Mutationsprobe: die Prüfung aus 1.3 auskommentieren, 1.1 und 1.4 werden rot; zurücknehmen.

## 2. D2 nach dem Review: Stand 0

- [x] 2.1 Integrationstest (1.1) und Einheitentest (1.4) erwarten Stand 0 statt des Endes der Lieferung und werden gegen den Stand aus 1.3 rot (`cargo test --test instanz_spiegel neue_zuordnung_an_eine_andere_org`, `cargo test --lib instanz::spiegel::tests::eine_zuordnung_einer_anderen_org`).
- [x] 2.2 `uebernehmen` meldet bei Abweichung `stand = 0`; Kommentar dort und ADR-0039, Regel 3, nachziehen. Beide Tests werden grün, `cargo test --test instanz_spiegel` und `cargo test --lib instanz::spiegel::tests` bleiben grün.
- [x] 2.3 Mutationsprobe: `stand = l.bis` zurück einsetzen, 2.1 wird rot; zurücknehmen.

## 3. Abschluss

- [x] 3.1 `./scripts/check-all.sh` mit den Bündeln für das Backend grün (Format, Clippy-Gate, Tests von `instanz_spiegel`, `instanz_kopplung`, `instanz_fuehrung`); Belege für Schritte, die erst die CI des PRs fährt, mit Verweis auf diesen Lauf. Lokal (13.11.2026): `cargo fmt --check` sauber, `scripts/check-architektur.sh` grün, `cargo test --lib instanz::` und die Suiten `instanz_*` grün; Bündel `schnell` und `rust` belegt die CI des PRs (in der Cloud-Sitzung fehlt `mise`, und alle Testbinaries passen nicht auf die Platte).

## Workflow follow-up

- Review vor dem PR (`dev-zunder-ausfuehren`, „Review vor dem PR“).
- `/opsx:archive d86po4bc-spiegel-nur-gleiche-org` im selben Branch vor dem PR.
- PR gegen `alpha`, Zunder-Status `review` samt `pr_url`.
