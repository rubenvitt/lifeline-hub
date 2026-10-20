import { Form, Input } from 'antd';
import { useMutation, type UseMutationResult } from '@tanstack/react-query';
import type { Dayjs } from 'dayjs';
import { registrierAnzeige, type VerbleibEingabe } from '../api/einsatzPerson';
import type { Person } from '../api/types';
import { ErfassungsFormular, ErfassungsModal } from '../components/Erfassung';
import { ZeitpunktEingabe } from '../anzeige/ZeitpunktEingabe';
import { alsBackendZeit } from '../anzeige/zeitEingabe';
import { useSavePersonEintrag } from './personEintragSpeichern';
import { uebergabeBody } from './verbleibErfassungKern';

/**
 * „Übergabe quittieren“ (LLH-1332, Change `y4l621ih-patientenverbleib-uebergabe`, design.md D6):
 * schließt einen Eigentransport ab. Zwei Felder, die Uhrzeit (leer heißt jetzt, auch ohne Netz:
 * der Schreibweg setzt dann die Erfassungszeit am Gerät) und das Ziel, vorbelegt mit dem bisherigen.
 * Fahrzeug und Art stehen im Titel, nicht als Feld. Der Body entsteht nur in `uebergabeBody`; der
 * Schreibweg ist der des Verbleibs (`useSavePersonEintrag`, offline vormerkbar).
 */

/** Was die Quittung von der Person braucht. */
export type UebergabePerson = Pick<
  Person,
  | 'id'
  | 'registrier_nr'
  | 'aktuelles_einsatz_fahrzeug_id'
  | 'aktuelles_verbleib_ziel'
  | 'aktueller_verbleib'
>;

interface UebergabeWerte {
  zeitpunkt?: Dayjs | null;
  ziel?: string;
}

const erfassenText = 'Übergabe quittieren';

function felder() {
  return (
    <>
      <Form.Item label="Übergeben um" name="zeitpunkt">
        <ZeitpunktEingabe art="ereignis" placeholder="jetzt" keineZukunftstage />
      </Form.Item>
      <Form.Item label="Ziel" name="ziel">
        <Input placeholder="z. B. Krankenhaus" />
      </Form.Item>
    </>
  );
}

function body(person: UebergabePerson, werte: UebergabeWerte): VerbleibEingabe {
  return uebergabeBody(person, {
    ziel: werte.ziel,
    zeitpunkt_at: werte.zeitpunkt ? alsBackendZeit(werte.zeitpunkt) : undefined,
  });
}

/** Titel: Kennung und das, was die Kurzform über Fahrzeug und Ziel weiß. */
export function uebergabeTitel(person: UebergabePerson): string {
  const nr = registrierAnzeige(person.registrier_nr);
  return person.aktueller_verbleib
    ? `Übergabe — ${nr} · ${person.aktueller_verbleib}`
    : `Übergabe — ${nr}`;
}

/** Als Paneel im Patientenkopf; die Mutation hält der Kopf (Wechselsperre). */
export function UebergabePaneel({
  person,
  mutation,
  onSchliessen,
}: {
  person: UebergabePerson;
  mutation: UseMutationResult<unknown, Error, VerbleibEingabe>;
  onSchliessen: () => void;
}) {
  const [form] = Form.useForm<UebergabeWerte>();
  return (
    <section aria-label={erfassenText} data-lfh="uebergabe-paneel">
      <ErfassungsFormular<UebergabeWerte>
        form={form}
        erfassenText={erfassenText}
        initialValues={{ ziel: person.aktuelles_verbleib_ziel ?? undefined }}
        laeuft={mutation.isPending}
        speicherung={mutation}
        speicherFehlerTitel="Übergabe nicht quittiert"
        onErfassen={(werte) => mutation.mutateAsync(body(person, werte))}
        onFertig={onSchliessen}
        onAbbrechen={onSchliessen}
      >
        {felder()}
      </ErfassungsFormular>
    </section>
  );
}

/**
 * Als Dialog für die Betroffenenliste und die Spalte „Unterwegs“ des Grundrisses. Montiert = offen;
 * jede Öffnung hat eine frische Mutation.
 */
export function UebergabeDialog({
  einsatzId,
  person,
  onErfasst,
  onVorgemerkt,
  onSchliessen,
}: {
  einsatzId: number;
  person: UebergabePerson;
  onErfasst: () => void;
  /** Ohne Netz vorgemerkt: kein Serverstand; der Ort quittiert. */
  onVorgemerkt?: () => void;
  onSchliessen: () => void;
}) {
  const [form] = Form.useForm<UebergabeWerte>();
  const save = useSavePersonEintrag();
  const mutation = useMutation({
    // Merkt ohne Netz vor (`frontend/src/offline/AGENTS.md`, „Schreiben ohne Netz“).
    networkMode: 'always',
    mutationFn: (eingabe: VerbleibEingabe) => save(einsatzId, person, 'verbleib', eingabe),
    onSuccess: (ergebnis) => (ergebnis.zustand === 'gesendet' ? onErfasst() : onVorgemerkt?.()),
  });
  return (
    <ErfassungsModal<UebergabeWerte>
      offen
      titel={uebergabeTitel(person)}
      form={form}
      erfassenText={erfassenText}
      initialValues={{ ziel: person.aktuelles_verbleib_ziel ?? undefined }}
      laeuft={mutation.isPending}
      speicherung={mutation}
      speicherFehlerTitel="Übergabe nicht quittiert"
      onErfassen={(werte) => mutation.mutateAsync(body(person, werte))}
      onFertig={onSchliessen}
      onAbbrechen={onSchliessen}
    >
      {felder()}
    </ErfassungsModal>
  );
}
