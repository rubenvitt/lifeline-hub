# LFH-640 — Lagebezogene Kennzahlreihe im Lage-Dashboard

Stand 23.09.2026 · Epic LFH-605 (Neuentwurf „Instrumententafel“) · Ursprung LFH-607

## Ausgangslage

Die Kennzahlreihe des Lage-Dashboards ist eine **feste Liste von sechs Etiketten**
(`KENNZAHL_ETIKETTEN` in `frontend/src/pages/lage-dashboard/lagebild.ts`). Nach LFH-606
lautet sie: Pegel · Betroffene · Kräfte · Vermisste · Schäden offen · Einsatzdauer. Ein Test
pinnt „genau 6 Kennzahlen“.

Der Auftraggeber hat am 22.09.2026 entschieden, dass „Evakuiert“ **nur bei geplanter
Evakuierung** erscheint. Außerdem braucht es ein Konzept, das verschiedene Lagen abbildet:
Ein Hochwasser braucht Pegel und Evakuiert, ein MANV Patienten und Transportstand, ein
Großbrand wieder andere Zahlen. Eine feste Reihe passt immer nur zu einer dieser Lagen.

Gemessene Randbedingungen, die das Modell bestimmen:

- **Einsatzart und Stichwort bilden keine Lage ab.** `Einsatzart` kennt nur `realeinsatz`,
  `uebung`, `sanitaetsdienst` und `bereitstellung`. Das Stichwort ist Freitext mit
  Vorschlagsliste (`src/stichwort`). Aus keinem der beiden folgt, ob ein Pegel oder eine
  Evakuierung eine Rolle spielt.
- **Bei einem kalten Deeplink rendert die Seite, bevor der Einsatz geladen ist.** `EinsatzLayout`
  rendert das `<Outlet />` schon, während `einsatzQuery` noch lädt, und die Seite fragt
  denselben Key ab. Eine Platzzahl, die vom Einsatz abhängt, lässt das Band beim Kaltstart
  springen (Kriterium 12).
- **Die Belegung muss aus der Quelle kommen, die zuerst da ist.** Hinge Platz 1 an der
  Pegel-Abfrage, stünde dort beim Laden kurz eine andere Kennzahl, bevor der Pegel sie
  ersetzt. Das verletzt Kriterium 9 schon beim Aufbau der Seite.
- **Die Einsatz-Abfrage ist nicht live** (`NICHT_LIVE_KEYS` in `api/queryKeys.ts`). Eine
  Änderung durch einen anderen Client kommt erst beim nächsten Abruf an (Fokus, Neuaufbau).

## Entscheidungen (Auftraggeber, 23.09.2026)

| Frage | Entscheidung |
|---|---|
| Wodurch wird die Reihe bestimmt? | **Fachentscheidung.** Bewusste Entscheidungen, die als Datensatz vorliegen, belegen die Lageplätze. Einen neuen Lagetyp gibt es nicht. |
| Raster | **Immer sechs Plätze:** vier Kernplätze und zwei Lageplätze. |
| Pegel ohne festgelegten Pegel | **Weglassen.** Eine Füllkennzahl belegt den Platz. Das ersetzt die LFH-606-Festlegung vom 22.09. („Platz bleibt belegt“). |
| Evakuiert | **Die Regel steht hier, Eintrag und Daten kommen mit LFH-607.** LFH-640 liefert Konzept und Mechanismus mit dem Pegel als erster Lagekennzahl. |

## Das Modell

### Sechs Plätze, vier davon fest

| Platz | Art | Belegung |
|---|---|---|
| 1 | **Lageplatz A** | Pegel, wenn ein maßgeblicher Pegel festgelegt ist, sonst **Verbleib offen** |
| 2 | Kern | Betroffene |
| 3 | **Lageplatz B** | Evakuiert, wenn eine Evakuierung angeordnet ist (LFH-607), sonst **Schäden offen** |
| 4 | Kern | Kräfte |
| 5 | Kern | Vermisste |
| 6 | Kern | Einsatzdauer |

