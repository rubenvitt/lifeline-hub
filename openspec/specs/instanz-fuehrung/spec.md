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
Epoche vergeben, mit der die erreichte Seite selbst führt), und eine Akte, deren Erklärung nicht
die meldende Seite, sondern eine andere Instanz als bisherigen Führer eines anderen Stands nennt
als dessen, mit dem die meldende Seite führt: Die MUST die meldende Seite ohne Alarm offen halten,
bis die Einsatzleitung entscheidet. Eine Akte ohne Erklärung, mit unlesbarer Erklärung oder mit
einer Erklärung, die den Stand der meldenden Seite mit einem anderen bisherigen Führer nennt, fällt
nicht unter die Ausnahme.

#### Scenario: Gültige Unterschrift
- **WHEN** der ELW eine Erklärung des Hubs erhält, die Admin A mit einem am ELW gültigen Schlüssel unterschrieben hat
- **THEN** zeigt der ELW unter der Kopfleiste über die volle Breite „Führung übernommen von Hub Nord“ mit Zeit, „unterzeichnet von Admin A“ und dem Grund „ELW ohne Verbindung seit 40 min“, dazu „Übernahme bestätigen“ und „Widersprechen“, und schreibt weiter

#### Scenario: Schlüssel wartet auf Bestätigung
- **WHEN** die Unterschrift von einem Schlüssel stammt, der am ELW noch auf Bestätigung wartet
- **THEN** verwirft der ELW die Übernahme als ungültig

#### Scenario: Ungültige Übernahme
- **WHEN** der ELW eine Übernahme ohne gültige Unterschrift und ohne passenden Code erhält
- **THEN** führt der ELW weiter, löst die Benachrichtigung „Ungültige Übernahme der Führung“ an die Einsatzleitung aus und schreibt einen Eintrag in die Admin-Spur

#### Scenario: Übernahme ohne Erklärung
- **WHEN** der ELW führt und der Hub sich mit eigener, größerer Epoche als Führer meldet, ohne Erklärung
- **THEN** verwirft der ELW die Übernahme mit der Benachrichtigung „Ungültige Übernahme der Führung“ und führt mit der nächsten Epoche weiter

#### Scenario: Erklärung über den eigenen Stand mit anderem Führer
- **WHEN** der ELW mit Epoche (1, ELW) führt und der Hub eine unterschriebene Erklärung schickt, die (1, ELW) als bisherigen Stand und eine andere Instanz als bisherigen Führer nennt
- **THEN** verwirft der ELW die Übernahme mit der Benachrichtigung „Ungültige Übernahme der Führung“

#### Scenario: Hub holt sich die Führung per Notübernahme von ELW 1 zurück
- **WHEN** „ELW 2“ ohne Verbindung eine Notübernahme mit Epoche (2, ELW 2) gegen den Hub erklärt, am Hub „ELW 1“ mit (2, ELW 1) führt, der Hub per unterschriebener Notübernahme gegen „ELW 1“ mit (3, Hub) zurückholt und „ELW 2“ sich meldet
- **THEN** zeigt „ELW 2“ „Führung übernommen von Hub“ mit „Übernahme bestätigen“ und „Widersprechen“, ohne Grund und Unterzeichner der Erklärung gegen „ELW 1“, ohne Alarm „Ungültige Übernahme der Führung“ und ohne Eintrag in der Admin-Spur, und schreibt weiter

#### Scenario: Hub holt sich die Führung per Widerruf von ELW 1 zurück
- **WHEN** „ELW 2“ ohne Verbindung eine Notübernahme mit Epoche (2, ELW 2) gegen den Hub erklärt, am Hub „ELW 1“ mit (2, ELW 1) führt, der Admin am Hub die Org-Zuordnung von „ELW 1“ widerruft und „ELW 2“ sich meldet
- **THEN** zeigt „ELW 2“ „Führung übernommen von Hub“ mit „Übernahme bestätigen“ und „Widersprechen“, ohne Alarm „Ungültige Übernahme der Führung“ und ohne Eintrag in der Admin-Spur, und schreibt weiter

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

