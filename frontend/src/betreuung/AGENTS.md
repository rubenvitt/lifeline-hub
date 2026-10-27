# Betreuung und Verpflegung — Regeln

Gilt für `frontend/src/betreuung/`, `frontend/src/verpflegung/`, `pages/BetreuungPage.tsx`,
`pages/EvakuierungPage.tsx`, `pages/VerpflegungPage.tsx` und die Server-Gegenstücke
`src/betreuung/`, `src/routes/betreuung.rs`, `src/routes/evakuierung.rs`, `src/verpflegung/`;
ergänzt `frontend/AGENTS.md`. Pfade relativ zu `frontend/src/`, sofern nicht `src/…` (Server).

- **Zwei Module** (LLH-1034, Spec `betreuung-evakuierung`): `evakuierung` (Räumungsbezirke,
  Stand evakuiert) und `betreuung` (Stellen, Belegung) sind getrennte Module mit eigenem Recht,
  eigener Route (`…/evakuierung/bezirke/…` bzw. `…/betreuung/stellen/…`), eigenem Lese-Endpunkt,
  Live-Ereignis, Query-Prefix und Zähler. Fachcode und Tabellen bleiben gemeinsam in
  `src/betreuung/`. Die Lagekennzahl „Evakuiert“, die Bezirksflächen der Lagekarte und jeder
  `?bezirk=`-Sprung hängen an `evakuierung`; `…/betreuung?bezirk=` leitet um (`BetreuungPage`).
  Das Gerät „Betreuungsstelle“ bleibt auf `betreuung` und sieht keine Bezirke. Handlungen an
  Bezirken nur über `useBezirkHandlungen` (eine Wahrheit für Toasts, Offline, Rückweg).
  Vorgemerkte Standmeldungen tragen keine URL; ein Umzug der Route braucht keine Queue-Migration
  (`offline/standReplay.test.tsx`).

- **Detailseite eines Bezirks** (LLH-1076, Spec `betreuung-evakuierung`; gilt auch für
  `pages/EvakuierungsbezirkPage.tsx`): Item-Route `…/evakuierung/:bezirkId`
  (`evakuierungsbezirkPfad`), gegatet über das Segment `evakuierung`. Kein Einzel-GET: gelesen
  wird aus `einsatzKeys.evakuierung`; unbekannt, fremd oder storniert → `Navigate` zur Übersicht.
  `?bezirk=` und der Sprung „Im Fachmodul öffnen“ der Lagekarte landen dort. Räumungsschritte nur
  aus `raeumungSchritte.ts` (`raeumungPlan`), gesendet über `useBezirkHandlungen.setzeRaeumung`
  (gleicht mit dem Live-Stand ab, „aufgehoben“ nur nach Rückfrage). Stammdaten in der Ansicht
  (`BezirkStammdaten.tsx`): PATCH nur dreiseitig (`bezirkPatchDreiseitig`, der Bezirk hat keinen
  CAS), Sitzung je Öffnen frisch montiert. Gebiet (`BezirkGebiet.tsx`): Zonen nur bei Fläche und
  freier Lagekarte abrufen; der Ausschnitt `BezirkKartenbild.tsx` ist nicht bedienbar, baut
  seine Karte im Cleanup ab und ohne Kartengrafik gar nicht (`pages/lagekarte/AGENTS.md`, „Karte
  ohne Grafik“). Die Stufenlinie (`standlinieKern.ts`) teilt die Abfrage mit
  `MeldeVerlauf`, ohne Diagrammpaket und ohne Interpolation.
- **Gebiet beim Anlegen und am Bezirk** (LLH-1069, Spec `betreuung-lagekarte`): die Gebietswahl
  „Keins“ · „Fläche zeichnen“ steht sichtbar im Anlegedialog (Vorgabe Fläche nur bei freier
  Lagekarte, sonst gesperrt mit Grund); nach dem Anlegen springt `useBezirkHandlungen` erst beim
  Schließen des Dialogs auf `gebietZeichnenPfad`. „Gebiet zeichnen“/„Weitere Teilfläche zeichnen“
  nur aus `betreuung/gebietZeichnen.ts` (Menü, `GebietZeichnenKnopf`), nur mit Schreibrecht. Die
  Zone entsteht auf der Karte (`pages/lagekarte/AGENTS.md`, „Zeichnen per Link“); das Modul legt
  keine Zone an. Ein Radius kommt erst mit dem Kreis der Lagekarte (LLH-1043).
