---
titel: Anbindungen
gruppen: [administration]
reihenfolge: 795
quellen: [frontend/src/pages/einstellungen/Anbindungen.tsx, frontend/src/api/anbindungen.ts, src/routes/anbindungen.rs, src/public_api/machine.rs, src/public_api/routen.rs, src/public_api/zugang.rs, src/public_api/kommando.rs]
---

## Überblick

Eine **Anbindung** ist der Zugang eines Fremdsystems zu Lifeline Hub: etwa ein Alarm-Adapter
der Leitstelle, ein Einsatzbuch oder eine Brücke für Positionen. Das Fremdsystem meldet sich mit
einem eigenen Schlüssel an und darf nur, was der Zugang an **Rechten** trägt.

Anbindungen legt der System-Admin in der Verwaltung unter „Einstellungen“, „Anbindungen“ an. Wie
ein Fremdsystem den Zugang technisch nutzt, steht in der Anleitung für Entwickler
(`docs/api/maschinenzugang.md`). Für eine Anzeige mit einem einzelnen Lese-Schlüssel siehe
[Externe Lagemonitore](externe-lagemonitore.md).

## Abläufe

### Anbindung anlegen

Für den System-Admin:

1. In der Verwaltung unter „Einstellungen“ „Anbindungen“ wählen.
2. „Anbindung anlegen“ wählen, einen „Name“ eintragen, etwa „Alarm-Adapter Wache 1“, und unter
   „Rechte“ ankreuzen, was das Fremdsystem darf. Optional „Gültig bis“ setzen.
3. „Anlegen und Code zeigen“ wählen. Der Dialog zeigt einen Code wie `ABCD-EFGH-JKMN-PQRS`, wie
   lange er gilt (15 Minuten) und das Kommando zum Einlösen.
4. Den Code an den Betreiber des Fremdsystems geben und „Fertig“ wählen. Der Code ist danach
   nicht mehr abrufbar.

Die Zeile zeigt „wartet auf Schlüssel“, bis das Fremdsystem den Code eingelöst hat. Danach steht
dort „aktiv“ und der Fingerabdruck seines Schlüssels. Das Kommando zum Einlösen nennt denselben
Fingerabdruck; stimmen beide überein, hat das richtige Gerät eingelöst.

### Rechte oder Name ändern

1. Im Menü der Zeile „Bearbeiten …“ wählen.
2. Name, Rechte oder „Gültig bis“ ändern und „Speichern“ wählen.

### Schlüssel wechseln

Wenn das Fremdsystem neu aufgesetzt wird oder sein Schlüssel verloren ist:

1. Im Menü der Zeile „Neuer Code (Schlüssel wechseln)“ wählen.
2. Den neuen Code wie beim Anlegen weitergeben.

Bis das Fremdsystem mit dem neuen Schlüssel zum ersten Mal anfragt, zeigt die Zeile beide
Fingerabdrücke, und der alte Schlüssel gilt weiter. Danach gilt nur noch der neue.

### Anbindung widerrufen

1. Im Menü der Zeile „Widerrufen …“ wählen.
2. Die Rückfrage mit „Widerrufen“ bestätigen.

Ab sofort kommt das Fremdsystem nicht mehr herein. Die Zeile bleibt mit „widerrufen“ stehen.

## Hintergrund

### Wer was darf

Anlegen, ändern, neuen Code ausstellen und widerrufen darf nur der System-Admin, und nur für die
eigene Organisation. Eine Führungskraft sieht die Liste ohne Aktionen.

### Rechte

| Recht                     | Das Fremdsystem darf                               |
| ------------------------- | -------------------------------------------------- |
| Lage lesen                | die Lage eines freigegebenen Einsatzes lesen       |
| Einsätze lesen            | die Köpfe freigegebener Einsätze lesen             |
| Ereignisse abrufen        | erfahren, dass sich etwas geändert hat             |
| Alarmmeldungen einliefern | Alarme als Vorschlag einliefern, nie einen Einsatz |
| Positionen einliefern     | Positionen melden                                  |
| Rechner nutzen            | die Rechner verwenden                              |

Neben jedem Recht steht der technische Name, etwa `alarmmeldungen:write`; so lässt es sich mit
der Doku des Fremdsystems vergleichen. Lesen mit Einsatzbezug braucht zusätzlich die Freigabe der
Einsatzleitung. Ein Fremdsystem legt nie selbst einen Einsatz an.

### Warum ein Fremdsystem nicht hereinkommt

Die Zeile nennt unter „Letzte Ablehnung“, warum die letzte Anfrage scheiterte, mit Uhrzeit. Das
Fremdsystem selbst erfährt nur „Anmeldung fehlgeschlagen“. Die häufigsten Gründe:

- **„Uhr geht 7 min nach“** (oder „vor“): Die Uhr des Fremdsystems weicht um mehr als 5 Minuten
  ab. Zeitabgleich (NTP) am Fremdsystem einschalten.
- **„Code noch nicht eingelöst“**: Der Code wurde nie oder zu spät eingelöst. „Neuer Code“
  wählen.
- **„Body passt nicht zur Signatur“, „Pfad passt nicht …“, „Anfrage für eine andere Instanz“**:
  Das Fremdsystem signiert falsch oder spricht die falsche Instanz an. Das ist eine Frage an den
  Betreiber des Fremdsystems.
- **„Zugang abgelaufen“**: „Gültig bis“ ist verstrichen. „Bearbeiten …“ wählen und verlängern.

### Am ELW

Meldet sich die Instanz für die Organisation bei einem Hub, nimmt sie keine Fremdsysteme an. Die
Seite nennt dann den Hub; Anbindungen werden dort angelegt.

### Schlüssel und Code

Der Code gilt 15 Minuten und einmal. Gespeichert wird er nicht, nur abgeleitete Werte; der Code
selbst geht beim Einlösen nie über die Leitung. Den privaten Schlüssel kennt nur das Fremdsystem.

### Was protokolliert wird

Anlegen, neuer Code, Einlösen, Ändern und Widerruf stehen im
[Zugangsprotokoll](zugangsprotokoll.md), mit Rechten und Fingerabdruck. Jede angenommene Anfrage
zählt je Anbindung, Route und Tag; „zuletzt genutzt“ nennt die letzte, auf die Minute genau. Die
Zählung wird nach 365 Tagen gelöscht.
