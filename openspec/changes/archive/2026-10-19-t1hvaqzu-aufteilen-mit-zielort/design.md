# Design

## Context

Siehe `proposal.md`, „Why“. Heute:

- `POST /api/einsaetze/{id}/material/{em_id}/aufteilen` nimmt `{ menge }`. `teile_auf_tx`
  (`src/material/disposition_repo.rs`) prüft (409 beendet, 422 Gerät/Menge/Rest), legt per
  `INSERT … SELECT` eine Zeile mit denselben vier Ort-Spalten an und mindert die Ausgangszeile. Der
  Handler schreibt in derselben `write_retry!`-Transaktion einen ETB-Eintrag
  (`etb_text_aufgeteilt`) und meldet danach `material` für beide Zeilen und den Ort der
  Ausgangszeile.
- Jeder Ortswechsel geht über `ort::set_ort_tx` (Vorwert lesen, nur ein neues Ziel per
  `require_ziel_tx` prüfen, vier Spalten in einer Anweisung). PATCH und POST tragen den Ort als
  `OrtPatch` (vier Tri-State-Felder, `validate` → 422 bei zwei Werten, `ziel(aktuell)`).
- Frontend: `MaterialAufteilenModal` hat nur „Menge abteilen“ (Kommentar: „Entscheidung 13.10.2026
  Nr. 4: ohne Zielort“). Die Spalte „Ort“ (`MaterialOrtAngabe`) und der Stamm-Dialog wählen den Ort
  aus `buildOrtOptions`; `ortPatch(ziel, vorher)` baut daraus die Felder. Am Ort holt
  `MaterialAmOrt` über `ZuordnenAuswahl` → `useMaterialOrt().setOrt` immer den ganzen Posten.

## Goals / Non-Goals

**Goals:**
- Eine Teilmenge kommt in einem Request, einer Transaktion und einem ETB-Eintrag an ihren Ort.
- Derselbe Server-Weg aus der Materialliste und vom Ort aus.
- Bestehende Clients (`{ menge }`) verhalten sich unverändert.

**Non-Goals:**
- Kein Aufteilen von Geräten, keine Änderung der Mengengrenzen (LLH-1224 D14 bleibt).
- Kein Zusammenführen gleicher Posten am Ziel: liegt dort schon eine Wolldecken-Zeile, steht danach
  eine zweite daneben (wie heute nach Aufteilen + Ort setzen).
- Kein „Teilmenge wegschicken“ aus der Zeile eines Orts heraus; dafür bleibt „Aufteilen …“ der
  Materialliste.

## Decisions

### D1 Die Ort-Felder des PATCH am Aufteilen-Body

`AufteilenBody` bekommt `einheit_id`, `einsatz_fahrzeug_id`, `uhs_id`, `br_id` mit
`deserialize_optional_field`, genau wie `DispoPatchBody`, und wird zu einem `OrtPatch`. Die
Bedeutung ist die des PATCH, bezogen auf den Ort der Ausgangszeile (den die neue Zeile erbt):
fehlt = gleicher Ort, Wert = dorthin, `null` am aktuellen Ort = ohne Ort. Das Frontend baut die
Felder mit dem vorhandenen `ortPatch(ziel, ortVon(posten))`.

*Alternativen:* ein eigener Endpunkt `…/verlegen { menge, ziel }` — zwei Wege für dieselbe
Zeilenteilung, die Grenzen lägen doppelt. Ein Feld `ziel: { art, id }` — eine dritte Ort-Form auf dem
Draht neben PATCH und POST, und „ohne Ort“ bräuchte noch einen Sonderwert.

### D2 Erst prüfen, dann schreiben, Ort über `set_ort_tx`

`teile_auf_tx` bekommt den `OrtPatch` und liefert `(neu_id, OrtWechsel)`. Ablauf:

1. Route: 400 (`menge` < 1) → 422 (`OrtPatch::validate`, zwei Orte), beides vor der Transaktion.
2. `require_aktiv_tx` (404/409) → Art und Mengen (422) wie heute.
3. `ziel = ort.ziel(aktueller Ort)`; ist es ein anderer Ort mit Wert, `ort::require_ziel_tx`
   (404/409/422) — **vor** dem `INSERT`, damit auch ohne umgebende Transaktion jede Ablehnung nichts
   schreibt (Muster von `update_tx`).
4. `INSERT … SELECT` wie heute (die Zeile erbt den Ort), Mindern der Ausgangszeile.
5. Bei geändertem Ziel `ort::set_ort_tx(conn, einsatz_id, neu_id, ziel)`: der eine Schreibweg des
   Orts (Spec `material-modell`), er prüft das Ziel ein zweites Mal, was in derselben Transaktion
   nichts kostet und nichts ändert.

*Alternative:* die neue Zeile gleich mit den Spalten des Ziels einfügen — spart eine Anweisung,
umgeht aber `set_ort_tx` als einzigen Schreibweg des Orts und dessen Prüfung.

### D3 Ein ETB-Eintrag, der beides nennt

