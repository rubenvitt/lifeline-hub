# org-admin-unterschrift Specification

## Purpose
Org-Admins unterschreiben folgenschwere Erklärungen (etwa eine Notübernahme) mit einem eigenen
Passkey, den gekoppelte Instanzen kennen und prüfen können, sodass eine Instanz eine solche
Erklärung einem Menschen zuordnen kann und nicht dem Server glauben muss, der sie überbringt.

## Requirements

### Requirement: Eigener Unterschriftsschlüssel je Admin

Ein Admin SHALL an seiner Instanz einen Passkey als Unterschriftsschlüssel registrieren können,
getrennt von seinen Anmeldewegen. Ein Unterschriftsschlüssel MUST NOT zur Anmeldung taugen, und
ein Anmelde-Passkey MUST NOT als Unterschriftsschlüssel gelten. Nur Admins MUST einen
registrieren können.

#### Scenario: Registrieren
- **WHEN** ein Admin auf der Seite „Instanzkopplung“ „Unterschriftsschlüssel registrieren“ wählt und den Passkey bestätigt
- **THEN** erscheint der Schlüssel mit Bezeichnung, Fingerabdruck und Datum in der Liste seiner Org

#### Scenario: Anmelden mit dem Unterschriftsschlüssel
- **WHEN** jemand versucht, sich mit dem Unterschriftsschlüssel anzumelden
- **THEN** scheitert die Anmeldung wie mit einem unbekannten Passkey

#### Scenario: Kein Admin
- **WHEN** ein Konto ohne Admin-Rolle einen Unterschriftsschlüssel registrieren will
- **THEN** antwortet der Server mit 403

### Requirement: Gekoppelte Instanzen kennen die Schlüssel der Org

Beim Einlösen eines Kopplungscodes SHALL die ausstellende Instanz der einlösenden alle gültigen
Unterschriftsschlüssel der Org übergeben. Danach MUST sie Neuzugänge und Widerrufe bei jeder
Meldung nachliefern, die das Gegenüber noch nicht hat.

#### Scenario: Grundstock beim Koppeln
- **WHEN** ein ELW einen Code der Org „DRK KV Nord“ einlöst, die zwei gültige Unterschriftsschlüssel hat
- **THEN** zeigt der ELW für diese Org zwei Unterschriftsschlüssel mit denselben Fingerabdrücken wie der Hub

### Requirement: Neue Schlüssel nur mit Unterschrift eines bekannten Admins

Ein neuer Unterschriftsschlüssel SHALL erst verteilt werden, wenn ein Admin der Org ihn mit einem
schon gültigen Unterschriftsschlüssel unterschrieben hat. Die empfangende Instanz MUST einen
neuen Schlüssel nur übernehmen, wenn die Unterschrift von einem ihr bekannten, gültigen Schlüssel
derselben Org stammt; sonst MUST sie ihn verwerfen und den Vorfall anzeigen. Einen übernommenen
neuen Schlüssel MUST sie als „wartet auf Bestätigung“ führen, bis ein Admin dort ihn bestätigt.
Ein wartender Schlüssel MUST NOT als Unterschrift oder Gegenzeichnung anerkannt werden. Stammt die
Gegenzeichnung nachweislich von einem dort noch wartenden Schlüssel, SHALL die empfangende Instanz
den neuen Schlüssel zurückstellen statt ihn zu verwerfen: das Gegenüber liefert ihn erneut, bis der
Unterzeichner dort bestätigt oder zurückgewiesen ist.

#### Scenario: Gegengezeichneter Schlüssel
- **WHEN** Admin B einen Schlüssel registriert, Admin A ihn mit seinem Unterschriftsschlüssel gegenzeichnet und der ELW sich meldet
- **THEN** führt der ELW den Schlüssel von B als „wartet auf Bestätigung“

