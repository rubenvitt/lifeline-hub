# Tabellenkopf mit Sortieren und Filtern, Filterhinweis

Bausteine des gemeinsamen Bedienmusters „Sortieren und Filtern“ der beiden Tabellenträger
(LLH-1086, Spec `tabellen-sortieren-filtern`, `frontend/AGENTS.md`, „Tabelle und Dichte“):
`Datensicht` baut es, `KatalogTabelle` übernimmt es. Hier wohnt, was beide gleich zeigen:
die Leiste der aktiven Filter und die Marke einer gefilterten Kopfzelle. Den Hinweis über der
Liste trägt `instrument/Filterhinweis` (LLH-1071), kein zweiter Baustein.

Aus `frontend/src/components/instrument/Filterhinweis.tsx`:

Filterhinweis — das Band über einer gefilterten Liste (LLH-1071, Spec `etb-filterleiste`,
„Filterband über der Erfassung“): „Gefiltert · 7 von 134 Einträgen sichtbar · Meldung · seit
1345“ mit „Filter zurücksetzen“. Für das ETB gebaut, für jede gefilterte Liste gedacht.

Quelle: `frontend/src/components/tabellenFilter.tsx` im Repo `rubenvitt/lifeline-hub`. Die Vorschau ist aus
dem echten Baustein gerendert, mit dem antd-Theme der App, Nacht und Tag, Dichte `kompakt`.
