# Design

## Context

Das Verfahren aus LLH-1493 (`openspec/changes/archive/2026-11-09-ca8v0psv-stammdaten-verteilung/design.md`,
D1–D9) trägt: Eine Art ist ein Eintrag in `instanz::stammdaten::art::BESCHREIBUNGEN` plus Log- und
Schutz-Trigger (Muster `migrations/0306`). Liefern und Übernehmen lesen nur die Beschreibung, die
Oberfläche fragt `GET /api/instanz/stammdaten/herkunft` und sperrt per `VomHubGesperrt`.

Die acht neuen Kataloge passen fast unverändert hinein. Drei Eigenschaften kennt das Verfahren
aber noch nicht:

- `sprechgruppe` hält Org-Katalog und einsatz-lokale Gruppen in einer Tabelle (`einsatz_id`).
- Sprechgruppen sind erst über Betriebsart **und** Bezeichnung eindeutig.
- `schichtmodell.ist_vorgabe` und `org_externe_stelle.zustaendig` sind je Org einmalig
  (Teilindex). Eine lokale und eine gelieferte Markierung kollidieren.

Dazu kommt ein Reihenfolgefall: `schichtmodell::repo::delete` nimmt das Modell erst aus den
Einsatz-Vorlagen, dann löscht es. Am ELW übernimmt der Rang Schichtmodelle vor Einsatz-Vorlagen;
die Löschung scheitert am Fremdschlüssel (`einsatz_vorlage.schichtmodell_id` ohne ON-DELETE-Aktion),
bevor die geänderte Vorlage den Verweis löst.

## Goals / Non-Goals

**Goals:**

- Acht Arten mit demselben Verfahren, ohne zweiten Liefer- oder Übernahmeweg.
- Die drei neuen Eigenschaften als Felder der Beschreibung, nicht als Sonderfall je Tabelle.

**Non-Goals:**

- Einsatzbezogene Kopien (`einsatz_schichtmodell`, `einsatz_unterkunft_richtwert`, einsatz-lokale
  Sprechgruppen) werden nicht verteilt.
- `demo_herkunft` wird nicht verteilt: Ein Demo-Schichtmodell vom Hub ist am ELW ein gewöhnliches
  Modell vom Hub.
- Kein Antragsweg vom ELW an den Hub (LLH-1492).

## Decisions

### D1 Arten, Wire-Werte und Rang

Neue Werte von `StammdatenArt`, in dieser Reihenfolge hinter `einheit_vorlage` (wer verwiesen
wird, kommt vorher):

| Art (Wire) | Tabelle | Schlüssel | Natürlich | Verweise / Unterliste | Stilllegen |
|---|---|---|---|---|---|
| `schichtmodell` | `schichtmodell` | id | `bezeichnung` | — | — (hart) |
| `einsatz_vorlage` | `einsatz_vorlage` | id | `bezeichnung` | `schichtmodell_id → schichtmodell`; Unterliste `einsatz_vorlage_modul_aus (vorlage_id; modul_key)` | — (hart) |
| `stichwort_vorschlag` | `einsatz_stichwort_vorschlag` | id | `text` | `vorlage_id → einsatz_vorlage` | — (hart) |
| `verpflegung_vorlage` | `verpflegung_vorlage` | id | `bezeichnung` | — | `aktiv = 0` |
| `sprechgruppe` | `sprechgruppe` | id | `betriebsart` + `bezeichnung` | — | `aktiv = 0` |
| `etb_baustein` | `etb_baustein` | id | `label` | — | `aktiv = 0` |
| `externe_stelle` | `org_externe_stelle` | id | `bezeichnung` | — | `aktiv = 0` |
| `unterkunft_richtwert` | `org_unterkunft_richtwert` | Spalte `schluessel` | (Schlüssel) | — | — (hart) |

