import { useState, useEffect } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { applicationsApi, servicesApi, assetsApi, infraBindingsApi, locationsApi } from '../services/api'
import { colorBadgeStyle, TagBadge, Modal, Spinner, Empty, TableSkeleton, toast } from '../components/ui/index.jsx'
import { useAuth } from '../context/AuthContext'
import { Link } from 'react-router-dom'

// Tier constants
const TIER_LIST = [
  { value:'entry_point',  label:'Entrada',      order:1, color:'bg-blue-900/40 text-blue-300' },
  { value:'gateway',      label:'Gateway',      order:2, color:'bg-indigo-100 text-indigo-800 border border-indigo-400' },
  { value:'certificate',  label:'Certificado',  order:3, color:'bg-amber-900/40 text-amber-300' },
  { value:'application',  label:'Aplicación',   order:4, color:'bg-green-900/40 text-green-300' },
  { value:'auth',         label:'Auth',         order:4, color:'bg-orange-100 text-orange-800 border border-orange-400' },
  { value:'cache',        label:'Caché',        order:5, color:'bg-cyan-900/40 text-cyan-300' },
  { value:'data',         label:'Datos/BD',     order:5, color:'bg-cyan-900/40 text-cyan-300' },
  { value:'compute',      label:'Cómputo',      order:6, color:'bg-gray-100 text-gray-600' },
  { value:'storage',      label:'Storage',      order:7, color:'bg-gray-100 text-gray-600' },
  { value:'network',      label:'Red',          order:8, color:'bg-slate-800 text-slate-400' },
]
const TIER_MAP = Object.fromEntries(TIER_LIST.map(t=>[t.value,t]))

// Tabs
const TABS = ['Servicios','Aplicaciones','Mapa de Dependencias']

// Enums
const ENV_LABELS  = {production:'Producción',staging:'Staging',development:'Desarrollo',dr:'DR'}
const ENV_COLORS  = {
  production:  'bg-red-100 text-red-800 border border-red-400 font-semibold',
  staging:     'bg-orange-100 text-orange-800 border border-orange-400 font-semibold',
  development: 'bg-blue-100 text-blue-800 border border-blue-400 font-semibold',
  dr:          'bg-purple-100 text-purple-800 border border-purple-400 font-semibold',
}
const STATUS_APP = {
  active:      'bg-green-100 text-green-800 border border-green-500 font-semibold',
  maintenance: 'bg-amber-100 text-amber-800 border border-amber-500 font-semibold',
  deprecated:  'bg-gray-100 text-gray-700 border border-gray-400 font-semibold',
  inactive:    'bg-gray-100 text-gray-700 border border-gray-400 font-semibold',
}
const STATUS_APP_LABELS = {
  active:'Activa', maintenance:'Mantenimiento', deprecated:'Deprecada', inactive:'Inactiva',
}
const CRIT_COLORS = {
  critical: 'bg-red-100 text-red-800 border border-red-500 font-bold',
  high:     'bg-orange-100 text-orange-800 border border-orange-400 font-semibold',
  medium:   'bg-yellow-100 text-yellow-800 border border-yellow-400 font-semibold',
  low:      'bg-gray-100 text-gray-700 border border-gray-300 font-semibold',
}
const ROLE_COLORS = {
  frontend:       'bg-sky-100 text-sky-800 border border-sky-400',
  backend:        'bg-green-100 text-green-800 border border-green-400',
  api_gateway:    'bg-indigo-100 text-indigo-800 border border-indigo-400',
  auth:           'bg-orange-100 text-orange-800 border border-orange-400',
  worker:         'bg-yellow-100 text-yellow-800 border border-yellow-400',
  scheduler:      'bg-amber-100 text-amber-800 border border-amber-400',
  cache:          'bg-cyan-100 text-cyan-800 border border-cyan-400',
  cdn:            'bg-teal-100 text-teal-800 border border-teal-400',
  database_proxy: 'bg-orange-100 text-orange-800 border border-orange-400',
  message_broker: 'bg-purple-100 text-purple-800 border border-purple-400',
  monitoring:     'bg-slate-100 text-slate-700 border border-slate-400',
  ingress:        'bg-blue-100 text-blue-800 border border-blue-400',
  load_balancer:  'bg-blue-100 text-blue-800 border border-blue-300',
  other:          'bg-gray-100 text-gray-700 border border-gray-300',
}
const ROLES_LIST = [
  'frontend','backend','api_gateway','auth','worker','scheduler',
  'cache','cdn','database_proxy','message_broker','monitoring',
  'ingress','load_balancer','other',
]
const BINDING_COLORS = {
  runs_on:          'bg-slate-100 text-slate-700 border border-slate-400',
  hosted_on:        'bg-slate-100 text-slate-700 border border-slate-400',
  uses_database:    'bg-cyan-100 text-cyan-800 border border-cyan-400',
  uses_cache:       'bg-red-100 text-red-800 border border-red-400',
  load_balanced_by: 'bg-orange-100 text-orange-800 border border-orange-400',
  proxied_by:       'bg-indigo-100 text-indigo-800 border border-indigo-400',
  monitored_by:     'bg-green-100 text-green-800 border border-green-400',
  backed_up_by:     'bg-blue-100 text-blue-800 border border-blue-400',
}
const BINDINGS_LIST = [
  'runs_on','hosted_on','uses_database','uses_cache',
  'load_balanced_by','proxied_by','monitored_by','backed_up_by',
]
const DEP_COLORS = {
  calls_api:        'bg-blue-100 text-blue-800 border border-blue-400',
  authenticates_via:'bg-orange-100 text-orange-800 border border-orange-400',
  reads_from:       'bg-teal-100 text-teal-800 border border-teal-400',
  writes_to:        'bg-yellow-100 text-yellow-800 border border-yellow-400',
  publishes_to:     'bg-purple-100 text-purple-800 border border-purple-400',
  subscribes_to:    'bg-pink-100 text-pink-800 border border-pink-400',
  proxied_through:  'bg-indigo-100 text-indigo-800 border border-indigo-400',
  other:            'bg-gray-100 text-gray-700 border border-gray-300',
}
const DEPS_LIST   = ['calls_api','authenticates_via','reads_from','writes_to','publishes_to','subscribes_to','proxied_through','other']

const STATUS_SVC = {
  active:      'bg-green-100 text-green-800 border border-green-500 font-semibold',
  degraded:    'bg-orange-100 text-orange-800 border border-orange-500 font-semibold',
  maintenance: 'bg-amber-100 text-amber-800 border border-amber-500 font-semibold',
  inactive:    'bg-gray-100 text-gray-700 border border-gray-400 font-semibold',
}
const STATUS_SVC_LABELS = {
  active: 'Activo', degraded: 'Degradado', maintenance: 'Mantenimiento', inactive: 'Inactivo',
}

