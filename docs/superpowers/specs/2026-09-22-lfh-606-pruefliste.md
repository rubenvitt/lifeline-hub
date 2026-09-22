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

Browsermessungen stehen in `frontend/e2e/pegel-pruefliste.spec.ts` (9 Tests, Chromium) und
bleiben als Gate-3-/Schmal-Nachweis im Repo. Die Spec ist **hermetisch**: Pegel-Liste und
Stationsliste kommen per `page.route` aus Literalen. Ein Nachweis, der am Netz von PEGELONLINE
hängt, misst dessen Erreichbarkeit und nicht die Oberfläche. Die Werte unten stammen aus dem
Lauf vom 22.09.2026 (Backend-Binary aus eigenem `CARGO_TARGET_DIR`, Stand dieses Branches).

## Verdikte

| # | Kriterium | A · Kennzahl | B · Sektion | C · Inspector |
| --- | --- | --- | --- | --- |
| 1 | Treffläche | **erfüllt** [M1] | **erfüllt** [M2] | **erfüllt** [T5] |
| 2 | Handschuh-Modus | **offen → O4** [M1] | **erfüllt** [M2] | **erfüllt** [T5] |
| 3 | Rückmeldung vor Serverantwort | **nicht anwendbar** | **offen → O2** [T1] | **offen → O2** [T4] |
| 4 | Zweite Handlung bei kritischer Aktion | **nicht anwendbar** | **nicht anwendbar** | **nicht anwendbar** |
| 5 | Kontrast in beiden Modi | **erfüllt** [M3] | **erfüllt** [M4] | **erfüllt** [M4, T5] |
| 6 | Kein Status allein über Farbe | **erfüllt** [T2, M3] | **erfüllt** [T1] | **erfüllt** [T4] |
| 7 | Eine Farbe = eine Bedeutung | **erfüllt** [Q1] | **erfüllt** [Q1] | **erfüllt** [Q1] |
| 8 | Helligkeits-/Kontrastregler | **offen → O5** | **offen → O5** | **offen → O5** |
| 9 | Kritische Anzeigen im Blickfeld | **erfüllt** [T3] | **nicht anwendbar** | **nicht anwendbar** |
| 10 | Alarmbudget | **nicht anwendbar** | **nicht anwendbar** | **nicht anwendbar** |
| 11 | Warnverhalten | **erfüllt** [Q1] | **erfüllt** [Q1] | **erfüllt** [Q1] |
| 12 | Kein Sprung unter dem Cursor | **offen → O1** [M5] | **erfüllt** [M6] | **erfüllt** [T4] |
| 13 | Fokus nie verdeckt | **erfüllt** [Q2] | **erfüllt** [M7] | **offen → O3** |
| 14 | Tabellenseite vollständig | **nicht anwendbar** | **nicht anwendbar** | **nicht anwendbar** |
| 15 | Erfassungsmaske vollständig | **nicht anwendbar** | **erfüllt** [T1] | **nicht anwendbar** |

### Begründungen der Verdikte

- **1 · A:** Die sechs Zellen des Bands, also auch „Pegel“, misst
  `e2e/gate3-trefflaeche.spec.ts` über die Staffel 30 / 48 / 72 px (voller e2e-Lauf grün). Im
  Überblick hat LFH-606 kein neues Ziel gebaut, nur eine Notiz an einer bestehenden Kennzahl.
- **1 · C:** Der Knopf ist ein antd-`Button` ohne `size`. Dieselbe Bauform ist in B im Browser
  gemessen („Hinzufügen“, [M2]); `dichte.guard.test.ts` ist grün. Eine eigene Browsermessung
  am Inspector fehlt (→ O3).
- **2 · A:** Die Zellen erreichen 72 px Höhe. Sie stehen aber im Fugenraster des Neuentwurfs
  (1 px Fuge), der geforderte Abstand von ≥ 16 px fehlt. Das ist Bestand aus dem Band
  selbst und nicht durch LFH-606 entstanden. Weil ein Verdikt die ganze Zeile trägt, ist es
  **offen** (O4).
- **2 · B:** Alle Ziele erreichen im Handschuh-Betrieb 72 px, auf 1366 und 390 px. Die
  Abstände liegen bei 16 px (Auswahl ↔ „Hinzufügen“) sowie 33 bzw. 83 px (Zeilenmenüs
  untereinander); die Spec sichert ≥ 16 px zu. Die Einträge im geöffneten Dreipunkt-Menü
  stehen bündig untereinander (antd-`Dropdown`, im ganzen Bestand so); jeder ist 72 px hoch.
- **3 · A:** Die Kennzahl liest nur, es gibt keine Aktion.
- **3 · B/C:** Die Rückmeldung unter 100 ms ist belegt: Während eines PUT sind die Zeilenmenüs
  gesperrt, „Hinzufügen“ bzw. der Inspector-Knopf zeigen den Ladezustand [T1, T4]. Offen ist
  die Kommandoreaktion ≤ 2 s (O2).
- **4:** Keine der Flächen trägt eine kritische Aktion im Sinne des Kriteriums. „Entfernen“
  eines Pegels ist umkehrbar (wieder hinzufügen, derselbe Bildschirm) und löscht keine Daten.
  Nach LFH-378 bekommt eine umkehrbare Aktion keine Rückfrage. „Festlegen“ ist additiv.
