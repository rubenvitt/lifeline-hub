# Proposal

## Why

Der Windows-Installer der Desktop-App (LFH-721) ist unsigniert. SmartScreen zeigt beim ersten
Start „Unbekannter Herausgeber“ und lässt ihn nur über „Weitere Informationen“ → „Trotzdem
ausführen“ zu (`docs/betrieb/desktop-app.md`, Installation); verwaltete Rechner blockieren
unsignierte Installer oft ganz. macOS ist seit LFH-722 signiert und notarisiert, Windows wurde
bewusst ausgelagert, weil die Wahl des Zertifikats für eine Einzelperson in Deutschland offen
war. Diese Change trifft die Wahl und baut den Signierschritt in den Release-Lauf.

## What Changes

- Der Release-Lauf signiert auf Windows die App (`lifeline-desktop.exe`), den Deinstaller und
  den NSIS-Installer per Authenticode mit einem OV-Code-Signing-Zertifikat auf den Namen
  „Ruben Vitt“, jeweils mit Zeitstempel. Der Schlüssel liegt beim Aussteller in der Cloud
  (HSM-Pflicht seit 2023), nicht im Repo.
- Signiert wird innerhalb von `cargo tauri build`, also vor der Updater-Signatur (`.sig`). Die
  Update-Kette bleibt dadurch unverändert.
- Fehlt ein Zugangsdatum oder scheitert die Signatur, bricht der Windows-Bau ab. Ein
  unsignierter Installer wird nie mehr ausgeliefert; macOS bleibt davon unberührt.
- Ein Prüfschritt im Lauf belegt Signatur, Herausgeber und Zeitstempel für Installer, App und
  den Deinstaller im Installer, bevor etwas ans Release geht.
- Lokale Bauten bleiben unsigniert (`tauri.conf.json` unverändert), erst die Umgebung des
  Release-Laufs setzt den Signierbefehl.
- **Akzeptanzkriterium (entschieden 04.10.2026):** Windows zeigt „Ruben Vitt“ als Herausgeber.
  „Ohne SmartScreen-Warnung“ ist **kein** Kriterium: Seit 2024 baut auch ein EV-Zertifikat die
  SmartScreen-Reputation erst über Downloads auf, die ersten Releases können also weiter
  warnen, dann aber mit Herausgeber statt „Unbekannt“.
- Betriebsdoku: Installation, neue Secrets mit Ablage in 1Password, Kosten, Laufzeit (höchstens
  460 Tage je Zertifikat) und Verlängerung.

## Capabilities

### New Capabilities

_keine_

### Modified Capabilities

- `desktop-auslieferung`: neue Anforderung, dass der Windows-Installer eines Releases samt App
  und Deinstaller Authenticode-signiert und zeitgestempelt ist und der Lauf sonst kein
  Windows-Paket ausliefert.

## Impact

- **Beschaffung (Ruben, kostenpflichtig):** Zertifikat und Cloud-Signierdienst nach D1 in
  `design.md`, Identitätsprüfung beim Aussteller. Ohne sie lässt sich die Change nicht umsetzen.
- `.github/workflows/artefakte.yml`, Job `desktop` (nur der Matrix-Eintrag
  `desktop-windows-x86_64`): Signierwerkzeug, Wächter, `--config` mit `signCommand`,
  Prüfschritt.
- GitHub-Secrets (Repository): vier neue Werte für den Signierdienst, gesetzt aus 1Password
  (Tresor Dev).
- `docs/betrieb/desktop-app.md`: Installation, Abschnitt „Signierung (Windows)“, Kosten,
  Grenzen.
- `src-tauri/AGENTS.md`: ein Satz, wo die Windows-Signierung getragen wird.
- Kein Code in `src-tauri/src`, keine Änderung an der Laufzeit der Hülle.
