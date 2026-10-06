import React,{createContext,useCallback,useContext,useEffect,useMemo,useState} from 'react';
import {api,setAccessToken} from '../services/api.js';
const AuthContext=createContext(null);
export function AuthProvider({children}){
 const [user,setUser]=useState(null);const [ready,setReady]=useState(false);const [error,setError]=useState('');
 const bootstrap=useCallback(async()=>{try{const result=await api('/auth/refresh',{method:'POST',retry:false});setAccessToken(result.accessToken);setUser(result.user);}catch{setAccessToken(null);setUser(null);}finally{setReady(true);}},[]);
 useEffect(()=>{bootstrap();},[bootstrap]);
 const login=useCallback(async(identifier,password)=>{setError('');try{const result=await api('/auth/login',{method:'POST',body:JSON.stringify({identifier,password}),retry:false});setAccessToken(result.accessToken);setUser(result.user);return result.user;}catch(e){setError(e.message);throw e;}},[]);
 const register=useCallback(async(payload)=>{const result=await api('/auth/register',{method:'POST',body:JSON.stringify(payload),retry:false});setAccessToken(result.accessToken);setUser(result.user);return result.user;},[]);
 const logout=useCallback(async()=>{try{await api('/auth/logout',{method:'POST',retry:false});}finally{setAccessToken(null);setUser(null);window.location.assign('/');}},[]);
 const changePassword=useCallback(async(currentPassword,newPassword)=>{await api('/auth/change-password',{method:'POST',body:JSON.stringify({currentPassword,newPassword})});setAccessToken(null);setUser(null);},[]);
 const value=useMemo(()=>({user,ready,error,login,register,logout,changePassword,refresh:bootstrap,clearError:()=>setError('')}),[user,ready,error,login,register,logout,changePassword,bootstrap]);
 return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
export function useAuth(){const value=useContext(AuthContext);if(!value)throw new Error('useAuth must be used inside AuthProvider');return value;}
