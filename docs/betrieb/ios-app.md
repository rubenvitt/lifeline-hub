# Betrieb: iOS-App (iPhone, iPad)

Die iOS-App „Lifeline“ ist eine **Hülle** um die Webanwendung (LLH-1978,
[ADR-0066](../architektur/entscheidungen/ADR-0066-die-ios-huelle-ist-eine-eigene-swift-app-ohne-anwendungslogik-die-die-serveroberflaeche-laedt.md)).
Sie lädt die https-Adresse des Einsatzservers in einen Webview, wie die
[Desktop-App](desktop-app.md). Anwendung, Daten und Anmeldung liegen auf dem Server. Die Hülle
bringt das Onboarding, eine Serverliste mit einem eigenen Datenspeicher je Server, native
Status-Seiten, die Anmeldung im Systembrowser, Downloads mit dem Teilen-Blatt, Drucken, die
Meldung bei offener App, die Zahl am App-Symbol und Haptik mit.

Anforderungen: Specs `ios-huelle`, `huellen-vertrag` und `ios-auslieferung`. Quellcode und Regeln:
`ios/` ([`ios/AGENTS.md`](../../ios/AGENTS.md)). Herleitung: `design.md` der Change
`t39ltxxi-ios-huelle`.

## Bezug und Installation (TestFlight)

Die App gibt es nur über **TestFlight**, nicht im App Store. Sie läuft auf iPhone und iPad ab
iOS bzw. iPadOS 17.4.

1. Eine Person mit Zugang zu App Store Connect lädt die Testerin oder den Tester ein: unter
   „TestFlight“ als interne Testerin (Mitglied des Teams in App Store Connect) oder in eine
   Gruppe externer Tester. Den ersten Build einer neuen Version für externe Tester prüft Apple
   vorher (Beta-App-Review).
2. Auf dem Gerät die App **TestFlight** aus dem App Store laden und die Einladung (Mail oder
   öffentlicher Link) annehmen.
3. In TestFlight „Lifeline“ installieren. Neue Builds bietet TestFlight selbst an; „Automatische
   Updates“ lässt sich dort je App einschalten. Ein Build läuft in TestFlight nach 90 Tagen ab.

**Welche Stände kommen an:** jeder freigegebene Tag der Kanäle `beta` (`vX.Y.Z-beta.N`) und `main`
(`vX.Y.Z`), nie Alpha (Spec `ios-auslieferung`). TestFlight zeigt die Version ohne Vorab-Suffix
und dahinter die Build-Nummer, etwa „1.0.0 (202611181200)“: Apple nimmt kein Suffix an. Die
volle Version (`1.0.0-beta.3`) steht in der App unter Serverliste → Einstellungen → „Über“ und im
Onboarding unten. Die Build-Nummer ist der Zeitstempel des Uploads in UTC (`JJJJMMTTHHMM`,
`scripts/ios/version.sh`).

## Erster Start und Server

Ohne gespeicherten Server zeigt die App nur das Onboarding („Kein Server eingerichtet“). Drei
Wege:

- **Adresse eingeben**, zum Beispiel `https://elw.local:8443`. Angenommen wird nur `https` mit
  Hostnamen und ohne Name/Passwort vor „@“; die Regeln und Meldungen sind dieselben wie in der
  Desktop-App (gemeinsame Fälle unter `src-tauri/faelle/`).
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
  Mitteilung des Systems und setzt die Zahl der ungelesenen Eingänge am Symbol. iOS fragt beim
  ersten Mal nach der Erlaubnis, auch wenn zuerst eine Zahl kommt (nur das Entfernen der Zahl
  fragt nie); ändern unter Einstellungen → Mitteilungen → „Lifeline“.
- **Haptik:** beim Speichern einer Erfassung, bei einem eingehenden Alarm und beim Wechsel eines
  Segments, nur auf dem iPhone und nur mit eingeschaltetem Schalter.

## Daten auf dem Gerät

Die App hat keine eigene Datenbank. Was sie offline vorhält, liegt im Datenspeicher des
Webviews, je Server getrennt: Lagebild, Warteschlange und ETB-Entwürfe, wie im Browser. Die
Serverliste liegt als `server.json` in Application Support der App, der Schalter „Haptik“ in den
Einstellungen der App (`ios/LifelineKern/Sources/LifelineKern/Huellenhilfen.swift`). Das
Privacy-Manifest (`ios/App/PrivacyInfo.xcprivacy`) erklärt dafür UserDefaults mit Grund CA92.1,
kein Tracking und keine erhobenen Daten. Vorgaben für
Gerätecode, Sperre und Verlust: [endgeraete.md](endgeraete.md).

## Grenzen (offen)

