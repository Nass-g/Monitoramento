# Central de Certificados Digitais

Sistema para monitoramento, leitura, upload e tratamento operacional de certificados digitais .pfx.

O projeto combina:

- backend Flask para servir dashboard e API local;
- scanner Python para ler certificados e atualizar a base;
- dashboard operacional para acompanhamento e tratamento dos itens;
- suíte de testes automatizados para fluxos críticos do backend.

## Objetivo

O sistema foi criado para acompanhar vencimentos de certificados digitais de forma simples e visual, reduzindo risco operacional causado por expiração, duplicidade ou falhas de cadastro.

Com ele, você consegue:

- visualizar certificados válidos, próximos do vencimento ou expirados;
- importar novos arquivos .pfx;
- atualizar a leitura da base local;
- remover certificados com segurança;
- detectar duplicidade por CNPJ e vencimento;
- reagir melhor a falhas de leitura e inconsistência de dados.

## Funcionalidades

- Dashboard de monitoramento em tempo real em [static/acompanhamento.html](static/acompanhamento.html)
- Tela operacional para análise, filtro, importação e remoção em [static/analise.html](static/analise.html)
- API local de certificados em [upload_certificado.py](upload_certificado.py)
- Scanner periódico de certificados em [ler_certificados.py](ler_certificados.py)
- Inicializador completo do sistema em [iniciar_tudo.py](iniciar_tudo.py)
- Persistência atômica de resultados para reduzir risco de JSON corrompido
- Testes automatizados para upload, remoção, atualização e scanner

## Estrutura do projeto

```text
dash_cert/
├── iniciar_tudo.py
├── ler_certificados.py
├── upload_certificado.py
├── requirements.txt
├── README.md
├── certificados/
│   ├── resultados.json
│   ├── senhas.json
│   └── *.pfx
├── static/
│   ├── acompanhamento.html
│   ├── acompanhamento.js
│   ├── analise.html
│   ├── analise.js
│   ├── dashboard-common.css
│   ├── dashboard-data.js
│   └── monitor-tv.css
└── tests/
		├── test_ler_certificados.py
		└── test_upload_certificado.py
```

## Requisitos

- Python 3.11 ou superior
- Ambiente Windows já funciona bem no projeto atual
- Certificados .pfx válidos armazenados em [certificados](certificados)

## Instalação

1. Clone o repositório.
2. Crie e ative um ambiente virtual.
3. Instale as dependências.

Exemplo no PowerShell:

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
```

## Como rodar

### Opção 1: sistema completo

Inicia backend, scanner e abre o painel no navegador.

```powershell
python iniciar_tudo.py
```

### Opção 2: apenas o backend

```powershell
python upload_certificado.py
```

Depois acesse:

- Monitoramento: http://127.0.0.1:5000/acompanhamento
- Operação: http://127.0.0.1:5000/analise

### Opção 3: apenas a varredura

```powershell
python ler_certificados.py
```

## Como funciona a base local

- Os arquivos .pfx ficam em [certificados](certificados)
- As senhas por arquivo ficam em [certificados/senhas.json](certificados/senhas.json)
- Os resultados processados ficam em [certificados/resultados.json](certificados/resultados.json)
- Uma cópia para consumo estático também é mantida em [static/certificados/resultados.json](static/certificados/resultados.json)

Exemplo de [certificados/senhas.json](certificados/senhas.json):

```json
{
	"empresa_a.pfx": "senha123",
	"empresa_b.pfx": "outraSenha"
}
```

## Rotas principais

- GET /acompanhamento: dashboard de monitoramento
- GET /analise: tela operacional
- GET /api/certificados: lista a base atual de certificados
- POST /upload: importa um novo .pfx
- POST /atualizar: reprocessa os certificados existentes
- POST /remover: remove um certificado da base e do disco

## Qualidade e testes

O projeto possui testes automatizados para os fluxos mais sensíveis do backend.

Para executar:

```powershell
python -m unittest discover -s tests -v
```

Cobertura atual relevante:

- upload inválido
- rollback quando a varredura falha
- duplicidade por nome
- duplicidade por CNPJ + vencimento
- remoção de item legado
- leitura e persistência do scanner
- erro e sucesso da API

## Decisões técnicas importantes

- Persistência atômica no scanner para evitar JSON parcial
- Identificador estável de certificado para melhorar remoção e seleção na UI
- API sem cache para evitar inconsistência visual no browser
- Tratamento explícito de erro na interface em vez de mostrar lista vazia silenciosamente

## Limitações atuais

- O projeto ainda usa arquivos JSON locais em vez de banco de dados
- Os testes atuais são fortes no backend, mas ainda não cobrem E2E de navegador
- O servidor Flask embutido é adequado para uso local, não para produção real

## Próximas melhorias sugeridas

- Adicionar testes E2E do navegador
- Separar melhor serviços, rotas e persistência no backend
- Adicionar CI mais completo com lint e validações extras
- Evoluir de JSON local para armazenamento mais robusto, se necessário

## Comandos úteis

Se estiver no VS Code, o projeto passa a contar com tasks para:

- iniciar o sistema completo
- iniciar apenas o backend
- rodar todos os testes

## Licença

Uso interno ou educacional, conforme a finalidade do repositório.
