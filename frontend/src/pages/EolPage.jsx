import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { eolApi, assetsApi } from '../services/api'
import { Modal, Spinner, Empty, TableSkeleton, toast } from '../components/ui/index.jsx'
import { AssetTypeBadge } from '../components/ui/index.jsx'
import { useAuth } from '../context/AuthContext'
import { format } from 'date-fns'
import { es } from 'date-fns/locale/es'

// Helpers visuales

function EolStatusBadge({ status }) {
  if (status === 'eol')     return <span className="badge bg-red-100 text-red-800 border border-red-400 font-bold">❌ Sin soporte</span>
  if (status === 'warning') return <span className="badge bg-amber-100 text-amber-800 border border-amber-400 font-semibold">⚠ Próximo</span>
  if (status === 'ok')      return <span className="badge bg-green-100 text-green-800 border border-green-400 font-semibold">✓ Soportado</span>
  return <span className="badge bg-gray-100 text-gray-600 border border-gray-300">Sin fecha</span>
}

function SyncBadge({ status, lastSync }) {
  if (status === 'unsynced')
    return <span className="badge bg-red-50 text-red-700 border border-red-300 font-semibold">🔴 unsynced</span>
  return (
    <span className="badge bg-green-50 text-green-700 border border-green-400 font-semibold">
      ✓ sync {lastSync ? format(new Date(lastSync), 'dd/MM/yy HH:mm', { locale: es }) : ''}
    </span>
  )
}

function EolDaysCell({ eolDate, eolBoolean }) {
  if (eolBoolean === true) return <span className="text-xs text-red-700 font-bold">Sin soporte</span>
  if (!eolDate) return <span className="text-xs text-gray-600">—</span>
  const days = Math.floor((new Date(eolDate) - new Date()) / 86400000)
  if (days < 0)   return <span className="text-xs text-red-700 font-bold">Expirado hace {Math.abs(days)}d</span>
  if (days <= 365) return <span className="text-xs text-amber-700 font-semibold">⚠ {days}d ({Math.floor(days/365*10)/10}a)</span>
  return <span className="text-xs text-green-700">{days}d ({Math.floor(days/365)}a)</span>
}

// Modal: assets afectados por estado EOL

