import { useState, useEffect, useRef, useCallback } from 'react';
import { TranslatorEngine } from './engine/TranslatorEngine.js';
import { describeToken, describeRelation } from './grammar/describe.js';
import { suggestSynonyms } from './grammar/synonyms.js';

const SERVER_BASE_URL = import.meta.env.VITE_SERVER_URL ?? '';

// True when this build serves the local-engine models from its own origin
// (production; VITE_MODELS_BASE set at build time). Then no HuggingFace token is
// needed to use the app offline, so the token prompts/gate are suppressed.
const MODELS_SELF_HOSTED = typeof __MODELS_BASE__ === 'string' && __MODELS_BASE__ !== '';

// Split a sentence into clickable words + inert chunks (spaces/punctuation), each
// carrying char offsets RELATIVE to the sentence — the same coordinate space the
// grammar analysis uses, so words map to tokens by offset overlap.
const WORD_RE = /[\p{L}\p{N}][\p{L}\p{N}­'’\-]*/gu;

function segmentSentence(text) {
  const segs = [];
  let last = 0;
  WORD_RE.lastIndex = 0;
  let m;
  while ((m = WORD_RE.exec(text)) !== null) {
    if (m.index > last) segs.push({ text: text.slice(last, m.index), start: last, end: m.index, word: false });
    segs.push({ text: m[0], start: m.index, end: m.index + m[0].length, word: true });
    last = m.index + m[0].length;
  }
  if (last < text.length) segs.push({ text: text.slice(last), start: last, end: text.length, word: false });
  return segs;
}

// The (non-punct) token with the largest overlap with [start, end), or null.
function findTokenAtOffset(tokens, start, end) {
  let best = null;
  let bestOverlap = 0;
  for (const t of tokens ?? []) {
    if (t.isPunct) continue;
    const overlap = Math.min(end, t.end) - Math.max(start, t.start);
    if (overlap > bestOverlap) { bestOverlap = overlap; best = t; }
  }
  return bestOverlap > 0 ? best : null;
}

// From the focus token, collect the other ends of every relation it takes part in
// (for highlighting) plus the PT-BR phrases describing those relations.
function relate(analysis, focusIdx) {
  const related = [];
  const phrases = [];
  const seen = new Set();
  for (const rel of analysis.relations ?? []) {
    const deps = rel.deps ?? [];
    const involvesFocus = rel.head === focusIdx || deps.includes(focusIdx);
    if (!involvesFocus) continue;
    const phrase = describeRelation(rel, analysis.tokens, focusIdx);
    if (phrase) phrases.push(phrase);
    const others = rel.head === focusIdx ? deps : [rel.head];
    for (const j of others) {
      if (j === focusIdx || seen.has(j)) continue;
      seen.add(j);
      related.push({ i: j, kind: rel.kind });
    }
  }
  return { related, phrases };
}

// CSS class for a word segment given the active grammar analysis for its sentence.
function wordClass(active, seg) {
  if (!active?.analysis) return '';
  const tok = findTokenAtOffset(active.analysis.tokens, seg.start, seg.end);
  if (!tok) return '';
  if (tok.i === active.focusIdx) return 'grammar-focus';
  const rel = active.related.find((r) => r.i === tok.i);
  return rel ? `grammar-related grammar-rel-${rel.kind}` : '';
}

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
  const [targetParts, setTargetParts] = useState(null);
  const [tip, setTip] = useState(null); // { cefr, x, y }
  const [grammar, setGrammar] = useState(null); // { sentenceIdx, analysis, focusIdx, focusToken, related, phrases, x, y, loading }
  const [from, setFrom] = useState('pt');
  const [to, setTo] = useState('de');
  const [modelState, setModelState] = useState({ status: 'idle', progress: 0, file: '' });
  const [isTranslating, setIsTranslating] = useState(false);
  const [copied, setCopied] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [token, setToken] = useState(() => localStorage.getItem('hf_token') ?? '');
  const [tokenDraft, setTokenDraft] = useState(() => localStorage.getItem('hf_token') ?? '');
  const [serverConsent, setServerConsent] = useState(() => localStorage.getItem('server_consent') === '1');
  const [activeMode, setActiveMode] = useState('local'); // 'local' | 'server'

  const engineRef = useRef(null);
  const debounceRef = useRef(null);
  const reqIdRef = useRef(0);
  const currentReqRef = useRef(0);
  const grammarOpenRef = useRef(false); // mirror of `grammar` for stable callbacks

  useEffect(() => { grammarOpenRef.current = !!grammar; }, [grammar]);

  useEffect(() => {
    const engine = new TranslatorEngine(
      {
        onProgress: (data) => {
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
        },
        onModelReady: () => {
          // Models loaded, but pivot inference is still running — keep the
          // "Traduzindo…" indicator until the 'result' event arrives.
          setModelState({ status: 'ready', progress: 100, file: '' });
        },
        onResult: (data) => {
          if (data.id === currentReqRef.current) {
            setTarget(data.text);
            setTargetParts(data.parts ?? null);
            setGrammar(null); // offsets/sentences changed
            setIsTranslating(false);
            setModelState(prev => prev.status !== 'ready' ? { status: 'ready', progress: 100, file: '' } : prev);
          }
        },
        onError: (data) => {
          setModelState({ status: 'error', progress: 0, file: '', message: data.message });
          setIsTranslating(false);
        },
        onNeedToken: () => {
          // Local engine needs an HF token before it can download models.
          setTokenDraft('');
          setShowSettings(true);
          setIsTranslating(false);
        },
        onModeChange: (mode) => setActiveMode(mode),
      },
      {
        serverBaseUrl: SERVER_BASE_URL,
        hasToken: !!localStorage.getItem('hf_token'),
        consent: localStorage.getItem('server_consent') === '1',
        modelsSelfHosted: MODELS_SELF_HOSTED,
      }
    );

    const savedToken = localStorage.getItem('hf_token');
    if (savedToken) engine.setToken(savedToken);

    engineRef.current = engine;
    return () => engine.dispose();
  }, []);

  const doTranslate = useCallback((text, direction, id) => {
    if (!text.trim()) {
      setTarget('');
      setTargetParts(null);
      setIsTranslating(false);
      return;
    }
    currentReqRef.current = id;
    setIsTranslating(true);
    // The engine resolves local vs server and, in local mode with no token,
    // triggers onNeedToken (opening settings) instead of hanging.
    engineRef.current?.translate({ text, direction, id });
  }, []);

  const scheduleTranslate = useCallback((text, direction) => {
    clearTimeout(debounceRef.current);
    if (!text.trim()) { setTarget(''); setTargetParts(null); return; }
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
    setTargetParts(null);
    setGrammar(null);
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
    setTargetParts(null);
    setGrammar(null);
  };

  const showTip = useCallback((e, cefr) => {
    if (!cefr || grammarOpenRef.current) return; // grammar tooltip takes precedence
    const r = e.currentTarget.getBoundingClientRect();
    setTip({ cefr, x: r.left, y: r.bottom });
  }, []);
  const hideTip = useCallback(() => setTip(null), []);

  // Analyze the clicked/selected span of a sentence and open the grammar tooltip.
  const handleWordClick = useCallback(async (sentenceIdx, sentenceText, start, end, rect) => {
    const engine = engineRef.current;
    if (!engine) return;
    setTip(null);
    const x = rect.left;
    const y = rect.bottom;
    setGrammar({ sentenceIdx, x, y, loading: true, analysis: null, focusIdx: -1, related: [], phrases: [] });
    try {
      const analysis = await engine.analyzeGrammar({ text: sentenceText, lang: to });
      const focus = findTokenAtOffset(analysis.tokens, start, end);
      if (!focus) { setGrammar(null); return; }
      const { related, phrases } = relate(analysis, focus.i);
      const synonyms = await suggestSynonyms(focus, to);
      setGrammar({ sentenceIdx, x, y, loading: false, analysis, focusIdx: focus.i, focusToken: focus, related, phrases, synonyms });
    } catch {
      setGrammar(null);
    }
  }, [to]);

  // A drag-selection within a single sentence behaves like clicking its first
  // content word (focus = first token overlapping the selected range).
  const handleOutputMouseUp = useCallback(() => {
    const sel = typeof window !== 'undefined' ? window.getSelection() : null;
    if (!sel || sel.isCollapsed || sel.rangeCount === 0) return; // plain click → word onClick handles it
    const range = sel.getRangeAt(0);
    const startEl = (range.startContainer.nodeType === 1 ? range.startContainer : range.startContainer.parentElement)?.closest('[data-start]');
    const endEl = (range.endContainer.nodeType === 1 ? range.endContainer : range.endContainer.parentElement)?.closest('[data-start]');
    if (!startEl || !endEl) return;
    const sentEl = startEl.closest('[data-sidx]');
    if (!sentEl || sentEl !== endEl.closest('[data-sidx]')) return; // ignore cross-sentence selections
    const sentenceIdx = Number(sentEl.dataset.sidx);
    const part = targetParts?.[sentenceIdx];
    if (!part || part.type !== 'sentence') return;
    const selStart = Number(startEl.dataset.start);
    const selEnd = Number(endEl.dataset.end);
    handleWordClick(sentenceIdx, part.text, selStart, selEnd, range.getBoundingClientRect());
  }, [targetParts, handleWordClick]);

  // Dismiss the grammar tooltip on Esc or a click outside a word/the tooltip.
  useEffect(() => {
    if (!grammar) return;
    const onKey = (e) => { if (e.key === 'Escape') setGrammar(null); };
    const onDown = (e) => {
      if (e.target.closest?.('.word') || e.target.closest?.('.grammar-tip')) return;
      setGrammar(null);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onDown);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onDown);
    };
  }, [grammar]);

  const handleSaveToken = () => {
    const t = tokenDraft.trim();
    localStorage.setItem('hf_token', t);
    setToken(t);
    engineRef.current?.setToken(t);
    setShowSettings(false);
    setModelState({ status: 'idle', progress: 0, file: '' });
  };

  const handleClearCache = () => {
    engineRef.current?.clearCache();
    setModelState({ status: 'idle', progress: 0, file: '' });
    setTarget('');
  };

  const handleToggleConsent = useCallback((next) => {
    setServerConsent(next);
    localStorage.setItem('server_consent', next ? '1' : '0');
    engineRef.current?.setConsent(next);
    if (!next) setActiveMode('local');
  }, []);

  // Fresh server-availability probe for the settings UI.
  const checkServer = useCallback(() => engineRef.current?.checkServer() ?? Promise.resolve(false), []);

  return (
    <div className="app">
      <header className="app-header">
        <div className="brand">
          <span className="brand-name">machado</span>
          <span className="brand-sep">·</span>
          <span className="brand-tag">Tradutor PT ↔ DE</span>
        </div>
        <div className="header-right">
          <div className="privacy-badge" title={activeMode === 'server'
            ? 'As traduções estão sendo processadas no servidor'
            : 'As traduções são processadas no seu dispositivo'}>
            {activeMode === 'server' ? '☁️ Processamento no servidor' : '🔒 Processamento local'}
          </div>
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
          serverConsent={serverConsent}
          onToggleConsent={handleToggleConsent}
          onCheckServer={checkServer}
          selfHosted={MODELS_SELF_HOSTED}
        />
      )}

      <ModelStatusBar
        state={modelState}
        activeMode={activeMode}
        hasToken={!!token || MODELS_SELF_HOSTED}
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
          parts={targetParts}
          onSentenceEnter={showTip}
          onSentenceLeave={hideTip}
          isTranslating={isTranslating}
          modelState={modelState}
          onCopy={handleCopy}
          copied={copied}
          grammar={grammar}
          onWordClick={handleWordClick}
          onOutputMouseUp={handleOutputMouseUp}
        />
      </main>

      {tip && !grammar && <CefrTooltip tip={tip} />}
      {grammar && <GrammarTooltip grammar={grammar} onClose={() => setGrammar(null)} />}

      <footer className="app-footer">
        <span>
          {activeMode === 'server'
            ? 'NLLB-200 via servidor local'
            : 'Helsinki-NLP opus-mt via Transformers.js'}
        </span>
        <span>
          {activeMode === 'server'
            ? <>Processamento no <strong>servidor</strong> (com seu consentimento)</>
            : <>Os textos <strong>não</strong> saem do seu dispositivo</>}
        </span>
      </footer>
    </div>
  );
}

