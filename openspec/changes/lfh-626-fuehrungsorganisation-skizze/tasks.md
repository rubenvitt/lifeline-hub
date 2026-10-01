# Tasks

Jede Aufgabe entsteht per `superpowers:test-driven-development`: erst rot, dann grün.
- Vitest: `mise exec -- pnpm -C <abs>/frontend test -- <datei>`
- e2e: `mise exec -- pnpm -C <abs>/frontend exec playwright test <datei>`

Vor „fertig“ stehen `verification-before-completion` und `requesting-code-review`.

## 1. Knotenmodell (D2, D4, Spec „Knotenaufbau“, „Knoteninhalt“, „Stärke“)

- [ ] 1.1 Test zuerst: `pages/einsatzabschnitte/fuehrungsorganisation.test.ts` deckt diese Fälle
  von `baueFuehrungsorganisation` ab:
  - oberste Abschnitte als Wurzeln, Unterabschnitte vor Einheiten
  - Untereinheit unter ihrer Einheit, nicht unter dem Abschnitt
  - Waisen: übergeordneter Abschnitt bzw. übergeordnete Einheit unbekannt → Wurzel bzw. oberste
    Einheit im Abschnitt
  - Sammelknoten „Ohne Abschnitt“ nur bei Einheiten ohne Abschnitt
  - Zyklus `ueber_abschnitt_id` A↔B: jeder Knoten höchstens einmal, kein Absturz
  - Rufname, Leitung, Stärke `null` bei fehlenden Einheiten, `einheitenFehlen` gesetzt
  - stabile `key`s `ab-<id>`, `eh-<id>`, `ohne`

  Nachweis: rot belegt, Datei existiert.
- [ ] 1.2 Test zuerst, Stärke-Gleichheit: Für denselben Datensatz (zwei Unterabschnitte, eine
  unterstellte Einheit) ist die Stärke jedes Abschnittsknotens gleich
  `abschnittStaerken(...).inklUnter`, also dem Wert des Gliederungsbaums. Ein Abschnitt ohne
  Einheiten hat `null`, nicht 0/0/0. Nachweis: rot belegt.
- [ ] 1.3 Test zuerst, gleiche Platzierung wie der Funkplan: Für einen gemeinsamen Datensatz
  ergibt `baueFuehrungsorganisation` dieselbe Abschnitt/Einheit-Struktur wie `baueFunkplan` ohne
  Fahrzeuge (Vergleich über die `key`-Bäume). Nachweis: rot belegt.
- [ ] 1.4 Umsetzung `baueFuehrungsorganisation` in `pages/einsatzabschnitte/fuehrungsorganisation.ts`
  (Typen `OrgKnoten`, `Fuehrungsorganisation`). Stärke über `abschnittStaerken` und
  `summiereStaerke`, Zeichen über `baueTzProps`. Dateikopf mit Verweis auf diese Change.
  Nachweis: Tests aus 1.1 bis 1.3 grün, `pnpm exec tsc -b` grün.

## 2. Darstellung (D3, D5, D6, Spec „Lesbar ohne waagerechtes Scrollen“, „Ein- und Ausklappen“, „Einsatzleitung und Stab“)

- [ ] 2.1 Vor dem Bau messen, Messspec `e2e/fuehrungsorganisation.spec.ts` (Grundgerüst):
  - Bei 1366 × 768 mit offenem Modulpanel die Contentbreite der Seite Einsatzabschnitte messen.
  - Dazu die Laufweite des längsten gesäten Abschnitts- und Einheitsnamens, eines Funkrufnamens in
    Mono und einer Stärke `F/UF/M//Σ`.
  - Werte als `test.info().annotations` ausgeben.

  Nachweis: Die Messwerte und die daraus gewählte Spaltenbreite stehen als Nachtrag in
  `design.md` D3.
