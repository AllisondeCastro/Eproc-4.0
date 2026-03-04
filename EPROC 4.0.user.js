// ==UserScript==
// @name         EPROC 4.0
// @namespace    http://tampermonkey.net/
// @version      44.3
// @description  Seleções inteligentes e Complementos ao EPROC
// @author       Allison de Castro Silva
// @match        https://eproc1g.tjmg.jus.br/eproc/controlador.php?acao=localizador_processos_lista*
// @match        https://eproc1g.tjmg.jus.br/eproc/controlador.php?acao=pesquisa_processo*
// @updateURL    https://github.com/AllisondeCastro/Eproc-4.0/raw/refs/heads/main/EPROC%204.0.user.js
// @downloadURL  https://github.com/AllisondeCastro/Eproc-4.0/raw/refs/heads/main/EPROC%204.0.user.js
// @grant        none
// @run-at       document-end
// ==/UserScript==

(function() {
    'use strict';

    // ===========================================================================================
    // CONFIGURAÇÕES & CONSTANTES
    // ===========================================================================================
    // Ajustado para o HTML exato da capa do processo
    const TEXTO_ALVO_1 = "Remetidos os Autos (outros motivos) para Núcleo 4.0";
    const TEXTO_ALVO_2 = "Núcleo 4.0"; // Fallback genérico

    // CONFIGURAÇÕES DO INDEXEDDB (Cache de Processos e Controle de Paralisados)
    const DB_NAME = "EprocCacheDB";
    const DB_VERSION = 2; // Incrementado para criar a nova base
    const STORE_NAME = "processos";
    const STORE_PARALISADOS = "paralisados_vistos"; // Nova Store
    const EXPIRATION_DAYS = 90;

    // Chaves do LocalStorage (Preferências Leves)
    const LS_KEY_BOTOES = "eproc_botoes_personalizados";
    const LS_KEY_ORDEM = "eproc_ordem_botoes_v17";
    const LS_KEY_PAGINACAO = "eproc_paginacao_pref";

    // ARQUITETURA: Token Bucket
    const BUCKET_CAPACITY = 10;
    const TOKENS_PER_SECOND = 4;
    const MAX_CONCURRENCY = 5;

    // Memória da Sessão Atual para "Novos Paralisados"
    const paralisadosNovosSessao = new Set();

    // ===========================================================================================
    // PARTE 1: ESTILOS (CORREÇÃO DE LARGURA DEFINITIVA)
    // ===========================================================================================
    const style = document.createElement('style');
    style.innerHTML = `
        #tabelaLocalizadores tbody tr {
            /* Avisa o navegador que as mudanças na linha não afetam o site inteiro */
            contain: content;
        }

        /* --- CORREÇÃO ESTRUTURAL DA TABELA --- */
        #tabelaLocalizadores {
            width: 100% !important;
            table-layout: auto !important;
            border-collapse: collapse !important;
        }

        #tabelaLocalizadores th, #tabelaLocalizadores td {
            padding: 5px 4px !important;
            vertical-align: middle !important;
        }

        /* 1. COLUNAS COMPACTAS (Datas, Números, Inclusão) */
        /* Col 2: N. Processo */
        #tabelaLocalizadores th:nth-child(2), #tabelaLocalizadores td:nth-child(2) {
            width: 1px !important;
            white-space: nowrap !important;
        }

        /* Col 3: Data Autuação */
        #tabelaLocalizadores th:nth-child(3), #tabelaLocalizadores td:nth-child(3) {
            width: 1px !important;
            white-space: nowrap !important;
        }

        /* Col Final: Inclusão no Localizador */
        #tabelaLocalizadores th:last-child, #tabelaLocalizadores td:last-child {
            width: 1px !important;
            white-space: nowrap !important;
        }

        #tabelaLocalizadores tbody {
            contain: content; /* Evita que a página inteira trave ao atualizar uma célula */
        }

        /* Colunas Inseridas pelo Script (Recebido / Origem) */
        .eproc-col-data-nucleo, .th-nucleo-40 {
            width: 1px !important;
            white-space: nowrap !important;
            text-align: center;
        }
        .eproc-col-origem-nucleo, .th-nucleo-origem {
            width: 1px !important;
            white-space: nowrap !important;
            text-align: center;
            max-width: 150px !important; /* Limite para sigla da vara não esticar demais */
            overflow: hidden !important;
            text-overflow: ellipsis !important;
        }

        /* 2. COLUNAS DE TEXTO LONGO (Localizadores, Último Evento) */
        /* Col 7 (aprox): Localizadores */
        #tabelaLocalizadores th:nth-child(7), #tabelaLocalizadores td:nth-child(7) {
            white-space: normal !important;
            max-width: 220px !important;     /* Largura fixa para forçar a quebra vertical */
            word-wrap: break-word !important;
        }

        /* Penúltima Coluna: Último Evento */
        #tabelaLocalizadores th:nth-last-child(2), #tabelaLocalizadores td:nth-last-child(2) {
            white-space: normal !important;
            max-width: 250px !important;
            word-wrap: break-word !important;
        }

        /* COLUNA E SPINNERS */
        .eproc-col-data-nucleo {
            font-family: 'Calibri', sans-serif !important; font-size: 11pt !important;
            color: #000 !important;
        }
        .eproc-col-origem-nucleo {
            font-family: 'Calibri', sans-serif !important; font-size: 10pt !important;
            color: #444 !important;
        }
        .th-nucleo-40, .th-nucleo-origem {
            font-family: 'Calibri', sans-serif !important; font-size: 11pt !important;
            color: #000 !important; text-align: center !important; cursor: pointer;
            background-color: #f0f0f2 !important;
        }
        .th-nucleo-40:hover, .th-nucleo-origem:hover { background-color: #e2e2e5 !important; }
        .sort-icon { display: inline-block; width: 12px; margin-left: 5px; font-size: 9pt; color: #555; }

        .eproc-spinner {
            border: 2px solid #f3f3f3; border-top: 2px solid #0081c2;
            border-radius: 50%; width: 12px; height: 12px;
            animation: spin 0.8s linear infinite; display: inline-block; vertical-align: middle;
        }
        @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }

        /* ANALYTICS: PARALISAÇÃO */
        tr.tr-paralisado, tr.tr-paralisado > td {
            background-color: #ffe6e6 !important;
        }
        .tr-paralisado td {
            color: #a94442 !important;
        }

        #eproc-alerta-paralisado {
            background-color: #d9534f; color: #fff; font-weight: bold; text-transform: uppercase;
            text-align: center; padding: 10px; margin-bottom: 15px; border-radius: 4px;
            display: none; box-shadow: 0 2px 5px rgba(217, 83, 79, 0.4);
            align-items: center; justify-content: center; gap: 15px; flex-wrap: wrap;
        }

        .eproc-badge-novo {
            background-color: #f39c12; color: #fff; padding: 4px 10px; border-radius: 12px; 
            font-size: 11px; font-weight: bold; border: 1px solid #e67e22; 
            box-shadow: 0 1px 3px rgba(0,0,0,0.1); display: inline-block; vertical-align: middle; text-transform: none;
        }

        /* NOVOS BOTÕES E TOAST */
        .eproc-btn-icon {
            width: 34px !important; padding: 6px 0 !important; text-align: center; margin-left: 5px;
            font-size: 16px !important; line-height: 1 !important;
            display: inline-flex !important; justify-content: center; align-items: center;
        }
        .eproc-btn-icon svg {
            fill: currentColor;
        }

        #eproc-relatorio-btn, #eproc-selecionar-paralisados-btn {
            background-color: #fff; color: #d9534f; border: 1px solid #fff;
            padding: 4px 12px; font-size: 11px; border-radius: 4px; cursor: pointer;
            font-weight: bold; text-transform: none; margin-left: 10px;
            transition: all 0.2s;
        }
        #eproc-relatorio-btn:hover, #eproc-selecionar-paralisados-btn:hover { background-color: #f8f8f8; color: #c9302c; }

        #eproc-toast {
            position: fixed; bottom: 20px; left: 50%; transform: translateX(-50%);
            background-color: #4cae4c; color: white; padding: 10px 25px;
            border-radius: 4px; box-shadow: 0 2px 10px rgba(0,0,0,0.2);
            font-weight: bold; font-size: 14px; z-index: 99999;
            opacity: 0; pointer-events: none; transition: opacity 0.3s;
        }
        #eproc-toast.show { opacity: 1; }

        /* INTERFACE PRINCIPAL */
        #eproc-seletor {
            border: 1px solid #ccc !important; border-radius: 6px; padding: 15px;
            margin: 10px auto 20px auto; width: 99%; background-color: #fff;
            font-family: Arial, Helvetica, sans-serif; box-shadow: 0 1px 2px rgba(0,0,0,0.05);
        }
        .eproc-legend { font-size: 1.2em; font-weight: bold; color: #000; margin-bottom: 15px; border-bottom: 1px solid #eee; padding-bottom: 8px; display: block; width: 100%; }
        .eproc-row { display: flex; flex-wrap: wrap; gap: 12px; align-items: center; margin-bottom: 12px; }
        .eproc-form-control { border: 1px solid #ccc; padding: 6px 8px; font-size: 13px; border-radius: 4px; color: #333; }

        .eproc-btn {
            display: inline-block; padding: 6px 12px; font-size: 13px; font-weight: 500;
            text-align: center; cursor: pointer; border: 1px solid #ccc; border-radius: 6px !important;
            background-image: linear-gradient(to bottom, #fff 0, #e0e0e0 100%); color: #333; transition: all 0.2s;
        }
        .eproc-btn:hover { background-image: none; background-color: #e0e0e0; }
        .eproc-btn-secondary { background: #fff !important; color: #0081c2; }
        .eproc-btn-secondary:hover { background-color: #eef8fa !important; }
        .eproc-btn-danger { background: #fff !important; color: #d9534f; }
        .eproc-btn-danger:hover { background-color: #d9534f !important; color: #fff; }
        .eproc-btn-success { background-image: linear-gradient(to bottom, #5cb85c 0, #419641 100%); border-color: #4cae4c; color: #fff; }

        #eproc-add-btn:hover { background-image: linear-gradient(to bottom, #449d44 0, #398439 100%) !important; background-color: #449d44 !important; border-color: #398439 !important; }

        .eproc-btn-filtro-padrao { background: #fff !important; color: #0081c2 !important; font-weight: normal !important; background-image: none !important; }
        .eproc-btn-filtro-padrao:hover { background-color: #eef8fa !important; border-color: #0081c2 !important; }

        /* TAGS E FEEDBACK */
        #eproc-criterios-lista { display: flex; flex-wrap: wrap; gap: 6px; min-height: 20px; align-items: center; }
        .eproc-tag { background-color: #d9edf7; color: #31708f; border: 1px solid #bce8f1; border-radius: 14px; padding: 4px 10px; font-size: 11px; display: flex; align-items: center; gap: 6px; font-weight: 600; cursor: default; }
        .eproc-tag-close { cursor: pointer; font-weight: bold; color: #a94442; font-size: 14px; margin-left: 2px; }

        /* CÃO DE GUARDA (FEEDBACK) */
        #eproc-feedback {
            margin-top: 10px; padding: 12px; border-radius: 4px; font-weight: bold;
            display: none; text-align: center; font-size: 13px;
            background-color: #fff3cd; color: #856404; border: 1px solid #ffeeba;
            animation: pulse-alert 1.5s infinite;
        }
        @keyframes pulse-alert { 0% { opacity: 1; } 50% { opacity: 0.8; } 100% { opacity: 1; } }

        #eproc-contador { text-align: right; color: #777; font-size: 13px; margin-top: 5px; }

        /* BOTOES AGRUPADOS */
        .eproc-btn-group { display: inline-flex; vertical-align: middle; transition: transform 0.2s; }
        .eproc-btn-group.reorder-mode { cursor: move; animation: pulse 0.5s infinite; }
        .eproc-btn-group .eproc-btn { border-radius: 0 !important; margin-right: 0; }
        .eproc-btn-group .eproc-btn:first-child { border-top-left-radius: 6px !important; border-bottom-left-radius: 6px !important; }
        .eproc-btn-group .eproc-btn:last-child { border-top-right-radius: 6px !important; border-bottom-right-radius: 6px !important; color: #d9534f; font-weight: bold; }
        @keyframes pulse { 0% { transform: scale(1); } 50% { transform: scale(1.05); } 100% { transform: scale(1); } }

        /* MODAL POPUP */
        .eproc-modal-overlay {
            position: fixed; top: 0; left: 0; width: 100%; height: 100%;
            background: rgba(0,0,0,0.5); z-index: 10000;
            display: flex; justify-content: center; align-items: center;
        }
        .eproc-modal-content {
            background: #fff; padding: 20px; border-radius: 6px; width: 320px;
            box-shadow: 0 4px 15px rgba(0,0,0,0.3); font-family: Arial, sans-serif;
            border: 1px solid #ccc;
        }
        .eproc-modal-title { font-size: 16px; font-weight: bold; margin-bottom: 15px; color: #333; border-bottom: 1px solid #eee; padding-bottom: 10px; }
        .eproc-modal-field { margin-bottom: 15px; }
        .eproc-modal-label { display: block; font-size: 12px; font-weight: bold; margin-bottom: 5px; color: #555; }
        .eproc-modal-input { width: 100%; padding: 8px; border: 1px solid #ccc; border-radius: 4px; font-size: 13px; box-sizing: border-box; }
        .eproc-modal-actions { text-align: right; margin-top: 15px; }
        .eproc-modal-btn { padding: 8px 15px; border-radius: 4px; cursor: pointer; font-size: 13px; border: 1px solid transparent; margin-left: 5px; font-weight: bold; }
        .eproc-modal-btn-cancel { background: #fff; border: 1px solid #ccc; color: #333; }
        .eproc-modal-btn-save { background: #5cb85c; color: white; border-color: #4cae4c; }

        .eproc-radio-group { display: flex; gap: 15px; margin-right: 15px; border-right: 1px solid #eee; padding-right: 15px; }
        .eproc-radio-label { font-size: 12px; font-weight: normal; cursor: pointer; display: flex; align-items: center; gap: 4px; }
    `;
    document.head.appendChild(style);


    // ===========================================================================================
    // GESTÃO DE CACHE OTIMIZADA (LAZY HYBRID STRATEGY + BULK GET)
    // ===========================================================================================
    const CacheManager = {
        db: null,
        memoryCache: new Map(), // Cache Síncrono em RAM
        writeBuffer:[], // Buffer para gravação em lote
        writeTimer: null, // Timer para flush automático
        initPromise: null,
        ready: false, // Flag vital

        // Inicializa o banco de dados (SEM WARMUP BLOQUEANTE)
        init: function() {
            if (this.initPromise) return this.initPromise;

            this.initPromise = new Promise((resolve, reject) => {
                const request = indexedDB.open(DB_NAME, DB_VERSION);

                request.onupgradeneeded = (event) => {
                    const db = event.target.result;
                    if (!db.objectStoreNames.contains(STORE_NAME)) {
                        db.createObjectStore(STORE_NAME, { keyPath: "id" });
                    }
                    if (!db.objectStoreNames.contains(STORE_PARALISADOS)) {
                        db.createObjectStore(STORE_PARALISADOS, { keyPath: "id" });
                    }
                };

                request.onsuccess = (event) => {
                    this.db = event.target.result;
                    // OTIMIZAÇÃO: Libera imediatamente. Não espera ler tudo.
                    this.ready = true;

                    // Tarefas de fundo (sem await)
                    this.cleanupOldData();
                    this.migrateDatesFromLocalStorage();
                    resolve(this.db);
                };

                request.onerror = (event) => {
                    console.error("Eproc IDB Error:", event.target.error);
                    this.ready = true; // Libera mesmo com erro para não travar
                    resolve();
                };
            });
            return this.initPromise;
        },

        // GET ASSÍNCRONO PONTUAL (Camada 2 - IndexedDB)
        getAsync: function(id) {
            return new Promise((resolve) => {
                if (!this.db) { resolve(null); return; }
                const tx = this.db.transaction([STORE_NAME], "readonly");
                const store = tx.objectStore(STORE_NAME);
                const req = store.get(id);

                req.onsuccess = () => {
                    const res = req.result;
                    if (res) {
                        const expirationTime = Date.now() - (EXPIRATION_DAYS * 24 * 60 * 60 * 1000);
                        if (res.timestamp >= expirationTime) {
                            // Popula a RAM para a próxima vez (Cache Warming sob demanda)
                            this.memoryCache.set(id, res.value);
                            resolve(res.value);
                        } else {
                            resolve(null);
                        }
                    } else {
                        resolve(null);
                    }
                };
                req.onerror = () => resolve(null);
            });
        },

        // BULK GET (Otimização para leitura em lote)
        warmupChunk: function(keys) {
            return new Promise((resolve) => {
                if (!this.db || keys.length === 0) { resolve(); return; }
                const tx = this.db.transaction([STORE_NAME], "readonly");
                const store = tx.objectStore(STORE_NAME);
                const expirationTime = Date.now() - (EXPIRATION_DAYS * 24 * 60 * 60 * 1000);

                let processed = 0;
                keys.forEach(key => {
                    if (this.memoryCache.has(key)) {
                        processed++;
                        if (processed === keys.length) resolve();
                        return;
                    }

                    const req = store.get(key);
                    req.onsuccess = () => {
                        const res = req.result;
                        if (res && res.timestamp >= expirationTime) {
                            this.memoryCache.set(key, res.value);
                        }
                        processed++;
                        if (processed === keys.length) resolve();
                    };
                    req.onerror = () => {
                        processed++;
                        if (processed === keys.length) resolve();
                    };
                });
            });
        },

        // Validação de paralisados com persistência na Sessão Atual
        checkNovosParalisados: function(ids) {
            return new Promise((resolve) => {
                if (!this.db || ids.length === 0) { resolve([]); return; }
                try {
                    const tx = this.db.transaction([STORE_PARALISADOS], "readwrite");
                    const store = tx.objectStore(STORE_PARALISADOS);
                    const novos =[];
                    let processados = 0;
                    const now = Date.now();

                    ids.forEach(id => {
                        // Se já descobrimos nesta sessão na tela, retorna ele sem olhar no DB
                        if (paralisadosNovosSessao.has(id)) {
                            novos.push(id);
                            checkDone();
                            return;
                        }

                        const req = store.get(id);
                        req.onsuccess = () => {
                            if (!req.result) {
                                novos.push(id);
                                paralisadosNovosSessao.add(id); // Marca na sessão p/ não se perder se o DOM for reescrito
                                store.put({ id: id, timestamp: now }); // Grava no IndexedDB
                            }
                            checkDone();
                        };
                        req.onerror = () => {
                            checkDone();
                        };
                    });

                    function checkDone() {
                        processados++;
                        if (processados === ids.length) {
                            resolve(novos);
                        }
                    }
                } catch (e) {
                    console.error("Erro ao checar paralisados no DB:", e);
                    resolve([]);
                }
            });
        },

        // Migra cache antigo do LS para IDB
        migrateDatesFromLocalStorage: async function() {
            try {
                const oldCacheStr = localStorage.getItem("eproc_dates_cache_v2_persistent");
                if (oldCacheStr) {
                    const tx = this.db.transaction([STORE_NAME], "readwrite");
                    const store = tx.objectStore(STORE_NAME);
                    const now = Date.now();
                    const oldData = JSON.parse(oldCacheStr);

                    for (const [id, val] of Object.entries(oldData)) {
                        store.put({ id: id, value: val, timestamp: now });
                    }
                    localStorage.removeItem("eproc_dates_cache_v2_persistent");
                }
            } catch (e) {}
        },

        cleanupOldData: function() {
            try {
                const tx = this.db.transaction([STORE_NAME], "readwrite");
                const store = tx.objectStore(STORE_NAME);
                const expirationTime = Date.now() - (EXPIRATION_DAYS * 24 * 60 * 60 * 1000);
                const cursorRequest = store.openCursor();
                cursorRequest.onsuccess = (e) => {
                    const cursor = e.target.result;
                    if (cursor) {
                        if (!cursor.value.id.startsWith("pref_") && cursor.value.timestamp < expirationTime) {
                            cursor.delete();
                        }
                        cursor.continue();
                    }
                };
            } catch (e) {}
        },

        // GET SÍNCRONO (Camada 1 - RAM)
        getSync: function(id) {
            return this.memoryCache.get(id);
        },

        // SET Assíncrono com Batching
        set: function(id, val) {
            // Atualiza RAM imediatamente
            this.memoryCache.set(id, val);

            // Buffer IDB
            this.writeBuffer.push({
                id: id,
                value: val,
                timestamp: Date.now()
            });

            if (this.writeBuffer.length >= 20) {
                this.flushBuffer();
            } else {
                if (this.writeTimer) clearTimeout(this.writeTimer);
                this.writeTimer = setTimeout(() => this.flushBuffer(), 5000);
            }
        },

        flushBuffer: function() {
            if (this.writeBuffer.length === 0) return;

            const batch = [...this.writeBuffer];
            this.writeBuffer =[];
            if (this.writeTimer) clearTimeout(this.writeTimer);

            if (!this.db) return;

            const tx = this.db.transaction([STORE_NAME], "readwrite");
            const store = tx.objectStore(STORE_NAME);

            batch.forEach(item => {
                store.put(item);
            });
        }
    };
    CacheManager.init();

    // ===========================================================================================
    // DOM BATCHER
    // ===========================================================================================
    const DomBatcher = {
        queue:[],
        scheduled: false,
        add: function(element, html, row, attributes) {
            this.queue.push({ element, html, row, attributes });
            if (!this.scheduled) {
                this.scheduled = true;
                requestAnimationFrame(() => this.flush());
            }
        },
        flush: function() {
            for (let i = 0; i < this.queue.length; i++) {
                const item = this.queue[i];
                if (item.element) item.element.innerHTML = item.html;
                if (item.row && item.attributes) {
                    for (const[key, val] of Object.entries(item.attributes)) {
                        if (val === null) item.row.removeAttribute(key);
                        else item.row.setAttribute(key, val);
                    }
                }
            }
            this.queue =[];
            this.scheduled = false;
        }
    };

    // UTIL: Toast Feedback
    function mostrarToast() {
        const toast = document.getElementById('eproc-toast');
        if (toast) {
            toast.classList.add('show');
            setTimeout(() => toast.classList.remove('show'), 3000);
        }
    }

    // UTIL: Copy to Clipboard
    async function copiarParaClipboard(conteudoHtml, conteudoTexto) {
        try {
            const blobHtml = new Blob([conteudoHtml], { type: 'text/html' });
            const blobText = new Blob([conteudoTexto], { type: 'text/plain' });
            const data =[new ClipboardItem({ 'text/html': blobHtml, 'text/plain': blobText })];
            await navigator.clipboard.write(data);
            mostrarToast();
        } catch (err) {
            const textArea = document.createElement('textarea');
            textArea.value = conteudoTexto;
            document.body.appendChild(textArea);
            textArea.select();
            document.execCommand('copy');
            document.body.removeChild(textArea);
            mostrarToast();
        }
    }


    // ===========================================================================================
    // ARQUITETURA: TOKEN BUCKET RATE LIMITER
    // ===========================================================================================
    class TokenBucket {
        constructor(capacity, tokensPerSecond) {
            this.capacity = capacity;
            this.tokens = capacity;
            this.rate = tokensPerSecond;
            this.lastRefill = Date.now();
        }

        async consume() {
            this.refill();
            if (this.tokens >= 1) {
                this.tokens -= 1;
                return true;
            }
            const timeToNextToken = (1 / this.rate) * 1000;
            const waitTime = Math.max(0, this.lastRefill + timeToNextToken - Date.now());
            await new Promise(resolve => setTimeout(resolve, waitTime));
            return this.consume();
        }

        refill() {
            const now = Date.now();
            const elapsed = (now - this.lastRefill) / 1000;
            if (elapsed > 0) {
                const newTokens = elapsed * this.rate;
                this.tokens = Math.min(this.capacity, this.tokens + newTokens);
                this.lastRefill = now;
            }
        }
    }

    const rateLimiter = new TokenBucket(BUCKET_CAPACITY, TOKENS_PER_SECOND);


    // ===========================================================================================
    // PARTE 2: MOTOR DE REQUISIÇÃO (COM LAZY HYBRID STRATEGY)
    // ===========================================================================================

    const filaDeProcessamento = {
        queue:[],
        active: 0,
        pauseUntil: 0,

        // AQUI ESTÁ A LÓGICA EM CAMADAS (RAM -> IDB -> REDE)
        add: function(url, celula, linha, numProcesso) {
            if (linha.getAttribute('data-nucleo-status')) return;

            // CAMADA 1: MEMÓRIA RAM (SÍNCRONA/INSTANTÂNEA)
            const cachedValue = CacheManager.getSync(numProcesso) || CacheManager.getSync(url);

            if (cachedValue) {
                this.renderizarDoCache(celula, linha, cachedValue);
                return;
            }

            // Mostra Spinner Imediatamente (feedback visual)
            DomBatcher.add(
                celula,
                `<div class="eproc-spinner"></div>`,
                linha,
                { 'data-nucleo-status': 'checking-storage' }
            );

            // CAMADA 2: INDEXEDDB (ASSÍNCRONA)
            // Lança a verificação no banco sem bloquear o loop principal
            const chaveBusca = numProcesso || url;
            CacheManager.getAsync(chaveBusca).then((dbValue) => {
                if (dbValue) {
                    // Achou no DB (e já atualizou a RAM internamente no getAsync)
                    this.renderizarDoCache(celula, linha, dbValue);
                } else {
                    // CAMADA 3: REDE (FALLBACK)
                    // Só enfileira se não achou em lugar nenhum
                    this.queue.push({ url, celula, linha, numProcesso, retries: 0 });
                    linha.setAttribute('data-nucleo-status', 'queued'); // Atualiza status
                    this.process();
                }
            });
        },

        renderizarDoCache: function(celula, linha, value) {
            const parts = value.split('###');
            const dataStr = parts[0];
            const origemStr = parts[1] || "-";
            const regexData = /^\d{2}\/\d{2}\/\d{4}$/;

            if (regexData.test(dataStr)) {
                DomBatcher.add(celula, `<span style="color:#000;">${dataStr}</span>`, linha, { 'data-nucleo-carregado': 'true', 'data-nucleo-status': null });
                const celulaOrigem = celula.nextElementSibling;
                if(celulaOrigem && celulaOrigem.classList.contains('eproc-col-origem-nucleo')) {
                    DomBatcher.add(celulaOrigem, `<span title="${origemStr}">${origemStr}</span>`, null, null);

                    // AJUSTE SOLICITADO: Atualizar índice de busca com a origem
                    const idxAtual = linha.getAttribute('data-idx-text') || "";
                    linha.setAttribute('data-idx-text', idxAtual + " " + origemStr.toUpperCase());
                }
            }
        },

        process: async function() {
            if (this.active >= MAX_CONCURRENCY || this.queue.length === 0) return;

            if (Date.now() < this.pauseUntil) {
                setTimeout(() => this.process(), 1000);
                return;
            }

            await rateLimiter.consume();

            if (this.queue.length === 0) return;

            const jitter = Math.floor(Math.random() * 150);
            await new Promise(r => setTimeout(r, jitter));

            const task = this.queue.shift();
            this.active++;
            task.linha.setAttribute('data-nucleo-status', 'processing');

            this.executeTask(task);
            this.process();
        },

        executeTask: async function(task) {
            try {
                let urlToFetch = task.url;
                let fetchOptions = {
                    method: 'GET',
                    headers: {
                        'X-Requested-With': 'XMLHttpRequest',
                        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8'
                    },
                    credentials: 'include',
                    cache: 'no-store'
                };

                if (task.retries > 3) {
                    const separator = urlToFetch.includes('?') ? '&' : '?';
                    urlToFetch += `${separator}_force_refresh=${Date.now()}`;
                }

                if (task.retries > 6) {
                    const randomDelay = Math.floor(Math.random() * 3000) + 1500;
                    await new Promise(r => setTimeout(r, randomDelay));
                }

                const controller = new AbortController();
                // OTIMIZAÇÃO: Timeout Agressivo (Fail-Fast)
                const timeoutDuration = 15000; // 15 segundos
                const timeoutId = setTimeout(() => controller.abort(), timeoutDuration);
                fetchOptions.signal = controller.signal;

                const res = await fetch(urlToFetch, fetchOptions);
                clearTimeout(timeoutId);

                if (res.url.includes("login") || res.url.includes("acao=sair") || res.url.includes("msg=Sua")) {
                    throw new Error("SESSAO_ENCERRADA");
                }

                if (!res.ok) throw new Error(`HTTP ${res.status}`);

                const buffer = await res.arrayBuffer();
                const decoder = new TextDecoder('iso-8859-1');
                const text = decoder.decode(buffer);

                if (text.length < 500 || text.includes("Sua sessão foi encerrada")) {
                     throw new Error("SESSAO_ENCERRADA");
                }

                this.parseAndFinish(text, task);

            } catch (error) {
                this.active--;
                task.retries++;

                if (error.message === "SESSAO_ENCERRADA" || error.message.includes("Sessão")) {
                    console.warn("Eproc: Instabilidade de sessão detectada. Pausando workers.");
                    this.pauseUntil = Date.now() + 15000;

                    task.linha.setAttribute('data-nucleo-status', 'queued');
                    this.queue.push(task);
                    setTimeout(() => this.process(), 15000);
                    return;
                }

                if (!document.body.contains(task.linha)) {
                this.active--;
                this.process();
                return;
            }

                let waitTime = Math.min((task.retries * 3000) + 2000, 45000);

                let spinnerColor = "orange";
                if (task.retries > 5) spinnerColor = "red";
                if (task.retries > 10) spinnerColor = "purple";

                DomBatcher.add(
                    task.celula,
                    `<div class="eproc-spinner" style="border-top-color: ${spinnerColor};"></div>`,
                    task.linha,
                    { 'data-nucleo-status': 'waiting-retry' }
                );

                setTimeout(() => {
                    task.linha.setAttribute('data-nucleo-status', 'queued');
                    this.queue.push(task);
                    this.process();
                }, waitTime);
            }
        },

        parseAndFinish: function(text, task) {
            try {
                let dataAchada = null;
                let origemAchada = "-";
                const regexData = /(\d{2}\/\d{2}\/\d{4})/;
                const regexOrigem = /\(([^()]+?)\s+para\s+.*?(?:4\.0)/i;

                const indiceAlvo = text.indexOf(TEXTO_ALVO_1);

                if (indiceAlvo !== -1) {
                    const textoAnterior = text.substring(Math.max(0, indiceAlvo - 1000), indiceAlvo);
                    const textoPosterior = text.substring(indiceAlvo, Math.min(text.length, indiceAlvo + 500));

                    const matches = textoAnterior.match(/(\d{2}\/\d{2}\/\d{4})/g);
                    if (matches && matches.length > 0) {
                        dataAchada = matches[matches.length - 1];
                    }

                    const matchOrigem = textoPosterior.match(regexOrigem);
                    if (matchOrigem && matchOrigem[1]) {
                        origemAchada = matchOrigem[1].trim();
                    }
                }

                if (!dataAchada) {
                    const parser = new DOMParser();
                    const doc = parser.parseFromString(text, "text/html");
                    const linhasTabela = doc.querySelectorAll('#tblEventos tr');

                    for (let tr of linhasTabela) {
                        const txtLinha = tr.textContent;
                        if (txtLinha.includes(TEXTO_ALVO_1) || (txtLinha.includes("Remetidos os Autos") && txtLinha.includes(TEXTO_ALVO_2))) {
                            const celulaData = tr.cells[2];
                            if (celulaData) {
                                const textoData = celulaData.innerText.trim();
                                const match = textoData.match(regexData);
                                if (match) {
                                    dataAchada = match[1];
                                    const matchOrigem = txtLinha.match(regexOrigem);
                                    if (matchOrigem && matchOrigem[1]) {
                                        origemAchada = matchOrigem[1].trim();
                                    }
                                    break;
                                }
                            }
                        }
                    }
                }

                if (dataAchada) {
                    CacheManager.set(task.numProcesso || task.url, `${dataAchada}###${origemAchada}`);
                    this.renderizarDoCache(task.celula, task.linha, `${dataAchada}###${origemAchada}`);
                    this.active--;
                    this.process();
                } else {
                    throw new Error("Data pattern not found - forcing retry");
                }
            } catch (e) {
                this.active--;
                task.retries++;
                task.linha.setAttribute('data-nucleo-status', 'queued');
                this.queue.push(task);
                setTimeout(() => this.process(), 1000);
            }
        }
    };

    // ===========================================================================================
    // KEEP ALIVE INTELIGENTE
    // ===========================================================================================
    function scheduleKeepAlive() {
        const delay = 180000 + Math.random() * 90000;
        setTimeout(() => {
            fetch(location.href, {
                method: 'HEAD',
                headers: { 'X-Requested-With': 'XMLHttpRequest' },
                credentials: 'include'
            }).catch(() => {});
            scheduleKeepAlive();
        }, delay);
    }
    scheduleKeepAlive();


    // ===========================================================================================
    // PARTE 3: GESTÃO DA COLUNA, ORDENAÇÃO E ANALYTICS
    // ===========================================================================================

    let ordemData = 'desc';
    let ordemOrigem = 'asc';

    function obterDataSegura(str) {
        if (!str) return null;
        const match = str.match(/(\d{2})\/(\d{2})\/(\d{4})/);
        if (match) {
            return new Date(parseInt(match[3]), parseInt(match[2]) - 1, parseInt(match[1]));
        }
        return null;
    }

    function ordenarPorData() {
        const tabela = document.querySelector('#tabelaLocalizadores') || document.querySelector('.infraTable');
        if (!tabela) return;
        const th = tabela.querySelector('.th-nucleo-40');
        if (!th) return;
        const parent = th.closest('tbody') || tabela;
        ordemData = (ordemData === 'asc') ? 'desc' : 'asc';
        th.querySelector('.sort-icon').textContent = ordemData === 'asc' ? '▲' : '▼';
        const idx = th.cellIndex;
        const rows = Array.from(parent.children).filter(tr => {
            return tr.tagName === 'TR' && tr.querySelectorAll('td').length > 0 && tr.querySelectorAll('th').length === 0 && tr.querySelector('.eproc-col-data-nucleo');
        });
        if (rows.length === 0) return;
        rows.sort((a, b) => {
            const vA = a.cells[idx]?.innerText.trim() || "";
            const vB = b.cells[idx]?.innerText.trim() || "";
            const badA = vA.includes("...") || vA.includes("spinner") || vA === "-" || vA.includes("Falha");
            const badB = vB.includes("...") || vB.includes("spinner") || vB === "-" || vB.includes("Falha");
            if (badA && !badB) return 1; if (!badA && badB) return -1; if (badA && badB) return 0;
            const dA = obterDataSegura(vA); const dB = obterDataSegura(vB);
            if (!dA) return 1; if (!dB) return -1;
            return ordemData === 'asc' ? dA - dB : dB - dA;
        });
        rows.forEach(r => parent.appendChild(r));
    }

    function ordenarPorOrigem() {
        const tabela = document.querySelector('#tabelaLocalizadores') || document.querySelector('.infraTable');
        if (!tabela) return;
        const th = tabela.querySelector('.th-nucleo-origem');
        if (!th) return;
        const parent = th.closest('tbody') || tabela;
        ordemOrigem = (ordemOrigem === 'asc') ? 'desc' : 'asc';
        th.querySelector('.sort-icon').textContent = ordemOrigem === 'asc' ? '▲' : '▼';
        const idx = th.cellIndex;
        const rows = Array.from(parent.children).filter(tr => {
            return tr.tagName === 'TR' && tr.querySelectorAll('td').length > 0 && tr.querySelectorAll('th').length === 0 && tr.querySelector('.eproc-col-origem-nucleo');
        });
        if (rows.length === 0) return;
        rows.sort((a, b) => {
            const vA = a.cells[idx]?.innerText.trim() || "";
            const vB = b.cells[idx]?.innerText.trim() || "";
            if (vA === vB) return 0;
            if (ordemOrigem === 'asc') return vA.localeCompare(vB);
            return vB.localeCompare(vA);
        });
        rows.forEach(r => parent.appendChild(r));
    }

    function verificarParalisacao(linha, idxEvento) {
        if (!linha || idxEvento === -1) return;
        const celulaEvento = linha.cells[idxEvento];
        if (!celulaEvento) return;
        const texto = celulaEvento.innerText.trim();
        const dataEvento = obterDataSegura(texto);
        if (dataEvento) {
            const hoje = new Date();
            hoje.setHours(0,0,0,0);
            dataEvento.setHours(0,0,0,0);
            const diffTime = Math.abs(hoje - dataEvento);
            const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
            if (diffDays >= 30) {
                // Preservação infalível da classe contra escritas do DOM (Eproc Nativo)
                linha.classList.add('tr-paralisado');
                
                const link = linha.querySelector('a[href*="acao=processo_selecionar"]');
                if (link) {
                    const num = link.innerText.trim().replace(/\D/g, '');
                    // Se foi detectado novo nesta mesma aba/sessão, restaura a classe na linha!
                    if (paralisadosNovosSessao.has(num)) {
                        linha.classList.add('tr-novo-paralisado');
                    }
                }
                return true;
            } else {
                linha.classList.remove('tr-paralisado');
                linha.classList.remove('tr-novo-paralisado');
            }
        }
        return false;
    }

    // --- CORREÇÃO ANTI-CONGELAMENTO: CHUNK PROCESSING ---
    let isScanning = false;

    function gerenciarColunasEProcessos() {
        if (isScanning) return;

        // OTIMIZAÇÃO LAZY: Só inicia se o DB estiver "pronto" (agora instantâneo)
        if (!CacheManager.ready) return;

        if (!location.href.includes('acao=localizador_processos_lista')) return;
        const tabela = document.getElementById('tabelaLocalizadores') || document.querySelector('.infraTable');
        if (!tabela) return;

        // CRIAÇÃO DO CABEÇALHO (RÁPIDO)
        const header = tabela.querySelector('tr.infraTr') || tabela.querySelector('tr');
        let idxEvento = -1;
        Array.from(header.cells).forEach((c, i) => { if (c.textContent.includes("Último Evento")) idxEvento = i; });
        if (idxEvento === -1) return;

        // Insere Coluna Recebido
        if (!header.querySelector('.th-nucleo-40')) {
            const th = document.createElement('th');
            th.className = 'infraTh th-nucleo-40';
            th.innerHTML = `Recebido em <span class="sort-icon">⇅</span>`;
            header.insertBefore(th, header.cells[idxEvento]);
            th.onclick = ordenarPorData;
        }


        // Insere Coluna Origem
        if (!header.querySelector('.th-nucleo-origem')) {
            const th = document.createElement('th');
            th.className = 'infraTh th-nucleo-origem';
            th.innerHTML = `Origem <span class="sort-icon">⇅</span>`;
            const thRecebido = header.querySelector('.th-nucleo-40');
            if(thRecebido && thRecebido.nextSibling) {
                header.insertBefore(th, thRecebido.nextSibling);
            } else {
                header.appendChild(th);
            }
            th.onclick = ordenarPorOrigem;
        }

        const colIdxDate = header.querySelector('.th-nucleo-40').cellIndex;

        // PROCESSAMENTO DE LINHAS EM LOTES (CHUNKS)
        isScanning = true;
        const linhas = Array.from(tabela.querySelectorAll('tr[class^="infraTr"]'));

        let temParalisado = false;
        let index = 0;
        const chunkSize = 20;

        function processarChunk() {
            const fim = Math.min(index + chunkSize, linhas.length);
            const keysToWarm =[];

            // PRÉ-SCAN: Identifica IDs necessários para este lote e adiciona indexação de texto
            for (let i = index; i < fim; i++) {
                const tr = linhas[i];
                if (tr.querySelector('th')) continue;

                // Indexação Prévia (Cache DOM - Texto)
                if (!tr.hasAttribute('data-idx-text')) {
                    tr.setAttribute('data-idx-text', tr.textContent.toUpperCase());
                }

                // Coleta IDs para Warmup do Cache (Bulk Get)
                const link = tr.querySelector('a[href*="acao=processo_selecionar"]');
                if (link) {
                    const numProc = link.innerText.trim().replace(/\D/g, '');
                    if (!CacheManager.getSync(numProc)) {
                         keysToWarm.push(numProc);
                    }
                }
            }

            // OTIMIZAÇÃO: Bulk Get (Leitura em Lote do IDB) antes de processar visualmente
            CacheManager.warmupChunk(keysToWarm).then(() => {
                for (let i = index; i < fim; i++) {
                    const tr = linhas[i];
                    if (tr.querySelector('th')) continue;

                    if (verificarParalisacao(tr, idxEvento)) temParalisado = true;

                    // Cria Célula Data
                    let tdDate = tr.querySelector('.eproc-col-data-nucleo');
                    if (!tdDate) {
                        tdDate = document.createElement('td');
                        tdDate.className = 'infraTd eproc-col-data-nucleo';
                        tdDate.textContent = "...";
                        tr.insertBefore(tdDate, tr.cells[colIdxDate]);
                    }

                    // Cria Célula Origem
                    let tdOrigem = tr.querySelector('.eproc-col-origem-nucleo');
                    if (!tdOrigem) {
                        tdOrigem = document.createElement('td');
                        tdOrigem.className = 'infraTd eproc-col-origem-nucleo';
                        tdOrigem.textContent = "...";
                        if (tdDate.nextSibling) {
                            tr.insertBefore(tdOrigem, tdDate.nextSibling);
                        } else {
                            tr.appendChild(tdOrigem);
                        }
                    }

                    const status = tr.getAttribute('data-nucleo-status');
                    const carregado = tr.getAttribute('data-nucleo-carregado');

                    if (!carregado && !status) {
                        const link = tr.querySelector('a[href*="acao=processo_selecionar"]');
                        if (link) {
                            const numProc = link.innerText.trim().replace(/\D/g, '');
                            // Como fizemos o warmupChunk, o "add" vai achar no Cache Sync (RAM) se existir no IDB
                            filaDeProcessamento.add(link.href, tdDate, tr, numProc);
                        } else {
                            tdDate.textContent = "-";
                            tdOrigem.textContent = "-";
                            tr.setAttribute('data-nucleo-carregado', 'true');
                        }
                    }
                }

                index = fim;
                if (index < linhas.length) {
                    requestAnimationFrame(processarChunk);
                } else {
                    isScanning = false;
                    const alertaDiv = document.getElementById('eproc-alerta-paralisado');
                    if (alertaDiv) {
                        const trsParalisados = document.querySelectorAll('tr.tr-paralisado');
                        const qtdParalisados = trsParalisados.length;

                        if (qtdParalisados > 0) {
                            // Otimização: Revalida e reconstrói o alerta só se houve mudança na contagem na tela
                            const currentCountAttr = alertaDiv.getAttribute('data-qtd-paralisados');
                            if (currentCountAttr !== String(qtdParalisados)) {
                                alertaDiv.setAttribute('data-qtd-paralisados', String(qtdParalisados));

                                const idsParalisados =[];
                                const mapTrs = {};
                                trsParalisados.forEach(tr => {
                                    const link = tr.querySelector('a[href*="acao=processo_selecionar"]');
                                    if (link) {
                                        const num = link.innerText.trim().replace(/\D/g, '');
                                        if(num) {
                                            idsParalisados.push(num);
                                            mapTrs[num] = tr;
                                        }
                                    }
                                });

                                // Validação pelo Banco (Descobrindo "Novos Paralisados")
                                CacheManager.checkNovosParalisados(idsParalisados).then(novosIds => {
                                    // Com a resiliência via set 'paralisadosNovosSessao', novosIds tem sempre
                                    // a lista precisa de tudo que foi detectado de novo para ESTA aba em específico.
                                    const contagemNovosNaTela = novosIds.length;

                                    novosIds.forEach(id => {
                                        if (mapTrs[id] && !mapTrs[id].classList.contains('tr-novo-paralisado')) {
                                            mapTrs[id].classList.add('tr-novo-paralisado');
                                        }
                                    });

                                    alertaDiv.style.display = 'flex';
                                    alertaDiv.innerHTML = ''; // Limpa botões/textos anteriores para remontar

                                    const textoSpan = document.createElement('span');
                                    textoSpan.textContent = `⚠️ HÁ ${qtdParalisados} PROCESSOS PARALISADOS HÁ MAIS DE 30 DIAS! `;
                                    alertaDiv.appendChild(textoSpan);

                                    if (contagemNovosNaTela > 0) {
                                        const badge = document.createElement('span');
                                        badge.className = 'eproc-badge-novo';
                                        badge.textContent = `Há ${contagemNovosNaTela} novos paralisados`;
                                        alertaDiv.appendChild(badge);
                                    }

                                    criarBotoesAlerta(alertaDiv, idxEvento, qtdParalisados, contagemNovosNaTela);
                                });
                            }
                        } else {
                            alertaDiv.style.display = 'none';
                            alertaDiv.removeAttribute('data-qtd-paralisados');
                        }
                    }
                    if (filaDeProcessamento.queue.length > 0 && filaDeProcessamento.active < MAX_CONCURRENCY) {
                        filaDeProcessamento.process();
                    }
                }
            });
        }

        processarChunk();
    }

    function criarBotoesAlerta(alertaDiv, idxEvento, totalParalisados, totalNovos) {
        const temNovos = totalNovos > 0;

        const btnRel = document.createElement('button');
        btnRel.id = 'eproc-relatorio-btn';
        btnRel.textContent = "Gerar Relatório";
        btnRel.type = "button";
        alertaDiv.appendChild(btnRel);

        btnRel.onclick = (e) => {
            e.preventDefault(); e.stopPropagation();

            const overlay = document.createElement('div');
            overlay.className = 'eproc-modal-overlay';

            // HTML extra caso haja novos processos, para o usuário escolher a abrangência
            const seletorAbrangencia = temNovos ? `
                <div style="margin-bottom:15px; text-align:left; background:#f9f9f9; padding:10px; border-radius:4px; border:1px solid #eee;">
                    <label style="display:block; font-size:12px; font-weight:bold; margin-bottom:8px; color:#555;">Abrangência do Relatório:</label>
                    <label class="eproc-radio-label" style="margin-bottom:5px; display:flex; align-items:center; gap:5px; cursor:pointer;">
                        <input type="radio" name="eproc-rel-scope" value="todos" checked> Todos os Paralisados (${totalParalisados})
                    </label>
                    <label class="eproc-radio-label" style="display:flex; align-items:center; gap:5px; cursor:pointer;">
                        <input type="radio" name="eproc-rel-scope" value="novos"> Apenas Novos Paralisados (${totalNovos})
                    </label>
                </div>
            ` : '';

            overlay.innerHTML = `
                <div class="eproc-modal-content" style="width: 340px; text-align:center;">
                    <div class="eproc-modal-title">Relatório de Paralisados</div>
                    <p style="margin-bottom:15px; color:#555; font-size:13px;">Selecione o formato desejado:</p>
                    ${seletorAbrangencia}
                    <button id="btn-rel-geral" class="eproc-btn" style="width:100%; margin-bottom:10px; font-weight:bold;">Relatório Geral</button>
                    <button id="btn-rel-digito" class="eproc-btn eproc-btn-secondary" style="width:100%; margin-bottom:15px; font-weight:bold;">Relatório Por Dígito</button>
                    <button id="btn-rel-cancel" class="eproc-btn eproc-btn-danger" style="width:100%;">Cancelar</button>
                </div>
            `;
            document.body.appendChild(overlay);

            const removeOverlay = () => { if(document.body.contains(overlay)) document.body.removeChild(overlay); };

            // Helper function para pegar apenas o NodeList que o usuário solicitou
            const getFiltrados = () => {
                let paralisados = Array.from(document.querySelectorAll('tr.tr-paralisado'));
                if (temNovos) {
                    const scopeElem = document.querySelector('input[name="eproc-rel-scope"]:checked');
                    if (scopeElem && scopeElem.value === 'novos') {
                        paralisados = paralisados.filter(tr => tr.classList.contains('tr-novo-paralisado'));
                    }
                }
                return paralisados;
            };

            document.getElementById('btn-rel-cancel').onclick = removeOverlay;

            document.getElementById('btn-rel-geral').onclick = () => {
                removeOverlay();
                const paralisados = getFiltrados();
                if (paralisados.length === 0) return;
                let html = '<table border="1"><thead><tr><th>Processo</th><th>Último Evento</th></tr></thead><tbody>';
                let texto = 'Processo\tÚltimo Evento\n';
                paralisados.forEach(tr => {
                    const linkProc = tr.querySelector('a[href*="acao=processo_selecionar"]');
                    const celulaEvento = tr.cells[idxEvento];
                    const numProc = linkProc ? linkProc.innerText.trim() : "N/A";
                    const hrefProc = linkProc ? linkProc.href : "";
                    const txtEvento = celulaEvento ? celulaEvento.innerText.replace(/\s+/g, ' ').trim() : "";
                    html += `<tr><td><a href="${hrefProc}">${numProc}</a></td><td>${txtEvento}</td></tr>`;
                    texto += `${numProc}\t${txtEvento}\n`;
                });
                html += '</tbody></table>';
                copiarParaClipboard(html, texto);
            };

            document.getElementById('btn-rel-digito').onclick = () => {
                removeOverlay();
                const paralisados = getFiltrados();
                if (paralisados.length === 0) return;

                const buckets = Array.from({length: 10}, () =>[]);

                paralisados.forEach(tr => {
                    const linkProc = tr.querySelector('a[href*="acao=processo_selecionar"]');
                    if(linkProc) {
                        const numProc = linkProc.innerText.trim();
                        const hrefProc = linkProc.href;
                        const match = numProc.match(/(\d)-/);
                        if(match) {
                            const digit = parseInt(match[1]);
                            if (!isNaN(digit) && digit >= 0 && digit <= 9) {
                                buckets[digit].push({ num: numProc, href: hrefProc });
                            }
                        }
                    }
                });

                const maxRows = Math.max(...buckets.map(b => b.length));

                let html = '<table border="1" style="border-collapse: collapse; text-align: center;"><thead><tr>';
                for(let i=0; i<=9; i++) html += `<th style="background:#f0f0f2; padding:5px;">Dígito ${i}</th>`;
                html += '</tr></thead><tbody>';

                for(let r=0; r<maxRows; r++) {
                    html += '<tr>';
                    for(let d=0; d<=9; d++) {
                        const item = buckets[d][r];
                        if(item) {
                            html += `<td style="padding:4px;"><a href="${item.href}">${item.num}</a></td>`;
                        } else {
                            html += '<td></td>';
                        }
                    }
                    html += '</tr>';
                }
                html += '</tbody></table>';

                let texto = '';
                for(let d=0; d<=9; d++) {
                    if(buckets[d].length > 0) {
                        texto += `--- DÍGITO ${d} ---\n`;
                        buckets[d].forEach(item => texto += `${item.num}\n`);
                        texto += `\n`;
                    }
                }

                copiarParaClipboard(html, texto);
            };
        };

        const btnSel = document.createElement('button');
        btnSel.id = 'eproc-selecionar-paralisados-btn';
        btnSel.textContent = "Selecionar Paralisados";
        btnSel.type = "button";
        alertaDiv.appendChild(btnSel);

        // --- LÓGICA DE SELEÇÃO AJUSTADA COM MODAL (SE HOUVER NOVOS) ---
        btnSel.onclick = (e) => {
            e.preventDefault(); e.stopPropagation();

            if (!temNovos) {
                // Comportamento original imediato caso não haja novidades
                executarSelecao(Array.from(document.querySelectorAll('tr.tr-paralisado')));
                return;
            }

            // Exibe modal indagando abrangência
            const overlay = document.createElement('div');
            overlay.className = 'eproc-modal-overlay';
            overlay.innerHTML = `
                <div class="eproc-modal-content" style="width: 320px; text-align:center;">
                    <div class="eproc-modal-title">Selecionar Paralisados</div>
                    <p style="margin-bottom:15px; color:#555; font-size:13px;">Quais processos deseja selecionar?</p>
                    <button id="btn-sel-todos" class="eproc-btn" style="width:100%; margin-bottom:10px; font-weight:bold;">Todos os Paralisados (${totalParalisados})</button>
                    <button id="btn-sel-novos" class="eproc-btn eproc-btn-secondary" style="width:100%; margin-bottom:15px; font-weight:bold;">Apenas os Novos (${totalNovos})</button>
                    <button id="btn-sel-cancel" class="eproc-btn eproc-btn-danger" style="width:100%;">Cancelar</button>
                </div>
            `;
            document.body.appendChild(overlay);

            const fechar = () => { if(document.body.contains(overlay)) document.body.removeChild(overlay); };

            document.getElementById('btn-sel-cancel').onclick = fechar;
            
            document.getElementById('btn-sel-todos').onclick = () => {
                fechar();
                executarSelecao(Array.from(document.querySelectorAll('tr.tr-paralisado')));
            };
            
            document.getElementById('btn-sel-novos').onclick = () => {
                fechar();
                executarSelecao(Array.from(document.querySelectorAll('tr.tr-novo-paralisado')));
            };
        };

        // Função de execução do click nativa extraída para reutilização
        function executarSelecao(paralisados) {
            if (paralisados.length === 0) {
                alert('Nenhum processo correspondente identificado na tela ainda.');
                return;
            }

            requestAnimationFrame(() => {
                let count = 0;
                paralisados.forEach(tr => {
                    const chk = tr.querySelector('input[type="checkbox"]');
                    if (chk) {
                        if(!chk.checked) chk.click(); // Dispara evento do EPROC
                        tr.style.backgroundColor = '#eef8fa';
                        tr.style.borderLeft = '4px solid #0081c2';
                        count++;
                    }
                });

                const total = document.querySelectorAll('table tr input[type="checkbox"]:checked').length;
                document.getElementById('eproc-contador').textContent = `Itens selecionados: ${total}`;
            });
        }
    }


    // ===========================================================================================
    // PARTE 4: INTERFACE E LÓGICA DE FILTRO E MELHORIAS NATIVAS
    // ===========================================================================================

    // --- MELHORIA: GERENCIAR LOCALIZADORES (PERMITIR APENAS EXCLUSÃO) ---
    function melhorarGerenciarLocalizadores() {
        if (typeof window.alterarLocalizador === 'function') {
            const originalAlterarLocalizador = window.alterarLocalizador;
            window.alterarLocalizador = function() {
                const novoLoc = document.getElementById('selNovoLocalizador');
                const desativarLoc = document.getElementById('selLocalizadorDesativar');

                const isNovoVazio = !novoLoc || novoLoc.value === 'null' || novoLoc.value === '';
                let hasDesativar = false;

                if (desativarLoc && desativarLoc.options) {
                    for (let i = 0; i < desativarLoc.options.length; i++) {
                        if (desativarLoc.options[i].selected) {
                            hasDesativar = true;
                            break;
                        }
                    }
                }

                // Se não escolheu novo localizador
                if (isNovoVazio) {
                    // Mas escolheu algum localizador atual para excluir
                    if (hasDesativar) {
                        // Redireciona a ação do usuário para a função nativa de EXCLUSÃO do EPROC
                        if (typeof window.validarSelecao === 'function') {
                            window.validarSelecao();
                        } else {
                            alert('Erro: Função nativa de exclusão do EPROC não foi encontrada.');
                        }
                    } else {
                        // Nenhuma opção foi escolhida nem pra novo nem pra excluir
                        alert('Informe o novo localizador ou selecione localizadores atuais para excluir.');
                        if (novoLoc) novoLoc.focus();
                    }
                } else {
                    // Fluxo nativo inalterado caso haja um novo localizador
                    originalAlterarLocalizador();
                }
            };
        }
    }

    if (location.href.includes('acao=localizador_processos_lista')) {
        const BOTAOES_PADRAO =[
            { label: 'PAP', valor: 'PRODUÇÃO ANTECIPADA DA PROVA', padrao: true },
            { label: 'Procedimento Comum', valor: 'PROCEDIMENTO COMUM CÍVEL', padrao: true },
            { label: 'BAAF', valor: 'BUSCA E APREENSÃO EM ALIENAÇÃO FIDUCIÁRIA', padrao: true }
        ];

        let botoesPersonalizados =[];
        let ordemBotoes =[];
        let estadoFiltros =[];
        let modoReordenacao = false;

        // FUNÇÕES SÍNCRONAS DE PREFERÊNCIAS (VIA LOCALSTORAGE)
        function salvarBotoesPersonalizados() {
            localStorage.setItem(LS_KEY_BOTOES, JSON.stringify(botoesPersonalizados));
            atualizarOrdemBotoes();
        }

        function atualizarOrdemBotoes() {
            const todosAtuais =[...BOTAOES_PADRAO, ...botoesPersonalizados];
            ordemBotoes = ordemBotoes.filter(bOrd => todosAtuais.some(bAtu => bAtu.label === bOrd.label && bAtu.valor === bOrd.valor));
            todosAtuais.forEach(bAtu => { if (!ordemBotoes.some(bOrd => bOrd.label === bAtu.label && bOrd.valor === bAtu.valor)) ordemBotoes.push(bAtu); });
            localStorage.setItem(LS_KEY_ORDEM, JSON.stringify(ordemBotoes));
        }

        function adicionarBotaoPersonalizado(label, valor) {
            if (!label.trim() || !valor.trim()) return false;
            if (botoesPersonalizados.some(b => b.label === label.trim() || b.valor === valor.trim())) return false;
            botoesPersonalizados.push({ label: label.trim(), valor: valor.trim(), padrao: false });
            atualizarOrdemBotoes();
            salvarBotoesPersonalizados();
            return true;
        }

        function removerBotaoPersonalizado(idx) {
            botoesPersonalizados.splice(idx, 1);
            salvarBotoesPersonalizados();
        }

        function getTodosBotoes() {
            atualizarOrdemBotoes();
            return ordemBotoes;
        }

        function salvarOrdemArrastada(novaOrdem) {
            ordemBotoes = novaOrdem;
            localStorage.setItem(LS_KEY_ORDEM, JSON.stringify(ordemBotoes));
        }

        function aplicarHackPaginacao() {
            const div = document.getElementById('divPaginacao');
            if (!div || document.getElementById('optPaginacao1000')) return;
            const d = document.createElement('div');
            // ADICIONADA QUEBRA DE LINHA <br> ENTRE OS DOIS INPUTS PARA GARANTIR QUE 1000 FIQUE ABAIXO DE 500
            d.innerHTML = `<input type="radio" name="paginacao" id="optPaginacao500" value="500" class="infraRadio mr-2"><label for="optPaginacao500" class="infraRadio mr-2">500 processos por página</label><br>
                           <input type="radio" name="paginacao" id="optPaginacao1000" value="1000" class="infraRadio mr-2"><label for="optPaginacao1000" class="infraRadio mr-2">1000 processos por página</label>`;
            div.appendChild(d);

            const prefPag = localStorage.getItem(LS_KEY_PAGINACAO);
            if (prefPag === '1000') document.getElementById('optPaginacao1000').checked = true;
            if (prefPag === '500') document.getElementById('optPaginacao500').checked = true;

            document.querySelectorAll('input[name="paginacao"]').forEach(r => r.addEventListener('change', e => {
             localStorage.setItem(LS_KEY_PAGINACAO, e.target.value);
             // Salva o cookie IMEDIATAMENTE ao clicar, garantindo que o servidor receba a instrução correta
             document.cookie = `paginacao=${e.target.value};path=/;max-age=3600`;
        }));
        }

        function validarIntervaloData(linha, dtInicio, dtFim) {
            // Otimização: Recebe as datas já parseadas do lado de fora, não busca DOM aqui
            if (!dtInicio && !dtFim) return true;

            const modoRecebimento = document.getElementById('eproc-radio-recebimento').checked;
            const modoAutuacao = document.getElementById('eproc-radio-autuacao').checked;
            let dataLinha = null;

            if (modoRecebimento) {
                const td = linha.querySelector('.eproc-col-data-nucleo');
                if (td) dataLinha = obterDataSegura(td.innerText.trim());
            } else if (modoAutuacao) {
                const tabela = linha.closest('table');
                if (tabela) {
                    const headers = Array.from(tabela.querySelectorAll('th'));
                    const idxAut = headers.findIndex(th => th.textContent.toUpperCase().includes("AUTUAÇÃO"));

                    if (idxAut > -1 && linha.cells[idxAut]) {
                        dataLinha = obterDataSegura(linha.cells[idxAut].innerText.trim());
                    }
                }
            } else {
                const tds = linha.querySelectorAll('td');
                if (tds.length) {
                    const txt = tds[tds.length - 1].textContent;
                    dataLinha = obterDataSegura(txt);
                }
            }

            if (!dataLinha) return false;
            dataLinha.setHours(0,0,0,0);

            if (dtInicio && dataLinha < dtInicio) return false;
            if (dtFim && dataLinha > dtFim) return false;
            return true;
        }

        // CÃO DE GUARDA
        function verificarPendenciasReais() {
            let pendentes = 0;
            const linhas = document.querySelectorAll('tr[class^="infraTr"]');

            linhas.forEach(tr => {
                if (tr.querySelector('th')) return;

                const temCheckbox = tr.querySelector('input[type="checkbox"]');
                const temLink = tr.querySelector('a[href*="acao=processo_selecionar"]');
                if (!temCheckbox && !temLink) return;

                const td = tr.querySelector('.eproc-col-data-nucleo');
                if (!td) { pendentes++; return; }
                const texto = td.innerText.trim();
                const temSpinner = td.querySelector('.eproc-spinner');
                const statusAtivo = tr.getAttribute('data-nucleo-status');

                // Se tiver spinner, texto vazio ou status 'queued', está pendente.
                // NOTE: 'checking-cache' não deve ocorrer mais com o Memory Mirroring, pois é instantâneo.
                if (temSpinner || texto === '...' || texto === '' || statusAtivo === 'queued' || statusAtivo === 'processing') {
                    pendentes++;
                }
            });
            return pendentes;
        }

        function caoDeGuardaEAplicar(callbackAcao) {
            const fb = document.getElementById('eproc-feedback');
            if (!document.getElementById('eproc-radio-recebimento').checked) {
                fb.style.display = 'none';
                callbackAcao();
                return;
            }
            function cicloMonitoramento() {
                const pendentes = verificarPendenciasReais();
                if (pendentes > 0) {
                    fb.style.display = 'block';
                    fb.style.backgroundColor = '#fff3cd';
                    fb.style.color = '#856404';
                    fb.style.borderColor = '#ffeeba';
                    fb.innerHTML = `⚠️ Aguarde o rastreamento das datas de recebimento...<br>Processos restantes: <b>${pendentes}</b>`;
                    setTimeout(cicloMonitoramento, 1000);
                } else {
                    fb.style.display = 'none';
                    callbackAcao();
                }
            }
            cicloMonitoramento();
        }

        // --- LÓGICA DE FILTRO OTIMIZADA: SEM DOM THRASHING ---
        function aplicarFiltros() {
            const inicioVal = document.getElementById('eproc-data-inicio').value;
            const fimVal = document.getElementById('eproc-data-fim').value;
            const temFiltros = estadoFiltros.length > 0;
            const temData = inicioVal !== '' || fimVal !== '';

            // 0. Se não há nada para filtrar, limpa tudo rápido
            if (!temFiltros && !temData) {
                limparSelecao();
                return;
            }

            // 1. Prepara dados de entrada uma única vez
            const dtInicio = inicioVal ? new Date(inicioVal + 'T00:00:00') : null;
            const dtFim = fimVal ? new Date(fimVal + 'T00:00:00') : null;

            // Otimização: pré-compila filtros para maiúsculas
            const filtrosOtimizados = estadoFiltros.map(f => ({
                ...f,
                valorUpper: f.valor.toUpperCase()
            }));

            // 2. Fase de LEITURA (Read Phase)
            // Coleta todas as alterações necessárias sem tocar no DOM (exceto leitura)
            const updates =[];
            const linhas = document.querySelectorAll('tr[class^="infraTr"]');

            let count = 0;

            linhas.forEach(linha => {
                const chk = linha.querySelector('input[type="checkbox"]');
                if (!chk || chk.disabled) return; // Ignora cabeçalhos ou desabilitados

                // Validação de Data (passando as datas já processadas)
                if (!validarIntervaloData(linha, dtInicio, dtFim)) {
                    // Se falhar na data, deve ser desmarcado
                     updates.push({ tr: linha, chk: chk, select: false });
                     return;
                }

                // Validação de Filtros de Texto
                let passouTodosFiltros = true;
                if (temFiltros) {
                    // OTIMIZAÇÃO: LÊ DO ATRIBUTO INDEXADO (SEM RECALCULAR LAYOUT)
                    const linhaTexto = linha.getAttribute('data-idx-text') || "";

                    for (const filtro of filtrosOtimizados) {
                        if (filtro.tipo === 'status' && filtro.valor === '__PARALISADO__') {
                            if (!linha.classList.contains('tr-paralisado')) {
                                passouTodosFiltros = false;
                                break;
                            }
                        } else {
                            if (!linhaTexto.includes(filtro.valorUpper)) {
                                passouTodosFiltros = false;
                                break;
                            }
                        }
                    }
                }

                if (passouTodosFiltros) {
                    updates.push({ tr: linha, chk: chk, select: true });
                    count++;
                } else {
                    updates.push({ tr: linha, chk: chk, select: false });
                }
            });

            // 3. Fase de ESCRITA (Write Phase) - Batch via requestAnimationFrame
            // Isso evita o travamento do navegador, mas usa .click() para garantir funcionalidade
            requestAnimationFrame(() => {
                updates.forEach(up => {
                    if (up.select) {
                        // CORREÇÃO CRÍTICA: Use click() se não estiver marcado para disparar eventos do EPROC
                        if (!up.chk.checked) up.chk.click();

                        // Aplica estilos visuais diretamente
                        up.tr.style.backgroundColor = '#eef8fa';
                        up.tr.style.borderLeft = '4px solid #0081c2';
                    } else {
                        // CORREÇÃO CRÍTICA: Use click() se estiver marcado para disparar eventos do EPROC
                        if (up.chk.checked) up.chk.click();

                        // Remove estilos
                        up.tr.style.backgroundColor = '';
                        up.tr.style.borderLeft = '';
                    }
                });

                document.getElementById('eproc-contador').textContent = `Itens selecionados: ${count}`;
            });
        }

        function selecionar(termo) {
            // Função auxiliar de busca simples
            addFiltro('texto', termo, termo);
            aplicarFiltros();
        }

        function limparSelecao() {
            // 1. Limpeza Lógica (Sistema Eproc)
            // Tenta usar a função nativa do sistema (Instantâneo e correto)
            try {
                if (typeof infraSelecionarTodos === 'function') {
                    infraSelecionarTodos(false);
                } else {
                    // Fallback: Dispara o clique real para atualizar o estado do sistema se a função nativa falhar
                    const checkboxes = document.querySelectorAll('table tr input[type="checkbox"]:checked');
                    for (let i = 0; i < checkboxes.length; i++) {
                        checkboxes[i].click();
                    }
                }
            } catch (e) {
                // Em caso de erro, garante a limpeza via clique um a um
                const checkboxes = document.querySelectorAll('table tr input[type="checkbox"]:checked');
                for (let i = 0; i < checkboxes.length; i++) {
                    checkboxes[i].click();
                }
            }

            // 2. Limpeza Visual (Interface do Script)
            // Removemos o delay do requestAnimationFrame para parecer mais responsivo,
            // mas usamos um seletor específico para não varrer a tabela inteira se possível.
            requestAnimationFrame(() => {
                const linhas = document.querySelectorAll('tr[style*="background-color"]');
                for (let i = 0; i < linhas.length; i++) {
                    linhas[i].style.backgroundColor = '';
                    linhas[i].style.borderLeft = '';
                }
                document.getElementById('eproc-contador').textContent = "Itens selecionados: 0";
            });
        }

        function atualizarTags() {
            const div = document.getElementById('eproc-criterios-lista');
            div.innerHTML = '';
            if(!estadoFiltros.length) { div.innerHTML = '<span style="color:#999;font-style:italic;font-size:11px;">Nenhum filtro</span>'; return; }
            estadoFiltros.forEach(f => {
                const t = document.createElement('div'); t.className = 'eproc-tag';
                t.innerHTML = `${f.label} <span class="eproc-tag-close">×</span>`;
                t.querySelector('span').onclick = (e) => {
                    e.preventDefault(); e.stopPropagation();
                    if(f.tipo === 'data') { document.getElementById('eproc-data-inicio').value = ''; document.getElementById('eproc-data-fim').value = ''; }
                    estadoFiltros = estadoFiltros.filter(x => x.id !== f.id);
                    atualizarTags();
                    aplicarFiltros(); // Re-aplica filtros ao remover
                };
                div.appendChild(t);
            });
        }

        function addFiltro(tipo, valor, label) {
            if(!estadoFiltros.some(f => f.tipo === tipo && f.valor === valor)) {
                estadoFiltros.push({ id: Date.now(), tipo, valor, label });
                atualizarTags();
            }
        }

        function abrirModalAdicionarBotao() {
            const overlay = document.createElement('div');
            overlay.className = 'eproc-modal-overlay';
            overlay.innerHTML = `
                <div class="eproc-modal-content">
                    <div class="eproc-modal-title">Novo Botão Personalizado</div>
                    <div class="eproc-modal-field">
                        <label class="eproc-modal-label">Nome do Botão:</label>
                        <input type="text" id="eproc-modal-nome" class="eproc-modal-input" placeholder="Ex: Perícia">
                    </div>
                    <div class="eproc-modal-field">
                        <label class="eproc-modal-label">Termo de Busca:</label>
                        <input type="text" id="eproc-modal-valor" class="eproc-modal-input" placeholder="Ex: NOMEAÇÃO DE PERITO">
                    </div>
                    <div class="eproc-modal-actions">
                        <button type="button" id="eproc-modal-cancel" class="eproc-modal-btn eproc-modal-btn-cancel">Cancelar</button>
                        <button type="button" id="eproc-modal-save" class="eproc-modal-btn eproc-modal-btn-save">Salvar</button>
                    </div>
                </div>
            `;
            document.body.appendChild(overlay);
            document.getElementById('eproc-modal-nome').focus();
            const fechar = () => document.body.removeChild(overlay);
            document.getElementById('eproc-modal-cancel').onclick = fechar;
            document.getElementById('eproc-modal-save').onclick = () => {
                const nome = document.getElementById('eproc-modal-nome').value;
                const valor = document.getElementById('eproc-modal-valor').value;
                if (adicionarBotaoPersonalizado(nome, valor)) { renderizarBotoes(); fechar(); } else { alert("Preencha corretamente."); }
            };
            overlay.addEventListener('keydown', (e) => {
                if (e.key === 'Escape') fechar();
                if (e.key === 'Enter' && e.target.id === 'eproc-modal-valor') document.getElementById('eproc-modal-save').click();
            });
        }

        function criarInterface() {
            const form = document.getElementById('frmProcessoLista');
            if(!form || document.getElementById('eproc-seletor')) return;

            // Carrega preferências do LOCALSTORAGE (Agora é síncrono)
            try {
                botoesPersonalizados = JSON.parse(localStorage.getItem(LS_KEY_BOTOES)) ||[];
                ordemBotoes = JSON.parse(localStorage.getItem(LS_KEY_ORDEM)) ||[];
            } catch(e) {
                botoesPersonalizados =[];
                ordemBotoes =[];
            }

            const div = document.createElement('div');
            div.id = 'eproc-seletor';
            div.innerHTML = `
                <div class="eproc-legend">Seletor Inteligente</div>
                <div id="eproc-alerta-paralisado">⚠️ VERIFICANDO PROCESSOS PARALISADOS...</div>

                <!-- TOAST DE FEEDBACK -->
                <div id="eproc-toast">Processos copiados!</div>

                <div class="eproc-row" style="justify-content: space-between;">
                   <div style="display:flex; gap:10px; align-items:center;">
                        <span style="font-weight:bold;font-size:12px;">Fonte:</span>
                        <div class="eproc-radio-group">
                            <label class="eproc-radio-label"><input type="radio" name="eproc-tipo-data" id="eproc-radio-inclusao" value="inclusao" checked> Inclusão</label>
                            <label class="eproc-radio-label"><input type="radio" name="eproc-tipo-data" id="eproc-radio-autuacao" value="autuacao"> Autuação</label>
                            <label class="eproc-radio-label"><input type="radio" name="eproc-tipo-data" id="eproc-radio-recebimento" value="recebimento"> Recebimento</label>
                        </div>
                        <label style="font-size:12px;margin:0;">De: <input type="date" id="eproc-data-inicio" class="eproc-form-control" style="width:auto;"></label>
                        <label style="font-size:12px;margin:0;">Até: <input type="date" id="eproc-data-fim" class="eproc-form-control" style="width:auto;"></label>
                        <button id="eproc-aplicar-data" type="button" class="eproc-btn eproc-btn-secondary">Filtrar Data</button>
                    </div>
                    <button id="eproc-limpar" type="button" class="eproc-btn eproc-btn-danger">Limpar Tudo</button>
                </div>
                <div id="eproc-botoes-container" class="eproc-row" style="border-top: 1px solid #eee; padding-top: 10px;"></div>
                <div class="eproc-row" style="flex-wrap: nowrap;">
                    <input type="text" id="eproc-termo" class="eproc-form-control" placeholder="Pesquisar..." style="flex-grow:1;">
                    <!-- BOTÃO COPIAR COM ÍCONE NOVO -->
                    <button id="eproc-copy-btn" class="eproc-btn eproc-btn-secondary eproc-btn-icon" title="Copiar Selecionados">
                        <svg viewBox="0 0 24 24" width="16" height="16"><path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z"/></svg>
                    </button>
                    <!-- BOTÃO RELATÓRIO TRAMITAÇÃO (NOVO) -->
                    <button id="eproc-rel-tramitacao-btn" class="eproc-btn eproc-btn-secondary eproc-btn-icon" title="Relatório de Tramitação" style="margin-left:5px;">
                        <svg viewBox="0 0 24 24" width="16" height="16"><path d="M19 3h-4.18C14.4 1.84 13.3 1 12 1c-1.3 0-2.4.84-2.82 2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-7 0c.55 0 1 .45 1 1s-.45 1-1 1-1-.45-1-1 .45-1 1-1zm2 14H7v-2h7v2zm3-4H7v-2h10v2zm0-4H7V7h10v2z"/></svg>
                    </button>
                    <button id="eproc-buscar" type="button" class="eproc-btn eproc-btn-secondary" style="margin-left:5px;">Selecionar</button>
                </div>
                <div style="margin-top:5px;"><span style="font-size:11px;font-weight:bold;color:#555;">Filtros:</span> <div id="eproc-criterios-lista"></div></div>
                <div id="eproc-feedback"></div>
                <div id="eproc-contador">Itens selecionados: 0</div>
            `;

            const localDiv = document.getElementById('fldAcoes');
            if (localDiv) {
                // Insere logo abaixo da caixa de botões superior (Gerenciar Localizadores)
                form.insertBefore(div, localDiv.nextSibling);
            } else {
                // Fallback de segurança
                form.insertBefore(div, form.firstChild);
            }
            renderizarBotoes();
            aplicarHackPaginacao();

            // EVENT LISTENERS EXISTENTES...
            document.getElementById('eproc-termo').addEventListener('keypress', (e) => {
                if(e.key === 'Enter') { e.preventDefault(); const t = e.target.value; if(t) { addFiltro('texto', t, `"${t}"`); aplicarFiltros(); e.target.value=''; } }
            });
            document.getElementById('eproc-buscar').onclick = (e) => {
                e.preventDefault(); const t = document.getElementById('eproc-termo').value; if(t) { addFiltro('texto', t, `"${t}"`); aplicarFiltros(); document.getElementById('eproc-termo').value=''; }
            };
            document.getElementById('eproc-limpar').onclick = (e) => {
                e.preventDefault(); estadoFiltros =[]; document.getElementById('eproc-data-inicio').value = ''; document.getElementById('eproc-data-fim').value = '';
                atualizarTags();
                limparSelecao();
            };
            document.getElementById('eproc-aplicar-data').onclick = (e) => {
                e.preventDefault();
                caoDeGuardaEAplicar(() => {
                    const i = document.getElementById('eproc-data-inicio').value;
                    const f = document.getElementById('eproc-data-fim').value;
                    if(!i && !f) return;
                    estadoFiltros = estadoFiltros.filter(x => x.tipo !== 'data');
                    let tipoLabel = "Incluído";
                    if (document.getElementById('eproc-radio-recebimento').checked) tipoLabel = "Recebido";
                    if (document.getElementById('eproc-radio-autuacao').checked) tipoLabel = "Autuado";
                    const fmt = (dt) => dt.split('-').reverse().join('/');
                    let lbl = tipoLabel + ": ";
                    lbl += (i && f) ? `${fmt(i)} a ${fmt(f)}` : (i ? `Desde ${fmt(i)}` : `Até ${fmt(f)}`);
                    addFiltro('data', '', lbl);
                    aplicarFiltros();
                });
            };

            // NOVO EVENT LISTENER: COPIAR SELECIONADOS
            document.getElementById('eproc-copy-btn').onclick = (e) => {
                e.preventDefault();
                // SELEÇÃO CORRIGIDA: Apenas checkboxes dentro de linhas de dados (infraTr), excluindo o header
                const selecionados = document.querySelectorAll('tr[class^="infraTr"] input[type="checkbox"]:checked');

                if (selecionados.length === 0) return;

                let html = '<ul>';
                let texto = '';

                selecionados.forEach(chk => {
                    const tr = chk.closest('tr');
                    // Verifica novamente se não é cabeçalho (segurança extra)
                    if (tr.querySelector('th')) return;

                    const linkProc = tr.querySelector('a[href*="acao=processo_selecionar"]');
                    if (linkProc) {
                        const numProc = linkProc.innerText.trim();
                        const hrefProc = linkProc.href;
                        html += `<li><a href="${hrefProc}">${numProc}</a></li>`;
                        texto += `${numProc}\n`;
                    }
                });
                html += '</ul>';
                copiarParaClipboard(html, texto);
            };

            // NOVO EVENT LISTENER: RELATÓRIO DE TRAMITAÇÃO (ATUALIZADO)
            document.getElementById('eproc-rel-tramitacao-btn').onclick = (e) => {
                e.preventDefault();

                // Processa apenas o que já está na tela
                const linhas = document.querySelectorAll('tr[class^="infraTr"]');
                const dados =[];
                const hoje = new Date();
                hoje.setHours(0,0,0,0);

                linhas.forEach(tr => {
                    if (tr.querySelector('th')) return;

                    const linkProc = tr.querySelector('a[href*="acao=processo_selecionar"]');
                    const tdData = tr.querySelector('.eproc-col-data-nucleo');

                    if (linkProc && tdData) {
                        const numProc = linkProc.innerText.trim();
                        const hrefProc = linkProc.href;
                        // Tenta extrair a data se estiver visível
                        const dataTexto = tdData.innerText.trim();
                        const dataObj = obterDataSegura(dataTexto);

                        // Só inclui no relatório se tiver data válida
                        if (dataObj) {
                            dataObj.setHours(0,0,0,0);
                            const diffTime = Math.abs(hoje - dataObj);
                            const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
                            dados.push({ num: numProc, href: hrefProc, dias: diffDays });
                        }
                    }
                });

                if (dados.length === 0) {
                    alert('Nenhuma data válida encontrada para os processos visíveis.');
                    return;
                }

                // Ordenar do mais antigo (maior dias) para o mais novo (menor dias)
                dados.sort((a, b) => b.dias - a.dias);

                let html = '<table border="1"><thead><tr><th>Processo</th><th>Tempo (Dias)</th></tr></thead><tbody>';
                let texto = 'Processo\tTempo (Dias)\n';

                dados.forEach(item => {
                    html += `<tr><td><a href="${item.href}">${item.num}</a></td><td>${item.dias}</td></tr>`;
                    texto += `${item.num}\t${item.dias}\n`;
                });
                html += '</tbody></table>';

                copiarParaClipboard(html, texto);
            };
        }

        function renderizarBotoes() {
            const c = document.getElementById('eproc-botoes-container');
            if(!c) return;
            const todos = getTodosBotoes();
            c.innerHTML = todos.map((b, i) => {
                const custom = !b.padrao;
                const idxR = custom ? botoesPersonalizados.findIndex(x => x.label === b.label) : -1;
                return `
                    <div class="eproc-btn-group ${modoReordenacao?'reorder-mode':''}" draggable="${modoReordenacao}" data-idx="${i}">
                        <button type="button" class="eproc-btn eproc-btn-filtro-padrao" data-val="${b.valor}" data-lbl="${b.label}" ${modoReordenacao?'style="pointer-events:none"':''}>${b.label}</button>
                        ${custom ? `<button type="button" class="eproc-btn" data-rem="${idxR}" style="border-left:0;color:#d9534f;${modoReordenacao?'pointer-events:none':''}">×</button>`:''}
                    </div>`;
            }).join('') + `
                <button type="button" id="eproc-add-btn" class="eproc-btn eproc-btn-success" style="width:24px;padding:0;border-radius:50%!important;">+</button>
                <button type="button" id="eproc-reo-btn" class="eproc-btn ${modoReordenacao?'ativo':''}" style="width:24px;padding:0;margin-left:5px;">⇆</button>
            `;

            c.querySelectorAll('[data-val]').forEach(b => b.onclick = (e) => {
                e.preventDefault();
                if(!modoReordenacao) {
                    addFiltro('texto', b.dataset.val, b.dataset.lbl);
                    aplicarFiltros();
                }
            });
            c.querySelectorAll('[data-rem]').forEach(b => b.onclick = (e) => { e.preventDefault(); e.stopPropagation(); removerBotaoPersonalizado(b.dataset.rem); renderizarBotoes(); });
            document.getElementById('eproc-add-btn').onclick = (e) => { e.preventDefault(); abrirModalAdicionarBotao(); };
            document.getElementById('eproc-reo-btn').onclick = (e) => { e.preventDefault(); modoReordenacao = !modoReordenacao; renderizarBotoes(); };

            if(modoReordenacao) {
                let dragSrc;
                c.querySelectorAll('.eproc-btn-group').forEach(el => {
                    el.ondragstart = e => { dragSrc = el; e.dataTransfer.effectAllowed = 'move'; };
                    el.ondragover = e => { e.preventDefault(); return false; };
                    el.ondrop = function(e) {
                        e.stopPropagation();
                        if (dragSrc !== this) {
                            const oldI = parseInt(dragSrc.dataset.idx); const newI = parseInt(this.dataset.idx);
                            const item = ordemBotoes[oldI]; ordemBotoes.splice(oldI, 1); ordemBotoes.splice(newI, 0, item);
                            salvarOrdemArrastada(ordemBotoes);
                            renderizarBotoes();
                        }
                        return false;
                    };
                });
            }
        }

        // --- PROTEÇÃO CONTRA CRASH DO SERVIDOR (MAX_INPUT_VARS) ---
        function protegerServidorEproc() {
            const form = document.getElementById('frmProcessoLista');
            if (!form) return;

            // Intercepta a submissão nativa do EPROC (usada ao trocar de página)
            const originalSubmit = form.submit;
            form.submit = function() {
                const tabela = document.getElementById('tabelaLocalizadores') || document.querySelector('.infraTable');
                if (tabela) {
                    const linhas = tabela.querySelectorAll('tr[class^="infraTr"]');

                    // Só ativa a limpeza cirúrgica se a página estiver "pesada"
                    if (linhas.length > 50) {
                        linhas.forEach(tr => {
                            const chk = tr.querySelector('input[type="checkbox"]');
                            // Se o processo NÃO estiver marcado, nós o "desativamos"
                            // Isso impede que o navegador envie o lixo oculto dele pro servidor
                            if (chk && !chk.checked) {
                                tr.querySelectorAll('input').forEach(inp => inp.disabled = true);
                                tr.querySelectorAll('select').forEach(sel => sel.disabled = true);
                            }
                        });
                    }
                }
                // Libera a mudança de página, agora extremamente leve
                originalSubmit.call(this);
            };
        }

        // --- INICIALIZAÇÃO ASSÍNCRONA (UI FIRST) ---
        const iniciarProcessamentoDados = () => {
             gerenciarColunasEProcessos();
             setInterval(gerenciarColunasEProcessos, 2000);

             const observer = new MutationObserver((mutations) => {
                if (window.eprocDebounce) clearTimeout(window.eprocDebounce);
                window.eprocDebounce = setTimeout(gerenciarColunasEProcessos, 500);
            });
            observer.observe(document.body, { childList: true, subtree: true });
        };

        const init = () => {
            const form = document.getElementById('frmProcessoLista');
            if(form && !document.getElementById('eproc-seletor')) {
                criarInterface(); // Desenha a interface IMEDIATAMENTE (Síncrono para botões)
                protegerServidorEproc();
                melhorarGerenciarLocalizadores(); // Intercepta "Alterar Localizador" para permitir apenas remoções
                setTimeout(iniciarProcessamentoDados, 100); // Adia o peso do processamento de rede
            } else {
                setTimeout(init, 50);
            }
        };
        init();
    }

    if (location.href.includes('acao=pesquisa_processo')) {
        const fixPesq = () => document.querySelectorAll('select').forEach(s => {
            if([...s.options].some(o=>o.value==='100') && s.value!=='100') { s.value='100'; s.dispatchEvent(new Event('change')); }
        });
        new MutationObserver(fixPesq).observe(document.body, {childList:true, subtree:true}); fixPesq();
    }

})();
