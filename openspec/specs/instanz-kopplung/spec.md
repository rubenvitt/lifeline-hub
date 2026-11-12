# instanz-kopplung Specification

## Purpose
Zwei Lifeline-Hub-Instanzen (etwa ein ELW und ein öffentlicher Hub) erkennen einander über je ein
Schlüsselpaar, koppeln sich per Einmal-Code eines Org-Admins und sprechen nur noch über
signierte, nicht wiederholbare Nachrichten miteinander; jede Seite kann die Kopplung widerrufen.

## Requirements

### Requirement: Jede Instanz hat eine dauerhafte Identität

Der Server SHALL beim ersten Start eine Instanzkennung und ein Ed25519-Schlüsselpaar erzeugen und
in der Datenbank speichern. Jeder weitere Start MUST dieselbe Identität verwenden, auch nach einer
Wiederherstellung aus der Sicherung. Der private Schlüssel MUST NOT über eine Route oder in einem
Log erscheinen.

#### Scenario: Erster und zweiter Start
- **WHEN** der Server auf einer leeren Datenbank startet und danach neu startet
- **THEN** zeigt die Admin-Seite „Instanzkopplung“ nach beiden Starts dieselbe Kennung und denselben Fingerabdruck

#### Scenario: Wiederherstellung
- **WHEN** eine Sicherung auf einem anderen Rechner wiederhergestellt wird
- **THEN** trägt die Instanz dort dieselbe Kennung und denselben Schlüssel

### Requirement: Nur ein Org-Admin mit Unterschriftsschlüssel stellt einen Kopplungscode aus

Das System SHALL einen Kopplungscode nur einem Admin ausstellen, und nur für dessen eigene Org.
Der Admin MUST einen eigenen gültigen Unterschriftsschlüssel haben (Fähigkeit
`org-admin-unterschrift`), damit die gekoppelte Instanz mindestens einen Admin-Schlüssel der Org
kennt.

#### Scenario: Admin ohne Unterschriftsschlüssel
- **WHEN** ein Admin ohne registrierten Unterschriftsschlüssel einen Kopplungscode anfordert
- **THEN** antwortet der Server mit 409 und dem Hinweis, zuerst einen Unterschriftsschlüssel zu registrieren

#### Scenario: Nicht-Admin
- **WHEN** ein Konto ohne Admin-Rolle einen Kopplungscode anfordert
- **THEN** antwortet der Server mit 403

### Requirement: Kopplungscode ist kurzlebig und einmalig

Der Kopplungscode SHALL aus 16 Zeichen Crockford-Base32 bestehen, 15 Minuten gelten und genau
einmal eingelöst werden können. Der Server MUST den Code nur abgeleitet speichern, nicht im
Klartext. Fehlversuche beim Einlösen MUST die IP-Sperre der Anmeldung auslösen.

#### Scenario: Abgelaufener Code
- **WHEN** ein ELW einen Code 16 Minuten nach dem Ausstellen einlöst
- **THEN** scheitert das Einlösen mit derselben Antwort wie bei einem falschen Code

#### Scenario: Zweites Einlösen
- **WHEN** derselbe Code ein zweites Mal eingelöst wird
- **THEN** scheitert das Einlösen, und es entsteht keine weitere Kopplung

#### Scenario: Durchprobieren
- **WHEN** von derselben Quelle zehn falsche Codes in fünf Minuten kommen
- **THEN** antwortet der Server auf weitere Versuche dieser Quelle mit 429

### Requirement: Der Code bindet die Schlüssel beider Seiten

Beim Einlösen MUST jede Seite ihren öffentlichen Schlüssel mit einem aus dem Code abgeleiteten
Prüfwert versehen, und jede Seite MUST den Prüfwert des Gegenübers prüfen, bevor sie dessen
Schlüssel speichert. Der Code selbst MUST NOT über die Leitung gehen.

#### Scenario: Angreifer in der Mitte tauscht den Schlüssel der einlösenden Seite
- **WHEN** eine Stelle zwischen ELW und Hub in der Anfrage den öffentlichen Schlüssel des ELW austauscht
- **THEN** lehnt der Hub das Einlösen ab, und keine Seite speichert eine Kopplung

#### Scenario: Angreifer in der Mitte tauscht den Schlüssel der ausstellenden Seite
- **WHEN** eine Stelle zwischen ELW und Hub in der Antwort den öffentlichen Schlüssel des Hubs austauscht
- **THEN** lehnt der ELW die Antwort ab und speichert keine Kopplung
- **AND** verwirft der Hub seine angebahnte Kopplung, weil die erste Meldung binnen 15 Minuten ausbleibt

