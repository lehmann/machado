# machado ⚒️ — Tradutor PT ↔ DE

Tradutor **Português (Brasil) ↔ Alemão** com análise de dificuldade **CEFR
(A1–C2)** por frase e **explicação gramatical** por palavra. Foi desenhado em
torno de uma promessa de privacidade: por padrão, **os textos não saem do seu
dispositivo**.

O app funciona em dois modos, escolhidos automaticamente:

| Modo | Onde roda | Motor de tradução | Quando é usado |
|---|---|---|---|
| **Local** (padrão) | 100% no navegador | Helsinki-NLP OPUS-MT (ONNX via [Transformers.js]), pivô em inglês | Offline, sem consentimento, ou servidor indisponível |
| **Servidor** | Na sua própria máquina | NLLB-200-distilled-1.3B (CTranslate2, GPU), PT↔DE direto | Só com consentimento explícito **e** servidor acessível |

Nunca há terceiros no caminho: não usa Google/DeepL nem nenhum LLM em nuvem. O
modo servidor roda inteiramente em hardware seu.

[Transformers.js]: https://github.com/xenova/transformers.js

## Como funciona

```
┌──────────────────────────── navegador ────────────────────────────┐
│  React (App.jsx)                                                   │
│        │  talkes only to →                                         │
│  TranslatorEngine  ── resolve modo (consent + online + /health) ── │
│        ├── LocalProvider  → Web Worker → Transformers.js (ONNX)    │
│        └── ServerProvider → fetch /translate ─────────────┐        │
└───────────────────────────────────────────────────────────┼───────┘
                                                             ▼
                          ┌──────────── servidor (opcional, local) ──┐
                          │  FastAPI                                  │
                          │   ├── CTranslate2 + NLLB-200 (tradução)   │
                          │   └── spaCy + listas de frequência (CEFR) │
                          └───────────────────────────────────────────┘
```

Os dois motores emitem **exatamente o mesmo formato de resultado** (um array
`parts[]` de `{type:"gap"|"sentence", text, cefr?}`), então a UI renderiza de
forma idêntica independentemente de qual motor rodou. Se um pedido ao servidor
falha no meio, o engine cai para o modo local e reenvia o mesmo pedido,
avisando a UI da troca.

A pontuação CEFR combina três eixos — raridade de vocabulário (listas de
frequência), comprimento da frase e complexidade sintática — e é mostrada num
tooltip ao passar o mouse sobre cada frase traduzida.

**Explicação gramatical:** clicar (ou selecionar) uma palavra no texto traduzido
abre um tooltip com sua função gramatical (classe + morfologia) e **realça as
outras palavras da frase impactadas por ela** — p.ex., no alemão, o gênero do
substantivo governa a declinação de artigo/adjetivo, e o sujeito governa a
conjugação do verbo. Como a tradução/CEFR, a análise tem **um contrato único** e
**dois provedores**: heurística + léxico compacto no navegador (badge `≈ local`)
ou spaCy no servidor (badge `☁️ servidor`), com o mesmo fraseado PT-BR gerado na
UI (`src/grammar/describe.js`). O roteamento é por capacidade: o servidor só é
usado se `/health` anuncia `models.grammar` para o idioma; senão, cai no local.

## Estrutura do repositório

```
.
├── src/                    # Frontend React + Web Worker  → veja src/README.md
│   ├── engine/             #   camada de indireção local/servidor
│   ├── grammar/            #   análise gramatical (heurística + providers)
│   ├── data/               #   listas de frequência (geradas)
│   ├── cefr.js             #   estimador CEFR (navegador)
│   └── translator.worker.js#   pivô OPUS-MT em Web Worker
├── server/                 # Backend FastAPI opcional      → veja server/README.md
├── scripts/build-freq.mjs  # gerador one-time das listas de frequência
├── scripts/build-lexicon.mjs # gerador do léxico de gênero alemão (local)
├── test/                   # testes JS (unit + integração UI↔servidor)
├── .github/workflows/      # CI: testes a cada push
├── vite.config.js
└── index.html
```

