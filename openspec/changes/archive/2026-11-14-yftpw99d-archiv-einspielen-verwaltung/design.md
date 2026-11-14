# Design

## Context

Der Befehl `lifeline-hub archiv einspielen` (`src/main.rs`, `cmd_archiv_einspielen`) liest den
Schlüssel mit `backup::verschluesselung::Schluessel::laden` und ruft
`einsatz::archiv::einspielen::einspielen(pool, datei, schluessel, org, jetzt)` auf. Die
Hintergründe stehen im Kopf von `src/einsatz/archiv/einspielen.rs` und in
`docs/betrieb/backup-restore.md`. Drei Stellen des Kerns sind auf den Befehl zugeschnitten:

- `org: Option<i64>`. Mit `Some` entfällt die Namensprüfung der Organisation, ohne Angabe ist das
  Ziel die Org-ID aus dem Archiv. Org-IDs vergibt aber jede Installation selbst.
- Die Admin-Spur entsteht mit `schreibe_ohne_akteur_tx(…, "Befehl archiv einspielen", …)` in der
  Übernahme-Transaktion.
- Die Übernahme legt selbst eine Pseudo-Kopplung `wird_gemeldet`/`widerrufen` mit Gegenstelle
  „Archiv“ an.

Der Archiv-Namensraum `/api/aufbewahrung` ist per Spec lesend. Seine Ausnahmen sind abgezählt, und
der Wächter `archiv_namensraum_nur_lesend_und_admin` in `tests/aufbewahrung.rs` zählt sie nach.

## Goals / Non-Goals

**Goals:**
- Ein Kern für Befehl und Verwaltung. Die Unterschiede liegen nur in den Parametern.
- Der Schlüssel berührt nie die Platte.
- Das Verhalten des Befehls bleibt unverändert.

**Non-Goals:**
- Kein Gegenstück zu `--org` in der Oberfläche; der Befehl bleibt dafür.
- Kein Hintergrundauftrag mit Fortschrittsanzeige: das Einspielen läuft im Request.
- Kein Einspielen am Hub, auch nicht als Ausnahme für einzelne Organisationen.

## Decisions

### D1 Route unter `/api/admin/archiv/einspielen`, nicht im Archiv-Namensraum

`GET` liefert die Verfügbarkeit `{ verfuegbar: bool }`, `POST` spielt ein. Beide nehmen
`AdminUser`.

- **Warum nicht `/api/aufbewahrung/einspielen`:** Der Archiv-Namensraum soll lesend bleiben, so
  sagen es die Anforderung „Archiv liest nur …“ und ihr Wächter. Eine Ausnahme mehr würde die
  Regel aufweichen, die die Akten gesperrter Einsätze schützt. Das Einspielen ändert keinen
  archivierten Einsatz, es legt einen neuen Spiegel an. Neben `/api/admin/instanz` und
  `/api/admin/anbindungen` liegt es inhaltlich richtig.
- **Verworfen: eine eigene Verfügbarkeit in `/api/admin/instanz`.** Die Übersicht dort lädt
  Kopplungen samt Zertifikaten, und das Frontend müsste die Regel aus D3 nachbauen. Die Oberfläche
  soll aber nur ausblenden, nicht entscheiden (ADR-0005, letzter Punkt).

### D2 Kern mit `Ziel` und `Akteur`

`einspielen(pool, datei, schluessel, ziel: Ziel, akteur: Akteur<'_>, jetzt)` mit drei Varianten
für das Ziel:

- `Ziel::AusArchiv`: der Befehl ohne `--org`, Name muss passen
- `Ziel::Org(id)`: der Befehl mit `--org`, ohne Namensprüfung
- `Ziel::EigeneOrg(id)`: die Verwaltung, mit Namensprüfung gegen die Org `id`

`EigeneOrg` ist neu. `AusArchiv` und `EigeneOrg` teilen die Namensprüfung, und die Meldung nennt
`--org` nur beim Befehl. Bei `EigeneOrg` heißt sie „Der Block gehört zur Organisation „…“, nicht
zu „…“.“