function AssetsEolModal({ productId, productName, status, onClose }) {
  const { data: assets, isLoading } = useQuery({
    queryKey: ['eol-product-assets', productId, status],
    queryFn: () => status === 'unknown'
      ? eolApi.productAssetsUnknown(productId)
      : eolApi.productAssets(productId, status),
    enabled: !!productId,
  })

  const statusLabel = { eol: 'Sin soporte (EOL KO)', warning: 'Próximos a EOL (EOL WARN)', ok: 'Soportados (EOL OK)', unknown: 'Sin versión mapeada' }
  const statusColor = { eol: 'text-red-700', warning: 'text-amber-700', ok: 'text-green-700', unknown: 'text-gray-600' }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <p className="text-sm text-gray-700">
          Activos con estado <span className={`font-bold ${statusColor[status]}`}>{statusLabel[status]}</span> para <span className="font-semibold">{productName}</span>
        </p>
      </div>
      {isLoading ? <div className="flex justify-center p-6"><Spinner/></div>
        : !assets?.length ? (
          <div className="text-center py-8 text-gray-600 text-sm">
            <p>Ningún activo tiene este estado EOL para este producto.</p>
            <p className="text-xs mt-1">Usa "🏷 Recalcular etiquetas" en la página EOL para actualizar.</p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-gray-600 uppercase font-semibold" style={{backgroundColor:'#F3F4F6',borderBottom:'2px solid #E5E7EB'}}>
                <th className="px-3 py-2 text-left">Activo</th>
                <th className="px-3 py-2 text-left">Tipo</th>
                <th className="px-3 py-2 text-left">OS / Motor BD</th>
                <th className="px-3 py-2 text-left">IPs</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {assets.map(a => (
                <tr key={a.id} className="hover:bg-red-50/30 transition-colors">
                  <td className="px-3 py-2 font-semibold text-gray-900">{a.name}</td>
                  <td className="px-3 py-2"><AssetTypeBadge type={a.type}/></td>
                  <td className="px-3 py-2 text-xs text-gray-700">
                    {a.os || (a.db_engine ? `${a.db_engine} ${a.db_version||''}`.trim() : '—')}
                  </td>
                  <td className="px-3 py-2 text-xs font-mono text-gray-600">{(a.ips||[]).join(', ')||'—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      <div className="flex justify-end pt-2">
        <button className="btn-secondary" onClick={onClose}>Cerrar</button>
      </div>
    </div>
  )
}

// Detalle de producto: tabla de versiones

function ProductDetail({ productId, onClose, isAdmin }) {
  const qc = useQueryClient()
  const [editCycle, setEditCycle] = useState(null)
  const [editForm, setEditForm] = useState({ custom_eol_date: '', custom_notes: '' })
  const [assetsModal, setAssetsModal] = useState(null) // {status}

  const { data, isLoading } = useQuery({
    queryKey: ['eol-cycles', productId],
    queryFn: () => eolApi.listCycles(productId),
  })

  const updateCycleMut = useMutation({
    mutationFn: ({ cid, body }) => eolApi.updateCycle(productId, cid, body),
    onSuccess: (data) => {
      // Recalcular todo: ciclos, lista de productos, assets del inventario y dashboard
      qc.refetchQueries({ queryKey: ['eol-cycles', productId] })
      qc.refetchQueries({ queryKey: ['eol-products'] })
      qc.invalidateQueries({ queryKey: ['assets'], exact: false })
      qc.invalidateQueries({ queryKey: ['dashboard'] })
      setEditCycle(null)
      const n = data?.retag_updated ?? 0
      toast(`Versión actualizada${n > 0 ? ` · ${n} activo${n>1?'s':''} recalculado${n>1?'s':''}` : ''}`)
    },
    onError: e => toast(e.message, 'error'),
  })

  const product = data?.product
  const cycles  = data?.cycles || []

  // Contadores para las etiquetas clickables
  const eolCount     = cycles.filter(c => c.eol_status === 'eol').length
  const warnCount    = cycles.filter(c => c.eol_status === 'warning').length
  const okCount      = cycles.filter(c => c.eol_status === 'ok').length

  return (
    <div className="space-y-4">
      {/* Cabecera producto */}
      {product && (
        <div className="flex items-center justify-between pb-3 border-b border-gray-100">
          <div className="flex items-center gap-3">
            <SyncBadge status={product.sync_status} lastSync={product.last_synced_at}/>
            {product.notes && <span className="text-xs text-gray-600 italic">{product.notes}</span>}
          </div>
          {/* Badges clicables de resumen */}
          <div className="flex gap-2">
            {eolCount > 0 && (
              <button onClick={() => setAssetsModal('eol')}
                className="badge bg-red-100 text-red-800 border border-red-400 font-bold cursor-pointer hover:bg-red-200 transition-colors">
                {eolCount} sin soporte →
              </button>
            )}
            {warnCount > 0 && (
              <button onClick={() => setAssetsModal('warning')}
                className="badge bg-amber-100 text-amber-800 border border-amber-400 font-semibold cursor-pointer hover:bg-amber-200 transition-colors">
                {warnCount} próximos →
              </button>
            )}
            {okCount > 0 && (
              <button onClick={() => setAssetsModal('ok')}
                className="badge bg-green-100 text-green-800 border border-green-400 font-semibold cursor-pointer hover:bg-green-200 transition-colors">
                {okCount} soportados →
              </button>
            )}
          </div>
        </div>
      )}

      {/* Tabla de versiones */}
      {isLoading ? <TableSkeleton rows={5} cols={7}/> : cycles.length === 0 ? (
        <Empty message="Sin versiones registradas. Usa el botón Sync para descargar desde endoflife.date."/>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-gray-600 uppercase font-semibold" style={{backgroundColor:'#F3F4F6',borderBottom:'2px solid #E5E7EB'}}>
                <th className="px-3 py-2 text-left">Versión</th>
                <th className="px-3 py-2 text-left">Lanzamiento</th>
                <th className="px-3 py-2 text-left">EOL oficial</th>
                <th className="px-3 py-2 text-left">Override EOL</th>
                <th className="px-3 py-2 text-left">Días restantes</th>
                <th className="px-3 py-2 text-left">Estado</th>
                <th className="px-3 py-2 text-left">Sync</th>
                {isAdmin && <th className="px-3 py-2 text-right">Acción</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {cycles.map(c => (
                <tr key={c.id} className={`hover:bg-red-50/40 transition-colors ${c.sync_status === 'unsynced' ? 'bg-red-50/60' : ''}`}>
                  <td className="px-3 py-2">
                    <span className="font-mono font-semibold text-gray-900">{c.cycle}</span>
                    {c.lts && <span className="ml-1 text-[10px] bg-blue-100 text-blue-800 border border-blue-300 px-1 rounded font-bold">LTS</span>}
                    {c.custom_eol_date && <span className="ml-1 text-[10px] bg-violet-100 text-violet-700 border border-violet-300 px-1 rounded">custom</span>}
                  </td>
                  <td className="px-3 py-2 text-xs text-gray-700">
                    {c.release_date ? format(new Date(c.release_date),'dd/MM/yyyy',{locale:es}) : '—'}
                  </td>
                  <td className="px-3 py-2 text-xs font-medium">
                    {c.eol_boolean === true
                      ? <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-bold bg-red-100 text-red-800 border border-red-400">Sin soporte</span>
                      : c.eol_date
                        ? <span className={c.eol_status==='eol'?'text-red-700 font-bold':c.eol_status==='warning'?'text-amber-700 font-semibold':'text-gray-700'}>
                            {format(new Date(c.eol_date),'dd/MM/yyyy',{locale:es})}
                          </span>
                        : <span className="text-gray-500">—</span>}
                  </td>
                  <td className="px-3 py-2">
                    {c.custom_eol_date
                      ? <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-violet-100 text-violet-800 border border-violet-400">
                          ✎ {format(new Date(c.custom_eol_date),'dd/MM/yyyy',{locale:es})}
                        </span>
                      : <span className="text-xs text-gray-400 italic">—</span>}
                    {c.custom_notes && <p className="text-[10px] text-gray-600 mt-0.5 italic truncate max-w-[160px]" title={c.custom_notes}>{c.custom_notes}</p>}
                  </td>
                  <td className="px-3 py-2"><EolDaysCell eolDate={c.effective_eol_date} eolBoolean={c.eol_boolean}/></td>
                  <td className="px-3 py-2"><EolStatusBadge status={c.eol_status}/></td>
                  <td className="px-3 py-2"><SyncBadge status={c.sync_status} lastSync={c.last_synced_at}/></td>
                  {isAdmin && (
                    <td className="px-3 py-2 text-right">
                      <button className="btn-secondary text-xs" onClick={() => {
                        setEditCycle(c)
                        setEditForm({ custom_eol_date: c.custom_eol_date || '', custom_notes: c.custom_notes || '' })
                      }}>✎ Editar</button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Modal edición de versión */}
      <Modal open={!!editCycle} onClose={() => setEditCycle(null)} title={`Editar versión ${editCycle?.cycle}`}>
        {editCycle && (
          <div className="space-y-3">
            <p className="text-xs text-gray-700 bg-amber-50 border border-amber-200 rounded px-3 py-2">
              Los valores custom sobrescriben los de endoflife.date. Los datos originales se conservan.
            </p>
            <div>
              <label className="block text-xs text-gray-700 font-medium mb-1">
                Fecha EOL personalizada <span className="text-gray-500">(vacío = usar la de endoflife.date)</span>
              </label>
              <input type="date" className="input"
                value={editForm.custom_eol_date}
                onChange={e => setEditForm(p => ({...p, custom_eol_date: e.target.value}))}/>
            </div>
            <div>
              <label className="block text-xs text-gray-700 font-medium mb-1">Notas de esta versión</label>
              <textarea className="input resize-none" rows={3}
                placeholder="Notas específicas de esta versión en tu entorno..."
                value={editForm.custom_notes}
                onChange={e => setEditForm(p => ({...p, custom_notes: e.target.value}))}/>
            </div>
            <div className="flex gap-2 justify-end pt-2">
              <button className="btn-secondary" onClick={() => setEditCycle(null)}>Cancelar</button>
              <button className="btn-primary" disabled={updateCycleMut.isPending}
                onClick={() => updateCycleMut.mutate({
                  cid: editCycle.id,
                  body: { custom_eol_date: editForm.custom_eol_date || null, custom_notes: editForm.custom_notes || null }
                })}>
                {updateCycleMut.isPending ? <Spinner size="sm"/> : 'Guardar'}
              </button>
            </div>
          </div>
        )}
      </Modal>

      {/* Modal assets afectados */}
      <Modal open={!!assetsModal} onClose={() => setAssetsModal(null)}
        title={`Activos afectados — ${product?.display_name || productId}`}
        maxW="max-w-3xl">
        {assetsModal && (
          <AssetsEolModal
            productId={productId}
            productName={product?.display_name || productId}
            status={assetsModal}
            onClose={() => setAssetsModal(null)}
          />
        )}
      </Modal>
    </div>
  )
}

// Modal añadir ciclo EOL personalizado

function AddCustomModal({ pendingProducts, existingProducts, onClose }) {
  const qc = useQueryClient()
  const [selectedProduct, setSelectedProduct] = useState('')
  const [newProductId, setNewProductId] = useState('')
  const [cycle, setCycle]     = useState('')
  const [eolDate, setEolDate] = useState('')
  const [notes, setNotes]     = useState('')
  const [mode, setMode]       = useState('detected') // 'detected' | 'existing' | 'new'

  const effectiveProductId = mode === 'new' ? newProductId : selectedProduct

  const addCustomMut = useMutation({
    mutationFn: () => eolApi.addCustomCycle(effectiveProductId, {
      cycle: cycle || 'custom',
      eol_date: eolDate,
      notes,
    }),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['eol-products'] })
      qc.invalidateQueries({ queryKey: ['eol-detected'] })
      qc.invalidateQueries({ queryKey: ['assets'] })
      const n = data?.retag_updated || 0
      toast(`Ciclo EOL personalizado creado${n > 0 ? ` · ${n} activo(s) recalculado(s)` : ''}`)
      onClose()
    },
    onError: e => toast(e.message, 'error'),
  })

  // Si el producto no existe aún, crearlo primero
  const createAndAddMut = useMutation({
    mutationFn: async () => {
      // Crear el producto custom si no existe
      await eolApi.addProduct(effectiveProductId, {
        display_name: effectiveProductId.replace(/-/g,' ').replace(/\b\w/g,l=>l.toUpperCase()),
        category: 'Custom',
        notes: 'Producto personalizado — sin datos en endoflife.date',
      }).catch(() => {}) // ignorar si ya existe
      // Añadir el ciclo
      return eolApi.addCustomCycle(effectiveProductId, {
        cycle: cycle || 'custom',
        eol_date: eolDate,
        notes,
      })
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['eol-products'] })
      qc.invalidateQueries({ queryKey: ['eol-detected'] })
      qc.invalidateQueries({ queryKey: ['assets'] })
      const n = data?.retag_updated || 0
      toast(`EOL personalizado creado${n > 0 ? ` · ${n} activo(s) recalculado(s)` : ''}`)
      onClose()
    },
    onError: e => toast(e.message, 'error'),
  })

  const isValid = effectiveProductId && eolDate
  const isPending = addCustomMut.isPending || createAndAddMut.isPending

  const handleSubmit = () => {
    // Si mode='detected' y el producto no está en la lista registrada, crearlo
    const registered = existingProducts.map(p => p.product_id)
    if (!registered.includes(effectiveProductId) || mode === 'new') {
      createAndAddMut.mutate()
    } else {
      addCustomMut.mutate()
    }
  }

  return (
    <div className="space-y-4">
      <p className="text-xs text-gray-600 bg-blue-50 border border-blue-200 rounded-lg px-3 py-2">
        Los ciclos personalizados permiten definir fechas EOL para software interno o productos
        no cubiertos por <strong>endoflife.date</strong>. Al guardar se recalculan automáticamente
        las etiquetas EOL de los activos afectados.
      </p>

      {/* Modo de selección */}
      <div className="flex gap-1 bg-gray-100 p-1 rounded-lg w-fit">
        {[
          { key:'detected', label:`Detectados (${pendingProducts.length})` },
          { key:'existing', label:'Ya registrados' },
          { key:'new',      label:'Nuevo producto' },
        ].map(m => (
          <button key={m.key} onClick={() => { setMode(m.key); setSelectedProduct('') }}
            className={`px-3 py-1 rounded-md text-xs font-medium transition-all
              ${mode === m.key ? 'bg-white shadow text-gray-900' : 'text-gray-600'}`}>
            {m.label}
          </button>
        ))}
      </div>

      {/* Selector de producto */}
      {mode === 'detected' && (
        pendingProducts.length === 0
          ? <p className="text-sm text-gray-500 italic">✓ Todos los productos detectados ya están registrados.</p>
          : <div>
              <label className="text-xs text-gray-600 font-medium block mb-1">
                Producto detectado en inventario *
              </label>
              <select className="input w-full" value={selectedProduct}
                onChange={e => setSelectedProduct(e.target.value)}>
                <option value="">— Selecciona un producto —</option>
                {pendingProducts.map(p => (
                  <option key={p.product_id} value={p.product_id}>
                    {p.product_id} ({p.asset_count} activo{p.asset_count !== 1 ? 's' : ''})
                  </option>
                ))}
              </select>
            </div>
      )}

      {mode === 'existing' && (
        <div>
          <label className="text-xs text-gray-600 font-medium block mb-1">
            Producto ya registrado *
          </label>
          <select className="input w-full" value={selectedProduct}
            onChange={e => setSelectedProduct(e.target.value)}>
            <option value="">— Selecciona un producto —</option>
            {existingProducts.map(p => (
              <option key={p.product_id} value={p.product_id}>
                {p.display_name || p.product_id} ({p.category || 'sin categoría'})
              </option>
            ))}
          </select>
        </div>
      )}

      {mode === 'new' && (
        <div>
          <label className="text-xs text-gray-600 font-medium block mb-1">
            ID del nuevo producto * <span className="text-gray-400">(slug único, ej: "app-padron-v2")</span>
          </label>
          <input className="input w-full font-mono" placeholder="mi-software-interno"
            value={newProductId} onChange={e => setNewProductId(e.target.value.toLowerCase().replace(/\s/g,'-'))}/>
        </div>
      )}

      {/* Ciclo y fecha */}
      {effectiveProductId && (
        <div className="space-y-3 border-t border-gray-100 pt-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-gray-600 font-medium block mb-1">
                Versión / ciclo * <span className="text-gray-400">(ej: "2.3", "v5", "latest")</span>
              </label>
              <input className="input font-mono" placeholder="latest"
                value={cycle} onChange={e => setCycle(e.target.value)}/>
            </div>
            <div>
              <label className="text-xs text-gray-600 font-medium block mb-1">
                Fecha de fin de soporte (EOL) *
              </label>
              <input type="date" className="input"
                value={eolDate} onChange={e => setEolDate(e.target.value)}/>
            </div>
          </div>
          <div>
            <label className="text-xs text-gray-600 font-medium block mb-1">Notas (opcional)</label>
            <textarea className="input h-16 resize-none"
              placeholder="Contexto: por qué se establece esta fecha, qué versión se usa..."
              value={notes} onChange={e => setNotes(e.target.value)}/>
          </div>
          {eolDate && (
            <div className={`text-xs rounded-lg px-3 py-2 font-medium ${
              new Date(eolDate) < new Date()
                ? 'bg-red-50 border border-red-200 text-red-700'
                : (new Date(eolDate) - new Date()) / 86400000 <= 365
                  ? 'bg-amber-50 border border-amber-200 text-amber-700'
                  : 'bg-green-50 border border-green-200 text-green-700'
            }`}>
              {new Date(eolDate) < new Date()
                ? `❌ Fecha en el pasado — activos con versión "${cycle||'custom'}" tendrán estado EOL KO`
                : (new Date(eolDate) - new Date()) / 86400000 <= 365
                  ? `⚠ Menos de 1 año — activos con versión "${cycle||'custom'}" tendrán estado EOL WARN`
                  : `✓ Más de 1 año — activos con versión "${cycle||'custom'}" tendrán estado EOL OK`}
            </div>
          )}
        </div>
      )}

      <div className="flex justify-end gap-2 pt-1">
        <button className="btn-secondary" onClick={onClose}>Cancelar</button>
        <button className="btn-primary" disabled={!isValid || isPending} onClick={handleSubmit}>
          {isPending ? <><Spinner size="sm"/> Guardando...</> : '✓ Guardar y recalcular'}
        </button>
      </div>
    </div>
  )
}

// Modal añadir producto

function AddProductModal({ onClose, isOpen }) {
  const qc = useQueryClient()
  const [mode, setMode]             = useState('api')   // 'api' | 'custom'
  const [search, setSearch]         = useState('')
  const [selected, setSelected]     = useState('')
  const [displayName, setDisplayName] = useState('')
  const [category, setCategory]     = useState('')
  const [notes, setNotes]           = useState('')
  // Custom cycle fields
  const [customCycle, setCustomCycle]   = useState('')
  const [customEolDate, setCustomEolDate] = useState('')
  const [customNotes, setCustomNotes]   = useState('')

  // Productos del catálogo endoflife.date
  const { data: allProducts, isLoading: loadingAll } = useQuery({
    queryKey: ['eol-all-products'],
    queryFn: eolApi.allProducts,
    enabled: isOpen && mode === 'api',
    staleTime: 5 * 60 * 1000,
  })

  // Productos detectados en el inventario aún sin registrar en EOL
  const { data: detected, isLoading: loadingDetected } = useQuery({
    queryKey: ['eol-detected-products'],
    queryFn: eolApi.detectedProducts,
    enabled: isOpen,
    staleTime: 60 * 1000,
  })
  const pendingProducts = detected?.pending || []
  const registeredProducts = detected?.registered || []

  // Añadir desde API
  const addMut = useMutation({
    mutationFn: () => eolApi.addProduct(selected, { display_name: displayName || selected, category, notes }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['eol-products'] })
      qc.invalidateQueries({ queryKey: ['eol-detected-products'] })
      toast(`Producto "${selected}" añadido y sincronizado`)
      onClose()
    },
    onError: e => toast(e.message, 'error'),
  })

  // Añadir custom (producto del inventario + fecha manual)
  const addCustomMut = useMutation({
    mutationFn: async () => {
      // Si el producto no está aún registrado, añadirlo primero (sin sync API)
      if (pendingProducts.some(p => p.product_id === selected)) {
        await eolApi.addProduct(selected, {
          display_name: displayName || selected.replace(/-/g,' ').replace(/\w/g,l=>l.toUpperCase()),
          category: category || 'Custom',
          notes: notes || 'Producto añadido manualmente — sin datos de endoflife.date',
        })
      }
      // Añadir el ciclo custom
      return eolApi.addCustomCycle(selected, {
        cycle: customCycle,
        eol_date: customEolDate,
        notes: customNotes || null,
      })
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['eol-products'] })
      qc.invalidateQueries({ queryKey: ['eol-detected-products'] })
      qc.invalidateQueries({ queryKey: ['assets'], exact: false })
      qc.invalidateQueries({ queryKey: ['dashboard'] })
      const n = data?.retag_updated ?? 0
      toast(`Producto "${selected}" con EOL ${customEolDate} registrado${n > 0 ? ` — ${n} activos recalculados` : ''}`)
      onClose()
    },
    onError: e => toast(e.message, 'error'),
  })

  const filteredApi = (allProducts || []).filter(p => !search || p.toLowerCase().includes(search.toLowerCase()))

  return (
    <div className="space-y-4">
      {/* Selector de modo */}
      <div className="flex gap-1 bg-gray-100 p-1 rounded-lg">
        <button onClick={() => { setMode('api'); setSelected('') }}
          className={`flex-1 py-1.5 rounded-md text-sm font-medium transition-all ${mode === 'api' ? 'bg-white shadow text-gray-900' : 'text-gray-600'}`}>
          🌐 Desde endoflife.date
        </button>
        <button onClick={() => { setMode('custom'); setSelected('') }}
          className={`flex-1 py-1.5 rounded-md text-sm font-medium transition-all ${mode === 'custom' ? 'bg-white shadow text-gray-900' : 'text-gray-600'}`}>
          ✏ EOL personalizado
        </button>
      </div>

      {mode === 'api' ? (
        /* Modo API */
        <>
          <div>
            <label className="block text-xs text-gray-700 font-medium mb-1">Buscar en el catálogo de endoflife.date</label>
            <input className="input" placeholder="ej: ubuntu, python, rhel, postgresql..."
              value={search} onChange={e => setSearch(e.target.value)}/>
          </div>
          {/* Sugerencias del inventario */}
          {pendingProducts.length > 0 && (
            <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg">
              <p className="text-xs text-blue-700 font-semibold mb-1.5">
                💡 Detectados en el inventario — aún sin registrar ({pendingProducts.length}):
              </p>
              <div className="flex flex-wrap gap-1">
                {pendingProducts.map(p => (
                  <button key={p.product_id}
                    onClick={() => { setSelected(p.product_id); setSearch(p.product_id) }}
                    className={`text-xs px-2 py-0.5 rounded-full border font-mono transition-colors ${selected === p.product_id ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-blue-700 border-blue-300 hover:bg-blue-100'}`}>
                    {p.product_id} ({p.asset_count} activos)
                  </button>
                ))}
              </div>
            </div>
          )}
          {loadingAll ? <div className="flex justify-center py-4"><Spinner/></div> : (
            <div className="border rounded-lg overflow-hidden" style={{borderColor:'#E8CCCC',maxHeight:'200px',overflowY:'auto'}}>
              <div className="text-xs text-gray-600 px-3 py-1.5 bg-gray-50 border-b" style={{borderColor:'#E8CCCC'}}>
                {filteredApi.length} productos disponibles en endoflife.date
              </div>
              {filteredApi.map(p => (
                <label key={p} className={`flex items-center gap-2 px-3 py-2 text-sm cursor-pointer hover:bg-red-50/50 ${selected===p?'bg-red-50':''}`}>
                  <input type="radio" name="product" value={p} checked={selected===p}
                    onChange={() => { setSelected(p); setDisplayName('') }}
                    className="accent-primary"/>
                  <span className="font-mono text-gray-800">{p}</span>
                  {pendingProducts.some(pp => pp.product_id === p) && (
                    <span className="ml-auto text-[10px] bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded-full">en inventario</span>
                  )}
                </label>
              ))}
            </div>
          )}
          {selected && (
            <div className="space-y-2 border-t pt-3" style={{borderColor:'#E8CCCC'}}>
              <p className="text-xs text-gray-700 font-medium">Seleccionado: <span className="font-mono text-primary">{selected}</span></p>
              <div className="grid grid-cols-2 gap-2">
                <div><label className="block text-xs text-gray-700 font-medium mb-1">Nombre visible</label>
                  <input className="input" placeholder={selected} value={displayName} onChange={e=>setDisplayName(e.target.value)}/></div>
                <div><label className="block text-xs text-gray-700 font-medium mb-1">Categoría</label>
                  <input className="input" placeholder="OS, Database..." value={category} onChange={e=>setCategory(e.target.value)}/></div>
              </div>
            </div>
          )}
          <div className="flex gap-2 justify-end">
            <button className="btn-secondary" onClick={onClose}>Cancelar</button>
            <button className="btn-primary" disabled={!selected || addMut.isPending} onClick={() => addMut.mutate()}>
              {addMut.isPending ? <><Spinner size="sm"/> Sincronizando...</> : '+ Añadir y sincronizar'}
            </button>
          </div>
        </>
      ) : (
        /* Modo Custom */
        <>
          <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-800">
            <strong>EOL personalizado</strong> — Para software interno, ERPs propietarios o productos
            no cubiertos por endoflife.date. Introduce el producto, la versión y la fecha de fin de soporte.
            Los activos se recalcularán automáticamente.
          </div>

          {/* Selector de producto */}
          <div>
            <label className="block text-xs text-gray-700 font-medium mb-1">
              Producto del inventario
              <span className="text-gray-400 ml-1">(detectado automáticamente en tus assets)</span>
            </label>
            {loadingDetected ? <Spinner/> : (
              <div>
                {pendingProducts.length > 0 && (
                  <>
                    <p className="text-xs text-blue-600 mb-1">Sin EOL registrado ({pendingProducts.length}):</p>
                    <div className="border rounded-lg overflow-hidden mb-2" style={{borderColor:'#E8CCCC',maxHeight:'150px',overflowY:'auto'}}>
                      {pendingProducts.map(p => (
                        <label key={p.product_id} className={`flex items-center gap-2 px-3 py-2 text-sm cursor-pointer hover:bg-amber-50 ${selected===p.product_id?'bg-amber-50':''}`}>
                          <input type="radio" name="cprod" value={p.product_id} checked={selected===p.product_id}
                            onChange={() => setSelected(p.product_id)} className="accent-primary"/>
                          <span className="font-mono text-gray-800">{p.product_id}</span>
                          <span className="text-xs text-gray-400">{p.asset_count} activos</span>
                        </label>
                      ))}
                    </div>
                  </>
                )}
                {registeredProducts.length > 0 && (
                  <>
                    <p className="text-xs text-gray-500 mb-1">Ya registrados — puedes añadir ciclo custom:</p>
                    <div className="border rounded-lg overflow-hidden" style={{borderColor:'#E8CCCC',maxHeight:'100px',overflowY:'auto'}}>
                      {registeredProducts.map(p => (
                        <label key={p.product_id} className={`flex items-center gap-2 px-3 py-1.5 text-sm cursor-pointer hover:bg-gray-50 ${selected===p.product_id?'bg-gray-100':''}`}>
                          <input type="radio" name="cprod" value={p.product_id} checked={selected===p.product_id}
                            onChange={() => setSelected(p.product_id)} className="accent-primary"/>
                          <span className="font-mono text-gray-600">{p.product_id}</span>
                          <span className="text-xs text-green-600 ml-auto">✓ registrado</span>
                        </label>
                      ))}
                    </div>
                  </>
                )}
                {pendingProducts.length === 0 && registeredProducts.length === 0 && (
                  <p className="text-sm text-gray-500 italic py-2">No se han detectado productos en los assets del inventario.</p>
                )}
              </div>
            )}
          </div>

          {/* Ciclo + fecha */}
          {selected && (
            <div className="space-y-3 border-t pt-3" style={{borderColor:'#E8CCCC'}}>
              <p className="text-xs font-medium text-gray-700">Producto: <span className="font-mono text-amber-700">{selected}</span></p>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-gray-700 font-medium mb-1">
                    Versión / ciclo *
                    <span className="text-gray-400 ml-1">ej: 2.3, v4, 2024, latest</span>
                  </label>
                  <input className="input" placeholder="ej: 2023, 4.5, latest"
                    value={customCycle} onChange={e => setCustomCycle(e.target.value)}/>
                </div>
                <div>
                  <label className="block text-xs text-gray-700 font-medium mb-1">
                    Fecha fin de soporte *
                  </label>
                  <input type="date" className="input" value={customEolDate}
                    onChange={e => setCustomEolDate(e.target.value)}/>
                </div>
              </div>
              <div>
                <label className="block text-xs text-gray-700 font-medium mb-1">Notas</label>
                <input className="input" placeholder="Contexto, proveedor, motivo..."
                  value={customNotes} onChange={e => setCustomNotes(e.target.value)}/>
              </div>
            </div>
          )}

          <div className="flex gap-2 justify-end">
            <button className="btn-secondary" onClick={onClose}>Cancelar</button>
            <button className="btn-primary"
              disabled={!selected || !customCycle || !customEolDate || addCustomMut.isPending}
              onClick={() => addCustomMut.mutate()}>
              {addCustomMut.isPending ? <><Spinner size="sm"/> Guardando...</> : '✓ Guardar EOL personalizado'}
            </button>
          </div>
        </>
      )}
    </div>
  )
}

// Página principal

export default function EolPage() {
  const { isAdmin } = useAuth()
  const qc = useQueryClient()
  const [showAdd, setShowAdd] = useState(false)
  const [showCustom, setShowCustom] = useState(false)
  const [detailProduct, setDetailProduct] = useState(null)
  const [filterStatus, setFilterStatus] = useState('')
  const [filterCat, setFilterCat] = useState('')
  // Modal de assets desde badges de la tabla principal
  const [assetsModal, setAssetsModal] = useState(null) // {productId, productName, status}

  const { data: products, isLoading } = useQuery({
    queryKey: ['eol-products'],
    queryFn: eolApi.listProducts,
  })

  const syncAllMut = useMutation({
    mutationFn: eolApi.syncAll,
    onSuccess: r => {
      qc.invalidateQueries({ queryKey: ['eol-products'] })
      qc.invalidateQueries({ queryKey: ['assets'] })
      toast(`Sync completada: ${r.synced} productos`)
    },
    onError: e => toast(e.message, 'error'),
  })

  // autoSyncMut: sync is automatic (startup + daily 05:00)

  const { data: detected } = useQuery({
    queryKey: ['eol-detected'],
    queryFn: eolApi.detectedProducts,
    staleTime: 60_000,
  })
  const pendingProducts = detected?.pending || []

  const recalcMut = useMutation({
    mutationFn: eolApi.recalculateTags,
    onSuccess: r => { qc.invalidateQueries({ queryKey: ['assets'] }); toast(r.message) },
    onError: e => toast(e.message, 'error'),
  })

  const syncOneMut = useMutation({
    mutationFn: eolApi.syncProduct,
    onSuccess: () => {
      qc.refetchQueries({ queryKey: ['eol-products'] })
      toast('Producto sincronizado')
    },
    onError: e => toast(e.message, 'error'),
  })

  const deleteMut = useMutation({
    mutationFn: eolApi.deleteProduct,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['eol-products'] }); toast('Producto eliminado') },
    onError: e => toast(e.message, 'error'),
  })

  const list = products || []
  const categories = [...new Set(list.map(p => p.category).filter(Boolean))]
  const filtered = list.filter(p => {
    if (filterCat && p.category !== filterCat) return false
    if (filterStatus === 'unsynced' && p.sync_status !== 'unsynced') return false
    if (filterStatus === 'eol' && p.eol_count === 0) return false
    return true
  })

  const totalEol     = list.reduce((s,p) => s + (p.eol_count||0), 0)
  const totalWarning = list.reduce((s,p) => s + (p.warning_count||0), 0)
  const totalUnsynced = list.filter(p => p.sync_status === 'unsynced').length

  return (
    <div className="p-6 space-y-5">
      {/* Cabecera */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900">End of Life</h1>
          <p className="text-xs text-gray-700 mt-0.5">
            Ciclos de vida de software sincronizados con{' '}
            <a href="https://endoflife.date" target="_blank" rel="noreferrer" className="text-primary underline">endoflife.date</a>
            {' '}— {list.length} productos gestionados
          </p>
        </div>
        <div className="flex gap-2">
          {isAdmin() && (
            <>
              
              <button className="btn-secondary text-xs flex items-center gap-1" disabled={syncAllMut.isPending}
                onClick={() => syncAllMut.mutate()}>
                {syncAllMut.isPending ? <Spinner size="sm"/> : '🔄'} Sync todo
              </button>
              <button className="btn-secondary text-xs flex items-center gap-1" disabled={recalcMut.isPending}
                title="Recalcula etiquetas EOL KO/WARN/OK en todos los activos"
                onClick={() => recalcMut.mutate()}>
                {recalcMut.isPending ? <Spinner size="sm"/> : '🏷'} Recalcular etiquetas
              </button>
              <button className="btn-secondary text-sm" onClick={() => { setShowAdd(true); setAddMode('custom') }}>
                ✏ EOL personalizado
              </button>
              <button className="btn-primary text-sm" onClick={() => { setShowAdd(true); setAddMode('api') }}>
                + Añadir desde API
              </button>
            </>
          )}
        </div>
      </div>

      {/* Resumen */}
      {list.length > 0 && (
        <div className="flex gap-3 flex-wrap">
          {[
            { label: `${list.length} productos`,          cls: 'bg-gray-100 text-gray-800 border border-gray-300' },
            { label: `${totalEol} versiones EOL`,         cls: 'bg-red-100 text-red-800 border border-red-400 font-semibold' },
            { label: `${totalWarning} próximas a EOL`,    cls: 'bg-amber-100 text-amber-800 border border-amber-400 font-semibold' },
            { label: `${totalUnsynced} productos unsynced`, cls: 'bg-red-50 text-red-700 border border-red-300' },
          ].map((b,i) => <span key={i} className={`badge ${b.cls}`}>{b.label}</span>)}
        </div>
      )}

      {/* Banner: productos detectados en inventario pero no registrados */}
      {pendingProducts.length > 0 && (
        <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 flex items-start gap-3">
          <span className="text-2xl">🔍</span>
          <div className="flex-1">
            <p className="font-semibold text-amber-900 text-sm">
              {pendingProducts.length} producto(s) detectado(s) en el inventario sin cobertura EOL
            </p>
            <p className="text-xs text-amber-700 mt-0.5">
              Los activos tienen OS/DB que coinciden con estos productos:
              {' '}<span className="font-mono">{pendingProducts.map(p => p.product_id).join(', ')}</span>
            </p>
            <div className="flex gap-2 mt-2">
              <button className="btn-secondary text-xs" onClick={() => setShowCustom(true)}>
                ✎ Añadir EOL custom (sin API)
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Info scheduler */}
      <div className="flex items-center gap-2 text-xs text-gray-500">
        <span>⏰</span>
        <span>Sincronización automática diaria a las <strong>05:00</strong> — los nuevos activos se sincronizan al darse de alta</span>
      </div>

      {/* Filtros */}
      {list.length > 0 && (
        <div className="flex gap-3 flex-wrap items-center">
          <select className="input w-48 text-sm" value={filterCat} onChange={e=>setFilterCat(e.target.value)}>
            <option value="">Todas las categorías</option>
            {categories.map(c=><option key={c} value={c}>{c}</option>)}
          </select>
          <select className="input w-48 text-sm" value={filterStatus} onChange={e=>setFilterStatus(e.target.value)}>
            <option value="">Todos los estados</option>
            <option value="eol">Con versiones EOL</option>
            <option value="unsynced">Sin sync</option>
          </select>
          {(filterCat||filterStatus) && (
            <button className="text-xs text-primary underline" onClick={()=>{setFilterCat('');setFilterStatus('')}}>Limpiar</button>
          )}
        </div>
      )}

      {/* Tabla de productos */}
      <div className="card overflow-hidden">
        {isLoading ? <TableSkeleton rows={5} cols={6}/> : list.length === 0 ? (
          <div className="p-8 text-center">
            <p className="text-gray-700 font-medium mb-1">No hay productos EOL configurados</p>
            <p className="text-xs text-gray-600">Añade productos desde el catálogo de endoflife.date.</p>
            {isAdmin() && <button className="btn-primary mt-4" onClick={()=>setShowAdd(true)}>+ Añadir primer producto</button>}
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-gray-600 uppercase font-semibold" style={{backgroundColor:'#F3F4F6',borderBottom:'2px solid #E5E7EB'}}>
                <th className="px-4 py-3 text-left">Producto</th>
                <th className="px-4 py-3 text-left">Categoría</th>
                <th className="px-4 py-3 text-left">Versiones</th>
                <th className="px-4 py-3 text-left">Estado sync</th>
                <th className="px-4 py-3 text-left">EOL / Advertencias</th>
                <th className="px-4 py-3 text-right">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filtered.map(p => (
                <tr key={p.id}
                  className={`transition-colors hover:bg-red-50/40 cursor-pointer ${p.sync_status==='unsynced'?'bg-red-50/60':''}`}
                  onClick={() => setDetailProduct(p.product_id)}>
                  <td className="px-4 py-3">
                    <p className="font-semibold text-gray-900">{p.display_name}</p>
                    <p className="text-xs font-mono text-gray-600">{p.product_id}</p>
                    {p.notes && <p className="text-xs text-gray-600 italic mt-0.5">{p.notes}</p>}
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-700">{p.category || '—'}</td>
                  <td className="px-4 py-3 text-gray-800 font-medium">{p.cycle_count}</td>
                  <td className="px-4 py-3">
                    <SyncBadge status={p.sync_status} lastSync={p.last_synced_at}/>
                  </td>
                  <td className="px-4 py-3" onClick={e => e.stopPropagation()}>
                    <div className="flex gap-1 flex-wrap">
                      {/* Solo mostrar si hay ASSETS del inventario afectados */}
                      {(p.asset_eol_ko > 0) && (
                        <button onClick={() => setAssetsModal({productId:p.product_id, productName:p.display_name, status:'eol'})}
                          className="badge bg-red-100 text-red-800 border border-red-400 font-bold cursor-pointer hover:bg-red-200 transition-colors">
                          {p.asset_eol_ko} EOL KO →
                        </button>
                      )}
                      {(p.asset_eol_warn > 0) && (
                        <button onClick={() => setAssetsModal({productId:p.product_id, productName:p.display_name, status:'warning'})}
                          className="badge bg-amber-100 text-amber-800 border border-amber-400 font-semibold cursor-pointer hover:bg-amber-200 transition-colors">
                          {p.asset_eol_warn} EOL WARN →
                        </button>
                      )}
                      {(p.asset_eol_ok > 0) && (
                        <button onClick={() => setAssetsModal({productId:p.product_id, productName:p.display_name, status:'ok'})}
                          className="badge bg-green-100 text-green-800 border border-green-400 font-semibold cursor-pointer hover:bg-green-200 transition-colors">
                          ✓ {p.asset_eol_ok} OK →
                        </button>
                      )}
                      {(p.asset_eol_unknown > 0) && (
                        <button onClick={() => setAssetsModal({productId:p.product_id, productName:p.display_name, status:'unknown'})}
                          className="badge bg-gray-100 text-gray-600 border border-gray-300 cursor-pointer hover:bg-gray-200 transition-colors"
                          title="Activos que coinciden con este producto pero cuya versión no está en los ciclos EOL registrados">
                          {p.asset_eol_unknown} sin versión →
                        </button>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-right" onClick={e=>e.stopPropagation()}>
                    <div className="flex gap-1 justify-end">
                      {isAdmin() && (
                        <>
                          <button className="btn-secondary text-xs" disabled={syncOneMut.isPending}
                            onClick={() => syncOneMut.mutate(p.product_id)}>
                            {syncOneMut.isPending ? <Spinner size="sm"/> : '🔄'}
                          </button>
                          <button className="btn-danger text-xs"
                            onClick={() => { if(confirm(`¿Eliminar "${p.display_name}"?`)) deleteMut.mutate(p.product_id) }}>
                            ✕
                          </button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Modal detalle de versiones (al pulsar la fila) */}
      <Modal open={!!detailProduct} onClose={() => setDetailProduct(null)}
        title={`Versiones — ${list.find(p=>p.product_id===detailProduct)?.display_name || detailProduct}`}
        maxW="max-w-5xl">
        {detailProduct && (
          <ProductDetail productId={detailProduct} onClose={() => setDetailProduct(null)} isAdmin={isAdmin()}/>
        )}
      </Modal>

      {/* Modal assets afectados (al pulsar badges EOL/advertencias en la tabla) */}
      <Modal open={!!assetsModal} onClose={() => setAssetsModal(null)}
        title={`Activos afectados — ${assetsModal?.productName}`}
        maxW="max-w-3xl">
        {assetsModal && (
          <AssetsEolModal
            productId={assetsModal.productId}
            productName={assetsModal.productName}
            status={assetsModal.status}
            onClose={() => setAssetsModal(null)}
          />
        )}
      </Modal>

      {/* Modal añadir producto */}
      <Modal open={showAdd} onClose={() => setShowAdd(false)} title="Añadir producto EOL">
        <AddProductModal onClose={() => setShowAdd(false)} isOpen={showAdd}/>
      </Modal>
    </div>
  )
}
