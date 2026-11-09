## ADDED Requirements

### Requirement: Haushalt an einer Betreuungsstelle registrieren

Das System SHALL an einer nicht stornierten Betreuungsstelle, die nicht geschlossen ist, einen
Haushalt mit einer bis 30 Personen in einem Schreibvorgang registrieren. Jede Person MUST
einen Nachnamen (nach dem Trimmen nicht leer) und eine Kostform tragen; Vorname,
Geburtsdatum, Geschlecht, Herkunftsadresse, Kontakt, Unverträglichkeiten und Notiz SHALL
optional sein. Jede registrierte Person MUST als Betroffene mit Status `betroffen` und dem
Verbleib „Notunterkunft“ an genau dieser Stelle angelegt werden, mit Registriernummer wie
jede andere Person. Alle Personen eines Vorgangs MUST zu einem Haushalt gehören: ohne Angabe
entsteht ein neuer Haushalt mit der nächsten Haushaltsnummer des Einsatzes („H-1“, „H-2“ …),
und die erste Person ist seine Bezugsperson; mit Angabe eines bestehenden Haushalts werden die
Personen ihm angehängt. Der Vorgang MUST in einer Transaktion geschehen und für die Registrierung genau einen
ETB-Eintrag schreiben (an einer namentlich geführten Stelle kommt der Meldungseintrag der
Belegung hinzu), der Stelle, Haushaltsnummer, Anzahl und Registriernummern nennt, aber
keine Namen, keine Kostform und keine Unverträglichkeiten.

#### Scenario: Familie registrieren
- **WHEN** an der Notunterkunft „Turnhalle Ost“ ein Haushalt mit „Weber, Anna“ (vegetarisch), „Weber, Tom“ (Normalkost) und „Weber, Lea“ (Säugling/Kleinkind) registriert wird
- **THEN** entstehen drei Betroffene mit Status `betroffen` und Verbleib „Notunterkunft → Turnhalle Ost“, alle im neuen Haushalt „H-1“ mit „Weber, Anna“ als Bezugsperson
- **AND** das ETB enthält genau einen Eintrag mit „Turnhalle Ost“, „H-1“, „3 Personen“ und den drei Registriernummern, aber ohne „Weber“

#### Scenario: Person einem Haushalt anhängen
- **WHEN** zum Haushalt „H-1“ später „Weber, Max“ registriert wird
- **THEN** gehört „Weber, Max“ zu „H-1“, und die Bezugsperson bleibt „Weber, Anna“

#### Scenario: Nachname fehlt
- **WHEN** eine der Personen ohne Nachnamen gesendet wird
- **THEN** antwortet das System mit 422, nennt die Person und legt niemanden an

#### Scenario: Geschlossene oder stornierte Stelle
- **WHEN** an einer geschlossenen Stelle registriert wird
- **THEN** antwortet das System mit 422 und legt niemanden an
- **AND** an einer stornierten Stelle antwortet es mit 409

#### Scenario: Haushalt einer anderen Stelle
- **WHEN** Personen einem Haushalt angehängt werden, dessen Mitglieder an einer anderen Stelle registriert sind
- **THEN** werden sie trotzdem angehängt, und ihr Verbleib ist die Stelle dieses Vorgangs

### Requirement: Kostform und Unverträglichkeiten an der Person

Jede Person SHALL eine Kostform tragen können: `normal`, `vegetarisch`, `vegan`,
`ohne_schwein`, `diaet_allergenarm` oder `saeugling_kleinkind` (die fünf letzten sind die
Sonderkost-Formen der Verpflegung). Ohne Angabe ist die Kostform leer. Eine unbekannte
Kostform MUST mit 400 abgelehnt werden. Unverträglichkeiten SHALL ein Freitext von höchstens
200 Zeichen nach dem Trimmen sein (darüber 400). Beide Angaben MUST sich auf der
Personen-Detailseite feldweise wie die übrigen Personendaten ändern lassen. Unverträglichkeiten
MUST als Gesundheitsangabe gelten: sie gehören zur Aufbewahrungskategorie „Behandlung“, die
Schwärzung leert sie, und sie erscheinen weder im ETB noch in einem gesicherten Lagestand. Eine
Änderung der Kostform oder der Unverträglichkeiten MUST im ETB höchstens als „weitere Angaben“
erscheinen. Am Gerät einer Einheit MUST Kostform, Unverträglichkeiten und Haushalt fehlen wie die
übrigen Personalien.

