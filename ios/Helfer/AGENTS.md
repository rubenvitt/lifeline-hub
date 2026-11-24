# Helfer-App iOS — Regeln

Gilt für `ios/Helfer/` und den Kern `ios/HelferKern/`, zusätzlich zu `ios/AGENTS.md` und der
Wurzel. Entscheidung: ADR-0098; Herleitung: `docs/superpowers/specs/2026-11-24-vakwvkpg-helfer-app-design.md`.

- **Eigene native App** (`dev.rubeen.lifeline.helfer`, SwiftUI), kein Webview. „Keine
  Anwendungslogik in der Hülle“ aus `ios/AGENTS.md` gilt hier nicht; die Lifeline-Hülle bleibt
  davon unberührt.
- **Logik im Kern:** was ohne UIKit, CoreLocation und SwiftUI geht, steht in `ios/HelferKern` mit
  Tests (`swift test`). `ios/Helfer` bleibt dünn: Ansichten, Systemdienste.
- **Nur der Server der Kopplung:** die App sendet an keinen anderen Server und nur mit der
  Sitzung dieser Kopplung.
- **Ortung** (ADR-0098): nur „When in Use“ plus `UIBackgroundModes location`, nie
  `NSLocationAlways…`; nur solange eine Kopplung besteht, Start nur aus dem Vordergrund; sichtbar
  durch Standortanzeige und Live-Aktivität. Kein Verlauf, nur die letzte Position, nur im
  Speicher.
- **Design-Tokens** nur aus dem Generator `scripts/design/tokens-nativ.mjs`, nie von Hand in
  `Tokens.swift`.
