import { useState, useCallback } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { dashboardApi } from '../services/api'
import { Spinner } from '../components/ui/index.jsx'

// Colores coherentes con los badges de la app
// EOL: los mismos que las etiquetas EOL KO/WARN/OK
const EOL_COLORS  = { eol_ko:'#dc2626', eol_warn:'#d97706', eol_ok:'#16a34a', no_data:'#cbd5e1' }
// Compliance: semáforo estándar + azul para excepciones
// Degradado azul→verde para ok+excepción (cumple pero tiene excepción activa)
// Degradado azul→rojo para ko+excepción (no cumple pero excepción justificada)
const COMP_COLORS = {
  ok:                 '#16a34a',  // verde — cumple sin excepciones
  ok_with_exception:  '#0891b2',  // cian (azul→verde) — cumple + excepción activa
  ko_with_exception:  '#d97706',  // ámbar (azul→rojo) — no cumple + excepción justificada
  ko:                 '#dc2626',  // rojo — no cumple sin justificación
}
// Backup
const BCK_COLORS  = { ok:'#16a34a', missing:'#ef4444' }
// Certificados
const CERT_COLORS = { valid:'#16a34a', expiring:'#d97706', critical:'#f97316', expired:'#ef4444' }
// Servicios: los mismos que los badges de estado de servicio
const SVC_STATUS_COLORS = { active:'#16a34a', degraded:'#f97316', maintenance:'#d97706', inactive:'#94a3b8' }
const SVC_CRIT_COLORS   = { critical:'#dc2626', high:'#f97316', medium:'#eab308', low:'#94a3b8' }
// EDR Agent Status
const EDR_BOOL_COLORS   = { online:'#16a34a', offline:'#ef4444', enabled:'#16a34a', disabled:'#ef4444', managed:'#16a34a', unmanaged:'#ef4444', no_data:'#f59e0b', unmatched:'#64748b', exc:'#d97706' }
const EDR_MODE_COLORS   = { XDR:'#0891b2', 'Intercept X':'#7c3aed', Standard:'#16a34a', Desconocido:'#f59e0b', unmatched:'#64748b', exc:'#d97706' }

// SVG helpers
function polarToXY(cx, cy, r, deg) {
  const rad = (deg - 90) * Math.PI / 180
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) }
}
function describeSlice(cx, cy, r, s, e) {
  if (e - s >= 359.9)
    return `M ${cx-r} ${cy} A ${r} ${r} 0 1 1 ${cx+r} ${cy} A ${r} ${r} 0 1 1 ${cx-r} ${cy} Z`
  const p = polarToXY(cx,cy,r,s), q = polarToXY(cx,cy,r,e)
  return `M ${cx} ${cy} L ${p.x} ${p.y} A ${r} ${r} 0 ${e-s>180?1:0} 1 ${q.x} ${q.y} Z`
}

// Tooltip fijo al viewport
function Tooltip({ tooltip }) {
  if (!tooltip) return null
  const { x, y, slice } = tooltip
  const W = 230
  const left = x + 16 + W > window.innerWidth ? x - W - 8 : x + 16
  const top  = Math.max(4, y - 20)
  return (
    <div className="fixed z-[9999] bg-white rounded-xl shadow-2xl text-xs pointer-events-none overflow-hidden"
      style={{ left, top, minWidth: 180, maxWidth: W, border: '1.5px solid #E5E7EB' }}>
      <div className="px-3 py-2 flex items-center gap-2"
        style={{ backgroundColor: `${slice.color}18`, borderBottom: '1px solid #F3F4F6' }}>
        <span className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: slice.color }}/>
        <span className="font-bold text-gray-800 flex-1">{slice.label}</span>
        <span className="font-bold text-sm" style={{ color: slice.color }}>{slice.count}</span>
      </div>
      <div className="px-3 py-2 space-y-0.5 max-h-52 overflow-y-auto">
        {!(slice.items?.length) ? (
          <p className="text-gray-400 italic text-center py-2">Sin elementos</p>
        ) : slice.items.slice(0, 12).map((item, i) => (
          <div key={item.id||i} className="flex items-center gap-2 py-0.5 border-b last:border-0"
            style={{ borderColor: '#F9FAFB' }}>
            <span className="text-[9px] text-gray-400 uppercase tracking-wide w-16 flex-shrink-0 truncate">
              {item.type || '—'}
            </span>
            <span className="text-gray-800 font-medium truncate">{item.name}</span>
          </div>
        ))}
        {(slice.items?.length||0) > 12 && (
          <p className="text-gray-400 text-[10px] text-center pt-1">
            +{slice.items.length - 12} más · click para filtrar
          </p>
        )}
      </div>
      <div className="px-3 py-1.5 text-[10px] font-semibold text-center"
        style={{ backgroundColor: `${slice.color}10`, borderTop:'1px solid #F3F4F6', color: slice.color }}>
        ▶ Click para filtrar en Inventario
      </div>
    </div>
  )
}

