# Design

## Context

Das Personen-Detail hat nach dem PAT-Kern (Change `2026-10-19-y18v58dt-pat-kern`) oben den
Patientenkopf. Darunter stehen Verlauf und „Personendaten“ (`personen/StammdatenRaster.tsx`).
Geschrieben werden die Personendaten heute über die Primäraktion „Bearbeiten“. Sie öffnet ein
Sammelformular mit 9 bis 11 Feldern (`pages/PersonenDetailPage.tsx`, über `useEditSitzung`, Patch
über `personen/personBearbeiten.ts`), mit CAS über die ganze Zeile (`basis_geaendert_at`) und dem
Dialog „Zwischenzeitlich geändert“. Am Gerät ist „Bearbeiten“ ebenfalls die Primäraktion.

Feldweise schreiben heute schon Einsatzdaten, Einheit, Abschnitt und Einsatzkraft (`InlineAngabe`
je `Datenfeld`, ohne CAS) sowie der Patientenkopf (Zustand über `BemerkungZelle`, PAT-Nummer und
Kontamination über `InlineAngabe` in `personen/PatKennzeichen.tsx`, ohne CAS).

Der PATCH `…/personen/{pid}` kann Einzelfelder (Tri-State, Flag/Wert-Paare in
`src/person/repo.rs::aktualisiere`); ein fehlendes Feld bleibt unverändert. Das CAS vergleicht
`geaendert_at` sekundengenau, und `geaendert_at` steigt auch bei Sichtung, Status, PAT und
Abgleich. Die Personen-Freitexte haben am Server keine Grenze (LLH-1329).

LLH-1101 (gleicher Branch, vorher umgesetzt) bringt `components/instrument/FeldFehler` und
`DatenfeldEingabe` für das Sammel-Bearbeiten von Tier und Schaden.

Entscheidungen von Ruben am 19.10.2026: Feld-CAS, leere Angaben als Reihe „+ Name“, LLH-1329 in
diesem PR, Tier und Schaden behalten ihren Sammelmodus.

## Goals / Non-Goals

**Goals:**
- Jede Personenangabe in der Ansicht einzeln schreibbar, höchstens zwei Interaktionen.
- Kein stilles Überschreiben einer gleichzeitigen Änderung desselben Felds, keine Fehlalarme
  durch fremde Felder oder Ereignisse.
- Keine still verlorene Eingabe beim Verlassen.
- Geburtsdatum als echtes Kalenderdatum; Freitextgrenzen für alle Personenfelder.

**Non-Goals:**
- Vormerken von Personendaten ohne Netz (es gibt keinen PATCH-Weg in die Warteschlange; die
  Felder sind ohne Netz gesperrt).
- Ein Seiten-Stufenmodell „Bearbeiten in der Ansicht“ für die ganze App (LLH-1139); dieser
  Change baut nur die Teile, die LLH-1139 später übernimmt (Merker, `InlineAngabe`-Erweiterung).
- Tier und Schaden feldweise (bleiben Sammelmodus, LLH-1101).
- PATCH an einer stornierten Person sperren (eigene Aufgabe, falls gewünscht).
- Geburtsdatum in der Aufnahme (die Aufnahme kennt kein Geburtsdatum).

## Decisions

**D1 — Feld-CAS über `erwartet`.** Der PATCH-Body bekommt ein optionales Objekt `erwartet` mit
denselben Feldnamen wie die Änderung, Wert = Stand beim Öffnen (`null` für leer). Der Server hängt
je genanntem Feld eine Bedingung `AND <spalte> IS ?` an das UPDATE (SQLite `IS` vergleicht auch
NULL); die Koordinate trägt Breite und Länge. Bei 0 Zeilen und vorhandener Person: 409 mit der
Meldung „Zwischenzeitlich geändert“. `basis_geaendert_at` bleibt als Wire-Feld bestehen
(Grenzwert-Regel), das Frontend sendet es für Personen nicht mehr. Ein Feld in `erwartet`, das
nicht auch geändert wird, und eine Koordinate nur halb in `erwartet` sind 422 (Feldkombination,
Statuscode-Konvention in `src/AGENTS.md`). Ein leerer Altwert trifft auch eine leere Zeichenkette. Verworfen: CAS über `geaendert_at` (Fehlalarme durch Sichtung,
Status, PAT; Detail ist nicht live) und blind je Feld (verletzt das Akzeptanzkriterium).