- **Keine Meldung im Hintergrund** (LLH-1981): iOS hält die App kurz nach dem Wechsel in den
  Hintergrund an; der Live-Kanal ruht, und eine Benachrichtigung oder ein Alarm erscheint erst,
  wenn die App wieder vorn ist. Web Push gibt es in der App nicht (Service Worker laufen im
  Webview einer App nicht, design.md Fakt 1), der Push-Schalter fehlt deshalb. Wer im Einsatz auf
  Alarme angewiesen ist, lässt die App offen oder nutzt zusätzlich Browser bzw. Desktop-App mit
  Web Push. Push über APNs ist eine eigene Aufgabe.
- **Kein Passkey im Webview:** Anmeldung über „Im Browser anmelden“ (siehe „Anmeldung“).
- **Kein Start ohne Server** (LLH-1980): Ist der Server beim Start nicht erreichbar, zeigt die App
  „Server nicht erreichbar“ statt der Oberfläche; einen Precache wie im Browser gibt es in der App
  nicht. Erst eine schon geladene Oberfläche arbeitet ohne Netz weiter. Der Start mit dem letzten
  Stand kommt nach einem Spike auf echtem Gerät als eigene Änderung.
- **iPad:** Die Sitzungsliste unter Profil → „Anmeldungen“ nennt ein iPad als Mac, weil sich sein
  Webview so meldet.
- **Nicht gemessen:** alles auf echten Geräten (Aufgabe 10.3 der Change): Onboarding mit
  `elw.local` und CA-Profil, zwei Server, Anmeldung mit Passkey, Haptik, Meldung, CSV-Export,
  Drucken. Bisher belegt sind nur Simulator und Tests (`ios-pruefung.yml`).

## Release-Ablauf

- Server und App tragen dieselbe Version aus `[workspace.package]`; `ios/` hat keine eigene.
  `scripts/ios/version.sh` schreibt Marketing-Version, `LifelineVersion` und Build-Nummer.
- `.github/workflows/ios.yml` lädt hoch: aufgerufen aus `artefakte.yml` (Job `ios`, „iOS-App
  (TestFlight)“) **nach** der Freigabe eines Tags der Kanäle `beta` oder `main`. Der Job hält
  nichts auf: scheitert er, ist das Release trotzdem veröffentlicht, und der Fehler steht im Lauf
  von `artefakte.yml`. Den Ablauf trägt `scripts/ios/testflight.sh` (Version gegen den Tag
  prüfen, `xcodegen generate`, `xcodebuild archive`, Export mit Upload).
- **Handstart** (auch zum Nachholen nach einer Störung bei Apple): Actions → „iOS-App
  (TestFlight)“ → „Run workflow“ mit dem Tag, etwa `v1.0.0-beta.3`. Alpha-Tags weist das Skript ab.
- Nach dem Upload verarbeitet Apple den Build (meist Minuten, selten länger); erst dann erscheint
  er in TestFlight. Externe Tester sehen ihn nach dem Beta-App-Review und der Freigabe für ihre
  Gruppe.
- Zwei Uploads derselben Minute trügen dieselbe Build-Nummer; Apple lehnt den zweiten ab. Dann
  den Lauf eine Minute später neu starten.
- Die Verschlüsselungsfrage beim Upload ist beantwortet (`ITSAppUsesNonExemptEncryption = false`
  in `ios/project.yml`): die App nutzt nur die Verschlüsselung des Systems (HTTPS).

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
   (developer.apple.com → Certificates, Identifiers & Profiles → Identifiers). Besondere
   Fähigkeiten braucht sie nicht.
2. **App in App Store Connect anlegen** (Meine Apps → „+“ → Neue App, Plattform iOS, diese
   Bundle-ID). Der Name in App Store Connect muss im App Store eindeutig sein; auf dem
   Home-Bildschirm steht unabhängig davon „Lifeline“ (`CFBundleDisplayName`).
3. **API-Schlüssel** anlegen (Benutzer und Zugriffsrechte → Integrationen → Team-Schlüssel) und die
   drei Secrets setzen. Der Entwurf sieht die Rolle **App Manager** vor. Berichte im Apple
   Developer Forum ([Thread 698117](https://developer.apple.com/forums/thread/698117)) nennen für
   den Export mit cloud-verwalteter Signierung nur Schlüssel mit der Rolle **Admin** als
   erfolgreich; ein App-Manager-Schlüssel scheitert dort mit „Cloud signing permission error“.
   Scheitert der erste Upload so, den Schlüssel mit der Rolle Admin neu anlegen.
4. **TestFlight-Gruppen** anlegen und Tester einladen; für externe Tester die Testinformationen
   (Kontakt, Beschreibung) ausfüllen, die Apple für das Beta-App-Review verlangt.
5. Erster Handstart von `ios.yml` mit einem Beta-Tag (Aufgabe 10.2).

**Kosten:** im Apple Developer Program enthalten (siehe
[desktop-app.md](desktop-app.md#signierung-und-notarisierung-macos), „Kosten und Termine“).
Läuft die Mitgliedschaft ab oder ist eine geänderte Lizenzvereinbarung nicht akzeptiert, lehnt
Apple jeden Upload ab; bereits installierte Builds laufen bis zu ihrem Ablauf in TestFlight weiter.
