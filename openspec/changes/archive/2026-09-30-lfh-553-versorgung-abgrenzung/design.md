# Design

## Context

Motivation siehe `proposal.md`. Der Stand am 30.09.2026:

- **Verpflegung** ist ein eigenes Fachmodul (LFH-634, Spec `kraefte-verpflegung`). Zeitfenster
  tragen einen erfassten Bedarf, und Ausgaben verweisen nur per Kennung auf eine Nachforderung.
  Aus einer Fehlmenge öffnet „Nachfordern“ die Nachforderungs-Erfassung vorbelegt
  (`nachforderungenPfad(id, { vorbelegung })`, `parseNachforderungVorbelegung` in
  `routing/deeplinks.ts`). Den Vorschlag für die Betreuten liefert die Kopfzahl „in Betreuung“
  (`src/betreuung/mod.rs`), den für die Kräfte die Personalstärke.
- **Nachforderungen** führen den Beschaffungsweg `angefordert → zugesagt → unterwegs →
  eingetroffen` bzw. `abgelehnt` mit ETB-Eintrag (`src/nachforderung/`). Die Art ist ein
  freier, nicht leerer Text (`routes/nachforderung.rs`: `pflicht(&req.art, "Art")`, keine
  Liste).
- **Material** führt je Zeile den festen Status `einsatzbereit`, `im_einsatz`, `defekt`,
  `verbraucht` und `desinfektion_noetig` (`src/material/mod.rs`, `MaterialStatus`). Das ist die
  Materialerhaltung im Sinne von S4.
- **Betreuung** kennt die Stellenarten `anlaufstelle`, `betreuungsstelle`, `betreuungsplatz` und
  `notunterkunft` (Spec `betreuung-evakuierung`). Ein Verbleib „Notunterkunft“ einer betroffenen
  Person verweist auf eine Stelle (Spec `verbleib-betreuungsstelle`).
- **Stab**: Die Zeile S4 führt `['nachforderungen', 'verpflegung', 'material']`
  (`stab/sachgebiete.ts`, höchstens drei Werkzeuge je Zeile).
- `MODUL_KEYS` in `src/einsatz/modul.rs` ist ein Array fester Länge (31). Ein Modul
  „Versorgung“ gibt es nicht.

Das Ticket LFH-553 stammt vom 12.09.2026 (Stab-Spec LFH-46, Abschnitt 13) und nennt „0 Treffer
für Verpflegung“. Der Befund ist durch LFH-634 überholt.

## Goals / Non-Goals

**Goals:**
- Jede Versorgungsaufgabe von S4 hat einen benannten Träger oder steht als benannte Lücke da.
- Die Entscheidung ist an Tests gebunden, die schon existieren oder in dieser Change entstehen.
  Wer später eine zweite Mengenwahrheit einzieht, macht einen Test rot.

**Non-Goals:**
- Kein Produktcode, keine Migration, kein Codegen und keine Änderung an bestehenden Specs.
- Keine Schnellwahl „Betriebsstoff“ in der Nachforderung, keine feste Art, kein Einstieg aus dem
  Stab. Dafür fehlt der Feldbefund (Ticket: „nicht vor dem Feldbefund“).
- Kein Träger für die Unterkunft der Einsatzkräfte.

## Decisions

### D1 — Keine Tabelle `versorgungsposten`, keine Fläche „Versorgung“

Eine eigene Tabelle neben `einsatz_material` und `nachforderung` hätte für dasselbe Gut zwei
Mengen, etwa „200 l Diesel angefordert“ in der Nachforderung und „200 l Diesel Bedarf“ im
Versorgungsposten. Eine Auflösungsregel dafür gibt es nicht. LFH-634 hat für die Verpflegung
dieselbe Frage schon so beantwortet: Bedarf und Ausgabe im Fachmodul, Beschaffung nur als
Nachforderung, Verweis nur per Kennung.

*Verworfen:* ein Sammelmodul „Versorgung“, das Verpflegung, Betriebsstoffe und Unterkunft als
Reiter bündelt. Es verdoppelte die Navigation zur Verpflegung (Rail und Stab) und bräuchte für
Betriebsstoffe und Unterkunft Inhalte, die es ohne Feldbefund nicht gibt. Das widerspricht der
Regel „keine erfundenen Daten“.

### D2 — Betriebsstoffe sind Nachforderungen mit freier Art

Der Beschaffungsweg für Kraftstoff, Atemschutz, Löschmittel oder Trinkwasser ist derselbe wie
für einen RTW: anfordern, Zusage, unterwegs, eingetroffen. Die freie Art trägt das heute schon.
Die Vorbelegung per Deeplink liegt seit LFH-634 bereit, falls später ein Einstieg dazukommt.

*Verworfen:* eine feste Art `betriebsstoff` als Enum. Sie bräuchte eine Migration, einen
Wire-Kontrakt und eine Filterachse, und ob Filtern oder Summieren je Betriebsstoff im Feld
überhaupt gebraucht wird, ist nicht belegt. *Verworfen:* eine Deckungsrechnung wie bei der
Verpflegung. Für Betriebsstoffe gibt es keinen Bedarf je Zeitfenster aus einer vorhandenen
Quelle, denn Verbrauch je Fahrzeug oder Pumpe wird nirgends erfasst.

