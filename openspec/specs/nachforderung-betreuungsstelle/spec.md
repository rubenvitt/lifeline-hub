# nachforderung-betreuungsstelle Specification

## Purpose
Bedarf einer Betreuungsstelle (Feldbetten, Decken, Hygieneartikel, Personal) steht als
Nachforderung mit Bezug auf die Stelle, nicht als eigenes Feld an der Stelle (Mengenwahrheit,
Spec `stab-versorgung`). Die Detailseite der Stelle zeigt ihren offenen Bedarf und führt in die
Erfassung; die Nachforderungsseite nennt und filtert die Stelle (LLH-1082).

## Requirements

### Requirement: Nachforderung mit Bezug auf eine Betreuungsstelle

Eine Nachforderung SHALL beim Anlegen optional auf eine Betreuungsstelle desselben Einsatzes
verweisen (`betreuungsstelle_id`). Der Verweis MUST nur beim Anlegen gesetzt werden. Ist er
angegeben, MUST der Server nach den Feldprüfungen in dieser Reihenfolge prüfen: ohne
Lesezugriff auf das Modul Betreuung 403, bevor die Stelle gelesen wird; eine unbekannte Stelle
oder eine Stelle eines anderen Einsatzes 404; eine stornierte Stelle 409. Eine geschlossene
Stelle MUST zulässig sein. Ohne Verweis MUST das Anlegen ohne Betreuungsrecht möglich bleiben.

#### Scenario: Bedarf für eine Stelle
- **WHEN** die Einsatzleitung „40× Feldbetten“ mit Bezug auf die Stelle „Turnhalle Ost“ anlegt
- **THEN** trägt die Nachforderung die Kennung der Stelle

#### Scenario: Fremde Stelle
- **WHEN** der Bezug auf eine Stelle eines anderen Einsatzes zeigt
- **THEN** antwortet der Server 404 und legt nichts an

#### Scenario: Stornierte Stelle
- **WHEN** der Bezug auf eine stornierte Stelle zeigt
- **THEN** antwortet der Server 409 und legt nichts an

#### Scenario: Ohne Betreuungsrecht
- **WHEN** eine Führungskraft ohne Lesezugriff auf Betreuung einen Bezug angibt, auch auf eine Stelle, die es nicht gibt
- **THEN** antwortet der Server 403

### Requirement: Storno der Stelle löst den Bezug

Die Stornierung einer Betreuungsstelle SHALL in derselben Transaktion den Bezug aller
Nachforderungen auf diese Stelle lösen. Die Nachforderungen MUST mit Status, Anzahl, Begründung
und ETB unverändert bestehen bleiben. Wurde ein Bezug gelöst, MUST nach dem Commit ein
Live-Ereignis `nachforderung` gehen.

#### Scenario: Fehlanlage storniert
- **WHEN** die Stelle „NU Fehlanlage“ mit einer zugesagten Nachforderung storniert wird
- **THEN** besteht die Nachforderung als zugesagt fort, ohne Bezug auf eine Stelle

### Requirement: Nur die Kennung der Stelle

Die Anzeige einer Nachforderung SHALL nur die Kennung der Stelle tragen und MUST keinen Namen
oder andere Angaben der Stelle enthalten. Den Namen MUST die Oberfläche aus der
Betreuungsübersicht lesen, und nur mit Freigabe des Moduls Betreuung; ohne sie steht „Für eine
Betreuungsstelle“.

#### Scenario: Ohne Freigabe Betreuung
- **WHEN** eine Person Nachforderungen, aber nicht Betreuung lesen darf
- **THEN** steht an der Nachforderung „Für eine Betreuungsstelle“ ohne Namen und ohne Sprung

### Requirement: Schwärzung behält den Verweis

Die Schwärzung eines Einsatzes SHALL den Verweis einer Nachforderung auf ihre Stelle als
Skelett behalten.

#### Scenario: Geschwärzter Einsatz
- **WHEN** ein Einsatz mit einer Nachforderung für eine Stelle geschwärzt wird
- **THEN** verweist die Nachforderung weiter auf die Stelle, Begründung und Adressat sind leer

### Requirement: Bedarf auf der Detailseite einer Betreuungsstelle

Die Detailseite einer Betreuungsstelle SHALL unter „Belegung in Zahlen“ ein Paneel „Bedarf“
zeigen: die offenen Nachforderungen der Stelle nach Priorität, dann neueste, je mit Anzahl und
Art als Sprung in die Nachforderung, Bezeichnung, Statuswort und Anforderungszeit. Ohne Freigabe
des Moduls Nachforderungen MUST das Paneel entfallen und die Zeile „Bedarf · Keine
Berechtigung“ stehen; die Nachforderungen MUST dann nicht abgefragt werden. Mit Schreibrecht
MUST „Bedarf anfordern“ in die Erfassung der Nachforderungsseite führen, mit Bezug auf die
Stelle und gefiltert auf sie. Das Paneel MUST keine Summe bilden.

#### Scenario: Bedarf anfordern
- **WHEN** auf der Seite der Stelle „Turnhalle Ost“ „Bedarf anfordern“ gewählt wird
- **THEN** öffnet sich die Erfassung der Nachforderungen mit „Für Betreuungsstelle Turnhalle Ost“ und vorbelegter Begründung

#### Scenario: Offener Bedarf
- **WHEN** für die Stelle eine Nachforderung „40× Feldbetten“ unterwegs ist
- **THEN** steht sie im Paneel „Bedarf“ mit dem Status „Unterwegs“

#### Scenario: Eingetroffen
- **WHEN** die Nachforderung eingetroffen ist
- **THEN** steht sie nicht mehr im Paneel; „Alle Nachforderungen der Stelle“ führt zu ihr

### Requirement: Stelle auf der Nachforderungsseite

Die Nachforderungsseite SHALL `?neu=1&betreuungsstelle=<id>` als Auftrag lesen: die Erfassung
öffnet mit dem Bezug, der Parameter wird geräumt, Schließen räumt den Bezug. `?stelle=<id>`
SHALL als Filter in der Adresse stehen bleiben und das Board mit seinen Spaltenzahlen auf die
Nachforderungen der Stelle beschränken; ein Filterhinweis MUST den Filter nennen und ihn
zurücksetzen können. Mit Freigabe Betreuung MUST eine Auswahl „Für Stelle“ die Stellen mit
Nachforderungen anbieten, und jede Karte mit Bezug MUST „Für Betreuungsstelle <Name>“ mit Sprung
auf die Stelle zeigen.

#### Scenario: Filter aus der Stelle
- **WHEN** „Alle Nachforderungen der Stelle“ gewählt wird
- **THEN** zeigt die Nachforderungsseite nur die Nachforderungen dieser Stelle mit „Filter zurücksetzen“

### Requirement: Kein Bedarf vom Gerät

Die Gerätesicht einer Betreuungsstelle SHALL keine Nachforderung anlegen; Bedarf vom Gerät
bleibt eine Freitext-Meldung.

#### Scenario: Gerät meldet Bedarf
- **WHEN** das Gerät der Stelle Bedarf an Decken meldet
- **THEN** entsteht eine Meldung, keine Nachforderung
