import React,{useEffect,useMemo,useState} from 'react';
import {NavLink,useLocation,useNavigate} from 'react-router-dom';
import {Activity,LayoutDashboard,Users,CalendarDays,CalendarPlus,ClipboardList,FlaskConical,ReceiptText,FileText,Settings,ShieldCheck,Stethoscope,Pill,MessageSquare,Inbox,BarChart3,History,UserRoundCog,House,Clock3,NotebookPen,LogOut,Search,Bell,Sun,Moon,Languages,ChevronDown,Menu,X,PanelRightClose,Wallet,BriefcaseMedical,Archive,HeartPulse,FilePlus2,UserPlus,CalendarCheck2} from 'lucide-react';
import {api} from '../services/api.js';
import {useAuth} from '../app/AuthContext.jsx';
import {useToast,Badge} from './UI.jsx';

const menus={
 admin:[['لوحة التحكم','/admin',LayoutDashboard],['الحسابات','/admin/accounts',Users],['الأطباء','/admin/doctors',Stethoscope],['المرضى','/admin/patients',Users],['المواعيد','/admin/appointments',CalendarDays],['الخدمات الطبية','/admin/services',BriefcaseMedical],['التحاليل','/admin/lab-tests',FlaskConical],['الأدوية','/admin/medications',Pill],['الفواتير','/admin/invoices',ReceiptText],['التقارير','/admin/reports',BarChart3],['سجل النشاط','/admin/audit',History],['الإعدادات','/admin/settings',Settings]],
 doctor:[['لوحة التحكم','/doctor',LayoutDashboard],['الطابور','/doctor/queue',ClipboardList],['الجدول','/doctor/schedule',CalendarDays],['المرضى','/doctor/patients',Users],['صندوق الوارد','/doctor/inbox',Inbox],['التحاليل','/doctor/labs',FlaskConical],['الروشتات','/doctor/prescriptions',FileText],['الأدوية','/doctor/medications',Pill],['النوتة','/doctor/notes',NotebookPen],['التقارير','/doctor/reports',BarChart3],['الإعدادات','/doctor/settings',Settings]],
 receptionist:[['الرئيسية','/reception',House],['المرضى','/reception/patients',Users],['المواعيد','/reception/appointments',CalendarDays],['قائمة الانتظار','/reception/queue',ClipboardList],['الأطباء','/reception/doctors',Stethoscope],['التحاليل','/reception/labs',FlaskConical],['الروشتات','/reception/prescriptions',FileText],['الفواتير','/reception/invoices',ReceiptText],['الإعدادات','/reception/settings',Settings]],
 patient:[['الرئيسية','/portal',House],['مواعيدي','/portal/appointments',CalendarDays],['حجز كشف','/portal/book',CalendarPlus],['الطابور','/portal/queue',Clock3],['الروشتات','/portal/prescriptions',FileText],['التحاليل والملفات','/portal/labs',FlaskConical],['الملف الطبي','/portal/medical-file',HeartPulse],['الرسائل','/portal/support',MessageSquare],['الإشعارات','/portal/notifications',Bell],['الإعدادات','/portal/settings',Settings]]
};
const roles={admin:'مسؤول النظام',doctor:'طبيب',receptionist:'موظف الاستقبال',patient:'مريض'};
const HomeIcon=Activity;

