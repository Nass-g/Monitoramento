import subprocess
import webbrowser
import os
import time
import sys

# Caminho para os scripts
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
UPLOAD_SCRIPT = os.path.join(BASE_DIR, 'upload_certificado.py')
LER_SCRIPT = os.path.join(BASE_DIR, 'ler_certificados.py')

# Iniciar o backend Flask
flask_proc = subprocess.Popen(['python', UPLOAD_SCRIPT])
print('Backend Flask iniciado.')

time.sleep(2)  # Aguardar o backend subir

# Iniciar varredura automática em paralelo
varredura_proc = subprocess.Popen(['python', LER_SCRIPT])
print('Varredura automática iniciada.')

time.sleep(1)

# Abrir o painel no navegador
webbrowser.open('http://localhost:5000/')
print('Painel aberto no navegador (http://localhost:5000/).')
print()
print('Sistema iniciado! Pressione Ctrl+C para encerrar.')

try:
    while True:
        # Reiniciar Flask se cair inesperadamente
        if flask_proc.poll() is not None:
            print('Backend encerrou inesperadamente. Reiniciando...')
            flask_proc = subprocess.Popen(['python', UPLOAD_SCRIPT])
        time.sleep(5)
except KeyboardInterrupt:
    print()
    print('Encerrando sistema...')
    flask_proc.terminate()
    varredura_proc.terminate()
    flask_proc.wait()
    varredura_proc.wait()
    print('Sistema encerrado.')
    sys.exit(0)
