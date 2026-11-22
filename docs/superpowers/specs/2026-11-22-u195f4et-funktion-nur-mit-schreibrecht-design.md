# Führungsfunktion nur für die Führung (LLH-2064)

Zunder: https://zunder.rubeen.dev/#/aufgabe/u195f4et5a9pz4u1lm466n2l
Stand: 22.11.2026, Route `entwurf` (E1, E2, E3). Lösungsweg am 22.11.2026 mit Ruben abgestimmt.

## Absicht

Seit LLH-2008 gehen Hinweise an eine Führungsfunktion nur noch an Mitglieder mit Schreibrecht
(Einsatzleitung, Führungspersonal). Mitarbeit und Beobachter können auf einen Auftrag oder eine
Erinnerung nicht reagieren. Die Mitgliederverwaltung vergibt eine Funktion aber weiter an jede
Rolle, und die Besetzungsanzeige zählt jeden Träger mit: Trägt nur eine Mitarbeit S4, zeigt der
Auftrag „S4 — Anna“, und niemand bekommt einen Hinweis.

Ruben hat entschieden, das **an der Wurzel** zu lösen statt die Anzeige zu filtern: Mitarbeit und
Beobachter tragen keine Führungsfunktion. Damit lesen Anzeige und Hinweise wieder dieselbe
Quelle (`einsatz_mitgliedschaft.fuehrungsfunktion`), und ihr Ergebnis stimmt überein, ohne dass
an einer der beiden Stellen nach Rolle gefiltert wird.

## Ziele

- Eine Führungsfunktion (Katalogcode EL, S1–S7, Führungshilfspersonal, Fachberater) tragen nur
  Einsatzleitung und Führungspersonal (`EinsatzRolle::gehoert_zur_fuehrung`).
- Anzeige (Organigramm, Fernmeldeskizze, Kommunikationsplan, „Meine Stelle“, Kopf, Empfänger
  „S4 — Anna“) und Hinweise nennen dieselben Personen.
- Der Bestand wird bereinigt, und keine Angabe verschwindet still: Wer zur Führung gehört,
  behält seine Funktion unverändert. Bei Mitarbeit und Beobachter wird der Code zur reinen
  Bezeichnung.
- Die Datenbank garantiert die Regel, auch für Schreibwege, die später dazukommen.

## Nicht-Ziele

- Die Rollenrechte selbst ändern sich nicht: Mitarbeit erfasst, Beobachter liest.
- Die Freitext-Führungsstelle ohne Katalogcode bleibt für alle Rollen erlaubt. Sie ist nur der
  erste Vorschlag für den ETB-Rufnamen (LFH-894), keine Funktion, und weder Anzeige noch Hinweise
  lesen sie.
- Der Einsatzleiter der Führungsstelle (`einsatz_fuehrungsstelle.einsatzleiter_personal_id`) ist
  eine eigene Quelle für EL und bleibt, wie er ist; LLH-2008 regelt dort den Rückfall.
- Keine Umbenennung von Wire-Feldern, Spalten oder Routen.

## Anti-Ziele

- Die Funktion verschwindet still: ein Rollenwechsel ohne Hinweis vorher, oder eine Migration,
  die eine sichtbare Angabe ersatzlos löscht.
- Der Abgleich mit einem älteren gekoppelten Gegenüber bleibt an einer Zeile hängen, weil sie gegen
  den neuen CHECK verstößt. `uebernehme_zeilen` fängt den Datenbankfehler ab, meldet „nicht
  übernommen“ und setzt `nachholen_ab`, und die Zeile käme nie an.
- Eine zweite Filterstelle „nur Schreibrecht“ in der Anzeige, die neben der Mitgliedschaft eine
  zweite Wahrheit bildet.

## Rahmen

