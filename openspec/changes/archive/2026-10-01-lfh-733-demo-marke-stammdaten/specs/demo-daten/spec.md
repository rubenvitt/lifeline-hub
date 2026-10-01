# Spec Delta

## ADDED Requirements

### Requirement: Demo-Marke in den Stammdaten-Antworten

Jede Antwort, die einen Fahrzeug-, Personal- oder Material-Stammdatensatz liefert, SHALL das Feld
`ist_demo` tragen. Das gilt für Listen und für die Antworten auf Ändern sowie auf Außer- und
In-Dienst-Stellen. Das Feld MUST genau dann wahr sein, wenn die Zeile im Moment der Abfrage eine
Demo-Marke trägt. Mitbenutzte Datensätze und Zeilen, die beim Entfernen ihre Marke verloren
haben, MUST `false` melden. Das Feld MUST immer vorhanden sein.

#### Scenario: Angelegtes Demo-Fahrzeug
- **WHEN** nach einem Import die Fahrzeugliste der Organisation abgefragt wird
- **THEN** meldet jedes Fahrzeug, das der Import angelegt hat, `ist_demo: true`
- **AND** jedes andere Fahrzeug meldet `ist_demo: false`

#### Scenario: Mitbenutzte Person
- **WHEN** der Import eine vorhandene Person mit derselben Personalnummer mitbenutzt hat
- **THEN** meldet die Personalliste diese Person mit `ist_demo: false`

#### Scenario: Behaltene Zeile ist Bestand
- **WHEN** ein Demo-Fahrzeug in einem echten Einsatz disponiert ist und der Admin die Demo-Daten entfernt
- **THEN** meldet die Fahrzeugliste das behaltene Fahrzeug danach mit `ist_demo: false`

#### Scenario: Antwort auf eine Änderung
- **WHEN** ein Admin ein Demo-Material ändert oder außer Dienst stellt
- **THEN** trägt die Antwort `ist_demo: true`

### Requirement: Demo-Marke an Einsatz-Dispositionen

Jede Antwort, die eine Fahrzeug-, Personal- oder Material-Disposition eines Einsatzes liefert,
SHALL das Feld `ist_demo` tragen. Es MUST dem `ist_demo` des zugehörigen Stammdatensatzes im
Moment der Abfrage entsprechen. Eine Ad-hoc-Disposition ohne Stamm-Bezug MUST `false` melden.

#### Scenario: Demo-Fahrzeug im echten Einsatz
- **WHEN** ein Demo-Fahrzeug in einem echten Einsatz disponiert ist und die Fahrzeuge dieses Einsatzes abgefragt werden
- **THEN** meldet die Disposition `ist_demo: true`

#### Scenario: Ad-hoc-Kraft
- **WHEN** eine Ad-hoc-Person disponiert ist
- **THEN** meldet ihre Disposition `ist_demo: false`

### Requirement: Kennzeichnung in den Stammdaten-Katalogen

Die Kataloge für Fahrzeuge, Personal und Material in der Verwaltung SHALL jede Zeile mit
`ist_demo` sichtbar als „Demo“ kennzeichnen, und zwar neben dem Funkrufnamen, dem Namen bzw. der
Bezeichnung. Die Detailseiten für Fahrzeug und Person MUST die Kennzeichnung im Kopf zeigen. Die
Kennzeichnung MUST als Text lesbar sein und MUST NOT allein über Farbe wirken (WCAG 1.4.1).

#### Scenario: Fahrzeugkatalog
- **WHEN** ein Admin nach einem Import den Fahrzeugkatalog öffnet
- **THEN** steht neben jedem Demo-Fahrzeug das Wort „Demo“, neben keinem anderen Fahrzeug

#### Scenario: Detailseite
- **WHEN** ein Admin die Detailseite einer Demo-Person öffnet
- **THEN** zeigt der Kopf der Seite das Wort „Demo“

### Requirement: Demo-Stammdaten in den Auswahllisten

Die Auswahllisten, aus denen Fahrzeuge, Personal oder Material eines Einsatzes aus den Stammdaten
disponiert werden, SHALL Demo-Stammdaten weiter anbieten. Jeder Demo-Eintrag MUST als „Demo“
gekennzeichnet sein. Alle Demo-Einträge MUST gesammelt in einer Gruppe „Demo-Daten“ hinter allen
übrigen Einträgen stehen. Ohne Demo-Einträge MUST die Liste keine solche Gruppe zeigen.

#### Scenario: Demo-Fahrzeug in der Auswahl
- **WHEN** eine Person im Fahrzeugmodul eines Einsatzes die Auswahl „Stamm-Fahrzeug disponieren“ öffnet und im Pool echte und Demo-Fahrzeuge in Dienst stehen
- **THEN** stehen zuerst die echten Fahrzeuge, danach eine Gruppe „Demo-Daten“ mit allen Demo-Fahrzeugen, jedes mit der Kennzeichnung „Demo“

#### Scenario: Keine Demo-Daten
- **WHEN** die Organisation keine Demo-Stammdaten hat
- **THEN** zeigt die Auswahl keine Gruppe „Demo-Daten“

#### Scenario: Demo-Eintrag bleibt wählbar
- **WHEN** eine Person einen Demo-Eintrag aus der Auswahl wählt
- **THEN** wird er wie jeder andere Stammdatensatz disponiert

### Requirement: Kennzeichnung in den Einsatz-Tabellen

Die Tabellen der disponierten Fahrzeuge, des disponierten Personals und des disponierten
Materials eines Einsatzes SHALL jede Disposition mit `ist_demo` als „Demo“ kennzeichnen, und zwar
neben dem Funkrufnamen, dem Namen bzw. der Bezeichnung. Die Kennzeichnung MUST als Text lesbar
sein und MUST NOT allein über Farbe wirken.

#### Scenario: Disponiertes Demo-Material
- **WHEN** im Materialmodul eines Einsatzes ein Demo-Material disponiert ist
- **THEN** steht in seiner Zeile neben der Bezeichnung das Wort „Demo“
