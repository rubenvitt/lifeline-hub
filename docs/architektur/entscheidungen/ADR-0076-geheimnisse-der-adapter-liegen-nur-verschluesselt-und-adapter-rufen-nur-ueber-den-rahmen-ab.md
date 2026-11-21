---
id: ADR-0076
titel: Geheimnisse der Adapter liegen nur verschlüsselt, Adapter rufen nur über den Rahmen ab
status: vorgeschlagen
datum: 2026-11-21
gilt_fuer:
  - src/adapter/**
  - src/routes/adapter.rs
herleitung:
  - docs/superpowers/specs/2026-11-21-r19tuh60-adapter-rahmen-design.md
  - docs/konzepte/2026-11-10-schnittstellen-ausbau.md
  - https://zunder.rubeen.dev/#/aufgabe/r19tuh60j02y0c7o547p5d7z
---

# ADR-0076: Geheimnisse der Adapter liegen nur verschlüsselt, Adapter rufen nur über den Rahmen ab

## Regeln

- MUST: Ein Geheimnis eines Adapters (Accesskey, API-Key, Passwort) liegt in der Datenbank nur
  als age-Chiffrat an den Empfänger des Schlüssels aus `LIFELINE_GEHEIMNIS_SCHLUESSEL`, mit dem
  Fingerabdruck dieses Empfängers je Zeile.
- MUST NOT: Ein Geheimnis wird über eine API-Antwort gelesen, ins Log, in die Admin-Spur oder in
  einen Fehlertext geschrieben; die Verwaltung sieht nur, ob und wann es gesetzt ist.
- MUST NOT: Der Schlüssel des Speichers liegt in der Datenbank, einer Sicherung oder einer Datei
  des Servers; er kommt nur aus der Umgebung.
- MUST: Fehlt der Schlüssel, startet der Server; Geheimnisse lassen sich dann nicht speichern, und
  ein Adapter, der eines braucht, hält mit einem Fehlercode an.
- MUST: Ein Adapter erreicht das Netz nur über den Abrufkontext des Rahmens: jede URL besteht vor
  jeder Anfrage den Zielschutz der Webhooks, der Client folgt keiner Weiterleitung, nimmt keinen
  Proxy und nutzt den pinnenden Resolver; Antworten liest er nur gedeckelt (`http_begrenzt`).
- MUST: Während eines Abrufs hält der Lauf keine Datenbankverbindung; Übernahme, Zustand und
  Versuch schreibt er danach in einer Transaktion.
- MUST: Ein Fehler, den nur ein Mensch beheben kann (abgelehnt, Geheimnis fehlt oder unlesbar,
  Speicher gesperrt, Einstellung oder Ziel ungültig, Weiterleitung), hält den Adapter an; ein
  vorübergehender wird mit Wartezeit wiederholt. Fehler stehen als Code, nie als Text des Ziels.

## Prüfung

```sh
verlange 'age::encrypt\(' src/adapter/geheimnis.rs
verbiete 'load_chiffrate|\.decrypt\(' 'src/routes/**/*.rs'
verbiete 'Zweck::Adapter' 'src/routes/**/*.rs' src/adapter/lauf.rs src/adapter/art.rs src/adapter/repo.rs
verlange 'redirect::Policy::none\(\)' src/adapter/ziel.rs
verlange '\.no_proxy\(\)' src/adapter/ziel.rs
verlange 'dns_resolver\(Arc::new\(WebhookResolver' src/adapter/ziel.rs
verlange 'check_url\(url, self\.lan_erlaubt\)' src/adapter/ziel.rs
verbiete 'tracing::[a-z]+!\(.*(wert|geheimnis|secret)' 'src/adapter/**/*.rs' src/routes/adapter.rs
```

## Kontext

Divera, HiOrg, Postfach und die Kanäle nach außen brauchen Zugangsdaten, die Lifeline Hub selbst
vorhält; bisher lag kein solches Geheimnis in der Datenbank, und die Datenbank ist im Klartext
(R19). Ein Abruf im Hintergrund an eine Adresse, die ein Admin einträgt, ist derselbe Weg in
interne Netze wie bei den Webhooks (ADR-0046). Jede Anbindung soll das nicht neu lösen.

## Konsequenzen

Ein Diebstahl der Datenbank oder einer Sicherung verrät kein Adapter-Geheimnis. Wer den Schlüssel
verliert oder auf einem anderen Rechner ohne ihn wiederherstellt, setzt die Geheimnisse neu; der
Schlüssel wird getrennt gesichert (`docs/betrieb/backup-restore.md`). Gegen eine Übernahme des
laufenden Servers schützt der Speicher nicht. Eine neue Adapterart schreibt nur Übersetzung und
Übernahme, keinen eigenen Client.
