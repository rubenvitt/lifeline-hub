# Design

## Context

Motivation und die vier Entscheidungen des Menschen stehen in `proposal.md`. Der Ist-Stand, auf
dem der Entwurf aufsetzt:

- **Purge-Lauf** (`src/einsatz/purge_scheduler.rs`, alle 10 Minuten): Phase A merkt fällige
  Einsätze vor (`geloescht_at`), Phase B schwärzt nach `KARENZ_TAGE = 30`
  (`repo::schwaerze_einsatz`), Phase C räumt das Auth-Audit, danach der WAL-Rückschrieb
  (LFH-725), sobald in diesem Lauf etwas geschwärzt wurde.
- **Schwärzung** (`repo::schwaerze_einsatz`): ein bewachtes UPDATE setzt `geschwaerzt_at`
  (Guard: abgeschlossen, vorgemerkt, nicht geschwärzt), dann
  `schwaerzung_registry::scrubbe_aus_registry`, dann `system_audit_tx` mit der Akteurskette
  (abschließende Person → Einsatzleitung → System-Admin), alles in einer Transaktion.
- **Registry** (`src/einsatz/schwaerzung_registry.rs`): `TABELLEN` taggt jede Spalte jeder
  einsatz-scoped Tabelle als `Scrub(Strategie)` oder `Retain(Grund)`. Die Guards finden die
  Tabellenmenge S dynamisch (`einsatz_id` plus CASCADE-Hülle, GUARD 5 für Fremdkanten). Der
  Scrub wird aus denselben Konstanten erzeugt. Die Registry kennt nur das Scoping auf einen
  Einsatz, keinen Bezug auf eine einzelne Zeile.
- **Archiv-Namensraum** (`src/routes/aufbewahrung.rs`, `src/app.rs`): vier Routen, alle hinter
  `AdminUser` und `fordere_archivzugriff`; Guard `archiv_namensraum_nur_lesend_und_admin`
  (`tests/aufbewahrung.rs`) zählt die Routen und erlaubt genau ein Nicht-GET.
- **Personenarten in der Registry:** Betroffene (`einsatz_person`, Bezüge über `person_id` aus
  Sichtung, Verlauf, Verbleib, UHS-Belegung, Abgleich, Zugriffs-Audit, `uhs_platz`, dazu
  `einsatz_tier.halter_person_id` und `einsatz_schaden.geschaedigt_person_id`). Externe Kräfte
  (`einsatz_personal` mit `personal_id IS NULL`, Bezüge aus `auftrag_empfaenger.person_id`,
  `einsatz_schaden.geschaedigt_personal_id`, `einsatz_stabsfunktion.personal_id`,
  `einsatz_kraft_zeitachse.personal_id`, Führer- und Leiterverweise). Anrufe
  (`infotelefon_anruf`) und Medienkontakte (`medienkontakt`) haben heute keine eingehenden
  Fremdschlüssel.

## Goals / Non-Goals

**Goals:**
- Ein Antrag ist ein Datensatz mit eigenem Lebenszyklus (offen → zurückgenommen | vollzogen),
  nicht ein Flag am Einsatz oder an der Person.
- Der Personen-Scrub ist eine **Teilmenge** des Einsatz-Scrubs: dieselben Spalten, dieselben
  Strategien, nur auf die Zeilen einer Person eingegrenzt. Er kann nie etwas entfernen, was die
  Einsatz-Schwärzung behält.
- Die Vollständigkeit der Personenbezüge prüft ein Guard gegen die Fremdschlüssel der Datenbank,
  wie die bestehenden Guards die Vollständigkeit der Spalten prüfen.

**Non-Goals:**
- **Erwähnungen in Freitexten** (ETB-Wortlaut, Chat, Führungsmodule, System-Einträge laut
  `AUSNAHMEN_SYSTEM_ETB`). Eine Zuordnung von Freitext zu einer Person ist nicht verlässlich; wer
  vollständig entfernen muss, stellt den Einsatz-Antrag. Das ETB bleibt als Führungsdokumentation
  ohnehin (Art. 17 Abs. 3 lit. b und e). Der Wortlaut der System-Einträge ist LFH-752.
- **Stammkräfte und Benutzerkonten.** Deren Daten sind Stammdaten der Organisation, nicht
  einsatz-scoped; ein Löschersuchen dort ist ein eigener Prozess.
- **Geräte-Caches und Live-Aktualisierung.** Offline-Lagebild (LFH-723) und offene Clients
  erfahren vom Vollzug nichts, wie heute bei der fristbasierten Schwärzung. Folgeticket LFH-996.
