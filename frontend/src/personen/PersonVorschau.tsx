import { Spin, Typography, theme } from 'antd';
import { useQuery } from '@tanstack/react-query';
import { ladePerson } from '../api/einsatzPerson';
import { einsatzKeys } from '../api/queryKeys';
import { GESCHLECHT_WORT, personStatusDarstellung } from './personMeta';
import { formatKalenderdatum } from '../anzeige/kalenderdatum';
import Patientenkopf from './Patientenkopf';
import PersonVerlauf from './PersonVerlauf';
import StammdatenRaster from './StammdatenRaster';
import { SeitenFehler } from '../components/SeitenZustand';
import { Status } from '../components/instrument/Status';
import { Stapel } from '../components/instrument';

/**
 * NUR-LESEN-Inhalt einer Person — ein Bauteil für `PersonDetailDrawer` (Personenmarke im
 * UHS-Grundriss) und die Vorschau der Sprungpalette. Der Rahmen bleibt beim Aufrufer, das
 * Bearbeiten bei der Personen-Seite.
 *
 * Oben die Patientenfragen aus dem Patientenkopf in der Lesefassung (LLH-1137, kein Nachbau):
 * Sichtung mit Zeit, „Zustand / Verdacht“, Aufenthalt bzw. Verbleib, letzte Notiz. Darunter die
 * Personendaten im `Datenraster`, leere Angaben in EINER Zeile „Ohne Angabe: …“ — kein
 * `Descriptions` (`frontend/src/personen/AGENTS.md`, „Personen-Detail“). Derselbe Query-Key wie
 * Liste und Drawer-Titel (`einsatzKeys.person`): ein Cache-Fach, ein Detail-GET je Öffnung.
 */
export default function PersonVorschau({
  einsatzId,
  personId,
}: {
  einsatzId: number;
  personId: number;
}) {
  const { token } = theme.useToken();
  const detailQuery = useQuery({
    queryKey: einsatzKeys.person(einsatzId, personId),
    queryFn: () => ladePerson(einsatzId, personId),
  });
  const p = detailQuery.data;

  return (
    <>
      {detailQuery.isLoading && <Spin />}
      {detailQuery.isError && (
        <SeitenFehler
          text="Person konnte nicht geladen werden"
          ursache={detailQuery.error}
          onWiederholen={() => void detailQuery.refetch()}
        />
      )}
      {p && (
        <Stapel abstand="lg">
          <Stapel richtung="zeile" umbruch abstand="xs" ausrichten="mitte">
            <Status darstellung={personStatusDarstellung(p.status)} />
            {p.storniert_at && <Status ton="neutral" wort="storniert" groesse="klein" />}
          </Stapel>

          <Patientenkopf einsatzId={einsatzId} person={p} modus="lesen" />

          <StammdatenRaster
            angaben={[
              { label: 'Name', wert: p.name },
              { label: 'Vorname', wert: p.vorname },
              {
                label: 'Geschlecht',
                wert: p.geschlecht ? GESCHLECHT_WORT[p.geschlecht] : null,
              },
              {
                label: 'Geburtsdatum',
                wert: p.geburtsdatum ? formatKalenderdatum(p.geburtsdatum) : null,
                mono: true,
              },
              { label: 'Alter (geschätzt)', wert: p.alter_geschaetzt, mono: true },
              { label: 'Herkunft / Adresse', wert: p.herkunft_adresse, breit: true },
              { label: 'Fundort', wert: p.antreff_ort },
              { label: 'Melder / Kontakt', wert: p.melder_kontakt, breit: true },
              { label: 'Notiz', wert: p.notiz, breit: true },
            ]}
          />

          <div>
            <Typography.Text
              type="secondary"
              style={{ fontSize: token.fontSizeSM, textTransform: 'uppercase' }}
            >
              Verlauf (neueste zuerst)
            </Typography.Text>
            <div style={{ marginTop: token.marginXXS }}>
              <PersonVerlauf person={p} />
            </div>
          </div>
        </Stapel>
      )}
    </>
  );
}
