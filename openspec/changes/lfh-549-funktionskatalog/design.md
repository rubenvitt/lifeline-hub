# Design

## Context

Warum, siehe proposal.md. Bestand, soweit er den Weg bestimmt (Scope vom 30.09.2026):

**Die drei Felder**

| Feld | Herkunft | Schwärzung | Maske |
|---|---|---|---|
| `erinnerung.empfaenger_funktion` | `0044` | Scrub (`NullSetzen`, „kann einen Personennamen tragen“) | nacktes `Input` in `ErinnerungFormular.tsx` |
| `auftrag_empfaenger.funktion_text` | `0048` | Retain (`G_FUEHRUNG`) | Fallback des Tags-Select in `AuftragFormular.tsx`: alles ohne Präfix `abschnitt:`/`einheit:` |
| `einsatz_mitgliedschaft.fuehrungsstelle` | `0100` | Scrub | `FuehrungsstelleModal` in `pages/MitgliederAbschnitt.tsx`, nur die Einsatzleitung setzt sie |

- `snap_anzeige` von `auftrag_empfaenger` ist Retain und entsteht in `snap_anzeige_fuer`. Es speist
  das `an` des ETB-Eintrags zur Anordnung (`empfaenger_klartext`).
- Zur Lesezeit wird bisher nichts aufgelöst, angezeigt wird immer `snap_anzeige`.

**Stab**
- `src/stab/mod.rs` führt `Sachgebiet` s1–s6 (`wire_enum!`, CHECK in `0102`) mit
  `label()`/`kurz_mit_label()`. Das Frontend spiegelt die Labels wörtlich in `stab/sachgebiete.ts`.
- `stab::repo::sachgebiete_von` löst „Benutzer → besetzte Sachgebiete“ über
  `personal.benutzer_id` auf. Das Ergebnis steht als `meine_sachgebiete` am Einsatz, das Frontend
  liest es nicht.

**Personenverknüpfung:** `personal.benutzer_id` ist optional. Die Demo setzt es nie, wie weit die
Mandanten es pflegen, ist nicht gemessen. Deshalb bleibt die Führungsstelle eine ausdrückliche Wahl
(Entscheidung des Menschen).

**Org-weite Einstellungen:** `org_einstellungen` (0070) ist 1:1 je Organisation, validiert wird in
Rust.

## Goals / Non-Goals

**Goals:**
- Eine Wahrheit für den Katalog: Codeliste im Backend, der Client liest sie über einen Endpunkt.
  Keine zweite handgepflegte Labelliste im Frontend.
- Alle drei Felder in einer Migration und einer Change umstellen, keine halbe Migration
  (Stab-Spec, Entscheidung 14).
- Die Auflösung zur Lesezeit liefert der Server. So gelten Modulrecht und Schwärzung an einer
  Stelle.

**Non-Goals:**
- `etb_eintrag.von`/`an` bekommen keinen Code (Funkverkehr). Dort gibt es nur Vorschläge, die als
  Kürzel übernommen werden.
- Kein Postkorb „Aufträge an meine Funktion“, keine Rechte aus der Funktion (Stab-Spec,
  Entscheidung 12).
- Keine Besetzung für `el`, `s7`, Führungshilfspersonal oder Fachberater. Die Stab-Besetzung
  bleibt s1–s6, ihre CHECK-Klausel bleibt.
- Kein Rückschluss vom Freitext der Bestandsdaten auf einen Code, auch nicht bei exakter
  Gleichheit mit „S3“.
- Nicht offline lesbar: Der Katalog kommt nicht in `LAGEBILD_OFFLINE`. Gelesen werden Snapshot und
  Auflösung, die im Auftrag stecken. Ausdrücklich draußen gelassen im Guard.

## Decisions

### D1 Katalog als Wire-Enum `Fuehrungsfunktion` neben `Sachgebiet`
- **Ort und Werte:** Neuer `wire_enum!` in `src/fuehrung/` (neben `src/stab/`), Werte `el`, `s1`–`s7`,
  `fuehrungshilfspersonal`, `fachberater`.
- **`art()`** ist eine reine Funktion am Enum: Leitung, Sachgebiet, Führungshilfspersonal,
  Fachberater.
- **Zuordnung zur Stab-Besetzung:** `sachgebiet() -> Option<Sachgebiet>` bildet s1–s6 auf die
  Besetzung ab, s7 hat keine.
- **Labels:** Das Standardlabel für s1–s6 kommt aus `Sachgebiet::label()`. Es gibt keine zweite
  Liste.
