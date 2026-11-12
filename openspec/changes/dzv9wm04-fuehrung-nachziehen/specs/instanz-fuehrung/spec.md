## MODIFIED Requirements

### Requirement: Nur die führende Instanz schreibt den Einsatz

Eine Instanz, die einen Einsatz nicht führt, MUST ihn als Spiegel der führenden Instanz halten
(Spec `einsatz-spiegel`). Jeder direkte Schreibvorgang an ihm MUST mit dem 409 des Spiegels
scheitern, ausgenommen die beantragbaren Erfassungen (Spec `spiegel-antraege`). Lesen MUST
unverändert möglich sein. Die Oberfläche MUST den Einsatz dort mit dem Hinweisband „Spiegel von
<Name>“ zeigen, ab mittlerer Fensterbreite dazu im Einsatzkopf „Führung: <Name>“. Die Bedienung der Führung selbst ist
kein Schreibvorgang am Einsatz.

#### Scenario: Schreiben am abgelösten ELW
- **WHEN** der ELW die Übernahme durch den Hub bestätigt hat und jemand am ELW den Status einer Einheit ändern will
- **THEN** antwortet der Server mit 409 „Dieser Einsatz ist ein Spiegel; ändern geht nur als Antrag an die führende Instanz.“

#### Scenario: Lesen bleibt
- **WHEN** jemand am abgelösten ELW das Einsatztagebuch öffnet
- **THEN** sieht er alle Einträge, das Hinweisband „Spiegel von Hub Nord“ und auf einem Bildschirm ab mittlerer Breite im Einsatzkopf „Führung: Hub Nord“

#### Scenario: Eigene Führung ohne Chip
- **WHEN** jemand an der führenden Instanz den Einsatz öffnet
- **THEN** zeigt der Einsatzkopf keinen Chip „Führung: …“

### Requirement: Reguläre Übergabe durch die führende Instanz

Die führende Instanz SHALL die Führung an ein gekoppeltes Gegenüber mit derselben Org-Zuordnung
übergeben können. Mit dem Auslösen MUST sie die Führung abgeben: Die Epoche steigt, und das
Gegenüber führt. Das Gegenüber MUST die Übergabe bei der nächsten Meldung übernehmen, auch wenn
zwischen Auslösen und Meldung keine Verbindung bestand.

#### Scenario: ELW übergibt zur Verwahrung
- **WHEN** die Einsatzleitung am ELW mit Epoche (2, ELW) „Führung an Hub übergeben“ bestätigt
- **THEN** ist der Einsatz am ELW sofort ein Spiegel von Hub, und nach der nächsten Meldung führt der Hub mit Epoche (3, ELW)

### Requirement: Übernahme auf Anfrage beim Hub

Die meldende Seite SHALL die Führung eines Einsatzes, den die erreichte Seite führt, anfragen
können. Die erreichte Seite MUST die Führung bei der Meldung mit dieser Anfrage abgeben, wenn die
Org des Einsatzes der anfragenden Kopplung zugeordnet ist, und die neue Akte in ihrer Antwort
bestätigen.

#### Scenario: ELW übernimmt bei Ankunft
- **WHEN** der Hub einen Einsatz mit Epoche (1, Hub) führt und ein Admin am ELW „Führung anfragen“ wählt
- **THEN** führt nach der Meldung der ELW mit Epoche (2, Hub), und der Hub hält den Einsatz als Spiegel mit „Führung: ELW“

### Requirement: Notübernahme gegen die meldende Seite braucht Admin-Unterschrift oder Code

Die erreichte Seite SHALL die Führung eines Einsatzes, den die meldende Seite führt, nur mit einer
Erklärung übernehmen, die entweder die Passkey-Unterschrift eines Admins der Org über ihren Hash
trägt oder einen Code der meldenden Seite. Die Erklärung MUST Einsatzkennung, alte und neue
Epoche, alte und neue führende Instanz, Grund, Zeitpunkt und Unterzeichner enthalten. Ein Grund
MUST angegeben sein. Mit eigener Unterschrift MUST nur ein Admin übernehmen können; die
Einsatzleitung übernimmt mit dem Code.

#### Scenario: Notübernahme mit Unterschrift
- **WHEN** ein Admin am Hub für einen Einsatz des ELW mit Epoche (2, ELW) den Grund „ELW ohne Verbindung seit 40 min“ eingibt und mit seinem Unterschriftsschlüssel unterschreibt
- **THEN** führt der Hub den Einsatz mit Epoche (3, Hub) und liefert die Erklärung bei der nächsten Meldung des ELW aus

