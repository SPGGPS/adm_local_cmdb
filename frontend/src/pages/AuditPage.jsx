import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { auditApi } from '../services/api'
import { Modal, TableSkeleton, Empty } from '../components/ui/index.jsx'
import { format } from 'date-fns'
import { es } from 'date-fns/locale/es'

const TYPES = [
  'CREATE','UPDATE','DELETE',
  'TAG_ASSIGN','TAG_REMOVE',
  'LOGIN','LOGIN_FAIL','LOGOUT',
  'INGEST',
  'EOL_SYNC','EOL_SYNC_ALL','EOL_OVERRIDE','EOL_RETAG',
  'LOCATION_ASSIGN',
  'COMPONENT_ADD','COMPONENT_REMOVE',
  'ENDPOINT_ADD','ENDPOINT_REMOVE',
  'DEPENDENCY_ADD','DEPENDENCY_REMOVE',
  'INFRA_BIND','INFRA_UNBIND',
  'EXCEPTION_REVOKE',
]

const TYPE_LABELS = {
  CREATE:'Creación', UPDATE:'Modificación', DELETE:'Eliminación',
  TAG_ASSIGN:'Asignar etiqueta', TAG_REMOVE:'Quitar etiqueta',
  LOGIN:'Login', LOGIN_FAIL:'Login fallido', LOGOUT:'Logout',
  INGEST:'Ingesta',
  EOL_SYNC:'EOL Sync', EOL_SYNC_ALL:'EOL Sync todo',
  EOL_OVERRIDE:'EOL Sobrescritura', EOL_RETAG:'EOL Recalcular',
  LOCATION_ASSIGN:'Asignar ubicación',
  COMPONENT_ADD:'Añadir componente', COMPONENT_REMOVE:'Quitar componente',
  ENDPOINT_ADD:'Añadir endpoint', ENDPOINT_REMOVE:'Quitar endpoint',
  DEPENDENCY_ADD:'Añadir dependencia', DEPENDENCY_REMOVE:'Quitar dependencia',
  INFRA_BIND:'Vincular infra', INFRA_UNBIND:'Desvincular infra',
  EXCEPTION_REVOKE:'Revocar excepción',
}

const TYPE_COLORS = {
  CREATE:           'bg-green-100 text-green-800 border border-green-400',
  UPDATE:           'bg-blue-100 text-blue-800 border border-blue-400',
  DELETE:           'bg-red-100 text-red-800 border border-red-400',
  TAG_ASSIGN:       'bg-violet-100 text-violet-800 border border-violet-400',
  TAG_REMOVE:       'bg-orange-100 text-orange-800 border border-orange-400',
  LOGIN:            'bg-gray-100 text-gray-700 border border-gray-300',
  LOGIN_FAIL:       'bg-red-100 text-red-700 border border-red-400',
  LOGOUT:           'bg-gray-100 text-gray-500 border border-gray-300',
  INGEST:           'bg-teal-100 text-teal-800 border border-teal-400',
  EOL_SYNC:         'bg-cyan-100 text-cyan-800 border border-cyan-400',
  EOL_SYNC_ALL:     'bg-cyan-100 text-cyan-900 border border-cyan-500',
  EOL_OVERRIDE:     'bg-amber-100 text-amber-800 border border-amber-400',
  EOL_RETAG:        'bg-amber-100 text-amber-700 border border-amber-300',
  LOCATION_ASSIGN:  'bg-indigo-100 text-indigo-800 border border-indigo-400',
  COMPONENT_ADD:    'bg-emerald-100 text-emerald-800 border border-emerald-400',
  COMPONENT_REMOVE: 'bg-rose-100 text-rose-800 border border-rose-400',
  ENDPOINT_ADD:     'bg-emerald-100 text-emerald-700 border border-emerald-300',
  ENDPOINT_REMOVE:  'bg-rose-100 text-rose-700 border border-rose-300',
  DEPENDENCY_ADD:   'bg-sky-100 text-sky-800 border border-sky-400',
  DEPENDENCY_REMOVE:'bg-sky-100 text-sky-700 border border-sky-300',
  INFRA_BIND:       'bg-purple-100 text-purple-800 border border-purple-400',
  INFRA_UNBIND:     'bg-purple-100 text-purple-700 border border-purple-300',
  EXCEPTION_REVOKE: 'bg-red-100 text-red-700 border border-red-300',
}

