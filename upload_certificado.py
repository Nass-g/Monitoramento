import os
import re
import json
import time
import ler_certificados
from flask import Flask, request, jsonify, make_response
from werkzeug.utils import secure_filename
from cryptography.hazmat.primitives.serialization import pkcs12
from cryptography.hazmat.backends import default_backend

BASE_DIR     = os.path.dirname(os.path.abspath(__file__))
UPLOAD_FOLDER = os.path.join(BASE_DIR, 'certificados')
ALLOWED_EXTENSIONS = {'pfx'}

# Timestamp gerado uma vez ao iniciar o servidor — garante JS sempre fresco no browser
_BOOT_TS = str(int(time.time()))

app = Flask(__name__, static_folder=os.path.join(BASE_DIR, 'static'), static_url_path='/static')
app.config['UPLOAD_FOLDER'] = UPLOAD_FOLDER
os.makedirs(UPLOAD_FOLDER, exist_ok=True)
os.makedirs(os.path.join(BASE_DIR, 'static', 'certificados'), exist_ok=True)


@app.after_request
def add_no_cache(response):
    # Evita cache em JS e CSS para que correções cheguem imediatamente ao browser
    if response.content_type and any(t in response.content_type for t in ('javascript', 'css')):
        response.headers['Cache-Control'] = 'no-cache, no-store, must-revalidate'
        response.headers['Pragma'] = 'no-cache'
        response.headers['Expires'] = '0'
    return response


# Serve o dashboard sempre sem cache, injetando versao dinamica nos scripts
def _serve_page(filename):
    filepath = os.path.join(BASE_DIR, 'static', filename)
    with open(filepath, 'r', encoding='utf-8') as f:
        content = f.read()
    content = re.sub(r'\?v=[^"]+', f'?v={_BOOT_TS}', content)
    resp = make_response(content, 200)
    resp.headers['Content-Type'] = 'text/html; charset=utf-8'
    resp.headers['Cache-Control'] = 'no-cache, no-store, must-revalidate'
    resp.headers['Pragma'] = 'no-cache'
    resp.headers['Expires'] = '0'
    return resp

@app.route('/')
@app.route('/dashboard')
@app.route('/acompanhamento')
def index():
    return _serve_page('acompanhamento.html')

@app.route('/analise')
def analise():
    return _serve_page('analise.html')


@app.route('/api/certificados')
def listar_certificados():
    try:
        resultados = ler_certificados.carregar_resultados()
    except Exception as e:
        return jsonify({'error': f'Erro ao carregar certificados: {e}'}), 500

    response = jsonify(resultados)
    response.headers['Cache-Control'] = 'no-cache, no-store, must-revalidate'
    response.headers['Pragma'] = 'no-cache'
    response.headers['Expires'] = '0'
    return response




def allowed_file(filename):
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS


@app.route('/remover', methods=['POST'])
def remover_certificado():
    data = request.get_json(silent=True) or {}
    cert_id = data.get('id')
    arquivo = data.get('arquivo')
    if not cert_id and not arquivo:
        return jsonify({'error': 'Identificador do certificado não informado'}), 400
    try:
        resultados = ler_certificados.carregar_resultados()
        cert = next((c for c in resultados if c.get('id') == cert_id), None)
        if not cert and arquivo:
            cert = next((c for c in resultados if c.get('arquivo') == arquivo), None)
        if not cert:
            return jsonify({'error': 'Certificado não encontrado'}), 404
        
        # Tentar remover arquivo se existir
        nome_arquivo = cert.get('arquivo')
        if nome_arquivo:
            caminho = os.path.join(UPLOAD_FOLDER, nome_arquivo)
            if os.path.exists(caminho):
                os.remove(caminho)
        
        # Remover do resultados.json
        cert_id_encontrado = cert.get('id')
        if cert_id_encontrado:
            resultados = [c for c in resultados if c.get('id') != cert_id_encontrado]
        elif nome_arquivo:
            resultados = [c for c in resultados if c.get('arquivo') != nome_arquivo]
        ler_certificados.persistir_resultados(resultados)
        
        return jsonify({'success': True}), 200
    except Exception as e:
        return jsonify({'error': f'Erro ao remover: {e}'}), 500