**D2 — Rückfrage bei 409.** Dieselbe Rückfrage wie bisher („Zwischenzeitlich geändert“,
„Überschreiben“ danger, „Verwerfen und neu laden“), jetzt mit dem aktuellen Wert des Felds im
Text (aus dem neu geladenen Detail). „Überschreiben“ sendet denselben Wert ohne `erwartet`; ein
zweiter 409 (Einsatz abgeschlossen) steht als Fehler am Feld. „Verwerfen“ lädt neu und schließt
das Feld.

**D3 — Baustein: `InlineAngabe` erweitert, kein neuer.** Für alle Felder `InlineAngabe` (Freitext
mit `Input`/`TextArea` und Zähler wie `EinsatzkraftPage.textAngabe`), nicht `BemerkungZelle`
(speichert beim Blur, verträgt keine Rückfrage). `InlineAngabe` bekommt:
- `pruefe?: (wert) => string | null` — Meldung als `FeldFehler` unter der Eingabe
  (`aria-describedby`), Senden gesperrt;
- `gesperrt?: string` — Grund sichtbar am Feld, Auslöser nicht bedienbar;
- `onEntwurf?: (geaendert: boolean) => void` — meldet einen ungespeicherten Entwurf;
- Knopfabstand nach Leitlinie (`size="middle"`).
Bestehende Nutzer bleiben unverändert (alle neuen Props optional).

**D4 — Merker „offene Bearbeitung“.** Ein kleiner Seitenkontext (`components/offeneBearbeitung`)
hält höchstens eine offene, geänderte Bearbeitung je Seite (Etikett). Er speist
`useFormularVerlassenSchutz` und `VerlassenRueckfrage` und liefert den anderen Feldern den
Sperrgrund „Erst „Name“ speichern oder abbrechen“ (passend zum Knopf), einmal am Kopf des Abschnitts. Ein offenes Feld ohne Änderung meldet sich
nicht an. LLH-1139 kann denselben Kontext später für Paneele nutzen.

**D5 — Leere Angaben.** `StammdatenRaster` bekommt einen Schreibzweig: gesetzte Angaben als
`Datenfeld` mit `InlineAngabe`, die Zeile „Ohne Angabe“ als Reihe von Linkknöpfen „+ Etikett“
(Steuerhöhe der Dichte, zugänglicher Name „Etikett eintragen“). Ein Tipp öffnet das Feld direkt
in dieser Zeile, mit Fokus. Nach dem Speichern wandert die Angabe ins Raster, der Fokus geht über
`useFokusRueckgabe` auf ihren Wertknopf. Ohne Schreibrecht bleibt der Lesezweig (auch für
`PersonVorschau`).

**D6 — Geburtsdatum.** Reiner Kern `anzeige/kalenderdatum.ts`: `parseKalenderdatum(text, heute)`
liest „TT.MM.JJJJ“, „T.M.JJJJ“, „TT.MM.JJ“ und `YYYY-MM-DD`; zweistelliges Jahr = jüngstes Jahr,
das nicht in der Zukunft liegt; prüft Kalendergültigkeit und „nicht nach heute“ (heute = Tag der
Anzeigezone). `formatKalenderdatum(iso)` zeigt „TT.MM.JJJJ“, ein Wert, der kein ISO-Datum ist,
erscheint roh. Anzeige in Personendaten, `personenSpalten`, `PersonVorschau`, `PersonDruckBlatt`.
Der Server prüft beim Anlegen und im PATCH `YYYY-MM-DD` und „nicht nach heute (UTC + 1 Tag Spielraum)“, sonst 400.
Verworfen: `ZeitpunktEingabe` mit `nurTag` (Zeitpunkt in der Anzeigezone, Jahr 2000+, Schnellwahl).

**D7 — Grenzen (LLH-1329).**

