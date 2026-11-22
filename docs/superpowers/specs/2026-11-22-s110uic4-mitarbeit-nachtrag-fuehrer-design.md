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
Handgriff. Eine Rolle, die die Einsatzleitung an O gesetzt hat, nachdem O die Rolle `mitarbeit`
kennt, bleibt unangetastet, und N folgt ihr.

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
- Ein Nachtrag überschreibt eine Rolle, die die Einsatzleitung an O gesetzt hat, als O
  `mitarbeit` schon kannte, auch wenn sie dabei `beobachter` gewählt hat.
- O und N bleiben nach einem Nachtrag uneinig (das war der Grund gegen B).
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
diese Kopplung, nur wenn das Gegenüber die Fähigkeit meldet. Unquittierte gehen im nächsten
Abgleich erneut hinaus; die Annahme ist dafür gebaut (D4, Bedingung 5). `SpiegelPaket::check` begrenzt die
Anzahl (Höchstzahl wie bei Hinweisen: Wert dem Builder überlassen, ein Paket muss die
vorhandenen Grenzen weiter einhalten). Quittungen löschen die Ausgangszeilen
(Muster `hinweis::quittiert`).

### D4 Annahme (O, Führer)

**Grenze „O kennt die Rolle“:** Beim eigenen Wechsel 0 → 1 in `repo::save_rolle_mitarbeit`
(O lernt, dass N die Rolle kennt) merkt O sich den höchsten Stand des Logs (`einsatz_aenderung.stand`
ist ein globaler Zähler, `AUTOINCREMENT`) als neue Spalte
`instanz_kopplung.mitarbeit_grenze_stand` (dieselbe Migration wie D2). Was an O vor dieser Grenze
an einer Mitgliedschaft geschah, konnte `mitarbeit` nicht ausdrücken und gilt nicht als bewusste
Wahl. *Eigene Festlegung* (Befund aus dem Gegenlesen): Eine Bearbeitung an der noch alten O,
etwa der Führungsstelle, hat `beobachter` nur mitgeschickt; N hat dabei `mitarbeit` behalten.
Mit der Grenze bei `uebernommen_stand` (erster Entwurf) hätte O den Nachtrag abgelehnt und beide
wären uneinig geblieben.

In der Schreibtransaktion des Abgleichs, nach den Zeilen (`uebernehme_alle`). Für jeden
Nachtrag:

0. **Kennt O die Fähigkeit von N noch nicht** (`gegenueber_rolle_mitarbeit = 0` an O, etwa weil
   O meldet und die Antwort mit der Fähigkeit noch nicht verarbeitet hat): nichts tun, **nicht
   quittieren**. Sonst ginge die angehobene Rolle über `herabstufen_fuer` als `beobachter` an N,
   und N (Fähigkeit 1) stufte wirklich herab. N schickt den Nachtrag im nächsten Abgleich erneut.

Sonst hebt O die Mitgliedschaft an, wenn **alle** gelten:

1. Der Einsatz mit dieser `kennung` ist hier eigen (`einsatz.spiegel = 0`).
2. Die Führung kam von dieser Kopplung: `einsatz_fuehrung.herkunft_kopplung_id = kopplung.id`.
   Die Spalte setzt `spiegel::fuehrung::werde_fuehrer` bei jedem Übergang Spiegel → Führer,
   also bei Rückgabe, Übergabe und Notübernahme gleichermaßen; sie bestand schon an der alten O
   (Migration 0321).
3. Die Mitgliedschaft lässt sich auflösen: über `gegen`, sonst über `spiegel_herkunft` (O hat
   den Schlüssel von N als `fremder_schluessel`, aus der Zeit, als O Spiegel war).
4. Sie steht hier auf `beobachter`.
5. **Seit der Grenze unverändert:** kein Eintrag in `einsatz_aenderung` für diese Zeile mit
   `stand > instanz_kopplung.mitarbeit_grenze_stand`. Ist die Grenze leer (die Kopplung kannte
   die Fähigkeit schon vor dieser Migration, Nachträge kann es dann nicht geben), gilt 5 als
   nicht erfüllt. Hat die Einsatzleitung an O sie bearbeitet,
   nachdem O die Rolle kannte (auch auf `beobachter`), bleibt sie. Das deckt auch einen
   wiederholten Nachtrag: Nach dem Anheben liegt die Zeile über der Grenze.

Dann `UPDATE einsatz_mitgliedschaft SET einsatz_rolle = 'mitarbeit'` über den gewöhnlichen
Trigger: Die Änderung landet im Log und geht im nächsten Abgleich als `mitarbeit` an N.

