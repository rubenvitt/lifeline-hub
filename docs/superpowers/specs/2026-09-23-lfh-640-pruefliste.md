# LFH-640 — Prüfliste Einsatztauglichkeit

Stand: 23.09.2026. Prüfliste nach Festlegung 7 der Bedien-Leitlinie
(`2026-07-25-bedien-leitlinie-einsatzkontexte.md`) für die Fläche, die LFH-640 umgebaut hat:
das **Kennzahlenband des Lage-Dashboards** (`pages/lage-dashboard/`) mit dem neuen Sammelbanner
„Kennzahlreihe geändert“. Die übrigen Flächen der Seite sind unverändert, ihre Verdikte stehen
in `2026-09-22-lfh-606-pruefliste.md`. Spec: `2026-09-23-lfh-640-lagebezogene-kennzahlreihe-design.md`.

## Verdikte

| # | Kriterium | Verdikt |
| --- | --- | --- |
| 1 | Treffläche | **erfüllt**: unverändert; jede Kennzahl ist ein Link über die ganze Zelle, `e2e/gate3-trefflaeche.spec.ts` misst weiter sechs Zellen über die Staffel [E1] |
| 2 | Handschuh-Modus | **offen → O4 aus LFH-606** (Bestand: 1-px-Fugen zwischen den Zellen). Der „übernehmen“-Knopf ist die Aktion des bestehenden `Sammelbanner` (antd-`Button type="link"`, erbt `controlHeight`) |
| 3 | Rückmeldung vor Serverantwort | **nicht anwendbar**: „übernehmen“ ist rein lokal, ohne Serveraufruf |
| 4 | Zweite Handlung bei kritischer Aktion | **nicht anwendbar**: keine kritische Aktion |
| 5 | Kontrast in beiden Modi | **erfüllt**: dieselbe `Kennzahl`-Komponente; die Pegel-Kennzahl ist mit echt festgelegtem Pegel in beiden Modi gemessen [E2]; das Banner ist dasselbe Primitiv wie im Meldungsstrom (Kontrast im Dateikopf von `Sammelbanner.tsx`) |
| 6 | Kein Status allein über Farbe | **erfüllt**: „Verbleib offen“ trägt Ton `achtung` zusätzlich als Zahl, Notiz und Innenkante [T1] |
| 7 | Eine Farbe = eine Bedeutung | **erfüllt**: `achtung` für offene Arbeit wie „Schäden offen“; das Banner ist blau (Bedienaufforderung), nicht rot |
| 8 | Helligkeits-/Kontrastregler | **offen → O5 aus LFH-606** (querschnittlich) |
| 9 | Kritische Anzeigen im Blickfeld / dieselbe Größe an derselben Stelle | **erfüllt**: jede Kennzahl hat genau einen Heimatplatz, der Kern steht auf festen Indizes, eine Entscheidung ändert genau einen Platz [T2], und ein neuer Zuschnitt während der Betrachtung tauscht nicht, sondern wird angeboten [T3] |
| 10 | Alarmbudget | **erfüllt**: das Banner ist `role="status"`, ohne Ton, und erscheint nur nach einer Entscheidung, nie durch Messwerte |
| 11 | Warnverhalten | **erfüllt**: kein Blinken, das Banner ist statisch |
| 12 | Kein Sprung unter dem Cursor | **für das Band erfüllt**: sechs Plätze vor jedem Abruf, ohne geratene Beschriftung [T4]; der Pegel-Beitrag zur CLS ist mit echt festgelegtem Pegel gemessen [E3]; der Wechsel des Zuschnitts ist opt-in [T3]. Der Seitenaufbau auf 390 px bleibt Bestand (**O1 aus LFH-606**) |
| 13 | Fokus nie verdeckt | **erfüllt**: das Band trägt kein `sticky`/`fixed`, das Banner steht im Fluss |
| 14 | Tabellenseite vollständig | **nicht anwendbar** |
| 15 | Erfassungsmaske vollständig | **nicht anwendbar** |

## Belege

- **[T1]** `LageDashboardPage.test.tsx` „ohne Auslöser: kein Pegel-Platz, Platz 1 trägt ‚Verbleib offen‘“; `lagebild.test.ts` „Verbleib offen: …“.
- **[T2]** `lagebild.test.ts`, Block `kennzahlReihe (LFH-640)`: Reihen als handgeschriebene Literale, Kern auf 1/3/4/5 für jede Eingabe, „ein hinzukommender Auslöser ändert genau EINEN Platz“.
- **[T3]** `LageDashboardPage.test.tsx`: „ein neuer Zuschnitt beim erneuten Abruf wird GEHALTEN …“, „… Einsatzwechsel … OHNE Banner“ (samt erneutem Halten für den neuen Einsatz), „die EIGENE Entscheidung … gilt ohne Banner“. Mutationsproben: Halten entfernt, Halten nur beim ersten Einsatz, Halten während des laufenden Abrufs — je ein Test rot.
- **[T4]** `LageDashboardPage.test.tsx` „stellt schon während des Einsatz-Abrufs sechs Plätze — ohne Beschriftung, Ziel und Stand“.
- **[E1]** `e2e/gate3-trefflaeche.spec.ts` (Lage-Dashboard), Lauf im Sammel-Gate.
- **[E2]** `e2e/pegel-pruefliste.spec.ts` „Pegel-Kennzahl: Wert, Notiz und Achtungskante im Modus light/dark“, seit LFH-640 mit per `PUT` festgelegtem Pegel.
- **[E3]** `e2e/pegel-pruefliste.spec.ts` „lage-dashboard: das Nachladen der Pegel-Angabe trägt ≤ 0,1 zur CLS bei“, ebenso.
- **Backend:** `tests/pegel.rs` „pegel_festlegen_schaltet_die_lagekennzahl_am_einsatz“ (Detail und Liste, hin und zurück, Isolation gegen einen zweiten Einsatz); `tests/enum_wire_kontrakt.rs` „einsatz_lagekennzahl_wire“.

## Bekannt und bewusst

- **Das Banner schiebt die Fläche beim Erscheinen nach unten.** Es erscheint nur nach einer
  Entscheidung an einem anderen Platz und ist die Opt-in-Form, die Kriterium 12 verlangt
  (dasselbe Muster wie im Meldungsstrom). Eine Messung dieses seltenen Falls im Browser gibt
  es nicht.
- **Ein fremder Zuschnittswechsel kommt erst beim nächsten Einsatz-Abruf an** (Fokus,
  Neuaufbau): der Einsatz-Key ist nicht live (`NICHT_LIVE_KEYS`). Für eine Entscheidung, die
  selten fällt, ist das ausreichend; ein Live-Ereignis wäre eine eigene Entscheidung.
