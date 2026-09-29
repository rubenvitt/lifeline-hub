# Tasks

## 1. Messaufbau

- [x] 1.1 Wegwerf-Prototyp außerhalb des Repos (`~/dev/personal/lfh-720-tauri-spike`, Stand
  `d9af36f`): Hülle, Erststart-Maske, Deeplink, Diagnose-Skript, Steuerkanal.
- [x] 1.2 Messserver: Prod-Bundle, `--tls` mit mkcert, `elw.local` per mDNS, OIDC gegen
  PocketID, Demo-Daten, Offline-Karte.
- [x] 1.3 Windows: Cross-Build `x86_64-pc-windows-gnu`, Windows-11-VM mit mkcert-CA im
  Stammspeicher, Steuerung über `prlctl exec`.

## 2. Messung je Punkt und Plattform

- [x] 2.1 Anmeldung: Passwort, OIDC, Passkey (macOS und Windows).
- [x] 2.2 SSE: sichtbar (Windows), minimiert und verdeckt (beide), mit und ohne
  `background_throttling` (macOS), VM-Suspend (Windows).
- [x] 2.3 Service Worker, Precache, Kaltstart ohne Server, Offline-Queue mit Nachsenden (beide,
  macOS zusätzlich gegen `elw.local`).
- [x] 2.4 MapLibre mit Offline-Karte (beide).
- [x] 2.5 Upload per Dateidialog und Download (beide).
- [x] 2.6 Serveradresse beim Erststart und per Deeplink (beide).
- [x] 2.7 Zusatzpunkte: Druck, neue Fenster, Sitzung über Neustart, Laufzeit-Capability.

## 3. Ergebnis

- [x] 3.1 Messprotokoll mit Belegen in `design.md` und `belege/`.
- [x] 3.2 Empfehlung: Variante A trägt, Auflagen als Anforderungen in
  `specs/desktop-huelle/spec.md`.
- [x] 3.3 Folgetickets für Server- und App-Befunde im Entwicklungsboard.