function Panel({ lang, value, parts, onSentenceEnter, onSentenceLeave, onChange, editable, charCount, maxChars, onClear, isTranslating, modelState, onCopy, copied, grammar, onWordClick, onOutputMouseUp }) {
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
  } else if (parts && parts.length) {
    outputContent = parts.map((p, i) =>
      p.type === 'sentence' ? (
        <span
          key={i}
          data-sidx={i}
          className={`sentence ${p.cefr ? `cefr-${p.cefr.level}` : ''}`}
          onMouseEnter={p.cefr ? (e) => onSentenceEnter(e, p.cefr) : undefined}
          onMouseLeave={p.cefr ? onSentenceLeave : undefined}
        >
          {segmentSentence(p.text).map((seg, j) => {
            const active = grammar?.sentenceIdx === i ? grammar : null;
            return seg.word ? (
              <span
                key={j}
                className={`word ${wordClass(active, seg)}`.trim()}
                data-start={seg.start}
                data-end={seg.end}
                onClick={(e) => onWordClick?.(i, p.text, seg.start, seg.end, e.currentTarget.getBoundingClientRect())}
              >
                {seg.text}
              </span>
            ) : (
              <span key={j} data-start={seg.start} data-end={seg.end}>{seg.text}</span>
            );
          })}
        </span>
      ) : (
        <span key={i}>{p.text}</span>
      )
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
          <div className={`text-area output ${busy ? 'is-loading' : ''}`} onMouseUp={onOutputMouseUp}>
            {outputContent}
          </div>
        )}
      </div>
    </div>
  );
}