- **DB:** Jede neue Codespalte bekommt eine CHECK-Klausel über dieselben Werte (NULL erlaubt), dazu
  einen Guard-Test, der `ALLE` gegen die CHECK-Liste im Schema hält.
- **Verworfen:**
  - `Sachgebiet` um die übrigen Werte zu erweitern. Das hätte die Stab-CHECK-Klausel und die sechs
    festen Zeilen gebrochen.
  - Eine Org-Katalogtabelle: die „Funktionsmodell zuerst“-Variante, die LFH-46 §5 verworfen hat;
    Entscheidung des Menschen.

### D2 Mandantenlabels in einer eigenen Tabelle, S7 am selben Ort
- **Tabelle** `org_fuehrungsfunktion (org_id, funktion, label, aktiv, geaendert_at, geaendert_von,
  PRIMARY KEY (org_id, funktion))`, CHECK auf `funktion`.
- **Semantik:**
  - `label` NULL bedeutet Standard.
  - `aktiv` ist nur für `s7` erlaubt. Für jeden anderen Code antwortet der Server mit 422.
  - Fehlt die Zeile oder ist `aktiv` NULL, ist S7 aus.
- **Wirksames Label:** Eine Funktion `wirksames_label(conn, org_id, funktion)` bzw. eine geladene
  Labelkarte je Anfrage liefert es. Snapshot, System-ETB der Besetzung, `funktion::ableiten`
  (Kopf) und der Katalog-Endpunkt lesen sie. `ableiten` bekommt die Labels als Parameter und bleibt
  rein.
- **Endpunkte** nach dem Muster der Org-Einstellungen (Pfade prüft die Umsetzung gegen `app.rs`):
  - `GET /api/fuehrungsfunktionen`: jeder Angemeldete, Org aus der Sitzung. Liefert den wirksamen
    Katalog; S7 nur, wenn eingeschaltet.
  - `GET`/`PUT …/admin/fuehrungsfunktionen/{funktion}`: `AdminUser`. Label ≤ 60 Zeichen, getrimmt,
    leer bedeutet NULL.
- **Schwärzung:** Die Tabelle ist nicht einsatzbezogen und steht nicht in der Schwärzungs-Registry
  (Stammdaten, wie `org_einstellungen`).
- **Verworfen:** Spalten in `org_einstellungen`. Das wären elf Labelspalten. Die Tabelle ist das
  Muster von `org_modul_einstellung`.

### D3 Datenmodell: Codespalte neben dem Bestandstext
Eine Migration, nur `ADD COLUMN`, kein Tabellenumbau (`auftrag_empfaenger` ist zweimal umgebaut
worden, und `0089` zeigt den Aufwand):

| Tabelle | neue Spalte | bestehender Text trägt dann |
|---|---|---|
| `erinnerung` | `empfaenger_funktion_code` | `empfaenger_funktion`: Freitext (ohne Code) oder Bezeichnung (bei Code `fuehrungshilfspersonal`/`fachberater`), sonst NULL |
| `auftrag_empfaenger` | `funktion` | `funktion_text`: dieselbe Doppelrolle; `empfaenger_typ` bleibt `'funktion'` |
| `einsatz_mitgliedschaft` | `fuehrungsfunktion` | `fuehrungsstelle`: dieselbe Doppelrolle |

- **Invariante,** geprüft in Rust (Statuscodes nach LFH-267):

  | Fall | Antwort |
  |---|---|
  | Code unbekannt | 400 |
  | Code und Text passen nicht zusammen (Bezeichnung fehlt bei FHP/FB, Text zu `el`/Sachgebiet) | 422 |
  | `s7` bei ausgeschaltetem S7 | 422 |
  | leere Pflichtangabe Funktion (weder Code noch Text) | 400, wie bisher |

- **Wire:** Die Request-DTOs bekommen ein optionales Feld `funktion` bzw. `empfaenger_funktion_code`
  bzw. `fuehrungsfunktion`. Die Führungsstelle behält die Tri-State-Semantik
  (`Option<Option<…>>`): Fehlt es, bleibt der Wert. Mit `null` werden Code und Text zusammen
  geleert.
- **Warum Doppelrolle statt eigener Bezeichnungsspalte:** Der Text trägt heute schon „was da
  steht“, die Schwärzungsklasse der Spalte passt für beide Rollen (Erinnerung und Führungsstelle
  Scrub, Auftrag Retain). Eine dritte Spalte bräuchte eine eigene Klassifikation und verdoppelte
  die Validierung.
