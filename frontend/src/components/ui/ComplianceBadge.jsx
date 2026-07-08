import { format } from 'date-fns'
import { es } from 'date-fns/locale/es'

export const INDICATORS = [
  { key:'edr',   label:'EDR',   field:'edr_installed',    isDate:false },
  { key:'siem',  label:'SIEM',  field:'siem_enabled',     isDate:false },
  { key:'mon',   label:'MON',   field:'monitored',        isDate:false },
  { key:'logs',  label:'LOGS',  field:'logs_enabled',     isDate:false },
  { key:'bck',   label:'BCK',   field:'last_backup_local',isDate:true  },
  { key:'bckcl', label:'BCKCL', field:'last_backup_cloud',isDate:true  },
]

// Devuelve 'ok' | 'ok_with_exception' | 'ko_with_exception' | 'ko'
// NUNCA azul puro — siempre gradiente cuando hay excepción
export function getComplianceState(indicator, asset, excMap) {
  const val = asset[indicator.field]
  const ok  = !!val
  const exc = excMap[indicator.key]
  if (ok && exc)  return 'ok_with_exception'   // origen OK + excepción → azul-verde
  if (ok)         return 'ok'                  // origen OK sin excepción → verde
  if (exc)        return 'ko_with_exception'   // origen KO + excepción (perm. o temp.) → rojo-azul
  return 'ko'                                  // origen KO sin excepción → rojo
}

export function getBadgeClass(state) {
  // Colores semánticos — light-mode con buen contraste
  if (state === 'ok')                return 'bg-green-100 text-green-800 border-green-500 font-semibold'
  if (state === 'ok_with_exception') return 'compliance-gradient text-white border-red-500 font-semibold'
  if (state === 'ko_with_exception') return 'compliance-gradient-temp text-white border-green-600 font-semibold'
  return 'bg-red-100 text-red-800 border-red-500 font-semibold'
}

// Clases Tailwind para el badge según el estado de compliance
export function getTagComplianceClass(tagName, asset, excMap) {
  const MAP = {
    'EDR Active':'edr','EDR Missing':'edr',
    'Monitored':'mon','No Monitoring':'mon',
    'SIEM Active':'siem','SIEM Missing':'siem',
    'Logs Active':'logs','Logs Missing':'logs',
    'Backup Local OK':'bck','Backup Local Missing':'bck',
    'Backup Cloud OK':'bckcl','Backup Cloud Missing':'bckcl',
  }
  const indicatorKey = MAP[tagName]
  if (!indicatorKey) return null
  const ind = INDICATORS.find(i => i.key === indicatorKey)
  if (!ind) return null
  const state = getComplianceState(ind, asset, excMap)
  return getBadgeClass(state)
}

function getTooltip(indicator, asset, excMap, state) {
  if (state === 'ok_with_exception') {
    const e = excMap[indicator.key]
    return `OK desde el origen. Excepción activa: ${e.reason}\nCreada por ${e.created_by_name}. Considera revocarla.`
  }
  if (state === 'ko_with_exception') {
    const exc = excMap[indicator.key]
    return `KO con excepción: ${exc.reason}\nCreada por ${exc.created_by_name}`
  }
  if (indicator.isDate) {
    const val = asset[indicator.field]
    if (val) {
      const lbl = indicator.key === 'bck' ? 'Último backup local' : 'Último backup cloud'
      return `${lbl}: ${format(new Date(val),'dd/MM/yyyy HH:mm',{locale:es})}`
    }
    return indicator.key === 'bck' ? 'Sin datos de Veeam local' : 'Sin datos de Veeam cloud'
  }
  const labels = {edr:'EDR',mon:'Monitorización',siem:'SIEM',logs:'Logs del sistema'}
  return state === 'ok' ? `${labels[indicator.key]} activo` : `Sin ${labels[indicator.key]}`
}

export function ComplianceRow({ asset }) {
  const excMap = {}
  ;(asset.exceptions || []).forEach(e => { excMap[e.indicator] = e })
  return (
    <div className="flex items-center gap-1 flex-wrap">
      {INDICATORS.map(ind => {
        const state = getComplianceState(ind, asset, excMap)
        const tip   = getTooltip(ind, asset, excMap, state)
        return (
          <span key={ind.key} title={tip}
            className={`inline-flex items-center justify-center px-1.5 py-0.5 rounded text-[10px] font-bold tracking-wide border cursor-default select-none ${getBadgeClass(state)}`}>
            {ind.label}
          </span>
        )
      })}
    </div>
  )
}

