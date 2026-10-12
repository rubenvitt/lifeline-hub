# Design

## Context

Motivation: `proposal.md`, „Why“. Verbindliches Verhalten: Spec `auftrag-aufheben-berichtigen` und
das Delta `eingabegrenzen`.

Stand im Code (12.10.2026, `origin/alpha` 4bdc6ef):

- **Status:** Der Bearbeitungsstatus wird nicht gespeichert, sondern im SQL abgeleitet. Zuständig
  ist `bearbeitungsstatus_sql!` (`src/auftrag/repo.rs`):
  `abgenommen_at` → `abgenommen`, sonst `kommunikation_status.vollzug_status` → `offen` /
  `in_arbeit` / `vollzogen`. Neben dem Enum `AuftragBearbeitungsstatus` (`src/auftrag/mod.rs`,
  `wire_enum!`) gibt es `ist_offen()` als vollständigen `match`.
- **Phasen und Überfälligkeit:**
  - `ist_abgeschlossen_sql!` gilt für `vollzogen` und `abgenommen`.
  - `abschluss_zeit_sql!` ist der Cursor der Abgeschlossen-Liste.
  - `ist_ueberfaellig_sql!` prüft Frist und unquittierte Empfänger, den Status prüft es **nicht**.
    Erst `ist_offen()` im Zähler filtert vollzogene Aufträge heraus.
- **Schreibwege:**
  - Alle laufen über `EinsatzSchreibzugriff<Auftraege>`: 403 ohne Schreibrolle, 409 am
    abgeschlossenen Einsatz.
  - Das Abschnittsgerät darf nur die Routen seiner Allowlist (`src/geraet/mod.rs`); Erteilen und
    Abnehmen fehlen dort.
  - Die ETB-Anordnung beim Erteilen hängt am Schalter „Automatische ETB-Einträge“. Die
    Vollzugsmeldung schreibt immer (`melde_vollzug_tx`).
- **Erinnerung „Quittierfrist“:** `erinnerung` mit `quelle='auto_frist'`, `bezug_typ='auftrag'`.
  Der Scheduler prüft den Auftragsstatus nicht. Heute schließt nur das letzte Quittieren sie
  (`schliesse_offene_auto`). `setze_auto_frist_tx` verschiebt sie und setzt den Auslöser zurück.
- **Frontend:**
  - Die Auftragsstatus liegen auf der Phasenachse `kommunikation/phase.ts` (`AUFTRAG_STATUS`),
    nicht im Statusvertrag `theme/statusFarben.ts`.
  - Der Ton kommt aus `phaseTon`: `abgeschlossen` ergibt `normal` (grün).
  - Ein unbekannter Status fällt in `AuftragKarte` und `AuftraegeListe` auf `offen` zurück.
- **Laufende Nachbararbeit:**
  - LLH-1091 ordnet das Schema (neues Feld `weg`, eigene Migration).
  - LLH-1084 baut Liste und Detail beider Reiter neu.
  - Beide ändern `AuftragKarte`, `AuftragFormular` und das Kapitel.

## Goals / Non-Goals

**Goals:**

- Ein Auftrag kann sauber enden, ohne einen falschen Vollzug.
- Ein noch nicht bestätigter Auftrag lässt sich korrigieren.
- Beides ist im ETB nachvollziehbar, und keine Zahl zählt den aufgehobenen Auftrag als offen.

**Non-Goals:**

- Kein Rückgängig für das Aufheben, keine Wiederaufnahme.
- Keine Berichtigung nach der ersten Quittung. Dann gilt: aufheben und neu erteilen.
- Kein Aufheben und Berichtigen für Einsatzbefehle. Der Befehl hat Fassungen (LFH-972).
- Keine Benachrichtigung der Empfänger über Aufheben oder Berichtigung über das Live-Ereignis
  hinaus. Die Abschnittsansicht aktualisiert sich über `auftrag`.
- Keine Änderung am ETB-Typ „Berichtigung“ und an manuellen Erinnerungen.
- Keine Neuordnung des Schemas (LLH-1091) und kein neues Listen- und Detailmuster (LLH-1084).

## Decisions

### D1 · Aufhebung als eigene Spalten am Auftrag, Status bleibt abgeleitet

Neue nullable Spalten `auftrag.aufgehoben_at`, `aufgehoben_von_id` (FK `benutzer`) und
`aufhebungsgrund`, angelegt per `ALTER TABLE … ADD COLUMN`. Einen CHECK gibt es nicht, also auch
keinen Neuaufbau.

- `bearbeitungsstatus_sql!` prüft `aufgehoben_at IS NOT NULL` **zuerst** und liefert dann
  `aufgehoben`.
