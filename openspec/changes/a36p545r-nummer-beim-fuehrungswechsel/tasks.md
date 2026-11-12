# Tasks

Jede Aufgabe per `superpowers:test-driven-development`: erst der Test, der ohne die Änderung rot
ist, dann der Code. Tests im Backend mit `cargo test --test <datei> <name>`.

## 1. Nummernvergabe gemeinsam nutzbar machen (design.md D2)

- [ ] 1.1 `nummer_freimachen` aus `src/instanz/spiegel/lebensende.rs` nach `src/instanz/spiegel/nummer.rs` verschieben und in `ensure_freie_nummer` umbenennen (`pub(super)`), Aufruf in `lebensende::umwandeln` nachziehen. Eigener `refactor`-Commit ohne Verhaltensänderung. Verifikation: `cargo test --test instanz_lebensende mit_fuehrung_verwahrt_der_hub_auch_bei_belegter_nummer` und `cargo test --lib instanz::spiegel::lebensende` grün.

## 2. Führungswechsel bei belegter Nummer (design.md D1, D3, D4)

- [ ] 2.1 Test `notuebernahme_bei_gleicher_einsatznummer` (`tests/instanz_fuehrung_live.rs`, steht rot im Branch) ausbauen: Hub mit `E-2026-0001` und `E-2026-0002` eigen, Spiegel `E-2026-0001`. Nach der Notübernahme mit Code erwartet: 200, der übernommene Einsatz trägt am Hub `E-2026-0003`, die beiden eigenen behalten ihre Nummern, das ETB des übernommenen Einsatzes hat genau einen Systemeintrag mit `E-2026-0003` und `E-2026-0001`. Nach `melden(&elw)` trägt der Spiegel am ELW `E-2026-0003`, ebenso `einsatz_fuehrung.nummer` an beiden Seiten. Die Zeilen `eprintln!` und `let _ = live;` fallen weg. Verifikation: rot vor 2.4, grün danach.
- [ ] 2.2 Test `uebergabe_an_den_hub_bei_gleicher_einsatznummer` (`tests/instanz_fuehrung.rs`): Der Hub hat einen eigenen Einsatz mit der Nummer des ELW-Einsatzes; der ELW übergibt regulär an den Hub (`…/fuehrung/uebergeben`) und meldet sich. Erwartet: Der Hub führt den Einsatz mit einer freien Nummer, die Meldung endet ohne Fehler (`letzter_fehler` der Kopplung leer), eine zweite Meldung ändert nichts mehr. Belegt den Weg über `austausch::apply_eingang`. Verifikation: rot vor 2.4 (die Meldung scheitert), grün danach.
- [ ] 2.3 Test `anfrage_des_elw_bei_gleicher_einsatznummer` (`tests/instanz_fuehrung.rs`, Muster `elw_fragt_an_und_uebernimmt_bei_ankunft`): Der ELW übergibt seinen ersten Einsatz an den Hub, legt einen neuen an (bekommt dieselbe Nummer, weil Spiegel nicht mitzählen; der Test prüft das als Voraussetzung) und fragt den ersten zurück. Erwartet: Der ELW führt den ersten Einsatz wieder, mit einer freien Nummer und dem Systemeintrag; der neue Einsatz behält seine Nummer. Verifikation: rot vor 2.4, grün danach.
- [ ] 2.4 `werde_fuehrer` in `src/instanz/spiegel/fuehrung.rs`: nach dem Lesen von `hoechster_stand` und vor dem `DELETE FROM einsatz_spiegel` die Nummer über `nummer::ensure_freie_nummer` frei machen, unter dem Merker `spiegel_uebernahme` (setzen und nur zurücknehmen, wenn er vorher nicht stand; der Merker fällt auch bei einem Fehler der Anweisung, Muster `werde_spiegel`). Nach dem `DELETE` bei einer Umnummerierung den Systemeintrag aus D4 über `etb::system_audit_tx` schreiben (Akteur `einsatz::repo::ermittle_system_akteur`, Startwert `einsatz::einstellungen::etb_startwert`); ohne Akteur `tracing::warn!` und kein Eintrag. Modulkommentar von `fuehrung.rs` um den Satz zur Nummer ergänzen. Verifikation: 2.1 bis 2.3 grün, dazu `cargo test --test instanz_fuehrung`, `cargo test --test instanz_fuehrung_live`, `cargo test --test instanz_lebensende` und `cargo test --lib instanz::spiegel`.
- [ ] 2.5 Test `freie_nummer_bleibt_beim_fuehrungswechsel` (`tests/instanz_fuehrung.rs`): Der Hub hat keinen eigenen Einsatz mit der Nummer des Spiegels und übernimmt. Erwartet: Nummer unverändert, kein Systemeintrag zur Nummer. Verifikation: grün mit 2.4; als Mutationsprobe die Bedingung `belegt` in `ensure_freie_nummer` kurz auf „immer“ stellen und sehen, dass der Test rot wird.
- [ ] 2.6 Test `rueckfall_nach_widerspruch_gelingt_bei_umnummeriertem_einsatz` (`tests/instanz_fuehrung.rs`, Muster `widerspruch_heisst_rueckuebernahme`): Der Hub übernimmt mit Unterschrift bei gleicher Nummer (umnummeriert), der ELW widerspricht, danach zwei Meldungen. Erwartet: Der Hub hält den Einsatz wieder als Spiegel mit der Nummer des ELW, die Meldungen enden ohne Fehler, der Systemeintrag zur Nummer liegt am Hub in der Bruchstelle. Hält das Risiko aus design.md fest. Verifikation: grün mit 2.4; scheitert der Rückfall, ist das ein Befund für den Menschen, kein stiller Umbau.
- [ ] 2.7 Test ohne Akteur als Unit-Test in `src/instanz/spiegel/tests.rs` (dort gibt es Einsätze ohne Konten): Spiegel mit belegter Nummer, Akte nennt diese Instanz als Führer, `richte_aus`. Erwartet: Der Einsatz ist eigen und umnummeriert, kein ETB-Eintrag, kein Fehler. Zweiter Fall im selben Modul: Die Nummer steht nur im Löschprotokoll der Organisation, auch dann wird umnummeriert. Verifikation: rot, wenn der fehlende Akteur einen Fehler liefert bzw. die Prüfung des Löschprotokolls fehlt.
- [ ] 2.8 Setup von `tests/instanz_fuehrung_live.rs` vereinfachen: Der `UPDATE` „Nummern ab 900“ und sein Kommentar entfallen, die zwei eigenen Einsätze des Hubs bleiben (getrennte Einsatz-IDs auf dem gemeinsamen Verteiler). Verifikation: `cargo test --test instanz_fuehrung_live` grün.