- **5 · C:** Die Marke ist derselbe antd-`Tag` ohne Farbangabe wie die Leitpegel-Marke in B
  (gemessen 16,94 : 1 / 12,87 : 1), der Knopf ein Standard-`Button`. Die Messung am
  Inspector selbst fehlt (→ O3).
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
- **12 · A:** Auf Fükw (1366 px) und Tablet (1024 px) liegt CLS bei höchstens 0,048. Auf
  390 px liegen beide Seiten über 0,1 — gemessen auch mit **leerer** Pegel-Liste (O1).
- **12 · C:** Der Platz ist ab dem ersten Render belegt: Der Knopf steht gesperrt da, solange
  die Liste lädt, und wird dann zu Knopf oder Marke [T4]. Nichts wird nachträglich
  eingeschoben.
- **13 · A:** Das Band liegt im Fluss, ohne `sticky`/`fixed` (Leitlinie, Validierung
  Kriterium 13). LFH-606 fügt keinen fixierten Knoten hinzu [Q2].
- **15 · B:** Das Label steht sichtbar über dem Feld (`<label for>`, seit diesem Commit). Die
  Sammelliste hat Umordnen und Entfernen je Zeile. Voller Tastaturweg ist belegt: Tippen,
  Enter wählt, Tab, Enter legt an [T1]. „Speichern und nächsten anlegen“ und Vorbelegungen
  entfallen: ein einziges Auswahlfeld, gespeichert wird sofort.
- **14:** Keine der Flächen ist eine Tabelle.

## Belege

**Browsermessungen** (`frontend/e2e/pegel-pruefliste.spec.ts`, 9/9 bestanden):

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
- **[M5]** „…die nachladende Pegel-Angabe hält CLS ≤ 0,1“ (Pegel-Antwort um 1,5 s
  verzögert):

  | Seite | 1366 | 1024 | 390 |
  | --- | --- | --- | --- |
  | Überblick | 0,022 | 0,048 | 0,164 |
  | Lage-Dashboard | 0,025 | 0,027 | 0,171 |

  Gegenprobe mit leerer Pegel-Liste (Pegel ohne Verzögerung, einmaliger Lauf, nicht
  eingecheckt): Überblick 0,022 / 0,050 / 0,164, Lage-Dashboard 0,011 / 0,015 / 0,167. Auf
  1366 und 1024 px sichert die Spec ≤ 0,1 zu. Auf 390 px steht der Wert nur als Messwert.
- **[M6]** „nachladende Liste und Stationen halten CLS ≤ 0,1“ (Liste 0,8 s, Stationen 1,6 s
  verzögert): 0,001 / 0,004 / 0,002.
- **[M7]** „Tabulaturdurchlauf ohne verdecktes Fokusziel (390 × 420)“: 37 Stopps, alle vier
  markierten Sektionsziele erreicht (Reiter „Pegel“, beide Zeilenmenüs, Auswahl), 0 verdeckt,
  1 fixierter Knoten im Baum. Messkern `e2e/fokus-kern.ts`.

**Komponenten- und Unit-Tests** (Vitest):

- **[T1]** `pages/einstellungen/EinsatzPegel.test.tsx` (21 Tests): Zeilenmenüs während des
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
- **[T5]** `components/dichte.guard.test.ts` (kein punktuelles `size` auf interaktiven
  Elementen) und die Bauform-Gleichheit mit [M2].

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
- **O2 · Kommandoreaktion ≤ 2 s beim Festlegen einer neuen Station:** POST und PUT laden die
  Messung einer noch nicht gecachten Station, bevor sie antworten. Hängt PEGELONLINE, wartet
  die Antwort bis zu `ABRUF_FRIST` = 8 s (`src/pegel/abruf.rs`, Stand dieses Branches). Die
  Oberfläche zeigt den Ladezustand; die 2-s-Grenze ist aber nicht zugesichert. Ein
  bereits gecachter Eintrag kommt sofort (Backend-Test
  `abgelaufener_eintrag_kommt_sofort_und_nur_ein_hintergrundabruf`). Mögliche Richtung:
  kalte Stationen im Hintergrund abrufen und ohne Messung antworten. Das ist eine
  Backend-Entscheidung.
- **O3 · Keine Browsermessung am Fachebenen-Inspector:** Im e2e gibt es keinen Klickpfad zu
  einem Fachebenen-Punkt. Die Karte ist WebGL, und die Fachebenen-Schalter der Leiste
  (`pages/lagekarte/Sidebar.tsx`, `Switch` in der Fachebenen-Liste) haben **keinen
  zugänglichen Namen**; ein Test kann sie nicht per Rolle und Name greifen. Kriterien 1, 5
  und 13 sind am Inspector deshalb über Bauform-Gleichheit belegt, nicht gemessen. Nebenbefund:
  Der namenlose Schalter ist selbst ein Zugänglichkeitsmangel.
- **O4 · Abstand zwischen den Kennzahl-Zellen:** Das Fugenraster des Neuentwurfs setzt 1 px
  zwischen die Zellen des Bands, im Handschuh-Betrieb fordert Kriterium 2 ≥ 16 px. Das betrifft
  alle sechs Zellen und ist mit dem Band entstanden, nicht mit LFH-606.
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
