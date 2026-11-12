# Design

## Context

LLH-1641 (45d383b8) hat die Führung je Einsatz auf den Spiegel gesetzt (ADR-0021). Die
Gegenprüfung LLH-1676 am Stand `fc7b6a81` fand Text, der noch den Stand davor beschreibt, und zwei
Lücken im Verhalten. Am Stand `def2488f` sieht der Code so aus:

- **Schreibsperre:** Ein Einsatz unter fremder Führung ist ein Spiegel. Den Schutz trägt der
  Trigger, der 409 lautet „Dieser Einsatz ist ein Spiegel; ändern geht nur als Antrag an die
  führende Instanz.“ (`src/error.rs`). Die Oberfläche zeigt das Hinweisband „Spiegel von …“
  (`spiegelText.ts`). Den Chip „Führung: <Name>“ zeigt der Einsatzkopf nur bei fremder Führung
  (`EinsatzLayout.tsx`). „Führung: … · Epoche n“ steht nur unter „Einsätze beim Gegenüber“
  (`fuehrungKurz`).
- **Code-Abgabe:** Sie gibt die Führung sofort ab. Der Verlauf zeigt „Abgabe per Code · ELW → Hub“
  (`FUEHRUNG_ART_TEXT`), einen wartenden Zustand gibt es nicht.
- **Ungültige Übernahme:** Die Benachrichtigung heißt „Ungültige Übernahme der Führung“
  (`src/benachrichtigung/text.rs`).
- **Widerruf:** `instanz::repo` ruft `release_nach_widerruf` nach `spiegel::beende_fuer_zuordnung`
  auf. Die Funktion setzt jede Akte der Org mit lokalem Einsatz, die das Gegenüber als Führer
  nennt, auf die nächste eigene Epoche. Die Art ist `notuebernahme`, der Grund „Kopplung
  widerrufen“, die Bruchstelle der Zeitpunkt des Widerrufs. `save` → `richte_aus` →
  `werde_fuehrer` entfernt dabei die Zeile in `einsatz_spiegel`. Offene Übernahmen dieses
  Gegenübers verfallen. Anträge sind vorher schon mit „Kopplung widerrufen.“ abgelehnt.
- **Rechte:**
  - `EinsatzFuehrungszugriff` lässt die Einsatzleitung oder einen Admin der Einsatz-Org durch,
    nie ein Gerät. Darauf laufen Übergabe, Code, Notübernahme ohne Beweis und mit Code,
    Bestätigen und Widersprechen.
  - Die Notübernahme mit eigener Unterschrift (`run_start`) verlangt zusätzlich `ist_admin()`,
    denn Unterschriftsschlüssel haben nur Admins.
  - Das Paneel zeigt die Beweiswahl jedem, der bedienen darf, und belegt „Eigene Unterschrift“
    vor.
- **Lesen der Führung:** `GET /api/einsaetze/{id}/fuehrung` zieht `EinsatzLesezugriff`; Geräte
  hält die Routenliste der Gerätesitzungen fern (D1). Die Oberfläche nutzt den Abruf im Paneel auf „Einsatzdaten“ und im
  `FuehrungHinweisband` des Einsatz-Layouts. Ein Gerät öffnet keine der beiden Stellen.

## Goals / Non-Goals

**Goals:**

- Specs, Anwenderkapitel und Glossar beschreiben, was der Code tut, mit dem Wortlaut der
  Oberfläche.
- Die zwei abgestimmten Verhaltensänderungen (12.11.2026): kein Verlauf für Gerätekonten und keine
  Unterschriftswahl für die Einsatzleitung.
- `scripts/adr-fuer.sh` nennt für die Routen und die Oberfläche der Führung die geltenden ADRs.

**Non-Goals:**

- Kein Umbau des Rückholens nach Widerruf. Es wird beschrieben, wie es ist.
- Keine Begriffe in `bedien-begriffe`. Epoche, Bruchstelle, Führungsakte und Notübernahme gelten
  nur in der Führung, und das Glossar verweist auf `instanz-fuehrung` (abgestimmt).
- Kein neues Feld im Einsatzkopf oder in der Anzeige der Führung.

## Decisions

### D1 Gerätekonto: die Routenliste der Geräte trägt die 403

Beim Umsetzen zeigte sich: `CurrentUser` lässt eine Gerätesitzung nur auf die Routen in
`geraet::darf_route` (`ALLE_GERAETE`, `ALLE_ANSICHTEN`, Routen der Ansicht), und
`GET /api/einsaetze/{id}/fuehrung` steht in keiner davon. Ein Gerät bekommt also schon heute 403;
die Annahme der Gegenprüfung (Punkt 6) traf nicht zu. Es entsteht deshalb kein Code im Handler,
sondern ein Integrationstest, der die 403 festhält. Die Gegenprobe ist die Route in
`ALLE_ANSICHTEN`, dann wird der Test rot. Dazu kommt ein Doc-Kommentar an `lesen`.