`Akteur` hat zwei Varianten:

- `Akteur::Befehl`: Eintrag wie bisher über `schreibe_ohne_akteur_tx`
- `Akteur::Person { benutzer, peer_ip }`: neuer `admin_audit::schreibe_tx`, der wie
  `schreibe_ohne_akteur_tx` in der Transaktion `conn` mit Fehler schreibt, aber `akteur_id`,
  `akteur_name` und `peer_ip` setzt. Seine `tracing`-Zeile folgt nach dem Commit im Handler, wie
  bei `schreibe_ohne_akteur_tx`.

- **Verworfen: ein zweiter Kern für die Verwaltung.** Prüfungen wie Frist, Löschersuchen und
  Nachschwärzen würden sonst doppelt gepflegt.

### D3 Hub-Sperre instanzweit, gezählt am Kopplungszustand

`instanz::repo::wird_erreicht(pool) -> bool` liefert, ob eine Zeile aus `instanz_kopplung` mit
`richtung = 'wird_gemeldet'` und `zustand IN ('angebahnt', 'aktiv')` besteht.

- **Pseudo-Kopplungen zählen nicht:** Die Kopplungen, die das Einspielen selbst anlegt, stehen
  immer auf `widerrufen`. Ein Test hält fest, dass ein eingespielter Block die Funktion nicht
  sperrt.
- **Zeitpunkt der Prüfung:** Der Handler prüft vor dem ersten Lesen des Multipart-Bodys. Am Hub
  wird so kein Schlüssel angenommen, denn der Body wird gar nicht gelesen.
- **Statuscode:** 422, weil der Zustand der Instanz entscheidet, nicht das Feld (`src/AGENTS.md`,
  Statuscode-Konvention).
- **Verworfen: die Sperre je Organisation.** Am Hub läge der private Schlüssel trotzdem an einer
  öffentlich erreichbaren Installation (Abstimmung 13.11.2026).
- **Wird während des Einspielens eine Kopplung angebahnt:** Der Schlüssel des laufenden Aufrufs
  ist dann schon im Speicher. Das Fenster ist so lang wie ein Request, und einen Code auszustellen
  verlangt ebenfalls einen Admin derselben Instanz. Eine zweite Prüfung in der Transaktion bringt
  dafür nichts.

### D4 Multipart: Block gestreamt, Schlüssel im Speicher

Die Felder in fester Reihenfolge, wie sie das Frontend schickt:

- **`schluessel`** (Text) oder **`schluessel_datei`** (Datei): höchstens 64 KiB. Eine
  Identitätsdatei ist wenige hundert Bytes groß.
- **`passphrase`** (optional): höchstens 1 KiB.
- **`block`** (Datei): zuletzt.

Schlüssel und Passphrase landen in `age::secrecy::SecretSlice<u8>` bzw. `SecretString`. Beide
werden beim Fallenlassen genullt, und `age` bringt `secrecy` schon mit, also keine neue
Abhängigkeit. `Schluessel::laden` nimmt heute `Vec<u8>`. Es bekommt eine Variante, die einen
geliehenen Puffer liest, damit keine ungeschützte Kopie entsteht. Die Passphrase kommt über die
vorhandene Rückruf-Schnittstelle.

Der Block wird Stück für Stück (`field.chunk()`) in eine Zwischendatei im Verzeichnis der
Datenbank geschrieben, mit dem neuen Teil `TEIL_HOCHGELADEN`. Die Datei ist verschlüsselt, und
`Zwischendatei` löscht sie beim Fallenlassen.

- **Aufräumen nach einem Absturz:** `zwischendateien_aufraeumen` nimmt den neuen Teil mit,
  dieselbe Altersgrenze von 6 Stunden.
