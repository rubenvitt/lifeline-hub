import { Form, Typography } from 'antd';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { ladeVersorgendeEinheiten, savePersonEinheit } from '../api/einsatzPerson';
import { istKonflikt } from '../api/client';
import { einsatzKeys } from '../api/queryKeys';
import type { Person, VersorgendeEinheitAuswahl } from '../api/types';
import { useAuthOptional } from '../auth/AuthContext';
import { InlineAngabe } from '../components/InlineAngabe';
import { KennungsLink } from '../components/kennungsLink';
import { Select } from '../components/Select';
import { useGeraetDarf } from '../geraet/geraetSicht';
import { useSprungSperre } from '../einsatz/useSprungSperre';
import { useOhneVerbindung } from '../offline/verbindung';
import { meldungenPfad } from '../routing/deeplinks';

/** Der Grund der Sperre ohne Netz, in wenigen Wörtern (LFH-966). */
export const EINHEIT_OHNE_NETZ = 'ohne Netz nicht änderbar';

type EinheitBezug = Pick<
  Person,
  | 'versorgende_einheit_id'
  | 'versorgende_einheit_name'
  | 'versorgende_einheit_abschnitt_name'
  | 'meldung_id'
  | 'meldung_lfd_nr'
>;

/** „Streife 2 · Bühne“: die Einheit, dahinter ihr Abschnitt (design.md D2). */
export function einheitText(
  name: string | null | undefined,
  abschnitt: string | null | undefined,
): string | null {
  if (!name) return null;
  return abschnitt ? `${name} · ${abschnitt}` : name;
}

/** Hat die Person etwas für die Zeile „Versorgt von“? Lesend steht sie sonst nicht da. */
export function hatVersorgtVon(person: EinheitBezug): boolean {
  return person.versorgende_einheit_id != null || person.meldung_id != null;
}

/** Die Wahl der Einheit: aktive Einheiten mit Abschnitt, Suche über den Text. */
export function einheitOptionen(einheiten: VersorgendeEinheitAuswahl[] = []) {
  return einheiten.map((e) => ({
    value: e.id,
    label: einheitText(e.name, e.abschnitt_name) ?? e.name,
  }));
}

/**
 * Die Zeile „Versorgt von“ im Patientenkopf (LLH-1567, Change `unxqhab4-patient-einheit-meldung`,
 * design.md D4/D6): die versorgende Einheit mit Abschnitt und, falls die Person aus einer Meldung
 * angelegt wurde, der Verweis „aus Meldung #n“. Mit Schreibrecht inline änderbar und leerbar, ein
 * PATCH mit Feld-CAS (`erwartet` = Einheit beim Öffnen); ohne Netz gesperrt mit Grund, am
 * gekoppelten Gerät nur lesend. Die Wahl lädt erst beim Öffnen.
 */