#### Scenario: Ohne Unterschriftsschlüssel und ohne Code
- **WHEN** ein Admin ohne gültigen Unterschriftsschlüssel eine Notübernahme ohne Code erklären will
- **THEN** antwortet der Server mit 409 und dem Hinweis, einen Unterschriftsschlüssel zu registrieren oder einen Code des ELW einzugeben

#### Scenario: Ohne Grund
- **WHEN** ein Admin eine Notübernahme ohne Grund erklären will
- **THEN** antwortet der Server mit 422

#### Scenario: Einsatzleitung ohne Admin-Rolle
- **WHEN** die Einsatzleitung am Hub, die kein Admin ist, im Paneel „Führung“ des Spiegels eines ELW-Einsatzes „Notübernahme …“ wählt
- **THEN** bietet der Dialog keine Wahl „Eigene Unterschrift“, sondern nur das Feld für den Code des Gegenübers, und ein direkter Aufruf der Unterschrift endet mit 403

#### Scenario: Admin wählt den Beweis
- **WHEN** ein Admin der Einsatz-Org am Hub denselben Dialog öffnet
- **THEN** wählt er unter „Beweis“ zwischen „Eigene Unterschrift“ und „Code des Gegenübers“

#### Scenario: Admin einer anderen Org
- **WHEN** ein Admin einer anderen Org, der Einsatzleitung des Spiegels ist, denselben Dialog öffnet
- **THEN** bietet der Dialog keine Wahl „Eigene Unterschrift“, sondern nur das Feld für den Code

### Requirement: Code zur Abgabe erzeugt die meldende Seite

Die Einsatzleitung oder ein Admin der Einsatz-Org an der meldenden, führenden Seite SHALL einen
Code zur Abgabe an das Gegenüber erzeugen können. Der Code MUST aus 16 Zeichen Crockford-Base32
bestehen, genau einmal angezeigt und nur abgeleitet gespeichert werden. Mit dem Erzeugen MUST die
meldende Seite die Führung abgeben, sodass sie ab da nicht mehr schreibt. Ein neuer Code MUST den
vorigen ungültig machen.

#### Scenario: Code per Funk
- **WHEN** die Einsatzleitung am ELW ohne Verbindung „Führung per Code abgeben“ bestätigt
- **THEN** zeigt der ELW den Code einmal, der Einsatz ist dort ein Spiegel von Hub, und der Verlauf zeigt „Abgabe per Code · ELW → Hub“ ohne wartenden Zustand

#### Scenario: Code am Hub eingegeben
- **WHEN** ein Admin am Hub den Code mit Grund eingibt und der ELW sich danach meldet
- **THEN** erkennt der ELW die Notübernahme als gültig, und beide zeigen den Hub als Führer

### Requirement: Die meldende Seite prüft jede Übernahme gegen sie

Erhält die meldende Seite eine Akte, die ihr die Führung nimmt, MUST sie diese nur annehmen, wenn
sie eine reguläre Übergabe von ihr selbst bestätigt oder eine Erklärung trägt, deren Unterschrift
von einem gültigen Unterschriftsschlüssel der zugeordneten Org über genau diese Erklärung stammt
oder deren Code zu ihrem Abgabecode passt. Sonst MUST sie die Akte verwerfen und weiter führen.

#### Scenario: Gültige Unterschrift
- **WHEN** der ELW eine Erklärung des Hubs erhält, die Admin A mit einem am ELW gültigen Schlüssel unterschrieben hat
- **THEN** zeigt der ELW unter der Kopfleiste über die volle Breite „Führung übernommen von Hub Nord“ mit Zeit, „unterzeichnet von Admin A“ und dem Grund „ELW ohne Verbindung seit 40 min“, dazu „Übernahme bestätigen“ und „Widersprechen“, und schreibt weiter

#### Scenario: Schlüssel wartet auf Bestätigung
- **WHEN** die Unterschrift von einem Schlüssel stammt, der am ELW noch auf Bestätigung wartet
- **THEN** verwirft der ELW die Übernahme als ungültig

#### Scenario: Ungültige Übernahme
- **WHEN** der ELW eine Übernahme ohne gültige Unterschrift und ohne passenden Code erhält
- **THEN** führt der ELW weiter, löst die Benachrichtigung „Ungültige Übernahme der Führung“ an die Einsatzleitung aus und schreibt einen Eintrag in die Admin-Spur

### Requirement: Die meldende Seite gibt nie still ab

Eine gültige Notübernahme gegen die meldende Seite SHALL dort erst gelten, wenn die Einsatzleitung
sie bestätigt; bis dahin MUST die meldende Seite den Einsatz weiter schreiben lassen. Beim
Bestätigen MUST sie die Bruchstelle festhalten, den Zeitpunkt der letzten erfolgreichen Meldung
vor der Übernahme. Eine Abgabe per Code gilt mit ihrem Erzeugen als bestätigt.

