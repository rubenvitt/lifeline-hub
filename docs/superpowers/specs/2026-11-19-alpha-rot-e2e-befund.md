# alpha rot, 19.11.2026: e2e-Befund

Arbeitsnotiz zum Fix (Stau-Wächter-Auftrag an rubenvitt/lifeline-hub#1489). Wird mit dem Fix
ersetzt oder entfernt.

## Lauf

CI auf `alpha` 29bb7926 (Lauf 44498166079): alle vier e2e-Anteile rot, ebenso 13f97e86 und
9937ccd2. Der letzte grüne Lauf liegt außerhalb der Reichweite des Wächters.

## Fehlgeschlagene Specs (Auszug)

- Anteil 1: `benutzermenue`, `betroffene-layout`, `betroffene-schmal`, `gate3-trefflaeche`
  (Funkplan, Kommunikationsplan, Fernmeldeskizze, Organigramm, Vorplanung), `kraefte-kontrast`,
  `seitenkopf-werkzeuganteil`, `statusmenue`
- Anteil 2: `einheit-ansicht` (Organisation des Zeichens), `gate1-ueberlauf` (Fahrzeuge mit
  Besatzung: Zeilenhöhe 70,5 statt ≤ 60 px; mobil Beobachter)
- Anteile 3 und 4: Auswertung folgt

Überwiegend Maß- und Dichteprüfungen: Verdacht auf eine der Rahmen- und Abstandsänderungen vom
18.11. (Abstandsraster LLH-1937, Status-Baustein LLH-1720, Werkzeuganteil LLH-1786).
