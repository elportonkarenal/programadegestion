import React, { useState, useEffect, useMemo, useRef } from 'react';
import { initializeApp } from 'firebase/app';
import {
  getAuth,
  signInAnonymously,
  signInWithCustomToken,
  onAuthStateChanged
} from 'firebase/auth';
import {
  getFirestore,
  collection,
  doc,
  addDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  onSnapshot
} from 'firebase/firestore';
import {
  ShoppingCart,
  Package,
  Wallet,
  BookOpen,
  Search,
  Plus,
  Minus,
  Trash2,
  CheckCircle2,
  AlertTriangle,
  ArrowRightLeft,
  Banknote,
  Smartphone,
  CreditCard,
  TrendingUp,
  Edit3,
  X,
  Calendar,
  Receipt,
  UserPlus,
  MessageCircle,
  RefreshCw,
  Percent,
  Sparkles,
  Store,
  Cloud,
  Scale,
  Lock,
  Unlock,
  Barcode,
  Printer,
  FileSpreadsheet,
  Camera,
  RotateCcw,
  Users,
  Clock,
  Settings,
  AlertCircle,
  Check,
  Copy,
  Layers,
  ImagePlus,
  Loader2,
  Mic,
  MicOff
} from 'lucide-react';

// ==========================================
// 1. CONFIGURACIÓN DE FIREBASE
// ==========================================
const firebaseConfig =
  typeof __firebase_config !== 'undefined' ? JSON.parse(__firebase_config) : {};
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const appId = typeof __app_id !== 'undefined' ? __app_id : 'almacen-control-pro';

// ==========================================
// 2. CONSTANTES Y REGLAS DE NEGOCIO
// ==========================================
const CATEGORIAS = [
  'Almacén',
  'Bebidas',
  'Fiambrería',
  'Lácteos',
  'Panadería',
  'Verdulería',
  'Limpieza',
  'Golosinas',
  'Varios'
];

const MEDIOS_PAGO = [
  { id: 'Efectivo', label: 'Efectivo', icon: Banknote },
  { id: 'Transferencia', label: 'Transferencia', icon: ArrowRightLeft },
  { id: 'Mercado Pago / QR', label: 'Mercado Pago / QR', icon: Smartphone },
  { id: 'Tarjeta', label: 'Tarjeta', icon: CreditCard }
];

const CATEGORIAS_GASTO = [
  'Pago a Proveedor',
  'Gasto del Local',
  'Retiro Personal',
  'Devolución de Seña'
];

// Regla de redondeo: múltiplos de $100 (o escalón configurable) con corte en $40
// Ejemplo: $240 -> $200 | $241 -> $300 | $255 -> $300
const roundPriceCustom = (rawAmount, step = 100, cutoff = 40) => {
  const num = Number(rawAmount) || 0;
  if (num <= 0) return 0;
  if (step <= 1) return Math.round(num);
  const base = Math.floor(num / step) * step;
  const remainder = num - base;
  if (remainder === 0) return base;
  return remainder <= cutoff ? base : base + step;
};

const formatARS = (amount) => {
  const num = Number(amount) || 0;
  return new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: 'ARS',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0
  }).format(num);
};

const formatKg = (kg) => {
  const num = Number(kg) || 0;
  return `${num.toFixed(3).replace('.', ',')} kg`;
};

const getLocalDateStr = (dateObj = new Date()) => {
  const y = dateObj.getFullYear();
  const m = String(dateObj.getMonth() + 1).padStart(2, '0');
  const d = String(dateObj.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
};

const formatTime = (iso) => {
  if (!iso) return '';
  return new Date(iso).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });
};

const formatDateShort = (isoOrDateStr) => {
  if (!isoOrDateStr) return '';
  if (isoOrDateStr.length === 10) {
    const [y, m, d] = isoOrDateStr.split('-');
    return `${d}/${m}/${y.slice(2)}`;
  }
  return new Date(isoOrDateStr).toLocaleDateString('es-AR', {
    day: '2-digit',
    month: '2-digit',
    year: '2-digit'
  });
};

const daysUntilDate = (dateStr) => {
  if (!dateStr) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(`${dateStr}T00:00:00`);
  const diff = target - today;
  return Math.ceil(diff / (1000 * 60 * 60 * 24));
};

// Datos iniciales de demostración
const SAMPLE_PRODUCTS = [
  { name: 'Yerba Mate Playadito 1kg', code: '7790070411711', category: 'Almacén', saleType: 'unit', cost: 2900, margin: 31, price: 3800, stock: 18, minStock: 6, expiryDate: '', isSample: true },
  { name: 'Aceite Girasol Cocinero 1.5L', code: '7790060023689', category: 'Almacén', saleType: 'unit', cost: 2200, margin: 32, price: 2900, stock: 12, minStock: 5, expiryDate: '', isSample: true },
  { name: 'Coca-Cola Sabor Original 2.25L', code: '7790895000997', category: 'Bebidas', saleType: 'unit', cost: 2400, margin: 33, price: 3200, stock: 24, minStock: 8, expiryDate: '', isSample: true },
  { name: 'Cerveza Quilmes Retornable 1L', code: '7792798000124', category: 'Bebidas', saleType: 'unit', cost: 1850, margin: 35, price: 2500, stock: 15, minStock: 6, expiryDate: '', isSample: true },
  { name: 'Queso Cremoso Punta del Agua (x Kg)', code: '20000101', category: 'Fiambrería', saleType: 'kg', cost: 6200, margin: 35, price: 8400, stock: 6.5, minStock: 2.0, expiryDate: getLocalDateStr(new Date(Date.now() + 5 * 86400000)), isSample: true },
  { name: 'Salame Milán Feteado (x Kg)', code: '20000102', category: 'Fiambrería', saleType: 'kg', cost: 9800, margin: 38, price: 13500, stock: 3.2, minStock: 1.0, expiryDate: getLocalDateStr(new Date(Date.now() + 9 * 86400000)), isSample: true },
  { name: 'Jamón Cocido Natural (x Kg)', code: '20000103', category: 'Fiambrería', saleType: 'kg', cost: 8500, margin: 36, price: 11600, stock: 4.0, minStock: 1.5, expiryDate: '', isSample: true },
  { name: 'Pan Francés / Mignón (x Kg)', code: '20000104', category: 'Panadería', saleType: 'kg', cost: 1400, margin: 43, price: 2000, stock: 10.0, minStock: 3.0, expiryDate: '', isSample: true },
  { name: 'Leche Entera La Serenísima 1L', code: '7790742351908', category: 'Lácteos', saleType: 'unit', cost: 1150, margin: 30, price: 1500, stock: 4, minStock: 8, expiryDate: getLocalDateStr(new Date(Date.now() + 4 * 86400000)), isSample: true },
  { name: 'Papa Negra Lavada (x Kg)', code: '20000105', category: 'Verdulería', saleType: 'kg', cost: 650, margin: 54, price: 1000, stock: 25.0, minStock: 8.0, expiryDate: '', isSample: true },
  { name: 'Lavandina Ayudín 2L', code: '7793253001122', category: 'Limpieza', saleType: 'unit', cost: 1250, margin: 36, price: 1700, stock: 10, minStock: 4, expiryDate: '', isSample: true },
  { name: 'Alfajor Jorgito Chocolate', code: '7790387012345', category: 'Golosinas', saleType: 'unit', cost: 600, margin: 50, price: 900, stock: 3, minStock: 12, expiryDate: '', isSample: true }
];

const SAMPLE_CUSTOMERS = [
  { name: 'Marta Gómez', reference: 'Vecina casa rejas verdes', phone: '5491144556677', creditLimit: 30000, balance: 8500, lastActivity: new Date().toISOString(), isSample: true },
  { name: 'Carlos "El Polaco" Ruiz', reference: 'Taller mecánico media cuadra', phone: '5491155667788', creditLimit: 50000, balance: 14200, lastActivity: new Date().toISOString(), isSample: true }
];

// ==========================================
// 3. COMPONENTE VISUAL DE CÓDIGO DE BARRAS SVG
// ==========================================
function BarcodeSVG({ value = '20000001', height = 46, showText = true }) {
  const clean = String(value || '00000000').replace(/[^0-9A-Za-z]/g, '');
  // Genera un patrón visual determinístico estilo Code128/EAN
  const bars = useMemo(() => {
    const arr = [];
    // Guardas iniciales
    arr.push({ w: 2, dark: true }, { w: 1, dark: false }, { w: 2, dark: true }, { w: 2, dark: false });
    for (let i = 0; i < clean.length; i++) {
      const code = clean.charCodeAt(i);
      const b1 = ((code >> 0) & 3) + 1;
      const s1 = ((code >> 2) & 3) + 1;
      const b2 = ((code >> 4) & 3) + 1;
      const s2 = ((code >> 6) & 1) + 1;
      arr.push({ w: b1, dark: true }, { w: s1, dark: false }, { w: b2, dark: true }, { w: s2, dark: false });
    }
    // Guardas finales
    arr.push({ w: 2, dark: true }, { w: 1, dark: false }, { w: 2, dark: true });
    return arr;
  }, [clean]);

  const totalWidth = bars.reduce((acc, b) => acc + b.w, 0);
  let currentX = 0;

  return (
    <div className="inline-flex flex-col items-center bg-white px-2 py-1 rounded-sm">
      <svg
        viewBox={`0 0 ${totalWidth} ${height}`}
        className="w-full max-w-[180px]"
        style={{ height: `${height}px` }}
        preserveAspectRatio="none"
      >
        {bars.map((b, idx) => {
          const x = currentX;
          currentX += b.w;
          if (!b.dark) return null;
          return <rect key={idx} x={x} y={0} width={b.w} height={height} fill="#0f172a" />;
        })}
      </svg>
      {showText && (
        <span className="font-mono text-[11px] tracking-[0.2em] text-slate-900 font-bold mt-0.5">
          {clean}
        </span>
      )}
    </div>
  );
}