Ein Hochwasser mit Pegel und Evakuierung ergibt damit genau die Reihe aus dem Entwurf S3:
Pegel · Betroffene · Evakuiert · Kräfte · Vermisste · Einsatzdauer.

Die Reihe hat immer sechs Plätze, 6 → 3 → 2 Spalten gehen ohne Rest auf. Damit steht die
Platzzahl fest, bevor irgendeine Abfrage da ist. Die Ladeplätze vor dem ersten
Einsatz-Abruf haben deshalb **keine Beschriftung**: Welche Kennzahl auf die Lageplätze
kommt, steht erst mit dem Einsatz fest. Eine vorab geratene Beschriftung würde beim
Eintreffen wechseln. Die leeren Beschriftungen halten ihre Zeilenhöhe, die Zelle springt
also nicht.

### Jede Kennzahl hat genau einen Heimatplatz

Das ist die Lesart von Kriterium 9, die dieses Modell trägt: **Wo eine Kennzahl steht,
steht sie immer, in jedem Einsatz.** Sie ist an ihrem Platz oder gar nicht da. Sie
rutscht nie auf einen anderen Platz, weil eine andere Kennzahl dazukommt oder wegfällt.
Wer „Pegel“ sucht, sucht in jedem Einsatz Platz 1.

Deshalb füllt die Reihe **nicht** nach Rang auf („erste aktive Lagekennzahl auf Platz 1,
zweite auf Platz 3“). Das hätte die Folge: Legt jemand bei einem Einsatz mit „Schäden
offen“ auf Platz 1 den Pegel fest, rutschen „Schäden offen“ auf Platz 3 und der bisherige
Inhalt von Platz 3 fällt weg. Eine Entscheidung würde also zwei Plätze ändern. Mit festen
Heimatplätzen ändert **eine Entscheidung genau einen Platz**.

Jeder Lageplatz hat eine **Rangfolge von Kandidaten** und eine **Füllkennzahl**:

- **Kandidaten** sind Lagekennzahlen mit eigenem Auslöser. Der Platz zeigt den ranghöchsten
  aktiven Kandidaten. Heute: A = [Pegel], B = [] (LFH-607 trägt „Evakuiert“ ein).
- **Die Füllkennzahl** steht, wenn kein Kandidat aktiv ist. Sie trägt echte Daten, die in
  jeder Lage vorliegen, und sie ist nie ein Platzhalter („—“, „nicht erfasst“). Das hält die
  Regel „Weglassen statt erfinden“ (`docs/design/2026-09-21-neuentwurf/umsetzung.md`,
  Punkt 4).

Die Zuordnung der Füllkennzahlen ist bewusst über Kreuz:

- **A → Verbleib offen.** Platz A ist frei, wenn kein Pegel festgelegt ist, also typisch
  bei MANV, Brand oder Unfall. Dort ist „wie viele Angetroffene haben noch keinen Verbleib“
  die offene Führungsfrage. Die Zahl kommt aus `personen/personenBilanz.ts`
  (`transportBilanz(…).offen`). Notiz „n transportiert“, Ton `achtung` bei > 0, Ziel ist
  das Modul Personen.
- **B → Schäden offen.** Platz B ist frei, solange keine Evakuierung angeordnet ist. Ein
  Hochwasser mit Pegel, aber ohne Evakuierung behält damit „Schäden offen“ im Band. Genau
  diese Lage betrifft der Umbau heute im Bestand.

„Verbleib offen“ steht als Zahl auch im Fuß des Sichtungspaneels („Transportiert / offen“,
LFH-613). Die Wiederholung ist gewollt: Die Kennzahl ist der Blickfang ohne Pegel, das
Paneel zeigt die Aufgliederung. Mit festgelegtem Pegel verschwindet die Kennzahl, das
Paneel bleibt.

### Auslöser: bewusste Entscheidungen, keine Messwerte

Ein Lageplatz wechselt **nur durch eine Entscheidung**, die jemand trifft und die als
Datensatz vorliegt. Ein Messwert, der sich während der Lage ändert, wechselt ihn nie.

