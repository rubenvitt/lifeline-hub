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
  Aufklappen über `Datensicht.aufklappen`, seit LFH-697 der einzige Aufklappweg.
- **Meldungen offline** (LFH-675, `openspec/changes/archive/2026-09-29-lfh-675-betreuung-meldungen-offline/design.md`):
  `offline/schreiben.ts` (`stand`/`belegung`) mit `client_id`; Replay-Lookup **vor** jeder
  Zustandsprüfung (auch nach Einsatzende, `EinsatzSchreibfreigabe`); Erfassungszeit nur an der vorgemerkten Kopie, online die Serveruhr.
- **Verpflegung** (LFH-634, `pages/VerpflegungPage.tsx`, `src/verpflegung/`): eigene Zeitfenster;
  Bedarf wird **erfasst**, Vorschläge ohne Quelle bleiben leer (nicht 0); Sonderkost ist Teilmenge
  der EP; Ausgabe verweist nur per `nachforderung_id`; Einstufung im Client
  (`verpflegung/deckung.ts`); ins ETB nur Zeitfenster und Bedarf (Org-Zeitzone); kein Modulzähler.
- **Versorgung S4** (LFH-553, Entscheidung 30.09.2026,
  `openspec/changes/archive/2026-09-30-lfh-553-versorgung-abgrenzung/design.md`, Spec
  `stab-versorgung`): kein Modul „Versorgung“, keine Tabelle `versorgungsposten`. Träger:
  Verpflegung → Modul Verpflegung, Einsatzmittel/Verbrauchsgüter/Betriebsstoffe → Nachforderung
  mit **freier Art** (keine Liste; `tests/nachforderung.rs`
  `betriebsstoff_ist_eine_nachforderung_mit_freier_art`), Materialerhaltung → Status am Material.
  **Eine Mengenwahrheit:** Beschafftes steht nur als Nachforderung, andere Module verweisen per
  Kennung. **Kräfte-Unterkunft ist eine Lücke, nie eine Betreuungsstelle** — deren Belegung
  speist „in Betreuung“ und damit den Verpflegungsbedarf der Betreuten (Doppelzählung neben der
  Personalstärke). Wiedervorlage nur mit Feldbefund aus einer Langzeitlage (> 1 Einsatztag).
