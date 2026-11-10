---
id: ADR-0018
titel: Ein Einsatz wird an einer anderen Instanz als Spiegel in denselben Tabellen gehalten
status: akzeptiert
datum: 2026-11-09
gilt_fuer:
  - src/instanz/spiegel/**
  - src/einsatz/spiegel_filter.rs
  - src/einsatz/schwaerzung_registry.rs
  - src/auth/session.rs
  - migrations/0313_einsatz_spiegel.sql
  - frontend/src/offline/queue.ts
herleitung:
  - openspec/changes/polrv1lt-spiegel-antraege/design.md
  - docs/konzepte/2026-10-29-instanzkopplung-elw-hub.md
---

# ADR-0018: Ein Einsatz wird an einer anderen Instanz als Spiegel in denselben Tabellen gehalten

## Regeln

- MUST: Ein Einsatz, den eine gekoppelte Instanz nicht führt, liegt dort in denselben Tabellen
  wie ihre eigenen Einsätze; eine Zeile in `einsatz_spiegel` macht ihn zum Spiegel. Fremde
  Einsatzzeilen bildet die spiegelnde Seite über `spiegel_herkunft` ab.
- MUST NOT: keine eigenen Spiegeltabellen, keine zweite Datenbankdatei je Spiegel, keine IDs des
  Führers in den lokalen Tabellen.
- MUST: Jede gespiegelte Tabelle hat Log- und Schutz-Trigger aus
  `instanz::spiegel::art::trigger_sql` (Pflicht für neue Einsatztabellen: `src/AGENTS.md`,
  Abschnitt „Instanzkopplung“, „Spiegel und Anträge“).
- MUST: Den Schreibschutz am Spiegel trägt der Trigger (`RAISE(ABORT, 'einsatz_ist_spiegel')`,
  409); nur die Übernahme schreibt, unter dem Merker `spiegel_uebernahme` in ihrer Transaktion.
- MUST NOT: Kein Schreibweg in Rust außerhalb von `src/instanz/spiegel/` schreibt in
  `einsatz_aenderung` oder setzt den Merker.
- MUST: Am Spiegel wird nur eine Erfassung aus `spiegel::antrag::BEANTRAGBAR` zum Antrag; jede
  andere Schreibroute endet am Trigger.
- MUST NOT: keine Schreibroute als allgemeiner HTTP-Antrag (PATCH, DELETE, beliebige Bodies).
- MUST: Der Führer führt einen Antrag über den eigenen Router aus (`oneshot`) mit der Extension
  `AntragAkteur`, die nur `spiegel::antrag::ausfuehren` anlegt; `CurrentUser` nimmt das Konto
  aus ihr. Fachfunktionen ruft der Antragsweg nie direkt.

## Prüfung

```sh
verlange "RAISE\(ABORT, 'einsatz_ist_spiegel'\)" migrations/0313_einsatz_spiegel.sql
verlange 'fn trigger_passen_zur_beschreibung' src/instanz/spiegel/art.rs
verlange 'fn jede_einsatztabelle_ist_eingeordnet' src/instanz/spiegel/art.rs
verlange 'fn jede_vormerkbare_art_ist_eingeordnet' src/instanz/spiegel/antrag.rs
verlange 'spiegel::antrag::schicht' src/app.rs
verlange '\.oneshot\(' src/instanz/spiegel/antrag.rs
verlange 'spiegel::antrag::AntragAkteur>' src/auth/session.rs
verbiete 'AntragAkteur \{' 'src/**/*.rs' ':(exclude)src/instanz/spiegel/antrag.rs'
verbiete 'INTO (einsatz_aenderung|spiegel_uebernahme)' 'src/**/*.rs' ':(exclude)src/instanz/spiegel' ':(exclude)src/einsatz/spiegel_filter.rs'
```

## Kontext

Der Verwaltungsstab soll am Hub lesen, was der ELW schreibt, und umgekehrt (Konzept LLH-1287,
Entscheidungen 5 und 6). Ein Einsatz verteilt sich auf über hundert Tabellen; Seiten, Druck,
Suche, Offline-Lesen und Rechte lesen sie über Hunderte Stellen. Eine eigene Datenbank oder
eigene Tabellen je Spiegel hätten jede dieser Stellen verdoppelt. Ruben hat den Weg am
09.11.2026 abgestimmt (LLH-1492).

## Konsequenzen

Lesewege unterscheiden einen Spiegel nicht von einem eigenen Einsatz; eine Übergabe (LLH-1491)
muss nur umschalten, wer führt, und nichts kopieren. Jede neue Einsatztabelle braucht Trigger
und einen Eintrag in der Beschreibung, sonst wird der Wächter rot; ein Neubau einer Tabelle
verliert die Trigger still, bis der Test sie vermisst. Hintergrundläufe müssen Spiegel auslassen. Am Spiegel
geht nur, was auch ohne Netz vormerkbar ist; alles andere wartet auf den Führer.
