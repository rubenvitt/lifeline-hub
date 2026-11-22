# Betrieb: Android-App (Handy, Tablet)

Die Android-App „Lifeline“ ist eine **Hülle** um die Webanwendung (LLH-1989,
[ADR-0084](../architektur/entscheidungen/ADR-0084-die-android-huelle-ist-eine-eigene-kotlin-app-ohne-anwendungslogik-und-kommt-als-apk-die-sich-selbst-aktualisiert.md)).
Sie verhält sich wie die [iOS-App](ios-app.md): Sie lädt die https-Adresse des Einsatzservers in
einen WebView; Anwendung, Daten und Anmeldung liegen auf dem Server. Die Hülle bringt das
Onboarding mit QR-Code, eine Serverliste mit einem eigenen WebView-Profil je Server, native
Status-Seiten, die Anmeldung im Browser, Downloads mit dem Teilen-Blatt, Drucken, die Meldung bei
offener App, Haptik und einen eigenen Updater mit.

Quellcode und Regeln: `android/` ([`android/AGENTS.md`](../../android/AGENTS.md)). Herleitung:
`docs/superpowers/specs/2026-11-22-y1dsr5i9-android-huelle-design.md`.

## Bezug und Installation (APK)

Die App gibt es nur als **APK an den GitHub-Releases**, nicht bei Google Play. Sie läuft auf
Handys und Tablets ab **Android 10**, hoch und quer. Paketname: `dev.rubeen.lifeline.android`.

| Kanal | Link (auch als Inhalt des QR-Codes) | Stand |
|---|---|---|
| Alpha | `https://github.com/rubenvitt/lifeline-hub/releases/download/android-alpha/lifeline-hub-android.apk` | letzte Alpha |
| Beta | `https://github.com/rubenvitt/lifeline-hub/releases/download/android-beta/lifeline-hub-android.apk` | letzte Beta |
| Stabil | `https://github.com/rubenvitt/lifeline-hub/releases/latest/download/lifeline-hub-android.apk` | letztes stabiles Release (erst ab dem ersten stabilen Release) |

Ein QR-Code an der Wand enthält genau diesen Link und führt damit immer zur aktuellen Fassung des
Kanals. Jede Version liegt zusätzlich am versionierten Release als
`lifeline-hub-android-<version>.apk` mit `.sha256`.

**Der Kanal steht mit der ersten Installation fest.** Beim ersten Start leitet die App ihn aus
ihrer Version ab (`-alpha.` → Alpha, `-beta.` → Beta, ohne Suffix → Stabil) und behält ihn für
immer; ein Update ändert ihn nicht (`android/kern/src/main/kotlin/dev/rubeen/lifeline/kern/Kanal.kt`).
Eine Alpha-App folgt also der Alpha, auch wenn ihr Kanal sie auf ein stabiles Release hebt. Den
Kanal wechseln heißt: App deinstallieren (Serverliste, Anmeldungen und nicht übertragene Einträge
gehen verloren) und über den Link des anderen Kanals neu installieren.

### Erste Installation

1. Den Link oder QR-Code im Browser des Geräts öffnen (Chrome, Samsung Internet). Der Download der
   APK beginnt; der Browser warnt vor Dateien dieses Typs, „Trotzdem herunterladen“.
2. Die geladene Datei öffnen. Beim ersten Mal sperrt Android die Installation und bietet
   „Einstellungen“ an: dort für den Browser bzw. „Eigene Dateien“ **„Unbekannte Apps
   installieren“** („Von dieser Quelle zulassen“) einschalten, zurück, „Installieren“. Warnt Play
   Protect vor einer App eines unbekannten Entwicklers, über „Weitere Details“ trotzdem
   installieren.
3. Bricht die Installation auf einem Galaxy-Gerät mit einem Hinweis auf **Auto Blocker** ab:
   Einstellungen → Sicherheit und Datenschutz → **Auto Blocker** ausschalten, installieren und
   Auto Blocker danach nach Belieben wieder einschalten. Solange er an ist, blockiert er auch die
   Updates der App (siehe „Updates“).
