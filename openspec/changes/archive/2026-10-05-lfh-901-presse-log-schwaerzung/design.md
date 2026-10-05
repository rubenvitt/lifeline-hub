# Design

## Context

Anlass und Abwägung stehen in `proposal.md` (Why). Ausgangslage im Code:

- `src/einsatz/schwaerzung_registry.rs`, Eintrag `medienkontakt`: `kontakt_name` und
  `kontakt_erreichbarkeit` sind `Scrub(NullSetzen, Z_EINSATZ)`, `medium`, `thema`, `antwort`,
  `freigabe_durch` sind `Retain(G_PRESSE_LOG)`. `G_PRESSE_LOG` hat nur diesen Nutzer.
- `migrations/0129_presse.sql`: `medium` und `thema` sind NOT NULL mit
  `CHECK (length(trim(…)) > 0)`; `antwort` ist nullable, aber
  `CHECK (status <> 'beantwortet' OR length(trim(coalesce(antwort, ''))) > 0)`;
  `freigabe_durch` ist nullable ohne CHECK.
- `src/einsatz/schwaerzung_person.rs`: Der Medienkontakt ist Wurzel seiner Personenart
  (`Bezug::SelbstId`); Guard 3 (LFH-751 D5) verlangt an der Wurzel jede Scrub-Spalte als `Mit`.
- Nach der Sperre (`einsatz/berechtigung.rs::darf_lesen`) liest nur die Personensuche
  (`aufbewahrung/suche.rs`) das Presse-Log, und sie liest nur Ansprechperson und Erreichbarkeit.
- Das Presse-Log schreibt kein ETB (`presse/repo.rs`, Modulkopf). Die Ausnahmeliste der ETB-Spur
  ist nicht betroffen.

## Goals / Non-Goals

**Goals:**
- Die vier Spalten tragen eine bewusst entschiedene Klassifikation, die zur Lesbarkeit nach der
  Sperre passt (Akzeptanzkriterium des Tickets).
- Einsatz-Schwärzung und Personen-Vollzug sind durch Tests belegt.

**Non-Goals:**
- Eine Lesestelle für das Presse-Log in der Archivakte (verworfene Option B, D1).
- Das Informationstelefon. Es folgt schon Linie A: Notiz, Name und Rückruf werden gescrubbt,
  `anliegen` ist ein Enum.
- Schon geschwärzte Einsätze nachträglich schwärzen.

## Decisions

### D1 — Das Presse-Log folgt Linie A

Alle vier Freitexte werden bei der Schwärzung des Einsatzes entfernt. Retain bleiben Struktur,
Zeit, Enum und Verweis: `art`, `status`, `eingang_at`, `bearbeitet_at`, `angelegt_at`,
`geaendert_at`, `pressemitteilung_id`, `bearbeitet_von_id`, `angelegt_von_id`.

Begründung wie LFH-701 D1: Der Zweck eines Retain ist Nachweis, und ein Nachweis braucht eine
Stelle, die ihn zeigt. Nach der Sperre hat das Presse-Log keine. Was veröffentlicht wurde, steht
als freigegebene Pressemitteilung im ETB-Wortlaut, und der Verweis darauf bleibt. Das anonyme
Skelett (Zahl der Anfragen je Art und Status, Antwortzeiten) bleibt für die Statistik.

**Verworfen:**
- **B — Retain behalten und eine Lesestelle bauen** (Presse-Log in der Archivakte). Hält
  Betroffenen-Freitext („Anfrage zu Fam. Yilmaz“) über jede Frist hinaus vor, den kein
  Löschersuchen erreicht, weil er an keiner Person hängt (Art. 5 Abs. 1 lit. c und e DSGVO).
  Pressearbeit ist keine gesetzliche Führungsdokumentation, und die Archivakte projiziert nur
  Retain-Spalten; der Bau wäre ein eigenes Vorhaben mit Frontend für einen Zweck, den niemand
  angefragt hat.
