# Design

## Context

- **Überblick** (`pages/fuehrung/UeberblickPage.tsx`):
  - Er rechnet im Browser aus vielen Listen und dem Modulzähler.
  - Die Regeln für Rückmeldung je Einheit (`meldungen/rueckmeldung.ts`, `abschnittGruende`), Ausfall
    (`toenungsGruende` über `ausfallJeEinheit`), Meldungsstufe (`meldungsStufe`) und fällige
    Erinnerung (`erinnerungZustand`) gibt es schon, je an einer Stelle (Welle 1, Changes
    `kevp40j3-…`, `ro4s6p7l-…`).
  - Sein Kennzahlenband zeigt Betroffene, Kräfte, Offene Aufträge, Meldungen offen,
    Einsatzabschnitte und Einsatzdauer.
- **Lagebild** (`pages/lage-dashboard/LageDashboardPage.tsx`):
  - Es rechnet über `useLagebild` und `baueLagebild`; die Vorbereitung der Lagebesprechung teilt
    beide.
  - Das Band „Lage in Zahlen“ hat sechs Plätze mit Vermissten.
  - Das Fußband „Führungsstand“ zeigt Aufträge offen, Meldungen offen, Lagebericht und UHS aktiv.
  - Rückmeldungen, Sofortmeldungen und Abschnittszustände lädt es nicht.
- **Lagemonitor** (`geraet/LagemonitorPage.tsx`):
  - Er liest nur `GET …/lagemonitor` (`src/routes/lagemonitor.rs`, `verdichte`). Alle Listen der
    Quellen sind ihm gesperrt (`frontend/src/geraet/AGENTS.md`, Datenschutz).
  - Er fragt alle 30 s nach. Meldungsereignisse erreichen ihn nicht (`LiveEvent::Sofortmeldung` ist
    an `meldungen` gebunden).
- **Modulzähler** (`src/einsatz/zaehler.rs`):
  - Er liefert `meldungen{offen, ungesehen, bestaetigung_ueberfaellig}`, `auftraege.ueberfaellig`,
    `erinnerungen.faellig` und `nachforderungen.ueberfaellig`.
  - Sofortmeldungen zählt bisher nur der Monitor (`meldung::repo::count_sofort_offen`).
- **Server-Rückmeldung:** Am Server gibt es die Rückmeldung je Einheit mit derselben Regel wie im
  Client: `meldung::rueckmeldung::{faellig_at, ist_ueberfaellig}`, `repo::letzte_je_einheit`.
- **Alarmzone (LLH-1735):** Sie zeigt Ereignisse (Benachrichtigungen) bis zur Kenntnisnahme. Die
  Alarmzeile zeigt Zustände, solange sie bestehen. Beide bleiben getrennt.

## Goals / Non-Goals

**Goals:**
- Eine Zeile, eine Regel: Überblick und Lagebild zeigen dieselben Einträge aus denselben Heimaten.
  Der Monitor zeigt dieselben Arten aus Serverzahlen.
- Seitenrollen festlegen und die doppelten Kennzahlen abbauen.
- Nichts springt: Die Zeile hat eine feste Höhe.

**Non-Goals:**
- Alarmzeile im Lagebild für Externe und in der öffentlichen API v1 (eigene Schemas, Schwärzung).
- Umbau der Monitorkacheln, Zonenbeschriftung und Überbelegung (LLH-1746). Die Kachel „Meldungen“
  des Monitors bleibt (Spec `lagemonitor`, „Zahl der offenen Sofortmeldungen“).
- Kürzen und Umordnen des Bands im Überblick über den Rollenschnitt hinaus (LLH-1748).
- Zählweise der Stärken (LLH-1744).
- Eine klebende Zeile. Sie steht oben im Fluss; das Höhenbudget am Tablet trägt keine zweite
  klebende Leiste (LLH-1748).
- „Keine Rückmeldung“ (eine Einheit hat sich nie gemeldet) in der Zeile. Ohne Rückmeldung gibt es
  keinen Fristbeginn. Der Server kennt diesen Zustand nicht als überfällig, und die Abschnittskarte
  nennt ihn weiter.

## Decisions

### D1 Ableitung im Browser, ein Hook für beide Übersichten
- Eine reine Funktion `wasBrennt(quellen, jetzt) → AlarmEintrag[]` in `frontend/src/lage/wasBrennt.ts`
  baut die Einträge aus bereits verdichteten Eingaben.
