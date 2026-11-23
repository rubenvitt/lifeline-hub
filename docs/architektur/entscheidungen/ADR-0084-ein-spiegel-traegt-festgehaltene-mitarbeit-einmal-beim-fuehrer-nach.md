---
id: ADR-0084
titel: Ein Spiegel trägt festgehaltene Mitarbeit einmal beim Führer nach, der Führer hebt nur unter engen Bedingungen an
status: akzeptiert
datum: 2026-11-22
gilt_fuer:
  - src/instanz/spiegel/nachtrag.rs
  - migrations/0364_mitarbeit_nachtrag.sql
herleitung:
  - docs/superpowers/specs/2026-11-22-s110uic4-mitarbeit-nachtrag-fuehrer-design.md
---

# ADR-0084: Ein Spiegel trägt festgehaltene Mitarbeit einmal beim Führer nach, der Führer hebt nur unter engen Bedingungen an

## Regeln

- MUST: Ein Spiegel merkt Mitgliedschaften `mitarbeit` nur beim Wechsel der Fähigkeit
  `rolle_mitarbeit` des Gegenübers von 0 auf 1 vor (`repo::save_rolle_mitarbeit`), und nur in
  Einsätzen, die er über diese Kopplung spiegelt.
- MUST: Ein Führer hebt auf einen Nachtrag hin nur `beobachter` auf `mitarbeit`, nur wenn er den
  Einsatz führt, die Führung von der Kopplung des Absenders kam (`herkunft_kopplung_id`) und die
  Zeile seit `instanz_kopplung.mitarbeit_grenze_stand` unverändert ist. Die Grenze ist der Stand,
  ab dem der Führer `mitarbeit` kennt (für Kopplungen von vor dem Aufrüsten die Migration 0363);
  ein späterer Wechsel der Fähigkeit verschiebt sie nicht.
- MUST NOT: Ein Nachtrag ändert an der Mitgliedschaft keine andere Spalte und keine andere Rolle
  und schreibt in keine andere Tabelle als `einsatz_mitgliedschaft` und das Änderungslog
  `einsatz_aenderung` (Neu-Log, nächste Regel).
- MUST: Kennt der Führer die Fähigkeit des Absenders noch nicht, quittiert er den Nachtrag nicht.
- MUST: Ein abgelehnter Nachtrag zu einem hier geführten Einsatz, dessen Zeile sich auflösen
  lässt und nicht schon `mitarbeit` ist, legt die Zeile neu ins Log, damit der Spiegel dem Führer
  folgt.

## Prüfung

```sh
verlange 'mitarbeit_grenze_stand' 'src/instanz/spiegel/nachtrag.rs'
verlange 'herkunft_kopplung_id' 'src/instanz/spiegel/nachtrag.rs'
verlange 'nachtrag::queue_nachtraege' 'src/instanz/repo.rs'
```

## Kontext

Eine Instanz vor LLH-1817 kennt die Einsatzrolle `mitarbeit` nicht. Gibt eine neue Instanz die
Führung an sie zurück oder übernimmt sie per Notübernahme, führt sie die Person als Beobachter;
der Spiegel hält `mitarbeit` nur fest, solange der Führer alt ist. Nach dem Aufrüsten hätte die
nächste Bearbeitung am Führer die Rolle still herabgestuft. Ein Spiegel ändert sonst nie Zeilen
des Führers (ADR-0018); dieser Nachtrag ist bewusst die engste Ausnahme.

## Konsequenzen

Die gesetzte Rolle kommt ohne Handgriff zurück, und beide Seiten sind danach einig. Eine
gekoppelte Instanz kann am Führer höchstens Beobachter zu Mitarbeit anheben, und nur in einem
Einsatz, den sie vorher geführt hat; dort aber jede Beobachter-Zeile, die seit der Grenze
unverändert ist, auch eine, die der Führer selbst angelegt hat. Der Nachtrag muss im selben Release wie LLH-1817 ausgeliefert
werden: Eine Instanz, die vorher aufrüstet, merkt nie etwas vor.
