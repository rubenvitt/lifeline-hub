# Proposal

## Why

LFH-128 Phase 1 verpackt Lifeline Hub als Desktop-App. Am 25.09.2026 fiel die Entscheidung
für **Variante A**: Der Tauri-Webview lädt die https-Adresse des Servers, die Anwendung bleibt
same-origin. Damit entfallen CORS, der Cookie-/Token-Umbau, WebAuthn-`rp_origin`-Sonderfälle
und eine Basis-URL im Frontend (Varianten B/C). Ob das trägt, hängt an Fähigkeiten der beiden
Webviews, die niemand gemessen hat: WKWebView (macOS) und WebView2 (Windows). Das größte
Risiko ist der Service Worker samt Offline-Queue in WKWebView. LFH-720 misst das mit einem
Wegwerf-Prototyp, bevor Phase 1 Produktcode schreibt.

## What Changes

- **Kein Produktcode.** Der Prototyp liegt außerhalb des Repos
  (`~/dev/personal/lfh-720-tauri-spike`, eigenes Git-Repo, Stand im Protokoll zitiert). Auf
  `alpha` landet nur dieser Change mit Messprotokoll, Belegen und Empfehlung.
- **Messprotokoll** je Punkt und Plattform (funktioniert / eingeschränkt / geht nicht, mit
  Beleg) in `design.md`, Rohdaten unter `belege/`.
- **Empfehlung** für LFH-128 Phase 1: trägt Variante A, oder welcher Punkt zwingt zu B/C.
  Dazu je Befund die Frage, ob B/C ihn überhaupt lösen würde.
- **Anforderungen an die Hülle** (`specs/desktop-huelle/spec.md`): die gemessenen
  Randbedingungen, die Phase 1 einhalten muss (https-Pflicht, Freigabe „Lokales Netzwerk“,
  Hintergrunddrosselung, Sitzungsdauer, Downloads).

## Capabilities

### New Capabilities

- `desktop-huelle`: Tauri-2-Hülle, die eine konfigurierte Serveradresse lädt (Variante A).

### Modified Capabilities

Keine.

## Impact

- Kein Code, keine Migration, keine API-Änderung in diesem Change.
- Folgetickets für die Befunde, die Serveränderungen verlangen (z. B. Sitzungscookie).
