# Spec Delta

## MODIFIED Requirements

### Requirement: Jeder Versorgungsbereich hat genau einen Träger

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
