# Tasks

## 1. Token abbilden

- [ ] 1.1 In `frontend/src/theme/tokens.test.ts` einen Test ergänzen, der je Dichte `controlPaddingHorizontal` = `abstand.md` und `controlPaddingHorizontalSM` = `abstand.sm` erwartet, `kompakt` zusätzlich als Literale 12/8 (pixelgleich mit antd), und der die `paddingContent*`-Token in `antdToken` als nicht gesetzt festhält; Test läuft zuerst rot (`mise exec -- pnpm -C frontend exec vitest run src/theme/tokens.test.ts`)
- [ ] 1.2 In `antdToken()` (`frontend/src/theme/tokens.ts`) beide Token aus der Stufe setzen, Kommentar mit Verweis auf diese Change (D1/D2) und die Ausnahme `paddingContent*`; Test aus 1.1 grün
- [ ] 1.3 Den Halbsatz zur Ausnahme in `frontend/AGENTS.md`, Gestaltungssprache, „Abstandsraster“ ergänzen und den Dateikopf von `tokens.test.ts` nachziehen; Prettier über `frontend/` grün

## 2. Prüfen

- [ ] 2.1 Bilder in `kompakt` und `handschuh` von geöffneter Auswahlliste und Dropdown-Menü aufnehmen (Wegwerf-Spec im Bildlauf) und prüfen, dass `kompakt` unverändert ist und `handschuh` 24 px seitliches Polster zeigt
- [ ] 2.2 `./scripts/check-all.sh --geaendert --ohne-e2e` grün

## Workflow follow-up

- Change per `/opsx:archive` im selben Branch archivieren (Spec-Sync nach `openspec/specs/abstandsraster`), dann PR gegen `alpha`.
