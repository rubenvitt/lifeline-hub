---
id: ADR-0037
titel: Ausgangsereignisse für Fremdsysteme entstehen per Trigger und je Zugang
status: akzeptiert
datum: 2026-11-13
gilt_fuer:
  - src/public_api/events.rs
  - src/public_api/einsaetze.rs
  - migrations/*_maschine_ereignis*.sql
herleitung:
  - openspec/changes/archive/2026-11-13-umeqho2b-outbox-ereignis-abruf/design.md
  - docs/konzepte/2026-11-11-oeffentliche-api.md
---

# ADR-0037: Ausgangsereignisse für Fremdsysteme entstehen per Trigger und je Zugang

## Regeln

- MUST: Jede Zeile der Outbox `maschine_ereignis` entsteht in einem Trigger, in der Transaktion
  der Änderung, die sie auslöst.
- MUST NOT: Ein Schreibweg in Rust fügt in `maschine_ereignis` ein. Rust liest (Abruf
  `GET /api/v1/events`) und löscht (Purge).
- MUST: Eine Zeile gehört genau einem Zugang. Geschrieben wird je Zeile in
  `maschinenzugang_freigabe` zum betroffenen Einsatz, Änderungen (`einsatz.updated`,
  `lage.changed`) nur für gültige Zugänge (nicht widerrufen, „gültig bis“ nicht verstrichen), das
  Ende für jeden Zugang mit Freigabe. Der Abruf liest nur Zeilen des eigenen Zugangs.
- MUST: Ein Ereignis trägt nur Art, Zeitpunkt und Einsatz-ID. Den Inhalt liest das Fremdsystem
  über die Leserouten nach.
- MUST: Ein geschriebenes `einsatz.closed` bleibt bis zum Purge, auch wenn der Einsatz gelöscht
  wird; mit dem Einsatz gehen nur die Zeilen über seinen Inhalt.
- MUST: Von `lage.changed` liegt je Zugang und Einsatz höchstens eine Zeile vor; eine neue
  ersetzt die alte und trägt eine höhere Nummer.
- MUST: Die Kopfspalten (`public_api::einsaetze::KOPF_SPALTEN`) und die Lage-Tabellen
  (`public_api::events::LAGE_ARTEN`, `LAGE_KOPF_SPALTEN`) stehen in Rust und im Trigger. Wer eine
  Liste ändert, baut den Trigger in einer neuen Migration neu.
- MUST: Welche Arten ein Zugang sieht, entscheidet der Abruf nach dessen Scopes
  (`EventType::scope`), nicht der Trigger.
- MUST NOT: `INSERT OR REPLACE` auf `maschinenzugang_freigabe`; es löscht ohne DELETE-Trigger,
  und das Ende der Freigabe bliebe ungemeldet.
- SHOULD: Ein wartender Abruf fragt im Takt nach und hält dazwischen keine Datenbankverbindung;
  geweckt wird er nicht.

## Prüfung

```sh
verbiete 'INSERT (OR [A-Z]+ )?INTO maschine_ereignis' 'src/**/*.rs'
verbiete 'INSERT OR REPLACE INTO maschinenzugang_freigabe' 'src/**/*.rs'
verlange 'CREATE TRIGGER einsatz_aenderung_ereignis_i' 'migrations/*_maschine_ereignis_trigger.sql'
verlange 'pub const KOPF_SPALTEN' src/public_api/einsaetze.rs
verlange 'pub const LAGE_ARTEN' src/public_api/events.rs
verlange '"maschine_ereignis"' src/instanz/spiegel/art.rs
```

## Kontext

ADR-0022 verlangt, dass Ausgangsereignisse in der Transaktion der Änderung in einer Outbox
entstehen. `einsatz` wird aber auf Wegen geschrieben, die sich nicht treffen: Oberfläche,
Spiegel-Übernahme, Verwahrung, Demo-Import. Die Lage hat über 100 Schreibstellen in rund 25
Modulen. Der Abschluss löscht die Freigabe in seiner Transaktion; ein Filter beim Lesen verbärge
deshalb `einsatz.closed`, und eine später erteilte Freigabe meldete sich nicht.

## Konsequenzen

Kein Schreibweg kann ein Ereignis vergessen, auch der Spiegel am Hub nicht. Der Abruf liest ohne
Join, und Webhooks (LLH-1656) lesen je Abo dieselben Zeilen. Der Preis: Die Logik steht in SQL,
eine Änderung braucht eine Migration, und jede Schreibzeile an einer Lage-Tabelle eines
freigegebenen Einsatzes kostet rund 0,2 ms mehr (gemessen in LLH-1655). Der Cursor ist eine
Nummer über alle Zugänge; an seiner Differenz sieht ein Zugang, wie viel anderswo geschieht,
nicht was (hingenommen, Kapitel 11, R40).
