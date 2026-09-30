# Betreuung und Verpflegung — Regeln

Gilt für `frontend/src/betreuung/`, `frontend/src/verpflegung/`, `pages/VerpflegungPage.tsx`
und die Server-Gegenstücke `src/betreuung/`, `src/verpflegung/`; ergänzt `frontend/AGENTS.md`.
Pfade relativ zu `frontend/src/`, sofern nicht `src/…` (Server).

- **Verbleib → Betreuungsstelle** (LFH-674,
  `openspec/changes/archive/2026-09-29-lfh-674-verbleib-notunterkunft-betreuungsstelle/design.md`): nur die Kennung
  (`person_verbleib.betreuungsstelle_id`, Cache
  `einsatz_person.aktuelle_verbleib_betreuungsstelle_id`), den Namen belegt der Client vor; der Server kopiert
  keinen Stellennamen (Ziel, Kurzform, ETB). Prüfkette 422 → 403 (vor jedem Lesen) → 404 → 409.
  „davon namentlich n" rechnet `…/betreuung`, nicht `repo::uebersicht`; ohne Personenrecht fehlt
  es. Live über `EINSATZ_STREAM_EVENTS.person → betreuung`. `betreuungsstelle` ist kein Leaf
  (Rebuild braucht den FK-Schalter).
- **Meldeverlauf** (LFH-676, `openspec/changes/archive/2026-09-29-lfh-676-betreuung-meldeverlauf/design.md`):
  Reihenfolge `juengste_meldung!`/`meldereihenfolge!` (`src/betreuung/repo.rs`); `aktuell` nur aus
  dem Zeiger am Objekt; fremdes Objekt 404 vor dem Lesen; nachgetragen ≥ 60 s
  (`istNachgetragen`); Rücknahme unumkehrbar mit Rückfrage (`betreuung/MeldeVerlauf.tsx`);
  Aufklappen über `Datensicht.aufklappen` (`aufklappzeile` fällt mit LFH-697).
- **Meldungen offline** (LFH-675, `openspec/changes/archive/2026-09-29-lfh-675-betreuung-meldungen-offline/design.md`):
  `offline/schreiben.ts` (`stand`/`belegung`) mit `client_id`; Replay-Lookup **vor** jeder
  Zustandsprüfung (auch nach Einsatzende, `EinsatzSchreibfreigabe`); Erfassungszeit nur an der vorgemerkten Kopie, online die Serveruhr.
- **Verpflegung** (LFH-634, `pages/VerpflegungPage.tsx`, `src/verpflegung/`): eigene Zeitfenster;
  Bedarf wird **erfasst**, Vorschläge ohne Quelle bleiben leer (nicht 0); Sonderkost ist Teilmenge
  der EP; Ausgabe verweist nur per `nachforderung_id`; Einstufung im Client
  (`verpflegung/deckung.ts`); ins ETB nur Zeitfenster und Bedarf (Org-Zeitzone); kein Modulzähler.
