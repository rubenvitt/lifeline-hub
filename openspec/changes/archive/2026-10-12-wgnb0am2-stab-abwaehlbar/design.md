# Design

## Context

Den Anlass nennt `proposal.md` („Why“). Hier steht nur der Ist-Zustand, der den Weg bestimmt.
Erhoben wurde er am 12.10.2026 auf `alpha` bei Migration `0181`.

**Freigabe eines Moduls** (`src/einsatz/berechtigung.rs:239`, `modul_freigabe`):

- Nicht ausblendbare Module (`einsatzdaten`, `einsatz-einstellungen`) sind immer frei.
- `sichtbar` kommt allein aus dem Einsatz-Override, fehlt er, gilt `true`. Eine Vorgabe der
  Organisation gibt es für die Sichtbarkeit nicht, eine des Systems auch nicht.
- Die Rolle kommt aus dem Einsatz-Override, sonst aus der Org-Vorgabe, sonst ist das Modul frei
  (`src/einsatz/effektiv.rs:56`).
- `!sichtbar` heißt kein Zugriff. Der System-Admin hat immer Zugriff, sieht ein ausgeblendetes
  Modul aber in keiner Navigation.

**Speicherung:**

- `einsatz_modul_override` (`0065`) trägt `sichtbar INTEGER NOT NULL DEFAULT 1` und
  `benoetigte_rolle`. Eine Zeile, die nur für eine Rolle angelegt wurde, sagt also immer auch
  „sichtbar“.
- `org_modul_einstellung` (`0070`) trägt nur `benoetigte_rolle`.
- Die Oberflächen dazu:
  - im Einsatz `frontend/src/pages/einstellungen/EinsatzModule.tsx`,
  - in der Verwaltung `EinsatzDefaults.tsx`, Paneel „Rollen-Vorgabe je Modul“,
  - beide auf `ModulEinstellungsListe.tsx`.

**Stab:**

- Ein Modulschlüssel `stab` deckt im Backend alles unter `/api/einsaetze/{id}/stab` ab
  (`PFAD_KEY`, der längste Präfix gewinnt) und im Frontend jede Route `stab/*`
  (`modulAusPfad`, Segment nach der Einsatz-ID).
- Darunter liegen vier fachlich getrennte Dinge: der Stab-Kern (Besetzung, Checkliste), die
  Lagebesprechung, S5 (Presse, Infotelefon) und S6 (Funkplan mit Skizze und Sprechgruppen,
  Kommunikationsplan).
- Einsatzlokale Sprechgruppen selbst hängen **nicht** am Stab
  (`/api/einsaetze/{id}/sprechgruppen`, ohne Modul). Am Stab hängen nur die Kanäle externer
  Stellen und der Skizzen-Komponenten.

**Feldbefund:**

- LLH-722 (früher LFH-852, „Feldbefund Stab-Modul“) ist offen. Seine Rückbau-Folgen aus LFH-46,
  Entscheidung 17, gelten weiter
  (`docs/superpowers/specs/2026-09-13-lfh-46-pruefliste.md:205-231`):
  - Bleibt die Pflege der Besetzung aus, wird die Besetzungsliste auf die Lagebesprechung
    reduziert.
  - Bleibt der Abschluss einer Lagebesprechung aus, wandert er ins ETB-Modul.
- Die Ausbausperre aus Abschnitt 13 ist seit dem 30.09.2026 aufgehoben, die Beobachtungspflicht
  bleibt.

## Goals / Non-Goals

**Goals:**

- Eine Organisation ohne Stabsarbeit legt einmal fest, dass ihre Einsätze ohne Stab starten.
- Funkplan, Fernmeldeskizze, Sprechgruppenplan, Kommunikationsplan und Lagebesprechung sind voll
  nutzbar, während der Stab ausgeblendet ist.
- „Aus“ bedeutet an jeder Stelle dasselbe: Ein ausgeblendetes Modul ist mit allem weg, was ihm
  gehört, und mit nichts, was einem anderen Modul gehört.
