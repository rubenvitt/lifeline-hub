# Design

## Context

Warum, steht in `proposal.md`. Was die Fähigkeit leisten muss, steht in
`specs/dokumentenablage/spec.md`. Der heutige Stand:

- `src/routes/dokument.rs` hat `liste`, `ablegen` (Multipart), `datei` und `entfernen`. Die
  Feldprüfung steckt in `validiere(titel, kategorie, bezug_typ, bezug_id)`. Sie verlangt alle
  Pflichtfelder und meldet einen halben Bezug mit 422.
- `src/dokument/repo.rs` schreibt Ablegen und Entfernen je in **einer** Transaktion
  (`write_retry!`) samt System-ETB-Eintrag (`etb::system_audit_tx`). `bezug_pruefen` sichert die
  Einsatz-Isolation des Bezugsziels (fremd oder unbekannt → 400).
- `einsatz_dokument` hat keine Spalte `geaendert_at`. Ein Bezug liegt in drei Spalten
  (`bezug_abschnitt_id`, `bezug_einheit_id`, `bezug_etb_eintrag_id`), höchstens eine ist gesetzt.
- `DokumentePage.tsx` trägt eine einzige Zeilenaktion („Entfernen“: in der Tabelle `Popconfirm`,
  in der Karte `PrimaerAktion` mit Rückfrage). `DokumentAblegenModal.tsx` baut die Bezug-Optionen
  (Abschnitte, Einheiten, die jüngsten 100 ETB-Einträge) als `typ:id`-Werte.

## Goals / Non-Goals

**Goals:**
- Titel, Kategorie und Bezug ändern, ohne die Datei anzufassen und ohne neuen Upload.
- Die Prüfregeln des Ablegens **wiederverwenden**, nicht kopieren.
- Bediensicht: ein Klick von der Zeile zum vorbelegten Dialog, auf Tabelle und Karte.

**Non-Goals:**
- Die Datei austauschen (neue Version): das bleibt Entfernen und neu Ablegen.
- Ein Änderungsverlauf je Dokument neben dem ETB.
- Rückgängig („Wiederherstellen“) für das Entfernen.
- Eine Fähigkeits-Spec für Ablegen und Entfernen aus LFH-632 nachziehen.

## Decisions

### D1 — PATCH mit einzeln optionalen Feldern, Bezug flach und dreiwertig

`PATCH /api/einsaetze/{id}/dokumente/{did}` nimmt JSON:
`{ titel?: string, kategorie?: string, bezug_typ?: string | null, bezug_id?: number | null }`.

- `titel` und `kategorie`: fehlt = bleibt. `null` gilt als fehlend (beide sind Pflichtangaben
  und lassen sich nicht leeren).
- Bezug über `deserialize_optional_field` (`routes/support.rs`), je Feld dreiwertig:
  beide fehlen → bleibt; beide `null` → entfernen; beide gesetzt → setzen; jede andere Mischung
  → **422** „bezug_typ und bezug_id nur gemeinsam“, wie beim Ablegen.
- Kein Feld genannt → **400** „Nichts zu ändern“ (ein Feld fehlt, kein Zusammenhang).
- Die Feldregeln (Titel nach `trim` nicht leer, höchstens `TITEL_MAX` Zeichen; Kategorie bekannt;
  `bezug_typ` bekannt) kommen aus kleinen Prüffunktionen, die `validiere` und der neue Handler
  gemeinsam nutzen. `validiere` wird dafür in `pruefe_titel`, `pruefe_kategorie` und
  `pruefe_bezug` zerlegt, ohne sein Verhalten zu ändern; die bestehenden Tests in
  `tests/dokument.rs` belegen das.
- `bezug_id` kommt im JSON als Zahl. Ein String oder Bruch scheitert schon beim Deserialisieren
  → 400 über `JsonBody` (Fehlerformat `{error}`).

