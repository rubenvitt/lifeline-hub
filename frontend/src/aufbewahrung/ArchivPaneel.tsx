import { Button, Flex, theme } from 'antd';
import { useMutation } from '@tanstack/react-query';
import { ladeArchivBlock } from '../api/aufbewahrung';
import type { ArchivAngabe } from '../api/types';
import ZeitAnzeige from '../anzeige/ZeitAnzeige';
import { speichereDatei } from '../components/dateiSpeichern';
import { Datenfeld, Datenraster, Paneel } from '../components/instrument';
import { SpeicherFehler } from '../components/SpeicherHinweis';
import { formatGroesse } from '../karten/formatGroesse';

/** `einsatz-E-2026-0001-block-1.sqlite.age`, wie der Server ihn nennt (Ersatz, falls die Antwort
 *  keinen Namen trägt). */
export function archivDateiname(kennung: string, block: number): string {
  return `einsatz-${kennung.replace(/[^A-Za-z0-9_-]/g, '_')}-block-${block}.sqlite.age`;
}

/**
 * Archiv eines geschwärzten Einsatzes am Hub (LLH-1494): der gültige Block, wie lange er gilt,
 * welche Schlüssel ihn öffnen, und der Download. Den Abruf schreibt der Server ins
 * Zugangsprotokoll. Ohne Archiv steht das Paneel nicht da.
 */
export default function ArchivPaneel({
  einsatzId,
  kennung,
  archiv,
}: {
  einsatzId: number;
  kennung: string;
  archiv: ArchivAngabe;
}) {
  const { token } = theme.useToken();
  const laden = useMutation({
    mutationFn: () => ladeArchivBlock(einsatzId),
    // Der Name kommt aus derselben Antwort: endet ein Block zwischen Laden und Abruf, liefert
    // der Server schon den nächsten.
    onSuccess: ({ datei, dateiname }) =>
      speichereDatei(datei, dateiname ?? archivDateiname(kennung, archiv.block)),
  });
  return (
    <Paneel titel="Archiv" meta={`Block ${archiv.block}`} koerperPolster>
      <Datenraster spalten={3} beschriftung="Archiv">
        <Datenfeld label="Archiviert" mono>
          <ZeitAnzeige wert={archiv.archiviert_at} />
        </Datenfeld>
        <Datenfeld label="Gültig bis" mono>
          {archiv.gueltig_bis ? <ZeitAnzeige wert={archiv.gueltig_bis} /> : 'wie der Einsatz'}
        </Datenfeld>
        <Datenfeld label="Größe" mono>
          {formatGroesse(archiv.groesse)}
        </Datenfeld>
        <Datenfeld label="Schlüssel" mono>
          <span data-lfh="archiv-fingerabdruecke">{archiv.fingerabdruecke.join(', ')}</span>
        </Datenfeld>
      </Datenraster>
      <Flex vertical gap={token.marginSM} style={{ marginTop: token.marginSM }}>
        <div>
          <Button onClick={() => laden.mutate()} loading={laden.isPending}>
            Herunterladen
          </Button>
        </div>
        <SpeicherFehler fehler={laden.error} titel="Nicht geladen" />
      </Flex>
    </Paneel>
  );
}
