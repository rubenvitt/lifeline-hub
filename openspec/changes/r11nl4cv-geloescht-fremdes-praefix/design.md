# Design

## Context

Motivation: proposal.md, „Why“. Grundlage sind das Lebensende im Abgleich (LLH-1494,
`src/instanz/spiegel/lebensende.rs`), die Führung auf dem Spiegel (LLH-1641,
`src/instanz/spiegel/fuehrung.rs`) und der Löschvermerk (LLH-1699, ADR-0036, Change
`h7shm5au-loeschsignal-spiegellose-akten`).

Beobachtet am Stand `97933469` (`origin/alpha`):

- **Senden.** `geloeschte(staende)` ruft je Kennung `ist_geloescht`: eigenes Präfix, ID aus der
  Kennung, kein Einsatz mit Kennung oder ID, ID im Löschprotokoll. Weder Org noch Art des
  Protokolleintrags zählen. `geloeschte_akten` belegt dagegen über den Vermerk
  (`loeschvermerk::belegte`) und für Altbestand über `is_altbestand_geloescht` (eigenes Präfix,
  Org der Kopplung, Art ≠ `spiegel`, weder Einsatz noch Akte). Aufgerufen wird `geloeschte` im
  Pull in `handle_abgleich` und im Push in `abgleich_einmal` (`geloescht_offen`).
- **Annehmen.** `geloescht_uebernehmen` verlangt das Präfix des Gegenübers und einen Spiegel
  dieser Kopplung (`spiegel_der_kopplung`), merkt ihn zum Abräumen vor und schreibt den Vermerk.
- **Wo der Spiegel hängt.** Mit Schalter richtet `spiegel::fuehrung::richte_aus` jeden Spiegel
  nach seiner Akte aus: Er hängt an der Kopplung des Führers, oder ohne gekoppelten Führer an
  keiner (`kopplung_org_id = NULL`, beendet). Die Kopplungsprüfung allein filtert also schon
  die meisten fremden Absender; die Präfixprüfung schneidet dagegen den Führer ab, der nicht
  der Ursprung ist.
- **Lieferungen** nehmen eine fremde Kennung an, wenn die Akte den Absender als Führer nennt
  (`fuehrt_laut_akte`, nur mit Schalter).

## Goals / Non-Goals

**Goals:**

- Ein gespiegelter Einsatz endet beim früheren Führer, wenn der jetzige Führer ihn endgültig
  löscht, gleich mit welchem Präfix (Spec-Delta `instanz-fuehrung`).
- Gemeldet wird nur mit Beleg, angenommen nur vom Führer; eine zurückgespielte Sicherung meldet
  nichts.
- Kein neues Feld, keine neue Protokollversion, keine Migration.

**Non-Goals:**

- Die Annahme von Lieferungen (`uebernehme_alle`, Präfix oder `fuehrt_laut_akte`) bleibt, wie
  sie ist. Eine Lieferung ist umkehrbar, das Abräumen nicht; nur hier gilt die strengere Regel.
- Akten ohne Spiegel (`geloeschte_akten_uebernehmen`, `is_gegenueber_zustaendig`) bleiben
  unverändert.
- Kein Weg für einen Spiegel mit fremdem Präfix bei ausgeschaltetem Schalter (D4).

## Decisions

### D1 Ein Beleg für Stände und Akten

`geloeschte` bekommt die Kopplung (`kopplung_id`) und belegt die genannten Stände über dieselbe
Funktion wie `geloeschte_akten`: Vermerk (`loeschvermerk::belegte`, eine Abfrage über die Liste)
oder Altbestand (`is_altbestand_geloescht` je Kennung). Beide teilen eine private Funktion
(Liste entdoppeln, auf `EINSAETZE_MAX` kürzen, belegen, als `Lebensende` ausgeben).
`ist_geloescht` entfällt.

