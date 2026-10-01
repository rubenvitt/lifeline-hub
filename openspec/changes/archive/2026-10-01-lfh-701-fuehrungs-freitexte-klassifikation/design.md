# Design

## Context

Motivation in `proposal.md`. Grundlage ist die Durchsicht vom 01.10.2026 über alle Schreibwege
der betroffenen Spalten:

| Spalte | Wörtlich im ETB? | Nullable |
| --- | --- | --- |
| `meldung.absender` / `empfaenger` / `inhalt` | ja, als `von` / `an` / `inhalt`, nur bei Auto-ETB an (`meldung/repo.rs`, `anlegen_mit_client_id_tx`) | nein / ja / nein |
| `meldung.meldeweg` | ja, Enum | nein |
| `auftrag.auftrag_text` | ja, Anordnung `inhalt`, nur bei Auto-ETB an (`auftrag/repo.rs`, `anlegen_tx`) | nein |
| `auftrag.absicht` … `sicherheit` | **nein** | ja |
| `auftrag.vollzugsmeldung` | ja, immer (`auftrag/repo.rs`, Vollzug) | ja |
| `auftrag_empfaenger.snap_anzeige` | ja, verkettet in `an` der Anordnung | nein |
| `auftrag_empfaenger.funktion_text` / `extern_bezeichnung` | ja, über `snap_anzeige` | ja / ja |
| `nachforderung.art` / `bezeichnung` / `adressat_bezeichnung` / `begruendung` | ja, immer (`inhalt` / `inhalt` / `an` / `veranlassung`) | nein / nein / ja / ja |
| `nachforderung.abgelehnt_grund` | **nein** | ja |
| `lagebericht` / `befehl` / `pressemitteilung` `.titel`, `.abschnitte` | ja, nur freigegebene Versionen (`vorlagendokument`) | nein |
| `… .zeitstand` | ja, Zeitpunkt | nein |
| `einsatz_lagebesprechung.entschluss` | ja (`stab/mod.rs`) | nein |

Keine dieser Spalten liegt unter einem UNIQUE-Index oder einem CHECK. Kein Code schließt aus
`IS NULL` einer dieser Spalten auf einen Zustand. Gelesen werden sie nach der Sperre von
niemandem: Die Archivakte projiziert nur Kopf, Register und ETB
(`aufbewahrung/projektion.rs`), die Rückverweise des ETB auf die Module bewusst nicht.

## Goals / Non-Goals

**Goals:**
- Jede der genannten Spalten trägt eine bewusste, begründete Klassifikation. Kein REVIEW-Vermerk
  bleibt.
- Die Begründung jedes verbleibenden Retain stimmt.
- Verhaltenstest und Audit-Text sagen, was die Registry tut.

**Non-Goals:**
- Den ETB-Wortlaut ändern. Ob künftige ETB-Einträge Scrub-Werte weglassen, entscheidet LFH-752.
- Das Presse-Log (`medienkontakt`) neu abwägen. LFH-554 D9 hat es bewusst als Retain geführt;
  hier bekommt es nur eine ehrliche Begründung (D5).
- Schon geschwärzte Einsätze nachträglich schwärzen.

## Decisions

### D1 — Linie A: Das ETB ist die Führungsdokumentation, die Module sind Arbeitsstand

Jeder Freitext eines Führungsmoduls wird gescrubbt. Retain bleiben Struktur, Zeit, Enum,
Zähler und Verweis.

- Der Zweck des Retain ist Nachweis. Nach der Sperre kann kein Nachweis aus den Modultabellen
  geführt werden, weil keine Funktion sie liest. Was als Nachweis bleibt, steht im ETB, und das
  ETB bleibt unverändert.
- Die Regel ist eine einzige, ohne Fallunterscheidung je Schreibweg. Neue Führungs-Freitexte
  lassen sich danach ohne Abwägung einordnen.
