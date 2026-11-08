# Spec Delta

## MODIFIED Requirements

### Requirement: Servermodus filtert nicht doppelt
Im Servermodus SHALL die Sicht Kopffilter, Suche und Sortierung an die Seite melden und MUST NOT
selbst filtern oder sortieren. Das Kopfmenü MUST NOT zählen. Die Zahlen des Filterhinweises MUST
aus einer Serverzählung kommen; fehlt sie, steht keine Zahl.

#### Scenario: Kopffilter am Server
- **WHEN** in der seitenweise geladenen Schadenliste im Kopf „Ausmaß“ „katastrophal“ gewählt wird
- **THEN** fragt die Seite den Server mit diesem Filter und zeigt einen Schaden weit hinten ohne Nachladen
