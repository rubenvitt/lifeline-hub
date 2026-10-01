# Design

## Context

Motivation: `proposal.md`. Ausgangslage im Repo:

- `.github/workflows/artefakte.yml`, Job `desktop`: Matrix `desktop-macos-arm64` (`macos-latest`,
  `--bundles app,dmg`) und `desktop-windows-x86_64`. Gebaut wird mit
  `cargo tauri build --ci` (Tauri-CLI 2.12.0, gepinnt; sie pinnt `tauri-bundler = 2.10.0`).
  Danach sammelt „Pakete einsammeln“ `.dmg`, `.app.tar.gz` und `.sig` ein und rechnet die
  `.sha256`.
- `src-tauri/tauri.conf.json`: `bundle.macOS.signingIdentity = "-"` (ad hoc).
- Der Job checkt **den Tag** aus (`ref: <tag>`), nicht den Branch. Die Workflow-Datei selbst
  kommt dagegen vom gewählten Ref des Laufs.

Was Tauri tut (gelesen in `tauri-bundler-2.10.0/src/bundle/macos/{sign.rs,app.rs,dmg/mod.rs}`,
`tauri-cli-2.12.0/src/interface/rust.rs`):

- `APPLE_SIGNING_IDENTITY` aus der Umgebung schlägt die Identität aus der Config.
- Sind `APPLE_CERTIFICATE` (base64-`.p12`) und `APPLE_CERTIFICATE_PASSWORD` gesetzt, importiert
  `tauri-macos-sign` das Zertifikat in einen Wegwerf-Schlüsselbund. Ist zugleich eine Identität
  gesetzt, muss sie im Zertifikat vorkommen (`contains`), sonst bricht der Bau ab. Mit der
  Config-Identität `"-"` allein schlüge das also fehl.
- Hardened Runtime ist Vorgabe (`macOS.hardenedRuntime`).
- Die `.app` wird signiert und, wenn `APPLE_API_ISSUER`, `APPLE_API_KEY` und
  `APPLE_API_KEY_PATH` gesetzt sind, notarisiert und gestapelt. **Fehlen sie, überspringt Tauri
  die Notarisierung mit einer Warnung und baut weiter.**
- Das `.dmg` wird nur signiert (nicht bei Identität `"-"`), aber nicht notarisiert.

## Goals / Non-Goals

**Goals:**
- Release-Pakete für macOS, die Gatekeeper beim ersten Start ohne Umweg anerkennt, auch ohne
  Internet (angeheftetes Ticket).
- Kein stilles Zurückfallen auf ein nicht notarisiertes Paket.
- Ein Nachweis vor dem Merge, nicht erst am ersten stabilen Release.

**Non-Goals:**
- Windows-Signierung (LFH-875).
- Entitlements über die Vorgabe hinaus. Die Hülle ist nicht sandboxed. WKWebView braucht in der
  App selbst kein JIT-Recht, weil der WebContent-Prozess von Apple signiert ist. Passkeys im
  Fenster (LFH-783) bräuchten Associated Domains samt Provisioning-Profil, das bleibt offen.
- Signierte lokale Entwicklerbauten.
- Universal-Binary oder Intel-Mac.

## Decisions

### D1 — Signieren über Tauris eigene Umgebung, kein eigener Schlüsselbund-Schritt

Der Bauschritt bekommt auf dem macOS-Eintrag `APPLE_CERTIFICATE`,
`APPLE_CERTIFICATE_PASSWORD`, `APPLE_SIGNING_IDENTITY`, `APPLE_API_ISSUER`, `APPLE_API_KEY` und
`APPLE_API_KEY_PATH`. Tauri legt den Wegwerf-Schlüsselbund selbst an, signiert von innen nach
außen und notarisiert die App.

Verworfen:
- **Eigener Schritt mit `security create-keychain`/`import`** (Beispiel der Tauri-Doku): ein
  Schritt mehr, und das Schlüsselbund-Passwort wäre ein weiteres Secret. Tauri tut dasselbe.
- **`tauri-apps/tauri-action`**: der Job baut bewusst mit der gepinnten CLI und eigenem
  Einsammeln (LFH-721, D3).

