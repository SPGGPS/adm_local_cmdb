import { useState, useRef, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { exceptionsApi, assetsApi } from '../services/api'
import { Modal, Spinner, Empty, TableSkeleton, IndicatorBadge, toast } from '../components/ui/index.jsx'
import { format } from 'date-fns'
import { es } from 'date-fns/locale/es'

const INDICATORS = ['edr','mon','siem','logs','bck','bckcl']
const STATUS_COLORS = {active:'bg-blue-100 text-blue-700 border border-blue-300',revoked:'bg-gray-100 text-gray-600 border border-gray-300',expired:'bg-amber-100 text-amber-700 border border-amber-300'}
const STATUS_LABELS = {active:'Activa',revoked:'Revocada',expired:'Expirada'}
const MIN_DESC = 20

function MultiAssetSelector({ indicator, value, onChange }) {
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState(new Set(value.map(a=>a.id)))

  const { data: activeExcs } = useQuery({
    queryKey: ['exceptions','active-for-indicator', indicator],
    queryFn: () => indicator ? exceptionsApi.list({status:'active',page_size:200}) : Promise.resolve({data:[]}),
    enabled: !!indicator,
  })
  const blockedIds = new Set((activeExcs?.data||[]).filter(e => e.indicator === indicator).map(e => e.asset_id))

  const { data: assetsResult } = useQuery({
    queryKey: ['assets-exc-search', search, indicator],
    queryFn: () => assetsApi.list({search: search === '*' ? '' : search, page_size: 50}),
    enabled: true,
  })
  const assets = assetsResult?.data || assetsResult || []

  const toggle = (asset) => {
    const blocked = blockedIds.has(asset.id)
    if (blocked) return
    const n = new Set(selected)
    if (n.has(asset.id)) { n.delete(asset.id); onChange(value.filter(a=>a.id!==asset.id)) }
    else { n.add(asset.id); onChange([...value, asset]) }
    setSelected(n)
  }

  const TYPE_ICON = {server_physical:'🖥',server_virtual:'💻',switch:'🔀',router:'🌐',ap:'📡',database:'🗄'}

  return (
    <div className="space-y-2">
      <input className="input" placeholder="Buscar activo… (deja vacío para ver todos)"
        value={search} onChange={e=>setSearch(e.target.value)}/>
      {value.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {value.map(a=>(
            <span key={a.id} className="badge border" style={{backgroundColor:'#FFF0F0',borderColor:'#F0CCCC',color:'#8B0016'}}>
              {a.name}
              <button className="ml-1 opacity-60 hover:opacity-100" onClick={()=>toggle(a)}>✕</button>
            </span>
          ))}
        </div>
      )}
      <div className="border rounded-lg overflow-hidden max-h-52 overflow-y-auto" style={{borderColor:'#E8CCCC'}}>
        {assets.length === 0 ? (
          <p className="text-xs text-gray-600 p-3 text-center">Sin resultados</p>
        ) : assets.map(a => {
          const blocked = blockedIds.has(a.id)
          const isSelected = selected.has(a.id)
          const typeStr = typeof a.type === 'string' ? a.type.split('.').pop() : (a.type||'')
          return (
            <label key={a.id}
              className={`flex items-center gap-3 px-3 py-2 cursor-pointer transition-colors border-b last:border-0 ${blocked?'opacity-40 cursor-not-allowed bg-gray-50':isSelected?'bg-red-50':'hover:bg-gray-50'}`}
              style={{borderColor:'#F0E8E8'}}>
              <input type="checkbox" className="accent-primary" checked={isSelected} disabled={blocked}
                onChange={()=>toggle(a)}/>
              <span className="text-sm">{TYPE_ICON[typeStr]||'📦'}</span>
              <span className="font-medium text-gray-800 flex-1">{a.name}</span>
              <span className="badge text-xs" style={{backgroundColor:'#F5F5F5',color:'#555',border:'1px solid #DDD'}}>{typeStr}</span>
              {a.ips?.[0] && <span className="text-xs text-gray-600 font-mono">{a.ips[0]}</span>}
              {blocked && <span className="text-xs text-amber-600">Ya tiene excepción</span>}
            </label>
          )
        })}
      </div>
      <p className="text-xs text-gray-600">{value.length} activo{value.length!==1?'s':''} seleccionado{value.length!==1?'s':''}</p>
    </div>
  )
}

