# Design

## Context

Anlass und Umfang stehen in `proposal.md`, die Anforderungen in
`specs/verbleib-betreuungsstelle/spec.md`. Den Weg bestimmt der folgende Stand, gemessen am
24.09.2026 auf `origin/alpha` (`47643f7e`):

- `person_verbleib` ist append-only. Seit `0112` ist sie ein Leaf mit `AUTOINCREMENT`, und
  keine Tabelle verweist auf sie. `verbleib_repo::erfassen` schreibt Ereignis und Cache in
  **einer** Transaktion. Der Cache sind die Spalten an `einsatz_person`:
  `aktueller_verbleib` (Kurzform), `aktuelle_verbleib_art`, `aktuelles_verbleib_ziel` und
  `aktueller_verbleib_status` (`0111`).
- Die Route `POST …/personen/{pid}/verbleib` gatet über `fordere_schreibrecht` und
  `fordere_modul_zugriff_laden(…, "personen", …)`. Kurzform und ETB-Sachverhalt entstehen aus
  `art` und `ziel` (`VerbleibArt::kurzform`, `etb_sachverhalt`). Ein Fehler landet im
  Frontend beim generischen `fehler`-Toast. Einen CAS-Dialog gibt es an dieser Stelle nicht,
  die Falle aus LFH-299/300 (zwei 409-Quellen) greift also nicht.
- `betreuungsstelle` (`0117`) ist heute ein Leaf. Stornieren ist ein Soft-Delete, hart
  gelöscht wird eine Stelle nur über die Kaskade `einsatz → betreuungsstelle`.
- Das Lesen der Betreuung ist serverseitig gesperrt (`EinsatzLesezugriff<Betreuung>`). Im
  Frontend zeigt `pages/lagekarte/betreuungEbene.ts` (`betreuungZugriffVon`), wie eine
  gesperrte Quelle ohne Abruf zur Sperrzeile wird.
- **`betreuung::repo::uebersicht` hat einen zweiten Konsumenten:**
  `lage_snapshot/repo.rs:246` legt deren `stellen`/`bezirke` in gesicherte Lagestände
  (LFH-673 D10). Alles, was in `uebersicht()` gerechnet wird, landet also auch im Dokument.
- Der Verbleib-Dialog in `pages/PersonenDetailPage.tsx` ist handgebaut
  (`<Modal onOk={() => form.submit()}>` mit `mutate`). Er zeigt heute vier Felder gleichzeitig
  (Art, Ziel, Transportmittel, Notiz) und verletzt damit die Erfassungs-Norm (H69: Enter
  sendet nicht ab).

## Goals / Non-Goals

**Goals:**
- Der Verweis ist eine **Kennung**, kein kopierter Text. Der Name der Stelle kommt nur über
  eine sichtbare, änderbare Vorbelegung in den Verbleib, die Person mit Betreuungsrecht
  setzt (Entscheidung Auftraggeber, 24.09.2026).
- Die Zahl „davon namentlich“ ist ein **Hinweis neben** der Mengenmeldung. Kein Weg führt
  sie in eine Summe.
- Keine Rebuild-Migration.

**Non-Goals:**
- **Keine Verrechnung.** Belegung, Kopfzahl `…/betreuung/belegung`, Verpflegungsvorschlag,
  Evakuiert-Kennzahl und Modulzähler bleiben unberührt (Entscheidung vom 23.09.2026).
- **Keine Liste der Namen an der Stelle.** Die Betreuung sieht eine Zahl, keine Personen.
  Eine Personenauskunft je Stelle wäre ein eigenes Ticket samt Rechtefrage.
- **Kein Verweis an anderen Verbleib-Arten.** Ein Transport geht ins Krankenhaus, nicht in
  eine Betreuungsstelle.
- **Keine Übernahme auf die Lagekarte** (kein Personen-Marker an der Stelle) und kein
  Deeplink vom Verlauf in die Betreuung. Beides wäre eine eigene Bedienentscheidung.
- **Kein Nachziehen der Bestandsdaten.** Ein alter Freitext „Turnhalle Nord“ wird nicht
  auf eine Stelle abgebildet. Ein Namensabgleich wäre geraten.

