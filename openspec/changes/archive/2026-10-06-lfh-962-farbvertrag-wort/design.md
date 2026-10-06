## Context

`frontend/AGENTS.md` verlangt für jede weitere Karte im Statusfarb-Vertrag eine begründete
Entscheidung. Das Ticket hat die Lösungen vorgegeben; dieses Dokument hält die zwei
Vertragsentscheidungen fest. Die übrigen Punkte (Chip statt Farbpunkt, Knöpfe ohne `danger`,
Legende oben) wenden bestehende Regeln an („Rot bedient nichts“, zweiter Kanal).

## Goals / Non-Goals

**Goals:** Rot nur für den abnormen Zustand; jede Statusfarbe mit sichtbarem Wort.

**Non-Goals:** Die Besatzung wird nicht aus der Einheit abgeleitet (Entwurfsentscheidung
„orthogonal zur Einheiten-Stärke“ in `FahrzeugePage.tsx` bleibt). Keine Änderung an der
Rangfolge der UHS-/BR-Switcher.

## Decisions

### D1 Vertragskarte `besatzungsUrteil`

Das Urteil über die Besatzung eines Fahrzeugs ist kein Domänen-Enum, es fällt im Client
(`besatzungsUrteilVon`): ohne zugeordnete Kraft `nicht_erfasst` (vor allem anderen, es gibt kein
Ist zu messen), ohne Soll `kein_soll`, sonst `erfuellt` oder `unterbesetzt`. Rollen:
`neutral`, `neutral`, `normal`, `alarm`. Die Karte steht in `theme/statusFarben.ts` und rendert
über `StatusTag`; damit fallen `Tag color="green|red"` an der Besatzung weg.

Alternative: `nicht_erfasst` nur als Text ohne Karte; verworfen, weil dann zwei Darstellungen
derselben Zelle nebeneinander stünden und der Guard die Farbwahl nicht sähe.

### D2 „aufgelöst“ ist neutral

`uhsStatus.aufgeloest` und `brStatus.aufgeloest` sind der planmäßige, terminale Zustand nach
Lageende (`src/uhs/mod.rs`). Vergleichbare Endzustände tragen `neutral`
(`schadenStatus.abgeschlossen`, `betreuungsstelleStatus.geschlossen`,
`dienststatus.ausser_dienst`). Das Wort bleibt der zweite Kanal.

## Risks / Trade-offs

- [Neutrales „aufgelöst“ fällt weniger auf] → gewollt: es ist kein Handlungsbedarf.
- [„nicht erfasst“ verdeckt eine echte Lücke, wenn niemand zuordnet] → das Soll bleibt als
  Auskunft daneben stehen; ein Urteil ohne Ist wäre falsch.
