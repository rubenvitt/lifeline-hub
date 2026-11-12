# Proposal

## Why

Zwei ELW an einem Hub können ohne Verbindung beide die Führung eines Einsatzes übernehmen, den der
Hub führt (LLH-1669, Zunder `faq7l7m4`). Der Hub nimmt die zuerst gemeldete Übernahme an und lehnt
die zweite seit 773b6b44 ab (kein ELW nimmt einem anderen die Führung). Die unterlegene ELW erfährt
davon nichts: Sie überspringt die weitergereichte Akte, speichert ihre eigene nur neu oder verwirft
eine reguläre Übergabe des Hubs mit dem irreführenden Alarm „ungültige Übernahme“. Danach führen
beide ELW und schreiben dauerhaft am selben Einsatz. Das Spec-Szenario „Gleichstand zweier
Notübernahmen“ verspricht etwas anderes und beschreibt einen Fall, der zwischen nur zwei Instanzen
gar nicht entstehen kann.

## What Changes

- **Der Hub entscheidet, wer zuerst kommt (abgestimmt am 12.11.2026).** Unter mehreren meldenden
  Seiten gilt an der erreichten Seite die zuerst angenommene Führung. Der Diebstahlschutz aus
  773b6b44 bleibt unverändert, die Regel „Die größere Epoche gilt“ bekommt diese Ausnahme
  ausdrücklich.
- **Die unterlegene meldende Seite erkennt den Konflikt.** Führt sie selbst und nennt die Akte der
  erreichten Seite einen Dritten als Führer, hält sie diese Akte als offene Übernahme. Das gilt
  gleich, ob die Epoche des Hubs größer oder kleiner ist und ob sie vom Hub oder vom Dritten stammt.
  Sie schreibt weiter, das Hinweisband erscheint, und die Einsatzleitung bekommt den Hinweis
  „Führung übernommen“.
- **Bestätigen ja, Widersprechen nein.** „Übernahme bestätigen“ macht den Einsatz zum Spiegel mit
  Bruchstelle, auch wenn die Epoche des Hubs kleiner ist als die eigene. „Widersprechen“ antwortet
  in diesem Fall mit 422, weil der Hub einen Widerspruch ohnehin ablehnen würde und dann wieder
  beide führten.
- **Der Konflikt erlischt von selbst,** sobald die erreichte Seite keinen Dritten mehr als Führer
  nennt.
- **Anzeige:** `FuehrungOffen` bekommt die Markierung `konflikt`. Das Hinweisband zeigt dann „Deine
  Notübernahme hat am Hub nicht gegriffen, die Führung liegt bei …“ und nur „Übernahme bestätigen“.
- **Tests:** Der Gleichstand-Test, der den Hub-Stand per rohem `UPDATE` baut und an zufälligen
  Kennungen hängt, weicht Tests mit drei Instanzen und echten Erklärungen. Sie sind über die Zähler
  deterministisch und decken alle drei Zweige ab.

## Capabilities

### New Capabilities

(keine)

### Modified Capabilities

- `instanz-fuehrung`: „Die größere Epoche gilt“ bekommt die Ausnahme für mehrere meldende Seiten,
  und das Szenario „Gleichstand zweier Notübernahmen“ wird ersetzt. Neu ist die Anforderung, dass
  eine unterlegene meldende Seite den Konflikt offen hält. „Widersprechen heißt Rückübernahme“ wird
  für den Konflikt eingeschränkt.

## Impact

- Backend: `src/instanz/fuehrung/austausch.rs` (Erkennen in `apply_eingang`, Erlöschen),
  `src/instanz/fuehrung/dienst.rs` (`bestaetigen`, `widersprechen`, `anzeige`, DTO
  `FuehrungOffen`), Codegen (`openapi.json`, `types.generated.ts`).
- Frontend: `frontend/src/instanz/FuehrungHinweisband.tsx`, `UebernahmeEntscheidung` in
  `frontend/src/instanz/FuehrungPaneel.tsx`, dazu ihre Tests.
- Tests: `tests/instanz_fuehrung.rs`.
- Keine Migration, kein neues Feld auf der Leitung, keine neue Benachrichtigungsart.
- Doku: neue ADR für die Entscheidung, Satz in Kapitel 6.6c, Anwenderkapitel
  `instanzkopplung.md` (beschreibt heute den Gleichstand nach der größeren Kennung).
