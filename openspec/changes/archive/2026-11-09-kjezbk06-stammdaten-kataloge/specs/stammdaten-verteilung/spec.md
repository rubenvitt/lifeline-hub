# Spec Delta

## MODIFIED Requirements

### Requirement: Stammdaten fließen von der erreichten zur meldenden Seite

Für jede aktive Org-Zuordnung einer Kopplung SHALL die erreichte Seite der meldenden Seite die
Stammdaten der zugeordneten Org liefern. Dazu gehören Konten, Org-Einstellungen,
Modul-Einstellungen, Führungsfunktionen, Fahrzeuge, Personal, Qualifikationen, Material,
Fahrzeug- und Personal-Status, Einheit-Typen, Einheiten-Vorlagen, Schichtmodelle,
Einsatz-Vorlagen mit ihren ausgeblendeten Modulen, Stichwort-Vorschläge, Verpflegungs-Vorlagen,
Sprechgruppen des Org-Katalogs, ETB-Bausteine, Externe Stellen und die Unterkunft-Richtwerte der
Org. Die meldende Seite MUST sie in der lokal zugeordneten Org ablegen. Die erreichte Seite MUST
NOT Stammdaten der meldenden Seite übernehmen. Eine lokale Org MUST Stammdaten aus höchstens einer
Kopplung beziehen.

#### Scenario: Grundstock mit der ersten Meldung
- **WHEN** ein ELW frisch mit der Org „DRK KV Nord“ am Hub gekoppelt ist und sich zum ersten Mal meldet
- **THEN** liefert die Antwort Stammdaten der Org ab Stand 0, und der ELW zeigt danach die Fahrzeuge und Konten des Hubs

#### Scenario: Zweite Quelle für dieselbe Org
- **WHEN** die lokale Org eines ELW schon Stammdaten aus einer Kopplung bezieht und eine zweite Kopplung dieselbe Org zuordnet
- **THEN** übernimmt der ELW aus der zweiten Kopplung keine Stammdaten, und an der zweiten Kopplung steht ein Hinweis

#### Scenario: Einsatz-Vorlage mit Schichtmodell
- **WHEN** am Hub die Einsatz-Vorlage „Sanitätsdienst“ das Schichtmodell „12-Stunden“ vorgibt und Module ausblendet
- **THEN** kennt der ELW nach seiner nächsten Meldung die Vorlage mit denselben ausgeblendeten Modulen, und sie gibt dort das übernommene Schichtmodell „12-Stunden“ vor

#### Scenario: Neue Arten nach einem Update
- **WHEN** ein schon gekoppelter ELW auf eine Version aktualisiert wird, die weitere Arten kennt
- **THEN** beginnt die Nachlieferung für seine Org wieder bei Stand 0, und die neuen Arten kommen mit ihrem ganzen Bestand an

### Requirement: Der erste Abgleich führt Gleiches zusammen, Konten nie

Kommt eine Zeile zum ersten Mal an, SHALL die meldende Seite eine lokale Zeile derselben Art und
desselben natürlichen Schlüssels übernehmen: Funkrufname bei Fahrzeugen, Personalnummer bei
Personal, Bestandsnummer bei Material, Name bei Einheiten-Vorlagen, Bezeichnung bei Katalogen und
Vorlagen, Text bei Stichwort-Vorschlägen, Betriebsart und Bezeichnung zusammen bei Sprechgruppen,
Schlüssel bei Führungs-, Modul-Einstellungen und Unterkunft-Richtwerten. Eine lokale Zeile, die
schon vom Hub stammt, MUST NOT ein zweites Mal zugeordnet werden. Der Inhalt der Quelle MUST die
lokale Zeile überschreiben. Konten MUST NOT zusammengeführt werden. Ist der Benutzername eines
gelieferten Kontos lokal schon vergeben, MUST das Konto nicht übernommen werden, und die Kopplung
MUST einen Hinweis mit dem Namen zeigen, bis der Konflikt gelöst ist.

#### Scenario: Gleiches Fahrzeug vorher angelegt
- **WHEN** der ELW vor dem Koppeln ein Fahrzeug „Rotkreuz Nord 1/83-1“ hatte und der Hub ein Fahrzeug mit demselben Funkrufnamen liefert
- **THEN** gibt es am ELW danach genau ein solches Fahrzeug, es trägt die Daten des Hubs und gilt als „vom Hub“, und Einsatzdaten, die auf das alte zeigten, zeigen weiter darauf

#### Scenario: Gleicher Kontoname
- **WHEN** der ELW ein lokales Konto „admin“ hat und der Hub ein Konto „admin“ liefert
- **THEN** bleibt das lokale Konto unverändert, das Hub-Konto kommt nicht an, und die Kopplung zeigt „Konto ‚admin‘ ist hier schon vergeben“

#### Scenario: Gleicher Sprechgruppenname in zwei Betriebsarten
- **WHEN** der ELW die Sprechgruppen „Rotkreuz 1“ als TMO und als DMO hat und der Hub „Rotkreuz 1“ als DMO liefert
- **THEN** übernimmt der ELW die DMO-Gruppe als „vom Hub“, und die TMO-Gruppe bleibt unverändert „nur hier“

