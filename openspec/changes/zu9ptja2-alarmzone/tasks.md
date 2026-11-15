# Tasks

Arbeitsweise je Aufgabe: `superpowers:test-driven-development` (Test zuerst rot, dann grün).
Pfade relativ zu `frontend/src/`, falls nicht anders angegeben. Zunder-Kurzkennungen der
Unteraufgaben: LLH-1735 `p1voqfck`, LLH-1736 `ftf3qelu`, LLH-1737 `mdbfi43h`, LLH-1738 `wuyzp84s`.

## 1. Speicher und Ausblenden (LLH-1736 `ftf3qelu`, Grundlage für LLH-1735)

- [x] 1.1 `alarm/benachrichtigungGedaechtnis.ts`: Menge `ausgeblendet`, gespiegelt in
  `sessionStorage` mit try/catch (D4), Zurücksetzen in `test/setup.ts`. Unit-Test: Eintrag
  übersteht ein simuliertes Neuladen (Modul neu laden), ein Quittieren entfernt ihn, und ein
  werfender Speicher bricht nichts. Vitest grün.
- [x] 1.2 `alarm/alarmZoneSpeicher.ts` (D1): Einträge je Tab über `useSyncExternalStore`, mit
  Aufgeklappt-Zustand. `alarm/useAlarmToasts.tsx` schreibt hinein statt in `notification`, und
  `erledigt` unterscheidet `gelesen` / `ausgeblendet` / `weg` (D4). Tests in
  `alarm/benachrichtigungen.test.tsx` umstellen: ✕ quittiert nicht und merkt aus, „Öffnen“ und
  „Gelesen“ quittieren, Abbau und Einsatzwechsel ohne Quittung, OS-Meldung geht mit. Vitest grün.
- [x] 1.3 `alarm/useBenachrichtigungen.ts`: Nachreichen und `melde` überspringen Ausgeblendetes,
  ein Quittier-Ereignis vom Server räumt es aus dem Gedächtnis. Test „Ausgeblendet und
  nachgereicht“ aus der Spec. Vitest grün.
- [x] 1.4 Eingangsband: ✕ blendet die stehenden Einträge aus statt zu quittieren
  (`alarm/useEingangshinweis.tsx`, `beiSchliessen`); `alarm/eingangshinweis.test.tsx` und
  `alarm/quittierenOffline.test.tsx` angepasst; die Zahl am Knopf „Eingänge“ bleibt. Vitest grün.

## 2. Alarmzone (LLH-1735 `p1voqfck`)

- [x] 2.1 `alarm/AlarmZone.tsx` (D1–D3, Entwurf `Main.dc.html`, `Zone-Zustaende.dc.html`): eine
  Zeile je Eintrag mit Stufe, Titel, Gegenstand, Zeit, „Öffnen“, „Gelesen“ (nicht bei Unwetter)
  und ✕ (`aria-label` „Ausblenden, ohne zu quittieren“). Ab zwei gebündelt „+ n weitere“,
  aufgeklappt Kopfzeile mit Zahl und Arten. Greifer `data-lfh="alarmzone"` /
  `data-lfh="alarm-eintrag"`. Rahmenquelle über `useRahmenObenStapel` auf `RAHMEN_EBENE`. Farben
  nur über Rollen. Unit-Test `alarm/AlarmZone.test.tsx`: Zustände 1–5 des Entwurfs, Bündeln ab
  zwei, „Gelesen“ an einer Zeile quittiert nur diese. Vitest grün.
- [x] 2.2 Einhängen: `einsatz/EinsatzLayout.tsx` direkt nach `UebungsBand`, ab `md`;
  `components/AppLayout.tsx` nach dem `Header`, in jeder Breite (D5). `components/alarmOben.ts`
  mit Test, `--notification-top` in `index.css` und `maxCount` in `main.tsx` entfernen;
  `rahmenOben.guard.test.ts` kennt die Zone. Tests in `einsatz/AlarmZentrale.test.tsx` und
  `alarm/OrgBenachrichtigungen.test.tsx` von `.ant-notification` auf die Zone umgestellt. Vitest
  und `pnpm lint` grün.
- [ ] 2.3 e2e: `frontend/e2e/alarm-verdeckung.spec.ts` neu (1440 × 900 und 820 × 1180): drei
  Alarme, „Auftrag erteilen“ klickbar, Zone unter einem geöffneten Dialog und dem
  Navigations-Drawer, gerollt klebt sie unter dem Kopf. Dazu Fokus-Szenario „Rückwärts unter der
  Alarmzone“. Greifer in `sofortmeldung-hinweis`, `abloesung-kontrast` (räumt über „Gelesen“ ab)
  und `eingangshinweis` umgestellt. Lokal grün.
