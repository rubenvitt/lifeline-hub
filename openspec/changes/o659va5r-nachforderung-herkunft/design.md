# Design

## Context

Zum Warum siehe proposal.md. Heutiger Stand:

- `einsatz_einheit` trägt `nachforderung_id` sowie seit Migration 0246 `nachforderung_angelegt` und
  `nachforderung_belegung_id`. Beide Felder setzt nur die Übernahme (`einheit::aus_nachforderung::
  uebernehmen_tx`). Die drei Eintreffen-Wege mit Verweis (`bereitstellungsraum::eintreffen`:
  `bekannt_tx`, `unangemeldet_tx`, `fahrzeug_als_einheit_tx`) setzen über `verknuepfe_tx` nur
  `nachforderung_id`.
- `nachforderung_angelegt` trennt die Wege nicht: Bei einer verknüpften bestehenden Einheit
  (Übernahme) ist der Wert 0, bei einem am Raum zur Einheit gewordenen Fahrzeug ebenfalls 0.
- `uebernehmen_tx` prüft neue Namen mit `eintreffen::check_namen_frei_tx`. Die Prüfung lehnt jeden
  Namen ab, der einer aktiven Einheit oder einem aktiven Fahrzeug gleicht, ob mit oder ohne
  Einheit.
- Ein Fahrzeug mit Einheit belegt keinen Raum selbst (`belegung_repo::
  einheitenloses_fahrzeug_br_tx`). Ein Fahrzeug, das im Raum steht und zur Einheit wird, muss
  seine Belegung also abgeben.
- Die Karte leitet ihre Einheiten mit `einheitenEinleitung` nur nach dem Status ein (LLH-1395).

## Goals / Non-Goals

**Goals:**
- Je Einheit festhalten, ob die Buchung am Raum den Verweis gesetzt hat, und das an die Karte geben.
- Die Überführung eines Fahrzeugs ohne Einheit einmal bauen und an beiden Stellen nutzen:
  beim Eintreffen und bei der Übernahme.
- Die Entscheidung zu LLH-1449 mit einem Test festschreiben, ohne den Storno umzubauen.

**Non-Goals:**
- Kein Hinweis im Dialog „Als Einheit übernehmen“, dass ein Eintrag einem Fahrzeug gleicht. Der
  Dialog kennt heute nur Einheiten; die Überführung macht der Server, das ETB nennt sie. Ein Hinweis
  vorab wäre ein eigener Nachzug.
- Kein Nachtragen der Herkunft für den Bestand (s. D1).
- Die Raumbuchung des Fahrzeugs wird beim Storno einer Überführung nicht wiederhergestellt (s.
  Risiken).

## Decisions

### D1 Markierung `nachforderung_am_raum` statt einer Spalte mit dem Weg

Migration `0250_einheit_nachforderung_am_raum.sql`:
`ALTER TABLE einsatz_einheit ADD COLUMN nachforderung_am_raum INTEGER NOT NULL DEFAULT 0 CHECK
(nachforderung_am_raum IN (0, 1))`. Der Wert 1 bedeutet: Das Eintreffen am Raum hat den Verweis gesetzt.

Freigegeben war am Checkpoint eine Textspalte `nachforderung_weg` (`'raum'`/`'uebernahme'`/NULL).
Gelesen wird aber nur „am Raum oder nicht“. `'uebernahme'` und NULL führen auf der Karte zum selben
Ergebnis: Vor dem Eintreffen gilt jede verknüpfte Einheit als am Raum (LLH-1395), danach als
übernommen. Ein Wahrheitswert im Stil von 0246 deckt das ab und braucht keinen Backfill. Der
Bestand bleibt 0 und zeigt sich wie bisher (Szenario „Verknüpfung vor dieser Änderung“). Das ist
dieselbe Entscheidung in einfacherer Form, also keine neue Freigabe; am Checkpoint wird sie trotzdem
genannt.

Verworfen: `nachforderung_angelegt` mitbenutzen (wie im Ticket angeregt), weil der Wert die Wege
nicht trennt (s. Context). Ebenso verworfen: die Herkunft aus ETB-Einträgen ableiten, das ist
Textauswertung.

