## Context

Motivation und Schnitt: `proposal.md`. Bestand aus LLH-1596
(`openspec/changes/archive/2026-11-08-om9oxxiq-kontextmenue-baustein/design.md`):

- `components/useKontextMenue.ts` liefert je Fläche eine Fabrik `ausloeser(schluessel)` mit den
  Handlern für Rechtsklick, langen Druck und Tasten. `components/KontextMenue.tsx` zeigt
  `MenueEintrag[]` über `menueEintraege()` in `PunktankerMenue` am Fensterpunkt. Ein Wächter
  (`kontextMenue.guard.test.ts`) verbietet eigenes `onContextMenu`.
- `etb/EtbZeitachse.tsx`: Die Zeile `EtbZeitachsenZeile` ist `memo` und bekommt nur stabile
  Aufrufer (`aufrufe` über eine Ref, LFH-947). Ihre ⋮-Einträge baut sie in `aktionen()` inline,
  die Knöpfe einer abgelehnten Zeile ebenso. `Zeitachseneintrag` reicht übrige Props an das `li`
  durch. Die Achse friert ein, solange der Fokus in ihr liegt (`betreten`/`verlassen`, ein Menü im
  Portal zählt nicht als Verlassen).
- `etb/MetaChip.tsx`: ein `Tag` mit Text-Schnellweg (Klick = Bearbeiten) und `MenueAusloeser`
  aus `CHIP_MENUE` bzw. `CHIP_MENUE_STANDARD`; im Bearbeiten-Zustand ein Eingabefeld ohne `Tag`.

## Goals / Non-Goals

**Goals:**

- ⋮, Knöpfe und Kontextmenü einer ETB-Zeile und eines Chips aus je einer Funktion.
- Die gemerkte Zeile bleibt gemerkt: ein Rechtsklick rendert keine andere Zeile neu.

**Non-Goals:**

- Keine neuen Aktionen, keine Rückfrage beim Verwerfen.
- Lagemeldungen (`pages/LagemeldungenPage.tsx`) und Bündelzeilen bekommen kein Kontextmenü.
- Keine Änderung am langen Druck der `Datensicht` und der Skizze.

## Decisions

### D1 Schalter `langerDruck` am Hook

`KontextMenueOptionen` bekommt `langerDruck?: boolean` (Vorgabe `true`). Bei `false` kehrt
`onPointerDown` sofort zurück: kein Zeitgeber, kein `data-kontext-druck`, kein Riegel, und das
native `contextmenu` am Touchgerät läuft durch `onContextMenu` wie ein Rechtsklick. Damit es dort
nicht doch ein Menü öffnet, prüft `onContextMenu` bei `langerDruck: false` den Zeigertyp des
letzten `pointerdown` (`touch`/`pen` ⇒ Browsermenü). Beide ETB-Flächen setzen `false`.

*Alternative:* den Hook im ETB nur mit Rechtsklick und Tasten selbst nachbauen. Verworfen: Der
Wächter verbietet es zu Recht, und die Fallen (Tasten-Nachlauf, Portal-Aufsteigen) kämen zurück.

### D2 Eine Quelle je Zeilenart: `etb/zeilenAktionen.ts`

Neues Modul mit zwei reinen Funktionen:

- `eintragMenue(rechte)` → `MenueEintrag<'berichtigen' | 'wiedervorlage' | 'auftrag'>[]` aus
  `kannBerichtigen`, `berichtigenGesperrt`, `kannWiedervorlage`, `kannAuftrag`,
  `auftragGesperrt`, genau wie bisher inline in `aktionen()`.
- `abgelehntAktionen(puffer, nurProtokollierenAngeboten)` →
  `MenueEintrag<'erneut' | 'nurProtokollieren' | 'verwerfen'>[]`, „Verwerfen“ mit `gefahr`.

Das ⋮ (`MenueAusloeser`), die Knöpfe der abgelehnten Zeile (je Eintrag ein `Button`, `danger`
aus `gefahr`) und das Kontextmenü lesen dieselbe Liste; die Wahl läuft über eine gemeinsame
Funktion `fuehreZeilenWahlAus(z, key, aufrufe)`. So kann kein Eintrag nur an einem Ort stehen.

*Alternative:* die Knöpfe stehen lassen und nur das Menü aus einer neuen Liste bauen. Verworfen:
zwei Listen für dieselben Wege.

### D3 Ein Hook und ein Menü je Zeitachse

`EtbZeitachse` ruft `useKontextMenue<string>` mit dem Zeilenschlüssel (`z.schluessel`) und hält
`{ schluessel, offen } | null`. Die Fabrik ist stabil (`useCallback` im Hook) und geht als Prop an
die gemerkte Zeile, die ihre Handler an `Zeitachseneintrag` spreizt, nur wenn sie Einträge hat
(vorgemerkt: keine Handler, Browsermenü). `kannOeffnen`/`onOeffnen` lösen den Schlüssel über eine
Map der sichtbaren Zeilen auf und bauen die Einträge mit D2; leer ⇒ `false`. Das Menü sucht seine
Zeile im Render; verschwindet sie oder wird die Liste leer, schließt es (abgeleiteter Zustand wie
in `Datensicht`). Die Bündelzeile bekommt keine Handler.

*Alternative:* Hook je Zeile. Verworfen: je Zeile eigene Hörer am `window`, und das Design des
Bausteins sieht einen Hook je Fläche vor.

### D4 Einfrieren über den Fokus

`KontextMenue` wird innerhalb der Wurzel der Zeitachse gerendert. React lässt den Fokus aus dem
Portal (`autoFocus` des Menüs) durch den Komponentenbaum aufsteigen; `betreten` friert die Achse
ein wie bei jedem Fokus in ihr. Beim Schließen geht der Fokus an das Ursprungselement zurück oder
fällt heraus; `verlassen` taut wie bisher auf. Zusätzlich friert `onOeffnen` sofort ein, denn der
Fokus kommt erst einen Commit später ins Menü, und ein Eintrag dazwischen verschöbe die Zeile.

### D5 MetaChip: Hook im Chip

`MetaChip` ruft `useKontextMenue` selbst (höchstens vier Chips je Erfassung) mit
`langerDruck: false` und spreizt die Handler an den `Tag`. Die Einträge kommen aus derselben
Funktion wie das ⋮ (`chipMenue(ausStandard, onStandardAendern)`); bei `gesperrt` stehen alle
gesperrt im Menü (der ⋮-Auslöser ist dann gesperrt). Die Wahl läuft über denselben `onWahl`. Im
Bearbeiten-Zustand rendert der Chip keinen `Tag` und damit keine Handler.

*Alternative:* ein Hook in `Schnellerfassung` für alle Chips. Verworfen: mehr Durchreichen für
vier Elemente, ohne Gewinn.

## Risks / Trade-offs

- [Am Tablet öffnet ein langer Druck im ETB kein Menü, anders als in Listen.] → Abgestimmte
  Abwägung zugunsten des Markierens; Anwenderdoku nennt es, das ⋮ bleibt.
- [Rechtsklick auf Eintragstext ersetzt das Browsermenü („Kopieren“ ohne Markierung).] → Auf
  markiertem Text und Links bleibt es (D2 aus LLH-1596).
- [Die gemerkte Zeile bekommt eine neue Prop.] → stabile Fabrik; der Render-Test
  (`EtbZeitachse.render.test.tsx`) belegt, dass ein neuer Eintrag nur seinen Text parst.

## Migration Plan

Reines Frontend. Rücknahme durch Revert des PRs.