- Für jede heutige Stelle ist der Zielzustand benannt (Abschnitt „Stellenliste“).

**Non-Goals:**

- Einsatzvorlagen oder Profile beim Anlegen (D1, Option B), denn das wäre ein neues Konzept.
- Eine systemweite Vorgabe über den Organisationen. Es bleibt bei „sichtbar“ als fester Rückfall.
- Der Inhalt der Lagebesprechungs-Seite. Er gehört zu LLH-1111.
- Die Gestaltung der Stab-Seite. Sie gehört zu LLH-1124.
- Die Einträge der Sprungpalette. Sie gehören zu LLH-1127.
- Die Mandanten-Bezeichnungen S5. Sie gehören zu LFH-863.
- Code in dieser Change.

## Decisions

### D1 — Abwählbar über eine Sichtbarkeits-Vorgabe der Organisation, für alle Module

Die Organisation bekommt je Modul neben der Rollen-Vorgabe eine Sichtbarkeits-Vorgabe
(„sichtbar“ / „ausgeblendet“, leer = sichtbar). Sie gilt für jedes ausblendbare Modul, nicht nur
für den Stab. Gepflegt wird sie in der Verwaltung unter „Einsatz-Vorgaben“, in derselben Liste wie
die Rollen-Vorgabe, die dafür eine Spalte „Sichtbar“ bekommt (`ModulEinstellungsListe` kann das
schon für den Einsatz). Das Paneel heißt dann „Module für alle Einsätze“.

Erwogen und verworfen:

- **B, Einsatzvorlagen oder Profile** („Kleine Lage“, „Großlage mit Stab“) beim Anlegen: Das
  wäre mächtiger, aber ein neues Konzept mit eigener Pflege, Auswahl im Anlegen-Dialog und
  Versionierung. Es widerspricht LFH-456 nicht, weil es je Einsatz wirkt und nicht je Person, ist
  aber für die Frage zu groß. Bleibt der Bedarf nach mehreren Zuschnitten, baut B später auf D1
  auf: Eine Vorlage wäre dann ein Satz von Vorgaben.
- **C, nur je Einsatz** (Ist-Zustand): Das reicht nicht, weil jeder neue Einsatz nachgearbeitet
  werden muss, und im Einsatz hat dafür niemand Zeit.

### D2 — Auflösung zur Lesezeit: Einsatz, dann Organisation, dann sichtbar

`sichtbar` = Einsatz-Override ?? Org-Vorgabe ?? `true`. Gerechnet wird zur Lesezeit wie bei der
Rolle, kopiert wird nichts beim Anlegen. Eine geänderte Vorgabe wirkt daher auf jeden Einsatz ohne
eigene Einstellung, auch auf einen laufenden, so wie die Rollen-Vorgabe heute.

Damit der Einsatz die Vorgabe in beide Richtungen überstimmen kann, wird
`einsatz_modul_override.sichtbar` **nullbar** (NULL = erbt). Heute steht dort immer ein Wert,
auch in Zeilen, die nur für eine Rolle angelegt wurden. Die Migration setzt jede `1` auf NULL. Das
verliert nichts, denn bisher gab es keine Ebene darüber, `1` war also gleichbedeutend mit „erbt“.
Eine `0` bleibt eine bewusste Ausblendung.

Im Editor „Module“ des Einsatzes zeigt der Schalter den wirksamen Wert. Darunter steht gedämpft
„Vorgabe der Organisation: ausgeblendet“, dasselbe Muster wie der Rollen-Hinweis (LFH-944). Wer
den Schalter umlegt, schreibt einen eigenen Wert. „Vorgabe übernehmen“ setzt ihn auf NULL zurück.

Erwogen und verworfen:

- **Kopie beim Anlegen:** Laufende Einsätze blieben dabei unberührt, aber es entstünde eine zweite
  Semantik neben der Rolle, und eine später korrigierte Vorgabe erreichte keinen bestehenden
  Einsatz. Gegen das Risiko eines Moduls, das mitten im Einsatz verschwindet, hilft stattdessen
  ein Hinweis in der Verwaltung: „wirkt auf alle Einsätze ohne eigene Einstellung, auch laufende“.