- **C — Nur Thema und Antwort scrubben, Medium und Freigabeangabe behalten.** Zwei Regeln für
  eine Tabelle. Ein Medium kann eine Person sein (freie Journalistin), und die Freigabeangabe
  nennt oft einen Namen („EL Müller“). Nach der Sperre ist auch das Medium unlesbar; die
  Statistik „Anfragen je Medium“ hätte keinen Leser.

### D2 — Strategie je Spalte

| Spalte | Strategie | Grund |
| --- | --- | --- |
| `medium` | `Platzhalter` | NOT NULL mit CHECK auf nicht leer |
| `thema` | `Platzhalter` | NOT NULL mit CHECK auf nicht leer |
| `antwort` | `PlatzhalterWennGesetzt` | CHECK verlangt sie bei `beantwortet`; eine leere Antwort bleibt leer (wie `einsatz_schaden.uebergeben_an`, `infotelefon_anruf.rueckruf`) |
| `freigabe_durch` | `NullSetzen` | nullable, kein CHECK |

Alle mit `Z_EINSATZ`: Das Presse-Log hat keine eigene Datenkategorie. Kein UNIQUE-Index, also
kein `PlatzhalterMitId`.

### D3 — Personen-Vollzug: alle vier `Mit`

Der Medienkontakt ist die Wurzel seiner Personenart. Guard 3 verlangt dort jede Scrub-Spalte als
`Mit`; die Regel bleibt. Inhaltlich passt sie: Der Eintrag ist die Anfrage dieser Person, wie die
Notiz am Informationstelefon der Anruf der anrufenden Person ist (dort ebenfalls `Mit`). Ein
vollzogenes Löschersuchen lässt den Medienkontakt als Skelett stehen.

**Verworfen:** `Ohne` für Thema und Antwort mit einer Ausnahme von Guard 3. Bräuchte eine zweite
Regel im Guard, und das Löschersuchen der Person ließe gerade ihre Frage stehen.

### D4 — Begründung und Kommentare

`G_PRESSE_LOG` entfällt. Der Abschnittskommentar am Registry-Eintrag nennt Linie A und LFH-901.
Der Modulkopf von `presse/repo.rs` („das Log ist selbst der Nachweis der Pressearbeit“) wird
ehrlich: Das Log ist Arbeitsstand, nachgewiesen wird die freigegebene Pressemitteilung im ETB.

### D5 — Audit-Text

`schwaerzungs_audit` nennt unter dem Entfernten „die Freitexte der Führungsmodule (…) und des
Presse-Logs“. Der Audit-Test in `src/einsatz/repo.rs` prüft den neuen Wortlaut.

## Risks / Trade-offs

- [Nach der Schwärzung lässt sich nicht mehr belegen, was ein Medium gefragt und was die
  Pressestelle geantwortet hat] → Gewollt nach D1. Bis zur Schwärzung liegen Aufbewahrungsfrist
  und Karenz; wer einen Medienkontakt länger belegen muss, gibt eine Pressemitteilung frei und
  verweist darauf, dann steht der Text im ETB.
- [Ein vollzogenes Löschersuchen nimmt am noch lesbaren, abgeschlossenen Einsatz auch Thema und
  Antwort aus dem Presse-Log] → Gewollt nach D3; die Presseseite zeigt den Platzhalter, wie das
  Informationstelefon nach einem Vollzug.
- [Die Medienlage übernimmt das Medium in den Lagevortrag] → Das geschieht im Client per „Aus S5
  übernehmen“ in den Abschnittstext des Lageberichts (`frontend/src/stab/medienlage.ts`, ohne
  Thema und Personenbezug). Der Abschnitt folgt dem Lagebericht: Entwürfe werden gescrubbt, der
  freigegebene Wortlaut bleibt im ETB (LFH-701). Kein neuer Schreibweg, keine neue Zeile in der
  Ausnahmeliste der ETB-Spur.

## Migration Plan

Keine Datenbankmigration. Die Änderung wirkt auf jede künftige Schwärzung und jeden künftigen
Personen-Vollzug. Bereits geschwärzte Einsätze bleiben, wie sie sind. Rücknahme: Registry-Einträge
zurück auf Retain, Markierungen entfernen.
