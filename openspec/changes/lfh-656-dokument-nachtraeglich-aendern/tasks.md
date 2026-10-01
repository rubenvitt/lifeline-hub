# Tasks

## 1. Backend: Prüfregeln teilen (Refactor unter Testschutz)

- [ ] 1.1 `validiere` in `src/routes/dokument.rs` in `pruefe_titel`, `pruefe_kategorie` und
      `pruefe_bezug` zerlegen (D1), `validiere` ruft sie auf. Prüfung: Alle Ablege-Tests in
      `tests/dokument.rs` (u. a. `leerer_titel_ist_400`, `bezug_typ_ohne_id_ist_422`,
      `bezug_auf_fremden_abschnitt_ist_400`) bleiben unverändert grün.

## 2. Backend: PATCH-Endpunkt (TDD)

- [ ] 2.1 Tests in `tests/dokument.rs` zuerst rot schreiben, je Szenario der Spec: Titel und
      Kategorie ändern (200, Datei unverändert per Download), Bezug setzen, Bezug wechseln, Bezug
      mit `null`/`null` entfernen, nur Titel genannt lässt Kategorie und Bezug stehen, leerer und
      zu langer Titel 400, unbekannte Kategorie 400, unbekannter `bezug_typ` 400, fremder
      Abschnitt 400, `bezug_typ` ohne `bezug_id` 422 (auch `null` gegen Wert), leere Anfrage 400,
      Beobachter 403, abgeschlossener Einsatz 409, entferntes und fremdes Dokument 404. Prüfung:
      `cargo test --test dokument` scheitert an genau diesen neuen Fällen.
- [ ] 2.2 `repo::aendern` in `src/dokument/repo.rs`: in einer Transaktion (`write_retry!`) alten
      Stand samt Bezugsnamen lesen (fremd/gelöscht → 404), Bezug mit `bezug_pruefen` prüfen,
      Unterschied bilden, bei Wirkung UPDATE und `etb::system_audit_tx` mit dem Wortlaut aus D2;
      liefert `Option<etb_id>` (keine Wirkung → `None`). Prüfung: Die Tests aus 2.1 zu Feldern
      und Bezug werden grün, sobald 2.3 steht.
- [ ] 2.3 Handler `aendern` mit `PatchBody` (D1, dreiwertiger Bezug über
      `deserialize_optional_field`) in `src/routes/dokument.rs`, Gate
      `EinsatzSchreibzugriff<Dokumente>`. Route in `src/app.rs` an `/{did}` mit `.patch(...)`
      ergänzen. Mit `Some(etb_id)` `publiziere` und `sse` wie beim Ablegen. Prüfung: Alle Tests
      aus 2.1 sind grün.
- [ ] 2.4 ETB-Nachweis testen (zuerst rot): eine Titeländerung schreibt genau einen
      System-Eintrag, der mit „Dokument geändert:“ beginnt und alten wie neuen Titel nennt; ein
      Bezugswechsel nennt „Abschnitt <Name>“ bzw. „ohne“; unveränderte Werte schreiben keinen
      Eintrag. Prüfung: `cargo test --test dokument` grün.

## 3. Frontend: API und Bezug-Helfer

- [ ] 3.1 `aendereDokument(einsatzId, dokumentId, aenderung)` in `frontend/src/api/dokumente.ts`
      (`apiSend` mit `PATCH`, Typ `DokumentAenderung` handgepflegt nach D1). Prüfung:
      `tsc --noEmit` grün.
- [ ] 3.2 `frontend/src/dokumente/bezug.ts` anlegen: `bezugWert(dokument)`, `bezugAusWert(wert)`
      und `useBezugOptionen(einsatzId, { offen, etbLaden, aktuell })` samt Ergänzung des
      aktuellen Bezugs, wenn er nicht in den geladenen Optionen liegt (D4). Unit-Tests zuerst rot:
      Hin- und Rückweg je Bezugstyp, unbekannter Präfix fällt weg, ETB-Bezug außerhalb der Liste
      erscheint als „ETB <lfd_nr>“. Prüfung: `vitest run src/dokumente/bezug` grün.
- [ ] 3.3 `DokumentAblegenModal.tsx` auf die Helfer aus 3.2 umstellen, ohne Verhalten zu ändern.
      Prüfung: `DokumentAblegenModal.test.tsx` unverändert grün.

## 4. Frontend: Bearbeiten-Dialog (TDD)

- [ ] 4.1 `DokumentBearbeitenModal.test.tsx` zuerst rot: Vorbelegung von Titel, Kategorie und
      Bezug (auch ETB-Bezug außerhalb der jüngsten 100), drei sichtbare Felder ohne Collapse,
      „Speichern“ sendet `titel`, `kategorie` und das Bezugspaar (geleerter Bezug als
      `null`/`null`), Ablehnung lässt Felder stehen und zeigt den Fehler im Dialog, Absende-Knopf
      liegt im `<form>`. Prüfung: Tests scheitern, weil die Komponente fehlt.
- [ ] 4.2 `frontend/src/dokumente/DokumentBearbeitenModal.tsx` nach D4 auf `ErfassungsModal`
      bauen (Titel „Dokument bearbeiten“, Knopf „Speichern“, `setFieldsValue` beim Öffnen,
      `mutateAsync`, Toast „Dokument geändert“, Invalidierung von Dokumenten und ETB). Prüfung:
      Tests aus 4.1 grün.

## 5. Frontend: Zeilen- und Kartenaktion (TDD)

- [ ] 5.1 `DokumentePage.test.tsx` zuerst rot: Tabelle zeigt je Zeile „Dokument <Titel>
      bearbeiten“ neben „Entfernen“, der Klick öffnet den vorbelegten Dialog; Karte zeigt
      „Bearbeiten“ als Primäraktion und „Entfernen“ im Menü „Aktionen zu Dokument <Titel>“ mit
      Rückfrage-Modal (rotes OK); Beobachter sieht weder „Bearbeiten“ noch das Menü. Prüfung:
      Die neuen Fälle scheitern.
- [ ] 5.2 `DokumentePage.tsx` nach D5 umbauen: Aktionsspalte mit `<Space size="middle">`,
      `IkoneStift`-Knopf, Kartenplan mit `aktion` Bearbeiten und `weitere` Entfernen (`gefahr`),
      Seiten-`<Modal>` für die Karten-Rückfrage, Zustand `inBearbeitung: Dokument | null`. Den
      Dateikopf („── Entfernen ──“) auf zwei Aktionen nachziehen. Prüfung: `DokumentePage.test.tsx`
      und `aktionsabstand.guard.test.ts` grün.
- [ ] 5.3 e2e-Fall in der bestehenden Dokumente-Suite unter `frontend/e2e/` ergänzen (Regeln in
      `frontend/e2e/AGENTS.md`): Dokument ablegen, über „Bearbeiten“ Titel ändern, neue Zeile und
      ETB-Eintrag „Dokument geändert:“ sichtbar. Prüfung: Der Fall läuft lokal grün.

## 6. Nachweis und Abschluss

- [ ] 6.1 Prüfliste `docs/superpowers/specs/2026-09-22-lfh-632-pruefliste.md` ist eingefrorenes
      Archiv und bleibt unangetastet. Stattdessen im ClickUp-Task LFH-656 die Belegstellen
      (Tests aus 2–5) nennen. Prüfung: Kommentar am Task vorhanden.
- [ ] 6.2 `./scripts/check-all.sh` läuft grün (bzw. in der CI des PRs). Prüfung: Ausgabe ohne
      roten Schritt.