- **Sichtbarkeit weiter `NOT NULL`, Org-Vorgabe nur ohne Override-Zeile:** Das wäre falsch für
  jede Zeile, die nur wegen einer Rolle existiert. Die Org-Vorgabe würde dort still übergangen.

### D3 — S6 wird ein eigenes Modul „Fernmeldewesen“

Ein neues Modul, Schlüssel `fernmeldewesen`, Label „Fernmeldewesen“, Kategorie
**Kommunikation** (neben Chat und Meldungen). Es übernimmt mit eigener Freigabe:

- den Funkplan in seinen drei Darstellungen (Tabelle, Fernmeldeskizze, Sprechgruppen),
- den Kommunikationsplan,
- das Skizzeneigene: Lage, Komponenten, Verbindungen, Bereiche, Schriftfeld,
- die externen Stellen des Kommunikationsplans mit ihren Kanälen.

Ein Modul statt zwei, weil Funkplan und Kommunikationsplan ein Datenmodell teilen: Die externen
Stellen des Kommunikationsplans sind Elemente der Skizze (LFH-893), und die Komponenten der Skizze
tragen Sprechgruppen wie die Stellen. Zwei Freigaben über einem Datenmodell ergäben Mischzustände
(Skizze frei, ihre Stellen gesperrt).

Die Kategorie ist Kommunikation und nicht Führung, weil man dort nach Funk sucht. Führung hat
schon sechs Module.

Die Modulseite trägt im h1 das Label (Spec `modul-benennung`). Funkplan, Fernmeldeskizze,
Sprechgruppen und Kommunikationsplan stehen darunter als Reiter. Die Beschreibung in der Registry
lautet „Funkplan, Fernmeldeskizze, Sprechgruppen, Kommunikationsplan“, damit „Funk“ in der Palette
trifft (LLH-1127).

Erwogen und verworfen:

- **B, alle Unterseiten bleiben am Stab, „Stab aus“ blendet nur die Stab-Seite aus:** Dann hätte
  „aus“ zwei Bedeutungen. Ein Stab mit Rollen-Sperre müsste die Unterseiten ebenfalls sperren, ein
  ausgeblendeter Stab nicht. Das lässt sich niemandem erklären.
- **C, unverändert:** Das löst Rubens Punkt nicht.
- **Zwei Module „Funkplan“ und „Kommunikationsplan“:** verworfen wegen des geteilten Datenmodells
  (oben).
- **Label „Information und Kommunikation“** (FwDV 100, S6): Es verwechselt sich mit der
  Kategorie „Kommunikation“, und der Chat ist ebenfalls Kommunikation. „Fernmeldewesen“ ist das
  Wort der Fernmeldeskizze und des Fernmeldebetriebsdienstes. Der Schlüssel folgt dem Label und
  wird mit F2 fest, denn er steht in der Datenbank. Am Checkpoint gewählt: „Fernmeldewesen“
  (Abschnitt „Freigabe“).

### D4 — Adressen: API bleibt, Oberfläche zieht um

- **API:** Die Pfade bleiben `…/stab/kommunikationsplan…` und `…/stab/fernmeldeskizze…`. `PFAD_KEY`
  bekommt zwei Unterpräfixe auf `fernmeldewesen`. Weil der längste Präfix gewinnt, wechselt das
  Modul ohne URL-Wechsel. Routen sind ein Grenzwert (`AGENTS.md`, „Bezeichner-Sprache“), ein
  Umbenennen bräuchte einen Übergangsweg und brächte fachlich nichts. Die Handler wechseln auf den
  Marker `Fernmeldewesen` (`EinsatzLesezugriff<Fernmeldewesen>` usw.).