function ExceptionForm({ onSubmit, loading, error }) {
  const [indicator, setIndicator]   = useState('')
  const [assets, setAssets]         = useState([])
  const [reasonCode, setReasonCode] = useState('')
  const [description, setDesc]      = useState('')
  const [expiresAt, setExpires]     = useState('')

  const { data: reasonCodes } = useQuery({ queryKey:['reason-codes'], queryFn: exceptionsApi.reasonCodes })

  const canSubmit = indicator && assets.length > 0 && reasonCode && description.trim().length >= MIN_DESC

  const handleSubmit = (e) => {
    e.preventDefault()
    if (!canSubmit) return
    onSubmit({
      asset_ids: assets.map(a => a.id),
      indicator,
      reason_code: reasonCode,
      description: description.trim(),
      expires_at: expiresAt ? new Date(expiresAt).toISOString() : null
    })
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {/* 1. Indicator first */}
      <div>
        <label className="block text-xs text-gray-600 font-medium mb-2">1. Indicador *</label>
        <div className="flex flex-wrap gap-2">
          {INDICATORS.map(ind => (
            <button key={ind} type="button" onClick={() => setIndicator(ind)}
              className={`px-3 py-1.5 rounded text-xs font-bold border transition-all ${indicator===ind ? 'bg-primary text-white border-primary' : 'bg-white text-gray-700 border-gray-300 hover:border-primary hover:text-primary'}`}>
              {ind.toUpperCase()}
            </button>
          ))}
        </div>
      </div>

      {/* 2. Assets */}
      <div>
        <label className="block text-xs text-gray-600 font-medium mb-1">2. Activo/s *</label>
        <MultiAssetSelector indicator={indicator} value={assets} onChange={setAssets}/>
      </div>

      {/* 3. Reason code */}
      <div>
        <label className="block text-xs text-gray-600 font-medium mb-1">3. Razón predefinida *</label>
        <select className="input w-full" value={reasonCode} onChange={e => setReasonCode(e.target.value)}>
          <option value="">Selecciona una razón…</option>
          {(reasonCodes||[]).map(r => <option key={r.code} value={r.code}>{r.label}</option>)}
        </select>
      </div>

      {/* 4. Description */}
      <div>
        <label className="block text-xs text-gray-600 font-medium mb-1">
          4. Descripción adicional *{' '}
          <span className={`ml-1 ${description.trim().length >= MIN_DESC ? 'text-green-600' : 'text-gray-600'}`}>
            ({description.trim().length}/{MIN_DESC} mínimo)
          </span>
        </label>
        <textarea className="input w-full h-20 resize-none"
          placeholder="Justificación específica del caso…"
          value={description} onChange={e => setDesc(e.target.value)} maxLength={2000}/>
      </div>

      {/* 5. Expiry */}
      <div>
        <label className="block text-xs text-gray-600 font-medium mb-1">5. Expira el (opcional — vacío = permanente)</label>
        <input type="datetime-local" className="input w-56" value={expiresAt} onChange={e => setExpires(e.target.value)}/>
      </div>

      {/* Error inline — modal stays open */}
      {error && (
        <div className="p-3 bg-red-50 border border-red-400 rounded-lg text-xs text-red-700">
          ⚠ {typeof error === 'string' ? error : error?.detail || 'Error al guardar. Inténtalo de nuevo.'}
        </div>
      )}

      <div className="flex justify-end">
        <button type="submit" className="btn-primary" disabled={!canSubmit || loading}>
          {loading ? <Spinner size="sm"/> : `Crear excepción${assets.length > 1 ? ` (${assets.length} activos)` : ''}`}
        </button>
      </div>
    </form>
  )
}

