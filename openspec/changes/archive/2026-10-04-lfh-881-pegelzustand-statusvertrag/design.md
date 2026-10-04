# Design

## Context

`stateMnwMhw` ist ein Feld der aktuellen Messung in der PEGELONLINE-REST-API. Es vergleicht den
Wasserstand mit dem mittleren Niedrigwasser (MNW) und dem mittleren Hochwasser (MHW) der Station:
`low` (unter MNW), `normal` (zwischen beiden), `high` (über MHW), dazu `unknown`, `commented` und
`out-dated` ohne Aussage. Das Backend reicht den Wert unverändert als `zustand` durch
(`src/karte/normalisierung.rs`). MNW und MHW sind Mittelwerte der jährlichen Extreme; eine
Überschreitung des MHW kommt also im Mittel etwa jedes Jahr vor und ist keine Meldestufe. Die
Meldestufen der Länder trägt die Hochwasser-Ebene (`hochwasserKlasse`), dort steht `alarm` erst
beim großen Hochwasser. Motivation: siehe `proposal.md`.

## Goals / Non-Goals

**Goals:**

- Eine Vertragskarte für den Pegelzustand, nach dem Muster von `capSchwere` (LFH-662): Karte plus
  Nachschlag, der Unbekanntes als `null` meldet.
- Der Inspector färbt nur noch über `StatusTag`.

**Non-Goals:**

- Keine Färbung der Pegel-Punkte auf der Karte nach Zustand; die Ebene färbt weiter über ihre
  Ebenen-Identität (`fachebeneFarbe`).
- Kein Zustand am Pegel-Kennzahlplatz des Dashboards (LFH-606); dort steht der Wasserstand.
- Keine Übersetzung im Backend; `zustand` bleibt der Rohwert der Quelle.
- Kein erklärender Tooltip zu MNW/MHW; das Wort bleibt wie bisher „Hoch“, „Normal“, „Niedrig“.
- Die übrigen eigenen Tag-Farben im Inspector (Warnungs-Kategorie `purple`, KRITIS `magenta`)
  sind Kategorien, keine Status, und bleiben außerhalb dieser Change.

## Decisions

### D1 „Hoch“ trägt `achtung`, nicht `alarm`

Über MHW heißt: höher als der Mittelwert der Jahreshöchststände, nicht „Hochwassergefahr“. Mit
`alarm` behauptete der Inspector mehr als die Quelle und widerspräche der Hochwasser-Ebene, die
an derselben Station womöglich „kein Hochwasser“ (`normal`) oder „kleines Hochwasser“ (`achtung`)
meldet. `achtung` sagt: auffällig, hinsehen.

*Verworfen:* `alarm` (bisheriges Rot): überzeichnet und kollidiert mit `hochwasserKlasse.gross`.

### D2 „Niedrig“ trägt `achtung`, nicht `neutral`

Unter MNW ist im Bevölkerungsschutz eine Lageinformation (Löschwasserentnahme, Trockenheit,
Schiffbarkeit) und statistisch das Gegenstück zu „Hoch“. Beide Abweichungen vom Mittelbereich
bekommen dieselbe Rolle; das Wort unterscheidet sie (zweiter Kanal, WCAG 1.4.1).

*Verworfen:* `neutral`: machte „Niedrig“ optisch gleichrangig mit „keine Aussage“ und gäbe die
bisherige Hervorhebung (Gold) ohne Grund auf.

### D3 „Normal“ trägt `normal`

Wie `odlStufe.normal` und `hochwasserKlasse.kein_hochwasser`. Der Normalzustand bleibt ohne
gesättigte Farbe (ASM, Test „nutzt keine gesättigte Farbe für den Normalzustand“).

### D4 Schlüssel sind die englischen Wire-Werte, Nachschlag über `pegelZustandVon()`

Die Karte heißt `pegelZustand` und ist über die Wire-Werte `high`/`normal`/`low` geschlüsselt,
wie `capSchwere` über die CAP-Wörter. Der Typ steht in `statusFarben.ts`, weil `zustand` kein
generierter API-Typ ist. `pegelZustandVon(wert: unknown)` prüft mit `hasOwnProperty`, damit ein
Wert wie `constructor` nicht in den Objekt-Prototyp greift (die heutige Konstante `ZUSTAND`
täte das), und liefert für alles andere `null`. Groß-/Kleinschreibung wird nicht angeglichen:
PEGELONLINE liefert die Werte klein, und eine Angleichung ohne Anlass wäre geraten.

## Risks / Trade-offs

- [Wächter 2 in `statusVertrag.guard.test.ts` kennt künftig `high`/`low` als Vertragswerte und
  meldet ein `<Tag color={…}>`, das diese Literale liest] → heute nutzt kein Frontend-Code diese
  Literale an einem Tag (geprüft per grep); ein Treffer später ist gewollt.
- [Sichtbare Änderung: „Hoch“ war Rot und wird zur Achtung-Rolle] → beabsichtigt (D1); im PR
  als Vorher/Nachher benannt.
