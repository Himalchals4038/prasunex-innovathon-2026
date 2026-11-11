"use client";

import { FormEvent, ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import {
  Activity, ArrowDownToLine, ArrowLeftRight, ArrowRight, BadgeCheck, BarChart3,
  BookOpenCheck, Building2, CalendarDays, Check, ChevronDown, CircleHelp,
  ClipboardList, FileBadge2, FileChartColumnIncreasing, GraduationCap, HardHat,
  HeartHandshake, KeyRound, LayoutDashboard, LifeBuoy, LogOut, Menu, MessageSquareWarning,
  Network, Plus, Search, Settings2, ShieldCheck, Sparkles, Target, Users, Wrench, X, Brain, Clock3,
} from "lucide-react";
import {
  Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, PolarAngleAxis,
  PolarGrid, PolarRadiusAxis, Radar, RadarChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";

type CampusUser = {
  id: string; tenant_id: string; college_name: string; college_code: string;
  tier: string; tier_name: string; features: Record<string, boolean>;
  email: string; full_name: string; role: string; department: string;
  cgpa: number; karma_points: number; opt_in_recruiter?: boolean;
};
type Course = { id: string; code: string; title: string; department: string; semester: number };
type AnyRow = Record<string, any>;
type Notice = { text: string; kind?: "error" | "success" };

const roleNames: Record<string, string> = {
  chancellor_dean: "Campus administrator", professor_hod: "Professor / HOD",
  student: "Student", technician_warden: "Technician / Warden", recruiter: "Recruiter",
};
const roles = [
  { key: "chancellor_dean", label: "Administrator", icon: Building2 },
  { key: "professor_hod", label: "Professor", icon: BookOpenCheck },
  { key: "student", label: "Student", icon: GraduationCap },
  { key: "technician_warden", label: "Technician", icon: Wrench },
  { key: "recruiter", label: "Recruiter", icon: Search },
];
const demoAccounts: Record<string, { email: string; password: string; college: string }> = {
  chancellor_dean: { email: "admin@nitx.demo", password: "admin", college: "NITX" },
  professor_hod: { email: "professor@nitx.demo", password: "professor", college: "NITX" },
  student: { email: "student001@nitx.demo", password: "student123", college: "NITX" },
  technician_warden: { email: "technician@nitx.demo", password: "technician", college: "NITX" },
  recruiter: { email: "recruiter@nitx.demo", password: "recruiter", college: "NITX" },
};

async function request<T = any>(path: string, token?: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (token) headers.set("Authorization", `Bearer ${token}`);
  if (init.body && !(init.body instanceof FormData) && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  const response = await fetch(`/api${path}`, { ...init, headers, cache: "no-store" });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.detail || data.error || `Request failed (${response.status})`);
  }
  const contentType = response.headers.get("content-type") || "";
  return (contentType.includes("application/json") ? await response.json() : response) as T;
}

function money(value: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(value || 0);
}
function initials(name: string) { return name.split(" ").map((part) => part[0]).slice(0, 2).join("").toUpperCase(); }
function bytesToBigInt(bytes: Uint8Array) { return BigInt(`0x${Array.from(bytes, (x) => x.toString(16).padStart(2, "0")).join("") || "0"}`); }
function hexToBytes(hex: string) { return Uint8Array.from(hex.match(/.{1,2}/g) || [], (x) => parseInt(x, 16)); }
function hexToBase64Url(hex: string) {
  const bytes = hexToBytes(hex); let binary = "";
  bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function bytesToBase64(bytes: Uint8Array) {
  let binary = ""; bytes.forEach((byte) => { binary += String.fromCharCode(byte); }); return btoa(binary);
}
function asBufferSource(bytes: Uint8Array): BufferSource { return bytes.slice().buffer as ArrayBuffer; }
function modPow(base: bigint, exponent: bigint, modulus: bigint) {
  let result = 1n; base %= modulus;
  while (exponent > 0n) { if (exponent & 1n) result = (result * base) % modulus; exponent >>= 1n; base = (base * base) % modulus; }
  return result;
}
function modInverse(value: bigint, modulus: bigint) {
  let a = value % modulus, b = modulus, x = 1n, y = 0n;
  while (b !== 0n) { const q = a / b; [a, b] = [b, a % b]; [x, y] = [y, x - q * y]; }
  if (a !== 1n) throw new Error("Could not create an anonymous eligibility token.");
  return (x % modulus + modulus) % modulus;
}
function gcd(a: bigint, b: bigint): bigint { while (b) [a, b] = [b, a % b]; return a; }
function randomBelow(modulus: bigint) {
  const bytes = new Uint8Array(Math.ceil(modulus.toString(2).length / 8)); crypto.getRandomValues(bytes);
  return bytesToBigInt(bytes) % (modulus - 2n) + 1n;
}
async function rsaWrapShare(share: Uint8Array, publicKey: { modulus: string; exponent: string }) {
  const key = await crypto.subtle.importKey("jwk", {
    kty: "RSA", n: hexToBase64Url(publicKey.modulus), e: hexToBase64Url(publicKey.exponent), alg: "RSA-OAEP-256", ext: true,
  }, { name: "RSA-OAEP", hash: "SHA-256" }, false, ["encrypt"]);
  const wrapped = await crypto.subtle.encrypt({ name: "RSA-OAEP" }, key, asBufferSource(share));
  return bytesToBase64(new Uint8Array(wrapped));
}
async function makeEncryptedAnonymousPayload(message: string, collegeCode: string, token: string) {
  const keyInfo = await request<any>("/privacy/blind-key", token);
  const n = BigInt(`0x${keyInfo.modulus}`), e = BigInt(`0x${keyInfo.exponent}`);
  const tokenBytes = new TextEncoder().encode(token);
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", asBufferSource(tokenBytes)));
  const m = bytesToBigInt(digest) % n;
  let r = randomBelow(n); while (gcd(r, n) !== 1n) r = randomBelow(n);
  const blinded = (m * modPow(r, e, n)) % n;
  const signed = await request<{ blinded_signature: string }>("/privacy/blind-sign", token, {
    method: "POST", body: JSON.stringify({ blinded_message: blinded.toString(16) }),
  });
  const signature = (BigInt(`0x${signed.blinded_signature}`) * modInverse(r, n)) % n;

  const contentKey = crypto.getRandomValues(new Uint8Array(32));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const aesKey = await crypto.subtle.importKey("raw", asBufferSource(contentKey), "AES-GCM", false, ["encrypt"]);
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv: asBufferSource(iv) }, aesKey, asBufferSource(new TextEncoder().encode(message)));
  const deanShare = crypto.getRandomValues(new Uint8Array(32));
  const iccShare = Uint8Array.from(contentKey, (byte, i) => byte ^ deanShare[i]);
  const [keyShareDean, keyShareIcc] = await Promise.all([
    rsaWrapShare(deanShare, keyInfo.dean_encryption_key),
    rsaWrapShare(iccShare, keyInfo.icc_encryption_key),
  ]);
  return {
    college_code: collegeCode, token, signature: signature.toString(16),
    encrypted_body: JSON.stringify({ algorithm: "AES-256-GCM", iv: bytesToBase64(iv), ciphertext: bytesToBase64(new Uint8Array(ciphertext)) }),
    key_share_dean: keyShareDean, key_share_icc: keyShareIcc,
  };
}

function Badge({ children, tone = "neutral" }: { children: ReactNode; tone?: string }) {
  return <span className={`badge badge-${tone}`}>{children}</span>;
}
function Panel({ title, subtitle, children, action }: { title: string; subtitle?: string; children: ReactNode; action?: ReactNode }) {
  return <section className="panel"><div className="panel-head"><div><h2>{title}</h2>{subtitle && <p>{subtitle}</p>}</div>{action}</div>{children}</section>;
}
function Empty({ children }: { children: ReactNode }) { return <div className="empty-state"><Sparkles size={18}/><p>{children}</p></div>; }