Schreiben:
- `verknuepfe_tx` setzt beim Setzen des Verweises auch `nachforderung_am_raum = 1`. Hat die Einheit
  schon denselben Verweis, ändert sich nichts. Eine schon übernommene Einheit bleibt also
  „übernommen“, wenn sie später mit Verweis am Raum eintrifft.
- `uebernehmen_tx` setzt den Verweis nur an Einheiten ohne Verweis (eine verknüpfte führt in 409)
  und schreibt `nachforderung_am_raum = 0` ausdrücklich mit.
- `stornieren_tx` setzt den Wert mit den anderen Herkunftsfeldern zurück auf 0.

Lesen: `ANZEIGE_SELECT` bekommt eine zweite Unterabfrage `einheit_ids_am_raum` (Teilmenge von
`einheit_ids`, aufsteigend). Das DTO-Feld `einheit_ids_am_raum: MaterialIds` kommt neben
`einheit_ids`. Typ-Codegen läuft nach.

### D2 Karte gruppiert je Einheit

`einheitenEinleitung` wird zu einer Zuordnung je Einheit: `einleitungJeEinheit(n, id)` liefert
„Am Raum eingetroffen“, wenn die Einheit in `einheit_ids_am_raum` steht oder der Status `zugesagt`
bzw. `unterwegs` ist, sonst „Als Einheit übernommen“. `UebernommeneEinheiten` zeigt bis zu zwei
Zeilen in fester Folge (zuerst am Raum, dann übernommen), jede mit ihrer Zahl bzw. ihren Sprüngen.
Unbekannte (aufgelöste) Einheiten zählen in ihrer Gruppe als „weitere“. Die Statusregel bleibt als
Rückfall, deshalb braucht das Frontend keinen dritten Zustand.

### D3 Überführung als gemeinsame Hilfe

Aus `fahrzeug_als_einheit_tx` wird `fahrzeug_zur_einheit_tx(conn, einsatz_id, org_id,
benutzer_id, ef_id, typ_id) -> (einheit_id, name, besatzung)` herausgezogen. Die Hilfe legt die
Einheit an (Name und Funkrufname = Funkrufname des Fahrzeugs, Soll des Fahrzeugs, `typ_id`), ordnet
das Fahrzeug zu und nimmt die Besatzung mit. Das Eintreffen ruft sie mit `typ_id = None` auf, die
Übernahme mit ihrem Typ. Die Prüfung des Fahrzeugs (fremd, beendet, einer Einheit zugehörig) und
die Raumfrage bleiben beim jeweiligen Aufrufer, weil sie verschieden sind (Eintreffen: schon im
Raum → 409; Übernahme: s. D5).

### D4 Namensprüfung der Übernahme kennt das Fahrzeug ohne Einheit

Neue Funktion `eintreffen::check_namen_uebernahme_tx(conn, einsatz_id, namen) ->
Result<Vec<Option<i64>>, AppError>`. Sie liest denselben Bestand wie `check_namen_frei_tx` und
zusätzlich `ef.id` und `ef.einheit_id`. Je Name gilt:
- gleicht einer aktiven Einheit oder einem aktiven Fahrzeug **mit** Einheit → 422 mit demselben
  Wortlaut wie bisher;
- gleicht genau einem aktiven Fahrzeug **ohne** Einheit → `Some(ef_id)`;
- gleicht mehreren Fahrzeugen ohne Einheit → 422 (nicht eindeutig, Wortlaut nennt den Namen);
- sonst `None`.

`check_namen_frei_tx` bleibt für die Doppelbuchung beim Eintreffen unverändert. Die Ableitung aus
einer gemeinsamen Bestandsabfrage verhindert, dass die beiden Prüfungen auseinanderlaufen.

### D5 Überführung in der Übernahme

Für `Zeile::Neu(name)` mit `Some(ef_id)` in Schritt 5 von `uebernehmen_tx`:
1. Den aktuellen Raum des Fahrzeugs über `einheitenloses_fahrzeug_br_tx` lesen (prüft auch 404
   und 409).
