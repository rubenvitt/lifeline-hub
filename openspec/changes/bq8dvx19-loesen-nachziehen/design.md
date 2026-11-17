# Design

## Context

LLH-1722 (`openspec/changes/archive/2026-11-16-tfq6f4kb-loesende-aktionen/design.md`) hat
festgelegt, wie Lösen heißt, wo es steht und wie es gesichert ist (D1), und für das Einheit-Detail
den Rückweg mit Vorbedingung gebaut (D6: bestehender PUT plus `?nur_wenn_frei=1`, Prüfung in
derselben Transaktion, 409 mit Klartext). Die gehaltene Zeile kommt aus
`components/useHoldGeloest.ts` (D7). Offen geblieben, als „Bekannte Lücke“ in
`frontend/AGENTS.md` und `bedien-muster`:

- Drei Rückwege buchen ohne Vorbedingung: Material am Ort (`PATCH …/material/{em_id}` über
  `ort::set_ort_tx`), Besatzung (`PUT …/fahrzeuge/{ef}/besatzung/{ep}`, `ordne_besatzung_zu_tx`
  ist ein blankes `UPDATE … SET fahrzeug_id`), UHS-Kraft (`PUT …/uhs/{uid}/kraefte/{ep}`, liest
  `alt` schon, verschiebt aber still).
- „Austragen“ am BR (`POST …/bereitstellungsraeume/{bid}/belegung`, `art: austritt`) und an der
  UHS (`POST …/personen/{pid}/uhs-belegung`, `art: austritt`; auch Grundriss „zurückweisen“)
  haben kein Rückgängig. Beide Reihen (`br_belegung` 0061, `person_uhs_belegung` 0029) sind nur
  anhängend. Ein UHS-Austritt setzt den freien Platz davor auf `aufbereitung`
  (`auto_aufbereitung_wenn_frei`), ein erneuter Eintritt darauf scheitert mit 422.
- „Seit“ rechnet am BR aus dem jüngsten Ereignis der Arten Eintritt/Wechsel/Austritt
  (`LetztesEreignis::seit_at`, `letztes_je_objekt`, Kennzahlen), an der UHS aus dem jüngsten
  Nicht-Austritt in der aktuellen UHS (`belegung_repo::aufenthalt`) und im Frontend aus der
  Reihe (`pages/uhs/dringlichkeit.ts`, `wartetSeit`). Ein schlichter neuer Eintritt setzt alle
  drei neu.

Am Phase-1-Checkpoint (17.11.2026) abgestimmt: Austragen lückenlos zurücknehmen; „Rückgängig“ in
Zeilen ohne Regler an der Stelle von Funktion bzw. Position; bei Material nur „Lösen“ ins ⋮;
Grundriss „zurückweisen“ gehört dazu.

## Goals / Non-Goals

**Goals:**

- Kein Rückgängig nimmt einen Datensatz still von einem anderen Ort weg.
- „Austragen“ ist ein Fehltipp, den man ohne Spur in den Zeiten zurücknimmt.
- Kein zweiter Tipp trifft nach dem Lösen eine nachrückende Zeile oder schickt dieselbe Anfrage
  doppelt.
- Material am Ort folgt der Ortsregel aus D1.

**Non-Goals:**

- Personal-Entlassen und Material „Aus dem Einsatz nehmen“ (LLH-1922, LLH-1923).
- „Ausrücken“ und „Abrufen und austragen“ bekommen kein Rückgängig: sie nehmen Untereinheiten mit
  und stehen fachlich am Ende des Wartens.
- Die bewussten Zuordnungswege (Auswahl der Besatzung, `useEinteilungSchreiben`, Materialliste)
  verschieben weiter ohne Rückfrage.
- Strukturierte 409-Antwort (Art, Kennung des neuen Orts). Der Klartext reicht für den Hinweis,
  wie in D6.

## Decisions

### D1 Vorbedingung als Query-Schalter an den bestehenden Routen

