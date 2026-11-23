# Lagemonitor: Alarmzeile lässt ausgeblendete Module weg

Zunder: https://zunder.rubeen.dev/#/aufgabe/nwt8vtesp5k9mozact6fp1tc (LLH-1964, Befund aus dem
Review zu LLH-1929, Change `t31o93c2-ausfall-am-server`, design.md D5).

Stand: 22.11.2026. Der Weg wurde am Phase-1-Checkpoint am selben Tag abgestimmt (alle vier
Empfehlungen angenommen).

## Absicht

Monitor und Überblick zeigen in der Alarmzeile dasselbe. Heute prüft der Block `alarm` der
Lagemonitor-Antwort (`src/routes/lagemonitor.rs`, `fn alarm`) keine Modulfreigabe. Ist ein Modul
im Einsatz ausgeblendet, lassen Überblick und Lagebild seine Quelle weg (`lage/useWasBrennt.ts`:
`zustandNachFreigabe`, `leerWennGesperrt`), der Monitor zeigt sie trotzdem. Beispiel: Modul
Material ausgeblendet, ein Posten am Logistiktrupp defekt; im Überblick fehlt „Ausfall:
Logistiktrupp“, auf dem Monitor steht es.

Ein ausgeblendetes Modul ist eine Entscheidung der Einsatzleitung, dass es in diesem Einsatz keine
Rolle spielt. Der Monitor im Stabsraum soll diese Entscheidung nicht unterlaufen.

## Ziele

1. Der Block `alarm` lässt jede Quelle aus, deren Modul im Einsatz **ausgeblendet** ist. Maßgeblich
   ist allein die wirksame Sichtbarkeit (`effektiv_sichtbar`: Einsatz-Override, sonst
   Org-Vorgabe, sonst sichtbar), wie `ModulFreigabe::sichtbar`. Eine Rollenschranke
   (`benoetigte_rolle`) zählt nicht: der Monitor zeigt, was der Überblick einer Führungskraft der
   Einsatz-Org zeigt.
2. Zuordnung Quelle → Modul wie im Browser (`useWasBrennt`):

   | Quelle (`WasBrenntQuellen`) | Modul(e) | ausgeblendet, wenn |
   |---|---|---|
   | `meldungen` (Sofort, Bestätigung, dringend) | `meldungen` | Modul aus |
   | `auftraege` | `auftraege` | Modul aus |
   | `erinnerungen` | `erinnerungen` | Modul aus |
   | `nachforderungen` | `nachforderungen` | Modul aus |
   | `vermisst` | `personen` | Modul aus |
   | `kritisch` | `einsatzabschnitte` | Modul aus |
   | `rueckmeldung` | `meldungen`, `einheiten` | eines davon aus |
   | `ausfall` | `einheiten` | `einheiten` aus |

   Für den Ausfall gilt wie im Browser: Sind `personal`, `fahrzeuge` oder `material` ausgeblendet,
   zählen ihre Zeilen als leer, der Ausfall der übrigen Mittel bleibt.
3. Neues Feld `alarm.ausgeblendet: AlarmQuelle[]` (Enum, Werte wie die Schlüssel von
   `WasBrenntQuellen`, snake_case: `meldungen`, `auftraege`, `erinnerungen`, `nachforderungen`,
   `vermisst`, `kritisch`, `rueckmeldung`, `ausfall`), in fester Folge, leer im Normalfall.
4. Die Werte einer ausgeblendeten Quelle liest der Server **nicht**; er liefert sie als `0` bzw.
   leere Liste. `sofort_aelteste_at` fehlt dann.
5. `lage/alarmAusMonitor.ts` meldet jede Quelle aus `ausgeblendet` als `{ zustand: 'gesperrt' }`.
   `wasBrennt` lässt sie weg, ohne „Stand unvollständig“ (Akzeptanzkriterium 2).
6. Die Regel steht in `frontend/src/geraet/AGENTS.md` beim Absatz über die Alarmzeile; Kommentare an
   `fn alarm` und `alarmAusMonitor` verweisen dorthin.

## Nicht-Ziele

