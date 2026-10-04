# Design

## Context

Motivation: siehe `proposal.md`. Anforderungen: `specs/lagevortrag-uebernahme/spec.md` und die
Änderung in `specs/stab-medienlage/spec.md`.

Heute hängt genau eine Übernahme am Lagevortrag: `stab/MedienlageUebernahme.tsx`, eingebunden in
`pages/LageberichtDetailPage.tsx` über `a.schluessel === 'medienlage'`. Die Komponente mischt
drei Dinge: Freigabe (Stab), Datenbeschaffung (drei Listen per `fetchQuery`) und Bedienung (Knopf,
Rückfrage, `onGeaendert`). Ohne Stab-Freigabe gibt sie `null` zurück.

Die Texte für „Eigene Lage“ existieren:
- `kraefte/kraeftebild.ts` → `rendereMeldebildMarkdown(bild, stand)`, gerechnet von
  `baueKraeftebild(abschnitte, einheiten, personal, fahrzeuge, material)`. Der Renderer kennt
  keine fehlende Liste: eine leere Personalliste ergibt Stärke 0.
- `pages/einsatzabschnitte/fuehrungsorganisation.ts` → `rendereFuehrungsorganisationMarkdown(org,
  { stand, stab, einheitenZustand })`, gerechnet von `baueFuehrungsorganisation(abschnitte,
  einheiten | null)`. Er führt fehlende Einheiten und gescheiterten Stab selbst als Quelle auf.

Beide Listen-Familien sind fremde Module. Wie der Funkplan (LFH-548/669) wird jede Liste nur
abgerufen, wenn `istKeyFreigegeben(<Modul>, freigaben)` sie freigibt (`einsatzabschnitte`,
`einheiten`, `personal`, `fahrzeuge`, `material`, `stab`).

## Goals / Non-Goals

**Goals:**
- Ein Baustein, der Bedienung und Rechteweiche für jede künftige Quelle (LFH-871 bis 873) trägt;
  eine neue Quelle ist eine Definition, keine neue Komponente.
- Medienlage verhält sich wie bisher, bis auf den Hinweis bei Sperre.

**Non-Goals:**
- Keine Änderung an den Renderern, an Vorlagen (`lageberichte/vorlagen.ts` ↔
  `src/lagebericht/mod.rs::VORLAGEN`) oder am Server.
- Kein Vortragsschema als Datenmodell (LFH-46 §2.3): die Zuordnung lebt im Client neben der
  bestehenden Vorlage.
- Keine Übernahme im *Lagevortrag zur Entscheidung* (Folgeentscheidung laut LFH-869).
- Die Einzelübernahmen „In Lagebericht übernehmen“ im Meldebild und im Organigramm bleiben.

## Decisions

### D1 Baustein und Quelldefinition getrennt

`lageberichte/AbschnittUebernahme.tsx` ist die Bedienung: Knopf, Unterzeile, Rückfrage,
`onGeaendert`, Hinweis bei Sperre. Er bekommt eine **Quelldefinition**:

```ts
interface UebernahmeQuelle {
  knopf: string;                 // „Aus S5 übernehmen“
  unterzeile: string;            // was übernommen wird
  ersetzenTitel: string;         // „Medienlage ersetzen?“
  ersetzenText: string;
  /** Aus den Modulfreigaben: frei, oder gesperrt mit Grund. */
  verfuegbar(freigaben: ModulFreigaben): { frei: true } | { frei: false; grund: string };
  /** Lädt beim Klick und liefert den fertigen Text; scheitert nie an einer einzelnen Liste. */
  erzeuge(ctx: { qc: QueryClient; einsatzId: number; freigaben: ModulFreigaben;
                 dtg: (iso: string) => string }): Promise<string>;
}
```

Der Baustein liest die Freigaben über dieselbe Abfrage wie `useStabFreigabe`
(`einsatzKeys.modulFreigaben`), entscheidet `laden` → nichts, `fehler` → Hinweis „Freigabe nicht
ermittelbar“, `gesperrt` → Hinweis mit Grund, `frei` → Knopf.

`lageberichte/uebernahmen.ts` hält die Zuordnung `UEBERNAHMEN: Record<schluessel, UebernahmeQuelle>`
für die Vorlage `lagebericht`. Die Seite fragt `uebernahmeFuer(vorlage, schluessel)`; für andere
Vorlagen kommt `undefined`. So bleibt der Lagevortrag zur Entscheidung ohne Knopf, auch wenn ein
Schlüssel dort später gleich hieße.

*Alternative:* je Abschnitt eine eigene Komponente wie heute. Verworfen: drei weitere Kopien von
Rückfrage und Verlustschutz-Meldung (LFH-871 bis 873), und jede Kopie kann die Rückfrage
vergessen. *Alternative:* ein Hook statt Komponente. Verworfen: Rückfrage-Dialog und Hinweis sind
Darstellung, die jede Quelle gleich braucht.

