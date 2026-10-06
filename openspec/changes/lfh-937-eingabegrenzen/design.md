# Design

## Context

Motivation: `proposal.md`, „Why“. Anforderungen: `specs/eingabegrenzen/spec.md`.
Stand `alpha` 4c205ad (nach den SQL-Listenabfragen in `src/auftrag/`); die Zeilennummern des
Tickets (Audit-Stand 0e8db77) sind veraltet.

- **Helfer** (`src/routes/support.rs`): `trimme` (leer → `None`), `pflicht` (trimmen, leer →
  400), `pflicht_tri` (PATCH). Grenzen prüft heute jedes Modul selbst, gut ein Dutzend Mal
  (`fuehrung::TEXT_MAX`, `stab`, `pegel`, `geraet`, `einsatzabschnitt::KURZBEZEICHNUNG_MAX` …),
  alle mit `chars().count()` und 400. Präzedenz für Listen: `routes/etb.rs` sortiert und
  entdoppelt `anhang_ids` und lehnt mehr als 10 mit 400 ab.
- **ETB** (`routes/etb.rs::erfassen`): `client_id`-Replay vor jeder Feldprüfung, dann `pflicht`
  für `inhalt`, `von`, `an`, `veranlassung` nur getrimmt. Eine Schnellerfassungs-Route gibt es
  nicht, alles läuft durch `erfassen`. Text von außen landet außerdem 1:1 im ETB über
  Chat → ETB (`routes/chat.rs::heraufstufen`, fällt auf den gespeicherten Chat-Text zurück),
  Meldung (`inhalt`, `absender` → `von`, `empfaenger` → `an`), Nachforderung
  (`adressat_bezeichnung` → `an`, `begruendung` → `veranlassung`, `bezeichnung` im `inhalt`),
  Vollzugsmeldung (`inhalt`) und Auftrag (`auftrag_text` → `inhalt`, Empfänger → `an`).
- **Auftrag** (`auftrag/eingabe.rs::validiere_neuen_auftrag`): prüft nur „mindestens ein
  Empfänger“; jeder Empfänger wird einzeln validiert (bis zu zwei SELECTs, beim Typ `funktion`
  ein eigener Labelkarten-Load). `repo::anlegen_tx` lädt die Labelkarte einmal, ruft je Empfänger
  `snap_anzeige_fuer` (ein SELECT) und INSERT, danach `empfaenger_klartext` mit denselben SELECTs
  noch einmal für das ETB-`an`. Vier Aufrufer: POST `/auftraege`, ETB, Meldung, Chat. Kein
  PATCH auf Text oder Empfänger.
- **Sprechgruppen** (`sprechgruppe/repo.rs`): `pruefe_zuordenbar` ein SELECT je ID vor der
  Transaktion, 422 mit der ID im Text (legitimes 422, `src/AGENTS.md`). `ersetzen_tx` löst und
  ordnet je ID einzeln, bereits in `write_retry!`. Aufrufer: Abschnitt (POST, PATCH), Einheit
  (POST, PATCH), Führungsstelle (PATCH, `Option<Option<Vec>>`).
- **Qualifikationen** (`personal/repo.rs::setze_qualifikationen`): DELETE, dann ein INSERT je
  ID; fremde IDs still ignoriert. `anlegen` läuft in `write_retry!`, `patche` mit
  `pool.begin()` (deferred).
- **GeoJSON** (`lage_zone::validiere_neu`): unbekannter Typ 400; Typ/Geometrie-Paar, kaputtes
  JSON und `type`-Abweichung 422. Zonen kennen nur Polygon und LineString; Geometrie ist per
  PATCH nicht änderbar. Abschnittsfläche (`PATCH …/abschnitte/{aid}/flaeche`): kaputtes JSON
  und Nicht-Polygon 422; kein Integrationstest.
- **Frontend**: antd 6. Keine Zählanzeige im Projekt; `maxLength` nur an zwei Stellen.
  `MarkdownEditor` ist ein `Input.TextArea`. Die Schnellerfassung setzt `inhalt` auch per Code
  (Baustein, Slash-Befehle), dort greift ein natives `maxlength` nicht. Die Offline-Queue
  verschiebt eine 400 sichtbar nach „abgelehnt“ (Alert, Zeitachse, Wiederherstellungs-Schublade);
  „Erneut senden“ schickt denselben Text, ein zu langer Eintrag scheitert also wieder.

## Goals / Non-Goals

**Goals:**
- Jedes genannte Freitextfeld lehnt `max+1` Zeichen mit 400 und Feldnamen ab; `max` geht durch.
- Listen von außen sind entdoppelt und begrenzt, bevor eine Abfrage läuft; Prüfen und
  Schreiben brauchen eine von N unabhängige Zahl von Anweisungen.
