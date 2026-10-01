# LFH-606 — Prüfliste Einsatztauglichkeit

Stand: 22.09.2026. Prüfliste nach Festlegung 7 der Bedien-Leitlinie
(`2026-07-25-bedien-leitlinie-einsatzkontexte.md`), angelegt an die drei Flächen, die
LFH-606 neu gebaut oder umgebaut hat:

- **A · Pegel-Kennzahl** — Platz 1 im Kennzahlenband des Lage-Dashboards
  (`pages/lage-dashboard/`) und die Pegel-Notiz an der Warnstufe des Überblicks
  (`pages/fuehrung/UeberblickPage.tsx`), beide aus `pegel/pegelKennzahl.ts`.
- **B · Einstellungssektion „Pegel“** — `…/einstellungen/pegel`,
  `pages/einstellungen/EinsatzPegel.tsx`.
- **C · Knopf im Fachebenen-Inspector** — „Als maßgeblichen Pegel festlegen“ bzw. die Marke
  „maßgeblicher Pegel“ an einem PEGELONLINE-Punkt der Lagekarte
  (`pages/lagekarte/FachebenenInspector.tsx`).

Browsermessungen stehen in `frontend/e2e/pegel-pruefliste.spec.ts` (13 Tests, Chromium) und
bleiben als Gate-3-/Schmal-Nachweis im Repo. Die Spec ist **hermetisch**: Pegel-Liste und
Stationsliste kommen per `page.route` aus Literalen. Ein Nachweis, der am Netz von PEGELONLINE
hängt, misst dessen Erreichbarkeit und nicht die Oberfläche. Die Werte unten stammen aus dem
Lauf vom 22.09.2026 (Backend-Binary aus eigenem `CARGO_TARGET_DIR`, Stand dieses Branches).

## Verdikte

| # | Kriterium | A · Kennzahl | B · Sektion | C · Inspector |
| --- | --- | --- | --- | --- |
| 1 | Treffläche | **erfüllt** [M1] | **erfüllt** [M2] | **erfüllt** (O3 eingelöst, LFH-631) [M8] |
| 2 | Handschuh-Modus | **erfüllt** (O4 eingelöst, LFH-630) [M1] | **erfüllt** [M2] | **erfüllt** [M8] |
| 3 | Rückmeldung vor Serverantwort | **nicht anwendbar** | **erfüllt** [T1, B1] | **erfüllt** [T4, B1] |
| 4 | Zweite Handlung bei kritischer Aktion | **nicht anwendbar** | **nicht anwendbar** | **nicht anwendbar** |
| 5 | Kontrast in beiden Modi | **erfüllt** [M3] | **erfüllt** [M4] | **erfüllt** [M9] |
| 6 | Kein Status allein über Farbe | **erfüllt** [T2, M3] | **erfüllt** [T1] | **erfüllt** [T4] |
| 7 | Eine Farbe = eine Bedeutung | **erfüllt** [Q1] | **erfüllt** [Q1] | **erfüllt** [Q1] |
| 8 | Helligkeits-/Kontrastregler | **offen → O5** | **offen → O5** | **offen → O5** |
| 9 | Kritische Anzeigen im Blickfeld | **erfüllt** [T3] | **nicht anwendbar** | **nicht anwendbar** |
| 10 | Alarmbudget | **nicht anwendbar** | **nicht anwendbar** | **nicht anwendbar** |
| 11 | Warnverhalten | **erfüllt** [Q1] | **erfüllt** [Q1] | **erfüllt** [Q1] |
| 12 | Kein Sprung unter dem Cursor | **offen → O1** [M5] | **erfüllt** [M6] | **erfüllt** [T4] |
| 13 | Fokus nie verdeckt | **erfüllt** [Q2] | **erfüllt** [M7] | **erfüllt** [M10] |
| 14 | Tabellenseite vollständig | **nicht anwendbar** | **nicht anwendbar** | **nicht anwendbar** |
| 15 | Erfassungsmaske vollständig | **nicht anwendbar** | **erfüllt** [T1] | **nicht anwendbar** |

