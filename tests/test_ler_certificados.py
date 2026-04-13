import json
import tempfile
import unittest
from datetime import datetime
from pathlib import Path
from unittest.mock import patch

import ler_certificados


class FakeCert:
    def __init__(self, serial_number=123456, vencimento=None):
        self.serial_number = serial_number
        self.not_valid_after_utc = vencimento or datetime(2030, 1, 1)


class LerCertificadosTestCase(unittest.TestCase):
    def setUp(self):
        self.tempdir = tempfile.TemporaryDirectory()
        self.base_dir = Path(self.tempdir.name)
        self.certs_dir = self.base_dir / 'certificados'
        self.static_dir = self.base_dir / 'static' / 'certificados'
        self.certs_dir.mkdir(parents=True, exist_ok=True)
        self.static_dir.mkdir(parents=True, exist_ok=True)

        self.base_dir_patcher = patch.object(ler_certificados, 'BASE_DIR', self.base_dir)
        self.certs_dir_patcher = patch.object(ler_certificados, 'CERTS_DIR', self.certs_dir)
        self.senhas_patcher = patch.object(ler_certificados, 'SENHAS_FILE', self.certs_dir / 'senhas.json')
        self.result_patcher = patch.object(ler_certificados, 'RESULT_FILE', self.certs_dir / 'resultados.json')
        self.static_result_patcher = patch.object(ler_certificados, 'STATIC_RESULT_FILE', self.static_dir / 'resultados.json')

        self.base_dir_patcher.start()
        self.certs_dir_patcher.start()
        self.senhas_patcher.start()
        self.result_patcher.start()
        self.static_result_patcher.start()

    def tearDown(self):
        self.base_dir_patcher.stop()
        self.certs_dir_patcher.stop()
        self.senhas_patcher.stop()
        self.result_patcher.stop()
        self.static_result_patcher.stop()
        self.tempdir.cleanup()

    def test_carregar_resultados_sem_arquivo_retorna_lista_vazia(self):
        self.assertEqual(ler_certificados.carregar_resultados(), [])

    def test_persistir_resultados_escreve_arquivo_principal_e_estatico(self):
        resultados = [{'arquivo': 'certificado.pfx', 'id': 'abc123'}]

        ler_certificados.persistir_resultados(resultados)

        with open(self.certs_dir / 'resultados.json', 'r', encoding='utf-8') as f:
            self.assertEqual(json.load(f), resultados)
        with open(self.static_dir / 'resultados.json', 'r', encoding='utf-8') as f:
            self.assertEqual(json.load(f), resultados)

    def test_varrer_certificados_marca_duplicados_e_persiste(self):
        (self.certs_dir / 'a.pfx').write_bytes(b'a')
        (self.certs_dir / 'b.pfx').write_bytes(b'b')
        with open(self.certs_dir / 'senhas.json', 'w', encoding='utf-8') as f:
            json.dump({'a.pfx': 'senha-a', 'b.pfx': 'senha-b'}, f)

        cert_a = FakeCert(serial_number=1)
        cert_b = FakeCert(serial_number=2)

        with patch.object(ler_certificados.pkcs12, 'load_key_and_certificates', side_effect=[(None, cert_a, None), (None, cert_b, None)]), \
             patch.object(ler_certificados, 'extrair_cnpj_nome', return_value=('12345678000190', 'Empresa Teste')):
            ler_certificados.varrer_certificados()

        resultados = ler_certificados.carregar_resultados()
        self.assertEqual(len(resultados), 2)
        self.assertTrue(all(item['duplicado'] for item in resultados))
        self.assertEqual(resultados[0]['cnpj'], '12345678000190')

    def test_varrer_certificados_sem_senhas_json_usa_lista_padrao(self):
        (self.certs_dir / 'unico.pfx').write_bytes(b'a')

        with patch.object(ler_certificados.pkcs12, 'load_key_and_certificates', return_value=(None, FakeCert(), None)) as load_key, \
             patch.object(ler_certificados, 'extrair_cnpj_nome', return_value=('12345678000190', 'Empresa Teste')):
            ler_certificados.varrer_certificados()

        resultados = ler_certificados.carregar_resultados()
        self.assertEqual(len(resultados), 1)
        self.assertGreaterEqual(load_key.call_count, 1)

    def test_varrer_certificados_falha_com_senha_json_invalido(self):
        with open(self.certs_dir / 'senhas.json', 'w', encoding='utf-8') as f:
            f.write('{invalido')

        with self.assertRaises(RuntimeError) as ctx:
            ler_certificados.varrer_certificados()

        self.assertIn('Erro ao carregar senhas', str(ctx.exception))


if __name__ == '__main__':
    unittest.main()