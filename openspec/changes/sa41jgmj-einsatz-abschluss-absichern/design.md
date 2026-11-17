# Design

## Context

Motivation: proposal.md, „Why“. Stand im Code (17.11.2026):

- **Abschluss:** `POST /api/einsaetze/{id}/abschliessen` (`src/routes/einsatz.rs`, Gate
  `EinsatzLeitungszugriff`) ruft `repo::abschliessen` (`src/einsatz/repo.rs`). In einer
  Transaktion: `UPDATE … WHERE status='aktiv'`; nur wenn eine Zeile betroffen ist, löscht er die
  Freigabe der öffentlichen API, setzt `retention_bis` aus der Dauer (mit
  `retention_gesetzt_at = abgeschlossen_at` und ETB), die Nachbereitungsfrist
  (`nachbereitung::beim_abschluss`, ETB) und die Kategorie-Fristen
  (`aufbewahrung_kategorie::fristen_beim_abschluss`, `frist_gesetzt_at = abgeschlossen_at`, ETB je
  Kategorie). Danach beendet der Handler die Gerätekopplungen. Ein ETB-Eintrag für den Abschluss
  selbst fehlt.
- **Oberfläche:** `EinsatzAbschluss` in `pages/EinsatzdatenPage.tsx` — `Popconfirm` mit
  „Einsatz endgültig abschließen“, nur bei `darfEinsatzLeiten` (aktiv, kein Spiegel,
  Einsatzleitung). So festgelegt durch LFH-960
  (`openspec/changes/archive/2026-10-07-lfh-960-unumkehrbares-absetzen/`), dort waren Eintippen
  und Wiederöffnen Non-Goals.
- **Lesen nach dem Abschluss:** `berechtigung::darf_lesen` — 24 Stunden Schonfrist
  (`NACHLAUF_STUNDEN`) für alle Mitglieder, danach nur die Einsatzleitung; System-Admin und
  org-weite Führungskraft lesen über `darf_fremdeinsatz_lesen`.
- **Gebundene Kräfte:** Der Abschluss lässt `einsatz_fahrzeug`/`einsatz_personal` unberührt;
  eine Bindung über Einsätze hinweg zählt nur in aktiven Einsätzen
  (`fahrzeug/disposition_repo.rs`, `aktive_dispositionen … ez.status = 'aktiv'`).
- **Spiegel:** Jede Änderung an `einsatz` läuft über den Trigger `einsatz_spiegellog_u`
  (Migration 0314) in den Spiegel-Log; am Spiegel selbst sperrt `einsatz_spiegelschutz_u` jede
  Änderung außerhalb einer Übernahme.
- **CHECK** `status IN ('aktiv','abgeschlossen')` (Migration 0003) lässt den Rückweg zu.

## Goals / Non-Goals

**Goals:**

- Ein Fehlklick im falschen Einsatz wird verhindert (Eintippen) und, falls er doch passiert,
  binnen eines Tages ohne Datenverlust rückgängig gemacht (Wiederöffnen).
- Die Einsatzleitung sieht vor dem Abschluss, was noch offen ist, ohne Modul für Modul zu
  suchen.
- Beide Schritte stehen im ETB.

**Non-Goals:**

- Kräfte beim Abschluss automatisch entlassen (entschieden 17.11.2026: Verhalten bleibt, der
  Dialog sagt es).
- Wiederöffnen nach Ablauf der 24 Stunden, nach Archiv, Übergabe zur Verwahrung oder Beginn der
  Schwärzung.
- Gerätekopplungen oder Maschinenzugänge beim Wiederöffnen wiederherstellen.
- Die Schnittstelle von `POST …/abschliessen` ändern (keine Bestätigung im Body).
- Rollenvokabular (LLH-1818) und Ansprechpartner in Sackgassen (LLH-1819).

## Decisions

### D1 — Offene Punkte aus einem eigenen Lese-Endpunkt