- **Schwärzung:** Die Codespalten sind Retain mit `G_ENUM`. Ein Code ist kein Personenbezug.
- **Verworfen:** Die Bestandswerte per Gleichheit „S3“ → `s3` nachziehen. Die Anforderung verbietet
  jede Heuristik über Freitext, und eine exakte Gleichheit ist genau die Stelle, an der „S 3“ still
  herausfiele.

### D4 Snapshot ohne Person, Auflösung im Lesepfad
- **Snapshot:** `snap_anzeige_fuer` bildet bei Code „<KÜRZEL> <wirksames Label>“ („S3 Einsatz“) bzw.
  „<Label>: <Bezeichnung>“ („Fachberater: THW“) und für `el` das Label allein. Kein Personenname:
  `snap_anzeige` ist Retain, der Besetzungsname (`einsatz_stabsfunktion.snap_name`) ist Scrub. Ein
  Name im Snapshot hebelte die Schwärzung aus, dieselbe Überlegung wie in `einsatz/funktion.rs`.
- **Auflösung:**
  - Die DTOs `AuftragEmpfaengerAnzeige` und `ErinnerungAnzeige` bekommen ein optionales Feld
    `aktuelle_besetzung` (`skip_serializing_if`), ein Objekt `{ art, name? }` mit `art` aus
    `BesetzungArt` plus `nicht_vergeben`.
  - Gelesen wird mit einem LEFT JOIN auf `einsatz_stabsfunktion` über `einsatz_id` und die
    Sachgebietsabbildung von D1, in `empfaenger_von`/`liste` und im Erinnerungs-Lesepfad. Keine
    N+1-Abfrage: je Einsatz einmal die Besetzung laden und in Rust zuordnen.
- **Modulrecht:** Die Routen reichen ein `darf_stab_lesen` (aus `berechtigung::erlaubte_module`)
  in den Lesepfad. Ohne dieses Recht wird nicht aufgelöst, das Feld fehlt. Dasselbe Muster wie
  beim Modulzähler: Ohne Recht fehlt es.
- **Live:** `EINSATZ_STREAM_EVENTS.stab` invalidiert zusätzlich `auftraege` und `erinnerungen`
  (`queryKeys.ts`). Der Stab-Strom erreicht nur Personen mit Stab-Recht, und nur die sehen die
  Auflösung, das passt zusammen.
- **Verworfen:** Auflösung im Client aus der Stab-Query. Dann hinge jede Auftragskarte von einer
  zweiten Query ab, das Modulrecht müsste der Client prüfen, und die Offline-Lesefassung der
  Aufträge hätte keine Besetzung.

### D5 Frontend: ein Katalog-Hook, ein reiner Optionsbau, eine Kodierung
- **`fuehrung/useFuehrungsfunktionen.ts`:** `globalKeys.fuehrungsfunktionen()`, nicht live
  (`NICHT_LIVE`), ausdrücklich nicht in `LAGEBILD_OFFLINE`.
- **`fuehrung/funktionsOptionenKern.ts`** (Suffix `Kern`, Regel „Ein reiner Kern bekommt ein
  Suffix“):
  - `funktionsOptionen(katalog, besetzung?, suchtext)` liefert Optionen mit Wert `funktion:<code>`
    bzw. `funktion:<code>:<Bezeichnung>`.
  - Für einen nichtleeren Suchtext zusätzlich „Fachberater: <Text>“ und
    „Führungshilfspersonal: <Text>“ als ausdrückliche Wahl. Der Freitext bleibt der Rohwert.
  - `dekodiere(wert, katalog)` liefert `{ funktion?, text? }` und ist die einzige Umkehr.
  - Es gibt keine Erkennung von „S3“ im Rohtext. Die Kodierung verlangt das Präfix `funktion:`
    und einen Code aus dem Katalog; alles andere ist Freitext. (Nachtrag Umsetzung: geprüft wird
    gegen den Katalog, nicht gegen die gerade angebotenen Optionen — eine Wahl „Fachberater: THW“
    stammt aus dem Tipptext und steht nach dem Leeren der Suche nicht mehr in den Optionen.)
- **Masken:**
  - **Auftrag:** Die Optionsgruppe „Funktionen“ kommt neben „Einsatzabschnitte“/„Einheiten“ in den
    bestehenden Tags-Select. `baueEmpfaenger` erkennt `funktion:`.
  - **Erinnerung:** `Select mode="tags" maxCount={1}` bzw. `AutoComplete` mit denselben Optionen
    (Wahl in der Umsetzung, Kriterium: Enter sendet weiterhin; `Select` schluckt Enter, siehe
    Erfassungs-Norm). `UEBERNAHME` behält `empfaenger`.
  - **Führungsstelle:** Dieselbe Auswahl im `FuehrungsstelleModal`. Der `extra`-Text nennt den
    Vorrang (Stab-Spec, Entscheidung 13).
