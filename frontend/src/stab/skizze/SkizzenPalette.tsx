/**
 * Palette der Fernmeldeskizze (LFH-893 D6, 6.2, 7.2): links neben der Fläche, einklappbar. Sie
 * führt die Sprechgruppen des Einsatzes und des Katalogs als ziehbare Einträge (eine Schiene
 * entsteht dort, wo der Eintrag abgelegt wird) und die Knöpfe zum Anlegen. Jeder Eintrag hat
 * einen Knopf „Auf die Fläche“ für die Bedienung ohne Zeiger. Die Palette steht nur, wo
 * Skizzeneigenes geschrieben werden darf (Recht auf den Stab, nicht mobil).
 */
import { useDraggable } from '@dnd-kit/core';
import { Button, Flex } from 'antd';
import type { Sprechgruppe } from '../../api/types';
import { Augenbraue, useRollen } from '../../components/instrument';
import { IconPlus } from '../../icons';
import type { Fernmeldenetz } from '../fernmeldeskizze';
import { bedingungszeichenText } from '../skizzenZeichen';
import type { AnlegenArt } from './SkizzenDialoge';
import type { ZiehDaten } from './wirkung';

/** Breite der offenen Palette. */
export const PALETTE_BREITE = 240;

function Eintrag({
  sg,
  steht,
  onAufFlaeche,
  onZeige,
}: {
  sg: Sprechgruppe;
  steht: boolean;
  onAufFlaeche: (id: number) => void;
  onZeige: (key: string) => void;
}) {
  const { token, rollen } = useRollen();
  const daten: ZiehDaten = { art: 'palette', sprechgruppeId: sg.id };
  const { listeners, setNodeRef, isDragging } = useDraggable({
    id: `palette:sg-${sg.id}`,
    data: daten,
  });
  const text = bedingungszeichenText(sg.betriebsart, sg.bezeichnung);
  return (
    <li
      data-lfh="skizze-palette-eintrag"
      data-key={`sg-${sg.id}`}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: token.marginXS,
        minHeight: token.controlHeight,
        borderBlockEnd: `1px solid ${rollen.linie}`,
        opacity: isDragging ? 0.5 : undefined,
      }}
    >
      <span
        ref={setNodeRef}
        {...listeners}
        title="Auf die Fläche ziehen"
        style={{
          flex: 1,
          minWidth: 0,
          cursor: 'grab',
          touchAction: 'none',
          fontFamily: token.fontFamilyCode,
          overflowWrap: 'anywhere',
        }}
      >
        {text}
        {steht ? (
          <span style={{ color: rollen.gedaempft, fontFamily: token.fontFamily }}> · steht</span>
        ) : null}
      </span>
      {steht ? (
        <Button type="text" onClick={() => onZeige(`sg-${sg.id}`)} aria-label={`${text} zeigen`}>
          Zeigen
        </Button>
      ) : (
        <Button
          type="text"
          onClick={() => onAufFlaeche(sg.id)}
          aria-label={`${text} auf die Fläche`}
          data-lfh="skizze-palette-setzen"
        >
          Setzen
        </Button>
      )}
    </li>
  );
}

export default function SkizzenPalette({
  netz,
  onAufFlaeche,
  onZeige,
  onAnlegen,
}: {
  netz: Fernmeldenetz;
  onAufFlaeche: (sprechgruppeId: number) => void;
  onZeige: (key: string) => void;
  onAnlegen: (art: AnlegenArt) => void;
}) {
  const { token } = useRollen();
  const auf = new Set(netz.schienen.map((s) => s.key));
  const gruppen = [
    { titel: 'Einsatz', liste: netz.sprechgruppen.filter((s) => s.einsatz_lokal) },
    { titel: 'Katalog', liste: netz.sprechgruppen.filter((s) => !s.einsatz_lokal) },
  ].filter((g) => g.liste.length > 0);
  return (
    <nav
      aria-label="Palette"
      data-lfh="skizze-palette"
      className="lfh-skizze-bedienung"
      style={{ width: PALETTE_BREITE, maxWidth: '100%', overflowY: 'auto', minHeight: 0 }}
    >
      <Augenbraue>Anlegen</Augenbraue>
      <Flex vertical gap={token.marginXXS} style={{ marginBlockEnd: token.marginMD }}>
        <Button
          icon={<IconPlus />}
          onClick={() => onAnlegen('extern')}
          data-lfh="skizze-anlegen-extern"
        >
          Externe Stelle
        </Button>
        <Button
          icon={<IconPlus />}
          onClick={() => onAnlegen('komponente')}
          data-lfh="skizze-anlegen-komponente"
        >
          Komponente
        </Button>
        <Button
          icon={<IconPlus />}
          onClick={() => onAnlegen('bereich')}
          data-lfh="skizze-anlegen-bereich"
        >
          Bereich
        </Button>
      </Flex>
      {gruppen.length === 0 ? (
        <>
          <Augenbraue>Sprechgruppen</Augenbraue>
          <div>—</div>
        </>
      ) : (
        gruppen.map((g) => (
          <section key={g.titel} aria-label={`Sprechgruppen ${g.titel}`}>
            <Augenbraue>{`Sprechgruppen · ${g.titel}`}</Augenbraue>
            <ul
              style={{ listStyle: 'none', margin: 0, padding: 0, marginBlockEnd: token.marginMD }}
            >
              {g.liste.map((s) => (
                <Eintrag
                  key={s.id}
                  sg={s}
                  steht={auf.has(`sg-${s.id}`)}
                  onAufFlaeche={onAufFlaeche}
                  onZeige={onZeige}
                />
              ))}
            </ul>
          </section>
        ))
      )}
    </nav>
  );
}