export default function Home() {
  const [token, setToken] = useState("");
  const [user, setUser] = useState<CampusUser | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const [showDemo, setShowDemo] = useState(false);
  const [active, setActive] = useState("dashboard");
  const [mobileNav, setMobileNav] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [busy, setBusy] = useState(false);
  const [demoRole, setDemoRole] = useState("chancellor_dean");
  const [loginFields, setLoginFields] = useState(demoAccounts.chancellor_dean);
  const [overview, setOverview] = useState<AnyRow | null>(null);
  const [students, setStudents] = useState<AnyRow[]>([]);
  const [warnings, setWarnings] = useState<AnyRow[]>([]);
  const [courses, setCourses] = useState<Course[]>([]);
  const [tickets, setTickets] = useState<AnyRow[]>([]);
  const [outcomes, setOutcomes] = useState<AnyRow[]>([]);
  const [attendance, setAttendance] = useState<AnyRow[]>([]);
  const [knowledge, setKnowledge] = useState<AnyRow[]>([]);
  const [events, setEvents] = useState<AnyRow[]>([]);
  const [matches, setMatches] = useState<AnyRow[]>([]);
  const [talent, setTalent] = useState<AnyRow[]>([]);
  const [invites, setInvites] = useState<AnyRow[]>([]);
  const [billing, setBilling] = useState<AnyRow | null>(null);
  const [reports, setReports] = useState<AnyRow[]>([]);
  const [studyPlan, setStudyPlan] = useState<AnyRow[]>([]);
  const [drills, setDrills] = useState<AnyRow[]>([]);
  const [selectedCourse, setSelectedCourse] = useState("");
  const [gradeResult, setGradeResult] = useState<AnyRow | null>(null);
  const [meanShift, setMeanShift] = useState(0);
  const [stdScale, setStdScale] = useState(1);
  const [gradeBusy, setGradeBusy] = useState(false);
  const [courseFilter, setCourseFilter] = useState("");

  useEffect(() => {
    const savedToken = localStorage.getItem("nexus_token") || "";
    const savedUser = localStorage.getItem("nexus_user");
    if (savedToken && savedUser) {
      try { setToken(savedToken); setUser(JSON.parse(savedUser)); } catch { localStorage.clear(); }
    }
    setHydrated(true);
  }, []);

  const notify = useCallback((text: string, kind?: Notice["kind"]) => {
    setNotice({ text, kind }); window.setTimeout(() => setNotice(null), 4200);
  }, []);

  const refreshCore = useCallback(async (accessToken: string, currentUser: CampusUser) => {
    const isAdmin = ["chancellor_dean", "professor_hod"].includes(currentUser.role);
    const dataTasks: Promise<any>[] = [
      request("/dashboard/overview", accessToken).then(setOverview),
      request("/facilities/tickets", accessToken).then(setTickets),
      request("/opportunities", accessToken).then(setEvents),
    ];
    if (isAdmin) {
      dataTasks.push(request("/students", accessToken).then(setStudents));
      dataTasks.push(request("/attendance/early-warning", accessToken).then(setWarnings));
      dataTasks.push(request("/grading/courses", accessToken).then((rows: Course[]) => { setCourses(rows); setSelectedCourse((old) => old || rows[0]?.id || ""); }));
      dataTasks.push(request("/accreditation/outcomes", accessToken).then(setOutcomes));
      dataTasks.push(request("/admin/billing", accessToken).then(setBilling));
      if (currentUser.features.zk_grievance) dataTasks.push(request("/privacy/reports", accessToken).then(setReports));
    }
    if (currentUser.role === "student") {
      dataTasks.push(request("/attendance/me", accessToken).then(setAttendance));
      dataTasks.push(request("/knowledge/me", accessToken).then(setKnowledge));
      dataTasks.push(request("/peer-matcher/me", accessToken).then(setMatches));
      dataTasks.push(request("/invites/me", accessToken).then(setInvites));
      dataTasks.push(request("/study-plan", accessToken).then(setStudyPlan));
      dataTasks.push(request("/micro-drills", accessToken).then(setDrills));
    }
    if (currentUser.role === "technician_warden") dataTasks.push(request("/facilities/tickets", accessToken).then(setTickets));
    if (currentUser.role === "recruiter") {
      dataTasks.push(request("/recruiter/talent", accessToken).then(setTalent));
      dataTasks.push(request("/invites/me", accessToken).then(setInvites));
    }
    const results = await Promise.allSettled(dataTasks);
    const firstFailure = results.find((result) => result.status === "rejected") as PromiseRejectedResult | undefined;
    if (firstFailure) notify(firstFailure.reason?.message || "Some dashboard data could not be loaded.", "error");
  }, [notify]);

  useEffect(() => { if (token && user) void refreshCore(token, user); }, [token, user, refreshCore]);

  const doLogin = async (event: FormEvent) => {
    event.preventDefault(); setBusy(true);
    try {
      const result = await request<any>("/auth/login", undefined, { method: "POST", body: JSON.stringify(loginFields) });
      localStorage.setItem("nexus_token", result.access_token);
      localStorage.setItem("nexus_user", JSON.stringify(result.user));
      setToken(result.access_token); setUser(result.user); setActive("dashboard");
      notify(`Welcome back, ${result.user.full_name.split(" ")[0]}.`, "success");
    } catch (error: any) { notify(error.message, "error"); }
    finally { setBusy(false); }
  };
  const logout = () => { localStorage.removeItem("nexus_token"); localStorage.removeItem("nexus_user"); setToken(""); setUser(null); setActive("dashboard"); };
  const changeRole = (role: string) => { setDemoRole(role); setLoginFields(demoAccounts[role]); };
  const run = async <T,>(path: string, init: RequestInit = {}) => request<T>(path, token, init);

  const navigation = useMemo(() => {
    if (!user) return [];
    const common = [{ id: "dashboard", label: "Overview", icon: LayoutDashboard }];
    if (["chancellor_dean", "professor_hod"].includes(user.role)) common.push(
      { id: "students", label: "Student success", icon: Users },
      { id: "grading", label: "Grading sandbox", icon: BarChart3 },
      { id: "attendance", label: "Attendance radar", icon: Activity },
      { id: "accreditation", label: "NBA / NAAC reports", icon: FileBadge2 },
    );
    if (user.role === "student") common.push(
      { id: "learning", label: "My learning", icon: Target },
      { id: "planner", label: "Study planner", icon: CalendarDays },
      { id: "drills", label: "Micro drills", icon: Brain },
      { id: "attendance", label: "My attendance", icon: CalendarDays },
    );
    if (["student", "technician_warden", "chancellor_dean"].includes(user.role)) common.push({ id: "facilities", label: "Facilities desk", icon: Wrench });
    if (user.features.zk_grievance && ["student", "chancellor_dean"].includes(user.role)) common.push({ id: "privacy", label: "Anonymous reporting", icon: ShieldCheck });
    if (["student", "chancellor_dean", "professor_hod"].includes(user.role)) common.push({ id: "community", label: "Peer study matcher", icon: Network });
    common.push({ id: "opportunities", label: "Opportunity radar", icon: Sparkles });
    if (user.role === "recruiter") common.push({ id: "talent", label: "Talent marketplace", icon: Search });
    if (["chancellor_dean", "professor_hod"].includes(user.role)) common.push({ id: "billing", label: "Plans & billing", icon: ArrowLeftRight });
    return common;
  }, [user]);

  const doGradeAnalysis = async (save = false) => {
    if (!selectedCourse) return notify("Choose a course first.", "error");
    setGradeBusy(true);
    try {
      const result = await run<AnyRow>("/grading/sandbox", { method: "POST", body: JSON.stringify({ course_id: selectedCourse, mean_shift: meanShift, std_scale: stdScale, save_grades: save }) });
      setGradeResult(result); notify(save ? "Grade results saved." : "Grade distribution updated.", "success");
    } catch (error: any) { notify(error.message, "error"); }
    finally { setGradeBusy(false); }
  };
  const uploadCsv = async (file?: File) => {
    if (!file || !selectedCourse) return;
    const body = new FormData(); body.set("file", file);
    try {
      const result = await run<AnyRow>(`/grading/upload-csv?course_id=${encodeURIComponent(selectedCourse)}`, { method: "POST", body });
      notify(`${result.uploaded_rows} marks rows imported.`, "success"); void doGradeAnalysis();
    } catch (error: any) { notify(error.message, "error"); }
  };

  if (!hydrated) return <div className="loading-screen"><div className="brand-symbol">N</div><span>Opening your campus…</span></div>;
  if (!user || !token) return showDemo
    ? <LoginScreen demoRole={demoRole} loginFields={loginFields} busy={busy} changeRole={changeRole} setLoginFields={setLoginFields} doLogin={doLogin} notice={notice} onClose={() => setShowDemo(false)}/>
    : <LandingPage onDemo={() => setShowDemo(true)} onLogin={() => setShowDemo(true)}/>;

  const iconForActive = navigation.find((item) => item.id === active)?.icon || LayoutDashboard;
  const ActiveIcon = iconForActive;
  const atRisk = warnings.length;

  return <div className="app-shell">
    {mobileNav && <button className="nav-scrim" aria-label="Close navigation" onClick={() => setMobileNav(false)} />}
    <aside className={`sidebar ${mobileNav ? "sidebar-open" : ""}`}>
      <a className="brand" href="#home"><span className="brand-symbol"><Network size={20}/></span><span className="brand-name">CAMPUS<span>-NEXUS</span><small>COGNITIVE CAMPUS OS</small></span></a>
      <div className="tenant-label">YOUR CAMPUS</div>
      <div className="tenant-card"><span className="tenant-avatar">{user.college_code.slice(0, 1)}</span><span><strong>{user.college_name}</strong><small>{user.tier_name} plan</small></span><ChevronDown size={14}/></div>
      <div className="nav-caption">WORKSPACE</div>
      <nav className="side-nav">{navigation.map((item) => {
        const Icon = item.icon;
        return <button key={item.id} className={`nav-link ${active === item.id ? "nav-active" : ""}`} onClick={() => { setActive(item.id); setMobileNav(false); }}><Icon size={16}/><span>{item.label}</span>{item.id === "students" && atRisk > 0 && <i>{atRisk}</i>}</button>;
      })}</nav>
      <div className="sidebar-bottom"><div className="help-card"><span><LifeBuoy size={17}/></span><strong>Need a hand?</strong><p>Browse guides and campus support resources.</p><button onClick={() => notify("Help centre is part of the full product.")}>Open help centre <ArrowRight size={12}/></button></div><div className="account-row"><div className="person-avatar">{initials(user.full_name)}</div><div className="account-copy"><strong>{user.full_name}</strong><small>{roleNames[user.role]}</small></div><button className="logout-button" onClick={logout} title="Sign out"><LogOut size={15}/></button></div></div>
    </aside>

    <main className="main-area">
      <header className="topbar"><button className="mobile-menu" onClick={() => setMobileNav(true)} aria-label="Open navigation"><Menu size={19}/></button><div className="crumbs"><span>{user.college_name}</span><b>/</b><strong><ActiveIcon size={14}/>{navigation.find((item) => item.id === active)?.label}</strong></div><div className="topbar-right"><span className="term-pill"><span/>Fall semester · 2025–26</span><button className="top-icon" onClick={() => notify("You’re all caught up on notifications.")} aria-label="Notifications"><MessageSquareWarning size={16}/></button><span className="top-separator"/><span className="top-profile">{initials(user.full_name)}</span></div></header>
      <div className="page-wrap"><div className="demo-banner"><Sparkles size={14}/><span><strong>Product concept demo</strong><i/> Sample data and predictive signals are illustrative.</span><button onClick={(event) => (event.currentTarget.parentElement as HTMLElement).remove()}><X size={13}/></button></div>
        <div className="page-title-row"><div><div className="overline">{user.college_code} <span>·</span> {roleNames[user.role]}</div><h1>{pageTitle(active, user.full_name)}</h1><p>{pageSubtitle(active)}</p></div><div className="tier-indicator"><span className="tier-dot"/>{user.tier_name}<ChevronDown size={13}/></div></div>
        {active === "dashboard" && <Dashboard user={user} overview={overview} students={students} warnings={warnings} tickets={tickets} onView={setActive} onNotify={notify}/>}
        {active === "students" && <StudentsView students={students} warnings={warnings} onRisk={(studentId) => void run(`/students/${studentId}/risk`).then((data: any) => notify(`Risk: ${data.risk_level}. ${data.weak_concepts.length} weak concepts.`, "success")).catch((e: any) => notify(e.message, "error"))}/>}
        {active === "grading" && <GradingView courses={courses} selectedCourse={selectedCourse} setSelectedCourse={setSelectedCourse} result={gradeResult} meanShift={meanShift} setMeanShift={setMeanShift} stdScale={stdScale} setStdScale={setStdScale} busy={gradeBusy} onRun={doGradeAnalysis} onUpload={uploadCsv} onExport={() => { if (selectedCourse) void downloadProtected(`/grading/export-csv/${encodeURIComponent(selectedCourse)}`, run, "campus-nexus-grades.csv"); }} onNotify={notify}/>}
        {active === "learning" && <LearningView knowledge={knowledge} courses={courses} onAttempt={async (courseId, conceptCode) => { const correct = window.confirm("Did you answer the practice check correctly? Choose OK for yes or Cancel for no."); try { const result = await run<AnyRow>("/knowledge/attempts", { method: "POST", body: JSON.stringify({ course_id: courseId, concept_code: conceptCode, correct }) }); notify(`${correct ? "Practice recorded" : "Review recommended"}. ${conceptCode} mastery is now ${Math.round(result.mastery * 100)}%.`, "success"); const updated = await run<AnyRow[]>("/knowledge/me"); setKnowledge(updated); } catch (error: any) { notify(error.message, "error"); } }}/>} 
        {active === "planner" && <StudyPlannerView plan={studyPlan} run={run} refresh={() => void run<AnyRow[]>("/study-plan").then(setStudyPlan)} onNotify={notify}/>}
        {active === "drills" && <MicroDrillsView drills={drills} onNotify={notify}/>}
        {active === "attendance" && <AttendanceView data={user.role === "student" ? attendance : warnings} student={user.role === "student"}/>}
        {active === "accreditation" && <AccreditationView outcomes={outcomes} onExport={() => void downloadProtected("/accreditation/sar.pdf", run, "campus-nexus-sar.pdf")}/>}
        {active === "facilities" && <FacilitiesView tickets={tickets} user={user} run={run} refresh={() => void run<AnyRow[]>("/facilities/tickets").then(setTickets)} onNotify={notify}/>}
        {active === "privacy" && <PrivacyView user={user} token={token} reports={reports} run={run} refresh={() => void run<AnyRow[]>("/privacy/reports").then(setReports)} onNotify={notify}/>}
        {active === "community" && <CommunityView user={user} matches={matches} run={run} onNotify={notify} refresh={() => void run<AnyRow[]>("/peer-matcher/me").then(setMatches)}/>}
        {active === "opportunities" && <OpportunitiesView events={events} user={user} run={run} onNotify={notify}/>}
        {active === "talent" && <TalentView talent={talent} setTalent={setTalent} invites={invites} run={run} onNotify={notify} refresh={() => void run<AnyRow[]>("/invites/me").then(setInvites)}/>}
        {active === "billing" && <BillingView billing={billing} user={user} run={run} onNotify={notify} refresh={() => void run<AnyRow>("/admin/billing").then(setBilling)}/>}
        <footer className="page-footer"><span>© 2026 CAMPUS-NEXUS</span><span><i/> Local demo · Your campus data stays in this environment</span><span>Designed for better learning outcomes <Sparkles size={12}/></span></footer>
      </div>
    </main>
    {notice && <div className={`toast ${notice.kind === "error" ? "toast-error" : ""}`} role="status">{notice.kind === "error" ? <X size={15}/> : <Check size={15}/>}<span>{notice.text}</span></div>}
  </div>;
}

