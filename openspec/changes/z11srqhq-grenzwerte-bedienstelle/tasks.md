## 1. Grenzen und reine Funktionen

- [x] 1.1 `api/eingabegrenzen.ts` um `SCHICHTPLAN_MAX_DIENST_MIN_MINUTEN`, `SCHICHTPLAN_MAX_DIENST_MAX_MINUTEN` und `SCHICHTPLAN_MIN_RUHE_MAX_MINUTEN` ergänzen und in `tests/eingabegrenzen_spiegel.rs` gegen `MAX_DIENST_BEREICH`/`MIN_RUHE_BEREICH` spiegeln (D7). Prüfen mit `cargo test --test eingabegrenzen_spiegel`.
- [x] 1.2 `abloesung/grenzwerte.ts` anlegen, per TDD: `grenzwertText(minuten, eigen)` liefert „12 h (Vorgabe)“ bzw. „10 h“ und „0 min“ (D6). Dazu die Vorbelegung des Dialogs aus `SchichtplanGrenzwerte` und den Body aus alten Werten und Feldern: nur geänderte Felder, leer → `null`, nichts geändert → kein Body (D4). Prüfen mit `abloesung/grenzwerte.test.ts` in Vitest.

## 2. Bedienstelle in den Einstellungen

- [x] 2.1 Dialog `abloesung/GrenzwerteModal.tsx` (`ErfassungsModal`) mit „Höchstdienst“ und „Mindestruhe“, `dauerRegel` ohne Pflicht in den Grenzen aus 1.1 und Platzhalter `mitVorgabe` (D4). Test: Vorbelegung, Prüfmeldung bei „45 min“ und „25 h“, ein geleertes Feld sendet `null`, ein unverändertes Feld wird nicht gesendet. Prüfen mit `GrenzwerteModal.test.tsx`.
- [x] 2.2 Paneel „Dienst und Ruhe“ in `pages/einstellungen/EinsatzAbloesung.tsx` unter „Schichtmodell des Einsatzes“: wirksame Werte über `grenzwertText`, „Werte ändern“ und „Vorgaben wiederherstellen“ (nur bei eigenem Wert, mit Rückgängig) nur mit Schreibrecht. Lesen über `fetchSchichtplan` (Key `schichtplan`). `onSuccess` setzt den Plan und invalidiert `kraefteZeitachseGrenzwerte` für Einheiten und Personal (D2, D3, D5). Test der Sektion: Vorgabe gekennzeichnet, kein Knopf ohne Schreibrecht, Wiederherstellen sendet `null` und Rückgängig die alten Minuten. Prüfen mit Vitest.
- [x] 2.3 Kopfkommentar von `EinsatzAbloesung.tsx` und `frontend/src/kraefte/AGENTS.md` nachziehen, im Absatz Schichtplan bzw. Einstufung: Die Grenzwerte werden nur in Einstellungen › Ablösung bedient, der Plan zeigt sie nur. Prüfen mit Prettier, `scripts/check-fmt.sh`.

## 3. Lesezeile im Schichtplan

- [ ] 3.1 `abloesung/schichtplan/SchichtplanAnsicht.tsx`: Zeile „Höchstdienst … · Mindestruhe …“ aus `plan.grenzwerte`, mit Schreibrecht ein Link „ändern“ auf `einsatzEinstellungenPfad(id, 'abloesung')` (D6). Test: Text mit „(Vorgabe)“, ohne Schreibrecht kein Link. Prüfen mit Vitest, Test der Ansicht oder eines kleinen Bausteins.

## 4. Anwenderdoku und Bilder

- [ ] 4.1 `docs/anwender/kapitel/einsatz-einstellungen.md`: Ablauf „Dienst und Ruhe festlegen“ (Werte ändern, leeres Feld = Vorgabe, Vorgaben wiederherstellen, Rückgängig), Hintergrund zu Rechten und ETB. Den Kopf `quellen` ergänzen und ein Bild des Paneels über `frontend/e2e/doku-bilder/einsatz-einstellungen.bilder.ts` einbinden. Prüfen mit den Doku-Wächtern aus `docs/anwender/AGENTS.md` und dem Bildlauf.
- [ ] 4.2 `abloesung.md` („Ampel im Schichtplan“: die Lesezeile, Verweis auf den Reiter) und `meldebild.md` (Grenzwerte: wo man sie setzt) nachziehen; `personal.md` nur, falls es die Grenzwerte erklärt. Prüfen mit den Doku-Wächtern.

## 5. Abschluss

- [ ] 5.1 `./scripts/check-all.sh` grün (bzw. die Bündel, die Frontend, Spiegeltest und Doku decken). Prüfen mit dem Lauf ohne `| tail`.
- [ ] 5.2 Bilder der Änderung (Paneel, Dialog, Lesezeile im Plan) per Wegwerf-Spec aufnehmen und für PR und Meldung bereitlegen. Prüfen: Die Bilder liegen außerhalb von `docs/anwender/bilder/`, die Spec ist gelöscht.

## Workflow follow-up

- `/opsx:archive z11srqhq-grenzwerte-bedienstelle` im selben Branch vor dem PR (Spec-Sync nach `openspec/specs/kraefte-schichtplan/`).
- PR gegen `alpha` mit Zeile `Zunder: https://zunder.rubeen.dev/#/aufgabe/z11srqhqsnt2kuus2yvl2ghr` und Bildern.