## Decisions

### D1 — Migration `0121`, zwei `ADD COLUMN`, kein Rebuild

```sql
ALTER TABLE person_verbleib ADD COLUMN betreuungsstelle_id INTEGER
    REFERENCES betreuungsstelle(id) ON DELETE SET NULL;
ALTER TABLE einsatz_person ADD COLUMN aktuelle_verbleib_betreuungsstelle_id INTEGER
    REFERENCES betreuungsstelle(id) ON DELETE SET NULL;
CREATE INDEX idx_einsatz_person_verbleib_stelle
    ON einsatz_person(aktuelle_verbleib_betreuungsstelle_id)
    WHERE aktuelle_verbleib_betreuungsstelle_id IS NOT NULL;
```

- SQLite erlaubt `ADD COLUMN … REFERENCES` nur mit dem Vorgabewert `NULL`. Genau den gibt
  es hier. `person_verbleib` bleibt Leaf, denn sie verweist, auf sie wird nicht verwiesen.
- **`betreuungsstelle` ist danach kein Leaf mehr.** Ein späterer Rebuild der Stellentabelle
  braucht den FK-Schalter (Muster `0082`). Das steht im Kopf der Migration, sonst fällt es
  erst beim nächsten CHECK-Umbau auf.
- `ON DELETE SET NULL` statt ohne Aktion. Der einzige harte Löschweg ist die
  Einsatz-Kaskade, und die löscht beide Seiten ohnehin. `SET NULL` hält die Tür offen, falls
  die Stelle je einen eigenen Löschweg bekommt. Ein blockierender FK verhielte sich dort
  wie der Fehler aus LFH-237.
- Die Nummer liegt über `0120` (höchste auf `origin/alpha`). Vor dem PR laufen `git fetch`
  und `scripts/check-migrationen.sh`.
- Kein Backfill. Bestehende Ereignisse haben keinen Verweis (Non-Goal).

### D2 — Schreibweg: Reihenfolge der Prüfungen und Statuscodes

`VerbleibBody` bekommt `betreuungsstelle_id: Option<i64>`. Die Route prüft **in dieser
Reihenfolge**, bevor sie schreibt:

| # | Fall | Code | Begründung |
|---|---|---|---|
| 1 | unbekannte `art` / `status` | 400 | Bestand |
| 2 | Verweis bei `art ≠ notunterkunft` | 422 | Zusammenhang zweier Felder |
| 3 | Verweis ohne Lesezugriff auf Betreuung | 403 | `fordere_modul_zugriff_laden(…, "betreuung", …)`, vor jedem Lesen der Stelle |
| 4 | Stelle unbekannt oder aus anderem Einsatz | 404 | `betreuung::repo::stelle_laden` (Einsatz-gescoped) |
| 5 | Stelle storniert | 409 | Lebenszyklus, wie im Modul Betreuung |
| — | Stelle geschlossen | erlaubt | Entscheidung vom 24.09.2026 |

- Punkt 2 steht vor Punkt 3. Ein Verweis bei der falschen Art ist schon ohne Blick auf die
  Rechte unbrauchbar, und die Antwort verrät nichts über eine Stelle.
- Punkt 3 steht vor Punkt 4 (Spec: 403 statt 404 für eine unbekannte Stelle). Sonst ließe
  sich über 404 und 409 die Existenz von Stellen abfragen, ohne das Modul lesen zu dürfen.
- Die Prüfung läuft im Handler gegen einen vorher gelesenen Stand, nicht in der
  Schreibtransaktion. Ein Rennen „Stelle wird zwischen Prüfung und INSERT storniert“ ist
  zulässig: Der Verweis zeigt dann auf eine stornierte Stelle, und die Zählung (D4) blendet
  sie aus. Das ist derselbe Zustand wie „Stelle nach dem Verbleib storniert“, den es
  ohnehin gibt.
- **Der Server rührt `ziel` nicht an** (Entscheidung „Vorbelegen im Client“). Kurzform und
  ETB-Text entstehen wie bisher aus dem, was im Ziel steht. Verworfen wurde die
  serverseitige Kopie: Die Person sähe vor dem Speichern nicht, welcher Text ins ETB
  wandert. Verworfen wurde auch „nur die Kennung“: Ohne Betreuungsrecht zeigten Liste und
  ETB dann nur „Notunterkunft“.