export function BackupCell({ value }) {
  if (!value) return <span className="text-red-600 text-xs font-medium">Sin backup</span>
  return <span className="text-xs text-gray-700" title={format(new Date(value),'dd/MM/yyyy HH:mm',{locale:es})}>{format(new Date(value),'dd/MM HH:mm',{locale:es})}</span>
}

// Badge de origen del activo
const SOURCE_MAP = [
  {match:['vmware','vcenter'],  label:'VMware',      cls:'bg-indigo-900/60 text-indigo-300', icon:'🖥'},
  {match:['edr'],            label:'EDR',      cls:'bg-blue-900/60 text-blue-200',     icon:'🛡'},
  {match:['veeam'],             label:'Veeam',       cls:'bg-blue-100 text-blue-700 border border-blue-300',    icon:'💾'},
  {match:['crowdstrike','cs-'], label:'CrowdStrike', cls:'bg-orange-100 text-orange-700 border border-orange-300', icon:'🛡'},
  {match:['sentinelone','s1-'], label:'SentinelOne', cls:'bg-purple-100 text-purple-700 border border-purple-300', icon:'🛡'},
  {match:['zabbix'],            label:'Zabbix',      cls:'bg-red-100 text-red-700 border border-red-300',      icon:'📊'},
  {match:['nagios','icinga'],   label:'Nagios',      cls:'bg-yellow-100 text-yellow-800 border border-yellow-400', icon:'📊'},
  {match:['ansible'],           label:'Ansible',     cls:'bg-red-100 text-red-700 border border-red-300',      icon:'⚙'},
  {match:['monica','inventario'],label:'Inventario', cls:'bg-teal-100 text-teal-700 border border-teal-300',   icon:'📋'},
  {match:['manual'],            label:'Manual',      cls:'bg-amber-100 text-amber-800 border border-amber-400 font-semibold', icon:'✏️'},
  {match:['script','cron'],     label:'Script',      cls:'bg-gray-100/60 text-gray-700',    icon:'🔧'},
  {match:['syslog','siem'],     label:'SIEM',        cls:'bg-violet-100 text-violet-700 border border-violet-300', icon:'📡'},
  {match:['api','rest'],        label:'API',         cls:'bg-cyan-100 text-cyan-700 border border-cyan-300',   icon:'🔌'},
]

function _sourceInfo(source) {
  if (!source) return { label: '—', cls: 'bg-gray-50/60 text-gray-600', icon: '📦' }
  const sl = source.toLowerCase()
  const found = SOURCE_MAP.find(s => s.match.some(m => sl.includes(m)))
  return {
    label: found?.label ?? source,
    cls:   found?.cls   ?? 'bg-gray-50/60 text-gray-600',
    icon:  found?.icon  ?? '📦',
  }
}

export function SourceBadge({ source, contributing_sources = [], onSourceClick }) {
  if (!source) return <span className="text-gray-600 text-xs">—</span>
  const primary = _sourceInfo(source)
  const secondaries = (contributing_sources || []).filter(s => s !== source)
  const clickCls = onSourceClick ? ' cursor-pointer hover:scale-105 hover:shadow-sm transition-all' : ''
  return (
    <div className="flex flex-col gap-0.5 items-start">
      {onSourceClick ? (
        <button type="button" onClick={() => onSourceClick(source)}
          title={`Filtrar por origen: ${primary.label}`}
          className={`badge border border-transparent ${primary.cls}${clickCls}`}>
          {primary.icon} {primary.label}
        </button>
      ) : (
        <span className={`badge border border-transparent ${primary.cls}`} title={source}>
          {primary.icon} {primary.label}
        </span>
      )}
      {secondaries.map(s => {
        const info = _sourceInfo(s)
        return onSourceClick ? (
          <button key={s} type="button" onClick={() => onSourceClick(s)}
            title={`Filtrar por origen: ${info.label}`}
            className={`text-[9px] px-1 py-0.5 rounded font-medium bg-gray-100 text-gray-500 border border-gray-200${clickCls}`}>
            +{info.label}
          </button>
        ) : (
          <span key={s} className="text-[9px] px-1 py-0.5 rounded font-medium bg-gray-100 text-gray-500 border border-gray-200" title={s}>
            +{info.label}
          </span>
        )
      })}
    </div>
  )
}
