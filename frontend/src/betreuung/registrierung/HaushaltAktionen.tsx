import { App, Button, Typography } from 'antd';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useId, useState } from 'react';
import { sendBezugsperson } from '../../api/betreuungRegistrierung';
import { ladeModulFreigaben } from '../../api/einsaetze';
import { einsatzKeys } from '../../api/queryKeys';
import type { PersonDetail } from '../../api/types';
import { registrierNummer } from '../../anzeige/registrierNummer';
import { useRollen } from '../../components/instrument';
import { ZeilenFehler } from '../../components/SpeicherHinweis';
import { istKeyFreigegeben } from '../../einsatz/modulRegistry';
import { useGeraetDarf } from '../../geraet/geraetSicht';
import { OHNE_VERBINDUNG_NICHT_AENDERBAR, useOhneVerbindung } from '../../offline/verbindung';
import HaushaltAendernModal from './HaushaltAendernModal';
import { haushaltKennung, personName } from './registrierKern';

/**
 * Haushalt einer Person auf ihrer Detailseite umbauen (LLH-1615, Change
 * `lm62ud0b-haushalt-umbauen`, design.md D4): „Zur Bezugsperson machen“ und „Haushalt ändern“
 * neben der Zeile „Haushalt H-n“. Nur mit Schreibrecht, Modul Betreuung, an einer Person, die jetzt
 * an einer Stelle registriert ist (die Stelle des Verbleibs gibt die Auswahl vor), und am Gerät nur
 * an der Betreuungsstelle. Zwei Aktionen, also Knöpfe statt ⋮ (`frontend/AGENTS.md`, „Aktionen“).
 * Ohne Netz gesperrt mit Grund (D5).
 */
export interface HaushaltAktionenProps {
  einsatzId: number;
  person: PersonDetail;
  darfSchreiben: boolean;
  /** Nach jedem Schreiben (Detail, Liste und ETB abgleichen). */
  onGeschrieben?: () => void;
}

export default function HaushaltAktionen({
  einsatzId,
  person,
  darfSchreiben,
  onGeschrieben,
}: HaushaltAktionenProps) {
  const { message } = App.useApp();
  const { token } = useRollen();
  const grundId = useId();
  const ohneNetz = useOhneVerbindung();
  const geraetDarf = useGeraetDarf();
  const [offen, setOffen] = useState(false);
  const stelleId =
    person.aktuelle_verbleib_art === 'notunterkunft'
      ? (person.aktuelle_verbleib_betreuungsstelle_id ?? null)
      : null;
  const freigaben = useQuery({
    queryKey: einsatzKeys.modulFreigaben(einsatzId),
    queryFn: () => ladeModulFreigaben(einsatzId),
    enabled: darfSchreiben && stelleId != null,
  });
  const titel = `${registrierNummer('R', person.registrier_nr)} ${personName(person)}`;
  const bezugsperson = useMutation({
    // Ohne Netz gesperrt; nie angehalten und still nachgeholt (kein client_id).
    networkMode: 'always',
    mutationFn: ({ haushaltId, stelle }: { haushaltId: number; stelle: number }) =>
      sendBezugsperson(einsatzId, stelle, haushaltId, person.id),
    onSuccess: (h) => {
      onGeschrieben?.();
      message.success(`${titel} ist Bezugsperson von ${haushaltKennung(h.nummer)}`);
    },
  });

  if (
    !darfSchreiben ||
    stelleId == null ||
    !geraetDarf('haushalt-umbauen') ||
    !istKeyFreigegeben('betreuung', freigaben.data)
  ) {
    return null;
  }
  const haushaltId = person.haushalt_id ?? null;
  const gesperrt = ohneNetz;

  return (
    <span
      data-lfh="haushalt-aktionen"
      style={{
        display: 'inline-flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        gap: token.marginXS,
      }}
    >
      {ohneNetz && (
        <Typography.Text id={grundId} type="secondary">
          {OHNE_VERBINDUNG_NICHT_AENDERBAR}
        </Typography.Text>
      )}
      {haushaltId != null && !person.haushalt_bezugsperson && (
        <Button
          disabled={gesperrt}
          aria-describedby={gesperrt ? grundId : undefined}
          loading={bezugsperson.isPending}
          onClick={() => bezugsperson.mutate({ haushaltId, stelle: stelleId })}
        >
          Zur Bezugsperson machen
        </Button>
      )}
      <Button
        disabled={gesperrt}
        aria-describedby={gesperrt ? grundId : undefined}
        onClick={() => setOffen(true)}
      >
        Haushalt ändern
      </Button>
      {/* Grund einer Ablehnung an der Zeile (LFH-1077), nicht als Toast. */}
      <ZeilenFehler fehler={bezugsperson.error} fallback="Bezugsperson nicht geändert" />
      {offen && (
        <HaushaltAendernModal
          einsatzId={einsatzId}
          stelleId={stelleId}
          person={{
            id: person.id,
            titel,
            haushaltId,
            istBezugsperson: person.haushalt_bezugsperson === true,
          }}
          onGeschrieben={() => onGeschrieben?.()}
          onSchliessen={() => setOffen(false)}
        />
      )}
    </span>
  );
}
