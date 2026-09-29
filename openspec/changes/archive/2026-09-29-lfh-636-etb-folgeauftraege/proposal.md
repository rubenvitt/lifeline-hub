# Proposal

## Why

Der Neuentwurf zeigt an einer Entscheidung, welche Aufträge aus ihr hervorgegangen sind
(„Folgeauftrag … ↗" in der ETB-Zeitachse, „3 Aufträge" im Überblick). Die Verknüpfung liegt
seit LFH-112 in der Datenbank (`auftrag.quell_etb_eintrag_id`, gesetzt beim Erteilen eines
Auftrags aus einem ETB-Eintrag), sie steht aber nicht am ETB-Eintrag selbst. Die Zeitachse
zeigt deshalb nur die Gegenrichtung (Eintrag *aus* einem Auftrag), und der Überblick leitet
den Zähler clientseitig aus der Auftragsliste ab — die ein Nutzer mit gesperrtem
Auftrags-Modul gar nicht bekommt (`routes/auftrag.rs` prüft das Modul `auftraege` getrennt
vom ETB). Dort fällt der Zähler heute still auf „Aufträge nicht abrufbar".

## What Changes

- Der ETB-Eintrag trägt auf dem Wire die Liste seiner Folgeaufträge (`id` und laufende
  Nummer je Auftrag), auf jeder Route, die ETB-Einträge ausliefert (Liste, Einzelladen,
  Erfassen-Antwort). Leer, wenn keiner existiert. Codegen (`openapi.json`,
  `types.generated.ts`) wird nachgezogen.
- Die ETB-Zeitachse zeigt in der Hinweiszeile eines Eintrags je Folgeauftrag einen
  Verweis „Folgeauftrag Nr. <n> ↗" auf `…/auftraege?auftrag=<id>` — **Einzelverweise**,
  Entscheidung des Auftraggebers vom 22.09.2026 (kein Sammelverweis, kein neuer Filter).
- Der Überblick („Entscheidungen der letzten Stunde") zählt aus dem neuen Wire-Feld statt
  aus der Auftragsliste. Die Fußnote „Aufträge nicht abrufbar — Folgeaufträge werden nicht
  gezählt" entfällt; die clientseitige Ableitung `folgeauftraegeJeEintrag` wird entfernt.
- **Nicht** Teil dieser Änderung: eine eigene Entscheidungsübersicht. Das Ticket stellt sie
  ausdrücklich *nach* diesem Verweis zur Entscheidung; sie wird in der Abschlussmeldung
  vorgelegt, nicht hier geplant. Ebenso kein „Befehl aus ETB-Eintrag" — einen solchen
  Anlegeweg gibt es nicht, `befehl.etb_eintrag_id` ist der Freigabe-Snapshot (Gegenrichtung).

## Capabilities

### New Capabilities
- `etb-folgeauftraege`: Ein ETB-Eintrag weist die Aufträge aus, die aus ihm erteilt wurden —
  auf dem Wire, in der Zeitachse und als Zähler im Einsatz-Überblick.

### Modified Capabilities
<!-- keine: openspec/specs/ kennt bisher nur lagekarte-fachebenen -->

## Impact

- Backend: `src/etb/mod.rs` (Wire-Struct + neuer Verweistyp), `src/etb/repo.rs` (Laden der
  Folgeaufträge gebündelt je Seite), `src/api_doc.rs` (Schema-Registrierung),
  `tests/enum_wire_kontrakt.rs` bleibt unberührt (kein Enum).
- Codegen: `frontend/src/api/openapi.json`, `frontend/src/api/types.generated.ts`.
- Frontend: `etb/EtbBacklinkBadges.tsx` (Verweise), `pages/fuehrung/UeberblickPage.tsx` und
  `ueberblickDaten.ts` (Zähler), Test-Fixtures von `EtbEintragAnzeige`.
- Live: kein neues Ereignis. Das Erteilen aus dem ETB publiziert bereits ein `etb`-Ereignis
  (die neue Anordnung), und Aufträge werden nie gelöscht oder umgehängt — der Zähler wächst
  nur auf genau diesem Weg.
- CLAUDE.md: die Liste der erlaubten ↗-Stellen nennt `EtbBacklinkBadges.tsx` schon; kein
  Nachtrag nötig, solange der Verweis dort entsteht.
