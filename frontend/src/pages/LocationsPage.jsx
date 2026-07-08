import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { locationsApi, assetsApi } from '../services/api'
import { Modal, Spinner, Empty, toast } from '../components/ui/index.jsx'
import { useAuth } from '../context/AuthContext'

const CELL_TYPE_LABELS = {
  datacenter:'🖥 CPD / Datacenter', serverroom:'🚪 Sala de Servidores',
  rack:'📦 Rack', cabinet:'🗄 Armario', floor:'🏢 Planta', zone:'🗺 Zona técnica', other:'📍 Otro',
}

// Forms
function ZoneForm({ initial, onSubmit, loading }) {
  const [f, setF] = useState(initial || { name:'', description:'' })
  return (
    <div className="space-y-3">
      <div><label className="text-xs text-gray-600 font-medium block mb-1">Nombre *</label>
        <input className="input" placeholder="Zona Norte, Organización Local…" value={f.name} onChange={e=>setF(p=>({...p,name:e.target.value}))}/></div>
      <div><label className="text-xs text-gray-600 font-medium block mb-1">Descripción</label>
        <textarea className="input h-16 resize-none" value={f.description||''} onChange={e=>setF(p=>({...p,description:e.target.value}))}/></div>
      <div className="flex justify-end">
        <button className="btn-primary" disabled={!f.name||loading} onClick={()=>onSubmit(f)}>
          {loading?<Spinner size="sm"/>:(initial?'Guardar':'Crear zona')}</button>
      </div>
    </div>
  )
}

function SiteForm({ initial, zones, onSubmit, loading }) {
  const [f, setF] = useState(initial || { zone_id:'', name:'', address:'', description:'' })
  return (
    <div className="space-y-3">
      <div><label className="text-xs text-gray-600 font-medium block mb-1">Zona *</label>
        <select className="input" value={f.zone_id||''} onChange={e=>setF(p=>({...p,zone_id:e.target.value}))}>
          <option value="">— Seleccionar zona —</option>
          {zones.map(z=><option key={z.id} value={z.id}>{z.name}</option>)}
        </select></div>
      <div><label className="text-xs text-gray-600 font-medium block mb-1">Nombre *</label>
        <input className="input" placeholder="Edificio Principal, CPD Externo…" value={f.name} onChange={e=>setF(p=>({...p,name:e.target.value}))}/></div>
      <div><label className="text-xs text-gray-600 font-medium block mb-1">Dirección</label>
        <input className="input" placeholder="C/ Mayor 1, Administración Pública Local…" value={f.address||''} onChange={e=>setF(p=>({...p,address:e.target.value}))}/></div>
      <div><label className="text-xs text-gray-600 font-medium block mb-1">Descripción</label>
        <textarea className="input h-14 resize-none" value={f.description||''} onChange={e=>setF(p=>({...p,description:e.target.value}))}/></div>
      <div className="flex justify-end">
        <button className="btn-primary" disabled={!f.zone_id||!f.name||loading} onClick={()=>onSubmit(f)}>
          {loading?<Spinner size="sm"/>:(initial?'Guardar':'Crear localización')}</button>
      </div>
    </div>
  )
}

