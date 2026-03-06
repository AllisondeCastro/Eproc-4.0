// ==UserScript==
// @name         EPROC 4.0
// @namespace    http://tampermonkey.net/
// @version      45.2
// @description  Seleções inteligentes e Complementos ao sistema EPROC
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
    const TEXTO_ALVO_1 = "Remetidos os Autos (outros motivos) para Núcleo 4.0";
    const TEXTO_ALVO_2 = "Núcleo 4.0"; // Fallback genérico

    // CONFIGURAÇÕES DO INDEXEDDB (Cache de Processos e Controle de Paralisados)
    const DB_NAME = "EprocCacheDB";
    const DB_VERSION = 2; 
    const STORE_NAME = "processos";
    const STORE_PARALISADOS = "paralisados_vistos"; 
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

    // UTILITÁRIO GLOBAL: FILTRO SEGURO DE LINHAS DE DADOS
    function getLinhasProcessos() {
        const tabela = document.getElementById('tabelaLocalizadores') || document.querySelector('.infraTable');
        if (!tabela) return[];
        // Filtra estritamente as linhas da tabela principal, ignorando cabeçalhos e tabelas aninhadas
        return Array.from(tabela.rows).filter(tr => !tr.querySelector('th') && tr.closest('table') === tabela);
    }

    // MAPA DE COMARCAS E SIGLAS (DISTRIBUIÇÃO INTELIGENTE)
    const COMARCAS_MAP = {
        "AET": "ABAETÉ", "ABN": "ABRE-CAMPO", "ACN": "AÇUCENA", "AGF": "ÁGUAS FORMOSAS", "AOR": "AIMORÉS", "AUD": "AIURUOCA", 
        "API": "ALÉM PARAÍBA", "AFN": "ALFENAS", "AMN": "ALMENARA", "ALS": "ALPINÓPOLIS", "ADC": "ALTO RIO DOCE", "ALL": "ALVINÓPOLIS", 
        "ANA": "ANDRADAS", "ADL": "ANDRELÂNDIA", "AUI": "ARAÇUAÍ", "ARI": "ARAGUARI", "AXA": "ARAXÁ", "ACS": "ARCOS", "ADO": "AREADO", 
        "AYN": "ARINOS", "BAD": "BAEPENDI", "BBI": "BAMBUÍ", "BCS": "BARÃO DE COCAIS", "BCA": "BARBACENA", "BSO": "BARROSO", 
        "BHE": "BELO HORIZONTE", "BLL": "BELO VALE", "BET": "BETIM", "BIS": "BICAS", "BOE": "BOA ESPERANÇA", "BCV": "BOCAIÚVA", 
        "BDP": "BOM DESPACHO", "BMS": "BOM SUCESSO", "BFM": "BONFIM", "BFS": "BONFINÓPOLIS DE MINAS", "BOM": "BORDA DA MATA", 
        "BHS": "BOTELHOS", "BMN": "BRASÍLIA DE MINAS", "BPS": "BRAZÓPOLIS", "BMO": "BRUMADINHO", "BBD": "BUENO BRANDÃO", "BUS": "BUENÓPOLIS", 
        "BII": "BURITIS", "CBV": "CABO VERDE", "CHS": "CACHOEIRA DE MINAS", "CET": "CAETÉ", "CAD": "CALDAS", "CDU": "CAMANDUCAIA", 
        "CBI": "CAMBUÍ", "CAQ": "CAMBUQUIRA", "CPH": "CAMPANHA", "CST": "CAMPESTRE", "CVE": "CAMPINA VERDE", "CPO": "Campo Belo", 
        "CMT": "CAMPOS ALTOS", "CPG": "CAMPOS GERAIS", "COI": "CANÁPOLIS", "CWA": "CANDEIAS", "CLH": "CAPELINHA", "CNS": "CAPINÓPOLIS", 
        "CRD": "CARANDAÍ", "CRL": "CARANGOLA", "CGA": "CARATINGA", "CCH": "CARLOS CHAGAS", "COM": "CARMO DA MATA", "CAE": "CARMO DE MINAS", 
        "CCU": "CARMO DO CAJURU", "CMI": "CARMO DO PARANAÍBA", "CRC": "CARMO DO RIO CLARO", "CRM": "CARMÓPOLIS DE MINAS", "CSA": "CÁSSIA", 
        "CGS": "CATAGUASES", "CAX": "CAXAMBU", "CLU": "CLÁUDIO", "CLS": "CONCEIÇÃO DAS ALAGOAS", "CMD": "CONCEIÇÃO DO MATO DENTRO", 
        "CVR": "CONCEIÇÃO DO RIO VERDE", "CNG": "CONGONHAS", "CQT": "CONQUISTA", "CNL": "CONSELHEIRO LAFAIETE", "CSN": "CONSELHEIRO PENA", 
        "CEM": "CONTAGEM", "COJ": "CORAÇÃO DE JESUS", "CIT": "CORINTO", "CEL": "COROMANDEL", "CRF": "CORONEL FABRICIANO", "CSI": "CRISTINA", 
        "CZL": "CRUZÍLIA", "CUV": "CURVELO", "DMT": "DIAMANTINA", "DVO": "DIVINO", "DVL": "DIVINÓPOLIS", "DDI": "DORES DO INDAIÁ", 
        "ELM": "ELÓI MENDES", "ERM": "ENTRE-RIOS DE MINAS", "ERV": "ERVÁLIA", "EES": "ESMERALDAS", "EEP": "ESPERA FELIZ", "EPS": "ESPINOSA", 
        "EEL": "ESTRELA DO SUL", "EOS": "EUGENÓPOLIS", "EXM": "EXTREMA", "FES": "FERROS", "FMA": "FORMIGA", "FCS": "FRANCISCO SÁ", 
        "FRU": "FRUTAL", "GLL": "GALILÉIA", "GVS": "GOVERNADOR VALADARES", "GGL": "GRÃO-MOGOL", "GHE": "GUANHÃES", "GUE": "GUAPÉ", 
        "GSA": "GUARANÉSIA", "GNI": "GUARANI", "GPE": "GUAXUPÉ", "IBY": "IBIÁ", "III": "IBIRACI", "IIB": "IBIRITÉ", "IRP": "IGARAPÉ", 
        "IUM": "IGUATAMA", "INP": "INHAPIM", "YAN": "IPANEMA", "IIG": "IPATINGA", "IBA": "ITABIRA", "IRO": "ITABIRITO", "IGR": "ITAGUARA", 
        "IJA": "ITAJUBÁ", "IMR": "ITAMARANDIBA", "ITC": "ITAMBACURI", "IOG": "ITAMOJI", "IMO": "ITAMONTE", "ITD": "ITANHANDU", "INH": "ITANHOMI", 
        "IGY": "ITAPAJIPE", "IPC": "ITAPECERICA", "IAN": "ITAÚNA", "IUA": "ITUIUTABA", "IYM": "ITUMIRIM", "ITM": "ITURAMA", "JBU": "JABOTICATUBAS", 
        "JNT": "JACINTO", "JCU": "JACUÍ", "JTA": "JACUTINGA", "JAB": "JAÍBA", "JUA": "JANAÚBA", "JNU": "JANUÁRIA", "JQI": "JEQUERI", 
        "JQT": "JEQUITINHONHA", "JML": "João Monlevade", "JPI": "João Pinheiro", "JTB": "JUATUBA", "JFA": "Juiz de Fora", "LPT": "Lagoa da Prata", 
        "LGT": "Lagoa Santa", "LJA": "Lajinha", "LAM": "Lambari", "LAV": "Lavras", "LPD": "Leopoldina", "LAD": "Lima Duarte", "LUZ": "LUZ", 
        "MCD": "Machado", "MCH": "Malacacheta", "MAG": "Manga", "MNC": "Manhuaçu", "MIM": "Manhumirim", "MNN": "Mantena", "MEH": "Mar de Espanha", 
        "MRN": "Mariana", "MHC": "Martinho Campos", "MAL": "Mateus Leme", "MBB": "Matias Barbosa", "MTZ": "Matozinhos", "MDA": "Medina", 
        "MEE": "Mercês", "MQI": "Mesquita", "MNV": "Minas Novas", "MDO": "Miradouro", "MII": "Miraí", "MTV": "Montalvânia", "MAM": "Monte Alegre de Minas", 
        "MZL": "Monte Azul", "MBE": "Monte Belo", "MOO": "Monte Carmelo", "MSM": "Monte Santo de Minas", "MSI": "Monte Sião", "MCL": "Montes Claros", 
        "MNM": "Morada Nova de Minas", "MRE": "Muriaé", "MTM": "Mutum", "MUZ": "Muzambinho", "NNE": "Nanuque", "NAR": "Natércia", "NPO": "Nepomuceno", 
        "NER": "Nova Era", "NLA": "Nova Lima", "NVN": "Nova Ponte", "NES": "Nova Resende", "NVS": "Nova Serrana", "NZO": "Novo Cruzeiro", 
        "OLV": "Oliveira", "OUO": "Ouro Branco", "OUF": "Ouro Fino", "ORP": "Ouro Preto", "PAL": "Palma", "PRS": "Pará de Minas", "PTU": "Paracatu", 
        "PGC": "Paraguaçu", "PSP": "Paraisópolis", "PEB": "Paraopeba", "PQO": "Passa-Quatro", "PST": "Passa-Tempo", "PSS": "Passos", "PMS": "Patos de Minas", 
        "PTC": "Patrocínio", "PNH": "Peçanha", "PZL": "Pedra Azul", "PDV": "Pedralva", "PLO": "Pedro Leopoldo", "PEZ": "Perdizes", "PDS": "Perdões", 
        "PRG": "Piranga", "PPN": "Pirapetinga", "PRR": "Pirapora", "PTI": "Pitangui", "PIU": "Piumhi", "POF": "Poço Fundo", "PCS": "Poços de Caldas", 
        "PPE": "Pompéu", "PNV": "Ponte Nova", "PTH": "Porteirinha", "PSO": "Pouso Alegre", "PAD": "Prados", "PRT": "Prata", "PRO": "Pratápolis", 
        "PEE": "Presidente Olegário", "RSS": "Raul Soares", "RED": "Resende Costa", "RSP": "Resplendor", "RNS": "Ribeirão das Neves", "RCS": "Rio Casca", 
        "RNV": "Rio Novo", "RPA": "Rio Paranaíba", "RDS": "Rio Pardo de Minas", "RPC": "Rio Piracicaba", "RPB": "Rio Pomba", "RRE": "Rio Preto", 
        "RIV": "Rio Vermelho", "SBA": "Sabará", "SNS": "Sabinópolis", "SQN": "Sacramento", "SLN": "Salinas", "SBB": "Santa Bárbara", "SLU": "Santa Luzia", 
        "SUI": "Santa Maria do Suaçuí", "SRT": "Santa Rita de Caldas", "SRS": "Santa Rita do Sapucaí", "STV": "Santa Vitória", "SDT": "Santo Antônio do Monte", 
        "SND": "Santos Dumont", "SDG": "São Domingos do Prata", "SFI": "São Francisco", "SGS": "São Gonçalo do Sapucaí", "SGT": "São Gotardo", 
        "SJT": "São João da Ponte", "SOE": "São João del-Rei", "SSK": "São João do Paraíso", "SEG": "São João Evangelista", "SJN": "São João Nepomuceno", 
        "SAL": "São Lourenço", "SRW": "São Romão", "SQS": "São Roque de Minas", "SSP": "São Sebastião do Paraíso", "SDF": "Senador Firmino", "SER": "Serro", 
        "SLA": "Sete Lagoas", "SLP": "Silvianópolis", "TOE": "Taiobeiras", "TRM": "Tarumirim", "TXS": "Teixeiras", "TOT": "Teófilo Otôni", "TTO": "Timóteo", 
        "TRZ": "Tiros", "TOS": "Tombos", "TCS": "Três Corações", "TMS": "Três Marias", "TSP": "Três Pontas", "TPC": "Tupaciguara", "TUR": "Turmalina", 
        "UBA": "Ubá", "URA": "Uberaba", "ULA": "Uberlândia", "UNI": "Unaí", "VGA": "Varginha", "VZP": "Várzea da Palma", "VZE": "Vazante", 
        "VPN": "Vespasiano", "VCS": "Viçosa", "VGP": "Virginópolis", "VRB": "Visconde do Rio Branco"
    };

    // ===========================================================================================
    // PARTE 1: ESTILOS (CORREÇÃO DE LARGURA DEFINITIVA E ASSISTENTE)
    // ===========================================================================================
    const style = document.createElement('style');
    style.innerHTML = `
        #tabelaLocalizadores tbody tr {
            /* Avisa o navegador que as mudanças na linha não afetam o site inteiro */
            contain: content;
        }

        /* --- CORREÇÃO ESTRUTURAL DA TABELA PRINCIPAL --- */
        #tabelaLocalizadores {
            width: 100% !important;
            table-layout: auto !important;
            border-collapse: collapse !important;
        }

        /* Proteção para afetar Apenas as células principais e não as tabelas internas (de ordenação) */
        #tabelaLocalizadores > tbody > tr > th, #tabelaLocalizadores > tbody > tr > td {
            padding: 5px 4px !important;
            vertical-align: middle !important;
        }

        /* 1. COLUNAS COMPACTAS (Datas, Números, Inclusão) */
        #tabelaLocalizadores > tbody > tr > th:nth-child(2), #tabelaLocalizadores > tbody > tr > td:nth-child(2) {
            width: 1px !important;
            white-space: nowrap !important;
        }

        #tabelaLocalizadores > tbody > tr > th:nth-child(3), #tabelaLocalizadores > tbody > tr > td:nth-child(3) {
            width: 1px !important;
            white-space: nowrap !important;
        }

        #tabelaLocalizadores > tbody > tr > th:last-child, #tabelaLocalizadores > tbody > tr > td:last-child {
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
        #tabelaLocalizadores > tbody > tr > th:nth-child(7), #tabelaLocalizadores > tbody > tr > td:nth-child(7) {
            white-space: normal !important;
            max-width: 220px !important;     /* Largura fixa para forçar a quebra vertical */
            word-wrap: break-word !important;
        }

        #tabelaLocalizadores > tbody > tr > th:nth-last-child(2), #tabelaLocalizadores > tbody > tr > td:nth-last-child(2) {
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
            border: 1px solid #ccc; max-height: 90vh; overflow-y: auto;
        }
        .eproc-modal-title { font-size: 16px; font-weight: bold; margin-bottom: 15px; color: #333; border-bottom: 1px solid #eee; padding-bottom: 10px; }
        .eproc-modal-field { margin-bottom: 15px; }
        .eproc-modal-label { display: block; font-size: 12px; font-weight: bold; margin-bottom: 5px; color: #555; }
        .eproc-modal-input { width: 100%; padding: 8px; border: 1px solid #ccc; border-radius: 4px; font-size: 13px; box-sizing: border-box; }
        .eproc-modal-actions { text-align: right; margin-top: 15px; }
        .eproc-modal-btn { padding: 8px 15px; border-radius: 4px; cursor: pointer; font-size: 13px; border: 1px solid transparent; margin-left: 5px; font-weight: bold; }
        .eproc-modal-btn-cancel { background: #fff; border: 1px solid #ccc; color: #333; }
        .eproc-modal-btn-save { background: #5cb85c; color: white; border-color: #4cae4c; }

        .eproc-radio-group { display: flex; align-items: center; gap: 15px; margin-right: 15px; border-right: 1px solid #eee; padding-right: 15px; height: 100%; }
        .eproc-radio-label { font-size: 12px; font-weight: normal; cursor: pointer; display: flex; align-items: center; gap: 4px; margin: 0 !important; padding: 0 !important; line-height: 1; }
        .eproc-radio-label input[type="radio"] { margin: 0 !important; margin-top: 1px !important; cursor: pointer; }
        
        .eproc-btn-magic { background-image: linear-gradient(to bottom, #f39c12 0, #e67e22 100%); color: #fff; font-weight: bold; border-color: #d35400; }
        .eproc-btn-magic:hover { background-image: none; background-color: #e67e22; color: #fff; }
        .eproc-dist-item { border: 1px solid #eee; padding: 10px; border-radius: 4px; margin-bottom: 10px; background-color: #fcfcfc; }
        .eproc-dist-title { font-weight: bold; color: #333; font-size: 13px; margin-bottom: 5px; }
        .eproc-dist-count { font-size: 11px; color: #777; margin-bottom: 8px; }

        /* NAVEGAÇÃO FLUTUANTE (SETAS) */
        #eproc-nav-flutuante {
            position: fixed;
            right: 15px;
            top: 50%;
            transform: translateY(-50%);
            display: none;
            flex-direction: column;
            gap: 8px;
            z-index: 9998;
            opacity: 0.4;
            transition: opacity 0.3s ease;
        }
        #eproc-nav-flutuante:hover {
            opacity: 1;
        }
        .eproc-nav-btn {
            width: 28px;
            height: 28px;
            border-radius: 50%;
            background-color: #fff;
            border: 1px solid #ccc;
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
            cursor: pointer;
            display: flex;
            justify-content: center;
            align-items: center;
            color: #666;
            outline: none;
        }
        .eproc-nav-btn:hover {
            background-color: #f8f8f8;
            color: #333;
        }
        .eproc-nav-btn svg {
            fill: currentColor;
            width: 18px;
            height: 18px;
        }
    `;
    document.head.appendChild(style);

    // ===========================================================================================
    // CACHE MANAGER & INFRA
    // ===========================================================================================
    const CacheManager = {
        db: null,
        memoryCache: new Map(),
        writeBuffer:[],
        writeTimer: null,
        initPromise: null,
        ready: false,

        init: function() {
            if (this.initPromise) return this.initPromise;
            this.initPromise = new Promise((resolve) => {
                const request = indexedDB.open(DB_NAME, DB_VERSION);
                request.onupgradeneeded = (event) => {
                    const db = event.target.result;
                    if (!db.objectStoreNames.contains(STORE_NAME)) db.createObjectStore(STORE_NAME, { keyPath: "id" });
                    if (!db.objectStoreNames.contains(STORE_PARALISADOS)) db.createObjectStore(STORE_PARALISADOS, { keyPath: "id" });
                };
                request.onsuccess = (event) => {
                    this.db = event.target.result;
                    this.ready = true;
                    this.cleanupOldData();
                    this.migrateDatesFromLocalStorage();
                    resolve(this.db);
                };
                request.onerror = (event) => { this.ready = true; resolve(); };
            });
            return this.initPromise;
        },

        getAsync: function(id) {
            return new Promise((resolve) => {
                if (!this.db) { resolve(null); return; }
                const tx = this.db.transaction([STORE_NAME], "readonly");
                const store = tx.objectStore(STORE_NAME);
                const req = store.get(id);
                req.onsuccess = () => {
                    const res = req.result;
                    if (res && res.timestamp >= Date.now() - (EXPIRATION_DAYS * 24 * 60 * 60 * 1000)) {
                        this.memoryCache.set(id, res.value); resolve(res.value);
                    } else resolve(null);
                };
                req.onerror = () => resolve(null);
            });
        },

        warmupChunk: function(keys) {
            return new Promise((resolve) => {
                if (!this.db || keys.length === 0) { resolve(); return; }
                const tx = this.db.transaction([STORE_NAME], "readonly");
                const store = tx.objectStore(STORE_NAME);
                const expTime = Date.now() - (EXPIRATION_DAYS * 24 * 60 * 60 * 1000);
                let processed = 0;
                keys.forEach(key => {
                    if (this.memoryCache.has(key)) { processed++; if (processed === keys.length) resolve(); return; }
                    const req = store.get(key);
                    req.onsuccess = () => {
                        if (req.result && req.result.timestamp >= expTime) this.memoryCache.set(key, req.result.value);
                        processed++; if (processed === keys.length) resolve();
                    };
                    req.onerror = () => { processed++; if (processed === keys.length) resolve(); };
                });
            });
        },

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
                        if (paralisadosNovosSessao.has(id)) { novos.push(id); checkDone(); return; }
                        const req = store.get(id);
                        req.onsuccess = () => {
                            if (!req.result) { novos.push(id); paralisadosNovosSessao.add(id); store.put({ id: id, timestamp: now }); }
                            checkDone();
                        };
                        req.onerror = () => checkDone();
                    });
                    function checkDone() { processados++; if (processados === ids.length) resolve(novos); }
                } catch (e) { resolve([]); }
            });
        },

        migrateDatesFromLocalStorage: async function() {
            try {
                const oldCacheStr = localStorage.getItem("eproc_dates_cache_v2_persistent");
                if (oldCacheStr) {
                    const tx = this.db.transaction([STORE_NAME], "readwrite");
                    const store = tx.objectStore(STORE_NAME);
                    const now = Date.now();
                    const oldData = JSON.parse(oldCacheStr);
                    for (const [id, val] of Object.entries(oldData)) store.put({ id: id, value: val, timestamp: now });
                    localStorage.removeItem("eproc_dates_cache_v2_persistent");
                }
            } catch (e) {}
        },

        cleanupOldData: function() {
            try {
                const tx = this.db.transaction([STORE_NAME], "readwrite");
                const store = tx.objectStore(STORE_NAME);
                const expTime = Date.now() - (EXPIRATION_DAYS * 24 * 60 * 60 * 1000);
                const cursorRequest = store.openCursor();
                cursorRequest.onsuccess = (e) => {
                    const cursor = e.target.result;
                    if (cursor) {
                        if (!cursor.value.id.startsWith("pref_") && cursor.value.timestamp < expTime) cursor.delete();
                        cursor.continue();
                    }
                };
            } catch (e) {}
        },

        getSync: function(id) { return this.memoryCache.get(id); },

        set: function(id, val) {
            this.memoryCache.set(id, val);
            this.writeBuffer.push({ id: id, value: val, timestamp: Date.now() });
            if (this.writeBuffer.length >= 20) this.flushBuffer();
            else {
                if (this.writeTimer) clearTimeout(this.writeTimer);
                this.writeTimer = setTimeout(() => this.flushBuffer(), 5000);
            }
        },

        flushBuffer: function() {
            if (this.writeBuffer.length === 0 || !this.db) return;
            const batch =[...this.writeBuffer]; this.writeBuffer =[];
            if (this.writeTimer) clearTimeout(this.writeTimer);
            const tx = this.db.transaction([STORE_NAME], "readwrite");
            const store = tx.objectStore(STORE_NAME);
            batch.forEach(item => store.put(item));
        }
    };
    CacheManager.init();

    const DomBatcher = {
        queue:[], scheduled: false,
        add: function(element, html, row, attributes) {
            this.queue.push({ element, html, row, attributes });
            if (!this.scheduled) { this.scheduled = true; requestAnimationFrame(() => this.flush()); }
        },
        flush: function() {
            for (let i = 0; i < this.queue.length; i++) {
                const item = this.queue[i];
                if (item.element) item.element.innerHTML = item.html;
                if (item.row && item.attributes) {
                    for (const[key, val] of Object.entries(item.attributes)) {
                        if (val === null) item.row.removeAttribute(key); else item.row.setAttribute(key, val);
                    }
                }
            }
            this.queue =[]; this.scheduled = false;
        }
    };

    function mostrarToast(msg) {
        const toast = document.getElementById('eproc-toast');
        if (toast) {
            if(msg) toast.textContent = msg;
            toast.classList.add('show');
            setTimeout(() => toast.classList.remove('show'), 3000);
        }
    }

    async function copiarParaClipboard(conteudoHtml, conteudoTexto) {
        try {
            const blobHtml = new Blob([conteudoHtml], { type: 'text/html' });
            const blobText = new Blob([conteudoTexto], { type: 'text/plain' });
            const data =[new ClipboardItem({ 'text/html': blobHtml, 'text/plain': blobText })];
            await navigator.clipboard.write(data);
            mostrarToast("Processos copiados!");
        } catch (err) {
            const textArea = document.createElement('textarea');
            textArea.value = conteudoTexto;
            document.body.appendChild(textArea); textArea.select(); document.execCommand('copy'); document.body.removeChild(textArea);
            mostrarToast("Processos copiados!");
        }
    }

    class TokenBucket {
        constructor(capacity, tokensPerSecond) { this.capacity = capacity; this.tokens = capacity; this.rate = tokensPerSecond; this.lastRefill = Date.now(); }
        async consume() {
            this.refill();
            if (this.tokens >= 1) { this.tokens -= 1; return true; }
            const waitTime = Math.max(0, this.lastRefill + ((1 / this.rate) * 1000) - Date.now());
            await new Promise(resolve => setTimeout(resolve, waitTime));
            return this.consume();
        }
        refill() {
            const now = Date.now(); const elapsed = (now - this.lastRefill) / 1000;
            if (elapsed > 0) { this.tokens = Math.min(this.capacity, this.tokens + (elapsed * this.rate)); this.lastRefill = now; }
        }
    }
    const rateLimiter = new TokenBucket(BUCKET_CAPACITY, TOKENS_PER_SECOND);

    // ===========================================================================================
    // PARTE 2: MOTOR DE REQUISIÇÃO (REDE E CACHE)
    // ===========================================================================================
    const filaDeProcessamento = {
        queue:[], active: 0, pauseUntil: 0,
        add: function(url, celula, linha, numProcesso) {
            if (linha.getAttribute('data-nucleo-status')) return;
            const cachedValue = CacheManager.getSync(numProcesso) || CacheManager.getSync(url);
            if (cachedValue) { this.renderizarDoCache(celula, linha, cachedValue); return; }
            DomBatcher.add(celula, `<div class="eproc-spinner"></div>`, linha, { 'data-nucleo-status': 'checking-storage' });
            CacheManager.getAsync(numProcesso || url).then((dbValue) => {
                if (dbValue) this.renderizarDoCache(celula, linha, dbValue);
                else {
                    this.queue.push({ url, celula, linha, numProcesso, retries: 0 });
                    linha.setAttribute('data-nucleo-status', 'queued'); this.process();
                }
            });
        },
        renderizarDoCache: function(celula, linha, value) {
            const parts = value.split('###'); const dataStr = parts[0]; const origemStr = parts[1] || "-";
            if (/^\d{2}\/\d{2}\/\d{4}$/.test(dataStr)) {
                DomBatcher.add(celula, `<span style="color:#000;">${dataStr}</span>`, linha, { 'data-nucleo-carregado': 'true', 'data-nucleo-status': null });
                const celulaOrigem = celula.nextElementSibling;
                if(celulaOrigem && celulaOrigem.classList.contains('eproc-col-origem-nucleo')) {
                    DomBatcher.add(celulaOrigem, `<span title="${origemStr}">${origemStr}</span>`, null, null);
                    linha.setAttribute('data-idx-text', (linha.getAttribute('data-idx-text') || "") + " " + origemStr.toUpperCase());
                }
            }
        },
        process: async function() {
            if (this.active >= MAX_CONCURRENCY || this.queue.length === 0) return;
            if (Date.now() < this.pauseUntil) { setTimeout(() => this.process(), 1000); return; }
            await rateLimiter.consume();
            if (this.queue.length === 0) return;
            await new Promise(r => setTimeout(r, Math.floor(Math.random() * 150)));
            const task = this.queue.shift(); this.active++; task.linha.setAttribute('data-nucleo-status', 'processing');
            this.executeTask(task); this.process();
        },
        executeTask: async function(task) {
            try {
                let url = task.url;
                if (task.retries > 3) url += `${url.includes('?')?'&':'?'}_force_refresh=${Date.now()}`;
                if (task.retries > 6) await new Promise(r => setTimeout(r, Math.floor(Math.random() * 3000) + 1500));
                const controller = new AbortController(); const timeoutId = setTimeout(() => controller.abort(), 15000);
                const res = await fetch(url, { method: 'GET', headers: { 'X-Requested-With': 'XMLHttpRequest' }, credentials: 'include', cache: 'no-store', signal: controller.signal });
                clearTimeout(timeoutId);
                if (res.url.includes("login") || res.url.includes("acao=sair") || res.url.includes("msg=Sua")) throw new Error("SESSAO_ENCERRADA");
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                const text = new TextDecoder('iso-8859-1').decode(await res.arrayBuffer());
                if (text.length < 500 || text.includes("Sua sessão foi encerrada")) throw new Error("SESSAO_ENCERRADA");
                this.parseAndFinish(text, task);
            } catch (error) {
                this.active--; task.retries++;
                if (error.message === "SESSAO_ENCERRADA" || error.message.includes("Sessão")) {
                    this.pauseUntil = Date.now() + 15000; task.linha.setAttribute('data-nucleo-status', 'queued');
                    this.queue.push(task); setTimeout(() => this.process(), 15000); return;
                }
                if (!document.body.contains(task.linha)) { this.process(); return; }
                const color = task.retries > 10 ? "purple" : (task.retries > 5 ? "red" : "orange");
                DomBatcher.add(task.celula, `<div class="eproc-spinner" style="border-top-color: ${color};"></div>`, task.linha, { 'data-nucleo-status': 'waiting-retry' });
                setTimeout(() => { task.linha.setAttribute('data-nucleo-status', 'queued'); this.queue.push(task); this.process(); }, Math.min((task.retries * 3000) + 2000, 45000));
            }
        },
        parseAndFinish: function(text, task) {
            try {
                let dataAchada = null, origemAchada = "-";
                const regexOrigem = /\(([^()]+?)\s+para\s+.*?(?:4\.0)/i;
                const idx = text.indexOf(TEXTO_ALVO_1);
                if (idx !== -1) {
                    const matches = text.substring(Math.max(0, idx - 1000), idx).match(/(\d{2}\/\d{2}\/\d{4})/g);
                    if (matches && matches.length > 0) dataAchada = matches[matches.length - 1];
                    const matchOrigem = text.substring(idx, Math.min(text.length, idx + 500)).match(regexOrigem);
                    if (matchOrigem) origemAchada = matchOrigem[1].trim();
                }
                if (!dataAchada) {
                    const doc = new DOMParser().parseFromString(text, "text/html");
                    for (let tr of doc.querySelectorAll('#tblEventos tr')) {
                        if (tr.textContent.includes(TEXTO_ALVO_1) || (tr.textContent.includes("Remetidos os Autos") && tr.textContent.includes(TEXTO_ALVO_2))) {
                            const match = tr.cells[2]?.innerText.match(/(\d{2}\/\d{2}\/\d{4})/);
                            if (match) {
                                dataAchada = match[1];
                                const mOrigem = tr.textContent.match(regexOrigem);
                                if (mOrigem) origemAchada = mOrigem[1].trim();
                                break;
                            }
                        }
                    }
                }
                if (dataAchada) {
                    CacheManager.set(task.numProcesso || task.url, `${dataAchada}###${origemAchada}`);
                    this.renderizarDoCache(task.celula, task.linha, `${dataAchada}###${origemAchada}`);
                    this.active--; this.process();
                } else throw new Error("Data pattern not found");
            } catch (e) {
                this.active--; task.retries++; task.linha.setAttribute('data-nucleo-status', 'queued');
                this.queue.push(task); setTimeout(() => this.process(), 1000);
            }
        }
    };

    function scheduleKeepAlive() {
        setTimeout(() => {
            fetch(location.href, { method: 'HEAD', headers: { 'X-Requested-With': 'XMLHttpRequest' }, credentials: 'include' }).catch(() => {});
            scheduleKeepAlive();
        }, 180000 + Math.random() * 90000);
    }
    scheduleKeepAlive();

    // ===========================================================================================
    // PARTE 3: TABELA E CHUNK PROCESSING (COM INDICADOR NATIVO E CORREÇÃO DE CABEÇALHO)
    // ===========================================================================================
    let ordemData = 'desc'; let ordemOrigem = 'asc';
    function obterDataSegura(str) {
        if (!str) return null; const match = str.match(/(\d{2})\/(\d{2})\/(\d{4})/);
        return match ? new Date(parseInt(match[3]), parseInt(match[2]) - 1, parseInt(match[1])) : null;
    }

    function ordenarPor(colClass, ordemVar) {
        const tabela = document.getElementById('tabelaLocalizadores') || document.querySelector('.infraTable');
        if (!tabela) return;
        const th = tabela.querySelector(colClass === '.eproc-col-data-nucleo' ? '.th-nucleo-40' : '.th-nucleo-origem');
        if (!th) return; 
        const parent = th.closest('tbody') || tabela.querySelector('tbody') || tabela; 

        document.querySelectorAll('.th-nucleo-40 .sort-up, .th-nucleo-origem .sort-up').forEach(img => img.src = 'infra_css/imagens/seta_acima.gif');
        document.querySelectorAll('.th-nucleo-40 .sort-down, .th-nucleo-origem .sort-down').forEach(img => img.src = 'infra_css/imagens/seta_abaixo.gif');

        window[ordemVar] = (window[ordemVar] === 'asc') ? 'desc' : 'asc';
        const imgUp = th.querySelector('.sort-up');
        const imgDown = th.querySelector('.sort-down');

        if (window[ordemVar] === 'asc') {
            if(imgUp) imgUp.src = 'infra_css/imagens/seta_acima_selecionada.gif';
        } else {
            if(imgDown) imgDown.src = 'infra_css/imagens/seta_abaixo_selecionada.gif';
        }

        const isData = colClass === '.eproc-col-data-nucleo';
        
        const rows = getLinhasProcessos().filter(tr => tr.querySelector(colClass));
        
        rows.sort((a, b) => {
            const vA = a.cells[th.cellIndex]?.innerText.trim() || ""; const vB = b.cells[th.cellIndex]?.innerText.trim() || "";
            if (isData) {
                const dA = obterDataSegura(vA); const dB = obterDataSegura(vB);
                if (!dA) return 1; if (!dB) return -1;
                return window[ordemVar] === 'asc' ? dA - dB : dB - dA;
            } else {
                if (vA === vB) return 0;
                return window[ordemVar] === 'asc' ? vA.localeCompare(vB) : vB.localeCompare(vA);
            }
        });
        rows.forEach(r => parent.appendChild(r));
    }

    function verificarParalisacao(linha, idxEvento) {
        if (!linha || idxEvento === -1) return false;
        const texto = linha.cells[idxEvento]?.innerText.trim();
        const dataEvento = obterDataSegura(texto);
        if (dataEvento) {
            const hoje = new Date(); hoje.setHours(0,0,0,0); dataEvento.setHours(0,0,0,0);
            if (Math.ceil(Math.abs(hoje - dataEvento) / 86400000) >= 30) {
                linha.classList.add('tr-paralisado');
                const num = linha.querySelector('a[href*="acao=processo_selecionar"]')?.innerText.trim().replace(/\D/g, '');
                if (num && paralisadosNovosSessao.has(num)) linha.classList.add('tr-novo-paralisado');
                return true;
            } else { linha.classList.remove('tr-paralisado', 'tr-novo-paralisado'); }
        }
        return false;
    }

    let isScanning = false;
    function gerenciarColunasEProcessos() {
        if (isScanning || !CacheManager.ready) return;
        const tabela = document.getElementById('tabelaLocalizadores') || document.querySelector('.infraTable');
        if (!tabela) return;
        const header = tabela.querySelector('tr.infraTr') || tabela.querySelector('tr');
        let idxEvento = -1; Array.from(header.cells).forEach((c, i) => { if (c.textContent.includes("Último Evento")) idxEvento = i; });
        if (idxEvento === -1) return;

        if (!header.querySelector('.th-nucleo-40')) {
            const th = document.createElement('th'); th.className = 'infraTh th-nucleo-40'; th.style.padding = '0';
            th.innerHTML = `
                <table class="infraTableOrdenacao" style="width:100%; cursor:pointer;">
                    <tbody>
                        <tr class="infraTrOrdenacao">
                            <td width="1%" class="infraTdSetaOrdenacao"><img src="infra_css/imagens/seta_acima.gif" class="infraImgOrdenacao sort-up"></td>
                            <td rowspan="2" valign="center" class="infraTdRotuloOrdenacao" style="text-align:center;">Recebido em</td>
                        </tr>
                        <tr class="infraTrOrdenacao">
                            <td class="infraTdSetaOrdenacao"><img src="infra_css/imagens/seta_abaixo.gif" class="infraImgOrdenacao sort-down"></td>
                        </tr>
                    </tbody>
                </table>
            `;
            header.insertBefore(th, header.cells[idxEvento]); th.onclick = () => ordenarPor('.eproc-col-data-nucleo', 'ordemData');
        }
        if (!header.querySelector('.th-nucleo-origem')) {
            const th = document.createElement('th'); th.className = 'infraTh th-nucleo-origem'; th.style.padding = '0';
            th.innerHTML = `
                <table class="infraTableOrdenacao" style="width:100%; cursor:pointer;">
                    <tbody>
                        <tr class="infraTrOrdenacao">
                            <td width="1%" class="infraTdSetaOrdenacao"><img src="infra_css/imagens/seta_acima.gif" class="infraImgOrdenacao sort-up"></td>
                            <td rowspan="2" valign="center" class="infraTdRotuloOrdenacao" style="text-align:center;">Origem</td>
                        </tr>
                        <tr class="infraTrOrdenacao">
                            <td class="infraTdSetaOrdenacao"><img src="infra_css/imagens/seta_abaixo.gif" class="infraImgOrdenacao sort-down"></td>
                        </tr>
                    </tbody>
                </table>
            `;
            const thRec = header.querySelector('.th-nucleo-40');
            if(thRec && thRec.nextSibling) header.insertBefore(th, thRec.nextSibling); else header.appendChild(th);
            th.onclick = () => ordenarPor('.eproc-col-origem-nucleo', 'ordemOrigem');
        }

        const colIdxDate = header.querySelector('.th-nucleo-40').cellIndex;
        isScanning = true; const linhas = getLinhasProcessos();
        let index = 0; const chunkSize = 20;

        function processarChunk() {
            const fim = Math.min(index + chunkSize, linhas.length);
            const keysToWarm =[];
            for (let i = index; i < fim; i++) {
                const tr = linhas[i]; 
                if (!tr.hasAttribute('data-idx-text')) tr.setAttribute('data-idx-text', tr.textContent.toUpperCase());
                
                const link = tr.querySelector('a[href*="acao=processo_selecionar"]');
                if (link) {
                    const numProc = link.innerText.trim().replace(/\D/g, '');
                    if (!CacheManager.getSync(numProc)) keysToWarm.push(numProc);
                }
            }

            CacheManager.warmupChunk(keysToWarm).then(() => {
                for (let i = index; i < fim; i++) {
                    const tr = linhas[i]; 
                    verificarParalisacao(tr, idxEvento);

                    let tdDate = tr.querySelector('.eproc-col-data-nucleo');
                    if (!tdDate) { tdDate = document.createElement('td'); tdDate.className = 'infraTd eproc-col-data-nucleo'; tdDate.textContent = "..."; tr.insertBefore(tdDate, tr.cells[colIdxDate]); }
                    let tdOrigem = tr.querySelector('.eproc-col-origem-nucleo');
                    if (!tdOrigem) {
                        tdOrigem = document.createElement('td'); tdOrigem.className = 'infraTd eproc-col-origem-nucleo'; tdOrigem.textContent = "...";
                        if (tdDate.nextSibling) tr.insertBefore(tdOrigem, tdDate.nextSibling); else tr.appendChild(tdOrigem);
                    }

                    if (!tr.getAttribute('data-nucleo-carregado') && !tr.getAttribute('data-nucleo-status')) {
                        const link = tr.querySelector('a[href*="acao=processo_selecionar"]');
                        if (link) filaDeProcessamento.add(link.href, tdDate, tr, link.innerText.trim().replace(/\D/g, ''));
                        else { tdDate.textContent = "-"; tdOrigem.textContent = "-"; tr.setAttribute('data-nucleo-carregado', 'true'); }
                    }
                }
                index = fim;
                if (index < linhas.length) requestAnimationFrame(processarChunk);
                else {
                    isScanning = false;
                    const alertaDiv = document.getElementById('eproc-alerta-paralisado');
                    if (alertaDiv) {
                        const trsParalisados = document.querySelectorAll('tr.tr-paralisado');
                        if (trsParalisados.length > 0) {
                            if (alertaDiv.getAttribute('data-qtd-paralisados') !== String(trsParalisados.length)) {
                                alertaDiv.setAttribute('data-qtd-paralisados', String(trsParalisados.length));
                                const idsParalisados =[]; const mapTrs = {};
                                trsParalisados.forEach(tr => {
                                    const num = tr.querySelector('a[href*="acao=processo_selecionar"]')?.innerText.trim().replace(/\D/g, '');
                                    if(num) { idsParalisados.push(num); mapTrs[num] = tr; }
                                });
                                CacheManager.checkNovosParalisados(idsParalisados).then(novosIds => {
                                    novosIds.forEach(id => { if (mapTrs[id]) mapTrs[id].classList.add('tr-novo-paralisado'); });
                                    alertaDiv.style.display = 'flex'; alertaDiv.innerHTML = '';
                                    const textoSpan = document.createElement('span'); textoSpan.textContent = `⚠️ HÁ ${trsParalisados.length} PROCESSOS PARALISADOS HÁ MAIS DE 30 DIAS! `; alertaDiv.appendChild(textoSpan);
                                    if (novosIds.length > 0) {
                                        const badge = document.createElement('span'); badge.className = 'eproc-badge-novo'; badge.textContent = `Há ${novosIds.length} novos paralisados`; alertaDiv.appendChild(badge);
                                    }
                                    criarBotoesAlerta(alertaDiv, idxEvento, trsParalisados.length, novosIds.length);
                                });
                            }
                        } else { alertaDiv.style.display = 'none'; alertaDiv.removeAttribute('data-qtd-paralisados'); }
                    }
                    if (filaDeProcessamento.queue.length > 0 && filaDeProcessamento.active < MAX_CONCURRENCY) filaDeProcessamento.process();
                }
            });
        }
        processarChunk();
    }

    function criarBotoesAlerta(alertaDiv, idxEvento, totalParalisados, totalNovos) {
        const btnRel = document.createElement('button'); btnRel.id = 'eproc-relatorio-btn'; btnRel.textContent = "Gerar Relatório"; btnRel.type = "button"; alertaDiv.appendChild(btnRel);
        btnRel.onclick = (e) => {
            e.preventDefault(); e.stopPropagation();
            const overlay = document.createElement('div'); overlay.className = 'eproc-modal-overlay';
            const seletorAbrangencia = totalNovos > 0 ? `
                <div style="margin-bottom:15px; text-align:left; background:#f9f9f9; padding:10px; border-radius:4px; border:1px solid #eee;">
                    <label style="display:block; font-size:12px; font-weight:bold; margin-bottom:8px; color:#555;">Abrangência do Relatório:</label>
                    <label class="eproc-radio-label" style="margin-bottom:5px;"><input type="radio" name="eproc-rel-scope" value="todos" checked> Todos os Paralisados (${totalParalisados})</label>
                    <label class="eproc-radio-label"><input type="radio" name="eproc-rel-scope" value="novos"> Apenas Novos Paralisados (${totalNovos})</label>
                </div>` : '';
            overlay.innerHTML = `<div class="eproc-modal-content" style="width:340px; text-align:center;"><div class="eproc-modal-title">Relatório de Paralisados</div>${seletorAbrangencia}
                <button id="btn-rel-geral" class="eproc-btn" style="width:100%; margin-bottom:10px; font-weight:bold;">Relatório Geral</button>
                <button id="btn-rel-digito" class="eproc-btn eproc-btn-secondary" style="width:100%; margin-bottom:15px; font-weight:bold;">Relatório Por Dígito</button>
                <button id="btn-rel-cancel" class="eproc-btn eproc-btn-danger" style="width:100%;">Cancelar</button></div>`;
            document.body.appendChild(overlay);
            
            const fechar = () => { if(document.body.contains(overlay)) document.body.removeChild(overlay); };
            
            const getFiltrados = () => {
                let paralisados = Array.from(document.querySelectorAll('tr.tr-paralisado'));
                if (totalNovos > 0 && document.querySelector('input[name="eproc-rel-scope"]:checked')?.value === 'novos') {
                    paralisados = paralisados.filter(tr => tr.classList.contains('tr-novo-paralisado'));
                }
                return paralisados;
            };
            
            document.getElementById('btn-rel-cancel').onclick = fechar;
            
            document.getElementById('btn-rel-geral').onclick = () => {
                const paralisados = getFiltrados(); 
                fechar(); 
                if (!paralisados.length) return;
                
                let html = '<table border="1"><thead><tr><th>Processo</th><th>Último Evento</th></tr></thead><tbody>'; let texto = 'Processo\tÚltimo Evento\n';
                paralisados.forEach(tr => {
                    const l = tr.querySelector('a[href*="acao=processo_selecionar"]'); const c = tr.cells[idxEvento];
                    const num = l ? l.innerText.trim() : "N/A"; const evt = c ? c.innerText.replace(/\s+/g, ' ').trim() : "";
                    html += `<tr><td><a href="${l?.href||''}">${num}</a></td><td>${evt}</td></tr>`; texto += `${num}\t${evt}\n`;
                });
                html += '</tbody></table>'; copiarParaClipboard(html, texto);
            };
            
            document.getElementById('btn-rel-digito').onclick = () => {
                const paralisados = getFiltrados(); 
                fechar(); 
                if (!paralisados.length) return;
                
                const buckets = Array.from({length: 10}, () =>[]);
                paralisados.forEach(tr => {
                    const l = tr.querySelector('a[href*="acao=processo_selecionar"]');
                    if(l) { const num = l.innerText.trim(); const d = parseInt(num.match(/(\d)-/)?.[1]); if (!isNaN(d)) buckets[d].push({ num, href: l.href }); }
                });
                let html = '<table border="1" style="border-collapse:collapse;text-align:center;"><thead><tr>';
                for(let i=0; i<=9; i++) html += `<th style="background:#f0f0f2;padding:5px;">Dígito ${i}</th>`; html += '</tr></thead><tbody>';
                const maxRows = Math.max(...buckets.map(b => b.length));
                for(let r=0; r<maxRows; r++) {
                    html += '<tr>'; for(let d=0; d<=9; d++) { const item = buckets[d][r]; html += item ? `<td style="padding:4px;"><a href="${item.href}">${item.num}</a></td>` : '<td></td>'; } html += '</tr>';
                } html += '</tbody></table>';
                let texto = ''; for(let d=0; d<=9; d++) { if(buckets[d].length) { texto += `--- DÍGITO ${d} ---\n`; buckets[d].forEach(item => texto += `${item.num}\n`); texto += `\n`; } }
                copiarParaClipboard(html, texto);
            };
        };

        const btnSel = document.createElement('button'); btnSel.id = 'eproc-selecionar-paralisados-btn'; btnSel.textContent = "Selecionar Paralisados"; btnSel.type = "button"; alertaDiv.appendChild(btnSel);
        btnSel.onclick = (e) => {
            e.preventDefault(); e.stopPropagation();
            if (totalNovos === 0) { executarSelecao(Array.from(document.querySelectorAll('tr.tr-paralisado'))); return; }
            const overlay = document.createElement('div'); overlay.className = 'eproc-modal-overlay';
            overlay.innerHTML = `<div class="eproc-modal-content" style="width:320px;text-align:center;"><div class="eproc-modal-title">Selecionar Paralisados</div>
                <button id="btn-sel-todos" class="eproc-btn" style="width:100%;margin-bottom:10px;font-weight:bold;">Todos os Paralisados (${totalParalisados})</button>
                <button id="btn-sel-novos" class="eproc-btn eproc-btn-secondary" style="width:100%;margin-bottom:15px;font-weight:bold;">Apenas os Novos (${totalNovos})</button>
                <button id="btn-sel-cancel" class="eproc-btn eproc-btn-danger" style="width:100%;">Cancelar</button></div>`;
            document.body.appendChild(overlay);
            const fechar = () => { if(document.body.contains(overlay)) document.body.removeChild(overlay); };
            document.getElementById('btn-sel-cancel').onclick = fechar;
            document.getElementById('btn-sel-todos').onclick = () => { fechar(); executarSelecao(Array.from(document.querySelectorAll('tr.tr-paralisado'))); };
            document.getElementById('btn-sel-novos').onclick = () => { fechar(); executarSelecao(Array.from(document.querySelectorAll('tr.tr-novo-paralisado'))); };
        };

        function executarSelecao(paralisados) {
            if (!paralisados.length) { alert('Nenhum processo correspondente identificado na tela ainda.'); return; }
            requestAnimationFrame(() => {
                let count = 0;
                paralisados.forEach(tr => {
                    const chk = tr.querySelector('input[type="checkbox"]');
                    if (chk) { if(!chk.checked) chk.click(); tr.style.backgroundColor = '#eef8fa'; tr.style.borderLeft = '4px solid #0081c2'; count++; }
                });
                document.getElementById('eproc-contador').textContent = `Itens selecionados: ${document.querySelectorAll('table tr input[type="checkbox"]:checked').length}`;
                updateNavVisibility();
            });
        }
    }

    // ===========================================================================================
    // PARTE 4: NAVEGAÇÃO FLUTUANTE DE SELEÇÃO
    // ===========================================================================================
    
    let currentNavIndex = -1;

    function updateNavVisibility() {
        const count = document.querySelectorAll('tr[class^="infraTr"] input[type="checkbox"]:checked').length;
        const nav = document.getElementById('eproc-nav-flutuante');
        if (nav) {
            if (count > 0) {
                nav.style.display = 'flex';
            } else {
                nav.style.display = 'none';
                currentNavIndex = -1; 
            }
        }
    }

    function navigateSelection(direction) {
        const checkboxes = getLinhasProcessos().map(tr => tr.querySelector('input[type="checkbox"]:checked')).filter(Boolean);
        if (checkboxes.length === 0) return;

        if (direction === 'down') {
            currentNavIndex++;
            if (currentNavIndex >= checkboxes.length) {
                currentNavIndex = 0;
                mostrarToast("Retornando ao primeiro item");
            }
        } else {
            currentNavIndex--;
            if (currentNavIndex < 0) {
                currentNavIndex = checkboxes.length - 1;
                mostrarToast("Retornando ao último item");
            }
        }

        const tr = checkboxes[currentNavIndex].closest('tr');
        if (tr) {
            tr.scrollIntoView({ behavior: 'smooth', block: 'center' });
            const originalBg = tr.style.backgroundColor;
            tr.style.transition = 'background-color 0.3s';
            tr.style.backgroundColor = '#ffeeba'; 
            setTimeout(() => {
                tr.style.backgroundColor = originalBg;
            }, 800);
        }
    }

    // ===========================================================================================
    // PARTE 5: ASSISTENTES DE DISTRIBUIÇÃO E LÓGICA DE INTERFACE
    // ===========================================================================================
    
    function parseOrigem(textoOrigem) {
        if (!textoOrigem) return null;
        let comarca = "";
        let vara = "ÚNICA"; 

        const matchSigla = textoOrigem.match(/\b([A-Z]{3})\b/);
        if (matchSigla && COMARCAS_MAP[matchSigla[1]]) {
            comarca = COMARCAS_MAP[matchSigla[1]];
        } else {
            for (const [sigla, nome] of Object.entries(COMARCAS_MAP)) {
                if (textoOrigem.toUpperCase().includes(nome.toUpperCase())) { comarca = nome; break; }
            }
        }

        const cleanText = textoOrigem.toUpperCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
        if (!cleanText.includes("UNICA") && !cleanText.includes("ÚNICA")) {
            const matchVara = cleanText.match(/(\d+)[^A-Z]*(JD|UJ|UJU|UNIDADE|VARA|VC|V\.)/);
            if (matchVara) vara = matchVara[1] + "VC"; 
        }

        if (comarca) return { comarca, vara };
        return null;
    }

    function findLocalizadorIdNoDropdown(parsedOrigem) {
        if (!parsedOrigem) return null;
        const options = Array.from(document.querySelectorAll('#selNovoLocalizador option'));
        const searchComarca = parsedOrigem.comarca.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase();
        
        for (let opt of options) {
            const txt = opt.text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase();
            if (txt.includes("NB/JC") && txt.includes(searchComarca)) {
                if (parsedOrigem.vara === "ÚNICA") {
                    if (!txt.match(/\d+VC/)) return opt;
                } else {
                    if (txt.includes(parsedOrigem.vara)) return opt; 
                }
            }
        }
        return null;
    }

    function abrirAssistenteDistribuicao() {
        const painelLoc = document.getElementById('conteudoAlterarLocalizadores');
        if (painelLoc && painelLoc.style.display === 'none') {
            const legendLoc = document.querySelector('#fldAlterarLocalizadores legend');
            if (legendLoc) legendLoc.click();
        }

        const linhas = getLinhasProcessos();
        const grupos = {}; 
        let totalValidos = 0;

        linhas.forEach(linha => {
            const tdOrigem = linha.querySelector('.eproc-col-origem-nucleo');
            const tds = Array.from(linha.querySelectorAll('td'));
            const tdLocalizadores = tds.find(td => td.querySelector('a[href*="localizador_orgao_tooltip"]')) || tds[6]; 
            
            if (!tdOrigem || !tdLocalizadores) return;
            
            const textoOrigem = tdOrigem.innerText.trim();
            const textoLocsAtual = tdLocalizadores.innerText.toUpperCase().replace(/[^A-Z0-9]/g, ''); 
            
            if(textoOrigem === "..." || textoOrigem === "-") return;

            const parsed = parseOrigem(textoOrigem);
            const optTarget = findLocalizadorIdNoDropdown(parsed);

            if (optTarget && optTarget.value !== "null") {
                const targetNameClean = optTarget.text.split('-')[1]?.trim().toUpperCase().replace(/[^A-Z0-9]/g, '') || optTarget.text.toUpperCase().replace(/[^A-Z0-9]/g, '');
                
                if (!textoLocsAtual.includes(targetNameClean)) {
                    const locNameDisplay = optTarget.text;
                    if (!grupos[optTarget.value]) grupos[optTarget.value] = { nome: locNameDisplay, linhas:[] };
                    grupos[optTarget.value].linhas.push(linha);
                    totalValidos++;
                }
            }
        });

        if (totalValidos === 0) {
            alert("Não há processos pendentes de distribuição inteligente na tela atual.\nTodos já possuem localizador ou não foi possível mapear a origem.");
            return;
        }

        mostrarModalAgrupado(grupos, "Vara de Origem");
    }

    function findLocalizadorDigito(digito) {
        const options = Array.from(document.querySelectorAll('#selNovoLocalizador option'));
        const searchStr = `DÍGITO ${digito}`;
        const searchStrSemAcento = `DIGITO ${digito}`;
        for (let opt of options) {
            const txt = opt.text.toUpperCase();
            if (txt.includes(searchStr) || txt.includes(searchStrSemAcento)) {
                return opt;
            }
        }
        return null;
    }

    function abrirAssistenteDistribuicaoDigitos() {
        const linhas = getLinhasProcessos();
        const processosPendentes =[]; 

        linhas.forEach(linha => {
            const linkProc = linha.querySelector('a[href*="acao=processo_selecionar"]');
            if (!linkProc) return;
            const matchProc = linkProc.innerText.match(/(\d)-/);
            if (!matchProc) return;
            const digitoProcesso = matchProc[1];

            const tds = Array.from(linha.querySelectorAll('td'));
            const tdLocalizadores = tds.find(td => td.querySelector('a[href*="localizador_orgao_tooltip"]')) || tds[6]; 
            if (!tdLocalizadores) return;
            
            const locsText = tdLocalizadores.innerText.toUpperCase();
            const regexLocCorreto = new RegExp(`D[IÍ]GITO\\s*${digitoProcesso}`, 'i');
            
            if (!regexLocCorreto.test(locsText)) {
                const optTarget = findLocalizadorDigito(digitoProcesso);
                if (optTarget && optTarget.value !== "null") {
                    processosPendentes.push({
                        linha: linha,
                        digito: digitoProcesso,
                        optTarget: optTarget,
                        nomeTarget: optTarget.text.split('-')[1]?.trim() || optTarget.text
                    });
                }
            }
        });

        if (processosPendentes.length === 0) {
            alert("Não há processos pendentes de distribuição por dígito na tela atual.\nTodos já possuem o localizador de dígito correto ou os localizadores não foram carregados nas opções.");
            return;
        }

        mostrarSelecaoDeDigito(processosPendentes);
    }

    function mostrarSelecaoDeDigito(processosPendentes) {
        const overlay = document.createElement('div');
        overlay.className = 'eproc-modal-overlay';
        
        let botoesDigitos = '';
        for (let i = 0; i <= 9; i++) {
            const count = processosPendentes.filter(p => p.digito === String(i)).length;
            botoesDigitos += `<button class="eproc-btn eproc-btn-filtro-padrao" style="width:48px; height:48px; margin:4px; font-size:16px; font-weight:bold; position:relative;" onclick="window.processarDistribuicaoDigito('${i}')">
                ${i}
                ${count > 0 ? `<span style="position:absolute; top:-5px; right:-5px; background:red; color:white; border-radius:50%; font-size:10px; width:18px; height:18px; line-height:18px;">${count}</span>` : ''}
            </button>`;
        }

        overlay.innerHTML = `
            <div class="eproc-modal-content" style="width: 320px; text-align:center;">
                <div class="eproc-modal-title">🪄 Distribuição por Dígitos</div>
                <p style="font-size:12px; color:#666; margin-bottom:15px;">Selecione o dígito que deseja distribuir:</p>
                <div style="display:flex; flex-wrap:wrap; justify-content:center; margin-bottom:15px;">
                    ${botoesDigitos}
                </div>
                <button class="eproc-btn eproc-btn-secondary" style="width:100%; margin-bottom:10px; font-weight:bold;" onclick="window.processarDistribuicaoDigito('todos')">Todos os dígitos pendentes (${processosPendentes.length})</button>
                <button class="eproc-btn eproc-btn-danger" style="width:100%;" onclick="document.body.removeChild(this.closest('.eproc-modal-overlay'))">Cancelar</button>
            </div>
        `;

        window.processarDistribuicaoDigito = function(filtroDigito) {
            document.body.removeChild(overlay);
            
            const filtrados = filtroDigito === 'todos' 
                ? processosPendentes 
                : processosPendentes.filter(p => p.digito === filtroDigito);

            if (filtrados.length === 0) {
                alert(`Nenhum processo pendente para o dígito ${filtroDigito} nesta página.`);
                return;
            }

            const grupos = {};
            filtrados.forEach(p => {
                if (!grupos[p.optTarget.value]) grupos[p.optTarget.value] = { nome: p.nomeTarget, linhas:[] };
                grupos[p.optTarget.value].linhas.push(p.linha);
            });

            if (filtroDigito === 'todos') {
                mostrarModalAgrupado(grupos, "Dígito");
            } else {
                const targetValue = Object.keys(grupos)[0];
                const linhasAlvo = grupos[targetValue].linhas;

                const painelLoc = document.getElementById('conteudoAlterarLocalizadores');
                if (painelLoc && painelLoc.style.display === 'none') {
                    const legendLoc = document.querySelector('#fldAlterarLocalizadores legend');
                    if (legendLoc) legendLoc.click();
                }

                if (typeof infraSelecionarTodos === 'function') infraSelecionarTodos(false);
                else document.querySelectorAll('table tr input[type="checkbox"]:checked').forEach(c => c.click());
                
                document.querySelectorAll('tr[style*="background-color"]').forEach(tr => { tr.style.backgroundColor=''; tr.style.borderLeft=''; });

                requestAnimationFrame(() => {
                    let count = 0;
                    linhasAlvo.forEach(tr => {
                        const chk = tr.querySelector('input[type="checkbox"]');
                        if (chk && !chk.checked) {
                            chk.click(); 
                            tr.style.backgroundColor = '#eef8fa';
                            tr.style.borderLeft = '4px solid #0081c2';
                            count++;
                        }
                    });
                    
                    document.getElementById('eproc-contador').textContent = `Itens selecionados: ${count}`;
                    updateNavVisibility();
                    
                    setTimeout(() => {
                        const btnDesmarcar = document.getElementById('lblLocDesDesmarcarTodos');
                        if (btnDesmarcar) {
                            btnDesmarcar.click();
                        } else {
                            const selectDesativarLoc = document.getElementById('selLocalizadorDesativar');
                            if (selectDesativarLoc) {
                                Array.from(selectDesativarLoc.options).forEach(opt => opt.selected = false);
                                selectDesativarLoc.dispatchEvent(new Event('change'));
                            }
                        }

                        const selectNovoLoc = document.getElementById('selNovoLocalizador');
                        if (selectNovoLoc) {
                            selectNovoLoc.value = targetValue;
                            selectNovoLoc.dispatchEvent(new Event('change'));
                            if(typeof $ !== 'undefined' && $(selectNovoLoc).hasClass('selectpicker')){
                                $(selectNovoLoc).selectpicker('refresh');
                            }
                        }

                        mostrarToast(`Pronto! Clique em "Alterar Localizador" nas Ações.`);
                        document.getElementById('fldAcoes')?.scrollIntoView({behavior: "smooth", block: "center"});
                    }, 50);
                });
            }
        };

        document.body.appendChild(overlay);
    }

    function mostrarModalAgrupado(grupos, tipo) {
        const painelLoc = document.getElementById('conteudoAlterarLocalizadores');
        if (painelLoc && painelLoc.style.display === 'none') {
            const legendLoc = document.querySelector('#fldAlterarLocalizadores legend');
            if (legendLoc) legendLoc.click();
        }

        const overlay = document.createElement('div');
        overlay.className = 'eproc-modal-overlay';
        
        let htmlBotoes = '';
        Object.keys(grupos).forEach(val => {
            const grp = grupos[val];
            htmlBotoes += `
                <div style="border: 1px solid #eee; padding: 10px; border-radius: 4px; margin-bottom: 10px; background-color: #fcfcfc;">
                    <div style="font-weight: bold; color: #333; font-size: 13px; margin-bottom: 5px;">${grp.nome}</div>
                    <div style="font-size: 11px; color: #777; margin-bottom: 8px;">Processos sem este localizador: <b>${grp.linhas.length}</b></div>
                    <button class="eproc-btn eproc-btn-secondary" style="width:100%; font-size:11px; border-color:#0081c2;" onclick="window.aplicarDistribuicaoGrupoGenerico('${val}')">Distribuir para este Localizador</button>
                </div>
            `;
        });

        overlay.innerHTML = `
            <div class="eproc-modal-content" style="width: 420px; max-height: 85vh; overflow-y: auto;">
                <div class="eproc-modal-title">🪄 Distribuição Inteligente por ${tipo}</div>
                <p style="font-size:12px; color:#666; margin-bottom:15px;">Processos filtrados e agrupados. Os que já possuem o localizador correto foram ignorados.</p>
                <div style="padding-right:5px; margin-bottom:15px;">
                    ${htmlBotoes}
                </div>
                <button class="eproc-btn eproc-btn-danger" style="width:100%;" onclick="document.body.removeChild(this.closest('.eproc-modal-overlay'))">Sair</button>
            </div>
        `;

        window.aplicarDistribuicaoGrupoGenerico = function(targetValue) {
            const linhasAlvo = grupos[targetValue].linhas;

            if (typeof infraSelecionarTodos === 'function') infraSelecionarTodos(false);
            else document.querySelectorAll('table tr input[type="checkbox"]:checked').forEach(c => c.click());
            
            document.querySelectorAll('tr[style*="background-color"]').forEach(tr => { tr.style.backgroundColor=''; tr.style.borderLeft=''; });

            requestAnimationFrame(() => {
                let count = 0;
                linhasAlvo.forEach(tr => {
                    const chk = tr.querySelector('input[type="checkbox"]');
                    if (chk && !chk.checked) {
                        chk.click(); 
                        tr.style.backgroundColor = '#eef8fa';
                        tr.style.borderLeft = '4px solid #0081c2';
                        count++;
                    }
                });
                
                document.getElementById('eproc-contador').textContent = `Itens selecionados: ${count}`;
                updateNavVisibility();
                
                setTimeout(() => {
                    const btnDesmarcar = document.getElementById('lblLocDesDesmarcarTodos');
                    if (btnDesmarcar) {
                        btnDesmarcar.click();
                    } else {
                        const selectDesativarLoc = document.getElementById('selLocalizadorDesativar');
                        if (selectDesativarLoc) {
                            Array.from(selectDesativarLoc.options).forEach(opt => opt.selected = false);
                            selectDesativarLoc.dispatchEvent(new Event('change'));
                        }
                    }

                    const selectNovoLoc = document.getElementById('selNovoLocalizador');
                    if (selectNovoLoc) {
                        selectNovoLoc.value = targetValue;
                        selectNovoLoc.dispatchEvent(new Event('change'));
                        if(typeof $ !== 'undefined' && $(selectNovoLoc).hasClass('selectpicker')){
                            $(selectNovoLoc).selectpicker('refresh');
                        }
                    }

                    document.body.removeChild(overlay);
                    mostrarToast(`Pronto! Clique em "Alterar Localizador" nas Ações.`);
                    document.getElementById('fldAcoes')?.scrollIntoView({behavior: "smooth", block: "center"});
                }, 50);
            });
        };

        document.body.appendChild(overlay);
    }

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

                if (isNovoVazio) {
                    if (hasDesativar) {
                        if (typeof window.validarSelecao === 'function') {
                            window.validarSelecao();
                        } else {
                            alert('Erro: Função nativa de exclusão do EPROC não foi encontrada.');
                        }
                    } else {
                        alert('Informe o novo localizador ou selecione localizadores atuais para excluir.');
                        if (novoLoc) novoLoc.focus();
                    }
                } else {
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
            d.innerHTML = `<input type="radio" name="paginacao" id="optPaginacao500" value="500" class="infraRadio mr-2"><label for="optPaginacao500" class="infraRadio mr-2">500 processos por página</label><br>
                           <input type="radio" name="paginacao" id="optPaginacao1000" value="1000" class="infraRadio mr-2"><label for="optPaginacao1000" class="infraRadio mr-2">1000 processos por página</label>`;
            div.appendChild(d);

            const prefPag = localStorage.getItem(LS_KEY_PAGINACAO);
            if (prefPag === '1000') document.getElementById('optPaginacao1000').checked = true;
            if (prefPag === '500') document.getElementById('optPaginacao500').checked = true;

            document.querySelectorAll('input[name="paginacao"]').forEach(r => r.addEventListener('change', e => {
             localStorage.setItem(LS_KEY_PAGINACAO, e.target.value);
             document.cookie = `paginacao=${e.target.value};path=/;max-age=3600`;
        }));
        }

        function validarIntervaloData(linha, dtInicio, dtFim) {
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

        function verificarPendenciasReais() {
            let pendentes = 0;
            const linhas = getLinhasProcessos();

            linhas.forEach(tr => {
                const temCheckbox = tr.querySelector('input[type="checkbox"]');
                const temLink = tr.querySelector('a[href*="acao=processo_selecionar"]');
                if (!temCheckbox && !temLink) return;

                const td = tr.querySelector('.eproc-col-data-nucleo');
                if (!td) { pendentes++; return; }
                const texto = td.innerText.trim();
                const temSpinner = td.querySelector('.eproc-spinner');
                const statusAtivo = tr.getAttribute('data-nucleo-status');

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

        function aplicarFiltros() {
            const inicioVal = document.getElementById('eproc-data-inicio').value;
            const fimVal = document.getElementById('eproc-data-fim').value;
            const temFiltros = estadoFiltros.length > 0;
            const temData = inicioVal !== '' || fimVal !== '';

            if (!temFiltros && !temData) {
                limparSelecao();
                return;
            }

            const dtInicio = inicioVal ? new Date(inicioVal + 'T00:00:00') : null;
            const dtFim = fimVal ? new Date(fimVal + 'T00:00:00') : null;

            const filtrosOtimizados = estadoFiltros.map(f => ({
                ...f,
                valorUpper: f.valor.toUpperCase()
            }));

            const updates =[];
            const linhas = getLinhasProcessos();

            let count = 0;

            linhas.forEach(linha => {
                const chk = linha.querySelector('input[type="checkbox"]');
                if (!chk || chk.disabled) return; 

                if (!validarIntervaloData(linha, dtInicio, dtFim)) {
                     updates.push({ tr: linha, chk: chk, select: false });
                     return;
                }

                let passouTodosFiltros = true;
                if (temFiltros) {
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

            requestAnimationFrame(() => {
                updates.forEach(up => {
                    if (up.select) {
                        if (!up.chk.checked) up.chk.click();
                        up.tr.style.backgroundColor = '#eef8fa';
                        up.tr.style.borderLeft = '4px solid #0081c2';
                    } else {
                        if (up.chk.checked) up.chk.click();
                        up.tr.style.backgroundColor = '';
                        up.tr.style.borderLeft = '';
                    }
                });

                document.getElementById('eproc-contador').textContent = `Itens selecionados: ${count}`;
                updateNavVisibility();
            });
        }

        function selecionar(termo) {
            addFiltro('texto', termo, termo);
            aplicarFiltros();
        }

        function limparSelecao() {
            try {
                if (typeof infraSelecionarTodos === 'function') {
                    infraSelecionarTodos(false);
                } else {
                    const checkboxes = document.querySelectorAll('table tr input[type="checkbox"]:checked');
                    for (let i = 0; i < checkboxes.length; i++) {
                        checkboxes[i].click();
                    }
                }
            } catch (e) {
                const checkboxes = document.querySelectorAll('table tr input[type="checkbox"]:checked');
                for (let i = 0; i < checkboxes.length; i++) {
                    checkboxes[i].click();
                }
            }

            requestAnimationFrame(() => {
                const linhas = document.querySelectorAll('tr[style*="background-color"]');
                for (let i = 0; i < linhas.length; i++) {
                    linhas[i].style.backgroundColor = '';
                    linhas[i].style.borderLeft = '';
                }
                document.getElementById('eproc-contador').textContent = "Itens selecionados: 0";
                updateNavVisibility();
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
                    aplicarFiltros();
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

                <div id="eproc-toast">Processos copiados!</div>

                <div class="eproc-row" style="justify-content: space-between;">
                   <div style="display:flex; gap:10px; align-items:center;">
                        
                        <button id="eproc-dist-magica" type="button" class="eproc-btn eproc-btn-filtro-padrao eproc-btn-icon" title="Distribuição Inteligente por Vara de origem" style="margin-right: 5px;">
                            <svg viewBox="0 0 24 24" width="18" height="18"><path d="M21.41 11.58l-9-9C12.05 2.22 11.55 2 11 2H4c-1.1 0-2 .9-2 2v7c0 .55.22 1.05.59 1.41l9 9c.36.36.86.58 1.41.58.55 0 1.05-.22 1.41-.59l7-7c.37-.36.59-.86.59-1.41 0-.55-.23-1.06-.59-1.41zM5.5 7C4.67 7 4 6.33 4 5.5S4.67 4 5.5 4 7 4.67 7 5.5 6.33 7 5.5 7z"/></svg>
                        </button>
                        
                        <button id="eproc-dist-digito" type="button" class="eproc-btn eproc-btn-filtro-padrao eproc-btn-icon" title="Distribuição Inteligente de Dígitos" style="margin-right: 15px;">
                            <svg viewBox="0 0 24 24" width="18" height="18">
                                <text x="50%" y="60%" dominant-baseline="middle" text-anchor="middle" font-size="20" font-family="Arial, sans-serif" font-weight="bold" fill="currentColor">#</text>
                            </svg>
                        </button>

                        <span style="font-weight:bold;font-size:12px; margin-bottom:0; display:flex; align-items:center;">Fonte:</span>
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
                    <button id="eproc-copy-btn" class="eproc-btn eproc-btn-secondary eproc-btn-icon" title="Copiar Selecionados">
                        <svg viewBox="0 0 24 24" width="16" height="16"><path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z"/></svg>
                    </button>
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
                form.insertBefore(div, localDiv.nextSibling);
            } else {
                form.insertBefore(div, form.firstChild);
            }
            renderizarBotoes();
            aplicarHackPaginacao();

            // Adiciona o container flutuante
            const navDiv = document.createElement('div');
            navDiv.id = 'eproc-nav-flutuante';
            navDiv.innerHTML = `
                <button id="eproc-nav-up" class="eproc-nav-btn" title="Ir para seleção anterior">
                    <svg viewBox="0 0 24 24"><path d="M7.41 15.41L12 10.83l4.59 4.58L18 14l-6-6-6 6z"/></svg>
                </button>
                <button id="eproc-nav-down" class="eproc-nav-btn" title="Ir para próxima seleção">
                    <svg viewBox="0 0 24 24"><path d="M7.41 8.59L12 13.17l4.59-4.58L18 10l-6 6-6-6z"/></svg>
                </button>
            `;
            document.body.appendChild(navDiv);

            document.getElementById('eproc-nav-up').onclick = (e) => { e.preventDefault(); navigateSelection('up'); };
            document.getElementById('eproc-nav-down').onclick = (e) => { e.preventDefault(); navigateSelection('down'); };

            // EVENT LISTENERS
            document.getElementById('eproc-dist-magica').onclick = (e) => { e.preventDefault(); abrirAssistenteDistribuicao(); };
            document.getElementById('eproc-dist-digito').onclick = (e) => { e.preventDefault(); abrirAssistenteDistribuicaoDigitos(); };

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

            document.getElementById('eproc-copy-btn').onclick = (e) => {
                e.preventDefault();
                const selecionados = document.querySelectorAll('tr[class^="infraTr"] input[type="checkbox"]:checked');
                if (selecionados.length === 0) return;
                let html = '<ul>';
                let texto = '';
                selecionados.forEach(chk => {
                    const tr = chk.closest('tr');
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

            document.getElementById('eproc-rel-tramitacao-btn').onclick = (e) => {
                e.preventDefault();
                const linhas = getLinhasProcessos();
                const dados =[];
                const hoje = new Date();
                hoje.setHours(0,0,0,0);

                linhas.forEach(tr => {
                    const linkProc = tr.querySelector('a[href*="acao=processo_selecionar"]');
                    const tdData = tr.querySelector('.eproc-col-data-nucleo');
                    if (linkProc && tdData) {
                        const numProc = linkProc.innerText.trim();
                        const hrefProc = linkProc.href;
                        const dataTexto = tdData.innerText.trim();
                        const dataObj = obterDataSegura(dataTexto);
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

            const originalSubmit = form.submit;
            form.submit = function() {
                const tabela = document.getElementById('tabelaLocalizadores') || document.querySelector('.infraTable');
                if (tabela) {
                    const linhas = tabela.querySelectorAll('tr[class^="infraTr"]');
                    if (linhas.length > 50) {
                        linhas.forEach(tr => {
                            const chk = tr.querySelector('input[type="checkbox"]');
                            if (chk && !chk.checked) {
                                tr.querySelectorAll('input').forEach(inp => inp.disabled = true);
                                tr.querySelectorAll('select').forEach(sel => sel.disabled = true);
                            }
                        });
                    }
                }
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
                
                // Mutações para acender as setas de navegação quando clicar nativamente também
                const tab = document.getElementById('tabelaLocalizadores') || document.querySelector('.infraTable');
                if (tab) {
                    tab.addEventListener('change', (e) => {
                        if(e.target && e.target.type === 'checkbox') updateNavVisibility();
                    });
                }
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
