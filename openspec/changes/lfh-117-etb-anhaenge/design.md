# Design

## Context

Ist-Stand, gemessen am 24.09.2026 auf `origin/alpha` (b8088ba3):

| Baustein | Stand |
|---|---|
| `anhang` (0052) | BLOB-Tabelle je Einsatz, `einsatz_id … ON DELETE CASCADE`. Linker 1 ist `chat_nachricht_anhang` (n:m), Linker 2 ist `einsatz_dokument` (0116, `anhang_id UNIQUE`). |
| `anhang::repo::LinkerStand` | kennt `chat_gesamt`, `chat_lebend`, `dokument_gesamt`. `generischer_download_gesperrt()` sperrt Dokument-Anhänge und Chat-Tombstones. `sweep_verwaiste` und `loeschen` haben je einen `NOT EXISTS`-Riegel für `einsatz_dokument`. |
| Generische Routen | `POST/GET/DELETE /api/einsaetze/{id}/anhaenge[/{aid}]`, modul-los (`PFAD_KEY … None`). Upload mit Chat-Allowlist (`ERLAUBTE_MIME`, ohne HEIC). |
| Dokument-Upload | `routes/dokument.rs` legt Datei, Dokument und System-ETB-Eintrag in einem Vorgang an (`anhang::repo::anlegen_tx`). Allowlist `ERLAUBTE_MIME_DOKUMENT` mit HEIC/HEIF/TIFF. |
| ETB-Erfassen | `routes/etb.rs::erfassen` ist die einzige Schreibroute. Ein Replay über `client_id` wird **vor** dem Aktiv-Gate und vor jeder Feldprüfung erkannt. `etb::repo::anlegen_idempotent` fügt ohne Transaktion ein, mit einem Race-Zweig auf die UNIQUE-Verletzung. |
| ETB-Anzeige | `EtbEintragAnzeige.folgeauftraege` mit `#[sqlx(skip)]`, gefüllt durch `folgeauftraege_nachladen` in `laden` und `abfrage` (LFH-636). Das ist das Muster für `anhaenge`. |
| Chat-Verknüpfen | `chat::repo::anlegen_mit_anhaengen` ist der einzige Schreibpfad in `chat_nachricht_anhang` (per grep bestätigt). Die Nachricht-Bearbeitung ändert keine Anhänge. |
| Schwärzung | `anhang` wird per `ZeileLoeschen` gelöscht, `chat_nachricht_anhang` ist Retain G_FK über `UeberParent`, `etb_eintrag` bleibt (G_ETB). Der Guard verlangt für jede neue Tabelle in der CASCADE-Hülle eine Regel. |
| Frontend-Erfassung | `offline/useEtbErfassung.ts` sendet jeden Eintrag mit `client_id`. Bei transientem Fehler reiht es ihn in die IndexedDB-Queue ein, die nur JSON kann. Die Schnellerfassung ist kein `<form>`, Enter sendet über den eigenen Tastenweg. Von den Entwurfs-Tabs ist nur der aktive montiert (`EtbEntwurfsTabs`). |
| Guards | `etb` steht in `DEFERRED_MODULE` (`tests/einsatz_kontext_guard.rs`). Neue ETB-Handler nehmen die manuellen Gates wie `fordere_lese_gates`, keinen Extractor. |

Motivation und Entscheidungen des Auftraggebers: siehe proposal.md.

## Goals / Non-Goals

**Goals:**
- Eine Datei hat genau einen Lebenszyklus. Wer sie besitzt (Chat, Dokument, ETB),
  entscheidet über Rechte, Download, Löschen und Aufräumen. Kein anderer Pfad hebelt das aus.
- Die Idempotenz der ETB-Erfassung bleibt bitgenau erhalten. Ein Replay liefert den
  Bestand samt Anhängen und erzeugt keine Dublette.
- Konstante Zahl von Abfragen je ETB-Seite, kein N+1.

**Non-Goals (Design-Ebene, zusätzlich zu proposal.md):**
- Kein Umbau des generischen Uploads auf eine Transaktion über alle Felder (LFH-114 hat das
  bewusst offen gelassen).
- Keine Prüfung der MIME-Allowlist beim **Verknüpfen**. Geprüft wird beim Upload. Eine
  ungebundene Datei aus dem generischen Upload darf das ETB also verknüpfen, denn die
  Chat-Allowlist ist eine Teilmenge der Dokument-Allowlist.
- Kein Umbau des Chat-Downloads auf einen Pfad-Builder (`NachrichtenStrom.tsx` baut ihn inline).