### D3 — Cache an der Person

`verbleib_repo::erfassen` schreibt `betreuungsstelle_id` ins Ereignis und in derselben
UPDATE-Anweisung `aktuelle_verbleib_betreuungsstelle_id` an die Person. Ein Ereignis ohne
Verweis schreibt `NULL`, genau wie Ziel und Status heute (Test
`erfassen_pflegt_art_ziel_und_status_im_cache` wird um den Verweis erweitert).
`VerbleibAnzeige.betreuungsstelle_id` und `PersonAnzeige.aktuelle_verbleib_betreuungsstelle_id`
tragen `skip_serializing_if = "Option::is_none"` (Norm LFH-265). Der Presence-Test läuft
über `contains_key`.

Der Cache ist der Grund, warum die Zählung (D4) ohne Fensterfunktion über `person_verbleib`
auskommt. „Jüngster Verbleib“ ist dort schon aufgelöst, mit derselben Ordnung
(`zeitpunkt_at DESC, id DESC`).

### D4 — „davon namentlich“: in der Route gerechnet, nicht im Repo der Übersicht

```sql
SELECT aktuelle_verbleib_betreuungsstelle_id AS stelle_id, COUNT(*) AS anzahl
FROM einsatz_person
WHERE einsatz_id = ? AND storniert_at IS NULL
  AND aktuelle_verbleib_art = 'notunterkunft'
  AND aktuelle_verbleib_betreuungsstelle_id IS NOT NULL
GROUP BY 1
```

- Die Abfrage steht als eigene Funktion `person::repo::namentlich_je_stelle`, nicht in
  `betreuung::repo::uebersicht`. Deren zweiter Konsument ist der Lagestand (Context).
  Eine Zahl dort landete still im gesicherten Dokument, und zwar ohne Prüfung des
  Personenrechts des späteren Lesers.
- `BetreuungUebersicht` bekommt `namentlich: Option<Vec<StelleNamentlich { stelle_id, anzahl }>>`
  mit `skip_serializing_if`. `repo::uebersicht` setzt `None`. Die Route
  `routes::betreuung::uebersicht` füllt das Feld, wenn `fordere_modul_zugriff_laden(…, "personen", …)`
  für den Lesenden gelingt. Das ist dieselbe Rangfolge-Auswertung wie in `erlaubte_module`,
  nur für einen Key. Gelingt sie nicht, bleibt das Feld weg und steht nicht auf 0.
- Die Liste führt nur Stellen mit `anzahl ≥ 1`. Fehlt eine Stelle in einer vorhandenen
  Liste, heißt das 0. Fehlt die Liste, heißt das „nicht auskunftsfähig“.
- Ein `Vec` statt einer Map, weil die zwei `Record<>`-Maps des Codegens handgepflegt sind
  (CLAUDE.md, Typ-Codegen).
- **Gegenprobe „nie summieren“:** `kopfzahl`, `StelleMeldungAnzeige` und der Lagestand
  bleiben Byte für Byte unverändert. Tests pinnen das mit namentlich zugeordneten Personen
  im Bestand: Die Kopfzahl-Summe ändert sich nicht, und das Lagestand-Dokument enthält kein
  `namentlich`. Im Frontend pinnt ein Test, dass die Summenzeile des `StellenBlock` nur
  `belegung.belegt` addiert.
- **Was der Lagestand-Test NICHT belegt** (Review): `lage_snapshot` übernimmt aus der
  Übersicht nur `stellen` und `bezirke`. Wanderte die Zählung als eigenes Feld in
  `repo::uebersicht`, bliebe der Test grün. Er fängt nur eine Zahl, die jemand an
  `BetreuungsstelleAnzeige` hängt. Die Trennung „Route, nicht Repo“ hält deshalb dieser
  Absatz und der Kommentar am Repo, nicht der Test.
- Stornierte Stellen fallen **serverseitig** heraus (Join auf `storniert_at IS NULL`), nicht
  erst dadurch, dass die Oberfläche keine Zeile für sie hat.

