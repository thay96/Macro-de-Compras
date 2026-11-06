// Conexión a Supabase (la llave "publishable" es pública por diseño; la seguridad la dan las políticas RLS)
window.CONFIG = {
  SUPABASE_URL: 'https://wigdvudbfyzhgdoxafuo.supabase.co',
  SUPABASE_KEY: 'sb_publishable_y3oemHzSeMV3na1P0Vmfzw_6T7akHSi',
  IVA_DEFECTO: 19,

  // Tipos de producto fijos (los 21 del Excel). La señora puede agregar más;
  // los que agregue se guardan como productos y aparecen solos.
  TIPOS_FIJOS: [
    'Accesorios', 'Aspas', 'Bandas', 'Dotación', 'EPP', 'Equipo', 'Extensión',
    'Ferretería', 'Filtros', 'Lubricantes', 'Madera', 'Manguera', 'Motores',
    'Papelería', 'Químicos', 'Reparación', 'Repuesto', 'Servicio', 'Serviteca',
    'Taller', 'Tecnología', 'Vehículo'
  ],

  // Unidades de medida base (las del Excel). La señora puede agregar más.
  UNIDADES_FIJAS: ['Unidad', 'Galón', 'Kg', 'Litros', 'Mts', 'Caja', 'Paquete', 'Juego', 'Servicio', 'Rollo']
};