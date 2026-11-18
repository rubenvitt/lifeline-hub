# Tasks

## 1. Hinweis-Kreuz (D1)

- [x] 1.1 Reine Stilfunktion für das Kreuz in `frontend/src/theme/tokens.ts` mit Unit-Test (Böden als Literale 24 / 48 / 72, negativer Rand = halber Zuwachs über `fontSizeIcon`); Test zuerst rot, dann grün
- [x] 1.2 Am `ConfigProvider` in `frontend/src/theme/ThemeModeProvider.tsx` als `alert.styles.close` setzen; Vitest belegt am gerenderten `DeeplinkHinweis`, dass der Knopf den Stil trägt
- [x] 1.3 e2e-Messung „Hinweis schließen“ (Deeplink auf unbekannten Posten, alle drei Stufen, Fükw): wirksame Fläche per `elementFromPoint` ≥ 24/48/72 auf beiden Achsen, Hinweis mit und ohne Boden gleich hoch (Stil im Browser zurückgenommen); Spec läuft grün

## 2. Sortierauswahl (D2)

- [x] 2.1 Vitest in `frontend/src/components/` zuerst rot: Kartenzweig zeigt „wie geliefert“ als Eintrag und Wert ohne Sortierung, die Wahl setzt die Sortierung zurück, kein `.ant-select-clear`
- [x] 2.2 `Datensicht.tsx` umbauen (Eintrag „wie geliefert“, `allowClear` weg); Test grün, bestehende Datensicht-Tests grün
- [x] 2.3 Kein eigener e2e-Fall: Sortierlogik einer einzelnen Seite gehört nach Vitest (`frontend/e2e/AGENTS.md`, Spec `e2e-zuschnitt`). Den Ablauf belegt der Test aus 2.1; Mutationsprobe: ohne den Umbau in `Datensicht.tsx` rot

## 3. Brotkrume (D3)

- [x] 3.1 `ortspfadStil`-Test um die Breite erweitern (Literal), zuerst rot; dann `ortspfadStil` und `EinsatzSeite.css` (`min-width`, mittig); Test grün
- [x] 3.2 e2e: Link „ETB“ der ETB-Druckansicht in `kompakt` ≥ 24 px und in `handschuh` ≥ 72 px breit, Schrift 12 px, Seitenkopf in `kompakt` weiter 44 px; Spec läuft grün

## 4. Regeln und Abschluss

- [x] 4.1 `frontend/AGENTS.md` nachziehen (Hinweis-Kreuz am Kontext, Breitenboden der Brotkrume, Sortierauswahl ohne Kreuz) und Prettier über `frontend/` grün
- [x] 4.2 Design-System-Wächter prüfen; verlangt er es, `mise exec -- pnpm -C frontend design-system` laufen lassen und das Erzeugte mitcommitten
- [x] 4.3 `./scripts/check-all.sh --geaendert --ohne-e2e` grün, dazu die geänderten e2e-Specs einzeln grün

## Workflow follow-up

- `/opsx:archive ttlwlyz5-restziele-treffschwelle` im selben Branch, dann PR gegen `alpha`.
