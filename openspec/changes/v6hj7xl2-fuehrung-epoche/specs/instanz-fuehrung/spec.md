# Spec Delta

## Purpose

Gekoppelte Instanzen (etwa ein ELW und ein Hub) einigen sich je Einsatz auf genau eine führende
Instanz. Die Führung wandert per Übergabe oder Notübernahme. Ein überbringender Server kann sie
dabei nicht fälschen, und die meldende Seite gibt sie nie still ab.

## ADDED Requirements

### Requirement: Führung nur mit eingeschaltetem Schalter

Das System SHALL Führung je Einsatz nur betreiben, wenn der Betreiber sie mit `LIFELINE_FUEHRUNG`
eingeschaltet hat; die Vorgabe ist aus. Ohne den Schalter MUST eine Instanz keine Führungsakten
austauschen, keine Führung anzeigen und jeden Einsatz wie bisher schreiben lassen. Ihre Routen zur
Führung MUST mit 404 antworten.

#### Scenario: Schalter aus
- **WHEN** an einem ELW ohne `LIFELINE_FUEHRUNG` ein Einsatz der gekoppelten Org angelegt wird und der ELW sich meldet
- **THEN** zeigt der Hub keinen Einsatz des ELW, und am ELW bleibt der Einsatz schreibbar ohne Führungsanzeige

#### Scenario: Routen ohne Schalter
- **WHEN** an einer Instanz ohne Schalter eine Route zur Führung aufgerufen wird
- **THEN** antwortet der Server mit 404

### Requirement: Jeder Einsatz einer gekoppelten Org hat eine Führungsakte

Bei eingeschaltetem Schalter SHALL jeder nicht gelöschte Einsatz, dessen Org in einer aktiven
Kopplung zugeordnet ist, eine Führungsakte haben, auch ein abgeschlossener. Sie trägt eine
instanzübergreifende Einsatzkennung, die führende Instanz und eine Epoche. Ein neuer Einsatz MUST
mit der anlegenden Instanz als Führer und der Epoche 1 beginnen. Beide Seiten MUST einander bei
jeder Meldung die Akten der zugeordneten Orgs übergeben.

#### Scenario: Neuer Einsatz am ELW
- **WHEN** am ELW ein Einsatz der gekoppelten Org „DRK KV Nord“ angelegt wird und der ELW sich meldet
- **THEN** zeigt der Hub auf der Seite „Instanzkopplung“ unter „Einsätze beim Gegenüber“ diesen Einsatz mit „Führung: ELW · Epoche 1“

#### Scenario: Bestehender Einsatz beim Koppeln
- **WHEN** ein ELW mit einem laufenden Einsatz seiner Org gekoppelt wird
- **THEN** bekommt dieser Einsatz eine Führungsakte mit dem ELW als Führer und der Epoche 1

### Requirement: Die größere Epoche gilt

Eine Epoche SHALL ein Paar aus Zähler und Kennung der Instanz sein, die sie vergeben hat. Ein
Paar ist größer, wenn sein Zähler größer ist oder bei gleichem Zähler seine Instanzkennung.
Erhält eine Instanz eine Akte mit größerer Epoche, MUST diese gelten; verliert die Instanz dadurch
die Führung, MUST sie denselben Ablauf durchlaufen wie bei jeder Übernahme gegen sie.

#### Scenario: Höhere Epoche
- **WHEN** der Hub eine Akte mit Epoche (3, Hub) hat und der ELW (4, ELW) meldet
- **THEN** gilt am Hub die Epoche (4, ELW) mit dem ELW als Führer

#### Scenario: Gleichstand zweier Notübernahmen
- **WHEN** zwei Instanzen ohne Verbindung beide eine Notübernahme mit dem Zähler 5 erklären
- **THEN** gilt nach dem Austausch an beiden die Erklärung der Instanz mit der größeren Kennung, und die andere durchläuft den Ablauf einer Übernahme gegen sie

### Requirement: Nur die führende Instanz schreibt den Einsatz

Eine Instanz, die einen Einsatz nicht führt, MUST jeden Schreibvorgang an diesem Einsatz mit 409
und dem Hinweis „Führung liegt bei „<Name>“.“ ablehnen. Lesen MUST unverändert möglich sein. Die
Oberfläche MUST den Einsatz dort als „Nur Ansicht“ mit diesem Grund zeigen. Die Bedienung der
Führung selbst ist kein Schreibvorgang am Einsatz.

#### Scenario: Schreiben am abgelösten ELW
- **WHEN** der ELW die Übernahme durch den Hub bestätigt hat und jemand am ELW einen ETB-Eintrag speichert
- **THEN** antwortet der Server mit 409 „Führung liegt bei „Hub Nord“.“

