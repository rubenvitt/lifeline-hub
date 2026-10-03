# Design

## Context

LFH-751 führt je Personenart, über welche Spalte eine Zeile zur Person gehört
(`PERSONENBEZUEGE`), und markiert ihre Scrub-Spalten `Mit`/`Ohne`. `scrubbe_person` erzeugt
daraus UPDATEs; `ZeileLoeschen` ist dort ausdrücklich verboten. LFH-757 bringt mit
`einsatz_person_anhang` den ersten Linker mit Personenverweis, den die Registry nur ganz löscht.

## Decisions

### D1 — Zweite Liste statt Ausnahme im Markierungs-Guard

`PERSONENANHAENGE: &[PersonenAnhaenge { art, tabelle, bezug, anhang }]` neben
`PERSONENBEZUEGE`. Die Markierungs-Guards bleiben unverändert streng (kein `ZeileLoeschen` im
Spalten-Scrub); GUARD 1 akzeptiert einen Verweis aus einer der beiden Listen und prüft auch die
`anhang`-Spalte als echte Kante. GUARD 4: jede Spalte der Tabelle ist `ZeileLoeschen`, die Tabelle
steht nicht zugleich in `PERSONENBEZUEGE`, die `anhang`-Kante trägt `ON DELETE CASCADE`.

*Verworfen:* `Ohne`-Markierung für den ganzen Linker (Dateien blieben trotz Antrag — gegen die
Entscheidung). Ein Variantenfeld in `PersonenBezug` (bläht alle ~25 Einträge auf).

### D2 — Löschen über die Datei

`DELETE FROM anhang WHERE id IN (SELECT anhang FROM tabelle WHERE <Einsatz-Scoping> AND bezug = ?)`.
Die Datei liegt in `anhang.daten`; die Verknüpfung geht per CASCADE mit, wie bei der
Einsatz-Schwärzung. Kein Filter auf `geloescht_at`: auch eine entfernte Datei liegt noch vor.
Läuft in der Transaktion des Vollzugs, atomar mit Kennzeichen und Audit.

### D3 — Was bleibt

Die ETB-Vermerke „Person R-007: Foto abgelegt/entfernt“ nennen weder Datei noch Namen
(LFH-757 D5) und bleiben wie jede ETB-Zeile; die Zeilen der Art `anhang` im Zugriffsprotokoll
bleiben (Retain, wie bei der Einsatz-Schwärzung).

### D4 — Migrationsnummer

Wie PR #379: Der später gemergte Linker weicht auf die nächste freie Nummer aus (0142), Inhalt
unverändert; der Rebuild 0141 bleibt. Die Reihenfolge Rebuild vor Linker ist unschädlich, weil der
Linker auf `einsatz_person` verweist, nicht auf `person_zugriff_audit`. `check-migrationen.sh`
meldet die Umbenennung einer `alpha`-Migration — gewollt, wie in PR #379.

## Risks / Trade-offs

- Eine Datenbank, die `alpha` mit doppelter 0140 eingespielt hätte, gibt es nicht: der Start
  scheitert dort an `_sqlx_migrations.version`; `1.0.0-alpha.68` enthält keine der beiden.
