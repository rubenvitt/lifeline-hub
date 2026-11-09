## MODIFIED Requirements

### Requirement: Betreuungsstelle

Das System SHALL je Einsatz Betreuungsstellen führen. Eine Stelle trägt eine Bezeichnung
(Pflicht, eindeutig unter den nicht stornierten Stellen des Einsatzes), eine Art
(`anlaufstelle`, `betreuungsstelle`, `betreuungsplatz`, `notunterkunft`), optional einen
Einsatzabschnitt desselben Einsatzes, optional eine Kapazität in Personen (ganzzahlig ≥ 1),
optional Standort und Notiz, optional Leitung und Kontaktweg (`kontaktweg`; Freitext, je höchstens
200 Zeichen nach dem Trimmen, darüber 400; der alte Feldname `erreichbarkeit` ergibt 400) sowie einen Status (`vorbereitet`, `in_betrieb`,
`geschlossen`; Vorgabe `vorbereitet`) sowie eine Belegungsart (`gezaehlt` oder `namentlich`;
Vorgabe `gezaehlt`; eine unbekannte Art ergibt 400). Ein Wechsel auf `namentlich` MUST in
derselben Transaktion eine Belegungsmeldung mit der Zahl der dort registrierten Personen
schreiben; ein Wechsel auf `gezaehlt` MUST die aktuelle Belegung unverändert lassen. Anlage, Änderung, Statuswechsel und Stornierung
MUST je einen ETB-Eintrag schreiben, sofern sich ein Wert tatsächlich ändert. Eine Änderung
von Leitung oder Kontaktweg MUST im ETB nur als „weitere Angaben“ erscheinen, nie mit
ihrem Wert. Ein gesicherter Lagestand MUST Leitung und Kontaktweg nicht einfrieren. Eine
Stelle MUST nur dann in den Status `geschlossen` wechseln können, wenn ihre aktuelle Belegung
0 ist oder sie keine Belegungsmeldung hat.

#### Scenario: Stelle anlegen
- **WHEN** die Notunterkunft „Turnhalle Ost“ mit Kapazität 150 angelegt wird
- **THEN** entsteht eine Stelle im Status `vorbereitet` ohne Belegung

#### Scenario: Stelle ohne Kapazität
- **WHEN** eine Stelle ohne Kapazität angelegt wird
- **THEN** wird sie angelegt, und für sie wird keine Zahl freier Plätze ausgewiesen

#### Scenario: Schließen mit Belegung
- **WHEN** eine Stelle mit aktueller Belegung 40 auf `geschlossen` gesetzt wird
- **THEN** antwortet das System mit 422 und ändert den Status nicht

#### Scenario: Schließen nach Leermeldung
- **WHEN** für eine Stelle zuerst Belegung 0 gemeldet und sie danach auf `geschlossen` gesetzt wird
- **THEN** ist sie geschlossen

#### Scenario: Unbekannte Art oder Kapazität kleiner als 1
- **WHEN** eine Stelle mit unbekannter Art oder Kapazität 0 angelegt wird
- **THEN** antwortet das System mit 400

#### Scenario: Stornierte Stelle
- **WHEN** eine stornierte Stelle geändert, erneut storniert oder mit einer Belegung gemeldet werden soll
- **THEN** antwortet das System mit 409

#### Scenario: Geschlossene Stelle wieder öffnen
- **WHEN** eine geschlossene Stelle auf `in_betrieb` gesetzt wird
- **THEN** ist sie wieder in Betrieb und nimmt Belegungsmeldungen an

#### Scenario: Leitung und Kontaktweg
- **WHEN** an der Stelle „Turnhalle Ost“ die Leitung „Frau Schulz“ und der Kontaktweg „0171 2345678“ gesetzt werden
- **THEN** trägt die Übersicht beide Werte
- **AND** der ETB-Eintrag der Änderung nennt „weitere Angaben“, aber weder den Namen noch die Nummer

#### Scenario: Leitung zu lang
- **WHEN** eine Leitung mit 201 Zeichen gesendet wird
- **THEN** antwortet das System mit 400 „Leitung darf höchstens 200 Zeichen lang sein“ und ändert nichts

#### Scenario: Lagestand ohne Leitung
- **WHEN** ein Lagestand gesichert wird, während eine Stelle Leitung und Kontaktweg trägt
- **THEN** enthält der gesicherte Stand die Stelle ohne Leitung und Kontaktweg