- **Kacheln des Monitors** (Sofortmeldungen, Betroffene mit Vermissten, Kräfte) bleiben unverändert;
  dafür entsteht eine eigene Aufgabe (Entscheidung am Checkpoint). Die Kachel „Sofortmeldungen“
  übernimmt die Zahl des Alarm-Blocks heute (`anzeige.sofortmeldungen_offen = alarm.sofort_offen`);
  ist `meldungen` ausgeblendet, behält sie ihre eigene Zählung aus `verdichte`, damit die Kachel
  nicht stillschweigend auf 0 springt.
- Keine Änderung an `verdichte`, am Lagebild für Externe und an der API v1 (tragen keinen Block
  `alarm`).
- Keine Änderung an der Ausfall-Regel und am Fixture `regeln.json` (ADR-0063): ausgeblendete Listen
  gehen nur leer hinein.
- Keine Änderung im Browser-Pfad (`useWasBrennt`).

## Ansätze

1. **Liste `ausgeblendet`, Werte 0 bzw. leer (gewählt).** Additiv: ein älterer, noch offener
   Monitor-Tab kennt das Feld nicht, liest 0 und leere Listen und zeigt die Quelle einfach nicht.
   Nur „Vermisst“ zeigt er bis zum Neuladen weiter, weil er sie aus `betroffene` liest.
2. **Nullbare Felder (`null` = ausgeblendet).** Direkter, aber ein alter Monitor-Tab ruft `.map`
   auf `null` und stürzt ab, bis er neu lädt; für „Vermisst“ bräuchte es trotzdem ein eigenes Feld.
3. **Monitor bewusst vollständig lassen, nur die Regel festhalten.** Verworfen: Monitor und Überblick
   widersprächen sich dauerhaft, gegen ADR-0057 („eine Alarmzeile aus einem Kern“).

## Umsetzung in Kürze

- `src/einsatz/berechtigung.rs`: `ausgeblendete_module(pool, einsatz_id, org_id)` liefert die
  Modul-Keys mit wirksamer Sichtbarkeit `false` (über `lade_modul_regeln` und dieselbe Auswertung
  wie `modul_freigabe`; nicht ausblendbare Module nie).
- `src/einsatz/ausfall.rs`: `load_einheiten_mit_ausfall` bekommt, welche der drei Mittel-Listen
  gelesen werden; eine nicht gelesene geht leer in `einheiten_mit_ausfall`.
- `src/routes/lagemonitor.rs`: `AlarmQuelle` (Serialize, ToSchema), Feld `ausgeblendet` an
  `LagemonitorAlarm`; `fn alarm` prüft je Quelle, liest nur sichtbare. Typ-Codegen neu
  (`scripts/check-typ-codegen.sh`).
- `frontend/src/lage/alarmAusMonitor.ts`: Quellen aus `ausgeblendet` als `gesperrt`; fehlt das Feld
  (älterer Server), wie bisher.

## Tests

- Rust (Handler-Ebene, `tests/geraet_kopplung.rs` oder ein Modultest an `fn alarm`): Material
  ausgeblendet, defekter Posten am Logistiktrupp → `ausfall` leer, `ausgeblendet` ohne `ausfall`;
  Einheiten ausgeblendet → `ausgeblendet` enthält `ausfall` und `rueckmeldung`; Aufträge
  ausgeblendet mit überfälligem Auftrag → `auftraege_ueberfaellig == 0`, `ausgeblendet` enthält
  `auftraege`; Org-Vorgabe ausgeblendet, Einsatz-Override sichtbar → nicht ausgeblendet.
- Vitest `alarmAusMonitor.test.ts`: ausgeblendete Quelle → `gesperrt`; `wasBrennt` meldet dazu kein
  „Stand unvollständig“; ohne Feld unverändert.

## Dem Bauenden überlassen

- Ob der Rust-Test als Integrationstest über die Route oder als Test an `fn alarm` läuft.
- Name und genaue Signatur der Hilfsfunktionen, solange die Sichtbarkeit nur an einer Stelle
  ausgewertet wird.

## Randfall (bewusst so)

Ein System-Admin behält im Überblick Zugriff auf ausgeblendete Module (`zugriff` bleibt wahr), der
Modulzähler liefert ihm deren Zahlen. Der Browser blendet über `istModulFreigegeben` nur die
Listen-Quellen aus, nicht die Zähler-Quellen. Der Monitor richtet sich nach der Führungskraft, nicht
nach diesem Admin-Sonderweg.
