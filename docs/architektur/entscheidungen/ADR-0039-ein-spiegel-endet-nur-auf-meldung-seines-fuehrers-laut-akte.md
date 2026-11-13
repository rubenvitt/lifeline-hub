---
id: ADR-0039
titel: Ein Spiegel endet nur auf Meldung seines Führers laut Akte, mit demselben Beleg wie eine Akte
status: akzeptiert
datum: 2026-11-13
gilt_fuer:
  - src/instanz/spiegel/lebensende.rs
  - src/instanz/spiegel/fuehrung.rs
  - src/instanz/spiegel/abgleich.rs
herleitung:
  - openspec/changes/archive/2026-11-13-r11nl4cv-geloescht-fremdes-praefix/design.md
  - LLH-1852 (Weg mit Ruben am 13.11.2026 abgestimmt)
---

# ADR-0039: Ein Spiegel endet nur auf Meldung seines Führers laut Akte, mit demselben Beleg wie eine Akte

## Regeln

- MUST: `geloescht` für den genannten Stand eines Spiegels belegt eine Instanz wie für eine
  genannte Akte ([ADR-0036](ADR-0036-das-ende-eines-einsatzes-meldet-eine-instanz-nur-mit-beleg.md)):
  Löschvermerk, auch bei fremdem Präfix, oder für ältere Löschungen das Löschprotokoll mit
  eigenem Präfix (`lebensende::geloeschte` und `geloeschte_akten` teilen eine Funktion).
- MUST NOT: Ein Eintrag im Löschprotokoll der Art `spiegel` oder einer Org, die der fragenden
  Kopplung nicht zugeordnet ist, belegt das Ende.
- MUST: Ein Spiegel wird auf `geloescht` nur abgeräumt, wenn er zu der Kopplung gehört, über die
  die Meldung kommt, und der Absender sein Führer ist (`spiegel::fuehrung::is_fuehrer_des_spiegels`).
- MUST: Mit eingeschalteter Führung je Einsatz und einer Akte zur Kennung entscheidet allein die
  Akte, auch gegen ein passendes Präfix; ohne Schalter oder ohne Akte das Präfix des Absenders.

## Prüfung

```sh
verbiete 'fn ist_geloescht\(' 'src/instanz/spiegel/lebensende.rs'
verlange 'is_fuehrer_des_spiegels\(' 'src/instanz/spiegel/lebensende.rs'
verlange 'pub async fn is_fuehrer_des_spiegels\(' 'src/instanz/spiegel/fuehrung.rs'
verbiete 'starts_with\(&praefix\)' 'src/instanz/spiegel/lebensende.rs'
```

## Kontext

Das Ende eines gespiegelten Einsatzes erreichte den Spiegel nur, wenn der löschende Führer auch
der Ursprung des Einsatzes war: Belegt wurde über die ID in der Kennung, angenommen nur mit dem
Präfix des Absenders. Nach einer Übergabe, Notübernahme oder Anfrage blieb der Spiegel beim
früheren Führer stehen, am Hub für immer. Zugleich meldete eine Instanz einen Einsatz als
gelöscht, von dem sie nur ihren Spiegel abgeräumt hatte.

## Konsequenzen

Ein Beleg gilt für Stände und Akten, und eine aus einer Sicherung zurückgekehrte Instanz meldet
weiter nichts. Ein Spiegel folgt beim Abräumen derselben Akte wie beim Schreiben (LLH-1641).
Ohne Schalter bleibt ein Spiegel mit fremdem Präfix nach der Löschung beim Führer stehen; einen
solchen gibt es nur, wenn die Führung nach einer Übernahme ausgeschaltet wurde.
