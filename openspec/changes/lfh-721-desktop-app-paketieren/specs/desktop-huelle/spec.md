# Spec Delta

## ADDED Requirements

### Requirement: Ohne gespeicherte Serveradresse erscheint die Erststart-Maske
Hat die Hülle keine gültige Serveradresse gespeichert, MUST sie beim Start eine lokale Maske
zeigen, in der die Adresse eingegeben wird. Nach „Verbinden“ mit einer gültigen Adresse MUST die
Hülle die Adresse dauerhaft speichern und die Anwendung von dort laden. Bei jedem weiteren Start
MUST sie die gespeicherte Adresse ohne Maske laden.

#### Scenario: Erster Start
- **WHEN** die Hülle zum ersten Mal startet
- **THEN** zeigt sie die Erststart-Maske und lädt keine Serverseite

#### Scenario: Zweiter Start
- **WHEN** jemand beim ersten Start `https://elw.local:8443` verbunden hat und die Hülle neu startet
- **THEN** lädt die Hülle `https://elw.local:8443` ohne Maske

#### Scenario: Adresse ohne Hostname
- **WHEN** jemand `https://` oder `https:///einsatz` eingibt
- **THEN** bleibt die Maske stehen und nennt den fehlenden Hostnamen als Grund

### Requirement: Die Serveradresse lässt sich wechseln
Die Hülle MUST über ihr Anwendungsmenü einen Eintrag „Server wechseln…“ anbieten, der die
Erststart-Maske mit der gespeicherten Adresse vorbelegt öffnet. Bricht jemand dort ab, MUST die
gespeicherte Adresse wieder geladen werden.

#### Scenario: Wechsel abgebrochen
- **WHEN** jemand „Server wechseln…“ wählt und die Maske mit „Abbrechen“ verlässt
- **THEN** lädt die Hülle wieder die bisher gespeicherte Adresse

### Requirement: Der Deeplink hat ein festes Schema
Die Hülle MUST Deeplinks der Form `lifeline://verbinden?server=<https-Adresse>` annehmen.
Deeplinks mit einem anderen Pfad oder ohne Parameter `server` MUST sie ohne Wirkung verwerfen.
Hat die Hülle noch keine Adresse gespeichert, MUST ein gültiger Deeplink die Erststart-Maske mit
der Adresse vorbelegen, und verbunden wird erst mit „Verbinden“.

#### Scenario: Deeplink beim ersten Start
- **WHEN** die Hülle ohne gespeicherte Adresse über `lifeline://verbinden?server=https://elw.local:8443` geöffnet wird
- **THEN** zeigt die Erststart-Maske `https://elw.local:8443` im Eingabefeld, und nichts ist gespeichert

#### Scenario: Unbekannter Pfad
- **WHEN** die Hülle `lifeline://trennen?server=https://elw.local:8443` empfängt
- **THEN** ändert sich weder die gespeicherte noch die geladene Adresse

### Requirement: Die Hülle läuft als eine Instanz
Ein zweiter Start der Hülle, auch per Deeplink, MUST an die laufende Instanz übergeben werden.
Diese MUST ihr Fenster in den Vordergrund holen und einen mitgegebenen Deeplink verarbeiten. Ein
zweites Hauptfenster MUST NOT entstehen.

#### Scenario: Deeplink bei laufender Hülle
- **WHEN** die Hülle läuft und jemand einen `lifeline://verbinden?…`-Link öffnet
- **THEN** kommt das vorhandene Fenster nach vorn und verarbeitet den Link, und es entsteht kein zweites Fenster
