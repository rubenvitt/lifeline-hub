## ADDED Requirements

### Requirement: Über eine Direktkopplung wechselt die Führung gleichrangig

Sprechen beide Seiten einer Direktkopplung mindestens Protokoll 4, SHALL jede Seite die Führung
eines Einsatzes der zugeordneten Org an die Gegenstelle übergeben, per Code an sie abgeben, bei
ihr anfragen und gegen sie notübernehmen können, gleich welche Seite den Kopplungscode eingelöst
hat. Für den Führungswechsel zwischen den beiden Seiten MUST jede Seite die Regeln der meldenden
Seite anwenden: Eine Übernahme gegen sie gilt nur mit Beweis und erst nach der Entscheidung ihrer
Einsatzleitung. Eine Notübernahme ohne Beweis MUST über eine Direktkopplung mit 422 enden.
Spricht eine Seite ein älteres Protokoll, MUST die Oberfläche diese Bedienungen nicht anbieten und
„<Name> braucht ein Update für den Führungswechsel vor Ort“ zeigen; ein direkter Aufruf MUST mit
409 enden, und eine eingehende Akte, die die Führung zwischen den beiden Seiten verlegt, MUST
verworfen werden wie bisher.

#### Scenario: Übergabe an ELW vor Ort
- **WHEN** ELW 1 einen Einsatz führt, ELW 2 über eine Direktkopplung gekoppelt ist, beide Protokoll 4 sprechen und die Einsatzleitung an ELW 1 „Führung an ELW 2 übergeben“ bestätigt
- **THEN** ist der Einsatz an ELW 1 sofort ein Spiegel von ELW 2, und nach der nächsten Meldung führt ELW 2

#### Scenario: Abgabe per Code von der erreichten Seite
- **WHEN** ELW 1 den Kopplungscode ausgestellt hat, also erreichte Seite ist, einen Einsatz führt und die Einsatzleitung „Führung per Code abgeben“ an ELW 2 bestätigt
- **THEN** zeigt ELW 1 den Code einmal, der Einsatz ist dort ein Spiegel von ELW 2, und ein Admin an ELW 2 kann den Code mit Grund eingeben, den ELW 1 bei der nächsten Meldung als gültig erkennt

#### Scenario: Notübernahme ohne Beweis
- **WHEN** ein Admin an ELW 2 gegen ELW 1 vor Ort eine Notübernahme nur mit Grund erklären will
- **THEN** antwortet der Server mit 422, und der Dialog bietet vor Ort nur „Eigene Unterschrift“ und „Code des Gegenübers“

#### Scenario: Gegenstelle mit altem Protokoll
- **WHEN** ELW 2 über die Direktkopplung nur Protokoll 3 spricht
- **THEN** fehlt ELW 2 im Paneel „Führung“ an ELW 1 als Ziel, das Paneel zeigt „ELW 2 braucht ein Update für den Führungswechsel vor Ort“, und ein Aufruf der Übergabe endet mit 409

### Requirement: Eine Notübernahme vor Ort gilt erst nach der Entscheidung der abgebenden Seite

Erhält eine Seite einer Direktkopplung eine Akte, mit der die Gegenstelle ihr die Führung nimmt,
MUST sie diese nur offen halten, wenn die Erklärung eine Unterschrift eines hier gültigen
Unterschriftsschlüssels der Org über genau diese Erklärung trägt oder ihr Code zum Abgabecode
dieser Seite passt. Bis zur Entscheidung ihrer Einsatzleitung MUST sie weiter schreiben lassen und
das Hinweisband mit „Übernahme bestätigen“ und „Widersprechen“ zeigen. Ohne gültigen Beweis MUST
sie verwerfen, mit der nächsten Epoche weiter führen, die Benachrichtigung „Ungültige Übernahme
der Führung“ auslösen und einen Eintrag in die Admin-Spur schreiben. Die übernehmende Seite
SHALL ab ihrer Erklärung führen.

#### Scenario: ELW 1 fällt aus
- **WHEN** ELW 1 einen Einsatz führt und ohne Verbindung ist und ein Admin an ELW 2 mit seinem Unterschriftsschlüssel eine Notübernahme mit dem Grund „ELW 1 ausgefallen“ erklärt
- **THEN** führt ELW 2 den Einsatz sofort, und kommt ELW 1 zurück, zeigt es „Führung übernommen von ELW 2“ mit Unterzeichner und Grund, dazu „Übernahme bestätigen“ und „Widersprechen“, und schreibt weiter