- Vier-Augen-Prinzip, Antrag an laufenden Einsätzen, Export oder Druck der Anträge.

## Decisions

### D1 — Eigene Tabelle `schwaerzung_antrag`

Spalten: `id`, `einsatz_id` (FK, `ON DELETE CASCADE`), `ziel_art` (CHECK `einsatz`,
`betroffene`, `externe_kraft`, `infotelefon_anruf`, `medienkontakt`), `ziel_id` (NULL genau bei
`einsatz`, CHECK), `aktenzeichen` (NOT NULL), `beantragt_von` (FK `benutzer`), `beantragt_at`,
`faellig_at`, `zurueckgenommen_at`, `zurueckgenommen_von`, `vollzogen_at`. CHECK: höchstens einer
von `zurueckgenommen_at` und `vollzogen_at` gesetzt. Ein Ausdrucks-Unique-Index
`(einsatz_id, ziel_art, COALESCE(ziel_id, 0)) WHERE zurueckgenommen_at IS NULL AND vollzogen_at
IS NULL` hält „höchstens ein offener Antrag je Ziel“ in der Datenbank (SQLite behandelt NULL im
UNIQUE als verschieden, daher `COALESCE`).

- Die Tabelle ist einsatz-scoped und muss deshalb in `TABELLEN` stehen. Alle Spalten sind
  `Retain`: Der Antrag ist der Nachweis, dass die Organisation dem Ersuchen nachgekommen ist
  (Rechenschaftspflicht, Art. 5 Abs. 2). `ziel_id` ist ein polymorpher Bezug (`G_POLY`).
- `faellig_at` wird beim Antrag gespeichert (`beantragt_at + 24 h`), damit Rücknahme und
  Vollzug die Grenze im bewachten UPDATE in SQL prüfen, ohne Datumsrechnung in SQL.
- Der Zustand eines Ersuchens bleibt nach dem Vollzug stehen; ein späterer Antrag für dieselbe
  Person scheitert an „bereits vollzogen“ (409), nicht am Unique-Index.

*Verworfen:* Spalten `antrag_*` an `einsatz` und an jeder Personentabelle (vier Tabellen,
vier Migrationen, kein Ort für Aktenzeichen und Historie). Die Vormerkung `geloescht_at` für den
Einsatz-Antrag wiederverwenden (die 30-Tage-Karenz hängt fest daran, und die Rücknahme müsste
zwischen „vom Antrag vorgemerkt“ und „von der Frist vorgemerkt“ unterscheiden).

### D2 — Karenz als Konstante, Grenze in SQL

`ANTRAG_KARENZ_STUNDEN = 24` in `src/einsatz/retention.rs` neben `KARENZ_TAGE`. Rücknahme:
`UPDATE … SET zurueckgenommen_at, zurueckgenommen_von WHERE id = ? AND einsatz_id = ? AND
zurueckgenommen_at IS NULL AND vollzogen_at IS NULL AND faellig_at > ?jetzt`; bei 0 Zeilen neu
lesen und einordnen (unbekannt 404, sonst 409). Vollzug: dieselbe Bedingung mit
`faellig_at <= ?jetzt`. Beide laufen in `write_retry!` (BEGIN IMMEDIATE); wer zuerst schreibt,
gewinnt, der andere findet keine Zeile.

### D3 — Vollzug als eigene Phase im Purge-Lauf

Neue Phase zwischen A und B: fällige Anträge lesen (`faellig_at <= jetzt`, offen, Einsatz nicht
geschwärzt), je Antrag eine Transaktion. Ein Vollzug zählt wie eine Schwärzung für den
WAL-Rückschrieb (LFH-725), damit gilt „Physische Entfernung“ auch hier. Ein Antrag, dessen
Einsatz inzwischen fristbasiert geschwärzt wurde, wird ohne Scrub als vollzogen markiert (der
Scrub ist idempotent, der Audit nennt den Grund).

*Verworfen:* Vollzug per eigenem Tokio-Timer je Antrag (überlebt keinen Neustart) oder im
Request (widerspricht der 24-Stunden-Rücknahme).

### D4 — Einsatz-Vollzug teilt den Kern mit der fristbasierten Schwärzung

