import { useParams, Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { assetsApi } from '../services/api'
import { ComplianceRow, BackupCell, SourceBadge } from '../components/ui/ComplianceBadge'
import { AssetTypeBadge, TagBadge, Skeleton, IndicatorBadge } from '../components/ui/index.jsx'
import { format } from 'date-fns'
import { es } from 'date-fns/locale/es'

function Field({ label, value, mono=false }) {
  if (value === null || value === undefined || value === '') return null
  return (
    <div className="flex justify-between py-2 border-b border-gray-800 gap-4">
      <span className="text-xs text-gray-600 shrink-0">{label}</span>
      <span className={`text-sm text-gray-800 text-right max-w-xs break-all ${mono?'font-mono':''}`}>{String(value)}</span>
    </div>
  )
}
function BoolField({ label, value }) {
  return (
    <div className="flex items-center justify-between py-2 border-b border-gray-100">
      <span className="text-xs text-gray-700">{label}</span>
      <span className={`text-xs font-semibold ${value?'text-green-400':'text-red-600'}`}>{value?'✓ Sí':'✗ No'}</span>
    </div>
  )
}
function Section({ title, children, className='' }) {
  return (
    <div className={`card p-4 space-y-1 ${className}`}>
      <h3 className="text-xs font-semibold text-gray-600 uppercase tracking-wider mb-3">{title}</h3>
      {children}
    </div>
  )
}

const NODE_ROLE_BADGES = { primary:'bg-green-100 text-green-700 border border-green-300', replica:'bg-blue-100 text-blue-700 border border-blue-300', standby:'bg-yellow-100 text-yellow-800 border border-yellow-400', arbiter:'bg-gray-100 text-gray-600', shard:'bg-cyan-100 text-cyan-700 border border-cyan-300', config:'bg-purple-100 text-purple-700 border border-purple-300' }
const USER_ROLE_BADGES = { dba:'bg-red-100 text-red-700 border border-red-300', read_write:'bg-orange-100 text-orange-700 border border-orange-300', read_only:'bg-gray-100 text-gray-600', backup:'bg-blue-100 text-blue-700 border border-blue-300', monitoring:'bg-teal-100 text-teal-700 border border-teal-300', app:'bg-green-100 text-green-700 border border-green-300', service:'bg-cyan-100 text-cyan-700 border border-cyan-300', other:'bg-gray-50 text-gray-600' }

const DB_ENGINE_FAMILIES = {
  postgresql:'bg-green-100 text-green-800', mysql:'bg-green-100 text-green-800', mariadb:'bg-green-100 text-green-800', sqlite:'bg-green-100 text-green-800', percona:'bg-green-100 text-green-800',
  oracle:'bg-orange-900 text-orange-200', sqlserver:'bg-orange-900 text-orange-200', db2:'bg-orange-900 text-orange-200', sybase:'bg-orange-900 text-orange-200',
  mongodb:'bg-yellow-900 text-yellow-200', couchdb:'bg-yellow-900 text-yellow-200', couchbase:'bg-yellow-900 text-yellow-200', firestore:'bg-yellow-900 text-yellow-200',
  redis:'bg-red-900 text-red-200', memcached:'bg-red-900 text-red-200', dynamodb:'bg-red-900 text-red-200',
  cassandra:'bg-cyan-900 text-cyan-200', scylladb:'bg-cyan-900 text-cyan-200', clickhouse:'bg-cyan-900 text-cyan-200',
  neo4j:'bg-purple-900 text-purple-200', arangodb:'bg-purple-900 text-purple-200',
  elasticsearch:'bg-indigo-900 text-indigo-200', opensearch:'bg-indigo-900 text-indigo-200', solr:'bg-indigo-900 text-indigo-200',
  snowflake:'bg-blue-100 text-blue-800', redshift:'bg-blue-100 text-blue-800', databricks:'bg-blue-100 text-blue-800',
  influxdb:'bg-teal-900 text-teal-200', timescaledb:'bg-teal-900 text-teal-200',
}
const DB_SCHEMA_LABEL = {
  mongodb:'Colecciones', couchdb:'Colecciones', couchbase:'Colecciones',
  elasticsearch:'Índices', opensearch:'Índices', solr:'Índices',
  cassandra:'Keyspaces', scylladb:'Keyspaces', hbase:'Keyspaces',
  redis:'Databases',
}

const STATUS_COLORS = { active:'bg-blue-100 text-blue-700 border border-blue-300', revoked:'bg-gray-100 text-gray-600', expired:'bg-amber-100 text-amber-700 border border-amber-300' }
const ACT_COLORS    = { CREATE:'text-green-400', UPDATE:'text-blue-400', DELETE:'text-red-600', TAG_ASSIGN:'text-purple-400', INGEST:'text-teal-400' }

export default function AssetDetailPage() {
  const { id } = useParams()
  const { data: asset, isLoading } = useQuery({ queryKey:['asset',id], queryFn:()=>assetsApi.get(id) })

  if (isLoading) return <div className="p-6 space-y-4">{Array.from({length:6}).map((_,i)=><Skeleton key={i} className="h-24"/>)}</div>
  if (!asset) return <div className="p-6 text-red-700">Activo no encontrado</div>

  const type = asset.type
  const isServer = type==='server_physical'||type==='server_virtual'
  const isNet    = type==='switch'||type==='router'
  const isAP     = type==='ap'
  const isDB     = type==='database'

  const excMap = {}
  ;(asset.exceptions||[]).forEach(e => { excMap[e.indicator] = e })

  const schemaLabel = DB_SCHEMA_LABEL[asset.db_engine] || 'Tablas'

  return (
    <div className="p-6 space-y-4 max-w-5xl">
      <div className="flex items-center gap-2 text-sm text-gray-600">
        <Link to="/" className="hover:text-gray-700">Inventario</Link>
        <span>/</span><span className="text-gray-800">{asset.name}</span>
      </div>

      <div className="flex items-start justify-between flex-wrap gap-4">
        <div>
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="text-2xl font-bold text-gray-900">{asset.name}</h1>
            <AssetTypeBadge type={asset.type}/>
            {isDB && asset.db_engine && (
              <span className={`badge ${DB_ENGINE_FAMILIES[asset.db_engine]||'bg-gray-100 text-gray-600'}`}>
                {asset.db_engine.toUpperCase()} {asset.db_version||''}
              </span>
            )}
          </div>
          {asset.location && <p className="text-sm text-gray-600 mt-1">📍 {asset.location}</p>}
          {asset.source && <div className="mt-1"><SourceBadge source={asset.source} contributing_sources={asset.contributing_sources}/></div>}
        </div>
        <ComplianceRow asset={asset}/>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* General */}
        <Section title="Información general">
          <Field label="ID" value={asset.id} mono/>
          <Field label="Tipo" value={asset.type}/>
          <Field label="IPs" value={(asset.ips||[]).join(', ')}/>
          <Field label="MAC Address" value={asset.mac_address} mono/>
          <Field label="Fabricante" value={asset.vendor}/>
          <Field label="Número de serie" value={asset.serial_number}/>
          <Field label="Ubicación" value={asset.location}/>
          {asset.description && <div className="pt-2"><p className="text-xs text-gray-600 mb-1">Descripción</p><p className="text-sm text-gray-600">{asset.description}</p></div>}
          <Field label="Fecha de compra" value={asset.purchase_date}/>
          <Field label="Garantía hasta" value={asset.warranty_expiry}/>
        </Section>

        {/* Compliance */}
        <Section title="Compliance — origen de datos">
          {/* EDR */}
          <div className="py-2 border-b border-gray-100">
            <div className="flex items-center justify-between">
              <span className="text-xs text-gray-700">EDR</span>
              <span className={`text-xs font-semibold ${asset.edr_installed?'text-green-400':'text-red-600'}`}>
                {asset.edr_installed?'✓ Activo':'✗ Inactivo'}
              </span>
            </div>
            {asset.edr_installed && (
              <div className="flex items-center justify-between mt-0.5">
                <span className={`text-[10px] ${asset.edr_online===true?'text-green-500':asset.edr_online===false?'text-red-500':'text-gray-400'}`}>
                  ● {asset.edr_online===true?'Online':asset.edr_online===false?'Sin conexión':'Sin datos'}
                </span>
                {asset.edr_last_seen && (
                  <span className="text-[10px] text-gray-400">
                    Última carga {format(new Date(asset.edr_last_seen),'dd/MM/yyyy HH:mm',{locale:es})}
                  </span>
                )}
              </div>
            )}
          </div>

          {/* SIEM */}
          <div className="flex items-center justify-between py-2 border-b border-gray-100">
            <span className="text-xs text-gray-700">SIEM</span>
            <span className={`text-xs font-semibold ${asset.siem_enabled?'text-green-400':'text-red-600'}`}>
              {asset.siem_enabled?'✓ Activo':'✗ Inactivo'}
            </span>
          </div>

          {/* Monitorización */}
          <div className="flex items-center justify-between py-2 border-b border-gray-100">
            <span className="text-xs text-gray-700">Monitorización</span>
            <span className={`text-xs font-semibold ${asset.monitored?'text-green-400':'text-red-600'}`}>
              {asset.monitored?'✓ Activo':'✗ Inactivo'}
            </span>
          </div>

          {/* Logs */}
          <div className="flex items-center justify-between py-2 border-b border-gray-100">
            <span className="text-xs text-gray-700">Logs</span>
            <span className={`text-xs font-semibold ${asset.logs_enabled?'text-green-400':'text-red-600'}`}>
              {asset.logs_enabled?'✓ Activo':'✗ Inactivo'}
            </span>
          </div>

          {/* Backup Local */}
          <div className="py-2 border-b border-gray-100">
            <div className="flex items-center justify-between">
              <span className="text-xs text-gray-700">Backup Local</span>
              <BackupCell value={asset.last_backup_local}/>
            </div>
            {asset.backup_job_name && (
              <div className="flex justify-end mt-0.5">
                <span className="text-[10px] text-gray-400 truncate max-w-[200px]">{asset.backup_job_name}</span>
              </div>
            )}
          </div>

          {/* Backup Cloud */}
          <div className="py-2 border-b border-gray-100">
            <div className="flex items-center justify-between">
              <span className="text-xs text-gray-700">Backup Cloud</span>
              <BackupCell value={asset.last_backup_cloud}/>
            </div>
            {asset.backup_cloud_job_name && (
              <div className="flex justify-end mt-0.5">
                <span className="text-[10px] text-gray-400 truncate max-w-[200px]">{asset.backup_cloud_job_name}</span>
              </div>
            )}
          </div>

          <Field label="Última sync" value={asset.last_sync ? format(new Date(asset.last_sync),'dd/MM/yyyy HH:mm',{locale:es}) : '—'}/>
        </Section>

        {/* Server */}
        {isServer && (
          <Section title="Especificaciones de servidor">
            <Field label="OS" value={asset.os}/>
            <Field label="RAM" value={asset.ram_gb ? `${asset.ram_gb} GB` : null}/>
            <Field label="Disco total" value={asset.total_disk_gb ? `${asset.total_disk_gb} GB` : null}/>
            <Field label="CPUs" value={asset.cpu_count}/>
          </Section>
        )}

        {/* Network */}
        {isNet && (
          <Section title="Especificaciones de red">
            <Field label="Modelo" value={asset.model}/>
            <Field label="Puertos" value={asset.port_count}/>
            <Field label="Firmware" value={asset.firmware_version}/>
            {type==='switch' && <Field label="Velocidad máx." value={asset.max_speed}/>}
          </Section>
        )}
        {isAP && (
          <Section title="Especificaciones AP">
            <Field label="Modelo" value={asset.model}/>
            <Field label="Cobertura" value={asset.coverage_area}/>
            <Field label="Clientes conectados" value={asset.connected_clients}/>
          </Section>
        )}

        {/* Database — instance info */}
        {isDB && (
          <Section title="Instancia de Base de Datos">
            <Field label="Motor" value={asset.db_engine}/>
            <Field label="Versión" value={asset.db_version}/>
            <Field label="Puerto" value={asset.db_port}/>
            <Field label="Tamaño total" value={asset.db_size_gb ? `${asset.db_size_gb} GB` : null}/>
            <BoolField label="Replicación activa" value={asset.db_replication}/>
            <Field label="Modo HA" value={asset.db_ha_mode}/>
            <BoolField label="SSL/TLS" value={asset.db_ssl_enabled}/>
            <BoolField label="Auditoría del motor" value={asset.db_audit_enabled}/>
            <Field label="Codificación" value={asset.db_encoding}/>
            <Field label="Zona horaria" value={asset.db_timezone}/>
            <Field label="Último vacuum" value={asset.db_last_vacuum ? format(new Date(asset.db_last_vacuum),'dd/MM/yyyy HH:mm',{locale:es}) : null}/>
            <Field label="Conexiones máx." value={asset.db_connections_max}/>
            <Field label="Conexiones activas" value={asset.db_connections_active}/>
            {asset.db_notes && <div className="pt-2"><p className="text-xs text-gray-600 mb-1">Notas</p><p className="text-sm text-gray-600">{asset.db_notes}</p></div>}
          </Section>
        )}

        {/* Database — infrastructure & HA */}
        {isDB && (
          <Section title="Infraestructura y Alta Disponibilidad">
            {/* Host server */}
            <div className="flex items-center justify-between py-2 border-b border-gray-100">
              <span className="text-xs text-gray-700">Servidor host</span>
              {asset.db_host_asset_id ? (
                <Link to={`/assets/${asset.db_host_asset_id}`} className="text-sm text-blue-400 hover:underline">{asset.db_host_display || asset.db_host_asset_id}</Link>
              ) : (
                <span className="text-sm text-gray-600">{asset.db_host_display || asset.db_host || '—'}</span>
              )}
            </div>

            {/* Cluster or standalone */}
            <div className="flex items-center justify-between py-2 border-b border-gray-100">
              <span className="text-xs text-gray-700">Topología</span>
              {asset.db_is_cluster
                ? <span className="badge bg-green-100 text-green-700 border border-green-300">Cluster HA</span>
                : <span className="badge bg-gray-100 text-gray-600">Standalone</span>}
            </div>

            {asset.db_cluster && <Field label="Nombre del cluster" value={asset.db_cluster}/>}

            {asset.db_is_cluster && asset.db_vip && (
              <div className="flex items-center justify-between py-2 border-b border-gray-100">
                <span className="text-xs text-gray-700">🌐 VIP / Listener</span>
                <span className="text-sm font-mono text-cyan-300">{asset.db_vip}</span>
              </div>
            )}

            {/* Cluster nodes */}
            {asset.db_is_cluster && (asset.db_cluster_nodes||[]).length > 0 && (
              <div className="pt-2">
                <p className="text-xs text-gray-600 mb-2">Nodos del cluster</p>
                <table className="w-full text-xs">
                  <thead><tr className="text-gray-600 border-b border-gray-100">
                    <th className="py-1 text-left">Hostname</th>
                    <th className="py-1 text-left">Rol</th>
                    <th className="py-1 text-left">Estado</th>
                    <th className="py-1 text-left">Asset</th>
                  </tr></thead>
                  <tbody className="divide-y divide-gray-100">
                    {(asset.db_cluster_nodes||[]).map((node,i)=>(
                      <tr key={i}>
                        <td className="py-1 font-mono text-gray-700">{node.hostname}</td>
                        <td className="py-1"><span className={`badge text-[10px] ${NODE_ROLE_BADGES[node.role]||'bg-gray-100 text-gray-600'}`}>{node.role}</span></td>
                        <td className="py-1"><span className={`text-[10px] ${node.status==='online'?'text-green-400':node.status==='offline'?'text-red-600':'text-gray-600'}`}>{node.status||'—'}</span></td>
                        <td className="py-1">{node.asset_id ? <Link to={`/assets/${node.asset_id}`} className="text-blue-400 hover:underline">{node.asset_id.slice(0,8)}…</Link> : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Section>
        )}

        {/* Tags */}
        <Section title="Etiquetas">
          <div className="flex flex-wrap gap-2 pt-1">
            {(asset.tags||[]).length === 0
              ? <p className="text-xs text-gray-700">Sin etiquetas</p>
              : (asset.tags||[]).map(t=><TagBadge key={t.id} tag={t} asset={asset} excMap={excMap}/>)}
          </div>
        </Section>
      </div>

      {/* Database — schemas */}
      {isDB && (asset.db_schemas||[]).length > 0 && (
        <Section title={`Esquemas / ${schemaLabel === 'Tablas' ? 'Bases de datos alojadas' : schemaLabel}`}>
          <table className="w-full text-sm">
            <thead><tr className="text-xs text-gray-600 uppercase border-b border-gray-100">
              <th className="py-2 text-left">Nombre</th>
              <th className="py-2 text-left">Tamaño</th>
              <th className="py-2 text-left">{schemaLabel}</th>
              <th className="py-2 text-left">Propietario</th>
              <th className="py-2 text-left">Charset</th>
            </tr></thead>
            <tbody className="divide-y divide-gray-100">
              {(asset.db_schemas||[]).map((s,i)=>(
                <tr key={i} className="hover:bg-gray-50/70">
                  <td className="py-2 font-mono text-gray-800">{s.name}</td>
                  <td className="py-2 text-gray-600">{s.size_gb != null ? `${s.size_gb} GB` : '—'}</td>
                  <td className="py-2 text-gray-600">{s.table_count ?? '—'}</td>
                  <td className="py-2 text-gray-600">{s.owner||'—'}</td>
                  <td className="py-2 text-gray-600 text-xs">{s.charset||s.collation||'—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>
      )}
      {isDB && (asset.db_schemas||[]).length === 0 && (
        <div className="card p-4 text-xs text-gray-600 text-center">
          Sin datos de esquemas — requiere sincronización con el origen de datos
        </div>
      )}

      {/* Database — users */}
      {isDB && (asset.db_users||[]).length > 0 && (
        <Section title="Usuarios y roles">
          <table className="w-full text-sm">
            <thead><tr className="text-xs text-gray-600 uppercase border-b border-gray-100">
              <th className="py-2 text-left">Usuario</th>
              <th className="py-2 text-left">Rol</th>
              <th className="py-2 text-left">Último acceso</th>
            </tr></thead>
            <tbody className="divide-y divide-gray-100">
              {(asset.db_users||[]).map((u,i)=>(
                <tr key={i} className="hover:bg-gray-50/70">
                  <td className="py-2 font-mono text-gray-800">{u.username}</td>
                  <td className="py-2"><span className={`badge text-[10px] ${USER_ROLE_BADGES[u.role]||'bg-gray-100 text-gray-600'}`}>{u.role}</span></td>
                  <td className="py-2 text-xs text-gray-600">{u.last_login ? format(new Date(u.last_login),'dd/MM/yyyy HH:mm',{locale:es}) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>
      )}

      {/* Exceptions */}
      {(asset.all_exceptions||[]).length > 0 && (
        <Section title="Excepciones de compliance">
          <div className="space-y-2">
            {(asset.all_exceptions||[]).map(e=>(
              <div key={e.id} className="flex items-start gap-3 p-3 bg-gray-50 rounded-lg">
                <IndicatorBadge indicator={e.indicator}/>
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-gray-700">{e.reason}</p>
                  <p className="text-xs text-gray-600 mt-1">Por {e.created_by_name} · {e.created_at ? format(new Date(e.created_at),'dd/MM/yyyy HH:mm',{locale:es}) : '—'}</p>
                </div>
                <span className={`badge text-xs ${STATUS_COLORS[e.status]||'bg-gray-100 text-gray-600'}`}>{e.status}</span>
              </div>
            ))}
          </div>
        </Section>
      )}

      {/* Audit */}
      {(asset.recent_audit||[]).length > 0 && (
        <Section title="Historial reciente de cambios">
          <div className="space-y-2">
            {(asset.recent_audit||[]).map(l=>(
              <div key={l.id} className="flex items-start gap-3 py-2 border-b border-gray-100">
                <span className={`text-xs font-semibold w-24 shrink-0 ${ACT_COLORS[l.activity_type]||'text-gray-600'}`}>{l.activity_type}</span>
                <div className="flex-1">
                  <p className="text-xs text-gray-600">{l.username||'system'}</p>
                </div>
                <span className="text-xs text-gray-600 shrink-0">{l.timestamp ? format(new Date(l.timestamp),'dd/MM HH:mm',{locale:es}) : '—'}</span>
              </div>
            ))}
          </div>
        </Section>
      )}

      <div className="text-xs text-gray-600 flex gap-4">
        <span>Creado: {asset.created_at ? format(new Date(asset.created_at),'dd/MM/yyyy HH:mm',{locale:es}) : '—'}</span>
        <span>Actualizado: {asset.updated_at ? format(new Date(asset.updated_at),'dd/MM/yyyy HH:mm',{locale:es}) : '—'}</span>
      </div>
    </div>
  )
}