`?nur_wenn_frei=1` an PATCH Material, PUT Besatzung und PUT UHS-Kraft, gelesen über
`support::parse_flag`, geprüft in derselben Transaktion wie die Buchung. „Frei“ heißt: nicht
anders gebunden. Schon am Zielort, auf dem Zielfahrzeug oder an der Ziel-UHS zu stehen, gilt als
frei (idempotent).

- Material: vor `update_tx` `load_ort_tx`; ist der Ort gesetzt und nicht das Ziel, 409
  „«Trage» liegt inzwischen an <ort_text_tx>“.
- Besatzung: neues `besatzung_repo::require_besatzung_frei_tx` (Vorbild
  `require_fahrzeug_frei_tx`); 409 „Anna sitzt inzwischen auf «83-2»“ mit
  `funkrufname_anzeige_sql!`.
- UHS-Kraft: `alt` ist schon gelesen; ist er gesetzt und nicht `uhs_id`, 409 „Ben steht
  inzwischen an UHS «Zelt Nord»“. Die bestehende Geräte-Regel (403) bleibt davor.

Verworfen: ein Feld im Body (wie `von_br_id`). Der Material-PATCH hätte einen Body, Besatzung und
UHS-Kraft keinen. Ein Schalter an allen drei hält einen Helfer im Frontend
(`zuruecknahmeQuery`) und folgt D6. Die Routen der Geräte vergleichen nur Methode und Pfad, der
Schalter braucht dort nichts.

### D2 Rücknahme eines Austritts als eigenes, verweisendes Ereignis

Beide Reihen bekommen die Spalte `ruecknahme_von INTEGER REFERENCES <tabelle>(id)` (eine
Migration, Nummer größer als jede auf `origin/alpha`). Eine Rücknahme ist ein Ereignis der Art
`eintritt` mit `ruecknahme_von` = Kennung des Austritts. Die Reihe bleibt nur anhängend, die
Schemata der `art` bleiben unverändert, also kein Tabellenumbau und kein `-- no-transaction`.

Lesestellen übergehen ein Paar, also den Austritt mit Rücknahme und die Rücknahme selbst:

- BR `letztes_je_objekt` und die Kennzahl-Abfrage: im `MAX(x.id)`-Unterselect
  `AND x.ruecknahme_von IS NULL AND NOT EXISTS (SELECT 1 FROM br_belegung r WHERE r.ruecknahme_von = x.id)`.
  Damit ist der Eintritt vor dem Austritt wieder das jüngste Ereignis, „seit“ und die längste
  Wartezeit stimmen.
- UHS `aufenthalt.seit`: jüngstes Nicht-Austritt-Ereignis in der aktuellen UHS mit
  `ruecknahme_von IS NULL`.
- Frontend `wartetSeit`: Die Belegungsschritte tragen `ruecknahme_von`. Ein Austritt merkt sich
  das `beginn` davor; eine Rücknahme stellt es wieder her.
- Verlauf (BR und Person): Die Rücknahme erscheint als eigene Zeile „Austragen zurückgenommen“.

Verworfen:

- Den Austritt löschen oder kennzeichnen (UPDATE). Bricht „nur anhängend“ (0029, 0061), und
  Spiegel und Live-Abgleich sehen ein Ereignis verschwinden.
- Einen neuen Eintritt mit dem alten Zeitpunkt buchen. Er sortiert vor den Austritt, die Reihe
  ordnet nach `id` bzw. `zeitpunkt_at`.
- Eine eigene `art` `ruecknahme`. Braucht einen Tabellenumbau wegen des CHECK, und jede Stelle,
  die `art IN ('eintritt', …)` liest, müsste die neue Art als Eintritt behandeln.
- Ein schlichter neuer Eintritt ohne Verweis (Variante „Neue Buchung“ am Checkpoint abgelehnt).

### D3 Eigene Rücknahme-Routen mit Riegel