### Requirement: Eine Kopplung je Instanzpaar, Orgs einzeln

Zwischen zwei Instanzen SHALL es höchstens eine Kopplung geben. Jeder eingelöste Code MUST genau
die Org des ausstellenden Admins an genau die Org des einlösenden Admins binden. Ein weiterer
Code für dieselbe Gegenstelle MUST die bestehende Kopplung um diese Org-Zuordnung erweitern.

#### Scenario: Zweite Org
- **WHEN** ein ELW für die Org „DRK KV Nord“ gekoppelt ist und ein Admin der lokalen Org „DRK Süd“ am selben ELW einen Code der Hub-Org „DRK KV Süd“ einlöst
- **THEN** zeigen beide Seiten eine Kopplung mit zwei Org-Zuordnungen

#### Scenario: Zuordnung folgt dem einlösenden Admin
- **WHEN** ein Admin der lokalen Org „DRK Nord“ einen Code der Hub-Org „DRK KV Nord“ einlöst
- **THEN** ist die Hub-Org „DRK KV Nord“ an die lokale Org „DRK Nord“ gebunden und an keine andere

### Requirement: Die Kopplung kennt Richtung, nicht Hub und ELW

Eine Kopplung SHALL festhalten, welche Seite sich meldet (die einlösende) und welche erreicht
wird (die ausstellende, mit ihrer Adresse). Das System MUST NOT zwischen Hub und ELW
unterscheiden; jede Instanz kann ausstellen und einlösen.

#### Scenario: ELW stellt aus
- **WHEN** ein zweiter ELW einen Code einlöst, den ein erster ELW ausgestellt hat
- **THEN** entsteht eine Kopplung, in der sich der zweite beim ersten meldet

### Requirement: Jede Nachricht zwischen gekoppelten Instanzen ist signiert

Jede Anfrage SHALL ein Token tragen, das der Absender mit seinem Instanzschlüssel signiert und
das Absender, Empfänger, Methode, Pfad, Hash des Bodys, Protokollversion und eine einmalige
Kennung bindet und höchstens 60 Sekunden gilt. Jede Antwort MUST ebenso signiert sein. Der
Empfänger MUST eine Nachricht ablehnen, deren Signatur, Ziel, Body-Hash oder Zeit nicht passt
oder deren Kennung er schon gesehen hat.

#### Scenario: Wiederholte Anfrage
- **WHEN** ein Dritter eine abgefangene, gültige Meldung zehn Sekunden später erneut schickt
- **THEN** antwortet der Empfänger mit 401 und ändert nichts

#### Scenario: Veränderter Body
- **WHEN** ein Byte im Body einer signierten Anfrage verändert wird
- **THEN** antwortet der Empfänger mit 401

#### Scenario: Unsignierte Antwort
- **WHEN** die meldende Instanz eine Antwort ohne gültige Signatur des Gegenübers erhält
- **THEN** verwirft sie die Antwort und zeigt die Kopplung als „Antwort ungültig“

### Requirement: Die meldende Instanz meldet sich regelmäßig

Die meldende Seite SHALL sich in festen Abständen und nach jedem Start signiert beim Gegenüber
melden. Beide Seiten MUST je Kopplung „zuletzt gesehen“, Softwarestand und Protokollversion des
Gegenübers anzeigen. Die erreichte Seite MUST NOT selbst eine Verbindung zur meldenden aufbauen.

#### Scenario: Netz weg und wieder da
- **WHEN** der ELW zwei Stunden kein Netz hat und es dann wiederbekommt
- **THEN** zeigt der Hub währenddessen „zuletzt gesehen vor …“ und nach der nächsten Meldung wieder den aktuellen Zeitpunkt

### Requirement: Protokollversionen N und N−1

Jede Instanz SHALL ihre Protokollversion und die vorige verstehen. Liegt das Gegenüber weiter
auseinander, MUST die Kopplung bestehen bleiben, aber nur Melden und Status zulassen, und beide
Seiten MUST „Update nötig“ mit der Seite anzeigen, die veraltet ist.

#### Scenario: Ein Stand zurück
- **WHEN** der Hub Protokoll 3 spricht und der ELW Protokoll 2
- **THEN** arbeiten beide normal

#### Scenario: Zwei Stände zurück
- **WHEN** der Hub Protokoll 3 spricht und der ELW Protokoll 1
- **THEN** nimmt der Hub die Meldung an, lehnt andere Anfragen mit 426 ab, und beide Seiten zeigen „Update nötig: ELW“

