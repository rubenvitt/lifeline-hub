# Design

## Context

| Baustein | Stand |
|---|---|
| `chat::repo::heraufstufen_zu_etb` | Ein `write_retry!`: Guard (schon heraufgestuft oder gelöscht → 409), `etb::repo::anlegen_tx` mit Text und Ereigniszeit der Nachricht als Snapshot, Rückverweis `chat_nachricht.etb_eintrag_id`. Anhänge kommen nicht vor. |
| `routes/chat.rs::heraufstufen` | `HeraufstufenBody { typ, inhalt }`, Typ-Allowlist, Fallback-Inhalt aus der Nachricht. Publiziert ETB- und Chat-Live-Ereignis. |
| `chat_nachricht_anhang` (0052) | n : m, kein Anhangslimit je Nachricht. Der Chat lädt über die generische Route `GET …/anhaenge/{aid}`. |
| `etb_eintrag_anhang` (0125) | `anhang_id UNIQUE`, Eintrag im Register `anhang::repo::MODUL_LINKER`. Ein so gebundener Anhang sperrt den generischen Download (`LinkerStand::generischer_download_gesperrt`). |
| `etb::repo::anlegen_idempotent` | Bindet Anhänge nur, wenn sie an **keinem** Linker hängen. Eine Chat-Datei ergibt dort 422 (Kreuzsperre, Spec `etb-anhaenge`, „Eine Datei hat genau einen Lebenszyklus“). |
| `HeraufstufenModal.tsx` | Handgebautes `<Modal>` + `<Form>` mit `onOk={() => form.submit()}`, Typ-`Select` und Text. Das widerspricht der Erfassungs-Norm in `frontend/AGENTS.md` (ein `Select` schluckt dort Enter). |

Motivation: siehe proposal.md.

## Goals / Non-Goals

**Goals:**
- Die Regel „eine Datei, ein Lebenszyklus“ bleibt unangetastet: keine Ausnahme im Register,
  in `LinkerStand` oder an der Kreuzsperre.
- Heraufstufen bleibt atomar. Ein Fehler in der Auswahl hinterlässt weder Eintrag noch
  verbrauchte laufende Nummer noch verwaiste Kopie.
- Die Bytes laufen nicht durch den Prozessspeicher.

**Non-Goals:**
- Kein Heraufstufen-zu-Auftrag mit Anhängen (`heraufstufen_zu_auftrag`). Der Auftrag hat
  keinen Anhang-Linker.
- Keine inhaltsadressierte Ablage (Dedup per `sha256`) und kein Referenzzähler auf `anhang`.
- Kein nachträgliches Übernehmen von Anhängen an einen schon heraufgestuften Eintrag (das ETB
  ist append-only).
- Kein Anhangslimit für den Chat selbst.

## Decisions

**D1: Kopieren, nicht mitverknüpfen.**
Je gewählter Datei entsteht in der Heraufstufen-Transaktion eine neue `anhang`-Zeile per
`INSERT INTO anhang (…) SELECT … FROM anhang WHERE id = ? AND einsatz_id = ? RETURNING id`,
danach `INSERT INTO etb_eintrag_anhang`. SQLite kopiert den BLOB intern, Rust hält ihn nie
im Speicher. Die Kopie ist ab dann ein gewöhnlicher ETB-Anhang: unveränderlich, nur über
`GET …/etb/{eintrag_id}/anhaenge/{aid}` ladbar, von der Schwärzung über die `anhang`-Regel
gelöscht. Es gibt keine neue Tabelle und keine Migration. Der Registerguard
`jeder_fremdschluessel_auf_anhang_ist_registriert` bleibt grün.

Verworfen:
- **Mitverknüpfen** (dieselbe `anhang_id` in `chat_nachricht_anhang` und `etb_eintrag_anhang`).
  Sobald die Datei am ETB hängt, ist sie modulgebunden, und `generischer_download_gesperrt()`
  sperrt den Chat-Download. Die Nachricht verlöre ihr Foto. Dazu kämen widersprüchliche
  Lebenszyklen: Der Chat löscht per CASCADE, das ETB ist append-only. Lösen ließe sich das nur
  mit Ausnahmen an `LinkerStand`, `loeschen`, `sweep_verwaiste` und beiden Bindungsprüfungen,
  also genau an den fünf Stellen, die LFH-117 (D12) vereinheitlicht hat.
