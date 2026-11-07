import { Flex, Typography } from 'antd';
import type { Person } from '../api/types';
import ZeitAnzeige from '../anzeige/ZeitAnzeige';
import { useAuthOptional } from '../auth/AuthContext';
import { KennungsLink } from '../components/kennungsLink';
import { SprungKnopf } from '../components/Sprung';
import { useSprungSperre } from '../einsatz/useSprungSperre';
import { NACHFORDERUNG_STATUS } from '../kommunikation';
import { rettungsmittelAnforderbar } from '../nachforderungen/personBezug';
import { nachforderungenPfad } from '../routing/deeplinks';

type RettungsmittelPerson = Pick<Person, 'id' | 'rettungsmittel'>;

/** Hat die Person etwas für die Zeile „Rettungsmittel“? Lesend steht sie sonst nicht da. */
export function hatRettungsmittel(person: RettungsmittelPerson): boolean {
  return person.rettungsmittel != null;
}

/**
 * Die Zeile „Rettungsmittel“ im Patientenkopf (LLH-1573, Change `n12q80rt-rettungsmittel-anfordern`,
 * design.md D3/D4): der Stand der jüngsten Anforderung für diese Person — Art, Status, wer kommt,
 * erwartetes Eintreffen, Einsatznummer — und, solange keine läuft, der Sprung „Rettungsmittel
 * anfordern“ in die Erfassung der Nachforderungsseite. Den Stand liefert die Personenantwort, also
 * auch am UHS-Gerät und ohne Leserecht auf Nachforderungen; der Verweis auf die Karte und der
 * Sprung brauchen die Freigabe des Moduls (sonst Text bzw. gesperrt mit Grund). Am gekoppelten
 * Gerät wird nicht angefordert.
 */
export default function RettungsmittelZeile({
  einsatzId,
  person,
  bedienbar,
}: {
  einsatzId: number;
  person: RettungsmittelPerson;
  /** Schreibrecht, Bedienfassung, nicht storniert und angetroffen. */
  bedienbar: boolean;
}) {
  const geraet = useAuthOptional()?.geraet ?? null;
  const gesperrt = useSprungSperre(einsatzId)('nachforderungen');
  const stand = person.rettungsmittel;
  const anfordern = bedienbar && geraet == null && rettungsmittelAnforderbar(stand);

  const anzeige = stand ? (
    <span data-lfh="rettungsmittel">
      {gesperrt || geraet != null ? (
        stand.art
      ) : (
        <KennungsLink
          to={nachforderungenPfad(einsatzId, { nachforderung: stand.nachforderung_id })}
        >
          {stand.art}
        </KennungsLink>
      )}{' '}
      · {NACHFORDERUNG_STATUS[stand.status]?.label ?? stand.status}
      {stand.rufnamen.length > 0 && <> · {stand.rufnamen.join(', ')}</>}
      {stand.eintreffen_erwartet_at &&
        (stand.status === 'zugesagt' || stand.status === 'unterwegs') && (
          <>
            {' '}
            · erwartet <ZeitAnzeige wert={stand.eintreffen_erwartet_at} rolle="kurz" />
          </>
        )}
      {stand.leitstelle_einsatznummer && <> · Einsatznr. {stand.leitstelle_einsatznummer}</>}
    </span>
  ) : (
    <Typography.Text type="secondary">—</Typography.Text>
  );

  return (
    <Flex gap={8} wrap align="center">
      {anzeige}
      {anfordern && (
        <SprungKnopf
          to={nachforderungenPfad(einsatzId, { bezugPerson: person.id })}
          gesperrt={gesperrt}
        >
          Rettungsmittel anfordern
        </SprungKnopf>
      )}
    </Flex>
  );
}
