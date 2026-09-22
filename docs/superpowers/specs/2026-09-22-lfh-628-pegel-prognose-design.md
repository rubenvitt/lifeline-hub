# LFH-628 — Erwarteter Höchststand am maßgeblichen Pegel

Stand 22.09.2026. Ticket: LFH-628 (Entwicklungsboard), Folgetask zu LFH-606
(`2026-09-22-lfh-606-pegel-kennzahl-design.md`). Entwurfsquelle:
`docs/design/2026-09-21-neuentwurf/neuentwurf.dc.html`, S2 `marken`, ETB Nr. 409.

## Entscheidungen des Auftraggebers (22.09.2026)

1. **Die Reihe `WV` belegt vor**, sie ersetzt die Handerfassung nicht (Befund unten). Der
   Dialog zeigt ihren höchsten künftigen Wert als Vorschlag mit „Übernehmen“.
2. **Verstrichene Prognose: Marke weg, Hinweis bleibt.** Im Überblick verschwindet die Marke
   (vorbei ist nicht „überfällig“), in der Pegel-Kennzahl des Dashboards entfällt der Zusatz.
   In den Einstellungen steht die Prognose als „abgelaufen“, bis jemand sie löscht oder
   erneuert.
3. Die Migrationskollision im LFH-606-Branch (`0103_einsatz_pegel` neben
   `0103_etb_lesemarke`) gehört dem 606-Branch. Sie ist dort als `0104` behoben und mit
   PR #91 nach alpha gegangen; dieser Task setzt darauf auf (`0106`, weil alpha inzwischen `0105_einheit_funkrufname` trägt).

## Befund PEGELONLINE `WV` (gemessen 22.09.2026)

- `GET …/stations.json?timeseries=WV` → **43 Stationen** (Donau, Elbe, Rhein u. a.). Alle
  anderen Stationen antworten auf `…/stations/{uuid}/WV/measurements.json` mit **404**.
- `…/stations/{uuid}/WV.json`: `unit: "cm"`, `equidistance: 120` (2 h), `start`/`end` rund
  vier Tage, Kommentar „Vorhersagen und Abschätzungen vom … Quelle: Bundesanstalt für
  Gewässerkunde“.
- `…/WV/measurements.json` → `[{ "initialized", "timestamp", "value", "type" }]`, `type` ist
  `forecast` oder `estimate` (die späteren Tage). Die Reihe beginnt beim Rechenzeitpunkt,
  also auch mit Punkten in der Vergangenheit.

Folge: die Reihe kann die Handerfassung nicht ersetzen (die meisten Stationen haben keine),
und auch wo sie existiert, bleibt der Handwert maßgeblich — die Hochwasservorhersagezentrale
eines Landes kann eine andere Zahl nennen als die BfG.

## Backend

**Speicher:** vier Spalten an `einsatz_pegel` (Migration `0106_einsatz_pegel_prognose.sql`):
`prognose_cm REAL`, `prognose_zeit TEXT` (UTC, Wire-Format), `prognose_gesetzt_von_id`,
`prognose_gesetzt_at`; ein CHECK hält Wert und Zeitpunkt zusammen. Eine Prognose gehört zu
genau einer festgelegten Station und fällt mit ihr (entfernen und neu festlegen = neue Zeile
ohne Prognose).

**Nicht im Vollersatz-PUT der Liste.** `repo::ersetzen` setzt im Upsert nur Name, Gewässer,
Reihenfolge; Umordnen lässt die Prognose stehen
(`tests/pegel.rs::put_der_liste_laesst_die_prognose_stehen`).

| Methode | Pfad | Gate | Zweck |
|---|---|---|---|
| PUT | `/api/einsaetze/{id}/pegel/{pegel_id}/prognose` | Schreibzugriff | setzen/überschreiben: `{ hoechststand_cm, zeitpunkt }` |
| DELETE | `/api/einsaetze/{id}/pegel/{pegel_id}/prognose` | Schreibzugriff | löschen, idempotent |
| GET | `/api/einsaetze/{id}/pegel/{pegel_id}/vorhersage` | Lesezugriff | Vorschlag aus `WV` |

PUT und DELETE antworten mit der ganzen Liste (wie die übrigen Pegel-Routen). Statuscodes
(LFH-267): Wert nicht endlich oder außerhalb −1000…5000 cm, Zeitpunkt leer oder unlesbar →
**400**; Pegel gehört nicht zu diesem Einsatz → **404**. Ein Zeitpunkt in der Vergangenheit
wird angenommen: ob eine Prognose abgelaufen ist, entscheidet die Anzeige, und ein Nachtrag
darf nicht an einer Uhrabweichung scheitern. Der Wert wird auf ganze cm gerundet.

DTO: `PegelAnzeige.prognose?: { hoechststand_cm, zeitpunkt, gesetzt_at }`, fehlt ohne
Prognose (LFH-265).

**Vorhersage** (`pegel/vorhersage.rs`): nur auf Anfrage (Dialog öffnet sich), Cache
`pegel-wv:<uuid>` 30 min, auch „keine Reihe“ wird gecacht. Antwort
`{ vorhersage?: { hoechststand_cm, zeitpunkt, erstellt, abschaetzung } }`: der höchste Wert
**ab jetzt** (bei Gleichstand der früheste), `abschaetzung` für einen Wert aus dem
`estimate`-Teil. Quelle weg und kein Cache → **502**, der Dialog bleibt bedienbar.

**Kein ETB-Eintrag** beim Setzen: das Ticket verlangt ihn nicht. Der Neuentwurf zeigt die
Prognose als ETB-Zeile (Nr. 409) — das ist ein Eintrag, den der Stab schreibt, kein
Systemeintrag.

