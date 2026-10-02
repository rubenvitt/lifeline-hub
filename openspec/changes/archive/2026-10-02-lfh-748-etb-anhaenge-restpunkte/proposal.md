# Proposal

## Why

Das zweite Review von LFH-117 (ETB-Anhänge, archiviert unter
`openspec/changes/archive/2026-09-29-lfh-117-etb-anhaenge/`) hat vier Restpunkte offen gelassen
(LFH-748). Keiner blockierte den Merge. Einer verrät aber bis heute, welche fremden Anhänge im
Einsatz schon gebunden sind (design.md D12, „Offen bleibt“). Die übrigen drei lassen gewählte
Dateien, einen Upload-Hinweis oder einen offenen Chip-Editor in der Schnellerfassung still aus
dem Takt geraten (Prüfliste `docs/superpowers/specs/2026-09-24-lfh-117-pruefliste.md`,
„Grenzen“).

## What Changes

- **Nur eigene Uploads lassen sich binden.** Nennt jemand beim Erfassen die ID eines Anhangs,
  den eine andere Person hochgeladen hat, antwortet der Server mit 400 und dem Wortlaut der
  unbekannten ID. Bisher galt das nur für freie fremde Anhänge, gebundene fremde lieferten 422
  „bereits gebunden (…)“. Ein eigener gebundener Anhang bleibt 422 (Zustand, LFH-267).
- **Ein Entwurf mit Dateien bleibt im Entwurfsspeicher**, auch wenn sein Text getippt und
  wieder ganz gelöscht wird. Damit hängen die Dateien nach einer Berichtigung weiter an ihrem
  Reiter.
- **Der Upload-Hinweis überlebt eine Berichtigung.** Wer nach einem gescheiterten Upload
  „Berichtigen“ startet und abbricht, sieht den Grund am Entwurf wieder, wie schon nach einem
  Tabwechsel.
- **Ein offener Chip-Editor ist während des Sendens gesperrt**, wie jede andere Eingabe der
  Erfassung.

## Capabilities

### New Capabilities

Keine.

### Modified Capabilities

- `etb-anhaenge`: Die Statuscode-Regel beim Binden fremder Anhänge (Requirements „Eintrag und
  Anhänge entstehen atomar“ und „Eine Datei hat genau einen Lebenszyklus“) und die Zusagen der
  Schnellerfassung zu Dateien, Upload-Hinweis und Sperre beim Senden (Requirement „Die
  Schnellerfassung nimmt Anhänge nur online an“).

## Impact

- Backend: `src/etb/repo.rs` (`pruefe_anhaenge`), Tests in `tests/etb_anhang.rs`. Keine
  Migration, kein DTO, kein neuer Statuscode, nur eine andere Zuordnung.
- Frontend: `frontend/src/etb/entwuerfe/useEtbEntwuerfe.ts`,
  `frontend/src/etb/entwuerfe/EtbEntwurfsTabs.tsx`, ein neuer Hook neben
  `useEntwurfsDateien.ts`, `frontend/src/pages/EtbPage.tsx`, `frontend/src/etb/Schnellerfassung.tsx`,
  `frontend/src/etb/MetaChip.tsx` samt Vitest.
- API-Verhalten: Ein Client, der fremde gebundene IDs nennt, bekommt 400 statt 422. Die eigene
  Oberfläche nennt nur eigene Uploads, das Heraufstufen aus dem Chat bindet Kopien
  (`etb::repo::anhaenge_kopieren_tx`, LFH-700). Kein bekannter Aufrufer ist betroffen.
