/**
 * @format
 */

import { AppRegistry } from 'react-native';
import App from './App';
import { name as appName } from './app.json';

// משימת רקע לסנכרון + פוש
const BackgroundSync = async (taskData) => {
  const logT = (...args) => console.log(`[${new Date().toLocaleTimeString('he-IL')}]`, ...args);
  try {
    logT('BackgroundSync started');
    const AsyncStorage = require('@react-native-async-storage/async-storage').default;
    const { NativeModules } = require('react-native');
    const notifee = require('@notifee/react-native').default;
    const ScreenTimeModule = NativeModules.ScreenTimeModule;

    const SERVER = 'https://screentime-server.onrender.com';
    // חשוב: המפתח חייב להיות זהה בדיוק ל-TOKEN_KEY ב-App.tsx (שם: '@student_token')
    const token = await AsyncStorage.getItem('@student_token');
    if (!token) { logT('BackgroundSync: no token found, aborting'); return; }

    const hasPerm = await ScreenTimeModule.hasUsageStatsPermission();
    if (!hasPerm) { logT('BackgroundSync: no usage stats permission, aborting'); return; }

    const result = await ScreenTimeModule.fetchWeeklyUsage();
    if (!result.days || !result.days.length) { logT('BackgroundSync: no days data, aborting'); return; }

    const days = result.days.map((d) => ({
      date: d.date,
      totalMinutes: d.totalMinutes,
      byApp: d.byApp || {},
      timing: d.timing || {},
      sessionCount: d.sessionCount || 0,
      avgSessionSeconds: d.avgSessionSeconds || 0,
    }));

    const totalMin = days.reduce((sum, d) => sum + d.totalMinutes, 0);
    const dailyAvg = Math.round(totalMin / days.length / 60 * 10) / 10;

    const byApp = {};
    const timing = {};
    days.forEach((d) => {
      Object.entries(d.byApp).forEach(([k, v]) => { byApp[k] = (byApp[k] || 0) + Number(v); });
      Object.entries(d.timing).forEach(([k, v]) => { timing[k] = (timing[k] || 0) + Number(v); });
    });

    const consentStr = await AsyncStorage.getItem('@consent_settings');
    const consent = consentStr ? JSON.parse(consentStr) : {};

    // סנכרון אוטומטי מתבצע אם המשתמש אישר לפחות שיתוף זמן מסך כולל (תואם את התנאי ב-App.tsx)
    if (!consent.total) {
      logT('BackgroundSync skipped: total consent not granted');
      return;
    }

    const _todayStr = new Date().toISOString().split('T')[0];
    const _todayData = days.find(d => d.date === _todayStr);
    const sessionCount = _todayData ? (_todayData.sessionCount || 0) : 0;
    const avgSessionSeconds = _todayData ? (_todayData.avgSessionSeconds || 0) : 0;

    // ── שלב הפוש: מחושב לפני הסנכרון כדי שנוכל לדווח לשרת אם נשלח ──
    const today = new Date().toISOString().split('T')[0];
    const todayMin = days.find(d => d.date === today)?.totalMinutes || 0;
    const display = todayMin >= 60
      ? `${Math.floor(todayMin/60)}ש' ${todayMin%60 > 0 ? todayMin%60+"ד'" : ''}`
      : `${todayMin}ד'`;

    const goalStr = await AsyncStorage.getItem('@daily_goal');
    const goalHours = goalStr ? parseFloat(goalStr) : 0;
    const goalMin = goalHours * 60;
    const remaining = goalMin - todayMin;

    const hour = new Date().getHours();
    const isNoon = hour < 15;

    const noonPref = await AsyncStorage.getItem('@notify_noon');
    const eveningPref = await AsyncStorage.getItem('@notify_evening');
    const noonEnabled = noonPref === null || noonPref === 'true';
    const eveningEnabled = eveningPref === null || eveningPref === 'true';

    // קביעת סטטוס הפוש (לצורך דיווח לשרת)
    let pushStatus = 'sent';
    let pushSentAt = null;
    const pushDisabledForThisTime = (isNoon && !noonEnabled) || (!isNoon && !eveningEnabled);
    if (pushDisabledForThisTime) {
      pushStatus = isNoon ? 'skipped_noon_disabled' : 'skipped_evening_disabled';
    }

    // שליחת הפוש (רק אם ההעדפה מאפשרת)
    if (!pushDisabledForThisTime) {
      try {
        const fmtDur = (m) => m >= 60 ? (m % 60 === 0 ? Math.floor(m/60)+"ש'" : Math.floor(m/60)+"ש' "+(m%60)+"ד'") : m+"ד'";
        const over = -remaining;
        let title, body;
        if (isNoon) {
          title = 'זמן מסך בצהריים ☀️';
          body = goalMin > 0
            ? remaining > 0
              ? `השתמשת ${display}. נשארו לך ${fmtDur(remaining)} עד היעד 💪`
              : `השתמשת ${display}. אתה בחריגה של ${fmtDur(over)} מהיעד 😊`
            : `עד עכשיו השתמשת ${display} במסך — כל הכבוד!`;
        } else {
          title = 'סיכום זמן מסך יומי 🌙';
          body = goalMin > 0
            ? remaining > 0
              ? `סיימת את היום עם ${display}. נשארו לך ${fmtDur(remaining)} עד היעד 🌟`
              : `סיימת את היום עם ${display}. אתה בחריגה של ${fmtDur(over)} מהיעד — מחר אפשר לשפר 💪`
            : `סיכום יום: השתמשת ${display} במסך — כל הכבוד!`;
        }
        const channelId = await notifee.createChannel({ id: 'screentime', name: 'זמן מסך', importance: 4 });
        await notifee.displayNotification({ title, body, android: { channelId, smallIcon: 'ic_launcher' } });
        pushSentAt = new Date().toISOString();
        logT('Push displayed');
      } catch (pushErr) {
        pushStatus = 'error: ' + (pushErr?.message || String(pushErr));
        logT('Push error:', pushErr);
      }
    } else {
      logT('Push skipped:', pushStatus);
    }

    // ── סנכרון לשרת (כולל דיווח סטטוס הפוש) ──
    await fetch(`${SERVER}/api/report`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
      body: JSON.stringify({
        dailyAverage: dailyAvg,
        totalMinutes: Math.round(totalMin / 60),
        weeklyData: days.map(d => Math.round(d.totalMinutes / 60 * 10) / 10),
        byApp, timing, consent,
        sessionCount, avgSessionSeconds,
        platform: 'android',
        syncedAt: new Date().toISOString(),
        pushStatus, pushSentAt,
      }),
    });

    await AsyncStorage.setItem('@last_sync', new Date().toLocaleTimeString('he-IL'));

    logT('Background sync + push completed, status:', pushStatus);
  } catch (e) {
    logT('Background sync error:', e);
  }
};

AppRegistry.registerComponent(appName, () => App);
AppRegistry.registerHeadlessTask('BackgroundSync', () => BackgroundSync);
