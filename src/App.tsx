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

  // Identificador de esta máquina / cajero (independiente por dispositivo, stock compartido)
  const [cashierName, setCashierName] = useState(() => {
    const saved = localStorage.getItem('almacen_cashier_name');
    if (saved) return saved;
    const isTouchOrSmall =
      typeof window !== 'undefined' &&
      (('ontouchstart' in window) || window.innerWidth < 768);
    const defaultName = isTouchOrSmall ? 'Caja Móvil' : 'Caja Mostrador';
    localStorage.setItem('almacen_cashier_name', defaultName);
    return defaultName;
  });

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
    const sharedCustomers = JSON.stringify(customers);
    localStorage.setItem(`local_customers_${cleanStoreCode}`, sharedCustomers);
    localStorage.setItem(`shared_customers_${cleanStoreCode}`, sharedCustomers);
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
    const sharedFiados = JSON.stringify(fiados);
    localStorage.setItem(`local_fiados_${cleanStoreCode}`, sharedFiados);
    localStorage.setItem(`shared_fiados_${cleanStoreCode}`, sharedFiados);
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
        const linkedCustomers = JSON.parse(
          localStorage.getItem(`shared_customers_${cleanStoreCode}`) ||
            localStorage.getItem(`local_customers_${cleanStoreCode}`) ||
            '[]'
        );
        const linkedFiados = JSON.parse(
          localStorage.getItem(`shared_fiados_${cleanStoreCode}`) ||
            localStorage.getItem(`local_fiados_${cleanStoreCode}`) ||
            '[]'
        );
        setCustomers(linkedCustomers);
        setSales(JSON.parse(localStorage.getItem(`local_sales_${cleanStoreCode}`) || '[]'));
        setExpenses(JSON.parse(localStorage.getItem(`local_expenses_${cleanStoreCode}`) || '[]'));
        setFiados(linkedFiados);
        const savedSettings = JSON.parse(
          localStorage.getItem(`local_settings_${cleanStoreCode}`) || 'null'
        );
        if (savedSettings) setStoreSettings((prev) => ({ ...prev, ...savedSettings }));
        const savedCash = JSON.parse(
          localStorage.getItem(
            `local_cash_${cleanStoreCode}_${getLocalDateStr()}_${cashierName}`
          ) ||
            localStorage.getItem(`local_cash_${cleanStoreCode}_${getLocalDateStr()}`) ||
            'null'
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
    const cleanCashierKey =
      (cashierName || 'GENERAL').trim().toUpperCase().replace(/[^A-Z0-9_-]/g, '_') ||
      'GENERAL';

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
      doc(db, ...basePublicPath, `cash_${cleanStoreCode}`, `${todayStr}_${cleanCashierKey}`),
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
  }, [user, cleanStoreCode, cashierName]);

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
          if (!hasCloudConfig || !db) {
            const demoProducts = [
              {
                id: 'demo_1',
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
                id: 'demo_2',
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
                id: 'demo_3',
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
                id: 'demo_4',
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
            ];
            setProducts(demoProducts);
            setLoadingData(false);
            return;
          }

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
          if (!hasCloudConfig || !db) {
            setProducts((prev) => prev.filter((p) => !p.isSample));
            showToast('Ejemplos eliminados. ¡Listo para cargar tu catálogo!');
            return;
          }
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
            cleanStoreCode={cleanStoreCode}
            cashierName={cashierName}
            products={products}
            setProducts={setProducts}
            customers={customers}
            setCustomers={setCustomers}
            sales={sales}
            setSales={setSales}
            fiados={fiados}
            setFiados={setFiados}
            storeSettings={storeSettings}
            requireAdmin={requireAdmin}
            showToast={showToast}
            setConfirmDialog={setConfirmDialog}
          />
        )}

        {activeTab === 'products' && (
          <ProductsModule
            cleanStoreCode={cleanStoreCode}
            products={products}
            setProducts={setProducts}
            storeSettings={storeSettings}
            requireAdmin={requireAdmin}
            showToast={showToast}
            setConfirmDialog={setConfirmDialog}
          />
        )}

        {activeTab === 'cash' && (
          <CashModule
            cleanStoreCode={cleanStoreCode}
            cashierName={cashierName}
            products={products}
            sales={sales}
            expenses={expenses}
            setExpenses={setExpenses}
            cashSession={cashSession}
            setCashSession={setCashSession}
            requireAdmin={requireAdmin}
            showToast={showToast}
          />
        )}

        {activeTab === 'fiados' && (
          <FiadosModule
            cleanStoreCode={cleanStoreCode}
            customers={customers}
            setCustomers={setCustomers}
            fiados={fiados}
            setFiados={setFiados}
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
          cashierName={cashierName}
          storeCodeInput={storeCodeInput}
          setStoreCodeInput={setStoreCodeInput}
          storeSettings={storeSettings}
          onClose={() => setShowStoreLinkModal(false)}
          onSaveStoreCode={(newCode, newCashier) => {
            const clean = newCode.trim().toUpperCase().replace(/[^A-Z0-9_-]/g, '');
            const cleanCash = (newCashier || cashierName).trim() || 'Caja General';
            localStorage.setItem('almacen_cashier_name', cleanCash);
            setCashierName(cleanCash);
            if (clean) {
              localStorage.setItem('almacen_store_code', clean);
              setStoreCode(clean);
            }
            setShowStoreLinkModal(false);
            showToast(`Conectado a ${clean || cleanStoreCode} • Cajero: ${cleanCash}`);
          }}
          onSaveSettings={async (updated) => {
            try {
              setStoreSettings((prev) => ({ ...prev, ...updated }));
              if (hasCloudConfig && db) {
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
              }
              showToast('Configuración guardada');
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
  cleanStoreCode,
  cashierName,
  products,
  setProducts,
  customers,
  setCustomers,
  sales,
  setSales,
  fiados,
  setFiados,
  storeSettings,
  requireAdmin,
  showToast,
  setConfirmDialog,
}) {
  const [search, setSearch] = useState('');
  const [catFilter, setCatFilter] = useState('Todos');
  const [cart, setCart] = useState([]);

  // Modal balanza / gramos / pesos
  const [weighingProduct, setWeighingProduct] = useState(null);
  const [gramsInput, setGramsInput] = useState('');
  const [amountInput, setAmountInput] = useState('');

  // Venta suelta
  const [looseModalOpen, setLooseModalOpen] = useState(false);
  const [looseDesc, setLooseDesc] = useState('Venta Suelta');
  const [looseAmount, setLooseAmount] = useState('');

  // Escáner de cámara en celular
  const [scannerOpen, setScannerOpen] = useState(false);
  const [manualScanCode, setManualScanCode] = useState('');
  const videoRef = useRef(null);

  // Tickets del día
  const [showTodaySales, setShowTodaySales] = useState(false);

  // Cobro (1 medio o mixto 2 medios)
  const [checkoutMode, setCheckoutMode] = useState(null); // null | 'single' | 'mixed'
  const [singleMethod, setSingleMethod] = useState('Efectivo');
  const [cashReceived, setCashReceived] = useState('');
  const [selectedFiadoCustomerId, setSelectedFiadoCustomerId] = useState('');

  const [mixMethod1, setMixMethod1] = useState('Efectivo');
  const [mixAmount1, setMixAmount1] = useState('');
  const [mixMethod2, setMixMethod2] = useState('Transferencia / MP');
  const [mixFiadoCustomerId, setMixFiadoCustomerId] = useState('');

  const cartSectionRef = useRef(null);
  const searchInputRef = useRef(null);
  const globalScanBufferRef = useRef('');
  const globalScanTimerRef = useRef(null);

  const roundStep = Number(storeSettings.roundStep ?? 100);
  const roundThreshold = Number(storeSettings.roundThreshold ?? 40);
  const defaultDeposit = Number(storeSettings.defaultDeposit ?? 2000);

  const getUnitPriceForItem = (item) => {
    if (item.saleType === 'kg') return Number(item.price || 0);
    if (
      Number(item.promoQty) >= 2 &&
      Number(item.promoPrice) > 0 &&
      Number(item.qty) >= Number(item.promoQty)
    ) {
      return Number(item.promoPrice);
    }
    return Number(item.price || 0);
  };

  const cartWithSubtotals = useMemo(
    () =>
      cart.map((item) => {
        if (item.saleType === 'special_raw') {
          return {
            ...item,
            effectiveUnitPrice: Number(item.price || 0),
            subtotal: Number(item.price || 0),
            isPromoActive: false,
          };
        }
        if (item.saleType === 'kg') {
          const rawSub = Number(item.qty || 0) * Number(item.price || 0);
          return {
            ...item,
            effectiveUnitPrice: Number(item.price || 0),
            subtotal: roundCustomARS(rawSub, roundStep, roundThreshold),
            isPromoActive: false,
          };
        }
        const effectiveUnit = getUnitPriceForItem(item);
        const isPromoActive =
          Number(item.promoQty) >= 2 &&
          Number(item.promoPrice) > 0 &&
          Number(item.qty) >= Number(item.promoQty);
        const rawSub = Number(item.qty || 0) * effectiveUnit;
        return {
          ...item,
          effectiveUnitPrice: effectiveUnit,
          subtotal: roundCustomARS(rawSub, roundStep, roundThreshold),
          isPromoActive,
        };
      }),
    [cart, roundStep, roundThreshold]
  );

  const cartTotal = useMemo(
    () => cartWithSubtotals.reduce((acc, i) => acc + Number(i.subtotal || 0), 0),
    [cartWithSubtotals]
  );

  const totalCost = useMemo(
    () =>
      cartWithSubtotals.reduce((acc, i) => {
        if (i.saleType === 'special_raw') return acc;
        return acc + Number(i.cost || 0) * Number(i.qty || 0);
      }, 0),
    [cartWithSubtotals]
  );

  const totalItemsCount = useMemo(
    () => cart.reduce((acc, i) => acc + (i.saleType === 'kg' ? 1 : Number(i.qty || 0)), 0),
    [cart]
  );

  const addUnitProductToCart = (prod, forceQty = 1) => {
    setCart((prev) => {
      const idx = prev.findIndex((i) => i.productId === prod.id && i.saleType !== 'kg');
      if (idx >= 0) {
        const copy = [...prev];
        copy[idx] = { ...copy[idx], qty: Number(copy[idx].qty || 0) + forceQty };
        return copy;
      }
      return [
        ...prev,
        {
          id: `line_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          productId: prod.id,
          name: prod.name,
          saleType: 'unit',
          price: Number(prod.price || 0),
          cost: Number(prod.cost || 0),
          promoQty: Number(prod.promoQty || 0),
          promoPrice: Number(prod.promoPrice || 0),
          qty: forceQty,
        },
      ];
    });
  };

  const handleProductClick = (prod) => {
    if (prod.saleType === 'kg') {
      setWeighingProduct(prod);
      setGramsInput('');
      setAmountInput('');
    } else {
      addUnitProductToCart(prod, 1);
      showToast(`${prod.name} agregado`);
    }
  };

  const handleAddWeighedItem = (e) => {
    e.preventDefault();
    if (!weighingProduct) return;
    const pricePerKg = Number(weighingProduct.price || 0);
    let kg = 0;

    if (parseFloat(gramsInput) > 0) {
      kg = parseFloat(gramsInput) / 1000;
    } else if (parseFloat(amountInput) > 0 && pricePerKg > 0) {
      kg = parseFloat(amountInput) / pricePerKg;
    }

    if (kg <= 0) {
      showToast('Ingresá los gramos o el monto en pesos', 'error');
      return;
    }

    const roundedKg = Number(kg.toFixed(3));
    const roundedSubtotal = roundCustomARS(roundedKg * pricePerKg, roundStep, roundThreshold);

    setCart((prev) => [
      ...prev,
      {
        id: `kg_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        productId: weighingProduct.id,
        name: `${weighingProduct.name} (${Math.round(roundedKg * 1000)}g)`,
        saleType: 'kg',
        price: pricePerKg,
        cost: Number(weighingProduct.cost || 0),
        qty: roundedKg,
        fixedSubtotal: roundedSubtotal,
      },
    ]);

    setWeighingProduct(null);
    setGramsInput('');
    setAmountInput('');
    showToast(`Pesado agregado (${formatARS(roundedSubtotal)})`);
  };

  const handleAddDeposit = () => {
    setCart((prev) => [
      ...prev,
      {
        id: `dep_${Date.now()}`,
        productId: null,
        name: `Seña Envase ($${defaultDeposit})`,
        saleType: 'special_raw',
        price: defaultDeposit,
        cost: 0,
        qty: 1,
      },
    ]);
    showToast(`Seña de ${formatARS(defaultDeposit)} sumada a la cuenta`);
  };

  const handleAddBottleReturn = () => {
    setCart((prev) => [
      ...prev,
      {
        id: `ret_${Date.now()}`,
        productId: null,
        name: `Devolución Envase (-$${defaultDeposit})`,
        saleType: 'special_raw',
        price: -Math.abs(defaultDeposit),
        cost: 0,
        qty: 1,
      },
    ]);
    showToast(`Descuento de ${formatARS(defaultDeposit)} por envase aplicado`);
  };

  const handleAddLooseSale = (e) => {
    e.preventDefault();
    const amt = parseFloat(looseAmount);
    if (!amt || amt <= 0) {
      showToast('Ingresá un monto válido', 'error');
      return;
    }
    const rounded = roundCustomARS(amt, roundStep, roundThreshold);
    setCart((prev) => [
      ...prev,
      {
        id: `loose_${Date.now()}`,
        productId: null,
        name: looseDesc.trim() || 'Venta Suelta',
        saleType: 'special_raw',
        price: rounded,
        cost: 0,
        qty: 1,
      },
    ]);
    setLooseModalOpen(false);
    setLooseAmount('');
    setLooseDesc('Venta Suelta');
  };

  const updateCartQty = (lineId, delta) => {
    setCart((prev) =>
      prev
        .map((item) => {
          if (item.id !== lineId || item.saleType === 'kg' || item.saleType === 'special_raw') {
            return item;
          }
          const nextQty = Number(item.qty || 0) + delta;
          return nextQty > 0 ? { ...item, qty: nextQty } : null;
        })
        .filter(Boolean)
    );
  };

  const removeCartItem = (lineId) => {
    setCart((prev) => prev.filter((item) => item.id !== lineId));
  };

  // Escaneo por código de barras (cámara en celular o lector USB en PC)
  const processBarcodeScan = (rawCode) => {
    const clean = String(rawCode || '').trim();
    if (!clean) return;
    const found = products.find((p) => String(p.code || '').trim() === clean);
    if (found) {
      handleProductClick(found);
      setScannerOpen(false);
      setManualScanCode('');
      setSearch('');
    } else {
      showToast(`Código ${clean} no encontrado en el catálogo`, 'error');
    }
  };

  // Captura global de lector de código de barras USB en PC
  useEffect(() => {
    const onKeyDown = (e) => {
      const tag = (e.target && e.target.tagName) || '';
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (e.key === 'Enter') {
        if (globalScanBufferRef.current.length >= 4) {
          processBarcodeScan(globalScanBufferRef.current);
        }
        globalScanBufferRef.current = '';
        return;
      }
      if (e.key.length === 1 && /[0-9A-Za-z-]/.test(e.key)) {
        globalScanBufferRef.current += e.key;
        clearTimeout(globalScanTimerRef.current);
        globalScanTimerRef.current = setTimeout(() => {
          globalScanBufferRef.current = '';
        }, 120);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  });

  // Cámara trasera en celular cuando se abre el escáner
  useEffect(() => {
    if (!scannerOpen) return;
    let stream = null;
    let animId = null;

    const startCamera = async () => {
      try {
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return;
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' } },
        });
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
        }
        if ('BarcodeDetector' in window) {
          const detector = new window.BarcodeDetector({
            formats: ['ean_13', 'ean_8', 'code_128', 'upc_a', 'upc_e', 'qr_code'],
          });
          const tick = async () => {
            if (!videoRef.current || videoRef.current.readyState < 2) {
              animId = requestAnimationFrame(tick);
              return;
            }
            try {
              const codes = await detector.detect(videoRef.current);
              if (codes && codes.length > 0 && codes[0].rawValue) {
                processBarcodeScan(codes[0].rawValue);
                return;
              }
            } catch {}
            animId = requestAnimationFrame(tick);
          };
          animId = requestAnimationFrame(tick);
        }
      } catch {}
    };

    startCamera();
    return () => {
      if (animId) cancelAnimationFrame(animId);
      if (stream) stream.getTracks().forEach((t) => t.stop());
    };
  }, [scannerOpen, products]);

  const filteredProducts = useMemo(() => {
    const q = search.trim().toLowerCase();
    return products.filter((p) => {
      if (catFilter !== 'Todos' && p.category !== catFilter) return false;
      if (!q) return true;
      return (
        (p.name && p.name.toLowerCase().includes(q)) ||
        (p.code && String(p.code).toLowerCase().includes(q))
      );
    });
  }, [products, search, catFilter]);

  const todayStr = getLocalDateStr();
  const todaySales = useMemo(
    () => sales.filter((s) => s.dateStr === todayStr),
    [sales, todayStr]
  );

  const finalizeSale = async (payments, customerId = null) => {
    if (cartWithSubtotals.length === 0) return;
    const cust = customers.find((c) => c.id === customerId) || null;
    const saleId = `sale_${Date.now()}`;

    const saleRecord = {
      id: saleId,
      cashierName: cashierName || 'Caja General',
      items: cartWithSubtotals.map((i) => ({
        productId: i.productId,
        name: i.name,
        saleType: i.saleType,
        qty: i.qty,
        price: i.effectiveUnitPrice,
        cost: i.cost || 0,
        subtotal: i.subtotal,
      })),
      total: cartTotal,
      totalCost,
      payments,
      customerId: cust ? cust.id : null,
      customerName: cust ? cust.name : null,
      status: 'completed',
      dateStr: todayStr,
      createdAt: new Date().toISOString(),
    };

    try {
      if (hasCloudConfig && db) {
        const docRef = await addDoc(
          collection(db, 'artifacts', appId, 'public', 'data', `sales_${cleanStoreCode}`),
          { ...saleRecord, createdAt: serverTimestamp() }
        );
        saleRecord.id = docRef.id;

        for (const item of cartWithSubtotals) {
          if (item.productId) {
            const prod = products.find((p) => p.id === item.productId);
            if (prod) {
              const nextStock = Math.max(0, Number(prod.stock || 0) - Number(item.qty || 0));
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
                { stock: Number(nextStock.toFixed(3)) }
              );
            }
          }
        }

        const fiadoPay = payments.find((p) => p.method === 'Fiado');
        if (fiadoPay && cust && Number(fiadoPay.amount) > 0) {
          const summary = cartWithSubtotals.map((i) => `${i.qty}x ${i.name}`).join(', ');
          await addDoc(
            collection(db, 'artifacts', appId, 'public', 'data', `fiados_${cleanStoreCode}`),
            {
              customerId: cust.id,
              customerName: cust.name,
              type: 'debt',
              amount: Number(fiadoPay.amount),
              description: `Compra: ${summary}`,
              saleId: saleRecord.id,
              dateStr: todayStr,
              createdAt: serverTimestamp(),
            }
          );
          await updateDoc(
            doc(
              db,
              'artifacts',
              appId,
              'public',
              'data',
              `customers_${cleanStoreCode}`,
              cust.id
            ),
            { balance: Number(cust.balance || 0) + Number(fiadoPay.amount) }
          );
        }
      } else {
        setSales((prev) => [saleRecord, ...prev]);
        setProducts((prev) =>
          prev.map((p) => {
            const sold = cartWithSubtotals.find((i) => i.productId === p.id);
            if (!sold) return p;
            return {
              ...p,
              stock: Number(Math.max(0, Number(p.stock || 0) - Number(sold.qty || 0)).toFixed(3)),
            };
          })
        );

        const fiadoPay = payments.find((p) => p.method === 'Fiado');
        if (fiadoPay && cust && Number(fiadoPay.amount) > 0) {
          const summary = cartWithSubtotals.map((i) => `${i.qty}x ${i.name}`).join(', ');
          setFiados((prev) => [
            {
              id: `fiado_${Date.now()}`,
              customerId: cust.id,
              customerName: cust.name,
              type: 'debt',
              amount: Number(fiadoPay.amount),
              description: `Compra: ${summary}`,
              saleId: saleRecord.id,
              dateStr: todayStr,
              createdAt: new Date().toISOString(),
            },
            ...prev,
          ]);
          setCustomers((prev) =>
            prev.map((c) =>
              c.id === cust.id
                ? { ...c, balance: Number(c.balance || 0) + Number(fiadoPay.amount) }
                : c
            )
          );
        }
      }

      setCart([]);
      setCheckoutMode(null);
      setCashReceived('');
      setMixAmount1('');
      setSelectedFiadoCustomerId('');
      setMixFiadoCustomerId('');
      showToast(`¡Venta cobrada por ${formatARS(cartTotal)}!`);
    } catch (err) {
      console.error(err);
      showToast('Error al registrar la venta', 'error');
    }
  };

  const handleConfirmSingleCheckout = (e) => {
    e.preventDefault();
    if (singleMethod === 'Fiado' && !selectedFiadoCustomerId) {
      showToast('Seleccioná el cliente al que le vas a fiar', 'error');
      return;
    }
    finalizeSale(
      [{ method: singleMethod, amount: cartTotal }],
      singleMethod === 'Fiado' ? selectedFiadoCustomerId : null
    );
  };

  const handleConfirmMixedCheckout = (e) => {
    e.preventDefault();
    const a1 = Number(mixAmount1) || 0;
    const a2 = Math.max(0, Number((cartTotal - a1).toFixed(2)));
    if (a1 <= 0 || a2 <= 0) {
      showToast('Ingresá un monto parcial válido para el primer medio', 'error');
      return;
    }
    const usesFiado = mixMethod1 === 'Fiado' || mixMethod2 === 'Fiado';
    if (usesFiado && !mixFiadoCustomerId) {
      showToast('Seleccioná el cliente para la parte fiada', 'error');
      return;
    }
    finalizeSale(
      [
        { method: mixMethod1, amount: a1 },
        { method: mixMethod2, amount: a2 },
      ],
      usesFiado ? mixFiadoCustomerId : null
    );
  };

  const handleVoidSale = (sale) => {
    requireAdmin(() => {
      setConfirmDialog({
        title: 'Anular Venta',
        message: `¿Anular esta venta de ${formatARS(sale.total)} y devolver las unidades al stock?`,
        confirmText: 'Sí, anular',
        onConfirm: async () => {
          try {
            if (hasCloudConfig && db) {
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
                      { stock: Number(prod.stock || 0) + Number(item.qty || 0) }
                    );
                  }
                }
              }
            } else {
              setSales((prev) =>
                prev.map((s) => (s.id === sale.id ? { ...s, status: 'voided' } : s))
              );
              setProducts((prev) =>
                prev.map((p) => {
                  const sold = (sale.items || []).find((i) => i.productId === p.id);
                  if (!sold) return p;
                  return { ...p, stock: Number(p.stock || 0) + Number(sold.qty || 0) };
                })
              );
            }
            showToast('Venta anulada');
          } catch {
            showToast('Error al anular venta', 'error');
          }
        },
      });
    });
  };

  const cashChange = Math.max(0, (Number(cashReceived) || 0) - cartTotal);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
      {/* Columna Izquierda/Central: Buscador, Atajos y Catálogo Rápido */}
      <div className="lg:col-span-8 space-y-4">
        <div className="bg-white p-3.5 sm:p-4 rounded-2xl border border-slate-200 shadow-2xs space-y-3">
          <div className="flex flex-col sm:flex-row gap-2.5">
            <div className="relative flex-1">
              <Search className="w-5 h-5 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input
                ref={searchInputRef}
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && search.trim()) {
                    const exact = products.find(
                      (p) => String(p.code || '').trim() === search.trim()
                    );
                    if (exact) {
                      handleProductClick(exact);
                      setSearch('');
                    }
                  }
                }}
                placeholder="Buscar producto o pasar lector de código..."
                className="w-full pl-11 pr-4 py-3.5 bg-slate-50 border border-slate-300 rounded-xl text-base font-semibold focus:border-emerald-500 focus:outline-none"
              />
            </div>

            <button
              type="button"
              onClick={() => setScannerOpen(true)}
              className="px-4 py-3.5 bg-slate-900 hover:bg-slate-800 text-white font-extrabold text-sm rounded-xl flex items-center justify-center gap-2 shrink-0"
            >
              <Camera className="w-5 h-5 text-emerald-400" /> Escanear
            </button>
          </div>

          {/* Botones Rápidos de Mostrador */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <button
              type="button"
              onClick={handleAddDeposit}
              className="py-3 px-2.5 bg-amber-50 hover:bg-amber-100 text-amber-950 border border-amber-200 rounded-xl font-extrabold text-xs sm:text-sm flex items-center justify-center gap-1.5"
            >
              <Plus className="w-4 h-4 text-amber-700" /> Seña ({formatARS(defaultDeposit)})
            </button>

            <button
              type="button"
              onClick={handleAddBottleReturn}
              className="py-3 px-2.5 bg-orange-50 hover:bg-orange-100 text-orange-950 border border-orange-200 rounded-xl font-extrabold text-xs sm:text-sm flex items-center justify-center gap-1.5"
            >
              <RotateCcw className="w-4 h-4 text-orange-700" /> Dev. Envase
            </button>

            <button
              type="button"
              onClick={() => setLooseModalOpen(true)}
              className="py-3 px-2.5 bg-emerald-50 hover:bg-emerald-100 text-emerald-950 border border-emerald-200 rounded-xl font-extrabold text-xs sm:text-sm flex items-center justify-center gap-1.5"
            >
              <Plus className="w-4 h-4 text-emerald-700" /> Venta Suelta
            </button>

            <button
              type="button"
              onClick={() => setShowTodaySales(true)}
              className="py-3 px-2.5 bg-slate-100 hover:bg-slate-200 text-slate-800 border border-slate-200 rounded-xl font-extrabold text-xs sm:text-sm flex items-center justify-center gap-1.5"
            >
              <Receipt className="w-4 h-4 text-slate-700" /> Tickets ({todaySales.length})
            </button>
          </div>

          {/* Categorías */}
          <div className="flex items-center gap-2 overflow-x-auto pb-1">
            {['Todos', ...CATEGORIAS].map((cat) => (
              <button
                key={cat}
                type="button"
                onClick={() => setCatFilter(cat)}
                className={`px-3.5 py-2 rounded-xl text-xs sm:text-sm font-extrabold whitespace-nowrap transition ${
                  catFilter === cat
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
          <div className="bg-white rounded-2xl border border-slate-200 p-10 text-center space-y-2">
            <Package className="w-12 h-12 text-slate-300 mx-auto" />
            <p className="font-extrabold text-slate-700 text-base">
              No se encontraron productos con ese filtro.
            </p>
            <p className="text-xs text-slate-400">
              Podés cargarlo en la pestaña "Productos" o usar "Venta Suelta".
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
            {filteredProducts.map((prod) => {
              const hasPack = Number(prod.promoQty) >= 2 && Number(prod.promoPrice) > 0;
              return (
                <div
                  key={prod.id}
                  onClick={() => handleProductClick(prod)}
                  className="bg-white hover:border-emerald-500 active:scale-[0.99] p-4 rounded-2xl border border-slate-200 shadow-2xs cursor-pointer transition flex flex-col justify-between gap-3"
                >
                  <div>
                    <div className="flex items-center justify-between gap-2 mb-1">
                      <span className="text-[11px] font-bold uppercase text-slate-400">
                        {prod.category}
                      </span>
                      {prod.saleType === 'kg' ? (
                        <span className="text-[11px] font-extrabold bg-blue-100 text-blue-800 px-2 py-0.5 rounded-md flex items-center gap-1">
                          <Scale className="w-3 h-3" /> BALANZA
                        </span>
                      ) : (
                        <span className="text-xs font-bold text-slate-400">
                          Stock: {prod.stock}
                        </span>
                      )}
                    </div>
                    <h3 className="font-black text-base sm:text-lg text-slate-900 leading-snug">
                      {prod.name}
                    </h3>
                  </div>

                  <div className="flex items-end justify-between gap-2 pt-2 border-t border-slate-100">
                    <div>
                      <p className="text-2xl font-black text-emerald-700 leading-none">
                        {formatARS(prod.price)}
                      </p>
                      {prod.saleType === 'kg' && (
                        <span className="text-xs font-bold text-slate-400">por kilo</span>
                      )}
                      {hasPack && (
                        <p className="text-xs font-extrabold text-purple-700 mt-1">
                          {prod.promoQty}+ a {formatARS(prod.promoPrice)} c/u
                        </p>
                      )}
                    </div>

                    {hasPack && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          addUnitProductToCart(prod, Number(prod.promoQty));
                          showToast(`Pack x${prod.promoQty} de ${prod.name} agregado`);
                        }}
                        className="px-3 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-xl text-xs font-extrabold flex items-center gap-1 shrink-0"
                      >
                        <Layers className="w-3.5 h-3.5" /> + Pack x{prod.promoQty}
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Columna Derecha: Cuenta Actual / Carrito */}
      <div
        ref={cartSectionRef}
        className="lg:col-span-4 bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden sticky top-4"
      >
        <div className="bg-slate-900 text-white px-5 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <ShoppingCart className="w-5 h-5 text-emerald-400" />
            <h2 className="font-black text-lg text-white">Cuenta Actual</h2>
          </div>
          {cart.length > 0 && (
            <button
              type="button"
              onClick={() => setCart([])}
              className="text-xs font-bold text-rose-300 hover:text-rose-200 underline"
            >
              Vaciar
            </button>
          )}
        </div>

        <div className="p-5 space-y-4">
          {cartWithSubtotals.length === 0 ? (
            <div className="py-10 text-center text-slate-400 space-y-2">
              <ShoppingCart className="w-12 h-12 text-slate-200 mx-auto" />
              <p className="font-bold text-sm text-slate-600">
                Tocá un producto para empezar la venta
              </p>
              <p className="text-xs">
                Podés mezclar productos por unidad, balanza y señas.
              </p>
            </div>
          ) : (
            <div className="divide-y divide-slate-100 max-h-80 overflow-y-auto">
              {cartWithSubtotals.map((item) => (
                <div key={item.id} className="py-3 flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-extrabold text-sm text-slate-900 truncate">{item.name}</p>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className="text-xs text-slate-500">
                        {item.saleType === 'kg'
                          ? `${formatARS(item.effectiveUnitPrice)}/kg`
                          : `${formatARS(item.effectiveUnitPrice)} c/u`}
                      </span>
                      {item.isPromoActive && (
                        <span className="text-[10px] font-extrabold bg-purple-100 text-purple-800 px-1.5 py-0.5 rounded">
                          PROMO / MAYOR
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    {item.saleType === 'unit' && (
                      <div className="flex items-center bg-slate-100 rounded-xl p-0.5">
                        <button
                          type="button"
                          onClick={() => updateCartQty(item.id, -1)}
                          className="p-1.5 text-slate-700 hover:bg-white rounded-lg"
                        >
                          <Minus className="w-3.5 h-3.5" />
                        </button>
                        <span className="px-2 text-xs font-black">{item.qty}</span>
                        <button
                          type="button"
                          onClick={() => updateCartQty(item.id, 1)}
                          className="p-1.5 text-slate-700 hover:bg-white rounded-lg"
                        >
                          <Plus className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    )}

                    <span className="font-black text-sm text-slate-900 w-20 text-right">
                      {formatARS(item.subtotal)}
                    </span>

                    <button
                      type="button"
                      onClick={() => removeCartItem(item.id)}
                      className="p-1.5 text-rose-500 hover:bg-rose-50 rounded-lg"
                      title="Quitar"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Total a Cobrar */}
          <div className="pt-3 border-t border-slate-200 flex items-baseline justify-between">
            <span className="text-xs font-extrabold uppercase text-slate-500">
              TOTAL A COBRAR
            </span>
            <span className="text-3xl font-black text-emerald-700">{formatARS(cartTotal)}</span>
          </div>

          {/* Botones de Cobro */}
          <div className="grid grid-cols-2 gap-2.5 pt-1">
            <button
              type="button"
              disabled={cartWithSubtotals.length === 0}
              onClick={() => {
                setCashReceived(String(cartTotal));
                setCheckoutMode('single');
              }}
              className="py-3.5 px-3 bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-200 disabled:text-slate-400 text-white font-black text-sm rounded-2xl shadow-sm transition"
            >
              Cobrar (1 Medio)
            </button>

            <button
              type="button"
              disabled={cartWithSubtotals.length === 0}
              onClick={() => {
                setMixAmount1('');
                setCheckoutMode('mixed');
              }}
              className="py-3.5 px-3 bg-slate-900 hover:bg-slate-800 disabled:bg-slate-200 disabled:text-slate-400 text-white font-black text-sm rounded-2xl transition"
            >
              Pago Mixto (2)
            </button>
          </div>
        </div>
      </div>

      {/* Barra Flotante Inferior en Celular cuando hay items en la cuenta */}
      {cartWithSubtotals.length > 0 && (
        <div className="md:hidden fixed bottom-16 inset-x-3 z-20 bg-slate-900 text-white p-3.5 rounded-2xl shadow-2xl border border-slate-700 flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={() =>
              cartSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
            }
            className="text-left bg-transparent text-white"
          >
            <span className="text-[11px] font-bold text-emerald-400 block">
              {totalItemsCount} ítem(s) • Ver cuenta
            </span>
            <span className="text-xl font-black text-white">{formatARS(cartTotal)}</span>
          </button>

          <button
            type="button"
            onClick={() => {
              setCashReceived(String(cartTotal));
              setCheckoutMode('single');
            }}
            className="px-5 py-3 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-black text-sm rounded-xl shrink-0"
          >
            COBRAR
          </button>
        </div>
      )}

      {/* MODAL BALANZA (POR GRAMOS O POR PESOS) */}
      {weighingProduct && (
        <div className="fixed inset-0 bg-slate-950/75 z-50 flex items-center justify-center p-4">
          <form
            onSubmit={handleAddWeighedItem}
            className="bg-white rounded-3xl max-w-sm w-full p-6 shadow-2xl space-y-4"
          >
            <div className="flex items-center justify-between border-b pb-3">
              <div>
                <h3 className="font-black text-lg text-slate-900">{weighingProduct.name}</h3>
                <p className="text-xs font-bold text-emerald-700">
                  Precio por Kg: {formatARS(weighingProduct.price)}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setWeighingProduct(null)}
                className="p-1.5 rounded-lg bg-slate-100"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div>
              <label className="block text-xs font-extrabold text-slate-600 uppercase mb-1">
                Peso en Gramos (ej: 250, 350, 500)
              </label>
              <input
                type="number"
                autoFocus
                value={gramsInput}
                onChange={(e) => {
                  setGramsInput(e.target.value);
                  const g = parseFloat(e.target.value);
                  if (!isNaN(g) && g > 0) {
                    const sub = roundCustomARS(
                      (g / 1000) * Number(weighingProduct.price || 0),
                      roundStep,
                      roundThreshold
                    );
                    setAmountInput(String(sub));
                  } else {
                    setAmountInput('');
                  }
                }}
                placeholder="Gramos..."
                className="w-full px-4 py-3 border-2 border-slate-300 rounded-xl text-xl font-black"
              />
            </div>

            <div>
              <label className="block text-xs font-extrabold text-slate-600 uppercase mb-1">
                O calcular por Monto ($)
              </label>
              <input
                type="number"
                value={amountInput}
                onChange={(e) => setAmountInput(e.target.value)}
                placeholder="Monto en pesos..."
                className="w-full px-4 py-3 border border-slate-300 rounded-xl text-xl font-black text-emerald-700"
              />
            </div>

            <button
              type="submit"
              className="w-full py-3.5 bg-emerald-600 hover:bg-emerald-700 text-white font-black rounded-xl"
            >
              Agregar a la Cuenta
            </button>
          </form>
        </div>
      )}

      {/* MODAL VENTA SUELTA */}
      {looseModalOpen && (
        <div className="fixed inset-0 bg-slate-950/75 z-50 flex items-center justify-center p-4">
          <form
            onSubmit={handleAddLooseSale}
            className="bg-white rounded-3xl max-w-sm w-full p-6 shadow-2xl space-y-4"
          >
            <div className="flex items-center justify-between border-b pb-3">
              <h3 className="font-black text-lg text-slate-900">Venta Suelta</h3>
              <button
                type="button"
                onClick={() => setLooseModalOpen(false)}
                className="p-1.5 rounded-lg bg-slate-100"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-500 uppercase mb-1">
                Concepto
              </label>
              <input
                type="text"
                value={looseDesc}
                onChange={(e) => setLooseDesc(e.target.value)}
                className="w-full px-3.5 py-2.5 border border-slate-300 rounded-xl text-sm font-bold"
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-500 uppercase mb-1">
                Monto ($)
              </label>
              <input
                type="number"
                autoFocus
                value={looseAmount}
                onChange={(e) => setLooseAmount(e.target.value)}
                placeholder="0"
                className="w-full px-3.5 py-3 border-2 border-emerald-500 rounded-xl text-2xl font-black text-emerald-700"
              />
            </div>
            <button
              type="submit"
              className="w-full py-3.5 bg-emerald-600 hover:bg-emerald-700 text-white font-black rounded-xl"
            >
              Sumar a la Cuenta
            </button>
          </form>
        </div>
      )}

      {/* MODAL COBRO (1 MEDIO O MIXTO) */}
      {checkoutMode && (
        <div className="fixed inset-0 bg-slate-950/75 z-50 flex items-center justify-center p-4">
          {checkoutMode === 'single' ? (
            <form
              onSubmit={handleConfirmSingleCheckout}
              className="bg-white rounded-3xl max-w-md w-full p-6 shadow-2xl space-y-4"
            >
              <div className="flex items-center justify-between border-b pb-3">
                <h3 className="font-black text-lg text-slate-900">Cobrar Venta</h3>
                <button
                  type="button"
                  onClick={() => setCheckoutMode(null)}
                  className="p-1.5 rounded-lg bg-slate-100"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="p-4 bg-emerald-50 rounded-2xl text-center">
                <span className="text-xs font-extrabold text-emerald-800 uppercase block">
                  Total a Cobrar
                </span>
                <span className="text-4xl font-black text-emerald-700">{formatARS(cartTotal)}</span>
              </div>

              <div className="grid grid-cols-2 gap-2">
                {MEDIOS_PAGO.map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setSingleMethod(m)}
                    className={`py-3 px-3 rounded-xl font-extrabold text-xs border transition ${
                      singleMethod === m
                        ? 'bg-slate-900 text-white border-slate-900'
                        : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
                    }`}
                  >
                    {m}
                  </button>
                ))}
              </div>

              {singleMethod === 'Efectivo' && (
                <div className="space-y-2 pt-1">
                  <label className="block text-xs font-bold text-slate-500 uppercase">
                    ¿Con cuánto paga? (Vuelto)
                  </label>
                  <input
                    type="number"
                    value={cashReceived}
                    onChange={(e) => setCashReceived(e.target.value)}
                    className="w-full px-3.5 py-2.5 border border-slate-300 rounded-xl text-lg font-black"
                  />
                  {cashChange > 0 && (
                    <p className="text-sm font-black text-emerald-700">
                      Vuelto a entregar: {formatARS(cashChange)}
                    </p>
                  )}
                </div>
              )}

              {singleMethod === 'Fiado' && (
                <div>
                  <label className="block text-xs font-bold text-rose-700 uppercase mb-1">
                    Cliente para Fiado
                  </label>
                  <select
                    value={selectedFiadoCustomerId}
                    onChange={(e) => setSelectedFiadoCustomerId(e.target.value)}
                    className="w-full px-3 py-2.5 border border-rose-300 rounded-xl text-sm font-bold"
                  >
                    <option value="">Elegir cliente...</option>
                    {customers.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name} (Saldo: {formatARS(c.balance || 0)})
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <button
                type="submit"
                className="w-full py-4 bg-emerald-600 hover:bg-emerald-700 text-white font-black text-base rounded-2xl shadow-lg"
              >
                Confirmar Cobro
              </button>
            </form>
          ) : (
            <form
              onSubmit={handleConfirmMixedCheckout}
              className="bg-white rounded-3xl max-w-md w-full p-6 shadow-2xl space-y-4"
            >
              <div className="flex items-center justify-between border-b pb-3">
                <h3 className="font-black text-lg text-slate-900">Pago Mixto (2 Medios)</h3>
                <button
                  type="button"
                  onClick={() => setCheckoutMode(null)}
                  className="p-1.5 rounded-lg bg-slate-100"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <p className="text-center text-2xl font-black text-emerald-700">
                Total: {formatARS(cartTotal)}
              </p>

              <div className="p-3 bg-slate-50 rounded-2xl space-y-2 border border-slate-200">
                <span className="text-xs font-extrabold text-slate-600">1° Medio de Pago</span>
                <div className="grid grid-cols-2 gap-2">
                  <select
                    value={mixMethod1}
                    onChange={(e) => setMixMethod1(e.target.value)}
                    className="px-3 py-2 bg-white border border-slate-300 rounded-xl text-xs font-bold"
                  >
                    {MEDIOS_PAGO.map((m) => (
                      <option key={m} value={m}>
                        {m}
                      </option>
                    ))}
                  </select>
                  <input
                    type="number"
                    value={mixAmount1}
                    onChange={(e) => setMixAmount1(e.target.value)}
                    placeholder="Monto 1 ($)"
                    className="px-3 py-2 bg-white border border-slate-300 rounded-xl text-sm font-black"
                  />
                </div>
              </div>

              <div className="p-3 bg-slate-50 rounded-2xl space-y-2 border border-slate-200">
                <span className="text-xs font-extrabold text-slate-600">2° Medio de Pago</span>
                <div className="grid grid-cols-2 gap-2 items-center">
                  <select
                    value={mixMethod2}
                    onChange={(e) => setMixMethod2(e.target.value)}
                    className="px-3 py-2 bg-white border border-slate-300 rounded-xl text-xs font-bold"
                  >
                    {MEDIOS_PAGO.map((m) => (
                      <option key={m} value={m}>
                        {m}
                      </option>
                    ))}
                  </select>
                  <span className="text-right font-black text-base text-slate-900">
                    {formatARS(Math.max(0, cartTotal - (Number(mixAmount1) || 0)))}
                  </span>
                </div>
              </div>

              {(mixMethod1 === 'Fiado' || mixMethod2 === 'Fiado') && (
                <div>
                  <label className="block text-xs font-bold text-rose-700 uppercase mb-1">
                    Cliente para la parte fiada
                  </label>
                  <select
                    value={mixFiadoCustomerId}
                    onChange={(e) => setMixFiadoCustomerId(e.target.value)}
                    className="w-full px-3 py-2.5 border border-rose-300 rounded-xl text-sm font-bold"
                  >
                    <option value="">Elegir cliente...</option>
                    {customers.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <button
                type="submit"
                className="w-full py-3.5 bg-slate-900 hover:bg-slate-800 text-white font-black rounded-2xl"
              >
                Registrar Pago Mixto
              </button>
            </form>
          )}
        </div>
      )}

      {/* MODAL ESCÁNER CÁMARA / CÓDIGO MANUAL */}
      {scannerOpen && (
        <div className="fixed inset-0 bg-slate-950/80 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl max-w-sm w-full p-5 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b pb-3">
              <h3 className="font-black text-base text-slate-900">Escanear Código de Barras</h3>
              <button
                type="button"
                onClick={() => setScannerOpen(false)}
                className="p-1.5 rounded-lg bg-slate-100"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <video
              ref={videoRef}
              className="w-full h-48 bg-slate-950 rounded-2xl object-cover"
              playsInline
              muted
            />

            <form
              onSubmit={(e) => {
                e.preventDefault();
                processBarcodeScan(manualScanCode);
              }}
              className="flex gap-2"
            >
              <input
                type="text"
                value={manualScanCode}
                onChange={(e) => setManualScanCode(e.target.value)}
                placeholder="Escribir o pegar código..."
                className="flex-1 px-3 py-2.5 border border-slate-300 rounded-xl text-sm font-mono"
              />
              <button
                type="submit"
                className="px-4 py-2.5 bg-emerald-600 text-white font-extrabold text-xs rounded-xl"
              >
                Buscar
              </button>
            </form>
          </div>
        </div>
      )}

      {/* MODAL TICKETS DEL DÍA */}
      {showTodaySales && (
        <div className="fixed inset-0 bg-slate-950/75 z-50 flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white rounded-3xl max-w-lg w-full p-6 shadow-2xl space-y-4 my-auto">
            <div className="flex items-center justify-between border-b pb-3">
              <h3 className="font-black text-lg text-slate-900">
                Tickets de Hoy ({todaySales.length})
              </h3>
              <button
                type="button"
                onClick={() => setShowTodaySales(false)}
                className="p-1.5 rounded-lg bg-slate-100"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="divide-y divide-slate-100 max-h-96 overflow-y-auto">
              {todaySales.length === 0 ? (
                <p className="py-8 text-center text-sm text-slate-400">
                  Todavía no hay ventas registradas hoy.
                </p>
              ) : (
                todaySales.map((s) => {
                  const isVoided = s.status === 'voided';
                  return (
                    <div key={s.id} className="py-3 space-y-2">
                      <div className="flex items-center justify-between">
                        <div>
                          <span
                            className={`text-base font-black ${
                              isVoided ? 'line-through text-slate-400' : 'text-slate-900'
                            }`}
                          >
                            {formatARS(s.total)}
                          </span>
                          <span className="ml-2 text-xs text-slate-400">
                            {formatTime(s.createdAt)} •{' '}
                            {(s.payments || []).map((p) => p.method).join(' + ')}
                          </span>
                          {isVoided && (
                            <span className="ml-2 text-[10px] font-extrabold bg-rose-100 text-rose-700 px-1.5 py-0.5 rounded">
                              ANULADA
                            </span>
                          )}
                        </div>

                        {!isVoided && (
                          <div className="flex items-center gap-1.5">
                            <a
                              href={buildWhatsAppTicketUrl(s, '')}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="px-2.5 py-1.5 bg-emerald-50 text-emerald-700 rounded-lg text-xs font-bold flex items-center gap-1"
                            >
                              <MessageCircle className="w-3.5 h-3.5" /> Ticket
                            </a>
                            <button
                              type="button"
                              onClick={() => handleVoidSale(s)}
                              className="px-2.5 py-1.5 bg-rose-50 text-rose-700 rounded-lg text-xs font-bold"
                            >
                              Anular
                            </button>
                          </div>
                        )}
                      </div>
                      <p className="text-xs text-slate-500">
                        {(s.items || []).map((i) => `${i.qty}x ${i.name}`).join(', ')}
                      </p>
                    </div>
                  );
                })
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
  setProducts,
  storeSettings,
  requireAdmin,
  showToast,
  setConfirmDialog,
}) {
  const [search, setSearch] = useState('');
  const [catFilter, setCatFilter] = useState('Todos');

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

  const [bulkModalOpen, setBulkModalOpen] = useState(false);
  const [bulkCat, setBulkCat] = useState('Bebidas');
  const [bulkPercent, setBulkPercent] = useState('10');

  const [importModalOpen, setImportModalOpen] = useState(false);
  const [importRawText, setImportRawText] = useState('');
  const [parsedImportRows, setParsedImportRows] = useState([]);
  const [importDefaultMargin, setImportDefaultMargin] = useState('30');

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
        (p.code && String(p.code).toLowerCase().includes(q))
      );
    });
  }, [products, search, catFilter]);

  const openNewProductModal = () => {
    requireAdmin(() => {
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
    };

    try {
      if (hasCloudConfig && db) {
        if (editingProd === 'NEW') {
          await addDoc(
            collection(db, 'artifacts', appId, 'public', 'data', `products_${cleanStoreCode}`),
            { ...payload, createdAt: serverTimestamp(), updatedAt: serverTimestamp() }
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
            { ...payload, updatedAt: serverTimestamp() }
          );
          showToast('Producto actualizado');
        }
      } else {
        if (editingProd === 'NEW') {
          setProducts((prev) => [{ id: `prod_${Date.now()}`, ...payload }, ...prev]);
          showToast('Producto agregado al catálogo');
        } else {
          setProducts((prev) =>
            prev.map((p) => (p.id === editingProd.id ? { ...p, ...payload } : p))
          );
          showToast('Producto actualizado');
        }
      }
      setEditingProd(null);
    } catch {
      showToast('Error al guardar producto', 'error');
    }
  };

  const handleDeleteProduct = (prod) => {
    requireAdmin(() => {
      setConfirmDialog({
        title: 'Eliminar Producto',
        message: `¿Seguro que querés eliminar "${prod.name}" del catálogo?`,
        confirmText: 'Sí, eliminar',
        onConfirm: async () => {
          try {
            if (hasCloudConfig && db) {
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
            } else {
              setProducts((prev) => prev.filter((p) => p.id !== prod.id));
            }
            showToast('Producto eliminado');
          } catch {
            showToast('Error al eliminar producto', 'error');
          }
        },
      });
    });
  };

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
      const factor = 1 + pct / 100;
      if (hasCloudConfig && db) {
        const batch = writeBatch(db);
        targets.forEach((p) => {
          const nextCost = Number(p.cost || 0) > 0 ? Number((Number(p.cost) * factor).toFixed(2)) : 0;
          const nextPrice = roundCustomARS(Number(p.price || 0) * factor, roundStep, roundThreshold);
          batch.update(
            doc(db, 'artifacts', appId, 'public', 'data', `products_${cleanStoreCode}`, p.id),
            { cost: nextCost || p.cost || 0, price: nextPrice }
          );
        });
        await batch.commit();
      } else {
        setProducts((prev) =>
          prev.map((p) => {
            if (bulkCat !== 'Todos' && p.category !== bulkCat) return p;
            const nextCost =
              Number(p.cost || 0) > 0 ? Number((Number(p.cost) * factor).toFixed(2)) : 0;
            const nextPrice = roundCustomARS(Number(p.price || 0) * factor, roundStep, roundThreshold);
            return { ...p, cost: nextCost || p.cost || 0, price: nextPrice };
          })
        );
      }

      setBulkModalOpen(false);
      showToast(`Precios actualizados (${pct > 0 ? `+${pct}%` : `${pct}%`})`);
    } catch {
      showToast('Error al actualizar precios', 'error');
    }
  };

  const handleParseImportText = () => {
    const marginNum = parseFloat(importDefaultMargin) || 30;
    const lines = importRawText
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);

    const parsed = lines
      .map((line) => {
        const parts = line.split(/[|;\t]/).map((s) => s.trim());
        const name = parts[0] || '';
        const qty = parseFloat(parts[1]) || 1;
        const cost = parseFloat((parts[2] || '').replace(/[^0-9.]/g, '')) || 0;
        if (!name) return null;

        const existing = products.find(
          (p) => (p.name || '').toLowerCase() === name.toLowerCase()
        );
        const sellPrice =
          cost > 0
            ? roundCustomARS(cost * (1 + marginNum / 100), roundStep, roundThreshold)
            : existing
            ? Number(existing.price || 0)
            : 0;

        return {
          name,
          qty,
          cost: cost > 0 ? cost : existing ? Number(existing.cost || 0) : 0,
          sellPrice,
          existingId: existing ? existing.id : null,
          existingStock: existing ? Number(existing.stock || 0) : 0,
        };
      })
      .filter(Boolean);

    if (parsed.length === 0) {
      showToast('No se detectaron líneas válidas para importar', 'error');
      return;
    }
    setParsedImportRows(parsed);
  };

  const handleConfirmImportRows = async () => {
    try {
      if (hasCloudConfig && db) {
        const batch = writeBatch(db);
        const colRef = collection(
          db,
          'artifacts',
          appId,
          'public',
          'data',
          `products_${cleanStoreCode}`
        );

        parsedImportRows.forEach((row) => {
          if (row.existingId) {
            batch.update(doc(colRef, row.existingId), {
              stock: Number(row.existingStock || 0) + Number(row.qty || 0),
              cost: Number(row.cost || 0),
              price: Number(row.sellPrice || 0),
              isSample: false,
            });
          } else {
            const newRef = doc(colRef);
            batch.set(newRef, {
              name: row.name,
              category: 'Almacén',
              saleType: 'unit',
              cost: Number(row.cost || 0),
              margin: Number(importDefaultMargin) || 30,
              price: Number(row.sellPrice || 0),
              stock: Number(row.qty || 0),
              minStock: 5,
              code: generateInternalBarcode(),
              isSample: false,
              createdAt: serverTimestamp(),
            });
          }
        });
        await batch.commit();
      } else {
        setProducts((prev) => {
          const next = [...prev];
          parsedImportRows.forEach((row) => {
            const idx = next.findIndex((p) => p.id === row.existingId);
            if (idx >= 0) {
              next[idx] = {
                ...next[idx],
                stock: Number(next[idx].stock || 0) + Number(row.qty || 0),
                cost: Number(row.cost || 0),
                price: Number(row.sellPrice || 0),
                isSample: false,
              };
            } else {
              next.unshift({
                id: `imp_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
                name: row.name,
                category: 'Almacén',
                saleType: 'unit',
                cost: Number(row.cost || 0),
                margin: Number(importDefaultMargin) || 30,
                price: Number(row.sellPrice || 0),
                stock: Number(row.qty || 0),
                minStock: 5,
                code: generateInternalBarcode(),
                isSample: false,
              });
            }
          });
          return next;
        });
      }

      setImportModalOpen(false);
      setImportRawText('');
      setParsedImportRows([]);
      showToast('Boleta importada y stock actualizado');
    } catch {
      showToast('Error al importar la boleta', 'error');
    }
  };

  return (
    <div className="space-y-4">
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

      {/* Móvil */}
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

      {/* Desktop */}
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

      {/* MODAL ALTA / EDICIÓN */}
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

      {/* MODAL AUMENTO MASIVO */}
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

      {/* MODAL IMPORTADOR DE BOLETAS */}
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

      {/* MODAL CÓDIGO DE BARRAS */}
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
// MÓDULO 3: CAJA DIARIA, GASTOS, FALTANTES Y VENCIMIENTOS
// ============================================================================
function CashModule({
  cleanStoreCode,
  cashierName,
  products,
  sales,
  expenses,
  setExpenses,
  cashSession,
  setCashSession,
  showToast,
}) {
  const [openingInput, setOpeningInput] = useState('');
  const [expCategory, setExpCategory] = useState('Pago a Proveedor');
  const [expDesc, setExpDesc] = useState('');
  const [expAmount, setExpAmount] = useState('');
  const [expMethod, setExpMethod] = useState('Efectivo');
  const [cashScope, setCashScope] = useState('mine'); // 'mine' | 'all'

  const todayStr = getLocalDateStr();
  const activeCashierLabel = cashierName || 'Caja General';

  const matchesCashier = (record) => {
    if (cashScope === 'all') return true;
    const recCashier = record.cashierName || activeCashierLabel;
    return recCashier.trim().toLowerCase() === activeCashierLabel.trim().toLowerCase();
  };

  const todayCompletedSales = useMemo(
    () =>
      sales.filter(
        (s) => s.dateStr === todayStr && s.status !== 'voided' && matchesCashier(s)
      ),
    [sales, todayStr, cashScope, activeCashierLabel]
  );

  const todayExpenses = useMemo(
    () =>
      expenses.filter((e) => e.dateStr === todayStr && matchesCashier(e)),
    [expenses, todayStr, cashScope, activeCashierLabel]
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
    const cleanCashierKey =
      activeCashierLabel.trim().toUpperCase().replace(/[^A-Z0-9_-]/g, '_') || 'GENERAL';
    try {
      const cashPayload = {
        cashierName: activeCashierLabel,
        openingCash: amount,
        dateStr: todayStr,
        updatedAt: new Date().toISOString(),
      };
      if (hasCloudConfig && db) {
        await setDoc(
          doc(
            db,
            'artifacts',
            appId,
            'public',
            'data',
            `cash_${cleanStoreCode}`,
            `${todayStr}_${cleanCashierKey}`
          ),
          { ...cashPayload, createdAt: serverTimestamp() },
          { merge: true }
        );
      } else {
        setCashSession(cashPayload);
        localStorage.setItem(
          `local_cash_${cleanStoreCode}_${todayStr}_${activeCashierLabel}`,
          JSON.stringify(cashPayload)
        );
      }
      setOpeningInput('');
      showToast(`Cambio inicial guardado para ${activeCashierLabel}`);
    } catch {
      showToast('Error al guardar inicio de caja', 'error');
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
      const expPayload = {
        id: `exp_${Date.now()}`,
        cashierName: activeCashierLabel,
        category: expCategory,
        description: expDesc.trim() || expCategory,
        amount,
        method: expMethod,
        dateStr: todayStr,
        createdAt: new Date().toISOString(),
      };
      if (hasCloudConfig && db) {
        await addDoc(
          collection(db, 'artifacts', appId, 'public', 'data', `expenses_${cleanStoreCode}`),
          { ...expPayload, createdAt: serverTimestamp() }
        );
      } else {
        setExpenses((prev) => [expPayload, ...prev]);
      }
      setExpDesc('');
      setExpAmount('');
      showToast(`Salida registrada en ${activeCashierLabel}`);
    } catch {
      showToast('Error al registrar salida', 'error');
    }
  };

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
      <div className="bg-white p-3.5 rounded-2xl border border-slate-200 flex flex-wrap items-center justify-between gap-2">
        <div className="text-xs font-bold text-slate-600">
          Caja de este equipo: <strong className="text-slate-900">{activeCashierLabel}</strong>
        </div>
        <div className="flex gap-1.5">
          <button
            type="button"
            onClick={() => setCashScope('mine')}
            className={`px-3 py-1.5 rounded-xl text-xs font-extrabold ${
              cashScope === 'mine'
                ? 'bg-slate-900 text-white'
                : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
            }`}
          >
            Solo mi caja ({activeCashierLabel})
          </button>
          <button
            type="button"
            onClick={() => setCashScope('all')}
            className={`px-3 py-1.5 rounded-xl text-xs font-extrabold ${
              cashScope === 'all'
                ? 'bg-slate-900 text-white'
                : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
            }`}
          >
            Todas las cajas
          </button>
        </div>
      </div>

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
          <p className="text-xs text-slate-400 mt-1">Fiado hoy: {formatARS(totals.fiadoSales)}</p>
        </div>

        <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-2xs">
          <p className="text-xs font-bold text-purple-600 uppercase">Ganancia Estimada Hoy</p>
          <p className="text-2xl font-black text-emerald-700 mt-1">
            {formatARS(totals.estimatedProfit)}
          </p>
          <p className="text-xs text-slate-400 mt-1">Según costos cargados</p>
        </div>
      </div>

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
function FiadosModule({
  cleanStoreCode,
  customers,
  setCustomers,
  fiados,
  setFiados,
  showToast,
}) {
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
    const newCustomer = {
      id: `cust_${Date.now()}`,
      name: newName.trim(),
      phone: newPhone.trim(),
      note: newNote.trim(),
      balance: 0,
      createdAt: new Date().toISOString(),
    };
    try {
      if (hasCloudConfig && db) {
        const docRef = await addDoc(
          collection(db, 'artifacts', appId, 'public', 'data', `customers_${cleanStoreCode}`),
          { ...newCustomer, createdAt: serverTimestamp() }
        );
        newCustomer.id = docRef.id;
      } else {
        setCustomers((prev) => [newCustomer, ...prev]);
      }
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

    const entry = {
      id: `pay_${Date.now()}`,
      customerId: selectedCustomer.id,
      customerName: selectedCustomer.name,
      type: 'payment',
      amount,
      description: `Entrega (${payMethod})`,
      dateStr: getLocalDateStr(),
      createdAt: new Date().toISOString(),
    };
    const nextBalance = Math.max(0, Number(selectedCustomer.balance || 0) - amount);

    try {
      if (hasCloudConfig && db) {
        await addDoc(
          collection(db, 'artifacts', appId, 'public', 'data', `fiados_${cleanStoreCode}`),
          { ...entry, createdAt: serverTimestamp() }
        );
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
      } else {
        setFiados((prev) => [entry, ...prev]);
        setCustomers((prev) =>
          prev.map((c) => (c.id === selectedCustomer.id ? { ...c, balance: nextBalance } : c))
        );
      }

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
  cashierName,
  storeCodeInput,
  setStoreCodeInput,
  storeSettings,
  onClose,
  onSaveStoreCode,
  onSaveSettings,
}) {
  const [cashierInput, setCashierInput] = useState(cashierName || 'Caja General');
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
            Código de Sincronización (Stock Compartido)
          </p>
          <p className="text-xs text-emerald-800">
            Usá el <strong>mismo código de almacén</strong> en todas las máquinas para compartir
            stock y clientes, y poné un <strong>nombre de cajero distinto</strong> en cada equipo:
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
              onClick={() => onSaveStoreCode(storeCodeInput, cashierInput)}
              className="px-4 py-2 bg-emerald-600 text-white font-bold text-xs rounded-xl"
            >
              Guardar
            </button>
          </div>
          <div className="pt-1">
            <label className="block text-[11px] font-extrabold text-emerald-950 uppercase mb-1">
              Nombre de Cajero / Caja en este equipo
            </label>
            <input
              type="text"
              value={cashierInput}
              onChange={(e) => setCashierInput(e.target.value)}
              placeholder="Ej: Caja 1 - Juan / Caja 2 - Ana"
              className="w-full px-3 py-2 bg-white border border-emerald-300 rounded-xl font-bold text-sm"
            />
          </div>
          <p className="text-[11px] text-emerald-700">
            Almacén: <strong className="font-mono">{cleanStoreCode}</strong> • Cajero actual:{' '}
            <strong>{cashierName}</strong>
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
