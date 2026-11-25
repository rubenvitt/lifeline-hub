# Vorlage: Datenschutz-Folgenabschätzung (DSFA) zur Ortung im Einsatz

Stand: 25.11.2026. Gemeinsame Vorlage für die Ortung in Lifeline Hub: Positionen von Einheiten
und Fahrzeugen über die Helfer-App und, wenn die Organisation es freigibt, von Personen. Die
Vorlage aus LLH-2091 gab es beim Anlegen noch nicht; diese Datei ist deshalb die gemeinsame, und
eine spätere Vorlage dort bezieht sich auf sie. Herleitung:
`docs/superpowers/specs/2026-11-24-vakwvkpg-helfer-app-design.md`, Abschnitt „Datenschutz“;
Regeln der App: [ADR-0098](../architektur/entscheidungen/ADR-0098-die-helfer-app-ist-eine-eigene-native-app-und-ortet-im-hintergrund-nur-fuer-eine-aktive-helfer-kopplung.md).

Die Vorlage beschreibt, was Lifeline Hub tut. **Ob eine DSFA nötig ist und wie sie ausfällt,
entscheidet die verantwortliche Organisation** mit ihrer oder ihrem Datenschutzbeauftragten.
Bitte alle Felder in `<…>` ausfüllen und das Ergebnis bei der Organisation aufbewahren; es ist
keine Rechtsberatung.

## 1. Verantwortliche Stelle

| Feld | Eintrag |
| --- | --- |
| Verantwortliche Organisation | `<Name, Anschrift>` |
| Datenschutzbeauftragte | `<Name, Kontakt>` |
| Betreiber des Servers | `<Organisation selbst oder Dienstleister; bei Dienstleister: Auftragsverarbeitungsvertrag>` |
| Stand und Bearbeiter | `<Datum, Name>` |

## 2. Zweck

Lageführung im Einsatz: Die Einsatzleitung sieht auf der Lagekarte, wo Einheiten, Fahrzeuge und
(sofern freigegeben) einzelne Kräfte stehen, wie aktuell die Angabe ist und woher sie stammt.
Nicht der Zweck: Leistungs- oder Verhaltenskontrolle, Arbeitszeiterfassung, Auswertung nach dem
Einsatz. Die Software hält dafür keinen Verlauf vor.

## 3. Rechtsgrundlage

Je nach Beschäftigungsverhältnis, von der Organisation zu wählen und zu belegen:

- **Ehrenamt:** Einwilligung der Helfenden (Art. 6 Abs. 1 lit. a DSGVO). Die App holt sie je
  Anmeldung ein: Der Bildschirm „Anmelden“ nennt in einem Satz, was gesendet wird, an wen und
  bis wann; erst „Anmelden und Ortung erlauben“ löst die Einwilligung ein. Personenortung ist
  ein eigenes Häkchen („Mich als Person orten“). Eine Einwilligung lässt sich jederzeit durch
  Pausieren oder Abmelden widerrufen.
- **Hauptamt:** Betriebsvereinbarung bzw. Dienstvereinbarung `<Bezeichnung, Datum>`; ergänzend
  `<§ 26 BDSG oder Landesrecht>`.
- **Weitere Grundlagen** (etwa öffentliche Aufgabe im Katastrophenschutz): `<von der
  Organisation zu prüfen>`.

Die Organisation bestätigt beim Einschalten von „Ortung im Einsatz“ in den Einsatz-Vorgaben der
Verwaltung, dass diese Grundlage vorliegt; der Server hält fest, wer es wann bestätigt hat.

## 4. Verarbeitete Daten

| Datum | Wann | Bemerkung |
| --- | --- | --- |
| Letzte Position (Breite, Länge, Genauigkeit) mit Zeitpunkt | solange die Kopplung besteht und nicht pausiert ist | nur die letzte, kein Verlauf |
| Anzeigename der Helfenden | bei der Anmeldung | frei gewählt, etwa „Max M., San-Trupp 2“ |
| Zielzuordnung (Einheit oder Fahrzeug) | bei der Anmeldung, von der Leitung bestätigt | |
| Zuordnung zu einer Person des Einsatzes | nur mit Freigabe „Auch Personen orten“ und Bestätigung der Leitung | |
| Quelle der Position („Helfer-App“) | mit jeder Position | für die Anzeige auf der Lagekarte |

Keine Bewegungsprofile, keine Geschwindigkeits- oder Routendaten, keine Weitergabe an Dritte. Die
App sendet nur an den Server ihrer Kopplung (`ios/Helfer/AGENTS.md`, `android/helfer/AGENTS.md`).
Auf dem Gerät liegt die letzte Position nur im Speicher, nie in einer Datei.

