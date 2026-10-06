# Tasks

## 1. Kopfliste der Vorlagendokumente (D1, D6)

- [x] 1.1 `DokumentKopf`, `liste_koepfe::<T>` und Kopf-DTOs je Art (`LageberichtKopf`, `BefehlKopf`, `PressemitteilungKopf`) im Kern; Listenroute liefert den Kopf. Beleg: Repo-Test im Kern und Rust-Tests in `tests/lagebericht.rs`, `tests/befehl.rs`, `tests/stab_presse.rs`, dass die Listenantwort kein `abschnitte` enthält und das Detail weiter alle Abschnitte trägt
- [x] 1.2 Schemas in `src/api_doc.rs`, `scripts/check-typ-codegen.sh` grün, Aliase in `frontend/src/api/types.ts`, Listen-Fetcher auf den Kopf typisiert; `pnpm typecheck` grün
- [x] 1.3 `LageberichtVorschau` liest das Detail; Vitest: Vorschau zeigt Abschnittstexte aus dem Detail-Key
- [x] 1.4 Einsatzbericht lädt das Detail des zuletzt freigegebenen Lageberichts; Vitest in `abruf.test.ts`/`verdichtung.test.ts`: Lagetext stammt aus dem Detail, ohne freigegebenen Bericht keine Zusatzanfrage
- [x] 1.5 Übrige Listenabnehmer und Testfixtures auf den Kopf umgestellt (Listenseiten, Dashboard, Chat, Sprungpalette, Medienlage, Stab-Vorbereitung); betroffene Vitest-Dateien grün

## 2. Entwurfs-PATCH kennzeichnen (D2)

- [x] 2.1 `LiveHub` publiziert ein Objekt-Ereignis mit Zusatzfeldern; `aktualisieren` setzt `nur_inhalt`, wenn Titel und Zeitstand gleich bleiben. Beleg: Rust-Test, dass ein PATCH nur an Abschnitten `nur_inhalt: true` trägt und ein Titelwechsel nicht, Payload ohne Inhalte

## 3. Gezielter Abgleich im Client (D3, D4)

- [x] 3.1 `EINSATZ_STREAM_ZIELE` in `api/queryKeys.ts` mit Rückfall auf `EINSATZ_STREAM_EVENTS`; Vitest: `nur_inhalt` trifft nur das Detail, Titelwechsel auch die Liste, fehlende Kennung den Prefix
- [x] 3.2 `live/zeilenAbgleich.ts` (Sammeln je Fenster, Grenze, Rückfälle, Einsortieren, abgeleitete Listen); Vitest für verdeckten Tab, laufenden Listenabruf, Fehler, Grenze, Sortierung bei Gleichstand und Statuswechsel
- [x] 3.3 `useEinsatzLiveStream` leitet Listener aus beiden Tabellen ab; Vitest in `useEinsatzLiveStream.test.tsx`: Entwurfs-PATCH ruft keine Liste ab, `lagged` gleicht weiter alles ab

## 4. Presse-Log (D3)

- [x] 4.1 `GET …/stab/medienkontakte/{kid}` mit Lese-Gate des Stabs; Rust-Test: Einzelabruf, 404 bei fremdem Einsatz, Modulsperre
- [x] 4.2 Ziel Medienkontakte und Zuordnung `presse` (Medienkontakt → Zeile, Pressemitteilung → Mitteilungsliste/Detail); Vitest: Pressemitteilungs-Ereignis lädt das Presse-Log nicht, Rücknahme sortiert zu den offenen

## 5. Schäden (D3, D5)

- [x] 5.1 `GET …/schaeden/marker` mit `SchadenMarker`, Schema und Codegen; Rust-Test: keine Freitexte, stornierte fehlen, Modulsperre
- [x] 5.2 Anhang-Routen senden `schaden` mit `anhang: true`; Rust-Test in `tests/schaden_anhang.rs`
- [x] 5.3 Key `schadenMarker` (live über `schaden`, in `LAGEBILD_OFFLINE`), Guard-Tests angepasst
- [x] 5.4 Lagekarte (Daten, Marker, Inspector, Objektsuche, Snapshot-Abbildung, Verorten) und Dashboard-Quelle auf den Marker; betroffene Vitest-Dateien grün
- [x] 5.5 Ziel Schäden und Zuordnung `schaden` (Anhang → Anhangliste, sonst Zeile + Marker, ohne Kennung → Prefix); Vitest: Anhang-Ereignis lädt weder `schaeden` noch Marker, Storno entfernt die Zeile

## 6. Abschluss

- [x] 6.1 Verweise in `frontend/AGENTS.md` (Query-Key-Registry: gezielte Zuordnung) und `frontend/src/offline/AGENTS.md` (Marker) ergänzt; Prettier grün
- [x] 6.2 `./scripts/check-all.sh`, Vitest (TZ=Europe/Berlin) und Rust-Tests grün
  (Cloud-Sitzung: Bündel `schnell` grün, Vitest gesamt mit TZ=Europe/Berlin und die betroffenen
  Rust-Binaries samt `--lib` grün; das volle `rust`- und `e2e`-Bündel trägt die CI)
- [x] 6.3 Kommentar an das Ticket der serverseitigen Zählung des Informationstelefons (Infotelefon-Teil aus dem Audit)

## Workflow follow-up

- `/opsx:archive` im selben Branch vor dem PR, dann PR gegen `alpha` (Merge-Commit).
- Vor dem PR `alpha` hereinholen (parallele Änderung an der Route `entwurf` zum Modulzähler).