- **Oberfläche:** Die neue Modulroute heißt `…/fernmeldewesen`, darunter
  `…/fernmeldewesen/kommunikationsplan`. `modulAusPfad` ordnet sie damit ohne Sonderfall zu. Die
  alten Routen `stab/funkplan` (samt `?ansicht=`) und `stab/kommunikationsplan` leiten auf die
  neuen um, denn Lesezeichen und Verweise in Texten bestehen weiter. Die Deeplink-Helfer
  `funkplanPfad` und `kommunikationsplanPfad` liefern die neuen Pfade.
- **Live:** Ein neues Ereignis `fernmeldewesen`, gefiltert auf das neue Modul, ersetzt `stab` für
  Kommunikationsplan und Skizze. Ein neuer Wert in einem Wire-Enum ist nur ein Zusatz, also kein
  Übergangsweg nötig.
- **Offline:** Der Kommunikationsplan bleibt offline lesbar. Sein Unter-Key wandert aus dem
  Stab-Präfix in den neuen Modul-Präfix (`frontend/src/offline/AGENTS.md`).

### D5 — Die Lagebesprechung wird ein eigenes Modul (Umsetzung LLH-1111)

Die Lagebesprechung gehört zum Führungsvorgang, nicht zum Stab (FwDV 100, 3.3.3.2). Sie findet
auch in Führungsstufe B/C statt. Ziel ist ein eigenes Modul `lagebesprechung` mit Termin,
Vorbereitung, Abschluss und Verlauf. LLH-1111 hat diesen Weg schon als Option A empfohlen und
bearbeitet ihn in einer eigenen Change (`llj8s2rt-lagebesprechung-eigenes-modul`). Diese Change
bestätigt nur das Ziel. Sie legt kein Folgeticket dafür an und entscheidet keine Einzelheiten der
Seite. Für LLH-1111 gelten D2 und D7 wie für F2.

Die Rückbau-Folge (b) des Feldbefunds bezieht sich danach auf das Modul Lagebesprechung, nicht
mehr auf den Stab. Sie heißt dann „Abschluss wandert ins ETB-Modul“ (D9).

### D6 — Am Stab bleiben Besetzung, Checkliste, Presse und Informationstelefon

- **Besetzung S1–S6** und **Checkliste Arbeitsaufnahme** sind der Kern.
- **Pressearbeit und Informationstelefon (S5)** sind echte Stabsarbeit. Eine Führungsgruppe ohne
  Stab hat kein S5. Sie bleiben Unterrouten des Stabs mit `useStabFreigabe`.
- **Am Stab-Kern hängen weiter:**
  - die Stabsstelle im Organigramm (LFH-626 D5),
  - die Auflösung der Funktionsempfänger s1–s6 bei Auftrag und Erinnerung
    (`fuehrung::aufloesung`),
  - die Übernahme „Eigene Lage“ (Besetzung).

  Ohne Stab gibt es keine Sachgebiete, also nichts aufzulösen.
- **Die Stab-Seite** verweist auf die Module Fernmeldewesen und Lagebesprechung, statt sie zu
  besitzen. Die S6-Zeile führt die Werkzeuge als Sprung mit der Freigabe ihres Ziels
  (`istSprungGesperrt`). Die Gestaltung macht LLH-1124.

### D7 — Keine Sperre wird durch die Aufteilung weicher

Ein neuer Modulschlüssel startet ohne Override, wäre also für alle frei. Wer heute den Stab auf eine
Rolle beschränkt hat, beschränkt damit auch Funkplan und Kommunikationsplan. Die Migration von F2
(und von LLH-1111) kopiert deshalb jede `benoetigte_rolle` des Schlüssels `stab` auf den neuen
Schlüssel, in `einsatz_modul_override` und in `org_modul_einstellung`.

Eine **Ausblendung** (`sichtbar = 0`) wird **nicht** kopiert. Wer den Stab ausgeblendet hat, hat
damit heute ungewollt auch Funkplan und Lagebesprechung verloren. Genau das behebt die Change.

Erwogen: Auch die Ausblendung kopieren, also den Stand genau erhalten. Verworfen, weil es den
Fehler, den die Change behebt, in jeden betroffenen Einsatz festschreiben würde.

### D8 — Diese Change entscheidet nur, die Umsetzung kommt mit eigenen Changes