| Lagekennzahl | Platz | Auslöser | Quelle | Ticket |
|---|---|---|---|---|
| Pegel | A | mindestens ein maßgeblicher Pegel festgelegt | `einsatz_pegel` (LFH-606) | **LFH-640** |
| Evakuiert | B | Plangröße der Evakuierung erfasst (> 0) | Betreuung / Evakuierung | LFH-607 (mit LFH-639) |

Keine Auslöser sind: ein Pegelwert über einer Schwelle, die Zahl der Betroffenen, eine
Warnstufe. Diese Werte ändern sich während der Lage, und die Reihe würde mit ihnen
flackern.

**Der Auslöser steht am Einsatz.** `EinsatzAnzeige` erhält das abgeleitete Feld
`lagekennzahlen: Lagekennzahl[]`. Das ist die Menge der aktiven Auslöser. Heute ist sie
leer oder `["pegel"]`, LFH-607 ergänzt `"evakuiert"`.

- Die Belegung hängt damit an der Abfrage, die als erste da ist. Außerdem teilt die Seite
  sie mit `EinsatzLayout`, sodass sie in aller Regel schon im Speicher liegt.
- `Lagekennzahl` ist ein Domänen-Enum mit wire-korrektem `serde(rename)`, registriert in
  `src/api_doc.rs` und gepinnt in `tests/enum_wire_kontrakt.rs`.
- Das Feld ist **nie absent**, leer ist `[]`. Es trägt deshalb `#[schema(required)]` und
  kein `skip_serializing_if`, nach dem Muster `meine_sachgebiete`. Gebaut wird es an beiden
  Stellen, an denen `EinsatzAnzeige` entsteht (`Einsatz::anzeige` und `repo::liste_fuer`).
- Jede Pegel-Mutation invalidiert zusätzlich `einsatzKeys.einsatz(einsatzId)`: Ersetzen in
  den Einstellungen und Anfügen aus dem Fachebenen-Inspektor der Lagekarte. Sonst sähe die
  festlegende Person den neuen Zuschnitt erst beim nächsten Abruf.

### Wechsel während der Betrachtung: gehalten, nicht getauscht

Ein neuer Zuschnitt kann ankommen, während jemand das Dashboard ansieht: eine Entscheidung
an einem anderen Platz, sichtbar beim nächsten Abruf. Dann **tauscht die Reihe nicht unter
dem Blick**. Die Seite hält den Zuschnitt, mit dem sie aufgebaut wurde, und zeigt über dem
Band ein Sammelbanner (`components/instrument/Sammelbanner.tsx`, Kriterium 12, dasselbe
Muster wie beim Meldungsstrom):

> Kennzahlreihe geändert: Pegel statt Verbleib offen · **übernehmen**

„Übernehmen“ setzt den neuen Zuschnitt. Beim nächsten Aufbau der Seite gilt er ohnehin.
Die Werte auf den gehaltenen Plätzen aktualisieren sich weiter, gehalten wird nur die
Frage, **welche** Kennzahl auf welchem Platz steht. Wechselt der Einsatz in derselben
Seiteninstanz (`:id`), gilt der neue Zuschnitt sofort, ohne Banner. Das ist dieselbe
Angleichung im Render wie bei der Wassermarke des Meldungsstroms.

Die eigene Entscheidung fällt auf einer anderen Seite (Einsatz-Einstellungen › Pegel). Beim
Rückweg baut sich das Dashboard neu auf und zeigt den neuen Zuschnitt ohne Banner.

### Auffindweg für den Pegel ohne eigenen Platz

Bis heute führte der belegte Pegel-Platz („kein Pegel festgelegt“) zur Auswahl. Ohne ihn
bleiben diese Wege:

- Einsatz-Einstellungen › Pegel (`einsatzEinstellungenPfad(id, 'pegel')`), unverändert
- die Pegel-Ebene der Lagekarte: Im Fachebenen-Inspektor wird eine Station direkt als
  maßgeblich festgelegt (`fuegePegelHinzu`, `pages/lagekarte/FachebenenInspector.tsx`)

Die Pegel-Marke im Führungsüberblick (S2) ist von diesem Ticket nicht betroffen.

