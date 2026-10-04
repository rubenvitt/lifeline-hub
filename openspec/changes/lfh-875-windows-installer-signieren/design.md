# Design

## Context

Motivation: `proposal.md`. Ausgangslage im Repo (Stand `alpha`, 04.10.2026):

- `.github/workflows/artefakte.yml`, Job `desktop`: Matrix `desktop-windows-x86_64`
  (`windows-latest`, `--bundles nsis`), gebaut mit `cargo tauri build --ci` (Tauri-CLI 2.12.0,
  gepinnt; sie pinnt `tauri-bundler = 2.10.0`). Der Job checkt **den Tag** aus, die
  Workflow-Datei kommt vom Ref des Laufs (wie bei LFH-722, D6).
- `src-tauri/tauri.conf.json`: `bundle.windows` setzt nur `nsis` (`installMode: currentUser`,
  Deutsch), keinen `signCommand` und keinen `certificateThumbprint`.
- Desktop-Pakete entstehen nur zu stabilen Tags; ein stabiles Release gibt es noch nicht
  (README: „Es gibt noch kein Release“). Bisher hat also niemand den Windows-Installer aus einem
  Release installiert.
- Das Repo steht unter **keiner** Open-Source-Lizenz (README, „Lizenz — alle Rechte
  vorbehalten“). Das schließt zwei sonst naheliegende Wege aus (D1).

Was Tauri tut (gelesen in `tauri-bundler-2.10.0/src/bundle.rs`,
`…/bundle/windows/{sign.rs,nsis/mod.rs,nsis/installer.nsi}`, `tauri-cli-2.12.0/src/{build.rs,bundle.rs}`):

- Signiert wird, sobald `bundle.windows.signCommand` oder `certificateThumbprint` gesetzt ist
  (`can_sign`). Dann signiert der Bundler die Haupt-Binary, etwaige Sidecars, den
  NSIS-Deinstaller (über `!uninstfinalize` beim `makensis`-Lauf) und zuletzt den Installer.
- Ein eigener `signCommand` (`{cmd, args}`) ersetzt `signtool`; `%1` wird durch den Dateipfad
  ersetzt, relative Pfade in `args` werden absolut.
- Die Updater-Signatur (`.sig`, minisign) rechnet die CLI **nach** dem Bündeln über die fertige
  Datei (`sign_updaters`). Ein Authenticode-Signieren innerhalb des Bündelns landet also in den
  Bytes, die der Updater prüft.
- `cargo tauri build --config <JSON>` mischt einen Konfigurationsteil zur Laufzeit dazu.

Recherche zu den Wegen (04.10.2026):