- **Detailseite der Betreuungsstelle** (LLH-1044, Spec `betreuung-evakuierung`,
  `pages/BetreuungsstelleDetailPage.tsx`, Route `betreuung/:stelleId`, Pfad nur über
  `betreuungsstellePfad`): liest die Stelle aus `GET …/betreuung` (`einsatzKeys.betreuung`), es
  gibt keinen Einzel-Endpunkt; unbekannt, fremd oder storniert → `<Navigate>` auf die Übersicht.
  `?stelle=` ist eine Altadresse und leitet in `BetreuungPage` um, vor jedem Abruf. Bearbeiten
  (Datenraster, dreiseitiger PATCH über `stellePatchDreiseitig`) und Status (Handlungen aus
  `betreuung/stelleStatus.ts`, Schließen einer belegten Stelle über `StelleSchliessenDialog` mit
  Leermeldung) stehen **nur** dort, nie wieder als Zeilenmenü der Übersicht. „Belegung in Zahlen“
  ist **ein** Baustein (`betreuung/StelleBelegung.tsx`) für Detailseite und Gerät; `freiePlaetze`
  gibt es nur in `betreuungText.ts`, nie negativ. „Betroffene hier“ fragt die Personenliste mit
  `?betreuungsstelle_id=` (Serverfilter, Key `einsatzKeys.personenDerStelle`) und nur, wenn die
  Übersicht `namentlich` liefert (Personenrecht); sonst steht der Grund als Zeile.
  Leitung und `kontaktweg` (Migrationen 0226/0256, je 200 Zeichen; in der Oberfläche „Kontakt“,
  LLH-1134/LLH-1419) sind personenbezogen: im ETB nur
  „weitere Angaben“, Schwärzung leert sie, der gesicherte Lagestand friert sie nicht ein.
- **Bedarf einer Stelle** (LLH-1082, Spec `nachforderung-betreuungsstelle`): nur als
  Nachforderung mit `nachforderung.betreuungsstelle_id` (Migration 0231, nur die Kennung im DTO),
  nie als Feld der Stelle (Mengenwahrheit, Spec `stab-versorgung`). Paneel `betreuung/StelleBedarf.tsx`
  liest `einsatzKeys.nachforderungen` nur mit Freigabe Nachforderungen; „Bedarf anfordern“ führt
  über `nachforderungenPfad(…, { bezugStelle, stelle })` ins Formular der Nachforderungsseite.
  Prüfkette 403 (vor dem Lesen) → 404 → 409, geschlossen erlaubt; der Storno der Stelle löst den
  Bezug in seiner Transaktion (`stelle_stornieren_tx`). Kein „Bedarf melden“ auf dem Gerät.
- **Übersicht als Lagebild** (LLH-1050, Spec `betreuung-evakuierung`, „Übersicht der
  Betreuung“): das Band „Unterbringung in Zahlen“ (`betreuung/UnterbringungKennzahlen.tsx`) rechnet
  nur über `betreuung/unterbringungKennzahl.ts`, und die nur mit `inBetreuung`, `freiePlaetze` und
  `volleStellen` aus `betreuungText.ts`; Abwesenheit statt 0 wie `evakuierungKennzahl.ts`.
  „Ohne Meldung“ zählt nur Stellen in Betrieb (dieselbe Menge wie die Kopfzahl, LFH-679),
  Kapazität und Frei nur nicht geschlossene Stellen. **„in Betreuung“ ist eine Wahrheit:** Band,
  Detailseite und Verpflegung lesen dieselbe Belegung — die Verpflegung über die Kopfzahl
  `…/betreuung/belegung`, die an `juengste_meldung!` hängt wie der Zeiger der Übersicht. Keine
  zweite Summe im Backend, keine Summe im Blockkopf von `StellenBlock`. Ohne Stelle stehen statt
  Band und Tabelle `SeitenLeer` mit „Betreuungsstelle anlegen“ (ohne Schreibrecht gesperrt mit
  Grund).
