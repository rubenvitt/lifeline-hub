# instanz-fuehrung Specification

## Purpose
Gekoppelte Instanzen (etwa ein ELW und ein Hub) einigen sich je Einsatz auf genau eine führende
Instanz. Die Führung wandert per Übergabe oder Notübernahme. Ein überbringender Server kann sie
dabei nicht fälschen, und die meldende Seite gibt sie nie still ab.

## Requirements

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
die Führung, MUST sie denselben Ablauf durchlaufen wie bei jeder Übernahme gegen sie. Ausnahme:
Liegt die Führung bei einer anderen meldenden Seite, MUST die erreichte Seite die Epoche einer
meldenden Seite ablehnen, auch wenn sie größer ist; dann gilt die zuerst angenommene.

#### Scenario: Höhere Epoche
- **WHEN** der Hub eine Akte mit Epoche (3, Hub) hat und der ELW (4, ELW) meldet
- **THEN** gilt am Hub die Epoche (4, ELW) mit dem ELW als Führer

#### Scenario: Gleichstand zweier Notübernahmen
- **WHEN** der Hub einen Einsatz mit Epoche (1, Hub) führt, „ELW 1“ und „ELW 2“ ohne Verbindung beide eine Notübernahme erklären und „ELW 1“ sich zuerst meldet
- **THEN** führt am Hub „ELW 1“, und die Übernahme von „ELW 2“ lehnt der Hub mit einem Hinweis an der Kopplung ab, gleich welche der beiden Epochen größer ist

### Requirement: Nur die führende Instanz schreibt den Einsatz

Eine Instanz, die einen Einsatz nicht führt, MUST ihn als Spiegel der führenden Instanz halten
(Spec `einsatz-spiegel`). Jeder direkte Schreibvorgang an ihm MUST mit dem 409 des Spiegels
scheitern, ausgenommen die beantragbaren Erfassungen (Spec `spiegel-antraege`). Lesen MUST
unverändert möglich sein. Die Oberfläche MUST den Einsatz dort mit dem Hinweisband „Spiegel von
<Name>“ zeigen. Die Bedienung der Führung selbst ist
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

### Requirement: Wer die Führung bedient

An der Instanz, bei der ein Einsatz liegt, SHALL die Einsatzleitung dieses Einsatzes oder ein
Admin der Einsatz-Org die Führung bedienen. Einen Einsatz, den die Instanz nur als Akte des Gegenübers kennt, SHALL ein Admin der
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
MUST angegeben sein. Unterschreiben MUST nur ein Admin der Org.

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
Ausgenommen ist eine Akte, an der eine dritte Instanz beteiligt ist (sie führt, oder sie hat die
Epoche vergeben, mit der die erreichte Seite selbst führt): Die MUST die meldende Seite ohne Alarm
offen halten, bis die Einsatzleitung entscheidet.

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

### Requirement: Widersprechen heißt Rückübernahme

Widerspricht die Einsatzleitung an der meldenden Seite einer gültigen Notübernahme, SHALL die
meldende Seite mit der nächsten Epoche selbst weiter führen. Die erreichte Seite MUST die höhere
Epoche bei der nächsten Meldung annehmen und den Widerspruch in der Kopplung und in der Admin-Spur
zeigen. Einer offenen Übernahme, in der die erreichte Seite einen Dritten als Führer nennt, MUST
die meldende Seite nicht widersprechen lassen und mit 422 antworten.

#### Scenario: Widerspruch
- **WHEN** der Hub mit Epoche (3, Hub) übernommen hat und die Einsatzleitung am ELW widerspricht
- **THEN** führt der ELW mit Epoche (4, ELW), und nach der Meldung zeigt der Hub „ELW hat der Notübernahme widersprochen“

#### Scenario: Kein Widerspruch gegen den Dritten
- **WHEN** an „ELW 2“ die Führung von „ELW 1“ offen ist und die Einsatzleitung widersprechen will
- **THEN** antwortet der Server mit 422, und das Hinweisband bietet nur „Übernahme bestätigen“

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