function pageTitle(view: string, name: string) {
  const firstName = name.split(" ")[0];
  const titles: Record<string, string> = { dashboard: `Good morning, ${firstName}`, students: "Student success radar", grading: "Relative grading sandbox", learning: "Your learning radar", planner: "Your study planner", drills: "Micro drill queue", attendance: "Attendance forecast", accreditation: "Accreditation readiness", facilities: "Campus facilities desk", privacy: "Speak up, safely", community: "Study better, together", opportunities: "Opportunity radar", talent: "Verified talent marketplace", billing: "Plans & campus billing" };
  return titles[view] || "Campus overview";
}
function pageSubtitle(view: string) {
  const subtitles: Record<string, string> = {
    dashboard: "Here’s a pulse check on learning and campus operations.",
    students: "Use early signals to plan a supportive check-in with students.",
    grading: "Explore a curve, review question quality and export grade results.",
    learning: "See what you know and practise the concepts you’re still building.",
    planner: "A mastery-priority weekly plan built from your course signals.",
    drills: "Short revision prompts ordered by concepts that need practice.",
    attendance: "Plan ahead so you can stay on track with the 75% attendance rule.",
    accreditation: "Gather course-outcome evidence for your NBA / NAAC review.",
    facilities: "Report and resolve equipment or campus maintenance issues.",
    privacy: "Submit a concern using a blind-signed eligibility token.",
    community: "Get matched with peers for concepts you’re learning or can teach.",
    opportunities: "Find competitions and experiences that help you grow.",
    talent: "Discover opted-in student profiles by verified skill signals.",
    billing: "Review plan features and estimate annual recurring revenue.",
  };
  return subtitles[view] || "Cognitive tools for a better campus experience.";
}

function LoginScreen({ demoRole, loginFields, busy, changeRole, setLoginFields, doLogin, notice, onClose }: {
  demoRole: string; loginFields: { email: string; password: string; college: string };
  busy: boolean; changeRole: (role: string) => void;
  setLoginFields: (fields: { email: string; password: string; college: string }) => void;
  doLogin: (event: FormEvent) => void; notice: Notice | null; onClose?: () => void;
}) {
  return <div className="login-screen"><div className="login-decor decor-one"/><div className="login-decor decor-two"/><div className="login-brand"><span className="brand-symbol"><Network size={21}/></span><span className="brand-name">CAMPUS<span>-NEXUS</span><small>COGNITIVE CAMPUS OS</small></span>{onClose && <button className="back-to-landing" onClick={onClose}><ArrowRight size={12}/> Back to product</button>}</div><div className="login-content"><div className="login-copy"><Badge tone="lime"><Sparkles size={12}/> LEARNING, CONNECTED</Badge><h1>A campus that<br/><em>thinks ahead.</em></h1><p>One intelligent workspace to help students grow, faculty teach, and campuses run better.</p><div className="login-features"><div><span><Target size={15}/></span><strong>Support students sooner</strong><small>Learning signals that guide better conversations.</small></div><div><span><FileChartColumnIncreasing size={15}/></span><strong>Make progress visible</strong><small>Academic outcomes and campus operations, together.</small></div><div><span><ShieldCheck size={15}/></span><strong>Put trust at the centre</strong><small>Privacy-aware workflows for a safer campus.</small></div></div><div className="login-proof"><span className="proof-avatars"><i>ST</i><i>PR</i><i>AD</i></span><span>One workspace.<br/><strong>Every campus voice.</strong></span></div></div><div className="login-card"><span className="login-card-kicker">WELCOME TO YOUR CAMPUS</span><h2>Sign in to CAMPUS-NEXUS</h2><p>Choose a demo role to explore its workspace.</p><div className="role-picker">{roles.map((role) => { const Icon = role.icon; return <button key={role.key} onClick={() => changeRole(role.key)} className={demoRole === role.key ? "role-picked" : ""}><Icon size={16}/><span>{role.label}</span></button>; })}</div><form onSubmit={doLogin}><label>College code</label><input required value={loginFields.college} onChange={(event) => setLoginFields({ ...loginFields, college: event.target.value.toUpperCase() })} placeholder="NITX"/><label>Email address</label><input required type="email" value={loginFields.email} onChange={(event) => setLoginFields({ ...loginFields, email: event.target.value })}/><label>Password</label><input required type="password" value={loginFields.password} onChange={(event) => setLoginFields({ ...loginFields, password: event.target.value })}/>{notice && <div className="login-error">{notice.text}</div>}<button className="login-submit" disabled={busy}>{busy ? "Signing you in…" : "Sign in to workspace"}<ArrowRight size={16}/></button></form><div className="login-note"><KeyRound size={13}/> Demo account credentials prefilled. Change the role above to switch demo views.</div><div className="login-colleges"><span>AVAILABLE DEMO CAMPUSES</span><Badge>NITX · Enterprise</Badge><Badge>RBCE · Cognitive</Badge></div></div></div><div className="login-bottom"><span>© 2026 CAMPUS-NEXUS · PRIVATE DEMO ENVIRONMENT</span><span>Built for human-centred campus outcomes</span></div></div>;
}