- [ ] 2.2 Test zuerst: `pages/einsatzabschnitte/Organigramm.test.tsx` deckt ab:
  - Wurzel „Einsatzleitung“ mit „Leitung nicht erfasst“ und ohne Stärke
  - Knoten mit Name als Link, Rufname bzw. „kein Rufname“, Leitung bzw. „Leitung nicht besetzt“
    als Wort, Stärke über `staerkeText`
  - Zeichen `aria-hidden`
  - Klappknopf mit `aria-expanded`; Zuklappen verbirgt die Kinder, der Knoten bleibt
  - „Alle aufklappen“ und „Alle zuklappen“
  - ein neu hinzukommender Knoten (Rerender mit mehr Daten) steht offen

  Nachweis: rot belegt.
- [ ] 2.3 Test zuerst, Stabsstelle:
  - Bei `frei` und geladener Besetzung erscheinen die Sachgebiete mit Kürzel und Name, mit
    Wortlaut aus `stab/sachgebiete.ts`, und `einsatzleitung` erscheint als „durch die
    Einsatzleitung“.
  - Bei `gesperrt` und `laden` gibt es keine Stabsstelle und keinen Aufruf von `ladeStab`.
  - Bei einem Fehler steht „Besetzung nicht geladen“.

  Nachweis: rot belegt.
- [ ] 2.4 Umsetzung `pages/einsatzabschnitte/Organigramm.tsx`:
  - Grid der ersten Ebene, senkrechte tiefere Ebenen, Einrückung gedeckelt ab Tiefe 4
  - Stabslinie
  - Farben nur aus `rollen`/Tokens, Mono `tabular-nums`
  - Bedienziele in der Dichte-Staffel, keine neuen `size="small"`

  Nachweis: Tests aus 2.2 und 2.3 grün, `components/dichte.guard.test.ts` und
  `theme/rollen.guard.test.ts` grün.

## 3. Ansicht auf der Seite Einsatzabschnitte (D1, D7, D9, Spec „Ansicht der Abschnittsseite“, „Deeplinks“, „Quellenzustand“)

- [ ] 3.1 Test zuerst: In `routing/deeplinks.test.ts` gilt:
  - `einsatzabschnittePfad(id, {ansicht:'organigramm'})` erzeugt `?ansicht=organigramm`.
  - `parseAbschnitteAnsicht` nimmt nur `gliederung` und `organigramm` an.

  Nachweis: rot belegt.
- [ ] 3.2 Test zuerst: `EinsatzabschnittePage.test.tsx` (neu oder ergänzt) deckt ab:
  - Die Segmentleiste ist ohne Schreibrecht sichtbar.
  - „Organigramm“ ersetzt Baum und Detail.
  - `?ansicht=organigramm` wird angewendet und geräumt, ein unbrauchbarer Wert wird nur geräumt.
  - `?abschnitt=<id>` wechselt aus dem Organigramm in die Gliederung mit Auswahl.
  - Fehlen die Einheiten, steht der Hinweis „Einheiten: nicht geladen“, und die Stärke ist „—“.

  Nachweis: rot belegt.
- [ ] 3.3 Umsetzung:
  - `einsatzabschnittePfad` mit `ansicht`, dazu `parseAbschnitteAnsicht`
  - Ansicht je Einsatz im Zustand der Seite
  - `Segmentleiste` in `aktionen`
  - Weiche Gliederung/Organigramm
  - `useQueryParamSelektion` setzt die Ansicht „Gliederung“

  Nachweis: Tests aus 3.1 und 3.2 sowie die übrigen Seitentests grün, `pnpm lint` grün.

## 4. Druck und Übernahme (D6, D8, Spec „Druck als eigenes Druckstück“, „In Lagebericht übernehmen“)

- [ ] 4.1 Test zuerst: `rendereFuehrungsorganisationMarkdown` in `fuehrungsorganisation.test.ts`
  deckt ab:
  - Überschriftzeile mit Stand
  - „Einsatzleitung: Leitung nicht erfasst“
  - Stabzeile nur, wenn übergeben
  - verschachtelte Liste in Baumtiefe
  - Abwesenheiten als Wort
  - „*Nord* [alt]“ erscheint maskiert, ohne Hervorhebung und ohne Link (über `md()`)
  - keine Erreichbarkeit

  Nachweis: rot belegt.
