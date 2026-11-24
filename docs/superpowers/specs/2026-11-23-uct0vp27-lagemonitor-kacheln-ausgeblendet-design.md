# Lagemonitor: Kacheln lassen ausgeblendete Module weg

Zunder: https://zunder.rubeen.dev/#/aufgabe/uct0vp27hghnxr9b2pixf9s1 (LLH-2072, Folge aus LLH-1964,
Design-Doc `2026-11-22-nwt8vtes-lagemonitor-alarm-ausgeblendet-design.md`, Nicht-Ziele).

Stand: 23.11.2026. Der Weg wurde am Phase-1-Checkpoint am selben Tag abgestimmt (alle vier
Empfehlungen angenommen). Größe: kleine Änderung, kurzes Design-Doc.

## Absicht

Seit LLH-1964 lässt die Alarmzeile „Was brennt“ des Lagemonitors Quellen aus Modulen weg, die im
Einsatz ausgeblendet sind. Die Kacheln derselben Seite zählen sie weiter: Ist „Meldungen“
ausgeblendet, zeigt die Kachel „Meldungen“ offene Sofortmeldungen, die die Alarmzeile verschweigt;
ist „Personen“ ausgeblendet, nennt „Betroffene“ Vermisste, die in „Was brennt“ fehlen. Ein
ausgeblendetes Modul ist die Entscheidung der Einsatzleitung, dass es in diesem Einsatz keine Rolle
spielt. Der Monitor soll sie auf der ganzen Seite gleich umsetzen.

## Ziele

1. Eine Kachel **fehlt**, wenn ihr Modul im Einsatz ausgeblendet ist (wirksame Sichtbarkeit wie
   `load_ausgeblendete_module`, keine Rollenschranke; wie LLH-1964). Kein „—“, keine 0, kein
   Hinweis: wie die Alarmzeile und wie „Ablauf“ ohne anstehenden Punkt.

   | Kachel | Modul(e) | fehlt, wenn |
   |---|---|---|
   | Betroffene bzw. Hilfeleistungen | `personen` | Modul aus |
   | Meldungen (Sofortmeldungen offen) | `meldungen` | Modul aus |
   | Kräfte | `personal`, `einheiten` | eines davon aus (wie `kraefteZustand` im Lagebild) |
   | Belegung der Unfallhilfsstellen | `unfallhilfsstellen` | Modul aus |
   | Zusatz „n an UHS“ der Kachel Kräfte | `unfallhilfsstellen` | Modul aus (nur der Zusatz) |
   | Ablauf | — (Programmpunkte gehören zu den Einsatzdaten, nicht ausblendbar) | nie |

2. Der Server **liest** die Werte einer ausgeblendeten Kachel nicht und liefert sie als 0 bzw.
   leer (`betroffene` Standardwerte, `sanitaetsdienst` fehlt, `kraefte` 0, `uhs` leer,
   `sofortmeldungen_offen` 0). Neues Feld `ausgeblendet: LagemonitorKachel[]` an
   `LagemonitorAnzeige` (Enum `betroffene`, `meldungen`, `kraefte`, `uhs`, snake_case), in fester
   Folge, im Normalfall leer und dann nicht serialisiert.
3. Nur der Handler `lagebild` (gekoppelter Lagemonitor) wendet das an. Lagebild für Externe und
   API v1 bleiben unverändert: sie haben keine Alarmzeile, also keinen Widerspruch, und ihr
   Vertrag ändert sich nicht still.
4. Layout: Fehlt „Meldungen“, nimmt „Ablauf“ die untere Zeile allein; fehlen beide, entfällt die
   Zeile, und die Karte wird höher. Fehlen alle Kacheln der rechten Spalte, nimmt die linke Spalte
   die volle Breite. Die Kachel „Belegung“ wächst wie heute (`flex: 1 1 0`) in frei gewordenen
   Platz.
5. Die Regel steht in `frontend/src/geraet/AGENTS.md` beim Absatz über den Lagemonitor (neben der
   Alarmzeilen-Regel aus LLH-1964); die Anwenderdoku `docs/anwender/kapitel/lagemonitor.md`
   streicht „die Kacheln … zählen dagegen weiter“ und nennt das neue Verhalten.

