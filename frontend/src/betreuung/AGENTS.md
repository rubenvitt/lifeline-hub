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
  `offline/schreiben.ts` (`stand`/`belegung`) mit `client_id`; Replay-Lookup nach dem Lese-Gate,
  aber **vor** jeder Zustandsprüfung (auch nach Einsatzende, `EinsatzSchreibfreigabe`, LFH-769); Erfassungszeit nur an der vorgemerkten Kopie, online die Serveruhr.
  Zeitpunkt der vorgemerkten Kopie: LFH-705, Regel in `offline/AGENTS.md`, „Schreiben ohne Netz“.
- **Verpflegung** (LFH-634, `pages/VerpflegungPage.tsx`, `src/verpflegung/`): eigene Zeitfenster;
  Bedarf wird **erfasst**, Vorschläge ohne Quelle bleiben leer (nicht 0); Sonderkost ist Teilmenge
  der EP; Ausgabe verweist nur per Kennung (`nachforderung_id`, `verpflegungsstelle_id`, Empfänger
  `einheit_id` oder `abschnitt_id`); Einstufung im Client (`verpflegung/deckung.ts`); ins ETB nur
  Zeitfenster und Bedarf (Org-Zeitzone), dazu Art und Stellen des Zeitfensters und
  Inbetriebnahme/Auflösung einer Stelle; kein Modulzähler.
  **Verpflegungsstellen** (LLH-1040, `src/verpflegung/stelle.rs`): Status wie BR
  (`geplant → aktiv → aufgeloest`, Storno nur geplant ohne Ausgabe), Zuordnung zum Zeitfenster
  n:m (`stelle_ids`), **Soll nur am Zeitfenster**, Ist je Stelle (`je_stelle`) nur vom Server
  (`deckung::rechne`), der Client rechnet nichts nach; keine eigene Leseroute, `stellen[]` kommt
  mit `GET …/verpflegung` (`einsatzKeys.verpflegung`).
  **Empfänger** (LLH-1055 D1–D4, `src/verpflegung/repo.rs`): Einheit (Abholung) oder Abschnitt
  (Zuführung), **höchstens einer** (beide 422), **nie Personen**; fremd oder unbekannt 404. Die
  Empfängerliste (`empfaenger`) kommt nur als Projektion mit `GET …/verpflegung` (bewusste
  Ausnahme von LFH-634 D4): Name, Funkrufname, Gliederung, Abschnitt, Stärke aus
  `einheit::repo::load_staerken_je_einheit`, Eintreffen; die Feldmenge ist in
  `tests/verpflegung.rs` gepinnt, kein Führer, keine Erreichbarkeit, keine Mitglieder. Live:
  `einheit` und `abschnitt` erreichen Leser der Verpflegung über die Gate-Menge
  (`LiveEvent::modul_keys`), `personal` nicht; der Client lädt dann `einsatzKeys.verpflegung` neu.
  Eine Ausgabe an eine Einheit ist eine Spur (`SPUREN_EINHEIT`): auflösen behält sie, stornieren 422.
- **Ausgaben offline** (LFH-688, `openspec/changes/archive/2026-10-01-lfh-688-verpflegung-ausgaben-offline/design.md`):
  `offline/schreiben.ts` (`ausgabe`) mit `client_id`; Replay-Lookup **vor** `fordere_aktiv`
  (`EinsatzSchreibfreigabe`), fremdes Zeitfenster 422, Replay ohne Live; Erfassungszeit nur an der
  vorgemerkten Kopie; vorgemerkte Ausgaben stehen als „ausstehend“ an der Karte
  (`useVorgemerkteAusgaben`) und zählen **nie** in die Deckung; der Sync schreibt das bestätigte
  Zeitfenster vor dem Entfernen der Zeile in den Cache. Stelle (LLH-1040): eine aufgelöste Stelle
  nimmt Ausgaben mit einem Zeitpunkt **vor** der Auflösung an (sonst 409); ebenso eine aufgelöste
  Einheit als Empfänger (LLH-1055), Empfängerprüfung erst nach dem Replay; Stellenprüfung und
  Grenzprüfung (`ort`, `bemerkung`) laufen **nach** dem Replay-Lookup.
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
