# Tasks

## 1. Herkunft am Raum festhalten — LLH-1445 (`d25v3ukf`), Backend

- [ ] 1.1 Migration `0250_einheit_nachforderung_am_raum.sql` (design.md D1) mit Test `db::tests::migration_0250_*` (Vorgabe 0, CHECK lehnt 2 ab); `scripts/check-migrationen.sh` gegen `origin/alpha` grün.
- [ ] 1.2 Rust-Test in `bereitstellungsraum::eintreffen`: Eintreffen mit Verweis setzt `nachforderung_am_raum = 1` für bekannte Einheit, unangemeldet angelegte und Fahrzeug→Einheit; derselbe Verweis noch einmal ändert nichts. Erst rot sehen, dann `verknuepfe_tx` umsetzen, grün.
- [ ] 1.3 Rust-Test in `einheit::aus_nachforderung`: Übernahme setzt 0, Storno setzt 0 zurück. `uebernehmen_tx` und `stornieren_tx` nachziehen, grün.
- [ ] 1.4 `einheit_ids_am_raum` in `ANZEIGE_SELECT` und `NachforderungAnzeige` (D1); Rust-Test am Lesen (eine am Raum, eine übernommen → nur die erste im neuen Feld). `scripts/check-typ-codegen.sh` und beide generierten Dateien mitcommitten.

## 2. Karte trennt die Wege — LLH-1445 (`d25v3ukf`), Frontend

- [ ] 2.1 Vitest in `nurVorwaerts.test.ts`: Zuordnung je Einheit (am Raum laut Feld, Status zugesagt/unterwegs → am Raum, sonst übernommen). Erst rot sehen, dann `einheitenEinleitung` zu einer Zuordnung je Einheit umbauen (D2), grün.
- [ ] 2.2 Vitest an der Karte (Szenarien „Eingetroffen mit beiden Wegen“, „Ohne Freigabe Einheiten“, „Verknüpfung vor dieser Änderung“). Erst rot sehen, dann `UebernommeneEinheiten` in zwei Gruppen umsetzen, grün; bestehende Karten-Tests bleiben grün.
- [ ] 2.3 Anwenderdoku prüfen (`docs/anwender/`, Kapitel Nachforderungen): beschreibt sie die Einleitung der Karte, den Satz anpassen nach `docs/anwender/AGENTS.md`; sonst Vermerk im PR.

## 3. Übernahme überführt ein Fahrzeug ohne Einheit — LLH-1448 (`n11hhwje`)

- [ ] 3.1 Refactor ohne Verhaltensänderung: `fahrzeug_zur_einheit_tx` aus `fahrzeug_als_einheit_tx` ziehen (D3) und `austritt_fahrzeug_bei_entlassung_tx` zu `austritt_fahrzeug_tx(…, notiz)` machen; bestehende Tests in `eintreffen` und zum Entlassen bleiben grün.
- [ ] 3.2 Rust-Test für `check_namen_uebernahme_tx` (D4): Einheit → 422, Fahrzeug mit Einheit → 422, genau ein Fahrzeug ohne Einheit → `Some`, zwei → 422, frei → `None`. Erst rot sehen, dann umsetzen, grün.
- [ ] 3.3 Rust-Test „RTW 2 steht als Fahrzeug im Einsatz“: Übernahme gelingt (vorher 422), die Einheit trägt Typ, Fahrzeug und Besatzung, angelegt = 1, genau ein ETB-Eintrag im Wortlaut der Spec. Erst rot sehen, dann D5 Schritte 1, 3, 4 und D6 umsetzen, grün; Unit-Test für `etb_text` mit „aus Fahrzeug“ und Besatzung.
- [ ] 3.4 Rust-Test „Fahrzeug steht im BR Nord“ (mit und ohne Haken): Austritt des Fahrzeugs mit Notiz, Eintritt der Einheit zum alten Zeitpunkt, `nachforderung_belegung_id` gesetzt. Erst rot sehen, dann D5 Schritte 2 und 5 umsetzen, grün.
- [ ] 3.5 Rust-Test „Storno der Überführung“: Einheit aufgelöst, Fahrzeug und Besatzung ohne Einheit; „Zwei gleichnamige Fahrzeuge ohne Einheit“ → 422, nichts angelegt. Grün.
- [ ] 3.6 `Uebernommen` um `fahrzeug_ids` und `br_ids` erweitern, die Route `aus_nachforderung` meldet Live für sie und die Besatzung (D5); bestehender Routentest bzw. ein neuer in `tests/` belegt die Antwort.

## 4. Storno nach Verknüpfung am Raum — LLH-1449 (`zglesj5a`)

- [ ] 4.1 Rust-Tests „Am Raum verknüpft, dann Storno“ (D7) für bekannte Einheit und Fahrzeug→Einheit: aktiv, gleicher Raum, kein Austritt im Verlauf, ETB „Verknüpfung gelöst“. Ohne Codeänderung grün; Mutationsprobe (Storno bucht testweise aus) macht ihn rot.

## 5. Abschluss

- [ ] 5.1 `./scripts/check-all.sh` grün (lokal `--geaendert` vor dem PR, voll in der CI des PRs).

## Workflow follow-up

- Review (Fan-out und `requesting-code-review`), dann `/opsx:archive` im selben Branch, danach PR gegen `alpha` mit den Zunder-Zeilen aller drei Unteraufgaben.
- Board: LLH-1445, LLH-1448, LLH-1449 auf `review` samt `pr_url`, nach dem Merge `done`; danach LLH-1021 auf `done`.
