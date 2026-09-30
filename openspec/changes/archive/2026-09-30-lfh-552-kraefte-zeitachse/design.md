# Design

## Context

Den Anlass und den bewussten Bruch des Feldbefund-Riegels beschreibt `proposal.md`, das
Verhalten legt `specs/kraefte-zeitachse/spec.md` fest. Maßgeblich sind diese Befunde aus dem
Bestand (Scope-Lauf vom 30.09.2026):

- **Keine Statushistorie.** `einsatz_personal.aktualisiere_tx`
  (`src/personal/disposition_repo.rs:276`) überschreibt `status_id` ohne Zeitstempel.
  Fahrzeug und Einheit tragen seit LFH-609 nur `status_seit`, also den letzten Wechsel
  (`migrations/0108`). Alle drei schreiben bei echtem Wechsel System-ETB in derselben
  Transaktion (`routes/einsatz_{fahrzeug,personal,einheit}.rs`). Dieser Freitext ist der
  einzige Verlauf.
- **Der Einheitenstatus wird nicht gespeichert, sondern abgeleitet**
  (`einheit::repo::leite_status_ab`): Hat die Einheit Fahrzeuge, gilt deren gemeinsamer Status
  oder „gemischt“. Ohne Fahrzeug gilt der Handstatus aus `setze_hand_status_tx`, der auf den
  Fahrzeug-Katalog `fahrzeug_status` zeigt. Einen „Statuswechsel der Einheit“ gibt es deshalb
  nur als Folge eines Fahrzeugwechsels oder eines Handstatus.
- **Die Status-Kataloge sind pro Organisation frei beschriftet** (`fahrzeug_status`,
  `personal_status`; Kategorie `verfuegbar|gebunden|nicht_verfuegbar`, am Fahrzeug `fms_anker`).
  Ob ein Status „eingetroffen“ bedeutet, lässt sich aus dem Label nicht ablesen.
- **`br_belegung`** (`migrations/0061`) ist das Vorbild für ein append-only Ereignisprotokoll
  mit Art, Zeitpunkt und erfassender Person, das nachgelagert ausgewertet wird. Es arbeitet
  polymorph (`objekt_typ`/`objekt_id`) und schützt die Bindung nur per Code.
- **Ablösung (LFH-635)** hat `beginn_at` bewusst nicht an ein Eintreffen gebunden, weil es
  keins gab (`openspec/changes/archive/2026-09-29-lfh-635-fachmodul-abloesung/design.md`).
  Personal-Ebene und Ruhezeit waren dort ausdrücklich Non-Goals. Diese Change füllt genau diese
  Lücke.
- Die letzte Migration auf `alpha` ist `0126`.

## Goals / Non-Goals

**Goals:**
- Zeitpunkte entstehen ohne zweite Erfassung: aus markierten Statuswechseln und dem Fan-out
  der Einheit. Von Hand wird nur nachgetragen oder berichtigt.
- Ein Statuswechsel scheitert nie an der Zeitachse.
- Dauern werden beim Lesen berechnet und nirgends gespeichert.

**Non-Goals:**
- **Keine Statushistorie.** Ein Wechsel ohne Marke hinterlässt kein Ereignis. Wer eine
  vollständige Historie aller Status will, braucht eine eigene Entscheidung. Die Zeitachse ist
  kein Ersatz dafür.
- **Keine Fahrzeug-Zeitachse.** Ein Fahrzeug wirkt nur über seine Einheit. Ein Fahrzeug ohne
  Einheit hinterlässt nichts.
- Keine Grenzwerte (maximale Einsatzdauer, Mindestruhezeit), keine Einstufung, keine Hinweise
  in der AlarmZentrale und keine Modulzähler. Das bleibt ein eigenes Folgeticket (siehe Open
  Questions).
- Keine Schichtplanung im Voraus, kein Arbeitszeitrecht.
- Keine Anzeige im Stab-Modul. Die Einsatzdauer gehört zum Einsatzwert im Meldebild (Ticket).

## Decisions

### D1 Eine Tabelle mit zwei Fremdschlüsseln statt polymorph

