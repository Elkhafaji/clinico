import React,{useEffect} from 'react';
import {Navigate,Route,Routes,useLocation} from 'react-router-dom';
import Protected from '../components/Protected.jsx';
import {LandingPage,LoginPage,RegisterPage,ForgotPage} from '../pages/AuthPages.jsx';
import Dashboard from '../pages/Dashboard.jsx';
import ResourcePage,{PatientFilePage} from '../pages/ResourcePage.jsx';
import {PortalHome,PatientQueuePage,BookingPage,PortalMedicalPage,SettingsPage,ReportsPage,SchedulePage,VisitEditor,PrescriptionEditor,ThreadPage,NotificationsPage} from '../pages/PortalPages.jsx';
import {ToastProvider} from '../components/UI.jsx';

function AppArea(){const location=useLocation();const path=location.pathname;
 if(path==='/admin'||path==='/doctor'||path==='/reception')return <Dashboard role={path.slice(1)}/>;
 if(path==='/admin/reports'||path==='/doctor/reports')return <ReportsPage/>;
 if(path==='/doctor/schedule'||path==='/reception/schedule'||path==='/admin/schedule')return <SchedulePage/>;
 if(path==='/portal')return <PortalHome/>;
 if(path==='/portal/book')return <BookingPage/>;
 if(path==='/portal/queue')return <PatientQueuePage/>;
 if(path==='/portal/medical-file')return <PortalMedicalPage/>;
 if(path==='/portal/settings'||path==='/doctor/settings'||path==='/reception/settings'||path==='/admin/settings')return <SettingsPage/>;
 if(path==='/portal/notifications')return <NotificationsPage/>;
 if(path.startsWith('/portal/support/'))return <ThreadPage/>;
 if(path==='/portal/support')return <ResourcePage resource="threads"/>;
 if(path==='/doctor/prescriptions/new'||path==='/admin/prescriptions/new')return <PrescriptionEditor/>;
 if(path==='/doctor/visits/new'||path==='/admin/visits/new')return <VisitEditor/>;
 const detailMatch=path.match(/^\/(admin|doctor|reception)\/patients\/(\d+)(?:\/visits\/(\d+))?$/);
 if(detailMatch){if(detailMatch[3])return <VisitEditor visitId={detailMatch[3]}/>;return <PatientFilePage patientId={detailMatch[2]}/>;}
 const threadMatch=path.match(/^\/(doctor|reception|admin)\/inbox\/(\d+)$/);if(threadMatch)return <ThreadPage/>;
 const map=[
  [/^\/admin\/accounts(?:\/new)?$/,'accounts'],[/^\/admin\/doctors(?:\/new)?$/,'doctors'],[/^\/(?:admin|doctor|reception)\/patients(?:\/new)?$/,'patients'],
  [/^\/(?:admin|doctor|reception|portal)\/appointments(?:\/new)?$/,'appointments'],[/^\/(?:admin|doctor|reception|portal)\/queue(?:\/new)?$/,'queue'],[/^\/admin\/services(?:\/new)?$/,'services'],[/^\/admin\/lab-tests(?:\/new)?$/,'lab-tests'],[/^\/(?:admin|doctor)\/medications(?:\/new)?$/,'medications'],[/^\/(?:admin|reception)\/invoices(?:\/new)?$/,'invoices'],[/^\/(?:admin|doctor|reception|portal)\/labs(?:\/new)?$/,'labs'],[/^\/(?:admin|doctor|reception|portal)\/prescriptions(?:\/new)?$/,'prescriptions'],[/^\/doctor\/notes(?:\/new)?$/,'notes'],[/^\/(?:admin|doctor)\/(?:inbox|threads)(?:\/new)?$/,'threads'],[/^\/portal\/threads(?:\/new)?$/,'threads'],[/^\/admin\/audit$/,'audit'],[/^\/reception\/doctors(?:\/new)?$/,'doctors']
 ];
 for(const [regex,resource] of map){if(regex.test(path))return <ResourcePage resource={resource}/>;}
 if(path==='/portal/labs')return <ResourcePage resource="labs"/>;
 if(path==='/portal/prescriptions')return <ResourcePage resource="prescriptions"/>;
 if(path==='/portal/appointments')return <ResourcePage resource="appointments"/>;
 if(path==='/reception/queue'||path==='/doctor/queue')return <ResourcePage resource="queue"/>;
 if(path.endsWith('/appointments/new'))return <ResourcePage resource="appointments"/>;
 if(path.endsWith('/patients/new'))return <ResourcePage resource="patients"/>;
 if(path.endsWith('/invoices/new'))return <ResourcePage resource="invoices"/>;
 if(path.endsWith('/labs/new'))return <ResourcePage resource="labs"/>;
 if(path.endsWith('/notes/new'))return <ResourcePage resource="notes"/>;
 if(path.endsWith('/prescriptions/new'))return <ResourcePage resource="prescriptions"/>;
 return <div className="route-not-found"><h2>الصفحة غير موجودة</h2><p>يمكنك العودة إلى لوحة التحكم أو استخدام القائمة الجانبية.</p><a className="btn btn-primary" href="/">العودة للرئيسية</a></div>;
}
function PrivateArea(){return <Protected><AppArea/></Protected>}
export default function App(){return <ToastProvider><Routes><Route path="/" element={<LandingPage/>}/><Route path="/login" element={<LoginPage/>}/><Route path="/register" element={<RegisterPage/>}/><Route path="/forgot-password" element={<ForgotPage/>}/><Route path="/*" element={<PrivateArea/>}/></Routes></ToastProvider>}