### D2 Medienlage wird eine Quelldefinition

`stab/MedienlageUebernahme.tsx` behält Dateiname und Default-Export, damit der bestehende Test
unverändert läuft; sie rendert `<AbschnittUebernahme quelle={MEDIENLAGE_QUELLE} …/>`. Die
Definition steht in `stab/medienlageUebernahme.ts` (Freigabe: `stab`; `erzeuge`: der bisherige
Code mit `fetchQuery` über die Keys der Presseseite). Knopftext, Unterzeile und Dialogtexte sind
die heutigen.

### D3 Rechte je Teil, „—“ statt 0

„Eigene Lage“ hat zwei Teile:

| Teil | braucht | ohne |
| --- | --- | --- |
| Kräftemeldebild | `einsatzabschnitte`, `einheiten`, `personal`, `fahrzeuge`, `material` | ganzer Teil „—“ mit Grund und Namen der fehlenden Listen |
| Führungsorganisation | `einsatzabschnitte`; Einheiten und Stab optional | ohne Abschnitte ganzer Teil „—“; ohne Einheiten führt der Renderer die Quelle selbst auf; ohne Stab-Freigabe kein Wort über den Stab (`stab: null`) |

Das Kräftemeldebild ist **alles oder nichts**, weil sein Renderer eine fehlende Liste als 0
rechnen würde und die Renderer unverändert bleiben (Akzeptanzkriterium „gleiche Renderer“). Der
Knopf steht, sobald ein Teil frei ist; sind beide gesperrt, steht der Hinweis „Eigene Lage nicht
übernehmbar: Meldebild nicht freigegeben (Personal, Material), Führungsorganisation nicht
freigegeben (Einsatzabschnitte)“.

Die Teilzeile hat die Form der Renderer: `# Kräftemeldebild` und darunter `— nicht freigegeben
(Personal)` bzw. `— nicht geladen (Abschnitte)`; Gründe aus `ZUSTAND_GRUND` (`stab/funkplan.ts`)
und `abrufZustand` (403 → gesperrt), wie im Funkplan.

### D4 Ganzer Einsatz, Stand aus den Daten

Das Meldebild geht ungefiltert in die Übernahme (der Lagevortrag spricht über den Einsatz, nicht
über die Filterauswahl eines Bildschirms). Der Stand jedes Teils ist der älteste
`dataUpdatedAt` der Listen, aus denen er gerechnet wurde (`gemeinsamerDatenstand`, wie im
Organigramm), formatiert mit `taktischeDtgVoll`. Abgerufen wird per `fetchQuery` über
`einsatzKeys.*` – dieselben Keys wie die Fachseiten, also ein gemeinsamer Cache und keine Abrufe,
solange niemand klickt.

### D5 Zusammensetzen ohne neue Verdichtung

Text = `meldebildTeil + '\n' + fuehrungsorganisationTeil`. Beide Renderer schreiben eine
H1-Überschrift; im Abschnitt rückt `Markdown` mit `unterEbene` sie unter den Abschnittskopf,
in Editor, Vorschau und Snapshot. Keine Zahl wird im Baustein gerechnet.

### D6 Personenbezug: Text wie die Einzelübernahme

Das Kräftemeldebild führt in der Kräftegliederung Personal mit Namen, die Führungsorganisation die
Leitung mit Namen. LFH-870 verlangt denselben Text wie die Einzelübernahme; LFH-869 nennt „kein
Personenbezug im übernommenen Text“. Gewählt (Freigabe am Checkpoint): **derselbe Text** wie heute
im Freitext-Bericht, Namen eingeschlossen. Die Personenbezug-Regel der Medienlage gilt für Dritte
(Anrufer, Ansprechpersonen der Presse), nicht für die eigenen Kräfte, deren Namen der Freitext-
Bericht schon heute ins ETB trägt.

*Alternative:* eine Lagevortrag-Fassung ohne Personalzeilen. Bräuchte einen Schalter im Renderer
und bricht „gleicher Text“; bleibt als Folgeentscheidung, falls am Checkpoint gewünscht.

## Risks / Trade-offs

- [Medienlage-Verhalten ändert sich unbemerkt] → bestehender Test läuft unverändert gegen den
  Default-Export; neuer Test für den Hinweis bei Sperre.
- [Text weicht von der Einzelübernahme ab] → Test rendert beide Teile aus denselben Fixtures über
  Baustein und über die Renderer direkt und vergleicht wörtlich.
- [Kräftemeldebild „—“, obwohl nur Material fehlt] → bewusst (D3); der Grund nennt die Liste.
  Teilübernahme mit Teil-Nullen wäre die schlechtere Lüge.
- [Abruf von fünf Listen beim Klick] → gemeinsamer Cache mit den Fachseiten; nur auf Klick.

## Migration Plan

Reine Client-Änderung, kein Datenbestand betroffen. Rückweg: Revert des PRs.
