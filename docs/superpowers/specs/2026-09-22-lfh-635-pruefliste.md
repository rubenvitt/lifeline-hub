# Prüfliste Einsatztauglichkeit — Modul „Ablösung" (LFH-635)

Gate 7 der Bedien-Leitlinie (`2026-07-25-bedien-leitlinie-einsatzkontexte.md`, Festlegung 7)
verlangt diese Liste an jeder neuen Seite. Planung und Spec liegen in
`openspec/changes/lfh-635-fachmodul-abloesung/`.

## Geltungsbereich

| Angabe | Wert |
| --- | --- |
| Route | `/einsaetze/:id/abloesung` (`frontend/src/pages/AbloesungPage.tsx`) |
| Stand | Commit `479622af` auf `claude/lfh-635-7d0ec8` |
| Zielkontext | Fükw (1366 px, Tastatur + Maus, Nachtmodus als Regelfall); Führungs-Tablet in `komfortabel`/`handschuh`; mobil 390 px nur lesend und für den Vollzug |
| Nicht enthalten | Sammelbanner für fremde Neuzugänge (→ LFH-647). Die Kontrast-Messung ist mit LFH-646 nachgezogen (`92f96e91`) |

| Fläche | Stellvertreter | Browser-Messung |
| --- | --- | --- |
| **1 · Schichtliste mit Kopf und Vorgaben-Paneel** | `pages/AbloesungPage.tsx`, `abloesung/AbloesungKarte.tsx` | ja: Gate 1 (Überlauf), Gate 3 (Trefffläche, Abstand), Kontrast (LFH-646) |
| **2 · Erfassungsdialoge** (Schicht beginnen, Vollzug, Ablöser planen, Rhythmus) | `abloesung/AbloesungDialoge.tsx` | Kontrast an zwei Dialogen (LFH-646), sonst Vitest |
| **3 · Hinweis und Marke** (AlarmZentrale, Überblick „Nächste Marken", Modulzähler) | `einsatz/AlarmZentrale.tsx`, `pages/fuehrung/ueberblickDaten.ts`, `einsatz/useModulZaehler.ts` | Sichtprüfung (Screenshot), sonst Vitest |

**Verdikte:** **erfüllt** (nur mit Beleg: Testdatei + Testname oder Messung + Commit) ·
**offen → Zielticket** · **nicht anwendbar** (mit Begründung). Gerechnetes und aus Quelltext
Geschlossenes trägt **[abgeleitet]**.

## Die Nachweise

| Nachweis | Ergebnis | Stand |
| --- | --- | --- |
| Gate 3, `e2e/gate3-trefflaeche.spec.ts` „Ablösung: Kartenaktionen und Vorgabe-Knopf folgen der Dichte-Staffel 30 / 48 / 72 px", 1366 px, zwei gesäte Schichten | „Ablösung vollziehen" **30 / 48 / 72** px (2 Knoten) · Dreipunkt **30 / 48 / 72** (2) · Vorgabe-Knopf **30 / 48 / 72** (1) · Abstand Kartenaktion ↔ Dreipunkt **7 / 11 / 16** px | `479622af` |
| Gate 1, `e2e/gate1-ueberlauf.spec.ts` „Gate 1: keine tragende Route …", Schicht mit langem Einheits- und Abschnittsnamen | kein waagerechter Überlauf auf 1366 / 1024 / 390 px | `056517f3` |
| Browser-Sichtprüfung (Playwright-Harness, Nacht und Tag) | drei Karten in Fälligkeitsordnung, Rand rot/gelb/Linie, Wort im Etikett; nach dem Vollzug Folgeschicht und Rückgängig-Hinweis; Überblick-Marken „Ablösung Florian Nord 2" usw.; ETB mit Entscheidung, Systemeinträgen und Vollzugsmeldung | `cc53390a` + Nachschärfung `056517f3` |
| Kontrast, `e2e/abloesung-kontrast.spec.ts` „Ablösung: Schichtkarten, Vorgaben und Kopf — Text und Rand im Modus light/dark", 1366 px; gesät je Einstufung eine Schicht plus eine vollzogene mit Folgeschicht. Gemessen wird **jeder** Text aus dem Textbaum (Karten, abgelöste Karte, Vorgaben-Paneel, Seitenkopf, Dialoge „Schicht beginnen" und Vollzug), dazu Karten- und Etikettrand. Messkern `e2e/kontrast-kern.ts`, Randmessung mit Selbstprobe | **Text, Minimum ohne Ausnahme:** Tag 7,05 (Kopf-Meta „4 laufend · 2 fällig"), auf der Karte 7,31 („überfällig" auf `alarmFlaeche`); Nacht 6,19 (Primärknopf) · **Zustandsrand** der Karte gegen Seitengrund / Kartenfläche: überfällig Tag 5,67 / 5,52, Nacht 7,18 / 6,89 · Vorwarnung Tag 5,79 / 6,34, Nacht 12,45 / 12,25 · **Etikettrand** gegen Kartenfläche / eigene Tönung: Minimum Tag 5,52 / 4,99, Nacht 5,24 / 4,72 · **Ausnahmen** (Untergrenze 4,5): Tertiärtext `schwach` Tag 5,20 (Augenbraue „fällig" auf `alarmFlaeche`), Nacht 4,81 (Feldhilfe im Dialog) → LFH-643 (dazu im Seitenkopf Ortspfad und „Stand", 5,33) · Weiß auf `bedien` im Primärknopf Tag 6,59 → LFH-661. Seitentitel und Kopf-Meta laufen ohne Ausnahme. Mutationsproben: Alarmfläche auf `alarm` und Zustandsrand auf Kartenfläche → Text- und Randprüfungen rot; `article` in die Tertiär-Liste → „ohne Ausnahme gemessen" rot | `92f96e91` |
| Grep über `abloesung/`, `pages/AbloesungPage.tsx` (ohne Tests) | Farbliterale **0** · `animation`/`blink`/`keyframes`/`transition` im Code **0** · `danger` **0** · `sticky`/`fixed` **0** · `size=` nur `Spin size="large"` (Ladeanzeige) und `Space size={2}` (Abstandsmaß, nicht interaktiv) | `479622af` [abgeleitet] |

