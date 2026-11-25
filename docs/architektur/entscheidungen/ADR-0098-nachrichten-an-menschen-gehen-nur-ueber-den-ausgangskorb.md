---
id: ADR-0098
titel: Nachrichten an Menschen gehen nur über den Ausgangskorb
status: akzeptiert
datum: 2026-11-25
gilt_fuer:
  - src/ausgang/**
  - src/adapter/smtp.rs
  - src/adapter/smtp/**
  - src/adapter/smtp_art.rs
  - src/routes/ausgang.rs
herleitung:
  - docs/superpowers/specs/2026-11-24-w1ymakq6-ausgang-email-design.md
---

# ADR-0098: Nachrichten an Menschen gehen nur über den Ausgangskorb

## Regeln

- MUST: Eine Nachricht an einen Menschen (E-Mail an eine Externe Stelle) löst ein Mensch aus,
  durch Absenden am freigegebenen Dokument oder durch „Erneut senden“; sie geht über die Tabelle
  `ausgang` und den Lauf `ausgang::lauf`. Ein Ereignis, ein Webhook oder ein Adapterlauf stößt
  keinen Versand an.
- MUST: Ein Versand ist eine Adresse; Betreff, Text, Stelle und Adresse stehen als Schnappschuss
  in der Zeile. „Erneut senden“ sendet den Schnappschuss, nie eine neuere Fassung.
- MUST: Der Lauf hält während der SMTP-Sitzung keine Datenbankverbindung; Ergebnis und
  ETB-Eintrag schreibt eine einzige Transaktion, `live.publiziere` folgt nach dem Commit.
- MUST: Vor jeder Zustellung prüft der Lauf die Quelle (jüngste freigegebene Version,
  Nachforderung nicht zurückgezogen oder abgelehnt) und den Spiegel; ein überholter Versand
  geht ohne Netz auf `fehlgeschlagen`, ein Spiegel ohne ETB-Eintrag.
- MUST: Vorübergehende Fehler wiederholt der Lauf höchstens 30 Minuten ab `erster_versuch_at`;
  ein `ungewiss` (Abbruch nach DATA) wird nie selbst wiederholt.
- MUST NOT: Text des Mailservers, Passwort oder Zugangsdaten stehen in Spalte, ETB, Log,
  Antwort oder Fehlertext; gespeichert wird nur ein `AusgangFehler`-Code und der SMTP-Status.
- MUST: Das Passwort entschlüsselt nur `adapter::lauf::zugang_fuer_versand` (neben dem Lauf
  der Adapter); der Ausgangskorb hält es nur für die Dauer einer Zustellung. Die Route prüft beim
  Anlegen nur Zeile und Zustand der Anbindung (`pruefe_versand_moeglich`), ohne zu entschlüsseln.
- MUST: Die Anbindung ist eine Adapter-Art (`smtp`, ADR-0077) mit eigenem SMTP-Client über den
  Zielschutz von `adapter::ziel`; keine zweite Tabelle für Zustand oder Geheimnisse.
- MUST NOT: Ein Webhook nach ADR-0038/ADR-0046 trägt Nachrichten an Menschen; beide Wege bleiben
  getrennt.
- SHOULD: Ein neuer Kanal (SMS, Messenger) ist eine weitere Art mit Versandweg und kommt in
  `KanalArt`, nicht in einen zweiten Korb.

Die Einzelregeln mit Dateien stehen in `src/AGENTS.md`, „Ausgang an Menschen“.

## Prüfung

```sh
# Exit 0, solange die Regeln gelten (Hilfen und Grenzen: docs/architektur/AGENTS.md).
verlange 'pub async fn zugang_fuer_versand' src/adapter/lauf.rs
verbiete '\.decrypt\(' 'src/ausgang/**/*.rs' 'src/routes/ausgang.rs'
verbiete 'zugang_fuer_versand' src/routes/ausgang.rs
verbiete 'lettre::transport|AsyncSmtpTransport' 'src/**/*.rs'
verlange 'ausgang' src/instanz/spiegel/art.rs
```

## Kontext

Lageberichte, Befehle und Nachforderungen sollen die Leitstelle und andere Stellen per Mail
erreichen. Ein Webhook ist für Fremdsysteme gebaut, ein Adapterlauf ruft ab; beides passt nicht
zu einer Nachricht, die ein Mensch bewusst absendet und die jedem Mitlesenden im ETB belegt sein
muss. Ein Mailserver bestätigt mit 250 oder gar nicht, also muss „unklar“ ein eigener Zustand sein.

## Konsequenzen

Jeder Versand ist sichtbar, wiederholbar und im ETB belegt; ein Absturz erzeugt höchstens einen
`ungewiss`, nie eine stille Doppelzustellung. Der Mensch trägt die Entscheidung bei „Zustellung
unklar“. Ein neuer Kanal braucht eine Art mit Versandweg, aber keinen neuen Lauf. Die eine
Ausnahme vom ETB-Beleg: nimmt das ETB nach einer Übergabe nichts an (der Einsatz wurde während
der Zustellung zum Spiegel), steht der Versand als `uebergeben` ohne Eintrag, weil sich eine
übergebene Mail nicht zurückholen lässt (`src/AGENTS.md`, „Ausgang an Menschen“).