- Das ETB-`an` eines Auftrags hat eine feste Höchstlänge.
- Zonen und Abschnittsflächen sind strukturell gültig und begrenzt.
- Die Masken lassen nicht mehr zu, als der Server annimmt; die ETB-Erfassung reiht keinen zu
  langen Eintrag in die Offline-Queue ein.
- Ein neues Feld findet das Muster in einer Regel und einem Helfer.

**Non-Goals:**
- Ein engerer globaler `DefaultBodyLimit` für JSON-Routen. Er braucht einen Sweep über alle
  großen Routen und wird erst danach scharf geschaltet (`AGENTS.md`, rot geborenes Gate);
  eigener Folge-Task im Board.
- CHECK-Constraints in einer Migration. Die Routen sind der einzige Schreibweg; eine Migration
  hätte einen Tabellenumbau zur Folge und bringt hier keinen zusätzlichen Schutz.
- Bestehende Einzelprüfungen auf den neuen Helfer umstellen (kein Sweep; angefasste Stellen
  dürfen ihn nutzen).
- Freitexte der Zonen (`label`, `notiz`), der Pressemitteilungen und die übrigen Freitexte von
  Schaden (`uebergeben_an`, Abschlussgrund) und Meldung (`lagerelevant`). Sie sind nicht Teil
  der Befunde; das Muster nimmt sie später ohne neue Entscheidung mit.
- Vereinfachen zu großer Zonen im Frontend.
- Systemtexte im ETB (Lagebesprechung, Vorlagendokument, Betreuung …) begrenzen. Sie entstehen
  aus schon begrenzten Eingaben und dürfen nicht an einer ETB-Grenze scheitern.

## Decisions

### D1 — Helfer `pflicht_max` und `optional_max`, Grenzen im Modul

`support::pflicht_max(wert: &str, feld: &str, max: usize) -> Result<String>` trimmt, lehnt leer
mit der Meldung von `pflicht` ab und über `max` Zeichen mit
`"{feld} darf höchstens {max} Zeichen lang sein"`. `optional_max(wert: Option<String>, feld,
max) -> Result<Option<String>>` macht dasselbe auf `trimme`. Für PATCH-Tri-States
`pflicht_max_tri`. Gezählt wird nach dem Trimmen mit `chars().count()`, wie bei allen
bestehenden Grenzen. Die Konstante heißt `<FELD>_MAX` und steht im Modul, das das Feld besitzt
(`etb::INHALT_MAX`, `auftrag::EMPFAENGER_MAX` …), nicht zentral: wer das Feld ändert, sieht die
Grenze.

**Alternative:** ein Derive-Attribut auf den Request-DTOs (`validator`-Crate). Verworfen: neue
Abhängigkeit, und die Prüfreihenfolge (ETB-Replay vor der Feldprüfung, Handler-Prechecks vor
der DB) lebt im Handler.

### D2 — ETB-Grenzen an jedem Eingang, nicht im Repo

`etb::INHALT_MAX = 20_000`, `etb::PARTEI_MAX = 500` (für `von`, `an`, `veranlassung`). Geprüft
wird in jeder Route, deren Text von außen 1:1 im ETB landet: ETB-Erfassung (nach dem Replay-
Check, wie `pflicht`), Chat-Heraufstufen (auch der Rückfall auf den gespeicherten Text),
Chat-Nachricht anlegen und bearbeiten (`INHALT_MAX`, Quelle des Rückfalls), Meldung
(`inhalt`, `absender`, `empfaenger`), Nachforderung (`bezeichnung` 200, `adressat_bezeichnung`
und `begruendung` `PARTEI_MAX`), Vollzugsmeldung (`INHALT_MAX`).

**Alternative:** eine Prüfung in `etb::repo::einfuegen`, die alle Wege fängt. Verworfen: dort
liefen auch Systemtexte durch (Lagebesprechung, Vorlagendokumente), die nie an einer
Benutzergrenze scheitern dürfen, und die Fehlermeldung kennte das Feld der Ursprungsmaske
nicht.

### D3 — Auftrag: erst zählen und entdoppeln, dann validieren

In `validiere_neuen_auftrag`, vor jeder Abfrage:
1. `auftrag_text` über `pflicht_max` (`AUFTRAG_TEXT_MAX = 10_000`); die sieben Felder des
   Befehlsschemas über `optional_max` (`BEFEHLSFELD_MAX = 2_000`).
2. Mehr als `EMPFAENGER_MAX = 50` Empfänger im Request → 400. Gezählt wird vor dem Entdoppeln:
   so ist die Arbeit des Requests begrenzt, bevor eine Abfrage läuft, und 50 verschiedene
   Empfänger reichen für jeden Einsatz.
