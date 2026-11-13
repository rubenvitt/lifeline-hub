# Tasks

## 1. Ein Spiegel hört nur auf Zuordnungen seiner Org

- [x] 1.1 Die Nachstellung in `tests/instanz_spiegel.rs` wird zum Test „neue Zuordnung an eine andere Org“: Ausgaben und `#[ignore]` entfallen, er prüft, dass `einsatz.org_id`, `kopplung_org_id`, `beendet_at` und die Mitgliedschaften des Spiegels unverändert bleiben, dass der Eintrag „Nach der Neuzuordnung“ fehlt, dass ein Konto der Org Y ohne Systemrolle den Einsatz nicht liest (403) und dass der Absender danach nicht mehr ab 0 liefert. Zuerst rot gegen den heutigen Code (`cargo test --test instanz_spiegel neue_zuordnung_an_eine_andere_org`).
- [x] 1.2 Test „neue Zuordnung an dieselbe Org“: Widerruf, erneutes Koppeln derselben Org X, Abgleich. Der Spiegel lebt wieder auf (`beendet_at` leer, neuer ETB-Eintrag da). Belegt, dass D1 den bisherigen Weg nicht bricht; grün vor und nach der Änderung.
- [x] 1.3 In `src/instanz/spiegel/uebernehmen.rs` (`uebernehmen`) die Prüfung aus design.md D1–D3 einbauen: Org des vorhandenen Spiegels gegen `Empfaenger::org_id`, bei Abweichung Hinweis, `stand = l.bis`, keine `einsatz_id`, Rückkehr vor dem Umhängen. 1.1 wird grün, 1.2 bleibt grün.
- [x] 1.4 Einheitentest in `src/instanz/spiegel/tests.rs` neben den bestehenden `Empfaenger`-Fällen: eine Lieferung über einen `Empfaenger` mit fremder `org_id` an einen vorhandenen Spiegel ändert nichts und liefert `stand = bis` samt Hinweis (`cargo test --lib instanz::spiegel::tests`).
- [x] 1.5 Mutationsprobe: die Prüfung aus 1.3 auskommentieren, 1.1 und 1.4 werden rot; zurücknehmen.

## 2. Abschluss

- [ ] 2.1 `./scripts/check-all.sh` mit den Bündeln für das Backend grün (Format, Clippy-Gate, Tests von `instanz_spiegel`, `instanz_kopplung`, `instanz_fuehrung`); Belege für Schritte, die erst die CI des PRs fährt, mit Verweis auf diesen Lauf.

## Workflow follow-up

- Review vor dem PR (`dev-zunder-ausfuehren`, „Review vor dem PR“).
- `/opsx:archive d86po4bc-spiegel-nur-gleiche-org` im selben Branch vor dem PR.
- PR gegen `alpha`, Zunder-Status `review` samt `pr_url`.