### D3 — Unterkunft der Einsatzkräfte ist nicht die Notunterkunft

FwDV 100 meint mit den Unterkünften von S4 die der eigenen Kräfte. Die Notunterkunft der
Betreuung ist für Betroffene. Führte man Kräfte dort, zählte die Kopfzahl „in Betreuung“ sie
mit. Diese Zahl belegt aber den Verpflegungsbedarf der **Betreuten** vor, während die Kräfte
schon über die Personalstärke im Bedarf stehen. Dieselben Menschen stünden doppelt im Bedarf.
Deshalb bleibt die Liste der Stellenarten geschlossen, und die Kräfte-Unterkunft ist eine
benannte Lücke.

*Verworfen:* eine fünfte Stellenart `kraefteunterkunft`, die aus der Kopfzahl herausgerechnet
wird. Das verschöbe eine Kräfte-Frage in ein Betroffenen-Modul und zöge jede Auswertung der
Betreuung (Kennzahl „Evakuiert“, Belegung, Schwärzung) mit. *Verworfen:* die Unterkunft als
BR-Erweiterung (Bereitstellungsraum). Ein Bereitstellungsraum ist ein Warteplatz für
einsatzbereite Kräfte, keine Ruhe- oder Schlafstelle. Die Abgrenzung gegen die Ablösung
(LFH-635) wäre offen, und ohne Feldbefund bliebe sie es.

### D4 — Materialerhaltung ist der Status am Material

`defekt`, `verbraucht` und `desinfektion_noetig` sind die Materialerhaltung. Ersatz für
Verbrauchtes läuft als Nachforderung (D2). Ein eigener Instandsetzungs-Workflow ist nicht
Gegenstand dieser Entscheidung.

### D5 — Wiedervorlage-Auslöser

Neu entschieden wird nur mit einem Feldbefund: ein realer Einsatz oder eine Übung über mehr als
einen Einsatztag, in dem belegt ist, dass die freie Art (etwa unauffindbare Kraftstoff-
Nachforderungen) oder die fehlende Kräfte-Unterkunft die Führung behindert hat. Der Befund
gehört ins Feedbackboard. Aus ihm entsteht ein neuer Task, und die Folge-Change muss die eine
Mengenwahrheit (Requirement „Eine Mengenwahrheit für Beschafftes“) erhalten oder ausdrücklich
ablösen.

## Belege je Szenario

| Szenario (`specs/stab-versorgung/spec.md`) | Beleg |
|---|---|
| S4 führt die Träger | `frontend/src/stab/sachgebiete.test.ts` › „S4 führt Nachforderungen, Verpflegung und Material“ |
| Es gibt kein Modul Versorgung | `src/einsatz/modul.rs` `MODUL_KEYS: [&str; 31]` (Länge im Typ); `tests/modul_override.rs` › `backend_modul_keys_decken_frontend_registry` |
| Materialerhaltung am Material | `tests/einsatz_material.rs` › `menge_und_status_aenderung_schreiben_je_einen_etb` (Status `defekt`) |
| Nachfordern aus der Verpflegung | `frontend/src/pages/VerpflegungPage.test.tsx` › „„Nachfordern" öffnet die Erfassung der Nachforderung mit der Fehlmenge“ |
| Ausgabe ändert die Nachforderung nicht | `tests/verpflegung.rs` › `ausgabe_mit_nachforderung_traegt_nur_die_kennung` |
| Kraftstoff nachfordern | **neu** `tests/nachforderung.rs` › `betriebsstoff_ist_eine_nachforderung_mit_freier_art` (Aufgabe 1.2) |
| Keine Pflichtart für Betriebsstoffe | derselbe neue Test; Gegenstück `anlegen_ohne_bezeichnung_ist_400` für den leeren Fall |
| Keine Stellenart für Kräfte | `tests/betreuung.rs` › `statuscodes_400` (Art `zelt` → 400) |
| Notunterkunft gehört den Betroffenen | `tests/verbleib_betreuungsstelle.rs` (Verbleib `notunterkunft` → Stelle) |
| Ohne Feldbefund keine neue Fläche | Prozessregel, kein Test. Verankert in `CLAUDE.md` (Aufgabe 2.1) |

## Risks / Trade-offs

- [Freitext-Arten streuen („Diesel“, „DK“, „Kraftstoff“), und eine Summe je Betriebsstoff ist
  nicht möglich] → Das nehmen wir bis zum Feldbefund bewusst hin. Die Nachforderungsliste bleibt
  durchsuchbar. Belegt ein Befund, dass das stört, ist das der Auslöser aus D5.
- [Kräfte werden trotzdem in einer Notunterkunft geführt, weil es keinen anderen Ort gibt] →
  Der `CLAUDE.md`-Absatz nennt den Grund (Doppelzählung im Verpflegungsbedarf). Die Oberfläche
  verhindert es nicht, denn eine Belegungsmeldung ist eine Zahl ohne Personenbezug.
- [Das Ticket wird ohne Feature geschlossen] → Das Ticket verlangt selbst eine Spec mit
  Abgrenzung und „nicht vor dem Feldbefund“. Genau das liefert diese Change.