export default function Layout({children}){
 const {user,logout}=useAuth();const location=useLocation();const navigate=useNavigate();const toast=useToast();const [sidebarOpen,setSidebarOpen]=useState(false);const [menuOpen,setMenuOpen]=useState(false);const [search,setSearch]=useState('');const [results,setResults]=useState(null);const [notifs,setNotifs]=useState([]);const [notifOpen,setNotifOpen]=useState(false);const [theme,setTheme]=useState(user?.theme||'light');const [language,setLanguage]=useState(localStorage.getItem('clinico-language')||'ar');
 const base=user?.role==='patient'?'/portal':`/${user?.role==='receptionist'?'reception':user?.role||'admin'}`;const nav=menus[user?.role]||menus.admin;
 useEffect(()=>{document.documentElement.dir=language==='ar'?'rtl':'ltr';document.documentElement.lang=language;document.documentElement.dataset.theme=theme;},[language,theme]);
 useEffect(()=>{setSidebarOpen(false);setResults(null);setSearch('');},[location.pathname]);
 useEffect(()=>{if(search.trim().length<2){setResults(null);return;}const timer=setTimeout(()=>api(`/search?q=${encodeURIComponent(search.trim())}`).then(r=>setResults(r.data)).catch(()=>setResults(null)),250);return()=>clearTimeout(timer);},[search]);
 useEffect(()=>{if(!notifOpen)return;api('/notifications').then(r=>setNotifs(r.data||[])).catch(()=>{});},[notifOpen]);
 const title=useMemo(()=>nav.find((item)=>location.pathname===item[1]||location.pathname.startsWith(item[1]+'/'))?.[0]||'Clinico Systems',[nav,location.pathname]);
 const selectResult=(kind,item)=>{setResults(null);setSearch('');setMenuOpen(false);const destination=kind==='patients'?`${base}/patients/${item.id}`:kind==='labs'?`${user.role==='patient'?'/portal/labs':base+'/labs'}`:kind==='prescriptions'?`${user.role==='patient'?'/portal/prescriptions':base+'/prescriptions'}`:`${base}/invoices`;navigate(destination);};
 const markRead=async(id)=>{try{await api(`/notifications/${id}/read`,{method:'POST'});setNotifs(a=>a.map(n=>n.id===id?{...n,read:true}:n));}catch(e){toast(e.message,'error');}};
 const unread=notifs.filter(n=>!n.read_at).length;
 return <div className={`app-shell ${sidebarOpen?'sidebar-open':''}`}>
   {sidebarOpen&&<button className="mobile-scrim" aria-label="إغلاق القائمة" onClick={()=>setSidebarOpen(false)}/>}
   <aside className="sidebar">
    <div className="brand-row"><img src="/assets/images/clinico-logo.svg" alt="Clinico Systems"/><button className="mobile-close icon-btn" onClick={()=>setSidebarOpen(false)}><X size={18}/></button></div>
    <div className="clinic-label"><span className="clinic-avatar"><Stethoscope size={18}/></span><div><strong>{user?.fullName}</strong><small>{roles[user?.role]||'حساب العيادة'}</small></div></div>
    <nav className="side-nav" aria-label="القائمة الرئيسية">{nav.map(([label,to,Icon])=><NavLink key={to} to={to} end={to===base} className={({isActive})=>`side-link ${isActive?'active':''}`}><Icon size={19}/><span>{label}</span></NavLink>)}</nav>
    <div className="sidebar-bottom"><div className="privacy-note"><ShieldCheck size={18}/><span>بياناتك الطبية محمية</span></div><button className="side-link logout-link" onClick={logout}><LogOut size={18}/><span>تسجيل الخروج</span></button><small className="version-note">Clinico Systems · v1.0</small></div>
   </aside>
   <div className="app-main">
    <header className="topbar">
      <div className="topbar-start"><button className="mobile-menu icon-btn" onClick={()=>setSidebarOpen(true)} aria-label="فتح القائمة"><Menu size={20}/></button><div className="breadcrumb-current"><span className="breadcrumb-dot"/><span>{title}</span></div></div>
      <div className="topbar-actions">
       <div className="global-search"><Search size={17}/><input placeholder="ابحث عن مريض، تحليل، فاتورة..." value={search} onChange={e=>setSearch(e.target.value)} onKeyDown={e=>e.key==='Escape'&&setSearch('')}/>{results&&<button className="clear-search" onClick={()=>{setSearch('');setResults(null)}}><X size={15}/></button>}
        {results&&<div className="search-popover">{Object.entries({patients:'المرضى',labs:'التحاليل',prescriptions:'الروشتات',invoices:'الفواتير'}).map(([key,label])=>results[key]?.length>0&&<div key={key} className="search-group"><b>{label}</b>{results[key].map((item,index)=><button key={item.id||index} onClick={()=>selectResult(key,item)}><span>{item.fullName||`${item.first_name||''} ${item.last_name||''}`||item.name_ar||item.number||item.diagnosis}</span><small>{item.file_no||item.status||item.total&&`${item.total} ج.م`}</small></button>)}</div>)}{!Object.values(results).some(x=>x?.length)&&<div className="search-empty">لا توجد نتائج مطابقة</div>}</div>}
       </div>
       <div className="top-action-wrap"><button className="top-icon" onClick={()=>setNotifOpen(v=>!v)} aria-label="الإشعارات"><Bell size={19}/>{unread>0&&<i className="notification-dot"/>}</button>{notifOpen&&<div className="notification-popover"><div className="popover-head"><strong>الإشعارات</strong><button onClick={()=>api('/notifications/read-all',{method:'POST'}).then(()=>setNotifs(a=>a.map(n=>({...n,read_at:new Date().toISOString()}))))}>تحديد الكل كمقروء</button></div><div className="notification-list">{notifs.slice(0,6).map(n=><button key={n.id} className={`notification-item ${n.read_at?'read':''}`} onClick={()=>{markRead(n.id);if(n.link)navigate(n.link)}}><span className="notif-mark"><Bell size={15}/></span><span><b>{n.title}</b><small>{n.body}</small></span></button>)}{!notifs.length&&<div className="search-empty">لا توجد إشعارات</div>}</div><NavLink to="/portal/notifications" onClick={()=>setNotifOpen(false)}>عرض كل الإشعارات</NavLink></div>}</div>
       <button className="top-icon" title="تغيير المظهر" onClick={()=>setTheme(v=>v==='light'?'dark':'light')}>{theme==='light'?<Moon size={18}/>:<Sun size={18}/>}</button>
       <button className="language-btn" title="تغيير اللغة" onClick={()=>{const next=language==='ar'?'en':'ar';setLanguage(next);localStorage.setItem('clinico-language',next);toast(next==='ar'?'تم التبديل إلى العربية':'Language changed to English','info')}}><Languages size={18}/><span>{language==='ar'?'ع':'EN'}</span></button>
       <div className="user-menu-wrap"><button className="user-menu" onClick={()=>setMenuOpen(v=>!v)}><span className="avatar-small">{user?.fullName?.slice(0,1)||'م'}</span><span className="user-menu-name">{user?.fullName?.split(' ')[0]}</span><ChevronDown size={15}/></button>{menuOpen&&<div className="user-popover"><div className="user-popover-title"><strong>{user?.fullName}</strong><small>{user?.email||user?.phone}</small></div><NavLink to={`${base}/settings`} onClick={()=>setMenuOpen(false)}><Settings size={15}/> الإعدادات</NavLink><button onClick={logout}><LogOut size={15}/> تسجيل الخروج</button></div>}</div>
      </div>
    </header>
    <main className="page-container">{children}</main>
    <footer className="app-footer"><span>© {new Date().getFullYear()} Clinico Systems</span><span>رعاية مترابطة، بيانات آمنة</span></footer>
   </div>
  </div>;
}
