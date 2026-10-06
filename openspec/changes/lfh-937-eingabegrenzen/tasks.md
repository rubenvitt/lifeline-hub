# Tasks

## 1. Gemeinsames Muster (D1)

- [ ] 1.1 Unit-Tests in `src/routes/support.rs`: `pflicht_max`, `optional_max`, `pflicht_max_tri` — `max` ok, `max+1` 400 mit Feld und Grenze, Umlaute zählen einfach, Trimmen vor dem Zählen, leer wie `pflicht`. Prüfen: rot vor 1.2.
- [ ] 1.2 Helfer in `src/routes/support.rs`. Prüfen: 1.1 grün.

## 2. ETB-Eingänge (D2)

- [ ] 2.1 `tests/eingabegrenzen_etb.rs`: Erfassung (`inhalt` 20 000 ok / 20 001 400; `von`, `an`, `veranlassung` 500 / 501), Berichtigung, Replay mit derselben `client_id` unverändert, Chat-Nachricht anlegen/bearbeiten, Chat-Heraufstufen (eigener Text und Rückfall), Meldung (`inhalt`, `absender`, `empfaenger`), Nachforderung (`bezeichnung`, `adressat_bezeichnung`, `begruendung`), Vollzugsmeldung; je kein Eintrag nach 400. Prüfen: rot vor 2.2.
- [ ] 2.2 `etb::INHALT_MAX`, `etb::PARTEI_MAX`; Prüfungen in `routes/etb.rs`, `routes/chat.rs`, `routes/meldung.rs`, `routes/nachforderung.rs`, `routes/auftrag.rs` (Vollzug). Prüfen: 2.1 grün, `tests/etb.rs`, `tests/chat.rs`, `tests/meldung.rs` grün.

## 3. Auftrag (D3, D4)

- [ ] 3.1 `tests/eingabegrenzen_auftrag.rs`: 50 Empfänger ok / 51 400 auf allen vier Wegen; drei gleiche Empfänger → eine Zeile in `auftrag_empfaenger`; `auftrag_text` 10 000 / 10 001; `extern_bezeichnung` 200 / 201; ein Befehlsschema-Feld 2 000 / 2 001; 50 Funktionen à 200 Zeichen → ETB-`an` ≤ 500 mit „… und N weitere“. Unit-Tests für `kappe_an` (passt alles, Rest, einzelner Überlanger). Prüfen: rot vor 3.2/3.3.
- [ ] 3.2 `auftrag/eingabe.rs`: Grenzen, Zählen vor dem Entdoppeln, Entdoppeln, Labelkarte einmal je Request. Prüfen: 3.1 (Validierung) grün, `tests/auftrag.rs`, `tests/fuehrungsfunktionen.rs` grün.
- [ ] 3.3 `auftrag/repo.rs`: Anzeigenamen einmal, `kappe_an`, `empfaenger_klartext` entfernt. Prüfen: 3.1 grün; Mutationsprobe: Kappung entfernt → rot.

## 4. Sprechgruppen und Qualifikationen (D5)

- [ ] 4.1 Tests: Dubletten `[7,7,7,8]` → zwei Zuordnungen (Abschnitt, Einheit, Führungsstelle); 32 ok / 33 400; Abschnitts-PATCH mit Lagewechsel und 33 IDs → 400 ohne Lagewechsel; fremde Sprechgruppe weiter 422 mit ID im Text; Qualifikationen 64 / 65, Dubletten, fremde IDs still ignoriert. Unit-Test in `sprechgruppe/repo.rs`: Zahl der Anweisungen von `ersetzen_tx` unabhängig von N (über `sqlx`-Log oder Zählung der Aufrufe). Prüfen: rot vor 4.2–4.4.
- [ ] 4.2 `sprechgruppe::normalisiere_ids`, Aufruf als erster Schritt in Abschnitt, Einheit, Führungsstelle. Prüfen: 4.1 (Routen) grün.
- [ ] 4.3 `pruefe_zuordenbar` und `ersetzen_tx` über `json_each`. Prüfen: 4.1 grün, `tests/sprechgruppe_*.rs`, `tests/einsatzabschnitt*.rs`, `tests/einsatz_einheit.rs`, `tests/einsatz_fuehrungsstelle.rs` grün.
- [ ] 4.4 Qualifikationen: `QUALIFIKATIONEN_MAX`, Entdoppeln im Handler, `setze_qualifikationen` über `json_each`, `patche` in `write_retry!`. Prüfen: 4.1 grün, `tests/personal*.rs`, `tests/qualifikation.rs` grün.