Endet bei eingeschaltetem Schalter die Org-Zuordnung einer Standardkopplung, hier oder beim Gegenüber,
SHALL diese Instanz jeden Einsatz der Org, den sie als Spiegel hält und dessen Akte das Gegenüber
als Führer nennt, mit der nächsten Epoche selbst und schreibbar führen; Bruchstelle ist der
Zeitpunkt, zu dem sie vom Widerruf erfährt. Die Akte MUST danach eine Erklärung ohne Beweis
tragen, die das Gegenüber als bisherigen Führer und „Kopplung widerrufen“ als Grund nennt, damit
andere meldende Seiten die Übernahme als gegen eine dritte Instanz gerichtet erkennen. Offene
Übernahmen dieses Gegenübers MUST verfallen.

#### Scenario: Widerruf am ELW
- **WHEN** der Hub einen Einsatz mit Epoche (3, Hub) führt, den der ELW spiegelt, und der Admin am ELW die Org-Zuordnung widerruft
- **THEN** führt der ELW ihn mit Epoche (4, ELW), das Hinweisband „Spiegel von Hub“ verschwindet, der Einsatz ist am ELW wieder schreibbar, und der Verlauf zeigt eine Notübernahme mit dem Grund „Kopplung widerrufen“ und dem Widerruf als Bruchstelle

#### Scenario: Offene Übernahme verfällt
- **WHEN** am ELW eine gültige Notübernahme des Hubs auf Bestätigung wartet und die Org-Zuordnung zum Hub widerrufen wird
- **THEN** verschwindet „Führung übernommen von …“, und der ELW führt weiter

#### Scenario: Ein dritter ELW sieht den Widerruf im Verlauf
- **WHEN** „ELW 1“ einen Einsatz führt, „ELW 2“ dessen Akte über den Hub kennt, ohne zu führen, und der Admin am Hub die Org-Zuordnung von „ELW 1“ widerruft
- **THEN** zeigt der Verlauf dieser Akte an „ELW 2“ nach der nächsten Meldung den Wechsel zum Hub mit dem Grund „Kopplung widerrufen“, ohne Unterzeichner

### Requirement: Einen Spiegel ohne gekoppelte Führung holt ein Mensch zurück

Nennt bei eingeschaltetem Schalter die Akte eines Spiegels eine Installation als Führer, über
deren inzwischen widerrufene Zuordnung einer Standardkopplung der Einsatz gespiegelt wurde, und
hat die Org keine geltende Zuordnung zu ihr, SHALL das Paneel „Führung“ „Führung zurückholen“ anbieten und das Hinweisband die beendete
Kopplung nennen. Bedienen SHALL, wer an dieser Instanz die Führung bedient, mit Grund, ohne
Unterschrift und ohne Code. Danach MUST diese Instanz den Einsatz mit der nächsten Epoche
schreibbar führen; die Akte MUST eine Erklärung ohne Beweis gegen die alte Führung mit dem Grund
tragen, Bruchstelle ist der Widerruf dieser Zuordnung, und Verlauf und Admin-Spur
MUST den Wechsel mit Bediener festhalten.

#### Scenario: Zurückholen nach Widerruf ohne Schalter
- **WHEN** der Hub einen Einsatz mit Epoche (3, Hub) führt, den der ELW spiegelt, der Schalter am ELW aus ist, die Org-Zuordnung zum Hub um 10:00 widerrufen wird, der Schalter wieder eingeschaltet wird und die Einsatzleitung am ELW um 11:30 „Führung zurückholen“ mit dem Grund „Hub abgebaut“ bestätigt
- **THEN** führt der ELW den Einsatz mit Epoche (4, ELW), das Hinweisband „Spiegel von Hub“ verschwindet, der Einsatz ist schreibbar, und der Verlauf zeigt eine Notübernahme von Hub mit dem Grund „Hub abgebaut“, dem Namen der Einsatzleitung und 10:00 als Bruchstelle

#### Scenario: Das Hinweisband nennt die beendete Kopplung
- **WHEN** die Einsatzleitung am ELW einen solchen Spiegel öffnet
- **THEN** zeigt das Hinweisband „Spiegel von Hub“ mit „Kopplung zu Hub beendet“ und „Führung zurückholen“, das zum Paneel „Führung“ führt

#### Scenario: Ohne Grund
- **WHEN** die Einsatzleitung „Führung zurückholen“ ohne Grund absendet
- **THEN** antwortet der Server mit 422 „Ein Grund ist Pflicht.“, und die Akte bleibt unverändert

#### Scenario: Führungspersonal
- **WHEN** ein Konto mit der Rolle Führungspersonal „Führung zurückholen“ auslöst
- **THEN** antwortet der Server mit 403

