import React, { useState, useEffect, useMemo, useRef } from 'react';
import { initializeApp } from 'firebase/app';
import {
  getAuth,
  signInAnonymously,
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
  writeBatch,
  increment,
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
  ScanBarcode,
  Mic,
  MicOff,
  Camera,
  Check,
  X,
  AlertTriangle,
  TrendingUp,
  Printer,
  MessageCircle,
  Lock,
  Unlock,
  UserCheck,
  RefreshCw,
  DollarSign,
  CreditCard,
  Smartphone,
  BookOpen,
  Scale,
  Edit3,
  FileText,
  Sparkles,
  Cloud,
  ArrowUpRight,
  Settings,
} from 'lucide-react';

// ============================================================================
// CONFIGURACIÓN DE FIREBASE Y ENTORNO (COMPATIBLE CON PREVIEW, VITE Y VERCEL)
// ============================================================================
const getEnvVar = (key: string, fallback = ''): string => {
  try {
    const metaEnv = (import.meta as any)?.env;
    if (metaEnv && metaEnv[key]) {
      return String(metaEnv[key]);
    }
  } catch (e) {}
  try {
    if (typeof process !== 'undefined' && process.env && process.env[key]) {
      return String(process.env[key]);
    }
  } catch (e) {}
  try {
    if (typeof window !== 'undefined' && (window as any).__ENV__ && (window as any).__ENV__[key]) {
      return String((window as any).__ENV__[key]);
    }
  } catch (e) {}
  return fallback;
};

const DEFAULT_FIREBASE_CONFIG = {
  apiKey: getEnvVar('VITE_FIREBASE_API_KEY', 'AIzaSyAYc-X5tn9JbyK3okJOhNqt63mDmXI_nRU'),
  authDomain: getEnvVar('VITE_FIREBASE_AUTH_DOMAIN', 'almacen-karen-a1151.firebaseapp.com'),
  projectId: getEnvVar('VITE_FIREBASE_PROJECT_ID', 'almacen-karen-a1151'),
  storageBucket: getEnvVar('VITE_FIREBASE_STORAGE_BUCKET', 'almacen-karen-a1151.firebasestorage.app'),
  messagingSenderId: getEnvVar('VITE_FIREBASE_MESSAGING_SENDER_ID', '391376636179'),
  appId: getEnvVar('VITE_FIREBASE_APP_ID', '1:391376636179:web:5c2c04d6e3754b5cc032e6'),
};

const GEMINI_API_KEY = getEnvVar('VITE_GEMINI_API_KEY', '');

