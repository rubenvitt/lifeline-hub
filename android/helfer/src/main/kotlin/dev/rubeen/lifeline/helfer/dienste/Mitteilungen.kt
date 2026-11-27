package dev.rubeen.lifeline.helfer.dienste

import android.Manifest
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.media.AudioAttributes
import android.net.Uri
import android.os.Build
import dev.rubeen.lifeline.helfer.MainActivity
import dev.rubeen.lifeline.helfer.PagerActivity
import dev.rubeen.lifeline.helfer.R
import dev.rubeen.lifeline.helferkern.Auftraege
import dev.rubeen.lifeline.helferkern.HelperTask

/**
 * Mitteilungen zu Aufträgen (ADR-0111, Entwurf „Empfang“; Pager LLH-2157): Kanal „Aufträge“ mit
 * hoher Wichtigkeit, eigenem Pagerton über die Weckerlautstärke (klingelt auch lautlos), langer
 * Vibration und Dauerton (`FLAG_INSISTENT`), bis man die Mitteilung anfasst. Dazu das Vollbild
 * [PagerActivity] über dem Sperrbildschirm (Full-Screen-Intent), das nur „Neuer Auftrag“ zeigt.
 * Auf dem Sperrbildschirm nur „Neuer Auftrag“ (`VISIBILITY_PRIVATE` mit öffentlicher Fassung);
 * Tippen öffnet das Detail. Ob eine Mitteilung kommt, entscheidet `Auftraege.sollMitteilen`, ob
 * eine Erinnerung kommt `Auftraege.erinnerungFaellig` im Kern.
 */
object Mitteilungen {
    /**
     * Kanal mit Pagerton. Ein Kanal ist nach dem Anlegen unveränderlich (Ton, Audio): darum eine
     * neue Kennung statt [KANAL_ALT], der beim Anlegen wegfällt.
     */
    const val KANAL = "auftraege-pager"
    private const val KANAL_ALT = "auftraege"

    /** Langes Vibrieren wie ein Pager: dreimal kurz, Pause, wiederholt im Muster des Kanals. */
    private val VIBRATION = longArrayOf(0, 400, 150, 400, 150, 400, 600, 400, 150, 400, 150, 400)

    /** Intent-Extra mit der Kennung des Auftrags, den die App im Detail öffnet. */
    const val EXTRA_AUFTRAG = "lifeline.helfer.auftrag"

    private const val TAG = "auftrag"

