# Spec Delta

## REMOVED Requirements

### Requirement: Servermodus filtert nicht doppelt
**Reason**: Das Modul Stab samt Presse und Medienarbeit (S5) entfällt (LLH-722, Entscheidung 08.11.2026; design.md D1). Mit ihm entfällt das Presse-Log; das Szenario „Presse-Log nach Art“ hat keinen Gegenstand, und OpenSpec erlaubt nicht, es in einem MODIFIED-Block wegzulassen.
**Migration**: Die Regel gilt unverändert unter „Im Servermodus filtert, sortiert und zählt nur der Server“, mit dem Beispiel Schadenliste.

## ADDED Requirements

### Requirement: Im Servermodus filtert, sortiert und zählt nur der Server

Im Servermodus SHALL die Sicht Kopffilter, Suche und Sortierung an die Seite melden und MUST NOT
selbst filtern oder sortieren. Das Kopfmenü MUST NOT zählen. Die Zahlen des Filterhinweises MUST
aus einer Serverzählung kommen; fehlt sie, steht keine Zahl.

#### Scenario: Kopffilter am Server
- **WHEN** in der seitenweise geladenen Schadenliste im Kopf „Ausmaß“ „katastrophal“ gewählt wird
- **THEN** fragt die Seite den Server mit diesem Filter und zeigt einen Schaden weit hinten ohne Nachladen