3. Entdoppeln nach dem Schlüssel (Typ, Abschnitt-, Einheit-, Person-, Fahrzeug-ID,
   Funktionscode, getrimmter Funktionstext, Extern-Kategorie, getrimmte Extern-Bezeichnung);
   die erste Nennung bleibt, die Reihenfolge auch.
4. `extern_bezeichnung` über `pflicht_max` mit `EXTERN_BEZEICHNUNG_MAX = 200`
   (wie `fuehrung::TEXT_MAX`). `extern_kategorie` ist ein Enum und schon geprüft.
5. Die Labelkarte lädt `validiere_neuen_auftrag` einmal und reicht sie an
   `validiere_empfaenger` weiter.

In `repo::anlegen_tx` entsteht der Anzeigename je Empfänger einmal (Schleife mit INSERT); das
ETB-`an` setzt sich aus denselben Namen zusammen, `empfaenger_klartext` entfällt.

### D4 — Das ETB-`an` eines Auftrags wird gekappt

`auftrag::kappe_an(namen: &[String]) -> String` fügt Namen mit `", "` an, solange das Ergebnis
samt Rest-Hinweis höchstens `etb::PARTEI_MAX` Zeichen lang ist; die übrigen fasst
`" … und N weitere"` zusammen. Ein einzelner Name, der allein zu lang ist, wird auf die Grenze
gekürzt und mit `…` beendet. Die vollständige Liste bleibt in `auftrag_empfaenger`; das ETB
nennt ohnehin nur die Adressaten im Überblick.

### D5 — Listen-IDs: entdoppeln, begrenzen, `json_each`

- `sprechgruppe::normalisiere_ids(Vec<i64>) -> Result<Vec<i64>>`: `sort_unstable`, `dedup`,
  mehr als `SPRECHGRUPPEN_JE_ZIEL_MAX = 32` → 400. Jede Route ruft es als ersten Schritt, vor
  jedem Schreiben (wichtig für die Abschnitts-PATCH, die den Lagewechsel vor der Zuordnung
  speichert). Die Führungsstelle übernimmt es ebenfalls.
- `pruefe_zuordenbar`: eine Abfrage `SELECT id … WHERE id IN (SELECT value FROM json_each(?))
  AND org_id = ? AND (einsatz_id IS NULL OR einsatz_id = ?)`; die erste ID der Eingabe, die
  fehlt, steht wie bisher im 422-Text.
- `ersetzen_tx`: zwei Anweisungen — `DELETE … WHERE {spalte} = ? AND sprechgruppe_id NOT IN
  (SELECT value FROM json_each(?))` und `INSERT OR IGNORE … SELECT ?, value FROM json_each(?)`.
  `zuordnen_tx`/`loesen_tx` bleiben für die Einzel-Endpunkte.
- Qualifikationen: `QUALIFIKATIONEN_MAX = 64` in `personal`, Entdoppeln im Handler
  (`normalisiere`, `normalisiere_patch`), `setze_qualifikationen` als DELETE plus ein
  `INSERT OR IGNORE … SELECT ?, id FROM qualifikation WHERE org_id = ? AND id IN (SELECT value
  FROM json_each(?))`. Fremde IDs bleiben still ignoriert (bestehendes Verhalten). `patche`
  läuft künftig in `write_retry!` (`BEGIN IMMEDIATE`, LFH-240); `laden` bleibt davor und
  danach.

### D6 — Grenzen für Infotelefon, Presse, Schaden

| Feld | Grenze |
| --- | --- |
| Infotelefon `notiz` | 2 000 |
| Infotelefon `anrufer_name`, `rueckruf` | 200 |
| Presse `medium`, `kontakt_name`, `freigabe_durch` | 200 |
| Presse `thema`, `kontakt_erreichbarkeit` | 500 |
| Presse `antwort` | 8 000 |
| Schaden `ort`, `geschaedigt_kontakt` | 500 |
| Schaden `beschreibung` | 8 000 |

Kurze Namen und Rufnummern 200, Orts- und Kontaktangaben (Adresse, mehrere Wege) 500, lange
Texte 2 000 bzw. 8 000 wie im Ticket vorgeschlagen. Beim Schaden gilt das in `anlegen` und
`aktualisieren`, bei der Presse in Anlegen, Ändern und Status. Die bestehenden 422 (Rückruf
nötig ohne Nummer, beantwortet ohne Antwort) bleiben; eine Grenzverletzung ist 400 und wird
vorher geprüft.

### D7 — GeoJSON: eine Prüfung, 400 nur für Neues