- [ ] 4.2 Test zuerst, Seite:
  - „In Lagebericht übernehmen“ ruft `legeLageberichtAn` genau einmal mit `vorlage:'freitext'`,
    Titel „Führungsorganisation <DTG>“ und `abschnitte:[{schluessel:'text'}]`, ohne PATCH.
  - Ohne Schreibrecht oder ohne Freigabe der Lageberichte fehlt die Aktion.
  - Solange eine Quelle lädt, ist sie gesperrt.
  - Ein Fehler steht als `SpeicherFehler` an der Seite.
  - Der `DruckKnopf` klappt vor dem Druck alles auf.

  Nachweis: rot belegt.
- [ ] 4.3 Umsetzung:
  - Druckwurzel um das Organigramm-Paneel, `Druckkopf dokumentart="Führungsorganisation"`
  - `DruckKnopf vorbereiten`
  - `organigrammPrint.css` mit zwei Spalten fest, Bedienziele aus, `break-inside: avoid` je Knoten
  - Übernahme-Mutation

  Nachweis: Tests aus 4.1 und 4.2 grün, `druck/druck.test.ts` grün.

## 5. Ende-zu-Ende und Gates (D10)

- [ ] 5.1 `e2e/fuehrungsorganisation.spec.ts` ausbauen:
  - Fükw 1366 × 768 mit Panel und acht obersten Abschnitten: kein waagerechter Überhang von Seite
    und Organigramm, mehrere Zeilen von Spalten.
  - 1024, 768 und 390 px ebenso.
  - Druck mit ausgelöstem `beforeprint` bei A4-Breite: ein zugeklappter Abschnitt ist offen, kein
    Knoten ragt über die Druckwurzel, Werkzeugzeile und Umschalter fehlen.
  - Live: Ein Unterabschnitt wird per API umgehängt und steht ohne Reload unter dem neuen
    Abschnitt.
  - Übernahme: genau ein `POST …/lageberichte`, danach ist der Bericht offen.

  Nachweis: Die Spec läuft grün.
- [ ] 5.2 Gates aufnehmen:
  - `e2e/gate1-ueberlauf.spec.ts` um die Organigramm-Ansicht ergänzen (über den Umschalter oder
    `?ansicht=organigramm`), als Admin und als Beobachter.
  - `e2e/gate3-trefflaeche.spec.ts` um Klappknöpfe, Namenslinks, „Drucken / als PDF“ und „In
    Lagebericht übernehmen“ ergänzen.

  Nachweis: beide Specs grün.
- [ ] 5.3 Regel-Eintrag in `frontend/AGENTS.md`, UI-Form-Leitlinie neben dem FMS-Tableau:
  - Das Organigramm ist eine Ansicht von Einsatzabschnitte, kein Modul.
  - Es ist rein abgeleitet über `baueFuehrungsorganisation`, mit derselben Platzierung wie der
    Funkplan.
  - Die Wurzel trägt keine Zahl.
  - Die Herleitung verweist auf diese Change im Archivpfad.

  Nachweis: `prettier --check` über `frontend/` grün.
- [ ] 5.4 `pruefliste.md` in dieser Change: die 15 Kriterien der Prüfliste Einsatztauglichkeit,
  jede Zeile mit Verdikt (erfüllt mit Beleg, offen → Zielticket, nicht anwendbar mit Grund).
  Nachweis: Die Datei liegt vor, keine Zeile steht auf „nicht geprüft“.
- [ ] 5.5 `./scripts/check-all.sh` (Bündel `schnell` lokal, voll in der CI des PRs). Nachweis:
  grün bzw. Verweis auf den grünen CI-Lauf des PRs.
