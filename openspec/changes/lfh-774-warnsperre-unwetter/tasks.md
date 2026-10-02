# Tasks

## 1. Regel: drittes Merkmal in `einsatz/aktiveWarnung.ts`

- [ ] 1.1 Tabelle zuerst (TDD): `einsatz/aktiveWarnung.test.ts` bekommt eine `it.each`-Tabelle
  über alle `WetterWarnstufe`-Werte als Literale: `gering` → false, `maessig` → false,
  `schwer` → true, `extrem` → true. Dazu kommen „leere Liste → false“ und
  „`dwdStufenJetzt` fehlt → false“. Rot gegen den Bestand prüfen, dann
  `aktiveWarnung({ …, dwdStufenJetzt })` mit `dwdWarnstufe[s].rolle === 'alarm'` umsetzen (D2).
  Prüfen mit `vitest run src/einsatz/aktiveWarnung.test.ts`: grün. Mutationsprobe: Ist die
  Rolle auf `achtung` gestellt, wird die Tabelle rot.
- [ ] 1.2 Reine Funktion `dwdStufenJetzt(teil, jetzt)` in `einsatz/aktiveWarnung.ts` (D2), aus
  `teilStand` und `teileWarnungen` von `wetter/wetterStand.ts`. Tests in derselben Datei:
  - Teil fehlt → `undefined`.
  - `zustand: ausfall` → `undefined`.
  - `kein_ort` → `undefined`.
  - Stand jenseits der Obergrenze → `undefined`.
  - veralteter Stand → Stufen.
  - angekündigte Warnung fällt heraus, abgelaufene ebenfalls.
  - gilt jetzt → ihre Stufe.
  Prüfen: Vitest grün.
- [ ] 1.3 Guard aus D2 in `aktiveWarnung.test.ts`: `UNWETTER_STUFEN` (aus `wetter/unwetter.ts`)
  ist genau die Menge der Stufen, die `dwdWarnstufe` auf `alarm` legt. Prüfen: grün.
  Mutationsprobe: `UNWETTER_STUFEN` nur `['extrem']` → rot.
- [ ] 1.4 Kopfkommentar von `einsatz/aktiveWarnung.ts` nachziehen:
  - DREI Merkmale, (c) mit Verweis auf diese Change.
  - Das „BEWUSST NICHT … DWD-Unwetter (LFH-774)“ entfällt.
  - Neu: nur „gilt jetzt“, Vertrag statt `UNWETTER_STUFEN`.
  Prüfen: `grep -n "LFH-774" frontend/src/einsatz/aktiveWarnung.ts` zeigt keinen
  Folgeticket-Verweis mehr.

## 2. Quelle: Wetter in `einsatz/useAktiveWarnung.ts`

- [ ] 2.1 Hook-Tests zuerst in `einsatz/useAktiveWarnung.test.tsx`, msw-Handler für
  `/api/einsaetze/7/wetter` mit Abrufzähler:
  - Unwetter `schwer` gilt jetzt → `true`.
  - nur `maessig` → `false`.
  - `extrem` angekündigt → `false`.
  - `zustand: ausfall` → `false`.
  - Abruf 500 → `false`.
  - Modul `wetter-pegel` ausgeblendet → `abrufe.anzahl === 0` und `false`.
  - gesperrt (`zugriff: false`) → `abrufe.anzahl === 0` und `false`.
  - Unwetter endet: Mit Fake-Timern läuft das Ende ab, danach `false` ohne neuen Abruf.
  Rot gegen den Bestand prüfen.
- [ ] 2.2 `useAktiveWarnung` umsetzen (D1, D3, D4):
  - `useQuery({ ...wetterAbfrage(einsatzId), enabled: wetterFrei, select: (w) => w.warnungen })`
    mit `wetterFrei = istModulFreigegeben(<wetter-pegel>, freigaben)`.
  - `jetzt` aus `useUnwetterUhr(wetterFrei ? teil : undefined)`.
  - `dwdStufenJetzt: wetterFrei ? dwdStufenJetzt(teil, jetzt) : undefined`.
  - Den Kommentar „KEIN ZUSATZABRUF“ um das Wetter (`useModulZaehler`, Modulseite) erweitern.

  Prüfen: alle Tests aus 2.1 und die bestehenden Hook-Tests grün.
- [ ] 2.3 Bestehende Leser des Wetter-Caches bleiben grün: `vitest run src/einsatz
  src/wetter src/pages/wetter-pegel`. Prüfen: grün. In `EinsatzLayout.test.tsx` kommt es zu
  keiner zusätzlichen Anfrage an `/wetter`, denn der Schlüssel ist geteilt.

## 3. Regeltext

- [ ] 3.1 `frontend/AGENTS.md`, Absatz „Helligkeit: ein Regler, eine Sperre“: Die Aufzählung
  der Merkmale bekommt das jetzt geltende Unwetter mit Rolle `alarm` aus `dwdWarnstufe` dazu,
  nur mit Freigabe `wetter-pegel`. Prüfen: Prettier über `frontend/` grün.

## 4. Nachweise

- [ ] 4.1 Gates, soweit die Sitzung sie trägt:
  - Prettier, `pnpm lint`, `pnpm typecheck`.
  - Vitest für `src/einsatz`, `src/wetter`, `src/theme`.
  - `scripts/check-openspec-archiv.sh`.

  Den vollen `./scripts/check-all.sh` belegt die CI des PRs; Ergebnis und Verweis hier
  eintragen.
- [ ] 4.2 `openspec validate lfh-774-warnsperre-unwetter --strict` grün. Danach
  `/opsx:archive` im selben Branch: Spec-Sync nach `openspec/specs/bedien-helligkeit/`, dann
  Verweise auf `openspec/changes/lfh-774-…` im Code auf den Archivpfad umstellen.
