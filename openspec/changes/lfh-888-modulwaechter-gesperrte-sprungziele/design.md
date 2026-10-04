# Design

## Context

Seit LFH-669 liefert der Server je Modul `{ sichtbar, zugriff }`
(`GET /api/einsaetze/{id}/modul-freigaben`, Query `einsatzKeys.modulFreigaben`). Der Rahmen
(`einsatz/EinsatzLayout.tsx`) lädt sie für Rail und Modulpanel. Zwei Lesarten gibt es in
`einsatz/modulRegistry.ts`:

- `istModulGesperrt`: gesperrt nur bei bekanntem `zugriff === false`. Unbekannt heißt offen.
  Die Navigation nutzt das, damit sie beim Öffnen nicht flackert.
- `istModulFreigegeben` / `istKeyFreigegeben`: frei nur bei bekanntem `fertig`, `sichtbar` und
  `zugriff`. Unbekannt heißt zu. Datenabrufe nutzen das, damit keine Anfrage auf Verdacht an eine
  Liste mit 403 geht.

`modulAusPfad(pathname)` ordnet jede Route unter `/einsaetze/:id/<route>/…` ihrem Modul zu, also
auch Detail-, Druck- und Stab-Unterrouten. Eine Bestandsaufnahme der Sprünge in fremde Module
(außerhalb von Rail, Panel und Palette) fand rund vierzig Stellen. Etwa die Hälfte ist schon
geprüft, direkt (`… === 'gesperrt' ? undefined`) oder indirekt über Daten aus freien Quellen. Die
ungeprüften stehen in D4.

## Goals / Non-Goals

**Goals:**

- Kein Weg in ein gesperrtes Modul endet im 403-Zustand der jeweiligen Seite.
- Ein sichtbares Bedienelement, das in ein gesperrtes Modul führt, erklärt das (M16), statt ins
  Leere zu führen.

**Non-Goals:**

- Keine Änderung daran, wer worauf zugreifen darf. Server-Gates bleiben unverändert.
- Verweise in Datenzeilen bekommen keine eigene Prüfung. Das sind ETB-Backlinks
  (`etb/EtbBacklinkBadges.tsx`), Bezugslinks an Karten (`AuftragKarte`, `MeldungKarte`,
  `ErinnerungKarte`), Halter- und Bezugslinks (`TiereDetailPage`, `schadenHelfer`),
  `LagemeldungenPage` „Meldung #“, Toasts (`AlarmZentrale`, `stab/abschlussToast.tsx`) und
  Zeilenlinks der Lagebesprechung. Sie sind Teil eines Datensatzes, und der Wächter fängt sie
  auf (D1).
- Die Standardmodul-Weiche (`DefaultModulRedirect`) wartet nicht auf die Freigaben. Ist das
  Standardmodul gesperrt, landet der Benutzer beim Wächter und hat dort den Rückweg. Sonst
  verzögerte jeder Einsatzstart um einen zweiten Abruf.
- Eine Datensatz-Prüfung („darf ich diesen Befehl sehen?“) bleibt Sache der Zielseite.

## Decisions

### D1 Routen-Wächter im Rahmen, nicht je Seite

Der Wächter sitzt in `EinsatzRahmen` an der Stelle des `<Outlet>`. Ist
`aktuellesModul && istModulGesperrt(aktuellesModul, freigaben)`, steht dort `<ModulGesperrt>`
statt `<Outlet>`. Rail, Panel, Kopfleiste und Banner bleiben, und der Benutzer kann weiter.

- Die Lesart ist die der Navigation (`istModulGesperrt`): unbekannt heißt offen. Solange die
  Freigaben laden oder scheitern, rendert die Seite wie heute. Ihr eigener 403-Zustand bleibt als
  Netz. Würde der Wächter bei unbekannten Freigaben sperren, blitzte er bei jedem Einsatzstart
  auf. Würde er warten, verzögerte er jede Modulseite um einen Abruf.
- `sichtbar: false, zugriff: true` (System-Admin in einem ausgeblendeten Modul) passiert. Das
  folgt der Spec: das Modul ist für ihn erreichbar, nur nicht in der Navigation.
- `einsatzdaten` und `einsatz-einstellungen` sind nie gesperrt. Damit bleiben auch
  `einsatzdaten/bericht` und die Einstellungs-Sektionen offen.