- Sie folgt der Linie, die die Registry schon geht: `einsatz_schaden.ort`, `lage_zone.label`,
  `einsatz_dokument.titel`, `einsatz_personal.snap_name` werden in der Zeile gescrubbt und
  stehen über die Ausnahmeliste weiter im ETB.

**Verworfen:**
- **B — Retain behalten, nur die Begründung schärfen.** Hält Personenbezug ohne Zweck vor
  (Art. 5 Abs. 1 lit. c und e DSGVO). Löst den Widerspruch bei `snap_anzeige` nicht: Der
  Name, den `einsatz_personal.snap_name` verliert, bliebe am Auftragsempfänger stehen.
- **C — Nur scrubben, was wörtlich im ETB steht; den Rest als einzige Quelle behalten.** Kehrt
  den Nutzen um. Das Scrubben einer ETB-Kopie entfernt keinen Personenbezug, denn er steht im
  ETB weiter. Behalten würde gerade der Teil, den nirgends sonst jemand hat. Auch dieser Teil
  ist nach der Sperre unlesbar, also kein Nachweis. Eine Zeilenvariante über `etb_*_id IS NULL`
  hätte dasselbe Problem und bräuchte zwei Regeln je Tabelle.

### D2 — Strategie je Spalte

| Tabelle | Scrub | Retain (neue Begründung) |
| --- | --- | --- |
| `meldung` | `absender` Platzhalter, `empfaenger` NULL, `inhalt` Platzhalter | `meldeweg` (`G_ENUM`) |
| `auftrag` | `auftrag_text` Platzhalter; `absicht`, `lage`, `ort`, `zeit`, `mittel`, `verbindung`, `sicherheit`, `vollzugsmeldung` NULL | — |
| `auftrag_empfaenger` | `snap_anzeige` Platzhalter; `funktion_text`, `extern_bezeichnung` NULL | — |
| `nachforderung` | `art` (Freitext ohne Katalog, „RTW“, „Dolmetscher“) und `bezeichnung` Platzhalter; `adressat_bezeichnung`, `begruendung`, `abgelehnt_grund` NULL | — |
| `lagebericht`, `befehl`, `pressemitteilung` | `titel` Platzhalter, `abschnitte` leeres JSON-Array | `zeitstand` (`G_ZEIT`) |
| `einsatz_lagebesprechung` | `entschluss` Platzhalter | — |

Platzhalter genau dort, wo die Spalte NOT NULL ist; sonst NULL. `PlatzhalterMitId` braucht
keine, weil kein UNIQUE-Index betroffen ist.

`auftrag_empfaenger.snap_anzeige` wird auch bei Einheiten, Abschnitten und Fahrzeugen
gescrubbt. Deren Bezeichnung bleibt über den Verweis (`einheit_id` …) und im ETB erhalten. Eine
Zeilenunterscheidung nach `empfaenger_typ` wäre eine zweite Regel für wenig Gewinn.

### D3 — Neue Strategie `LeeresJsonArray`

`abschnitte` ist ein JSON-Array, das `vorlagendokument::repo::zu_dokument` beim Laden
deserialisiert. `[geschwärzt]` wäre kein gültiges JSON und gäbe 500. Die Strategie setzt
`col = '[]'`. `[]` ist gültig und bedeutet „keine Abschnitte“. Gelesen wird es nach der
Schwärzung ohnehin nicht, aber ein kaputter Wert in der Datenbank ist eine Falle für jede
künftige Lesestelle.

**Verworfen:** ein JSON-Platzhalter je Abschnitt (`[{"schluessel":…,"text":"[geschwärzt]"}]`).
Bräuchte SQL-JSON-Umbau je Zeile und behielte die Gliederung, die nichts aussagt.

### D4 — Entschluss und Pressemitteilung gehen mit

