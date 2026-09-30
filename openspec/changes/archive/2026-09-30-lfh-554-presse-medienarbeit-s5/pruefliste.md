# Prüfliste Einsatztauglichkeit: Presse und Medienarbeit S5 (LFH-554)

Gate 7 der Bedien-Leitlinie (`docs/superpowers/specs/2026-07-25-bedien-leitlinie-einsatzkontexte.md`,
Festlegung 7) verlangt diese Liste an jeder neuen Seite. Planung und Specs liegen daneben
(`proposal.md`, `design.md`, `specs/`).

## Geltungsbereich

| Angabe | Wert |
| --- | --- |
| Routen | `/einsaetze/:id/stab/presse` (Presse-Log, Pressemitteilungen, Medienlage) · `/einsaetze/:id/stab/presse/mitteilungen/:mitteilungId` (Pressemitteilung, Vollseite) · `/einsaetze/:id/stab/infotelefon` (Informationstelefon). Dazu die Einstiege „Pressearbeit“ und „Informationstelefon“ in der S5-Zeile von `/einsaetze/:id/stab` und der Knopf „Aus S5 übernehmen“ im Abschnitt „Medienlage“ des Lagevortrags |
| Stand | Branch `claude/youthful-bell-szcqun`, PR gegen `alpha` |
| Zielkontext | Ortsfeste Stelle (Stabsraum: Pressestelle und Bürgertelefon, kompakt, voller Tastaturfluss). Die Seiten bestehen trotzdem die Dichte-Staffel und 390 px (design.md D11) |
| Nicht enthalten | Serverseitige Zählung des Informationstelefons ([LFH-862](https://app.clickup.com/t/123zgec62qf)). Bezeichnung und Vorlagen je Organisation ([LFH-863](https://app.clickup.com/t/123zgec62qg)). Feldbefund S5 in [LFH-852](https://app.clickup.com/t/123zgec5zy7). Kein Druck von Presse-Log und Anrufprotokoll, keine Offline-Lesbarkeit (design.md Non-Goals, D8) |

**Verdikte:** **erfüllt** (mit Beleg) · **offen → Zielticket** · **nicht anwendbar** (mit
Begründung). Was gerechnet oder aus dem Quelltext geschlossen ist, trägt **[abgeleitet]**.

## Die Nachweise

| Nachweis | Ergebnis |
| --- | --- |
| `e2e/gate1-ueberlauf.spec.ts` | Alle drei Routen aufgenommen, bei 1366, 1024, 768 und 390 px ohne Seitenüberlauf, als Admin und als Beobachtung. Vorbedingung im Lesezweig: Rechtehinweis auf der Presseseite, kein „Entwurf speichern“ an der Pressemitteilung, Rechtehinweis und kein „Erfassen“ im Informationstelefon. Nach der Umordnung der Presseseite und der Zufluss-Schleuse erneut 12/12 grün |
| `e2e/gate3-trefflaeche.spec.ts` | Neu „Presse S5“ und „Presse S5 (Beobachter)“. Kopfaktionen, Titel-Link der Pressemitteilung, Statusauslöser (Presse-Log und Anruf), „Beantworten“, „Erfassen“ und „Vermisste ↗“ halten 30/48/72 px. Im Lesezweig fehlen die Auslöser, als Vorbedingung geprüft. Die Stab-Tests zählen jetzt 17 Werkzeug-Links in 6 Gruppen. 4/4 grün |
| `e2e/druck-fluss.spec.ts` | Pressemitteilung freigegeben (mehrseitig im normalen Fluss) und als Entwurf (jeder Abschnitt, „Entwurf“ im Druckkopf), jeweils mit ausgelöstem `beforeprint`. 21/21 grün |
| `e2e/fokus-verdeckung.spec.ts` | Neu: „Informationstelefon (LFH-554)“, Tab durch 16 Statusauslöser unter der angepinnten Erfassung, bei 390 × 600 und 1366 × 520, kompakt und Handschuh. **Lokal nicht belegbar:** Das Headless-Chromium dieser Umgebung (Shim auf eine ältere Fassung) beachtet `scroll-margin` beim Fokus nicht. Das bestehende ETB-Gegenstück ist hier auf dem Basisstand ebenso rot. Belegt wird in der CI |
| `e2e/lagebericht-schmal.spec.ts`, `lagebericht-tippen.spec.ts`, `funkplan.spec.ts` | Nach dem neuen Abschnitt „Medienlage“, der Kettenverallgemeinerung und `useStabFreigabe` grün |
| Vitest | `pages/PressePage.test.tsx` (10), `pages/PressemitteilungDetailPage.test.tsx`, `pages/InfotelefonPage.test.tsx` (7), `infotelefon/AnrufErfassung.test.tsx`, `infotelefon/zufluss.test.ts`, `stab/medienlage.test.ts` (Personenbezug fehlt im Markdown), `stab/MedienlageUebernahme.test.tsx`, `stab/useStabFreigabe.test.tsx`, `presse/vorlagen.test.ts`, `api/presse.test.ts`, `pages/StabPage.test.tsx`, `theme/statusFarben.test.ts` (29 Karten), `components/datensicht.guard.test.ts`, `api/lagebildOffline.guard.test.ts` |
| Rust | `tests/stab_presse.rs`, `tests/stab_infotelefon.rs` (Rechte, Statusweg, Freigabe nur Einsatzleitung, Live, Schwärzung), `tests/lagebericht.rs` und `tests/dokument_startinhalt.rs` (Abschnitt „Medienlage“, Paar-Test der Freigaberegel), `tests/enum_wire_kontrakt.rs`, `src/presse/repo/tests.rs` (Nachtragung offener Entwürfe durch die Migration), `src/einsatz/purge_scheduler.rs` |
| Mutationsproben | (1) Scrub-Regel für `kontakt_name` entfernt: Schwärzungstest rot. (2) Freigabe-Gate `EinsatzLeitungszugriff` gegen `EinsatzSchreibzugriff` getauscht: Paar-Test rot (Führungspersonal gab frei). (3) Thema in die Medienlage durchgereicht: `stab/medienlage.test.ts` rot. (4) `ref` der Telefon-Erfassung entfernt: Vitest „hält den Fokus der Zeitachse frei“ rot |
| Befunde beim Prüfen | (a) Die live wachsende Medienlage stand über dem Presse-Log und schob die Arbeitsliste weg: umgeordnet (design.md D6, Nachtrag). (b) Der angepinnten Telefon-Erfassung fehlte der Fokusabstand: nachgerüstet (design.md D8, Nachtrag). (c) Die Zeitachse des Telefons schob neue Anrufe unter den Cursor: eigene Zufluss-Schleuse (D8, Nachtrag) |
| Grep über die neuen Quellen (ohne Tests) | Farbliterale 0 (Farben aus `useRollen`/`statusFarben.ts`) · `animation`/`blink` 0 · `size=` an Bedienelementen 0 (nur `Space size`, `autoSize`) · Emoji 0 |

---

## Seite 1: Presse (`stab/presse`)

| Nr. | Kriterium | Verdikt | Beleg / Begründung | Zielticket |
| --- | --- | --- | --- | --- |
| 1 | **Treffläche** | **erfüllt** | Kopfaktionen, Titel-Link (`stabZeilenzielStil`), Statusauslöser und „Beantworten“ halten 30/48/72 px, gemessen in Gate 3, auch als Beobachtung | — |
| 2 | **Handschuh-Modus** | **erfüllt** | Kein punktuelles `size` (`dichte.guard.test.ts` grün), Gate 3 misst die Stufe Handschuh | — |
| 3 | **Rückmeldung vor der Serverantwort** | **erfüllt** | `laeuft` an der Statuswahl der Zeile, `loading` an den Knöpfen der Masken. Fehler stehen an der Seite bzw. in der Maske (`SpeicherFehler`), die Felder bleiben stehen | — |
| 4 | **Kritische Aktion hat eine zweite Handlung** | **erfüllt** | Nichts ist unumkehrbar: Jeder Statuswechsel lässt sich nach „offen“ zurücknehmen (Rückgängig-Toast, LFH-343). Gelöscht wird nichts. „beantwortet“ verlangt die Antwortmaske | — |
| 5 | **Kontrast in beiden Modi** | **erfüllt** [abgeleitet] | Status als getönte Fläche aus `statusFlaeche.ts` (gemessen in `kraefte-kontrast.spec.ts`), Sekundärtext aus den Rollen, keine eigene Farbe | — |
| 6 | **Kein Status allein über Farbe** | **erfüllt** | Jeder Status trägt sein Wort (`StatusTag`, `wort` Pflicht). „offene Anfragen“ ist eine Zahl mit Titel | — |
| 7 | **Eine Farbe = eine Bedeutung** | **erfüllt** | `achtung` nur für „offen“ (wartet auf Handlung), `bedien` nur für „freigegeben“, sonst neutral (design.md D6) | — |
| 8 | **Helligkeits-/Kontrastregler** | **erfüllt** [abgeleitet] | Die Deckschicht aus LFH-397 wirkt app-weit | — |
| 9 | **Kritische Anzeigen im Blickfeld** | **erfüllt** [abgeleitet] | Das Presse-Log mit der Kennzahl „offene Anfragen“ ist das erste Paneel unter dem Seitenkopf | — |
| 10 | **Alarmbudget** | **erfüllt** | Keine Alarmmeldung. Toasts nur als Quittung nach eigener Handlung (EEMUA 191) | — |
| 11 | **Warnverhalten** | **erfüllt** | Kein Blinken, kein Ton (Grep) | — |
| 12 | **Kein Sprung unter dem Cursor** | **erfüllt** [abgeleitet] | Presse-Log als `Datensicht` mit der Vorgabe `zufluss="sammelbanner"`. Die live wachsenden Paneele (Pressemitteilungen, Medienlage) stehen darunter und schieben die Arbeitsliste nicht (Befund a) | — |
| 13 | **Fokus nie verdeckt** | **erfüllt** [abgeleitet] | Keine angepinnte oder schwebende Leiste auf der Seite. Masken als Modal | — |
| 14 | **Tabellenseite vollständig** | **nicht anwendbar** | Keine Tabelle: Die Frage lautet „was ist mit diesem?“, also Karten (`form="karte"`, in `KONSUMENTEN` von `datensicht.guard.test.ts`, design.md D6) | — |
| 15 | **Erfassungsmaske vollständig** | **erfüllt** | Alle drei Masken über `ErfassungsModal`. Medienkontakt: 3 sichtbare Pflichtfelder, Ansprechperson/Erreichbarkeit/Eingang eingeklappt, Serienmodus. Antwort: 3 Felder. Pressemitteilung: 2 Felder. Enter sendet, Fokus im ersten Feld | — |

## Seite 2: Pressemitteilung (`stab/presse/mitteilungen/:id`)

| Nr. | Kriterium | Verdikt | Beleg / Begründung | Zielticket |
| --- | --- | --- | --- | --- |
| 1 | **Treffläche** | **erfüllt** [abgeleitet] | Nur antd-Bedienelemente aus dem `ConfigProvider` (Knöpfe, Akkordeon, Editor, Datumsfeld), kein handgebautes Ziel. In Gate 3 nicht eigens gemessen, wie die Lagebericht-Detailseite, deren Bauteile sie teilt | — |
| 2 | **Handschuh-Modus** | **erfüllt** | Kein punktuelles `size` (`dichte.guard.test.ts` grün) | — |
| 3 | **Rückmeldung vor der Serverantwort** | **erfüllt** | `loading` an Speichern, Freigeben und Fortschreiben. Speicherfehler an der Seite, Freigabefehler im Dialog (LFH-535). Autosave mit „zuletzt gespeichert HH:MM“ (`useEntwurfVerlustschutz`) | — |
| 4 | **Kritische Aktion hat eine zweite Handlung** | **erfüllt** | Die Freigabe ist unumkehrbar und läuft über den `FreigabeDialog` mit Warnung („endgültig … nur als Folgemeldung“). Nur die Einsatzleitung, sonst gesperrt mit Grund | — |
| 5 | **Kontrast in beiden Modi** | **erfüllt** [abgeleitet] | Theme-Farben, Status über `StatusTag`. Keine eigene Farbe | — |
| 6 | **Kein Status allein über Farbe** | **erfüllt** | „Entwurf“/„freigegeben“ als Wort, im Druckkopf ebenso (druck-fluss) | — |
| 7 | **Eine Farbe = eine Bedeutung** | **erfüllt** | Wie Seite 1 | — |
| 8 | **Helligkeits-/Kontrastregler** | **erfüllt** [abgeleitet] | App-weit | — |
| 9 | **Kritische Anzeigen im Blickfeld** | **erfüllt** [abgeleitet] | Status und Rechtehinweis („Freigabe durch die Einsatzleitung“) stehen im Seitenkopf bzw. direkt darunter | — |
| 10 | **Alarmbudget** | **erfüllt** | Nur Quittungen nach eigener Handlung | — |
| 11 | **Warnverhalten** | **erfüllt** | Kein Blinken, kein Ton | — |
| 12 | **Kein Sprung unter dem Cursor** | **erfüllt** [abgeleitet] | Der Verlustschutz riegelt Fremd-Refetches gegen den offenen Entwurf ab (`useEntwurfVerlustschutz`), keine live einschiebende Liste | — |
| 13 | **Fokus nie verdeckt** | **erfüllt** [abgeleitet] | Keine angepinnte Leiste; Speichern steht im Kopf wie beim Lagebericht | — |
| 14 | **Tabellenseite vollständig** | **nicht anwendbar** | Dokumentseite, keine Tabelle | — |
| 15 | **Erfassungsmaske vollständig** | **erfüllt** | Vollseite nach LFH-19 (Abschnitte, Workflow, deeplink-würdig). Einstiegsfokus im ersten leeren Abschnitt, Navigationsschutz, `key={mitteilungId}` | — |

## Seite 3: Informationstelefon (`stab/infotelefon`)

| Nr. | Kriterium | Verdikt | Beleg / Begründung | Zielticket |
| --- | --- | --- | --- | --- |
| 1 | **Treffläche** | **erfüllt** | „Erfassen“, Anruf-Statusauslöser und „Vermisste ↗“ halten 30/48/72 px (Gate 3) | — |
| 2 | **Handschuh-Modus** | **erfüllt** | Kein punktuelles `size`; der Einklapp-Kopf der Erfassung ohne `size="small"` | — |
| 3 | **Rückmeldung vor der Serverantwort** | **erfüllt** | `loading` an „Erfassen“, `laeuft` an der Statuswahl. Scheitert das Erfassen, bleiben die Felder stehen und der Grund steht darüber | — |
| 4 | **Kritische Aktion hat eine zweite Handlung** | **nicht anwendbar** | Nichts ist unumkehrbar: Ein erledigter Rückruf lässt sich wieder öffnen, gelöscht wird nichts | — |
| 5 | **Kontrast in beiden Modi** | **erfüllt** [abgeleitet] | Wie Seite 1; die Erfassung auf `--lfh-kopf` wie im ETB | — |
| 6 | **Kein Status allein über Farbe** | **erfüllt** | „offen“/„erledigt“ als Wort, Kennzahlen als Zahl mit Titel | — |
| 7 | **Eine Farbe = eine Bedeutung** | **erfüllt** | `achtung` nur für offene Rückrufe | — |
| 8 | **Helligkeits-/Kontrastregler** | **erfüllt** [abgeleitet] | App-weit | — |
| 9 | **Kritische Anzeigen im Blickfeld** | **erfüllt** [abgeleitet] | „offene Rückrufe“ steht als zweite Kennzahl direkt unter dem Seitenkopf | — |
| 10 | **Alarmbudget** | **erfüllt** | Nur Quittungen nach eigener Handlung | — |
| 11 | **Warnverhalten** | **erfüllt** | Kein Blinken, kein Ton | — |
| 12 | **Kein Sprung unter dem Cursor** | **erfüllt** | Zufluss-Schleuse (`infotelefon/zufluss.ts`, Vitest): Liegt der Fokus in der Liste, sammelt ein Sammelbanner fremde neue Anrufe, „anzeigen“ holt sie herein | — |
| 13 | **Fokus nie verdeckt** | **erfüllt** | Gemessener Fokusabstand zur angepinnten Erfassung (`useFokusabstandUnten`), Vitest mit Gegenprobe. Browsernachweis `e2e/fokus-verdeckung.spec.ts` in der CI (lokal siehe oben) | — |
| 14 | **Tabellenseite vollständig** | **nicht anwendbar** | Ein Protokoll wird gelesen: Zeitachse wie ETB und Lagemeldungen, jüngste oben, keine Sortierung (design.md D6) | — |
| 15 | **Erfassungsmaske vollständig** | **erfüllt** | `Schnellerfassungszeile` am Fuß: Anliegen, Notiz, „Rückruf nötig“ sichtbar, Name/Uhrzeit eingeklappt. Die Rückrufnummer steht offen, sobald sie Pflicht ist (kein Pflichtfeld hinter dem Collapse). Enter sendet, Tastaturvertrag in der Hinweiszeile, Fokus zurück ins Anliegen nach dem Speichern | — |

**Bilanz:** Presse 14 erfüllt · 0 offen · 1 nicht anwendbar. Pressemitteilung 14 · 0 · 1.
Informationstelefon 13 · 0 · 2.