### Begründungen der Verdikte

- **1 · A:** Die sechs Zellen des Bands, also auch „Pegel“, misst
  `e2e/gate3-trefflaeche.spec.ts` über die Staffel 30 / 48 / 72 px (voller e2e-Lauf grün). Im
  Überblick hat LFH-606 kein neues Ziel gebaut, nur eine Notiz an einer bestehenden Kennzahl.
- **1 · C:** Am Inspector selbst gemessen (LFH-631, [M8]): „Als maßgeblichen Pegel festlegen“
  und „Schließen“ halten 30 / 48 / 72 px auf 1366 und 390 px. Vorher war C nur über die
  Bauform-Gleichheit mit B belegt (O3).
- **2 · A:** Die Zellen erreichen 72 px Höhe. Sie stehen aber im Fugenraster des Neuentwurfs
  (1 px Fuge), der geforderte Abstand von ≥ 16 px fehlt. Das ist Bestand aus dem Band
  selbst und nicht durch LFH-606 entstanden. Weil ein Verdikt die ganze Zeile trägt, war es
  **offen** (O4). Eingelöst mit LFH-630: die Links rücken in ihrer Zelle um 8 px ein, die Fuge
  bleibt 1 px, Gate 3 misst ≥ 16 px zwischen den Kennzahlen.
- **2 · B:** Alle Ziele erreichen im Handschuh-Betrieb 72 px, auf 1366 und 390 px. Die
  Abstände liegen bei 16 px (Auswahl ↔ „Hinzufügen“) sowie 33 bzw. 83 px (Zeilenmenüs
  untereinander); die Spec sichert ≥ 16 px zu. Die Einträge im geöffneten Dreipunkt-Menü
  stehen bündig untereinander (antd-`Dropdown`, im ganzen Bestand so); jeder ist 72 px hoch.
- **2 · C:** Beide Ziele erreichen im Handschuh-Betrieb 72 px. Das nächste Bedienziel neben dem
  Knopf ist der Kopf des Paneels darunter, 28 px entfernt; die Spec sichert ≥ 16 px zu [M8].
- **3 · A:** Die Kennzahl liest nur, es gibt keine Aktion.
- **3 · B/C:** Die Rückmeldung unter 100 ms ist belegt: Während eines PUT sind die
  Zeilenmenüs gesperrt, „Hinzufügen“ bzw. der Inspector-Knopf zeigen den Ladezustand
  [T1, T4]. Die Kommandoreaktion ≤ 2 s trägt das Backend seit dem Review-Fix „kalter Abruf gebremst“: PUT und POST warten
  nie auf PEGELONLINE, sie antworten aus dem Cache und stoßen fehlende Messungen im
  Hintergrund an [B1]; die Anzeige holt die fehlende Messung einmal nach ~10 s nach (O2,
  eingelöst).
- **4:** Keine der Flächen trägt eine kritische Aktion im Sinne des Kriteriums. „Entfernen“
  eines Pegels ist umkehrbar (wieder hinzufügen, derselbe Bildschirm) und löscht keine Daten.
  Nach LFH-378 bekommt eine umkehrbare Aktion keine Rückfrage. „Festlegen“ ist additiv.
- **5 · C:** Am Inspector gemessen [M9]: Titel, Knopftext und die Marke „maßgeblicher Pegel ·
  Leitpegel“ halten im Tag- und Nachtmodus ≥ 4,5 : 1, der Titel ≥ 7 bzw. 5 : 1. Die Marke ist
  derselbe antd-`Tag` wie die Leitpegel-Marke in B und misst auch denselben Wert.