function Badge({ cls, label }) { return <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold ${cls}`}>{label}</span> }

// Application CRUD
function AppForm({ initial, onSubmit, loading }) {
  const initVal = initial || {}
  const [f, setF] = useState({
    name:'', environment:'production', status:'active', description:'',
    version:'', repo_url:'', docs_url:'', owner_team:'', tech_stack:[],
    cell_id:'', ...initVal, tech_stack: initVal.tech_stack || []
  })
  const [techInput, setTechInput] = useState('')
  const set = (k,v) => setF(p => ({...p,[k]:v}))
  const { data:cellsData } = useQuery({ queryKey:['cells'], queryFn:()=>locationsApi.listCells() })
  const cells = Array.isArray(cellsData) ? cellsData : []

  const addTech = (e) => {
    if ((e.key==='Enter'||e.key===',') && techInput.trim()) {
      e.preventDefault()
      if (!f.tech_stack.includes(techInput.trim())) set('tech_stack',[...f.tech_stack, techInput.trim()])
      setTechInput('')
    }
  }

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <div><label className="text-xs text-gray-600 font-medium block mb-1">Nombre *</label><input className="input" value={f.name} onChange={e=>set('name',e.target.value)}/></div>
        <div><label className="text-xs text-gray-600 font-medium block mb-1">Versión</label><input className="input" placeholder="2.1.0" value={f.version} onChange={e=>set('version',e.target.value)}/></div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div><label className="text-xs text-gray-600 font-medium block mb-1">Entorno</label>
          <select className="input" value={f.environment} onChange={e=>set('environment',e.target.value)}>
            {Object.entries(ENV_LABELS).map(([k,v])=><option key={k} value={k}>{v}</option>)}
          </select>
        </div>
        <div><label className="text-xs text-gray-600 font-medium block mb-1">Estado</label>
          <select className="input" value={f.status} onChange={e=>set('status',e.target.value)}>
            <option value="active">Activa</option><option value="maintenance">Mantenimiento</option>
            <option value="deprecated">Deprecada</option><option value="inactive">Inactiva</option>
          </select>
        </div>
      </div>
      <div><label className="text-xs text-gray-600 font-medium block mb-1">Equipo responsable</label><input className="input" value={f.owner_team} onChange={e=>set('owner_team',e.target.value)}/></div>
      <div><label className="text-xs text-gray-600 font-medium block mb-1">Celda / Ubicación física</label>
        <select className="input" value={f.cell_id||''} onChange={e=>set('cell_id',e.target.value||null)}>
          <option value="">— Sin asignar —</option>
          {cells.map(cell=>{
            const LAYER_ICONS = {rack:'▤ ',datacenter:'⬜ ',serverroom:'▦ ',cabinet:'▣ '}
            const icon = LAYER_ICONS[cell.cell_type] || '◫ '
            return <option key={cell.id} value={cell.id}>{icon}{cell.full_path||cell.name}</option>
          })}
        </select>
      </div>
      <div><label className="text-xs text-gray-600 font-medium block mb-1">Stack tecnológico (Enter para añadir)</label>
        <input className="input" placeholder="React 18, FastAPI, PostgreSQL…" value={techInput}
          onChange={e=>setTechInput(e.target.value)} onKeyDown={addTech}/>
        {f.tech_stack.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-1">
            {f.tech_stack.map(t=><span key={t} className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold border cursor-pointer" style={{backgroundColor:'#E0E7FF',color:'#3730A3',borderColor:'#A5B4FC'}} onClick={()=>set('tech_stack',f.tech_stack.filter(x=>x!==t))}>{t} ✕</span>)}
          </div>
        )}
      </div>
      <div><label className="text-xs text-gray-600 font-medium block mb-1">Descripción</label><textarea className="input h-16 resize-none" value={f.description} onChange={e=>set('description',e.target.value)}/></div>
      <div className="grid grid-cols-2 gap-3">
        <div><label className="text-xs text-gray-600 font-medium block mb-1">URL Repositorio</label><input className="input" placeholder="https://gitlab…" value={f.repo_url} onChange={e=>set('repo_url',e.target.value)}/></div>
        <div><label className="text-xs text-gray-600 font-medium block mb-1">URL Documentación</label><input className="input" placeholder="https://wiki…" value={f.docs_url} onChange={e=>set('docs_url',e.target.value)}/></div>
      </div>
      <div className="flex justify-end">
        <button className="btn-primary" disabled={!f.name||loading} onClick={()=>onSubmit(f)}>
          {loading?<Spinner size="sm"/>:'Guardar'}
        </button>
      </div>
    </div>
  )
}

// Infra Bindings Section
function InfraBindingsSection({ app }) {
  const qc = useQueryClient()
  const { isEditor } = useAuth()
  const [showAdd, setShowAdd] = useState(false)
  const [assetSearch, setAssetSearch] = useState('')
  const [dropOpen, setDropOpen] = useState(false)
  // Multi-selección de activos
  const [selectedAssets, setSelectedAssets] = useState([])
  const [form, setForm] = useState({
    binding_tier:'compute', is_critical:true, communication_port:'', 
    is_single_point_of_failure:false, redundancy_group:'', notes:''
  })

  const [editBinding, setEditBinding] = useState(null)
  const [editBForm, setEditBForm] = useState({})
  const updateBindingMut = useMutation({
    mutationFn: ({bid, ...d}) => applicationsApi.updateBinding(app.id, bid, d),
    onSuccess: () => {
      qc.invalidateQueries({queryKey:['infra-bindings', app.id]})
      setEditBinding(null)
      toast('Binding actualizado')
    },
    onError: e => toast(e.message, 'error'),
  })

  const { data:bindings } = useQuery({
    queryKey: ['infra-bindings', app.id],
    queryFn: () => infraBindingsApi.list(app.id),
  })
  const { data:assetsResult } = useQuery({
    queryKey: ['assets-search', assetSearch],
    queryFn: () => assetsApi.list({ search: assetSearch, page_size:30 }),
    enabled: true,
  })

  const addMut = useMutation({
    mutationFn: (d) => infraBindingsApi.add(app.id, d),
    onSuccess: () => {
      qc.invalidateQueries({queryKey:['infra-bindings', app.id]})
    },
    onError: e => toast(e.message,'error'),
  })
  const delMut = useMutation({
    mutationFn: (bid) => infraBindingsApi.remove(app.id, bid),
    onSuccess: () => { qc.invalidateQueries({queryKey:['infra-bindings', app.id]}); toast('Vinculación eliminada') },
    onError: e => toast(e.message,'error'),
  })

  const bindingList = Array.isArray(bindings) ? bindings : (bindings?.data || [])
  const assets = assetsResult?.data || assetsResult || []

  // IDs de activos ya vinculados a esta aplicación
  const boundIds = new Set(bindingList.map(b => b.asset_id))

  const toggleAsset = (a) => {
    setSelectedAssets(prev => {
      const exists = prev.find(x => x.id === a.id)
      return exists ? prev.filter(x => x.id !== a.id) : [...prev, a]
    })
  }

  const handleAssociate = async () => {
    if (!selectedAssets.length) return
    for (const a of selectedAssets) {
      await addMut.mutateAsync({ asset_id: a.id, ...form })
    }
    toast(`${selectedAssets.length} elemento${selectedAssets.length>1?'s':''} vinculado${selectedAssets.length>1?'s':''}`)
    setShowAdd(false)
    setSelectedAssets([])
    setAssetSearch('')
    setForm({ binding_tier:'compute', is_critical:true, communication_port:'',  is_single_point_of_failure:false, redundancy_group:'', notes:'' })
  }

  // Group bindings by tier order — items in same tier shown horizontally
  const byTier = {}
  bindingList.forEach(b => {
    const tier = TIER_MAP[b.binding_tier] || { label: b.binding_tier, order: 99, color:'bg-gray-100 text-gray-500' }
    const key = tier.order
    if (!byTier[key]) byTier[key] = { tier, items:[] }
    byTier[key].items.push(b)
  })
  const tierGroups = Object.values(byTier).sort((a,b)=>a.tier.order-b.tier.order)

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-semibold text-gray-600 uppercase tracking-wider">
          Infraestructura vinculada por capas ({bindingList.length})
        </h3>
        {isEditor() && <button className="btn-secondary text-xs" onClick={()=>setShowAdd(true)}>+ Asociar infraestructura</button>}
      </div>

      {bindingList.length === 0 ? (
        <p className="text-xs text-gray-600">Sin infraestructura vinculada.</p>
      ) : (
        <div className="space-y-2">
          {tierGroups.map(({ tier, items }) => (
            <div key={tier.order} className="rounded-lg overflow-hidden border border-gray-200">
              {/* Tier header */}
              <div className={`px-3 py-1.5 flex items-center gap-2 ${tier.color} text-xs font-semibold`}>
                <span>TIER {tier.order} — {tier.label}</span>
                <span className="text-gray-500 font-normal">({items.length})</span>
                {items.some(i=>i.is_single_point_of_failure) && <span className="ml-auto text-orange-500">⚠ SPF</span>}
              </div>
              {/* Items in same tier → horizontal chips */}
              <div className="px-3 py-2 bg-white flex flex-wrap gap-2">
                {items.map(b => (
                  <div key={b.id}
                    className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-gray-200 bg-gray-50 text-sm group">
                    <span className="font-medium text-gray-800">{b.asset_name || b.asset_id}</span>
                      {b.communication_port && <span className="text-[10px] font-mono bg-gray-100 px-1 py-0.5 rounded text-gray-700 border border-gray-200">:{b.communication_port}</span>}
                    {b.asset_type && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-gray-200 text-gray-600 font-medium">
                        {b.asset_type}
                      </span>
                    )}
                    {b.asset_ips?.length > 0 && (
                      <span className="text-[10px] font-mono text-gray-600">{b.asset_ips[0]}</span>
                    )}
                    {b.is_critical && <span className="text-xs">⚡</span>}
                    {b.is_single_point_of_failure && <span className="text-xs text-orange-700">⚠</span>}
                    {b.redundancy_group && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-blue-50 text-blue-500 border border-blue-200">
                        🔄 {b.redundancy_group}
                      </span>
                    )}
                    {isEditor() && (
                      <div className="ml-1 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button
                          className="text-blue-500 hover:text-blue-700 text-xs px-1"
                          title="Editar binding"
                          onClick={()=>{
                            setEditBForm({
                              binding_tier: b.binding_tier||'compute',
                              communication_port: b.communication_port||'',
                              is_critical: b.is_critical,
                              is_single_point_of_failure: b.is_single_point_of_failure,
                              redundancy_group: b.redundancy_group||'',
                              notes: b.notes||'',
                              tier_order_override: b.tier_order_override||'',
                            })
                            setEditBinding(b)
                          }}>✎</button>
                        <button
                          className="text-gray-600 hover:text-red-600 text-xs"
                          onClick={()=>{ if(confirm('¿Desvincular?')) delMut.mutate(b.id) }}>✕</button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      <Modal open={showAdd} onClose={()=>{ setShowAdd(false); setSelectedAssets([]); setAssetSearch('') }}
        title={`Asociar infraestructura a "${app.name}"`}>
        <div className="space-y-4">
          {/* Multi-select dropdown */}
          <div>
            <label className="text-xs text-gray-600 font-medium block mb-1">
              Assets del inventario * {selectedAssets.length > 0 && (
                <span className="text-primary font-semibold ml-1">({selectedAssets.length} seleccionado{selectedAssets.length>1?'s':''})</span>
              )}
            </label>
            {/* Selected chips */}
            {selectedAssets.length > 0 && (
              <div className="flex flex-wrap gap-1 mb-2">
                {selectedAssets.map(a => (
                  <span key={a.id} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-red-50 border border-red-200 text-red-700">
                    {a.name}
                    <span className="text-[10px] text-gray-600 ml-0.5">{a.type}</span>
                    <button type="button" onClick={()=>toggleAsset(a)} className="ml-1 hover:text-red-500">✕</button>
                  </span>
                ))}
              </div>
            )}
            {/* Search + dropdown */}
            <div className="relative">
              <input className="input" placeholder="Buscar por nombre, IP, tipo…"
                value={assetSearch}
                onChange={e => { setAssetSearch(e.target.value); setDropOpen(true) }}
                onFocus={() => setDropOpen(true)}/>
              {dropOpen && (
                <div className="absolute z-20 top-full left-0 right-0 mt-1 border border-gray-200 rounded-lg bg-white shadow-lg max-h-48 overflow-y-auto">
                  {assets.length === 0 ? (
                    <p className="px-3 py-2 text-xs text-gray-600">Sin resultados</p>
                  ) : assets.map(a => {
                    const isSelected = selectedAssets.some(x => x.id === a.id)
                    return (
                      <button key={a.id} type="button"
                        className={`w-full text-left px-3 py-2 text-sm flex items-center gap-2 hover:bg-red-50 border-b border-gray-100 last:border-0 transition-colors ${isSelected ? 'bg-red-50' : ''}`}
                        onClick={()=>{ toggleAsset(a); }}>
                        <span className={`w-4 h-4 rounded border flex-shrink-0 flex items-center justify-center text-[10px] ${isSelected ? 'bg-primary border-primary text-red-700 font-semibold' : 'border-gray-300'}`}>
                          {isSelected ? '✓' : ''}
                        </span>
                        <span className="font-medium text-gray-800 flex-1">{a.name}</span>
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-600">{a.type}</span>
                        <span className="text-[10px] font-mono text-gray-600">{(a.ips||[])[0]||''}</span>
                      </button>
                    )
                  })}
                </div>
              )}
            </div>
            {dropOpen && <div className="fixed inset-0 z-10" onClick={()=>setDropOpen(false)}/>}
          </div>

          {/* Tier selector */}
          <div>
            <label className="text-xs text-gray-600 font-medium block mb-2">Capa (tier) *</label>
            <div className="grid grid-cols-2 gap-1">
              {TIER_LIST.map(t=>(
                <button key={t.value} type="button"
                  onClick={()=>setForm(p=>({...p,binding_tier:t.value}))}
                  className={`px-2 py-1.5 rounded text-xs flex items-center gap-1 border transition-all ${form.binding_tier===t.value?'ring-2 ring-white scale-105':''} ${t.color}`}>
                  <span className="text-gray-500 text-[10px]">T{t.order}</span>
                  {t.label}
                </button>
              ))}
            </div>
          </div>

          {/* Flags */}
          <div className="flex flex-wrap gap-4">
            <label className="flex items-center gap-2 text-xs text-gray-700 cursor-pointer">
              <input type="checkbox" checked={form.is_critical}
                onChange={e=>setForm(p=>({...p,is_critical:e.target.checked}))}/>
              ⚡ Crítico (si falla, cae la app)
            </label>
            <label className="flex items-center gap-2 text-xs text-gray-700 cursor-pointer">
              <input type="checkbox" checked={form.is_single_point_of_failure}
                onChange={e=>setForm(p=>({...p,is_single_point_of_failure:e.target.checked}))}/>
              ⚠ Punto de fallo único (sin redundancia)
            </label>
          </div>

          {form.is_single_point_of_failure && (
            <div className="px-3 py-2 rounded bg-orange-50 border border-orange-300 text-xs text-orange-300">
              ⚠ Este asset no tiene redundancia. Considera añadir otro asset al mismo grupo de redundancia.
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div><label className="text-xs text-gray-600 font-medium block mb-1">Grupo de redundancia</label>
              <input className="input" placeholder="pg-cluster-prod, web-lb…"
                value={form.redundancy_group} onChange={e=>setForm(p=>({...p,redundancy_group:e.target.value}))}/></div>
            <div><label className="text-xs text-gray-600 font-medium block mb-1">Puerto de comunicación</label>
              <input className="input" type="number" placeholder="ej: 443, 5432, 8080, 6379…"
                value={form.communication_port||''} onChange={e=>setForm(p=>({...p,communication_port:e.target.value?parseInt(e.target.value):null}))}/></div>
            <div><label className="text-xs text-gray-600 font-medium block mb-1">Notas</label>
              <input className="input" placeholder="Notas opcionales…"
                value={form.notes} onChange={e=>setForm(p=>({...p,notes:e.target.value}))}/></div>
          </div>

          {addMut.error && <p className="text-xs text-red-700">{addMut.error.message}</p>}

          <div className="flex justify-end gap-2">
            <button className="btn-secondary" onClick={()=>{ setShowAdd(false); setSelectedAssets([]); setAssetSearch('') }}>Cancelar</button>
            <button className="btn-primary"
              disabled={selectedAssets.length===0||addMut.isPending}
              onClick={handleAssociate}>
              {addMut.isPending?<Spinner size="sm"/>:`Asociar${selectedAssets.length>1?` (${selectedAssets.length})`:''}` }
            </button>
          </div>
        </div>
      </Modal>
      {/* Edit binding modal */}
      {editBinding && (
        <Modal open={!!editBinding} onClose={()=>setEditBinding(null)}
          title={`Editar binding — ${editBinding.asset_name||editBinding.asset_id}`}>
          <div className="space-y-3">
            <div>
              <label className="text-xs text-gray-600 font-medium block mb-1">Capa (Tier)</label>
              <div className="flex flex-wrap gap-1.5">
                {TIER_LIST.map(t=>(
                  <button key={t.value} type="button"
                    onClick={()=>setEditBForm(p=>({...p,binding_tier:t.value}))}
                    className={`px-2 py-1.5 rounded text-xs flex items-center gap-1 border transition-all
                      ${editBForm.binding_tier===t.value?'ring-2 ring-primary scale-105':''} ${t.color}`}>
                    {t.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-gray-600 font-medium block mb-1">Puerto de comunicación</label>
                <input type="number" className="input" placeholder="ej: 5432, 443, 6379"
                  value={editBForm.communication_port||''}
                  onChange={e=>setEditBForm(p=>({...p,communication_port:e.target.value?parseInt(e.target.value):null}))}/>
              </div>
              <div>
                <label className="text-xs text-gray-600 font-medium block mb-1">Grupo de redundancia</label>
                <input className="input" placeholder="ej: cluster-A"
                  value={editBForm.redundancy_group||''}
                  onChange={e=>setEditBForm(p=>({...p,redundancy_group:e.target.value||null}))}/>
              </div>
            </div>
            <div>
              <label className="text-xs text-gray-600 font-medium block mb-1">Orden en el tier (opcional)</label>
              <input type="number" className="input w-32" placeholder="ej: 1, 2, 3"
                value={editBForm.tier_order_override||''}
                onChange={e=>setEditBForm(p=>({...p,tier_order_override:e.target.value?parseInt(e.target.value):null}))}/>
            </div>
            <div className="flex gap-4">
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <input type="checkbox" checked={!!editBForm.is_critical}
                  onChange={e=>setEditBForm(p=>({...p,is_critical:e.target.checked}))}/>
                <span>Conexión crítica ⚡</span>
              </label>
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <input type="checkbox" checked={!!editBForm.is_single_point_of_failure}
                  onChange={e=>setEditBForm(p=>({...p,is_single_point_of_failure:e.target.checked}))}/>
                <span>Punto único de fallo ⚠</span>
              </label>
            </div>
            <div>
              <label className="text-xs text-gray-600 font-medium block mb-1">Notas</label>
              <textarea className="input h-16 resize-none" value={editBForm.notes||''}
                onChange={e=>setEditBForm(p=>({...p,notes:e.target.value||null}))}/>
            </div>
            <div className="flex justify-end gap-2 pt-1">
              <button className="btn-secondary" onClick={()=>setEditBinding(null)}>Cancelar</button>
              <button className="btn-primary" disabled={updateBindingMut.isPending}
                onClick={()=>updateBindingMut.mutate({bid:editBinding.id,...editBForm})}>
                {updateBindingMut.isPending?<><Spinner size="sm"/> Guardando…</>:'Guardar cambios'}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}

// Applications Tab
function ApplicationsTab() {
  const qc = useQueryClient()
  const { isEditor } = useAuth()
  const [showCreate, setShowCreate] = useState(false)
  const [editApp, setEditApp]       = useState(null)
  const [detailApp, setDetailApp]   = useState(null)
  const [search, setSearch]         = useState('')

  const { data, isLoading } = useQuery({ queryKey:['apps',search], queryFn:()=>applicationsApi.list({search}) })
  const apps = data?.data || data || []

  const createMut = useMutation({ mutationFn:applicationsApi.create, onSuccess:()=>{ qc.invalidateQueries({queryKey:['apps']}); setShowCreate(false); toast('Aplicación creada') }, onError:e=>toast(e.message,'error') })
  const updateMut = useMutation({ mutationFn:({id,...d})=>applicationsApi.update(id,d), onSuccess:()=>{ qc.invalidateQueries({queryKey:['apps']}); setEditApp(null); toast('Aplicación actualizada') }, onError:e=>toast(e.message,'error') })
  const deleteMut = useMutation({ mutationFn:applicationsApi.delete, onSuccess:()=>{ qc.invalidateQueries({queryKey:['apps']}); toast('Aplicación eliminada') }, onError:e=>toast(e.message,'error') })

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <input className="input w-64" placeholder="Buscar aplicación…" value={search} onChange={e=>setSearch(e.target.value)}/>
        {isEditor() && <button className="btn-primary" onClick={()=>setShowCreate(true)}>+ Nueva aplicación</button>}
      </div>
      <div className="card overflow-hidden">
        {isLoading ? <TableSkeleton rows={5} cols={5}/> : apps.length===0 ? <Empty message="No hay aplicaciones"/> : (
          <table className="w-full text-sm">
            <thead><tr className="text-xs text-gray-600 uppercase" style={{backgroundColor:"#F3F4F6",borderBottom:"2px solid #E5E7EB"}}>
              <th className="px-4 py-3 text-left">Nombre</th><th className="px-4 py-3 text-left">Entorno</th>
              <th className="px-4 py-3 text-left">Estado</th><th className="px-4 py-3 text-left">Stack</th>
              <th className="px-4 py-3 text-left">Localización</th>
              <th className="px-4 py-3 text-left">Equipo</th><th className="px-4 py-3 text-right">Acciones</th>
            </tr></thead>
            <tbody className="divide-y divide-gray-100">
              {apps.map(a=>(
                <tr key={a.id} className={`hover:bg-red-50/50 transition-colors ${detailApp===a.id?'bg-blue-900/10 border-l-2 border-blue-500':''}`}>
                  <td className="px-4 py-3"><p className="font-medium text-gray-900">{a.name}</p>{a.version&&<p className="text-xs text-gray-700">v{a.version}</p>}</td>
                  <td className="px-4 py-3"><Badge cls={ENV_COLORS[a.environment]||'bg-gray-100 text-gray-600'} label={ENV_LABELS[a.environment]||a.environment}/></td>
                  <td className="px-4 py-3"><Badge cls={STATUS_APP[a.status]||'bg-gray-100 text-gray-700'} label={STATUS_APP_LABELS[a.status]||a.status}/></td>
                  <td className="px-4 py-3"><div className="flex flex-wrap gap-1">{(a.tech_stack||[]).slice(0,3).map(t=><span key={t} className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold border" style={{backgroundColor:'#E0E7FF',color:'#3730A3',borderColor:'#A5B4FC'}}>{t}</span>)}{(a.tech_stack||[]).length>3&&<span className="text-xs text-gray-700">+{a.tech_stack.length-3}</span>}</div></td>
                  <td className="px-4 py-3">
                    {a.cell_full_path ? (
                      <span className="inline-flex items-center gap-1 text-xs text-gray-700 bg-gray-50 border border-gray-200 rounded-full px-2 py-0.5">
                        <span className="text-gray-400">📍</span>
                        <span className="truncate max-w-[140px]" title={a.cell_full_path}>{a.cell_full_path}</span>
                      </span>
                    ) : <span className="text-xs text-gray-400">—</span>}
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-600">{a.owner_team||'—'}</td>
                  <td className="px-4 py-3 text-right space-x-2">
                    <button
                      className={`btn-secondary text-xs ${detailApp===a.id?'ring-1 ring-blue-500 text-blue-300':''}`}
                      onClick={()=>setDetailApp(a.id===detailApp?null:a.id)}
                      title="Ver infraestructura vinculada">
                      🏗 Infraestructura
                    </button>
                    {isEditor()&&<>
                      <button className="btn-secondary text-xs" onClick={()=>setEditApp(a)}>Editar</button>
                      <button className="btn-danger text-xs" onClick={()=>{ if(confirm('¿Eliminar aplicación?')) deleteMut.mutate(a.id) }}>Eliminar</button>
                    </>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Infra bindings panel — shown when a row is clicked */}
      {detailApp && (() => {
        const app = apps.find(a=>a.id===detailApp)
        if (!app) return null
        return (
          <div className="card p-4 border-blue-800/30">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-bold text-gray-900">{app.name}</h2>
              <button className="text-gray-500 hover:text-gray-700 text-lg" onClick={()=>setDetailApp(null)}>✕</button>
            </div>
            <InfraBindingsSection app={app}/>
          </div>
        )
      })()}

      <Modal open={showCreate} onClose={()=>setShowCreate(false)} title="Nueva aplicación">
        <AppForm onSubmit={createMut.mutate} loading={createMut.isPending}/>
      </Modal>
      <Modal open={!!editApp} onClose={()=>setEditApp(null)} title="Editar aplicación">
        {editApp && <AppForm initial={editApp} onSubmit={d=>updateMut.mutate({id:editApp.id,...d})} loading={updateMut.isPending}/>}
      </Modal>
    </div>
  )
}

// Services Tab
function ServicesTab() {
  const qc = useQueryClient()
  const { isEditor } = useAuth()
  const [showCreate, setShowCreate] = useState(false)
  const [detailSvc, setDetailSvc]   = useState(null)
  const [urlParamsSvc] = useSearchParams()
  const [showAddComp, setShowAddComp] = useState(false)
  const [showAddEndp, setShowAddEndp] = useState(false)
  const [compForm, setCompForm]     = useState({application_id:'',role:'backend',role_notes:''})
  const [endpForm, setEndpForm]     = useState({url:'',type:'public',description:'',is_primary:false})
  const [svcForm, setSvcForm]       = useState({name:'',criticality:'medium',status:'active',category:'internal_tool',description:'',owner_team:''})

  const { data:svcs, isLoading } = useQuery({ queryKey:['services'], queryFn:()=>servicesApi.list() })
  const { data:svcDetail }       = useQuery({ queryKey:['service',detailSvc?.id], queryFn:()=>servicesApi.get(detailSvc.id), enabled:!!detailSvc })
  const { data:appsAll }         = useQuery({ queryKey:['apps',''], queryFn:()=>applicationsApi.list({}) })
  const services = svcs?.data || svcs || []
  const apps = appsAll?.data || appsAll || []

  // Auto-abrir servicio desde URL param service_id (viene del Dashboard → click Mapa)
  useEffect(() => {
    const svcId = urlParamsSvc.get('service_id')
    if (svcId && services.length) {
      const found = services.find(s => s.id === svcId)
      if (found) setDetailSvc(found)
    }
  }, [urlParamsSvc.toString(), services.length])

  const createSvcMut = useMutation({ mutationFn:servicesApi.create, onSuccess:(s)=>{ qc.invalidateQueries({queryKey:['services']}); setShowCreate(false); setDetailSvc(s); toast('Servicio creado') }, onError:e=>toast(e.message,'error') })
  const [editSvc, setEditSvc]         = useState(null)  // servicio a editar
  const [editSvcForm, setEditSvcForm] = useState({name:'',criticality:'medium',status:'active',category:'internal_tool',description:'',owner_team:''})
  const updateSvcMut = useMutation({
    mutationFn: ({id, ...d}) => servicesApi.update(id, d),
    onSuccess: (updated) => {
      qc.invalidateQueries({queryKey:['services']})
      qc.invalidateQueries({queryKey:['service', editSvc?.id]})
      setEditSvc(null)
      // Refrescar el detailSvc si es el mismo servicio
      if (detailSvc?.id === editSvc?.id) setDetailSvc(updated)
      toast('Servicio actualizado')
    },
    onError: e => toast(e.message, 'error'),
  })
  const addCompMut   = useMutation({ mutationFn:({svcId,...d})=>servicesApi.addComponent(svcId,d), onSuccess:()=>{ qc.invalidateQueries({queryKey:['service',detailSvc?.id]}); setShowAddComp(false); toast('Componente añadido') }, onError:e=>toast(e.message,'error') })
  const delCompMut   = useMutation({ mutationFn:({svcId,cid})=>servicesApi.removeComponent(svcId,cid), onSuccess:()=>qc.invalidateQueries({queryKey:['service',detailSvc?.id]}), onError:e=>toast(e.message,'error') })
  const addEndpMut   = useMutation({ mutationFn:({svcId,...d})=>servicesApi.addEndpoint(svcId,d), onSuccess:()=>{ qc.invalidateQueries({queryKey:['service',detailSvc?.id]}); setShowAddEndp(false); toast('Endpoint añadido') }, onError:e=>toast(e.message,'error') })
  const delEndpMut   = useMutation({ mutationFn:({svcId,eid})=>servicesApi.removeEndpoint(svcId,eid), onSuccess:()=>qc.invalidateQueries({queryKey:['service',detailSvc?.id]}), onError:e=>toast(e.message,'error') })

  const detail = svcDetail || detailSvc

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-700">Servicios ({services.length})</h3>
        {isEditor() && <button className="btn-primary" onClick={()=>setShowCreate(true)}>+ Nuevo servicio</button>}
      </div>

      <div className="card overflow-hidden">
        {isLoading ? <TableSkeleton rows={4} cols={5}/> : services.length===0 ? <Empty message="No hay servicios"/> : (
          <table className="w-full text-sm">
            <thead><tr className="text-xs text-gray-600 uppercase" style={{backgroundColor:"#F3F4F6",borderBottom:"2px solid #E5E7EB"}}>
              <th className="px-4 py-3 text-left">Nombre</th><th className="px-4 py-3 text-left">Criticidad</th>
              <th className="px-4 py-3 text-left">Estado</th><th className="px-4 py-3 text-left">URLs</th>
              <th className="px-4 py-3 text-left">Equipo</th><th className="px-4 py-3 text-right">Acciones</th>
            </tr></thead>
            <tbody className="divide-y divide-gray-100">
              {services.map(s=>(
                <tr key={s.id} className="hover:bg-red-50/50">
                  <td className="px-4 py-3 font-medium text-gray-900 cursor-pointer hover:text-red-700" onClick={()=>setDetailSvc(s)}>{s.name}</td>
                  <td className="px-4 py-3"><Badge cls={CRIT_COLORS[s.criticality]||'bg-gray-100 text-gray-600'} label={s.criticality}/></td>
                  <td className="px-4 py-3"><Badge cls={STATUS_SVC[s.status]||'bg-gray-100 text-gray-700 border border-gray-300'} label={STATUS_SVC_LABELS[s.status]||s.status}/></td>
                  <td className="px-4 py-3 text-xs text-gray-600">{(s.endpoints||[]).length} URL{(s.endpoints||[]).length!==1?'s':''}</td>
                  <td className="px-4 py-3 text-xs text-gray-600">{s.owner_team||'—'}</td>
                  <td className="px-4 py-3 text-right"><button className="btn-secondary text-xs" onClick={()=>setDetailSvc(s)}>Gestionar</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Service detail drawer */}
      {detailSvc && (
        <div className="card p-5 space-y-5 border-primary/30">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-base font-bold text-gray-900">{detail?.name || detailSvc.name}</h2>
              <div className="flex gap-2 mt-1">
                <Badge cls={CRIT_COLORS[detail?.criticality]} label={detail?.criticality}/>
                <Badge cls={STATUS_SVC[detail?.status]||'bg-gray-100 text-gray-700'} label={STATUS_SVC_LABELS[detail?.status]||detail?.status}/>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {isEditor() && (
                <button className="btn-secondary text-xs" onClick={() => {
                  setEditSvcForm({
                    name:        detail?.name || '',
                    criticality: detail?.criticality?.split('.')?.pop() || 'medium',
                    status:      detail?.status?.split('.')?.pop() || 'active',
                    category:    detail?.category?.split('.')?.pop() || 'internal_tool',
                    description: detail?.description || '',
                    owner_team:  detail?.owner_team || '',
                  })
                  setEditSvc(detailSvc)
                }}>✏ Editar</button>
              )}
              <button className="text-gray-500 hover:text-gray-700 text-xl" onClick={()=>setDetailSvc(null)}>✕</button>
            </div>
          </div>

          {/* Endpoints */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-xs font-semibold text-gray-600 uppercase tracking-wider">URLs del servicio</h3>
              {isEditor() && <button className="btn-secondary text-xs" onClick={()=>setShowAddEndp(true)}>+ Añadir URL</button>}
            </div>
            {(detail?.endpoints||[]).length===0 ? <p className="text-xs text-gray-700">Sin URLs configuradas</p> : (
              <div className="space-y-1">
                {(detail?.endpoints||[]).map(ep=>(
                  <div key={ep.id} className="flex items-center justify-between px-3 py-2 bg-gray-50 rounded-lg">
                    <div className="flex items-center gap-2">
                      {ep.is_primary && <span className="text-yellow-400 text-xs">⭐</span>}
                      <Badge cls="bg-gray-100 text-gray-700 border border-gray-300" label={ep.type}/>
                      <a href={ep.url} target="_blank" rel="noreferrer" className="text-xs text-blue-400 hover:underline">{ep.url}</a>
                      {ep.description && <span className="text-xs text-gray-700">— {ep.description}</span>}
                    </div>
                    {isEditor() && <button className="text-red-400 hover:text-red-300 text-xs" onClick={()=>delEndpMut.mutate({svcId:detailSvc.id,eid:ep.id})}>✕</button>}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Components */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-xs font-semibold text-gray-600 uppercase tracking-wider">Componentes ({(detail?.components||[]).length})</h3>
              {isEditor() && <button className="btn-secondary text-xs" onClick={()=>setShowAddComp(true)}>+ Añadir componente</button>}
            </div>
            {(detail?.components||[]).length===0 ? <p className="text-xs text-gray-700">Sin componentes</p> : (
              <table className="w-full text-sm">
                <thead><tr className="text-xs text-gray-600 uppercase border-b border-gray-100">
                  <th className="py-2 text-left">Aplicación</th><th className="py-2 text-left">Rol</th><th className="py-2 text-left">Notas</th>{isEditor()&&<th className="py-2"/>}
                </tr></thead>
                <tbody className="divide-y divide-gray-100">
                  {(detail?.components||[]).map(c=>(
                    <tr key={c.id}>
                      <td className="py-2">
                        <p className="font-medium text-gray-800">{c.application_name||c.application_id}</p>
                        {c.cell_full_path && (
                          <p className="text-[10px] text-gray-500 flex items-center gap-0.5 mt-0.5">
                            <span>📍</span><span className="truncate max-w-[160px]">{c.cell_full_path}</span>
                          </p>
                        )}
                      </td>
                      <td className="py-2"><Badge cls={ROLE_COLORS[c.role]||'bg-gray-100 text-gray-600'} label={c.role}/></td>
                      <td className="py-2 text-xs text-gray-600">{c.role_notes||'—'}</td>
                      {isEditor()&&<td className="py-2 text-right"><button className="text-red-400 hover:text-red-300 text-xs" onClick={()=>delCompMut.mutate({svcId:detailSvc.id,cid:c.id})}>✕</button></td>}
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      {/* Create service modal */}
      <Modal open={showCreate} onClose={()=>setShowCreate(false)} title="Nuevo servicio">
        <div className="space-y-3">
          <div><label className="text-xs text-gray-600 font-medium block mb-1">Nombre *</label><input className="input" value={svcForm.name} onChange={e=>setSvcForm(p=>({...p,name:e.target.value}))}/></div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className="text-xs text-gray-600 font-medium block mb-1">Criticidad</label>
              <select className="input" value={svcForm.criticality} onChange={e=>setSvcForm(p=>({...p,criticality:e.target.value}))}>
                <option value="critical">Crítico</option><option value="high">Alto</option><option value="medium">Medio</option><option value="low">Bajo</option>
              </select>
            </div>
            <div><label className="text-xs text-gray-600 font-medium block mb-1">Categoría</label>
              <select className="input" value={svcForm.category} onChange={e=>setSvcForm(p=>({...p,category:e.target.value}))}>
                <option value="citizen_portal">Portal Ciudadano</option><option value="internal_tool">Herramienta Interna</option>
                <option value="infrastructure">Infraestructura</option><option value="integration">Integración</option><option value="other">Otro</option>
              </select>
            </div>
          </div>
          <div><label className="text-xs text-gray-600 font-medium block mb-1">Equipo</label><input className="input" value={svcForm.owner_team} onChange={e=>setSvcForm(p=>({...p,owner_team:e.target.value}))}/></div>
          <div><label className="text-xs text-gray-600 font-medium block mb-1">Descripción</label><textarea className="input h-16 resize-none" value={svcForm.description} onChange={e=>setSvcForm(p=>({...p,description:e.target.value}))}/></div>
          <div className="flex justify-end"><button className="btn-primary" disabled={!svcForm.name||createSvcMut.isPending} onClick={()=>createSvcMut.mutate(svcForm)}>{createSvcMut.isPending?<Spinner size="sm"/>:'Crear servicio'}</button></div>
        </div>
      </Modal>

      {/* Edit service modal */}
      <Modal open={!!editSvc} onClose={()=>setEditSvc(null)} title={`Editar servicio — ${editSvc?.name||''}`}>
        <div className="space-y-3">
          <div><label className="text-xs text-gray-600 font-medium block mb-1">Nombre *</label>
            <input className="input" value={editSvcForm.name} onChange={e=>setEditSvcForm(p=>({...p,name:e.target.value}))}/>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className="text-xs text-gray-600 font-medium block mb-1">Criticidad</label>
              <select className="input" value={editSvcForm.criticality} onChange={e=>setEditSvcForm(p=>({...p,criticality:e.target.value}))}>
                <option value="critical">Crítico</option><option value="high">Alto</option>
                <option value="medium">Medio</option><option value="low">Bajo</option>
              </select>
            </div>
            <div><label className="text-xs text-gray-600 font-medium block mb-1">Estado</label>
              <select className="input" value={editSvcForm.status} onChange={e=>setEditSvcForm(p=>({...p,status:e.target.value}))}>
                <option value="active">Activo</option><option value="degraded">Degradado</option>
                <option value="maintenance">Mantenimiento</option><option value="inactive">Inactivo</option>
              </select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className="text-xs text-gray-600 font-medium block mb-1">Categoría</label>
              <select className="input" value={editSvcForm.category} onChange={e=>setEditSvcForm(p=>({...p,category:e.target.value}))}>
                <option value="citizen_portal">Portal Ciudadano</option>
                <option value="internal_tool">Herramienta Interna</option>
                <option value="infrastructure">Infraestructura</option>
                <option value="integration">Integración</option>
                <option value="other">Otro</option>
              </select>
            </div>
            <div><label className="text-xs text-gray-600 font-medium block mb-1">Equipo</label>
              <input className="input" value={editSvcForm.owner_team} onChange={e=>setEditSvcForm(p=>({...p,owner_team:e.target.value}))}/>
            </div>
          </div>
          <div><label className="text-xs text-gray-600 font-medium block mb-1">Descripción</label>
            <textarea className="input h-20 resize-none" value={editSvcForm.description}
              onChange={e=>setEditSvcForm(p=>({...p,description:e.target.value}))}/>
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <button className="btn-secondary" onClick={()=>setEditSvc(null)}>Cancelar</button>
            <button className="btn-primary" disabled={!editSvcForm.name||updateSvcMut.isPending}
              onClick={()=>updateSvcMut.mutate({id:editSvc.id,...editSvcForm})}>
              {updateSvcMut.isPending?<><Spinner size="sm"/> Guardando…</>:'Guardar cambios'}
            </button>
          </div>
        </div>
      </Modal>

      {/* Add component modal */}
      <Modal open={showAddComp} onClose={()=>setShowAddComp(false)} title="Añadir componente">
        <div className="space-y-3">
          <div><label className="text-xs text-gray-600 font-medium block mb-1">Aplicación *</label>
            <select className="input" value={compForm.application_id} onChange={e=>setCompForm(p=>({...p,application_id:e.target.value}))}>
              <option value="">Selecciona una aplicación…</option>
              {apps.map(a=><option key={a.id} value={a.id}>{a.name} ({a.environment})</option>)}
            </select>
          </div>
          <div><label className="text-xs text-gray-600 font-medium block mb-1">Rol *</label>
            <div className="flex flex-wrap gap-2">
              {ROLES_LIST.map(r=>(
                <button key={r} type="button" onClick={()=>setCompForm(p=>({...p,role:r}))}
                  className={`badge border transition-all cursor-pointer ${ROLE_COLORS[r]||'bg-gray-100 text-gray-600'} ${compForm.role===r?'ring-2 ring-white scale-105':''}`}>{r}</button>
              ))}
            </div>
          </div>
          {compForm.role==='other' && <div><label className="text-xs text-gray-600 font-medium block mb-1">Descripción del rol *</label><input className="input" value={compForm.role_notes} onChange={e=>setCompForm(p=>({...p,role_notes:e.target.value}))}/></div>}
          <div className="flex justify-end">
            <button className="btn-primary"
              disabled={!compForm.application_id||(compForm.role==='other'&&!compForm.role_notes)||addCompMut.isPending}
              onClick={()=>addCompMut.mutate({svcId:detailSvc.id,...compForm})}>
              {addCompMut.isPending?<Spinner size="sm"/>:'Añadir'}
            </button>
          </div>
        </div>
      </Modal>

      {/* Add endpoint modal */}
      <Modal open={showAddEndp} onClose={()=>setShowAddEndp(false)} title="Añadir URL / endpoint">
        <div className="space-y-3">
          <div><label className="text-xs text-gray-600 font-medium block mb-1">URL *</label><input className="input" placeholder="https://…" value={endpForm.url} onChange={e=>setEndpForm(p=>({...p,url:e.target.value}))}/></div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className="text-xs text-gray-600 font-medium block mb-1">Tipo</label>
              <select className="input" value={endpForm.type} onChange={e=>setEndpForm(p=>({...p,type:e.target.value}))}>
                <option value="public">Público</option><option value="internal">Interno</option>
                <option value="vpn">VPN</option><option value="api">API</option><option value="webhook">Webhook</option>
              </select>
            </div>
            <div className="flex items-end pb-2"><label className="flex items-center gap-2 text-xs text-gray-600"><input type="checkbox" checked={endpForm.is_primary} onChange={e=>setEndpForm(p=>({...p,is_primary:e.target.checked}))}/> URL principal</label></div>
          </div>
          <div><label className="text-xs text-gray-600 font-medium block mb-1">Descripción</label><input className="input" value={endpForm.description} onChange={e=>setEndpForm(p=>({...p,description:e.target.value}))}/></div>
          <div className="flex justify-end"><button className="btn-primary" disabled={!endpForm.url||addEndpMut.isPending} onClick={()=>addEndpMut.mutate({svcId:detailSvc.id,...endpForm})}>{addEndpMut.isPending?<Spinner size="sm"/>:'Añadir URL'}</button></div>
        </div>
      </Modal>
    </div>
  )
}

// Dependency Map Tab
function DependencyMapTab() {
  const [selectedSvc, setSelectedSvc] = useState('')
  const [showAssets, setShowAssets]   = useState(true)
  const [selectedNode, setSelectedNode] = useState(null)
  const [hoveredNode, setHoveredNode]   = useState(null)
  const [tooltipPos, setTooltipPos]     = useState({x:0,y:0})

  const { data:svcs } = useQuery({ queryKey:['services'], queryFn:()=>servicesApi.list() })
  const services = svcs?.data || svcs || []

  const { data:graphData, isLoading } = useQuery({
    queryKey: ['graph', selectedSvc, showAssets],
    queryFn: () => selectedSvc ? servicesApi.graph(selectedSvc) : servicesApi.globalGraph(),
    // NO placeholderData — queremos spinner al cambiar de servicio para no mostrar grafo anterior
  })

  const nodes = graphData?.nodes || []
  const edges = graphData?.edges || []

  // Hierarchical layout: service(row0) → applications(row1) → assets by tier(row2+)
  const positioned = (() => {
    const NODE_W = 180, NODE_H = 60
    const H_GAP = 60  // horizontal gap between nodes
    const V_GAP = 80  // vertical gap between rows
    const ROW_H = NODE_H + V_GAP

    // 1. Asignar filas por tipo de nodo y capa
    const TIER_ROW = {
      entry_point: 2, gateway: 3, certificate: 3,
      application: 4, auth: 4,
      cache: 5, data: 5,
      compute: 6, storage: 7, network: 8,
    }

    const getRow = (n) => {
      if (n.node_type === 'service')     return 0
      if (n.node_type === 'application') return 1
      if (n.node_type === 'asset') {
        const tier = n.binding_tier || 'compute'
        return TIER_ROW[tier] ?? 2
      }
      return 2
    }

    // 2. Group nodes by row
    const byRow = {}
    nodes.forEach(n => {
      const r = getRow(n)
      if (!byRow[r]) byRow[r] = []
      byRow[r].push(n)
    })

    // 3. Ordenar activos por tier_order
    Object.values(byRow).forEach(rowNodes => {
      rowNodes.sort((a, b) => {
        if (a.node_type === 'asset' && b.node_type === 'asset') {
          return (a.tier_order || 99) - (b.tier_order || 99)
        }
        return a.label?.localeCompare(b.label || '') || 0
      })
    })

    // 4. Compute SVG width based on widest row
    const maxCols = Math.max(...Object.values(byRow).map(r => r.length), 1)
    const svgW = Math.max(900, maxCols * (NODE_W + H_GAP) + H_GAP)

    // 5. Position each node centered in its row
    const result = []
    const rowKeys = Object.keys(byRow).map(Number).sort((a,b) => a-b)
    rowKeys.forEach(row => {
      const rowNodes = byRow[row]
      const totalW = rowNodes.length * NODE_W + (rowNodes.length - 1) * H_GAP
      const startX = (svgW - totalW) / 2
      rowNodes.forEach((n, i) => {
        result.push({ ...n, x: startX + i * (NODE_W + H_GAP), y: 40 + row * ROW_H })
      })
    })

    return result
  })()

  // Paleta UX del grafo
  // Cada capa tiene su identidad visual clara y diferenciada
  // Paleta UX definitiva — colores VIVOS y distintos por capa
  // Cada tier tiene un HUE completamente diferente + fondo oscuro saturado
  const NODE_STYLES = {
    // Capa 0 — Servicio: azul rey intenso
    service: {
      fill: '#1e3a8a',        // azul rey oscuro
      border: '#93c5fd',      // azul cielo claro
      label: '#bfdbfe',
      fillCritical: '#7f1d1d', borderCritical: '#fca5a5', labelCritical: '#fecaca',
    },
    // Capa 1 — Aplicación: verde esmeralda oscuro
    application: {
      fill: '#064e3b',        // esmeralda muy oscuro
      border: '#6ee7b7',      // esmeralda claro
      label: '#a7f3d0',
    },
    // Assets — cada tier con HUE radicalmente distinto:
    compute: {               // NARANJA — servidores, VMs
      fill: '#7c2d12',        // naranja quemado
      border: '#fb923c',      // naranja vivo
      label: '#fed7aa',
    },
    data: {                  // CIAN — bases de datos
      fill: '#164e63',        // cian muy oscuro
      border: '#22d3ee',      // cian brillante
      label: '#a5f3fc',
    },
    cache: {                 // AMARILLO — memoria rápida
      fill: '#713f12',        // ámbar oscuro
      border: '#fbbf24',      // amarillo vivo
      label: '#fef08a',
    },
    storage: {               // ROSA/FUCSIA — almacenamiento
      fill: '#500724',        // rosa oscuro
      border: '#f472b6',      // rosa brillante
      label: '#fbcfe8',
    },
    network: {               // LIMA — red y conectividad
      fill: '#14532d',        // verde lima oscuro
      border: '#84cc16',      // lima brillante
      label: '#d9f99d',
    },
    auth: {                  // VIOLETA — seguridad/identidad
      fill: '#3b0764',        // violeta muy oscuro
      border: '#c084fc',      // violeta brillante
      label: '#e9d5ff',
    },
    default: {
      fill: '#1e293b',
      border: '#94a3b8',
      label: '#cbd5e1',
    },
  }

  const getNodeStyle = (n) => {
    if (n.node_type === 'service') {
      return n.criticality === 'critical' ? NODE_STYLES.service.fillCritical : NODE_STYLES.service.fill
    }
    if (n.node_type === 'application') return NODE_STYLES.application.fill
    if (n.node_type === 'asset') return (NODE_STYLES[n.binding_tier] || NODE_STYLES.default).fill
    return NODE_STYLES.default.fill
  }
  const getNodeColor = getNodeStyle  // alias para compatibilidad

  const getNodeBorder = (n) => {
    if (n.node_type === 'service') {
      return n.criticality === 'critical' ? NODE_STYLES.service.borderCritical : NODE_STYLES.service.border
    }
    if (n.node_type === 'application') return NODE_STYLES.application.border
    if (n.node_type === 'asset') return (NODE_STYLES[n.binding_tier] || NODE_STYLES.default).border
    return NODE_STYLES.default.border
  }
  const getEdgeColor = (e) => {
    if (e.edge_type==='COMPOSED_OF') return '#60a5fa'
    if (e.edge_type==='DEPENDS_ON') return e.is_critical?'#ef4444':'#f97316'
    return '#6b7280'
  }

  // Calcular posiciones de nodos para dibujar conexiones
  const posMap = {}
  positioned.forEach(n => { posMap[n.id] = n })

  const SVG_W = Math.max(1000, positioned.length > 0 ? Math.max(...positioned.map(n => n.x + 200)) + 60 : 1000)
  const SVG_H = Math.max(400, positioned.length > 0 ? Math.max(...positioned.map(n => n.y + 80)) + 60 : 400)

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-4 flex-wrap">
        <select className="input w-64" value={selectedSvc} onChange={e=>setSelectedSvc(e.target.value)}>
          <option value="">Todos los servicios</option>
          {services.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <label className="flex items-center gap-2 text-sm text-gray-600">
          <input type="checkbox" checked={showAssets} onChange={e=>setShowAssets(e.target.checked)}/>
          Mostrar infraestructura
        </label>
        {selectedNode && <button className="btn-secondary text-xs" onClick={()=>setSelectedNode(null)}>✕ Cerrar panel</button>}
      </div>

      {isLoading ? <div className="card p-8 flex items-center justify-center"><Spinner/></div> :
       nodes.length===0 ? <Empty message="No hay datos en el grafo. Crea servicios y añade componentes."/> : (
        <div className="flex gap-4">
          <div className="card overflow-auto flex-1">
            <svg width={SVG_W} height={SVG_H} className="w-full">
              {/* Contenedores jerárquicos: Zona > CPD > Rack */}
              {(() => {
                const TIERS_WITH_LOC = new Set(['compute','storage','network','data','cache'])
                const PAD_RACK = 14, PAD_CPD = 28, PAD_ZONE = 42

                // 1. Solo assets físicos con location_info
                const locNodes = positioned.filter(n =>
                  n.node_type === 'asset' &&
                  (showAssets || true) &&
                  n.location_info &&
                  TIERS_WITH_LOC.has(n.binding_tier)
                )

                // 2. Agrupar por cell (rack/datacenter) → site (CPD) → zone
                const byCell = {}
                locNodes.forEach(n => {
                  const li = n.location_info
                  const ck = li.full_path || li.cell_name
                  if (!byCell[ck]) byCell[ck] = { nodes:[], info: li }
                  byCell[ck].nodes.push(n)
                })

                const bySite = {}
                Object.values(byCell).forEach(({nodes, info}) => {
                  const sk = (info.zone_name||'') + '|' + (info.site_name||'')
                  if (!bySite[sk]) bySite[sk] = { cells: [], zone: info.zone_name, site: info.site_name }
                  bySite[sk].cells.push({nodes, info})
                })

                const rects = []

                // 3. Dibujar de afuera hacia adentro: zona > site > cell
                // Paleta suave para no competir con los nodos
                const CELL_COLORS = {
                  rack:       { fill:'rgba(96,165,250,0.06)',  stroke:'#3b82f6', label:'#93c5fd' },
                  datacenter: { fill:'rgba(99,102,241,0.06)',  stroke:'#6366f1', label:'#a5b4fc' },
                  serverroom: { fill:'rgba(34,211,238,0.06)',  stroke:'#06b6d4', label:'#67e8f9' },
                  cabinet:    { fill:'rgba(167,139,250,0.06)', stroke:'#8b5cf6', label:'#c4b5fd' },
                  default:    { fill:'rgba(100,116,139,0.05)', stroke:'#475569', label:'#94a3b8' },
                }
                const SITE_COLORS  = { fill:'rgba(51,65,85,0.04)',  stroke:'#334155', label:'#64748b' }
                const ZONE_COLORS  = { fill:'rgba(30,41,59,0.03)',   stroke:'#1e293b', label:'#475569' }

                const nodeH = 78  // max node height

                const bbox = (nodes, padX, padY) => {
                  const xs = nodes.map(n => n.x), ys = nodes.map(n => n.y)
                  return {
                    x: Math.min(...xs) - padX,
                    y: Math.min(...ys) - padY - 16,
                    w: Math.max(...xs) + 186 + padX - (Math.min(...xs) - padX),
                    h: Math.max(...ys) + nodeH + padY - (Math.min(...ys) - padY - 16),
                  }
                }

                const ICONS = { rack:'▤', datacenter:'⬜', serverroom:'▦', cabinet:'▣', default:'◫' }

                Object.entries(bySite).forEach(([sk, {cells, zone, site}]) => {
                  // Todos los nodos del site
                  const allSiteNodes = cells.flatMap(c => c.nodes)

                  // Layer 1: Cell (rack/datacenter) — más interno
                  cells.forEach(({nodes, info}) => {
                    const cc = CELL_COLORS[info.cell_type] || CELL_COLORS.default
                    const icon = ICONS[info.cell_type] || ICONS.default
                    const b = bbox(nodes, PAD_RACK, PAD_RACK)
                    const labelTxt = [info.cell_name, info.row_id, info.rack_unit].filter(Boolean).join(' · ')
                    const labelW = Math.min(labelTxt.length * 5.4 + 16, b.w - 8)
                    rects.push(
                      <g key={`cell-${info.full_path}`}>
                        <rect x={b.x} y={b.y} width={b.w} height={b.h} rx={10}
                          fill={cc.fill} stroke={cc.stroke} strokeWidth={1}
                          strokeDasharray="5,3"/>
                        <rect x={b.x+6} y={b.y+2} width={labelW} height={13} rx={6}
                          fill="rgba(0,0,0,0.6)"/>
                        <text x={b.x+13} y={b.y+10} fill="white"
                          fontSize="9" fontWeight="700" letterSpacing="0.03em">
                          {icon} {labelTxt}
                        </text>
                      </g>
                    )
                  })

                  // Layer 2: Site (edificio/CPD) — capa media
                  if (allSiteNodes.length > 0) {
                    const b = bbox(allSiteNodes, PAD_CPD, PAD_CPD)
                    const siteLabel = site || 'Site'
                    const labelW = Math.min(siteLabel.length * 5.6 + 16, b.w - 8)
                    rects.push(
                      <g key={`site-${sk}`}>
                        <rect x={b.x} y={b.y} width={b.w} height={b.h} rx={14}
                          fill={SITE_COLORS.fill} stroke={SITE_COLORS.stroke}
                          strokeWidth={0.8} strokeDasharray="8,4"/>
                        <rect x={b.x+6} y={b.y+2} width={labelW} height={13} rx={6}
                          fill="rgba(0,0,0,0.55)"/>
                        <text x={b.x+13} y={b.y+10} fill="white"
                          fontSize="9" fontWeight="600" letterSpacing="0.03em">
                          🏢 {siteLabel}
                        </text>
                      </g>
                    )
                  }
                })

                // Layer 3: Zona (municipio/organización) — más externo, muy sutil
                const allLocNodes = locNodes
                if (allLocNodes.length > 1) {
                  const firstZone = allLocNodes[0]?.location_info?.zone_name
                  if (firstZone) {
                    const b = bbox(allLocNodes, PAD_ZONE, PAD_ZONE)
                    const labelW = Math.min(firstZone.length * 5.6 + 16, b.w - 8)
                    rects.push(
                      <g key="zone-outer">
                        <rect x={b.x} y={b.y} width={b.w} height={b.h} rx={18}
                          fill={ZONE_COLORS.fill} stroke={ZONE_COLORS.stroke}
                          strokeWidth={0.6} strokeDasharray="10,6"/>
                        <rect x={b.x+6} y={b.y+2} width={labelW} height={13} rx={6}
                          fill="rgba(0,0,0,0.45)"/>
                        <text x={b.x+13} y={b.y+10} fill="rgba(255,255,255,0.85)"
                          fontSize="9" fontWeight="500" letterSpacing="0.03em">
                          🌐 {firstZone}
                        </text>
                      </g>
                    )
                  }
                }

                return rects
              })()}

              {/* Row tier labels */}
              {(() => {
                const ROW_LABELS = {0:'Servicio',1:'Aplicaciones',2:'Entry Points',3:'Gateway · Perimetral',4:'Auth · App interna',5:'Datos · Caché',6:'Cómputo',7:'Almacenamiento',8:'Red · Switches'}
                const seen = new Set()
                return positioned.map(n => {
                  const row = Math.round((n.y - 40) / 140)
                  if (seen.has(row)) return null
                  seen.add(row)
                  const label = ROW_LABELS[row] || `Tier ${row}`
                  return <text key={`row-${row}`} x={12} y={n.y + 35} fill="#374151" fontSize="9" fontWeight="600" letterSpacing="0.05em">{label.toUpperCase()}</text>
                })
              })()}
              {/* Tier separator lines */}
              {(() => {
                const rows = [...new Set(positioned.map(n => Math.round((n.y - 40) / 140)))]
                return rows.slice(1).map(row => (
                  <line key={`sep-${row}`} x1={0} y1={40 + row * 140 - 20} x2={SVG_W} y2={40 + row * 140 - 20}
                    stroke="#1f2937" strokeWidth={1} strokeDasharray="4,8" opacity={0.5}/>
                ))
              })()}

              {/* Edges */}
              {edges.map((e,i) => {
                const s = posMap[e.source], t = posMap[e.target]
                if (!s||!t) return null
                const sx=s.x+93, sy=s.y+34, tx=t.x+93, ty=t.y+34
                return (
                  <g key={e.id||i}>
                    <line x1={sx} y1={sy} x2={tx} y2={ty} stroke={getEdgeColor(e)} strokeWidth={e.is_critical?2.5:1.5}
                      strokeDasharray={e.edge_type==='HOSTED_ON'?'5,3':undefined} markerEnd="url(#arrow)" opacity={0.8}/>
                    <text x={(sx+tx)/2} y={(sy+ty)/2-4} fill="#9ca3af" fontSize="9" textAnchor="middle">{e.label}</text>
                  </g>
                )
              })}
              {/* Arrow marker */}
              <defs><marker id="arrow" markerWidth="6" markerHeight="6" refX="6" refY="3" orient="auto">
                <path d="M0,0 L0,6 L6,3 z" fill="#6b7280"/>
              </marker></defs>
              {/* Nodes */}
              {positioned.filter(n => showAssets || n.node_type!=='asset').map(n => {
                // Localización solo en activos físicos (compute, storage, network, data)
                const TIERS_WITH_LOC = new Set(['compute','storage','network','data','cache'])
                const showLoc = !!n.location_name && n.node_type === 'asset' && TIERS_WITH_LOC.has(n.binding_tier)
                const nodeW = 186
                const nodeH = showLoc ? 78 : 60
                const cx = nodeW / 2  // center x

                // Colores por tipo de nodo con palette refinada
                const isSelected = selectedNode?.id === n.id
                const fillColor  = getNodeColor(n)
                const borderColor = isSelected ? '#f8fafc' : getNodeBorder(n)
                const borderW    = isSelected ? 2.5 : 1.5

                // Evento handlers en el grupo completo
                const handlers = {
                  onMouseEnter: ev => { setHoveredNode(n); const r=ev.currentTarget.closest('svg').getBoundingClientRect(); setTooltipPos({x:ev.clientX-r.left+14,y:ev.clientY-r.top-10}) },
                  onMouseLeave: () => setHoveredNode(null),
                  onMouseMove:  ev => { const r=ev.currentTarget.closest('svg').getBoundingClientRect(); setTooltipPos({x:ev.clientX-r.left+14,y:ev.clientY-r.top-10}) },
                }

                // Texto secundario bajo el nombre
                let subText = ''
                if (n.node_type === 'service')     subText = n.criticality || 'service'
                else if (n.node_type === 'application') subText = n.environment ? `${n.environment}${n.version?' · v'+n.version:''}` : (n.version?'v'+n.version:'application')
                else if (n.node_type === 'asset')  subText = `${n.binding_tier||'asset'}${n.ips?.length?' · '+n.ips[0]:''}${n.communication_port?' :'+n.communication_port:''}`

                return (
                <g key={n.id} onClick={() => setSelectedNode(n)} className="cursor-pointer"
                  transform={`translate(${n.x},${n.y})`} {...handlers}>

                  {/* Sombra sutil */}
                  <rect width={nodeW} height={nodeH} rx="10" fill="rgba(0,0,0,0.25)"
                    transform="translate(2,3)" opacity="0.4"/>

                  {/* Cuerpo principal */}
                  <rect width={nodeW} height={nodeH} rx="10"
                    fill={fillColor} stroke={borderColor} strokeWidth={borderW}
                    filter={n.criticality==='critical'?'url(#glow)':undefined}
                  />

                  {/* Franja de acento superior — color del tier/capa */}
                  <defs>
                    <clipPath id={`clip-accent-${n.id}`}>
                      <rect width={nodeW} height={8} rx="10"/>
                    </clipPath>
                  </defs>
                  <rect width={nodeW} height={8} fill={borderColor} opacity={0.55}
                    clipPath={`url(#clip-accent-${n.id})`}/>

                  {/* Nombre */}
                  <text x={cx} y={showLoc ? 22 : 22}
                    fill="white" fontSize="11" fontWeight="700"
                    textAnchor="middle" dominantBaseline="middle"
                    style={{letterSpacing:'0.01em'}}>
                    {n.label?.length>21 ? n.label.slice(0,19)+'…' : n.label}
                  </text>

                  {/* Subtítulo (tipo/entorno/tier) con color label suave */}
                  <text x={cx} y={showLoc ? 37 : 40}
                    fill={(NODE_STYLES[n.binding_tier]||NODE_STYLES[n.node_type]||NODE_STYLES.default).label || 'rgba(255,255,255,0.6)'}
                    fontSize="8.5" textAnchor="middle">
                    {subText}
                  </text>

                  {/* Badge de localización — pastilla sutil en la parte inferior del nodo */}
                  {showLoc && (() => {
                    const loc = n.location_name
                    const locShort = loc.length > 24 ? loc.slice(0,22)+'…' : loc
                    const badgeW = Math.min(locShort.length * 5.4 + 20, nodeW - 16)
                    const badgeX = (nodeW - badgeW) / 2
                    return (
                      <g transform="translate(0,50)">
                        {/* Pastilla fondo */}
                        <rect x={badgeX} y={0} width={badgeW} height={16} rx="8"
                          fill="rgba(255,255,255,0.10)" stroke="rgba(255,255,255,0.18)" strokeWidth="0.8"/>
                        {/* Pin icon (circle pequeño) */}
                        <circle cx={badgeX + 9} cy={8} r="2.5" fill="rgba(110,231,183,0.8)"/>
                        {/* Texto de localización */}
                        <text x={badgeX + 16} y={9} fill="rgba(110,231,183,0.9)"
                          fontSize="7.5" dominantBaseline="middle" fontWeight="500">
                          {locShort}
                        </text>
                      </g>
                    )
                  })()}

                  {/* Indicador criticidad */}
                  {n.criticality === 'critical' && (
                    <g transform={`translate(${nodeW-16},6)`}>
                      <circle r="6" fill="rgba(239,68,68,0.3)" stroke="#ef4444" strokeWidth="1"/>
                      <text x="0" y="0" fill="#fca5a5" fontSize="8" textAnchor="middle" dominantBaseline="middle" fontWeight="700">!</text>
                    </g>
                  )}

                  {/* Indicador SPOF */}
                  {n.is_single_point_of_failure && (
                    <g transform={`translate(${nodeW-16},${n.criticality==='critical'?20:6})`}>
                      <circle r="5" fill="rgba(249,115,22,0.25)" stroke="#f97316" strokeWidth="1"/>
                      <text x="0" y="0" fill="#fdba74" fontSize="7" textAnchor="middle" dominantBaseline="middle">⚡</text>
                    </g>
                  )}
                </g>
              )})}
              <defs><filter id="glow"><feGaussianBlur stdDeviation="3" result="blur"/><feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs>
              {/* Floating tooltip */}
              {hoveredNode && (() => {
                const lines = [
                  hoveredNode.label,
                  hoveredNode.node_type === 'service' ? `Criticidad: ${hoveredNode.criticality||'—'}` : null,
                  hoveredNode.node_type === 'application' ? `Entorno: ${hoveredNode.environment||'—'}` : null,
                  hoveredNode.version ? `v${hoveredNode.version}` : null,
                  hoveredNode.node_type === 'asset' ? `Tipo: ${hoveredNode.asset_type||'—'}` : null,
                  hoveredNode.ips?.length ? `IP: ${hoveredNode.ips[0]}` : null,
                  hoveredNode.binding_tier ? `Tier: ${hoveredNode.binding_tier}` : null,
                  hoveredNode.communication_port ? `Puerto: ${hoveredNode.communication_port}` : null,
                  hoveredNode.location_name ? `📍 ${hoveredNode.location_name}` : null,
                  hoveredNode.status ? `Estado: ${hoveredNode.status}` : null,
                  hoveredNode.is_single_point_of_failure ? '⚠ Punto de fallo único' : null,
                ].filter(Boolean)
                const TW = 200, TH = lines.length * 16 + 16
                const tx = Math.min(tooltipPos.x, SVG_W - TW - 10)
                const ty = Math.max(4, tooltipPos.y - TH - 4)
                return (
                  <g style={{pointerEvents:'none'}}>
                    <rect x={tx} y={ty} width={TW} height={TH} rx={6} fill="#111827" stroke="#374151" strokeWidth={1} opacity={0.97}/>
                    {lines.map((line,i) => (
                      <text key={i} x={tx+10} y={ty+14+i*16} fill={i===0?'#f9fafb':'#9ca3af'} fontSize={i===0?11:10} fontWeight={i===0?'700':'400'}>{line}</text>
                    ))}
                  </g>
                )
              })()}
            </svg>
          </div>

          {/* Node detail panel */}
          {selectedNode && (
            <div className="card p-4 w-72 shrink-0 space-y-3">
              <div className="flex items-center justify-between">
                <Badge cls={selectedNode.node_type==='service'?CRIT_COLORS[selectedNode.criticality]||'bg-blue-100 text-blue-800':selectedNode.node_type==='application'?'bg-green-100 text-green-800':'bg-gray-100 text-gray-600'} label={selectedNode.node_type}/>
                <button className="text-gray-500 hover:text-gray-700" onClick={()=>setSelectedNode(null)}>✕</button>
              </div>
              <h3 className="font-semibold text-gray-900">{selectedNode.label}</h3>
              {selectedNode.version && <p className="text-xs text-gray-700">v{selectedNode.version}</p>}
              {selectedNode.status && <p className="text-xs text-gray-600">Estado: {selectedNode.status}</p>}
              {selectedNode.criticality && <p className="text-xs text-gray-600">Criticidad: {selectedNode.criticality}</p>}
              {selectedNode.environment && <p className="text-xs text-gray-600">Entorno: {selectedNode.environment}</p>}
              {(selectedNode.tech_stack||[]).length>0 && <div className="flex flex-wrap gap-1">{selectedNode.tech_stack.map(t=><span key={t} className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold border" style={{backgroundColor:'#E0E7FF',color:'#3730A3',borderColor:'#A5B4FC'}}>{t}</span>)}</div>}
              {(selectedNode.endpoints||[]).length>0 && <div className="space-y-1">{selectedNode.endpoints.map((u,i)=><a key={i} href={u} target="_blank" rel="noreferrer" className="block text-xs text-blue-400 hover:underline truncate">{u}</a>)}</div>}
              {selectedNode.node_type==='asset' && selectedNode.id && (
                <Link to={`/assets/${selectedNode.id.replace('ast-','')}`} className="btn-secondary text-xs w-full justify-center">Ver detalle del activo →</Link>
              )}
            </div>
          )}
        </div>
      )}

      {/* Legend */}
      <div className="flex flex-wrap gap-x-5 gap-y-2 text-xs text-gray-500 pt-1 border-t border-gray-100">
        <span className="font-semibold text-gray-600 self-center">Nodos:</span>
        {[
          {bg:'#1e3a8a',bd:'#93c5fd',label:'Servicio'},
          {bg:'#064e3b',bd:'#6ee7b7',label:'Aplicación'},
          {bg:'#7c2d12',bd:'#fb923c',label:'Cómputo (servidores)'},
          {bg:'#164e63',bd:'#22d3ee',label:'Datos (BD)'},
          {bg:'#713f12',bd:'#fbbf24',label:'Caché'},
          {bg:'#500724',bd:'#f472b6',label:'Almacenamiento'},
          {bg:'#14532d',bd:'#84cc16',label:'Red'},
          {bg:'#3b0764',bd:'#c084fc',label:'Auth'},
        ].map(({bg,bd,label}) => (
          <span key={label} className="flex items-center gap-1.5">
            <span className="w-3.5 h-3 rounded-sm inline-block border"
              style={{background:bg,borderColor:bd}}/>
            {label}
          </span>
        ))}
        <span className="font-semibold text-gray-600 self-center ml-2">Aristas:</span>
        <span className="flex items-center gap-1"><span className="w-6 h-0.5 inline-block" style={{background:'#60a5fa'}}/>Componente</span>
        <span className="flex items-center gap-1"><span className="w-6 h-0.5 inline-block" style={{background:'#ef4444'}}/>Dep. crítica</span>
        <span className="flex items-center gap-1"><span className="w-6 h-0.5 inline-block" style={{background:'#f97316'}}/>Dep. normal</span>
        <span className="flex items-center gap-1">
          <span className="w-6 inline-block" style={{borderTop:'1px dashed #6b7280'}}/>
          Alojado en
        </span>
        <span className="flex items-center gap-1.5 ml-2">
          <span className="w-2 h-2 rounded-full inline-block" style={{background:'rgba(110,231,183,0.8)'}}/>
          Localización física (CPD/Rack)
        </span>
      </div>
    </div>
  )
}

// Main Page
export default function ApplicationsPage() {
  const [tab, setTab] = useState(0)
  return (
    <div className="p-6 space-y-4">
      <div>
        <h1 className="text-xl font-bold text-gray-900">Gestión de Servicios</h1>
        <p className="text-xs text-gray-600 mt-0.5">Servicios, aplicaciones y mapa de dependencias</p>
      </div>
      <div className="flex border-b border-gray-100">
        {TABS.map((t,i)=>(
          <button key={t} onClick={()=>setTab(i)}
            className={`px-4 py-2 text-sm font-medium transition-colors border-b-2 -mb-px ${tab===i?'border-primary text-primary font-semibold':'border-transparent text-gray-600 hover:text-gray-800'}`}>
            {t}
          </button>
        ))}
      </div>
      {tab===0 && <ServicesTab/>}
      {tab===1 && <ApplicationsTab/>}
      {tab===2 && <DependencyMapTab/>}
    </div>
  )
}