- Ein Hook `useWasBrennt(einsatzId, jetzt)` (`lage/useWasBrennt.ts`) lädt die Quellen über
  dieselben Query-Keys wie die Seiten (React Query teilt den Cache) und ruft `wasBrennt` gegen die
  Uhr der Seite. Der Überblick tickt alle 30 s, das Lagebild alle 5 s.
- Den Modulzähler holt der Hook jede Minute auch ohne neue Daten: Für eine verstrichene Frist
  einer Nachforderung gibt es kein Live-Ereignis.
- Eine gesperrte Mittel-Liste zählt für den Ausfall wie im Meldebild als leer. Nur ohne Einheiten
  fehlt die Aussage.
- Überblick und Lagebild rufen denselben Hook, also zeigen sie dieselbe Zeile.
- Quellen:

  | Art | Heimat |
  |---|---|
  | Sofort, Dringend, Bestätigung überfällig, Aufträge überfällig, Erinnerungen fällig, Nachforderungen überfällig | Modulzähler über `fuehrungsZahlen.ts` |
  | Vermisste | `verdichtePersonen(personen).vermisst` |
  | Kritische Abschnitte | Lagezustand der Abschnittsliste |
  | Rückmeldung überfällig | `rueckmeldungJeEinheit` + `rueckmeldungZustand` je Einheit (wie Meldebild und Abschnittskarte) |
  | Ausfall | `ausfallJeEinheit` / `toenungsGruende` |

  `ausfallJeEinheit` wandert dafür aus `ueberblickDaten.ts` an einen gemeinsamen Ort (`lage/`),
  ohne Änderung der Regel.

*Verworfen:* ein neuer Endpunkt `…/alarme`. Er bräuchte eine zweite Heimat für Rückmeldung je
Teilbaum und Ausfall im Server und eine eigene Rechteprüfung je Eintrag. Der Browser hat die Regeln
und die Daten schon.

### D2 Sofort und Dringend in den Modulzähler
- `MeldungsZaehler` bekommt `sofort_offen` und `dringend_offen`.
- `sofort_offen` nutzt dieselbe SQL-Regel wie `count_sofort_offen`: Der Monitor und der Zähler
  rufen eine Funktion, damit „Sofortmeldungen offen“ überall gleich zählt.
- `dringend_offen` gilt für Priorität „dringend“, keine Sofortmeldung, offen und unbestätigt.
- Ein neuer Fall in `regeln.json`, Abschnitt `meldungen`, pinnt beide Sprachen.
- Die Ableitung im Browser zählt Meldungen also nicht aus einer Liste („Eine Heimat je Zahl“).
- Das Ereignis `sofortmeldung` invalidiert den Zähler sofort (eigener Key im Hook, nicht über das
  lange Sammelfenster des Zählers). Sonst stünde die Sofortmeldung erst nach dem Zählerfenster oben.

*Verworfen:* Sofortmeldungen aus der Meldungsliste zählen (Spec `lage-verdichtung`, Handlungsmengen).

### D3 Baustein `AlarmZeile` in `components/instrument/`
- Props:
  - `eintraege: AlarmEintrag[]` mit `{ art, rolle: 'alarm' | 'achtung', text, zusatz?, ziel? }`
  - `stand: 'vollstaendig' | 'unvollstaendig' | 'laedt'`
  - `groesse: 'normal' | 'gross'`
- Feste Höhe aus der Schriftskala (eine Zeile, `normal` ≥ 16 px, `gross` 28 px).
- Einträge als Etiketten mit Rollenfläche (`statusFlaeche`) und Wort.
- Was nicht passt, misst ein `ResizeObserver` und fasst es als „+n“-Knopf zusammen; dieser öffnet
  ein Popover mit allen Einträgen. In `gross` (Monitor) gibt es keinen Knopf, nur „+n“ als Text.
- Ruhe: „Nichts brennt“ in neutraler Rolle. Unvollständig: „Stand unvollständig“ in `text2`, nie
  „Nichts brennt“. Beim Laden hält die Zeile die Höhe mit „—“.
- `role="status"` mit `aria-live="polite"` für Ankündigungen (kein `alert`, das ist der Alarmzone
  vorbehalten).
