import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { dataSourcesApi } from '../services/api'
import { Modal, Spinner, Empty, TableSkeleton, toast } from '../components/ui/index.jsx'
import { format } from 'date-fns'

const TYPES=['vmware','veeam','edr','monitoring','monica','api','database','manual']
const STATUS_COLORS={active:'text-green-400',inactive:'text-gray-600',error:'text-red-600',stale:'text-amber-400'}
const STATUS_DOT={active:'bg-green-500',inactive:'bg-gray-600',error:'bg-red-500',stale:'bg-amber-400'}

function DSForm({ initial={}, onSubmit, loading }) {
  const [name,setName]=useState(initial.name||'')
  const [type,setType]=useState(initial.type||'api')
  const [desc,setDesc]=useState(initial.description||'')
  const [active,setActive]=useState(initial.is_active??true)
  const [interval,setInt]=useState(initial.sync_interval_minutes||60)
  const submit=(e)=>{e.preventDefault();onSubmit({name,type,description:desc,is_active:active,sync_interval_minutes:Number(interval)})}
  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <div><label className="block text-xs text-gray-600 font-medium mb-1">Nombre *</label><input required className="input" value={name} onChange={e=>setName(e.target.value)} maxLength={100}/></div>
        <div><label className="block text-xs text-gray-600 font-medium mb-1">Tipo *</label><select required className="input" value={type} onChange={e=>setType(e.target.value)}>{TYPES.map(t=><option key={t} value={t}>{t}</option>)}</select></div>
      </div>
      <div><label className="block text-xs text-gray-600 font-medium mb-1">Descripción</label><input className="input" value={desc} onChange={e=>setDesc(e.target.value)} maxLength={500}/></div>
      <div className="flex items-center gap-4">
        <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer"><input type="checkbox" checked={active} onChange={e=>setActive(e.target.checked)} className="accent-primary"/>Activa</label>
        <div><label className="block text-xs text-gray-600 font-medium mb-1">Intervalo sync (min)</label><input type="number" className="input w-24" value={interval} min={1} onChange={e=>setInt(e.target.value)}/></div>
      </div>
      <div className="flex justify-end"><button type="submit" className="btn-primary" disabled={loading}>{loading?<Spinner size="sm"/>:'Guardar'}</button></div>
    </form>
  )
}

