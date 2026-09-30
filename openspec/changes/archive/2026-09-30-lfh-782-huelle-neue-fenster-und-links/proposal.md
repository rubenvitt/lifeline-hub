# Proposal

## Why

In der Desktop-Hülle aus LFH-721 laufen drei Wege heute ins Leere, gemessen in LFH-720
(Befund „Neue Fenster und Datei-Links“). `window.open` liefert `null`, und ein
`target="_blank"` öffnet nichts. Ein Datei-Link ohne `download` ersetzt in WKWebView die ganze
Anwendung durch die Datei, ohne Weg zurück. Betroffen sind Chat-Anhänge, die externen Links im
Fachebenen-Inspector und „in neuem Tab öffnen“ der Sprungpalette. LFH-721 hat das bewusst
ausgeklammert. Dieser Change löst die Auflage „Neue Fenster und fremde Links laufen nicht ins
Leere“ aus `desktop-huelle` ein. Er ist auf LFH-721 gestapelt, weil die Hülle erst dort
entsteht.

## What Changes

- **Hülle: neue Fenster.** Ein Ziel auf der Origin des verbundenen Servers öffnet ein
  **Nebenfenster** der Hülle. Es bekommt dieselbe Sitzung, denselben Druckweg und dieselbe
  Link-Behandlung. Liefert das Ziel eine Datei (`/api/…`), wird sie heruntergeladen, statt
  ein Fenster zu öffnen. Ein Ziel mit `http`, `https`, `mailto` oder `tel` auf fremder
  Origin öffnet der Standardbrowser bzw. das zuständige Systemprogramm. Alles andere wird
  verworfen und protokolliert.
- **Hülle: Navigation im Fenster.** Eine Navigation auf eine Dateiroute der eigenen Origin
  (`/api/…`, außer `/api/auth/…`) wird zum Download, die Anwendung bleibt stehen. `mailto:` und
  `tel:` gehen an das Systemprogramm. Fremde `http(s)`-Navigationen bleiben erlaubt, denn die
  OIDC-Anmeldung führt im Fenster zum Identitätsanbieter und zurück.
- **Hülle: Serverwechsel** schließt offene Nebenfenster. Die Druckfreigabe der Serverseite
  gilt auch in Nebenfenstern.
- **Frontend: Chat-Anhänge** laden über `<a download>` (`DownloadAnker`) wie ETB-, Schaden- und
  Dokument-Anhänge. Sie brauchen dann keinen Hüllen-Sonderweg mehr und laden auch im Browser
  herunter, statt einen Tab zu öffnen.
- Neue Abhängigkeit der Hülle: `tauri-plugin-opener` (nur Rust-seitig, keine JS-Freigabe).

## Capabilities

### New Capabilities

Keine.

### Modified Capabilities

- `desktop-huelle`: Requirement „Neue Fenster und fremde Links laufen nicht ins Leere“ wird
  präzisiert: Nebenfenster statt Ersetzen, Dateiantworten der eigenen Origin, Ausnahme für die
  Anmeldung, erlaubte Schemata und Nebenfenster beim Serverwechsel.

## Impact

- `src-tauri/src/` (neues Modul für die reine Link-Entscheidung, Verdrahtung in `main.rs`),
  `src-tauri/Cargo.toml` (`tauri-plugin-opener`), Druckfreigabe für Nebenfenster.
- `frontend/src/chat/NachrichtenStrom.tsx` und der Dateikopf von
  `frontend/src/components/DownloadAnker.tsx`.
- `docs/betrieb/desktop-app.md`: LFH-782 fällt aus „Grenzen (offen)“, das Verhalten kommt in
  die Beschreibung. `CLAUDE.md`, Abschnitt Desktop-Hülle: eine Zeile zur Link-Entscheidung.
- Kein Server-, API- oder Migrationsanteil. Palette und Inspector bleiben im Frontend
  unverändert. Die Hülle fängt ihre Wege ab.
- Integration: PR gegen `alpha` erst, wenn LFH-721 dort liegt. Bis dahin ist der Branch auf
  `feat/lfh-721-desktop-app-paketieren` gestapelt.
