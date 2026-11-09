# Spec Delta

## REMOVED Requirements

### Requirement: Jeder Versorgungsbereich hat genau einen Träger
**Reason**: Das Modul Stab samt Presse und Medienarbeit (S5) entfällt (LLH-722, Entscheidung 08.11.2026; design.md D1). Mit der Stabseite entfällt ihre Zeile S4; das Szenario „S4 führt die Träger“ hat keinen Gegenstand, und OpenSpec erlaubt nicht, es in einem MODIFIED-Block wegzulassen.
**Migration**: Die Zuordnung der Versorgungsbereiche gilt unverändert unter „Versorgungsbereiche liegen bei Verpflegung, Nachforderungen und Material“, ohne Zeile S4.

## ADDED Requirements

### Requirement: Versorgungsbereiche liegen bei Verpflegung, Nachforderungen und Material

Jeder Versorgungsbereich von S4 SHALL genau einem bestehenden Modul zugeordnet sein:

- Verpflegung → Modul Verpflegung
- Einsatzmittel, Verbrauchsgüter und Betriebsstoffe anfordern → Modul Nachforderungen
- Materialerhaltung → Modul Material, über den Status einer Materialzeile

Das System MUST NOT ein eigenes Modul, eine eigene Seite oder eine eigene Tabelle „Versorgung“
führen, die einen dieser Bereiche ein zweites Mal trägt.

#### Scenario: Es gibt kein Modul Versorgung
- **WHEN** eine Person Rail, Modulpanel oder Modulfreigabe eines Einsatzes durchsieht
- **THEN** findet sie kein Modul „Versorgung“ neben Nachforderungen, Verpflegung und Material

#### Scenario: Materialerhaltung am Material
- **WHEN** ein Gerät im Einsatz ausfällt
- **THEN** wird das an seiner Materialzeile mit dem Status `defekt` festgehalten und nicht in
  einer eigenen Versorgungsliste