#### Scenario: Ein dritter ELW hält die Übernahme ohne Alarm offen
- **WHEN** am Hub ein Einsatz, den „ELW 1“ führt, nach Widerruf ohne Schalter zurückgeholt wird und „ELW 2“, der die Akte über den Hub kennt, sich meldet
- **THEN** sieht „ELW 2“ den Wechsel zum Hub ohne Alarm „Ungültige Übernahme der Führung“ und ohne Eintrag in seiner Admin-Spur

### Requirement: Ohne einen Menschen bleibt ein Spiegel ohne gekoppelte Führung Spiegel

Ein Spiegel, dessen Führung nicht mehr gekoppelt ist, MUST Spiegel bleiben, bis ein Mensch ihn
zurückholt, auch über Neustart und Einschalten des Schalters hinweg. Ist die führende Installation
noch gekoppelt oder kam der Spiegel nicht über eine widerrufene Standard-Zuordnung zu ihr, etwa
über einen Hub, MUST der Server das Zurückholen mit 409 ablehnen.

#### Scenario: Ohne Handlung bleibt der Spiegel
- **WHEN** nach Widerruf ohne Schalter die Führung wieder eingeschaltet wird und der ELW neu startet
- **THEN** bleibt der Einsatz Spiegel von Hub, und die Akte nennt weiter den Hub mit Epoche (3, Hub)

#### Scenario: Die Führung ist noch gekoppelt
- **WHEN** die Org-Zuordnung zum Hub gilt und jemand am ELW „Führung zurückholen“ aufruft
- **THEN** antwortet der Server mit 409, und das Paneel bietet dafür nur Anfrage und Notübernahme an

#### Scenario: Führer nie über eine Standardkopplung zugeordnet
- **WHEN** die Akte eine Installation als Führer nennt, mit der die Org nur über eine Direktkopplung vor Ort oder gar nicht gekoppelt war
- **THEN** bietet das Paneel „Führung zurückholen“ nicht an, und der Server antwortet auf den Aufruf mit 409

#### Scenario: Der Spiegel kommt über einen Hub
- **WHEN** „ELW 1“ einen Einsatz führt, den „ELW 2“ über den Hub kennt und spiegelt, und die Org an „ELW 2“ früher einmal über eine Standardkopplung mit „ELW 1“ gekoppelt war
- **THEN** bietet „ELW 2“ „Führung zurückholen“ nicht an, und der Server antwortet auf den Aufruf mit 409

### Requirement: Eine Akte ohne Spiegel endet mit dem Einsatz beim Gegenüber

Hält eine Instanz bei eingeschaltetem Schalter eine Führungsakte ohne lokalen Einsatz, SHALL sie
deren Kennung beim Abgleich dem Gegenüber nennen, das über ihr Ende entscheidet. Meldet
dieses Gegenüber den Einsatz als gelöscht, MUST die Instanz die Akte samt Verlauf löschen; sie
erscheint danach nicht mehr unter „Einsätze beim Gegenüber“. Ein Gegenüber, das die Nennung nicht
kennt, MUST weiter abgleichen können; die Akte bleibt dann stehen.

#### Scenario: Der Hub löscht einen nie gespiegelten Einsatz
- **WHEN** der Hub einen Einsatz führt, der beim Koppeln schon abgeschlossen war, der ELW ihn unter „Einsätze beim Gegenüber“ zeigt und der Hub ihn endgültig löscht
- **THEN** zeigt der ELW ihn nach dem nächsten Abgleich nicht mehr

#### Scenario: Der ELW löscht einen nie gespiegelten Einsatz
- **WHEN** der ELW einen Einsatz führt, der beim Koppeln schon abgeschlossen war, der Hub ihn unter „Einsätze beim Gegenüber“ zeigt und der ELW ihn endgültig löscht
- **THEN** zeigt der Hub ihn nach dem nächsten Abgleich nicht mehr

#### Scenario: Der Einsatz besteht weiter
- **WHEN** der ELW eine Akte ohne Spiegel nennt und der Hub den Einsatz noch hält
- **THEN** bleibt die Akte am ELW stehen

#### Scenario: Kennung außerhalb der Grenzen
- **WHEN** eine Akte ohne Spiegel eine Kennung über 200 Byte oder mit anderen Zeichen als druckbarem ASCII trägt
- **THEN** nennt die Instanz sie nicht, und der Abgleich läuft ungestört weiter

