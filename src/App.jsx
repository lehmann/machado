import { useState, useEffect, useRef, useCallback } from 'react';

const LANGS = {
  pt: { label: 'Português (Brasil)', flag: '🇧🇷', placeholder: 'Digite o texto em português...' },
  de: { label: 'Deutsch', flag: '🇩🇪', placeholder: 'Text auf Deutsch eingeben...' },
};

const MAX_CHARS = 2000;

// If the app was built with a dev token baked in and localStorage has none yet,
// persist it so all existing token checks work without further changes.
if (typeof __DEV_HF_TOKEN__ === 'string' && __DEV_HF_TOKEN__ && !localStorage.getItem('hf_token')) {
  localStorage.setItem('hf_token', __DEV_HF_TOKEN__);
}

export default function App() {
  const [source, setSource] = useState('');
  const [target, setTarget] = useState('');
  const [from, setFrom] = useState('pt');
  const [to, setTo] = useState('de');
  const [modelState, setModelState] = useState({ status: 'idle', progress: 0, file: '' });
  const [isTranslating, setIsTranslating] = useState(false);
  const [copied, setCopied] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [token, setToken] = useState(() => localStorage.getItem('hf_token') ?? '');
  const [tokenDraft, setTokenDraft] = useState(() => localStorage.getItem('hf_token') ?? '');

  const workerRef = useRef(null);
  const debounceRef = useRef(null);
  const reqIdRef = useRef(0);
  const currentReqRef = useRef(0);

  useEffect(() => {
    const worker = new Worker(new URL('./translator.worker.js', import.meta.url), { type: 'module' });

    worker.onmessage = ({ data }) => {
      switch (data.type) {
        case 'progress': {
          const s = data.status;
          if (s === 'initiate') {
            // New file starting — reset percentage for this file
            setModelState(prev =>
              prev.status === 'idle' || prev.status === 'loading' || prev.status === 'ready'
                ? { status: 'loading', progress: 0, file: data.file ?? '' }
                : prev
            );
          } else if ((s === 'progress' || s === 'download') && typeof data.progress === 'number') {
            setModelState({ status: 'loading', progress: Math.round(data.progress), file: data.file ?? '' });
          } else if (s === 'done') {
            // File done; while waiting for next initiate or model_ready, show "initializing"
            setModelState(prev =>
              prev.status === 'loading'
                ? { ...prev, progress: 100, file: 'Inicializando modelo ONNX…' }
                : prev
            );
          }
          break;
        }
        case 'model_ready':
          // Models loaded, but pivot inference is still running — keep the
          // "Traduzindo…" indicator until the 'result' message arrives.
          setModelState({ status: 'ready', progress: 100, file: '' });
          break;
        case 'result':
          if (data.id === currentReqRef.current) {
            setTarget(data.text);
            setIsTranslating(false);
            setModelState(prev => prev.status !== 'ready' ? { status: 'ready', progress: 100, file: '' } : prev);
          }
          break;
        case 'error':
          setModelState({ status: 'error', progress: 0, file: '', message: data.message });
          setIsTranslating(false);
          break;
      }
    };

    worker.onerror = (e) => {
      setModelState({
        status: 'error',
        progress: 0,
        file: '',
        message: `Falha ao inicializar o worker: ${e.message ?? 'erro desconhecido'}. Abra o console do navegador para detalhes.`,
      });
      setIsTranslating(false);
    };

    workerRef.current = worker;

    // Send token (if any) right after worker creation
    const savedToken = localStorage.getItem('hf_token');
    if (savedToken) worker.postMessage({ type: 'set_token', token: savedToken });

    return () => worker.terminate();
  }, []);

  const doTranslate = useCallback((text, direction, id) => {
    if (!text.trim()) {
      setTarget('');
      setIsTranslating(false);
      return;
    }
    // If no token, open settings instead of hanging silently
    if (!localStorage.getItem('hf_token')) {
      setTokenDraft('');
      setShowSettings(true);
      setIsTranslating(false);
      return;
    }
    currentReqRef.current = id;
    setIsTranslating(true);
    workerRef.current?.postMessage({ type: 'translate', text, direction, id });
  }, []);

  const scheduleTranslate = useCallback((text, direction) => {
    clearTimeout(debounceRef.current);
    if (!text.trim()) { setTarget(''); return; }
    const id = ++reqIdRef.current;
    debounceRef.current = setTimeout(() => doTranslate(text, direction, id), 600);
  }, [doTranslate]);

  const handleChange = (e) => {
    const text = e.target.value.slice(0, MAX_CHARS);
    setSource(text);
    scheduleTranslate(text, `${from}-${to}`);
  };

  const handleSwap = () => {
    const prevTarget = target;
    const prevSource = source;
    const newFrom = to;
    const newTo = from;
    setFrom(newFrom);
    setTo(newTo);
    setSource(prevTarget);
    setTarget(prevSource);
    scheduleTranslate(prevTarget, `${newFrom}-${newTo}`);
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(target);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // clipboard API unavailable (non-HTTPS)
    }
  };

  const handleClear = () => {
    clearTimeout(debounceRef.current);
    setSource('');
    setTarget('');
  };

  const handleSaveToken = () => {
    const t = tokenDraft.trim();
    localStorage.setItem('hf_token', t);
    setToken(t);
    workerRef.current?.postMessage({ type: 'set_token', token: t });
    setShowSettings(false);
    setModelState({ status: 'idle', progress: 0, file: '' });
  };

  const handleClearCache = () => {
    workerRef.current?.postMessage({ type: 'clear_cache' });
    setModelState({ status: 'idle', progress: 0, file: '' });
    setTarget('');
  };

  return (
    <div className="app">
      <header className="app-header">
        <div className="brand">
          <span className="brand-name">machado</span>
          <span className="brand-sep">·</span>
          <span className="brand-tag">Tradutor PT ↔ DE</span>
        </div>
        <div className="header-right">
          <div className="privacy-badge">🔒 Processamento local</div>
          <button
            className="btn-settings"
            onClick={() => { setTokenDraft(token); setShowSettings(s => !s); }}
            title="Configurações"
            aria-label="Configurações"
          >
            ⚙
          </button>
        </div>
      </header>

      {showSettings && (
        <SettingsPanel
          tokenDraft={tokenDraft}
          onTokenChange={setTokenDraft}
          onSave={handleSaveToken}
          onClearCache={handleClearCache}
          onClose={() => setShowSettings(false)}
        />
      )}

      <ModelStatusBar
        state={modelState}
        hasToken={!!token}
        crossOriginIsolated={self.crossOriginIsolated}
        onOpenSettings={() => { setTokenDraft(token); setShowSettings(true); }}
      />

      <main className="translator-layout">
        <Panel
          lang={from}
          value={source}
          onChange={handleChange}
          editable
          charCount={source.length}
          maxChars={MAX_CHARS}
          onClear={handleClear}
        />

        <button className="swap-btn" onClick={handleSwap} aria-label="Inverter idiomas" title="Inverter idiomas">
          ⇄
        </button>

        <Panel
          lang={to}
          value={target}
          isTranslating={isTranslating}
          modelState={modelState}
          onCopy={handleCopy}
          copied={copied}
        />
      </main>

      <footer className="app-footer">
        <span>Helsinki-NLP opus-mt via Transformers.js</span>
        <span>Os textos <strong>não</strong> saem do seu dispositivo</span>
      </footer>
    </div>
  );
}