#### Scenario: Wartender Schlüssel zählt nicht
- **WHEN** ein Schlüssel C, mit dem noch wartenden Schlüssel von B gegengezeichnet, am ELW ankommt
- **THEN** übernimmt der ELW C nicht, sondern stellt ihn zurück; nach der Bestätigung von B übernimmt er C bei der nächsten Meldung als „wartet auf Bestätigung“

#### Scenario: Gegenzeichnung nicht von B oder B zurückgewiesen
- **WHEN** die Gegenzeichnung von C nicht mit dem Schlüssel von B prüfbar ist oder B am ELW zurückgewiesen ist
- **THEN** verwirft der ELW C wie die Unterschrift eines unbekannten Schlüssels

#### Scenario: Hub schiebt einen fremden Schlüssel unter
- **WHEN** ein Hub einem ELW einen Schlüssel ohne gültige Gegenzeichnung eines dem ELW bekannten Schlüssels liefert
- **THEN** verwirft der ELW ihn und zeigt „ungültiger Unterschriftsschlüssel vom Gegenüber abgelehnt“ in der Kopplung und in der Admin-Spur

#### Scenario: Erster Schlüssel der Org
- **WHEN** ein Admin den ersten Unterschriftsschlüssel einer Org registriert
- **THEN** gilt er an seiner Instanz ohne Gegenzeichnung, weil noch keine Kopplung der Org besteht

### Requirement: Widerruf eines Unterschriftsschlüssels

Ein Admin SHALL eigene Unterschriftsschlüssel und die anderer Admins seiner Org widerrufen können;
wird ein Admin-Konto deaktiviert oder verliert es die Admin-Rolle, MUST das System seine
Unterschriftsschlüssel widerrufen, auch den letzten gültigen einer gekoppelten Org. Eine
gekoppelte Instanz MUST einen Widerruf vom Gegenüber ohne Gegenzeichnung und ohne Bestätigung
annehmen, auch für einen wartenden Schlüssel. Den letzten gültigen Schlüssel einer gekoppelten
Org MUST ein Admin nicht einzeln widerrufen können, solange keine Kopplung der Org widerrufen
ist. Bevor ein Deaktivieren oder Herabstufen den letzten gültigen Schlüssel widerruft, MUST die
Benutzerverwaltung davor warnen; danach MUST die Kopplung zeigen, dass die Org neu gekoppelt
werden muss.

#### Scenario: Widerruf erreicht den ELW
- **WHEN** der Hub den Schlüssel von Admin B widerruft und der ELW sich meldet
- **THEN** zeigt der ELW den Schlüssel als widerrufen und nimmt keine Unterschrift damit mehr an

#### Scenario: Letzter Schlüssel
- **WHEN** ein Admin den einzigen gültigen Unterschriftsschlüssel einer Org mit bestehender Kopplung widerrufen will
- **THEN** antwortet der Server mit 409 und nennt die Kopplungen

#### Scenario: Deaktivieren hat Vorrang
- **WHEN** ein Admin das Konto von Admin A deaktiviert, das den einzigen gültigen Schlüssel der gekoppelten Org hält
- **THEN** warnt die Benutzerverwaltung vorher, dass die Org danach neu gekoppelt werden muss
- **AND** nach dem Bestätigen ist das Konto deaktiviert, der Schlüssel widerrufen, und die Kopplung zeigt „Kein gültiger Unterschriftsschlüssel mehr: Kopplung widerrufen und neu koppeln“

### Requirement: Unterschrift über eine vorgegebene Erklärung prüfen

Das System SHALL eine Passkey-Unterschrift prüfen können, deren Challenge der Hash einer
vorgegebenen Erklärung ist, auch wenn der Passkey an einer anderen Instanz registriert wurde. Die
Prüfung MUST Challenge, Herkunft der registrierenden Instanz, Nutzerpräsenz und
Nutzerverifikation sowie die Signatur gegen einen gültigen Unterschriftsschlüssel der Org
verlangen.