## Decisions

**D1: Eigene Join-Tabelle mit `anhang_id UNIQUE`.**
```
etb_eintrag_anhang(
  eintrag_id INTEGER NOT NULL REFERENCES etb_eintrag(id) ON DELETE CASCADE,
  anhang_id  INTEGER NOT NULL UNIQUE REFERENCES anhang(id) ON DELETE CASCADE,
  PRIMARY KEY (eintrag_id, anhang_id)
)
```
Beide FKs sind CASCADE. Die Schwärzung löscht `anhang` per `ZeileLoeschen`, mit RESTRICT
schlüge sie fehl. Der Guard findet die Tabelle nur über die CASCADE-Hülle (LFH-291). Die
Einsatz-Löschung räumt über `etb_eintrag` ab. `UNIQUE(anhang_id)` macht „höchstens ein
Eintrag je Datei“ zur Datenbankaussage. Der Handler meldet den Fall vorher mit 422, die
UNIQUE-Verletzung ist nur das Netz und käme über das Sicherheitsnetz als 409 heraus. Der
Primärschlüssel deckt `eintrag_id` als Präfix ab, das Nachladen je Seite braucht keinen
eigenen Index. Nummer: nächste freie nach `scripts/check-migrationen.sh` gegen
`origin/alpha`, heute 0121.
*Verworfen:* Die Dokumentenablage mit `bezug_etb_eintrag_id` verlangt Kategorie und Titel
je Datei, schreibt einen eigenen System-Eintrag und steht nicht am Eintrag
(Entscheidung des Auftraggebers).

**D2: Eigener Upload `POST /api/einsaetze/{id}/etb/anhaenge` mit Dokument-Allowlist, eine
Datei je Anfrage.**
Gates wie beim Erfassen: `fordere_schreibrecht`, `fordere_modul_zugriff_laden("etb")`,
`fordere_aktiv`. Die Schleife aus `routes/anhang.rs::hochladen` (Feld lesen, MIME aus der
Endung, Größe, Scan, Persistieren) wird ein geteilter Helfer in `src/anhang/`, der die
Allowlist als Parameter nimmt. Der generische Upload ruft ihn mit `ERLAUBTE_MIME`, der
ETB-Upload mit `ERLAUBTE_MIME_DOKUMENT`. Kein kopierter Block. In `app.rs` steht
`DefaultBodyLimit::max(26 MiB)` an der Route, sonst kappt der Default bei 2 MiB still. Weil
das Limit für die ganze Anfrage gilt, lädt der Client **eine Datei je Anfrage** mit
120 s Timeout (wie `DOKUMENT_UPLOAD_TIMEOUT_MS`).
*Verworfen:* (a) Ein Parameter am generischen Upload: Die Route ist modul-los, und die
Allowlist hinge dann an einer Client-Angabe. (b) Ein einziger multipart-POST
„Eintrag + Dateien“: Die Offline-Queue kann nur JSON, und jeder Retry schickte bis zu
250 MiB erneut. Die `client_id`-Idempotenz müsste für multipart neu gebaut werden.

**D3: Die Erfassung wird eine Transaktion, und der Race-Zweig wird eine Prüfung in der
Transaktion.**
`anlegen_idempotent` läuft in beiden Zweigen, mit und ohne `client_id`, durch ein
`write_retry!` (`BEGIN IMMEDIATE`). Die Reihenfolge ist fest:
1. Mit `client_id`: bestehenden Eintrag suchen. Ist er da, Rückgabe `(id, war_neu=false)`
   **ohne** Anhangsprüfung, denn seine Anhänge sind ja gebunden.
2. Anhänge klassifizieren. Es genügt eine Abfrage je ID oder eine gebündelte: existiert
   im Einsatz? (sonst 400) Gebunden an ETB, Chat oder Dokument? (sonst 422)
3. Eintrag einfügen, mit dem Funktions-Snapshot wie bisher.
4. Verknüpfungen einfügen.

`BEGIN IMMEDIATE` serialisiert die Schreiber. Damit ist Schritt 1 gegen einen
gleichzeitigen Flush sicher, und der bisherige Zweig auf die UNIQUE-Verletzung entfällt.
Der UNIQUE-Index auf `(einsatz_id, client_id)` bleibt als Netz. Die frühe Replay-Erkennung
in der Route (vor dem Aktiv-Gate) bleibt unverändert. `anlegen_tx` behält seine Signatur,
denn über 20 Kopplungspfade rufen es. Der gemeinsame INSERT wird intern so geschnitten, dass
`client_id` optional gebunden wird. Es bleibt ein SQL-Text, keine zweite Kopie.
`EintragDaten` bekommt **kein** Anhangsfeld. Die Anhänge sind ein eigener Parameter von
`anlegen_idempotent`, damit die Kopplungspfade nichts davon sehen.