**Abgelehnt, aber auflösbar** (1–3 gelten, 4 oder 5 nicht): O legt die Zeile neu ins Log (wie
`resend_mitarbeit`: alte Logzeile weg, neue mit frischem Stand), damit N den Wert von O
übernimmt. N kennt die Fähigkeit von O, `keep_mitarbeit` greift also nicht mehr. So bleiben
beide nie uneinig. Abgelehnt, weil 1–3 nicht gelten: nichts tun.

Steht die Mitgliedschaft schon auf `mitarbeit` (ein wiederholter Nachtrag, weil eine Quittung
verloren ging), quittiert O nur, ohne Neu-Log. *Beim Planen ergänzt.*

Jeder Nachtrag außer Fall 0 wird quittiert.

Die Migration 0358 baut `einsatz_mitgliedschaft` vor dem Anlegen der Trigger neu; das Aufrüsten
von O schreibt also keine Logzeilen.

**Auslieferung:** LLH-1817 ist noch nicht auf `main`. Der Wechsel 0 → 1 geschieht nur einmal;
eine Instanz, die mit einem Stand ohne diesen Nachtrag aufgerüstet wurde, merkt ihn nie vor.
Deshalb muss diese Änderung im selben Release wie LLH-1817 hinausgehen, also vor dem nächsten
Schnitt von `alpha` nach `main` gemergt sein.

**Außerhalb:** Die Verwahrung (`lebensende`, nach der Nachbereitung) ruft `werde_fuehrer` nicht
und löscht `spiegel_herkunft`; Bedingungen 2 und 3 schlagen dort fehl. Gewollt: Nach der
Nachbereitung erfasst niemand mehr, die Rolle spielt keine Rolle. *Eigene Festlegung.*

### D5 Spur

Ein angehobener Nachtrag schreibt eine `tracing::info!`-Zeile (Einsatz, Kopplung). Der Einsatz
geht in `Uebernommen`, damit Clients an O wie bei jeder Übernahme neu laden. Kein ETB-Eintrag:
eine Mitgliedschaftsänderung schreibt auch sonst keinen. *Eigene Festlegung.*

### D6 Test mit echtem Rollentausch

In `tests/instanz_fuehrung.rs`: Dort laufen zwei echte Instanzen mit Führung über HTTP
(`gekoppelt_mit`, `elw_meldet`, `abgleichen`, `hub_uebernimmt_mit_unterschrift`). Die
Mitarbeit-Tests von LLH-1817 in `src/instanz/spiegel/tests.rs` bauen nur zwei nackte Pools ohne
Akten und können keinen Führungswechsel. *Eigene Festlegung.*

Eine alte Instanz gibt es im Test nicht; „alt“ heißt dort: Die Fähigkeit ist auf beiden Seiten 0
und wird nach jedem Melden wieder auf 0 gesetzt, bis zum „Aufrüsten“ (wie es genau gelingt,
entscheidet der Builder; der Führungswechsel selbst läuft echt über die Routen). Ablauf: Die
Instanz N führt, Mitgliedschaft `mitarbeit`. N gibt die Führung an O zurück, O führt mit
`beobachter`, N hält `mitarbeit`. Dann „Aufrüsten“, melden, abgleichen. Erwartet:

- O hat `mitarbeit`, N hat `mitarbeit`, der Ausgang an N ist leer.
- Gegenprobe 1: Bearbeitet die Einsatzleitung an der noch alten O die Führungsfunktion, wird
  trotzdem angehoben (vor der Grenze).
- Gegenprobe 2: Bearbeitet die Einsatzleitung an O die Mitgliedschaft nach der Grenze (auf
  `beobachter`), bleibt sie `beobachter`, und N folgt (Neu-Log aus D4).
- Gegenprobe 3: Ein Nachtrag, während O die Fähigkeit von N noch nicht kennt, bleibt
  unquittiert und wirkt im nächsten Abgleich.
- Bedingung 2 (Führung von anderer Kopplung) als Unit-Test an der Annahme, falls ein dritter
  Partner im Integrationstest zu aufwendig ist.
- Dieselbe Folge mit Notübernahme statt Rückgabe, wenn die Helfer sie ohne großen Umbau hergeben
  (`hub_uebernimmt_mit_unterschrift` liegt vor); sonst ein Satz im Plan, warum Bedingung 2 beide
  abdeckt.

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
besonders die Anti-Ziele: keine Anhebung außer unter D4 0–5, keine Wiederholung, kein
dauerhaftes Auseinanderlaufen.