#### Scenario: Gegenzeichnung am Hub geprüft am ELW
- **WHEN** der ELW eine Gegenzeichnung erhält, die Admin A am Hub über den Hash des neuen Schlüssels geleistet hat
- **THEN** erkennt der ELW sie als gültig

#### Scenario: Andere Erklärung
- **WHEN** eine gültige Unterschrift über eine Erklärung X einer Erklärung Y beigelegt wird
- **THEN** erkennt die prüfende Instanz sie als ungültig

### Requirement: Aktionen an Unterschriftsschlüsseln landen in der Admin-Spur

Registrieren, Gegenzeichnen, Bestätigen, Ablehnen und Widerrufen eines Unterschriftsschlüssels
sowie das Verwerfen eines vom Gegenüber gelieferten Schlüssels SHALL je einen Eintrag in der
Admin-Spur der Org schreiben.

#### Scenario: Registrieren in der Spur
- **WHEN** ein Admin einen Unterschriftsschlüssel registriert
- **THEN** zeigt die Admin-Spur „Unterschriftsschlüssel registriert“ mit Fingerabdruck

#### Scenario: Bestätigen in der Spur
- **WHEN** ein Admin am ELW einen wartenden Schlüssel bestätigt
- **THEN** zeigt die Admin-Spur „Unterschriftsschlüssel bestätigt“ mit Fingerabdruck, Inhaber und Kopplung

### Requirement: Bestätigung eines neuen Schlüssels vom Gegenüber

Ein Admin der übernehmenden Instanz SHALL einen wartenden Schlüssel seiner Org bestätigen oder
ablehnen können, ohne eigenen Unterschriftsschlüssel. Das System MUST vorher Fingerabdruck,
Inhaber, Unterzeichner und Zeitpunkt zeigen. Bestätigen MUST die letzten vier Zeichen des
Fingerabdrucks verlangen; passen sie nicht, antwortet der Server mit 422. Ein abgelehnter
Schlüssel MUST NOT wieder gültig werden. Der Grundstock beim Koppeln gilt ohne Bestätigung.

#### Scenario: Bestätigen mit dem Fingerabdruck
- **WHEN** der Schlüssel von B am ELW wartet und ein Admin dort die letzten vier Zeichen eingibt, die B ihm nennt
- **THEN** gilt der Schlüssel von B am ELW, und Unterschriften damit werden anerkannt

#### Scenario: Falsche Zeichen
- **WHEN** ein Admin beim Bestätigen vier Zeichen eingibt, die nicht zum Ende des Fingerabdrucks passen
- **THEN** antwortet der Server mit 422, und der Schlüssel wartet weiter

#### Scenario: Nicht wartender Schlüssel
- **WHEN** ein Admin einen schon gültigen oder abgelehnten Schlüssel bestätigen will
- **THEN** antwortet der Server mit 422

#### Scenario: Ablehnen
- **WHEN** ein Admin am ELW einen wartenden Schlüssel ablehnt und der Hub ihn bei der nächsten Meldung erneut liefert
- **THEN** bleibt der Schlüssel am ELW abgelehnt

#### Scenario: Grundstock ohne Bestätigung
- **WHEN** ein ELW einen Code der Org einlöst, die zwei gültige Unterschriftsschlüssel hat
- **THEN** gelten beide am ELW sofort

#### Scenario: Hinweis an der Kopplung
- **WHEN** an einer Kopplung ein Schlüssel auf Bestätigung wartet
- **THEN** zeigt die Seite Instanzkopplung den Hinweis „1 neuer Unterschriftsschlüssel wartet auf Bestätigung“ mit dem Weg zum Bestätigen

### Requirement: Über eine Direktkopplung kennen beide Seiten die Schlüssel der Org

