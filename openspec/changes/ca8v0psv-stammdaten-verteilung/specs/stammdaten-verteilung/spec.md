# Spec Delta

## Purpose

Die Stammdaten einer Organisation gelangen von der erreichten zur meldenden gekoppelten Instanz,
etwa vom Hub zum ELW. Dort darf nur die Quelle sie ändern, während Ergänzungen vor Ort möglich
bleiben. Konten kommen so an, dass man sich auch ohne Netz anmelden kann, und ihre Geheimnisse
sind dabei geschützt.

## ADDED Requirements

### Requirement: Stammdaten fließen von der erreichten zur meldenden Seite

Für jede aktive Org-Zuordnung einer Kopplung SHALL die erreichte Seite der meldenden Seite die
Stammdaten der zugeordneten Org liefern. Dazu gehören Konten, Org-Einstellungen,
Modul-Einstellungen, Führungsfunktionen, Fahrzeuge, Personal, Qualifikationen, Material,
Fahrzeug- und Personal-Status, Einheit-Typen und Einheiten-Vorlagen. Die meldende Seite MUST sie
in der lokal zugeordneten Org ablegen. Die erreichte Seite MUST NOT Stammdaten der meldenden
Seite übernehmen. Eine lokale Org MUST Stammdaten aus höchstens einer Kopplung beziehen.

#### Scenario: Grundstock mit der ersten Meldung
- **WHEN** ein ELW frisch mit der Org „DRK KV Nord“ am Hub gekoppelt ist und sich zum ersten Mal meldet
- **THEN** liefert die Antwort Stammdaten der Org ab Stand 0, und der ELW zeigt danach die Fahrzeuge und Konten des Hubs

#### Scenario: Zweite Quelle für dieselbe Org
- **WHEN** die lokale Org eines ELW schon Stammdaten aus einer Kopplung bezieht und eine zweite Kopplung dieselbe Org zuordnet
- **THEN** übernimmt der ELW aus der zweiten Kopplung keine Stammdaten, und an der zweiten Kopplung steht ein Hinweis

### Requirement: Änderungen werden lückenlos nachgeliefert

Jede Änderung an einer verteilten Stammdatenzeile SHALL einen Stand der Org erhöhen: Anlegen,
Ändern, weiches und hartes Löschen, auch an Unterlisten wie Qualifikationen einer Person. Das gilt
unabhängig davon, welcher Schreibweg sie auslöst. Die meldende Seite MUST je Org ihren
übernommenen Stand melden, und die Antwort MUST den aktuellen Inhalt jeder seither geänderten
Zeile tragen, eine gelöschte als Löschung. Eine Antwort MUST höchstens eine feste Zahl von Zeilen
tragen; der Rest MUST mit den folgenden Meldungen kommen, und der übernommene Stand MUST nur bis
zur letzten gelieferten Änderung steigen.

#### Scenario: Geändertes Fahrzeug
- **WHEN** ein Admin am Hub den Funkrufnamen eines verteilten Fahrzeugs ändert
- **THEN** zeigt der ELW nach seiner nächsten Meldung den neuen Funkrufnamen

#### Scenario: Hart gelöschte Zeile
- **WHEN** am Hub eine Zeile hart gelöscht wird, die der ELW übernommen hat
- **THEN** entfernt der ELW sie mit der nächsten Meldung, oder er deaktiviert sie, wenn Einsatzdaten auf sie zeigen

#### Scenario: Mehr Änderungen als eine Antwort trägt
- **WHEN** seit dem gemeldeten Stand mehr Zeilen geändert wurden, als eine Antwort tragen darf
- **THEN** trägt die Antwort die ältesten Änderungen bis zur Grenze, und die folgenden Meldungen holen den Rest

### Requirement: Übernommene Zeilen sind an der meldenden Seite nur lesbar

An der meldenden Seite MUST jeder Schreibversuch auf eine übernommene Zeile oder deren Unterlisten
mit 409 und dem Text „Wird am Hub gepflegt“ enden. Das gilt für jede Route und jeden Schreibweg.
Nur die Übernahme einer Lieferung SHALL sie ändern. Bei Konten MUST Folgendes lokal änderbar
bleiben: das Passwort nach einem Einmalpasswort, die eigene TOTP- und Passkey-Einrichtung sowie
Zähler und Sperren der Anmeldung. Die Oberfläche SHALL übernommene Zeilen mit „vom Hub“
kennzeichnen und ihre Bearbeitung sperren.