const ENTITY_ICONS = {
  application:'🧩', service:'⚙', asset:'🖥', tag:'🏷', certificate:'🔐',
  exception:'🛡', eol_product:'⏱', eol_cycle:'⏱', zone:'🌐', site:'🏢',
  cell:'▤', data_source:'🔌', user:'👤', default:'📋',
}

/** Genera una descripción legible en lenguaje natural de lo que ocurrió.
 *  Cubre todos los ActivityType del sistema. */
function describeAction(log) {
  const { activity_type: t, entity_type: et, entity_name: en, changes: ch, username } = log
  const name  = en  ? `"${en}"` : log.entity_id ? `(${log.entity_id.slice(0,8)}…)` : ''
  const etype = et  ? et : ''
  const c     = ch  || {}
  // Datos comunes de los changes
  const after  = c.after  || c.added  || {}
  const before = c.before || c.removed|| {}
  const changed = c.changed || {}

  switch (t) {
    // CRUD general
    case 'CREATE': {
      const label = { application:'Aplicación', service:'Servicio', asset:'Activo',
        tag:'Etiqueta', certificate:'Certificado', exception:'Excepción compliance',
        eol_product:'Producto EOL', zone:'Zona', site:'Edificio/CPD', cell:'Celda/Rack',
        data_source:'Fuente de datos' }[etype] || etype
      return `Se creó ${label} ${name}`
    }
    case 'UPDATE': {
      const label = { application:'Aplicación', service:'Servicio', asset:'Activo',
        tag:'Etiqueta', certificate:'Certificado', eol_product:'Producto EOL',
        zone:'Zona', site:'Edificio', cell:'Celda', data_source:'Fuente de datos' }[etype] || etype
      const fields = Object.keys(changed).filter(k => !['updated_at','last_sync'].includes(k))
      return `Se modificó ${label} ${name}${fields.length ? ` — campos: ${fields.join(', ')}` : ''}`
    }
    case 'DELETE': {
      const label = { application:'Aplicación', service:'Servicio',
        eol_product:'Producto EOL', zone:'Zona', site:'Edificio',
        cell:'Celda', data_source:'Fuente de datos', certificate:'Certificado',
        tag:'Etiqueta' }[etype] || etype
      return `Se eliminó ${label} ${name}`
    }
    // Etiquetas
    case 'TAG_ASSIGN': {
      const tags = after.tags_added || []
      const tagsStr = tags.length ? `"${tags.join('", "')}"` : '—'
      return `Etiqueta(s) ${tagsStr} asignada(s) al activo ${name}`
    }
    case 'TAG_REMOVE': {
      const removedTags = before.tags_removed || []
      const removedTagsStr = removedTags.length ? `"${removedTags.join('", "')}"` : '—'
      return `Etiqueta(s) ${removedTagsStr} quitada(s) del activo ${name}`
    }
    // Auth
    case 'LOGIN':      return `✅ ${username||'Usuario'} inició sesión${c.ip ? ` desde ${c.ip}` : ''}`
    case 'LOGIN_FAIL': return `⚠️ Intento de login fallido${c.ip ? ` desde ${c.ip}` : ''} — usuario: ${username||'—'}`
    case 'LOGOUT':     return `${username||'Usuario'} cerró sesión`
    // Ingesta
    case 'INGEST': {
      const src = after.source || before.source || ''
      return `Ingesta${src ? ` desde "${src}"` : ''} — activo ${name} actualizado`
    }
    // EOL
    case 'EOL_SYNC': {
      const created = after.created ?? 0; const updated = after.updated ?? 0
      return `Sincronización EOL para producto ${name} — ${created} ciclos nuevos, ${updated} actualizados`
    }
    case 'EOL_SYNC_ALL': {
      const synced = after.synced ?? 0
      const total_created = after.total_created ?? 0
      return `Sincronización EOL completa — ${synced} productos, ${total_created} ciclos nuevos`
    }
    case 'EOL_OVERRIDE': {
      const date = after.custom_eol_date || '—'
      const retag = after.retag_updated ?? 0
      return `Fecha EOL sobrescrita en ciclo ${name} → ${date} — ${retag} activo(s) recalculado(s)`
    }
    case 'EOL_RETAG': {
      const n = after.updated_assets ?? 0
      return `Recálculo manual de etiquetas EOL — ${n} activo(s) actualizados`
    }
    // Localización
    case 'LOCATION_ASSIGN': {
      const locN = after.updated ?? 0
      return `${locN} activo(s) asignados a la ubicación ${name}`
    }
    // Infraestructura (aplicaciones)
    case 'INFRA_BIND': {
      const assetName = after.asset_name || after.asset_id || '—'
      const tier = after.tier || after.binding_tier || '—'
      const port = after.communication_port ? ` (puerto :${after.communication_port})` : ''
      const critical = after.is_critical ? ' ⚡ crítico' : ''
      return `Infraestructura "${assetName}" vinculada a ${name} como capa "${tier}"${port}${critical}`
    }
    case 'INFRA_UNBIND': {
      const assetName = before.asset_id || '—'
      return `Infraestructura "${assetName}" desvinculada de ${name}`
    }
    // Servicios: componentes y endpoints
    case 'COMPONENT_ADD': {
      const appName = after.application_name || after.application_id || '—'
      const role = after.role || '—'
      return `Aplicación "${appName}" añadida como componente "${role}" al servicio ${name}`
    }
    case 'COMPONENT_REMOVE': {
      const appId = before.application_id || '—'
      return `Componente (app "${appId}") eliminado del servicio ${name}`
    }
    case 'ENDPOINT_ADD': {
      const url = after.url || '—'; const type = after.type || '—'
      return `Endpoint "${url}" (${type}) añadido al servicio ${name}`
    }
    case 'ENDPOINT_REMOVE': {
      const removedUrl = before.url || '—'
      return `Endpoint "${removedUrl}" eliminado del servicio ${name}`
    }
    // Dependencias
    case 'DEPENDENCY_ADD': {
      const tgtName = after.target_app_name || after.target_app_id || '—'
      const dtype = after.dep_type || '—'
      return `Dependencia "${dtype}": ${name} → "${tgtName}"`
    }
    case 'DEPENDENCY_REMOVE': {
      const tgtId = before.target_app_id || '—'
      return `Dependencia con "${tgtId}" eliminada de ${name}`
    }
    // Excepciones compliance
    case 'EXCEPTION_REVOKE': {
      // entity_name = "asset_name/indicador"
      const [assetPart, indicator] = (en||'').split('/')
      return `Excepción de "${indicator||'compliance'}" revocada para activo "${assetPart||en||'—'}"`
    }
    default:
      return `${TYPE_LABELS[t]||t} — ${etype} ${name}`
  }
}

