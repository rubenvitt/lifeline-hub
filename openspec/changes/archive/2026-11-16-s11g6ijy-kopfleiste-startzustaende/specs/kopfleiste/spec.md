# Spec Delta

## ADDED Requirements

### Requirement: Eine beim Laden feststehende Störung steht im ersten Bild

Eine Störung der Kopfleiste, die beim Laden eines Einsatzes ohne Zutun feststeht, MUST schon im
ersten Bild mit ihrem Wort stehen, ohne danach Breite oder Zeilenzahl zu ändern: eine verweigerte
Benachrichtigung („Benachrichtigung blockiert“) immer, vorgemerkte und abgelehnte
Offline-Einträge („WARTET n“, „PRÜFEN“), sobald die Person sie auf diesem Gerät seit ihrer
Anmeldung einmal gezählt sah. Ohne Browserspeicher gilt das für sie nicht.

#### Scenario: Vorgemerkte Einträge beim Neuladen
- **WHEN** nach Offline-Arbeit zwei Einträge vorgemerkt sind und derselbe Benutzer einen Einsatz an der Umbruchkante der Kopfleiste neu lädt
- **THEN** steht „WARTET 2“ im ersten Bild, und die Kopfleiste ändert ihre Zeilenzahl nicht, solange die Einträge vorgemerkt bleiben

#### Scenario: Abgelehnte Einträge beim Neuladen
- **WHEN** ein abgelehnter Offline-Eintrag vorliegt und derselbe Benutzer einen Einsatz neu lädt
- **THEN** steht „PRÜFEN“ im ersten Bild

#### Scenario: Android mit verweigerter Benachrichtigung
- **WHEN** ein Einsatz auf Android geladen wird, die Benachrichtigung dort verweigert ist und der Service Worker noch nicht geantwortet hat
- **THEN** steht „Benachrichtigung blockiert“ schon im ersten Bild

#### Scenario: Erstes Laden nach einer Anmeldung
- **WHEN** eine Person mit zwei vorgemerkten Einträgen sich abmeldet, wieder anmeldet und direkt einen Einsatz öffnet
- **THEN** darf „WARTET 2“ bei diesem ersten Laden erst nach dem ersten Bild erscheinen; beim nächsten Laden steht es im ersten Bild

#### Scenario: Die Zahl gehört der Person
- **WHEN** eine Person mit vorgemerkten Einträgen sich abmeldet und auf demselben Gerät eine andere Person einen Einsatz lädt
- **THEN** zeigt deren Kopfleiste im ersten Bild keine Zahl der vorigen Person
