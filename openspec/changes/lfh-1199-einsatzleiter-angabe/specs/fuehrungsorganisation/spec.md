# Spec Delta

## MODIFIED Requirements

### Requirement: Einsatzleitung und Stab

Die Wurzel „Einsatzleitung“ SHALL den an der eigenen Führungsstelle erfassten Einsatzleiter mit
seinem „seit“ zeigen, in derselben Darstellung wie die Kopfleiste der Einsatzdaten. Ist kein
Einsatzleiter erfasst, SHALL sie „Leitung nicht erfasst“ zeigen. Kann die Führungsstelle nicht
geladen werden, SHALL sie den Grund nennen. Die Wurzel MUST NOT eine Leitung aus der App-Rolle
Einsatzleitung, aus der Stab-Besetzung oder aus anderen Daten ableiten.

Die Übernahme in den Lagebericht SHALL unter „Einsatzleitung“ dieselbe Angabe tragen. Solange die
Führungsstelle lädt, MUST die Übernahme gesperrt sein. Das gilt für beide Wege: „In Lagebericht
übernehmen“ am Organigramm und „Aus Meldebild und Führungsorganisation übernehmen“.

Ist das Modul Stab für die betrachtende Person freigegeben, SHALL neben der Wurzel eine Stabsstelle
„Stab“ mit den besetzten Sachgebieten und ihrer Besetzung stehen. Ist der Stab nicht freigegeben
oder seine Freigabe noch nicht ermittelt, MUST die Stabsstelle fehlen, und es MUST kein Name aus dem
Stab erscheinen.

#### Scenario: Einsatzleiter erfasst

- **WHEN** an der Führungsstelle „Anna Schulz“ seit 111430 als Einsatzleiter erfasst ist
- **THEN** zeigt die Wurzel „Einsatzleitung“ „Anna Schulz“ und „seit 111430“

#### Scenario: Kein Einsatzleiter, aber App-Rolle

- **WHEN** kein Einsatzleiter erfasst ist und ein Mitglied die Einsatzrolle Einsatzleitung trägt
- **THEN** zeigt die Wurzel „Leitung nicht erfasst“ und keinen Namen

#### Scenario: Übernahme mit Einsatzleiter

- **WHEN** der Einsatzleiter „KBM Weber (extern)“ erfasst ist und die Person „In Lagebericht übernehmen“ wählt
- **THEN** steht im neuen Lagebericht unter „Einsatzleitung“ „KBM Weber (extern)“ mit seinem „seit“, als Text und nicht als Markup

#### Scenario: Stab freigegeben

- **WHEN** der Stab freigegeben ist und S2 mit einer Person besetzt ist
- **THEN** zeigt die Stabsstelle „S2“ mit dem Namen dieser Person

#### Scenario: Stab gesperrt

- **WHEN** das Modul Stab für die Person nicht freigegeben ist
- **THEN** zeigt das Organigramm keine Stabsstelle, und es wird kein Abruf der Stabsbesetzung
  ausgelöst