- Karte in `PREVIEWS` des Design Systems, Nacht und Tag.

### D4 Folge und Wortlaut
- Feste Folge laut Spec: Alarm vor Achtung, innerhalb der Rolle die Art-Reihenfolge.
- Zahlen stehen vorn, die tragende Aussage zuerst:
  - „2 Sofortmeldungen · älteste 4 min“
  - „1 Bestätigung überfällig“
  - „1 vermisst“
  - „kritisch: UHS Turnhalle“
  - „Rückmeldung überfällig: Logistiktrupp, Sanitätszug · längste 47 min“
  - „Ausfall: Logistiktrupp“
  - „2 Aufträge überfällig“
  - „1 dringend“
  - „1 Erinnerung fällig“
  - „1 Nachforderung überfällig“
- Namen: höchstens zwei, dann „+n“ im Eintrag. Ein Sprung zur Liste reicht für die Einzelheiten.
- Das Alter der ältesten Sofortmeldung liefert der Zähler als `sofort_aelteste_at` (optional, UTC).
  Eine heraufgestufte Meldung zählt ab ihrem Sofortalarm (`sofortalarm_at`), nicht ab ihrem Eingang
  (entschieden 16.11.2026 im Review).

### D5 Lagemonitor: Zählfelder in der Verdichtung, Ableitung mit demselben Kern
- `LagemonitorAnzeige` bekommt einen Block `alarm: LagemonitorAlarm`:
  - `sofort_offen`, `sofort_aelteste_at`, `bestaetigung_ueberfaellig`, `dringend_offen`
  - `auftraege_ueberfaellig`, `erinnerungen_faellig`, `nachforderungen_ueberfaellig`
  - `rueckmeldung_ueberfaellig: [{ einheit: String, seit_min: i64 }]`
  - `abschnitte_kritisch: [String]`
- `vermisst` steht schon in `betroffene`.
- Gerechnet wird nur im Handler `lagebild`, nicht in `verdichte`. `verdichte` speist auch das
  Lagebild für Externe und die API v1, und die bleiben unverändert (Non-Goal).
- Die Zahlen kommen aus denselben Serverfunktionen wie der Modulzähler (ohne Rechtefilter: der
  Monitor bekommt nur Zahlen und Einheits- oder Abschnittsnamen, Präzedenz `sofortmeldungen_offen`,
  Change `kcjecn9e`, D12). Die Rückmeldung kommt aus `rueckmeldung::{faellig_at, ist_ueberfaellig}`
  über `letzte_je_einheit`.
- Im Client übersetzt eine kleine Funktion `alarmAusMonitor(lage.alarm, betroffene) → Quellen` in
  dieselben Eingaben für `wasBrennt`. Folge und Wortlaut sind damit identisch.

### D6 Ausfall auf dem Monitor (entschieden 16.11.2026: B)
Der Ausfall einer Einheit ist eine Regel des Browsers: eigene Mittel nach Kräftebaum, Status der
Kategorie „nicht verfügbar“ und Material mit Rolle Alarm oder Achtung samt Beladung, ohne Einheit
mit eigenem Status „nicht verfügbar“. Am Server gibt es diese Regel nicht.
- **A** – die Regel am Server nachbauen und über einen neuen Abschnitt `ausfall` in `regeln.json`
  an den Browser binden. Der Monitor hat dann alle Arten. Kosten: eine zweite Umsetzung des
  Kräftebaums für Ausfall (Besatzungen, Beladung, Statuskatalog der Org), das größte Risiko des
  Branches.
- **B (Empfehlung)** – der Monitor zeigt den Ausfall in diesem Branch nicht. Eine Folgeaufgabe
  verlegt die Ausfall-Regel an den Server, sodass Browser und Monitor sie von dort lesen (eine
  Heimat), und hängt sie an LLH-1746. Die Monitorzeile nennt dann keine Ausfall-Art und meldet sich
  deshalb nicht als unvollständig: Der Monitor hat diese Quelle nicht.

### D7 Sofortmeldung erreicht den Monitor
- Umgesetzt anders als zuerst geplant (Review 16.11.2026): Ein zweiter Gate-Schlüssel
  `lagemonitor` scheiterte daran, dass jeder Gate-Schlüssel ein Modul sein muss
  (`gate_keys_sind_echte_modul_keys`).