#### Scenario: Übernommenes Fahrzeug bearbeiten
- **WHEN** ein Admin am ELW ein vom Hub übernommenes Fahrzeug ändern will
- **THEN** ist die Bearbeitung in der Oberfläche gesperrt, und ein direkter Aufruf der Schreibroute endet mit 409 „Wird am Hub gepflegt“

#### Scenario: Nach dem Widerruf
- **WHEN** die Org-Zuordnung, aus der die Zeilen stammen, an einer Seite widerrufen wird
- **THEN** gehören die übernommenen Zeilen danach dem ELW, sind wieder bearbeitbar und tragen kein Abzeichen mehr

#### Scenario: Passkey am ELW einrichten
- **WHEN** eine Person mit übernommenem Konto am ELW einen Passkey registriert
- **THEN** gelingt das, und der Passkey gilt nur an diesem ELW

### Requirement: Ergänzungen vor Ort gelten sofort

Eine Zeile, die an der meldenden Seite in einer Org mit Stammdaten-Quelle angelegt wird, SHALL
sofort gelten und in der Oberfläche „nur hier“ tragen. Die Quelle MUST NOT davon erfahren, bis ein
Antragsweg dafür besteht. Eine lokale Ergänzung MUST bearbeitbar bleiben.

#### Scenario: Geliehenes Fahrzeug
- **WHEN** ein Admin am ELW ein geliehenes Fahrzeug anlegt
- **THEN** steht es sofort zur Verfügung, trägt „nur hier“ und erscheint nicht am Hub

### Requirement: Der erste Abgleich führt Gleiches zusammen, Konten nie

Kommt eine Zeile zum ersten Mal an, SHALL die meldende Seite eine lokale Zeile derselben Art und
desselben natürlichen Schlüssels übernehmen: Funkrufname bei Fahrzeugen, Personalnummer bei
Personal, Bestandsnummer bei Material, Name bei Einheiten-Vorlagen, Bezeichnung bei Katalogen,
Schlüssel bei Führungs- und Modul-Einstellungen. Der Inhalt der Quelle MUST die lokale Zeile
überschreiben. Konten MUST NOT zusammengeführt werden. Ist der Benutzername eines gelieferten
Kontos lokal schon vergeben, MUST das Konto nicht übernommen werden, und die Kopplung MUST einen
Hinweis mit dem Namen zeigen, bis der Konflikt gelöst ist.

#### Scenario: Gleiches Fahrzeug vorher angelegt
- **WHEN** der ELW vor dem Koppeln ein Fahrzeug „Rotkreuz Nord 1/83-1“ hatte und der Hub ein Fahrzeug mit demselben Funkrufnamen liefert
- **THEN** gibt es am ELW danach genau ein solches Fahrzeug, es trägt die Daten des Hubs und gilt als „vom Hub“, und Einsatzdaten, die auf das alte zeigten, zeigen weiter darauf

#### Scenario: Gleicher Kontoname
- **WHEN** der ELW ein lokales Konto „admin“ hat und der Hub ein Konto „admin“ liefert
- **THEN** bleibt das lokale Konto unverändert, das Hub-Konto kommt nicht an, und die Kopplung zeigt „Konto ‚admin‘ ist hier schon vergeben“

### Requirement: Konten kommen mit Geheimnissen nur geschützt an

Ein geliefertes Konto SHALL Name, Anzeigename, Rollen und Aktivität tragen. Passwort-Hash und
TOTP-Geheimnis MUST nur mitkommen, wenn die meldende Seite bestätigt hat, dass ihr Datenträger
verschlüsselt ist, und einen Empfängerschlüssel genannt hat. Sie MUST dann für genau diesen
Empfänger Ende-zu-Ende verschlüsselt sein. Andernfalls MUST das Konto ohne Geheimnisse ankommen;
eine Anmeldung damit ist erst nach einem Einmalpasswort des dortigen Admins möglich, und die
Kopplung MUST zeigen, dass keine Geheimnisse verteilt werden. Die erreichte Seite MUST je Kopplung
festhalten, wessen Geheimnisse sie geliefert hat. Passkeys und SSO-Verknüpfungen MUST NOT verteilt
werden. Wird ein Konto an der Quelle deaktiviert, MUST die meldende Seite es deaktivieren und
seine Sitzungen beenden.

