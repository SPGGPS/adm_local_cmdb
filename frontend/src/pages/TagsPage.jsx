import { useState, useRef, useCallback } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { tagsApi } from '../services/api'
import { colorBadgeStyle, Modal, Spinner, TagBadge, Empty, TableSkeleton, toast } from '../components/ui/index.jsx'

const PRESETS = ['#ef4444','#f97316','#f59e0b','#84cc16','#22c55e','#14b8a6','#3b82f6','#6366f1','#a855f7','#ec4899','#64748b','#dc2626','#16a34a','#0284c7','#1d4ed8']

// Conversiones HSV ↔ HEX
function hexToHsv(hex) {
  const safe = /^#[0-9A-Fa-f]{6}$/.test(hex) ? hex : '#6366f1'
  const r = parseInt(safe.slice(1,3),16)/255
  const g = parseInt(safe.slice(3,5),16)/255
  const b = parseInt(safe.slice(5,7),16)/255
  const max = Math.max(r,g,b), min = Math.min(r,g,b), d = max - min
  let h = 0
  if (d !== 0) {
    if      (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) * 60
    else if (max === g) h = ((b - r) / d + 2) * 60
    else                h = ((r - g) / d + 4) * 60
  }
  return { h, s: max === 0 ? 0 : d / max, v: max }
}

function hsvToHex(h, s, v) {
  const c = v * s, x = c * (1 - Math.abs((h / 60) % 2 - 1)), m = v - c
  let r = 0, g = 0, b = 0
  if      (h < 60)  { r = c; g = x }
  else if (h < 120) { r = x; g = c }
  else if (h < 180) { g = c; b = x }
  else if (h < 240) { g = x; b = c }
  else if (h < 300) { r = x; b = c }
  else              { r = c; b = x }
  const hex = n => Math.round(Math.max(0, Math.min(1, n + m)) * 255).toString(16).padStart(2, '0')
  return `#${hex(r)}${hex(g)}${hex(b)}`
}

