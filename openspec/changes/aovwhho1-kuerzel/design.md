# Design

## Context

`anzeige/staerke.ts:staerkeText` bildet „1/2/5//8“, `StaerkeAnzeige.tsx` ist ein nacktes Fragment
ohne Beschreibung. Eine Erklärung tragen nur die Positionsmarken F/UF/M/EF im Kräftebaum
(`KraeftebaumZelle.tsx:Marke`, `PositionAngabe.tsx`, Wortlaut aus `api/personal.ts:POSITION_LABELS`)
und ein einziges `<abbr>` (`EinsaetzePage.tsx`, „EL“). Für die Summe stehen „Σ“, „Ges“ und
„Gesamt“ nebeneinander (Bestand aus dem Scope-Lauf vom 17.11.2026). Spec `bedien-wortlaut` verbietet
den Tooltip als einzige Erklärung. Ein Glossar gibt es nicht. Ein Kapitel unter `docs/anwender`
braucht genau die vier Abschnitte aus `docs/anwender/AGENTS.md`.

## Goals / Non-Goals

**Goals:**
- eine Schreibweise und eine zugängliche Beschreibung für die Stärke, an einer Stelle gebaut
- jede Fläche mit Stärke nennt die Schreibweise sichtbar
- ein Kapitel, auf das die Kürzel-Regel verweist

**Non-Goals:**
- Kein Wächter für Kürzel. Ein Kürzel ist am Quelltext nicht von einem Wort zu unterscheiden, die
  Regel trägt der Review. (Ein Wächter, der nur `//Ges` und `F/UF/M` ohne Summe verbietet, ist billig
  und kommt dazu, siehe D4.)
- „Rückm.“, „Einh.“, „Fzg.“, „Pers.“ in schmalen Status- und Metazellen bleiben. Sie werden
  eingeführt, nicht ersetzt: Specs halten sie fest, und der Platz fehlt.
- Abschnitts-Kurzbezeichnungen (Daten der Organisation) und „EA“ als Einzelauftrag in den
  Befehlsvorlagen bleiben unverändert.

## Decisions

**D1 `StaerkeAnzeige` trägt die Beschreibung, `staerkeEtikett` die sichtbare Schreibweise.**
`staerke.ts` bekommt zwei Konstanten:
- `STAERKE_SCHREIBWEISE` = „F/UF/M//Σ“
- `STAERKE_AUSGESCHRIEBEN` = „Führer / Unterführer / Mannschaft // Summe“

`StaerkeAnzeige` setzt `aria-label` aus Wert und ausgeschriebener Form und `title` als Zusatz.
Etiketten und Spaltenköpfe nehmen die Konstante statt eines eigenen Literals.
*Alternative:* `<abbr>` um den Wert. Verworfen: `abbr` erklärt eine Abkürzung, der Wert ist aber
eine Zahlengruppe, und Vorlesehilfen lesen `abbr` uneinheitlich.

**D2 Sichtbare Schreibweise je Fläche**, an der Stelle, die es dort schon gibt:

| Fläche | Stelle |
|---|---|
| Überblick | Feldetikett der Stärke |
| Meldebild | Spaltenkopf „Stärke F/UF/M//Σ“ |
| Organigramm, Einsatzabschnitte | Legendenzeile über dem Baum |
| Lagebild, Großbild, Lagebesprechung | Notiz „Stärke 1/2/5//8“, die Kennzahl „Kräfte“ führt die Beschreibung |
| Lagemonitor | „Stärke F/UF/M//Σ“ in der Kachel |
| Kräfte-Verdichtungszeile, Detailpaneele | ihr Etikett |

In der Lagebild-Notiz ist kein Platz für die ganze Schreibweise. Die Kennzahl „Kräfte“ ist dort aber
die einzige Stärke der Fläche, und das Kapitel führt die Schreibweise ein. Die Spec verlangt die
Schreibweise „mindestens einmal sichtbar“; im Lagebild erfüllt das die Notiz mit dem Vorsatz „Stärke“
zusammen mit der eingeführten Form. Das wird am Freigabe-Checkpoint als Grenzfall vorgelegt.

**D3 Kapitel `kapitel/zeiten-und-kuerzel.md`**, Gruppe `alle`, Reihenfolge im Block der
allgemeinen Kapitel. Die Abschnitte:
- Überblick
- Abläufe: „Eine Stärke lesen“ (mit Bild) und „Den Datenstand lesen“
- Hintergrund: Zeitpunkt, Uhrzeit, Dauer, Datenstand, Stärke, eine Tabelle der eingeführten Kürzel
- Grundlagen: FwDV/DV 810, schon in Spec `zeitdarstellung` zitiert

Die Kürzelliste der Spec `bedien-wortlaut` steht im Code als `anzeige/kuerzel.ts`
(`EINGEFUEHRTE_KUERZEL`); ein Vitest hält die Tabelle des Kapitels mit ihr gleich. Der Ablauf zur
Zeitdarstellung am Gerät steht schon in `profil-sicherheit.md`; das Kapitel verweist darauf und
führt stattdessen die Abläufe „Eine Stärke lesen“ und „Den Datenstand lesen“.

**D4 Kleiner Wächter für die Stärke.** Er sucht außerhalb von `anzeige/staerke.ts` nach `//Ges`,
`//GES`, `F/UF/M//Gesamt` und nach `${…}/${…}/${…}` ohne folgendes `//`. Damit fällt eine neue
eigene Stärke auf, wie im Lagemonitor bisher.

## Risks / Trade-offs

- [Die Legendenzeile im Organigramm kostet eine Zeile Höhe, auch im Druck] → Sie steht in der
  Meta-Zeile des Paneels, nicht als eigene Zeile, sofern dort Platz ist. Der Druck übernimmt sie,
  denn auch auf Papier braucht die Stärke ihre Erklärung.
- [Die Notiz „wohin nicht erfasst · 2 unterwegs“ ist länger als „2 unterwegs“] → Die Kennzahl kürzt
  ihre Notiz schon heute mit `title`. Am Tablet hoch wird nachgemessen, das Bild kommt in den PR.
- [Anwenderdoku nennt „Gesamt“ und „F/UF/M“] → Die Texte werden in dieser Change berichtigt, die
  Bilder neu aufgenommen, wo sich die Fläche sichtbar ändert.

## Migration Plan

Keine Daten und keine Schnittstelle. Der Markdown-Text des Kräftebilds (Übernahme in den
Lagebericht) schreibt neu „F/UF/M//Σ“. Schon übernommene Lageberichte bleiben, wie sie sind.