## Frontend

- `pegel/pegelKennzahl.ts`: `prognoseOffen`, `prognoseText` („Prognose 7,10 m bis 18:00“,
  am anderen Tag „bis 23. 06:00“). Die Kennzahl-Notiz trägt die offene Prognose des
  **Leitpegels** hinter dem Datenstand, auch bei Ausfall der Messung. Ohne oder mit
  abgelaufener Prognose ist die Notiz byte-gleich zur LFH-606-Fassung.
- `fuehrung/ueberblickDaten.ts:naechsteMarken`: vierte Quelle `pegelprognose`, Text
  „Erwarteter Höchststand Pegel <Station> (<Gewässer>): 7,10 m“, Ziel
  `…/einstellungen/pegel`. Die Station steht vorn, weil es eine Marke je festgelegtem Pegel
  gibt und zwei Pegel am selben Gewässer sonst nicht zu unterscheiden wären. Die
  verstrichene Prognose wird **vor** dem Sortieren herausgefiltert und steht nie als
  „überfällig“ oben. Alle festgelegten Pegel, nicht nur der Leitpegel.
- `einstellungen/EinsatzPegel.tsx`: je Zeile die Prognose (offen / „· abgelaufen“), im
  Zeilenmenü „Prognose erfassen …“/„Prognose ändern …“ und „Prognose löschen“. Löschen ohne
  Rückfrage mit Rückgängig-Toast (Rückweg = derselbe PUT mit dem alten Wert, LFH-343).
- `einstellungen/PegelPrognoseModal.tsx` auf `ErfassungsModal`: zwei Felder (Höchststand in
  **m**, Zeitpunkt), Vorschlag aus `WV` als Hinweis über den Feldern. Kern rein in
  `pegelPrognoseKern.ts`.

## Prüfliste Einsatztauglichkeit

Angelegt an die drei Flächen, die dieser Task ändert: **A** Pegel-Kennzahl (Notiz-Zusatz),
**D** Überblick-Marke, **E** Prognose in der Einstellungssektion samt Dialog.

| # | Kriterium | A · Kennzahl | D · Marke | E · Sektion/Dialog |
| --- | --- | --- | --- | --- |
| 1 | Treffläche | nicht anwendbar (kein neues Ziel) | erfüllt (bestehende Markenzeile) | erfüllt (antd-Steuerelemente, `ErfassungsModal`, kein `size`) |
| 2 | Handschuh-Modus | nicht anwendbar | erfüllt (wie 1) | erfüllt (wie 1) |
| 3 | Rückmeldung vor Serverantwort | nicht anwendbar | nicht anwendbar | erfüllt (Ladezustand am Knopf, Menü gesperrt während Schreiben) |
| 4 | Zweite Handlung bei kritischer Aktion | nicht anwendbar | nicht anwendbar | erfüllt (Löschen umkehrbar per Rückgängig) |
| 5 | Kontrast in beiden Modi | erfüllt (bestehende Notiz-Farbe) | erfüllt (bestehende Markenfarben) | erfüllt (antd-Alert, Rolle `gedaempft`) |
| 6 | Kein Status allein über Farbe | erfüllt (Wort „Prognose“) | erfüllt (Wort „in 20 min“) | erfüllt (Wort „abgelaufen“) |
| 7 | Eine Farbe = eine Bedeutung | erfüllt (keine neue Farbe) | erfüllt | erfüllt |
| 8 | Helligkeits-/Kontrastregler | offen → O5 aus LFH-606 | offen → O5 | offen → O5 |
| 9 | Kritische Anzeigen im Blickfeld | erfüllt (Teil der Kennzahl auf Platz 1) | nicht anwendbar | nicht anwendbar |
| 10 | Alarmbudget | erfüllt (Prognose alarmiert nie) | erfüllt (nie `alarm`, Test) | nicht anwendbar |
| 11 | Warnverhalten | erfüllt | erfüllt | erfüllt |
| 12 | Kein Sprung unter dem Cursor | offen → O1 aus LFH-606 (Seitenbestand) | erfüllt (Paneel-Höhe unverändert je Marke) | erfüllt (Dialog, kein Nachladen im Fluss) |
| 13 | Fokus nie verdeckt | nicht anwendbar | nicht anwendbar | erfüllt (`ErfassungsModal`: Fokus im ersten Feld) |
| 14 | Tabellenseite vollständig | nicht anwendbar | nicht anwendbar | nicht anwendbar |
| 15 | Erfassungsmaske vollständig | nicht anwendbar | nicht anwendbar | erfüllt (Hülle: Enter sendet, Reset auf allen Wegen, Fehler im Dialog) |

Belege: `pegel/pegelKennzahl.test.ts` (Prognose am Leitpegel), `fuehrung/ueberblickDaten.test.ts`
und `UeberblickPage.test.tsx` (Marke, Ziel, nie `alarm`), `einstellungen/EinsatzPegel.test.tsx`
(Zeile, Dialog mit Vorschlag, ohne Reihe, Quelle weg, Löschen mit Rückgängig, ohne Recht),
`einstellungen/pegelPrognoseKern.test.ts`, `tests/pegel.rs` (Routen), `pegel/vorhersage.rs`
(Parsen, Höchstwert ab jetzt, Cache).

## Nicht Teil dieses Tickets

ETB-Eintrag beim Setzen der Prognose; die Vorhersage-Reihe als eigene Kurve oder in der
Lagekarte; Hochwasser-Meldestufen am Pegel.
