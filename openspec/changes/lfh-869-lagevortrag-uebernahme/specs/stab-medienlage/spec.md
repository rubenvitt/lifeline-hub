# Spec Delta

## MODIFIED Requirements

### Requirement: Medienlage aus S5 übernehmen
Im Abschnitt „Medienlage“ eines Lagevortrag-Entwurfs SHALL der Knopf „Aus S5 übernehmen“ stehen.
Er setzt die abgeleitete Medienlage als Text in den Abschnitt ein:
- Ist der Abschnitt leer, geschieht das ohne Rückfrage.
- Ist er gefüllt, MUST eine Rückfrage das Ersetzen bestätigen lassen.
- Der Text MUST mit dem Stand der gelesenen Quellen als taktische DTG beginnen.

Ist das Stab-Modul für die Person nicht freigegeben, MUST statt des Knopfs ein Hinweis stehen, dass
die Übernahme mangels Freigabe des Stabs nicht möglich ist. Ohne Schreibrecht ist er gesperrt. Die
Übernahme ändert nur den Entwurf und wird mit dem nächsten Speichern persistiert.

#### Scenario: Leerer Abschnitt
- **WHEN** die Person im leeren Abschnitt „Medienlage“ auf „Aus S5 übernehmen“ tippt
- **THEN** steht die abgeleitete Medienlage mit ihrem Stand im Abschnitt, und der Entwurf gilt als
  geändert

#### Scenario: Gefüllter Abschnitt
- **WHEN** der Abschnitt schon Text enthält und die Person übernimmt
- **THEN** fragt die Oberfläche, ob der Text ersetzt werden soll, und ersetzt ihn erst nach
  Bestätigung

#### Scenario: Stab nicht freigegeben
- **WHEN** das Stab-Modul für die Person gesperrt ist
- **THEN** zeigt der Abschnitt keinen Übernahme-Knopf, sondern den Hinweis, dass der Stab für
  die Person nicht freigegeben ist