#### Scenario: Älteres Gegenüber
- **WHEN** das Gegenüber die Nennung von Akten ohne Spiegel nicht kennt
- **THEN** läuft der Abgleich wie bisher, und die Akte bleibt stehen

#### Scenario: Schalter aus
- **WHEN** die Führung je Einsatz an einer Instanz ausgeschaltet ist
- **THEN** nennt sie im Abgleich keine Akten und löscht keine auf die Meldung eines Gegenübers hin

### Requirement: Gelöscht meldet eine Instanz nur mit Beleg

Eine Instanz MUST eine genannte Kennung nur dann als gelöscht melden, wenn sie das Ende des
Einsatzes festgehalten hat und weder einen Einsatz noch eine Akte mit dieser Kennung hält. Den
Beleg SHALL sie festhalten, wenn sie einen Einsatz mit Kennung endgültig löscht oder zur
Verwahrung abgibt und wenn sie eine Akte auf eine solche Meldung hin löscht. Eine Kennung, die
sie nicht kennt, MUST sie übergehen.

#### Scenario: Rückkehr aus einer Sicherung
- **WHEN** der Hub aus einer Sicherung zurückkehrt, die einen Einsatz noch nicht kannte, und der ELW dessen Akte ohne Spiegel nennt
- **THEN** meldet der Hub nichts, und die Akte bleibt am ELW stehen

#### Scenario: Verwahrter Einsatz mit der Kennung des ELW
- **WHEN** der Hub einen zur Verwahrung übernommenen Einsatz des ELW 1 endgültig löscht und ELW 2 dessen Akte ohne Spiegel nennt
- **THEN** meldet der Hub ihn als gelöscht, obwohl die Kennung mit der des ELW 1 beginnt

#### Scenario: Die Akte kommt wieder
- **WHEN** eine Instanz das Ende einer Kennung festgehalten hat und danach wieder eine Akte mit dieser Kennung bekommt
- **THEN** meldet sie die Kennung nicht als gelöscht, solange sie die Akte hält

#### Scenario: Spiegel nach der Nachbereitung abgeräumt
- **WHEN** der ELW den Spiegel eines Einsatzes nach der Nachbereitung abräumt, den der Hub weiter hält
- **THEN** hält der ELW kein Ende fest und meldet den Einsatz niemandem als gelöscht

#### Scenario: Einsatz einer anderen Organisation
- **WHEN** ein Gegenüber eine Kennung nennt, deren Einsatz hier gelöscht wurde, aber zu einer Org gehörte, die dieser Kopplung nicht zugeordnet ist
- **THEN** meldet die Instanz nichts

### Requirement: Die erreichte Seite löscht eine Akte nur auf Meldung ihres Führers

Die erreichte Seite MUST die Meldung einer meldenden Seite, ein Einsatz sei gelöscht, nur für
eine Akte ohne Spiegel annehmen, die diese meldende Seite als Führer nennt, und SHALL ihr nur
solche Akten nennen. Die meldende Seite SHALL die Meldung ihrer einzigen erreichten Seite auch
für Akten annehmen, die eine dritte Instanz führt, sofern die Org der Akte dieser Kopplung
zugeordnet ist.

#### Scenario: Ein ELW meldet den Einsatz eines anderen
- **WHEN** der Hub eine Akte ohne Spiegel hält, die „ELW 1“ als Führer nennt, und „ELW 2“ deren Kennung als gelöscht meldet
- **THEN** bleibt die Akte am Hub stehen

#### Scenario: Org einer anderen Kopplung
- **WHEN** ein Gegenüber eine Kennung als gelöscht meldet, deren Akte zu einer Org gehört, die dieser Kopplung nicht zugeordnet ist
- **THEN** bleibt die Akte stehen

### Requirement: An mehreren erreichten Seiten entscheidet nur der Führer der Akte

Erreicht eine meldende Seite den Einsatz einer Akte auf mehr als einem Weg, weil ihre Org an
mehr als einer erreichten Seite hängt oder weil der Führer der Akte selbst ihr Gegenüber ist,
MUST sie die Meldung, der Einsatz sei gelöscht, nur vom Führer der Akte annehmen und SHALL die
Akte nur ihm nennen. Akten, die eine dritte Instanz führt, bleiben an zwei erreichten Seiten
stehen.

