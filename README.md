<p align="center">
	<img src="assets/logo.png" alt="Logo do auto-game-sync" width="220" />
</p>

<h1 align="center">auto-game-sync</h1>

<p align="center">
	Automação em TypeScript + Playwright para sincronizar tempo jogado no PS-Timetracker com o journal do Backloggd.
</p>

O projeto:

- coleta sessões recentes no PS-Timetracker;
- agrega por jogo para uma data de referência;
- abre a lista Playing do Backloggd;
- registra o tempo em cada jogo correspondente;
- falha com erro (exit code != 0) se algum jogo não for sincronizado.

## Como funciona

Fluxo de alto nível:

1. Acessa a página de playtimes do PS-Timetracker.
2. Faz login se necessário (via código de acesso).
3. Lê até 5 páginas de sessões.
4. Converte duração para minutos e agrega por título.
5. Abre o Backloggd e garante sessão válida.
6. Para cada jogo agregado:
   - abre a página do jogo a partir de Playing;
   - abre o editor completo de log;
   - alinha o calendário ao mês/ano da data de referência;
   - seleciona o dia;
   - preenche horas/minutos;
   - salva o play date e depois o journal.
7. Opcionalmente salva `storageState` do Playwright para reutilizar sessão.

## Requisitos

- Node.js 22+
- pnpm 9+
- acesso válido ao Backloggd
- acesso ao PS-Timetracker com código (`PS_TIMETRACKER_CODE`)

## Instalação

```bash
pnpm install
```

O `postinstall` já instala Chromium do Playwright automaticamente.

Se quiser reinstalar manualmente:

```bash
pnpm exec playwright install chromium
```

## Configuração

Copie o arquivo de exemplo:

```bash
cp .env.example .env
```

### Variáveis de ambiente

| Variável                       | Obrigatória | Descrição                                                                                                  |
| ------------------------------ | ----------- | ---------------------------------------------------------------------------------------------------------- |
| `BACKLOGGD_EMAIL`              | Sim         | E-mail de login no Backloggd.                                                                              |
| `BACKLOGGD_PWD`                | Sim         | Senha de login no Backloggd.                                                                               |
| `BACKLOGGD_STORAGE_STATE_PATH` | Não         | Caminho para salvar/reusar sessão Playwright (ex.: `storage/backloggd-state.json`).                        |
| `PS_TIMETRACKER_CODE`          | Sim         | Código de acesso do PS-Timetracker.                                                                        |
| `PS_TIMETRACKER_PSN_NAME`      | Recomendado | PSN usada no formulário de login do PS-Timetracker quando há dois campos.                                  |
| `HEADLESS`                     | Não         | `true` (default) para headless; `false` para modo visível.                                                 |
| `SYNC_DEBUG`                   | Não         | `true` para logs detalhados (linhas lidas, parsing, challenge etc.).                                       |
| `SYNC_REFERENCE_DATE`          | Não         | Data fixa no formato ISO (`YYYY-MM-DD`) para sincronizar (ex.: replay).                                    |
| `SYNC_REFERENCE_DAYS_OFFSET`   | Não         | Offset em dias relativo a hoje (ex.: `-1` para ontem). Ignorado se `SYNC_REFERENCE_DATE` estiver definido. |
| `SMTP_HOST`                    | CI          | Host do servidor SMTP para envio do e-mail de resumo do sync.                                              |
| `SMTP_PORT`                    | CI          | Porta do servidor SMTP (ex.: `587`).                                                                       |
| `SMTP_USERNAME`                | CI          | Usuário/autenticação da conta SMTP.                                                                        |
| `SMTP_PASSWORD`                | CI          | Senha/token da conta SMTP.                                                                                 |
| `SYNC_EMAIL_FROM`              | CI          | Remetente do e-mail de resumo (ex.: `bot@dominio.com`).                                                    |
| `SYNC_EMAIL_TO`                | CI          | Destinatário(s) do e-mail de resumo (separar múltiplos por vírgula, se aplicável).                         |

### Data de referência

Prioridade usada no código:

1. `SYNC_REFERENCE_DATE`
2. `SYNC_REFERENCE_DAYS_OFFSET`
3. hoje

Exemplos:

```bash
# sincronizar ontem
SYNC_REFERENCE_DAYS_OFFSET=-1 pnpm sync:headless

# sincronizar um dia específico
SYNC_REFERENCE_DATE=2026-04-21 pnpm sync:headless
```

