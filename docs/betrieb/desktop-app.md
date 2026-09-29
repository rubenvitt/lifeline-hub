# Betrieb: Desktop-App (macOS, Windows)

Die Desktop-App „Lifeline Hub“ ist eine **Hülle** um die Webanwendung (LFH-721, Variante A
aus LFH-720). Sie lädt die https-Adresse des Einsatzservers, genau wie ein Browser. Die
Anwendung selbst, die Daten und die Anmeldung liegen weiter auf dem Server. Die Hülle bringt
ein eigenes Fenster, die Serveradresse beim ersten Start, den Deeplink aus „Geräte verbinden“,
den Druck auf dem Mac und das Update mit.

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
`https://elw.local:8443`. Angenommen wird nur `https` mit Hostnamen, denn Offline-Betrieb
(Service Worker) und Passkeys brauchen eine gesicherte Verbindung. Das Zertifikat des Servers
muss der Rechner kennen, so wie bei einem Browser (mkcert-CA oder ein öffentliches Zertifikat,
siehe [betrieb-tls.md](../betrieb-tls.md)). Sonst zeigt das Fenster nur eine Fehlerseite.

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

## Update

Nach jedem Start prüft die App im Hintergrund, ob es ein neueres **stabiles** Release gibt.
Sie liest dazu `https://github.com/rubenvitt/lifeline-hub/releases/latest/download/latest.json`,
und GitHub lässt Vorabversionen bei „latest“ aus.

- **Ohne Internet** (Einsatz-LAN) scheitert die Prüfung nach höchstens 10 s still. Die App
  läuft normal weiter, eine Fehlermeldung erscheint nicht.
- **Gibt es ein Update,** fragt die App mit Versionsnummer nach: „Aktualisieren“ oder „Später“.
  Sie installiert **nie ohne Zustimmung**, denn das Update startet die App neu. Unter Windows
  beendet der Installer sie dafür.
- **Auf Wunsch prüfen:** Menü „Lifeline Hub“ → „Nach Updates suchen…“. Das meldet auch „Sie
  verwenden die aktuelle Version“.
- Jedes Update ist signiert. Passt die Signatur nicht zum öffentlichen Schlüssel in der App
  (`src-tauri/tauri.conf.json`, `plugins.updater.pubkey`), installiert sie nichts und läuft in
  der alten Version weiter.

## Signaturschlüssel des Updaters

Die Update-Archive signiert der Release-Lauf (`.github/workflows/artefakte.yml`, Job
`desktop`) mit einem Ed25519-Schlüssel (minisign). Den öffentlichen Teil trägt jede
installierte App.

| Secret (GitHub, Repository) | Inhalt |
|---|---|
| `TAURI_SIGNING_PRIVATE_KEY` | privater Schlüssel (Inhalt der Datei) |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | sein Passwort |

Gesetzt werden sie aus der lokalen Ablage, ohne dass der Schlüssel im Terminal erscheint:

```bash
gh secret set TAURI_SIGNING_PRIVATE_KEY < ~/.tauri/lifeline-desktop.key
```

```bash
gh secret set TAURI_SIGNING_PRIVATE_KEY_PASSWORD < ~/.tauri/lifeline-desktop.key.passwort
```

**Den Schlüssel und das Passwort im Passwortmanager sichern.** Geht der private Schlüssel
verloren, nimmt keine installierte App mehr ein Update an. Dann hilft nur ein neues
Schlüsselpaar (`cargo tauri signer generate`), der neue öffentliche Schlüssel in
`tauri.conf.json` und eine **einmalige Neuinstallation von Hand** auf jedem Gerät. Fehlt das
Secret im Lauf, bricht der Desktop-Bau mit einer Meldung ab. Die Server-Artefakte entstehen
trotzdem.

## Release-Ablauf

- `semantic-release` setzt die Version der App zusammen mit der des Servers (`prepareCmd` in
  `release.config.mjs`). `tauri.conf.json` trägt keine eigene Version, der Test
  `version_gleich_der_anwendungsversion` in `src-tauri` hält beide gleich.
- `artefakte.yml` baut die App nur bei stabilen Tags. Vor dem ersten stabilen Release lässt sich
  der Bau per „Run workflow“ mit einem Alpha-Tag und `desktop: true` prüfen. Dabei entsteht
  auch ein `latest.json` am Alpha-Release. Das ist unschädlich, weil die Apps nur das stabile
  „latest“ lesen.
- `latest.json` erzeugt `scripts/release/desktop-manifest.mjs` aus den tatsächlich gebauten
  Paketen. Scheitert eine Plattform, fehlt sie im Manifest, statt ins Leere zu zeigen.

## Grenzen (offen)

- **Signierung/Notarisierung:** LFH-722. Bis dahin erscheinen die Warnungen oben.
- **Neue Fenster, externe Links, Datei-Links:** LFH-782. Ein Link mit `target="_blank"` (etwa
  ein Chat-Anhang) öffnet heute nichts.
- **Anmeldung über einen Neustart:** LFH-779/780. Nach jedem Neustart der App ist eine neue
  Anmeldung nötig.
- **Passkey auf macOS:** LFH-783. Im Mac-Fenster geht die Anmeldung per Passwort und OIDC,
  nicht per Passkey.
- **Linux:** Die Hülle wird dort übersetzt (Tests), aber nicht ausgeliefert.
- **App-Symbol:** Es ist aus dem Favicon abgeleitet, einem Platzhalter.