function LandingPage({ onDemo, onLogin }: { onDemo: () => void; onLogin: () => void }) {
  const modules = [
    ["01", "DKT-Graph mastery", "Trace a learning gap to its prerequisite."], ["02", "Grade time machine", "Compare mark scenarios before a decision."],
    ["03", "AI study planner", "Turn weak concepts and exam dates into a plan."], ["04", "Forgetting-aware drills", "Bring concepts back when revision matters."],
    ["05", "Peer matcher", "Connect students for reciprocal study."], ["06", "Student copilot", "Find grounded answers from course materials."],
    ["07", "Grievance centre", "Track concerns through a clear response path."], ["08", "Photo-to-marks", "Extract marks with confidence and review."],
    ["09", "Grading sandbox", "Model curves and question quality."], ["10", "IRT item audit", "Find items that may need another look."],
    ["11", "Paper auditor", "Review syllabus and Bloom's coverage."], ["12", "Exam scheduler", "Resolve clashes with human approval."],
    ["13", "Syllabus copilot", "Retrieve answers with source citations."], ["14", "Complaint deduplication", "Group similar issues for human review."],
    ["15", "SLA & equipment forecast", "Track response progress and maintenance risk."],
  ];
  return <div className="landing-page">
    <div className="landing-orbit orbit-a"/><div className="landing-orbit orbit-b"/>
    <header className="landing-nav"><a href="#top" className="landing-brand"><span><Network size={20}/></span><b>CAMPUS-NEXUS<small>THE CONNECTED CAMPUS OS</small></b></a><nav><a href="#platform">Platform</a><a href="#portals">Portals</a><a href="#intelligence">Intelligence loop</a><a href="#trust">Trust & security</a></nav><div><button className="landing-signin" onClick={onLogin}>Sign in</button><button className="landing-nav-cta" onClick={onDemo}>View live demo <ArrowRight size={14}/></button></div></header>
    <main id="top"><section className="landing-hero"><div className="landing-hero-copy"><Badge tone="lime"><span className="live-pip"/> PRASUNEX INNOVATHON 2026</Badge><div className="hero-kicker">THE CAMPUS INTELLIGENCE LAYER</div><h1>One campus.<br/><em>One intelligence.</em><br/>Better decisions.</h1><p>Connect academic performance, campus operations and student wellbeing through one intelligent ecosystem.</p><div className="hero-actions"><button className="landing-primary" onClick={() => document.getElementById("platform")?.scrollIntoView({ behavior: "smooth" })}>Explore platform <ArrowRight size={15}/></button><button className="landing-secondary" onClick={onDemo}><span className="play-icon">▶</span> View live demo</button></div><div className="hero-footnote"><span><i/> 3 connected portals</span><span>·</span><span>15 intelligence modules</span><span>·</span><span>From a mark to a decision.</span></div></div><div className="hero-visual" aria-label="Connected campus intelligence diagram"><div className="visual-glow"/><div className="orbit-ring ring-one"/><div className="orbit-ring ring-two"/><div className="orbit-ring ring-three"/><div className="campus-silhouette"><div className="building-shape building-left"><i/><i/><i/><i/><i/><i/></div><div className="building-shape building-center"><i/><i/><i/><i/><i/><i/><i/><i/><i/></div><div className="building-shape building-right"><i/><i/><i/><i/><i/><i/></div></div><div className="intelligence-core"><Network size={26}/><b>NEXUS</b><small>INTELLIGENCE</small></div><div className="orbit-node node-academic"><BookOpenCheck size={15}/><span>ACADEMIC<br/>INTELLIGENCE</span></div><div className="orbit-node node-ops"><Wrench size={15}/><span>CAMPUS<br/>OPERATIONS</span></div><div className="orbit-node node-trust"><ShieldCheck size={15}/><span>STUDENT<br/>TRUST</span></div><div className="orbit-node node-assess"><BarChart3 size={15}/><span>FAIR<br/>ASSESSMENT</span></div><div className="visual-caption"><i/> CONNECTED CAMPUS SIGNALS <span>·</span> HUMAN-LED ACTION</div></div><div className="hero-bottom-line"><span>EXPLAIN</span><i/><span>FIX</span><i/><span>PROTECT</span></div></section>

      <section className="landing-section problem-section" id="problem"><div className="section-heading"><span className="section-index">01 / THE PROBLEM</span><h2>Campus data lives in silos.<br/><em>So do the decisions.</em></h2><p>A mark sits in one spreadsheet. A broken instrument is buried in a message thread. A student asks for help after the warning signs have passed.</p></div><div className="problem-grid"><div className="problem-card"><span className="problem-number">01</span><div className="problem-mark">▤</div><strong>Academic signals arrive late</strong><p>Marks show what happened. They rarely explain which prerequisite got in the way.</p><span className="problem-tag">MARKS WITHOUT CONTEXT</span></div><div className="problem-card"><span className="problem-number">02</span><div className="problem-mark">⌂</div><strong>Operations lose the thread</strong><p>Duplicate reports compete for attention while equipment and response history stay disconnected.</p><span className="problem-tag">TICKETS WITHOUT OWNERSHIP</span></div><div className="problem-card"><span className="problem-number">03</span><div className="problem-mark">♧</div><strong>Trust needs a safer path</strong><p>Students need a clear route to raise a concern and follow progress without fear.</p><span className="problem-tag">FEEDBACK WITHOUT TRUST</span></div></div></section>

      <section className="landing-section solution-section"><div className="section-heading centered"><span className="section-index">02 / THE CAMPUS-NEXUS LOOP</span><h2>From a signal to a <em>next step.</em></h2><p>CAMPUS-NEXUS links what a campus already knows, explains what it could mean, then gives the right person a useful next action.</p></div><div className="loop-steps"><div><span>01</span><b>EXPLAIN</b><p>Trace a mark to the concept that needs attention.</p></div><i>→</i><div><span>02</span><b>DECIDE</b><p>Model a fair response with visible evidence.</p></div><i>→</i><div><span>03</span><b>ACT</b><p>Route support or maintenance to an owner.</p></div><i>→</i><div><span>04</span><b>LEARN</b><p>Feed the outcome back into campus insight.</p></div></div></section>

      <section className="landing-section portals-section" id="portals"><div className="section-heading"><span className="section-index">03 / ONE PRODUCT, THREE PORTALS</span><h2>Built around the people<br/>who <em>move campus forward.</em></h2></div><div className="portal-grid"><article className="portal-card student-portal"><div className="portal-top"><span>01 / STUDENT PORTAL</span><GraduationCap size={20}/></div><h3>Know where you stand.<br/><em>Know what to do next.</em></h3><p>See mastery, attendance and next steps in one personal learning workspace.</p><div className="portal-preview"><span>MY MASTERY <b>72%</b></span><div><i style={{ width: "72%" }}/></div><small>Data Structures <em>·</em> Graph traversal</small><div className="preview-next"><Target size={13}/> Review prerequisite: recursion <ArrowRight size={12}/></div></div><button onClick={onDemo}>Explore student portal <ArrowRight size={13}/></button></article><article className="portal-card professor-portal"><div className="portal-top"><span>02 / PROFESSOR PORTAL</span><BookOpenCheck size={20}/></div><h3>Make assessment<br/><em>evidence work harder.</em></h3><p>Review cohort signals, test grading scenarios and inspect question quality.</p><div className="portal-preview professor-preview"><div className="preview-chart-head"><span>CLASS SCORE DISTRIBUTION</span><small>DATA STRUCTURES · MIDTERM</small></div><div className="preview-bars"><i/><i/><i/><i/><i/><i/><i/><i/><i/></div><div className="preview-scale"><span>0</span><span>MARKS / 100</span><span>100</span></div><div className="preview-curve">Gaussian + KDE · scenario only</div></div><button onClick={onDemo}>Explore professor portal <ArrowRight size={13}/></button></article><article className="portal-card admin-portal"><div className="portal-top"><span>03 / ADMIN & TECHNICIAN</span><HardHat size={20}/></div><h3>Make operations<br/><em>visible and accountable.</em></h3><p>Follow tickets, SLA timelines and aggregated institutional signals.</p><div className="portal-preview ticket-preview"><div><span className="ticket-light red-light"/><b>FX-2048</b><small>Electronics Lab 2</small><Badge tone="amber">In progress</Badge></div><div><span className="ticket-light green-light"/><b>FX-2047</b><small>Block C · Ground floor</small><Badge tone="green">Resolved</Badge></div><div className="ticket-sla"><span>Response timeline</span><b>31h <small>of 48h SLA</small></b><i><em/></i></div></div><button onClick={onDemo}>Explore operations portal <ArrowRight size={13}/></button></article></div></section>

      <section className="landing-section modules-section" id="platform"><div className="section-heading centered"><span className="section-index">04 / THE PLATFORM</span><h2>Fifteen modules.<br/><em>One connected intelligence loop.</em></h2><p>Explore tools by portal. Some outputs in this competition demo are simulated and clearly identified.</p></div><div className="module-filter-row"><span><i/> ACADEMIC INTELLIGENCE</span><span><i/> FAIR ASSESSMENT</span><span><i/> CAMPUS OPERATIONS</span><span><i/> TRUST & COMMUNITY</span></div><div className="module-grid-landing">{modules.map(([number, title, description]) => <article className="module-tile" key={number}><span>{number}</span><div><strong>{title}</strong><p>{description}</p></div><ArrowRight size={13}/></article>)}</div><div className="module-honesty"><ShieldCheck size={15}/><span><strong>Clear about what’s real.</strong> Model-driven features are labelled when they use simulated demonstration logic.</span></div></section>

      <section className="landing-section intelligence-section" id="intelligence"><div className="intelligence-copy"><span className="section-index">05 / THE CENTRAL INTELLIGENCE LAYER</span><h2>One signal.<br/><em>Better decisions everywhere.</em></h2><p>A low mark can be more than a number. NEXUS follows the evidence from concept mastery to a timely student check-in, a clearer professor view and an aggregated campus trend.</p><button className="landing-secondary" onClick={onDemo}>Follow the demo workflow <ArrowRight size={14}/></button></div><div className="flow-diagram"><div className="flow-center"><Network size={22}/><strong>NEXUS</strong><small>INTELLIGENCE LAYER</small></div><div className="flow-node flow-student"><GraduationCap size={15}/><span>STUDENT<br/><small>Practice signal</small></span></div><div className="flow-node flow-dkt"><Target size={15}/><span>DKT GRAPH<br/><small>Prerequisite gap</small></span></div><div className="flow-node flow-plan"><CalendarDays size={15}/><span>STUDY PLAN<br/><small>Next action</small></span></div><div className="flow-node flow-prof"><BookOpenCheck size={15}/><span>PROFESSOR<br/><small>Cohort insight</small></span></div><div className="flow-node flow-admin"><Building2 size={15}/><span>CAMPUS<br/><small>Trend view</small></span></div><div className="flow-connector connector-1"/><div className="flow-connector connector-2"/><div className="flow-connector connector-3"/><div className="flow-connector connector-4"/><div className="flow-connector connector-5"/></div></section>

      <section className="landing-section preview-section"><div className="section-heading"><span className="section-index">06 / PRODUCT ANALYTICS PREVIEW</span><h2>See the campus<br/><em>with more context.</em></h2><p>Explore a live demo with seeded synthetic data from two colleges and 200 sample students.</p></div><div className="preview-dashboard"><div className="preview-dash-head"><span>INSTITUTIONAL OVERVIEW <Badge tone="lime">DEMO DATA</Badge></span><small>Northstar Institute <ChevronDown size={12}/></small></div><div className="preview-metrics"><div><small>STUDENTS</small><strong>120</strong><span>sample roster</span></div><div><small>AVG. ATTENDANCE</small><strong>76.8%</strong><span>current term</span></div><div><small>OPEN TICKETS</small><strong>2</strong><span>48h SLA tracking</span></div><div><small>CONCEPT MASTERY</small><strong>68%</strong><span>BKT demo estimate</span></div></div><div className="preview-data-row"><div><span>COURSE MASTERY <small>SYNTHETIC COHORT</small></span><div className="preview-line-chart"><div/><svg viewBox="0 0 420 100" preserveAspectRatio="none"><path d="M0 77 C40 66,58 73,86 53 S133 62,164 46 S211 55,242 35 S285 49,319 29 S365 34,420 12"/></svg></div><div className="preview-xlabels"><span>W1</span><span>W3</span><span>W5</span><span>W7</span><span>W9</span></div></div><div><span>STUDENT SIGNALS <small>HUMAN REVIEW REQUIRED</small></span><div className="preview-risk"><b>7</b><span>attendance check-ins</span><i/><b>4</b><span>concept support flags</span><i/><b>2</b><span>facilities priorities</span></div></div></div></div></section>

      <section className="landing-section trust-section" id="trust"><div className="section-heading centered"><span className="section-index">07 / TRUST, PRIVACY & ARCHITECTURE</span><h2>Useful intelligence.<br/><em>With clear boundaries.</em></h2><p>Role-based access, tenant-scoped data and explicit consent are part of the product foundation.</p></div><div className="trust-grid"><article><ShieldCheck size={20}/><strong>Privacy-aware workflows</strong><p>Anonymous reporting uses a blind-signed eligibility proof in the demo. Security review is required before real sensitive use.</p><Badge tone="green">IMPLEMENTED · DEMO</Badge></article><article><Building2 size={20}/><strong>Tenant-isolated access</strong><p>API queries apply the authenticated college scope. Demo accounts make role-specific access easy to explore.</p><Badge tone="green">IMPLEMENTED</Badge></article><article><Activity size={20}/><strong>Honest model signals</strong><p>BKT estimates and local triage are labelled. Untrained outputs are not presented as measured AI accuracy.</p><Badge tone="amber">SIMULATED WHERE LABELLED</Badge></article></div><div className="architecture-line"><span>Next.js · TypeScript</span><i>→</i><span>FastAPI · JWT / RBAC</span><i>→</i><span>PostgreSQL / SQLite</span><i>→</i><span>Scikit-learn · ONNX-ready</span></div></section>

      <section className="final-cta"><div className="cta-orbit cta-orbit-one"/><div className="cta-orbit cta-orbit-two"/><span className="section-index">CAMPUS-NEXUS v2 · PRASUNEX INNOVATHON 2026</span><h2>Make the next decision<br/><em>the better one.</em></h2><p>Explore the connected campus intelligence demo.</p><button className="landing-primary" onClick={onDemo}>Enter demo mode <ArrowRight size={15}/></button><small>Demo accounts · Synthetic data · Local environment</small></section></main>
    <footer className="landing-footer"><a href="#top" className="landing-brand"><span><Network size={17}/></span><b>CAMPUS-NEXUS<small>FROM A MARK TO A DECISION.</small></b></a><span>© 2026 CAMPUS-NEXUS · PRASUNEX INNOVATHON</span><div><a href="#platform">Platform</a><a href="#trust">Privacy</a><button onClick={onLogin}>Judge sign-in</button></div></footer>
  </div>;
}

function Dashboard({ user, overview, students, warnings, tickets, onView, onNotify }: { user: CampusUser; overview: AnyRow | null; students: AnyRow[]; warnings: AnyRow[]; tickets: AnyRow[]; onView: (view: string) => void; onNotify: (text: string) => void }) {
  const stats = [
    { label: "Students in your campus", value: overview?.student_count?.toLocaleString() ?? "—", change: "2 colleges connected", icon: Users, color: "green" },
    { label: "Attendance, this term", value: overview ? `${overview.average_attendance}%` : "—", change: "75% is the eligibility goal", icon: CalendarDays, color: "blue" },
    { label: "Maintenance requests", value: overview?.open_tickets ?? "—", change: `${tickets.filter((x) => x.status === "In progress").length} being worked on`, icon: Wrench, color: "amber" },
    { label: "Concept mastery", value: overview ? `${overview.average_mastery}%` : "—", change: `${overview?.courses ?? "—"} courses mapped`, icon: Target, color: "violet" },
  ];
  const needsSupport = warnings.slice(0, 5);
  const attendanceScatter = students.slice(0, 40).map((s, i) => ({ x: (i * 23 + 31) % 100, y: (i * 37 + 44) % 100, label: s.full_name }));
  const atRiskNames = students.filter((student) => warnings.some((item) => item.student_id === student.id)).slice(0, 4);
  return <div className="view-stack">
    <div className="stat-grid">{stats.map((stat) => { const Icon = stat.icon; return <article className="stat-card" key={stat.label}><div className="stat-top"><span>{stat.label}</span><i className={`stat-icon ${stat.color}`}><Icon size={16}/></i></div><strong>{stat.value}</strong><small>{stat.change}</small><div className="stat-spark"/></article>; })}</div>
    <div className="dashboard-columns"><Panel title="Learning health" subtitle="Attendance signals across this campus" action={<button className="small-action" onClick={() => onView(user.role === "student" ? "attendance" : "students")}>Open radar <ArrowRight size={13}/></button>}>
      <div className="chart-legend"><span><i className="legend-green"/>On track</span><span><i className="legend-amber"/>Check in soon</span><span className="threshold-key">75% attendance guide</span></div>
      <div className="scatter-area"><div className="y-labels"><span>100</span><span>75</span><span>50</span><span>25</span><span>0</span></div><div className="scatter-plot"><div className="scatter-horizontal"><i/><i/><i/><i/><i/></div><div className="scatter-threshold"/><div className="scatter-dots">{attendanceScatter.map((point, index) => <i key={`${point.label}-${index}`} title={point.label} className={point.y < 75 ? "dot-risk" : "dot-ok"} style={{ left: `${point.x}%`, bottom: `${point.y}%` }}/>)}</div><div className="scatter-x"><span>0%</span><span>25%</span><span>50%</span><span>75%</span><span>100%</span></div></div></div>
      <div className="chart-callout"><Sparkles size={15}/><span><strong>{warnings.length} student signals to review</strong><small>Signals are prompts for human support, not automated decisions.</small></span><button onClick={() => onView(user.role === "student" ? "attendance" : "students")}>Review <ArrowRight size={12}/></button></div>
    </Panel><Panel title="Campus pulse" subtitle="A quick look at today's activity"><div className="pulse-list"><Pulse icon={<BadgeCheck size={15}/>} tone="green" title="Course evidence is ready" description="Outcome mapping available for review" time="12 min ago"/><Pulse icon={<Wrench size={15}/>} tone="amber" title={`${tickets.filter((x) => x.status !== "Resolved").length} open facilities tickets`} description="Review the technician queue" time="38 min ago"/><Pulse icon={<Users size={15}/>} tone="violet" title={`${warnings.length} attendance signals`} description="A check-in could help these students" time="1 hour ago"/><Pulse icon={<Sparkles size={15}/>} tone="blue" title="New campus opportunities" description="Hackathons and fellowships are open" time="Today"/></div><button className="panel-bottom-link" onClick={() => onView("opportunities")}>Explore opportunities <ArrowRight size={12}/></button></Panel></div>
    <div className="dashboard-columns lower-columns"><Panel title="Students to check in with" subtitle="Based on attendance records in this semester" action={<button className="small-action" onClick={() => onView("students")}>View all <ArrowRight size={13}/></button>}>
      {atRiskNames.length ? <div className="simple-table"><div className="table-head"><span>STUDENT</span><span>COURSE</span><span>ATTENDANCE</span><span>STATUS</span></div>{atRiskNames.map((student) => { const warning = warnings.find((item) => item.student_id === student.id); return <div className="table-row" key={student.id}><span className="student-name-cell"><i className="mini-avatar">{initials(student.full_name)}</i><b>{student.full_name}<small>{student.department}</small></b></span><span>{warning?.course_code}</span><span><i className="mini-progress"><i style={{ width: `${warning?.current_percentage || 0}%` }}/></i>{warning?.current_percentage}%</span><span><Badge tone={warning?.current_percentage < 65 ? "red" : "amber"}>{warning?.current_percentage < 65 ? "Priority" : "Check in"}</Badge></span></div>; })}</div> : <Empty>Everything is looking steady. More student signals appear as this campus adds course activity.</Empty>}
    </Panel><Panel title="Your plan" subtitle="Features available at this campus"><div className="plan-card"><div><Badge tone="lime"><Sparkles size={11}/>{user.tier_name}</Badge><span className="plan-price">{user.tier === "core" ? "Free" : user.tier === "cognitive" ? "$2.50" : "$4.00"}<small>{user.tier === "core" ? "up to 500 students" : "per student / year"}</small></span></div><div className="feature-pills">{Object.entries(user.features).filter(([, enabled]) => enabled).slice(0, 5).map(([name]) => <span key={name}><Check size={11}/>{formatFeature(name)}</span>)}</div><button className="panel-bottom-link" onClick={() => onView(user.role === "chancellor_dean" ? "billing" : "dashboard")}>See plan details <ArrowRight size={12}/></button></div></Panel></div>
    <div className="quick-actions">{[
      { id: "grading", icon: BarChart3, label: "Open grading sandbox", description: "Model a fair mark distribution" },
      { id: "facilities", icon: Wrench, label: "Report a campus issue", description: "Keep labs and spaces running" },
      { id: "accreditation", icon: FileBadge2, label: "Review course outcomes", description: "Prepare OBE evidence" },
    ].filter((item) => item.id !== "grading" || ["chancellor_dean", "professor_hod"].includes(user.role)).map((item) => { const Icon = item.icon; return <button key={item.id} onClick={() => onView(item.id)}><i><Icon size={16}/></i><span><strong>{item.label}</strong><small>{item.description}</small></span><ArrowRight size={14}/></button>; })}</div>
  </div>;
}
function Pulse({ icon, tone, title, description, time }: { icon: ReactNode; tone: string; title: string; description: string; time: string }) { return <div className="pulse-item"><i className={`pulse-icon ${tone}`}>{icon}</i><span><strong>{title}</strong><small>{description}</small></span><time>{time}</time></div>; }
function formatFeature(value: string) { return value.replaceAll("_", " ").replace(/\b\w/g, (x) => x.toUpperCase()); }
async function downloadProtected(path: string, run: (path: string, init?: RequestInit) => Promise<any>, filename: string) {
  const response = await run(path) as Response;
  const url = URL.createObjectURL(await response.blob());
  const link = document.createElement("a"); link.href = url; link.download = filename; link.click(); URL.revokeObjectURL(url);
}