function PendingPanel({ ds, qc }) {
  const { data, isLoading } = useQuery({
    queryKey: ['ds-pending', ds.id],
    queryFn: () => dataSourcesApi.getPending(ds.id),
    enabled: !!ds.id,
  })
  const dismissM = useMutation({
    mutationFn: (assetId) => dataSourcesApi.dismissPending(ds.id, assetId),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['ds-pending', ds.id] }); toast('Marcado como revisado') }
  })
  if (isLoading) return <div className="p-4"><Spinner size="sm"/></div>
  const items = data?.items || []
  if (!items.length) return <div className="p-4 text-sm text-gray-500">No hay activos pendientes de revisión</div>
  return (
    <div className="divide-y divide-gray-100">
      {items.map(a => (
        <div key={a.id} className="p-3 space-y-2">
          <div className="flex items-start justify-between gap-2">
            <div>
              <p className="font-medium text-gray-900 text-sm">{a.name}</p>
              <p className="text-xs text-gray-500">{a.type} · {a.source} · IPs: {(a.ips||[]).join(', ')||'—'} · MAC: {a.mac_address||'—'}</p>
              {a.os && <p className="text-xs text-gray-500">OS: {a.os}</p>}
            </div>
            <button className="btn-secondary text-xs shrink-0" disabled={dismissM.isPending}
              onClick={() => dismissM.mutate(a.id)}>
              {dismissM.isPending ? <Spinner size="sm"/> : 'Confirmar nuevo'}
            </button>
          </div>
          {a.suggestions?.length > 0 && (
            <div className="bg-amber-50 border border-amber-200 rounded p-2">
              <p className="text-xs font-medium text-amber-700 mb-1">Posibles coincidencias:</p>
              <div className="space-y-1">
                {a.suggestions.map((s,i) => (
                  <p key={i} className="text-xs text-amber-800">
                    <span className="font-medium">{s.name}</span>
                    <span className="text-amber-600"> ({s.type} · {s.source}) — {s.reason}</span>
                  </p>
                ))}
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

const FIELD_LABELS = {
  os:'OS', cpu_count:'CPU', ram_gb:'RAM', mac_address:'MAC', ips:'IPs',
  vm_power_state:'Estado encendido', edr_health:'Salud EDR', edr_last_seen:'Visto EDR',
  last_backup_local:'Backup local', last_backup_cloud:'Backup cloud',
  product_name:'Producto', product_version:'Versión producto',
  vendor:'Fabricante', model:'Modelo', serial_number:'Nº serie',
  firmware_version:'Firmware', detected_services:'Servicios detectados',
  backup_last_status:'Estado backup', backup_restore_points:'Puntos restauración',
  description:'Descripción', location:'Ubicación',
}
function fieldLabel(f) { return FIELD_LABELS[f] || f.replace(/_/g,' ') }

const MATCH_BY_LABELS = { mac: 'MAC', name: 'nombre', ip: 'IP', id: 'ID' }
const SIGNAL_LABELS   = { name: 'Nombre', mac: 'MAC', ips: 'IPs' }

// Razón humana de la discrepancia: cómo se encontró el activo + qué campo no cuadra
const DIFF_REASONS = {
  'mac:name': 'Identificado por MAC pero el nombre difiere — el equipo puede haberse renombrado.',
  'mac:ips':  'Identificado por MAC pero las IPs difieren — el equipo puede haber cambiado de red.',
  'mac:mac':  'Identificado por MAC pero la MAC difiere — posible conflicto de NIC.',
  'name:mac': 'Identificado por nombre pero la MAC difiere — puede haberse cambiado la tarjeta de red o ser otro equipo con el mismo nombre.',
  'name:ips': 'Identificado por nombre pero las IPs difieren — el equipo puede haberse movido de red.',
  'name:name':'Identificado por nombre pero el nombre reportado es diferente (diferencia en mayúsculas / FQDN).',
  'ip:name':  'Identificado por IP pero el nombre difiere — posible renombre o colisión de IP.',
  'ip:mac':   'Identificado por IP pero la MAC difiere — la NIC o la IP han sido reasignadas.',
  'ip:ips':   'Identificado por IP pero el conjunto de IPs no coincide.',
}

function diffReason(matchBy, field) {
  return DIFF_REASONS[`${matchBy}:${field}`] || null
}

function DiffsPanel({ ds }) {
  const { data, isLoading } = useQuery({
    queryKey: ['ds-diffs', ds.id],
    queryFn: () => dataSourcesApi.getDiffs(ds.id),
    enabled: !!ds.id,
  })
  if (isLoading) return <div className="p-4"><Spinner size="sm"/></div>
  const items = data?.items || []
  if (!items.length) return <div className="p-4 text-sm text-gray-500">No se detectaron conflictos de identidad</div>
  return (
    <div className="divide-y divide-gray-100">
      {items.map((item, idx) => (
        <div key={idx} className="p-3 space-y-2">
          <div>
            <p className="font-medium text-gray-900 text-sm">{item.asset_name}</p>
            <p className="text-xs text-gray-500">
              {item.asset_type} · fuente: <span className="font-medium">{item.asset_source}</span>
              {' · '}detectado por: <span className="font-medium">{item.reporting_source}</span>
              {item.match_by && <> · match por: <span className="font-medium font-mono">{MATCH_BY_LABELS[item.match_by] || item.match_by}</span></>}
            </p>
            {item.last_seen && <p className="text-xs text-gray-400">Última detección: {format(new Date(item.last_seen), 'dd/MM/yy HH:mm')}</p>}
          </div>
          <div className="space-y-1">
            {(item.diffs||[]).map((d,i) => {
              const reason = diffReason(item.match_by, d.field)
              return (
                <div key={i} className="bg-amber-50 border border-amber-200 rounded p-2 text-xs space-y-1">
                  <div>
                    <span className="font-medium text-amber-800">{SIGNAL_LABELS[d.field] || d.field}:</span>
                    {d.field === 'ips' ? (
                      <span className="text-amber-700">
                        {' '}actual=<span className="font-mono">{Array.isArray(d.current) ? d.current.join(', ') : String(d.current ?? '—')}</span>
                        {' · '}reportado=<span className="font-mono">{Array.isArray(d.reported) ? d.reported.join(', ') : String(d.reported ?? '—')}</span>
                      </span>
                    ) : (
                      <span className="text-amber-700"> actual=<span className="font-mono">{String(d.current ?? '—')}</span> · reportado=<span className="font-mono">{String(d.reported ?? '—')}</span></span>
                    )}
                  </div>
                  {reason && (
                    <p className="text-amber-600 italic">💡 {reason}</p>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      ))}
    </div>
  )
}

function HistorialPanel({ ds }) {
  const [expanded, setExpanded] = useState(null)
  const { data, isLoading } = useQuery({
    queryKey: ['ds-runs', ds.id],
    queryFn: () => dataSourcesApi.getRuns(ds.id),
    enabled: !!ds.id,
  })
  const { data: detail } = useQuery({
    queryKey: ['ds-run-detail', ds.id, expanded],
    queryFn: () => dataSourcesApi.getRunDetail(ds.id, expanded),
    enabled: !!expanded,
  })
  if (isLoading) return <div className="p-4"><Spinner size="sm"/></div>
  const runs = data?.items || []
  if (!runs.length) return <div className="p-4 text-sm text-gray-500">No hay cargas registradas</div>
  const hasDetail = r => r.created_count > 0 || r.updated_count > 0 || r.matched_count > 0 || r.skipped_count > 0
  return (
    <div className="divide-y divide-gray-100">
      {runs.map(r => (
        <div key={r.id}>
          <div className="flex items-center justify-between p-3 hover:bg-gray-50">
            <div>
              <div className="flex items-center gap-2">
                <p className="text-sm font-medium text-gray-900">{format(new Date(r.run_at), 'dd/MM/yyyy HH:mm:ss')}</p>
                {r.label && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-indigo-50 text-indigo-700 border border-indigo-200 font-mono">
                    {r.label}
                  </span>
                )}
              </div>
              <p className="text-xs text-gray-500 mt-0.5">
                {r.created_count > 0 && <span className="text-green-600 font-medium">+{r.created_count} {ds.type === 'vmware' ? 'nuevos' : 'sin machear'} </span>}
                {r.updated_count > 0 && <span className="text-blue-600 font-medium">↑{r.updated_count} actualizados </span>}
                {r.matched_count > 0 && <span className="text-gray-500 font-medium">={r.matched_count} machados </span>}
                {r.skipped_count > 0 && <span className="text-red-500 font-medium">✗{r.skipped_count} no insertados </span>}
                {r.created_count === 0 && r.updated_count === 0 && r.matched_count === 0 && !r.skipped_count && <span className="text-gray-400">sin cambios</span>}
              </p>
            </div>
            {hasDetail(r) && (
              <button className="btn-secondary text-xs"
                onClick={() => setExpanded(expanded === r.id ? null : r.id)}>
                {expanded === r.id ? 'Ocultar' : 'Ver activos'}
              </button>
            )}
          </div>
          {expanded === r.id && detail && (
            <div className="bg-gray-50 px-4 pb-3 max-h-96 overflow-y-auto space-y-2">
              {(detail.assets_created || []).length > 0 && (
                <div>
                  <p className="text-[10px] font-semibold text-green-700 uppercase tracking-wide pt-2 pb-1">
                    + {detail.assets_created.length} {ds.type === 'vmware' ? 'nuevos' : 'sin machear'}
                  </p>
                  <div className="space-y-0.5">
                    {detail.assets_created.map(a => (
                      <div key={a.id} className="flex items-center gap-2 text-xs py-0.5">
                        <span className="badge bg-green-50 text-green-700 border border-green-200">{a.type}</span>
                        <span className="text-gray-800 font-medium">{a.name}</span>
                        <span className="text-[10px] text-green-600">● {ds.type === 'vmware' ? 'nuevo' : 'sin machear'}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {(detail.assets_updated || []).length > 0 && (
                <div>
                  <p className="text-[10px] font-semibold text-blue-700 uppercase tracking-wide pt-2 pb-1">
                    ↑ {detail.assets_updated.length} actualizados
                  </p>
                  <div className="space-y-1.5">
                    {detail.assets_updated.map((a, i) => (
                      <div key={a.id ?? i} className="flex flex-col py-0.5 gap-1">
                        <div className="flex items-center gap-2 text-xs">
                          <span className="badge bg-blue-50 text-blue-700 border border-blue-200">{a.type}</span>
                          <span className="text-gray-700 font-medium">{a.name}</span>
                        </div>
                        <div className="ml-1 space-y-0.5">
                          {(a.changed_fields || []).map((cf, ci) => {
                            const isObj = cf && typeof cf === 'object'
                            const fieldName = isObj ? cf.field : cf
                            const oldVal = isObj ? cf.old : null
                            const newVal = isObj ? cf.new : null
                            return (
                              <div key={ci} className="flex items-center gap-1 text-[10px]">
                                <span className="px-1.5 py-0.5 rounded bg-blue-50 text-blue-700 border border-blue-200 font-medium shrink-0">
                                  {fieldLabel(fieldName)}
                                </span>
                                {oldVal !== null && oldVal !== undefined && (
                                  <>
                                    <span className="font-mono text-gray-400 truncate max-w-[120px]" title={String(oldVal)}>{String(oldVal)}</span>
                                    <span className="text-gray-400 shrink-0">→</span>
                                    <span className="font-mono text-gray-800 truncate max-w-[120px]" title={String(newVal ?? '')}>{String(newVal ?? '')}</span>
                                  </>
                                )}
                              </div>
                            )
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {(detail.assets_matched || []).length > 0 && (
                <div>
                  <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide pt-2 pb-1">
                    = {detail.assets_matched.length} machados sin cambios
                  </p>
                  <div className="space-y-0.5">
                    {detail.assets_matched.map((a, i) => (
                      <div key={a.id ?? i} className="flex items-center gap-2 text-xs py-0.5 opacity-70">
                        <span className="badge bg-gray-100 text-gray-500 border border-gray-200">{a.type}</span>
                        <span className="text-gray-600 font-medium">{a.name}</span>
                        <span className="text-[10px] text-gray-400">= sin cambios</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {(detail.assets_skipped || []).length > 0 && (
                <div>
                  <p className="text-[10px] font-semibold text-red-600 uppercase tracking-wide pt-2 pb-1">
                    ✗ {detail.assets_skipped.length} no insertados — conflicto de MAC
                  </p>
                  <div className="bg-red-50 border border-red-200 rounded p-2 space-y-1.5">
                    <p className="text-[10px] text-red-700 mb-1">
                      Estas máquinas no se insertaron porque su dirección MAC ya está registrada en otro activo.
                      Esto ocurre habitualmente con clones o restauraciones en VMware que heredan la MAC original.
                      Revisa el origen y elimina o renombra el duplicado.
                    </p>
                    {detail.assets_skipped.map((a, i) => (
                      <div key={i} className="flex flex-col gap-0.5 text-xs py-0.5">
                        <div className="flex items-center gap-2">
                          <span className="badge bg-red-100 text-red-700 border border-red-300">no insertado</span>
                          <span className="font-medium text-red-800">{a.name}</span>
                        </div>
                        <div className="ml-1 text-[10px] text-red-600">
                          MAC <span className="font-mono">{a.mac}</span> ya usada por{' '}
                          <span className="font-medium">{a.conflicts_with}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

function DSReviewDrawer({ ds, onClose, qc }) {
  const [tab, setTab] = useState('runs')
  return (
    <div className="fixed inset-0 z-40 flex justify-end" onClick={onClose}>
      <div className="w-full max-w-lg bg-white shadow-xl flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between p-4 border-b">
          <div>
            <p className="font-semibold text-gray-900">{ds.name}</p>
            <p className="text-xs text-gray-500">Historial, sin machear y discrepancias</p>
          </div>
          <button className="text-gray-400 hover:text-gray-700 text-xl font-bold" onClick={onClose}>✕</button>
        </div>
        <div className="flex border-b text-sm">
          {[{k:'runs',label:'Historial'},{k:'pending',label:'Sin machear'},{k:'diffs',label:'Discrepancias'}].map(t=>(
            <button key={t.k} onClick={()=>setTab(t.k)}
              className={`px-4 py-2 font-medium border-b-2 transition-colors ${tab===t.k?'border-primary text-primary':'border-transparent text-gray-500 hover:text-gray-700'}`}>
              {t.label}
            </button>
          ))}
        </div>
        <div className="flex-1 overflow-y-auto">
          {tab==='runs' && <HistorialPanel ds={ds}/>}
          {tab==='pending' && <PendingPanel ds={ds} qc={qc}/>}
          {tab==='diffs' && <DiffsPanel ds={ds}/>}
        </div>
      </div>
    </div>
  )
}

export default function DataSourcesPage() {
  const qc=useQueryClient()
  const [createOpen,setCreate]=useState(false)
  const [editDs,setEdit]=useState(null)
  const [deleteDs,setDelete]=useState(null)
  const [validating,setValidating]=useState(null)
  const [validResult,setValidResult]=useState(null)
  const [reviewDs,setReview]=useState(null)

  const {data:sources=[],isLoading}=useQuery({queryKey:['data-sources'],queryFn:dataSourcesApi.list})
  const createM=useMutation({mutationFn:dataSourcesApi.create,onSuccess:()=>{qc.invalidateQueries({queryKey:['data-sources']});setCreate(false);toast('Fuente creada')}})
  const updateM=useMutation({mutationFn:({id,data})=>dataSourcesApi.update(id,data),onSuccess:()=>{qc.invalidateQueries({queryKey:['data-sources']});setEdit(null);toast('Fuente actualizada')}})
  const deleteM=useMutation({mutationFn:dataSourcesApi.delete,onSuccess:()=>{qc.invalidateQueries({queryKey:['data-sources']});setDelete(null);toast('Fuente eliminada')}})

  const handleValidate=async(ds)=>{
    setValidating(ds.id);setValidResult(null)
    const r=await dataSourcesApi.validate(ds.id).catch(e=>({success:false,message:e.message}))
    setValidResult({ds,result:r});setValidating(null)
  }

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div><h1 className="text-xl font-bold text-gray-900">Fuentes de Datos</h1><p className="text-xs text-gray-600 mt-0.5">{sources.length} fuentes configuradas</p></div>
        <button className="btn-primary" onClick={()=>setCreate(true)}>+ Nueva fuente</button>
      </div>
      <div className="card overflow-hidden">
        {isLoading?<TableSkeleton rows={5} cols={6}/>:sources.length===0?<Empty message="No hay fuentes de datos"/>:(
          <table className="w-full text-sm">
            <thead><tr className="text-xs text-gray-600 uppercase" style={{backgroundColor:"#F3F4F6",borderBottom:"2px solid #E5E7EB"}}>
              <th className="px-4 py-3 text-left">Estado</th><th className="px-4 py-3 text-left">Nombre</th>
              <th className="px-4 py-3 text-left">Tipo</th><th className="px-4 py-3 text-left">Última sync</th>
              <th className="px-4 py-3 text-left">Activos</th><th className="px-4 py-3 text-left">Último sync</th><th className="px-4 py-3 text-right">Acciones</th>
            </tr></thead>
            <tbody className="divide-y divide-gray-100">
              {sources.map(ds=>(
                <tr key={ds.id} className="hover:bg-red-50/50">
                  <td className="px-4 py-3"><span className={`inline-flex items-center gap-1.5 text-xs ${STATUS_COLORS[ds.status]}`}><span className={`w-2 h-2 rounded-full ${STATUS_DOT[ds.status]}`}/>{ds.status}</span></td>
                  <td className="px-4 py-3"><p className="font-medium text-gray-900">{ds.name}</p>{ds.description&&<p className="text-xs text-gray-700">{ds.description}</p>}</td>
                  <td className="px-4 py-3"><span className="badge bg-gray-50 text-gray-700">{ds.type}</span></td>
                  <td className="px-4 py-3 text-xs text-gray-600">{ds.last_sync?format(new Date(ds.last_sync),'dd/MM HH:mm'):'—'}</td>
                  <td className="px-4 py-3 text-gray-600">{ds.asset_count}</td>
                  <td className="px-4 py-3 text-xs">
                    {ds.last_run_created == null && ds.last_run_updated == null ? (
                      <span className="text-gray-400">—</span>
                    ) : (
                      <span className="flex flex-col gap-0.5">
                        {ds.last_run_created > 0 && <span className="text-green-600 font-medium">+{ds.last_run_created} {ds.type === 'vmware' ? 'nuevos' : 'sin machear'}</span>}
                        {ds.last_run_updated > 0 && <span className="text-blue-600 font-medium">↑{ds.last_run_updated} actualizados</span>}
                        {ds.last_run_skipped > 0 && <span className="text-red-500 font-medium">✗{ds.last_run_skipped} omitidos</span>}
                        {ds.last_run_created === 0 && ds.last_run_updated === 0 && !ds.last_run_skipped && (
                          <span className="text-gray-400">sin cambios</span>
                        )}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right space-x-2">
                    <button className="btn-secondary text-xs" onClick={()=>setReview(ds)}>Revisión</button>
                    <button className="btn-secondary text-xs" disabled={validating===ds.id} onClick={()=>handleValidate(ds)}>{validating===ds.id?<Spinner size="sm"/>:'Validar'}</button>
                    <button className="btn-secondary text-xs" onClick={()=>setEdit(ds)}>Editar</button>
                    <button className="btn-danger text-xs" onClick={()=>setDelete(ds)}>Eliminar</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {validResult&&(
        <div className={`card p-4 border ${validResult.result.success?'border-green-800 bg-green-950/30':'border-red-800 bg-red-950/30'}`}>
          <div className="flex items-center justify-between">
            <div>
              <p className={`text-sm font-medium ${validResult.result.success?'text-green-400':'text-red-600'}`}>{validResult.result.success?'✓ Conexión OK':'✗ Error'} — {validResult.ds.name}</p>
              <p className="text-xs text-gray-600 mt-0.5">{validResult.result.message}</p>
            </div>
            <button className="text-gray-500 hover:text-gray-700" onClick={()=>setValidResult(null)}>✕</button>
          </div>
        </div>
      )}
      {reviewDs && <DSReviewDrawer ds={reviewDs} onClose={()=>setReview(null)} qc={qc}/>}
      <Modal open={createOpen} onClose={()=>setCreate(false)} title="Nueva fuente de datos"><DSForm onSubmit={createM.mutate} loading={createM.isPending}/></Modal>
      <Modal open={!!editDs} onClose={()=>setEdit(null)} title="Editar fuente de datos">{editDs&&<DSForm initial={editDs} onSubmit={data=>updateM.mutate({id:editDs.id,data})} loading={updateM.isPending}/>}</Modal>
      <Modal open={!!deleteDs} onClose={()=>setDelete(null)} title="Eliminar fuente" maxW="max-w-sm">
        {deleteDs&&<div className="space-y-4">
          <p className="text-sm text-gray-600">¿Eliminar <strong>{deleteDs.name}</strong>?</p>
          <p className="text-xs text-amber-400">⚠ Los activos perderán la referencia a esta fuente.</p>
          <div className="flex justify-end gap-2">
            <button className="btn-secondary" onClick={()=>setDelete(null)}>Cancelar</button>
            <button className="btn-danger" disabled={deleteM.isPending} onClick={()=>deleteM.mutate(deleteDs.id)}>{deleteM.isPending?<Spinner size="sm"/>:'Eliminar'}</button>
          </div>
        </div>}
      </Modal>
    </div>
  )
}