### D2 — Identität nur in der Release-Umgebung, Config bleibt `"-"`

`APPLE_SIGNING_IDENTITY = "Developer ID Application: Ruben Vitt (H95J852PKP)"` steht als
Literal im Workflow. Sie ist kein Geheimnis, und sie bleibt bei einer Zertifikatsverlängerung
gleich (Name und Team ändern sich nicht).

Verworfen: Identität in `tauri.conf.json`. Dann bräuchte jeder lokale `cargo tauri build` das
Zertifikat im Schlüsselbund, und die Debug-Bauten für Messungen (LFH-721, LFH-818) gingen nicht
mehr ad hoc.

### D3 — Fünf Secrets, die `.p8` als Inhalt

| Secret | Inhalt | Quelle (1Password, Tresor Dev) |
|---|---|---|
| `APPLE_CERTIFICATE` | `.p12` als base64, **einzeilig** | „Lifeline Hub – Developer ID Application (.p12)“, Datei |
| `APPLE_CERTIFICATE_PASSWORD` | Passwort der `.p12` | derselbe Eintrag, `password` |
| `APPLE_API_ISSUER` | Issuer-ID | „Lifeline Hub – Apple Notarisierung (App Store Connect API)“ |
| `APPLE_API_KEY` | Schlüssel-ID | derselbe Eintrag |
| `APPLE_API_KEY_P8` | Inhalt der `.p8` | derselbe Eintrag, Datei |

Der Lauf schreibt `APPLE_API_KEY_P8` nach `$RUNNER_TEMP/AuthKey.p8` (Rechte 600) und setzt
`APPLE_API_KEY_PATH` darauf. Issuer und Schlüssel-ID sind keine Geheimnisse. Sie liegen trotzdem
als Secrets, weil ein neuer API-Schlüssel dann ohne Commit eingespielt wird. Gesetzt wird nach
dem Muster der Betriebsdoku (`op read … | gh secret set …`), ohne dass ein Wert im Terminal
erscheint.

Verworfen: Apple-ID plus app-spezifisches Passwort. Das hängt an einem Personenkonto, der
API-Schlüssel hat nur die Rolle „Entwickler“ und lässt sich einzeln widerrufen.

### D4 — Zwei Wächter gegen ein nicht notarisiertes Paket

1. **Vorher:** Auf `*apple-darwin` bricht der Bauschritt ab, wenn eines der fünf Secrets leer
   ist, mit derselben Art Meldung wie beim fehlenden `TAURI_SIGNING_PRIVATE_KEY`. Das fängt den
   stillen Sprung über die Notarisierung ab.
2. **Nachher:** Der Prüfschritt (D6) scheitert, wenn ein Ticket fehlt. Das fängt den Fall ab,
   dass Tauri trotz gesetzter Umgebung nicht notarisiert (z. B. Warnpfad in `notarize_auth`).

Scheitert der macOS-Eintrag, entfällt er nach LFH-721 (`!cancelled()`, Manifest aus dem
tatsächlich Gebauten) aus `latest.json`, Windows bleibt unberührt. Das trägt die Szenarien
„Zugangsdaten fehlen“ und „Eine Plattform scheitert“ ohne neuen Mechanismus.

### D5 — Das `.dmg` eigens notarisieren und stapeln

Nach dem Bau: `xcrun notarytool submit <dmg> --key … --key-id … --issuer … --wait`, dann
`xcrun stapler staple <dmg>`. Das geschieht **vor** „Pakete einsammeln“, weil Stapling die Bytes
ändert und die `.sha256` sonst nicht passt.

Verworfen:
- **Nur die App notarisieren:** Gatekeeper beurteilt beim Öffnen das heruntergeladene
  Image. Ein nicht notarisiertes `.dmg` fällt bei `spctl -t open` durch, ohne Internet erst
  recht.
- **Notarisierung über `bundle_dmg --notarize`:** braucht ein Schlüsselbund-Profil von
  `notarytool` und ist über die Tauri-Config nicht erreichbar.

### D6 — Prüfschritt inline im Workflow, nicht als Repo-Skript

Nach dem Stapeln, vor dem Einsammeln, prüft ein Schritt:

- `codesign --verify --deep --strict` und `spctl -a -t exec` für die App, `stapler validate`
- `spctl -a -t open --context context:primary-signature` und `stapler validate` für das `.dmg`
- die App aus dem `.app.tar.gz` (entpackt): `stapler validate`, `spctl -a -t exec`
- die Signatur-Authority enthält „Developer ID Application“ mit Team `H95J852PKP`

Inline, weil der Job den **Tag** auscheckt: ein neues Skript unter `scripts/release/` fehlte auf
jedem bestehenden Tag. So läuft der Prüflauf schon vor dem Merge (D7).

Verworfen: Skript mit Selbsttest in `check-all.sh`. Die Prüfungen brauchen macOS-Werkzeuge und
ein signiertes Bundle, die das Gate nicht hat.

### D7 — Nachweis in zwei Stufen

1. **Lokal, vor dem Plan** (erledigt, siehe „Nachweise“): derselbe Weg wie in der CI, also
   Zertifikat über `APPLE_CERTIFICATE` statt Schlüsselbund, Notarisierung über den
   API-Schlüssel, danach `.dmg` notarisieren und alle Prüfungen aus D6.
2. **CI vor dem Merge:** `gh workflow run artefakte.yml --ref <dieser Branch> -f tag=<Alpha-Tag
   nach LFH-721> -f desktop=true`. Die Workflow-Datei kommt vom Branch, der Code vom Tag, und
   `tauri.conf.json` ändert sich nicht. Der Lauf baut aber auch die Server-Artefakte und
   Container-Abbilder des Alpha-Tags neu, schiebt sie und hängt Desktop-Pakete samt
   `latest.json` ans Alpha-Release (unschädlich, die Apps lesen nur das stabile „latest“). Weil
   das nach außen wirkt, steht er als eigener Schritt mit Zustimmung in `tasks.md`.

Den Erststart auf einem fremden Mac bestätigt ein Mensch von Hand (ein zweiter Mac oder eine
macOS-VM in Parallels, `.dmg` per Browser geladen, damit die Quarantäne gesetzt ist).

### D8 — Betriebsdoku nachziehen, auch die kaputten `op read`-Befehle

`docs/betrieb/desktop-app.md`: Installation ohne Umweg, Abschnitt „Signierung und
Notarisierung (macOS)“ mit Secrets, Ablage, Kosten (99 €/Jahr, Verlängerung automatisch am
06.06.2027), Zertifikat bis 17.09.2031, Vorgehen bei Ablauf oder Widerruf, Lizenzvereinbarung
als Ausfallgrund. Die bestehenden Befehle zum Setzen der Updater-Secrets scheitern heute: `op`
lehnt den Gedankenstrich im Eintragsnamen ab (`invalid character in secret reference: '–'`).
Sie bekommen die Eintrags-ID, die Datei die Datei-ID. Neue Befehle ebenso.

## Risks / Trade-offs

- [Apple-Notarisierung hängt oder ist gestört] → `--wait` hält den Lauf; der Job hat 60 min
  Zeitlimit. Scheitert er, fällt nur macOS aus dem Release (D4) und lässt sich per Dispatch
  nachbauen.
- [Lizenzvereinbarung nicht akzeptiert oder Mitgliedschaft abgelaufen] → Apple lehnt die
  Einreichung ab, der Bau scheitert laut. Steht als Ausfallgrund in der Betriebsdoku; die
  aktualisierte Vereinbarung ist bis 02.10.2026 zu akzeptieren.
- [Hardened Runtime oder echte Signatur ändern Verhalten, das ad hoc lief] → Start und Laden
  des Servers im lokalen Netz sind belegt (Nachweise). Druck, Deeplink und „Im Browser
  anmelden“ (`ASWebAuthenticationSession`, LFH-818 hat ausdrücklich „mit signierter App“ offen
  gelassen) sind offen → Task 5.3. Die Hülle lädt keine fremden Bibliotheken.
- [Neue Signatur, neue Identität für macOS-Rückfragen] → Es gibt noch kein stabiles Release mit
  ad-hoc-App (Stand 01.10.2026, nur Alpha-Releases). Freigaben wie „lokales Netzwerk“ müssen
  also bei niemandem neu erteilt werden.