function StudyPlannerView({ plan, run, refresh, onNotify }: { plan: AnyRow[]; run: (path: string, init?: RequestInit) => Promise<any>; refresh: () => void; onNotify: (text: string, kind?: Notice["kind"]) => void }) {
  const [hours, setHours] = useState(1);
  const [busy, setBusy] = useState(false);
  const generate = async () => {
    setBusy(true);
    try { const result = await run("/study-plan/generate", { method: "POST", body: JSON.stringify({ available_hours_per_day: hours, days: 7 }) }); refresh(); onNotify(`Created ${result.generated} focused study sessions.`, "success"); }
    catch (error: any) { onNotify(error.message, "error"); } finally { setBusy(false); }
  };
  const toggle = async (id: string) => { try { await run(`/study-plan/${id}/complete`, { method: "PATCH" }); refresh(); } catch (error: any) { onNotify(error.message, "error"); } };
  const days = [...new Set(plan.map((item) => item.date))];
  return <div className="view-stack"><div className="module-intro"><div><CalendarDays size={18}/><span><strong>Build a realistic week</strong><small>Low-mastery concepts are scheduled first, in short sessions.</small></span></div><label className="planner-hours">Hours / day <select value={hours} onChange={(event) => setHours(Number(event.target.value))}><option value={0.5}>0.5</option><option value={1}>1</option><option value={1.5}>1.5</option><option value={2}>2</option></select></label><button className="button-primary" disabled={busy} onClick={() => void generate()}>{busy ? "Building…" : "Generate 7-day plan"}<ArrowRight size={14}/></button></div><InfoCallout title="Transparent planning logic" text="This demo prioritises concepts with lower Bayesian Knowledge Tracing mastery. It does not use a trained AI planner or verified exam timetable."/><Panel title="Weekly study plan" subtitle={`${plan.filter((item) => item.completed).length} of ${plan.length} sessions completed`}>{plan.length ? <div className="plan-week">{days.map((day) => <section key={day}><h3>{new Date(`${day}T12:00:00`).toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "short" })}</h3>{plan.filter((item) => item.date === day).map((item) => <label className={`plan-task ${item.completed ? "task-complete" : ""}`} key={item.id}><input type="checkbox" checked={item.completed} onChange={() => void toggle(item.id)}/><span><strong>{item.course_code} · {item.concept_code}</strong><small>{item.activity}</small></span><em><Clock3 size={12}/>{item.duration_minutes} min</em></label>)}</section>)}</div> : <Empty>Generate a plan to turn your course mastery signals into manageable study sessions.</Empty>}</Panel></div>;
}

function MicroDrillsView({ drills, onNotify }: { drills: AnyRow[]; onNotify: (text: string, kind?: Notice["kind"]) => void }) {
  const [index, setIndex] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const drill = drills[index];
  if (!drill) return <Panel title="Revision queue"><Empty>No concept checks are available yet.</Empty></Panel>;
  return <div className="view-stack"><div className="mini-stat-grid"><MiniStat icon={<Brain size={15}/>} label="Concepts queued" value={drills.length}/><MiniStat icon={<Target size={15}/>} label="Review priority" value={drill.concept_code} tone="amber"/><MiniStat icon={<Clock3 size={15}/>} label="Next session" value="5 minutes" tone="green"/><MiniStat icon={<Activity size={15}/>} label="Scheduling" value="Demo queue" tone="blue"/></div><Panel title={`${drill.course_code} · ${drill.concept_code}`} subtitle={`${drill.course_title} · ${drill.difficulty} practice`}><div className="drill-card"><Badge tone="amber">Mastery {Math.round(drill.mastery * 100)}%</Badge><h2>{drill.prompt}</h2><p>Try answering from memory first. Then compare your explanation with the course material.</p>{revealed && <InfoCallout title="Self-check" text="Can you define the concept, explain why it works, and solve one example without notes? Use your syllabus or lecture notes to verify details."/>}<div className="drill-actions"><button className="button-secondary" onClick={() => setRevealed((value) => !value)}>{revealed ? "Hide self-check" : "Reveal self-check"}</button><button className="button-primary" onClick={() => { if (index + 1 < drills.length) { setIndex(index + 1); setRevealed(false); } else onNotify("You reached the end of this demo revision queue.", "success"); }}>Next concept <ArrowRight size={14}/></button></div><small className="muted-note">{drill.schedule_basis}</small></div></Panel></div>;
}

