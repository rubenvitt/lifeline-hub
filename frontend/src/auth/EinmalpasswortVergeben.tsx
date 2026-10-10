import { Alert, Button, Flex, Popconfirm } from 'antd';
import type { UseMutationResult } from '@tanstack/react-query';
import { useId } from 'react';
import type { BenutzerAnzeige, Einmalpasswort } from '../api/types';
import KopierbarerText from '../components/KopierbarerText';
import { SpeicherFehler } from '../components/SpeicherHinweis';
import { monoStil, useRollen } from '../components/instrument';
import { EIGENES_PASSWORT, SSO_KONTO } from '../stammdaten/rechteText';

/**
 * „Einmalpasswort vergeben“ im Bearbeiten-Dialog der Benutzerverwaltung (LFH-1121, Spec
 * `konto-einmalpasswort`). Der Server erzeugt das Passwort, beendet alle Anmeldungen der Person
 * und liefert es genau einmal; bei der nächsten Anmeldung legt die Person ein eigenes fest.
 *
 * - **Unumkehrbar → Rückfrage** (`frontend/AGENTS.md`, „Destruktiv ist nicht gleich
 *   destruktiv“): das bisherige Passwort ist danach weg. Ein Satz zur Folge, der rote Knopf nennt
 *   die Handlung.
 * - **Was der Server sicher ablehnt, steht gesperrt mit Grund:** das eigene Konto (das Passwort
 *   wechselt der Admin im Profil) und ein SSO-Konto ohne lokales Passwort.
 * - **Das Passwort lebt nur im Zustand der Mutation**, nie im Query-Cache. Die Mutation hält
 *   `BenutzerPage`: solange sie läuft, sperrt der Dialog jeden Ausweg (sonst ginge das schon
 *   gesetzte Passwort mit dem Dialog verloren), und beim Schließen räumt sie `reset()`.
 */
export default function EinmalpasswortVergeben({
  benutzer,
  eigenesKonto,
  vergeben,
}: {
  benutzer: BenutzerAnzeige;
  eigenesKonto: boolean;
  /** `POST /api/benutzer/{id}/einmalpasswort`, Variable ist die Benutzer-id. */
  vergeben: UseMutationResult<Einmalpasswort, Error, number>;
}) {
  const { token, rollen } = useRollen();
  const grundId = useId();

  const sperrGrund = eigenesKonto
    ? EIGENES_PASSWORT
    : !benutzer.passwort_gesetzt
      ? SSO_KONTO
      : null;

  if (vergeben.data) {
    return (
      <Alert
        type="success"
        showIcon
        title={`Einmalpasswort für ${benutzer.anzeigename}`}
        description={
          <Flex vertical gap={token.marginXXS}>
            <KopierbarerText text={vergeben.data.einmalpasswort} bezeichnung="Einmalpasswort">
              <span style={monoStil(token.fontSizeLG, 500)}>{vergeben.data.einmalpasswort}</span>
            </KopierbarerText>
            <span>Wird nur jetzt angezeigt.</span>
          </Flex>
        }
      />
    );
  }

  return (
    <Flex vertical gap={token.marginXXS} align="flex-start">
      <Popconfirm
        title="Einmalpasswort vergeben?"
        description={`Das bisherige Passwort gilt nicht mehr, und alle Anmeldungen von ${benutzer.anzeigename} enden.`}
        okText="Einmalpasswort vergeben"
        okButtonProps={{ danger: true }}
        onConfirm={() => vergeben.mutate(benutzer.id)}
        disabled={sperrGrund !== null || vergeben.isPending}
      >
        <Button
          loading={vergeben.isPending}
          disabled={sperrGrund !== null}
          aria-describedby={sperrGrund !== null ? grundId : undefined}
        >
          Einmalpasswort vergeben
        </Button>
      </Popconfirm>
      {sperrGrund !== null && (
        <span id={grundId} style={{ fontSize: token.fontSizeSM, color: rollen.text2 }}>
          {sperrGrund}
        </span>
      )}
      <SpeicherFehler fehler={vergeben.error} titel="Kein Einmalpasswort vergeben" />
    </Flex>
  );
}
