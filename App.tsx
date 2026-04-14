import React, {useEffect, useState, useCallback} from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, Switch,
  StyleSheet, Alert, ActivityIndicator, RefreshControl,
  SafeAreaView, StatusBar, Platform, TextInput, KeyboardAvoidingView, Linking,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

const SERVER = 'https://screentime-server.onrender.com';
const TOKEN_KEY = '@student_token';
const CONSENT_KEY = '@consent_settings';

interface ConsentSettings {
  total: boolean; byApp: boolean; timing: boolean; classAverage: boolean;
}
interface StudentInfo {
  id: string; name: string; className: string; teacherName: string; platform: string; consent: boolean;
}

function generateDemoData() {
  return Array.from({length: 7}, (_, i) => {
    const date = new Date();
    date.setDate(date.getDate() - (6 - i));
    return {date: date.toISOString().split('T')[0], totalMinutes: Math.floor(Math.random() * 300) + 60};
  });
}

function toDisplay(min: number) {
  if (min < 60) return `${min}ד'`;
  const h = Math.floor(min / 60), m = min % 60;
  return m > 0 ? `${h}ש' ${m}ד'` : `${h}ש'`;
}
function sColor(min: number) { const h = min/60; return h<3?'#3B6D11':h<6?'#854F0B':'#A32D2D'; }
function sLabel(min: number) { const h = min/60; return h<3?'תקין':h<6?'מתון':'גבוה'; }
const DAYS = ['א','ב','ג','ד','ה','ו','ש'];

function extractCode(url: string): string {
  if (url.includes('/join/')) return url.split('/join/')[1].trim();
  return url.trim();
}

async function resolveCode(raw: string): Promise<{token: string, studentName: string, className: string, teacherName: string} | null> {
  const extracted = extractCode(raw);
  // קוד קצר — 6 ספרות
  if (/^\d{6}$/.test(extracted)) {
    const res = await fetch(`https://screentime-server.onrender.com/api/join/code/${extracted}`);
    const data = await res.json();
    if (!data.ok) return null;
    return data;
  }
  // טוקן ארוך
  const res = await fetch(`https://screentime-server.onrender.com/api/join/${extracted}`);
  const data = await res.json();
  if (!data.ok) return null;
  return { token: extracted, ...data };
}

// ─── מסך ברוך הבא ─────────────────────────────────────────────────────────────
function WelcomeScreen({onLogin, onJoin}: {onLogin:()=>void, onJoin:()=>void}) {
  return (
    <SafeAreaView style={s.safe}>
      <View style={s.loginWrap}>
        <View style={s.loginCard}>
          <Text style={s.loginTitle}>מעקב זמן מסך</Text>
          <Text style={s.loginSub}>ברוך הבא!</Text>
          <TouchableOpacity style={s.loginBtn} onPress={onJoin}>
            <Text style={s.loginBtnTxt}>הצטרף בפעם הראשונה</Text>
          </TouchableOpacity>
          <TouchableOpacity style={s.secondaryBtn} onPress={onLogin}>
            <Text style={s.secondaryBtnTxt}>כבר יש לי חשבון — כניסה</Text>
          </TouchableOpacity>
        </View>
      </View>
    </SafeAreaView>
  );
}

