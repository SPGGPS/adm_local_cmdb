export default {
  content: ['./index.html','./src/**/*.{js,jsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans:    ['Inter', 'system-ui', 'sans-serif'],
        display: ['"Public Sans"', 'Inter', 'sans-serif'],
      },
      colors: {
        // Paleta corporativa Local — alineada con portal intranet
        primary: {
          DEFAULT: '#76001d',   // rojo corporativo (portal)
          hover:   '#5a0016',   // más oscuro
          dark:    '#5a0016',
          cont:    '#a1002b',   // gradiente cont
          light:   '#f5e8ea',   // fondo tenue para badges/iconos
        },
        surface: {
          body:  '#f5f3f2',   // fondo general
          card:  '#ffffff',   // tarjetas
          var:   '#e4e2e2',   // bordes y separadores
          hover: '#f5e8ea',   // hover fila
          input: '#ffffff',
        },
        muted:   '#6b6e70',   // texto secundario
        onbg:    '#1b1c1c',   // texto principal
        outline: '#c8b4b5',   // bordes finos
      },
    },
  },
  plugins: [],
}
