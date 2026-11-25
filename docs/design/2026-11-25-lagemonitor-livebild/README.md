# Lagemonitor mit Livebild (25.11.2026)

Entwurf zu LLH-2109 („Lagemonitor-Kachel ‚Livebild‘ mit Schalter je Einsatz“), Schritt 6 der Notiz
[`docs/konzepte/2026-11-24-drohnenbild-ueber-suchlage.md`](../../konzepte/2026-11-24-drohnenbild-ueber-suchlage.md)
(D4). Design-Doc:
[`docs/superpowers/specs/2026-11-25-nqgmpw8u-lagemonitor-livebild-design.md`](../../superpowers/specs/2026-11-25-nqgmpw8u-lagemonitor-livebild-design.md).

**Stand dieses Ordners:** die Zeichenflächen des Canvas
https://claude.ai/artifact/9bBNFbWPKHxXjnJrfQDEBt (Artifact-Typ „Design“, Design System „Lifeline
Hub“, Stand 1795353744-f302). Die Schriften lädt der Canvas von Google Fonts; im Repo fallen die
Flächen auf die Systemschrift zurück. Inline-Styles sind maßgeblich.

| Datei                    | Zeichenfläche                                                          |
| ------------------------ | ---------------------------------------------------------------------- |
| `Main.dc.html`           | Lagemonitor 1920 × 1080, Nacht, Schalter an, Livebild läuft            |
| `KeinLivebild.dc.html`   | dieselbe Kachelung, Schalter an, aber kein Stream: „Kein Livebild“     |
| `Schalter.dc.html`       | Eintrag einer zugeschalteten Drohnenquelle an der Lagekarte mit Schalter |

## Was der Entwurf vorschlägt

1. **Linke Spalte:** „Was brennt“, darunter die Karte (nimmt den Rest der Höhe), darunter eine
   Zeile von 440 px: links die Kachel „Livebild“ mit einem Bild in 16 : 9 (734 px breit, das Bild
   386 px hoch), rechts daneben „Sofortmeldungen“ über „Ablauf“. Ohne Livebild bleibt die Zeile
   wie heute (Meldungen und Ablauf nebeneinander), die Karte wird wieder höher.
2. **Rechte Spalte unverändert:** Betroffene, Kräfte, Belegung.
3. **Kachel „Livebild“:** Titel wie jede Kachel, rechts der Datenstand der Drohnenlage in
   Großbild-Schrift; älter als 2 Minuten in der Achtungsfarbe. Das Bild ist stumm, ohne
   Bedienelemente, schwarz hinterlegt.
4. **„Kein Livebild“:** Die Kachel bleibt stehen, die Fläche sagt „Kein Livebild“ in 28 px, ohne
   Alarmfarbe und ohne Eintrag in „Was brennt“.
5. **Schalter:** Unter der zugeschalteten Quelle, zwischen „Livebild“ und „Abschalten“, ein
   Schalter „Livebild auf dem Lagemonitor“, aus als Vorgabe, mit einer Zeile darunter, die sagt,
   was gilt. Nur die Einsatzleitung sieht ihn.