- [ ] 2.4 Regeln und Doku: `frontend/AGENTS.md` (Rahmen: LFH-1112 ersetzt durch die Alarmzone;
  Layout und Live: Ausnahme der Zone von „springen nicht“; „Ein Eingang ist Information“: Zone
  statt Toastplätze; Baustein `alarm/AlarmZone.tsx` in der Liste).
  `docs/anwender/kapitel/einsatz-oberflaeche.md` (Ablauf „Auf eine Benachrichtigung reagieren“,
  Stufen, Bündeln, Ausblenden ≠ Quittieren) samt `meldungen.md` und `ohne-netz.md`, wo sie Toasts
  nennen. Karte der Zone in `frontend/scripts/design-system/previews.tsx`; `mise exec -- pnpm -C
  frontend design-system` gelaufen, `designSystem.guard.test.ts` und die Doku-Wächter grün.

## 3. Das „Was“ im Hinweis (LLH-1737 `mdbfi43h`)

- [ ] 3.1 `alarm/erinnerungInhalt.ts` (D6): Titel einer fälligen Erinnerung aus
  `einsatzKeys.erinnerungenPhase(id, 'offen')` per `fetchQuery`, Frist `INHALT_FRIST_MS`. Unit-Test:
  gefüllter Cache antwortet ohne Abruf, Frist abgelaufen ergibt `null`, eine unbekannte ID ergibt
  `null`. Vitest grün.
- [ ] 3.2 `alarm/useBenachrichtigungen.ts` (`eintragVon`, `eingangVon`): „Erinnerung fällig:
  ‹Titel›“ in Band, Zone und Leiste. `einsatz/AlarmZentrale.test.tsx` „zeigt eine fällige
  Erinnerung im Eingangsband“ zeigt jetzt den Titel, ohne Antwort den Text des Servers. Vitest
  grün.
- [ ] 3.3 Verlauf (`alarm/EingaengeKnopf.tsx`): Einträge zu Meldung und Erinnerung nennen
  denselben Inhalt wie Band und Alarm (Spec „Der Verlauf nennt den Inhalt einer Meldung“).
  Test in `alarm/EingaengeKnopf.test.tsx`: „Bestätigung ausstehend · RTW 2“ mit Wortlaut. Vitest
  grün.
- [ ] 3.4 Doku `docs/anwender/kapitel/erinnerungen.md` („Erinnerung fällig: ‹Titel›“). Doku-Wächter
  grün.

## 4. Handy-Leiste (LLH-1738 `wuyzp84s`)

- [ ] 4.1 `useFokusInEingabe` (D5, auf Basis von `istEingabefeld`) mit Unit-Test: wahr bei Fokus
  in Eingabe, Textfeld und contenteditable, falsch nach `focusout`. Vitest grün.
- [ ] 4.2 `alarm/Eingangsband.tsx` unter `md`: Leiste von 48 px „‹n› Alarm · ‹m› Eingänge ›“ aus
  Speicher und `useBenachrichtigungVerlauf`, weicht unteren Leisten aus wie das Band, klappt bei
  Fokus ein, mit Alarm eine Zeile mit dem jüngsten Alarm (Entwurf `Handy-Leiste.dc.html`,
  `Handy-Tippen.dc.html`). `AlarmZone` rendert im Einsatz unter `md` nichts. Tests in
  `alarm/Eingangsband.test.tsx` für die drei Zustände. Vitest grün.
- [ ] 4.3 Blatt „Alarme und Eingänge“ (`alarm/EingaengeKnopf.tsx`, Entwurf `Handy-Blatt.dc.html`):
  Ein Tipp auf die Leiste öffnet es über `EINGAENGE_OEFFNEN_EVENT`, oben der Abschnitt „Alarm“
  mit „Öffnen“, „Gelesen“ und ✕. Test in `alarm/EingaengeKnopf.test.tsx`. Vitest grün.
- [ ] 4.4 e2e bei 390 × 844: `eingangsband-ausweichen.spec.ts` (Leiste über der ETB-Erfassung,
  höchstens 48 px, zwei Einträge der Zeitachse darüber), Tippen klappt ein, mit Alarm bleibt eine
  Zeile; Navigations-Drawer liegt über der Leiste. `leisten-flaeche.spec.ts` grün. Lokal grün.
- [ ] 4.5 Doku: `docs/anwender/kapitel/einsatz-oberflaeche.md`, Abschnitt Handy (Leiste, Blatt,
  Einklappen); Karte „Eingänge“ im Design System neu erzeugt. Doku-Wächter und
  `designSystem.guard.test.ts` grün.

## 5. Abschluss

- [ ] 5.1 `./scripts/check-all.sh --geaendert --ohne-e2e` grün; die berührten e2e-Specs
  (`alarm-verdeckung`, `eingangsband-ausweichen`, `eingangshinweis`, `sofortmeldung-hinweis`,
  `abloesung-kontrast`, `leisten-flaeche`, `fokus-verdeckung`) lokal grün.

## Workflow follow-up

- Review vor dem PR über den ganzen Branch (`dev-zunder-orchestrieren`, Phase 4).
- `/opsx:archive zu9ptja2-alarmzone` samt Spec-Sync vor dem PR.
- Design System nach dem Merge neu veröffentlichen (`frontend/AGENTS.md`, „Größere UI-Entwürfe
  über das Design System“).