- Stattdessen stellt `LiveNachricht::fuer_verbindung` einer Verbindung des gekoppelten
  Lagemonitors (`routes/live.rs`, Ansicht `Lagemonitor`) das Ereignis `sofortmeldung` zu, auch
  ohne das Modul Meldungen.
- Die Nutzlast ist dabei `{}`, also weder Inhalt noch Kennung.
- Das Gate von `sofortmeldung` selbst bleibt `meldungen`. Die Ausnahme hält ADR-0057 als
  Präzisierung von ADR-0003 fest.
- Der Monitor invalidiert bei `sofortmeldung` den Key `lagemonitor`.
- Andere Meldungsereignisse bleiben dem Monitor fern; Fristen holt er mit dem 30-s-Takt.
- Kachel und Zeile zeigen dieselbe Zahl: Der Handler übernimmt `sofort_offen` des Alarm-Blocks auch
  für `sofortmeldungen_offen`.

### D8 Seitenrollen und Kennzahlen
- **Überblick** „Führen: was ist zu tun“:
  - Sein Band heißt „Führungsstand“ und trägt Offene Aufträge, Meldungen offen und
    Einsatzabschnitte.
  - Betroffene, Kräfte und Einsatzdauer fallen weg (Heimat Lagebild).
  - Seitenkopf-Aktion „Lagebild“.
- **Lagebild** „Lage: was ist los“:
  - Band „Lage in Zahlen“ unverändert (sechs Plätze, LFH-640).
  - Das Fußband verliert „Aufträge offen“ und „Meldungen offen“ und behält Lagebericht und UHS
    aktiv unter der Beschriftung „Stand“.
  - Seitenkopf-Aktion „Überblick“.
- Die Sechs-Plätze-Regel gilt für „Lage in Zahlen“. Das Band „Führungsstand“ trägt nur
  Handlungszahlen.
- `frontend/AGENTS.md` bekommt beide Regeln (Dashboard-Baukasten und „Eine Heimat je Zahl“).
- Die Vorbereitung der Lagebesprechung teilt nur `baueLagebild` (das Band) und ist vom Fußband
  nicht berührt.

*Verworfen:* Seiten zusammenlegen (Abstimmung 16.11.2026).

### D9 Sprungziele
Die Ziele kommen aus den vorhandenen Deeplink-Helfern:

| Eintrag | Ziel |
|---|---|
| Meldungen (Sofort, Dringend, Bestätigung überfällig) | Meldungsliste, offen |
| Rückmeldung, Ausfall | Meldebild |
| Vermisste | Personenliste, Filter Status „vermisst“ (bestehender Filterparameter; fehlt er, kommt er dazu) |
| Kritischer Abschnitt | Einsatzabschnitt |
| Auftrag | Aufträge, überfällig |
| Erinnerung | Erinnerungen |
| Nachforderung | Board |

Ein Ziel, das der Betrachter nicht öffnen darf, kommt ohne Link.

## Risks / Trade-offs

- **Ladelast im Lagebild:**
  - Es lädt zusätzlich Rückmeldungen und Meldebild-Rohdaten. Personal, Fahrzeuge, Material,
    Einheiten und Abschnitte liegen über `useLagebild` schon im Cache.
  - Mehr kommt nur über `meldungenRueckmeldungen`.
  - Abschwächung: dieselben Keys, kein Doppelabruf.
- **Zwei Übersetzungswege** (Browser-Quellen, Monitor-Quellen) in denselben Kern: Ein Test speist
  denselben Fall in beide und vergleicht die Zeilen.
- **Alarmbudget (EEMUA 191):** Die Zeile zeigt Zustände ohne Ton, ohne Blinken und ohne Verschieben.
  Sie zählt nicht als neuer Alarm je Eintrag. Die Hervorhebung bei Anstieg bleibt nur auf dem
  Monitor (bestehende Kachel).
- **„+n“ hängt an der Breite:** Messung im Effekt mit fester Höhe; ein Test mit schmaler Breite
  belegt die Zusammenfassung.
- **Schriftgröße 16 px:** Die Staffel-Stufe `text` (14 px) reicht nicht, die Zeile nimmt die nächste
  Stufe ≥ 16 px und hält sie in der Dichte `kompakt`.