#### Scenario: Bestätigen
- **WHEN** die Einsatzleitung am ELW „Übernahme bestätigen“ wählt
- **THEN** ist der Einsatz am ELW ein Spiegel von Hub Nord, und der Verlauf zeigt die Bruchstelle

### Requirement: Übernahme gegen die erreichte Seite bestätigt ein Mensch der übernehmenden Seite

Die meldende Seite SHALL die Führung eines Einsatzes, den die erreichte Seite führt, ohne
Verbindung übernehmen können, nachdem ein Berechtigter dort mit Grund bestätigt hat. Die erreichte
Seite MUST die höhere Epoche bei der nächsten Meldung ohne Rückfrage annehmen und den Wechsel
zeigen.

#### Scenario: ELW übernimmt ohne Verbindung
- **WHEN** der Hub einen Einsatz führt, ein Admin am ELW ohne Verbindung „Notübernahme“ mit Grund bestätigt und der ELW sich später meldet
- **THEN** führt der ELW, der Hub hält den Einsatz als Spiegel mit „Führung: ELW“, und sein Paneel „Führung“ nennt unter „Zuletzt“ „Notübernahme“

### Requirement: Jeder Führungswechsel ist nachvollziehbar

Das System SHALL je Einsatz den Verlauf der Führung zeigen: Epoche, Art des Wechsels, abgebende und
übernehmende Instanz, wer, warum, wann und gegebenenfalls die Bruchstelle. Notübernahmen,
verworfene Übernahmen und Widersprüche MUST zusätzlich in der Admin-Spur der Org stehen;
ausgenommen ist das Zurückholen nach einem Widerruf, für das der Widerruf der Kopplung in der
Spur steht.

#### Scenario: Verlauf nach Notübernahme
- **WHEN** der ELW eine Notübernahme durch Hub Nord bestätigt hat
- **THEN** zeigt das Paneel „Führung“ am ELW im Verlauf den Eintrag „1 Angelegt“ und „2 Notübernahme bestätigt · ELW → Hub Nord“ mit Grund, Unterzeichner und Bruchstelle

## ADDED Requirements

### Requirement: Den Verlauf der Führung lesen nur Personen

Den Stand und den Verlauf der Führung eines Einsatzes SHALL jede Person lesen können, die den
Einsatz liest. Ein Gerätekonto MUST darauf 403 bekommen; ob ein anderer führt, sieht ein Gerät am
Hinweisband „Spiegel von …“.

#### Scenario: Gerätekonto fragt den Verlauf ab
- **WHEN** ein Gerätekonto, das den Einsatz lesen darf, die Führung des Einsatzes abruft
- **THEN** antwortet der Server mit 403

#### Scenario: Beobachter liest den Verlauf
- **WHEN** ein Mitglied mit der Rolle Beobachter die Seite „Einsatzdaten“ öffnet
- **THEN** sieht es das Paneel „Führung“ mit Stand und Verlauf, aber ohne Bedienung

### Requirement: Widerruf holt die Führung zurück

Endet bei eingeschaltetem Schalter die Org-Zuordnung einer Kopplung, hier oder beim Gegenüber,
SHALL diese Instanz jeden Einsatz der Org, den sie als Spiegel hält und dessen Akte das Gegenüber
als Führer nennt, mit der nächsten Epoche selbst führen; Bruchstelle ist der Zeitpunkt, zu dem
sie vom Widerruf erfährt. Der Spiegel MUST dabei zu einem eigenen,
schreibbaren Einsatz werden. Offene Übernahmen dieses Gegenübers MUST verfallen. Einsätze, die es
hier nur als Akte gibt, bleiben, wie sie sind.

#### Scenario: Widerruf am ELW
- **WHEN** der Hub einen Einsatz mit Epoche (3, Hub) führt, den der ELW spiegelt, und der Admin am ELW die Org-Zuordnung widerruft
- **THEN** führt der ELW ihn mit Epoche (4, ELW), das Hinweisband „Spiegel von Hub“ verschwindet, der Einsatz ist am ELW wieder schreibbar, und der Verlauf zeigt eine Notübernahme mit dem Grund „Kopplung widerrufen“ und dem Widerruf als Bruchstelle

#### Scenario: Offene Übernahme verfällt
- **WHEN** am ELW eine gültige Notübernahme des Hubs auf Bestätigung wartet und die Org-Zuordnung zum Hub widerrufen wird
- **THEN** verschwindet „Führung übernommen von …“, und der ELW führt weiter