#### Scenario: Bestätigen an ELW 1
- **WHEN** die Einsatzleitung an ELW 1 diese Übernahme bestätigt
- **THEN** ist der Einsatz an ELW 1 ein Spiegel von ELW 2, und der Verlauf zeigt die Bruchstelle

#### Scenario: Übernahme ohne gültigen Beweis
- **WHEN** ELW 2 über die Direktkopplung eine höhere Epoche mit sich als Führer meldet, deren Unterschrift an ELW 1 nicht gilt
- **THEN** führt ELW 1 weiter, löst „Ungültige Übernahme der Führung“ aus und schreibt einen Eintrag in die Admin-Spur

### Requirement: Die übernehmende Seite nimmt die Antwort auf ihre eigene Übernahme an

Widerspricht die abgebende Seite einer Direktkopplung einer Notübernahme oder verwirft sie diese,
SHALL die übernehmende Seite die Akte der abgebenden Seite annehmen, wenn sie genau ihre
Übernahme beantwortet: Die abgebende Seite war bisheriger Führer laut der Erklärung, und ihre
Epoche folgt unmittelbar auf die Epoche der Übernahme. Die übernehmende Seite MUST das mit der
Benachrichtigung „Ungültige Übernahme der Führung“ an ihre Einsatzleitung, einem Hinweis an der
Kopplung und einem Eintrag in der Admin-Spur zeigen. Eine andere Akte, mit der die Gegenstelle die
Führung beansprucht, MUST sie wie jede Übernahme prüfen.

#### Scenario: Widerspruch an ELW 1
- **WHEN** ELW 2 mit Epoche (5, ELW 2) per Notübernahme führt und die Einsatzleitung an ELW 1 widerspricht
- **THEN** führt ELW 1 mit Epoche (6, ELW 1), und nach der nächsten Meldung ist der Einsatz an ELW 2 ein Spiegel von ELW 1, die Kopplung zeigt „ELW 1 hat der Notübernahme widersprochen“, und die Einsatzleitung an ELW 2 bekommt den Alarm

#### Scenario: Späterer Anspruch ohne Beweis
- **WHEN** ELW 1 nach dem Widerspruch erneut mit größerer Epoche und sich als Führer meldet, ohne Erklärung, während ELW 2 inzwischen wieder per Übergabe führt
- **THEN** verwirft ELW 2 die Akte als ungültige Übernahme und führt weiter

### Requirement: Eine Anfrage vor Ort entscheidet die Einsatzleitung der führenden Seite

Fragt eine Seite einer Direktkopplung die Führung eines Einsatzes an, den die Gegenstelle führt,
MUST die führende Seite die Führung nicht von selbst abgeben. Sie SHALL im Paneel „Führung“
„<Name> bittet um die Führung“ mit „Übergeben“ und „Ablehnen“ zeigen und die Benachrichtigung
„Führung angefragt“ an die Einsatzleitung des Einsatzes auslösen. „Übergeben“ MUST eine reguläre
Übergabe an die anfragende Seite sein. „Ablehnen“ SHALL die Anfrage beenden: Die anfragende
Seite MUST nach der nächsten Meldung „Anfrage abgelehnt“ zeigen und ihre Anfrage zurücknehmen;
eine neue Anfrage derselben Seite MUST danach wieder angezeigt werden. Eine Anfrage gilt nur dem
Stand, den sie sah: Wechselt die Führung, verfällt sie.

#### Scenario: Anfrage an ELW 1
- **WHEN** ELW 1 einen Einsatz führt und ein Admin an ELW 2 „Führung anfragen“ wählt
- **THEN** führt nach der nächsten Meldung weiter ELW 1, das Paneel an ELW 1 zeigt „ELW 2 bittet um die Führung“ mit „Übergeben“ und „Ablehnen“, und die Einsatzleitung an ELW 1 bekommt „Führung angefragt“

#### Scenario: Übergeben auf Anfrage
- **WHEN** die Einsatzleitung an ELW 1 dort „Übergeben“ wählt
- **THEN** führt nach der nächsten Meldung ELW 2, und der Hinweis „bittet um die Führung“ verschwindet