Die Change trägt keine Spec-Deltas (`skip_specs: true`). Jedes Folgeticket schreibt seine Deltas
mit dem Code, damit `openspec/specs/` nie etwas zusagt, das `alpha` nicht hält. Archiviert wird
sie vor dem PR (Regel „Archiviert wird vor dem Merge“). `design.md` ist danach die Herleitung, auf
die F1, F2 und LLH-1111 verweisen.

Erwogen: eine gemeinsame Change mit allen Deltas, die die Folgetickets dann mit `/opsx:apply`
abarbeiten. Verworfen, weil der Branch erst nach F1, F2 und LLH-1111 einen PR bekäme. Die
Entscheidung, auf die LLH-1124 und LLH-1127 warten, läge so lange nicht auf `alpha`.

### D9 — Abstimmung mit dem Feldbefund (LLH-722, früher LFH-852)

Die Entkopplung ist ein **Umschnitt**, kein Ausbau. Es entsteht keine neue Fachfunktion, und die
Rückbau-Kriterien von LFH-46, Entscheidung 17, bleiben gültig:

- (a) Bleibt die Pflege der Besetzung aus, wird die Besetzungsliste auf die Lagebesprechung
  reduziert. Diese ist nach D5 dann ein eigenes Modul, der Rückbau trifft also nur die
  Besetzungsliste und die Auflösung im Funktionskatalog.
- (b) Bleibt der Abschluss einer Lagebesprechung aus, wandert er ins ETB-Modul. Gezählt wird am
  Modul Lagebesprechung.
- S5 behält seine Beobachtung (Zählpunkte je Seite, „behalten / umschneiden / zurückbauen“).
- S6 zählt nicht mehr als Stabsnutzung. Ein Rückbau des Stabs nimmt das Fernmeldewesen nicht
  mehr mit. LFH-848 hatte das Gegenteil vorgesehen („Einstieg aus `stab/unterseiten.ts` nehmen“),
  das ist damit überholt.

Diese Punkte gehen als Notiz an LLH-722.

## Stellenliste

Jede Stelle, die heute `useStabFreigabe`, `EinsatzLesezugriff<Stab>`,
`EinsatzSchreibzugriff<Stab>`, `EinsatzLeitungszugriff<Stab>` oder den Schlüssel `stab` prüft, mit
ihrem Zielzustand. „bleibt“ heißt weiter Stab-Freigabe. Pfade im Frontend sind relativ zu
`frontend/src/`.

### Backend

| Stelle | Heute | Ziel | Ticket |
| --- | --- | --- | --- |
| `src/routes/stab.rs:130` `laden`, `:139`/`:170` Besetzung | `Lese`/`Schreib<Stab>` | bleibt | — |
| `src/routes/stab.rs:200`/`:212` Lagebesprechungen Liste und Abschluss | `Lese`/`Schreib<Stab>` | Modul `lagebesprechung` | LLH-1111 |
| `src/routes/stab.rs:307`/`:318` Checkliste | `Lese`/`Schreib<Stab>` | bleibt | — |
| `src/routes/stab.rs:425–647` Kommunikationsplan, Stellen, Verbindungen, Kanäle | `Lese`/`Schreib<Stab>` | `<Fernmeldewesen>`, Pfad bleibt (D4) | F2 |
| `src/routes/stab.rs:754–1273` Fernmeldeskizze | `Lese`/`Schreib<Stab>` | `<Fernmeldewesen>`, Pfad bleibt (D4) | F2 |
| `src/routes/presse.rs` alle, `:285` Freigabe (`Leitungszugriff`), `MODUL_KEY` `:42` | `<Stab>` | bleibt | — |
| `src/routes/infotelefon.rs:28/53/95` | `<Stab>` | bleibt | — |
| `src/einsatz/modul.rs` `MODUL_KEYS`, `modul_marker!`, `PFAD_KEY:149` | `stab` deckt alles | `+fernmeldewesen` (Unterpräfixe `…/stab/kommunikationsplan`, `…/stab/fernmeldeskizze`), `+lagebesprechung` | F2, LLH-1111 |
| `src/live/mod.rs:126` `LiveEvent::Stab` (Kommunikationsplan, Skizze, Checkliste, Besetzung, Lagebesprechung) | → `stab` | Besetzung und Checkliste bleiben; Kommunikationsplan und Skizze → neues `fernmeldewesen`; Lagebesprechung → LLH-1111 | F2, LLH-1111 |
| `src/live/mod.rs:151/152` Presse, Infotelefon | → `stab` | bleibt | — |
| `src/fuehrung/aufloesung.rs:93-136` `darf_stab_lesen` | Stab-Recht | bleibt (D6) | — |
| `src/einsatz/berechtigung.rs:239` `modul_freigabe` | Sichtbarkeit nur Einsatz | Einsatz ?? Org ?? `true` (D2) | F1 |
| `src/einsatz/modul_override.rs`, `src/org/modul_einstellung.rs` | `sichtbar NOT NULL` bzw. fehlt | nullbar bzw. neu (D2) | F1 |
| `tests/einsatz_kontext_guard.rs`, `tests/modul_override.rs:110` | Wächter | neue Schlüssel eintragen | F2, LLH-1111 |