`schwaerze_einsatz` wird in einen Kern `schwaerze_einsatz_tx(conn, einsatz_id, jetzt, audit,
akteur)` und zwei Hüllen geteilt. Die fristbasierte Hülle behält ihren Guard (vorgemerkt) und
ihren Audit-Text. Die Antragshülle setzt `geloescht_at = COALESCE(geloescht_at, jetzt)` und
`geschwaerzt_at` im selben bewachten UPDATE (Guard: abgeschlossen, nicht geschwärzt), damit der
Einsatz danach dieselbe Lesesperre und denselben Zustand `geschwaerzt` trägt. Danach markiert sie
alle offenen Anträge des Einsatzes als vollzogen. Audit-Text: der bestehende Text mit
„auf Antrag (Aktenzeichen …)“ statt „Aufbewahrungsfrist + Karenz abgelaufen“.

### D5 — Personenbezüge als zweite Registry-Konstante

```text
PersonenArt { Betroffene, ExterneKraft, InfotelefonAnruf, Medienkontakt }
PersonenBezug { art, tabelle, bezug: SelbstId | Spalte(&str), spalten: &[(&str, Mit | Ohne(Grund))] }
PERSONENBEZUEGE: &[PersonenBezug]
```

- Wurzeltabelle je Art: `einsatz_person`, `einsatz_personal` (mit dem Zeilenfilter
  `personal_id IS NULL` aus `TABELLEN`), `infotelefon_anruf`, `medienkontakt`.
- `scrubbe_person(conn, einsatz_id, art, id)` erzeugt je Bezug ein UPDATE nur über die
  `Mit`-Spalten, mit der **Strategie aus `TABELLEN`** (eine Quelle), eingegrenzt auf
  `bezug = ?id` UND das Einsatz-Scoping der Tabelle aus `TABELLEN` (eine Zeile eines anderen
  Einsatzes wird nie getroffen) UND den Zeilenfilter.
- Vorgesehene Markierungen (der Guard erzwingt, dass jede Scrub-Spalte eine hat):
  - Betroffene: Wurzel alle Scrub-Spalten; Sichtung, Verlauf, Verbleib, UHS-Belegung alle;
    `einsatz_tier` über `halter_person_id`: `halter_kontakt`, `kennzeichnung` (Chip ist auf den
    Halter registriert), `Ohne` für `antreff_ort`, `notiz`, `abschluss_ziel` (betreffen das Tier);
    `einsatz_schaden` über `geschaedigt_person_id`: `geschaedigt_kontakt`, `ort`, `beschreibung`
    (Schadensort ist faktisch die Adresse der geschädigten Person), `Ohne` für `uebergeben_an`
    (Empfängerin der Übergabe, nicht die Person).
  - Externe Kraft: Wurzel alle; `auftrag_empfaenger` über `person_id`: alle;
    `einsatz_stabsfunktion` über `personal_id`: alle; `einsatz_kraft_zeitachse` über
    `personal_id`: alle; `einsatz_schaden` über `geschaedigt_personal_id` wie bei Betroffenen;
    Leiter- und Führerverweise (`einsatzabschnitt`, `einsatz_einheit`): `erreichbarkeit` ist
    `Mit` (oft die Rufnummer der führenden Person), Bemerkung und Abschnittsauftrag `Ohne` (sie
    beschreiben Abschnitt bzw. Einheit). Umgesetzt in `src/einsatz/schwaerzung_person.rs`.
  - `halter_kontakt` und `geschaedigt_kontakt` sind per CHECK nur ohne Personenverweis gesetzt;
    ihre `Mit`-Markierung ist deshalb wirkungslos, aber vom Guard verlangt und unschädlich.
  - Anruf und Medienkontakt: nur die Wurzel.
- Guards (in `schwaerzung_registry::tests`, gleiche Mechanik wie GUARD 5 über
  `pragma_foreign_key_list`):
  1. Jede FK-Spalte in S, die auf eine Wurzeltabelle zeigt, steht als `bezug` dieser Art.
  2. Jede Scrub-Spalte einer solchen Tabelle hat genau eine Markierung; Retain-Spalten haben
     keine; `Mit` an einer Retain-Spalte ist ein Fehler.
  3. Die Wurzel führt jede ihrer Scrub-Spalten als `Mit`.
  4. Selbsttest: eine Sonden-Tabelle mit FK auf `einsatz_person` und Scrub-Spalte macht 1 rot.

*Verworfen:* Ein handgeschriebener Scrub je Personenart (Drift zur Registry, genau das, was
LFH-229 abgeschafft hat). Den Personenbezug in `SpaltenRegel` selbst kodieren (bläht jede der
~70 Tabellen auf, obwohl nur ~12 einen Personenbezug haben).

### D6 — Personensuche: POST, Abgleich in Rust, Antwort pseudonym