/** Renderiza los changes de forma legible según el tipo de acción */
function ChangesView({ log }) {
  const { activity_type: t, changes: ch } = log
  if (!ch || Object.keys(ch).length === 0) return <p className="text-gray-500 text-sm italic">Sin cambios registrados.</p>

  // Para UPDATE: mostrar before/after de cada campo modificado
  if (t === 'UPDATE' && ch.changed) {
    return (
      <div className="space-y-2">
        {Object.entries(ch.changed).map(([field, {before, after}]) => (
          <div key={field} className="rounded-lg border border-gray-200 overflow-hidden">
            <div className="px-3 py-1 bg-gray-50 text-xs font-semibold text-gray-600 uppercase tracking-wide">{field}</div>
            <div className="grid grid-cols-2 divide-x divide-gray-200">
              <div className="px-3 py-2">
                <span className="text-[10px] text-red-500 font-semibold uppercase">Antes</span>
                <p className="text-sm text-gray-700 mt-0.5 break-words">{JSON.stringify(before) ?? '(vacío)'}</p>
              </div>
              <div className="px-3 py-2">
                <span className="text-[10px] text-green-600 font-semibold uppercase">Después</span>
                <p className="text-sm text-gray-800 font-medium mt-0.5 break-words">{JSON.stringify(after) ?? '(vacío)'}</p>
              </div>
            </div>
          </div>
        ))}
      </div>
    )
  }

  // Para CREATE/DELETE: mostrar los campos del objeto
  if ((t === 'CREATE' || t === 'DELETE') && (ch.added || ch.removed)) {
    const data = ch.added || ch.removed
    const isCreate = !!ch.added
    const keys = Object.keys(data).filter(k => data[k] !== null && data[k] !== undefined && data[k] !== false)
    return (
      <div className={`rounded-lg border ${isCreate ? 'border-green-200 bg-green-50' : 'border-red-200 bg-red-50'} p-3`}>
        <p className={`text-xs font-semibold ${isCreate ? 'text-green-700' : 'text-red-700'} mb-2`}>
          {isCreate ? '✚ Objeto creado' : '✖ Objeto eliminado'}
        </p>
        <div className="grid grid-cols-2 gap-x-6 gap-y-1">
          {keys.slice(0, 20).map(k => (
            <div key={k} className="flex gap-2 text-xs">
              <span className="text-gray-500 shrink-0 w-28 truncate">{k}:</span>
              <span className="text-gray-800 font-medium truncate">
                {typeof data[k] === 'object' ? JSON.stringify(data[k]).slice(0,40) : String(data[k]).slice(0,60)}
              </span>
            </div>
          ))}
          {keys.length > 20 && <p className="text-xs text-gray-400 col-span-2">…y {keys.length-20} campos más</p>}
        </div>
      </div>
    )
  }

  // Para acciones de relación (INFRA_BIND, COMPONENT_ADD, etc.): mostrar los datos relevantes
  const sections = []
  if (ch.before && Object.keys(ch.before).length > 0) {
    sections.push({ label: 'Antes', color: 'red', data: ch.before })
  }
  if (ch.after && Object.keys(ch.after).length > 0) {
    sections.push({ label: 'Después / Datos', color: 'green', data: ch.after })
  }
  if (sections.length === 0) {
    // Mostrar el objeto directamente
    sections.push({ label: 'Datos', color: 'blue', data: ch })
  }

  return (
    <div className="space-y-2">
      {sections.map(({ label, color, data }) => {
        const cls = { red:'border-red-200 bg-red-50 text-red-700', green:'border-green-200 bg-green-50 text-green-700', blue:'border-blue-200 bg-blue-50 text-blue-700' }[color]
        return (
          <div key={label} className={`rounded-lg border ${cls} p-3`}>
            <p className="text-xs font-semibold mb-2">{label}</p>
            <div className="grid grid-cols-2 gap-x-6 gap-y-1">
              {Object.entries(data).map(([k, v]) => v !== null && v !== undefined && (
                <div key={k} className="flex gap-2 text-xs">
                  <span className="text-gray-500 shrink-0 w-32 truncate">{k}:</span>
                  <span className="text-gray-800 font-medium break-all">
                    {typeof v === 'object' ? JSON.stringify(v).slice(0,60) : String(v).slice(0,80)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}

export default function AuditPage() {
  const [activityType, setAT]     = useState('')
  const [userId, setUserId]       = useState('')
  const [dateFrom, setFrom]       = useState('')
  const [entityType, setEType]    = useState('')
  const [dateTo, setTo]           = useState('')
  const [page, setPage]           = useState(1)
  const [detail, setDetail]       = useState(null)

  const params = {
    activity_type: activityType||undefined,
    user_id:       userId||undefined,
    entity_type:   entityType||undefined,
    date_from:     dateFrom||undefined,
    date_to:       dateTo||undefined,
    page, page_size: 50,
  }
  const { data, isLoading } = useQuery({ queryKey:['audit',params], queryFn:()=>auditApi.list(params) })
  const logs = data?.data || []; const total = data?.total || 0

  return (
    <div className="p-6 space-y-4">
      <div>
        <h1 className="text-xl font-bold text-gray-900">Auditoría</h1>
        <p className="text-xs text-gray-500 mt-0.5">{total} registros — trazabilidad completa de cambios</p>
      </div>

      {/* Filtros */}
      <div className="card p-3 flex flex-wrap gap-3 items-end">
        <div>
          <label className="text-[10px] text-gray-500 uppercase font-semibold block mb-1">Tipo de acción</label>
          <select className="input text-sm w-48" value={activityType} onChange={e=>{setAT(e.target.value);setPage(1)}}>
            <option value="">Todas las acciones</option>
            {TYPES.map(t=><option key={t} value={t}>{TYPE_LABELS[t]||t}</option>)}
          </select>
        </div>
        <div>
          <label className="text-[10px] text-gray-500 uppercase font-semibold block mb-1">Tipo de entidad</label>
          <select className="input text-sm w-40" value={entityType} onChange={e=>{setEType(e.target.value);setPage(1)}}>
            <option value="">Todas</option>
            {['asset','application','service','tag','certificate','exception',
              'eol_product','eol_cycle','zone','site','cell','data_source','user'].map(e=>(
              <option key={e} value={e}>{ENTITY_ICONS[e]||'📋'} {e}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-[10px] text-gray-500 uppercase font-semibold block mb-1">Usuario</label>
          <input className="input text-sm w-36" placeholder="username…" value={userId}
            onChange={e=>{setUserId(e.target.value);setPage(1)}}/>
        </div>
        <div>
          <label className="text-[10px] text-gray-500 uppercase font-semibold block mb-1">Desde</label>
          <input type="datetime-local" className="input text-sm w-44" value={dateFrom}
            onChange={e=>{setFrom(e.target.value);setPage(1)}}/>
        </div>
        <div>
          <label className="text-[10px] text-gray-500 uppercase font-semibold block mb-1">Hasta</label>
          <input type="datetime-local" className="input text-sm w-44" value={dateTo}
            onChange={e=>{setTo(e.target.value);setPage(1)}}/>
        </div>
        <button className="btn-secondary text-sm" onClick={()=>{setAT('');setUserId('');setFrom('');setTo('');setEType('');setPage(1)}}>
          Limpiar
        </button>
      </div>

      {/* Tabla */}
      <div className="card overflow-hidden">
        {isLoading ? <TableSkeleton rows={8} cols={6}/> : logs.length===0 ? <Empty message="No hay registros de auditoría"/> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-gray-500 uppercase bg-gray-50 border-b-2 border-gray-200">
                  <th className="px-4 py-3 text-left font-semibold">Fecha</th>
                  <th className="px-4 py-3 text-left font-semibold">Usuario</th>
                  <th className="px-4 py-3 text-left font-semibold">Acción</th>
                  <th className="px-4 py-3 text-left font-semibold">Entidad</th>
                  <th className="px-4 py-3 text-left font-semibold">Descripción</th>
                  <th className="px-4 py-3 text-right font-semibold">IP</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {logs.map(l => (
                  <tr key={l.id} className="hover:bg-blue-50/40 cursor-pointer transition-colors" onClick={()=>setDetail(l)}>
                    <td className="px-4 py-3 text-xs text-gray-500 whitespace-nowrap">
                      {l.timestamp ? format(new Date(l.timestamp),'dd/MM/yy HH:mm:ss',{locale:es}) : '—'}
                    </td>
                    <td className="px-4 py-3">
                      <span className="font-medium text-gray-800">{l.username || l.user_id || 'system'}</span>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`badge text-[11px] ${TYPE_COLORS[l.activity_type]||'bg-gray-100 text-gray-600'}`}>
                        {TYPE_LABELS[l.activity_type] || l.activity_type}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs">
                      <span className="text-gray-500">{ENTITY_ICONS[l.entity_type]||'📋'} {l.entity_type||'—'}</span>
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-700 max-w-xs truncate">
                      {describeAction(l)}
                    </td>
                    <td className="px-4 py-3 text-right text-[10px] text-gray-400 font-mono">
                      {l.ip_address||'—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {total > 50 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-gray-100 text-sm text-gray-600">
            <span className="text-xs">{(page-1)*50+1}–{Math.min(page*50,total)} de {total} registros</span>
            <div className="flex gap-2">
              <button className="btn-secondary text-xs" disabled={page===1} onClick={()=>setPage(p=>p-1)}>Anterior</button>
              <button className="btn-secondary text-xs" disabled={page*50>=total} onClick={()=>setPage(p=>p+1)}>Siguiente</button>
            </div>
          </div>
        )}
      </div>

      {/* Modal detalle */}
      <Modal open={!!detail} onClose={()=>setDetail(null)} title="Detalle del registro de auditoría" maxW="max-w-3xl">
        {detail && (
          <div className="space-y-4">
            {/* Cabecera */}
            <div className="grid grid-cols-2 gap-4 p-4 bg-gray-50 rounded-xl border border-gray-200">
              <div className="space-y-0.5">
                <p className="text-[10px] text-gray-500 uppercase font-semibold">Tipo de acción</p>
                <span className={`badge ${TYPE_COLORS[detail.activity_type]||'bg-gray-100 text-gray-600'}`}>
                  {TYPE_LABELS[detail.activity_type] || detail.activity_type}
                </span>
              </div>
              <div className="space-y-0.5">
                <p className="text-[10px] text-gray-500 uppercase font-semibold">Usuario</p>
                <p className="font-semibold text-gray-900">{detail.username || detail.user_id || '—'}</p>
                {detail.ip_address && <p className="text-xs text-gray-400 font-mono">{detail.ip_address}</p>}
              </div>
              <div className="space-y-0.5">
                <p className="text-[10px] text-gray-500 uppercase font-semibold">Entidad afectada</p>
                <p className="text-sm text-gray-800">
                  <span className="mr-1">{ENTITY_ICONS[detail.entity_type]||'📋'}</span>
                  <span className="capitalize font-medium">{detail.entity_type||'—'}</span>
                  {detail.entity_name && <span className="text-gray-600"> — {detail.entity_name}</span>}
                </p>
                {detail.entity_id && (
                  <p className="text-[10px] text-gray-400 font-mono">{detail.entity_id}</p>
                )}
              </div>
              <div className="space-y-0.5">
                <p className="text-[10px] text-gray-500 uppercase font-semibold">Fecha y hora</p>
                <p className="text-sm font-medium text-gray-900">
                  {detail.timestamp ? format(new Date(detail.timestamp),'dd/MM/yyyy HH:mm:ss',{locale:es}) : '—'}
                </p>
              </div>
            </div>

            {/* Descripción en lenguaje natural */}
            <div className="px-4 py-3 bg-blue-50 border border-blue-200 rounded-xl">
              <p className="text-[10px] text-blue-500 uppercase font-semibold mb-1">¿Qué ocurrió?</p>
              <p className="text-sm text-blue-900 font-medium">{describeAction(detail)}</p>
            </div>

            {/* Cambios */}
            {detail.changes && Object.keys(detail.changes).length > 0 && (
              <div>
                <p className="text-[10px] text-gray-500 uppercase font-semibold mb-2">Detalle de cambios</p>
                <ChangesView log={detail}/>
              </div>
            )}
          </div>
        )}
      </Modal>
    </div>
  )
}
