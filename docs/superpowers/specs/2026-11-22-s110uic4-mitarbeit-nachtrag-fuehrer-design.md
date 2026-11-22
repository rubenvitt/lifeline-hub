# Mitarbeit nach Rückgabe an eine alte Instanz nachtragen — Design

Zunder: https://zunder.rubeen.dev/#/aufgabe/s110uic4zxjbai171xkgekqj (LLH-2007)
Stand: 22.11.2026 · Route `entwurf` (E1 Entscheidung) · Folge aus LLH-1817
(`2026-11-19-yd9hmb6c-einsatzrolle-mitarbeit-design.md`, D7)

## Warum

LLH-1817 hat die Einsatzrolle `mitarbeit` eingeführt. Eine ältere Instanz kennt sie nicht: Ihr
bekommt eine Mitgliedschaft `mitarbeit` als `beobachter` (`liefern::herabstufen_fuer`), und
kommt von ihr `beobachter` zurück, hält die neue Instanz ihre `mitarbeit` fest
(`uebernehmen::keep_mitarbeit`). Das trägt, solange die alte Instanz alt bleibt.

**Der Restfall:** Die neue Instanz N führt einen Einsatz, eine Person hat dort `mitarbeit`. N
gibt die Führung an die alte Instanz O zurück (oder O übernimmt per Notübernahme). O führt mit
`beobachter`, N hält als Spiegel `mitarbeit`. Dann wird O aufgerüstet:

- Beide Seiten lernen die Fähigkeit des Gegenübers (`repo::save_rolle_mitarbeit`, 0 → 1).
  `resend_mitarbeit` liefert aber nur Mitarbeiten aus Einsätzen nach, die die Instanz selbst
  führt (`einsatz.spiegel = 0`). An O gibt es keine, und N führt den Einsatz nicht.
- `keep_mitarbeit` greift nicht mehr, weil O die Fähigkeit jetzt meldet.
- Ändert O die Mitgliedschaft danach (auch nur Führungsstelle oder -funktion), geht
  `beobachter` an N und stuft die Person dort herab. Schon vorher lehnt O jeden Antrag dieser
  Person ab, weil O sie als Beobachter führt.

Die Rolle, die die Einsatzleitung an N gesetzt hat, geht also verloren, ohne dass jemand sie
geändert hat.

**Erfolg:** Nach dem Aufrüsten von O hat die Person an O und an N wieder `mitarbeit`, ohne
Handgriff. Eine Rolle, die die Einsatzleitung an O nach der Übernahme bewusst gesetzt hat,
bleibt unangetastet.

## Ziele, Nicht-Ziele, Anti-Ziele

**Ziele**
- N meldet O beim Wechsel der Fähigkeit die Mitgliedschaften, die N als `mitarbeit`
  festgehalten hat; O stellt sie unter engen Bedingungen wieder her.
- Ein Test mit echtem Rollentausch (Führung N → alte O → O aufgerüstet), den es bisher nicht
  gibt.

**Nicht-Ziele**
- Kein allgemeiner Weg, auf dem ein Spiegel Zeilen des Führers ändert. Der Nachtrag kennt genau
  einen Übergang: `beobachter` → `mitarbeit` einer Mitgliedschaft.
- Keine Oberfläche. Kein Hinweis an Menschen.
- Kein Protokoll-Bump (wie D7 von LLH-1817).

**Anti-Ziele** (wäre ein Fehlschlag, auch wenn es technisch läuft)
- Eine gekoppelte Instanz kann am Führer beliebige Beobachter zu Mitarbeit anheben.
- Ein Nachtrag überschreibt eine Rolle, die die Einsatzleitung an O nach der Übernahme bewusst
  gesetzt hat, auch wenn sie dabei `beobachter` gewählt hat.
- Ein Nachtrag wirkt mehr als einmal (später wiederholt, nachdem O die Rolle geändert hat).

## Ansätze

Am 22.11.2026 mit Ruben abgestimmt (Phase-1-Checkpoint), gewählt: **A**.

- **A — Nachtrag Spiegel → Führer beim Wechsel der Fähigkeit (gewählt).** N merkt sich beim
  Wechsel 0 → 1 die festgehaltenen Mitarbeiten, schickt sie im Abgleich, O hebt nur unter den
  Bedingungen unten an und quittiert. Einziger Weg, der die gesetzte Rolle wiederherstellt.
  Kostet ein additives Paketfeld, eine Tabelle und Logik auf beiden Seiten.