- `einsatz_mitgliedschaft` ist ein Blatt: Keine Tabelle verweist darauf. Ein Neubau läuft ohne
  `-- no-transaction` in der Transaktion der Migration (`migrations/AGENTS.md`, Tabellenumbau;
  Muster 0358). Dabei fallen der Index `idx_mitgliedschaft_benutzer` und die sechs
  Spiegel-Trigger mit und werden wortgleich neu angelegt.
- Geschrieben wird die Funktion an zwei Stellen: `PUT /api/einsaetze/{id}/mitglieder/{benutzer_id}`
  (`routes::einsatz::mitglied_setzen` → `einsatz::repo::setze_mitgliedschaft`) und beim Übernehmen
  aus dem Spiegel (`instanz::spiegel::uebernehmen`). Darüber läuft auch das Einspielen eines
  Archivs (`einsatz::archiv::einspielen`). Die Anlage eines Einsatzes mit Mitgliedern (LLH-1820)
  setzt keine Funktion.
- Ein Gegenüber ohne die Fähigkeit `rolle_mitarbeit` bekommt eine Mitarbeit als `beobachter`
  (`liefern::herabstufen_fuer`). Nach dieser Änderung trägt die Zeile dabei keine Funktion mehr,
  also bleibt das unkritisch. Ein **älteres** Gegenüber kennt die Regel aber nicht und kann
  weiterhin Beobachter (oder Mitarbeit) mit Funktion liefern.
- LLH-2008 (`funktion_nutzer` filtert auf Schreibrecht, Regeltexte) liegt noch nicht auf `alpha`
  und berührt dieselben Dateien (`src/AGENTS.md`, `rechte-im-einsatz.md`,
  `benachrichtigung/aufloesung.rs`). Wer zuerst merged, ist gleichgültig. Sobald LLH-2008 auf `alpha`
  liegt, wird `alpha` in diesen Branch gemergt, und die Regeltexte werden zusammengeführt.

## Ansätze

Abgestimmt wurde am Phase-1-Checkpoint, getrennt nach vier Fragen.

**Rollenwechsel auf Mitarbeit oder Beobachter bei bestehender Funktion**

- *Gewählt: Die Funktion fällt beim Wechsel mit.* Der Server nimmt den Code weg, und die
  Oberfläche warnt vorher. Ein Klick genügt, und nichts bleibt in einem verbotenen Zustand hängen.
- *Verworfen: den Wechsel mit 422 ablehnen.* Das ist strenger, kostet die Einsatzleitung aber
  zwei Schritte (erst die Stelle leeren, dann die Rolle ändern) und mitten im Einsatz eine
  Fehlermeldung.

**Freitext-Führungsstelle für diese Rollen**

- *Gewählt: Freitext bleibt.* Die Auswahl bietet für Mitarbeit und Beobachter nur Freitext an,
  keinen Katalog.
- *Verworfen: auch Freitext sperren.* Dann ginge der Rufname-Vorschlag für die Mitarbeit verloren,
  ohne dass Anzeige oder Hinweise etwas gewinnen.

**Bestand**

- *Gewählt: Code weg, Anzeige als Freitext.* Die Angabe bleibt sichtbar, ist aber keine Funktion
  mehr.
- *Verworfen: Code und Text weg.* Das ist sauberer, aber die bisherige Angabe ginge ohne Spur
  verloren.

**Absicherung**

- *Gewählt: CHECK in der Datenbank und Normalisieren beim Übernehmen.* Der Neubau bereinigt den
  Bestand im selben Schritt. Spiegel und Archiv normalisieren, bevor sie schreiben, sodass der
  CHECK einen Abgleich nie abbricht.
- *Verworfen: nur Server-Prüfung und Normalisieren, Bestand per UPDATE.* Ohne Tabellenumbau gibt
  es keine Garantie, wenn ein neuer Schreibweg dazukommt.

## Entwurf

### D1 Regel und eine Quelle für „Funktion → Bezeichnung“