## Início rápido (modo local, sem servidor)

Requer **Node 18+**.

```bash
npm install
npm run dev            # http://localhost:5173
```

O modo local baixa modelos do HuggingFace Hub na primeira tradução (~150 MB por
sentido). O Hub exige autenticação: crie um token gratuito (somente leitura) em
[huggingface.co/settings/tokens](https://huggingface.co/settings/tokens) e
informe-o em **⚙ Configurações**. Detalhes em [`src/README.md`](src/README.md).

## Modo servidor (opcional)

Para tradução PT↔DE direta (NLLB-200) e CEFR mais precisa (spaCy), suba o
backend e aponte a UI para ele. Passo a passo em
[`server/README.md`](server/README.md). Resumo:

```bash
# 1) sobe o servidor (após setup descrito no server/README.md)
cd server && uvicorn app.main:app --port 8000

# 2) aponta a UI para ele (na raiz do repo)
echo 'VITE_SERVER_URL=http://localhost:8000' >> .env.local

# 3) ligue "Permitir processamento no servidor" em ⚙ Configurações
```

## Testes

| Comando | O que roda |
|---|---|
| `npm test` | Testes JS: unit + integração |
| `npm run test:unit` | Unit JS (`node:test`, sem dependências extras) |
| `npm run test:integration` | Integração: engine da UI ↔ servidor real por HTTP |
| `npm run test:server` | Testes Python do servidor (`pytest`) |

Os testes de integração e do servidor sobem o backend com o seam de teste
`MACHADO_FAKE_MT=1`, que substitui a tradução real por uma resposta
determinística — assim **não** precisam de GPU, do modelo NLLB nem das
dependências pesadas (`ctranslate2`/`spacy`/`transformers`). Basta instalar as
deps leves:

```bash
pip install -r server/requirements-ci.txt   # fastapi, uvicorn, httpx, pytest
```

> ⚠️ `MACHADO_FAKE_MT` é exclusivo de testes e **nunca** deve ser ligado em
> produção.

## Integração contínua

`.github/workflows/tests.yml` roda a suíte a **cada push, em qualquer branch e
no `main`**, em dois jobs paralelos: testes do servidor (pytest) e testes web
(unit + integração). Usa as deps leves de CI acima — nada de GPU ou download de
modelo.

## Offline (PWA)

O app é uma **PWA**: um service worker (`public/sw.js`) cacheia o shell da página
(HTML/JS/CSS/worker) e o runtime `.wasm` do ONNX, então **a página principal abre
mesmo sem internet** após a primeira visita online. Os pesos dos modelos são
cacheados separadamente pelo Transformers.js (`useBrowserCache`), de modo que a
tradução local também funciona offline uma vez baixados. O service worker só é
registrado em build de produção (`npm run build` + `npm run preview`); em dev ele
fica desativado para não conflitar com o HMR do Vite.

## Privacidade

- **Padrão local:** nenhum texto sai do navegador; os modelos rodam via WASM/ONNX.
- **Modo servidor:** só com consentimento explícito, e o servidor é seu — os
  dados não deixam sua infraestrutura.
- **Token HuggingFace:** guardado apenas no `localStorage` do navegador; nunca é
  enviado a nenhum servidor nosso. O arquivo `huggingface.token` é apenas uma
  conveniência de desenvolvimento (injetado só em dev; string vazia em builds de
  produção) e **não deve ser versionado**.

## Stack

- **Frontend:** React 18, Vite 5, Web Worker, `@xenova/transformers` (ONNX Runtime Web)
- **Servidor:** FastAPI, CTranslate2 (NLLB-200-distilled-1.3B), spaCy
- **Testes:** `node:test` (JS), `pytest` (Python)