Über eine Direktkopplung SHALL jede Seite der anderen die gültigen Unterschriftsschlüssel der
zugeordneten Org liefern, die sie selbst als gültig führt: die hier registrierten und die von
einem Gegenüber übernommenen, nicht aber die, die sie über genau diese Kopplung bekommen hat, und
nicht die eines ELW, der sich bei ihr über eine Standardkopplung meldet. Was die ausstellende
Seite beim Koppeln schickt und was die meldende Seite bis zu dem Stand schickt, den sie mit ihrer
ersten Meldung nennt, auch einer ohne Schlüssel, MUST als Grundstock sofort gelten. Spätere
Neuzugänge MUST in beide Richtungen ohne Prüfung einer Gegenzeichnung auf die Bestätigung eines
Admins warten: Weitergereichte Schlüssel tragen nicht immer eine, und die meldende Seite zeichnet
ihre Schlüssel nicht gegen. Widerrufe MUST sie ebenso nachliefern. Felder über den Grenzen beim
Registrieren MUST die empfangende Seite ablehnen.

#### Scenario: Schlüssel des Hubs erreicht ELW 2 über ELW 1
- **WHEN** ELW 1 vom Hub den gültigen Schlüssel von Admin A kennt und ELW 2 nur über eine Direktkopplung mit ELW 1 gekoppelt ist
- **THEN** führt ELW 2 nach dem Koppeln den Schlüssel von Admin A als gültig, und eine Notübernahme, die Admin A an ELW 1 unterschreibt, erkennt ELW 2 als bewiesen an

#### Scenario: Schlüssel der meldenden Seite erreicht die erreichte Seite
- **WHEN** an ELW 2 Admin B schon vor dem Koppeln einen Schlüssel registriert hat und ELW 2 dann den Code von ELW 1 einlöst
- **THEN** führt ELW 1 nach der ersten Meldung von ELW 2 den Schlüssel von B als gültig

#### Scenario: Neuer Schlüssel an der meldenden Seite später
- **WHEN** nach der ersten Meldung an ELW 2 Admin C einen Schlüssel registriert und ELW 2 sich bei ELW 1 meldet
- **THEN** führt ELW 1 den Schlüssel von C als „wartet auf Bestätigung“

#### Scenario: Neuer Schlüssel des Hubs später
- **WHEN** nach dem Koppeln am Hub der Schlüssel von Admin C gegengezeichnet wird und ELW 1 ihn als gültig bestätigt hat
- **THEN** liefert ELW 1 ihn an ELW 2, und dort wartet er auf die Bestätigung eines Admins

### Requirement: Der ELW liefert seine Schlüssel dem Hub zur Bestätigung

Über eine Standardkopplung SHALL die meldende Seite der erreichten Seite die Unterschriftsschlüssel
liefern, die bei ihr registriert sind, samt Widerrufen. Die erreichte Seite MUST jeden davon ohne
Gegenzeichnung als „wartet auf Bestätigung“ führen, auch den ersten; erst die Bestätigung eines
Admins dort mit den letzten vier Zeichen des Fingerabdrucks macht ihn gültig. Die erreichte Seite
MUST solche Schlüssel nicht weiterliefern.

#### Scenario: Schlüssel eines ELW-Admins am Hub
- **WHEN** Admin B an ELW 2 einen Unterschriftsschlüssel registriert und ELW 2 sich beim Hub meldet
- **THEN** zeigt der Hub den Schlüssel von B als „wartet auf Bestätigung“, und erst nach der Bestätigung dort erkennt der Hub eine Unterschrift von B an

#### Scenario: Widerruf am ELW
- **WHEN** der Schlüssel von B am Hub gilt und ELW 2 ihn widerruft
- **THEN** führt der Hub ihn nach der nächsten Meldung von ELW 2 als widerrufen

### Requirement: Ein Widerruf gilt für den Schlüssel, nicht für die Lieferung