## 5. Speicherdauer und Löschung

- **Personenposition:** bis zum Ende der Kopplung; beim Pausieren, Abmelden, Entfernen durch die
  Leitung, Ablauf der Kopplung (höchstens 72 Stunden nach der Bestätigung, spätestens mit dem
  Einsatzende) und bei „Alle Helfer abmelden“ löscht der Server sie.
- **Position an Einheit oder Fahrzeug:** bleibt als Lagestand erhalten, bis der Einsatz gelöscht
  wird (Aufbewahrung nach dem Kapitel Aufbewahrung der Anwenderdoku). Eine Handposition der
  Leitung ersetzt sie.
- **Helfer-Kopplung** (Name, Ziel, Zeiten): als Teil des Einsatzes, mit dessen Aufbewahrung.
- Eintrag im Einsatztagebuch: Anmelden, Bestätigen und Beenden einer Kopplung stehen als
  Systemeinträge ohne Position.

## 6. Empfänger

- Die Einsatzleitung des Einsatzes (Liste „Helfer“, Lagekarte, Liste „Geortet“).
- Wer die Lagekarte des Einsatzes lesen darf, sieht die Position von Einheit oder Fahrzeug mit
  Quelle und Alter, nach den Rechten des Einsatzes (`<Rollen der Organisation eintragen>`).
- Das Live-Ereignis „helfer“ geht nur an die Einsatzleitung.
- Auftragsverarbeiter: `<falls der Server bei einem Dienstleister läuft>`. Kein Dritter der
  Software selbst; die Positionen verlassen den Server der Organisation nicht.

## 7. Notwendigkeit und Verhältnismäßigkeit

`<Von der Organisation zu begründen: Warum reicht die manuelle Positionsmeldung per Funk nicht?>`
Mildere Mittel, die die Software bietet:

- Ortung ist **aus**, solange die Organisation sie nicht einschaltet; Personenortung ist ein
  zweiter, eigener Schalter.
- Ortung nur **je Kopplung** und nur mit Einwilligung der Person; sichtbar durch die
  Standortanzeige und Live-Aktivität (iOS) bzw. die Benachrichtigung des Dienstes (Android).
- **Nur „When in Use“** (iOS) bzw. Vordergrund-Dienst (Android), nie „Immer“ (ADR-0098).
- **Pausieren** jederzeit; die Personenposition wird dabei gelöscht.
- Takt: höchstens alle 30 Sekunden und nur bei Bewegung über 25 m, sonst ein Lebenszeichen alle
  5 Minuten; gepuffert wird höchstens die letzte Position bis zu 10 Minuten.
- Befristung: Kopplung bis Einsatzende, höchstens 72 Stunden.

## 8. Risiken und Maßnahmen

| Risiko | Maßnahme |
| --- | --- |
| Bewegungsprofil entsteht | kein Verlauf auf Server und Gerät, nur die letzte Position |
| Ortung ohne Wissen der Person | sichtbare Anzeige durch das System, Einwilligungssatz vor dem Anmelden |
| Ortung nach dem Einsatz | Kopplung endet mit dem Einsatz oder nach 72 Stunden; die Leitung kann alle abmelden |
| Zugriff Unbefugter | Positionen nur über die Rechte des Einsatzes; Live-Ereignis nur an die Leitung; Einladung per Code mit Drosselung |
| Gerät geht verloren | die Leitung entfernt die Kopplung; die Sitzung endet sofort |
| Druck zur Teilnahme (Beschäftigte) | Betriebsvereinbarung; Freiwilligkeit der Personenortung als eigenes Häkchen |
| `<weitere Risiken der Organisation>` | `<Maßnahme>` |

## 9. Betroffenenrechte

Auskunft, Berichtigung, Löschung und Widerspruch: Ansprechpartner `<Stelle>`. Die Löschung der
Personenposition geschieht sofort durch Abmelden oder Pausieren; ein Verlauf zur Auskunft liegt
nicht vor. Die Information der Helfenden erfolgt im Bildschirm „Anmelden“ und über
`<Datenschutzhinweis der Organisation>`.

## 10. Ergebnis

| Feld | Eintrag |
| --- | --- |
| Restrisiko | `<gering / mittel / hoch>` |
| Beteiligung der Datenschutzbeauftragten | `<Datum, Votum>` |
| Beteiligung des Personalrats bzw. Betriebsrats | `<Datum, Votum>` |
| Wiedervorlage | `<Datum, spätestens bei Änderung von Zweck, Daten oder Empfängern>` |
