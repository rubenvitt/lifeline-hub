# Spec Delta

## MODIFIED Requirements

### Requirement: Zählung der Anrufe
Das System SHALL unter `GET /api/einsaetze/{id}/stab/infotelefon/zaehler` die Anrufe des
Einsatzes zählen. Die Antwort trägt `gesamt`, `offen` (Anrufe im Status `offen`) und
`je_anliegen` mit einem Wert für **jedes** der sieben Anliegen. Ein Anliegen ohne Anruf MUST als
0 erscheinen und DARF NICHT fehlen. Die Summe über `je_anliegen` MUST `gesamt` ergeben. Die
Zählung hat dasselbe Gate wie die Liste.

#### Scenario: Ungefilterte Zählung
- **WHEN** ein Einsatz 3 Anrufe „Auskunft zur Lage“, davon 1 offen, und 1 Anruf „Hinweis“ hat
- **THEN** antwortet die Zählung mit `gesamt: 4`, `offen: 1`, `je_anliegen.auskunft_lage: 3`,
  `je_anliegen.hinweis: 1` und 0 für die übrigen fünf Anliegen

#### Scenario: Mehr Anrufe als eine Seite
- **WHEN** ein Einsatz 2 000 Anrufe hat
- **THEN** ist `gesamt` 2 000, nicht die Seitengröße der Liste

#### Scenario: Andere Einsätze zählen nicht mit
- **WHEN** ein anderer Einsatz Anrufe hat
- **THEN** sind diese in der Zählung dieses Einsatzes nicht enthalten

#### Scenario: Informationstelefon gesperrt
- **WHEN** eine Person ohne Freigabe des Moduls Informationstelefon die Zählung abruft
- **THEN** antwortet das System wie bei der Liste mit 403

### Requirement: Rechte, Lebenszyklus, Live
Lesen SHALL jedes Einsatzmitglied mit Leserecht auf das Modul Informationstelefon
(`infotelefon`). Erfassen und Statuswechsel MUST Schreibrecht und die Freigabe des Moduls
`infotelefon` verlangen. Am abgeschlossenen Einsatz ist das Protokoll schreibgeschützt. Ein Anruf
eines anderen Einsatzes MUST mit 404 beantwortet werden. Anrufe MUST NOT gelöscht werden können.
Neue Anrufe anderer Arbeitsplätze SHALL live erscheinen, ohne dass die Liste unter dem Cursor
springt. Das Live-Ereignis `infotelefon` MUST nur Personen mit Freigabe des Moduls `infotelefon`
erreichen.

#### Scenario: Zwei Telefonplätze
- **WHEN** zwei Personen gleichzeitig Anrufe erfassen
- **THEN** sieht jede die Anrufe der anderen ohne Neuladen, und die Kennzahlen stimmen an beiden
  Plätzen überein

#### Scenario: Live ohne Freigabe
- **WHEN** eine Person ohne Freigabe des Moduls `infotelefon` den Einsatz offen hat und ein Anruf
  erfasst wird
- **THEN** erhält sie kein Ereignis `infotelefon`

## ADDED Requirements

### Requirement: Das Informationstelefon ist ein eigenes Modul
Das Informationstelefon SHALL ein eigenes Einsatzmodul mit dem Key `infotelefon` in der Kategorie
Kommunikation sein, mit der Seite unter `/einsaetze/:id/infotelefon`. Seine Freigabe MUST von
keinem anderen Modul abhängen. Die Endpunkte unter `/api/einsaetze/{id}/stab/infotelefon` MUST
ihre Adressen behalten und nach der Freigabe von `infotelefon` gaten. Einen Modulzähler MUST das
Modul nicht tragen.

#### Scenario: Modul in der Kategorie Kommunikation
- **WHEN** eine Person mit Freigabe des Informationstelefons die Kategorie „Kommunikation“ öffnet
- **THEN** steht dort das Modul „Informationstelefon“ ohne Zahl, und ein Klick öffnet
  `/einsaetze/:id/infotelefon`

#### Scenario: Schnittstelle unter alter Adresse
- **WHEN** eine Person mit Freigabe des Informationstelefons `GET /api/einsaetze/{id}/stab/infotelefon` abruft
- **THEN** antwortet das System mit 200 und der ersten Seite des Protokolls

#### Scenario: Gesperrtes Modul
- **WHEN** die Organisation das Modul `infotelefon` auf `einsatzfuehrung` beschränkt und ein Beobachter die Liste abruft
- **THEN** antwortet das System mit 403

### Requirement: Die alte Adresse leitet dauerhaft um
Die alte Adresse `/einsaetze/:id/stab/infotelefon` MUST dauerhaft auf `/einsaetze/:id/infotelefon`
umleiten, mit erhaltener Query (`?anruf=`, `?neu=1`) und ohne zusätzlichen Eintrag im
Browserverlauf. Gegatet wird sie nach der Freigabe von `infotelefon`. Jeder Verweis der Anwendung
auf das Informationstelefon MUST die neue Adresse nennen.

#### Scenario: Lesezeichen auf einen Anruf
- **WHEN** eine Person `/einsaetze/:id/stab/infotelefon?anruf=42` aufruft
- **THEN** zeigt die App `/einsaetze/:id/infotelefon?anruf=42` mit dem Anruf 42 hervorgehoben, und
  „Zurück“ im Browser führt nicht erneut auf die alte Adresse