#### Scenario: Ablehnen
- **WHEN** die Einsatzleitung an ELW 1 „Ablehnen“ wählt
- **THEN** führt weiter ELW 1, und nach der nächsten Meldung zeigt das Paneel an ELW 2 „Anfrage abgelehnt“ statt „Führung angefragt“, und der Verlauf an ELW 2 nennt die Ablehnung

### Requirement: Der Hub zieht einen Führungswechsel zwischen zwei ELW nach

Die erreichte Seite einer Standardkopplung SHALL eine Akte mit größerer Epoche annehmen, die eine
dritte Instanz als Führer nennt, wenn der Absender der Akte laut ihrer eigenen Akte bisher führte;
der bisherige Führer bezeugt damit die Abgabe. Sie SHALL außerdem eine Akte annehmen, mit der der
Absender sich die Führung von einer dritten Instanz per Notübernahme geholt hat, wenn deren
Erklärung die dritte Instanz und den Stand ihrer eigenen Akte als bisherigen Führer nennt und die
Unterschrift von einem hier gültigen Unterschriftsschlüssel der Org über genau diese Erklärung
stammt. Ein Code als Beweis MUST dafür nicht genügen. Jede andere Akte, mit der ein Absender die
Führung beansprucht, die bei einer dritten Instanz liegt, MUST sie wie bisher ablehnen.

#### Scenario: ELW 1 bestätigt die Übernahme durch ELW 2
- **WHEN** ELW 1 und ELW 2 beim Hub gekoppelt sind, ELW 2 vor Ort mit Code gegen ELW 1 übernommen hat und die Einsatzleitung an ELW 1 bestätigt
- **THEN** zeigt der Hub nach der nächsten Meldung von ELW 1 „Führung: ELW 2“ und spiegelt den Einsatz danach von ELW 2

#### Scenario: ELW 1 bleibt aus, Unterschrift trägt
- **WHEN** ELW 2 vor Ort mit der Unterschrift eines Org-Admins gegen ELW 1 übernommen hat, dessen Schlüssel am Hub bestätigt ist, ELW 1 nicht zurückkommt und ELW 2 sich beim Hub meldet
- **THEN** zeigt der Hub „Führung: ELW 2“ mit Grund und Unterzeichner im Verlauf, und ein Eintrag „Notübernahme durch ELW 2“ steht in seiner Admin-Spur

#### Scenario: Code allein genügt dem Hub nicht
- **WHEN** ELW 2 vor Ort per Code gegen ELW 1 übernommen hat, ELW 1 nicht zurückkommt und ELW 2 sich beim Hub meldet
- **THEN** zeigt der Hub weiter „Führung: ELW 1“ und an der Kopplung „ELW 2 beansprucht die Führung von „<Einsatz>“, die bei ELW 1 liegt: abgelehnt“

### Requirement: Über eine Direktkopplung werden Akten weiter angezeigt, der Widerruf holt nichts zurück

Akten SHALL über eine Direktkopplung ausgetauscht und unter „Einsätze beim Gegenüber“ angezeigt
werden, gleich welches Protokoll die Seiten sprechen. Der Widerruf einer Direktkopplung MUST die
Führung nicht zurückholen.

#### Scenario: Einsätze beim Gegenüber
- **WHEN** ELW 1 einen Einsatz der zugeordneten Org führt und ELW 2 sich als Direktkopplung meldet
- **THEN** zeigt ELW 2 unter „Einsätze beim Gegenüber“ den Einsatz mit „Führung: ELW 1“

#### Scenario: Widerruf einer Direktkopplung
- **WHEN** ELW 1 einen Einsatz führt, den ELW 2 über die Direktkopplung spiegelt, und der Admin an ELW 2 die Org-Zuordnung widerruft
- **THEN** holt ELW 2 die Führung nicht zurück: die Akte nennt weiter ELW 1, und der Spiegel bleibt lesbar stehen

## MODIFIED Requirements

### Requirement: Übernahme auf Anfrage beim Hub

