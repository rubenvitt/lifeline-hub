# Stab — Regeln

Gilt für `frontend/src/stab/`, `pages/StabPage.tsx`, `pages/FunkplanPage.tsx`, `pages/KommunikationsplanPage.tsx`, die S5-Seiten (`pages/PressePage.tsx`, `pages/PressemitteilungDetailPage.tsx`, `pages/InfotelefonPage.tsx`, `presse/`, `infotelefon/`) und `src/stab/`, `src/presse/`, `src/infotelefon/`, ergänzt `frontend/AGENTS.md`. Pfade relativ zu `frontend/src/`.

**Funkplan S6** (LFH-548, `openspec/changes/archive/2026-09-30-lfh-548-funkplan/design.md`):
Unterroute `stab/funkplan` (`funkplanPfad`), kein Modul, Einstieg in der S6-Zeile; die Seite
prüft die Stab-Freigabe selbst (ihre Listen hängen an anderen Modulen). Abgeleitet im Client aus
Abschnitten, Einheiten, Fahrzeugen, Personal, Sprechgruppen (`stab/funkplan.ts`), kein Endpunkt;
jede Liste mit eigener Weiche (`api/abrufZustand.ts`), fehlend = „—“ mit Grund. Lücken nur über
`stab/luecken.ts` (auch für ST6). Erreichbarkeit: Schirm ab `xl`, Druck immer (`useDruckModus`),
Lagebericht nie. Sechste Quelle ist die eigene Führungsstelle (LFH-849, `stab/fuehrungsstelle.ts`,
gepflegt im Paneel auf Einsatzdaten, live über `einsatz`): erfasst (`fuehrungsstelleErfasst`, die
eine Regel) steht sie als Zeile `fs` vor den Wurzeln und an der Skizzenwurzel und ist Gegenstelle
der obersten Abschnitte in `verbindungsurteil`; sonst nennt `gegenstelleHinweis` sie als Lücke.

**Fernmeldeskizze** (LFH-893, `openspec/changes/archive/2026-10-05-lfh-893-taktische-fernmeldeskizze/design.md`;
Vorgänger LFH-625): taktische Skizze nach BBK-Anhang J.5 als zweite Darstellung des Funkplans
(`?ansicht=skizze`), kein Modul, keine Route. **Ein Modell:** `stab/fernmeldeskizze.ts:
baueFernmeldenetz` (Stellen `fs`/`ab-`/`eh-`/`ks-`/`ko-`, Schienen `sg-` aus
`luecken.ts:kanalbelegung`, Verbindungen, Bereiche, Lücken je Element) speist Bild, Lücken-Paneel,
Druck und Übernahme; Lücken nur über `stab/luecken.ts` (Bild zählt wie das Paneel). Je
Sprechgruppe **eine Sammelschiene**, keine Kante je Eltern-Kind-Paar; die Führungsorganisation ist
nur Vorlage für Auto-Layout (`stab/fernmeldeskizzeLayout.ts`) und Fokusfolge. Zeichen nur aus
`stab/skizzenZeichen.tsx` (Katalog `@einsatzzeichen` J.1–J.4, Rest in `SELBST_GEZEICHNET`),
„geplant“ immer Strichmuster **und** Wort. **Eine Wahrheit:** Zuordnungen schreibt die Fläche über
die Einzel-Endpunkte in die Datensätze (Abschnitt, Einheit, Führungsstelle, Kommunikationsstelle),
externe Stellen sind die des Kommunikationsplans; die Skizze speichert nur Lage, Komponenten,
Verbindungen, Bereiche, Schriftfeld (`src/stab/fernmeldeskizze.rs`, Bezüge polymorph, jeder
Löschpfad ruft `vergiss`). Schreibwege der Fläche nur über `stab/skizzenAktionen.ts`
(umgesetzt in `stab/useSkizzenAktionen.ts`), Rückgängig über `stab/skizzenBefehle.ts`; Lage mit
`version` (409 statt stillem Überschreiben). Rechte je Element nach dem Datensatz, mobil und ohne
Schreibrecht nur lesen. Keine Erreichbarkeit, keine Rufnummern, keine Fahrzeuge, kein ETB je
Änderung; Druck A3/A4 quer mit Funkplan-Anlage (`stab/skizze/druckformat.ts`), Übernahme nur über
den Funkplan (Abschnitt „Kommunikationsskizze“).

**Sprechgruppen** (LFH-848 D8): dritte Darstellung des Funkplans („Tabelle | Skizze |
Sprechgruppen“, `?ansicht=sprechgruppen`), flach, schreibgeschützt. Menge und Teilnehmer nur über
`stab/sprechgruppenplan.ts` aus denselben `FunkplanQuellen` (dazu externe Stellen mit Status und
Komponenten der Skizze, LFH-893): zugeordnete plus einsatzlokale
Sprechgruppen, nach `id` entdoppelt, TMO vor DMO. Fehlt eine Strukturquelle, steht „—“ bzw.
„unvollständig“ mit Grund, nie „keine“. Eigene `key` je `Datensicht` (zwei Sichten in einer Datei).

