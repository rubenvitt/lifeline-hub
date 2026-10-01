# Proposal

## Why

Die macOS-App aus LFH-721 ist nur ad hoc signiert. Beim ersten Start blockiert Gatekeeper sie
deshalb mit „kann nicht geöffnet werden“, ab macOS 15 nur über „Datenschutz & Sicherheit“ →
„Dennoch öffnen“ zu umgehen (`docs/betrieb/desktop-app.md`, Installation). Für Helfer an
ELW-Rechnern ist das eine Hürde. Die Beschaffung ist erledigt (Developer ID, API-Schlüssel für
die Notarisierung, 01.10.2026), und die Build-Matrix aus LFH-721 steht, also fehlt nur der
Schritt im Release-Lauf.

## What Changes

- Der Release-Lauf signiert die macOS-App mit dem Zertifikat „Developer ID Application“
  (Hardened Runtime), lässt sie von Apple notarisieren und heftet das Ticket an (Stapling).
  Dasselbe geschieht mit dem `.dmg`. Das Update-Archiv enthält die notarisierte App.
- Fehlt ein Zugangsdatum oder scheitert die Notarisierung, bricht der macOS-Bau ab. Ein nur
  signiertes oder ad hoc signiertes Paket wird nie ausgeliefert. Tauri selbst überspringt die
  Notarisierung ohne Zugangsdaten nur mit einer Warnung.
- Ein Prüfschritt im Lauf belegt Signatur, Notarisierung und Gatekeeper-Urteil für App, `.dmg`
  und die App im Update-Archiv, bevor etwas ans Release geht.
- Lokale Bauten bleiben ad hoc signiert (`tauri.conf.json` unverändert). Erst die Umgebung des
  Release-Laufs setzt die Identität.
- Betriebsdoku: Installation ohne Umweg, neue Secrets mit Ablage in 1Password, Kosten und
  Verlängerungstermine.
- Windows bleibt unsigniert und ist nach LFH-875 ausgelagert.

## Capabilities

### New Capabilities

_keine_

### Modified Capabilities

- `desktop-auslieferung`: neue Anforderung, dass macOS-Pakete eines Releases mit Developer ID
  signiert und notarisiert sind und der Lauf sonst kein macOS-Paket ausliefert.

## Impact

- `.github/workflows/artefakte.yml`, Job `desktop` (nur der Matrix-Eintrag
  `desktop-macos-arm64`): Umgebung für Signierung und Notarisierung, Wächter,
  DMG-Notarisierung, Prüfschritt.
- GitHub-Secrets (Repository): fünf neue `APPLE_*`-Werte, gesetzt aus 1Password (Tresor Dev).
- `docs/betrieb/desktop-app.md`: Installation, Secrets, Kosten, Grenzen.
- `src-tauri/AGENTS.md`: ein Satz zur Signierung (wo sie getragen wird).
- Kein Code in `src-tauri/src`, keine Änderung an der Laufzeit der Hülle.
- Laufzeit des macOS-Baus steigt um die Notarisierung (typisch wenige Minuten je Einreichung,
  zwei Einreichungen).