2. Steht es in einem Raum, Zeitpunkt seines jüngsten Belegungsereignisses lesen und das Fahrzeug mit
   der Notiz „Als Einheit übernommen“ austreten lassen. `austritt_fahrzeug_bei_entlassung_tx` wird
   dazu zu `austritt_fahrzeug_tx(…, notiz)`; das Entlassen ruft es mit „Fahrzeug entlassen“ auf.
3. `fahrzeug_zur_einheit_tx` mit dem Typ der Übernahme.
4. Verweis wie jede neue Einheit: `nachforderung_angelegt = 1`, `nachforderung_am_raum = 0`.
5. Stand das Fahrzeug in einem Raum, tritt die Einheit über `eintritt_einheit_tx` dort ein, mit dem
   gelesenen Zeitpunkt. So bleiben Wartezeit und Eintreffen in der Zeitachse wahr. Die Belegung
   wird als `nachforderung_belegung_id` festgehalten, und die Einheit zählt in Schritt 6 als „schon
   in einem Raum“.

Der Storno braucht keine Änderung: `nachforderung_angelegt = 1` → `aufloesen_tx` gibt Fahrzeug und
Besatzung frei und lässt die Einheit austreten.

`Uebernommen` bekommt `fahrzeug_ids` und `br_ids` (alle berührten Räume, statt nur `br_id`). So
meldet die Route Live für die überführten Fahrzeuge und ihre Räume. Die Personen der Besatzung
kommen zu `personen`.

### D6 ETB-Wortlaut der Übernahme

`etb_text` nennt einen überführten Eintrag als „RTW 2 aus Fahrzeug“ und hängt bei mitgekommener
Besatzung „, Besatzung: Anna, Berta“ an, nach dem Raumteil. Beispiele stehen im Spec-Szenario. Es
bleibt genau ein Eintrag. Die Belegungswechsel stehen im Raumverlauf, nicht im ETB, so wie beim
Eintreffen.

### D7 LLH-1449: keine Codeänderung

Der Storno bleibt, wie er ist. Ein Test in `aus_nachforderung` sichert ihn: Einheit am Raum mit
Verweis gebucht (bekannte Einheit), dann storniert → aktiv, im selben Raum, kein Austritt im
Verlauf, ETB „Verknüpfung gelöst“, `nachforderung_am_raum = 0`. Ein zweiter Fall deckt das am Raum
zur Einheit gewordene Fahrzeug ab.

## Risks / Trade-offs

- [Raumverlauf zeigt den Austritt des Fahrzeugs „jetzt“, den Eintritt der Einheit zum alten
  Zeitpunkt] → Gewollt: Die Wartezeit hängt am jüngsten Ereignis der Einheit und soll nicht neu
  beginnen. Die Notiz „Als Einheit übernommen“ erklärt den Austritt.
- [Storno einer Überführung stellt die Raumbuchung des Fahrzeugs nicht wieder her] → Das Fahrzeug
  ist frei und lässt sich am Raum neu buchen. Ein automatischer Rückweg müsste den Raumverlauf
  zurückdrehen, was der Storno ausdrücklich nicht tut.
- [Bestand bleibt 0: Vor dieser Änderung am Raum verknüpfte Einheiten heißen nach dem Eintreffen
  weiter „übernommen“] → Wenige Datensätze aus wenigen Tagen. Das Spec-Szenario hält es fest.
- [Neuer Eintrag gleicht einem Fahrzeug, das die Führung gar nicht meinte] → Der Name ist der
  Funkrufname; ein gleichnamiges Fahrzeug ist praktisch dasselbe. Das ETB nennt „aus Fahrzeug“,
  und der Storno macht es rückgängig.

## Migration Plan

Migration 0250 nur mit ADD COLUMN und Vorgabe 0, kein Backfill. `check-migrationen.sh` gegen
`origin/alpha` vor dem Push. Rückweg: Die Spalte bleibt ungelesen stehen, und das alte Frontend
ignoriert das neue Antwortfeld.
