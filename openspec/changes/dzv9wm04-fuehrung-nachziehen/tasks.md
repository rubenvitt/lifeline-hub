# Tasks

Code-Aufgaben entstehen per `superpowers:test-driven-development`: zuerst der rote Test, dann der
Code; jede neue Prüfung bekommt eine Gegenprobe (Prüfung entfernt → Test rot). Vor jeder Datei
`scripts/adr-fuer.sh <pfad>`. Jede Aussage in Doku und Spec ist am Code belegt; die Quelle des
Wortlauts steht in der Aufgabe.

## 1. Verlauf der Führung ohne Gerätekonten (D1)

- [x] 1.1 Integrationstest in `tests/instanz_fuehrung.rs`: ein Gerätekonto (Lagemonitor) mit Lesezugriff auf den Einsatz ruft `GET /api/einsaetze/{id}/fuehrung` ab → 403; ein Mitglied mit der Rolle Beobachter → 200 mit Verlauf. Die 403 trägt schon die Routenliste der Geräte (design.md D1), daher kein Handler-Code; Doc-Kommentar an `src/routes/fuehrung.rs::lesen` nennt den Leserkreis. Prüfen: `cargo test --test instanz_fuehrung den_verlauf_lesen`
- [x] 1.2 Gegenprobe und Nutzer prüfen: Route vorübergehend in `geraet::ALLE_ANSICHTEN` → 1.1 rot (200 statt 403); `git grep -n "loadFuehrung" frontend/src` zeigt keinen Aufruf aus `frontend/src/geraet/` (Geräte nutzen weder `EinsatzLayout` noch `EinsatzdatenPage`)

## 2. Beweiswahl nur für Admins (D2)

- [x] 2.1 `fuehrungText.test.ts`: `fuehrungMoeglich(f, { admin })` liefert `unterschrift` nur bei `notuebernahmeMitBeweis` und `admin`; `fuehrungText.ts` entsprechend erweitern (Funktion bleibt rein). Prüfen: `mise exec -- pnpm exec vitest run src/instanz/fuehrungText.test.ts` in `frontend/`
- [x] 2.2 `FuehrungPaneel.test.tsx`: Einsatzleitung ohne Admin-Rolle sieht im Dialog „Notübernahme …“ keine Wahl „Eigene Unterschrift“, sondern das Feld „Code“, und das Absenden ruft den Code-Weg; ein Admin sieht „Beweis“ mit beiden Wahlen. Danach `FuehrungPaneel` (Prop für Admin aus `istAdmin(benutzer)` in `EinsatzdatenPage.tsx`, auf `EinsaetzeBeimGegenueber.tsx` immer Admin) und Anfangswert `beweis` nach Rolle. Prüfen: `mise exec -- pnpm exec vitest run src/instanz/` in `frontend/`, Gegenprobe Bedingung entfernt → rot
- [x] 2.3 (aus dem Review) Integrationstest `unterschrift_der_einsatzleitung_ohne_admin_rolle_ist_403`; Gegenprobe ohne `ist_admin()` in `run_start` → 409 statt 403; dazu `darfFuehrungUnterschreiben` (Admin der Einsatz-Org) in `einsatz/schreibrecht.ts` mit Test, Prop `darfUnterschreiben`

## 3. Anwenderkapitel `instanzkopplung.md`

