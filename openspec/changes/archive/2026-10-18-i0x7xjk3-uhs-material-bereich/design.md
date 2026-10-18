# Design

## Context

- **UHS-Seite:** `pages/uhs/UhsDetailPage.tsx`. Der Grundriss liegt in `fensterInhalt`
  (Mindesthöhe 380 px), darunter im Seitenfluss die `Segmentleiste` mit „Material · Kräfte ·
  Bewegungen · Dateien“. Die Meta-Zeile zeigt Typ · Standort · Stärke.
- **Material am Ort:** `MaterialTab.tsx` ist eine Hülle um `kraefte/MaterialAmOrt.tsx` (LLH-1225).
  Denselben Baustein nutzen Einheit, Fahrzeug und BR. Er kann Menge, Ausgeben, Lösen, die Kopfzahl
  (`materialKopfzahl`: „n Posten · k Ausfall“) und den Status über `materialDarstellung`.
- **Was fehlt:** Status setzen (`StatusWahl` gibt es nur in `MaterialPage.tsx`) und Ad-hoc. Der
  Server nimmt `uhs_id` im `POST …/material` schon an (LLH-1224), und `disponiereAdhoc(…, { ort })`
  geht in einem Request.
- **Nachforderung:** `nachforderungenPfad(…, { vorbelegung })` öffnet die Erfassung vorbelegt.
- **Test:** `e2e/uhs-hoehe.spec.ts` prüft die Höhenkette und die Erreichbarkeit der Reiter.

## Goals / Non-Goals

**Goals:** Material ohne Bildlauf erreichbar; Zahl im Kopf; Status und Ad-hoc am Ort.

**Non-Goals:**
- Material am Platz (`uhs_platz_id`), nur nach Feldbefund
- Schreiben am UHS-Laptop (bleibt lesend, Spec `material-am-ort`)
- Kennzahlen der Stelle (LLH-1136)

## Decisions

1. **Bereichsleiste statt Reiter unter dem Grundriss.** `UhsDetailPage` setzt die `Segmentleiste`
   in den Kopfbereich der `EinsatzSeite` und rendert den gewählten Bereich in `fensterInhalt`.
   Damit hält jeder Bereich die Fensterhöhe. Material, Kräfte, Bewegungen und Dateien scrollen in
   ihrer Fläche. Ein Query-Param `bereich` (`belegung` als Vorgabe ohne Param, sonst `material`,
   `kraefte`, `bewegungen`, `dateien`) steht in `routing/deeplinks.ts`, ein unbekannter Wert fällt
   auf Belegung zurück.
   - Verworfen: die Reiter über den Grundriss legen und den Grundriss verkleinern. Das kostet die
     Höhe, die die Belegung braucht.
2. **Kopfzahl im Wortlaut des Bausteins.** Die Meta-Zeile nimmt `materialKopfzahl` („3 Posten ·
   1 Ausfall“) als Knopf-Link auf `?bereich=material`. Das Ticket schlug „Material 8 · 1 defekt“
   vor, aber die Regel „Eine Heimat je Zahl“ (`frontend/AGENTS.md`, LFH-550) gilt. Ausfall zählt
   defekt und verbraucht, die Rolle ist `alarm`, und das Wort ist der zweite Kanal. Ohne Freigabe
   Material steht keine Zahl da, weil keine Abfrage läuft.
3. **Status am Ort für alle Orte.** `MaterialAmOrt` bekommt an der Statusanzeige `StatusWahl`.
   Ein Schreibweg (`aendereMaterial` mit `status`) und dieselben Rechte wie beim Zuordnen gelten
   für alle vier Orte. Nur an der UHS freizuschalten verwarf ich: Derselbe Baustein soll sich an
   jedem Ort gleich verhalten (Spec „Ein Schreibweg für den Ort“). Die Geräte bleiben lesend.
4. **Ad-hoc-Dialog teilen.** Der Erfassungsdialog für Ad-hoc-Material wird aus `MaterialPage` als
   `kraefte/MaterialAdhocDialog.tsx` herausgelöst, mit festem Ort als Prop. `MaterialAmOrt` zeigt
   „Material erfassen“ neben „Material zuordnen …“. Der Verweis ins Modul Material entfällt, wenn
   nichts zuzuordnen ist, der Leertext bleibt.
5. **Fehlmenge.** „Fehlmenge melden“ steht nur an der UHS, mit Freigabe Nachforderungen. Es öffnet
   `nachforderungenPfad(…, { vorbelegung: { art: 'material', begruendung: 'Fehlmenge UHS «X»' } })`.

## Risks / Trade-offs

- [Breiterer Baustein trifft vier Orte] → Die Tests von `MaterialAmOrt` und
  `materialSchreibweg.test.tsx` decken alle Orte ab, und Statuswahl und Ad-hoc hängen an
  denselben Rechten.
- [Höhenkette] → `uhs-hoehe.spec.ts` wird auf die Bereiche umgestellt: jeder Bereich hat volle
  Höhe, die Leiste steht über dem Grundriss.
