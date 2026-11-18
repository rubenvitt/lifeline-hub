# Proposal

Zunder: https://zunder.rubeen.dev/#/aufgabe/ttlwlyz5k3z928ai9n2762yl (LLH-1798)

## Why

Nach den Wellen zu Tabellen und Rahmen liegen noch einzelne Bedienziele unter der Steuerhöhe ihrer
Stufe. Gemessen am 18.11.2026 (Stand `alpha`, Box und wirksame Trefffläche per
`elementFromPoint`):

| Ziel | kompakt | komfortabel | handschuh | Soll |
| --- | --- | --- | --- | --- |
| Kreuz „Hinweis schließen“ (jeder schließbare `Alert`) | 12 × 14 | 12 × 14 | 12 × 14 | 24 / 48 / 72 auf beiden Achsen |
| Löschkreuz „Sortieren“ (Kartenzweig, Handy) | 12 × 12 | 12 × 12 | 12 × 12 | — (einziger Rückweg zu „wie geliefert“) |
| Brotkrume „ETB“ (Breite × Höhe) | 32 × 30 | 32 × 48 | 32 × 72 | Breite wie ein Knopf: 24 / 48 / 72 |
| Kreuz „Entwurf verwerfen“ (wirksam) | 36 × 24 | 60 × 48 | 84 × 72 | erfüllt |

Ein Handschuh trifft ein 12-px-Kreuz nicht. Beim Sortierfeld gibt es keinen anderen Weg zurück zur
gelieferten Reihenfolge, die Ausnahme „das Feld selbst ist das gleichwertige Ziel“ trägt dort also
nicht.

## What Changes

- Das Schließen-Kreuz jedes schließbaren Hinweises (antd `Alert`) erreicht die kleine Steuerhöhe der
  Stufe auf beiden Achsen. Gesetzt einmal am Kontext, nicht je Stelle; der Hinweis wird dadurch nicht
  höher.
- Die Sortierauswahl des Kartenzweigs der `Datensicht` führt „wie geliefert“ als eigenen Eintrag und
  verliert ihr Löschkreuz.
- Jeder Link im Ortspfad (Brotkrume) ist mindestens so breit wie ein Knopf der Stufe
  (`controlHeightSM`); Schrift bleibt 12 px.
- Kein Code für das Kreuz „Entwurf verwerfen“: es hält die Stufe wirksam, nur seine Box ist flacher.
- Nicht hier: die Schriftgröße der Tabellen-Spaltenköpfe. Sie hängt an der zurückgenommenen
  Schriftskala (LLH-1954) und kommt mit LLH-1956 zurück.

## Capabilities

### New Capabilities

Keine.

### Modified Capabilities

- `einsatztauglichkeit-layout`: Requirement „Trefffläche folgt der Dichtestufe“ nennt das
  Schließen-Kreuz eines Hinweises, die Breite der Brotkrume und die Sortierauswahl der Kartenansicht.

## Impact

- Frontend: `theme/tokens.ts` bzw. der `ConfigProvider` in `theme/ThemeModeProvider.tsx` (Kreuz
  des Alerts), `components/Datensicht.tsx` (Sortierauswahl), `components/EinsatzSeite.tsx` und
  `components/EinsatzSeite.css` (Brotkrume).
- Tests: Unit-Tests der Stilfunktionen und der Sortierauswahl, e2e-Messung in
  `e2e/trefflaeche-pruefflaechen.spec.ts` bzw. `e2e/gate3-trefflaeche.spec.ts`.
- `frontend/AGENTS.md` (Regel „Hinweis-Kreuz“, Brotkrume), Design System neu erzeugen, falls der
  Wächter es verlangt.
- Kein Backend, keine API, keine Migration.