async function resolveAvailableGeminiModels(apiKey: string): Promise<string[]> {
  const fallbackList = [
    'gemini-3-flash-preview',
    'gemini-3.0-flash',
    'gemini-2.5-flash',
    'gemini-2.5-flash-lite',
  ];

  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(apiKey)}`
    );
    if (!res.ok) return fallbackList;

    const data = await res.json();
    const supported = (data?.models || [])
      .filter(
        (m: any) =>
          Array.isArray(m.supportedGenerationMethods) &&
          m.supportedGenerationMethods.includes('generateContent')
      )
      .map((m: any) => String(m.name || '').replace(/^models\//, ''))
      .filter(Boolean);

    const flashes = supported.filter((name: string) => name.includes('flash'));
    const others = supported.filter((name: string) => !name.includes('flash'));
    const merged = Array.from(new Set([...flashes, ...others, ...fallbackList]));

    return merged.length > 0 ? merged : fallbackList;
  } catch {
    return fallbackList;
  }
}

async function callGeminiAPI(apiKey: string, contents: any[], generationConfig: any = {}) {
  const modelsToTry = await resolveAvailableGeminiModels(apiKey);
  let lastError: Error | null = null;

  for (const model of modelsToTry) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents, generationConfig }),
    });

    const data = await res.json();

    if (res.ok) {
      return data;
    }

    const msg = data?.error?.message || `Error HTTP ${res.status}`;
    lastError = new Error(msg);

    const shouldTryNextModel =
      res.status === 404 ||
      msg.toLowerCase().includes('no longer available') ||
      msg.toLowerCase().includes('not found') ||
      msg.toLowerCase().includes('not supported');

    if (!shouldTryNextModel) {
      throw lastError;
    }
  }

  throw lastError || new Error('Ningún modelo de Gemini respondió correctamente.');
}

let firebaseApp: any = null;
let auth: any = null;
let db: any = null;
let firebaseInitError: string | null = null;

try {
  const rawGlobalConfig =
    typeof window !== 'undefined' && typeof (window as any).__firebase_config !== 'undefined'
      ? JSON.parse((window as any).__firebase_config)
      : null;
  const activeConfig =
    rawGlobalConfig && rawGlobalConfig.apiKey ? rawGlobalConfig : DEFAULT_FIREBASE_CONFIG;

  if (activeConfig && activeConfig.apiKey && activeConfig.projectId) {
    firebaseApp = initializeApp(activeConfig);
    auth = getAuth(firebaseApp);
    db = getFirestore(firebaseApp);
  } else {
    firebaseInitError = 'Faltan credenciales de Firebase';
  }
} catch (err: any) {
  firebaseInitError = err?.message || 'Error inicializando Firebase';
}

const APP_ID =
  typeof window !== 'undefined' && typeof (window as any).__app_id !== 'undefined'
    ? (window as any).__app_id
    : 'almacen-control-pro';

// ============================================================================
// CONSTANTES Y UTILIDADES
// ============================================================================
const CATEGORIAS = [
  'Almacén',
  'Bebidas',
  'Fiambrería',
  'Panadería',
  'Lácteos',
  'Verdulería',
  'Limpieza',
  'Golosinas',
  'Varios',
];

const DEFAULT_CASHIERS = [
  { id: 'cajero-1', name: 'Dueño / Principal', pin: '1234', isAdmin: true },
  { id: 'cajero-2', name: 'Turno Mañana', pin: '1111', isAdmin: false },
  { id: 'cajero-3', name: 'Turno Tarde', pin: '2222', isAdmin: false },
];

const INITIAL_SAMPLE_PRODUCTS = [
  {
    id: 'prod-1',
    name: 'Yerba Mate Playadito 1kg',
    category: 'Almacén',
    code: '7793704000016',
    cost: 2900,
    price: 3800,
    stock: 18,
    minStock: 6,
    isWeighed: false,
    expiryDate: '',
  },
  {
    id: 'prod-2',
    name: 'Aceite Girasol Cocinero 1.5L',
    category: 'Almacén',
    code: '7790070411819',
    cost: 2200,
    price: 2900,
    stock: 12,
    minStock: 5,
    isWeighed: false,
    expiryDate: '',
  },
  {
    id: 'prod-3',
    name: 'Coca-Cola Sabor Original 2.25L',
    category: 'Bebidas',
    code: '7790895000997',
    cost: 2450,
    price: 3200,
    stock: 24,
    minStock: 8,
    isWeighed: false,
    expiryDate: '',
  },
  {
    id: 'prod-4',
    name: 'Queso Cremoso Punta del Agua (x Kg)',
    category: 'Fiambrería',
    code: '2000101',
    cost: 6200,
    price: 8400,
    stock: 6.5,
    minStock: 2,
    isWeighed: true,
    expiryDate: '',
  },
  {
    id: 'prod-5',
    name: 'Jamón Cocido Natural (x Kg)',
    category: 'Fiambrería',
    code: '2000102',
    cost: 8500,
    price: 11600,
    stock: 4.0,
    minStock: 1.5,
    isWeighed: true,
    expiryDate: '',
  },
  {
    id: 'prod-6',
    name: 'Pan Francés / Mignón (x Kg)',
    category: 'Panadería',
    code: '2000103',
    cost: 1400,
    price: 2200,
    stock: 10.0,
    minStock: 3,
    isWeighed: true,
    expiryDate: '',
  },
  {
    id: 'prod-7',
    name: 'Leche Entera La Serenísima 1L',
    category: 'Lácteos',
    code: '7790742034506',
    cost: 1150,
    price: 1500,
    stock: 15,
    minStock: 6,
    isWeighed: false,
    expiryDate: '',
  },
  {
    id: 'prod-8',
    name: 'Papa Negra Lavada (x Kg)',
    category: 'Verdulería',
    code: '2000104',
    cost: 650,
    price: 1000,
    stock: 25.0,
    minStock: 5,
    isWeighed: true,
    expiryDate: '',
  },
  {
    id: 'prod-9',
    name: 'Lavandina Ayudín Clásica 1L',
    category: 'Limpieza',
    code: '7793253001234',
    cost: 1200,
    price: 1700,
    stock: 14,
    minStock: 4,
    isWeighed: false,
    expiryDate: '',
  },
  {
    id: 'prod-10',
    name: 'Alfajor Jorgito Chocolate',
    category: 'Golosinas',
    code: '7790580123451',
    cost: 600,
    price: 900,
    stock: 30,
    minStock: 10,
    isWeighed: false,
    expiryDate: '',
  },
];

const formatMoney = (val: any): string => {
  const num = Number(val) || 0;
  return '$' + Math.round(num).toLocaleString('es-AR');
};

const roundPrice = (rawPrice: any, step = 100, threshold = 40): number => {
  const price = Number(rawPrice) || 0;
  if (step <= 1) return Math.round(price);
  const base = Math.floor(price / step) * step;
  const remainder = price - base;
  return remainder >= threshold ? base + step : base;
};

const formatDateTime = (ts: any): string => {
  if (!ts) return '';
  const d = new Date(ts);
  return d.toLocaleString('es-AR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
};

const isToday = (ts: any): boolean => {
  if (!ts) return false;
  const d = new Date(ts);
  const now = new Date();
  return (
    d.getDate() === now.getDate() &&
    d.getMonth() === now.getMonth() &&
    d.getFullYear() === now.getFullYear()
  );
};

// ============================================================================
// COMPONENTE PRINCIPAL: APP
// ============================================================================
export default function App() {
  const [user, setUser] = useState<any>(null);
  const [authReady, setAuthReady] = useState(false);
  const [storeCode, setStoreCode] = useState(() => {
    try {
      return localStorage.getItem('almacen_store_code') || 'ALMACEN-KAREN';
    } catch {
      return 'ALMACEN-KAREN';
    }
  });
  const [showSyncModal, setShowSyncModal] = useState(false);
  const [tempStoreCode, setTempStoreCode] = useState(storeCode);

  const [products, setProducts] = useState<any[]>([]);
  const [sales, setSales] = useState<any[]>([]);
  const [expenses, setExpenses] = useState<any[]>([]);
  const [customers, setCustomers] = useState<any[]>([]);
  const [cashiers, setCashiers] = useState<any[]>(DEFAULT_CASHIERS);
  const [cart, setCart] = useState<any[]>([]);
  const [storeSettings, setStoreSettings] = useState({
    name: 'Mi Almacén',
    roundStep: 100,
    roundThreshold: 40,
    adminPin: '1234',
  });

  const [activeTab, setActiveTab] = useState('pos');
  const [activeCashier, setActiveCashier] = useState<any>(null);
  const [showTurnModal, setShowTurnModal] = useState(true);
  const [pinTargetCashier, setPinTargetCashier] = useState<any>(null);
  const [pinInput, setPinInput] = useState('');
  const [pinError, setPinError] = useState('');
  const [newCashierName, setNewCashierName] = useState('');
  const [newCashierPin, setNewCashierPin] = useState('');

  const [isAdminUnlocked, setIsAdminUnlocked] = useState(false);
  const [showAdminPinModal, setShowAdminPinModal] = useState(false);
  const [adminPinInput, setAdminPinInput] = useState('');
  const [adminPinError, setAdminPinError] = useState('');

  const [toast, setToast] = useState<{ msg: string; type: string } | null>(null);
  const [firestorePermissionDenied, setFirestorePermissionDenied] = useState(false);
  const showToast = (msg: string, type = 'success') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3200);
  };

  useEffect(() => {
    if (!auth) {
      setAuthReady(true);
      return;
    }
    const unsub = onAuthStateChanged(auth, async (u) => {
      if (u) {
        setUser(u);
        setAuthReady(true);
      } else {
        try {
          await signInAnonymously(auth);
        } catch (err: any) {
          console.warn('Auth anónima no disponible o bloqueada:', err?.message || err);
          setAuthReady(true);
        }
      }
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    if (!db || !authReady) return;

    if (!user) {
      setProducts((prev) => (prev.length > 0 ? prev : INITIAL_SAMPLE_PRODUCTS));
      return;
    }

    const cleanCode =
      storeCode.trim().toUpperCase().replace(/[^A-Z0-9_-]/g, '') || 'ALMACEN-KAREN';
    const baseRef = doc(db, 'artifacts', APP_ID, 'public', 'data', 'stores', cleanCode);

    const handleSnapshotError = (label: string) => (err: any) => {
      const msg = String(err?.message || err || '');
      if (msg.toLowerCase().includes('permission') || err?.code === 'permission-denied') {
        setFirestorePermissionDenied(true);
        setProducts((prev) => (prev.length > 0 ? prev : INITIAL_SAMPLE_PRODUCTS));
      } else {
        console.error(`Error ${label}:`, err);
      }
    };

    const unsubProducts = onSnapshot(
      collection(baseRef, 'products'),
      async (snap) => {
        setFirestorePermissionDenied(false);
        if (snap.empty) {
          try {
            const batch = writeBatch(db);
            INITIAL_SAMPLE_PRODUCTS.forEach((p) => {
              batch.set(doc(baseRef, 'products', p.id), p);
            });
            await batch.commit();
          } catch (seedErr) {
            setProducts((prev) => (prev.length > 0 ? prev : INITIAL_SAMPLE_PRODUCTS));
            handleSnapshotError('sembrando productos')(seedErr);
          }
        } else {
          const list = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
          list.sort((a: any, b: any) => (a.name || '').localeCompare(b.name || ''));
          setProducts(list);
        }
      },
      handleSnapshotError('productos')
    );

    const unsubSales = onSnapshot(
      collection(baseRef, 'sales'),
      (snap) => {
        setFirestorePermissionDenied(false);
        const list = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        list.sort((a: any, b: any) => (b.timestamp || 0) - (a.timestamp || 0));
        setSales(list);
      },
      handleSnapshotError('ventas')
    );

    const unsubExpenses = onSnapshot(
      collection(baseRef, 'expenses'),
      (snap) => {
        setFirestorePermissionDenied(false);
        const list = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        list.sort((a: any, b: any) => (b.timestamp || 0) - (a.timestamp || 0));
        setExpenses(list);
      },
      handleSnapshotError('gastos')
    );

    const unsubCustomers = onSnapshot(
      collection(baseRef, 'customers'),
      (snap) => {
        setFirestorePermissionDenied(false);
        const list = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        list.sort((a: any, b: any) => (a.name || '').localeCompare(b.name || ''));
        setCustomers(list);
      },
      handleSnapshotError('clientes')
    );

    const unsubConfig = onSnapshot(
      doc(baseRef, 'meta', 'settings'),
      (snap) => {
        setFirestorePermissionDenied(false);
        if (snap.exists()) {
          const data = snap.data();
          if (data.cashiers && Array.isArray(data.cashiers) && data.cashiers.length > 0) {
            setCashiers(data.cashiers);
          }
          if (data.storeSettings) {
            setStoreSettings((prev) => ({ ...prev, ...data.storeSettings }));
          }
        } else {
          setDoc(doc(baseRef, 'meta', 'settings'), {
            cashiers: DEFAULT_CASHIERS,
            storeSettings,
          }).catch(() => {});
        }
      },
      handleSnapshotError('settings')
    );

    return () => {
      unsubProducts();
      unsubSales();
      unsubExpenses();
      unsubCustomers();
      unsubConfig();
    };
  }, [user, authReady, storeCode]);

  const getStoreDocRef = () => {
    const cleanCode =
      storeCode.trim().toUpperCase().replace(/[^A-Z0-9_-]/g, '') || 'ALMACEN-KAREN';
    return doc(db, 'artifacts', APP_ID, 'public', 'data', 'stores', cleanCode);
  };

  const handleSelectCashier = (cashier: any) => {
    setPinError('');
    setPinInput('');
    if (cashier.pin) {
      setPinTargetCashier(cashier);
    } else {
      setActiveCashier(cashier);
      setShowTurnModal(false);
      showToast(`Bienvenido/a, ${cashier.name}`);
    }
  };

  const handleConfirmCashierPin = (e: React.FormEvent) => {
    e.preventDefault();
    if (!pinTargetCashier) return;
    if (pinInput.trim() === String(pinTargetCashier.pin).trim()) {
      setActiveCashier(pinTargetCashier);
      setPinTargetCashier(null);
      setPinInput('');
      setPinError('');
      setShowTurnModal(false);
      showToast(`Bienvenido/a, ${pinTargetCashier.name}`);
    } else {
      setPinError('Contraseña incorrecta');
    }
  };

  const handleCreateCashier = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCashierName.trim()) return;
    const newItem = {
      id: 'cajero-' + Date.now(),
      name: newCashierName.trim(),
      pin: newCashierPin.trim() || '',
      isAdmin: false,
    };
    const updated = [...cashiers, newItem];
    setCashiers(updated);
    setNewCashierName('');
    setNewCashierPin('');
    if (db && user) {
      await setDoc(
        doc(getStoreDocRef(), 'meta', 'settings'),
        { cashiers: updated, storeSettings },
        { merge: true }
      ).catch(() => {});
    }
    showToast(`Cajero "${newItem.name}" agregado`);
  };

  const handleDeleteCashier = async (id: string) => {
    if (cashiers.length <= 1) {
      showToast('Debe quedar al menos un cajero', 'error');
      return;
    }
    const updated = cashiers.filter((c) => c.id !== id);
    setCashiers(updated);
    if (db && user) {
      await setDoc(
        doc(getStoreDocRef(), 'meta', 'settings'),
        { cashiers: updated },
        { merge: true }
      ).catch(() => {});
    }
  };

  const handleSaveStoreCode = (e: React.FormEvent) => {
    e.preventDefault();
    const cleaned = tempStoreCode.trim().toUpperCase().replace(/[^A-Z0-9_-]/g, '');
    if (!cleaned) return;
    setStoreCode(cleaned);
    try {
      localStorage.setItem('almacen_store_code', cleaned);
    } catch {}
    setShowSyncModal(false);
    showToast(`Sincronizado con código: ${cleaned}`);
  };

  const handleAdminUnlockSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const masterPin = storeSettings.adminPin || '1234';
    if (adminPinInput === masterPin) {
      setIsAdminUnlocked(true);
      setShowAdminPinModal(false);
      setAdminPinInput('');
      setAdminPinError('');
      showToast('Modo Administrador desbloqueado');
    } else {
      setAdminPinError('PIN incorrecto (por defecto: 1234)');
    }
  };

  const todaySales = useMemo(() => sales.filter((s) => isToday(s.timestamp)), [sales]);
  const todayExpenses = useMemo(() => expenses.filter((e) => isToday(e.timestamp)), [expenses]);
  const lowStockCount = useMemo(
    () => products.filter((p) => Number(p.stock) <= Number(p.minStock || 0)).length,
    [products]
  );

  if (firebaseInitError) {
    return (
      <div className="min-h-screen w-full bg-slate-950 text-white flex items-center justify-center p-6">
        <div className="max-w-md w-full bg-slate-900 border border-slate-800 rounded-3xl p-8 text-center">
          <AlertTriangle className="w-12 h-12 text-amber-400 mx-auto mb-4" />
          <h1 className="text-xl font-bold mb-2">Error de Conexión</h1>
          <p className="text-slate-400 text-sm">{firebaseInitError}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen w-full bg-slate-100 text-slate-900 flex flex-col md:flex-row font-sans">
      <style>{`
        @media print {
          body * {
            visibility: hidden !important;
          }
          #printable-ticket-area, #printable-ticket-area * {
            visibility: visible !important;
          }
          #printable-ticket-area {
            position: fixed !important;
            left: 0 !important;
            top: 0 !important;
            width: 80mm !important;
            background: white !important;
            color: black !important;
            padding: 8px !important;
            box-shadow: none !important;
          }
        }
      `}</style>

      {toast && (
        <div
          className={`fixed top-4 right-4 z-[100] px-4 py-3 rounded-2xl shadow-xl font-semibold text-sm flex items-center gap-2 transition-all ${
            toast.type === 'error'
              ? 'bg-rose-600 text-white'
              : 'bg-emerald-600 text-white'
          }`}
        >
          {toast.type === 'error' ? (
            <AlertTriangle className="w-4 h-4" />
          ) : (
            <Check className="w-4 h-4" />
          )}
          <span>{toast.msg}</span>
        </div>
      )}

      <header className="md:hidden bg-slate-900 text-white px-3.5 py-2.5 flex items-center justify-between gap-2 sticky top-0 z-30 shadow-md">
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-9 h-9 rounded-xl bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center text-emerald-400 shrink-0">
            <ShoppingCart className="w-5 h-5" />
          </div>
          <div className="min-w-0">
            <div className="font-bold text-sm leading-tight truncate">{storeSettings.name}</div>
            <button
              type="button"
              onClick={() => {
                setTempStoreCode(storeCode);
                setShowSyncModal(true);
              }}
              className="text-[11px] text-emerald-400 flex items-center gap-1 truncate"
            >
              <Cloud className="w-3 h-3 shrink-0" />
              <span className="truncate">{storeCode}</span>
            </button>
          </div>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          <button
            type="button"
            onClick={() => {
              setPinTargetCashier(null);
              setShowTurnModal(true);
            }}
            className="px-2.5 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-xs font-semibold flex items-center gap-1.5"
          >
            <UserCheck className="w-3.5 h-3.5 text-sky-400 shrink-0" />
            <span className="max-w-[76px] truncate">
              {activeCashier ? activeCashier.name : 'Turno'}
            </span>
          </button>

          <button
            type="button"
            onClick={() =>
              isAdminUnlocked ? setIsAdminUnlocked(false) : setShowAdminPinModal(true)
            }
            aria-label={
              isAdminUnlocked ? 'Bloquear modo administrador' : 'Desbloquear modo administrador'
            }
            className={`p-2 rounded-xl text-xs font-semibold flex items-center justify-center ${
              isAdminUnlocked
                ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                : 'bg-slate-800 text-slate-200 border border-slate-700'
            }`}
          >
            {isAdminUnlocked ? <Unlock className="w-4 h-4" /> : <Lock className="w-4 h-4" />}
          </button>
        </div>
      </header>

      <aside className="hidden md:flex md:w-72 md:flex-col bg-slate-900 text-white p-5 shrink-0 justify-between sticky top-0 h-screen">
        <div>
          <div className="flex items-center gap-3 mb-8">
            <div className="w-11 h-11 rounded-2xl bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center text-emerald-400">
              <ShoppingCart className="w-6 h-6" />
            </div>
            <div>
              <h1 className="font-extrabold text-lg tracking-tight leading-none">
                {storeSettings.name}
              </h1>
              <span className="text-[11px] font-bold tracking-widest text-emerald-400 uppercase">
                Mostrador Pro
              </span>
            </div>
          </div>

          <nav className="space-y-2">
            <button
              onClick={() => setActiveTab('pos')}
              className={`w-full flex items-center gap-3.5 px-4 py-3.5 rounded-2xl text-left transition-all ${
                activeTab === 'pos'
                  ? 'bg-emerald-600 text-white shadow-lg shadow-emerald-950/50'
                  : 'text-slate-300 hover:bg-slate-800/80'
              }`}
            >
              <ShoppingCart className="w-5 h-5 shrink-0" />
              <div>
                <div className="font-bold text-sm">Punto de Venta</div>
                <div className="text-[11px] opacity-80">Balanza, señas y cobro</div>
              </div>
            </button>

            <button
              onClick={() => setActiveTab('products')}
              className={`w-full flex items-center gap-3.5 px-4 py-3.5 rounded-2xl text-left transition-all ${
                activeTab === 'products'
                  ? 'bg-emerald-600 text-white shadow-lg shadow-emerald-950/50'
                  : 'text-slate-300 hover:bg-slate-800/80'
              }`}
            >
              <Package className="w-5 h-5 shrink-0" />
              <div>
                <div className="font-bold text-sm">Productos y Stock</div>
                <div className="text-[11px] opacity-80">Precios, barras y boletas</div>
              </div>
            </button>

            <button
              onClick={() => setActiveTab('cash')}
              className={`w-full flex items-center justify-between px-4 py-3.5 rounded-2xl text-left transition-all ${
                activeTab === 'cash'
                  ? 'bg-emerald-600 text-white shadow-lg shadow-emerald-950/50'
                  : 'text-slate-300 hover:bg-slate-800/80'
              }`}
            >
              <div className="flex items-center gap-3.5">
                <Wallet className="w-5 h-5 shrink-0" />
                <div>
                  <div className="font-bold text-sm">Caja y Faltantes</div>
                  <div className="text-[11px] opacity-80">Cierre diario y alertas</div>
                </div>
              </div>
              {lowStockCount > 0 && (
                <span className="px-2 py-0.5 text-xs font-bold rounded-full bg-amber-500 text-slate-950">
                  {lowStockCount}
                </span>
              )}
            </button>

            <button
              onClick={() => setActiveTab('customers')}
              className={`w-full flex items-center gap-3.5 px-4 py-3.5 rounded-2xl text-left transition-all ${
                activeTab === 'customers'
                  ? 'bg-emerald-600 text-white shadow-lg shadow-emerald-950/50'
                  : 'text-slate-300 hover:bg-slate-800/80'
              }`}
            >
              <Users className="w-5 h-5 shrink-0" />
              <div>
                <div className="font-bold text-sm">Clientes y Fiados</div>
                <div className="text-[11px] opacity-80">Agenda y WhatsApp</div>
              </div>
            </button>
          </nav>
        </div>

        <div className="space-y-2.5 pt-4 border-t border-slate-800">
          <button
            onClick={() => {
              setPinTargetCashier(null);
              setShowTurnModal(true);
            }}
            className="w-full p-3 rounded-2xl bg-slate-800/90 hover:bg-slate-800 border border-slate-700/80 flex items-center justify-between text-left transition"
          >
            <div className="flex items-center gap-2.5 min-w-0">
              <UserCheck className="w-4 h-4 text-sky-400 shrink-0" />
              <div className="truncate">
                <div className="text-xs font-bold text-white truncate">
                  Cajero: {activeCashier ? activeCashier.name : 'Sin asignar'}
                </div>
                <div className="text-[10px] text-slate-400">Turno activo en mostrador</div>
              </div>
            </div>
            <span className="text-[11px] font-bold text-sky-400 shrink-0">Cambiar</span>
          </button>

          <button
            onClick={() =>
              isAdminUnlocked ? setIsAdminUnlocked(false) : setShowAdminPinModal(true)
            }
            className="w-full p-3 rounded-2xl bg-slate-800/90 hover:bg-slate-800 border border-slate-700/80 flex items-center justify-between text-left transition"
          >
            <div className="flex items-center gap-2.5">
              {isAdminUnlocked ? (
                <Unlock className="w-4 h-4 text-emerald-400" />
              ) : (
                <Lock className="w-4 h-4 text-amber-400" />
              )}
              <div>
                <div className="text-xs font-bold text-white">
                  {isAdminUnlocked ? 'Admin Activo' : 'Modo Cajero'}
                </div>
                <div className="text-[10px] text-slate-400">
                  {isAdminUnlocked ? 'Costos visibles' : 'Costos protegidos'}
                </div>
              </div>
            </div>
            <span className="text-[11px] font-bold text-emerald-400">
              {isAdminUnlocked ? 'Bloquear' : 'Desbloquear'}
            </span>
          </button>

          <button
            onClick={() => {
              setTempStoreCode(storeCode);
              setShowSyncModal(true);
            }}
            className="w-full p-3 rounded-2xl bg-slate-800/90 hover:bg-slate-800 border border-slate-700/80 flex items-center justify-between text-left transition"
          >
            <div className="flex items-center gap-2.5 min-w-0">
              <Cloud className="w-4 h-4 text-emerald-400 shrink-0" />
              <div className="truncate">
                <div className="text-xs font-bold text-white truncate">
                  Código: {storeCode}
                </div>
                <div className="text-[10px] text-slate-400">Vincular PC + Celular</div>
              </div>
            </div>
            <Settings className="w-4 h-4 text-slate-400 shrink-0" />
          </button>
        </div>
      </aside>

      <main className="flex-1 min-w-0 pb-20 md:pb-6">
        {firestorePermissionDenied && (
          <div className="mx-4 md:mx-6 mt-4 p-4 rounded-2xl bg-amber-50 border border-amber-300 text-amber-950 text-xs flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-start gap-2.5">
              <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
              <div>
                <div className="font-extrabold">
                  Firestore bloqueó la lectura/escritura (Missing or insufficient permissions)
                </div>
                <p className="mt-0.5 text-amber-900">
                  En <strong>Firebase Console → Firestore Database → Reglas</strong>, asegurá{' '}
                  <strong>Authentication → Anónimo</strong> activado y publicá{' '}
                  <code className="bg-amber-100 px-1.5 py-0.5 rounded font-mono">
                    allow read, write: if request.auth != null;
                  </code>{' '}
                  (mientras tanto ves productos de muestra locales).
                </p>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'pos' && (
          <POSModule
            products={products}
            customers={customers}
            todaySales={todaySales}
            cart={cart}
            setCart={setCart}
            roundStep={storeSettings.roundStep}
            roundThreshold={storeSettings.roundThreshold}
            storeName={storeSettings.name}
            activeCashier={activeCashier}
            db={db}
            user={user}
            getStoreDocRef={getStoreDocRef}
            showToast={showToast}
          />
        )}

        {activeTab === 'products' && (
          <ProductsModule
            products={products}
            isAdminUnlocked={isAdminUnlocked}
            roundStep={storeSettings.roundStep}
            roundThreshold={storeSettings.roundThreshold}
            storeName={storeSettings.name}
            db={db}
            user={user}
            getStoreDocRef={getStoreDocRef}
            showToast={showToast}
            onRequestAdmin={() => setShowAdminPinModal(true)}
          />
        )}

        {activeTab === 'cash' && (
          <CashModule
            todaySales={todaySales}
            todayExpenses={todayExpenses}
            products={products}
            activeCashier={activeCashier}
            db={db}
            user={user}
            getStoreDocRef={getStoreDocRef}
            showToast={showToast}
          />
        )}

        {activeTab === 'customers' && (
          <CustomersModule
            customers={customers}
            storeName={storeSettings.name}
            activeCashier={activeCashier}
            db={db}
            user={user}
            getStoreDocRef={getStoreDocRef}
            showToast={showToast}
          />
        )}
      </main>

      <nav className="md:hidden fixed bottom-0 inset-x-0 bg-slate-900 text-slate-300 border-t border-slate-800 grid grid-cols-4 py-2 z-30">
        <button
          onClick={() => setActiveTab('pos')}
          className={`flex flex-col items-center justify-center gap-1 py-1 ${
            activeTab === 'pos' ? 'text-emerald-400 font-bold' : ''
          }`}
        >
          <ShoppingCart className="w-5 h-5" />
          <span className="text-[11px]">Vender</span>
        </button>

        <button
          onClick={() => setActiveTab('products')}
          className={`flex flex-col items-center justify-center gap-1 py-1 ${
            activeTab === 'products' ? 'text-emerald-400 font-bold' : ''
          }`}
        >
          <Package className="w-5 h-5" />
          <span className="text-[11px]">Productos</span>
        </button>

        <button
          onClick={() => setActiveTab('cash')}
          className={`flex flex-col items-center justify-center gap-1 py-1 relative ${
            activeTab === 'cash' ? 'text-emerald-400 font-bold' : ''
          }`}
        >
          <Wallet className="w-5 h-5" />
          <span className="text-[11px]">Caja</span>
          {lowStockCount > 0 && (
            <span className="absolute top-0.5 right-5 w-4 h-4 rounded-full bg-amber-500 text-slate-950 text-[10px] font-extrabold flex items-center justify-center">
              {lowStockCount}
            </span>
          )}
        </button>

        <button
          onClick={() => setActiveTab('customers')}
          className={`flex flex-col items-center justify-center gap-1 py-1 ${
            activeTab === 'customers' ? 'text-emerald-400 font-bold' : ''
          }`}
        >
          <Users className="w-5 h-5" />
          <span className="text-[11px]">Fiados</span>
        </button>
      </nav>

      {showTurnModal && (
        <div className="fixed inset-0 bg-slate-950/75 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl max-w-md w-full p-6 shadow-2xl">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2.5">
                <Users className="w-6 h-6 text-sky-600" />
                <h2 className="text-xl font-extrabold text-slate-900">
                  {activeCashier ? 'Cajeros y Turnos' : 'Inicio de Turno - Identificate'}
                </h2>
              </div>
              {activeCashier && (
                <button
                  onClick={() => {
                    setPinTargetCashier(null);
                    setShowTurnModal(false);
                  }}
                  className="p-2 rounded-xl bg-slate-100 text-slate-500 hover:bg-slate-200"
                >
                  <X className="w-5 h-5" />
                </button>
              )}
            </div>

            {pinTargetCashier ? (
              <form onSubmit={handleConfirmCashierPin} className="space-y-4">
                <div className="p-4 rounded-2xl bg-sky-50 border border-sky-200 text-center">
                  <div className="text-xs text-sky-700 font-semibold uppercase">
                    Ingresando como
                  </div>
                  <div className="text-lg font-extrabold text-slate-900">
                    {pinTargetCashier.name}
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-600 mb-1.5">
                    Contraseña / PIN del cajero
                  </label>
                  <input
                    type="password"
                    inputMode="numeric"
                    autoFocus
                    value={pinInput}
                    onChange={(e) => setPinInput(e.target.value)}
                    placeholder="••••"
                    className="w-full px-4 py-3 rounded-2xl border border-slate-300 text-center text-2xl font-bold tracking-widest focus:outline-none focus:border-sky-500"
                  />
                  {pinError && (
                    <p className="text-rose-600 text-xs font-semibold mt-1.5 text-center">
                      {pinError}
                    </p>
                  )}
                </div>

                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setPinTargetCashier(null)}
                    className="flex-1 py-3 rounded-2xl bg-slate-100 text-slate-700 font-bold text-sm"
                  >
                    Volver
                  </button>
                  <button
                    type="submit"
                    className="flex-1 py-3 rounded-2xl bg-sky-600 text-white font-bold text-sm hover:bg-sky-700"
                  >
                    Entrar al Turno
                  </button>
                </div>
              </form>
            ) : (
              <>
                <p className="text-xs text-slate-500 mb-4 text-center">
                  Seleccioná quién entra al turno (pedirá su PIN si tiene contraseña configurada):
                </p>

                <div className="space-y-2.5 max-h-60 overflow-y-auto mb-5">
                  {cashiers.map((c) => {
                    const isCurrent = activeCashier?.id === c.id;
                    return (
                      <div
                        key={c.id}
                        className={`flex items-center justify-between gap-2 p-3 rounded-2xl border transition ${
                          isCurrent
                            ? 'border-sky-500 bg-sky-50/70'
                            : 'border-slate-200 hover:border-sky-400 hover:bg-slate-50'
                        }`}
                      >
                        <button
                          type="button"
                          onClick={() => handleSelectCashier(c)}
                          className="flex-1 min-w-0 flex items-center gap-3 text-left"
                        >
                          <div
                            className={`w-4 h-4 rounded-full border-2 flex items-center justify-center shrink-0 ${
                              isCurrent ? 'border-sky-600' : 'border-slate-300'
                            }`}
                          >
                            {isCurrent && (
                              <div className="w-2 h-2 rounded-full bg-sky-600" />
                            )}
                          </div>
                          <span className="font-bold text-slate-900 text-sm truncate">
                            {c.name}
                          </span>
                          {c.pin && (
                            <span className="px-2 py-0.5 rounded-md bg-slate-100 text-slate-500 text-[10px] font-bold flex items-center gap-1 shrink-0">
                              <Lock className="w-2.5 h-2.5" /> PIN
                            </span>
                          )}
                          {isCurrent && (
                            <span className="px-2 py-0.5 rounded-full bg-sky-600 text-white text-[10px] font-bold shrink-0">
                              ACTIVO
                            </span>
                          )}
                        </button>

                        <button
                          type="button"
                          onClick={() => handleDeleteCashier(c.id)}
                          className="p-2 text-slate-400 hover:text-rose-600 rounded-lg shrink-0"
                          title="Eliminar cajero"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    );
                  })}
                </div>

                <form
                  onSubmit={handleCreateCashier}
                  className="pt-4 border-t border-slate-100"
                >
                  <div className="text-xs font-extrabold text-slate-700 mb-2 text-center">
                    Agregar cajero con su contraseña (PIN):
                  </div>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={newCashierName}
                      onChange={(e) => setNewCashierName(e.target.value)}
                      placeholder="Nombre (ej: Sofía)"
                      className="flex-1 min-w-0 px-3 py-2.5 rounded-xl border border-slate-300 text-sm focus:outline-none focus:border-sky-500"
                    />
                    <input
                      type="text"
                      inputMode="numeric"
                      value={newCashierPin}
                      onChange={(e) => setNewCashierPin(e.target.value)}
                      placeholder="PIN (ej: 4545)"
                      className="w-24 px-3 py-2.5 rounded-xl border border-slate-300 text-sm focus:outline-none focus:border-sky-500"
                    />
                    <button
                      type="submit"
                      className="px-4 py-2.5 rounded-xl bg-sky-600 text-white font-bold text-sm hover:bg-sky-700 shrink-0"
                    >
                      + Crear
                    </button>
                  </div>
                  <p className="text-[10px] text-slate-400 text-center mt-2.5">
                    Por defecto: Dueño (1234), Turno Mañana (1111), Turno Tarde (2222).
                  </p>
                </form>
              </>
            )}
          </div>
        </div>
      )}

      {showAdminPinModal && (
        <div className="fixed inset-0 bg-slate-950/75 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl max-w-sm w-full p-6 shadow-2xl">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <Lock className="w-5 h-5 text-amber-500" />
                <h3 className="font-extrabold text-lg">Modo Administrador</h3>
              </div>
              <button
                onClick={() => setShowAdminPinModal(false)}
                className="p-1.5 rounded-xl bg-slate-100 text-slate-500"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <p className="text-xs text-slate-500 mb-4">
              Ingresá el PIN de dueño para ver costos, márgenes y editar precios masivamente:
            </p>
            <form onSubmit={handleAdminUnlockSubmit} className="space-y-4">
              <input
                type="password"
                inputMode="numeric"
                autoFocus
                value={adminPinInput}
                onChange={(e) => setAdminPinInput(e.target.value)}
                placeholder="••••"
                className="w-full px-4 py-3 rounded-2xl border border-slate-300 text-center text-2xl font-bold tracking-widest"
              />
              {adminPinError && (
                <p className="text-rose-600 text-xs font-semibold text-center">
                  {adminPinError}
                </p>
              )}
              <button
                type="submit"
                className="w-full py-3 rounded-2xl bg-emerald-600 text-white font-bold text-sm hover:bg-emerald-700"
              >
                Desbloquear
              </button>
            </form>
          </div>
        </div>
      )}

      {showSyncModal && (
        <div className="fixed inset-0 bg-slate-950/75 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl max-w-md w-full p-6 shadow-2xl">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <Cloud className="w-5 h-5 text-emerald-600" />
                <h3 className="font-extrabold text-lg">Sincronizar PC y Celular</h3>
              </div>
              <button
                onClick={() => setShowSyncModal(false)}
                className="p-1.5 rounded-xl bg-slate-100 text-slate-500"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <p className="text-xs text-slate-600 mb-4">
              Escribí el <strong>mismo código</strong> en todos tus dispositivos (PC y celulares) para compartir productos, stock, ventas y fiados en tiempo real:
            </p>
            <form onSubmit={handleSaveStoreCode} className="space-y-4">
              <input
                type="text"
                value={tempStoreCode}
                onChange={(e) => setTempStoreCode(e.target.value.toUpperCase())}
                placeholder="EJ: ALMACEN-KAREN"
                className="w-full px-4 py-3 rounded-2xl border border-slate-300 text-center text-lg font-extrabold tracking-wider uppercase"
              />
              <button
                type="submit"
                className="w-full py-3 rounded-2xl bg-emerald-600 text-white font-bold text-sm hover:bg-emerald-700"
              >
                Guardar y Sincronizar
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// MÓDULO 1: PUNTO DE VENTA (POS) + BALANZA + VOZ IA + TICKETS
// ============================================================================
function POSModule({
  products,
  customers,
  todaySales,
  cart,
  setCart,
  roundStep,
  roundThreshold,
  storeName,
  activeCashier,
  db,
  user,
  getStoreDocRef,
  showToast,
}: any) {
  const [search, setSearch] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('Todos');

  const [scaleProduct, setScaleProduct] = useState<any>(null);
  const [scaleGrams, setScaleGrams] = useState('250');
  const [showVoiceModal, setShowVoiceModal] = useState(false);
  const [showScannerModal, setShowScannerModal] = useState(false);
  const [showTicketsModal, setShowTicketsModal] = useState(false);
  const [printableTicketSale, setPrintableTicketSale] = useState<any>(null);

  const [checkoutMode, setCheckoutMode] = useState<string | null>(null);
  const [paymentMethod, setPaymentMethod] = useState('Efectivo');
  const [cashReceived, setCashReceived] = useState('');
  const [mixedCash, setMixedCash] = useState('');
  const [mixedDigitalMethod, setMixedDigitalMethod] = useState('Mercado Pago / QR');
  const [selectedCustomerId, setSelectedCustomerId] = useState('');

  const searchInputRef = useRef<HTMLInputElement>(null);

  const filteredProducts = useMemo(() => {
    const q = search.trim().toLowerCase();
    return products.filter((p: any) => {
      const matchCat = selectedCategory === 'Todos' || p.category === selectedCategory;
      const matchQuery =
        !q ||
        (p.name || '').toLowerCase().includes(q) ||
        (p.code || '').toLowerCase().includes(q);
      return matchCat && matchQuery;
    });
  }, [products, search, selectedCategory]);

  const handleSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && search.trim()) {
      const exact = products.find(
        (p: any) => (p.code || '').trim().toLowerCase() === search.trim().toLowerCase()
      );
      if (exact) {
        e.preventDefault();
        handleProductClick(exact);
        setSearch('');
      }
    }
  };

  const handleProductClick = (product: any) => {
    if (product.isWeighed) {
      setScaleProduct(product);
      setScaleGrams('250');
    } else {
      addToCart(product, 1);
    }
  };

  const addToCart = (product: any, qty = 1, customSubtotal: number | null = null) => {
    setCart((prev: any[]) => {
      const existingIndex = prev.findIndex(
        (item) => item.id === product.id && !product.isWeighed
      );
      if (existingIndex >= 0) {
        const updated = [...prev];
        const nextQty = updated[existingIndex].qty + qty;
        updated[existingIndex] = {
          ...updated[existingIndex],
          qty: nextQty,
          subtotal: roundPrice(nextQty * product.price, roundStep, roundThreshold),
        };
        return updated;
      }
      const rawSub =
        customSubtotal !== null ? customSubtotal : qty * Number(product.price || 0);
      return [
        ...prev,
        {
          cartItemId: product.id + '-' + Date.now() + '-' + Math.random(),
          id: product.id,
          name: product.name,
          price: Number(product.price || 0),
          isWeighed: !!product.isWeighed,
          qty,
          subtotal: roundPrice(rawSub, roundStep, roundThreshold),
        },
      ];
    });
  };

  const handleConfirmScale = (e: React.FormEvent) => {
    e.preventDefault();
    if (!scaleProduct) return;
    const grams = parseFloat(scaleGrams) || 0;
    if (grams <= 0) return;
    const kg = grams / 1000;
    const rawSub = kg * Number(scaleProduct.price || 0);
    addToCart(scaleProduct, kg, rawSub);
    setScaleProduct(null);
  };

  const addCustomLine = (label: string, amount: number) => {
    setCart((prev: any[]) => [
      ...prev,
      {
        cartItemId: 'custom-' + Date.now() + '-' + Math.random(),
        id: null,
        name: label,
        price: amount,
        isWeighed: false,
        qty: 1,
        subtotal: amount,
      },
    ]);
  };

  const updateCartQty = (cartItemId: string, delta: number) => {
    setCart((prev: any[]) =>
      prev
        .map((item) => {
          if (item.cartItemId !== cartItemId) return item;
          const nextQty = item.qty + delta;
          if (nextQty <= 0) return null;
          return {
            ...item,
            qty: nextQty,
            subtotal: roundPrice(nextQty * item.price, roundStep, roundThreshold),
          };
        })
        .filter(Boolean)
    );
  };

  const removeCartItem = (cartItemId: string) => {
    setCart((prev: any[]) => prev.filter((item) => item.cartItemId !== cartItemId));
  };

  const cartTotal = useMemo(
    () => cart.reduce((acc: number, item: any) => acc + Number(item.subtotal || 0), 0),
    [cart]
  );

  const handleFinalizeSale = async () => {
    if (cart.length === 0) return;

    let payments: any[] = [];
    let customerName = '';

    if (checkoutMode === 'single') {
      payments = [{ method: paymentMethod, amount: cartTotal }];
    } else if (checkoutMode === 'mixed') {
      const cashPart = Math.min(cartTotal, Math.max(0, Number(mixedCash) || 0));
      const digitalPart = Math.max(0, cartTotal - cashPart);
      if (cashPart > 0) payments.push({ method: 'Efectivo', amount: cashPart });
      if (digitalPart > 0)
        payments.push({ method: mixedDigitalMethod, amount: digitalPart });
    } else if (checkoutMode === 'fiado') {
      const cust = customers.find((c: any) => c.id === selectedCustomerId);
      if (!cust) {
        showToast('Seleccioná un cliente de la libreta', 'error');
        return;
      }
      customerName = cust.name;
      payments = [{ method: 'Fiado', amount: cartTotal }];
    }

    const saleRecord: any = {
      timestamp: Date.now(),
      items: cart,
      total: cartTotal,
      payments,
      customerId: checkoutMode === 'fiado' ? selectedCustomerId : null,
      customerName,
      cashierName: activeCashier ? activeCashier.name : 'Mostrador',
    };

    try {
      if (db && user) {
        const storeRef = getStoreDocRef();
        const docRef = await addDoc(collection(storeRef, 'sales'), saleRecord);
        saleRecord.id = docRef.id;

        const batch = writeBatch(db);
        cart.forEach((item: any) => {
          if (item.id) {
            const prodRef = doc(storeRef, 'products', item.id);
            batch.update(prodRef, { stock: increment(-Number(item.qty || 0)) });
          }
        });

        if (checkoutMode === 'fiado' && selectedCustomerId) {
          const custRef = doc(storeRef, 'customers', selectedCustomerId);
          batch.update(custRef, { debt: increment(cartTotal) });
        }

        await batch.commit();
      } else {
        saleRecord.id = 'local-' + Date.now();
      }

      setCart([]);
      setCheckoutMode(null);
      setCashReceived('');
      setMixedCash('');
      setPrintableTicketSale(saleRecord);
      showToast(`Venta registrada por ${formatMoney(cartTotal)}`);
    } catch (err) {
      console.error('Error al cobrar:', err);
      showToast('Error al guardar la venta', 'error');
    }
  };

  const buildWhatsAppTicketText = (sale: any) => {
    const lines = [
      `*${storeName}*`,
      `Fecha: ${formatDateTime(sale.timestamp)}`,
      `Atendido por: ${sale.cashierName || 'Mostrador'}`,
      sale.customerName ? `Cliente: ${sale.customerName}` : '',
      '------------------------',
      ...(sale.items || []).map((i: any) => {
        const qtyLabel = i.isWeighed ? `${(i.qty * 1000).toFixed(0)}g` : `${i.qty}x`;
        return `${qtyLabel} ${i.name}: ${formatMoney(i.subtotal)}`;
      }),
      '------------------------',
      `*TOTAL: ${formatMoney(sale.total)}*`,
      `Pago: ${(sale.payments || []).map((p: any) => `${p.method} (${formatMoney(p.amount)})`).join(' + ')}`,
      '¡Gracias por su compra!',
    ].filter(Boolean);
    return encodeURIComponent(lines.join('\n'));
  };

  return (
    <div className="p-4 md:p-6 max-w-[1600px] mx-auto grid grid-cols-1 lg:grid-cols-12 gap-5">
      <div className="lg:col-span-8 space-y-4">
        <div className="flex flex-wrap sm:flex-nowrap gap-2.5">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="w-5 h-5 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
            <input
              ref={searchInputRef}
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={handleSearchKeyDown}
              placeholder="Buscar producto o pasar código de barras..."
              className="w-full pl-11 pr-9 py-3 rounded-2xl bg-white border border-slate-200 shadow-sm text-sm focus:outline-none focus:border-emerald-500"
            />
            {search && (
              <button
                onClick={() => setSearch('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>

          <button
            onClick={() => setShowVoiceModal(true)}
            className="px-4 py-3 rounded-2xl bg-violet-600 hover:bg-violet-700 text-white font-bold text-sm flex items-center gap-2 shadow-sm shrink-0"
          >
            <Mic className="w-4 h-4" />
            <span>Dictar Pedido</span>
          </button>

          <button
            onClick={() => setShowScannerModal(true)}
            className="px-4 py-3 rounded-2xl bg-slate-900 hover:bg-slate-800 text-white font-bold text-sm flex items-center gap-2 shadow-sm shrink-0"
          >
            <ScanBarcode className="w-4 h-4" />
            <span>Escanear</span>
          </button>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
          <button
            onClick={() => addCustomLine('Seña Envase Retornable', 2000)}
            className="py-2.5 px-3 rounded-2xl bg-amber-50 hover:bg-amber-100 border border-amber-200 text-amber-800 font-bold text-xs flex items-center justify-center gap-1.5"
          >
            <Plus className="w-4 h-4" /> Seña ($ 2.000)
          </button>
          <button
            onClick={() => addCustomLine('Devolución Envase', -2000)}
            className="py-2.5 px-3 rounded-2xl bg-rose-50 hover:bg-rose-100 border border-rose-200 text-rose-700 font-bold text-xs flex items-center justify-center gap-1.5"
          >
            <RefreshCw className="w-4 h-4" /> Dev. Envase
          </button>
          <button
            onClick={() => {
              const val = window.prompt('Monto de venta suelta ($):');
              const num = parseFloat(val || '0');
              if (num > 0) addCustomLine('Venta Suelta / Varios', num);
            }}
            className="py-2.5 px-3 rounded-2xl bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 text-emerald-800 font-bold text-xs flex items-center justify-center gap-1.5"
          >
            <Plus className="w-4 h-4" /> Venta Suelta
          </button>
          <button
            onClick={() => setShowTicketsModal(true)}
            className="py-2.5 px-3 rounded-2xl bg-white hover:bg-slate-50 border border-slate-200 text-slate-700 font-bold text-xs flex items-center justify-center gap-1.5"
          >
            <FileText className="w-4 h-4" /> Tickets Hoy ({todaySales.length})
          </button>
        </div>

        <div className="flex gap-2 overflow-x-auto pb-1">
          {['Todos', ...CATEGORIAS].map((cat) => (
            <button
              key={cat}
              onClick={() => setSelectedCategory(cat)}
              className={`px-3.5 py-2 rounded-xl text-xs font-bold whitespace-nowrap transition ${
                selectedCategory === cat
                  ? 'bg-slate-900 text-white'
                  : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50'
              }`}
            >
              {cat}
            </button>
          ))}
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 gap-3">
          {filteredProducts.map((p: any) => {
            const lowStock = Number(p.stock) <= Number(p.minStock || 0);
            return (
              <button
                key={p.id}
                onClick={() => handleProductClick(p)}
                className="bg-white hover:border-emerald-500 border border-slate-200 rounded-2xl p-3.5 text-left transition shadow-sm flex flex-col justify-between group"
              >
                <div>
                  <div className="flex items-center justify-between gap-1 mb-1.5">
                    <span className="text-[10px] font-extrabold uppercase tracking-wider text-slate-400">
                      {p.category}
                    </span>
                    <span
                      className={`text-[11px] font-bold px-1.5 py-0.5 rounded-md ${
                        lowStock
                          ? 'bg-rose-100 text-rose-700'
                          : 'bg-slate-100 text-slate-600'
                      }`}
                    >
                      {p.isWeighed ? `${Number(p.stock).toFixed(1)}kg` : `${p.stock}u`}
                    </span>
                  </div>
                  <div className="font-bold text-slate-900 text-sm line-clamp-2 leading-snug mb-2">
                    {p.name}
                  </div>
                </div>

                <div className="flex items-center justify-between pt-2 border-t border-slate-100">
                  <div>
                    <span className="text-lg font-extrabold text-emerald-700">
                      {formatMoney(p.price)}
                    </span>
                    {p.isWeighed && (
                      <span className="text-[11px] text-slate-400 ml-0.5">/kg</span>
                    )}
                  </div>
                  <div className="w-8 h-8 rounded-xl bg-emerald-50 group-hover:bg-emerald-600 group-hover:text-white text-emerald-700 flex items-center justify-center transition">
                    {p.isWeighed ? (
                      <Scale className="w-4 h-4" />
                    ) : (
                      <Plus className="w-4 h-4" />
                    )}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      <div className="lg:col-span-4">
        <div className="bg-white border border-slate-200 rounded-3xl p-5 shadow-sm sticky top-5 flex flex-col max-h-[calc(100vh-2.5rem)]">
          <div className="flex items-center justify-between pb-3 border-b border-slate-100">
            <div className="flex items-center gap-2">
              <ShoppingCart className="w-5 h-5 text-emerald-600" />
              <h2 className="font-extrabold text-base text-slate-900">Cuenta Actual</h2>
            </div>
            {cart.length > 0 && (
              <button
                onClick={() => setCart([])}
                className="text-xs font-bold text-rose-600 hover:underline"
              >
                Vaciar
              </button>
            )}
          </div>

          {cart.length === 0 ? (
            <div className="py-14 text-center text-slate-400">
              <ShoppingCart className="w-12 h-12 mx-auto mb-3 opacity-30" />
              <p className="font-bold text-sm text-slate-500">
                Tocá productos para sumar a la cuenta
              </p>
              <p className="text-xs mt-1">
                Redondeo automático a ${roundStep} (corte en ${roundThreshold})
              </p>
            </div>
          ) : (
            <div className="flex-1 overflow-y-auto py-3 space-y-2.5">
              {cart.map((item: any) => (
                <div
                  key={item.cartItemId}
                  className="p-3 rounded-2xl bg-slate-50 border border-slate-200/80 flex items-center justify-between gap-2"
                >
                  <div className="min-w-0 flex-1">
                    <div className="font-bold text-xs text-slate-900 truncate">
                      {item.name}
                    </div>
                    <div className="text-[11px] text-slate-500">
                      {item.isWeighed
                        ? `${(item.qty * 1000).toFixed(0)} gr × ${formatMoney(item.price)}/kg`
                        : `${item.qty} u × ${formatMoney(item.price)}`}
                    </div>
                  </div>

                  {!item.isWeighed && item.id && (
                    <div className="flex items-center gap-1 bg-white border border-slate-200 rounded-xl p-0.5">
                      <button
                        onClick={() => updateCartQty(item.cartItemId, -1)}
                        className="p-1 text-slate-600 hover:text-rose-600"
                      >
                        <Minus className="w-3.5 h-3.5" />
                      </button>
                      <span className="text-xs font-extrabold px-1.5">{item.qty}</span>
                      <button
                        onClick={() => updateCartQty(item.cartItemId, 1)}
                        className="p-1 text-slate-600 hover:text-emerald-600"
                      >
                        <Plus className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  )}

                  <div className="font-extrabold text-sm text-slate-900 text-right shrink-0">
                    {formatMoney(item.subtotal)}
                  </div>

                  <button
                    onClick={() => removeCartItem(item.cartItemId)}
                    className="p-1.5 text-slate-400 hover:text-rose-600"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>
          )}

          <div className="pt-4 border-t border-slate-200 space-y-3">
            <div className="flex items-baseline justify-between">
              <span className="text-xs font-extrabold uppercase tracking-wider text-slate-500">
                Total a Cobrar
              </span>
              <span className="text-3xl font-black text-slate-900">
                {formatMoney(cartTotal)}
              </span>
            </div>

            <button
              disabled={cart.length === 0}
              onClick={() => {
                setPaymentMethod('Efectivo');
                setCashReceived('');
                setCheckoutMode('single');
              }}
              className="w-full py-3.5 rounded-2xl bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-200 disabled:text-slate-400 text-white font-extrabold text-sm flex items-center justify-center gap-2 shadow-md transition"
            >
              <Check className="w-5 h-5" /> COBRAR (1 MEDIO)
            </button>

            <div className="grid grid-cols-2 gap-2.5">
              <button
                disabled={cart.length === 0}
                onClick={() => {
                  setMixedCash('');
                  setCheckoutMode('mixed');
                }}
                className="py-3 rounded-2xl bg-slate-100 hover:bg-slate-200 disabled:opacity-50 text-slate-800 font-bold text-xs flex items-center justify-center gap-1.5"
              >
                <RefreshCw className="w-4 h-4" /> Pago Mixto (2)
              </button>
              <button
                disabled={cart.length === 0}
                onClick={() => {
                  setSelectedCustomerId(customers[0]?.id || '');
                  setCheckoutMode('fiado');
                }}
                className="py-3 rounded-2xl bg-amber-100 hover:bg-amber-200 disabled:opacity-50 text-amber-900 font-bold text-xs flex items-center justify-center gap-1.5"
              >
                <BookOpen className="w-4 h-4" /> Anotar Fiado
              </button>
            </div>
          </div>
        </div>
      </div>

      {scaleProduct && (
        <div className="fixed inset-0 bg-slate-950/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl max-w-sm w-full p-6 shadow-2xl">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <Scale className="w-5 h-5 text-emerald-600" />
                <h3 className="font-extrabold text-base">{scaleProduct.name}</h3>
              </div>
              <button
                onClick={() => setScaleProduct(null)}
                className="p-1.5 rounded-xl bg-slate-100"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <p className="text-xs text-slate-500 mb-4">
              Precio por Kilo: <strong>{formatMoney(scaleProduct.price)}</strong>
            </p>

            <div className="grid grid-cols-4 gap-2 mb-4">
              {[100, 250, 500, 1000].map((g) => (
                <button
                  key={g}
                  type="button"
                  onClick={() => setScaleGrams(String(g))}
                  className={`py-2 rounded-xl text-xs font-extrabold border ${
                    scaleGrams === String(g)
                      ? 'bg-emerald-600 text-white border-emerald-600'
                      : 'bg-slate-50 text-slate-700 border-slate-200'
                  }`}
                >
                  {g === 1000 ? '1 Kg' : `${g}g`}
                </button>
              ))}
            </div>

            <form onSubmit={handleConfirmScale} className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-600 mb-1">
                  Peso en gramos (g):
                </label>
                <input
                  type="number"
                  autoFocus
                  value={scaleGrams}
                  onChange={(e) => setScaleGrams(e.target.value)}
                  className="w-full px-4 py-3 rounded-2xl border border-slate-300 text-center text-2xl font-black"
                />
              </div>

              <div className="p-3 rounded-2xl bg-emerald-50 text-center">
                <div className="text-xs text-emerald-700 font-bold">Subtotal redondeado</div>
                <div className="text-2xl font-black text-emerald-800">
                  {formatMoney(
                    roundPrice(
                      ((parseFloat(scaleGrams) || 0) / 1000) * scaleProduct.price,
                      roundStep,
                      roundThreshold
                    )
                  )}
                </div>
              </div>

              <button
                type="submit"
                className="w-full py-3.5 rounded-2xl bg-emerald-600 text-white font-extrabold text-sm"
              >
                Agregar a la Cuenta
              </button>
            </form>
          </div>
        </div>
      )}

      {checkoutMode && (
        <div className="fixed inset-0 bg-slate-950/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl max-w-md w-full p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-extrabold text-lg">
                {checkoutMode === 'single' && 'Confirmar Cobro'}
                {checkoutMode === 'mixed' && 'Pago Mixto (2 Medios)'}
                {checkoutMode === 'fiado' && 'Anotar en Libreta de Fiados'}
              </h3>
              <button
                onClick={() => setCheckoutMode(null)}
                className="p-1.5 rounded-xl bg-slate-100"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-4 rounded-2xl bg-slate-900 text-white flex items-center justify-between">
              <span className="text-xs font-bold uppercase text-slate-400">Total</span>
              <span className="text-2xl font-black text-emerald-400">
                {formatMoney(cartTotal)}
              </span>
            </div>

            {checkoutMode === 'single' && (
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-2">
                  {[
                    { id: 'Efectivo', icon: DollarSign },
                    { id: 'Mercado Pago / QR', icon: Smartphone },
                    { id: 'Transferencia', icon: ArrowUpRight },
                    { id: 'Débito / Crédito', icon: CreditCard },
                  ].map((m) => {
                    const Icon = m.icon;
                    return (
                      <button
                        key={m.id}
                        type="button"
                        onClick={() => setPaymentMethod(m.id)}
                        className={`p-3 rounded-2xl border text-left font-bold text-xs flex items-center gap-2 ${
                          paymentMethod === m.id
                            ? 'border-emerald-600 bg-emerald-50 text-emerald-900'
                            : 'border-slate-200 text-slate-700'
                        }`}
                      >
                        <Icon className="w-4 h-4 shrink-0" />
                        <span>{m.id}</span>
                      </button>
                    );
                  })}
                </div>

                {paymentMethod === 'Efectivo' && (
                  <div className="p-3.5 rounded-2xl bg-slate-50 border border-slate-200 space-y-2">
                    <label className="block text-xs font-bold text-slate-600">
                      Paga con ($):
                    </label>
                    <input
                      type="number"
                      value={cashReceived}
                      onChange={(e) => setCashReceived(e.target.value)}
                      placeholder={String(cartTotal)}
                      className="w-full px-3 py-2 rounded-xl border border-slate-300 font-bold text-lg"
                    />
                    {Number(cashReceived) > cartTotal && (
                      <div className="flex justify-between text-sm font-extrabold text-emerald-700 pt-1">
                        <span>Vuelto al cliente:</span>
                        <span>{formatMoney(Number(cashReceived) - cartTotal)}</span>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {checkoutMode === 'mixed' && (
              <div className="space-y-3">
                <div>
                  <label className="block text-xs font-bold text-slate-600 mb-1">
                    Monto en Efectivo ($):
                  </label>
                  <input
                    type="number"
                    value={mixedCash}
                    onChange={(e) => setMixedCash(e.target.value)}
                    placeholder="0"
                    className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 font-bold text-lg"
                  />
                </div>
                <div className="p-3 rounded-2xl bg-sky-50 border border-sky-200 flex justify-between items-center">
                  <span className="text-xs font-bold text-sky-800">
                    Resto en {mixedDigitalMethod}:
                  </span>
                  <span className="text-lg font-black text-sky-900">
                    {formatMoney(Math.max(0, cartTotal - (Number(mixedCash) || 0)))}
                  </span>
                </div>
                <select
                  value={mixedDigitalMethod}
                  onChange={(e) => setMixedDigitalMethod(e.target.value)}
                  className="w-full px-3 py-2.5 rounded-xl border border-slate-300 text-sm font-semibold"
                >
                  <option>Mercado Pago / QR</option>
                  <option>Transferencia</option>
                  <option>Débito / Crédito</option>
                </select>
              </div>
            )}

            {checkoutMode === 'fiado' && (
              <div className="space-y-3">
                {customers.length === 0 ? (
                  <p className="text-xs text-amber-700 bg-amber-50 p-3 rounded-xl">
                    Todavía no tenés clientes cargados. Agregalos desde la pestaña{' '}
                    <strong>Clientes y Fiados</strong>.
                  </p>
                ) : (
                  <div>
                    <label className="block text-xs font-bold text-slate-600 mb-1">
                      Seleccionar Cliente:
                    </label>
                    <select
                      value={selectedCustomerId}
                      onChange={(e) => setSelectedCustomerId(e.target.value)}
                      className="w-full px-3.5 py-3 rounded-xl border border-slate-300 text-sm font-bold"
                    >
                      <option value="">-- Elegir cliente --</option>
                      {customers.map((c: any) => (
                        <option key={c.id} value={c.id}>
                          {c.name} (Saldo actual: {formatMoney(c.debt || 0)})
                        </option>
                      ))}
                    </select>
                  </div>
                )}
              </div>
            )}

            <button
              onClick={handleFinalizeSale}
              className="w-full py-3.5 rounded-2xl bg-emerald-600 hover:bg-emerald-700 text-white font-extrabold text-sm"
            >
              Confirmar Operación
            </button>
          </div>
        </div>
      )}

      {showVoiceModal && (
        <VoiceOrderModal
          products={products}
          customers={customers}
          onApplyOrder={(matchedItems: any[], detectedCustomerId: string | null) => {
            matchedItems.forEach(({ product, qty }) => {
              if (product.isWeighed) {
                addToCart(product, qty, qty * product.price);
              } else {
                addToCart(product, qty);
              }
            });
            if (detectedCustomerId) {
              setSelectedCustomerId(detectedCustomerId);
            }
            setShowVoiceModal(false);
            showToast(`${matchedItems.length} producto(s) agregados al carrito`);
          }}
          onClose={() => setShowVoiceModal(false)}
        />
      )}

      {showScannerModal && (
        <BarcodeScannerModal
          onRawDetected={(code: string) => {
            const found = products.find(
              (p: any) => (p.code || '').trim().toLowerCase() === code.trim().toLowerCase()
            );
            if (found) {
              handleProductClick(found);
              showToast(`Agregado: ${found.name}`);
            } else {
              setSearch(code);
              showToast(`Código ${code} no registrado en catálogo`, 'error');
            }
            setShowScannerModal(false);
          }}
          onManualCode={(code: string) => {
            const found = products.find(
              (p: any) => (p.code || '').trim().toLowerCase() === code.trim().toLowerCase()
            );
            if (found) {
              handleProductClick(found);
              showToast(`Agregado: ${found.name}`);
            } else {
              setSearch(code);
              showToast(`Código ${code} no registrado`, 'error');
            }
            setShowScannerModal(false);
          }}
          onClose={() => setShowScannerModal(false)}
        />
      )}

      {showTicketsModal && (
        <div className="fixed inset-0 bg-slate-950/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl max-w-lg w-full p-6 shadow-2xl max-h-[85vh] flex flex-col">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-extrabold text-lg">
                Ventas de Hoy ({todaySales.length})
              </h3>
              <button
                onClick={() => setShowTicketsModal(false)}
                className="p-1.5 rounded-xl bg-slate-100"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto space-y-2.5">
              {todaySales.length === 0 ? (
                <p className="text-center text-slate-400 py-10 text-sm">
                  Aún no hay ventas registradas hoy.
                </p>
              ) : (
                todaySales.map((s: any) => (
                  <div
                    key={s.id}
                    className="p-3.5 rounded-2xl border border-slate-200 flex items-center justify-between gap-3"
                  >
                    <div>
                      <div className="font-extrabold text-sm text-slate-900">
                        {formatMoney(s.total)}{' '}
                        <span className="text-xs font-normal text-slate-500">
                          - {formatDateTime(s.timestamp)}
                        </span>
                      </div>
                      <div className="text-xs text-slate-500">
                        Cajero: <strong>{s.cashierName || 'Mostrador'}</strong> •{' '}
                        {(s.payments || []).map((p: any) => p.method).join(' + ')}
                        {s.customerName ? ` (${s.customerName})` : ''}
                      </div>
                    </div>
                    <button
                      onClick={() => {
                        setShowTicketsModal(false);
                        setPrintableTicketSale(s);
                      }}
                      className="px-3 py-2 rounded-xl bg-slate-900 text-white text-xs font-bold flex items-center gap-1.5 shrink-0"
                    >
                      <Printer className="w-3.5 h-3.5" /> Ticket
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {printableTicketSale && (
        <div className="fixed inset-0 bg-slate-950/75 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl max-w-sm w-full p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between">
              <span className="text-xs font-extrabold uppercase tracking-wider text-emerald-600">
                Comprobante Listo
              </span>
              <button
                onClick={() => setPrintableTicketSale(null)}
                className="p-1.5 rounded-xl bg-slate-100"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div
              id="printable-ticket-area"
              className="p-4 rounded-2xl border border-dashed border-slate-300 bg-slate-50 font-mono text-xs space-y-2 text-slate-800"
            >
              <div className="text-center border-b border-dashed border-slate-300 pb-2">
                <div className="font-black text-sm uppercase">{storeName}</div>
                <div>{formatDateTime(printableTicketSale.timestamp)}</div>
                <div className="font-bold mt-0.5">
                  Atendido por: {printableTicketSale.cashierName || 'Mostrador'}
                </div>
                {printableTicketSale.customerName && (
                  <div>Cliente: {printableTicketSale.customerName}</div>
                )}
              </div>

              <div className="space-y-1 border-b border-dashed border-slate-300 pb-2">
                {(printableTicketSale.items || []).map((it: any, idx: number) => (
                  <div key={idx} className="flex justify-between gap-2">
                    <span className="truncate">
                      {it.isWeighed ? `${(it.qty * 1000).toFixed(0)}g` : `${it.qty}x`}{' '}
                      {it.name}
                    </span>
                    <span className="font-bold shrink-0">
                      {formatMoney(it.subtotal)}
                    </span>
                  </div>
                ))}
              </div>

              <div className="flex justify-between font-black text-sm pt-1">
                <span>TOTAL</span>
                <span>{formatMoney(printableTicketSale.total)}</span>
              </div>
              <div className="text-[11px] text-slate-600">
                Forma de pago:{' '}
                {(printableTicketSale.payments || [])
                  .map((p: any) => `${p.method} (${formatMoney(p.amount)})`)
                  .join(' + ')}
              </div>
              <div className="text-center text-[10px] pt-2 text-slate-500">
                ¡Muchas gracias por su compra!
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2.5">
              <button
                onClick={() => window.print()}
                className="py-3 rounded-2xl bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs flex items-center justify-center gap-1.5"
              >
                <Printer className="w-4 h-4" /> Imprimir Ticket
              </button>
              <a
                href={`https://wa.me/?text=${buildWhatsAppTicketText(printableTicketSale)}`}
                target="_blank"
                rel="noopener noreferrer"
                className="py-3 rounded-2xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs flex items-center justify-center gap-1.5"
              >
                <MessageCircle className="w-4 h-4" /> WhatsApp
              </a>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// MÓDULO 2: PRODUCTOS Y STOCK + ESCÁNER ALTA + IMPORTADOR IA + ETIQUETAS