Spalten sind alle fachlichen Spalten ohne `id`, `org_id` und Zeitstempel. Ausnahme:
`org_unterkunft_richtwert.geaendert_at` ist `NOT NULL` ohne Vorgabe, deshalb geht der Zeitpunkt
des Hubs mit (Alternative „Vorgabewert je Art beim Einfügen“ verworfen: ein neues Feld für eine
Spalte). `geaendert_von` bleibt draußen (Konto-id der Quelle, nur dort gültig).

Die Unterliste `einsatz_vorlage_modul_aus` hat keinen Verweis; `apply_verweise` fügt sie ohne
Übersetzung ein. Modulschlüssel gehen roh durch. Kennt der ELW einen Schlüssel nicht (ältere
Version), wirkt die Ausblendung dort nicht, schadet aber auch nicht.

### D2 Teilmenge einer Tabelle (`bereich`)

Neues Feld `bereich: Option<&'static str>`, eine SQL-Bedingung über Spalten der Tabelle
(`einsatz_id IS NULL` bei Sprechgruppen). Sie gilt an vier Stellen:

- Log-Trigger: `WHEN NEW.einsatz_id IS NULL` bzw. `OLD.…` (Änderung, Anlage, Löschung). Ein
  `UPDATE`, das zwischen Katalog und Einsatz wechselt, kommt im Code nicht vor; der Trigger
  loggt trotzdem beide Seiten, die nicht passende wird beim Liefern zur Löschung.
- Grundstock der Migration: nur Zeilen im Bereich.
- `liefern::load_daten`: `WHERE … AND (<bereich>)`. Eine Zeile außerhalb gilt als nicht
  vorhanden, also als Löschung (wie Gerätekonten).
- Erster Abgleich in `uebernehmen::upsert`: nur Zeilen im Bereich.

Die Schutz-Trigger brauchen ihn nicht: Eine einsatz-lokale Gruppe hat nie eine Herkunft.
Alternative eigene Art mit Sicht (`VIEW`) verworfen: Trigger an Sichten sind `INSTEAD OF`, und der
Schutz sitzt an der Tabelle.

### D3 Natürlicher Schlüssel aus mehreren Spalten

`natuerlich: Option<&str>` wird `natuerlich: &'static [&'static str]` (leer = nie abgleichen). Der
Abgleich verlangt jeden Wert als nicht leeren Text und vergleicht jede Spalte mit `=`. Die zwölf
bestehenden Einträge ziehen mechanisch mit; der Guard prüft weiter, dass jede Spalte in `spalten`
steht.

### D4 Exklusive Markierung folgt dem Hub (Entscheidung 09.11.2026)

Neues Feld `exklusiv: Option<&'static str>` (`ist_vorgabe`, `zustaendig`). Trägt die gelieferte
Zeile dort `1`, setzt `upsert` vor dem Schreiben die Markierung aller anderen Zeilen derselben Org
(im Bereich) auf `0`. Das trifft auch eine Zeile vom Hub; das ist richtig, denn auch am Hub kann
nur eine sie tragen, und die Änderung dort kommt ohnehin mit.

Alternative „Hub-Zeile bleibt mit Hinweis draußen“ (bisheriges Verhalten bei jeder Regelverletzung)
verworfen: Dann fehlten am ELW das ganze Modell bzw. die Stelle und alle Verweise darauf, bis ein
Admin dort eine Markierung löst, die er im Einsatz nicht vermutet.

### D5 Nachgeholte Löschung (Entscheidung 09.11.2026)

`delete_zeile` bekommt einen Modus: Im ersten Durchgang landet eine am Fremdschlüssel gescheiterte
Löschung (Rollback des Savepoints) in einer Liste. Nach den Upserts und dem Verweis-Durchgang
läuft diese Liste in **umgekehrter** Rangfolge ein zweites Mal, jetzt mit dem bisherigen Ausgang
(stilllegen bzw. Herkunft lösen). Konten, `Schluessel::Spalte` und `Schluessel::Org` sind davon
nicht betroffen (kein Fremdschlüssel-Fall).

