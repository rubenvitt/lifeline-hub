# Benutzermenü entschlacken (11.11.2026)

Entwurf zu LLH-1642. Ruben, bei LLH-1549: „Das Benutzermenü ist schon viel zu voll.“ Das Menü
hatte 18 anklickbare Einträge und drei Gruppenköpfe; in `komfortabel` war es rund 1070 px hoch, am
Handy lag ab der Helligkeit alles unter dem Rand.

**Stand dieses Ordners:** die Zeichenflächen des Canvas
https://claude.ai/artifact/1Qv9ekT2kPm3CjK8Pk67vK (Artifact-Typ „Design“, Design System „Lifeline
Hub“), Inline-Styles maßgeblich. Die Schriften laden die Dateien aus `ds/lifeline-hub/` des Canvas;
im Repo liegen sie nicht, die Flächen fallen hier auf die Systemschrift zurück. Umgesetzt mit der
Change `g7ta82x8-benutzermenue-entschlacken`; die Regeln stehen in der Spec `benutzermenue`.

| Datei                            | Zeichenfläche                                         | Dichte      |
| -------------------------------- | ----------------------------------------------------- | ----------- |
| `Main.dc.html`                   | Heute, Handy 390 × 844                                | komfortabel |
| `A-Handy-komfortabel.dc.html`    | A · kompakte Schalter, Handy                          | komfortabel |
| `A-Handy-handschuh.dc.html`      | A · kompakte Schalter, Handy                          | Handschuh   |
| `A-Desktop-kompakt.dc.html`      | A · kompakte Schalter, Tablet/Desktop 1180            | kompakt     |
| `B-Handy-Hauptmenue.dc.html`     | B · Untermenü „Anzeige ›“, Hauptmenü                  | komfortabel |
| `B-Handy-Anzeige.dc.html`        | B · Untermenü „Anzeige ›“, nach dem Tipp              | komfortabel |
| `C-Handy-Seite.dc.html`          | C · Anzeige als Abschnitt im Profil                   | komfortabel |
| `Hilfe-Handy.dc.html`            | Hilfe-Übersicht mit Rückmeldung und Lizenzen          | komfortabel |
| `Eingaenge-Klappflaeche.dc.html` | Eingänge mit Link „Benachrichtigungen einstellen“     | kompakt     |

## Entscheidungen (Ruben, 11.11.2026)

1. **Variante A:** Darstellung, Bediendichte und Helligkeit stehen als je eine Segmentleiste unter
   „Anzeige“ im Menü. Am Desktop luftig: Etikett über der Leiste, volle Wörter, Menü 320 px breit
   (Kommentar am Canvas: „die buttons finde ich zu dicht“).
2. **Rückmeldung und Lizenzen** ziehen auf die Hilfe-Seite.
3. **Benachrichtigungen** bleibt im Menü und bekommt einen zweiten Weg aus den Eingängen.

Verworfen: B (zwei Tipps für die Helligkeit, Untermenüs klappen am Handy aus dem Fenster) und C
(nachts für die Helligkeit raus aus ETB oder Lagekarte). Begründung im Einzelnen:
`openspec/changes/archive/2026-11-11-g7ta82x8-benutzermenue-entschlacken/design.md`, D1.

## Abweichungen des Entwurfs

- Die Leisten haben im Code keine Symbole und keinen blauen Unterstrich: Sie sind die
  `Segmentleiste` der Gestaltungssprache, aktiv mit `flaeche3` und `text`.
- Im Handschuh-Betrieb steht der Kopf im Code wie in den anderen Dichten (Name, Benutzername,
  Funktion, Rollen, Version untereinander), nicht in einer Zeile.
- Die Lizenzen stehen neben der Version im Block „Rückmeldung und Lizenzen“ der Hilfe-Übersicht,
  nicht in einem Fuß der ganzen Seite.