### Requirement: Widerruf an beiden Seiten

Ein Admin SHALL an jeder Seite die Zuordnung seiner Org aus einer Kopplung entfernen können; ohne
Org-Zuordnung gilt die Kopplung als widerrufen. Ab dem Widerruf MUST die Seite Nachrichten des
Gegenübers für diese Org ablehnen. Das Gegenüber MUST den Widerruf bei der nächsten Meldung als
signierte Mitteilung erhalten und anzeigen.

#### Scenario: Hub widerruft
- **WHEN** der Org-Admin am Hub die Kopplung mit einem ELW widerruft und der ELW sich danach meldet
- **THEN** erhält der ELW eine signierte Mitteilung, zeigt „vom Gegenüber widerrufen“ und meldet sich nicht weiter

#### Scenario: ELW widerruft ohne Netz
- **WHEN** der Admin am ELW ohne Netz widerruft
- **THEN** ist die Kopplung am ELW sofort widerrufen, und der Hub sieht keine Meldungen mehr

#### Scenario: Widerruf wird nachgestellt, bis er zugestellt ist
- **WHEN** die letzte Meldung beim Widerruf am ELW scheitert und das Netz später zurückkommt
- **THEN** stellt der ELW den Widerruf mit der nächsten fälligen Meldung zu, die nur noch den Widerruf trägt, der Hub zeigt „vom Gegenüber widerrufen“, und erst nach der signierten Antwort stellt der ELW das Melden ein

### Requirement: Kopplungsaktionen landen in der Admin-Spur

Ausstellen eines Codes, Einlösen, Hinzufügen einer Org und Widerruf SHALL je einen Eintrag in der
Admin-Spur der handelnden Org schreiben, mit Gegenstelle (Kennung, Fingerabdruck, Adresse) und
Quell-IP.

#### Scenario: Spur nach dem Koppeln
- **WHEN** ein ELW einen Code einlöst
- **THEN** zeigt die Admin-Spur am Hub „Kopplungscode eingelöst“ mit Kennung und Fingerabdruck des ELW und am ELW „Instanz gekoppelt“ mit denen des Hubs

### Requirement: Ungekoppelte Instanzen bleiben unverändert

Eine Instanz ohne Kopplung MUST NOT selbst eine Verbindung zu einer anderen Instanz aufbauen.

#### Scenario: Instanz ohne Kopplung
- **WHEN** eine Instanz ohne Kopplung einen Tag läuft
- **THEN** baut sie keine Verbindung zu einer anderen Instanz auf

### Requirement: Eine Kopplung hat eine Art

Jede Kopplung SHALL eine Art tragen: `standard` oder `vor_ort` (Direktkopplung vor Ort). Die Art
MUST der Admin beim Ausstellen des Codes wählen, Vorgabe `standard`, und beide Seiten MUST sie
beim Einlösen speichern und je Kopplung anzeigen. Die Art beschreibt die Kopplung, nicht die
Instanz: Eine Instanz SHALL Kopplungen beider Arten zugleich halten können. Bestehende
Kopplungen MUST als `standard` gelten.

#### Scenario: Direktkopplung zweier ELW
- **WHEN** der Admin an ELW 1 einen Code mit „Direktkopplung vor Ort“ ausstellt und der Admin an ELW 2 ihn einlöst
- **THEN** zeigen beide Seiten die Kopplung mit dem Chip „vor Ort“

#### Scenario: ELW am Hub und vor Ort
- **WHEN** ELW 2 sich als Standardkopplung beim Hub meldet und zusätzlich als Direktkopplung bei ELW 1
- **THEN** zeigt ELW 2 beide Kopplungen, die eine mit „vor Ort“, die andere ohne

### Requirement: Eine weitere Org übernimmt die Art der Kopplung

Ein weiterer Code für dieselbe Gegenstelle MUST dieselbe Art haben wie die bestehende Kopplung.
Weicht sie ab, MUST das Einlösen mit 409 und dem Hinweis scheitern, dass die Kopplung zu dieser
Gegenstelle schon als andere Art besteht.

#### Scenario: Art passt nicht
- **WHEN** ELW 2 mit ELW 1 als Direktkopplung gekoppelt ist und ein Admin an ELW 2 einen Standardcode von ELW 1 einlöst
- **THEN** antwortet der Server mit 409, und die Kopplung bleibt unverändert

### Requirement: Eine Direktkopplung verlangt Protokoll 3

