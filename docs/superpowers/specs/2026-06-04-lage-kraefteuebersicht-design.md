# Kräfteübersicht — Meldebild der eingesetzten Kräfte (LFH-49)

**Teilprojekt:** 4 „Lage". Füllt das bislang nur als Platzhalter (`status: 'geplant'`)
geführte Modul `kraefteuebersicht` in `frontend/src/einsatz/modulRegistry.ts`. Sub-Task von
LFH-44 („Lage – Ausbau"), Geschwister von LFH-48 (Lageberichte, fertig).

**Kern in einem Satz:** Eine **reine Frontend-Aggregation** der vorhandenen K&M-Daten
(Einheiten / Personal / Fahrzeuge / Material) zu einem **lesenden, druckbaren Meldebild**,
gegliedert nach Einsatzabschnitten — **kein neuer Stamm, keine neue Tabelle, kein neuer
Backend-Endpunkt**.

**Unterbau (wiederverwendet, nicht neu gebaut):**
- Listen-Reads `listeEinheiten` / `listeEinsatzPersonal` / `listeEinsatzFahrzeuge` /
  `listeEinsatzMaterial` / `listeAbschnitte` (`frontend/src/api/*.ts`).
- Aufgelöste Typen mit fertigen Aggregaten: `Einheit.ist` / `Einheit.ist_kumuliert`
  (`Staerke` = F/UF/M), `status_kategorie` (`verfuegbar|gebunden|nicht_verfuegbar`) an
  Personal & Fahrzeug, `FahrzeugStatus.fms_anker` (0–9), `StaerkePosition`.
- Baum-Helfer-Muster `baueBaum` / `nachfahrenInkl` aus `EinsatzabschnittePage.tsx`.
- `useEinsatzLiveStream` (eine SSE-Verbindung pro Einsatz) für Live-Aktualisierung.
- Print-Ansicht + Print-CSS-Muster aus der Lagebericht-Druckansicht (LFH-48).
- Lagebericht-Anlage: bestehende `POST …/lageberichte` (Vorlage `freitext`) für die
  „In Lagebericht übernehmen"-Verknüpfung — **ohne Backend-Änderung**.
- Modul-Registry + „disabled statt versteckt"-Gate (`istModulGesperrt`).

---

## Ziel

Eine Führungskraft (oder mitschreibende Kraft im FüKw) liest auf **einer** Seite in Sekunden
ab: **Wie stark bin ich wo im Einsatz, und was ist frei / gebunden / nicht verfügbar?** Das
Meldebild ist nach der **Einsatzgliederung** (Abschnitte → Einheiten → Einzelmittel)
strukturiert, verdichtet oben zu einem **Stärkenachweis + Verfügbarkeitslage** und ist als
**Anlage zum Lagebericht druck-/PDF-fähig**.

## Abgrenzung (warum das kein Doppel ist)

| Modul | Modus | Was es liefert |
|---|---|---|
| **Einsatzabschnitte** | Editor (1 Abschnitt gewählt) | Gliederung *pflegen*; schlanke Einheiten-Liste je Auswahl |
| **Einheiten / Personal / Fahrzeuge / Material** | CRUD / Disposition | Ressource *pflegen*, Status setzen |
| **Lageberichte** (LFH-48) | strukturierte *Mitschrift* | manueller Lagevortrag; **bewusst keine** Auto-Aggregation |
| **Lage-Dashboard** (geplant) | breite Gesamtlage | verdichtete Kacheln über **alle** Module |
| **Kräfteübersicht** (dieser Task) | **lesendes Meldebild** | **alle** Abschnitte gleichzeitig, tiefe kräfte-spezifische Aggregation + Verdichtung, druckbar |

Die Achse „nach Abschnitt" teilt sich die Kräfteübersicht mit dem Abschnitte-Editor, aber
Zweck und Inhalt sind andere: read-only statt editieren, **alle** Abschnitte statt einer,
**Status-/FMS-Verdichtung + Soll/Ist** statt nur Stärke-Tag, druckbar. Das **Dashboard** zieht
später eine *Zusammenfassungs-Kachel* aus dieser Sicht (z. B. „53 Kräfte, 9 frei") — die
Kräfteübersicht ist der **tiefe Drill**, das Dashboard die *Breite*. Diese Beziehung ist
explizit, damit beim Dashboard-Bau nichts doppelt entsteht.

## Architektur in einem Satz

Parallele React-Query-Reads der fünf Listen → eine **pure, unit-testbare Aggregationsfunktion**
verschachtelt sie zu einem Abschnitts-/Einheiten-Baum mit Blatt-genauen Summen → eine
antd-`Table` mit `expandable` rows rendert das Meldebild, ein KPI-Kopf die Verdichtung.

## Scope-Entscheidungen (v1)

1. **Rein Frontend, keine Persistenz.** Aggregation aus den vorhandenen Listen-Endpunkten;
   kein neues Entity, keine Migration, kein Backend-Endpunkt. (Bestätigt durch die Datenlage —
   alle nötigen Felder sind in den aufgelösten Typen bereits da.)
2. **Layout A — aufklappbare Tree-Table.** KPI-Kopf + eine dichte, druckbare Tabelle
   Abschnitt → Einheit → Einzelmittel. (Gegen Board-/Master-Detail-Layouts: „alles auf einen
   Blick" + Druckbarkeit.)
3. **Volle Hierarchie, Summe rollt hoch.** Verschachtelte Abschnitte (`ueber_abschnitt_id`)
   **und** Einheiten (`ueber_einheit_id`) werden als Baum abgebildet; jede Ebene zeigt ihre
   kumulierte Stärke. Maßgeblich für Summen ist die **Blatt-Aggregation** (s. u.) — keine
   Doppelzählung.
4. **Zwei getrennte Verdichtungs-Achsen.** **Personalstärke** (F/UF/M, Köpfe) und
   **Fahrzeug-Verfügbarkeit** (FMS / Status-Kategorie) sind im Kopf *getrennt* ausgewiesen,
   nicht in eine Zahl gemischt. Material ist eine dritte, schlanke Zeile (Anzahl je
   Material-Status). Das entspricht der BOS-Lesart eines Meldebilds.
5. **Voller MVP** (vom Auftraggeber so gewählt): Live-SSE **+** Druck/PDF **+** Filter **+**
   Lagebericht-Verknüpfung sind alle in v1. Reihenfolge im Plan: Aggregation+Tabelle zuerst,
   dann Live, Druck, Filter, Verknüpfung — jede Stufe für sich lauffähig.
6. **Druck/PDF via Browser-Print.** Dedizierte Print-Ansicht + Print-CSS (wie Lageberichte),
   kein Server-PDF.
7. **Lagebericht-Verknüpfung ohne Backend-Change.** Ein Button „In Lagebericht übernehmen"
   rendert das aktuelle Meldebild als Markdown-Text und legt damit einen **Lagebericht-Entwurf**
   (Vorlage `freitext`) über die bestehende `POST …/lageberichte`-Route an; die Kraft redigiert
   ihn dort weiter. Das respektiert die Lagebericht-Philosophie (Mensch redigiert die
   Mitschrift) und braucht keine neue API.

## Aggregationslogik & die Stärkenachweis-Invariante

**Invariante (zugleich der zentrale Akzeptanztest):**
> Die Summe im KPI-Kopf zählt **jede eingesetzte Kraft genau einmal**. Personalstärke gesamt =
> Summe über *alle* `EinsatzPersonal`; Fahrzeug-/Material-Zahlen = Summe über *alle*
> `EinsatzFahrzeug` / `EinsatzMaterial` — unabhängig davon, ob zugeordnet oder nicht.

Daraus folgt das Aggregations-Verfahren (in einer puren Funktion
`baueKraeftebild(abschnitte, einheiten, personal, fahrzeuge, material)`):

- **Blatt-Aggregation, nicht Zwischensummen-Addition.** Gezählt wird ab den atomaren Listen
  (Personen, Fahrzeuge, Material), nicht durch Aufsummieren von `Einheit.ist_kumuliert` über
  den Baum — sonst Doppelzählung bei Untereinheiten. `Einheit.ist_kumuliert` dient nur als
  **Anzeige** am jeweiligen Einheiten-Knoten (vom Backend konsistent geliefert).
- **Zuordnungspfad jeder Kraft:** Person/Fahrzeug/Material → `einheit_id` → Einheit →
  `abschnitt_id` → Abschnitt (über die Abschnitts-Hierarchie hochrollend). Personalstärke je
  Person aus `staerke_position` (fuehrer/unterfuehrer/mannschaft; `null` zählt als Mannschaft,
  damit Köpfe stimmen — Festlegung).
- **Catch-all „Ohne Zuordnung".** Drei reale, erreichbare Zustände bekommen eine eigene,
  klar beschriftete Sammelgruppe am Ende des Baums:
  1. Einheit ohne Abschnitt (`abschnitt_id = null`) → eigener Pseudo-Abschnitt „Ohne
     Abschnitt" (Einheiten darin normal mit Mitteln).
  2. Personal/Fahrzeug/Material ohne Einheit (`einheit_id = null`) → Pseudo-Einheit
     „Ohne Einheit" im jeweiligen Abschnitt — bzw. unter „Ohne Abschnitt", wenn auch kein
     Abschnitt herleitbar.
  Diese Kräfte sind im Einsatz und **müssen** im Meldebild und in der Kopf-Summe erscheinen;
  sonst lügt der Nachweis.
- **Roll-up:** Abschnittsstärke = Summe der enthaltenen Einheiten-Blätter + direkt im Abschnitt
  hängender „Ohne Einheit"-Kräfte; Überabschnitt = Summe seiner Unterabschnitte. Kopf = Summe
  aller Abschnitte inkl. „Ohne Zuordnung". Test prüft: Kopf == Länge der jeweiligen Rohliste.

## UI — `frontend/src/pages/KraefteuebersichtPage.tsx`

- Modul-Registry: `kraefteuebersicht` von `status: 'geplant'` → `'fertig'`.
- **KPI-Kopf (Verdichtung):** drei Blöcke —
  (a) **Stärke** F/UF/M/Gesamt (Soll/Ist, wo Soll definiert),
  (b) **Fahrzeuge** nach Status-Kategorie (verfügbar / gebunden / nicht verfügbar; Tooltip mit
  FMS-Aufschlüsselung),
  (c) **Material** Anzahl je Status (einsatzbereit / im Einsatz / defekt …).
- **Tree-Table:** antd `Table` mit `expandable`, Spalten: Bezeichnung · Typ/Rolle · Stärke
  (F/UF/M) · Status. Zeilentypen:
  - *Abschnitt* (fett, kumulierte Stärke, Status-Verteilungs-Badges) — Default aufgeklappt.
  - *Einheit* (Typ-Label, Führer, `ist_kumuliert`, aggregierter Status) — Default eingeklappt
    auf Mittel-Ebene.
  - *Einzelmittel* (Fahrzeug mit FMS-Badge / Person mit Stärke-Position + Status / Material mit
    Menge+Status) — per Drill-down.
- **Statusfarben** aus `status_kategorie` (grün/gelb/rot, konsistent zu den K&M-Modulen);
  Fahrzeug zeigt zusätzlich den FMS-Anker.
- **Filterleiste (v1):** Abschnitt · Trägerorganisation · Status-Kategorie + Freitext-Suche;
  Filter wirken auf die Blattmenge, Summen rechnen sich mit (gefiltertes Meldebild). Leerer
  Filter = Vollbild.
- **Live:** Re-Fetch der fünf Queries bei Einsatz-SSE-Events über `useEinsatzLiveStream`
  (eine Verbindung; keine zusätzliche EventSource).
- **Druck:** Button „Drucken / als PDF" → dedizierte Print-Ansicht (alle Knoten aufgeklappt,
  Print-CSS) → Browser-Druckdialog.
- **Lagebericht-Verknüpfung:** Button „In Lagebericht übernehmen" → rendert Meldebild als
  Markdown → `POST …/lageberichte` (Vorlage `freitext`, Titel „Kräftemeldebild
  <Zeitstempel>") → Navigation in den neuen Entwurf.
- **Frontend ist ins Binary eingebettet** → nach Änderungen `pnpm build` + Backend-Neustart,
  sonst zeigt cargo-run das alte Bundle.

## Komponenten-/Datei-Struktur

- `frontend/src/pages/KraefteuebersichtPage.tsx` — Seite (Queries, Layout, Filter-State,
  Live-Anbindung, Druck-/Lagebericht-Aktionen).
- `frontend/src/kraefte/kraeftebild.ts` — **pure** Aggregation (`baueKraeftebild`, Stärke-/
  Status-Verdichtung, Markdown-Render) + Typen. Keine React-Abhängigkeit, voll unit-testbar.
- `frontend/src/kraefte/kraeftebild.test.ts` — Tests der Invariante & Verschachtelung.
- ggf. `frontend/src/pages/components/KraefteuebersichtKopf.tsx` für den KPI-Kopf, wenn die
  Seite sonst zu groß wird (Datei-Größe als Signal — splitten statt eine Riesendatei).
- Routing: `App.tsx` `MODUL_ELEMENTE['kraefteuebersicht'] = <KraefteuebersichtPage />`
  (lazy, analog der übrigen Modul-Seiten).

## Berechtigungen

Lesendes Modul: **keine** `benoetigteRolle` — Lesen für alle Einsatz-Rollen inkl. Beobachter,
wie die übrigen Lese-Reads. Die „In Lagebericht übernehmen"-Aktion erbt das Schreibrecht der
Lagebericht-Route (Führung/Einsatzleitung/Admin) und das Nachlauf-Gate — der Button ist sonst
deaktiviert. Kein neuer Cross-Org-Pfad (alle Reads sind bestehende, geprüfte Routen).

## Tests

- **Aggregation (pur, Kern):** Invariante (Kopf == Rohlisten-Längen) über mehrere Fälle:
  flach; verschachtelte Abschnitte; verschachtelte Einheiten (keine Doppelzählung);
  Einheit ohne Abschnitt; Personal/Fahrzeug/Material ohne Einheit; `staerke_position = null`;
  leerer Einsatz. Status-Verdichtung pro Kategorie. Markdown-Render deterministisch.
- **Frontend:** Tabelle rendert Abschnitt/Einheit/Mittel-Zeilen; Filter grenzt ein und Summen
  ziehen mit; Druck-Ansicht klappt alles auf; Lagebericht-Button ruft die Route mit gerendertem
  Text. localStorage-Polyfill (`src/test/setup.ts`); volle Suite ggf. `--no-file-parallelism`.

## Nicht-Ziele (v1)

- **Eigener Backend-Aggregations-Endpunkt / Caching** — erst wenn die Client-Aggregation bei
  großen Lagen messbar zu langsam ist (YAGNI).
- **Bearbeiten aus der Übersicht** (Status setzen, Umgliedern) — das bleibt in den
  Fachmodulen; die Kräfteübersicht ist read-only. Zeilen verlinken höchstens ins Fachmodul.
- **Lage-Dashboard** selbst — eigenes Modul; zieht später nur eine Kachel aus dieser Sicht.
- **Historie / Zeitverlauf** des Meldebilds — die Übersicht zeigt den Jetzt-Stand; ein
  fixierter Stand entsteht nur als Lagebericht-Anlage.
- **Soll-Stärke-Pflege** — Soll kommt aus Einheit/Typ wie bestehend; hier nur angezeigt.

## Offene Punkte / bewusste Festlegungen

- **`staerke_position = null` zählt als Mannschaft** — damit die Kopf-Köpfe == Personenanzahl
  bleiben (Invariante). Alternativ separate „o. A."-Spalte; bewusst gegen Mehrspaltigkeit
  entschieden.
- **Filter & Summen:** Summen folgen dem Filter (gefiltertes Meldebild), nicht dem Vollbestand —
  sonst widerspräche der Kopf der sichtbaren Tabelle. Vollbestand sieht man bei leerem Filter.
- **Material im Kopf** nur als Statuszählung (keine F/UF/M-Logik) — Material hat keine Stärke
  und keine Status-Kategorie, sondern ein festes 5-Werte-Enum.
