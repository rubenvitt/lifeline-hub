## 1. Backend: Personenauswahl am Einsatz (D1–D4)

- [x] 1.1 Test zuerst: `tests/einsatz_mitglieder_auswahl.rs` mit den Fällen aus design.md D4 (Einsatzleitung ohne Systemrolle 200 mit genau der aufnehmbaren Person; Mitglied, deaktiviertes Konto, Gerätekonto, Person einer zweiten Org fehlen; Führungspersonal, Beobachter, System-Admin ohne Rolle 403; abgeschlossener Einsatz abgewiesen; Antwortfelder genau `benutzer_id`, `anzeigename`; jeder angebotene Eintrag per `PUT` aufnehmbar). Rot belegen (404/405 ohne Route).
- [x] 1.2 `MitgliedAuswahl` in `src/einsatz/mod.rs` (ToSchema), Abfrage `repo::mitglied_auswahl` in `src/einsatz/repo.rs` (Org des Einsatzes, aktiv, `OHNE_GERAETEKONTEN`, keine Mitgliedschaft, Sortierung Anzeigename ohne Groß-/Kleinschreibung, dann Kennung), Handler `mitglied_auswahl` hinter `EinsatzLeitungszugriff` in `src/routes/einsatz.rs`, Route in `src/app.rs`, Schema in `src/api_doc.rs`. Test 1.1 grün.
- [x] 1.3 Mutationsproben: je einmal die Org-Bedingung, den `aktiv`-Filter und `NOT EXISTS` der Mitgliedschaft entfernen, Test 1.1 wird jeweils rot.
- [x] 1.4 `scripts/check-typ-codegen.sh` laufen lassen und beide generierten Dateien mitcommitten; `MitgliedAuswahl` in `frontend/src/api/types.ts` exportieren.

## 2. Frontend: Auswahl aus dem neuen Endpunkt (D5)

- [x] 2.1 Tests zuerst in `pages/MitgliederAbschnitt.test.tsx`: Auswahl zeigt die Personen aus `/api/einsaetze/:id/mitglieder/auswahl` und ruft `/api/benutzer` nicht; leere Antwort zeigt „Keine weitere Person der Organisation“; Fehler zeigt „Personenauswahl nicht verfügbar“; ohne `darfVerwalten` kein Abruf; nach „Hinzufügen“ wird die Auswahl neu geladen. Bestehende Tests von `/api/benutzer` auf den neuen Endpunkt umstellen. Rot belegen.
- [x] 2.2 `ladeMitgliedAuswahl` in `api/einsaetze.ts`, Key `einsatzKeys.mitgliedAuswahl` mit Prefix `einsatz-mitglieder-auswahl` in `api/queryKeys.ts`, eingetragen in `NICHT_LIVE_KEYS` samt Begründung im Kommentar und ausdrücklich nicht in `LAGEBILD_OFFLINE`; Wire-String in `queryKeys.test.ts`. Guard-Tests der Registry grün.
- [x] 2.3 `pages/MitgliederAbschnitt.tsx` auf die neue Abfrage umstellen, Auswahl nach `setzen`/`entfernen` invalidieren, `notFoundContent` nach D5, Import von `listeBenutzer` entfernen. Tests 2.1 grün, `pnpm lint` und `pnpm typecheck` ohne Befund.

## 3. Anwenderdoku

- [x] 3.1 `docs/anwender/kapitel/einsatzdaten.md`: Abschnitt „Die Auswahl ‚Benutzer …‘“ neu fassen (bietet aktive Personen der Organisation an, die noch nicht Mitglied sind; Gerätekonten fehlen), Satz „bittet die Administration darum“ streichen; `quellen:` um `src/einsatz/repo.rs` ergänzen. Anwenderdoku-Guard (`frontend/src/hilfe/anwenderdoku.guard.test.ts`) grün.
- [x] 3.2 `docs/anwender/kapitel/rechte-im-einsatz.md`: Absatz „füllt sich nur für System-Admins“ ersetzen (die Einsatzleitung nimmt Personen der Organisation des Einsatzes auf, auch ohne Systemrolle); `quellen:` von `src/routes/benutzer.rs` auf `src/routes/einsatz.rs` umstellen. Guard grün; Wortlaut gegen `docs/anwender/AGENTS.md` (Kapitelform, Mitänderungsregel) prüfen.

## 4. Integration

- [x] 4.1 `cargo test` der berührten Tests, Vitest der berührten Dateien, `./scripts/check-all.sh --nur schnell` grün; e2e-Specs, die „Zugriff“ bedienen, gezielt laufen lassen (`rg -l "Benutzer …" frontend/e2e`).

## Workflow follow-up

- Review (`superpowers:requesting-code-review`), dann `/opsx:archive` im selben Branch vor dem PR gegen `alpha`.
