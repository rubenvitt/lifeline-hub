# Proposal

## Why

„Zu ETB heraufstufen“ übernimmt heute nur den Text einer Chat-Nachricht ins Einsatztagebuch
(`chat::repo::heraufstufen_zu_etb`). Fotos oder Scans, die an der Nachricht hängen, fehlen im
entstandenen Eintrag. Dabei ist oft gerade das Foto der Grund, die Nachricht zu dokumentieren.
Seit LFH-117 kann ein ETB-Eintrag eigene Anhänge tragen (`etb_eintrag_anhang`), damit lässt
sich die Lücke schließen. Nach der Kreuzsperre aus LFH-117 hat eine Datei aber genau einen
Lebenszyklus. Die Chat-Datei selbst darf das ETB also nicht binden.

## What Changes

- Beim Heraufstufen werden die gewählten Anhänge der Nachricht **kopiert**: je Datei eine neue
  `anhang`-Zeile mit denselben Bytes und Metadaten, gebunden an den neuen ETB-Eintrag. Kopie,
  Eintrag, Verknüpfung und Rückverweis entstehen in **einer** Transaktion. Die Chat-Datei
  bleibt unverändert im Chat. Sie wird weder mitverknüpft noch umgehängt.
- Die Kopie ist ein Schnappschuss wie der Text: Wird die Nachricht danach gelöscht oder ihre
  Datei entfernt, bleibt die Kopie am Eintrag. Sie unterliegt ab dann den ETB-Regeln
  (unveränderlich, nur über das ETB-Modul ladbar, die Schwärzung löscht sie).
- `POST …/chat/nachrichten/{mid}/heraufstufen-etb` nimmt ein optionales Feld `anhang_ids`
  an. Fehlt es oder ist es leer, wird keine Datei übernommen, wie bisher. Jede genannte ID muss
  an **dieser** Nachricht hängen (sonst 400). Höchstens 10 verschiedene IDs (sonst 400),
  dieselbe Grenze wie beim Erfassen.
- Frontend: Der Dialog „Zu ETB heraufstufen“ zeigt die Anhänge der Nachricht als Auswahl. Alle
  sind vorgewählt, bei mehr als 10 die ersten 10. Ein Hinweis sagt, dass übernommene Dateien im
  Tagebuch unveränderlich sind. Der Dialog zieht dabei auf die Erfassungs-Norm
  (`components/Erfassung.tsx`) um, weil er angefasst wird.

## Capabilities

### New Capabilities

_keine_

### Modified Capabilities

- `etb-anhaenge`: Neue Anforderung, dass das Heraufstufen einer Chat-Nachricht gewählte
  Anhänge als Kopie an den neuen Eintrag bindet. Die Anforderung „Eine Datei hat genau einen
  Lebenszyklus“ bleibt unverändert. Die Kopie ist eine neue Datei und kein zweiter Linker.

## Impact

- Backend: `src/chat/repo.rs` (`heraufstufen_zu_etb`), `src/routes/chat.rs`
  (`HeraufstufenBody`, `heraufstufen`). Dazu ein Kopier-Baustein bei `anhang::repo` oder
  `etb::repo`. Keine Migration, kein Response-DTO ändert sich, also kein Codegen.
- Frontend: `frontend/src/chat/HeraufstufenModal.tsx` samt Test, `frontend/src/api/chat.ts`
  (`heraufstufenZuEtb`), Aufrufer in `frontend/src/pages/ChatPage.tsx`.
- Speicher: Jede übernommene Datei liegt danach zweimal in der Datenbank (bis 25 MiB je Datei).
  Eine inhaltsadressierte Ablage ist nicht Teil dieses Changes.
- Rechte: Wer das ETB lesen darf, aber den Chat nicht, sieht die übernommene Datei. Das gilt
  heute schon für den übernommenen Text, und das Heraufstufen ist eine bewusste Übernahme.
