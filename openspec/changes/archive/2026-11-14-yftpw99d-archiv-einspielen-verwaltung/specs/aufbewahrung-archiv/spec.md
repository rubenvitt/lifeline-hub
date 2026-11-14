# Spec Delta

## ADDED Requirements

### Requirement: Archivblock in der Verwaltung einspielen

Ein System-Admin SHALL einen Archivblock samt privatem Archiv-Schlüssel hochladen und damit in
seine eigene Organisation einspielen können. Das Ergebnis MUST dasselbe sein wie beim Befehl
`archiv einspielen` ohne `--org`: ein schreibgeschützter Einsatz „Aus dem Archiv · bis …“.
Dieselben Ablehnungen MUST gelten. Andere Personen MUST 403 erhalten.

#### Scenario: Admin spielt ein
- **WHEN** ein System-Admin einen gültigen Block seiner Organisation mit passendem Schlüssel hochlädt
- **THEN** antwortet das System mit Einsatz, Organisation, Frist („bis“) und Hinweisen
- **AND** steht der Einsatz in der Einsatzliste mit dem Band „Aus dem Archiv · bis …“

#### Scenario: Führungskraft
- **WHEN** eine org-weite Führungskraft einen Block hochlädt
- **THEN** antwortet das System mit 403

#### Scenario: Falscher Schlüssel
- **WHEN** der Schlüssel nicht zum Block passt
- **THEN** antwortet das System mit 400 und der Meldung, dass der Schlüssel nicht passt
- **AND** entsteht kein Einsatz

#### Scenario: Aufbewahrung abgelaufen
- **WHEN** die Aufbewahrung im Block abgelaufen ist
- **THEN** antwortet das System mit 400 und nennt das Ende der Aufbewahrung

#### Scenario: Fremde Organisation
- **WHEN** die Organisation im Block anders heißt als die Organisation des Admins
- **THEN** antwortet das System mit 400 und nennt beide Namen
- **AND** entsteht kein Einsatz

#### Scenario: Veralteter Block
- **WHEN** eine Datenkategorie des Blocks inzwischen abgelaufen ist
- **THEN** wird sie vor dem Einspielen geschwärzt
- **AND** nennt die Antwort das als Hinweis

### Requirement: Kein Einspielen an einer erreichten Instanz

Das Einspielen über die Verwaltung SHALL nur an einer Instanz bestehen, bei der sich keine andere
meldet. Hat die Instanz eine angebahnte oder aktive Kopplung, in der sie die erreichte Seite ist,
egal für welche Organisation, MUST der Server mit 422 ablehnen. Er MUST das tun, bevor er
Block oder Schlüssel liest, und die Oberfläche MUST die Aktion dann nicht anbieten. Eine
widerrufene Kopplung sperrt nicht.

#### Scenario: Hub
- **WHEN** eine andere Instanz an dieser Instanz gekoppelt ist und sich hier meldet
- **THEN** antwortet das Hochladen mit 422
- **AND** fehlt die Aktion „Archiv einspielen“ in der Verwaltung

#### Scenario: Kopplung einer anderen Organisation
- **WHEN** nur eine andere Organisation dieser Instanz eine solche Kopplung hat
- **THEN** antwortet das Hochladen ebenfalls mit 422

#### Scenario: Früher eingespielter Block
- **WHEN** an der Instanz schon ein Block eingespielt wurde und keine Kopplung angebahnt oder aktiv ist
- **THEN** bietet die Verwaltung die Aktion weiter an

#### Scenario: Meldende Seite
- **WHEN** diese Instanz sich nur selbst bei einer anderen meldet
- **THEN** steht das Einspielen zur Verfügung

### Requirement: Der Schlüssel bleibt nur für den Aufruf

Der private Schlüssel und eine Passphrase SHALL nur für die Dauer des Aufrufs im Speicher des
Servers liegen. Sie MUST weder in der Datenbank noch auf der Platte noch im Log noch in der
Admin-Spur stehen. Der Schlüssel MUST als Datei oder als eingefügter Text angenommen werden.
Eine mit Passphrase geschützte Schlüsseldatei MUST mit der mitgeschickten Passphrase gehen.

#### Scenario: Nach dem Aufruf
- **WHEN** ein Einspielen erfolgreich oder mit Fehler endet
- **THEN** enthält keine Tabelle und keine Datei im Datenverzeichnis den Schlüssel oder die Passphrase

#### Scenario: Eingefügter Schlüssel
- **WHEN** der Admin den Text `AGE-SECRET-KEY-1…` statt einer Datei schickt
- **THEN** spielt das System den Block ein wie mit der Datei

#### Scenario: Geschützte Schlüsseldatei ohne Passphrase
- **WHEN** die Schlüsseldatei mit einer Passphrase geschützt ist und keine mitkommt
- **THEN** antwortet das System mit 400 und verlangt die Passphrase

#### Scenario: Schlüssel fehlt oder doppelt
- **WHEN** weder Datei noch Text oder beides zugleich kommt
- **THEN** antwortet das System mit 400

### Requirement: Grenzen des Hochladens

Ein Block SHALL höchstens 256 MiB groß sein; darüber MUST das System mit 413 ablehnen. Der
Hinweis MUST auf den Befehl verweisen. Gleichzeitige Einspielvorgänge MUST zur Grenze
gleichzeitiger Uploads zählen. Bricht die Verbindung ab, MUST das Einspielen abbrechen, ohne eine
entschlüsselte Zwischendatei zurückzulassen.

#### Scenario: Zu großer Block
- **WHEN** ein Block über 256 MiB hochgeladen wird
- **THEN** antwortet das System mit 413

#### Scenario: Abbruch
- **WHEN** der Browser die Verbindung während des Einspielens schließt
- **THEN** liegt danach keine entschlüsselte Zwischendatei neben der Datenbank

### Requirement: Spur nennt die Person

Ein Einspielen über die Verwaltung SHALL in der Admin-Spur als „Archiv eingespielt“ mit der
handelnden Person als Akteur und ihrer Adresse stehen. Der Eintrag MUST mit dem Einsatz entstehen
und MUST bei einem abgelehnten Einspielen fehlen. Beim Befehl MUST der Akteur weiter „Befehl
archiv einspielen“ heißen.

#### Scenario: Zugangsprotokoll
- **WHEN** ein Admin einen Block einspielt
- **THEN** zeigt das Zugangsprotokoll „Archiv eingespielt“ mit seinem Namen und der Einsatzkennung

#### Scenario: Abgelehnt
- **WHEN** das Einspielen mit falschem Schlüssel scheitert
- **THEN** steht kein Eintrag „Archiv eingespielt“ in der Spur

### Requirement: Einspielen in der Oberfläche

Die Seite „Aufbewahrung“ SHALL einem System-Admin die Aktion „Archiv einspielen“ anbieten, wenn
das Einspielen zur Verfügung steht. Ein Dialog MUST Block, Schlüssel als Datei oder Text und eine
optionale Passphrase nehmen. Nach dem Einspielen MUST die Seite Einsatz, Frist und Hinweise zeigen
und in den Einsatz führen. Eine Ablehnung MUST im Dialog stehen und die Eingaben behalten.

#### Scenario: Ergebnis
- **WHEN** der Admin im Dialog einen Block einspielt
- **THEN** zeigt die Seite den Einsatz mit „bis …“ und den Hinweisen
- **AND** führt ein Sprung in den eingespielten Einsatz

#### Scenario: Fehler im Dialog
- **WHEN** das System das Einspielen ablehnt
- **THEN** zeigt der Dialog die Meldung und behält die gewählten Dateien