**D4: Status und Grenzen der Liste.**
Der Handler sortiert und dedupliziert `anhang_ids` wie der Chat
(`routes/chat.rs:242-244`). Mehr als 10 verschiedene IDs ergeben 400: Die Liste ist für sich
unbrauchbar. Die Zahl 10 ist eine Annahme dieses Plans, am Handler als Konstante benannt.
Unbekannt oder fremd ergibt 400. Gebunden ergibt 422, weil erst der Zustand die Verknüpfung
verbietet. Das ist die Trennlinie aus CLAUDE.md. Der 400-Wortlaut nennt den Anhang als
Ursache („Anhang unbekannt oder nicht mehr vorhanden“), damit ein nach der Karenz
weggeräumter Anhang in der Liste der abgelehnten Einträge verständlich ist (D10).

**D5: Wire-Feld `anhaenge: Vec<AnhangAnzeige>`.**
`AnhangAnzeige` ist schon im Schema registriert und trägt keine Bytes. Das Feld bekommt
`#[sqlx(skip)]` und ist nicht `Option`, also immer serialisiert und in der Spec
`required`. `anhaenge_nachladen` bündelt nach dem Muster von `folgeauftraege_nachladen`:
eine Abfrage `… FROM etb_eintrag_anhang l JOIN anhang a … WHERE l.eintrag_id IN (…) ORDER BY a.id`
über die IDs der Seite. Die IN-Liste ist durch `MAX_LIMIT` (500) begrenzt. Das Nachladen
läuft in `laden` (also auch in der Erfassen-Antwort und im Replay) und in `abfrage`.
`api/types.ts` bleibt, `Anhang` ist dort schon re-exportiert.

**D6: Download `GET /api/einsaetze/{id}/etb/{eintrag_id}/anhaenge/{aid}`.**
Gates wie die ETB-Listen (`fordere_lese_gates`: Lesezugriff inklusive Beobachter, Modul
ETB). Die Bindung prüft **eine** Abfrage:
`SELECT 1 FROM etb_eintrag_anhang l JOIN etb_eintrag e ON e.id = l.eintrag_id WHERE l.anhang_id = ? AND l.eintrag_id = ? AND e.einsatz_id = ?`.
Kein Treffer ergibt 404, gleich ob Einsatz, Eintrag oder Anhang nicht passt. Die Antwort
kommt über `routes::support::anhang_antwort` (ETag/304), in `app.rs` mit
`ConcurrencyLimitLayer::new(MAX_GLEICHZEITIGE_ASSET_DOWNLOADS)`. Die Eintrags-ID im Pfad
bindet den Link an genau einen Eintrag. Ein Pfad nur mit der Anhang-ID ginge auch, ließe
sich aber nicht gegen den Eintrag der Zeile prüfen. Der Pfad-Builder `etbAnhangPfad` steht
in `api/etb.ts` wie `dokumentDownloadPfad` in `api/dokumente.ts`: Es ist ein API-Pfad, keine
Navigation, gehört also nicht nach `routing/deeplinks.ts`.

**D7: Dritter Linker, Kreuzsperren an jedem Verknüpfungspfad.**
- `LinkerStand.etb_gesamt` mit `ist_etb()`. `generischer_download_gesperrt()` sperrt
  zusätzlich bei `ist_etb()`. Die bestehenden Struct-Literal-Tests bekommen das Feld.
- Generischer DELETE: 422 bei `ist_etb()`, Wortlaut „Anhang gehört zu einem
  ETB-Eintrag und ist unveränderlich“. `repo::loeschen` bekommt ein zweites `NOT EXISTS`.
- `sweep_verwaiste`: drittes `NOT EXISTS`.
- `chat::repo::anlegen_mit_anhaengen`: zusätzliches `NOT EXISTS etb_eintrag_anhang`. Der
  Chat behält dafür seinen bestehenden 400-Wortlaut „Unbekannter oder fremder Anhang“ wie
  heute beim Dokument-Anhang. Eine Umstellung der Chat-Fehlerklasse ist nicht Teil dieses
  Tickets.