### Requirement: Die unterlegene meldende Seite hält die Führung des Dritten offen

Führt die meldende Seite einen Einsatz und nennt die Akte der erreichten Seite eine Instanz als
Führer, mit der die meldende Seite nicht gekoppelt ist, MUST sie diese Akte als offene Übernahme
halten, gleich welche Epoche größer ist. Sie MUST weiter schreiben lassen, das Hinweisband zeigen
und die Einsatzleitung einmal benachrichtigen. Nennt die erreichte Seite keinen Dritten mehr oder
endet die Kopplung, MUST die offene Übernahme erlöschen.

#### Scenario: ELW 2 erfährt, dass ELW 1 führt
- **WHEN** der Hub die Notübernahme von „ELW 1“ angenommen hat und „ELW 2“ mit eigener Notübernahme sich danach meldet
- **THEN** schreibt „ELW 2“ weiter und zeigt „Deine Notübernahme hat am Hub nicht gegriffen, die Führung liegt bei ELW 1“ ohne Grund und Unterzeichner von „ELW 1“, und die Einsatzleitung von „ELW 2“ bekommt den Hinweis „Führung übernommen“

#### Scenario: Reguläre Übergabe an ELW 1
- **WHEN** der Hub den Einsatz auf Anfrage an „ELW 1“ abgegeben hat und „ELW 2“ ohne Verbindung vom alten Stand eine Notübernahme erklärt hat und sich meldet
- **THEN** hält „ELW 2“ die Führung von „ELW 1“ offen und löst keinen Alarm „Gegenüber meldet ungültige Übernahme“ aus

#### Scenario: Bestätigen
- **WHEN** die Einsatzleitung an „ELW 2“ diese offene Übernahme bestätigt
- **THEN** ist der Einsatz an „ELW 2“ „Nur Ansicht · Führung liegt bei „ELW 1““, und der Verlauf zeigt die Bruchstelle

#### Scenario: Ohne eigene Notübernahme
- **WHEN** „ELW 2“ die Führung per Übergabe bekam und die Akte des Hubs danach „ELW 1“ als Führer nennt
- **THEN** zeigt „ELW 2“ „Die Führung liegt am Hub bei ELW 1, nicht hier“

#### Scenario: Weitere Meldetakte
- **WHEN** an „ELW 2“ eine solche Übernahme offen ist und sich „ELW 2“ mehrmals meldet, ohne dass sich am Hub etwas ändert
- **THEN** bleibt es bei einem Hinweis „Führung übernommen“, und keine Seite ändert ihre Akte

#### Scenario: Der Hub nennt keinen Dritten mehr
- **WHEN** an „ELW 2“ eine solche Übernahme offen ist und die Akte des Hubs danach wieder den Hub oder „ELW 2“ als Führer nennt
- **THEN** zeigt „ELW 2“ keine Übernahme mit „ELW 1“ mehr

#### Scenario: Kopplung widerrufen
- **WHEN** an „ELW 2“ eine solche Übernahme offen ist und die Kopplung zum Hub widerrufen wird
- **THEN** zeigt „ELW 2“ keine offene Übernahme mehr und führt weiter

### Requirement: Führt die erreichte Seite mit der Epoche eines Dritten, entscheidet ein Mensch der meldenden Seite

Führt die meldende Seite einen Einsatz und nennt die Akte der erreichten Seite diese selbst als
Führer, mit einer größeren Epoche, die eine dritte Instanz vergeben hat, MUST die meldende Seite
die Akte als offene Übernahme halten, ohne Alarm und mit „Übernahme bestätigen“ und
„Widersprechen“. Widerspricht die Einsatzleitung, MUST die erreichte Seite die nächste Epoche der
meldenden Seite bei der nächsten Meldung annehmen.

