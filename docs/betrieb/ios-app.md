# Betrieb: iOS-App (iPhone, iPad)

Die iOS-App „Lifeline“ ist eine **Hülle** um die Webanwendung (LLH-1978,
[ADR-0068](../architektur/entscheidungen/ADR-0068-die-ios-huelle-ist-eine-eigene-swift-app-ohne-anwendungslogik-die-die-serveroberflaeche-laedt.md)).
Sie lädt die https-Adresse des Einsatzservers in einen Webview, wie die
[Desktop-App](desktop-app.md). Anwendung, Daten und Anmeldung liegen auf dem Server. Die Hülle
bringt das Onboarding, eine Serverliste mit einem eigenen Datenspeicher je Server, native
Status-Seiten, die Anmeldung im Systembrowser, Downloads mit dem Teilen-Blatt, Drucken, die
Meldung bei offener App, Meldungen bei geschlossener App über Apple Push (siehe „Meldungen im
Hintergrund“), die Zahl am App-Symbol und Haptik mit.

Anforderungen: Specs `ios-huelle`, `huellen-vertrag` und `ios-auslieferung`, für den Push
[ADR-0082](../architektur/entscheidungen/ADR-0082-ios-push-laeuft-ueber-ein-relais-mit-ende-zu-ende-verschluesselter-nutzlast.md).
Quellcode und Regeln: `ios/` ([`ios/AGENTS.md`](../../ios/AGENTS.md)). Herleitung: `design.md`
der Change `t39ltxxi-ios-huelle`, für den Push
`docs/superpowers/specs/2026-11-22-mbbk7iwo-ios-apns-alarme-design.md`.

## Bezug und Installation (TestFlight)

Die App gibt es nur über **TestFlight**, nicht im App Store. Sie läuft auf iPhone und iPad ab
iOS bzw. iPadOS 17.4.

1. Eine Person mit Zugang zu App Store Connect lädt die Testerin oder den Tester ein: unter
   „TestFlight“ in die Gruppe **„Intern“** (nur Mitglieder des Teams in App Store Connect, bekommt
   jeden Kanal samt Alpha) oder in die Gruppe **„Extern“** (beliebige Apple-Accounts, bekommt nur
   Beta und stabil). Den ersten Build einer neuen Version für externe Tester prüft Apple vorher
   (Beta-App-Review).
2. Auf dem Gerät die App **TestFlight** aus dem App Store laden und die Einladung (Mail oder
   öffentlicher Link) annehmen.
3. In TestFlight „Lifeline“ installieren. Neue Builds bietet TestFlight selbst an; „Automatische
   Updates“ lässt sich dort je App einschalten. Ein Build läuft in TestFlight nach 90 Tagen ab.

**Welche Stände kommen an** (LLH-1988,
[ADR-0080](../architektur/entscheidungen/ADR-0080-jeder-freigegebene-tag-geht-zu-testflight-und-alpha-nur-an-die-interne-gruppe.md)):

| Kanal | Tag | Gruppen |
|---|---|---|
| Alpha | `vX.Y.Z-alpha.N` | „Intern“ |
| Beta | `vX.Y.Z-beta.N` | „Intern“, „Extern“ (nach der Beta-Prüfung) |
| Stabil | `vX.Y.Z` | „Intern“, „Extern“ (nach der Beta-Prüfung) |

TestFlight zeigt die Version ohne Vorab-Suffix und dahinter die Build-Nummer, etwa
„1.0.0 (202611181200)“: Apple nimmt kein Suffix an. Welcher Kanal es ist, steht deshalb in der
ersten Zeile von „Was testen“ (`Lifeline 1.0.0-alpha.196`), darunter die Release-Notizen des Tags.
Die volle Version steht auch in der App unter Serverliste → Einstellungen → „Über“ und im
Onboarding unten. Die Build-Nummer ist der Zeitstempel des Uploads in UTC (`JJJJMMTTHHMM`,
`scripts/ios/version.sh`).

