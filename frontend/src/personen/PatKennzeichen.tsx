import { Input } from 'antd';
import { useMutation } from '@tanstack/react-query';
import { aktualisierePerson, type PersonEingabe } from '../api/einsatzPerson';
import { PAT_NUMMER_MAX } from '../api/eingabegrenzen';
import type { PersonDetail } from '../api/types';
import { InlineAngabe } from '../components/InlineAngabe';
import { monoStil, useRollen } from '../components/instrument';
import { Select } from '../components/Select';
import StatusTag from '../components/StatusTag';
import { istZuLang, zeichenGrenze } from '../components/zeichenGrenze';
import { useOhneVerbindung } from '../offline/verbindung';
import { kontamination as KONTAMINATION } from '../theme/statusFarben';

/**
 * Die Kopfzeile des Patientenkopfs (LLH-1326, design.md D3/D14): PAT-Nummer und Kontamination.
 * Beide sind Stammdaten der Person und gehen einzeln über den PATCH (ein Feld je Anfrage, nie ein
 * Formular), inline über `InlineAngabe`. Sie bleiben online (D8): ohne Netz stehen sie nur lesend,
 * mit Grund.
 *
 * Lesend erscheint die Zeile nur, wenn es etwas zu nennen gibt: eine PAT-Nummer oder
 * „kontaminiert“. „nicht kontaminiert“ trägt keine Marke (Spec `personen-detail`), steht aber
 * bedienbar als Wert, damit man sieht, was gilt.
 */

type KontaminationWert = 'ja' | 'nein' | null;

const KONTAMINATION_OPTIONEN = [
  { value: 'ja' as const, label: KONTAMINATION.label },
  { value: 'nein' as const, label: 'nicht kontaminiert' },
];

function kontaminationWert(k: boolean | null | undefined): KontaminationWert {
  return k == null ? null : k ? 'ja' : 'nein';
}

/** Der Grund der Sperre ohne Netz, in wenigen Wörtern (LFH-966). */
export const PAT_OHNE_NETZ = 'PAT-Nummer und Kontamination ohne Netz nicht änderbar';

export function hatKennzeichen(person: Pick<PersonDetail, 'pat_nummer' | 'kontamination'>) {
  return !!person.pat_nummer || person.kontamination === true;
}

export default function PatKennzeichen({
  einsatzId,
  person,
  bedienbar,
  onGeschrieben,
}: {
  einsatzId: number;
  person: PersonDetail;
  /** Schreibrecht, Bedienfassung und nicht storniert; die Netzfrage stellt die Zeile selbst. */
  bedienbar: boolean;
  onGeschrieben?: () => void;
}) {
  const { token, rollen } = useRollen();
  // Ohne Verbindung: Browser offline oder Server unerreichbar (`useOhneVerbindung`).
  const ohneVerbindung = useOhneVerbindung();
  const schreibt = bedienbar && !ohneVerbindung;
  const mutation = useMutation({
    mutationFn: (daten: Pick<PersonEingabe, 'pat_nummer' | 'kontamination'>) =>
      aktualisierePerson(einsatzId, person.id, daten),
    onSuccess: () => onGeschrieben?.(),
  });

  if (!bedienbar && !hatKennzeichen(person)) return null;

  const pat = person.pat_nummer ?? '';
  const k = kontaminationWert(person.kontamination);

  return (
    <div
      data-lfh="patientenkopf-zeile"
      style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: token.marginSM }}
    >
      {schreibt ? (
        <InlineAngabe<string>
          etikett="PAT-Nummer"
          wert={pat}
          anzeige={<span style={monoStil(13)}>{`PAT ${pat}`}</span>}
          leer={(w) => w.trim() === ''}
          gleich={(a, b) => a.trim() === b.trim()}
          isValid={(w) => !istZuLang(w, PAT_NUMMER_MAX)}
          darfSchreiben
          onSpeichern={(w) => mutation.mutateAsync({ pat_nummer: w.trim() || null })}
          eingabe={({ feld, value, onChange }) => (
            <Input
              {...feld}
              value={value}
              count={zeichenGrenze(PAT_NUMMER_MAX)}
              onChange={(e) => onChange(e.target.value)}
              style={{ width: 200 }}
            />
          )}
        />
      ) : (
        pat && (
          <span data-lfh="pat-nummer" style={{ ...monoStil(13), color: rollen.text }}>
            {`PAT ${pat}`}
          </span>
        )
      )}
      {schreibt ? (
        <InlineAngabe<KontaminationWert>
          etikett="Kontamination"
          wert={k}
          anzeige={
            k === 'ja' ? <StatusTag darstellung={KONTAMINATION} /> : <span>nicht kontaminiert</span>
          }
          leer={(w) => w == null}
          darfSchreiben
          onSpeichern={(w) =>
            mutation.mutateAsync({ kontamination: w == null ? null : w === 'ja' })
          }
          eingabe={({ feld, value, onChange, popup }) => (
            <Select<'ja' | 'nein'>
              {...feld}
              {...popup}
              allowClear
              value={value ?? undefined}
              onChange={(w) => onChange(w ?? null)}
              options={KONTAMINATION_OPTIONEN}
              style={{ minWidth: 200 }}
            />
          )}
        />
      ) : (
        k === 'ja' && <StatusTag darstellung={KONTAMINATION} />
      )}
      {bedienbar && ohneVerbindung && (
        <span role="status" style={{ color: rollen.text2 }}>
          {PAT_OHNE_NETZ}
        </span>
      )}
    </div>
  );
}
