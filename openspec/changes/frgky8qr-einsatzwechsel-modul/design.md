# Design

## Context

Motivation: proposal.md. Stand (17.11.2026):

- `einsatz/EinsatzSwitcher.tsx` und der Einsatzwechsel in `command-palette/befehle.ts` springen
  auf `einsatzPfad(id)` = `/einsaetze/<id>`.
- Die Index-Route rendert `einsatz/DefaultModulRedirect.tsx`: Sie lädt die Einstellungen des
  Ziels (`einsatzKeys.einstellungen`) und leitet per `replace` aufs Standardmodul
  (`aufloeseStandardModul`), sonst auf `redirectZiel()`.
- `nebenzeile()` im Wechsler: `einsatzKennung(e)` (interne Nummer · Leitstellennummer) und Ort.
  Die Übungsmarke steht vor dem Namen (LLH-1725).
- Modulfreigaben je Einsatz liefert `einsatzKeys.modulFreigaben(id)`; `istModulFreigegeben` prüft
  sie.

## Goals / Non-Goals

**Goals:** Eine Entscheidungsstelle für „wohin nach dem Wechsel“, die die Freigaben des Ziels
kennt und auch im neuen Tab funktioniert.

**Non-Goals:** Unterseiten, Datensätze oder Filter mitnehmen; Hinweis bei gesperrtem Ziel-Modul;
Einsatzliste (`/einsaetze`) ändern.

## Decisions

### D1 — Modul-Hinweis über die Index-Route

`routing/deeplinks.ts` bekommt `einsatzPfad(id, { modul?: ModulKey })` →
`/einsaetze/<id>?modul=<key>` und `parseModulHinweis(search)` (nur bekannte Schlüssel, sonst
`undefined`). Der Wechsler bestimmt das aktuelle Modul mit `modulAusPfad(pathname)` und hängt es
an; die Palette ebenso aus ihrem Kontextpfad, auch für Strg+↵.

`DefaultModulRedirect` liest den Hinweis. Mit Hinweis wartet die Weiche zusätzlich auf
`einsatzKeys.modulFreigaben(ziel)`; ist das Modul nach `istModulFreigegeben` frei und fertig,
leitet sie per `replace` auf seine Startseite (`modulZielRoute`), sonst auf das bisherige Ziel.
Ohne Hinweis bleibt alles wie heute. Der Parameter verschwindet mit der Weiterleitung.

Der Umweg über die Index-Route baut die Modulseite neu auf; so bleibt kein Zustand des vorigen
Einsatzes stehen, ohne dass jede Modulseite dafür gehärtet sein muss.

*Alternative B:* Hinweis im Router-State. Geht im neuen Tab und beim Neuladen verloren, trägt
also die Palette mit Strg+↵ nicht. Verworfen.

*Alternative C:* Direkt ins Ziel-Modul springen und die Freigaben vorher im Wechsler holen.
Die Modulseite bliebe beim Wechsel montiert; nicht jede ist nachweislich gegen einen
Einsatzwechsel unter sich gehärtet. Verworfen.

*Alternative D:* Ohne Freigabeprüfung springen und die Sperrseite zeigen. Ein Wechsel endete
sichtbar in einer Sackgasse. Verworfen.

### D2 — Nebenzeile

`nebenzeile(e)` = `[art, nummer, ort]` mit `art = isUebung(e) ? null : EINSATZART_LABELS[e.einsatzart]`,
`nummer = einsatzKennung(e) ?? \`seit ${datum(e.begonnen_at, konv)}\``, `ort = e.einsatzort?.trim()`.
Das Datum kommt aus der Rolle `datum` des Zeitkerns (`anzeige/zeitDarstellung.ts`), in Zone und
Darstellung der App: taktisch `14nov26`, sonst `14.11.26`. Eine eigene Form „TT.MM.“ wäre eine
zweite Schreibweise, die der Zeitdarstellungs-Wächter zu Recht verbietet (Umsetzung 17.11.2026).
Ein
gemeinsamer reiner Helfer, den die Palette für ihre Einsatz-Zeilen mitnutzen kann, falls sie
eine Nebenzeile zeigt.

### D3 — Ankunft zeichnet nicht auf

Die Weiterleitung aus D1 ist eine Ankunft wie die heutige aufs Standardmodul; `merkeModulBesuch`
wird dabei nicht aufgerufen. Die Tabelle der Ankünfte in `zuletztModule.ts` (falls dort geführt)
nennt den Fall.

## Risks / Trade-offs

- [Kurzer Spinner wie heute, jetzt auch auf Freigaben wartend] → beide Abfragen laufen parallel;
  die Freigaben des Ziels sind oft schon im Cache.
- [Unbekannter oder manipulierter `?modul=`] → wird verworfen, bisheriges Ziel.