export default function ExceptionsPage() {
  const qc = useQueryClient()
  const [showForm, setShowForm]   = useState(false)
  const [revokeTarget, setRevoke] = useState(null)
  const [formError, setFormError] = useState(null)
  const [selected, setSelected]   = useState(new Set())
  const [sortBy, setSortBy]       = useState('created_at')
  const [sortOrder, setSortOrder] = useState('desc')

  const { data: active, isLoading } = useQuery({
    queryKey: ['exceptions','active'],
    queryFn: () => exceptionsApi.list({status:'active',page_size:100}),
  })
  const { data: history } = useQuery({
    queryKey: ['exceptions','history'],
    queryFn: () => exceptionsApi.list({status:'all',page_size:200}),
  })

  const createMutation = useMutation({
    mutationFn: exceptionsApi.create,
    onSuccess: (data) => {
      qc.invalidateQueries({queryKey:['exceptions']}); qc.invalidateQueries({queryKey:['assets'],exact:false}); qc.invalidateQueries({queryKey:['dashboard']})
      setShowForm(false); setFormError(null)
      toast(`${data.created} excepción${data.created!==1?'es':''} creada${data.created!==1?'s':''}${data.skipped>0?`, ${data.skipped} omitida${data.skipped!==1?'s':''}`:''}.`)
    },
    onError: (e) => {
      // Keep modal open, show error inline
      setFormError(e.data?.detail || e.message || 'Error al guardar. Inténtalo de nuevo.')
    },
  })

  const handleCreate = (body) => {
    setFormError(null)
    createMutation.mutate(body)
  }

  const revokeMutation = useMutation({
    mutationFn: (id) => exceptionsApi.revoke(id),
    onSuccess: () => {
      qc.invalidateQueries({queryKey:['exceptions']}); qc.invalidateQueries({queryKey:['assets'],exact:false}); qc.invalidateQueries({queryKey:['dashboard']})
      toast('Excepción revocada'); setRevoke(null)
    },
    onError: (e) => toast(e.message, 'error'),
  })

  const bulkRevokeMutation = useMutation({
    mutationFn: async (ids) => {
      for (const id of ids) await exceptionsApi.revoke(id)
    },
    onSuccess: () => {
      qc.invalidateQueries({queryKey:['exceptions']}); qc.invalidateQueries({queryKey:['assets'],exact:false}); qc.invalidateQueries({queryKey:['dashboard']})
      toast(`${selected.size} excepción${selected.size!==1?'es':''} revocada${selected.size!==1?'s':''}`)
      setSelected(new Set())
    },
    onError: (e) => toast(e.message,'error'),
  })

  const activeList  = active?.data || []
  const historyList = (history?.data || []).filter(e => e.status !== 'active')

  // Sort activeList
  const sortedActive = [...activeList].sort((a,b) => {
    let va = a[sortBy], vb = b[sortBy]
    // nulls always last regardless of direction
    const aNul = va == null || va === ''
    const bNul = vb == null || vb === ''
    if (aNul && bNul) return 0
    if (aNul) return 1
    if (bNul) return -1
    // Normalizar cadenas para comparación
    if (typeof va === 'string' && typeof vb === 'string') {
      const cmpStr = va.localeCompare(vb, 'es', { sensitivity: 'base' })
      return sortOrder === 'asc' ? cmpStr : -cmpStr
    }
    // fechas y números
    const cmpNum = va < vb ? -1 : va > vb ? 1 : 0
    return sortOrder === 'asc' ? cmpNum : -cmpNum
  })

  const toggleSelectAll = () => setSelected(s => s.size===sortedActive.length ? new Set() : new Set(sortedActive.map(e=>e.id)))
  const toggleSelect = (id) => setSelected(s => { const n=new Set(s); n.has(id)?n.delete(id):n.add(id); return n })

  const SortTh = ({field, label}) => (
    <th className="px-4 py-3 text-left cursor-pointer hover:text-gray-700 transition-colors select-none"
      onClick={()=>{ if(sortBy===field) setSortOrder(o=>o==='asc'?'desc':'asc'); else {setSortBy(field);setSortOrder('asc')} }}>
      <span className="flex items-center gap-1 text-xs text-gray-600 uppercase tracking-wider">
        {label}
        {sortBy===field ? (sortOrder==='asc'?'↑':'↓') : <span className="opacity-50 text-gray-600">↕</span>}
      </span>
    </th>
  )

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Excepciones de Compliance</h1>
          <p className="text-xs text-gray-600 mt-0.5">{activeList.length} excepción{activeList.length!==1?'es':''} activa{activeList.length!==1?'s':''}</p>
        </div>
        <div className="flex items-center gap-2">
          {selected.size > 0 && (
            <button className="btn-danger" disabled={bulkRevokeMutation.isPending}
              onClick={()=>{ if(confirm(`¿Revocar ${selected.size} excepción${selected.size!==1?'es':''}?`)) bulkRevokeMutation.mutate([...selected]) }}>
              {bulkRevokeMutation.isPending ? <Spinner size="sm"/> : `Revocar seleccionadas (${selected.size})`}
            </button>
          )}
          <button className="btn-primary" onClick={() => { setShowForm(true); setFormError(null) }}>+ Nueva excepción</button>
        </div>
      </div>

      <div className="card p-4 text-sm flex gap-3" style={{backgroundColor:"#EFF6FF",border:"1px solid #BFDBFE"}}>
        <span className="text-lg shrink-0">🔵</span>
        <div>
          <p className="font-medium mb-1 text-blue-800">¿Para qué sirven las excepciones?</p>
          <p className="text-xs text-blue-700">Cuando un activo no puede cumplir un indicador por razones justificadas (ej. un switch sin EDR), se crea una excepción. El badge pasa de <span className="text-red-700">rojo</span> a <span className="text-blue-700 font-semibold">azul</span>.</p>
        </div>
      </div>

      <div className="card overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-800 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-gray-700">Excepciones activas ({activeList.length})</h2>
          {selected.size > 0 && <span className="text-xs text-gray-600">{selected.size} seleccionada{selected.size!==1?'s':''}</span>}
        </div>
        {isLoading ? <TableSkeleton rows={4} cols={7}/> : activeList.length === 0 ? <Empty message="No hay excepciones activas"/> : (
          <table className="w-full text-sm">
            <thead><tr className="border-b border-gray-100">
              <th className="px-4 py-3 w-10">
                <input type="checkbox" className="accent-primary"
                  checked={selected.size===sortedActive.length && sortedActive.length>0}
                  onChange={toggleSelectAll}/>
              </th>
              <SortTh field="asset_name" label="Activo"/>
              <SortTh field="indicator" label="Indicador"/>
              <th className="px-4 py-3 text-left text-xs text-gray-600 uppercase tracking-wider">Motivo</th>
              <SortTh field="created_by_name" label="Creada por"/>
              <SortTh field="created_at" label="Fecha"/>
              <SortTh field="expires_at" label="Expira"/>
              <th className="px-4 py-3 text-right text-xs text-gray-600 uppercase tracking-wider">Acción</th>
            </tr></thead>
            <tbody className="divide-y divide-gray-100">
              {sortedActive.map(e => (
                <tr key={e.id} className={`hover:bg-red-50/50 transition-colors ${selected.has(e.id)?'bg-primary/5':''}`}>
                  <td className="px-4 py-3">
                    <input type="checkbox" className="accent-primary" checked={selected.has(e.id)} onChange={()=>toggleSelect(e.id)}/>
                  </td>
                  <td className="px-4 py-3 font-medium text-gray-900">{e.asset_name}</td>
                  <td className="px-4 py-3"><IndicatorBadge indicator={e.indicator}/></td>
                  <td className="px-4 py-3 text-gray-600 text-xs max-w-xs"><span className="line-clamp-2" title={e.reason}>{e.reason}</span></td>
                  <td className="px-4 py-3 text-gray-600 text-xs">{e.created_by_name}</td>
                  <td className="px-4 py-3 text-xs text-gray-600">{e.created_at?format(new Date(e.created_at),'dd/MM/yyyy HH:mm',{locale:es}):'—'}</td>
                  <td className="px-4 py-3 text-xs">{e.expires_at?<span className={`${new Date(e.expires_at)<new Date(Date.now()+7*86400000)?'text-orange-600':new Date(e.expires_at)<new Date()?'text-red-600':'text-gray-600'}`}>{format(new Date(e.expires_at),'dd/MM/yyyy',{locale:es})}</span>:<span className="text-gray-500 italic">Sin fecha</span>}</td>
                  <td className="px-4 py-3 text-right"><button className="btn-danger text-xs" onClick={()=>setRevoke(e)}>Revocar</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {historyList.length > 0 && (
        <div className="card overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-100"><h2 className="text-sm font-semibold text-gray-700">Historial ({historyList.length})</h2></div>
          <table className="w-full text-sm">
            <thead><tr className="text-xs text-gray-600 uppercase" style={{backgroundColor:"#F3F4F6",borderBottom:"2px solid #E5E7EB"}}>
              <th className="px-4 py-3 text-left">Activo</th><th className="px-4 py-3 text-left">Indicador</th>
              <th className="px-4 py-3 text-left">Motivo</th><th className="px-4 py-3 text-left">Estado</th>
              <th className="px-4 py-3 text-left">Revocada por</th><th className="px-4 py-3 text-left">Fecha revocación</th>
            </tr></thead>
            <tbody className="divide-y divide-gray-100">
              {historyList.map(e => (
                <tr key={e.id} className="hover:bg-gray-50/70 opacity-70">
                  <td className="px-4 py-3 text-gray-600">{e.asset_name}</td>
                  <td className="px-4 py-3"><IndicatorBadge indicator={e.indicator}/></td>
                  <td className="px-4 py-3 text-gray-600 text-xs max-w-xs truncate">{e.reason}</td>
                  <td className="px-4 py-3"><span className={`badge text-xs border ${STATUS_COLORS[e.status]}`}>{STATUS_LABELS[e.status]}</span></td>
                  <td className="px-4 py-3 text-xs text-gray-600">{e.revoked_by_name||'—'}</td>
                  <td className="px-4 py-3 text-xs text-gray-600">{e.revoked_at?format(new Date(e.revoked_at),'dd/MM/yyyy HH:mm',{locale:es}):'—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Modal open={showForm} onClose={() => { setShowForm(false); setFormError(null) }} title="Nueva excepción de compliance" maxW="max-w-2xl">
        <ExceptionForm onSubmit={handleCreate} loading={createMutation.isPending} error={formError}/>
      </Modal>

      <Modal open={!!revokeTarget} onClose={() => setRevoke(null)} title="Revocar excepción" maxW="max-w-sm">
        {revokeTarget && (
          <div className="space-y-4">
            <div className="card p-3 bg-gray-50 space-y-2">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-gray-800">{revokeTarget.asset_name}</span>
                <IndicatorBadge indicator={revokeTarget.indicator}/>
              </div>
              <p className="text-xs text-gray-600">{revokeTarget.reason}</p>
              <p className="text-xs text-gray-700">Creada por {revokeTarget.created_by_name}</p>
            </div>
            <p className="text-sm text-amber-400">⚠ Al revocar, el badge volverá a rojo en el inventario.</p>
            <div className="flex justify-end gap-2">
              <button className="btn-secondary" onClick={() => setRevoke(null)}>Cancelar</button>
              <button className="btn-danger" disabled={revokeMutation.isPending} onClick={() => revokeMutation.mutate(revokeTarget.id)}>
                {revokeMutation.isPending ? <Spinner size="sm"/> : 'Confirmar revocación'}
              </button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}
