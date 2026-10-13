# Design

## Context

Warum die Seite neu entsteht, steht in proposal.md. Den Bestand hat ein Scope-Lauf am 13.10.2026
erhoben. Der Branch baut auf LLH-1180 auf (PR #726, Modul Fernmeldewesen); LLH-1111
(Lagebesprechung) ist schon in `alpha`.

**Seite heute** (`pages/StabPage.tsx`):
- Oben steht `LagebesprechungZeile` (LLH-1111).
- Darunter das Paneel „Besetzung S1–S6“ als `Liste`. Die Einträge sind `h3` mit Statuschip,
  Aufgabentext, Fundstelle und Werkzeug-Links.
- Ganz unten `ChecklistePaneel`.
- Die Werkzeuge kommen aus `stab/sachgebiete.ts` (Registry-Schlüssel, höchstens drei).
  `stab/werkzeuge.ts:werkzeugeFuer` filtert sie über `istModulFreigegeben`, ein gesperrtes Modul
  verschwindet also still.
- Die Unterseiten kommen aus `stab/unterseiten.ts`: S5 Presse und Infotelefon als Unterrouten
  des Stabs, S6 Funkplan und Kommunikationsplan im Fernmeldewesen. Sie stehen gesperrt mit
  `GesperrterSprung`. Die Fernmeldeskizze fehlt, obwohl die Spec `fernmeldewesen` sie verlangt.

**Zahlenquellen:**
- `GET …/modul-zaehler` (`src/einsatz/zaehler.rs`) liefert je erlaubtem Modul ein Feld. Ein
  fehlendes Feld heißt „nicht erlaubt“, nie 0.
- Das Frontend bildet die Felder in `einsatz/useModulZaehler.ts` (`ABBILDUNG`, `bildeZaehler`)
  auf `wert` und `beschreibung` ab; das Modulmenü zeigt sie als Badge.
- Werkzeuge der Kacheln mit Zähler: Einheiten (gesamt), ETB (gesamt), Einsatzabschnitte (gesamt),
  Aufträge (offen, `ueberfaellig`), Meldungen (offen, `ungesehen`).
- Ohne Zähler: Personal, Bereitstellungsräume, Nachforderungen, Lagekarte, Lagemeldungen,
  Verpflegung, Material.
- Presse: `GET …/stab/medienkontakte/kennzahlen` mit `offene_anfragen`, gezählt über den ganzen
  Bestand (LFH-1075), Key `einsatzKeys.medienkontaktKennzahlen`, live über `presse`.
- Funkplan-Lücken: `stab/funkplan.ts:funkplanLuecken` (fünf Lücken),
  `baueFernmeldenetz(…).luecken` (`schienenMitEinemTeilnehmer`, `leitstelle`). Quellen über
  `stab/useNetzQuellen.ts`, acht Abfragen mit eigener Weiche je Quelle, fail-closed auf
  `fernmeldewesen`. Eine Summe gibt es nicht; das Paneel „Lücken“ der Funkplan-Seite zeigt nur
  Zeilen.

**Bausteine:** `instrument/Paneel` (Kopf mit `titel`, `meta`, `aktion`; kein Einklappen),
`instrument/Kennzahl` (`kennzahlZielStil`, Fugenraster, Zustände `daten|laden|fehler`),
`StatusTag`/`StatusChip`, `Sprung.tsx` (`GesperrterSprung`), `stab/zeilenziel.ts`. Weder eine
Kachel- noch eine Rasterkomponente noch ein einklappbares Paneel gibt es; LFH-1162 (g)
(Dashboard-Bausteine vereinheitlichen) hat weder Code noch Change.

**Regeln, die hier greifen** (`frontend/AGENTS.md`):
- „Eine Heimat je Zahl“: Aufträge und Meldungen nur aus dem Modulzähler.
- „Kachel nur für Überblick“ und FMS-Tableau als Vorbild: die Kachel selbst nicht klickbar.
- „Texte zeigen statt erklären“: Sperrgrund sichtbar.
- M16 und „Keine Arbeitsplatzachse“.
- Dichtestufen 30/48/72, „Handgebautes Bedienziel“.
- Gate 7: Prüfliste Einsatztauglichkeit.
- Größere UI über Claude Design: Ohne Zugriff in der Cloud-Sitzung wird direkt nach der
  Gestaltungssprache gebaut. Der PR vermerkt, dass das Design System nachgezogen werden muss.

## Goals / Non-Goals

**Goals:**
- Eine Seite, die auf einen Blick Besetzung und offenen Stand je Sachgebiet zeigt und von dort in
  die Arbeit springt.
- Jede Zahl genau einmal gerechnet: Werkzeug und Modulmenü bzw. Funkplan zeigen dieselbe Zahl aus
  derselben Funktion.
- Eine Sperrlogik für alle Werkzeuge, Modul oder Unterseite.

**Non-Goals:**
- Neue Zählungen, auch nicht für Nachforderungen oder Lagemeldungen. Nachforderungen kommen mit
  LLH-1078, Kräfte und Material zu trennen braucht ein eigenes Ticket.
- Filter des Nachforderungs-Boards je Art (LFH-1218/LLH-1078). Beide Kacheln springen auf dasselbe
  Modul.
- Neugestaltung von `BesetzungModal`, Lagebesprechungs-Zeile oder Checklisten-Zeilen.
- Ein allgemeiner Kachel- oder Einklapp-Baustein unter `components/instrument/`. Die Bausteine
  bleiben unter `stab/`, bis ein zweiter Abnehmer sie braucht (Querschnitt LFH-1162 (g)).
- S5-Bezeichnung je Organisation (LFH-863): kommt über das wirksame Label von selbst.

## Decisions

### D1 Kachel = Paneel mit `h2`, keine große Kennung

- Jede Kachel ist ein `Paneel` mit Überschrift `h2` und Titel „S4 · Versorgung“ (wirksames Label,
  `mitWirksamemLabel`).
- `meta`: der Besetzungschip (`StatusTag` mit `besetzungDarstellung`), erst mit Daten.
- `aktion`: „Besetzung ändern“ (antd-`Button`, zugänglicher Name mit Kennung und Label, nur mit
  Schreibrecht).
- Körper: die Aufgabenzeile, darunter das Werkzeugraster.
- Die Paneele stehen in einem CSS-Raster `stab/stabRaster.ts:stabRasterStil(spalten)`: 1 Spalte
  unter `md`, 2 ab `md`, 3 ab `xl` (aus `useViewport`, kein `auto-fit`, damit S1–S3 bei `xl` sicher
  eine Reihe bilden).
- Ein äußeres Paneel „Besetzung S1–S6“ entfällt. Es wäre ein Paneel um sechs Paneele, und die
  Überschriftenebene `h3` unter einem Rahmen ohne eigenen Inhalt trägt nichts (Spec
  `ueberschriften-gliederung`, angepasst).
- Den Besetzungsstand „4/6 besetzt“ trägt `EinsatzSeite meta`, gezählt wie heute
  (`zeileFuer` vorhanden), erst mit Daten.

*Verworfen:*
- **Große Kennung „S1“ im Körper** (Entwurfsprompt des Tickets). Groß gesetzte Mono-Zeichen sind
  in der Gestaltungssprache den Zahlen vorbehalten („Zahl führt“). Ein großes „S3“ neben „2 offen“
  konkurrierte mit der Zahl, und die Kennung stünde doppelt da (Augenbraue und Körper). Die
  Augenbraue trägt sie schon; das Raster in fester Reihenfolge macht sie auffindbar.
- **Kachel als Ganzes klickbar** (in welches Modul?). Widerspricht „je Kachel nur ihre Ziele“
  (FMS-Tableau).

### D2 Werkzeuge: eine Tabelle, eine Sperrlogik

- `SachgebietEintrag.werkzeuge` wird eine Liste von **Werkzeug-Einträgen**:
  `{ art: 'modul', key }` oder `{ art: 'seite', unterseite }`. Damit stehen Modul-Werkzeuge und
  Unterseiten in einer Reihenfolge je Sachgebiet. `stab/unterseiten.ts` bleibt die Tabelle der
  Unterseiten (Palette und Sprungmarken lesen sie, LLH-1127) und bekommt Fernmeldeskizze und
  Sprechgruppen (`funkplanPfad(id, { ansicht: 'skizze' | 'sprechgruppen' })`).
- Zuordnung:

  | Sachgebiet | Werkzeuge |
  | --- | --- |
  | S1 | personal, einheiten, bereitstellungsraeume, nachforderungen |
  | S2 | lagekarte, lagemeldungen, etb |
  | S3 | einsatzabschnitte, auftraege, meldungen |
  | S4 | nachforderungen, verpflegung, material |
  | S5 | Pressearbeit, Informationstelefon |
  | S6 | Funkplan, Fernmeldeskizze, Sprechgruppen, Kommunikationsplan |

- `werkzeugeFuer` wird zu `werkzeugZustand(eintrag, freigaben)` mit drei Ergebnissen:
  - `fehlt`: das Ziel ist ausgeblendet oder unbekannt, oder die Freigaben sind noch nicht da.
  - `gesperrt` (`istSprungGesperrt`).
  - `frei`.

  Dieselbe Regel gilt für beide Arten. Der Modul-Key einer Unterseite ist ihr `modul` (`stab` oder
  `fernmeldewesen`).
- Gesperrt: die Zelle zeigt Name und „Keine Berechtigung“ sichtbar (`sprungGesperrtText`), ist
  `disabled` und trägt keine Zahl.

*Verworfen:*
- **Gesperrte Module weiter still filtern.** Der Kommentar in `werkzeuge.ts` begründete das mit
  „Wege in gesperrte Module“. Ein gesperrter Weg mit Grund ist aber kein Weg, und das
  Einstieg-statt-Achse-Muster (LFH-456/LFH-888) zeigt Sperren sichtbar. Die S6-Einstiege tun das
  schon (Spec `fernmeldewesen`). Zwei Logiken auf einer Kachel wären der eigentliche Fehler.
- **Unterseiten als eigene Zeile über den Modul-Werkzeugen** (heute). Die Reihenfolge je
  Sachgebiet ließe sich dann nicht festlegen.

### D3 Werkzeugzelle: Name führt, Zahl rechts

- Neuer Baustein `stab/WerkzeugZelle.tsx`. Die Zelle ist ein Link (`react-router` `Link`) mit
  - Werkzeugname (Text 14/500, Bedienfarbe),
  - rechts die Zahl in Mono 500 (Stufe 22 aus `schriftskala`),
  - darunter die Notiz in 11 `gedaempft` (Bedeutung bzw. Grund, eine Zeile, gekürzt mit voller
    Fassung im zugänglichen Namen).
- Die Zellen stehen im Fugenraster des Kennzahlenbands (`fugenrasterGrund`, `kennzahlZielStil`
  für Zelle, Ziel und Eskalationskante). In der Kachel sind es zwei Spalten ab 280 px Körperbreite
  (`repeat(auto-fit, minmax(min(140px,100%),1fr))`), sonst eine. Alle Zellen einer Kachel sind
  gleich hoch (Rasterzeile), auch ohne Zahl.
- Höhe: mindestens `token.controlHeight` plus Einzug (`zielEinzug`), reine Stilfunktion
  `werkzeugZelleStil` mit Test je Dichtestufe („Handgebautes Bedienziel“).
- Ton:
  - `achtung` (Zahl in `achtungText`, 3-px-Innenkante) nur, wenn die Quelle es sagt; heute nur
    überfällige Aufträge, Notiz „1 überfällig“.
  - Sonst neutral. Rot gibt es nicht, ein überfälliger Auftrag ist Achtung, nicht Gefahr
    (Kennzahl-Regel im Überblick).
- Gesperrt (D2): antd-`Button disabled` mit derselben Zellform. Ein `<a>` ohne `href` wäre für
  Vorleser kein gesperrtes Ziel.

*Verworfen:*
- **`Kennzahl` mit `ziel` direkt.** Die Zelle führt mit der Zahl in 32 px; für Werkzeuge ohne Zahl
  bliebe eine leere Zahlzeile. Bei einem Werkzeug ist der Name die Hauptsache, die Zahl der Zustand
  daneben.
- **Antd-`Button` je Werkzeug** (`SprungKnopf`). Ein Knopf trägt keine zweite Zeile (Notiz) und
  kein Fugenraster; zwölf Knöpfe mit „↗“ wären Lärm.

### D4 Zahl je Werkzeug: `stab/werkzeugZahlen.ts`

- Reine Funktion `werkzeugZahl(eintrag, quellen) → { zustand, wert?, notiz?, ton? } | null`
  (`null` = keine Quelle, keine Zahl).
- Quellen, alle schon vorhanden:
  - **Modul:** `useModulZaehler` liefert die Karte aus `bildeZaehler`. `wert` und `beschreibung`
    kommen unverändert aus `ABBILDUNG` (eine Heimat für Wortlaut und Zahl). Für Aufträge liest die
    Funktion zusätzlich `auftraege.ueberfaellig` aus der Rohantwort über `fuehrungsZahlen.ts:
    auftragsStand`, wie der Überblick.
  - **Pressearbeit:** `offene_anfragen` aus `ladeMedienkontaktKennzahlen`, Notiz „offene
    Anfragen“.
  - **Funkplan:** `funkplanLueckenAnzahl` (D5).
- Zustand:
  - Modulzähler lädt → `laden`. Gescheitert ohne Stand → `fehler` mit Notiz „nicht geladen“.
  - Feld fehlt in der Antwort, obwohl das Modul frei ist (Gerät, Rolle) → `daten` mit „—“ und Notiz
    „nicht freigegeben“ (`NICHT_FREIGEGEBEN`, wie `kennzahlZustand` im Überblick).
  - Wortlaut der Gründe aus `stab/funkplan.ts:ZUSTAND_GRUND`.
- Live: Modulzähler und Presse-Kennzahlen hängen schon an ihren Live-Abbildungen
  (`queryKeys.ts`). Die Netzquellen folgen ihren Modulen; Sprechgruppen kommen nicht live (Bestand,
  gilt auf der Funkplan-Seite genauso).

*Verworfen:*
- **Eigene Zählung aus Listen** (etwa offene Nachforderungen aus der Nachforderungsliste).
  Verstößt gegen „Eine Heimat je Zahl“ und die Entscheidung von Ruben.
- **`meldungen.ungesehen` als „neue Lagemeldungen“.** Anderes Modul, andere Bedeutung.

### D5 Eine Lückenzahl, zwei Abnehmer

- Neue reine Funktion in `stab/luecken.ts`:
  `lueckenAnzahl(luecken: FunkplanLuecken, netzLuecken: { schienenMitEinemTeilnehmer, leitstelle })
  → { zustand, anzahl? }`.
  - Sie summiert `treffer.length` der sechs Listen-Lücken und zählt die Leitstelle mit 1, wenn sie
    `daten` ist und ein Element trägt.
  - Zustand ist `schlechtesterZustand` aller sieben. Ist einer nicht `daten`, gibt es keine Anzahl.
  - Die Gegenstelle zählt nicht (Spec `stab-funkplan`, „Zahl der Lücken“).
- Funkplan-Seite: `Paneel titel="Lücken" meta={…}` zeigt „3 Lücken“ (`anzahl(n, 'Lücke', 'Lücken')`)
  bzw. kein Meta, solange eine Quelle fehlt. Die Zeilen darunter nennen den Grund schon.
- Stab-Seite: Hook `stab/useFunkplanLuecken.ts`. Er ruft `useNetzQuellen(einsatzId, freigabe,
  ohneVerbindung)` und `baueFernmeldenetz` wie `SkizzenAufnahme` und gibt die Anzahl zurück. Mit
  `enabled` nur, wenn das Fernmeldewesen sichtbar und frei ist; sonst fragt er nichts ab, und das
  Werkzeug steht laut D2 gesperrt bzw. fehlt.
- Die Funkplan-Seite rechnet ihr Netz weiter selbst (sie braucht es für Bild und Paneel), ruft aber
  dieselbe `lueckenAnzahl`. Dass beide gleich zählen, prüft ein Test mit denselben Quellen.

*Verworfen:*
- **Server-Endpunkt für die Lückenzahl.** Die Lücken werden heute nur im Browser abgeleitet
  (`stab/AGENTS.md`: „Lücken nur über `stab/luecken.ts`“). Ein zweiter Rechner im Backend bräche die
  eine Heimat.
- **Anzahl betroffener Lückenarten statt Summe der Treffer** („3 von 7 Arten“). Sagt nicht, wie viel
  zu tun ist, und deckt sich mit keiner Zahl des Paneels.

### D6 Arbeitsaufnahme klappt ein, bleibt unten

- `ChecklistePaneel` bekommt den Zustand `eingeklappt`. Startwert: beim ersten Eintreffen der Daten
  `erledigtAnzahl === CHECKLISTE.length`, einmal gesetzt (`useRef`-Merker).
- Danach ändert ihn nur der Knopf in `Paneel aktion`: „Aufklappen“ bzw. „Einklappen“,
  `aria-expanded`, `aria-controls` auf den Körper, Steuerhöhe der Stufe.
- Live-Rücknahme bei eingeklapptem Paneel (`erledigt < 7`) klappt auf (Spec `stab-checkliste`).
- Eingeklappt rendert der Körper nicht. Die Zahl „7/7 erledigt“ bleibt im `meta`.
- Ort: unter dem Raster, volle Breite.

*Verworfen:*
- **Rechte Spalte ab `xl`** (Ticket: „rechts bzw. unten“). Bei 1440 px (Fükw) blieben neben einer
  Spalte von 360 px nur zwei Kachelspalten, und die drei Spalten ab `xl` gingen verloren. Unten und
  eingeklappt nimmt das Paneel nach den ersten zehn Minuten eine Zeile ein, wie LFH-551 es wollte.
- **Automatisch einklappen beim letzten Haken.** Das Paneel spränge unter der Hand weg (Kriterium
  12 der Prüfliste).
- **antd-`Collapse`.** Bringt einen eigenen Kopf mit, das Paneel hat schon einen (`Augenbraue`,
  Meta). Ein Knopf im Kopf ist das kleinere Teil.

### D7 Aufgabenzeile gekürzt, Fundstelle sichtbar

- Eine Zeile mit `text-overflow: ellipsis` für den Aufgabentext. Der volle Text bleibt im DOM (also
  vorlesbar) und im `title`.
- Die Fundstelle steht als eigenes Element dahinter (`flex: none`) und wird nie gekürzt.
- Den vollen Aufgabentext trägt `docs/anwender/kapitel/stab.md`, Abschnitt „Die Kacheln“.
- `aufgaben` bleibt in `sachgebiete.ts`, wortgleich wie heute.

### D8 Tests und Gates ziehen um

- `StabPage.test.tsx`:
  - Regionen jetzt sechs Paneele `S1 · …` bis `S6 · …` und „Arbeitsaufnahme“.
  - Werkzeuggruppen behalten den Namen `Werkzeuge S1` … (`role="group"`), damit e2e und
    `stab-kontrast` ihren Anker behalten.
  - Neue Fälle: gesperrtes Modul-Werkzeug steht gesperrt; Zahl „—“ bei fehlendem Feld; Achtung bei
    überfälligen Aufträgen; keine Zahl bei Nachforderungen; Meta „4/6 besetzt“.
- `e2e/gate3-trefflaeche.spec.ts` (Stab): Die Konstanten zählen neu:
  - Werkzeuge: S1 4, S2 3, S3 3, S4 3, S5 2, S6 4, zusammen 19.
  - Gruppen 6, Knöpfe 6.
  - Messanker sind Gruppen statt der Region „Besetzung S1–S6“.
- `e2e/stab-schmal.spec.ts` wird neu geschrieben: Kacheln untereinander, keine Spalte unter 90 %,
  kein Überlauf.
- Die Regel „Besetzung ändern unter dem Inhalt“ (LFH-978) entfällt: die Aktion steht im
  Paneelkopf, der auf 390 px umbricht (`paneelKopfRechtsStil`).
- `stab-kontrast`, `stab-checkliste` und `gate1-ueberlauf` behalten ihre Anker. Geprüft wird, ob
  sie nachgezogen werden müssen.
- Bildlauf `e2e/doku-bilder/stab.bilder.ts`:
  - Neues Bild `uebersicht.png` (ganze Seite).
  - `besetzung.png` (Dialog) und `arbeitsaufnahme.png` (offen) bleiben.

## Risks / Trade-offs

- [Acht zusätzliche Abfragen für die Lückenzahl beim Öffnen der Stab-Seite] → Nur bei freiem
  Fernmeldewesen. Die Abfragen teilen Keys mit Funkplan, Einheiten- und Abschnittsseiten
  (Cache-Treffer bei üblicher Navigation). Ruben hat die Kosten am 13.10.2026 angenommen.
- [Gesperrte Module erscheinen jetzt als gesperrte Werkzeuge, wo sie vorher fehlten] → Gewollt
  (D2). Ein Beobachter mit vielen Sperren sieht mehr Grau. Ausgeblendete Module fehlen weiter.
- [Bestandszähler (Einheiten, ETB, Abschnitte gesamt) sind kein „offener Stand“] → Gleiche Zahl wie
  im Modulmenü, das ist die Entscheidung „eine Heimat“. Was offen heißt, regelt die Spec
  `modul-zaehler`, nicht diese Seite.
- [Die Kachel S2 hat außer dem ETB-Bestand keine Zustandszahl] → Hinzunehmen, bis Lagemeldungen
  einen Status haben (kein Ticket bisher; als Nachzug anlegen).
- [PR #726 ändert sich vor dem Merge noch] → Branch mergt nach dessen Merge `alpha` nach; der PR
  dieser Change wartet ohnehin auf die Umsetzung.
- [Neuer Baustein ohne Design-System-Eintrag] → Der PR vermerkt das Nachziehen im Design System
  „Lifeline Hub“ (`frontend/AGENTS.md`).

## Migration Plan

Reines Frontend ohne gespeicherte Schlüssel: kein Datenumbau, Rücknahme per Revert. Nach dem Merge
von PR #726 wird `alpha` in den Branch gemergt und `check-all.sh` erneut gefahren.

## Open Questions

- Nachzug: Zunder-Aufgabe „Lagemeldungen mit Status neu/gesehen und Zähler“, falls Ruben die
  Kachel S2 mit Zahl will. Wird am Freigabe-Checkpoint gefragt, ändert diese Change nicht.