`einsatz_kraft_zeitachse(id, einsatz_id, einheit_id NULL → einsatz_einheit ON DELETE CASCADE,
personal_id NULL → einsatz_personal ON DELETE CASCADE, art, zeitpunkt_at, quelle,
ursprung_id NULL → einsatz_kraft_zeitachse, notiz, erfasst_von, erfasst_at, gestrichen_at,
gestrichen_von, streichgrund)` mit `CHECK ((einheit_id IS NULL) <> (personal_id IS NULL))` und
CHECKs auf `art` und `quelle` (Muster `0102_stab.sql`). Index
`(einheit_id, zeitpunkt_at)` und `(personal_id, zeitpunkt_at)`.

- *Warum nicht polymorph wie `br_belegung`:* Mit zwei Zieltabellen trägt ein echter
  Fremdschlüssel die Kaskade beim Entfernen einer Kraft und die Einsatz-Bindung. Der
  Code-Guard entfällt, und die Schwärzungsregel scopt über `einsatz_id` wie
  `einsatz_abloesung`. Übernommen wird von `br_belegung` das Muster „append-only Ereignis,
  Auswertung nachgelagert“, nicht die Polymorphie.
- *Warum nicht Spalten an den Dispositionstabellen* (`alarmiert_at`, `eingetroffen_at` …):
  Mehrere Perioden, zum Beispiel nach einer Ablösung wieder alarmiert, wären nicht darstellbar,
  und eine Berichtigung überschriebe den alten Wert (Ticket).
- **Append-only mit Streichung, anwendungsseitig:** Die einzigen späteren Schreibzugriffe sind
  die drei Streich-Spalten, einmalig per `UPDATE … WHERE gestrichen_at IS NULL`, und die
  Schwärzung von Freitext. Ein DELETE entsteht nur über die Kaskade. Wie bei `etb_eintrag` und
  `br_belegung` hält das Repo diese Regel, nicht ein Trigger, denn ein UPDATE-Verbot per Trigger
  würde die Schwärzung von `notiz` und `streichgrund` blockieren. Ein Repo-Test prüft, dass
  `zeitachse::repo` außer der Streichung kein UPDATE und kein DELETE enthält. Das Vorbild der
  Streichung ist die Berichtigung im ETB (`berichtigt_eintrag_id`): Der alte Stand bleibt
  lesbar.

### D2 Die Marke steht am Katalog, nicht am Label

`ALTER TABLE fahrzeug_status|personal_status ADD COLUMN zeitachse_marke TEXT CHECK (… IN
('alarmierung','eintreffen','entlassung'))`. Die Pflege läuft über `StatusKatalogTab.tsx`
(Auswahl „Zeitachse“ je Zeile, leer = keine).

- *Warum kein Schluss aus Label oder `fms_anker`:* Die Labels sind frei, und `fms_anker` ist
  laut CLAUDE.md „nur Beschleuniger“. Beides zur Semantik zu machen, erfände Daten.
- **Bestand bleibt leer, nur die Startliste trägt Marken** (Spec). Für den Fahrzeug-Katalog
  bekommt die Startliste keine Marken: FMS 3/4 sind je nach Organisation unterschiedlich
  belegt, und die Entlassung einer Fahrzeugbesatzung hat keinen FMS-Status.
- `ablösung` ist keine Marke. Sie entsteht nur aus dem Vollzug (D5).

### D3 Ein Schreibpfad: `zeitachse::schreibe_tx`

Eine Funktion `schreibe_tx(conn, einsatz_id, kraft, art, zeitpunkt, quelle, ursprung, notiz,
benutzer) -> Ergebnis` lädt die nicht gestrichenen Ereignisse der Kraft, prüft die
Perioden-Regeln rein (`perioden::pruefe_einfuegen`) und schreibt oder meldet `Ausgelassen`.
Aufrufer:

- **Statuswechsel Personal** (`routes/einsatz_personal.rs`, Disposition und PATCH): nach
  `aktualisiere_tx` in derselben Transaktion, wenn sich der Status geändert hat und der neue eine
  Marke trägt. Ergebnis `Ausgelassen` wird verschluckt (Spec: der Status gelingt).