- Das ETB prüft beim Verknüpfen gegen alle drei Linker (D3, Schritt 2).
- **Dokumente brauchen keine Sperre:** `dokument::repo` legt seine Datei selbst in der
  Transaktion an (`anhang::repo::anlegen_tx`) und verknüpft nie eine bestehende. Ein
  ETB-gebundener Anhang kann also nie zum Dokument werden.

**D8: Schwärzung.**
Neue `TabellenRegel` für `etb_eintrag_anhang`:
`Scoping::UeberParent { fk: "eintrag_id", parent: "etb_eintrag" }` mit
`retain("eintrag_id", G_FK)` und `retain("anhang_id", G_FK)`, Kommentar wie bei
`chat_nachricht_anhang` („Junction; CASCADE von anhang/etb_eintrag räumt sie“). Gelöscht
wird über die bestehende `anhang`-Regel. Der Eintrag bleibt nach der ETB-Politik (G_ETB).
Der Dateiname steht in keinem ETB-Text, weil die Erfassung ihn nicht in `inhalt` schreibt.
Es bleibt also nichts Personenbezogenes aus der Datei zurück. Der Verhaltenstest steht neben
`schwaerzung_loescht_dokument_samt_anhang_und_haelt_den_etb_nachweis`.

**D9: Schnellerfassung: Dateien im Bauteil, vom Tab-Container gehalten.**
- Der Bedienweg „Anhang“ steht in der Chip-Leiste neben „Feld“. Er ist ein antd `Upload`
  mit `beforeUpload={() => false}`, `multiple`, `showUploadList={false}` und einem
  `<Button type="dashed">` mit Büroklammer-Ikone in `aria-hidden`-Hülle, ohne `size`. Das
  `accept` teilt sich die Schnellerfassung mit `DokumentAblegenModal` über eine exportierte
  Konstante neben `DOKUMENT_MAX_GROESSE` in `api/dokumente.ts`, keine Kopie.
- Die gewählten Dateien stehen als Liste unter der Chip-Leiste: Name, Größe
  (`formatGroesse`), ein Entfernen-Knopf mit dem zugänglichen Namen
  „Anhang <dateiname> entfernen“. Die Größe über 25 MiB wird beim Wählen abgewiesen.
- **Kein neues Tastenkürzel.** Die Hinweiszeile bleibt unverändert, denn sie nennt nur
  Tastenwege. „Anhang“ ist über Tab erreichbar. Enter sendet weiter aus dem Textfeld.
- **Zustand:** Die Schnellerfassung bekommt optional kontrollierte Props
  `dateien`/`onDateienChange`. `EtbEntwurfsTabs` hält eine In-Memory-Map Entwurfs-ID →
  `File[]`. Damit überleben Dateien den Tab-Wechsel (nur der aktive Tab ist montiert),
  aber keinen Reload. Der IndexedDB-Entwurfsspeicher bleibt JSON. Die Berichtigung montiert
  die Schnellerfassung **statt** der Tabs und führt die Liste unkontrolliert im Bauteil.
  Beim Schließen eines Entwurfs fällt sein Map-Eintrag weg.
- **Absenden:** Liegen Dateien vor und ist `navigator.onLine` falsch, wird abgewiesen, mit
  Hinweis und ohne Leeren. Sonst werden die Dateien nacheinander hochgeladen
  (`ladeEtbAnhangHoch`, eine je Anfrage). Die Erfassung meldet dabei
  „Lädt hoch (1/2) …“ am Erfassen-Knopf, danach geht es über `erfassen` mit `anhang_ids`.
  Eine Zuordnung Datei → hochgeladene ID (`WeakMap<File, number>` im Bauteil) verhindert
  einen zweiten Upload bei einem **Teilausfall**: Datei 1 ist oben, Datei 2 scheitert, der
  nächste Versuch lädt nur Datei 2. Bei einer fachlichen Ablehnung des Eintrags wird die
  Zuordnung geleert, denn die ID könnte die Ursache sein. Scheitert ein Upload, wird nicht
  erfasst. Wortlaut und Liste bleiben stehen, `EtbPage` zeigt die Meldung wie bisher.
  Ein **transienter** Fehler beim Erfassen erreicht die Schnellerfassung dagegen nie:
  `useEtbErfassung.erfassen` reiht dann ein und löst sich ohne Fehler auf (D10). Für die
  Schnellerfassung ist das ein Erfolg, die Liste wird geleert. Nach Erfolg wird die Liste
  immer geleert. `nurUebernahme` kennt keine Dateien,
  ein Test pinnt es trotzdem.