`etb_text_aufgeteilt` bekommt einen optionalen Ortswechsel (`Option<(&str, &str)>`, Wortlaut aus
`ort_text_tx`): ohne ihn wie heute „Material «Wolldecke» aufgeteilt: 50 → 30 + 20“, mit ihm
„…, davon 20: Einheit «Staffel A» → UHS «Turnhalle»“. Die Pfeilform ist die des Ortswechsels
(`etb_text_ort_gewechselt`), „davon 20“ sagt, welcher Teil gewandert ist. Kein zweiter Eintrag:
die Spec `material-modell` sagt das jetzt ausdrücklich.

### D4 Live: Ausgangsort und Ziel

Nach dem Commit wie heute `material` für beide Zeilen und `sse_ort` für den Ort der
Ausgangszeile; bei geändertem Ziel zusätzlich `sse_ort` für das Ziel (eine Wahl „ohne Ort“ hat
keinen Leser außer `material`).

### D5 Feld „Ort“ im Dialog „Aufteilen …“

Unter „Menge abteilen“ ein `Select` „Ort“ mit `buildOrtOptions` aus dem `ortKontext` der
Materialliste (dieselben Gruppen wie die Spalte „Ort“, „ohne Ort“ vorn, ein nicht wählbarer
aktueller Ort gesperrt mit seinem Text), vorbelegt mit `toOrtValue(ortVon(posten))`. Der Wert ist
Teil der Formularwerte. Gesendet wird `ortPatch(parseOrtValue(w.ort), ortVon(posten))`; unverändert
→ keine Ort-Felder. Die Zeile „Danach 30 + 20“ bleibt. Der Kommentar mit „Entscheidung 13.10.2026
Nr. 4“ wird durch einen Verweis auf diese Change ersetzt.

### D6 „Teilmenge hierher“ als Mengenfrage beim Zuordnen (Empfehlung, Wahl am Checkpoint)

Wählt die Person unter „Material zuordnen …“ einen Posten, der sich aufteilen lässt
(Verbrauchsgut, Menge ab 2, Rest ab 1; dieselbe Grenze `hoechsteMenge` wie der Aufteilen-Dialog,
dafür nach `kraefte/materialPosten.ts` gezogen), öffnet ein `ErfassungsModal` „Wolldecke hierher“
mit EINEM Mengenfeld „Menge hierher“, vorbelegt mit der ganzen Menge. Gültig ist die ganze Menge
oder 1 bis `hoechsteMenge` („1 bis 30 oder alle 50“); darunter „Danach hier 20, Staffel A 30“.

- ganze Menge → `setOrt(p, ort)` wie heute (PATCH, ETB „A → B“);
- kleiner → Aufteilen mit `ortPatch(ort, ortVon(p))` (D1).

Beides läuft über `useMaterialOrt`, das dafür `teileAufNach(p, menge, ziel)` bekommt und wie
`setOrt` die Listen des alten und neuen Orts invalidiert — so bleibt es EIN Schreibweg je Ansicht.
Geräte, Menge 1 und aufgebrauchte Posten holt die Wahl weiter sofort.

*Alternativen:*
- **B: eigener Knopf „Teilmenge hierher …“** neben „Material erfassen“ mit Posten- und Mengenfeld.
  Lässt das Zuordnen unangetastet, aber wer die Wolldecke unter „Material zuordnen …“ wählt, holt
  still alle 50 — genau der Fehler, den der Task beheben soll — und am Ort steht ein dritter Knopf.
- **C: nichts am Ort**, nur das Feld im Dialog der Materialliste. Am wenigsten Code; an der UHS,
  wo die Decken ankommen, bleibt dann nur der Sprung ins Modul Material.

Empfehlung A: der Weg, den die Person am Ort ohnehin nimmt, fragt einmal nach, und ein Enter
bestätigt die ganze Menge. Der Preis ist ein Handgriff mehr beim Holen eines ganzen
Verbrauchsguts.

## Risks / Trade-offs

- [Ein Enter mehr beim ganzen Verbrauchsgut am Ort] → Vorbelegung mit der ganzen Menge, Enter
  sendet; Geräte und Menge 1 bleiben ein Klick.
- [Ziel wird zwischen Wahl und Senden aufgelöst, Ausgabe ändert sich nebenher] → der Server lehnt
  ab (422/409), die Ablehnung steht im Dialog der Erfassungshülle, nichts ist geschrieben.
- [Zwei gleichnamige Zeilen am Ziel] → bewusst (Non-Goals); das Etikett der Auswahl nennt Menge
  und Ort und unterscheidet sie.
- [Anwenderdoku und Bild `aufteilen.png` veralten] → Mitänderungsregel: Kapitel und Bilder in
  diesem PR.

## Migration Plan

Keine Migration, kein neues Feld in einem Response-DTO, kein Codegen. Der Body wird nur
erweitert; ein älteres Frontend sendet weiter `{ menge }` und bekommt das heutige Verhalten.
Rückweg: Revert des PRs.
