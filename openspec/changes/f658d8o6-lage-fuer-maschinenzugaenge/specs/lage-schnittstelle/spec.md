# Spec Delta

## Purpose

Legt fest, was ein Fremdsystem wie der Lagemonitor im Führungskraftwagen über `GET /api/v1/lage`
erhält: das Lagebild genau des Einsatzes, den die Einsatzleitung für seinen Zugang freigegeben
hat, in Zahlen und Lagedaten ohne Personenbezug.

## ADDED Requirements

### Requirement: Die Lage gibt es nur für den freigegebenen Einsatz

`GET /api/v1/lage` SHALL einem angemeldeten Maschinenzugang mit dem Scope `lage:read` das Lagebild
des Einsatzes liefern, den die Einsatzleitung für diesen Zugang freigegeben hat. Ohne Freigabe
MUST die Antwort 200 mit `einsatz: null` und ohne Karte sein. Die Antwort MUST `stand_at` tragen,
den Zeitpunkt der Berechnung.

#### Scenario: Freigegebener Einsatz
- **WHEN** die Einsatzleitung den Einsatz „Stadtfest“ für den Zugang „FüKW Monitor“ freigegeben hat und der Zugang `GET /api/v1/lage` signiert aufruft
- **THEN** antwortet der Server mit 200, `einsatz.id` und `einsatz.bezeichnung` nennen diesen Einsatz, und die Antwort ist signiert

#### Scenario: Keine Freigabe
- **WHEN** für den Zugang kein Einsatz freigegeben ist
- **THEN** antwortet der Server mit 200, `einsatz` ist `null`, und `karte` und `karte_etag` fehlen

#### Scenario: Scope fehlt
- **WHEN** ein Zugang nur mit `alarmmeldungen:write` `GET /api/v1/lage` aufruft
- **THEN** antwortet der Server mit 403 und dem Code `missing_scope`

### Requirement: Nur laufende Einsätze

Die Route MUST nur einen aktiven Einsatz zeigen. Ist der freigegebene Einsatz abgeschlossen oder
gelöscht, MUST die Antwort der eines Zugangs ohne Freigabe gleichen.

#### Scenario: Einsatz abgeschlossen
- **WHEN** die Einsatzleitung den freigegebenen Einsatz abschließt und der Zugang danach `GET /api/v1/lage` aufruft
- **THEN** ist `einsatz` `null`

### Requirement: Das Lagebild trägt Kopf, Zahlen und Lagemeldung

Der Block `einsatz` SHALL `id`, `bezeichnung`, `einsatzart`, `begonnen_at`, `betroffene`, `kraefte`,
`uhs`, `sofortmeldungen_offen` und `lagemeldung` tragen, dazu `stichwort`, wenn eines gesetzt ist.
Jede nicht aufgelöste Unfallhilfsstelle steht in `uhs` mit `id`, `bezeichnung`, `kind`, `state`,
`belegt`, `plaetze` und `kraefte`. `lagemeldung` MUST die Zusammenfassung des jüngsten
freigegebenen Lageberichts mit `freigegeben_at` sein, ohne einen solchen `null`.

#### Scenario: Zahlen des Einsatzes
- **WHEN** im Einsatz drei Personen der Sichtungskategorie I erfasst sind und zwei Einheiten mit acht Kräften eingesetzt sind
- **THEN** nennt `einsatz.betroffene.sk1` 3, `einsatz.kraefte.einheiten` 2 und `einsatz.kraefte.personal` 8

#### Scenario: Unfallhilfsstelle
- **WHEN** der Behandlungsplatz „BHP Nord“ in Betrieb ist und drei Personen dort liegen
- **THEN** steht er in `einsatz.uhs` mit `kind` `behandlungsplatz`, `state` `aktiv` und `belegt` 3

#### Scenario: Lagemeldung
- **WHEN** ein Lagebericht mit der Zusammenfassung „Lage stabil“ freigegeben ist
- **THEN** nennt `einsatz.lagemeldung.text` „Lage stabil“ und `freigegeben_at` den Zeitpunkt der Freigabe

#### Scenario: Kein freigegebener Lagebericht
- **WHEN** im Einsatz kein Lagebericht freigegeben ist
- **THEN** ist `einsatz.lagemeldung` `null`

### Requirement: Hilfeleistungen bei gewählter Reihe „Sanitätsdienst“

Trägt der Einsatz die Wahl `sanitaetsdienst`, SHALL `einsatz.sanitaetsdienst` die Zahlen `kontakte`,
`kontakte_letzte_stunde`, `in_versorgung` und `transporte` tragen, nach denselben Regeln wie die
Kennzahlen des Lagebilds. Ohne die Wahl MUST der Block fehlen.

#### Scenario: Reihe gewählt
- **WHEN** der Einsatz `sanitaetsdienst` trägt und 41 Kontakte zählt
- **THEN** nennt `einsatz.sanitaetsdienst.kontakte` 41