Damit wird der Altbeleg für Stände enger (mit Ruben abgestimmt): Ein abgeräumter Spiegel (Art
`spiegel`) belegt nichts mehr, nur eine Org der fragenden Kopplung zählt, und eine Akte mit der
Kennung hier schließt den Beleg aus. Der bisher gemeldete Fall „eigener Einsatz abgegeben,
Spiegel nach der Nachbereitung abgeräumt“ war falsch: Der Einsatz lebt beim Führer weiter. Ein
Spiegel, den diese Instanz auf `geloescht` des Führers hin abgeräumt hat, bleibt belegt, denn
`geloescht_uebernehmen` schreibt dort den Vermerk.

**Verworfen: nur den Vermerk ergänzen, `ist_geloescht` behalten.** Die kleinste Änderung, aber
zwei Belegregeln für dieselbe Frage, und die falsche Meldung über Art `spiegel` bliebe.

### D2 Die Akte entscheidet über das Abräumen

`geloescht_uebernehmen` prüft vor dem Vormerken, ob der Absender der Führer ist, über eine neue
Funktion neben `fuehrt_laut_akte` in `spiegel::fuehrung` (Arbeitsname
`is_fuehrer_des_spiegels(conn, kennung, absender)`):

- Schalter an (`is_enabled_tx`) und eine Akte mit der Kennung (`find_by_kennung`): wahr genau
  dann, wenn `fuehrer_kennung == absender`. Das Präfix zählt dann nicht, auch nicht, wenn es
  passt.
- Sonst: wahr, wenn die Kennung mit `<absender>/` beginnt (bisherige Regel).

Die Prüfung „Spiegel dieser Kopplung“ bleibt davor.

Die Akte wird beim Abräumen nicht eigens behandelt: Sie hängt am Spiegel und geht mit dem
Einsatz (Kaskade), der Vermerk entsteht wie bisher.

**Verworfen: Präfix oder Akte.** Kleiner, aber ein Präfix, dessen Instanz laut Akte nicht mehr
führt, könnte weiter abräumen lassen. Nach `richte_aus` hängt ein solcher Spiegel zwar an der
Kopplung des Führers, aber die Regel soll nicht von dieser Ausrichtung abhängen, wenn ein
unumkehrbarer Schritt folgt („die Akte entscheidet, der Spiegel folgt“, LLH-1641).

**Verworfen: Akte auch ohne Schalter.** Ohne Schalter ist die Führung eingefroren (LLH-1704),
`fuehrt_laut_akte` liest dann keine Akte, und ohne Schalter entsteht kein Fall mit fremdem
Präfix (D4). Beide Wege lesen die Akte unter derselben Bedingung.

### D3 Ablauf in beiden Richtungen

- **Pull** (die erreichte Seite führte und hat gelöscht, z. B. der Hub nach einer Übergabe): Die
  meldende Seite nennt den Stand ihres Spiegels, die erreichte belegt ihn über den Vermerk aus
  der Skelett-Löschung und antwortet `geloescht`; die meldende räumt nach D2 ab.
- **Push** (die meldende Seite führte und hat gelöscht): Die erreichte nennt den Stand in der
  Antwort, die meldende belegt ihn (`geloescht_offen`) und meldet ihn in der nächsten Runde
  desselben Abgleichs; die erreichte räumt nach D2 ab.

Beide Aufrufe in `abgleich.rs` bekommen nur die Kopplung dazu; der Ablauf bleibt.

### D4 Ohne Führung je Einsatz kein fremdes Präfix

Geprüft (Auftrag der Aufgabe): Ohne Schalter entsteht kein Spiegel, dessen Kennung nicht mit
der seines Führers beginnt.

- Notübernahme, Übergabe und Anfrage gibt es nur mit Schalter (Spec `instanz-fuehrung`).
- `uebernehme_alle` verwirft eine Lieferung mit fremdem Präfix, wenn `fuehrt_laut_akte` nicht
  greift; ohne Schalter greift es nie.