- *Alternative:* eine zweite Prüfung `ctx.geraet.is_some()` im Handler. Verworfen, weil die
  Routenliste die eine Stelle ist, an der Geräte zugelassen werden; ein zweiter Ort würde nur
  doppelt pflegen.
- *Alternative:* Verlauf und Gegenüber nur für Führungsberechtigte. Verworfen am Checkpoint, weil
  die Einsatzleitung den Verlauf auch für ihr Führungspersonal lesbar haben will.

### D2 Beweiswahl nach Rolle

`fuehrungMoeglich` bekommt ein Feld `unterschrift: boolean`. Es ist genau dann wahr, wenn
`notuebernahmeMitBeweis` gilt und das Konto unterschreiben darf. Das sagt
`darfFuehrungUnterschreiben` in `einsatz/schreibrecht.ts`: System-Admin **der Einsatz-Org**. Das
Paneel bekommt es als Prop `darfUnterschreiben`, die Funktion bleibt rein.

- Ohne Unterschrift entfällt im Dialog die Gruppe „Beweis“, das Feld „Code“ steht direkt da, und
  der Anfangswert ist `beweis: 'code'`.
- Die Org gehört dazu, weil das Gegenüber die Unterschrift gegen die Schlüssel der Einsatz-Org
  prüft (`find_gueltig_der_org`). Ein Admin einer anderen Org, der Einsatzleitung ist, würde eine
  Übernahme erklären, die das Gegenüber als ungültig verwirft. Der Server (`run_start`) prüft
  bisher nur `ist_admin()`; das zieht eine Folgeaufgabe nach (Review, siehe PR).
- Auf „Instanzkopplung“ (`EinsaetzeBeimGegenueber`) ist jeder Bediener Admin der Org der Akte,
  die Prop folgt dort `darfBedienen`.
- *Alternative:* den Knopf belassen und nur das Kapitel ändern. Verworfen am Checkpoint, weil die
  Einsatzleitung sonst in eine 403 läuft.

### D3 ADR-Geltung über `gilt_fuer`, ohne neue Regeln

- ADR-0021 bekommt `src/routes/fuehrung.rs` (Regel „Die Bedienung der Führung zieht
  `EinsatzFuehrungszugriff`“) und die Führungsdateien unter `frontend/src/instanz/`
  (`Fuehrung*`, `fuehrung*`, `EinsaetzeBeimGegenueber.tsx`).
- ADR-0018 bekommt `src/routes/einsatz.rs`, denn die Route trägt Einsatz-Schreibwege und
  `OHNE_STELLVERTRETER`, und dort gelten „jede andere Schreibroute endet am Trigger“ und „keine
  Schreibroute als allgemeiner HTTP-Antrag“.
- Regeln und Kontext beider ADRs bleiben unberührt. `docs/architektur/AGENTS.md` erlaubt
  Pfadnachzüge in `gilt_fuer` an einer akzeptierten ADR.
- *Alternative:* `frontend/src/instanz/**` ganz aufnehmen. Verworfen, weil die Seite der Kopplung
  (Codes, Schlüssel) nicht unter ADR-0021 fällt.

### D4 Spec-Deltas statt neuer Fähigkeit

Die Änderungen gehen als MODIFIED/ADDED in `instanz-fuehrung` und `einsatz-spiegel` ein.

- Das Rückholen nach Widerruf ist eine eigene Anforderung in `instanz-fuehrung`, weil die Akte es
  auslöst.
- `einsatz-spiegel` verweist mit einer Ausnahme darauf, statt die Regel zu wiederholen.

## Risks / Trade-offs

- [Eine Funktionsansicht bekommt die Route später in ihre Liste] → Der Integrationstest wird
  dann rot und verlangt eine Änderung der Spec. Heute ruft kein Pfad unter `frontend/src/geraet/`
  `loadFuehrung` auf.
- [Die Ausnahme in `einsatz-spiegel` liest sich als Widerspruch zu ADR-0018] → ADR-0021 regelt
  schon, dass die Akte den Spiegel bestimmt. Die Ausnahme verweist auf `instanz-fuehrung` und
  ändert keine Regel von ADR-0018.
- [Der Text des Kapitels driftet erneut] → Die Wörter im Kapitel kommen aus `fuehrungText.ts`,
  `spiegelText.ts` und den Rust-Texten. Die Aufgabe nennt die Quelle je Wort.