- **6:** „veraltet“ trägt das Wort in der Notiz **und** die 3-px-Achtungskante. Der Trend
  steht als Wort (steigend / fallend / gleichbleibend / Trend unbekannt), der Ausfall als
  „Stand unbekannt“. Die Leitpegel-Marke ist Text. Der gesperrte Inspector-Knopf nennt seinen
  Grund in Worten („Schon 5 maßgebliche Pegel festgelegt …“).
- **7:** Es kommt keine neue Farbe dazu. `achtung` steht nur für abnorme Zustände (veraltet,
  Ausfall), sonst ist die Kennzahl neutral. Die Marken tragen keine Farbe. Kein Hex- oder
  RGB-Literal in den neuen Dateien [Q1].
- **8:** Querschnittlich, kein Merkmal einer einzelnen Fläche (O5).
- **9 · A:** Der Pegel steht auf Platz 1 des Bands, oben links, in jedem Zustand an derselben
  Stelle — auch „kein Pegel festgelegt“ belegt den Platz.
- **9 · B/C:** Keine kritische Anzeige. Die Sektion und das Inspector-Paneel dienen der
  Einrichtung.
- **10:** Keine der Flächen erzeugt einen Alarm. Toasts erscheinen nur nach einer eigenen
  Handlung. Der Übergang zu „veraltet“ ist ein Zustand an der Kennzahl, kein Alarm, und kippt
  je Messung höchstens einmal.
- **12 · A:** Der Beitrag des Pegel-Nachladens zur CLS liegt auf allen drei Breiten bei
  höchstens 0,012 [M5]. Die Seiten selbst liegen beim **Aufbau** auf 390 px über 0,1 (O1),
  und auf 1024 px bricht beim Start unter Umständen die Kopfzeile um (O6) — beides ohne
  Pegel-Bezug; deshalb bleibt die Zeile offen.
- **12 · C:** Der Platz ist ab dem ersten Render belegt: Der Knopf steht gesperrt da, solange
  die Liste lädt, und wird dann zu Knopf oder Marke [T4]. Nichts wird nachträglich
  eingeschoben.
- **13 · A:** Das Band liegt im Fluss, ohne `sticky`/`fixed` (Leitlinie, Validierung
  Kriterium 13). LFH-606 fügt keinen fixierten Knoten hinzu [Q2].
- **13 · C:** Der Inspector steht im Fluss der Kartenleiste, unter `lg` unter der Karte. Der
  Tabulaturdurchlauf bei 390 × 420 im Handschuh-Betrieb erreicht beide Ziele vorwärts und
  rückwärts, keins verdeckt, auch nicht von den Kartenaufbauten [M10].
- **15 · B:** Das Label steht sichtbar über dem Feld (`<label for>`, seit diesem Commit). Die
  Sammelliste hat Umordnen und Entfernen je Zeile. Voller Tastaturweg ist belegt: Tippen,
  Enter wählt, Tab, Enter legt an [T1]. „Speichern und nächsten anlegen“ und Vorbelegungen
  entfallen: ein einziges Auswahlfeld, gespeichert wird sofort.
- **14:** Keine der Flächen ist eine Tabelle.

## Belege

**Browsermessungen** (`frontend/e2e/pegel-pruefliste.spec.ts`, 13/13 bestanden):

- **[M1]** `e2e/gate3-trefflaeche.spec.ts`, Test „Lage-Dashboard: Kennzahl-Zellen …“: alle
  sechs Zellen des Bands halten 30 / 48 / 72 px (voller e2e-Lauf 172/172 grün).
