# Spec Delta

## ADDED Requirements

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
