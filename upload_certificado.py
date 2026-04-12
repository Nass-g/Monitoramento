import os
import sys
import json
import ler_certificados
from flask import Flask, request, jsonify, send_from_directory, redirect, make_response
from cryptography.hazmat.primitives.serialization import pkcs12
from cryptography.hazmat.backends import default_backend

UPLOAD_FOLDER = './certificados/'
ALLOWED_EXTENSIONS = {'pfx'}

app = Flask(__name__, static_folder='static', static_url_path='/static')
app.config['UPLOAD_FOLDER'] = UPLOAD_FOLDER
os.makedirs(UPLOAD_FOLDER, exist_ok=True)
os.makedirs('./static/certificados', exist_ok=True)


# Serve o dashboard sempre sem cache (evita versão desatualizada no browser)
def _serve_page(filename):
    resp = make_response(send_from_directory('static', filename))
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




def allowed_file(filename):
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS


@app.route('/remover', methods=['POST'])
def remover_certificado():
    data = request.get_json()
    cnpj = data.get('cnpj')
    if not cnpj:
        return jsonify({'error': 'CNPJ não informado'}), 400
    try:
        with open('./certificados/resultados.json', 'r', encoding='utf-8') as f:
            resultados = json.loads(f.read())
        cert = next((c for c in resultados if c.get('cnpj') == cnpj), None)
        if not cert:
            return jsonify({'error': 'Certificado não encontrado'}), 404
        
        # Tentar remover arquivo se existir
        nome_arquivo = cert.get('arquivo')
        if nome_arquivo:
            caminho = os.path.join(app.config['UPLOAD_FOLDER'], nome_arquivo)
            if os.path.exists(caminho):
                os.remove(caminho)
        
        # Remover do resultados.json
        resultados = [c for c in resultados if c.get('cnpj') != cnpj]
        with open('./certificados/resultados.json', 'w', encoding='utf-8') as f:
            json.dump(resultados, f, ensure_ascii=False, indent=2)
        
        # Sincronizar com static/certificados/resultados.json
        try:
            with open('./static/certificados/resultados.json', 'w', encoding='utf-8') as f:
                json.dump(resultados, f, ensure_ascii=False, indent=2)
        except:
            pass
        
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

    pfx_data = file.read()

    # Arquivo físico já existe no disco?
    filepath = os.path.join(app.config['UPLOAD_FOLDER'], file.filename)
    if os.path.exists(filepath):
        # Buscar dados completos no resultados.json
        info = {'arquivo': file.filename, 'nome': '', 'cnpj': '', 'vencimento': ''}
        try:
            with open('./certificados/resultados.json', 'r', encoding='utf-8') as f:
                resultados = json.load(f)
            encontrado = next((r for r in resultados if r.get('arquivo') == file.filename), None)
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
    try:
        senhas_para_tentar = []
        try:
            with open('./certificados/senhas.json', 'r', encoding='utf-8') as sf:
                senhas_dict = json.load(sf)
            if file.filename in senhas_dict:
                senhas_para_tentar.append(senhas_dict[file.filename])
        except Exception:
            pass
        senhas_para_tentar += [s for s in ler_certificados.SENHAS_PADRAO if s not in senhas_para_tentar]

        for senha in senhas_para_tentar:
            try:
                _, cert, _ = pkcs12.load_key_and_certificates(pfx_data, senha.encode(), backend=default_backend())
                cnpj_novo, nome_novo = ler_certificados.extrair_cnpj_nome(cert)
                vencimento_novo = cert.not_valid_after_utc.strftime('%d/%m/%Y')
                break
            except Exception:
                continue
    except Exception:
        pass

    # Bloquear duplicata antes de salvar
    try:
        with open('./certificados/resultados.json', 'r', encoding='utf-8') as f:
            resultados = json.load(f)

        # 1) Mesmo arquivo já cadastrado (mesmo nome de arquivo)
        mesmo_arquivo = next((r for r in resultados if r.get('arquivo') == file.filename), None)
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
    except Exception:
        pass

    # Salvar apenas após validação
    filepath = os.path.join(app.config['UPLOAD_FOLDER'], file.filename)
    with open(filepath, 'wb') as f:
        f.write(pfx_data)

    # Reprocessar todos os certificados
    try:
        ler_certificados.varrer_certificados()
    except Exception as e:
        return jsonify({'success': True, 'filename': file.filename, 'warn': f'Upload ok, mas erro ao varrer: {e}'}), 200

    return jsonify({'success': True, 'filename': file.filename}), 200


@app.route('/atualizar', methods=['POST'])
def atualizar_certificados():
    try:
        ler_certificados.varrer_certificados()
        return jsonify({'success': True}), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500


if __name__ == '__main__':
    app.run(port=5000, debug=False)