#### Scenario: ELW an zwei Hubs
- **WHEN** die Org eines ELW an „Hub A“ und „Hub B“ hängt, der ELW die Akte eines Einsatzes hält, den eine andere ELW führt, und „Hub B“ ihn als gelöscht meldet
- **THEN** bleibt die Akte am ELW stehen

#### Scenario: Der Führer ist selbst gekoppelt
- **WHEN** eine Instanz sich bei „Hub A“ meldet, zugleich von „ELW X“ erreicht wird, die Akte eines Einsatzes hält, den „ELW X“ führt, und „Hub A“ ihn als gelöscht meldet
- **THEN** bleibt die Akte stehen, bis „ELW X“ selbst den Einsatz als gelöscht meldet

#### Scenario: Der Hub löscht seinen eigenen Einsatz
- **WHEN** die Org eines ELW an „Hub A“ und „Hub B“ hängt und „Hub B“ einen Einsatz endgültig löscht, den er selbst führte und den der ELW nur als Akte kennt
- **THEN** zeigt der ELW ihn nach dem nächsten Abgleich mit „Hub B“ nicht mehr

### Requirement: Die erreichte Seite reicht das Ende eines Einsatzes weiter

Löscht die erreichte Seite eine Akte, weil ihr Führer den Einsatz als gelöscht meldet, oder räumt
sie deshalb ihren Spiegel ab, MUST sie den Einsatz danach jeder weiteren meldenden Seite derselben
Org als gelöscht melden, die seine Akte ohne Spiegel nennt.

#### Scenario: Zwei ELW an einem Hub
- **WHEN** „ELW 1“ einen Einsatz führt, den „ELW 2“ nur als Akte über den Hub kennt, und „ELW 1“ ihn endgültig löscht
- **THEN** zeigt nach dem Abgleich von „ELW 1“ der Hub und nach dem folgenden Abgleich von „ELW 2“ auch „ELW 2“ den Einsatz nicht mehr unter „Einsätze beim Gegenüber“

### Requirement: Widerruf entfernt die Akten ohne Spiegel des Gegenübers

Endet bei eingeschaltetem Schalter die Org-Zuordnung einer Kopplung, hier oder beim Gegenüber,
SHALL die Instanz jede Akte ohne Spiegel dieser Org löschen, die das widerrufene Gegenüber als
Führer nennt, und ihr Ende festhalten. Akten, die eine andere Instanz als Führer nennen, MUST sie
behalten. Nach einer neuen Zuordnung zeigt sie die Akten wieder, die das Gegenüber ihr dann
übergibt. Bei ausgeschaltetem Schalter MUST der Widerruf die Akten stehen lassen.

#### Scenario: Ein ELW von zweien wird widerrufen
- **WHEN** eine Org am Hub „ELW 1“ und „ELW 2“ zugeordnet ist, der Hub Akten ohne Spiegel beider hält und der Admin die Zuordnung zu „ELW 1“ widerruft
- **THEN** zeigt der Hub unter „Einsätze beim Gegenüber“ nur noch die Einsätze von „ELW 2“, und „ELW 2“ zeigt die Einsätze von „ELW 1“ nach seinem nächsten Abgleich nicht mehr

#### Scenario: Neue Zuordnung
- **WHEN** die widerrufene Zuordnung zu „ELW 1“ neu angelegt wird und „ELW 1“ sich meldet
- **THEN** zeigt der Hub die Einsätze von „ELW 1“ wieder

#### Scenario: Widerruf bei ausgeschaltetem Schalter
- **WHEN** die Führung je Einsatz am Hub ausgeschaltet ist und der Admin die Zuordnung zu „ELW 1“ widerruft
- **THEN** bleiben die Akten ohne Spiegel von „ELW 1“ am Hub stehen, und der Hub meldet sie niemandem als gelöscht

### Requirement: Der Austausch übersteht das Zurückspielen einer Sicherung

Nach dem Zurückspielen einer gekoppelten Instanz aus einer Sicherung SHALL der Austausch der
Führungsakten ohne Eingriff weiterlaufen: Jede danach geänderte Akte MUST das Gegenüber mit den
nächsten Meldungen erreichen, auch bei mehreren Kopplungen. Ausgenommen ist eine zurückgespielte
Seite mit nachgehender Uhr, die vor ihrer ersten Meldung mehr Stände vergibt, als verloren gingen,
oder deren Gegenstellen verschieden weit quittiert hatten.

