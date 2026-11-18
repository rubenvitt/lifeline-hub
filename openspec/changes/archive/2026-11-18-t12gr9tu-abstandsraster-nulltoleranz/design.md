# Design

## Context

Siehe proposal.md, „Why“. Stand nach den Abbau-Commits von LLH-1937: `SCHULD` ist ein leeres
Objekt, der Wächter grün. ADR-0059 ist `akzeptiert` und damit unveränderlich
(`docs/architektur/AGENTS.md`, „Entscheidungen“); ihre Konsequenz „dann fällt er weg“ und die Regel
zur Schuld-Datei gelten nicht mehr.

## Goals / Non-Goals

**Goals:**
- Der Wächter prüft ohne Schuldmechanik, seine Meldung bleibt gleich hilfreich (Datei, Zeile, Wert).
- Die Entscheidung steht in genau einer gültigen ADR; Spec, AGENTS.md und Kapitel 11 stimmen.

**Non-Goals:**
- Die bekannten Grenzen des Wächters schließen (Werte aus Variablen und Rechnungen). Sie bleiben
  Vertrag und stehen in Kapitel 11.
- Neue Ausnahmen oder Rasterwerte.

## Decisions

**D1: Wächter bleibt, Schuld fällt.** Abgestimmt am 18.11.2026. Der Wächter läuft in Millisekunden
und ist die einzige Prüfung der Spec-Regel.
- Verworfen: beides entfernen (ADR-0059 wörtlich). Die MUST-Regel stünde ohne Prüfung, und die
  Altlast ist vorher ohne Wächter auf rund 400 Literale gewachsen.
- Verworfen: leere Schuldliste stehen lassen. Eine Liste, die nie wieder einen Eintrag bekommen
  darf, ist Zeremonie und lädt zum „nur dieses eine Mal“ ein.

**D2: Wächter ohne Schuldparameter.** `befunde(dateien, ausnahmen)` meldet jede Datei mit
mindestens einem Literal; die Prüfungen zu „Schuld senken“, „Datei fehlt“ und „Ausnahme mit
Schuld“ entfallen samt ihren Unit-Tests. Kopfkommentar: Abschnitt SCHULD weg, Grenzen bleiben.
Die Test-Fälle an Texten (Erkennung) bleiben unverändert, sie belegen die Regeln.

**D3: Neue ADR-0066 ersetzt ADR-0059.** Eine Abkehr ist nach `docs/architektur/AGENTS.md` eine
neue ADR (`ersetzt: ADR-0059`); die alte bekommt `status: ersetzt`, `ersetzt_durch: ADR-0066`.
Die neue übernimmt die Raster-Regeln unverändert und ersetzt die Schuld-Regel durch: MUST NOT eine
Schuld- oder Ausnahmeliste für Abstands-Literale außer `AUSNAHMEN` im Wächter. Prüfung:
`test -f` Wächter, `test ! -e` Schuld-Datei, dazu die Token-Prüfungen der alten ADR. Nummer 0065
ist auf `alpha` frei; vor dem Push `scripts/adr-fuer.sh --alle` und offene PRs prüfen.

**D4: Kapitel 11, neuer Eintrag.** Nach dem Muster von R20: Schuld leer, Grenzen des Wächters
(Variablen und Rechnungen, `<Space size>` nach einer Pfeilfunktion, benannte Nicht-Layout-Werte),
Auswirkung (ein Literal über diesen Weg folgt der Dichte nicht), Beleg Wächter + ADR-0066.

## Risks / Trade-offs

- [Neues UI-Literal macht den Test rot, wo bisher eine Schuldzahl half] → Gewollt; die Meldung
  nennt den Weg (Token, `var(--lfh-luft-*)`).
- [Umgehung über eine Variable] → Bekannte Grenze, im Review und in Kapitel 11 benannt.

## Migration Plan

Ein Commit nach den Abbau-Commits im selben Branch. Zurück: Revert dieses Commits stellt die leere
Schuldliste und ADR-0059 wieder her.
