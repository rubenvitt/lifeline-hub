# Design

## Context

Das Organigramm (`frontend/src/pages/einsatzabschnitte/Organigramm.tsx`) liest ein Modell, das
`fuehrungsorganisation.ts:buildFuehrungsorganisation` rein aus Abschnitten und Einheiten ableitet.
Bildschirm, Druck und Lagebericht-Markdown (`renderFuehrungsorganisationMarkdown`) lesen dieses
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
`countOhneLeitung(org): { abschnitte: number; einheiten: number | null }`, rekursiv über alle
Knoten einschließlich Sammelknoten und unterstellter Einheiten. `einheiten` ist `null`, wenn
`org.einheitenFehlen` gilt: ein fehlender Bestand ist kein leerer (wie bei der Stärke). Dazu
`ohneLeitungText(z): string | null` mit Einzahl/Mehrzahl („1 Abschnitt ohne Leitung“, „2 Abschnitte
ohne Leitung“, „1 Einheit ohne Führer“, „7 Einheiten ohne Führer“), Teile mit 0 oder `null`
entfallen. `ohneLeitungTeile(z): string[]` liefert die Teile, `ohneLeitungText(z): string | null`
fügt sie mit „ · “ zusammen (`null`, wenn nichts bleibt). Der Bildschirm setzt je Teil ein Etikett
(D5), der Bericht schreibt den Text (D6); die Wörter sind dieselben.

**D5 Sammelzeile im gehaltenen Kopf.** `Organigramm` rechnet die Teile aus `org` (Live-Stand) und
reicht sie an `OrganigrammBild`, das sie als eigenes Element `OhneLeitungZeile` vor
`OrganigrammKopf` in den `kopf` des Gerüsts legt. Form: je Teil ein `StatusChip` mit
`ton="achtung"` (derselbe Baustein wie „ohne Leiter“ in der Gliederung), Container
`data-lfh="org-ohne-leitung"` ohne `organigramm-no-print`, damit sie gedruckt wird. Das Gerüst hält
den Kopf samt Props, solange die Schleuse hält (LFH-867); im Druck ist sie offen, dort steht der
Live-Stand. Die Einheiten zählen zu den Quellen des Kopfs (`kopfLaedt`), damit die Zahl nachkommt,
wenn sie unter einem ruhenden Zeiger fertig laden (LLH-1166).
*Erster Entwurf, im Review verworfen:* die Zeile außerhalb des Gerüsts, live. Erschien oder
verschwand sie, während die Schleuse hielt (neue Einheit ohne Führer, letzte Lücke geschlossen),
rückte der Baum samt Fokus und Zeiger um eine Zeile, gegen „Organigramm hält seine Knoten“.
*Weitere Alternativen (16.11.2026 mit dem Menschen abgewogen):* live mit Scroll-Ausgleich
(`useAmSchirmHalten` der Fernmeldeskizze; mehr Code, oben auf der Seite ohne Wirkung) und fest
reservierter Platz (leerer Streifen, wenn nichts fehlt).
*Folge:* Während jemand im Organigramm arbeitet, zählt die Zeile den gezeigten Baum, nicht den
wartenden; der Sammelbanner nennt die wartende Änderung.

**D6 Bericht.** `knotenMarkdown` setzt bei einem Abschnitt mit Zustand `Lage <label>` direkt hinter
den Namen (`**UHS Turnhalle** · Lage kritisch · Rufname … · Leitung … · Stärke …`).
`renderFuehrungsorganisationMarkdown` schreibt unter `## Gliederung` vor der Liste die Zeile aus
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