function CellForm({ initial, sites, onSubmit, loading }) {
  const [f, setF] = useState(initial || { site_id:'', name:'', cell_type:'', row_id:'', rack_unit:'', description:'' })
  return (
    <div className="space-y-3">
      <div><label className="text-xs text-gray-600 font-medium block mb-1">Localización *</label>
        <select className="input" value={f.site_id||''} onChange={e=>setF(p=>({...p,site_id:e.target.value}))}>
          <option value="">— Seleccionar localización —</option>
          {sites.map(s=><option key={s.id} value={s.id}>{s.zone_name?`${s.zone_name} › `:''}{s.name}</option>)}
        </select></div>
      <div className="grid grid-cols-2 gap-3">
        <div><label className="text-xs text-gray-600 font-medium block mb-1">Nombre *</label>
          <input className="input" placeholder="CPD Principal, Rack A…" value={f.name} onChange={e=>setF(p=>({...p,name:e.target.value}))}/></div>
        <div><label className="text-xs text-gray-600 font-medium block mb-1">Tipo</label>
          <select className="input" value={f.cell_type||''} onChange={e=>setF(p=>({...p,cell_type:e.target.value}))}>
            <option value="">— Sin tipo —</option>
            {Object.entries(CELL_TYPE_LABELS).map(([v,l])=><option key={v} value={v}>{l}</option>)}
          </select></div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div><label className="text-xs text-gray-600 font-medium block mb-1">Fila / Zona CPD</label>
          <input className="input" placeholder="Fila A, Pasillo Frío…" value={f.row_id||''} onChange={e=>setF(p=>({...p,row_id:e.target.value}))}/></div>
        <div><label className="text-xs text-gray-600 font-medium block mb-1">Posición rack (U)</label>
          <input className="input" placeholder="U1-U42, U12…" value={f.rack_unit||''} onChange={e=>setF(p=>({...p,rack_unit:e.target.value}))}/></div>
      </div>
      <div><label className="text-xs text-gray-600 font-medium block mb-1">Descripción</label>
        <textarea className="input h-14 resize-none" value={f.description||''} onChange={e=>setF(p=>({...p,description:e.target.value}))}/></div>
      <div className="flex justify-end">
        <button className="btn-primary" disabled={!f.site_id||!f.name||loading} onClick={()=>onSubmit(f)}>
          {loading?<Spinner size="sm"/>:(initial?'Guardar':'Crear celda')}</button>
      </div>
    </div>
  )
}