Solange eine Löschung wartet, trägt die Zeile noch ihre Herkunft. Legt die Quelle im selben Paket
eine Zeile mit demselben natürlichen Schlüssel neu an (gelöscht und gleich wieder angelegt), darf
der erste Abgleich die wartende Zeile übernehmen: Sie bekommt die neue Herkunft, ihre Löschung
entfällt, und Einsatzdaten zeigen weiter auf sie, wie vor dieser Change, als die Zeile sofort
stillgelegt und dann abgeglichen wurde. Unter mehreren Kandidaten gewinnt eine nicht stillgelegte
Zeile vor einer stillgelegten (Review 09.11.2026: Sprechgruppen und Mahlzeiten sind nur unter
aktiven Zeilen eindeutig).

Alternative „alle Löschungen nach den Upserts“ verworfen: Sie ändert für jede Art die Reihenfolge,
und ein am Hub gelöschtes und mit gleichem Namen neu angelegtes Fahrzeug liefe in die Eindeutigkeit
des Namens. Der zweite Versuch ändert nur den Fall, der bisher in einer Leiche endete.

### D6 Oberfläche

Kein `KatalogVerwaltung` unter den acht Reitern; jeder bekommt dasselbe Muster wie `FahrzeugeTab`:
`HerkunftAbzeichen` neben der Bezeichnung (nur, solange die Org eine Quelle hat) und
`VomHubGesperrt` statt der Aktionen. Sonderfälle:

- `StichworteTab`: auch die eingebettete Vorlagen-Auswahl ist bei „vom Hub“ gesperrt.
- `SchichtmodelleTab`: auch „Als Vorgabe setzen“ und „Vorgabe aufheben“ eines Modells vom Hub.
  Ist die Vorgabe vom Hub, bietet kein eigenes Modell „Als Vorgabe setzen“ an: der Wechsel höbe
  die Vorgabe vom Hub auf, und das lehnt der Server ab (D4: die Vorgabe folgt dem Hub).
- `SprechgruppenTab`: nur der Katalog; die Sprechgruppen im Einsatz bleiben unberührt.
- `UnterkunftRichtwerteTab`/`RichtwerteListe`: Sperre und Abzeichen je Schlüssel; ein nicht
  gesetzter Schlüssel bleibt setzbar und trägt kein Abzeichen, „nur hier“ nur ein hier gesetzter. Die Ebene „Organisation“ der bestehenden Herkunftsanzeige
  (Basis/Organisation/Einsatz) bleibt; das Abzeichen „vom Hub“ steht daneben.

## Risks / Trade-offs

- [Neue Arten an einem nicht aktualisierten ELW] → Der Hub liefert nur Arten, die die Meldung
  nennt (D2 der Vorgänger-Change); erst nach dem Update startet die Nachlieferung bei 0.
- [Großer Grundstock nach dem Update, alle acht Arten auf einmal] → Budget der Antwort und
  Nachlieferung über mehrere Meldungen wie bisher.
- [Stilllegen einer Externen Stelle, die zuständig ist, verletzt deren CHECK] → Der Hub löscht
  Externe Stellen nie hart, also kommt keine Löschung an. Der Fall bleibt ungetestet; gäbe es ihn,
  bräche die Übernahme mit Fehler statt still.
- [`exklusiv` ändert Zeilen vom Hub ohne Lieferung] → Nur die Markierung, und nur dorthin, wo der
  Hub selbst schon steht.

## Migration Plan

Eine neue Migration (Nummer über jeder auf `alpha`, Stand heute `0311`), rein additiv: Trigger für
neun Tabellen (acht Arten plus Unterliste), Grundstock ins Änderungslog. Rücknahme: die Trigger
fallen mit einer Folgemigration; das Log stört ohne Trigger nicht.
