# LFH-27 — Objekt-Marker auf standardisierte taktische Zeichen (DV 102)

- **Datum:** 2026-06-24
- **Status:** Design freigegeben
- **Branch:** `feat/lfh-27-taktische-zeichen-marker`
- **Task:** [LFH-27](https://app.clickup.com/t/86ca1vhrh) (Epic [LFH-56](https://app.clickup.com/t/86ca33mdd))

## Kontext

Die ursprüngliche LFH-27-Spec verlangte „per-Typ-SVG-Marker" (z. B. Stern für Einsatzort,
Kreuz für UHS, Warn-Dreieck für Schaden). Inzwischen nutzt das Projekt (L-2, „taktische
Gliederung") **standardisierte DV-102-Zeichen** über die Library `taktische-zeichen-react@0.10`
für **Einheit / Fahrzeug / Führung / Abschnitt** — abgeleitet in `taktischesZeichen.ts`
(`baueTzProps`) und gesetzt in `marker.ts` (`baueTaktischeMarker`).

**Noch nicht umgestellt** sind die übrigen objekt-gebundenen Marker, die `baueMarker` /
`baueLageMeldungMarker` erzeugen — **Einsatzort, UHS, Schaden, Lagemeldung** rendern weiterhin
als einfarbige Kreise (kein `tz`).

Dieses Design ersetzt diese Kreise (außer Lagemeldung) durch **standardisierte taktische
Zeichen** statt durch frei gestaltete Stern-/Kreuz-/Dreieck-SVGs.

## Ziel & Akzeptanzkriterien

- Einsatzort / UHS / Schaden sind auf der Karte **ohne Farbwahrnehmung** unterscheidbar
  (Form trägt Bedeutung).
- Es werden **standardisierte DV-102-Zeichen** (Vokabular aus `taktische-zeichen-core`)
  verwendet, keine Ad-hoc-SVGs.
- `Kartenflaeche` bleibt die **einzige** MapLibre-Stelle; Marker-Klick und Inspector
  funktionieren unverändert.

## Mapping (real gerendert & verifiziert)

Alle Zeichen wurden aus `taktische-zeichen-core@0.10` gerendert und visuell geprüft.

| Marker | Grundzeichen | + Fachaufgabe / Symbol | Farbe |
|---|---|---|---|
| **Einsatzort** (id:0) | `anlass` (offenes „V") | — | neutral (Default) |
| **Schaden** | `gefahr` (Dreieck) | — | `farbe` = Ausmaß |
| **UHS** `behandlungsplatz` | `stelle` (Kreis) | Fachaufgabe `aerztliche-versorgung` | neutral |
| **UHS** `patientenablage` | `stelle` | Symbol `sammelplatz-betroffene` | neutral |
| **UHS** `verletztensammelstelle` | `stelle` | Symbol `sammeln` | neutral |
| **UHS** `sonstige` | `stelle` | Fachaufgabe `rettungswesen` | neutral |
| **Lagemeldung** | — (bleibt Kreis) | — | `LAGEMELDUNG_FARBE` (unverändert) |

**Schaden-Färbung:** Ein einziges Grundzeichen `gefahr`; das Ausmaß steuert ausschließlich die
`farbe` (Wiederverwendung der bestehenden `AUSMASS_FARBE`-Map:
`gering`→grün, `mittel`→amber, `gross`→orange, `katastrophal`→rot). Die Library färbt das
gesamte Zeichen über `farbe` (verifiziert). Das Dreieck trägt die Bedeutung auch ohne Farbe.
Bewusst **nicht** `gefahr`/`gefahr-akut`/`gefahr-vermutet` — diese kodieren *Gewissheit*
(vermutet → akut), nicht *Schwere*, und passen weder semantisch noch in der Kardinalität auf
das 4-stufige Ausmaß.

**Einsatzort = `anlass`:** das DV-102-Zeichen für den Einsatz-/Schadensanlass — semantisch
genau der Einsatzort. `befehlsstelle` ist bereits der Abschnitt (Kollision) und scheidet aus.

**Eindeutigkeit der Formen:** Einsatzort (V) · Schaden (Dreieck) · UHS (Kreis + Sanitäts-Overlay)
sind untereinander und gegenüber dem Bestand verschieden — Einheit (Rechteck +
Größenpunkte), Fahrzeug (Rechteck auf Rädern), Führung (Raute), Abschnitt (Befehlsstelle-
Rechteck mit Mast). Damit ist das Akzeptanzkriterium rein über die Form erfüllt.

## Architektur

Minimaler Eingriff, dem bestehenden Muster folgend. **Kein Backend, keine Migration, keine
neuen DB-Felder** — alle nötigen Daten (`uhs.typ`, `schaden.ausmass`) sind bereits an den
geladenen Objekten vorhanden.

### `frontend/src/pages/lagekarte/taktischesZeichen.ts` (pure, getestet)

- `TzProps` wird erweitert auf `Pick<TZSpec, 'grundzeichen' | 'organisation' | 'fachaufgabe' |
  'einheit' | 'symbol' | 'farbe'>`. `symbol` und `farbe` sind Teil der Library-Spec
  (`TaktischesZeichen`) und fließen ohne Renderer-Änderung durch `erzeugeTaktischesZeichen`.
- Drei neue, reine Mapper:
  - `einsatzortTz(): TzProps` → `{ grundzeichen: 'anlass' }`
  - `schadenTz(ausmass: Ausmass): TzProps` → `{ grundzeichen: 'gefahr', farbe: AUSMASS_FARBE[ausmass] }`
  - `uhsTz(typ: UhsTyp): TzProps` → `{ grundzeichen: 'stelle', … }` per Record über die vier `UhsTyp`-Werte.
- Die `AUSMASS_FARBE`-Konstante zieht nach `taktischesZeichen.ts` (einzige Quelle). `marker.ts`
  bezieht die Schaden-Farbe aus dem von `schadenTz` gelieferten `tz.farbe` und importiert die
  Tabelle nicht mehr direkt — keine duplizierte Farbtabelle.

### `frontend/src/pages/lagekarte/marker.ts`

- `baueMarker` setzt für Einsatzort/UHS/Schaden jetzt `tz` (über die neuen Mapper) zusätzlich
  zur bestehenden `farbe` (die `farbe` bleibt als harmloser Fallback erhalten; im `tz`-Pfad
  ignoriert sie der Renderer).
  - Einsatzort: `tz: einsatzortTz()` (`farbe` bleibt `EINSATZORT_FARBE`)
  - UHS: `tz: uhsTz(u.typ)` (`farbe` bleibt `UHS_FARBE`)
  - Schaden: `const tz = schadenTz(s.ausmass)` → `tz` setzen und `farbe: tz.farbe`
- `baueLageMeldungMarker` bleibt unverändert (kein `tz`).

### `frontend/src/pages/lagekarte/Kartenflaeche.tsx`

- **Keine Änderung.** Der bestehende `if (mk.tz)`-Zweig rendert bereits via
  `erzeugeTaktischesZeichen(mk.tz)` als `<img>`. Schaden-Färbung läuft künftig über `tz.farbe`
  statt über den Kreis-Zweig.

## Datenfluss

```
LagekartePage
  → baueMarker(einsatz, uhsListe, schaeden)         // marker.ts
      → einsatzortTz() / uhsTz(u.typ) / schadenTz(s.ausmass)   // taktischesZeichen.ts (pure)
      → KarteMarker.tz = TzProps
  → <Kartenflaeche markers=… />
      → if (mk.tz) erzeugeTaktischesZeichen(mk.tz) → <img>      // unverändert
```

`LagekartePage` ruft `baueMarker` heute schon mit genau diesen Argumenten auf — **keine
Signatur-Änderung** nötig (Org-Default ist für diese drei Typen nicht erforderlich; sie sind
nicht org-gebunden).

## Tests (TDD)

Erweiterung der bestehenden Suiten — keine neuen Dateien.

- **`taktischesZeichen.test.ts`**
  - `einsatzortTz()` → `grundzeichen: 'anlass'`.
  - `schadenTz(ausmass)` für alle vier Ausmaße → `grundzeichen: 'gefahr'` + korrekte `farbe`.
  - `uhsTz(typ)` für alle vier `UhsTyp` → korrektes `grundzeichen`/`fachaufgabe`/`symbol`.
- **`marker.test.ts`**
  - `baueMarker`: Einsatzort/UHS/Schaden-Marker haben jetzt `tz` (mit erwartetem
    `grundzeichen`); Schaden-`tz.farbe` entspricht dem Ausmaß.
  - `baueLageMeldungMarker`: weiterhin **kein** `tz`.

## Verifikation jenseits der Unit-Tests

- `pnpm lint` (`--max-warnings 0`), `tsc --noEmit` (Typecheck-Gate), Vitest-Lauf der
  lagekarte-Suite (`--no-file-parallelism`).
- **Visueller Smoke-Test** im echten App-Bundle (Vite 8 = Rolldown; jsdom rendert kein echtes
  SVG): Einsatzort/UHS/Schaden auf der Lagekarte ansehen — die drei neuen Formen müssen
  erkennbar und voneinander/vom Bestand unterscheidbar sein.

## Nicht in LFH-27 (Folge-Tasks via `/clickup-task-anlegen`)

- **Freier TZ-Editor:** taktische Zeichen ohne dahinterliegendes Objekt platzieren
  (neue Tabelle/SSE/Auswahl-UI).
- **OPTA-/Fahrzeugtyp-Ableitung:** Fahrzeug-Zeichen aus OPTA bzw. Fahrzeugtyp verfeinern
  (heute nur abgeleitete Organisation, generisches Kfz-Grundzeichen).
- **Feste Personen-Zeichen:** taktische Zeichen für Personal über die Führungskräfte hinaus
  (Funktion/Dienstgrad).
- **Dezentes Clustering:** GeoJSON-Cluster-Source statt DOM-Marker (zweite, „optional/folgend"
  markierte Hälfte der ursprünglichen LFH-27-Spec). Kollidiert mit dem heutigen DOM-Marker- +
  Status-Ring- + Klick-Rendering und ist bei den aktuellen Marker-Zahlen wenig wert.