- **Offline-Anzeige:** Der Online-Zustand kommt aus einem geteilten Hook. Das bisher
  lokale `useOnline` aus `components/Kopfleiste.tsx` wird nach `offline/useOnline.ts`
  gezogen, statt eine zweite Kopie zu bauen. Offline ist „Anhang“ gesperrt, daneben steht
  sichtbar „Anhänge brauchen eine Verbindung. Der Text lässt sich trotzdem erfassen.“ Das
  ist der zweite Kanal neben dem Grau (WCAG 1.4.1).

**D10: Queue: `anhang_ids` fahren im JSON mit, keine Schema-Version.**
`NeuerEintrag.anhang_ids?: number[]` ist optional. Bestehende Queue-Zeilen ohne das Feld
bleiben gültig, ein IDB-Versionssprung ist nicht nötig. `useEtbErfassung` ändert sich
nicht: Ein transienter Fehler nach gelungenem Upload reiht den Eintrag samt `anhang_ids`
ein, denn die Dateien liegen dann schon auf dem Server. „Nur online“ heißt also: **der
Upload** ist nur online. Die ausstehende Zeile der Zeitachse nennt die Zahl der Anhänge
(„2 Anhänge“), damit sichtbar ist, dass sie mitgehen. Liegt der Eintrag länger als die
Karenz (24 h) in der Queue, hat der Aufräumlauf die Dateien gelöscht. Der Flush endet dann
in 400 mit dem Wortlaut aus D4, und der Eintrag steht unter „abgelehnt“ mit erhaltenem Text.

**D11: Anzeige in Zeitachse und Vorschau.**
Ein Bauteil `etb/EtbAnhaenge.tsx` rendert je Anhang ein `<a href={etbAnhangPfad(…)} download>`
mit `verweisStil(token)`. Sichtbar: `IMG_0412.HEIC · 3,1 MB`. Zugänglicher Name:
„IMG_0412.HEIC, 3,1 MB, Anhang zu Nr. 42 herunterladen“. Keine Ikone, kein Emoji, kein ↗
(das ist die Glyphe für Navigation, ein Download navigiert nicht). `EtbZeitachse` hängt es
als eigenes Teil in `hinweisZeile`, bedingt auf `anhaenge.length > 0`, **nicht** über
`hatVerknuepfung`. Anhänge sind keine Kopplung, und diese Bedingung steuert
`EtbBacklinkBadges`. `EtbEintragVorschau` zeigt dasselbe Bauteil.

**D12: Ein ungebundener Anhang gehört vorerst der Person, die ihn hochgeladen hat.**
(Nachtrag nach dem Review C1, Entscheidung des Orchestrators.) Die generischen Routen
`GET` und `DELETE /api/einsaetze/{id}/anhaenge/{aid}` bedienen einen Anhang, der an
**keinem** Linker hängt, nur für `anhang.hochgeladen_von == benutzer.id`. Alle anderen
bekommen 404 wie für einen unbekannten Anhang, die Existenz bleibt verdeckt. Grund: Ein
ETB-Upload ist bis zum Erfassen ungebunden, und nach einem vorübergehend gescheiterten
Erfassen (D10) bleibt er es bis zu 24 h. In dieser Zeit war er über die modul-lose Route
für jede lesende Person ladbar, auch bei gesperrtem Modul ETB (fortlaufende IDs), und für
jede schreibende löschbar. Der Flush endete dann mit 400. Wem die Datei gehören wird, steht
erst mit dem Linker fest; bis dahin ist die hochladende Person die einzige, die sie
braucht. Das trifft den Chat genauso (vor dem Senden) und ist dort ebenso richtig. Nach
dem Senden gelten die Chat-Regeln unverändert. Gebundene Anhänge sind nicht betroffen.
- **Die Linker sind vollständig gezählt.** `linker_stand` kennt `chat_nachricht_anhang`,
  `einsatz_dokument` und `etb_eintrag_anhang`. Das sind alle drei Tabellen mit
  `REFERENCES anhang(id)` (Migrationen 0052, 0116, 0125). `karte_hintergrundbild` (0075)
  hält seine Bytes in einer eigenen Tabelle und verweist nicht auf `anhang`. Ein vierter
  Linker, der dort fehlte, würde seine Dateien für alle außer der hochladenden Person
  unerreichbar machen. Wer einen Linker ergänzt, ergänzt `linker_stand` mit.