function StudentsView({ students, warnings, onRisk }: { students: AnyRow[]; warnings: AnyRow[]; onRisk: (id: string) => void }) {
  const [query, setQuery] = useState("");
  const warningById = useMemo(() => new Map(warnings.map((warning) => [warning.student_id, warning])), [warnings]);
  const filtered = students.filter((student) => `${student.full_name} ${student.department} ${student.email}`.toLowerCase().includes(query.toLowerCase()));
  return <div className="view-stack"><div className="mini-stat-grid"><MiniStat icon={<Users size={15}/>} label="Students tracked" value={students.length}/><MiniStat icon={<MessageSquareWarning size={15}/>} label="Need a check-in" value={warnings.length} tone="amber"/><MiniStat icon={<CalendarDays size={15}/>} label="Attendance threshold" value="75%" tone="blue"/><MiniStat icon={<ShieldCheck size={15}/>} label="Signals are advisory" value="Human-led" tone="green"/></div>
    <Panel title="Student roster" subtitle="Students are visible only within your campus tenant." action={<div className="search-control"><Search size={14}/><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search name, email, programme"/></div>}>
      {filtered.length ? <div className="simple-table roster-table"><div className="table-head"><span>STUDENT</span><span>PROGRAMME</span><span>CGPA</span><span>ACADEMIC SIGNAL</span><span/></div>{filtered.map((student) => { const warning = warningById.get(student.id); return <div className="table-row" key={student.id}><span className="student-name-cell"><i className="mini-avatar">{initials(student.full_name)}</i><b>{student.full_name}<small>{student.email}</small></b></span><span>{student.department} · Sem {student.semester}</span><span>{student.cgpa.toFixed(1)}</span><span>{warning ? <Badge tone="amber">Attendance {warning.current_percentage}%</Badge> : <Badge tone="green">On track</Badge>}</span><button className="icon-inline" title="View student risk signals" onClick={() => onRisk(student.id)}><ArrowRight size={14}/></button></div>; })}</div> : <Empty>No students match that search.</Empty>}
    </Panel><InfoCallout title="Signals are there to guide support." text="Attendance and mastery patterns can prompt an early check-in. They should not be used alone to make academic, disciplinary or recruitment decisions."/></div>;
}

function GradingView({ courses, selectedCourse, setSelectedCourse, result, meanShift, setMeanShift, stdScale, setStdScale, busy, onRun, onUpload, onExport, onNotify }: {
  courses: Course[]; selectedCourse: string; setSelectedCourse: (value: string) => void; result: AnyRow | null;
  meanShift: number; setMeanShift: (value: number) => void; stdScale: number; setStdScale: (value: number) => void;
  busy: boolean; onRun: (save?: boolean) => void; onUpload: (file?: File) => void; onExport: () => void; onNotify: (text: string, kind?: Notice["kind"]) => void;
}) {
  const maxCount = Math.max(1, ...(result?.grade_distribution || []).map((item: AnyRow) => item.count));
  const distribution = result?.grade_distribution || [];
  return <div className="view-stack"><div className="module-grid grading-module-grid"><Panel title="Assessment setup" subtitle="Import marks and tune the cohort curve.">
    <label className="field-label">Course</label><select className="field-control" value={selectedCourse} onChange={(event) => setSelectedCourse(event.target.value)}><option value="">Choose a course</option>{courses.map((course) => <option key={course.id} value={course.id}>{course.code} · {course.title}</option>)}</select>
    <label className="field-label">Question-level CSV</label><label className="upload-drop"><input type="file" accept=".csv,text/csv" onChange={(event) => onUpload(event.target.files?.[0])}/><ArrowDownToLine size={18}/><strong>Choose marks CSV</strong><small>Required columns: student_id, Q1, Q2…</small></label>
    <button className="quiet-link" onClick={() => { const csv = "student_id,Q1,Q2,Q3\nNITX-student-001,8,7,9\n"; const link = document.createElement("a"); link.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" })); link.download = "campus-nexus-marks-template.csv"; link.click(); URL.revokeObjectURL(link.href); }}>Download CSV template <ArrowDownToLine size={12}/></button>
    <div className="slider-label"><label className="field-label">Mean adjustment</label><strong>{meanShift > 0 ? "+" : ""}{meanShift} pts</strong></div><input className="range-control" type="range" min="-10" max="10" value={meanShift} onChange={(event) => setMeanShift(Number(event.target.value))}/><div className="range-caption"><span>More conservative</span><span>More generous</span></div>
    <div className="slider-label"><label className="field-label">Spread adjustment</label><strong>{stdScale.toFixed(2)}×</strong></div><input className="range-control" type="range" min="0.5" max="1.8" step="0.05" value={stdScale} onChange={(event) => setStdScale(Number(event.target.value))}/><div className="range-caption"><span>Tighter curve</span><span>Wider curve</span></div>
    <div className="form-button-row"><button className="button-primary" disabled={busy || !selectedCourse} onClick={() => onRun(false)}>{busy ? "Calculating…" : "Recalculate curve"}<ArrowRight size={14}/></button><button className="button-secondary" disabled={!result} onClick={() => onRun(true)}>Save grades</button></div>
  </Panel><div className="view-stack"><Panel title="Grade distribution" subtitle={result ? `${result.course_code} · ${result.count} assessed students` : "Run the sandbox to model current marks."} action={<button className="small-action" disabled={!result} onClick={onExport}>Export CSV <ArrowDownToLine size={13}/></button>}>
    {result ? <><div className="result-kpis"><Kpi label="Raw average" value={result.raw_mean}/><Kpi label="Adjusted mean" value={result.adjusted_mean}/><Kpi label="Std. deviation" value={result.adjusted_std}/></div><div className="chart-box"><ResponsiveContainer width="100%" height={210}><LineChart data={result.curve} margin={{ top: 10, right: 8, left: -20, bottom: 0 }}><CartesianGrid strokeDasharray="3 4" stroke="#e9eee8"/><XAxis dataKey="x" tick={{ fontSize: 9, fill: "#8b968c" }} tickLine={false} axisLine={false}/><YAxis tick={{ fontSize: 9, fill: "#8b968c" }} tickLine={false} axisLine={false}/><Tooltip contentStyle={{ fontSize: 10, borderRadius: 8, borderColor: "#e8ece7" }}/><Legend wrapperStyle={{ fontSize: 9 }}/><Line name="Gaussian" dataKey="gaussian" type="monotone" stroke="#4d865d" dot={false} strokeWidth={2}/><Line name="KDE" dataKey="kde" type="monotone" stroke="#d59b56" dot={false} strokeWidth={2} strokeDasharray="5 4"/></LineChart></ResponsiveContainer></div><div className="grade-dist-grid">{distribution.map((row: AnyRow) => <div className="grade-dist" key={row.grade}><div><strong>{row.grade}</strong><small>{row.count}</small></div><i><b style={{ height: `${Math.max(5, row.count / maxCount * 100)}%` }}/></i></div>)}</div></> : <Empty>Select a course and calculate its distribution to view the Gaussian and KDE curves.</Empty>}
  </Panel>{result && <Panel title="Question quality audit" subtitle="Item discrimination and difficulty are statistical review signals.">{result.irt_audit?.length ? <div className="audit-list">{result.irt_audit.map((item: AnyRow) => <div className="audit-row" key={item.q_code}><span className="question-code">{item.q_code}</span><span className="audit-concept">{item.concept_code}<small>difficulty p={item.difficulty_p} · discrimination {item.discrimination}</small></span>{item.flagged ? <Badge tone="amber">Review item</Badge> : <Badge tone="green">Looks healthy</Badge>}</div>)}</div> : <Empty>No question-level data is available yet.</Empty>}<small className="muted-footnote">This simple item analysis is not a validated psychometric IRT calibration.</small></Panel>}</div></div></div>;
}

function LearningView({ knowledge, courses, onAttempt }: { knowledge: AnyRow[]; courses: Course[]; onAttempt: (courseId: string, conceptCode: string) => void }) {
  const [selected, setSelected] = useState<AnyRow | null>(null);
  const radarData = knowledge.slice(0, 8).map((item) => ({ concept: item.concept_code, mastery: Math.round(item.mastery * 100), full: 100 }));
  const weak = knowledge.slice().sort((a, b) => a.mastery - b.mastery).slice(0, 8);
  return <div className="view-stack"><div className="learning-intro"><div><Badge tone="lime"><Sparkles size={11}/> YOUR CONCEPT MAP</Badge><h2>Small steps add up.</h2><p>Your mastery estimate updates as you work through practice checks.</p></div><div className="learning-score"><strong>{knowledge.length ? Math.round(knowledge.reduce((sum, item) => sum + item.mastery, 0) / knowledge.length * 100) : 0}%</strong><small>estimated mastery</small></div></div><div className="module-grid"><Panel title="Knowledge radar" subtitle="BKT estimate by mapped concept">{radarData.length ? <div className="radar-box"><ResponsiveContainer width="100%" height={280}><RadarChart data={radarData}><PolarGrid stroke="#e8eee7"/><PolarAngleAxis dataKey="concept" tick={{ fontSize: 10, fill: "#68756a" }}/><PolarRadiusAxis domain={[0, 100]} tick={{ fontSize: 8, fill: "#a4ada5" }} axisLine={false}/><Radar dataKey="mastery" stroke="#4d8058" fill="#93bb7c" fillOpacity={0.4}/></RadarChart></ResponsiveContainer></div> : <Empty>Knowledge signals will appear after course assessments.</Empty>}</Panel><Panel title="Concepts to practise" subtitle="Select a concept to inspect its mapped prerequisites.">{knowledge.length ? <div className="concept-list">{weak.map((item) => <div className="concept-row" key={`${item.course_id}-${item.concept_code}`}><span className="concept-index">{item.concept_code}</span><span className="concept-copy"><strong>{courses.find((c) => c.id === item.course_id)?.title || item.course_code}</strong><small>{item.attempts} attempts · {item.correct_count} correct</small><i><b style={{ width: `${item.mastery * 100}%` }}/></i></span><strong className="concept-percent">{Math.round(item.mastery * 100)}%</strong><button className="practice-button" title="Explore prerequisite map" onClick={() => setSelected(item)}><Network size={13}/></button><button className="practice-button" title="Record a practice check" onClick={() => onAttempt(item.course_id, item.concept_code)}><ArrowRight size={13}/></button></div>)}</div> : <Empty>There are no mapped concepts yet.</Empty>}</Panel></div>{selected && <Panel title={`Prerequisite path · ${selected.concept_code}`} subtitle={courses.find((course) => course.id === selected.course_id)?.title || selected.course_code}><div className="prereq-map">{(selected.prerequisites || []).length ? <>{selected.prerequisites.map((code: string) => { const node = knowledge.find((row) => row.course_id === selected.course_id && row.concept_code === code); return <div className="prereq-node" key={code}><span>{code}</span><small>{node ? `${Math.round(node.mastery * 100)}% mastery` : "Mapped prerequisite"}</small><ArrowRight size={15}/></div>; })}<div className="prereq-node prereq-current"><span>{selected.concept_code}</span><small>Selected concept · {Math.round(selected.mastery * 100)}% mastery</small></div></> : <div className="prereq-node prereq-current"><span>{selected.concept_code}</span><small>No prerequisite is mapped for this concept.</small></div>}</div></Panel>}<InfoCallout title="A learning estimate is not a label." text="Knowledge estimates are built from practice history. Use them to choose what to revisit, not as a measure of a student's potential."/></div>;
}

function AttendanceView({ data, student }: { data: AnyRow[]; student: boolean }) {
  const average = data.length ? Math.round(data.reduce((sum, item) => sum + item.current_percentage, 0) / data.length) : 0;
  return <div className="view-stack"><div className="mini-stat-grid"><MiniStat icon={<CalendarDays size={15}/>} label={student ? "Average attendance" : "Signals below 75%"} value={student ? `${average}%` : data.length} tone={average < 75 && student ? "amber" : "green"}/><MiniStat icon={<Target size={15}/>} label="Eligibility threshold" value="75%" tone="blue"/><MiniStat icon={<Activity size={15}/>} label={student ? "Courses tracked" : "Students flagged"} value={student ? data.length : new Set(data.map((item) => item.student_id)).size}/><MiniStat icon={<ShieldCheck size={15}/>} label="Forecast horizon" value="This term" tone="violet"/></div><Panel title={student ? "Your attendance by course" : "Early-warning queue"} subtitle={student ? "See how many upcoming classes you need to attend or can skip." : "Students whose current attendance is below the eligibility threshold."}>{data.length ? <div className="attendance-list">{data.map((item, index) => <div className="attendance-card" key={`${item.course_id}-${item.student_id || index}`}><div className="attendance-course"><span className={`course-mark mark-${index % 4}`}>{student ? item.course_code?.slice(0, 2) : initials(item.student_name)}</span><span><strong>{student ? item.course_title : item.student_name}</strong><small>{student ? item.course_code : `${item.course_code} · ${item.department}`}</small></span></div><div className="attendance-meter"><div><span>Current attendance</span><strong className={item.current_percentage < 75 ? "text-red" : ""}>{item.current_percentage}%</strong></div><i><b style={{ width: `${Math.min(100, item.current_percentage)}%`, background: item.current_percentage < 75 ? "#cf886b" : undefined }}/><em style={{ left: "75%" }}/></i><small>75% eligibility guide</small></div><div className="attendance-forecast"><span>{item.at_risk ? "Plan needed" : "On track"}</span><strong>{item.classes_to_attend} classes to attend</strong><small>{item.classes_can_skip} safe skips remaining · {item.remaining_classes} classes left</small></div></div>)}</div> : <Empty>{student ? "Your attendance records are not available yet." : "No students are below the current attendance threshold."}</Empty>}</Panel><InfoCallout title="Forecasts are based on recorded classes." text="Class schedules and attendance records may change. Confirm with your department before making an eligibility decision."/></div>;
}

function AccreditationView({ outcomes, onExport }: { outcomes: AnyRow[]; onExport: () => void }) {
  const flatOutcomes = outcomes.flatMap((course) => (course.course_outcomes || []).map((outcome: AnyRow) => ({ ...outcome, course_code: course.course_code, course_title: course.course_title, students_assessed: course.students_assessed })));
  const avg = flatOutcomes.length ? Math.round(flatOutcomes.reduce((sum, item) => sum + item.attainment, 0) / flatOutcomes.length) : 0;
  return <div className="view-stack"><div className="accreditation-banner"><div><Badge tone="lime">TERM 1 · 2025–26</Badge><h2>Build a clear evidence trail.</h2><p>Outcome attainment is calculated from question-level sample marks mapped to COs and POs.</p><div className="banner-progress"><b style={{ width: `${avg}%` }}/></div><small>{avg}% average CO attainment across {outcomes.length} courses</small></div><div className="banner-art"><FileBadge2 size={52}/><Sparkles size={17}/></div></div><div className="mini-stat-grid"><MiniStat icon={<BookOpenCheck size={15}/>} label="Courses assessed" value={outcomes.length}/><MiniStat icon={<Target size={15}/>} label="CO evidence points" value={flatOutcomes.length} tone="blue"/><MiniStat icon={<BadgeCheck size={15}/>} label="Average attainment" value={`${avg}%`} tone="green"/><MiniStat icon={<Users size={15}/>} label="Question mapped" value="Q-level" tone="violet"/></div><Panel title="Course outcome matrix" subtitle="Attainment is the average marks percentage per mapped question and outcome." action={<button className="button-secondary" onClick={onExport}><ArrowDownToLine size={13}/> Download SAR CSV</button>}>{flatOutcomes.length ? <div className="simple-table outcome-table"><div className="table-head"><span>COURSE</span><span>OUTCOME</span><span>ATTAINMENT</span><span>EVIDENCE QUESTIONS</span><span>STATUS</span></div>{flatOutcomes.map((item, index) => <div className="table-row" key={`${item.course_code}-${item.code}-${index}`}><span><strong>{item.course_code}</strong><small>{item.course_title}</small></span><span><Badge>CO{item.code.replace("CO", "")}</Badge></span><span><b>{item.attainment}%</b><i className="outcome-meter"><b style={{ width: `${item.attainment}%` }}/></i></span><span>{item.evidence_questions} mapped</span><span><Badge tone={item.attainment >= 70 ? "green" : "amber"}>{item.attainment >= 70 ? "On track" : "Review"}</Badge></span></div>)}</div> : <Empty>No outcome evidence is available yet. Import question-level marks first.</Empty>}</Panel><InfoCallout title="This is an evidence aid, not an official NBA/NAAC score." text="Confirm mapping rules, thresholds and evidence requirements with your institution's accreditation coordinator."/></div>;
}

function FacilitiesView({ tickets, user, run, refresh, onNotify }: { tickets: AnyRow[]; user: CampusUser; run: (path: string, init?: RequestInit) => Promise<any>; refresh: () => void; onNotify: (text: string, kind?: Notice["kind"]) => void }) {
  const [showForm, setShowForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [filter, setFilter] = useState("All");
  const visible = filter === "All" ? tickets : tickets.filter((ticket) => ticket.status === filter);
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); setSubmitting(true);
    const form = event.currentTarget; const data = new FormData(form);
    try { const result = await run("/facilities/tickets", { method: "POST", body: data }); onNotify(result.potential_duplicate_id ? `Issue reported. Similarity suggests ticket ${result.potential_duplicate_id}; technician review is required before merging.` : `Issue reported. ${result.category} triage · 48-hour SLA started.`, "success"); form.reset(); setShowForm(false); refresh(); }
    catch (error: any) { onNotify(error.message, "error"); }
    finally { setSubmitting(false); }
  };
  const changeStatus = async (ticketId: string, status: string) => {
    const body = new FormData(); body.set("status", status);
    try { await run(`/facilities/tickets/${encodeURIComponent(ticketId)}`, { method: "PATCH", body }); onNotify("Ticket status updated.", "success"); refresh(); }
    catch (error: any) { onNotify(error.message, "error"); }
  };
  const confirmMerge = async (ticketId: string, candidateId: string) => {
    if (!window.confirm(`Confirm that ${ticketId} is a duplicate of ${candidateId}?`)) return;
    try { await run(`/facilities/tickets/${encodeURIComponent(ticketId)}/merge`, { method: "POST", body: JSON.stringify({ candidate_id: candidateId }) }); onNotify("Duplicate confirmed and linked in the audit trail.", "success"); refresh(); }
    catch (error: any) { onNotify(error.message, "error"); }
  };
  const canManage = ["technician_warden", "chancellor_dean"].includes(user.role);
  return <div className="view-stack"><div className="mini-stat-grid"><MiniStat icon={<Wrench size={15}/>} label="Open tickets" value={tickets.filter((t) => t.status === "Open").length} tone="amber"/><MiniStat icon={<Activity size={15}/>} label="In progress" value={tickets.filter((t) => t.status === "In progress").length} tone="blue"/><MiniStat icon={<Check size={15}/>} label="Resolved" value={tickets.filter((t) => t.status === "Resolved").length} tone="green"/><MiniStat icon={<Target size={15}/>} label="Response SLA" value="48 hours"/></div>
    <Panel title="Facilities service desk" subtitle="Track issues, triage and repair status across campus." action={<div className="panel-actions"><select className="small-select" value={filter} onChange={(event) => setFilter(event.target.value)}><option>All</option><option>Open</option><option>In progress</option><option>Resolved</option></select><button className="button-primary" onClick={() => setShowForm((value) => !value)}><Plus size={14}/> Report issue</button></div>}>
      {showForm && <form className="issue-form" onSubmit={submit}><div className="form-grid"><label className="field-label">Short description<input className="field-control" name="title" placeholder="e.g. Oscilloscope screen not powering on" required maxLength={200}/></label><label className="field-label">Location<input className="field-control" name="location" placeholder="Building, room or lab" defaultValue="" required/></label><label className="field-label">Priority<select className="field-control" name="priority"><option>Medium</option><option>High</option><option>Urgent</option><option>Low</option></select></label><label className="field-label">Photo <small>{user.features.vision_triage ? "Enterprise vision triage · max 5 MB" : "Text reports available on your plan"}</small><input className="field-control file-field" name="photo" type="file" accept="image/jpeg,image/png,image/webp" disabled={!user.features.vision_triage}/></label></div><label className="field-label">Details<textarea className="field-control" name="description" rows={2} placeholder="Add useful context for the facilities team."/></label><div className="form-button-row"><button type="button" className="button-secondary" onClick={() => setShowForm(false)}>Cancel</button><button className="button-primary" disabled={submitting}>{submitting ? "Submitting…" : "Submit issue"}<ArrowRight size={13}/></button></div></form>}
      {visible.length ? <div className="ticket-list">{visible.map((ticket) => <article className="ticket-card" key={ticket.id}><div className={`ticket-symbol ${ticket.priority === "High" || ticket.priority === "Urgent" ? "ticket-urgent" : ""}`}><Wrench size={17}/></div><div className="ticket-info"><div className="ticket-title-line"><strong>{ticket.title}</strong><Badge tone={ticket.priority === "High" || ticket.priority === "Urgent" ? "red" : "amber"}>{ticket.priority}</Badge></div><p>{ticket.location} · {ticket.category} · {ticket.id}</p><div className="ticket-badges"><Badge tone={ticket.status === "Resolved" ? "green" : ticket.status === "In progress" ? "blue" : "amber"}>{ticket.status}</Badge><span>SLA due {new Date(ticket.sla_deadline).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</span>{ticket.merged_count > 1 && <span>{ticket.merged_count} reports grouped</span>}{ticket.merged_into_id && <span>Linked to {ticket.merged_into_id}</span>}</div>{ticket.potential_duplicate_id && !ticket.merged_into_id && <div className="duplicate-review"><span>Possible duplicate of {ticket.potential_duplicate_id} · {Math.round((ticket.similarity || 0) * 100)}% similarity</span>{canManage && <button className="button-secondary" onClick={() => void confirmMerge(ticket.id, ticket.potential_duplicate_id)}>Confirm merge</button>}</div>}{ticket.audit?.length > 0 && <details className="audit-details"><summary>View timestamped audit trail</summary>{ticket.audit.map((entry: AnyRow, index: number) => <small key={index}>{new Date(entry.at).toLocaleString()} · {entry.event.replaceAll("_", " ")} · {entry.note}</small>)}</details>}</div>{canManage && <select className="status-select" value={ticket.status} onChange={(event) => void changeStatus(ticket.id, event.target.value)} aria-label={`Update status for ${ticket.id}`}><option>Open</option><option>In progress</option><option>Resolved</option></select>}</article>)}</div> : <Empty>No reports in this status filter.</Empty>}
    </Panel><InfoCallout title="Triage and semantic grouping are local demo signals." text="The offline classifier uses a compact sample model plus text hints. It is not a production MobileNet/SentenceBERT model; a technician should confirm category, priority and any duplicate grouping."/></div>;
}

function PrivacyView({ user, token, reports, run, refresh, onNotify }: { user: CampusUser; token: string; reports: AnyRow[]; run: (path: string, init?: RequestInit) => Promise<any>; refresh: () => void; onNotify: (text: string, kind?: Notice["kind"]) => void }) {
  const [tracking, setTracking] = useState("");
  const [trackedReport, setTrackedReport] = useState<AnyRow | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [category, setCategory] = useState("Campus safety");
  const [message, setMessage] = useState("");
  const [reply, setReply] = useState("");
  const [savedCodes, setSavedCodes] = useState<string[]>([]);
  useEffect(() => { setSavedCodes(JSON.parse(localStorage.getItem("nexus_report_codes") || "[]")); }, []);
  const submit = async (event: FormEvent) => {
    event.preventDefault(); if (!message.trim()) return;
    setSubmitting(true);
    try {
      const payload = await makeEncryptedAnonymousPayload(message, user.college_code, token);
      const result = await request<any>("/privacy/reports", undefined, { method: "POST", body: JSON.stringify({ ...payload, category }) });
      const next = [result.tracking_code, ...savedCodes]; setSavedCodes(next); localStorage.setItem("nexus_report_codes", JSON.stringify(next));
      setTracking(result.tracking_code); setMessage(""); setTrackedReport({ ...result, thread: [] }); onNotify("Your encrypted report was received. Save its tracking code to check updates.", "success"); refresh();
    } catch (error: any) { onNotify(error.message, "error"); }
    finally { setSubmitting(false); }
  };
  const checkStatus = async (event: FormEvent) => { event.preventDefault(); try { setTrackedReport(await request(`/privacy/reports/${encodeURIComponent(tracking)}`)); } catch (error: any) { onNotify(error.message, "error"); } };
  const sendReply = async (event: FormEvent) => { event.preventDefault(); if (!reply.trim() || !tracking) return; try { const encrypted = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(reply)); const ciphertext = bytesToBase64(new Uint8Array(encrypted)); await request(`/privacy/reports/${encodeURIComponent(tracking)}/messages`, undefined, { method: "POST", body: JSON.stringify({ encrypted_body: ciphertext }) }); setReply(""); onNotify("Encrypted reply added to the anonymous thread.", "success"); await checkStatus(new Event("submit") as unknown as FormEvent); } catch (error: any) { onNotify(error.message, "error"); } };
  const isAdmin = user.role === "chancellor_dean";
  return <div className="view-stack"><div className="privacy-explainer"><div className="privacy-lock"><ShieldCheck size={25}/></div><div><strong>Eligibility is proven without attaching your account to the report.</strong><p>Your browser blinds a one-time token before campus eligibility is signed. The report body and each decryption key share are encrypted separately for the Dean and the ICC.</p></div><Badge tone="green">DUAL-CUSTODIAN DEMO</Badge></div><div className="module-grid privacy-grid"><Panel title={isAdmin ? "Anonymous reports" : "Submit a concern"} subtitle={isAdmin ? "Queue metadata only. Report ciphertext is never returned by this endpoint." : "Your report will not include your name, email or account ID."}>
    {isAdmin ? reports.length ? <div className="privacy-report-list">{reports.map((report) => <div className="privacy-report-row" key={report.tracking_code}><span className="report-glyph"><ShieldCheck size={15}/></span><span><strong>{report.category}</strong><small>Tracking {report.tracking_code.slice(0, 9)}… · {new Date(report.created_at).toLocaleDateString()}</small></span><Badge tone="blue">{report.status}</Badge></div>)}</div> : <Empty>No report metadata is in the queue.</Empty> : <form onSubmit={submit}><label className="field-label">Concern category<select className="field-control" value={category} onChange={(event) => setCategory(event.target.value)}><option>Campus safety</option><option>Harassment or discrimination</option><option>Ragging</option><option>Academic integrity</option><option>Facilities</option><option>Other</option></select></label><label className="field-label">Report details<textarea className="field-control" rows={5} value={message} onChange={(event) => setMessage(event.target.value)} placeholder="Describe what happened and what support you need. Avoid including information that identifies you." required/></label><div className="private-note"><KeyRound size={14}/><span>The report is encrypted in your browser. Keep your tracking code private; it is the key to checking status and replies.</span></div><button className="button-primary" disabled={submitting}>{submitting ? "Encrypting & submitting…" : "Submit anonymously"}<ArrowRight size={14}/></button></form>}
    </Panel><Panel title="Track a report" subtitle="Use a private tracking code to view status and continue a conversation."><form className="track-form" onSubmit={checkStatus}><input className="field-control" value={tracking} onChange={(event) => setTracking(event.target.value)} placeholder="Paste your report tracking code" required/><button className="button-secondary">Check status</button></form>{savedCodes.length > 0 && <div className="saved-codes"><small>Saved on this browser</small>{savedCodes.slice(0, 4).map((code) => <button key={code} onClick={() => setTracking(code)}>{code}<ArrowRight size={11}/></button>)}</div>}{trackedReport && <div className="tracked-card"><div><strong>Report status</strong><Badge tone="blue">{trackedReport.status}</Badge></div><small>Tracking code: {trackedReport.tracking_code}</small><small>Category: {trackedReport.category}</small><form onSubmit={sendReply}><textarea className="field-control" rows={2} placeholder="Write a follow-up reply" value={reply} onChange={(event) => setReply(event.target.value)}/><button className="button-secondary">Add encrypted reply</button></form></div>}</Panel></div><InfoCallout title="Security design is a demo, not a deployment-ready whistleblower system." text="Private signing keys are stored in the local demo database, replies need client-side encryption, and there is no independent key-custodian service or security audit. Do not use this build for real sensitive reports."/></div>;
}

function CommunityView({ user, matches, run, onNotify, refresh }: { user: CampusUser; matches: AnyRow[]; run: (path: string, init?: RequestInit) => Promise<any>; onNotify: (text: string, kind?: Notice["kind"]) => void; refresh: () => void }) {
  const [working, setWorking] = useState(false);
  const [optIn, setOptIn] = useState(user.opt_in_recruiter !== false);
  const isAdmin = ["chancellor_dean", "professor_hod"].includes(user.role);
  const generate = async () => { setWorking(true); try { const result = await run("/peer-matcher/generate", { method: "POST" }); onNotify(`${result.created} new peer matches created.`, "success"); refresh(); } catch (error: any) { onNotify(error.message, "error"); } finally { setWorking(false); } };
  const setRecruiterConsent = async () => { try { const result = await run("/recruiter/opt-in", { method: "PATCH", body: JSON.stringify({ opt_in: !optIn }) }); setOptIn(result.opt_in); onNotify(result.opt_in ? "Your profile is visible to recruiters." : "Your profile is hidden from recruiters.", "success"); } catch (error: any) { onNotify(error.message, "error"); } };
  return <div className="view-stack">{isAdmin && <div className="module-intro"><div><Network size={18}/><span><strong>Campus matching</strong><small>Pair learners with peers who have stronger mastery in a shared concept.</small></span></div><button className="button-primary" disabled={working} onClick={generate}>{working ? "Matching…" : "Generate study pairs"}<ArrowRight size={14}/></button></div>}{!isAdmin && <div className="privacy-explainer compact"><div className="privacy-lock"><HeartHandshake size={22}/></div><div><strong>Peer learning works both ways.</strong><p>You'll be matched for concepts where your practice can help a classmate, and where a classmate can help you.</p></div></div>}<Panel title="Your study matches" subtitle={isAdmin ? "Matches are generated within your campus tenant." : "Your partner's course and concept match are shown below."}>{matches.length ? <div className="match-grid">{matches.map((match, index) => <article className="match-card" key={`${match.course_id}-${match.concept_code}-${index}`}><span className="match-avatar">{initials(match.partner_name)}</span><div><Badge tone={match.role === "tutor" ? "green" : "blue"}>{match.role === "tutor" ? "You're the tutor" : "Study partner"}</Badge><strong>{match.partner_name}</strong><small>{match.concept_code} · {match.course_id}</small></div><span className="match-score">{Math.round(match.score * 100)}<small> match</small></span></article>)}</div> : <Empty>{isAdmin ? "No pairings yet. Generate matches after students complete concept checks." : "No study partner matches yet. Keep practising to improve the match signals."}</Empty>}</Panel>{!isAdmin && <Panel title="Recruiter profile privacy" subtitle="Your information is only available to recruiters if you opt in."><div className="consent-row"><span className="consent-icon"><ShieldCheck size={17}/></span><span><strong>{optIn ? "Profile is opted in" : "Profile is private"}</strong><small>{optIn ? "Recruiters see a limited skill profile and cannot contact you directly." : "Your student profile is hidden from the talent marketplace."}</small></span><button className={`toggle ${optIn ? "toggle-on" : ""}`} onClick={setRecruiterConsent} aria-label="Toggle recruiter profile consent"><i/></button></div></Panel>}</div>;
}

function OpportunitiesView({ events, user, run, onNotify }: { events: AnyRow[]; user: CampusUser; run: (path: string, init?: RequestInit) => Promise<any>; onNotify: (text: string, kind?: Notice["kind"]) => void }) {
  const joinTeam = async (eventId: string) => { try { const result = await run(`/opportunities/${encodeURIComponent(eventId)}/team`, { method: "POST" }); onNotify(`You joined this event team · ${result.team_size} member(s).`, "success"); } catch (error: any) { onNotify(error.message, "error"); } };
  return <div className="view-stack"><div className="opportunity-hero"><div><Badge tone="lime"><Sparkles size={11}/> CURATED FOR YOUR CAMPUS</Badge><h2>Make room for what’s next.</h2><p>Challenges and experiences to help you build skills beyond the classroom.</p></div><div className="opportunity-orbit"><Sparkles size={27}/><i/><i/></div></div><div className="opportunity-cards">{events.map((event, index) => <article className="opportunity-tile" key={event.id}><div className={`opportunity-cover cover-${index % 3}`}><Badge>{event.tags?.[0] || "CAMPUS PICK"}</Badge><span>{[<Sparkles key="a"/>, <Network key="b"/>, <BookOpenCheck key="c"/>][index % 3]}</span></div><div className="opportunity-tile-body"><small>{event.organizer} · {event.source}</small><h3>{event.title}</h3><div className="tag-list">{event.tags?.map((tag: string) => <Badge key={tag}>{tag}</Badge>)}</div><div className="opportunity-bottom"><span><CalendarDays size={12}/> Apply by {event.deadline}</span>{user.role === "student" ? <button className="quiet-link" onClick={() => void joinTeam(event.id)}>Find a team <ArrowRight size={12}/></button> : <span>Team finder available to students</span>}</div></div></article>)}</div>{events.length === 0 && <Empty>Campus opportunities appear here as events are added.</Empty>}<InfoCallout title="Listings are sample data." text="Please confirm event dates, eligibility and application details with the organizer before applying."/></div>;
}

function TalentView({ talent, setTalent, invites, run, onNotify, refresh }: { talent: AnyRow[]; setTalent: (rows: AnyRow[]) => void; invites: AnyRow[]; run: (path: string, init?: RequestInit) => Promise<any>; onNotify: (text: string, kind?: Notice["kind"]) => void; refresh: () => void }) {
  const [query, setQuery] = useState("");
  const [department, setDepartment] = useState("");
  const [busy, setBusy] = useState(false);
  const search = async () => { setBusy(true); try { const params = new URLSearchParams(); if (query.trim()) params.set("concept_code", query.trim()); if (department) params.set("department", department); const rows = await run(`/recruiter/talent?${params}`) as AnyRow[]; setTalent(rows); onNotify(`${rows.length} opted-in profiles found.`, "success"); } catch (error: any) { onNotify(error.message, "error"); } finally { setBusy(false); } };
  const invite = async (student: AnyRow) => { try { const result = await run("/recruiter/invites", { method: "POST", body: JSON.stringify({ student_id: student.student_id, role_title: "Software Engineering Internship", message: "We would like to invite you to learn more about an opportunity with our team.", ctc_lpa: 12 }) }); onNotify(result.message, "success"); refresh(); } catch (error: any) { onNotify(error.message, "error"); } };
  return <div className="view-stack"><div className="marketplace-intro"><div className="marketplace-icon"><Search size={21}/></div><div><strong>Skills, with student consent.</strong><p>Only opted-in students appear. Personal email and phone details are never exposed; interview invitations stay in the student portal.</p></div></div><Panel title="Find opted-in students" subtitle="Search concept codes like C1, C2 or C3 to see assessed mastery signals."><div className="talent-filters"><input className="field-control" placeholder="Concept code, e.g. C2" value={query} onChange={(event) => setQuery(event.target.value)}/><select className="field-control" value={department} onChange={(event) => setDepartment(event.target.value)}><option value="">All departments</option><option>CSE</option><option>ECE</option><option>ME</option><option>IT</option></select><button className="button-primary" onClick={search} disabled={busy}>{busy ? "Searching…" : "Search profiles"}<Search size={14}/></button></div>{talent.length ? <div className="talent-grid">{talent.map((student) => <article className="talent-card" key={student.student_id}><div className="talent-avatar">{initials(student.display_name)}</div><div><strong>{student.display_name}</strong><small>{student.department} · Semester {student.semester}</small></div><div className="talent-scores"><span><small>CGPA</small><b>{student.cgpa}</b></span><span><small>Peer karma</small><b>{student.karma_points}</b></span></div><button className="button-secondary" onClick={() => void invite(student)}>Invite</button></article>)}</div> : <Empty>Search to view anonymized, opted-in student profiles. The demo does not expose contact details.</Empty>}</Panel><Panel title="Invitations" subtitle="Students receive invitations privately in their own portal.">{invites.length ? <div className="invite-list">{invites.map((invite) => <div className="invite-row" key={invite.id}><span className="invite-icon"><MessageSquareWarning size={15}/></span><span><strong>{invite.role_title}</strong><small>{invite.message}</small></span><Badge tone="blue">{invite.status}</Badge></div>)}</div> : <Empty>No invitations have been sent from this recruiter profile.</Empty>}</Panel></div>;
}

function BillingView({ billing, user, run, onNotify, refresh }: { billing: AnyRow | null; user: CampusUser; run: (path: string, init?: RequestInit) => Promise<any>; onNotify: (text: string, kind?: Notice["kind"]) => void; refresh: () => void }) {
  const [busy, setBusy] = useState("");
  const updateTier = async (tier: string) => { setBusy(tier); try { const result = await run("/admin/tier", { method: "PATCH", body: JSON.stringify({ tier }) }); onNotify(`Plan updated. Estimated ARR: ${money(result.estimated_arr_usd)}. Sign in again to refresh role feature flags.`, "success"); refresh(); } catch (error: any) { onNotify(error.message, "error"); } finally { setBusy(""); } };
  if (!billing) return <Empty>Billing details could not be loaded.</Empty>;
  const labels: Record<string, string> = { core: "Core", cognitive: "Cognitive Campus", autonomous_enterprise: "Autonomous Enterprise" };
  const highlights: Record<string, string[]> = { core: ["Grading sandbox", "Attendance forecast", "Peer study matcher"], cognitive: ["Everything in Core", "BKT learning diagnostics", "NBA / OBE evidence", "Recruiter marketplace"], autonomous_enterprise: ["Everything in Cognitive", "Blind-token grievance workflow", "Photo triage", "99.9% SLA concept"] };
  return <div className="view-stack"><div className="billing-summary"><div><span>ESTIMATED ANNUAL RECURRING REVENUE</span><strong>{money(billing.estimated_arr_usd)}</strong><small>{billing.billable_students.toLocaleString()} billable students × {billing.price_per_student_yr ? `$${billing.price_per_student_yr}` : "$0"} per year</small></div><div className="billing-mark"><Building2 size={28}/></div></div><div className="pricing-grid">{billing.available_tiers.map((tier: AnyRow) => <article className={`pricing-card ${billing.current_tier === tier.key ? "pricing-current" : ""}`} key={tier.key}>{billing.current_tier === tier.key && <Badge tone="green">CURRENT PLAN</Badge>}<h3>{labels[tier.key]}</h3><p>{tier.key === "core" ? "A simple entry point for smaller campuses." : tier.key === "cognitive" ? "Learning insights and outcome evidence." : "Advanced governance and facilities tools."}</p><strong className="price-line">{tier.price_per_student_yr ? `$${tier.price_per_student_yr.toFixed(2)}` : "Free"}<small>{tier.price_per_student_yr ? "/ student / year" : `Up to ${tier.max_students} students`}</small></strong><div className="pricing-arr">Estimated ARR <strong>{money(tier.estimated_arr_usd)}</strong></div><div className="pricing-features">{highlights[tier.key].map((item) => <span key={item}><Check size={13}/>{item}</span>)}</div><button className={billing.current_tier === tier.key ? "button-secondary" : "button-primary"} disabled={user.role !== "chancellor_dean" || busy === tier.key || billing.current_tier === tier.key} onClick={() => void updateTier(tier.key)}>{user.role !== "chancellor_dean" ? "Admin approval required" : busy === tier.key ? "Updating…" : billing.current_tier === tier.key ? "Current plan" : "Select plan"}</button></article>)}</div><InfoCallout title="Pricing is an estimate, not an invoice." text="Annual amounts use the configured per-student rate and campus count. Taxes, discounts, contracts and marketplace revenue are not included."/></div>;
}

function MiniStat({ icon, label, value, tone = "green" }: { icon: ReactNode; label: string; value: ReactNode; tone?: string }) { return <div className="mini-stat"><i className={`mini-stat-icon ${tone}`}>{icon}</i><span><small>{label}</small><strong>{value}</strong></span></div>; }
function Kpi({ label, value }: { label: string; value: ReactNode }) { return <div className="result-kpi"><small>{label}</small><strong>{value}</strong></div>; }
function InfoCallout({ title, text }: { title: string; text: string }) { return <div className="info-callout"><Sparkles size={15}/><span><strong>{title}</strong><small>{text}</small></span></div>; }
