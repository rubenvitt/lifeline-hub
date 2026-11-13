---
titel: Anbindungen
gruppen: [administration]
reihenfolge: 795
quellen: [frontend/src/pages/einstellungen/Anbindungen.tsx, frontend/src/pages/einstellungen/AnbindungAnsicht.tsx, frontend/src/api/anbindungen.ts, src/routes/anbindungen.rs, src/public_api/machine.rs, src/public_api/routen.rs, src/public_api/rechner.rs, src/public_api/zugang.rs, src/public_api/kommando.rs, src/public_api/freigabe.rs, src/public_api/einsaetze.rs, src/public_api/events.rs]
---

## Überblick

Eine **Anbindung** ist der Zugang eines Fremdsystems zu Lifeline Hub: etwa ein Alarm-Adapter
der Leitstelle, ein Einsatzbuch oder eine Brücke für Positionen. Das Fremdsystem meldet sich mit
einem eigenen Schlüssel an und darf nur, was der Zugang an **Rechten** trägt.

Anbindungen legt der System-Admin in der Verwaltung unter „Einstellungen“, „Anbindungen“ an. Wie
ein Fremdsystem den Zugang technisch nutzt, steht in der Anleitung für Entwickler
(`docs/api/maschinenzugang.md`). Wie ein Lagemonitor angebunden wird und seinen Einsatz bekommt,
steht unter [Externe Lagemonitore](externe-lagemonitore.md).

## Abläufe

### Anbindung anlegen

Für den System-Admin:

1. In der Verwaltung unter „Einstellungen“ „Anbindungen“ wählen.
2. „Anbindung anlegen“ wählen, einen „Name“ eintragen, etwa „Alarm-Adapter Wache 1“, und unter
   „Rechte“ ankreuzen, was das Fremdsystem darf. Optional „Gültig bis“ setzen.
3. „Anlegen und Code zeigen“ wählen. Der Dialog zeigt einen Code wie `ABCD-EFGH-JKMN-PQRS`, wie
   lange er gilt (15 Minuten) und das Kommando zum Einlösen.
4. Den Code an den Betreiber des Fremdsystems geben und „Fertig“ wählen. Der Code ist danach
   nicht mehr abrufbar; der Dialog schließt nur über „Fertig“, damit er nicht versehentlich
   verschwindet. Danach steht die Ansicht der neuen Anbindung.

Der Kopf zeigt „wartet auf Schlüssel“, bis das Fremdsystem den Code eingelöst hat. Danach steht
dort „aktiv“ und im Paneel „Schlüssel“ der Fingerabdruck seines Schlüssels. Das Kommando zum Einlösen nennt denselben
Fingerabdruck; stimmen beide überein, hat das richtige Gerät eingelöst.

### Rechte oder Name ändern

1. In der Liste den Namen der Anbindung wählen. Die Ansicht der Anbindung öffnet sich.
2. Im Paneel „Zugang“ „Bearbeiten“ wählen.
3. Name, „Gültig bis“ oder Rechte ändern und „Speichern“ wählen. Ein leeres „Gültig bis“ heißt:
   gilt bis zum Widerruf.

Hat ein anderer Admin die Anbindung inzwischen geändert, fragt die Seite „Zwischenzeitlich
geändert“: „Verwerfen und neu laden“ zeigt seinen Stand, „Meine Änderung übernehmen“ speichert
deine.

### Schlüssel wechseln

Wenn das Fremdsystem neu aufgesetzt wird oder sein Schlüssel verloren ist:

1. Im Menü der Zeile „Neuer Code (Schlüssel wechseln)“ wählen, oder in der Ansicht der
   Anbindung „Neuer Code“.
2. Den neuen Code wie beim Anlegen weitergeben.

Bis das Fremdsystem mit dem neuen Schlüssel zum ersten Mal anfragt, zeigt die Anbindung beide
Fingerabdrücke, und der alte Schlüssel gilt weiter. Danach gilt nur noch der neue.

### Anbindung widerrufen

1. Im Menü der Zeile oder im Kopf der Ansicht „Widerrufen …“ wählen.
2. Die Rückfrage mit „Widerrufen“ bestätigen.

Ab sofort kommt das Fremdsystem nicht mehr herein. Die Anbindung bleibt mit „widerrufen“ stehen,
samt Zeitpunkt und wer widerrufen hat.

## Hintergrund

### Wer was darf

Anlegen, ändern, neuen Code ausstellen und widerrufen darf nur der System-Admin, und nur für die
eigene Organisation. Eine Führungskraft sieht Liste und Ansicht ohne Aktionen.

### Rechte