## ADDED Requirements

### Requirement: Nur der Org-Katalog der Sprechgruppen wird verteilt

Die erreichte Seite SHALL von den Sprechgruppen nur die des Org-Katalogs liefern. Eine
Sprechgruppe, die zu einem Einsatz gehört, MUST NOT geliefert, im Änderungslog geführt oder im
ersten Abgleich einer gelieferten Zeile zugeordnet werden, an keiner der beiden Seiten.

#### Scenario: Einsatz-lokale Sprechgruppe am Hub
- **WHEN** am Hub in einem Einsatz eine einsatz-lokale Sprechgruppe angelegt wird
- **THEN** erhöht das keinen Stand der Org, und der ELW bekommt sie nicht geliefert

#### Scenario: Einsatz-lokale Sprechgruppe am ELW mit gleichem Namen
- **WHEN** ein Einsatz am ELW eine eigene Sprechgruppe „Rotkreuz 1“ (TMO) führt und der Hub eine Katalog-Sprechgruppe „Rotkreuz 1“ (TMO) liefert
- **THEN** legt der ELW die Katalog-Sprechgruppe neu an, und die Sprechgruppe des Einsatzes bleibt unverändert und bearbeitbar

### Requirement: Eine je Org einmalige Markierung folgt dem Hub

Trägt eine gelieferte Zeile eine Markierung, die es je Org nur einmal geben darf (Vorgabe der
Schichtmodelle, zuständige Leitstelle der Externen Stellen), SHALL die meldende Seite sie
übernehmen und die Markierung an jeder anderen Zeile derselben Art in dieser Org entfernen. Die
Zeile vom Hub MUST NOT wegen dieser Markierung draußen bleiben.

#### Scenario: Eigene Vorgabe am ELW
- **WHEN** der ELW ein eigenes Schichtmodell „Kurzschicht“ als Vorgabe führt und der Hub das Schichtmodell „12-Stunden“ als Vorgabe liefert
- **THEN** ist am ELW danach „12-Stunden“ die Vorgabe und gilt als „vom Hub“, und „Kurzschicht“ bleibt als Modell „nur hier“ ohne Vorgabe erhalten

### Requirement: Eine an einem Verweis gescheiterte Löschung wird nachgeholt

Scheitert an der meldenden Seite das Löschen einer an der Quelle hart gelöschten Zeile, weil eine
andere Zeile noch auf sie zeigt, SHALL die meldende Seite es nach allen übrigen Zeilen derselben
Nachlieferung ein zweites Mal versuchen. Erst wenn auch der zweite Versuch scheitert, MUST die
Zeile stillgelegt werden oder, wenn ihre Art kein Stilllegen kennt, der meldenden Seite gehören.

#### Scenario: Schichtmodell gelöscht, das eine Vorlage vorgab
- **WHEN** am Hub ein Schichtmodell gelöscht wird, das die Einsatz-Vorlage „Sanitätsdienst“ vorgab, und beides in derselben Nachlieferung beim ELW ankommt
- **THEN** gibt die Vorlage am ELW danach kein Schichtmodell mehr vor, und das Schichtmodell ist am ELW gelöscht

#### Scenario: Schichtmodell, das eine Vorlage des ELW vorgibt
- **WHEN** am Hub ein Schichtmodell gelöscht wird, das am ELW eine eigene Einsatz-Vorlage („nur hier“) vorgibt
- **THEN** bleibt das Schichtmodell am ELW stehen, gehört dem ELW und ist dort bearbeitbar

#### Scenario: Gelöscht und gleich wieder angelegt
- **WHEN** am Hub ein Material mit der Bestandsnummer „M-1“ gelöscht und mit derselben Bestandsnummer neu angelegt wird, bevor der ELW sich meldet, und ein Einsatz am ELW das alte verwendet
- **THEN** gibt es am ELW danach genau ein aktives Material „M-1“, es ist das, auf das der Einsatz zeigt, trägt die Daten der Neuanlage und gilt als „vom Hub“

### Requirement: Unterkunft-Richtwerte gelten je Schlüssel

Die meldende Seite SHALL jeden Richtwert der Org, den der Hub setzt, als eigene Zeile übernehmen
und nur lesbar halten. Einen Richtwert, den der Hub nicht setzt, MUST die meldende Seite für die
Org selbst setzen können; er trägt „nur hier“. Setzt der Hub einen Richtwert zurück, MUST die
meldende Seite ihn ebenfalls zurücksetzen.

#### Scenario: Richtwert vom Hub und eigener Richtwert
- **WHEN** der Hub den Richtwert „Fläche je Person“ der Org setzt und der Admin am ELW zusätzlich „Feldbetten je Person“ setzt
- **THEN** zeigt der ELW „Fläche je Person“ als „vom Hub“ und gesperrt, „Feldbetten je Person“ als „nur hier“ und bearbeitbar
