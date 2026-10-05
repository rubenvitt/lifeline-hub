# Proposal

## Why

Spielt jemand eine Sicherung zurück, die älter ist als die Löschvormerkung eines Einsatzes,
merkt der nächste Purge-Lauf den Einsatz mit dem Zeitpunkt „jetzt“ neu vor. Die Karenz von
30 Tagen läuft dann ein zweites Mal, und die Personendaten liegen bis zu 30 Tage länger vor,
als Frist und Karenz vorsehen (Befund aus der Prüfung der Sicherungen). Dasselbe passiert, wenn
der Server über den Fristablauf hinaus stillsteht, etwa ein Notebook, das wochenlang aus ist:
die Karenz beginnt erst beim ersten Lauf danach.

## What Changes

- Die Karenz eines Einsatzes beginnt mit dem **Ablauf seiner Frist**, nicht mit dem Purge-Lauf,
  der ihn vormerkt. Wurde die Frist auf einen Zeitpunkt in der Vergangenheit gesetzt, beginnt
  sie mit dem **Setzen** der Frist, damit eine bestätigte Verkürzung weiter die volle Karenz
  von 30 Tagen behält.
- Der Server merkt sich dafür, wann die Frist eines Einsatzes zuletzt gesetzt wurde (Abschluss,
  manuelle Frist, Wiederherstellen). Bestehende Einsätze erhalten den Wert einmalig aus ihrer
  Frist, so dass auch eine Sicherung von vor diesem Update richtig behandelt wird.
- Liegt der so bestimmte Karenz-Beginn mehr als 30 Tage zurück, schwärzt derselbe Purge-Lauf
  den Einsatz sofort nach der Vormerkung. Liegt er weniger weit zurück, bleibt nur die
  Restkarenz; Wiederherstellen und Friständerung folgen ihr (422 während der Karenz, 409 danach).
- Der ETB-Eintrag zur Vormerkung nennt den Beginn der Karenz, wenn er vor dem Lauf liegt.
- `docs/betrieb/backup-restore.md` beschreibt das neue Verhalten statt der bekannten Lücke.

## Capabilities

### New Capabilities

(keine)

### Modified Capabilities

- `aufbewahrung`: Beginn der Karenz (Löschvormerkung, Karenz von 30 Tagen) und das Rückspielen
  einer Sicherung von vor der Vormerkung.

## Impact

- Backend: neue Migration (Spalte am Einsatz plus einmalige Befüllung), Phase A des
  Purge-Laufs, die drei Schreibwege der Frist (Abschluss, manuelle Frist, Wiederherstellen).
- Keine API- oder DTO-Änderung, kein Frontend. Die Übersicht des Archivs zeigt als Zeitpunkt der
  Vormerkung den Karenz-Beginn.
- Betriebsdoku zu Sicherungen.
- Datenkategorien (`aufbewahrung-kategorien`) haben dieselbe Lücke; sie sind nicht Teil dieser
  Change (siehe design.md, Non-Goals).