### Frontend

| Stelle | Heute | Ziel | Ticket |
| --- | --- | --- | --- |
| `pages/FunkplanPage.tsx:512/702` | `useStabFreigabe` fail-closed | Rahmen fängt über die Modulfreigabe `fernmeldewesen` ab. Eine eigene Prüfung entfällt, weil die Route jetzt dem Modul gehört (`ModulGesperrt`, LFH-888) | F2 |
| `pages/KommunikationsplanPage.tsx:310/514` | `useStabFreigabe` | wie Funkplan | F2 |
| `pages/PressePage.tsx`, `PressemitteilungDetailPage.tsx`, `InfotelefonPage.tsx` | `useStabFreigabe` | bleibt | — |
| `App.tsx:383-392` Routen `stab/funkplan`, `stab/kommunikationsplan` | Unterrouten Stab | Modulroute `fernmeldewesen`, Weiterleitung der alten Routen (D4) | F2 |
| `routing/deeplinks.ts:311/340` | `stab/…` | neue Pfade | F2 |
| `stab/unterseiten.ts` S6-Einträge | Unterseiten | Sprung in das Modul mit dessen Freigabe | F2 (LLH-1124 gestaltet) |
| `einsatz/modulRegistry.ts` | `stab` (Beschreibung „S1–S6, Lagebesprechung“) | `+fernmeldewesen` (Kommunikation), `+lagebesprechung`; Stab-Beschreibung ohne Lagebesprechung | F2, LLH-1111 |
| `stab/useNetzQuellen.ts:100-189`, `stab/SkizzenAufnahme.tsx:41` | alle Netzquellen nur bei `stabFrei` | eigene Daten bei `fernmeldewesen` frei; Stab-Besetzung (Kasten „Einsatzleitung“, `:152`) mit eigener Weiche auf `stab`, fehlt mit Grund | F2 |
| `entwurf/DokumentAnlagen.tsx:71/105` „Fernmeldeskizze anfügen“ | `useStabFreigabe` | Freigabe `fernmeldewesen` | F2 |
| `stab/useSkizzenAktionen.ts:78`, `stab/fernmeldeskizze.ts:82/590/604`, `stab/skizze/bedienung.ts:172/177`, `skizze/wirkung.ts:204` | `recht: 'stab'` | `recht: 'fernmeldewesen'` | F2 |
| `lageberichte/fuehrungsproblemeUebernahme.ts:29/124` Funkplan-Lücken, Kommunikationsplan | `stabFrei` | `fernmeldewesen` | F2 |
| `KommunikationsplanPage` Besetzung als Nebentext | an Stab-Freigabe der Seite | eigene Weiche auf `stab`, ohne Freigabe „—“ mit Grund | F2 |
| `api/queryKeys.ts:1163` `LAGEBILD_OFFLINE` | `[EINSATZ_KEYS.stab,'kommunikationsplan']` | Unter-Key im Präfix des neuen Moduls | F2 |
| `api/queryKeys.ts:268` Live-Abbildung `stab` | `[stab, auftraege, erinnerungen, modulZaehler]` | bleibt; neu `fernmeldewesen → [fernmeldewesen]` | F2 |
| `pages/einsatzabschnitte/Organigramm.tsx:345-357` Stabsstelle | `useStabFreigabe` | bleibt (D6) | — |
| `lageberichte/eigeneLageUebernahme.ts:89-99` Besetzung | `stab` | bleibt | — |
| `lageberichte/lageentwicklungUebernahme.ts:27/107` | `stab` und `etb` | `lagebesprechung` und `etb` | LLH-1111 |
| `stab/medienlageQuelle.ts:20-22` | `stab` | bleibt | — |
| `druck/einsatzbericht/quellen.ts:66-69` Quellen `stab`, `lagebesprechungen` | `modul:'stab'` | `stab` bleibt; `lagebesprechungen` → `lagebesprechung` (veraltete Zeilenverweise `:122/:192` mit nachziehen) | LLH-1111 |
| `command-palette/befehle.ts:126-134` „Lagebesprechung abschließen“ | `modulKey:'stab'` | `lagebesprechung` | LLH-1111 |
| `pages/fuehrung/UeberblickPage.tsx:322/552` Marke „Lagebesprechung“ | Sprung in freien Stab | Sprung ins Modul Lagebesprechung | LLH-1111 |
| `stab/vorbereitung.ts:206/214`, `VorbereitungPaneel` | Quelle `stab` | Modul Lagebesprechung | LLH-1111 |
| `fuehrung/useFunktionsVorschlaege.ts:22-27` | lädt Stab ohne Prüfung, nimmt 403 hin | bleibt (unverändert, gehört zum Stab-Kern) | — |
| `pages/einstellungen/EinsatzModule.tsx`, `EinsatzDefaults.tsx`, `ModulEinstellungsListe.tsx` | Sichtbar nur im Einsatz | Org-Spalte „Sichtbar“, Einsatz-Hinweis und „Vorgabe übernehmen“ (D1, D2) | F1 |