- Verwahrung: Die erreichte Seite macht aus ihrem Spiegel einen eigenen Einsatz, die meldende
  räumt ihren ab. Einen Spiegel davon hält danach niemand: Der Hub liefert einen abgeschlossenen
  Einsatz nur, wenn ein Gegenüber seinen Stand nennt, und eine andere ELW hätte ihn wegen des
  fremden Präfixes verworfen.

Ohne Schalter ändert sich deshalb nur der engere Altbeleg (D1).

### D5 Neue ADR statt Änderung an ADR-0036

ADR-0036 ist akzeptiert und damit unveränderlich; diese Change weicht nicht von ihr ab, sondern
dehnt den Beleg auf Stände aus und regelt das Abräumen. Eine neue ADR (nächste freie Nummer,
heute `ADR-0039`) hält fest: ein Beleg für Stände und Akten, Art `spiegel` ist kein Beleg, ein
Spiegel endet nur auf Meldung seines Führers (Akte vor Präfix). Prüfung per `verbiete` auf
`ist_geloescht` und `verlange` auf die Führerprüfung in `geloescht_uebernehmen`. Laufzeitsicht
(Kapitel 6, Lebensende) und Glossar („Löschvermerk“) ziehen nach, ebenso `src/AGENTS.md`.

## Risks / Trade-offs

- **Falsches Abräumen ist unumkehrbar** → drei Bedingungen zugleich: Beleg beim Absender
  (Vermerk oder Altbestand, nie „kenne ich nicht“), Spiegel dieser Kopplung, Absender ist
  Führer laut Akte. Eine aus einer Sicherung zurückgekehrte Instanz hat weder Vermerk noch
  Protokolleintrag und meldet nichts.
- **Schalter nach einer Übernahme ausgeschaltet** → ein Spiegel mit fremdem Präfix endet dann
  nicht auf `geloescht`; an der meldenden Seite räumt ihn Phase R nach der Nachbereitung ab, an
  der erreichten bleibt er wie heute. Folgt der eingefrorenen Führung (LLH-1704).
- **Eine Runde mehr je Abgleich, wenn die erreichte Seite ablehnt** (Review vor dem PR, mit
  Ruben am 13.11.2026 als hinnehmbar entschieden) → Führt die meldende Seite einen übernommenen
  Einsatz mit fremdem Präfix und löscht ihn, belegt sie das Ende im Push; nimmt die erreichte
  Seite es nicht an (Schalter dort nach der Übernahme aus, oder eine ältere Version beim
  gestaffelten Update), nennt sie den Stand weiter, und jeder Abgleich dieser Kopplung braucht eine
  zusätzliche signierte Runde (`geloescht_offen` in `abgleich_einmal`, gedeckelt durch
  `RUNDEN_MAX`). Kein Datenverlust; die Lage endet mit dem Update oder dem Einschalten. Eine
  Merkliste abgelehnter Meldungen wäre neuer Zustand, der veralten kann.
- **Gemischter Betrieb** → eine ältere Instanz meldet für fremde Präfixe nichts und nimmt sie
  nicht an; der Spiegel bleibt dort wie heute. Eine ältere Instanz meldet weiter über Art
  `spiegel`; eine neue Gegenseite nimmt das nur an, wenn die Akte den Absender als Führer nennt.
- **Engerer Altbeleg verliert eine richtige Meldung** → nur für einen Spiegel mit eigenem
  Präfix, den diese Instanz vor dem Vermerk (vor `0343`, 12.11.2026) auf `geloescht` hin
  abgeräumt hat und den ein Dritter noch nennt. Vernachlässigbar.

## Migration Plan

- Keine Migration, kein neues Feld. Rückweg: der Stand davor.
- Vor dem Push `git fetch origin alpha` und die ADR-Nummer prüfen
  (`scripts/check-adr-nummern.sh`).