`GET /api/einsaetze/{id}/abschluss/pruefung`, Gate `EinsatzLeitungszugriff` (Einsatzleitung,
aktiv). Antwort `AbschlussPruefung` mit je Gruppe `anzahl` und einer Kurzliste (höchstens fünf
Einträge mit Kennung, Bezeichnung und, bei Kräften, Statustext):

| Gruppe | Quelle |
| --- | --- |
| `kraefte` | nicht entlassene Fahrzeuge/Einheiten (`einsatz_fahrzeug`) mit aktuellem Status; nicht entlassene Einsatzkräfte (`einsatz_personal`) als Zahl |
| `auftraege` | Aufträge mit Bearbeitungsstatus offen oder in Arbeit (Regel wie `zaehler.rs`, `AuftragsZaehler.offen`) |
| `meldungen` | offene Meldungen (Regel wie `MeldungsZaehler.offen`) |
| `nachforderungen` | Nachforderungen angefordert, zugesagt oder unterwegs (wie `NachforderungsZaehler.offen`) |
| `betroffene` | Personen mit `Versorgung::Offen` oder `Unterwegs` (`person::versorgung_von`) und Personen mit Status vermisst |

Die Regeln „offen“ übernimmt die Prüfung aus `einsatz/zaehler.rs` (dieselbe Funktion bzw.
dasselbe SQL-Prädikat, kein zweiter Wortlaut), aber **ohne** Filter nach Modulfreigabe: der
Abschluss betrifft den ganzen Einsatz.

*Alternative:* Der Client setzt die Liste aus dem Modulzähler und den Modullisten zusammen. Der
Zähler ist aber je Person nach Modulfreigabe gefiltert, und Kräfte und Betroffene müssten voll
geladen werden. Verworfen.

### D2 — Bestätigung nur im Client

Der Dialog vergleicht die Eingabe mit `einsatznummer_intern` und `bezeichnung` des
`EinsatzAnzeige`-Objekts (`trim`, `toLocaleLowerCase('de')`); der Knopf bleibt bis dahin
`disabled`. Der Server prüft nichts, `POST …/abschliessen` bleibt unverändert.

*Alternative:* Body `bestaetigung` mit 422 im Server. Das bricht jeden bestehenden Aufrufer
(Tests, Seeds, Demo-Import) und schützt nur gegen etwas, das ohnehin binnen 24 Stunden
rückgängig zu machen ist. Verworfen.

Der Dialog ist ein `Modal` statt `Popconfirm`: Er braucht Liste und Eingabefeld. Damit gilt für
den Abschluss die Ausnahme von „Unumkehrbares → `Popconfirm`“ in `frontend/AGENTS.md` — und der
Abschluss ist ja nicht mehr unumkehrbar. Die Regel wird entsprechend umformuliert.

### D3 — ETB-Eintrag beim Abschluss

`repo::abschliessen` schreibt nach dem `UPDATE` (nur bei `rows_affected == 1`) als **ersten**
System-Eintrag „Einsatz abgeschlossen“; die Frist-Einträge folgen. Die Kennung geht in
`etb_eintrag_ids` und wird wie die übrigen live gemeldet.

### D4 — Wiederöffnen: eigenes Gate, eigener Repo-Vorgang, keine Migration

`POST /api/einsaetze/{id}/wiedereroeffnen`, Body `{ "grund": string }` (Pflicht, getrimmt, nicht
leer → sonst 400; Länge nach `eingabegrenzen` wie ein ETB-Inhalt).

Neues Gate `EinsatzWiedereroeffnungszugriff` in `einsatz/kontext.rs`, gebaut nach dem Muster von
`EinsatzFuehrungszugriff`: Org-Floor → kein Gerät (403) → Einsatzleitung **oder** System-Admin
der Einsatz-Org (`fordere_einsatzleitung` bzw. `ist_admin() && org_id == einsatz.org_id`, sonst
403) → Lese-Policy (`fordere_lesezugriff`; die Einsatzleitung liest nach dem Abschluss weiter,
der Admin über `darf_fremdeinsatz_lesen`). Bewusst **ohne** `fordere_aktiv`. Es kommt in
`SANKTIONIERTE_GATES` (`tests/einsatz_kontext_guard.rs`, ADR-0005).