## Folgen je Folgeticket

**F1 — Sichtbarkeits-Vorgabe der Organisation je Modul**

- Specs: `modul-freigabe`. Die Anforderung zu `sichtbar` (Einsatz ?? Org ?? `true`) wird
  geändert, die Anforderung zum Hinweis auf die Org-Vorgabe im Einsatz-Editor um die Sichtbarkeit
  ergänzt, ebenso der Schreibweg der Org-Vorgabe.
- Migration und Typ-Codegen.
- Doku: `verwaltung.md` („Module für alle Einsätze …“), `einsatz-einstellungen.md` („Woher ein
  Wert kommt“, „Was ‚Sichtbar‘ … bewirkt“).
- Regeln: keine neue.

**F2 — Modul „Fernmeldewesen“: S6 von der Stab-Freigabe lösen**

- Specs:
  - `stab-funkplan`: Requirement „Eigene Adresse unter dem Stab mit Einstieg aus der S6-Zeile“
    wird ersetzt durch die Adresse im Modul Fernmeldewesen.
  - `stab-kommunikationsplan`: dieselbe Überschrift, ebenso.
  - `stab-fernmeldeskizze`: „Zweite Darstellung des Funkplans“ erbt die Freigabe des
    Fernmeldewesens.
  - `stab-fernmeldeskizze-bearbeitung`: „Bearbeiten nur mit Recht am Datensatz“, das
    Skizzeneigene am Fernmeldewesen.
  - `modul-freigabe`: Szenario „Unterroute eines gesperrten Moduls“, Beispiel ohne Funkplan.
  - `modul-benennung`: neues Modul.