---

## Tabelle 1 — Schichtliste mit Kopf und Vorgaben-Paneel

| Nr. | Kriterium | Verdikt | Beleg / Begründung | Zielticket |
| --- | --- | --- | --- | --- |
| 1 | **Treffläche** ≥ 24 × 24 px; zeitkritische Aktion ≥ 48 px mit ≥ 8 px Abstand | **erfüllt** | Gate 3: alle Ziele 30 / 48 / 72 px. „Ablösung vollziehen" ist zeitkritisch: in `komfortabel` 48 px und 11 px Abstand zum Nachbarn. Alle Ziele sind antd-`Button`, es gibt kein handgebautes Bedienziel | — |
| 2 | **Handschuh-Modus** — Ziel ≥ 72 px, Abstand ≥ 16 px | **erfüllt** | Gate 3 `handschuh`: 72 px an allen fünf Zielen, Abstand 16 px (Test erzwingt ≥ 16). Mit dem vorherigen `marginXS` wären es 7 px gewesen [abgeleitet aus `theme/tokens.ts`, Abstandsraster] | — |
| 3 | **Rückmeldung vor der Serverantwort** ≤ 100 ms | **erfüllt** | Knöpfe der Dialoge laufen mit `loading` (`laeuft` an `ErfassungsModal`); die Liste zeigt beim Laden eine Ladeanzeige statt einer leeren Liste. `AbloesungPage.test.tsx` „Schicht beginnen: Enter-Struktur und Rhythmus in Stunden → Minuten" (Dialog bleibt bis zur Antwort) | — |
| 4 | **Kritische Aktion hat eine zweite Handlung** | **erfüllt** | Der Vollzug ist die folgenreichste Aktion. Er läuft über einen Erfassungsdialog (Zeitpunkt, ablösende Einheit) und ist umkehrbar: `POST …/vollzug/zuruecknehmen`, angeboten als Rückgängig-Hinweis (LFH-343). `AbloesungPage.test.tsx` „Vollzug: Dialog vorbelegt, POST, Rückgängig ruft die Rücknahme"; `tests/abloesung.rs` „durchstich_beginnen_vorgabe_vollzug_ruecknahme" | — |
| 5 | **Kontrast in beiden Modi** — Text Tag ≥ 7:1, Nacht ≥ 5:1; Zustände ≥ 3:1 | **erfüllt** | `e2e/abloesung-kontrast.spec.ts` (Werte unter „Die Nachweise“). Jeder Text der Seite, der nicht unter eine der zwei app-weiten Ausnahmen fällt, hält Tag ≥ 7 (Minimum 7,05, auf der Karte 7,31, auch auf `alarmFlaeche`) und Nacht ≥ 5 (Minimum 6,19). Zustandsrand (überfällig, Vorwarnung) ≥ 3 gegen Seitengrund **und** Kartenfläche (Minimum 5,52), Etikettrand ≥ 3 gegen beide Flächen (Minimum 4,72). **Der Rand der planmäßigen und der abgelösten Karte ist nicht anwendbar:** er trägt die Linienfarbe (1,20–1,31), weil planmäßig kein Zustand ist. Der Spec sichert zu, dass er keinem Zustandsrand gleicht. **Ausnahmen, beide nicht seitenspezifisch:** Tertiärtext `schwach` (Augenbrauen, Sekundärtext samt „Stand“, Feldhilfe, Platzhalter, Ortspfad im Seitenkopf) liegt am Tag bei 5,20–6,37 und nachts bis 4,81 → LFH-643. Weiß auf `bedien` im Primärknopf liegt am Tag bei 6,59 → LFH-661. Der Spec prüft beide gegen die Untergrenze 4,5; die Ausnahme fällt, sobald die Tickets landen | LFH-643, LFH-661 (app-weit) |
| 6 | **Kein Status allein über Farbe** | **erfüllt** | Jede Einstufung hat ein Wort („planmäßig" / „Ablösung bald fällig" / „überfällig") und einen Abstandstext („seit 13 min", „in 19 min"). `AbloesungPage.test.tsx` „zeigt die Schichten in Fälligkeitsordnung, überfällig mit Wort, Rand und ohne Animation"; `theme/statusFarben.test.ts` „abloesungEinstufung (LFH-635)"; Kanaltest „gibt jedem Eintrag einen zweiten Kanal" | — |
| 7 | **Eine Farbe = eine Bedeutung** | **erfüllt** | Rot nur für überfällig, Gelb nur für die Vorwarnung, planmäßig `neutral` (bewusst nicht grün, Kopfkommentar `abloesungEinstufung`). Die Kartenaktion ist bewusst kein Primärknopf, die eine Primäraktion steht im Kopf („Schicht beginnen"). Grep: `danger` 0, Farbliterale 0 | — |
| 8 | **Helligkeits-/Kontrastregler** | **offen** | App-weite Lücke, wie in allen Prüflisten seit LFH-336 | LFH-397 |
| 9 | **Kritische Anzeigen im Blickfeld** | **erfüllt** | Die Liste ist nach Fälligkeit geordnet, die überfälligste Karte steht oben links unter dem Kopf. Der Kopf nennt „n laufend · m fällig" (`AbloesungPage.test.tsx`, erster Test, „3 laufend · 2 fällig"), der Modulzähler das Gleiche im Rahmen | — |
| 10 | **Alarmbudget** — 1–2 je 10 min, ≤ 3 Eskalationsstufen | **erfüllt** | Drei Stufen (planmäßig → Vorwarnung → überfällig). Je Schicht höchstens zwei Hinweise (Vorwarnung, Fälligkeit), jeder genau einmal: `src/erinnerung/scheduler.rs` „abloesungsfristen_publizieren_je_einmal_das_modul_event". Kein Doppelalarm über den Erinnerungszweig: `useEinsatzLiveStream.test.tsx` „LFH-635: abloesung mit art alarmiert …". Die Hinweise laufen durch dasselbe Budget der AlarmZentrale (höchstens drei sichtbar, der Rest gebündelt): `AlarmZentrale.test.tsx` „bündelt vier Ablösungen …". **[abgeleitet]** Schichten eines Abschnitts beginnen meist gemeinsam; mehrere gleichzeitige Fälligkeiten landen als ein Sammelhinweis, nicht als Toast-Flut | — |
| 11 | **Warnverhalten** — kein Blinken, jede Warnung quittierbar, jeder Ton mit visueller Entsprechung | **erfüllt** | Kein Blinken (Grep 0; Test prüft `style.animation` leer). Der Hinweis ist ein `duration: 0`-Toast mit Schließen und „Öffnen" (quittierbar). Der Ton (`alarm` bei Fälligkeit, `dezent` bei Vorwarnung) kommt immer zusammen mit dem Toast: `useEinsatzLiveStream.ts`, `onAbloesung` | — |
| 12 | **Kein Sprung unter dem Cursor** | **offen** | Eigene Aktionen verschieben erwartbar. Eine **fremd** angelegte Schicht dagegen landet über das Live-Ereignis an ihrem Fälligkeitsplatz, auch oberhalb des Cursors. Selten und kurz, weil eine Karte je eingesetzter Einheit, aber nicht ausgeschlossen | LFH-647 |
| 13 | **Fokus nie verdeckt** | **erfüllt [abgeleitet]** | Keine fixierte Konstruktion auf der Seite (Grep `sticky`/`fixed` 0). Der einzige Überlagerer ist der Rückgängig-Hinweis oben mittig; er verdeckt nur für wenige Sekunden (`DAUER_S`) den oberen Rand | — |
| 14 | **Tabellenseite vollständig** | **nicht anwendbar** | Keine Tabelle: eine Liste, gefragt ist „was ist mit dieser Einheit?", geordnet nach Fälligkeit (LFH-330/B2, Dateikopf `AbloesungPage.tsx`) | — |
| 15 | **Erfassungsmaske vollständig** | **nicht anwendbar** | Keine Erfassung auf der Fläche; die Masken sind Fläche 2 | — |

**Bilanz:** 11 erfüllt · 2 offen · 2 nicht anwendbar.

## Tabelle 2 — Erfassungsdialoge

Nur die Zeilen, die sich von Tabelle 1 unterscheiden. Nr. 7, 8 und 11 gelten wie dort.

| Nr. | Kriterium | Verdikt | Beleg / Begründung | Zielticket |
| --- | --- | --- | --- | --- |
| 1/2 | Trefffläche, Handschuh | **erfüllt [abgeleitet]** | Die Masken nutzen ausschließlich antd-Felder und `ErfassungsModal` und erben die Staffel vom `ConfigProvider`. Im Browser ist das nicht gemessen; es ist dieselbe Hülle, die Gate 3 an anderen Masken belegt | — |
| 3 | Rückmeldung | **erfüllt** | Knopf `loading`, Fehler bleiben **im** Dialog (`SpeicherFehler`), Felder bleiben stehen (`mutateAsync`) | — |
| 4 | Zweite Handlung | **erfüllt** | Siehe Tabelle 1, Nr. 4 | — |
| 5 | Kontrast | **erfüllt** | Gemessen, nicht geerbt: `e2e/abloesung-kontrast.spec.ts` öffnet „Schicht beginnen“ und den Vollzug und misst jeden Text im Dialog. Tag ohne Ausnahme Minimum 17,08, Nacht 6,19. Ausnahmen wie in Tabelle 1: Feldhilfe und Platzhalter (`schwach`, Tag 5,89, Nacht 4,81) → LFH-643, Absende-Knopf (Weiß auf `bedien`, Tag 6,59) → LFH-661. „Ablöser planen“ und „Rhythmus“ laufen über dieselbe `ErfassungsModal`-Hülle mit denselben Feldarten **[abgeleitet]** | LFH-643, LFH-661 (app-weit) |
| 12 | Kein Sprung | **nicht anwendbar** | Dialog ohne Live-Inhalt | — |
| 15 | **Erfassungsmaske vollständig** | **erfüllt** | Höchstens drei Felder (Feldbudget LFH-19). Leere Felder sind sichtbar belegt („Leer: jetzt", „Leer: Vorgabe des Abschnitts (6 h)"). Der Ablöser ist mit der Planung vorbelegt. Beschriftung über dem Feld. Enter-Struktur (Knopf im `<form>`, kein antd-Fuß): `AbloesungPage.test.tsx` „Schicht beginnen: Enter-Struktur …" und „Vollzug: …". Kein Serienmodus: eine Schicht beginnt man je Einheit, nicht im Minutentakt | — |

## Tabelle 3 — Hinweis und Marke

| Nr. | Kriterium | Verdikt | Beleg / Begründung | Zielticket |
| --- | --- | --- | --- | --- |
| 6 | Nicht nur Farbe | **erfüllt** | Toast-Titel „Ablösung fällig" / „Ablösung in 30 min" mit Einheit und Uhrzeit (`AlarmZentrale.test.tsx` „zeigt einen Ablösungs-Hinweis mit Einheit und Uhrzeit …"); Marke mit Wort „überfällig" / „in 19 min" (`ueberblickDaten.test.ts` „führt Ablösungen als eigene Quelle …") | — |
| 9 | Blickfeld | **erfüllt** | Die Marke steht im Überblick unter „Nächste Marken", zusammengefasst je Abschnitt („Ablösung Deichwache Nord, 2 Einheiten"), und überspringt die Auto-Fristen derselben Ablösung (kein Doppel). `UeberblickPage.test.tsx` „Nächste Marken: fällige Ablösungen je Abschnitt zusammengefasst …" | — |
| 10 | Alarmbudget | **erfüllt** | Siehe Tabelle 1, Nr. 10 | — |
| — | Sichtbarkeit | **erfüllt** | Ohne sichtbares Modul keine Anfrage und keine Marke: `UeberblickPage.test.tsx` „ohne sichtbares Modul Ablösung keine Anfrage …", mit Mutationsprobe (`enabled: true` → rot). Live-Ereignis `abloesung` nur an Modul-Leser: `src/live/mod.rs`, Gate-Pin | — |