#### Scenario: Reihe nicht gewählt
- **WHEN** der Einsatz `sanitaetsdienst` nicht trägt
- **THEN** fehlt `sanitaetsdienst` in der Antwort

### Requirement: Keine personenbezogenen Daten in der Lage

Die Antwort MUST NOT Namen, Personenkennungen, Gesundheitsdaten einzelner Personen oder freie
Notizen enthalten. Der Einsatzkopf MUST ohne Sachverhalt, meldende Stelle und Adresse des
Einsatzorts kommen; offene Sofortmeldungen nur als Zahl, freie Kartenzeichen ohne Beschriftung.

#### Scenario: Freitexte und Namen
- **WHEN** der Sachverhalt des Einsatzes „Herr Muster gestürzt“ lautet und in einer Unfallhilfsstelle eine Person „Erika Beispiel“ liegt
- **THEN** enthält die Antwort weder „Muster“ noch „Beispiel“ und keine Personenkennung

#### Scenario: Sofortmeldung
- **WHEN** im Einsatz zwei Sofortmeldungen unbestätigt sind
- **THEN** nennt `einsatz.sofortmeldungen_offen` 2, und die Antwort enthält keinen Meldungstext

### Requirement: Die Karte kommt als GeoJSON mit Fassung

Mit einem freigegebenen Einsatz SHALL die Antwort `karte` als GeoJSON-FeatureCollection und
`karte_etag` als Fassung der Karte tragen. Jedes Feature nennt in `properties.kind` seine Art:
`einsatzort`, `zone`, `abschnitt`, `uhs` oder `zeichen`. Nennt die Anfrage in `?karte=` die
aktuelle Fassung, MUST `karte` fehlen und `karte_etag` bleiben. Mit `?karte=none` MUST beides
fehlen.

#### Scenario: Erste Abfrage
- **WHEN** der Einsatzort verortet ist und der Zugang `GET /api/v1/lage` ohne Abfrageparameter aufruft
- **THEN** enthält `karte` ein Feature mit `properties.kind` `einsatzort`, und `karte_etag` ist gesetzt

#### Scenario: Unveränderte Karte
- **WHEN** der Zugang danach `GET /api/v1/lage?karte=<karte_etag>` aufruft und sich die Karte nicht geändert hat
- **THEN** fehlt `karte`, und `karte_etag` nennt dieselbe Fassung

#### Scenario: Geänderte Karte
- **WHEN** die Einsatzleitung eine Gefahrenzone einzeichnet und der Zugang mit der alten Fassung fragt
- **THEN** enthält die Antwort die neue `karte` mit einem Feature `zone` und eine andere `karte_etag`

#### Scenario: Geometrie ohne Zusätze
- **WHEN** eine gespeicherte Zonengeometrie neben `type` und `coordinates` einen weiteren Schlüssel mit Text trägt
- **THEN** enthält `geometry` des Features nur `type` und `coordinates`

#### Scenario: Karte abbestellt
- **WHEN** der Zugang `GET /api/v1/lage?karte=none` aufruft
- **THEN** fehlen `karte` und `karte_etag`, und die Zahlen des Einsatzes sind vollständig

### Requirement: Ein gespiegelter Einsatz nennt seinen Abgleich

Hält die Instanz den freigegebenen Einsatz als Spiegel, SHALL `einsatz.spiegel` den Zeitpunkt des
letzten Abgleichs mit der führenden Instanz (`letzter_abgleich_at`) nennen und ob der Abgleich
beendet ist (`abgleich_beendet`). Führt die Instanz den Einsatz selbst, MUST der Block fehlen.

#### Scenario: Einsatz vom ELW geführt
- **WHEN** ein ELW den Einsatz führt, der Hub ihn als Spiegel hält und ein Zugang am Hub `GET /api/v1/lage` aufruft
- **THEN** trägt die Antwort die gespiegelten Zahlen, und `einsatz.spiegel.letzter_abgleich_at` nennt den letzten Abgleich

#### Scenario: Selbst geführter Einsatz
- **WHEN** die Instanz den freigegebenen Einsatz selbst führt
- **THEN** fehlt `einsatz.spiegel`

### Requirement: Fremdsysteme lesen die Lage nur signiert

Die Anwendung MUST NOT das Lagebild an ein Fremdsystem über einen anderen Weg als
`GET /api/v1/lage` ausgeben. Der frühere Pfad `GET /api/lagemonitor/v1/lage` und die Schlüssel
`llh_lm_…` MUST NOT mehr gelten. Das Lagebild für Externe (Link für Menschen ohne Konto) bleibt
davon unberührt.

#### Scenario: Früherer Pfad
- **WHEN** ein Client `GET /api/lagemonitor/v1/lage` mit einem früher ausgegebenen Schlüssel `llh_lm_…` aufruft
- **THEN** antwortet der Server mit 404

#### Scenario: Bearer an der neuen Route
- **WHEN** ein Client `GET /api/v1/lage` mit `Authorization: Bearer llh_lm_…` aufruft
- **THEN** antwortet der Server mit 401
