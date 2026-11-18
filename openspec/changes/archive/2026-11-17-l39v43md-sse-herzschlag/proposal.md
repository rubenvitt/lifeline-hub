# Proposal

Zunder: https://zunder.rubeen.dev/#/aufgabe/l39v43mddwxd2w79msjp5n4p (LLH-1935, aus LLH-1752)

## Why

Eine Live-Leitung, die offen scheint, aber nichts mehr liefert (halboffenes TCP, etwa im Funkloch),
bleibt heute unerkannt: Das Frontend wechselt den Verbindungszustand nur, wenn der Browser `open`
oder `error` meldet. Kopfleiste, Lagebild-Strom und Lagemonitor zeigen dann weiter „live“, obwohl
das Lagebild stillsteht. LLH-1752 hat nur den Teil behoben, den der Browser selbst kennt (ohne Netz
oder Server: „offline“).

## What Changes

- **Lebenszeichen vom Server:** Einsatz-Strom und Org-Strom senden alle 15 s ein eigenes
  Kontroll-Ereignis `heartbeat`. Es trägt keine Position (`id:`), gehört keinem Modul und löst
  keinen Abgleich aus. Die bisherigen Keep-Alive-Kommentare sieht eine `EventSource` nicht, deshalb
  reichen sie dafür nicht.
- **Wache im Frontend:** Ab dem ersten `open` einer Verbindung gilt sie als stumm, wenn 45 s lang
  kein Ereignis eintrifft. Dann meldet das Frontend sofort den Zustand „wird wiederhergestellt“
  (`connecting`), schließt die Leitung und baut eine neue auf; sie gleicht danach voll ab wie jeder
  eigene Neuaufbau.
- **Anzeigen folgen ohne eigene Änderung:** Kopfleiste („VERBINDE“), Lagebild-Strom und Lagemonitor
  lesen schon den gemeinsamen Verbindungszustand.
- **Kaltstart unverändert:** Vor dem ersten `open` läuft keine Wache, der Zustand bleibt „verbinde“.

## Capabilities

### New Capabilities

(keine)

### Modified Capabilities

- `live-abgleich`: Neue Anforderungen, dass der Server ein regelmäßiges Lebenszeichen sendet und
  dass das Frontend eine stumme Leitung als abgerissen behandelt und selbst neu aufbaut.

## Impact

- Backend: `src/live/strom.rs` (Takt und Lebenszeichen-Strom), `src/routes/live.rs` (beide Ströme
  mischen das Lebenszeichen ein), `src/routes/support.rs` (Wire-Name des Kontroll-Ereignisses).
- Frontend: `frontend/src/live/liveVerbindung.ts` (Wache in `oeffneLiveVerbindung`), Tests in
  `liveVerbindung.test.ts`.
- Keine Migration, keine API-Änderung außer dem zusätzlichen Kontroll-Ereignis im SSE-Strom; ältere
  Frontends ignorieren es (kein Listener).
- Last: ein Ereignis von etwa 30 Byte je offenem Strom und 15 s.
