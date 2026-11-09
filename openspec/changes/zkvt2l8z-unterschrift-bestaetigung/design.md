# Design

## Context

LLH-1490 (PR rubenvitt/lifeline-hub#1220, Change
`openspec/changes/archive/2026-11-08-ckq15vzr-instanzkopplung-schluessel/`) hat die
Unterschriftsschlüssel gebaut. Die Lage heute:

- `unterschrift_schluessel` kennt die Zustände `wartet_auf_gegenzeichnung`, `gueltig` und
  `widerrufen`, die Herkunft `lokal` oder `gegenueber`. Der CHECK steht in
  `migrations/0300_instanz_kopplung.sql`.
- `accept_lieferungen` (`src/auth/unterschrift/repo.rs`) übernimmt eine gültig gegengezeichnete
  Lieferung sofort als `gueltig`, den Grundstock beim Koppeln ohne Gegenzeichnung.
- Als Unterzeichner zählen nur Schlüssel mit `zustand = 'gueltig'` (`check_gegenzeichnung`). Das
  gilt auch für die spätere Notübernahme (LLH-1491).
- Schlüssel fließen nur von der Seite, die gemeldet wird, zu der, die sich meldet (Nachlieferung in
  der Antwort auf Melden). Die übernehmende Seite ist also immer die mit Richtung `meldet_sich`.
- Deaktivieren (`routes/benutzer.rs::deaktivieren`) und Bearbeiten (Rolle, `aktiv`) widerrufen im
  selben Commit alle lokalen Schlüssel des Kontos (`alle_des_benutzers_widerrufen`), ohne den
  Schutz „letzter Schlüssel“. Das einzelne Widerrufen prüft ihn (`is_letzter_gueltiger`, 409).
- Das Deaktivieren in `frontend/src/pages/BenutzerPage.tsx` läuft ohne Rückfrage direkt aus dem
  Zeilenmenü.

## Goals / Non-Goals

**Goals:**

- Ein kompromittierter Hub bekommt einen untergeschobenen Schlüssel nicht mehr ohne einen
  Menschen am ELW durch, der den Fingerabdruck mit dem Inhaber abgleicht.
- Deaktivieren und Herabstufen gelingen immer; wer es tut, weiß vorher, was es für die Kopplung
  heißt, und die Kopplung zeigt danach den Ausweg.

**Non-Goals:**

- Das Gegenüber erfährt nichts von Bestätigung oder Ablehnung. Kein neues Protokollfeld.
- Kein eigener Unterschriftsschlüssel zum Bestätigen (Entscheidung Ruben, 08.11.2026).
- Kein automatischer Ausweg nach dem Verlust des letzten Schlüssels; der bestehende Weg (Kopplung
  widerrufen, Schlüssel registrieren, neu koppeln) bleibt.
- Keine Bestätigung für Widerrufe und für den Grundstock.

## Decisions

### D1 Zwei neue Zustände statt eines Merkers

`unterschrift_schluessel.zustand` bekommt `wartet_auf_bestaetigung` und `abgelehnt`, dazu die
Spalten `entschieden_at` und `entschieden_von` (Benutzer-ID, `ON DELETE SET NULL`). Beide Zustände
gibt es nur bei Herkunft `gegenueber` (CHECK).

Alternative: `zustand = 'gueltig'` mit `bestaetigt_at IS NULL`. Verworfen, weil jede Abfrage auf
`zustand = 'gueltig'` (Gegenzeichnung, später Notübernahme) dann ein zweites Merkmal prüfen müsste.
Wer es vergisst, macht die Lücke wieder auf. Mit eigenem Zustand ist ein wartender Schlüssel
überall von selbst ungültig.

`abgelehnt` ist ein eigener Zustand und nicht `widerrufen`. Die Oberfläche und die Spur sagen
damit, dass ein Mensch hier „nein“ gesagt hat. Die Sperre gegen Wiederaufleben deckt beide ab: Die
Abfrage „derselbe Schlüssel unter anderer id“ in `accept_lieferungen` zählt `abgelehnt` wie
`widerrufen`.

**Migration:** SQLite ändert keinen CHECK, darum ein Neuaufbau von `unterschrift_schluessel`
(Muster `migrations/0301_admin_audit_instanz.sql`) mit allen Indizes. Im selben Zug wird
`admin_audit` mit den zwei neuen Aktionen neu aufgebaut. Nummer: größer als jede auf `alpha` beim
Commit (`scripts/check-migrationen.sh`).

### D2 Übernahme

In `accept_lieferungen` setzt der Fall „gültig geliefert, hier unbekannt“ nach bestandener
Gegenzeichnung `wartet_auf_bestaetigung` statt `gueltig`; mit `grundstock = true` bleibt es bei
`gueltig`. Unverändert bleiben:

- „gültig geliefert, hier bekannt“ ändert nichts, auch nicht an einem wartenden oder abgelehnten
  Schlüssel;
- „widerrufen geliefert“ widerruft auch einen wartenden Schlüssel;
- der `unterschrift_stand` wandert mit, damit dieselbe Lieferung nicht immer wiederkommt.

### D3 Bestätigen und Ablehnen