- `ist_abgeschlossen_sql!` schließt `aufgehoben` ein.
- `abschluss_zeit_sql!` wird `COALESCE(a.aufgehoben_at, a.abgenommen_at, ks.vollzogen_at,
  a.erstellt_at)`; der Client-Cursor `auftragAbschlussCursor` bekommt dieselbe Reihenfolge.
- `ist_ueberfaellig_sql!` bekommt `a.aufgehoben_at IS NULL`.
- `ist_offen()` liefert für `Aufgehoben` `false`.

**Verworfen: `kommunikation_status.vollzug_status = 'aufgehoben'`.** Das ist die Vollzugs-Achse.
`setze_vollzug_tx` lässt dort bewusst nur drei Werte zu, und das Aufheben eines vollzogenen
Auftrags würde Vollzugsstatus und -zeit überschreiben. Die Vollzugsmeldung soll aber erhalten
bleiben.

### D2 · Aufheben aus „offen“, „in Arbeit“ und „vollzogen“

Die Grenze ist „solange nicht abgenommen“, wie im Auftrag gefordert.

Ein vollzogener Auftrag lässt sich aufheben, wenn sich nach der Meldung zeigt, dass er hinfällig
war. Ein Beispiel: Die Abnahme wird verweigert, weil sich die Lage geändert hat. Die
Vollzugsmeldung bleibt dabei lesbar.

**Verworfen: nur „offen“ und „in Arbeit“.** Dann bliebe ein hinfällig vollzogener Auftrag ewig
„vollzogen“ und nicht abgenommen. Die Abnahme wäre der einzige Ausweg, und sie bestätigt etwas
Falsches.

### D3 · Statuscodes: 422 für den Zustand des Auftrags, 409 nur für den Einsatz

- „Schon aufgehoben“, „schon abgenommen“, „schon quittiert“ und Quittieren, Vollzug oder
  Abnehmen am aufgehobenen Auftrag ergeben **422**. Begründung: `src/AGENTS.md`,
  Statuscode-Konvention, „Status-Übergang“. Dieselbe Wahl trifft `abnehmen` heute für „nicht
  vollzogen“.
- **409** bleibt beim abgeschlossenen Einsatz, er kommt aus dem Extraktor.
- **400** vor jedem 422: leerer oder zu langer Grund, Grenzen der Berichtigung.

**Verworfen: 409 wie bei `storno.rs` („Lebenszyklus storniert“).** Ein Storno nimmt einen
Datensatz aus der Wertung, als wäre er nie entstanden. `aufgehoben` ist dagegen ein regulärer
Endstatus auf der Statusachse des Auftrags, mit eigenem Etikett. Die Spec legt 422 fest.

### D4 · Rechte wie beim Erteilen; Abschnittsgerät ausgeschlossen

Beide Routen nehmen `EinsatzSchreibzugriff<Auftraege>`, also Einsatzleitung und Führungspersonal.
Erteilen trägt dasselbe Recht, und im Führungsalltag hebt oft die Führungsassistenz auf
Anweisung auf.

Die Allowlist des Abschnittsgeräts bekommt die neuen Routen nicht. Der Wächtertest in
`src/geraet/mod.rs`, der verbotene Routen aufzählt, nimmt beide auf.

**Verworfen: nur Einsatzleitung (`EinsatzLeitungszugriff`).** Das wäre strenger als das Erteilen.
Wer einen Auftrag erteilen darf, hat ihn auch zu verantworten.

### D5 · ETB: immer eine Anordnung, Wortlaut ohne Schutzwerte

- Beide Vorgänge schreiben im selben `write_retry!` genau eine Anordnung (`TYP_ANORDNUNG`),
  **unabhängig** vom Auto-ETB-Schalter, wie die Vollzugsmeldung.
  - Der Eintrag trägt `etb_eintrag.auftrag_id` = Auftrag.
  - `von` ist „System“ wie beim Erteilen.
  - „An“ wird über `kappe_an` aus den Empfänger-Snapshots gebildet.
  - Die Ereigniszeit ist jetzt.
- Ein Schalter für automatische Einträge betrifft den Spiegel des Erteilens, nicht einen
  Führungsvorgang, den ein Mensch ausdrücklich auslöst.
- Wortlaut wie in der Spec. Die Formulierung „… geändert: … (vorher …).“ folgt dem bestehenden
  Muster der Verpflegung (`verpflegung/mod.rs`, `etb_text::geaendert`).
  - Der Auftragstext steht wörtlich, wie in der Anordnung beim Erteilen (Linie A, LFH-701).
  - Die Felder des Befehlsschemas erscheinen nur mit Namen. Nach dem Schwärzungs-Register gelangen
    sie nie ins ETB, und das bleibt so.
