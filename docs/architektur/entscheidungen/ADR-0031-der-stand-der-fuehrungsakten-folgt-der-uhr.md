---
id: ADR-0031
titel: Der Stand der Führungsakten folgt der Uhr, ein Rückschritt zeigt sich an der Quittung
status: akzeptiert
datum: 2026-11-12
gilt_fuer:
  - src/instanz/fuehrung/repo.rs
  - src/instanz/fuehrung/austausch.rs
  - src/instanz/melden.rs
herleitung:
  - openspec/changes/archive/2026-11-12-xi5ugyt8-fuehrung-stand-nach-restore/design.md
---

# ADR-0031: Der Stand der Führungsakten folgt der Uhr, ein Rückschritt zeigt sich an der Quittung

## Regeln

- MUST: Ein Stand der Führungsakten kommt nur aus `fuehrung::repo::next_stand`, und der vergibt
  `MAX(Zähler + 1, Unix-Sekunden)`.
- MUST: Den Instanzzähler hebt sonst nur `repo::raise_stand`, gerufen allein aus
  `austausch::repair_stand`; nach dem Heben stempelt er jede aktive Kopplung neu, in der die
  Instanz erreichte Seite ist, je über deren gespeichertem `fuehrung_gesendet_bis`.
- MUST: `fuehrung_gesendet_bis` sinkt nur über `repo::reset_gesendet_bis`, an der meldenden Seite,
  auf eine kleinere Quittung über 0; jeder andere Schreibweg speichert die Stände nur steigend.
- MUST: Die meldende Seite schickt ihren Sendestand in `MeldenAnfrage::fuehrung_gesendet_bis`
  mit. Liegt der Empfangsstand der erreichten Seite darunter, quittiert sie ihn und hebt ihn mit
  dieser Meldung nicht an (außer bei 0).
- MUST NOT: Einen Rückschritt nicht über eine Zähler-Epoche oder einen Merker erkennen, den nur
  `restore` setzt; eine von Hand zurückkopierte Datei muss genauso abgefangen werden.

## Prüfung

```sh
verlange 'MAX\(fuehrung_stand \+ 1, \?\)' src/instanz/fuehrung/repo.rs
verbiete 'fuehrung_stand = fuehrung_stand \+ 1' 'src/**/*.rs'
verbiete 'raise_stand\(' 'src/**/*.rs' ':(exclude)src/instanz/fuehrung/repo.rs' ':(exclude)src/instanz/fuehrung/austausch.rs'
verbiete 'reset_gesendet_bis\(' 'src/**/*.rs' ':(exclude)src/instanz/fuehrung/repo.rs' ':(exclude)src/instanz/melden.rs'
verlange 'list_erreicht_aktiv' src/instanz/fuehrung/austausch.rs
verlange 'pub fuehrung_gesendet_bis: i64' src/instanz/melden.rs
```

## Kontext

Nach dem Zurückspielen einer Sicherung lag der Zähler der Führungsakten unter dem, was das
Gegenüber schon quittiert hatte. Neue Akten gingen nie hinaus, und verlorene schickte niemand
erneut (LLH-1708). Wie die Sicherung eingespielt wird, weiß die Instanz nicht: über `restore`,
von Hand oder als Snapshot.

## Konsequenzen

Ein Rückschritt heilt ohne Eingriff, solange die Uhr stimmt. Geht sie nach, fängt die Quittung über
dem eigenen Zähler das meist ab, mit einem Hinweis an der Kopplung. Das Protokoll trägt dafür ein
additives Feld, eine Migration gibt es nicht. Offen bleiben eine Sicherung von vor der ersten
Übernahme und seltene Fälle mit mehreren Kopplungen bei nachgehender Uhr (Risiken in der
Herleitung).