#### Scenario: Lesen bleibt
- **WHEN** jemand am abgelösten ELW das Einsatztagebuch öffnet
- **THEN** sieht er alle Einträge und den Hinweis „Nur Ansicht · Führung liegt bei „Hub Nord““

### Requirement: Wer die Führung bedient

An der Instanz, bei der ein Einsatz liegt, SHALL die Einsatzleitung dieses Einsatzes die Führung
bedienen. Einen Einsatz, den die Instanz nur als Akte des Gegenübers kennt, SHALL ein Admin der
zugeordneten Org bedienen. Andere Konten MUST 403 bekommen. Die Bedienung MUST auch an einem
abgeschlossenen Einsatz möglich sein.

#### Scenario: Führungspersonal
- **WHEN** ein Konto mit der Rolle Führungspersonal am ELW „Führung an Hub übergeben“ auslöst
- **THEN** antwortet der Server mit 403

#### Scenario: Abgeschlossener Einsatz zur Verwahrung
- **WHEN** die Einsatzleitung am ELW nach dem Einsatzabschluss „Führung an Hub übergeben“ wählt
- **THEN** führt danach der Hub den Einsatz

### Requirement: Reguläre Übergabe durch die führende Instanz

Die führende Instanz SHALL die Führung an ein gekoppeltes Gegenüber mit derselben Org-Zuordnung
übergeben können. Mit dem Auslösen MUST sie die Führung abgeben: Die Epoche steigt, und das
Gegenüber führt. Das Gegenüber MUST die Übergabe bei der nächsten Meldung übernehmen, auch wenn
zwischen Auslösen und Meldung keine Verbindung bestand.

#### Scenario: ELW übergibt zur Verwahrung
- **WHEN** die Einsatzleitung am ELW mit Epoche (2, ELW) „Führung an Hub übergeben“ bestätigt
- **THEN** ist der Einsatz am ELW sofort „Nur Ansicht“, und nach der nächsten Meldung führt der Hub mit Epoche (3, ELW)

### Requirement: Übernahme auf Anfrage beim Hub

Die meldende Seite SHALL die Führung eines Einsatzes, den die erreichte Seite führt, anfragen
können. Die erreichte Seite MUST die Führung bei der Meldung mit dieser Anfrage abgeben, wenn die
Org des Einsatzes der anfragenden Kopplung zugeordnet ist, und die neue Akte in ihrer Antwort
bestätigen.

#### Scenario: ELW übernimmt bei Ankunft
- **WHEN** der Hub einen Einsatz mit Epoche (1, Hub) führt und ein Admin am ELW „Führung übernehmen“ wählt
- **THEN** führt nach der Meldung der ELW mit Epoche (2, Hub), und der Hub zeigt den Einsatz als „Führung: ELW“

### Requirement: Notübernahme gegen die meldende Seite braucht Admin-Unterschrift oder Code

Die erreichte Seite SHALL die Führung eines Einsatzes, den die meldende Seite führt, nur mit einer
Erklärung übernehmen, die entweder die Passkey-Unterschrift eines Admins der Org über ihren Hash
trägt oder einen Code der meldenden Seite. Die Erklärung MUST Einsatzkennung, alte und neue
Epoche, alte und neue führende Instanz, Grund, Zeitpunkt und Unterzeichner enthalten. Ein Grund
MUST angegeben sein.

#### Scenario: Notübernahme mit Unterschrift
- **WHEN** ein Admin am Hub für einen Einsatz des ELW mit Epoche (2, ELW) den Grund „ELW ohne Verbindung seit 40 min“ eingibt und mit seinem Unterschriftsschlüssel unterschreibt
- **THEN** führt der Hub den Einsatz mit Epoche (3, Hub) und liefert die Erklärung bei der nächsten Meldung des ELW aus

#### Scenario: Ohne Unterschriftsschlüssel und ohne Code
- **WHEN** ein Admin ohne gültigen Unterschriftsschlüssel eine Notübernahme ohne Code erklären will
- **THEN** antwortet der Server mit 409 und dem Hinweis, einen Unterschriftsschlüssel zu registrieren oder einen Code des ELW einzugeben

#### Scenario: Ohne Grund
- **WHEN** ein Admin eine Notübernahme ohne Grund erklären will
- **THEN** antwortet der Server mit 422

### Requirement: Code zur Abgabe erzeugt die meldende Seite

