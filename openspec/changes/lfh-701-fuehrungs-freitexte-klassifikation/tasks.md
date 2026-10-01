# Tasks

Jede Aufgabe per TDD: erst der rote Test, dann die Registry-Änderung.

## 1. Verhalten festlegen (Test zuerst)

- [x] 1.1 Verhaltenstest `schwaerzung_entfernt_fuehrungs_freitexte_und_haelt_das_etb` in
  `src/einsatz/repo.rs`: Meldung, Auftrag mit externem Empfänger und Fünf-Punkte-Text, Vollzug,
  Nachforderung (abgelehnt), Lagebericht (freigegeben und Entwurf), Befehl, Pressemitteilung und
  Lagebesprechung mit gepflanzten Werten anlegen, schwärzen; prüfen, dass jede Spalte aus D2
  NULL, Platzhalter bzw. `[]` trägt, Struktur (lfd_nr, meldeweg, status, zeitstand, Zeitpunkte)
  bleibt und der ETB-Wortlaut die gepflanzten Werte weiter enthält. Verifikation: Test ist rot
  gegen den heutigen Stand.
- [x] 1.2 `tests/stab.rs::schwaerzung_laesst_den_entschluss_stehen` umkehren (Entschluss trägt den
  Platzhalter, ETB-Eintrag behält ihn). Verifikation: rot gegen den heutigen Stand.

## 2. Registry

- [x] 2.1 Strategie `LeeresJsonArray` (`col = '[]'`) in `Strategie` und `scrubbe_aus_registry`
  ergänzen; das Ergebnis (`[]`) belegt der Verhaltenstest aus 1.1 für alle drei Vorlagendokumente.
  Verifikation: 1.1 grün.
- [x] 2.2 Spalten nach D2 umklassifizieren (`meldung`, `auftrag`, `auftrag_empfaenger`,
  `nachforderung`, `lagebericht`, `befehl`, `pressemitteilung`, `einsatz_lagebesprechung`);
  `meldeweg` auf `G_ENUM`, `zeitstand` auf `G_ZEIT`; REVIEW-Vermerke an `auftrag_empfaenger` und
  die Kopplungskommentare (Lagebesprechung, Pressemitteilung, Chat-Abschnitt) nachziehen.
  Verifikation: 1.1 und 1.2 grün, Registry-Guards grün.
- [x] 2.3 `G_FUEHRUNG` entfernen, `medienkontakt` auf eine neue Konstante `G_PRESSE_LOG` mit dem
  tatsächlichen Grund (D5). Verifikation: `grep -n "G_FUEHRUNG\|REVIEW LFH-229"` in
  `src/` leer; `cargo test --lib schwaerzung_registry` grün.

## 3. Audit und ETB-Spur

- [x] 3.1 Audit-Text in `schwaerze_einsatz` und Doc-Kommentar nach D7 umschreiben; Asserts im
  Test aus 1.1 auf den neuen Text (entfernt, erhalten, kein Overclaim) und den bestehenden
  Chat-Test angleichen. Verifikation: beide Tests grün.
- [x] 3.2 `AUSNAHMEN_SYSTEM_ETB` in `tests/aufbewahrung_e2e.rs` um die Schreibwege aus D6
  ergänzen (Funktionsnamen am Code ablesen). Verifikation: `cargo test --test aufbewahrung_e2e`
  grün, Selbsttest der Liste grün.

## 4. Abschluss

- [x] 4.1 Folgeticket „Presse-Log nach Linie A abwägen“ über `clickup-task-anlegen` anlegen und
  in D5 verlinken (LFH-901).
- [x] 4.1a Review-Befunde: `nachforderung.art` ist Freitext ohne Katalog und wird gescrubbt;
  `tests/fuehrungsfunktionen.rs` erwartet den Platzhalter am Snapshot; Delta-Spec
  `fuehrungsfunktionen`; veraltete Kommentare (`auftrag/repo.rs`, `fuehrung/aufloesung.rs`,
  `purge_scheduler.rs`, Registry-Abschnitt, `frontend/src/fuehrung/AGENTS.md`). Verifikation:
  betroffene Tests grün, `openspec validate --strict` gültig.
- [ ] 4.2 `./scripts/check-all.sh` grün (bzw. die Backend-Schritte lokal, das ganze Gate in der
  CI des PRs).
