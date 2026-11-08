# Stab — Regeln

Gilt für `frontend/src/stab/`, `pages/StabPage.tsx`, die S5-Seiten (`pages/PressePage.tsx`, `pages/PressemitteilungDetailPage.tsx`, `pages/InfotelefonPage.tsx`, `presse/`, `infotelefon/`) und `src/stab/` (ohne Fernmeldewesen, siehe `frontend/src/fernmeldewesen/AGENTS.md`), `src/presse/`, `src/infotelefon/`, ergänzt `frontend/AGENTS.md`. Pfade relativ zu `frontend/src/`.

**Stab-Seite** (LLH-1124, `openspec/changes/archive/2026-10-13-o5nxgqbl-stab-uebersicht/design.md`): ein Raster aus
sechs Kacheln S1–S6 (`stab/SachgebietKachel.tsx`, eine Spalte unter `md`, zwei ab `md`, drei ab
`xl`, `stab/stabRaster.ts`), je ein `Paneel` mit `h2` „S4 · Versorgung“ (wirksames Label), Besetzung
als Chip und „Besetzung ändern“ im Kopf, gekürzter Aufgabenzeile mit nie gekürzter Fundstelle und
den Werkzeugen im Fugenraster (`stab/WerkzeugZelle.tsx`). Die Kachel selbst ist kein Ziel. Werkzeuge
nur aus `fuehrung/sachgebiete.ts` (Modul oder Unterseite aus `stab/unterseiten.ts`, **keine Grenze ihrer
Zahl**); ob eines fehlt, gesperrt mit Grund steht oder springt, entscheidet nur
`stab/werkzeuge.ts:werkzeugState`, für Module und Unterseiten gleich (ausgeblendet fehlt, gesperrt
steht). **Je Werkzeug höchstens eine Zahl, nur über `stab/werkzeugZahlen.ts` aus ihrer Heimat:**
Modulzähler wie im Modulmenü (`bildeZaehler`), Pressearbeit aus den Kennzahlen des Presse-Logs,
Funkplan aus `fernmeldewesen/luecken.ts:countLuecken` (über `stab/useFunkplanLuecken.ts`). Ohne Quelle keine
Zahl, fehlende Quelle „—“ mit Grund; die Seite zählt nie selbst. Den Besetzungsstand trägt der
Seitenkopf.

**Checkliste Arbeitsaufnahme** (LFH-551,
`openspec/changes/archive/2026-09-30-lfh-551-stab-checkliste-arbeitsaufnahme/design.md`): Paneel
unter dem Raster der Stabseite (`stab/ChecklistePaneel.tsx`); ist beim Öffnen alles erledigt, steht es
eingeklappt („7/7 erledigt“, „Aufklappen“), danach klappt nur die Person (LLH-1124, D6); sieben feste Punkte als Code-Vorlage
(`stab/checkliste.ts` ↔ `ChecklistenPunkt::ALLE`), eigene Tabelle, lazy (ein Aufruf ohne Wirkung
legt keine Zeile an). `PUT …/stab/checkliste/{punkt}` mit Teilfeldern, jedes Bedienziel schickt
genau SEIN Feld. Kein ETB je Haken; nur `leitstelle_gemeldet` belegt Haken **und** Rücknahme (E1).
Mutation je Zeile und Bedienziel, überlappende Antworten über `useChecklistenAbgleich`.

**Lagebesprechung** (LLH-1111): eigenes Modul, Regeln in `frontend/src/lagebesprechung/AGENTS.md`.
Die Stab-Seite trägt nur die Zeile „Nächste Lagebesprechung“ mit Sprung dorthin
(`lagebesprechung/LagebesprechungZeile.tsx`), weder Vorbereitung noch Abschluss noch Verlauf.

