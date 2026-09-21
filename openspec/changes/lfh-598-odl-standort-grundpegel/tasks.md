# Tasks

Jede Aufgabe entsteht per `superpowers:test-driven-development`: erst der rote Test, dann der
Code. Wo eine Aussage „nie/kein" lautet, belegt eine Mutationsprobe, dass der Test rot werden
kann.

## 1. Grundpegel-Berechnung (Backend, rein)

- [x] 1.1 Fixture: Ausschnitt einer echten `odlinfo_timeseries_odl_1h`-Antwort (21.09.2026) in den Tests von `karte::odl_grundpegel` ablegen (eigenes Modul statt `normalisierung.rs`) — mehrere Sonden, eine mit < 20 Werten, ein Wert in fremder Einheit; Test liest sie ein
- [x] 1.2 Reine Funktion Stichprobe → `{ kennung → (pegel, n) }`: unteres Quartil (nächstgelegener Rang), Mindestzahl 20, nur `µSv/h`, Pegel ≤ 0 verworfen, `null`-Werte übersprungen; Tests je Regel, darunter „19 Werte → kein Pegel / 20 Werte → Pegel"
- [x] 1.3 Reine Sperrklinke (neu, alt) → übernommen: Anstieg ≥ 1,5 × behält alten Pegel samt Stand, 1,2 × und Sinken werden übernommen, Sonde ohne alten Pegel wird übernommen; Tests aus den Spec-Szenarien (0,1 → 0,16 verworfen · 0,1 → 0,12 übernommen) plus Grenzfall genau 1,5 ×
- [x] 1.4 Reine Funktion für die Zeitpunkt-Liste (28 volle UTC-Stunden im 6-h-Raster rückwärts, innerhalb von 7 Tagen) und den daraus gebauten CQL-Filter; Test mit fester Uhrzeit prüft Anzahl, Raster, ältesten/jüngsten Zeitpunkt und den Filtertext (die URL-Kodierung übernimmt `percent_encoding` beim Abruf)

## 2. Bewertung bei Auslieferung (Backend, rein)

- [x] 2.1 `bewerte_odl(features, grundpegel)`: Faktor-Stufen per Multiplikation (`wert <= 1.5*p`, `wert <= 3*p`), `bewertung`/`grundpegel`/`faktor` (2 Nachkommastellen)/`grundpegel_stand` setzen; Tests aus den Spec-Szenarien (0,06/0,19 → `stark_erhoeht` · 0,2/0,28 → `normal` · 0,1/0,15 → `normal` · 0,1/0,3 → `erhoeht`)
- [x] 2.2 Rückfall-Fälle: kein Pegel, kein Wert, fremde Einheit → absolute Stufe bleibt, `bewertung: "absolut"`, die drei Felder FEHLEN (Presence per `contains_key`, nicht `== Null`); Test
- [x] 2.3 Wire-Pin: `bewertung`-Wörter `standort`/`absolut` in `karte::odl_grundpegel::tests` gepinnt, Stufenwörter-Pin unverändert grün

## 3. Abruf und Ablage (Backend)

- [x] 3.1 `cache.rs`: generisches Lese-/Schreibpaar für serialisierbare Werte auf `fachebenen_cache` (Eintrag samt Alter); Test Round-Trip und „kaputtes JSON → Miss"
- [x] 3.2 Reiner Kern `neue_karte(roh, alt, jetzt)`: ohne `features`-Liste, ohne einzigen Pegel oder mit weniger als der Hälfte der bekannten Sonden → `None` (nichts schreiben); Tests
- [x] 3.3 Hintergrund-Erneuerung unter `odl:grundpegel`: TTL 24 h, `inflight`-Riegel, Abkühlung 1 h nach Fehlschlag, eigener Request-Timeout 90 s, Sperrklinke gegen den gespeicherten Stand, Schreiben; Entscheidungslogik (frisch/anstossen/abkühlen) als reine Funktion mit Tests nach Muster `autobahn_weg`/`autobahn_darf_starten`
- [x] 3.4 `fetch_odl`: nach `liefere_mit_swr` Grundpegel anstossen (nie darauf warten) und `bewerte_odl` anwenden; Integrationstest gegen die Route mit vorbelegtem Cache (`odl` + `odl:grundpegel`) → Features tragen `standort`; ohne `odl:grundpegel` → `absolut`, Antwort kommt ohne Netz zur Zeitreihe zustande
- [ ] 3.5 `cargo test --workspace` und `cargo test --no-default-features -p lifeline-hub karte` grün; `cargo fmt --all`

## 4. Frontend

- [x] 4.1 `api/fachebenen.ts`: Typ `OdlBewertung = 'standort' | 'absolut'` mit Doc-Verweis auf den Rust-Pin; `odlStil.test.ts` pinnt die Wörter als Literale (über `odlGrundlage`, das auch den Rückfall trägt)
- [x] 4.2 `theme/statusFarben.ts`: Labels `odlStufe` → „keine Messung" · „unauffällig" · „erhöht" · „stark erhöht"; `statusFarben.test.ts` angepasst (Rollen unverändert, Kartenzahl bleibt 17)
- [x] 4.3 `FachebenenInspector.tsx` `OdlInhalt`: bei `standort` Zeilen Grundpegel (3 Nachkommastellen, µSv/h, Stand in Ortszeit) und Faktor („1,8 ×") plus Faktor-Hinweis; bei `absolut` bzw. unbekanntem Wort Satz „noch kein Grundpegel" plus Bänder-Hinweis und KEINE Grundpegel-/Faktor-Zeile; Tests für beide Grundlagen und das unbekannte Wort, Zahlen im Hinweis als Literale geprüft
- [ ] 4.4 `pnpm lint`, `pnpm exec tsc` (über `check-typ-codegen.sh`) und Vitest grün; Prettier-Fixpunkt

## 5. Doku und Abschluss

- [x] 5.0 Review-Nachzüge: `odl:grundpegel` vom Cache-Prune ausgenommen (Test „Prune verschont den Grundpegel"), Sperrklinke höchstens 14 Tage (Test samt Grenzsekunde), Plausibilitätsschranke „mindestens die Hälfte der bekannten Sonden", Inspector „über 1,5 ×/über 3 ×" und Faktor mit zwei Nachkommastellen, kein „noch kein Grundpegel" unter fremder Einheit; je Backend-Riegel Mutationsprobe rot

- [x] 5.1 `docs/fachebenen-quellen.md`: Zeitreihen-Aussage korrigieren (1h-Layer liefert alle Sonden, Messung 21.09.2026), Grundpegel-Verfahren, Sperrklinke, Faktor-Schwellen als Projekt-Einteilung, Rückfall auf Bänder; `rg "1 676 Abrufe|eine Sonde je Abruf"` zeigt keine veraltete Aussage mehr ohne Einordnung
- [x] 5.2 Kommentar an `odl_stufe`/`ODL_*` in `normalisierung.rs` auf „Rückfall ohne Grundpegel" umstellen (der Satz „nicht billig zu haben" ist widerlegt)
- [ ] 5.3 Live-Abruf gegen den echten BfS-Dienst: Dev-Stack starten, Ebene zuschalten, nach dem Grundpegel-Lauf tragen ≥ 1 500 Sonden `bewertung: "standort"`; Inspector-Sichtprüfung beider Grundlagen in Hell und Dunkel (eine Sonde mit < 20 Werten für `absolut`)
- [ ] 5.4 `./scripts/check-all.sh` grün