- **Statuswechsel Fahrzeug mit `einheit_id`:** Beginn-Marken wirken, wenn die Einheit die Art in
  der offenen Periode noch nicht trägt. `entlassung` wirkt, wenn danach alle Fahrzeuge der
  Einheit einen Status mit dieser Marke tragen (eine Abfrage in derselben Transaktion).
- **Handstatus Einheit** (`setze_hand_status_tx`): wie ein Wechsel an der Einheit.
- **Nachtrag** (Route): `Ausgelassen` wird zu 422.
- **Vollzug und Rücknahme** der Ablösung (D5).

Nach jedem geschriebenen Einheit-Ereignis läuft der **Fan-out** in derselben Transaktion: je
Person mit `einsatz_personal.einheit_id = einheit` ein `schreibe_tx` mit Quelle `einheit` und
`ursprung_id`. Die Prüfung je Person gilt einzeln.

- *Warum rein geprüfte Perioden:* Die Regeln (höchstens eine Alarmierung und ein Eintreffen je
  offener Periode, Alarmierung nicht nach Eintreffen, kein Ende ohne Periode) werden an drei
  Stellen gebraucht: beim Einfügen, beim Streichen und beim Lesen. Eine reine Funktion über
  einer nach `zeitpunkt_at` sortierten Folge ist testbar ohne DB (Muster `leite_status_ab`).
- *Nachtrag in die Vergangenheit:* Geprüft wird die ganze Folge mit dem neuen Ereignis an seiner
  Zeitstelle, nicht nur das Ende. So kann ein Nachtrag keine frühere Periode zerbrechen.

### D4 Ableitungen beim Lesen, Dauer im Client

Der Server liefert je Kraft die Perioden (`beginn_at`, `anker` = `alarmierung|eintreffen`,
`ende_at?`, `ende_art?`), berechnet mit derselben reinen Funktion wie in D3. Der Client rechnet
Einsatzdauer, Gesamtzeit und Ruhezeit gegen seine Uhr (Minutentakt, ohne Neuladen). Das ist
das Muster aus LFH-635: Die Einstufung dort liefert der Server, die Uhrzeit rechnet der Client.
Hier gibt es keine Einstufung, und eine Dauer, die der Server liefert, veraltete ohne Abruf.

- Die Formatierung („7 h 40“) steht rein in `kraefte/zeitachse.ts` mit Test. Eine Dauer
  unter einer Stunde erscheint als „40 min“.

### D5 Kopplung an die Ablösung

`abloesung::repo::vollziehe` ruft `zeitachse::schreibe_tx(…, art = abloesung, quelle =
abloesung, zeitpunkt = vollzogen_at)` in seiner bestehenden `write_retry!`-Transaktion. Ohne
offene Periode meldet es `Ausgelassen`, und der Vollzug gelingt trotzdem (Spec). Die Kennung
des Ereignisses wird nicht an der Schicht gespeichert. Die Rücknahme findet es über
`(einheit_id, quelle = 'abloesung', zeitpunkt_at = vollzogen_at, nicht gestrichen)` und streicht
es samt Fan-out.

- *Warum keine Spalte `zeitachse_id` an `einsatz_abloesung`:* Das wäre eine Migration an einer
  Tabelle, die gerade erst gelandet ist, nur für einen Rückweg, der sich eindeutig auch so
  finden lässt. Je Einheit gibt es höchstens eine laufende Schicht, und der Vollzugszeitpunkt
  ist exakt.
- **Beginn einer neuen Schicht** (MODIFIED `kraefte-abloesung`): Fehlt `beginn_at`, liest
  `abloesung::anlegen` das Eintreffen der offenen Periode. Die Fristen folgen wie bisher aus der
  Fälligkeit, auch wenn die schon verstrichen ist („Vorwarnzeit schon vorbei“).

### D6 API unter den bestehenden Modul-Präfixen

- `GET /api/einsaetze/{id}/einheiten/zeitachse` → Perioden je Einheit (Meldebild, eine Anfrage)
- `GET /api/einsaetze/{id}/einheiten/{eid}/zeitachse` → Ereignisse + Perioden (Detailseite)
- `POST /api/einsaetze/{id}/einheiten/{eid}/zeitachse` → Nachtrag
- dasselbe unter `/personal` bzw. `/personal/{epid}`
- `POST /api/einsaetze/{id}/einheiten/{eid}/zeitachse/{zid}/streichen` mit `{ grund }`,
  dasselbe unter `/personal/{epid}`. Ein Ereignis, das nicht zur Kraft im Pfad gehört, ist 404.

