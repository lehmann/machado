# machado — frontend (UI)

App React (Vite) que traduz **PT ↔ DE** e anota cada frase com um nível **CEFR
(A1–C2)**. A UI é **agnóstica ao motor**: ela fala apenas com o
`TranslatorEngine`, que decide em tempo de execução entre rodar tudo no
navegador (modo local) ou delegar ao servidor local (modo servidor). Ambos
devolvem o mesmo formato, então a renderização é idêntica.

Para a visão geral do projeto e o backend, veja [`../README.md`](../README.md)
e [`../server/README.md`](../server/README.md).

## Layout

```
src/
├── main.jsx               # bootstrap React
├── App.jsx                # UI: painéis, tooltip CEFR, tooltip de gramática, configurações
├── index.css             # estilos
├── cefr.js               # estimador CEFR heurístico (modo local)
├── translator.worker.js  # Web Worker: pivô OPUS-MT (ONNX) + segmentação
├── engine/
│   ├── TranslatorEngine.js  # camada de indireção: resolve local vs servidor
│   ├── LocalProvider.js     # envolve o Web Worker
│   └── ServerProvider.js    # fala HTTP com o backend
├── grammar/
│   ├── describe.js          # ÚNICA fonte de fraseado PT-BR (token + relação)
│   ├── synonyms.js          # sugestão de sinônimos (UI-side, lazy, os dois modos)
│   ├── heuristic.js         # analyzeLocal(text, lang) — regras + léxico
│   ├── LocalGrammarProvider.js  # provider local (heurística)
│   ├── ServerGrammarProvider.js # provider servidor (POST /grammar)
│   └── data/
│       ├── closed-class.js  # tabelas de artigos/pronomes/preposições DE+PT
│       ├── de-gender.js     # gênero de substantivos alemães (gerado, compacto)
│       ├── synonyms-de.js   # tesauro DE (gerado, chunk lazy)
│       └── synonyms-pt.js   # tesauro PT (gerado, chunk lazy)
└── data/
    ├── freq-pt.js        # listas de frequência (geradas) — usadas pelo CEFR
    └── freq-de.js        #   (fonte única, reaproveitadas pelo servidor)
```

## A camada de indireção (`engine/`)

`App.jsx` cria **um** `TranslatorEngine`, passa um pacote de callbacks
(`onProgress`, `onModelReady`, `onResult`, `onError`, `onNeedToken`,
`onModeChange`, `onModeFallback`) e chama `engine.translate({ text, direction,
id })`. O engine faz o resto:

- **Resolução de modo** a cada tradução:
  `servidor ⟺ consentimento AND online AND /health OK` (cacheado ~30 s);
  caso contrário, `local`.
- **Fallback:** se um pedido ao servidor falha de forma recuperável, ele marca o
  servidor como indisponível, reenvia o mesmo pedido ao motor local e dispara
  `onModeFallback` + `onModeChange`.
- **Gate de token:** no modo local sem token HF, dispara `onNeedToken` (que abre
  as Configurações) em vez de travar silenciosamente.
- **Seam de teste:** o 3º argumento do construtor aceita
  `{ createLocal, createServer }` para injetar provedores falsos nos testes.

### Provedores

- **`LocalProvider`** — instancia o `translator.worker.js` e mapeia as mensagens
  do worker (`progress`/`model_ready`/`result`/`error`) para os callbacks.
  Resultados vêm marcados com `engine:'local'`.
- **`ServerProvider`** — `health()` faz `GET /health`; `translate()` faz
  `POST /translate {text, source, target}` e emite `onResult`/`onError` com
  `engine:'server'`.

### O contrato `parts[]`

Todo resultado carrega um array ordenado que a UI renderiza verbatim:

```js
{ type: 'gap',      text }              // espaços/quebras a preservar
{ type: 'sentence', text, cefr }        // frase traduzida + avaliação CEFR
```

Onde `cefr = { level, index, factors, metrics }` — `level` é `A1…C2`, `factors`
são strings em português exibidas no tooltip.

## Tradução no modo local (`translator.worker.js`)

Não existe modelo OPUS-MT ONNX direto PT↔DE, então o worker **pivota pelo
inglês** com modelos de par único (`pt→en→de` e `de→en→pt`). Como o OPUS-MT é
sentence-level (descarta tudo após a primeira frase), o texto é **segmentado em
frases** (via `Intl.Segmenter`, com fallback por regex) antes de traduzir; cada
frase preserva os espaços ao redor para a reassembly. Wrappers de parênteses são
"descascados" antes da tradução e recolocados depois. O CEFR é calculado sobre a
frase **de destino**.

O worker cuida ainda de: injeção do token HF nas requisições ao Hub (o
Transformers.js não anexa headers de auth no navegador), fixação dos binários
`.wasm` do ONNX Runtime na CDN, watchdog de download e limpeza de cache.

## CEFR no modo local (`cefr.js`)

`assessSentence(text, lang)` combina três eixos e produz um índice composto:

```
0.55 · vocabulário  +  0.30 · comprimento  +  0.15 · sintaxe
```

- **Vocabulário:** raridade média do quartil mais difícil, via rank nas listas
  de frequência (`data/freq-*.js`).
- **Comprimento:** faixas por número de palavras.
- **Sintaxe:** conjunções subordinativas + vírgulas (fronteiras de oração).

É uma aproximação — como toda pontuação CEFR frase a frase inerentemente é. O
servidor espelha essa mesma forma, enriquecida com a análise de dependências do
spaCy.

## Explicação gramatical (`grammar/`)