// ─── מסך הצטרפות ──────────────────────────────────────────────────────────────
function JoinScreen({onDone, onBack, initialCode}: {onDone:(tok:string,info:StudentInfo)=>void, onBack:()=>void, initialCode:string}) {
  const [step, setStep] = useState<'code'|'create'>(initialCode ? 'code' : 'code');
  const [code, setCode] = useState(initialCode);
  const [studentName, setStudentName] = useState('');
  const [className, setClassName] = useState('');
  const [teacherName, setTeacherName] = useState('');
  const [inviteToken, setInviteToken] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [password2, setPassword2] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // אם קיבלנו קוד מ-Deep Link — בדוק אוטומטית
  useEffect(() => {
    if (initialCode) checkCode(initialCode);
  }, []);

  async function checkCode(codeToCheck?: string) {
    const raw = codeToCheck || code;
    if (!raw.trim()) {setError('נא להכניס קוד הצטרפות'); return;}
    setLoading(true); setError('');
    try {
      const result = await resolveCode(raw);
      if (!result) {setError('קוד לא תקף או שכבר נוצל'); setLoading(false); return;}
      setStudentName(result.studentName);
      setClassName(result.className);
      setTeacherName(result.teacherName);
      setInviteToken(result.token);
      setStep('create');
    } catch(e) {setError('לא ניתן להתחבר לשרת');}
    setLoading(false);
  }

  async function createAccount() {
    if (!username.trim()) {setError('נא לבחור שם משתמש'); return;}
    if (password.length < 4) {setError('הסיסמה חייבת להכיל לפחות 4 תווים'); return;}
    if (password !== password2) {setError('הסיסמאות אינן תואמות'); return;}
    setLoading(true); setError('');
    try {
      const res = await fetch(`${SERVER}/api/join/${inviteToken}`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({username: username.trim(), password}),
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
          {step === 'code' ? (
            <>
              <Text style={s.loginTitle}>הצטרפות</Text>
              <Text style={s.loginSub}>הדבק את קוד ההצטרפות שקיבלת מהמורה</Text>
              {error ? <View style={s.errBox}><Text style={s.errTxt}>{error}</Text></View> : null}
              {loading ? <ActivityIndicator color="#185FA5" style={{marginVertical: 20}}/> : (
                <>
                  <TextInput style={s.input} placeholder="קוד 6 ספרות או קישור" placeholderTextColor="#9a9a94" value={code} onChangeText={setCode} autoCapitalize="none" autoCorrect={false} textAlign="right"/>
                  <Text style={s.inputHint}>הקלד קוד 6 ספרות שקיבלת מהמורה, או סרוק QR</Text>
                  <TouchableOpacity style={s.loginBtn} onPress={() => checkCode()}>
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
              <Text style={s.loginTitle}>יצירת חשבון</Text>
              <View style={s.infoBox}>
                <Text style={s.infoTxt}>שלום, {studentName}</Text>
                <Text style={s.infoSub}>{className} · מורה: {teacherName}</Text>
              </View>
              <Text style={s.loginSub}>בחר שם משתמש וסיסמה</Text>
              {error ? <View style={s.errBox}><Text style={s.errTxt}>{error}</Text></View> : null}
              <TextInput style={s.input} placeholder="שם משתמש (באנגלית)" placeholderTextColor="#9a9a94" value={username} onChangeText={setUsername} autoCapitalize="none" autoCorrect={false} textAlign="right"/>
              <TextInput style={s.input} placeholder="סיסמה (לפחות 4 תווים)" placeholderTextColor="#9a9a94" value={password} onChangeText={setPassword} secureTextEntry textAlign="right" textContentType="oneTimeCode" autoComplete="off"/>
              <TextInput style={s.input} placeholder="אמת סיסמה" placeholderTextColor="#9a9a94" value={password2} onChangeText={setPassword2} secureTextEntry textAlign="right" textContentType="oneTimeCode" autoComplete="off"/>
              <TouchableOpacity style={[s.loginBtn, loading&&{opacity:0.6}]} onPress={createAccount} disabled={loading}>
                {loading ? <ActivityIndicator color="#fff"/> : <Text style={s.loginBtnTxt}>צור חשבון והתחבר</Text>}
              </TouchableOpacity>
            </>
          )}
        </View>
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
          <Text style={s.loginSub}>הכנס את שם המשתמש והסיסמה שיצרת</Text>
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
  const [screen, setScreen] = useState<'welcome'|'join'|'login'|'main'>('welcome');
  const [joinCode, setJoinCode] = useState('');
  const [authToken, setAuthToken] = useState<string|null>(null);
  const [studentInfo, setStudentInfo] = useState<StudentInfo|null>(null);
  const [consent, setConsent] = useState<ConsentSettings>({total:false,byApp:false,timing:false,classAverage:false});
  const [weeklyData, setWeeklyData] = useState(generateDemoData());
  const [syncing, setSyncing] = useState(false);
  const [lastSync, setLastSync] = useState<string|null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    init();
    setTimeout(() => {
      Linking.getInitialURL().then(url => { if (url) handleDeepLink(url); });
    }, 500);
    const sub = Linking.addEventListener('url', ({url}) => handleDeepLink(url));
    return () => sub.remove();
  }, []);

  function handleDeepLink(url: string) {
    if (url && url.includes('/join/')) {
      const code = url.split('/join/')[1]?.trim();
      if (code) {
        setJoinCode(code);
        setScreen('join');
      }
    }
  }

  async function init() {
    const tok = await AsyncStorage.getItem(TOKEN_KEY);
    const sc = await AsyncStorage.getItem(CONSENT_KEY);
    const ls = await AsyncStorage.getItem('@last_sync');
    if (sc) setConsent(JSON.parse(sc));
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
  }

  async function handleAuth(tok: string, info: StudentInfo) {
    await AsyncStorage.setItem(TOKEN_KEY, tok);
    await AsyncStorage.setItem('@student_info', JSON.stringify(info));
    setAuthToken(tok); setStudentInfo(info); setScreen('main');
  }

  async function handleLogout() {
    await AsyncStorage.multiRemove([TOKEN_KEY, '@student_info']);
    setAuthToken(null); setStudentInfo(null); setScreen('welcome');
  }

  async function toggleConsent(field: keyof ConsentSettings) {
    const u = {...consent, [field]: !consent[field]};
    setConsent(u);
    await AsyncStorage.setItem(CONSENT_KEY, JSON.stringify(u));
  }

  const onRefresh = useCallback(async () => {
    setRefreshing(true); setWeeklyData(generateDemoData()); setRefreshing(false);
  }, []);

  async function syncNow() {
    if (!authToken) return;
    setSyncing(true);
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
          consent, platform: Platform.OS, syncedAt: new Date().toISOString(),
        }),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error);
      const now = new Date().toLocaleTimeString('he-IL');
      await AsyncStorage.setItem('@last_sync', now);
      setLastSync(now);
      Alert.alert('סונכרן!', 'הנתונים נשלחו למורה בהצלחה.');
    } catch(e) {
      Alert.alert('שגיאה', 'לא ניתן לסנכרן. בדוק חיבור אינטרנט.');
    }
    setSyncing(false);
  }

  if (loading) return <View style={s.center}><ActivityIndicator size="large" color="#185FA5"/></View>;
  if (screen === 'welcome') return <WelcomeScreen onLogin={() => setScreen('login')} onJoin={() => setScreen('join')}/>;
  if (screen === 'join') return <JoinScreen onDone={handleAuth} onBack={() => setScreen('welcome')} initialCode={joinCode}/>;
  if (screen === 'login') return <LoginScreen onDone={handleAuth} onBack={() => setScreen('welcome')}/>;

  const totalMin = weeklyData.reduce((sum, d) => sum + d.totalMinutes, 0);
  const avgMin = Math.round(totalMin / weeklyData.length);
  const maxMin = Math.max(...weeklyData.map(d => d.totalMinutes), 1);
  const consentCount = Object.values(consent).filter(Boolean).length;

  return (
    <SafeAreaView style={s.safe}>
      <StatusBar barStyle="dark-content"/>
      <ScrollView style={s.scroll} contentContainerStyle={s.container}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh}/>}>

        <View style={s.header}>
          <Text style={s.heading}>זמן מסך שלי</Text>
          {studentInfo && <Text style={s.meta}>{studentInfo.name} · {studentInfo.className} · מורה: {studentInfo.teacherName}</Text>}
          {lastSync && <Text style={s.syncNote}>סונכרן: {lastSync}</Text>}
        </View>

        <View style={s.metricRow}>
          <View style={s.metricCard}><Text style={s.metricLbl}>ממוצע יומי</Text><Text style={s.metricVal}>{toDisplay(avgMin)}</Text></View>
          <View style={s.metricCard}><Text style={s.metricLbl}>סה"כ השבוע</Text><Text style={s.metricVal}>{toDisplay(totalMin)}</Text></View>
          <View style={s.metricCard}><Text style={s.metricLbl}>סטטוס</Text><Text style={[s.metricVal, {color: sColor(avgMin), fontSize: 16}]}>{sLabel(avgMin)}</Text></View>
        </View>

        <View style={s.card}>
          <Text style={s.cardTitle}>זמן מסך שבועי</Text>
          <View style={s.chartWrap}>
            {weeklyData.map((d, i) => (
              <View key={i} style={s.chartCol}>
                <Text style={s.chartHour}>{toDisplay(d.totalMinutes)}</Text>
                <View style={s.chartBarBg}>
                  <View style={[s.chartBar, {height: Math.max(4, Math.round(d.totalMinutes/maxMin*80)), backgroundColor: sColor(d.totalMinutes)}]}/>
                </View>
                <Text style={s.chartLbl}>{DAYS[i]}</Text>
              </View>
            ))}
          </View>
        </View>

        <View style={s.card}>
          <Text style={s.cardTitle}>הגדרות שיתוף עם המורה</Text>
          <Text style={s.cardSub}>{consentCount} קטגוריות מתוך 4 משותפות</Text>
          {([
            ['total', 'זמן מסך כולל'],
            ['byApp', 'פירוט לפי אפליקציה'],
            ['timing', 'שעות שימוש'],
            ['classAverage', 'השוואה לממוצע כיתה'],
          ] as [keyof ConsentSettings, string][]).map(([field, label]) => (
            <View key={field} style={s.consentRow}>
              <Text style={s.consentLbl}>{label}</Text>
              <Switch value={consent[field]} onValueChange={() => toggleConsent(field)} trackColor={{false: '#D3D1C7', true: '#3B6D11'}} thumbColor="#fff"/>
            </View>
          ))}
        </View>

        <TouchableOpacity style={[s.syncBtn, syncing && {opacity: 0.6}]} onPress={syncNow} disabled={syncing}>
          {syncing ? <ActivityIndicator color="#fff"/> : <Text style={s.syncBtnTxt}>סנכרן עכשיו עם המורה</Text>}
        </TouchableOpacity>
        <TouchableOpacity style={s.logoutBtn} onPress={handleLogout}>
          <Text style={s.logoutBtnTxt}>התנתק</Text>
        </TouchableOpacity>

      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: {flex: 1, backgroundColor: '#F5F5F3'},
  scroll: {flex: 1},
  container: {padding: 16, paddingBottom: 40},
  center: {flex: 1, justifyContent: 'center', alignItems: 'center'},
  loginWrap: {flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24},
  loginCard: {width: '100%', maxWidth: 380, backgroundColor: '#fff', borderRadius: 12, padding: 24, borderWidth: 0.5, borderColor: 'rgba(0,0,0,0.12)'},
  loginTitle: {fontSize: 22, fontWeight: '500', color: '#1a1a18', textAlign: 'center', marginBottom: 6},
  loginSub: {fontSize: 13, color: '#6b6b67', textAlign: 'center', marginBottom: 20},
  errBox: {backgroundColor: '#FCEBEB', borderRadius: 8, padding: 10, marginBottom: 12},
  errTxt: {fontSize: 13, color: '#A32D2D', textAlign: 'right'},
  input: {borderWidth: 0.5, borderColor: 'rgba(0,0,0,0.22)', borderRadius: 8, padding: 12, fontSize: 15, color: '#1a1a18', marginBottom: 12, backgroundColor: '#fff'},
  inputHint: {fontSize: 11, color: '#9a9a94', textAlign: 'right', marginBottom: 12, marginTop: -8},
  loginBtn: {backgroundColor: '#1a1a18', borderRadius: 10, padding: 14, alignItems: 'center', marginBottom: 10},
  loginBtnTxt: {color: '#fff', fontSize: 15, fontWeight: '500'},
  secondaryBtn: {borderWidth: 0.5, borderColor: 'rgba(0,0,0,0.22)', borderRadius: 10, padding: 14, alignItems: 'center'},
  secondaryBtnTxt: {color: '#1a1a18', fontSize: 15},
  infoBox: {backgroundColor: '#E6F1FB', borderRadius: 8, padding: 12, marginBottom: 16},
  infoTxt: {fontSize: 15, fontWeight: '500', color: '#185FA5', textAlign: 'right'},
  infoSub: {fontSize: 13, color: '#185FA5', textAlign: 'right', marginTop: 2},
  header: {marginBottom: 16},
  heading: {fontSize: 22, fontWeight: '500', color: '#1a1a18', textAlign: 'right'},
  meta: {fontSize: 13, color: '#6b6b67', textAlign: 'right', marginTop: 2},
  syncNote: {fontSize: 12, color: '#9a9a94', textAlign: 'right', marginTop: 2},
  metricRow: {flexDirection: 'row', gap: 8, marginBottom: 12},
  metricCard: {flex: 1, backgroundColor: '#EEEDE8', borderRadius: 8, padding: 12},
  metricLbl: {fontSize: 11, color: '#6b6b67', marginBottom: 4, textAlign: 'right'},
  metricVal: {fontSize: 18, fontWeight: '500', color: '#1a1a18', textAlign: 'right'},
  card: {backgroundColor: '#fff', borderRadius: 12, padding: 16, marginBottom: 12, borderWidth: 0.5, borderColor: 'rgba(0,0,0,0.12)'},
  cardTitle: {fontSize: 15, fontWeight: '500', color: '#1a1a18', textAlign: 'right', marginBottom: 2},
  cardSub: {fontSize: 13, color: '#6b6b67', textAlign: 'right', marginBottom: 12},
  chartWrap: {flexDirection: 'row', alignItems: 'flex-end', height: 120, marginTop: 8, gap: 4},
  chartCol: {flex: 1, alignItems: 'center', justifyContent: 'flex-end', gap: 4},
  chartHour: {fontSize: 9, color: '#6b6b67'},
  chartBarBg: {width: '100%', height: 80, justifyContent: 'flex-end'},
  chartBar: {width: '100%', borderRadius: 3},
  chartLbl: {fontSize: 11, color: '#6b6b67'},
  consentRow: {flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 10, borderBottomWidth: 0.5, borderColor: 'rgba(0,0,0,0.1)'},
  consentLbl: {fontSize: 14, color: '#1a1a18'},
  syncBtn: {backgroundColor: '#1a1a18', borderRadius: 10, padding: 16, alignItems: 'center', marginBottom: 10},
  syncBtnTxt: {color: '#fff', fontSize: 15, fontWeight: '500'},
  logoutBtn: {alignItems: 'center', padding: 12},
  logoutBtnTxt: {fontSize: 13, color: '#A32D2D'},
});