- **Besetzung für die Vorschläge:** kommt aus der bestehenden Stab-Query, nur wenn das Stab-Modul
  freigegeben ist, sonst ohne Namen.
- **ETB:** `etb/funkrufnamen.ts` nimmt die Sachgebiete als Vorschläge mit Wert = Kürzel auf.
- **Vorbelegung:** Eine reine Funktion `anVorbelegung(einsatz)` (Führungsstelle → erstes
  `meine_sachgebiete` → nichts) ersetzt die beiden Lesestellen von `meine_fuehrungsstelle` in
  `Schnellerfassung.tsx` und `useEtbEntwuerfe.ts`. Der Server liefert `meine_fuehrungsstelle` als
  fertigen Vorbelegungstext (Kürzel, „Fachberater: THW“ oder Freitext); ein zusätzliches Feld
  `meine_fuehrungsfunktion` braucht kein Konsument und entfällt (Nachtrag Umsetzung).
- **Anzeige:** Die Karten von Auftrag und Erinnerung zeigen den Snapshot und, falls vorhanden, die
  Auflösung als zweite Angabe, z. B. „S3 Einsatz · Schulz“ bzw. „· nicht vergeben“ neutral. Die
  Stabseite nimmt das wirksame Label aus dem Katalog statt aus `stab/sachgebiete.ts`; der
  Aufgaben-Kurztext bleibt dort.

### D6 Admin-Sektion „Führungsfunktionen“
- **Ort und Aufbau:** Neue Stammdaten-Sektion in `admin/adminNav.tsx` mit Drift-Test. Eine Liste
  der Codes, Label per `components/InlineAngabe.tsx`. Leer bedeutet Standard, der Standard steht
  als Platzhalter daneben.
- **S7:** Schalter über `switchMasse`.
- **Rechte:** Rechtehinweis für Nicht-Admins per `RechteHinweis`.
- **Form:** Kein Modal, keine Tabelle. Es wird nicht verglichen, also Liste (LFH-330).

## Risks / Trade-offs

- **[Freitext bleibt beliebt, der Katalog wird umgangen]** → Die Katalogwahl steht in den
  Optionen oben, der Freitext wird erst mit Tippen angeboten. Ob das trägt, zeigt der Feldbefund.
  Er ist in der Prüfliste LFH-46 festgehalten.
- **[Die Doppelrolle der Textspalten wird missverstanden]** → Invariante in einer Funktion je
  Tabelle, Paar-Tests „Code + Bezeichnung“ gegen „nur Freitext“. Der Kommentar in der Migration
  nennt die Rolle.
- **[Das Mandantenlabel ändert System-ETB-Texte gegenüber älteren Einträgen]** → Gewollt: Ein Text
  ist ein Snapshot zum Zeitpunkt seiner Entstehung. Ältere Einträge bleiben, wie sie sind.
- **[Die Auflösung verlangsamt die Auftragsliste]** → Eine zusätzliche Abfrage je Einsatz, nicht je
  Empfänger. Gemessen wird an `liste_liefert_auftraege_mit_empfaenger` mit Besetzung.
- **[`funktion::ableiten` bekommt einen Parameter]** → Rein bleibt rein. Alle Aufrufer
  (Einsatzkopf, ETB-Snapshot) laden die Labelkarte einmal.
- **[Rückbau nach dem Feldbefund]** → Bleibt die Besetzung in der Übung ungepflegt, verliert die
  Auflösung ihren Sinn. Der Katalog selbst (Empfänger ohne Tippvarianten) bleibt davon unberührt.

## Migration Plan

1. **Migration** mit der nächsten freien Nummer auf `origin/alpha` (heute 0127;
   `scripts/check-migrationen.sh` vor dem Merge):
   - `ADD COLUMN` × 3 mit CHECK
   - `CREATE TABLE org_fuehrungsfunktion`
   - keine Datenänderung
2. **Rückweg:** Die neuen Spalten sind nullable und werden von altem Code ignoriert. Ein Rollback
   des Binaries liest Bestandsdaten weiter, Codes gehen in der Anzeige verloren, bis wieder
   ausgerollt wird. Der Text trägt bei FHP/FB die Bezeichnung und bleibt damit lesbar.
3. **Kein Backfill.** Bestandswerte bleiben Freitext.