function Panel({ lang, value, onChange, editable, charCount, maxChars, onClear, isTranslating, modelState, onCopy, copied }) {
  const info = LANGS[lang];
  const isModelLoading = modelState?.status === 'loading';
  const busy = isTranslating || isModelLoading;

  let outputContent;
  if (isModelLoading) {
    const pct = modelState.progress > 0 ? ` (${modelState.progress}%)` : '';
    outputContent = (
      <span className="translating-indicator">
        <span className="dot-pulse" />
        {`Baixando modelo${pct}…`}
      </span>
    );
  } else if (isTranslating) {
    outputContent = (
      <span className="translating-indicator">
        <span className="dot-pulse" />
        Traduzindo…
      </span>
    );
  } else if (value) {
    outputContent = value;
  } else {
    outputContent = <span className="placeholder-text">A tradução aparecerá aqui</span>;
  }

  return (
    <div className={`panel ${editable ? 'panel-source' : 'panel-target'}`}>
      <div className="panel-header">
        <span className="lang-label">
          <span className="lang-flag">{info.flag}</span>
          {info.label}
        </span>
        <div className="panel-actions">
          {editable && charCount > 0 && (
            <button className="btn-ghost" onClick={onClear}>Limpar</button>
          )}
          {!editable && value && !busy && (
            <button className="btn-ghost btn-copy" onClick={onCopy}>
              {copied ? '✓ Copiado' : 'Copiar'}
            </button>
          )}
          {editable && (
            <span className="char-counter">{charCount}/{maxChars}</span>
          )}
        </div>
      </div>

      <div className="panel-body">
        {editable ? (
          <textarea
            className="text-area"
            placeholder={info.placeholder}
            value={value}
            onChange={onChange}
            spellCheck
          />
        ) : (
          <div className={`text-area output ${busy ? 'is-loading' : ''}`}>
            {outputContent}
          </div>
        )}
      </div>
    </div>
  );
}