Ein zusätzlicher Hinweis auf dem Dashboard ist **nicht** vorgesehen. Er würde für jeden
Einsatz ohne Pegelbezug dauerhaft eine Aufforderung ins Leere zeigen, also genau die Lage,
die diese Entscheidung beheben soll.

## Regel für „Evakuiert“ (Vorgabe für LFH-607)

- Kandidat auf **Lageplatz B**, Auslöser `evakuiert` am Einsatz: Die Plangröße der
  Evakuierung ist erfasst und größer als 0. Die Anordnung einer Evakuierung **ist** das
  Erfassen ihrer Plangröße, einen eigenen Schalter gibt es nicht.
- Wert: Zahl der Evakuierten. Notiz: „von N geplant“. Ob die Zahl ein Zähler ist oder aus
  der Betreuung abgeleitet wird (LFH-639), entscheidet LFH-607.
- Sinkt die Plangröße wieder auf 0 oder wird sie gelöscht, ist das ebenfalls eine bewusste
  Entscheidung. Platz B zeigt dann wieder „Schäden offen“, über denselben Bannerweg.
- Kriterium 9 ist damit erfüllt: „Evakuiert“ steht, wenn überhaupt, auf Platz 3. Das Anordnen
  einer Evakuierung ändert genau diesen Platz.

## Erweiterung

Eine neue Lagekennzahl (etwa für MANV: Patienten je SK oder ein Transportstand) braucht:

1. einen **Auslöser**, der eine bewusste Entscheidung mit eigenem Datensatz ist
   (siehe oben: kein Messwert),
2. einen **Heimatplatz** (A oder B) und einen **Rang** unter den Kandidaten dieses Platzes,
3. eine Variante in `Lagekennzahl` (Build bricht über den exhaustiven Wire-Pin).

Konkurrieren zwei aktive Kandidaten um einen Platz, gewinnt der Rang, der andere steht
nicht im Band. Reichen zwei Lageplätze dauerhaft nicht, ist das eine neue Entscheidung
(etwa ein Raster mit acht Plätzen) und keine Erweiterung dieses Modells.

## Umsetzung in LFH-640

**Backend**

- Enum `Lagekennzahl { Pegel }` (Wire `pegel`), Feld `EinsatzAnzeige.lagekennzahlen`,
  abgeleitet aus `EXISTS einsatz_pegel` an beiden Baustellen. Registriert in `api_doc`,
  gepinnt in `enum_wire_kontrakt`, Codegen über `scripts/check-typ-codegen.sh`.
- Tests: ohne Pegel `[]`, nach dem Festlegen `["pegel"]`, nach dem Leeren wieder `[]`. Das
  gilt für die Detail- **und** die Listen-Antwort. Das Vorhandensein des Feldes wird per
  `contains_key` geprüft, nicht per Index (CLAUDE.md, Typ-Codegen).

**Frontend**

- `lagebild.ts`: `KENNZAHL_ETIKETTEN` weicht einer Platzbeschreibung (vier Kernplätze mit
  festem Index, zwei Lageplätze mit Kandidaten und Füllkennzahl) und einer reinen Funktion
  `kennzahlReihe(lagekennzahlen): KennzahlEtikett[]`, die immer sechs Etiketten liefert.
  `baueLagebild` baut die Kennzahlen in dieser Reihenfolge. Neue Kennzahl „Verbleib offen“.
- `LageDashboardPage.tsx`: sechs Ladeplätze ohne Beschriftung vor dem Einsatz, gehaltener
  Zuschnitt mit Sammelbanner, Zustand je Kennzahl weiter als exhaustiver `Record` über die
  Etiketten.
- Pegel-Mutationen (Einstellungssektion und Fachebenen-Inspektor): Sie invalidieren
  zusätzlich den Einsatz-Key.
- Dateiköpfe (`lagebild.ts`, `LageDashboardPage.tsx`) und `umsetzung.md` Punkt 4 werden
  nachgezogen. Die LFH-606-Passage „Platz bleibt belegt“ wird ersetzt, nicht ergänzt.

**Tests, die die neue Regel pinnen** (Literale, nie aus der Platzbeschreibung gelesen)