#### Scenario: Auf namentlich umstellen
- **WHEN** „Turnhalle Ost“ mit gemeldeter Belegung 89 und 12 registrierten Personen auf `namentlich` gestellt wird
- **THEN** ist die aktuelle Belegung 12, und der Meldeverlauf zeigt 89 und danach 12

#### Scenario: Zurück auf gezählt
- **WHEN** eine namentlich geführte Stelle mit Belegung 12 auf `gezaehlt` gestellt wird
- **THEN** bleibt die aktuelle Belegung 12 und nimmt wieder Handmeldungen an

#### Scenario: Namentliche Stelle schließen
- **WHEN** eine namentlich geführte Stelle mit noch registrierten Personen auf `geschlossen` gesetzt wird
- **THEN** antwortet das System mit 422, bis alle Personen abgemeldet sind

### Requirement: Belegung melden

Das System SHALL je Betreuungsstelle Belegungsmeldungen führen. Eine Belegungsmeldung trägt
eine absolute Anzahl untergebrachter Personen (ganzzahlig ≥ 0) und einen Zeitpunkt
(Vorgabe: jetzt, nicht in der Zukunft). Meldungen MUST append-only gespeichert werden. Die
aktuelle Belegung MUST die nicht zurückgenommene Meldung mit dem jüngsten Zeitpunkt sein.
Jede Meldung MUST in derselben Transaktion einen ETB-Eintrag vom Typ Meldung schreiben, der
Stelle, neue Anzahl, vorherige aktuelle Belegung und, falls gesetzt, die Kapazität nennt;
eine nachgetragene Meldung nennt wie beim Stand „nachgetragen“ und die bleibende aktuelle
Belegung statt eines vorherigen Werts.
Eine Meldung an eine Stelle im Status `geschlossen` MUST abgelehnt werden. Die Anzahl MUST
die Kapazität übersteigen dürfen. Belegungsmeldungen MUST sich wie Standmeldungen
zurücknehmen lassen.

An einer Stelle mit Belegungsart `namentlich` MUST das System die Belegung selbst melden: Ändert
sich die Zahl der dort registrierten Personen (Registrierung, Abmelden, Verbleibwechsel
oder Storno einer Person), schreibt es in derselben Transaktion eine Meldung mit
der neuen Zahl, der Erfassungszeit des auslösenden Vorgangs und der Herkunft „Registrierung“;
eine unveränderte Zahl schreibt keine Meldung. Der ETB-Eintrag dieser Meldung MUST die Herkunft
nennen. Eine Handmeldung oder die Rücknahme einer Meldung an einer namentlich geführten Stelle
MUST mit 409 „Stelle wird namentlich geführt“ abgelehnt werden.

#### Scenario: Belegung melden
- **WHEN** für „Turnhalle Ost“ (Kapazität 150) eine Belegung von 89 gemeldet wird
- **THEN** ist die aktuelle Belegung 89
- **AND** das ETB enthält einen Meldungseintrag mit „89“ und „150“

#### Scenario: Überbelegung
- **WHEN** bei Kapazität 150 eine Belegung von 170 gemeldet wird
- **THEN** ist die aktuelle Belegung 170 und das System lehnt nicht ab

#### Scenario: Geschlossene Stelle
- **WHEN** für eine geschlossene Stelle eine Belegung gemeldet oder eine Belegungsmeldung zurückgenommen wird
- **THEN** antwortet das System mit 422 und ändert nichts

#### Scenario: Registrierung meldet die Belegung
- **WHEN** an der namentlich geführten „Turnhalle Ost“ mit Belegung 12 ein Haushalt mit drei Personen registriert wird
- **THEN** ist die aktuelle Belegung 15, und das ETB enthält einen Meldungseintrag mit „15“ und der Herkunft „Registrierung“

#### Scenario: Verbleibwechsel an anderer Stelle
- **WHEN** eine an der namentlich geführten „Turnhalle Ost“ registrierte Person auf der Personen-Detailseite den Verbleib „Transport“ erhält
- **THEN** sinkt die Belegung von „Turnhalle Ost“ um 1

#### Scenario: Handmeldung an namentlicher Stelle
- **WHEN** für eine namentlich geführte Stelle eine Belegung von 40 gemeldet wird
- **THEN** antwortet das System mit 409 „Stelle wird namentlich geführt“ und ändert nichts