// Bulk Assign Modal
function BulkAssignModal({ cell, onClose }) {
  const qc = useQueryClient()
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState(new Set())
  const { data:assetsData } = useQuery({
    queryKey: ['assets-bulk', search],
    queryFn: () => assetsApi.list({ search, page_size: 50 }),
  })
  const { data:currentAssets, refetch } = useQuery({
    queryKey: ['cell-assets', cell.id],
    queryFn: () => locationsApi.cellAssets(cell.id),
  })
  const assets = assetsData?.data || assetsData || []
  const already = new Set((currentAssets||[]).map(a=>a.id))

  const assignMut = useMutation({
    mutationFn: (ids) => locationsApi.bulkAssign(cell.id, ids),
    onSuccess: (r) => {
      qc.invalidateQueries({queryKey:['cell-assets']})
      refetch()
      setSelected(new Set())
      toast(`${r.updated} asset${r.updated!==1?'s':''} asignado${r.updated!==1?'s':''} a "${cell.name}"`)
    },
    onError: e => toast(e.message,'error'),
  })
  const unassignMut = useMutation({
    mutationFn: (ids) => locationsApi.bulkAssign(null, ids),
    onSuccess: (r) => {
      qc.invalidateQueries({queryKey:['cell-assets']})
      refetch()
      toast(`${r.updated} asset${r.updated!==1?'s':''} desvinculado${r.updated!==1?'s':''}`)
    },
    onError: e => toast(e.message,'error'),
  })

  const toggle = (id) => setSelected(s => { const n=new Set(s); n.has(id)?n.delete(id):n.add(id); return n })

  return (
    <div className="space-y-4">
      {/* Assets actuales */}
      {(currentAssets||[]).length > 0 && (
        <div>
          <p className="text-xs text-gray-600 font-semibold mb-2">Assets en esta celda ({currentAssets.length})</p>
          <div className="space-y-1 max-h-32 overflow-y-auto">
            {currentAssets.map(a=>(
              <div key={a.id} className="flex items-center justify-between px-3 py-1.5 rounded text-sm" style={{backgroundColor:"#FFF8F8",border:"1px solid #F0DDDD"}}>
                <span className="text-gray-800">{a.name}</span>
                <span className="text-xs text-gray-700">{a.type}</span>
                <button className="text-red-400 hover:text-red-300 text-xs ml-2"
                  onClick={()=>unassignMut.mutate([a.id])}>Desvincular</button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Búsqueda y selección masiva */}
      <div>
        <p className="text-xs text-gray-600 font-semibold mb-2">Añadir assets del inventario</p>
        <input className="input mb-2" placeholder="Buscar asset…" value={search} onChange={e=>setSearch(e.target.value)}/>
        {assets.length > 0 && (
          <div className="space-y-1 max-h-48 overflow-y-auto rounded-lg" style={{border:"1px solid #E8CCCC"}}>
            {assets.filter(a=>!already.has(a.id)).map(a=>(
              <label key={a.id} className={`flex items-center gap-3 px-3 py-2 cursor-pointer hover:bg-red-50/50 ${selected.has(a.id)?'bg-primary/10':''}`}>
                <input type="checkbox" className="accent-primary" checked={selected.has(a.id)} onChange={()=>toggle(a.id)}/>
                <span className="text-sm text-gray-800 flex-1">{a.name}</span>
                <span className="text-xs text-gray-700">{a.type}</span>
                <span className="text-xs text-gray-700">{(a.ips||[])[0]||''}</span>
              </label>
            ))}
          </div>
        )}
      </div>

      <div className="flex items-center justify-between pt-2">
        <p className="text-xs text-gray-700">{selected.size} seleccionado{selected.size!==1?'s':''}</p>
        <div className="flex gap-2">
          <button className="btn-secondary text-xs" onClick={onClose}>Cerrar</button>
          <button className="btn-primary text-xs" disabled={selected.size===0||assignMut.isPending}
            onClick={()=>assignMut.mutate([...selected])}>
            {assignMut.isPending?<Spinner size="sm"/>:`Asignar (${selected.size})`}
          </button>
        </div>
      </div>
    </div>
  )
}

// Main Page
export default function LocationsPage() {
  const qc = useQueryClient()
  const { isEditor } = useAuth()
  const [modal, setModal] = useState(null) // {type:'zone'|'site'|'cell'|'assign', data?:...}

  const { data:tree, isLoading } = useQuery({ queryKey:['locations-tree'], queryFn:locationsApi.tree })
  const { data:zones } = useQuery({ queryKey:['zones'], queryFn:locationsApi.listZones })
  const { data:sitesAll } = useQuery({ queryKey:['sites'], queryFn:()=>locationsApi.listSites() })

  const zoneList = Array.isArray(zones) ? zones : []
  const siteList = Array.isArray(sitesAll) ? sitesAll : []
  const treeData = Array.isArray(tree) ? tree : []

  const inv = (keys) => keys.forEach(k=>qc.invalidateQueries({queryKey:[k],exact:false}))

  // Zone mutations
  const createZoneMut = useMutation({ mutationFn:locationsApi.createZone,
    onSuccess:()=>{inv(['locations-tree','zones']);setModal(null);toast('Zona creada')}, onError:e=>toast(e.message,'error') })
  const updateZoneMut = useMutation({ mutationFn:({id,...d})=>locationsApi.updateZone(id,d),
    onSuccess:()=>{inv(['locations-tree','zones']);setModal(null);toast('Zona actualizada')}, onError:e=>toast(e.message,'error') })
  const deleteZoneMut = useMutation({ mutationFn:locationsApi.deleteZone,
    onSuccess:()=>{inv(['locations-tree','zones','sites','cells']);toast('Zona eliminada')}, onError:e=>toast(e.message,'error') })

  // Site mutations
  const createSiteMut = useMutation({ mutationFn:locationsApi.createSite,
    onSuccess:()=>{inv(['locations-tree','sites']);setModal(null);toast('Localización creada')}, onError:e=>toast(e.message,'error') })
  const updateSiteMut = useMutation({ mutationFn:({id,...d})=>locationsApi.updateSite(id,d),
    onSuccess:()=>{inv(['locations-tree','sites']);setModal(null);toast('Localización actualizada')}, onError:e=>toast(e.message,'error') })
  const deleteSiteMut = useMutation({ mutationFn:locationsApi.deleteSite,
    onSuccess:()=>{inv(['locations-tree','sites','cells']);toast('Localización eliminada')}, onError:e=>toast(e.message,'error') })

  // Cell mutations
  const createCellMut = useMutation({ mutationFn:locationsApi.createCell,
    onSuccess:()=>{inv(['locations-tree','cells']);setModal(null);toast('Celda creada')}, onError:e=>toast(e.message,'error') })
  const updateCellMut = useMutation({ mutationFn:({id,...d})=>locationsApi.updateCell(id,d),
    onSuccess:()=>{inv(['locations-tree','cells']);setModal(null);toast('Celda actualizada')}, onError:e=>toast(e.message,'error') })
  const deleteCellMut = useMutation({ mutationFn:locationsApi.deleteCell,
    onSuccess:()=>{inv(['locations-tree','cells']);toast('Celda eliminada')}, onError:e=>toast(e.message,'error') })

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Localizaciones</h1>
          <p className="text-xs text-gray-600 mt-0.5">Zonas → Localizaciones físicas → Celdas / CPDs / Racks</p>
        </div>
        {isEditor() && (
          <div className="flex gap-2">
            <button className="btn-primary text-xs" onClick={()=>setModal({type:'zone'})}>+ Zona</button>
            <button className="btn-secondary text-xs" onClick={()=>setModal({type:'site'})}>+ Localización</button>
            <button className="btn-secondary text-xs" onClick={()=>setModal({type:'cell'})}>+ Celda</button>
          </div>
        )}
      </div>

      {/* Tree */}
      <div className="space-y-3">
        {isLoading ? <div className="card p-8 flex justify-center"><Spinner/></div>
          : treeData.length===0 ? <Empty message="Sin localizaciones. Crea una zona primero."/>
          : treeData.map(zone=>(
          <div key={zone.id} className="card overflow-hidden">
            {/* Zone header */}
            <div className="px-4 py-3 flex items-center justify-between" style={{backgroundColor:"#FEF2F2",borderBottom:"1px solid #FECACA"}}>
              <div className="flex items-center gap-3">
                <span className="text-lg">🗺</span>
                <div>
                  <p className="font-semibold text-gray-900 text-sm">{zone.name}</p>
                  {zone.description && <p className="text-xs text-gray-700">{zone.description}</p>}
                </div>
                <span className="badge text-xs font-semibold" style={{backgroundColor:"#C8001D20",color:"#9B0016",borderColor:"#C8001D60",border:"1px solid"}}>{zone.site_count} localización{zone.site_count!==1?'es':''}</span>
              </div>
              {isEditor() && (
                <div className="flex gap-1">
                  <button className="btn-secondary text-xs py-0.5" onClick={()=>setModal({type:'zone-edit',data:zone})}>Editar</button>
                  <button className="text-red-600 hover:text-red-800 text-xs px-1 font-semibold"
                    onClick={()=>{if(confirm(`¿Eliminar zona "${zone.name}" y todas sus localizaciones?`))deleteZoneMut.mutate(zone.id)}}>✕</button>
                </div>
              )}
            </div>

            {/* Sites */}
            {(zone.sites||[]).length===0
              ? <p className="text-xs text-gray-600 px-4 py-3">Sin localizaciones físicas.</p>
              : (zone.sites||[]).map(site=>(
              <div key={site.id} className="border-b last:border-0" style={{borderColor:"#E5E7EB"}}>
                {/* Site row */}
                <div className="px-6 py-2.5 flex items-center justify-between" style={{backgroundColor:"#F3F4F6",borderBottom:"1px solid #E5E7EB"}}>
                  <div className="flex items-center gap-2">
                    <span>🏛</span>
                    <p className="font-medium text-gray-800 text-sm">{site.name}</p>
                    {site.address && <p className="text-xs text-gray-700">— {site.address}</p>}
                    <span className="badge text-xs" style={{backgroundColor:"#F3F4F6",color:"#374151",border:"1px solid #D1D5DB"}}>{site.cell_count} celda{site.cell_count!==1?'s':''}</span>
                  </div>
                  {isEditor() && (
                    <div className="flex gap-1">
                      <button className="btn-secondary text-xs py-0.5" onClick={()=>setModal({type:'site-edit',data:site})}>Editar</button>
                      <button className="text-red-600 hover:text-red-800 text-xs px-1 font-semibold"
                        onClick={()=>{if(confirm(`¿Eliminar "${site.name}" y sus celdas?`))deleteSiteMut.mutate(site.id)}}>✕</button>
                    </div>
                  )}
                </div>

                {/* Cells */}
                {(site.cells||[]).length===0
                  ? <p className="text-xs text-gray-600 px-10 py-2">Sin celdas.</p>
                  : (
                  <div className="grid grid-cols-2 gap-2 px-8 py-2">
                    {(site.cells||[]).map(cell=>(
                      <div key={cell.id} className="flex items-center justify-between p-2.5 rounded-lg" style={{backgroundColor:"#FFFFFF",border:"1px solid #E5E7EB"}}>
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-sm">{CELL_TYPE_LABELS[cell.cell_type]?.split(' ')[0]||'📍'}</span>
                            <p className="text-sm font-medium text-gray-800 truncate">{cell.name}</p>
                            {cell.cell_type && <span className="badge text-[10px]" style={{backgroundColor:"#F3F4F6",color:"#374151",border:"1px solid #D1D5DB"}}>{cell.cell_type}</span>}
                          </div>
                          {(cell.row_id||cell.rack_unit) && (
                            <p className="text-xs text-gray-600 mt-0.5 pl-6">{[cell.row_id,cell.rack_unit].filter(Boolean).join(' · ')}</p>
                          )}
                        </div>
                        {isEditor() && (
                          <div className="flex gap-1 shrink-0 ml-2">
                            <button className="btn-secondary text-xs py-0.5 px-1.5"
                              onClick={()=>setModal({type:'assign',data:cell})}>Asignar assets</button>
                            <button className="btn-secondary text-xs py-0.5 px-1.5"
                              onClick={()=>setModal({type:'cell-edit',data:cell})}>✎</button>
                            <button className="text-red-600 hover:text-red-800 text-xs px-1 font-semibold"
                              onClick={()=>{if(confirm(`¿Eliminar celda "${cell.name}"?`))deleteCellMut.mutate(cell.id)}}>✕</button>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        ))}
      </div>

      {/* Modals */}
      <Modal open={modal?.type==='zone'} onClose={()=>setModal(null)} title="Nueva zona">
        <ZoneForm onSubmit={d=>createZoneMut.mutate(d)} loading={createZoneMut.isPending}/>
      </Modal>
      <Modal open={modal?.type==='zone-edit'} onClose={()=>setModal(null)} title="Editar zona">
        {modal?.data && <ZoneForm initial={modal.data} onSubmit={d=>updateZoneMut.mutate({id:modal.data.id,...d})} loading={updateZoneMut.isPending}/>}
      </Modal>
      <Modal open={modal?.type==='site'} onClose={()=>setModal(null)} title="Nueva localización física">
        <SiteForm zones={zoneList} onSubmit={d=>createSiteMut.mutate(d)} loading={createSiteMut.isPending}/>
      </Modal>
      <Modal open={modal?.type==='site-edit'} onClose={()=>setModal(null)} title="Editar localización física">
        {modal?.data && <SiteForm initial={modal.data} zones={zoneList} onSubmit={d=>updateSiteMut.mutate({id:modal.data.id,...d})} loading={updateSiteMut.isPending}/>}
      </Modal>
      <Modal open={modal?.type==='cell'} onClose={()=>setModal(null)} title="Nueva celda / CPD / Rack">
        <CellForm sites={siteList} onSubmit={d=>createCellMut.mutate(d)} loading={createCellMut.isPending}/>
      </Modal>
      <Modal open={modal?.type==='cell-edit'} onClose={()=>setModal(null)} title="Editar celda">
        {modal?.data && <CellForm initial={modal.data} sites={siteList} onSubmit={d=>updateCellMut.mutate({id:modal.data.id,...d})} loading={updateCellMut.isPending}/>}
      </Modal>
      <Modal open={modal?.type==='assign'} onClose={()=>setModal(null)}
        title={modal?.data?`Asignar assets a "${modal.data.name}"`:''}>
        {modal?.data && <BulkAssignModal cell={modal.data} onClose={()=>setModal(null)}/>}
      </Modal>
    </div>
  )
}