- **Umhängen** (Chat-Verknüpfung löschen, ETB-Verknüpfung anlegen): Die Nachricht verlöre die
  Datei sichtbar. Das widerspricht dem Snapshot-Charakter des Heraufstufens.
- **Nicht übernehmen, nur ein Hinweis im ETB-Text** („2 Anhänge im Chat“): Der Eintrag
  dokumentiert dann nicht, was er dokumentieren soll. Wird die Nachricht gelöscht, ist die
  Datei für das Tagebuch verloren.

**D2: Explizite Auswahl `anhang_ids`, leer heißt keine.**
`HeraufstufenBody` bekommt `#[serde(default)] anhang_ids: Vec<i64>`. Ein Client ohne das Feld
verhält sich wie bisher. Ein Fehlen bedeutet bewusst **nicht** „alle“: Das ETB ist bis zur
Schwärzung unveränderlich, eine versehentlich übernommene Datei (etwa das Foto einer
verletzten Person) ließe sich nicht mehr entfernen. Deshalb entscheidet die Person im Dialog,
und der Server übernimmt nur, was genannt ist. Der Handler sortiert und dedupliziert wie
`nachricht_erfassen` und das ETB-Erfassen.

**D3: Prüfung „gehört zur Nachricht“ in der Transaktion, Statuscodes nach Konvention.**
Vor dem Anlegen des Eintrags prüft die Transaktion je ID
`EXISTS (SELECT 1 FROM chat_nachricht_anhang WHERE nachricht_id = ? AND anhang_id = ?)` samt
`anhang.einsatz_id`. Trifft das nicht zu, folgt 400 `Validation`, Wortlaut „Anhang gehört
nicht zur Nachricht“. Die ID ist dann für diese Anfrage unbekannt. Unterschieden wird nicht,
damit sich keine fremden IDs abtasten lassen. Erst prüfen, dann schreiben, wie
`pruefe_anhaenge`. Mehr als 10 IDs ergeben 400 schon im Handler, über die Konstante
`routes::etb::MAX_ANHAENGE_JE_EINTRAG`, keine zweite Zahl. Die Grenze hält zugleich die
Schreibsperre kurz (D6). Die bestehenden 409-Fälle (schon heraufgestuft, gelöscht) bleiben
zuerst, denn sie beschreiben den Lebenszyklus der Nachricht.

Eine Chat-Datei kann nie modulgebunden sein, denn das verhindert die Kreuzsperre in
`anlegen_mit_anhaengen`. Eine eigene Prüfung gegen `MODUL_LINKER` braucht es daher nicht. Die
Kopie ist neu und an nichts gebunden, also ist sie ohne `pruefe_anhaenge` bindbar.

**D4: Die Kopie trägt die Herkunft der Datei.**
`dateiname`, `mime`, `groesse`, `sha256`, `daten`, `hochgeladen_von` und `erstellt_at` werden
übernommen, nur `id` ist neu. `AnhangAnzeige` zeigt so, wer die Datei ursprünglich
aufgenommen hat. Wer heraufgestuft hat, steht schon am Eintrag (`erfasst_von`). Das alte
`erstellt_at` stört den Aufräumlauf nicht, weil die Kopie in derselben Transaktion gebunden
wird. Kein neuer Virenscan: Die Bytes sind beim Chat-Upload geprüft worden und unverändert.
Dasselbe `sha256` ergibt dasselbe ETag. Das ist richtig, denn der Inhalt ist gleich, und die
URL unterscheidet sich.