## Erster Start und Server

Ohne gespeicherten Server zeigt die App nur das Onboarding („Kein Server eingerichtet“). Drei
Wege:

- **Adresse eingeben**, zum Beispiel `https://elw.local:8443`. Angenommen wird nur `https` mit
  Hostnamen und ohne Name/Passwort vor „@“, auf keinem Port, den der Webview sperrt (etwa 6000);
  die Regeln und Meldungen sind dieselben wie in der Desktop-App (gemeinsame Fälle unter
  `src-tauri/faelle/`).
- **QR-Code scannen**: mit der Adresse oder mit dem Deeplink aus „Geräte verbinden“. Die App
  fragt dafür einmal nach der Kamera.
- **Deeplink** `lifeline://verbinden?server=<https-Adresse, URL-kodiert>` (Vertrag wie in der
  [Desktop-App](desktop-app.md#deeplink-geräte-verbinden-vertrag-für-lfh-38)): ein neuer Server
  belegt das Onboarding vor, ein bekannter anderer Server führt erst nach Rückfrage zum Wechsel,
  der aktive Server bewirkt nichts. Ein Link lenkt nie still auf einen anderen Server.

Vor dem Speichern fragt die App `GET /api/shell` des Servers ab und speichert ihn nur, wenn sie
dessen `shell_contract` kennt. Dieselbe Prüfung läuft bei jedem Start, Wechsel und bei der
Rückkehr in den Vordergrund (`ios/LifelineKern`, `Vertrag` und `Ablauf`). Beim Zugriff auf
`elw.local` fragt iOS einmal nach dem lokalen Netzwerk; ohne Zustimmung erreicht die App den
Server im Einsatz-LAN nicht.

**Serverliste:** der kleine Knopf am linken Rand öffnet sie. Dort lassen sich Server hinzufügen,
wechseln, umbenennen (Vorgabe ist der Hostname) und entfernen; der aktive Server erst nach einem
Wechsel. Jeder Server hat seinen **eigenen Datenspeicher** (Cookies, Anmeldung, Offline-Lagebild,
Warteschlange), Sitzungen zweier Server vermischen sich nicht. **Entfernen** löscht diesen
Speicher nach einer Rückfrage; noch nicht übertragene Einträge dieses Servers gehen dabei
verloren. Lässt sich der Speicher nicht löschen, bleibt der Server in der Liste, und die App
meldet den Fehler.

**Zur Oberfläche:** Fremde Seiten dürfen im Webview laufen, weil die Anmeldung beim
Identitätsanbieter dort stattfindet. Bleibt der Webview auf einer fremden Seite ohne Rücklink
stehen, führt „Zur Oberfläche“ oben in der Serverliste zurück: es lädt die Startseite des aktiven
Servers neu, ebenso ein Tipp auf den aktiven Server. Kehrt die App auf einer fremden Seite in den
Vordergrund zurück und läuft keine „Im Browser anmelden“-Sitzung, bleibt die Seite stehen, und
oben erscheint der Hinweis „Fremde Seite“ mit „Zur Oberfläche“; er verschwindet, sobald wieder
eine Seite des Servers geladen ist.

**Einstellungen** (aus der Serverliste): Schalter „Haptik“, Vorgabe an. Spürbar ist sie nur auf
dem iPhone.

### Status-Seiten

| Seite | Wann | Weiter |
|---|---|---|
| Server nicht erreichbar | der Server antwortet nicht (aus, falsche Adresse, kein Netz) | die App prüft alle 5 Sekunden weiter und lädt die Oberfläche, sobald er antwortet; „Erneut prüfen“, „Serverliste“ |
| Zertifikat nicht vertrauenswürdig | das Gerät vertraut dem Zertifikat des Servers nicht | Anleitung auf der Seite, siehe „CA-Profil für das Einsatz-LAN“ |
| App aktualisieren | der Server hat einen neueren Vertrag, als die App kennt | neuen Build über TestFlight installieren |
| Server ist zu alt für diese App | der Server antwortet auf `GET /api/shell` mit 404 oder mit JSON ohne lesbaren Vertrag, oder er hat einen älteren Vertrag | Server aktualisieren; die Seite nennt seine Version |

Texte: `ios/LifelineKern/Sources/LifelineKern/Statustext.swift`. Ohne Netz gilt der zuletzt
bestätigte Vertrag eines Servers. Ist die Oberfläche schon geladen und das Netz fällt weg, bleibt
sie stehen und arbeitet offline mit Lagebild und Warteschlange weiter; nur ein unverträglicher
Vertrag oder ein Zertifikatsfehler ersetzt sie durch die Status-Seite.

**Captive Portal und Auth-Proxy:** Die Prüfung folgt Weiterleitungen nur auf derselben Origin.
Leitet ein Hotel-WLAN oder ein vorgeschalteter Proxy auf eine eigene Seite um oder antwortet mit
HTML statt JSON, gilt das wie „ohne Verbindung“: der zuletzt bestätigte Vertrag bleibt, eine
geladene Oberfläche bleibt stehen, sonst erscheint „Server nicht erreichbar“. Erst nach der
Anmeldung im Portal (in Safari) erreicht die App den Server wieder.

## CA-Profil für das Einsatz-LAN

Die App prüft Zertifikate wie das System: ohne Ausnahme, ohne „Trotzdem fortfahren“ und ohne
Pinning (design.md, D2a). Ein Server mit öffentlichem Zertifikat (hinter einem Proxy mit Let's
Encrypt) braucht nichts. Ein Server im Einsatz-LAN braucht ein Zertifikat aus **mkcert oder einer
eigenen CA**, und jedes Gerät braucht deren Root-CA als eingeschaltetes Profil.

**Das selbst signierte Rückfall-Zertifikat taugt nicht.** Startet der Server mit `--tls` ohne
eigenes Paar und ohne `mkcert`, erzeugt er ein selbst signiertes Zertifikat
(`rcgen_pem` in `src/tls/mod.rs`, [betrieb-tls.md](../betrieb-tls.md#cert-beschaffung-präzedenz)).
Der Browser bietet dafür eine Ausnahme an, die App nicht: sie zeigt „Zertifikat nicht
vertrauenswürdig“. Vor dem Einsatz also auf dem Server-Rechner `mkcert` installieren (oder ein
eigenes Paar mit `--tls-cert`/`--tls-key` setzen) und den Hostnamen eintragen, unter dem die
Geräte den Server ansprechen, etwa `--tls-hostname elw.local`. Liegt schon ein Rückfall-Zertifikat
im Cache neben der Datenbank, die beiden Dateien `lifeline-tls-cert.pem` und
`lifeline-tls-key.pem` löschen und den Server neu starten.

Auf jedes iPhone und iPad:

1. Root-CA holen: auf dem Server-Rechner `mkcert -CAROOT` nennt das Verzeichnis, darin liegt
   `rootCA.pem` (bei einer eigenen CA deren Zertifikat). **Nie** `rootCA-key.pem` weitergeben.
2. Die Datei auf das Gerät bringen, per AirDrop, Mail oder Download in Safari. iOS meldet
   „Profil geladen“.
3. Einstellungen → Allgemein → VPN und Geräteverwaltung → das Profil → „Installieren“.
4. Einstellungen → Allgemein → Info → Zertifikatsvertrauenseinstellungen → für die CA „Volles
   Vertrauen“ einschalten. Ohne diesen Schritt gilt das Profil für TLS nicht.
5. Zurück in die App; die Status-Seite prüft beim Wechsel in den Vordergrund neu, sonst
   „Erneut prüfen“.

Die Root-CA kann für jeden Hostnamen Zertifikate ausstellen, denen das Gerät dann vertraut. Ihren
Schlüssel deshalb nur auf dem Server-Rechner lassen und das Profil von privaten Geräten wieder
entfernen, wenn sie nicht mehr im Einsatz-LAN arbeiten.

## Anmeldung

Ein Passkey scheitert im Webview der App (Passkeys gibt es dort nur für fest eingetragene
Domains, design.md Fakt 4). Die App meldet der Seite `passkey: false`; die Anmeldeseite bietet
stattdessen **„Im Browser anmelden“** an, wie die Mac-App ([desktop-app.md](desktop-app.md#im-browser-anmelden-macos-lfh-818)):

1. iOS öffnet ein Anmeldeblatt mit dem Server und fragt beim ersten Mal, ob die App ihn zum
   Anmelden verwenden darf.
2. Dort meldet man sich an, wie im Browser: Passwort, TOTP, SSO oder Passkey.
3. Die Seite „In der Lifeline-App anmelden als …“ nennt das Konto; „In der App anmelden“ übergibt
   die Anmeldung, das Blatt schließt sich.

Der Einmalcode ist an ein Geheimnis gebunden, das nur die App kennt, und der Rücksprung zählt nur
aus diesem Blatt; ein Link `lifeline://anmeldung` von außen bewirkt nichts. Im Zugangsprotokoll
steht die Anmeldung mit dem Anbieter `systembrowser` („Lifeline-App“). Einen Passkey richtet man
im Browser ein, nicht in der App.

## Links, Dateien, Drucken, Meldungen

- **Links** folgen den Regeln der Desktop-App (gemeinsame Fälle): eigene Seiten bleiben in der
  App, auch „in neuem Tab öffnen“; fremde Websites, `mailto:` und `tel:` öffnet iOS in der
  zuständigen App.
- **Dateien vom eigenen Server** (Adressen unter `/api/` außer `/api/auth/`, CSV-Exporte) lädt
  die App und bietet sie im **Teilen-Blatt** an („In Dateien sichern“, AirDrop, Mail).
- **Drucken** öffnet den Druckdialog von iOS (AirPrint).
- **Rückfragen der Seite** (etwa „Tier löschen?“, ein Feldkonflikt) erscheinen als Dialog von iOS.
  Der Titel nennt, wer fragt: die Adresse des Servers oder, bei einer fremden Seite wie dem
  Anmeldedienst, deren Adresse.
- **Meldungen und Zahl am App-Symbol:** Bei laufender App zeigt sie eine Benachrichtigung als
  Mitteilung des Systems und setzt die Zahl der ungelesenen Eingänge am Symbol; bei geschlossener
  App kommen Meldungen nur über den Push („Meldungen im Hintergrund“), die Zahl am Symbol nicht.
  iOS fragt beim ersten Mal nach der Erlaubnis, auch wenn zuerst eine Zahl kommt (nur das
  Entfernen der Zahl fragt nie); ändern unter Einstellungen → Mitteilungen → „Lifeline“.
- **Haptik:** beim Speichern einer Erfassung, bei einem eingehenden Alarm und beim Wechsel eines
  Segments, nur auf dem iPhone und nur mit eingeschaltetem Schalter.

## Meldungen im Hintergrund

iOS hält die App kurz nach dem Wechsel in den Hintergrund an; der Live-Kanal ruht, und Web Push
gibt es im Webview nicht (Service Worker laufen im Webview einer App nicht). Benachrichtigungen
und Alarme erreichen ein iPhone mit geschlossener, verdeckter oder beendeter App deshalb über
Apples Push-Dienst (APNs) und das Push-Relais des Projekts (LLH-1981,
[push-relais.md](push-relais.md)). Voraussetzungen:

1. Der Betreiber des Servers schaltet `LIFELINE_IOS_PUSH=true` (`--ios-push`) ein
   ([env-registry.md](env-registry.md)). Der Server braucht ausgehend HTTPS zum Relais
   (`https://push.rubeen.dev`, anders mit `LIFELINE_IOS_PUSH_RELAIS`) und meldet sich dort beim
   ersten Versand selbst an. `--web-push` ist dafür nicht nötig.
2. Die Person schaltet in der App unter Benutzermenü → „Benachrichtigungen“ → „Dieses Gerät“ den
   Schalter „Auch bei geschlossener App“ ein und erlaubt die Mitteilungen, für jeden Server in der
   App einzeln (Anwenderdoku, Kapitel „Einsatz auswählen und Oberfläche“).
3. Die Mitteilungen für „Lifeline“ bleiben in den iOS-Einstellungen erlaubt; verweigert, zeigt der
   Schalter „In den iOS-Einstellungen verweigert“.

Was ankommt:

- Dieselben Regeln wie bei Web Push: ein Alarm immer, ein Hinweis nicht, wenn seine Art auf dem
  Gerät stumm ist; eine Meldung gilt 12 Stunden. Alarme sind zeitkritisch und kommen durch einen
  Fokus, sofern das für die App nicht abgeschaltet ist. Bei stummgeschaltetem iPhone klingen sie
  nicht: kritische Warnungen gibt es nicht.
- Titel und Detail wie im Browser, mit „Mit Absender und Wortlaut“ dazu Absender und der Anfang
  des Wortlauts. Den Inhalt verschlüsselt der Server für das Gerät; Relais und Apple sehen
  Gerätetoken, Stufe und Zeitpunkt, nicht den Inhalt. Entschlüsselt wird auf dem Gerät (Extension
  „Benachrichtigungsdienst“). Gelingt das nicht, steht nur „Alarm“ bzw. „Neue Benachrichtigung“
  mit „Öffnen, um die Meldung zu sehen“.
- Mit mehr als einem Server in der App nennt die Meldung den Server.
- Tippen öffnet den Server der Meldung und dort ihre Seite; war ein anderer Server aktiv, wechselt
  die App sichtbar dorthin wie in der Serverliste. Läuft gerade die gespeicherte Oberfläche ohne
  Server (siehe „Daten auf dem Gerät“), prüft die App erst den Server; antwortet er nicht, bleibt
  es bei der gespeicherten Oberfläche, ohne die Seite der Meldung.
- Ist die App offen und zeigt den Server der Meldung, erscheint kein zweites Banner; die
  Oberfläche meldet selbst. Die gespeicherte Oberfläche ohne Server zählt nicht: ihr fehlt der
  Live-Kanal, das Banner erscheint.

Die Anmeldung hängt an Konto und Gerät, nicht an der Sitzung: anders als bei Web Push beenden der
Ablauf der Sitzung und ein Passwortwechsel sie nicht. Sie endet durch den Schalter, Abmelden in der
App, das Beenden der Anmeldung dieses Geräts unter Profil → „Anmeldungen“, „Alle anderen
beenden“ von einem anderen Gerät aus (trifft alle iOS-Anmeldungen der Person außer der des eigenen
Geräts, auch die, deren Sitzung längst abgelaufen ist: das verlorene Gerät), das Beenden aller
Anmeldungen der Person durch einen Admin, Deaktivieren des Kontos und Entfernen des Servers aus der
Serverliste. Beim Entfernen meldet die App das Gerät ohne Sitzung ab. Erreicht sie den Server dabei
nicht, merkt sie sich die Abmeldung samt Schlüssel und versucht sie bei jedem Start und jeder
Rückkehr in den Vordergrund einmal, bis der Server antwortet; bis dahin zeigen seine Meldungen nur
den Rückfalltitel.

Am gekoppelten ELW gilt dasselbe wie bei Web Push ([web-push.md](web-push.md), „Gekoppelter ELW“),
aber je Kanal: bietet der Hub iOS-Push an, kommen die Meldungen für Konten vom Hub über den Hub;
dafür den Hub als Server in der App hinzufügen und dort einschalten; die Seite
„Benachrichtigungen“ des ELW sagt das in der App so und nennt die Adresse des Hubs. Bietet er ihn
nicht an, pusht der ELW selbst.

## Daten auf dem Gerät

Die App hat keine eigene Datenbank. Was sie offline vorhält, liegt im Datenspeicher des
Webviews, je Server getrennt: Lagebild, Warteschlange und ETB-Entwürfe, wie im Browser. Einen
Service Worker gibt es im Webview nicht; dafür legt die App nach jedem Laden vom Server dessen
`index.html` ab (`Oberflaechen/<uuid>.json` in Application Support, gelöscht mit dem Server),
sobald jedes Asset im HTTP-Cache des Webviews liegt. Antwortet der Server beim Start nicht, lädt
sie diese unter seiner Adresse und startet so die Oberfläche ohne Server (LLH-1980,
[ADR-0082](../architektur/entscheidungen/ADR-0082-die-ios-huelle-startet-ohne-server-aus-gespeicherter-index-html-und-dem-http-cache.md));
nie bei einem Zertifikatsfehler oder einem unverträglichen Server. Kommt der Server mit derselben
Version zurück, arbeitet die Seite einfach weiter. Die
Serverliste liegt als `server.json` in Application Support der App. Ein Eintrag, dessen Adresse
die Prüfung inzwischen ablehnt (etwa auf einem gesperrten Port), fällt beim Laden heraus, die
übrigen bleiben; war er aktiv, wird der erste übrige aktiv. Ist die Datei aus einem anderen Grund
unlesbar, legt die App sie als `server.defekt.json` beiseite und beginnt leer. Der Schalter „Haptik“
liegt in den Einstellungen der App (`ios/LifelineKern/Sources/LifelineKern/Huellenhilfen.swift`).
Für den Push liegt neben der Serverliste `push.json` (welche Kennung zu welchem Server gehört), der
Schlüssel je Kennung im Schlüsselbund, den App und Extension teilen (lesbar nach dem ersten
Entsperren), und die Zahl der Server in den Einstellungen der App Group. Das Privacy-Manifest
(`ios/App/PrivacyInfo.xcprivacy`) erklärt dafür UserDefaults mit den Gründen CA92.1 und 1C8F.1,
kein Tracking und keine erhobenen Daten. Vorgaben für
Gerätecode, Sperre und Verlust: [endgeraete.md](endgeraete.md).

## Grenzen (offen)

- **Meldungen im Hintergrund nur mit Push** (siehe dort): ohne `--ios-push` am Server, ohne
  erreichbares Relais oder ohne Schalter auf dem Gerät erscheint eine Benachrichtigung erst, wenn
  die App wieder vorn ist. Kritische Warnungen (hörbar trotz Stummschaltung) gibt es nicht, und
  eine anderswo quittierte Meldung bleibt auf dem Sperrbildschirm stehen.
- **Kein Passkey im Webview:** Anmeldung über „Im Browser anmelden“ (siehe „Anmeldung“).
- **Start ohne Server nur mit vollem Cache** (LLH-1980): Räumt iOS den HTTP-Cache des Webviews,
  fährt die gespeicherte Oberfläche nicht hoch, und die App zeigt „Server nicht erreichbar“, bis
  der Server wieder antwortet.
- **iPad:** Die Sitzungsliste unter Profil → „Anmeldungen“ nennt ein iPad als Mac, weil sich sein
  Webview so meldet.
- **Nicht gemessen:** alles auf echten Geräten (Aufgabe 10.3 der Change): Onboarding mit
  `elw.local` und CA-Profil, zwei Server, Anmeldung mit Passkey, Haptik, Meldung, CSV-Export,
  Drucken, Start ohne Server, Push im Hintergrund (Gerätetest: [push-relais.md](push-relais.md), „Gerätetest“).
  Bisher belegt sind nur Simulator und Tests (`ios-pruefung.yml`).

## Release-Ablauf

- Server und App tragen dieselbe Version aus `[workspace.package]`; `ios/` hat keine eigene.
  `scripts/ios/version.sh` schreibt Marketing-Version, `LifelineVersion` und Build-Nummer.
- `.github/workflows/ios.yml` lädt hoch: aufgerufen aus `artefakte.yml` (Job `ios`, „iOS-App
  (TestFlight)“) **nach** der Freigabe jedes Tags der Kanäle `alpha`, `beta` und `main`. Der Job
  hält nichts auf: scheitert er, ist das Release trotzdem veröffentlicht, und der Fehler steht im
  Lauf von `artefakte.yml`. Den Upload trägt `scripts/ios/testflight.sh` (Version gegen den Tag
  prüfen, `xcodegen generate`, `xcodebuild archive`, Export mit Upload) im Job `testflight`.
- **Verteilen** (Job `verteilen`, auf Ubuntu, `scripts/ios/testflight-verteilen.mjs`): wartet bis
  zu 45 Minuten, bis Apple den Build verarbeitet hat, setzt „Was testen“, hängt ihn an die Gruppen
  des Kanals (Tabelle oben) und reicht ihn für „Extern“ zur Beta-Prüfung ein, sofern dafür noch
  keine läuft. Fehlt eine der beiden Gruppen, legt das Skript sie vor dem Warten an: „Intern“ als
  interne Gruppe, die nur zugewiesene Builds bekommt, „Extern“ ohne öffentlichen Link. Ist der Job
  rot, liegt der Build in TestFlight, ist aber nicht (vollständig) verteilt: den Handstart
  wiederholen oder in App Store Connect von Hand zuweisen.
- **Handstart** (auch zum Nachholen nach einer Störung bei Apple): Actions → „iOS-App
  (TestFlight)“ → „Run workflow“ mit dem Tag, etwa `v1.0.0-beta.3`. Andere Vorabkanäle (`-rc.1`)
  weist das Skript ab, ebenso Alpha-Tags von vor LLH-1988: der Lauf nutzt das Skript des Tags.
- **Vorab-Build** (Handstart mit „stand“): baut einen Branch oder Commit statt des Tags, etwa
  solange `alpha` rot ist und kein Release entsteht. Der Tag gibt dann nur Kanal und Gruppen vor
  und muss zur Workspace-Version dieses Stands passen; „Was testen“ nennt den Stand statt der
  Release-Notizen. Per Kommandozeile:
  `gh workflow run ios.yml --ref <branch> -f tag=v1.0.0-alpha.195 -f stand=<branch>`.
- **Xcode:** gebaut wird mit Xcode 26.6 auf dem Runner `macos-26` (`ios.yml`, `ios-pruefung.yml`).
  App Store Connect nimmt seit dem 28.04.2026 nur Builds mit Xcode 26 und dem iOS-26-SDK an und
  nie einen Build aus einer Beta von Xcode. Lokal hochladen geht deshalb nur mit einem
  freigegebenen Xcode, nicht mit einer Beta.
- Nach dem Upload verarbeitet Apple den Build (meist Minuten, selten länger); erst dann erscheint
  er in TestFlight. Externe Tester sehen ihn nach dem Beta-App-Review. Fehlen dafür die
  Testinformationen (siehe Übergaben), scheitert die Einreichung, und Apples Begründung steht im
  Job `verteilen`.
- Zwei Uploads derselben Minute trügen dieselbe Build-Nummer; Apple lehnt den zweiten ab. Dann
  den Lauf eine Minute später neu starten.
- Die Verschlüsselungsfrage beim Upload ist beantwortet (`ITSAppUsesNonExemptEncryption = false`
  in `ios/project.yml`): die App nutzt nur die Verschlüsselung des Systems (HTTPS, dazu CryptoKit
  für das Öffnen der Push-Meldungen).

## Signierung und Secrets

Signiert wird **automatisch** über einen App-Store-Connect-API-Schlüssel: `xcodebuild` mit
`-allowProvisioningUpdates` und `-authenticationKey*` holt Verteilzertifikat und Profil selbst
(cloud-verwaltet). Auf dem Runner liegt kein Zertifikat; der Schlüssel liegt nur während des
Laufs mit Rechten 600 in einem Wegwerf-Ordner.

| Secret (GitHub, Repository) | Inhalt |
|---|---|
| `APP_STORE_CONNECT_KEY_ID` | Schlüssel-ID des API-Schlüssels |
| `APP_STORE_CONNECT_ISSUER_ID` | Issuer-ID (App Store Connect → Benutzer und Zugriffsrechte → Integrationen) |
| `APP_STORE_CONNECT_KEY_P8` | Inhalt der `.p8`-Datei |

Fehlt eines davon, bricht der Lauf mit einer Meldung ab, die die fehlenden nennt. Der Schlüssel
der Notarisierung (`APPLE_API_*`, [desktop-app.md](desktop-app.md#signierung-und-notarisierung-macos))
hat nur die Rolle „Entwickler“ und reicht für den Upload nicht; deshalb ein eigener Schlüssel.
Setzen, ohne dass ein Wert im Terminal erscheint, die `.p8` nur über eine Datei:

```bash
gh secret set APP_STORE_CONNECT_KEY_ID
gh secret set APP_STORE_CONNECT_ISSUER_ID
gh secret set APP_STORE_CONNECT_KEY_P8 < AuthKey_<Schlüssel-ID>.p8
```

Die `.p8` lässt sich in App Store Connect nur einmal laden. Ablage wie die übrigen Schlüssel in
1Password, Tresor „Dev“.

## Übergaben (einmalig, Ruben)

Bevor der erste Upload gelingt (Aufgabe 10.1 der Change):

1. **Bundle-ID** `dev.rubeen.lifeline.ios` im Team `H95J852PKP` registrieren
   (developer.apple.com → Certificates, Identifiers & Profiles → Identifiers) mit den Fähigkeiten
   Push Notifications, Time Sensitive Notifications und App Groups; dazu die Bundle-ID
   `dev.rubeen.lifeline.ios.benachrichtigung` der Extension mit App Groups und die App Group
   `group.dev.rubeen.lifeline.ios` (LLH-1981). Den APNs-Schlüssel braucht nur das Relais
   ([push-relais.md](push-relais.md), „Apple-Schlüssel anlegen“).
2. **App in App Store Connect anlegen** (Meine Apps → „+“ → Neue App, Plattform iOS, diese
   Bundle-ID). Der Name in App Store Connect muss im App Store eindeutig sein; auf dem
   Home-Bildschirm steht unabhängig davon „Lifeline“ (`CFBundleDisplayName`).
3. **API-Schlüssel** anlegen (Benutzer und Zugriffsrechte → Integrationen → Team-Schlüssel) und die
   drei Secrets setzen. Der Entwurf sieht die Rolle **App Manager** vor. Berichte im Apple
   Developer Forum ([Thread 698117](https://developer.apple.com/forums/thread/698117)) nennen für
   den Export mit cloud-verwalteter Signierung nur Schlüssel mit der Rolle **Admin** als
   erfolgreich; ein App-Manager-Schlüssel scheitert dort mit „Cloud signing permission error“.
   Scheitert der erste Upload so, den Schlüssel mit der Rolle Admin neu anlegen.
4. **Tester einladen:** Die Gruppen „Intern“ und „Extern“ legt der erste Lauf von `verteilen` an.
   Danach in App Store Connect → TestFlight die Tester eintragen. Für „Extern“ zusätzlich unter
   „Testinformationen“ Beschreibung, Feedback-Mail und Kontakt ausfüllen, die Apple für das
   Beta-App-Review verlangt.
5. Der erste Upload läuft mit dem ersten Alpha-Tag nach LLH-1988.

**Kosten:** im Apple Developer Program enthalten (siehe
[desktop-app.md](desktop-app.md#signierung-und-notarisierung-macos), „Kosten und Termine“).
Läuft die Mitgliedschaft ab oder ist eine geänderte Lizenzvereinbarung nicht akzeptiert, lehnt
Apple jeden Upload ab; bereits installierte Builds laufen bis zu ihrem Ablauf in TestFlight weiter.
