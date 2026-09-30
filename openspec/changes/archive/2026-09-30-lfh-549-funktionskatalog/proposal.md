# Proposal

## Why

Wer im Einsatz an eine Führungsfunktion schreibt, schreibt heute Freitext. Das betrifft den Empfänger
einer Erinnerung (`erinnerung.empfaenger_funktion`, „noch kein FK; Stab-Modell folgt später“), den
Funktionsempfänger eines Auftrags (`auftrag_empfaenger.funktion_text`) und die Führungsstelle eines
Mitglieds (`einsatz_mitgliedschaft.fuehrungsstelle`, LFH-461). Ein Auftrag an „S3“ weiß deshalb
nicht, wer S3 gerade ist. Ein „S 3“ oder „Einsatz“ fällt still aus jeder Zuordnung heraus.

Die Stab-Spec LFH-46 hat den Umbau als Folge-Ticket ausgelagert (Abschnitt 13 Punkt 2). Die Sperre
„erst nach dem Feldbefund“ ist seit dem 30.09.2026 aufgehoben (Nachtrag in
`docs/superpowers/specs/2026-09-13-lfh-46-pruefliste.md`).

Außerdem schließt diese Change eine Lücke aus LFH-545 (ST7). Das Ticket steht auf `done`, im Code
fehlen aber beide Teile:
- die Vorschläge aus der Besetzung in den Masken,
- die Vorrangregel der ETB-Vorbelegung (Entscheidung 13).

## What Changes

**Katalog**
- Ein **geschlossener Katalog der Führungsfunktionen** als Codeliste. Er deckt die `art`-Achse nach
  FwDV 100 Anlage 1 Nr. 1.1.4/1.1.5 ab:

  | Code | art |
  |---|---|
  | `el` | Leitung |
  | `s1`–`s6` | Sachgebiet, vom Führungsassistenten getragen |
  | `s7` | PSNV, nur per Org-Schalter |
  | `fuehrungshilfspersonal` | Führungshilfspersonal |
  | `fachberater` | Fachberater |

- Führungshilfspersonal und Fachberater werden **nicht** in eine S-Zeile gefaltet. Sie tragen eine
  Pflicht-Bezeichnung, z. B. „Lagekartenführer“ oder „THW“ (Anzeige „Fachberater: THW“).
- **Mandantenlabels:** Eine Organisation kann die Anzeigenamen der Codes überschreiben, z. B. THW
  „Versorgung (Logistik)“ oder „Öffentlichkeitsarbeit“, und S7 einschalten. Den Katalog selbst pflegt
  niemand.

**Die drei Felder**
- Erinnerung, Auftrag und Führungsstelle stellen **in einem Zug** auf den Katalog mit
  Freitext-Fallback um: je Feld ein Katalogcode neben dem bestehenden Text. Freitext bleibt
  möglich, der Katalog ist die ausdrückliche Wahl. **Kein Rückschluss per Regex** aus Freitext auf
  einen Code, auch nicht für Bestandsdaten.
- **Auflösung zur Lesezeit:**
  - Ein Auftrag oder eine Erinnerung an S1–S6 zeigt zusätzlich die aktuelle Besetzung des
    Sachgebiets.
  - Der Snapshot (`snap_anzeige`) bleibt die historische Wahrheit. Er trägt nur das Funktionslabel,
    nie einen Personennamen.
  - Nachweis per Paar-Test: Die Besetzung wechselt, der Snapshot bleibt, die Auflösung folgt.
- **Führungsstelle (LFH-461):**
  - Sie wird ein Katalogwert mit Freitext-Fallback und bleibt die ausdrückliche Wahl der
    Einsatzleitung.
  - Die Freitextspalte wird abgelöst, nicht gelöscht. Bestandswerte bleiben als Freitext stehen.

**Nachzug aus LFH-545**
- Die Masken schlagen Katalogeinträge mit der aktuellen Besetzung vor, z. B. „S2 – Lage (Müller)“.
  Im ETB treten diese Vorschläge neben die Funkrufnamen.
- Die ETB-Vorbelegung folgt der Vorrangregel: Führungsstelle → erstes eigenes Sachgebiet (über
  `personal.benutzer_id`) → nichts.

**Anzeige mit Mandantenlabel**
- Das Mandantenlabel gilt auch für die Stabseite und die abgeleitete Funktion im Kopf. Die
  System-ETB-Texte der Besetzung tragen es ab jetzt ebenfalls.

## Capabilities

### New Capabilities
- `fuehrungsfunktionen` umfasst:
  - den Katalog der Führungsfunktionen samt `art` und Mandantenlabels,
  - seine Verwendung als Empfänger von Erinnerung und Auftrag und als Führungsstelle,
  - die Auflösung zur Lesezeit auf die Besetzung,
  - die Vorschläge und die Vorrangregel der ETB-Vorbelegung.

### Modified Capabilities
- keine. Die Stab-Besetzung (LFH-46) hat noch keine Fähigkeits-Spec unter `openspec/specs/`, und
  `stab-funkplan` ändert sich nicht.

## Impact

- **Datenbank:**
  - Eine Migration (nächste freie Nummer auf `alpha`, heute 0127) fügt Codespalten an `erinnerung`,
    `auftrag_empfaenger` und `einsatz_mitgliedschaft` an. Sie legt außerdem die Tabelle der
    Mandantenlabels an.
  - Kein Tabellenumbau, keine Datenmigration der Bestandswerte.
- **Backend:**
  - neuer Katalog neben `src/stab/`
  - Validierung in `routes/erinnerung.rs`, `auftrag/eingabe.rs` und `routes/einsatz.rs`
    (Mitglied setzen)
  - Snapshot und Auflösung in `auftrag/repo.rs` und `erinnerung/repo.rs`
  - Org-Endpunkte für Katalog und Labels
  - Einträge in der Schwärzungs-Registry
  - Typ-Codegen
- **Frontend:**
  - Katalog-Hook und Optionsbau
  - `erinnerung/ErinnerungFormular.tsx`, `auftraege/AuftragFormular.tsx`,
    `pages/MitgliederAbschnitt.tsx`
  - ETB-Vorschläge (`etb/funkrufnamen.ts`) und ETB-Vorbelegung (`etb/Schnellerfassung.tsx`,
    `etb/entwuerfe/useEtbEntwuerfe.ts`)
  - Anzeige in Auftrags- und Erinnerungskarten
  - eine neue Admin-Stammdaten-Sektion „Führungsfunktionen“
  - Stabseite mit Mandantenlabel
- **Live:** Ein Besetzungswechsel invalidiert zusätzlich Aufträge und Erinnerungen.
- **Nicht betroffen:** `etb_eintrag.von`/`an` bleiben Freitext (Funkverkehr, kein Sachgebiet). Ein
  Postkorb „Aufträge an meine Funktion“ ist nicht Teil dieser Change.