**D5: Ort des Codes.**
Der Kopier- und Bindebaustein steht in `etb::repo` als
`anhaenge_kopieren_tx(conn, einsatz_id, eintrag_id, &[anhang_id])`, neben dem einzigen anderen
Schreibpfad in `etb_eintrag_anhang`. Die Prüfung „gehört zur Nachricht“ steht in `chat::repo`,
denn sie ist Chat-Wissen. `heraufstufen_zu_etb` bekommt den Parameter `anhang_ids: &[i64]`.
Der Kommentar am Register `MODUL_LINKER` und an `anlegen_idempotent` nennt den zweiten
Schreibpfad. Wer einen Linker ergänzt, muss ihn nicht anfassen, weil er kein Linker-Wissen
braucht.

**D6: Frontend — Auswahl im Dialog, Umzug auf `ErfassungsModal`.**
`HeraufstufenModal` zieht auf `components/Erfassung.tsx` (`ErfassungsModal`) um, denn der
Dialog wird angefasst und hat einen `Select`. Die Erfassungs-Norm nennt das handgebaute
`<Modal>` + `<Form>` einen Fehler. Neues drittes Feld (Feldbudget ≤ 3): `Form.Item`
„Anhänge übernehmen“ mit `Checkbox.Group`, je Anhang Dateiname und Größe, nur wenn die
Nachricht Anhänge trägt. Vorgewählt sind die ersten 10 nach id. Eine Validierungsregel lehnt
mehr als 10 ab. Darunter steht der Hinweis „Übernommene Dateien werden ins Tagebuch kopiert
und sind dort unveränderlich.“ `onBestaetigen(typ, inhalt, anhangIds)` und
`heraufstufenZuEtb(…, anhangIds)` senden das Feld nur, wenn es nicht leer ist. Nach Erfolg
lädt die ETB-Ansicht den Eintrag samt `anhaenge` über das bestehende Live-Ereignis.

Verworfen: ein einzelner Schalter „Anhänge übernehmen“ (alle oder keiner). Er löst den Fall
„eine von drei Dateien gehört nicht ins Tagebuch“ nicht, und bei mehr als 10 Dateien bliebe
offen, welche fehlen.

## Risks / Trade-offs

- [Speicherverdopplung] Jede übernommene Datei liegt zweimal in der Datenbank. → Die Auswahl
  ist bewusst und auf 10 begrenzt. Heraufgestuft wird selten und gezielt. Dedup per `sha256`
  bleibt ein eigenes Thema, falls die Datenbankgröße auffällt.
- [Längere Schreibsperre] Bis zu 10 × 25 MiB werden unter `BEGIN IMMEDIATE` kopiert. →
  Chat-Fotos sind typisch wenige MiB groß. Die Kopie läuft vollständig in SQLite ohne Umweg
  über Rust. `write_retry!` fängt `SQLITE_BUSY` anderer Schreiber ab. Der Test misst keine Zeit,
  aber die Prüfliste nennt den Fall.
- [Rechte] Mit Lesezugriff aufs ETB und ohne Chat-Modul sieht man die übernommene Datei. → Das
  ist die Bedeutung von Heraufstufen und gilt schon heute für den Text. Die Auswahl im Dialog
  macht es sichtbar.
- [Unumkehrbarkeit] Eine falsch übernommene Datei bleibt bis zur Schwärzung am Eintrag. →
  Auswahl mit Abwahl und Hinweis im Dialog (D2/D6). Korrigieren lässt sich das über eine
  Berichtigung wie bei jedem ETB-Eintrag. Die Datei selbst bleibt.
- [Schwärzung] Die Kopie ist eine weitere `anhang`-Zeile desselben Einsatzes. Die bestehende
  Regel `anhang` (`ZeileLoeschen`) erfasst sie. → Verhaltenstest: Nach der Schwärzung ist auch
  die Kopie weg, und der Eintrag bleibt.

## Migration Plan

Keine Migration. Das neue Feld ist optional. Ein alter Client (es gibt nur das eingebettete
Frontend) sendet es nicht und bekommt das bisherige Verhalten. Rückbau: Feld ignorieren. Die
schon entstandenen Kopien sind gewöhnliche ETB-Anhänge.