- [Secret-Leck über Logs] → Werte nur als Umgebung, GitHub maskiert Secrets; die `.p8` liegt nur
  in `$RUNNER_TEMP` des Wegwerf-Runners.
- [`.p12` enthält den privaten Schlüssel der Developer ID] → Ein Widerruf träfe alle damit
  signierten Apps des Teams. Das Zertifikat wird nur für diese App genutzt; Ablage nur in
  1Password und als Secret.

## Migration Plan

1. Secrets setzen (D3), nach Freigabe dieses Plans.
2. Workflow ändern, Prüflauf per Dispatch (D7, Stufe 2) mit Zustimmung.
3. Merge nach `alpha`. Wirksam ab dem ersten stabilen Release mit Desktop-Paketen.

Rückweg: die Änderung am Workflow zurücknehmen. Dann baut der Job wieder ad hoc, die Secrets
bleiben ungenutzt liegen.

## Nachweise (lokal, 01.10.2026, macOS 27 Apple Silicon)

Release-Bau `cargo tauri build --ci --target aarch64-apple-darwin --bundles app,dmg` im
Worktree (Stand `alpha` mit Version `1.0.0-alpha.60`), Umgebung wie D1–D3: `.p12` über
`APPLE_CERTIFICATE` (nicht aus dem Anmelde-Schlüsselbund), Notarisierung über den
API-Schlüssel `9TM77AJNCQ`, Updater-Schlüssel aus 1Password. Danach `.dmg` nach D5, Prüfungen
nach D6. Dauer insgesamt unter zwei Minuten (Bau aus dem Cache, beide Einreichungen je etwa eine
halbe Minute).

| Punkt | Ergebnis |
|---|---|
| Wegwerf-Schlüsselbund | Tauri importiert das Zertifikat („found cert … with organization "Ruben Vitt"“), danach steht in der Suchliste wieder nur `login.keychain-db` |
| App signiert | `codesign --verify --deep --strict`: valid, erfüllt die Designated Requirement; Authority `Developer ID Application: Ruben Vitt (H95J852PKP)` → `Developer ID Certification Authority` → `Apple Root CA`; `flags=0x10000(runtime)` (Hardened Runtime) |
| App notarisiert | `spctl -a -t exec`: accepted, `source=Notarized Developer ID`; `stapler validate`: ok; `syspolicy_check distribution`: „ready for distribution“ |
| `.dmg` | von Tauri signiert (Team `H95J852PKP`), Einreichung `013504de-b07f-416e-b468-182ba33b6df9` Accepted, gestapelt; `spctl -a -t open --context context:primary-signature`: accepted, `Notarized Developer ID` |
| App im `.app.tar.gz` | entpackt: `stapler validate` ok, `spctl` accepted, `Notarized Developer ID`. Tauri packt das Archiv also nach dem Stapeln |
| Updater-Signatur | `.app.tar.gz.sig` entsteht wie bisher |
| Start der notarisierten App (Hardened Runtime) | startet, lädt die gespeicherte Adresse `https://elw.local:8443/` („Seite geladen“, 08:56:39 UTC im Protokoll der Hülle), also `.local`-Auflösung und lokales Netz unverändert; die Update-Prüfung läuft an (404, es gibt noch kein stabiles Release) |

Offen bleiben der Erststart auf einem fremden Mac (5.1), die Update-Kette mit notarisierten
Bauten (5.2), Druck, Deeplink und „Im Browser anmelden“ an der signierten App (5.3) und der
Lauf auf dem GitHub-Runner (4.1).

### Nachweise der Umsetzung (lokal, 01.10.2026)

Die `run`-Blöcke des Jobs `desktop` wurden aus `artefakte.yml` gelesen (PyYAML) und unverändert
in `bash` ausgeführt; `actionlint` 1.7.12 grün (samt shellcheck der Blöcke).