Zwei Funktionen in `lage_zone`: `pruefe_geometrie_groesse(geometrie, feld)` läuft als erste
Prüfung (in `validiere_neu` vor Typ und Klasse, in der Flächen-Route vor dem Parsen),
`pruefe_geometrie_struktur(&Value, feld)` nach den bestehenden 422-Zweigen:
1. `geometrie.len() > GEOMETRIE_BYTES_MAX` (256 KiB) → 400, vor dem Parsen und vor jedem 422.
2. Kaputtes JSON und `type`-Abweichung bleiben 422 (bestehende Zweige, unverändert).
3. `coordinates` fehlt oder hat die falsche Verschachtelung, eine Position ist kein Array aus
   2 oder 3 endlichen Zahlen, `lon` außerhalb [-180, 180] oder `lat` außerhalb [-90, 90] → 400.
4. Polygon: 1 bis `RINGE_MAX = 10` Ringe; zusammen mit LineString höchstens
   `STUETZPUNKTE_MAX = 5_000` Positionen → 400.

Eine dritte Koordinate (Höhe) wird geduldet, weil GeoJSON sie erlaubt. Ringschluss und
Mindestpunktzahl prüft der Server nicht; das tut terra-draw, und Altbestände sollen weiter
lesbar bleiben (es wird nur beim Schreiben geprüft).

### D8 — Frontend: ein Spiegel, ein Helfer, Zähler ab 80 %

- `frontend/src/api/eingabegrenzen.ts` hält alle Werte als benannte Konstanten. Ein
  Rust-Test (`tests/eingabegrenzen_spiegel.rs`) liest die Datei und vergleicht jede Konstante
  mit dem Backend; so driftet keine Seite still.
- `components/zeichenGrenze.tsx`: `zeichenGrenze(max)` liefert antd-`count`-Props
  (`max`, `strategy: s => [...s].length` wie der Server, `show` ab 80 % der Grenze als
  `n / max` in Mono mit `tabular-nums`, darüber „· zu lang“ in `alarmText`). **Es kürzt nie**:
  antds `exceedFormatter` liefe bei jeder Änderung eines Werts über der Grenze und schnitte
  einen vorbelegten Text beim ersten Löschen still ab (Befund im Review). Gesperrt wird über
  `zeichenRegel(max, feld)` am Formularfeld bzw. die Längenprüfung der Schnellerfassung. Unter 80 % bleibt die
  Maske unverändert; die Erfassungsleiste des ETB hat ein Höhenbudget.
- Felder ohne antd-Zähler (`AutoComplete` für Von/An, Tags der Empfänger) bekommen natives
  `maxLength` bzw. eine Regel; natives `maxLength` zählt UTF-16-Einheiten und ist damit nie
  großzügiger als der Server.
- `MarkdownEditor` bekommt `maxLength` und reicht es an das eine Textfeld.
- **Vor dem Senden:** `Schnellerfassung.absenden` prüft die Längen wie `fehlendeSeite`, bevor
  hochgeladen oder eingereiht wird (Text aus Baustein oder Slash-Befehl kann länger sein). Die
  Meldung steht in der Hinweiszeile, der Text bleibt im Feld. Damit landet kein zu langer
  Eintrag in der Offline-Queue; die bestehende Anzeige abgelehnter Einträge bleibt für alles
  andere.
- Auftragsmaske: `maxCount={50}` am Empfänger-Select, `initialText` aus Meldung, Chat oder ETB
  über der Grenze wird nicht still gekürzt: der Zähler zeigt die Überlänge, Senden ist
  gesperrt, bis gekürzt ist.
- Lagekarte: `ZeichnenSteuerung` zeigt ab mehr als `STUETZPUNKTE_MAX` Punkten neben dem
  Punktzähler „zu viele Punkte (höchstens 5 000)“ und sperrt Abschließen und Speichern; der
  Zählerstand kommt wie bisher aus terra-draw `history`. Die Abschnittsfläche speichert direkt
  nach dem Zeichnen; dort warnt `onFlaecheGezeichnet` und speichert nicht.

## Risks / Trade-offs

- **[Bestehende Daten über der Grenze]** → Es wird nur beim Schreiben geprüft. Ein PATCH auf
  einen Schaden mit einer älteren, längeren Beschreibung scheitert erst, wenn die Beschreibung
  mitgeschickt wird; die Maske zeigt dann die Überlänge.
- **[Offline-Clients mit alter Version]** → Ein älterer Client kann einen zu langen ETB-Eintrag
  eingereiht haben; er landet beim Abgleich sichtbar unter „abgelehnt“, mit Text zum Kopieren.
- **[Grenzwerte zu knapp]** → Die Werte liegen eine Größenordnung über realistischen Eingaben
  (ein Lagebericht als ETB-Eintrag hat wenige tausend Zeichen). Eine Anpassung ist eine Zeile je
  Seite, der Spiegeltest hält beide gleich.
- **[`EMPFAENGER_MAX` vor dem Entdoppeln]** → 51 identische Empfänger geben 400 statt eines
  Auftrags mit einem Empfänger. Bewusst: die Arbeit bleibt vor der ersten Abfrage begrenzt.