### D5 — Live über den Client-Fan-out, nicht über ein zweites Server-Ereignis

In `EINSATZ_STREAM_EVENTS` bekommt `person` zusätzlich `EINSATZ_KEYS.betreuung`.

- Der Server schickt nach einem Verbleib `person`. Ein zusätzliches `betreuung`-Ereignis
  bräuchte die alte **und** die neue Stelle, und ebenso für Storno und Wiederherstellung.
  Das wären drei Routen mit eigener Buchführung.
- Das Personen-Ereignis erreicht nur Lesende mit Personenrecht (Post-Filter, LFH-227). Das
  sind genau die, die die Zahl sehen. Wer nur Betreuung lesen darf, bekommt weder Ereignis
  noch Zahl.
- **Kosten, im Review korrigiert:** Die Übersicht hat auf JEDER Einsatzseite einen aktiven
  Observer, denn `einsatz/useModulZaehler.ts` hält `einsatzKeys.betreuung` für den
  Evakuierungs-Zähler im Rahmen. Jedes Personen-Ereignis (Anlegen, Sichtung, Verbleib, Notiz,
  Storno) löst deshalb bei jedem Client mit Personen- UND Betreuungsrecht ein
  `GET …/betreuung` aus, ohne Entprellung. Das ist dieselbe Größenordnung wie der schon
  bestehende Fan-out `person → modulZaehler` (auch ein GET je Ereignis und Client), also etwa
  eine Anfrage mehr je Ereignis auf eine kleine, indizierte Einsatzmenge. Das wird bewusst in
  Kauf genommen.
- **Verworfen: ein eigenes `betreuung`-Ereignis nur bei Verbleib und Storno.** Es wäre
  schmaler, erreichte aber auch Lesende, die nur Betreuung sehen dürfen. Die sähen dann ein
  Ereignis ohne sichtbare Änderung und könnten aus dessen Takt ablesen, wann jemand namentlich
  einer Stelle zugeordnet wurde. Wird die Last messbar, ist das die nächste Stufe, dann mit
  einem Ereignis, das nur Personenleser bekommen.

### D6 — Verbleib-Dialog auf `ErfassungsModal`, Felder je Art

Der Dialog zieht auf `components/Erfassung.tsx` (`ErfassungsModal`, `onErfassen` über
`mutateAsync`). Welche Felder sichtbar sind, hängt an `Form.useWatch('art')`:

| Art | Felder (neben Art und eingeklappter Notiz) |
|---|---|
| `transport` | Ziel, Transportmittel |
| `notunterkunft` | Betreuungsstelle (nur mit Zugriff), Ziel |
| `entlassung`, `vor_ort`, `verstorben` | Ziel |

- Die Notiz rückt in „Weitere Angaben“ (Collapse **ohne** `forceRender`: sie hat keine
  Vorbelegung, zugeklappt geht also nichts verloren, und ein einmal aufgeklapptes Panel bleibt
  eingehängt). Damit sind höchstens drei Felder sichtbar (Feldbudget Modal ≤ ~3), vorher waren
  es vier. Der Test prüft „3 sichtbar“ und die zweite Hälfte „Aufklappen → Zahl steigt“. Mit
  `forceRender` stünde die Notiz immer im DOM, und die Zählung wäre nicht widerlegbar.
- Der Dialog ist eine eigene Komponente `personen/VerbleibErfassung.tsx`, der reine Kern liegt in
  `personen/verbleibErfassungKern.ts`. **Das Suffix ist Pflicht**, gemessen beim Umsetzen: Unter
  dem Namen `verbleibErfassung.ts` traf der Import `./VerbleibErfassung` auf macOS still die
  Kerndatei („Element type is invalid“). Das ist dieselbe Falle wie bei LFH-347.
- **Die Stellen-Auswahl** ist ein `Select` über die nicht stornierten Stellen der
  Betreuungsübersicht. Ist sie geschlossen, steht „· geschlossen“ im Label, und sie ist
  wählbar. Die Wahl belegt `ziel` mit der Bezeichnung vor (`setFieldValue`), **aber nur,
  wenn das Ziel leer ist oder noch die Bezeichnung der zuvor gewählten Stelle trägt**.
  Einen eigenen Text der Person überschreibt ein Stellenwechsel nicht. Leeren der Auswahl
  leert auch eine unveränderte Vorbelegung.