#### Scenario: Kostform ändern
- **WHEN** auf der Detailseite von „Weber, Tom“ die Kostform auf „ohne Schwein“ gesetzt wird
- **THEN** trägt die Person die Kostform `ohne_schwein`, und die Kostform-Zählung der Stelle ändert sich entsprechend

#### Scenario: Unbekannte Kostform
- **WHEN** eine Person mit der Kostform `halal_streng` gesendet wird
- **THEN** antwortet das System mit 400 und speichert nichts

#### Scenario: Schwärzung
- **WHEN** ein Einsatz geschwärzt wird, in dem „Weber, Lea“ die Unverträglichkeit „Erdnüsse“ trägt
- **THEN** ist das Feld danach leer, und die Kostform bleibt erhalten

### Requirement: Registrierliste einer Betreuungsstelle

Die Detailseite einer Betreuungsstelle SHALL für Benutzer mit Zugriff auf die Module Betreuung
und Personen eine Registrierliste zeigen: die Haushalte mit mindestens einer an dieser Stelle
registrierten Person, je Haushalt Nummer, Bezugsperson und die hier registrierten Personen mit
Registriernummer, Name, Alter oder Geburtsdatum und Kostform. Darüber MUST ein Band „Kostformen“
die Zahl der hier registrierten Personen je Kostform zeigen, „ohne Angabe“ eingeschlossen. Ohne
Zugriff auf Personen MUST statt der Liste ein Grund stehen. Abgemeldete Personen MUST nicht
mehr in der Liste und nicht im Band stehen. Die Liste MUST sich live aktualisieren, wenn an der
Stelle registriert oder abgemeldet wird.

#### Scenario: Liste mit Band
- **WHEN** an „Turnhalle Ost“ der Haushalt „H-1“ mit drei Personen registriert ist
- **THEN** zeigt die Registrierliste „H-1“ mit drei Personen, und das Band nennt 1 Normalkost, 1 vegetarisch, 1 Säugling/Kleinkind

#### Scenario: Ohne Personenrecht
- **WHEN** ein Benutzer mit Zugriff auf Betreuung, aber ohne Zugriff auf Personen die Detailseite öffnet
- **THEN** steht statt der Registrierliste ein Grund, und „Registrieren“ fehlt

### Requirement: Registrieren in der Oberfläche

Die Oberfläche SHALL „Registrieren“ an der Detailseite der Betreuungsstelle und am Gerät
„Betreuungsstelle“ anbieten. Die Maske MUST kompakt sein, ohne Angaben zu verstecken: sie MUST NOT ein
Feld der Registrierung hinter einen Aufklappbereich, ein Menü oder einen zweiten Schritt legen. Kompakt wird sie durch Aufteilung: Herkunftsadresse und Kontakt MUST einmal je Haushalt
oben in der Maske stehen und für jede Person des Haushalts gespeichert werden; je Person MUST
eine Zeile Nachname, Vorname, Geburtsdatum, Geschlecht, Kostform (Flächenwahl, „Normalkost“
vorgewählt) und Unverträglichkeiten zeigen. „Person hinzufügen“ MUST eine weitere Zeile mit dem
Nachnamen der ersten Person vorbelegen (überschreibbar). Jedes Feld MUST eine sichtbare
Beschriftung tragen (kein Platzhalter als einzige Beschriftung), in der Lesereihenfolge per
Tastatur erreichbar sein und im Handschuh-Modus Trefferhöhe haben; die Kostform MUST als
Gruppe mit Pfeiltasten bedienbar sein. „Registrieren“ MUST den ganzen Haushalt in einem
Vorgang senden. Ohne Netz MUST der Vorgang vorgemerkt und beim nächsten Abgleich genau einmal
angelegt werden (Wiederholung mit derselben Kennung liefert den ersten Stand). Ohne
Schreibrecht oder bei geschlossener Stelle MUST „Registrieren“ gesperrt mit Grund stehen.
„Speichern und nächste“ MUST die Maske nach dem Registrieren leer für den nächsten Haushalt
offen halten; „Registrieren“ schließt sie.

#### Scenario: Haushaltsangaben einmal
- **WHEN** oben in der Maske die Adresse „Lindenweg 3“ steht und drei Personen registriert werden
- **THEN** trägt jede der drei Personen die Herkunftsadresse „Lindenweg 3“

#### Scenario: Zweite Person übernimmt den Nachnamen
- **WHEN** für „Weber, Anna“ „Person hinzufügen“ gewählt wird
- **THEN** steht in der zweiten Zeile der Nachname „Weber“

#### Scenario: Nichts eingeklappt
- **WHEN** die Maske geöffnet ist
- **THEN** sind alle Felder der Registrierung ohne weiteres Aufklappen sichtbar und per Tabulator in der Reihenfolge Haushalt, dann Person für Person erreichbar

