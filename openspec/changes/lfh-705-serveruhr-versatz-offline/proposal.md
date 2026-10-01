# Proposal

## Why

Eine offline vorgemerkte Stand- oder Belegungsmeldung trägt den Erfassungszeitpunkt nach der
**Geräteuhr** (LFH-675, D6). Geht die Uhr eines Handschirms vor, scheitert die Meldung beim
Senden mit 400, solange der Vorlauf größer ist als Ausfalldauer plus 60 s Toleranz. Sie
landet dann im Wiederherstellungs-Drawer und braucht Handarbeit. Ist der Ausfall länger als
der Vorlauf, wird sie angenommen, aber mit einem um den Vorlauf zu späten Zeitpunkt. Dann
kann eine ältere Zahl eine inzwischen gemeldete neuere verdrängen, und das ist genau die
Fehlchronologie, gegen die die Nachtragsregel (LFH-639 D2) gebaut ist.

## What Changes

- Das Frontend merkt sich den **Versatz zwischen Geräteuhr und Serveruhr**. Es liest ihn aus
  dem `Date`-Header der eigenen API-Antworten. Antworten, die der Browser frisch aus seinem
  Cache liefern darf, zählen nicht.
- Der Versatz überlebt ein Neuladen ohne Netz für eine begrenzte Zeit. Gerätebezogen, ohne
  Personenbezug.
- Beim **Vormerken** einer Stand- oder Belegungsmeldung wird der Erfassungszeitpunkt um den
  bekannten Versatz korrigiert, also auf die Serveruhr umgerechnet. Ist kein Versatz bekannt,
  gilt wie bisher die Geräteuhr.
- Ein von Hand eingetragener Zeitpunkt bleibt unangetastet, ebenso der Online-Versuch (der
  sendet weiter keinen Zeitpunkt, und es gilt die Serveruhr).
- Der Server bleibt unverändert: Zeitpunkte über 60 s in der Zukunft lehnt er weiter ab.
  Verworfen ist die Gegenrichtung, solche Zeitpunkte für Queue-Meldungen auf „jetzt“ zu
  kappen (Begründung in `design.md`, D1).

## Capabilities

### New Capabilities

_keine_

### Modified Capabilities

- `betreuung-evakuierung`: Die Anforderung „Offline-Erfassung von Stand- und
  Belegungsmeldungen“ bemisst den Erfassungszeitpunkt einer vorgemerkten Meldung nach der
  Serveruhr, soweit das Gerät seinen Versatz kennt.

## Impact

- Frontend: `api/client.ts` (Versatz aus `apiGet`/`apiSend` messen), neues Modul für den
  Versatz unter `offline/`, `offline/schreiben.ts` (`betreuungsmeldungOfflineFaehig`).
- Backend, API, Schema, Migrationen: keine Änderung. Der `Date`-Header kommt von hyper.
- Nicht betroffen, aber geprüft: ETB-Ereigniszeit und Meldungs-Ereigniszeit stammen
  ebenfalls aus der Geräteuhr. Der Server lehnt dort keine Zukunft ab, die Meldung scheitert
  also nicht, steht aber zu spät. Das ist ein eigener Befund und kommt als Nachzug aufs Board
  (`design.md`, Non-Goals).
