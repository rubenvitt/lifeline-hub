# Anbindungen (12.11.2026)

Entwurf zu LLH-1652 (Maschinenzugang für Fremdsysteme, Change `quf3qdil-maschinenzugang`,
design.md D11). Neue Seite unter Einstellungen: Zugänge für Fremdsysteme anlegen, Code zeigen,
Fingerabdruck, Rechte, Ablehnungsgrund, neuer Code und Widerruf.

**Stand dieses Ordners:** die Zeichenflächen des Canvas
https://claude.ai/artifact/XRMGAvTGK9MR14MQjt8DsF (Artifact-Typ „Design“, Design System „Lifeline
Hub“), Inline-Styles und `<helmet>`-Regeln maßgeblich. Die Schriften laden die Dateien aus
`ds/lifeline-hub/` des Canvas; im Repo liegen sie nicht, die Flächen fallen hier auf die
Systemschrift zurück.

| Datei              | Zeichenfläche                                            | Dichte      |
| ------------------ | -------------------------------------------------------- | ----------- |
| `Main.dc.html`     | Liste, Desktop 1280                                      | kompakt     |
| `Ansicht.dc.html`  | Ansicht eines Zugangs mit Ablehnung und Schlüsselwechsel | kompakt     |
| `Anlegen.dc.html`  | Erfassungsdialog: Name, Rechte, gültig bis               | kompakt     |
| `Code.dc.html`     | Einmal-Code nach dem Anlegen, mit Kommando               | kompakt     |
| `Gesperrt.dc.html` | Gekoppelter ELW: Anlegen gesperrt, Hinweis auf den Hub   | kompakt     |
| `Handy.dc.html`    | Liste, Handy 390 × 844                                   | komfortabel |

## Entscheidungen

- **Rechte in Klartext, Wire-Wert in Mono daneben.** Der Admin vergleicht mit der Doku des
  Fremdsystems; die Oberfläche sagt „Rechte“, die API `scopes`.
- **Der Ablehnungsgrund steht an zwei Stellen:** knapp in der Liste („Uhr geht 7 min nach“, mit
  Zeit) und als Achtungsband in der Ansicht. Das Fremdsystem bekommt nur 401.
- **Der Code erscheint einmal**, im Dialog nach dem Anlegen oder nach „Neuer Code“, mit Ablaufzeit
  und dem Kommando `lifeline-hub zugang redeem`. Danach steht er nirgends mehr.
- **Schlüsselwechsel** zeigt beide Fingerabdrücke, bis der neue zum ersten Mal signiert.
- **Am gekoppelten ELW** ist Anlegen gesperrt (`RechteHinweis`), ein Band nennt den Hub.
- Widerrufene Zugänge bleiben gedämpft in der Liste.
