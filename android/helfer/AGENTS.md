# Helfer-App Android — Regeln

Gilt für `android/helfer/` und den Kern `android/helferkern/`, zusätzlich zu `android/AGENTS.md`
und der Wurzel. Entscheidung: ADR-0098; Herleitung: `docs/superpowers/specs/2026-11-24-vakwvkpg-helfer-app-design.md`.

- **Eigene native App** (`dev.rubeen.lifeline.helfer`, Compose), kein WebView. „Keine
  Anwendungslogik in der Hülle“ aus `android/AGENTS.md` gilt hier nicht; die Lifeline-Hülle
  bleibt davon unberührt.
- **Logik im Kern:** was ohne Android-SDK geht, steht in `android/helferkern` mit Tests (nur ein
  JDK nötig). `android/helfer` bleibt dünn: Oberfläche, Dienst, Systemdienste.
- **Nur der Server der Kopplung:** die App sendet an keinen anderen Server und nur mit der
  Sitzung dieser Kopplung.
- **Ortung** (ADR-0098): nur ein Vordergrund-Dienst vom Typ `location`, nie
  `ACCESS_BACKGROUND_LOCATION`; nur solange eine Kopplung besteht, Start nur aus dem Vordergrund;
  sichtbar durch die Benachrichtigung des Dienstes. Kein Verlauf, nur die letzte Position, nur im
  Speicher.
- **Design-Tokens** nur aus dem Generator `scripts/design/tokens-nativ.mjs`, nie von Hand in
  `Tokens.kt`.