*Verworfen:* **Vollersatz** (alle drei Felder Pflicht, PUT-Semantik). Einfacher, aber ein Client,
der nur den Titel korrigiert, müsste Kategorie und Bezug mitsenden und überschriebe dabei die
Änderung eines anderen. **Bezug als Objekt** (`bezug: {typ, id} | null`): sauberer im JSON, aber
asymmetrisch zum Multipart des Ablegens und zu den `bezug_*`-Feldern der Antwort; die 422-Regel
„nur gemeinsam“ hätte keinen Ort mehr.

### D2 — ETB-Nachweis je wirksamer Änderung, mit alt → neu

Ablegen und Entfernen schreiben je einen System-ETB-Eintrag. Ein stilles Umbenennen machte den
Eintrag „Dokument abgelegt: Lagepaln (Sonstiges)“ im ETB unauffindbar. Deshalb schreibt eine
wirksame Änderung in derselben Transaktion:

`Dokument geändert: <neuer Titel> (<neue Kategorie>) — Titel: „<alt>“ → „<neu>“; Kategorie:
<alt> → <neu>; Bezug: <alt> → <neu>`

Nur geänderte Angaben stehen hinter dem Gedankenstrich. Der Bezug wird lesbar benannt:
„Abschnitt <Name>“, „Einheit <Name>“, „ETB <lfd_nr>“ oder „ohne“. Alter und neuer Stand werden
**in** der Transaktion gelesen, damit ein gleichzeitiges Ändern den Text nicht verfälscht.

Ist nach dem Vergleich nichts anders (gleicher Titel nach `trim`, gleiche Kategorie, gleicher
Bezug), gibt es kein UPDATE, keinen ETB-Eintrag und kein SSE. Die Antwort ist 200 mit dem
unveränderten Dokument. Der Dialog sendet immer alle drei Felder, und „Speichern“ ohne Änderung
darf das ETB nicht füllen.

*Verworfen:* **Kein Nachweis.** Widerspricht dem Muster von Ablegen und Entfernen und dem ETB als
lückenlosem Protokoll. **Nachweis auch ohne Wirkung:** füllt das ETB mit Rauschen.

### D3 — Kein CAS-Schutz (letzte Änderung gewinnt)

Schaden und Tier schützen ihr PATCH mit `basis_geaendert_at`, weil dort lange Formulare
nebenläufig bearbeitet werden. Hier sind es drei kurze Felder. Jede Änderung steht mit altem und
neuem Wert im ETB (D2), und die Liste aktualisiert sich live. CAS bräuchte eine Migration
(`geaendert_at` fehlt) und den Überschreiben-Dialog. Beides steht in keinem Verhältnis zum
Risiko.

*Verworfen:* CAS über eine neue Spalte `geaendert_at`. Nachrüstbar, ohne die Spec zu ändern,
falls echte Konflikte auftreten.

### D4 — Eigener Bearbeiten-Dialog, Bezug-Helfer geteilt

Neue Komponente `dokumente/DokumentBearbeitenModal.tsx` auf `ErfassungsModal`, Titel
„Dokument bearbeiten“, Knopf „Speichern“. Prop `dokument: Dokument | null`, offen genau dann,
wenn ein Dokument gesetzt ist. Vorbelegt wird beim Öffnen per `setFieldsValue` (Muster
`SprechgruppeFormModal`). Die Erfassungs-Norm sagt: das ist kein Reset.

- **Drei sichtbare Felder:** Kategorie, Titel, Bezug. Ohne Dateifeld passt der Bezug ins
  Feldbudget (≤ 3) und steht offen, nicht im Collapse. Der vergessene Bezug ist einer der drei
  Anlässe des Tickets, und das Feld kann eine Ablehnung auslösen.
- **Geteilt mit dem Ablegen:** Optionen-Aufbau und Wertumwandlung des Bezugs ziehen nach
  `dokumente/bezug.ts` (`bezugWert(dokument)`, `bezugAusWert(wert)`, `useBezugOptionen(...)`).
  `DokumentAblegenModal` nutzt dieselben Helfer, sein Verhalten bleibt gleich.