**Kommunikationsplan S6** (LFH-848,
`openspec/changes/archive/2026-10-04-lfh-848-kommunikationsplan/design.md`): Unterroute
`stab/kommunikationsplan` (`kommunikationsplanPfad`), zweiter S6-Eintrag in `stab/unterseiten.ts`,
`useStabFreigabe` fail-closed. Gepflegt werden nur Stellen ohne eigenes Heim (Führungsfunktion aus
dem Katalog, Leitstelle, Behörde, Verbindungsperson, sonstige) mit Verbindungen (`src/stab/kommunikation.rs`,
zwei Tabellen, eine Funktion je Einsatz, FHP/FB je Bezeichnung); **Abschnitte und Einheiten werden
abgeleitet** (Kommunikationsmittel/Erreichbarkeit, Zeile führt zum Datensatz, keine zweite
Datenhaltung). Die Besetzung ist nur Nebentext, **Kontaktangaben des Personals kommen nie vor**.
Kern `stab/kommunikationsplan.ts`, Lücke „Leitstelle“ nur über `stab/luecken.ts`. `tel:` nur
Festnetz/Mobil, `mailto:` nur mit `@`. **Kein Lagebericht**, Druck ja (im Druck flach, ohne
Aktionsspalte). **Offline lesbar** als einziger Stab-Unter-Key in `LAGEBILD_OFFLINE`; ohne Netz
Bedienung gesperrt, nicht versteckt, Besetzung „nicht geladen“. Schreibantworten tragen den ganzen
Plan (`setQueryData`). Die eigene Führungsstelle fehlt, bis LFH-849 sie liefert.

**Checkliste Arbeitsaufnahme** (LFH-551,
`openspec/changes/archive/2026-09-30-lfh-551-stab-checkliste-arbeitsaufnahme/design.md`): unterstes
Paneel der Stabseite (`stab/ChecklistePaneel.tsx`), sieben feste Punkte als Code-Vorlage
(`stab/checkliste.ts` ↔ `ChecklistenPunkt::ALLE`), eigene Tabelle, lazy (ein Aufruf ohne Wirkung
legt keine Zeile an). `PUT …/stab/checkliste/{punkt}` mit Teilfeldern, jedes Bedienziel schickt
genau SEIN Feld. Kein ETB je Haken; nur `leitstelle_gemeldet` belegt Haken **und** Rücknahme (E1).
Mutation je Zeile und Bedienziel, überlappende Antworten über `useChecklistenAbgleich`.

**Vorbereitung der Lagebesprechung** (LFH-550, `stab/VorbereitungPaneel.tsx`, `stab/vorbereitung.ts`):
Paneel der Stab-Seite, rechnet keine Zahl selbst (Lagebild wie das Dashboard, Aufträge/Meldungen
vom Modulzähler), Quelle je Zeile, Rechteweiche je Quelle („—“ mit Grund, nie 0). Reihenfolge wie
das Dashboard, **kein Vortragsschema** (LFH-46 §2.3), nichts wird eingefroren; ein fester Stand
nur über „In Lagebericht übernehmen“ (EIN Aufruf, Freitext).

**Überfälliger Besprechungstermin** (LFH-859,
`openspec/changes/archive/2026-10-04-lfh-859-lagebesprechung-ein-warnton/design.md`): ein erreichter oder
verstrichener Termin trägt `achtung`, nie `alarm` (keine Gefahr, Alarmbudget EEMUA 191), mit dem
Wort „jetzt fällig“ bzw. „seit 5 min überfällig“. Ton und Wort nur aus
`stab/lagebesprechungZustand.ts:lagebesprechungUeberfaellig`; die Stab-Seite und die Marke
„Lagebesprechung“ der Fristenliste im Überblick (`markenBewertung`) lesen beide dort.
Überfällige Aufträge und Erinnerungen dort bleiben `alarm`, das „knapp“ unter 30 min bleibt der
Fristenliste.

**Presse und Medienarbeit S5** (LFH-554, `openspec/changes/archive/2026-09-30-lfh-554-presse-medienarbeit-s5/design.md`):
Unterrouten `stab/presse` (Presse-Log, Pressemitteilungen, Medienlage), `stab/presse/mitteilungen/:id`,
`stab/infotelefon`, kein Modul; Einstiege über `stab/unterseiten.ts`, jede Seite prüft
`useStabFreigabe` selbst (auch Funkplan). Die Pressemitteilung ist die dritte `Dokumentart`
(Snapshot, Fortschreibung, ETB `meldung`), **freigeben darf nur die Einsatzleitung**
(`EinsatzLeitungszugriff<Stab>`, Paar-Test gegen Lagebericht/Befehl), die Seite ist Zwilling von
`LageberichtDetailPage`. Personenbezug (Ansprechperson, Erreichbarkeit, Anrufer, Rückruf, Notiz)
und jeder Freitext des Presse-Logs (Medium, Thema, Antwort, Freigabeangabe; Linie A, LFH-901)
werden geschwärzt, `rueckruf` und `antwort` per `PlatzhalterWennGesetzt`; die Medienlage
(`stab/medienlage.ts`, „Aus S5 übernehmen“ im Lagevortrag, Quelle `stab/medienlageQuelle.ts` des
Übernahme-Bausteins,
`frontend/src/entwurf/AGENTS.md`) nimmt nie Namen, Nummern oder Thema. **Nicht offline**: die
Keys fehlen in `LAGEBILD_OFFLINE` (LFH-767). Informationstelefon: Vollliste mit eigener
Zufluss-Schleuse (`infotelefon/zufluss.ts`), Zählung aus derselben Menge (serverseitig LFH-862).
