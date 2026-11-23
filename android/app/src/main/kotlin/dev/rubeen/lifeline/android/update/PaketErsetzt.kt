package dev.rubeen.lifeline.android.update

import android.Manifest
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import dev.rubeen.lifeline.android.BuildConfig
import dev.rubeen.lifeline.android.LifelineApp
import dev.rubeen.lifeline.android.MainActivity
import dev.rubeen.lifeline.android.R
import dev.rubeen.lifeline.android.dienste.Systemdienste

/**
 * Meldung des Systems nach einem Update der App (`ACTION_MY_PACKAGE_REPLACED`, Entwurf D9). Die
 * App kann sich danach nicht selbst öffnen (Android sperrt Starts aus dem Hintergrund); sie meldet
 * sich deshalb mit „Lifeline aktualisiert – zum Öffnen tippen“, sofern Meldungen erlaubt sind.
 * Der Updater räumt dabei das installierte Update weg.
 */
class PaketErsetzt : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != Intent.ACTION_MY_PACKAGE_REPLACED) return
        // Beim Bau räumt der Updater ein installiertes Update weg.
        (context.applicationContext as LifelineApp).updater
        melde(context)
    }

    private fun melde(context: Context) {
        val verwaltung = NotificationManagerCompat.from(context)
        if (!verwaltung.areNotificationsEnabled()) return
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
            ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
        ) {
            return
        }
        Systemdienste.meldungskanal(context)
        val oeffnen = PendingIntent.getActivity(
            context,
            0,
            Intent(context, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
        val meldung = NotificationCompat.Builder(context, Systemdienste.KANAL)
            .setSmallIcon(R.drawable.symbol_meldung)
            .setContentTitle(TITEL)
            .setContentText("Version ${BuildConfig.VERSION_NAME}")
            .setContentIntent(oeffnen)
            .setAutoCancel(true)
            .build()
        try {
            verwaltung.notify(MELDUNG_ID, meldung)
        } catch (_: SecurityException) {
            // Zwischen Prüfung und Meldung entzogen: dann eben ohne Meldung.
        }
    }

    companion object {
        const val TITEL = "Lifeline aktualisiert – zum Öffnen tippen"

        /** Eigene Kennung, damit die Meldungen der Oberfläche (ab 0 gezählt) sie nicht ersetzen. */
        const val MELDUNG_ID = Int.MAX_VALUE
    }
}
