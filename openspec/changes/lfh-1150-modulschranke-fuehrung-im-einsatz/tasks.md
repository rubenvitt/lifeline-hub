# Tasks

Jede Aufgabe entsteht per TDD (`superpowers:test-driven-development`): erst der rote Test, dann
der Code.

## 1. Backend: Stufe und Auswertung

- [ ] 1.1 `src/einsatz/modul.rs`: `BENOETIGTE_ROLLEN` um `einsatzfuehrung` erweitern, Doc-Kommentar anpassen; `benoetigte_rolle_validierung` deckt den neuen Wert ab und weist `einsatzleitung` weiter ab (`cargo test einsatz::modul`)
- [ ] 1.2 `modul_freigabe` bekommt `einsatz_rolle: Option<EinsatzRolle>` und wertet `einsatzfuehrung` nach D2 aus; unbekannter Wert sperrt (D6). Unit-Tests in `berechtigung.rs`: Einsatzleitung und Führungspersonal ohne Org-Rolle durch, Beobachter und Nicht-Mitglied gesperrt, Org-Führungskraft ohne Mitgliedschaft durch, `fuehrungskraft` lässt die Einsatzleitung ohne Org-Rolle weiter nicht durch, Org-Vorgabe `einsatzfuehrung` ohne Override wirkt, unbekannter Wert sperrt (`cargo test einsatz::berechtigung`)
- [ ] 1.3 Parameter durch `fordere_modul_zugriff`, `fordere_modul_zugriff_laden`, `modul_freigaben`, `erlaubte_module` ziehen; `gesperrt_fuer_einfaches_mitglied` gibt `None` weiter (D4). `cargo build` grün, kein Aufrufer ohne Rolle
- [ ] 1.4 `EinsatzKontext::modul_rolle()` (Gerät → `None`, sonst `rolle`) und in allen Modul-Gates des Kontexts sowie den Aufrufern in `routes/{live,modul_zaehler,einsatz,lage_snapshot,betreuung,lage_zone,einsatz_person}.rs` verwenden; `routes/vorlagendokument.rs` reicht die geladene Rolle durch; `fuehrung/aufloesung.rs::laden_fuer`/`darf_stab_lesen` bekommen die Rolle vom Aufrufer. Unit-Test für `modul_rolle()` mit und ohne Gerät
- [ ] 1.5 Validierung in `routes/einsatz.rs` (Override-PUT) und `routes/org_einstellungen.rs` (Org-Vorgabe) nimmt `einsatzfuehrung` an; Doc-Kommentare der DTOs nennen den Wert. Integrationstests in `tests/modul_override.rs` und für die Org-Vorgabe: `einsatzfuehrung` → 200, `einsatzleitung` → 400 ohne Änderung
- [ ] 1.6 Integrationstests in `tests/modul_freigaben.rs` für die Szenarien der Spec: Einsatzleitung ohne Org-Rolle bei `einsatzfuehrung` bekommt Freigabe `zugriff: true` **und** Listen-Endpunkt 200; Beobachter 403; Org-Vorgabe `einsatzfuehrung`; Altwert `fuehrungskraft` sperrt die Einsatzleitung weiter. Dazu Modulzähler und Live-Filter für dieselbe Einsatzleitung (`tests/modul_zaehler.rs`), damit kein Konsument die Rolle verliert
- [ ] 1.7 Gerät: Integrationstest, dass ein UHS-Tablet bei `personen` auf `einsatzfuehrung` 403 bekommt und die Geräteliste `personen` in den Sperren der Ansichten führt (`tests/` neben den bestehenden Geräte-Tests)
- [ ] 1.8 `scripts/check-typ-codegen.sh` ausführen und beide generierten Dateien mitcommitten, falls sie sich ändern

## 2. Frontend: Auswahl und Benennung

- [ ] 2.1 `api/types.ts`: Union von `benoetigte_rolle` um `'einsatzfuehrung'` erweitern; `tsc` grün
- [ ] 2.2 `pages/einstellungen/optionen.ts`: `ROLLEN_OPTIONEN` in der Reihenfolge Frei (alle) · Führung im Einsatz · Führungskraft der Organisation · Admin. Test pinnt Reihenfolge und Namen
- [ ] 2.3 `EinsatzModule.tsx`: `orgRollenHinweis` liest den Namen aus `ROLLEN_OPTIONEN` und kennt `einsatzfuehrung`; Test: Org-Vorgabe `einsatzfuehrung` zeigt „Vorgabe der Organisation: Führung im Einsatz“, Altwert `fuehrungskraft` zeigt „Führungskraft der Organisation“
- [ ] 2.4 `ModulEinstellungsListe.tsx`: Rollenspur so verbreitern, dass „Führungskraft der Organisation“ nicht abgeschnitten wird; bestehenden Spurtest auf den neuen Wert ziehen. `EinsatzDefaults.tsx` (Org-Vorgabe) übernimmt die Optionen ohne eigene Liste — Test, dass dort dieselben vier Stufen stehen
- [ ] 2.5 Frontend-Gates: `mise exec -- pnpm -C frontend lint`, `typecheck`, `vitest` für `pages/einstellungen` grün; Prettier über geänderte Dateien

## 3. Anwenderdoku

- [ ] 3.1 `docs/anwender/kapitel/einsatz-einstellungen.md`, Abschnitt „Was ‚Sichtbar‘ und ‚Benötigte Rolle‘ bewirken“: beide Stufen erklären (Führung im Einsatz: Einsatzleitung, Führungspersonal, Org-Führungskräfte, System-Admins; Führungskraft der Organisation: nur Org-Rolle), gekoppelte Geräte zählen nicht als Führung; Bildunterschrift von `module.png` angleichen
- [ ] 3.2 `docs/anwender/kapitel/verwaltung.md`, „Module für alle Einsätze auf eine Rolle beschränken“ und „Rollen-Vorgabe“: neue Namen, Verweis auf die Erklärung im Kapitel „Einstellungen des Einsatzes und Module“ statt eigener Wiederholung
- [ ] 3.3 Bilder neu erzeugen, die die Rollenspalte zeigen (`pnpm doku:bilder --grep einsatz-einstellungen`, ggf. `verwaltung`), und committen; `anwenderdoku.guard.test.ts` grün

## 4. Abschluss

- [ ] 4.1 `./scripts/check-all.sh` grün (Verweis auf den CI-Lauf des PRs, falls lokal ein Schritt nicht läuft)
- [ ] 4.2 Review nach `superpowers:requesting-code-review`, bestätigte Findings eingearbeitet

## Workflow follow-up

- `/opsx:archive lfh-1150-modulschranke-fuehrung-im-einsatz` im selben Branch vor dem PR (Spec-Sync nach `openspec/specs/modul-freigabe`).
- PR gegen `alpha`, Board-Status `in review`; nach Merge `shipped`.