#### Scenario: Anmeldung ohne Netz
- **WHEN** der ELW eine verschlüsselte Platte bestätigt, das Konto „max“ mit Passwort und TOTP übernommen hat und danach ohne Netz ist
- **THEN** meldet sich „max“ am ELW mit demselben Passwort und demselben TOTP-Code an wie am Hub

#### Scenario: Platte nicht bestätigt
- **WHEN** ein ELW ohne bestätigte Plattenverschlüsselung sich meldet
- **THEN** kommen Konten ohne Passwort-Hash und TOTP-Geheimnis an, und die Kopplung zeigt „Geheimnisse nicht verteilt: Datenträgerverschlüsselung nicht bestätigt“

#### Scenario: Mitgelesene Antwort
- **WHEN** jemand die Antwort an einen ELW mitliest, etwa mit einem gefälschten TLS-Zertifikat
- **THEN** sieht er weder Passwort-Hash noch TOTP-Geheimnis im Klartext

#### Scenario: Passwortwechsel am Hub
- **WHEN** „max“ sein Passwort am Hub ändert, nachdem ihm am ELW ein Einmalpasswort vergeben wurde
- **THEN** gilt am ELW nach der nächsten Meldung das neue Passwort vom Hub

### Requirement: System-Admins verteilen ihre Geheimnisse nur mit Passkey

Die erreichte Seite MUST Passwort-Hash und TOTP-Geheimnis eines System-Admin-Kontos nur liefern,
wenn das Konto dort einen Anmelde-Passkey hat. Ohne Passkey MUST das Konto ohne Geheimnisse
ankommen, und die Benutzerverwaltung der erreichten Seite MUST den Hinweis „Für die Anmeldung am
ELW zuerst einen Passkey einrichten“ zeigen.

#### Scenario: Admin ohne Passkey
- **WHEN** der Admin „anna“ am Hub keinen Anmelde-Passkey hat
- **THEN** kommt ihr Konto am ELW ohne Geheimnisse an

### Requirement: Ein verlorener ELW macht verteilte Geheimnisse wertlos

Ein Admin der erreichten Seite SHALL für eine Kopplung seiner Org „ELW verloren“ auslösen können.
Die Aktion MUST die Zuordnung seiner Org widerrufen. Für jedes Konto seiner Org, dessen
Geheimnisse an diese Kopplung geliefert wurden, MUST das Passwort ungültig werden, der zweite
Faktor zurückgesetzt sein und jede Sitzung beendet sein. Das alte Passwort MUST NOT mehr zu einer
Sitzung oder zu einem Passwortwechsel führen. Wieder hinein kommt die Person per Passkey oder mit
einem Einmalpasswort eines Admins. Die Aktion MUST genau einen Eintrag in der Admin-Spur
schreiben, mit der Zahl der betroffenen Konten.

#### Scenario: ELW gestohlen
- **WHEN** der Admin am Hub für den ELW „ELW 1“ „ELW verloren“ auslöst und dorthin die Geheimnisse von „max“ und „anna“ gingen
- **THEN** ist die Kopplung widerrufen, die Sitzungen von „max“ und „anna“ sind beendet, und beide haben weder ein gültiges Passwort noch TOTP

#### Scenario: Altes Passwort am Hub
- **WHEN** nach „ELW verloren“ jemand das alte Passwort von „max“ am Hub benutzt
- **THEN** scheitert die Anmeldung wie mit einem falschen Passwort

#### Scenario: Zurück per Einmalpasswort
- **WHEN** ein Admin für „max“ danach ein Einmalpasswort vergibt
- **THEN** meldet sich „max“ damit an, legt ein eigenes Passwort fest und kann TOTP neu einrichten
