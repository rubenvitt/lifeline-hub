# Spec Delta

## ADDED Requirements

### Requirement: Eine beim Laden feststehende Störung steht im ersten Bild

Eine Störung der Kopfleiste, die beim Laden eines Einsatzes ohne Zutun feststeht, MUST schon im
ersten Bild der Kopfleiste mit ihrem Wort stehen: vorgemerkte und abgelehnte Offline-Einträge mit
„WARTET n“ bzw. „PRÜFEN“, eine verweigerte Benachrichtigung mit „Benachrichtigung blockiert“.
Ihr Erscheinen MUST NOT die Breite oder Zeilenzahl der Kopfleiste nach dem ersten Bild ändern.
Für Ruhezustände beim Start gilt das Requirement „Ruhezustände stehen in der Kopfleiste nur als
Symbol“.

#### Scenario: Vorgemerkte Einträge beim Neuladen
- **WHEN** nach Offline-Arbeit zwei Einträge vorgemerkt sind und derselbe Benutzer einen Einsatz an der Umbruchkante der Kopfleiste neu lädt
- **THEN** steht „WARTET 2“ im ersten Bild, und die Kopfleiste ändert ihre Zeilenzahl nicht, solange die Einträge vorgemerkt bleiben

#### Scenario: Abgelehnte Einträge beim Neuladen
- **WHEN** ein abgelehnter Offline-Eintrag vorliegt und derselbe Benutzer einen Einsatz neu lädt
- **THEN** steht „PRÜFEN“ im ersten Bild

#### Scenario: Android mit verweigerter Benachrichtigung
- **WHEN** ein Einsatz auf Android geladen wird, die Benachrichtigung dort verweigert ist und der Service Worker noch nicht geantwortet hat
- **THEN** steht „Benachrichtigung blockiert“ schon im ersten Bild

#### Scenario: Die Zahl gehört der Person
- **WHEN** eine Person mit vorgemerkten Einträgen sich abmeldet und auf demselben Gerät eine andere Person einen Einsatz lädt
- **THEN** zeigt deren Kopfleiste im ersten Bild keine Zahl der vorigen Person
