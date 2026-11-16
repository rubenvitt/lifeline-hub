# Tasks

Zunder: LLH-1743 (t9jjrajy). Freigegeben 16.11.2026 mit D6 = B (Monitor ohne Ausfall, Folgeaufgabe).

## 1. Modulzähler: Sofort und Dringend (Backend)

- [x] 1.1 `src/meldung/repo.rs`: Zählung `count_sofort_offen` um die älteste Eingangszeit erweitern
  (eine Abfrage, die Zahl und `MIN(eingang_at)` liefert) und `count_dringend_offen` (Priorität
  `dringend`, keine Sofortmeldung, offen, unbestätigt) dazu. Zuerst Tests in `src/db/tests.rs`
  oder im Repo-Testmodul (rot): Sofort und Dringend getrennt, bestätigte zählen nicht,
  Sofortmeldung mit Priorität „dringend“ zählt nur als Sofort, älteste Eingangszeit.
- [x] 1.2 `src/einsatz/zaehler.rs`: `MeldungsZaehler` um `sofort_offen`, `dringend_offen`,
  `sofort_aelteste_at` (`Option`, `skip_serializing_if`) erweitern und füllen; Monitor
  (`routes/lagemonitor.rs`) nutzt dieselbe Funktion. Neuer Fall in
  `tests/fixtures/verdichtung/regeln.json` (Abschnitt `meldungen`) mit Prüfung in
  `tests/verdichtung_fixture.rs` und `frontend/src/lage/verdichtungFixture.test.ts`.
  `scripts/check-typ-codegen.sh` grün, `openapi.json` und `types.generated.ts` mitcommitten.
- [x] 1.3 Test des Modulzähler-Endpunkts (bestehende Suite zu `modul_zaehler`): Szenarien der
  Delta-Spec `modul-zaehler` (eine Sofort, eine Dringend, eine bestätigte; Sofort mit Priorität
  dringend; älteste Zeit) grün.

## 2. Lagemonitor: Block `alarm` und Sofort-Signal (Backend)

- [x] 2.1 `src/routes/lagemonitor.rs`: `LagemonitorAlarm` (`ToSchema`) mit `sofort_offen`,
  `sofort_aelteste_at`, `bestaetigung_ueberfaellig`, `dringend_offen`, `auftraege_ueberfaellig`,
  `erinnerungen_faellig`, `nachforderungen_ueberfaellig`, `rueckmeldung_ueberfaellig[{einheit,
  seit_min}]`, `abschnitte_kritisch[String]`; gefüllt nur im Handler `lagebild` (nicht in
  `verdichte`), aus den Zählfunktionen des Modulzählers und
  `meldung::rueckmeldung::{faellig_at, ist_ueberfaellig}` über `letzte_je_einheit`. Tests in
  `tests/geraet_kopplung.rs` zuerst: Zahlen stimmen; kritischer Abschnitt mit Name; Auftrags- und
  Meldungstext stehen nicht in der Antwort (Erweiterung von
  `lagemonitor_antwort_traegt_keine_personen`); Lagebild für Externe und `GET /api/v1/lage`
  unverändert (`public_api_spec_aktuell` grün).
- [x] 2.2 Sofort-Signal an den Lagemonitor (design.md D7, wie umgesetzt):
  `LiveNachricht::fuer_verbindung` reicht einer Verbindung des gekoppelten Lagemonitors
  `sofortmeldung` mit der Nutzlast `{}` durch, das Gate `meldungen` bleibt. Tests:
  `live::tests::lagemonitor_bekommt_sofortmeldung_als_signal_ohne_inhalt` (Lagemonitor-Abonnent
  bekommt `sofortmeldung`, aber kein `meldung`; ohne Ansicht kein Ereignis) und
  `lagemonitor_bekommt_sofortmeldung_im_live_kanal_ohne_inhalt` in `tests/geraet_kopplung.rs`.
  ADR-0057 präzisiert ADR-0003.
- [x] 2.3 Typ-Codegen erneut (`scripts/check-typ-codegen.sh`), erzeugte Dateien mitcommitten;
  `frontend/src/geraet/AGENTS.md` (Abschnitt Lagemonitor, Datenschutz) um die neuen Felder und das
  Sofort-Signal ergänzen.

## 3. Kern `wasBrennt` und Baustein `AlarmZeile` (Frontend)

- [x] 3.1 `frontend/src/lage/wasBrennt.ts` mit Tests zuerst (`wasBrennt.test.ts`): Quellen-Typ,
  Einträge je Art mit Rolle, Folge laut Spec, Wortlaut laut design D4 (höchstens zwei Namen, dann
  „+n“), Ruhe und Unvollständig, gesperrte Quellen ohne Einfluss, „angespannt“ nie, „keine
  Rückmeldung“ nie. Alle Szenarien der Delta-Spec `lage-alarmzeile` zu Quellen, Folge und Ruhe als
  Tests.
- [x] 3.2 `ausfallJeEinheit` unverändert von `pages/fuehrung/ueberblickDaten.ts` nach `lage/`
  verlegen (Aufrufer nachziehen), damit Überblick und Kern es teilen; bestehende Tests der
  Abschnittskarte bleiben grün.
- [x] 3.3 `frontend/src/lage/useWasBrennt.ts`: lädt Modulzähler, Personen, Abschnitte, Einheiten,
  Personal, Fahrzeuge, Material und Rückmeldungen über die bestehenden `einsatzKeys`, je mit
  Freigabe (`istKeyFreigegeben`), und rechnet gegen `useJetzt(30_000)`. Test mit gemocktem API:
  Ladezustand → „—“, gescheiterte Rückmeldung → unvollständig, Frist läuft ohne neue Daten ab →
  Eintrag nach dem nächsten Tick.