## 3. Doku und Regeln

- [ ] 3.1 `docs/anwender/kapitel/instanzkopplung.md`, Absatz „Einsatznummern vergibt jede Installation selbst …“: ergänzen, dass ein übernommener Einsatz eine neue Nummer bekommt, wenn die Installation die Nummer schon vergeben hat, und dass das Einsatztagebuch beide nennt. Kein neues Bild (die Oberfläche ändert sich nicht). `quellen:` im Kopf um `src/instanz/spiegel/nummer.rs` ergänzen, falls `src/instanz/spiegel/` dort nicht schon als Ordner steht. Verifikation: Wächter der Anwenderdoku nach `docs/anwender/AGENTS.md` grün (`anwenderdoku.guard.test.ts`), Prettier über die Datei.
- [ ] 3.2 `docs/architektur/11-risiken-und-technische-schulden.md`, R30: Folge und Fundstelle nachziehen (beim Übergang zum eigenen Einsatz vergibt `spiegel::nummer` eine freie Nummer; abgestimmte Nummernkreise bleiben offen). Verifikation: `scripts/check-architektur.sh` grün.
- [ ] 3.3 `src/AGENTS.md`, „Instanzkopplung“, Punkt „Führung je Einsatz“: ein Satz, dass ein Weg, der `einsatz_spiegel` entfernt, vorher `spiegel::nummer::ensure_freie_nummer` ruft (heute `fuehrung::werde_fuehrer` und `lebensende::umwandeln`). Verifikation: Datei bleibt lesbar, Verweis `scripts/adr-fuer.sh src/instanz/spiegel/nummer.rs` nennt die erwarteten ADRs.

## 4. Abschluss

- [ ] 4.1 `./scripts/check-all.sh` ist grün (lokal mindestens `--nur schnell` und die Rust-Tests der berührten Dateien; die volle Suite belegt die CI des PRs).

## Workflow follow-up

- Review vor dem PR (`dev-zunder-ausfuehren`, „Review vor dem PR“), bestätigte Befunde behandeln.
- `/opsx:archive a36p545r-nummer-beim-fuehrungswechsel` im selben Branch vor dem PR, Spec-Sync nach `openspec/specs/einsatznummer/`.
- PR gegen `alpha` mit dem Abschnitt „Review“; Bilder entfallen (keine sichtbare Änderung der Oberfläche, ein Satz dazu im PR).
