# Tasks

## 1. Karte ohne Ring (TDD)

- [x] 1.1 `kartenGrund` neben `kartenKante` in `kommunikation/kartenKante.ts` per TDD: `alarm` → `alarmFlaeche`, sonst `hervorgehoben` → `bedienFlaeche`, sonst `paneel`. Verifikation: `kartenKante.test.ts` zuerst rot, dann grün.
- [x] 1.2 `KommKarte.test.tsx`: hervorgehobene Karte trägt genau zwei `inset`-Linien (oben, unten) in `bedien` und keinen Ring (`0 0 0 2px`); alarmierte, hervorgehobene Karte behält `alarmFlaeche` und die Alarmkante. Verifikation: Test gegen den unveränderten Stand rot.
- [x] 1.3 `KommKarte.tsx` umstellen (Grund über `kartenGrund`, Schatten als Ober-/Unterlinie), Doc-Kommentar des Props und Dateikopf nennen LFH-896 und Spec `deeplink-hervorhebung`. Verifikation: 1.1 und 1.2 grün; `grep -n "0 0 0 2px" frontend/src/kommunikation` leer.

## 2. Browsernachweis

- [x] 2.1 `e2e/deeplink-hervorhebung-kontrast.spec.ts`: Fall Kommunikationskarte in beiden Modi — ein Auftrag ohne Alarm und ein überfälliger Auftrag per `?auftrag=`, je `schattenKontrast` gegen eine Nachbarkarte (Linie ≥ 3 gegen Fläche und Nachbar, Linienform), Abgleich Linie = `--lfh-bedien`, Fläche = `--lfh-bedien-flaeche` bzw. `--lfh-alarm-flaeche`, Text ≥ 7 / 5. Verifikation: gegen den Ring-Stand rot (Linienform), nach 1.3 grün in beiden Modi.
- [x] 2.2 Mutationsprobe: Alarmzweig in `kartenGrund` entfernt (Markierung überdeckt Alarm) — Komponententest und e2e rot; Probe zurückgenommen. Verifikation: Ausgabe im Lauf-Protokoll. Gelaufen: Komponententest und `kartenKante.test.ts` je rot, e2e „Alarmkarte: Fläche“ rot in beiden Modi (Bedienfläche statt Alarmfläche); zusätzlich der Ring-Stand gegen 2.1 rot (Linienform `0 0 0 2px`). Proben zurückgenommen.

## 3. Abschluss

- [x] 3.1 Archiv-Sync: `Purpose` von `openspec/specs/deeplink-hervorhebung/spec.md` um Kommunikationskarten ergänzen; Verweis „Nachzug LFH-896“ im Kommentar oder Design anderswo prüfen (`grep -rn "LFH-896"`). Verifikation: `openspec validate --specs` grün.
- [x] 3.2 `./scripts/check-all.sh` (lokal die Bündel `schnell` und `frontend`, e2e-Spec aus 2.1; Beleg für alle Bündel ist der CI-Lauf des PR). e2e lokal mit Chromium 1194 statt 1234 (Umgebung der Cloud-Sitzung).