`POST /api/aufbewahrung/einsaetze/{id}/personensuche` mit `{ "suchtext": "…" }`. Der Suchtext
steht im Body, damit kein Name in Zugriffsprotokollen oder Browser-Verlauf landet; Antwort mit
`Cache-Control: no-store`; der Suchtext wird nicht geloggt.

- Abgleich in Rust über die Kandidaten des einen Einsatzes (Betroffene: `vorname`, `name`;
  externe Kräfte: `snap_name`; Anrufe: `anrufer_name`, `rueckruf`;
  Medienkontakte: `kontakt_name`, `kontakt_erreichbarkeit`). Normalisierung: Kleinschreibung,
  `ä→ae`, `ö→oe`, `ü→ue`, `ß→ss`, Satzzeichen zu Leerraum. Treffer, wenn **jedes** Wort des
  Suchtexts als ganzes Wort im Namen steht, oder wenn der Suchtext mindestens 6 Ziffern hat und
  sie gleich den Ziffern eines Kontaktfelds sind. Kein Teilwort-Treffer: das macht die Suche
  nicht zum Abfrage-Orakel für Namensanfänge.
- Treffer: `art`, `id`, `kennung`, `erfasst_at`, `status` (bei Betroffenen), `antrag` (Stand
  eines offenen oder vollzogenen Antrags). Kennungen: Betroffene `R-042`
  (`person::registrier_anzeige`), externe Kraft `EK-<id>`, Anruf `IT-<id>`, Medienkontakt
  `MK-<id>`. Dieselbe Kennung dient der Bestätigung des Antrags.

Betroffene findet die Suche nur über den Namen: `melder_kontakt` ist die Rufnummer der meldenden
Person, ein Treffer darüber führte zum Antrag gegen eine Dritte (Review). Auf Antrag Geschwärzte
erscheinen nicht mehr (ihr Platzhalter träfe sonst die Suche nach „geschwärzt“). **Kein Treffer
heißt nicht „keine Daten“:** Namens-Schnappschüsse entfernter Dispositionen
(`auftrag_empfaenger.snap_anzeige`, `einsatz_stabsfunktion.snap_name` mit verwaistem Verweis) und
Erwähnungen in Freitexten findet sie nicht; der Dialog nennt dafür den Einsatz-Antrag.

*Verworfen:* SQL-`LIKE` (Umlaute, Teilwort-Treffer), GET mit Query-Parameter (Name in Logs), die
Akte um Namen erweitern (bricht „Pseudonyme Archivakte“).

### D7 — Routen und Guard

| Methode | Pfad (unter `/api/aufbewahrung/einsaetze/{id}`) | Handler |
| --- | --- | --- |
| GET | `/schwaerzungsantraege` | Liste der Anträge |
| POST | `/schwaerzungsantraege` | Antrag stellen (201) |
| POST | `/schwaerzungsantraege/{aid}/zuruecknehmen` | Rücknahme (200) |
| POST | `/personensuche` | Suche (200, liest nur) |

Alle mit `AdminUser`, `fordere_archivzugriff` und zusätzlich „nicht geschwärzt“ für Antrag und
Suche. Request-Body Antrag: `{ ziel: { art, id? }, aktenzeichen, bestaetigung }`. Codes nach der
Statuscode-Konvention: Form (Art unbekannt, Aktenzeichen leer/zu lang, `id` fehlt bzw. bei
`einsatz` gesetzt) 400; Zusammenhang (Bestätigung falsch, Stammkraft) 422; Lebenszyklus (aktiv,
geschwärzt, offener oder vollzogener Antrag, Rücknahme zu spät) 409; Person nicht in diesem
Einsatz 404.

Der Guard `archiv_namensraum_nur_lesend_und_admin` wird auf acht Routen und eine **benannte**
Menge erlaubter Nicht-GET-Handler umgestellt (`wiederherstellen`, `antrag_stellen`,
`antrag_zuruecknehmen`, `personensuche`). Zusätzlich prüft er, dass der Handler `personensuche`
keine Schreibtransaktion öffnet (kein `write_retry!`, kein `begin()` im Handler und in seiner
Repo-Funktion). Selbsttest: eine fünfte Nicht-GET-Route macht ihn rot.

### D8 — Zustand `schwaerzung_beantragt`