Widerruft eine Instanz einen Schlüssel selbst oder erfährt sie den Widerruf von dem Gegenüber, über
das der Schlüssel hier gültig war, MUST sie jede übernommene Zeile mit derselben Credential-ID in
dieser Org als widerrufen führen; maßgeblich ist die Credential-ID der hier gespeicherten Zeile.
Ein widerrufener oder hier zurückgewiesener Schlüssel MUST NOT über eine andere Kopplung wieder
gültig werden. Das Ende einer Org-Zuordnung widerruft deren Schlüssel nur für diese Zuordnung; ein
späteres Koppeln nimmt sie wieder an. Eine Lieferung, die eine hier schon vergebene Credential-ID
mit einem anderen Schlüssel nennt, MUST abgelehnt werden.

#### Scenario: Widerruf am Hub, Schlüssel auch vor Ort bekannt
- **WHEN** ELW 1 den Schlüssel von Admin A vom Hub und zusätzlich über die Direktkopplung von ELW 2 kennt und der Hub ihn widerruft
- **THEN** führt ELW 1 nach der nächsten Meldung beim Hub beide Zeilen als widerrufen und erkennt keine Unterschrift mit diesem Schlüssel mehr an

### Requirement: Schlüssel und Widerrufe überstehen das Zurückspielen einer Sicherung

Nach dem Zurückspielen einer Instanz aus einer Sicherung SHALL jeder danach gegengezeichnete oder
widerrufene Schlüssel das Gegenüber ohne Eingriff mit den nächsten Meldungen erreichen, auch bei
nachgehender Uhr. Ausgenommen: Die Seite vergibt bei nachgehender Uhr vor der ersten Meldung
mindestens so viele Stände, wie verloren gingen, oder ihre Uhr läuft bis dahin über die verlorenen
Stände; eine zweite Gegenstelle hatte weiter übernommen als die zuerst meldende.

#### Scenario: Hub zurückgespielt, neuer Schlüssel
- **WHEN** der Hub aus einer Sicherung zurückgespielt wird, danach Admin C einen Unterschriftsschlüssel registriert, Admin A ihn gegenzeichnet und der ELW sich meldet
- **THEN** führt der ELW den Schlüssel von C als „wartet auf Bestätigung“

#### Scenario: Hub zurückgespielt, Widerruf
- **WHEN** der Hub aus einer Sicherung zurückgespielt wird, danach den Schlüssel von Admin B widerruft und der ELW sich meldet
- **THEN** zeigt der ELW den Schlüssel von B als widerrufen und nimmt keine Unterschrift damit mehr an

#### Scenario: Zurückgespielter Hub mit nachgehender Uhr
- **WHEN** der Hub zurückgespielt wird, seine Uhr hinter dem Zeitpunkt der verlorenen Stände steht, er danach einen Schlüssel widerruft und der ELW sich meldet
- **THEN** zeigt der ELW den Schlüssel nach den nächsten Meldungen als widerrufen, und die Seite „Instanzkopplung“ am Hub zeigt den Hinweis, dass die Schlüssel der Org erneut gehen

#### Scenario: ELW zurückgespielt
- **WHEN** der ELW aus einer Sicherung zurückgespielt wird, die einen inzwischen nachgelieferten Schlüssel noch nicht kannte, und sich meldet
- **THEN** führt der ELW diesen Schlüssel wieder, als „wartet auf Bestätigung“

### Requirement: Ein anderer Schlüssel unter bekannter Kennung ersetzt den alten

Liefert das Gegenüber unter einer Kennung, die die empfangende Instanz schon einem Schlüssel
zugeordnet hat, einen anderen Schlüssel, SHALL die empfangende Instanz den bisherigen als
widerrufen führen. Den gelieferten MUST sie wie jeden neuen Schlüssel prüfen und übernehmen.
Ein zurückgewiesener bisheriger Schlüssel MUST zurückgewiesen bleiben.