Die meldende Seite einer Standardkopplung SHALL die Führung eines Einsatzes, den die erreichte
Seite führt, anfragen können. Die erreichte Seite MUST die Führung bei der Meldung mit dieser
Anfrage abgeben, wenn die Org des Einsatzes der anfragenden Kopplung zugeordnet ist, und die neue
Akte in ihrer Antwort bestätigen. Über eine Direktkopplung gilt stattdessen „Eine Anfrage vor Ort
entscheidet die Einsatzleitung der führenden Seite“.

#### Scenario: ELW übernimmt bei Ankunft
- **WHEN** der Hub einen Einsatz mit Epoche (1, Hub) führt und ein Admin am ELW „Führung anfragen“ wählt
- **THEN** führt nach der Meldung der ELW mit Epoche (2, Hub), und der Hub hält den Einsatz als Spiegel mit „Führung: ELW“

### Requirement: Übernahme gegen die erreichte Seite bestätigt ein Mensch der übernehmenden Seite

Die meldende Seite einer Standardkopplung SHALL die Führung eines Einsatzes, den die erreichte
Seite führt, ohne Verbindung übernehmen können, nachdem ein Berechtigter dort mit Grund bestätigt
hat. Die erreichte Seite MUST die höhere Epoche bei der nächsten Meldung ohne Rückfrage annehmen
und den Wechsel zeigen. Über eine Direktkopplung gilt das nicht: Dort braucht jede Notübernahme
einen Beweis.

#### Scenario: ELW übernimmt ohne Verbindung
- **WHEN** der Hub einen Einsatz führt, ein Admin am ELW ohne Verbindung „Notübernahme“ mit Grund bestätigt und der ELW sich später meldet
- **THEN** führt der ELW, der Hub hält den Einsatz als Spiegel mit „Führung: ELW“, und sein Paneel „Führung“ nennt unter „Zuletzt“ „Notübernahme“

### Requirement: Code zur Abgabe erzeugt die meldende Seite

Die Einsatzleitung oder ein Admin der Einsatz-Org an der meldenden, führenden Seite einer
Standardkopplung, und an jeder führenden Seite einer Direktkopplung, SHALL einen Code zur Abgabe an
das Gegenüber erzeugen können. Der Code MUST aus 16 Zeichen Crockford-Base32 bestehen, genau
einmal angezeigt und nur abgeleitet gespeichert werden. Mit dem Erzeugen MUST die abgebende Seite
die Führung abgeben, sodass sie ab da nicht mehr schreibt. Ein neuer Code MUST den vorigen ungültig
machen.

#### Scenario: Code per Funk
- **WHEN** die Einsatzleitung am ELW ohne Verbindung „Führung per Code abgeben“ bestätigt
- **THEN** zeigt der ELW den Code einmal, der Einsatz ist dort ein Spiegel von Hub, und der Verlauf zeigt „Abgabe per Code · ELW → Hub“ ohne wartenden Zustand

#### Scenario: Code am Hub eingegeben
- **WHEN** ein Admin am Hub den Code mit Grund eingibt und der ELW sich danach meldet
- **THEN** erkennt der ELW die Notübernahme als gültig, und beide zeigen den Hub als Führer

## REMOVED Requirements

### Requirement: Über eine Direktkopplung wechselt die Führung nicht

**Reason**: Ersetzt durch „Über eine Direktkopplung wechselt die Führung gleichrangig“ (LLH-1678).
Die Sperre bleibt nur gegenüber einer Gegenstelle mit Protokoll unter 4.

**Migration**: Keine Datenmigration. Bestehende Direktkopplungen tragen den Wechsel, sobald beide
Seiten Protokoll 4 sprechen. Die Szenarien „Einsätze beim Gegenüber“ und „Widerruf einer
Direktkopplung“ stehen jetzt unter „Über eine Direktkopplung werden Akten weiter angezeigt, der
Widerruf holt nichts zurück“.

### Requirement: Eine Direktkopplung nimmt keinen Führungswechsel zwischen ihren Seiten an

**Reason**: Ersetzt durch „Eine Notübernahme vor Ort gilt erst nach der Entscheidung der
abgebenden Seite“ und „Die übernehmende Seite nimmt die Antwort auf ihre eigene Übernahme an“
(LLH-1678). Verworfen wird nur noch ohne Beweis oder gegenüber einer Gegenstelle mit Protokoll
unter 4.

**Migration**: Keine.