// Color Picker estilo Chrome
function ColorPicker({ value, onChange }) {
  const { h, s, v } = hexToHsv(value)
  const svRef  = useRef(null)
  const hueRef = useRef(null)

  const drag = useCallback((ref, onMove) => (e) => {
    e.preventDefault()
    const rect = ref.current.getBoundingClientRect()
    const move = (ev) => {
      const cx = ev.touches ? ev.touches[0].clientX : ev.clientX
      const cy = ev.touches ? ev.touches[0].clientY : ev.clientY
      onMove(
        Math.max(0, Math.min(1, (cx - rect.left) / rect.width)),
        Math.max(0, Math.min(1, (cy - rect.top)  / rect.height))
      )
    }
    move(e)
    const up = () => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup',   up)
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup',   up)
  }, [])

  const onSvDrag  = drag(svRef,  (x, y) => onChange(hsvToHex(h, x, 1 - y)))
  const onHueDrag = drag(hueRef, (x)    => onChange(hsvToHex(x * 360, s, v)))

  const hueColor = `hsl(${h}, 100%, 50%)`

  return (
    <div className="space-y-3">
      {/* Área de saturación/brillo */}
      <div ref={svRef}
        className="relative w-full rounded cursor-crosshair select-none"
        style={{ height: 140, background: hueColor }}
        onMouseDown={onSvDrag}>
        <div className="absolute inset-0 rounded"
          style={{ background: 'linear-gradient(to right, #fff, transparent)' }}/>
        <div className="absolute inset-0 rounded"
          style={{ background: 'linear-gradient(to bottom, transparent, #000)' }}/>
        {/* Thumb */}
        <div className="absolute w-4 h-4 rounded-full border-2 border-white shadow-md pointer-events-none -translate-x-1/2 -translate-y-1/2"
          style={{ left: `${s * 100}%`, top: `${(1 - v) * 100}%`, backgroundColor: value }}/>
      </div>

      {/* Slider de tono (hue) */}
      <div ref={hueRef}
        className="relative w-full h-4 rounded cursor-pointer select-none"
        style={{ background: 'linear-gradient(to right,#f00,#ff0,#0f0,#0ff,#00f,#f0f,#f00)' }}
        onMouseDown={onHueDrag}>
        <div className="absolute top-1/2 w-4 h-4 rounded-full border-2 border-white shadow-md pointer-events-none -translate-x-1/2 -translate-y-1/2"
          style={{ left: `${(h / 360) * 100}%`, backgroundColor: hueColor }}/>
      </div>

      {/* Presets */}
      <div className="flex flex-wrap gap-1.5">
        {PRESETS.map(c => (
          <button key={c} type="button" onClick={() => onChange(c)}
            className={`w-5 h-5 rounded-full border-2 transition-transform hover:scale-125 ${value === c ? 'border-gray-600 scale-125' : 'border-transparent'}`}
            style={{ backgroundColor: c }}/>
        ))}
      </div>

      {/* Hex input */}
      <div className="flex items-center gap-2">
        <div className="w-7 h-7 rounded border border-gray-300 flex-shrink-0" style={{ backgroundColor: value }}/>
        <input
          className="input font-mono text-sm flex-1"
          value={value}
          onChange={e => { if (/^#[0-9A-Fa-f]{6}$/.test(e.target.value)) onChange(e.target.value) }}
          onBlur={e => { if (!/^#[0-9A-Fa-f]{6}$/.test(e.target.value)) onChange(value) }}
          placeholder="#6366f1"
          maxLength={7}/>
      </div>
    </div>
  )
}

function TagForm({ initial={}, onSubmit, loading }) {
  const [name, setName]   = useState(initial.name||'')
  const [color, setColor] = useState(initial.color_code||'#6366f1')
  const [desc, setDesc]   = useState(initial.description||'')
  const submit = (e) => { e.preventDefault(); onSubmit({ name, color_code:color, description:desc }) }
  return (
    <form onSubmit={submit} className="space-y-4">
      <div>
        <label className="block text-xs text-gray-600 font-medium mb-1">Nombre *</label>
        <input required className="input" value={name} onChange={e=>setName(e.target.value)} maxLength={100}/>
      </div>
      <div>
        <label className="block text-xs text-gray-600 font-medium mb-1">Color</label>
        <ColorPicker value={color} onChange={setColor}/>
        <div className="mt-2"><TagBadge tag={{name:name||'Vista previa',color_code:color}}/></div>
      </div>
      <div>
        <label className="block text-xs text-gray-600 font-medium mb-1">Descripción</label>
        <input className="input" value={desc} onChange={e=>setDesc(e.target.value)} maxLength={255}/>
      </div>
      <div className="flex justify-end">
        <button type="submit" className="btn-primary" disabled={loading}>{loading?<Spinner size="sm"/>:'Guardar'}</button>
      </div>
    </form>
  )
}

export default function TagsPage() {
  const qc = useQueryClient()
  const [createOpen, setCreate] = useState(false)
  const [editTag, setEdit]      = useState(null)
  const [deleteTag, setDelete]  = useState(null)

  const { data:tags=[], isLoading } = useQuery({ queryKey:['tags','all'], queryFn:()=>tagsApi.list() })
  const createM = useMutation({ mutationFn:tagsApi.create, onSuccess:()=>{ qc.invalidateQueries({queryKey:['tags']}); setCreate(false); toast('Etiqueta creada') } })
  const updateM = useMutation({ mutationFn:({id,data})=>tagsApi.update(id,data), onSuccess:()=>{ qc.invalidateQueries({queryKey:['tags']}); qc.invalidateQueries({queryKey:['assets']}); setEdit(null); toast('Etiqueta actualizada') } })
  const deleteM = useMutation({ mutationFn:tagsApi.delete, onSuccess:()=>{ qc.invalidateQueries({queryKey:['tags']}); qc.invalidateQueries({queryKey:['assets']}); setDelete(null); toast('Etiqueta eliminada') } })

  const manual = tags.filter(t=>t.origin==='manual')
  const system = tags.filter(t=>t.origin==='system')

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-gray-900">Etiquetas</h1>
        <button className="btn-primary" onClick={()=>setCreate(true)}>+ Nueva etiqueta</button>
      </div>
      {isLoading ? <TableSkeleton rows={4} cols={4}/> : (
        <>
          <div className="card overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-100"><h2 className="text-sm font-semibold text-gray-700">Manuales ({manual.length})</h2></div>
            {manual.length===0 ? <Empty message="No hay etiquetas manuales"/> : (
              <table className="w-full text-sm">
                <thead><tr className="text-xs text-gray-600 uppercase" style={{backgroundColor:"#F3F4F6",borderBottom:"2px solid #E5E7EB"}}>
                  <th className="px-4 py-3 text-left">Etiqueta</th><th className="px-4 py-3 text-left">Descripción</th>
                  <th className="px-4 py-3 text-left">Creada por</th><th className="px-4 py-3 text-left">Activos</th>
                  <th className="px-4 py-3 text-right">Acciones</th>
                </tr></thead>
                <tbody className="divide-y divide-gray-100">
                  {manual.map(t=>(
                    <tr key={t.id} className="hover:bg-red-50/50">
                      <td className="px-4 py-3"><TagBadge tag={t}/></td>
                      <td className="px-4 py-3 text-gray-600 text-xs">{t.description||'—'}</td>
                      <td className="px-4 py-3 text-gray-600 text-xs">{t.created_by||'—'}</td>
                      <td className="px-4 py-3 text-gray-600">{t.asset_count}</td>
                      <td className="px-4 py-3 text-right space-x-2">
                        <button className="btn-secondary text-xs" onClick={()=>setEdit(t)}>Editar</button>
                        <button className="btn-danger text-xs" onClick={()=>setDelete(t)}>Eliminar</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
          <div className="card overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-100">
              <h2 className="text-sm font-semibold text-gray-700">Sistema ({system.length})</h2>
              <p className="text-xs text-gray-600 mt-0.5">Asignadas automáticamente por los orígenes de datos. No editables.</p>
            </div>
            <div className="flex flex-wrap gap-2 p-4">{system.map(t=><TagBadge key={t.id} tag={t}/>)}</div>
          </div>
        </>
      )}
      <Modal open={createOpen} onClose={()=>setCreate(false)} title="Nueva etiqueta">
        <TagForm onSubmit={createM.mutate} loading={createM.isPending}/>
        {createM.isError && <p className="text-red-400 text-xs mt-2">{createM.error?.message}</p>}
      </Modal>
      <Modal open={!!editTag} onClose={()=>setEdit(null)} title="Editar etiqueta">
        {editTag && <TagForm initial={editTag} onSubmit={data=>updateM.mutate({id:editTag.id,data})} loading={updateM.isPending}/>}
      </Modal>
      <Modal open={!!deleteTag} onClose={()=>setDelete(null)} title="Eliminar etiqueta" maxW="max-w-sm">
        {deleteTag && (
          <div className="space-y-4">
            <p className="text-sm text-gray-600">¿Eliminar <TagBadge tag={deleteTag}/>?</p>
            <p className="text-xs text-amber-400">⚠ Se desvinculará de <strong>{deleteTag.asset_count}</strong> activos.</p>
            <div className="flex justify-end gap-2">
              <button className="btn-secondary" onClick={()=>setDelete(null)}>Cancelar</button>
              <button className="btn-danger" disabled={deleteM.isPending} onClick={()=>deleteM.mutate(deleteTag.id)}>
                {deleteM.isPending?<Spinner size="sm"/>:'Eliminar'}
              </button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}