Der Kommentar an `einsatz_lagebesprechung` koppelt `entschluss` ausdrücklich an Lagebericht und
Befehl („eine andere Linie gälte nur für alle drei gemeinsam“). Die Pressemitteilung teilt den
Kern `vorlagendokument` und dieselbe Begründung. Ihre freigegebene Fassung ist veröffentlicht
und steht im ETB; Entwürfe sind es nicht. Beide folgen deshalb Linie A.
`tests/stab.rs::schwaerzung_laesst_den_entschluss_stehen` kehrt sich um.

### D5 — `G_FUEHRUNG` entfällt, das Presse-Log bekommt `G_PRESSE_LOG`

Nach D2 nutzt nur noch `medienkontakt` (medium, thema, antwort, freigabe_durch) die Konstante.
Deren Text („bei Freigabe ins ETB gesnapshottet“) stimmt dort nicht: Das Presse-Log schreibt
kein ETB (`presse/repo.rs`, Modulkopf). Neue Konstante mit dem tatsächlichen Grund (das Log ist
selbst der Nachweis der Pressearbeit, LFH-554 D9). Ob das nach Linie A so bleiben soll, ist eine
eigene Abwägung und steht als Folgeticket LFH-901 auf dem Board.

### D6 — Ausnahmeliste der ETB-Spur

Mit D2 übernehmen diese Schreibwege einen Scrub-Wert in den ETB-Wortlaut und gehören in
`AUSNAHMEN_SYSTEM_ETB` (`tests/aufbewahrung_e2e.rs`): Meldung anlegen (absender, empfaenger,
inhalt), Auftrag anlegen (auftrag_text sowie snap_anzeige, funktion_text, extern_bezeichnung über den
Empfänger-Snapshot), Vollzug (vollzugsmeldung), Nachforderung
anlegen (art, bezeichnung, adressat_bezeichnung, begruendung), Freigabe eines Vorlagendokuments
(titel, abschnitte der drei Tabellen; `vorlagendokument/repo.rs::freigeben_tx`, dort entsteht der
Snapshot) und Lagebesprechung abschließen (entschluss). Der
Selbsttest der Liste prüft Funktionsname und Scrub-Klassifikation. Der Selbsttest erkennt
seit LFH-701 auch generische Funktionen (`fn name<…>`), weil `snapshot_freigeben_tx` eine ist.

### D7 — Audit-Text

Der Text in `schwaerze_einsatz` nennt bisher „die Führungs-Dokumentation (ETB, Meldungen,
Aufträge, Lage-/Befehlsberichte …)“ als erhalten. Neu: Die Freitexte der Führungsmodule
(Meldungen, Aufträge, Nachforderungen, Lageberichte, Befehle, Pressemitteilungen,
Lagebesprechungen) sind entfernt; deren Struktur bleibt; die Führungsdokumentation bleibt im
ETB im Wortlaut. Der Verhaltenstest prüft beides und dass kein Overclaim bleibt.

## Risks / Trade-offs

- [Einsätze mit abgeschaltetem Auto-ETB verlieren Meldungs- und Auftragstexte vollständig] →
  Gewollt nach D1: Was nicht im ETB steht, ist nicht die Führungsdokumentation. Bis zur
  Schwärzung liegen Aufbewahrungsfrist und 30 Tage Karenz, in denen der Einsatz
  wiederhergestellt werden kann. In der Abschlussmeldung erwähnen.
- [Der Platzhalter in `auftrag_empfaenger.snap_anzeige` verliert auch harmlose Einheitsnamen] →
  Bezeichnung bleibt über den Verweis und im ETB (D2).
- [Eine künftige Lesestelle (etwa eine erweiterte Archivakte) erwartet Modultexte] → Die Akte
  ist eine Retain-Projektion mit Guard (`jede_archivspalte_ist_retain`); eine Scrub-Spalte dort
  macht den Test rot.

## Migration Plan

Keine Datenbankmigration. Die Änderung wirkt auf jede künftige Schwärzung. Bereits geschwärzte
Einsätze bleiben, wie sie sind; die Schwärzung ist idempotent und läuft an ihnen nicht erneut.
Rücknahme: Registry-Einträge zurück auf Retain.
