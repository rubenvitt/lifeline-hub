# Design

## Context

Die Motivation steht in `proposal.md` unter „Why“, die Anforderungen in
`specs/modul-freigabe/spec.md`.

**Stand Backend** (`src/einsatz/berechtigung.rs`):

- `fordere_modul_zugriff(overrides, org_defaults, key, benutzer)` prüft in dieser Reihenfolge:
  System-Admin ist frei, ein nicht ausblendbares Modul ist frei, Override `sichtbar=false` ergibt
  403. Danach gilt die Rolle `effektive_modul_rolle(override, org_default)`. Ein Override ohne
  Rolle fällt auf die Org-Vorgabe zurück und kann sie also **nicht** lockern.
- `erlaubte_module` wertet dieselbe Funktion über `MODUL_KEYS` aus. Es filtert den Live-Feed und
  die Modulzähler.
- Die Modul-Gates der Listen-Endpunkte laufen über `fordere_modul_zugriff_laden` im Extractor
  `EinsatzLesezugriff<M>`.

**Stand Frontend** (`frontend/src/einsatz/modulRegistry.ts`):

- `istModulSichtbar(modul, overrides)` liest `overrides[key].sichtbar`.
- `istModulGesperrt(modul, benutzer, overrides)` rechnet `override.benoetigte_rolle ??
  registry.benoetigteRolle`. Die Org-Vorgabe fehlt, und kein Registry-Eintrag setzt
  `benoetigteRolle`.
- `istModulFreigegeben` ist `fertig && sichtbar && !gesperrt`, `istKeyFreigegeben` dasselbe über
  den Key. `erstesFreigegebenesModul` liefert den Rail-Sprung.
- Rund 20 Konsumenten laden dafür `ladeModulOverrides` unter `einsatzKeys.modulOverrides`
  (`NICHT_LIVE_KEYS`, Teil von `LAGEBILD_OFFLINE`). Fehlen die Overrides, gilt heute alles als
  frei. Die Lagekarte (`useLagekarteDaten.ts`) lädt Unfallhilfsstellen, Schäden, Einheiten,
  Fahrzeuge, Abschnitte, Gefahrengebiete, Lagemeldungen und Rückmeldungen **ohne** Modulprüfung.
  Nur „Betroffene“ und „Betreuungsstellen“ haben eine Grenze (`personenEbene.ts`,
  `betreuungEbene.ts`).

## Goals / Non-Goals

**Goals:**

- Eine Auswertung der Modulregel, im Backend. Der Client übernimmt ihr Ergebnis.
- Die bisherige Bedienwirkung des Gates bleibt für alle Fälle erhalten, die der Client schon
  richtig sah: ausgeblendet heißt unsichtbar, gesperrt heißt Schloss, und Admins sehen
  ausgeblendete Module ebenfalls nicht in der Navigation.
- Kartenquellen eines nicht freigegebenen Moduls werden nicht angefragt und nicht als Ausfall
  gemeldet.

**Non-Goals:**

- Keine Änderung, **wer** worauf zugreifen darf. Server-Gates, Live-Filter und Zähler bleiben
  in ihrer Wirkung gleich.
- Kein Live-Ereignis für Freigaben. Ändert ein anderer Benutzer einen Override, sieht man das wie
  heute erst beim nächsten Abruf. Das 403-Netz der Seiten bleibt.
- Kein Routen-Wächter für Deeplinks in ein gesperrtes Modul. Die Modulseite antwortet dort wie
  heute mit ihrem eigenen 403-Zustand.
- Die Org-Vorgaben bleiben für normale Mitglieder unlesbar.

## Decisions

### D1 — Eigener Endpunkt `GET /api/einsaetze/{id}/modul-freigaben` (Weg A)

Die Antwort ist eine Map von Modul-Key auf `ModulFreigabe { sichtbar: bool, zugriff: bool }`.
Sie enthält jeden Key aus `MODUL_KEYS`. Der Extractor ist `EinsatzLesezugriff` (`OhneModul`),
und `PFAD_KEY` bekommt einen Eintrag mit `None`, wie `modul-zaehler`.

Verworfene Alternativen:

- **B — `modul-overrides` um die effektive Rolle anreichern.** Der Editor „Einsatz › Module“
  liest dieselbe Antwort als Rohdaten zum Bearbeiten. Eine eingemischte Org-Vorgabe sähe dort wie
  ein Einsatz-Override aus und würde beim Speichern festgeschrieben.