## 5. GeoJSON (D7)

- [ ] 5.1 Unit-Tests für `pruefe_geometrie` (Polygon und LineString gültig, 5 000 / 5 001 Positionen, 10 / 11 Ringe, `["a", 52]`, `NaN` als Zeichenkette, Länge 181, Höhe als dritte Zahl ok, 256 KiB + 1 Byte) und Integrationstests: Zone mit 5 001 Punkten 400, kaputtes JSON weiter 422; erster Integrationstest für `PATCH …/abschnitte/{aid}/flaeche` (gültig, 400, 422). Prüfen: rot vor 5.2.
- [ ] 5.2 `lage_zone::pruefe_geometrie`, Aufruf in `validiere_neu` und in der Flächen-Route. Prüfen: 5.1 grün, `tests/lage_zone.rs`, `tests/gefahr.rs` grün.

## 6. Infotelefon, Presse, Schaden (D6)

- [ ] 6.1 Tests je Feld der Tabelle D6 (`max` ok, `max+1` 400) in `tests/stab_infotelefon.rs`, `tests/stab_presse.rs`, `tests/einsatz_schaden.rs`; bestehende 422 unverändert. Prüfen: rot vor 6.2.
- [ ] 6.2 Grenzen in `routes/infotelefon.rs`, `presse/repo.rs`, `routes/einsatz_schaden.rs`. Prüfen: 6.1 grün.

## 7. Frontend (D8)

- [ ] 7.1 `api/eingabegrenzen.ts` und `tests/eingabegrenzen_spiegel.rs` (liest die Datei, vergleicht jede Konstante mit dem Backend). Prüfen: grün; Mutationsprobe: ein Wert geändert → rot.
- [ ] 7.2 `components/zeichenGrenze.ts` mit Vitest (Zähler unter 80 % aus, ab 80 % „n / max“, Abschneiden an der Grenze, Emoji zählt einfach). Prüfen: rot vor Umsetzung, dann grün.
- [ ] 7.3 ETB: `MarkdownEditor` mit `maxLength`, `Schnellerfassung` (Zähler in der Hinweiszeile, Längenprüfung vor Upload und Queue), `MetaChip` und `RufnameAbfrage` mit `maxLength`, `HeraufstufenModal`. Vitest: zu langer Baustein-Text → kein Senden, kein `queueEinreihen`, Text bleibt. Prüfen: rot vor Umsetzung, dann grün; e2e `leisten-flaeche`, `fokus-verdeckung` grün.
- [ ] 7.4 Auftragsmaske (`AuftragFormular`: Text, Extern-Bezeichnung, Befehlsschema, `maxCount` und Tag-Länge der Empfänger, `initialText` über der Grenze sperrt Senden), Meldungs-, Nachforderungs-, Vollzugs- und Chat-Eingabe mit `maxLength`. Vitest für `AuftragFormular`. Prüfen: grün.
- [ ] 7.5 Infotelefon, Presse, Schaden (Erfassen, Detail, `GeschaedigtPicker` bietet keinen zu langen Kontakt an). Vitest je Maske für Zähler und Grenze. Prüfen: grün.
- [ ] 7.6 Lagekarte: `ZeichnenSteuerung` Hinweis und Sperre über 5 000 Punkten, `onFlaecheGezeichnet` speichert nicht. Vitest. Prüfen: grün.

## 8. Regeln und Gesamtlauf

- [ ] 8.1 `src/AGENTS.md`: Abschnitt „Eingabegrenzen (LFH-937)“ (Helfer, `*_MAX` im Modul, Listen entdoppeln und begrenzen vor der ersten Abfrage, `json_each`, Spiegel und Spiegeltest). `frontend/AGENTS.md`: `zeichenGrenze`, Zähler ab 80 %, Prüfung vor der Queue. Prüfen: Prettier grün.
- [ ] 8.2 Folge-Task im Board für den engeren globalen Body-Limit (Sweep zuerst), nach Duplikatsuche.
- [ ] 8.3 `./scripts/check-all.sh` (Bündel, die in der Cloud-Sitzung laufen), `cargo test`, Vitest der berührten Bereiche, Typecheck, Lint. Prüfen: grün oder umgebungsbedingt rot wie auf `alpha` (Gegenprobe dokumentieren); voller Lauf über die CI des PRs.
