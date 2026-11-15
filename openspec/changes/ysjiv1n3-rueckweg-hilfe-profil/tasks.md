# Tasks

Jede Aufgabe per TDD (`superpowers:test-driven-development`): erst der rote Test, dann der Code.
Vitest-Läufe in `frontend/` mit `mise exec -- pnpm exec vitest run <datei>`.

## 1. Ein Rückweg für Ebene 1 (D1, D2)

- [ ] 1.1 `einsatz/einsatzRueckweg.ts` mit `useEinsatzRueckweg(benutzerId, aktiv)` aus der Logik von `useEbene1Ort` in `components/AppLayout.tsx` ziehen; `AppLayout` ruft ihn auf, ohne Verhalten zu ändern. Prüfung: neuer `einsatzRueckweg.test.tsx` (aktiv gelistet → „Zurück zu <Name>“ an den gemerkten Pfad; abgeschlossen, nicht gelistet, nichts gemerkt, `aktiv` falsch → kein Rückweg, keine Abfrage der Liste ohne gemerkten Ort) grün, `components/AdminPage.test.tsx` und die Tests von `AppLayout` unverändert grün
- [ ] 1.2 `ebene1Seite` kennt `neuigkeiten` (Titel und Ort „Neuigkeiten“). Prüfung: Fall im Test von `ebene1Seite` grün; Tab-Titel „Neuigkeiten · lifeline-hub“
- [ ] 1.3 `NeuigkeitenPage` über `AdminPage titel="Neuigkeiten"`, Breite 900 px wie bisher. Prüfung: `NeuigkeitenPage.test.tsx` (h1 „Neuigkeiten“ bleibt, mit gestelltem `Ebene1OrtKontext` stehen „Einsätze › Neuigkeiten“ und „Zurück zu <Einsatz>“) und `Benutzermenue.neuigkeiten.test.tsx` grün
- [ ] 1.4 `docs/anwender/kapitel/einsatz-oberflaeche.md` (Absatz „Zurück zu …“): nennt Profil, Benachrichtigungen, Neuigkeiten, Verwaltung und die Hilfe. Prüfung: `hilfe/anwenderdoku.guard.test.ts` grün

## 2. Rückweg der Hilfe (D3)

- [ ] 2.1 `HilfePage` nimmt den Rückweg aus `useEinsatzRueckweg`; „Zur App“ wird „Zu den Einsätzen“. Prüfung: `HilfePage.test.tsx` mit gemerktem aktivem Einsatz → „Zurück zu <Einsatz>“ führt an den gemerkten Pfad, auch nach einem Kapitelwechsel; abgeschlossen oder nichts gemerkt → „Zu den Einsätzen“ → `/einsaetze`; „Zum Gerät“ und „Zur Anmeldung“ unverändert grün (inkl. `geraet/GeraeteHuelle.test.tsx`)

## 3. Hilfe neben dem Einsatz (D4, D5)

- [ ] 3.1 `hilfePfad` nimmt optional `von` als Suchparameter. Prüfung: Fall in `routing/deeplinks.test.ts` grün (mit und ohne `gruppe`)
- [ ] 3.2 `HilfePage` übernimmt einen gültigen `von` aus der Adresse in den History-State und ersetzt die Adresse ohne ihn; ein ungültiger (`//…`, `https:…`) wird verworfen. Prüfung: `HilfePage.test.tsx` (Adresse danach ohne `von`, `gruppe` bleibt; „Rückmeldung geben“ nach Kapitelwechsel trägt das Muster der Herkunft; ungültiger `von` → Muster der Hilfe)
- [ ] 3.3 `BenutzerMenu` mit Prop `hilfeDaneben`, gesetzt von `EinsatzLayout`: ab `lg` `window.open(hilfePfad({ von }), '_blank', 'noopener')`, sonst `navigate` wie bisher. Prüfung: Test des Benutzermenüs (im Einsatz breit → `window.open` mit Ziel und Merkmalen, keine Navigation; im Einsatz schmal und ohne `hilfeDaneben` breit → Navigation im selben Tab mit `state.von`)
- [ ] 3.4 `docs/anwender/kapitel/rueckmeldung.md` und, falls die Hilfe dort beschrieben ist, `einsatz-oberflaeche.md`: Hilfe öffnet am breiten Schirm aus dem Einsatz in einem neuen Tab. Prüfung: `hilfe/anwenderdoku.guard.test.ts` grün; Bilder der Kapitel nur neu, wenn eine Bilder-Spec die Hilfe oder Neuigkeiten zeigt (`grep` im Kopf der Bilder-Specs)

## 4. Gesamtprüfung

- [ ] 4.1 Im Browser gegen die Demo-Lage: aus dem ETB bei 1440 × 900 öffnet „Hilfe“ einen zweiten Tab, der erste bleibt im ETB; bei 390 × 844 im selben Tab mit „Zurück zu <Einsatz>“ zurück ins ETB; Neuigkeiten und Profil führen zurück an die Stelle. Prüfung: Bilder für PR und Meldung
- [ ] 4.2 `./scripts/check-all.sh --geaendert --ohne-e2e` lokal grün. Prüfung: Gesamtstatus aus dem Lauf

## Workflow follow-up

- Review vor dem PR (Agent, frischer Kontext), `/opsx:archive`, PR gegen `alpha` ohne `voll`.
- Zunder LLH-1731: `review` mit `pr_url`, `release_task`.
