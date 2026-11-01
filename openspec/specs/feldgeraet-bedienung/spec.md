# feldgeraet-bedienung Specification

## Purpose
Legt fest, wie ein gekoppeltes Feldgerät (UHS-Tablet, UHS-Laptop) bedient wird: eine schmale,
feste Oberfläche für genau eine Stelle, touchtauglich und mit sichtbarem Kopplungs- und
Verbindungsstatus.

## Requirements

### Requirement: Eigene Hülle ohne Sprünge in fremde Module

Ein gekoppeltes Feldgerät SHALL eine eigene Hülle zeigen: ohne Modulleiste, ohne Sprungpalette
und ohne Benutzermenü. Seiten, die es mit der Stabsoberfläche teilt, MUST dort keine Sprünge in
Module zeigen, die die Ansicht nicht lesen darf.

#### Scenario: Keine Sprungpalette

- **WHEN** jemand am UHS-Tablet die Tastenkombination der Sprungpalette drückt
- **THEN** öffnet sich keine Sprungpalette

#### Scenario: Keine Sprünge aus der Patientenansicht

- **WHEN** das Tablet eine Person öffnet
- **THEN** zeigt die Seite keinen Sprung ins ETB, in die Lagekarte oder in andere Module

### Requirement: Feste Startseite und Navigation je Ansicht

Jede Ansicht SHALL eine feste Startseite und eine feste Navigation haben. Das UHS-Tablet MUST die
Bereiche „Aufnahme“, „Patienten“ und „Grundriss“ führen, der UHS-Laptop zusätzlich „UHS“ mit
Plätzen, Material und Meldungen. Öffnet das Gerät eine Adresse außerhalb seiner Ansicht, MUST es
auf der Startseite landen.

#### Scenario: Start am Tablet

- **WHEN** ein UHS-Tablet die Anwendung öffnet
- **THEN** zeigt es die Patientenliste seiner UHS mit „Patient aufnehmen“ als Primäraktion

#### Scenario: Fremde Adresse

- **WHEN** jemand am Tablet die Adresse der Lagekarte eingibt
- **THEN** zeigt das Tablet seine Startseite

### Requirement: Kopplungs- und Verbindungsstatus immer sichtbar

Die Kopfzeile eines Feldgeräts SHALL immer Stelle, Gerätebezeichnung, Verbindungsstatus und
das Ende der Kopplung zeigen. Endet die Kopplung in weniger als einer Stunde, MUST die Anzeige
das hervorheben.

#### Scenario: Kopplung endet bald

- **WHEN** die Kopplung in 40 Minuten endet
- **THEN** zeigt die Kopfzeile das Ende hervorgehoben

#### Scenario: Verbindung weg

- **WHEN** das Tablet keine Verbindung zum Server hat
- **THEN** zeigt die Kopfzeile „offline“ und den Stand der angezeigten Daten

### Requirement: Kopplung beendet statt Anmeldung

Antwortet der Server einer Gerätesitzung mit 401, SHALL das Gerät eine Seite „Kopplung beendet“
zeigen, mit dem Hinweis, sich bei der Einsatzleitung zu melden, und einem Weg zurück zu
`/koppeln`. Eine Anmeldemaske für Personen MUST es dort nicht anbieten. Liegen auf dem Gerät noch
nicht übertragene Einträge früherer Kopplungen, SHALL die Seite deren Anzahl nennen, ohne Inhalt
und ohne Weg zum Verwerfen.

#### Scenario: Widerrufenes Tablet

- **WHEN** die Einsatzleitung das Tablet widerruft
- **THEN** zeigt das Tablet „Kopplung beendet“
- **AND** keine Patientendaten mehr

#### Scenario: Kopplung endet mit vorgemerkten Einträgen

- **WHEN** das Tablet drei Einträge ohne Netz vorgemerkt hat und danach „Kopplung beendet“ zeigt
- **THEN** nennt die Seite „3 Einträge nicht übertragen“

### Requirement: Touchtauglich und handschuhfest

