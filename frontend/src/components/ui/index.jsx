import { useEffect, useState } from 'react'
import { getTagComplianceClass } from './ComplianceBadge'

export { ComplianceRow, BackupCell, SourceBadge, getComplianceState, getBadgeClass, INDICATORS } from './ComplianceBadge'

export function Modal({ open, onClose, title, children, maxW = 'max-w-xl' }) {
  useEffect(() => {
    if (!open) return
    const h = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [open, onClose])
  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className={`relative z-10 w-full ${maxW} card p-6 shadow-2xl max-h-[90vh] overflow-y-auto`}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-semibold text-gray-900">{title}</h2>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-700">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12"/></svg>
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}

export function Skeleton({ className='' }) { return <div className={`animate-pulse bg-gray-50 rounded ${className}`} /> }
export function TableSkeleton({ rows=6, cols=6 }) {
  return <div className="space-y-2 p-4">{Array.from({length:rows}).map((_,i)=><div key={i} className="flex gap-4">{Array.from({length:cols}).map((_,j)=><Skeleton key={j} className="h-8 flex-1"/>)}</div>)}</div>
}
export function Spinner({ size='md' }) {
  const sz={sm:'w-4 h-4',md:'w-6 h-6',lg:'w-10 h-10'}[size]
  return <svg className={`${sz} animate-spin`} style={{color:'#C8001D'}} fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4l3-3-3-3V4a10 10 0 00-9.95 9H4z"/></svg>
}
export function Empty({ message='Sin datos' }) {
  return <div className="flex flex-col items-center justify-center py-16 text-gray-600"><svg className="w-12 h-12 mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}><path strokeLinecap="round" strokeLinejoin="round" d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0H4"/></svg><p className="text-sm">{message}</p></div>
}

// Color helpers — exportados para uso en toda la app
export const hexToRgb = (h) => { const r=parseInt(h.slice(1,3),16),g=parseInt(h.slice(3,5),16),b=parseInt(h.slice(5,7),16); return [r,g,b] }
export const darkenColor = (h, f=0.65) => { try { const [r,g,b]=hexToRgb(h); return `rgb(${Math.round(r*f)},${Math.round(g*f)},${Math.round(b*f)})` } catch { return '#333' } }

// Calcula la luminancia WCAG
export const needsWhiteText = (hex) => {
  try {
    const [r,g,b] = hexToRgb(hex)
    const ch = (v) => { const s=v/255; return s<=0.04045 ? s/12.92 : Math.pow((s+0.055)/1.055,2.4) }
    const L = 0.2126*ch(r) + 0.7152*ch(g) + 0.0722*ch(b)
    return L < 0.35
  } catch { return false }
}

// Estilo de badge: fondo muy suave + texto oscurecido del mismo color + borde fino
// Mismo estilo que TagsPage — fondo sutil, texto del tono oscurecido, borde ligero
export const colorBadgeStyle = (colorCode) => {
  const clr = colorCode?.startsWith('#') ? colorCode : '#666666'
  const [r,g,b] = (() => { try { return hexToRgb(clr) } catch { return [100,100,100] } })()
  const bg    = `rgba(${r},${g},${b},0.12)`       // fondo: 12% opacidad — muy suave
  const text  = `rgb(${Math.round(r*0.62)},${Math.round(g*0.62)},${Math.round(b*0.62)})` // texto 62% tono
  const border = `rgba(${r},${g},${b},0.45)`      // borde: 45% opacidad — sutil
  return { backgroundColor: bg, color: text, borderColor: border, border: '1px solid', fontWeight: '600' }
}

export function TagBadge({ tag, onClick, active, asset, excMap }) {
  const clr = tag.color_code?.startsWith('#') ? tag.color_code : '#666666'
  let style = colorBadgeStyle(clr)
  let complianceCls = ''
  if (asset && excMap) {
    complianceCls = getTagComplianceClass(tag.name, asset, excMap) || ''
  }
  return (
    <button onClick={onClick} type="button"
      className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border transition-all ${onClick?'cursor-pointer hover:scale-105':'cursor-default'} ${active?'ring-2 ring-white/50 scale-105':''} ${complianceCls}`}
      style={complianceCls ? {} : style}>
      {tag.name}
    </button>
  )
}

const TYPE_STYLES = {
  server_physical:{label:'Físico',        cls:'bg-slate-100 text-slate-700 border border-slate-400'},
  server_virtual: {label:'Virtual',       cls:'bg-violet-100 text-violet-700 border border-violet-400'},
  vcenter:        {label:'vCenter',       cls:'bg-purple-100 text-purple-700 border border-purple-400'},
  web_server:     {label:'Web Server',    cls:'bg-green-100 text-green-700 border border-green-400'},
  database:       {label:'BD',            cls:'bg-cyan-100 text-cyan-700 border border-cyan-400'},
  switch:         {label:'Switch',        cls:'bg-sky-100 text-sky-700 border border-sky-400'},
  router:         {label:'Router',        cls:'bg-amber-100 text-amber-700 border border-amber-400'},
  firewall:       {label:'Firewall',      cls:'bg-red-100 text-red-700 border border-red-400'},
  load_balancer:  {label:'Load Balancer', cls:'bg-orange-100 text-orange-700 border border-orange-400'},
  ap:             {label:'AP WiFi',       cls:'bg-emerald-100 text-emerald-700 border border-emerald-400'},
  storage_array:  {label:'Storage',       cls:'bg-pink-100 text-pink-700 border border-pink-400'},
}
export function AssetTypeBadge({ type, onClick }) {
  const s = TYPE_STYLES[type] || {label:type, cls:'bg-gray-100 text-gray-700 border border-gray-400'}
  if (onClick) return (
    <button type="button" onClick={onClick}
      title={`Filtrar por tipo: ${s.label}`}
      className={`badge ${s.cls} cursor-pointer hover:scale-105 hover:shadow-sm transition-all`}>
      {s.label}
    </button>
  )
  return <span className={`badge ${s.cls}`}>{s.label}</span>
}

const _SERVER_TYPES = new Set(['server_virtual','server_physical','vcenter'])
const _DB_WEB_TYPES = new Set(['database','web_server'])

export function PowerStateBadge({ type, vm_power_state, container_status, onClick }) {
  const cls = 'mt-0.5 inline-block text-[10px] font-semibold px-1.5 py-0.5 rounded leading-none'
  const clickCls = onClick ? ' cursor-pointer hover:scale-105 hover:shadow-sm transition-all' : ''
  const wrap = (inner, extra) => onClick
    ? <button type="button" onClick={onClick} title="Filtrar por estado" className={`${cls}${clickCls} ${extra}`}>{inner}</button>
    : <span className={`${cls} ${extra}`}>{inner}</span>
  if (_SERVER_TYPES.has(type) && vm_power_state) {
    if (vm_power_state === 'poweredOn')  return wrap('Encendido', 'bg-green-100 text-green-700 border border-green-300')
    if (vm_power_state === 'poweredOff') return wrap('Apagado',   'bg-red-100 text-red-700 border border-red-300')
    if (vm_power_state === 'suspended')  return wrap('Suspendido','bg-gray-100 text-gray-600 border border-gray-300')
  }
  if (_DB_WEB_TYPES.has(type) && container_status) {
    if (container_status === 'running')                          return wrap('Running','bg-green-100 text-green-700 border border-green-300')
    if (container_status === 'stopped' || container_status === 'exited') return wrap('Stopped','bg-red-100 text-red-700 border border-red-300')
  }
  return null
}

export function IndicatorBadge({ indicator }) {
  const MAP = {edr:'bg-red-100 text-red-700 border-red-400',mon:'bg-sky-100 text-sky-700 border-sky-400',siem:'bg-teal-100 text-teal-700 border-teal-400',logs:'bg-amber-100 text-amber-700 border-amber-400',bck:'bg-green-100 text-green-700 border-green-400',bckcl:'bg-blue-100 text-blue-700 border-blue-400'}
  return <span className={`badge border text-[10px] font-bold ${MAP[indicator]||'bg-gray-100 text-gray-600'}`}>{indicator?.toUpperCase()}</span>
}

let _setToasts = null
export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([])
  _setToasts = setToasts
  return (<>{children}<div className="fixed bottom-4 right-4 z-50 space-y-2">{toasts.map(t=><div key={t.id} className={`flex items-center gap-2 px-4 py-3 rounded-lg shadow-lg text-sm font-medium ${t.type==='success'?'bg-green-800 text-green-100':t.type==='error'?'bg-red-800 text-red-100':'bg-gray-50 text-gray-900'}`}>{t.type==='success'?'✓':t.type==='error'?'✗':'ℹ'} {t.message}</div>)}</div></>)
}
export function toast(message, type='success', duration=4000) {
  if (!_setToasts) return
  const id = Date.now()
  _setToasts(ts => [...ts, {id, message, type}])
  setTimeout(() => _setToasts(ts => ts.filter(t => t.id !== id)), duration)
}

export function SortIcon({ field, sortBy, sortOrder }) {
  const active = sortBy === field
  return (
    <span className="ml-1 inline-flex flex-col" style={{fontSize:'8px',lineHeight:'8px'}}>
      <span style={{opacity: active && sortOrder==='asc' ? 1 : 0.3}}>▲</span>
      <span style={{opacity: active && sortOrder==='desc' ? 1 : 0.3}}>▼</span>
    </span>
  )
}
