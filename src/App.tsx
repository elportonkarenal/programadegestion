import React, { useState, useEffect, useMemo, useRef } from 'react';
import { initializeApp } from 'firebase/app';
import {
  getAuth,
  signInAnonymously,
  onAuthStateChanged,
  User,
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
  const [user, setUser] = useState<User | null>(null);
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