Alle Endpunkte liegen unter den Präfixen, die `PFAD_KEY` schon den Modulen `einheiten` und
`personal` zuordnet, und erben so die Modulsperre ohne Ausnahme (Guard
`tests/einsatz_kontext_guard.rs`). Bodies laufen über `JsonBody`, IDs über `PfadParam`.

- **Statuscodes** nach `src/error.rs`: fehlende oder unbekannte Art, `abloesung` als Nachtrag,
  leerer Grund → 400. Zukunft, Perioden-Verstoß, doppelte Streichung, Streichen eines
  Ablösungsereignisses → 422. Fremde Kraft → 404.
- **ETB:** Nachtrag und Streichung schreiben System-ETB über `system_audit_tx`. Ereignisse aus
  Status und Fan-out schreiben keinen eigenen Eintrag, weil der Statuswechsel ihn schon
  schreibt. Zeiten erscheinen in der Org-Zeitzone.

### D7 Frontend

- **Meldebild** (`KraefteuebersichtPage.tsx`, Ableitung in `kraefte/meldebildRaster.ts`):
  Spalte „Im Einsatz“ nach „Seit“, Mono + `tabular-nums`, Zahlbreite. Der Anker steht als
  `aria-label`/`title`, Leerfall „—“. Die Druck-CSS übernimmt die Spalte, und die
  Abwesenheit einer Zahl ohne Ereignisse wird getestet („Keine erfundenen Daten“).
- **Einheit-Detailseite:** Paneel „Zeitachse“ (`Paneel` + `Zeitachseneintrag`). Die Herkunft
  steht als Wort, eine gestrichene Zeile durchgestrichen mit Grund. Nachtrag über
  `ErfassungsModal` (Art, Zeitpunkt, Notiz: drei Felder). Streichen über das Aktionsmenü der
  Zeile mit Rückfrage (unumkehrbar, `danger`), weil es keinen serverseitigen Rückweg gibt.
- **Personal-Seite des Einsatzes:** Spalten „Einsatzdauer“ und „Ruhe“ (Mono), aufklappbare
  Zeitachse über `Datensicht.aufklappen` mit demselben Zeitachsen-Bauteil. Nachtrag über
  dasselbe Modal.
- **Katalog:** `StatusKatalogTab.tsx` bekommt die Auswahl „Zeitachse“ (leer = keine).
- **Query-Keys:** `einsatzKeys.kraefteZeitachse` mit Sub-Tokens `einheiten|personal|einheit|
  person`. Live wird es über die bestehenden Stream-Events `einheit`, `personal`, `fahrzeug`,
  `abloesung` invalidiert (`EINSATZ_STREAM_EVENTS`). Es kommt kein neues LiveEvent, denn jedes
  Ereignis entsteht in einer Transaktion, die eines dieser Events schon auslöst. Für Nachtrag
  und Streichung sendet die Route das Event der Kraft.
- **Offline-Lagebild:** Der Prefix kommt in `LAGEBILD_OFFLINE`, weil das Meldebild zum
  Offline-Lagebild gehört (Guard `lagebildOffline.guard.test.ts`).

### D8 Schwärzung und Aufbewahrung

Die Tabelle bekommt eine Regel in `schwaerzung_registry.rs` (Scoping `EinsatzId`). `notiz` und
`streichgrund` sind Freitext und werden geschwärzt, alles andere ist Struktur, Zeit oder Enum
und bleibt (Muster `einsatz_abloesung`). Die Aufbewahrungs-Akte bekommt keine neue Projektion.
Die Klassifikation entsteht über `klassifikation_von` und den Guard
`jede_archivspalte_ist_retain`.

## Risks / Trade-offs

- [Kataloge ohne Marke erzeugen nichts. Bei bestehenden Organisationen bleibt die Zeitachse
  leer, bis jemand die Marken setzt.] → Der Leerfall „—“ ist ehrlich. Die Katalogseite bekommt
  einen Hinweis „Zeitachse: keine Marke gesetzt“, und die Abschlussmeldung an den Menschen
  nennt den Handgriff.
