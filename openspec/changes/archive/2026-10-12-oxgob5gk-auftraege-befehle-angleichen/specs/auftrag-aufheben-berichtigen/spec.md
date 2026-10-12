## MODIFIED Requirements

### Requirement: Aufheben und Berichtigen in der Oberfläche
Das Detail eines Auftrags (auf der Seite „Aufträge/Befehle“ das Detailpaneel, Spec `liste-detail`;
in der Geräteansicht die Auftragskarte) SHALL die Handlungen „Berichtigen“ und „Auftrag aufheben“
nur für Mitglieder mit Schreibrecht anbieten. „Berichtigen“ steht nur bereit, solange der Server berichtigen ließe;
sonst MUST die Handlung fehlen oder gesperrt mit Grund stehen. „Auftrag aufheben“ steht bei jedem
nicht abgenommenen, nicht aufgehobenen Auftrag bereit.

- „Auftrag aufheben“ MUST rot und abgesetzt stehen.
- Es MUST eine Rückfrage mit Pflichtfeld „Grund“ und dem Bestätigungsknopf „Auftrag aufheben“
  öffnen. Ein Rückgängig-Toast MUST fehlen.
- „Berichtigen“ MUST das Auftragsformular mit dem aktuellen Stand vorbelegt öffnen. Es MUST nur die
  geänderten Felder senden. Der Speicherknopf MUST „Berichtigung speichern“ heißen.
- Ein Speicherfehler MUST im Dialog bzw. Formular stehen, das dabei offen bleibt.
- Ein aufgehobener Auftrag MUST unter „Abgeschlossen“ stehen, mit dem Etikett „Aufgehoben“ im
  neutralen Ton, nicht im Ton eines erledigten Abschlusses, und mit Grund, Zeitpunkt in taktischer
  Zeit und aufhebender Person.

#### Scenario: Erteilen, aufheben, abgeschlossen
- **WHEN** die Einsatzleitung einen Auftrag erteilt, ihn über „Auftrag aufheben“ mit einem Grund
  aufhebt und auf „Abgeschlossen“ wechselt
- **THEN** steht der Auftrag dort mit dem Etikett „Aufgehoben“ und dem Grund

#### Scenario: Beobachter sieht keine Handlung
- **WHEN** ein Beobachter die Auftragsliste öffnet
- **THEN** fehlen „Berichtigen“ und „Auftrag aufheben“

#### Scenario: Quittierter Auftrag
- **WHEN** an einem Auftrag ein Empfänger quittiert hat
- **THEN** ist „Berichtigen“ nicht wählbar, und „Auftrag aufheben“ steht bereit
