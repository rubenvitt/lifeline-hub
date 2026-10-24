# Design

## Context

Die Funkplan-Seite (`frontend/src/pages/FunkplanPage.tsx`) hat die Darstellungen „Funkplan“,
„Fernmeldeskizze“ und „Sprechgruppen“. Seit LFH-625 D1 ist `?ansicht=` eine Einmal-Vorgabe: Die
Seite liest sie, merkt sich die Darstellung in eigenem Zustand je Einsatz und räumt den Parameter.
LLH-1180 D5 hat das für „Sprechgruppen“ übernommen. Seit LLH-1096 filtert die Darstellung
„Sprechgruppen“ im Spaltenkopf, und der Filter steht über das Listengedächtnis in der Adresse.
Damit fällt der Bruch auf: Nach „Zurück“ stellt die Adresse den Filter wieder her, aber nicht den
Reiter, zu dem er gehört.

## Goals / Non-Goals

**Goals:**
- Nach „Zurück“ aus einem Teilnehmer stehen derselbe Reiter und dieselben Filter da.
- Ein geteilter Link trägt Reiter und Filter zusammen.

**Non-Goals:**
- `f.*`/`sort` beim Wechsel nach „Funkplan“ räumen. Sie bleiben wie bisher stehen, wirken dort
  nicht und wirken wieder, sobald man zurück nach „Sprechgruppen“ wechselt. Das Verhalten bleibt
  unverändert.
- Das Organigramm der Einsatzabschnitte (`?ansicht=organigramm`, Spec `fuehrungsorganisation`)
  umstellen.

## Decisions

### D1 — Darstellung ist Zustand der Adresse, Wechsel per `replace`

Die Seite liest die Darstellung aus `?ansicht=`, der eigene Zustand je Einsatz entfällt. Ein
Reiterwechsel schreibt den Parameter mit `replace`. „Funkplan“ ist die Vorgabe und steht ohne
Parameter. Ein unbrauchbarer Wert und `ansicht=tabelle` werden geräumt.

Vorbild ist `?reiter=` der Aufträge (`AuftraegePage`, `auftraegePfad`: „ZUSTAND, kein Auftrag“).
`replace` statt `push`, damit „Zurück“ die Seite verlässt, statt Reiter für Reiter rückwärts zu
gehen. Das hält die Regel „Ein Reiterwechsel ist kein Navigationsschritt“ ein.

### D2 — Kein Gedächtnis in der Sitzung

Verworfen: die Darstellung im Listengedächtnis oder im Sitzungsspeicher merken. Dann öffnete die
Modulroute `/einsaetze/:id/fernmeldewesen` nach jedem Wiedereinstieg in „Sprechgruppen“. Die Spec
`fernmeldewesen` verlangt aber für die Modulroute den Funkplan. Ein geteilter Link trüge außerdem
den Filter ohne den Reiter.

### D3 — Einstiege bleiben, wie sie sind

Sprungmarken und Palette (`?ansicht=skizze`), die Stab-Unterseiten, das `Eigenschaftspaneel`
(`?ansicht=sprechgruppen`), der Reiter des Kommunikationsplans und die Altadresse
`stab/funkplan?ansicht=…` setzen schon heute diesen Parameter. Sie funktionieren deshalb
unverändert. Neu ist nur, dass der Parameter danach stehen bleibt.

## Risks / Trade-offs

- **Liegengebliebene Filter in „Funkplan“:** `f.*`/`sort` aus „Sprechgruppen“ stehen beim Wechsel
  nach „Funkplan“ weiter in der Adresse (Non-Goal). Ein Teil-Link aus „Funkplan“ trägt sie also
  mit. Sie wirken dort nicht, aber wieder nach dem Wechsel in „Sprechgruppen“. Das ist gewollt.
- **Lesezeichen mit `?ansicht=`:** Ein Lesezeichen öffnet jetzt dauerhaft die gemerkte
  Darstellung, auch nach einem Neuladen. Das ist der Zweck der Änderung.