- **[M2]** „Trefflächen über die Staffel, kein Querlauf auf 390 px“:

  | Breite / Dichte | Auswahl | Hinzufügen | Zeilenmenü | Menüeintrag | Abstand Auswahl↔Knopf | Abstand Menüs | Querlauf |
  | --- | --- | --- | --- | --- | --- | --- | --- |
  | 1366 / kompakt | 30 | 30 | 30 | 24–30 | 7 | 32 | 0 |
  | 1366 / komfortabel | 48 | 48 | 48 | 48 | 11 | 25 | 0 |
  | 1366 / handschuh | 72 | 72 | 72 | 72 | 16 | 33 | 0 |
  | 390 / kompakt | 29,5 | 30 | 30 | 24–30 | 7 | 43 | 0 |
  | 390 / komfortabel | 48 | 48 | 48 | 48 | 11 | 50 | 0 |
  | 390 / handschuh | 72 | 72 | 72 | 72 | 16 | 83 | 0 |

  Menüeinträge sind gegen das Tripel von `controlHeightSM` (24 / 48 / 72) geprüft. antd gibt
  ihnen die kleine Steuerhöhe; 24 px ist der WCAG-2.5.8-Boden. Die Zeilenmenüs sind ≥ 24 px
  breit. Die 29,5 px der Auswahl liegen in der Subpixel-Toleranz der Spec (0,5 px).
- **[M3]** „Pegel-Kennzahl: Wert, Notiz und Achtungskante“ (Kontrast gegen die
  zusammengesetzte Grundfläche, Alpha gemischt):

  | Modus | Zustand | Wert | Notiz | Achtungskante |
  | --- | --- | --- | --- | --- |
  | Tag | frisch | 18,47 | 8,42 | — |
  | Tag | veraltet | 18,47 | 8,42 | 6,92 |
  | Nacht | frisch | 15,70 | 7,27 | — |
  | Nacht | veraltet | 11,75 | 7,27 | 11,75 |

  Soll: Text Tag ≥ 7 : 1, Nacht ≥ 5 : 1, Kante ≥ 3 : 1. Die Notiz der Überblick-Kennzahl ist
  dasselbe Primitiv (`Kennzahl`) mit derselben Rolle `gedaempft`.
- **[M4]** „Kontrast von Titel, Messzeile und Leitpegel-Marke“: Tag 18,47 / 8,42 / 16,94,
  Nacht 15,70 / 7,27 / 12,87.
- **[M5]** „…das Nachladen der Pegel-Angabe trägt ≤ 0,1 zur CLS bei“. Gemessen wird nur
  der Beitrag des Nachladens: Die Pegel-Antwort wird zurückgehalten, bis die Seite 700 ms
  lang keine neue Verschiebung zeigt; dann setzt die Spec eine Marke und gibt sie frei.
  Gezählt werden die `layout-shift`-Einträge nach der Marke, ohne Eingabe-Folgen. Die
  Einträge davor stehen mit ihren Quellen als „Aufbau“ daneben.

  | Seite | Pegel 1366 | Pegel 1024 | Pegel 390 | Aufbau 1366 | Aufbau 1024 | Aufbau 390 |
  | --- | --- | --- | --- | --- | --- | --- |
  | Überblick | 0,003 | 0,004 | 0,007 | 0,019 | 0,044 | 0,157 |
  | Lage-Dashboard | 0,002 | 0,004 | 0,012 | 0,018 | 0,025 | 0,157 |

  Dieselben Werte unter Linux-Chromium (Docker, `mcr.microsoft.com/playwright:v1.62.0-noble`,
  Browser per `connectOptions`): Pegel 0,003 / 0,004 / 0,007 bzw. 0,002 / 0,004 / 0,012. Die
  Mutationsprobe „160 px Block über dem Band, sobald die Pegel-Daten da sind“ färbt den Test
  rot (0,151 auf 390 px).

  **Warum nicht mehr die Seiten-CLS:** Die erste Fassung summierte alle Einträge ab dem
  Seitenaufbau. In der CI (Run 35726795873, Job „e2e 4/4“) fiel sie bei 1024 px mit
  0,40–0,45 auf **allen drei** Flächen, auch in der Sektion ohne Kennzahlenband. Das war
  der Kopfzeilen-Umbruch aus O6 und hatte mit dem Pegel nichts zu tun.