Ein Feldgerät SHALL die Dichte nach `bedien-dichte` wählen (grober Zeiger: komfortabel). Die
Stufe für Handschuhe MUST im Gerätemenü wählbar sein und für das Gerät gespeichert bleiben.
Primäraktionen MUST in Daumenreichweite am unteren Rand liegen.

#### Scenario: Tablet startet komfortabel

- **WHEN** ein Tablet mit Touchbildschirm zum ersten Mal gekoppelt wird
- **THEN** gilt die Dichte komfortabel

#### Scenario: Handschuhe gewählt

- **WHEN** jemand im Gerätemenü die Handschuh-Stufe wählt und die Seite neu lädt
- **THEN** gilt weiter die Handschuh-Stufe

### Requirement: Kein Lagebild auf der Platte

Ein Feldgerät SHALL kein Lagebild für den Offline-Betrieb auf der Platte speichern. Schreibvorgänge
ohne Netz MUST über die bestehende Offline-Warteschlange laufen. Das gilt für die Aufnahme und auch
für Nachsichtung, Verbleib, Verlaufsnotiz, Verletzung, Maßnahme und Transport einer Person, die das
Gerät schon geladen hat. Die Warteschlange MUST dafür die Eingaben der vorgemerkten Einträge halten,
auch Notiztexte, bis sie übertragen oder verworfen sind.

#### Scenario: Neuladen ohne Netz

- **WHEN** das Tablet ohne Netz neu geladen wird
- **THEN** zeigt es keine Patientendaten aus einem gespeicherten Stand

#### Scenario: Aufnahme ohne Netz

- **WHEN** das Tablet ohne Netz eine Person aufnimmt
- **THEN** steht die Aufnahme in der Warteschlange und wird bei Verbindung übertragen

#### Scenario: Nachsichtung ohne Netz

- **WHEN** das Tablet ohne Netz bei einer geöffneten Person eine Nachsichtung übernimmt
- **THEN** steht die Nachsichtung in der Warteschlange und wird bei Verbindung mit ihrer
  Erfassungszeit übertragen

### Requirement: Vorgemerktes überdauert das Ende der Kopplung

Ein Gerät SHALL sich die Kennungen seiner Gerätekonten merken. Bestätigt der Server eine neue
Gerätesitzung im selben Einsatz mit derselben Ansicht und Stelle, MUST das Gerät die vorgemerkten
und abgelehnten Einträge früherer Gerätekonten dieses Browsers auf das neue Konto übernehmen und
wie eigene übertragen; der Server prüft sie mit den Rechten des neuen Kontos. Einträge früherer
Gerätekonten, die nicht passen, SHALL die Gerätehülle mit Anzahl zeigen und nur nach Rückfrage
verwerfen. Einträge von Personen MUST ein Gerät nie übernehmen.

#### Scenario: Neuer Code für dieselbe UHS

- **WHEN** die Kopplung des UHS-Tablets abläuft, während es eine Nachsichtung vorgemerkt hat
- **AND** das Tablet einen neuen Code für dieselbe UHS bekommt
- **THEN** wird die Nachsichtung mit ihrer Erfassungszeit übertragen

#### Scenario: Server lehnt einen übernommenen Eintrag ab

- **WHEN** ein übernommener Eintrag eine Person betrifft, die die UHS inzwischen verlassen hat
- **THEN** steht er als abgelehnt im Wiederherstellungsbereich des Geräts

#### Scenario: Neue Kopplung an anderer Stelle

- **WHEN** das Tablet mit vorgemerkten Einträgen an eine andere UHS gekoppelt wird
- **THEN** werden die Einträge nicht gesendet
- **AND** der Wiederherstellungsbereich zeigt „Aus früherer Kopplung“ mit ihrer Anzahl
- **AND** „Verwerfen“ löscht sie erst nach Rückfrage

#### Scenario: Person am früheren Gerät

- **WHEN** sich an einem Browser, der Gerät war, eine Person anmeldet
- **THEN** übernimmt sie keine Einträge der Gerätekonten
