# Betrieb: Desktop-App (macOS, Windows)

Die Desktop-App „Lifeline Hub“ ist eine **Hülle** um die Webanwendung (LFH-721, Variante A
aus LFH-720). Sie lädt die https-Adresse des Einsatzservers, genau wie ein Browser. Die
Anwendung selbst, die Daten und die Anmeldung liegen weiter auf dem Server. Die Hülle bringt
ein eigenes Fenster, die Serveradresse beim ersten Start, den Deeplink aus „Geräte verbinden“,
den Druck auf dem Mac, die Behandlung neuer Fenster und fremder Links sowie das Update mit.

Anforderungen: `openspec/specs/desktop-huelle/` und `openspec/specs/desktop-auslieferung/`.
Quellcode: `src-tauri/`.

## Bezug

Pakete gibt es nur an **stabilen** Releases (`vX.Y.Z` ohne Vorabkennung), unter
[Releases](https://github.com/rubenvitt/lifeline-hub/releases):

| System | Datei |
|---|---|
| macOS ab 14 (Apple Silicon) | `lifeline-hub-desktop-<version>-macos-arm64.dmg` |
| Windows 10/11 (x64) | `lifeline-hub-desktop-<version>-windows-x64-setup.exe` |

Neben jeder Datei liegt eine `.sha256`.

## Installation

Die Pakete sind **noch nicht signiert** (Developer ID, Windows-Zertifikat: LFH-722). Beide
Systeme warnen deshalb beim ersten Öffnen:

- **macOS:** `.dmg` öffnen und „Lifeline Hub“ nach „Programme“ ziehen. Beim ersten Start
  meldet macOS, dass die App nicht geöffnet werden kann. So geht es trotzdem: Rechtsklick auf
  die App, „Öffnen“, dann „Öffnen“ bestätigen. Ab macOS 15 geht das nicht mehr per Rechtsklick,
  sondern in den Systemeinstellungen unter „Datenschutz & Sicherheit“ mit „Dennoch öffnen“.
  Beim ersten Verbinden fragt macOS nach dem Zugriff aufs **lokale Netzwerk**. Ohne diese
  Freigabe erreicht die App `elw.local` nicht.
- **Windows:** Installer starten. SmartScreen warnt, dann „Weitere Informationen“ →
  „Trotzdem ausführen“. Der Installer richtet die App für den angemeldeten Benutzer ein und
  braucht keine Administratorrechte. Die WebView2-Laufzeit bringt Windows 11 mit, unter
  Windows 10 lädt der Installer sie bei Bedarf nach.

## Erster Start und Serveradresse

Beim ersten Start fragt die App nach der **Serveradresse**, zum Beispiel
`https://elw.local:8443`. Angenommen wird nur `https` mit Hostnamen und ohne Name/Passwort vor
„@“, denn Offline-Betrieb (Service Worker) und Passkeys brauchen eine gesicherte Verbindung. Das Zertifikat des Servers
muss der Rechner kennen, so wie bei einem Browser (mkcert-CA oder ein öffentliches Zertifikat,
siehe [betrieb-tls.md](../betrieb-tls.md)). Sonst bleibt das Fenster leer (macOS) oder zeigt eine
Fehlerseite (Windows). Nach einem Netzausfall fordert Menü „Lifeline Hub“ → „Neu laden“ (macOS:
Menü „Fenster“) die Seite neu an.

Die Adresse bleibt gespeichert, und jeder weitere Start lädt sie direkt:
- macOS: `~/Library/Application Support/dev.rubeen.lifeline.desktop/verbindung.json`
- Windows: `%APPDATA%\dev.rubeen.lifeline.desktop\verbindung.json`

**Server wechseln:** Menü „Lifeline Hub“ → „Server wechseln…“. Die Maske ist mit der
bisherigen Adresse vorbelegt, und „Abbrechen“ führt dorthin zurück. Das hilft auch, wenn der
Server nicht erreichbar ist oder sein Zertifikat abgelehnt wird.

## Deeplink „Geräte verbinden“ (Vertrag für LFH-38)

```
lifeline://verbinden?server=<https-Adresse, URL-kodiert>
```

Beispiel: `lifeline://verbinden?server=https%3A%2F%2Felw.local%3A8443`. Das Schema und der
Pfad `verbinden` sind **fest**. Ein QR-Code oder Link aus „Geräte verbinden“ muss genau diese
Form erzeugen. Das Verhalten:

- **Ohne gespeicherte Adresse:** Die Erststart-Maske zeigt die Adresse. Verbunden wird erst mit
  „Verbinden“.
- **Andere Adresse als die gespeicherte:** Die App fragt nach und nennt dabei beide Adressen.
  Ein Link darf nie still auf einen anderen Server umlenken, denn der könnte die Anmeldung
  abgreifen.
- **Gleiche Adresse, anderer Pfad, fehlendes oder unsicheres `server`:** keine Wirkung.

Die App läuft immer nur einmal. Ein zweiter Start oder ein Link bei laufender App holt das
vorhandene Fenster nach vorn.

## Neue Fenster, fremde Links, Dateien (LFH-782)

Ein Webview öffnet von sich aus weder Tabs noch fremde Seiten. Die App entscheidet deshalb
selbst, wohin ein Link geht:

- **Seite des eigenen Servers in neuem Fenster** (etwa „in neuem Tab öffnen“ in der
  Sprungpalette, Strg/⌘+↵): Die App öffnet ein **weiteres Fenster**, angemeldet und mit Druck.
  Das bisherige Fenster bleibt, wo es war. Ein Serverwechsel schließt die weiteren Fenster,
  ebenso das Schließen des Hauptfensters. „Neu laden“ wirkt auf das Fenster, das vorn ist.
- **Fremde Website** (Links im Fachebenen-Inspector, Lizenzhinweise): Sie öffnet der
  **Standardbrowser** des Systems. `mailto:`- und `tel:`-Links gehen an das zuständige
  Programm.
- **Datei vom eigenen Server** (Adressen unter `/api/`, etwa Anhänge): Sie wird
  **heruntergeladen** und landet im Download-Ordner. Die Anwendung bleibt stehen.
  Ausgenommen ist die Anmeldung (`/api/auth/`), die im Fenster läuft.
- **Alles andere** (`file:`, `javascript:` …) öffnet nichts und steht im Protokoll, dort
  ohne Query und bei `mailto:`/`tel:` ohne Adresse.

Führt ein Link **im Fenster** auf eine fremde Seite, bleibt die App dort. Das ist nötig, weil
die Anmeldung über einen Identitätsanbieter so abläuft. Einen Zurück-Knopf gibt es nicht. Der
Weg zurück ist „Server wechseln“ → „Abbrechen“.

## Update

Nach jedem Start prüft die App im Hintergrund, ob es ein neueres **stabiles** Release gibt.
Sie liest dazu `https://github.com/rubenvitt/lifeline-hub/releases/latest/download/latest.json`,
und GitHub lässt Vorabversionen bei „latest“ aus.

- **Ohne Internet** (Einsatz-LAN) scheitert die Prüfung nach höchstens 10 s still. Die App
  läuft normal weiter, eine Fehlermeldung erscheint nicht.
- **Gibt es ein Update,** fragt die App **zweimal**: erst mit Versionsnummer, ob geladen wird
  („Laden“/„Später“), dann — wenn das Update da ist — ob **jetzt** neu gestartet wird („Jetzt neu
  starten“/„Später“). Sie installiert nie ohne Zustimmung und startet nie unangekündigt neu;
  was zwischen den Fragen getippt wird, geht also nicht verloren. „Später“ im zweiten Dialog
  verwirft den Download, beim nächsten Start kommt das Angebot wieder. Unter Windows beendet der
  Installer die App zum Neustart selbst.
- **Auf Wunsch prüfen:** Menü „Lifeline Hub“ → „Nach Updates suchen…“. Das meldet auch „Sie
  verwenden die aktuelle Version“.
- Jedes Update ist signiert. Passt die Signatur nicht zum öffentlichen Schlüssel in der App
  (`src-tauri/tauri.conf.json`, `plugins.updater.pubkey`), meldet sie das nach dem Laden,
  installiert nichts und läuft in der alten Version weiter.

## Signaturschlüssel des Updaters

Die Update-Archive signiert der Release-Lauf (`.github/workflows/artefakte.yml`, Job
`desktop`) mit einem Ed25519-Schlüssel (minisign). Den öffentlichen Teil trägt jede
installierte App.

| Secret (GitHub, Repository) | Inhalt |
|---|---|
| `TAURI_SIGNING_PRIVATE_KEY` | privater Schlüssel (Inhalt der Datei) |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | sein Passwort |

**Ablage:** 1Password, Tresor „Dev“, Eintrag „Lifeline Hub – Tauri-Updater-Signaturschlüssel“
(Passwort im Feld `password`, privater und öffentlicher Schlüssel als Dateien). Die Secrets sind
gesetzt (29.09.2026). Neu setzen, ohne dass ein Wert im Terminal erscheint:

```bash
op read "op://Dev/Lifeline Hub – Tauri-Updater-Signaturschlüssel/privater Schlüssel" | gh secret set TAURI_SIGNING_PRIVATE_KEY
```

```bash
op read --no-newline "op://Dev/Lifeline Hub – Tauri-Updater-Signaturschlüssel/password" | gh secret set TAURI_SIGNING_PRIVATE_KEY_PASSWORD
```

**Der 1Password-Eintrag ist die Sicherung.** Geht der private Schlüssel
verloren, nimmt keine installierte App mehr ein Update an. Dann hilft nur ein neues
Schlüsselpaar (`cargo tauri signer generate`), der neue öffentliche Schlüssel in
`tauri.conf.json` und eine **einmalige Neuinstallation von Hand** auf jedem Gerät. Fehlt das
Secret im Lauf, bricht der Desktop-Bau mit einer Meldung ab. Die Server-Artefakte entstehen
trotzdem.

## Release-Ablauf

- Server und App tragen dieselbe Version aus `[workspace.package]` der Wurzel-`Cargo.toml`;
  `semantic-release` setzt sie (`prepareCmd` in `release.config.mjs`). `tauri.conf.json` trägt
  keine eigene, der Test `version_kommt_aus_dem_workspace` in `src-tauri` pinnt das.
- `artefakte.yml` baut die App nur bei stabilen Tags. Vor dem ersten stabilen Release lässt sich
  der Bau per „Run workflow“ mit einem Alpha-Tag und `desktop: true` prüfen — mit einem Tag,
  der **nach** dem Merge von LFH-721 entstanden ist; ältere Tags haben weder `src-tauri/` noch
  das Manifest-Skript. Dabei entsteht
  auch ein `latest.json` am Alpha-Release. Das ist unschädlich, weil die Apps nur das stabile
  „latest“ lesen.
- `latest.json` erzeugt `scripts/release/desktop-manifest.mjs` aus den tatsächlich gebauten
  Paketen. Scheitert eine Plattform, fehlt sie im Manifest, statt ins Leere zu zeigen.

## Grenzen (offen)

- **Signierung/Notarisierung:** LFH-722. Bis dahin erscheinen die Warnungen oben.
- **Fremde Seite im Fenster:** Die App hat keinen Zurück-Knopf (siehe „Neue Fenster, fremde
  Links, Dateien“).
- **Anmeldung über einen Neustart:** LFH-779/780. Nach jedem Neustart der App ist eine neue
  Anmeldung nötig.
- **Passkey auf macOS:** entschieden in LFH-783 (gestaffelt). Im Mac-Fenster geht die Anmeldung
  per Passwort und OIDC, nicht per Passkey. Seit LFH-817 bietet die Mac-App den Passkey gar nicht
  erst an: kein Knopf „Mit Passkey anmelden“, im Profil statt der Einrichtung ein Hinweis auf den
  Browser. Ist nur der Passkey als Anmeldeverfahren aktiv, sagt die Anmeldeseite, dass es im
  Browser geht. Windows und der Browser bleiben unverändert.
  **Bekannte Grenze:** Konten, die nur per SSO angelegt wurden (ohne eigenes Passwort), kommen in
  der Mac-App nur hinein, wenn der Identitätsanbieter einen Weg ohne Passkey kennt. Ein Anbieter,
  der ausschließlich Passkeys anbietet (etwa PocketID), sperrt sie dort aus. Das schließt erst die
  Anmeldung im Systembrowser (LFH-818); bis dahin melden sich diese Konten im Browser an.
- **Linux:** Die Hülle wird dort übersetzt (Tests), aber nicht ausgeliefert.
- **App-Symbol:** Es ist aus dem Favicon abgeleitet, einem Platzhalter.
