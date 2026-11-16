# Design

## Context

Das Organigramm (`frontend/src/pages/einsatzabschnitte/Organigramm.tsx`) liest ein Modell, das
`fuehrungsorganisation.ts:baueFuehrungsorganisation` rein aus Abschnitten und Einheiten ableitet.
Bildschirm, Druck und Lagebericht-Markdown (`rendereFuehrungsorganisationMarkdown`) lesen dieses
eine Modell. Der Knoten (`OrgKnoten`) kennt heute keinen Lagezustand, obwohl der Abschnitt ihn
trägt (`Einsatzabschnitt.lagezustand`, LFH-608). „Leitung nicht besetzt“ steht in
`rollen.achtungText`, an Abschnitten wie an Einheiten.

Der Baum steht im Gerüst `components/organigramm/HaengenderBaum`, das die Fernmeldeskizze mitnutzt,
hinter der Zufluss-Schleuse (`baumSchleuse.ts`). Die Schleuse hält Struktur, der Inhalt eines
Knotens fließt je Schlüssel frisch durch (außer am alten Ort eines umgehängten Knotens).

Die Gliederung zeigt denselben Lagezustand schon als `StatusTag` mit `darstellungsart="rand"` aus
`theme/statusFarben.ts:abschnittLagezustand` (`AbschnittKnoten.tsx`), der Überblick ebenso.
Die abgestimmten Entscheidungen stehen in proposal.md; hier steht, wie.

## Goals / Non-Goals

**Goals:**

- Der Lagezustand ist Teil des Modells, damit Bildschirm, Druck und Bericht dieselbe Angabe lesen.
- Die Zählung der fehlenden Leitung ist eine reine Funktion über das Modell und damit ohne DOM
  testbar.

**Non-Goals:**

- Keine Änderung am Gerüst `HaengenderBaum` und keine Lagekante am Knoten: die Fernmeldeskizze
  bliebe sonst nicht unberührt.
- Kein „UA <Zustand>“ wie im Überblick (abgestimmt verworfen).
- Keine Alarmgründe aus Welle 1 (Rückmeldung überfällig, Ausfall) im Organigramm: sie gehören in
  die Alarmzeile (LLH-1743).
- Der Gliederungsbaum behält sein „ohne Leiter“-Etikett; er ist eine andere Ansicht mit eigener
  Dichte.

## Decisions

**D1 Lagezustand im Modell, nur am Abschnittsknoten.** `OrgKnoten` der Art `abschnitt` bekommt
`lagezustand: AbschnittLagezustand | null`, gefüllt aus `a.lagezustand ?? null`. Einheitsknoten
bekommen das Feld nicht (sie haben keinen Lagezustand), statt eines immer leeren Felds an der
Basis. Weil die Schleuse den Inhalt je Schlüssel frisch durchreicht, fließt eine Zustandsänderung
ohne weiteres Zutun live, auch bei gehaltener Struktur.
*Alternative:* Zustand im Inhalt-Renderer aus den Abschnitten nachschlagen. Verworfen: der Bericht
bräuchte denselben Nachschlag ein zweites Mal, und das Modell wäre nicht mehr die eine Quelle.

**D2 Etikett wie in der Gliederung.** `KnotenInhalt` setzt `StatusTag` mit
`darstellung={abschnittLagezustand[k.lagezustand]}` und `darstellungsart="rand"` direkt hinter den
Namenslink, in die Zeile des Namens (Flex mit Umbruch), nicht in die Metazeile. So steht der
Zustand dort, wo das Auge den Knoten zuerst trifft, und die Form ist dieselbe wie in Gliederung und
Überblick.
*Alternative:* Lagekante am Knotenrand. Verworfen (abgestimmt): neue Form im geteilten Gerüst.

**D3 Gedämpftes Wort am Knoten.** „Leitung nicht besetzt“ verliert `rollen.achtungText` und erbt
`rollen.gedaempft` der Metazeile. Das Wort bleibt (Spec: benannte Abwesenheit), nur die Rolle
geht in die Sammelzeile.

**D4 Zählung als reine Funktion.** `fuehrungsorganisation.ts` bekommt
`zaehleOhneLeitung(org): { abschnitte: number; einheiten: number | null }`, rekursiv über alle
Knoten einschließlich Sammelknoten und unterstellter Einheiten. `einheiten` ist `null`, wenn
`org.einheitenFehlen` gilt: ein fehlender Bestand ist kein leerer (wie bei der Stärke). Dazu
`ohneLeitungText(z): string | null` mit Einzahl/Mehrzahl („1 Abschnitt ohne Leitung“, „2 Abschnitte
ohne Leitung“, „1 Einheit ohne Führer“, „7 Einheiten ohne Führer“), Teile mit 0 oder `null`
entfallen, Trenner „ · “, `null` wenn nichts bleibt. Bildschirm und Bericht nutzen denselben Text.

**D5 Sammelzeile außerhalb des Gerüsts, aus dem Live-Stand.** `Organigramm` rendert die Zeile
zwischen dem Hinweis „Einheiten: …“ und `OrganigrammBild`, nicht im Kopf und nicht im Baum. Sie
liest `org` (Live-Stand), nicht den gehaltenen Stand der Schleuse. Form: je Teil ein `StatusChip`
mit `ton="achtung"` (derselbe Baustein wie „ohne Leiter“ in der Gliederung), in einem Container mit
`data-lfh="org-ohne-leitung"` und ohne `organigramm-no-print`, damit sie gedruckt wird.
*Alternative:* in den Kopf des Gerüsts. Verworfen: der Kopf steht während der Schleuse still
(LLH-1166), und die Zeile ist keine Angabe der Einsatzleitung.
*Folge:* Hält die Schleuse, kann die Zahl einen wartenden Knoten schon mitzählen. Das ist gewollt:
die Zeile ist eine Warnung über den aktuellen Stand, und der Sammelbanner nennt den wartenden
Knoten zugleich.

**D6 Bericht.** `knotenMarkdown` setzt bei einem Abschnitt mit Zustand `Lage <label>` direkt hinter
den Namen (`**UHS Turnhalle** · Lage kritisch · Rufname … · Leitung … · Stärke …`).
`rendereFuehrungsorganisationMarkdown` schreibt unter `## Gliederung` vor der Liste die Zeile aus
`ohneLeitungText` samt Leerzeile, wenn sie nicht `null` ist. Die Quellenzeile „Einheiten: … —
Einheiten und Stärken fehlen“ bleibt, wie sie ist.

## Risks / Trade-offs

- [Zwei Wörter für dieselbe Lücke einer Einheit: „Leitung nicht besetzt“ am Knoten, „ohne Führer“
  in der Sammelzeile] → Bewusst: die Spec definiert die Leitung einer Einheit als ihren Führer, und
  die Sammelzeile muss Abschnitte und Einheiten unterscheiden. Ein Angleichen des Knotenworts wäre
  eine eigene Spec-Änderung.
- [StatusTag und StatusChip im Druck] → Die Prüfung, dass beide dunkel auf hell drucken, steht als
  eigene Aufgabe in tasks.md (Druckemulation im Bildlauf).
- [Die Fernmeldeskizze teilt das Gerüst] → Es ändern sich nur `KnotenInhalt` und die Seite; ein
  Test der Skizze läuft im Gate mit.