**Presse und Medienarbeit S5** (LFH-554, `openspec/changes/archive/2026-09-30-lfh-554-presse-medienarbeit-s5/design.md`):
Unterrouten `stab/presse` (Presse-Log, Pressemitteilungen, Medienlage), `stab/presse/mitteilungen/:id`,
`stab/infotelefon`, kein Modul; Einstiege über `stab/unterseiten.ts` (Stab-Seite, Sprungmarken und
Palette lesen dieselbe Tabelle, LLH-1127), jede Seite prüft
`useStabFreigabe` selbst. Die Pressemitteilung ist die dritte `Dokumentart`
(Snapshot, Fortschreibung, ETB `meldung`), **freigeben darf nur die Einsatzleitung**
(`EinsatzLeitungszugriff<Stab>`, Paar-Test gegen Lagebericht/Befehl), die Seite ist Zwilling von
`LageberichtDetailPage` und schreibt über `entwurf/DokumentEntwurf` (`frontend/src/entwurf/AGENTS.md`). Personenbezug (Ansprechperson, Erreichbarkeit, Anrufer, Rückruf, Notiz)
und jeder Freitext des Presse-Logs (Medium, Thema, Antwort, Freigabeangabe; Linie A, LFH-901)
werden geschwärzt, `rueckruf` und `antwort` per `PlatzhalterWennGesetzt`; die Medienlage
(`stab/medienlage.ts`, „Aus S5 übernehmen“ im Lagevortrag, Quelle `stab/medienlageQuelle.ts` des
Übernahme-Bausteins,
`frontend/src/entwurf/AGENTS.md`) nimmt nie Namen, Nummern oder Thema; ihre Kontaktzahlen und
Medien kommen aus `…/medienkontakte/kennzahlen` über den ganzen Bestand, nicht aus der
geladenen Liste (LFH-1075). Das Presse-Log lädt offene ganz, erledigte seitenweise; die Art
filtert im Servermodus der `Datensicht` (LLH-1096): die offenen filtert die Seite, die erledigten
der Server (`art=`, je Filter eine Kette unter dem Prefix `medienkontakteErledigt`), die Zahlen
kommen aus `je_art` der Kennzahlen. **Nicht offline**: die
Keys fehlen in `LAGEBILD_OFFLINE` (LFH-767). **Informationstelefon: Fenster und Zählung** (LLH-732,
`openspec/changes/archive/2026-10-13-w6hgfndx-infotelefon-zaehler/design.md`): die Liste lädt
immer seitenweise (`ANRUFE_PAGE_SIZE`, Cursor Eingang + Kennung, „Ältere laden“), „offene Rückrufe“
filtert am Server; Kennzahlen, Meta und „Nach Anliegen“ lesen nur `…/infotelefon/zaehler`, nie
das geladene Fenster, ebenso die Medienlage. Ein Deeplink außerhalb des Fensters holt den Anruf
einzeln (`…/infotelefon/{aid}`) und stellt ihn als ältesten oben dazu. Die Zufluss-Schleuse
(`infotelefon/zufluss.ts`) nimmt Seiten, die nach dem Einfrieren nachgeladen wurden, über
`extendEinfrierstand` auf, damit ein Nachtrag aus einer älteren Seite nicht als „neuer Anruf“ gilt.
**Informationstelefon in Funkprotokoll-Ordnung** (LLH-1149, Spec `stab-infotelefon`, Herleitung
`openspec/changes/archive/2026-10-17-gonnp1g8-etb-ux-durchgang/design.md` D10): dieselbe Leserichtung wie das ETB
(`etb/AGENTS.md`, „Funkprotokoll-Ordnung“) — ältester Anruf oben, jüngster unten über der
Erfassung, „Ältere laden“ über der Liste, das Sammelbanner unten; Öffnen am Ende, Mitlaufen und
Anker über `components/useFunkprotokollLauf.ts`, gekehrt wird erst in der Darstellung
(`funkprotokollFolge`). Hochgerollt friert die Schleuse ein wie bei Fokus in der Liste.
**Informationstelefon unter `md`** (LFH-1067): zuerst die Anrufe, nach dem Muster der ETB-Erfassung
(`etb/AGENTS.md`). Die Leiste startet eingeklappt (`AnrufErfassung einklappbar`: nur Anliegen und
„Erfassen“, solange der Fokus nicht in ihr liegt und das Formular leer ist), die Kennzahlen stehen
als Meta im Kopf, Segmentleiste und „Nach Anliegen“ (Knopf, klappt die Aufgliederung auf) als
Kopfaktionen, der Ortspfad erst ab `md` (`EinsatzSeite ortspfadAbMd`). Nachweis: zwei Anrufe ganz
über der Leiste auf 390 × 844 in jeder Dichte (`e2e/leisten-flaeche.spec.ts`).