#### Scenario: Hub zurückgespielt, neuer Einsatz am Hub
- **WHEN** der Hub aus einer Sicherung von gestern zurückgespielt wird, danach am Hub ein Einsatz der gekoppelten Org angelegt wird und der ELW sich meldet
- **THEN** zeigt der ELW unter „Einsätze beim Gegenüber“ diesen Einsatz mit „Führung: Hub · Epoche 1“

#### Scenario: ELW zurückgespielt, neuer Einsatz am ELW
- **WHEN** der ELW aus einer Sicherung zurückgespielt wird, danach am ELW ein Einsatz der gekoppelten Org angelegt wird und der ELW sich meldet
- **THEN** zeigt der Hub diesen Einsatz mit „Führung: ELW · Epoche 1“, und ein danach am Hub angelegter Einsatz erreicht den ELW mit der nächsten Meldung

#### Scenario: Zurückgespielte Seite mit nachgehender Uhr
- **WHEN** der Hub zurückgespielt wird, seine Uhr hinter dem Zeitpunkt der verlorenen Stände steht und am Hub ein Einsatz angelegt wird, bevor der ELW sich meldet
- **THEN** erreicht dieser Einsatz den ELW mit der nächsten Meldung, und die Seite „Instanzkopplung“ am Hub zeigt den Hinweis, dass die Akten erneut gehen

#### Scenario: Zwei Kopplungen am zurückgespielten Hub
- **WHEN** ein Hub mit „ELW 1“ und „ELW 2“ mit nachgehender Uhr zurückgespielt wird, beide gleich weit quittiert hatten, am Hub ein Einsatz einer Org angelegt wird, die nur „ELW 2“ zugeordnet ist, und „ELW 1“ sich zuerst meldet
- **THEN** erreicht der Einsatz „ELW 2“ mit dessen nächster Meldung

### Requirement: Verlorene Führungsakten kommen erneut

Akten, die eine zurückgespielte erreichte Seite mit der Sicherung verloren hat und die die meldende
Seite noch kennt, SHALL die meldende Seite ihr mit den nächsten Meldungen erneut übergeben, auch wenn
sie während des Ausfalls weitere Akten geändert hat. Ausgenommen sind eine Sicherung von vor der
ersten Übernahme der erreichten Seite und eine Gegenstelle älteren Stands. Das Protokoll der Meldung
MUST dafür nur additiv wachsen.

#### Scenario: Hub zurückgespielt, Akte des ELW ging verloren
- **WHEN** der ELW nach der Sicherung des Hubs einen Einsatz angelegt und gemeldet hat, der Hub dann aus dieser Sicherung zurückgespielt wird und der ELW sich wieder meldet
- **THEN** zeigt der Hub diesen Einsatz des ELW nach den nächsten Meldungen wieder unter „Einsätze beim Gegenüber“

#### Scenario: ELW hat während des Ausfalls geändert
- **WHEN** der Hub zurückgespielt wird und der ELW in dieser Zeit einen weiteren Einsatz anlegt, sodass schon seine erste Meldung danach eine neue Akte trägt
- **THEN** zeigt der Hub nach den nächsten Meldungen sowohl den neuen Einsatz als auch den verlorenen

#### Scenario: Antwort auf die erste Meldung geht verloren
- **WHEN** der Hub zurückgespielt wird, der ELW in dieser Zeit einen weiteren Einsatz anlegt und die Antwort auf seine erste Meldung danach ihn nicht erreicht
- **THEN** zeigt der Hub nach den nächsten Meldungen trotzdem den verlorenen Einsatz wieder

### Requirement: Über eine Direktkopplung wechselt die Führung nicht

Eine Instanz MUST die Führung eines Einsatzes nicht an die Gegenstelle einer Direktkopplung
übergeben, nicht bei ihr anfragen, nicht gegen sie notübernehmen und keinen Abgabecode für sie
erzeugen. Die Oberfläche MUST diese Bedienungen für eine solche Gegenstelle nicht anbieten und
den Grund zeigen; ein direkter Aufruf MUST mit 409 enden. Die Akten MUST weiter ausgetauscht und
angezeigt werden.

#### Scenario: Übergabe an ELW vor Ort
- **WHEN** die Einsatzleitung an ELW 1 im Paneel „Führung“ das Ziel für eine Übergabe wählt und ELW 2 nur über eine Direktkopplung gekoppelt ist
- **THEN** fehlt ELW 2 in der Auswahl, und das Paneel zeigt „ELW 2 ist vor Ort gekoppelt: Führungswechsel dorthin kommt später“