- **Verworfen: Wächter je Route in `App.tsx`** (Wrapper um `MODUL_ELEMENTE`). Die Unterrouten
  (`stab/funkplan`, `personen/:personId`, Druck) stehen dort als eigene Routen und müssten jede
  einzeln umhüllt werden. Eine vergessene wäre still offen. Der Rahmen kennt das Modul über
  `modulAusPfad` für alle zusammen.
- **Verworfen: einheitliche 403-Behandlung in `SeitenFehler`.** Die Seite rendert dann trotzdem
  und schickt ihre Anfragen ab. Das widerspricht der Anforderung „keine Anfrage an ein nicht
  freigegebenes Modul“. Zudem entscheidet jede Seite selbst, ob sie `SeitenFehler` nutzt.
- **Verworfen: kein Wächter, nur die Sprünge prüfen.** Deeplinks aus Lesezeichen, geteilte
  Adressen und die rund zwanzig Datenzeilen-Verweise blieben im 403 der jeweiligen Seite.

### D2 Gestalt des Hinweises

`einsatz/ModulGesperrt.tsx` folgt dem Muster von `components/Platzhalter.tsx`: ein `Paneel` mit
der Augenbraue „Keine Berechtigung“, schmal und zentriert. Der Titel ist der Modulname mit
Schloss-Icon wie im Modulpanel. Darunter steht ein Satz, bei `sichtbar: false` „ist in diesem
Einsatz ausgeblendet“, sonst „ist für deine Rolle in diesem Einsatz nicht freigegeben“. Es folgt
der Hinweis, wer das ändern kann („Freigaben legt die Einsatzleitung unter Einstellungen › Module
fest.“). Der Rückweg ist die eine Primäraktion. Info-Ton, kein Rot: eine Sperre ist keine Gefahr.
Die Seite bekommt kein `h1` von der Modulseite. Der Hinweis trägt deshalb den Modulnamen als `h1`,
damit die Überschriftengliederung (Spec `ueberschriften-gliederung`) nicht leer bleibt.

### D3 Rückwegziel

Neue reine Funktion `freiesRueckwegModul(freigaben, standardModul?)` in `modulRegistry.ts`. Sie
nimmt das Standardmodul des Einsatzes, wenn es frei ist, sonst den Überblick, sonst das erste
freie Modul in Registry-Reihenfolge, zuletzt `einsatzdaten` (nie gesperrt). „Frei“ heißt hier
`istModulFreigegeben` (strenge Lesart), damit der Rückweg nie selbst in den Wächter führt. Bei
unbekannten Freigaben greift der Wächter nicht, und der Fall tritt nicht auf. Dieselbe Funktion
tragen der Rückweg von `ModulStub` und die Sackgasse des Stabs (`stab/useStabFreigabe.tsx`). Beide
führen heute fest auf das Standardmodul bzw. den Überblick, und das kann selbst gesperrt sein.

### D4 Prüfung der Sprungstellen

Neue Hilfe `istSprungGesperrt(key, freigaben)` in `modulRegistry.ts`. Sie ist gleich
`istModulGesperrt` über den Key, also gesperrt nur bei bekanntem `zugriff === false`. Die Lesart
ist die der Navigation, aus demselben Grund wie in D1: Ein Kopfknopf, der beim Laden gesperrt
aufblitzt, wäre falsch. Ein Klick vor dem Eintreffen der Freigaben landet im Wächter. Das Ticket
nennt `istKeyFreigegeben`. Diese strenge Lesart ist für Datenabrufe gedacht und sperrte hier
während des Ladens jeden Sprung. Der Grundtext „Keine Berechtigung“ wird eine Konstante
(`KEINE_BERECHTIGUNG` in `modulRegistry.ts`). Die vier bestehenden Literale im Rahmen und auf der
Lagekarte ziehen nach.

Je Bedienelement gilt:

- **Knopf** (`Button`): `disabled` und `title="Keine Berechtigung"`, wie der gesperrte
  Modulpanel-Eintrag.
- **Verweis im Fließtext** („Meldebild ↗“, „Als strukturierten Lagebericht erfassen →“): Der
  Verweis entfällt. Ein Text ohne Ziel bedient nichts, und die Seite bleibt ohne ihn vollständig.
- **Link als Kopfaktion** („Zum ETB-Eintrag“ in Detailköpfen): Er wird bei Sperre ein gesperrter
  Knopf mit Grund. Er steht neben anderen Kopfaktionen, und ein fehlender Knopf fiele dort nicht
  als Sperre auf.
