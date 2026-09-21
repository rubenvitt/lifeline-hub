# Tasks

Jede Aufgabe entsteht per `superpowers:test-driven-development` (erst rot, dann grün). Wo
ein Test eine Falle pinnt, gehört eine **Mutationsprobe** dazu: die Zusicherung
zurückdrehen und sehen, dass genau dieser Test rot wird.

## 1. Backend — Normalisierung (`src/karte/luftqualitaet.rs`)

> Umgesetzt als eigenes Modul statt in `normalisierung.rs` (dort ~900 Zeilen); der
> Schnitt der Aufgaben ist unverändert.

- [x] 1.1 Reine Funktion `luftqualitaet_klasse(index)` mit den sechs Wire-Wörtern
      (`sehr_gut`…`sehr_schlecht`, `keine_daten` für fehlend/außerhalb 0–4); Test
      `luftqualitaet_tests::bildet_die_indexstufen_ab` pinnt die Literale (Gegenstück zu
      `theme/statusFarben.test.ts`) — `cargo test luftqualitaet` grün.
- [x] 1.2 Reine Funktion für den Messzeitpunkt: MEZ-Stundenende → RFC 3339 mit `+01:00`,
      `…24:00:00` → 00:00 Folgetag, unparsebar → `None`. Tests gegen **absolute**
      Zeitpunkte (`DateTime<Utc>`-Vergleich) im Sommer und für die Mitternachtsstunde;
      Mutationsprobe „Europe/Berlin statt +01:00" bzw. „24:00 nicht normalisiert" → rot.
- [x] 1.3 Leitschadstoff-Wahl (höchster Teilindex, Gleichstand über `y`) samt
      Komponententabelle (ID → Kürzel/Einheit, Rückfall `Komponente <id>`); Tests für
      Gleichstand, Stufe 0 und unbekannte ID.
- [x] 1.4 `normalisiere_luftqualitaet(stationen, index_antwort)` → `FeatureCollection` nach
      design D1/D3/D7: nur Stationen mit Index, jüngster Stundenwert je Station,
      Koordinaten als Zahlen (Quelle liefert Strings), Auflösung über ID **und** Code,
      Station ohne Koordinaten verworfen. Tests mit einer kleinen Fixture im gemessenen
      Format: (a) Stationsliste mit Station ohne Index → kein Feature, (b) nach Code
      geschlüsselte Indexantwort liefert dieselben Features wie nach ID geschlüsselte
      (Mutationsprobe: Code-Eintrag aus der Tabelle entfernen → rot), (c) mehrere Stunden →
      nur die jüngste, (d) kaputte Koordinaten → nur dieses Feature fehlt, (e) kaputte
      Struktur (kein `data`, fehlende Spalten) → `None` = unbrauchbar (→ offline), nicht
      „leer" — sonst stünde eine kaputte Antwort 15 min als gültiger Leerstand im Cache. Properties per
      `serde_json::from_value::<GeoJsonFeatureCollection>` gegen den Schema-Anker geprüft.
- [x] 1.5 `stand`-Ableitung = Maximum der Messzeitpunkte; Test mit zwei Stationen
      verschiedener Stunden.

## 2. Backend — Abruf und Route

- [x] 2.1 Reine Funktion `luftqualitaet_fenster(now_utc)` → Query-Parameter
      (`date_from`, `time_from`, `date_to`, `time_to`) in MEZ, acht Stunden rückwärts (Review: vorher sechs),
      Stundenenden 1–24. Tests: Sommer-Mittag, 00:30 MEZ (Fenster über den Tageswechsel),
      exakt volle Stunde. Mutationsprobe „Europe/Berlin" → rot.
- [x] 2.2 `fetch_luftqualitaet` / `erneuere_luftqualitaet` in `src/karte/quellen.rs` nach
      dem DWD/Pegel-Muster: Konstanten `LUFTQUALITAET_ATTRIB = "Umweltbundesamt"`,
      `LUFTQUALITAET_TTL = 900 s`, Basis `https://luftdaten.umweltbundesamt.de/api/air-data/v2`;
      beide Abrufe mit `lang=de&index=id`; scheitert einer → `None` (kein Cache-Eintrag).
      Verifikation: `cargo test` grün, Code-Review gegen design D8.
- [x] 2.3 Quellen-`match` in `src/routes/karte.rs` um `"luftqualitaet"` erweitern; Test
      `fachebenen_luftqualitaet_wird_bedient` in `tests/karte.rs` nach dem
      Hochwasser-Muster (Cache vorbefüllt, kein Netz) pinnt Route + Cache-Schlüssel, dazu
      die Gegenprobe „ohne `bbox` kein 400".
- [x] 2.4 Offline-Pfad belegen: SWR-Kaltstart mit fehlschlagendem Abruf liefert
      `offline` + Attribution (vorhandene `liefere_mit_swr`-Tests decken den Kern; hier
      nur die Attribution der neuen Quelle im Offline-Umschlag prüfen).
- [x] 2.5 Einmaliger Live-Abruf von Hand (`cargo run`, `curl …/api/karte/fachebenen/luftqualitaet`)
      mit Plausibilitätsprüfung: Feature-Zahl in der Größenordnung ~380, `stand` ≈ jüngste
      Stunde, Stichprobe einer Station gegen die UBA-Webseite. Ergebnis in die Doku (Task 5.1).

## 3. Frontend — Vertrag und Darstellung

