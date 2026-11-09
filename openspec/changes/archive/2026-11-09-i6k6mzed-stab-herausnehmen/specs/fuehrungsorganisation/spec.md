# Spec Delta

## MODIFIED Requirements

### Requirement: Einsatzleitung und Stab

Die Wurzel „Einsatzleitung“ SHALL den an der eigenen Führungsstelle erfassten Einsatzleiter mit
seinem „seit“ zeigen, in derselben Darstellung wie die Kopfleiste der Einsatzdaten. Ist kein
Einsatzleiter erfasst, SHALL sie „Leitung nicht erfasst“ zeigen. Kann die Führungsstelle nicht
geladen werden, SHALL sie den Grund nennen. Die Wurzel MUST NOT eine Leitung aus der App-Rolle
Einsatzleitung, aus den Führungsfunktionen der Mitglieder oder aus anderen Daten ableiten.

Die Übernahme in den Lagebericht SHALL unter „Einsatzleitung“ dieselbe Angabe tragen. Solange die
Führungsstelle lädt, MUST die Übernahme gesperrt sein. Das gilt für beide Wege: „In Lagebericht
übernehmen“ am Organigramm und „Aus Meldebild und Führungsorganisation übernehmen“.

Führt mindestens ein Mitglied des Einsatzes in seiner Mitgliedschaft ein Sachgebiet S1–S6, SHALL
neben der Wurzel eine Stabsstelle „Stab“ stehen, mit jedem so geführten Sachgebiet und den Namen
seiner Mitglieder (Spec `fuehrungsfunktionen`, „Mehrere Mitglieder mit derselben Führungsfunktion“).
Ein Sachgebiet ohne Mitglied MUST fehlen; einen Zustand „nicht besetzt“ gibt es dort nicht. Führt
kein Mitglied ein Sachgebiet oder sind die Mitglieder noch nicht oder nicht geladen, MUST die
Stabsstelle fehlen. Eine Modulfreigabe MUST dafür nicht nötig sein.

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

- **WHEN** ein Mitglied in seiner Mitgliedschaft S2 führt und kein Mitglied S1, S3, S4, S5 oder S6
- **THEN** zeigt die Stabsstelle nur „S2“ mit dem Namen dieses Mitglieds

#### Scenario: Stab gesperrt

- **WHEN** kein Mitglied des Einsatzes ein Sachgebiet S1–S6 führt
- **THEN** zeigt das Organigramm keine Stabsstelle