- **B — N hält `mitarbeit` weiter fest.** Klein, ohne Wire. O bleibt aber Beobachter und lehnt
  jeden Antrag der Person ab; beide Instanzen bleiben uneinig, und O kann „Beobachter“ nicht
  bewusst bestätigen. Verworfen.
- **C — Bekannte Grenze.** Nur Test und Doku, die Einsatzleitung an O setzt die Rolle von Hand.
  Verworfen: Niemand erfährt, dass etwas zu tun ist.
- Erwogen und verworfen: den Nachtrag als gewöhnlichen Antrag (`spiegel::antrag`) im Namen einer
  Person stellen. Ein Antrag läuft als Konto durch die Route und braucht dessen Recht am Führer;
  die Mitgliedschaft ändert nur die Einsatzleitung, und der Nachtrag hat keinen Menschen, der ihn
  stellt.

## Entwurf

### D1 Wer etwas nachzutragen hat (N, Spiegel)

Beim Wechsel 0 → 1 in `repo::save_rolle_mitarbeit` (neben `resend_mitarbeit`) merkt N sich
jede Mitgliedschaft mit `einsatz_rolle = 'mitarbeit'` in einem Einsatz, den N **über diese
Kopplung spiegelt** (`einsatz.spiegel = 1`, `einsatz_spiegel.kopplung_org_id` gehört zu einer
aktiven Org der Kopplung).

Keine eigene Markierung in `keep_mitarbeit` nötig: Solange der Führer die Fähigkeit nicht
kannte, konnte er `mitarbeit` nie liefern. Eine Mitgliedschaft `mitarbeit` in einem Spiegel
dieses Führers gibt es also nur, weil `keep_mitarbeit` sie festgehalten hat.

Der Wechsel steht in der Bedingung des UPDATE (wie heute); also wird genau einmal vorgemerkt.

### D2 Ausgang (N)

Neue Tabelle `mitarbeit_nachtrag` (Migration, Nummer nach `migrations/AGENTS.md`):

| Spalte | Bedeutung |
|---|---|
| `id` | Kennung, die O quittiert |
| `kopplung_id` | `REFERENCES instanz_kopplung(id) ON DELETE CASCADE` |
| `einsatz_id` | `REFERENCES einsatz(id) ON DELETE CASCADE` |
| `schluessel` | Schlüssel der Mitgliedschaft bei N (`json_array(einsatz_id, benutzer_id)`) |
| `angelegt_at` | Zeitpunkt des Vormerkens |

`UNIQUE (kopplung_id, einsatz_id, schluessel)`. Eine Zeile bleibt, bis O sie quittiert. Endet
der Spiegel, verschwindet sie mit dem Einsatz.

### D3 Wire

`SpiegelPaket` bekommt zwei Felder, beide `#[serde(default)]` (eine ältere Gegenseite überliest
sie, `paket.rs` Kopf):

- `mitarbeit_nachtraege: Vec<MitarbeitNachtrag>` — `{ id, kennung, schluessel, gegen }`:
  Kennung der Ausgangszeile, Einsatz beim Führer (`einsatz.kennung`), Schlüssel der Mitgliedschaft
  beim Absender, und `gegen` = Schlüssel beim Führer, wenn N ihn kennt (Herkunft der Zeile, wie
  `Zeile.gegen` und `fuehrung::gegen_hinaus`).
- `mitarbeit_quittungen: Vec<i64>` — die Kennungen, die der Führer verarbeitet hat, ob er
  angehoben hat oder nicht.

Beide Richtungen tragen beide Felder: N kann meldende oder erreichte Seite sein. N schickt
offene Nachträge in jeder Anfrage (`abgleich_einmal`) und jeder Antwort (`handle_abgleich`) an
diese Kopplung, nur wenn das Gegenüber die Fähigkeit meldet. `SpiegelPaket::check` begrenzt die
Anzahl (Höchstzahl wie bei Hinweisen: Wert dem Builder überlassen, ein Paket muss die
vorhandenen Grenzen weiter einhalten). Quittungen löschen die Ausgangszeilen
(Muster `hinweis::quittiert`).

### D4 Annahme (O, Führer)

In der Schreibtransaktion des Abgleichs, nach den Zeilen (`uebernehme_alle`). Für jeden
Nachtrag hebt O die Mitgliedschaft nur an, wenn **alle** gelten:

1. Der Einsatz mit dieser `kennung` ist hier eigen (`einsatz.spiegel = 0`).
2. Die Führung kam von dieser Kopplung: `einsatz_fuehrung.herkunft_kopplung_id = kopplung.id`.
   Die Spalte setzt `spiegel::fuehrung::werde_fuehrer` bei jedem Übergang Spiegel → Führer,
   also bei Rückgabe, Übergabe und Notübernahme gleichermaßen; sie bestand schon an der alten O.
