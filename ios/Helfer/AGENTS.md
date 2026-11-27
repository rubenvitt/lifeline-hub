# Helfer-App iOS — Regeln

Gilt für `ios/Helfer/` und den Kern `ios/HelferKern/`, zusätzlich zu `ios/AGENTS.md` und der
Wurzel. Entscheidung: ADR-0101; Herleitung: `docs/superpowers/specs/2026-11-24-vakwvkpg-helfer-app-design.md`.

- **Eigene native App** (`dev.rubeen.lifeline.helfer`, SwiftUI), kein Webview. „Keine
  Anwendungslogik in der Hülle“ aus `ios/AGENTS.md` gilt hier nicht; die Lifeline-Hülle bleibt
  davon unberührt.
- **Logik im Kern:** was ohne UIKit, CoreLocation und SwiftUI geht, steht in `ios/HelferKern` mit
  Tests (`swift test`). `ios/Helfer` bleibt dünn: Ansichten, Systemdienste.
- **Nur der Server der Kopplung:** die App sendet an keinen anderen Server und nur mit der
  Sitzung dieser Kopplung. Anfragen nur über `App/Dienste/Serververbindung.swift`, ohne
  Weiterleitungen (`OhneWeiterleitung`; eine 3xx-Antwort gilt als Serverfehler), der Code der
  Einladung nie in der Adresse (`POST …/helpers/targets` mit `{code}`).
- **Ruhe statt Ende** (403 `no_role`/`tracking_off`): Phase `ruht` im Kern, Ortung und
  Live-Aktivität aus, Kopplung und Sitzung bleiben; die App prüft jede Minute (Zustand, bei Ortung
  aus dazu `{paused: false}`) und ortet wieder, wenn der Kern es entscheidet, gestartet nur im
  Vordergrund. Ohne Ortungsgerät und Person startet sie gar nicht erst.
- **Ortung** (ADR-0101): nur „When in Use“ plus `UIBackgroundModes location`, nie
  `NSLocationAlways…`; nur solange eine Kopplung besteht, Start nur aus dem Vordergrund; sichtbar
  durch Standortanzeige und Live-Aktivität. Kein Verlauf, nur die letzte Position, nur im
  Speicher.
- **Design-Tokens** nur aus dem Generator `scripts/design/tokens-nativ.mjs`, nie von Hand in
  `Tokens.swift`.
- **Version** nur aus `scripts/ios/helfer-version.sh` (eigene Zählung, nicht `[workspace.package]`),
  Build-Nummer aus `ios-helfer.yml`; TestFlight über `scripts/ios/testflight.sh --app helfer`.
- **Seite und Wirkung aus dem Kern:** welche Seite gilt, entscheidet `Anmeldung`, was der
  Ortungsdienst wann sendet `Sendeplan` (Takt, Puffer, Wiederholung, Lebenszeichen nur mit frischer
  Messung), feste Texte `Anzeige`; `App/Modell/HelferModell.swift` und
  `App/Dienste/Ortungsdienst.swift` führen nur aus. Jede Seite hat ein Bild in
  `ios/HelferUITests` (Startargument `-HelferTestzustand <seite>`, ohne Netz und Ablage).
- **Aufträge (Stufe 2, ADR-0111):** Push nur über das Relais an das Ziel `LifelineHelfer`
  (`aps-environment`), entschlüsselt im Mitteilungsdienst `ios/Helfer/Dienst`
  (`dev.rubeen.lifeline.helfer.dienst`). Ordnung der Liste, Quittungsstand, Nutzlast und
  „Mitteilung ja/nein“ entscheidet `HelferKern` (`Auftraege`, `PagerNutzlast`) mit den Fällen
  `src-tauri/faelle/helfer-auftrag.json`. Pager (LLH-2157): Ton `Helfer/App/Pagerton.caf` (nur aus
  `scripts/helfer/pagerton.sh`), Erinnerungen schickt der Server (`w` im Klartext → „Erinnerung · “). Keine eigene Live-Verbindung: offen lädt die App bei
  Push und beim Öffnen neu. Aufträge nie auf die Platte. Mitteilungen abgelehnt → Hinweis in
  „Angemeldet“.
