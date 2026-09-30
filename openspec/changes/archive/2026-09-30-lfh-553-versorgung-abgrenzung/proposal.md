# Proposal

## Why

Die Stab-Spec LFH-46 hat die Versorgungsaufgaben von S4 nach FwDV 100 Anlage 2 (S. 58) als
Folge-Spec „Versorgung Langzeitlage“ ausgelagert: Verbrauchsgüter und Betriebsstoffe,
Verpflegung, Materialerhaltung und Unterkünfte. Damals gab es dafür keinen Träger. Seitdem sind
zwei der vier Teile geliefert: Verpflegung (LFH-634) und die Notunterkunft für Betroffene
(LFH-639/674). Offen ist, ob der Rest eine eigene Fläche oder Tabelle bekommt oder in den
bestehenden Modulen bleibt. Ohne festgehaltene Antwort entsteht bei der nächsten Langzeitlage
leicht eine zweite Mengenwahrheit neben Material und Nachforderung (LFH-553).

Entschieden am 30.09.2026: **keine eigene Versorgungsfläche und keine Tabelle
`versorgungsposten`**. Jeder S4-Bereich hat genau einen bestehenden Träger. Was noch fehlt,
bleibt eine benannte Lücke, bis ein Feldbefund aus einer Langzeitlage vorliegt.

## What Changes

- Festgehalten wird die **Zuordnung der S4-Bereiche**: Verpflegung → Modul Verpflegung
  (LFH-634); Einsatzmittel, Verbrauchsgüter und Betriebsstoffe → Nachforderungen;
  Materialerhaltung → Material (Status `defekt`/`verbraucht`). Die Notunterkunft für
  **Betroffene** gehört der Betreuung (LFH-639/674) und ist keine S4-Aufgabe.
- Festgehalten wird **eine Mengenwahrheit**: Ein Versorgungsgut, das beschafft wird, steht als
  Nachforderung. Daneben führt kein Modul einen eigenen Bestell- oder Lieferstatus.
- **Betriebsstoffe** werden als Nachforderung mit freier Art erfasst („Kraftstoff Diesel“,
  „Atemschutzflaschen“). Einen eigenen Einstieg, eine feste Art oder eine Deckungsrechnung gibt
  es erst nach Feldbefund.
- Die **Unterkunft für Einsatzkräfte** ist eine benannte Lücke. Sie wird ausdrücklich nicht
  als Betreuungsstelle geführt, denn deren Belegung speist die Kopfzahl „in Betreuung“ und damit
  den Verpflegungsbedarf der Betreuten.
- Benannt werden die **Auslöser der Wiedervorlage** (Feldbefund aus einer Langzeitlage).
- Neu ist ein Absatz in `CLAUDE.md` unter „Betreuung und Verpflegung“ mit Verweis auf diese
  Herleitung.
- Kein Produktcode, keine Migration, kein Codegen.

## Capabilities

### New Capabilities

- `stab-versorgung`: Welcher Träger welche Versorgungsaufgabe von S4 übernimmt, die eine
  Mengenwahrheit für Beschafftes und die benannten Lücken samt Wiedervorlage-Auslösern.

### Modified Capabilities

(keine: `kraefte-verpflegung` und `betreuung-evakuierung` gelten unverändert und werden nur
zitiert)

## Impact

- `CLAUDE.md`: neuer Absatz unter „Betreuung und Verpflegung“.
- `openspec/specs/stab-versorgung/spec.md` (nach dem Archivieren).
- Code: keiner. Das spezifizierte Verhalten besteht schon. Die Belege je Szenario stehen in
  `design.md` („Belege je Szenario“).
- ClickUp: LFH-553 wird mit dieser Entscheidung abgeschlossen. Ein Folge-Task entsteht erst mit
  einem Feldbefund, nicht jetzt.
