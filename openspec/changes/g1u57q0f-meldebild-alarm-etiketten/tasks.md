# Tasks

## 1. Gemeinsame Bausteine (auch für LLH-1739)

- [ ] 1.1 `meldungen/rueckmeldung.ts`: `RUECKMELDUNG_ROLLE.ueberfaellig = 'alarm'`, Kopfkommentar nachziehen; `rueckmeldungUeberfaelligSeit(r, jetzt)` (Minuten seit `faellig_at`, ≥ 0, `null` ohne Rückmeldung). Tests in `rueckmeldung.test.ts` zuerst (rot), dann grün.
- [ ] 1.2 Strukturierte Gründe: `toenungsGruende` liefert `TonungsGrund[]` mit `seitMin` aus 1.1; `grundWort(grund)` liefert „1 Ausfall“, „1 Ausfall Material“, „Rückm. überfällig seit 47 min“, „keine Rückm.“ (Dauer über `dauerText`). Tests in `meldebildRaster.test.ts` (bestehende Fälle auf die Struktur umstellen, neu: Dauer 47 min und 125 min → „2 h 05 min“).

## 2. Meldebild

- [ ] 2.1 `KraefteuebersichtPage.tsx` `StatusSpalte`: je Grund ein `StatusChip ton="alarm"` mit `grundWort`, Zeitbasis die Seitenuhr (wie `rueckmeldungDerZeile`). Spalte „Rückmeldung“ färbt überfällig in Alarm über `RUECKMELDUNG_ROLLE`. Seitentest: Chips mit `data-rolle="alarm"` und Wortlaut, Uhrzeit überfällig in Alarm.
- [ ] 2.2 Problemzeile nachts: `problemZeile` in `tokens.ts` und `--lfh-problem-zeile` in `rollen.css` (Nacht) anheben; Farbrollen-Gate und `kraefte-kontrast.spec.ts` grün; Druckregel in `kraefteuebersichtPrint.css` prüfen.
- [ ] 2.3 Anwenderdoku `meldebild.md` (Gründe als rote Etiketten mit Dauer, überfällige Rückmeldung rot) und Bild über den Bildlauf erneuern; `mise exec -- openspec validate g1u57q0f-meldebild-alarm-etiketten --strict` grün.

## Workflow follow-up

- Gemeinsamer Review vor dem PR über den ganzen Branch (Welle 1 von LLH-1717).
- `/opsx:archive g1u57q0f-meldebild-alarm-etiketten` vor dem PR, im selben Branch.