- [x] 3.1 `api/fachebenen.ts`: `FachebeneQuelle` um `'luftqualitaet'` erweitern, neuer
      FE-lokaler Typ `LuftqualitaetKlasse` mit Doc-Kommentar (warum nicht generiert, wo das
      Rust-Gegenstück gepinnt ist); `pnpm tsc` zeigt die nachzuziehenden Stellen.
- [x] 3.2 `theme/statusFarben.ts`: Vertragskarte `luftqualitaetIndex` (D9) mit Kopfkommentar
      zur Auflösungsverengung 5 → 3 Rollen; `statusFarben.test.ts`: Literal-Liste der
      Karten + `toHaveLength(17)` (beide Stellen), Rollen je Stufe, Labels paarweise
      verschieden. `statusVertrag.guard.test.ts` bleibt grün.
- [x] 3.3 Neues `pages/lagekarte/luftqualitaetStil.ts` (Radius-Tabelle streng monoton,
      `faerbeLuftqualitaet(fc, token)`, `luftqualitaetDarstellung(roh)`, Rückfall
      `keine_daten`) + Test: Monotonie, Hell/Dunkel ergibt verschiedene Farben,
      unbekanntes Wort → „keine Daten".
- [x] 3.4 `pages/lagekarte/fachebenen.ts`: `FACHEBENEN.luftqualitaet` (Label
      „Luftqualität (UBA)", Punkt, `pollMs: 900_000`, eigener, von den sechs Bestandsfarben
      verschiedener Rückfallton, Geltungszeile „Messstationen — keine Aussage zwischen den
      Stationen"), `fachebeneKeys()` hinter `hochwasser`; `fachebenen.test.ts` nachziehen.
- [x] 3.5 `fachebenenAuswahl.ts` (Default aus) und `useKartenAnsicht.ts` (`leseFachebenen`
      per Aufzählung `o.luftqualitaet === true`); Test: gespeicherter Stand ohne Schlüssel
      → aus, mit `true` → an.
- [x] 3.6 `useFachebenen.ts`: siebte Query **ans Ende** des `useQueries`-Tupels,
      `byKey.luftqualitaet = ergebnisse[6]`, Einfärbung über `faerbeLuftqualitaet`.
      Tests in `useFachebenen.test.tsx`: Einfärbung/Radius je Stufe **und** die Gegenprobe,
      dass nach dem Einschalten Autobahn- und KRITIS-Daten weiter unter ihrem eigenen
      Schlüssel stehen (Mutationsprobe: Query an Position 3 einfügen → rot).
- [x] 3.7 `FachebenenInspector.tsx`: Zweig `luftqualitaet` mit `StatusTag` (Stufe als Wort),
      Leitschadstoff, Einzelwerten mit Einheit, Messzeitpunkt (`taktischeDtgVoll`), Wort
      „unvollständige Datenbasis" nur wenn gesetzt, Stationstyp/Umgebung;
      `kategorieLabel('luftmessstation')` in `fachebenenLayer.ts`. Tests analog Hochwasser
      inkl. unbekanntem Klassenwert.
- [x] 3.8 Regressionstest in `kartenLayer.test.ts`: `reAnlegenAlles` legt die neue Ebene
      nach einem Stilwechsel samt Daten wieder an (die Funktion ist generisch — der Test
      belegt, dass das auch für diese Ebene gilt).
- [x] 3.9 Attribution: die Einblendung entsteht generisch in `useFachebenen.ts` (Zeile ~155,
      über `fachebeneKeys()`) — keine Quellenliste nachzuziehen. Test in
      `useFachebenen.test.tsx`: eingeschaltete Ebene mit `status: ok` bringt
      „Umweltbundesamt" in die Attribution, mit `status: offline` nicht.

## 4. Browser-Nachweis

- [x] 4.1 Dev-Stack (`cargo run` + Vite), Lagekarte eines Einsatzes, Ebene einschalten:
      Stationen sichtbar, Farbe + Größe unterscheiden sich, Inspector zeigt Stufe/Zeitpunkt,
      Attribution unten rechts, Basemap-Wechsel lässt die Stationen stehen, Reload mit
      gespeicherter Ansicht stellt die Ebene wieder her. Hell- und Dunkelmodus.
      Screenshot als Beleg.
- [x] 4.2 Offline-Verhalten im Browser: Fachebenen-Cache-Eintrag `luftqualitaet` löschen und
      das Backend ohne Netz starten (bzw. den UBA-Host per `/etc/hosts` unerreichbar machen)
      → Panel zeigt „offline", die Karte bleibt ohne Fehlermeldung bedienbar, die Route
      antwortet 200.

## 5. Doku und Abschluss

- [x] 5.1 `docs/fachebenen-quellen.md`: Tabellenzeile `luftqualitaet` (Endpoint, Format,
      Lizenz-Vorbehalt, Attribution, TTL 900 s, Offline) plus Hinweisabschnitt mit den
      gemessenen Eigenheiten (301-Host, MEZ ohne Sommerzeit, `24:00:00`, `index`-Echo,
      Verzug, Anteil „unvollständig") und dem Non-Goal Interpolation; KRITIS-TTL-Angabe
      (3600 s → 24 h, wie im Code) korrigieren. Verifikation: Durchsicht gegen design.md.
- [x] 5.2 Prüfliste Einsatztauglichkeit (15 Kriterien, Bedien-Leitlinie) für die geänderte
      Lagekarten-Fläche ausfüllen, jede Zeile mit Verdikt; Ablage in der PR-Beschreibung.
- [x] 5.3 `./scripts/check-all.sh` vollständig grün (inkl. Prettier, Typ-Codegen ohne Diff,
      e2e); Ausgabe ohne `| tail`.
