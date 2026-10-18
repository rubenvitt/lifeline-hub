## Purpose

Gemeinsame Regeln für die medizinischen Einträge einer Person (Sichtung, Verbleib, Verlaufsnotiz,
Verletzung, Maßnahme, Transport): Jeder Eintrag trägt seine Erfassungszeit, kommt genau einmal an,
auch ohne Netz vorgemerkt, und der aktuelle Stand folgt dem jüngsten Eintrag. Diese Spec löst die
Annahme „Zeitstempel = Server-Jetzt“ aus E-2 ab.

## ADDED Requirements

### Requirement: Eintrag trägt seine Erfassungszeit

Jeder medizinische Eintrag einer Person SHALL einen Erfassungszeitpunkt tragen. Schickt der Client
einen `zeitpunkt_at` mit, MUST der Server ihn übernehmen, gekappt:
- liegt er mehr als 60 Sekunden nach der Serveruhr, MUST der Server mit 400 ablehnen;
- liegt er in der Zukunft, aber höchstens 60 Sekunden, MUST der Server ihn auf jetzt setzen;
- liegt er vor dem Anlegen der Person, MUST der Server ihn auf das Anlegen setzen.

Ohne Angabe MUST der Eintrag die Serverzeit tragen. Der Server MUST zusätzlich festhalten, wann der
Eintrag angekommen ist.

#### Scenario: Nachsichtung von vor 20 Minuten
- **WHEN** ein Gerät eine Sichtung mit einem Zeitpunkt von vor 20 Minuten nachreicht
- **THEN** zeigt der Verlauf die Sichtung mit diesem Zeitpunkt
- **AND** sie ist als nachgetragen erkennbar

#### Scenario: Gerätuhr weit vorgestellt
- **WHEN** ein Eintrag mit einem Zeitpunkt 10 Minuten nach der Serveruhr ankommt
- **THEN** antwortet der Server mit 400 und speichert nichts

### Requirement: Eintrag kommt genau einmal an

Jeder medizinische POST einer Person SHALL eine optionale `client_id` annehmen. Kommt dieselbe
`client_id` im selben Einsatz ein zweites Mal, MUST der Server den schon gespeicherten Eintrag
liefern, ohne einen zweiten anzulegen und ohne einen zweiten ETB-Eintrag zu schreiben.

#### Scenario: Doppelte Übertragung nach Netzabbruch
- **WHEN** die Warteschlange eine vorgemerkte Notiz zweimal mit derselben `client_id` überträgt
- **THEN** steht die Notiz genau einmal im Verlauf

### Requirement: Der jüngste Eintrag bestimmt den aktuellen Stand

Aktuelle Sichtung, aktueller Verbleib und aktueller Transportstand einer Person SHALL dem Eintrag
mit dem jüngsten Erfassungszeitpunkt folgen. Bei gleichem Zeitpunkt MUST der später gespeicherte
gewinnen. Ein nachgereichter Eintrag, der älter ist als der aktuelle, MUST im Verlauf stehen, aber
den aktuellen Stand nicht ändern. Er MUST auch keine Folge auslösen, die am aktuellen Stand hängt:
keinen Austritt aus der UHS und keinen Hinweis „Sichtung I“. Sein ETB-Eintrag MUST die
Erfassungszeit tragen und nennen, dass er nachgetragen ist.

#### Scenario: Alte Offline-Sichtung nach neuer Online-Sichtung
- **WHEN** um 14:20 online SK II erfasst wird und danach eine um 14:10 offline vorgemerkte SK I ankommt
- **THEN** bleibt SK II die aktuelle Sichtung
- **AND** der Verlauf zeigt beide in zeitlicher Folge
- **AND** es entsteht kein Hinweis „Sichtung I“

#### Scenario: Älterer Verbleib nach der Rückkehr
- **WHEN** ein vorgemerkter Verbleib „Transport“ ankommt, der älter ist als der aktuelle Verbleib
- **THEN** bleibt der aktuelle Verbleib unverändert, und die Person tritt nicht aus der UHS aus

### Requirement: Bestätigung gilt zur Erfassungszeit

Trägt ein vorgemerkter Eintrag die Angabe „Bestätigt von“, SHALL der Server prüfen, ob die Kraft
zur Erfassungszeit im Einsatz eingesetzt war. Eine danach entlassene Kraft MUST NOT zur Ablehnung
führen.

#### Scenario: Schichtwechsel vor der Übertragung
- **WHEN** eine Sichtung mit „bestätigt von A. Muster“ vorgemerkt ist und A. Muster vor der
  Übertragung entlassen wird
- **THEN** speichert der Server die Sichtung mit A. Muster als Bestätigender