## Comandos

```bash
# execução local (usa HEADLESS do .env)
pnpm sync

# execução forçada headless
pnpm sync:headless

# checagem de tipos
pnpm typecheck
```

## Execução local recomendada

Primeira vez, para validar login e possíveis desafios anti-bot:

```bash
HEADLESS=false SYNC_DEBUG=true pnpm sync
```

Depois, rode headless no dia a dia:

```bash
pnpm sync:headless
```

## CI com GitHub Actions

Workflow: `.github/workflows/sync-playtimes.yml`

- agenda diária: `0 9 * * *`
- gatilho manual: `workflow_dispatch`
- runtime: `ubuntu-latest`
- Node 22 + pnpm 9
- instala Chromium com dependências do sistema
- executa `pnpm run sync:headless`

### Secrets esperados no GitHub

- `BACKLOGGD_EMAIL`
- `BACKLOGGD_PWD`
- `PS_TIMETRACKER_CODE`
- `PS_TIMETRACKER_PSN_NAME`
- `SMTP_HOST`
- `SMTP_PORT`
- `SMTP_USERNAME`
- `SMTP_PASSWORD`
- `SYNC_EMAIL_FROM`
- `SYNC_EMAIL_TO`

## Troubleshooting

### 1) Desafio de proteção no Backloggd (Bunny Shield)

Sintoma comum nos logs:

```text
Backloggd challenge detected (Xs). Waiting...
```

O script já espera a liberação por um tempo, mas pode falhar dependendo do desafio.

Checklist:

1. Rode uma vez com `HEADLESS=false`.
2. Mantenha `BACKLOGGD_STORAGE_STATE_PATH=storage/backloggd-state.json`.
3. Confirme se o estado foi salvo após sincronização.
4. Rode novamente em headless.

### 2) Banner de privacidade (GDPR/cookies)

O sync tenta aceitar automaticamente o banner de privacidade do Backloggd (ex.: botão **CONCORDO** ou equivalente em inglês) antes de interagir com a página. O consentimento é salvo em `BACKLOGGD_STORAGE_STATE_PATH` junto com a sessão, então normalmente só precisa ser aceito uma vez.

Se o banner continuar bloqueando cliques (por exemplo, `#game-lists` não fica acessível), rode uma vez com `HEADLESS=false SYNC_DEBUG=true pnpm sync` para validar visualmente e confirme que `storage/backloggd-state.json` foi atualizado.

### 3) Não encontrou jogo na lista Playing

Erro típico: `Game not found on Backloggd playing page`.

Verifique:

1. o jogo está realmente em Playing;
2. diferença relevante de nome entre plataformas;
3. sessão/cookies válidos.

### 4) Login no PS-Timetracker falha

Verifique `PS_TIMETRACKER_CODE` e `PS_TIMETRACKER_PSN_NAME`.

### 5) Processo interrompido manualmente

Se o terminal receber `Ctrl+C`, o Node encerra com código `130` (comportamento esperado).

## Comportamento importante

- O sync é fail-fast por jogo: qualquer erro interrompe a execução com erro final.
- O parser de sessões usa a data de referência e considera sessões recentes ao redor do corte diário.
- O script tenta ser resiliente a mudanças pequenas de UI via seletores alternativos.
- O estado de sessão do Backloggd pode ser persistido para reduzir novos logins.

## Limitações atuais

- A URL de usuário do Backloggd está fixa no código (`/u/henriquetavares/playing/`).
- A leitura do PS-Timetracker está limitada a 5 páginas por execução.
- A busca de card em Playing varre até 500 itens.
- Variações grandes no layout/markup dos sites podem quebrar seletores.

## Estrutura do projeto

```text
.
├── src/
│   ├── domain.ts            # parse de duração/data, normalização e agregação
│   ├── ps-timetracker.ts    # login e scraping de sessões no PS-Timetracker
│   └── sync-playtimes.ts    # orquestração do sync com Backloggd
├── storage/                 # estado de sessão Playwright (opcional)
├── examples/                # HTMLs de referência para debugging local
└── .github/workflows/       # agendamento e execução em CI
```

## Segurança

- Não commitar `.env`.
- Usar apenas Secrets no CI.
- Rotacionar credenciais em caso de vazamento.

## Licença

Este projeto está licenciado sob a Licença MIT. Veja o arquivo [LICENSE](LICENSE) para os termos completos.