Der Repo-Vorgang `repo::wiedereroeffnen` prüft und schreibt in **einer** Transaktion:

1. Spiegel (`fuehrung_fremd` oder Spiegel-Zeile) → 409 (wie `fordere_aktiv` am Spiegel).
2. Status nicht `abgeschlossen` → 422; `abgeschlossen_at` älter als `NACHLAUF_STUNDEN` → 422.
3. Aufbewahrung greift schon → 422: `geloescht_at` oder `geschwaerzt_at` gesetzt, eine
   Kategorie mit `geschwaerzt_at`, ein offener Schwärzungsantrag, Archiv, Übergabe zur
   Verwahrung oder Abräumen vorgemerkt (die genauen Tabellen bestimmt Aufgabe 3.1).
4. `UPDATE einsatz SET status='aktiv', abgeschlossen_at=NULL, abgeschlossen_von=NULL WHERE id=?
   AND status='abgeschlossen' AND abgeschlossen_at=?` (CAS auf den gelesenen Zeitpunkt; 0 Zeilen
   → 409).
5. Rücknahme (D5), dann der ETB-Eintrag „Einsatz wieder geöffnet (abgeschlossen am … von …):
   <Grund>“ mit der handelnden Person als Erfasser.

Danach im Handler `kopf_geaendert` und die Live-Meldung der ETB-Einträge, wie beim Abschluss.

Statuscodes nach `src/AGENTS.md`: Zustand und Frist sind Zusammenhang → 422; Spiegel und CAS →
409; leerer Grund → 400.

*Alternative:* Spalten `wiedereroeffnet_at/_von` per Migration. Die Spur steht vollständig im ETB
(Spec `aufbewahrung`, „Führungsdokumentation steht allein im ETB“), eine Migration brächte nur
Nummernvergabe und Spiegel-Trigger mit. Verworfen.

*Alternative:* Frist als Org-Einstellung. Verworfen am 17.11.2026; die 24 Stunden sind die
vorhandene Schonfrist, in der ohnehin alle Mitglieder lesen.

### D5 — Was das Wiederöffnen zurücknimmt

| Folge des Abschlusses | Wiederöffnen |
| --- | --- |
| `retention_bis`, wenn `retention_gesetzt_at = abgeschlossen_at` (automatisch) | auf `NULL`, `retention_gesetzt_at` auf `NULL`, ETB „Aufbewahrungsfrist zurückgenommen“ |
| `retention_bis` von Hand gesetzt | bleibt |
| Kategorie-Zeilen mit `frist_gesetzt_at = abgeschlossen_at` (samt `vorgemerkt_at`) | gelöscht, ein ETB-Eintrag je Kategorie |
| Kategorie-Zeilen von Hand gesetzt | bleiben |
| `nachbereitung_bis` | auf `NULL`, ETB, wenn gesetzt (eine von Hand geänderte Nachbereitung geht mit; der erneute Abschluss setzt sie aus der Org-Vorgabe neu) |
| Freigabe der öffentlichen API | bleibt gelöscht |
| Gerätekopplungen | bleiben beendet: der Abschluss macht sie nur über den Status ungültig, deshalb widerruft `wiedereroeffnen` jede noch offene Kopplung in seiner Transaktion (`geraet::repo::widerrufen`, Umsetzung 17.11.2026) |

Der Vergleich „automatisch“ hängt an der Gleichheit der Zeitstempel, die der Abschluss in
derselben Transaktion schreibt (`retention_gesetzt_at = abgeschlossen_at`,
`frist_gesetzt_at = abgeschlossen_at`). Er muss **vor** dem `UPDATE` aus D4, Schritt 4, laufen,
solange `abgeschlossen_at` noch steht.

