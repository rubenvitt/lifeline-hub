# Design

## Context

Die Übersicht ist eine `Datensicht` mit `form="tabelle"` unter `AdminPage` (Seitenleiste 220 px).
Bei 1440 px bleiben der Tabelle 1154 px. Gemessen: Kennung 141, Zustand bis rund 190 („zur
Löschung vorgemerkt“), jede Datumsspalte 117 bis 146 px (Kopf in Großbuchstaben samt
Sortierpfeil oder taktische DTG in Mono). Zehn Spalten brauchen damit rund 1390 px. Der
Spaltenschalter der `Datensicht` kennt `abBreite`: eine Spalte fällt unter der Breite weg, der
Schalter blendet sie wieder ein und zählt sie mit (`components/SpaltenSchalter.tsx`,
`sichtbareSpalten`). Die Personalseite nutzt das schon für Träger, Fahrzeug und Einheit (LFH-975).

## Goals / Non-Goals

**Goals:**

- Kein waagerechter Überlauf bei 1440 px. Die Fristen, nach denen verglichen wird („welcher läuft
  als nächstes ab?“), bleiben im Bild.
- Spaltenbreiten nach der Regel „Fließende Spalte“ (`frontend/AGENTS.md`): die Bezeichnung
  fließt, alle übrigen tragen eine Zahlbreite.

**Non-Goals:**

- Keine neue Darstellung der Daten (keine zusammengelegten Spalten, keine Karten).
- Fahrzeuge und Dokumente aus LFH-1149 (keine Spec betroffen).

## Decisions

1. **Drei Zustandsdaten weichen unter `xxl`** (Entscheidung Ruben, 10.10.2026). Vormerkung,
   Antrags-Fälligkeit und Schwärzung beschreiben einen Zustand, den die Zustandsmarke schon
   nennt. Spielraum bei 1440 px: rund 130 px für die Bezeichnung.
   - *Verworfen: nur zwei weichen* (Vormerkung, Schwärzung). Rechnerisch 0 bis 10 px Spielraum,
     abhängig von der längsten Zustandsmarke; ein längerer Mandantentext liefe wieder über.
   - *Verworfen: Datumsspalten zu einer Spalte „Termine“ zusammenlegen.* Spart Platz, nimmt aber
     die Sortierung je Datum und widerspricht dem Vergleichszweck der Seite.
   - *Verworfen: nur die Spec als erfüllt werten, ohne sie anzupassen.* Spec und Verhalten wären
     danach nicht mehr deckungsgleich.
2. **`abBreite` statt `spaltenAusVoreinstellung`.** Ab 1600 px ist Platz für alle zehn Spalten;
   eine feste Abwahl nähme sie auch dort weg.
3. **Prüfung im Browser, nicht in jsdom.** jsdom rechnet kein Layout. Den Überlauf misst das
   Gate „Tabellen am Führungsarbeitsplatz“ in `e2e/gate1-ueberlauf.spec.ts` an der
   Bildlauffläche der Tabelle; Vitest prüft nur Sichtbarkeit und Zähler je Breite.

## Risks / Trade-offs

- [Wer bei 1440 px nach Vormerkung oder Schwärzung sortieren will, muss die Spalte erst
  einblenden] → Der Zähler „Spalten · 3 ausgeblendet“ steht über der Tabelle; die Akte zeigt
  alle Daten; das Kapitel nennt den Weg.
- [Eine neue Spalte oder ein längerer Kopf bringt den Überlauf zurück] → Das Gate misst bei
  1440 px; der Dateikopf von `AufbewahrungUebersicht.tsx` verweist darauf.