#### Scenario: Zurückgespielter Hub vergibt eine Kennung neu
- **WHEN** der Hub zurückgespielt wird, der ELW den danach verlorenen Schlüssel von B schon kannte und der Hub dem neuen, von A gegengezeichneten Schlüssel von C dieselbe Kennung gibt
- **THEN** zeigt der ELW nach seiner nächsten Meldung den Schlüssel von B als widerrufen und den von C als „wartet auf Bestätigung“

#### Scenario: Ersatz ohne gültige Gegenzeichnung
- **WHEN** das Gegenüber unter der Kennung eines bekannten Schlüssels einen anderen Schlüssel ohne gültige Gegenzeichnung liefert
- **THEN** führt der ELW den bisherigen als widerrufen und verwirft den gelieferten wie die Unterschrift eines unbekannten Schlüssels

### Requirement: Ein Schlüssel, den die Quelle nicht mehr führt, gilt nicht mehr

Mit jeder Antwort, die die Nachlieferung der Schlüssel einer Org vollständig trägt, SHALL die
erreichte Seite die Liste ihrer gültigen Unterschriftsschlüssel dieser Org schicken. Ein Schlüssel
aus dieser Zuordnung, der an der meldenden Seite gültig ist oder auf Bestätigung wartet und in der
Liste fehlt, MUST dort als widerrufen gelten. Das MUST in der Admin-Spur und als Hinweis an der
Kopplung stehen. Schickt die erreichte Seite keine Liste, MUST die meldende Seite nichts
widerrufen. Über eine Direktkopplung MUST die Liste auch die Schlüssel nennen, die die erreichte
Seite weiterreicht (LLH-1678).

#### Scenario: Hub verliert einen Schlüssel mit der Sicherung
- **WHEN** der Hub einen neuen Unterschriftsschlüssel von Admin C an den ELW geliefert hat, danach aus einer Sicherung von vorher zurückgespielt wird und der ELW sich meldet
- **THEN** zeigt der ELW den Schlüssel von Admin C als widerrufen und nimmt keine Unterschrift damit mehr an
- **AND** die Admin-Spur des ELW nennt den Widerruf mit dem Hub als Auslöser, und die Kopplung zeigt einen Hinweis darauf

#### Scenario: Wartender Schlüssel
- **WHEN** der ELW einen Schlüssel vom Hub noch nicht bestätigt hat und der Hub ihn mit einer Sicherung verliert
- **THEN** gilt der Schlüssel am ELW nach der nächsten Meldung als widerrufen und kann dort nicht mehr bestätigt werden

#### Scenario: Ein abgelehnter Schlüssel bleibt abgelehnt
- **WHEN** ein Admin am ELW einen Schlüssel vom Hub zurückgewiesen hat und der Hub ihn nicht mehr führt
- **THEN** bleibt der Schlüssel am ELW zurückgewiesen

#### Scenario: Nachlieferung über mehrere Seiten
- **WHEN** der Hub einen Schlüssel widerruft und die Nachlieferung bis zu diesem Widerruf mehr als eine Antwort braucht
- **THEN** gilt der Schlüssel am ELW erst mit der Antwort als widerrufen, die den Widerruf trägt, und weder Hinweis noch Admin-Spur nennen ihn als nicht mehr geführt

#### Scenario: Gegenstelle älteren Stands
- **WHEN** der Hub die Liste nicht schickt, weil er einen älteren Stand hat
- **THEN** widerruft der ELW keinen Schlüssel aus dieser Zuordnung, und die Nachlieferung läuft wie bisher

#### Scenario: Weitergereichter Schlüssel über eine Direktkopplung
- **WHEN** ELW 1 den gültigen Schlüssel von Admin A vom Hub kennt, ihn über eine Direktkopplung an ELW 2 weitergereicht hat und ELW 2 sich bei ELW 1 meldet
- **THEN** nennt die Liste von ELW 1 den Schlüssel von Admin A, und er gilt an ELW 2 weiter
