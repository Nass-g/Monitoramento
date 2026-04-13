import io
import json
import os
import tempfile
import unittest
from datetime import datetime
from unittest.mock import patch

import upload_certificado


class FakeCert:
    not_valid_after_utc = datetime(2030, 1, 1)


class UploadCertificadoTestCase(unittest.TestCase):
    def setUp(self):
        self.tempdir = tempfile.TemporaryDirectory()
        self.base_dir = self.tempdir.name
        self.upload_dir = os.path.join(self.base_dir, 'certificados')
        self.static_dir = os.path.join(self.base_dir, 'static', 'certificados')
        os.makedirs(self.upload_dir, exist_ok=True)
        os.makedirs(self.static_dir, exist_ok=True)

        with open(os.path.join(self.upload_dir, 'senhas.json'), 'w', encoding='utf-8') as f:
            json.dump({}, f)

        self.base_dir_patcher = patch.object(upload_certificado, 'BASE_DIR', self.base_dir)
        self.upload_dir_patcher = patch.object(upload_certificado, 'UPLOAD_FOLDER', self.upload_dir)
        self.base_dir_patcher.start()
        self.upload_dir_patcher.start()

        upload_certificado.app.config['TESTING'] = True
        upload_certificado.app.config['UPLOAD_FOLDER'] = self.upload_dir
        self.client = upload_certificado.app.test_client()

    def tearDown(self):
        self.base_dir_patcher.stop()
        self.upload_dir_patcher.stop()
        self.tempdir.cleanup()

    def test_upload_invalido_retorna_400_sem_salvar_arquivo(self):
        with patch.object(upload_certificado.pkcs12, 'load_key_and_certificates', side_effect=ValueError('pfx invalido')):
            response = self.client.post(
                '/upload',
                data={'file': (io.BytesIO(b'conteudo invalido'), 'invalido.pfx')},
                content_type='multipart/form-data',
            )

        self.assertEqual(response.status_code, 400)
        self.assertIn('Não foi possível ler o certificado', response.get_json()['error'])
        self.assertFalse(os.path.exists(os.path.join(self.upload_dir, 'invalido.pfx')))

    def test_upload_duplicado_por_nome_retorna_409(self):
        existente_path = os.path.join(self.upload_dir, 'existente.pfx')
        with open(existente_path, 'wb') as f:
            f.write(b'ja existe')

        with patch.object(upload_certificado.ler_certificados, 'carregar_resultados', return_value=[{
            'arquivo': 'existente.pfx',
            'nome': 'Empresa Existente',
            'cnpj': '12345678000190',
            'vencimento': '01/01/2030',
        }]):
            response = self.client.post(
                '/upload',
                data={'file': (io.BytesIO(b'novo conteudo'), 'existente.pfx')},
                content_type='multipart/form-data',
            )

        self.assertEqual(response.status_code, 409)
        payload = response.get_json()
        self.assertTrue(payload['duplicate'])
        self.assertEqual(payload['duplicate_info']['nome'], 'Empresa Existente')

    def test_upload_duplicado_por_cnpj_e_vencimento_retorna_409(self):
        resultados = [{
            'arquivo': 'outro_nome.pfx',
            'nome': 'Empresa Existente',
            'cnpj': '12345678000190',
            'vencimento': '01/01/2030',
        }]

        with patch.object(upload_certificado.pkcs12, 'load_key_and_certificates', return_value=(None, FakeCert(), None)), \
             patch.object(upload_certificado.ler_certificados, 'extrair_cnpj_nome', return_value=('12345678000190', 'Empresa Nova')), \
             patch.object(upload_certificado.ler_certificados, 'carregar_resultados', return_value=resultados):
            response = self.client.post(
                '/upload',
                data={'file': (io.BytesIO(b'conteudo valido'), 'novo_nome.pfx')},
                content_type='multipart/form-data',
            )

        self.assertEqual(response.status_code, 409)
        payload = response.get_json()
        self.assertTrue(payload['duplicate'])
        self.assertEqual(payload['duplicate_info']['arquivo'], 'outro_nome.pfx')

    def test_upload_remove_arquivo_se_varredura_falhar(self):
        with patch.object(upload_certificado.pkcs12, 'load_key_and_certificates', return_value=(None, FakeCert(), None)), \
             patch.object(upload_certificado.ler_certificados, 'extrair_cnpj_nome', return_value=('12345678000190', 'Empresa Teste')), \
             patch.object(upload_certificado.ler_certificados, 'carregar_resultados', return_value=[]), \
             patch.object(upload_certificado.ler_certificados, 'varrer_certificados', side_effect=RuntimeError('falhou ao reprocessar')):
            response = self.client.post(
                '/upload',
                data={'file': (io.BytesIO(b'conteudo aparentemente valido'), 'rollback.pfx')},
                content_type='multipart/form-data',
            )

        self.assertEqual(response.status_code, 500)
        self.assertIn('Upload cancelado porque a varredura falhou', response.get_json()['error'])
        self.assertFalse(os.path.exists(os.path.join(self.upload_dir, 'rollback.pfx')))

    def test_remocao_usa_arquivo_como_fallback_para_item_legado(self):
        legado = {
            'arquivo': 'legado.pfx',
            'cnpj': '12345678000190',
            'nome': 'Empresa Legada',
            'vencimento': '01/01/2030',
        }
        legado_path = os.path.join(self.upload_dir, legado['arquivo'])
        with open(legado_path, 'wb') as f:
            f.write(b'certificado legado')

        with patch.object(upload_certificado.ler_certificados, 'carregar_resultados', return_value=[legado]), \
             patch.object(upload_certificado.ler_certificados, 'persistir_resultados') as persistir_resultados:
            response = self.client.post(
                '/remover',
                json={'id': 'id-gerado-no-frontend', 'arquivo': legado['arquivo']},
            )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.get_json(), {'success': True})
        self.assertFalse(os.path.exists(legado_path))
        persistir_resultados.assert_called_once_with([])

    def test_remocao_sem_identificador_retorna_400(self):
        response = self.client.post('/remover', json={})

        self.assertEqual(response.status_code, 400)
        self.assertIn('Identificador do certificado não informado', response.get_json()['error'])

    def test_remocao_inexistente_retorna_404(self):
        with patch.object(upload_certificado.ler_certificados, 'carregar_resultados', return_value=[]):
            response = self.client.post('/remover', json={'id': 'nao-existe'})

        self.assertEqual(response.status_code, 404)
        self.assertIn('Certificado não encontrado', response.get_json()['error'])

    def test_api_certificados_retorna_dados(self):
        resultados = [{'arquivo': 'cert.pfx', 'id': 'abc'}]
        with patch.object(upload_certificado.ler_certificados, 'carregar_resultados', return_value=resultados):
            response = self.client.get('/api/certificados')

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.get_json(), resultados)

    def test_api_certificados_retorna_500_em_erro(self):
        with patch.object(upload_certificado.ler_certificados, 'carregar_resultados', side_effect=RuntimeError('json corrompido')):
            response = self.client.get('/api/certificados')

        self.assertEqual(response.status_code, 500)
        self.assertIn('Erro ao carregar certificados', response.get_json()['error'])

    def test_atualizar_certificados_retorna_sucesso(self):
        with patch.object(upload_certificado.ler_certificados, 'varrer_certificados') as varrer_certificados:
            response = self.client.post('/atualizar')

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.get_json(), {'success': True})
        varrer_certificados.assert_called_once_with()

    def test_atualizar_certificados_retorna_500_em_erro(self):
        with patch.object(upload_certificado.ler_certificados, 'varrer_certificados', side_effect=RuntimeError('falha forçada')):
            response = self.client.post('/atualizar')

        self.assertEqual(response.status_code, 500)
        self.assertIn('falha forçada', response.get_json()['error'])


if __name__ == '__main__':
    unittest.main()