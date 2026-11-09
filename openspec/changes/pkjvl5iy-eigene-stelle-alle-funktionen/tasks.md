# Tasks

## 1. Backend: Code und Bezeichnung im Einsatzkopf

- [x] 1.1 `funktion::Funktion` trägt `code: Fuehrungsfunktion` (EL-Fallback `El`); Unit-Tests in
      `src/einsatz/funktion.rs` belegen den Code für S2, S7, Fachberater und den Fallback `el`
      (zuerst rot, dann grün: `cargo test --lib einsatz::funktion`)
- [x] 1.2 `EinsatzAnzeige` bekommt `meine_funktion_code` und `meine_funktion_bezeichnung` (optional,
      `skip_serializing_if`), `MeineFelder::ableiten` füllt beide aus demselben
      `funktion::ableiten`-Ergebnis; Bezeichnung nur bei `bezeichnung_pflicht` und nicht leerem
      Text. Liste (`repo::liste_fuer`) und Detail übernehmen sie; Lage-Snapshot bleibt ohne.
      Belegt durch Integrationstests in `tests/einsatz_funktion.rs` (Detail und Liste: `s2`;
      `s7` ohne Bezeichnung; `fachberater` + „THW“; Einsatzleitung ohne Funktion → `el`; ohne
      Funktion fehlen beide Felder) — `cargo test --test einsatz_funktion`
- [x] 1.3 Typ-Codegen: `scripts/check-typ-codegen.sh` grün, beide generierten Dateien im selben
      Commit; `frontend/src/test/fixtures.ts` und andere `EinsatzAnzeige`-Fixtures bleiben
      typkorrekt (`mise exec -- pnpm -C frontend exec tsc --noEmit`)

## 2. Frontend: „meine Stelle“ über den Code

- [x] 2.1 `meineStelle` liest `meine_funktion_code` und `meine_funktion_bezeichnung` (kein
      `meine_sachgebiete`, kein eigener EL-Fallback mehr); `hasFunktion` vergleicht bei
      Fachberater/Führungshilfspersonal die Bezeichnungen nur, wenn beide Seiten eine tragen
      (`trim`, ohne Groß-/Kleinschreibung). Auftrag mit `funktion_text`, Erinnerung mit
      `empfaenger_funktion`, Meldung nur über den Code. Tests in `offeneVorgaenge.test.ts`: S7,
      Fachberater THW gegen „thw“/„Polizei“, geschwärzte Bezeichnung am Empfänger und an der eigenen
      Funktion, `el` aus dem Kopf (zuerst rot, dann grün: `mise exec -- pnpm -C frontend
      exec vitest run src/pages/fuehrung/offeneVorgaenge.test.ts`)
- [x] 2.2 `UeberblickPage.test.tsx`: ein Fall mit `meine_funktion_code: 's7'` zeigt unter „meine
      Stelle“ den Auftrag an S7 (Akzeptanzkriterium LLH-1606); bestehender S2-Fall auf
      `meine_funktion_code` umgestellt — `vitest run src/pages/fuehrung/UeberblickPage.test.tsx`
- [x] 2.3 Kopfkommentar von `offeneVorgaenge.ts` (D5 „Meine Stelle“) auf die neue Ableitung und
      diese Change verweisen; `mise exec -- pnpm -C frontend lint` grün

## 3. Doku

- [x] 3.1 `docs/anwender/kapitel/ueberblick.md`: „meine Stelle“ nennt die eigene Funktion aus dem
      ganzen Katalog und den Abgleich der Bezeichnung bei Fachberater/Führungshilfspersonal;
      Doku-Wächter aus `docs/anwender/AGENTS.md` grün

## 4. Integration

- [ ] 4.1 `./scripts/check-all.sh` grün (bzw. die Bündel, die die Umgebung trägt, mit Vermerk, was
      erst die CI des PRs belegt)

## Workflow follow-up

- `/opsx:archive pkjvl5iy-eigene-stelle-alle-funktionen` im selben Branch vor dem PR.
- Bilder der Änderung (Überblick, „meine Stelle“ als S7) in PR und Meldung.
