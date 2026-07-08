export default function Avatar({ username = '?', src, size = 'md' }) {
  const sz = { sm:'w-7 h-7 text-xs', md:'w-9 h-9 text-sm', lg:'w-14 h-14 text-xl' }[size]
  const initials = username.slice(0,2).toUpperCase()
  if (src) return <img src={src} alt={username} className={`${sz} rounded-full object-cover ring-2 ring-primary/30`} />
  return (
    <div className={`${sz} rounded-full bg-primary/30 text-primary font-semibold flex items-center justify-center select-none`}>
      {initials}
    </div>
  )
}
