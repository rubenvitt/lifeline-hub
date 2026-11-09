# Spec Delta

## MODIFIED Requirements

### Requirement: Eigenes Modul mit eigener Freigabe
Das System SHALL ein Einsatzmodul mit dem Key `lagebesprechung` in der Kategorie Führung führen, mit
dem Namen „Lagebesprechung“ und der Seite `/einsaetze/<id>/lagebesprechung`. Seine Freigabe MUST
allein nach den Regeln der Fähigkeit `modul-freigabe` für diesen Key entschieden werden, für Seite,
Einstiege und Endpunkte.

#### Scenario: Stab ausgeblendet
- **WHEN** im Einsatz das Modul Lagebesprechung sichtbar ist
- **THEN** öffnet ein Mitglied die Seite Lagebesprechung, sieht Termin, Vorbereitung und Verlauf, und mit Schreibrecht kann es eine Lagebesprechung abschließen

#### Scenario: Lagebesprechung ausgeblendet
- **WHEN** im Einsatz das Modul Lagebesprechung ausgeblendet ist
- **THEN** beantwortet der Server Lesen und Schreiben der Lagebesprechung mit 403, und Rail, Modulmenü und Palette führen das Modul nicht

### Requirement: Live-Verteilung der Lagebesprechung
Nach Abschluss oder Terminänderung SHALL das System nach dem Commit das Ereignis `lagebesprechung`
verteilen, nur an Abonnenten mit Freigabe des Moduls. Ein Abschluss SHALL daneben `etb`
verteilen. Andere offene Schirme MUST Termin, Zustand und Verlauf ohne Neuladen zeigen.

#### Scenario: Zweiter Schirm
- **WHEN** Schirm B die Seite Lagebesprechung offen hat und auf Schirm A eine Lagebesprechung abgeschlossen wird
- **THEN** zeigt Schirm B die neue Besprechung im Verlauf und den neuen Termin ohne Neuladen

#### Scenario: Leser nur mit Stab-Recht
- **WHEN** ein Mitglied ohne Freigabe der Lagebesprechung den Strom geöffnet hat und eine Lagebesprechung ohne Terminänderung abgeschlossen wird
- **THEN** erhält es weder `lagebesprechung` noch `einsatz`

### Requirement: Einstiege in die Lagebesprechung
Fristenliste des Führungsüberblicks und die Schnellaktion „Lagebesprechung abschließen“ SHALL in
die Seite Lagebesprechung führen und deren Freigabe prüfen. Ist das Modul gesperrt, MUST ein
Einstieg gesperrt mit Grund stehen oder fehlen.

#### Scenario: Schnellaktion
- **WHEN** eine Person mit Schreibrecht und Freigabe der Lagebesprechung in der Palette „Lagebesprechung abschließen“ wählt
- **THEN** öffnet sich die Seite Lagebesprechung mit dem Abschlussdialog

#### Scenario: Stab-Seite
- **WHEN** eine Person die alte Adresse `/einsaetze/:id/stab` aufruft
- **THEN** zeigt die App keine Stab-Seite und keine Zeile zur Lagebesprechung, sondern die Seite
  des Einsatzes

#### Scenario: Marke im Überblick ohne Freigabe
- **WHEN** eine Person ohne Freigabe der Lagebesprechung den Führungsüberblick mit einem gesetzten Termin öffnet
- **THEN** zeigt die Marke „Lagebesprechung“ den Termin, aber keinen Sprung in das Modul

## REMOVED Requirements

### Requirement: Übernahme der Stab-Rollen bei Einführung
**Reason**: Einmalige Übernahme bei Einführung des Moduls (LLH-1111), längst gelaufen; das Modul Stab, von dem sie übernahm, entfällt (LLH-722, Entscheidung 08.11.2026; design.md D1, D4 Migration A löscht alle Freigaben mit `modul_key = 'stab'`).
**Migration**: Keine. Die übernommenen Freigaben der Lagebesprechung bleiben unverändert stehen.
