import { useState, useCallback, useEffect } from 'react'
import { Link, useLocation, useSearchParams, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { assetsApi, tagsApi } from '../services/api'
import { ComplianceRow, BackupCell, SourceBadge } from '../components/ui/ComplianceBadge'
import { colorBadgeStyle, TagBadge, AssetTypeBadge, PowerStateBadge, TableSkeleton, Modal, Spinner, SortIcon, toast } from '../components/ui/index.jsx'
import { useAuth } from '../context/AuthContext'
import { format } from 'date-fns'
import { es } from 'date-fns/locale/es'

const ASSET_TYPES = ['server_physical','server_virtual','vcenter','web_server','database','switch','router','firewall','load_balancer','ap','storage_array','k8s_cluster','container']
const ASSET_TYPE_LABELS = {
  server_physical:'Servidor físico', server_virtual:'Servidor virtual', vcenter:'vCenter',
  web_server:'Servidor web', database:'Base de datos', switch:'Switch', router:'Router',
  firewall:'Firewall', load_balancer:'Balanceador', ap:'Punto de acceso',
  storage_array:'Almacenamiento', k8s_cluster:'Cluster Kubernetes', container:'Contenedor',
}
function toISO(d) { return d ? new Date(d).toISOString() : undefined }

// Formulario de nuevo activo manual
const IP_RE = /^((25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(25[0-5]|2[0-4]\d|[01]?\d\d?)$/

function NewAssetForm({ onSubmit, loading }) {
  const [type, setType]   = useState('server_virtual')
  const [name, setName]   = useState('')
  const [ip,   setIp]     = useState('')
  const [ipErr, setIpErr] = useState('')
  const [desc, setDesc]   = useState('')
  // campos tipo-específicos
  const [os,       setOs]      = useState('')
  const [vendor,   setVendor]  = useState('')
  const [model,    setModel]   = useState('')
  const [serial,   setSerial]  = useState('')
  const [dbEng,    setDbEng]   = useState('')
  const [dbVer,    setDbVer]   = useState('')
  const [dbHost,   setDbHost]  = useState('')
  const [webSw,    setWebSw]   = useState('')
  const [webVer,   setWebVer]  = useState('')
  const [k8sVer,   setK8sVer]  = useState('')
  const [k8sProv,  setK8sProv] = useState('k3s')
  const [ctImg,    setCtImg]   = useState('')
  const [ctTag,    setCtTag]   = useState('latest')
  const [ctStatus, setCtSt]    = useState('running')
  const [ctRt,     setCtRt]    = useState('docker')
  const [fwVer,    setFwVer]   = useState('')

  const submit = (e) => {
    e.preventDefault()
    if (ip.trim() && !IP_RE.test(ip.trim())) {
      setIpErr('Dirección IPv4 inválida (ej. 192.168.1.10)')
      return
    }
    const base = {
      name: name.trim(),
      type,
      source: 'manual',
      data_source_id: 'ds-manual',
      description: desc || undefined,
      ips: ip.trim() ? [ip.trim()] : undefined,
      vendor: vendor || undefined,
      model: model || undefined,
      serial_number: serial || undefined,
    }
    const extra = {}
    if (['server_physical','server_virtual'].includes(type)) {
      extra.os = os || undefined
    }
    if (type === 'database') {
      extra.db_engine = dbEng || undefined
      extra.db_version = dbVer || undefined
      extra.db_host = dbHost || undefined
    }
    if (type === 'web_server') {
      extra.vendor = webSw || undefined
      extra.product_version = webVer || undefined
    }
    if (type === 'k8s_cluster') {
      extra.k8s_version = k8sVer || undefined
      extra.k8s_provider = k8sProv || undefined
    }
    if (type === 'container') {
      extra.container_image = ctImg || undefined
      extra.container_image_tag = ctTag || undefined
      extra.container_status = ctStatus || undefined
      extra.container_runtime = ctRt || undefined
    }
    if (['switch','router','firewall','load_balancer','ap'].includes(type)) {
      extra.firmware_version = fwVer || undefined
    }
    onSubmit([{ ...base, ...extra }])
  }

  const inp = 'input text-sm'
  return (
    <form onSubmit={submit} className="space-y-4">
      {/* Campos comunes */}
      <div className="grid grid-cols-2 gap-3">
        <div className="col-span-2">
          <label className="block text-xs text-gray-600 font-medium mb-1">Tipo *</label>
          <select className={inp} value={type} onChange={e=>setType(e.target.value)}>
            {ASSET_TYPES.map(t=><option key={t} value={t}>{ASSET_TYPE_LABELS[t]}</option>)}
          </select>
        </div>
        <div className="col-span-2">
          <label className="block text-xs text-gray-600 font-medium mb-1">Nombre *</label>
          <input required className={inp} value={name} onChange={e=>setName(e.target.value)} maxLength={255} placeholder="ej. vm-web-prod-03"/>
        </div>
        <div>
          <label className="block text-xs text-gray-600 font-medium mb-1">
            IP principal {['server_physical','server_virtual','switch','router','firewall','load_balancer','ap'].includes(type) ? '*' : ''}
          </label>
          <input
            className={`${inp} ${ipErr ? 'border-red-400 ring-1 ring-red-400' : ''}`}
            value={ip}
            placeholder="192.168.1.10"
            required={['server_physical','server_virtual','switch','router','firewall','load_balancer','ap'].includes(type)}
            onChange={e => {
              const v = e.target.value
              setIp(v)
              if (v && !IP_RE.test(v)) setIpErr('IPv4 inválida (ej. 192.168.1.10)')
              else setIpErr('')
            }}
          />
          {ipErr && <p className="text-red-500 text-[11px] mt-0.5">{ipErr}</p>}
        </div>
        <div>
          <label className="block text-xs text-gray-600 font-medium mb-1">Fabricante / Vendor *</label>
          <input required className={inp} value={vendor} onChange={e=>setVendor(e.target.value)} maxLength={100}/>
        </div>
      </div>

      {/* Campos tipo-específicos */}
      {['server_physical','server_virtual'].includes(type) && (
        <div className="grid grid-cols-2 gap-3 border-t border-gray-100 pt-3">
          <div>
            <label className="block text-xs text-gray-600 font-medium mb-1">Sistema operativo *</label>
            <input required className={inp} value={os} onChange={e=>setOs(e.target.value)} placeholder="Ubuntu 22.04 LTS"/>
          </div>
          <div>
            <label className="block text-xs text-gray-600 font-medium mb-1">Modelo</label>
            <input className={inp} value={model} onChange={e=>setModel(e.target.value)}/>
          </div>
          {type === 'server_physical' && (
            <div>
              <label className="block text-xs text-gray-600 font-medium mb-1">Nº Serie</label>
              <input className={inp} value={serial} onChange={e=>setSerial(e.target.value)} maxLength={100}/>
            </div>
          )}
        </div>
      )}
      {type === 'database' && (
        <div className="grid grid-cols-2 gap-3 border-t border-gray-100 pt-3">
          <div>
            <label className="block text-xs text-gray-600 font-medium mb-1">Motor *</label>
            <select required className={inp} value={dbEng} onChange={e=>setDbEng(e.target.value)}>
              <option value="">Seleccionar…</option>
              {['PostgreSQL','MySQL','MariaDB','SQL Server','Oracle','MongoDB','Redis','SQLite'].map(e=><option key={e} value={e}>{e}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs text-gray-600 font-medium mb-1">Versión</label>
            <input className={inp} value={dbVer} onChange={e=>setDbVer(e.target.value)} placeholder="16.2"/>
          </div>
          <div className="col-span-2">
            <label className="block text-xs text-gray-600 font-medium mb-1">Host / IP del servidor</label>
            <input className={inp} value={dbHost} onChange={e=>setDbHost(e.target.value)} placeholder="10.0.0.5 o vm-db-01"/>
          </div>
        </div>
      )}
      {type === 'web_server' && (
        <div className="grid grid-cols-2 gap-3 border-t border-gray-100 pt-3">
          <div>
            <label className="block text-xs text-gray-600 font-medium mb-1">Software *</label>
            <select required className={inp} value={webSw} onChange={e=>setWebSw(e.target.value)}>
              <option value="">Seleccionar…</option>
              {['nginx','Apache','IIS','Tomcat','Caddy','Traefik','HAProxy'].map(s=><option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs text-gray-600 font-medium mb-1">Versión</label>
            <input className={inp} value={webVer} onChange={e=>setWebVer(e.target.value)} placeholder="1.25.4"/>
          </div>
        </div>
      )}
      {type === 'k8s_cluster' && (
        <div className="grid grid-cols-2 gap-3 border-t border-gray-100 pt-3">
          <div>
            <label className="block text-xs text-gray-600 font-medium mb-1">Proveedor *</label>
            <select required className={inp} value={k8sProv} onChange={e=>setK8sProv(e.target.value)}>
              {['k3s','kubeadm','eks','aks','gke','openshift','other'].map(p=><option key={p} value={p}>{p}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs text-gray-600 font-medium mb-1">Versión K8s *</label>
            <input required className={inp} value={k8sVer} onChange={e=>setK8sVer(e.target.value)} placeholder="1.29.3"/>
          </div>
        </div>
      )}
      {type === 'container' && (
        <div className="grid grid-cols-2 gap-3 border-t border-gray-100 pt-3">
          <div>
            <label className="block text-xs text-gray-600 font-medium mb-1">Imagen *</label>
            <input required className={inp} value={ctImg} onChange={e=>setCtImg(e.target.value)} placeholder="nginx"/>
          </div>
          <div>
            <label className="block text-xs text-gray-600 font-medium mb-1">Tag</label>
            <input className={inp} value={ctTag} onChange={e=>setCtTag(e.target.value)} placeholder="latest"/>
          </div>
          <div>
            <label className="block text-xs text-gray-600 font-medium mb-1">Runtime</label>
            <select className={inp} value={ctRt} onChange={e=>setCtRt(e.target.value)}>
              {['docker','containerd','podman'].map(r=><option key={r} value={r}>{r}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs text-gray-600 font-medium mb-1">Estado</label>
            <select className={inp} value={ctStatus} onChange={e=>setCtSt(e.target.value)}>
              {['running','stopped','exited','paused'].map(s=><option key={s} value={s}>{s}</option>)}
            </select>
          </div>
        </div>
      )}
      {['switch','router','firewall','load_balancer','ap'].includes(type) && (
        <div className="grid grid-cols-2 gap-3 border-t border-gray-100 pt-3">
          <div>
            <label className="block text-xs text-gray-600 font-medium mb-1">Modelo</label>
            <input className={inp} value={model} onChange={e=>setModel(e.target.value)} placeholder="Cisco Catalyst 9300"/>
          </div>
          <div>
            <label className="block text-xs text-gray-600 font-medium mb-1">Versión firmware</label>
            <input className={inp} value={fwVer} onChange={e=>setFwVer(e.target.value)} placeholder="17.9.4"/>
          </div>
        </div>
      )}

      {/* Descripción (siempre al final) */}
      <div>
        <label className="block text-xs text-gray-600 font-medium mb-1">Descripción</label>
        <input className={inp} value={desc} onChange={e=>setDesc(e.target.value)} maxLength={500}/>
      </div>

      <div className="flex justify-end pt-1">
        <button type="submit" className="btn-primary" disabled={loading}>
          {loading ? <Spinner size="sm"/> : 'Crear activo'}
        </button>
      </div>
    </form>
  )
}

export default function InventoryPage() {
  const { isEditor, isAdmin } = useAuth()
  const { pathname }  = useLocation()
  const [urlParams]   = useSearchParams()
  const navigate      = useNavigate()
  const qc = useQueryClient()

  const [search,         setSearch]      = useState(() => urlParams.get('search') || '')
  const [typeFilter,     setType]        = useState(() => urlParams.get('type') || '')
  const [sourceFilter,   setSource]      = useState(() => urlParams.get('source') || '')
  const [powerFilter,    setPower]       = useState(() => urlParams.get('vm_power_state') || '')
  const [compIndicator,  setCompInd]     = useState(() => urlParams.get('compliance_indicator') || '')
  const [compStatus,     setCompStatus]  = useState(() => urlParams.get('compliance_status') || '')
  const [eolTag,         setEolTag]      = useState(() => urlParams.get('eol_tag') || '')
  const [edrOnline,      setEdrOnline]   = useState(() => urlParams.get('edr_online') || '')
  const [edrTamper,      setEdrTamper]   = useState(() => urlParams.get('edr_tamper_protected') || '')
  const [edrMode,        setEdrMode]     = useState(() => urlParams.get('edr_agent_mode') || '')
  const [edrManaged,     setEdrManaged]  = useState(() => urlParams.get('edr_managed') || '')
  const [edrHealth,      setEdrHealth]   = useState(() => urlParams.get('edr_health') || '')
  const [tagFilters,     setTagFilters]  = useState([])
  const [asOfLocal,      setAsOfLocal]   = useState('')
  const [sortBy,         setSortBy]      = useState('name')
  const [sortOrder,      setSortOrder]   = useState('asc')
  const [page,           setPage]        = useState(1)
  const [newAssetOpen, setNewAsset]  = useState(false)
  const [selected,    setSelected]    = useState(new Set())
  const [bulkOpen,    setBulkOpen]    = useState(false)
  const [bulkTags,    setBulkTags]    = useState(new Set())
  const [untagOpen,   setUntagOpen]   = useState(false)
  const [untagTag,    setUntagTag]    = useState(null)
  const [untagSel,    setUntagSel]    = useState(new Set())
  const [showReview,  setShowReview]  = useState(false)
  const [reviewPage,  setReviewPage]  = useState(1)

  // Sincronizar si la URL cambia (navegación desde Dashboard)
  useEffect(() => {
    const s = urlParams.get('search') || ''
    const t = urlParams.get('type') || ''
    setSearch(s); setType(t)
    setSource(urlParams.get('source')||'')
    setPower(urlParams.get('vm_power_state')||'')
    setCompInd(urlParams.get('compliance_indicator')||'')
    setCompStatus(urlParams.get('compliance_status')||'')
    setEolTag(urlParams.get('eol_tag')||'')
    setEdrOnline(urlParams.get('edr_online')||'')
    setEdrTamper(urlParams.get('edr_tamper_protected')||'')
    setEdrMode(urlParams.get('edr_agent_mode')||'')
    setEdrManaged(urlParams.get('edr_managed')||'')
    setEdrHealth(urlParams.get('edr_health')||'')
    setPage(1)
  }, [urlParams.toString()])

  const asOfISO = toISO(asOfLocal)
  const live    = !asOfISO
  const params  = { search, type: typeFilter, as_of: asOfISO,
    source:               sourceFilter || undefined,
    vm_power_state:       powerFilter || undefined,
    tag_ids:              tagFilters.length ? tagFilters.map(t=>t.id) : undefined,
    compliance_indicator: compIndicator || undefined,
    compliance_status:    compStatus || undefined,
    eol_tag:              eolTag || undefined,
    edr_online:           edrOnline || undefined,
    edr_tamper_protected: edrTamper || undefined,
    edr_agent_mode:       edrMode || undefined,
    edr_managed:          edrManaged || undefined,
    edr_health:           edrHealth || undefined,
    sort_by: sortBy, sort_order: sortOrder, page, page_size: 50 }

  const { data, isLoading } = useQuery({
    queryKey: ['assets', params],
    queryFn:  () => assetsApi.list(params),
    placeholderData: (prev) => prev,
  })
  const reviewParams = { needs_review: true, page: reviewPage, page_size: 50, sort_by: 'last_sync', sort_order: 'desc' }
  const { data: reviewData, isLoading: reviewLoading } = useQuery({
    queryKey: ['assets-review', reviewParams],
    queryFn:  () => assetsApi.list(reviewParams),
    enabled:  showReview,
    placeholderData: (prev) => prev,
  })
  const { data: reviewCountData } = useQuery({
    queryKey: ['assets-review-count'],
    queryFn:  () => assetsApi.list({ needs_review: true, page_size: 1 }),
    refetchInterval: 60000,
  })
  const { data: allTags } = useQuery({
    queryKey: ['tags'],
    queryFn:  () => tagsApi.list('manual'),
  })
  const { data: tagAssetsData, isLoading: tagAssetsLoading } = useQuery({
    queryKey: ['assets-with-tag', untagTag?.id],
    queryFn:  () => assetsApi.list({ tag_ids: [untagTag.id], page_size: 200 }),
    enabled:  !!untagTag,
  })

  const bulkMut = useMutation({
    mutationFn: () => assetsApi.bulkTags([...selected], [...bulkTags]),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['assets'] })
      setBulkOpen(false); setSelected(new Set()); setBulkTags(new Set())
      toast(`Etiquetas asignadas a ${selected.size} activos`)
    },
    onError: e => toast(e.message, 'error'),
  })
  const createMut = useMutation({
    mutationFn: (items) => assetsApi.ingest(items),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['assets'] })
      setNewAsset(false)
      toast(`Activo creado correctamente`)
      if (res?.created === 1) navigate(`/assets/${res?.id || ''}`)
    },
    onError: e => toast(e.message || 'Error al crear el activo', 'error'),
  })
  const deleteMut = useMutation({
    mutationFn: (id) => assetsApi.delete(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['assets'] })
      toast('Activo eliminado')
    },
    onError: e => toast(e.message || 'Error al eliminar el activo', 'error'),
  })
  const untagMut = useMutation({
    mutationFn: () => assetsApi.bulkUntag([...untagSel], [untagTag.id]),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['assets'] })
      qc.invalidateQueries({ queryKey: ['assets-with-tag', untagTag?.id] })
      setUntagOpen(false); setUntagTag(null); setUntagSel(new Set())
      toast('Etiqueta eliminada de los activos seleccionados')
    },
    onError: e => toast(e.message, 'error'),
  })

  const assets = data?.data || []
  const total  = data?.total || 0

  const handleSort     = (f) => { if(sortBy===f) setSortOrder(o=>o==='asc'?'desc':'asc'); else{setSortBy(f);setSortOrder('asc')}; setPage(1) }
  const handleTagClick = useCallback((tag) => { setTagFilters(prev => prev.find(t=>t.id===tag.id) ? prev.filter(t=>t.id!==tag.id) : [...prev,tag]); setPage(1) }, [])
  const clearTags      = () => { setTagFilters([]); setPage(1) }
  const toggleSel      = (id) => setSelected(s => { const n=new Set(s); n.has(id)?n.delete(id):n.add(id); return n })
  const toggleAll      = () => setSelected(s => s.size===assets.length ? new Set() : new Set(assets.map(a=>a.id)))
  const getExcMap      = (a) => { const m={}; (a.exceptions||[]).forEach(e=>{m[e.indicator]=e}); return m }

  function ColHead({ field, label, sortable=true }) {
    return sortable ? (
      <th className="px-3 py-3 text-left cursor-pointer" onClick={()=>handleSort(field)}>
        <span className="flex items-center gap-0.5 text-xs text-gray-700 uppercase tracking-wider font-semibold">
          {label}<SortIcon field={field} sortBy={sortBy} sortOrder={sortOrder}/>
        </span>
      </th>
    ) : (
      <th className="px-3 py-3 text-left text-xs text-gray-700 uppercase tracking-wider font-semibold">{label}</th>
    )
  }

  const hasComplianceFilter = !!(compIndicator && compStatus)
  const hasEolFilter = !!eolTag
  const COMP_STATUS_LABELS = {
    ok:'✅ Activo', ko:'❌ Sin cumplir',
    ok_with_exception:'🔵 OK + excepción', ko_with_exception:'🟠 KO + excepción'
  }
  const COMP_IND_LABELS = {
    edr:'EDR', mon:'Monitorización', siem:'SIEM',
    logs:'Logs', bck:'Backup local', bckcl:'Backup cloud'
  }

  return (
    <div className="p-6 space-y-4">

      {/* Tab revisión */}
      <div className="flex gap-1 border-b border-gray-200">
        <button
          onClick={()=>{setShowReview(r=>!r);setReviewPage(1)}}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors -mb-px flex items-center gap-1.5 ${showReview?'border-amber-500 text-amber-700 font-semibold':'border-transparent text-gray-600 hover:text-gray-800'}`}>
          Revisión
          {(reviewCountData?.total||0)>0 && (
            <span className="inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 text-[10px] font-bold rounded-full bg-amber-100 text-amber-700 border border-amber-300">
              {reviewCountData.total}
            </span>
          )}
        </button>
      </div>

      {/* Cabecera */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Inventario</h1>
          <p className="text-xs text-gray-600 mt-0.5">
            {live ? <span className="text-green-600 font-medium">● Live</span>
                  : <span className="text-amber-600 font-medium">● Histórico — {format(new Date(asOfISO),'dd/MM/yyyy HH:mm',{locale:es})}</span>}
            {' · '}{total} activos
          </p>
        </div>
        <div className="flex gap-2">
          {isEditor() && <>
            <button className="btn-secondary text-sm" onClick={()=>{ setUntagOpen(true); setUntagTag(null); setUntagSel(new Set()) }}>
              🗑 Eliminar etiqueta
            </button>
            <button className="btn-secondary text-sm" onClick={()=>setBulkOpen(true)}>
              + Asignar etiquetas{selected.size > 0 ? ` (${selected.size})` : ''}
            </button>
            <button className="btn-primary text-sm" onClick={()=>{ createMut.reset(); setNewAsset(true) }}>
              + Nuevo activo
            </button>
          </>}
        </div>
      </div>

      {/* Filtros */}
      <div className="card p-3 space-y-3">
        <div className="flex flex-wrap gap-3 items-end">
          <div className="flex flex-col gap-1">
            <span className="text-xs text-gray-700 font-medium">Búsqueda</span>
            <input className="input w-64" placeholder="Nombre, IP, serie, OS…" value={search} onChange={e=>{setSearch(e.target.value);setPage(1)}}/>
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-xs text-gray-700 font-medium">Tipo</span>
            <select className="input w-44" value={typeFilter} onChange={e=>{setType(e.target.value);setPage(1)}}>
              <option value="">Todos</option>
              {ASSET_TYPES.map(t=><option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-xs text-gray-700 font-medium">Vista histórica</span>
            <div className="flex items-center gap-2">
              <input type="datetime-local" className="input w-52" value={asOfLocal} onChange={e=>{setAsOfLocal(e.target.value);setPage(1)}}/>
              {asOfLocal && <button className="btn-secondary text-xs" onClick={()=>{setAsOfLocal('');setPage(1)}}>🟢 Live</button>}
            </div>
          </div>
        </div>
        {(tagFilters.length > 0 || sourceFilter || powerFilter) && (
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs text-gray-700 font-medium">Filtros activos:</span>
            {sourceFilter && (
              <button onClick={()=>{setSource('');setPage(1)}}
                className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold border bg-indigo-50 text-indigo-700 border-indigo-300 hover:scale-105 transition-all">
                Origen: {sourceFilter} <span className="opacity-60 ml-0.5">✕</span>
              </button>
            )}
            {powerFilter && (
              <button onClick={()=>{setPower('');setPage(1)}}
                className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold border bg-green-50 text-green-700 border-green-300 hover:scale-105 transition-all">
                Estado: {powerFilter === 'poweredOn' ? 'Encendido' : powerFilter === 'poweredOff' ? 'Apagado' : 'Suspendido'} <span className="opacity-60 ml-0.5">✕</span>
              </button>
            )}
            {tagFilters.map(tag=>(
              <button key={tag.id} onClick={()=>{setTagFilters(p=>p.filter(t=>t.id!==tag.id));setPage(1)}}
                className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold border transition-all hover:scale-105"
                style={colorBadgeStyle(tag.color_code)}>
                {tag.name} <span className="opacity-60 ml-0.5">✕</span>
              </button>
            ))}
            <button onClick={()=>{clearTags();setSource('');setPower('');setPage(1)}} className="text-xs text-primary underline">Limpiar todo</button>
          </div>
        )}
      </div>

      {/* Zona de Revisión */}
      {showReview && (
        <div className="card overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-100 bg-amber-50">
            <p className="text-sm text-amber-800 font-medium">
              Activos sin match — detectados por fuentes secundarias (Agente EDR, Veeam) pero sin correspondencia en VMware u otra fuente primaria.
            </p>
          </div>
          {reviewLoading ? <div className="p-8 flex justify-center"><Spinner/></div> :
          (reviewData?.data||[]).length===0 ? (
            <div className="py-16 flex flex-col items-center gap-2 text-gray-600">
              <p className="text-sm font-medium">No hay activos pendientes de revisión</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b-2 border-gray-200" style={{backgroundColor:'#FEF3C7'}}>
                    <th className="px-3 py-3 text-left text-xs text-amber-800 uppercase tracking-wider font-semibold">Nombre</th>
                    <th className="px-3 py-3 text-left text-xs text-amber-800 uppercase tracking-wider font-semibold">Tipo</th>
                    <th className="px-3 py-3 text-left text-xs text-amber-800 uppercase tracking-wider font-semibold">Fuente</th>
                    <th className="px-3 py-3 text-left text-xs text-amber-800 uppercase tracking-wider font-semibold">MAC</th>
                    <th className="px-3 py-3 text-left text-xs text-amber-800 uppercase tracking-wider font-semibold">SO</th>
                    <th className="px-3 py-3 text-left text-xs text-amber-800 uppercase tracking-wider font-semibold">Última sync</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-amber-50">
                  {(reviewData?.data||[]).map(a=>(
                    <tr key={a.id}
                      className="hover:bg-amber-50 transition-colors cursor-pointer"
                      onClick={()=>navigate(`/assets/${a.id}`)}>
                      <td className="px-3 py-3">
                        <span className="font-semibold text-amber-900">{a.name}</span>
                        <p className="text-xs text-gray-500">{(a.ips||[]).slice(0,2).join(', ')}</p>
                      </td>
                      <td className="px-3 py-3"><AssetTypeBadge type={a.type}/></td>
                      <td className="px-3 py-3"><SourceBadge source={a.source} contributing_sources={a.contributing_sources}/></td>
                      <td className="px-3 py-3 text-xs font-mono text-gray-600">{a.mac_address||'—'}</td>
                      <td className="px-3 py-3 text-xs text-gray-600">{a.os||'—'}</td>
                      <td className="px-3 py-3 text-xs text-gray-600">{a.last_sync ? format(new Date(a.last_sync),'dd/MM HH:mm') : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {(reviewData?.total||0)>50 && (
            <div className="flex items-center justify-between px-4 py-3 text-sm text-gray-700 border-t border-gray-100">
              <span>{(reviewPage-1)*50+1}–{Math.min(reviewPage*50,reviewData.total)} de {reviewData.total}</span>
              <div className="flex gap-2">
                <button className="btn-secondary text-xs" disabled={reviewPage===1} onClick={()=>setReviewPage(p=>p-1)}>Anterior</button>
                <button className="btn-secondary text-xs" disabled={reviewPage*50>=reviewData.total} onClick={()=>setReviewPage(p=>p+1)}>Siguiente</button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Tabla */}
      {!showReview && <div className="card overflow-hidden">
        {isLoading ? <div className="p-8 flex justify-center"><Spinner/></div> : assets.length===0 ? (
          <div className="py-16 flex flex-col items-center gap-2 text-gray-600">
            <p className="text-sm font-medium">Sin resultados</p>
            <button className="btn-secondary text-xs" onClick={()=>{setSearch('');setType('');setSource('');setPower('');clearTags();setAsOfLocal('');setCompInd('');setCompStatus('');setEolTag('');setPage(1)}}>Limpiar filtros</button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b-2 border-gray-200" style={{backgroundColor:'#F3F4F6'}}>
                  {isEditor() && <th className="px-3 py-3 w-10"><input type="checkbox" checked={selected.size===assets.length&&assets.length>0} onChange={toggleAll} className="accent-primary"/></th>}
                  <ColHead field="name"             label="Nombre"/>
                  <ColHead field="type"             label="Tipo"/>
                  <ColHead field="vendor"           label="Fabricante"/>
                  <ColHead field="source"           label="Origen"/>
                  <ColHead field="cell_full_path"   label="Ubicación" sortable={false}/>
                  <ColHead field="compliance"       label="Compliance" sortable={false}/>
                  <ColHead field="last_backup_local" label="Backup Local"/>
                  <ColHead field="last_backup_cloud" label="Backup Cloud"/>
                  <ColHead field="etiquetas"        label="Etiquetas" sortable={false}/>
                  <ColHead field="last_sync"        label="Última sync"/>
                  {isEditor() && <th className="px-3 py-3 w-8"/>}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {assets.map(a=>{
                  const excMap = getExcMap(a)
                  return (
                    <tr key={a.id}
                      className={`table-row-alt transition-colors cursor-pointer ${selected.has(a.id)?'bg-red-50 border-l-2 border-red-400':''}`}
                      onClick={()=>navigate(`/assets/${a.id}`)}>
                      {isEditor() && <td className="px-3 py-3" onClick={e=>e.stopPropagation()}><input type="checkbox" checked={selected.has(a.id)} onChange={()=>toggleSel(a.id)} className="accent-primary"/></td>}
                      <td className="px-3 py-3">
                        <span className="font-semibold" style={{color:'#C8001D'}}>{a.name}</span>
                        {a.source === 'manual' && <span className="ml-1.5 text-[9px] bg-amber-100 text-amber-700 border border-amber-300 px-1 py-0.5 rounded font-bold uppercase tracking-wide">manual</span>}
                        <p className="text-xs text-gray-600">{(a.ips||[]).slice(0,2).join(', ')}</p>
                      </td>
                      <td className="px-3 py-3" onClick={e=>e.stopPropagation()}>
                        <div className="flex flex-col items-start gap-0.5">
                          <AssetTypeBadge type={a.type} onClick={()=>{setType(a.type);setPage(1)}}/>
                          <PowerStateBadge type={a.type} vm_power_state={a.vm_power_state} container_status={a.container_status}
                            onClick={a.vm_power_state ? ()=>{setPower(a.vm_power_state);setPage(1)} : undefined}/>
                        </div>
                      </td>
                      <td className="px-3 py-3 text-gray-700 text-xs font-medium">{a.product_name || a.vendor || '—'}
                          {a.product_version && <div className="text-[10px] text-gray-500 font-mono">{a.product_version}</div>}
                          {a.product_name && a.vendor && a.vendor !== a.product_name && <div className="text-[10px] text-gray-400">{a.vendor}</div>}</td>
                      <td className="px-3 py-3" onClick={e=>e.stopPropagation()}>
                        <SourceBadge source={a.source} contributing_sources={a.contributing_sources}
                          onSourceClick={(src)=>{setSource(src);setPage(1)}}/>
                      </td>
                      <td className="px-3 py-3 text-xs text-gray-600 truncate max-w-[120px]" title={a.cell_full_path||''}>{a.cell_full_path||'—'}</td>
                      <td className="px-3 py-3"><ComplianceRow asset={a}/></td>
                      <td className="px-3 py-3"><BackupCell value={a.last_backup_local}/></td>
                      <td className="px-3 py-3"><BackupCell value={a.last_backup_cloud}/></td>
                      <td className="px-3 py-3" onClick={e=>e.stopPropagation()}>
                        <div className="flex flex-wrap gap-1 max-w-xs">
                          {(a.tags||[]).map(t=>(
                            <TagBadge key={t.id} tag={t}
                              active={!!tagFilters.find(f=>f.id===t.id)}
                              onClick={()=>handleTagClick(t)}
                              asset={a} excMap={excMap}/>
                          ))}
                        </div>
                      </td>
                      <td className="px-3 py-3 text-xs text-gray-600">
                        {a.source === 'manual'
                          ? <span className="text-amber-700 font-medium">✏️ {a.created_by || 'usuario'}</span>
                          : a.last_sync ? format(new Date(a.last_sync),'dd/MM HH:mm') : '—'}
                      </td>
                      {isEditor() && (
                        <td className="px-2 py-3 text-right" onClick={e=>e.stopPropagation()}>
                          {a.source === 'manual' && (
                            <button
                              title="Eliminar activo manual"
                              className="text-red-400 hover:text-red-600 hover:bg-red-50 rounded p-1 transition-colors"
                              onClick={()=>{ if(window.confirm(`¿Eliminar "${a.name}"?\nEsta acción no se puede deshacer.`)) deleteMut.mutate(a.id) }}>
                              <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor">
                                <path fillRule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clipRule="evenodd"/>
                              </svg>
                            </button>
                          )}
                        </td>
                      )}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
        {total>50 && (
          <div className="flex items-center justify-between px-4 py-3 text-sm text-gray-700 border-t border-gray-100">
            <span>{(page-1)*50+1}–{Math.min(page*50,total)} de {total}</span>
            <div className="flex gap-2">
              <button className="btn-secondary text-xs" disabled={page===1} onClick={()=>setPage(p=>p-1)}>Anterior</button>
              <button className="btn-secondary text-xs" disabled={page*50>=total} onClick={()=>setPage(p=>p+1)}>Siguiente</button>
            </div>
          </div>
        )}
      </div>}

      {/* Leyenda */}
      <div className="flex items-center gap-4 text-xs text-gray-600 flex-wrap">
        <span className="font-medium text-gray-700">Compliance:</span>
        <span className="flex items-center gap-1.5"><span className="inline-flex px-1.5 py-0.5 rounded text-[10px] font-bold bg-green-100 text-green-800 border border-green-400">OK</span>Origen activo</span>
        <span className="flex items-center gap-1.5"><span className="inline-flex px-1.5 py-0.5 rounded text-[10px] font-bold compliance-gradient text-white border border-red-500">OK</span>OK + excepción activa</span>
        <span className="flex items-center gap-1.5"><span className="inline-flex px-1.5 py-0.5 rounded text-[10px] font-bold compliance-gradient-temp text-white border border-green-600">KO</span>KO con excepción justificada</span>
        <span className="flex items-center gap-1.5"><span className="inline-flex px-1.5 py-0.5 rounded text-[10px] font-bold bg-red-100 text-red-800 border border-red-400">KO</span>KO sin justificar</span>
      </div>

      {/* Modal: Asignar etiquetas */}
      <Modal open={bulkOpen} onClose={()=>setBulkOpen(false)} title="Asignar etiquetas a activos" maxW="max-w-2xl">
        <div className="space-y-4">
          <div>
            <p className="text-xs font-semibold text-gray-700 mb-2">1. Selecciona las etiquetas:</p>
            {(allTags||[]).length===0
              ? <p className="text-xs text-gray-600">No hay etiquetas manuales. Créalas en la sección Etiquetas.</p>
              : <div className="flex flex-wrap gap-2">
                  {(allTags||[]).map(t=>(
                    <button key={t.id} type="button"
                      onClick={()=>setBulkTags(s=>{const n=new Set(s);n.has(t.id)?n.delete(t.id):n.add(t.id);return n})}
                      className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold border cursor-pointer transition-all ${bulkTags.has(t.id)?'ring-2 ring-offset-1 ring-primary scale-105':'opacity-75 hover:opacity-100'}`}
                      style={colorBadgeStyle(t.color_code)}>
                      {bulkTags.has(t.id)?'✓ ':''}{t.name}
                    </button>
                  ))}
                </div>
            }
          </div>
          <div>
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs font-semibold text-gray-700">2. Activos que recibirán las etiquetas:</p>
              <label className="flex items-center gap-1.5 text-xs text-gray-700 cursor-pointer select-none">
                <input type="checkbox" className="accent-primary"
                  checked={selected.size===assets.length&&assets.length>0} onChange={toggleAll}/>
                Todos ({assets.length})
              </label>
            </div>
            <div className="border rounded-lg overflow-y-auto" style={{borderColor:'#E8CCCC',maxHeight:'240px'}}>
              {assets.length===0
                ? <p className="text-xs text-gray-600 p-3 text-center">No hay activos en la vista actual</p>
                : assets.map(a=>(
                    <label key={a.id}
                      className={`flex items-center gap-3 px-3 py-2 cursor-pointer border-b last:border-0 transition-colors ${selected.has(a.id)?'bg-red-50':'hover:bg-red-50/40'}`}
                      style={{borderColor:'#F0DDDD'}}>
                      <input type="checkbox" className="accent-primary flex-shrink-0" checked={selected.has(a.id)} onChange={()=>toggleSel(a.id)}/>
                      <AssetTypeBadge type={a.type}/>
                      <span className="font-semibold text-gray-900 flex-1 text-sm">{a.name}</span>
                      <span className="text-xs font-mono text-gray-600">{(a.ips||[])[0]||''}</span>
                    </label>
                  ))
              }
            </div>
            {selected.size>0 && <p className="text-xs font-semibold text-primary mt-1">{selected.size} activo{selected.size!==1?'s':''} seleccionado{selected.size!==1?'s':''}</p>}
          </div>
          <div className="flex justify-between items-center pt-2 border-t border-gray-100">
            <span className="text-xs text-gray-600">
              {bulkTags.size>0&&selected.size>0 ? `${bulkTags.size} etiqueta${bulkTags.size>1?'s':''} → ${selected.size} activo${selected.size>1?'s':''}` : 'Selecciona etiquetas y activos'}
            </span>
            <div className="flex gap-2">
              <button className="btn-secondary text-sm" onClick={()=>setBulkOpen(false)}>Cancelar</button>
              <button className="btn-primary text-sm" disabled={bulkTags.size===0||selected.size===0||bulkMut.isPending} onClick={()=>bulkMut.mutate()}>
                {bulkMut.isPending?<Spinner size="sm"/>:'Asignar'}
              </button>
            </div>
          </div>
        </div>
      </Modal>

      {/* Modal: Eliminar etiqueta */}
      <Modal open={untagOpen} onClose={()=>setUntagOpen(false)} title="Eliminar etiqueta de activos" maxW="max-w-2xl">
        <div className="space-y-4">
          <div>
            <p className="text-xs font-semibold text-gray-700 mb-2">1. Selecciona la etiqueta a eliminar:</p>
            {(allTags||[]).length===0
              ? <p className="text-xs text-gray-600">No hay etiquetas manuales.</p>
              : <div className="flex flex-wrap gap-2">
                  {(allTags||[]).map(t=>(
                    <button key={t.id} type="button"
                      onClick={()=>{ setUntagTag(t); setUntagSel(new Set()) }}
                      className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold border cursor-pointer transition-all ${untagTag?.id===t.id?'ring-2 ring-offset-1 ring-primary scale-105':'opacity-75 hover:opacity-100'}`}
                      style={colorBadgeStyle(t.color_code)}>
                      {untagTag?.id===t.id?'✓ ':''}{t.name}
                    </button>
                  ))}
                </div>
            }
          </div>

          {untagTag && (
            <div>
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs font-semibold text-gray-700">
                  2. Activos con{' '}
                  <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold border mx-1" style={colorBadgeStyle(untagTag.color_code)}>
                    {untagTag.name}
                  </span>
                  — marca los que perderán la etiqueta:
                </p>
                {!tagAssetsLoading && (tagAssetsData?.data||[]).length>0 && (
                  <label className="flex items-center gap-1.5 text-xs text-gray-700 cursor-pointer select-none">
                    <input type="checkbox" className="accent-primary"
                      checked={untagSel.size===(tagAssetsData?.data||[]).length&&(tagAssetsData?.data||[]).length>0}
                      onChange={()=>{ const all=tagAssetsData?.data||[]; setUntagSel(s=>s.size===all.length?new Set():new Set(all.map(a=>a.id))) }}/>
                    Todos ({(tagAssetsData?.data||[]).length})
                  </label>
                )}
              </div>
              <div className="border rounded-lg overflow-y-auto" style={{borderColor:'#E8CCCC',maxHeight:'240px'}}>
                {tagAssetsLoading ? (
                  <div className="p-4 flex justify-center"><Spinner/></div>
                ) : (tagAssetsData?.data||[]).length===0 ? (
                  <p className="text-xs text-gray-600 p-3 text-center">Ningún activo tiene esta etiqueta</p>
                ) : (tagAssetsData?.data||[]).map(a=>(
                  <label key={a.id}
                    className={`flex items-center gap-3 px-3 py-2 cursor-pointer border-b last:border-0 transition-colors ${untagSel.has(a.id)?'bg-red-50':'hover:bg-red-50/40'}`}
                    style={{borderColor:'#F0DDDD'}}>
                    <input type="checkbox" className="accent-primary flex-shrink-0"
                      checked={untagSel.has(a.id)}
                      onChange={()=>setUntagSel(s=>{const n=new Set(s);n.has(a.id)?n.delete(a.id):n.add(a.id);return n})}/>
                    <AssetTypeBadge type={a.type}/>
                    <span className="font-semibold text-gray-900 flex-1 text-sm">{a.name}</span>
                    <span className="text-xs font-mono text-gray-600">{(a.ips||[])[0]||''}</span>
                  </label>
                ))}
              </div>
              {untagSel.size>0 && <p className="text-xs font-semibold mt-1 text-red-700">Se eliminará la etiqueta de {untagSel.size} activo{untagSel.size!==1?'s':''}</p>}
            </div>
          )}

          <div className="flex justify-between items-center pt-2 border-t border-gray-100">
            <span className="text-xs text-gray-600">
              {untagTag&&untagSel.size>0 ? `Eliminar "${untagTag.name}" de ${untagSel.size} activo${untagSel.size>1?'s':''}` : 'Selecciona una etiqueta y los activos'}
            </span>
            <div className="flex gap-2">
              <button className="btn-secondary text-sm" onClick={()=>setUntagOpen(false)}>Cancelar</button>
              <button className="btn-danger text-sm" disabled={!untagTag||untagSel.size===0||untagMut.isPending} onClick={()=>untagMut.mutate()}>
                {untagMut.isPending?<Spinner size="sm"/>:'Eliminar etiqueta'}
              </button>
            </div>
          </div>
        </div>
      </Modal>

      {/* Modal: Nuevo activo manual */}
      <Modal open={newAssetOpen} onClose={()=>setNewAsset(false)} title="Nuevo activo manual" maxW="max-w-lg">
        <NewAssetForm
          onSubmit={d=>createMut.mutate(d)}
          loading={createMut.isPending}/>
        {createMut.isError && <p className="text-red-500 text-xs mt-2">{createMut.error?.message}</p>}
      </Modal>

    </div>
  )
}
