import os
import glob
import json
import time
from datetime import datetime
from cryptography.hazmat.primitives.serialization import pkcs12
from cryptography.hazmat.backends import default_backend
from cryptography import x509

CERTS_DIR = './certificados/'
SENHAS_FILE = './certificados/senhas.json'
RESULT_FILE = './certificados/resultados.json'

# Senhas padrão testadas quando o arquivo não tem senha cadastrada
SENHAS_PADRAO = ['div2024', 'div2025', 'comercio2024', 'comercio2025', '123456', '12345678']

def extrair_cnpj_nome(cert):
    import re
    subject = cert.subject
    nome_raw = subject.get_attributes_for_oid(x509.NameOID.COMMON_NAME)[0].value
    # Nome pode vir como "EMPRESA:CNPJ" — separar os dois
    if ':' in nome_raw:
        partes = nome_raw.split(':')
        nome = partes[0].strip()
        cnpj_candidato = partes[-1].strip().replace('.', '').replace('/', '').replace('-', '')
    else:
        nome = nome_raw.strip()
        cnpj_candidato = ''
    try:
        cnpj = subject.get_attributes_for_oid(x509.ObjectIdentifier('2.16.76.1.3.3'))[0].value
        cnpj = cnpj.strip().replace('.', '').replace('/', '').replace('-', '')
    except Exception:
        match = re.search(r'(\d{2}\.\d{3}\.\d{3}/\d{4}-\d{2}|\d{14})', nome_raw)
        if match:
            cnpj = match.group(0).replace('.', '').replace('/', '').replace('-', '')
        elif cnpj_candidato and len(cnpj_candidato) == 14:
            cnpj = cnpj_candidato
        else:
            cnpj = 'CNPJ não encontrado'
    return cnpj, nome

def varrer_certificados():
    try:
        with open(SENHAS_FILE, 'r', encoding='utf-8') as f:
            senhas_dict = json.load(f)
    except Exception as e:
        print(f'Erro ao carregar senhas: {e}')
        return

    arquivos_pfx = glob.glob(os.path.join(CERTS_DIR, '*.pfx'))
    resultados = []
    for pfx_path in arquivos_pfx:
        nome_arquivo = os.path.basename(pfx_path)
        # Tenta senha do JSON, depois as senhas padrão
        senhas_para_tentar = []
        if nome_arquivo in senhas_dict:
            senhas_para_tentar.append(senhas_dict[nome_arquivo])
        senhas_para_tentar += [s for s in SENHAS_PADRAO if s not in senhas_para_tentar]
        with open(pfx_path, 'rb') as f:
            pfx_data = f.read()
        sucesso = False
        for senha in senhas_para_tentar:
            try:
                private_key, cert, add_certs = pkcs12.load_key_and_certificates(
                    pfx_data, senha.encode(), backend=default_backend()
                )
                cnpj, nome = extrair_cnpj_nome(cert)
                vencimento = cert.not_valid_after_utc.strftime('%d/%m/%Y')
                resultados.append({'arquivo': nome_arquivo, 'cnpj': cnpj, 'nome': nome, 'vencimento': vencimento, 'senha_utilizada': senha})
                print(f'{nome_arquivo}: CNPJ={cnpj}, Nome={nome}, Vencimento={vencimento}, Senha={senha}')
                sucesso = True
                break
            except Exception:
                continue
        if not sucesso:
            print(f'Nenhuma senha funcionou para {nome_arquivo}')

    # Detectar duplicatas: mesmo CNPJ + mesmo vencimento em arquivos diferentes
    chave_contagem = {}
    for r in resultados:
        chave = (r['cnpj'], r['vencimento'])
        chave_contagem[chave] = chave_contagem.get(chave, 0) + 1
    for r in resultados:
        chave = (r['cnpj'], r['vencimento'])
        r['duplicado'] = chave_contagem[chave] > 1

    try:
        with open(RESULT_FILE, 'w', encoding='utf-8') as f:
            json.dump(resultados, f, ensure_ascii=False, indent=2)
        # Sincronizar para static/certificados/resultados.json
        try:
            import shutil
            static_result = os.path.join('.', 'static', 'certificados', 'resultados.json')
            shutil.copyfile(RESULT_FILE, static_result)
        except Exception as e:
            print(f'Erro ao sincronizar resultados para static: {e}')
        print(f"[{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}] Processamento concluído. {len(resultados)} certificados encontrados.")
    except Exception as e:
        print(f'Erro ao salvar resultados: {e}')

if __name__ == '__main__':
    print('Iniciando varredura automática de certificados a cada 1 hora...')
    try:
        while True:
            varrer_certificados()
            print('Aguardando 1 hora para próxima varredura...')
            time.sleep(3600)
    except KeyboardInterrupt:
        print('Varredura encerrada.')
