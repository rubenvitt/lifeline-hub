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
- **Lesen der Führung:** `GET /api/einsaetze/{id}/fuehrung` zieht `EinsatzLesezugriff` und lässt
  damit auch Gerätekonten durch. Die Oberfläche nutzt den Abruf im Paneel auf „Einsatzdaten“ und im
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

### D1 Gerätekonto: 403 im Handler, nicht im Extraktor

`lesen` prüft `ctx.geraet.is_some()` und antwortet dann mit `AppError::Forbidden`, wie
`EinsatzFuehrungszugriff` es für die Bedienung tut.

- *Alternative:* einen eigenen Extraktor „Lesezugriff ohne Gerät“ bauen. Verworfen, weil die
  Prüfung sonst nur hier gebraucht wird und ein neues Gate in `SANKTIONIERTE_GATES` von
  `tests/einsatz_kontext_guard.rs` Pflege kostet.
- *Alternative:* Verlauf und Gegenüber nur für Führungsberechtigte. Verworfen am Checkpoint, weil
  die Einsatzleitung den Verlauf auch für ihr Führungspersonal lesbar haben will.

### D2 Beweiswahl nach Rolle, Spiegel des Servers

`fuehrungMoeglich` bekommt ein Feld `unterschrift: boolean`. Es ist genau dann wahr, wenn
`notuebernahmeMitBeweis` gilt und das Konto Admin ist. Die Admin-Eigenschaft gibt das Paneel als
Prop herein, die Funktion bleibt rein.

- Ohne Unterschrift entfällt im Dialog die Gruppe „Beweis“, das Feld „Code“ steht direkt da, und
  der Anfangswert ist `beweis: 'code'`.
- Die Bedingung folgt dem Server (`ist_admin()`). Wer nach dem Server unterschreiben darf, sieht
  die Wahl, und wer es nicht darf, sieht sie nicht.
- Auf „Instanzkopplung“ (`EinsaetzeBeimGegenueber`) ist jeder Betrachter Admin, die Prop ist dort
  immer wahr.
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

- [Ein Gerät mit offenem Einsatz-Layout ruft künftig 403 ab] → Der Abruf im `FuehrungHinweisband`
  läuft nur bei `fuehrung.offen`, und Geräte nutzen ihre eigene Hülle (`frontend/src/geraet/`).
  Ein Test prüft die 403. Im Rahmen der Aufgabe wird gegrept, ob eine Funktionsansicht
  `loadFuehrung` nutzt.
- [Die Ausnahme in `einsatz-spiegel` liest sich als Widerspruch zu ADR-0018] → ADR-0021 regelt
  schon, dass die Akte den Spiegel bestimmt. Die Ausnahme verweist auf `instanz-fuehrung` und
  ändert keine Regel von ADR-0018.
- [Der Text des Kapitels driftet erneut] → Die Wörter im Kapitel kommen aus `fuehrungText.ts`,
  `spiegelText.ts` und den Rust-Texten. Die Aufgabe nennt die Quelle je Wort.