Eine Führungsfunktion trägt nur, wer zur Führung gehört (`EinsatzRolle::gehoert_zur_fuehrung`:
Einsatzleitung, Führungspersonal). Muss eine Funktion weichen, weil die Rolle sie nicht trägt,
wird sie zur Bezeichnung ohne Code (**„als Freitext behalten“**):

| Code | Freitext danach |
| --- | --- |
| `el`, `s1` … `s7` | Kürzel (`EL`, `S1` … `S7`). Neben diesen Codes steht nie ein Text (`pruefe_funktion`, 0128). |
| `fuehrungshilfspersonal`, `fachberater` | `„<Standardlabel>: <Bezeichnung>“`, also „Fachberater: THW“; ohne Bezeichnung nur das Standardlabel |
| jeder Code in einem **geschwärzten** Einsatz (`einsatz.geschwaerzt_at IS NOT NULL`) | nichts: nur der Code wird `NULL`, `fuehrungsstelle` bleibt, wie die Schwärzung sie ließ (`NULL`) |

Die letzte Zeile ist eine Datenschutzregel: Die Schwärzung nullt `fuehrungsstelle`
(`schwaerzung_registry.rs`, `scrub`) und lässt den Code stehen. Eine Bereinigung schreibt nie wieder
Text in eine geschwärzte Spalte. Eine Bezeichnung fehlt bei FHP und FB nur in geschwärzten
Einsätzen; der Fall „ohne Bezeichnung“ gehört trotzdem in den Gleichheitstest.

Begründung: Das Kürzel ist das, was im Einsatz gesprochen wird. Bei FHP und FB stünde die
Bezeichnung allein („THW“) ohne Zusammenhang. Mandantenlabels (`org_fuehrungsfunktion`) werden
dabei bewusst nicht gelesen, damit Rust und SQL dasselbe Ergebnis liefern. Das Ergebnis wird auf
`fuehrung::TEXT_MAX` (200 Zeichen) gekürzt.

Eine Rust-Funktion in `src/fuehrung/` (Name nach LLH-1312, etwa
`Funktionsangabe::as_freitext`, mit `geschwaerzt: bool`) bildet das ab. Sie ist die einzige Quelle
im laufenden Code: Rollenwechsel (D2) und Spiegel (D4) rufen sie auf. Die Migration (D3) ist die
einzige SQL-Kopie und bleibt eingefroren. Ein Test spielt die Migration auf Zeilen mit jedem
Katalogcode (mit und ohne Bezeichnung, geschwärzt und nicht) und vergleicht mit der Rust-Funktion.

### D2 Mitgliederroute

`mitglied_setzen` bekommt nach dem Parsen von Rolle und Funktionsangabe zwei Regeln:

1. **Explizite Funktion für eine Rolle außerhalb der Führung → 422**
   (`AppError::UnprocessableEntity`, Text etwa „Mitarbeit und Beobachter tragen keine
   Führungsfunktion“). Das gilt, wenn der Body `fuehrungsfunktion` mit einem Code trägt und die
   neue Rolle nicht zur Führung gehört. Eine reine Freitext-Angabe ist erlaubt.
2. **Rollenwechsel ohne Angabe im Body:** Gehört die neue Rolle nicht zur Führung und trägt die
   bestehende Mitgliedschaft einen Code, wird die Angabe nach D1 zu Freitext. Dafür liest
   `setze_mitgliedschaft` Code, Text und Schwärzung **in einer Schreibtransaktion**
   (`BEGIN IMMEDIATE`) und schreibt Rolle und umgewandelte Angabe im selben UPDATE. Der Org-Guard
   bleibt im UPDATE. So gibt es kein Fenster, in dem ein paralleles Setzen der Funktion
   dazwischenkäme, und die Rust-Funktion bleibt die eine Quelle (Entscheidung des Entwurfs gegen
   ein `CASE` im UPDATE, das eine zweite SQL-Kopie wäre).

Statuscode nach `src/AGENTS.md`, Statuscode-Konvention: 422 für eine fachlich unzulässige
Kombination. Live-Verteilung (`mitglieder_geaendert`) bleibt unverändert. Die Liste aus der
Antwort zeigt den Freitext schon.

