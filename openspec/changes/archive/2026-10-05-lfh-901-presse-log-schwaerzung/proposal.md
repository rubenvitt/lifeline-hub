# Proposal

## Why

LFH-701 hat für die Schwärzung Linie A entschieden: Die Führungsdokumentation ist allein der
ETB-Wortlaut, die Freitexte der Führungsmodule werden entfernt. Das Presse-Log (`medienkontakt`)
blieb dabei bewusst außen vor. `medium`, `thema`, `antwort` und `freigabe_durch` sind Retain
`G_PRESSE_LOG` („das Log ist selbst der Nachweis der Pressearbeit“, LFH-554 D9). Diese Begründung
hält der Prüfung nicht stand:

- **Nach der Sperre liest niemand das Presse-Log.** Die Routen unter `stab/medienkontakte` sind
  gesperrt, die Archivakte projiziert nur Kopf, Register und ETB (`aufbewahrung/projektion.rs`),
  und die Personensuche liest nur Ansprechperson und Erreichbarkeit. Ein Nachweis, den keine
  Funktion zeigt, ist keiner. Das ist dasselbe Argument, das in LFH-701 die Führungsmodule
  getragen hat.
- **Thema und Antwort tragen Betroffenen-Freitext** („Anfrage zu Fam. Yilmaz“, „Vermisste Person
  aus der Deichstraße gefunden“). Kein Personen-Löschersuchen erreicht ihn, weil er an keiner
  Person hängt. Ohne Scrub überlebt er jede Frist.
- **Medium und Freigabeangabe sind Freitext mit möglichem Personenbezug.** Ein Medium kann eine
  freie Journalistin sein, die Freigabeangabe nennt oft den Namen der Einsatzleitung.
- **Was veröffentlicht wurde, steht schon im ETB.** Eine Antwort, die auf eine Pressemitteilung
  verweist, behält den Verweis (`pressemitteilung_id`); der freigegebene Text steht im
  ETB-Wortlaut.

## What Changes

- **Entscheidung:** Das Presse-Log folgt Linie A. `medium`, `thema`, `antwort` und
  `freigabe_durch` werden bei der Schwärzung des Einsatzes entfernt. Erhalten bleiben Art,
  Status, Eingang, Bearbeitungs- und Änderungszeitpunkte, die Verweise auf Benutzer und auf die
  Pressemitteilung. Damit bleibt das anonyme Skelett: wie viele Anfragen, Abstimmungen und
  Termine es gab, wie viele beantwortet oder abgelehnt wurden und wie schnell.
- Strategie je Spalte nach den Constraints von `0129_presse.sql`: `medium` und `thema` Platzhalter
  (NOT NULL), `antwort` Platzhalter nur wenn gesetzt (ein CHECK verlangt sie bei `beantwortet`),
  `freigabe_durch` NULL.
- `G_PRESSE_LOG` entfällt.
- Ein Löschersuchen für eine Ansprechperson entfernt künftig auch diese vier Freitexte. Der
  Medienkontakt ist die Wurzel seiner Personenart, und an der Wurzel ist jede Scrub-Spalte
  personengebunden (LFH-751 D5, Guard 3). So hält es schon die Notiz des Informationstelefons:
  Der Eintrag ist die Anfrage dieser Person.
- Der Audit-Text der Schwärzung nennt die Freitexte des Presse-Logs unter dem Entfernten.

## Capabilities

### New Capabilities

_keine_

### Modified Capabilities

- `stab-presse-log`: Die Anforderung „Datenschutz der Kontaktdaten“ hält Medium, Thema und
  Antwort nicht mehr als Nachweis vor; die Schwärzung entfernt sie samt Freigabeangabe, die
  Struktur bleibt.
- `aufbewahrung-loeschersuchen`: Das Szenario „Anrufende Person und Ansprechperson“ der
  Anforderung „Vollzug für eine Person“ behält Medium und Thema nicht mehr; der Vollzug für eine
  Ansprechperson entfernt alle Freitexte ihres Eintrags.

## Impact

- Backend: `src/einsatz/schwaerzung_registry.rs` (Klassifikation, `G_PRESSE_LOG` entfällt),
  `src/einsatz/schwaerzung_person.rs` (`Mit`-Markierung der vier Spalten) samt Testdaten und
  Test des Personen-Vollzugs,
  `src/einsatz/repo.rs` (Audit-Text, Audit-Test), `src/einsatz/purge_scheduler.rs`
  (Verhaltenstest kehrt sich um), Modulkopf `src/presse/repo.rs`.
- Keine Migration, keine API-, DTO- oder Frontend-Änderung. Wirkt nur auf Einsätze, die künftig
  geschwärzt werden; schon geschwärzte behalten ihre Presse-Log-Texte (die Schwärzung ist
  idempotent und läuft nicht erneut).
