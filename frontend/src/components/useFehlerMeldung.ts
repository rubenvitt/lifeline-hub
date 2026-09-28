import { App } from 'antd';
import { useCallback } from 'react';
import { fehlerText } from '../api/client';

/**
 * Meldet den Fehler einer Aktion als Toast, Text aus {@link fehlerText}.
 *
 * Die zurückgegebene Funktion nimmt genau EIN Argument, damit sie direkt als `onError`
 * taugt: react-query reicht dort die Variablen als zweites Argument nach.
 */
export function useFehlerMeldung(standard?: string): (e: unknown) => void {
  const { message } = App.useApp();
  return useCallback(
    (e: unknown) => {
      message.error(fehlerText(e, standard));
    },
    [message, standard],
  );
}
