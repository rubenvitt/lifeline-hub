# Proposal

## Why

LFH-633 zeigt die gültigen DWD-Warnungen für den Einsatzort nur auf der Modulseite „Wetter &
Pegel“. Eine Unwetterwarnung (Stufe schwer oder extrem) sieht deshalb nur, wer diese Seite
öffnet. Dabei ist sie für die Führung Anlass zum Handeln, etwa für den Eigenschutz der Kräfte
im Freien. LFH-633 hat Modulzähler und Alarm bewusst ausgelassen (Non-Goal), weil beides eine
eigene Entscheidung über das Alarmbudget ist. Nach EEMUA 191 / ISA-18.2 sind das 1–2 Alarme je
10 min, und die AlarmZentrale zeigt höchstens drei Hinweise. Diese Entscheidung holt LFH-663
nach.

## What Changes

Entschieden am Checkpoint (01.10.2026): alle drei Wege, nur für die Stufen **schwer** und
**extrem**, und die Erkennung „neu“ läuft **im Browser**.

- **Modulzähler** am Modul „Wetter & Pegel“: Zahl der gültigen Unwetterwarnungen (gilt jetzt
  und angekündigt) für den Einsatzort. Er ist neutral wie jeder Modulzähler, verbraucht also
  nichts vom Alarmbudget. Bei unbekanntem Stand oder ohne Einsatzort steht keine Zahl da.
- **Einmaliger Hinweis in der AlarmZentrale**, wenn eine Unwetterwarnung neu erscheint, mit
  dezentem Ton und Desktop-Meldung, über den bestehenden Budgetweg (höchstens drei sichtbar).
  „Neu“ heißt: das Paar aus Ereignis und Stufe ist in den letzten 6 h nicht gemeldet worden, und
  die Warnung ist keine Herabstufung. Eine Aktualisierung derselben Warnung (neue CAP-Kennung,
  verlängertes Ende) alarmiert nicht noch einmal. Je Einsatz belegt der Unwetterhinweis höchstens
  **einen** Platz im Budget.
- **Überblick-Marke** zum Beginn einer angekündigten Unwetterwarnung unter „Nächste Marken“, mit
  Sprung zur Modulseite. Sie verschwindet, sobald die Warnung gilt; dann trägt sie der Zähler.
- Die **Entscheidung zum Alarmbudget** samt Begründung steht in `design.md` und in der Spec.

Keine Änderung am Backend, am Draht oder an der Datenbank.

## Capabilities

### New Capabilities

Keine.

### Modified Capabilities

- `lage-wetter-pegel`: Neue Anforderungen für die Unwetterwarnung außerhalb der Modulseite:
  Modulzähler, einmaliger Hinweis in der AlarmZentrale samt Alarmbudget und Überblick-Marke.

## Impact

- Nur Frontend, Bereich `frontend/src/`:
  - `einsatz/modulRegistry.ts` (neue `ClientZaehlerQuelle`);
  - `einsatz/useModulZaehler.ts` (Browser-Zähler);
  - `einsatz/EinsatzLayout.tsx` (Erkennung montieren);
  - `einsatz/AlarmZentrale.tsx` (neues Ziel und Ereignis);
  - `wetter/` (reine Ableitungen, Erkennung, Gedächtnis);
  - `pages/fuehrung/ueberblickDaten.ts` und `UeberblickPage.tsx` (Marke).
- Die Abfrage `GET /api/einsaetze/{id}/wetter` läuft künftig im Rahmen jedes Einsatzes, an dem
  das Modul für die Person sichtbar und frei ist. Sie läuft alle 5 min und teilt sich den
  Cache-Eintrag mit der Modulseite. Der Server-Cache (TTL 5 min je Organisation und Ort)
  begrenzt die Last bei Bright Sky unabhängig von der Zahl der Clients.
- Kein neuer Query-Key, kein neues Live-Ereignis, keine Migration, keine Typ-Codegen-Änderung.