- **Verbleib → Betreuungsstelle** (LFH-674,
  `openspec/changes/archive/2026-09-29-lfh-674-verbleib-notunterkunft-betreuungsstelle/design.md`): nur die Kennung
  (`person_verbleib.betreuungsstelle_id`, Cache
  `einsatz_person.aktuelle_verbleib_betreuungsstelle_id`), den Namen belegt der Client vor; der Server kopiert
  keinen Stellennamen (Ziel, Kurzform, ETB). Prüfkette 422 → 403 (vor jedem Lesen) → 404 → 409.
  „davon namentlich n" rechnet `…/betreuung`, nicht `repo::stellen`; ohne Personenrecht fehlt
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
  Inbetriebnahme/Auflösung einer Stelle; kein Modulzähler. Ein Zeitfenster wird in seiner Karte
  bearbeitet (LLH-1139, `verpflegung/ZeitfensterBearbeiten.tsx`, `frontend/AGENTS.md`, „Bearbeiten
  in der Ansicht“): „Bedarf bearbeiten“ ohne Modal, dieselben Felder wie beim Anlegen, nur
  geänderte Schlüssel über `zeitfensterPatch` gegen den Stand beim Öffnen, eine offene Karte je
  Seite; `ZeitfensterDialog` legt nur an. Der PATCH hat keinen CAS (kein 409).
  **Verpflegungsstellen** (LLH-1040, `src/verpflegung/stelle.rs`): Status wie BR
  (`geplant → aktiv → aufgeloest`, Storno nur geplant ohne Ausgabe und ohne laufende
  Gerätekopplung, sonst 409 „Gerät gekoppelt“ und „Stornieren“ gesperrt mit Grund, LLH-1048), Zuordnung zum Zeitfenster
  n:m (`stelle_ids`), **Soll nur am Zeitfenster**, Ist je Stelle (`je_stelle`) nur vom Server
  (`deckung::rechne`), der Client rechnet nichts nach; keine eigene Leseroute, `stellen[]` kommt
  mit `GET …/verpflegung` (`einsatzKeys.verpflegung`).
  Oberfläche (LLH-1040 Teil II, design.md D13): dritte Ansicht „Stellen“ in derselben
  Segmentleiste (`verpflegung/StellenListe.tsx`, Maske `StelleDialog.tsx`, Kern
  `stellenKern.ts`); schmal tragen „vergangen“ und „Stellen“ keine Zahl (390 px, Handschuh). Die
  Aufstellung je Stelle an der Karte steht **nur bei nicht leerem `je_stelle`** und übernimmt die
  Zahlen unverändert; der Bestand ohne Stelle bleibt ohne Aufstellung. `ort` geht nur **ohne**
  gewählte Stelle hinaus und heißt, sobald der Einsatz Stellen hat, „Zuführungsziel“. Die
  Stellenwahl der Ausgabeansicht folgt `?stelle=`, dann der gemerkten Wahl, dann der einzigen
  zugeordneten Stelle (am an eine Stelle gebundenen Gerät keine Wahl: `eigeneStelle`, LLH-1048); gemerkt wird nur am Desktop (`verpflegung/stellenGedaechtnis.ts`,
  Schlüssel `lfh:verpflegung:stelle:<einsatz>`, in `GERAETESPEICHER` und
  `offline/geraetRaeumung.ts`). Ein Stellen- oder Empfängerwechsel schließt das offene Bündel
  beim alten Ziel ab („senden“); das Bündel trägt Stelle und Empfänger seines ersten Tipps.
  **Empfänger** (LLH-1055 D1–D4, `src/verpflegung/repo.rs`): Einheit (Abholung) oder Abschnitt
  (Zuführung), **höchstens einer** (beide 422), **nie Personen**; fremd oder unbekannt 404. Die
  Empfängerliste (`empfaenger`) kommt nur als Projektion mit `GET …/verpflegung` (bewusste
  Ausnahme von LFH-634 D4): Name, Funkrufname, Gliederung, Abschnitt, Stärke aus
  `einheit::repo::load_staerken_je_einheit`, Eintreffen; die Feldmenge ist in
  `tests/verpflegung.rs` gepinnt, kein Führer, keine Erreichbarkeit, keine Mitglieder. Live:
  `einheit` und `abschnitt` erreichen Leser der Verpflegung über die Gate-Menge
  (`LiveEvent::modul_keys`), `personal` nicht; der Client lädt dann `einsatzKeys.verpflegung` neu.
  Eine Ausgabe an eine Einheit ist eine Spur (`SPUREN_EINHEIT`): auflösen behält sie, stornieren 422.
  Oberfläche (LLH-1055 Teil II, Kern `verpflegung/empfaengerKern.ts`): Empfänger nur aus
  `empfaenger`, Vorgabe „ohne Empfänger“ (Zählen bleibt so schnell wie ohne), die Wahl wird nie
  gemerkt. Mengenvorgabe einer Einheit = Ist-Stärke ihres Teilbaums über `summiereStaerke`
  (Taste „+n“ in der Ausgabeansicht, „Menge …“ und Nachtrag vorbelegt, überschreibbar), ohne
  Stärke keine Vorgabe. „Noch nicht verpflegt“ rechnet nur der Client (`verpflegungsstand`, er
  allein kennt die vorgemerkten): verpflegt ist, wer selbst oder über eine Über-Einheit eine
  gültige Ausgabe des Zeitfensters hat, am gebundenen Gerät auch über `verpflegt_anderswo` des
  Servers („anderswo verpflegt · n EP“ unter „Verpflegt“, LLH-1048); ohne Eintreffen steht gesondert (nie raten), nach dem Ende
  eingetroffen fehlt; eine Zuführung an einen Abschnitt verpflegt keine Einheit, „ausstehend“
  nimmt keine aus der Liste. Fläche `verpflegung/EmpfaengerStand.tsx`: in der Ausgabeansicht mit
  „Wählen“, an der Karte eingeklappt ohne Knöpfe. Im Nachtrag liegt „Ort“/„Zuführungsziel“ seither
  eingeklappt (Feldbudget: Menge, Empfänger, Stelle, Zeitpunkt). Ein Bündel trägt höchstens einen
  Empfänger für alle seine Portionen.
  **Ausgabe zählen** (LLH-1032, Spec `kraefte-verpflegung`, „Ausgabe zählen“): erfasst wird in
  der Ausgabeansicht je Zeitfenster (`verpflegung/AusgabeAnsicht.tsx`, Route
  `verpflegung/:zeitfensterId/ausgabe` an Stab und Gerät, Pfade über `EinsatzPfade`). Gezählt
  wird in eine Sammlung, die als EINE Ausgabe gebucht wird (`verpflegung/ausgabeSammlung.ts`,
  `useAusgabeSammlung.ts`: 3 s Ruhe, höchstens 15 s, ab 50 Portionen, „Buchen“). Eine
  Sonderkost-Taste zählt die Menge mit (Stapel von Portionen, „−1“ nimmt die oberste); Tasten nur
  für Kostformen mit Bedarf, die übrigen im Menü „Weitere Kostform …“. „Ausgabe nachtragen“ (das
  Formular mit Zeitpunkt, `useAusgabeNachtragen.ts`) ist an der Karte eine gezählte Aktion und
  in der Ansicht ein Nebenweg; vergangene Zeitfenster werden nur nachgetragen, nicht gezählt.
  **Verpflegungsplan und Tag aus Vorlage** (LLH-1058, Spec `kraefte-verpflegung`,
  `src/verpflegung/vorlage.rs`): der Plan ist ein Org-Katalog (`/admin/stammdaten/verpflegungsplan`,
  `stammdaten/VerpflegungsplanTab.tsx`, Prefix `verpflegung-vorlagen`, live über `stammdaten`, nicht
  im Lagebild), Uhrzeiten `HH:MM` ohne Datum, kein Löschen. Den Tag legt die eigene Seite
  `verpflegung/TagAusVorlage.tsx` (`verpflegung/aus-vorlage?tag=`, Nebenweg der Verpflegungsseite, nur
  am Stab) an; die Uhrzeiten legt **der Client** in der Anzeigezone auf den Tag, nur über
  `anzeige/uhrzeit.ts` und den reinen Kern `verpflegung/tagAusVorlageKern.ts`, der Server kennt keine
  Zone dafür. Bedarf je Fenster aus `useBedarfsvorschlag` zu seinem Beginn wie beim Einzelanlegen;
  „schon angelegt“ und Fenster in der ausfallenden Stunde gehen nicht hinaus, der Rest übersprungen
  vom Server und in der Quittung genannt. Die Vorschau steht, sobald sie Fenster hat (kein Sprung bei
  Live). Es entsteht keine Serie: ein Zeitfenster kennt seine Vorlage nicht.
