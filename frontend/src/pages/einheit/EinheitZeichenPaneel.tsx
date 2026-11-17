import type { EinheitZeichenPatch } from '../../api/einheiten';
import type { Einheit } from '../../api/types';
import { InlineAngabe } from '../../components/InlineAngabe';
import { Datenfeld, Datenraster, Paneel, useRollen } from '../../components/instrument';
import { Select } from '../../components/Select';
import { orgVorgabe } from '../../components/vorgabeText';
import EinheitZeichen from '../../kraefte/EinheitZeichen';
import { FACHAUFGABE_OPTIONS, ORGANISATION_OPTIONS } from '../lagekarte/taktischesZeichen';

/** Speichert EIN Zeichenfeld über den Lageweg; Vertrag wie {@link EinheitPatchHandler}. */
export type EinheitZeichenHandler = (
  etikett: string,
  patch: EinheitZeichenPatch,
) => Promise<unknown>;

/** Beschriftung eines gespeicherten Werts; ein Wert außerhalb der Auswahl erscheint roh. */
function labelOf(optionen: readonly { value: string; label: string }[], wert: string | null) {
  if (wert == null) return null;
  return optionen.find((o) => o.value === wert)?.label ?? wert;
}

/**
 * Das taktische Zeichen der Einheit ohne Lagekarte pflegen (LLH-1036, design.md D4, Spec
 * `lagekarte-taktische-zeichen`): Fachaufgabe und Organisation je an ihrer Zeile, mit derselben
 * Auswahl wie Inspector und Vorlagen-Verwaltung (`pages/lagekarte/taktischesZeichen.ts`).
 * Gespeichert wird über `…/position` mit genau einem Feld, ohne Tagebuch-Eintrag wie auf der
 * Karte (Entscheidung 13.10.2026, Punkt 4).
 *
 * Beim Ändern zeigt das Eingabefeld das Zeichen mit dem gewählten Wert; das große Zeichen im
 * Kopf bleibt der gespeicherte Stand.
 */
export default function EinheitZeichenPaneel({
  einheit: e,
  canEdit,
  orgDefault,
  onPatchZeichen,
}: {
  einheit: Einheit;
  canEdit: boolean;
  /** Organisations-Vorgabe aus `/api/organisation`; `null` ohne Vorgabe. */
  orgDefault: string | null;
  onPatchZeichen: EinheitZeichenHandler;
}) {
  const { token, rollen } = useRollen();
  const fachaufgabe = e.tz_fachaufgabe ?? null;
  const organisation = e.tz_organisation ?? null;

  /** Das kleine Zeichen neben der Auswahl, aus dem Entwurf der offenen Zeile. */
  const vorschau = (entwurf: { fachaufgabe: string | null; organisation: string | null }) => (
    <EinheitZeichen tz={{ typLabel: e.typ_label ?? null, ...entwurf }} orgDefault={orgDefault} />
  );
  const zeile = (auswahl: React.ReactNode, zeichen: React.ReactNode) => (
    <div style={{ display: 'flex', alignItems: 'center', gap: token.marginSM, minWidth: 0 }}>
      <div style={{ flex: '1 1 auto', minWidth: 0 }}>{auswahl}</div>
      {zeichen}
    </div>
  );

  return (
    <Paneel titel="Taktisches Zeichen" koerperPolster>
      <Datenraster spalten={2} beschriftung="Taktisches Zeichen">
        <Datenfeld label="Fachaufgabe">
          <InlineAngabe<string | null>
            etikett="Fachaufgabe"
            wert={fachaufgabe}
            anzeige={labelOf(FACHAUFGABE_OPTIONS, fachaufgabe)}
            leer={(w) => w == null}
            darfSchreiben={canEdit}
            onSpeichern={(w) => onPatchZeichen('Fachaufgabe', { tz_fachaufgabe: w })}
            eingabe={({ feld, popup, value, onChange }) =>
              zeile(
                <Select<string>
                  {...feld}
                  {...popup}
                  allowClear
                  style={{ width: '100%' }}
                  placeholder="Fachaufgabe wählen"
                  options={FACHAUFGABE_OPTIONS}
                  value={value ?? undefined}
                  onChange={(w) => onChange(w ?? null)}
                />,
                vorschau({ fachaufgabe: value, organisation }),
              )
            }
          />
        </Datenfeld>
        <Datenfeld label="Organisation">
          <InlineAngabe<string | null>
            etikett="Organisation"
            wert={organisation}
            anzeige={labelOf(ORGANISATION_OPTIONS, organisation)}
            leer={(w) => w == null}
            darfSchreiben={canEdit}
            onSpeichern={(w) => onPatchZeichen('Organisation', { tz_organisation: w })}
            eingabe={({ feld, popup, value, onChange }) =>
              zeile(
                <Select<string>
                  {...feld}
                  {...popup}
                  allowClear
                  style={{ width: '100%' }}
                  placeholder="Organisation wählen"
                  options={ORGANISATION_OPTIONS}
                  value={value ?? undefined}
                  onChange={(w) => onChange(w ?? null)}
                />,
                vorschau({ fachaufgabe, organisation: value }),
              )
            }
          />
          {/* Leer gilt die Vorgabe der Organisation; das Zeichen im Kopf trägt sie schon. */}
          {organisation == null && orgDefault && (
            <div data-lfh="zeichen-vorgabe" style={{ color: rollen.gedaempft, fontSize: 12 }}>
              {orgVorgabe(labelOf(ORGANISATION_OPTIONS, orgDefault)!)}
            </div>
          )}
        </Datenfeld>
      </Datenraster>
    </Paneel>
  );
}