`AufbewahrungZustand` bekommt `SchwaerzungBeantragt => "schwaerzung_beantragt"`, Rang direkt nach
`geschwaerzt`. `retention::zustand` bekommt die Fälligkeit eines offenen Einsatz-Antrags als
zusätzlichen Parameter; Übersicht und Akte lesen sie per `LEFT JOIN` auf den offenen Antrag mit
`ziel_art = 'einsatz'`. Wire-Kontrakt in `tests/enum_wire_kontrakt.rs`, Codegen, Farbe in
`frontend/src/theme/statusFarben.ts`. Offene Personen-Anträge ändern den Zustand nicht.

### D9 — Frontend in der Archivakte

Viertes Paneel „Löschersuchen (Art. 17)“ in `ArchivAktePage.tsx`: Antragsliste
(`KatalogTabelle`) mit Stand als Statusetikett, Fälligkeit (`ZeitAnzeige`) und „Zurücknehmen“;
darüber „Einsatz sofort schwärzen“ und „Person suchen und schwärzen“. `PersonensucheDialog`
(Suchfeld, Treffertabelle mit Kennung und Art, „Antrag stellen“ je Treffer) und
`SchwaerzungsantragDialog` (Ziel pseudonym, Hinweis auf Unwiderruflichkeit nach 24 h mit
Fälligkeit, beim Personen-Antrag der Hinweis auf Freitext-Erwähnungen und den Einsatz-Antrag,
Aktenzeichen mit Hinweis „ohne Namen“, Kennung eintippen; Absenden erst bei Übereinstimmung).
Das Register zeigt an Betroffenen ein Etikett „auf Antrag geschwärzt“. Gestaltung und Bedienung
nach `frontend/AGENTS.md` (Instrument-Komponenten, Rückfrage-Muster wie
`WiederherstellenDialog`).

### D10 — Audit-Texte

- Antrag: „Löschersuchen nach Art. 17 DSGVO (Aktenzeichen {az}) für {ziel} eingegangen.
  Schwärzung fällig am {faellig}; bis dahin zurücknehmbar.“
- Rücknahme: „Löschersuchen (Aktenzeichen {az}) für {ziel} zurückgenommen.“
- Vollzug Person: „Löschersuchen (Aktenzeichen {az}) vollzogen: personenbezogene Angaben von
  {ziel} unwiderruflich entfernt. Erwähnungen in Freitexten und im ETB bleiben bis zur
  Schwärzung des Einsatzes.“
- Vollzug Einsatz: der bestehende Schwärzungstext mit Antragsbezug (D4).

`{ziel}` ist „Einsatz {einsatznummer}“ oder „{Personenart} {kennung}“. Das Aktenzeichen ist kein
Scrub-Wert und steht deshalb nicht in `AUSNAHMEN_SYSTEM_ETB`.

## Risks / Trade-offs

- [Namen entfernter Dispositionen in Schnappschüssen ohne Verweis] → die Suche findet sie nicht;
  Hinweis im Suchdialog, Weg ist der Einsatz-Antrag.
- [Aktenzeichen enthält einen Namen] → Hinweis im Dialog, Länge ≤ 64, keine Prüfung auf Namen
  möglich. Bleibt als Restrisiko dokumentiert.
- [Suche verrät, ob jemand im Einsatz erfasst ist] → nur System-Admin der Org, nur ganze Wörter,
  Antwort pseudonym, kein Logging des Suchtexts. Der Admin hat ohnehin Archivzugriff.
- [Person-Vollzug an einem noch lesbaren Einsatz, offene Clients zeigen den Namen bis zum
  Neuladen] → Non-Goal mit Folgeticket LFH-996 (Live-Invalidierung, Offline-Caches).
- [Vollzug bis zu 10 Minuten nach Fälligkeit] → Spec sagt „spätestens im ersten Purge-Lauf
  danach“; die Akte zeigt die Fälligkeit, nicht einen exakten Zeitpunkt.
- [Rücknahme und Vollzug gleichzeitig] → beide bewacht über `faellig_at` und den offenen Stand
  in `BEGIN IMMEDIATE`; genau einer gewinnt.
- [Personen-Scrub zu breit oder zu schmal] → Teilmengen-Konstruktion (D5) plus Guards plus
  Ende-zu-Ende-Test mit Nachbarperson, deren Werte bleiben müssen.

## Migration Plan

Eine neue Migration mit der nächsten freien Nummer über `alpha` (`0136`: die `0135` belegte zuvor LFH-749 auf `alpha`; vor dem Commit
`scripts/check-migrationen.sh` gegen frisch geholtes `origin/alpha`). Sie legt nur die Tabelle
und den Index an; Bestandsdaten ändern sich nicht. Ein Rückbau entfernt die Routen; die Tabelle
bleibt (Migrationen werden nie geändert).
