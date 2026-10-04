# Stab — Regeln

Gilt für `frontend/src/stab/`, `pages/StabPage.tsx`, `pages/FunkplanPage.tsx`, die S5-Seiten (`pages/PressePage.tsx`, `pages/PressemitteilungDetailPage.tsx`, `pages/InfotelefonPage.tsx`, `presse/`, `infotelefon/`) und `src/stab/`, `src/presse/`, `src/infotelefon/`, ergänzt `frontend/AGENTS.md`. Pfade relativ zu `frontend/src/`.

**Funkplan S6** (LFH-548, `openspec/changes/archive/2026-09-30-lfh-548-funkplan/design.md`):
Unterroute `stab/funkplan` (`funkplanPfad`), kein Modul, Einstieg in der S6-Zeile; die Seite
prüft die Stab-Freigabe selbst (ihre Listen hängen an anderen Modulen). Abgeleitet im Client aus
Abschnitten, Einheiten, Fahrzeugen, Personal, Sprechgruppen (`stab/funkplan.ts`), kein Endpunkt;
jede Liste mit eigener Weiche (`api/abrufZustand.ts`), fehlend = „—“ mit Grund. Lücken nur über
`stab/luecken.ts` (auch für ST6). Erreichbarkeit: Schirm ab `xl`, Druck immer (`useDruckModus`),
Lagebericht nie. Eigene Gegenstelle fehlt als benannte Lücke (LFH-849).

**Fernmeldeskizze** (LFH-625, `openspec/changes/archive/2026-10-01-lfh-625-fernmeldeskizze/design.md`): zweite
Darstellung des Funkplans („Tabelle | Skizze“, `?ansicht=skizze` apply-then-clean), kein Modul,
keine Route. Modell `stab/fernmeldeskizze.ts` nur über `baueFuehrungsorganisation` (kein dritter
Baum), Funkangaben über dieselben Funktionen wie `baueFunkplan`; Darstellung
`stab/FernmeldeskizzeBild.tsx` über das Gerüst `components/organigramm/HaengenderBaum`. Die
Kante (gemeinsame Sprechgruppe zur übergeordneten Stelle) und ihre Lücke nur über
`verbindungsurteil` in `stab/luecken.ts`; „ohne Urteil“, wenn einer Seite jede Sprechgruppe fehlt.
Keine Leitung, Stärke, Erreichbarkeit, keine Fahrzeuge; keine eigene Übernahme, eine Druckwurzel
mit Druckkopf je Darstellung, getrennte Klappmengen.

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
wird geschwärzt, `rueckruf` per `PlatzhalterWennGesetzt`; die Medienlage (`stab/medienlage.ts`,
„Aus S5 übernehmen“ im Lagevortrag) nimmt nie Namen, Nummern oder Thema. **Nicht offline**: die
Keys fehlen in `LAGEBILD_OFFLINE` (LFH-767). Informationstelefon: Vollliste mit eigener
Zufluss-Schleuse (`infotelefon/zufluss.ts`), Zählung aus derselben Menge (serverseitig LFH-862).
