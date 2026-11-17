# Design

## Context

`kraefte/EinsatzfunktionZelle.tsx` rendert die Einsatzfunktion als `InlineAngabe` und darunter die
Qualifikation als gedämpften Text. Ist die Einsatzfunktion leer, zeichnet `InlineAngabe` ihre
Aufforderung `Button type="link"` „Funktion eintragen“ (`leerKnopfStil`). Das verlangt die Regel
„Ein leeres Feld muss sagen, dass man es schreiben kann“. `InlineAngabe` kennt einen eigenen
Auslöser `ausloeser` (LFH-969) für Angaben, deren Wert anderswo steht. Er bekommt Fokusrückgabe
und Öffnen, Name und Trefffläche trägt der Aufrufer.

## Goals / Non-Goals

**Goals:** eine Zeile je Person, wenn die Einsatzfunktion leer ist, und kein wiederholtes Wort.

**Non-Goals:** Die übrigen Aufforderungen der Personalliste („Einheit eintragen“, „Fahrzeug
eintragen“) bleiben, wie sie sind. Ob sie dieselbe Form bekommen, entscheidet eine spätere
Aufgabe.

## Decisions

### D1 Leere Einsatzfunktion: Qualifikation als Wert, Stift über `ausloeser`

Ist die Einsatzfunktion leer und darf die Rolle schreiben, steht die Qualifikation in normaler
Textfarbe. Daneben öffnet ein quadratischer Knopf mit Stiftsymbol über `ausloeser` die Eingabe.
Der Knopf trägt `aria-label` „Funktion zu <Name> eintragen“, `minWidth`/`minHeight` =
`controlHeightSM` der Stufe (`antdKnopf()`-Boden) und einen Tooltip „Funktion eintragen“ nur als
Ergänzung. Ohne Qualifikation zeigt die Zelle die bisherige Aufforderung „Funktion eintragen“,
denn dann steht kein Wert daneben, der den Stift erklärt.

Verworfen: „+ Funktion“ als Wort (Muster `Personendaten`). Es wiederholt sich je Zeile wie
bisher, nur kürzer. Ebenso verworfen: die ganze Zelle als Wertknopf. Der Knopf zeigte die
Qualifikation, bearbeitete aber die Funktion.

### D2 Gesetzte Einsatzfunktion: wie bisher

Wertknopf mit der Einsatzfunktion, Qualifikation gedämpft darunter. In der Tabelle öffnet die
Bearbeitung schwebend an der Zelle (`lsug0joq-tabellen-touch`, D2).

### D3 Regel in `frontend/AGENTS.md`

Die Regel „Ein leeres Feld muss sagen …“ bekommt einen Satz: In einer Listenzelle, die schon
einen anderen Wert zeigt, sagt ein Stift-Knopf mit zugänglichem Namen (Etikett und
Zeilenkennung) das Schreibbare. Ohne solchen Wert bleibt die Aufforderung als Wort.

## Risks / Trade-offs

- [Ein reiner Stift ist am Touchgerät ohne Hover weniger selbsterklärend] → Das Stiftsymbol ist
  das Bearbeiten-Zeichen der ganzen App (Wertknopf). Der zugängliche Name nennt die Handlung, und
  die Anwenderdoku beschreibt ihn.
