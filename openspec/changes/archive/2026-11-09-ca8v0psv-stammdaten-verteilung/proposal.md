# Proposal

Zunder: https://zunder.rubeen.dev/#/aufgabe/ca8v0psvc94anf2cda8epeuz (LLH-1493, Epic LLH-1489)

## Why

Ein ELW soll im Einsatz mit denselben Konten, Fahrzeugen, Kräften und Vorlagen arbeiten, die die
Organisation am Hub pflegt (Entscheidung 10 im Konzept
`docs/konzepte/2026-10-29-instanzkopplung-elw-hub.md`). Heute pflegt jede Instanz ihre Stammdaten
für sich, und am ELW meldet sich nur an, wer dort ein eigenes Konto hat. Mit der Kopplung aus
LLH-1490 gibt es jetzt den signierten Weg zwischen beiden. Fehlt die Verteilung, tippt jemand im
Fahrzeug Fahrzeuge und Konten doppelt ab, oder er kommt ohne Netz gar nicht hinein.

## What Changes

- **Der Hub führt die Stammdaten einer gekoppelten Org.** Die Stammdaten fließen von der
  erreichten Seite zur meldenden Seite und kommen mit jeder Meldung als Nachlieferung „seit
  Stand X“. Die erste Meldung liefert den Grundstock.
- **Änderungslog per Trigger:** Ein Log je Org hält fest, welche Zeile sich wann geändert hat,
  auch beim harten Löschen. SQLite-Trigger an jeder verteilten Tabelle füllen es, kein
  Schreibweg muss daran denken.
- **Erster Schnitt:** Konten (mit Rollen), Org-Einstellungen, Modul-Einstellungen,
  Führungsfunktionen, Fahrzeuge, Personal, Qualifikationen, Material, Fahrzeug- und
  Personal-Status, Einheit-Typen und Einheiten-Vorlagen. Die übrigen Kataloge (Schichtmodelle,
  Einsatz- und Verpflegungs-Vorlagen, Sprechgruppen, ETB-Bausteine, Externe Stellen,
  Stichwort-Vorschläge, Unterkunft-Richtwerte) folgen mit einer Folgeaufgabe auf demselben Weg.
- **Am ELW sind übernommene Zeilen nur lesbar.** Ein Schreibversuch endet mit 409 „Wird am Hub
  gepflegt“, und die Oberfläche sperrt die Bearbeitung. Eine Ergänzung am ELW (Spontanhelfer,
  geliehenes Fahrzeug) gilt sofort und trägt „nur hier“. Der Antrag an den Hub kommt mit
  LLH-1492.
- **Erster Abgleich:** Sachstammdaten mit gleichem natürlichem Schlüssel (Funkrufname,
  Personalnummer, Bestandsnummer, Name oder Bezeichnung) werden zusammengeführt, die Hub-Zeile
  gewinnt. Konten werden nie zusammengeführt. Ein Hub-Konto, dessen Name am ELW schon vergeben
  ist, kommt nicht an, und an der Kopplung steht ein Hinweis.
- **Anmeldung am ELW ohne Netz:** Passwort-Hash und TOTP-Geheimnis kommen mit dem Konto. Passkeys
  registriert man je Instanz. Ein SSO-Konto meldet sich ohne Netz per Einmalpasswort des
  ELW-Admins an.
- **Auflagen für die Geheimnisse:**
  - Sie gehen mit age Ende-zu-Ende verschlüsselt an einen Schlüssel des ELW.
  - Sie gehen nur an einen ELW, der eine verschlüsselte Platte bestätigt
    (`--datentraeger-verschluesselung-extern`). Sonst kommt das Konto ohne Geheimnisse an.
  - Am Hub gibt es die Aktion **„ELW verloren“**. Sie widerruft die Kopplung, beendet Sitzungen
    und verlangt von allen Konten, deren Geheimnisse dort lagen, ein neues Passwort und eine neue
    TOTP-Einrichtung.
  - **System-Admins an einer verteilenden Instanz:** Ihre Geheimnisse gehen nur hinaus, wenn sie
    dort einen Anmelde-Passkey haben, und dann melden sie sich dort nur noch per Passkey an. Ein
    gestohlener ELW gibt so keinen Admin-Zugang am Hub her. Das ersetzt eine Regel aus ADR-0011
    (Passwort als einziger admin-tauglicher Weg) durch eine neue ADR.
- **Instanzkopplung:** Je Kopplung zeigt die Seite den Stammdaten-Stand und Hinweise wie
  „Geheimnisse nicht verteilt: Platte nicht bestätigt“, „Konto ‚admin‘ schon vergeben“.

## Capabilities

### New Capabilities

- `stammdaten-verteilung`: Wie die Stammdaten einer Org von der erreichten zur meldenden
  Instanz kommen. Dazu gehören Änderungslog, Nachlieferung, Abgleich, Schreibschutz am ELW, lokale
  Ergänzung, Konten mit Geheimnissen und deren Auflagen sowie „ELW verloren“.

### Modified Capabilities

- `passwort-anmeldung`: Ein System-Admin mit Anmelde-Passkey an einer Instanz, die Geheimnisse
  verteilt, meldet sich dort nicht mehr per Passwort an.
- `org-live`: Eine übernommene Nachlieferung löst das Ereignis `stammdaten` aus, obwohl keine
  Schreibanfrage dahintersteht.

## Impact

- **Backend:** neues Modul `src/instanz/stammdaten/`; `src/instanz/melden.rs` (additive Felder
  in Anfrage und Antwort, keine neue Protokollversion); `src/instanz/identitaet.rs` (age-Schlüssel);
  Anmeldung `src/auth/provider/password.rs`; Fehlerabbildung `src/error.rs` (409 aus dem
  Schreibschutz-Trigger); neue Route „ELW verloren“ in `src/routes/instanz.rs`.
- **Migrationen:** Änderungslog, Trigger an den Tabellen des Schnitts, Herkunftstabelle, Spalten
  für age-Schlüssel und Empfänger, Lieferliste der Geheimnisse, neue `admin_audit`-Aktionen.
- **Frontend:** Herkunftsabzeichen und Bearbeitungssperre auf den Stammdaten-Seiten des Schnitts
  und in der Benutzerverwaltung; Hinweise und Aktion „ELW verloren“ auf der Seite
  „Instanzkopplung“; Text bei abgewiesener Admin-Anmeldung per Passwort.
- **Doku:** neue ADR (ersetzt ADR-0011), Kapitel 8 und 11 der Architekturdoku,
  Anwenderdoku `instanzkopplung.md` und Benutzerverwaltung, `src/AGENTS.md` (Abschnitt
  Instanzkopplung).
- **Keine Wirkung auf ungekoppelte Instanzen:** Die Trigger schreiben das Log, aber ohne Kopplung
  liest es niemand.
