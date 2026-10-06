# Proposal

## Why

Der Live-Strom stößt bei jedem Ereignis sofort, einzeln und ohne Rücksicht auf die Sichtbarkeit
des Tabs Neuabrufe an. Nach einem Funkloch, einem Server-Neustart oder in einer dichten Lage
entstehen so Lastspitzen auf der schwachen Leitung im Feld und auf dem Server der Führungsstelle,
genau dann, wenn das Lagebild schnell wieder stimmen muss. Jeder Wiederaufbau der Verbindung
gleicht außerdem alles voll ab, obwohl der Server das Verpasste per `Last-Event-ID` selbst
nachliefert. Seit die Live-Ströme eine Höchstlebensdauer haben (30 bis 45 Minuten), geschieht
dieser Wiederaufbau planmäßig in jedem Tab, und jedes Mal blinkt kurz der Hinweis „Live-Verbindung
wird wiederhergestellt“.

## What Changes

- **Gebündelte Invalidierung:** Live-Ereignisse merken ihre Query-Keys vor; ein Sammelfenster von
  300 ms invalidiert jeden betroffenen Key genau einmal. Laufende Abrufe werden dabei nicht
  abgebrochen und neu gestartet. Ein zentraler Baustein im Frontend trägt das für den
  Einsatz-Strom und den Org-Strom; spätere Live-Abnehmer (Modulzähler, ETB-Zeitachse, Meldungen)
  nutzen denselben.
- **Verdeckte Tabs rufen nicht ab:** Ein verdeckter Tab markiert betroffene Abfragen nur als
  veraltet. Beim Zurückwechseln holt er jede veraltete aktive Abfrage einmal nach.
- **Wiederaufbau ohne Vollabgleich, wenn der Server nachliefert:** Verbindet der Browser von
  sich aus neu, liefert der Server das Verpasste nach oder meldet `lagged`; einen Vollabgleich der
  Einsatz-Abfragen gibt es dann nicht mehr. Ein manueller Neuaufbau (neue Verbindung nach
  Fehler) gleicht weiter voll ab. Die Org-Abfragen gleichen bei jedem Wiederaufbau weiter ab, sie
  haben keinen Nachlieferweg.
- **Jede Einsatz-Verbindung hat eine Position:** Der Einsatz-Strom teilt dem Browser beim Aufbau
  die aktuelle Ereignis-Nummer des Kanals mit (Kontroll-Ereignis `position` mit `id:`). So schickt auch ein Tab,
  der noch kein Ereignis empfangen hat, beim Neuverbinden eine `Last-Event-ID`.
- **Kurzer Abriss ohne Hinweis:** Der Hinweis „wird wiederhergestellt“ erscheint erst, wenn die
  Verbindung nach einer Schonfrist von 8 s nicht wieder steht. Ein planmäßiges Ende der
  Lebensdauer und ein kurzer Funkabriss bleiben so unsichtbar. „Unterbrochen“ (Browser gibt auf)
  erscheint weiterhin sofort.
- **Gestreuter manueller Neuaufbau:** Die Wartezeiten des manuellen Neuaufbaus bekommen einen
  Zufallsaufschlag.
- Alarmton, Sofortmeldungs-Toast, Erinnerungs- und Ablösungsalarm bleiben sofort und ungebündelt.

## Capabilities

### New Capabilities

- `live-abgleich`: Wie das Frontend auf Live-Ereignisse und den Wiederaufbau der Live-Verbindung
  mit Neuabrufen reagiert (Bündelung, Sichtbarkeit, Nachlieferung statt Vollabgleich, Hinweis
  zum Verbindungszustand).

### Modified Capabilities

Keine. Die Anforderung aus `org-live`, nach jedem Wiederaufbau die live geführten globalen Keys neu
abzurufen, gilt unverändert.

## Impact

- Frontend: `frontend/src/live/` (`liveVerbindung.ts`, `useEinsatzLiveStream.ts`,
  `useOrgLiveStream.ts`, `orgListener.ts`, neuer Baustein für die gebündelte Invalidierung) samt
  Tests; Regel in `frontend/AGENTS.md`, „Query-Key-Registry“.
- Backend: `src/live/mod.rs` (Position beim Abonnieren), `src/routes/support.rs`
  (`sse_stream_mit_replay`), `src/routes/live.rs`; Tests in `tests/live_feed.rs`.
- Keine Migration, keine API-Änderung außer dem zusätzlichen Kontroll-Ereignis `position` im
  Einsatz-Strom.
