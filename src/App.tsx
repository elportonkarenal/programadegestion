
import React, { useState, useEffect, useMemo, useRef } from 'react';
import { initializeApp } from 'firebase/app';
import {
  getAuth,
  signInAnonymously,
  signInWithCustomToken,
  onAuthStateChanged,
} from 'firebase/auth';
import {
  getFirestore,
  collection,
  doc,
  setDoc,
  addDoc,
  updateDoc,
  deleteDoc,
  onSnapshot,
  serverTimestamp,
  writeBatch,
} from 'firebase/firestore';
import {
  ShoppingCart,
  Package,
  Wallet,
  Users,
  Search,
  Plus,
  Minus,
  Trash2,
  Scale,
  CheckCircle2,
  X,
  AlertTriangle,
  Lock,
  Unlock,
  Smartphone,
  QrCode,
  Printer,
  Upload,
  ArrowUpDown,
  MessageCircle,
  Camera,
  RotateCcw,
  Receipt,
  TrendingUp,
  Calendar,
  DollarSign,
  Percent,
  Check,
  Store,
  Sparkles,
  FileSpreadsheet,
  Contact,
  ShieldCheck,
  Edit3,
  Barcode,
  Cloud,
  Copy,
  Download,
  Layers,
} from 'lucide-react';

// ============================================================================
// CONFIGURACIÓN DE FIREBASE Y ENTORNO (CON MODO OFFLINE / LOCAL AUTOMÁTICO)
// ============================================================================
const rawFirebaseConfig =
  typeof __firebase_config !== 'undefined' ? JSON.parse(__firebase_config) : null;
const hasCloudConfig = Boolean(rawFirebaseConfig && rawFirebaseConfig.apiKey);
const appId = typeof __app_id !== 'undefined' ? __app_id : 'almacen-control-pro';

const app = hasCloudConfig ? initializeApp(rawFirebaseConfig) : null;
const auth = app ? getAuth(app) : null;
const db = app ? getFirestore(app) : null;

// ============================================================================
// UTILIDADES DE NEGOCIO (REDONDEO, FORMATO Y CÓDIGOS)
// ============================================================================

/**
 * Regla de redondeo personalizada del mostrador:
 * Redondea a múltiplos de `step` (por defecto $100).
 * Si el resto es <= `threshold` (por defecto $40), redondea hacia abajo.
 * Si el resto es > `threshold` (ej: $41..$99), redondea hacia arriba.
 */
function roundCustomARS(rawAmount, step = 100, threshold = 40) {
  const num = Number(rawAmount);
  if (isNaN(num) || num <= 0) return 0;
  if (step <= 1) return Math.ceil(num);
  const remainder = num % step;
  const base = Math.floor(num / step) * step;
  if (remainder === 0) return base;
  return remainder <= threshold ? base : base + step;
}

function formatARS(amount) {
  const n = Number(amount) || 0;
  return new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: 'ARS',
    maximumFractionDigits: 0,
  }).format(n);
}

function getLocalDateStr(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function formatTime(ts) {
  if (!ts) return '';
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });
}

function formatDateShort(dateStr) {
  if (!dateStr) return '';
  const parts = dateStr.split('-');
  if (parts.length !== 3) return dateStr;
  return `${parts[2]}/${parts[1]}/${parts[0].slice(2)}`;
}

function daysUntilDate(dateStr) {
  if (!dateStr) return null;
  const today = new Date(getLocalDateStr() + 'T00:00:00');
  const target = new Date(dateStr + 'T00:00:00');
  const diff = target - today;
  return Math.ceil(diff / (1000 * 60 * 60 * 24));
}

function generateInternalBarcode() {
  const rand = Math.floor(100000 + Math.random() * 900000);
  return `200${rand}`;
}

function sanitizePhoneForWhatsApp(phone) {
  if (!phone) return '';
  let digits = String(phone).replace(/\D/g, '');
  if (!digits) return '';
  if (digits.startsWith('0')) digits = digits.slice(1);
  if (digits.length === 10) digits = `549${digits}`;
  else if (digits.startsWith('54') && !digits.startsWith('549') && digits.length === 12) {
    digits = `549${digits.slice(2)}`;
  }
  return digits;
}

function buildWhatsAppTicketUrl(sale, phone) {
  const cleanPhone = sanitizePhoneForWhatsApp(phone);
  const lines = [
    `*COMPROBANTE DE COMPRA*`,
    `Fecha: ${formatDateShort(sale.dateStr)} ${formatTime(sale.createdAt)}`,
    `------------------------`,
    ...(sale.items || []).map(
      (i) =>
        `• ${i.saleType === 'kg' ? `${i.qty} kg` : `${i.qty}x`} ${i.name}: ${formatARS(i.subtotal)}`
    ),
    `------------------------`,
    `*TOTAL: ${formatARS(sale.total)}*`,
    `Pago: ${(sale.payments || []).map((p) => `${p.method} (${formatARS(p.amount)})`).join(' + ')}`,
    `¡Gracias por tu compra!`,
  ];
  const text = encodeURIComponent(lines.join('\n'));
  return cleanPhone
    ? `https://wa.me/${cleanPhone}?text=${text}`
    : `https://wa.me/?text=${text}`;
}

function buildWhatsAppFiadoUrl(customer, entries) {
  const cleanPhone = sanitizePhoneForWhatsApp(customer.phone);
  const recent = entries.slice(0, 10);
  const lines = [
    `Hola *${customer.name}*, te paso el resumen de tu cuenta en el almacén:`,
    `------------------------`,
    ...recent.map((e) => {
      const sign = e.type === 'payment' ? '✅ Entrega' : '🛒 Compra';
      return `${formatDateShort(e.dateStr)} - ${sign}: ${formatARS(e.amount)} (${e.description || ''})`;
    }),
    `------------------------`,
    `*SALDO ACTUAL PENDIENTE: ${formatARS(customer.balance)}*`,
  ];
  const text = encodeURIComponent(lines.join('\n'));
  return cleanPhone
    ? `https://wa.me/${cleanPhone}?text=${text}`
    : `https://wa.me/?text=${text}`;
}

const CATEGORIAS = [
  'Almacén',
  'Bebidas',
  'Fiambrería y Quesos',
  'Panadería',
  'Verdulería',
  'Lácteos',
  'Limpieza',
  'Golosinas',
  'Varios',
];

const MEDIOS_PAGO = ['Efectivo', 'Transferencia / MP', 'Débito / Crédito', 'Fiado'];

// ============================================================================
// GENERADOR VISUAL DE CÓDIGO DE BARRAS SVG (CODE-128 / VISUAL DETERMINÍSTICO)
// ============================================================================
function BarcodeSVG({ code = '200000001', height = 44 }) {
  const clean = String(code || '000000');
  const bars = useMemo(() => {
    const result = [];
    // Guardas iniciales
    result.push({ w: 2, dark: true }, { w: 1, dark: false }, { w: 2, dark: true }, { w: 2, dark: false });
    for (let i = 0; i < clean.length; i++) {
      const charCode = clean.charCodeAt(i);
      const pattern = [
        ((charCode * 3 + i) % 3) + 1,
        ((charCode * 7 + i) % 2) + 1,
        ((charCode * 5 + i) % 3) + 1,
        ((charCode * 2 + i) % 2) + 1,
      ];
      pattern.forEach((w, idx) => {
        result.push({ w, dark: idx % 2 === 0 });
      });
    }
    // Guardas finales
    result.push({ w: 2, dark: true }, { w: 1, dark: false }, { w: 2, dark: true });
    return result;
  }, [clean]);

  const totalWidth = bars.reduce((acc, b) => acc + b.w * 2, 0) + 16;
  let currentX = 8;

  return (
    <svg
      viewBox={`0 0 ${totalWidth} ${height + 18}`}
      className="w-full max-w-[220px] h-auto mx-auto bg-white"
    >
      {bars.map((b, idx) => {
        const x = currentX;
        const width = b.w * 2;
        currentX += width;
        if (!b.dark) return null;
        return <rect key={idx} x={x} y={2} width={width} height={height} fill="#0f172a" />;
      })}
      <text
        x={totalWidth / 2}
        y={height + 14}
        textAnchor="middle"
        fontSize="11"
        fontFamily="monospace"
        fontWeight="bold"
        fill="#0f172a"
      >
        {clean}
      </text>
    </svg>
  );
}