`nachbereitung::beim_abschluss` setzt nur, wenn noch keine Frist steht („eine gesetzte bleibt,
etwa nach Wiedereröffnen“). Weil das Wiederöffnen sie auf `NULL` setzt, rechnet ein erneuter
Abschluss sie neu.

### D6 — Oberfläche

- Paneel „Einsatzabschluss“ (letzter Abschnitt der Einsatzdaten) zeigt am aktiven Einsatz für
  die Einsatzleitung den Knopf „Einsatz abschließen…“, der den Dialog
  `pages/einsatzdaten/EinsatzAbschlussDialog.tsx` öffnet.
- Dialog: Kopf mit Bezeichnung und Nummer ohne Kürzung; Abschnitt „Noch offen“ aus D1 (Lade-,
  Fehler- und Leerzustand nach `SeitenZustand`/`PaneelZustand`; „Nichts offen“); fester Satz zu
  den Kräften, sobald `kraefte.anzahl > 0`; Satz zu Kopplungen und Maschinenzugängen; Feld
  „Zur Bestätigung Einsatznummer oder Bezeichnung eintippen“; Fuß „Abbrechen“ und rot
  „Einsatz abschließen“ (disabled bis D2 passt). Fehler bleiben im Dialog stehen (`SpeicherFehler`,
  kein Toast).
- Am abgeschlossenen Einsatz zeigt das Paneel „Abgeschlossen am … von …“ (der Name kommt aus
  einem neuen Feld `abgeschlossen_von_name` in `EinsatzAnzeige`, gebildet wie die übrigen
  Anzeigenamen; heute trägt die Anzeige nur die Kennung) und, solange
  `darfEinsatzWiedereroeffnen(einsatz, jetzt)` gilt, „Einsatz wieder öffnen…“ mit „bis …“. Das
  öffnet einen kleinen Dialog mit Pflichtfeld „Grund“ und dem Satz, dass Kopplungen und
  Maschinenzugänge beendet bleiben.
- `darfEinsatzWiedereroeffnen` in `einsatz/schreibrecht.ts`: abgeschlossen, kein Spiegel,
  Einsatzleitung oder System-Admin der Einsatz-Org, `abgeschlossen_at + 24 h > jetzt`. Die
  Zeitgrenze kommt aus einer Konstante neben der Funktion, die ein Test gegen
  `NACHLAUF_STUNDEN` hält (Server bleibt Wahrheit; der Knopf verschwindet nur früher oder später
  nicht).
- Beide Mutationen invalidieren `einsatzKeys.einsatz(id)` und `globalKeys.einsaetze()`; das
  Wiederöffnen zusätzlich den ETB.

## Risks / Trade-offs

- [Eine Kategorie mit 0 Tagen ist binnen 10 Minuten vorgemerkt] → das Wiederöffnen löscht die
  automatisch gesetzte Zeile samt Vormerkung (D5); erst eine Schwärzung sperrt es (D4, 3.).
- [Manuell geänderte Nachbereitung geht beim Wiederöffnen verloren] → steht im ETB-Eintrag; der
  erneute Abschluss setzt die Vorgabe; selten binnen 24 Stunden.
- [Spiegel beim Gegenüber bekommt den Rückweg nicht mit] → Aufgabe 3.6 prüft das mit einem
  Test über den Spiegel-Log; schlägt er fehl, verweigert das Wiederöffnen bei laufendem Spiegel
  mit 409, statt einen auseinanderlaufenden Stand zu erzeugen.
- [Eintippen am Tablet mit Handschuh] → Nummer ist kurz, Groß/Klein egal; wer keine Nummer
  gepflegt hat, tippt die Bezeichnung.
- [Admin sieht den Knopf, darf aber serverseitig nicht, weil die Org abweicht] → Client-Regel
  prüft dieselbe Org-Gleichheit; der Server bleibt die Wahrheit.

## Migration Plan

Keine Migration, keine Datenumstellung. Rücknahme: Revert des Branches; bereits wieder geöffnete
Einsätze sind gewöhnliche aktive Einsätze.