3. Die Mitgliedschaft lässt sich auflösen: über `gegen`, sonst über `spiegel_herkunft` (O hat
   N's Schlüssel als `fremder_schluessel`, als O noch Spiegel war).
4. Sie steht hier auf `beobachter`.
5. **Seit der Übernahme hier unverändert:** kein Eintrag in `einsatz_aenderung` für diese Zeile
   mit `stand > einsatz_fuehrung.uebernommen_stand`. Hat die Einsatzleitung an O sie nach der
   Übernahme bearbeitet (auch auf `beobachter`), bleibt sie. Das deckt auch einen verspäteten
   oder wiederholten Nachtrag.

Dann `UPDATE einsatz_mitgliedschaft SET einsatz_rolle = 'mitarbeit'` über den gewöhnlichen
Trigger: Die Änderung landet im Log und geht im nächsten Abgleich als `mitarbeit` an N (die das
übernimmt, weil O die Fähigkeit meldet). Jeder Nachtrag wird quittiert, angehoben oder nicht.

Die Migration 0358 baut `einsatz_mitgliedschaft` vor dem Anlegen der Trigger neu; das Aufrüsten
von O schreibt also keine Logzeilen, und Bedingung 5 gilt nach dem Aufrüsten weiter. Der Test
belegt das mit einem Stand vor 0358 nicht, weil er das Aufrüsten über die Fähigkeit nachstellt
(D6); die Begründung steht im Code-Kommentar.

### D5 Spur

Ein angehobener Nachtrag schreibt eine `tracing::info!`-Zeile (Einsatz, Kopplung). Der Einsatz
geht in `Uebernommen`, damit Clients an O wie bei jeder Übernahme neu laden. Kein ETB-Eintrag:
eine Mitgliedschaftsänderung schreibt auch sonst keinen. *Eigene Festlegung.*

### D6 Test mit echtem Rollentausch

In `src/instanz/spiegel/tests.rs` (dort stehen die Mitarbeit-Tests von LLH-1817 mit zwei
Instanzen): Instanz N führt, Mitgliedschaft `mitarbeit`; O ohne Fähigkeit (Spalte 0). N gibt
die Führung an O zurück (echter Wechsel über die Führung, nicht per SQL gesetzt), O führt mit
`beobachter`, N hält `mitarbeit`. Dann meldet O die Fähigkeit (Wechsel 0 → 1 auf beiden Seiten)
und es folgt ein Abgleich. Erwartet:

- O hat `mitarbeit`, N hat `mitarbeit`, der Ausgang an N ist leer.
- Gegenprobe 1: Bearbeitet die Einsatzleitung an O die Mitgliedschaft vor dem Abgleich (auf
  `beobachter` mit anderer Führungsfunktion), bleibt sie `beobachter`, und N folgt.
- Gegenprobe 2: Ein Nachtrag über eine Kopplung, von der die Führung nicht kam, hebt nicht an.
- Dieselbe Folge mit Notübernahme statt Rückgabe, wenn die Testhelfer das ohne großen Umbau
  hergeben (Builder entscheidet; sonst ein Satz im Plan, warum Bedingung 2 beide abdeckt).

### D7 Doku

- `src/AGENTS.md`, Abschnitt Instanzkopplung: ein Satz zum Nachtrag neben der vorhandenen
  Mitarbeit-Regel (erst prüfen, wo die D7-Regel von LLH-1817 dort steht).
- arc42 `docs/architektur/08-querschnittliche-konzepte.md`: die Mitarbeit-Stelle um den
  Nachtrag ergänzen (Mitänderungsregel in `docs/architektur/AGENTS.md`).
- Anwenderdoku nicht: Für Bedienende ändert sich nichts Sichtbares.

## Dem Builder überlassen

- Name und genaue Höchstzahl der Paketfelder in `check`; Platz im Byte-Budget des Pakets.
- Ob Vormerken, Senden und Annehmen in `liefern.rs`/`uebernehmen.rs` oder einem eigenen Modul
  `spiegel/nachtrag.rs` liegen (Empfehlung: eigenes Modul, wie `hinweis.rs`).
- Die Notübernahme-Variante des Tests (D6).

## Prüfung

Review nötig (Eingaben von außen: Instanzkopplung; Berechtigung: Rolle am Führer). Er prüft
besonders die Anti-Ziele: keine Anhebung außer unter D4 1–5, keine Wiederholung.
