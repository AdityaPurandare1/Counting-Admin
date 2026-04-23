// Static data used across phone + desktop mocks
const VENUES = [
  { id: 'v1', name: 'Delilah',           city: 'Los Angeles',  addr: '7969 Santa Monica Blvd',  items: 1284, zones: 6, lastCount: '2 days ago', status: 'active'   },
  { id: 'v2', name: 'Delilah Miami',     city: 'Miami Beach',  addr: '1685 Collins Ave',         items: 1120, zones: 5, lastCount: '6 days ago', status: 'scheduled'},
  { id: 'v3', name: 'The Nice Guy',      city: 'West Hollywood', addr: '401 N La Cienega Blvd',  items: 892,  zones: 4, lastCount: '1 week ago', status: 'idle'    },
  { id: 'v4', name: 'Bird Streets Club', city: 'Los Angeles',  addr: '9039 Sunset Blvd',         items: 764,  zones: 4, lastCount: '3 days ago', status: 'idle'    },
  { id: 'v5', name: 'Poppy',             city: 'Los Angeles',  addr: '727 N La Cienega Blvd',    items: 643,  zones: 3, lastCount: '2 weeks ago', status: 'overdue'},
  { id: 'v6', name: 'Keys',              city: 'West Hollywood', addr: '8631 Sunset Blvd',       items: 512,  zones: 3, lastCount: '4 days ago', status: 'idle'    },
];

const ZONES = [
  { id: 'bar-main',   name: 'Main Bar',     total: 184, counted: 142 },
  { id: 'service',    name: 'Service Bar',  total: 96,  counted: 96  },
  { id: 'backbar',    name: 'Back Bar',     total: 72,  counted: 48  },
  { id: 'cellar',     name: 'Cellar',       total: 148, counted: 32  },
  { id: 'storage',    name: 'Dry Storage',  total: 64,  counted: 12  },
  { id: 'vip',        name: 'VIP Room',     total: 42,  counted: 0   },
];

const GUIDED_ITEMS = [
  { id: 1, name: 'Don Julio 1942 Añejo',      category: 'Tequila',  par: 8,  counted: 6, unit: 'btl', upc: '811538010121', partial: null, status: 'ok'   },
  { id: 2, name: 'Macallan 18 Sherry Oak',    category: 'Whisky',   par: 4,  counted: 3, unit: 'btl', upc: '080432403112', partial: 0.7,  status: 'low'  },
  { id: 3, name: 'Clase Azul Reposado',       category: 'Tequila',  par: 6,  counted: 6, unit: 'btl', upc: '852615001089', partial: null, status: 'ok'   },
  { id: 4, name: 'Louis XIII Cognac',         category: 'Cognac',   par: 2,  counted: 1, unit: 'btl', upc: '080480280017', partial: 0.3,  status: 'low'  },
  { id: 5, name: 'Krug Grande Cuvée',         category: 'Champagne',par: 12, counted: 12,unit: 'btl', upc: '087799000133', partial: null, status: 'ok'   },
  { id: 6, name: 'Belvedere Vodka 1.75L',     category: 'Vodka',    par: 6,  counted: 4, unit: 'btl', upc: '850007100102', partial: null, status: 'ok'   },
  { id: 7, name: 'Casa Dragones Blanco',      category: 'Tequila',  par: 4,  counted: 0, unit: 'btl', upc: '862041000119', partial: null, status: 'pending' },
  { id: 8, name: 'Dom Pérignon Vintage 2013', category: 'Champagne',par: 18, counted: 0, unit: 'btl', upc: '3185370403013',partial: null, status: 'pending' },
  { id: 9, name: 'Hennessy Paradis',          category: 'Cognac',   par: 2,  counted: 0, unit: 'btl', upc: '3245994000025',partial: null, status: 'pending' },
];

const QUICK_TILES = [
  { name: 'Don Julio 1942',       cat: 'Tequila',   count: 6 },
  { name: 'Macallan 18',          cat: 'Whisky',    count: 3 },
  { name: 'Clase Azul Rep.',      cat: 'Tequila',   count: 6 },
  { name: 'Louis XIII',           cat: 'Cognac',    count: 1 },
  { name: 'Krug Grande',          cat: 'Champagne', count: 12 },
  { name: 'Belvedere 1.75',       cat: 'Vodka',     count: 4 },
  { name: 'Casa Dragones',        cat: 'Tequila',   count: 0 },
  { name: 'Dom Pérignon 13',      cat: 'Champagne', count: 0 },
  { name: 'Hennessy Paradis',     cat: 'Cognac',    count: 0 },
  { name: 'Johnnie Walker Blue',  cat: 'Whisky',    count: 2 },
  { name: 'Grey Goose',           cat: 'Vodka',     count: 5 },
  { name: 'Patrón Silver',        cat: 'Tequila',   count: 8 },
];