Eine Direktkopplung SHALL nur zwischen Instanzen entstehen, die beide Protokoll 3 oder neuer
sprechen. Löst eine Instanz mit älterem Protokoll einen Code der Art `vor_ort` ein, MUST die
ausstellende Seite mit 426 ablehnen und den Code dabei nicht verbrauchen; keine Seite speichert
eine Kopplung.

#### Scenario: Einlösende Seite zu alt
- **WHEN** ELW 2 mit Protokoll 2 einen Code der Art „vor Ort“ von ELW 1 mit Protokoll 3 einlöst
- **THEN** antwortet ELW 1 mit 426, es entsteht keine Kopplung, und der Code bleibt bis zu seinem Ablauf einlösbar

### Requirement: Das Zertifikat einer Direktkopplung beglaubigt die Gegenstelle

Auf einer Direktkopplung SHALL das TLS-Zertifikat der erreichten Seite nicht vom Vertrauen des
Betriebssystems abhängen, sondern von einer Aussage, die die erreichte Seite mit ihrem
Instanzschlüssel signiert und die den Fingerabdruck ihres Zertifikats nennt. Die meldende Seite
MUST Nutzdaten nur über eine Verbindung senden, deren Zertifikat zu einer solchen Aussage passt.

#### Scenario: Selbstsigniertes Zertifikat
- **WHEN** ELW 1 mit einem selbst erzeugten Zertifikat läuft, dem ELW 2 nicht vertraut, und ELW 2 einen Code der Art „vor Ort“ einlöst
- **THEN** entsteht die Kopplung, und beide Seiten zeigen „Zertifikat bestätigt“

#### Scenario: Ausstellen ohne eigenes TLS
- **WHEN** ein Admin an einer Instanz ohne `--tls` einen Code der Art „vor Ort“ anfordert
- **THEN** antwortet der Server mit 409 und dem Hinweis, dass eine Direktkopplung `--tls` braucht

### Requirement: Beim Koppeln prüft die einlösende Seite das Zertifikat

Die Antwort auf das Einlösen eines Codes der Art `vor_ort` MUST den Fingerabdruck des
Zertifikats der ausstellenden Seite tragen. Die einlösende Seite MUST ihn mit dem Zertifikat der
Verbindung vergleichen, über die die Antwort kam, und ihn erst danach speichern. Passt er nicht,
MUST sie keine Kopplung speichern.

#### Scenario: Angreifer in der Mitte mit eigenem Zertifikat
- **WHEN** eine Stelle zwischen ELW 2 und ELW 1 die TLS-Verbindung mit eigenem Zertifikat aufbricht und die Nachrichten unverändert weiterreicht
- **THEN** lehnt ELW 2 die Antwort ab, speichert keine Kopplung, und ELW 1 verwirft die angebahnte Kopplung nach 15 Minuten

### Requirement: Ein neues Zertifikat wird vor den Nutzdaten bestätigt

Zeigt die erreichte Seite einer Direktkopplung ein anderes Zertifikat als das gespeicherte,
SHALL die meldende Seite zuerst eine signierte Aussage ohne Nutzdaten einholen. Nennt sie das
gezeigte Zertifikat, MUST die meldende Seite es speichern, weiterarbeiten und den Wechsel in die
Admin-Spur schreiben. Sonst MUST sie nichts senden und die Kopplung als „Zertifikat passt nicht“
zeigen.

#### Scenario: Neues Zertifikat nach IP-Wechsel
- **WHEN** ELW 1 nach einem IP-Wechsel ein neues Zertifikat erzeugt hat und ELW 2 sich meldet
- **THEN** meldet sich ELW 2 nach der signierten Bestätigung normal, und die Admin-Spur an ELW 2 zeigt „Zertifikat der Gegenstelle gewechselt“

#### Scenario: Fremdes Zertifikat
- **WHEN** unter der Adresse von ELW 1 ein Gerät antwortet, das keine von ELW 1 signierte Aussage über sein Zertifikat liefern kann
- **THEN** sendet ELW 2 weder Meldung noch Abgleich dorthin und zeigt „Zertifikat passt nicht“

### Requirement: Standardkopplungen prüfen das Zertifikat wie bisher

Eine Kopplung der Art `standard` MUST das Zertifikat der erreichten Seite weiter über das
Vertrauen des Betriebssystems prüfen; die Adresse MUST mit `https://` beginnen, außer für
Loopback.

#### Scenario: Hub mit öffentlichem Zertifikat
- **WHEN** ein ELW einen Standardcode eines Hubs mit öffentlich vertrautem Zertifikat einlöst
- **THEN** entsteht die Kopplung ohne gespeicherten Fingerabdruck, wie bisher