Clicar ou selecionar uma palavra no painel de saída abre um tooltip com sua
**função gramatical** e realça as palavras da frase **impactadas por ela**. Segue
o mesmo padrão da tradução: **um contrato, dois provedores**.

- **Contrato compartilhado** (local == servidor), por frase:
  ```js
  {
    lang: 'de' | 'pt',
    source: 'server' | 'local',          // → badge ☁️ servidor / ≈ local
    tokens: [{ i, start, end, text, pos, lemma, morph:{Gender,Case,Number,Person,…}, isPunct }],
    relations: [{ type, kind:'agreement'|'government'|'dependency', head, deps:[…], features:[…] }]
  }
  ```
  `start/end` são offsets **relativos ao texto da frase** — a UI casa palavra↔token
  por sobreposição de offsets (tolera divergências de tokenização).
- **`describe.js` é a única fonte de fraseado PT-BR.** Os provedores emitem só
  dados estruturados; `describeToken`/`describeRelation` viram texto. Isso garante
  fraseado idêntico entre local e servidor e mantém o servidor enxuto.
- **`LocalGrammarProvider`** → `heuristic.analyzeLocal` (regras + `data/closed-class.js`
  + `data/de-gender.js`). Explicitamente aproximado (badge `≈ local`).
- **`ServerGrammarProvider`** → `POST /grammar`; lança em falha (o engine trata o
  fallback para o local).
- **Roteamento por capacidade:** `engine.analyzeGrammar({ text, lang })` usa o
  servidor só se `consent && online && /health.models.grammar[lang]`; senão, ou em
  falha, cai no local. Resultados são cacheados por `(lang, text)` e o cache é
  limpo a cada nova tradução.

O léxico de gênero (`data/de-gender.js`) é gerado por `scripts/build-lexicon.mjs`
(veja Scripts).

### Sinônimos (`synonyms.js`)

O mesmo tooltip sugere **1–2 sinônimos** quando faz sentido. `suggestSynonyms(token,
lang)` (assíncrono) roda **só na UI** e serve os dois modos: chaveia pelo `lemma`
do token (ou, quando o heurístico local não fornece, pelo texto) + a classe, e
consulta um tesauro aberto empacotado (`data/synonyms-{de,pt}.js`, importados
sob demanda como chunks separados). O servidor não muda — emite só o contrato; a
sugestão é derivada aqui, idêntica em ambos (o modo servidor é melhor por dar
`lemma` real). Só sugere para classe aberta (subst./verbo/adj./advérbio) e quando
há correspondência confiável; senão, nada. Fonte/licença: OpenThesaurus (DE) e
TeP 2.0 (PT), via os tesauros MyThes do LibreOffice (licença BSD). Gerado por
`scripts/build-synonyms.mjs` (veja Scripts).

## Configuração e privacidade

- **Token HuggingFace:** necessário no modo local para baixar modelos **do HF
  Hub**. Guardado só no `localStorage`; nunca enviado a servidores nossos. Em dev
  pode ser injetado a partir do arquivo `huggingface.token` (via `define` do Vite);
  builds de produção recebem string vazia. **Em produção com modelos auto-hospedados
  (`VITE_MODELS_BASE`, abaixo) o token não é necessário** — a UI esconde o campo e o
  engine dispensa o gate.
- **`VITE_MODELS_BASE`:** de onde a engine local busca os modelos ONNX. Vazio
  (padrão, incl. dev/preview) → HF Hub (precisa de token). Um build de produção
  seta `/models` (via `scripts/setup-prod.sh`), fazendo o navegador buscar os
  modelos na própria origem (`__MODELS_BASE__` no `translator.worker.js` aponta
  `env.remoteHost`/`remotePathTemplate` para lá) — sem token e sem terceiros. Os
  arquivos são baixados por `scripts/fetch-models.mjs` (veja Scripts) e servidos
  pelo uvicorn em `/models` quando `MACHADO_WEB_MODELS_DIR` está setado.
- **Consentimento de servidor:** persistido em `localStorage` (`server_consent`).
  Sem ele, ou offline, tudo roda localmente. O badge de privacidade e o rodapé
  refletem o modo ativo (`🔒 local` ↔ `☁️ servidor`).
- **`VITE_SERVER_URL`:** URL base do backend (ex.: em `.env.local`). Vazio →
  mesma origem.
- **`VITE_ALLOWED_HOSTS`:** hosts extras aceitos ao servir **via Vite** (`dev` ou
  `vite preview`) atrás de um proxy/domínio público (o Vite bloqueia hosts
  desconhecidos por padrão). Lista separada por vírgulas, ex.:
  `VITE_ALLOWED_HOSTS=machado.limao.uk`. Irrelevante na produção recomendada
  (uvicorn serve o `dist/`; veja `scripts/setup-prod.sh`).

### Cross-Origin Isolation

O ONNX Runtime Web precisa dos headers COOP/COEP para funcionar. O
`vite.config.js` já os define para `dev` e `preview`; se estiver desativado, a
UI mostra um aviso.

## Scripts

```bash
npm run dev       # servidor de desenvolvimento (Vite)
npm run build     # build de produção → dist/
npm run preview   # serve o build
```

Regenerar as listas de frequência (raro, one-time):

```bash
node scripts/build-freq.mjs      # baixa OpenSubtitles freq lists → src/data/freq-*.js
node scripts/build-lexicon.mjs   # gera src/grammar/data/de-gender.js (gênero DE)
node scripts/build-synonyms.mjs  # gera src/grammar/data/synonyms-{de,pt}.js (tesauros)
node scripts/fetch-models.mjs    # baixa os modelos ONNX → web-models/ (auto-hospedar em prod)
```