- **[M6]** „…das Nachladen von Liste und Stationen trägt ≤ 0,1 zur CLS bei“ (beide Antworten
  zurückgehalten und gemeinsam freigegeben): Pegel-Beitrag 0,000 auf allen drei Breiten,
  Aufbau 0,001 / 0,004 / 0,002.
- **[M7]** „Tabulaturdurchlauf ohne verdecktes Fokusziel (390 × 420)“: 37 Stopps, alle vier
  markierten Sektionsziele erreicht (Reiter „Pegel“, beide Zeilenmenüs, Auswahl), 0 verdeckt,
  1 fixierter Knoten im Baum. Messkern `e2e/fokus-kern.ts`.

Fachebenen-Inspector (LFH-631, Lauf vom 01.10.2026): der Test schaltet die Ebene „Pegel /
Hochwasser“ über ihren benannten Schalter ein, springt per Map-Instanz (`window.__lfhKarte`, nur
im Dev-Build) zur Station und klickt den Punkt mit der echten Maus. Stationen und Pegelliste sind
gestellt (hermetisch); KASSEL steht nicht in der Liste und trägt den Knopf, HANN. MÜNDEN ist
Leitpegel und trägt die Marke.

- **[M8]** „Fachebenen-Inspector: Trefflächen über die Staffel, Abstand im Handschuh-Betrieb“:

  | Breite / Dichte | Festlegen | Schließen | Abstand zum nächsten Ziel | Querlauf |
  | --- | --- | --- | --- | --- |
  | 1366 / kompakt | 30 | 30 | 13 | 0 |
  | 1366 / komfortabel | 48 | 48 | 20 | 0 |
  | 1366 / handschuh | 72 | 72 | 28 | 0 |
  | 390 / kompakt | 30 | 30 | 13 | 0 |
  | 390 / komfortabel | 48 | 48 | 20 | 0 |
  | 390 / handschuh | 72 | 72 | 28 | 0 |

  Nächstes Ziel ist jeweils der Kopf des Paneels „Nicht verortet“. Mutationsprobe
  `size="small"` am Knopf: rot (24 px gegen ≥ 30).
- **[M9]** „Fachebenen-Inspector: Kontrast von Titel, Knopf und Pegel-Marke“: Tag 16,93 / 8,15 /
  16,94, Nacht 16,37 / 15,70 / 12,87. Mutationsprobe Knopftext `#999`: Tag rot (2,84).
- **[M10]** „Fachebenen-Inspector: Tabulaturdurchlauf ohne verdecktes Fokusziel (390 × 420,
  Handschuh)“: je 6 Stopps vorwärts ab „Schließen“ und rückwärts ab „Festlegen“, beide Ziele
  erreicht, 0 verdeckt; Kartenaufbauten als Zusatzkandidaten. Mutationsprobe „fester Block
  über dem unteren Rand“: rot.

**Komponenten- und Unit-Tests** (Vitest):

- **[T1]** `pages/einstellungen/EinsatzPegel.test.tsx` (27 Tests): Zeilenmenüs während des
  PUT gesperrt, „Hinzufügen“ mit Ladezustand bis zur Antwort. Die Mutationsprobe
  „`disabled={false}` am Dropdown“ färbt den Sperrtest rot. Voller Tastaturweg samt sichtbarem
  Label. Gesperrte Richtungen an den Enden statt Weglassen. Ohne Schreibrecht Grund oben,
  Steuerelemente gesperrt. Grenze fünf mit Grund, Fehler an der Seite, Hinweis bei nicht
  erreichbarer oder leerer Fachebene.
- **[T2]** `pegel/pegelKennzahl.test.ts`: Fälle frisch / veraltet (Grenze 60 min) / Ausfall /
  keiner / mehrere, Trend als Wort mit echtem Minus, Zeit mit Versatz über beide
  Sommerzeit-Grenzen.