- **Verworfen: eine Spalte `anhang.herkunft`** („chat“/„etb“) mit Modul-Gate je Herkunft.
  Sie bräuchte eine Migration und einen Parameter durch `hochladen_multipart` und schlösse
  trotzdem nur die Modulfrage, nicht das Löschen fremder Entwürfe.
- **Die Folge für den Chat:** Ein Anhang, dessen Nachricht hart gelöscht wurde, ist wieder
  ungebunden und damit nur noch für die hochladende Person ladbar. Weich gelöschte
  Nachrichten sperren ohnehin (LFH-116).
- Tests: `tests/etb_anhang.rs::ungebundener_etb_upload_ist_generisch_nur_fuer_die_hochladende_person`
  und `tests/anhang.rs::chat_anhang_vor_dem_senden_nur_fuer_die_hochladende_danach_fuer_alle`.

## Risks / Trade-offs

- [Ein Queue-Eintrag wartet länger als 24 h] → Er wird mit verständlichem Grund abgelehnt,
  der Text bleibt erhalten. Die Dateien sind aber weg und müssen neu erfasst werden.
  Ein „Erneut senden“ läuft mit denselben `anhang_ids` erneut in 400. Siehe Open Questions.
- [HEIC erreicht über einen Umweg den Chat] Eine über den ETB-Upload hochgeladene, nie
  erfasste HEIC-Datei ist ungebunden. Der Chat dürfte sie verknüpfen, weil er beim
  Verknüpfen keine Allowlist prüft. → Die Datei ist geprüft und gescannt, nur die
  Darstellung im Chat kennt HEIC nicht. Nicht in diesem Umfang, siehe Open Questions.
- [Abgebrochene Uploads wachsen die DB] Wer wählt, hochlädt und dann verwirft, hinterlässt
  verwaiste BLOBs. → Der Aufräumlauf nimmt sie nach 24 h.
- [Rennen Aufräumlauf gegen Verknüpfen bei einer knapp 24 h alten Datei] → Beide schreiben
  unter SQLites Schreibsperre. Löscht der Lauf zuerst, endet das Erfassen in 400 mit
  Rollback. Verknüpft das Erfassen zuerst, greift das `NOT EXISTS` des Laufs.
- [Große Dateien über Mobilfunk] 25 MiB samt Scan brauchen länger als die Standardfrist.
  → 120-s-Timeout je Datei, sichtbarer Fortschritt „Lädt hoch (n/m)“. Die Prüfliste misst
  die Rückmeldung.
- [Die Transaktion hält die Schreibsperre länger] → Die Bytes liegen beim Erfassen schon
  in der DB, die Transaktion fügt nur Zeilen ein, höchstens 11.

## Migration Plan

Die Migration legt nur eine neue Tabelle an, ohne Rebuild und ohne Backfill. Bestandseinträge
tragen `anhaenge: []`. Rückweg: Die Tabelle bleibt leer liegen, eine eingespielte Migration
wird nicht zurückgedreht (sqlx-Checksum). Frontend und Backend gehen im selben Binary aus.
Ältere Clients senden kein `anhang_ids` (`#[serde(default)]`) und ignorieren das neue Feld.

## Open Questions

**Entschieden vom Auftraggeber (25.09.2026), vor `/opsx:apply`:**
- **Entfernen eines ETB-Anhangs: nein.** Ein ETB-Anhang ist unveränderlich wie der Eintrag
  selbst. Eine falsche Datei wird per Berichtigung eingeordnet und geht erst mit der
  Schwärzung. Der Plan bleibt, wie er ist (Requirement „Ein ETB-Anhang ist unveränderlich“).
- **Höchstzahl 10 Anhänge je Eintrag** (D4): als Annahme bestätigt.
- **Migrationsnummer:** Der offene PR zu LFH-22 belegt `0123` (`org_logo`). Dieser Change
  nimmt die nächste freie Nummer **über** allen offenen Nummern und prüft vor dem PR erneut
  mit `scripts/check-migrationen.sh`.

Offen, ohne Wirkung auf Spec, Ansatz und Aufgabenschnitt:
- **„Erneut senden“ bei weggeräumtem Anhang.** Soll die Liste der abgelehnten Einträge
  anbieten, ohne Anhänge erneut zu senden? Das ginge mit derselben `client_id`, denn es gab
  keinen Commit. Heute sendet sie unverändert.
- **HEIC im Chat.** Soll der Chat beim Verknüpfen die Chat-Allowlist prüfen und damit auch
  den Umweg über den ETB-Upload schließen? Eigenes kleines Ticket.