const CEFR_LABELS = {
  A1: 'Iniciante', A2: 'Básico', B1: 'Intermediário',
  B2: 'Intermediário superior', C1: 'Avançado', C2: 'Proficiente',
};

function CefrTooltip({ tip }) {
  const { cefr, x, y } = tip;
  // Clamp within the viewport so long tooltips near the edge stay readable.
  const left = Math.min(x, window.innerWidth - 280);
  return (
    <div className="cefr-tip" style={{ left: Math.max(8, left), top: y + 8 }}>
      <div className="cefr-tip-head">
        <span className={`cefr-badge cefr-${cefr.level}`}>{cefr.level}</span>
        <span className="cefr-tip-label">{CEFR_LABELS[cefr.level]}</span>
      </div>
      <ul className="cefr-tip-factors">
        {cefr.factors.map((f, i) => <li key={i}>{f}</li>)}
      </ul>
    </div>
  );
}

function GrammarTooltip({ grammar, onClose }) {
  const { x, y, loading, analysis, focusToken, phrases, synonyms } = grammar;
  const left = Math.min(x, window.innerWidth - 320);
  const desc = focusToken ? describeToken(focusToken) : null;
  const isServer = analysis?.source === 'server';

  return (
    <div className="grammar-tip" style={{ left: Math.max(8, left), top: y + 8 }} role="dialog">
      <div className="grammar-tip-head">
        <span className="grammar-tip-word">{focusToken?.text ?? '…'}</span>
        <span className={`grammar-source ${isServer ? 'grammar-source-server' : 'grammar-source-local'}`}
          title={isServer ? 'Análise do servidor (spaCy)' : 'Análise local, aproximada'}>
          {isServer ? '☁️ servidor' : '≈ local'}
        </span>
        <button className="btn-ghost btn-sm grammar-tip-close" onClick={onClose} aria-label="Fechar">✕</button>
      </div>

      {loading ? (
        <div className="grammar-tip-loading">
          <span className="dot-pulse" /> Analisando…
        </div>
      ) : (
        <>
          <div className="grammar-tip-pos">
            <strong>{desc?.title}</strong>
            {desc?.detail && <span className="grammar-tip-morph"> · {desc.detail}</span>}
          </div>
          {phrases?.length > 0 && (
            <ul className="grammar-tip-relations">
              {phrases.map((ph, i) => <li key={i}>{ph}</li>)}
            </ul>
          )}
          {synonyms?.length > 0 && (
            <div className="grammar-tip-synonyms">
              <span className="grammar-tip-synonyms-label">Sinônimos</span>
              {synonyms.map((s, i) => <span key={i} className="grammar-synonym">{s}</span>)}
            </div>
          )}
          <div className="grammar-legend">
            <span className="grammar-legend-item"><span className="swatch grammar-focus" /> palavra</span>
            <span className="grammar-legend-item"><span className="swatch grammar-rel-agreement" /> concordância</span>
            <span className="grammar-legend-item"><span className="swatch grammar-rel-government" /> regência</span>
          </div>
        </>
      )}
    </div>
  );
}

