import type { LageberichtAnzeige } from '../api/types';
import AbschnittsText, { type AbschnittsTextUnterEbene } from '../entwurf/AbschnittsText';
import { vorlage } from './vorlagen';

/**
 * Der Berichtstext eines Lageberichts zum Lesen: je Vorlagen-Abschnitt Titel und Markdown,
 * ein leerer Abschnitt als „—". Ein Bauteil für Detailseite und Sprungpalette; die Mechanik
 * trägt `entwurf/AbschnittsText.tsx`.
 *
 * `unterEbene` wie an `components/Markdown.tsx`: die Ebene der nächsten Überschrift ÜBER dem
 * Bauteil. Abschnittstitel und `#` im Text stehen eine Ebene darunter. Der Rahmen bleibt beim
 * Aufrufer.
 */
export default function LageberichtText({
  bericht,
  unterEbene,
}: {
  bericht: LageberichtAnzeige;
  unterEbene: AbschnittsTextUnterEbene;
}) {
  return (
    <AbschnittsText
      gliederung={vorlage(bericht.vorlage)?.abschnitte ?? []}
      abschnitte={bericht.abschnitte}
      unterEbene={unterEbene}
    />
  );
}
