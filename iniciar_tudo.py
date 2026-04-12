import os
import signal
import socket
import subprocess
import sys
import time
import webbrowser
from pathlib import Path


BASE_DIR = Path(__file__).resolve().parent
UPLOAD_SCRIPT = BASE_DIR / "upload_certificado.py"
LER_SCRIPT = BASE_DIR / "ler_certificados.py"
PAINEL_URL = "http://localhost:5000/"
TEMPO_ESPERA_BACKEND = 2
INTERVALO_MONITORAMENTO = 5
FLASK_PORT = 5000


def porta_em_uso(porta: int) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        return s.connect_ex(("127.0.0.1", porta)) == 0


def liberar_porta(porta: int) -> None:
    """Encerra qualquer processo usando a porta no Windows."""
    if not porta_em_uso(porta):
        return
    print(f"Porta {porta} em uso. Tentando liberar...")
    if os.name == "nt":
        try:
            result = subprocess.run(
                ["netstat", "-ano"],
                capture_output=True, text=True
            )
            for line in result.stdout.splitlines():
                if f":{porta}" in line and "LISTENING" in line:
                    pid = line.strip().split()[-1]
                    subprocess.run(["taskkill", "/F", "/PID", pid],
                                   capture_output=True)
                    print(f"Processo PID {pid} encerrado.")
                    time.sleep(0.5)
                    break
        except Exception as e:
            print(f"Aviso: não foi possível liberar a porta automaticamente: {e}")

def iniciar_processo(script: Path, nome: str) -> subprocess.Popen:
    if not script.exists():
        raise FileNotFoundError(f"Script não encontrado: {script}")

    processo = subprocess.Popen([sys.executable, str(script)], cwd=BASE_DIR)
    print(f"{nome} iniciado.")
    return processo


def reiniciar_se_necessario(
    processo: subprocess.Popen, script: Path, nome: str
) -> subprocess.Popen:
    codigo_saida = processo.poll()
    if codigo_saida is None:
        return processo

    print(f"{nome} encerrou inesperadamente (código {codigo_saida}). Reiniciando...")
    return iniciar_processo(script, nome)


def encerrar_processo(processo: subprocess.Popen, nome: str) -> None:
    if processo.poll() is not None:
        return

    print(f"Encerrando {nome}...")
    processo.terminate()

    try:
        processo.wait(timeout=5)
    except subprocess.TimeoutExpired:
        print(f"{nome} não encerrou a tempo. Forçando finalização...")
        processo.kill()
        processo.wait()


def main() -> int:
    if os.name == "nt":
        signal.signal(signal.SIGINT, signal.default_int_handler)

    liberar_porta(FLASK_PORT)

    flask_proc = iniciar_processo(UPLOAD_SCRIPT, "Backend Flask")

    time.sleep(TEMPO_ESPERA_BACKEND)

    varredura_proc = iniciar_processo(LER_SCRIPT, "Varredura automática")

    time.sleep(1)
    webbrowser.open(PAINEL_URL)

    print(f"Painel aberto no navegador ({PAINEL_URL}).")
    print()
    print("Sistema iniciado! Pressione Ctrl+C para encerrar.")

    try:
        while True:
            flask_proc = reiniciar_se_necessario(
                flask_proc, UPLOAD_SCRIPT, "Backend Flask"
            )
            varredura_proc = reiniciar_se_necessario(
                varredura_proc, LER_SCRIPT, "Varredura automática"
            )
            time.sleep(INTERVALO_MONITORAMENTO)
    except KeyboardInterrupt:
        print()
        print("Encerrando sistema...")
        encerrar_processo(flask_proc, "Backend Flask")
        encerrar_processo(varredura_proc, "Varredura automática")
        print("Sistema encerrado.")
        return 0


if __name__ == "__main__":
    raise SystemExit(main())