#### Scenario: Hub hat zwischendurch von ELW 1 zurückbekommen
- **WHEN** „ELW 2“ ohne Verbindung eine Notübernahme mit Epoche (2, ELW 2) erklärt, während „ELW 1“ die Führung mit Epoche (3, ELW 1) an den Hub zurückgegeben hat, und „ELW 2“ sich meldet
- **THEN** zeigt „ELW 2“ „Führung übernommen von Hub“ mit „Übernahme bestätigen“ und „Widersprechen“, ohne Alarm „Gegenüber meldet ungültige Übernahme“, und der Hub führt weiter

#### Scenario: Widersprechen
- **WHEN** die Einsatzleitung an „ELW 2“ dieser Übernahme widerspricht und „ELW 2“ sich meldet
- **THEN** führt „ELW 2“ mit Epoche (4, ELW 2) an beiden Seiten

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
als Führer nennt, mit der nächsten Epoche selbst und schreibbar führen; Bruchstelle ist der
Zeitpunkt, zu dem sie vom Widerruf erfährt. Offene Übernahmen dieses Gegenübers MUST verfallen.

#### Scenario: Widerruf am ELW
- **WHEN** der Hub einen Einsatz mit Epoche (3, Hub) führt, den der ELW spiegelt, und der Admin am ELW die Org-Zuordnung widerruft
- **THEN** führt der ELW ihn mit Epoche (4, ELW), das Hinweisband „Spiegel von Hub“ verschwindet, der Einsatz ist am ELW wieder schreibbar, und der Verlauf zeigt eine Notübernahme mit dem Grund „Kopplung widerrufen“ und dem Widerruf als Bruchstelle

#### Scenario: Offene Übernahme verfällt
- **WHEN** am ELW eine gültige Notübernahme des Hubs auf Bestätigung wartet und die Org-Zuordnung zum Hub widerrufen wird
- **THEN** verschwindet „Führung übernommen von …“, und der ELW führt weiter

### Requirement: Die Erklärung einer Notübernahme passt in die Grenze des Gegenübers
Eine Notübernahme MUST NOT eine Erklärung erzeugen, die größer ist, als das Gegenüber an einer
Akte annimmt (4096 Byte). Als Unterzeichner MUST die Erklärung höchstens die ersten 200 Zeichen
des Anzeigenamens tragen. Ist die Erklärung danach noch zu groß, MUST der Server mit 422
ablehnen, ohne dass die Führung wechselt oder ein Eintrag im Verlauf entsteht. Das gilt für die
Notübernahme gegen die erreichte Seite, mit Unterschrift und mit Code.

#### Scenario: Langer Bestandsname übernimmt trotzdem
- **WHEN** ein Admin am ELW, dessen Anzeigename 3000 Zeichen lang ist, eine Notübernahme gegen den Hub mit dem Grund „Hub ohne Verbindung“ bestätigt
- **THEN** führt der ELW, die Erklärung nennt die ersten 200 Zeichen des Namens als Unterzeichner, und der Hub nimmt die Akte bei der nächsten Meldung an

#### Scenario: Erklärung knapp unter der Grenze
- **WHEN** Grund und Unterzeichner so gewählt sind, dass die Erklärung genau 4096 Byte groß ist
- **THEN** gilt die Notübernahme, und die Akte geht mit der Erklärung an das Gegenüber

#### Scenario: Erklärung knapp über der Grenze
- **WHEN** Grund und Unterzeichner so gewählt sind, dass die Erklärung nach dem Kürzen des Unterzeichners 4097 Byte groß wäre
- **THEN** antwortet der Server mit 422 und nennt den Grund als das, was zu kürzen ist; die Führung bleibt, wo sie war, und der Verlauf bekommt keinen Eintrag

#### Scenario: Zu große Erklärung vor der Unterschrift
- **WHEN** ein Admin am Hub eine Notübernahme mit eigener Unterschrift beginnt und die Erklärung zu groß wäre
- **THEN** antwortet schon der Beginn mit 422, und es wird nichts zum Unterschreiben vorgelegt

#### Scenario: Zu große Erklärung mit Code
- **WHEN** jemand am Hub eine Notübernahme mit dem Code des Gegenübers erklärt und die Erklärung zu groß wäre
- **THEN** antwortet der Server mit 422, und die Führung bleibt beim ELW