- `POST /api/einsaetze/{id}/bereitstellungsraeume/{bid}/belegung/{belegung_id}/zuruecknehmen`
- `POST /api/einsaetze/{id}/personen/{pid}/uhs-belegung/{belegung_id}/zuruecknehmen`

Vorbild ist `…/betreuung/belegungen/{mid}/zuruecknehmen`. Der Client kennt die Kennung des
Austritts aus der Antwort der Austritt-Buchung (beide antworten mit dem Ereignis). Der Server
liest alles Weitere selbst: Raum bzw. UHS und Platz aus dem Ereignis vor dem Austritt.

Riegel, in derselben Transaktion (alles 409 mit Grund, nichts geschrieben):

1. Das Ereignis ist ein Austritt dieser Kraft bzw. Person in diesem Einsatz (sonst 404), kein
   Ausrücken (BR: Notiz bzw. Abruf-Bezug; das prüft der Schritt im Repo, `ausruecken`).
2. Es ist das jüngste Belegungsereignis der Kraft bzw. Person (größte `id`, alle Arten).
3. Es ist noch nicht zurückgenommen.
4. Es ist höchstens zehn Minuten alt (wie die Rücknahme der Entlassung, LLH-1722 D5).
5. Die Bedingungen des Eintritts gelten weiter: Raum bzw. UHS aktiv, die Kraft nicht in einem
   anderen Raum, die Einheit nicht aufgelöst, das Fahrzeug nicht beendet und nicht inzwischen in
   einer Einheit (`check_art_vorbedingung`), die Person in keiner anderen UHS.

Platz an der UHS: War die Person vor dem Austritt auf einem Platz, kehrt sie dorthin zurück,
wenn der Platz frei ist oder in `aufbereitung` steht und seit dem Austritt kein Ereignis einer
anderen Person auf ihm liegt; der Platz geht dann auf `belegt` bzw. den Zustand, den
`eintritt_tx` setzt. Sonst kommt sie in den Wartebereich, und die Antwort trägt
`ohne_platz: true`. Belegt, defekt oder fremd reserviert bleibt also unangetastet.

Rechte: Die Routen verlangen dieselben Rechte wie die Austritt-Buchung, auch am Gerät. Sie
kommen in die Listen der Geräte (`src/geraet/mod.rs`) neben `…/belegung` bzw.
`…/uhs-belegung`.

ETB: Wie beim Austritt außerhalb der Transaktion (`etb_system_degradiert`), am BR „<Kraft>:
Austragen aus <BR> zurückgenommen“, an der UHS pseudonym wie der Austritt.

Antworten: das Rücknahme-Ereignis (`BrBelegungAnzeige` bzw. `BelegungAnzeige`) mit dem neuen Feld
`ruecknahme_von`; an der UHS zusätzlich `ohne_platz` in einer eigenen Antwort-Hülle. Beides sind
Antwort-DTOs, also Typ-Codegen (`scripts/check-typ-codegen.sh`).

Verworfen: ein Feld `ruecknahme_von` an der bestehenden Belegungsroute. Die Route nimmt schon
Eintritt, Wechsel, Austritt und Ausrücken; ein fünfter Weg mit eigenem Riegel und eigener
Platzlogik machte sie unübersichtlich und die Geräteliste ungenau.

### D4 Gehaltene Zeile ohne Regler: „Rückgängig“ an der Stelle der Funktion

In `UhsKraefte` (Tabelle) und im Besatzungsblock der Fahrzeugliste hat die Zeile außer dem
Auslöser keinen Regler. Das Muster aus `FahrzeugeBesatzung`:

- `useHoldGeloest` über die Quelle, `rootProps` am Block, `ortKey` `einsatz:uhs` bzw.
  `einsatz:fahrzeug`.
