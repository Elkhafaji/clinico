import React from 'react';
import {Navigate,useLocation} from 'react-router-dom';
import {useAuth} from '../app/AuthContext.jsx';
import Layout from './Layout.jsx';
import {LoaderCircle} from 'lucide-react';

export default function Protected({children}){
 const {user,ready}=useAuth();const location=useLocation();if(!ready)return <div className="loading-screen"><div className="loading-brand"><img src="/assets/images/clinico-logo.svg"/><LoaderCircle className="spin" size={26}/></div></div>;if(!user)return <Navigate to="/login" replace state={{from:location.pathname}}/>;
 const prefix=user.role==='patient'?'/portal':user.role==='receptionist'?'/reception':`/${user.role}`;
 if(!location.pathname.startsWith(prefix))return <Navigate to={prefix} replace/>;
 return <Layout>{children}</Layout>;
}