| Schritt | Fall | Ergebnis |
|---|---|---|
| Wächter (Bauen) | alle fünf Secrets leer / eines leer | Abbruch, Meldung nennt genau die fehlenden |
| Wächter (Bauen) | alle gesetzt | weiter; `.p8` in `$RUNNER_TEMP/AuthKey.p8`, Rechte 600 |
| Wächter (Bauen) | Windows, alle leer | weiter (kein Abbruch) |
| Disk-Image notarisieren | Kopie des gebauten `.dmg` | Einreichung `50112a49-…` Accepted, gestapelt; `.p8` danach gelöscht |
| Prüfen | notarisiertes Bundle | grün: App, `.dmg`, App im Archiv je `Notarized Developer ID` |
| Prüfen | App ad hoc nachsigniert | rot: „nicht mit Developer ID (H95J852PKP) signiert“ |
| Prüfen | App ohne angeheftetes Ticket | rot: `stapler validate` (Exit 65) |

Befund: Apple nimmt auch ein **unsigniertes** `.dmg` ohne Code an (Einreichung `b73fafa4-…`
Accepted). Die Signatur des `.dmg` sichert also allein der Prüfschritt (`TeamIdentifier`), nicht
die Notarisierung. Der Zweig „Status ≠ Accepted“ des DMG-Schritts ließ sich lokal nicht
auslösen. Ein Fehler darin hält den Lauf trotzdem an, weil auch der Prüfschritt das Ticket
verlangt.

Unterwegs behoben: `codesign … | grep -q` schlug unter `pipefail` fälschlich an (grep endet
früh, codesign bekommt SIGPIPE). Die Prüfungen lesen die Ausgabe jetzt erst in eine Variable.

### Update-Kette mit notarisierten Bauten (Task 5.2, 01.10.2026)

Testpaar 1.0.0 und 1.0.1 aus dem Stand dieses Branches, beide über `APPLE_CERTIFICATE`
signiert und von Tauri notarisiert (Einreichungen `7e73ebb3-…` und `1683a1d3-…`, Accepted),
Endpunkt vorübergehend `http://127.0.0.1:8765/latest.json` (`dangerousInsecureTransportProtocol`),
Updater-Schlüssel wie im Release. Die Dateien sind danach aus git wiederhergestellt.

| Zeit | Ereignis |
|---|---|
| 11:15:26 | 1.0.0 mit Quarantäne aus einem Ordner gestartet, den der Finder nicht verschoben hat: macOS führt sie aus einer schreibgeschützten Kopie aus (App Translocation). Das Update wird geladen, die Installation scheitert: „Update auf 1.0.1 gescheitert: Read-only file system (os error 30)“, die App läuft als 1.0.0 weiter |
| 11:16:15 | 1.0.0 ohne Translocation gestartet, `latest.json` abgerufen, Angebot „1.0.1“ |
| 11:16:18 | „Laden“: Archiv geladen (Zugriffsprotokoll des Endpunkts) |
| 11:16:20 | „Jetzt neu starten“: läuft als 1.0.1 (`CFBundleShortVersionString`), keine Gatekeeper-Rückfrage; die ersetzte App ist `accepted`, `Notarized Developer ID`, Ticket gültig, ohne Quarantäne |

Befund Translocation: Das betrifft jede Mac-App, die sich selbst ersetzt, und nicht die
Signierung. Es trifft nur, wer die App direkt aus „Downloads“ oder aus dem geöffneten `.dmg`
startet statt aus „Programme“. Die Betriebsdoku sagt das jetzt ausdrücklich.

### Erststart auf einem fremden Mac (Task 5.1, 01.10.2026)

Frische macOS-VM in Parallels, die die App nie gesehen hat. Das lokal notarisierte `.dmg` (Bau
aus „Nachweise“, gestapelt) hat die VM (`10.211.55.7`) um 11:17:37 per Safari vom Host geladen,
die Quarantäne war also gesetzt (Zugriffsprotokoll des Host-Servers). App nach „Programme“
gezogen und gestartet: Ruben bestätigt „funktioniert alles“, also kein „kann nicht geöffnet
werden“ und kein Umweg über „Datenschutz & Sicherheit“. Den genauen Wortlaut der Rückfrage hat
niemand festgehalten. Das `.dmg` aus dem CI-Lauf (Task 4.2) ist auf demselben Weg entstanden
wie dieses.