// PieChart
function PieChart({ data, title, onSliceClick, size = 140 }) {
  const [hovered, setHovered] = useState(null)
  const [tooltip, setTooltip] = useState(null)
  const total = data.reduce((s,d) => s + d.count, 0)

  if (total === 0) return (
    <div className="flex flex-col items-center gap-2">
      <p className="text-xs font-semibold text-gray-700 text-center leading-tight">{title}</p>
      <div className="rounded-full bg-gray-100 border-2 border-dashed border-gray-300 flex items-center justify-center"
        style={{ width: size, height: size }}>
        <span className="text-[10px] text-gray-400">Sin datos</span>
      </div>
    </div>
  )

  const cx = size/2, cy = size/2, r = size/2 - 6
  let angle = 0
  const slices = data.filter(d=>d.count>0).map(d => {
    const span = (d.count/total)*360
    const s = {...d, start:angle, end:angle+span}; angle+=span; return s
  })

  return (
    <div className="flex flex-col items-center gap-2">
      <p className="text-xs font-semibold text-gray-800 text-center leading-tight">{title}</p>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}
        style={{ cursor: onSliceClick?'pointer':'default' }}>
        {slices.map(sl => {
          const isH = hovered === sl.status
          return (
            <path key={sl.status}
              d={describeSlice(cx,cy,r,sl.start,sl.end)}
              fill={sl.color} stroke="#fff" strokeWidth={2}
              opacity={hovered&&!isH ? 0.45 : 1}
              style={{
                transform: isH?'scale(1.06)':'scale(1)',
                transformOrigin:`${cx}px ${cy}px`,
                transition:'all 0.12s ease',
                filter: isH?`drop-shadow(0 3px 8px ${sl.color}99)`:'none',
              }}
              onMouseMove={e=>{setHovered(sl.status);setTooltip({x:e.clientX,y:e.clientY,slice:sl})}}
              onMouseLeave={()=>{setHovered(null);setTooltip(null)}}
              onClick={()=>{setTooltip(null);setHovered(null);onSliceClick&&onSliceClick(sl)}}
            />
          )
        })}
        <text x={cx} y={cy-3} textAnchor="middle" fontSize="15" fontWeight="800" fill="#111827">{total}</text>
        <text x={cx} y={cy+11} textAnchor="middle" fontSize="8" fill="#9ca3af">total</text>
      </svg>
      <div className="flex flex-col gap-0.5 w-full">
        {slices.map(sl => (
          <button key={sl.status} type="button"
            className="flex items-center gap-1.5 hover:opacity-70 transition-opacity text-left"
            onClick={()=>{onSliceClick&&onSliceClick(sl)}}
            onMouseEnter={()=>setHovered(sl.status)} onMouseLeave={()=>setHovered(null)}>
            <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{backgroundColor:sl.color}}/>
            <span className="text-[10px] text-gray-700 flex-1 truncate">{sl.label}</span>
            <span className="text-[10px] font-bold text-gray-800">{sl.count}</span>
          </button>
        ))}
      </div>
      <Tooltip tooltip={tooltip}/>
    </div>
  )
}