    fun legeKanalAn(context: Context) {
        val manager = context.getSystemService(NotificationManager::class.java) ?: return
        manager.deleteNotificationChannel(KANAL_ALT)
        val kanal = NotificationChannel(KANAL, Auftraege.KANAL, NotificationManager.IMPORTANCE_HIGH).apply {
            description = "Neue Aufträge der Einsatzleitung an deine Einheit, dein Fahrzeug oder dich."
            enableVibration(true)
            vibrationPattern = VIBRATION
            // Pagerton über die Weckerlautstärke: klingelt auch, wenn das Handy lautlos ist.
            setSound(
                pagerton(context),
                AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_ALARM)
                    .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                    .build(),
            )
            // Wirkt nur, wenn die Person der App „Nicht stören“ freigibt; sonst ohne Folgen.
            setBypassDnd(true)
            lockscreenVisibility = Notification.VISIBILITY_PRIVATE
        }
        manager.createNotificationChannel(kanal)
    }

    /** `res/raw/pagerton.wav` (`scripts/helfer/pagerton.sh`). */
    private fun pagerton(context: Context): Uri =
        Uri.parse("android.resource://${context.packageName}/${R.raw.pagerton}")

    /**
     * Ob das Vollbild über dem Sperrbildschirm erlaubt ist (ab Android 14 ein eigenes Recht,
     * `USE_FULL_SCREEN_INTENT`). Ohne bleibt es bei der Mitteilung mit Dauerton.
     */
    fun isVollbildErlaubt(context: Context): Boolean =
        Build.VERSION.SDK_INT < Build.VERSION_CODES.UPSIDE_DOWN_CAKE ||
            context.getSystemService(NotificationManager::class.java)?.canUseFullScreenIntent() == true

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

    /**
     * Die Mitteilung zu [a], klingelnd mit Dauerton und Vollbild; [erinnerung] ist die Stufe einer
     * Erinnerung (0 beim ersten Mal). Ohne Recht nichts (die Seite zeigt dann den Hinweis).
     */
    fun zeige(context: Context, a: HelperTask, erinnerung: Int = 0) {
        if (!isErlaubt(context)) return
        legeKanalAn(context)
        val n = baue(context, a, erinnerung, klingeln = true)
        context.getSystemService(NotificationManager::class.java)?.notify(TAG, kennung(a.id), n)
    }

    /**
     * Beendet den Dauerton zu [auftragId], ohne die Mitteilung zu entfernen: neu gesetzt ohne
     * `FLAG_INSISTENT`, ohne Vollbild und ohne erneuten Ton (das Vollbild ist sichtbar).
     */
    fun stumm(context: Context, auftragId: Long) {
        val a = Auftragsstand.liste.value.firstOrNull { it.id == auftragId } ?: return
        if (!isErlaubt(context)) return
        val n = baue(context, a, Auftragsstand.erinnerungsstufe(a.id), klingeln = false)
        context.getSystemService(NotificationManager::class.java)?.notify(TAG, kennung(a.id), n)
    }

    /** Nimmt die Mitteilung zu einem Auftrag weg (übernommen, aufgehoben oder geöffnet). */
    fun entferne(context: Context, auftragId: Long) {
        context.getSystemService(NotificationManager::class.java)?.cancel(TAG, kennung(auftragId))
    }

    /** Alle Mitteilungen zu Aufträgen weg (Ende der Kopplung). */
    fun entferneAlle(context: Context, auftraege: List<HelperTask>) {
        auftraege.forEach { entferne(context, it.id) }
    }

    fun baue(context: Context, a: HelperTask, erinnerung: Int = 0, klingeln: Boolean = true): Notification {
        val oeffnen = PendingIntent.getActivity(
            context,
            kennung(a.id),
            Intent(context, MainActivity::class.java)
                .putExtra(EXTRA_AUFTRAG, a.id)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
        val titel = (if (erinnerung > 0) Auftraege.ERINNERUNG else "") + buildList {
            add(a.number?.let { "Auftrag $it" } ?: "Auftrag")
            if (a.priority != "normal") add(Auftraege.prioritaet(a.priority))
        }.joinToString(" · ")
        val text = listOfNotNull(a.text, a.location?.let { "Ort: $it" }).joinToString("\n")
        val oeffentlich = Notification.Builder(context, KANAL)
            .setSmallIcon(R.drawable.symbol_auftrag)
            .setContentTitle(if (erinnerung > 0) Auftraege.ERINNERUNG_OEFFENTLICH else Auftraege.MITTEILUNG_OEFFENTLICH)
            .build()
        val builder = Notification.Builder(context, KANAL)
            .setSmallIcon(R.drawable.symbol_auftrag)
            .setContentTitle(titel)
            .setContentText(a.text)
            .setStyle(Notification.BigTextStyle().bigText(text))
            .setCategory(Notification.CATEGORY_ALARM)
            .setVisibility(Notification.VISIBILITY_PRIVATE)
            .setPublicVersion(oeffentlich)
            .setContentIntent(oeffnen)
            .setAutoCancel(true)
            .setOnlyAlertOnce(!klingeln)
        if (klingeln) builder.setFullScreenIntent(vollbild(context, a.id, erinnerung), true)
        val n = builder.build()
        // Dauerton, bis die Mitteilung angefasst, das Vollbild gezeigt oder sie entfernt wird.
        if (klingeln) n.flags = n.flags or Notification.FLAG_INSISTENT
        return n
    }

    /** Das Vollbild [PagerActivity] zu einem Auftrag (eigene Kennung je Auftrag). */
    private fun vollbild(context: Context, auftragId: Long, erinnerung: Int): PendingIntent =
        PendingIntent.getActivity(
            context,
            kennung(auftragId),
            Intent(context, PagerActivity::class.java)
                .putExtra(EXTRA_AUFTRAG, auftragId)
                .putExtra(PagerActivity.EXTRA_ERINNERUNG, erinnerung)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_NO_USER_ACTION),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )

    /** Kennung der Mitteilung je Auftrag (mit eigenem Tag, getrennt von der des Dienstes). */
    private fun kennung(auftragId: Long): Int = auftragId.hashCode()
}