export default function VersorgtVon({
  einsatzId,
  person,
  bedienbar,
  onGeschrieben,
}: {
  einsatzId: number;
  person: EinheitBezug & Pick<Person, 'id'>;
  /** Schreibrecht, Bedienfassung und nicht storniert. */
  bedienbar: boolean;
  onGeschrieben?: () => void;
}) {
  const geraet = useAuthOptional()?.geraet ?? null;
  const ohneVerbindung = useOhneVerbindung();
  const schreibt = bedienbar && geraet == null;
  const beimOeffnen = useRef<number | null>(person.versorgende_einheit_id ?? null);
  // Die Wahl lädt erst mit der ersten Bearbeitung: ein Kopf ohne sie fragt nichts ab.
  const [geoeffnet, setGeoeffnet] = useState(false);
  const wahl = useQuery({
    queryKey: einsatzKeys.personenEinheiten(einsatzId),
    queryFn: () => ladeVersorgendeEinheiten(einsatzId),
    enabled: schreibt && geoeffnet,
    // Jedes Öffnen fragt neu: auch ein wenige Sekunden alter Cache kann eine aufgelöste Einheit tragen.
    staleTime: 0,
  });
  // Angeboten wird nur die frisch geladene Liste; bis dahin (oder nach einem Fehler) steht nur die
  // aktuelle Einheit da, und Leeren geht immer.
  const frisch = wahl.isSuccess && !wahl.isFetching;
  const mutation = useMutation({
    mutationFn: (einheitId: number | null) =>
      savePersonEinheit(einsatzId, person.id, einheitId, beimOeffnen.current),
    onSuccess: () => onGeschrieben?.(),
    // Ein 409 heißt: jemand anderes hat die Einheit geändert. Neu laden, der Grund bleibt am Feld.
    onError: (e) => {
      if (istKonflikt(e)) onGeschrieben?.();
    },
  });

  const text = einheitText(
    person.versorgende_einheit_name,
    person.versorgende_einheit_abschnitt_name,
  );
  const anzeige = text ? (
    <span data-lfh="versorgt-von">{text}</span>
  ) : (
    <Typography.Text type="secondary">—</Typography.Text>
  );
  // Die aktuelle Einheit steht in der Wahl, auch wenn sie inzwischen aufgelöst ist.
  const optionen = einheitOptionen(frisch ? wahl.data : []);
  if (
    person.versorgende_einheit_id != null &&
    !optionen.some((o) => o.value === person.versorgende_einheit_id)
  ) {
    optionen.unshift({ value: person.versorgende_einheit_id, label: text ?? '' });
  }

  const meldung =
    person.meldung_id != null && person.meldung_lfd_nr != null ? (
      <AusMeldung einsatzId={einsatzId} id={person.meldung_id} lfdNr={person.meldung_lfd_nr} />
    ) : null;

  return (
    <span style={{ display: 'inline-flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
      {schreibt ? (
        <InlineAngabe<number | null>
          etikett="Versorgende Einheit"
          wert={person.versorgende_einheit_id ?? null}
          anzeige={anzeige}
          leer={(w) => w == null}
          darfSchreiben
          gesperrt={ohneVerbindung ? EINHEIT_OHNE_NETZ : undefined}
          onOeffnen={() => {
            beimOeffnen.current = person.versorgende_einheit_id ?? null;
            if (geoeffnet) void wahl.refetch();
            else setGeoeffnet(true);
          }}
          onSpeichern={(w) => mutation.mutateAsync(w)}
          eingabe={({ feld, value, onChange, popup }) => (
            <Select<number>
              {...feld}
              {...popup}
              allowClear
              loading={wahl.isFetching}
              value={value ?? undefined}
              onChange={(w) => onChange(w ?? null)}
              options={optionen}
              style={{ minWidth: 220 }}
            />
          )}
        />
      ) : (
        anzeige
      )}
      {meldung}
    </span>
  );
}

/**
 * „aus Meldung #n“ (design.md D6): ein Verweis auf die Meldung, am Gerät oder ohne Freigabe der
 * Meldungen nur Text. Eigener Baustein, damit nur ein Kopf mit Meldung die Freigaben liest.
 */
function AusMeldung({ einsatzId, id, lfdNr }: { einsatzId: number; id: number; lfdNr: number }) {
  const darf = useGeraetDarf();
  const sprungGesperrt = useSprungSperre(einsatzId);
  return darf('fremde-module') && !sprungGesperrt('meldungen') ? (
    <KennungsLink klein data-lfh="aus-meldung" to={meldungenPfad(einsatzId, { meldung: id })}>
      aus Meldung #{lfdNr}
    </KennungsLink>
  ) : (
    <Typography.Text type="secondary" data-lfh="aus-meldung">
      aus Meldung #{lfdNr}
    </Typography.Text>
  );
}

/**
 * Feld „Versorgende Einheit“ der Erfassungsmaske (LLH-1567, design.md D4): unter „Weitere
 * Angaben“, damit das Budget von vier sichtbaren Feldern bleibt. Nicht am gekoppelten Gerät.
 */
export function VersorgendeEinheitFeld({ einsatzId }: { einsatzId: number }) {
  const wahl = useQuery({
    queryKey: einsatzKeys.personenEinheiten(einsatzId),
    queryFn: () => ladeVersorgendeEinheiten(einsatzId),
  });
  return (
    <Form.Item label="Versorgende Einheit" name="versorgende_einheit_id">
      <Select<number>
        allowClear
        loading={wahl.isLoading}
        placeholder="Streife, Trupp, RTW"
        options={einheitOptionen(wahl.data)}
      />
    </Form.Item>
  );
}