// ============================================================================
function ProductsModule({
  products,
  isAdminUnlocked,
  roundStep,
  roundThreshold,
  storeName,
  db,
  user,
  getStoreDocRef,
  showToast,
  onRequestAdmin,
}: any) {
  const [search, setSearch] = useState('');
  const [showFormModal, setShowFormModal] = useState(false);
  const [editingProduct, setEditingProduct] = useState<any>(null);
  const [showBulkModal, setShowBulkModal] = useState(false);
  const [bulkPercent, setBulkPercent] = useState('10');
  const [bulkCategory, setBulkCategory] = useState('Todos');
  const [showInvoiceImporter, setShowInvoiceImporter] = useState(false);
  const [showProductFormScanner, setShowProductFormScanner] = useState(false);
  const [printLabelProduct, setPrintLabelProduct] = useState<any>(null);

  const [formState, setFormState] = useState({
    name: '',
    category: 'Almacén',
    code: '',
    cost: '',
    price: '',
    stock: '',
    minStock: '5',
    isWeighed: false,
    expiryDate: '',
  });

  const filteredProducts = useMemo(() => {
    const q = search.trim().toLowerCase();
    return products.filter(
      (p: any) =>
        !q ||
        (p.name || '').toLowerCase().includes(q) ||
        (p.code || '').toLowerCase().includes(q) ||
        (p.category || '').toLowerCase().includes(q)
    );
  }, [products, search]);

  const openNewProductModal = () => {
    setEditingProduct(null);
    setFormState({
      name: '',
      category: 'Almacén',
      code: '',
      cost: '',
      price: '',
      stock: '',
      minStock: '5',
      isWeighed: false,
      expiryDate: '',
    });
    setShowFormModal(true);
  };

  const openEditProductModal = (prod: any) => {
    setEditingProduct(prod);
    setFormState({
      name: prod.name || '',
      category: prod.category || 'Almacén',
      code: prod.code || '',
      cost: String(prod.cost ?? ''),
      price: String(prod.price ?? ''),
      stock: String(prod.stock ?? ''),
      minStock: String(prod.minStock ?? '5'),
      isWeighed: !!prod.isWeighed,
      expiryDate: prod.expiryDate || '',
    });
    setShowFormModal(true);
  };

  const handleSaveProduct = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formState.name.trim()) return;

    const payload = {
      name: formState.name.trim(),
      category: formState.category,
      code: formState.code.trim(),
      cost: parseFloat(formState.cost) || 0,
      price: parseFloat(formState.price) || 0,
      stock: parseFloat(formState.stock) || 0,
      minStock: parseFloat(formState.minStock) || 0,
      isWeighed: !!formState.isWeighed,
      expiryDate: formState.expiryDate || '',
    };

    try {
      if (db && user) {
        const storeRef = getStoreDocRef();
        if (editingProduct) {
          await updateDoc(doc(storeRef, 'products', editingProduct.id), payload);
        } else {
          await addDoc(collection(storeRef, 'products'), payload);
        }
      }
      setShowFormModal(false);
      showToast(editingProduct ? 'Producto actualizado' : 'Producto creado');
    } catch (err) {
      console.error(err);
      showToast('Error al guardar producto', 'error');
    }
  };

  const handleDeleteProduct = async (id: string) => {
    if (!db || !user) return;
    try {
      await deleteDoc(doc(getStoreDocRef(), 'products', id));
      showToast('Producto eliminado');
    } catch (err) {
      showToast('No se pudo eliminar', 'error');
    }
  };

  const handleBulkPriceIncrease = async (e: React.FormEvent) => {
    e.preventDefault();
    const pct = parseFloat(bulkPercent) || 0;
    if (pct === 0 || !db || !user) return;
    const factor = 1 + pct / 100;
    const storeRef = getStoreDocRef();
    const batch = writeBatch(db);
    let count = 0;

    products.forEach((p: any) => {
      if (bulkCategory === 'Todos' || p.category === bulkCategory) {
        const newCost = Math.round((Number(p.cost) || 0) * factor);
        const newPrice = roundPrice((Number(p.price) || 0) * factor, roundStep, roundThreshold);
        batch.update(doc(storeRef, 'products', p.id), {
          cost: newCost,
          price: newPrice,
        });
        count++;
      }
    });

    await batch.commit();
    setShowBulkModal(false);
    showToast(`Precios actualizados en ${count} productos`);
  };

  const handleBatchImport = async (importedItems: any[]) => {
    if (!db || !user) return;
    const storeRef = getStoreDocRef();
    const batch = writeBatch(db);

    importedItems.forEach((item) => {
      const existing = products.find(
        (p: any) => p.name.trim().toLowerCase() === item.name.trim().toLowerCase()
      );
      if (existing) {
        batch.update(doc(storeRef, 'products', existing.id), {
          cost: item.cost,
          price: item.price,
          stock: increment(item.qty),
        });
      } else {
        const newRef = doc(collection(storeRef, 'products'));
        batch.set(newRef, {
          name: item.name,
          category: 'Almacén',
          code: '',
          cost: item.cost,
          price: item.price,
          stock: item.qty,
          minStock: 5,
          isWeighed: false,
          expiryDate: '',
        });
      }
    });

    await batch.commit();
    setShowInvoiceImporter(false);
    showToast(`${importedItems.length} productos ingresados al stock`);
  };

  return (
    <div className="p-4 md:p-6 max-w-[1600px] mx-auto space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl font-black text-slate-900">Productos y Stock</h2>
          <p className="text-xs text-slate-500">
            {products.length} artículos cargados • Redondeo automático a ${roundStep}
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => setShowInvoiceImporter(true)}
            className="px-4 py-2.5 rounded-2xl bg-violet-600 hover:bg-violet-700 text-white font-bold text-xs flex items-center gap-1.5 shadow-sm"
          >
            <Camera className="w-4 h-4" /> Importar Boleta IA
          </button>

          <button
            onClick={() =>
              isAdminUnlocked ? setShowBulkModal(true) : onRequestAdmin()
            }
            className="px-4 py-2.5 rounded-2xl bg-amber-100 hover:bg-amber-200 text-amber-900 font-bold text-xs flex items-center gap-1.5"
          >
            <TrendingUp className="w-4 h-4" /> Aumento Masivo (%)
          </button>

          <button
            onClick={openNewProductModal}
            className="px-4 py-2.5 rounded-2xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs flex items-center gap-1.5 shadow-sm"
          >
            <Plus className="w-4 h-4" /> Nuevo Producto
          </button>
        </div>
      </div>

      <div className="relative max-w-md">
        <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Buscar por nombre, categoría o código..."
          className="w-full pl-10 pr-4 py-2.5 rounded-2xl bg-white border border-slate-200 text-sm"
        />
      </div>

      <div className="bg-white border border-slate-200 rounded-3xl overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-[11px] font-extrabold uppercase text-slate-500">
                <th className="py-3.5 px-4">Producto</th>
                <th className="py-3.5 px-4">Código</th>
                {isAdminUnlocked && <th className="py-3.5 px-4">Costo</th>}
                <th className="py-3.5 px-4">Precio Venta</th>
                <th className="py-3.5 px-4">Stock</th>
                <th className="py-3.5 px-4 text-right">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-sm">
              {filteredProducts.map((p: any) => {
                const low = Number(p.stock) <= Number(p.minStock || 0);
                return (
                  <tr key={p.id} className="hover:bg-slate-50/80">
                    <td className="py-3 px-4">
                      <div className="font-bold text-slate-900">{p.name}</div>
                      <div className="text-[11px] text-slate-400">{p.category}</div>
                    </td>
                    <td className="py-3 px-4 font-mono text-xs text-slate-500">
                      {p.code || '—'}
                    </td>
                    {isAdminUnlocked && (
                      <td className="py-3 px-4 text-slate-600 font-semibold">
                        {formatMoney(p.cost)}
                      </td>
                    )}
                    <td className="py-3 px-4 font-extrabold text-emerald-700">
                      {formatMoney(p.price)}
                      {p.isWeighed && <span className="text-xs font-normal">/kg</span>}
                    </td>
                    <td className="py-3 px-4">
                      <span
                        className={`px-2.5 py-1 rounded-full text-xs font-bold ${
                          low
                            ? 'bg-rose-100 text-rose-700'
                            : 'bg-emerald-50 text-emerald-700'
                        }`}
                      >
                        {p.isWeighed ? `${Number(p.stock).toFixed(2)} kg` : `${p.stock} u`}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-right">
                      <div className="inline-flex items-center gap-1">
                        <button
                          onClick={() => setPrintLabelProduct(p)}
                          title="Imprimir Etiqueta"
                          className="p-2 rounded-xl text-slate-500 hover:bg-slate-100"
                        >
                          <Printer className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => openEditProductModal(p)}
                          title="Editar"
                          className="p-2 rounded-xl text-sky-600 hover:bg-sky-50"
                        >
                          <Edit3 className="w-4 h-4" />
                        </button>
                        {isAdminUnlocked && (
                          <button
                            onClick={() => handleDeleteProduct(p.id)}
                            title="Eliminar"
                            className="p-2 rounded-xl text-rose-600 hover:bg-rose-50"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {showFormModal && (
        <div className="fixed inset-0 bg-slate-950/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl max-w-lg w-full p-6 shadow-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-extrabold text-lg">
                {editingProduct ? 'Editar Producto' : 'Nuevo Producto'}
              </h3>
              <button
                onClick={() => setShowFormModal(false)}
                className="p-1.5 rounded-xl bg-slate-100"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSaveProduct} className="space-y-3.5">
              <div>
                <label className="block text-xs font-bold text-slate-600 mb-1">
                  Nombre del Producto *
                </label>
                <input
                  type="text"
                  required
                  value={formState.name}
                  onChange={(e) => setFormState({ ...formState, name: e.target.value })}
                  placeholder="Ej: Yerba Mate Taragüi 1kg"
                  className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 text-sm font-semibold"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-600 mb-1">
                    Categoría
                  </label>
                  <select
                    value={formState.category}
                    onChange={(e) =>
                      setFormState({ ...formState, category: e.target.value })
                    }
                    className="w-full px-3 py-2.5 rounded-xl border border-slate-300 text-sm font-semibold"
                  >
                    {CATEGORIAS.map((c) => (
                      <option key={c}>{c}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-600 mb-1">
                    Código de Barras
                  </label>
                  <div className="flex gap-1.5">
                    <input
                      type="text"
                      value={formState.code}
                      onChange={(e) =>
                        setFormState({ ...formState, code: e.target.value })
                      }
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') e.preventDefault();
                      }}
                      placeholder="Escaneá o escribí..."
                      className="flex-1 min-w-0 px-3 py-2.5 rounded-xl border border-slate-300 text-sm font-mono"
                    />
                    <button
                      type="button"
                      onClick={() => setShowProductFormScanner(true)}
                      className="px-3 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs flex items-center gap-1 shrink-0"
                    >
                      <ScanBarcode className="w-4 h-4" />
                      <span>Escanear</span>
                    </button>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-600 mb-1">
                    Costo ($)
                  </label>
                  <input
                    type="number"
                    step="any"
                    value={formState.cost}
                    onChange={(e) => {
                      const c = e.target.value;
                      const suggested = c
                        ? roundPrice(parseFloat(c) * 1.35, roundStep, roundThreshold)
                        : formState.price;
                      setFormState({
                        ...formState,
                        cost: c,
                        price: editingProduct ? formState.price : String(suggested),
                      });
                    }}
                    placeholder="0"
                    className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 text-sm font-bold"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-600 mb-1">
                    Precio Venta ($) *
                  </label>
                  <input
                    type="number"
                    step="any"
                    required
                    value={formState.price}
                    onChange={(e) =>
                      setFormState({ ...formState, price: e.target.value })
                    }
                    placeholder="0"
                    className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 text-sm font-extrabold text-emerald-700"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-600 mb-1">
                    Stock Actual
                  </label>
                  <input
                    type="number"
                    step="any"
                    value={formState.stock}
                    onChange={(e) =>
                      setFormState({ ...formState, stock: e.target.value })
                    }
                    placeholder="0"
                    className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 text-sm font-bold"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-600 mb-1">
                    Alerta Stock Mínimo
                  </label>
                  <input
                    type="number"
                    step="any"
                    value={formState.minStock}
                    onChange={(e) =>
                      setFormState({ ...formState, minStock: e.target.value })
                    }
                    placeholder="5"
                    className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 text-sm font-bold"
                  />
                </div>
              </div>

              <label className="flex items-center gap-2.5 p-3 rounded-2xl bg-slate-50 border border-slate-200 cursor-pointer">
                <input
                  type="checkbox"
                  checked={formState.isWeighed}
                  onChange={(e) =>
                    setFormState({ ...formState, isWeighed: e.target.checked })
                  }
                  className="w-4 h-4 accent-emerald-600"
                />
                <span className="text-xs font-bold text-slate-700">
                  Se vende por peso / balanza (precio por Kg)
                </span>
              </label>

              <button
                type="submit"
                className="w-full py-3.5 rounded-2xl bg-emerald-600 hover:bg-emerald-700 text-white font-extrabold text-sm"
              >
                {editingProduct ? 'Guardar Cambios' : 'Crear Producto'}
              </button>
            </form>
          </div>
        </div>
      )}

      {showBulkModal && (
        <div className="fixed inset-0 bg-slate-950/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl max-w-sm w-full p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-extrabold text-lg">Aumento Masivo (%)</h3>
              <button
                onClick={() => setShowBulkModal(false)}
                className="p-1.5 rounded-xl bg-slate-100"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <form onSubmit={handleBulkPriceIncrease} className="space-y-3">
              <div>
                <label className="block text-xs font-bold text-slate-600 mb-1">
                  Categoría a actualizar:
                </label>
                <select
                  value={bulkCategory}
                  onChange={(e) => setBulkCategory(e.target.value)}
                  className="w-full px-3 py-2.5 rounded-xl border border-slate-300 text-sm font-semibold"
                >
                  <option value="Todos">Todos los productos</option>
                  {CATEGORIAS.map((c) => (
                    <option key={c}>{c}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-600 mb-1">
                  Porcentaje de aumento (%):
                </label>
                <input
                  type="number"
                  value={bulkPercent}
                  onChange={(e) => setBulkPercent(e.target.value)}
                  className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 text-lg font-extrabold"
                />
              </div>
              <button
                type="submit"
                className="w-full py-3 rounded-2xl bg-amber-500 hover:bg-amber-600 text-slate-950 font-extrabold text-sm"
              >
                Aplicar Aumento y Redondear
              </button>
            </form>
          </div>
        </div>
      )}

      {showInvoiceImporter && (
        <InvoiceImporterModal
          roundStep={roundStep}
          roundThreshold={roundThreshold}
          onImport={handleBatchImport}
          onClose={() => setShowInvoiceImporter(false)}
        />
      )}

      {showProductFormScanner && (
        <BarcodeScannerModal
          onRawDetected={(scannedCode: string) => {
            setFormState((prev) => ({ ...prev, code: scannedCode }));
            setShowProductFormScanner(false);
            showToast(`Código capturado: ${scannedCode}`);
          }}
          onManualCode={(scannedCode: string) => {
            setFormState((prev) => ({ ...prev, code: scannedCode }));
            setShowProductFormScanner(false);
            showToast(`Código capturado: ${scannedCode}`);
          }}
          onClose={() => setShowProductFormScanner(false)}
        />
      )}

      {printLabelProduct && (
        <BarcodeLabelModal
          product={printLabelProduct}
          storeName={storeName}
          onClose={() => setPrintLabelProduct(null)}
        />
      )}
    </div>
  );
}

// ============================================================================
// MÓDULO 3: CAJA, CIERRE DIARIO POR CAJERO, GASTOS Y FALTANTES
// ============================================================================
function CashModule({
  todaySales,
  todayExpenses,
  products,
  activeCashier,
  db,
  user,
  getStoreDocRef,
  showToast,
}: any) {
  const [expenseDesc, setExpenseDesc] = useState('');
  const [expenseAmount, setExpenseAmount] = useState('');

  const totalSalesToday = useMemo(
    () => todaySales.reduce((acc: number, s: any) => acc + Number(s.total || 0), 0),
    [todaySales]
  );

  const totalExpensesToday = useMemo(
    () => todayExpenses.reduce((acc: number, e: any) => acc + Number(e.amount || 0), 0),
    [todayExpenses]
  );

  const salesByMethod = useMemo(() => {
    const map: Record<string, number> = {};
    todaySales.forEach((s: any) => {
      (s.payments || []).forEach((p: any) => {
        map[p.method] = (map[p.method] || 0) + Number(p.amount || 0);
      });
    });
    return map;
  }, [todaySales]);

  const salesByCashier = useMemo(() => {
    const map: Record<string, number> = {};
    todaySales.forEach((s: any) => {
      const name = s.cashierName || 'Mostrador';
      map[name] = (map[name] || 0) + Number(s.total || 0);
    });
    return map;
  }, [todaySales]);

  const lowStockProducts = useMemo(
    () => products.filter((p: any) => Number(p.stock) <= Number(p.minStock || 0)),
    [products]
  );

  const handleAddExpense = async (e: React.FormEvent) => {
    e.preventDefault();
    const amount = parseFloat(expenseAmount) || 0;
    if (!expenseDesc.trim() || amount <= 0) return;

    try {
      if (db && user) {
        await addDoc(collection(getStoreDocRef(), 'expenses'), {
          description: expenseDesc.trim(),
          amount,
          cashierName: activeCashier ? activeCashier.name : 'Mostrador',
          timestamp: Date.now(),
        });
      }
      setExpenseDesc('');
      setExpenseAmount('');
      showToast('Salida de caja registrada');
    } catch (err) {
      showToast('Error al registrar salida', 'error');
    }
  };

  return (
    <div className="p-4 md:p-6 max-w-[1600px] mx-auto space-y-6">
      <div>
        <h2 className="text-2xl font-black text-slate-900">Caja y Faltantes</h2>
        <p className="text-xs text-slate-500">
          Resumen en tiempo real del movimiento del día
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-white border border-slate-200 rounded-3xl p-5 shadow-sm">
          <div className="text-xs font-bold text-slate-500 uppercase">Ventas de Hoy</div>
          <div className="text-3xl font-black text-emerald-700 mt-1">
            {formatMoney(totalSalesToday)}
          </div>
          <div className="text-xs text-slate-400 mt-1">{todaySales.length} tickets</div>
        </div>

        <div className="bg-white border border-slate-200 rounded-3xl p-5 shadow-sm">
          <div className="text-xs font-bold text-slate-500 uppercase">
            Salidas / Pagos Proveedores
          </div>
          <div className="text-3xl font-black text-rose-600 mt-1">
            {formatMoney(totalExpensesToday)}
          </div>
          <div className="text-xs text-slate-400 mt-1">
            {todayExpenses.length} movimientos
          </div>
        </div>

        <div className="bg-slate-900 text-white rounded-3xl p-5 shadow-sm">
          <div className="text-xs font-bold text-slate-400 uppercase">
            Efectivo Neto Estimado
          </div>
          <div className="text-3xl font-black text-emerald-400 mt-1">
            {formatMoney((salesByMethod['Efectivo'] || 0) - totalExpensesToday)}
          </div>
          <div className="text-xs text-slate-400 mt-1">Efectivo cobrado menos salidas</div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        <div className="bg-white border border-slate-200 rounded-3xl p-5 shadow-sm">
          <h3 className="font-extrabold text-base mb-3">Cobros por Medio de Pago</h3>
          {Object.keys(salesByMethod).length === 0 ? (
            <p className="text-xs text-slate-400">Sin cobros hoy.</p>
          ) : (
            <div className="space-y-2">
              {Object.entries(salesByMethod).map(([method, amount]) => (
                <div
                  key={method}
                  className="flex justify-between items-center p-3 rounded-2xl bg-slate-50"
                >
                  <span className="font-bold text-sm text-slate-700">{method}</span>
                  <span className="font-extrabold text-sm text-slate-900">
                    {formatMoney(amount)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="bg-white border border-slate-200 rounded-3xl p-5 shadow-sm">
          <h3 className="font-extrabold text-base mb-3">Ventas por Cajero / Turno</h3>
          {Object.keys(salesByCashier).length === 0 ? (
            <p className="text-xs text-slate-400">Sin turnos con ventas hoy.</p>
          ) : (
            <div className="space-y-2">
              {Object.entries(salesByCashier).map(([cName, amount]) => (
                <div
                  key={cName}
                  className="flex justify-between items-center p-3 rounded-2xl bg-sky-50/70"
                >
                  <span className="font-bold text-sm text-sky-900">{cName}</span>
                  <span className="font-extrabold text-sm text-sky-950">
                    {formatMoney(amount)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        <div className="bg-white border border-slate-200 rounded-3xl p-5 shadow-sm space-y-4">
          <h3 className="font-extrabold text-base">Registrar Salida de Caja / Gasto</h3>
          <form onSubmit={handleAddExpense} className="flex flex-col sm:flex-row gap-2">
            <input
              type="text"
              value={expenseDesc}
              onChange={(e) => setExpenseDesc(e.target.value)}
              placeholder="Ej: Pago panadero / Hielo"
              className="flex-1 px-3.5 py-2.5 rounded-xl border border-slate-300 text-sm"
            />
            <input
              type="number"
              value={expenseAmount}
              onChange={(e) => setExpenseAmount(e.target.value)}
              placeholder="$ Monto"
              className="sm:w-32 px-3.5 py-2.5 rounded-xl border border-slate-300 text-sm font-bold"
            />
            <button
              type="submit"
              className="px-4 py-2.5 rounded-xl bg-rose-600 text-white font-bold text-sm"
            >
              Anotar
            </button>
          </form>

          <div className="space-y-2 max-h-48 overflow-y-auto">
            {todayExpenses.map((e: any) => (
              <div
                key={e.id}
                className="p-2.5 rounded-xl bg-rose-50/60 flex justify-between text-xs"
              >
                <span>
                  <strong>{e.description}</strong> ({e.cashierName || 'Mostrador'})
                </span>
                <span className="font-extrabold text-rose-700">
                  -{formatMoney(e.amount)}
                </span>
              </div>
            ))}
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-3xl p-5 shadow-sm">
          <h3 className="font-extrabold text-base mb-3 flex items-center gap-2">
            <AlertTriangle className="w-5 h-5 text-amber-500" />
            <span>Faltantes / Stock Bajo ({lowStockProducts.length})</span>
          </h3>
          {lowStockProducts.length === 0 ? (
            <p className="text-xs text-emerald-600 font-semibold">
              ¡Todo el stock está por encima del mínimo!
            </p>
          ) : (
            <div className="space-y-2 max-h-60 overflow-y-auto">
              {lowStockProducts.map((p: any) => (
                <div
                  key={p.id}
                  className="p-3 rounded-2xl bg-amber-50 border border-amber-200 flex justify-between items-center text-xs"
                >
                  <div>
                    <div className="font-bold text-slate-900">{p.name}</div>
                    <div className="text-slate-500">Mínimo: {p.minStock}</div>
                  </div>
                  <span className="px-2.5 py-1 rounded-full bg-rose-600 text-white font-extrabold">
                    Quedan: {p.stock}
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
// MÓDULO 4: CLIENTES Y LIBRETA DE FIADOS + WHATSAPP
// ============================================================================
function CustomersModule({
  customers,
  storeName,
  activeCashier,
  db,
  user,
  getStoreDocRef,
  showToast,
}: any) {
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [payingCustomer, setPayingCustomer] = useState<any>(null);
  const [payAmount, setPayAmount] = useState('');

  const handleAddCustomer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    try {
      if (db && user) {
        await addDoc(collection(getStoreDocRef(), 'customers'), {
          name: name.trim(),
          phone: phone.trim(),
          debt: 0,
        });
      }
      setName('');
      setPhone('');
      showToast('Cliente agregado a la libreta');
    } catch (err) {
      showToast('Error al agregar cliente', 'error');
    }
  };

  const handleRegisterDebtPayment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!payingCustomer) return;
    const amount = parseFloat(payAmount) || 0;
    if (amount <= 0) return;

    try {
      if (db && user) {
        const storeRef = getStoreDocRef();
        await updateDoc(doc(storeRef, 'customers', payingCustomer.id), {
          debt: increment(-amount),
        });
        await addDoc(collection(storeRef, 'sales'), {
          timestamp: Date.now(),
          items: [
            {
              name: `Entrega / Pago de Fiado (${payingCustomer.name})`,
              qty: 1,
              price: amount,
              subtotal: amount,
              isWeighed: false,
            },
          ],
          total: amount,
          payments: [{ method: 'Efectivo', amount }],
          customerName: payingCustomer.name,
          cashierName: activeCashier ? activeCashier.name : 'Mostrador',
        });
      }
      setPayingCustomer(null);
      setPayAmount('');
      showToast(`Pago de ${formatMoney(amount)} registrado`);
    } catch (err) {
      showToast('Error al registrar pago', 'error');
    }
  };

  return (
    <div className="p-4 md:p-6 max-w-[1400px] mx-auto space-y-6">
      <div>
        <h2 className="text-2xl font-black text-slate-900">Clientes y Fiados</h2>
        <p className="text-xs text-slate-500">
          Control de cuentas corrientes y recordatorios por WhatsApp
        </p>
      </div>

      <form
        onSubmit={handleAddCustomer}
        className="bg-white border border-slate-200 rounded-3xl p-4 shadow-sm flex flex-col sm:flex-row gap-3"
      >
        <input
          type="text"
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Nombre del cliente (Ej: Marta Gómez)"
          className="flex-1 px-4 py-2.5 rounded-2xl border border-slate-300 text-sm font-semibold"
        />
        <input
          type="tel"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          placeholder="WhatsApp (Ej: 5491122334455)"
          className="sm:w-64 px-4 py-2.5 rounded-2xl border border-slate-300 text-sm"
        />
        <button
          type="submit"
          className="px-5 py-2.5 rounded-2xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-sm"
        >
          + Agregar Cliente
        </button>
      </form>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {customers.map((c: any) => {
          const debt = Number(c.debt || 0);
          const cleanPhone = (c.phone || '').replace(/\D/g, '');
          const waMsg = encodeURIComponent(
            `Hola ${c.name}, te saludamos de *${storeName}*. Te recordamos que tu saldo actual en la libreta es de *${formatMoney(debt)}*. ¡Muchas gracias!`
          );
          return (
            <div
              key={c.id}
              className="bg-white border border-slate-200 rounded-3xl p-5 shadow-sm flex flex-col justify-between space-y-4"
            >
              <div>
                <div className="font-extrabold text-base text-slate-900">{c.name}</div>
                <div className="text-xs text-slate-400">{c.phone || 'Sin teléfono'}</div>
                <div className="mt-3 p-3 rounded-2xl bg-slate-50 flex justify-between items-center">
                  <span className="text-xs font-bold text-slate-500">Saldo Fiado:</span>
                  <span
                    className={`text-xl font-black ${
                      debt > 0 ? 'text-rose-600' : 'text-emerald-600'
                    }`}
                  >
                    {formatMoney(debt)}
                  </span>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={() => {
                    setPayingCustomer(c);
                    setPayAmount(debt > 0 ? String(debt) : '');
                  }}
                  className="py-2.5 rounded-xl bg-emerald-600 text-white font-bold text-xs"
                >
                  Registrar Pago
                </button>
                <a
                  href={
                    cleanPhone
                      ? `https://wa.me/${cleanPhone}?text=${waMsg}`
                      : `https://wa.me/?text=${waMsg}`
                  }
                  target="_blank"
                  rel="noopener noreferrer"
                  className="py-2.5 rounded-xl bg-slate-900 text-white font-bold text-xs flex items-center justify-center gap-1.5"
                >
                  <MessageCircle className="w-3.5 h-3.5" /> WhatsApp
                </a>
              </div>
            </div>
          );
        })}
      </div>

      {payingCustomer && (
        <div className="fixed inset-0 bg-slate-950/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl max-w-sm w-full p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-extrabold text-base">
                Pago de {payingCustomer.name}
              </h3>
              <button
                onClick={() => setPayingCustomer(null)}
                className="p-1.5 rounded-xl bg-slate-100"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <form onSubmit={handleRegisterDebtPayment} className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-600 mb-1">
                  Monto que entrega ($):
                </label>
                <input
                  type="number"
                  required
                  autoFocus
                  value={payAmount}
                  onChange={(e) => setPayAmount(e.target.value)}
                  className="w-full px-4 py-3 rounded-2xl border border-slate-300 text-xl font-black"
                />
              </div>
              <button
                type="submit"
                className="w-full py-3 rounded-2xl bg-emerald-600 text-white font-extrabold text-sm"
              >
                Confirmar Entrega
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// COMPONENTES AUXILIARES: ESCÁNER DE BARRAS, ETIQUETAS, VOZ IA Y BOLETAS IA
// ============================================================================
function BarcodeScannerModal({ onRawDetected, onManualCode, onClose }: any) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [manualInput, setManualInput] = useState('');
  const [cameraError, setCameraError] = useState('');

  useEffect(() => {
    let stream: MediaStream | null = null;
    let intervalId: any = null;
    let active = true;

    const startCamera = async () => {
      try {
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
          setCameraError('Cámara no disponible en este navegador. Ingresá el código abajo.');
          return;
        }
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment' },
        });
        if (!active) return;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
        }

        if ('BarcodeDetector' in window) {
          const detector = new (window as any).BarcodeDetector({
            formats: ['ean_13', 'ean_8', 'code_128', 'upc_a', 'upc_e', 'qr_code'],
          });
          intervalId = setInterval(async () => {
            if (!videoRef.current || videoRef.current.readyState < 2) return;
            try {
              const codes = await detector.detect(videoRef.current);
              if (codes && codes.length > 0 && codes[0].rawValue) {
                clearInterval(intervalId);
                onRawDetected(codes[0].rawValue);
              }
            } catch {}
          }, 350);
        } else {
          setCameraError(
            'Tu navegador no soporta lectura automática por cámara. Podés usar lector USB o escribir el número abajo.'
          );
        }
      } catch (err) {
        setCameraError(
          'No se pudo abrir la cámara. Verificá los permisos o ingresá el código manualmente.'
        );
      }
    };

    startCamera();

    return () => {
      active = false;
      if (intervalId) clearInterval(intervalId);
      if (stream) {
        stream.getTracks().forEach((t) => t.stop());
      }
    };
  }, [onRawDetected]);

  return (
    <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-[60] flex items-center justify-center p-4">
      <div className="bg-white rounded-3xl max-w-md w-full p-5 shadow-2xl space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ScanBarcode className="w-5 h-5 text-emerald-600" />
            <h3 className="font-extrabold text-base">Escanear Código de Barras</h3>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-xl bg-slate-100">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="relative rounded-2xl overflow-hidden bg-slate-900 aspect-video flex items-center justify-center">
          <video ref={videoRef} className="w-full h-full object-cover" muted playsInline />
          <div className="absolute inset-x-8 h-0.5 bg-rose-500 shadow-[0_0_8px_#f43f5e]" />
        </div>

        {cameraError && (
          <p className="text-xs text-amber-700 bg-amber-50 p-2.5 rounded-xl">
            {cameraError}
          </p>
        )}

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
            placeholder="O escribí / pasá lector USB..."
            className="flex-1 px-3.5 py-2.5 rounded-xl border border-slate-300 text-sm font-mono"
          />
          <button
            type="submit"
            className="px-4 py-2.5 rounded-xl bg-emerald-600 text-white font-bold text-sm"
          >
            Usar
          </button>
        </form>
      </div>
    </div>
  );
}

function BarcodeLabelModal({ product, storeName, onClose }: any) {
  return (
    <div className="fixed inset-0 bg-slate-950/75 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-3xl max-w-xs w-full p-6 shadow-2xl space-y-4 text-center">
        <div className="flex justify-between items-center">
          <span className="text-xs font-bold text-slate-400">Etiqueta Góndola</span>
          <button onClick={onClose} className="p-1.5 rounded-xl bg-slate-100">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div
          id="printable-ticket-area"
          className="p-4 rounded-2xl border-2 border-slate-900 text-center space-y-1"
        >
          <div className="text-[10px] font-bold uppercase text-slate-500">{storeName}</div>
          <div className="font-extrabold text-sm text-slate-900">{product.name}</div>
          <div className="text-3xl font-black text-slate-900 py-1">
            {formatMoney(product.price)}
          </div>
          {product.code && (
            <div className="font-mono text-xs tracking-widest text-slate-600">
              *{product.code}*
            </div>
          )}
        </div>

        <button
          onClick={() => window.print()}
          className="w-full py-3 rounded-2xl bg-slate-900 text-white font-bold text-xs flex items-center justify-center gap-2"
        >
          <Printer className="w-4 h-4" /> Imprimir Etiqueta
        </button>
      </div>
    </div>
  );
}

function VoiceOrderModal({ products, customers, onApplyOrder, onClose }: any) {
  const [transcript, setTranscript] = useState('');
  const [isListening, setIsListening] = useState(false);
  const [loadingAI, setLoadingAI] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const recognitionRef = useRef<any>(null);

  const [customGeminiKey] = useState(() => {
    if (GEMINI_API_KEY) return GEMINI_API_KEY;
    try {
      return localStorage.getItem('almacen_gemini_api_key') || '';
    } catch {
      return '';
    }
  });

  const activeApiKey = (customGeminiKey || GEMINI_API_KEY || '').trim();

  const toggleMic = () => {
    setErrorMsg('');
    const SpeechRec =
      typeof window !== 'undefined' &&
      ((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition);

    if (!SpeechRec) {
      setErrorMsg(
        'Tu navegador no soporta dictado directo; podés usar el micrófono del teclado del celular o escribir el pedido.'
      );
      return;
    }

    if (isListening && recognitionRef.current) {
      recognitionRef.current.stop();
      setIsListening(false);
      return;
    }

    const rec = new SpeechRec();
    rec.lang = 'es-AR';
    rec.continuous = false;
    rec.interimResults = true;
    rec.onresult = (event: any) => {
      const text = Array.from(event.results)
        .map((r: any) => r[0].transcript)
        .join('');
      setTranscript(text);
    };
    rec.onerror = () => {
      setIsListening(false);
    };
    rec.onend = () => {
      setIsListening(false);
    };
    recognitionRef.current = rec;
    setIsListening(true);
    rec.start();
  };

  const handleInterpretOrder = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!transcript.trim()) return;
    setLoadingAI(true);
    setErrorMsg('');

    try {
      if (activeApiKey) {
        const catalogSummary = products
          .map((p: any) => `${p.id}: ${p.name} (${p.isWeighed ? 'por Kg' : 'unidad'})`)
          .join('\n');
        const custSummary = customers.map((c: any) => `${c.id}: ${c.name}`).join('\n');

        const prompt = `Sos el asistente de un almacén argentino. Interpretá este pedido: "${transcript}".
Catálogo disponible:
${catalogSummary}

Clientes:
${custSummary}

Respondé ÚNICAMENTE un JSON válido con formato:
{"items":[{"productId":"id","qty":1}],"customerId":null}
Para productos por Kg convertí gramos o fracciones ("medio kilo"=0.5, "un cuarto"=0.25).`;

        const data = await callGeminiAPI(
          activeApiKey,
          [{ parts: [{ text: prompt }] }],
          { responseMimeType: 'application/json' }
        );

        const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text || '{}';
        const parsed = JSON.parse(rawText);
        const matched = (parsed.items || [])
          .map((it: any) => {
            const p = products.find((prod: any) => prod.id === it.productId);
            return p ? { product: p, qty: Number(it.qty) || 1 } : null;
          })
          .filter(Boolean);

        if (matched.length > 0) {
          onApplyOrder(matched, parsed.customerId || null);
          return;
        }
      }

      const lower = transcript.toLowerCase();
      const matchedLocal: any[] = [];
      products.forEach((p: any) => {
        const keywords = p.name
          .toLowerCase()
          .split(/\s+/)
          .filter((w: string) => w.length > 3);
        if (keywords.some((kw: string) => lower.includes(kw))) {
          let qty = 1;
          if (p.isWeighed) {
            if (lower.includes('medio')) qty = 0.5;
            else if (lower.includes('cuarto')) qty = 0.25;
          } else {
            const numMatch = lower.match(new RegExp(`(\\d+)\\s+${keywords[0]}`));
            if (numMatch) qty = parseInt(numMatch[1], 10) || 1;
          }
          matchedLocal.push({ product: p, qty });
        }
      });

      const foundCust = customers.find((c: any) =>
        lower.includes(c.name.toLowerCase().split(' ')[0])
      );

      if (matchedLocal.length > 0) {
        onApplyOrder(matchedLocal, foundCust?.id || null);
      } else {
        setErrorMsg('No encontré productos coincidentes en tu catálogo. Probá con otro nombre.');
      }
    } catch (err) {
      setErrorMsg('No se pudo procesar el pedido.');
    } finally {
      setLoadingAI(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-slate-950/75 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-3xl max-w-md w-full p-6 shadow-2xl space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-violet-600" />
            <h3 className="font-extrabold text-lg">Dictar Pedido con IA</h3>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-xl bg-slate-100">
            <X className="w-4 h-4" />
          </button>
        </div>

        <p className="text-xs text-slate-500">
          Tocá el micrófono o escribí natural: ej.{' '}
          <em>"2 yerbas playadito, medio kilo de cremoso y una coca"</em>
        </p>

        <div className="flex justify-center">
          <button
            type="button"
            onClick={toggleMic}
            className={`w-16 h-16 rounded-full flex items-center justify-center text-white shadow-lg transition ${
              isListening
                ? 'bg-rose-600 animate-pulse'
                : 'bg-violet-600 hover:bg-violet-700'
            }`}
          >
            {isListening ? <MicOff className="w-7 h-7" /> : <Mic className="w-7 h-7" />}
          </button>
        </div>

        <form onSubmit={handleInterpretOrder} className="space-y-3">
          <textarea
            rows={3}
            value={transcript}
            onChange={(e) => setTranscript(e.target.value)}
            placeholder="Escribí o dictá el pedido acá..."
            className="w-full p-3.5 rounded-2xl border border-slate-300 text-sm"
          />

          {errorMsg && (
            <p className="text-xs text-rose-600 bg-rose-50 p-2.5 rounded-xl">
              {errorMsg}
            </p>
          )}

          <button
            type="submit"
            disabled={loadingAI || !transcript.trim()}
            className="w-full py-3.5 rounded-2xl bg-violet-600 hover:bg-violet-700 disabled:opacity-50 text-white font-extrabold text-sm"
          >
            {loadingAI ? 'Interpretando pedido...' : 'Armar Carrito'}
          </button>
        </form>
      </div>
    </div>
  );
}

function InvoiceImporterModal({ roundStep, roundThreshold, onImport, onClose }: any) {
  const [rows, setRows] = useState([
    { name: 'Yerba Mate Playadito 1kg', qty: 10, cost: 2950, price: 3900 },
  ]);
  const [loadingAI, setLoadingAI] = useState(false);
  const [statusMsg, setStatusMsg] = useState('');
  const [previewUrl, setPreviewUrl] = useState('');
  const [customGeminiKey, setCustomGeminiKey] = useState(() => {
    if (GEMINI_API_KEY) return GEMINI_API_KEY;
    try {
      return localStorage.getItem('almacen_gemini_api_key') || '';
    } catch {
      return '';
    }
  });
  const [showKeyInput, setShowKeyInput] = useState(false);

  const activeApiKey = (customGeminiKey || GEMINI_API_KEY || '').trim();

  const handleSaveApiKey = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = customGeminiKey.trim();
    try {
      localStorage.setItem('almacen_gemini_api_key', trimmed);
    } catch {}
    setShowKeyInput(false);
    setStatusMsg(
      trimmed
        ? 'Clave IA guardada. Tocá "Sacar Foto / Subir Boleta" para leer una factura.'
        : 'Clave IA quitada.'
    );
  };

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const objectUrl = URL.createObjectURL(file);
    setPreviewUrl(objectUrl);

    if (!activeApiKey) {
      setStatusMsg(
        'Foto cargada. Para lectura automática con IA agregá tu clave de Gemini o cargá/editá los renglones abajo.'
      );
      setShowKeyInput(true);
      return;
    }

    setLoadingAI(true);
    setStatusMsg('Analizando boleta con Inteligencia Artificial...');

    try {
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
          const resultStr = String(reader.result || '');
          const parts = resultStr.split(',');
          resolve(parts[1] || '');
        };
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });

      const prompt = `Extraé los productos de esta factura/remito de proveedor. Respondé SOLO JSON válido:
{"items":[{"name":"Nombre producto","qty":1,"unitCost":1000}]}`;

      const data = await callGeminiAPI(
        activeApiKey,
        [
          {
            parts: [
              { text: prompt },
              { inlineData: { mimeType: file.type || 'image/jpeg', data: base64 } },
            ],
          },
        ],
        { responseMimeType: 'application/json' }
      );

      const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text || '{}';
      const parsed = JSON.parse(rawText);
      const extracted = (parsed.items || []).map((it: any) => {
        const cost = Number(it.unitCost) || 0;
        return {
          name: it.name || 'Producto',
          qty: Number(it.qty) || 1,
          cost,
          price: roundPrice(cost * 1.35, roundStep, roundThreshold),
        };
      });

      if (extracted.length > 0) {
        setRows(extracted);
        setStatusMsg(`Se detectaron ${extracted.length} productos. Revisá y confirmá.`);
      } else {
        setStatusMsg('No se encontraron renglones en la imagen. Agregalos abajo.');
      }
    } catch (err: any) {
      setStatusMsg(
        `No se pudo leer con IA: ${err?.message || 'error desconocido'}. Podés cargar los renglones abajo.`
      );
    } finally {
      setLoadingAI(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-slate-950/75 backdrop-blur-sm z-50 flex items-center justify-center p-3 sm:p-4">
      <div className="bg-white rounded-3xl max-w-2xl w-full p-5 sm:p-6 shadow-2xl max-h-[92vh] flex flex-col space-y-3.5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-violet-600" />
            <h3 className="font-extrabold text-lg">Importar Boleta / Factura</h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-xl bg-slate-100 text-slate-600"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <label className="px-4 py-2.5 rounded-2xl bg-violet-600 hover:bg-violet-700 text-white font-bold text-xs flex items-center gap-2 cursor-pointer">
            <Camera className="w-4 h-4" />
            <span>{loadingAI ? 'Leyendo...' : 'Sacar Foto / Subir Boleta'}</span>
            <input
              type="file"
              accept="image/*"
              onChange={handleImageUpload}
              className="hidden"
            />
          </label>

          <button
            type="button"
            onClick={() =>
              setRows([...rows, { name: '', qty: 1, cost: 0, price: 0 }])
            }
            className="px-3.5 py-2.5 rounded-2xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs"
          >
            + Agregar Renglón
          </button>

          <button
            type="button"
            onClick={() => setShowKeyInput((prev) => !prev)}
            className="px-3 py-2.5 rounded-2xl bg-violet-50 hover:bg-violet-100 text-violet-800 font-bold text-xs"
          >
            {activeApiKey ? 'Clave IA Lista' : 'Configurar Clave IA'}
          </button>
        </div>

        {showKeyInput && (
          <form
            onSubmit={handleSaveApiKey}
            className="p-3 rounded-2xl bg-slate-50 border border-slate-200 space-y-2"
          >
            <label className="block text-[11px] font-bold text-slate-600">
              API Key de Google Gemini (se guarda en este navegador):
            </label>
            <div className="flex gap-2">
              <input
                type="password"
                value={customGeminiKey}
                onChange={(e) => setCustomGeminiKey(e.target.value)}
                placeholder="AIzaSy..."
                className="flex-1 min-w-0 px-3 py-2 rounded-xl border border-slate-300 text-xs font-mono"
              />
              <button
                type="submit"
                className="px-3.5 py-2 rounded-xl bg-violet-600 text-white font-bold text-xs shrink-0"
              >
                Guardar
              </button>
            </div>
          </form>
        )}

        {previewUrl && (
          <div className="flex items-center gap-3 p-2.5 rounded-2xl bg-slate-50 border border-slate-200">
            <img
              src={previewUrl}
              alt="Boleta cargada"
              className="w-14 h-14 object-cover rounded-xl border border-slate-300 shrink-0"
            />
            <div className="min-w-0 flex-1">
              <div className="text-xs font-bold text-slate-800">Imagen de boleta lista</div>
              <div className="text-[11px] text-slate-500">
                {loadingAI
                  ? 'Procesando con IA...'
                  : 'Verificá o completá los productos y precios abajo.'}
              </div>
            </div>
          </div>
        )}

        {statusMsg && (
          <p className="text-xs text-violet-900 bg-violet-50 border border-violet-200 p-2.5 rounded-xl font-semibold">
            {statusMsg}
          </p>
        )}

        <div className="flex-1 overflow-y-auto space-y-2.5 pr-0.5">
          {rows.map((r, idx) => (
            <div
              key={idx}
              className="p-2.5 rounded-2xl bg-slate-50 border border-slate-200 space-y-2"
            >
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={r.name}
                  onChange={(e) => {
                    const copy = [...rows];
                    copy[idx] = { ...copy[idx], name: e.target.value };
                    setRows(copy);
                  }}
                  placeholder="Nombre del producto"
                  className="flex-1 min-w-0 px-3 py-2 rounded-xl border border-slate-300 bg-white text-xs font-semibold"
                />
                <button
                  type="button"
                  onClick={() => setRows(rows.filter((_, i) => i !== idx))}
                  className="p-2 text-rose-500 hover:bg-rose-50 rounded-xl shrink-0"
                  title="Quitar renglón"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>

              <div className="grid grid-cols-3 gap-2">
                <div>
                  <span className="block text-[10px] font-bold text-slate-500 mb-0.5">
                    Cantidad
                  </span>
                  <input
                    type="number"
                    step="any"
                    value={r.qty}
                    onChange={(e) => {
                      const copy = [...rows];
                      copy[idx] = {
                        ...copy[idx],
                        qty: parseFloat(e.target.value) || 0,
                      };
                      setRows(copy);
                    }}
                    className="w-full px-2.5 py-1.5 rounded-xl border border-slate-300 bg-white text-xs font-bold"
                  />
                </div>

                <div>
                  <span className="block text-[10px] font-bold text-slate-500 mb-0.5">
                    Costo $
                  </span>
                  <input
                    type="number"
                    step="any"
                    value={r.cost}
                    onChange={(e) => {
                      const copy = [...rows];
                      const c = parseFloat(e.target.value) || 0;
                      copy[idx] = {
                        ...copy[idx],
                        cost: c,
                        price: roundPrice(c * 1.35, roundStep, roundThreshold),
                      };
                      setRows(copy);
                    }}
                    className="w-full px-2.5 py-1.5 rounded-xl border border-slate-300 bg-white text-xs"
                  />
                </div>

                <div>
                  <span className="block text-[10px] font-bold text-slate-500 mb-0.5">
                    Venta $
                  </span>
                  <input
                    type="number"
                    step="any"
                    value={r.price}
                    onChange={(e) => {
                      const copy = [...rows];
                      copy[idx] = {
                        ...copy[idx],
                        price: parseFloat(e.target.value) || 0,
                      };
                      setRows(copy);
                    }}
                    className="w-full px-2.5 py-1.5 rounded-xl border border-slate-300 bg-white text-xs font-extrabold text-emerald-700"
                  />
                </div>
              </div>
            </div>
          ))}
        </div>

        <button
          type="button"
          disabled={loadingAI || rows.length === 0}
          onClick={() => onImport(rows.filter((r) => r.name.trim()))}
          className="w-full py-3.5 rounded-2xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-extrabold text-sm"
        >
          Confirmar e Ingresar al Stock
        </button>
      </div>
    </div>
  );
}
