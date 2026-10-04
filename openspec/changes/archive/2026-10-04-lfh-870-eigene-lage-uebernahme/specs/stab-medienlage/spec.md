## MODIFIED Requirements

### Requirement: Medienlage aus S5 übernehmen
Im Abschnitt „Medienlage“ eines Lagevortrag-Entwurfs SHALL der Knopf „Aus S5 übernehmen“ stehen.
Er setzt die abgeleitete Medienlage als Text in den Abschnitt ein:
- Ist der Abschnitt leer, geschieht das ohne Rückfrage.
- Ist er gefüllt, MUST eine Rückfrage das Ersetzen bestätigen lassen.

Der Knopf MUST fehlen, wenn das Stab-Modul für die Person nicht freigegeben ist. An seiner Stelle
MUST ein Hinweis stehen, dass die Übernahme ohne Freigabe des Stabs nicht verfügbar ist. Solange
die Freigabe nicht ermittelt ist, stehen weder Knopf noch Hinweis. Ohne Schreibrecht ist er
gesperrt. Die Übernahme ändert nur den Entwurf und wird mit dem nächsten Speichern persistiert.

#### Scenario: Leerer Abschnitt
- **WHEN** die Person im leeren Abschnitt „Medienlage“ auf „Aus S5 übernehmen“ tippt
- **THEN** steht die abgeleitete Medienlage im Abschnitt, und der Entwurf gilt als geändert

#### Scenario: Gefüllter Abschnitt
- **WHEN** der Abschnitt schon Text enthält und die Person übernimmt
- **THEN** fragt die Oberfläche, ob der Text ersetzt werden soll, und ersetzt ihn erst nach
  Bestätigung

#### Scenario: Stab nicht freigegeben
- **WHEN** das Stab-Modul für die Person gesperrt ist
- **THEN** zeigt der Abschnitt keinen Übernahme-Knopf, sondern den Hinweis, dass die Übernahme
  aus S5 ohne Freigabe des Stabs nicht verfügbar ist