- **C — Org-Vorgaben für Mitglieder lesbar machen.** Dann rechnet der Client die Regel weiter
  nach. Genau diese zweite Kopie ist die Ursache des Fehlers, und jede künftige Regeländerung
  müsste wieder an zwei Stellen landen.
- **D — nur die Menge `erlaubte_module` als Liste.** Sie unterscheidet „ausgeblendet“
  (unsichtbar) nicht von „gesperrt“ (Schloss). Außerdem sind für einen Admin alle Module
  erlaubt, auch ausgeblendete, und die Navigation zeigte sie dann wieder an. Man bräuchte
  daneben weiter die Overrides, also wieder zwei Quellen.

### D2 — Eine reine Funktion trägt Gate, Menge und Endpunkt

Neu ist `modul_freigabe(overrides, org_defaults, key, benutzer) -> ModulFreigabe`:

- `zugriff` ist genau die bisherige Entscheidung von `fordere_modul_zugriff`. Deren Rumpf zieht
  um, und `fordere_modul_zugriff` wird zu `if modul_freigabe(...).zugriff { Ok } else
  { Forbidden }`.
- `sichtbar` ist `!ist_ausblendbar(key) || override.sichtbar != false` und hängt **nicht** vom
  Admin ab (Spec, „Sichtbarkeit ist eigene Angabe“). So bleibt das heutige Client-Verhalten
  erhalten, denn `istModulSichtbar` kennt keinen Admin.
- `erlaubte_module` filtert auf `zugriff`, der neue Endpunkt mappt über alle Keys. Beide laden
  Overrides und Org-Vorgaben einmal. Das Laden wandert in eine gemeinsame Hilfsfunktion, damit es
  kein zweites Lade-Muster gibt.

Die bestehenden Tests von `fordere_modul_zugriff` bleiben unverändert grün. Sie sind die
Charakterisierung dafür, dass `zugriff` nichts lockert.

### D3 — Client-Gate über `ModulFreigaben`, ohne `benutzer`

`ModulFreigaben = Record<string, ModulFreigabe>` kommt aus dem Typ-Codegen.
`ladeModulFreigaben(id)` lädt unter `einsatzKeys.modulFreigaben(id)`, Wire-Prefix
`einsatz-modul-freigaben`. Neue Signaturen:

- `istModulSichtbar(modul, freigaben)`: `freigaben?.[key]?.sichtbar !== false`. Der Client behält
  den Schutz der nicht ausblendbaren Module nicht als eigene Regel, der Server liefert dort
  `true`.
- `istModulGesperrt(modul, freigaben)`: `freigaben?.[key]?.zugriff === false`.
- `istModulFreigegeben(modul, freigaben)`: `fertig && freigaben bekannt && sichtbar && zugriff`.
  **Unbekannt heißt nicht freigegeben.** Das ist die Grenze für Datenabrufe (Spec, „Keine Anfrage
  an ein nicht freigegebenes Modul“).
- `istKeyFreigegeben` und `erstesFreigegebenesModul` entsprechend.

`benutzer` fällt aus allen Signaturen, denn der Server kennt den Admin. Das Registry-Feld
`benoetigteRolle` fällt weg (`BenoetigteRolle` bleibt als Typ für die Editoren). Der Typ-Checker
findet jede Aufrufstelle, und ein vergessener Konsument kann nicht still auf den alten Overrides
weiterlaufen.

Die Navigation (`ModulPanel`) zeigt Module, solange die Freigaben unbekannt sind, wie heute
ungesperrt und sichtbar (`istModulSichtbar`/`istModulGesperrt` liefern bei `undefined` „sichtbar,
nicht gesperrt“). Sonst blinkte jedes Modul beim Öffnen kurz als gesperrt. Ein Klick in dieser
Lücke führt höchstens auf den 403-Zustand der Modulseite, wie heute.

### D4 — Kartenquellen hinter der Modulgrenze

`useLagekarteDaten` setzt für jede modulgebundene Live-Quelle `enabled: liveAn && frei(key)`.
Ein gesperrtes Modul liefert keine Rohdaten und keinen Eintrag im Ausfallhinweis. Die Zuordnung
folgt `PFAD_KEY`:

| Quelle | Modul |
|---|---|
| UHS | `unfallhilfsstellen` |
| Schäden | `schaeden` |
| Einheiten | `einheiten` |
| Fahrzeuge | `fahrzeuge` |
| Abschnitte | `einsatzabschnitte` |
| Gefahrengebiete | `gefahrenzonen` |
| Lagemeldungen | `lagemeldungen` |
| Rückmeldungen | `meldungen` |
| Zonen, freie Zeichen, Führungskräfte | `lagekarte` (die Seite selbst, kein eigenes Gate) |

`personenZugriffVon`/`betreuungZugriffVon` lesen die Freigaben statt Overrides und Benutzer.
`rechteBekannt` wird „Freigaben liegen vor“, und der 403-Abfang bleibt als Netz. Der Satz
„Strukturelle Lösung: LFH-669“ in `personenEbene.ts` wird ersetzt. Die Regel bekommt eine
Zeile in `frontend/src/pages/lagekarte/AGENTS.md`. Der Historien-Modus bleibt unberührt, denn
Schnappschüsse kommen aus dem Dokument.

### D5 — Query-Key, Live und offline

- `modulFreigaben` steht in `NICHT_LIVE_KEYS`, mit derselben Begründung wie `modulOverrides`.
- In `LAGEBILD_OFFLINE` ersetzt `modulFreigaben` den Key `modulOverrides` (Rahmen „Freigaben“).
  Ohne Netz braucht die Lagekarte die Freigaben, sonst lädt sie nach D3 nichts. Die Overrides
  liest danach nur noch der Editor, ein Einstellungs-Key, und der kommt ausdrücklich nicht auf die
  Platte. `lagebildOffline.guard.test.ts` erzwingt die Entscheidung.
- Invalidierung: `EinsatzModule.tsx` invalidiert nach dem Setzen zusätzlich
  `einsatzKeys.modulFreigaben(id)`. `EinsatzDefaults.tsx` invalidiert nach einer Org-Vorgabe den
  argumentlosen Prefix `einsatzKeys.modulFreigaben()`, weil alle Einsätze der Org betroffen sind.
  Gibt es den argumentlosen Accessor noch nicht, wird er nach der Sub-Key-Regel in
  `frontend/AGENTS.md` angelegt.

### D6 — Typ-Codegen

`ModulFreigabe` bekommt `#[derive(Serialize, ToSchema)]` mit zwei Pflicht-Booleans. Die Antwort
ist `HashMap<String, ModulFreigabe>` mit `utoipa`-Pfad in `src/api_doc.rs`. Danach laufen
`scripts/check-typ-codegen.sh` und der Commit beider generierten Dateien. Ein Enum entsteht
nicht, es gibt also keinen Eintrag im Enum-Wire-Kontrakt.

## Risks / Trade-offs

- **Ein zusätzlicher Request beim Öffnen eines Einsatzes.** Er ersetzt den Overrides-Request in
  allen Konsumenten außer dem Editor. Die Zahl der Requests bleibt also gleich, und die Kosten
  sind zwei indizierte Reads mit je höchstens 31 Zeilen.
- **Ladelücke: Kartenquellen starten später** (erst nach den Freigaben). Das ist ein Roundtrip
  mehr bis zum ersten Marker. Er ist gewollt, denn genau das verlangt die Akzeptanz („kein
  Request“). Die Freigaben liegen meist schon im Cache, weil der Rahmen sie lädt.
- **Fehler beim Abruf der Freigaben** → Datenkonsumenten laden nichts, die Navigation bleibt
  bedienbar. Die Lagekarte zeigt dann keine modulgebundenen Quellen. Dass die Freigaben selbst
  fehlen, meldet der Ausfallhinweis als eigene Quelle „Berechtigungen“. Sonst sähe eine leere
  Karte wie eine ruhige Lage aus.
- **Veraltete Freigaben nach Rechteänderung durch Dritte** → wie heute bei Overrides. Das
  403-Netz der Seiten bleibt, und `staleTime` bleibt beim Standard. Ein Live-Ereignis wäre ein
  eigener Task.
- **Breite Signaturänderung über rund 20 Dateien** → mechanisch, vom Typ-Checker geführt. Die
  vorhandenen Tests der Konsumenten bauen ihre Fixtures auf `ModulFreigaben` um. Die
  Charakterisierung („ausgeblendet“, „gesperrt“, „Admin“) bleibt dieselbe.

## Migration Plan

Keine Datenmigration. Backend und Frontend gehen gemeinsam aus, weil das Frontend eingebettet
ist. `GET …/modul-overrides` bleibt unverändert bestehen, ein Rollback ist also ein Revert des
PRs.