- **[T3]** `pages/lage-dashboard/LageDashboardPage.test.tsx`: handgeschriebener Pin des
  Kennzahl-Sets mit „Pegel“ an erster Stelle, auch während des Einsatz-Abrufs.
- **[T4]** `pages/lagekarte/FachebenenInspector.test.tsx`, Block „Pegel festlegen“: Knopf erst
  nach geladener Liste bedienbar, Marke statt Knopf, gesperrt mit Grund und Weg bei fünf
  Pegeln, nichts ohne Schreibrecht oder `uuid`.
- **[T6]** `api/pegel.test.ts` (reine Nachfrage-Regel) und `api/pegelNachfrage.test.tsx`
  (TanStack-Kreislauf mit Fake-Timern: genau ein Abruf nach ~10 s, keine Schleife, ohne Lücke
  keine Nachfrage).
- **[T5]** `components/dichte.guard.test.ts` (kein punktuelles `size` auf interaktiven
  Elementen) und die Bauform-Gleichheit mit [M2].
- **[T7]** `pages/lagekarte/Sidebar.test.tsx`, „gibt jedem Fachebenen-Schalter den Ebenennamen als
  zugänglichen Namen“ (LFH-631): jede Zeile der Fachebenen-Liste trägt genau einen Schalter, der
  per Rolle und Ebenennamen greifbar ist. Mutationsprobe ohne `aria-label`: rot.

**Backend:**

- **[B1]** Review-Fix „kalter Abruf gebremst“ (`src/pegel/abruf.rs`, `Modus::NurCache`): schreibende Routen
  warten nie auf die Quelle; Beleg ist der Test `nur_cache_wartet_nie_und_stoesst_an` in
  `src/pegel/abruf.rs`.

**Quelltext:**

- **[Q1]** Kein Hex- oder RGB-Literal und keine Animation/Transition in den neuen und
  geänderten Dateien (`grep` über `pegel/`, `api/pegel.ts`, `EinsatzPegel.tsx` und den Diff
  von Dashboard, Überblick und Inspector). Farben kommen aus `useRollen`/`theme.useToken`.
- **[Q2]** Das Band trägt kein `position: sticky|fixed`; LFH-606 hat daran nichts geändert.

## Offene Punkte

- **O1 · CLS auf 390 px (Lage-Dashboard, Überblick):** Beide Seiten liegen auf dem
  Handschirm bei CLS ≈ 0,16–0,17 — **auch mit leerer Pegel-Liste**. Das ist Bestand der
  Seiten, nicht von LFH-606 verursacht. Der Pegel-Anteil liegt im Rauschen der Messung. Die
  Ursache (welche Abfrage die Verschiebung auslöst) ist nicht untersucht.
- **O2 · Neu festgelegte Station zeigt bis zu 5 min „Stand unbekannt“ — eingelöst.** Seit
  dem Review-Fix „kalter Abruf gebremst“ antworten PUT und POST für eine noch nicht gecachte Station ohne Messung. Das
  Frontend fragt jetzt **einmal** nach ~10 s nach, wenn einem Eintrag die Messung fehlt
  (`PEGEL_NACHFRAGE_MS`), nach Schreiben wie beim ersten Laden. Fehlt sie danach weiter, gilt
  wieder der 5-min-Takt. Träger ist `refetchInterval` als Funktion der Daten
  (`naechsterPegelAbruf` in `api/pegel.ts`), kein eigener Timer; das Intervall endet mit dem
  letzten Beobachter. Gemessen dabei: TanStack wertet `refetchInterval` bei jedem Render und
  jeder Zustandsänderung aus, nicht nur nach einem Abruf. Eine Funktion, die sich beim
  ersten Aufruf „erledigt“ merkt, setzt das kurze Intervall deshalb vor dem Feuern zurück; die
  Regel ist darum idempotent je Datenstand. Belege: [T6]; Mutationsproben „fester Takt“,
  „nicht idempotent“ und „immer kurz“ färben je mindestens einen Test rot.