#### Scenario: Notübernahme per Route
- **WHEN** ein Admin an ELW 2 die Route der Notübernahme für einen Einsatz aufruft, den ELW 1 führt und den ELW 2 nur über die Direktkopplung kennt
- **THEN** antwortet der Server mit 409, und die Führung bleibt bei ELW 1

#### Scenario: Einsätze beim Gegenüber
- **WHEN** ELW 1 einen Einsatz der zugeordneten Org führt und ELW 2 sich als Direktkopplung meldet
- **THEN** zeigt ELW 2 unter „Einsätze beim Gegenüber“ den Einsatz mit „Führung: ELW 1“

#### Scenario: Widerruf einer Direktkopplung
- **WHEN** ELW 1 einen Einsatz führt, den ELW 2 über die Direktkopplung spiegelt, und der Admin an ELW 2 die Org-Zuordnung widerruft
- **THEN** holt ELW 2 die Führung nicht zurück: die Akte nennt weiter ELW 1, und der Spiegel bleibt lesbar stehen (die Anforderung „Widerruf holt die Führung zurück“ gilt nur für Standardkopplungen)

### Requirement: Eine Direktkopplung nimmt keinen Führungswechsel zwischen ihren Seiten an

Erhält eine Instanz über eine Direktkopplung eine Akte, die die Führung von der einen Seite dieser
Kopplung auf die andere legt, MUST sie die Akte verwerfen, gleich in welcher Richtung die
Kopplung läuft, weiter nach ihrer bisherigen Akte verfahren und an der Kopplung einen Hinweis
zeigen.

#### Scenario: Gegenstelle beansprucht die Führung
- **WHEN** ELW 1 einen Einsatz führt und ELW 2 über die Direktkopplung eine Akte mit höherer Epoche und sich als Führer meldet
- **THEN** führt ELW 1 weiter, und die Kopplung an ELW 1 zeigt „ELW 2 beansprucht die Führung von „<Einsatz>“ über eine Direktkopplung: abgelehnt“

### Requirement: Eine Abgabe des Führers an eine dritte Instanz gilt auch vor Ort

Erhält eine Instanz über eine Direktkopplung von der Gegenstelle, die einen Einsatz bisher
führte, eine Akte mit höherer Epoche, die eine dritte Instanz als Führer nennt, SHALL sie diese
Akte annehmen, gleich in welcher Richtung die Kopplung läuft. Ihr Spiegel MUST danach der neuen
führenden Instanz folgen oder, wenn diese hier nicht gekoppelt ist, als „Abgleich beendet“
stehen bleiben.

#### Scenario: ELW übergibt an den Hub
- **WHEN** ELW 1 einen Einsatz an den Hub übergibt und ELW 2 diesen Einsatz über die Direktkopplung von ELW 1 spiegelt und selbst beim Hub gekoppelt ist
- **THEN** zeigt ELW 2 „Führung: Hub“ und spiegelt den Einsatz danach vom Hub

#### Scenario: Neuer Führer hier nicht gekoppelt
- **WHEN** ELW 1 einen Einsatz an den Hub übergibt und ELW 2 nur mit ELW 1 gekoppelt ist
- **THEN** zeigt ELW 2 „Führung: Hub“ und den Spiegel mit „Die führende Instanz ist hier nicht gekoppelt.“

### Requirement: Verwahrung nur über eine Standardkopplung

Eine Instanz MUST einen abgeschlossenen Einsatz nur über eine Standardkopplung zur Verwahrung
anbieten. Über eine Direktkopplung MUST keine Verwahrung angeboten oder angenommen werden.

#### Scenario: Nachbereitung abgelaufen, ELW mit Hub und vor Ort
- **WHEN** die Nachbereitungsfrist eines Einsatzes an ELW 2 abläuft und ELW 2 beim Hub und als Direktkopplung bei ELW 1 gekoppelt ist
- **THEN** bietet ELW 2 den Einsatz nur dem Hub zur Verwahrung an

#### Scenario: Nur vor Ort gekoppelt
- **WHEN** die Nachbereitungsfrist eines Einsatzes an ELW 2 abläuft und ELW 2 nur als Direktkopplung bei ELW 1 gekoppelt ist
- **THEN** bietet ELW 2 den Einsatz niemandem zur Verwahrung an, und ELW 1 macht aus seinem Spiegel keinen eigenen Einsatz

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
