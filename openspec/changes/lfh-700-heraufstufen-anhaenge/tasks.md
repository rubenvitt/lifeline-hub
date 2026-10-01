# Tasks

## 1. Backend: Kopieren beim Heraufstufen (TDD)

- [x] 1.1 `etb::repo::anhaenge_kopieren_tx` (D1/D4/D5): je ID eine Kopie per `INSERT … SELECT` mit Herkunftsfeldern, gebunden über `etb_eintrag_anhang`. Zuerst einen roten Repo-Test: Kopie hat neue id, gleiche Bytes, gleiches `sha256`, gleichen `hochgeladen_von`, und die Quelle bleibt am Chat. Danach grün über `cargo test etb::repo`
- [x] 1.2 `chat::repo::heraufstufen_zu_etb` bekommt `anhang_ids: &[i64]`. In der Transaktion folgen auf die 409-Guards die Prüfung „gehört zur Nachricht“ (400, D3) und erst dann Eintrag, Kopien und Rückverweis. Repo-Tests neben `heraufstufen_legt_etb_an_und_setzt_rueckverweis`: (a) Foto übernommen, (b) ohne Auswahl kein Anhang, (c) Datei einer anderen Nachricht → 400, kein Eintrag, keine neue `anhang`-Zeile, kein Rückverweis, `lfd_nr` nicht verbraucht. Belegt über `cargo test chat::repo`
- [x] 1.3 `routes/chat.rs`: `HeraufstufenBody.anhang_ids` (`#[serde(default)]`), sortieren, deduplizieren, > `MAX_ANHAENGE_JE_EINTRAG` → 400. Integrationstests in `tests/anhang.rs` (dort liegen Upload-/Download-Hilfen): Heraufstufen mit Foto → `GET …/etb/{id}` trägt `anhaenge` mit eigener id; Chat-Download der Quelle weiter 200; ETB-Download der Kopie 200; generischer Download der Kopie 404 und generisches Löschen 422; elf IDs → 400; doppelte ID → eine Kopie; Nachricht danach löschen → Kopie bleibt ladbar. Belegt über `cargo test --test anhang`
- [x] 1.4 Schwärzungstest: Ein Einsatz mit heraufgestuftem Foto wird geschwärzt. Danach sind Quelle und Kopie weg, und der ETB-Eintrag bleibt (neben `schwaerzung_loescht_dokument_samt_anhang_und_haelt_den_etb_nachweis`). Grün über `cargo test einsatz::repo`
- [x] 1.5 Kommentare nachziehen: `anhang::repo::MODUL_LINKER` bzw. `etb::repo::anlegen_idempotent` nennen den zweiten Schreibpfad in `etb_eintrag_anhang`. `src/AGENTS.md`, Abschnitt „Anhänge“, bekommt eine Zeile zu LFH-700: Heraufstufen kopiert, bindet nie die Chat-Datei, Auswahl explizit und ≤ 10. Belegt über `scripts/check-fmt.sh` und `cargo clippy --all-targets` ohne neue Warnung

## 2. Frontend: Auswahl im Dialog (TDD)

- [ ] 2.1 `api/chat.ts` `heraufstufenZuEtb(einsatzId, nachrichtId, typ, inhalt, anhangIds)` sendet `anhang_ids` nur, wenn das Feld nicht leer ist. Vitest prüft den Body in beiden Fällen
- [ ] 2.2 `chat/HeraufstufenModal.tsx` zieht auf `ErfassungsModal` um (D6). Typ, Text und bei Anhängen eine `Checkbox.Group` „Anhänge übernehmen“ mit Dateiname und Größe, die ersten 10 vorgewählt, mehr als 10 abgelehnt, mit Hinweis zur Unveränderlichkeit. Vitest in `HeraufstufenModal.test.tsx`: bestehender Fall (ohne Anhang keine Auswahl, kein Hinweis), zwei Fotos mit einem abgewählt → `onBestaetigen` mit genau dieser ID, elf Anhänge → zehn vorgewählt, ein elfter wird abgelehnt, Enter im Text sendet (Struktur: kein `.ant-modal-footer`, Knopf im `<form>`)
- [ ] 2.3 `pages/ChatPage.tsx` reicht `anhangIds` an die Mutation durch. Vitest bzw. bestehender ChatPage-Test bleibt grün, belegt über `mise exec -- pnpm -C frontend test -- chat`

## 3. Integration und Abschluss

- [ ] 3.1 `./scripts/check-all.sh` läuft grün (Backend, Frontend, Prettier, Lint, Typ-Codegen unverändert)
- [ ] 3.2 Review (`requesting-code-review`), Findings eingearbeitet
- [ ] 3.3 `/opsx:archive lfh-700-heraufstufen-anhaenge` im selben Branch, Spec-Sync nach `openspec/specs/etb-anhaenge/spec.md`, Verweise geprüft