- **O3 · Keine Browsermessung am Fachebenen-Inspector — eingelöst (LFH-631).** Im e2e gab es
  keinen Klickpfad zu einem Fachebenen-Punkt, und die Fachebenen-Schalter der Leiste galten als
  namenlos. Die Schalter tragen den Ebenennamen (`aria-label` in `pages/lagekarte/Sidebar.tsx`,
  über alle Ebenen abgesichert in `Sidebar.test.tsx`, [T7]); der Klickpfad und die Messungen
  stehen als [M8]–[M10] oben. Kriterien 1, 2, 5 und 13 sind am Inspector jetzt gemessen.
- **O4 · Abstand zwischen den Kennzahl-Zellen — eingelöst (LFH-630,
  `openspec/changes/archive/2026-10-01-lfh-630-kennzahlenband-handschuh-abstand/design.md`).** Das Fugenraster des Neuentwurfs setzt 1 px
  zwischen die Zellen des Bands, im Handschuh-Betrieb fordert Kriterium 2 ≥ 16 px. Das betrifft
  alle sechs Zellen und ist mit dem Band entstanden, nicht mit LFH-606.
- **O6 · Kopfzeile bricht bei 1024 px beim Start auf zwei Reihen um (Bestand, alle
  Einsatzseiten):** `einsatz/AlarmZentrale.tsx` startet mit
  `useState(alarmTonStatus() ?? 'blockiert')` und zeigt damit „Ton blockiert“ als Wort, bis
  die Audio-Prüfung antwortet. Zusammen mit „Desktop blockiert“ und „VERBINDE“ passt die
  Kopfzeile bei 1024 px nicht mehr in eine Reihe (der Kommentar dort nennt den Umbruch
  52 → 104 px selbst). Die ganze Fläche rutscht um 52 px nach unten, das Suchfeld springt nach
  rechts.
  - **Beleg CI:** Trace des Retry, 1024-px-Phase. Frame 194865 zeigt die zweireihige
    Kopfzeile mit „Desktop blockiert · Ton blockiert · VERBINDE“, ~0,5 s später ist sie
    wieder einreihig.
  - **Beleg lokal:** Linux-Chromium im Docker, ein Eintrag von 0,4645 mit den Quellen
    `ant-layout` (y 53 → 105), `kopf-rechts` (y 0 → 52), `kopf-suche` (x 351 → 718);
    derselbe Wert auf `/einsatzdaten`, einer Route ohne Pegel-Bezug.
  - **Warum nur in der CI:** Unter macOS und in schnellen Läufen ist der Status schon beim
    ersten Bild bekannt.
  - **Mögliche Richtung:** den Zustand „noch nicht geprüft“ nicht als „blockiert“
    ausgeben. Das ist eine Entscheidung an der Alarmzentrale (LFH-392/LFH-511), keine an
    LFH-606.
- **O5 · Helligkeits-/Kontrastregler:** Querschnittlich. Die Leitlinie weist ihn einem eigenen
  Folge-Task zu („Was diese Leitlinie nicht entscheidet“).

## Im Zuge dieser Prüfliste geändert

- `EinsatzPegel.tsx`: sichtbares `<label for>` „Station wählen“ über der Auswahl statt eines
  bloßen `aria-label` (Kriterium 15). Der zugängliche Name bleibt gleich.
- Neue Tests: Rückmeldung vor der Serverantwort (Menüs gesperrt, „Hinzufügen“ lädt) und der
  volle Tastaturweg. Dabei gemessen: rc-select wertet Enter am legacy `keyCode` aus, dieselbe
  Falle wie antds `Editable`. Im Test deshalb `fireEvent` mit `keyCode`. Zwischen Feld und
  Knopf liegt als zusätzlicher Tab-Stopp der Leeren-Knopf, den antd fokussierbar macht.
- `frontend/e2e/pegel-pruefliste.spec.ts` (neu).