#### Scenario: Erste Person am Handy
- **WHEN** die Maske bei 390 px Breite geöffnet ist
- **THEN** stehen die Haushaltsangaben und die erste Person vollständig untereinander, ohne waagerechten Bildlauf

#### Scenario: Ohne Netz registrieren
- **WHEN** am Gerät ohne Verbindung ein Haushalt mit zwei Personen registriert wird
- **THEN** steht er als vorgemerkt in der Liste, und nach dem Abgleich gibt es genau einen Haushalt mit zwei Personen

### Requirement: Abmelden

Das System SHALL registrierte Personen einzeln oder einen ganzen Haushalt an einer Stelle
abmelden. Abmelden MUST für jede betroffene Person den Verbleib „entlassen“ mit optionalem Ziel
(Freitext, höchstens 200 Zeichen) zur Erfassungszeit schreiben, in einer Transaktion und mit
genau einem ETB-Eintrag für das Abmelden (an einer namentlich geführten Stelle dazu der
Meldungseintrag der Belegung) (Stelle, Haushaltsnummer, Anzahl, Registriernummern, ohne Namen und ohne
Ziel). Personen, die nicht mehr an dieser Stelle registriert sind, MUST übersprungen werden. Die
Oberfläche MUST vor dem Abmelden eines ganzen Haushalts nachfragen. Abmelden MUST ohne Netz
vorgemerkt werden können.

#### Scenario: Haushalt abmelden
- **WHEN** der Haushalt „H-1“ mit drei Personen an „Turnhalle Ost“ mit Ziel „zu Verwandten“ abgemeldet wird
- **THEN** tragen alle drei den Verbleib „entlassen“, und die Registrierliste zeigt „H-1“ nicht mehr

#### Scenario: Eine Person abmelden
- **WHEN** nur „Weber, Tom“ abgemeldet wird
- **THEN** bleiben „Weber, Anna“ und „Weber, Lea“ in „H-1“ an der Stelle registriert

### Requirement: Kostformen der Registrierten ohne Personenbezug

Das System SHALL für einen Einsatz die Zahl der aktuell an einer nicht stornierten
Betreuungsstelle registrierten Personen liefern, gesamt und je Kostform, dazu „ohne Angabe“.
Als registriert MUST jede nicht stornierte Person gelten, deren aktueller Verbleib
„Notunterkunft“ an einer Stelle ist, gleich ob sie über die Registrierung oder über einen
Verbleib angelegt wurde. Die Antwort MUST keinen Personenbezug enthalten und MUST nur
Lesezugriff auf das Modul Betreuung verlangen, nicht auf Personen. Die Zahlen MUST den Stand
zum Abrufzeitpunkt zeigen.

#### Scenario: Zählung
- **WHEN** an zwei Stellen 40 Personen registriert sind, davon 6 vegetarisch, 2 vegan und 3 ohne Angabe
- **THEN** liefert das System 40 gesamt, 6 vegetarisch, 2 vegan, 3 ohne Angabe und den Rest als Normalkost

#### Scenario: Nur Betreuung
- **WHEN** ein Benutzer mit Zugriff auf Betreuung, aber ohne Zugriff auf Personen die Zählung abruft
- **THEN** erhält er die Zahlen

### Requirement: Rechte der Registrierung

Registrieren, Anhängen und Abmelden MUST Schreibrecht, einen aktiven Einsatz und Zugriff auf die
Module Betreuung und Personen verlangen; fehlt einer davon, antwortet das System mit 403, bevor es
etwas liest. Eine unbekannte oder fremde Stelle bzw. ein unbekannter oder fremder Haushalt MUST
mit 404 abgelehnt werden. Das Gerät „Betreuungsstelle“ MUST nur an seiner eigenen Stelle
registrieren und abmelden; eine andere Stelle ergibt 403. Die Prüfung auf eine Wiederholung
derselben Kennung MUST nach der Rechteprüfung und vor jeder Zustandsprüfung laufen.

#### Scenario: Gerät an fremder Stelle
- **WHEN** das Gerät von „Turnhalle Ost“ an „Weserstadion“ registriert
- **THEN** antwortet das System mit 403 und legt niemanden an

#### Scenario: Wiederholung nach Einsatzende
- **WHEN** eine vorgemerkte Registrierung nach dem Ende des Einsatzes mit einer schon angelegten Kennung erneut gesendet wird
- **THEN** liefert das System den angelegten Haushalt statt eines Fehlers