function ModelStatusBar({ state, activeMode, hasToken, crossOriginIsolated, onOpenSettings }) {
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
    const onServer = activeMode === 'server';
    return (
      <div className="status-bar status-ready">
        <span>{onServer ? '☁️' : '✓'}</span>
        <span>
          {onServer
            ? 'Tradução processada no servidor local'
            : 'Modelo carregado · Tradução 100% offline'}
        </span>
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

function SettingsPanel({ tokenDraft, onTokenChange, onSave, onClearCache, onClose, serverConsent, onToggleConsent, onCheckServer, selfHosted }) {
  // 'unknown' until probed; 'checking' | 'up' | 'down' afterwards.
  const [serverStatus, setServerStatus] = useState('unknown');

  const probe = useCallback(async () => {
    setServerStatus('checking');
    const ok = await onCheckServer();
    setServerStatus(ok ? 'up' : 'down');
  }, [onCheckServer]);

  // Probe once when consent is on so the user sees availability immediately.
  useEffect(() => {
    if (serverConsent) probe();
    else setServerStatus('unknown');
  }, [serverConsent, probe]);

  return (
    <div className="settings-panel">
      <div className="settings-header">
        <strong>Configurações</strong>
        <button className="btn-ghost btn-sm" onClick={onClose}>✕</button>
      </div>

      <div className="settings-mode">
        <label className="settings-toggle">
          <input
            type="checkbox"
            checked={serverConsent}
            onChange={(e) => onToggleConsent(e.target.checked)}
          />
          <span>
            <strong style={{ fontSize: 13 }}>Permitir processamento no servidor</strong>
            <span className="settings-note" style={{ display: 'block', marginTop: 2 }}>
              Envia o texto ao servidor local para tradução (NLLB-200) e análise CEFR
              mais precisas. Sem consentimento, ou offline, tudo roda no seu dispositivo.
            </span>
          </span>
        </label>
        {serverConsent && (
          <div className="settings-server-status">
            {serverStatus === 'checking' && <span className="status-dot status-dot-idle" />}
            {serverStatus === 'up' && <span className="status-dot status-dot-up" />}
            {serverStatus === 'down' && <span className="status-dot status-dot-down" />}
            <span>
              {serverStatus === 'checking' && 'Verificando servidor…'}
              {serverStatus === 'up' && 'Servidor disponível'}
              {serverStatus === 'down' && 'Servidor indisponível — usando modo local'}
              {serverStatus === 'unknown' && 'Status desconhecido'}
            </span>
            <button className="link-btn" onClick={probe}>Verificar</button>
          </div>
        )}
      </div>

      <hr className="settings-divider" />

      {selfHosted ? (
        <p className="settings-desc">
          Esta instância serve os modelos de tradução do próprio servidor, então
          <strong> não é necessário nenhum token</strong> para usar o modo local
          offline.
        </p>
      ) : (
        <>
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
        </>
      )}
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