- `kennzahlReihe([])` = Verbleib offen · Betroffene · Schäden offen · Kräfte · Vermisste ·
  Einsatzdauer
- `kennzahlReihe(['pegel'])` = Pegel · Betroffene · Schäden offen · Kräfte · Vermisste ·
  Einsatzdauer
- für jede Eingabe: Länge 6, Kern auf den Indizes 1, 3, 4 und 5 unverändert
- Heimatplatz: Kommt ein Auslöser hinzu, ändert sich genau ein Index
- Seite: sechs Ladeplätze vor dem Einsatz. Ein neuer Zuschnitt beim erneuten Abruf zeigt das
  Banner und lässt die Reihe stehen, bis „übernehmen“ geklickt wird. Ein Wechsel der `:id`
  übernimmt ohne Banner.
- `e2e/lage-dashboard-schmal.spec.ts` misst weiter sechs Zellen. Die Aussage bleibt,
  ihre Begründung im Test wird auf die neue Regel umgeschrieben.
- `e2e/pegel-pruefliste.spec.ts` (CLS des Pegel-Nachladens, Route `lage-dashboard`)
  simuliert die Pegelliste heute nur per `page.route`. Unter dem neuen Modell fehlt dem
  Einsatz damit der Auslöser, und der Pegel-Platz erscheint gar nicht. Der Test legt den
  Pegel deshalb vorher über die API fest und hält nur die Antwort mit den Messwerten zurück.

**Nicht in LFH-640:** Kennzahl „Evakuiert“, Plangröße und Zähler (LFH-607), Betreuungsmodul
(LFH-639), weitere Lagekennzahlen.

## Prüfliste Einsatztauglichkeit (Ziel für die Umsetzung)

Bezug: das Kennzahlenband des Lage-Dashboards. Die übrigen Flächen der Seite bleiben
unverändert, ihre Verdikte stehen in der Prüfliste zu LFH-606.

| # | Kriterium | Verdikt (Ziel) |
|---|---|---|
| 1 | Treffläche | erfüllt, unverändert: die Kennzahl ist ein Link über die ganze Zelle |
| 2 | Handschuh-Modus | erfüllt, unverändert: die Zellen erben die Dichteachse; der „übernehmen“-Knopf ist ein antd-`Button` und erbt `controlHeight` |
| 3 | Rückmeldung vor Serverantwort | nicht anwendbar: „übernehmen“ ist rein lokal, ohne Serveraufruf |
| 4 | Kritische Aktion, zweite Handlung | nicht anwendbar: keine kritische Aktion |
| 5 | Kontrast | erfüllt, unverändert: dieselbe `Kennzahl`-Komponente, dasselbe Sammelbanner wie im Meldungsstrom |
| 6 | Status nicht allein über Farbe | erfüllt: der Ton von „Verbleib offen“ steht zusätzlich als Zahl und Notiz |
| 7 | Eine Farbe = eine Bedeutung | erfüllt: `achtung` für offene Arbeit wie bei „Schäden offen“ |
| 8 | Helligkeitsregler | nicht anwendbar: seitenübergreifend, hier unberührt |
| 9 | Kritische Anzeigen im Blickfeld, dieselbe Größe an derselben Stelle | **erfüllt, Kern dieses Tickets**: feste Heimatplätze, Wechsel nur durch Entscheidung, pro Entscheidung ein Platz, kein Tausch unter dem Blick |
| 10 | Alarmbudget | erfüllt: das Banner ist eine Mitteilung ohne Alarmton und erscheint nur bei einer Entscheidung |
| 11 | Warnverhalten | erfüllt: kein Blinken, das Banner ist statisch |
| 12 | Kein Sprung unter dem Cursor | erfüllt: sechs Plätze vor jedem Abruf, das Banner ist opt-in. **Nachweis:** die CLS-Spec des Dashboards läuft ohne und mit festgelegtem Pegel |
| 13 | Fokus nie verdeckt | erfüllt, unverändert |
| 14 | Tabellenseite | nicht anwendbar |
| 15 | Erfassungsmaske | nicht anwendbar |