### D3 Migration: Neubau mit CHECK und Bereinigung

Neue Migration (Nummer nach `migrations/AGENTS.md`), Neubau wie 0358 mit dem zusätzlichen
Tabellen-CHECK

```sql
CHECK (fuehrungsfunktion IS NULL OR einsatz_rolle IN ('einsatzleitung', 'fuehrungspersonal'))
```

Das `INSERT … SELECT` in die neue Tabelle bereinigt dabei: Für Zeilen mit `mitarbeit` oder
`beobachter` und einem Code setzt es `fuehrungsfunktion = NULL` und `fuehrungsstelle` nach D1
(per `CASE` mit Join auf `einsatz.geschwaerzt_at`, gekürzt mit `substr(…, 1, 200)`). Alle übrigen
Zeilen werden unverändert kopiert.

Das Archiv-Einspielen bringt eine Archivdatei vorher per `db::migrate` auf den aktuellen Stand
(`einsatz::archiv::einspielen::migrieren`); diese Migration bereinigt ein altes Archiv also selbst.

Zum Spiegel: Der Neubau läuft über `INSERT` in die neue Tabelle, bevor die Trigger neu angelegt
sind. Er schreibt deshalb nichts ins Änderungslog, und ein Gegenüber erfährt von der Bereinigung
nichts. Das ist gewollt: Ein Gegenüber mit derselben Version bereinigt selbst, ein älteres
bekommt die Zeile beim nächsten echten Wechsel. Der Builder prüft am Test aus 0358, ob die Trigger
bei der Wiederanlage nichts nachholen.

Absicherung wie bei 0358: ein Test in `src/db/tests.rs`, dass Zeilen, Index, Trigger und Schema
erhalten bleiben, dass die Bereinigung D1 folgt, dass Zeilen der Führung unverändert bleiben und
dass der CHECK eine verbotene Zeile ablehnt.

### D4 Spiegel und Archiv: normalisieren beim Übernehmen

In `instanz/spiegel/uebernehmen.rs` kommt neben `keep_mitarbeit` ein Schritt für
`einsatz_mitgliedschaft`: Trägt die ankommende Zeile (nach `keep_mitarbeit`) eine Rolle außerhalb
der Führung und einen Code, wird sie vor dem `upsert` nach D1 zu Freitext. Ob der Einsatz
geschwärzt ist, liest der Schritt am lokalen Einsatz. So bleibt der Abgleich mit einem älteren
Gegenüber nie an einer Zeile hängen. Das Gegenüber behält seinen Stand, und der Spiegel weicht hier
bewusst davon ab, so wie bei `keep_mitarbeit`. Für das Archiv ist der Schritt nur eine zweite
Absicherung (D3).

Beim Liefern (`liefern.rs`) ändert sich nichts: Nach D3 verlässt keine Zeile mit verbotener
Kombination diese Instanz.

### D5 Oberfläche (Reiter „Zugriff“, `pages/MitgliederAbschnitt.tsx`)

- **Dialog „Führungsstelle für …“:** Hat das Mitglied die Rolle Mitarbeit oder Beobachter, bietet
  die Auswahl nur Freitext an. Die Katalogvorschläge aus `useFunktionsVorschlaege` fallen weg,
  Freitext-Vorschläge bleiben. Der Hilfetext sagt dann, dass die Angabe nur als Rufname-Vorschlag
  dient, weil diese Rolle keine Führungsfunktion trägt (Wortlaut: `design:ux-copy`, Ton aus
  `frontend/AGENTS.md`).
- **Rollenwechsel:** Wechselt die Einsatzleitung ein Mitglied mit Code auf Mitarbeit oder
  Beobachter, erscheint vorher eine Bestätigung im Muster der bestehenden Herabstufung
  (`herabstufung`), etwa: „Mit ‚Mitarbeit‘ endet die Führungsfunktion S4. ‚S4‘ bleibt als
  Bezeichnung stehen, Hinweise an S4 erreichen Anna nicht mehr.“ Trifft der eigene Rollenwechsel
  beide Fälle (eigene Herabstufung und Funktion), steht beides in **einer** Bestätigung.