- [x] 3.1 Abläufe: „Führung eines Einsatzes übergeben“ nennt, dass den Code die Einsatzleitung oder ein Admin der abgebenden Seite erzeugt; „Notübernahme“ gilt für die Einsatzleitung oder einen Admin der Organisation (auf „Instanzkopplung“ nur Admins), „Eigene Unterschrift“ nur für Admins, die Einsatzleitung trägt den Code ein (Quelle: `src/einsatz/kontext.rs` `EinsatzFuehrungszugriff`, `src/routes/fuehrung.rs` `run_start`, Paneel nach 2.2)
- [x] 3.2 Hintergrund „Führung je Einsatz“: Einsatzkopf zeigt nur „Führung: <Name>“ und nur bei fremder Führung (`EinsatzLayout.tsx`, `fuehrungBeiKurz`), „Führung: … · Epoche n“ steht unter „Einsätze beim Gegenüber“ (`fuehrungKurz`); den Satz „danach steht im Einsatzkopf ‚Führung: hier‘“ ersetzen (Paneel „Führung“ zeigt „hier“); „Unterschrift eines Admins oder dessen Code“ → Code der abgebenden Seite; Verlauf der Code-Abgabe „Abgabe per Code“ ohne Wartezustand (`FUEHRUNG_ART_TEXT`); Verlauf lesen Personen mit Lesezugriff, keine Geräte (nach 1.1)
- [x] 3.3 Hintergrund „Widerruf“ und „Widerruf und Spiegel“: mit Führung je Einsatz holt jede Installation die Spiegel zurück, deren Einsatz das widerrufene Gegenüber führte: Notübernahme mit Grund „Kopplung widerrufen“, Bruchstelle der Widerruf, Hinweisband weg, wieder schreibbar; offene Übernahmen dieses Gegenübers verfallen; „Vorhandene Spiegel bleiben lesbar und gesperrt“ gilt nur ohne Führung je Einsatz oder ohne Akte (Quelle: `src/instanz/repo.rs`, `src/instanz/fuehrung/repo.rs::release_nach_widerruf`, `src/instanz/spiegel/fuehrung.rs::werde_fuehrer`)
- [x] 3.4 `quellen:` um `frontend/src/instanz/fuehrungText.ts`, `frontend/src/einsatz/EinsatzLayout.tsx`, `src/einsatz/kontext.rs`, `src/benachrichtigung/text.rs` ergänzen; Wächter grün: `mise exec -- pnpm exec vitest run src/hilfe/anwenderdoku.guard.test.ts` in `frontend/`

## 4. Glossar und ADR-Geltung (D3)

- [x] 4.1 `docs/architektur/12-glossar.md`: Einträge „Bruchstelle“, „Epoche (der Führung)“, „Führungsakte“, „Notübernahme“ mit Verweis auf Spec `instanz-fuehrung` und Codeort, alphabetisch in der passenden Tabelle; „Führer (eines Einsatzes)“ berichtigen (ohne Führung je Einsatz die anlegende Instanz, sonst die, die die Akte nennt; Verweis auf ADR-0021). Prüfen: Links treffen (`scripts/check-all.sh`-Schritt der Doku-Links bzw. Lesen der Ziele)
- [x] 4.2 `gilt_fuer` von ADR-0021 um `src/routes/fuehrung.rs`, `frontend/src/instanz/Fuehrung*`, `frontend/src/instanz/fuehrung*`, `frontend/src/instanz/EinsaetzeBeimGegenueber.tsx`; von ADR-0018 um `src/routes/einsatz.rs`; Regeln und Kontext unverändert. Prüfen: `scripts/adr-fuer.sh src/routes/fuehrung.rs src/routes/einsatz.rs frontend/src/instanz/FuehrungPaneel.tsx` nennt ADR-0021 bzw. ADR-0018, ADR-Wächter grün

## 5. Abschluss

- [ ] 5.1 `./scripts/check-all.sh` grün (bzw. die CI des PRs, mit Verweis auf den Lauf)
- [ ] 5.2 Review vor dem PR über den ganzen Branch (`dev-zunder-ausfuehren`, „Review vor dem PR“), bestätigte Befunde behandelt
- [ ] 5.3 Bilder der Änderung: Dialog „Notübernahme“ als Einsatzleitung (nur Code) und als Admin (Wahl), vorher/nachher; Ablage `pr-bilder/dzv9wm04/`

## Workflow follow-up

- `/opsx:archive dzv9wm04-fuehrung-nachziehen` im selben Branch vor dem PR (Spec-Sync nach `openspec/specs/instanz-fuehrung` und `openspec/specs/einsatz-spiegel`)
- PR gegen `alpha`, Zunder LLH-1676 auf `review` samt `pr_url`