// Helpers
function Block({ title, children }) {
  return (
    <div className="card p-5 space-y-5">
      <h2 className="text-sm font-bold text-gray-800 uppercase tracking-wider pb-2 border-b"
        style={{borderColor:'#EED8D8'}}>{title}</h2>
      {children}
    </div>
  )
}
function KpiCard({ icon, label, value, color }) {
  return (
    <div className="card px-5 py-4 flex items-center gap-3">
      <span className="text-2xl">{icon}</span>
      <div>
        <p className="text-2xl font-extrabold" style={{color}}>{value ?? '—'}</p>
        <p className="text-xs text-gray-600 leading-tight">{label}</p>
      </div>
    </div>
  )
}
function Legend({ items }) {
  return (
    <div className="flex gap-4 flex-wrap text-[10px] text-gray-500 pt-1">
      {items.map(([color,label]) => (
        <span key={label} className="flex items-center gap-1">
          <span className="w-2 h-2 rounded-full inline-block" style={{backgroundColor:color}}/>
          {label}
        </span>
      ))}
    </div>
  )
}

const TYPE_ICONS = { server_physical:'🖥', server_virtual:'💻', switch:'🔀', router:'📡', ap:'📶', database:'🗄', k8s_cluster:'☸', container:'📦', web_server:'🌐', firewall:'🔥', load_balancer:'⚖', storage_array:'💽', vcenter:'🏗' }
const CRIT_LABEL = { critical:'Crítico', high:'Alto', medium:'Medio', low:'Bajo' }
const STATUS_LABEL = { active:'Activo', degraded:'Degradado', maintenance:'Mantenimiento', inactive:'Inactivo' }

