package com.screentimestudent2

import android.app.AppOpsManager
import android.app.usage.UsageStatsManager
import android.content.Context
import android.content.Intent
import android.os.Process
import android.provider.Settings
import com.facebook.react.bridge.*
import java.text.SimpleDateFormat
import java.util.*

class ScreenTimeModule(private val reactContext: ReactApplicationContext)
    : ReactContextBaseJavaModule(reactContext) {

    override fun getName() = "ScreenTimeModule"

    @ReactMethod
    fun hasUsageStatsPermission(promise: Promise) {
        val appOps = reactContext.getSystemService(Context.APP_OPS_SERVICE) as AppOpsManager
        val mode = appOps.checkOpNoThrow(
            AppOpsManager.OPSTR_GET_USAGE_STATS,
            Process.myUid(),
            reactContext.packageName
        )
        promise.resolve(mode == AppOpsManager.MODE_ALLOWED)
    }

    @ReactMethod
    fun requestUsageStatsPermission(promise: Promise) {
        try {
            val intent = Intent(Settings.ACTION_USAGE_ACCESS_SETTINGS)
            intent.flags = Intent.FLAG_ACTIVITY_NEW_TASK
            reactContext.startActivity(intent)
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("ERROR", e.message)
        }
    }

    @ReactMethod
    fun fetchWeeklyUsage(promise: Promise) {
        val usageStatsManager = reactContext.getSystemService(Context.USAGE_STATS_SERVICE)
                as UsageStatsManager

        val calendar = Calendar.getInstance()
        val endTime = calendar.timeInMillis
        calendar.add(Calendar.DAY_OF_YEAR, -7)
        val startTime = calendar.timeInMillis

        val queryResult = usageStatsManager.queryUsageStats(
            UsageStatsManager.INTERVAL_DAILY,
            startTime,
            endTime
        )

        val dateFormat = SimpleDateFormat("yyyy-MM-dd", Locale.getDefault())
        val dayMap = mutableMapOf<String, Long>()
        val appMap = mutableMapOf<String, MutableMap<String, Long>>()

        queryResult.forEach { stats ->
            if (stats.totalTimeInForeground > 0 && stats.packageName != reactContext.packageName) {
                // משתמשים ב-lastTimeUsed ולא ב-firstTimeStamp לקביעת התאריך: firstTimeStamp מייצג
                // את תחילת ה"דלי" הפנימי המשותף של אנדרואיד (לא מתי האפליקציה בפועל נפתחה),
                // בעוד ש-lastTimeUsed הוא הזמן האמיתי והספציפי-לאפליקציה של השימוש האחרון בה.
                // האפליקציה שלנו עצמה (בדיקת זמן המסך) מוחרגת - שימוש באפליקציית המעקב עצמה
                // לא אמור להיספר כ"זמן מסך" של התלמיד.
                val dateKey = dateFormat.format(Date(stats.lastTimeUsed))
                dayMap[dateKey] = (dayMap[dateKey] ?: 0L) + stats.totalTimeInForeground
                val apps = appMap.getOrPut(dateKey) { mutableMapOf() }
                apps[stats.packageName] = (apps[stats.packageName] ?: 0L) + stats.totalTimeInForeground
            }
        }

        val daysArray = WritableNativeArray()
        dayMap.toSortedMap().forEach { (date, totalMs) ->
            val byApp = WritableNativeMap()
            appMap[date]?.forEach { (pkg, ms) -> byApp.putInt(pkg, (ms / 60000).toInt()) }

            // נתונים משלימים ל"אופי השימוש" (פתיחות מסך, אורך ממוצע, פילוח שעות) - מחושבים בנפרד
            // מהחישוב הראשי היציב, כדי שאי-דיוק כאן לא ישפיע על הסך הכולל/היעד/הכוכבים.
            var sessionCount = 0
            var sessionDurationTotalMs = 0L
            val timingMs = mutableMapOf("morning" to 0L, "noon" to 0L, "evening" to 0L, "night" to 0L)
            try {
                val dayCal = dateFormat.parse(date)?.let { Calendar.getInstance().apply { time = it } }
                if (dayCal != null) {
                    dayCal.set(Calendar.HOUR_OF_DAY, 0); dayCal.set(Calendar.MINUTE, 0)
                    dayCal.set(Calendar.SECOND, 0); dayCal.set(Calendar.MILLISECOND, 0)
                    val dayStart = dayCal.timeInMillis
                    val dayEnd = minOf(dayStart + 24L * 60 * 60 * 1000, System.currentTimeMillis())
                    if (dayEnd > dayStart) {
                        val events = usageStatsManager.queryEvents(dayStart, dayEnd)
                        val event = android.app.usage.UsageEvents.Event()
                        val resumeTimes = mutableMapOf<String, Long>()
                        while (events.hasNextEvent()) {
                            events.getNextEvent(event)
                            val pkg = event.packageName ?: continue
                            if (pkg == reactContext.packageName) continue // מחריגים את האפליקציה שלנו
                            when (event.eventType) {
                                android.app.usage.UsageEvents.Event.ACTIVITY_RESUMED,
                                android.app.usage.UsageEvents.Event.MOVE_TO_FOREGROUND -> {
                                    resumeTimes[pkg] = event.timeStamp
                                    sessionCount++
                                }
                                android.app.usage.UsageEvents.Event.ACTIVITY_PAUSED,
                                android.app.usage.UsageEvents.Event.MOVE_TO_BACKGROUND -> {
                                    val startedAt = resumeTimes.remove(pkg)
                                    if (startedAt != null) {
                                        val dur = (event.timeStamp - startedAt).coerceAtLeast(0)
                                        sessionDurationTotalMs += dur
                                        val hourCal = Calendar.getInstance().apply { timeInMillis = startedAt }
                                        val hour = hourCal.get(Calendar.HOUR_OF_DAY)
                                        val bucket = when {
                                            hour in 6..11 -> "morning"
                                            hour in 12..16 -> "noon"
                                            hour in 17..20 -> "evening"
                                            else -> "night"
                                        }
                                        timingMs[bucket] = (timingMs[bucket] ?: 0L) + dur
                                    }
                                }
                            }
                        }
                    }
                }
            } catch (e: Exception) { /* אם ה-timing נכשל, פשוט נשאר 0 - לא פוגע בשאר הנתונים */ }
            val avgSessionSeconds = if (sessionCount > 0) (sessionDurationTotalMs / 1000.0 / sessionCount) else 0.0
            val timing = WritableNativeMap().apply {
                putInt("morning", ((timingMs["morning"] ?: 0L) / 60000).toInt())
                putInt("noon", ((timingMs["noon"] ?: 0L) / 60000).toInt())
                putInt("evening", ((timingMs["evening"] ?: 0L) / 60000).toInt())
                putInt("night", ((timingMs["night"] ?: 0L) / 60000).toInt())
            }

            val dayEntry = WritableNativeMap().apply {
                putString("date", date)
                putInt("totalMinutes", (totalMs / 60000).toInt())
                putMap("byApp", byApp)
                putInt("sessionCount", sessionCount)
                putDouble("avgSessionSeconds", avgSessionSeconds)
                putMap("timing", timing)
            }
            daysArray.pushMap(dayEntry)
        }

        val result = WritableNativeMap().apply { putArray("days", daysArray) }
        promise.resolve(result)
    }
}