- **Ausgaben offline** (LFH-688, `openspec/changes/archive/2026-10-01-lfh-688-verpflegung-ausgaben-offline/design.md`):
  `offline/schreiben.ts` (`ausgabe`) mit `client_id`; Replay-Lookup **vor** `fordere_aktiv`
  (`EinsatzSchreibfreigabe`), fremdes Zeitfenster 422, Replay ohne Live; Erfassungszeit nur an der
  vorgemerkten Kopie; vorgemerkte Ausgaben stehen als „ausstehend“ an der Karte
  (`useVorgemerkteAusgaben`) und zählen **nie** in die Deckung; der Sync schreibt das bestätigte
  Zeitfenster vor dem Entfernen der Zeile in den Cache. Stelle (LLH-1040): eine aufgelöste Stelle
  nimmt Ausgaben mit einem Zeitpunkt **vor** der Auflösung an (sonst 409); ebenso eine aufgelöste
  Einheit als Empfänger (LLH-1055), Empfängerprüfung erst nach dem Replay; Stellenprüfung und
  Grenzprüfung (`ort`, `bemerkung`) laufen **nach** dem Replay-Lookup.
  **Bündel** (LLH-1032): ein Bündel ist eine Ausgabe mit einer `client_id`, gesetzt beim
  Abschluss; offene Sammlung und „ausstehend“ zählen nie in „fehlt“ und die Einstufung, sie
  stehen daneben. Beim Wechsel des Zeitfensters, beim Verlassen der Ansicht und beim Verbergen
  der Seite geht das Bündel direkt in die Warteschlange (`merkeVerpflegungsausgabeVor`), ohne
  Hinweis.
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