- **Kennzahl-Ziel**: `ziel={undefined}`, Wert und Notiz bleiben.
- **Leeraktion**: Sie entfällt. Der Leerzustand sagt weiter, was fehlt.

Ungeprüfte Stellen dieser Klassen (Bestandsaufnahme vom 04.10.2026):

| Stelle | Ziel | Form |
| --- | --- | --- |
| Überblick, Kopf „Lagebericht“ / „Eintrag“ | lageberichte / etb | Knopf |
| Überblick, Kennzahl „Kräfte im Einsatz“ | kraefteuebersicht | Kennzahl-Ziel |
| Überblick, Marke „Lagebesprechung“ | stab | Zeilenziel entfällt |
| Lage-Dashboard, Kennzahl „Kräfte“ (`lagebild.ts`) | kraefteuebersicht | Kennzahl-Ziel |
| Kräfteübersicht, Kopf „Einheit“, Leeraktion „Einheit bilden“ | einheiten | Knopf / Leeraktion |
| Kräfteübersicht, „In Lagebericht übernehmen“ | lageberichte | Knopf |
| `kraefte/Verdichtungszeile.tsx` „Meldebild ↗“ (Einheiten, Fahrzeuge, Material, Personal) | kraefteuebersicht | Link entfällt |
| Kopf „Zum ETB-Eintrag“ in Befehl-, Lagebericht- und Pressemitteilung-Detail | etb | Knopf |
| UHS-Detail, Kopf „Patient aufnehmen“ | personen | Knopf |
| Gefahren, Kopf „Auf Karte zeigen“ und Leeraktion | lagekarte | Knopf / Leeraktion |
| Betreuung, Zeilenaktionen „Karte“ / „verorten“ | lagekarte | Knopf |
| Personen-Detail „Auf Lagekarte verorten“, Schaden-Daten „Auf Karte verorten“ | lagekarte | Knopf |
| ETB-Schnellerfassung „Als strukturierten Lagebericht erfassen →“ | lageberichte | Link entfällt |
| Lagekarte: Zonen-Inspector „Matrix öffnen“, Inspector „ETB zu Einheit“ | gefahrenzonen / etb | Knopf |
| Lagekarte: Inspector „Im Fachmodul öffnen“ für Führungskraft und Lagemeldung (`markerToUrl`) | personal / meldungen | Knopf |

Jede Seite liest die Freigaben aus demselben Cache (`einsatzKeys.modulFreigaben`). Eine neue
Hilfe `useSprungSperre(einsatzId)` gibt `(key) => boolean` zurück und kostet keinen zweiten
Abruf. Seiten, die die Freigaben schon laden (Überblick, Lagekarte), nutzen ihre vorhandene
Query.

### D5 Regel fortschreiben

`frontend/AGENTS.md`, Bedien-Leitlinie, „Nicht zuständig für Rechte“: Aus „ein Einstieg ist keine
Freigabe, die Zielseite prüft selbst“ wird: „Ein Einstieg prüft die Modulfreigabe seines Ziels
(`istSprungGesperrt`, gesperrt sichtbar). Der Rahmen fängt jede Route in ein gesperrtes Modul ab
(`ModulGesperrt`, LFH-888), und die Zielseite prüft weiter ihren Datensatz.“

## Risks / Trade-offs

- [Freigaben ändern sich während der Betrachtung, etwa weil die Einsatzleitung ein Modul sperrt]
  → Der Wächter ersetzt die offene Seite beim nächsten Neuabruf der Freigaben. Ungespeicherte
  Eingaben gingen dann verloren. Die Freigaben laden ohne Live-Ereignis nur nach eigener Änderung
  oder beim Fokus neu. Der Server lehnt das Speichern ohnehin mit 403 ab, also verliert der
  Benutzer nichts, was er hätte speichern können.
- [Ein neuer Sprung entsteht künftig ohne Prüfung] → Der Wächter fängt ihn ab. Die Regel in
  `frontend/AGENTS.md` nennt die Hilfe. Ein Guard-Test über alle Sprünge wäre ein Grep über
  Pfad-Helfer und lieferte mehr Rauschen als Nutzen. Er entfällt bewusst.
- [Seiten-eigene 403-Zweige werden seltener erreicht] → Sie bleiben als Netz für unbekannte
  Freigaben und für den Altstand. Sie werden nicht entfernt.