- [x] 3.4 `frontend/src/lage/alarmAusMonitor.ts` mit Test: derselbe Fall über Browser-Quellen und
  über `LagemonitorAlarm` ergibt dieselben Einträge (ohne Ausfall).
- [x] 3.5 `components/instrument/AlarmZeile.tsx` mit `AlarmZeile.test.tsx` zuerst: feste Höhe
  (Höhe unabhängig von 0, 1, 8 Einträgen), Rollen alarm/achtung/neutral, „+n“ bei schmaler Breite
  mit Popover-Liste, Links nur mit `ziel`, `groesse="gross"` ohne Bedienung und mit 28 px,
  `role="status"`. Export über `components/instrument/index.ts`, Dateikopf nennt die Regel.
- [x] 3.6 `live/`: Ereignis `sofortmeldung` invalidiert neben den Meldungs-Keys (Modulzähler im
  1-s-Zählerfenster) auch `einsatzKeys.lagemonitor`. Test in `useEinsatzLiveStream.test.tsx`
  („sofortmeldung frischt …“), Mutationsprobe ohne die Zeile rot.

## 4. Seiten (Frontend)

- [x] 4.1 Überblick: `AlarmZeile` als erstes Element unter dem Seitenkopf; das Band wird zum
  „Führungsstand“ mit Offene Aufträge, Meldungen offen, Einsatzabschnitte (Betroffene, Kräfte,
  Einsatzdauer entfallen); Seitenkopf-Aktion „Lagebild“. `UeberblickPage.test.tsx`: vermisste
  Person steht in der Zeile; Band ohne Betroffene, Kräfte, Einsatzdauer; Sprung zum Lagebild.
- [x] 4.2 Lagebild: `AlarmZeile` unter dem Seitenkopf; Fußband ohne Aufträge und Meldungen,
  Beschriftung „Stand“ (Lagebericht, UHS aktiv); Seitenkopf-Aktion „Überblick“. Seitentest:
  Sofortmeldung steht ab Eingang in der Zeile; keine Kennzahl „Aufträge offen“ und „Meldungen
  offen“. Gleiche Zeile wie im Überblick: beide Seiten rufen denselben Hook `useWasBrennt`
  (`lage/useWasBrennt.test.tsx`), kein zweiter Weg.
- [x] 4.3 Sprungziele laut design D9; Filter „vermisst“ der Personenliste prüfen und bei Bedarf
  als URL-Parameter ergänzen (mit Test). Ziele ohne Leserecht ohne Link.
- [x] 4.4 Lagemonitor: Zeile `groesse="gross"` über der Kachel „Lagekarte“ (nicht über die volle
  Breite: sonst schnitt die UHS-Kachel bei sechs langen Namen 39 px ab; entschieden 16.11.2026),
  gespeist über `alarmAusMonitor`; invalidiert `einsatzKeys.lagemonitor` bei `sofortmeldung`.
  `LagemonitorPage.test.tsx`: Zeile mit kritischem Abschnitt, 28 px, keine Bedienung, Fehlerzustand.
  e2e `geraet-lagemonitor.spec.ts` bei 1920 × 1080 mit sieben Arten: Zeile läuft mit „+n“ über,
  alle Kacheln ohne Bildlauf und ohne Abschneiden (lokal grün).

## 5. Regeln, Design System, Doku

- [x] 5.1 `frontend/AGENTS.md`: Dashboard-Baukasten (Alarmzeile ganz oben auf Überblick, Lagebild,
  Monitor; Baustein in der Liste), Seitenrollen „Führen“ gegen „Lage“ und Heimat der Kennzahlen
  (Abschnitt „Eine Heimat je Zahl“), Sechs-Plätze-Regel ausdrücklich für „Lage in Zahlen“.
  Prettier grün.
- [x] 5.2 Design System: Karte `AlarmZeile` in `frontend/scripts/design-system/previews.tsx`
  (Nacht und Tag, mit Einträgen und in Ruhe), `mise exec -- pnpm -C frontend design-system`, das
  Erzeugte mitcommitten; `designSystem.guard.test.ts` grün.
- [x] 5.3 Anwenderdoku: `docs/anwender/kapitel/ueberblick.md`, `lagebild.md`, `lagemonitor.md`
  (Zeile, Rollen der Seiten, entfallene Kennzahlen), Bilder über den Bildlauf erneuern;
  Doku-Wächter grün (`docs/anwender/AGENTS.md`).
- [x] 5.4 Folgeaufgabe per `zunder-task-anlegen`: Ausfall-Regel an den Server, damit der Monitor
  sie zeigt (D6 B), an LLH-1746 hängen; Link im PR. Angelegt: LLH-1929
  (https://zunder.rubeen.dev/#/aufgabe/t31o93c2k279hpnglvh99q6y).
- [ ] 5.5 `./scripts/check-all.sh --geaendert --ohne-e2e` grün;
  `mise exec -- openspec validate t9jjrajy-alarmzeile-was-brennt --strict` grün.

## Workflow follow-up

- Review vor dem PR über den ganzen Branch (Skelett „Review-find-verify“, Backend und Frontend).
- Bilder der Änderung (Überblick, Lagebild, Monitor) in PR und Meldung.
- `/opsx:archive t9jjrajy-alarmzeile-was-brennt` vor dem PR, im selben Branch.
- Nach dem Merge: Design System neu veröffentlichen (`frontend/AGENTS.md`).