| Feld | Konstante | Grenze |
|---|---|---|
| Name, Vorname | `PERSON_NAME_MAX` | 200 |
| Herkunft / Adresse, Fundort, Melder / Kontakt | `PERSON_ANGABE_MAX` | 500 |
| Zustand / Verdacht | `PERSON_ZUSTAND_MAX` | 500 |
| Notiz (Personendaten) | `PERSON_NOTIZ_MAX` | 2 000 |
| Verlaufsnotiz | `VERLAUFSNOTIZ_MAX` | 2 000 |

Geprüft nach dem Trimmen in Unicode-Skalarwerten mit dem vorhandenen Helfer
(`optional_max`/`optional_max_tri`), im Anlegen (`AnlegenBody`), im PATCH und im Notiz-POST.
Gespiegelt in `api/eingabegrenzen.ts`, Spiegeltest `tests/eingabegrenzen_spiegel.rs`. Die Grenzen
sind großzügig gewählt, damit vorgemerkte Anlagen aus der Warteschlange nicht scheitern; ein
Ablehnen landet sonst wie jede 400 im Wiederherstellungsbereich. Masken: Personendaten,
Aufnahme (`AufnahmeFelder`), Schnellerfassung, Notizzeile, Zustand im Kopf, jeweils mit
`zeichenGrenze`.

**D8 — Ohne Netz.** `useOhneVerbindung` (nie `navigator.onLine`). Ein Grund für den ganzen
Abschnitt Personendaten („Ohne Verbindung nicht änderbar“), am Feld als `gesperrt`. „Zustand /
Verdacht“ im Kopf und in der Betroffenenliste bekommt dieselbe Sperre (heute pausiert die Mutation
still); ein getippter Entwurf bleibt dabei stehen.

**D9 — Kopf und Gerät.** Die Primäraktion „Bearbeiten“ entfällt. Der Seitenkopf trägt dann keine
Primäraktion; das Menü behält Statuswechsel und Stornieren. Am Gerät (UHS, Betreuungsstelle) sind
die Personendaten ebenso feldweise schreibbar (der PATCH ist dort freigegeben).

**D10 — Koordinate und vermisst seit.** Koordinate als ein Feld mit `parseKoordinate`
(`personen/koordinate.ts`): gesendet als Paar, Leeren nimmt beide, Gleichheit am Text, damit ein
unveränderter Wert nicht gerundet zurückgeschrieben wird; „Auf Lagekarte verorten“ bleibt daneben.
„vermisst seit“ über die vorhandene Eingabe (`VermisstSeitFeld`, Zeitpunkt in der Anzeigezone,
Leeren nicht angeboten). Geschlecht als Auswahl, Alter als Zahl mit Regel 0 bis 120.

## Risks / Trade-offs

- [Feld-CAS mit Gleitkomma bei der Koordinate] → Das Frontend sendet als Altwert genau die Zahl
  aus der Antwort; JSON-Zahlen laufen verlustfrei durch f64. Test mit einer gespeicherten
  Koordinate.
- [Server lehnt alte Freitext-Geburtsdaten nicht ab, aber neue Eingaben] → Nur ein geschriebenes
  Geburtsdatum wird geprüft; vorhandene Werte erscheinen roh und lassen sich überschreiben.
- [Grenzen brechen eine vorgemerkte Anlage] → großzügige Grenzen; Ablehnung sichtbar im
  Wiederherstellungsbereich.
- [Viele umzuschreibende Tests des Sammelformulars] → werden zu feldweisen Tests; die Konfliktfälle
  bleiben als Feld-CAS-Fälle erhalten.
- [Kopf ohne Primäraktion] → prüfen, dass kein Wächter genau eine Primäraktion erzwingt.

## Migration Plan

Keine Migration. Wire-Erweiterung `erwartet` ist optional; ältere Clients senden weiter
`basis_geaendert_at` und bekommen das alte Verhalten. Rücknahme: Revert des Branches.

## Open Questions

Keine. Wortlaute der Sperrgründe und Meldungen legt die Umsetzung nach den Textregeln fest.