| Weg | Für Einzelperson in DE? | Kosten | Herausgeber | CI-Anbindung |
|---|---|---|---|---|
| Azure Artifact Signing (vormals Trusted Signing) | **nein**, Einzelpersonen nur USA/Kanada ([Microsoft Learn, Stand 29.08.2026](https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/code-signing-options)) | ~10 $/Monat | – | offiziell |
| SSL.com IV-Zertifikat + eSigner (Cloud) | ja | 129 $/Jahr + eSigner ab 15 $/Monat (240 Signaturen) ≈ 310 $/Jahr ([IV](https://www.ssl.com/products/software-integrity/code-signing/iv/), [eSigner-Preise](https://www.ssl.com/guide/esigner-pricing-for-code-signing/)) | „Ruben Vitt“ | **offiziell**: `CodeSignTool` mit TOTP-Secret, eigene GitHub-Action ([Anleitung](https://www.ssl.com/how-to/cloud-code-signing-integration-with-github-actions/)) |
| Certum Standard Code Signing, SimplySign (Cloud) | ja | 209 € brutto im ersten Jahr ([Shop](https://shop.certum.eu/code-signing.html)) | „Ruben Vitt“ | nur **inoffiziell**: SimplySign Desktop per GUI-Automatisierung auf dem Windows-Runner oder nachgebaute HTTPS-Schnittstelle (z. B. `jay0lee/certum-cloud-code-sign`, `Le-Syl21/ssign`) |
| Certum Open Source Code Signing (SimplySign) | formal ja | ab 49 € | „Open Source Developer, Ruben Vitt“ | wie Certum Standard |
| SignPath Foundation | nein, verlangt eine OSI-Lizenz | kostenlos | „SignPath Foundation“ | offiziell |
| EV-Zertifikat | ja | ab ~400 $/Jahr | Name | je nach CA |

SmartScreen: Seit 2024 gibt auch EV keine sofortige Reputation mehr; OV, EV und Azure bauen sie
gleich über Downloads auf. Microsoft rät EV „nicht mehr“ für SmartScreen ([Microsoft
Learn](https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/code-signing-options)).
Laufzeit: Seit 01.03.2026 höchstens **460 Tage** je Code-Signing-Zertifikat (CA/B Forum,
Ballot CSC-31), auch bei Mehrjahreskauf wird also etwa jährlich neu ausgestellt.

## Goals / Non-Goals

**Goals:**
- Windows nennt „Ruben Vitt“ als Herausgeber statt „Unbekannter Herausgeber“.
- Kein stilles Zurückfallen auf einen unsignierten Installer.
- Signaturen bleiben über den Ablauf des Zertifikats hinaus gültig (Zeitstempel).
- Update-Kette unverändert.

**Non-Goals:**
- SmartScreen ohne jede Warnung ab dem ersten Release (mit keinem Weg zusagbar, s. Context).
- Microsoft Store oder MSIX. Das ersetzte NSIS und den Tauri-Updater und ist eine eigene Frage.
- Signierte lokale Entwicklerbauten.
- ARM64-Windows.

## Decisions

### D1 — SSL.com IV-Zertifikat mit eSigner (Empfehlung, zur Entscheidung)

Ein Zertifikat „Individual Validation“ von SSL.com, der Schlüssel im Cloud-HSM von eSigner,
signiert im Lauf mit `CodeSignTool`.

Begründung: Es ist der einzige Weg, der für eine Einzelperson in Deutschland ohne
Open-Source-Lizenz offen ist **und** eine vom Aussteller getragene CI-Anbindung hat. Der
Release-Lauf darf nicht an einer GUI-Automatisierung hängen, die beim nächsten Update von
SimplySign Desktop bricht.

Verworfen:
- **Certum Standard (SimplySign):** rund 50 € im Jahr günstiger, aber die Anbindung an GitHub
  Actions gibt es nur aus der Community (Anmeldung per Tastatureingaben in SimplySign Desktop
  oder eine nachgebaute Schnittstelle). Bleibt die zweite Wahl, falls Kosten schwerer wiegen als
  Verlässlichkeit; dann ändern sich nur D3 und D4.
- **Certum Open Source:** Das Zertifikat trägt „Open Source Developer“, das Repo ist aber
  ausdrücklich nicht quelloffen. Certum widerruft, wenn die Grundlage nicht stimmt. Wäre nur mit
  einer Open-Source-Lizenz vertretbar, und das ist eine eigene Entscheidung.
- **SignPath Foundation:** verlangt eine OSI-Lizenz, und als Herausgeber stünde die Stiftung.
- **Azure Artifact Signing:** für Einzelpersonen außerhalb USA/Kanada nicht verfügbar.
- **EV:** teurer, gleiche SmartScreen-Wirkung wie OV.

### D2 — Signieren innerhalb von Tauri, Signierbefehl nur im Release-Lauf

Der Bauschritt auf Windows ruft `cargo tauri build --ci … --config '{"bundle":{"windows":{"signCommand":{…}}}}'`.
Tauri signiert dann App, Deinstaller und Installer in der richtigen Reihenfolge und rechnet die
`.sig` über den signierten Installer.

Verworfen:
- **`signCommand` in `tauri.conf.json`:** Jeder lokale Windows-Bau bräuchte den Signierdienst
  (gleiches Muster wie LFH-722, D2).
- **Nach dem Bau signieren:** Der Deinstaller steckt dann unsigniert im Installer, und die
  `.sig` passte nicht mehr; sie müsste neu gerechnet werden.

### D3 — Ein Wrapper im Lauf, Zugangsdaten nur als Umgebung

Der `signCommand` ruft `pwsh -NoProfile -File $RUNNER_TEMP/signiere.ps1 %1`. Das Skript liest
die Zugangsdaten aus der Umgebung und ruft `CodeSignTool sign … -input_file_path <datei>
-override`. Es entsteht inline im Workflow (wie die Prüfungen in LFH-722, D6), weil der Job den
Tag auscheckt und ein neues Repo-Skript auf älteren Tags fehlte.

Warum nicht die Zugangsdaten direkt in `args`: Tauri schreibt den Deinstaller-Befehl samt
Argumenten in die erzeugte `installer.nsi` und protokolliert Befehle. So stehen dort nur Pfade.

`CodeSignTool` wird in fester Version mit geprüfter SHA-256 geladen (Java bringt der
`windows-latest`-Runner mit).

### D4 — Vier Secrets

| Secret | Inhalt | Quelle (1Password, Tresor Dev) |
|---|---|---|
| `ESIGNER_USERNAME` | Benutzername des SSL.com-Kontos | „Lifeline Hub – Windows-Signierung (SSL.com eSigner)“ |
| `ESIGNER_PASSWORD` | Passwort | derselbe Eintrag |
| `ESIGNER_CREDENTIAL_ID` | Credential-ID des Zertifikats | derselbe Eintrag |
| `ESIGNER_TOTP_SECRET` | TOTP-Secret aus der eSigner-Einrichtung | derselbe Eintrag |

Gesetzt nach dem Muster der Betriebsdoku (`op read … | gh secret set …`, Eintrags-ID statt Name).

### D5 — Zwei Wächter gegen einen unsignierten Installer

1. **Vorher:** Auf `*windows*` bricht der Bauschritt ab, wenn eines der vier Secrets leer ist.
2. **Nachher:** Der Prüfschritt (D6) scheitert, wenn eine Signatur fehlt oder fremd ist.
   Tauri bricht bei einem fehlschlagenden `signCommand` selbst ab (`output_ok`).

Scheitert Windows, entfällt es aus `latest.json`, macOS bleibt unberührt (LFH-721,
`!cancelled()`).

### D6 — Prüfschritt: installieren und nachsehen

Nach dem Bau, vor „Pakete einsammeln“, in PowerShell:

- `Get-AuthenticodeSignature` für den Installer: `Status = Valid`, Herausgeber `CN=Ruben Vitt`,
  `TimeStamperCertificate` gesetzt.
- Den Installer still installieren (`/S`, `currentUser` braucht keine Adminrechte), dann
  dieselben Prüfungen für die installierte `lifeline-desktop.exe` und den Deinstaller, danach
  still deinstallieren. Der Deinstaller wird erst bei der Installation geschrieben, er lässt
  sich also nicht aus dem Installer auspacken.

Verworfen: nur `signtool verify /pa` am Installer. Das belegte weder App noch Deinstaller.

### D7 — Nachweis in drei Stufen

1. **CI vor dem Merge:** `gh workflow run artefakte.yml --ref <Branch> -f tag=<jüngster
   Alpha-Tag> -f desktop=true`, mit Zustimmung, weil der Lauf auch Server-Artefakte neu baut
   und Pakete ans Alpha-Release hängt (wie LFH-722, D7).
2. **Fremder Windows-Rechner von Hand:** Installer per Browser laden (Mark of the Web gesetzt),
   starten. Erwartet: Herausgeber „Ruben Vitt“; Eigenschaften → Digitale Signaturen gültig.
3. **Update-Kette:** Testpaar 1.0.0 → 1.0.1, beide signiert, lokales Manifest (Verfahren aus
   LFH-721/LFH-722).

### D8 — Erst kaufen, wenn ein stabiles Release absehbar ist

Das Zertifikat läuft höchstens 460 Tage. Desktop-Pakete gehen nur mit stabilen Releases raus,
und SmartScreen-Reputation entsteht nur durch Downloads. Bis dahin verfiele bezahlte Laufzeit.
Ein Merge ohne gesetzte Secrets ließe den Windows-Bau an D5 scheitern, das nächste stabile
Release hätte also keinen Windows-Installer. Deshalb: Plan jetzt freigeben, kaufen, wenn das
erste stabile Release ansteht, dann umsetzen und mergen.

### D9 — Betriebsdoku

`docs/betrieb/desktop-app.md`: Installation (SmartScreen nennt den Herausgeber, kann anfangs
noch fragen), Abschnitt „Signierung (Windows)“ mit Secrets, Ablage, Kosten, Laufzeit und
Verlängerung, Vorgehen bei Ablauf oder verlorenem TOTP-Secret, Grenzen aktualisiert.

## Risks / Trade-offs

- [eSigner gestört] → Windows fällt aus dem Release, macOS nicht (D5). Nachbau per Dispatch.
- [SmartScreen warnt trotz Signatur] → erwartet, bis Reputation aufgebaut ist. Die Doku sagt
  das, und das Akzeptanzkriterium verlangt nur den Herausgeber.
- [Neues Zertifikat nach 460 Tagen] → Gleicher Antragsteller, gleicher Name. Reputation hängt
  an Datei und Herausgeber; ob sie beim Zertifikatswechsel ganz erhalten bleibt, sagt Microsoft
  nicht zu.
- [TOTP-Secret und Passwort zusammen erlauben Signieren im Namen von Ruben Vitt] → nur in
  1Password und als Secret, GitHub maskiert sie; bei Verdacht Zertifikat bei SSL.com widerrufen
  und neu ausstellen lassen.
- [Laufende Kosten ≈ 310 $/Jahr für ein Projekt ohne Release] → D8: Kauf erst, wenn es
  gebraucht wird.

## Migration Plan

1. Plan freigeben (Anbieter nach D1, Akzeptanzkriterium nach proposal.md).
2. Wenn das erste stabile Release ansteht: Zertifikat und eSigner kaufen, Identität prüfen
   lassen, Zugangsdaten in 1Password, Secrets setzen (D4).
3. Workflow ändern, Prüflauf per Dispatch mit Zustimmung (D7).
4. Merge nach `alpha`. Wirksam ab dem nächsten Release mit Desktop-Paketen.

Rückweg: die Workflow-Änderung zurücknehmen; der Installer ist dann wieder unsigniert, die
Secrets bleiben ungenutzt.

## Open Questions

- Version und Prüfsumme von `CodeSignTool` zum Zeitpunkt der Umsetzung.
- Ob eSigner vor dem Signieren eine Schadsoftware-Prüfung verlangt und wie lange sie je Datei
  dauert (drei Signaturen je Lauf).
