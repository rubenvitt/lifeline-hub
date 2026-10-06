## 1. Nachweis zuerst (D4)

- [ ] 1.1 Test `tests/modul_zaehler_abfragen.rs`: globaler Tracing-Layer zählt `sqlx::query`-Ereignisse; `berechne` mit allen Modulen auf leerem Einsatz und nach 200 Aufträgen × 3 Empfängern, 300 Meldungen, Erinnerungen und Chat-Nachrichten → gleich viele Statements, höchstens neun. Vorher rot (Listenpfad).

## 2. Backend: Fragmente und Zählfunktionen (D1, D2)

- [ ] 2.1 Reine Zählregeln gewichtet: `zaehle_meldungen_gewichtet`, `zaehle_auftraege_gewichtet`; die ungewichteten rufen sie mit Gewicht 1. Unit-Test: Gewicht n zählt wie n gleiche Zeilen. `tests/verdichtung_fixture.rs` bleibt unverändert grün.
- [ ] 2.2 Meldung: Fragmente `ist_offen_sql!`, `ist_bestaetigt_sql!`, `ist_ueberfaellig_sql!` in `ANZEIGE_SELECT`; `meldung::repo::zaehlen` gruppiert nach Merkmalen.
- [ ] 2.3 Auftrag: Fragment `ist_ueberfaellig_sql!` in `ANZEIGE_SELECT`; `auftrag::repo::zaehlen` gruppiert nach Bearbeitungsstatus und Überfälligkeit, ohne Empfänger zu laden.
- [ ] 2.4 Erinnerung: Fragment `ist_faellig_sql!` in `ANZEIGE_SELECT`; `erinnerung::repo::faellige_offene` per `COUNT(*)`.
- [ ] 2.5 Chat: Fragment `ungelesen_sql!` in `kanaele_lesen`; `chat::repo::ungelesen_gesamt` per `COUNT(*)` ohne `GROUP BY`, rein lesend.

## 3. Backend: `berechne` umstellen (D3)

- [ ] 3.1 `berechne` nutzt die Zählfunktionen aus 2; Modulkopf umformulieren. 1.1 wird grün.
- [ ] 3.2 `tests/modul_zaehler.rs` unverändert grün (insbesondere `kommunikationszaehler_entsprechen_den_listen`, `bestaetigung_ueberfaellig_zaehlt_wie_die_liste`, `chat_zaehlt_je_benutzer`, `zaehlen_legt_keinen_chat_kanal_an`), dazu `tests/verdichtung_fixture.rs` und die Listentests von Meldung, Auftrag, Erinnerung und Chat.
- [ ] 3.3 Mutationsproben: je ein Fragment verändert (Meldung `ist_offen`, Auftrag `ist_ueberfaellig`, Erinnerung `ist_faellig`, Chat `ungelesen`) → mindestens ein Test rot; ein Merkmal aus dem `GROUP BY` der Meldungen entfernt → Paritätstest rot; Listenpfad zurück → 1.1 rot.

## 4. Frontend: eigenes Sammelfenster für den Modulzähler (D5)

- [ ] 4.1 Test zuerst (`liveInvalidierung.test.ts`): `erzeugeLiveSammler(qc, 1000)` invalidiert nach 1000 ms, nicht nach 300 ms.
- [ ] 4.2 Test zuerst (`useEinsatzLiveStream.test.tsx`): zehn `meldung`-Ereignisse in 500 ms → genau ein Invalidate von `modulZaehler` nach 1 s; `meldungen` weiterhin im 300-ms-Fenster; `lagged` merkt `modulZaehler` ebenfalls im 1-s-Fenster vor.
- [ ] 4.3 `liveInvalidierung.ts`: Parameter `fensterMs`, Konstante `ZAEHLER_SAMMELFENSTER_MS`; `useEinsatzLiveStream`: zweiter Sammler für `modulZaehler`, Cleanup räumt beide. Mutationsprobe: `modulZaehler` über den Listensammler → 4.2 rot.
- [ ] 4.4 `queryKeys.test.ts` und `verdichtungFixture.test.ts` grün.

## 5. Regeln und Abschluss

- [ ] 5.1 `frontend/AGENTS.md` („Query-Key-Registry“) und `frontend/src/etb/AGENTS.md` („Modulzähler“) nach D6.
- [ ] 5.2 Lint, Typecheck, Vitest der berührten Dateien, Rust-Suite; `scripts/check-typ-codegen.sh` bestätigt: keine DTO-Änderung.
- [ ] 5.3 `./scripts/check-all.sh` (Bündel `schnell`, Rust, Vitest; der Gesamtlauf in der CI).