- [Falsch gesetzte Marken schreiben falsche Zeiten, etwa wenn „auf Anfahrt“ als Eintreffen
  markiert wird.] → Die Streichung ist der Rückweg. Die Herkunft `status` ist in jeder Zeile
  sichtbar.
- [Der Fan-out erreicht nur Personen, die zum Zeitpunkt zugeordnet sind. Wird die Zuordnung
  später gepflegt, fehlen ihre Ereignisse.] → Das ist gewollt (Spec). Der Nachtrag an der Person
  schließt die Lücke. Den Feldbefund, ob die Zuordnung gepflegt wird, liefert genau die Übung,
  die LFH-46 E17 verlangt.
- [Die Pflege findet im Feld nicht statt, also genau das Risiko des Riegels.] → Die Erfassung
  fällt überwiegend mit dem Statuswechsel zusammen. Nach der ersten Übung wird geprüft, ob
  Perioden entstanden sind. Wenn nicht, werden Spalten und Nachtrag zurückgebaut, die Tabelle
  bleibt.
- [Die Statuswechsel-Routen werden schwerer, weil Fan-out in derselben Transaktion läuft.] →
  Eine Einheit hat wenige Dutzend Personen, der Aufwand ist also ein Lesen und n Inserts. Die
  Transaktion läuft ohnehin unter `write_retry!`.
- [Die Rücknahme scheitert, wenn eine Person nach dem Vollzug neu alarmiert wurde (die
  Streichung der Ablösungskopie bräche ihre Folge).] → Gewollt: 422 mit Namen statt einer
  still zerbrochenen Zeitachse. Wer zurücknehmen will, streicht zuerst die spätere Alarmierung.
  Der Rückgängig-Toast kommt direkt nach dem Vollzug, der Fall ist dort selten (Review LFH-552).
- [Ein Vollzug mit Zeitpunkt VOR dem Eintreffen (bei früh gesetztem Schichtbeginn) passt vor das
  Eintreffen und teilt die Periode; die Einheit steht danach weiter „im Einsatz“.] → Hingenommen:
  die Folge bleibt regelkonform, und der Nachweis steht in der Zeitachse; eine zusätzliche Sperre
  am Vollzug wäre eine Änderung von `kraefte-abloesung` ohne Anlass aus dem Feld.
- [Der Fan-out folgt der Zuordnung beim Schreiben, nicht der zum Ereigniszeitpunkt (keine
  Zuordnungshistorie).] → In der Spec benannt; der Nachtrag an der Person und die Streichung sind
  die Korrektur.
- [Die Rücknahme findet das Ablösungsereignis über den Zeitpunkt statt über einen Schlüssel.] →
  Das ist eindeutig, solange je Einheit nur eine Schicht läuft (UNIQUE-Index). Ein Test
  sichert den Rückweg nach einer zweiten Ablösung derselben Einheit.

## Migration Plan

- Die Migration `0130_kraefte_zeitachse.sql` legt die Tabelle, ihre Indizes und die zwei
  Katalogspalten an. Vor dem Merge läuft `scripts/check-migrationen.sh` gegen `origin/alpha`.
  Ist `0127` belegt, wird mit `--umnummerieren` umgelegt (geschehen: `alpha` belegte 0127/0128, die Migration heißt `0130_kraefte_zeitachse.sql`).
- Es gibt keine Rückfüllung aus `disponiert_at`, `status_seit` oder ETB-Text. Das wäre ein
  erfundener Wert (dieselbe Begründung wie in `0108`).
- Eine Down-Migration gibt es im Projekt nicht. Rückbau heißt Anzeige und Aufrufer entfernen.
  Die Tabelle bleibt leer stehen.

## Open Questions

- Grenzwerte für Einsatzdauer und Ruhezeit, samt Einstufung, Hinweis und Zähler, sind ein
  Folgeticket. Die Spec schließt Einstufung heute aus, eine spätere Change fügt sie hinzu,
  ohne diese hier zu ändern.
- Ob die Fahrzeug-Startliste Marken bekommt, entscheidet der Feldbefund.