| Recht                     | Das Fremdsystem soll                               |
| ------------------------- | -------------------------------------------------- |
| Lage lesen                | die Lage eines freigegebenen Einsatzes lesen       |
| Einsätze lesen            | die Köpfe freigegebener Einsätze lesen             |
| Ereignisse abrufen        | erfahren, dass sich etwas geändert hat             |
| Alarmmeldungen einliefern | Alarme als Vorschlag einliefern, nie einen Einsatz |
| Positionen einliefern     | Positionen melden                                  |
| Rechner nutzen            | die Rechner verwenden                              |

Die Rechte stehen fest, die Wege dahinter kommen nach und nach. Heute öffnen vier Rechte etwas:

- „Rechner nutzen“: Damit rechnet ein Fremdsystem Unterkunft und Zelte durch, mit denselben
  Regeln wie der [Unterkunftsrechner](betreuung.md) und mit den Richtwerten der Organisation aus
  den [Stammdaten](stammdaten.md). Eigene Werte darf es je Rechnung mitschicken; gespeichert wird
  davon nichts, und die Werte eines Einsatzes sieht es nicht.
- „Lage lesen“: das Lagebild eines Einsatzes, siehe unten.
- „Einsätze lesen“: der Kopf des freigegebenen Einsatzes, also Einsatznummer, Bezeichnung,
  Stichwort, Einsatzart, Nummer der Leitstelle, Einsatzort mit Koordinate und Beginn.
  Sachverhalt, meldende Stelle, Zahl der Betroffenen und Personen gehen nicht hinaus.
- „Ereignisse abrufen“: Das Fremdsystem erfährt, dass sich an seinem freigegebenen Einsatz etwas
  geändert hat, mit Zeitpunkt und Kennung des Einsatzes, ohne Inhalt. Allein öffnet dieses Recht
  nichts: Über den Einsatz erfährt nur etwas, wer auch „Einsätze lesen“ hat, über die Lage nur,
  wer auch „Lage lesen“ hat. Die Ereignisse bleiben sieben Tage abrufbar.

Mit den übrigen Rechten prüft ein Fremdsystem bisher nur seine Anmeldung. Welche Daten sie später
öffnen, nennt dieses Kapitel, sobald es sie gibt. Neben jedem Recht steht der technische Name,
etwa `alarmmeldungen:write`; so lässt es sich mit der Doku des Fremdsystems vergleichen. Ein
Fremdsystem legt nie selbst einen Einsatz an.

### Lage und Einsätze lesen braucht die Freigabe der Einsatzleitung

Eine Anbindung mit „Lage lesen“ oder „Einsätze lesen“ sieht nur den Einsatz, den die
Einsatzleitung auf der Seite „Geräte“ ihres Einsatzes im Paneel „Anbindungen“ für sie freigegeben
hat, und höchstens einen. Ohne Freigabe geht nichts hinaus, auch kein Ereignis.
Ihre Zeile nennt „liest“ mit der Bezeichnung des Einsatzes oder „kein Einsatz freigegeben“,
solange die Anbindung weder widerrufen noch abgelaufen ist. Die
Freigabe endet mit dem Abschluss des Einsatzes, mit dem Widerruf oder Ablauf der Anbindung und
wenn ihr das letzte dieser beiden Rechte genommen wird; bekommt sie eines wieder oder wird ein
verstrichenes „Gültig bis“ verlängert, braucht es eine neue Freigabe.
Abläufe und Inhalt des Lagebilds: [Externe Lagemonitore](externe-lagemonitore.md).

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
- **„Zugang abgelaufen“**: „Gültig bis“ ist verstrichen. In der Ansicht „Bearbeiten“ wählen und
  verlängern.

### Am ELW

Meldet sich die Instanz für die Organisation bei einem Hub, nimmt sie keine Fremdsysteme an. Die
Seite nennt dann den Hub; Anbindungen werden dort angelegt. Bestehende Anbindungen bleiben
stehen und gelten wieder, sobald die Kopplung endet; solange nennt ihre Zeile keinen Einsatz.
Eine Freigabe aus der Zeit davor ruht (siehe [Externe Lagemonitore](externe-lagemonitore.md)).

### Schlüssel und Code

Der Code gilt 15 Minuten und einmal. Gespeichert wird er nicht, nur abgeleitete Werte; der Code
selbst geht beim Einlösen nie über die Leitung. Den privaten Schlüssel kennt nur das Fremdsystem.

### Was protokolliert wird

Anlegen, neuer Code, Einlösen, Ändern und Widerruf stehen im
[Zugangsprotokoll](zugangsprotokoll.md), mit Rechten und Fingerabdruck. Jede angenommene Anfrage
zählt je Anbindung, Route und Tag; „zuletzt genutzt“ nennt die letzte, auf die Minute genau. Die
Zählung wird nach 365 Tagen gelöscht.
