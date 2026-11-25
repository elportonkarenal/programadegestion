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
