# Tasks

## 1. Boden im Ortspfad (gerechnet)

- [ ] 1.1 `frontend/src/components/EinsatzSeite.test.tsx`: reine Stilfunktion des Ortspfads (design.md E2) für alle drei Stufen prüfen, Böden als Literale (30 / 48 / 72 px aus `--lfh-ortspfad-ziel`), Token je Stufe wie bei den übrigen `…Stil`-Tests. Dazu: der gerenderte Wrapper `.lfh-seitenkopf__pfad` trägt die Variable. Prüfen: Test läuft vor 1.2 ROT
- [ ] 1.2 `frontend/src/components/EinsatzSeite.tsx`: Stilfunktion exportieren, am Wrapper des `Ortspfad` setzen, Kommentar am `Ortspfad` fortschreiben (warum Polster statt Schrift, Verweis auf `frontend/AGENTS.md`, Handgebautes Bedienziel). Prüfen: 1.1 grün, übrige `EinsatzSeite.test.tsx` grün
- [ ] 1.3 `frontend/src/components/EinsatzSeite.css`: Link im Ortspfad mit `height: auto`, `min-height`, `inline-flex`/mittig, `padding-block` aus Boden minus Zeilenhöhe und `background-clip: content-box`; `ol` mit `align-items: center`. Kommentar im Stil der Datei (LFH-909, gemessen). Prüfen: Prettier über `frontend/` grün; im Browser in 2.1 belegt

## 2. Browser-Nachweis

- [ ] 2.1 `frontend/e2e/gate3-trefflaeche.spec.ts`: neuer Block „Ortspfad“ (design.md E3) — Detailseite mit zwei Pfad-Links, alle drei Stufen am Fükw und auf dem Handschirm, `alleHaltenStufe` mit Mindestzahl 2 auf `.lfh-seitenkopf__pfad a`, Schriftgröße 12 px je Link, in `kompakt` am Fükw Kopfhöhe 44 px, `gegenprobe` über die Stufen. Prüfen: Block grün. Mutationsprobe: ohne die neue CSS-Regel wird der Block in allen Stufen rot (gemessen ~20 px)
- [ ] 2.2 Kommentar am Stab-Block in `gate3-trefflaeche.spec.ts` fortschreiben: die Brotkrume misst jetzt ein eigener Block, die Scopes bleiben, damit Pfad-Links die Zählungen dort nicht verfälschen. Prüfen: Stab-Blöcke grün
- [ ] 2.3 Specs, die den Seitenkopf berühren, mitlaufen lassen: `einsatzauswahl-cls`, `lagebild-cls-schmal`, `kopfzeile-start-cls`, `uhs-hoehe`, `lagebild-offline-kopf`, `fokus-verdeckung`. Prüfen: grün oder in der Umgebung schon auf `alpha` rot (Gegenprobe dokumentieren)

## 3. Regel und Gesamtlauf

- [ ] 3.1 `frontend/AGENTS.md`, „Handgebautes Bedienziel“: Ortspfad nennen — jeder Pfad-Link hält die Staffel über die Stilfunktion in `EinsatzSeite`, Schrift bleibt 12 px, keine Ausnahme (LFH-909). Prüfen: Prettier über `frontend/` grün, Datei bleibt im Stil der Nachbareinträge
- [ ] 3.2 Brotkrumen außerhalb des Seitenkopfs (Stammdaten-Detailseiten über `AdminPage`) als eigenen Task auf dem Entwicklungsboard erfassen (Skill `clickup-task-anlegen`, vorher Duplikate suchen). Prüfen: Task-Link liegt vor
- [ ] 3.3 `./scripts/check-all.sh` (bzw. die Bündel, die in der Cloud-Sitzung laufen), Vitest voll, Typecheck, Lint. Prüfen: grün oder umgebungsbedingt rot wie auf `alpha`; voller Lauf über die CI des PRs