// Dashboard
export default function DashboardPage() {
  const navigate = useNavigate()
  const { data, isLoading } = useQuery({
    queryKey: ['dashboard'],
    queryFn: dashboardApi.get,
    refetchInterval: 60000,
  })

  const goInventario = useCallback((params) => {
    const qs = new URLSearchParams(
      Object.fromEntries(Object.entries(params).filter(([,v]) => v != null && v !== ''))
    ).toString()
    navigate(`/inventario${qs ? '?' + qs : ''}`)
  }, [navigate])

  // EOL: navega al inventario filtrado por tipo y (si aplica) etiqueta EOL
  const handleEolSlice = (type) => (slice) => {
    if (slice.status === 'no_data') return goInventario({ type: type || undefined })
    const tag = slice.status==='eol_ko' ? 'EOL KO' : slice.status==='eol_warn' ? 'EOL WARN' : 'EOL OK'
    goInventario({ type: type || undefined, eol_tag: tag })
  }

  // Compliance: pasa compliance_indicator + compliance_status como query params reales
  const handleComplianceSlice = (indicator) => (slice) => {
    if (!slice.status) return
    goInventario({
      compliance_indicator: indicator,
      compliance_status:    slice.status,
    })
  }

  const handleBackupSlice = (type) => (slice) => {
    const tag = type==='local'
      ? (slice.status==='ok' ? 'Backup Local OK' : 'Backup Local Missing')
      : (slice.status==='ok' ? 'Backup Cloud OK' : 'Backup Cloud Missing')
    goInventario({ search: tag })
  }

  const handleCertSlice = (slice) => navigate(`/certificates?status=${slice.status}`)

  // EDR Agent Status
  // unmatched = sin registro EDR (edr_endpoint_id IS NULL → edr_installed=false y sin endpoint_id)
  // no_data   = tiene registro EDR pero el campo concreto es null
  const handleEdrOnlineSlice  = (slice) => {
    if (slice.status === 'unmatched') return goInventario({ edr_installed: 'false' })
    if (slice.status === 'exc')       return goInventario({ compliance_indicator: 'edr', compliance_status: 'ko_with_exception' })
    if (slice.status === 'no_data')   return goInventario({ edr_installed: 'true' })
    goInventario({ edr_online: slice.status === 'online' ? 'true' : 'false' })
  }
  const handleEdrTamperSlice  = (slice) => {
    if (slice.status === 'unmatched') return goInventario({ edr_installed: 'false' })
    if (slice.status === 'exc')       return goInventario({ compliance_indicator: 'edr', compliance_status: 'ko_with_exception' })
    if (slice.status === 'no_data')   return goInventario({ edr_installed: 'true' })
    goInventario({ edr_tamper_protected: slice.status === 'enabled' ? 'true' : 'false' })
  }
  const handleEdrModeSlice    = (slice) => {
    if (slice.status === 'unmatched') return goInventario({ edr_installed: 'false' })
    if (slice.status === 'exc')       return goInventario({ compliance_indicator: 'edr', compliance_status: 'ko_with_exception' })
    if (slice.status === 'no_data')   return goInventario({ edr_mode_missing: 'true' })
    goInventario({ edr_agent_mode: slice.status })
  }
  const handleEdrManagedSlice = (slice) => {
    if (slice.status === 'unmatched') return goInventario({ edr_installed: 'false' })
    if (slice.status === 'exc')       return goInventario({ compliance_indicator: 'edr', compliance_status: 'ko_with_exception' })
    if (slice.status === 'no_data')   return goInventario({ edr_installed: 'true' })
    goInventario({ edr_managed: slice.status === 'managed' ? 'true' : 'false' })
  }
  const handleEdrHealthSlice = (slice) => {
    goInventario({ edr_health: slice.status })
  }

  // Servicios: navega a la página de servicios con el mapa del servicio seleccionado
  const handleSvcClick = (svc) => {
    navigate(`/applications?tab=mapa&service_id=${svc.id}`)
  }
  const handleSvcSlice = (slice) => {
    // click en sector de estado → va a tab servicios (lista filtrada por estado)
    navigate(`/applications?tab=servicios&status=${slice.status}`)
  }

  if (isLoading) return (
    <div className="p-6 flex items-center justify-center min-h-96"><Spinner/></div>
  )
  if (!data) return (
    <div className="p-6 text-center text-gray-600">Error cargando el dashboard</div>
  )

  const { kpis, eol_by_type, compliance, backup, certificates, services, edr_agent_status, edr_security_health } = data

  // Inyectar colores coherentes en los segmentos
  const coloredEol = (eol_by_type||[]).map(g => ({
    ...g,
    segments: g.segments.map(s => ({...s, color: EOL_COLORS[s.status]||s.color}))
  }))
  const coloredComp = (compliance||[]).map(c => ({
    ...c,
    segments: c.segments.map(s => ({...s, color: COMP_COLORS[s.status]||s.color}))
  }))
  const coloredBkLocal = (backup?.local?.segments||[]).map(s=>({...s, color: BCK_COLORS[s.status]||s.color}))
  const coloredBkCloud = (backup?.cloud?.segments||[]).map(s=>({...s, color: BCK_COLORS[s.status]||s.color}))
  const coloredCerts = (certificates?.segments||[]).map(s=>({...s, color: CERT_COLORS[s.status]||s.color}))
  const coloredSvc = (services?.by_status?.segments||[]).map(s=>({...s, color: SVC_STATUS_COLORS[s.status]||s.color}))
  const coloredEdrOnline  = (edr_agent_status?.online?.segments||[]).map(s=>({...s, color: EDR_BOOL_COLORS[s.status]||s.color}))
  const coloredEdrTamper  = (edr_agent_status?.tamper?.segments||[]).map(s=>({...s, color: EDR_BOOL_COLORS[s.status]||s.color}))
  const coloredEdrMode    = (edr_agent_status?.mode?.segments||[]).map(s=>({...s, color: EDR_MODE_COLORS[s.status]||s.color}))
  const coloredEdrManaged = (edr_agent_status?.managed?.segments||[]).map(s=>({...s, color: EDR_BOOL_COLORS[s.status]||s.color}))

  const HEALTH_COLORS = { good:'#16a34a', suspicious:'#d97706', bad:'#dc2626', unknown:'#f59e0b', sin_edr:'#64748b' }
  const coloredEdrHealth = (edr_security_health?.segments||[]).map(s=>({...s, color: HEALTH_COLORS[s.status]||s.color}))

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-xl font-bold text-gray-900">Dashboard</h1>
        <p className="text-xs text-gray-600 mt-0.5">
          Vista general — Organización Local · Pasa el cursor para ver detalle, haz click para filtrar
        </p>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-6 gap-4">
        <KpiCard icon="🖥" label="Activos en inventario"    value={kpis.total_assets}      color="#C8001D"/>
        <KpiCard icon="⚙" label="Servicios"                value={services?.total||0}      color="#1d4ed8"/>
        <KpiCard icon="☸" label="Clusters Kubernetes"      value={kpis.k8s_clusters||0}   color="#0891b2"/>
        <KpiCard icon="📦" label="Contenedores"             value={kpis.containers||0}      color="#7c3aed"/>
        <KpiCard icon="🛡" label="Excepciones activas"      value={kpis.active_exceptions} color="#2563eb"/>
        <KpiCard icon="🔒" label="Certificados críticos"    value={kpis.critical_certs}    color="#dc2626"/>
      </div>

      {/* Bloque 1: EOL */}
      <Block title="🕐 End of Life — por tipo de activo">
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-8">
          {coloredEol.map(g => (
            <PieChart key={g.type} size={130}
              title={`${TYPE_ICONS[g.type]||'📦'} ${g.label}`}
              data={g.segments}
              onSliceClick={handleEolSlice(g.type)}/>
          ))}
        </div>
        <Legend items={[['#dc2626','EOL KO'],['#d97706','EOL WARN'],['#16a34a','EOL OK'],['#cbd5e1','Sin datos EOL']]}/>
      </Block>

      {/* Bloque 2: Compliance */}
      <Block title="✅ Compliance — por indicador">
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-8">
          {coloredComp.map(c => (
            <PieChart key={c.indicator} size={130}
              title={c.label} data={c.segments}
              onSliceClick={handleComplianceSlice(c.indicator)}/>
          ))}
        </div>
        <Legend items={[
          ['#16a34a','Activo / OK'],
          ['#0891b2','OK + excepción activa'],
          ['#d97706','KO + excepción justificada'],
          ['#ef4444','Sin cumplir'],
        ]}/>
      </Block>

      {/* Bloque 3: Agente EDR — Salud de seguridad */}
      {edr_security_health && edr_security_health.total > 0 && (
        <Block title="🔴 Agente EDR — Salud de seguridad">
          <p className="text-xs text-gray-500 -mt-3 mb-3">
            Estado de seguridad reportado por Agente EDR sobre todos los servidores ({edr_security_health.total} total).
            Haz click en un sector para filtrar el inventario.
          </p>
          <div className="flex justify-center">
            <PieChart size={180} title="Salud de seguridad"
              data={coloredEdrHealth} onSliceClick={handleEdrHealthSlice}/>
          </div>
          <Legend items={[
            ['#16a34a','Bueno — sin amenazas'],
            ['#d97706','Advertencia — recomendaciones pendientes'],
            ['#dc2626','Crítico — amenazas activas o problemas graves'],
            ['#f59e0b','Desconocido — en EDR sin estado claro'],
            ['#64748b','Sin EDR — servidor sin agente EDR'],
          ]}/>
        </Block>
      )}

      {/* Bloque 4: Agente EDR — Estado de agentes */}
      {edr_agent_status && edr_agent_status.total > 0 && (
        <Block title="🛡 Agente EDR — Estado de agentes">
          <p className="text-xs text-gray-500 -mt-3 mb-1">
            {edr_agent_status.edr_installed} de {edr_agent_status.total} servidores con agente EDR instalado · "Sin EDR" = sin registro EDR · "Sin datos" = en EDR pero campo desconocido
            {edr_agent_status.last_sync_at && (
              <span className="ml-2 font-medium text-gray-400">
                · Datos de: {new Date(edr_agent_status.last_sync_at).toLocaleString('es-ES', { dateStyle: 'short', timeStyle: 'short' })}
              </span>
            )}
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-8">
            <PieChart size={130} title="Conectividad"
              data={coloredEdrOnline} onSliceClick={handleEdrOnlineSlice}/>
            <PieChart size={130} title="Protec. manipulación"
              data={coloredEdrTamper} onSliceClick={handleEdrTamperSlice}/>
            <PieChart size={130} title="Modo agente"
              data={coloredEdrMode} onSliceClick={handleEdrModeSlice}/>
            <PieChart size={130} title="Gestionado"
              data={coloredEdrManaged} onSliceClick={handleEdrManagedSlice}/>
          </div>
          <Legend items={[
            ['#16a34a','Online / Activado / Sí'],
            ['#ef4444','Offline / Desactivado / No'],
            ['#0891b2','XDR'],['#7c3aed','Intercept X'],
            ['#f59e0b','Sin datos'],
            ['#64748b','Sin EDR'],
          ]}/>
        </Block>
      )}

      {/* Bloque 4: Backup */}
      <Block title="💾 Backup — cobertura">
        <div className="grid grid-cols-2 gap-10 max-w-xs">
          <PieChart size={150} title="Backup Local"
            data={coloredBkLocal} onSliceClick={handleBackupSlice('local')}/>
          <PieChart size={150} title="Backup Cloud"
            data={coloredBkCloud} onSliceClick={handleBackupSlice('cloud')}/>
        </div>
        <Legend items={[['#16a34a','Con backup reciente'],['#ef4444','Sin backup']]}/>
      </Block>

      {/* Bloque 5: Certificados */}
      <Block title="🔒 Certificados TLS/SSL — estado">
        <div className="max-w-xs">
          <PieChart size={170} title="Por estado TLS"
            data={coloredCerts} onSliceClick={handleCertSlice}/>
        </div>
        <Legend items={[['#16a34a','Válidos'],['#d97706','Próximos ≤30d'],['#f97316','Críticos ≤7d'],['#ef4444','Expirados']]}/>
      </Block>

      {/* Bloque 6: Servicios */}
      <Block title="⚙ Servicios — estado y disponibilidad">
        <div className="flex flex-col lg:flex-row gap-8">
          {/* Gráfico de estado */}
          <div className="flex-shrink-0">
            <PieChart size={160} title="Por estado"
              data={coloredSvc} onSliceClick={handleSvcSlice}/>
          </div>
          {/* Tabla de servicios */}
          <div className="flex-1 min-w-0">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-gray-600 uppercase"
                  style={{backgroundColor:'#F3F4F6',borderBottom:'2px solid #E5E7EB'}}>
                  <th className="px-3 py-2 text-left">Servicio</th>
                  <th className="px-3 py-2 text-left">Estado</th>
                  <th className="px-3 py-2 text-left">Criticidad</th>
                  <th className="px-3 py-2 text-left">Equipo</th>
                  <th className="px-3 py-2 text-right">Mapa</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {(services?.list||[]).map(svc => {
                  const sColor = SVC_STATUS_COLORS[svc.status]||'#94a3b8'
                  const cColor = SVC_CRIT_COLORS[svc.criticality]||'#94a3b8'
                  return (
                    <tr key={svc.id} className="hover:bg-red-50/50 transition-colors">
                      <td className="px-3 py-2.5 font-medium text-gray-900">{svc.name}</td>
                      <td className="px-3 py-2.5">
                        <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-semibold border"
                          style={{
                            backgroundColor:`${sColor}18`, color:sColor,
                            borderColor:`${sColor}60`,
                          }}>
                          <span className="w-1.5 h-1.5 rounded-full inline-block" style={{backgroundColor:sColor}}/>
                          {STATUS_LABEL[svc.status]||svc.status}
                        </span>
                      </td>
                      <td className="px-3 py-2.5">
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold border"
                          style={{
                            backgroundColor:`${cColor}18`, color:cColor,
                            borderColor:`${cColor}60`,
                          }}>
                          {CRIT_LABEL[svc.criticality]||svc.criticality}
                        </span>
                      </td>
                      <td className="px-3 py-2.5 text-xs text-gray-600">{svc.owner_team||'—'}</td>
                      <td className="px-3 py-2.5 text-right">
                        <button
                          className="text-xs font-semibold px-2.5 py-1 rounded-lg border transition-colors hover:bg-primary hover:text-white"
                          style={{borderColor:'#C8001D', color:'#C8001D'}}
                          onClick={() => handleSvcClick(svc)}
                          title={`Ver mapa de dependencias de ${svc.name}`}>
                          🗺 Mapa
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
        <Legend items={[
          ['#16a34a','Activo'],['#f97316','Degradado'],
          ['#d97706','Mantenimiento'],['#94a3b8','Inactivo'],
        ]}/>
      </Block>
    </div>
  )
}