- Migration (D7) und Typ-Codegen (Live-Ereignis).
- Regeln:
  - `frontend/src/stab/AGENTS.md`: Funkplan „kein Modul … prüft die Stab-Freigabe selbst“,
    Kommunikationsplan „`useStabFreigabe` fail-closed“, „Offline lesbar als einziger
    Stab-Unter-Key“, Skizze „kein Modul, keine Route“. Der Geltungsbereich wird „Stab und
    Fernmeldewesen“, die Dateien bleiben unter `stab/`.
  - `frontend/AGENTS.md`, „Keine Arbeitsplatzachse“: „Stabsfunktionen S1–S6 ebenso“ wird zu
    „Stabsfunktionen und Fernmeldewesen ebenso“.
  - Wurzel-`AGENTS.md`, Regelkarte: Zeile `frontend/src/stab/AGENTS.md` nachziehen.
- Doku: `funkplan.md` („Wer was darf“), `stab.md:78-80` (Unterseiten gesperrt), `ohne-netz.md`,
  `einsatz-oberflaeche.md`, Bilder des Funkplans (neuer Ortspfad).

**LLH-1111 — Lagebesprechung (läuft)**

- Ergänzt um D2 (Org-Sichtbarkeit greift auch hier) und D7 (Rolle von `stab` kopieren).
- Regeln: `frontend/src/stab/AGENTS.md`, Abschnitte „Vorbereitung der Lagebesprechung“ und
  „Überfälliger Besprechungstermin“, mit Regelkarte.

**Reihenfolge:**

- F1 und F2 sind unabhängig voneinander.
- F2 und LLH-1111 berühren beide `modul.rs`, die Frontend-Registry und `stab/AGENTS.md`. Wer
  zweit merged, zieht nach, die Migrationsnummern laufen über `scripts/check-migrationen.sh`.
- LLH-1124 (Stab-Seite) folgt nach F2 und LLH-1111.
- LLH-1127 (Palette) nimmt Fernmeldewesen als Modul statt als Sprungmarke, sobald F2 gemergt ist.

## Risks / Trade-offs

- [Eine Organisation blendet ein Modul aus, während ein Einsatz läuft, und es verschwindet dort]
  → Hinweis an der Vorgabe („wirkt auf alle Einsätze ohne eigene Einstellung, auch laufende“).
  Der Einsatz kann überstimmen, der System-Admin erreicht ein ausgeblendetes Modul weiter.
- [Migration `sichtbar 1 → NULL` deutet bestehende Zeilen um] → verlustfrei, weil es bisher keine
  Ebene über dem Einsatz gab (D2). Belegt durch einen Migrationstest mit einer Zeile, die nur eine
  Rolle trägt.
- [Lesezeichen und Verweise auf `stab/funkplan`] → Weiterleitung im Client (D4), die alte Route
  bleibt dauerhaft als Umleitung.
- [Ein Einsatz mit ausgeblendetem Stab zeigt nach F2 plötzlich das Fernmeldewesen] → gewollt
  (D7), steht in den Versionshinweisen.
- [F2 und LLH-1111 ändern parallel dieselben Dateien] → Reihenfolge oben. Beide kopieren die
  Rolle nach demselben Muster (D7), damit die Migrationen gleich gebaut sind.
- [Der Feldbefund (LLH-722) fällt gegen den Stab aus] → wird leichter: Der Rückbau trifft nur noch
  Besetzung, Checkliste und S5, Fernmeldewesen und Lagebesprechung bleiben (D9).

## Migration Plan

Keine in dieser Change. Die Migrationen von F1 und F2 sind in D2 und D7 beschrieben.

## Freigabe

Ruben hat am 12.10.2026 freigegeben:

- D1–D9 wie empfohlen, also auch die Auflösung zur Lesezeit (D2) und keine Kopie der Ausblendung
  (D7).
- Das Label „Fernmeldewesen“, Schlüssel `fernmeldewesen`. Erwogen waren auch „Funk und
  Kommunikation“ und „Funkplan“.
- Den Weg über einen Entscheidungs-PR ohne Spec-Deltas (D8). Das ist die ausdrückliche Ausnahme
  von „Ein Plan allein bekommt keinen PR“ (`AGENTS.md`).
