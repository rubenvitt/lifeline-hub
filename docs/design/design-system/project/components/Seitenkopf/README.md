# Seitenkopf (Ortspfad, Titel, Meta, Kopfaktionen)

Geteilter Seiten-Rahmen + Kopf für die Einsatz-Modulseiten, nach dem Muster von
`AdminPage`. Abstände und Farben kommen aus `theme.useToken()` bzw. `theme/tokens.ts`.

Der Seitenkopf ist eine 44-px-Leiste mit Titel 14/600, Mono-Meta und Aktionen; der Inhalt
füllt per Vorgabe die ganze Breite (`breite`).

**Überschriftenebene:** der Titel ist das `h1` der Seite (Satz bleibt 14/600), Paneele und
Abschnitte darunter `h2`, Unterabschnitte `h3`. Genau EIN `h1` je Seite: die Lagekarte baut
ihren Kopf selbst mit `level={1}`, die Anmeldeseite ist eine eigene Route ohne diesen Rahmen.

Regeln dazu:

- **Seitenkopf** `components/EinsatzSeite.tsx` (`SEITENKOPF_HOEHE` 44 px, wächst mit der
  Staffel): `titel` als `h1` (16/600, Paneele ab `h2`), `meta` in der Textschrift, `aktionen` rechts (Primär blau
  gefüllt, sekundär umrandet); Meta + Datenstand unter `md` eigene Zeile, Datenstand hält vorab
  seine Breite. Kommt die Meta erst mit den Daten, hält `metaPlatzhalter` (ihre Form, Zahlen als
  `0`) ihre Breite, sonst brechen die Aktionen nachträglich um. Wechselt eine Kopfaktion
  ihren Wortlaut mit den Daten (früher „Auflösen (noch 2 Personen)“, jetzt im ⋮), hält
  `components/BreiteHalten.tsx` die Breite der breitesten Form. `breite` Vorgabe `'voll'`, `'schmal'` nur für reine Formularseiten,
  `flaeche.seiteBreit` fällt beim Umbau.

Quelle: `frontend/src/components/EinsatzSeite.tsx` im Repo `rubenvitt/lifeline-hub`. Die Vorschau ist aus
dem echten Baustein gerendert, mit dem antd-Theme der App, Nacht und Tag, Dichte `kompakt`.
