package dev.rubeen.lifeline.android.update

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/**
 * Meldung des Systems nach einem Update der App (`ACTION_MY_PACKAGE_REPLACED`, Entwurf D9). Bis
 * der Updater steht, tut sie nichts.
 */
class PaketErsetzt : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) = Unit
}