## Nicht-Ziele

- **Lagebild für Externe und API v1** (Entscheidung am Checkpoint): unverändert.
- **Karte:** Gefahrenzonen und Abschnittsflächen bleiben (Entscheidung am Checkpoint). Die
  UHS-Marken fallen mit weg, wenn `unfallhilfsstellen` ausgeblendet ist, weil `uhs` dann leer
  kommt; das ist gewollt und braucht keinen eigenen Code.
- Keine Änderung an der Alarmzeile, an `alarm.ausgeblendet` und an der Zuordnung `AlarmQuelle`.
- Kein „—“ mit Grund wie im Lage-Dashboard: der Monitor ist keine Arbeitsfläche, ein Platzhalter
  wäre Fläche ohne Information.

## Ansätze

1. **Kachel fehlt, Server liest nicht (gewählt).** Deckt sich mit der Alarmzeile (LLH-1964) und
   „Ablauf“; Werte ausgeblendeter Module verlassen den Server nicht. Additiv: ein älterer, offener
   Monitor-Tab kennt `ausgeblendet` nicht und zeigt die Kachel bis zum Neuladen mit 0 bzw. leer.
2. **Kachel bleibt mit „—“ und „Im Einsatz ausgeblendet“.** Feste Kachelung wie im
   Lage-Dashboard, aber Großbild-Fläche ohne Information. Verworfen am Checkpoint.
3. **Weiter zählen, nur die Regel festhalten.** Kachel und Alarmzeile widersprächen sich
   dauerhaft; verfehlt das Akzeptanzkriterium.

Kräfte, Varianten: (a) wie `kraefteZustand` — Kachel fehlt, sobald Personal oder Einheiten aus ist
(gewählt, eine Regel mit dem Lagebild); (b) je Zahl, Kachel fehlt erst, wenn beide aus sind
(verworfen: zweite Regel neben dem Lagebild).

## Umsetzung in Kürze

- `src/routes/lagemonitor.rs`: `LagemonitorKachel` (Serialize, ToSchema) mit Zuordnung zu Modulen
  an einer Stelle (wie `AlarmQuelle::is_ausgeblendet`); `verdichte` bekommt die Menge der
  ausgeblendeten Module (Externe und API v1 übergeben die leere Menge) und überspringt die Abfragen
  einer ausgeblendeten Kachel; `lagebild` lädt die Menge einmal über
  `load_ausgeblendete_module` und reicht sie an `verdichte` und `alarm`. Die Sonderregel in
  `lagebild` („ist Meldungen ausgeblendet, behält die Kachel die Zählung von `verdichte`“) entfällt.
  Typ-Codegen neu (`scripts/check-typ-codegen.sh`).
- `frontend/src/geraet/LagemonitorPage.tsx`: Kacheln nach `lage.ausgeblendet` weglassen, Layout
  nach Ziel 4; fehlt das Feld (älterer Server), wie bisher.

## Tests

- Rust (Handler über die Route, wie die Tests zu LLH-1964): `personen` ausgeblendet mit vermisster
  Person → `betroffene.vermisst == 0`, `ausgeblendet` enthält `betroffene`; `meldungen`
  ausgeblendet mit offener Sofortmeldung → `sofortmeldungen_offen == 0`, enthält `meldungen`;
  nur `einheiten` ausgeblendet → enthält `kraefte`; `unfallhilfsstellen` ausgeblendet → `uhs`
  leer, enthält `uhs`; nichts ausgeblendet → Feld fehlt. Lagebild für Externe mit ausgeblendetem
  Modul zählt weiter.
- Vitest `LagemonitorPage.test.tsx`: je Kachel fehlt sie bei ausgeblendetem Modul; Zusatz „an UHS“
  fehlt bei `uhs`; „Ablauf“ nimmt die Zeile allein; ohne Feld unverändert.

## Dem Bauenden überlassen

- Genaue Signatur von `verdichte` (Parameter oder zweite Funktion), solange Externe und API v1
  dieselben Zahlen behalten wie heute.
- Ob Rust-Tests in `tests/geraet_kopplung.rs` oder einer eigenen Datei stehen.