- Die Rollenwahl bleibt für jede Rolle offen; gesperrt wird nur die Funktion.

### D6 Regeln und Doku

- `src/AGENTS.md`, „Benachrichtigungen“, Punkt „Eine Funktion löst nur über die Mitgliedschaft
  auf“: ergänzen, dass eine Funktion nur Einsatzleitung und Führungspersonal tragen (CHECK, D2,
  D4) und dass Anzeige und Hinweise deshalb ohne Rollenfilter dieselben Personen nennen. Mit dem
  Text aus LLH-2008 zusammenführen, sobald dieser auf `alpha` liegt.
- `frontend/src/fuehrung/AGENTS.md`, Absatz „Wer eine Funktion trägt, sagt allein die
  Mitgliedschaft“: die Rollenbedingung ergänzen und auf `src/AGENTS.md` verweisen (die Regel steht
  einmal).
- `docs/anwender/kapitel/rechte-im-einsatz.md`, „Führungsfunktionen der Mitglieder“ und
  Rollenbeschreibung: „Eine Funktion trägt nur die Einsatzleitung oder das Führungspersonal“; was
  beim Rollenwechsel passiert. Kapitelregeln aus `docs/anwender/AGENTS.md`, Bilder nur, wenn ein
  bestehendes Bild den Dialog zeigt.
- `scripts/adr-fuer.sh` über die berührten Dateien laufen lassen. Ob die Regel eine ADR braucht,
  entscheidet `docs/architektur/AGENTS.md` (Vermutung: nein, Bereichsregel genügt).

### D7 Tests (Leitplanken für den Plan)

- Backend, Route: 422 für Mitarbeit + Code und für Beobachter + Code; Freitext erlaubt;
  Rollenwechsel S4 → Mitarbeit ergibt `fuehrungsfunktion = NULL`, `fuehrungsstelle = 'S4'`;
  Fachberater → Beobachter ergibt „Fachberater: THW“; ein vorhandener Freitext bleibt; Führung
  unberührt.
- Backend, Auflösung: Nach dem Wechsel zeigt der Auftrag an S4 „nicht vergeben“, und kein Hinweis
  geht hinaus. Anzeige und Hinweise stimmen überein (`fuehrung::aufloesung` und
  `benachrichtigung::aufloesung` mit demselben Bestand).
- Spiegel: Eine eingehende Zeile Beobachter + `s4` wird zu Freitext und schreibt ohne Fehler; in
  einem geschwärzten Spiegel-Einsatz nur der Code weg. Keinen eigenen Archiv-Test: Nach der
  Migration lässt sich kein Archiv mit verbotener Zeile mehr bauen.
- Migration: wie D3, einschließlich des Gleichheitstests aus D1 und eines geschwärzten Einsatzes.
- Frontend (Vitest): Der Dialog bietet für Mitarbeit keinen Katalog; die Bestätigung erscheint
  nur bei Code und Zielrolle außerhalb der Führung.

## Dem Builder überlassen

- Name und Ort der D1-Funktion und die genaue SQL-Form des `CASE`.
- Wortlaut der Fehlermeldung (D2) und der UI-Texte (D5), nach `design:ux-copy`.
- Wie `setze_mitgliedschaft` die Transaktion aus D2 aufbaut (INSERT-Zweig und UPDATE-Zweig);
  Bedingung: Org-Guard unverändert im SQL, die Rückgabe „neu aufgenommen“ bleibt.
- Ob der Filter aus LLH-2008 in `funktion_nutzer` nach dem Merge bleibt (er ist dann wirkungslos,
  aber harmlos). Empfehlung: bleiben lassen und im Kommentar auf den CHECK verweisen.