@app.route('/upload', methods=['POST'])
def upload_file():
    if 'file' not in request.files:
        return jsonify({'error': 'Nenhum arquivo enviado'}), 400
    file = request.files['file']
    if file.filename == '':
        return jsonify({'error': 'Nome de arquivo vazio'}), 400
    if not (file and allowed_file(file.filename)):
        return jsonify({'error': 'Arquivo não permitido'}), 400

    safe_name = secure_filename(file.filename)
    if not safe_name:
        return jsonify({'error': 'Nome de arquivo inválido'}), 400

    pfx_data = file.read()

    # Arquivo físico já existe no disco?
    filepath = os.path.join(UPLOAD_FOLDER, safe_name)
    if os.path.exists(filepath):
        # Buscar dados completos no resultados.json
        info = {'arquivo': safe_name, 'nome': '', 'cnpj': '', 'vencimento': ''}
        try:
            resultados = ler_certificados.carregar_resultados()
            encontrado = next((r for r in resultados if r.get('arquivo') == safe_name), None)
            if encontrado:
                info['nome'] = encontrado.get('nome', '')
                info['cnpj'] = encontrado.get('cnpj', '')
                info['vencimento'] = encontrado.get('vencimento', '')
        except Exception:
            pass
        return jsonify({'success': False, 'duplicate': True, 'duplicate_info': info}), 409

    # Extrair CNPJ e vencimento do PFX em memória (sem salvar ainda)
    cnpj_novo = None
    vencimento_novo = None
    nome_novo = None
    certificado_lido = False
    try:
        senhas_para_tentar = []
        try:
            with open(os.path.join(BASE_DIR, 'certificados', 'senhas.json'), 'r', encoding='utf-8') as sf:
                senhas_dict = json.load(sf)
            if safe_name in senhas_dict:
                senhas_para_tentar.append(senhas_dict[safe_name])
        except Exception:
            pass
        senhas_para_tentar += [s for s in ler_certificados.SENHAS_PADRAO if s not in senhas_para_tentar]

        for senha in senhas_para_tentar:
            try:
                _, cert, _ = pkcs12.load_key_and_certificates(pfx_data, senha.encode(), backend=default_backend())
                if cert is None:
                    continue
                cnpj_novo, nome_novo = ler_certificados.extrair_cnpj_nome(cert)
                vencimento_novo = cert.not_valid_after_utc.strftime('%d/%m/%Y')
                certificado_lido = True
                break
            except Exception:
                continue
    except Exception:
        pass

    if not certificado_lido:
        return jsonify({'error': 'Não foi possível ler o certificado. Verifique se o arquivo .pfx está íntegro e se a senha está cadastrada em certificados/senhas.json.'}), 400

    # Bloquear duplicata antes de salvar
    try:
        resultados = ler_certificados.carregar_resultados()

        # 1) Mesmo arquivo já cadastrado (mesmo nome de arquivo)
        mesmo_arquivo = next((r for r in resultados if r.get('arquivo') == safe_name), None)
        if mesmo_arquivo:
            return jsonify({
                'success': False,
                'duplicate': True,
                'duplicate_info': {
                    'nome': mesmo_arquivo.get('nome'),
                    'cnpj': mesmo_arquivo.get('cnpj'),
                    'vencimento': mesmo_arquivo.get('vencimento'),
                    'arquivo': mesmo_arquivo.get('arquivo')
                }
            }), 409

        # 2) CNPJ + vencimento iguais em outro arquivo
        if cnpj_novo and vencimento_novo:
            conflito = next((
                r for r in resultados
                if r.get('cnpj') == cnpj_novo
                and r.get('vencimento') == vencimento_novo
            ), None)
            if conflito:
                return jsonify({
                    'success': False,
                    'duplicate': True,
                    'duplicate_info': {
                        'nome': conflito.get('nome'),
                        'cnpj': conflito.get('cnpj'),
                        'vencimento': conflito.get('vencimento'),
                        'arquivo': conflito.get('arquivo')
                    }
                }), 409
    except FileNotFoundError:
        pass  # Primeiro certificado, sem resultados ainda
    except Exception as e:
        return jsonify({'error': f'Erro ao validar a base atual: {e}'}), 500

    # Salvar apenas após validação
    filepath = os.path.join(UPLOAD_FOLDER, safe_name)
    with open(filepath, 'wb') as f:
        f.write(pfx_data)

    # Reprocessar todos os certificados
    try:
        ler_certificados.varrer_certificados()
    except Exception as e:
        if os.path.exists(filepath):
            os.remove(filepath)
        return jsonify({'error': f'Upload cancelado porque a varredura falhou: {e}'}), 500

    return jsonify({'success': True, 'filename': safe_name}), 200


@app.route('/atualizar', methods=['POST'])
def atualizar_certificados():
    try:
        ler_certificados.varrer_certificados()
        return jsonify({'success': True}), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500


if __name__ == '__main__':
    app.run(port=5000, debug=False)