- Gehaltene Zeile ohne Link und Kontextmenü, gedämpft. An der Stelle des Knopfs ein träger
  `Button aria-disabled` „Gelöst“ im selben `inline-grid` wie der unsichtbare Knopf. An der
  Stelle von Funktion (UHS) bzw. Position/Funktion (Besatzung) „Rückgängig“ im selben Raster
  über dem unsichtbaren Text, damit die Zeile ihre Höhe hält.
- Laufzustand je Zeile (`Set` der laufenden Kennungen) statt `isPending`, damit ein zweiter Tipp
  keinen zweiten DELETE schickt und parallele Zeilen nicht gemeinsam sperren.
- Ablehnung des Rückgängig an der gehaltenen Zeile (`useZeilenFehler`), ist sie gefallen, wie
  heute über der Liste bzw. im Seitenhinweis.

Der Besatzungsblock baut sich beim Zuklappen neu auf; die gehaltene Zeile fällt dann weg. Das
genügt: Wer zuklappt, hat den Bereich verlassen.

### D5 Material am Ort: nur „Lösen“ ins ⋮

Bei `isAusgebbar` steht „Ausgeben“ als Knopf, „Lösen“ in einem `ZeilenMenueAusloeser` an der
Stelle des bisherigen Lösen-Knopfs, aus einer `WeitereAktionen`-Beschreibung, die auch
`useZeilenMenueKontext` am Namensteil speist (Regel „Kontextmenü nur über den Baustein“; die Zeile
hat eine `StatusWahl`). Ohne „Ausgeben“ bleibt der Knopf „Lösen“. Gehalten: ⋮ unsichtbar am Platz,
„Gelöst“ träge im selben Raster. „Lösen“ bleibt neutral im Menü (`menueFarbe.guard`).

„Ausgeben“ ist häufig und zählt, also ein Tipp; „Lösen“ ist selten.

### D6 „zurückweisen“ bleibt rot

Der Grundriss führt „zurückweisen“ als Gefahrknopf bzw. Gefahreintrag (Spec `uhs-grundriss`).
Mit dem Rückgängig wäre es nach D2 aus LLH-1722 (rot nur, was nicht umkehrbar ist) neutral. Es
bleibt rot: Das Gewicht ist fachlich (ein Patient wird abgewiesen), und das Rückgängig hält nur
zehn Minuten.

## Risks / Trade-offs

- **Ablösung und „jüngstes Ereignis“:** Der Rückweg einer Ablösung bucht seine Gegenbuchung nur,
  solange ihre Buchung das jüngste Ereignis der Kraft ist (`frontend/src/kraefte/AGENTS.md`,
  „Verbleib nach dem Vollzug“). Ein Paar aus Austritt und Rücknahme dazwischen macht das
  unmöglich. → Hinnehmen: Ablösung und Austragen am selben Raum in zehn Minuten sind selten, und
  der Rückweg der Ablösung lehnt dann mit Grund ab statt falsch zu buchen.
- **Platz zwischen Austritt und Rücknahme manuell auf Aufbereitung gesetzt:** nicht von der
  automatischen Aufbereitung zu unterscheiden. → Innerhalb von zehn Minuten und ohne fremdes
  Ereignis auf dem Platz nimmt die Rücknahme ihn; das ist der Platz der Person.
- **Spiegel:** Die neue Spalte ist ein Fremdschlüssel auf eine gespiegelte Tabelle; die Wächter
  `schema::tests::jeder_fremdschluessel_ist_eingeordnet` laufen mit.
- **Alter Client gegen neuen Server:** ohne Schalter verhalten sich die drei Routen wie bisher.

## Migration Plan

Eine Migration (`ALTER TABLE br_belegung ADD COLUMN ruecknahme_von …`, dasselbe für
`person_uhs_belegung`), ohne Datenänderung. Frontend und Backend kommen zusammen. Rückbau: Die
Spalte bleibt leer, sobald der Client keine Rücknahme mehr sendet.

## Open Questions

Keine; die Fragen des Checkpoints sind beantwortet. D6 steht zur Freigabe.