- **Bezug außerhalb der Auswahl:** Liegt der aktuelle Bezug nicht in den geladenen Optionen (ETB-
  Eintrag älter als die jüngsten 100, oder die Liste lädt noch), ergänzt der Dialog eine Option
  aus dem Dokument selbst („ETB <lfd_nr>“, Abschnitts- bzw. Einheitsname). Sonst zeigte das Select
  den Rohwert `etb_eintrag:123`.
- **Absenden:** Der Dialog sendet immer `titel`, `kategorie` und das Bezugspaar (gesetzt oder
  beide `null`). `mutateAsync`, damit eine Ablehnung die Felder stehen lässt; der Fehler steht als
  `SpeicherFehler` im Dialog. Erfolg: Toast „Dokument geändert“, Invalidierung von
  `einsatzKeys.dokumente` und `einsatzKeys.etb`.

*Verworfen:* **Ablege-Dialog mit Modus.** Dateifeld, Titel-aus-Dateiname, eingeklappter Bezug
und lazy ETB-Laden müssten je Modus abgeschaltet werden. Zwei kleine Dialoge mit geteilten
Helfern sind klarer als einer mit Verzweigungen.

### D5 — Zwei Zeilenaktionen: Tabelle nebeneinander, Karte Primär + Menü

Mit Schreibrecht gibt es zwei ändernde Aktionen. Die Bündelungsregel (LFH-365) greift erst ab
drei.

- **Tabelle:** `<Space size="middle">` mit „Bearbeiten“ (`type="text"`, `IkoneStift`,
  `aria-label` „Dokument <Titel> bearbeiten“) und dem bestehenden „Entfernen“ (rot, `Popconfirm`).
  `size="middle"` verlangt die Regel „Rot steht nicht bündig neben Neutralem“
  (`aktionsabstand.guard.test.ts`).
- **Karte:** Der Kartenplan kennt genau eine Primäraktion plus `weitere`. „Bearbeiten“ wird
  Primäraktion (neutral, häufiger, umkehrbar). „Entfernen“ wandert als `gefahr`-Eintrag in
  `weitere` (Zugänglicher Name „Aktionen zu Dokument <Titel>“). Die Rückfrage dafür ist ein
  `<Modal>` auf Seitenebene außerhalb der Zeilen-`map` mit rotem OK, wie es die Bündelungsregel für
  Menüaktionen vorschreibt.

*Verworfen:* **„Entfernen“ bleibt Primär, „Bearbeiten“ ins Menü.** Dann stünde die unumkehrbare
Aktion vorn und die häufige im Menü. **Beide Aktionen ins Menü:** verlöre die sichtbare
Primäraktion des Kartenplans.

## Risks / Trade-offs

- [Zwei Personen ändern dasselbe Dokument gleichzeitig] → Letzte gewinnt. Beide Änderungen stehen
  mit alt → neu im ETB, die Liste zeigt den Endstand live (D3).
- [Der Bezug zeigt auf ein Ziel, das inzwischen gelöscht ist] → Unverändert gegenüber heute: die
  Liste zeigt dann keinen Namen. Ein PATCH, das den Bezug nicht nennt, prüft ihn nicht neu. Ein
  PATCH, das ihn nennt, prüft ihn wie beim Ablegen.
- [`validiere` zerlegen verändert das Ablegen] → Die bestehenden Ablege-Tests in
  `tests/dokument.rs` (400/422-Fälle) laufen unverändert mit und belegen das gleiche Verhalten.
- [Karten-„Entfernen“ ist einen Klick tiefer] → Gewollt: unumkehrbar hinter Menü und Rückfrage.
  Die Prüfliste (Tabelle 1, Nr. 2) misst die Tabellenzeile, deren Knöpfe stehen bleiben.

## Migration Plan

Keine Migration und kein neues Response-Feld. Der Endpunkt kommt hinzu, bestehende ändern sich
nicht. Rollback: Commit zurücknehmen. Es bleiben keine Daten in neuer Form zurück.