- **Warum der Schlüssel vor dem Block kommt:** Ist der Schlüssel unlesbar oder fehlt er, endet der
  Aufruf, bevor 256 MiB auf die Platte gehen. Ein Feld in falscher Reihenfolge ist 400.
- **Verworfen: den Block im Speicher halten.** 256 MiB je Upload, bei vier gleichzeitigen also
  bis zu 1 GiB RAM.

### D5 Grenzen

- **Body:** `DefaultBodyLimit::max(ARCHIV_BLOCK_MAX)` mit 256 MiB an der Route. Ein zu großer Body
  wird als 413 abgewiesen, mit einer Meldung, die auf den Befehl verweist. `field.chunk()` meldet
  das Überschreiten als Fehler, der auf `PayloadTooLarge` abgebildet wird.
- **Gleichzeitige Uploads:** `route_layer(upload_grenze.clone())`. Die Route kommt nach
  `zulassung::OHNE_ZULASSUNGSGRENZE`, wie `tests/zulassung_guard.rs` es für Upload-Routen verlangt.
- **Leerlauf:** `transfer::LEERLAUF_FRIST` gilt wie bei anderen Uploads, falls der Layer sie
  mitbringt.

### D6 Abbruch und Laufzeit

Der Handler ruft den Kern direkt auf. Schließt der Client die Verbindung, verwirft axum das
Future. Damit greift `Drop` der Zwischendateien, wie bei Strg+C im Befehl. Eine schon übernommene,
unvollständige Kopie räumt der Purge-Lauf nach `FERTIG_MINUTEN` ab, wie beim Befehl.

Das Frontend ruft mit `timeoutMs` von 10 Minuten auf. Die Übernahme läuft in einer
Schreibtransaktion (`write_retry!`), wie beim Befehl. Der Doku-Hinweis „nicht während eines
laufenden Einsatzes“ gilt weiter und steht im Dialog als Satz.

- **Verworfen: ein Hintergrundauftrag mit Abfrage des Fortschritts.** Er bräuchte einen Zustand,
  der den Request überlebt, also einen Ort für den Schlüssel außerhalb des Aufrufs. Genau das soll
  nicht sein.

### D7 Antwort

`ArchivEingespieltAnzeige` mit:

- `einsatz_id`
- `bezeichnung`
- `einsatznummer`
- `org_name`
- `loeschen_at` (UTC, ADR-0012)
- `inhalte`
- `hinweise: Vec<String>`

Die Antwort kommt als Response-DTO mit Typ-Codegen (`scripts/check-typ-codegen.sh`). Die Hinweise
sind fertige Sätze wie beim Befehl. Ihre Zeitangaben stehen heute als UTC-Text im Satz. Für die
Oberfläche bekommen die Hinweise mit Frist ihren Zeitpunkt als eigenes Feld:
`frist_endet_at: Option<String>` für „Eine Frist des Blocks endet …“. Die Oberfläche formatiert
ihn in der Anzeigezone, und der Satz ohne Zeit bleibt für den Befehl. Die Liste der
nachgeschwärzten Kategorien zeigt das Frontend als Hinweistext.

### D8 Oberfläche

Auf `AufbewahrungUebersicht.tsx` steht die Primäraktion „Archiv einspielen“. Sie erscheint nur für
einen System-Admin und nur bei `verfuegbar`, die Abfrage läuft mit `enabled: istAdmin`.

Der Dialog ist ein `ErfassungsModal` mit drei Feldern (Erfassungs-Norm, UI-Form-Leitlinie: höchstens
etwa drei Felder im Modal):

- **Block:** Dateiwahl, `.age`
- **Schlüssel:** Umschalter Datei oder Text, ein Feld je Wahl
- **Passphrase:** optional, `type=password`, `autocomplete=off`

Senden geht über `apiUploadMitFortschritt` (XHR mit Byte-Fortschritt, wie alle großen Uploads im Haus; nach dem letzten Byte „Wird eingespielt“) mit `mutateAsync`, damit die Eingaben bei einer Ablehnung bleiben.
Nach Erfolg:

- Der Dialog schließt und setzt sich zurück, die Schlüsselfelder werden geleert.
- Oberhalb der Tabelle steht ein Ergebnisfeld mit Einsatz, „bis …“ (Anzeigezone), Anzahl der
  Inhalte, den Hinweisen und dem Sprung „Einsatz öffnen“.
- Die Einsatzliste und `aufbewahrung()` werden über `queryKeys.ts` invalidiert.

### D9 Einsatzliste live (beim Umsetzen ergänzt)

Nach dem Commit meldet der Handler das Org-Ereignis `einsatzliste` für den neuen Einsatz
(`live::org::einsatzliste_melden`, LFH-734). Offene Einsatzlisten der Org zeigen ihn dann ohne
Neuladen. Der Befehl läuft als eigener Prozess ohne Zugang zum Live-Hub, für ihn bleibt es beim
Neuladen.

### D10 Nachgezogen nach dem Review (13.11.2026)

- **Spur mit dem Abschluss:** „Archiv eingespielt“ entsteht in der Transaktion, die
  `loeschen_at` setzt, nicht mehr in der Übernahme. Scheitert das Einspielen danach (ein Inhalt
  passt nicht zu seiner Prüfsumme, der Einsatz wurde abgeräumt), bleibt keine Spur. Das gilt auch
  für den Befehl.
- **Blocking-Thread:** Hashen und Entschlüsseln laufen in `spawn_blocking`, ebenso das scrypt
  einer geschützten Schlüsseldatei. Der Kern nimmt den Schlüssel als Wert und lässt ihn auf dem
  Thread fallen. Ein Abbruch setzt ein Signal, das das Entschlüsseln mit dem nächsten Block
  beendet; die Zwischendatei geht dann mit.
- **Passphrase nie als `String`:** `Schluessel::laden_geschuetzt` nimmt sie als `SecretString`;
  eine geschützte Datei wird beim Laden entsperrt.
- **Grenzen im Spiegel:** Block, Schlüssel und Passphrase stehen in `eingabegrenzen.ts`; die
  Maske nimmt nicht mehr an als der Server.
- **Oberfläche:** Abbrechen ist gesperrt, solange eingespielt wird (`speicherung`); eine
  Ablehnung heißt „Nicht eingespielt“; scheitert die Verfügbarkeitsabfrage, steht die Aktion da
  und der Server entscheidet; die Mutation hält den Schlüssel nicht im Cache (`gcTime: 0`); das
  Zeitlimit umfasst Upload und Einspielen (30 Minuten).
- **Meldung ohne UTC:** Eine abgelaufene Aufbewahrung nennt in der Verwaltung keine Zeit.

## Risks / Trade-offs

- **Lange Requests über Proxies:** Ein Reverse-Proxy mit 60 s Timeout bricht große Blöcke ab.
  Gegenmittel: Die Betriebsdoku nennt das, für große Blöcke bleibt der Befehl. Ein Abbruch
  hinterlässt keinen Klartext (D6).
- **RAM für Schlüssel:** Abfluss über Swap oder Core-Dump ist theoretisch möglich. Gegenmittel:
  `SecretSlice` und `SecretString` und eine kurze Lebensdauer. Den Befehl betrifft das genauso.
- **Platte:** Ein Block von 256 MiB belegt kurz das Doppelte, verschlüsselt und entschlüsselt.
  Gegenmittel: höchstens vier gleichzeitige Uploads, und die Grenze steht in der Betriebsdoku.
- **Signatur des Kerns ändert sich:** Den Befehl ziehen wir im selben Commit mit. Sein Verhalten
  bleibt, bewacht von den bestehenden Tests in `src/einsatz/archiv/tests.rs`.

## Migration Plan

Keine Migration. Ausrollen mit dem nächsten Release; zurück geht es, indem man die Route entfernt.
Der Befehl bleibt unverändert verfügbar.
