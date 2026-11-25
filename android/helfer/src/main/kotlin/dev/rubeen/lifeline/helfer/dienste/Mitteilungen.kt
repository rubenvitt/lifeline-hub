package dev.rubeen.lifeline.helfer.dienste

import android.Manifest
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import dev.rubeen.lifeline.helfer.MainActivity
import dev.rubeen.lifeline.helfer.R
import dev.rubeen.lifeline.helferkern.Auftraege
import dev.rubeen.lifeline.helferkern.HelperTask

/**
 * Mitteilungen zu Aufträgen (ADR-0105, Entwurf „Empfang“): Kanal „Aufträge“ mit hoher Wichtigkeit,
 * Ton und Vibration. Auf dem Sperrbildschirm nur „Neuer Auftrag“ (`VISIBILITY_PRIVATE` mit
 * öffentlicher Fassung); Tippen öffnet das Detail. Ob eine Mitteilung kommt, entscheidet
 * `Auftraege.sollMitteilen` im Kern.
 */
object Mitteilungen {
    const val KANAL = "auftraege"

    /** Intent-Extra mit der Kennung des Auftrags, den die App im Detail öffnet. */
    const val EXTRA_AUFTRAG = "lifeline.helfer.auftrag"

    private const val TAG = "auftrag"

    fun legeKanalAn(context: Context) {
        val manager = context.getSystemService(NotificationManager::class.java) ?: return
        val kanal = NotificationChannel(KANAL, Auftraege.KANAL, NotificationManager.IMPORTANCE_HIGH).apply {
            description = "Neue Aufträge der Einsatzleitung an deine Einheit, dein Fahrzeug oder dich."
            enableVibration(true)
            // Ton: der Standardton des Systems (Voreinstellung eines Kanals mit hoher Wichtigkeit).
            lockscreenVisibility = Notification.VISIBILITY_PRIVATE
        }
        manager.createNotificationChannel(kanal)
    }

    /**
     * Ob Mitteilungen ankommen: ab Android 13 das Recht `POST_NOTIFICATIONS`, immer dazu der
     * Schalter der App in den Einstellungen.
     */
    fun isErlaubt(context: Context): Boolean {
        val recht = Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU ||
            context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED
        val manager = context.getSystemService(NotificationManager::class.java)
        return recht && manager?.areNotificationsEnabled() != false
    }

    /** Die Mitteilung zu [a]; ohne Recht nichts (die Seite zeigt dann den Hinweis). */
    fun zeige(context: Context, a: HelperTask) {
        if (!isErlaubt(context)) return
        legeKanalAn(context)
        context.getSystemService(NotificationManager::class.java)?.notify(TAG, kennung(a.id), baue(context, a))
    }

    /** Nimmt die Mitteilung zu einem Auftrag weg (übernommen, aufgehoben oder geöffnet). */
    fun entferne(context: Context, auftragId: Long) {
        context.getSystemService(NotificationManager::class.java)?.cancel(TAG, kennung(auftragId))
    }

    /** Alle Mitteilungen zu Aufträgen weg (Ende der Kopplung). */
    fun entferneAlle(context: Context, auftraege: List<HelperTask>) {
        auftraege.forEach { entferne(context, it.id) }
    }

    fun baue(context: Context, a: HelperTask): Notification {
        val oeffnen = PendingIntent.getActivity(
            context,
            kennung(a.id),
            Intent(context, MainActivity::class.java)
                .putExtra(EXTRA_AUFTRAG, a.id)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
        val titel = buildList {
            add(a.number?.let { "Auftrag $it" } ?: "Auftrag")
            if (a.priority != "normal") add(Auftraege.prioritaet(a.priority))
        }.joinToString(" · ")
        val text = listOfNotNull(a.text, a.location?.let { "Ort: $it" }).joinToString("\n")
        val oeffentlich = Notification.Builder(context, KANAL)
            .setSmallIcon(R.drawable.symbol_auftrag)
            .setContentTitle(Auftraege.MITTEILUNG_OEFFENTLICH)
            .build()
        return Notification.Builder(context, KANAL)
            .setSmallIcon(R.drawable.symbol_auftrag)
            .setContentTitle(titel)
            .setContentText(a.text)
            .setStyle(Notification.BigTextStyle().bigText(text))
            .setCategory(Notification.CATEGORY_MESSAGE)
            .setVisibility(Notification.VISIBILITY_PRIVATE)
            .setPublicVersion(oeffentlich)
            .setContentIntent(oeffnen)
            .setAutoCancel(true)
            .build()
    }

    /** Kennung der Mitteilung je Auftrag (mit eigenem Tag, getrennt von der des Dienstes). */
    private fun kennung(auftragId: Long): Int = auftragId.hashCode()
}