// ============================================================================
// COMPONENTE PRINCIPAL DE LA APLICACIÓN
// ============================================================================
export default function App() {
  const [user, setUser] = useState(null);
  const [storeCode, setStoreCode] = useState(() => {
    const saved = localStorage.getItem('almacen_store_code');
    if (saved) return saved;
    const generated = `ALM-${Math.random().toString(36).substring(2, 8).toUpperCase()}`;
    localStorage.setItem('almacen_store_code', generated);
    return generated;
  });

  // Navegación principal
  const [activeTab, setActiveTab] = useState('pos');

  // Seguridad / Modo Administrador
  const [isAdmin, setIsAdmin] = useState(true);
  const [showPinModal, setShowPinModal] = useState(false);
  const [pinInput, setPinInput] = useState('');
  const [pendingAdminAction, setPendingAdminAction] = useState(null);

  // Modal de vinculación PC/Celular y ajustes
  const [showStoreLinkModal, setShowStoreLinkModal] = useState(false);
  const [storeCodeInput, setStoreCodeInput] = useState(storeCode);

  // Datos sincronizados en tiempo real
  const [products, setProducts] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [sales, setSales] = useState([]);
  const [expenses, setExpenses] = useState([]);
  const [fiados, setFiados] = useState([]);
  const [cashSession, setCashSession] = useState(null);
  const [storeSettings, setStoreSettings] = useState({
    storeName: 'Mi Almacén',
    adminPin: '1234',
    defaultDeposit: 2000,
    roundStep: 100,
    roundThreshold: 40,
  });
  const [loadingData, setLoadingData] = useState(true);

  // Notificaciones Toast y Confirmaciones personalizadas
  const [toast, setToast] = useState(null);
  const [confirmDialog, setConfirmDialog] = useState(null);

  const showToast = (message, type = 'success') => {
    setToast({ message, type, id: Date.now() });
    setTimeout(() => {
      setToast((prev) => (prev && Date.now() - prev.id >= 2900 ? null : prev));
    }, 3000);
  };

  // Inicializar autenticación Firebase (si hay nube) o modo local inmediato
  useEffect(() => {
    if (!hasCloudConfig || !auth) {
      setUser({ uid: 'local-device' });
      return;
    }
    const initAuth = async () => {
      try {
        if (typeof __initial_auth_token !== 'undefined' && __initial_auth_token) {
          await signInWithCustomToken(auth, __initial_auth_token);
        } else {
          await signInAnonymously(auth);
        }
      } catch (err) {
        console.error('Error auth:', err);
        setUser({ uid: 'local-device' });
      }
    };
    initAuth();
    const unsub = onAuthStateChanged(auth, (u) => setUser(u || { uid: 'local-device' }));
    return () => unsub();
  }, []);

  const cleanStoreCode = useMemo(
    () => (storeCode || 'DEFAULT').trim().toUpperCase().replace(/[^A-Z0-9_-]/g, ''),
    [storeCode]
  );

  // Guardado automático en memoria local del dispositivo (funciona en StackBlitz y App móvil)
  useEffect(() => {
    if (hasCloudConfig || loadingData) return;
    localStorage.setItem(`local_products_${cleanStoreCode}`, JSON.stringify(products));
  }, [products, cleanStoreCode, loadingData]);

  useEffect(() => {
    if (hasCloudConfig || loadingData) return;
    localStorage.setItem(`local_customers_${cleanStoreCode}`, JSON.stringify(customers));
  }, [customers, cleanStoreCode, loadingData]);

  useEffect(() => {
    if (hasCloudConfig || loadingData) return;
    localStorage.setItem(`local_sales_${cleanStoreCode}`, JSON.stringify(sales));
  }, [sales, cleanStoreCode, loadingData]);

  useEffect(() => {
    if (hasCloudConfig || loadingData) return;
    localStorage.setItem(`local_expenses_${cleanStoreCode}`, JSON.stringify(expenses));
  }, [expenses, cleanStoreCode, loadingData]);

  useEffect(() => {
    if (hasCloudConfig || loadingData) return;
    localStorage.setItem(`local_fiados_${cleanStoreCode}`, JSON.stringify(fiados));
  }, [fiados, cleanStoreCode, loadingData]);

  useEffect(() => {
    if (hasCloudConfig || loadingData) return;
    localStorage.setItem(`local_settings_${cleanStoreCode}`, JSON.stringify(storeSettings));
  }, [storeSettings, cleanStoreCode, loadingData]);

  // Suscripción en tiempo real a todas las colecciones del almacén (Nube o Local)
  useEffect(() => {
    if (!user || !cleanStoreCode) return;
    setLoadingData(true);

    if (!hasCloudConfig || !db) {
      try {
        setProducts(JSON.parse(localStorage.getItem(`local_products_${cleanStoreCode}`) || '[]'));
        setCustomers(JSON.parse(localStorage.getItem(`local_customers_${cleanStoreCode}`) || '[]'));
        setSales(JSON.parse(localStorage.getItem(`local_sales_${cleanStoreCode}`) || '[]'));
        setExpenses(JSON.parse(localStorage.getItem(`local_expenses_${cleanStoreCode}`) || '[]'));
        setFiados(JSON.parse(localStorage.getItem(`local_fiados_${cleanStoreCode}`) || '[]'));
        const savedSettings = JSON.parse(
          localStorage.getItem(`local_settings_${cleanStoreCode}`) || 'null'
        );
        if (savedSettings) setStoreSettings((prev) => ({ ...prev, ...savedSettings }));
        const savedCash = JSON.parse(
          localStorage.getItem(`local_cash_${cleanStoreCode}_${getLocalDateStr()}`) || 'null'
        );
        if (savedCash) setCashSession(savedCash);
      } catch (e) {
        console.error('Error cargando almacenamiento local:', e);
      }
      setLoadingData(false);
      return;
    }

    const basePublicPath = ['artifacts', appId, 'public', 'data'];
    const todayStr = getLocalDateStr();

    const unsubSettings = onSnapshot(
      doc(db, ...basePublicPath, `settings_${cleanStoreCode}`, 'config'),
      (snap) => {
        if (snap.exists()) {
          setStoreSettings((prev) => ({ ...prev, ...snap.data() }));
        }
      },
      (err) => console.error('Settings sync error:', err)
    );

    const unsubProducts = onSnapshot(
      collection(db, ...basePublicPath, `products_${cleanStoreCode}`),
      (snap) => {
        const list = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        list.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
        setProducts(list);
        setLoadingData(false);
      },
      (err) => {
        console.error('Products sync error:', err);
        setLoadingData(false);
      }
    );

    const unsubCustomers = onSnapshot(
      collection(db, ...basePublicPath, `customers_${cleanStoreCode}`),
      (snap) => {
        const list = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        list.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
        setCustomers(list);
      }
    );

    const unsubSales = onSnapshot(
      collection(db, ...basePublicPath, `sales_${cleanStoreCode}`),
      (snap) => {
        const list = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        list.sort((a, b) => {
          const ta = a.createdAt?.seconds || 0;
          const tb = b.createdAt?.seconds || 0;
          return tb - ta;
        });
        setSales(list);
      }
    );

    const unsubExpenses = onSnapshot(
      collection(db, ...basePublicPath, `expenses_${cleanStoreCode}`),
      (snap) => {
        const list = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        list.sort((a, b) => {
          const ta = a.createdAt?.seconds || 0;
          const tb = b.createdAt?.seconds || 0;
          return tb - ta;
        });
        setExpenses(list);
      }
    );

    const unsubFiados = onSnapshot(
      collection(db, ...basePublicPath, `fiados_${cleanStoreCode}`),
      (snap) => {
        const list = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        list.sort((a, b) => {
          const ta = a.createdAt?.seconds || 0;
          const tb = b.createdAt?.seconds || 0;
          return tb - ta;
        });
        setFiados(list);
      }
    );

    const unsubCash = onSnapshot(
      doc(db, ...basePublicPath, `cash_${cleanStoreCode}`, todayStr),
      (snap) => {
        if (snap.exists()) {
          setCashSession({ id: snap.id, ...snap.data() });
        } else {
          setCashSession(null);
        }
      }
    );

    return () => {
      unsubSettings();
      unsubProducts();
      unsubCustomers();
      unsubSales();
      unsubExpenses();
      unsubFiados();
      unsubCash();
    };
  }, [user, cleanStoreCode]);

  // Cargar datos iniciales de demostración si el almacén está vacío
  const seededRef = useRef(false);
  useEffect(() => {
    if (!user || loadingData || seededRef.current) return;
    const alreadySeeded = localStorage.getItem(`seeded_${cleanStoreCode}`);
    if (products.length === 0 && !alreadySeeded) {
      seededRef.current = true;
      localStorage.setItem(`seeded_${cleanStoreCode}`, '1');
      const seedDemoData = async () => {
        try {
          const batch = writeBatch(db);
          const colRef = collection(
            db,
            'artifacts',
            appId,
            'public',
            'data',
            `products_${cleanStoreCode}`
          );
          const demoProducts = [
            {
              name: 'Yerba Mate Playadito 1kg',
              category: 'Almacén',
              saleType: 'unit',
              cost: 3100,
              margin: 30,
              price: roundCustomARS(3100 * 1.3, 100, 40),
              stock: 18,
              minStock: 6,
              code: '7790070411220',
              isSample: true,
            },
            {
              name: 'Aceite Girasol Cocinero 900ml',
              category: 'Almacén',
              saleType: 'unit',
              cost: 1650,
              margin: 30,
              price: roundCustomARS(1650 * 1.3, 100, 40),
              stock: 12,
              minStock: 5,
              code: '7790060023451',
              isSample: true,
            },
            {
              name: 'Coca-Cola Retornable 2L (Líquido)',
              category: 'Bebidas',
              saleType: 'unit',
              cost: 1700,
              margin: 30,
              price: roundCustomARS(1700 * 1.3, 100, 40),
              promoQty: 6,
              promoPrice: 2000,
              stock: 24,
              minStock: 8,
              code: '7790895001234',
              isSample: true,
            },
            {
              name: 'Queso Cremoso Punta del Agua (x Kg)',
              category: 'Fiambrería y Quesos',
              saleType: 'kg',
              cost: 6800,
              margin: 35,
              price: roundCustomARS(6800 * 1.35, 100, 40),
              stock: 8.5,
              minStock: 2,
              code: '200100001',
              isSample: true,
            },
            {
              name: 'Paleta Cocida Especial (x Kg)',
              category: 'Fiambrería y Quesos',
              saleType: 'kg',
              cost: 5900,
              margin: 40,
              price: roundCustomARS(5900 * 1.4, 100, 40),
              stock: 4.2,
              minStock: 1.5,
              code: '200100002',
              isSample: true,
            },
            {
              name: 'Pan Francés Fresco (x Kg)',
              category: 'Panadería',
              saleType: 'kg',
              cost: 1300,
              margin: 45,
              price: roundCustomARS(1300 * 1.45, 100, 40),
              stock: 15,
              minStock: 3,
              code: '200100003',
              isSample: true,
            },
            {
              name: 'Leche Entera La Serenísima 1L',
              category: 'Lácteos',
              saleType: 'unit',
              cost: 1150,
              margin: 28,
              price: roundCustomARS(1150 * 1.28, 100, 40),
              stock: 4,
              minStock: 6,
              expiryDate: getLocalDateStr(new Date(Date.now() + 4 * 86400000)),
              code: '7790742123456',
              isSample: true,
            },
            {
              name: 'Azúcar Común Ledesma 1kg',
              category: 'Almacén',
              saleType: 'unit',
              cost: 950,
              margin: 30,
              price: roundCustomARS(950 * 1.3, 100, 40),
              promoQty: 10,
              promoPrice: 1100,
              stock: 20,
              minStock: 8,
              code: '7790150112233',
              isSample: true,
            },
          ];
          demoProducts.forEach((p) => {
            const newDocRef = doc(colRef);
            batch.set(newDocRef, { ...p, createdAt: serverTimestamp() });
          });
          await batch.commit();
        } catch (e) {
          console.error('Error seeding demo products:', e);
        }
      };
      seedDemoData();
    }
  }, [user, loadingData, products.length, cleanStoreCode]);

  const hasSampleData = useMemo(() => products.some((p) => p.isSample), [products]);

  const handleClearSampleData = () => {
    setConfirmDialog({
      title: 'Limpiar productos de ejemplo',
      message:
        '¿Querés borrar los productos de ejemplo para empezar a cargar la mercadería real de tu almacén?',
      confirmText: 'Sí, limpiar ejemplos',
      onConfirm: async () => {
        try {
          const batch = writeBatch(db);
          products
            .filter((p) => p.isSample)
            .forEach((p) => {
              batch.delete(
                doc(
                  db,
                  'artifacts',
                  appId,
                  'public',
                  'data',
                  `products_${cleanStoreCode}`,
                  p.id
                )
              );
            });
          await batch.commit();
          showToast('Ejemplos eliminados. ¡Listo para cargar tu catálogo!');
        } catch (err) {
          showToast('Error al limpiar ejemplos', 'error');
        }
      },
    });
  };

  // Protección de acciones críticas con PIN de Administrador
  const requireAdmin = (actionCallback) => {
    if (isAdmin) {
      actionCallback();
    } else {
      setPendingAdminAction(() => actionCallback);
      setPinInput('');
      setShowPinModal(true);
    }
  };

  const handleVerifyPin = (e) => {
    e.preventDefault();
    if (pinInput === String(storeSettings.adminPin || '1234')) {
      setIsAdmin(true);
      setShowPinModal(false);
      showToast('Modo Administrador desbloqueado');
      if (pendingAdminAction) {
        const fn = pendingAdminAction;
        setPendingAdminAction(null);
        fn();
      }
    } else {
      showToast('PIN incorrecto', 'error');
    }
  };

  // Contadores de alertas para pestañas
  const lowStockCount = useMemo(
    () => products.filter((p) => Number(p.stock || 0) <= Number(p.minStock || 0)).length,
    [products]
  );

  const expiringCount = useMemo(
    () =>
      products.filter((p) => {
        const d = daysUntilDate(p.expiryDate);
        return d !== null && d <= 10;
      }).length,
    [products]
  );

  const totalAlertsCount = lowStockCount + expiringCount;

  const totalDebtorsCount = useMemo(
    () => customers.filter((c) => Number(c.balance || 0) > 0).length,
    [customers]
  );

  // ============================================================================
  // RENDERIZADO DE INTERFAZ PRINCIPAL
  // ============================================================================
  return (
    <div className="min-h-screen w-full bg-slate-100 text-slate-900 flex flex-col md:flex-row font-sans">
      <style>{`
        html, body, #root {
          width: 100% !important;
          max-width: 100% !important;
          margin: 0 !important;
          padding: 0 !important;
          text-align: left !important;
        }
      `}</style>
      {/* NOTIFICACIÓN FLOTANTE (TOAST) */}
      {toast && (
        <div
          className={`fixed top-4 right-4 z-50 px-4 py-3 rounded-xl shadow-xl font-semibold text-sm flex items-center gap-2 transition-all ${
            toast.type === 'error'
              ? 'bg-red-600 text-white'
              : 'bg-emerald-700 text-white'
          }`}
        >
          {toast.type === 'error' ? (
            <AlertTriangle className="w-5 h-5 shrink-0" />
          ) : (
            <CheckCircle2 className="w-5 h-5 shrink-0" />
          )}
          <span>{toast.message}</span>
        </div>
      )}

      {/* ========================================== */}
      {/* BARRA LATERAL DESKTOP (PC MOSTRADOR)        */}
      {/* ========================================== */}
      <aside className="hidden md:flex md:w-64 lg:w-72 bg-slate-900 text-white flex-col justify-between p-4 shrink-0 sticky top-0 h-screen">
        <div>
          <div className="flex items-center gap-3 px-2 py-3 border-b border-slate-800">
            <div className="bg-emerald-500 p-2.5 rounded-xl text-slate-950">
              <Store className="w-6 h-6" />
            </div>
            <div className="min-w-0">
              <h1 className="font-extrabold text-lg leading-tight truncate text-white">
                {storeSettings.storeName || 'Almacén Control'}
              </h1>
              <p className="text-xs text-emerald-400 flex items-center gap-1 mt-0.5">
                <Cloud className="w-3.5 h-3.5" /> Nube Activa
              </p>
            </div>
          </div>

          {/* Navegación Desktop */}
          <nav className="mt-6 space-y-2">
            <button
              onClick={() => setActiveTab('pos')}
              className={`w-full flex items-center justify-between px-4 py-3.5 rounded-xl font-bold text-sm transition ${
                activeTab === 'pos'
                  ? 'bg-emerald-600 text-white shadow-lg shadow-emerald-950/50'
                  : 'bg-transparent text-slate-100 hover:bg-slate-800 hover:text-white'
              }`}
            >
              <span className="flex items-center gap-3 text-white">
                <ShoppingCart className="w-5 h-5" />
                Punto de Venta
              </span>
            </button>

            <button
              onClick={() => setActiveTab('products')}
              className={`w-full flex items-center justify-between px-4 py-3.5 rounded-xl font-bold text-sm transition ${
                activeTab === 'products'
                  ? 'bg-emerald-600 text-white shadow-lg shadow-emerald-950/50'
                  : 'bg-transparent text-slate-100 hover:bg-slate-800 hover:text-white'
              }`}
            >
              <span className="flex items-center gap-3 text-white">
                <Package className="w-5 h-5" />
                Productos y Stock
              </span>
              <span className="text-xs bg-slate-800 px-2 py-0.5 rounded-full text-white">
                {products.length}
              </span>
            </button>

            <button
              onClick={() => setActiveTab('cash')}
              className={`w-full flex items-center justify-between px-4 py-3.5 rounded-xl font-bold text-sm transition ${
                activeTab === 'cash'
                  ? 'bg-emerald-600 text-white shadow-lg shadow-emerald-950/50'
                  : 'bg-transparent text-slate-100 hover:bg-slate-800 hover:text-white'
              }`}
            >
              <span className="flex items-center gap-3 text-white">
                <Wallet className="w-5 h-5" />
                Caja y Faltantes
              </span>
              {totalAlertsCount > 0 && (
                <span className="text-xs bg-amber-500 text-slate-950 font-extrabold px-2 py-0.5 rounded-full">
                  {totalAlertsCount}
                </span>
              )}
            </button>

            <button
              onClick={() => setActiveTab('fiados')}
              className={`w-full flex items-center justify-between px-4 py-3.5 rounded-xl font-bold text-sm transition ${
                activeTab === 'fiados'
                  ? 'bg-emerald-600 text-white shadow-lg shadow-emerald-950/50'
                  : 'bg-transparent text-slate-100 hover:bg-slate-800 hover:text-white'
              }`}
            >
              <span className="flex items-center gap-3 text-white">
                <Users className="w-5 h-5" />
                Clientes y Fiados
              </span>
              {totalDebtorsCount > 0 && (
                <span className="text-xs bg-rose-500 text-white font-extrabold px-2 py-0.5 rounded-full">
                  {totalDebtorsCount}
                </span>
              )}
            </button>
          </nav>
        </div>

        {/* Estado de Sincronización y Modo Admin */}
        <div className="space-y-2.5 pt-4 border-t border-slate-800">
          {hasSampleData && (
            <button
              onClick={handleClearSampleData}
              className="w-full py-2 px-3 rounded-xl bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 text-xs font-semibold flex items-center justify-center gap-1.5 border border-amber-500/30"
            >
              <Sparkles className="w-4 h-4" />
              Limpiar datos de ejemplo
            </button>
          )}

          <button
            onClick={() => {
              if (isAdmin) {
                setIsAdmin(false);
                showToast('Modo Cajero activado (precios protegidos)');
              } else {
                setPendingAdminAction(null);
                setShowPinModal(true);
              }
            }}
            className={`w-full py-2.5 px-3 rounded-xl text-xs font-bold flex items-center justify-between border transition ${
              isAdmin
                ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-300'
                : 'bg-amber-500/15 border-amber-500/40 text-amber-300'
            }`}
          >
            <span className="flex items-center gap-2">
              {isAdmin ? <Unlock className="w-4 h-4" /> : <Lock className="w-4 h-4" />}
              {isAdmin ? 'Modo Administrador' : 'Modo Cajero'}
            </span>
            <span className="underline">{isAdmin ? 'Bloquear' : 'Desbloquear'}</span>
          </button>

          <button
            onClick={() => {
              setStoreCodeInput(cleanStoreCode);
              setShowStoreLinkModal(true);
            }}
            className="w-full py-2.5 px-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs flex items-center justify-between"
          >
            <span className="flex items-center gap-2">
              <Smartphone className="w-4 h-4 text-emerald-400" />
              <span>Código:</span>
              <strong className="font-mono text-white">{cleanStoreCode}</strong>
            </span>
            <span className="text-emerald-400 font-semibold">Vincular</span>
          </button>
        </div>
      </aside>

      {/* ========================================== */}
      {/* ENCABEZADO MÓVIL (CELULAR)                 */}
      {/* ========================================== */}
      <header className="md:hidden bg-slate-900 text-white px-4 py-3 flex items-center justify-between sticky top-0 z-20 shadow-md">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="bg-emerald-500 p-2 rounded-xl text-slate-950 shrink-0">
            <Store className="w-5 h-5" />
          </div>
          <div className="truncate">
            <h1 className="font-extrabold text-base leading-none truncate text-white">
              {storeSettings.storeName || 'Almacén Control'}
            </h1>
            <button
              onClick={() => {
                setStoreCodeInput(cleanStoreCode);
                setShowStoreLinkModal(true);
              }}
              className="text-xs text-emerald-400 bg-transparent flex items-center gap-1 mt-1 font-mono font-bold"
            >
              <Cloud className="w-3.5 h-3.5" /> {cleanStoreCode}
            </button>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {hasSampleData && (
            <button
              onClick={handleClearSampleData}
              title="Limpiar datos de ejemplo"
              className="p-2.5 bg-slate-800 text-amber-400 rounded-xl border border-slate-700"
            >
              <Sparkles className="w-5 h-5" />
            </button>
          )}
          <button
            onClick={() => {
              if (isAdmin) {
                setIsAdmin(false);
                showToast('Modo Cajero activado (precios protegidos)');
              } else {
                setPendingAdminAction(null);
                setShowPinModal(true);
              }
            }}
            className={`px-3 py-2 rounded-xl text-xs font-extrabold flex items-center gap-1.5 border ${
              isAdmin
                ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
                : 'bg-amber-500/20 text-amber-300 border-amber-500/40'
            }`}
          >
            {isAdmin ? <Unlock className="w-4 h-4" /> : <Lock className="w-4 h-4" />}
            <span>{isAdmin ? 'Admin' : 'Cajero'}</span>
          </button>
        </div>
      </header>

      {/* ========================================== */}
      {/* CONTENIDO PRINCIPAL                        */}
      {/* ========================================== */}
      <main className="flex-1 w-full min-w-0 p-3 sm:p-5 lg:p-6 pb-36 md:pb-6">
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
            products={products}
            sales={sales}
            expenses={expenses}
            cashSession={cashSession}
            storeSettings={storeSettings}
            isAdmin={isAdmin}
            requireAdmin={requireAdmin}
            showToast={showToast}
          />
        )}

        {activeTab === 'fiados' && (
          <FiadosModule
            user={user}
            cleanStoreCode={cleanStoreCode}
            customers={customers}
            fiados={fiados}
            storeSettings={storeSettings}
            showToast={showToast}
          />
        )}
      </main>

      {/* ========================================== */}
      {/* BARRA INFERIOR MÓVIL (CELULAR)             */}
      {/* ========================================== */}
      <nav className="md:hidden fixed bottom-0 inset-x-0 bg-slate-900 text-white border-t border-slate-800 grid grid-cols-4 z-30">
        <button
          onClick={() => setActiveTab('pos')}
          className={`py-2.5 flex flex-col items-center justify-center gap-1 text-xs font-bold ${
            activeTab === 'pos'
              ? 'text-emerald-400 bg-slate-800'
              : 'bg-slate-900 text-white hover:bg-slate-800'
          }`}
        >
          <ShoppingCart className="w-5 h-5" />
          <span>Vender</span>
        </button>

        <button
          onClick={() => setActiveTab('products')}
          className={`py-2.5 flex flex-col items-center justify-center gap-1 text-xs font-bold ${
            activeTab === 'products'
              ? 'text-emerald-400 bg-slate-800'
              : 'bg-slate-900 text-white hover:bg-slate-800'
          }`}
        >
          <Package className="w-5 h-5" />
          <span>Productos</span>
        </button>

        <button
          onClick={() => setActiveTab('cash')}
          className={`py-2.5 flex flex-col items-center justify-center gap-1 text-xs font-bold relative ${
            activeTab === 'cash'
              ? 'text-emerald-400 bg-slate-800'
              : 'bg-slate-900 text-white hover:bg-slate-800'
          }`}
        >
          <Wallet className="w-5 h-5" />
          <span>Caja</span>
          {totalAlertsCount > 0 && (
            <span className="absolute top-1.5 right-5 bg-amber-500 text-slate-950 text-[10px] font-black px-1.5 rounded-full">
              {totalAlertsCount}
            </span>
          )}
        </button>

        <button
          onClick={() => setActiveTab('fiados')}
          className={`py-2.5 flex flex-col items-center justify-center gap-1 text-xs font-bold relative ${
            activeTab === 'fiados'
              ? 'text-emerald-400 bg-slate-800'
              : 'bg-slate-900 text-white hover:bg-slate-800'
          }`}
        >
          <Users className="w-5 h-5" />
          <span>Fiados</span>
          {totalDebtorsCount > 0 && (
            <span className="absolute top-1.5 right-5 bg-rose-500 text-white text-[10px] font-black px-1.5 rounded-full">
              {totalDebtorsCount}
            </span>
          )}
        </button>
      </nav>

      {/* ========================================== */}
      {/* MODAL: VINCULAR PC Y CELULAR + AJUSTES     */}
      {/* ========================================== */}
      {showStoreLinkModal && (
        <StoreSettingsModal
          cleanStoreCode={cleanStoreCode}
          storeCodeInput={storeCodeInput}
          setStoreCodeInput={setStoreCodeInput}
          storeSettings={storeSettings}
          onClose={() => setShowStoreLinkModal(false)}
          onSaveStoreCode={(newCode) => {
            const clean = newCode.trim().toUpperCase().replace(/[^A-Z0-9_-]/g, '');
            if (!clean) return;
            localStorage.setItem('almacen_store_code', clean);
            setStoreCode(clean);
            setShowStoreLinkModal(false);
            showToast(`Conectado al almacén ${clean}`);
          }}
          onSaveSettings={async (updated) => {
            try {
              await setDoc(
                doc(
                  db,
                  'artifacts',
                  appId,
                  'public',
                  'data',
                  `settings_${cleanStoreCode}`,
                  'config'
                ),
                updated,
                { merge: true }
              );
              showToast('Configuración guardada en la nube');
              setShowStoreLinkModal(false);
            } catch (err) {
              showToast('Error al guardar ajustes', 'error');
            }
          }}
        />
      )}

      {/* ========================================== */}
      {/* MODAL: PIN DE ADMINISTRADOR                */}
      {/* ========================================== */}
      {showPinModal && (
        <div className="fixed inset-0 bg-slate-950/70 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-sm w-full p-6 shadow-2xl">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2 text-slate-900 font-extrabold text-lg">
                <ShieldCheck className="w-6 h-6 text-emerald-600" />
                <span>Acceso Administrador</span>
              </div>
              <button
                onClick={() => setShowPinModal(false)}
                className="p-1 text-slate-400 hover:text-slate-600"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <p className="text-sm text-slate-600 mb-4">
              Ingresá el PIN para modificar precios, cargar mercadería o anular ventas. (Por defecto:{' '}
              <strong className="font-mono">1234</strong>)
            </p>
            <form onSubmit={handleVerifyPin} className="space-y-4">
              <input
                type="password"
                inputMode="numeric"
                maxLength={6}
                value={pinInput}
                onChange={(e) => setPinInput(e.target.value)}
                placeholder="••••"
                autoFocus
                className="w-full text-center text-2xl tracking-[0.5em] font-mono font-bold py-3 border-2 border-slate-300 rounded-xl focus:border-emerald-500 focus:outline-none"
              />
              <button
                type="submit"
                className="w-full py-3 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl"
              >
                Desbloquear
              </button>
            </form>
          </div>
        </div>
      )}

      {/* ========================================== */}
      {/* MODAL DE CONFIRMACIÓN (REEMPLAZA CONFIRM)  */}
      {/* ========================================== */}
      {confirmDialog && (
        <div className="fixed inset-0 bg-slate-950/70 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl space-y-4">
            <h3 className="text-lg font-extrabold text-slate-900">{confirmDialog.title}</h3>
            <p className="text-sm text-slate-600 leading-relaxed">{confirmDialog.message}</p>
            <div className="flex justify-end gap-2.5 pt-2">
              <button
                onClick={() => setConfirmDialog(null)}
                className="px-4 py-2.5 rounded-xl font-bold text-sm bg-slate-100 hover:bg-slate-200 text-slate-700"
              >
                Cancelar
              </button>
              <button
                onClick={() => {
                  const fn = confirmDialog.onConfirm;
                  setConfirmDialog(null);
                  fn && fn();
                }}
                className="px-4 py-2.5 rounded-xl font-bold text-sm bg-red-600 hover:bg-red-700 text-white"
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

// ============================================================================
// MÓDULO 1: PUNTO DE VENTA (MOSTRADOR + BALANZA + SEÑA + PAGO MIXTO)
// ============================================================================
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
  setConfirmDialog,
}) {
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCat, setSelectedCat] = useState('Todos');
  const [cart, setCart] = useState([]);
  const [showFreeSale, setShowFreeSale] = useState(false);
  const [freeSaleName, setFreeSaleName] = useState('');
  const [freeSaleAmount, setFreeSaleAmount] = useState('');

  // Modal de balanza (por kilo)
  const [scaleProduct, setScaleProduct] = useState(null);
  const [scaleMode, setScaleMode] = useState('grams'); // 'grams' | 'amount'
  const [scaleInput, setScaleInput] = useState('');

  // Modal de cobro (Simple o Mixto)
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [paymentMode, setPaymentMode] = useState('single'); // 'single' | 'split'
  const [method1, setMethod1] = useState('Efectivo');
  const [amount1, setAmount1] = useState('');
  const [method2, setMethod2] = useState('Transferencia / MP');
  const [cashTendered, setCashTendered] = useState('');
  const [selectedCustomerId, setSelectedCustomerId] = useState('');
  const [isSubmittingSale, setIsSubmittingSale] = useState(false);

  // Post-venta (Comprobante WhatsApp)
  const [lastCompletedSale, setLastCompletedSale] = useState(null);

  // Modal de escáner con cámara
  const [scannerOpen, setScannerOpen] = useState(false);
  const [scannerError, setScannerError] = useState('');
  const [manualScanCode, setManualScanCode] = useState('');
  const videoRef = useRef(null);
  const streamRef = useRef(null);

  // Modal de ventas de hoy
  const [showTodaySales, setShowTodaySales] = useState(false);

  // Estado para instalar como App en el celular (PWA)
  const [deferredInstallPrompt, setDeferredInstallPrompt] = useState(null);
  const [showInstallGuide, setShowInstallGuide] = useState(false);

  useEffect(() => {
    // Inyectar manifiesto dinámico y metadatos móviles para instalación como App
    const manifest = {
      name: storeSettings.storeName || 'Almacén Control Pro',
      short_name: 'Almacén Pro',
      start_url: window.location.href,
      display: 'standalone',
      background_color: '#0f172a',
      theme_color: '#0f172a',
      orientation: 'portrait-primary',
    };
    const blob = new Blob([JSON.stringify(manifest)], { type: 'application/json' });
    const manifestUrl = URL.createObjectURL(blob);
    let link = document.querySelector("link[rel='manifest']");
    if (!link) {
      link = document.createElement('link');
      link.rel = 'manifest';
      document.head.appendChild(link);
    }
    link.href = manifestUrl;

    const handleBeforeInstall = (e) => {
      e.preventDefault();
      setDeferredInstallPrompt(e);
    };
    window.addEventListener('beforeinstallprompt', handleBeforeInstall);
    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstall);
      URL.revokeObjectURL(manifestUrl);
    };
  }, [storeSettings.storeName]);

  const handleInstallAppClick = async () => {
    if (deferredInstallPrompt) {
      deferredInstallPrompt.prompt();
      const { outcome } = await deferredInstallPrompt.userChoice;
      if (outcome === 'accepted') {
        setDeferredInstallPrompt(null);
        showToast('¡App instalada en tu celular!');
      }
    } else {
      setShowInstallGuide(true);
    }
  };

  const searchInputRef = useRef(null);
  const cartSectionRef = useRef(null);
  const globalBarcodeBufferRef = useRef('');
  const globalBarcodeTimerRef = useRef(null);

  const defaultDeposit = Number(storeSettings.defaultDeposit ?? 2000);
  const roundStep = Number(storeSettings.roundStep ?? 100);
  const roundThreshold = Number(storeSettings.roundThreshold ?? 40);

  // Filtrado de productos
  const filteredProducts = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    return products.filter((p) => {
      const matchCat = selectedCat === 'Todos' || p.category === selectedCat;
      if (!matchCat) return false;
      if (!q) return true;
      return (
        (p.name && p.name.toLowerCase().includes(q)) ||
        (p.code && p.code.toLowerCase().includes(q))
      );
    });
  }, [products, searchTerm, selectedCat]);

  // Ventas de hoy
  const todaySales = useMemo(() => {
    const todayStr = getLocalDateStr();
    return sales.filter((s) => s.dateStr === todayStr);
  }, [sales]);

  // Total del carrito
  const cartTotal = useMemo(
    () => cart.reduce((acc, item) => acc + Number(item.subtotal || 0), 0),
    [cart]
  );

  // Helper para calcular precio unitario según promo / pack por cantidad
  const getEffectiveUnitPrice = (prod, qty) => {
    const promoQty = Number(prod.promoQty || 0);
    const promoPrice = Number(prod.promoPrice || 0);
    if (promoQty >= 2 && promoPrice > 0 && qty >= promoQty) {
      return promoPrice;
    }
    return Number(prod.price || 0);
  };

  // Agregar producto por unidad al carrito
  const addUnitProductToCart = (prod, qtyToAdd = 1) => {
    setCart((prev) => {
      const idx = prev.findIndex((i) => i.productId === prod.id && i.saleType === 'unit');
      if (idx >= 0) {
        const updated = [...prev];
        const newQty = updated[idx].qty + qtyToAdd;
        const unitPrice = getEffectiveUnitPrice(prod, newQty);
        updated[idx] = {
          ...updated[idx],
          qty: newQty,
          unitPrice,
          basePrice: Number(prod.price),
          promoQty: Number(prod.promoQty || 0),
          promoPrice: Number(prod.promoPrice || 0),
          subtotal: newQty * unitPrice,
        };
        return updated;
      }
      const unitPrice = getEffectiveUnitPrice(prod, qtyToAdd);
      return [
        ...prev,
        {
          uid: `${prod.id}_${Date.now()}`,
          productId: prod.id,
          name: prod.name,
          saleType: 'unit',
          qty: qtyToAdd,
          unitPrice,
          basePrice: Number(prod.price),
          promoQty: Number(prod.promoQty || 0),
          promoPrice: Number(prod.promoPrice || 0),
          cost: Number(prod.cost || 0),
          subtotal: qtyToAdd * unitPrice,
        },
      ];
    });
  };

  // Agregar pack promocional completo en 1 toque
  const handleAddPack = (e, prod) => {
    e.stopPropagation();
    const packQty = Number(prod.promoQty || 1);
    addUnitProductToCart(prod, packQty);
    showToast(`Pack x${packQty} agregado: ${prod.name}`);
  };

  // Al hacer clic en un producto del catálogo
  const handleProductClick = (prod) => {
    if (prod.saleType === 'kg') {
      setScaleProduct(prod);
      setScaleMode('grams');
      setScaleInput('');
    } else {
      addUnitProductToCart(prod, 1);
    }
  };

  // Escaneo rápido con Enter en el buscador
  const handleSearchKeyDown = (e) => {
    if (e.key === 'Enter' && searchTerm.trim()) {
      const q = searchTerm.trim().toLowerCase();
      const exactCode = products.find((p) => p.code && p.code.toLowerCase() === q);
      if (exactCode) {
        e.preventDefault();
        handleProductClick(exactCode);
        setSearchTerm('');
      } else if (filteredProducts.length === 1) {
        e.preventDefault();
        handleProductClick(filteredProducts[0]);
        setSearchTerm('');
      }
    }
  };

  // Captura global de lector de código de barras USB en PC sin hacer clic en el buscador
  useEffect(() => {
    const handleGlobalKeyDown = (e) => {
      if (scaleProduct || checkoutOpen || scannerOpen || showTodaySales) return;
      const tag = document.activeElement?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

      if (e.key === 'Enter') {
        const scanned = globalBarcodeBufferRef.current.trim().toLowerCase();
        globalBarcodeBufferRef.current = '';
        if (scanned.length >= 3) {
          const match = products.find((p) => p.code && p.code.toLowerCase() === scanned);
          if (match) {
            e.preventDefault();
            handleProductClick(match);
            showToast(`Escaneado: ${match.name}`);
          }
        }
        return;
      }

      if (e.key.length === 1 && !e.ctrlKey && !e.altKey && !e.metaKey) {
        globalBarcodeBufferRef.current += e.key;
        clearTimeout(globalBarcodeTimerRef.current);
        globalBarcodeTimerRef.current = setTimeout(() => {
          globalBarcodeBufferRef.current = '';
        }, 120);
      }
    };

    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => {
      window.removeEventListener('keydown', handleGlobalKeyDown);
      clearTimeout(globalBarcodeTimerRef.current);
    };
  }, [products, scaleProduct, checkoutOpen, scannerOpen, showTodaySales]);

  // Cálculo en vivo dentro del modal de balanza
  const scalePreview = useMemo(() => {
    if (!scaleProduct) return { kg: 0, exact: 0, rounded: 0 };
    const pricePerKg = Number(scaleProduct.price || 0);
    const val = parseFloat(scaleInput);
    if (!val || val <= 0) return { kg: 0, exact: 0, rounded: 0 };

    if (scaleMode === 'grams') {
      const kg = val >= 20 ? val / 1000 : val;
      const exact = kg * pricePerKg;
      const rounded = roundCustomARS(exact, roundStep, roundThreshold);
      return { kg, exact, rounded };
    } else {
      const kg = pricePerKg > 0 ? val / pricePerKg : 0;
      const rounded = roundCustomARS(val, roundStep, roundThreshold);
      return { kg, exact: val, rounded };
    }
  }, [scaleProduct, scaleInput, scaleMode, roundStep, roundThreshold]);

  const confirmScaleItem = (customGrams = null) => {
    if (!scaleProduct) return;
    const pricePerKg = Number(scaleProduct.price || 0);
    let kg = 0;
    let roundedSubtotal = 0;

    if (customGrams !== null) {
      kg = customGrams / 1000;
      roundedSubtotal = roundCustomARS(kg * pricePerKg, roundStep, roundThreshold);
    } else {
      if (scalePreview.kg <= 0 || scalePreview.rounded <= 0) {
        showToast('Ingresá un peso o importe válido', 'error');
        return;
      }
      kg = scalePreview.kg;
      roundedSubtotal = scalePreview.rounded;
    }

    setCart((prev) => [
      ...prev,
      {
        uid: `${scaleProduct.id}_${Date.now()}`,
        productId: scaleProduct.id,
        name: `${scaleProduct.name} (${kg.toFixed(3)} kg)`,
        saleType: 'kg',
        qty: Number(kg.toFixed(3)),
        unitPrice: pricePerKg,
        cost: Number(scaleProduct.cost || 0),
        subtotal: roundedSubtotal,
      },
    ]);
    setScaleProduct(null);
    setScaleInput('');
  };

  // Botón rápido + Seña ($2.000 editable)
  const handleAddDeposit = () => {
    setCart((prev) => [
      ...prev,
      {
        uid: `deposit_${Date.now()}`,
        productId: null,
        name: 'Seña Envase Retornable',
        saleType: 'deposit',
        qty: 1,
        unitPrice: defaultDeposit,
        cost: 0,
        subtotal: defaultDeposit,
      },
    ]);
    showToast(`Seña de ${formatARS(defaultDeposit)} agregada`);
  };

  // Botón rápido - Devolución Envase (-$2.000)
  const handleReturnDeposit = () => {
    if (cart.length > 0) {
      setCart((prev) => [
        ...prev,
        {
          uid: `return_dep_${Date.now()}`,
          productId: null,
          name: 'Devolución Envase',
          saleType: 'deposit_return',
          qty: 1,
          unitPrice: -defaultDeposit,
          cost: 0,
          subtotal: -defaultDeposit,
        },
      ]);
      showToast(`Descuento por envase (-${formatARS(defaultDeposit)}) aplicado`);
    } else {
      setConfirmDialog({
        title: 'Devolución de Envase sin compra',
        message: `¿Registrar salida de ${formatARS(defaultDeposit)} en efectivo de caja por devolución de envase?`,
        confirmText: 'Sí, entregar efectivo',
        onConfirm: async () => {
          try {
            await addDoc(
              collection(db, 'artifacts', appId, 'public', 'data', `expenses_${cleanStoreCode}`),
              {
                category: 'Devolución Envase',
                description: 'Devolución de seña de envase en efectivo',
                amount: defaultDeposit,
                method: 'Efectivo',
                dateStr: getLocalDateStr(),
                createdAt: serverTimestamp(),
              }
            );
            showToast(`Salida de ${formatARS(defaultDeposit)} registrada en caja`);
          } catch (err) {
            showToast('Error al registrar salida', 'error');
          }
        },
      });
    }
  };

  // Venta Libre / Suelta
  const handleAddFreeSale = (e) => {
    e.preventDefault();
    const rawAmount = parseFloat(freeSaleAmount);
    if (!rawAmount || rawAmount <= 0) {
      showToast('Ingresá un importe válido', 'error');
      return;
    }
    const finalAmount = roundCustomARS(rawAmount, roundStep, roundThreshold);
    setCart((prev) => [
      ...prev,
      {
        uid: `free_${Date.now()}`,
        productId: null,
        name: freeSaleName.trim() || 'Varios / Suelto',
        saleType: 'free',
        qty: 1,
        unitPrice: finalAmount,
        cost: 0,
        subtotal: finalAmount,
      },
    ]);
    setFreeSaleName('');
    setFreeSaleAmount('');
    setShowFreeSale(false);
  };

  // Modificar cantidad o importe en carrito
  const updateCartItemQty = (uid, delta) => {
    setCart((prev) =>
      prev
        .map((item) => {
          if (item.uid !== uid) return item;
          const nextQty = item.qty + delta;
          if (nextQty <= 0) return null;
          let nextUnitPrice = item.unitPrice;
          if (item.saleType === 'unit' && item.promoQty >= 2 && item.promoPrice > 0) {
            nextUnitPrice = nextQty >= item.promoQty ? item.promoPrice : item.basePrice;
          }
          return {
            ...item,
            qty: nextQty,
            unitPrice: nextUnitPrice,
            subtotal: nextQty * nextUnitPrice,
          };
        })
        .filter(Boolean)
    );
  };

  const updateCartItemPrice = (uid, newUnitPrice) => {
    const val = parseFloat(newUnitPrice);
    if (isNaN(val)) return;
    setCart((prev) =>
      prev.map((item) => {
        if (item.uid !== uid) return item;
        return {
          ...item,
          unitPrice: val,
          subtotal: item.qty * val,
        };
      })
    );
  };

  const removeCartItem = (uid) => {
    setCart((prev) => prev.filter((item) => item.uid !== uid));
  };

  // Abrir modal de cobro
  const openCheckoutModal = (mode = 'single') => {
    if (cart.length === 0) {
      showToast('El carrito está vacío', 'error');
      return;
    }
    setPaymentMode(mode);
    setMethod1('Efectivo');
    setMethod2('Transferencia / MP');
    setAmount1(mode === 'split' ? Math.floor(cartTotal / 2).toString() : '');
    setCashTendered('');
    setSelectedCustomerId('');
    setCheckoutOpen(true);
  };

  // Cálculos de pago mixto y vuelto
  const parsedAmount1 = parseFloat(amount1) || 0;
  const remainingAmount2 = Math.max(0, cartTotal - parsedAmount1);
  const cashChange = useMemo(() => {
    const tendered = parseFloat(cashTendered) || 0;
    if (paymentMode === 'single' && method1 === 'Efectivo') {
      return Math.max(0, tendered - cartTotal);
    }
    if (paymentMode === 'split') {
      if (method1 === 'Efectivo') return Math.max(0, tendered - parsedAmount1);
      if (method2 === 'Efectivo') return Math.max(0, tendered - remainingAmount2);
    }
    return 0;
  }, [cashTendered, paymentMode, method1, method2, cartTotal, parsedAmount1, remainingAmount2]);

  // Confirmar Venta
  const handleConfirmSale = async () => {
    if (cart.length === 0 || isSubmittingSale) return;

    let payments = [];
    if (paymentMode === 'single') {
      if (method1 === 'Fiado' && !selectedCustomerId) {
        showToast('Seleccioná un cliente para anotar el fiado', 'error');
        return;
      }
      payments = [{ method: method1, amount: cartTotal }];
    } else {
      if (parsedAmount1 <= 0 || parsedAmount1 >= cartTotal) {
        showToast('El primer monto debe ser mayor a $0 y menor al total', 'error');
        return;
      }
      if (method1 === method2) {
        showToast('Elegí dos medios de pago distintos', 'error');
        return;
      }
      if ((method1 === 'Fiado' || method2 === 'Fiado') && !selectedCustomerId) {
        showToast('Seleccioná un cliente para la parte fiada', 'error');
        return;
      }
      payments = [
        { method: method1, amount: parsedAmount1 },
        { method: method2, amount: remainingAmount2 },
      ];
    }

    setIsSubmittingSale(true);
    try {
      const customer = customers.find((c) => c.id === selectedCustomerId);
      const totalCost = cart.reduce(
        (acc, item) => acc + Number(item.cost || 0) * Number(item.qty || 0),
        0
      );

      const salePayload = {
        items: cart,
        total: cartTotal,
        totalCost,
        payments,
        customerId: customer ? customer.id : null,
        customerName: customer ? customer.name : null,
        status: 'completed',
        dateStr: getLocalDateStr(),
        createdAt: serverTimestamp(),
      };

      const saleDoc = await addDoc(
        collection(db, 'artifacts', appId, 'public', 'data', `sales_${cleanStoreCode}`),
        salePayload
      );

      for (const item of cart) {
        if (item.productId) {
          const prodRef = doc(
            db,
            'artifacts',
            appId,
            'public',
            'data',
            `products_${cleanStoreCode}`,
            item.productId
          );
          const currentProd = products.find((p) => p.id === item.productId);
          if (currentProd) {
            const nextStock = Math.max(0, Number(currentProd.stock || 0) - Number(item.qty || 0));
            await updateDoc(prodRef, { stock: Number(nextStock.toFixed(3)) });
          }
        }
      }

      const fiadoPayment = payments.find((p) => p.method === 'Fiado');
      if (fiadoPayment && customer) {
        const itemsSummary = cart.map((i) => `${i.qty}x ${i.name}`).join(', ');
        await addDoc(
          collection(db, 'artifacts', appId, 'public', 'data', `fiados_${cleanStoreCode}`),
          {
            customerId: customer.id,
            customerName: customer.name,
            type: 'debt',
            amount: fiadoPayment.amount,
            description: `Compra: ${itemsSummary}`,
            saleId: saleDoc.id,
            dateStr: getLocalDateStr(),
            createdAt: serverTimestamp(),
          }
        );

        const custRef = doc(
          db,
          'artifacts',
          appId,
          'public',
          'data',
          `customers_${cleanStoreCode}`,
          customer.id
        );
        await updateDoc(custRef, {
          balance: Number(customer.balance || 0) + Number(fiadoPayment.amount),
        });
      }

      setLastCompletedSale({
        ...salePayload,
        id: saleDoc.id,
        customerPhone: customer?.phone || '',
      });
      setCart([]);
      setCheckoutOpen(false);
      showToast('¡Venta registrada con éxito!');
    } catch (err) {
      console.error(err);
      showToast('Error al guardar la venta', 'error');
    } finally {
      setIsSubmittingSale(false);
    }
  };

  // Anular una venta del día (Solo Admin)
  const handleVoidSale = (sale) => {
    requireAdmin(() => {
      setConfirmDialog({
        title: 'Anular venta',
        message: `¿Anular esta venta por ${formatARS(sale.total)}? Se devolverá la mercadería al stock.`,
        confirmText: 'Sí, anular venta',
        onConfirm: async () => {
          try {
            await updateDoc(
              doc(db, 'artifacts', appId, 'public', 'data', `sales_${cleanStoreCode}`, sale.id),
              { status: 'voided' }
            );
            for (const item of sale.items || []) {
              if (item.productId) {
                const prod = products.find((p) => p.id === item.productId);
                if (prod) {
                  await updateDoc(
                    doc(
                      db,
                      'artifacts',
                      appId,
                      'public',
                      'data',
                      `products_${cleanStoreCode}`,
                      item.productId
                    ),
                    { stock: Number((Number(prod.stock || 0) + Number(item.qty || 0)).toFixed(3)) }
                  );
                }
              }
            }
            showToast('Venta anulada y stock restaurado');
          } catch (err) {
            showToast('Error al anular venta', 'error');
          }
        },
      });
    });
  };

  // Escáner con cámara del celular
  const openCameraScanner = async () => {
    setScannerError('');
    setManualScanCode('');
    setScannerOpen(true);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' },
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }
      if ('BarcodeDetector' in window) {
        const detector = new window.BarcodeDetector({
          formats: ['ean_13', 'ean_8', 'code_128', 'upc_a', 'upc_e'],
        });
        const scanLoop = async () => {
          if (!streamRef.current || !videoRef.current) return;
          try {
            const barcodes = await detector.detect(videoRef.current);
            if (barcodes.length > 0) {
              const code = barcodes[0].rawValue;
              closeCameraScanner();
              const found = products.find((p) => p.code === code);
              if (found) {
                handleProductClick(found);
                showToast(`Producto escaneado: ${found.name}`);
              } else {
                setSearchTerm(code);
                showToast(`Código ${code} no encontrado en catálogo`, 'error');
              }
              return;
            }
          } catch {}
          requestAnimationFrame(scanLoop);
        };
        requestAnimationFrame(scanLoop);
      } else {
        setScannerError(
          'Tu navegador no soporta lectura automática por cámara. Escribí o pegá el código abajo.'
        );
      }
    } catch (err) {
      setScannerError('No se pudo acceder a la cámara. Verificá los permisos o escribí el código.');
    }
  };

  const closeCameraScanner = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    setScannerOpen(false);
  };

  const handleManualScanSubmit = (e) => {
    e.preventDefault();
    const code = manualScanCode.trim();
    if (!code) return;
    closeCameraScanner();
    const found = products.find((p) => p.code === code);
    if (found) {
      handleProductClick(found);
      showToast(`Agregado: ${found.name}`);
    } else {
      setSearchTerm(code);
      showToast(`No se encontró producto con código ${code}`, 'error');
    }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
      {/* ========================================== */}
      {/* COLUMNA IZQUIERDA: CATÁLOGO Y BUSCADOR     */}
      {/* ========================================== */}
      <div className="lg:col-span-7 xl:col-span-8 space-y-4">
        {/* Barra de Búsqueda + Escáner + Botones Rápidos */}
        <div className="bg-white p-3.5 sm:p-4 rounded-2xl shadow-xs border border-slate-200 space-y-3">
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Search className="w-5 h-5 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input
                ref={searchInputRef}
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                onKeyDown={handleSearchKeyDown}
                placeholder="Buscar producto o escanear código..."
                className="w-full pl-11 pr-10 py-3.5 bg-slate-50 border border-slate-300 rounded-xl text-base font-medium focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:bg-white"
              />
              {searchTerm && (
                <button
                  onClick={() => setSearchTerm('')}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 p-1"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>

            <button
              onClick={openCameraScanner}
              title="Escanear con cámara del celular"
              className="px-4 py-3.5 bg-slate-900 hover:bg-slate-800 text-white rounded-xl font-bold text-sm flex items-center gap-2 shrink-0 transition"
            >
              <Camera className="w-5 h-5 text-emerald-400" />
              <span className="hidden sm:inline">Escanear</span>
            </button>
          </div>

          {/* Botones Rápidos de Mostrador: Seña, Devolución Envase, Venta Libre, Últimas ventas */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
            <button
              onClick={handleAddDeposit}
              className="py-3.5 px-3 bg-amber-100 hover:bg-amber-200 border border-amber-300 text-amber-950 rounded-xl font-extrabold text-sm flex items-center justify-center gap-1.5 transition"
            >
              <Plus className="w-4 h-4 text-amber-700 shrink-0" />
              <span>Seña ({formatARS(defaultDeposit)})</span>
            </button>

            <button
              onClick={handleReturnDeposit}
              className="py-3.5 px-3 bg-orange-100 hover:bg-orange-200 border border-orange-300 text-orange-950 rounded-xl font-extrabold text-sm flex items-center justify-center gap-1.5 transition"
            >
              <RotateCcw className="w-4 h-4 text-orange-700 shrink-0" />
              <span>Dev. Envase</span>
            </button>

            <button
              onClick={() => setShowFreeSale(!showFreeSale)}
              className="py-3.5 px-3 bg-emerald-100 hover:bg-emerald-200 border border-emerald-300 text-emerald-950 rounded-xl font-extrabold text-sm flex items-center justify-center gap-1.5 transition"
            >
              <Plus className="w-4 h-4 text-emerald-700 shrink-0" />
              <span>Venta Suelta</span>
            </button>

            <button
              onClick={() => setShowTodaySales(true)}
              className="py-3.5 px-3 bg-slate-100 hover:bg-slate-200 border border-slate-300 text-slate-800 rounded-xl font-bold text-sm flex items-center justify-center gap-1.5 transition"
            >
              <Receipt className="w-4 h-4 text-slate-600 shrink-0" />
              <span>Tickets ({todaySales.length})</span>
            </button>
          </div>

          {/* Formulario rápido de Venta Libre / Suelta */}
          {showFreeSale && (
            <form
              onSubmit={handleAddFreeSale}
              className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl flex flex-col sm:flex-row gap-2"
            >
              <input
                type="text"
                value={freeSaleName}
                onChange={(e) => setFreeSaleName(e.target.value)}
                placeholder="Descripción (ej: Pan suelto, Bolsas...)"
                className="flex-1 px-3 py-2.5 bg-white border border-emerald-300 rounded-lg text-sm"
              />
              <input
                type="number"
                step="any"
                value={freeSaleAmount}
                onChange={(e) => setFreeSaleAmount(e.target.value)}
                placeholder="Importe $"
                className="w-full sm:w-36 px-3 py-2.5 bg-white border border-emerald-300 rounded-lg text-sm font-bold"
                autoFocus
              />
              <button
                type="submit"
                className="px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-sm rounded-lg"
              >
                Agregar
              </button>
            </form>
          )}

          {/* Filtro por Categorías */}
          <div className="flex gap-2 overflow-x-auto pb-1">
            {['Todos', ...CATEGORIAS].map((cat) => (
              <button
                key={cat}
                onClick={() => setSelectedCat(cat)}
                className={`px-3.5 py-2 rounded-xl text-sm font-extrabold whitespace-nowrap transition ${
                  selectedCat === cat
                    ? 'bg-slate-900 text-white'
                    : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                }`}
              >
                {cat}
              </button>
            ))}
          </div>
        </div>

        {/* Grilla de Productos */}
        {filteredProducts.length === 0 ? (
          <div className="bg-white rounded-2xl border border-slate-200 p-10 text-center text-slate-500">
            <Package className="w-10 h-10 mx-auto text-slate-300 mb-2" />
            <p className="font-semibold">No se encontraron productos con ese filtro.</p>
            <p className="text-xs mt-1">
              Podés cargarlo en la pestaña "Productos" o usar "Venta Suelta".
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-3 xl:grid-cols-4 gap-3">
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
                  className={`cursor-pointer bg-white active:scale-[0.98] border rounded-2xl p-4 sm:p-3 text-left flex flex-col justify-between transition shadow-2xs group ${
                    isKg
                      ? 'border-blue-200 hover:border-blue-500 hover:bg-blue-50/40'
                      : hasPromo
                      ? 'border-purple-200 hover:border-purple-500 hover:bg-purple-50/30'
                      : 'border-slate-200 hover:border-emerald-500 hover:bg-emerald-50/40'
                  }`}
                >
                  <div>
                    <div className="flex items-center justify-between gap-1.5 mb-2">
                      {isKg ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-blue-100 text-blue-800 text-xs font-extrabold">
                          <Scale className="w-3.5 h-3.5" /> BALANZA
                        </span>
                      ) : hasPromo ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-purple-100 text-purple-800 text-xs font-extrabold">
                          <Layers className="w-3.5 h-3.5" /> {prod.promoQty}+ x{' '}
                          {formatARS(prod.promoPrice)}
                        </span>
                      ) : (
                        <span className="text-xs font-bold uppercase text-slate-400 truncate">
                          {prod.category}
                        </span>
                      )}
                      <span
                        className={`text-xs font-extrabold px-2 py-0.5 rounded-md ${
                          isZero
                            ? 'bg-red-100 text-red-700'
                            : isLow
                            ? 'bg-amber-100 text-amber-800'
                            : 'bg-slate-100 text-slate-700'
                        }`}
                      >
                        {isKg ? `${Number(prod.stock).toFixed(1)}kg` : `${prod.stock}u`}
                      </span>
                    </div>
                    <h3 className="font-extrabold text-slate-900 text-base sm:text-sm leading-snug line-clamp-2">
                      {prod.name}
                    </h3>
                  </div>

                  <div className="mt-3 pt-2.5 border-t border-slate-100 space-y-2">
                    <div className="flex items-center justify-between">
                      <div>
                        <span
                          className={`text-xl sm:text-lg font-black ${
                            isKg ? 'text-blue-700' : 'text-emerald-700'
                          }`}
                        >
                          {formatARS(prod.price)}
                        </span>
                        {isKg && <span className="text-xs font-bold text-slate-500"> /kg</span>}
                      </div>
                      <span
                        className={`w-9 h-9 sm:w-7 sm:h-7 rounded-xl sm:rounded-lg flex items-center justify-center transition ${
                          isKg
                            ? 'bg-blue-100 text-blue-700 group-hover:bg-blue-600 group-hover:text-white'
                            : 'bg-emerald-100 text-emerald-700 group-hover:bg-emerald-600 group-hover:text-white'
                        }`}
                      >
                        {isKg ? (
                          <Scale className="w-5 h-5 sm:w-4 sm:h-4" />
                        ) : (
                          <Plus className="w-5 h-5 sm:w-4 sm:h-4" />
                        )}
                      </span>
                    </div>

                    {hasPromo && (
                      <button
                        type="button"
                        onClick={(e) => handleAddPack(e, prod)}
                        className="w-full py-2 sm:py-1 px-2.5 bg-purple-600 hover:bg-purple-700 text-white rounded-xl sm:rounded-lg text-xs sm:text-[11px] font-extrabold flex items-center justify-between transition"
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
      <div
        ref={cartSectionRef}
        className="lg:col-span-5 xl:col-span-4 bg-white rounded-2xl shadow-md border border-slate-200 flex flex-col lg:sticky lg:top-6 overflow-hidden"
      >
        <div className="p-4 bg-slate-900 text-white flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <ShoppingCart className="w-5 h-5 text-emerald-400" />
            <h2 className="font-extrabold text-base text-white">Cuenta Actual</h2>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handleInstallAppClick}
              title="Instalar como App en el celular"
              className="px-2.5 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-extrabold flex items-center gap-1 shadow-xs"
            >
              <Smartphone className="w-4 h-4" />
              <span>App</span>
            </button>
            {cart.length > 0 && (
              <button
                onClick={() => setCart([])}
                className="text-xs text-slate-300 hover:text-red-400 flex items-center gap-1 font-bold px-2 py-1.5 rounded-lg bg-slate-800"
              >
                <Trash2 className="w-3.5 h-3.5" /> Vaciar
              </button>
            )}
          </div>
        </div>

        {/* Lista de ítems en el carrito */}
        <div className="p-3.5 max-h-[420px] overflow-y-auto divide-y divide-slate-100">
          {cart.length === 0 ? (
            <div className="py-12 text-center text-slate-400">
              <ShoppingCart className="w-10 h-10 mx-auto text-slate-200 mb-2" />
              <p className="text-sm font-semibold">Tocá un producto para empezar la venta</p>
              <p className="text-xs mt-1">Podés mezclar productos por unidad, balanza y señas.</p>
            </div>
          ) : (
            cart.map((item) => (
              <div key={item.uid} className="py-3 flex items-center justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <p className="font-extrabold text-sm sm:text-xs text-slate-900 leading-snug">
                    {item.name}
                  </p>
                  {item.saleType === 'deposit' ? (
                    <div className="flex items-center gap-1 mt-1">
                      <span className="text-xs text-amber-700 font-bold">Monto seña: $</span>
                      <input
                        type="number"
                        value={item.unitPrice}
                        onChange={(e) => updateCartItemPrice(item.uid, e.target.value)}
                        className="w-24 px-2 py-1 text-sm font-bold border border-amber-300 rounded bg-amber-50"
                      />
                    </div>
                  ) : (
                    <div className="flex flex-wrap items-center gap-1.5 mt-0.5">
                      <p className="text-xs text-slate-500">
                        {item.saleType === 'kg'
                          ? `${formatARS(item.unitPrice)}/kg`
                          : `${formatARS(item.unitPrice)} c/u`}
                      </p>
                      {item.saleType === 'unit' &&
                        item.promoQty >= 2 &&
                        item.qty >= item.promoQty && (
                          <span className="text-[10px] font-black bg-purple-100 text-purple-800 px-1.5 py-0.5 rounded">
                            PROMO / MAYOR
                          </span>
                        )}
                    </div>
                  )}
                </div>

                {/* Controles + / - para ítems por unidad */}
                {item.saleType === 'unit' && (
                  <div className="flex items-center gap-1.5 bg-slate-100 rounded-xl p-1">
                    <button
                      onClick={() => updateCartItemQty(item.uid, -1)}
                      className="w-8 h-8 sm:w-6 sm:h-6 rounded-lg bg-white shadow-2xs flex items-center justify-center text-slate-700 hover:bg-slate-200 font-bold"
                    >
                      <Minus className="w-4 h-4 sm:w-3.5 sm:h-3.5" />
                    </button>
                    <span className="w-6 text-center text-sm sm:text-xs font-black">
                      {item.qty}
                    </span>
                    <button
                      onClick={() => updateCartItemQty(item.uid, 1)}
                      className="w-8 h-8 sm:w-6 sm:h-6 rounded-lg bg-white shadow-2xs flex items-center justify-center text-slate-700 hover:bg-slate-200 font-bold"
                    >
                      <Plus className="w-4 h-4 sm:w-3.5 sm:h-3.5" />
                    </button>
                  </div>
                )}

                <div className="text-right shrink-0 flex items-center gap-2">
                  <span
                    className={`font-black text-base sm:text-sm ${
                      item.subtotal < 0 ? 'text-orange-600' : 'text-slate-900'
                    }`}
                  >
                    {formatARS(item.subtotal)}
                  </span>
                  <button
                    onClick={() => removeCartItem(item.uid)}
                    title="Quitar producto de la cuenta"
                    className="p-2 sm:p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition"
                  >
                    <Trash2 className="w-5 h-5 sm:w-4 sm:h-4" />
                  </button>
                </div>
              </div>
            ))
          )}
        </div>

        {/* Total y Botones de Cobro */}
        <div className="p-4 bg-slate-50 border-t border-slate-200 space-y-3">
          <div className="flex items-baseline justify-between">
            <span className="text-sm font-bold text-slate-500 uppercase">Total a Cobrar</span>
            <span className="text-3xl font-black text-slate-900">{formatARS(cartTotal)}</span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            <button
              onClick={() => openCheckoutModal('single')}
              disabled={cart.length === 0}
              className="py-4 sm:py-3.5 px-4 bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-300 text-white font-extrabold text-base sm:text-sm rounded-xl shadow-md transition flex items-center justify-center gap-2"
            >
              <CheckCircle2 className="w-5 h-5" />
              <span>Cobrar (1 Medio)</span>
            </button>

            <button
              onClick={() => openCheckoutModal('split')}
              disabled={cart.length === 0}
              className="py-4 sm:py-3.5 px-4 bg-slate-900 hover:bg-slate-800 disabled:bg-slate-300 text-white font-extrabold text-base sm:text-sm rounded-xl shadow-md transition flex items-center justify-center gap-2"
            >
              <ArrowUpDown className="w-4 h-4 text-emerald-400" />
              <span>Pago Mixto (2)</span>
            </button>
          </div>
        </div>
      </div>

      {/* BARRA FLOTANTE INFERIOR EN CELULAR PARA COBRAR RÁPIDO */}
      {cart.length > 0 && (
        <div className="lg:hidden fixed bottom-16 inset-x-3 z-30 bg-slate-900 text-white rounded-2xl p-3 shadow-2xl border border-slate-700 flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={() =>
              cartSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
            }
            className="text-left min-w-0 flex-1"
          >
            <p className="text-[11px] text-emerald-400 font-bold uppercase">
              {cart.length} {cart.length === 1 ? 'ítem' : 'ítems'} • Ver detalle
            </p>
            <p className="text-xl font-black leading-tight">{formatARS(cartTotal)}</p>
          </button>
          <button
            type="button"
            onClick={() => openCheckoutModal('single')}
            className="px-4 py-3 bg-emerald-600 hover:bg-emerald-500 text-white font-black text-sm rounded-xl shrink-0"
          >
            COBRAR
          </button>
        </div>
      )}

      {/* ========================================== */}
      {/* MODAL DE BALANZA (POR KILO)                */}
      {/* ========================================== */}
      {scaleProduct && (
        <div className="fixed inset-0 bg-slate-950/75 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl max-w-md w-full p-6 shadow-2xl space-y-5">
            <div className="flex items-start justify-between">
              <div>
                <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-blue-100 text-blue-800 text-xs font-extrabold mb-1">
                  <Scale className="w-3.5 h-3.5" /> BALANZA POR KILO
                </span>
                <h3 className="text-xl font-black text-slate-900">{scaleProduct.name}</h3>
                <p className="text-sm font-bold text-blue-700">
                  Precio: {formatARS(scaleProduct.price)} / kg
                </p>
              </div>
              <button
                onClick={() => setScaleProduct(null)}
                className="p-2 rounded-xl bg-slate-100 text-slate-600"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="grid grid-cols-2 gap-2 bg-slate-100 p-1 rounded-xl">
              <button
                type="button"
                onClick={() => {
                  setScaleMode('grams');
                  setScaleInput('');
                }}
                className={`py-2.5 rounded-lg text-xs font-extrabold transition ${
                  scaleMode === 'grams'
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600'
                }`}
              >
                Por Peso (Gramos / Kg)
              </button>
              <button
                type="button"
                onClick={() => {
                  setScaleMode('amount');
                  setScaleInput('');
                }}
                className={`py-2.5 rounded-lg text-xs font-extrabold transition ${
                  scaleMode === 'amount'
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600'
                }`}
              >
                Por Importe ("Dame $...")
              </button>
            </div>

            {scaleMode === 'grams' && (
              <div className="grid grid-cols-4 gap-2">
                {[100, 250, 500, 1000].map((g) => (
                  <button
                    key={g}
                    type="button"
                    onClick={() => confirmScaleItem(g)}
                    className="py-3 bg-blue-50 hover:bg-blue-100 border border-blue-200 text-blue-900 rounded-xl font-extrabold text-xs"
                  >
                    {g === 1000 ? '1 Kg' : `${g}g`}
                  </button>
                ))}
              </div>
            )}

            <div>
              <label className="block text-xs font-bold text-slate-500 uppercase mb-1">
                {scaleMode === 'grams'
                  ? 'Ingresá lo que marca la balanza (ej: 350 para 350g, o 1.25 para 1,25kg)'
                  : 'Ingresá el importe pedido por el cliente ($)'}
              </label>
              <input
                type="number"
                step="any"
                inputMode="decimal"
                value={scaleInput}
                onChange={(e) => setScaleInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && confirmScaleItem()}
                placeholder={scaleMode === 'grams' ? 'Ej: 350' : 'Ej: 2000'}
                autoFocus
                className="w-full text-center text-3xl font-black py-3.5 border-2 border-blue-400 rounded-2xl focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <div className="bg-slate-900 text-white p-4 rounded-2xl flex items-center justify-between">
              <div>
                <p className="text-xs text-slate-400">
                  Peso: <strong>{scalePreview.kg.toFixed(3)} kg</strong> | Exacto:{' '}
                  {formatARS(scalePreview.exact)}
                </p>
                <p className="text-[11px] text-emerald-400 mt-0.5">
                  Redondeo automático a ${roundStep} (corte en ${roundThreshold})
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
              className="w-full py-3.5 bg-blue-600 hover:bg-blue-700 text-white font-extrabold rounded-2xl text-base shadow-lg"
            >
              Agregar al Carrito
            </button>
          </div>
        </div>
      )}

      {/* ========================================== */}
      {/* MODAL DE COBRO (SIMPLE O MIXTO 2 MEDIOS)   */}
      {/* ========================================== */}
      {checkoutOpen && (
        <div className="fixed inset-0 bg-slate-950/75 z-50 flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white rounded-3xl max-w-lg w-full p-6 shadow-2xl space-y-5 my-auto">
            <div className="flex items-center justify-between border-b pb-3">
              <div>
                <h3 className="text-xl font-black text-slate-900">Cerrar Venta</h3>
                <p className="text-sm text-slate-500">
                  Total a cobrar:{' '}
                  <strong className="text-slate-900 text-lg">{formatARS(cartTotal)}</strong>
                </p>
              </div>
              <button
                onClick={() => setCheckoutOpen(false)}
                className="p-2 rounded-xl bg-slate-100 text-slate-600"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="grid grid-cols-2 gap-2 bg-slate-100 p-1 rounded-xl">
              <button
                type="button"
                onClick={() => setPaymentMode('single')}
                className={`py-2.5 rounded-lg text-xs font-extrabold transition ${
                  paymentMode === 'single'
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600'
                }`}
              >
                1 Medio de Pago
              </button>
              <button
                type="button"
                onClick={() => {
                  setPaymentMode('split');
                  if (!amount1) setAmount1(Math.floor(cartTotal / 2).toString());
                }}
                className={`py-2.5 rounded-lg text-xs font-extrabold transition ${
                  paymentMode === 'split'
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600'
                }`}
              >
                Pago Mixto (2 Medios)
              </button>
            </div>

            {paymentMode === 'single' ? (
              <div className="space-y-4">
                <div>
                  <label className="block text-xs font-bold text-slate-500 uppercase mb-2">
                    Elegí cómo paga el cliente
                  </label>
                  <div className="grid grid-cols-2 gap-2">
                    {MEDIOS_PAGO.map((m) => (
                      <button
                        key={m}
                        type="button"
                        onClick={() => setMethod1(m)}
                        className={`py-3 px-3 rounded-xl font-bold text-sm border text-left transition ${
                          method1 === m
                            ? 'bg-emerald-600 text-white border-emerald-600 shadow-sm'
                            : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'
                        }`}
                      >
                        {m}
                      </button>
                    ))}
                  </div>
                </div>

                {method1 === 'Efectivo' && (
                  <div className="p-4 bg-slate-50 rounded-2xl border border-slate-200 space-y-2">
                    <label className="block text-xs font-bold text-slate-600 uppercase">
                      ¿Con cuánto paga? (Opcional para calcular vuelto)
                    </label>
                    <input
                      type="number"
                      value={cashTendered}
                      onChange={(e) => setCashTendered(e.target.value)}
                      placeholder={`Ej: ${Math.ceil(cartTotal / 1000) * 1000}`}
                      className="w-full px-3 py-2.5 bg-white border border-slate-300 rounded-xl text-lg font-bold"
                    />
                    {parseFloat(cashTendered) > 0 && (
                      <div className="flex justify-between items-center pt-1">
                        <span className="text-sm font-bold text-slate-600">Vuelto a entregar:</span>
                        <span className="text-xl font-black text-emerald-700">
                          {formatARS(cashChange)}
                        </span>
                      </div>
                    )}
                  </div>
                )}
              </div>
            ) : (
              <div className="space-y-4">
                <div className="p-3.5 bg-slate-50 rounded-2xl border border-slate-200 space-y-2.5">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-extrabold text-slate-600 uppercase">
                      Primer Pago
                    </span>
                    <select
                      value={method1}
                      onChange={(e) => setMethod1(e.target.value)}
                      className="px-3 py-1.5 bg-white border border-slate-300 rounded-lg text-sm font-bold"
                    >
                      {MEDIOS_PAGO.map((m) => (
                        <option key={m} value={m}>
                          {m}
                        </option>
                      ))}
                    </select>
                  </div>
                  <input
                    type="number"
                    value={amount1}
                    onChange={(e) => setAmount1(e.target.value)}
                    placeholder="Monto del primer pago $"
                    className="w-full px-3 py-2.5 bg-white border border-slate-300 rounded-xl text-xl font-black"
                  />
                </div>

                <div className="p-3.5 bg-emerald-50 rounded-2xl border border-emerald-200 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-extrabold text-emerald-800 uppercase">
                      Segundo Pago (Resto automático)
                    </span>
                    <select
                      value={method2}
                      onChange={(e) => setMethod2(e.target.value)}
                      className="px-3 py-1.5 bg-white border border-emerald-300 rounded-lg text-sm font-bold"
                    >
                      {MEDIOS_PAGO.map((m) => (
                        <option key={m} value={m}>
                          {m}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="text-2xl font-black text-emerald-900">
                    {formatARS(remainingAmount2)}
                  </div>
                </div>
              </div>
            )}

            {(method1 === 'Fiado' || (paymentMode === 'split' && method2 === 'Fiado')) && (
              <div className="p-3.5 bg-rose-50 border border-rose-200 rounded-2xl space-y-2">
                <label className="block text-xs font-extrabold text-rose-800 uppercase">
                  Seleccioná el cliente para anotar el fiado:
                </label>
                {customers.length === 0 ? (
                  <p className="text-xs text-rose-700">
                    No tenés clientes cargados todavía. Agendá uno en la pestaña "Fiados".
                  </p>
                ) : (
                  <select
                    value={selectedCustomerId}
                    onChange={(e) => setSelectedCustomerId(e.target.value)}
                    className="w-full px-3 py-2.5 bg-white border border-rose-300 rounded-xl text-sm font-bold"
                  >
                    <option value="">-- Elegir cliente --</option>
                    {customers.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name} (Saldo actual: {formatARS(c.balance || 0)})
                      </option>
                    ))}
                  </select>
                )}
              </div>
            )}

            <button
              type="button"
              disabled={isSubmittingSale}
              onClick={handleConfirmSale}
              className="w-full py-4 bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-400 text-white font-black text-base rounded-2xl shadow-lg transition"
            >
              {isSubmittingSale ? 'Guardando venta...' : `Confirmar Cobro (${formatARS(cartTotal)})`}
            </button>
          </div>
        </div>
      )}

      {/* ========================================== */}
      {/* MODAL POST-VENTA (COMPROBANTE WHATSAPP)    */}
      {/* ========================================== */}
      {lastCompletedSale && (
        <div className="fixed inset-0 bg-slate-950/75 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl max-w-sm w-full p-6 shadow-2xl text-center space-y-4">
            <div className="w-14 h-14 bg-emerald-100 text-emerald-600 rounded-full flex items-center justify-center mx-auto">
              <CheckCircle2 className="w-9 h-9" />
            </div>
            <div>
              <h3 className="text-xl font-black text-slate-900">¡Venta Registrada!</h3>
              <p className="text-2xl font-black text-emerald-600 mt-1">
                {formatARS(lastCompletedSale.total)}
              </p>
              <p className="text-xs text-slate-500 mt-1">
                {(lastCompletedSale.payments || [])
                  .map((p) => `${p.method}: ${formatARS(p.amount)}`)
                  .join(' | ')}
              </p>
            </div>

            <div className="space-y-2 pt-2">
              <a
                href={buildWhatsAppTicketUrl(
                  lastCompletedSale,
                  lastCompletedSale.customerPhone
                )}
                target="_blank"
                rel="noopener noreferrer"
                className="w-full py-3 px-4 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-sm rounded-xl flex items-center justify-center gap-2"
              >
                <MessageCircle className="w-5 h-5" />
                Enviar Comprobante por WhatsApp
              </a>
              <button
                onClick={() => setLastCompletedSale(null)}
                className="w-full py-3 px-4 bg-slate-100 hover:bg-slate-200 text-slate-800 font-bold text-sm rounded-xl"
              >
                Listo / Nueva Venta
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ========================================== */}
      {/* MODAL GUÍA PARA INSTALAR COMO APP EN CELU  */}
      {/* ========================================== */}
      {showInstallGuide && (
        <div className="fixed inset-0 bg-slate-950/75 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl max-w-md w-full p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b pb-3">
              <h3 className="text-lg font-black text-slate-900 flex items-center gap-2">
                <Smartphone className="w-5 h-5 text-emerald-600" />
                <span>Instalar como App en el Celular</span>
              </h3>
              <button
                onClick={() => setShowInstallGuide(false)}
                className="p-1.5 rounded-lg bg-slate-100 text-slate-600"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-3 text-sm text-slate-700">
              <div className="p-3.5 bg-emerald-50 border border-emerald-200 rounded-2xl space-y-1">
                <p className="font-extrabold text-emerald-950">En Android (Google Chrome):</p>
                <p className="text-xs leading-relaxed">
                  1. Tocá los <strong>3 puntitos (⋮)</strong> arriba a la derecha del navegador.
                  <br />
                  2. Elegí <strong>"Instalar aplicación"</strong> o{' '}
                  <strong>"Agregar a la pantalla principal"</strong>.
                  <br />
                  3. Confirmá y te queda el ícono directo en tu celular sin barra de navegador.
                </p>
              </div>

              <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-2xl space-y-1">
                <p className="font-extrabold text-slate-900">En iPhone (Safari):</p>
                <p className="text-xs leading-relaxed">
                  1. Tocá el botón <strong>Compartir (cuadrado con flecha hacia arriba)</strong>{' '}
                  abajo.
                  <br />
                  2. Bajá y tocá <strong>"Agregar a inicio"</strong>.
                </p>
              </div>

              <p className="text-xs text-slate-500">
                * Recordá poner el mismo <strong>Código de Almacén</strong> (
                <strong className="font-mono">{cleanStoreCode}</strong>) en tu PC y en el celular
                para que se sincronicen al instante.
              </p>
            </div>

            <button
              onClick={() => setShowInstallGuide(false)}
              className="w-full py-3 bg-slate-900 text-white font-extrabold text-sm rounded-xl"
            >
              Entendido
            </button>
          </div>
        </div>
      )}

      {/* ========================================== */}
      {/* MODAL DE ESCÁNER CON CÁMARA DEL CELULAR    */}
      {/* ========================================== */}
      {scannerOpen && (
        <div className="fixed inset-0 bg-slate-950/80 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl max-w-md w-full p-5 shadow-2xl space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-extrabold text-lg text-slate-900 flex items-center gap-2">
                <Camera className="w-5 h-5 text-emerald-600" /> Escanear Código de Barras
              </h3>
              <button
                onClick={closeCameraScanner}
                className="p-1.5 rounded-lg bg-slate-100 text-slate-600"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="relative bg-black rounded-2xl overflow-hidden aspect-video">
              <video
                ref={videoRef}
                autoPlay
                playsInline
                muted
                className="w-full h-full object-cover"
              />
              <div className="absolute inset-x-8 top-1/2 -translate-y-1/2 h-0.5 bg-red-500 shadow-lg" />
            </div>

            {scannerError && (
              <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 p-2.5 rounded-xl">
                {scannerError}
              </p>
            )}

            <form onSubmit={handleManualScanSubmit} className="flex gap-2">
              <input
                type="text"
                value={manualScanCode}
                onChange={(e) => setManualScanCode(e.target.value)}
                placeholder="O escribí el código acá..."
                className="flex-1 px-3 py-2.5 border border-slate-300 rounded-xl text-sm font-mono"
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
      )}

      {/* ========================================== */}
      {/* MODAL HISTORIAL DE TICKETS DE HOY          */}
      {/* ========================================== */}
      {showTodaySales && (
        <div className="fixed inset-0 bg-slate-950/75 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl max-w-2xl w-full p-6 shadow-2xl max-h-[85vh] flex flex-col">
            <div className="flex items-center justify-between border-b pb-3 mb-3">
              <h3 className="text-lg font-black text-slate-900">
                Ventas de Hoy ({todaySales.length})
              </h3>
              <button
                onClick={() => setShowTodaySales(false)}
                className="p-1.5 rounded-lg bg-slate-100 text-slate-600"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="overflow-y-auto divide-y divide-slate-100 flex-1">
              {todaySales.length === 0 ? (
                <p className="py-8 text-center text-sm text-slate-400">
                  Todavía no hay ventas registradas hoy.
                </p>
              ) : (
                todaySales.map((s) => (
                  <div
                    key={s.id}
                    className={`py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2 ${
                      s.status === 'voided' ? 'opacity-50 line-through' : ''
                    }`}
                  >
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-mono text-slate-400">
                          {formatTime(s.createdAt)}
                        </span>
                        <span className="font-extrabold text-slate-900">
                          {formatARS(s.total)}
                        </span>
                        <span className="text-xs bg-slate-100 px-2 py-0.5 rounded font-semibold text-slate-700">
                          {(s.payments || []).map((p) => p.method).join(' + ')}
                        </span>
                        {s.status === 'voided' && (
                          <span className="text-[10px] bg-red-100 text-red-700 font-bold px-2 py-0.5 rounded">
                            ANULADA
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-slate-500 mt-0.5">
                        {(s.items || []).map((i) => `${i.qty}x ${i.name}`).join(', ')}
                      </p>
                    </div>

                    {s.status !== 'voided' && (
                      <div className="flex items-center gap-2 shrink-0">
                        <a
                          href={buildWhatsAppTicketUrl(s, '')}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="p-2 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 rounded-lg"
                          title="Enviar por WhatsApp"
                        >
                          <MessageCircle className="w-4 h-4" />
                        </a>
                        <button
                          onClick={() => handleVoidSale(s)}
                          className="px-2.5 py-1.5 bg-red-50 text-red-700 hover:bg-red-100 rounded-lg text-xs font-bold"
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

// ============================================================================
// MÓDULO 2: PRODUCTOS, STOCK, REMARCACIÓN MASIVA, CÓDIGOS DE BARRA Y BOLETAS
// ============================================================================
function ProductsModule({
  cleanStoreCode,
  products,
  storeSettings,
  requireAdmin,
  showToast,
  setConfirmDialog,
}) {
  const [search, setSearch] = useState('');
  const [catFilter, setCatFilter] = useState('Todos');

  // Modal de Alta / Edición de producto
  const [editingProd, setEditingProd] = useState(null);
  const [formState, setFormState] = useState({
    name: '',
    category: 'Almacén',
    saleType: 'unit',
    cost: '',
    margin: '30',
    price: '',
    promoQty: '',
    promoPrice: '',
    stock: '',
    minStock: '5',
    expiryDate: '',
    code: '',
  });

  // Modal de Aumento Masivo por %
  const [bulkModalOpen, setBulkModalOpen] = useState(false);
  const [bulkCat, setBulkCat] = useState('Bebidas');
  const [bulkPercent, setBulkPercent] = useState('10');

  // Modal de Importador de Boletas / Listas de Proveedores
  const [importModalOpen, setImportModalOpen] = useState(false);
  const [importRawText, setImportRawText] = useState('');
  const [parsedImportRows, setParsedImportRows] = useState([]);
  const [importDefaultMargin, setImportDefaultMargin] = useState('30');

  // Modal de Código de Barras / Etiqueta
  const [barcodeProduct, setBarcodeProduct] = useState(null);

  const roundStep = Number(storeSettings.roundStep ?? 100);
  const roundThreshold = Number(storeSettings.roundThreshold ?? 40);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return products.filter((p) => {
      if (catFilter !== 'Todos' && p.category !== catFilter) return false;
      if (!q) return true;
      return (
        (p.name && p.name.toLowerCase().includes(q)) ||
        (p.code && p.code.toLowerCase().includes(q))
      );
    });
  }, [products, search, catFilter]);

  const openNewProductModal = () => {
    requireAdmin(() => {
      setEditingProd(null);
      setFormState({
        name: '',
        category: 'Almacén',
        saleType: 'unit',
        cost: '',
        margin: '30',
        price: '',
        promoQty: '',
        promoPrice: '',
        stock: '',
        minStock: '5',
        expiryDate: '',
        code: generateInternalBarcode(),
      });
      setEditingProd('NEW');
    });
  };

  const openEditProductModal = (prod) => {
    requireAdmin(() => {
      setFormState({
        name: prod.name || '',
        category: prod.category || 'Almacén',
        saleType: prod.saleType || 'unit',
        cost: prod.cost ?? '',
        margin: prod.margin ?? '30',
        price: prod.price ?? '',
        promoQty: prod.promoQty ?? '',
        promoPrice: prod.promoPrice ?? '',
        stock: prod.stock ?? '',
        minStock: prod.minStock ?? '5',
        expiryDate: prod.expiryDate || '',
        code: prod.code || '',
      });
      setEditingProd(prod);
    });
  };

  const handleCostOrMarginChange = (newCost, newMargin) => {
    const c = parseFloat(newCost);
    const m = parseFloat(newMargin);
    if (!isNaN(c) && c > 0 && !isNaN(m)) {
      const calculated = roundCustomARS(c * (1 + m / 100), roundStep, roundThreshold);
      setFormState((prev) => ({
        ...prev,
        cost: newCost,
        margin: newMargin,
        price: String(calculated),
      }));
    } else {
      setFormState((prev) => ({ ...prev, cost: newCost, margin: newMargin }));
    }
  };

  const handleSaveProduct = async (e) => {
    e.preventDefault();
    if (!formState.name.trim() || !formState.price) {
      showToast('Completá al menos el nombre y el precio de venta', 'error');
      return;
    }

    const payload = {
      name: formState.name.trim(),
      category: formState.category,
      saleType: formState.saleType,
      cost: Number(formState.cost) || 0,
      margin: Number(formState.margin) || 0,
      price: Number(formState.price) || 0,
      promoQty: formState.saleType === 'unit' ? Number(formState.promoQty) || 0 : 0,
      promoPrice: formState.saleType === 'unit' ? Number(formState.promoPrice) || 0 : 0,
      stock: Number(formState.stock) || 0,
      minStock: Number(formState.minStock) || 0,
      expiryDate: formState.expiryDate || '',
      code: formState.code.trim() || generateInternalBarcode(),
      isSample: false,
      updatedAt: serverTimestamp(),
    };

    try {
      if (editingProd === 'NEW') {
        await addDoc(
          collection(db, 'artifacts', appId, 'public', 'data', `products_${cleanStoreCode}`),
          { ...payload, createdAt: serverTimestamp() }
        );
        showToast('Producto agregado al catálogo');
      } else {
        await updateDoc(
          doc(
            db,
            'artifacts',
            appId,
            'public',
            'data',
            `products_${cleanStoreCode}`,
            editingProd.id
          ),
          payload
        );
        showToast('Producto actualizado');
      }
      setEditingProd(null);
    } catch (err) {
      showToast('Error al guardar producto', 'error');
    }
  };

  const handleDeleteProduct = (prod) => {
    requireAdmin(() => {
      setConfirmDialog({
        title: 'Eliminar producto',
        message: `¿Seguro que querés eliminar "${prod.name}" del catálogo?`,
        confirmText: 'Eliminar',
        onConfirm: async () => {
          try {
            await deleteDoc(
              doc(
                db,
                'artifacts',
                appId,
                'public',
                'data',
                `products_${cleanStoreCode}`,
                prod.id
              )
            );
            showToast('Producto eliminado');
          } catch {
            showToast('Error al eliminar', 'error');
          }
        },
      });
    });
  };

  // Aumento masivo por porcentaje
  const handleBulkPriceIncrease = async (e) => {
    e.preventDefault();
    const pct = parseFloat(bulkPercent);
    if (isNaN(pct) || pct === 0) {
      showToast('Ingresá un porcentaje válido', 'error');
      return;
    }

    const targets = products.filter((p) => bulkCat === 'Todos' || p.category === bulkCat);
    if (targets.length === 0) {
      showToast('No hay productos en esa categoría', 'error');
      return;
    }

    try {
      const batch = writeBatch(db);
      targets.forEach((p) => {
        const nextCost = Number(p.cost || 0) * (1 + pct / 100);
        const rawPrice = Number(p.price || 0) * (1 + pct / 100);
        const nextPrice = roundCustomARS(rawPrice, roundStep, roundThreshold);
        const ref = doc(
          db,
          'artifacts',
          appId,
          'public',
          'data',
          `products_${cleanStoreCode}`,
          p.id
        );
        batch.update(ref, {
          cost: Math.round(nextCost),
          price: nextPrice,
          updatedAt: serverTimestamp(),
        });
      });
      await batch.commit();
      setBulkModalOpen(false);
      showToast(`Se actualizaron ${targets.length} productos (+${pct}%)`);
    } catch {
      showToast('Error al actualizar precios en bloque', 'error');
    }
  };

  // Parseador de texto de boletas/listas de proveedores
  const handleParseImportText = () => {
    const lines = importRawText
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);
    const margin = parseFloat(importDefaultMargin) || 30;

    const rows = lines.map((line, idx) => {
      const parts = line.split(/[|;\t]+/).map((s) => s.trim());
      const name = parts[0] || `Producto ${idx + 1}`;
      const qty = parseFloat((parts[1] || '1').replace(',', '.')) || 1;
      const cost = parseFloat((parts[2] || '0').replace(/[^0-9.,]/g, '').replace(',', '.')) || 0;

      const existing = products.find(
        (p) => p.name.toLowerCase() === name.toLowerCase()
      );
      const effectiveMargin = existing ? Number(existing.margin || margin) : margin;
      const newSellPrice =
        cost > 0
          ? roundCustomARS(cost * (1 + effectiveMargin / 100), roundStep, roundThreshold)
          : existing
          ? existing.price
          : 0;

      return {
        id: idx,
        name,
        qty,
        cost,
        existingId: existing ? existing.id : null,
        existingStock: existing ? Number(existing.stock || 0) : 0,
        category: existing ? existing.category : 'Almacén',
        sellPrice: newSellPrice,
        selected: true,
      };
    });

    setParsedImportRows(rows);
  };

  const handleConfirmImportRows = async () => {
    const toProcess = parsedImportRows.filter((r) => r.selected && r.name.trim());
    if (toProcess.length === 0) return;

    try {
      const batch = writeBatch(db);
      const colRef = collection(
        db,
        'artifacts',
        appId,
        'public',
        'data',
        `products_${cleanStoreCode}`
      );

      toProcess.forEach((row) => {
        if (row.existingId) {
          const ref = doc(colRef, row.existingId);
          batch.update(ref, {
            stock: Number((row.existingStock + row.qty).toFixed(3)),
            cost: row.cost > 0 ? row.cost : undefined,
            price: row.sellPrice > 0 ? row.sellPrice : undefined,
            updatedAt: serverTimestamp(),
          });
        } else {
          const newRef = doc(colRef);
          batch.set(newRef, {
            name: row.name,
            category: row.category,
            saleType: 'unit',
            cost: row.cost,
            margin: Number(importDefaultMargin) || 30,
            price: row.sellPrice,
            stock: row.qty,
            minStock: 5,
            code: generateInternalBarcode(),
            isSample: false,
            createdAt: serverTimestamp(),
          });
        }
      });

      await batch.commit();
      setImportModalOpen(false);
      setImportRawText('');
      setParsedImportRows([]);
      showToast(`¡${toProcess.length} productos cargados/actualizados en stock!`);
    } catch (err) {
      console.error(err);
      showToast('Error al importar la lista', 'error');
    }
  };

  return (
    <div className="space-y-4">
      {/* Cabecera y Botones Principales */}
      <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-2xs flex flex-col lg:flex-row lg:items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-black text-slate-900">Catálogo, Precios y Stock</h2>
          <p className="text-xs text-slate-500">
            Todo cambio se sincroniza al instante entre la PC y el celular.
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            onClick={openNewProductModal}
            className="px-4 py-3 bg-emerald-600 hover:bg-emerald-700 text-white font-extrabold text-sm rounded-xl flex items-center gap-1.5 shadow-sm"
          >
            <Plus className="w-4 h-4" /> Nuevo Producto
          </button>

          <button
            onClick={() =>
              requireAdmin(() => {
                setImportRawText('');
                setParsedImportRows([]);
                setImportModalOpen(true);
              })
            }
            className="px-4 py-3 bg-blue-600 hover:bg-blue-700 text-white font-extrabold text-sm rounded-xl flex items-center gap-1.5 shadow-sm"
          >
            <Upload className="w-4 h-4" /> Importar Boleta / Lista
          </button>

          <button
            onClick={() => requireAdmin(() => setBulkModalOpen(true))}
            className="px-4 py-3 bg-slate-900 hover:bg-slate-800 text-white font-extrabold text-sm rounded-xl flex items-center gap-1.5"
          >
            <Percent className="w-4 h-4 text-amber-400" /> Aumentar por %
          </button>
        </div>
      </div>

      {/* Buscador y Filtros */}
      <div className="bg-white p-3.5 rounded-2xl border border-slate-200 flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="w-5 h-5 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar por nombre o código de barras..."
            className="w-full pl-11 pr-4 py-3 bg-slate-50 border border-slate-300 rounded-xl text-sm"
          />
        </div>
        <select
          value={catFilter}
          onChange={(e) => setCatFilter(e.target.value)}
          className="px-4 py-3 bg-slate-50 border border-slate-300 rounded-xl text-sm font-bold"
        >
          <option value="Todos">Todas las categorías ({products.length})</option>
          {CATEGORIAS.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </div>

      {/* Vista Móvil en Tarjetas Grandes */}
      <div className="grid grid-cols-1 gap-3 md:hidden">
        {filtered.map((p) => {
          const isLow = Number(p.stock) <= Number(p.minStock);
          const expDays = daysUntilDate(p.expiryDate);
          return (
            <div
              key={p.id}
              className="bg-white p-4 rounded-2xl border border-slate-200 shadow-2xs space-y-3"
            >
              <div className="flex items-start justify-between gap-2">
                <div>
                  <span className="text-[11px] font-bold uppercase text-slate-400">
                    {p.category} {p.saleType === 'kg' ? '• POR KILO' : ''}
                  </span>
                  <h3 className="font-black text-base text-slate-900">{p.name}</h3>
                  {p.promoQty >= 2 && p.promoPrice > 0 && (
                    <span className="inline-block mt-1 text-xs font-extrabold bg-purple-100 text-purple-800 px-2 py-0.5 rounded-md">
                      Pack {p.promoQty}+ un. a {formatARS(p.promoPrice)} c/u
                    </span>
                  )}
                </div>
                <div className="text-right shrink-0">
                  <p className="text-xl font-black text-emerald-700">{formatARS(p.price)}</p>
                  <p className="text-xs text-slate-400">Costo: {formatARS(p.cost)}</p>
                </div>
              </div>

              <div className="flex items-center justify-between pt-2 border-t border-slate-100">
                <div className="flex items-center gap-2">
                  <span
                    className={`px-2.5 py-1 rounded-lg text-xs font-extrabold ${
                      isLow ? 'bg-amber-100 text-amber-800' : 'bg-slate-100 text-slate-700'
                    }`}
                  >
                    Stock: {p.saleType === 'kg' ? `${p.stock} kg` : `${p.stock} un.`}
                  </span>
                  {expDays !== null && expDays <= 10 && (
                    <span className="px-2 py-1 rounded-lg text-xs font-bold bg-red-100 text-red-700">
                      Vence {formatDateShort(p.expiryDate)}
                    </span>
                  )}
                </div>

                <div className="flex items-center gap-1.5">
                  <button
                    onClick={() => setBarcodeProduct(p)}
                    className="p-2.5 bg-slate-100 text-slate-700 rounded-xl"
                    title="Código de barras"
                  >
                    <Barcode className="w-5 h-5" />
                  </button>
                  <button
                    onClick={() => openEditProductModal(p)}
                    className="p-2.5 bg-blue-50 text-blue-700 rounded-xl"
                    title="Editar"
                  >
                    <Edit3 className="w-5 h-5" />
                  </button>
                  <button
                    onClick={() => handleDeleteProduct(p)}
                    className="p-2.5 bg-red-50 text-red-600 rounded-xl"
                    title="Eliminar"
                  >
                    <Trash2 className="w-5 h-5" />
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Vista Desktop en Tabla */}
      <div className="hidden md:block bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-2xs">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-900 text-white text-xs uppercase">
                <th className="py-3.5 px-4">Producto</th>
                <th className="py-3.5 px-4">Categoría</th>
                <th className="py-3.5 px-4 text-right">Costo</th>
                <th className="py-3.5 px-4 text-right">Precio Venta</th>
                <th className="py-3.5 px-4 text-center">Stock</th>
                <th className="py-3.5 px-4 text-right">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-sm">
              {filtered.map((p) => {
                const isLow = Number(p.stock) <= Number(p.minStock);
                const expDays = daysUntilDate(p.expiryDate);
                return (
                  <tr key={p.id} className="hover:bg-slate-50">
                    <td className="py-3 px-4">
                      <p className="font-extrabold text-slate-900">{p.name}</p>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className="text-xs font-mono text-slate-400">{p.code}</span>
                        {p.saleType === 'kg' && (
                          <span className="text-[10px] font-extrabold bg-blue-100 text-blue-800 px-1.5 py-0.5 rounded">
                            POR KILO
                          </span>
                        )}
                        {p.promoQty >= 2 && p.promoPrice > 0 && (
                          <span className="text-[10px] font-extrabold bg-purple-100 text-purple-800 px-1.5 py-0.5 rounded">
                            {p.promoQty}+ un. a {formatARS(p.promoPrice)}
                          </span>
                        )}
                        {expDays !== null && expDays <= 10 && (
                          <span className="text-[10px] font-extrabold bg-red-100 text-red-700 px-1.5 py-0.5 rounded">
                            Vence {formatDateShort(p.expiryDate)}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="py-3 px-4 text-slate-600 font-medium">{p.category}</td>
                    <td className="py-3 px-4 text-right text-slate-500">{formatARS(p.cost)}</td>
                    <td className="py-3 px-4 text-right font-black text-emerald-700 text-base">
                      {formatARS(p.price)}
                    </td>
                    <td className="py-3 px-4 text-center">
                      <span
                        className={`inline-block px-2.5 py-1 rounded-lg text-xs font-extrabold ${
                          isLow ? 'bg-amber-100 text-amber-800' : 'bg-slate-100 text-slate-800'
                        }`}
                      >
                        {p.saleType === 'kg' ? `${p.stock} kg` : `${p.stock} un.`}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-right">
                      <div className="inline-flex items-center gap-1.5">
                        <button
                          onClick={() => setBarcodeProduct(p)}
                          title="Ver e imprimir código de barras"
                          className="p-2 text-slate-600 hover:bg-slate-100 rounded-lg"
                        >
                          <Barcode className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => openEditProductModal(p)}
                          title="Editar producto"
                          className="p-2 text-blue-600 hover:bg-blue-50 rounded-lg"
                        >
                          <Edit3 className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => handleDeleteProduct(p)}
                          title="Eliminar"
                          className="p-2 text-red-600 hover:bg-red-50 rounded-lg"
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

      {/* MODAL ALTA / EDICIÓN DE PRODUCTO */}
      {editingProd && (
        <div className="fixed inset-0 bg-slate-950/75 z-50 flex items-center justify-center p-4 overflow-y-auto">
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
                className="p-1.5 rounded-lg bg-slate-100 text-slate-600"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="sm:col-span-2">
                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">
                  Nombre del producto *
                </label>
                <input
                  type="text"
                  required
                  value={formState.name}
                  onChange={(e) => setFormState({ ...formState, name: e.target.value })}
                  placeholder="Ej: Yerba Playadito 1kg"
                  className="w-full px-3.5 py-2.5 border border-slate-300 rounded-xl text-sm font-bold"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">
                  Categoría
                </label>
                <select
                  value={formState.category}
                  onChange={(e) => setFormState({ ...formState, category: e.target.value })}
                  className="w-full px-3 py-2.5 border border-slate-300 rounded-xl text-sm font-bold"
                >
                  {CATEGORIAS.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">
                  Forma de venta
                </label>
                <select
                  value={formState.saleType}
                  onChange={(e) => setFormState({ ...formState, saleType: e.target.value })}
                  className="w-full px-3 py-2.5 border border-slate-300 rounded-xl text-sm font-bold"
                >
                  <option value="unit">Por Unidad / Paquete</option>
                  <option value="kg">Por Peso / Balanza (Kg)</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">
                  Costo Proveedor ($)
                </label>
                <input
                  type="number"
                  step="any"
                  value={formState.cost}
                  onChange={(e) => handleCostOrMarginChange(e.target.value, formState.margin)}
                  placeholder="Ej: 1500"
                  className="w-full px-3 py-2.5 border border-slate-300 rounded-xl text-sm"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">
                  % Ganancia
                </label>
                <input
                  type="number"
                  step="any"
                  value={formState.margin}
                  onChange={(e) => handleCostOrMarginChange(formState.cost, e.target.value)}
                  className="w-full px-3 py-2.5 border border-slate-300 rounded-xl text-sm"
                />
              </div>

              <div className="sm:col-span-2">
                <label className="block text-xs font-extrabold text-emerald-700 uppercase mb-1">
                  Precio de Venta Final ($) * (Redondeado a ${roundStep})
                </label>
                <input
                  type="number"
                  required
                  step="any"
                  value={formState.price}
                  onChange={(e) => setFormState({ ...formState, price: e.target.value })}
                  placeholder="Ej: 2000"
                  className="w-full px-3.5 py-3 border-2 border-emerald-500 rounded-xl text-xl font-black text-emerald-800"
                />
              </div>

              {formState.saleType === 'unit' && (
                <div className="sm:col-span-2 p-3 bg-purple-50 border border-purple-200 rounded-2xl grid grid-cols-2 gap-2.5">
                  <div className="col-span-2 text-xs font-extrabold text-purple-900">
                    Precio por Mayor / Pack / Promo (Opcional)
                  </div>
                  <div>
                    <label className="block text-[11px] font-bold text-purple-700 mb-1">
                      Llevando desde (cant.)
                    </label>
                    <input
                      type="number"
                      value={formState.promoQty}
                      onChange={(e) => setFormState({ ...formState, promoQty: e.target.value })}
                      placeholder="Ej: 6"
                      className="w-full px-3 py-2 bg-white border border-purple-300 rounded-lg text-sm font-bold"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-bold text-purple-700 mb-1">
                      Precio unitario promo ($)
                    </label>
                    <input
                      type="number"
                      value={formState.promoPrice}
                      onChange={(e) => setFormState({ ...formState, promoPrice: e.target.value })}
                      placeholder="Ej: 1800"
                      className="w-full px-3 py-2 bg-white border border-purple-300 rounded-lg text-sm font-bold"
                    />
                  </div>
                </div>
              )}

              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">
                  Stock Actual ({formState.saleType === 'kg' ? 'Kg' : 'Un.'})
                </label>
                <input
                  type="number"
                  step="any"
                  value={formState.stock}
                  onChange={(e) => setFormState({ ...formState, stock: e.target.value })}
                  placeholder="0"
                  className="w-full px-3 py-2.5 border border-slate-300 rounded-xl text-sm font-bold"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">
                  Stock Mínimo (Alerta)
                </label>
                <input
                  type="number"
                  step="any"
                  value={formState.minStock}
                  onChange={(e) => setFormState({ ...formState, minStock: e.target.value })}
                  className="w-full px-3 py-2.5 border border-slate-300 rounded-xl text-sm"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">
                  Próx. Vencimiento (Opc.)
                </label>
                <input
                  type="date"
                  value={formState.expiryDate}
                  onChange={(e) => setFormState({ ...formState, expiryDate: e.target.value })}
                  className="w-full px-3 py-2.5 border border-slate-300 rounded-xl text-sm"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">
                  Código de Barras
                </label>
                <div className="flex gap-1.5">
                  <input
                    type="text"
                    value={formState.code}
                    onChange={(e) => setFormState({ ...formState, code: e.target.value })}
                    className="w-full px-3 py-2.5 border border-slate-300 rounded-xl text-xs font-mono"
                  />
                  <button
                    type="button"
                    onClick={() =>
                      setFormState({ ...formState, code: generateInternalBarcode() })
                    }
                    title="Generar código nuevo"
                    className="px-2.5 bg-slate-100 hover:bg-slate-200 rounded-xl text-slate-700"
                  >
                    <QrCode className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </div>

            <button
              type="submit"
              className="w-full py-3.5 bg-emerald-600 hover:bg-emerald-700 text-white font-extrabold rounded-xl text-sm shadow-lg"
            >
              Guardar Producto
            </button>
          </form>
        </div>
      )}

      {/* MODAL AUMENTO MASIVO POR PORCENTAJE */}
      {bulkModalOpen && (
        <div className="fixed inset-0 bg-slate-950/75 z-50 flex items-center justify-center p-4">
          <form
            onSubmit={handleBulkPriceIncrease}
            className="bg-white rounded-3xl max-w-md w-full p-6 shadow-2xl space-y-4"
          >
            <div className="flex items-center justify-between border-b pb-3">
              <h3 className="text-lg font-black text-slate-900">Remarcación Masiva por %</h3>
              <button
                type="button"
                onClick={() => setBulkModalOpen(false)}
                className="p-1.5 rounded-lg bg-slate-100"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-500 uppercase mb-1">
                Categoría a actualizar
              </label>
              <select
                value={bulkCat}
                onChange={(e) => setBulkCat(e.target.value)}
                className="w-full px-3 py-2.5 border border-slate-300 rounded-xl text-sm font-bold"
              >
                <option value="Todos">Todo el almacén</option>
                {CATEGORIAS.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-500 uppercase mb-1">
                Porcentaje de aumento (%)
              </label>
              <input
                type="number"
                step="any"
                value={bulkPercent}
                onChange={(e) => setBulkPercent(e.target.value)}
                className="w-full px-3 py-2.5 border border-slate-300 rounded-xl text-xl font-black"
              />
            </div>
            <button
              type="submit"
              className="w-full py-3.5 bg-slate-900 hover:bg-slate-800 text-white font-extrabold rounded-xl"
            >
              Aplicar Aumento y Redondear
            </button>
          </form>
        </div>
      )}

      {/* MODAL IMPORTADOR DE BOLETAS / LISTAS DE PROVEEDORES */}
      {importModalOpen && (
        <div className="fixed inset-0 bg-slate-950/75 z-50 flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white rounded-3xl max-w-2xl w-full p-6 shadow-2xl space-y-4 my-auto">
            <div className="flex items-center justify-between border-b pb-3">
              <div>
                <h3 className="text-lg font-black text-slate-900">
                  Importar Boleta / Lista de Proveedor
                </h3>
                <p className="text-xs text-slate-500">
                  Pegá el listado con formato: <strong>Producto | Cantidad | Costo Unitario</strong>
                </p>
              </div>
              <button
                onClick={() => setImportModalOpen(false)}
                className="p-1.5 rounded-lg bg-slate-100"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {parsedImportRows.length === 0 ? (
              <div className="space-y-3">
                <div className="flex items-center gap-3">
                  <label className="text-xs font-bold text-slate-600">
                    % Ganancia para productos nuevos:
                  </label>
                  <input
                    type="number"
                    value={importDefaultMargin}
                    onChange={(e) => setImportDefaultMargin(e.target.value)}
                    className="w-20 px-2.5 py-1.5 border border-slate-300 rounded-lg text-sm font-bold"
                  />
                </div>
                <textarea
                  rows={6}
                  value={importRawText}
                  onChange={(e) => setImportRawText(e.target.value)}
                  placeholder={`Ejemplo:\nYerba Mate Playadito 1kg | 12 | 3200\nAceite Girasol Cocinero 900ml | 15 | 1700\nGalletitas Oreo 118g | 24 | 1100`}
                  className="w-full p-3 border border-slate-300 rounded-2xl text-sm font-mono"
                />
                <button
                  type="button"
                  onClick={handleParseImportText}
                  className="w-full py-3.5 bg-blue-600 hover:bg-blue-700 text-white font-extrabold rounded-xl"
                >
                  Procesar y Revisar Lista
                </button>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="max-h-72 overflow-y-auto border border-slate-200 rounded-xl divide-y">
                  {parsedImportRows.map((r, i) => (
                    <div key={i} className="p-3 flex items-center justify-between gap-2 text-sm">
                      <div>
                        <p className="font-bold text-slate-900">{r.name}</p>
                        <p className="text-xs text-slate-500">
                          {r.existingId
                            ? `Ya existe (Stock: ${r.existingStock} + ${r.qty})`
                            : 'Producto nuevo'}{' '}
                          • Costo: {formatARS(r.cost)}
                        </p>
                      </div>
                      <div className="text-right">
                        <span className="text-xs text-slate-400 block">Nuevo Precio Venta</span>
                        <span className="font-black text-emerald-700">
                          {formatARS(r.sellPrice)}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setParsedImportRows([])}
                    className="px-4 py-3 bg-slate-100 text-slate-700 font-bold rounded-xl text-sm"
                  >
                    Volver atrás
                  </button>
                  <button
                    type="button"
                    onClick={handleConfirmImportRows}
                    className="flex-1 py-3 bg-emerald-600 hover:bg-emerald-700 text-white font-extrabold rounded-xl text-sm"
                  >
                    Confirmar e Ingresar al Stock
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* MODAL DE CÓDIGO DE BARRAS ETIQUETA */}
      {barcodeProduct && (
        <div className="fixed inset-0 bg-slate-950/75 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl max-w-sm w-full p-6 shadow-2xl text-center space-y-4">
            <div className="flex justify-between items-center">
              <span className="text-xs font-extrabold text-slate-400 uppercase">
                Etiqueta de Góndola / Producto
              </span>
              <button
                onClick={() => setBarcodeProduct(null)}
                className="p-1.5 rounded-lg bg-slate-100"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-4 border-2 border-dashed border-slate-300 rounded-2xl bg-white space-y-2">
              <p className="font-black text-slate-900 text-base">{barcodeProduct.name}</p>
              <p className="text-3xl font-black text-emerald-700">
                {formatARS(barcodeProduct.price)}
                {barcodeProduct.saleType === 'kg' && (
                  <span className="text-sm font-bold text-slate-500"> /kg</span>
                )}
              </p>
              <BarcodeSVG code={barcodeProduct.code || '200000001'} />
            </div>

            <button
              type="button"
              onClick={() => window.print()}
              className="w-full py-3 bg-slate-900 hover:bg-slate-800 text-white font-bold rounded-xl flex items-center justify-center gap-2 text-sm"
            >
              <Printer className="w-4 h-4" /> Imprimir Etiqueta
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// MÓDULO 3: CAJA DIARIA, GASTOS Y LISTA DE FALTANTES EXPORTABLE
// ============================================================================
function CashModule({
  cleanStoreCode,
  products,
  sales,
  expenses,
  cashSession,
  showToast,
}) {
  const [openingInput, setOpeningInput] = useState('');
  const [expCategory, setExpCategory] = useState('Pago a Proveedor');
  const [expDesc, setExpDesc] = useState('');
  const [expAmount, setExpAmount] = useState('');
  const [expMethod, setExpMethod] = useState('Efectivo');

  const todayStr = getLocalDateStr();

  const todayCompletedSales = useMemo(
    () => sales.filter((s) => s.dateStr === todayStr && s.status !== 'voided'),
    [sales, todayStr]
  );

  const todayExpenses = useMemo(
    () => expenses.filter((e) => e.dateStr === todayStr),
    [expenses, todayStr]
  );

  const totals = useMemo(() => {
    let cashSales = 0;
    let transferSales = 0;
    let cardSales = 0;
    let fiadoSales = 0;
    let totalSold = 0;
    let totalCost = 0;

    todayCompletedSales.forEach((s) => {
      totalSold += Number(s.total || 0);
      totalCost += Number(s.totalCost || 0);
      (s.payments || []).forEach((p) => {
        if (p.method === 'Efectivo') cashSales += Number(p.amount || 0);
        else if (p.method === 'Transferencia / MP') transferSales += Number(p.amount || 0);
        else if (p.method === 'Débito / Crédito') cardSales += Number(p.amount || 0);
        else if (p.method === 'Fiado') fiadoSales += Number(p.amount || 0);
      });
    });

    let cashExpenses = 0;
    todayExpenses.forEach((e) => {
      if (e.method === 'Efectivo') cashExpenses += Number(e.amount || 0);
    });

    const opening = Number(cashSession?.openingCash || 0);
    const expectedDrawerCash = opening + cashSales - cashExpenses;
    const estimatedProfit = totalSold - totalCost;

    return {
      opening,
      cashSales,
      transferSales,
      cardSales,
      fiadoSales,
      totalSold,
      cashExpenses,
      expectedDrawerCash,
      estimatedProfit,
    };
  }, [todayCompletedSales, todayExpenses, cashSession]);

  const lowStockProducts = useMemo(
    () => products.filter((p) => Number(p.stock || 0) <= Number(p.minStock || 0)),
    [products]
  );

  const expiringProducts = useMemo(
    () =>
      products.filter((p) => {
        const d = daysUntilDate(p.expiryDate);
        return d !== null && d <= 10;
      }),
    [products]
  );

  const handleOpenCash = async (e) => {
    e.preventDefault();
    const amount = parseFloat(openingInput) || 0;
    try {
      await setDoc(
        doc(db, 'artifacts', appId, 'public', 'data', `cash_${cleanStoreCode}`, todayStr),
        {
          openingCash: amount,
          dateStr: todayStr,
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );
      setOpeningInput('');
      showToast(`Caja inicial registrada: ${formatARS(amount)}`);
    } catch {
      showToast('Error al guardar caja inicial', 'error');
    }
  };

  const handleAddExpense = async (e) => {
    e.preventDefault();
    const amount = parseFloat(expAmount);
    if (!amount || amount <= 0) {
      showToast('Ingresá un monto válido', 'error');
      return;
    }
    try {
      await addDoc(
        collection(db, 'artifacts', appId, 'public', 'data', `expenses_${cleanStoreCode}`),
        {
          category: expCategory,
          description: expDesc.trim() || expCategory,
          amount,
          method: expMethod,
          dateStr: todayStr,
          createdAt: serverTimestamp(),
        }
      );
      setExpDesc('');
      setExpAmount('');
      showToast('Salida registrada en caja');
    } catch {
      showToast('Error al registrar salida', 'error');
    }
  };

  // Exportar faltantes: WhatsApp, Copiar y CSV/Excel
  const buildMissingListText = () => {
    const lines = [
      `*LISTA DE COMPRAS / FALTANTES (${formatDateShort(todayStr)})*`,
      `------------------------`,
      ...lowStockProducts.map((p) => {
        const suggested = Math.max(1, Math.ceil(Number(p.minStock || 5) * 2 - Number(p.stock || 0)));
        return `• [${p.category}] ${p.name} — Quedan: ${p.stock} (Pedir aprox: ${suggested})`;
      }),
    ];
    return lines.join('\n');
  };

  const handleCopyMissing = async () => {
    try {
      await navigator.clipboard.writeText(buildMissingListText());
      showToast('Lista de faltantes copiada al portapapeles');
    } catch {
      showToast('No se pudo copiar', 'error');
    }
  };

  const handleDownloadMissingCSV = () => {
    const header = 'Categoria;Producto;Stock Actual;Stock Minimo;Pedido Sugerido;Ultimo Costo\n';
    const rows = lowStockProducts
      .map((p) => {
        const suggested = Math.max(1, Math.ceil(Number(p.minStock || 5) * 2 - Number(p.stock || 0)));
        return `${p.category};${p.name};${p.stock};${p.minStock};${suggested};${p.cost || 0}`;
      })
      .join('\n');
    const blob = new Blob([header + rows], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `faltantes_${todayStr}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-5">
      {/* Tarjetas Resumen de Caja */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="bg-slate-900 text-white p-4 rounded-2xl shadow-sm">
          <p className="text-xs font-bold text-emerald-400 uppercase">Efectivo Esperado en Cajón</p>
          <p className="text-3xl font-black mt-1">{formatARS(totals.expectedDrawerCash)}</p>
          <p className="text-xs text-slate-400 mt-1">
            Inicio {formatARS(totals.opening)} + Ventas {formatARS(totals.cashSales)} - Salidas{' '}
            {formatARS(totals.cashExpenses)}
          </p>
        </div>

        <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-2xs">
          <p className="text-xs font-bold text-blue-600 uppercase">Transferencia / Mercado Pago</p>
          <p className="text-2xl font-black text-slate-900 mt-1">
            {formatARS(totals.transferSales)}
          </p>
          <p className="text-xs text-slate-400 mt-1">Tarjetas: {formatARS(totals.cardSales)}</p>
        </div>

        <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-2xs">
          <p className="text-xs font-bold text-emerald-600 uppercase">Total Vendido Hoy</p>
          <p className="text-2xl font-black text-slate-900 mt-1">{formatARS(totals.totalSold)}</p>
          <p className="text-xs text-slate-400 mt-1">
            Fiado hoy: {formatARS(totals.fiadoSales)}
          </p>
        </div>

        <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-2xs">
          <p className="text-xs font-bold text-purple-600 uppercase">Ganancia Estimada Hoy</p>
          <p className="text-2xl font-black text-emerald-700 mt-1">
            {formatARS(totals.estimatedProfit)}
          </p>
          <p className="text-xs text-slate-400 mt-1">Según costos cargados</p>
        </div>
      </div>

      {/* Apertura de Caja y Registro de Salidas */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-white p-5 rounded-2xl border border-slate-200 space-y-4">
          <h3 className="font-black text-base text-slate-900 flex items-center gap-2">
            <DollarSign className="w-5 h-5 text-emerald-600" /> Cambio Inicial de Caja
          </h3>
          <form onSubmit={handleOpenCash} className="flex gap-2">
            <input
              type="number"
              value={openingInput}
              onChange={(e) => setOpeningInput(e.target.value)}
              placeholder={`Actual: ${formatARS(totals.opening)}`}
              className="flex-1 px-3.5 py-2.5 border border-slate-300 rounded-xl text-sm font-bold"
            />
            <button
              type="submit"
              className="px-4 py-2.5 bg-slate-900 text-white font-bold text-sm rounded-xl"
            >
              Guardar Inicio
            </button>
          </form>

          <hr className="border-slate-100" />

          <h3 className="font-black text-base text-slate-900">
            Anotar Salida (Proveedor / Gasto / Retiro)
          </h3>
          <form onSubmit={handleAddExpense} className="space-y-3">
            <div className="grid grid-cols-2 gap-2">
              <select
                value={expCategory}
                onChange={(e) => setExpCategory(e.target.value)}
                className="px-3 py-2.5 border border-slate-300 rounded-xl text-sm font-bold"
              >
                <option value="Pago a Proveedor">Pago a Proveedor</option>
                <option value="Gasto del Local">Gasto del Local</option>
                <option value="Retiro Personal">Retiro Personal</option>
              </select>
              <select
                value={expMethod}
                onChange={(e) => setExpMethod(e.target.value)}
                className="px-3 py-2.5 border border-slate-300 rounded-xl text-sm font-bold"
              >
                <option value="Efectivo">Efectivo (Cajón)</option>
                <option value="Transferencia / MP">Transferencia / MP</option>
              </select>
            </div>
            <div className="flex gap-2">
              <input
                type="text"
                value={expDesc}
                onChange={(e) => setExpDesc(e.target.value)}
                placeholder="Detalle (ej: Sodero, Bolsas...)"
                className="flex-1 px-3 py-2.5 border border-slate-300 rounded-xl text-sm"
              />
              <input
                type="number"
                value={expAmount}
                onChange={(e) => setExpAmount(e.target.value)}
                placeholder="Monto $"
                className="w-32 px-3 py-2.5 border border-slate-300 rounded-xl text-sm font-bold"
              />
            </div>
            <button
              type="submit"
              className="w-full py-3 bg-rose-600 hover:bg-rose-700 text-white font-extrabold text-sm rounded-xl"
            >
              Registrar Salida
            </button>
          </form>

          {todayExpenses.length > 0 && (
            <div className="pt-2 divide-y divide-slate-100 max-h-48 overflow-y-auto">
              {todayExpenses.map((e) => (
                <div key={e.id} className="py-2 flex justify-between text-xs">
                  <span>
                    <strong>{e.category}:</strong> {e.description} ({e.method})
                  </span>
                  <span className="font-bold text-rose-600">-{formatARS(e.amount)}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Lista de Compras (Faltantes) y Vencimientos */}
        <div className="bg-white p-5 rounded-2xl border border-slate-200 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="font-black text-base text-slate-900 flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-amber-500" />
              <span>Lista de Compras / Faltantes ({lowStockProducts.length})</span>
            </h3>

            {lowStockProducts.length > 0 && (
              <div className="flex items-center gap-1.5">
                <a
                  href={`https://wa.me/?text=${encodeURIComponent(buildMissingListText())}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="px-2.5 py-1.5 bg-emerald-600 text-white rounded-lg text-xs font-bold flex items-center gap-1"
                >
                  <MessageCircle className="w-3.5 h-3.5" /> WhatsApp
                </a>
                <button
                  type="button"
                  onClick={handleCopyMissing}
                  className="px-2.5 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-800 rounded-lg text-xs font-bold flex items-center gap-1"
                >
                  <Copy className="w-3.5 h-3.5" /> Copiar
                </button>
                <button
                  type="button"
                  onClick={handleDownloadMissingCSV}
                  className="px-2.5 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-800 rounded-lg text-xs font-bold flex items-center gap-1"
                >
                  <Download className="w-3.5 h-3.5" /> Excel
                </button>
              </div>
            )}
          </div>

          {lowStockProducts.length === 0 ? (
            <p className="text-sm text-slate-400 py-4">
              No tenés productos por debajo del stock mínimo.
            </p>
          ) : (
            <div className="divide-y divide-slate-100 max-h-56 overflow-y-auto">
              {lowStockProducts.map((p) => (
                <div key={p.id} className="py-2.5 flex items-center justify-between text-sm">
                  <div>
                    <p className="font-bold text-slate-900">{p.name}</p>
                    <p className="text-xs text-slate-400">{p.category}</p>
                  </div>
                  <span className="px-2.5 py-1 bg-amber-100 text-amber-900 font-extrabold text-xs rounded-lg">
                    Quedan: {p.stock} (Mín: {p.minStock})
                  </span>
                </div>
              ))}
            </div>
          )}

          {expiringProducts.length > 0 && (
            <div className="pt-3 border-t border-slate-100 space-y-2">
              <h4 className="font-extrabold text-sm text-red-700 flex items-center gap-1.5">
                <Calendar className="w-4 h-4" /> Próximos a Vencer ({expiringProducts.length})
              </h4>
              {expiringProducts.map((p) => (
                <div
                  key={p.id}
                  className="p-2.5 bg-red-50 rounded-xl flex justify-between items-center text-xs"
                >
                  <span className="font-bold text-red-950">{p.name}</span>
                  <span className="font-extrabold text-red-700">
                    Vence: {formatDateShort(p.expiryDate)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// MÓDULO 4: CLIENTES Y LIBRETA DE FIADOS DIGITAL
// ============================================================================
function FiadosModule({ cleanStoreCode, customers, fiados, showToast }) {
  const [newName, setNewName] = useState('');
  const [newPhone, setNewPhone] = useState('');
  const [newNote, setNewNote] = useState('');
  const [selectedCustId, setSelectedCustId] = useState(null);
  const [payAmount, setPayAmount] = useState('');
  const [payMethod, setPayMethod] = useState('Efectivo');

  const selectedCustomer = useMemo(
    () => customers.find((c) => c.id === selectedCustId) || null,
    [customers, selectedCustId]
  );

  const customerEntries = useMemo(
    () => fiados.filter((f) => f.customerId === selectedCustId),
    [fiados, selectedCustId]
  );

  const handleImportContactFromPhone = async () => {
    try {
      if ('contacts' in navigator && 'select' in navigator.contacts) {
        const contacts = await navigator.contacts.select(['name', 'tel'], { multiple: false });
        if (contacts && contacts.length > 0) {
          const c = contacts[0];
          if (c.name && c.name[0]) setNewName(c.name[0]);
          if (c.tel && c.tel[0]) setNewPhone(c.tel[0]);
          showToast('Contacto importado desde tu teléfono');
        }
      } else {
        showToast('Tu navegador no permite abrir la agenda directa; pegá el número abajo.', 'error');
      }
    } catch {
      showToast('No se pudo importar el contacto', 'error');
    }
  };

  const handleAddCustomer = async (e) => {
    e.preventDefault();
    if (!newName.trim()) {
      showToast('Ingresá el nombre del cliente', 'error');
      return;
    }
    try {
      await addDoc(
        collection(db, 'artifacts', appId, 'public', 'data', `customers_${cleanStoreCode}`),
        {
          name: newName.trim(),
          phone: newPhone.trim(),
          note: newNote.trim(),
          balance: 0,
          createdAt: serverTimestamp(),
        }
      );
      setNewName('');
      setNewPhone('');
      setNewNote('');
      showToast('Cliente agendado');
    } catch {
      showToast('Error al agendar cliente', 'error');
    }
  };

  const handleRegisterPayment = async (e) => {
    e.preventDefault();
    if (!selectedCustomer) return;
    const amount = parseFloat(payAmount);
    if (!amount || amount <= 0) {
      showToast('Ingresá un monto válido', 'error');
      return;
    }

    try {
      await addDoc(
        collection(db, 'artifacts', appId, 'public', 'data', `fiados_${cleanStoreCode}`),
        {
          customerId: selectedCustomer.id,
          customerName: selectedCustomer.name,
          type: 'payment',
          amount,
          description: `Entrega (${payMethod})`,
          dateStr: getLocalDateStr(),
          createdAt: serverTimestamp(),
        }
      );

      const nextBalance = Math.max(0, Number(selectedCustomer.balance || 0) - amount);
      await updateDoc(
        doc(
          db,
          'artifacts',
          appId,
          'public',
          'data',
          `customers_${cleanStoreCode}`,
          selectedCustomer.id
        ),
        { balance: nextBalance }
      );

      setPayAmount('');
      showToast(`Entrega de ${formatARS(amount)} registrada`);
    } catch {
      showToast('Error al registrar entrega', 'error');
    }
  };

  const totalPendingAll = useMemo(
    () => customers.reduce((acc, c) => acc + Number(c.balance || 0), 0),
    [customers]
  );

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
      {/* Columna Izquierda: Agenda de Clientes */}
      <div className="lg:col-span-5 space-y-4">
        <div className="bg-white p-4 rounded-2xl border border-slate-200 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-black text-slate-900">Agendar Cliente</h2>
            <button
              type="button"
              onClick={handleImportContactFromPhone}
              className="px-3 py-1.5 bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border border-emerald-200 rounded-xl text-xs font-extrabold flex items-center gap-1.5"
            >
              <Contact className="w-4 h-4" /> Desde Contactos
            </button>
          </div>

          <form onSubmit={handleAddCustomer} className="space-y-2.5">
            <input
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Nombre completo *"
              className="w-full px-3.5 py-2.5 border border-slate-300 rounded-xl text-sm font-bold"
            />
            <div className="grid grid-cols-2 gap-2">
              <input
                type="tel"
                value={newPhone}
                onChange={(e) => setNewPhone(e.target.value)}
                placeholder="WhatsApp (ej: 1123456789)"
                className="w-full px-3 py-2.5 border border-slate-300 rounded-xl text-sm"
              />
              <input
                type="text"
                value={newNote}
                onChange={(e) => setNewNote(e.target.value)}
                placeholder="Referencia (ej: Esquina)"
                className="w-full px-3 py-2.5 border border-slate-300 rounded-xl text-sm"
              />
            </div>
            <button
              type="submit"
              className="w-full py-3 bg-slate-900 hover:bg-slate-800 text-white font-extrabold text-sm rounded-xl"
            >
              Guardar Cliente
            </button>
          </form>
        </div>

        <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
          <div className="p-3.5 bg-slate-50 border-b border-slate-200 flex justify-between items-center">
            <span className="text-xs font-extrabold text-slate-600 uppercase">
              Clientes ({customers.length})
            </span>
            <span className="text-xs font-extrabold text-rose-600">
              Total en calle: {formatARS(totalPendingAll)}
            </span>
          </div>
          <div className="divide-y divide-slate-100 max-h-[420px] overflow-y-auto">
            {customers.length === 0 ? (
              <p className="p-6 text-center text-sm text-slate-400">
                Todavía no agendaste ningún cliente.
              </p>
            ) : (
              customers.map((c) => (
                <button
                  key={c.id}
                  onClick={() => setSelectedCustId(c.id)}
                  className={`w-full p-4 text-left flex items-center justify-between transition ${
                    selectedCustId === c.id ? 'bg-emerald-50' : 'hover:bg-slate-50'
                  }`}
                >
                  <div>
                    <p className="font-extrabold text-slate-900 text-sm">{c.name}</p>
                    <p className="text-xs text-slate-400">
                      {c.phone || 'Sin teléfono'} {c.note ? `• ${c.note}` : ''}
                    </p>
                  </div>
                  <span
                    className={`font-black text-base ${
                      Number(c.balance) > 0 ? 'text-rose-600' : 'text-emerald-600'
                    }`}
                  >
                    {formatARS(c.balance || 0)}
                  </span>
                </button>
              ))
            )}
          </div>
        </div>
      </div>

      {/* Columna Derecha: Cuenta Corriente del Cliente Seleccionado */}
      <div className="lg:col-span-7 bg-white rounded-2xl border border-slate-200 p-5 min-h-[360px]">
        {!selectedCustomer ? (
          <div className="h-72 flex flex-col items-center justify-center text-center text-slate-400">
            <Users className="w-12 h-12 text-slate-200 mb-2" />
            <p className="font-bold text-sm">Seleccioná un cliente de la lista</p>
            <p className="text-xs mt-1">
              Vas a ver su historial de compras fiadas, registrar entregas y mandarle el saldo por
              WhatsApp.
            </p>
          </div>
        ) : (
          <div className="space-y-5">
            <div className="flex flex-wrap items-start justify-between gap-3 border-b pb-4">
              <div>
                <h3 className="text-xl font-black text-slate-900">{selectedCustomer.name}</h3>
                <p className="text-xs text-slate-500">
                  {selectedCustomer.phone || 'Sin WhatsApp'} • {selectedCustomer.note}
                </p>
              </div>
              <div className="text-right">
                <span className="text-xs font-bold text-slate-400 uppercase block">
                  Deuda Actual
                </span>
                <span className="text-3xl font-black text-rose-600">
                  {formatARS(selectedCustomer.balance || 0)}
                </span>
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              <a
                href={buildWhatsAppFiadoUrl(selectedCustomer, customerEntries)}
                target="_blank"
                rel="noopener noreferrer"
                className="px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-extrabold text-xs rounded-xl flex items-center gap-1.5"
              >
                <MessageCircle className="w-4 h-4" /> Enviar Resumen por WhatsApp
              </a>
            </div>

            <form
              onSubmit={handleRegisterPayment}
              className="p-3.5 bg-slate-50 rounded-2xl border border-slate-200 flex flex-col sm:flex-row gap-2"
            >
              <input
                type="number"
                value={payAmount}
                onChange={(e) => setPayAmount(e.target.value)}
                placeholder="Monto que entrega $"
                className="flex-1 px-3 py-2.5 bg-white border border-slate-300 rounded-xl text-sm font-bold"
              />
              <select
                value={payMethod}
                onChange={(e) => setPayMethod(e.target.value)}
                className="px-3 py-2.5 bg-white border border-slate-300 rounded-xl text-sm font-bold"
              >
                <option value="Efectivo">Efectivo</option>
                <option value="Transferencia / MP">Transferencia / MP</option>
              </select>
              <button
                type="submit"
                className="px-4 py-2.5 bg-slate-900 hover:bg-slate-800 text-white font-extrabold text-sm rounded-xl"
              >
                Anotar Entrega
              </button>
            </form>

            <div className="space-y-2">
              <h4 className="text-xs font-extrabold text-slate-500 uppercase">
                Movimientos de la Cuenta
              </h4>
              <div className="divide-y divide-slate-100 max-h-72 overflow-y-auto">
                {customerEntries.length === 0 ? (
                  <p className="py-6 text-center text-xs text-slate-400">
                    Sin movimientos registrados todavía.
                  </p>
                ) : (
                  customerEntries.map((entry) => (
                    <div key={entry.id} className="py-2.5 flex items-center justify-between text-sm">
                      <div>
                        <p className="font-bold text-slate-800">{entry.description}</p>
                        <p className="text-xs text-slate-400">
                          {formatDateShort(entry.dateStr)} {formatTime(entry.createdAt)}
                        </p>
                      </div>
                      <span
                        className={`font-black ${
                          entry.type === 'payment' ? 'text-emerald-600' : 'text-rose-600'
                        }`}
                      >
                        {entry.type === 'payment' ? '-' : '+'}
                        {formatARS(entry.amount)}
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
  );
}

// ============================================================================
// MODAL DE VINCULACIÓN PC + CELULAR Y CONFIGURACIÓN DEL ALMACÉN
// ============================================================================
function StoreSettingsModal({
  cleanStoreCode,
  storeCodeInput,
  setStoreCodeInput,
  storeSettings,
  onClose,
  onSaveStoreCode,
  onSaveSettings,
}) {
  const [name, setName] = useState(storeSettings.storeName || 'Mi Almacén');
  const [pin, setPin] = useState(storeSettings.adminPin || '1234');
  const [deposit, setDeposit] = useState(String(storeSettings.defaultDeposit ?? 2000));
  const [step, setStep] = useState(String(storeSettings.roundStep ?? 100));
  const [threshold, setThreshold] = useState(String(storeSettings.roundThreshold ?? 40));

  return (
    <div className="fixed inset-0 bg-slate-950/75 z-50 flex items-center justify-center p-4 overflow-y-auto">
      <div className="bg-white rounded-3xl max-w-md w-full p-6 shadow-2xl space-y-5 my-auto">
        <div className="flex items-center justify-between border-b pb-3">
          <h3 className="text-lg font-black text-slate-900">Sincronización y Ajustes</h3>
          <button onClick={onClose} className="p-1.5 rounded-lg bg-slate-100">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Código de Almacén para vincular PC + Celular */}
        <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-2xl space-y-2.5">
          <p className="text-xs font-extrabold text-emerald-950 uppercase">
            Código de Sincronización (PC + Celular)
          </p>
          <p className="text-xs text-emerald-800">
            Poné exactamente este mismo código en tu computadora y en tu celular para que trabajen
            conectados en vivo:
          </p>
          <div className="flex gap-2">
            <input
              type="text"
              value={storeCodeInput}
              onChange={(e) => setStoreCodeInput(e.target.value.toUpperCase())}
              className="flex-1 px-3 py-2 bg-white border border-emerald-300 rounded-xl font-mono font-black text-sm uppercase"
            />
            <button
              type="button"
              onClick={() => onSaveStoreCode(storeCodeInput)}
              className="px-4 py-2 bg-emerald-600 text-white font-bold text-xs rounded-xl"
            >
              Conectar
            </button>
          </div>
          <p className="text-[11px] text-emerald-700">
            Conectado actualmente a: <strong className="font-mono">{cleanStoreCode}</strong>
          </p>
        </div>

        {/* Ajustes del Comercio */}
        <div className="space-y-3">
          <div>
            <label className="block text-xs font-bold text-slate-500 uppercase mb-1">
              Nombre del Almacén
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm font-bold"
            />
          </div>

          <div className="grid grid-cols-2 gap-2.5">
            <div>
              <label className="block text-xs font-bold text-slate-500 uppercase mb-1">
                PIN Administrador
              </label>
              <input
                type="text"
                maxLength={6}
                value={pin}
                onChange={(e) => setPin(e.target.value)}
                className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm font-mono font-bold"
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-500 uppercase mb-1">
                Seña Envase ($)
              </label>
              <input
                type="number"
                value={deposit}
                onChange={(e) => setDeposit(e.target.value)}
                className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm font-bold"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2.5">
            <div>
              <label className="block text-xs font-bold text-slate-500 uppercase mb-1">
                Redondear a ($)
              </label>
              <input
                type="number"
                value={step}
                onChange={(e) => setStep(e.target.value)}
                className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm font-bold"
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-500 uppercase mb-1">
                Bajar si pasa hasta ($)
              </label>
              <input
                type="number"
                value={threshold}
                onChange={(e) => setThreshold(e.target.value)}
                className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm font-bold"
              />
            </div>
          </div>

          <button
            type="button"
            onClick={() =>
              onSaveSettings({
                storeName: name.trim() || 'Mi Almacén',
                adminPin: pin.trim() || '1234',
                defaultDeposit: Number(deposit) || 2000,
                roundStep: Number(step) || 100,
                roundThreshold: Number(threshold) || 40,
              })
            }
            className="w-full py-3 bg-slate-900 hover:bg-slate-800 text-white font-extrabold text-sm rounded-xl"
          >
            Guardar Ajustes
          </button>
        </div>
      </div>
    </div>
  );
}