const VARIANCE_ROWS = [
  { name: 'Don Julio 1942 Añejo',    theo: 8.0, act: 5.0, diff: -3.0, cost: 245.00, severity: 'critical', flagged: true },
  { name: 'Macallan 18 Sherry Oak',  theo: 4.0, act: 2.7, diff: -1.3, cost: 520.00, severity: 'critical', flagged: true },
  { name: 'Louis XIII Cognac',       theo: 2.0, act: 1.3, diff: -0.7, cost: 2340.00, severity: 'high',    flagged: true },
  { name: 'Grey Goose 1L',           theo: 12.0,act: 10.0,diff: -2.0, cost: 64.00,  severity: 'medium',   flagged: true },
  { name: 'Hendrick\'s Gin',         theo: 6.0, act: 5.2, diff: -0.8, cost: 38.00,  severity: 'medium',   flagged: false },
  { name: 'Patrón Silver 750ml',     theo: 9.0, act: 8.5, diff: -0.5, cost: 52.00,  severity: 'watch',    flagged: false },
  { name: 'Belvedere 1.75L',         theo: 6.0, act: 4.0, diff: -2.0, cost: 48.00,  severity: 'high',     flagged: true },
  { name: 'Casamigos Blanco',        theo: 8.0, act: 7.8, diff: -0.2, cost: 48.00,  severity: 'low',      flagged: false },
  { name: 'Johnnie Walker Blue',     theo: 3.0, act: 2.0, diff: -1.0, cost: 240.00, severity: 'high',     flagged: true },
  { name: 'Dom Pérignon 2013',       theo: 18.0,act: 19.0,diff: +1.0, cost: 220.00, severity: 'watch',    flagged: false },
];

const ISSUES = [
  { venue: 'Delilah LA',          item: 'Don Julio 1942',    zone: 'Main Bar',  flagged: '2d ago', severity: 'critical', status: 'open', user: 'M. Reyes' },
  { venue: 'Delilah LA',          item: 'Macallan 18',        zone: 'Back Bar',  flagged: '2d ago', severity: 'critical', status: 'open', user: 'M. Reyes' },
  { venue: 'Delilah Miami',       item: 'Louis XIII',         zone: 'VIP Room',  flagged: '6d ago', severity: 'high',     status: 'review', user: 'A. Chen' },
  { venue: 'The Nice Guy',        item: 'Grey Goose 1L',      zone: 'Main Bar',  flagged: '1w ago', severity: 'medium',   status: 'resolved', user: 'J. Park' },
  { venue: 'Bird Streets Club',   item: 'Johnnie Walker Blue',zone: 'Service',   flagged: '3d ago', severity: 'high',     status: 'open',   user: 'T. Liu' },
  { venue: 'Poppy',               item: 'Belvedere 1.75L',    zone: 'Cellar',    flagged: '2w ago', severity: 'high',     status: 'open',   user: 'R. Diaz' },
  { venue: 'Keys',                item: 'Casamigos Blanco',   zone: 'Main Bar',  flagged: '4d ago', severity: 'low',      status: 'resolved', user: 'J. Park' },
];

const ACTIVITY = [
  { t: '14:32', user: 'M. Reyes', text: 'counted Don Julio 1942 · Main Bar', method: 'barcode' },
  { t: '14:31', user: 'M. Reyes', text: 'flagged Macallan 18 for recount',   method: 'flag' },
  { t: '14:29', user: 'A. Chen',  text: 'opened Cellar · 148 items',         method: 'zone' },
  { t: '14:24', user: 'M. Reyes', text: 'counted Krug Grande · ×12 (full)',  method: 'photo' },
  { t: '14:18', user: 'A. Chen',  text: 'photo parse · Clase Azul Rep.',     method: 'photo' },
  { t: '14:12', user: 'M. Reyes', text: 'started Count 1 at Delilah LA',     method: 'audit' },
];

const RECOUNT = [
  { name: 'Don Julio 1942 Añejo',    zone: 'Main Bar',  theo: 8.0, c1: 5.0, c2: null, severity: 'critical', status: 'pending' },
  { name: 'Macallan 18 Sherry Oak',  zone: 'Back Bar',  theo: 4.0, c1: 2.7, c2: null, severity: 'critical', status: 'pending' },
  { name: 'Louis XIII Cognac',       zone: 'VIP Room',  theo: 2.0, c1: 1.3, c2: 1.3,  severity: 'high',     status: 'confirmed' },
  { name: 'Belvedere 1.75L',         zone: 'Cellar',    theo: 6.0, c1: 4.0, c2: 5.0,  severity: 'high',     status: 'resolved' },
  { name: 'Johnnie Walker Blue',     zone: 'Service',   theo: 3.0, c1: 2.0, c2: null, severity: 'high',     status: 'pending' },
  { name: 'Grey Goose 1L',           zone: 'Main Bar',  theo: 12.0,c1: 10.0,c2: null, severity: 'medium',   status: 'pending' },
];

window.KOUNT_DATA = { VENUES, ZONES, GUIDED_ITEMS, QUICK_TILES, VARIANCE_ROWS, ISSUES, ACTIVITY, RECOUNT };