- `POST /api/admin/instanz/unterschrift/{id}/bestaetigen` mit `{ "fingerabdruck_ende": "Q7KM" }`
- `POST /api/admin/instanz/unterschrift/{id}/zurueckweisen` ohne Body
- Beide `AdminUser`. Gefunden wird der Schlüssel nur in der eigenen Org, sonst 404.
- Fehlt `fingerabdruck_ende` oder ist es leer: 400. Der Vergleich ignoriert Groß- und
  Kleinschreibung und Trennzeichen und gilt gegen die letzten vier Zeichen des Fingerabdrucks
  ohne Trennzeichen.
- Passen die Zeichen nicht: 422 „Die Zeichen passen nicht zum Fingerabdruck.“ Ein Schlüssel, der
  nicht wartet: 422 (Status-Übergang, `src/AGENTS.md`, Statuscode-Konvention).
- Bestätigen setzt `gueltig`, Ablehnen `abgelehnt`, beide mit `entschieden_at` und
  `entschieden_von`. Ein bedingtes `UPDATE … WHERE zustand = 'wartet_auf_bestaetigung'` macht
  einen doppelten Klick zu einem 422 statt zu zwei Spureinträgen.
- Spur: `UnterschriftBestaetigt` und `UnterschriftZurueckgewiesen` mit Fingerabdruck,
  Inhaber und Kopplung (Muster `build_angaben_gegenstelle`).

### D4 Anzeige

- `UnterschriftSchluesselAnzeige` trägt schon `gegengezeichnet_von`. Neu: `unterzeichner_fingerabdruck`
  und `erklaert_at` (Zeitpunkt aus der Erklärung). Beide sind nur bei Schlüsseln vom Gegenüber
  gesetzt.
- `InstanzKopplungAnzeige` bekommt zwei Felder:
  - `wartende_schluessel` (Anzahl), nur auf der Seite `meldet_sich`;
  - `ohne_gueltigen_schluessel` (`true`, wenn die Org der Kopplung auf der Seite `wird_gemeldet`
    keinen gültigen lokalen Schlüssel mehr hat).
- `instanzText.ts::kopplungHinweise` macht daraus die beiden Hinweise der Spec.
- Bestätigungsdialog als `ErfassungsModal` mit:
  - Fingerabdruck in Gruppen, Inhaber, Unterzeichner mit Fingerabdruck, Zeitpunkt;
  - Hinweis, den Inhaber anzurufen und nach den letzten vier Zeichen zu fragen; der Inhaber
    nennt sie, nicht umgekehrt;
  - ein Eingabefeld (4 Zeichen, Großbuchstaben).
- Zurückweisen ist ein Menüeintrag mit eigener Rückfrage.
- Formulierungen klärt die Umsetzung mit `bedien-wortlaut` und `design:ux-copy`.

### D5 Warnung vor dem Deaktivieren und Herabstufen

Der Widerruf im Backend bleibt, wie er ist. Neu ist eine Abfrage für die Warnung:

- `GET /api/admin/instanz/letzte-schluessel` (`AdminUser`) liefert
  `[{ benutzer_id, kopplungen: [name] }]`: Konten, die alle gültigen lokalen Schlüssel einer Org
  mit verteilender Kopplung halten. Die Org ist nur die eigene. Es reicht eine Abfrage mit
  `GROUP BY`, wiederverwendet wird `is_org_verteilt`.
- `BenutzerPage` lädt sie nur für Admins.
  - **Deaktivieren** eines solchen Kontos öffnet eine Rückfrage: „Danach hat die Organisation
    keinen gültigen Unterschriftsschlüssel mehr. Die Kopplung mit {Namen} muss neu aufgebaut
    werden.“ Sonst deaktiviert es wie bisher direkt.
  - **Bearbeiten** zeigt dieselbe Warnung als `Alert` im Dialog, sobald die Werte das Konto aus
    der Admin-Rolle nehmen oder deaktivieren.

Alternative: ein Feld an `BenutzerAnzeige` (`src/auth/mod.rs`). Verworfen, weil der Typ an vielen
Stellen geteilt wird, auch an `/api/auth/me`, und die Information nur die Verwaltung braucht.

## Risks / Trade-offs

- [Admins am ELW klicken die Bestätigung weg] → Das Eintippen der vier Zeichen zwingt zum
  Nachfragen. Wer sie vom Bildschirm abliest, umgeht das. Der Hinweis im Dialog sagt, warum
  gefragt wird.
- [Ein ELW ohne Netz zum Inhaber kann nicht abgleichen] → Der Schlüssel wartet. Unterschriften der
  schon gültigen Schlüssel gelten weiter, also blockiert nichts Bestehendes.
- [Neuaufbau zweier Tabellen in einer Migration] → Muster vorhanden. Der Test
  `db::tests` und die bestehenden Integrationstests laufen über die neue Migration.
- [Der Hub belügt auch den Inhaber] → Der Inhaber liest seinen Fingerabdruck auf einer Seite, die
  der Hub ausliefert. Ein kompromittierter Hub kann ihm dort den Fingerabdruck des
  untergeschobenen Schlüssels zeigen, wenn der Inhaber gerade selbst einen Schlüssel registriert
  hat. Der Abgleich fängt also den Schlüssel, den niemand angekündigt hat („Hast du gerade einen
  Schlüssel registriert?“ – „Nein“), nicht aber einen, der eine echte Registrierung im selben
  Zeitfenster überdeckt. Eine vom Hub unabhängige Quelle für den Fingerabdruck gibt es im Browser
  nicht. R24 bleibt darum in Kapitel 11, verengt auf genau diesen Fall, mit der Bestätigung als
  Gegenmaßnahme.
