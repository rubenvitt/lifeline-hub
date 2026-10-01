# Proposal

## Why

Die Prüfliste der Dokumentenablage (LFH-632, `docs/superpowers/specs/2026-09-22-lfh-632-pruefliste.md`,
Zeilen 1 · 3 und 2 · 3) lässt Kriterium 3 „Rückmeldung vor der Serverantwort“ auf beiden Flächen
offen. Eine Ablage bis 25 MiB samt Virenscan über Mobilfunk dauert ausdrücklich länger als 15 s
(Zeitlimit 120 s), zeigt aber nur einen drehenden Knopf. MIL-STD-1472 5.14.9 verlangt dafür eine
Fortschrittsmeldung. Nach einem bestätigten „Entfernen“ ändert sich die Zeile bis zur
Serverantwort gar nicht. Ob die Ablage ohne Netz vorgemerkt wird, ist bisher nicht entschieden.

## What Changes

- **Upload-Fortschritt im Dialog „Dokument ablegen“:** Während die Datei überträgt, steht im
  Dialog ein Fortschritt mit Prozentangabe. Danach wechselt er auf „Datei wird geprüft“, solange
  der Server scannt und speichert. Der Fortschritt kommt aus dem Upload-Ereignis des Browsers
  (`XMLHttpRequest.upload`), nicht geschätzt.
- **Ehrliche Fehlermeldung je Phase:** Bricht die Leitung ab, **bevor** die Datei ganz übertragen
  ist, gilt wie bisher „nicht abgeschickt“. Bleibt die Antwort aus, **nachdem** sie ganz übertragen
  ist, sagt der Dialog, dass das Ergebnis unbekannt ist, und bittet, die Liste zu prüfen, bevor
  erneut abgelegt wird. Heute behauptet er in beiden Fällen „die Aktion wurde NICHT abgeschickt“.
- **Sichtbarer Entfernen-Zustand:** Nach dem Bestätigen bleibt die Zeile stehen, ihr
  Entfernen-Knopf zeigt den Ladezustand, und die Zeile wird als „wird entfernt“ gekennzeichnet,
  bis die Serverantwort kommt. Kein optimistisches Ausblenden. Das gilt in Tabelle und Karte;
  dafür bekommt die Primäraktion der `Datensicht` einen zeilenweisen Ladezustand.
- **Entscheidung Offline-Ablage: keine Vormerkung.** Ohne Netz wird nichts in IndexedDB
  gelegt. Der Dialog bleibt mit Datei und Feldern offen, die Meldung sagt, dass nichts abgelegt
  wurde, und „Ablegen“ versucht es erneut. Begründung und verworfene Alternativen in `design.md`.
- Die Prüfliste trägt die Zeilen 1 · 3 und 2 · 3 nach (Verdikt mit Beleg).

## Capabilities

### New Capabilities

- `dokumentenablage`: Verhalten der Dokumentenablage eines Einsatzes in der Oberfläche —
  Rückmeldung beim Ablegen und Entfernen, Verhalten ohne Verbindung.

### Modified Capabilities

(keine)

## Impact

- Frontend: `api/client.ts` (neuer Upload-Weg mit Fortschritt neben `apiUpload`),
  `api/dokumente.ts`, `dokumente/DokumentAblegenModal.tsx`, `pages/DokumentePage.tsx`,
  `components/Datensicht.tsx` (`PrimaerAktion.laeuft`), Tests daneben, `e2e/dokumente.spec.ts`.
- Kein Backend, keine Migration, keine API-Änderung.
- ETB- und Schaden-Anhänge nutzen dasselbe 120-s-Zeitlimit ohne Fortschritt. Sie bleiben hier
  unverändert; der neue Upload-Weg ist für sie wiederverwendbar (Nachzug als eigenes Ticket).
