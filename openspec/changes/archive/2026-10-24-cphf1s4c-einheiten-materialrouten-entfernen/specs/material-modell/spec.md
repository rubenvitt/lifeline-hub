# Spec Delta

## ADDED Requirements

### Requirement: Ein Schreibweg für den Ort

Den Ort eines Postens SHALL die API nur über die Material-Disposition setzen oder lösen lassen
(Ändern, Disponieren, Aufteilen), mit Schreibrecht im Einsatz und der Freigabe des Moduls
Material. Einheit, Fahrzeug, UHS und Bereitstellungsraum MUST keine eigene Route zum Zuordnen
oder Lösen von Material anbieten. Das Lösen am Ende eines Orts (Requirement „Ende eines Orts“)
bleibt davon unberührt.

#### Scenario: Frühere Einheiten-Route
- **WHEN** eine Anfrage einen Posten mit `PUT` oder `DELETE` auf `/api/einsaetze/{id}/einheiten/{eid}/material/{em_id}` der Einheit zuordnen oder von ihr lösen will
- **THEN** antwortet der Server mit 404, der Posten bleibt, wo er war, und kein ETB-Eintrag entsteht

#### Scenario: Einheiten-Recht ohne Freigabe Material
- **WHEN** eine Person mit Schreibrecht im Einsatz in einem Einsatz, in dem das Modul Material ausgeblendet ist, einen Posten ohne Ort der Einheit „Staffel A“ zuordnen will
- **THEN** gelingt ihr das auf keinem Weg: die Material-Disposition antwortet 403, und der Posten bleibt ohne Ort