- **Zugriff:** Die Auswahl erscheint nur, wenn `betreuungZugriffVon(…)` `'frei'` liefert.
  Die Query `einsatzKeys.betreuung` läuft nur dann (`enabled`). Ein 403 ist „gesperrt“, kein
  Fehler. Ohne Zugriff bleibt der Dialog, wie er ist, mit Freitext-Ziel.
- Wechselt die Art weg von `notunterkunft`, wird `betreuungsstelle_id` beim Absenden nicht
  mitgeschickt. Der Server lehnte es sonst mit 422 ab (D2, #2).
- Weil `art` ein `Select` ist, lässt sich „Enter sendet ab“ nicht als Tastenweg belegen.
  Der Test prüft die Struktur (kein `.ant-modal-footer`, Knopf `closest('form')`) nach dem
  Muster `pages/uhs/MaterialTab.test.tsx`.

### D7 — Anzeige an der Stelle

In `betreuung/StellenBlock.tsx` steht die Zahl in der Zelle „belegt“ hinter der Belegung:
„40 belegt · davon namentlich 2“. Ohne Belegungsmeldung steht „keine Meldung ·
namentlich 2“. „davon“ entfällt dort, weil es keine Menge gibt, von der die Zahl ein Teil
wäre. Bei 0 oder fehlender Liste steht nichts. Die Zahl ist Mono mit `tabular-nums` (Regel
„Zahlen laufen immer Mono“), das Wort nicht. Deshalb liefert `namentlichTeile` Wort und Zahl
getrennt. Sie ist Text und kein Bedienziel. Die Summenzeile unter der
Tabelle bleibt unverändert.

### D8 — Schwärzung

In `schwaerzung_registry.rs` kommen `retain("betreuungsstelle_id", G_FK)` an
`person_verbleib` und `retain("aktuelle_verbleib_betreuungsstelle_id", G_FK)` an
`einsatz_person` dazu. Beides sind Kennungen ohne Personenbezug. Der Name der Stelle hängt
an der Stelle, und das Ziel wird weiter gescrubbt. Der Vollständigkeitstest der Registry
erzwingt die Einträge. Der Test
`schwaerzung_nullt_lagedaten_der_person_und_behaelt_die_kategorien` wird um den Verweis
erweitert.

## Risks / Trade-offs

- **Der Stellenname kann in Ziel und ETB für Lesende ohne Betreuungsrecht sichtbar
  werden.** → Das ist bewusst entschieden. Geschrieben wird er von einer Person, die das
  Recht hat, und er ist sichtbar änderbar. Dieselbe Lage gibt es beim Tippen des Namens,
  und das Modul Betreuung schreibt die Bezeichnung selbst ins ETB.
- **Die Vorbelegung veraltet, wenn die Stelle umbenannt wird.** → Das Ziel ist der Text zum
  Zeitpunkt der Erfassung, so wie ein ETB-Eintrag. Der Verweis bleibt richtig.
- **Personen-Ereignisse laden die Betreuungsübersicht öfter**, und zwar auf jeder
  Einsatzseite (D5). → Bewusst angenommen, gleiche Größenordnung wie `person → modulZaehler`.
  Wird es messbar teuer, kommt ein Ereignis nur für Personenleser in einem eigenen Ticket.
- **Das Rennen zwischen Prüfung und Storno der Stelle** (D2). → Es ist harmlos, weil die
  Zählung stornierte Stellen nicht zeigt.

## Migration Plan

`0121` ist additiv. Ein Rückbau ist nicht vorgesehen, und `sqlx` hat ohnehin keinen
Down-Pfad. Bestandsereignisse bleiben ohne Verweis. Reihenfolge der Auslieferung:
Backend und Frontend in einem PR, weil das Frontend das neue Feld erst sendet, wenn der
Server es kennt.

## Open Questions

Keine. Die beiden offenen Punkte, der Weg des Stellennamens und geschlossene Stellen, hat
der Auftraggeber am 24.09.2026 entschieden.