Die Einsatzleitung an der meldenden, führenden Seite SHALL einen Code zur Abgabe an das Gegenüber
erzeugen können. Der Code MUST aus 16 Zeichen Crockford-Base32 bestehen, genau einmal angezeigt
und nur abgeleitet gespeichert werden. Mit dem Erzeugen MUST die meldende Seite die Führung
abgeben, sodass sie ab da nicht mehr schreibt. Ein neuer Code MUST den vorigen ungültig machen.

#### Scenario: Code per Funk
- **WHEN** die Einsatzleitung am ELW ohne Verbindung „Führung per Code abgeben“ bestätigt
- **THEN** zeigt der ELW den Code einmal, der Einsatz ist dort „Nur Ansicht“, und der Verlauf zeigt „per Code an Hub abgegeben, wartet auf Hub“

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
- **THEN** zeigt der ELW über die volle Breite „Führung übernommen von Hub Nord, 14:32, Admin A: ELW ohne Verbindung seit 40 min“ mit „Übernahme bestätigen“ und „Widersprechen“ und schreibt weiter

#### Scenario: Schlüssel wartet auf Bestätigung
- **WHEN** die Unterschrift von einem Schlüssel stammt, der am ELW noch auf Bestätigung wartet
- **THEN** verwirft der ELW die Übernahme als ungültig

#### Scenario: Ungültige Übernahme
- **WHEN** der ELW eine Übernahme ohne gültige Unterschrift und ohne passenden Code erhält
- **THEN** führt der ELW weiter, löst den Alarm „Gegenüber meldet ungültige Übernahme“ an die Einsatzleitung aus und schreibt einen Eintrag in die Admin-Spur

### Requirement: Die meldende Seite gibt nie still ab

Eine gültige Notübernahme gegen die meldende Seite SHALL dort erst gelten, wenn die Einsatzleitung
sie bestätigt; bis dahin MUST die meldende Seite den Einsatz weiter schreiben lassen. Beim
Bestätigen MUST sie die Bruchstelle festhalten, den Zeitpunkt der letzten erfolgreichen Meldung
vor der Übernahme. Eine Abgabe per Code gilt mit ihrem Erzeugen als bestätigt.

#### Scenario: Bestätigen
- **WHEN** die Einsatzleitung am ELW „Übernahme bestätigen“ wählt
- **THEN** ist der Einsatz am ELW „Nur Ansicht“, und der Verlauf zeigt die Bruchstelle

### Requirement: Widersprechen heißt Rückübernahme

Widerspricht die Einsatzleitung an der meldenden Seite einer gültigen Notübernahme, SHALL die
meldende Seite mit der nächsten Epoche selbst weiter führen. Die erreichte Seite MUST die höhere
Epoche bei der nächsten Meldung annehmen und den Widerspruch in der Kopplung und in der Admin-Spur
zeigen.

#### Scenario: Widerspruch
- **WHEN** der Hub mit Epoche (3, Hub) übernommen hat und die Einsatzleitung am ELW widerspricht
- **THEN** führt der ELW mit Epoche (4, ELW), und nach der Meldung zeigt der Hub „ELW hat der Notübernahme widersprochen“

### Requirement: Übernahme gegen die erreichte Seite bestätigt ein Mensch der übernehmenden Seite

Die meldende Seite SHALL die Führung eines Einsatzes, den die erreichte Seite führt, ohne
Verbindung übernehmen können, nachdem ein Berechtigter dort mit Grund bestätigt hat. Die erreichte
Seite MUST die höhere Epoche bei der nächsten Meldung ohne Rückfrage annehmen und den Wechsel
zeigen.

#### Scenario: ELW übernimmt ohne Verbindung
- **WHEN** der Hub einen Einsatz führt, ein Admin am ELW ohne Verbindung „Notübernahme“ mit Grund bestätigt und der ELW sich später meldet
- **THEN** führt der ELW, und der Hub zeigt den Einsatz als „Führung: ELW (Notübernahme)“

### Requirement: Jeder Führungswechsel ist nachvollziehbar

Das System SHALL je Einsatz den Verlauf der Führung zeigen: Epoche, Art des Wechsels, abgebende und
übernehmende Instanz, wer, warum, wann und gegebenenfalls die Bruchstelle. Notübernahmen,
verworfene Übernahmen und Widersprüche MUST zusätzlich in der Admin-Spur der Org stehen.

#### Scenario: Verlauf nach Notübernahme
- **WHEN** der ELW eine Notübernahme bestätigt hat
- **THEN** zeigt das Paneel „Führung“ am ELW die Einträge „angelegt (1)“, „Notübernahme durch Hub Nord (2)“ mit Grund, Unterzeichner und Bruchstelle