function ModelStatusBar({ state, hasToken, crossOriginIsolated, onOpenSettings }) {
  if (state.status === 'idle') {
    return (
      <div className="status-bar status-info">
        <span>💡</span>
        <span>
          Na primeira tradução de cada sentido, os modelos (~150 MB por sentido, via pivô em inglês) serão baixados e salvos no navegador.{' '}
          {!hasToken && (
            <>
              O HuggingFace Hub requer autenticação —{' '}
              <button className="link-btn" onClick={onOpenSettings}>configure um token gratuito</button>.{' '}
            </>
          )}
          {!crossOriginIsolated && (
            <strong style={{ color: 'var(--warning)' }}>
              ⚠ Cross-Origin Isolation desativado — reinicie o servidor (npm run dev) para que o ONNX funcione.
            </strong>
          )}
        </span>
      </div>
    );
  }

  if (state.status === 'loading') {
    return (
      <div className="status-bar status-loading">
        <div className="progress-wrap">
          <div className="progress-header">
            <span>Baixando modelo de tradução...</span>
            <span className="progress-pct">{state.progress}%</span>
          </div>
          <div className="progress-track">
            <div className="progress-fill" style={{ width: `${state.progress}%` }} />
          </div>
          {state.file && <span className="progress-file">{state.file}</span>}
        </div>
      </div>
    );
  }

  if (state.status === 'ready') {
    return (
      <div className="status-bar status-ready">
        <span>✓</span>
        <span>Modelo carregado · Tradução 100% offline</span>
      </div>
    );
  }

  if (state.status === 'error') {
    const isAuth = state.message?.toLowerCase().includes('unauthorized') ||
                   state.message?.toLowerCase().includes('403') ||
                   state.message?.toLowerCase().includes('401');
    return (
      <div className="status-bar status-error">
        <span>⚠</span>
        <div>
          <div>Erro ao carregar modelo: {state.message}</div>
          {isAuth && (
            <div style={{ marginTop: 4, fontSize: 12 }}>
              O HuggingFace Hub exige autenticação.{' '}
              <button className="link-btn" onClick={onOpenSettings}>
                Configure um token gratuito
              </button>{' '}
              em huggingface.co/settings/tokens.
            </div>
          )}
        </div>
      </div>
    );
  }

  return null;
}

function SettingsPanel({ tokenDraft, onTokenChange, onSave, onClearCache, onClose }) {
  return (
    <div className="settings-panel">
      <div className="settings-header">
        <strong>Configurações</strong>
        <button className="btn-ghost btn-sm" onClick={onClose}>✕</button>
      </div>
      <p className="settings-desc">
        O HuggingFace Hub requer um token para baixar modelos. Crie um token
        gratuito (somente leitura) em{' '}
        <a href="https://huggingface.co/settings/tokens" target="_blank" rel="noopener noreferrer">
          huggingface.co/settings/tokens
        </a>.
      </p>
      <div className="settings-row">
        <input
          className="token-input"
          type="password"
          placeholder="hf_xxxxxxxxxxxxxxxxxxxxxxxx"
          value={tokenDraft}
          onChange={e => onTokenChange(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && onSave()}
          spellCheck={false}
          autoComplete="off"
        />
        <button className="btn-primary" onClick={onSave}>Salvar</button>
      </div>
      <p className="settings-note">
        O token é salvo apenas no seu navegador (localStorage) e nunca é enviado a nenhum servidor nosso.
      </p>
      <hr className="settings-divider" />
      <div className="settings-cache-row">
        <div>
          <strong style={{ fontSize: 13 }}>Cache do modelo</strong>
          <p className="settings-note" style={{ marginTop: 2 }}>
            Se o download travou ou um arquivo corrompido foi cacheado, limpe e tente novamente.
          </p>
        </div>
        <button className="btn-ghost btn-sm" onClick={onClearCache}>Limpar cache</button>
      </div>
    </div>
  );
}
