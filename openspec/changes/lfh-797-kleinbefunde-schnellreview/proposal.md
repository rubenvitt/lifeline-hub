# Proposal

## Why

Das Schnell-Review vom 29.09.2026 (LFH-797) fand drei Sorten Kleinbefunde, die je für sich
klein sind, aber jeweils eine bestehende Regel unterlaufen: Schutzköpfe hängen an einzelnen
Routen statt am Server, fünf Einsatzpfade sind als Template-Literal gebaut statt über
`routing/deeplinks.ts`, und feste Farbwerte stehen mehrfach verstreut, teils auf dunklem Grund
unsichtbar. Der Scan auf `origin/alpha` (`1fcd591`) zeigt: Ein Teil ist inzwischen erledigt
(Anhang-Downloads tragen `nosniff` seit LFH-759, der Standardstern trägt seit LFH-704 die Rolle
`schwach`). Offen bleiben die Lücken unten.

## What Changes

- **`nosniff` an jeder Antwort:** Eine globale Response-Schicht in `src/app.rs` setzt
  `X-Content-Type-Options: nosniff`, wo die Route ihn nicht schon setzt. Heute fehlt er u. a. am
  Download des Karten-Hintergrundbilds (`routes::karte_hintergrundbild::herunterladen`), an allen
  JSON- und Fehlerantworten und an den eingebetteten Frontend-Dateien. Die bestehenden
  Einzel-Header (Anhang, Logo, Karten-Assets) bleiben. Regel in `src/AGENTS.md`.
- **Einsatzpfade nur aus `routing/deeplinks.ts`:** Die fünf verbliebenen Inline-Pfade
  (`etb/Schnellerfassung.tsx`, `pages/uhs/UhsDetailPage.tsx`,
  `pages/bereitstellungsraum/BrDetailPage.tsx`,
  `pages/bereitstellungsraum/BereitstellungsraeumePage.tsx`, `pages/UnfallhilfsstellenPage.tsx`)
  nutzen die Builder (`lageberichtePfad`, `einsatzPfad`, `einsaetzePfad`). Der bestehende Guard
  `routing/inlinePfade.guard.test.ts` gilt danach für ganz `frontend/src/` statt nur für
  `einsatz/` und `command-palette/`.
- **Feste Farbwerte an eine Quelle:**
  - Die Maske der Sprungpalette (`rgba(5, 6, 8, 0.72)`) zieht nach `theme/tokens.ts`,
    modusunabhängig wie `rahmenFarben`, mit ihrer Begründung.
  - Die DV-102-Tinte `#333333` eines freien Zeichens ohne eigene Farbe steht heute dreimal
    (`marker.ts`, `FreiesZeichenInspector.tsx`, `FreiesZeichenPicker.tsx`) und wird eine
    exportierte Konstante. Die Symbol-Kachel im Inspector zeigt ein Zeichen ohne eigene Farbe
    nicht mehr in dieser Tinte, sondern in einer Textrolle — auf dem dunklen Paneel war sie
    kaum zu sehen.
  - Die Vorgabefarbe einer freien Skizze `#1677ff` steht heute sechsmal (`zonenStil.ts`,
    `ZonenInspector.tsx` 3×, `Sidebar.tsx` 2×) und wird eine exportierte Konstante aus
    `zonenStil.ts`. Sie bleibt ein persistierter Datenwert, kein Laufzeit-Token.

## Capabilities

### New Capabilities
- `http-schutzkoepfe`: Schutzköpfe, die der Server an jede HTTP-Antwort hängt (heute
  `X-Content-Type-Options: nosniff`), unabhängig von der einzelnen Route.
- `deeplink-quelle`: Einsatzpfade im Frontend entstehen nur über die Builder in
  `routing/deeplinks.ts`; ein Guard über `frontend/src/` hält neue Inline-Pfade fern.

### Modified Capabilities
- `lagekarte-zeichnen`: Die Vorgabefarbe einer freien Skizze hat eine Quelle; ein Blur des
  unveränderten Farbfelds an einer Skizze ohne gespeicherte Farbe schreibt nichts.
- `lagekarte-taktische-zeichen`: Die Symbolkachel eines freien Zeichens ohne eigene Farbe zeigt
  sich in einer Textrolle statt in der DV-102-Tinte.

## Impact

- **Backend:** `src/app.rs` (neue Schicht), `Cargo.toml` (Feature `set-header` von `tower-http`,
  keine neue Crate), ein Integrationstest unter `tests/`, `src/AGENTS.md` (Regel).
- **Frontend:** die fünf Seiten oben, `routing/inlinePfade.guard.test.ts`,
  `command-palette/CommandPalette.tsx`, `theme/tokens.ts`, `pages/lagekarte/marker.ts`,
  `FreiesZeichenInspector.tsx`, `FreiesZeichenPicker.tsx`, `zonenStil.ts`, `ZonenInspector.tsx`,
  `Sidebar.tsx`, dazu Tests.
- **Sichtbar für Bedienende:** nur die Symbol-Kachel eines farblosen freien Zeichens im
  Inspector der Lagekarte. Pfade, Maske und Zonenfarbe bleiben im Ergebnis gleich.
- **Keine** API-, Schema- oder Migrationsänderung; gespeicherte Farben bleiben unverändert.
