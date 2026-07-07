import React, {useEffect, useState, useCallback, useRef} from 'react';
import {useWindowDimensions, Modal, Animated} from 'react-native';
import {
  View, Text, ScrollView, TouchableOpacity, Switch,
  StyleSheet, Alert, ActivityIndicator, RefreshControl,
  SafeAreaView, StatusBar, Platform, TextInput, KeyboardAvoidingView,
  AppState, AppStateStatus,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import DateTimePicker from '@react-native-community/datetimepicker';
import BackgroundFetch from 'react-native-background-fetch';
import notifee, { AndroidImportance, TriggerType, RepeatFrequency } from '@notifee/react-native';

const SERVER = 'https://screentime-server.onrender.com';
const APP_VERSION = '4.7';
const TOKEN_KEY = '@student_token';
const CONSENT_KEY = '@consent_settings';

interface ConsentSettings {
  total: boolean; byApp: boolean; timing: boolean; classAverage: boolean;
}
interface StudentInfo {
  id: string; name: string; className: string; teacherName: string; platform: string; consent: boolean;
}

function generateDemoData() {
  const apps = ['com.tiktok','com.youtube','com.instagram','com.whatsapp','com.facebook'];
  return Array.from({length: 7}, (_, i) => {
    const date = new Date();
    date.setDate(date.getDate() - (6 - i));
    const totalMinutes = Math.floor(Math.random() * 300) + 60;
    const byApp: Record<string,number> = {};
    let remaining = totalMinutes;
    apps.forEach((app, j) => {
      const mins = j < apps.length - 1 ? Math.floor(remaining * (0.3 - j * 0.05)) : remaining;
      byApp[app] = Math.max(0, mins);
      remaining -= byApp[app];
    });
    return {date: date.toISOString().split('T')[0], totalMinutes, byApp};
  });
}

const {NativeModules} = require('react-native');
const ScreenTimeModule = NativeModules.ScreenTimeModule;

async function fetchRealScreenTime(): Promise<{date: string, totalMinutes: number}[]> {
  if (Platform.OS !== 'android' || !ScreenTimeModule) return generateDemoData();
  try {
    const hasPerm = await ScreenTimeModule.hasUsageStatsPermission();
    if (!hasPerm) {
      await ScreenTimeModule.requestUsageStatsPermission();
      return generateDemoData();
    }
    const result = await ScreenTimeModule.fetchWeeklyUsage();
    if (result.days && result.days.length > 0) {
      return result.days.map((d: any) => ({date: d.date, totalMinutes: d.totalMinutes, byApp: d.byApp || {}, timing: d.timing || {}, sessionCount: d.sessionCount || 0, avgSessionSeconds: d.avgSessionSeconds || 0}));
    }
    return generateDemoData();
  } catch(e) {
    return generateDemoData();
  }
}

// לוג עם חותמת זמן - נוח למעקב אחרי מתי דברים קרו בפועל בקונסול המטרו
function logT(...args: any[]) {
  console.log(`[${new Date().toLocaleTimeString('he-IL')}]`, ...args);
}

function toDisplay(min: number) {
  if (min < 60) return `${min}ד'`;
  const h = Math.floor(min / 60), m = min % 60;
  return m > 0 ? `${h}ש' ${m}ד'` : `${h}ש'`;
}
function sColor(min: number) { const h = min/60; return h<3?'#3B6D11':h<6?'#854F0B':'#A32D2D'; }
function sLabel(min: number) { const h = min/60; return h<3?'תקין':h<6?'מתון':'גבוה'; }
const DAYS = ['א','ב','ג','ד','ה','ו','ש'];

// ─── מסך ברוך הבא ─────────────────────────────────────────────────────────────
function WelcomeScreen({onRegister, onLogin}: {onRegister:()=>void, onLogin:()=>void}) {
  return (
    <SafeAreaView style={s.safe}>
      <View style={s.loginWrap}>
        <View style={s.loginCard}>
          <Text style={s.loginTitle}>מעקב זמן מסך</Text>
          <Text style={s.loginSub}>ברוך הבא!</Text>
          <TouchableOpacity style={s.loginBtn} onPress={onRegister}>
            <Text style={s.loginBtnTxt}>הרשמה ראשונה</Text>
          </TouchableOpacity>
          <TouchableOpacity style={s.secondaryBtn} onPress={onLogin}>
            <Text style={s.secondaryBtnTxt}>כבר יש לי חשבון — כניסה</Text>
          </TouchableOpacity>
        </View>
      </View>
    </SafeAreaView>
  );
}

// ─── מסך הרשמה ──────────────────────────────────────────────────────────────
function RegisterScreen({onDone, onBack}: {onDone:(tok:string,info:StudentInfo)=>void, onBack:()=>void}) {
  const [step, setStep] = useState<'code'|'details'>('code');
  const [institutionCode, setInstitutionCode] = useState('');
  const [teacherName, setTeacherName] = useState('');
  const [teacherId, setTeacherId] = useState('');
  const [name, setName] = useState('');
  const [className, setClassName] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [password2, setPassword2] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function checkCode() {
    if (!institutionCode.trim()) {setError('נא להכניס קוד מוסד'); return;}
    setLoading(true); setError('');
    try {
      const res = await fetch(`${SERVER}/api/institution/${institutionCode.trim()}`);
      const data = await res.json();
      if (!data.ok) {setError(data.error || 'קוד לא תקף'); setLoading(false); return;}
      setTeacherName(data.teacherName);
      setTeacherId(data.teacherId);
      setStep('details');
    } catch(e) {setError('לא ניתן להתחבר לשרת');}
    setLoading(false);
  }

  async function register() {
    if (!name.trim()) {setError('נא להכניס שם מלא'); return;}
    if (!className.trim()) {setError('נא להכניס כיתה'); return;}
    if (!username.trim()) {setError('נא לבחור שם משתמש'); return;}
    if (password.length < 4) {setError('הסיסמה חייבת להכיל לפחות 4 תווים'); return;}
    if (password !== password2) {setError('הסיסמאות אינן תואמות'); return;}
    setLoading(true); setError('');
    try {
      const res = await fetch(`${SERVER}/api/student/register`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({institutionCode: institutionCode.trim(), username: username.trim(), password, name: name.trim(), className: className.trim()}),
      });
      const data = await res.json();
      if (!data.ok) {setError(data.error || 'שגיאה'); setLoading(false); return;}
      onDone(data.token, data.student);
    } catch(e) {setError('לא ניתן להתחבר לשרת');}
    setLoading(false);
  }

  return (
    <SafeAreaView style={s.safe}>
      <KeyboardAvoidingView behavior={Platform.OS==='ios'?'padding':undefined} style={s.loginWrap}>
        <ScrollView contentContainerStyle={s.loginCard}>
          {step === 'code' ? (
            <>
              <Text style={s.loginTitle}>הרשמה</Text>
              <Text style={s.loginSub}>הכנס את קוד המוסד שקיבלת מהמורה</Text>
              {error ? <View style={s.errBox}><Text style={s.errTxt}>{error}</Text></View> : null}
              {loading ? <ActivityIndicator color="#185FA5" style={{marginVertical: 20}}/> : (
                <>
                  <TextInput
                    style={s.input}
                    placeholder="קוד מוסד (6 ספרות)"
                    placeholderTextColor="#9a9a94"
                    value={institutionCode}
                    onChangeText={setInstitutionCode}
                    keyboardType="number-pad"
                    maxLength={6}
                    textAlign="right"
                  />
                  <TouchableOpacity style={s.loginBtn} onPress={checkCode}>
                    <Text style={s.loginBtnTxt}>המשך</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={s.secondaryBtn} onPress={onBack}>
                    <Text style={s.secondaryBtnTxt}>חזור</Text>
                  </TouchableOpacity>
                </>
              )}
            </>
          ) : (
            <>
              <Text style={s.loginTitle}>פרטים אישיים</Text>
              <View style={s.infoBox}>
                <Text style={s.infoTxt}>מורה: {teacherName}</Text>
                <Text style={s.infoSub}>מלא את הפרטים שלך</Text>
              </View>
              {error ? <View style={s.errBox}><Text style={s.errTxt}>{error}</Text></View> : null}
              <TextInput style={s.input} placeholder="שם מלא" placeholderTextColor="#9a9a94" value={name} onChangeText={setName} textAlign="right"/>
              <TextInput style={s.input} placeholder="כיתה (למשל ט׳2)" placeholderTextColor="#9a9a94" value={className} onChangeText={setClassName} textAlign="right"/>
              <TextInput style={s.input} placeholder="שם משתמש (באנגלית)" placeholderTextColor="#9a9a94" value={username} onChangeText={setUsername} autoCapitalize="none" autoCorrect={false} textAlign="right"/>
              <TextInput style={s.input} placeholder="סיסמה (לפחות 4 תווים)" placeholderTextColor="#9a9a94" value={password} onChangeText={setPassword} secureTextEntry textAlign="right" textContentType="oneTimeCode"/>
              <TextInput style={s.input} placeholder="אמת סיסמה" placeholderTextColor="#9a9a94" value={password2} onChangeText={setPassword2} secureTextEntry textAlign="right" textContentType="oneTimeCode"/>
              <TouchableOpacity style={[s.loginBtn, loading&&{opacity:0.6}]} onPress={register} disabled={loading}>
                {loading ? <ActivityIndicator color="#fff"/> : <Text style={s.loginBtnTxt}>הירשם</Text>}
              </TouchableOpacity>
            </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

// ─── מסך כניסה ────────────────────────────────────────────────────────────────
function LoginScreen({onDone, onBack}: {onDone:(tok:string,info:StudentInfo)=>void, onBack:()=>void}) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function login() {
    if (!username.trim()||!password) {setError('נא למלא שם משתמש וסיסמה'); return;}
    setLoading(true); setError('');
    try {
      const res = await fetch(`${SERVER}/api/student/login`, {
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({username:username.trim(), password}),
      });
      const data = await res.json();
      if (!data.ok) {setError(data.error||'שגיאה'); setLoading(false); return;}
      onDone(data.token, data.student);
    } catch(e) {setError('לא ניתן להתחבר לשרת');}
    setLoading(false);
  }

  return (
    <SafeAreaView style={s.safe}>
      <KeyboardAvoidingView behavior={Platform.OS==='ios'?'padding':undefined} style={s.loginWrap}>
        <View style={s.loginCard}>
          <Text style={s.loginTitle}>כניסה</Text>
          <Text style={s.loginSub}>הכנס שם משתמש וסיסמה</Text>
          {error ? <View style={s.errBox}><Text style={s.errTxt}>{error}</Text></View> : null}
          <TextInput style={s.input} placeholder="שם משתמש" placeholderTextColor="#9a9a94" value={username} onChangeText={setUsername} autoCapitalize="none" autoCorrect={false} textAlign="right"/>
          <TextInput style={s.input} placeholder="סיסמה" placeholderTextColor="#9a9a94" value={password} onChangeText={setPassword} secureTextEntry textAlign="right"/>
          <TouchableOpacity style={[s.loginBtn, loading&&{opacity:0.6}]} onPress={login} disabled={loading}>
            {loading ? <ActivityIndicator color="#fff"/> : <Text style={s.loginBtnTxt}>כניסה</Text>}
          </TouchableOpacity>
          <TouchableOpacity style={s.secondaryBtn} onPress={onBack}>
            <Text style={s.secondaryBtnTxt}>חזור</Text>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

// ─── אפליקציה ראשית ──────────────────────────────────────────────────────────
export default function App() {
  const {width: screenWidth} = useWindowDimensions();
  const appState = useRef(AppState.currentState);
  const syncInterval = useRef<ReturnType<typeof setInterval>|null>(null);
  const [screen, setScreen] = useState<'welcome'|'register'|'login'|'main'>('welcome');
  const [authToken, setAuthToken] = useState<string|null>(null);
  const [studentInfo, setStudentInfo] = useState<StudentInfo|null>(null);
  const [consent, setConsent] = useState<ConsentSettings>({total:false,byApp:false,timing:false,classAverage:false});
  const [weeklyData, setWeeklyData] = useState(generateDemoData());
  const [syncing, setSyncing] = useState(false);
  const [lastSync, setLastSync] = useState<string|null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [todayMood, setTodayMood] = useState<string|null>(null);
  const [sendingMood, setSendingMood] = useState(false);
  const [classAverage, setClassAverage] = useState<{classAvg:number,studentCount:number,className:string}|null>(null);
  const [notifyNoon, setNotifyNoon] = useState(true);
  const [notifyEvening, setNotifyEvening] = useState(true);
  const [dailyGoalHours, setDailyGoalHours] = useState(0); // 0 = לא הוגדר
  const [dateFrom, setDateFrom] = useState(new Date().toISOString().split('T')[0]);
  const [dateTo, setDateTo] = useState(new Date().toISOString().split('T')[0]);
  const [heroDay, setHeroDay] = useState(new Date().toISOString().split('T')[0]);
  const [filteredData, setFilteredData] = useState<{date:string,totalMinutes:number,byApp?:any}[]>([]);
  const [showFromPicker, setShowFromPicker] = useState(false);
  const [showToPicker, setShowToPicker] = useState(false);
  const [showOtherApps, setShowOtherApps] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [monthlyStars, setMonthlyStars] = useState(0);
  const [workStatus, setWorkStatus] = useState({lastRunNoon:'—', lastRunEvening:'—'});
  const [showHistory, setShowHistory] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [onboardingStep, setOnboardingStep] = useState(0);
  const [currentWeekIndex, setCurrentWeekIndex] = useState(0);
  const [navOffset, setNavOffset] = useState(0);
  const weekScrollRef = useRef<any>(null);
  const mainScrollRef = useRef<any>(null);
  const [scrollY, setScrollY] = useState(0);

  // סנכרון אוטומטי ברקע
  useEffect(()=>{
    const sub = AppState.addEventListener('change', (nextState: AppStateStatus) => {
      if (appState.current.match(/inactive|background/) && nextState === 'active') {
        checkAutoSync();
      }
      appState.current = nextState;
    });
    return () => sub.remove();
  },[authToken]);

  async function checkAutoSync(tok?: string) {
    const tokenToUse = tok || authToken;
    if (!tokenToUse) return;
    await performAutoSync(tokenToUse);
  }

  async function performAutoSync(tok?: string) {
    const tokenToUse = tok || authToken;
    if (!tokenToUse) return;
    try {
      const data = await fetchRealScreenTime();
      const totalMin = data.reduce((s,d) => s + d.totalMinutes, 0);
      const dailyAvg = Math.round(totalMin / data.length / 60 * 10) / 10;
      const savedConsent = await AsyncStorage.getItem(CONSENT_KEY);
      const c = savedConsent ? JSON.parse(savedConsent) : {total:false,byApp:false,timing:false,classAverage:false};
      const _today = new Date().toISOString().split('T')[0];
      const _td = data.find(d=>d.date===_today);
      const sessionCount = _td ? ((_td as any).sessionCount||0) : 0;
      const avgSessionSeconds = _td ? ((_td as any).avgSessionSeconds||0) : 0;
      await fetch(`${SERVER}/api/report`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json', 'Authorization': 'Bearer ' + tokenToUse},
        body: JSON.stringify({
          dailyAverage: dailyAvg,
          totalMinutes: Math.round(totalMin / 60),
          weeklyData: data.map(d => Math.round(d.totalMinutes / 60 * 10) / 10),
          byApp: buildByApp(data),
          timing: buildTiming(data),
          sessionCount, avgSessionSeconds,
          consent: c, platform: Platform.OS, syncedAt: new Date().toISOString(),
        }),
      });
      await AsyncStorage.setItem('@last_auto_sync', Date.now().toString());
      const now = new Date().toLocaleTimeString('he-IL');
      await AsyncStorage.setItem('@last_sync', now);
      setLastSync(now);
      logT('autoSync הצליח, totalMinutes:', Math.round(totalMin / 60));
    } catch(e) {logT('autoSync error:', e);}
  }

  useEffect(()=>{init();},[]);

  // מחזיר את תאריך יום השבת האחרון שהסתיים במלואו (סוף שבוע קלנדרי א'-ש')
  function getLastCompletedSaturday(now: Date) {
    const day = now.getDay(); // 0=ראשון...6=שבת
    const daysSinceLastSaturday = (day + 1) % 7;
    const lastSaturday = new Date(now);
    lastSaturday.setDate(now.getDate() - daysSinceLastSaturday);
    lastSaturday.setHours(0,0,0,0);
    if (daysSinceLastSaturday === 0) {
      // היום עצמו שבת - השבוע עדיין לא הסתיים, השבת האחרונה שהושלמה היא לפני שבוע
      lastSaturday.setDate(lastSaturday.getDate() - 7);
    }
    return lastSaturday;
  }


  async function checkWeeklyStars() {
    try {
      const now = new Date();
      const currentMonthStr = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;
      let starsCount = parseInt((await AsyncStorage.getItem('@stars_count')) || '0', 10);
      const storedMonth = await AsyncStorage.getItem('@stars_month');

      if (storedMonth !== currentMonthStr) {
        // מעבר לחודש קלנדרי חדש - איפוס
        starsCount = 0;
        await AsyncStorage.setItem('@stars_month', currentMonthStr);
        await AsyncStorage.setItem('@stars_count', '0');
        await AsyncStorage.removeItem('@stars_chofer_notified');
      }

      const lastSaturday = getLastCompletedSaturday(now);
      const lastSaturdayStr = lastSaturday.toISOString().split('T')[0];

      // חותמת התקנה - מונעת כוכבים רטרואקטיביים על שבועות שקדמו להתקנת הפיצ'ר
      let installDateStr = await AsyncStorage.getItem('@stars_install_date');
      if (!installDateStr) {
        installDateStr = now.toISOString().split('T')[0];
        await AsyncStorage.setItem('@stars_install_date', installDateStr);
        // איפוס חד-פעמי - מנקה כוכב/ים שאולי נצברו רטרואקטיבית לפני שהתיקון הזה היה קיים
        starsCount = 0;
        await AsyncStorage.setItem('@stars_count', '0');
        await AsyncStorage.removeItem('@stars_last_week');
      }

      const lastChecked = await AsyncStorage.getItem('@stars_last_week');

      if (lastChecked !== lastSaturdayStr) {
        const weekStart = new Date(lastSaturday);
        weekStart.setDate(lastSaturday.getDate() - 6);
        const weekStartStr = weekStart.toISOString().split('T')[0];

        // מדלגים על שבועות שהתחילו לפני ההתקנה - אין כוכבים רטרואקטיביים
        if (weekStartStr >= installDateStr) {
          const goalStr = await AsyncStorage.getItem('@daily_goal');
          const goalHours = goalStr ? parseFloat(goalStr) : 0;

          if (goalHours > 0) {
            const freshData = await fetchRealScreenTime();
            const weekDays = freshData.filter(d => d.date >= weekStartStr && d.date <= lastSaturdayStr);
            if (weekDays.length > 0) {
              const totalMin = weekDays.reduce((sum,d) => sum + netMinutesForGoal(d), 0);
              const avgMin = totalMin / 7;
              if (avgMin <= goalHours * 60) {
                starsCount = Math.min(4, starsCount + 1);
                await AsyncStorage.setItem('@stars_count', String(starsCount));
              }
            }
          }
        }
        await AsyncStorage.setItem('@stars_last_week', lastSaturdayStr);
      }

      setMonthlyStars(starsCount);

      if (starsCount >= 4) {
        const notified = await AsyncStorage.getItem('@stars_chofer_notified');
        if (notified !== currentMonthStr) {
          await notifee.requestPermission();
          const channelId = await notifee.createChannel({ id: 'stars', name: 'הישגים', importance: 4 });
          await notifee.displayNotification({
            title: 'כל הכבוד! 🎉',
            body: 'השלמת את החודש עם 4 כוכבים - גש להנהלה לקבל את הצ׳ופר!',
            android: { channelId },
          });
          await AsyncStorage.setItem('@stars_chofer_notified', currentMonthStr);
        }
      }
    } catch(e) { logT('checkWeeklyStars error:', e); }
  }

  async function loadScreenTime() {
    const data = await fetchRealScreenTime();
    setWeeklyData(data);
  }

  async function init() {
    const tok = await AsyncStorage.getItem(TOKEN_KEY);
    const sc = await AsyncStorage.getItem(CONSENT_KEY);
    const ls = await AsyncStorage.getItem('@last_sync');
    if (sc) setConsent(JSON.parse(sc));
    const seen = await AsyncStorage.getItem('@onboarding_done');
    if (!seen) setShowOnboarding(true);
    const goal = await AsyncStorage.getItem('@daily_goal'); if (goal) setDailyGoalHours(parseFloat(goal));
    const nn = await AsyncStorage.getItem('@notify_noon'); if (nn !== null) setNotifyNoon(nn === 'true');
    const ne = await AsyncStorage.getItem('@notify_evening'); if (ne !== null) setNotifyEvening(ne === 'true');
    if (ls) setLastSync(ls);
    if (tok) {
      try {
        const res = await fetch(`${SERVER}/api/report`, {headers: {'Authorization': 'Bearer ' + tok}});
        const data = await res.json();
        if (!data.error) {
          setAuthToken(tok);
          const info = await AsyncStorage.getItem('@student_info');
          if (info) setStudentInfo(JSON.parse(info));
          setScreen('main');
        } else {
          await AsyncStorage.removeItem(TOKEN_KEY);
        }
      } catch(e) {
        setAuthToken(tok);
        const info = await AsyncStorage.getItem('@student_info');
        if (info) {setStudentInfo(JSON.parse(info)); setScreen('main');}
      }
    }
    setLoading(false);
    if (Platform.OS === 'android') {
      loadScreenTime();
      if (tok) {
        checkAutoSync(tok);
        // תזמן סנכרון אוטומטי אם ההסכמה על זמן מסך כולל דלוקה (לא תלוי בשאר הקטגוריות)
        try {
          const { NativeModules } = require('react-native');
          if (NativeModules.SyncScheduler) {
            const c = sc ? JSON.parse(sc) : {};
            if (c.total) {
              await NativeModules.SyncScheduler.scheduleDailySyncs();
            } else {
              await NativeModules.SyncScheduler.cancelDailySyncs();
            }
          }
        } catch(e:any) {
          logT('SyncScheduler init error:', e);
        }
        loadTodayMood(tok);
        loadClassAverage(tok);
      }
    }
    setupBackgroundFetch();
    if (Platform.OS === 'android') checkWeeklyStars();
    // הפוש נשלח דרך משימת הרקע (WorkManager) — אין צורך בתזמון notifee נפרד
  }

  async function scheduleNotifications(noonEnabled: boolean, eveningEnabled: boolean, totalMinutes: number) {
    try {
      await notifee.cancelAllNotifications();
      const channelId = await notifee.createChannel({
        id: 'screentime',
        name: 'זמן מסך',
        importance: 3,
      });

      const display = totalMinutes >= 60
        ? `${Math.floor(totalMinutes/60)}ש' ${totalMinutes%60 > 0 ? totalMinutes%60+"ד'" : ''}`
        : `${totalMinutes}ד'`;
      const goalMin = dailyGoalHours * 60;
      const remaining = goalMin > 0 ? goalMin - totalMinutes : 0;

      if (noonEnabled) {
        const noon = new Date();
        noon.setHours(12, 0, 0, 0);
        if (noon.getTime() < Date.now()) noon.setDate(noon.getDate()+1);
        const noonBody = goalMin > 0
          ? remaining > 0
            ? `השתמשת ${display} — נשאר לך ${toDisplay(remaining)} עד היעד 💪`
            : `חרגת מהיעד היומי שלך! נסה להפחית 😊`
          : `עד עכשיו השתמשת ${display} במסך — כל הכבוד!`;
        await notifee.createTriggerNotification(
          { title: 'זמן מסך בצהריים ☀️', body: noonBody, android: { channelId } },
          { type: TriggerType.TIMESTAMP, timestamp: noon.getTime(), repeatFrequency: RepeatFrequency.DAILY }
        );
      }

      if (eveningEnabled) {
        const evening = new Date();
        evening.setHours(20, 0, 0, 0);
        if (evening.getTime() < Date.now()) evening.setDate(evening.getDate()+1);
        const eveningBody = goalMin > 0
          ? remaining > 0
            ? `יפה! סיימת את היום עם ${display} — מתחת ליעד שלך 🌟`
            : `השתמשת ${display} היום — מחר אפשר לשפר 💪`
          : `סיכום יום: השתמשת ${display} במסך — כל הכבוד!`;
        await notifee.createTriggerNotification(
          { title: 'סיכום זמן מסך יומי 🌙', body: eveningBody, android: { channelId } },
          { type: TriggerType.TIMESTAMP, timestamp: evening.getTime(), repeatFrequency: RepeatFrequency.DAILY }
        );
      }
    } catch(e) { logT('notification error:', e); }
  }

  async function setupDailyNotification() {
    try {
      await notifee.requestPermission();
      const todayMin = weeklyData.find(d => d.date === new Date().toISOString().split('T')[0])?.totalMinutes || 0;
      await scheduleNotifications(notifyNoon, notifyEvening, todayMin);
    } catch(e) { logT('notification error:', e); }
  }

  function setupBackgroundFetch() {
    BackgroundFetch.configure({
      minimumFetchInterval: 1440,
      stopOnTerminate: false,
      startOnBoot: true,
      enableHeadless: true,
    }, async (taskId) => {
      logT('[BackgroundFetch] task:', taskId);
      const tok = await AsyncStorage.getItem(TOKEN_KEY);
      if (tok) await performAutoSync(tok);
      BackgroundFetch.finish(taskId);
    }, (taskId) => {
      logT('[BackgroundFetch] timeout:', taskId);
      BackgroundFetch.finish(taskId);
    });
  }

  async function handleAuth(tok: string, info: StudentInfo) {
    await AsyncStorage.setItem(TOKEN_KEY, tok);
    await AsyncStorage.setItem('@student_info', JSON.stringify(info));
    setAuthToken(tok); setStudentInfo(info); setScreen('main');
    if (Platform.OS === 'android') loadScreenTime();
  }

  async function handleLogout() {
    await AsyncStorage.multiRemove([TOKEN_KEY, '@student_info']);
    setAuthToken(null); setStudentInfo(null); setScreen('welcome');
  }

  async function toggleConsent(field: keyof ConsentSettings) {
    const u = {...consent, [field]: !consent[field]};
    setConsent(u);
    await AsyncStorage.setItem(CONSENT_KEY, JSON.stringify(u));
    // עדכן את הסנכרון האוטומטי לפי הסכמה על זמן מסך כולל בלבד
    try {
      const { NativeModules } = require('react-native');
      if (NativeModules.SyncScheduler) {
        if (u.total) NativeModules.SyncScheduler.scheduleDailySyncs();
        else NativeModules.SyncScheduler.cancelDailySyncs();
      }
    } catch(e) { logT('SyncScheduler toggle error:', e); }
  }

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    const data = await fetchRealScreenTime();
    setWeeklyData(data);
    setRefreshing(false);
  }, []);

  async function loadClassAverage(tok?: string) {
    const t = tok || authToken;
    if (!t) return;
    try {
      const res = await fetch(`${SERVER}/api/class-average`, {headers: {'Authorization': 'Bearer ' + t}});
      const data = await res.json();
      if (!data.error) setClassAverage(data);
    } catch(e) {}
  }

  async function loadTodayMood(tok?: string) {
    const t = tok || authToken;
    if (!t) return;
    try {
      const res = await fetch(`${SERVER}/api/mood/today`, {headers: {'Authorization': 'Bearer ' + t}});
      const data = await res.json();
      if (data.mood) setTodayMood(data.mood);
    } catch(e) {}
  }

  async function sendMood(mood: string) {
    if (!authToken) return;
    setSendingMood(true);
    try {
      await fetch(`${SERVER}/api/mood`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json', 'Authorization': 'Bearer ' + authToken},
        body: JSON.stringify({mood}),
      });
      setTodayMood(mood);
    } catch(e) {}
    setSendingMood(false);
  }

  function getNavMode() {
    if (dateFrom === dateTo && dateFrom !== '') return 'day';
    if (!dateFrom && !dateTo) return 'week';
    const diffDays = dateFrom && dateTo ? 
      Math.round((new Date(dateTo).getTime()-new Date(dateFrom).getTime())/86400000) : 7;
    if (diffDays <= 1) return 'day';
    if (diffDays <= 7) return 'week';
    return 'range';
  }

  function navigateBack() {
    const mode = getNavMode();
    if (mode === 'day') {
      const d = new Date(dateFrom || new Date());
      d.setDate(d.getDate()-1);
      const s = d.toISOString().split('T')[0];
      setDateFrom(s); setDateTo(s);
    } else if (mode === 'week') {
      const from = new Date(dateFrom || new Date(Date.now()-6*86400000));
      const to = new Date(dateTo || new Date());
      from.setDate(from.getDate()-7);
      to.setDate(to.getDate()-7);
      setDateFrom(from.toISOString().split('T')[0]);
      setDateTo(to.toISOString().split('T')[0]);
    } else {
      const from = new Date(dateFrom || new Date());
      const to = new Date(dateTo || new Date());
      const diffDays = Math.round((to.getTime()-from.getTime())/86400000)+1;
      from.setDate(from.getDate()-diffDays);
      to.setDate(to.getDate()-diffDays);
      setDateFrom(from.toISOString().split('T')[0]);
      setDateTo(to.toISOString().split('T')[0]);
    }
  }

  function navigateForward() {
    const today = new Date().toISOString().split('T')[0];
    const mode = getNavMode();
    if (mode === 'day') {
      if (dateFrom >= today) return;
      const d = new Date(dateFrom || new Date());
      d.setDate(d.getDate()+1);
      const s = d.toISOString().split('T')[0];
      setDateFrom(s); setDateTo(s);
    } else if (mode === 'week') {
      if (dateTo >= today) return;
      const from = new Date(dateFrom || new Date(Date.now()-6*86400000));
      const to = new Date(dateTo || new Date());
      from.setDate(from.getDate()+7);
      to.setDate(to.getDate()+7);
      setDateFrom(from.toISOString().split('T')[0]);
      setDateTo(to.toISOString().split('T')[0]);
    } else {
      if (dateTo >= today) return;
      const from = new Date(dateFrom || new Date());
      const to = new Date(dateTo || new Date());
      const diffDays = Math.round((to.getTime()-from.getTime())/86400000)+1;
      from.setDate(from.getDate()+diffDays);
      to.setDate(to.getDate()+diffDays);
      setDateFrom(from.toISOString().split('T')[0]);
      setDateTo(to.toISOString().split('T')[0]);
    }
  }

  function isSystemPkg(pkg: string) {
    const systemPkgs = ['launcher','vending','settings','systemui','gms','gsf','inputmethod','packageinstaller','permissioncontroller','dialer','contacts','phone','calendar','clock','calculator','camera','gallery','email','music','video','wallpaper','lockscreen','keyguard','android.server','android.ext','com.android','com.samsung','com.sec','com.google.android.gms','com.google.android.gsf','com.qualcomm','com.qti','com.lge','com.huawei','com.xiaomi','com.miui','com.oppo','com.oneplus','com.waze','maps','navigation','driving'];
    return systemPkgs.some(s => pkg.includes(s));
  }

  function groupByWeeks(data: {date:string,totalMinutes:number,byApp?:any}[]) {
    const weeks: {date:string,totalMinutes:number,byApp?:any}[][] = [];
    if (!data.length) return weeks;
    let currentWeek: {date:string,totalMinutes:number,byApp?:any}[] = [];
    data.forEach((d, i) => {
      currentWeek.push(d);
      if (currentWeek.length === 7 || i === data.length - 1) {
        weeks.push([...currentWeek]);
        currentWeek = [];
      }
    });
    return weeks;
  }

  function fillMissingDays(data: {date:string,totalMinutes:number,byApp?:any}[], from: string, to: string) {
    const result: {date:string,totalMinutes:number,byApp?:any}[] = [];
    const start = from ? new Date(from) : new Date(Date.now() - 6*86400000);
    const end = to ? new Date(to) : new Date();
    const dataMap: Record<string,any> = {};
    data.forEach(d => { dataMap[d.date] = d; });
    const cur = new Date(start);
    while (cur <= end) {
      const dateStr = cur.toISOString().split('T')[0];
      result.push(dataMap[dateStr] || {date: dateStr, totalMinutes: 0, byApp: {}});
      cur.setDate(cur.getDate() + 1);
    }
    return result;
  }

  function filterWeeklyData(data: {date:string,totalMinutes:number,byApp?:any}[], from: string, to: string) {
    if (!from && !to) return data;
    return data.filter(d => {
      if (from && d.date < from) return false;
      if (to && d.date > to) return false;
      return true;
    });
  }

  function buildByApp(data: any[]) {
    const merged: Record<string, number> = {};
    data.forEach(d => {
      if (d.byApp) {
        Object.entries(d.byApp).forEach(([pkg, mins]: [string, any]) => {
          const label = pkg.split('.').slice(-2).join('.');
          merged[label] = (merged[label] || 0) + Number(mins);
        });
      }
    });
    const sorted = Object.fromEntries(
      Object.entries(merged).sort((a,b) => b[1] - a[1]).slice(0, 10)
    );
    return sorted;
  }

  // אפליקציות "הכרח" (ניווט, מוזיקת רקע) - לא נספרות מול היעד או הכוכבים, אבל כן מוצגות בשקיפות בסך הכולל וב"אפליקציות אחרות"
  // אפליקציות "הכרח" (ניווט/תחבורה, מוזיקת רקע, בנקאות ותשלומים) - לא נספרות מול היעד או הכוכבים,
  // אבל כן מוצגות בשקיפות בסך הכולל וב"אפליקציות אחרות". הוסף כאן תת-מחרוזת אחת שקיימת בשם החבילה
  // כדי להחריג אפליקציה נוספת - אין צורך לגעת בשום מקום אחר בקוד.
  const GOAL_EXEMPT_APPS = [
    // ניווט ותחבורה ציבורית
    'waze', 'moovit',
    // מוזיקת רקע
    'spotify',
    // בנקאות ותשלומים
    'leumi', 'poalim', 'discount', 'fibi', 'mizrahi', 'paybox', 'bit', 'wallet',
  ];
  function netMinutesForGoal(day: {totalMinutes: number, byApp?: any}) {
    if (!day.byApp) return day.totalMinutes;
    const exemptMin = Object.entries(day.byApp).reduce((sum, [pkg, mins]) => {
      const isExempt = GOAL_EXEMPT_APPS.some(w => pkg.toLowerCase().includes(w));
      return isExempt ? sum + Number(mins) : sum;
    }, 0);
    return Math.max(0, day.totalMinutes - exemptMin);
  }

  function buildTiming(data: {date: string, totalMinutes: number}[]) {
    const total = data.reduce((s,d) => s + d.totalMinutes, 0);
    const avg = total / data.length;
    return {
      morning: Math.round(avg * 0.05 / 60 * 10) / 10 + "ש'",
      noon: Math.round(avg * 0.15 / 60 * 10) / 10 + "ש'",
      evening: Math.round(avg * 0.45 / 60 * 10) / 10 + "ש'",
      night: Math.round(avg * 0.35 / 60 * 10) / 10 + "ש'",
    };
  }

  async function syncNow() {
    if (!authToken) return;
    setSyncing(true);
    logT('syncNow (סנכרון ידני) started');
    try {
      const totalMin = weeklyData.reduce((sum, d) => sum + d.totalMinutes, 0);
      const dailyAvg = Math.round(totalMin / weeklyData.length / 60 * 10) / 10;
      const res = await fetch(`${SERVER}/api/report`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json', 'Authorization': 'Bearer ' + authToken},
        body: JSON.stringify({
          dailyAverage: dailyAvg,
          totalMinutes: Math.round(totalMin / 60),
          weeklyData: weeklyData.map(d => Math.round(d.totalMinutes / 60 * 10) / 10),
          byApp: buildByApp(weeklyData),
          timing: buildTiming(weeklyData),
          sessionCount: (() => { const t=new Date().toISOString().split('T')[0]; const td=weeklyData.find(d=>d.date===t); return td ? ((td as any).sessionCount||0) : 0; })(),
          avgSessionSeconds: (() => { const t=new Date().toISOString().split('T')[0]; const td=weeklyData.find(d=>d.date===t); return td ? ((td as any).avgSessionSeconds||0) : 0; })(),
          consent, platform: Platform.OS, syncedAt: new Date().toISOString(),
        }),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error);
      const now = new Date().toLocaleTimeString('he-IL');
      await AsyncStorage.setItem('@last_sync', now);
      setLastSync(now);
      logT('syncNow הצליח, totalMinutes:', Math.round(totalMin / 60));
      Alert.alert('סונכרן!', 'הנתונים נשלחו למורה בהצלחה.');
    } catch(e) {
      logT('syncNow error:', e);
      Alert.alert('שגיאה', 'לא ניתן לסנכרן. בדוק חיבור אינטרנט.');
    }
    setSyncing(false);
  }

  if (loading) return <View style={s.center}><ActivityIndicator size="large" color="#185FA5"/></View>;
  if (screen === 'welcome') return <WelcomeScreen onRegister={() => setScreen('register')} onLogin={() => setScreen('login')}/>;
  if (screen === 'register') return <RegisterScreen onDone={handleAuth} onBack={() => setScreen('welcome')}/>;
  if (screen === 'login') return <LoginScreen onDone={handleAuth} onBack={() => setScreen('welcome')}/>;

  const filteredRaw = filterWeeklyData(weeklyData, dateFrom, dateTo);
  const displayData = fillMissingDays(filteredRaw, dateFrom, dateTo);
  // נתוני היום הנבחר בכרטיס הגיבור — לכרטיסי המסך הראשי
  const heroDayData = weeklyData.filter(d => d.date === heroDay);
  const allWeeks = groupByWeeks(displayData);
  const totalMin = displayData.reduce((sum, d) => sum + d.totalMinutes, 0);
  const avgMin = displayData.length > 0 ? Math.round(totalMin / displayData.length) : 0;
  const maxMin = Math.max(...displayData.map(d => d.totalMinutes), 1);
  const consentCount = Object.values(consent).filter(Boolean).length;

  return (
    <SafeAreaView style={s.safe}>
      <StatusBar barStyle="dark-content"/>
      <ScrollView ref={mainScrollRef} style={s.scroll} contentContainerStyle={s.container}
        onScroll={e=>setScrollY(e.nativeEvent.contentOffset.y)}
        scrollEventThrottle={16}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh}/>}>

        <View style={s.header}>
          <View style={{flexDirection:'row',justifyContent:'space-between',alignItems:'center'}}>
            <View style={{flexDirection:'row',alignItems:'baseline',gap:6}}>
              <Text style={s.heading}>זמן מסך שלי</Text>
              <Text style={{fontSize:12,color:'#9a9a94',fontWeight:'500'}}>v{APP_VERSION}</Text>
            </View>
            <TouchableOpacity onPress={async()=>{
              try {
                const {NativeModules} = require('react-native');
                if (NativeModules.SyncScheduler?.getWorkStatus) {
                  const ws = await NativeModules.SyncScheduler.getWorkStatus();
                  setWorkStatus(ws);
                }
              } catch(e) { logT('getWorkStatus error:', e); }
              setShowSettings(true);
            }} style={{padding:8}}>
              <Text style={{fontSize:22}}>⚙️</Text>
            </TouchableOpacity>
          </View>
          {studentInfo && <Text style={s.meta}>{studentInfo.name} · {studentInfo.className} · מורה: {studentInfo.teacherName}</Text>}
          {lastSync && <Text style={s.syncNote}>סונכרן: {lastSync}</Text>}
        </View>

        {/* מסך פתיחה */}
        <Modal visible={showOnboarding} transparent animationType="fade">
          <View style={{flex:1,backgroundColor:'rgba(0,0,0,0.6)',justifyContent:'center',alignItems:'center',padding:24}}>
            <View style={{backgroundColor:'#fff',borderRadius:20,padding:24,width:'100%',maxWidth:360}}>
              {onboardingStep === 0 && (
                <View style={{alignItems:'center'}}>
                  <Text style={{fontSize:40,marginBottom:12}}>📱</Text>
                  <Text style={{fontSize:20,fontWeight:'700',color:'#1a1a18',marginBottom:8,textAlign:'center'}}>ברוכים הבאים!</Text>
                  <Text style={{fontSize:14,color:'#6b6b67',textAlign:'center',lineHeight:22,marginBottom:20}}>
                    אפליקציית "שיתוף זמן מסך" עוזרת לך לשלוט בזמן המסך שלך — באמצעות מעקב, יעדים אישיים והתראות חכמות.
                  </Text>
                  <Text style={{fontSize:13,color:'#9a9a94',textAlign:'center'}}>1 מתוך 4</Text>
                </View>
              )}
              {onboardingStep === 1 && (
                <View style={{alignItems:'center'}}>
                  <Text style={{fontSize:40,marginBottom:12}}>📊</Text>
                  <Text style={{fontSize:20,fontWeight:'700',color:'#1a1a18',marginBottom:8,textAlign:'center'}}>עקוב אחרי עצמך</Text>
                  <View style={{alignSelf:'stretch',gap:8}}>
                    {['גרף זמן מסך יומי ושבועי','פירוט לפי אפליקציה','שעות שימוש במהלך היום','השוואה לממוצע הכיתה'].map((item,i)=>(
                      <View key={i} style={{flexDirection:'row',alignItems:'center',gap:10}}>
                        <Text style={{fontSize:16,color:'#3B6D11'}}>✓</Text>
                        <Text style={{fontSize:14,color:'#1a1a18'}}>{item}</Text>
                      </View>
                    ))}
                  </View>
                  <Text style={{fontSize:13,color:'#9a9a94',textAlign:'center',marginTop:16}}>2 מתוך 4</Text>
                </View>
              )}
              {onboardingStep === 2 && (
                <View style={{alignItems:'center'}}>
                  <Text style={{fontSize:40,marginBottom:12}}>🎯</Text>
                  <Text style={{fontSize:20,fontWeight:'700',color:'#1a1a18',marginBottom:8,textAlign:'center'}}>קבע יעד אישי</Text>
                  <Text style={{fontSize:14,color:'#6b6b67',textAlign:'center',lineHeight:22,marginBottom:20}}>
                    הצטרף למועדון 3ש', 4ש' או 5ש' — קבע יעד יומי וקבל התראות מעודדות בצהריים ובסוף היום שיעזרו לך לעמוד ביעד!
                  </Text>
                  <Text style={{fontSize:13,color:'#9a9a94',textAlign:'center'}}>3 מתוך 4</Text>
                </View>
              )}
              {onboardingStep === 3 && (
                <View style={{alignItems:'center'}}>
                  <Text style={{fontSize:40,marginBottom:12}}>🔒</Text>
                  <Text style={{fontSize:20,fontWeight:'700',color:'#1a1a18',marginBottom:8,textAlign:'center'}}>הפרטיות שלך</Text>
                  <Text style={{fontSize:14,color:'#6b6b67',textAlign:'center',lineHeight:22,marginBottom:20}}>
                    אתה שולט לחלוטין במה שמשותף עם המורה. ניתן לשנות את הגדרות השיתוף בכל עת דרך כפתור ⚙️.
                  </Text>
                  <Text style={{fontSize:13,color:'#9a9a94',textAlign:'center'}}>4 מתוך 4</Text>
                </View>
              )}
              <View style={{flexDirection:'row',justifyContent:'space-between',marginTop:20,gap:12}}>
                {onboardingStep > 0 && (
                  <TouchableOpacity onPress={()=>setOnboardingStep(s=>s-1)} style={{flex:1,padding:12,borderRadius:10,backgroundColor:'#EAF3DE',alignItems:'center'}}>
                    <Text style={{fontSize:14,color:'#1a1a18'}}>הקודם</Text>
                  </TouchableOpacity>
                )}
                <TouchableOpacity
                  onPress={async()=>{
                    if(onboardingStep<3){setOnboardingStep(s=>s+1);}
                    else{setShowOnboarding(false);await AsyncStorage.setItem('@onboarding_done','1');}
                  }}
                  style={{flex:1,padding:12,borderRadius:10,backgroundColor:'#1a1a18',alignItems:'center'}}>
                  <Text style={{fontSize:14,color:'#fff',fontWeight:'500'}}>{onboardingStep<3?'הבא':'בוא נתחיל!'}</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>

        {/* מסך היסטוריה ומגמות */}
        <Modal visible={showHistory} animationType="slide" onRequestClose={()=>setShowHistory(false)}>
          <SafeAreaView style={{flex:1,backgroundColor:'#F6F8F6'}}>
            <ScrollView contentContainerStyle={{padding:16,paddingBottom:40}}>
              <View style={{flexDirection:'row',alignItems:'center',gap:10,marginBottom:20}}>
                <TouchableOpacity onPress={()=>setShowHistory(false)} hitSlop={{top:10,bottom:10,left:10,right:10}}>
                  <Text style={{fontSize:24,color:'#9DA99F'}}>›</Text>
                </TouchableOpacity>
                <Text style={{fontSize:18,fontWeight:'500',color:'#2C3A2E'}}>היסטוריה ומגמות</Text>
              </View>

              {/* כפתורי טווח */}
              <View style={{flexDirection:'row',gap:6,marginBottom:16}}>
                {[['שבוע',7],['חודש',30],['הכל',-1]].map(([label,days])=>{
                  const isAll = Number(days)===-1;
                  const active = isAll ? (dateFrom==='') : (() => {
                    const from = new Date(Date.now()-Number(days)*86400000).toISOString().split('T')[0];
                    return dateFrom===from;
                  })();
                  return (
                    <TouchableOpacity key={label as string}
                      style={{flex:1,paddingVertical:10,borderRadius:12,backgroundColor:active?'#3D5A40':'#E8F0E9',alignItems:'center'}}
                      onPress={()=>{
                        if(isAll){setDateFrom('');setDateTo('');}
                        else{
                          const to = new Date().toISOString().split('T')[0];
                          const from = new Date(Date.now()-Number(days)*86400000).toISOString().split('T')[0];
                          setDateFrom(from); setDateTo(to);
                        }
                      }}>
                      <Text style={{fontSize:13,color:active?'#fff':'#3D5A40',fontWeight:'500'}}>{label}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              {/* גרף */}
              {(() => {
                const weeks = groupByWeeks(displayData);
                const safeIdx = Math.min(currentWeekIndex, Math.max(0, weeks.length-1));
                const week = weeks[safeIdx] || [];
                const weekMax = Math.max(...week.map(d=>d.totalMinutes),1);
                const today = new Date().toISOString().split('T')[0];
                const canGoForward = dateTo < today;
                return (
                  <View style={s.card}>
                    <View style={{flexDirection:'row',justifyContent:'space-between',alignItems:'center',marginBottom:10}}>
                      <TouchableOpacity onPress={navigateForward} disabled={!canGoForward} style={{opacity:canGoForward?1:0.3}}>
                        <Text style={{fontSize:20,color:'#7FA582',fontWeight:'700'}}>{'\u25C0'}</Text>
                      </TouchableOpacity>
                      <Text style={{fontSize:12,color:'#9DA99F'}}>
                        {week[0]?.date} — {week[week.length-1]?.date}
                      </Text>
                      <TouchableOpacity onPress={navigateBack}>
                        <Text style={{fontSize:20,color:'#7FA582',fontWeight:'700'}}>{'\u25B6'}</Text>
                      </TouchableOpacity>
                    </View>
                    <View style={s.chartWrap}>
                      {week.map((d, i) => (
                        <View key={i} style={s.chartCol}>
                          <Text style={s.chartHour}>{toDisplay(d.totalMinutes)}</Text>
                          <View style={s.chartBarBg}>
                            <View style={[s.chartBar, {height: Math.max(4, Math.round(d.totalMinutes/weekMax*80)), backgroundColor: sColor(d.totalMinutes)}]}/>
                          </View>
                          <Text style={s.chartLbl}>{d.date.slice(5)}</Text>
                        </View>
                      ))}
                    </View>
                  </View>
                );
              })()}

              {/* מדדי טווח */}
              <View style={s.metricRow}>
                <View style={s.metricCard}><Text style={s.metricLbl}>ממוצע יומי</Text><Text style={s.metricVal}>{toDisplay(avgMin)}</Text></View>
                <View style={s.metricCard}><Text style={s.metricLbl}>סה"כ בטווח</Text><Text style={s.metricVal}>{toDisplay(totalMin)}</Text></View>
                <View style={s.metricCard}><Text style={s.metricLbl}>סטטוס</Text><Text style={[s.metricVal, {color: sColor(avgMin), fontSize: 16}]}>{sLabel(avgMin)}</Text></View>
              </View>
            </ScrollView>
          </SafeAreaView>
        </Modal>

        {/* תפריט הגדרות צדדי */}
        <Modal visible={showSettings} transparent animationType="slide" onRequestClose={()=>setShowSettings(false)}>
          <View style={{flex:1,backgroundColor:'rgba(0,0,0,0.4)'}}>
            <TouchableOpacity style={{position:'absolute',right:0,top:0,bottom:0,width:'25%'}} activeOpacity={1} onPress={()=>setShowSettings(false)}/>
            <View style={{position:'absolute',left:0,top:0,bottom:0,width:'75%',backgroundColor:'#fff'}}>
            <ScrollView style={{flex:1}} contentContainerStyle={{padding:24,paddingTop:60,paddingBottom:40}}>
              <Text style={{fontSize:18,fontWeight:'500',color:'#1a1a18',marginBottom:20,textAlign:'right'}}>הגדרות שיתוף</Text>
              <View style={{marginBottom:16,padding:10,backgroundColor:'#EDF2ED',borderRadius:8}}>
                <Text style={{fontSize:10,color:'#9DA99F',textAlign:'right'}}>סנכרון אוטומטי - צהריים:</Text>
                <Text style={{fontSize:11,color:'#6b6b67',textAlign:'right',marginTop:2}}>{workStatus.lastRunNoon}</Text>
                <Text style={{fontSize:10,color:'#9DA99F',textAlign:'right',marginTop:6}}>סנכרון אוטומטי - ערב:</Text>
                <Text style={{fontSize:11,color:'#6b6b67',textAlign:'right',marginTop:2}}>{workStatus.lastRunEvening}</Text>
              </View>
              <Text style={{fontSize:13,color:'#6b6b67',marginBottom:16,textAlign:'right'}}>{consentCount} קטגוריות מתוך 4 משותפות</Text>
              {([
                ['total', 'זמן מסך כולל'],
                ['byApp', 'פירוט לפי אפליקציה'],
                ['timing', 'שעות שימוש'],
                ['classAverage', 'השוואה לממוצע כיתה'],
              ] as [keyof ConsentSettings, string][]).map(([field, label]) => (
                <View key={field} style={{flexDirection:'row',justifyContent:'space-between',alignItems:'center',paddingVertical:14,borderBottomWidth:0.5,borderColor:'rgba(0,0,0,0.1)'}}>
                  <Switch value={consent[field]} onValueChange={()=>toggleConsent(field)} trackColor={{false:'#D3D1C7',true:'#3B6D11'}} thumbColor="#fff"/>
                  <Text style={{fontSize:14,color:'#1a1a18'}}>{label}</Text>
                </View>
              ))}
              <View style={{marginTop:16,borderTopWidth:0.5,borderColor:'rgba(0,0,0,0.1)',paddingTop:16}}>
                <Text style={{fontSize:14,fontWeight:'500',color:'#1a1a18',textAlign:'right',marginBottom:12}}>יעד יומי</Text>
                <View style={{flexDirection:'row',justifyContent:'space-between',alignItems:'center',marginBottom:12}}>
                  <View style={{flexDirection:'row',gap:8,flexWrap:'wrap'}}>
                    {[
                      {h:0,label:'ללא'},
                      {h:3,label:'מועדון 3ש\''},
                      {h:4,label:'מועדון 4ש\''},
                      {h:5,label:'מועדון 5ש\''},
                      {h:6,label:'6ש\''},
                      {h:7,label:'7ש\''},
                      {h:8,label:'8ש\''},
                    ].map(({h,label})=>(
                      <TouchableOpacity key={h} onPress={async()=>{setDailyGoalHours(h);await AsyncStorage.setItem('@daily_goal',String(h));}}
                        style={{paddingHorizontal:10,paddingVertical:6,borderRadius:8,backgroundColor:dailyGoalHours===h?'#1a1a18':'#f0efe9',marginBottom:4}}>
                        <Text style={{fontSize:13,color:dailyGoalHours===h?'#fff':'#1a1a18'}}>{label}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </View>
              </View>

              <View style={{marginTop:16,borderTopWidth:0.5,borderColor:'rgba(0,0,0,0.1)',paddingTop:16}}>
                <Text style={{fontSize:14,fontWeight:'500',color:'#1a1a18',textAlign:'right',marginBottom:12}}>התראות</Text>
                <View style={{flexDirection:'row',justifyContent:'space-between',alignItems:'center',paddingVertical:12,borderBottomWidth:0.5,borderColor:'rgba(0,0,0,0.1)'}}>
                  <Switch value={notifyNoon} onValueChange={async(v)=>{setNotifyNoon(v);await AsyncStorage.setItem('@notify_noon',String(v));}} trackColor={{false:'#D3D1C7',true:'#3B6D11'}} thumbColor="#fff"/>
                  <Text style={{fontSize:14,color:'#1a1a18'}}>פוש בצהריים (12:00)</Text>
                </View>
                <View style={{flexDirection:'row',justifyContent:'space-between',alignItems:'center',paddingVertical:12}}>
                  <Switch value={notifyEvening} onValueChange={async(v)=>{setNotifyEvening(v);await AsyncStorage.setItem('@notify_evening',String(v));}} trackColor={{false:'#D3D1C7',true:'#3B6D11'}} thumbColor="#fff"/>
                  <Text style={{fontSize:14,color:'#1a1a18'}}>סיכום סוף יום (20:00)</Text>
                </View>
              </View>

              <TouchableOpacity style={[s.logoutBtn,{marginTop:12,backgroundColor:'#EAF3DE'}]} onPress={async()=>{await AsyncStorage.removeItem('@onboarding_done');setShowSettings(false);setShowOnboarding(true);setOnboardingStep(0);}}>
                <Text style={[s.logoutBtnTxt,{color:'#1a1a18'}]}>הצג מדריך מחדש</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[s.logoutBtn,{marginTop:8}]} onPress={()=>{setShowSettings(false);handleLogout();}}>
                <Text style={s.logoutBtnTxt}>התנתק</Text>
              </TouchableOpacity>
            </ScrollView>
            </View>
          </View>
        </Modal>

        {/* כרטיס גיבור עם דפדוף בין ימים */}
        {(() => {
          const heroD = weeklyData.find(d => d.date === heroDay);
          const heroMin = heroD?.totalMinutes || 0;
          const todayStr = new Date().toISOString().split('T')[0];
          const isToday = heroDay === todayStr;

          // תווית התאריך
          const yesterdayStr = new Date(Date.now()-86400000).toISOString().split('T')[0];
          let dayLabel = '';
          if (heroDay === todayStr) dayLabel = 'היום';
          else if (heroDay === yesterdayStr) dayLabel = 'אתמול';
          else {
            const dObj = new Date(heroDay);
            const days = ['ראשון','שני','שלישי','רביעי','חמישי','שישי','שבת'];
            dayLabel = 'יום ' + days[dObj.getDay()];
          }
          const dObj = new Date(heroDay);
          const dateSubLabel = `${dObj.getDate()}.${dObj.getMonth()+1}`;

          const goBack = () => {
            const prev = new Date(new Date(heroDay).getTime() - 86400000);
            setHeroDay(prev.toISOString().split('T')[0]);
          };
          const goForward = () => {
            if (isToday) return;
            const next = new Date(new Date(heroDay).getTime() + 86400000);
            setHeroDay(next.toISOString().split('T')[0]);
          };

          return (
            <View style={{backgroundColor:'#fff',borderRadius:24,padding:20,marginBottom:12,shadowColor:'#2C3A2E',shadowOpacity:0.04,shadowRadius:8,shadowOffset:{width:0,height:2}}}>
              {/* שורת ניווט עם חיצים */}
              <View style={{flexDirection:'row',alignItems:'center',justifyContent:'space-between',marginBottom:16}}>
                <TouchableOpacity onPress={goBack} hitSlop={{top:10,bottom:10,left:10,right:10}}>
                  <Text style={{fontSize:26,fontWeight:'700',color:'#7FA582'}}>›</Text>
                </TouchableOpacity>
                <View style={{alignItems:'center'}}>
                  <Text style={{fontSize:14,fontWeight:'500',color:'#3D5A40'}}>{dayLabel}</Text>
                  <Text style={{fontSize:11,color:'#9DA99F',marginTop:1}}>{dateSubLabel}</Text>
                </View>
                <TouchableOpacity onPress={goForward} disabled={isToday} hitSlop={{top:10,bottom:10,left:10,right:10}}>
                  <Text style={{fontSize:26,fontWeight:'700',color:isToday?'#DCE4DD':'#7FA582'}}>‹</Text>
                </TouchableOpacity>
              </View>

              {/* זמן מסך גדול */}
              <View style={{alignItems:'center'}}>
                <Text style={{fontSize:52,fontWeight:'300',color:'#3D5A40',lineHeight:56,letterSpacing:-1}}>
                  {heroMin >= 60 ? `${Math.floor(heroMin/60)}` : '0'}
                  <Text style={{fontSize:24,fontWeight:'400'}}>{heroMin >= 60 ? `ש׳ ${heroMin%60}ד׳` : `${heroMin}ד׳`}</Text>
                </Text>

                {/* השוואה לממוצע השבועי האישי — רק בהיום */}
                {isToday && (() => {
                  const activeDays = weeklyData.filter(d=>d.totalMinutes>0);
                  if (activeDays.length < 2) return null;
                  const myAvg = Math.round(activeDays.reduce((a,d)=>a+d.totalMinutes,0)/activeDays.length);
                  const diff = Math.abs(Math.round(myAvg - heroMin));
                  if (diff === 0) return null;
                  const better = heroMin < myAvg;
                  return (
                    <View style={{marginTop:14,backgroundColor:'#E8F0E9',paddingHorizontal:16,paddingVertical:8,borderRadius:20,alignItems:'center'}}>
                      <Text style={{fontSize:12,color:'#5A7A5D',fontWeight:'500'}}>
                        הממוצע השבועי שלך: {toDisplay(myAvg)}
                      </Text>
                      <Text style={{fontSize:11,color:'#7FA582',marginTop:2}}>
                        {better ? `היום ${diff} דק׳ פחות 👍` : `היום ${diff} דק׳ יותר`}
                      </Text>
                    </View>
                  );
                })()}
              </View>

              {/* פס התקדמות היעד — רק בהיום. אפליקציות הכרח לא נספרות נגד היעד (אבל כן מוצגות בשקיפות בסך הכולל) */}
              {isToday && dailyGoalHours > 0 && (() => {
                const goalMin = dailyGoalHours * 60;
                const netMin = heroD ? netMinutesForGoal(heroD) : heroMin;
                const excludedMin = heroMin - netMin;
                const pct = Math.min(100, Math.round(netMin/goalMin*100));
                const remaining = goalMin - netMin;
                const over = remaining < 0;
                return (
                  <View style={{marginTop:18}}>
                    <View style={{flexDirection:'row',justifyContent:'space-between',marginBottom:6}}>
                      <Text style={{fontSize:12,color:'#9DA99F'}}>יעד: {dailyGoalHours}ש׳</Text>
                      <Text style={{fontSize:12,fontWeight:'500',color:over?'#B5654A':'#3D5A40'}}>
                        {over ? `חריגה של ${toDisplay(Math.abs(remaining))}` : `נשארו ${toDisplay(remaining)}`}
                      </Text>
                    </View>
                    <View style={{height:8,backgroundColor:'#EDF2ED',borderRadius:4,overflow:'hidden'}}>
                      <View style={{height:8,borderRadius:4,width:`${pct}%` as any,backgroundColor:over?'#C77B5E':'#7FA582'}}/>
                    </View>
                    {excludedMin > 0 && (
                      <Text style={{fontSize:10,color:'#B8C4BA',textAlign:'right',marginTop:4}}>
                        (לא כולל אפליקציות הכרח: {toDisplay(excludedMin)} הוחרגו מהיעד)
                      </Text>
                    )}
                  </View>
                );
              })()}
            </View>
          );
        })()}

        {/* כפתור היסטוריה ומגמות */}
        <TouchableOpacity onPress={()=>setShowHistory(true)}
          style={{backgroundColor:'#fff',borderRadius:16,padding:15,flexDirection:'row',alignItems:'center',justifyContent:'space-between',marginBottom:12,shadowColor:'#2C3A2E',shadowOpacity:0.04,shadowRadius:8,shadowOffset:{width:0,height:2}}}>
          <Text style={{fontSize:16,color:'#B8C4BA'}}>›</Text>
          <Text style={{fontSize:14,color:'#4A5A4C'}}>היסטוריה ומגמות</Text>
        </TouchableOpacity>

        <View style={s.card}>
          <Text style={s.cardTitle}>אפליקציות מובילות</Text>
          {(() => {
            // קבץ by_app מהיום הנבחר
            const appTotals: Record<string,number> = {};
            heroDayData.forEach(d => {
              if (d.byApp) {
                Object.entries(d.byApp).forEach(([pkg, mins]) => {
                  appTotals[pkg] = (appTotals[pkg] || 0) + Number(mins);
                });
              }
            });
            const socialNames = ['whatsapp','instagram','tiktok','youtube','facebook','katana','snapchat','telegram','twitter','netflix','messenger','orca','reddit','pinterest','linkedin','discord','twitch','chrome','sbrowser','browser','firefox','opera','brave','edge','safari','duck','vivaldi','kiwi'];
            const isSocial = (pkg: string) => socialNames.some(s => pkg.toLowerCase().includes(s));
            const socialEntries = Object.entries(appTotals).filter(([pkg]) => isSocial(pkg)).sort((a,b)=>b[1]-a[1]);
            const systemKeywords = ['שעון','הגדרות','מערכת Android','שימוש חכם בדיגיטל','photos','One UI Home'];
            const otherTotal = Object.entries(appTotals)
              .filter(([pkg]) => !isSocial(pkg) && !systemKeywords.includes(pkg) && Number(appTotals[pkg]) > 0)
              .reduce((a,[,v])=>a+v,0);

            const sorted = socialEntries.slice(0,8);
            if (!sorted.length && otherTotal === 0) return (
              <Text style={{fontSize:13,color:'#6b6b67',textAlign:'right'}}>אין נתונים לתקופה זו</Text>
            );
            const maxMins = Math.max(...(sorted.length ? sorted.map(([,v])=>v) : [0]), otherTotal, 1);
            const systemPkgs = ['launcher','vending','settings','systemui','gms','gsf','inputmethod','packageinstaller','permissioncontroller','dialer','contacts','phone','calendar','clock','calculator','camera','gallery','email','music','video','wallpaper','lockscreen','keyguard','android.server','android.ext','com.android','com.samsung','com.sec','com.google.android.gms','com.google.android.gsf','com.qualcomm','com.qti','com.lge','com.huawei','com.xiaomi','com.miui','com.oppo','com.oneplus'];
            const isSystem = (pkg: string) => systemPkgs.some(s => pkg.includes(s));
            const appNames: Record<string,string> = {
              'android.youtube':'YouTube',
              'android.chrome':'Chrome',
              'com.whatsapp':'WhatsApp',
              'com.instagram.android':'Instagram',
              'instagram':'Instagram',
              'com.facebook.katana':'Facebook',
              'katana':'Facebook',
              'whatsapp':'WhatsApp',
              'telegram':'Telegram',
              'snapchat':'Snapchat',
              'spotify':'Spotify',
              'tiktok':'TikTok',
              'musically':'TikTok',
              'mediaclient':'Netflix',
              'twitter':'X (Twitter)',
              'orca':'Messenger',
              'messenger':'Messenger',
              'com.zhiliaoapp.musically':'TikTok',
              'com.snapchat.android':'Snapchat',
              'com.telegram.messenger':'Telegram',
              'com.spotify.music':'Spotify',
              'com.netflix.mediaclient':'Netflix',
              'app.sbrowser':'Samsung Browser',
              'com.google.android.gm':'Gmail',
              'gm':'Gmail',
              'messaging':'הודעות',
              'com.android.messaging':'הודעות',
              'com.samsung.android.messaging':'הודעות',
              'docs':'Google Docs',
              'com.google.android.apps.docs':'Google Docs',
              'sheets':'Google Sheets',
              'com.google.android.apps.spreadsheets':'Google Sheets',
              'slides':'Google Slides',
              'com.google.android.apps.photos':'תמונות Google',
              'com.google.android.apps.maps':'Google Maps',
              'com.google.android.youtube':'YouTube',
              'com.google.android.apps.youtube.music':'YouTube Music',
              'outlook':'Outlook',
              'com.microsoft.office.outlook':'Outlook',
              'com.microsoft.teams':'Teams',
              'com.microsoft.office.word':'Word',
              'com.microsoft.office.excel':'Excel',
              'pangoandroid':'פנגו',
              'com.pango.android':'פנגו',
              'leumiwallet':'לאומי Pay',
              'com.leumi.leumiwallet':'לאומי Pay',
              'com.fibi.nativeapp':'בינלאומי',
              'com.poalim.mobileapp':'פועלים',
              'com.discount.bank':'דיסקונט',
              'authenticator2':'Google Authenticator',
              'com.google.android.apps.authenticator2':'Google Authenticator',
              'paymentsapp':'תשלומים',
              'com.google.android.apps.walletnfcrel':'Google Wallet',
              'il':'Israel',
              'familylink':'Family Link',
              'com.google.android.apps.kids.familylink':'Family Link',
              'brprint':'Brother Print',
              'com.facebook.orca':'Messenger',
              'com.amazon.mShop.android.shopping':'Amazon',
              'com.ebay.mobile':'eBay',
              'com.twitter.android':'X (Twitter)',
              'com.linkedin.android':'LinkedIn',
              'com.pinterest':'Pinterest',
              'com.reddit.frontpage':'Reddit',
              'com.duolingo':'Duolingo',
              'com.ubercab':'Uber',
              'com.gett.taxi':'Gett',
              'com.yango.online':'Yango',
              'com.hebcal.hebdate':'לוח עברי',
              'hebdate':'לוח עברי',
              'com.payboxapp':'Paybox',
              'payboxapp':'Paybox',
              'com.sakemli':'Sakemli',
              'sakemli':'Sakemli',
            };
            const resolveAppName = (pkgName: string) => {
              const lower = pkgName.toLowerCase();
              if (appNames[pkgName]) return appNames[pkgName];
              if (appNames[lower]) return appNames[lower];
              const matchKey = Object.keys(appNames).find(k => lower.includes(k));
              if (matchKey) return appNames[matchKey];
              const seg = pkgName.split('.').pop() || pkgName;
              return seg.charAt(0).toUpperCase() + seg.slice(1);
            };
            const sortedRows = sorted.map(([pkg,mins]) => {
              const name = resolveAppName(pkg);
              const display = mins >= 60 ? (mins/60).toFixed(1)+"ש'" : mins+"ד'";
              return (
                <View key={pkg} style={{marginBottom:8}}>
                  <View style={{flexDirection:'row',justifyContent:'space-between',marginBottom:3}}>
                    <Text style={{fontSize:13,color:'#1a1a18'}}>{name}</Text>
                    <Text style={{fontSize:13,fontWeight:'500'}}>{display}</Text>
                  </View>
                  <View style={{height:4,backgroundColor:'#EAF3DE',borderRadius:2}}>
                    <View style={{height:4,borderRadius:2,backgroundColor:sColor(mins/60),width:`${Math.round(mins/maxMins*100)}%` as any}}/>
                  </View>
                </View>
              );
            });
            return (
              <View>
                {sortedRows}
                {(() => {
                  const socialTotal = sorted.reduce((a,[,v])=>a+v,0);
                  const todayMin = heroDayData.reduce((a,d)=>a+d.totalMinutes,0);
                  const totalOther = Math.max(0, todayMin - socialTotal);
                  if (totalOther <= 0) return null;

                  const otherApps = Object.entries(appTotals)
                    .filter(([pkg]) => !isSocial(pkg))
                    .sort((a,b)=>b[1]-a[1]);

                  const fmt = (m:number) => m >= 60 ? (m/60).toFixed(1)+"ש'" : m+"ד'";

                  return (
                    <View style={{marginTop:8,paddingTop:8,borderTopWidth:0.5,borderColor:'rgba(0,0,0,0.08)'}}>
                      <TouchableOpacity onPress={()=>setShowOtherApps(v=>!v)}
                        style={{flexDirection:'row',justifyContent:'space-between',alignItems:'center',marginBottom:6}}>
                        <View style={{flexDirection:'row',alignItems:'center',gap:6}}>
                          <Text style={{fontSize:12,color:'#9a9a94'}}>{showOtherApps?'▲':'▼'}</Text>
                          <Text style={{fontSize:13,color:'#6b6b67'}}>אפליקציות אחרות</Text>
                        </View>
                        <Text style={{fontSize:13,fontWeight:'500'}}>{fmt(totalOther)}</Text>
                      </TouchableOpacity>
                      <View style={{height:4,backgroundColor:'#f0efe9',borderRadius:2,overflow:'hidden'}}>
                        <View style={{height:4,borderRadius:2,backgroundColor:'#9a9a94',width:`${Math.round(totalOther/maxMins*100)}%` as any}}/>
                      </View>
                      {showOtherApps && (
                        <View style={{backgroundColor:'#f8f7f4',borderRadius:10,padding:10,marginTop:8}}>
                          {otherApps.map(([pkg,mins])=>(
                            <View key={pkg} style={{flexDirection:'row',justifyContent:'space-between',paddingVertical:4,borderBottomWidth:0.5,borderColor:'rgba(0,0,0,0.06)'}}>
                              <Text style={{fontSize:12,color:'#9a9a94'}}>{fmt(mins)}</Text>
                              <Text style={{fontSize:12,color:'#1a1a18'}}>{resolveAppName(pkg)}</Text>
                            </View>
                          ))}
                        </View>
                      )}
                    </View>
                  );
                })()}

              </View>
            );
          })()}
        </View>

        {classAverage && consent.classAverage && (
          <View style={s.card}>
            <Text style={s.cardTitle}>ממוצע מול הכיתה {classAverage.className}</Text>
            {(() => {
              const myAvg = weeklyData.filter(d=>d.totalMinutes>0).reduce((a,d,i,arr)=>a+d.totalMinutes/arr.length,0);
              const classAvg = classAverage.classAvg * 60;
              const diff = myAvg - classAvg;
              const better = diff < 0;
              return (
                <View>
                  <View style={{flexDirection:'row',justifyContent:'space-around',marginVertical:12}}>
                    <View style={{alignItems:'center'}}>
                      <Text style={{fontSize:28,fontWeight:'700',color:'#1a1a18'}}>{toDisplay(Math.round(myAvg))}</Text>
                      <Text style={{fontSize:12,color:'#6b6b67',marginTop:2}}>הממוצע שלי</Text>
                    </View>
                    <View style={{alignItems:'center',justifyContent:'center'}}>
                      <Text style={{fontSize:22}}>{better?'😊':'😟'}</Text>
                    </View>
                    <View style={{alignItems:'center'}}>
                      <Text style={{fontSize:28,fontWeight:'700',color:'#1a1a18'}}>{toDisplay(Math.round(classAvg))}</Text>
                      <Text style={{fontSize:12,color:'#6b6b67',marginTop:2}}>ממוצע כיתה</Text>
                    </View>
                  </View>
                  <View style={{backgroundColor:better?'#EAF3DE':'#FAEEDA',borderRadius:8,padding:10,alignItems:'center'}}>
                    <Text style={{fontSize:13,color:better?'#3B6D11':'#854F0B',fontWeight:'500'}}>
                      {better
                        ? `בממוצע אתה משתמש ${toDisplay(Math.abs(Math.round(diff)))} פחות מהכיתה 👍`
                        : `בממוצע אתה משתמש ${toDisplay(Math.abs(Math.round(diff)))} יותר מהכיתה`}
                    </Text>
                  </View>
                  <Text style={{fontSize:11,color:'#9a9a94',marginTop:6,textAlign:'center'}}>
                    מבוסס על {classAverage.studentCount} תלמידים
                  </Text>
                </View>
              );
            })()}
          </View>
        )}

        {/* כרטיס כוכבי הישג */}
        {(() => {
          const isComplete = monthlyStars >= 4;
          return (
            <View style={{backgroundColor: isComplete ? '#3D5A40' : '#fff', borderRadius:20, padding:18, marginBottom:12, shadowColor:'#2C3A2E', shadowOpacity:0.04, shadowRadius:8, shadowOffset:{width:0,height:2}}}>
              <Text style={{fontSize:13,fontWeight:'400',color: isComplete ? 'rgba(255,255,255,0.75)' : '#8A9A8C', textAlign:'right', marginBottom:14}}>כוכבי הישג החודש</Text>
              <View style={{flexDirection:'row', justifyContent:'center', gap:14, marginBottom:12}}>
                {[0,1,2,3].map(i => {
                  const filled = i < monthlyStars;
                  return (
                    <View key={i} style={{
                      width:52, height:52, borderRadius:12, alignItems:'center', justifyContent:'center',
                      backgroundColor: isComplete ? 'transparent' : (filled ? '#E8F0E9' : '#F2F5F2'),
                      borderWidth: (filled || isComplete) ? 0 : 1,
                      borderStyle: 'dashed',
                      borderColor: '#D2DDD3',
                    }}>
                      <Text style={{fontSize:28, color: isComplete ? '#FCD34D' : (filled ? '#5A9E6F' : '#CDD8CE')}}>★</Text>
                    </View>
                  );
                })}
              </View>
              {isComplete ? (
                <View style={{alignItems:'center'}}>
                  <Text style={{fontSize:15,fontWeight:'700',color:'#fff',textAlign:'center',marginBottom:4}}>כל הכבוד! השלמת את החודש 🎉</Text>
                  <Text style={{fontSize:13,color:'rgba(255,255,255,0.85)',textAlign:'center'}}>גש להנהלה לקבלת הצ׳ופר</Text>
                </View>
              ) : (
                <Text style={{fontSize:13,color:'#6b6b67',textAlign:'center'}}>אספת {monthlyStars} מתוך 4</Text>
              )}
            </View>
          );
        })()}

        {(() => {
          const sessions = heroDayData.filter(d=>(d as any).sessionCount > 0);
          if (!sessions.length) return null;
          const totalSessions = sessions.reduce((a,d)=>a+(d as any).sessionCount,0);
          const avgSec = Math.round(sessions.reduce((a,d)=>a+(d as any).avgSessionSeconds,0)/sessions.length);
          const avgMin = Math.floor(avgSec/60);
          const avgSecRem = avgSec%60;
          const display = avgMin > 0 ? `${avgMin}ד' ${avgSecRem}ש''` : `${avgSec}ש''`;
          return (
            <View style={s.card}>
              <Text style={s.cardTitle}>דפוסי שימוש</Text>
              <View style={{flexDirection:'row',justifyContent:'space-around',paddingVertical:8}}>
                <View style={{alignItems:'center'}}>
                  <Text style={{fontSize:28,fontWeight:'500',color:'#1a1a18'}}>{totalSessions}</Text>
                  <Text style={{fontSize:11,color:'#9a9a94',marginTop:4}}>פתיחות מסך</Text>
                </View>
                <View style={{width:0.5,backgroundColor:'rgba(0,0,0,0.1)'}}/>
                <View style={{alignItems:'center'}}>
                  <Text style={{fontSize:28,fontWeight:'500',color:'#1a1a18'}}>{display}</Text>
                  <Text style={{fontSize:11,color:'#9a9a94',marginTop:4}}>ממוצע לפתיחה</Text>
                </View>
              </View>
            </View>
          );
        })()}

        <View style={s.card}>
          <Text style={s.cardTitle}>שעות שימוש</Text>
          {(() => {
            const timePeriods = [
              {label:'בוקר',key:'morning',emoji:'🌅',range:'06:00-12:00'},
              {label:'צהריים',key:'noon',emoji:'☀️',range:'12:00-17:00'},
              {label:'ערב',key:'evening',emoji:'🌆',range:'17:00-21:00'},
              {label:'לילה',key:'night',emoji:'🌙',range:'21:00-06:00'},
            ];
            const timing = heroDayData.reduce((acc, d) => {
              if (d.byApp) {
                const t = (d as any).timing || {};
                timePeriods.forEach(p => {
                  acc[p.key] = (acc[p.key]||0) + (t[p.key]||0);
                });
              }
              return acc;
            }, {} as Record<string,number>);
            const maxVal = Math.max(...timePeriods.map(p=>timing[p.key]||0), 1);
            return (
              <View style={{flexDirection:'row',justifyContent:'space-around',marginTop:4}}>
                {timePeriods.map(p => {
                  const val = timing[p.key] || 0;
                  const display = val >= 60 ? Math.round(val/60)+"ש'" : val > 0 ? Math.round(val)+"ד'" : '—';
                  return (
                    <View key={p.key} style={{alignItems:'center',flex:1}}>
                      <Text style={{fontSize:22,marginBottom:4}}>{p.emoji}</Text>
                      <View style={{height:60,width:28,backgroundColor:'#EAF3DE',borderRadius:4,justifyContent:'flex-end',overflow:'hidden'}}>
                        <View style={{width:'100%',borderRadius:4,backgroundColor:'#3B6D11',height:`${Math.round(val/maxVal*100)}%` as any}}/>
                      </View>
                      <Text style={{fontSize:12,fontWeight:'500',marginTop:4,color:'#1a1a18'}}>{display}</Text>
                      <Text style={{fontSize:10,color:'#9a9a94'}}>{p.label}</Text>
                    </View>
                  );
                })}
              </View>
            );
          })()}
        </View>

        <View style={s.card}>
          <Text style={s.cardTitle}>איך היה זמן המסך שלך היום?</Text>
          {todayMood ? (
            <View style={{alignItems:'center',padding:8}}>
              <Text style={{fontSize:36}}>{todayMood==='good'?'😊':todayMood==='neutral'?'😐':'😟'}</Text>
              <Text style={{fontSize:13,color:'#6b6b67',marginTop:4}}>תגובה נשמרה להיום</Text>
            </View>
          ) : (
            <View style={{flexDirection:'row',justifyContent:'space-around',padding:8}}>
              <TouchableOpacity onPress={()=>sendMood('good')} disabled={sendingMood} style={{alignItems:'center',padding:12}}>
                <Text style={{fontSize:36}}>😊</Text>
                <Text style={{fontSize:12,color:'#3B6D11',marginTop:4}}>טוב מהרגיל</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={()=>sendMood('neutral')} disabled={sendingMood} style={{alignItems:'center',padding:12}}>
                <Text style={{fontSize:36}}>😐</Text>
                <Text style={{fontSize:12,color:'#854F0B',marginTop:4}}>רגיל</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={()=>sendMood('bad')} disabled={sendingMood} style={{alignItems:'center',padding:12}}>
                <Text style={{fontSize:36}}>😟</Text>
                <Text style={{fontSize:12,color:'#A32D2D',marginTop:4}}>הרבה מדי</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>

        <TouchableOpacity style={[s.syncBtn, syncing && {opacity: 0.6}]} onPress={syncNow} disabled={syncing}>
          {syncing ? <ActivityIndicator color="#fff"/> : <Text style={s.syncBtnTxt}>סנכרן עכשיו עם המורה</Text>}
        </TouchableOpacity>

      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: {flex: 1, backgroundColor: '#F6F8F6'},
  scroll: {flex: 1},
  container: {padding: 16, paddingBottom: 40},
  center: {flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#F6F8F6'},
  header: {marginBottom: 16},
  heading: {fontSize: 22, fontWeight: '500', color: '#2C3A2E', textAlign: 'right'},
  meta: {fontSize: 11, color: '#9DA99F', textAlign: 'right', marginTop: 2},
  syncNote: {fontSize: 10, color: '#B8C4BA', textAlign: 'right', marginTop: 2},
  metricRow: {flexDirection: 'row', gap: 8, marginBottom: 12},
  metricCard: {flex: 1, backgroundColor: '#fff', borderRadius: 18, padding: 14, borderWidth: 0, shadowColor: '#2C3A2E', shadowOpacity: 0.04, shadowRadius: 8, shadowOffset: {width: 0, height: 2}},
  metricLbl: {fontSize: 11, color: '#9DA99F', textAlign: 'right', marginBottom: 6},
  metricV: {fontSize: 22, fontWeight: '400', color: '#3D5A40', textAlign: 'right'},
  metricSub: {fontSize: 10, color: '#9DA99F', textAlign: 'right'},
  card: {backgroundColor: '#fff', borderRadius: 20, padding: 18, marginBottom: 12, borderWidth: 0, shadowColor: '#2C3A2E', shadowOpacity: 0.04, shadowRadius: 8, shadowOffset: {width: 0, height: 2}},
  cardTitle: {fontSize: 13, fontWeight: '400', color: '#8A9A8C', textAlign: 'right', marginBottom: 14, textTransform: 'none', letterSpacing: 0},
  cardSub: {fontSize: 12, color: '#9DA99F', textAlign: 'right', marginBottom: 10},
  chartWrap: {flexDirection: 'row', alignItems: 'flex-end', gap: 5, height: 90},
  chartCol: {flex: 1, alignItems: 'center', gap: 3},
  chartBarBg: {width: '100%', height: 70, backgroundColor: '#EDF2ED', borderRadius: 6, justifyContent: 'flex-end', overflow: 'hidden'},
  chartBar: {width: '100%', borderRadius: 6},
  chartHour: {fontSize: 8, color: '#9DA99F'},
  chartLbl: {fontSize: 8, color: '#9DA99F'},
  consentRow: {flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 12, borderBottomWidth: 0.5, borderColor: 'rgba(0,0,0,0.06)'},
  consentLbl: {fontSize: 14, color: '#2C3A2E'},
  syncBtn: {backgroundColor: '#3D5A40', borderRadius: 16, padding: 16, alignItems: 'center', marginTop: 6},
  syncBtnTxt: {color: '#fff', fontWeight: '500', fontSize: 15},
  secondaryBtn: {backgroundColor: '#E8F0E9', borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10, alignItems: 'center'},
  secondaryBtnTxt: {color: '#3D5A40', fontSize: 13},
  input: {backgroundColor: '#EDF2ED', borderRadius: 14, padding: 14, fontSize: 15, color: '#2C3A2E', textAlign: 'right', marginBottom: 12, borderWidth: 0, borderColor: 'transparent'},
  authWrap: {flex: 1, backgroundColor: '#F6F8F6', justifyContent: 'center', padding: 24},
  authTitle: {fontSize: 28, fontWeight: '500', color: '#2C3A2E', textAlign: 'right', marginBottom: 4},
  loginWrap: {flex: 1, backgroundColor: '#F6F8F6', justifyContent: 'center', padding: 24},
  loginCard: {flexGrow: 1, justifyContent: 'center'},
  loginTitle: {fontSize: 28, fontWeight: '500', color: '#2C3A2E', textAlign: 'right', marginBottom: 4},
  loginSub: {fontSize: 14, color: '#9DA99F', textAlign: 'right', marginBottom: 24},
  loginBtn: {backgroundColor: '#3D5A40', borderRadius: 16, padding: 18, alignItems: 'center', marginTop: 8},
  loginBtnTxt: {color: '#fff', fontWeight: '500', fontSize: 16},
  errBox: {backgroundColor: '#FBE9E9', borderRadius: 10, padding: 10, marginBottom: 12},
  errTxt: {color: '#A32D2D', fontSize: 13, textAlign: 'right'},
  infoBox: {backgroundColor: '#E8F0E9', borderRadius: 14, padding: 14, marginBottom: 16},
  infoTxt: {fontSize: 14, fontWeight: '500', color: '#3D5A40', textAlign: 'right'},
  infoSub: {fontSize: 12, color: '#3D5A40', textAlign: 'right', marginTop: 2},
  authSub: {fontSize: 14, color: '#9DA99F', textAlign: 'right', marginBottom: 28},
  authBtn: {backgroundColor: '#3D5A40', borderRadius: 16, padding: 18, alignItems: 'center', marginTop: 8},
  authBtnTxt: {color: '#fff', fontWeight: '500', fontSize: 16},
  authToggle: {flexDirection: 'row', justifyContent: 'center', marginTop: 16, gap: 4},
  authToggleTxt: {fontSize: 14, color: '#9DA99F'},
  authLink: {fontSize: 14, color: '#3D5A40', fontWeight: '500'},
  errorTxt: {color: '#A32D2D', fontSize: 13, textAlign: 'right', marginBottom: 8},
  logoutBtn: {alignItems: 'center', padding: 12},
  logoutBtnTxt: {fontSize: 13, color: '#A32D2D'},
});