4. Beim ersten Update fragt die App selbst nach „Unbekannte Apps installieren“ (der Hinweis
   „Update bereit“ führt in die Systemeinstellung); erst damit kann sie sich aktualisieren.

**System-WebView:** Die App braucht einen aktuellen „Android System WebView“ (Profile je Server,
Brücke, Start-Skript). Er aktualisiert sich über Google Play, sobald das Gerät online ist. Ist er
zu alt, zeigt die App nur „System-WebView aktualisieren“ mit einem Knopf zu Google Play. Ein
Tablet, das nur im Einsatz-LAN lebt, vor dem ersten Einsatz einmal mit Internet verbinden und in
Google Play „Android System WebView“ aktualisieren.

## Erster Start und Server

Wie in der [iOS-App](ios-app.md#erster-start-und-server): ohne gespeicherten Server nur das
Onboarding („Kein Server eingerichtet“) mit Adresse eingeben, **QR-Code scannen** (die App fragt
dafür beim ersten Scan nach der Kamera; ohne Kamera bleibt die Eingabe) oder Deeplink
`lifeline://verbinden?server=…`. Adressprüfung, Deeplink und Linkregeln sind dieselben wie in
Desktop- und iOS-App (gemeinsame Fälle unter `src-tauri/faelle/`), auch die Sperre von Ports,
die der WebView nicht lädt (etwa 6000). Gespeichert wird ein Server erst, wenn die App den
`shell_contract` aus `GET /api/shell` kennt; dieselbe Prüfung läuft bei Start, Wechsel und
Rückkehr in den Vordergrund (`android/kern`, `Vertrag` und `Ablauf`).

**Serverliste:** der kleine runde Knopf unten links öffnet sie. Hinzufügen, wechseln, umbenennen
(Vorgabe ist der Hostname), entfernen; den aktiven Server erst nach einem Wechsel. Jeder Server
läuft in einem **eigenen WebView-Profil** (Cookies, Anmeldung, Service Worker, Offline-Lagebild,
Warteschlange); Sitzungen zweier Server vermischen sich nicht, auch nicht als Rückfall.
**Entfernen** löscht nach einer Rückfrage das Profil; noch nicht übertragene Einträge dieses
Servers gehen dabei verloren. Lässt sich das Profil nicht löschen, bleibt der Server in der Liste
und die App meldet den Fehler. „Zur Oberfläche“ und der Hinweis „Fremde Seite“ wirken wie in der
iOS-App.

**Zurück:** Die Zurück-Geste geht im WebView zurück, solange es dort zurückgeht; sonst legt sie die
App in den Hintergrund (sie beendet sie nicht). Über einer nativen Seite schließt Zurück diese
Seite.

**Einstellungen** (aus der Serverliste): Schalter „Haptik“ (Vorgabe an, nur auf Geräten mit
Vibrationsmotor spürbar), Abschnitt „Updates“ mit Kanal, Stand und „Jetzt prüfen“, „Über“ mit
Version und Build.

### Status-Seiten

| Seite | Wann | Weiter |
|---|---|---|
| Server nicht erreichbar | der Server antwortet nicht und die Oberfläche lässt sich auch ohne Netz nicht laden | die App prüft alle 5 Sekunden weiter und lädt, sobald er antwortet; „Serverliste“ |
| Zertifikat nicht vertrauenswürdig | das Gerät vertraut dem Zertifikat des Servers nicht | Anleitung auf der Seite, siehe „CA-Zertifikat für das Einsatz-LAN“ |
| App aktualisieren | der Server hat einen neueren Vertrag, als die App kennt | „Jetzt aktualisieren“ startet den Updater (mit Kanal) |
| Server ist zu alt für diese App | `GET /api/shell` fehlt (404) oder nennt einen älteren Vertrag | Server aktualisieren; die Seite nennt seine Version |
| System-WebView aktualisieren | der System-WebView kann keine Profile, keine Brücke oder kein Start-Skript | „Im Play Store öffnen“, danach die App neu starten |

Texte: `android/kern/src/main/kotlin/dev/rubeen/lifeline/kern/Statustext.kt`. Ohne Netz gilt
der zuletzt bestätigte Vertrag eines Servers.

**Start ohne Server:** Anders als auf iOS laufen Service Worker im Android-WebView. Ist der Server
beim Start nicht erreichbar (kein Zertifikatsfehler) und wurde er in seinem Profil schon einmal
geladen, lädt die App trotzdem seine Startadresse; der Service Worker liefert die Oberfläche, und
sie arbeitet offline mit Lagebild und Warteschlange. Scheitert das (kein Precache), erscheint
„Server nicht erreichbar“. Kommt der Server zurück, prüft die App den Vertrag erneut, ohne neu zu
laden. Ein nie geladener Server zeigt ohne Netz „Server nicht erreichbar“.

## CA-Zertifikat für das Einsatz-LAN

Die App vertraut den CAs des Systems **und** vom Nutzer installierten CAs, ohne Ausnahme, ohne
„Trotzdem fortfahren“ und ohne Pinning (`android/app/src/main/res/xml/network_security_config.xml`).
Ein Server mit öffentlichem Zertifikat braucht nichts. Ein Server im Einsatz-LAN braucht ein
Zertifikat aus **mkcert oder einer eigenen CA**; das selbst signierte Rückfall-Zertifikat taugt
nicht (Begründung und Abhilfe: [iOS-App](ios-app.md#ca-profil-für-das-einsatz-lan)).

Auf jedes Android-Gerät:

1. Root-CA holen: `mkcert -CAROOT` auf dem Server-Rechner nennt das Verzeichnis, darin liegt
   `rootCA.pem`. **Nie** `rootCA-key.pem` weitergeben. Bietet das Gerät die Datei nicht an, sie
   in `rootCA.crt` umbenennen.
2. Die Datei auf das Gerät bringen (Download, Mail, USB). Das Gerät braucht eine
   Bildschirmsperre ([endgeraete.md](endgeraete.md)), sonst lässt Android keine CA zu.
3. Einstellungen → Sicherheit → Weitere Sicherheitseinstellungen → Zertifikat installieren →
   **CA-Zertifikat**, die Warnung bestätigen und die Datei wählen. Der Pfad heißt je Hersteller
   etwas anders; auf Galaxy-Geräten etwa Sicherheit und Datenschutz → Weitere
   Sicherheitseinstellungen → Von Gerätespeicher installieren → CA-Zertifikat.
4. Zurück in die App; sie prüft beim Wechsel in den Vordergrund neu, sonst „Erneut prüfen“.

Android meldet danach dauerhaft „Netzwerk wird möglicherweise überwacht“; das ist die Folge jeder
Nutzer-CA. Die CA kann für jeden Hostnamen Zertifikate ausstellen: von privaten Geräten wieder
entfernen (Einstellungen → … → Nutzeranmeldedaten), wenn sie nicht mehr im Einsatz-LAN arbeiten.

## Anmeldung

Ein Passkey geht im WebView nicht; die App meldet der Seite `passkey: false`, die Anmeldeseite
bietet **„Im Browser anmelden“** an, wie auf iOS ([ios-app.md](ios-app.md#anmeldung)). Die App
öffnet die Bestätigungsseite des Servers in einem **Auth Tab** (Chrome, wo er es kann) oder sonst
in einem Custom Tab des Standardbrowsers; dort meldet man sich an wie im Browser. Der Rücksprung
`lifeline://anmeldung` zählt nur, solange eine von der App gestartete Anmeldung offen ist; ein
Link von außen bewirkt nichts. Wer den Tab schließt, landet wieder auf der Anmeldeseite.

## Links, Dateien, Drucken, Meldungen

- **Links** wie Desktop- und iOS-App: eigene Seiten bleiben in der App (auch „in neuem Tab
  öffnen“, im selben WebView), fremde Websites, `mailto:` und `tel:` öffnet Android in der
  zuständigen App.
- **Dateien vom eigenen Server** (unter `/api/` außer `/api/auth/`, CSV-Exporte, auch `blob:`)
  lädt die App mit der Sitzung des Profils und bietet sie im **Teilen-Blatt** an. Die Kopie liegt
  bis zu 24 Stunden im Cache der App.
- **Drucken** öffnet den Druckdialog von Android (auch „Als PDF speichern“).
- **Rückfragen der Seite** erscheinen als Dialog von Android; der Titel nennt, wer fragt.
- **Meldungen:** Bei laufender App zeigt sie eine Benachrichtigung im Kanal „Lifeline“. Ab
  Android 13 fragt sie beim ersten Mal nach der Erlaubnis; ändern unter Einstellungen → Apps →
  Lifeline → Benachrichtigungen. Eine Zahl am Symbol setzt die App nicht; Samsung zählt die
  Meldungen selbst.
- **Haptik:** beim Speichern einer Erfassung, bei einem eingehenden Alarm und beim Wechsel eines
  Segments, nur mit eingeschaltetem Schalter und Vibrationsmotor.

## Daten auf dem Gerät

Die App hat keine eigene Datenbank. Was sie offline vorhält, liegt im WebView-Profil des
jeweiligen Servers (Lagebild, Warteschlange, ETB-Entwürfe, wie im Browser). Die Serverliste liegt
als `lifeline/server.json` im privaten Speicher der App. Ein Eintrag, dessen Adresse die Prüfung
inzwischen ablehnt (etwa auf einem gesperrten Port), fällt beim Laden heraus, die übrigen bleiben;
war er aktiv, wird der erste übrige aktiv. Ist die Datei aus einem anderen Grund unlesbar, legt
die App sie als `server.defekt.json` beiseite und beginnt leer. Schalter, Kanal und Stand des Updaters liegen in
den Einstellungen der App. Die App nimmt an keiner Cloud-Sicherung teil (`allowBackup="false"` in
`android/app/src/main/AndroidManifest.xml`); nach einer Neuinstallation sind Server und
Anmeldungen weg. Vorgaben für Bildschirmsperre, Gemeinschaftsgeräte und Verlust:
[endgeraete.md](endgeraete.md).

## Updates

Die App aktualisiert sich selbst, ohne Google Play und ohne MDM
(`android/app/src/main/kotlin/dev/rubeen/lifeline/android/update/`, Entscheidungen in
`android/kern/src/main/kotlin/dev/rubeen/lifeline/kern/Update.kt`):

- **Prüfen:** beim Start, bei der Rückkehr in den Vordergrund und im Hintergrund, höchstens alle
  4 Stunden, liest sie `android.json` ihres Kanals (Alpha und Beta im Release `android-alpha` bzw.
  `android-beta`, Stabil unter `releases/latest/download/`). „Jetzt prüfen“ in den Einstellungen
  prüft sofort. Neuer ist ein Stand nur, wenn die Version nach SemVer **und** `version_code` größer
  sind.
- **Laden:** im Hintergrund, nur von `github.com` und GitHubs Download-Hosts, mit Prüfung der
  `sha256`; die Signatur prüft Android.
- **Installieren, nie mitten in der Arbeit:** von selbst nur (a) beim Start, bevor die Oberfläche
  lädt: die App zeigt „Lifeline wird aktualisiert“, schließt sich, und nach dem Update meldet sie
  sich mit „Lifeline aktualisiert – zum Öffnen tippen“ (sofern Meldungen erlaubt sind; sonst die
  App von Hand öffnen); oder (b) wenn sie mindestens 15 Minuten im Hintergrund liegt und Android
  keine Rückfrage braucht. Sonst zeigt sie einen Punkt am Knopf zur Serverliste und „Update“ an
  den Einstellungen; dort installiert „Jetzt installieren“ sofort.
- **Rückfrage des Systems:** Das **erste** Update nach einer Installation aus Browser oder Dateien
  fragt immer nach („Aktualisieren?“), auf Geräten vor Android 12 jedes Update. **Ab dem zweiten
  Update** und ab Android 12 installiert die App ohne Rückfrage, weil sie dann selbst die
  installierende App ist. Ab Android 14 beansprucht sie die Update-Hoheit: eine APK aus anderer
  Quelle (etwa erneut über den QR-Code) fragt vor dem Ersetzen nach.
- **Blockiert:** Fehlt „Unbekannte Apps installieren“, führt der Hinweis in die Systemeinstellung.
  Sperrt das Gerät die Installation (Samsung Auto Blocker), zeigt die App „Installation
  blockiert“ und versucht es nicht still erneut; nach dem Abschalten „Jetzt prüfen“.
- **Ohne Internet** (Einsatz-LAN) bleibt alles, wie es ist; ein schon geladenes Update bleibt
  bereit. Fehler des Updaters stören die Oberfläche nie. Ein lokal gebauter Stand (`0.0.0-dev`)
  hat keinen Kanal und sucht keine Updates.

## Release-Ablauf

- Server und App tragen dieselbe Version aus `[workspace.package]`; `android/` hat keine eigene.
  `scripts/android/version.sh` schreibt `versionName` (volle Version, etwa `1.0.0-alpha.196`) und
  `versionCode` (Minuten seit 01.01.2026, 00:00 UTC, zum Zeitpunkt des Baus).
- `.github/workflows/android.yml` baut, aufgerufen aus `artefakte.yml` (Job `android`) **nach**
  der Freigabe jedes Tags der Kanäle `alpha`, `beta` und `main`, mit
  `scripts/android/release-apk.sh` eine signierte APK und hängt sie ans Release. Der Job hält
  nichts auf: scheitert er, ist das Release trotzdem veröffentlicht, es fehlt nur die APK.
- Manifest und feste APK der Kanäle schreibt `scripts/release/android-kanal.mjs` fort: jeder
  Vorabkanal nur mit seinen eigenen Tags, stabile Tags schreiben das Manifest beider fort, alles
  nur vorwärts. Die feste APK eines Vorabkanals ersetzen nur Tags dieses Kanals.
- **Handstart** (etwa nach dem Anlegen der Geheimnisse oder einer Störung): Actions →
  „Android-App (APK)“ → „Run workflow“ mit dem Tag, etwa `v1.0.0-alpha.196`.
- Die Prüfung an PRs (`android-pruefung.yml`) baut die App ohne Signatur, fährt die
  Robolectric-Tests und lädt die Bilder jeder nativen Seite als Artefakt `android-bilder` hoch
  ([`scripts/AGENTS.md`](../../scripts/AGENTS.md), „Android-Prüfung“).

## Signierschlüssel

Signiert wird mit **einem Schlüssel für immer**: Android ersetzt eine installierte App nur durch
eine APK mit demselben Schlüssel. Geht er verloren, gibt es keine Updates mehr, nur eine
Neuinstallation, bei der Serverliste, Anmeldungen und nicht übertragene Einträge verloren gehen.
Fehlt eines der Geheimnisse, wird der Lauf rot; eine unsignierte APK kommt nie ans Release.

Einmalig (Ruben), auf einem eigenen Rechner mit JDK:

```bash
keytool -genkeypair -v -keystore lifeline-android.jks -alias lifeline -keyalg RSA -keysize 4096 -validity 36500
```

`keytool` fragt Passwort des Keystores, Passwort des Schlüssels (Enter übernimmt das des
Keystores) und den Namen; als Name genügt „Lifeline Hub“. Dann die vier Geheimnisse des
Repositorys setzen, ohne dass ein Wert im Terminal erscheint:

| Secret (GitHub, Repository) | Inhalt |
|---|---|
| `ANDROID_KEYSTORE_BASE64` | die Datei `lifeline-android.jks` als Base64 |
| `ANDROID_KEYSTORE_PASSWORD` | Passwort des Keystores |
| `ANDROID_KEY_ALIAS` | `lifeline` |
| `ANDROID_KEY_PASSWORD` | Passwort des Schlüssels |

```bash
base64 < lifeline-android.jks | tr -d '\n' | gh secret set ANDROID_KEYSTORE_BASE64
gh secret set ANDROID_KEYSTORE_PASSWORD
gh secret set ANDROID_KEY_ALIAS --body lifeline
gh secret set ANDROID_KEY_PASSWORD
```

**Sicherung außerhalb von GitHub:** Keystore-Datei und beide Passwörter in 1Password, Tresor
„Dev“, wie die übrigen Schlüssel; GitHub-Geheimnisse lassen sich nicht wieder auslesen. Den
Schlüssel **nie wechseln** und nie ins Repo legen. Der Lauf schreibt den Fingerabdruck des
Zertifikats ins Log (`apksigner verify --print-certs`); nach dem ersten Lauf mit der Sicherung
vergleichen. Danach den Handstart mit dem letzten Alpha-Tag auslösen.

## Grenzen

- **Kein Alarm bei geschlossener App:** Web Push gibt es im Android-WebView nicht, FCM ist nicht
  gebaut. Meldungen kommen nur, solange die App läuft; wer auf Alarme angewiesen ist, lässt sie
  offen oder nutzt zusätzlich Browser bzw. Desktop-App mit Web Push.
- **Kein Passkey im WebView:** Anmeldung über „Im Browser anmelden“.
- **System-WebView muss aktuell sein** (siehe „Erste Installation“); ohne Profile lädt die App
  keine Oberfläche, statt die Daten zweier Server zu mischen.
- **Kein Kanalwechsel in der App** (siehe „Bezug und Installation“).
- **Nicht gemessen:** alles auf echten Geräten. Belegt sind nur Robolectric-Tests und Bilder
  (`android-pruefung.yml`); die Prüfliste unten schließt die Lücke mit der ersten Alpha.

## Prüfliste der ersten Alpha (Galaxy Tab)

Robolectric bildet den echten WebView, den Browser und den Installer nicht ab. Die erste Alpha
prüft Ruben auf einem Galaxy Tab der Organisation, zusätzlich wo möglich auf einem Android-Handy.
Jeder Punkt mit Ergebnis an die Aufgabe LLH-1989.

**Gerät**

- [ ] Modell, Android-Version, One-UI-Version, Version von „Android System WebView“
  (Einstellungen → Apps → Android System WebView) notieren; hat das Gerät einen Vibrationsmotor?
- [ ] Ist Auto Blocker ab Werk an? Installation mit Auto Blocker an (Meldung?) und aus.
- [ ] Erstinstallation über den Alpha-Link bzw. QR-Code: Warnungen von Browser und Play Protect,
  „Unbekannte Apps installieren“ für den Browser.

**Server und Profile**

- [ ] Onboarding mit `elw.local` und mkcert-CA (CA-Zertifikat nach der Anleitung oben, Menüpfad
  auf dem Galaxy Tab notieren); ohne CA erscheint „Zertifikat nicht vertrauenswürdig“, nicht
  „nicht erreichbar“.
- [ ] QR-Code aus „Geräte verbinden“ scannen (Kamera-Frage erst beim Scan).
- [ ] Zwei Server mit verschiedenen Konten: Anmeldung, Lagebild und Warteschlange bleiben je
  Server getrennt, auch nach mehrfachem Wechsel und Neustart der App.
- [ ] Start-Skript und Brücke: Haptik, Meldung und Drucken wirken auf dem aktiven Server; auf
  einer fremden Seite (Identitätsanbieter) und in einem eingebetteten Frame nicht.
- [ ] Einen nicht aktiven Server entfernen: verschwindet, Profil gelöscht (erneut hinzufügen
  verlangt neue Anmeldung). Den eben noch aktiven Server direkt nach einem Wechsel entfernen
  (`deleteProfile` kurz nach dem Zerstören des WebViews).
- [ ] Ein schneller zweiter Tipp auf einen Link während des Ladens zeigt nicht „Server nicht
  erreichbar“ (`net::ERR_ABORTED`).
- [ ] Zurück-Geste: im WebView zurück, dann App in den Hintergrund; nie ins Onboarding.

**Ohne Netz**

- [ ] Server einmal laden, App beenden, Flugmodus an, App kalt starten: Die Oberfläche kommt aus
  dem Service Worker, Lagebild lesbar, eine Erfassung landet in der Warteschlange. Server wieder
  erreichbar: Warteschlange überträgt sich, ohne dass die App neu lädt.
- [ ] Ein nie geladener Server im Flugmodus: „Server nicht erreichbar“, lädt von selbst, sobald
  er antwortet.

**Anmeldung, Druck, Meldung, Dateien**

- [ ] „Im Browser anmelden“ mit Chrome als Standardbrowser (Auth Tab) und mit Samsung Internet
  (Custom Tab): Anmeldung kommt in der App an; Tab ohne Anmeldung schließen lässt die
  Anmeldeseite stehen; `lifeline://anmeldung` von außen (Link in einer Notiz) bewirkt nichts.
- [ ] Drucken (Liste, ETB) über den Druckdialog, auch abbrechen.
- [ ] Erste Meldung fragt nach der Erlaubnis (Android 13+); abgelehnt kommt keine, erlaubt
  erscheint sie im Kanal „Lifeline“.
- [ ] CSV-Export und Anhang vom Server: Download mit Sitzung (keine Anmeldeseite in der Datei),
  Dateiname stimmt, Teilen-Blatt bietet „Eigene Dateien“, Mail usw.; ein `blob:`-Download
  ebenso.
- [ ] Haptik auf dem Tablet (ohne Vibrationsmotor: kein Fehler) und auf einem Handy.

**Updates** (braucht zwei aufeinanderfolgende Alphas)

- [ ] Erstes Update: Hinweis „Update bereit“ am Knopf, beim nächsten Start „Lifeline wird
  aktualisiert“ mit Rückfrage des Systems; danach die Meldung „Lifeline aktualisiert – zum Öffnen
  tippen“. Rückfrage ablehnen: die Oberfläche lädt nach höchstens wenigen Sekunden.
- [ ] Ab dem zweiten Update ohne Rückfrage: App 15 Minuten in den Hintergrund, Update kommt ohne
  Zutun (Zeitpunkt notieren; unter Doze kann WorkManager später laufen).
- [ ] Nie im Vordergrund: bei offener Oberfläche nur der Hinweis, keine Installation.
- [ ] Update-Hoheit (Android 14+): dieselbe Alpha erneut über den QR-Code installieren, fragt
  Android nach?
- [ ] Mit Auto Blocker an: „Installation blockiert“ in den Einstellungen, kein stiller neuer
  Versuch; nach dem Abschalten „Jetzt prüfen“.
- [ ] Download-Host der echten Releases: Das Update lädt (GitHub leitet heute auf
  `release-assets.githubusercontent.com` bzw. `objects.githubusercontent.com` um; ein anderer
  Host scheitert mit „Prüfung fehlgeschlagen“ und gehört in `Updateentscheidung.ERLAUBTE_HOSTS`).
- [ ] Einsatz-LAN ohne Internet: keine Fehlermeldung, Oberfläche unberührt.