- Die Nummer kommt aus `lfd_nr` („#4“), wie im Titel der Erinnerung.
- Die Formatierung der Texte liegt rein in `src/auftrag/etb_text.rs` (neu, mit Unit-Tests).

**Verworfen:**

- **ETB-Typ „Berichtigung“ mit `berichtigt_eintrag_id` = ursprüngliche Anordnung.**
  - Der Typ berichtigt einen Fehler im *Tagebuch*. Hier ändert sich der *Auftrag*, und das ist ein
    neuer Führungsvorgang.
  - Bei ausgeschaltetem Auto-ETB gäbe es zudem keine Anordnung, auf die sich der Eintrag beziehen
    könnte.
  - Der ETB-Zähler `je_typ.berichtigung` würde verfälscht.
- **System-Eintrag (`TYP_SYSTEM`):** FwDV 100 führt das Aufheben als Anordnung.
- **Dem Schalter folgen:** Ein Einsatz ohne Auto-ETB verlöre jede Spur des Aufhebens.

### D6 · Berichtigen: ein PATCH, Teil-Patch, Prüfung in der Transaktion

**Body `AuftragPatch`:**

- `auftrag_text`, `prioritaet`.
- `frist_at` als Tri-State.
- `empfaenger` als vollständige Liste.
- Je Schemafeld ein Tri-State, über `support::deserialize_optional_field`.

Kommen bei LLH-1091 Felder hinzu (`weg`), deckt der PATCH alle Schemaspalten ab, die beim Umsetzen
bestehen.

**Ablauf im `write_retry!` (BEGIN IMMEDIATE):**

1. Stand laden.
2. Prüfen: offen, keine Quittung, nicht aufgehoben, sonst 422.
3. Effektiven Patch gegen den Stand bilden. Ist er leer, ohne Schreiben 200 zurückgeben.
4. Felder schreiben.
5. Haben sich die Empfänger geändert: alte Zeilen löschen und neue mit Snapshot einfügen. Das ist
   unkritisch, weil noch niemand quittiert hat.
6. Erinnerung nachführen (D7).
7. ETB schreiben.
8. Nach dem Commit `sse` und, wenn ein ETB-Eintrag entstand, `live.publiziere`.

Muster dafür: `verpflegung/repo.rs` (`zeitfenster_aendern_tx`).

Die Empfänger-Prüfung des Erteilens (`validiere_empfaenger`, `empfaenger_schluessel` in
`auftrag/eingabe.rs`) wird auf `pub(crate)` geöffnet und geteilt, nicht kopiert.

**Wer darf berichtigen:** Der Server liefert am `AuftragAnzeige` das abgeleitete Flag
`berichtigbar` (offen, keine Quittung, nicht aufgehoben). Der Client rechnet die Regel nicht nach
(„Eine Regel steht genau einmal“).

**Wettlauf mit dem Quittieren:** `quittiere_empfaenger` läuft heute ohne Transaktion. Sein
`UPDATE` bekommt die Bedingung „Auftrag nicht aufgehoben“, und die Zahl der getroffenen Zeilen
entscheidet über 422. SQLite serialisiert Schreiber, also sieht die Berichtigung in ihrer
`BEGIN IMMEDIATE`-Transaktion jede vorher committete Quittung.

**Verworfen:**

- **Bearbeiten Feld für Feld (Muster Einsatzabschnitt, ein PATCH je Feld):** Eine Berichtigung
  „Frist und Empfänger“ ergäbe zwei ETB-Einträge und zwei Live-Runden, und der Empfänger sähe
  einen Zwischenstand.
- **CAS mit `basis_geaendert_at`:** Die Sperre nach der Quittung und die Serialisierung reichen.
  Zwei Führungskräfte, die gleichzeitig berichtigen, schreiben nacheinander, und beide Einträge
  stehen im ETB.

### D7 · Erinnerung „Quittierfrist“ folgt in derselben Transaktion

- **Aufheben:** `schliesse_offene_auto_tx`.
- **Berichtigen mit neuer Frist:** `setze_auto_frist_tx` (Upsert, setzt den Auslöser zurück).
- **Berichtigen mit entfernter Frist:** `schliesse_offene_auto_tx`.

Der Titel bleibt „Auftrag #N Quittierfrist“. Manuelle Erinnerungen zum Auftrag bleiben
unberührt, denn sie hat ein Mensch gesetzt.

**Verworfen: den Scheduler den Auftragsstatus prüfen lassen.** Das wäre eine zweite Stelle mit
derselben Regel, und die offene Erinnerung stünde weiter in der Erinnerungsliste.

### D8 · Frontend-Ton: Ton-Override am Status-Deskriptor

`StatusDeskriptor` bekommt ein optionales `ton?: StatusTon`, und `phaseTon` bzw. `StatusBadge`
nehmen es vor der Phase. Der Eintrag lautet `AUFTRAG_STATUS.aufgehoben = { label: 'Aufgehoben',
phase: 'abgeschlossen', ton: 'neutral' }`. Die Phase bleibt `abgeschlossen`, damit
`istAbgeschlossen`, das Segment und alle Phasen-Konsumenten ohne Änderung richtig zählen.
`phase.test.ts` pinnt den neuen Eintrag.

**Verworfen:**

- **Fünfte `KommPhase` `aufgehoben`:** Jeder Konsument der Achse müsste sie kennen. Der Kopf von
  `phase.ts` lehnt eine eigene Phase für eine Statusmarke ausdrücklich ab („Die Marke gehört an
  den Status, nicht an die Achse“).
- **Umzug der Auftragsstatus nach `theme/statusFarben.ts`:** Laut `kopfStatus.guard.test.ts` wäre
  das eine Umschreibung mit acht Konsumenten, und der Nutzen ist hier gering.

### D9 · Bedienung: Menüauslöser, Rückfrage-Dialog, Formular im Berichtigen-Modus

**Karte:**

- Die Fortschrittsknöpfe bleiben sichtbar wie heute: „Bearbeitung beginnen“ und „Vollzug melden“
  bzw. „Abnehmen“. Damit bleibt `e2e/knopf-wortlaut.spec.ts` gültig.
- „Berichtigen“ und „Auftrag aufheben“ kommen hinter den `MenueAusloeser`. „Auftrag aufheben“
  steht mit `gefahr: true` hinter dem Trenner. Vorbild ist `meldungen/MeldungKarte.tsx`; die Regel
  LFH-365/683 verlangt den Auslöser ab drei Aktionen.
- „Berichtigen“ steht bei `berichtigbar = false` gesperrt mit dem Grund im Etikett: „Berichtigen
  (schon quittiert)“ (LFH-966, Muster „Auftrag erteilen (keine Berechtigung)“ an der Meldung). Bei
  abgeschlossenen Aufträgen und im Status „in Arbeit“ fehlt es.

**Rückfrage:** Neu ist `auftraege/AuftragAufhebenDialog.tsx`.

- Es ist ein `ErfassungsModal` mit `unumkehrbar` und `erfassenText="Auftrag aufheben"`.
- Davor steht ein Satz zur Folge: „Der Auftrag endet, Quittungen werden nicht mehr erwartet.“
- Pflichtfeld „Grund“ mit `whitespace` und `maxLength` aus `api/eingabegrenzen.ts`.
- Der `SpeicherFehler` steht im Dialog, und der Dialog liegt einmal in `AuftraegeListe`, außerhalb
  der Karten-`map`.
- Vorbild ist `kraefte/KraftZeitachse.tsx` („Ereignis streichen“). Einen Rückgängig-Toast gibt es
  nicht (LFH-343: kein Rückweg auf dem Server).

**Berichtigen:** `AuftragFormular` bekommt einen Modus `berichtigen` mit dem Auftrag als
Vorbelegung.

- Die Vorbelegung wird einmal beim Öffnen gesetzt, damit Live-Daten sie nicht überschreiben.
- Die Rückgabe enthält nur die geänderten Felder (Muster `BrBearbeitenModal`, `brPatchAus`).
- Knopf „Berichtigung speichern“, Titel „Auftrag #4 berichtigen“.
- Das Formular öffnet an der Stelle des Paneels „Neuer Auftrag“: inline über der Liste, mit
  derselben Feldfolge wie beim Erteilen (LFH-19: mehr als 5 Felder, also inline). Die Karte wird
  hervorgehoben.

**Aufgehobene Karte:** Etikett „Aufgehoben“ (neutral). Darunter steht „Aufgehoben <taktische Zeit>
von <Name>: <Grund>“ in der Form der Vollzugszeile. Es gibt keine Handlungen.

**Verworfen:**

- **Berichtigen als `ErfassungsModal`:** Bei sieben und mehr Feldern sprengt das das Feldbudget des
  Modals.
- **Eigene Vollseite:** LLH-1084 lehnt sie für Aufträge ab, weil jeder Klick einen Seitenwechsel
  kostet.

Übernimmt LLH-1084 vorher ein anderes Erfassungsgefäß („Auftrag erteilen“ als `ErfassungsModal`
oder Detailpaneel), zieht das Berichtigen in dasselbe Gefäß um. Die Regel bleibt: dasselbe
Formular wie beim Erteilen.

### D10 · Zahlen und Folgeaufträge

- **Server:** Der Zähler (`ist_offen()`), `ist_ueberfaellig_sql!` und `ist_abgeschlossen_sql!`
  (D1) reichen für Modulzähler, Kennzahlen, `phase`-Filter, Dashboard und Vorbereitung. Diese
  lesen nur den Zähler.
- **Client:**
  - `ueberblickDaten.istOffen` filtert schon auf „offen“ oder „in Arbeit“.
  - Die Abschnittsbilanz (`erledigt = !istOffen`, `gesamt`) nimmt `aufgehoben` ganz heraus.
  - `fuehrungsproblemeUebernahme` und `GeraetAuftraegePage` filtern ausdrücklich auf offen bzw. in
    Arbeit und bekommen je einen Test.
  - `test/auftraegeAttrappe.ts` lernt die neue Phase.
- **Fixture:** `tests/fixtures/verdichtung/regeln.json` bekommt den Fall „aufgehoben mit
  abgelaufener Frist“ (`offen: false`, `ueberfaellig: false`); die Erwartungswerte bleiben.
- **Folgeaufträge:** Der aufgehobene Folgeauftrag bleibt in `folgeauftraege` und in „n Aufträge“
  (Spec `etb-folgeauftraege`: „unabhängig vom Bearbeitungsstatus“).

### D11 · Schwärzung und Grenzen

- **Schwärzungs-Register:**
  - `aufhebungsgrund` als `scrub(NullSetzen)`, wie `vollzugsmeldung`: Freitext, der im ETB steht.
  - `aufgehoben_at` als `retain(G_ZEIT)`, `aufgehoben_von_id` als `retain(G_FK)`.
  - `aufgehoben_von_id` kommt in `PERSONENBEZUEGE`, wenn `abgenommen_von_id` dort steht.
    Maßgeblich ist der Wächter.
- **Grenzen:** `AUFHEBUNGSGRUND_MAX = 2_000` (wie `BEFEHLSFELD_MAX`), geprüft per `pflicht_max`
  und gespiegelt in `api/eingabegrenzen.ts` und `tests/eingabegrenzen_spiegel.rs`. Der längste
  ETB-Text bleibt deutlich unter `etb::INHALT_MAX`.

## Risks / Trade-offs

- **Überschneidung mit LLH-1091 und LLH-1084** (laufend, dieselben Dateien: `AuftragKarte`,
  `AuftragFormular`, Kapitel, Migration) → Wer zuerst merged, gewinnt. Diese Change hält ihren
  Anteil in eigenen Bausteinen: Menüeinträge, `AuftragAufhebenDialog`, Berichtigen-Modus als
  Prop. Die Migration hängt sich an; einen Nummernkonflikt löst der Autofix
  (`scripts/migrationen-autofix.sh`). Vor dem PR wird `origin/alpha` gemergt.
- **Ein Status, den ein Konsument nicht kennt, fällt auf `offen` zurück** (`AuftragKarte`,
  `AuftraegeListe`). Ein vergessener Konsument zeigte einen aufgehobenen Auftrag als offen. →
  Dagegen hilft ein Grep nach `AuftragBearbeitungsstatus` und `bearbeitungsstatus` in `tasks.md`.
  Außerdem rechnet das Fixture beider Sprachen, und `phase.test.ts` pinnt jeden Status.
- **Empfänger tauschen löscht Zeilen:** Das ist sicher, weil keine Quittung existiert (Prüfung in
  der Transaktion). Live-Ereignis und Abschnittssicht zeigen den neuen Stand. Ein Abschnitt, der
  den Auftrag verliert, sieht ihn nicht mehr; das ist gewollt.
- **Aufheben ist unumkehrbar:** Ein Fehlklick kostet einen neuen Auftrag. → Pflichtgrund und
  roter Bestätigungsknopf.

## Migration Plan

- Eine Migration mit drei `ADD COLUMN`, angehängt hinter die höchste Nummer auf `origin/alpha` zum
  Zeitpunkt der Umsetzung (`scripts/check-migrationen.sh`). Bestandsdaten bleiben unberührt, alle
  Werte sind `NULL`.
- **Rückweg:** Ein älteres Binary ignoriert die Spalten. Aufgehobene Aufträge erschienen dann
  wieder offen, und ihre ETB-Einträge bleiben. Ein Rückbau braucht deshalb vorher eine bewusste
  Entscheidung.