// ==========================================
// 4. COMPONENTE PRINCIPAL DE LA APLICACIÓN
// ==========================================
export default function App() {
  // Autenticación Firebase
  const [user, setUser] = useState(null);
  const [loadingAuth, setLoadingAuth] = useState(true);

  // Código de Almacén (permite vincular PC + Celular en tiempo real sobre el mismo espacio público compartido)
  const [storeCode, setStoreCode] = useState('MI-ALMACEN-01');
  const [showStoreLinkModal, setShowStoreLinkModal] = useState(false);

  // Modo Administrador (PIN por defecto 1234)
  const [isAdmin, setIsAdmin] = useState(true);
  const [showPinModal, setShowPinModal] = useState(false);
  const [pendingAdminAction, setPendingAdminAction] = useState(null);

  // Navegación principal
  const [activeTab, setActiveTab] = useState('pos'); // 'pos' | 'products' | 'cash' | 'fiados'

  // Colecciones sincronizadas desde Firestore
  const [products, setProducts] = useState([]);
  const [sales, setSales] = useState([]);
  const [expenses, setExpenses] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [fiadoMovements, setFiadoMovements] = useState([]);
  const [storeSettings, setStoreSettings] = useState({
    storeName: 'Mi Almacén',
    adminPin: '1234',
    roundStep: 100,
    roundCutoff: 40,
    depositAmount: 2000
  });
  const [dailyOpenings, setDailyOpenings] = useState({});

  // Notificaciones Toast y Diálogo de Confirmación
  const [toast, setToast] = useState(null);
  const showToast = (message, type = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3500);
  };
  const [confirmDialog, setConfirmDialog] = useState(null);

  // Helper para exigir Modo Administrador antes de ejecutar una acción protegida
  const requireAdmin = (actionCallback) => {
    if (isAdmin) {
      actionCallback();
    } else {
      setPendingAdminAction(() => actionCallback);
      setShowPinModal(true);
    }
  };

  // ==========================================
  // EFECTO 1: AUTENTICACIÓN FIREBASE
  // ==========================================
  useEffect(() => {
    const initAuth = async () => {
      try {
        if (typeof __initial_auth_token !== 'undefined' && __initial_auth_token) {
          await signInWithCustomToken(auth, __initial_auth_token);
        } else {
          await signInAnonymously(auth);
        }
      } catch (err) {
        console.error('Error auth:', err);
      } finally {
        setLoadingAuth(false);
      }
    };
    initAuth();
    const unsub = onAuthStateChanged(auth, (u) => {
      setUser(u);
      if (u && storeCode === 'MI-ALMACEN-01') {
        // Por defecto usa un código corto derivado del usuario para aislamiento automático, editable para vincular otro dispositivo
        setStoreCode(`ALM-${u.uid.slice(0, 6).toUpperCase()}`);
      }
    });
    return () => unsub();
  }, []);

  // ==========================================
  // EFECTO 2: SUSCRIPCIONES EN TIEMPO REAL POR CÓDIGO DE ALMACÉN
  // ==========================================
  const cleanStoreCode = useMemo(
    () => (storeCode || 'DEFAULT').trim().toUpperCase().replace(/[^A-Z0-9_-]/g, ''),
    [storeCode]
  );

  useEffect(() => {
    if (!user || !cleanStoreCode) return;

    // Usamos /artifacts/{appId}/public/data/{coleccion}_{storeCode} para que PC y Celular se sincronicen en tiempo real al ingresar el mismo Código de Almacén
    const colRef = (name) =>
      collection(db, 'artifacts', appId, 'public', 'data', `${name}_${cleanStoreCode}`);

    const unsubProducts = onSnapshot(
      colRef('products'),
      (snap) => {
        const list = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        list.sort((a, b) => a.name.localeCompare(b.name));
        setProducts(list);
      },
      (err) => console.error('Error productos:', err)
    );

    const unsubSales = onSnapshot(
      colRef('sales'),
      (snap) => {
        const list = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        list.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
        setSales(list);
      },
      (err) => console.error('Error ventas:', err)
    );

    const unsubExpenses = onSnapshot(
      colRef('expenses'),
      (snap) => {
        const list = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        list.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
        setExpenses(list);
      },
      (err) => console.error('Error gastos:', err)
    );

    const unsubCustomers = onSnapshot(
      colRef('customers'),
      (snap) => {
        const list = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        list.sort((a, b) => (Number(b.balance) || 0) - (Number(a.balance) || 0));
        setCustomers(list);
      },
      (err) => console.error('Error clientes:', err)
    );

    const unsubFiados = onSnapshot(
      colRef('fiados'),
      (snap) => {
        const list = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        list.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
        setFiadoMovements(list);
      },
      (err) => console.error('Error fiados:', err)
    );

    const unsubMeta = onSnapshot(
      colRef('meta'),
      async (snap) => {
        const settingsDoc = snap.docs.find((d) => d.id === 'settings');
        if (settingsDoc) {
          setStoreSettings((prev) => ({ ...prev, ...settingsDoc.data() }));
        }

        const openingsMap = {};
        snap.docs.forEach((d) => {
          if (d.id.startsWith('opening_')) {
            openingsMap[d.id.replace('opening_', '')] = d.data();
          }
        });
        setDailyOpenings(openingsMap);

        // Si el almacén es nuevo y nunca se inicializó, precarga productos y clientes de ejemplo
        const initDoc = snap.docs.find((d) => d.id === 'seeded');
        if (!initDoc && snap.docs.length === 0) {
          try {
            await setDoc(
              doc(db, 'artifacts', appId, 'public', 'data', `meta_${cleanStoreCode}`, 'seeded'),
              { seeded: true, createdAt: new Date().toISOString() }
            );
            await setDoc(
              doc(db, 'artifacts', appId, 'public', 'data', `meta_${cleanStoreCode}`, 'settings'),
              {
                storeName: 'Mi Almacén',
                adminPin: '1234',
                roundStep: 100,
                roundCutoff: 40,
                depositAmount: 2000
              }
            );
            for (const p of SAMPLE_PRODUCTS) {
              await addDoc(colRef('products'), p);
            }
            for (const c of SAMPLE_CUSTOMERS) {
              const cRef = await addDoc(colRef('customers'), c);
              await addDoc(colRef('fiados'), {
                customerId: cRef.id,
                customerName: c.name,
                type: 'DEBT',
                amount: c.balance,
                note: 'Saldo inicial de demostración',
                createdAt: new Date().toISOString(),
                dateStr: getLocalDateStr(),
                isSample: true
              });
            }
          } catch (e) {
            console.error('Error precarga:', e);
          }
        }
      },
      (err) => console.error('Error meta:', err)
    );

    return () => {
      unsubProducts();
      unsubSales();
      unsubExpenses();
      unsubCustomers();
      unsubFiados();
      unsubMeta();
    };
  }, [user, cleanStoreCode]);

  // Limpiar datos de ejemplo
  const handleClearSampleData = () => {
    requireAdmin(() => {
      setConfirmDialog({
        title: '¿Limpiar datos de demostración?',
        message:
          'Se borrarán los productos y clientes de ejemplo precargados para que cargues tu propio almacén desde cero. Tus registros reales no se tocan.',
        confirmText: 'Sí, limpiar ejemplos',
        danger: true,
        onConfirm: async () => {
          try {
            const pCol = `products_${cleanStoreCode}`;
            for (const p of products.filter((x) => x.isSample)) {
              await deleteDoc(doc(db, 'artifacts', appId, 'public', 'data', pCol, p.id));
            }
            const cCol = `customers_${cleanStoreCode}`;
            for (const c of customers.filter((x) => x.isSample)) {
              await deleteDoc(doc(db, 'artifacts', appId, 'public', 'data', cCol, c.id));
            }
            const fCol = `fiados_${cleanStoreCode}`;
            for (const m of fiadoMovements.filter((x) => x.isSample)) {
              await deleteDoc(doc(db, 'artifacts', appId, 'public', 'data', fCol, m.id));
            }
            showToast('Ejemplos eliminados. ¡Almacén listo para tus datos!');
          } catch (e) {
            showToast('Error al limpiar ejemplos', 'error');
          }
          setConfirmDialog(null);
        }
      });
    });
  };

  const hasSampleData = useMemo(
    () => products.some((p) => p.isSample) || customers.some((c) => c.isSample),
    [products, customers]
  );

  // Alertas de stock bajo y vencimientos
  const alertsCount = useMemo(() => {
    const lowStock = products.filter((p) => Number(p.stock) <= Number(p.minStock)).length;
    const expiringSoon = products.filter((p) => {
      const d = daysUntilDate(p.expiryDate);
      return d !== null && d <= 10;
    }).length;
    return lowStock + expiringSoon;
  }, [products]);

  if (loadingAuth) {
    return (
      <div className="min-h-screen bg-slate-900 flex flex-col items-center justify-center text-white p-6">
        <Store className="w-16 h-16 text-emerald-400 animate-bounce mb-4" />
        <h1 className="text-2xl font-extrabold">Almacén Control Pro</h1>
        <p className="text-slate-400 text-sm mt-2">Conectando mostrador en tiempo real...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-100 text-slate-900 flex flex-col md:flex-row pb-20 md:pb-0">
      {/* ========================================== */}
      {/* BARRA LATERAL (PC / TABLET)                */}
      {/* ========================================== */}
      <aside className="hidden md:flex md:w-64 lg:w-72 bg-slate-900 text-white flex-col justify-between shrink-0 sticky top-0 h-screen shadow-xl z-20">
        <div>
          <div className="p-5 border-b border-slate-800 flex items-center gap-3">
            <div className="bg-emerald-500 p-2.5 rounded-xl text-slate-950 shadow-lg shadow-emerald-500/20">
              <Store className="w-6 h-6" />
            </div>
            <div className="min-w-0">
              <h1 className="font-extrabold text-base leading-tight truncate">
                {storeSettings.storeName || 'Almacén Control'}
              </h1>
              <span className="text-[11px] font-bold uppercase tracking-wider text-emerald-400">
                Mostrador Pro
              </span>
            </div>
          </div>

          <nav className="p-3.5 space-y-1.5">
            <NavButton
              active={activeTab === 'pos'}
              onClick={() => setActiveTab('pos')}
              icon={ShoppingCart}
              label="Punto de Venta"
              sublabel="Balanza, señas y cobro"
            />
            <NavButton
              active={activeTab === 'products'}
              onClick={() => setActiveTab('products')}
              icon={Package}
              label="Productos y Stock"
              sublabel="Precios, barras y boletas"
            />
            <NavButton
              active={activeTab === 'cash'}
              onClick={() => setActiveTab('cash')}
              icon={Wallet}
              label="Caja y Faltantes"
              sublabel="Cierre diario y alertas"
              badge={alertsCount > 0 ? alertsCount : null}
            />
            <NavButton
              active={activeTab === 'fiados'}
              onClick={() => setActiveTab('fiados')}
              icon={BookOpen}
              label="Clientes y Fiados"
              sublabel="Agenda y WhatsApp"
            />
          </nav>
        </div>

        <div className="p-4 border-t border-slate-800 space-y-2.5">
          {/* Estado de Modo Admin / Cajero */}
          <button
            onClick={() => {
              if (isAdmin) {
                setIsAdmin(false);
                showToast('Modo Cajero activado (Precios y borrados protegidos)');
              } else {
                setPendingAdminAction(null);
                setShowPinModal(true);
              }
            }}
            className={`w-full py-2.5 px-3 rounded-xl text-xs font-bold flex items-center justify-between transition border ${
              isAdmin
                ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-300 hover:bg-emerald-500/25'
                : 'bg-amber-500/15 border-amber-500/40 text-amber-300 hover:bg-amber-500/25'
            }`}
          >
            <span className="flex items-center gap-2">
              {isAdmin ? <Unlock className="w-4 h-4" /> : <Lock className="w-4 h-4" />}
              {isAdmin ? 'Modo Administrador' : 'Modo Cajero (Bloqueado)'}
            </span>
            <span className="text-[10px] underline">{isAdmin ? 'Bloquear' : 'Desbloquear'}</span>
          </button>

          {/* Sincronización PC + Celular */}
          <button
            onClick={() => setShowStoreLinkModal(true)}
            className="w-full bg-slate-800 hover:bg-slate-700/80 rounded-xl p-3 flex items-center justify-between text-left transition border border-slate-700"
          >
            <div className="flex items-center gap-2.5 min-w-0">
              <Cloud className="w-4 h-4 text-emerald-400 shrink-0" />
              <div className="truncate">
                <p className="text-xs font-bold text-white truncate">Código: {cleanStoreCode}</p>
                <p className="text-[10px] text-slate-400 truncate">Vincular PC + Celular</p>
              </div>
            </div>
            <Settings className="w-4 h-4 text-slate-400 shrink-0" />
          </button>

          {hasSampleData && (
            <button
              onClick={handleClearSampleData}
              className="w-full py-2 px-3 bg-slate-800/60 hover:bg-red-950/50 border border-slate-700 hover:border-red-500/40 text-slate-300 hover:text-red-300 rounded-xl text-[11px] font-semibold flex items-center justify-center gap-1.5 transition"
            >
              <Sparkles className="w-3.5 h-3.5 text-amber-400" />
              <span>Limpiar datos de ejemplo</span>
            </button>
          )}
        </div>
      </aside>

      {/* ========================================== */}
      {/* ENCABEZADO MÓVIL (CELULAR)                 */}
      {/* ========================================== */}
      <header className="md:hidden bg-slate-900 text-white px-3.5 py-2.5 flex items-center justify-between sticky top-0 z-20 shadow-md">
        <div className="flex items-center gap-2 min-w-0">
          <div className="bg-emerald-500 p-1.5 rounded-lg text-slate-950 shrink-0">
            <Store className="w-4 h-4" />
          </div>
          <div className="truncate">
            <h1 className="font-extrabold text-sm leading-none truncate">
              {storeSettings.storeName || 'Almacén Control'}
            </h1>
            <button
              onClick={() => setShowStoreLinkModal(true)}
              className="text-[10px] text-emerald-400 flex items-center gap-1 mt-0.5 font-mono"
            >
              <Cloud className="w-3 h-3" /> {cleanStoreCode}
            </button>
          </div>
        </div>

        <div className="flex items-center gap-1.5">
          {hasSampleData && (
            <button
              onClick={handleClearSampleData}
              title="Limpiar datos de ejemplo"
              className="p-2 bg-slate-800 text-amber-400 rounded-lg border border-slate-700"
            >
              <Sparkles className="w-4 h-4" />
            </button>
          )}
          <button
            onClick={() => {
              if (isAdmin) {
                setIsAdmin(false);
                showToast('Modo Cajero activado');
              } else {
                setPendingAdminAction(null);
                setShowPinModal(true);
              }
            }}
            className={`px-2.5 py-1.5 rounded-lg text-[11px] font-bold flex items-center gap-1 border ${
              isAdmin
                ? 'bg-emerald-500/20 border-emerald-500/40 text-emerald-300'
                : 'bg-amber-500/20 border-amber-500/40 text-amber-300'
            }`}
          >
            {isAdmin ? <Unlock className="w-3.5 h-3.5" /> : <Lock className="w-3.5 h-3.5" />}
            <span>{isAdmin ? 'Admin' : 'Cajero'}</span>
          </button>
        </div>
      </header>

      {/* ========================================== */}
      {/* CONTENIDO PRINCIPAL                        */}
      {/* ========================================== */}
      <main className="flex-1 max-w-7xl w-full mx-auto p-3 sm:p-5 lg:p-6">
        {activeTab === 'pos' && (
          <POSModule
            user={user}
            cleanStoreCode={cleanStoreCode}
            products={products}
            customers={customers}
            sales={sales}
            storeSettings={storeSettings}
            isAdmin={isAdmin}
            requireAdmin={requireAdmin}
            showToast={showToast}
            setConfirmDialog={setConfirmDialog}
          />
        )}
        {activeTab === 'products' && (
          <ProductsModule
            user={user}
            cleanStoreCode={cleanStoreCode}
            products={products}
            storeSettings={storeSettings}
            isAdmin={isAdmin}
            requireAdmin={requireAdmin}
            showToast={showToast}
            setConfirmDialog={setConfirmDialog}
          />
        )}
        {activeTab === 'cash' && (
          <CashModule
            user={user}
            cleanStoreCode={cleanStoreCode}
            sales={sales}
            expenses={expenses}
            fiadoMovements={fiadoMovements}
            products={products}
            dailyOpenings={dailyOpenings}
            storeSettings={storeSettings}
            isAdmin={isAdmin}
            requireAdmin={requireAdmin}
            showToast={showToast}
            setConfirmDialog={setConfirmDialog}
          />
        )}
        {activeTab === 'fiados' && (
          <FiadosModule
            user={user}
            cleanStoreCode={cleanStoreCode}
            customers={customers}
            fiadoMovements={fiadoMovements}
            storeSettings={storeSettings}
            isAdmin={isAdmin}
            requireAdmin={requireAdmin}
            showToast={showToast}
            setConfirmDialog={setConfirmDialog}
          />
        )}
      </main>

      {/* ========================================== */}
      {/* BARRA INFERIOR MÓVIL (CELULAR)             */}
      {/* ========================================== */}
      <nav className="md:hidden fixed bottom-0 inset-x-0 bg-slate-900 text-white border-t border-slate-800 grid grid-cols-4 z-30 shadow-2xl">
        <MobileNavButton
          active={activeTab === 'pos'}
          onClick={() => setActiveTab('pos')}
          icon={ShoppingCart}
          label="Mostrador"
        />
        <MobileNavButton
          active={activeTab === 'products'}
          onClick={() => setActiveTab('products')}
          icon={Package}
          label="Productos"
        />
        <MobileNavButton
          active={activeTab === 'cash'}
          onClick={() => setActiveTab('cash')}
          icon={Wallet}
          label="Caja"
          badge={alertsCount > 0 ? alertsCount : null}
        />
        <MobileNavButton
          active={activeTab === 'fiados'}
          onClick={() => setActiveTab('fiados')}
          icon={BookOpen}
          label="Fiados"
        />
      </nav>

      {/* ========================================== */}
      {/* MODAL DE PIN DE ADMINISTRADOR              */}
      {/* ========================================== */}
      {showPinModal && (
        <PinModal
          expectedPin={storeSettings.adminPin || '1234'}
          onClose={() => {
            setShowPinModal(false);
            setPendingAdminAction(null);
          }}
          onSuccess={() => {
            setIsAdmin(true);
            setShowPinModal(false);
            showToast('Modo Administrador desbloqueado');
            if (pendingAdminAction) {
              const fn = pendingAdminAction;
              setPendingAdminAction(null);
              fn();
            }
          }}
        />
      )}

      {/* ========================================== */}
      {/* MODAL VINCULAR DISPOSITIVOS Y AJUSTES      */}
      {/* ========================================== */}
      {showStoreLinkModal && (
        <StoreSettingsModal
          cleanStoreCode={cleanStoreCode}
          setStoreCode={setStoreCode}
          storeSettings={storeSettings}
          isAdmin={isAdmin}
          requireAdmin={requireAdmin}
          onClose={() => setShowStoreLinkModal(false)}
          showToast={showToast}
        />
      )}

      {/* NOTIFICACIÓN TOAST */}
      {toast && (
        <div
          className={`fixed top-4 right-4 z-50 px-4 py-3 rounded-xl shadow-2xl border flex items-center gap-3 max-w-sm ${
            toast.type === 'error'
              ? 'bg-red-600 text-white border-red-500'
              : 'bg-slate-900 text-white border-emerald-500'
          }`}
        >
          {toast.type === 'error' ? (
            <AlertTriangle className="w-5 h-5 text-red-200 shrink-0" />
          ) : (
            <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />
          )}
          <span className="text-sm font-semibold">{toast.message}</span>
        </div>
      )}

      {/* DIÁLOGO DE CONFIRMACIÓN PERSONALIZADO */}
      {confirmDialog && (
        <div className="fixed inset-0 bg-slate-950/75 backdrop-blur-xs z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl border border-slate-200">
            <h3 className="text-lg font-extrabold text-slate-900">{confirmDialog.title}</h3>
            <p className="text-slate-600 text-sm mt-2 leading-relaxed">{confirmDialog.message}</p>
            <div className="flex justify-end gap-3 mt-6">
              <button
                onClick={() => setConfirmDialog(null)}
                className="px-4 py-2.5 rounded-xl border border-slate-300 text-slate-700 font-bold text-sm hover:bg-slate-50"
              >
                Cancelar
              </button>
              <button
                onClick={confirmDialog.onConfirm}
                className={`px-4 py-2.5 rounded-xl text-white font-bold text-sm shadow-md ${
                  confirmDialog.danger
                    ? 'bg-red-600 hover:bg-red-700'
                    : 'bg-emerald-600 hover:bg-emerald-700'
                }`}
              >
                {confirmDialog.confirmText || 'Confirmar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ==========================================
// COMPONENTES DE NAVEGACIÓN Y MODALES GLOBALES
// ==========================================
function NavButton({ active, onClick, icon: Icon, label, sublabel, badge }) {
  return (
    <button
      onClick={onClick}
      className={`w-full flex items-center justify-between p-3 rounded-xl transition text-left ${
        active
          ? 'bg-emerald-500 text-slate-950 font-extrabold shadow-lg shadow-emerald-500/20'
          : 'text-slate-300 hover:bg-slate-800/80 hover:text-white'
      }`}
    >
      <div className="flex items-center gap-3">
        <Icon className={`w-5 h-5 shrink-0 ${active ? 'text-slate-950' : 'text-slate-400'}`} />
        <div>
          <div className="text-sm leading-tight">{label}</div>
          <div className={`text-[11px] mt-0.5 ${active ? 'text-slate-900/80 font-semibold' : 'text-slate-500'}`}>
            {sublabel}
          </div>
        </div>
      </div>
      {badge && (
        <span
          className={`px-2 py-0.5 text-xs font-extrabold rounded-full ${
            active ? 'bg-slate-950 text-amber-400' : 'bg-amber-500 text-slate-950'
          }`}
        >
          {badge}
        </span>
      )}
    </button>
  );
}

function MobileNavButton({ active, onClick, icon: Icon, label, badge }) {
  return (
    <button
      onClick={onClick}
      className={`relative flex flex-col items-center justify-center py-2.5 px-1 transition ${
        active ? 'text-emerald-400 bg-slate-800/70' : 'text-slate-400 hover:text-slate-200'
      }`}
    >
      <div className="relative">
        <Icon className="w-5 h-5" />
        {badge && (
          <span className="absolute -top-1.5 -right-2.5 bg-amber-500 text-slate-950 text-[10px] font-extrabold px-1.5 rounded-full">
            {badge}
          </span>
        )}
      </div>
      <span className="text-[11px] font-bold mt-1">{label}</span>
    </button>
  );
}

function PinModal({ expectedPin, onClose, onSuccess }) {
  const [pinInput, setPinInput] = useState('');
  const [error, setError] = useState(false);

  const handleSubmit = (e) => {
    e.preventDefault();
    if (pinInput === String(expectedPin)) {
      onSuccess();
    } else {
      setError(true);
      setPinInput('');
    }
  };

  return (
    <div className="fixed inset-0 bg-slate-950/75 backdrop-blur-xs z-50 flex items-center justify-center p-4">
      <form
        onSubmit={handleSubmit}
        className="bg-white rounded-3xl max-w-xs w-full p-6 shadow-2xl border border-slate-200 text-center space-y-4"
      >
        <div className="w-12 h-12 rounded-2xl bg-slate-900 text-emerald-400 flex items-center justify-center mx-auto">
          <Lock className="w-6 h-6" />
        </div>
        <div>
          <h3 className="text-lg font-extrabold text-slate-900">PIN de Administrador</h3>
          <p className="text-xs text-slate-500 mt-1">
            Ingresá tu clave para editar precios, stock o anular ventas (Por defecto: 1234)
          </p>
        </div>

        <input
          type="password"
          inputMode="numeric"
          maxLength={8}
          autoFocus
          value={pinInput}
          onChange={(e) => {
            setError(false);
            setPinInput(e.target.value);
          }}
          placeholder="••••"
          className={`w-full text-center text-2xl font-black tracking-[0.4em] py-3 rounded-xl border ${
            error ? 'border-red-500 bg-red-50 text-red-700' : 'border-slate-300 bg-slate-50'
          }`}
        />
        {error && <p className="text-xs font-bold text-red-600">PIN incorrecto. Probá de nuevo.</p>}

        <div className="grid grid-cols-2 gap-2 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="py-2.5 rounded-xl border border-slate-300 text-slate-700 font-bold text-sm"
          >
            Cancelar
          </button>
          <button
            type="submit"
            className="py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-sm"
          >
            Entrar
          </button>
        </div>
      </form>
    </div>
  );
}

function StoreSettingsModal({
  cleanStoreCode,
  setStoreCode,
  storeSettings,
  isAdmin,
  requireAdmin,
  onClose,
  showToast
}) {
  const [codeInput, setCodeInput] = useState(cleanStoreCode);
  const [storeName, setStoreName] = useState(storeSettings.storeName || 'Mi Almacén');
  const [adminPin, setAdminPin] = useState(storeSettings.adminPin || '1234');
  const [roundStep, setRoundStep] = useState(storeSettings.roundStep ?? 100);
  const [roundCutoff, setRoundCutoff] = useState(storeSettings.roundCutoff ?? 40);
  const [depositAmount, setDepositAmount] = useState(storeSettings.depositAmount ?? 2000);

  const handleSave = () => {
    const formattedCode = codeInput.trim().toUpperCase().replace(/[^A-Z0-9_-]/g, '');
    if (!formattedCode) {
      showToast('El código de almacén no puede estar vacío', 'error');
      return;
    }
    setStoreCode(formattedCode);

    if (isAdmin) {
      setDoc(
        doc(db, 'artifacts', appId, 'public', 'data', `meta_${formattedCode}`, 'settings'),
        {
          storeName: storeName.trim() || 'Mi Almacén',
          adminPin: adminPin.trim() || '1234',
          roundStep: Number(roundStep) || 100,
          roundCutoff: Number(roundCutoff) ?? 40,
          depositAmount: Number(depositAmount) || 2000
        },
        { merge: true }
      )
        .then(() => {
          showToast('Configuración y vinculación guardadas');
          onClose();
        })
        .catch(() => showToast('Error al guardar ajustes', 'error'));
    } else {
      showToast(`Conectado al almacén ${formattedCode}`);
      onClose();
    }
  };

  return (
    <div className="fixed inset-0 bg-slate-950/75 backdrop-blur-xs z-50 flex items-center justify-center p-4 overflow-y-auto">
      <div className="bg-white rounded-3xl max-w-md w-full p-6 shadow-2xl border border-slate-200 space-y-5 my-auto">
        <div className="flex items-center justify-between border-b border-slate-100 pb-3">
          <div className="flex items-center gap-2">
            <Cloud className="w-6 h-6 text-emerald-600" />
            <h3 className="text-lg font-extrabold text-slate-900">Sincronización y Ajustes</h3>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Código de vinculación PC + Celular */}
        <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-4 space-y-2">
          <label className="block text-xs font-extrabold uppercase tracking-wider text-emerald-900">
            Código Único de Almacén (PC + Celular)
          </label>
          <p className="text-xs text-emerald-800">
            Escribí este mismo código en tu computadora y en tu celular para que ambos compartan precios, stock y caja en vivo.
          </p>
          <div className="flex gap-2">
            <input
              type="text"
              value={codeInput}
              onChange={(e) => setCodeInput(e.target.value.toUpperCase())}
              className="flex-1 px-3 py-2 bg-white border border-emerald-300 rounded-xl font-mono font-extrabold text-base text-slate-900 uppercase"
            />
            <button
              type="button"
              onClick={() => {
                navigator.clipboard?.writeText(codeInput);
                showToast('Código copiado');
              }}
              className="px-3 py-2 bg-emerald-600 text-white rounded-xl text-xs font-bold flex items-center gap-1"
            >
              <Copy className="w-4 h-4" /> Copiar
            </button>
          </div>
        </div>

        {!isAdmin ? (
          <div className="p-4 bg-amber-50 border border-amber-200 rounded-2xl text-center space-y-2">
            <p className="text-xs font-bold text-amber-900">
              Desbloqueá el Modo Administrador para cambiar reglas de redondeo, señas o el PIN.
            </p>
            <button
              type="button"
              onClick={() => requireAdmin(() => {})}
              className="px-4 py-2 bg-amber-500 text-slate-950 font-extrabold text-xs rounded-xl"
            >
              Desbloquear Admin
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Nombre del Local</label>
                <input
                  type="text"
                  value={storeName}
                  onChange={(e) => setStoreName(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm font-semibold"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">PIN Administrador</label>
                <input
                  type="text"
                  inputMode="numeric"
                  value={adminPin}
                  onChange={(e) => setAdminPin(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm font-mono font-bold"
                />
              </div>
            </div>

            <div className="grid grid-cols-3 gap-2.5">
              <div>
                <label className="block text-[11px] font-bold text-slate-700 mb-1">Redondeo ($)</label>
                <select
                  value={roundStep}
                  onChange={(e) => setRoundStep(Number(e.target.value))}
                  className="w-full px-2.5 py-2 border border-slate-300 rounded-xl text-sm font-bold bg-white"
                >
                  <option value={100}>$100 (Centena)</option>
                  <option value={50}>$50</option>
                  <option value={10}>$10</option>
                  <option value={1}>$1 (Exacto)</option>
                </select>
              </div>
              <div>
                <label className="block text-[11px] font-bold text-slate-700 mb-1">Corte hacia abajo</label>
                <input
                  type="number"
                  min="0"
                  max="99"
                  value={roundCutoff}
                  onChange={(e) => setRoundCutoff(Number(e.target.value))}
                  className="w-full px-2.5 py-2 border border-slate-300 rounded-xl text-sm font-bold"
                />
              </div>
              <div>
                <label className="block text-[11px] font-bold text-slate-700 mb-1">Seña Envase ($)</label>
                <input
                  type="number"
                  min="0"
                  value={depositAmount}
                  onChange={(e) => setDepositAmount(Number(e.target.value))}
                  className="w-full px-2.5 py-2 border border-slate-300 rounded-xl text-sm font-bold"
                />
              </div>
            </div>
            <p className="text-[11px] text-slate-500">
              Regla activa: múltiplos de <strong>${roundStep}</strong>. Si pasa hasta <strong>${roundCutoff}</strong> baja; si supera ${roundCutoff} sube.
            </p>
          </div>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2.5 rounded-xl border border-slate-300 text-slate-700 font-bold text-sm"
          >
            Cerrar
          </button>
          <button
            type="button"
            onClick={handleSave}
            className="px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-extrabold text-sm"
          >
            Guardar y Aplicar
          </button>
        </div>
      </div>
    </div>
  );
}

// ==========================================
// 5. MÓDULO 1: PUNTO DE VENTA (MOSTRADOR + BALANZA + PAGO MIXTO)
// ==========================================
function POSModule({
  user,
  cleanStoreCode,
  products,
  customers,
  sales,
  storeSettings,
  isAdmin,
  requireAdmin,
  showToast,
  setConfirmDialog
}) {
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCat, setSelectedCat] = useState('Todos');
  const [cart, setCart] = useState([]);
  const searchInputRef = useRef(null);

  // Modal de Balanza (Productos por Kilo)
  const [scaleProduct, setScaleProduct] = useState(null);
  const [scaleTab, setScaleTab] = useState('grams'); // 'grams' | 'money'
  const [gramsInput, setGramsInput] = useState('');
  const [moneyInput, setMoneyInput] = useState('');

  // Modal Venta Libre / Suelto
  const [showFreeSale, setShowFreeSale] = useState(false);
  const [freeName, setFreeName] = useState('');
  const [freeAmount, setFreeAmount] = useState('');

  // Modal Editar Seña en carrito
  const [editingDepositItem, setEditingDepositItem] = useState(null);
  const [customDepositPrice, setCustomDepositPrice] = useState('');

  // Escáner con Cámara del Celular
  const [showScanner, setShowScanner] = useState(false);

  // Asistente IA de Dictado de Pedidos (Voz / Texto)
  const [showVoiceOrderModal, setShowVoiceOrderModal] = useState(false);

  // Modal de Cobro (1 Medio / Pago Mixto / Fiado)
  const [showCheckout, setShowCheckout] = useState(false);
  const [payMode, setPayMode] = useState('single'); // 'single' | 'mixed' | 'fiado'
  const [singleMethod, setSingleMethod] = useState('Efectivo');
  const [cashTendered, setCashTendered] = useState('');

  // Pago Mixto (2 medios)
  const [method1, setMethod1] = useState('Transferencia');
  const [amount1, setAmount1] = useState('');
  const [method2, setMethod2] = useState('Efectivo');
  const [amount2, setAmount2] = useState('');
  const [mixedCashTendered, setMixedCashTendered] = useState('');

  // Fiado
  const [selectedCustomerId, setSelectedCustomerId] = useState('');
  const [quickCustMode, setQuickCustMode] = useState(false);
  const [quickCustName, setQuickCustName] = useState('');
  const [quickCustPhone, setQuickCustPhone] = useState('');

  const [isSubmitting, setIsSubmitting] = useState(false);

  // Comprobante post-venta para enviar por WhatsApp
  const [lastCompletedSale, setLastCompletedSale] = useState(null);
  const [waPhoneInput, setWaPhoneInput] = useState('');

  // Historial de ventas de hoy
  const [showTodaySales, setShowTodaySales] = useState(false);

  const roundStep = storeSettings.roundStep ?? 100;
  const roundCutoff = storeSettings.roundCutoff ?? 40;
  const defaultDeposit = storeSettings.depositAmount ?? 2000;

  // Calcula el precio unitario efectivo y subtotal según cantidad (Promo / Pack / Mayorista)
  const calculateLinePricing = (prod, qty, fallbackUnitPrice) => {
    const regularUnit = prod ? Number(prod.price) : Number(fallbackUnitPrice);
    const promoQty = Number(prod?.promoQty) || 0;
    const promoUnitPrice = Number(prod?.promoPrice) || 0;
    const isPromoActive = promoQty >= 2 && promoUnitPrice > 0 && qty >= promoQty;
    const appliedUnit = isPromoActive ? promoUnitPrice : regularUnit;
    return {
      unitPrice: appliedUnit,
      regularPrice: regularUnit,
      isPromoApplied: isPromoActive,
      promoQty,
      subtotal: qty * appliedUnit
    };
  };

  // Escaneo global en PC para lectores USB sin necesidad de hacer clic en el buscador
  useEffect(() => {
    let buffer = '';
    let lastKeyTime = 0;

    const handleGlobalKeyDown = (e) => {
      if (scaleProduct || showCheckout || showFreeSale || showScanner || editingDepositItem) return;
      const tag = document.activeElement?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

      const now = Date.now();
      if (now - lastKeyTime > 80) {
        buffer = '';
      }
      lastKeyTime = now;

      if (e.key === 'Enter' && buffer.length >= 4) {
        const found = products.find(
          (p) => p.code && p.code.toLowerCase() === buffer.toLowerCase()
        );
        if (found) {
          e.preventDefault();
          handleProductClick(found);
          showToast(`Escaneado: ${found.name}`);
        }
        buffer = '';
      } else if (e.key.length === 1) {
        buffer += e.key;
      }
    };

    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => window.removeEventListener('keydown', handleGlobalKeyDown);
  }, [products, scaleProduct, showCheckout, showFreeSale, showScanner, editingDepositItem]);

  // Filtrar catálogo
  const filteredProducts = useMemo(() => {
    const term = searchTerm.toLowerCase().trim();
    return products.filter((p) => {
      const catOk = selectedCat === 'Todos' || p.category === selectedCat;
      const searchOk =
        !term ||
        p.name.toLowerCase().includes(term) ||
        (p.code && p.code.toLowerCase().includes(term));
      return catOk && searchOk;
    });
  }, [products, searchTerm, selectedCat]);

  // Si escanea código de barras exacto con lector USB y presiona Enter
  const handleSearchKeyDown = (e) => {
    if (e.key === 'Enter' && searchTerm.trim()) {
      const exactCode = products.find(
        (p) => p.code && p.code.toLowerCase() === searchTerm.trim().toLowerCase()
      );
      if (exactCode) {
        e.preventDefault();
        handleProductClick(exactCode);
        setSearchTerm('');
      }
    }
  };

  // Al tocar un producto del catálogo
  const handleProductClick = (product) => {
    if (product.saleType === 'kg') {
      setScaleProduct(product);
      setScaleTab('grams');
      setGramsInput('');
      setMoneyInput('');
    } else {
      setCart((prev) => {
        const idx = prev.findIndex((i) => i.productId === product.id && i.itemType === 'unit');
        if (idx >= 0) {
          const updated = [...prev];
          const nextQty = updated[idx].qty + 1;
          const pricing = calculateLinePricing(product, nextQty, updated[idx].regularPrice);
          updated[idx] = {
            ...updated[idx],
            qty: nextQty,
            ...pricing
          };
          return updated;
        }
        const pricing = calculateLinePricing(product, 1, Number(product.price));
        return [
          ...prev,
          {
            cartId: `unit-${product.id}-${Date.now()}`,
            productId: product.id,
            itemType: 'unit',
            name: product.name,
            qty: 1,
            ...pricing
          }
        ];
      });
    }
  };

  // Agregar un pack / bulto completo en 1 toque
  const handleAddPack = (e, product) => {
    e.stopPropagation();
    const packQty = Number(product.promoQty) || 1;
    setCart((prev) => {
      const idx = prev.findIndex((i) => i.productId === product.id && i.itemType === 'unit');
      if (idx >= 0) {
        const updated = [...prev];
        const nextQty = updated[idx].qty + packQty;
        const pricing = calculateLinePricing(product, nextQty, updated[idx].regularPrice);
        updated[idx] = {
          ...updated[idx],
          qty: nextQty,
          ...pricing
        };
        return updated;
      }
      const pricing = calculateLinePricing(product, packQty, Number(product.price));
      return [
        ...prev,
        {
          cartId: `unit-${product.id}-${Date.now()}`,
          productId: product.id,
          itemType: 'unit',
          name: product.name,
          qty: packQty,
          ...pricing
        }
      ];
    });
    showToast(`Pack x${packQty} agregado (${formatARS(Number(product.promoPrice) * packQty)})`);
  };

  // Cálculos en tiempo real dentro del Modal de Balanza
  const scalePreview = useMemo(() => {
    if (!scaleProduct) return { kg: 0, raw: 0, rounded: 0 };
    const pricePerKg = Number(scaleProduct.price) || 0;
    if (scaleTab === 'grams') {
      const grams = Number(gramsInput) || 0;
      const kg = grams / 1000;
      const raw = kg * pricePerKg;
      const rounded = roundPriceCustom(raw, roundStep, roundCutoff);
      return { kg, raw, rounded };
    } else {
      const money = Number(moneyInput) || 0;
      const rounded = roundPriceCustom(money, roundStep, roundCutoff);
      const kg = pricePerKg > 0 ? rounded / pricePerKg : 0;
      return { kg, raw: money, rounded };
    }
  }, [scaleProduct, scaleTab, gramsInput, moneyInput, roundStep, roundCutoff]);

  const confirmScaleItem = (customGrams = null) => {
    if (!scaleProduct) return;
    const pricePerKg = Number(scaleProduct.price) || 0;
    let finalKg = scalePreview.kg;
    let finalTotal = scalePreview.rounded;

    if (customGrams !== null) {
      finalKg = customGrams / 1000;
      finalTotal = roundPriceCustom(finalKg * pricePerKg, roundStep, roundCutoff);
    }

    if (finalKg <= 0 || finalTotal <= 0) {
      showToast('Ingresá un peso o importe válido', 'error');
      return;
    }

    const gramsLabel = `${Math.round(finalKg * 1000)}g`;
    setCart((prev) => [
      ...prev,
      {
        cartId: `kg-${scaleProduct.id}-${Date.now()}`,
        productId: scaleProduct.id,
        itemType: 'kg',
        name: `${scaleProduct.name} (${gramsLabel})`,
        unitPrice: pricePerKg,
        qty: Number(finalKg.toFixed(3)),
        subtotal: finalTotal
      }
    ]);
    setScaleProduct(null);
  };

  // Botón rápido: + Seña ($2.000)
  const handleAddDeposit = () => {
    setCart((prev) => {
      const idx = prev.findIndex((i) => i.itemType === 'deposit');
      if (idx >= 0) {
        const updated = [...prev];
        const newQty = updated[idx].qty + 1;
        updated[idx] = {
          ...updated[idx],
          qty: newQty,
          subtotal: newQty * updated[idx].unitPrice
        };
        return updated;
      }
      return [
        ...prev,
        {
          cartId: `deposit-${Date.now()}`,
          productId: null,
          itemType: 'deposit',
          name: 'Seña Envase Retornable',
          unitPrice: defaultDeposit,
          qty: 1,
          subtotal: defaultDeposit
        }
      ];
    });
    showToast(`Seña agregada (${formatARS(defaultDeposit)})`);
  };

  // Botón rápido: - Devolución Envase (-$2.000)
  const handleReturnDeposit = () => {
    if (cart.length > 0) {
      // Si hay compra en curso, descuenta la seña directamente del carrito
      setCart((prev) => [
        ...prev,
        {
          cartId: `ret-deposit-${Date.now()}`,
          productId: null,
          itemType: 'deposit_return',
          name: 'Devolución Envase (-Seña)',
          unitPrice: -defaultDeposit,
          qty: 1,
          subtotal: -defaultDeposit
        }
      ]);
      showToast(`Descuento de ${formatARS(defaultDeposit)} aplicado al ticket`);
    } else {
      // Si vino solo a devolver el envase sin comprar nada, registra salida de efectivo en caja
      setConfirmDialog({
        title: `¿Devolver ${formatARS(defaultDeposit)} en efectivo?`,
        message:
          'El carrito está vacío. Si el cliente solo trajo el envase vacío, se registrará una salida de efectivo en la caja del día.',
        confirmText: `Sí, entregar ${formatARS(defaultDeposit)}`,
        danger: false,
        onConfirm: async () => {
          try {
            await addDoc(
              collection(db, 'artifacts', appId, 'public', 'data', `expenses_${cleanStoreCode}`),
              {
                category: 'Devolución de Seña',
                description: 'Devolución de envase retornable en efectivo',
                amount: defaultDeposit,
                createdAt: new Date().toISOString(),
                dateStr: getLocalDateStr()
              }
            );
            showToast(`Salida de ${formatARS(defaultDeposit)} registrada en caja`);
          } catch (e) {
            showToast('Error al registrar devolución', 'error');
          }
          setConfirmDialog(null);
        }
      });
    }
  };

  // Agregar Venta Libre / Suelto
  const handleAddFreeSale = (e) => {
    e.preventDefault();
    const raw = Number(freeAmount) || 0;
    if (raw <= 0) return;
    const rounded = roundPriceCustom(raw, roundStep, roundCutoff);
    setCart((prev) => [
      ...prev,
      {
        cartId: `free-${Date.now()}`,
        productId: null,
        itemType: 'free',
        name: freeName.trim() || 'Venta Suelto / Varios',
        unitPrice: rounded,
        qty: 1,
        subtotal: rounded
      }
    ]);
    setFreeName('');
    setFreeAmount('');
    setShowFreeSale(false);
  };

  // Controles del carrito (+, -, eliminar renglón)
  const updateCartItemQty = (cartId, delta) => {
    setCart((prev) =>
      prev
        .map((item) => {
          if (item.cartId !== cartId) return item;
          if (item.itemType === 'kg') return item;
          const nextQty = item.qty + delta;
          if (nextQty <= 0) return null;
          if (item.itemType === 'unit' && item.productId) {
            const prod = products.find((p) => p.id === item.productId);
            const pricing = calculateLinePricing(prod, nextQty, item.regularPrice || item.unitPrice);
            return {
              ...item,
              qty: nextQty,
              ...pricing
            };
          }
          return {
            ...item,
            qty: nextQty,
            subtotal: nextQty * item.unitPrice
          };
        })
        .filter(Boolean)
    );
  };

  const removeCartItem = (cartId) => {
    setCart((prev) => prev.filter((item) => item.cartId !== cartId));
  };

  // Total del carrito
  const cartTotal = useMemo(
    () => cart.reduce((acc, item) => acc + Number(item.subtotal || 0), 0),
    [cart]
  );

  // Abrir modal de cobro
  const openCheckoutModal = (mode = 'single') => {
    if (cart.length === 0) return;
    setPayMode(mode);
    setSingleMethod('Efectivo');
    setCashTendered('');
    setMethod1('Transferencia');
    setAmount1('');
    setMethod2('Efectivo');
    setAmount2(String(Math.max(0, cartTotal)));
    setMixedCashTendered('');
    setSelectedCustomerId(customers[0]?.id || '');
    setQuickCustMode(false);
    setQuickCustName('');
    setQuickCustPhone('');
    setShowCheckout(true);
  };

  // Autocompletar saldo restante en Pago Mixto
  const handleMixedAmount1Change = (val) => {
    setAmount1(val);
    const num1 = Number(val) || 0;
    const rem = Math.max(0, cartTotal - num1);
    setAmount2(String(rem));
  };

  // Vuelto en pago simple
  const singleChange = useMemo(() => {
    if (payMode !== 'single' || singleMethod !== 'Efectivo') return 0;
    const paid = Number(cashTendered) || 0;
    return paid > cartTotal ? paid - cartTotal : 0;
  }, [payMode, singleMethod, cashTendered, cartTotal]);

  // Vuelto en pago mixto (si uno de los 2 medios es Efectivo)
  const mixedCashPortion = useMemo(() => {
    if (payMode !== 'mixed') return 0;
    let sum = 0;
    if (method1 === 'Efectivo') sum += Number(amount1) || 0;
    if (method2 === 'Efectivo') sum += Number(amount2) || 0;
    return sum;
  }, [payMode, method1, amount1, method2, amount2]);

  const mixedChange = useMemo(() => {
    if (mixedCashPortion <= 0) return 0;
    const paid = Number(mixedCashTendered) || 0;
    return paid > mixedCashPortion ? paid - mixedCashPortion : 0;
  }, [mixedCashPortion, mixedCashTendered]);

  // Confirmar y guardar venta en Firestore
  const handleFinalizeSale = async () => {
    if (!user || cart.length === 0 || isSubmitting) return;

    let payments = [];
    let fiadoCust = null;

    if (payMode === 'single') {
      payments = [{ method: singleMethod, amount: cartTotal }];
    } else if (payMode === 'mixed') {
      const m1 = Number(amount1) || 0;
      const m2 = Number(amount2) || 0;
      if (m1 <= 0 || m2 <= 0) {
        showToast('Ingresá ambos importes mayores a $0 para el pago mixto', 'error');
        return;
      }
      if (method1 === method2) {
        showToast('Elegí 2 medios de pago distintos para el pago mixto', 'error');
        return;
      }
      if (Math.abs(m1 + m2 - cartTotal) > 1) {
        showToast(
          `La suma (${formatARS(m1 + m2)}) debe coincidir con el total (${formatARS(cartTotal)})`,
          'error'
        );
        return;
      }
      payments = [
        { method: method1, amount: m1 },
        { method: method2, amount: m2 }
      ];
    } else if (payMode === 'fiado') {
      if (quickCustMode) {
        if (!quickCustName.trim()) {
          showToast('Escribí el nombre del cliente para anotar el fiado', 'error');
          return;
        }
      } else if (!selectedCustomerId) {
        showToast('Seleccioná un cliente de la lista', 'error');
        return;
      }
      payments = [{ method: 'Fiado', amount: cartTotal }];
    }

    setIsSubmitting(true);
    try {
      const nowIso = new Date().toISOString();
      const dateStr = getLocalDateStr();

      // Si es Fiado, actualizar o crear cliente
      if (payMode === 'fiado') {
        if (quickCustMode) {
          const newCustRef = await addDoc(
            collection(db, 'artifacts', appId, 'public', 'data', `customers_${cleanStoreCode}`),
            {
              name: quickCustName.trim(),
              reference: 'Alta rápida mostrador',
              phone: quickCustPhone.replace(/\D/g, ''),
              creditLimit: 0,
              balance: cartTotal,
              lastActivity: nowIso
            }
          );
          fiadoCust = {
            id: newCustRef.id,
            name: quickCustName.trim(),
            phone: quickCustPhone.replace(/\D/g, '')
          };
        } else {
          fiadoCust = customers.find((c) => c.id === selectedCustomerId);
          if (fiadoCust) {
            await updateDoc(
              doc(db, 'artifacts', appId, 'public', 'data', `customers_${cleanStoreCode}`, fiadoCust.id),
              {
                balance: (Number(fiadoCust.balance) || 0) + cartTotal,
                lastActivity: nowIso
              }
            );
          }
        }
      }

      // Calcular ganancia estimada de esta venta
      let totalCost = 0;
      for (const item of cart) {
        if (item.productId) {
          const p = products.find((x) => x.id === item.productId);
          if (p) totalCost += (Number(p.cost) || 0) * Number(item.qty || 0);
        }
      }

      const salePayload = {
        items: cart,
        total: cartTotal,
        estimatedProfit: Math.max(0, cartTotal - totalCost),
        payMode,
        payments,
        customerId: fiadoCust ? fiadoCust.id : null,
        customerName: fiadoCust ? fiadoCust.name : null,
        status: 'completed',
        createdAt: nowIso,
        dateStr
      };

      const saleRef = await addDoc(
        collection(db, 'artifacts', appId, 'public', 'data', `sales_${cleanStoreCode}`),
        salePayload
      );

      // Si es fiado, guardar movimiento en cuenta corriente
      if (payMode === 'fiado' && fiadoCust) {
        const itemsText = cart.map((i) => `${i.itemType === 'kg' ? '' : `${i.qty}x `}${i.name}`).join(', ');
        await addDoc(
          collection(db, 'artifacts', appId, 'public', 'data', `fiados_${cleanStoreCode}`),
          {
            customerId: fiadoCust.id,
            customerName: fiadoCust.name,
            saleId: saleRef.id,
            type: 'DEBT',
            amount: cartTotal,
            note: `Compra: ${itemsText}`,
            createdAt: nowIso,
            dateStr
          }
        );
      }

      // Descontar stock de productos catalogados (unidades o kilos)
      for (const item of cart) {
        if (item.productId) {
          const prod = products.find((p) => p.id === item.productId);
          if (prod) {
            const currentStock = Number(prod.stock) || 0;
            const updatedStock = Math.max(0, Number((currentStock - Number(item.qty)).toFixed(3)));
            await updateDoc(
              doc(db, 'artifacts', appId, 'public', 'data', `products_${cleanStoreCode}`, prod.id),
              { stock: updatedStock }
            );
          }
        }
      }

      setLastCompletedSale({ id: saleRef.id, ...salePayload });
      setWaPhoneInput(fiadoCust?.phone || '');
      setCart([]);
      setShowCheckout(false);
      showToast(
        payMode === 'fiado'
          ? `Fiado anotado a ${fiadoCust?.name} (${formatARS(cartTotal)})`
          : `¡Venta registrada por ${formatARS(cartTotal)}!`
      );
    } catch (e) {
      console.error('Error al cobrar:', e);
      showToast('Error al guardar la venta. Revisá conexión.', 'error');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Anular venta (protegido por PIN Admin) y devolver stock
  const handleVoidSale = (sale) => {
    requireAdmin(() => {
      setConfirmDialog({
        title: `¿Anular venta de ${formatARS(sale.total)}?`,
        message:
          'La venta quedará marcada como anulada, se descontará de la caja del día y se reintegrará el stock de los productos.',
        confirmText: 'Sí, anular venta',
        danger: true,
        onConfirm: async () => {
          try {
            await updateDoc(
              doc(db, 'artifacts', appId, 'public', 'data', `sales_${cleanStoreCode}`, sale.id),
              { status: 'voided' }
            );
            // Devolver stock
            for (const item of sale.items || []) {
              if (item.productId) {
                const prod = products.find((p) => p.id === item.productId);
                if (prod) {
                  const restored = Number(((Number(prod.stock) || 0) + Number(item.qty)).toFixed(3));
                  await updateDoc(
                    doc(db, 'artifacts', appId, 'public', 'data', `products_${cleanStoreCode}`, prod.id),
                    { stock: restored }
                  );
                }
              }
            }
            // Si había sido fiado, descontar del saldo del cliente
            if (sale.payMode === 'fiado' && sale.customerId) {
              const cust = customers.find((c) => c.id === sale.customerId);
              if (cust) {
                await updateDoc(
                  doc(db, 'artifacts', appId, 'public', 'data', `customers_${cleanStoreCode}`, cust.id),
                  { balance: Math.max(0, (Number(cust.balance) || 0) - Number(sale.total)) }
                );
              }
            }
            showToast('Venta anulada y stock reintegrado');
          } catch (e) {
            showToast('Error al anular venta', 'error');
          }
          setConfirmDialog(null);
        }
      });
    });
  };

  // Armar link de comprobante por WhatsApp
  const buildWhatsAppTicketUrl = (sale, phoneRaw) => {
    const cleanPhone = String(phoneRaw || '').replace(/\D/g, '');
    const lines = [
      `*${storeSettings.storeName || 'MI ALMACÉN'}* - Comprobante`,
      `Fecha: ${formatDateShort(sale.createdAt)} ${formatTime(sale.createdAt)}`,
      `-------------------------`,
      ...(sale.items || []).map(
        (i) =>
          `• ${i.itemType === 'kg' ? '' : `${i.qty}x `}${i.name}: *${formatARS(i.subtotal)}*`
      ),
      `-------------------------`,
      `*TOTAL: ${formatARS(sale.total)}*`,
      `Pago: ${(sale.payments || []).map((p) => `${p.method} (${formatARS(p.amount)})`).join(' + ')}`
    ];
    const text = encodeURIComponent(lines.join('\n'));
    return cleanPhone ? `https://wa.me/${cleanPhone}?text=${text}` : `https://wa.me/?text=${text}`;
  };

  const todaySales = useMemo(
    () => sales.filter((s) => s.dateStr === getLocalDateStr()),
    [sales]
  );

  // Cargar ítems procesados por la IA de Dictado de Voz/Texto al carrito
  const handleApplyVoiceOrder = ({ items, detectedCustomerId }) => {
    if (!items || items.length === 0) return;

    setCart((prev) => {
      let nextCart = [...prev];

      for (const aiItem of items) {
        const matchedProd = aiItem.productId
          ? products.find((p) => p.id === aiItem.productId)
          : null;

        if (matchedProd) {
          if (matchedProd.saleType === 'kg') {
            const grams = Number(aiItem.grams) || 500;
            const kg = grams / 1000;
            const total = roundPriceCustom(
              kg * (Number(matchedProd.price) || 0),
              roundStep,
              roundCutoff
            );
            nextCart.push({
              cartId: `kg-${matchedProd.id}-${Date.now()}-${Math.random()}`,
              productId: matchedProd.id,
              itemType: 'kg',
              name: `${matchedProd.name} (${grams}g)`,
              unitPrice: Number(matchedProd.price) || 0,
              qty: Number(kg.toFixed(3)),
              subtotal: total
            });
          } else {
            const addQty = Math.max(1, Math.round(Number(aiItem.qty) || 1));
            const idx = nextCart.findIndex(
              (i) => i.productId === matchedProd.id && i.itemType === 'unit'
            );
            if (idx >= 0) {
              const updatedQty = nextCart[idx].qty + addQty;
              const pricing = calculateLinePricing(
                matchedProd,
                updatedQty,
                nextCart[idx].regularPrice
              );
              nextCart[idx] = {
                ...nextCart[idx],
                qty: updatedQty,
                ...pricing
              };
            } else {
              const pricing = calculateLinePricing(
                matchedProd,
                addQty,
                Number(matchedProd.price)
              );
              nextCart.push({
                cartId: `unit-${matchedProd.id}-${Date.now()}-${Math.random()}`,
                productId: matchedProd.id,
                itemType: 'unit',
                name: matchedProd.name,
                qty: addQty,
                ...pricing
              });
            }
          }
        } else if (aiItem.customPrice > 0) {
          const rounded = roundPriceCustom(Number(aiItem.customPrice), roundStep, roundCutoff);
          nextCart.push({
            cartId: `free-${Date.now()}-${Math.random()}`,
            productId: null,
            itemType: 'free',
            name: aiItem.label || 'Producto dictado',
            unitPrice: rounded,
            qty: 1,
            subtotal: rounded
          });
        }
      }

      return nextCart;
    });

    if (detectedCustomerId) {
      setSelectedCustomerId(detectedCustomerId);
      const cust = customers.find((c) => c.id === detectedCustomerId);
      showToast(
        `Pedido cargado (${items.length} ítems) • Cliente detectado: ${cust?.name || ''}`
      );
    } else {
      showToast(`¡${items.length} productos cargados por dictado!`);
    }
    setShowVoiceOrderModal(false);
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 lg:gap-6 items-start">
      {/* ========================================== */}
      {/* COLUMNA IZQUIERDA: BUSCADOR + BOTONES + CATÁLOGO */}
      {/* ========================================== */}
      <div className="lg:col-span-7 xl:col-span-8 space-y-3.5">
        {/* Barra superior de búsqueda y acciones rápidas de mostrador */}
        <div className="bg-white p-3.5 sm:p-4 rounded-2xl shadow-xs border border-slate-200 space-y-3">
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Search className="w-5 h-5 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                onKeyDown={handleSearchKeyDown}
                placeholder="Buscar producto o pasar código de barras..."
                className="w-full pl-11 pr-9 py-3 bg-slate-50 border border-slate-300 rounded-xl text-base focus:outline-hidden focus:ring-2 focus:ring-emerald-500 focus:bg-white"
              />
              {searchTerm && (
                <button
                  onClick={() => setSearchTerm('')}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700"
                >
                  <X className="w-5 h-5" />
                </button>
              )}
            </div>
            <button
              onClick={() => setShowVoiceOrderModal(true)}
              title="Dictar pedido por voz o texto con IA"
              className="px-3.5 py-3 bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-700 hover:to-purple-700 text-white rounded-xl font-extrabold text-sm flex items-center gap-1.5 shrink-0 shadow-xs"
            >
              <Mic className="w-5 h-5 text-amber-300" />
              <span className="hidden sm:inline">Dictar Pedido</span>
            </button>
            <button
              onClick={() => setShowScanner(true)}
              title="Escanear código con cámara"
              className="px-3.5 py-3 bg-slate-900 hover:bg-slate-800 text-white rounded-xl font-bold text-sm flex items-center gap-1.5 shrink-0"
            >
              <Camera className="w-5 h-5 text-emerald-400" />
              <span className="hidden sm:inline">Escanear</span>
            </button>
          </div>

          {/* Botones Rápidos de Mostrador: Seña, Devolución Envase, Venta Libre, Últimas ventas */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <button
              onClick={handleAddDeposit}
              className="py-2.5 px-3 bg-amber-100 hover:bg-amber-200 border border-amber-300 text-amber-950 rounded-xl font-extrabold text-xs flex items-center justify-center gap-1.5 transition"
            >
              <Plus className="w-4 h-4 text-amber-700 shrink-0" />
              <span>Seña ({formatARS(defaultDeposit)})</span>
            </button>

            <button
              onClick={handleReturnDeposit}
              className="py-2.5 px-3 bg-orange-100 hover:bg-orange-200 border border-orange-300 text-orange-950 rounded-xl font-extrabold text-xs flex items-center justify-center gap-1.5 transition"
            >
              <RotateCcw className="w-4 h-4 text-orange-700 shrink-0" />
              <span>Dev. Envase</span>
            </button>

            <button
              onClick={() => setShowFreeSale(!showFreeSale)}
              className="py-2.5 px-3 bg-emerald-100 hover:bg-emerald-200 border border-emerald-300 text-emerald-950 rounded-xl font-extrabold text-xs flex items-center justify-center gap-1.5 transition"
            >
              <Plus className="w-4 h-4 text-emerald-700 shrink-0" />
              <span>Venta Suelta</span>
            </button>

            <button
              onClick={() => setShowTodaySales(true)}
              className="py-2.5 px-3 bg-slate-100 hover:bg-slate-200 border border-slate-300 text-slate-800 rounded-xl font-bold text-xs flex items-center justify-center gap-1.5 transition"
            >
              <Receipt className="w-4 h-4 text-slate-600 shrink-0" />
              <span>Tickets Hoy ({todaySales.length})</span>
            </button>
          </div>

          {/* Formulario rápido Venta Libre / Suelto */}
          {showFreeSale && (
            <form
              onSubmit={handleAddFreeSale}
              className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl flex flex-col sm:flex-row gap-2 items-end"
            >
              <div className="w-full sm:flex-1">
                <label className="block text-[11px] font-extrabold text-emerald-900 mb-1">
                  Descripción (ej. Recorte fiambre, Pan, Oferta)
                </label>
                <input
                  type="text"
                  value={freeName}
                  onChange={(e) => setFreeName(e.target.value)}
                  placeholder="Venta Suelto / Varios"
                  className="w-full px-3 py-2 bg-white border border-emerald-300 rounded-lg text-sm"
                />
              </div>
              <div className="w-full sm:w-36">
                <label className="block text-[11px] font-extrabold text-emerald-900 mb-1">
                  Importe ($)
                </label>
                <input
                  type="number"
                  required
                  min="1"
                  autoFocus
                  value={freeAmount}
                  onChange={(e) => setFreeAmount(e.target.value)}
                  placeholder="0"
                  className="w-full px-3 py-2 bg-white border border-emerald-300 rounded-lg text-sm font-extrabold"
                />
              </div>
              <button
                type="submit"
                className="w-full sm:w-auto px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-extrabold rounded-lg text-sm"
              >
                Sumar
              </button>
            </form>
          )}

          {/* Filtro por Categorías */}
          <div className="flex gap-1.5 overflow-x-auto pb-1">
            {['Todos', ...CATEGORIAS].map((cat) => (
              <button
                key={cat}
                onClick={() => setSelectedCat(cat)}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold whitespace-nowrap transition ${
                  selectedCat === cat
                    ? 'bg-slate-900 text-white'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                {cat}
              </button>
            ))}
          </div>
        </div>

        {/* Banner Comprobante Post-Venta WhatsApp */}
        {lastCompletedSale && (
          <div className="bg-emerald-900 text-white p-3.5 rounded-2xl shadow-md flex flex-col sm:flex-row items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <CheckCircle2 className="w-6 h-6 text-emerald-400 shrink-0" />
              <div>
                <p className="text-sm font-extrabold">
                  Última venta cobrada: {formatARS(lastCompletedSale.total)}
                </p>
                <p className="text-xs text-emerald-200">
                  ¿Querés mandar el ticket por WhatsApp al cliente?
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2 w-full sm:w-auto">
              <input
                type="tel"
                value={waPhoneInput}
                onChange={(e) => setWaPhoneInput(e.target.value)}
                placeholder="Celular (ej: 1144556677)"
                className="px-3 py-1.5 rounded-xl bg-emerald-950 border border-emerald-700 text-white text-xs w-36"
              />
              <a
                href={buildWhatsAppTicketUrl(lastCompletedSale, waPhoneInput)}
                target="_blank"
                rel="noopener noreferrer"
                className="px-3.5 py-2 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-extrabold text-xs rounded-xl flex items-center gap-1.5 shrink-0"
              >
                <MessageCircle className="w-4 h-4" /> Enviar
              </a>
              <button
                onClick={() => setLastCompletedSale(null)}
                className="p-1.5 text-emerald-300 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}

        {/* Grilla de Productos */}
        {filteredProducts.length === 0 ? (
          <div className="bg-white rounded-2xl p-10 text-center border border-slate-200">
            <Package className="w-12 h-12 text-slate-300 mx-auto mb-3" />
            <p className="font-extrabold text-slate-700">No hay productos con esa búsqueda</p>
            <p className="text-xs text-slate-500 mt-1">
              Probá otro nombre o usá el botón "Venta Suelta".
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 gap-2.5 sm:gap-3">
            {filteredProducts.map((prod) => {
              const isKg = prod.saleType === 'kg';
              const isLow = Number(prod.stock) <= Number(prod.minStock);
              const isZero = Number(prod.stock) <= 0;
              const hasPromo =
                !isKg && Number(prod.promoQty) >= 2 && Number(prod.promoPrice) > 0;

              return (
                <div
                  key={prod.id}
                  onClick={() => handleProductClick(prod)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => e.key === 'Enter' && handleProductClick(prod)}
                  className={`cursor-pointer bg-white active:scale-[0.98] border rounded-2xl p-3 text-left flex flex-col justify-between transition shadow-2xs group ${
                    isKg
                      ? 'border-blue-200 hover:border-blue-500 hover:bg-blue-50/40'
                      : hasPromo
                      ? 'border-purple-200 hover:border-purple-500 hover:bg-purple-50/30'
                      : 'border-slate-200 hover:border-emerald-500 hover:bg-emerald-50/40'
                  }`}
                >
                  <div>
                    <div className="flex items-center justify-between gap-1 mb-1.5">
                      {isKg ? (
                        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-blue-100 text-blue-800 text-[10px] font-extrabold">
                          <Scale className="w-3 h-3" /> BALANZA
                        </span>
                      ) : hasPromo ? (
                        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-purple-100 text-purple-800 text-[10px] font-extrabold">
                          <Layers className="w-3 h-3" /> {prod.promoQty}+ x {formatARS(prod.promoPrice)}
                        </span>
                      ) : (
                        <span className="text-[10px] font-bold uppercase text-slate-400 truncate">
                          {prod.category}
                        </span>
                      )}
                      <span
                        className={`text-[10px] font-bold px-1.5 py-0.5 rounded-md ${
                          isZero
                            ? 'bg-red-100 text-red-700'
                            : isLow
                            ? 'bg-amber-100 text-amber-800'
                            : 'bg-slate-100 text-slate-600'
                        }`}
                      >
                        {isKg ? `${Number(prod.stock).toFixed(1)}kg` : `${prod.stock}u`}
                      </span>
                    </div>
                    <h3 className="font-bold text-slate-800 text-sm leading-snug line-clamp-2">
                      {prod.name}
                    </h3>
                  </div>

                  <div className="mt-3 pt-2 border-t border-slate-100 space-y-1.5">
                    <div className="flex items-center justify-between">
                      <div>
                        <span
                          className={`text-base sm:text-lg font-black ${
                            isKg ? 'text-blue-700' : 'text-emerald-700'
                          }`}
                        >
                          {formatARS(prod.price)}
                        </span>
                        {isKg && <span className="text-[10px] font-bold text-slate-500"> /kg</span>}
                      </div>
                      <span
                        className={`w-7 h-7 rounded-lg flex items-center justify-center transition ${
                          isKg
                            ? 'bg-blue-100 text-blue-700 group-hover:bg-blue-600 group-hover:text-white'
                            : 'bg-emerald-100 text-emerald-700 group-hover:bg-emerald-600 group-hover:text-white'
                        }`}
                      >
                        {isKg ? <Scale className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
                      </span>
                    </div>

                    {hasPromo && (
                      <button
                        type="button"
                        onClick={(e) => handleAddPack(e, prod)}
                        className="w-full py-1 px-2 bg-purple-600 hover:bg-purple-700 text-white rounded-lg text-[11px] font-extrabold flex items-center justify-between transition"
                      >
                        <span>+ Pack x{prod.promoQty}</span>
                        <span>{formatARS(Number(prod.promoPrice) * Number(prod.promoQty))}</span>
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ========================================== */}
      {/* COLUMNA DERECHA: CARRITO / TICKET EN CURSO */}
      {/* ========================================== */}
      <div className="lg:col-span-5 xl:col-span-4 bg-white rounded-2xl shadow-md border border-slate-200 flex flex-col lg:sticky lg:top-6 overflow-hidden">
        <div className="p-4 bg-slate-900 text-white flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ShoppingCart className="w-5 h-5 text-emerald-400" />
            <h2 className="font-extrabold text-base">Cuenta Actual</h2>
            {cart.length > 0 && (
              <span className="bg-emerald-500 text-slate-950 text-xs font-black px-2 py-0.5 rounded-full">
                {cart.length}
              </span>
            )}
          </div>
          {cart.length > 0 && (
            <button
              onClick={() => setCart([])}
              className="text-xs text-slate-300 hover:text-red-400 flex items-center gap-1 font-bold"
            >
              <Trash2 className="w-3.5 h-3.5" /> Vaciar todo
            </button>
          )}
        </div>

        {/* Lista de renglones en carrito */}
        <div className="p-3 sm:p-4 max-h-[360px] lg:max-h-[430px] overflow-y-auto divide-y divide-slate-100">
          {cart.length === 0 ? (
            <div className="py-12 text-center text-slate-400">
              <ShoppingCart className="w-10 h-10 mx-auto mb-2 opacity-30" />
              <p className="text-sm font-bold">Tocá productos para sumar a la cuenta</p>
              <p className="text-xs mt-1">
                Redondeo automático a ${roundStep} (corte en ${roundCutoff})
              </p>
            </div>
          ) : (
            cart.map((item) => (
              <div key={item.cartId} className="py-2.5 flex items-center justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <p
                    className={`font-bold text-sm truncate ${
                      item.itemType === 'deposit'
                        ? 'text-amber-800'
                        : item.itemType === 'deposit_return'
                        ? 'text-orange-700'
                        : 'text-slate-800'
                    }`}
                  >
                    {item.name}
                  </p>
                  <div className="flex items-center gap-2 text-xs text-slate-500">
                    <span>
                      {item.itemType === 'kg'
                        ? `${formatARS(item.unitPrice)}/kg`
                        : `${formatARS(item.unitPrice)} c/u`}
                    </span>
                    {item.isPromoApplied && (
                      <span className="px-1.5 py-0.5 rounded bg-purple-100 text-purple-800 font-extrabold text-[10px]">
                        PROMO / MAYOR
                      </span>
                    )}
                    {item.itemType === 'deposit' && (
                      <button
                        onClick={() => {
                          setEditingDepositItem(item);
                          setCustomDepositPrice(String(item.unitPrice));
                        }}
                        className="text-amber-700 underline font-bold"
                      >
                        Editar monto
                      </button>
                    )}
                  </div>
                </div>

                {/* Controles + / - si es por unidad */}
                {item.itemType === 'unit' || item.itemType === 'deposit' ? (
                  <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-xl shrink-0">
                    <button
                      onClick={() => updateCartItemQty(item.cartId, -1)}
                      className="w-7 h-7 rounded-lg bg-white text-slate-700 hover:bg-red-50 hover:text-red-600 flex items-center justify-center shadow-2xs"
                    >
                      <Minus className="w-3.5 h-3.5" />
                    </button>
                    <span className="w-6 text-center font-extrabold text-sm">{item.qty}</span>
                    <button
                      onClick={() => updateCartItemQty(item.cartId, 1)}
                      className="w-7 h-7 rounded-lg bg-white text-slate-700 hover:bg-emerald-50 hover:text-emerald-600 flex items-center justify-center shadow-2xs"
                    >
                      <Plus className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ) : (
                  <span className="text-xs font-bold text-slate-500 px-2 shrink-0">
                    {item.itemType === 'kg' ? formatKg(item.qty) : '1x'}
                  </span>
                )}

                {/* Subtotal */}
                <div
                  className={`w-20 text-right font-black text-sm shrink-0 ${
                    item.subtotal < 0 ? 'text-orange-600' : 'text-slate-900'
                  }`}
                >
                  {formatARS(item.subtotal)}
                </div>

                {/* Botón Eliminar renglón puntual */}
                <button
                  onClick={() => removeCartItem(item.cartId)}
                  title="Quitar este producto de la cuenta"
                  className="p-2 rounded-xl bg-red-50 hover:bg-red-100 text-red-600 transition shrink-0"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            ))
          )}
        </div>

        {/* Total y Botones de Cobro */}
        <div className="p-4 bg-slate-50 border-t border-slate-200 space-y-3">
          <div className="flex items-baseline justify-between">
            <span className="text-xs font-extrabold text-slate-500 uppercase tracking-wider">
              Total a Cobrar
            </span>
            <span className="text-3xl font-black text-slate-900 tracking-tight">
              {formatARS(cartTotal)}
            </span>
          </div>

          <div className="space-y-2">
            <button
              disabled={cart.length === 0}
              onClick={() => openCheckoutModal('single')}
              className="w-full py-3.5 px-4 bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-300 disabled:cursor-not-allowed text-white font-black text-base rounded-xl shadow-lg shadow-emerald-600/20 flex items-center justify-center gap-2 transition"
            >
              <CheckCircle2 className="w-5 h-5" />
              <span>COBRAR (1 MEDIO)</span>
            </button>

            <div className="grid grid-cols-2 gap-2">
              <button
                disabled={cart.length === 0}
                onClick={() => openCheckoutModal('mixed')}
                className="py-2.5 px-3 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-200 disabled:text-slate-400 text-white font-extrabold text-xs sm:text-sm rounded-xl flex items-center justify-center gap-1.5 transition"
              >
                <ArrowRightLeft className="w-4 h-4 shrink-0" />
                <span>Pago Mixto (2)</span>
              </button>

              <button
                disabled={cart.length === 0}
                onClick={() => openCheckoutModal('fiado')}
                className="py-2.5 px-3 bg-amber-500 hover:bg-amber-600 disabled:bg-slate-200 disabled:text-slate-400 text-slate-950 font-extrabold text-xs sm:text-sm rounded-xl flex items-center justify-center gap-1.5 transition"
              >
                <BookOpen className="w-4 h-4 shrink-0" />
                <span>Anotar Fiado</span>
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* ========================================== */}
      {/* MODAL DE BALANZA (PRODUCTOS POR KILO)      */}
      {/* ========================================== */}
      {scaleProduct && (
        <div className="fixed inset-0 bg-slate-950/75 backdrop-blur-xs z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl max-w-md w-full overflow-hidden shadow-2xl border border-slate-200">
            <div className="bg-blue-700 text-white p-5 flex items-center justify-between">
              <div>
                <span className="text-[11px] font-extrabold uppercase tracking-wider text-blue-200 flex items-center gap-1">
                  <Scale className="w-3.5 h-3.5" /> Venta por Balanza
                </span>
                <h3 className="text-lg font-black mt-0.5">{scaleProduct.name}</h3>
                <p className="text-sm font-bold text-blue-100">
                  Precio: {formatARS(scaleProduct.price)} / kg
                </p>
              </div>
              <button
                onClick={() => setScaleProduct(null)}
                className="p-2 rounded-xl bg-blue-800 text-blue-100 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-5 space-y-4">
              {/* Selector: Por Gramos o Por Plata */}
              <div className="grid grid-cols-2 gap-2 p-1 bg-slate-100 rounded-xl">
                <button
                  type="button"
                  onClick={() => setScaleTab('grams')}
                  className={`py-2 rounded-lg text-xs font-extrabold transition ${
                    scaleTab === 'grams' ? 'bg-white text-blue-700 shadow-2xs' : 'text-slate-600'
                  }`}
                >
                  Por Peso (Gramos)
                </button>
                <button
                  type="button"
                  onClick={() => setScaleTab('money')}
                  className={`py-2 rounded-lg text-xs font-extrabold transition ${
                    scaleTab === 'money' ? 'bg-white text-blue-700 shadow-2xs' : 'text-slate-600'
                  }`}
                >
                  Por Importe ($)
                </button>
              </div>

              {scaleTab === 'grams' ? (
                <div className="space-y-3">
                  <div>
                    <label className="block text-xs font-extrabold text-slate-700 mb-1">
                      Ingresá los gramos que marca la balanza (ej: 350 = 0,350 kg)
                    </label>
                    <div className="relative">
                      <input
                        type="number"
                        inputMode="numeric"
                        autoFocus
                        value={gramsInput}
                        onChange={(e) => setGramsInput(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && confirmScaleItem()}
                        placeholder="Ej: 350"
                        className="w-full px-4 py-3.5 text-2xl font-black border-2 border-blue-300 rounded-2xl focus:outline-hidden focus:border-blue-600"
                      />
                      <span className="absolute right-4 top-1/2 -translate-y-1/2 text-sm font-extrabold text-slate-400">
                        gramos
                      </span>
                    </div>
                  </div>

                  {/* Atajos de fracciones rápidas */}
                  <div className="grid grid-cols-4 gap-2">
                    {[
                      { label: '100g', g: 100 },
                      { label: '250g (¼)', g: 250 },
                      { label: '500g (½)', g: 500 },
                      { label: '1 Kg', g: 1000 }
                    ].map((btn) => (
                      <button
                        key={btn.g}
                        type="button"
                        onClick={() => confirmScaleItem(btn.g)}
                        className="py-2.5 bg-blue-50 hover:bg-blue-100 border border-blue-200 text-blue-900 font-extrabold text-xs rounded-xl transition"
                      >
                        {btn.label}
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                <div>
                  <label className="block text-xs font-extrabold text-slate-700 mb-1">
                    ¿Cuánta plata pidió el cliente? (ej: $1500 de fiambre)
                  </label>
                  <div className="relative">
                    <span className="absolute left-4 top-1/2 -translate-y-1/2 text-xl font-black text-slate-400">
                      $
                    </span>
                    <input
                      type="number"
                      inputMode="numeric"
                      autoFocus
                      value={moneyInput}
                      onChange={(e) => setMoneyInput(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && confirmScaleItem()}
                      placeholder="1500"
                      className="w-full pl-9 pr-4 py-3.5 text-2xl font-black border-2 border-blue-300 rounded-2xl focus:outline-hidden focus:border-blue-600"
                    />
                  </div>
                </div>
              )}

              {/* Vista previa del cálculo y redondeo */}
              <div className="bg-slate-900 text-white p-4 rounded-2xl flex items-center justify-between">
                <div>
                  <p className="text-[11px] text-slate-400 font-bold">
                    Peso: {formatKg(scalePreview.kg)} | Exacto: {formatARS(scalePreview.raw)}
                  </p>
                  <p className="text-xs text-emerald-400 font-bold mt-0.5">
                    Redondeo aplicado (corte ${roundCutoff})
                  </p>
                </div>
                <div className="text-right">
                  <span className="text-2xl font-black text-emerald-400">
                    {formatARS(scalePreview.rounded)}
                  </span>
                </div>
              </div>

              <button
                type="button"
                onClick={() => confirmScaleItem()}
                className="w-full py-3.5 bg-blue-600 hover:bg-blue-700 text-white font-black text-base rounded-2xl shadow-lg"
              >
                Agregar al Ticket ({formatARS(scalePreview.rounded)})
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ========================================== */}
      {/* MODAL EDITAR IMPORTE DE SEÑA               */}
      {/* ========================================== */}
      {editingDepositItem && (
        <div className="fixed inset-0 bg-slate-950/75 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-xs w-full p-5 space-y-4 shadow-2xl">
            <h3 className="font-extrabold text-slate-900">Modificar valor de Seña</h3>
            <input
              type="number"
              autoFocus
              value={customDepositPrice}
              onChange={(e) => setCustomDepositPrice(e.target.value)}
              className="w-full px-3 py-2.5 border border-slate-300 rounded-xl text-xl font-black"
            />
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setEditingDepositItem(null)}
                className="px-3 py-2 rounded-xl border text-xs font-bold"
              >
                Cancelar
              </button>
              <button
                onClick={() => {
                  const val = Number(customDepositPrice) || 0;
                  setCart((prev) =>
                    prev.map((i) =>
                      i.cartId === editingDepositItem.cartId
                        ? { ...i, unitPrice: val, subtotal: val * i.qty }
                        : i
                    )
                  );
                  setEditingDepositItem(null);
                }}
                className="px-4 py-2 rounded-xl bg-amber-500 text-slate-950 font-extrabold text-xs"
              >
                Aplicar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ========================================== */}
      {/* MODAL DE COBRO (1 MEDIO / MIXTO 2 / FIADO) */}
      {/* ========================================== */}
      {showCheckout && (
        <div className="fixed inset-0 bg-slate-950/75 backdrop-blur-xs z-50 flex items-center justify-center p-3 sm:p-4 overflow-y-auto">
          <div className="bg-white rounded-3xl max-w-lg w-full shadow-2xl border border-slate-200 overflow-hidden my-auto">
            <div className="bg-slate-900 text-white p-5 flex items-center justify-between">
              <div>
                <p className="text-xs font-bold uppercase tracking-wider text-slate-400">
                  Total de la Compra
                </p>
                <p className="text-3xl font-black text-emerald-400">{formatARS(cartTotal)}</p>
              </div>
              <button
                onClick={() => setShowCheckout(false)}
                className="p-2 rounded-xl bg-slate-800 text-slate-300 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-5 space-y-5">
              {/* Pestañas de Modalidad */}
              <div className="grid grid-cols-3 gap-1.5 p-1.5 bg-slate-100 rounded-2xl">
                <button
                  type="button"
                  onClick={() => setPayMode('single')}
                  className={`py-2.5 px-2 rounded-xl text-xs font-extrabold transition ${
                    payMode === 'single' ? 'bg-white text-emerald-700 shadow-xs' : 'text-slate-600'
                  }`}
                >
                  1 Medio de Pago
                </button>
                <button
                  type="button"
                  onClick={() => setPayMode('mixed')}
                  className={`py-2.5 px-2 rounded-xl text-xs font-extrabold transition ${
                    payMode === 'mixed' ? 'bg-blue-600 text-white shadow-xs' : 'text-slate-600'
                  }`}
                >
                  Pago Mixto (2)
                </button>
                <button
                  type="button"
                  onClick={() => setPayMode('fiado')}
                  className={`py-2.5 px-2 rounded-xl text-xs font-extrabold transition ${
                    payMode === 'fiado' ? 'bg-amber-500 text-slate-950 shadow-xs' : 'text-slate-600'
                  }`}
                >
                  Fiado
                </button>
              </div>

              {/* OPCIÓN 1: PAGO SIMPLE */}
              {payMode === 'single' && (
                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-2.5">
                    {MEDIOS_PAGO.map((m) => {
                      const Icon = m.icon;
                      const active = singleMethod === m.id;
                      return (
                        <button
                          key={m.id}
                          type="button"
                          onClick={() => setSingleMethod(m.id)}
                          className={`p-3.5 rounded-2xl border-2 flex items-center gap-2.5 font-extrabold text-sm transition ${
                            active
                              ? 'border-emerald-600 bg-emerald-50 text-emerald-950'
                              : 'border-slate-200 hover:border-slate-300 text-slate-700'
                          }`}
                        >
                          <Icon className={`w-5 h-5 ${active ? 'text-emerald-600' : 'text-slate-400'}`} />
                          <span>{m.label}</span>
                        </button>
                      );
                    })}
                  </div>

                  {singleMethod === 'Efectivo' && (
                    <div className="bg-slate-50 p-4 rounded-2xl border border-slate-200 space-y-3">
                      <div className="flex items-center justify-between gap-3">
                        <label className="text-xs font-extrabold text-slate-700">
                          ¿Con cuánto billete paga?
                        </label>
                        <input
                          type="number"
                          inputMode="numeric"
                          value={cashTendered}
                          onChange={(e) => setCashTendered(e.target.value)}
                          placeholder={String(cartTotal)}
                          className="w-36 px-3 py-2 bg-white border border-slate-300 rounded-xl text-right font-black text-lg"
                        />
                      </div>
                      {/* Billetes rápidos argentinos */}
                      <div className="flex gap-1.5 flex-wrap">
                        {[1000, 2000, 5000, 10000, 20000].map((bill) => (
                          <button
                            key={bill}
                            type="button"
                            onClick={() => setCashTendered(String(bill))}
                            className="px-2.5 py-1 bg-white border border-slate-300 hover:border-emerald-500 rounded-lg text-xs font-bold text-slate-700"
                          >
                            {formatARS(bill)}
                          </button>
                        ))}
                      </div>
                      <div className="flex items-center justify-between pt-2 border-t border-slate-200">
                        <span className="text-xs font-bold text-slate-600">Vuelto a entregar:</span>
                        <span className="text-2xl font-black text-emerald-700">
                          {formatARS(singleChange)}
                        </span>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* OPCIÓN 2: PAGO MIXTO (2 MEDIOS COMBINADOS) */}
              {payMode === 'mixed' && (
                <div className="space-y-4">
                  <div className="bg-blue-50/70 border border-blue-200 p-4 rounded-2xl space-y-3">
                    <p className="text-xs font-extrabold text-blue-950">
                      Combiná 2 medios de pago (ej: una parte Transferencia y el resto Efectivo)
                    </p>

                    {/* Primer Medio */}
                    <div className="grid grid-cols-12 gap-2 items-center">
                      <select
                        value={method1}
                        onChange={(e) => setMethod1(e.target.value)}
                        className="col-span-7 px-3 py-2.5 bg-white border border-blue-300 rounded-xl text-sm font-bold"
                      >
                        {MEDIOS_PAGO.map((m) => (
                          <option key={m.id} value={m.id}>
                            1° {m.label}
                          </option>
                        ))}
                      </select>
                      <div className="col-span-5 relative">
                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 font-bold">
                          $
                        </span>
                        <input
                          type="number"
                          inputMode="numeric"
                          autoFocus
                          value={amount1}
                          onChange={(e) => handleMixedAmount1Change(e.target.value)}
                          placeholder="0"
                          className="w-full pl-7 pr-2.5 py-2.5 bg-white border border-blue-300 rounded-xl text-right font-black text-base"
                        />
                      </div>
                    </div>

                    {/* Segundo Medio (calcula automático el resto) */}
                    <div className="grid grid-cols-12 gap-2 items-center">
                      <select
                        value={method2}
                        onChange={(e) => setMethod2(e.target.value)}
                        className="col-span-7 px-3 py-2.5 bg-white border border-blue-300 rounded-xl text-sm font-bold"
                      >
                        {MEDIOS_PAGO.map((m) => (
                          <option key={m.id} value={m.id}>
                            2° {m.label}
                          </option>
                        ))}
                      </select>
                      <div className="col-span-5 relative">
                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 font-bold">
                          $
                        </span>
                        <input
                          type="number"
                          inputMode="numeric"
                          value={amount2}
                          onChange={(e) => setAmount2(e.target.value)}
                          placeholder="0"
                          className="w-full pl-7 pr-2.5 py-2.5 bg-white border border-blue-300 rounded-xl text-right font-black text-base"
                        />
                      </div>
                    </div>

                    <div className="flex items-center justify-between text-xs pt-2 border-t border-blue-200">
                      <span className="font-bold text-blue-900">Suma ingresada:</span>
                      <span
                        className={`font-black text-sm ${
                          Math.abs((Number(amount1) || 0) + (Number(amount2) || 0) - cartTotal) <= 1
                            ? 'text-emerald-700'
                            : 'text-red-600'
                        }`}
                      >
                        {formatARS((Number(amount1) || 0) + (Number(amount2) || 0))} /{' '}
                        {formatARS(cartTotal)}
                      </span>
                    </div>
                  </div>

                  {/* Si alguno de los 2 medios es Efectivo, permite calcular el vuelto */}
                  {mixedCashPortion > 0 && (
                    <div className="bg-slate-50 p-3.5 rounded-2xl border border-slate-200 flex items-center justify-between gap-2">
                      <div>
                        <p className="text-xs font-bold text-slate-700">
                          Parte en Efectivo: <strong>{formatARS(mixedCashPortion)}</strong>
                        </p>
                        <p className="text-xs text-emerald-700 font-extrabold mt-0.5">
                          Vuelto: {formatARS(mixedChange)}
                        </p>
                      </div>
                      <input
                        type="number"
                        inputMode="numeric"
                        value={mixedCashTendered}
                        onChange={(e) => setMixedCashTendered(e.target.value)}
                        placeholder="Billete recibido"
                        className="w-36 px-3 py-2 bg-white border border-slate-300 rounded-xl text-right font-bold text-sm"
                      />
                    </div>
                  )}
                </div>
              )}

              {/* OPCIÓN 3: FIADO */}
              {payMode === 'fiado' && (
                <div className="bg-amber-50 border border-amber-200 p-4 rounded-2xl space-y-3">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-extrabold text-amber-950">
                      Cliente de la Libreta
                    </label>
                    <button
                      type="button"
                      onClick={() => setQuickCustMode(!quickCustMode)}
                      className="text-xs font-extrabold text-amber-800 underline"
                    >
                      {quickCustMode ? 'Elegir existente' : '+ Cliente nuevo'}
                    </button>
                  </div>

                  {quickCustMode ? (
                    <div className="space-y-2">
                      <input
                        type="text"
                        value={quickCustName}
                        onChange={(e) => setQuickCustName(e.target.value)}
                        placeholder="Nombre y apellido / Apodo"
                        className="w-full px-3 py-2.5 bg-white border border-amber-300 rounded-xl text-sm font-bold"
                      />
                      <input
                        type="tel"
                        value={quickCustPhone}
                        onChange={(e) => setQuickCustPhone(e.target.value)}
                        placeholder="WhatsApp (opcional, ej: 1144556677)"
                        className="w-full px-3 py-2.5 bg-white border border-amber-300 rounded-xl text-sm"
                      />
                    </div>
                  ) : (
                    <select
                      value={selectedCustomerId}
                      onChange={(e) => setSelectedCustomerId(e.target.value)}
                      className="w-full px-3 py-2.5 bg-white border border-amber-300 rounded-xl text-sm font-bold"
                    >
                      <option value="">-- Seleccionar cliente --</option>
                      {customers.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name} (Debe: {formatARS(c.balance)})
                        </option>
                      ))}
                    </select>
                  )}
                </div>
              )}

              <button
                type="button"
                disabled={isSubmitting}
                onClick={handleFinalizeSale}
                className="w-full py-4 bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-400 text-white font-black text-base rounded-2xl shadow-lg flex items-center justify-center gap-2 transition"
              >
                <Check className="w-5 h-5" />
                <span>
                  {isSubmitting
                    ? 'Registrando...'
                    : payMode === 'fiado'
                    ? 'CONFIRMAR FIADO'
                    : 'CONFIRMAR COBRO'}
                </span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ========================================== */}
      {/* MODAL ESCÁNER CON CÁMARA DEL CELULAR       */}
      {/* ========================================== */}
      {showScanner && (
        <BarcodeScannerModal
          products={products}
          onDetected={(prod) => {
            setShowScanner(false);
            handleProductClick(prod);
            showToast(`Escaneado: ${prod.name}`);
          }}
          onManualCode={(code) => {
            setShowScanner(false);
            setSearchTerm(code);
          }}
          onClose={() => setShowScanner(false)}
        />
      )}

      {/* ========================================== */}
      {/* MODAL DICTADO DE PEDIDOS POR VOZ / TEXTO   */}
      {/* ========================================== */}
      {showVoiceOrderModal && (
        <VoiceOrderModal
          products={products}
          customers={customers}
          onApply={handleApplyVoiceOrder}
          onClose={() => setShowVoiceOrderModal(false)}
          showToast={showToast}
        />
      )}

      {/* ========================================== */}
      {/* MODAL ÚLTIMAS VENTAS DE HOY (CON ANULACIÓN)*/}
      {/* ========================================== */}
      {showTodaySales && (
        <div className="fixed inset-0 bg-slate-950/75 z-50 flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white rounded-3xl max-w-xl w-full p-5 shadow-2xl space-y-4 my-auto">
            <div className="flex items-center justify-between border-b pb-3">
              <h3 className="font-extrabold text-lg text-slate-900">
                Ventas de Hoy ({todaySales.length})
              </h3>
              <button
                onClick={() => setShowTodaySales(false)}
                className="p-1.5 rounded-lg bg-slate-100 text-slate-600"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="max-h-[420px] overflow-y-auto divide-y divide-slate-100">
              {todaySales.length === 0 ? (
                <p className="text-center text-slate-400 py-10 text-sm">
                  Todavía no hay ventas registradas hoy.
                </p>
              ) : (
                todaySales.map((s) => (
                  <div
                    key={s.id}
                    className={`py-3 flex items-center justify-between gap-3 ${
                      s.status === 'voided' ? 'opacity-50 line-through' : ''
                    }`}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-mono font-bold text-slate-500">
                          {formatTime(s.createdAt)}
                        </span>
                        <span className="font-black text-slate-900 text-sm">
                          {formatARS(s.total)}
                        </span>
                        <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-slate-100 text-slate-700">
                          {(s.payments || []).map((p) => p.method).join(' + ')}
                        </span>
                      </div>
                      <p className="text-xs text-slate-500 truncate mt-0.5">
                        {(s.items || []).map((i) => `${i.qty}x ${i.name}`).join(', ')}
                      </p>
                    </div>

                    {s.status !== 'voided' && (
                      <div className="flex items-center gap-1.5 shrink-0">
                        <a
                          href={buildWhatsAppTicketUrl(s, '')}
                          target="_blank"
                          rel="noopener noreferrer"
                          title="Enviar comprobante por WhatsApp"
                          className="p-2 rounded-xl bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
                        >
                          <MessageCircle className="w-4 h-4" />
                        </a>
                        <button
                          onClick={() => handleVoidSale(s)}
                          title="Anular venta (Admin)"
                          className="px-2.5 py-1.5 rounded-xl bg-red-50 hover:bg-red-100 text-red-700 text-xs font-bold"
                        >
                          Anular
                        </button>
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Subcomponente Escáner con Cámara (BarcodeDetector API + Fallback)
function BarcodeScannerModal({ products, onDetected, onManualCode, onClose }) {
  const videoRef = useRef(null);
  const [camError, setCamError] = useState('');
  const [manualInput, setManualInput] = useState('');

  useEffect(() => {
    let stream = null;
    let intervalId = null;

    const startCamera = async () => {
      try {
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
          setCamError('Tu navegador no permite abrir la cámara aquí. Ingresá el código abajo.');
          return;
        }
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment' }
        });
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
        }

        if ('BarcodeDetector' in window) {
          const detector = new window.BarcodeDetector({
            formats: ['ean_13', 'ean_8', 'code_128', 'upc_a', 'upc_e']
          });
          intervalId = setInterval(async () => {
            if (videoRef.current && videoRef.current.readyState === 4) {
              try {
                const barcodes = await detector.detect(videoRef.current);
                if (barcodes.length > 0) {
                  const rawCode = barcodes[0].rawValue;
                  const found = products.find((p) => p.code === rawCode);
                  if (found) {
                    clearInterval(intervalId);
                    onDetected(found);
                  }
                }
              } catch (e) {}
            }
          }, 500);
        } else {
          setCamError(
            'Vista previa activa. Si tu dispositivo no detecta automático, escribí o escaneá el número abajo.'
          );
        }
      } catch (err) {
        setCamError('No se pudo acceder a la cámara. Ingresá o pasá el código manualmente abajo.');
      }
    };

    startCamera();
    return () => {
      if (intervalId) clearInterval(intervalId);
      if (stream) stream.getTracks().forEach((t) => t.stop());
    };
  }, [products]);

  return (
    <div className="fixed inset-0 bg-slate-950/80 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-3xl max-w-sm w-full p-5 space-y-4 shadow-2xl">
        <div className="flex items-center justify-between">
          <h3 className="font-extrabold text-slate-900 flex items-center gap-2">
            <Camera className="w-5 h-5 text-emerald-600" /> Lector de Código
          </h3>
          <button onClick={onClose} className="p-1.5 rounded-lg bg-slate-100">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="relative bg-slate-900 rounded-2xl overflow-hidden aspect-video flex items-center justify-center">
          <video ref={videoRef} autoPlay playsInline muted className="w-full h-full object-cover" />
          <div className="absolute inset-x-8 h-0.5 bg-red-500 shadow-[0_0_8px_red]" />
        </div>

        {camError && <p className="text-xs text-amber-800 bg-amber-50 p-2.5 rounded-xl">{camError}</p>}

        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (manualInput.trim()) onManualCode(manualInput.trim());
          }}
          className="flex gap-2"
        >
          <input
            type="text"
            autoFocus
            value={manualInput}
            onChange={(e) => setManualInput(e.target.value)}
            placeholder="Código de barras..."
            className="flex-1 px-3 py-2.5 border border-slate-300 rounded-xl font-mono text-sm"
          />
          <button
            type="submit"
            className="px-4 py-2.5 bg-emerald-600 text-white font-bold text-sm rounded-xl"
          >
            Buscar
          </button>
        </form>
      </div>
    </div>
  );
}

// Subcomponente Asistente IA de Dictado por Voz / Texto
function VoiceOrderModal({ products, customers, onApply, onClose, showToast }) {
  const [transcriptText, setTranscriptText] = useState('');
  const [isListening, setIsListening] = useState(false);
  const [isProcessingAI, setIsProcessingAI] = useState(false);
  const [parsedResult, setParsedResult] = useState(null);
  const recognitionRef = useRef(null);
  const mediaRecorderRef = useRef(null);
  const audioChunksRef = useRef([]);

  useEffect(() => {
    return () => {
      if (recognitionRef.current) {
        try {
          recognitionRef.current.stop();
        } catch (e) {}
      }
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
        try {
          mediaRecorderRef.current.stop();
        } catch (e) {}
      }
    };
  }, []);

  // Construye la consulta estructurada a Gemini (admite texto o audio grabado)
  const callGeminiOrderParser = async ({ textInput = '', audioBase64 = '', audioMimeType = '' }) => {
    setIsProcessingAI(true);
    try {
      const catalogSummary = products.map((p) => ({
        id: p.id,
        name: p.name,
        saleType: p.saleType,
        price: p.price
      }));

      const customersSummary = customers.map((c) => ({
        id: c.id,
        name: c.name
      }));

      const prompt = `Sos el asistente de mostrador de un almacén argentino. Interpretá el pedido ${
        audioBase64 ? 'escuchando el audio adjunto' : `dictado: "${textInput}"`
      }.
Catálogo disponible (JSON): ${JSON.stringify(catalogSummary)}
Clientes agendados (JSON): ${JSON.stringify(customersSummary)}

Reglas:
1. Buscá cada producto pedido dentro del catálogo por coincidencia aproximada (ej. "coca" -> Coca-Cola, "cremoso" -> Queso Cremoso, "yerba" -> Yerba Mate).
2. Si el producto es saleType "kg", convertí las expresiones de peso a gramos en el campo "grams" (ej. "medio kilo" = 500, "un cuarto" = 250, "200 gramos" = 200, "1 kilo" = 1000).
3. Si es saleType "unit", poné la cantidad en "qty" (ej. "dos" = 2, "media docena" = 6).
4. Si nombra un producto que NO existe en el catálogo pero menciona un precio (ej. "500 de pan"), dejá productId vacío y poné el precio en "customPrice".
5. Si menciona a un cliente agendado (ej. "anotale a Marta"), devolvé su ID en "detectedCustomerId".
6. Devolvé en "transcription" lo que se pidió en texto claro.`;

      const userParts = [{ text: prompt }];
      if (audioBase64) {
        userParts.push({
          inlineData: {
            mimeType: audioMimeType || 'audio/webm',
            data: audioBase64
          }
        });
      }

      const payload = {
        contents: [{ role: 'user', parts: userParts }],
        generationConfig: {
          responseMimeType: 'application/json',
          responseSchema: {
            type: 'OBJECT',
            properties: {
              transcription: { type: 'STRING' },
              detectedCustomerId: { type: 'STRING' },
              items: {
                type: 'ARRAY',
                items: {
                  type: 'OBJECT',
                  properties: {
                    productId: { type: 'STRING' },
                    label: { type: 'STRING' },
                    qty: { type: 'NUMBER' },
                    grams: { type: 'NUMBER' },
                    customPrice: { type: 'NUMBER' }
                  },
                  propertyOrdering: ['productId', 'label', 'qty', 'grams', 'customPrice']
                }
              }
            },
            propertyOrdering: ['transcription', 'detectedCustomerId', 'items']
          }
        }
      };

      const apiKey = '';
      const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent?key=${apiKey}`;

      let response = null;
      let delay = 1000;
      for (let attempt = 0; attempt < 4; attempt++) {
        response = await fetch(apiUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        if (response.ok) break;
        if (attempt < 3) {
          await new Promise((r) => setTimeout(r, delay));
          delay *= 2;
        }
      }

      if (!response || !response.ok) {
        throw new Error('Error de conexión con IA');
      }

      const result = await response.json();
      const rawJson = result?.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!rawJson) throw new Error('Respuesta vacía');

      const parsed = JSON.parse(rawJson);
      if (parsed.transcription && audioBase64) {
        setTranscriptText(parsed.transcription);
      }

      if (!parsed.items || parsed.items.length === 0) {
        showToast('No pude identificar productos en ese pedido. Probá detallarlo un poco más.', 'error');
        return;
      }

      setParsedResult(parsed);
    } catch (err) {
      showToast('No se pudo procesar el pedido con IA. Intentá de nuevo.', 'error');
    } finally {
      setIsProcessingAI(false);
    }
  };

  // Grabación universal de audio (funciona en iPhone, Android y PC)
  const startUniversalAudioRecording = async () => {
    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        showToast('No se detectó micrófono. Escribí el pedido en el cuadro de abajo.', 'error');
        return;
      }
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = MediaRecorder.isTypeSupported('audio/webm')
        ? 'audio/webm'
        : MediaRecorder.isTypeSupported('audio/mp4')
        ? 'audio/mp4'
        : '';

      const recorder = mimeType
        ? new MediaRecorder(stream, { mimeType })
        : new MediaRecorder(stream);

      audioChunksRef.current = [];
      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) {
          audioChunksRef.current.push(e.data);
        }
      };

      recorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        const finalMime = recorder.mimeType || 'audio/webm';
        const audioBlob = new Blob(audioChunksRef.current, { type: finalMime });
        if (audioBlob.size < 500) return;

        const base64Audio = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result || '').split(',')[1]);
          reader.onerror = reject;
          reader.readAsDataURL(audioBlob);
        });

        await callGeminiOrderParser({ audioBase64: base64Audio, audioMimeType: finalMime });
      };

      mediaRecorderRef.current = recorder;
      recorder.start();
      setIsListening(true);
    } catch (err) {
      setIsListening(false);
      showToast('Permiso de micrófono denegado. Podés escribir el pedido abajo.', 'error');
    }
  };

  const toggleMicrophone = () => {
    if (isListening) {
      if (recognitionRef.current) {
        try {
          recognitionRef.current.stop();
        } catch (e) {}
      }
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
        try {
          mediaRecorderRef.current.stop();
        } catch (e) {}
      }
      setIsListening(false);
      return;
    }

    const SpeechRecognition =
      window.SpeechRecognition || window.webkitSpeechRecognition;

    // Si el navegador soporta reconocimiento en vivo (Chrome PC / Android), lo usa; si no (iPhone/Safari), graba audio directo para Gemini
    if (SpeechRecognition) {
      try {
        const recognition = new SpeechRecognition();
        recognition.lang = 'es-AR';
        recognition.continuous = true;
        recognition.interimResults = true;

        recognition.onstart = () => setIsListening(true);
        recognition.onerror = () => {
          setIsListening(false);
          startUniversalAudioRecording();
        };
        recognition.onend = () => setIsListening(false);

        recognition.onresult = (event) => {
          let fullText = '';
          for (let i = 0; i < event.results.length; i++) {
            fullText += event.results[i][0].transcript;
          }
          setTranscriptText(fullText);
        };

        recognitionRef.current = recognition;
        recognition.start();
      } catch (e) {
        startUniversalAudioRecording();
      }
    } else {
      startUniversalAudioRecording();
    }
  };

  const handleInterpretOrder = async () => {
    const cleanText = transcriptText.trim();
    if (!cleanText) {
      showToast('Dictá o escribí primero lo que pidió el cliente', 'error');
      return;
    }

    if (isListening) {
      toggleMicrophone();
    }

    await callGeminiOrderParser({ textInput: cleanText });
  };

  return (
    <div className="fixed inset-0 bg-slate-950/75 backdrop-blur-xs z-50 flex items-center justify-center p-4 overflow-y-auto">
      <div className="bg-white rounded-3xl max-w-lg w-full p-6 shadow-2xl space-y-4 my-auto">
        <div className="flex items-center justify-between border-b pb-3">
          <div>
            <h3 className="text-lg font-black text-slate-900 flex items-center gap-2">
              <Sparkles className="w-5 h-5 text-indigo-600" /> Dictado de Pedido con IA
            </h3>
            <p className="text-xs text-slate-500">
              Hablá al micrófono o escribí como hablás en el mostrador
            </p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg bg-slate-100">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Botón grande de Micrófono */}
        <div className="flex flex-col items-center justify-center p-4 bg-indigo-50/70 border border-indigo-200 rounded-2xl space-y-2.5">
          <button
            type="button"
            onClick={toggleMicrophone}
            className={`w-16 h-16 rounded-full flex items-center justify-center shadow-lg transition ${
              isListening
                ? 'bg-red-600 text-white animate-pulse ring-4 ring-red-200'
                : 'bg-indigo-600 hover:bg-indigo-700 text-white'
            }`}
          >
            {isListening ? <MicOff className="w-7 h-7" /> : <Mic className="w-7 h-7" />}
          </button>
          <p className="text-xs font-extrabold text-indigo-950">
            {isListening
              ? 'Escuchando... Tocá de nuevo para detener'
              : 'Tocá el micrófono para dictar el pedido'}
          </p>
          <p className="text-[11px] text-slate-500 text-center">
            Ej: <em>"2 yerbas playadito, medio kilo de cremoso y una coca para Marta"</em>
          </p>
        </div>

        {/* Texto dictado editable */}
        <div>
          <label className="block text-xs font-extrabold text-slate-700 mb-1">
            Pedido capturado (podés corregirlo o escribirlo directo)
          </label>
          <textarea
            rows={3}
            value={transcriptText}
            onChange={(e) => setTranscriptText(e.target.value)}
            placeholder="Ej: 2 yerbas, 250 gramos de salame y una lavandina..."
            className="w-full p-3 border border-slate-300 rounded-xl text-sm bg-slate-50"
          />
        </div>

        <button
          type="button"
          disabled={isProcessingAI || !transcriptText.trim()}
          onClick={handleInterpretOrder}
          className="w-full py-3 bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-300 text-white font-black text-sm rounded-xl flex items-center justify-center gap-2 shadow-sm"
        >
          {isProcessingAI ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              <span>Armando carrito con IA...</span>
            </>
          ) : (
            <>
              <Sparkles className="w-4 h-4 text-amber-300" />
              <span>Interpretar Pedido</span>
            </>
          )}
        </button>

        {/* Vista previa de los productos interpretados */}
        {parsedResult && (
          <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-4 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-black text-emerald-950 uppercase">
                Productos detectados ({parsedResult.items.length})
              </span>
              {parsedResult.detectedCustomerId && (
                <span className="px-2 py-0.5 rounded-full bg-amber-200 text-amber-950 text-[11px] font-extrabold">
                  Cliente:{' '}
                  {customers.find((c) => c.id === parsedResult.detectedCustomerId)?.name || 'Detectado'}
                </span>
              )}
            </div>

            <div className="divide-y divide-emerald-200/70 text-xs">
              {parsedResult.items.map((item, idx) => {
                const prod = products.find((p) => p.id === item.productId);
                return (
                  <div key={idx} className="py-1.5 flex items-center justify-between gap-2">
                    <span className="font-bold text-slate-900">
                      {prod ? prod.name : item.label}
                    </span>
                    <span className="font-black text-emerald-800 shrink-0">
                      {prod?.saleType === 'kg'
                        ? `${item.grams || 500} g`
                        : prod
                        ? `${item.qty || 1} u.`
                        : formatARS(item.customPrice)}
                    </span>
                  </div>
                );
              })}
            </div>

            <button
              type="button"
              onClick={() => onApply(parsedResult)}
              className="w-full py-3 bg-emerald-600 hover:bg-emerald-700 text-white font-black text-sm rounded-xl shadow-md"
            >
              Sumar todo al Carrito
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ==========================================
// 6. MÓDULO 2: CATÁLOGO, PRECIOS, CÓDIGOS DE BARRAS E IMPORTADOR DE BOLETAS
// ==========================================
function ProductsModule({
  user,
  cleanStoreCode,
  products,
  storeSettings,
  isAdmin,
  requireAdmin,
  showToast,
  setConfirmDialog
}) {
  const [search, setSearch] = useState('');
  const [catFilter, setCatFilter] = useState('Todos');

  // Modal Alta / Edición de producto
  const [editingProd, setEditingProd] = useState(null);
  const [formState, setFormState] = useState({
    name: '',
    category: 'Almacén',
    saleType: 'unit',
    code: '',
    cost: '',
    margin: '35',
    price: '',
    promoQty: '',
    promoPrice: '',
    stock: '',
    minStock: '5',
    expiryDate: ''
  });

  // Modal Aumento Masivo por %
  const [showBulkRaise, setShowBulkRaise] = useState(false);
  const [bulkCat, setBulkCat] = useState('Bebidas');
  const [bulkPercent, setBulkPercent] = useState('10');

  // Modal Importador de Boletas / Listas de Proveedores
  const [showInvoiceImporter, setShowInvoiceImporter] = useState(false);

  // Modal Impresión de Etiquetas de Código de Barras
  const [printLabelProduct, setPrintLabelProduct] = useState(null);

  const roundStep = storeSettings.roundStep ?? 100;
  const roundCutoff = storeSettings.roundCutoff ?? 40;

  const filtered = useMemo(() => {
    const t = search.toLowerCase().trim();
    return products.filter((p) => {
      const catOk = catFilter === 'Todos' || p.category === catFilter;
      const searchOk =
        !t || p.name.toLowerCase().includes(t) || (p.code && p.code.toLowerCase().includes(t));
      return catOk && searchOk;
    });
  }, [products, search, catFilter]);

  // Abrir formulario de producto (protegido por Admin)
  const openProductForm = (prod = null) => {
    requireAdmin(() => {
      if (prod) {
        setEditingProd(prod);
        setFormState({
          name: prod.name || '',
          category: prod.category || 'Almacén',
          saleType: prod.saleType || 'unit',
          code: prod.code || '',
          cost: String(prod.cost ?? ''),
          margin: String(prod.margin ?? '35'),
          price: String(prod.price ?? ''),
          promoQty: prod.promoQty ? String(prod.promoQty) : '',
          promoPrice: prod.promoPrice ? String(prod.promoPrice) : '',
          stock: String(prod.stock ?? '0'),
          minStock: String(prod.minStock ?? '5'),
          expiryDate: prod.expiryDate || ''
        });
      } else {
        setEditingProd('NEW');
        setFormState({
          name: '',
          category: 'Almacén',
          saleType: 'unit',
          code: '',
          cost: '',
          margin: '35',
          price: '',
          promoQty: '',
          promoPrice: '',
          stock: '',
          minStock: '5',
          expiryDate: ''
        });
      }
    });
  };

  // Calcular precio de venta automáticamente al cambiar Costo o % Ganancia (aplicando regla de redondeo)
  const handleCostOrMarginChange = (newCost, newMargin) => {
    const c = Number(newCost) || 0;
    const m = Number(newMargin) || 0;
    let calcPrice = formState.price;
    if (c > 0) {
      const raw = c * (1 + m / 100);
      calcPrice = String(roundPriceCustom(raw, roundStep, roundCutoff));
    }
    setFormState((prev) => ({
      ...prev,
      cost: newCost,
      margin: newMargin,
      price: calcPrice
    }));
  };

  // Generar código de barras interno único
  const generateInternalBarcode = () => {
    const randomPart = Math.floor(100000 + Math.random() * 900000);
    setFormState((prev) => ({ ...prev, code: `20${randomPart}` }));
  };

  const handleSaveProduct = async (e) => {
    e.preventDefault();
    if (!formState.name.trim()) return;
    const payload = {
      name: formState.name.trim(),
      category: formState.category,
      saleType: formState.saleType,
      code: formState.code.trim(),
      cost: Number(formState.cost) || 0,
      margin: Number(formState.margin) || 0,
      price: Number(formState.price) || 0,
      promoQty: formState.saleType === 'unit' ? Number(formState.promoQty) || 0 : 0,
      promoPrice: formState.saleType === 'unit' ? Number(formState.promoPrice) || 0 : 0,
      stock: Number(formState.stock) || 0,
      minStock: Number(formState.minStock) || 0,
      expiryDate: formState.expiryDate || ''
    };

    try {
      const colPath = `products_${cleanStoreCode}`;
      if (editingProd === 'NEW') {
        await addDoc(collection(db, 'artifacts', appId, 'public', 'data', colPath), payload);
        showToast('Producto agregado al catálogo');
      } else {
        await updateDoc(doc(db, 'artifacts', appId, 'public', 'data', colPath, editingProd.id), payload);
        showToast('Producto actualizado en PC y Celular');
      }
      setEditingProd(null);
    } catch (err) {
      showToast('Error al guardar producto', 'error');
    }
  };

  const handleDeleteProduct = (prod) => {
    requireAdmin(() => {
      setConfirmDialog({
        title: `¿Eliminar "${prod.name}"?`,
        message: 'Se quitará del catálogo y del punto de venta.',
        confirmText: 'Sí, eliminar',
        danger: true,
        onConfirm: async () => {
          try {
            await deleteDoc(
              doc(db, 'artifacts', appId, 'public', 'data', `products_${cleanStoreCode}`, prod.id)
            );
            showToast('Producto eliminado');
          } catch (e) {
            showToast('Error al eliminar', 'error');
          }
          setConfirmDialog(null);
        }
      });
    });
  };

  // Aumento masivo por porcentaje
  const handleBulkRaiseSubmit = async (e) => {
    e.preventDefault();
    const pct = Number(bulkPercent) || 0;
    if (pct === 0) return;
    const targets =
      bulkCat === 'TODAS' ? products : products.filter((p) => p.category === bulkCat);

    try {
      const colPath = `products_${cleanStoreCode}`;
      for (const p of targets) {
        const newCost = Math.round((Number(p.cost) || 0) * (1 + pct / 100));
        const rawNewPrice = (Number(p.price) || 0) * (1 + pct / 100);
        const newPrice = roundPriceCustom(rawNewPrice, roundStep, roundCutoff);
        await updateDoc(doc(db, 'artifacts', appId, 'public', 'data', colPath, p.id), {
          cost: newCost,
          price: newPrice
        });
      }
      showToast(`Se actualizaron ${targets.length} productos (+${pct}%)`);
      setShowBulkRaise(false);
    } catch (err) {
      showToast('Error en actualización masiva', 'error');
    }
  };

  return (
    <div className="space-y-4">
      {/* Cabecera y Herramientas */}
      <div className="bg-white p-4 rounded-2xl shadow-xs border border-slate-200 space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h2 className="text-xl font-black text-slate-900">Catálogo, Precios y Stock</h2>
            <p className="text-xs text-slate-500">
              {products.length} productos • Cambios sincronizados en vivo entre PC y Celular
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => requireAdmin(() => setShowInvoiceImporter(true))}
              className="px-3.5 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white font-extrabold text-xs rounded-xl flex items-center gap-1.5 shadow-xs"
            >
              <FileSpreadsheet className="w-4 h-4" />
              <span>Importar Boleta / Lista</span>
            </button>

            <button
              onClick={() => requireAdmin(() => setShowBulkRaise(true))}
              className="px-3.5 py-2.5 bg-amber-500 hover:bg-amber-600 text-slate-950 font-extrabold text-xs rounded-xl flex items-center gap-1.5"
            >
              <Percent className="w-4 h-4" />
              <span>Aumento Masivo %</span>
            </button>

            <button
              onClick={() => openProductForm(null)}
              className="px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-extrabold text-xs rounded-xl flex items-center gap-1.5 shadow-sm"
            >
              <Plus className="w-4 h-4" />
              <span>Nuevo Producto</span>
            </button>
          </div>
        </div>

        {/* Buscador y Filtros */}
        <div className="flex flex-col sm:flex-row gap-2">
          <div className="relative flex-1">
            <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar por nombre o código de barras..."
              className="w-full pl-10 pr-4 py-2.5 bg-slate-50 border border-slate-300 rounded-xl text-sm"
            />
          </div>
          <select
            value={catFilter}
            onChange={(e) => setCatFilter(e.target.value)}
            className="px-3 py-2.5 bg-slate-50 border border-slate-300 rounded-xl text-sm font-bold"
          >
            <option value="Todos">Todas las categorías</option>
            {CATEGORIAS.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Tabla / Lista de Productos */}
      <div className="bg-white rounded-2xl shadow-xs border border-slate-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-900 text-white text-[11px] uppercase tracking-wider">
                <th className="py-3 px-4">Producto / Código</th>
                <th className="py-3 px-3">Venta</th>
                <th className="py-3 px-3 text-right">Costo</th>
                <th className="py-3 px-3 text-right">Precio Público</th>
                <th className="py-3 px-3 text-center">Stock</th>
                <th className="py-3 px-4 text-right">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-sm">
              {filtered.map((prod) => {
                const isKg = prod.saleType === 'kg';
                const isLow = Number(prod.stock) <= Number(prod.minStock);
                const expDays = daysUntilDate(prod.expiryDate);

                return (
                  <tr key={prod.id} className="hover:bg-slate-50/80">
                    <td className="py-3 px-4">
                      <div className="font-extrabold text-slate-900">{prod.name}</div>
                      <div className="flex flex-wrap items-center gap-2 mt-0.5 text-xs text-slate-500">
                        <span className="font-semibold text-slate-600">{prod.category}</span>
                        {prod.code && (
                          <span className="font-mono bg-slate-100 px-1.5 py-0.5 rounded text-[11px]">
                            #{prod.code}
                          </span>
                        )}
                        {expDays !== null && (
                          <span
                            className={`px-1.5 py-0.5 rounded text-[11px] font-bold ${
                              expDays <= 7
                                ? 'bg-red-100 text-red-700'
                                : 'bg-amber-100 text-amber-800'
                            }`}
                          >
                            Vence: {formatDateShort(prod.expiryDate)}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="py-3 px-3">
                      {isKg ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-blue-100 text-blue-800 text-xs font-extrabold">
                          <Scale className="w-3 h-3" /> Por Kilo
                        </span>
                      ) : (
                        <span className="px-2 py-0.5 rounded-full bg-slate-100 text-slate-700 text-xs font-bold">
                          Unidad
                        </span>
                      )}
                    </td>
                    <td className="py-3 px-3 text-right text-slate-600 font-medium">
                      {formatARS(prod.cost)}
                    </td>
                    <td className="py-3 px-3 text-right font-black text-emerald-700 text-base">
                      <div>
                        {formatARS(prod.price)}
                        {isKg && <span className="text-[11px] font-bold text-slate-500">/kg</span>}
                      </div>
                      {!isKg && Number(prod.promoQty) >= 2 && Number(prod.promoPrice) > 0 && (
                        <span className="inline-block mt-0.5 px-1.5 py-0.5 rounded bg-purple-100 text-purple-800 text-[10px] font-extrabold">
                          {prod.promoQty}+ u: {formatARS(prod.promoPrice)} c/u
                        </span>
                      )}
                    </td>
                    <td className="py-3 px-3 text-center">
                      <span
                        className={`inline-block px-2.5 py-1 rounded-xl text-xs font-extrabold ${
                          isLow ? 'bg-amber-100 text-amber-900' : 'bg-slate-100 text-slate-800'
                        }`}
                      >
                        {isKg ? `${Number(prod.stock).toFixed(2)} kg` : `${prod.stock} u.`}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-right">
                      <div className="inline-flex items-center gap-1">
                        {prod.code && (
                          <button
                            onClick={() => setPrintLabelProduct(prod)}
                            title="Ver / Imprimir etiqueta de código de barras"
                            className="p-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700"
                          >
                            <Barcode className="w-4 h-4" />
                          </button>
                        )}
                        <button
                          onClick={() => openProductForm(prod)}
                          title="Editar precio o stock (Admin)"
                          className="p-2 rounded-xl bg-blue-50 hover:bg-blue-100 text-blue-700"
                        >
                          <Edit3 className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => handleDeleteProduct(prod)}
                          title="Eliminar producto (Admin)"
                          className="p-2 rounded-xl bg-red-50 hover:bg-red-100 text-red-600"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* ========================================== */}
      {/* MODAL ALTA / EDICIÓN DE PRODUCTO           */}
      {/* ========================================== */}
      {editingProd && (
        <div className="fixed inset-0 bg-slate-950/75 backdrop-blur-xs z-50 flex items-center justify-center p-4 overflow-y-auto">
          <form
            onSubmit={handleSaveProduct}
            className="bg-white rounded-3xl max-w-lg w-full p-6 shadow-2xl space-y-4 my-auto"
          >
            <div className="flex items-center justify-between border-b pb-3">
              <h3 className="text-lg font-black text-slate-900">
                {editingProd === 'NEW' ? 'Nuevo Producto' : 'Editar Producto'}
              </h3>
              <button
                type="button"
                onClick={() => setEditingProd(null)}
                className="p-1.5 rounded-lg bg-slate-100"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="sm:col-span-2">
                <label className="block text-xs font-extrabold text-slate-700 mb-1">
                  Nombre del Producto *
                </label>
                <input
                  type="text"
                  required
                  value={formState.name}
                  onChange={(e) => setFormState({ ...formState, name: e.target.value })}
                  placeholder="Ej: Yerba Taragüi 1kg o Queso Cremoso"
                  className="w-full px-3.5 py-2.5 border border-slate-300 rounded-xl text-sm font-bold"
                />
              </div>

              <div>
                <label className="block text-xs font-extrabold text-slate-700 mb-1">Categoría</label>
                <select
                  value={formState.category}
                  onChange={(e) => setFormState({ ...formState, category: e.target.value })}
                  className="w-full px-3 py-2.5 border border-slate-300 rounded-xl text-sm font-bold bg-white"
                >
                  {CATEGORIAS.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-extrabold text-slate-700 mb-1">
                  Modo de Venta
                </label>
                <select
                  value={formState.saleType}
                  onChange={(e) => setFormState({ ...formState, saleType: e.target.value })}
                  className="w-full px-3 py-2.5 border border-slate-300 rounded-xl text-sm font-bold bg-white"
                >
                  <option value="unit">Por Unidad / Paquete</option>
                  <option value="kg">Por Kilo (Balanza)</option>
                </select>
              </div>

              {/* Código de barras + Generador */}
              <div className="sm:col-span-2">
                <label className="block text-xs font-extrabold text-slate-700 mb-1">
                  Código de Barras (Fábrica o Generado Interno)
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={formState.code}
                    onChange={(e) => setFormState({ ...formState, code: e.target.value })}
                    placeholder="Escaneá o generá uno propio..."
                    className="flex-1 px-3 py-2 border border-slate-300 rounded-xl font-mono text-sm"
                  />
                  <button
                    type="button"
                    onClick={generateInternalBarcode}
                    className="px-3 py-2 bg-slate-900 text-white font-bold text-xs rounded-xl flex items-center gap-1.5 shrink-0"
                  >
                    <Barcode className="w-4 h-4 text-emerald-400" /> Generar Código
                  </button>
                </div>
                {formState.code && (
                  <div className="mt-2 flex justify-center bg-slate-50 py-2 rounded-xl border border-slate-200">
                    <BarcodeSVG value={formState.code} height={36} />
                  </div>
                )}
              </div>

              {/* Costo, % Ganancia y Precio Final Redondeado */}
              <div className="sm:col-span-2 bg-emerald-50/70 border border-emerald-200 p-3.5 rounded-2xl grid grid-cols-3 gap-2.5">
                <div>
                  <label className="block text-[11px] font-extrabold text-slate-700 mb-1">
                    Costo ($)
                  </label>
                  <input
                    type="number"
                    min="0"
                    value={formState.cost}
                    onChange={(e) => handleCostOrMarginChange(e.target.value, formState.margin)}
                    placeholder="0"
                    className="w-full px-2.5 py-2 bg-white border border-slate-300 rounded-xl text-sm font-bold"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-extrabold text-slate-700 mb-1">
                    Ganancia (%)
                  </label>
                  <input
                    type="number"
                    value={formState.margin}
                    onChange={(e) => handleCostOrMarginChange(formState.cost, e.target.value)}
                    placeholder="35"
                    className="w-full px-2.5 py-2 bg-white border border-slate-300 rounded-xl text-sm font-bold"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-extrabold text-emerald-900 mb-1">
                    Precio Unidad ($)
                  </label>
                  <input
                    type="number"
                    required
                    min="0"
                    value={formState.price}
                    onChange={(e) => setFormState({ ...formState, price: e.target.value })}
                    className="w-full px-2.5 py-2 bg-white border-2 border-emerald-500 rounded-xl text-sm font-black text-emerald-800"
                  />
                </div>
              </div>

              {/* Precio por Mayor / Pack / Promoción (Opcional para productos por unidad) */}
              {formState.saleType === 'unit' && (
                <div className="sm:col-span-2 bg-purple-50/80 border border-purple-200 p-3.5 rounded-2xl space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-extrabold text-purple-950 flex items-center gap-1.5">
                      <Layers className="w-4 h-4 text-purple-600" /> Precio por Mayor / Pack / Promo (Opcional)
                    </span>
                    {Number(formState.promoQty) >= 2 && Number(formState.promoPrice) > 0 && (
                      <span className="text-[11px] font-black text-purple-800">
                        Pack x{formState.promoQty} ={' '}
                        {formatARS(Number(formState.promoQty) * Number(formState.promoPrice))}
                      </span>
                    )}
                  </div>
                  <div className="grid grid-cols-2 gap-2.5">
                    <div>
                      <label className="block text-[11px] font-bold text-purple-900 mb-1">
                        A partir de (unidades)
                      </label>
                      <input
                        type="number"
                        min="2"
                        value={formState.promoQty}
                        onChange={(e) => setFormState({ ...formState, promoQty: e.target.value })}
                        placeholder="Ej: 6 (pack) o 3 (promo)"
                        className="w-full px-2.5 py-2 bg-white border border-purple-300 rounded-xl text-sm font-bold"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-bold text-purple-900 mb-1">
                        Precio c/u en promo ($)
                      </label>
                      <input
                        type="number"
                        min="0"
                        value={formState.promoPrice}
                        onChange={(e) => setFormState({ ...formState, promoPrice: e.target.value })}
                        placeholder="Ej: 2800"
                        className="w-full px-2.5 py-2 bg-white border border-purple-300 rounded-xl text-sm font-black text-purple-900"
                      />
                    </div>
                  </div>
                </div>
              )}

              <div>
                <label className="block text-xs font-extrabold text-slate-700 mb-1">
                  Stock Actual ({formState.saleType === 'kg' ? 'Kilos' : 'Unidades'})
                </label>
                <input
                  type="number"
                  step="any"
                  value={formState.stock}
                  onChange={(e) => setFormState({ ...formState, stock: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm font-bold"
                />
              </div>

              <div>
                <label className="block text-xs font-extrabold text-slate-700 mb-1">
                  Stock Mínimo (Alerta)
                </label>
                <input
                  type="number"
                  step="any"
                  value={formState.minStock}
                  onChange={(e) => setFormState({ ...formState, minStock: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm font-bold"
                />
              </div>

              <div className="sm:col-span-2">
                <label className="block text-xs font-extrabold text-slate-700 mb-1">
                  Próximo Vencimiento (Opcional - lácteos/fiambres)
                </label>
                <input
                  type="date"
                  value={formState.expiryDate}
                  onChange={(e) => setFormState({ ...formState, expiryDate: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm"
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setEditingProd(null)}
                className="px-4 py-2.5 rounded-xl border border-slate-300 text-slate-700 font-bold text-sm"
              >
                Cancelar
              </button>
              <button
                type="submit"
                className="px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-extrabold text-sm"
              >
                Guardar Producto
              </button>
            </div>
          </form>
        </div>
      )}

      {/* ========================================== */}
      {/* MODAL AUMENTO MASIVO POR %                 */}
      {/* ========================================== */}
      {showBulkRaise && (
        <div className="fixed inset-0 bg-slate-950/75 z-50 flex items-center justify-center p-4">
          <form
            onSubmit={handleBulkRaiseSubmit}
            className="bg-white rounded-3xl max-w-sm w-full p-6 space-y-4 shadow-2xl"
          >
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-black text-slate-900">Aumento Masivo por %</h3>
              <button
                type="button"
                onClick={() => setShowBulkRaise(false)}
                className="p-1.5 rounded-lg bg-slate-100"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div>
              <label className="block text-xs font-extrabold text-slate-700 mb-1">
                Categoría a actualizar
              </label>
              <select
                value={bulkCat}
                onChange={(e) => setBulkCat(e.target.value)}
                className="w-full px-3 py-2.5 border border-slate-300 rounded-xl text-sm font-bold bg-white"
              >
                <option value="TODAS">TODAS LAS CATEGORÍAS</option>
                {CATEGORIAS.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-extrabold text-slate-700 mb-1">
                Porcentaje de aumento (%)
              </label>
              <input
                type="number"
                required
                step="any"
                value={bulkPercent}
                onChange={(e) => setBulkPercent(e.target.value)}
                className="w-full px-3 py-2.5 border border-slate-300 rounded-xl text-xl font-black"
              />
              <p className="text-[11px] text-slate-500 mt-1">
                Los nuevos precios se redondearán automáticamente según tu regla de ${roundStep} (corte ${roundCutoff}).
              </p>
            </div>

            <button
              type="submit"
              className="w-full py-3 bg-amber-500 hover:bg-amber-600 text-slate-950 font-black text-sm rounded-xl"
            >
              Aplicar Aumento
            </button>
          </form>
        </div>
      )}

      {/* ========================================== */}
      {/* MODAL IMPORTADOR DE BOLETAS CON IA         */}
      {/* ========================================== */}
      {showInvoiceImporter && (
        <InvoiceImporterModal
          cleanStoreCode={cleanStoreCode}
          products={products}
          roundStep={roundStep}
          roundCutoff={roundCutoff}
          onClose={() => setShowInvoiceImporter(false)}
          showToast={showToast}
        />
      )}

      {/* ========================================== */}
      {/* MODAL ETIQUETA DE CÓDIGO DE BARRAS         */}
      {/* ========================================== */}
      {printLabelProduct && (
        <div className="fixed inset-0 bg-slate-950/75 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl max-w-xs w-full p-6 text-center space-y-4 shadow-2xl">
            <div className="flex items-center justify-between">
              <span className="text-xs font-extrabold text-slate-500 uppercase">
                Etiqueta para Góndola / Envase
              </span>
              <button
                onClick={() => setPrintLabelProduct(null)}
                className="p-1 rounded-lg bg-slate-100"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="border-2 border-dashed border-slate-300 p-4 rounded-2xl bg-white space-y-2">
              <p className="font-extrabold text-slate-900 text-sm">{printLabelProduct.name}</p>
              <BarcodeSVG value={printLabelProduct.code} height={54} />
              <p className="text-2xl font-black text-slate-900">
                {formatARS(printLabelProduct.price)}
                {printLabelProduct.saleType === 'kg' ? '/kg' : ''}
              </p>
            </div>

            <button
              onClick={() => window.print()}
              className="w-full py-3 bg-slate-900 hover:bg-slate-800 text-white font-extrabold text-sm rounded-xl flex items-center justify-center gap-2"
            >
              <Printer className="w-4 h-4 text-emerald-400" /> Imprimir Etiqueta
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// Subcomponente Importador Masivo de Boletas / Listas de Proveedores con IA
function InvoiceImporterModal({
  cleanStoreCode,
  products,
  roundStep,
  roundCutoff,
  onClose,
  showToast
}) {
  const [rawText, setRawText] = useState(
    'Yerba Mate Playadito 1kg | 12 | 3100\nAceite Girasol Cocinero 1.5L | 10 | 2350\nGalletitas Oreo 118g | 24 | 980'
  );
  const [defaultMargin, setDefaultMargin] = useState(35);
  const [defaultCat, setDefaultCat] = useState('Almacén');
  const [isSaving, setIsSaving] = useState(false);
  const [isScanningAI, setIsScanningAI] = useState(false);
  const [invoicePreviewUrl, setInvoicePreviewUrl] = useState(null);
  const fileInputRef = useRef(null);
  const cameraInputRef = useRef(null);

  // Redimensiona y comprime fotos pesadas del celular antes de enviarlas a Gemini
  const compressImageToBase64 = (file) =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (event) => {
        const img = new Image();
        img.onload = () => {
          const maxDim = 1600;
          let { width, height } = img;
          if (width > maxDim || height > maxDim) {
            if (width > height) {
              height = Math.round((height * maxDim) / width);
              width = maxDim;
            } else {
              width = Math.round((width * maxDim) / height);
              height = maxDim;
            }
          }
          const canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, width, height);
          const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
          resolve(dataUrl.split(',')[1]);
        };
        img.onerror = reject;
        img.src = String(event.target?.result || '');
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });

  // Analizar foto de boleta o remito con Gemini Vision (gemini-3-flash-preview)
  const handleInvoicePhotoUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const previewUrl = URL.createObjectURL(file);
    setInvoicePreviewUrl(previewUrl);
    setIsScanningAI(true);

    try {
      const base64Data = await compressImageToBase64(file);
      const mimeType = 'image/jpeg';
      const prompt =
        'Analizá esta imagen de una factura, remito o lista de precios de proveedor de almacén. Extraé cada producto comprado con su cantidad y costo unitario neto en pesos. Si solo muestra el subtotal por línea, dividilo por la cantidad para obtener el costo unitario.';

      const payload = {
        contents: [
          {
            role: 'user',
            parts: [
              { text: prompt },
              {
                inlineData: {
                  mimeType,
                  data: base64Data
                }
              }
            ]
          }
        ],
        generationConfig: {
          responseMimeType: 'application/json',
          responseSchema: {
            type: 'ARRAY',
            items: {
              type: 'OBJECT',
              properties: {
                productName: { type: 'STRING' },
                quantity: { type: 'NUMBER' },
                unitCost: { type: 'NUMBER' }
              },
              propertyOrdering: ['productName', 'quantity', 'unitCost']
            }
          }
        }
      };

      const apiKey = '';
      const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent?key=${apiKey}`;

      let response = null;
      let delay = 1000;
      for (let attempt = 0; attempt < 4; attempt++) {
        response = await fetch(apiUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        if (response.ok) break;
        if (attempt < 3) {
          await new Promise((r) => setTimeout(r, delay));
          delay *= 2;
        }
      }

      if (!response || !response.ok) {
        throw new Error('No se pudo procesar la imagen con IA');
      }

      const result = await response.json();
      const rawJson = result?.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!rawJson) {
        throw new Error('Respuesta vacía de la IA');
      }

      const items = JSON.parse(rawJson);
      if (!Array.isArray(items) || items.length === 0) {
        showToast('No se detectaron productos legibles en la foto', 'error');
        return;
      }

      const formattedLines = items
        .filter((it) => it.productName)
        .map(
          (it) =>
            `${String(it.productName).trim()} | ${Number(it.quantity) || 1} | ${Math.round(
              Number(it.unitCost) || 0
            )}`
        )
        .join('\n');

      setRawText(formattedLines);
      showToast(`¡IA leyó ${items.length} productos de la boleta! Revisá la tabla abajo.`);
    } catch (err) {
      showToast('No se pudo leer la foto. Probá con mejor luz o cargalo manual.', 'error');
    } finally {
      setIsScanningAI(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
      if (cameraInputRef.current) cameraInputRef.current.value = '';
    }
  };

  // Parsear líneas en tiempo real (formato: Producto | Cantidad | Costo)
  const parsedRows = useMemo(() => {
    return rawText
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line, index) => {
        const parts = line.includes('|')
          ? line.split('|')
          : line.includes('\t')
          ? line.split('\t')
          : line.split(';');

        const name = (parts[0] || '').trim();
        const qty = Number(String(parts[1] || '0').replace(',', '.')) || 0;
        const newCost = Number(String(parts[2] || '0').replace(/[^0-9.,]/g, '').replace(',', '.')) || 0;

        // Buscar coincidencia en catálogo existente
        const matched = products.find(
          (p) =>
            p.name.toLowerCase() === name.toLowerCase() ||
            p.name.toLowerCase().includes(name.toLowerCase()) ||
            (name.length > 4 && name.toLowerCase().includes(p.name.toLowerCase()))
        );

        const marginToUse = matched ? Number(matched.margin) || defaultMargin : Number(defaultMargin);
        const suggestedPrice =
          newCost > 0
            ? roundPriceCustom(newCost * (1 + marginToUse / 100), roundStep, roundCutoff)
            : matched
            ? matched.price
            : 0;

        return {
          key: index,
          name,
          qty,
          newCost,
          matched,
          suggestedPrice,
          selected: Boolean(name && (qty > 0 || newCost > 0))
        };
      });
  }, [rawText, products, defaultMargin, roundStep, roundCutoff]);

  const handleApplyImport = async () => {
    const validRows = parsedRows.filter((r) => r.selected && r.name);
    if (validRows.length === 0) {
      showToast('No hay filas válidas para importar', 'error');
      return;
    }

    setIsSaving(true);
    try {
      const colPath = `products_${cleanStoreCode}`;
      for (const row of validRows) {
        if (row.matched) {
          const updatedStock = Number(((Number(row.matched.stock) || 0) + row.qty).toFixed(3));
          await updateDoc(doc(db, 'artifacts', appId, 'public', 'data', colPath, row.matched.id), {
            cost: row.newCost > 0 ? row.newCost : row.matched.cost,
            price: row.suggestedPrice > 0 ? row.suggestedPrice : row.matched.price,
            stock: updatedStock
          });
        } else {
          await addDoc(collection(db, 'artifacts', appId, 'public', 'data', colPath), {
            name: row.name,
            category: defaultCat,
            saleType: 'unit',
            code: '',
            cost: row.newCost,
            margin: Number(defaultMargin) || 35,
            price: row.suggestedPrice,
            stock: row.qty,
            minStock: 5,
            expiryDate: ''
          });
        }
      }
      showToast(`¡${validRows.length} productos actualizados/agregados desde la boleta!`);
      onClose();
    } catch (e) {
      showToast('Error al importar boleta', 'error');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-slate-950/75 backdrop-blur-xs z-50 flex items-center justify-center p-4 overflow-y-auto">
      <div className="bg-white rounded-3xl max-w-3xl w-full p-6 shadow-2xl space-y-4 my-auto">
        <div className="flex items-center justify-between border-b pb-3">
          <div>
            <h3 className="text-lg font-black text-slate-900 flex items-center gap-2">
              <Sparkles className="w-5 h-5 text-indigo-600" /> Importar Boleta con IA o Texto
            </h3>
            <p className="text-xs text-slate-500">
              Sacale foto a la boleta del proveedor para leerla con IA o pegá el listado manual
            </p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg bg-slate-100">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Botón de Escaneo con IA desde Foto / Cámara */}
        <div className="bg-gradient-to-r from-indigo-600 to-purple-600 text-white p-4 rounded-2xl flex flex-col sm:flex-row items-center justify-between gap-3 shadow-md">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-white/15 rounded-xl shrink-0">
              {isScanningAI ? (
                <Loader2 className="w-6 h-6 animate-spin text-amber-300" />
              ) : (
                <Camera className="w-6 h-6 text-amber-300" />
              )}
            </div>
            <div>
              <p className="text-sm font-black">
                {isScanningAI
                  ? 'Analizando boleta con Inteligencia Artificial...'
                  : 'Escanear Boleta / Remito con Foto (IA)'}
              </p>
              <p className="text-xs text-indigo-100">
                Lee automáticamente cada producto, cantidad y costo unitario desde la foto.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto justify-end">
            {invoicePreviewUrl && (
              <img
                src={invoicePreviewUrl}
                alt="Boleta"
                className="w-10 h-10 rounded-lg object-cover border border-white/40 shrink-0"
              />
            )}
            <input
              ref={cameraInputRef}
              type="file"
              accept="image/*"
              capture="environment"
              onChange={handleInvoicePhotoUpload}
              className="hidden"
            />
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              onChange={handleInvoicePhotoUpload}
              className="hidden"
            />
            <button
              type="button"
              disabled={isScanningAI}
              onClick={() => cameraInputRef.current?.click()}
              className="px-3.5 py-2.5 bg-amber-400 hover:bg-amber-300 disabled:opacity-60 text-slate-950 font-black text-xs rounded-xl flex items-center justify-center gap-1.5 shadow-xs shrink-0"
            >
              <Camera className="w-4 h-4" />
              <span>Sacar Foto</span>
            </button>
            <button
              type="button"
              disabled={isScanningAI}
              onClick={() => fileInputRef.current?.click()}
              className="px-3.5 py-2.5 bg-white hover:bg-indigo-50 disabled:opacity-60 text-indigo-900 font-black text-xs rounded-xl flex items-center justify-center gap-1.5 shadow-xs shrink-0"
            >
              <ImagePlus className="w-4 h-4" />
              <span>{isScanningAI ? 'Leyendo...' : 'Subir Imagen'}</span>
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="sm:col-span-2">
            <label className="block text-xs font-extrabold text-slate-700 mb-1">
              Texto de la Boleta (1 producto por renglón)
            </label>
            <textarea
              rows={4}
              value={rawText}
              onChange={(e) => setRawText(e.target.value)}
              placeholder="Ej: Yerba Playadito 1kg | 12 | 3100"
              className="w-full p-3 border border-slate-300 rounded-xl font-mono text-xs bg-slate-50"
            />
          </div>
          <div className="space-y-2.5 bg-slate-50 p-3 rounded-xl border border-slate-200">
            <div>
              <label className="block text-[11px] font-bold text-slate-700 mb-1">
                Ganancia productos nuevos (%)
              </label>
              <input
                type="number"
                value={defaultMargin}
                onChange={(e) => setDefaultMargin(e.target.value)}
                className="w-full px-2.5 py-1.5 bg-white border border-slate-300 rounded-lg text-sm font-bold"
              />
            </div>
            <div>
              <label className="block text-[11px] font-bold text-slate-700 mb-1">
                Categoría productos nuevos
              </label>
              <select
                value={defaultCat}
                onChange={(e) => setDefaultCat(e.target.value)}
                className="w-full px-2.5 py-1.5 bg-white border border-slate-300 rounded-lg text-xs font-bold"
              >
                {CATEGORIAS.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>

        {/* Vista previa inteligente */}
        <div className="border border-slate-200 rounded-2xl overflow-hidden max-h-64 overflow-y-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-900 text-white">
              <tr>
                <th className="py-2 px-3">Estado</th>
                <th className="py-2 px-3">Producto</th>
                <th className="py-2 px-3 text-center">+Stock</th>
                <th className="py-2 px-3 text-right">Costo</th>
                <th className="py-2 px-3 text-right">Nuevo Precio Venta</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {parsedRows.map((row) => (
                <tr key={row.key} className="bg-white">
                  <td className="py-2 px-3">
                    {row.matched ? (
                      <span className="px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 font-extrabold text-[10px]">
                        EXISTE
                      </span>
                    ) : (
                      <span className="px-2 py-0.5 rounded-full bg-indigo-100 text-indigo-800 font-extrabold text-[10px]">
                        NUEVO
                      </span>
                    )}
                  </td>
                  <td className="py-2 px-3 font-bold text-slate-800">
                    {row.matched ? row.matched.name : row.name}
                  </td>
                  <td className="py-2 px-3 text-center font-extrabold text-emerald-700">
                    +{row.qty}
                  </td>
                  <td className="py-2 px-3 text-right">
                    {row.matched && row.matched.cost !== row.newCost && (
                      <span className="line-through text-slate-400 mr-1">
                        {formatARS(row.matched.cost)}
                      </span>
                    )}
                    <span className="font-bold">{formatARS(row.newCost)}</span>
                  </td>
                  <td className="py-2 px-3 text-right font-black text-slate-900">
                    {formatARS(row.suggestedPrice)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2.5 rounded-xl border text-sm font-bold"
          >
            Cancelar
          </button>
          <button
            type="button"
            disabled={isSaving}
            onClick={handleApplyImport}
            className="px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-extrabold text-sm"
          >
            {isSaving ? 'Cargando...' : 'Confirmar Ingreso de Stock y Precios'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ==========================================
// 7. MÓDULO 3: CAJA DIARIA, GASTOS Y FALTANTES
// ==========================================
function CashModule({
  user,
  cleanStoreCode,
  sales,
  expenses,
  fiadoMovements,
  products,
  dailyOpenings,
  storeSettings,
  isAdmin,
  requireAdmin,
  showToast,
  setConfirmDialog
}) {
  const [selectedDate, setSelectedDate] = useState(getLocalDateStr());
  const [subTab, setSubTab] = useState('caja'); // 'caja' | 'faltantes'

  // Apertura de caja (cambio inicial)
  const [openingInput, setOpeningInput] = useState('');

  // Modal Nuevo Gasto / Salida
  const [showExpenseModal, setShowExpenseModal] = useState(false);
  const [expCategory, setExpCategory] = useState('Pago a Proveedor');
  const [expDesc, setExpDesc] = useState('');
  const [expAmount, setExpAmount] = useState('');

  const openingRecord = dailyOpenings[selectedDate];
  const initialCash = Number(openingRecord?.initialCash) || 0;

  // Filtrar movimientos de la fecha elegida
  const daySales = useMemo(
    () => sales.filter((s) => s.dateStr === selectedDate && s.status !== 'voided'),
    [sales, selectedDate]
  );

  const dayExpenses = useMemo(
    () => expenses.filter((e) => e.dateStr === selectedDate),
    [expenses, selectedDate]
  );

  // Cobros de fiados del día (entregas de plata que hicieron clientes)
  const dayFiadoPayments = useMemo(
    () => fiadoMovements.filter((m) => m.dateStr === selectedDate && m.type === 'PAYMENT'),
    [fiadoMovements, selectedDate]
  );

  // Arqueo desglosado por medio de pago
  const summary = useMemo(() => {
    let cashSales = 0;
    let transferSales = 0;
    let mpSales = 0;
    let cardSales = 0;
    let fiadoGiven = 0;
    let totalSold = 0;
    let estimatedProfit = 0;

    for (const s of daySales) {
      totalSold += Number(s.total) || 0;
      estimatedProfit += Number(s.estimatedProfit) || 0;
      for (const p of s.payments || []) {
        const amt = Number(p.amount) || 0;
        if (p.method === 'Efectivo') cashSales += amt;
        else if (p.method === 'Transferencia') transferSales += amt;
        else if (p.method === 'Mercado Pago / QR') mpSales += amt;
        else if (p.method === 'Tarjeta') cardSales += amt;
        else if (p.method === 'Fiado') fiadoGiven += amt;
      }
    }

    let fiadoCollectedCash = 0;
    let fiadoCollectedDigital = 0;
    for (const fp of dayFiadoPayments) {
      const amt = Number(fp.amount) || 0;
      if (fp.method === 'Efectivo') fiadoCollectedCash += amt;
      else fiadoCollectedDigital += amt;
    }

    const totalExpenses = dayExpenses.reduce((acc, e) => acc + (Number(e.amount) || 0), 0);
    const theoreticalCashInDrawer = initialCash + cashSales + fiadoCollectedCash - totalExpenses;
    const totalDigital = transferSales + mpSales + cardSales + fiadoCollectedDigital;

    return {
      totalSold,
      estimatedProfit,
      cashSales,
      transferSales,
      mpSales,
      cardSales,
      fiadoGiven,
      fiadoCollectedCash,
      fiadoCollectedDigital,
      totalExpenses,
      theoreticalCashInDrawer,
      totalDigital
    };
  }, [daySales, dayExpenses, dayFiadoPayments, initialCash]);

  // Guardar apertura de caja
  const handleSaveOpening = async (e) => {
    e.preventDefault();
    const val = Number(openingInput) || 0;
    try {
      await setDoc(
        doc(db, 'artifacts', appId, 'public', 'data', `meta_${cleanStoreCode}`, `opening_${selectedDate}`),
        {
          initialCash: val,
          updatedAt: new Date().toISOString()
        }
      );
      setOpeningInput('');
      showToast(`Cambio inicial guardado: ${formatARS(val)}`);
    } catch (err) {
      showToast('Error al guardar cambio inicial', 'error');
    }
  };

  // Registrar salida / gasto
  const handleAddExpense = async (e) => {
    e.preventDefault();
    const amt = Number(expAmount) || 0;
    if (amt <= 0) return;
    try {
      await addDoc(
        collection(db, 'artifacts', appId, 'public', 'data', `expenses_${cleanStoreCode}`),
        {
          category: expCategory,
          description: expDesc.trim() || expCategory,
          amount: amt,
          createdAt: new Date().toISOString(),
          dateStr: selectedDate
        }
      );
      setExpDesc('');
      setExpAmount('');
      setShowExpenseModal(false);
      showToast(`Salida registrada: ${formatARS(amt)}`);
    } catch (err) {
      showToast('Error al registrar salida', 'error');
    }
  };

  // Productos faltantes y próximos a vencer
  const lowStockProducts = useMemo(
    () => products.filter((p) => Number(p.stock) <= Number(p.minStock)),
    [products]
  );

  const expiringProducts = useMemo(
    () =>
      products.filter((p) => {
        const d = daysUntilDate(p.expiryDate);
        return d !== null && d <= 15;
      }),
    [products]
  );

  // Armar texto limpio de faltantes agrupado por categoría para WhatsApp o Copiar
  const buildShortagesText = () => {
    const grouped = {};
    for (const p of lowStockProducts) {
      const cat = p.category || 'Varios';
      if (!grouped[cat]) grouped[cat] = [];
      const unitLabel = p.saleType === 'kg' ? 'kg' : 'u.';
      const suggestedOrder = Math.max(1, Math.ceil(Number(p.minStock) * 2 - Number(p.stock)));
      grouped[cat].push(
        `• ${p.name} (Quedan: ${p.stock} ${unitLabel} | Pedir aprox: ${suggestedOrder} ${unitLabel})`
      );
    }

    const lines = [
      `*LISTA DE FALTANTES / PEDIDO - ${storeSettings.storeName || 'MI ALMACÉN'}*`,
      `Fecha: ${formatDateShort(getLocalDateStr())}`,
      `-------------------------`
    ];

    Object.entries(grouped).forEach(([cat, items]) => {
      lines.push(`\n*${cat.toUpperCase()}*`);
      lines.push(...items);
    });

    return lines.join('\n');
  };

  // Descargar faltantes en formato CSV (compatible con Excel y Google Sheets)
  const handleExportShortagesCSV = () => {
    if (lowStockProducts.length === 0) return;
    const headers = ['Categoria', 'Producto', 'Stock Actual', 'Stock Minimo', 'Unidad', 'Pedido Sugerido', 'Ultimo Costo'];
    const rows = lowStockProducts.map((p) => {
      const unitLabel = p.saleType === 'kg' ? 'kg' : 'unidades';
      const suggestedOrder = Math.max(1, Math.ceil(Number(p.minStock) * 2 - Number(p.stock)));
      return [
        `"${(p.category || 'Varios').replace(/"/g, '""')}"`,
        `"${(p.name || '').replace(/"/g, '""')}"`,
        Number(p.stock) || 0,
        Number(p.minStock) || 0,
        unitLabel,
        suggestedOrder,
        Number(p.cost) || 0
      ].join(';');
    });

    const csvContent = '\uFEFF' + [headers.join(';'), ...rows].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `Faltantes_${getLocalDateStr()}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    showToast('Planilla CSV de faltantes descargada');
  };

  const handleCopyShortages = () => {
    if (lowStockProducts.length === 0) return;
    navigator.clipboard?.writeText(buildShortagesText());
    showToast('Lista de faltantes copiada para pegar en WhatsApp');
  };

  return (
    <div className="space-y-4">
      {/* Cabecera Caja y Selector de Fecha */}
      <div className="bg-white p-4 rounded-2xl shadow-xs border border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-black text-slate-900">Caja Diaria, Gastos y Faltantes</h2>
          <p className="text-xs text-slate-500">
            Control de efectivo en cajón, billeteras virtuales y reposición de mercadería
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1.5 bg-slate-100 px-3 py-2 rounded-xl border border-slate-200">
            <Calendar className="w-4 h-4 text-slate-500" />
            <input
              type="date"
              value={selectedDate}
              onChange={(e) => setSelectedDate(e.target.value)}
              className="bg-transparent text-xs font-extrabold text-slate-800 focus:outline-hidden"
            />
          </div>

          <button
            onClick={() => setShowExpenseModal(true)}
            className="px-3.5 py-2.5 bg-red-600 hover:bg-red-700 text-white font-extrabold text-xs rounded-xl flex items-center gap-1.5 shadow-xs"
          >
            <Minus className="w-4 h-4" />
            <span>Anotar Salida / Gasto</span>
          </button>
        </div>
      </div>

      {/* Sub-pestañas: Arqueo de Caja vs Faltantes y Vencimientos */}
      <div className="grid grid-cols-2 gap-2 p-1.5 bg-white rounded-2xl border border-slate-200 shadow-2xs">
        <button
          onClick={() => setSubTab('caja')}
          className={`py-2.5 px-3 rounded-xl text-xs sm:text-sm font-extrabold flex items-center justify-center gap-2 transition ${
            subTab === 'caja' ? 'bg-slate-900 text-white shadow-xs' : 'text-slate-600 hover:bg-slate-50'
          }`}
        >
          <Wallet className="w-4 h-4 text-emerald-400" />
          <span>Arqueo y Movimientos</span>
        </button>

        <button
          onClick={() => setSubTab('faltantes')}
          className={`py-2.5 px-3 rounded-xl text-xs sm:text-sm font-extrabold flex items-center justify-center gap-2 transition ${
            subTab === 'faltantes'
              ? 'bg-slate-900 text-white shadow-xs'
              : 'text-slate-600 hover:bg-slate-50'
          }`}
        >
          <AlertTriangle className="w-4 h-4 text-amber-400" />
          <span>Faltantes y Vencimientos</span>
          {lowStockProducts.length + expiringProducts.length > 0 && (
            <span className="bg-amber-500 text-slate-950 text-[11px] font-black px-2 py-0.5 rounded-full">
              {lowStockProducts.length + expiringProducts.length}
            </span>
          )}
        </button>
      </div>

      {subTab === 'caja' ? (
        <div className="space-y-4">
          {/* Tarjetas Principales del Arqueo */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <div className="bg-emerald-900 text-white p-4 rounded-2xl shadow-sm">
              <p className="text-[11px] font-bold uppercase tracking-wider text-emerald-300">
                Efectivo Teórico en Cajón
              </p>
              <p className="text-2xl sm:text-3xl font-black mt-1">
                {formatARS(summary.theoreticalCashInDrawer)}
              </p>
              <p className="text-[11px] text-emerald-200 mt-1">
                Cambio + Ventas Efvo + Cobros - Salidas
              </p>
            </div>

            <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-2xs">
              <p className="text-[11px] font-bold uppercase tracking-wider text-blue-600">
                Total Digital (Transf / MP / Tarj)
              </p>
              <p className="text-2xl sm:text-3xl font-black text-slate-900 mt-1">
                {formatARS(summary.totalDigital)}
              </p>
              <p className="text-[11px] text-slate-500 mt-1">
                Transf: {formatARS(summary.transferSales)} • MP: {formatARS(summary.mpSales)}
              </p>
            </div>

            <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-2xs">
              <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                Total Vendido del Día
              </p>
              <p className="text-2xl sm:text-3xl font-black text-slate-900 mt-1">
                {formatARS(summary.totalSold)}
              </p>
              <p className="text-[11px] text-amber-700 font-bold mt-1">
                Fiado entregado: {formatARS(summary.fiadoGiven)}
              </p>
            </div>

            <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-2xs">
              <p className="text-[11px] font-bold uppercase tracking-wider text-emerald-700">
                Ganancia Estimada
              </p>
              <p className="text-2xl sm:text-3xl font-black text-emerald-700 mt-1">
                {formatARS(summary.estimatedProfit)}
              </p>
              <p className="text-[11px] text-slate-500 mt-1">
                Salidas del día: -{formatARS(summary.totalExpenses)}
              </p>
            </div>
          </div>

          {/* Apertura de Caja (Cambio inicial) */}
          <div className="bg-white p-4 rounded-2xl border border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <p className="text-sm font-extrabold text-slate-900">
                Cambio Inicial en Cajón: <span className="text-emerald-700">{formatARS(initialCash)}</span>
              </p>
              <p className="text-xs text-slate-500">
                Anotá con cuánto efectivo arrancaste la caja este día para que el cierre sea exacto.
              </p>
            </div>
            <form onSubmit={handleSaveOpening} className="flex gap-2">
              <input
                type="number"
                min="0"
                value={openingInput}
                onChange={(e) => setOpeningInput(e.target.value)}
                placeholder={String(initialCash || 'Ej: 15000')}
                className="w-36 px-3 py-2 border border-slate-300 rounded-xl text-sm font-bold"
              />
              <button
                type="submit"
                className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs rounded-xl"
              >
                Guardar Cambio
              </button>
            </form>
          </div>

          {/* Lista de Salidas y Gastos del día */}
          <div className="bg-white p-5 rounded-2xl border border-slate-200 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="font-extrabold text-slate-900">
                Salidas, Pagos a Proveedores y Retiros ({dayExpenses.length})
              </h3>
              <span className="text-sm font-black text-red-600">
                -{formatARS(summary.totalExpenses)}
              </span>
            </div>

            {dayExpenses.length === 0 ? (
              <p className="text-xs text-slate-400 py-6 text-center">
                No hay salidas ni gastos anotados en esta fecha.
              </p>
            ) : (
              <div className="divide-y divide-slate-100">
                {dayExpenses.map((exp) => (
                  <div key={exp.id} className="py-2.5 flex items-center justify-between gap-2">
                    <div>
                      <span className="text-[11px] font-extrabold px-2 py-0.5 rounded bg-red-50 text-red-700 mr-2">
                        {exp.category}
                      </span>
                      <span className="text-sm font-bold text-slate-800">{exp.description}</span>
                      <span className="text-[11px] text-slate-400 ml-2">
                        {formatTime(exp.createdAt)}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="font-black text-red-600 text-sm">
                        -{formatARS(exp.amount)}
                      </span>
                      <button
                        onClick={() =>
                          requireAdmin(() => {
                            deleteDoc(
                              doc(
                                db,
                                'artifacts',
                                appId,
                                'public',
                                'data',
                                `expenses_${cleanStoreCode}`,
                                exp.id
                              )
                            );
                            showToast('Salida eliminada');
                          })
                        }
                        className="p-1.5 text-slate-400 hover:text-red-600"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      ) : (
        /* PESTAÑA DE FALTANTES Y VENCIMIENTOS */
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Lista de Faltantes con Exportación WhatsApp / Copiar / Excel */}
          <div className="bg-white p-5 rounded-2xl border border-slate-200 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <h3 className="font-extrabold text-slate-900 flex items-center gap-2">
                  <AlertTriangle className="w-5 h-5 text-amber-500" /> Lista de Compras (Stock Bajo)
                </h3>
                <span className="text-xs font-extrabold px-2.5 py-1 rounded-full bg-amber-100 text-amber-900">
                  {lowStockProducts.length} ítems
                </span>
              </div>

              {lowStockProducts.length > 0 && (
                <div className="flex flex-wrap items-center gap-1.5">
                  <a
                    href={`https://wa.me/?text=${encodeURIComponent(buildShortagesText())}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    title="Enviar lista de faltantes por WhatsApp"
                    className="px-2.5 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white font-extrabold text-xs rounded-xl flex items-center gap-1"
                  >
                    <MessageCircle className="w-3.5 h-3.5" />
                    <span>WhatsApp</span>
                  </a>
                  <button
                    type="button"
                    onClick={handleCopyShortages}
                    title="Copiar texto de faltantes"
                    className="px-2.5 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-800 font-extrabold text-xs rounded-xl flex items-center gap-1"
                  >
                    <Copy className="w-3.5 h-3.5" />
                    <span>Copiar</span>
                  </button>
                  <button
                    type="button"
                    onClick={handleExportShortagesCSV}
                    title="Descargar archivo Excel / CSV"
                    className="px-2.5 py-1.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-800 border border-indigo-200 font-extrabold text-xs rounded-xl flex items-center gap-1"
                  >
                    <FileSpreadsheet className="w-3.5 h-3.5" />
                    <span>Excel/CSV</span>
                  </button>
                </div>
              )}
            </div>

            {lowStockProducts.length === 0 ? (
              <p className="text-sm text-slate-400 py-8 text-center">
                ¡Todo el stock está por encima del mínimo!
              </p>
            ) : (
              <div className="divide-y divide-slate-100">
                {lowStockProducts.map((p) => (
                  <div key={p.id} className="py-2.5 flex items-center justify-between gap-2">
                    <div>
                      <p className="font-bold text-sm text-slate-900">{p.name}</p>
                      <p className="text-xs text-slate-500">
                        {p.category} • Último costo: {formatARS(p.cost)}
                      </p>
                    </div>
                    <div className="text-right">
                      <span className="px-2.5 py-1 rounded-xl bg-amber-100 text-amber-900 font-black text-xs">
                        Quedan: {p.saleType === 'kg' ? `${p.stock} kg` : `${p.stock} u.`}
                      </span>
                      <p className="text-[10px] text-slate-400 mt-0.5">Mínimo: {p.minStock}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Próximos Vencimientos */}
          <div className="bg-white p-5 rounded-2xl border border-slate-200 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="font-extrabold text-slate-900 flex items-center gap-2">
                <Clock className="w-5 h-5 text-red-500" /> Próximos Vencimientos (15 días)
              </h3>
              <span className="text-xs font-extrabold px-2.5 py-1 rounded-full bg-red-100 text-red-800">
                {expiringProducts.length} alertas
              </span>
            </div>

            {expiringProducts.length === 0 ? (
              <p className="text-sm text-slate-400 py-8 text-center">
                No hay productos próximos a vencer.
              </p>
            ) : (
              <div className="divide-y divide-slate-100">
                {expiringProducts.map((p) => {
                  const days = daysUntilDate(p.expiryDate);
                  return (
                    <div key={p.id} className="py-2.5 flex items-center justify-between gap-2">
                      <div>
                        <p className="font-bold text-sm text-slate-900">{p.name}</p>
                        <p className="text-xs text-slate-500">Stock actual: {p.stock}</p>
                      </div>
                      <span
                        className={`px-2.5 py-1 rounded-xl text-xs font-black ${
                          days <= 0
                            ? 'bg-red-600 text-white'
                            : days <= 7
                            ? 'bg-red-100 text-red-800'
                            : 'bg-amber-100 text-amber-900'
                        }`}
                      >
                        {days <= 0 ? '¡VENCIDO!' : `Vence en ${days}d (${formatDateShort(p.expiryDate)})`}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Modal Anotar Salida / Gasto */}
      {showExpenseModal && (
        <div className="fixed inset-0 bg-slate-950/75 z-50 flex items-center justify-center p-4">
          <form
            onSubmit={handleAddExpense}
            className="bg-white rounded-3xl max-w-sm w-full p-6 space-y-4 shadow-2xl"
          >
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-black text-slate-900">Anotar Salida de Caja</h3>
              <button
                type="button"
                onClick={() => setShowExpenseModal(false)}
                className="p-1.5 rounded-lg bg-slate-100"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">Motivo</label>
              <select
                value={expCategory}
                onChange={(e) => setExpCategory(e.target.value)}
                className="w-full px-3 py-2.5 border border-slate-300 rounded-xl text-sm font-bold bg-white"
              >
                {CATEGORIAS_GASTO.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                Detalle (ej: Pago preventista Coca-Cola, Bolsas)
              </label>
              <input
                type="text"
                required
                value={expDesc}
                onChange={(e) => setExpDesc(e.target.value)}
                placeholder="Descripción de la salida..."
                className="w-full px-3 py-2.5 border border-slate-300 rounded-xl text-sm"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">Importe ($)</label>
              <input
                type="number"
                required
                min="1"
                autoFocus
                value={expAmount}
                onChange={(e) => setExpAmount(e.target.value)}
                placeholder="0"
                className="w-full px-3 py-2.5 border border-slate-300 rounded-xl text-xl font-black text-red-700"
              />
            </div>

            <button
              type="submit"
              className="w-full py-3 bg-red-600 hover:bg-red-700 text-white font-extrabold text-sm rounded-xl"
            >
              Registrar Salida
            </button>
          </form>
        </div>
      )}
    </div>
  );
}

// ==========================================
// 8. MÓDULO 4: CLIENTES, AGENDA Y LIBRETA DE FIADOS
// ==========================================
function FiadosModule({
  user,
  cleanStoreCode,
  customers,
  fiadoMovements,
  storeSettings,
  isAdmin,
  requireAdmin,
  showToast,
  setConfirmDialog
}) {
  const [searchCust, setSearchCust] = useState('');
  const [selectedCustomerId, setSelectedCustomerId] = useState(null);

  // Modal Nuevo Cliente
  const [showCustModal, setShowCustModal] = useState(false);
  const [custForm, setCustForm] = useState({
    name: '',
    reference: '',
    phone: '',
    creditLimit: ''
  });

  // Modal Registrar Pago / Entrega de Deuda
  const [paymentModalCust, setPaymentModalCust] = useState(null);
  const [payAmount, setPayAmount] = useState('');
  const [payMethod, setPayMethod] = useState('Efectivo');
  const [payNote, setPayNote] = useState('');

  const filteredCustomers = useMemo(() => {
    const t = searchCust.toLowerCase().trim();
    return customers.filter(
      (c) =>
        !t ||
        c.name.toLowerCase().includes(t) ||
        (c.reference && c.reference.toLowerCase().includes(t)) ||
        (c.phone && c.phone.includes(t))
    );
  }, [customers, searchCust]);

  const selectedCustomer = useMemo(
    () => customers.find((c) => c.id === selectedCustomerId) || null,
    [customers, selectedCustomerId]
  );

  const selectedCustomerMovements = useMemo(
    () => fiadoMovements.filter((m) => m.customerId === selectedCustomerId),
    [fiadoMovements, selectedCustomerId]
  );

  const totalStreetDebt = useMemo(
    () => customers.reduce((acc, c) => acc + (Number(c.balance) || 0), 0),
    [customers]
  );

  // Importar contacto desde la agenda del celular (Contact Picker API en Android/Chrome)
  const handleImportFromPhoneContacts = async () => {
    try {
      if ('contacts' in navigator && 'select' in navigator.contacts) {
        const picked = await navigator.contacts.select(['name', 'tel'], { multiple: false });
        if (picked && picked.length > 0) {
          const contact = picked[0];
          const pickedName = (contact.name && contact.name[0]) || '';
          const pickedTel = (contact.tel && contact.tel[0]) || '';
          setCustForm({
            name: pickedName,
            reference: 'Importado de contactos',
            phone: pickedTel.replace(/\D/g, ''),
            creditLimit: ''
          });
          setShowCustModal(true);
        }
      } else {
        showToast(
          'Tu navegador no permite abrir la agenda directa. Pegá el nombre y teléfono abajo.',
          'error'
        );
        setShowCustModal(true);
      }
    } catch (err) {
      setShowCustModal(true);
    }
  };

  // Guardar cliente nuevo
  const handleCreateCustomer = async (e) => {
    e.preventDefault();
    if (!custForm.name.trim()) return;
    try {
      const ref = await addDoc(
        collection(db, 'artifacts', appId, 'public', 'data', `customers_${cleanStoreCode}`),
        {
          name: custForm.name.trim(),
          reference: custForm.reference.trim(),
          phone: custForm.phone.replace(/\D/g, ''),
          creditLimit: Number(custForm.creditLimit) || 0,
          balance: 0,
          lastActivity: new Date().toISOString()
        }
      );
      setSelectedCustomerId(ref.id);
      setCustForm({ name: '', reference: '', phone: '', creditLimit: '' });
      setShowCustModal(false);
      showToast('Cliente agendado correctamente');
    } catch (err) {
      showToast('Error al agendar cliente', 'error');
    }
  };

  // Registrar entrega / pago parcial o total
  const handleRegisterPayment = async (e) => {
    e.preventDefault();
    if (!paymentModalCust) return;
    const amt = Number(payAmount) || 0;
    if (amt <= 0) return;

    try {
      const nowIso = new Date().toISOString();
      const newBalance = Math.max(0, (Number(paymentModalCust.balance) || 0) - amt);

      await updateDoc(
        doc(
          db,
          'artifacts',
          appId,
          'public',
          'data',
          `customers_${cleanStoreCode}`,
          paymentModalCust.id
        ),
        {
          balance: newBalance,
          lastActivity: nowIso
        }
      );

      await addDoc(
        collection(db, 'artifacts', appId, 'public', 'data', `fiados_${cleanStoreCode}`),
        {
          customerId: paymentModalCust.id,
          customerName: paymentModalCust.name,
          type: 'PAYMENT',
          method: payMethod,
          amount: amt,
          note: payNote.trim() || `Entrega (${payMethod})`,
          createdAt: nowIso,
          dateStr: getLocalDateStr()
        }
      );

      setPaymentModalCust(null);
      setPayAmount('');
      setPayNote('');
      showToast(`Entrega de ${formatARS(amt)} registrada`);
    } catch (err) {
      showToast('Error al registrar entrega', 'error');
    }
  };

  // Armar mensaje de resumen de cuenta fiada para WhatsApp
  const buildWhatsAppDebtUrl = (cust) => {
    const cleanPhone = String(cust.phone || '').replace(/\D/g, '');
    const recent = fiadoMovements
      .filter((m) => m.customerId === cust.id)
      .slice(0, 6)
      .map(
        (m) =>
          `• ${formatDateShort(m.createdAt)}: ${m.type === 'PAYMENT' ? 'Entrega -' : '+'}${formatARS(
            m.amount
          )}`
      );

    const text = encodeURIComponent(
      [
        `Hola *${cust.name}*, te paso el resumen de tu cuenta en *${
          storeSettings.storeName || 'Mi Almacén'
        }*:`,
        ``,
        ...recent,
        ``,
        `*SALDO ACTUAL: ${formatARS(cust.balance)}*`,
        `¡Muchas gracias!`
      ].join('\n')
    );
    return cleanPhone ? `https://wa.me/${cleanPhone}?text=${text}` : `https://wa.me/?text=${text}`;
  };

  return (
    <div className="space-y-4">
      {/* Cabecera Libreta de Fiados */}
      <div className="bg-white p-4 rounded-2xl shadow-xs border border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-black text-slate-900">Agenda de Clientes y Fiados</h2>
          <p className="text-xs text-slate-500">
            Total fiado en la calle:{' '}
            <strong className="text-amber-700 text-sm">{formatARS(totalStreetDebt)}</strong>
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            onClick={handleImportFromPhoneContacts}
            className="px-3.5 py-2.5 bg-emerald-100 hover:bg-emerald-200 border border-emerald-300 text-emerald-950 font-extrabold text-xs rounded-xl flex items-center gap-1.5"
          >
            <Users className="w-4 h-4 text-emerald-700" />
            <span>Importar Contactos Celular</span>
          </button>

          <button
            onClick={() => {
              setCustForm({ name: '', reference: '', phone: '', creditLimit: '' });
              setShowCustModal(true);
            }}
            className="px-4 py-2.5 bg-slate-900 hover:bg-slate-800 text-white font-extrabold text-xs rounded-xl flex items-center gap-1.5"
          >
            <UserPlus className="w-4 h-4 text-emerald-400" />
            <span>Agendar Cliente</span>
          </button>
        </div>
      </div>

      {/* Buscador de clientes */}
      <div className="relative">
        <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
        <input
          type="text"
          value={searchCust}
          onChange={(e) => setSearchCust(e.target.value)}
          placeholder="Buscar cliente por nombre, apodo o teléfono..."
          className="w-full pl-10 pr-4 py-3 bg-white border border-slate-300 rounded-2xl text-sm shadow-2xs"
        />
      </div>

      {/* Grilla: Lista de Clientes + Detalle de Cuenta */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-start">
        <div className="lg:col-span-6 space-y-2.5">
          {filteredCustomers.length === 0 ? (
            <div className="bg-white p-10 rounded-2xl border border-slate-200 text-center text-slate-400">
              <BookOpen className="w-10 h-10 mx-auto mb-2 opacity-40" />
              <p className="text-sm font-bold">No hay clientes agendados con esa búsqueda</p>
            </div>
          ) : (
            filteredCustomers.map((cust) => {
              const isSelected = cust.id === selectedCustomerId;
              const hasDebt = Number(cust.balance) > 0;
              return (
                <div
                  key={cust.id}
                  onClick={() => setSelectedCustomerId(cust.id)}
                  className={`p-4 rounded-2xl border transition cursor-pointer flex items-center justify-between gap-3 ${
                    isSelected
                      ? 'bg-slate-900 text-white border-slate-900 shadow-md'
                      : 'bg-white hover:border-slate-400 border-slate-200'
                  }`}
                >
                  <div className="min-w-0 flex-1">
                    <h3 className="font-extrabold text-base truncate">{cust.name}</h3>
                    <p
                      className={`text-xs truncate ${
                        isSelected ? 'text-slate-300' : 'text-slate-500'
                      }`}
                    >
                      {cust.reference || 'Sin referencia'} {cust.phone ? `• ${cust.phone}` : ''}
                    </p>
                  </div>

                  <div className="text-right shrink-0">
                    <span
                      className={`text-lg font-black ${
                        hasDebt
                          ? isSelected
                            ? 'text-amber-400'
                            : 'text-amber-700'
                          : isSelected
                          ? 'text-emerald-400'
                          : 'text-emerald-700'
                      }`}
                    >
                      {formatARS(cust.balance)}
                    </span>
                    <p
                      className={`text-[10px] font-bold ${
                        isSelected ? 'text-slate-400' : 'text-slate-400'
                      }`}
                    >
                      {hasDebt ? 'Saldo pendiente' : 'Al día'}
                    </p>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Panel derecho: Detalle del cliente seleccionado */}
        <div className="lg:col-span-6 bg-white p-5 rounded-2xl border border-slate-200 shadow-xs">
          {!selectedCustomer ? (
            <div className="py-16 text-center text-slate-400">
              <BookOpen className="w-12 h-12 mx-auto mb-2 opacity-30" />
              <p className="text-sm font-bold">
                Seleccioná un cliente de la lista para ver su cuenta, cobrar entregas o mandar WhatsApp
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex items-start justify-between gap-3 border-b border-slate-100 pb-4">
                <div>
                  <h3 className="text-xl font-black text-slate-900">{selectedCustomer.name}</h3>
                  <p className="text-xs text-slate-500">{selectedCustomer.reference}</p>
                  <p className="text-2xl font-black text-amber-700 mt-2">
                    Debe: {formatARS(selectedCustomer.balance)}
                  </p>
                </div>

                <div className="flex flex-col gap-2">
                  <button
                    onClick={() => {
                      setPaymentModalCust(selectedCustomer);
                      setPayAmount(String(selectedCustomer.balance || ''));
                      setPayMethod('Efectivo');
                    }}
                    className="px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-extrabold text-xs rounded-xl flex items-center justify-center gap-1.5 shadow-sm"
                  >
                    <Banknote className="w-4 h-4" /> Registrar Entrega / Pago
                  </button>

                  <a
                    href={buildWhatsAppDebtUrl(selectedCustomer)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="px-4 py-2 bg-emerald-50 hover:bg-emerald-100 border border-emerald-300 text-emerald-900 font-extrabold text-xs rounded-xl flex items-center justify-center gap-1.5"
                  >
                    <MessageCircle className="w-4 h-4 text-emerald-600" /> Enviar Resumen WhatsApp
                  </a>
                </div>
              </div>

              <div>
                <h4 className="text-xs font-extrabold uppercase tracking-wider text-slate-500 mb-2">
                  Historial de Movimientos
                </h4>
                <div className="max-h-80 overflow-y-auto divide-y divide-slate-100">
                  {selectedCustomerMovements.length === 0 ? (
                    <p className="text-xs text-slate-400 py-6 text-center">
                      Sin movimientos registrados aún.
                    </p>
                  ) : (
                    selectedCustomerMovements.map((m) => (
                      <div key={m.id} className="py-2.5 flex items-center justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <span className="text-[11px] font-mono text-slate-400">
                            {formatDateShort(m.createdAt)} {formatTime(m.createdAt)}
                          </span>
                          <p className="text-xs font-bold text-slate-800">{m.note}</p>
                        </div>
                        <span
                          className={`font-black text-sm shrink-0 ${
                            m.type === 'PAYMENT' ? 'text-emerald-600' : 'text-amber-700'
                          }`}
                        >
                          {m.type === 'PAYMENT' ? `-${formatARS(m.amount)}` : `+${formatARS(m.amount)}`}
                        </span>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Modal Agendar Nuevo Cliente */}
      {showCustModal && (
        <div className="fixed inset-0 bg-slate-950/75 z-50 flex items-center justify-center p-4">
          <form
            onSubmit={handleCreateCustomer}
            className="bg-white rounded-3xl max-w-sm w-full p-6 space-y-4 shadow-2xl"
          >
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-black text-slate-900">Agendar Cliente</h3>
              <button
                type="button"
                onClick={() => setShowCustModal(false)}
                className="p-1.5 rounded-lg bg-slate-100"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                Nombre y Apellido / Apodo *
              </label>
              <input
                type="text"
                required
                autoFocus
                value={custForm.name}
                onChange={(e) => setCustForm({ ...custForm, name: e.target.value })}
                placeholder="Ej: Juan Pérez (El de la esquina)"
                className="w-full px-3 py-2.5 border border-slate-300 rounded-xl text-sm font-bold"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                Teléfono / WhatsApp (con código de área)
              </label>
              <input
                type="tel"
                value={custForm.phone}
                onChange={(e) => setCustForm({ ...custForm, phone: e.target.value })}
                placeholder="Ej: 5491144556677"
                className="w-full px-3 py-2.5 border border-slate-300 rounded-xl text-sm"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                Referencia / Dirección (Opcional)
              </label>
              <input
                type="text"
                value={custForm.reference}
                onChange={(e) => setCustForm({ ...custForm, reference: e.target.value })}
                placeholder="Ej: Casa portón negro"
                className="w-full px-3 py-2.5 border border-slate-300 rounded-xl text-sm"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                Tope máximo de fiado (Opcional, $0 = sin tope)
              </label>
              <input
                type="number"
                min="0"
                value={custForm.creditLimit}
                onChange={(e) => setCustForm({ ...custForm, creditLimit: e.target.value })}
                placeholder="0"
                className="w-full px-3 py-2.5 border border-slate-300 rounded-xl text-sm font-bold"
              />
            </div>

            <button
              type="submit"
              className="w-full py-3 bg-emerald-600 hover:bg-emerald-700 text-white font-extrabold text-sm rounded-xl"
            >
              Guardar en Agenda
            </button>
          </form>
        </div>
      )}

      {/* Modal Registrar Entrega / Pago de Deuda */}
      {paymentModalCust && (
        <div className="fixed inset-0 bg-slate-950/75 z-50 flex items-center justify-center p-4">
          <form
            onSubmit={handleRegisterPayment}
            className="bg-white rounded-3xl max-w-sm w-full p-6 space-y-4 shadow-2xl"
          >
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-lg font-black text-slate-900">Registrar Pago / Entrega</h3>
                <p className="text-xs text-slate-500">
                  {paymentModalCust.name} (Debe: {formatARS(paymentModalCust.balance)})
                </p>
              </div>
              <button
                type="button"
                onClick={() => setPaymentModalCust(null)}
                className="p-1.5 rounded-lg bg-slate-100"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                Monto que entrega ($)
              </label>
              <input
                type="number"
                required
                min="1"
                autoFocus
                value={payAmount}
                onChange={(e) => setPayAmount(e.target.value)}
                className="w-full px-3 py-2.5 border border-slate-300 rounded-xl text-2xl font-black text-emerald-700"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                ¿Cómo te pagó? (Suma directo a la Caja de hoy)
              </label>
              <select
                value={payMethod}
                onChange={(e) => setPayMethod(e.target.value)}
                className="w-full px-3 py-2.5 border border-slate-300 rounded-xl text-sm font-bold bg-white"
              >
                <option value="Efectivo">Efectivo</option>
                <option value="Transferencia">Transferencia</option>
                <option value="Mercado Pago / QR">Mercado Pago / QR</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">Nota (Opcional)</label>
              <input
                type="text"
                value={payNote}
                onChange={(e) => setPayNote(e.target.value)}
                placeholder="Ej: Entrega parcial semanal"
                className="w-full px-3 py-2.5 border border-slate-300 rounded-xl text-sm"
              />
            </div>

            <button
              type="submit"
              className="w-full py-3 bg-emerald-600 hover:bg-emerald-700 text-white font-extrabold text-sm rounded-xl"
            >
              Confirmar Pago
            </button>
          </form>
        </div>
      )}
    </div>
  );
}

 
