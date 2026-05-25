// ==UserScript==
// @name         EPROC 4.0
// @namespace    http://tampermonkey.net/
// @version      47.2
// @description  Seleções inteligentes e Complementos ao sistema EPROC + Auto Checkboxes
// @author       Allison de Castro Silva
// @match        https://eproc1g.tjmg.jus.br/eproc/*
// @updateURL    https://github.com/AllisondeCastro/Eproc-4.0/raw/refs/heads/main/EPROC%204.0.user.js
// @downloadURL  https://github.com/AllisondeCastro/Eproc-4.0/raw/refs/heads/main/EPROC%204.0.user.js
// @grant        none
// @run-at       document-end
// ==/UserScript==

(function() {
    'use strict';

    // ===========================================================================================
    // PREVENÇÃO E LIMPEZA AUTOMÁTICA GERAL
    // ===========================================================================================
    try {
        const timerStrGlobal = localStorage.getItem('eproc_tramitacao_time');
        if (timerStrGlobal && Date.now() - parseInt(timerStrGlobal) > 12 * 60 * 60 * 1000) {
            localStorage.removeItem('eproc_tramitacao_saved');
            localStorage.removeItem('eproc_tramitacao_time');
        }
    } catch(e) {}

    // ===========================================================================================
    // DETECTOR DE TELA DE ERRO (SOBRECARGA DO SERVIDOR)
    // ===========================================================================================
    if (document.body && document.body.textContent.includes("Ocorreu um erro nesta operação!")) {
        alert("⚠️ ERRO DE SOBRECARGA NO EPROC:\n\nO servidor do Tribunal não aguentou processar o volume de dados que você enviou.\n\nDICA MÁGICA: Clique no botão 'Voltar' do seu navegador (suas caixinhas selecionadas continuarão marcadas), desmarque alguns processos e envie em um lote menor.");
        return;
    }

    // ===========================================================================================
    // CONFIGURAÇÕES & CONSTANTES
    // ===========================================================================================
    const TEXTO_ALVO_1 = "Remetidos os Autos (outros motivos) para Núcleo 4.0";
    const TEXTO_ALVO_2 = "Núcleo 4.0";

    const DB_NAME = "EprocCacheDB";
    const DB_VERSION = 2;
    const STORE_NAME = "processos";
    const STORE_PARALISADOS = "paralisados_vistos";
    const EXPIRATION_DAYS = 150;

    const LS_KEY_BOTOES = "eproc_botoes_personalizados";
    const LS_KEY_ORDEM = "eproc_ordem_botoes";
    const LS_KEY_PAGINACAO = "eproc_paginacao_pref";
    const LS_KEY_SORT = "eproc_sort_pref";

    const BUCKET_CAPACITY = 25;
    const TOKENS_PER_SECOND = 5;
    const MAX_CONCURRENCY = 25;

    const paralisadosNovosSessao = new Set();
    const regexData = /^\d{2}\/\d{2}\/\d{4}$/;

    let modoApenasSelecionados = false;

    function getLinhasProcessos() {
        const tabela = document.getElementById('tabelaLocalizadores') || document.querySelector('.infraTable');
        if (!tabela) return[];
        const linhas =[];
        const tbody = tabela.tBodies[0] || tabela;
        for (let i = 0; i < tbody.rows.length; i++) {
            const tr = tbody.rows[i];
            if (tr.cells.length > 0 && tr.cells[0].tagName !== 'TH') {
                linhas.push(tr);
            }
        }
        return linhas;
    }

    function removerAcentos(str) {
        if (!str) return "";
        return str.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    }

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
    // PARTE 1: ESTILOS
    // ===========================================================================================
    const style = document.createElement('style');
    style.innerHTML = `
        @import url('https://fonts.googleapis.com/css2?family=Roboto:wght@400;700&display=swap');

        #tabelaLocalizadores tbody tr { contain: content; }
        #tabelaLocalizadores { width: 100% !important; table-layout: auto !important; border-collapse: collapse !important; }
        #tabelaLocalizadores > tbody > tr > th, #tabelaLocalizadores > tbody > tr > td { padding: 5px 4px !important; vertical-align: middle !important; }
        #tabelaLocalizadores tbody { contain: content; }

        .eproc-col-p1 { min-width: 180px !important; white-space: normal !important; word-wrap: break-word !important; }
        .eproc-col-p2 { min-width: 100px !important; max-width: 220px !important; white-space: normal !important; word-wrap: break-word !important; }
        .eproc-col-p3 { min-width: 60px !important; max-width: 180px !important; white-space: nowrap !important; overflow: hidden !important; text-overflow: ellipsis !important; }
        .eproc-col-p3-wrap { min-width: 60px !important; max-width: 180px !important; white-space: normal !important; word-wrap: break-word !important; }
        .eproc-col-compact { width: 1px !important; white-space: nowrap !important; }

        .eproc-col-data-nucleo, .th-nucleo-40 { width: 1px !important; white-space: nowrap !important; text-align: center; }
        .eproc-col-origem-nucleo, .th-nucleo-origem { width: 1px !important; white-space: nowrap !important; text-align: center; max-width: 150px !important; overflow: hidden !important; text-overflow: ellipsis !important; }

        .eproc-col-data-nucleo { font-family: 'Calibri', sans-serif !important; font-size: 11pt !important; color: #000 !important; }
        .eproc-col-origem-nucleo { font-family: 'Calibri', sans-serif !important; font-size: 10pt !important; color: #444 !important; }
        .th-nucleo-40, .th-nucleo-origem { font-family: 'Calibri', sans-serif !important; font-size: 11pt !important; color: #000 !important; text-align: center !important; cursor: pointer; background-color: #f0f0f2 !important; }
        .th-nucleo-40:hover, .th-nucleo-origem:hover { background-color: #e2e2e5 !important; }

        .eproc-spinner { border: 2px solid #f3f3f3; border-top: 2px solid #0081c2; border-radius: 50%; width: 12px; height: 12px; animation: spin 0.8s linear infinite; display: inline-block; vertical-align: middle; }
        @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }

        tr.tr-paralisado, tr.tr-paralisado > td { background-color: #ffe6e6 !important; }
        .tr-paralisado td { color: #a94442 !important; }

        #eproc-alerta-paralisado { background-color: #d9534f; color: #fff; font-weight: bold; text-transform: uppercase; text-align: center; padding: 10px; margin-bottom: 15px; border-radius: 4px; display: none; box-shadow: 0 2px 5px rgba(217, 83, 79, 0.4); align-items: center; justify-content: center; gap: 15px; flex-wrap: wrap; }
        .eproc-badge-novo { background-color: #f39c12; color: #fff; padding: 4px 10px; border-radius: 12px; font-size: 11px; font-weight: bold; border: 1px solid #e67e22; box-shadow: 0 1px 3px rgba(0,0,0,0.1); display: inline-block; vertical-align: middle; text-transform: none; }

        .eproc-btn-icon { width: 34px !important; padding: 6px 0 !important; text-align: center; margin-left: 5px; font-size: 16px !important; line-height: 1 !important; display: inline-flex !important; justify-content: center; align-items: center; }
        .eproc-btn-icon svg { fill: currentColor; }

        #eproc-relatorio-btn, #eproc-selecionar-paralisados-btn { background-color: #fff; color: #d9534f; border: 1px solid #fff; padding: 4px 12px; font-size: 11px; border-radius: 4px; cursor: pointer; font-weight: normal; font-family: 'Roboto', Arial, sans-serif; text-transform: none; margin-left: 10px; transition: all 0.2s; }
        #eproc-relatorio-btn:hover, #eproc-selecionar-paralisados-btn:hover { background-color: #f8f8f8; color: #c9302c; }

        #eproc-toast { position: fixed; bottom: 20px; left: 50%; transform: translateX(-50%); background-color: #4cae4c; color: white; padding: 10px 25px; border-radius: 4px; box-shadow: 0 2px 10px rgba(0,0,0,0.2); font-weight: bold; font-size: 14px; z-index: 99999; opacity: 0; pointer-events: none; transition: opacity 0.3s; }
        #eproc-toast.show { opacity: 1; }

        #eproc-seletor { border: 1px solid #ccc !important; border-radius: 6px; padding: 15px; margin: 10px 0 20px 0; width: 100%; box-sizing: border-box; background-color: #fff; font-family: Arial, Helvetica, sans-serif; box-shadow: 0 1px 2px rgba(0,0,0,0.05); transition: background-color 0.3s, border-color 0.3s; position: relative; }
        .eproc-legend { font-size: 1.2em; font-weight: bold; color: #000; margin-bottom: 15px; border-bottom: 1px solid #eee; padding-bottom: 8px; display: block; width: 100%; }
        .eproc-row { display: flex; flex-wrap: wrap; gap: 12px; align-items: center; margin-bottom: 12px; }
        .eproc-form-control { border: 1px solid #ccc; padding: 6px 8px; font-size: 13px; border-radius: 4px; color: #333; }

        .eproc-btn { display: inline-block; padding: 6px 12px; font-size: 13px; font-weight: normal; font-family: 'Roboto', Arial, sans-serif; text-align: center; cursor: pointer; border: 1px solid #ccc; border-radius: 6px !important; background: #fff; color: #0081c2; box-shadow: 0 1px 3px rgba(0,0,0,0.1); transition: all 0.2s; }
        .eproc-btn:hover { background-color: #eef8fa; border-color: #bbb; }

        .eproc-btn-secondary { background: #fff !important; color: #0081c2; }
        .eproc-btn-secondary:hover { background-color: #eef8fa !important; border-color: #bbb; }
        .eproc-btn-danger { background: #fff !important; color: #d9534f; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
        .eproc-btn-danger:hover { background-color: #d9534f !important; color: #fff; border-color: #d9534f; }
        .eproc-btn-success { background-image: linear-gradient(to bottom, #5cb85c 0, #419641 100%); border-color: #4cae4c; color: #fff; }

        #eproc-buscar { background-color: #0081c2 !important; color: #fff !important; border: 1px solid #006ba0 !important; font-family: 'Roboto', Arial, sans-serif !important; font-size: 14px !important; font-weight: normal !important; background-image: none !important; padding: 6px 16px !important; border-radius: 4px !important; box-shadow: 0 1px 3px rgba(0,0,0,0.15) !important; }
        #eproc-buscar:hover { background-color: #006ba0 !important; border-color: #005580 !important; cursor: pointer; }

        #eproc-add-btn:hover { background-color: #eef8fa !important; border-color: #bbb !important; color: #0081c2 !important; background-image: none !important; }
        .eproc-btn-filtro-padrao { background: #fff !important; color: #0081c2 !important; font-weight: normal !important; font-family: 'Roboto', Arial, sans-serif !important; background-image: none !important; box-shadow: 0 1px 3px rgba(0,0,0,0.1) !important; }
        .eproc-btn-filtro-padrao:hover { background-color: #eef8fa !important; border-color: #bbb !important; }

        #eproc-criterios-lista { display: flex; flex-wrap: wrap; gap: 6px; min-height: 20px; align-items: center; }

        .eproc-tag { background-color: #fff !important; color: #0081c2 !important; border: 1px solid #0081c2 !important; border-radius: 6px !important; padding: 4px 26px 4px 10px !important; font-size: 11px !important; display: inline-flex !important; align-items: center; font-weight: 600 !important; cursor: default; position: relative !important; height: 24px; box-sizing: border-box; transition: all 0.2s; }
        .eproc-tag-negativo { border-color: #d9534f !important; color: #d9534f !important; }
        .eproc-tag-close { position: absolute !important; right: 8px !important; top: 50% !important; transform: translateY(-50%) !important; cursor: pointer !important; font-weight: bold !important; color: inherit !important; font-size: 14px !important; opacity: 0.2; transition: all 0.2s !important; line-height: 1 !important; pointer-events: auto !important; }

        .eproc-tag:hover .eproc-tag-close { opacity: 0.6; }
        .eproc-tag-close:hover { opacity: 1 !important; color: #d9534f !important; }

        #eproc-feedback { margin-top: 15px; display: none; text-align: center; position: relative; min-height: 40px; opacity: 0; transition: opacity 0.3s ease-in-out; }
        .eproc-feedback-glass { background: rgba(255, 255, 255, 0.95); border: 1px solid #e0e0e0; border-radius: 30px; padding: 8px 22px; display: inline-flex; align-items: center; gap: 12px; box-shadow: 0 4px 15px rgba(0,0,0,0.08); }
        .eproc-pulse { width: 9px; height: 9px; background-color: #0081c2; border-radius: 50%; animation: pulse-blue 1.5s infinite; }
        @keyframes pulse-blue { 0% { box-shadow: 0 0 0 0 rgba(0, 129, 194, 0.7); } 70% { box-shadow: 0 0 0 12px rgba(0, 129, 194, 0); } 100% { box-shadow: 0 0 0 0 rgba(0, 129, 194, 0); } }

        #eproc-contador { text-align: right; color: #777; font-size: 13px; margin-top: 5px; white-space: nowrap; }

        #eproc-reo-btn:hover { background-color: #eef8fa !important; border-color: #bbb !important; color: #0081c2 !important; background-image: none !important; text-shadow: 0 0 1px currentColor; }

        .eproc-btn-group { display: inline-flex; vertical-align: middle; transition: transform 0.2s; margin-right: 0px; }
        .eproc-btn-group.reorder-mode { cursor: move; animation: pulse 0.5s infinite; }
        .eproc-btn-custom { position: relative; padding-right: 28px !important; border-radius: 6px !important; }
        .eproc-btn-custom-x { position: absolute; right: 8px; top: 50%; transform: translateY(-50%); color: #555; opacity: 0.2; font-weight: bold; transition: all 0.2s; font-size: 14px; line-height: 1; pointer-events: auto; cursor: pointer; }
        .eproc-btn-custom:hover .eproc-btn-custom-x { opacity: 0.6; }
        .eproc-btn-custom .eproc-btn-custom-x:hover { opacity: 1; color: #d9534f; }
        @keyframes pulse { 0% { transform: scale(1); } 50% { transform: scale(1.05); } 100% { transform: scale(1); } }

        .eproc-modal-overlay { position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.5); z-index: 10000; display: flex; justify-content: center; align-items: center; }
        .eproc-modal-content { background: #fff; padding: 20px; border-radius: 6px; width: 320px; box-shadow: 0 4px 15px rgba(0,0,0,0.3); font-family: Arial, sans-serif; border: 1px solid #ccc; max-height: 90vh; overflow-y: auto; }
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
        .eproc-btn-magic:hover { background-image: none; background-color: #e67e22; color: #fff; border-color: #d35400; }
        .eproc-dist-item { border: 1px solid #eee; padding: 10px; border-radius: 4px; margin-bottom: 10px; background-color: #fcfcfc; }
        .eproc-dist-title { font-weight: bold; color: #333; font-size: 13px; margin-bottom: 5px; }
        .eproc-dist-count { font-size: 11px; color: #777; margin-bottom: 8px; }

        #eproc-nav-flutuante { position: fixed; right: 15px; top: 50%; transform: translateY(-50%); display: none; flex-direction: column; gap: 8px; z-index: 9998; opacity: 0.4; transition: opacity 0.3s ease; }
        #eproc-nav-flutuante:hover { opacity: 1; }
        .eproc-nav-btn { width: 28px; height: 28px; border-radius: 50%; background-color: #fff; border: 1px solid #ccc; box-shadow: 0 2px 4px rgba(0,0,0,0.1); cursor: pointer; display: flex; justify-content: center; align-items: center; color: #666; outline: none; }
        .eproc-nav-btn:hover { background-color: #f8f8f8; color: #333; }
        .eproc-nav-btn svg { fill: currentColor; width: 18px; height: 18px; }

        .eproc-toggle-btn { display: inline-flex; align-items: center; background: #eee; border: 1px solid #ccc; border-radius: 14px; cursor: pointer; padding: 2px; position: relative; width: 64px; height: 28px; user-select: none; box-sizing: border-box; }
        .eproc-toggle-btn span { z-index: 1; flex: 1; text-align: center; font-size: 11px; font-weight: bold; color: #777; transition: color 0.3s; pointer-events: none; }
        .eproc-toggle-btn span.active { color: #fff; }
        .eproc-toggle-slider { position: absolute; top: 1px; left: 1px; width: 30px; height: 24px; background: #0081c2; border-radius: 12px; transition: transform 0.3s cubic-bezier(0.25, 0.8, 0.25, 1); box-sizing: border-box; }
        .eproc-toggle-btn.mode-ou .eproc-toggle-slider { transform: translateX(30px); background: #5bc0de; }

        /* ================= DESIGN PROFISSIONAL V2 ================= */
        .eproc-modal-title-modern { font-size: 16px; font-weight: bold; color: #333; display: flex; align-items: center; gap: 10px; margin-bottom: 15px; padding: 10px; background: #f8f9fa; border-radius: 6px; border: 1px solid #eee; }
        .icon-svg { fill: #0081c2; width: 22px; height: 22px; flex-shrink: 0; }

        .eproc-segmented-control { display: inline-grid; grid-auto-flow: column; grid-auto-columns: 1fr; position: relative; z-index: 1; background-color: #f0f0f2; border-radius: 6px; padding: 3px; border: 1px solid #ddd; }
        .eproc-segmented-control label { display: flex; align-items: center; justify-content: center; text-align: center; padding: 5px 0; width: 100px; font-size: 12px; cursor: pointer; border-radius: 4px; color: #666; transition: color 0.2s ease; margin: 0 !important; user-select: none; line-height: 1.2; font-weight: normal; box-sizing: border-box; }
        .eproc-segmented-control input[type="radio"] { display: none !important; margin: 0; }
        /* Trick visual para Bold sem afetar Box Model de CSS e causar resize (Fix Layout Paralisados) */
        .eproc-segmented-control input[type="radio"]:checked + label { color: #0081c2; text-shadow: 0.3px 0 0 currentcolor, -0.3px 0 0 currentcolor; font-weight: normal; background-color: transparent !important; box-shadow: none !important; }

        .eproc-segmented-control:has(#eproc-radio-inclusao)::before { content: ""; position: absolute; top: 3px; bottom: 3px; left: 3px; width: calc(33.333% - 2px); background: #fff; border-radius: 4px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); transition: transform 0.3s cubic-bezier(0.25, 0.8, 0.25, 1); z-index: -1; }
        .eproc-segmented-control:has(#eproc-radio-inclusao:checked)::before { transform: translateX(0); }
        .eproc-segmented-control:has(#eproc-radio-autuacao:checked)::before { transform: translateX(100%); }
        .eproc-segmented-control:has(#eproc-radio-recebimento:checked)::before { transform: translateX(200%); }

        .eproc-segmented-control:has(#scope_todos)::before { content: ""; position: absolute; top: 3px; bottom: 3px; left: 3px; width: calc(50% - 3px); background: #fff; border-radius: 4px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); transition: transform 0.3s cubic-bezier(0.25, 0.8, 0.25, 1); z-index: -1; }
        .eproc-segmented-control:has(#scope_todos:checked)::before { transform: translateX(0); }
        .eproc-segmented-control:has(#scope_novos:checked)::before { transform: translateX(100%); }

        .eproc-date-group { display: inline-flex; align-items: stretch; border: 1px solid #ccc; border-radius: 6px; overflow: hidden; background: #fff; transition: border-color 0.2s; height: 28px; }
        .eproc-date-group:hover, .eproc-date-group:focus-within { border-color: #0081c2; }
        .eproc-date-label { padding: 0 8px; font-size: 12px; color: #555; background: #f8f8f9; display: flex; align-items: center; border-right: 1px solid #eee; }
        .eproc-date-group input[type="date"] { border: none; padding: 0 8px; font-size: 12px; outline: none; color: #333; cursor: pointer; background: transparent; height: 100%; box-sizing: border-box; }
        .eproc-date-group input[type="date"]:first-of-type { border-right: 1px solid #eee; }
        .eproc-btn-filtrar-integrado { background-color: transparent; border: none; border-left: 1px solid #eee; padding: 0 15px; font-size: 12px; cursor: pointer; font-weight: normal; font-family: 'Roboto', Arial, sans-serif; color: #0081c2; transition: background 0.2s, color 0.2s; margin: 0; height: 100%; box-sizing: border-box; }
        .eproc-btn-filtrar-integrado:hover { background-color: #eef8fa; color: #0081c2; }
        .modern-modal { background: #fff; border-radius: 8px; box-shadow: 0 10px 30px rgba(0,0,0,0.15); border: 1px solid #e0e0e0; overflow: hidden; margin: 0 auto; font-family: Arial, sans-serif; }
        .modern-modal-header { background: #fdfdfd; padding: 15px 20px; border-bottom: 1px solid #eee; display: flex; align-items: center; gap: 10px; color: #333; font-weight: bold; font-size: 14px; }
        .modern-modal-body { padding: 20px; }
        .modern-modal-desc { font-size: 12px; color: #666; margin-bottom: 15px; text-align: center; line-height: 1.4; }

        .eproc-segmented-full { display: grid; width: 100%; margin-bottom: 15px; box-sizing: border-box; }
        .eproc-segmented-full label { flex: 1; text-align: center; width: auto; flex-direction: column; justify-content: center; align-items: center; padding: 6px 4px; line-height: 1.3; display: flex !important; }

        .modern-btn-primary { width: 100%; background: #0081c2; color: white; border: none; border-radius: 6px; padding: 10px; font-size: 13px; font-weight: normal; font-family: 'Roboto', Arial, sans-serif; cursor: pointer; margin-bottom: 10px; display: flex; justify-content: center; align-items: center; gap: 8px; transition: background 0.2s; text-align: center; }
        .modern-btn-primary:hover { background: #006a9e; }
        .modern-btn-secondary { width: 100%; background: #fff; color: #0081c2; border: 1px solid #ccc; border-radius: 6px; padding: 9px; font-size: 13px; font-weight: normal; font-family: 'Roboto', Arial, sans-serif; cursor: pointer; margin-bottom: 15px; display: flex; justify-content: center; align-items: center; gap: 8px; transition: all 0.2s; text-align: center; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
        .modern-btn-secondary:hover { background: #eef8fa; color: #0081c2; border-color: #bbb; }
        .modern-btn-cancel { width: 100%; background: transparent; color: #888; border: none; font-size: 12px; cursor: pointer; padding: 5px; transition: color 0.2s; font-weight: normal; font-family: 'Roboto', Arial, sans-serif; text-align: center; justify-content: center; display: flex; }
        .modern-btn-cancel:hover { color: #d9534f; text-decoration: underline; }

        /* Botões do Menu Grid (Novos Relatórios) */
        .modern-btn-grid {
            background: #fff; color: #0081c2; border: 1px solid #ccc; border-radius: 8px; padding: 12px 5px;
            font-size: 12px; font-weight: normal; font-family: 'Roboto', Arial, sans-serif; cursor: pointer; display: flex; flex-direction: column;
            align-items: center; justify-content: center; gap: 8px; transition: all 0.2s; box-shadow: 0 1px 3px rgba(0,0,0,0.1);
        }
        .modern-btn-grid:hover {
            background: #eef8fa; border-color: #0081c2; color: #0081c2; transform: translateY(-2px);
            box-shadow: 0 4px 10px rgba(0,0,0,0.08);
        }
        .modern-btn-grid svg { fill: currentColor; }
    `;
    document.head.appendChild(style);

    // ===========================================================================================
    // CACHE MANAGER & INFRA
    // ===========================================================================================
    const CacheManager = {
        db: null, memoryCache: new Map(), writeBuffer:[], writeTimer: null, initPromise: null, ready: false,
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
                    this.db = event.target.result; this.ready = true;
                    this.cleanupOldData(); this.migrateDatesFromLocalStorage(); resolve(this.db);
                };
                request.onerror = () => { this.ready = true; resolve(); };
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
                    const novos =[]; let processados = 0; const now = Date.now();
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
                    const oldData = JSON.parse(oldCacheStr);
                    for (const [id, val] of Object.entries(oldData)) store.put({ id: id, value: val, timestamp: Date.now() });
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
        queue:[], active: 0, pending: 0, pauseUntil: 0,
        add: function(url, celula, linha, numProcesso) {
            if (linha.getAttribute('data-nucleo-status')) return;
            this.pending++;
            const cachedValue = CacheManager.getSync(numProcesso) || CacheManager.getSync(url);
            if (cachedValue) {
                this.renderizarDoCache(celula, linha, cachedValue);
                this.pending--;
                return;
            }
            DomBatcher.add(celula, `<div class="eproc-spinner"></div>`, linha, { 'data-nucleo-status': 'checking-storage' });
            CacheManager.getAsync(numProcesso || url).then((dbValue) => {
                if (dbValue) {
                    this.renderizarDoCache(celula, linha, dbValue);
                    this.pending--;
                } else {
                    this.queue.push({ url, celula, linha, numProcesso, retries: 0 });
                    linha.setAttribute('data-nucleo-status', 'queued');
                    this.process();
                }
            }).catch(() => {
                this.queue.push({ url, celula, linha, numProcesso, retries: 0 });
                linha.setAttribute('data-nucleo-status', 'queued');
                this.process();
            });
        },
        renderizarDoCache: function(celula, linha, value) {
            const parts = value.split('###'); const dataStr = parts[0]; const origemStr = parts[1] || "-";
            if (regexData.test(dataStr)) {
                DomBatcher.add(celula, `<span style="color:#000;">${dataStr}</span>`, linha, { 'data-nucleo-carregado': 'true', 'data-nucleo-status': null });
                const celulaOrigem = celula.nextElementSibling;
                if(celulaOrigem && celulaOrigem.classList.contains('eproc-col-origem-nucleo')) {
                    DomBatcher.add(celulaOrigem, `<span title="${origemStr}">${origemStr}</span>`, null, null);
                    linha.setAttribute('data-idx-text', (linha.getAttribute('data-idx-text') || "") + " " + removerAcentos(origemStr.toUpperCase()));
                }
            } else {
                DomBatcher.add(celula, `<span style="color:#999;">-</span>`, linha, { 'data-nucleo-carregado': 'true', 'data-nucleo-status': null });
            }
        },
        process: async function() {
            if (this.active >= MAX_CONCURRENCY || this.queue.length === 0) return;
            if (Date.now() < this.pauseUntil) { setTimeout(() => this.process(), 1000); return; }

            await rateLimiter.consume();

            if (this.active >= MAX_CONCURRENCY || this.queue.length === 0) return;

            const task = this.queue.shift();
            if (!task) return;

            this.active++;
            task.linha.setAttribute('data-nucleo-status', 'processing');
            this.executeTask(task);
            this.process();
        },
        executeTask: async function(task) {
            try {
                await new Promise(r => setTimeout(r, Math.floor(Math.random() * 150)));

                let url = task.url;
                if (task.retries > 3) url += `${url.includes('?')?'&':'?'}_force_refresh=${Date.now()}`;
                if (task.retries > 6) await new Promise(r => setTimeout(r, Math.floor(Math.random() * 3000) + 1500));

                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), 15000);

                const res = await fetch(url, { method: 'GET', headers: { 'X-Requested-With': 'XMLHttpRequest' }, credentials: 'include', cache: 'no-store', signal: controller.signal });
                clearTimeout(timeoutId);

                if (res.url.includes("login") || res.url.includes("acao=sair") || res.url.includes("msg=Sua")) throw new Error("SESSAO_ENCERRADA");
                if (!res.ok) throw new Error(`HTTP ${res.status}`);

                const text = new TextDecoder('iso-8859-1').decode(await res.arrayBuffer());
                if (text.length < 500 || text.includes("Sua sessão foi encerrada")) throw new Error("SESSAO_ENCERRADA");

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
                            const match = tr.cells[2]?.textContent.trim().match(/(\d{2}\/\d{2}\/\d{4})/);
                            if (match) {
                                dataAchada = match[1];
                                const mOrigem = tr.textContent.match(regexOrigem);
                                if (mOrigem) origemAchada = mOrigem[1].trim();
                                break;
                            }
                        }
                    }
                    if (!dataAchada) {
                        const mUrlPag = text.match(/urlPaginacao\s*=\s*'([^']+)'/);
                        const totalPag = doc.querySelectorAll('#selPaginacaoT option').length;
                        if (mUrlPag && totalPag > 1) {
                            const urlPag = mUrlPag[1];
                            for (let p = 1; p < totalPag && !dataAchada; p++) {
                                try {
                                    const controllerPag = new AbortController();
                                    const timeoutPag = setTimeout(() => controllerPag.abort(), 10000);
                                    const resPag = await fetch(urlPag, {
                                        method: 'POST',
                                        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'X-Requested-With': 'XMLHttpRequest' },
                                        body: `pagina=${p}`,
                                        credentials: 'include',
                                        signal: controllerPag.signal
                                    });
                                    clearTimeout(timeoutPag);
                                    if (!resPag.ok) continue;
                                    const htmlPag = new TextDecoder('iso-8859-1').decode(await resPag.arrayBuffer());
                                    const docPag = new DOMParser().parseFromString(htmlPag, "text/html");
                                    const tbody = docPag.querySelector('#tblEventosNovos > tbody');
                                    if (!tbody) continue;
                                    for (let tr of tbody.querySelectorAll('tr')) {
                                        if (tr.textContent.includes(TEXTO_ALVO_1) || (tr.textContent.includes("Remetidos os Autos") && tr.textContent.includes(TEXTO_ALVO_2))) {
                                            const match = tr.cells[2]?.textContent.trim().match(/(\d{2}\/\d{2}\/\d{4})/);
                                            if (match) {
                                                dataAchada = match[1];
                                                const mOrigem = tr.textContent.match(regexOrigem);
                                                if (mOrigem) origemAchada = mOrigem[1].trim();
                                                break;
                                            }
                                        }
                                    }
                                } catch(e) {
                                    continue;
                                }
                            }
                        }
                    }
                }

                if (dataAchada) {
                    CacheManager.set(task.numProcesso || task.url, `${dataAchada}###${origemAchada}`);
                    this.renderizarDoCache(task.celula, task.linha, `${dataAchada}###${origemAchada}`);
                    this.active--;
                    this.pending--;
                    if (this.pending === 0 && typeof aplicarSortSalvo === 'function') { isScanning = true; aplicarSortSalvo(); isScanning = false; }
                    if (this.pending === 0) window._eprocOrigemDataPronto = true;
                    this.process();
                } else {
                    throw new Error("Data pattern not found");
                }

            } catch (error) {
                this.active--;
                task.retries++;

                if (task.retries > 15) {
                    this.pending--;
                    DomBatcher.add(task.celula, `<span style="color:red;" title="Erro na busca">Erro</span>`, task.linha, { 'data-nucleo-status': 'error', 'data-nucleo-carregado': 'true' });
                    if (this.pending === 0 && typeof aplicarSortSalvo === 'function') { isScanning = true; aplicarSortSalvo(); isScanning = false; }
                    if (this.pending === 0) window._eprocOrigemDataPronto = true;
                    this.process();
                    return;
                }

                if (error.message === "SESSAO_ENCERRADA" || error.message.includes("Sessão")) {
                    this.pauseUntil = Date.now() + 15000; task.linha.setAttribute('data-nucleo-status', 'queued');
                    this.queue.push(task); setTimeout(() => this.process(), 15000); return;
                }

                if (!document.body.contains(task.linha)) {
                    this.pending--;
                    if (this.pending === 0 && typeof aplicarSortSalvo === 'function') { isScanning = true; aplicarSortSalvo(); isScanning = false; }
                    if (this.pending === 0) window._eprocOrigemDataPronto = true;
                    this.process();
                    return;
                }

                const color = task.retries > 10 ? "purple" : (task.retries > 5 ? "red" : "orange");
                DomBatcher.add(task.celula, `<div class="eproc-spinner" style="border-top-color: ${color};"></div>`, task.linha, { 'data-nucleo-status': 'waiting-retry' });
                setTimeout(() => { task.linha.setAttribute('data-nucleo-status', 'queued'); this.queue.push(task); this.process(); }, Math.min((task.retries * 3000) + 2000, 45000));
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
    // PARTE 3: TABELA E CHUNK PROCESSING
    // ===========================================================================================
    let estadoOrdenacao = { ordemData: 'desc', ordemOrigem: 'asc' };
    try {
        const saved = localStorage.getItem(LS_KEY_SORT);
        if (saved) {
            const { col, dir } = JSON.parse(saved);
            if (col === 'data') estadoOrdenacao.ordemData = dir;
            else if (col === 'origem') estadoOrdenacao.ordemOrigem = dir;
        } else {
            estadoOrdenacao.ordemData = 'asc';
            localStorage.setItem(LS_KEY_SORT, JSON.stringify({ col: 'data', dir: 'asc' }));
        }
    } catch (e) {}

    let initialSortAplicado = false;
    function aplicarSortSalvo() {
        if (initialSortAplicado) return;
        try {
            const saved = localStorage.getItem(LS_KEY_SORT);
            if (!saved) return;
            const { col, dir } = JSON.parse(saved);

            if (col === 'native') {
                initialSortAplicado = true;
                return;
            }

            const colClass = col === 'data' ? '.eproc-col-data-nucleo' : '.eproc-col-origem-nucleo';
            const ordemVar = col === 'data' ? 'ordemData' : 'ordemOrigem';
            ordenarPor(colClass, ordemVar, dir);
            initialSortAplicado = true;
        } catch (e) {}
    }

    function obterDataSegura(str) {
        if (!str) return null; const match = str.match(/(\d{2})\/(\d{2})\/(\d{4})/);
        return match ? new Date(parseInt(match[3]), parseInt(match[2]) - 1, parseInt(match[1])) : null;
    }

    function ordenarPor(colClass, ordemVar, forceDir = null) {
        const tabela = document.getElementById('tabelaLocalizadores') || document.querySelector('.infraTable');
        if (!tabela) return;
        const th = tabela.querySelector(colClass === '.eproc-col-data-nucleo' ? '.th-nucleo-40' : '.th-nucleo-origem');
        if (!th) return;
        const parent = th.closest('tbody') || tabela.querySelector('tbody') || tabela;

        document.querySelectorAll('.th-nucleo-40 .sort-up, .th-nucleo-origem .sort-up').forEach(img => img.src = 'infra_css/imagens/seta_acima.gif');
        document.querySelectorAll('.th-nucleo-40 .sort-down, .th-nucleo-origem .sort-down').forEach(img => img.src = 'infra_css/imagens/seta_abaixo.gif');

        if (forceDir) {
            estadoOrdenacao[ordemVar] = forceDir;
        } else {
            estadoOrdenacao[ordemVar] = (estadoOrdenacao[ordemVar] === 'asc') ? 'desc' : 'asc';
        }

        try {
            const col = colClass === '.eproc-col-data-nucleo' ? 'data' : 'origem';
            localStorage.setItem(LS_KEY_SORT, JSON.stringify({ col, dir: estadoOrdenacao[ordemVar] }));
        } catch (e) {}
        const imgUp = th.querySelector('.sort-up');
        const imgDown = th.querySelector('.sort-down');

        if (estadoOrdenacao[ordemVar] === 'asc') {
            if(imgUp) imgUp.src = 'infra_css/imagens/seta_acima_selecionada.gif';
        } else {
            if(imgDown) imgDown.src = 'infra_css/imagens/seta_abaixo_selecionada.gif';
        }

        const isData = colClass === '.eproc-col-data-nucleo';
        const rows = getLinhasProcessos().filter(tr => tr.querySelector(colClass));

        rows.sort((a, b) => {
            const vA = a.cells[th.cellIndex]?.textContent.trim() || ""; const vB = b.cells[th.cellIndex]?.textContent.trim() || "";
            if (isData) {
                const dA = obterDataSegura(vA); const dB = obterDataSegura(vB);
                if (!dA) return 1; if (!dB) return -1;
                return estadoOrdenacao[ordemVar] === 'asc' ? dA - dB : dB - dA;
            } else {
                if (vA === vB) return 0;
                return estadoOrdenacao[ordemVar] === 'asc' ? vA.localeCompare(vB) : vB.localeCompare(vA);
            }
        });

        const fragment = document.createDocumentFragment();
        rows.forEach(r => fragment.appendChild(r));
        parent.appendChild(fragment);
    }

    function verificarParalisacao(linha, idxEvento) {
        if (!linha || idxEvento === -1) return false;
        const texto = linha.cells[idxEvento]?.textContent.trim();
        const dataEvento = obterDataSegura(texto);
        if (dataEvento) {
            const hoje = new Date(); hoje.setHours(0,0,0,0); dataEvento.setHours(0,0,0,0);
            if (Math.ceil(Math.abs(hoje - dataEvento) / 86400000) >= 30) {
                linha.classList.add('tr-paralisado');
                const num = linha.querySelector('a[href*="acao=processo_selecionar"]')?.textContent.trim().replace(/\D/g, '');
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

        if (!header.getAttribute('data-eproc-col-priority-applied')) {
            header.setAttribute('data-eproc-col-priority-applied', 'true');

            header.querySelectorAll('th.infraTh').forEach(th => {
                if (!th.classList.contains('th-nucleo-40') && !th.classList.contains('th-nucleo-origem')) {
                    const btnSort = th.querySelector('.infraTableOrdenacao') || th.querySelector('.infraImgOrdenacao');
                    if (btnSort) {
                        th.addEventListener('click', () => {
                            localStorage.setItem(LS_KEY_SORT, JSON.stringify({ col: 'native', dir: 'asc' }));
                        });
                    }
                }
            });

            const p1Keywords =['LOCALIZADOR'];
            const p2Keywords =['AUTOR', 'RÉU', 'REU', 'PASSIVO', 'POLO PASSIVO'];
            const p3WrapKeywords =['CLASSE', 'ÚLTIMO EVENTO', 'ULTIMO EVENTO', 'PROCEDIMENTO'];

            for (let ci = 0; ci < header.cells.length; ci++) {
                const th = header.cells[ci];
                if (th.classList.contains('th-nucleo-40') || th.classList.contains('th-nucleo-origem')) continue;
                const texto = th.textContent.toUpperCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();

                if (ci === 0 || ci === header.cells.length - 1) {
                    th.classList.add('eproc-col-compact');
                    continue;
                }

                let matched = false;
                if (texto.includes('PROCESSO') || texto.includes('NUMERO')) {
                    th.classList.add('eproc-col-p1');
                    matched = true;
                }
                if (!matched) {
                    for (const kw of p1Keywords) {
                        if (texto.includes(kw.normalize("NFD").replace(/[\u0300-\u036f]/g, ""))) { th.classList.add('eproc-col-p1'); matched = true; break; }
                    }
                }
                if (!matched) {
                    for (const kw of p2Keywords) {
                        if (texto.includes(kw.normalize("NFD").replace(/[\u0300-\u036f]/g, ""))) { th.classList.add('eproc-col-p2'); matched = true; break; }
                    }
                }
                if (!matched) {
                    let isWrap = false;
                    for (const kw of p3WrapKeywords) {
                        if (texto.includes(kw.normalize("NFD").replace(/[\u0300-\u036f]/g, ""))) { th.classList.add('eproc-col-p3-wrap'); isWrap = true; matched = true; break; }
                    }
                    if (!isWrap) {
                        th.classList.add('eproc-col-p3');
                    }
                }
            }
        }

        const colIdxDate = header.querySelector('.th-nucleo-40').cellIndex;
        isScanning = true; const linhas = getLinhasProcessos();

        if (linhas.length === 0) {
            isScanning = false;
            return;
        }

        let temParalisado = false;

        const processRow = (tr) => {
            if (!tr.hasAttribute('data-idx-text')) tr.setAttribute('data-idx-text', removerAcentos(tr.textContent.toUpperCase()));
            if (verificarParalisacao(tr, idxEvento)) temParalisado = true;

            let tdDate = tr.querySelector('.eproc-col-data-nucleo');
            if (!tdDate) {
                tdDate = document.createElement('td'); tdDate.className = 'infraTd eproc-col-data-nucleo'; tdDate.textContent = "...";
                tr.insertBefore(tdDate, tr.cells[colIdxDate]);
            }
            let tdOrigem = tr.querySelector('.eproc-col-origem-nucleo');
            if (!tdOrigem) {
                tdOrigem = document.createElement('td'); tdOrigem.className = 'infraTd eproc-col-origem-nucleo'; tdOrigem.textContent = "...";
                if (tdDate.nextSibling) tr.insertBefore(tdOrigem, tdDate.nextSibling); else tr.appendChild(tdOrigem);
            }

            if (!tr.getAttribute('data-nucleo-carregado') && !tr.getAttribute('data-nucleo-status')) {
                const link = tr.querySelector('a[href*="acao=processo_selecionar"]');
                if (link) {
                    const numProc = link.textContent.trim().replace(/\D/g, '');
                    const cachedValue = CacheManager.getSync(numProc) || CacheManager.getSync(link.href);

                    if (cachedValue) {
                        const parts = cachedValue.split('###');
                        const dataStr = parts[0];
                        const origemStr = parts[1] || "-";
                        if (regexData.test(dataStr)) {
                            tdDate.innerHTML = `<span style="color:#000;">${dataStr}</span>`;
                            tdOrigem.innerHTML = `<span>${origemStr}</span>`;
                            tr.setAttribute('data-nucleo-carregado', 'true');
                            tr.setAttribute('data-idx-text', (tr.getAttribute('data-idx-text') || "") + " " + removerAcentos(origemStr.toUpperCase()));
                        } else {
                            tdDate.innerHTML = `<span style="color:#999;">-</span>`;
                            tr.setAttribute('data-nucleo-carregado', 'true');
                        }
                    } else {
                        filaDeProcessamento.add(link.href, tdDate, tr, numProc);
                    }
                } else {
                    tdDate.textContent = "-"; tdOrigem.textContent = "-"; tr.setAttribute('data-nucleo-carregado', 'true');
                }
            }
        };

        const finalize = () => {
            if (filaDeProcessamento.pending === 0 && filaDeProcessamento.queue.length === 0) {
                aplicarSortSalvo();
                window._eprocOrigemDataPronto = true;
            }
            isScanning = false;
            const alertaDiv = document.getElementById('eproc-alerta-paralisado');
            if (alertaDiv) {
                const trsParalisados = document.querySelectorAll('tr.tr-paralisado');
                if (trsParalisados.length > 0) {
                    if (alertaDiv.getAttribute('data-qtd-paralisados') !== String(trsParalisados.length)) {
                        alertaDiv.setAttribute('data-qtd-paralisados', String(trsParalisados.length));
                        const idsParalisados =[]; const mapTrs = {};
                        trsParalisados.forEach(tr => {
                            const num = tr.querySelector('a[href*="acao=processo_selecionar"]')?.textContent.trim().replace(/\D/g, '');
                            if(num) { idsParalisados.push(num); mapTrs[num] = tr; }
                        });
                        CacheManager.checkNovosParalisados(idsParalisados).then(novosIds => {
                            novosIds.forEach(id => { if (mapTrs[id]) mapTrs[id].classList.add('tr-novo-paralisado'); });
                            alertaDiv.style.display = 'flex'; alertaDiv.innerHTML = '';
                            const textoSpan = document.createElement('span');
                            const txtParal = trsParalisados.length === 1 ? 'PROCESSO PARALISADO' : 'PROCESSOS PARALISADOS';
                            textoSpan.textContent = `⚠️ HÁ ${trsParalisados.length} ${txtParal} HÁ 30 DIAS OU MAIS! `;
                            alertaDiv.appendChild(textoSpan);
                            if (novosIds.length > 0) {
                                const txtNovos = novosIds.length === 1 ? 'novo paralisado' : 'novos paralisados';
                                const badge = document.createElement('span'); badge.className = 'eproc-badge-novo'; badge.textContent = `Há ${novosIds.length} ${txtNovos}`; alertaDiv.appendChild(badge);
                            }
                            criarBotoesAlerta(alertaDiv, idxEvento, trsParalisados.length, novosIds.length);
                        });
                    }
                } else {
                    alertaDiv.style.display = 'none'; alertaDiv.removeAttribute('data-qtd-paralisados');
                }
            }
            if (filaDeProcessamento.queue.length > 0 && filaDeProcessamento.active < MAX_CONCURRENCY) {
                filaDeProcessamento.process();
            }
        };

        const limitFirst = Math.min(10, linhas.length);
        try {
            for (let i = 0; i < limitFirst; i++) {
                processRow(linhas[i]);
            }
        } catch(e) { console.error(e); }

        if (linhas.length > limitFirst) {
            requestAnimationFrame(() => {
                const keysToWarm =[];
                try {
                    for (let i = limitFirst; i < linhas.length; i++) {
                        const link = linhas[i].querySelector('a[href*="acao=processo_selecionar"]');
                        if (link) {
                            const numProc = link.textContent.trim().replace(/\D/g, '');
                            if (!CacheManager.getSync(numProc)) keysToWarm.push(numProc);
                        }
                    }
                } catch(e) { console.error(e); }

                CacheManager.warmupChunk(keysToWarm).then(() => {
                    try {
                        for (let i = limitFirst; i < linhas.length; i++) {
                            processRow(linhas[i]);
                        }
                    } catch(e) { console.error(e); }
                    finalize();
                }).catch(() => {
                    finalize();
                });
            });
        } else {
            finalize();
        }
    }

    function executarSelecao(tipo) {
        if (window.eprocAddFiltro) {
            const excl = window.eprocModoExclusaoAtivo ? window.eprocModoExclusaoAtivo() : false;
            if (tipo === 'todos') {
                window.eprocAddFiltro('status', '__PARALISADO__', 'Paralisados', excl);
            } else {
                window.eprocAddFiltro('status', '__NOVO_PARALISADO__', 'Novos Paralisados', excl);
            }
            window.eprocAplicarFiltros();
            if (excl && window.eprocToggleModoExclusao) window.eprocToggleModoExclusao(false);
        } else {
            alert('Erro: Filtros não inicializados.');
        }
    }

    function criarBotoesAlerta(alertaDiv, idxEvento, totalParalisados, totalNovos) {
        const btnRel = document.createElement('button'); btnRel.id = 'eproc-relatorio-btn'; btnRel.textContent = "Gerar Relatório"; btnRel.type = "button"; alertaDiv.appendChild(btnRel);
        btnRel.onclick = (e) => {
            e.preventDefault(); e.stopPropagation();
            const overlay = document.createElement('div'); overlay.className = 'eproc-modal-overlay';
            const seletorAbrangencia = totalNovos > 0 ? `
                <div class="eproc-segmented-control eproc-segmented-full">
                    <input type="radio" name="eproc-rel-scope" id="scope_todos" value="todos" checked>
                    <label for="scope_todos">Todos<br>(${totalParalisados})</label>
                    <input type="radio" name="eproc-rel-scope" id="scope_novos" value="novos">
                    <label for="scope_novos">Apenas Novos<br>(${totalNovos})</label>
                </div>` : '';

            overlay.innerHTML = `
                <div class="modern-modal" style="width:340px;">
                    <div class="modern-modal-header">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="#d9534f"><path d="M14 2H6c-1.1 0-1.99.9-1.99 2L4 20c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8l-6-6zm2 16H8v-2h8v2zm0-4H8v-2h8v2zm-3-5V3.5L18.5 9H13z"/></svg>
                        Relatório de Paralisados
                    </div>
                    <div class="modern-modal-body">
                        <div class="modern-modal-desc">Selecione a abrangência e o tipo de relatório que deseja exportar.</div>
                        ${seletorAbrangencia}
                        <button id="btn-rel-geral" class="modern-btn-primary" style="justify-content: center; text-align: center;">
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-5 14H7v-2h7v2zm3-4H7v-2h10v2zm0-4H7V7h10v2z"/></svg>
                            Gerar Relatório Geral
                        </button>
                        <button id="btn-rel-digito" class="modern-btn-secondary" style="justify-content: center; text-align: center;">
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M4 4h4v4H4V4zm6 0h4v4h-4V4zm6 0h4v4h-4V4zM4 10h4v4H4v-4zm6 0h4v4h-4v-4zm6 0h4v4h-4v-4zM4 16h4v4H4v-4zm6 0h4v4h-4v-4zm6 0h4v4h-4v-4z"/></svg>
                            Relatório Por Dígito
                        </button>
                        <button id="btn-rel-cancel" class="eproc-btn eproc-btn-danger" style="width: 100%; margin-top: 5px; justify-content: center; text-align: center;">Sair</button>
                    </div>
                </div>`;
            document.body.appendChild(overlay);

            const fechar = () => {
                if(document.body.contains(overlay)) document.body.removeChild(overlay);
                document.removeEventListener('keydown', escHandler);
            };
            const escHandler = (ev) => { if (ev.key === 'Escape') fechar(); };
            overlay.addEventListener('click', (ev) => { if (ev.target === overlay) fechar(); });
            document.addEventListener('keydown', escHandler);

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
                    const num = l ? l.textContent.trim() : "N/A"; const evt = c ? c.textContent.replace(/\s+/g, ' ').trim() : "";
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
                    if(l) { const num = l.textContent.trim(); const d = parseInt(num.match(/(\d)-/)?.[1]); if (!isNaN(d)) buckets[d].push({ num, href: l.href }); }
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
            if (totalNovos === 0) { executarSelecao('todos'); return; }
            const overlay = document.createElement('div'); overlay.className = 'eproc-modal-overlay';
            overlay.innerHTML = `
                <div class="modern-modal" style="width:320px;">
                    <div class="modern-modal-header" style="border-bottom-color: #0081c2;">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="#0081c2"><path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-9 14l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/></svg>
                        Selecionar Paralisados
                    </div>
                    <div class="modern-modal-body">
                        <div class="modern-modal-desc">Selecione quais processos paralisados deseja marcar na tabela para distribuir.</div>
                        <button id="btn-sel-todos" class="modern-btn-primary" style="justify-content: center; text-align: center;">Todos os Paralisados (${totalParalisados})</button>
                        <button id="btn-sel-novos" class="modern-btn-secondary" style="margin-top: 10px; justify-content: center; text-align: center;">Apenas os Novos (${totalNovos})</button>
                        <button id="btn-sel-cancel" class="eproc-btn eproc-btn-danger" style="width: 100%; margin-top: 10px; justify-content: center; text-align: center;">Sair</button>
                    </div>
                </div>`;
            document.body.appendChild(overlay);
            const fechar = () => {
                if(document.body.contains(overlay)) document.body.removeChild(overlay);
                document.removeEventListener('keydown', escHandler);
            };
            const escHandler = (ev) => { if (ev.key === 'Escape') fechar(); };
            overlay.addEventListener('click', (ev) => { if (ev.target === overlay) fechar(); });
            document.addEventListener('keydown', escHandler);
            document.getElementById('btn-sel-cancel').onclick = fechar;
            document.getElementById('btn-sel-todos').onclick = () => { fechar(); executarSelecao('todos'); };
            document.getElementById('btn-sel-novos').onclick = () => { fechar(); executarSelecao('novos'); };
        };
    }

    // ===========================================================================================
    // PARTE 4: NAVEGAÇÃO FLUTUANTE DE SELEÇÃO E OLHO
    // ===========================================================================================

    let currentNavIndex = -1;

    function aplicarVisibilidadeSelecionados() {
        const btnEye = document.getElementById('eproc-toggle-visibilidade');
        if (!btnEye) return;

        if (modoApenasSelecionados) {
            btnEye.querySelector('.eye-open').style.display = 'none';
            btnEye.querySelector('.eye-closed').style.display = 'block';
            getLinhasProcessos().forEach(tr => {
                const chk = tr.querySelector('input[type="checkbox"]');
                if (chk && !chk.checked) tr.style.display = 'none';
                else tr.style.display = '';
            });
        } else {
            btnEye.querySelector('.eye-open').style.display = 'block';
            btnEye.querySelector('.eye-closed').style.display = 'none';
            getLinhasProcessos().forEach(tr => tr.style.display = '');
        }
    }

    function updateNavVisibility() {
        const count = document.querySelectorAll('tr[class^="infraTr"] input[type="checkbox"]:checked').length;
        const nav = document.getElementById('eproc-nav-flutuante');
        const btnEye = document.getElementById('eproc-toggle-visibilidade');

        if (count > 0) {
            if (nav) nav.style.display = 'flex';
            if (btnEye) btnEye.style.display = 'flex';
        } else {
            if (nav) {
                nav.style.display = 'none';
                currentNavIndex = -1;
            }
            if (btnEye) {
                btnEye.style.display = 'none';
                if (modoApenasSelecionados) {
                    modoApenasSelecionados = false;
                    aplicarVisibilidadeSelecionados();
                }
            }
        }
    }

    function navigateSelection(direction) {
        const checkboxes = Array.from(document.querySelectorAll('tr[class^="infraTr"] input[type="checkbox"]:checked')).filter(chk => {
            const tr = chk.closest('tr');
            return tr && !tr.querySelector('th');
        });

        if (checkboxes.length === 0) {
            currentNavIndex = -1;
            return;
        }

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

        if (currentNavIndex >= checkboxes.length) currentNavIndex = 0;
        if (currentNavIndex < 0) currentNavIndex = checkboxes.length - 1;

        const tr = checkboxes[currentNavIndex].closest('tr');
        if (tr) {
            tr.scrollIntoView({ behavior: 'smooth', block: 'center' });

            if (tr.dataset.originalBg === undefined) {
                tr.dataset.originalBg = tr.style.backgroundColor || '';
            }

            tr.style.transition = 'background-color 0.3s';
            tr.style.backgroundColor = '#ffeeba';

            setTimeout(() => {
                if (tr.dataset.originalBg !== undefined) {
                    tr.style.backgroundColor = tr.dataset.originalBg;
                    delete tr.dataset.originalBg;
                }
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
            for (const[sigla, nome] of Object.entries(COMARCAS_MAP)) {
                if (textoOrigem.toUpperCase().includes(nome.toUpperCase())) { comarca = nome; break; }
            }
        }

        const cleanText = textoOrigem.toUpperCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
        if (cleanText.includes("UNICA") || cleanText.includes("UJU")) {
            vara = "ÚNICA";
        } else {
            const matchVara = cleanText.match(/(\d+)\s*[AO]?\s*[^A-Z]*(JD|UJ|UJU|UNIDADE|VARA|VC|V\.)/);
            if (matchVara) vara = matchVara[1] + "VC";
        }

        if (comarca) return { comarca, vara };
        return null;
    }

    function findLocalizadorIdNoDropdown(parsedOrigem, isNujesp) {
        if (!parsedOrigem) return null;
        const options = Array.from(document.querySelectorAll('#selNovoLocalizador option'));
        const searchComarca = parsedOrigem.comarca.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase();
        const searchPrefix = isNujesp ? "NB/JESP" : "NB/JC";

        for (let opt of options) {
            const txt = opt.text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase();
            if (txt.includes(searchPrefix) && txt.includes(searchComarca)) {
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
        const perfilElement = document.querySelector('#selInfraUnidades option:checked');
        if (!perfilElement) {
            alert("Não foi possível identificar o perfil de usuário atual (NUCIV ou NUJESP).");
            return;
        }
        const isNujesp = perfilElement.textContent.includes('NUJESP');

        const painelLoc = document.getElementById('conteudoAlterarLocalizadores');
        if (painelLoc && painelLoc.style.display === 'none') {
            const legendLoc = document.querySelector('#fldAlterarLocalizadores legend');
            if (legendLoc) legendLoc.click();
        }

        const linhas = getLinhasProcessos();
        if (linhas.length === 0) return;

        const tabela = linhas[0].closest('table');
        const headerCells = Array.from(tabela.rows[0].cells);
        const idxLocalizador = headerCells.findIndex(c => c.textContent.includes("Localizador"));

        const grupos = {};
        let totalValidos = 0;

        linhas.forEach(linha => {
            const tdOrigem = linha.querySelector('.eproc-col-origem-nucleo');
            const tdLocalizadores = linha.querySelector('a[href*="localizador_orgao_tooltip"]')?.closest('td') || linha.cells[idxLocalizador];

            if (!tdOrigem || !tdLocalizadores) return;

            const textoOrigem = tdOrigem.textContent.trim();
            const textoLocsAtual = tdLocalizadores.textContent.toUpperCase().replace(/[^A-Z0-9]/g, '');

            if(textoOrigem === "..." || textoOrigem === "-") return;

            const parsed = parseOrigem(textoOrigem);
            const optTarget = findLocalizadorIdNoDropdown(parsed, isNujesp);

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
        if (linhas.length === 0) return;

        const tabela = linhas[0].closest('table');
        const headerCells = Array.from(tabela.rows[0].cells);
        const idxLocalizador = headerCells.findIndex(c => c.textContent.includes("Localizador"));

        const processosPendentes =[];

        linhas.forEach(linha => {
            const linkProc = linha.querySelector('a[href*="acao=processo_selecionar"]');
            if (!linkProc) return;

            const matchProc = linkProc.textContent.match(/(\d)-/);
            if (!matchProc) return;
            const digitoProcesso = matchProc[1];

            const tdLocalizadores = linha.querySelector('a[href*="localizador_orgao_tooltip"]')?.closest('td') || linha.cells[idxLocalizador];
            if (!tdLocalizadores) return;

            const locsText = tdLocalizadores.textContent.toUpperCase();
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
            alert("Não há processos pendentes de distribuição por dígito na tela atual.");
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
                <div class="eproc-modal-title-modern"><svg class="icon-svg" viewBox="0 0 24 24"><path d="M20 8h-4V4h-2v4h-4V4H8v4H4v2h4v4H4v2h4v4h2v-4h4v4h2v-4h4v-2h-4v-4h4V8zm-6 6h-4v-4h4v4z"/></svg> Distribuição por Dígitos</div>
                <p style="font-size:12px; color:#666; margin-bottom:15px;">Selecione o dígito que deseja distribuir:</p>
                <div style="display:flex; flex-wrap:wrap; justify-content:center; margin-bottom:15px;">
                    ${botoesDigitos}
                </div>
                <button class="eproc-btn eproc-btn-secondary" style="width:100%; margin-bottom:10px; font-weight:bold; text-align:center; justify-content:center;" onclick="window.processarDistribuicaoDigito('todos')">Todos os dígitos pendentes (${processosPendentes.length})</button>
                <button class="eproc-btn eproc-btn-danger" style="width:100%; text-align:center; justify-content:center;" onclick="document.body.removeChild(this.closest('.eproc-modal-overlay'))">Cancelar</button>
            </div>
        `;

        window.processarDistribuicaoDigito = function(filtroDigito) {
            fecharDigito();

            const filtrados = filtroDigito === 'todos'
                ? processosPendentes
                : processosPendentes.filter(p => p.digito === String(filtroDigito));

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
                const nomeGrupo = grupos[targetValue].nome;

                const painelLoc = document.getElementById('conteudoAlterarLocalizadores');
                if (painelLoc && painelLoc.style.display === 'none') {
                    const legendLoc = document.querySelector('#fldAlterarLocalizadores legend');
                    if (legendLoc) legendLoc.click();
                }

                const distId = 'dist_' + Date.now();
                linhasAlvo.forEach(tr => tr.setAttribute('data-dist-group', distId));

                const excl = window.eprocModoExclusaoAtivo ? window.eprocModoExclusaoAtivo() : false;
                window.eprocAddFiltro('dist', distId, `Dist: ${nomeGrupo}`, excl);
                window.eprocAplicarFiltros();
                if (excl && window.eprocToggleModoExclusao) window.eprocToggleModoExclusao(false);

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
                }, 100);
            }
        };

        document.body.appendChild(overlay);

        const fecharDigito = () => {
            if(document.body.contains(overlay)) document.body.removeChild(overlay);
            document.removeEventListener('keydown', escHandlerDigito);
        };
        const escHandlerDigito = (ev) => { if (ev.key === 'Escape') fecharDigito(); };
        overlay.addEventListener('click', (ev) => { if (ev.target === overlay) fecharDigito(); });
        document.addEventListener('keydown', escHandlerDigito);
        overlay.querySelector('.eproc-btn-danger').onclick = () => fecharDigito();
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
                    <button class="eproc-btn eproc-btn-secondary" style="width:100%; font-size:11px; border-color:#ccc; justify-content:center; text-align:center;" onclick="window.aplicarDistribuicaoGrupoGenerico('${val}')">Distribuir para este Localizador</button>
                </div>
            `;
        });

        overlay.innerHTML = `
            <div class="eproc-modal-content" style="width: 420px; max-height: 85vh; overflow-y: auto;">
                <div class="eproc-modal-title-modern">
                    <svg class="icon-svg" viewBox="0 0 24 24">
                        ${tipo === 'Dígito' ? '<path d="M20 8h-4V4h-2v4h-4V4H8v4H4v2h4v4H4v2h4v4h2v-4h4v4h2v-4h4v-2h-4v-4h4V8zm-6 6h-4v-4h4v4z"/>' : '<path d="M4 10v7h3v-7H4zm6 0v7h3v-7h-3zM2 22h19v-3H2v3zm14-12v7h3v-7h-3zm-4.5-9L2 6v2h19V6l-9.5-5z"/>'}
                    </svg>
                    Distribuição Inteligente por ${tipo}
                </div>
                <p style="font-size:12px; color:#666; margin-bottom:15px;">Processos filtrados e agrupados. Os que já possuem o localizador correto foram ignorados.</p>
                <div style="padding-right:5px; margin-bottom:15px;">
                    ${htmlBotoes}
                </div>
                <button class="eproc-btn eproc-btn-danger" style="width:100%; justify-content:center; text-align:center;" onclick="if(window._fecharOverlayAgrupado) window._fecharOverlayAgrupado()">Sair</button>
            </div>
        `;

        window.aplicarDistribuicaoGrupoGenerico = function(targetValue) {
            const linhasAlvo = grupos[targetValue].linhas;
            const nomeGrupo = grupos[targetValue].nome;

            fecharOverlay();

            const painelLoc = document.getElementById('conteudoAlterarLocalizadores');
            if (painelLoc && painelLoc.style.display === 'none') {
                const legendLoc = document.querySelector('#fldAlterarLocalizadores legend');
                if (legendLoc) legendLoc.click();
            }

            const distId = 'dist_' + Date.now();
            linhasAlvo.forEach(tr => tr.setAttribute('data-dist-group', distId));

            const excl = window.eprocModoExclusaoAtivo ? window.eprocModoExclusaoAtivo() : false;
            window.eprocAddFiltro('dist', distId, `Dist: ${nomeGrupo}`, excl);
            window.eprocAplicarFiltros();
            if (excl && window.eprocToggleModoExclusao) window.eprocToggleModoExclusao(false);

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
            }, 100);
        };

        document.body.appendChild(overlay);

        const fecharOverlay = () => {
            if(document.body.contains(overlay)) document.body.removeChild(overlay);
            document.removeEventListener('keydown', escHandlerAgrupado);
        };
        window._fecharOverlayAgrupado = fecharOverlay;
        const escHandlerAgrupado = (ev) => { if (ev.key === 'Escape') fecharOverlay(); };
        overlay.addEventListener('click', (ev) => { if (ev.target === overlay) fecharOverlay(); });
        document.addEventListener('keydown', escHandlerAgrupado);
    }

    function desmarcarLocalizadoresAtuais() {
        const btnDesmarcar = document.getElementById('lblLocDesDesmarcarTodos');
        if (btnDesmarcar) {
            btnDesmarcar.click();
        } else {
            const selectDesativarLoc = document.getElementById('selLocalizadorDesativar');
            if (selectDesativarLoc) {
                Array.from(selectDesativarLoc.options).forEach(opt => opt.selected = false);
                selectDesativarLoc.dispatchEvent(new Event('change'));
                if(typeof $ !== 'undefined' && $(selectDesativarLoc).hasClass('selectpicker')){
                    $(selectDesativarLoc).selectpicker('refresh');
                }
            }
        }
    }

    function salvarPaginaAtual() {
        try {
            const selPagina = document.getElementById('selPagina');
            if (selPagina && selPagina.value) {
                sessionStorage.setItem('eproc_pagina_atual', selPagina.value);
            }
        } catch(e) {}
    }

    function restaurarPaginaAtual() {
        try {
            const paginaSalva = sessionStorage.getItem('eproc_pagina_atual');
            if (!paginaSalva) return;
            sessionStorage.removeItem('eproc_pagina_atual');

            // Aguarda o DOM estar pronto para encontrar selPagina
            const tentarRestaurar = () => {
                const selPagina = document.getElementById('selPagina');
                if (!selPagina) return;
                const optionExiste = selPagina.querySelector(`option[value="${paginaSalva}"]`);
                if (!optionExiste) return;
                if (selPagina.value === paginaSalva) return; // já está na página correta

                // Intercepta o próximo submit do formulário para injetar selPagina
                const form = document.getElementById('frmProcessoLista');
                if (form) {
                    // Aborda via hidden input para compatibilidade máxima com EPROC
                    let hidden = form.querySelector('input[name="selPagina"][data-eproc-restore]');
                    if (!hidden) {
                        hidden = document.createElement('input');
                        hidden.type = 'hidden';
                        hidden.name = 'selPagina';
                        hidden.setAttribute('data-eproc-restore', '1');
                        form.appendChild(hidden);
                    }
                    hidden.value = paginaSalva;
                }

                // Seleciona no dropdown e dispara a navegação nativa do EPROC
                selPagina.value = paginaSalva;
                // Usa o handler nativo sem bubbling para não causar loops
                const evt = new Event('change');
                selPagina.dispatchEvent(evt);
            };

            // Pequeno delay para garantir que o DOM do EPROC carregou completamente
            if (document.readyState === 'complete') {
                tentarRestaurar();
            } else {
                window.addEventListener('load', tentarRestaurar, { once: true });
            }
        } catch(e) {}
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
                            salvarPaginaAtual();
                            window.validarSelecao();
                        } else {
                            alert('Erro: Função nativa de exclusão do EPROC não foi encontrada.');
                        }
                    } else {
                        alert('Informe o novo localizador ou selecione localizadores atuais para excluir.');
                        if (novoLoc) novoLoc.focus();
                    }
                } else {
                    salvarPaginaAtual();
                    originalAlterarLocalizador();
                }
            };
        }

        if (typeof window.selecionaCheckLocalizadores === 'function' && !window.selecionaCheckLocalizadores.eprocHijacked) {
            const origSel = window.selecionaCheckLocalizadores;
            window.selecionaCheckLocalizadores = function() {
                origSel.apply(this, arguments);
                desmarcarLocalizadoresAtuais();
            };
            window.selecionaCheckLocalizadores.eprocHijacked = true;
        }
    }

    function mostrarRastreamentoPendente(callbackSuccess) {
        const fb = document.getElementById('eproc-feedback');
        if (!fb) {
            if (callbackSuccess) callbackSuccess();
            return;
        }
        function cicloMonitoramento() {
            const pendentes = filaDeProcessamento.pending;
            if (pendentes > 0 || isScanning) {
                fb.style.display = 'block';
                setTimeout(() => { fb.style.opacity = '1'; }, 10);
                fb.innerHTML = `
                    <div class="eproc-feedback-glass">
                        <div class="eproc-pulse"></div>
                        <span style="font-size: 12px; color: #444; font-weight: 600; font-family: sans-serif;">
                            Rastreando dados: <b style="color:#0081c2; font-size: 13px;">${pendentes > 0 ? pendentes : '...'}</b> restantes
                        </span>
                    </div>
                `;
                setTimeout(cicloMonitoramento, 500);
            } else {
                fb.style.opacity = '0';
                setTimeout(() => {
                    fb.style.display = 'none';
                    fb.innerHTML = '';
                    if (callbackSuccess) callbackSuccess();
                }, 300);
            }
        }
        cicloMonitoramento();
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
        let modoExclusaoAtivo = false;
        let modoBusca = 'E';

        function toggleModoExclusao(forcar) {
            if (forcar !== undefined) modoExclusaoAtivo = forcar;
            else modoExclusaoAtivo = !modoExclusaoAtivo;

            const seletor = document.getElementById('eproc-seletor');
            const avisoId = 'eproc-aviso-exclusao';
            let aviso = document.getElementById(avisoId);

            if (seletor) {
                if (modoExclusaoAtivo) {
                    seletor.style.backgroundColor = '#fdf2f2';
                    seletor.style.borderColor = '#d9534f';
                    if (!aviso) {
                        aviso = document.createElement('div');
                        aviso.id = avisoId;
                        aviso.style = 'position: absolute; top: 15px; left: 50%; transform: translateX(-50%); color: #d9534f; font-weight: normal; font-size: 12px; opacity: 0.6; pointer-events: none;';
                        aviso.textContent = 'Os novos parâmetros funcionarão como filtros negativos de busca';
                        seletor.appendChild(aviso);
                    }
                } else {
                    seletor.style.backgroundColor = '#fff';
                    seletor.style.borderColor = '#ccc';
                    if (aviso) aviso.remove();
                }
            }
        }

        window.eprocToggleModoExclusao = toggleModoExclusao;
        window.eprocModoExclusaoAtivo = () => modoExclusaoAtivo;

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
            const selPagina = document.getElementById('selPagina');
            if (!div || document.getElementById('optPaginacao1000')) return;
            const d = document.createElement('div');
            d.innerHTML = `<input type="radio" name="paginacao" id="optPaginacao500" value="500" class="infraRadio mr-2"><label for="optPaginacao500" class="infraRadio mr-2">500 processos por página</label><br>
                           <input type="radio" name="paginacao" id="optPaginacao1000" value="1000" class="infraRadio mr-2"><label for="optPaginacao1000" class="infraRadio mr-2">1000 processos por página</label>`;
            div.appendChild(d);

            let prefPag = localStorage.getItem(LS_KEY_PAGINACAO);
            if (!prefPag) {
                prefPag = '500';
                localStorage.setItem(LS_KEY_PAGINACAO, '500');
            }
            if (selPagina) {
                if (!selPagina.querySelector('option[value="500"]')) {
                    const opt500 = document.createElement('option');
                    opt500.value = '500';
                    opt500.text = '500';
                    selPagina.appendChild(opt500);
                }
                if (!selPagina.querySelector('option[value="1000"]')) {
                    const opt1000 = document.createElement('option');
                    opt1000.value = '1000';
                    opt1000.text = '1000';
                    selPagina.appendChild(opt1000);
                }
            }
            if (prefPag === '1000') document.getElementById('optPaginacao1000').checked = true;
            else document.getElementById('optPaginacao500').checked = true;

            const hdnPaginacao = document.getElementById('paginacao');
            const checkedRadio = document.querySelector('input[name="paginacao"]:checked');
            if (hdnPaginacao && checkedRadio) hdnPaginacao.value = checkedRadio.value;

            document.querySelectorAll('input[name="paginacao"]').forEach(r => r.addEventListener('change', e => {
                localStorage.setItem(LS_KEY_PAGINACAO, e.target.value);
                document.cookie = `paginacao=${e.target.value};path=/;max-age=3600`;
                if (hdnPaginacao) hdnPaginacao.value = e.target.value;
            }));

            if (!window.eprocJaAutoSubmetido) {
                window.eprocJaAutoSubmetido = true;
                setTimeout(() => {
                    const form = document.getElementById('frmProcessoLista');
                    const btnConsultar = form ? form.querySelector('button[data-botao], .infraButton, button[type="submit"]') : null;
                    if (selPagina) {
                        selPagina.value = prefPag;
                        localStorage.setItem(LS_KEY_PAGINACAO, prefPag);

                        new Promise(resolve => setTimeout(resolve, 30)).then(() => {
                            if (btnConsultar && typeof btnConsultar.click === 'function') {
                                btnConsultar.click();
                            } else if (form) {
                                form.submit();
                            }
                        });
                    }
                }, 800);
            }
        }

        function validarIntervaloData(linha, dtInicio, dtFim) {
            if (!dtInicio && !dtFim) return true;

            const radioRecebimento = document.getElementById('eproc-radio-recebimento');
            const modoRecebimento = radioRecebimento ? radioRecebimento.checked : false;
            const radioAutuacao = document.getElementById('eproc-radio-autuacao');
            const modoAutuacao = radioAutuacao ? radioAutuacao.checked : false;

            let dataLinha = null;

            if (modoRecebimento) {
                const td = linha.querySelector('.eproc-col-data-nucleo');
                if (td) dataLinha = obterDataSegura(td.textContent.trim());
            } else if (modoAutuacao) {
                const tabela = linha.closest('table');
                if (tabela) {
                    const headers = Array.from(tabela.querySelectorAll('th'));
                    const idxAut = headers.findIndex(th => th.textContent.toUpperCase().includes("AUTUAÇÃO"));

                    if (idxAut > -1 && linha.cells[idxAut]) {
                        dataLinha = obterDataSegura(linha.cells[idxAut].textContent.trim());
                    }
                }
            } else {
                const tabela = linha.closest('table');
                const headers = Array.from(tabela.rows[0].cells);
                const idxInc = headers.findIndex(th => th.textContent.toUpperCase().includes("INCLUSÃO"));

                if (idxInc > -1 && linha.cells[idxInc]) {
                    dataLinha = obterDataSegura(linha.cells[idxInc].textContent.trim());
                } else {
                    const tds = linha.querySelectorAll('td');
                    dataLinha = obterDataSegura(tds[tds.length - 1]?.textContent);
                }
            }

            if (!dataLinha) return false;
            dataLinha.setHours(0,0,0,0);

            if (dtInicio && dataLinha < dtInicio) return false;
            if (dtFim && dataLinha > dtFim) return false;
            return true;
        }

        function caoDeGuardaEAplicar(callbackAcao) {
            const radio = document.getElementById('eproc-radio-recebimento');
            if (!radio || !radio.checked) {
                const fb = document.getElementById('eproc-feedback');
                if (fb) { fb.style.display = 'none'; fb.style.opacity = '0'; }
                callbackAcao();
                return;
            }
            mostrarRastreamentoPendente(callbackAcao);
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

            const filtroData = estadoFiltros.find(f => f.tipo === 'data');
            const dataExclusao = filtroData ? filtroData.negativo : false;

            const positivos = estadoFiltros.filter(f => !f.negativo).map(f => ({...f, valorUpper: removerAcentos(f.valor.toUpperCase())}));
            const negativos = estadoFiltros.filter(f => f.negativo).map(f => ({...f, valorUpper: removerAcentos(f.valor.toUpperCase())}));

            const positivosTextStatus = positivos.filter(f => f.tipo !== 'data');
            const temPositivosTextStatus = positivosTextStatus.length > 0;

            const negativosTextStatus = negativos.filter(f => f.tipo !== 'data');
            const temNegativosTextStatus = negativosTextStatus.length > 0;

            const updates =[];
            const linhas = getLinhasProcessos();
            let count = 0;

            linhas.forEach(linha => {
                const chk = linha.querySelector('input[type="checkbox"]');
                if (!chk || chk.disabled) return;

                if (temData) {
                    const dentroDoIntervalo = validarIntervaloData(linha, dtInicio, dtFim);
                    if (dataExclusao && dentroDoIntervalo) {
                        updates.push({ tr: linha, chk: chk, select: false });
                        return;
                    } else if (!dataExclusao && !dentroDoIntervalo) {
                        updates.push({ tr: linha, chk: chk, select: false });
                        return;
                    }
                }

                const linhaTexto = linha.getAttribute('data-idx-text') || "";
                let passouPositivos = true;

                if (temPositivosTextStatus) {
                    if (modoBusca === 'E') {
                        for (const filtro of positivosTextStatus) {
                            if (filtro.tipo === 'dist') {
                                if (!linha.hasAttribute('data-dist-group') || linha.getAttribute('data-dist-group') !== filtro.valor) { passouPositivos = false; break; }
                            } else if (filtro.tipo === 'status') {
                                if (filtro.valor === '__PARALISADO__' && !linha.classList.contains('tr-paralisado')) { passouPositivos = false; break; }
                                if (filtro.valor === '__NOVO_PARALISADO__' && !linha.classList.contains('tr-novo-paralisado')) { passouPositivos = false; break; }
                            } else {
                                if (!linhaTexto.includes(filtro.valorUpper)) { passouPositivos = false; break; }
                            }
                        }
                    } else {
                        passouPositivos = false;
                        for (const filtro of positivosTextStatus) {
                            if (filtro.tipo === 'dist') {
                                if (linha.hasAttribute('data-dist-group') && linha.getAttribute('data-dist-group') === filtro.valor) { passouPositivos = true; break; }
                            } else if (filtro.tipo === 'status') {
                                if (filtro.valor === '__PARALISADO__' && linha.classList.contains('tr-paralisado')) { passouPositivos = true; break; }
                                if (filtro.valor === '__NOVO_PARALISADO__' && linha.classList.contains('tr-novo-paralisado')) { passouPositivos = true; break; }
                            } else {
                                if (linhaTexto.includes(filtro.valorUpper)) { passouPositivos = true; break; }
                            }
                        }
                    }
                }

                let passouNegativos = true;
                if (passouPositivos && temNegativosTextStatus) {
                    for (const filtro of negativosTextStatus) {
                        if (filtro.tipo === 'dist') {
                            if (linha.hasAttribute('data-dist-group') && linha.getAttribute('data-dist-group') === filtro.valor) { passouNegativos = false; break; }
                        } else if (filtro.tipo === 'status') {
                            if (filtro.valor === '__PARALISADO__' && linha.classList.contains('tr-paralisado')) { passouNegativos = false; break; }
                            if (filtro.valor === '__NOVO_PARALISADO__' && linha.classList.contains('tr-novo-paralisado')) { passouNegativos = false; break; }
                        } else {
                            if (linhaTexto.includes(filtro.valorUpper)) { passouNegativos = false; break; }
                        }
                    }
                }

                if (passouPositivos && passouNegativos) {
                    updates.push({ tr: linha, chk: chk, select: true });
                    count++;
                } else {
                    updates.push({ tr: linha, chk: chk, select: false });
                }
            });

            requestAnimationFrame(() => {
                const originalCheck = window.selecionaCheckLocalizadores;
                if (typeof originalCheck === 'function') window.selecionaCheckLocalizadores = function() {};
                try {
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
                } finally {
                    if (typeof originalCheck === 'function') {
                        window.selecionaCheckLocalizadores = originalCheck;
                        originalCheck();
                    }
                }

                document.getElementById('eproc-contador').textContent = `Itens selecionados: ${count}`;

                if (modoApenasSelecionados) {
                    aplicarVisibilidadeSelecionados();
                } else {
                    updateNavVisibility();
                }
            });
        }

        window.eprocAplicarFiltros = aplicarFiltros;

        function selecionar(termo) {
            addFiltro('texto', termo, termo, false);
            aplicarFiltros();
        }

        function limparSelecao() {
            const originalCheck = window.selecionaCheckLocalizadores;
            if (typeof originalCheck === 'function') window.selecionaCheckLocalizadores = function() {};
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
            } finally {
                if (typeof originalCheck === 'function') {
                    window.selecionaCheckLocalizadores = originalCheck;
                    originalCheck();
                }
            }

            requestAnimationFrame(() => {
                const linhas = document.querySelectorAll('tr[style*="background-color"]');
                for (let i = 0; i < linhas.length; i++) {
                    linhas[i].style.backgroundColor = '';
                    linhas[i].style.borderLeft = '';
                }
                document.getElementById('eproc-contador').textContent = "Itens selecionados: 0";

                if (modoApenasSelecionados) {
                    modoApenasSelecionados = false;
                    aplicarVisibilidadeSelecionados();
                }
                updateNavVisibility();
            });
        }

        function atualizarTags() {
            const div = document.getElementById('eproc-criterios-lista');
            div.innerHTML = '';
            if(!estadoFiltros.length) { div.innerHTML = '<span style="color:#999;font-style:italic;font-size:11px;">Nenhum filtro</span>'; return; }
            estadoFiltros.forEach(f => {
                const t = document.createElement('div');
                t.className = f.negativo ? 'eproc-tag eproc-tag-negativo' : 'eproc-tag';

                let labelText = f.negativo ? f.label.replace(/"/g, '') : f.label;

                t.innerHTML = `${labelText} <span class="eproc-tag-close">×</span>`;

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

        function addFiltro(tipo, valor, label, negativo = false) {
            if(!estadoFiltros.some(f => f.tipo === tipo && f.valor === valor && f.negativo === negativo)) {
                estadoFiltros.push({ id: Date.now(), tipo, valor, label, negativo });
                atualizarTags();
            }
        }

        window.eprocAddFiltro = addFiltro;

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
                let strBotoes = localStorage.getItem(LS_KEY_BOTOES);
                let strOrdem = localStorage.getItem(LS_KEY_ORDEM) || localStorage.getItem("eproc_ordem_botoes_v17");

                botoesPersonalizados = strBotoes ? JSON.parse(strBotoes) :[];
                ordemBotoes = strOrdem ? JSON.parse(strOrdem) :[];

                if (ordemBotoes.length > 0 && !localStorage.getItem(LS_KEY_ORDEM)) {
                    localStorage.setItem(LS_KEY_ORDEM, JSON.stringify(ordemBotoes));
                }
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

                        <button id="eproc-dist-magica" type="button" class="eproc-btn eproc-btn-filtro-padrao eproc-btn-icon" title="Distribuição Inteligente por Vara de Origem" style="margin-right: 5px;">
                            <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M4 10v7h3v-7H4zm6 0v7h3v-7h-3zM2 22h19v-3H2v3zm14-12v7h3v-7h-3zm-4.5-9L2 6v2h19V6l-9.5-5z"/></svg>
                        </button>

                        <button id="eproc-dist-digito" type="button" class="eproc-btn eproc-btn-filtro-padrao eproc-btn-icon" title="Distribuição Inteligente de Dígitos" style="margin-right: 15px;">
                            <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M20 8h-4V4h-2v4h-4V4H8v4H4v2h4v4H4v2h4v4h2v-4h4v4h2v-4h4v-2h-4v-4h4V8zm-6 6h-4v-4h4v4z"/></svg>
                        </button>

                        <span style="font-weight:bold;font-size:12px; margin-bottom:0; display:flex; align-items:center; color:#555;">Fonte:</span>
                        <div class="eproc-segmented-control">
                            <input type="radio" name="eproc-tipo-data" id="eproc-radio-inclusao" value="inclusao" checked>
                            <label for="eproc-radio-inclusao">Inclusão</label>

                            <input type="radio" name="eproc-tipo-data" id="eproc-radio-autuacao" value="autuacao">
                            <label for="eproc-radio-autuacao">Autuação</label>

                            <input type="radio" name="eproc-tipo-data" id="eproc-radio-recebimento" value="recebimento">
                            <label for="eproc-radio-recebimento">Recebimento</label>
                        </div>

                        <div class="eproc-date-group" style="margin-left: 5px;">
                            <span class="eproc-date-label">De</span>
                            <input type="date" id="eproc-data-inicio">
                            <span class="eproc-date-label" style="border-left: 1px solid #eee;">Até</span>
                            <input type="date" id="eproc-data-fim">
                            <button id="eproc-aplicar-data" type="button" class="eproc-btn-filtrar-integrado">Filtrar Data</button>
                        </div>
                    </div>
                    <button id="eproc-limpar" type="button" class="eproc-btn eproc-btn-danger" title="Limpar filtros, seleções e campos">Limpar</button>
                </div>
                <div id="eproc-botoes-container" class="eproc-row" style="border-top: 1px solid #eee; padding-top: 10px;"></div>
                <div class="eproc-row" style="flex-wrap: nowrap; align-items: center;">
                    <input type="text" id="eproc-termo" class="eproc-form-control" placeholder="Pesquisar..." style="flex-grow:1; min-width: 50px;">
                    <div id="eproc-toggle-logica" class="eproc-toggle-btn" title="Alternar entre lógica E / OU" style="margin-left:5px;">
                        <div class="eproc-toggle-slider"></div>
                        <span class="active" id="eproc-toggle-e">E</span>
                        <span id="eproc-toggle-ou">OU</span>
                    </div>
                    <button id="eproc-copy-btn" class="eproc-btn eproc-btn-secondary eproc-btn-icon" title="Copiar Selecionados" style="margin-left:5px;">
                        <svg viewBox="0 0 24 24" width="16" height="16"><path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z"/></svg>
                    </button>
                    <button id="eproc-rel-tramitacao-btn" class="eproc-btn eproc-btn-secondary eproc-btn-icon" title="Relatórios" style="margin-left:5px;">
                        <svg viewBox="0 0 24 24" width="16" height="16"><path d="M19 3h-4.18C14.4 1.84 13.3 1 12 1c-1.3 0-2.4.84-2.82 2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-7 0c.55 0 1 .45 1 1s-.45 1-1 1-1-.45-1-1 .45-1 1-1zm2 14H7v-2h7v2zm3-4H7v-2h10v2zm0-4H7V7h10v2z"/></svg>
                    </button>
                    <button id="eproc-modo-exclusao" type="button" class="eproc-btn eproc-btn-danger eproc-btn-icon" title="Adicionar exceções ao filtro" style="margin-left:5px;">
                        <svg viewBox="0 0 24 24" width="16" height="16"><path d="M5 11h14v2H5z" fill="currentColor"/></svg>
                    </button>
                    <button id="eproc-buscar" type="button" class="eproc-btn" style="margin-left:5px;">Selecionar</button>
                </div>
                <div style="display: flex; justify-content: space-between; align-items: flex-end; margin-top:5px;">
                    <div style="flex: 1; min-width: 0; padding-right: 15px;"><span style="font-size:11px;font-weight:bold;color:#555;">Filtros:</span> <div id="eproc-criterios-lista"></div></div>
                    <div style="display: flex; align-items: center; gap: 8px; flex-shrink: 0;">
                        <button id="eproc-toggle-visibilidade" style="display: none; background: transparent; border: none; color: #999; cursor: pointer; padding: 0; margin-right: 5px; outline: none; transition: color 0.2s; align-items: center; justify-content: center;" title="Mostrar apenas processos selecionados" onmouseover="this.style.color='#555'" onmouseout="this.style.color='#999'">
                            <svg class="eye-open" width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z"/></svg>
                            <svg class="eye-closed" style="display: none;" width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M12 7c2.76 0 5 2.24 5 5 0 .65-.13 1.26-.36 1.83l2.92 2.92c1.51-1.26 2.7-2.89 3.43-4.75-1.73-4.39-6-7.5-11-7.5-1.4 0-2.74.25-3.98.7l2.16 2.16C10.74 7.13 11.35 7 12 7zM2 4.27l2.28 2.28.46.46C3.08 8.3 1.78 10.02 1 12c1.73 4.39 6 7.5 11 7.5 1.55 0 3.03-.3 4.38-.84l.42.42L19.73 22 21 20.73 3.27 3 2 4.27zM7.53 9.8l1.55 1.55c-.05.21-.08.43-.08.65 0 1.66 1.34 3 3 3 .22 0 .44-.03.65-.08l1.55 1.55c-.67.33-1.41.53-2.2.53-2.76 0-5-2.24-5-5 0-.79.2-1.53.53-2.2zm4.31-.78l3.15 3.15.02-.16c0-1.66-1.34-3-3-3l-.17.01z"/></svg>
                        </button>
                        <div id="eproc-contador" style="margin-top:0;">Itens selecionados: 0</div>
                    </div>
                </div>
                <div id="eproc-feedback"></div>
            `;

            const localDiv = document.getElementById('fldAcoes');
            if (localDiv) {
                form.insertBefore(div, localDiv.nextSibling);
            } else {
                form.insertBefore(div, form.firstChild);
            }
            renderizarBotoes();
            aplicarHackPaginacao();

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

            document.getElementById('eproc-dist-magica').onclick = (e) => { e.preventDefault(); abrirAssistenteDistribuicao(); };
            document.getElementById('eproc-dist-digito').onclick = (e) => { e.preventDefault(); abrirAssistenteDistribuicaoDigitos(); };
            document.getElementById('eproc-modo-exclusao').onclick = (e) => { e.preventDefault(); toggleModoExclusao(); };

            document.getElementById('eproc-toggle-visibilidade').onclick = (e) => {
                e.preventDefault();
                modoApenasSelecionados = !modoApenasSelecionados;
                aplicarVisibilidadeSelecionados();
            };

            document.getElementById('eproc-toggle-logica').onclick = function(e) {
                e.preventDefault();
                if (this.classList.contains('mode-ou')) {
                    this.classList.remove('mode-ou');
                    document.getElementById('eproc-toggle-e').classList.add('active');
                    document.getElementById('eproc-toggle-ou').classList.remove('active');
                    modoBusca = 'E';
                } else {
                    this.classList.add('mode-ou');
                    document.getElementById('eproc-toggle-e').classList.remove('active');
                    document.getElementById('eproc-toggle-ou').classList.add('active');
                    modoBusca = 'OU';
                }
                aplicarFiltros();
            };

            document.getElementById('eproc-termo').addEventListener('keypress', (e) => {
                if(e.key === 'Enter') {
                    e.preventDefault();
                    const t = e.target.value;
                    if(t) {
                        addFiltro('texto', t, `"${t}"`, modoExclusaoAtivo);
                        aplicarFiltros();
                        e.target.value='';
                        if (modoExclusaoAtivo) toggleModoExclusao(false);
                    }
                }
            });
            document.getElementById('eproc-buscar').onclick = (e) => {
                e.preventDefault();
                const t = document.getElementById('eproc-termo').value;
                if(t) {
                    addFiltro('texto', t, `"${t}"`, modoExclusaoAtivo);
                    aplicarFiltros();
                    document.getElementById('eproc-termo').value='';
                    if (modoExclusaoAtivo) toggleModoExclusao(false);
                }
            };
            document.getElementById('eproc-limpar').onclick = (e) => {
                e.preventDefault();

                estadoFiltros =[];
                document.getElementById('eproc-data-inicio').value = '';
                document.getElementById('eproc-data-fim').value = '';
                document.getElementById('eproc-termo').value = '';

                modoBusca = 'E';
                const toggleBtn = document.getElementById('eproc-toggle-logica');
                if (toggleBtn) {
                    toggleBtn.classList.remove('mode-ou');
                    document.getElementById('eproc-toggle-e').classList.add('active');
                    document.getElementById('eproc-toggle-ou').classList.remove('active');
                }

                toggleModoExclusao(false);
                atualizarTags();
                limparSelecao();

                const selectNovoLoc = document.getElementById('selNovoLocalizador');
                if (selectNovoLoc) {
                    selectNovoLoc.value = selectNovoLoc.querySelector('option[value="null"]') ? 'null' : '';
                    selectNovoLoc.dispatchEvent(new Event('change'));

                    if (typeof $ !== 'undefined' && $(selectNovoLoc).hasClass('selectpicker')) {
                        $(selectNovoLoc).selectpicker('refresh');
                    }
                }

                const selectDesativarLoc = document.getElementById('selLocalizadorDesativar');
                if (selectDesativarLoc) {
                    Array.from(selectDesativarLoc.options).forEach(opt => opt.selected = false);
                    selectDesativarLoc.dispatchEvent(new Event('change'));

                    if (typeof $ !== 'undefined' && $(selectDesativarLoc).hasClass('selectpicker')) {
                        $(selectDesativarLoc).selectpicker('refresh');
                    }
                }
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
                    addFiltro('data', '', lbl, modoExclusaoAtivo);
                    aplicarFiltros();
                    if (modoExclusaoAtivo) toggleModoExclusao(false);
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
                        const numProc = linkProc.textContent.trim();
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

                const abrirModalRelatorio = () => {
                const linhas = getLinhasProcessos();
                const dados =[];
                const hoje = new Date();
                hoje.setHours(0,0,0,0);

                const tabela = linhas.length > 0 ? linhas[0].closest('table') : null;
                let idxReu = -1;
                let idxClasse = -1;

                if (tabela) {
                    const header = tabela.querySelector('tr.infraTr') || tabela.querySelector('tr');
                    if (header) {
                        Array.from(header.cells).forEach((c, i) => {
                            const txt = c.textContent.toUpperCase();
                            if (txt.includes("RÉU") || txt.includes("REU") || txt.includes("PASSIVO")) idxReu = i;
                            if (txt.includes("CLASSE") || txt.includes("PROCEDIMENTO")) idxClasse = i;
                        });
                    }
                }

                linhas.forEach(tr => {
                    if (tr.querySelector('th')) return;

                    const chk = tr.querySelector('input[type="checkbox"]');
                    if (!chk) return;

                    const displayStyle = window.getComputedStyle(tr).display;
                    if (displayStyle === 'none') return;

                    const linkProc = tr.querySelector('a[href*="acao=processo_selecionar"]');
                    const tdData = tr.querySelector('.eproc-col-data-nucleo');
                    const tdOrigem = tr.querySelector('.eproc-col-origem-nucleo');

                    if (linkProc) {
                        const numProc = linkProc.textContent.trim();
                        const hrefProc = linkProc.href;

                        let dataObj = null;
                        let diffDays = 0;
                        if (tdData) {
                            const dataTexto = tdData.textContent.trim();
                            dataObj = obterDataSegura(dataTexto);
                            if (dataObj) {
                                dataObj.setHours(0,0,0,0);
                                const diffTime = Math.abs(hoje - dataObj);
                                diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
                            }
                        }

                        let comarcaStr = "NÃO RECONHECIDA";
                        let varaStr = tdOrigem ? tdOrigem.textContent.trim() : "-";

                        if (tdOrigem) {
                            const textoOrigem = tdOrigem.textContent.trim();
                            const parsed = parseOrigem(textoOrigem);
                            let isUnica = false;

                            if (textoOrigem === "..." || textoOrigem === "-") {
                                varaStr = "Vara Única";
                            } else if (parsed) {
                                isUnica = (parsed.vara === "ÚNICA" || parsed.vara === "UNICA" || parsed.vara === "-");
                                const optTarget = findLocalizadorIdNoDropdown(parsed);

                                if (optTarget && optTarget.value !== "null") {
                                    comarcaStr = parsed.comarca;
                                    varaStr = optTarget.text.replace(/^.*?NB\/JC\s*(-\s*)?/i, '').replace(/\s*\([A-Z]\).*$/i, '').replace(/\s*✅.*$/, '').trim();
                                    if (isUnica || !varaStr || varaStr === "-" || varaStr.toUpperCase() === comarcaStr.toUpperCase() || varaStr.toUpperCase() === "ÚNICA" || varaStr.toUpperCase() === "UNICA") {
                                        varaStr = "Vara Única";
                                    }
                                } else {
                                    comarcaStr = parsed.comarca;
                                    varaStr = isUnica ? "Vara Única" : parsed.vara + " " + parsed.comarca + " (Sem Localizador Ativo)";
                                }
                            }
                        }
                        if (varaStr === "-" || varaStr === "..." || varaStr === "") varaStr = "Vara Única";

                        let reuStr = idxReu > -1 && tr.cells[idxReu] ? tr.cells[idxReu].textContent.trim().replace(/\s+/g, ' ') : "NÃO IDENTIFICADO";
                        if (reuStr && reuStr !== "NÃO IDENTIFICADO") {
                            reuStr = reuStr.replace(/(?:\s*-)?\s*\(?Sem Procurador associado\)?/gi, '').trim();
                            reuStr = reuStr.replace(/(?:\s*-)?\s*\(?Sem Advogado\)?/gi, '').trim();
                            reuStr = reuStr.replace(/^[-,]\s*|\s*[-,]$/g, '').trim();
                            if(!reuStr) reuStr = "NÃO IDENTIFICADO";
                        }

                        let classeStr = "NÃO IDENTIFICADA";
                        let isTutela = false;
                        if (idxClasse > -1 && tr.cells[idxClasse]) {
                            let rawHtml = tr.cells[idxClasse].innerHTML;
                            let fullText = (tr.cells[idxClasse].textContent || "").toUpperCase();

                            if (fullText.includes("ANTECIPAÇÃO DE TUTELA") || fullText.includes("ANTECIPACAO DE TUTELA") || fullText.includes("TUTELA ANTECIPADA")) {
                                isTutela = true;
                            }

                            let spacedHtml = rawHtml.replace(/<br\s*[\/]?>/gi, '\n')
                                                    .replace(/<\/div>/gi, '\n')
                                                    .replace(/<\/p>/gi, '\n')
                                                    .replace(/<span[^>]*>/gi, '\n')
                                                    .replace(/<\/span>/gi, '\n');

                            let tempDiv = document.createElement('div');
                            tempDiv.innerHTML = spacedHtml;
                            let cleanText = (tempDiv.textContent || tempDiv.innerText || "");

                            let lines = cleanText.split('\n').map(l => l.trim()).filter(l => l.length > 0);
                            if (lines.length > 0) {
                                classeStr = lines[0].toUpperCase();
                            }

                            classeStr = classeStr.replace(/[-|()]*$/g, '').trim();

                            const motherClassesKnown =[
                                "PROCEDIMENTO COMUM CÍVEL",
                                "PROCEDIMENTO COMUM CIVEL",
                                "PROCEDIMENTO DO JUIZADO ESPECIAL CÍVEL",
                                "PRODUÇÃO ANTECIPADA DA PROVA",
                                "PRODUÇÃO ANTECIPADA DE PROVAS",
                                "CUMPRIMENTO DE SENTENÇA",
                                "EXECUÇÃO DE TÍTULO EXTRAJUDICIAL",
                                "BUSCA E APREENSÃO EM ALIENAÇÃO FIDUCIÁRIA",
                                "BUSCA E APREENSÃO",
                                "EMBARGOS À EXECUÇÃO",
                                "ALIMENTOS - PROVISÃO DE ALIMENTOS",
                                "ALVARÁ JUDICIAL",
                                "MANDADO DE SEGURANÇA",
                                "AÇÃO CIVIL PÚBLICA",
                                "INVENTÁRIO",
                                "DIVÓRCIO LITIGIOSO",
                                "DIVÓRCIO CONSENSUAL",
                                "TUTELA ANTECIPADA ANTECEDENTE",
                                "TUTELA CAUTELAR ANTECEDENTE"
                            ];

                            for (let mc of motherClassesKnown) {
                                if (classeStr.startsWith(mc) && classeStr !== mc) {
                                    classeStr = mc;
                                    break;
                                }
                            }

                            if(!classeStr) classeStr = "NÃO IDENTIFICADA";
                        }

                        dados.push({ num: numProc, href: hrefProc, dias: diffDays, comarca: comarcaStr, vara: varaStr, reu: reuStr, classe: classeStr, isTutela: isTutela });
                    }
                });

                if (dados.length === 0) {
                    alert('Nenhum processo válido encontrado na tela atual.');
                    return;
                }

                const savedStr = localStorage.getItem('eproc_tramitacao_saved');
                let processosSalvos =[];

                if (savedStr) {
                    try {
                        const parsed = JSON.parse(savedStr);
                        processosSalvos = parsed.map(p => Array.isArray(p) ? { num: p[0], href: p[1], dias: p[2], comarca: p[3], vara: p[4], reu: p[5] || "NÃO IDENTIFICADO", classe: p[6] || "NÃO IDENTIFICADA", isTutela: p[7] || false } : p);
                    } catch(e) {}
                }

                let salvosMsg = processosSalvos.length > 0
                    ? `<div id="eproc-rel-saved-msg" style="font-size: 11px; color: #0081c2; font-weight: bold; text-align: center; margin-bottom: 10px;">(${processosSalvos.length} processos já memorizados)</div>`
                    : `<div id="eproc-rel-saved-msg" style="font-size: 11px; color: #0081c2; font-weight: bold; text-align: center; margin-bottom: 10px; display: none;"></div>`;

                const overlay = document.createElement('div'); overlay.className = 'eproc-modal-overlay';
                overlay.innerHTML = `
                    <div class="modern-modal" style="width:360px;">
                        <div class="modern-modal-header" style="display:flex; justify-content:space-between; align-items:center; padding-right:15px;">
                            <div style="display:flex; align-items:center; gap:5px;">
                                <svg width="20" height="20" viewBox="0 0 24 24" fill="#0081c2"><path d="M19 3h-4.18C14.4 1.84 13.3 1 12 1c-1.3 0-2.4.84-2.82 2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-7 0c.55 0 1 .45 1 1s-.45 1-1 1-1-.45-1-1 .45-1 1-1zm2 14H7v-2h7v2zm3-4H7v-2h10v2zm0-4H7V7h10v2z"/></svg>
                                <span>Relatórios</span>
                            </div>
                            <div style="display:flex; gap:5px;">
                                <button id="btn-rel-save" title="Salvar processos desta tela para o próximo relatório" style="width: 26px; height: 26px; border-radius: 50%; border: 1px solid #0081c2; background: #fff; cursor: pointer; display: flex; align-items: center; justify-content: center; color: #0081c2; padding: 0; transition: all 0.2s;" onmouseover="this.style.background='#0081c2'; this.style.color='#fff';" onmouseout="this.style.background='#fff'; this.style.color='#0081c2';">
                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M17 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14c1.1 0 2-.9 2-2V7l-4-4zm-5 16c-1.66 0-3-1.34-3-3s1.34-3 3-3 3 1.34 3 3-1.34 3-3 3zm3-10H5V5h10v4z"/></svg>
                                </button>
                                <button id="btn-rel-clear" title="Apagar dados salvos" style="width: 26px; height: 26px; border-radius: 50%; border: 1px solid #d9534f; background: #fff; cursor: pointer; display: flex; align-items: center; justify-content: center; color: #d9534f; padding: 0; transition: all 0.2s; font-size: 20px; font-weight: bold; line-height: 1;" onmouseover="this.style.background='#d9534f'; this.style.color='#fff';" onmouseout="this.style.background='#fff'; this.style.color='#d9534f';">
                                    -
                                </button>
                            </div>
                        </div>
                        ${salvosMsg}
                        <div class="modern-modal-body">
                            <div class="modern-modal-desc" style="margin-top: -10px;">Selecione o tipo de relatório que deseja exportar para a área de transferência.</div>

                            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 15px;">
                                <button id="btn-rel-idade" class="modern-btn-grid">
                                    <svg width="24" height="24" viewBox="0 0 24 24"><path d="M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zM12 20c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8z"/><path d="M12.5 7H11v6l5.25 3.15.75-1.23-4.5-2.67z"/></svg>
                                    <span>Idade</span>
                                </button>
                                <button id="btn-rel-origem" class="modern-btn-grid">
                                    <svg width="24" height="24" viewBox="0 0 24 24"><path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"/></svg>
                                    <span>Origem</span>
                                </button>
                                <button id="btn-rel-passivo" class="modern-btn-grid">
                                    <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><path d="M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5c-1.66 0-3 1.34-3 3s1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5C6.34 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z"/></svg>
                                    <span>Polo Passivo</span>
                                </button>
                                <button id="btn-rel-classe" class="modern-btn-grid">
                                    <svg width="24" height="24" viewBox="0 0 24 24"><path d="M20 6h-4V4c0-1.11-.89-2-2-2h-4c-1.11 0-2 .89-2 2v2H4c-1.11 0-1.99.89-1.99 2L2 19c0 1.11.89 2 2 2h16c1.11 0 2-.89 2-2V8c0-1.11-.89-2-2-2zm-6 0h-4V4h4v2z"/></svg>
                                    <span>Procedimento</span>
                                </button>
                            </div>
                            <button id="btn-rel-tram-cancel" class="eproc-btn eproc-btn-danger" style="width: 100%; justify-content: center; text-align: center;">Sair</button>
                        </div>
                    </div>`;
                document.body.appendChild(overlay);

                const fechar = () => {
                    if(document.body.contains(overlay)) document.body.removeChild(overlay);
                    document.removeEventListener('keydown', escHandler);
                };
                const escHandler = (ev) => { if (ev.key === 'Escape') fechar(); };
                overlay.addEventListener('click', (ev) => { if (ev.target === overlay) fechar(); });
                document.addEventListener('keydown', escHandler);

                document.getElementById('btn-rel-tram-cancel').onclick = fechar;

                document.getElementById('btn-rel-save').onclick = (e) => {
                    e.preventDefault();
                    // Capturar TODOS os processos visíveis da tela atual no momento do clique
                    const dadosAtuais = [];
                    const linhasAtuais = getLinhasProcessos();
                    const hoje2 = new Date(); hoje2.setHours(0,0,0,0);
                    linhasAtuais.forEach(tr => {
                        if (tr.querySelector('th')) return;
                        const chk = tr.querySelector('input[type="checkbox"]');
                        if (!chk) return;
                        const displayStyle = window.getComputedStyle(tr).display;
                        if (displayStyle === 'none') return;
                        const linkProc2 = tr.querySelector('a[href*="acao=processo_selecionar"]');
                        if (!linkProc2) return;
                        const numProc2 = linkProc2.textContent.trim();
                        const hrefProc2 = linkProc2.href;
                        const tdData2 = tr.querySelector('.eproc-col-data-nucleo');
                        const tdOrigem2 = tr.querySelector('.eproc-col-origem-nucleo');
                        let dataObj2 = null; let diffDays2 = 0;
                        if (tdData2) {
                            dataObj2 = obterDataSegura(tdData2.textContent.trim());
                            if (dataObj2) { dataObj2.setHours(0,0,0,0); diffDays2 = Math.ceil(Math.abs(hoje2 - dataObj2) / (1000*60*60*24)); }
                        }
                        let comarcaStr2 = "NÃO RECONHECIDA"; let varaStr2 = tdOrigem2 ? tdOrigem2.textContent.trim() : "-";
                        if (tdOrigem2) {
                            const textoOrigem2 = tdOrigem2.textContent.trim();
                            const parsed2 = parseOrigem(textoOrigem2);
                            if (textoOrigem2 === "..." || textoOrigem2 === "-") { varaStr2 = "Vara Única"; }
                            else if (parsed2) {
                                const isUnica2 = (parsed2.vara === "ÚNICA" || parsed2.vara === "UNICA" || parsed2.vara === "-");
                                const optTarget2 = findLocalizadorIdNoDropdown(parsed2);
                                if (optTarget2 && optTarget2.value !== "null") {
                                    comarcaStr2 = parsed2.comarca;
                                    varaStr2 = optTarget2.text.replace(/^.*?NB\/JC\s*(-\s*)?/i, '').replace(/\s*\([A-Z]\).*$/i, '').replace(/\s*✅.*$/, '').trim();
                                    if (isUnica2 || !varaStr2 || varaStr2 === "-") varaStr2 = "Vara Única";
                                } else { comarcaStr2 = parsed2.comarca; varaStr2 = isUnica2 ? "Vara Única" : parsed2.vara + " " + parsed2.comarca + " (Sem Localizador Ativo)"; }
                            }
                        }
                        if (varaStr2 === "-" || varaStr2 === "..." || varaStr2 === "") varaStr2 = "Vara Única";
                        let reuStr2 = idxReu > -1 && tr.cells[idxReu] ? tr.cells[idxReu].textContent.trim().replace(/\s+/g, ' ') : "NÃO IDENTIFICADO";
                        if (reuStr2 && reuStr2 !== "NÃO IDENTIFICADO") {
                            reuStr2 = reuStr2.replace(/(?:\s*-)?\s*\(?Sem Procurador associado\)?/gi, '').replace(/(?:\s*-)?\s*\(?Sem Advogado\)?/gi, '').replace(/^[-,]\s*|\s*[-,]$/g, '').trim();
                            if(!reuStr2) reuStr2 = "NÃO IDENTIFICADO";
                        }
                        let classeStr2 = "NÃO IDENTIFICADA";
                        if (idxClasse > -1 && tr.cells[idxClasse]) {
                            let tempDiv2 = document.createElement('div');
                            tempDiv2.innerHTML = tr.cells[idxClasse].innerHTML.replace(/<br\s*[/]?>/gi,'\n').replace(/<\/div>/gi,'\n');
                            let lines2 = (tempDiv2.textContent||'').split('\n').map(l=>l.trim()).filter(l=>l.length>0);
                            if(lines2.length>0) { classeStr2 = lines2[0].toUpperCase().replace(/[-|()]*$/g,'').trim(); }
                            if(!classeStr2) classeStr2 = "NÃO IDENTIFICADA";
                        }
                        const isTutela2 = idxClasse > -1 && tr.cells[idxClasse] ? (tr.cells[idxClasse].textContent||'').toUpperCase().includes('TUTELA') : false;
                        dadosAtuais.push({ num: numProc2, href: hrefProc2, dias: diffDays2, comarca: comarcaStr2, vara: varaStr2, reu: reuStr2, classe: classeStr2, isTutela: isTutela2 });
                    });

                    let added = 0;
                    const existingNums = new Set(processosSalvos.map(p => p.num));
                    dadosAtuais.forEach(p => {
                        if (!existingNums.has(p.num)) {
                            processosSalvos.push(p);
                            existingNums.add(p.num);
                            added++;
                        }
                    });

                    const compactados = processosSalvos.map(p => [p.num, p.href, p.dias, p.comarca, p.vara, p.reu, p.classe, p.isTutela]);
                    localStorage.setItem('eproc_tramitacao_saved', JSON.stringify(compactados));
                    if (!localStorage.getItem('eproc_tramitacao_time')) {
                        localStorage.setItem('eproc_tramitacao_time', Date.now().toString());
                    }

                    const msgDiv = document.getElementById('eproc-rel-saved-msg');
                    if (msgDiv) {
                        msgDiv.innerHTML = `(${processosSalvos.length} processos já memorizados)`;
                        msgDiv.style.display = 'block';
                    }
                    if (typeof mostrarToast === 'function') {
                        mostrarToast(added > 0 ? `Memorizou ${added} processos novos desta tela (${dadosAtuais.length} total).` : "Todos os processos desta tela já estavam memorizados.");
                    }
                };

                document.getElementById('btn-rel-clear').onclick = (e) => {
                    e.preventDefault();
                    if (processosSalvos.length === 0) {
                        alert("Não há dados na memória para apagar.");
                        return;
                    }
                    processosSalvos =[];
                    localStorage.removeItem('eproc_tramitacao_saved');
                    localStorage.removeItem('eproc_tramitacao_time');
                    const msgDiv = document.getElementById('eproc-rel-saved-msg');
                    if (msgDiv) {
                        msgDiv.style.display = 'none';
                        msgDiv.innerHTML = '';
                    }
                    if (typeof mostrarToast === 'function') {
                        mostrarToast("Memória de processos apagada com sucesso!");
                    }
                };

                const obterDadosConsolidados = () => {
                    // Mescla processos salvos + processos da tela atual, sem apagar a memória
                    const existingNums = new Set(processosSalvos.map(p => p.num));
                    const consolidado = [...processosSalvos];
                    dados.forEach(p => {
                        if (!existingNums.has(p.num)) {
                            consolidado.push(p);
                            existingNums.add(p.num);
                        }
                    });
                    // NÃO apaga localStorage aqui — apenas exclusão manual ou expiração de 12h apagam
                    return consolidado;
                };

                document.getElementById('btn-rel-idade').onclick = () => {
                    fechar();
                    const dadosFinais = obterDadosConsolidados();
                    const dadosIdade = dadosFinais.filter(d => d.dias > 0);
                    if (dadosIdade.length === 0) {
                        alert('Nenhuma data válida encontrada para avaliar a idade.');
                        return;
                    }
                    dadosIdade.sort((a, b) => b.dias - a.dias);
                    let html = '<table border="1"><thead><tr><th>Processo</th><th>Tempo (Dias)</th></tr></thead><tbody>';
                    let texto = 'Processo\tTempo (Dias)\n';
                    dadosIdade.forEach(item => {
                        html += `<tr><td><a href="${item.href}">${item.num}</a></td><td>${item.dias}</td></tr>`;
                        texto += `${item.num}\t${item.dias}\n`;
                    });
                    html += '</tbody></table>';
                    copiarParaClipboard(html, texto);
                    if (typeof mostrarToast === 'function') mostrarToast(`Relatório por Idade (${dadosIdade.length} processos) copiado! Memória limpa.`);
                };

                document.getElementById('btn-rel-origem').onclick = () => {
                    fechar();
                    const dadosFinais = obterDadosConsolidados();

                    const comarcas = {};
                    dadosFinais.forEach(item => {
                        if (!comarcas[item.comarca]) {
                            comarcas[item.comarca] = { total: 0, varas: {} };
                        }
                        comarcas[item.comarca].total++;

                        if (!comarcas[item.comarca].varas[item.vara]) {
                            comarcas[item.comarca].varas[item.vara] = 0;
                        }
                        comarcas[item.comarca].varas[item.vara]++;
                    });

                    const comarcasArray = Object.keys(comarcas).map(nome => {
                        return {
                            nome: nome,
                            total: comarcas[nome].total,
                            varas: comarcas[nome].varas
                        };
                    });
                    comarcasArray.sort((a, b) => b.total - a.total);

                    let html = '<div style="font-family: Arial, sans-serif;">';
                    let texto = '';
                    const totalProcessosGeral = dadosFinais.length;

                    comarcasArray.forEach(comarca => {
                        const perc = ((comarca.total / totalProcessosGeral) * 100).toFixed(1).replace('.', ',');
                        const nomeComarcaFormatado = comarca.nome.toUpperCase();
                        html += `<h3 style="margin-top: 15px; margin-bottom: 5px; color: #0081c2;">${nomeComarcaFormatado} - Total: ${comarca.total} (${perc}%)</h3>`;
                        texto += `\n${nomeComarcaFormatado} - Total: ${comarca.total} (${perc}%)\n`;
                        texto += `----------------------------------------\n`;
                        html += `<ul style="margin-top: 5px;">`;

                        const varasNomes = Object.keys(comarca.varas).sort();

                        varasNomes.forEach(vara => {
                            const numProcessos = comarca.varas[vara];
                            const labelProcessos = numProcessos === 1 ? "processo" : "processos";

                            html += `<li>${vara}: <b>${numProcessos} ${labelProcessos}</b></li>`;
                            texto += `${vara}: ${numProcessos} ${labelProcessos}\n`;
                        });
                        html += `</ul>`;
                    });
                    html += '</div>';

                    copiarParaClipboard(html, texto);
                    if (typeof mostrarToast === 'function') mostrarToast(`Relatório por Origem (${dadosFinais.length} processos) copiado! Memória limpa.`);
                };

                const CANONICOS_REU = [
                    { kw: ['ITAÚ','ITAU'], c: 'ITAÚ' },
                    { kw: ['BRADESCO'], c: 'BRADESCO' },
                    { kw: ['BMG'], c: 'BMG' },
                    { kw: ['SANTANDER'], c: 'SANTANDER' },
                    { kw: ['CAIXA ECONOMICA','CAIXA ECONÔMICA','CAIXA FEDERAL'], c: 'CAIXA ECONÔMICA FEDERAL' },
                    { kw: ['NUBANK','NU PAGAMENTO','NU FINANCEIRA'], c: 'NUBANK' },
                    { kw: ['BANCO INTER','INTER BANK'], c: 'INTER' },
                    { kw: ['BANCO C6','C6 BANK','C6 CONSIG','C6 S'], c: 'C6' },
                    { kw: ['BANCO PAN','PAN S.','PAN S/A'], c: 'PAN' },
                    { kw: ['BTG'], c: 'BTG' },
                    { kw: ['SAFRA'], c: 'SAFRA' },
                    { kw: ['VOTORANTIM'], c: 'VOTORANTIM' },
                    { kw: ['MERCANTIL DO BRASIL','MERCANTIL BRASIL'], c: 'MERCANTIL DO BRASIL' },
                    { kw: ['BANCO DO BRASIL'], c: 'BANCO DO BRASIL' },
                    { kw: ['DAYCOVAL'], c: 'DAYCOVAL' },
                    { kw: ['MASTER'], c: 'MASTER' },
                    { kw: ['AGIBANK'], c: 'AGIBANK' },
                    { kw: ['OMNI'], c: 'OMNI' },
                    { kw: ['PORTOSEG'], c: 'PORTOSEG' },
                    { kw: ['HONDA'], c: 'HONDA' },
                    { kw: ['YAMAHA'], c: 'YAMAHA' },
                    { kw: ['TOYOTA'], c: 'TOYOTA' },
                    { kw: ['SICOOB'], c: 'SICOOB' },
                    { kw: ['SICREDI'], c: 'SICREDI' },
                    { kw: ['SERASA'], c: 'SERASA' },
                    { kw: ['TELEFÔNICA','TELEFONICA'], c: 'TELEFÔNICA/VIVO' },
                    { kw: ['CLARO'], c: 'CLARO' },
                    { kw: ['PICPAY'], c: 'PICPAY' },
                    { kw: ['RENNER'], c: 'RENNER' },
                    { kw: ['CREFISA'], c: 'CREFISA' },
                    { kw: ['CREDISETE'], c: 'CREDISETE' },
                    { kw: ['ARACOOP'], c: 'ARACOOP' },
                    { kw: ['AZUL LINHAS','AZUL AIR'], c: 'AZUL LINHAS AÉREAS' },
                    { kw: ['CAPITAL CONSIG'], c: 'CAPITAL CONSIG' },
                    { kw: ['BNP PARIBAS'], c: 'BNP PARIBAS' },
                    { kw: ['SEM PARAR'], c: 'SEM PARAR' },
                    { kw: ['FACTA'], c: 'FACTA' },
                    { kw: ['BRASIL CARD','BRASIL CARDS'], c: 'BRASIL CARD' },
                    { kw: ['CELCOIN'], c: 'CELCOIN' },
                    { kw: ['CLOUDWALK'], c: 'CLOUDWALK' },
                    { kw: ['SOLUCOES FINANCEIRAS','SOLUÇÕES FINANCEIRAS'], c: 'SOLUÇÕES FINANCEIRAS' },
                ];

                const normalizarEsplitarReu = (reuStr) => {
                    if (!reuStr || reuStr === 'NÃO IDENTIFICADO') return [reuStr || 'NÃO IDENTIFICADO'];

                    // Insere marcador de split após sufixos jurídicos quando seguido de initial maiúscula (litisconsórcio sem separador)
                    let marcado = reuStr
                        .replace(/(S\.A\.?|S\/A|LTDA\.?|EIRELI)\s+(?=[A-ZÁÉÍÓÚÃÕ])/g, '$1§SPLIT§')
                        .replace(/\s*,\s*/g, '§SPLIT§')
                        .replace(/\s*;\s*/g, '§SPLIT§');

                    const partes = marcado.split('§SPLIT§')
                        .map(p => p.trim())
                        .filter(p => p.length > 2);

                    const resultado = new Set();

                    partes.forEach(parte => {
                        const upper = parte.toUpperCase().replace(/\s+/g, ' ').trim();

                        // Tenta mapeamento canônico
                        let encontrado = false;
                        for (const { kw, c } of CANONICOS_REU) {
                            for (const k of kw) {
                                if (upper.includes(k.toUpperCase())) {
                                    resultado.add(c);
                                    encontrado = true;
                                    break;
                                }
                            }
                            if (encontrado) break;
                        }

                        if (!encontrado) {
                            // Limpa sufixos jurídicos e descritores genéricos bancários
                            let limpa = upper
                                .replace(/\b(S\.?\s*\/?\s*A\.?|LTDA\.?|EIRELI|S\.A\.S\.?)\b\.?\s*/g, '')
                                .replace(/\b(SOCIEDADE DE CREDITO|CREDITO FINANCIAMENTO E INVESTIMENTO|CREDITO E INVESTIMENTO|FINANCIAMENTO E INVESTIMENTO|FINANCIAMENTOS E INVESTIMENTOS|DE CREDITO|FINANCIAMENTOS|CREDITO|CONSIGNADO|FINANCEIRA)\b/g, '')
                                .replace(/\s+/g, ' ')
                                .trim()
                                .replace(/[,.\-]+$/, '')
                                .trim();
                            if (limpa.length > 1) resultado.add(limpa);
                        }
                    });

                    return resultado.size > 0 ? [...resultado] : ['NÃO IDENTIFICADO'];
                };

                const gerarRelatorioGenerico = (campo, titulo, isClasse = false) => {
                    fechar();
                    const dadosFinais = obterDadosConsolidados();
                    const contagem = {};
                    // Para 'reu': separa litisconsórcio e condensa nomes de instituições
                    const totalContabilizado = campo === 'reu' ? 0 : dadosFinais.length;
                    dadosFinais.forEach(item => {
                        if (campo === 'reu') {
                            const partes = normalizarEsplitarReu(item[campo]);
                            partes.forEach(val => { contagem[val] = (contagem[val] || 0) + 1; });
                        } else {
                            const val = item[campo];
                            contagem[val] = (contagem[val] || 0) + 1;
                        }
                    });
                    const arr = Object.keys(contagem).map(k => ({ nome: k, total: contagem[k] }));
                    arr.sort((a, b) => b.total - a.total);

                    const totalProcessos = dadosFinais.length;
                    const totalOcorrencias = arr.reduce((s, x) => s + x.total, 0);

                    let htmlTutela = '';
                    let textTutela = '';

                    if (isClasse) {
                        const totalTutelas = dadosFinais.filter(d => d.isTutela).length;
                        if (totalTutelas > 0) {
                            const percTutelas = ((totalTutelas / totalProcessos) * 100).toFixed(1).replace('.', ',');
                            htmlTutela = `<h4 style="color: #d9534f; margin-top: 5px; margin-bottom: 15px;">⚠️ Processos com Antecipação de Tutela: ${totalTutelas} (${percTutelas}%)</h4>`;
                            textTutela = `⚠️ Processos com Antecipação de Tutela: ${totalTutelas} (${percTutelas}%)\n\n`;
                        }
                    }

                    // Para polo passivo, base do % é total de ocorrências (pode ser > processos por litisconsórcio)
                    const basePerc = campo === 'reu' ? totalOcorrencias : totalProcessos;
                    const notaLitis = campo === 'reu' && totalOcorrencias > totalProcessos
                        ? `<p style="font-size:11px;color:#888;margin-bottom:8px;">* ${totalProcessos} processos / ${totalOcorrencias} ocorrências (litisconsórcio contabilizado por parte)</p>` : '';

                    let html = `<div style="font-family: Arial, sans-serif;"><h3 style="color: #0081c2; margin-bottom: 5px;">Relatório: ${titulo} (${totalProcessos} processos)</h3>${notaLitis}${htmlTutela}<table border="1" style="border-collapse: collapse; width: 100%; text-align: left;"><thead><tr><th style="padding: 8px;">${titulo}</th><th style="padding: 8px; text-align: center;">Ocorrências</th><th style="padding: 8px; text-align: center;">%</th></tr></thead><tbody>`;
                    let texto = `Relatório: ${titulo} (${totalProcessos} processos)\n----------------------------------------\n${textTutela}`;

                    arr.forEach(item => {
                        const perc = ((item.total / basePerc) * 100).toFixed(1).replace('.', ',');
                        html += `<tr><td style="padding: 8px;">${item.nome}</td><td style="padding: 8px; text-align: center;">${item.total}</td><td style="padding: 8px; text-align: center;">${perc}%</td></tr>`;
                        texto += `${item.nome}: ${item.total} (${perc}%)\n`;
                    });
                    html += '</tbody></table></div>';

                    copiarParaClipboard(html, texto);

                    if (typeof mostrarToast === 'function') mostrarToast(`Relatório copiado! Memória limpa.`);
                };

                document.getElementById('btn-rel-passivo').onclick = () => gerarRelatorioGenerico('reu', 'Polo Passivo', false);
                document.getElementById('btn-rel-classe').onclick = () => gerarRelatorioGenerico('classe', 'Procedimento', true);
                }; // fim abrirModalRelatorio

                if (isScanning || filaDeProcessamento.active > 0 || filaDeProcessamento.pending > 0 || filaDeProcessamento.queue.length > 0) {
                    mostrarRastreamentoPendente(abrirModalRelatorio);
                } else {
                    abrirModalRelatorio();
                }
            }; // fim onclick eproc-rel-tramitacao-btn
        }

        function renderizarBotoes() {
            const c = document.getElementById('eproc-botoes-container');
            if(!c) return;
            const todos = getTodosBotoes();
            c.innerHTML = todos.map((b, i) => {
                const custom = !b.padrao;
                const idxR = custom ? botoesPersonalizados.findIndex(x => x.label === b.label) : -1;

                if (custom) {
                    return `
                        <div class="eproc-btn-group ${modoReordenacao?'reorder-mode':''}" draggable="${modoReordenacao}" data-idx="${i}" style="margin-right:4px;">
                            <button type="button" class="eproc-btn eproc-btn-filtro-padrao eproc-btn-custom" data-val="${b.valor}" data-lbl="${b.label}" ${modoReordenacao?'style="pointer-events:none"':''}>
                                ${b.label}
                                <span class="eproc-btn-custom-x" data-rem="${idxR}" title="Excluir atalho" ${modoReordenacao?'style="pointer-events:none"':''}>✕</span>
                            </button>
                        </div>`;
                } else {
                    return `
                        <div class="eproc-btn-group ${modoReordenacao?'reorder-mode':''}" draggable="${modoReordenacao}" data-idx="${i}" style="margin-right:4px;">
                            <button type="button" class="eproc-btn eproc-btn-filtro-padrao" data-val="${b.valor}" data-lbl="${b.label}" ${modoReordenacao?'style="pointer-events:none; border-radius:6px!important;"':'style="border-radius:6px!important;"'}>${b.label}</button>
                        </div>`;
                }
            }).join('') + `
                <button type="button" id="eproc-add-btn" class="eproc-btn" title="Adicionar novo botão" style="margin-left:5px; padding:0; width:32px; height:28px; display:inline-flex; align-items:center; justify-content:center; color:#666; background:transparent; background-image:none; border-radius:6px!important;">
                    <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/></svg>
                </button>
                <button type="button" id="eproc-reo-btn" class="eproc-btn ${modoReordenacao?'ativo':''}" title="Reordenar botões" style="margin-left:5px; padding:0; width:32px; height:28px; display:inline-flex; align-items:center; justify-content:center; color:#666; font-size:16px; background:transparent; background-image:none; border-radius:6px!important;">⇆</button>
            `;

            c.querySelectorAll('[data-val]').forEach(b => b.onclick = (e) => {
                e.preventDefault();
                if(!modoReordenacao) {
                    addFiltro('texto', b.dataset.val, b.dataset.lbl, modoExclusaoAtivo);
                    aplicarFiltros();
                    if (modoExclusaoAtivo) toggleModoExclusao(false);
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

        function protegerServidorEproc() {
            const formObj = document.getElementById('frmProcessoLista');
            if (!formObj) return;

            function prepararEnvio(evento) {
                const selPagina = document.getElementById('selPagina');
                let prefPag = localStorage.getItem(LS_KEY_PAGINACAO);
                if (!prefPag) prefPag = '500';

                if (selPagina && (prefPag === '500' || prefPag === '1000')) {
                    new Promise(resolve => setTimeout(resolve, 50)).then(() => {
                        if (selPagina) selPagina.value = prefPag;
                    });
                }

                if (selPagina && formObj.action) {
                    const valorParaEnvio = (prefPag === '500' || prefPag === '1000') ? prefPag : selPagina.value;
                    if (!formObj.action.includes('selPagina=')) {
                        formObj.action += (formObj.action.includes('?') ? '&' : '?') + 'selPagina=' + valorParaEnvio;
                    }
                }

                const linhas = getLinhasProcessos();
                if (linhas.length > 0) {
                    linhas.forEach(tr => {
                        const chk = tr.querySelector('input[type="checkbox"]');
                        if (chk && !chk.checked) {
                            tr.querySelectorAll('input, select, textarea').forEach(inp => inp.disabled = true);
                        }
                    });

                    setTimeout(() => {
                        linhas.forEach(tr => {
                            tr.querySelectorAll(':disabled').forEach(inp => inp.disabled = false);
                        });
                    }, 2000);
                }
                return true;
            }

            formObj.addEventListener('submit', function(e) {
                if (!prepararEnvio(e)) e.preventDefault();
            });

            const originalSubmit = formObj.submit;
            formObj.submit = function() {
                if (prepararEnvio(null)) {
                    originalSubmit.call(this);
                }
            };
        }

        const iniciarProcessamentoDados = () => {
             gerenciarColunasEProcessos();
             setInterval(gerenciarColunasEProcessos, 2000);

             const observer = new MutationObserver((mutations) => {
                if (isScanning) return;

                const apenasMutacoesDoScript = mutations.every(m => {
                    if (m.type === 'attributes') return true;

                    if (m.type === 'childList') {
                        return Array.from(m.addedNodes).every(node =>
                            node.nodeType !== 1 ||
                            node.classList.contains('eproc-spinner') ||
                            node.classList.contains('eproc-col-data-nucleo') ||
                            node.classList.contains('eproc-col-origem-nucleo')
                        );
                    }
                    return false;
                });

                if (apenasMutacoesDoScript) return;

                if (window.eprocDebounce) clearTimeout(window.eprocDebounce);
                window.eprocDebounce = setTimeout(gerenciarColunasEProcessos, 500);
            });

            const alvoObservacao = document.getElementById('tabelaLocalizadores') || document.getElementById('frmProcessoLista') || document.body;
            observer.observe(alvoObservacao, { childList: true, subtree: true, attributes: true, attributeFilter:['style', 'class'] });
        };

        const init = () => {
            const form = document.getElementById('frmProcessoLista');
            if(form && !document.getElementById('eproc-seletor')) {
                criarInterface();
                protegerServidorEproc();
                melhorarGerenciarLocalizadores();
                restaurarPaginaAtual();
                setTimeout(iniciarProcessamentoDados, 100);

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

    // Auto Checkboxes
    (function() {
        if (!location.href.includes('acao=processo_consulta_listar')) return;

        function marcarTodosCheckboxes() {
            var count = 0;
            var prazos = document.querySelectorAll('input[name="selPrazo[]"]');
            prazos.forEach(function(cb) {
                if (!cb.checked) { cb.checked = true; count++; }
            });
            var fieldsets = document.querySelectorAll('fieldset');
            fieldsets.forEach(function(fs) {
                var tabelaProcessos = fs.querySelector('table.infraTable');
                if (tabelaProcessos) return;
                var checkboxes = fs.querySelectorAll('input[type="checkbox"].infraCheckbox');
                checkboxes.forEach(function(cb) {
                    if (cb.name && cb.name.indexOf('chkInfraItem') === 0) return;
                    if (!cb.checked) { cb.checked = true; count++; }
                });
            });
            var areasFormulario = document.querySelectorAll('#divInfraAreaDados, #divInfraAreaDados1, #fldDadosBasicos, #fldOpcoesAvancadas, #fldSuspensao');
            areasFormulario.forEach(function(area) {
                var checkboxes = area.querySelectorAll('input[type="checkbox"].infraCheckbox');
                checkboxes.forEach(function(cb) {
                    if (cb.name && cb.name.indexOf('chkInfraItem') === 0) return;
                    if (!cb.checked) { cb.checked = true; count++; }
                });
            });
            if (count > 0) console.log('[Auto Checkboxes] ' + count + ' marcado(s)');
        }

        console.log('[Auto Checkboxes] Script carregado v3.2');

        var observer = new MutationObserver(function(mutations) {
            mutations.forEach(function(mutation) {
                if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
                    mutation.addedNodes.forEach(function(node) {
                        if (node.nodeType === 1) {
                            if (node.querySelector && node.querySelector('input[type="checkbox"]')) {
                                setTimeout(marcarTodosCheckboxes, 500);
                            }
                        }
                    });
                }
            });
        });
        observer.observe(document.body, { childList: true, subtree: true });

        setInterval(marcarTodosCheckboxes, 2000);
        setTimeout(marcarTodosCheckboxes, 1000);
        setTimeout(marcarTodosCheckboxes, 2500);
        setTimeout(marcarTodosCheckboxes, 4000);
    })();



    // ===========================================================================================
    // MÓDULO: LEMBRETES DINÂMICOS
    // ===========================================================================================
    function initLembretesDinamicos() {
        if (!location.href.includes("acao=localizador_processos_lista")) return;
        if (window._lembretesIniciados) return;
        window._lembretesIniciados = true;

        const style = document.createElement('style');
        style.textContent = `
            :root { --eproc-blue: #0081c2; --eproc-blue-dark: #006a9e; --eproc-red: #d9534f; --eproc-yellow: #f39c12; --eproc-green: #5cb85c; --shadow-sm: 0 1px 3px rgba(0,0,0,0.08); --shadow-md: 0 4px 12px rgba(0,0,0,0.1); --shadow-lg: 0 10px 30px rgba(0,0,0,0.12); --radius: 10px; --radius-sm: 6px; }
            .eproc-lembretes-click { transition: transform 0.1s cubic-bezier(0.4,0,0.2,1), box-shadow 0.1s cubic-bezier(0.4,0,0.2,1), background-color 0.2s, opacity 0.2s !important; }
            .eproc-lembretes-click:active { transform: scale(0.92) !important; box-shadow: inset 0 3px 5px rgba(0,0,0,0.2) !important; }
            #lembretes-bell-btn:hover #lembretes-sino-svg { fill: var(--eproc-blue) !important; }
            #eproc-lembretes-modal { position:fixed;top:0;left:0;width:100vw;height:100vh;background:rgba(0,0,0,0.5);z-index:10000;display:flex;justify-content:center;align-items:center;backdrop-filter:blur(2px);font-family:'Roboto',Arial,sans-serif; }
            #eproc-lembretes-modal .modern-modal { background:#fff;border-radius:var(--radius);box-shadow:var(--shadow-lg);border:1px solid rgba(0,0,0,0.06);width:840px;margin:0 auto;overflow:hidden;max-height:88vh;display:flex;flex-direction:column; }
            #eproc-lembretes-modal .modern-modal-header { background:#fafbfc;padding:16px 24px;border-bottom:1px solid #eaecee;display:flex;align-items:center;justify-content:space-between;color:#1a1a1a;font-weight:600;font-size:15px;letter-spacing:0.01em;flex-shrink:0; }
            #eproc-lembretes-modal .header-title { display:flex;align-items:center;gap:10px; }
            #eproc-lembretes-modal .header-title svg { fill:var(--eproc-blue);width:20px;height:20px; }
            #eproc-lembretes-modal .btn-fechar { background:none;border:none;color:#999;font-size:26px;cursor:pointer;line-height:1;padding:0 4px;transition:color 0.15s; }
            #eproc-lembretes-modal .btn-fechar:hover { color:#333; }
            #eproc-lembretes-modal .modal-body-split { display:flex;flex-direction:row;flex:1;min-height:0;overflow:hidden; }
            #eproc-lembretes-modal .form-panel { flex:1;padding:24px;border-right:1px solid #eaecee;overflow-y:auto; }
            #eproc-lembretes-modal .form-title { font-size:11px;font-weight:700;color:var(--eproc-blue);margin-bottom:16px;text-transform:uppercase;letter-spacing:0.05em;border-bottom:2px solid var(--eproc-blue);display:inline-block;padding-bottom:4px; }
            #eproc-lembretes-modal .form-group { margin-bottom:20px; }
            #eproc-lembretes-modal .form-label { display:block;font-size:12px;font-weight:600;color:#444;margin-bottom:8px; }
            #eproc-lembretes-modal .eproc-glass-selector { display:grid;grid-template-columns:1fr 1fr;gap:10px;width:100%; }
            #eproc-lembretes-modal .glass-card { position:relative;display:flex;flex-direction:column;align-items:center;gap:4px;padding:14px 10px;border-radius:10px;cursor:pointer;background:rgba(255,255,255,0.6);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);border:1px solid rgba(255,255,255,0.8);box-shadow:0 2px 12px rgba(0,0,0,0.04),inset 0 1px 0 rgba(255,255,255,0.9);transition:all 0.35s cubic-bezier(0.16,1,0.3,1); }
            #eproc-lembretes-modal .glass-card:hover { transform:translateY(-2px);box-shadow:0 8px 28px rgba(0,0,0,0.08),inset 0 1px 0 rgba(255,255,255,0.9); }
            #eproc-lembretes-modal .glass-card.active { border-color:rgba(0,129,194,0.3);box-shadow:0 4px 20px rgba(0,129,194,0.12),inset 0 1px 0 rgba(255,255,255,0.9);background:rgba(240,247,255,0.7); }
            #eproc-lembretes-modal .glass-card .glass-icon { width:28px;height:28px;display:flex;align-items:center;justify-content:center;border-radius:8px;background:rgba(255,255,255,0.7);border:1px solid rgba(0,0,0,0.04);margin-bottom:2px; }
            #eproc-lembretes-modal .glass-card .glass-icon svg { width:16px;height:16px;fill:#666;transition:fill 0.3s; }
            #eproc-lembretes-modal .glass-card.active .glass-icon svg { fill:var(--eproc-blue); }
            #eproc-lembretes-modal .glass-card .glass-title { font-size:9px;font-weight:600;color:#333; }
            #eproc-lembretes-modal .glass-card .glass-desc { font-size:9px;color:#999;line-height:1.3;text-align:center; }
            #eproc-lembretes-modal .glass-card .glass-indicator { width:20px;height:2px;border-radius:2px;background:transparent;transition:background 0.3s;margin-top:2px; }
            #eproc-lembretes-modal .glass-card.active .glass-indicator { background:var(--eproc-blue); }
            #eproc-lembretes-modal .painel-data { display:block; }
            #eproc-lembretes-modal .painel-evento { display:none; }
            #eproc-lembretes-modal.modo-evento .painel-data { display:none; }
            #eproc-lembretes-modal.modo-evento .painel-evento { display:block; }
            #eproc-lembretes-modal .color-selector { display:flex;gap:24px;justify-content:center; }
            #eproc-lembretes-modal .color-item { display:flex;flex-direction:column;align-items:center;gap:6px;cursor:pointer; }
            #eproc-lembretes-modal .color-box { width:34px;height:34px;border-radius:8px;cursor:pointer;border:2px solid transparent;position:relative;box-shadow:0 2px 6px rgba(0,0,0,0.08);transition:all 0.2s; }
            #eproc-lembretes-modal .color-box:hover { transform:scale(1.1);box-shadow:0 4px 12px rgba(0,0,0,0.12); }
            #eproc-lembretes-modal .color-box.active { box-shadow:0 4px 10px rgba(0,0,0,0.15);transform:scale(1.12); }
            #eproc-lembretes-modal .color-box.active::after { content:"\\2713";position:absolute;color:white;font-weight:700;top:50%;left:50%;transform:translate(-50%,-50%);font-size:15px;text-shadow:0 1px 3px rgba(0,0,0,0.4); }
            #eproc-lembretes-modal .color-item span { font-size:11px;color:#777;font-weight:500; }
            #eproc-lembretes-modal .color-box.prazo { background:var(--eproc-red); }
            #eproc-lembretes-modal .color-box.lembrete { background:var(--eproc-yellow); }
            #eproc-lembretes-modal .color-box.evento { background:var(--eproc-blue); }
            #eproc-lembretes-modal textarea.modal-input, #eproc-lembretes-modal input.modal-input { width:100%;padding:10px 12px;border:1.5px solid #ddd;border-radius:var(--radius-sm);font-size:13px;font-family:inherit;box-sizing:border-box;outline:none;transition:border-color 0.2s,box-shadow 0.2s;background:#fff; }
            #eproc-lembretes-modal textarea.modal-input { resize:vertical;min-height:72px; }
            #eproc-lembretes-modal textarea.modal-input:focus, #eproc-lembretes-modal input.modal-input:focus { border-color:var(--eproc-blue);box-shadow:0 0 0 3px rgba(0,129,194,0.12); }
            #eproc-lembretes-modal .datetime-group { display:flex;gap:10px;position:relative; }
            #eproc-lembretes-modal .input-wrapper { flex:1;position:relative; }
            #eproc-lembretes-modal .input-wrapper input { width:100%;padding:9px 12px;border:1.5px solid #ddd;border-radius:var(--radius-sm);font-size:13px;color:#333;outline:none;box-sizing:border-box;font-family:inherit;transition:border-color 0.2s,box-shadow 0.2s; }
            #eproc-lembretes-modal .input-wrapper input:focus { border-color:var(--eproc-blue);box-shadow:0 0 0 3px rgba(0,129,194,0.12); }

            #evento-section { border:1.5px solid #e0e2e6;border-radius:var(--radius);padding:16px;background:#f8f9fb;margin-bottom:16px; }
            #evento-section .evento-section-title { font-size:12px;font-weight:700;color:var(--eproc-blue);margin-bottom:12px;display:flex;align-items:center;gap:6px; }
            #evento-section .evento-processo-row { display:flex;gap:8px;margin-bottom:10px; }
            #evento-section .evento-processo-row input { flex:1;padding:8px 12px;border:1.5px solid #ddd;border-radius:var(--radius-sm);font-size:13px;font-family:'Roboto',monospace;outline:none;transition:border-color 0.2s,box-shadow 0.2s; }
            #evento-section .evento-processo-row input:focus { border-color:var(--eproc-blue);box-shadow:0 0 0 3px rgba(0,129,194,0.12); }
            #evento-section .evento-btn-add { background:#fff;color:var(--eproc-blue);border:1.5px solid var(--eproc-blue);border-radius:var(--radius-sm);padding:8px 14px;font-size:12px;font-weight:600;cursor:pointer;white-space:nowrap;transition:all 0.15s; }
            #evento-section .evento-btn-add:hover { background:#eef8fa;border-color:var(--eproc-blue-dark); }
            #evento-section .evento-tags { display:flex;flex-wrap:wrap;gap:5px;min-height:28px;margin-bottom:12px;padding:6px 8px;background:#fff;border-radius:var(--radius-sm);border:1px dashed #d0d4da; }
            #evento-section .evento-tags:empty { display:none; }
            #evento-section .evento-tag-processo, #evento-section .evento-tag { display:inline-flex;align-items:center;gap:5px;padding:3px 8px 3px 10px;font-size:11px;font-weight:600;border-radius:20px;line-height:1.4; }
            #evento-section .evento-tag-processo { background:#fff3e0;color:#e65100;border:1px solid #ffb74d; }
            #evento-section .evento-tag { background:#e3f2fd;color:var(--eproc-blue);border:1px solid var(--eproc-blue); }
            #evento-section .evento-tag-remove { cursor:pointer;font-size:14px;line-height:1;opacity:0.35;transition:opacity 0.15s; }
            #evento-section .evento-tag-remove:hover { opacity:1;color:var(--eproc-red); }
            #evento-section .evento-search { width:100%;padding:8px 12px 8px 34px;border:1.5px solid #ddd;border-radius:var(--radius-sm);font-size:13px;outline:none;font-family:inherit;transition:border-color 0.2s,box-shadow 0.2s;background:#fff url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='15' height='15' viewBox='0 0 24 24' fill='%23999'%3E%3Cpath d='M15.5 14h-.79l-.28-.27C15.41 12.59 16 11.11 16 9.5 16 5.91 13.09 3 9.5 3S3 5.91 3 9.5 5.91 16 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z'/%3E%3C/svg%3E") no-repeat 12px center; }
            #evento-section .evento-search:focus { border-color:var(--eproc-blue);box-shadow:0 0 0 3px rgba(0,129,194,0.12); }
            #evento-section .evento-counter { font-size:11px;color:#888;margin:6px 0 10px; }
            #evento-section .evento-list { max-height:170px;overflow-y:auto;border:1.5px solid #e8eaed;border-radius:var(--radius-sm);background:#fff; }
            #evento-section .evento-list::-webkit-scrollbar { width:5px; }
            #evento-section .evento-list::-webkit-scrollbar-track { background:#f5f5f5;border-radius:6px; }
            #evento-section .evento-list::-webkit-scrollbar-thumb { background:#ccc;border-radius:6px; }
            #evento-section .evento-item { display:flex;align-items:center;gap:8px;padding:5px 10px;font-size:12px;color:#444;cursor:pointer;transition:background 0.12s;border-bottom:1px solid #f0f1f3; }
            #evento-section .evento-item:last-child { border-bottom:none; }
            #evento-section .evento-item.checked { background:#e3f2fd; }
            #evento-section .evento-item:hover { background:#eef8fa; }
            #evento-section .evento-item input[type="checkbox"] { margin:0;cursor:pointer;flex-shrink:0;accent-color:var(--eproc-blue); }
            #evento-section .evento-item .evento-text { flex:1;line-height:1.3; }
            #evento-section .evento-item .evento-text-wrap { flex:1;display:flex;flex-direction:column;min-width:0; }
            #evento-section .evento-item .evento-sub { font-size:10px;color:#9ca3af;line-height:1.3;margin-top:1px; }
            .dica { background:#f0f7ff;border-left:3px solid var(--eproc-blue);border-radius:4px;padding:8px 10px;margin-top:8px;font-size:11.5px;color:#444;line-height:1.6; }
            .dica strong { color:var(--eproc-blue); }
            .dica-lamp { display:flex;align-items:flex-start;gap:7px;background:#f5f7fa;border:1px solid #e0e4e8;border-radius:var(--radius-sm);padding:7px 10px;margin-top:6px;font-size:11px;color:#666; }
            .dica-lamp svg { fill:var(--eproc-yellow);flex-shrink:0;margin-top:1px; }
            #eproc-lembretes-modal .modal-actions { display:flex;justify-content:flex-end;gap:10px;margin-top:24px;padding-top:16px;border-top:1px solid #eaecee; }
            #eproc-lembretes-modal .btn-cancelar { background:#fff;color:#666;border:1.5px solid #ddd;border-radius:var(--radius-sm);padding:9px 18px;font-size:13px;font-weight:500;cursor:pointer;transition:all 0.15s; }
            #eproc-lembretes-modal .btn-cancelar:hover { background:#f8f8f8;color:#333;border-color:#ccc; }
            #eproc-lembretes-modal .btn-salvar { background:var(--eproc-blue);color:#fff;border:none;border-radius:var(--radius-sm);padding:9px 20px;font-size:13px;font-weight:600;cursor:pointer;transition:all 0.15s; }
            #eproc-lembretes-modal .btn-salvar:hover { background:var(--eproc-blue-dark);box-shadow:0 4px 12px rgba(0,129,194,0.3); }
            #eproc-lembretes-modal .list-panel { width:300px;padding:24px 20px;background:#fafbfc;overflow-y:auto; }
            #eproc-lembretes-modal .list-panel::-webkit-scrollbar { width:5px; }
            #eproc-lembretes-modal .list-panel::-webkit-scrollbar-track { background:#f5f5f5;border-radius:6px; }
            #eproc-lembretes-modal .list-panel::-webkit-scrollbar-thumb { background:#ccc;border-radius:6px; }
            #eproc-lembretes-modal .list-title { font-size:12px;font-weight:600;color:#555;margin-bottom:16px;text-transform:uppercase;letter-spacing:0.03em; }
            #eproc-lembretes-modal .lembrete-item { background:#fff;border:1px solid #eaecee;border-radius:var(--radius-sm);padding:12px;margin-bottom:10px;box-shadow:0 1px 3px rgba(0,0,0,0.04);transition:box-shadow 0.15s; }
            #eproc-lembretes-modal .lembrete-item:last-child { margin-bottom:0; }
            #eproc-lembretes-modal .lembrete-item:hover { box-shadow:0 3px 8px rgba(0,0,0,0.06); }
            #eproc-lembretes-modal .lembrete-info { font-size:12px;line-height:1.5;color:#555; }
            #eproc-lembretes-modal .lembrete-info strong { font-size:12px;text-transform:uppercase;letter-spacing:0.03em; }
            #eproc-lembretes-modal .lembrete-date { font-size:11px;color:#999;margin-top:4px;display:block; }
            #eproc-lembretes-modal .lembrete-evento-detail { font-size:10px;color:var(--eproc-blue);margin-top:6px;padding:4px 8px;background:#e3f2fd;border-radius:4px;display:inline-block;line-height:1.4; }
            #eproc-lembretes-modal .lembrete-actions { display:flex;gap:4px;margin-top:8px;justify-content:flex-end; }
            #eproc-lembretes-modal .btn-mini { width:28px;height:28px;border-radius:var(--radius-sm);border:none;background:transparent;cursor:pointer;color:#888;display:inline-flex;align-items:center;justify-content:center;transition:all 0.15s; }
            #eproc-lembretes-modal .btn-mini:hover { background:#eee;color:var(--eproc-blue); }
            #eproc-lembretes-modal .btn-mini.danger:hover { color:var(--eproc-red); }
            #eproc-lembretes-modal .btn-mini svg { width:15px;height:15px;fill:currentColor; }
            #eproc-lembretes-container .btn-mini { width:28px;height:28px;border-radius:var(--radius-sm);border:none;background:transparent;cursor:pointer;color:#888;display:inline-flex;align-items:center;justify-content:center;transition:all 0.15s; }
            #eproc-lembretes-container .btn-mini:hover { background:#eee;color:var(--eproc-blue); }
            #eproc-lembretes-container .btn-mini svg { width:15px;height:15px;fill:currentColor; }
            #eproc-lembretes-container { position:fixed;top:80px;right:20px;display:flex;flex-direction:column;gap:15px;z-index:9998;font-family:'Roboto',Arial,sans-serif; }
            #eproc-lembretes-container .eproc-postit { width:370px;padding:18px;font-size:13px;color:#333;background:#fff;border-radius:14px;border:1px solid rgba(0,0,0,0.06);box-shadow:0 1px 3px rgba(0,0,0,0.04),0 4px 16px rgba(0,0,0,0.06),8px 8px 28px rgba(0,0,0,0.06),-4px -4px 16px rgba(255,255,255,0.9);position:relative;overflow:visible;animation:postit-in 0.4s cubic-bezier(0.16,1,0.3,1);word-break:break-word; }
            #eproc-lembretes-container .eproc-postit.postit-hidden { display:none; }
            #eproc-lembretes-container .eproc-postit::before { content:'';position:absolute;top:0;left:0;width:6px;height:100%;background:linear-gradient(to bottom,transparent 0%,var(--postit-color,var(--eproc-blue)) 6%,var(--postit-color,var(--eproc-blue)) 94%,transparent 100%);border-radius:14px 0 0 14px;box-shadow:2px 0 8px -3px rgba(0,0,0,0.25),inset -1px 0 2px rgba(255,255,255,0.3); }
            #eproc-lembretes-container .eproc-postit::after { content:'';position:absolute;top:0;left:0;width:6px;height:100%;border-radius:14px 0 0 14px;background:linear-gradient(to right,rgba(255,255,255,0.12) 0%,transparent 50%,rgba(0,0,0,0.08) 100%);pointer-events:none; }
            @keyframes postit-in { 0%{transform:translateX(40px);opacity:0;} 100%{transform:translateX(0);opacity:1;} }
            @keyframes postit-out { 0%{opacity:1;transform:translateX(0);} 100%{opacity:0;transform:translateX(20px);} }
            #eproc-lembretes-container .eproc-postit-header { font-weight:600;margin-bottom:10px;display:flex;justify-content:space-between;align-items:center;font-size:12px; }
            #eproc-lembretes-container .eproc-postit-body { line-height:1.6;font-size:13px;font-weight:700; }
            #eproc-lembretes-container .eproc-postit-link { color:var(--eproc-blue);font-weight:600;text-decoration:none;border-bottom:1px dotted var(--eproc-blue); }
            #eproc-lembretes-container .eproc-postit-link:hover { border-bottom-style:solid; }
            #eproc-lembretes-container .snooze-wrapper { position:relative;display:inline-flex; }
            #eproc-lembretes-container .snooze-dropdown { position:absolute;top:100%;right:0;margin-top:4px;background:#fff;border:1px solid #e0e2e6;border-radius:var(--radius-sm);box-shadow:0 6px 20px rgba(0,0,0,0.12);min-width:170px;z-index:99999;padding:4px 0;display:none; }
            #eproc-lembretes-container .snooze-dropdown.open { display:block; }
            #eproc-lembretes-container .snooze-dropdown-item { padding:8px 14px;font-size:12px;color:#333;cursor:pointer;display:flex;align-items:center;gap:8px;transition:background 0.12s;border:none;background:none;width:100%;text-align:left;font-family:inherit; }
            #eproc-lembretes-container .snooze-dropdown-header { padding:8px 14px 4px;font-size:11px;font-weight:600;color:#888; }
            #eproc-lembretes-container .snooze-dropdown-item:hover { background:#f0f7ff;color:var(--eproc-blue); }
            #eproc-lembretes-container .snooze-dropdown-item svg { width:14px;height:14px;fill:#888;flex-shrink:0; }
            #eproc-lembretes-container .snooze-dropdown-item:hover svg { fill:var(--eproc-blue); }
            #eproc-lembretes-container .snooze-divider { height:1px;background:#eaecee;margin:4px 0; }
            #eproc-lembretes-container .eproc-postit-evento { font-size:11px;color:var(--eproc-blue);margin-top:10px;padding:8px 10px;background:#e3f2fd;border-radius:var(--radius-sm);line-height:1.5; }
            @keyframes pulse-neon { 0%{box-shadow:0 0 0 0 rgba(217,83,79,0.6);} 70%{box-shadow:0 0 0 10px rgba(0,0,0,0);} 100%{box-shadow:0 0 0 0 rgba(0,0,0,0);} }
            .evento-any-row { display:flex;align-items:center;justify-content:space-between;padding:12px 14px;margin:12px 0 4px;border-radius:8px;background:#fff;border:1.5px solid #e4e7eb;cursor:pointer;transition:all 0.25s cubic-bezier(0.16,1,0.3,1);position:relative; }
            .evento-any-row:hover { border-color:var(--eproc-blue);box-shadow:0 4px 16px rgba(0,129,194,0.08); }
            .evento-any-row:active { transform:scale(0.99); }
            .evento-any-row.active { border-color:var(--eproc-blue);background:#f5faff;box-shadow:0 4px 20px rgba(0,129,194,0.10); }
            .evento-any-left { display:flex;align-items:center;gap:10px; }
            .evento-any-icon { width:32px;height:32px;border-radius:8px;display:flex;align-items:center;justify-content:center;background:#f0f4f8;border:1px solid #e4e7eb;flex-shrink:0;transition:all 0.25s; }
            .evento-any-icon svg { width:16px;height:16px;fill:#7a828e;transition:fill 0.25s; }
            .evento-any-row.active .evento-any-icon { background:#e3f2fd;border-color:rgba(0,129,194,0.2); }
            .evento-any-row.active .evento-any-icon svg { fill:var(--eproc-blue); }
            .evento-any-label { font-size:12px;font-weight:600;color:#1a1a1a;transition:color 0.25s; }
            .evento-any-row.active .evento-any-label { color:var(--eproc-blue); }
            .evento-any-desc { font-size:10px;color:#8a929e;margin-top:1px; }
        `;
        document.head.appendChild(style);

        const EPROC_EVENTS = [
            "Intimação/Citação/Notificação","Juntada/Petição/Manifestação/Procuração/Habilitação/Certidão","Recurso/Apelação/Agravo/Embargos","Sentença/Acórdão/Julgamento","Decisão/Despacho","Ação rescisória","Acordo/Conciliação","Admissão","Alegações finais","Alteração","Alvará","Anulação","Arquivamento","Ato ordinatório","Audiência","Avaliação","Baixa","Bloqueio","Cálculo","Carta de ordem/Carta precatória","Conclusos","Confissão","Contestação","Contrarrazões","Conversão","Cumprimento de sentença","Custas","Depoimento","Desarquivamento","Desistência","Desmembramento","Distribuído","Exceção","Execução","Expedida","Extinção","Fiança","Gratuidade","Habeas corpus/Mandado de segurança","Homologação","Honorários","Impugnação","Incidente","Indulto","Interrogatório","Laudo","Liberdade provisória","Liminar","Livramento condicional","Mandado/Ofício","Nomeação","Parecer","Pauta","Penhora","Perícia","Precatório","Prisão","Progressão de regime","Publicação","Recebidos os autos","Reclamação","Remessa/Remetidos","Renúncia","Réplica","Revelia","RPV","Sustentação oral","Suspensão","Transação penal","Trânsito em julgado","Tutela provisória","Vista"
        ];

        const EVENT_DISPLAY_NAMES = {
            "Intimação/Citação/Notificação": "Intimação",
            "Juntada/Petição/Manifestação/Procuração/Habilitação/Certidão": "Petição",
            "Recurso/Apelação/Agravo/Embargos": "Recursos",
            "Sentença/Acórdão/Julgamento": "Sentença"
        };

        const dbName = 'EprocLembretesDB'; const storeName = 'lembretes'; let db;
        const openDB = () => new Promise((resolve, reject) => {
            const req = indexedDB.open(dbName, 2);
            req.onupgradeneeded = (e) => {
                const d = e.target.result;
                if (!d.objectStoreNames.contains(storeName)) {
                    d.createObjectStore(storeName, { keyPath: 'id', autoIncrement: true });
                }
            };
            req.onsuccess = (e) => { db = e.target.result; resolve(db); };
            req.onerror = (e) => reject(e.target.error);
        });
        const getAllLembretes = async () => { await openDB(); return new Promise((res, rej) => { const r = db.transaction(storeName,'readonly').objectStore(storeName).getAll(); r.onsuccess = () => res(r.result||[]); r.onerror = () => rej(r.error); }); };
        const saveLembrete = async (l) => { await openDB(); return new Promise((res, rej) => { const r = db.transaction(storeName,'readwrite').objectStore(storeName)[l.id?'put':'add'](l); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }); };
        const deleteLembrete = async (id) => { await openDB(); return new Promise((res, rej) => { const r = db.transaction(storeName,'readwrite').objectStore(storeName).delete(id); r.onsuccess = () => res(); r.onerror = () => rej(r.error); }); };


        function removerAcentosEv(str) { return str?str.normalize("NFD").replace(/[\u0300-\u036f]/g,""):""; }

        let bellBtn;
        const insertBell = () => {
            if (document.getElementById('lembretes-bell-btn')) return;

            // Inserir na divInfraBarraLocalizacao, à esquerda do ícone "?" (Ajuda)
            const barra = document.getElementById('divInfraBarraLocalizacao');
            if (!barra) {
                if (!window._lembretesBellRetry) {
                    window._lembretesBellRetry = true;
                    setTimeout(() => {
                        window._lembretesBellRetry = false;
                        insertBell();
                    }, 500);
                }
                return;
            }

            // Encontra o container flex (d-flex) dentro da barra
            const flexContainer = barra.querySelector('.d-flex') || barra.querySelector('div[class*="d-flex"]');
            if (!flexContainer) {
                setTimeout(insertBell, 500);
                return;
            }

            // Encontra o span.dropleft que contém o ícone "?"
            const dropSpan = flexContainer.querySelector('span.dropleft') || flexContainer.querySelector('a[aria-label="Ajuda"]')?.closest('span') || flexContainer.querySelector('[aria-label="Ajuda"]')?.parentElement;
            if (!dropSpan) {
                setTimeout(insertBell, 500);
                return;
            }

            // Cria um wrapper flex para agrupar o sino e o "?" à direita
            const rightWrapper = document.createElement('span');
            rightWrapper.style.cssText = 'display:inline-flex;align-items:center;margin-left:auto;';

            // Cria o botão do sino
            bellBtn = document.createElement('a');
            bellBtn.id = 'lembretes-bell-btn';
            bellBtn.className = 'eproc-lembretes-click';
            bellBtn.style.cssText = 'cursor:pointer;display:inline-flex;align-items:center;justify-content:center;padding:0.25rem 0.5rem;margin-right:6px;position:relative;';
            bellBtn.innerHTML = `<div style="display:flex;align-items:center;"><svg id="lembretes-sino-svg" viewBox="0 0 24 24" style="width:20px;height:20px;fill:none;stroke:var(--eproc-blue);stroke-width:2;transition:all 0.2s;"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.73 21a2 2 0 0 1-3.46 0"></path></svg><span id="eproc-sino-badge" style="display:none;position:absolute;top:4px;right:8px;width:9px;height:9px;border-radius:50%;background:var(--eproc-red);animation:pulse-neon 2s infinite;"></span></div>`;
            bellBtn.onclick = (e) => { e.preventDefault(); e.stopPropagation(); openDashboard(); };

            // Monta o wrapper: sino + "?"
            rightWrapper.appendChild(bellBtn);
            rightWrapper.appendChild(dropSpan.cloneNode(true));

            // Substitui o dropSpan original pelo wrapper
            dropSpan.parentNode.replaceChild(rightWrapper, dropSpan);
        };

        const updateSino = () => {
            if (!bellBtn) return;
            const badge = document.getElementById('eproc-sino-badge');
            const svg = document.getElementById('lembretes-sino-svg');
            const postits = document.querySelectorAll('#eproc-lembretes-container .eproc-postit[data-lembrete-id]');
            if (badge && svg) {
                if (postits.length > 0) {
                    badge.style.display = 'block';
                    svg.style.fill = 'var(--eproc-blue)';
                } else { badge.style.display = 'none'; svg.style.fill = 'none'; }
            }
        };

        let editId = null, selectedEvents = new Set(), linkedProcesses = new Set(), selectedProcessInput = '', qualquerEvento = false;

        if (!document.getElementById('eproc-lembretes-container')) {
            const postitContainer = document.createElement('div');
            postitContainer.id = 'eproc-lembretes-container';
            document.body.appendChild(postitContainer);
        }

        const modalHtml = `<div id="eproc-lembretes-modal" style="display:none;"><div class="modern-modal"><div class="modern-modal-header"><div class="header-title"><svg viewBox="0 0 24 24"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.73 21a2 2 0 0 1-3.46 0"></path></svg> Lembretes Din\u00e2micos</div><div style="display:flex;align-items:center;gap:15px;"><button class="btn-fechar" id="btn-close-dashboard">&times;</button></div></div><div class="modal-body-split"><div class="form-panel"><div class="form-title" id="form-lembrete-title">Criar Lembrete</div><div class="form-group"><label class="form-label">Categoria do Lembrete</label><div class="color-selector" id="color-selector"><div class="color-item"><div class="color-box prazo active" data-type="PRAZO"></div><span>Prazo</span></div><div class="color-item"><div class="color-box lembrete" data-type="LEMBRETE"></div><span>Lembrete</span></div><div class="color-item"><div class="color-box evento" data-type="EVENTO"></div><span>Evento</span></div></div></div><div class="form-group"><label class="form-label">Tipo de Disparo</label><div class="eproc-glass-selector"><div class="glass-card active" data-modo="data"><div class="glass-icon"><svg viewBox="0 0 24 24"><path d="M19 3h-1V1h-2v2H8V1H6v2H5c-1.11 0-1.99.9-1.99 2L3 19c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 16H5V8h14v11zM9 10H7v2h2v-2zm4 0h-2v2h2v-2zm4 0h-2v2h2v-2z"/></svg></div><div class="glass-title">Data Certa</div><div class="glass-desc">Disparo em data fixa</div><div class="glass-indicator"></div></div><div class="glass-card" data-modo="evento"><div class="glass-icon"><svg viewBox="0 0 24 24"><path d="M9 10H7v2h2v-2zm4 0h-2v2h2v-2zm4 0h-2v2h2v-2zM19 3h-1V1h-2v2H8V1H6v2H5c-1.11 0-1.99.9-1.99 2L3 19c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 16H5V8h14v11z"/></svg></div><div class="glass-title">Evento EPROC</div><div class="glass-desc">Disparo por movimentação</div><div class="glass-indicator"></div></div></div></div><div class="painel-data"><div class="form-group"><label class="form-label">Data e Hora</label><div class="datetime-group"><div class="input-wrapper"><input type="date" id="lembrete-data"></div><div class="input-wrapper"><input type="time" id="lembrete-hora" step="60"></div></div><div class="dica"><strong>Sem data definida?</strong> O lembrete aparecer\u00e1 amanh\u00e3 a partir das 06:00.</div><div class="dica"><strong>Sem hora definida?</strong> O lembrete aparecer\u00e1 \u00e0s 06:00 do dia selecionado.</div></div></div><div class="painel-evento"><div id="evento-section"><div class="evento-section-title">Vincular a Eventos do Sistema</div><div class="dica" style="margin-bottom:12px;">\uD83D\uDD17 Para vincular seu lembrete a um ou mais eventos do sistema, digite o n\u00famero de, pelo menos, um processo.</div><div class="evento-processo-row"><input type="text" id="evento-processo-input" placeholder="Ex: 1001275-76.2026.8.13.0079"><button class="evento-btn-add" id="evento-btn-add-processo">+ Vincular</button></div><div class="evento-tags" id="evento-processo-tags"></div><input type="text" class="evento-search" id="evento-search-input" placeholder="Buscar eventos... (digite para filtrar)"><div class="evento-counter"><span id="evento-count">0</span> eventos encontrados</div><div class="evento-list" id="evento-list"></div><div class="evento-tags" id="evento-selected-tags"></div><label class="evento-any-row" id="evento-any-row"><div class="evento-any-left"><div class="evento-any-icon"><svg viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/></svg></div><div><div class="evento-any-label">Qualquer evento que ocorra neste(s) processo(s)</div><div class="evento-any-desc">O alerta ser\u00e1 disparado para toda e qualquer movimenta\u00e7\u00e3o processual</div></div></div><input type="checkbox" id="evento-any-checkbox" style="display:none"></label></div></div><div class="form-group" style="margin-top:4px;"><label class="form-label">Texto do Lembrete</label><textarea id="lembrete-texto" class="modal-input" placeholder="Ex: Verificar se houve movimenta\u00e7\u00e3o de baixa definitiva..."></textarea><div class="dica-lamp"><svg width="14" height="14" viewBox="0 0 24 24"><path d="M9 21c0 .55.45 1 1 1h4c.55 0 1-.45 1-1v-1H9v1zm3-19C8.14 2 5 5.14 5 9c0 2.38 1.19 4.47 3 5.74V17c0 .55.45 1 1 1h6c.55 0 1-.45 1-1v-2.26c1.81-1.27 3-3.36 3-5.74 0-3.86-3.14-7-7-7zm2.85 11.1l-.85.6V16h-4v-2.3l-.85-.6C7.8 12.16 7 10.63 7 9c0-2.76 2.24-5 5-5s5 2.24 5 5c0 1.63-.8 3.16-2.15 4.1z"/></svg><span>N\u00fameros de processo aparecer\u00e3o como <strong>links diretos</strong> no post-it.</span></div></div><div class="modal-actions"><button class="btn-cancelar" id="btn-cancelar-lembrete">Cancelar</button><button class="btn-salvar" id="btn-salvar-lembrete">Salvar</button></div></div><div class="list-panel"><div class="list-title">Lembretes Ativos</div><div id="lembretes-list-container"></div></div></div></div>`;
        document.body.insertAdjacentHTML('beforeend', modalHtml);

        const modal = document.getElementById('eproc-lembretes-modal');
        const listContainer = document.getElementById('lembretes-list-container');
        const txtData = document.getElementById('lembrete-data');
        const txtHora = document.getElementById('lembrete-hora');
        const txtTexto = document.getElementById('lembrete-texto');
        txtHora.addEventListener('input', function(e) { let v = e.target.value.replace(/\D/g,''); if(v.length>2) v=v.substring(0,2)+':'+v.substring(2,4); e.target.value=v; });

        const eventoProcessoInput = document.getElementById('evento-processo-input');
        const eventoBtnAdd = document.getElementById('evento-btn-add-processo');
        const eventoProcessoTags = document.getElementById('evento-processo-tags');
        const eventoSearchInput = document.getElementById('evento-search-input');
        const eventoCount = document.getElementById('evento-count');
        const eventoList = document.getElementById('evento-list');
        const eventoSelectedTags = document.getElementById('evento-selected-tags');
        const eventoAnyCheckbox = document.getElementById('evento-any-checkbox');
        const eventoAnyRow = document.getElementById('evento-any-row');

        if (eventoAnyCheckbox) {
            eventoAnyCheckbox.addEventListener('change', function() {
                qualquerEvento = this.checked;
                if (eventoAnyRow) eventoAnyRow.classList.toggle('active', this.checked);
                eventoSearchInput.disabled = this.checked;
                eventoList.style.pointerEvents = this.checked ? 'none' : '';
                eventoList.style.opacity = this.checked ? '0.35' : '1';
                eventoSearchInput.style.opacity = this.checked ? '0.35' : '1';
                if (eventoCount) eventoCount.style.opacity = this.checked ? '0.35' : '1';
                if (this.checked) {
                    selectedEvents.clear();
                    renderEventTags();
                    renderEventList(eventoSearchInput.value, selectedEvents);
                }
            });
        }

        document.querySelectorAll('#color-selector .color-box').forEach(box => { box.addEventListener('click', () => { document.querySelectorAll('#color-selector .color-box').forEach(b => b.classList.remove('active')); box.classList.add('active'); }); });

        // Glass card toggle
        document.querySelector('#eproc-lembretes-modal .eproc-glass-selector')?.addEventListener('click', (e) => {
            const card = e.target.closest('.glass-card');
            if (!card) return;
            document.querySelectorAll('#eproc-lembretes-modal .glass-card').forEach(c => c.classList.remove('active'));
            card.classList.add('active');
            const isEvento = card.dataset.modo === 'evento';
            document.getElementById('eproc-lembretes-modal').classList.toggle('modo-evento', isEvento);
            if (isEvento && eventoList.children.length === 0) renderEventList('', selectedEvents);
        });

        // Event search
        function renderEventList(filter, selected) {
            const f = filter ? EPROC_EVENTS.filter(e => {
                const raw = removerAcentosEv(e.toUpperCase());
                const dn = EVENT_DISPLAY_NAMES[e];
                const dnClean = dn ? removerAcentosEv(dn.toUpperCase()) : '';
                const fClean = removerAcentosEv(filter.toUpperCase());
                return raw.includes(fClean) || (dnClean && dnClean.includes(fClean));
            }) : EPROC_EVENTS;
            eventoCount.textContent = f.length;
            const fragment = document.createDocumentFragment();
            f.forEach(e => {
                const label = document.createElement('label'); label.className = 'evento-item';
                if (selected && selected.has(e)) label.classList.add('checked');
                const cb = document.createElement('input'); cb.type = 'checkbox'; cb.value = e;
                if (selected && selected.has(e)) cb.checked = true;
                const displayName = EVENT_DISPLAY_NAMES[e];
                if (displayName) {
                    const wrap = document.createElement('div'); wrap.className = 'evento-text-wrap';
                    const nameSpan = document.createElement('span'); nameSpan.className = 'evento-text'; nameSpan.textContent = displayName;
                    const subSpan = document.createElement('span'); subSpan.className = 'evento-sub'; subSpan.textContent = e;
                    wrap.appendChild(nameSpan); wrap.appendChild(subSpan);
                    label.appendChild(cb); label.appendChild(wrap);
                } else {
                    const span = document.createElement('span'); span.className = 'evento-text'; span.textContent = e;
                    label.appendChild(cb); label.appendChild(span);
                }
                label.addEventListener('change', function() {
                    const ch = this.querySelector('input[type="checkbox"]');
                    this.classList.toggle('checked', ch.checked);
                    if (ch.checked) selectedEvents.add(ch.value); else selectedEvents.delete(ch.value);
                    renderEventTags();
                });
                fragment.appendChild(label);
            });
            eventoList.innerHTML = '';
            eventoList.appendChild(fragment);
        }

        function renderEventTags() {
            eventoSelectedTags.innerHTML = '';
            selectedEvents.forEach(e => {
                const tag = document.createElement('span'); tag.className = 'evento-tag';
                tag.innerHTML = `${EVENT_DISPLAY_NAMES[e] || e} <span class="evento-tag-remove">&times;</span>`;
                tag.querySelector('.evento-tag-remove').onclick = () => { selectedEvents.delete(e); renderEventTags(); renderEventList(eventoSearchInput.value, selectedEvents); };
                eventoSelectedTags.appendChild(tag);
            });
        }

        let searchDebounce;
        eventoSearchInput.addEventListener('input', function() {
            clearTimeout(searchDebounce);
            searchDebounce = setTimeout(() => renderEventList(this.value, selectedEvents), 150);
        });

        // Process vinculação
        function renderProcessTags() {
            eventoProcessoTags.innerHTML = '';
            linkedProcesses.forEach(p => {
                const tag = document.createElement('span'); tag.className = 'evento-tag-processo';
                tag.innerHTML = `${formatNumProcesso(p)} <span class="evento-tag-remove">&times;</span>`;
                tag.querySelector('.evento-tag-remove').onclick = () => { linkedProcesses.delete(p); renderProcessTags(); };
                eventoProcessoTags.appendChild(tag);
            });
        }

        function limparNumProcesso(num) {
            return num.replace(/\D/g,'');
        }

        eventoBtnAdd.addEventListener('click', function() {
            const val = eventoProcessoInput.value.trim();
            if (!val) return;
            const clean = limparNumProcesso(val);
            if (clean.length < 15) { return; }
            linkedProcesses.add(clean);
            eventoProcessoInput.value = '';
            renderProcessTags();
        });
        eventoProcessoInput.addEventListener('keydown', function(e) {
            if (e.key === 'Enter') { e.preventDefault(); eventoBtnAdd.click(); }
        });

        const resetForm = () => {
            editId=null; txtTexto.value=''; txtData.value=''; txtHora.value='';
            selectedEvents.clear(); linkedProcesses.clear(); selectedProcessInput = '';
            eventoProcessoInput.value = ''; eventoSearchInput.value = '';
            renderEventTags(); renderProcessTags(); renderEventList('', selectedEvents);
            document.getElementById('form-lembrete-title').textContent='Criar Lembrete';
            document.getElementById('btn-cancelar-lembrete').textContent='Cancelar';
            document.querySelectorAll('#color-selector .color-box').forEach(b=>b.classList.remove('active'));
            document.querySelector('#color-selector .color-box[data-type="LEMBRETE"]').classList.add('active');
            document.querySelector('#eproc-lembretes-modal .glass-card[data-modo="data"]')?.classList.add('active');
            document.querySelector('#eproc-lembretes-modal .glass-card[data-modo="evento"]')?.classList.remove('active');
            document.getElementById('eproc-lembretes-modal').classList.remove('modo-evento');
            qualquerEvento = false;
            if (eventoAnyCheckbox) { eventoAnyCheckbox.checked = false; if (eventoAnyRow) eventoAnyRow.classList.remove('active'); }
            eventoSearchInput.disabled = false;
            eventoList.style.pointerEvents = '';
            eventoList.style.opacity = '1';
            if (eventoCount) eventoCount.style.opacity = '1';
            eventoSearchInput.style.opacity = '1';
        };

        const formatDate = (isoStr) => { const d=new Date(isoStr); return `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${d.getFullYear()} \u00e0s ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`; };

        const formatCardDate = (isoStr) => { const d=new Date(isoStr); return `\u23f0 ${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${d.getFullYear()}, ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`; };

        const formatNumProcesso = (num) => { const d=num.replace(/\D/g,''); if(d.length!==20) return num; return `${d.slice(0,7)}-${d.slice(7,9)}.${d.slice(9,13)}.${d.slice(13,14)}.${d.slice(14,16)}.${d.slice(16,20)}`; };

        const renderList = async () => {
            listContainer.innerHTML = '';
            const all = await getAllLembretes();
            const ativos = all.filter(l => l.status === 'ativo').sort((a,b) => new Date(a.datetime) - new Date(b.datetime));
            if (ativos.length === 0) { listContainer.innerHTML = '<div style="text-align:center;padding:20px;color:#999;font-size:12px;">Nenhum lembrete ativo.</div>'; return; }
            document.querySelector('#lembretes-list-container').previousElementSibling.textContent = `Lembretes Ativos (${ativos.length})`;
            ativos.forEach(l => {
                const colors = { 'PRAZO':'var(--eproc-red)', 'LEMBRETE':'var(--eproc-yellow)', 'EVENTO':'var(--eproc-blue)' };
                const c = colors[l.type] || colors['LEMBRETE'];
                const div = document.createElement('div'); div.className = 'lembrete-item'; div.style.borderLeft = `4px solid ${c}`;
                let snippet = l.text.length > 50 ? l.text.substring(0,50)+'...' : l.text;
                let metaHtml = '';
                if (l.linkedEvents?.length) {
                    const processNums = (l.linkedProcess || '').split(',').filter(Boolean).map(p => formatNumProcesso(p));
                    const processCount = processNums.length;
                    const processStr = processCount === 1 ? processNums[0] : processNums.join(', ');
                    const eventList = l.anyEvent ? 'Qualquer evento' : l.linkedEvents.map(e => {
                        const dn = EVENT_DISPLAY_NAMES[e] || e;
                        return `"${dn.length > 30 ? dn.substring(0,30)+'...' : dn}"`;
                    }).join(', ');
                    metaHtml = `<div class="lembrete-evento-detail">\u2696\ufe0f ${processCount} processo${processCount !== 1 ? 's' : ''} (${processStr}) \u2022 ${l.anyEvent ? 'qualquer' : l.linkedEvents.length} evento${!l.anyEvent && l.linkedEvents.length !== 1 ? 's' : ''}: ${eventList}</div>`;
                } else {
                    metaHtml = `<span class="lembrete-date">${formatCardDate(l.datetime)}</span>`;
                }
                div.innerHTML = `<div class="lembrete-info"><strong style="color:${c};">${l.type}</strong> \u2014 <b>${snippet}</b>${metaHtml}</div><div class="lembrete-actions"><button class="btn-mini" title="Editar"><svg viewBox="0 0 24 24"><path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/></svg></button><button class="btn-mini danger" title="Excluir"><svg viewBox="0 0 24 24"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg></button></div>`;
                div.querySelector('.btn-mini').onclick = () => {
                    editId = l.id; txtTexto.value = l.text;
                    const d = new Date(l.datetime);
                    txtData.value = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
                    txtHora.value = `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
                    document.querySelectorAll('#color-selector .color-box').forEach(b => b.classList.remove('active'));
                    const sb = document.querySelector(`#color-selector .color-box[data-type="${l.type}"]`);
                    if (sb) sb.classList.add('active');
                    if (l.linkedProcess) {
                        linkedProcesses.clear(); l.linkedProcess.split(',').filter(Boolean).forEach(p => linkedProcesses.add(p));
                        renderProcessTags();
                    }
                    if (l.linkedEvents && !l.anyEvent) {
                        selectedEvents.clear(); l.linkedEvents.forEach(e => selectedEvents.add(e));
                        renderEventTags(); renderEventList('', selectedEvents);
                    }
                    if (l.anyEvent) {
                        qualquerEvento = true;
                        if (eventoAnyCheckbox) { eventoAnyCheckbox.checked = true; if (eventoAnyRow) eventoAnyRow.classList.add('active'); }
                        eventoSearchInput.disabled = true;
                        eventoList.style.pointerEvents = 'none';
                        eventoList.style.opacity = '0.35';
                        eventoSearchInput.style.opacity = '0.35';
                        if (eventoCount) eventoCount.style.opacity = '0.35';
                    }
                    const isEventoEdit = l.linkedEvents?.length > 0 || l.anyEvent;
                    document.querySelector('#eproc-lembretes-modal .glass-card[data-modo="data"]')?.classList.toggle('active', !isEventoEdit);
                    document.querySelector('#eproc-lembretes-modal .glass-card[data-modo="evento"]')?.classList.toggle('active', isEventoEdit);
                    document.getElementById('eproc-lembretes-modal').classList.toggle('modo-evento', isEventoEdit);
                    document.getElementById('form-lembrete-title').textContent = 'Editar Lembrete';
                    document.getElementById('btn-cancelar-lembrete').textContent = 'Cancelar Edi\u00e7\u00e3o';
                };
                div.querySelector('.btn-mini.danger').onclick = async () => { if(confirm('Excluir este lembrete?')){ await deleteLembrete(l.id); if(editId===l.id) resetForm(); renderList(); updateSino(); } };
                listContainer.appendChild(div);
            });
        };

        const openDashboard = () => { resetForm(); renderList(); modal.style.display = 'flex'; };

        document.getElementById('btn-cancelar-lembrete').onclick = resetForm;
        document.getElementById('btn-close-dashboard').onclick = () => { modal.style.display = 'none'; };
        modal.addEventListener('click', (e) => { if(e.target === modal) modal.style.display = 'none'; });

        function getEprocHash() {
            const cached = sessionStorage.getItem('eproc_hash');
            if (cached) return cached;
            const fromUrl = new URLSearchParams(location.search).get('hash');
            if (fromUrl) {
                sessionStorage.setItem('eproc_hash', fromUrl);
                return fromUrl;
            }
            const link = document.querySelector('a[href*="hash="]');
            if (link) {
                try {
                    const m = link.href.match(/[?&]hash=([^&]+)/);
                    if (m) {
                        sessionStorage.setItem('eproc_hash', m[1]);
                        return m[1];
                    }
                } catch(e) {}
            }
            return '';
        }

        function buildProcessUrl(num) {
            const clean = String(num).replace(/\D/g, '');
            if (clean.length < 15) return '';
            const link = document.querySelector('a[href*="acao=processo_selecionar"]');
            if (link) {
                try {
                    const url = new URL(link.href, window.location.origin);
                    url.searchParams.set('num_processo', clean);
                    return url.toString();
                } catch(e) {}
            }
            const hash = getEprocHash();
            return `${location.origin}/eproc/controlador.php?acao=processo_selecionar&num_processo=${clean}&hash=${hash}`;
        }

        document.getElementById('btn-salvar-lembrete').onclick = async () => {
            const text = txtTexto.value.trim();
            if (!text) return alert('Digite o texto do lembrete.');
            const activeTypeBox = document.querySelector('#color-selector .color-box.active');
            const type = activeTypeBox ? activeTypeBox.dataset.type : 'LEMBRETE';
            const modoEvento = document.querySelector('#eproc-lembretes-modal .glass-card[data-modo="evento"]')?.classList.contains('active') ?? false;
            let dateVal = txtData.value, timeVal = txtHora.value || '06:00', targetDate = new Date();
            if (modoEvento) {
                if (linkedProcesses.size === 0) return alert('Vincule pelo menos um processo.');
                if (!qualquerEvento && selectedEvents.size === 0) return alert('Selecione pelo menos um evento ou marque "Qualquer evento".');
                targetDate = new Date();
            }
            if (!modoEvento) {
                if (!dateVal && !txtHora.value) { targetDate.setDate(targetDate.getDate()+1); targetDate.setHours(6,0,0,0); }
                else if (!dateVal) { const [h,m] = timeVal.split(':'); targetDate.setHours(h,m,0,0); if(targetDate<=new Date()) targetDate.setDate(targetDate.getDate()+1); }
                else { const [y,mo,d] = dateVal.split('-'); const [h,m] = timeVal.split(':'); targetDate = new Date(y,mo-1,d,h,m,0,0); }
            }
            let lembreteCreatedAt = new Date().toISOString();
            let lembreteExisting = null;
            if (editId) {
                const all = await getAllLembretes();
                lembreteExisting = all.find(l => l.id === editId);
                if (lembreteExisting) lembreteCreatedAt = lembreteExisting.createdAt;
            }
            const processUrls = {};
            if (modoEvento) {
                linkedProcesses.forEach(p => {
                    const link = document.querySelector(`a[href*="num_processo=${p}"]`);
                    processUrls[p] = link ? link.href : buildProcessUrl(p);
                });
            }
            const lembrete = {
                type, text, datetime: targetDate.toISOString(), status: 'ativo',
                createdAt: lembreteCreatedAt,
                linkedProcess: modoEvento ? [...linkedProcesses].join(',') : '',
                linkedEvents: modoEvento ? (qualquerEvento ? ['*'] : [...selectedEvents]) : [],
                anyEvent: qualquerEvento,
                processUrls,
                lastScanDate: '',
                processosComPostit: [],
                snoozedUntil: {}
            };
            if (lembreteExisting) {
                if (lembreteExisting.lastScanDate) lembrete.lastScanDate = lembreteExisting.lastScanDate;
                if (lembreteExisting.processosComPostit) lembrete.processosComPostit = lembreteExisting.processosComPostit;
                if (lembreteExisting.snoozedUntil) {
                    if (typeof lembreteExisting.snoozedUntil === 'string')
                        lembrete.snoozedUntil['*'] = lembreteExisting.snoozedUntil;
                    else
                        lembrete.snoozedUntil = {...lembreteExisting.snoozedUntil};
                }
                if (lembreteExisting.ultimosEventosDetectados) {
                    lembrete.ultimosEventosDetectados = lembreteExisting.ultimosEventosDetectados;
                    if (lembreteExisting.ultimoProcesso) lembrete.ultimoProcesso = lembreteExisting.ultimoProcesso;
                    if (lembreteExisting.ultimaUrl) lembrete.ultimaUrl = lembreteExisting.ultimaUrl;
                }
            }
            if (editId && modoEvento && lembrete.snoozedUntil && typeof lembrete.snoozedUntil === 'object') {
                [...linkedProcesses].forEach(p => { delete lembrete.snoozedUntil[p]; });
            }
            if (modoEvento && Array.isArray(lembrete.processosComPostit)) {
                const linkedSet = new Set((lembrete.linkedProcess || '').split(',').filter(Boolean));
                lembrete.processosComPostit = lembrete.processosComPostit.filter(p => linkedSet.has(p));
            }
            if (editId) lembrete.id = editId;
            await saveLembrete(lembrete);
            const temEventos = modoEvento && (lembrete.linkedEvents.length > 0 || lembrete.anyEvent);
            resetForm(); renderList(); updateSino();
            if (temEventos) monitorarEventosVinculados();
        };

        const linkify = (text) => {
            const hash = new URLSearchParams(location.search).get('hash') || '';
            const regex = /\b(\d{7})-?(\d{2})\.?(\d{4})\.?([8])\.?(13)\.?(\d{4})\b/g;
            return text.replace(regex, (match, g1, g2, g3, g4, g5, g6) => {
                const cleanNum = `${g1}${g2}${g3}${g4}${g5}${g6}`;
                const domLink = document.querySelector(`a[href*="num_processo=${cleanNum}"]`);
                if (domLink) return `<a href="${domLink.href}" target="_blank" class="eproc-postit-link">${match}</a>`;
                const builtHref = buildProcessUrl(cleanNum) || `controlador.php?acao=processo_selecionar&num_processo=${cleanNum}&hash=${hash}`;
                return `<a href="${builtHref}" target="_blank" class="eproc-postit-link">${match}</a>`;
            });
        };



        const _snoozeBtnSvg = '<svg viewBox="0 0 24 24"><path d="M6 2v6h.01L6 8.01 10 12l-4 4 .01.01H6V22h12v-5.99h-.01L18 16l-4-4 4-3.99-.01-.01H18V2H6zm10 14.5V20H8v-3.5l4-4 4 4zm-4-5l-4-4V4h8v3.5l-4 4z"/></svg>';
        const _clockSvg = '<svg viewBox="0 0 24 24"><path d="M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zM12 20c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zm.5-13H11v6l5.25 3.15.75-1.23-4.5-2.67z"/></svg>';
        const _calSvg = '<svg viewBox="0 0 24 24"><path d="M19 3h-1V1h-2v2H8V1H6v2H5c-1.11 0-1.99.9-1.99 2L3 19c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 16H5V8h14v11zM9 10H7v2h2v-2zm4 0h-2v2h2v-2zm4 0h-2v2h2v-2z"/></svg>';

        function criarPostit(lembrete, processo, url, matchedEvents) {
            const div = document.createElement('div'); div.className = 'eproc-postit';
            div.dataset.lembreteId = lembrete.id;
            div.dataset.processNum = processo;
            const _colors3 = { 'PRAZO':'var(--eproc-red)', 'LEMBRETE':'var(--eproc-yellow)', 'EVENTO':'var(--eproc-blue)' };
            const cor3 = _colors3[lembrete.type] || 'var(--eproc-yellow)';
            div.style.setProperty('--postit-color', cor3);
            const snoozeId = `snooze-${lembrete.id}-${processo}`;
            const eventoNome = lembrete.anyEvent ? 'Qualquer evento' : (matchedEvents?.[0] || lembrete.ultimosEventosDetectados?.[0] || '');
            div.innerHTML = `<div class="eproc-postit-header"><span style="color:${cor3};">${lembrete.type}</span><div style="display:flex;gap:4px;"><div class="snooze-wrapper" id="${snoozeId}"><button class="btn-mini snooze-btn" title="Relembrar depois" style="background:#f5f5f5;">${_snoozeBtnSvg}</button><div class="snooze-dropdown"><div class="snooze-dropdown-header">Relembrar em</div><button class="snooze-dropdown-item" data-minutes="10">${_clockSvg}10 Minutos</button><button class="snooze-dropdown-item" data-minutes="60">${_clockSvg}1 Hora</button><button class="snooze-dropdown-item" data-minutes="120">${_clockSvg}2 Horas</button><button class="snooze-dropdown-item" data-minutes="300">${_clockSvg}5 Horas</button><div class="snooze-divider"></div><button class="snooze-dropdown-item" data-minutes="day">${_calSvg}Amanh\u00e3 (a partir das 6h)</button></div></div><button class="btn-mini btn-fechar" title="Fechar" style="background:#f5f5f5;"><svg viewBox="0 0 24 24" style="width:14px;height:14px;"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg></button></div></div><div class="eproc-postit-body">${linkify(lembrete.text).replace(/\n/g,'<br>')}</div><div class="eproc-postit-evento">\ud83d\udd14 Evento detectado: <strong>${eventoNome}</strong>${!lembrete.anyEvent && matchedEvents && matchedEvents.length > 1 ? ' (+' + (matchedEvents.length-1) + ' mais)' : ''}<br>Processo: <a href="${url}" target="_blank" class="eproc-postit-link">${processo}</a></div>`;
            div.querySelector('.btn-fechar').onclick = async function() {
                if (processo && Array.isArray(lembrete.processosComPostit)) {
                    const idx = lembrete.processosComPostit.indexOf(processo);
                    if (idx > -1) lembrete.processosComPostit.splice(idx, 1);
                    if (lembrete.processUrls) delete lembrete.processUrls[processo];
                    if (!lembrete.snoozedUntil || typeof lembrete.snoozedUntil === 'string') lembrete.snoozedUntil = {};
                    lembrete.snoozedUntil[processo] = '9999-12-31T23:59:59.000Z';
                    if (!lembrete.processosComPostit.length) {
                        const linkedProcs = (lembrete.linkedProcess || '').split(',').filter(Boolean);
                        const remaining = linkedProcs.filter(p => {
                            const sd2 = lembrete.snoozedUntil;
                            return !sd2 || typeof sd2 === 'string' || !sd2[p] || new Date(sd2[p]) <= new Date();
                        });
                        if (!remaining.length) lembrete.status = 'fechado';
                    }
                } else {
                    lembrete.status = 'fechado';
                }
                await saveLembrete(lembrete);
                div.classList.add('postit-hidden');
                updateSino();
            };
            return div;
        }

        function setupSnooze(postitEl, snoozeId, lembrete) {
            const wrapper = postitEl.querySelector('.snooze-wrapper');
            if (!wrapper) return;
            const btn = wrapper.querySelector('.snooze-btn');
            const dropdown = wrapper.querySelector('.snooze-dropdown');
            btn.addEventListener('click', (e) => { e.stopPropagation(); dropdown.classList.toggle('open'); });
            dropdown.addEventListener('click', async (e) => {
                const opt = e.target.closest('.snooze-dropdown-item');
                if (!opt) return;
                dropdown.classList.remove('open');
                const val = opt.dataset.minutes;
                let until = new Date();
                if (val === 'day') { until.setDate(until.getDate()+1); until.setHours(6,0,0,0); }
                else { until.setMinutes(until.getMinutes() + parseInt(val)); }
                const processKey = postitEl.dataset.processNum || '*';
                if (typeof lembrete.snoozedUntil === 'string' || !lembrete.snoozedUntil) lembrete.snoozedUntil = {};
                lembrete.snoozedUntil[processKey] = until.toISOString();
                await saveLembrete(lembrete);
                postitEl.classList.add('postit-hidden');
                updateSino();
            });
            document.addEventListener('click', () => { dropdown.classList.remove('open'); });
        }

        let monitoringInProgress = false;
        async function monitorarEventosVinculados() {
            if (!window._eprocOrigemDataPronto) { setTimeout(monitorarEventosVinculados, 2000); return; }
            if (monitoringInProgress) return;
            monitoringInProgress = true;
            try {
            const all = await getAllLembretes();
            const eventos = all.filter(l => l.status === 'ativo' && (l.linkedEvents?.length || l.anyEvent));
            if (!eventos.length) return;
            const now = new Date();
            for (const lembrete of eventos) {
                const sd = lembrete.snoozedUntil;
                if (sd) {
                    if (typeof sd === 'string') { if (sd && new Date(sd) > now) continue; }
                    else if (sd['*'] && new Date(sd['*']) > now) continue;
                }
                if (Array.isArray(lembrete.processosComPostit) && lembrete.processosComPostit.length) {
                    const container = document.getElementById('eproc-lembretes-container');
                    if (container) {
                        lembrete.processosComPostit.forEach(p => {
                            if (sd && typeof sd !== 'string' && sd[p] && new Date(sd[p]) > now) return;
                            const sel = `.eproc-postit[data-lembrete-id="${lembrete.id}"][data-process-num="${p}"]`;
                            if (container.querySelector(sel)) return;
                            const div = criarPostit(lembrete, p, lembrete.processUrls?.[p] || lembrete.ultimaUrl || '#', null);
                            setupSnooze(div, `snooze-${lembrete.id}-${p}`, lembrete);
                            container.appendChild(div);
                            updateSino();
                        });
                    }
                } else if (lembrete.ultimosEventosDetectados?.length) {
                    const container = document.getElementById('eproc-lembretes-container');
                    if (container && !container.querySelector(`.eproc-postit[data-lembrete-id="${lembrete.id}"]`)) {
                        const ultimo = lembrete.ultimoProcesso || '';
                        const pSnoozed = ultimo && sd && typeof sd !== 'string' && sd[ultimo] && new Date(sd[ultimo]) > now;
                        if (!pSnoozed) {
                            const div = criarPostit(lembrete, ultimo, lembrete.ultimaUrl || '#', lembrete.ultimosEventosDetectados);
                            setupSnooze(div, `snooze-${lembrete.id}`, lembrete);
                            container.appendChild(div);
                            updateSino();
                        }
                    }
                }
            }
            for (const lembrete of eventos) {
                const sd2 = lembrete.snoozedUntil;
                if (sd2) {
                    if (typeof sd2 === 'string') { if (sd2 && new Date(sd2) > now) continue; }
                    else if (sd2['*'] && new Date(sd2['*']) > now) continue;
                }
                const processos = (lembrete.linkedProcess || '').split(',').filter(Boolean);
                const createdAt = new Date(lembrete.createdAt || lembrete.datetime);
                if (isNaN(createdAt.getTime())) continue;
                const alreadyDetected = lembrete.ultimosEventosDetectados?.length > 0;
                const lastScan = (alreadyDetected && lembrete.lastScanDate) ? new Date(lembrete.lastScanDate) : createdAt;
                const lastScanAdj = new Date(lastScan.getTime() - 1000);
                let anySuccess = false;
                for (const numProcesso of processos) {
                    if (sd2 && typeof sd2 !== 'string' && sd2[numProcesso] && new Date(sd2[numProcesso]) > now) continue;
                    try {
                        await rateLimiter.consume();
                        const linkEl = document.querySelector(`a[href*="num_processo=${numProcesso}"]`);
                        let url = linkEl ? linkEl.href : buildProcessUrl(numProcesso);
                        if (!url) url = lembrete.processUrls?.[numProcesso];
                        if (!url) continue;
                        const controller = new AbortController();
                        const timeoutId = setTimeout(() => controller.abort(), 15000);
                        const res = await fetch(url, { method:'GET', headers:{'X-Requested-With':'XMLHttpRequest'}, credentials:'include', cache:'no-store', signal:controller.signal });
                        clearTimeout(timeoutId);
                        if (!res.ok) continue;
                        const text = new TextDecoder('iso-8859-1').decode(await res.arrayBuffer());
                        if (text.includes('Sua sessão foi encerrada') || text.length < 500) continue;
                        anySuccess = true;
                        const doc = new DOMParser().parseFromString(text, 'text/html');
                        const rows = doc.querySelectorAll('#tblEventos tr, #tblEventosNovos tr');
                        let matchedEvents = [];
                        for (const row of rows) {
                            let dateMatch = null;
                            for (let ci = 0; ci < row.cells.length; ci++) {
                                dateMatch = row.cells[ci].textContent.trim().match(/(\d{2})\/(\d{2})\/(\d{4})(?:\s*[^\d]*(\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
                                if (dateMatch) break;
                            }
                            if (!dateMatch) continue;
                            const [_, dStr, moStr, yStr, hStr, miStr, sStr] = dateMatch;
                            let eventDate;
                            if (hStr !== undefined) { eventDate = new Date(+yStr, +moStr-1, +dStr, +hStr, +miStr, +sStr || 0); }
                            else { eventDate = new Date(+yStr, +moStr-1, +dStr, 23, 59, 59); }
                            if (eventDate < lastScanAdj) continue;
                            const eventText = row.textContent;
                            if (lembrete.anyEvent) {
                                matchedEvents.push('*');
                            } else {
                                for (const linkedEvent of lembrete.linkedEvents) {
                                    const parts = linkedEvent.split('/').map(s => s.trim()).filter(Boolean);
                                    const match = parts.some(part =>
                                        removerAcentosEv(eventText.toUpperCase()).includes(removerAcentosEv(part.toUpperCase()))
                                    );
                                    if (match) {
                                        matchedEvents.push(linkedEvent);
                                        break;
                                    }
                                }
                            }
                        }
                        if (matchedEvents.length > 0) {
                            const container = document.getElementById('eproc-lembretes-container');
                            if (!container) continue;
                            const existing = Array.from(container.querySelectorAll('.eproc-postit')).some(el => el.dataset.lembreteId == lembrete.id && el.dataset.processNum === numProcesso);
                            if (!existing) {
                                const div = criarPostit(lembrete, numProcesso, url, matchedEvents);
                                setupSnooze(div, `snooze-${lembrete.id}-${numProcesso}`, lembrete);
                                container.appendChild(div);
                                if (!lembrete.processosComPostit) lembrete.processosComPostit = [];
                                if (!lembrete.processosComPostit.includes(numProcesso)) lembrete.processosComPostit.push(numProcesso);
                                if (!lembrete.processUrls) lembrete.processUrls = {};
                                lembrete.processUrls[numProcesso] = url;
                                lembrete.ultimosEventosDetectados = [...new Set([...(lembrete.ultimosEventosDetectados || []), ...matchedEvents])];
                                lembrete.ultimoProcesso = numProcesso;
                                lembrete.ultimaUrl = url;
                                await saveLembrete(lembrete);
                                updateSino();
                            }
                        }
                    } catch(e) { continue; }
                }
                if (anySuccess) {
                    lembrete.lastScanDate = now.toISOString();
                    await saveLembrete(lembrete);
                }
            }
            } finally { monitoringInProgress = false; }
        }

        async function verificarLembretesData() {
            const all = await getAllLembretes();
            const now = new Date();
            const pendentes = all.filter(l => l.status === 'ativo' && !l.linkedEvents?.length);
            for (const lembrete of pendentes) {
                const snoozeData = lembrete.snoozedUntil;
                if (snoozeData) {
                    if (typeof snoozeData === 'string') { if (snoozeData && new Date(snoozeData) > now) continue; }
                    else if (snoozeData['*'] && new Date(snoozeData['*']) > now) continue;
                }
                const data = new Date(lembrete.datetime);
                if (isNaN(data.getTime()) || data > now) continue;
                const container = document.getElementById('eproc-lembretes-container');
                if (!container) continue;
                if (container.querySelector(`.eproc-postit[data-lembrete-id="${lembrete.id}"]`)) continue;
                const colors = { 'PRAZO':'var(--eproc-red)', 'LEMBRETE':'var(--eproc-yellow)' };
                const c = colors[lembrete.type] || 'var(--eproc-yellow)';
                const div = document.createElement('div'); div.className = 'eproc-postit';
                div.dataset.lembreteId = lembrete.id;
                div.style.setProperty('--postit-color', c);
                const snoozeId = `snooze-${lembrete.id}`;
                const snoozeBtnSvg = '<svg viewBox="0 0 24 24"><path d="M6 2v6h.01L6 8.01 10 12l-4 4 .01.01H6V22h12v-5.99h-.01L18 16l-4-4 4-3.99-.01-.01H18V2H6zm10 14.5V20H8v-3.5l4-4 4 4zm-4-5l-4-4V4h8v3.5l-4 4z"/></svg>';
                const clockSvg = '<svg viewBox="0 0 24 24"><path d="M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zM12 20c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zm.5-13H11v6l5.25 3.15.75-1.23-4.5-2.67z"/></svg>';
                const calSvg = '<svg viewBox="0 0 24 24"><path d="M19 3h-1V1h-2v2H8V1H6v2H5c-1.11 0-1.99.9-1.99 2L3 19c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 16H5V8h14v11zM9 10H7v2h2v-2zm4 0h-2v2h2v-2zm4 0h-2v2h2v-2z"/></svg>';
                div.innerHTML = `<div class="eproc-postit-header"><span style="color:${c};">${lembrete.type}</span><div style="display:flex;gap:4px;"><div class="snooze-wrapper" id="${snoozeId}"><button class="btn-mini snooze-btn" title="Relembrar depois" style="background:#f5f5f5;">${snoozeBtnSvg}</button><div class="snooze-dropdown"><div class="snooze-dropdown-header">Relembrar em</div><button class="snooze-dropdown-item" data-minutes="10">${clockSvg}10 Minutos</button><button class="snooze-dropdown-item" data-minutes="60">${clockSvg}1 Hora</button><button class="snooze-dropdown-item" data-minutes="120">${clockSvg}2 Horas</button><button class="snooze-dropdown-item" data-minutes="300">${clockSvg}5 Horas</button><div class="snooze-divider"></div><button class="snooze-dropdown-item" data-minutes="day">${calSvg}Amanh\u00e3 (a partir das 6h)</button></div></div><button class="btn-mini btn-fechar" title="Fechar" style="background:#f5f5f5;"><svg viewBox="0 0 24 24" style="width:14px;height:14px;"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg></button></div></div><div class="eproc-postit-body">${linkify(lembrete.text).replace(/\n/g,'<br>')}</div>`;
            div.querySelector('.btn-fechar').onclick = async function() { lembrete.status='fechado'; await saveLembrete(lembrete); div.classList.add('postit-hidden'); updateSino(); };
                setupSnooze(div, snoozeId, lembrete);
                container.appendChild(div);
                await saveLembrete(lembrete);
                updateSino();
            }
        }

        setInterval(monitorarEventosVinculados, 60000);
        setInterval(verificarLembretesData, 30000);
        insertBell();
        setTimeout(updateSino, 2000);
        setTimeout(monitorarEventosVinculados, 4000);
        setTimeout(verificarLembretesData, 1000);
        setTimeout(() => { if (!window._eprocOrigemDataPronto) window._eprocOrigemDataPronto = true; }, 30000);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initLembretesDinamicos);
    } else {
        initLembretesDinamicos();
    }


    // Tooltip personalizado: nome completo da origem no hover
    (() => {
        const tip = document.createElement('div');
        tip.style.cssText = 'position:fixed;pointer-events:none;background:#333;color:#fff;padding:4px 10px;border-radius:4px;font-size:12px;font-family:Arial,sans-serif;z-index:99999;max-width:300px;white-space:nowrap;opacity:0;transition:opacity 0.2s;box-shadow:0 2px 8px rgba(0,0,0,0.3);';
        document.body.appendChild(tip);

        document.addEventListener('mouseover', (e) => {
            const cell = e.target.closest('.eproc-col-origem-nucleo');
            if (cell) {
                const text = cell.textContent.trim();
                if (!text || text === '...' || text === '-') { tip.style.opacity = '0'; return; }
                const parsed = typeof parseOrigem === 'function' ? parseOrigem(text) : null;
                if (!parsed) { tip.style.opacity = '0'; return; }
                let varaFull = parsed.vara;
                if (varaFull === 'ÚNICA' || varaFull === 'UNICA') {
                    varaFull = 'Vara Única';
                } else if (varaFull.includes('VC')) {
                    varaFull = varaFull.replace(/(\d+)VC/, '$1ª Vara Cível');
                }
                tip.textContent = varaFull + ' de ' + parsed.comarca;
                tip.style.left = (e.clientX + 15) + 'px';
                tip.style.top = (e.clientY - 30) + 'px';
                tip.style.opacity = '1';
            } else {
                tip.style.opacity = '0';
            }
        }, true);

        document.addEventListener('mousemove', (e) => {
            if (tip.style.opacity === '1') {
                tip.style.left = (e.clientX + 15) + 'px';
                tip.style.top = (e.clientY - 30) + 'px';
            }
        });

        document.addEventListener('mouseout', (e) => {
            const cell = e.target.closest('.eproc-col-origem-nucleo');
            if (cell) tip.style.opacity = '0';
        }, true);
    })();

})();
