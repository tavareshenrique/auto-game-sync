# auto-game-sync

Automação em Playwright para sincronizar tempo de jogo do PS-Timetracker com o Backloggd.

## Environment

Copie [.env.example](.env.example) para `.env` e configure:

- `BACKLOGGD_EMAIL`
- `BACKLOGGD_PWD`
- `PS_TIMETRACKER_CODE`
- `PS_TIMETRACKER_PSN_NAME`

Para testar com logs de ontem, defina `SYNC_REFERENCE_DATE=2026-04-21` ou `SYNC_REFERENCE_DAYS_OFFSET=-1` antes de rodar o script.

## Scripts

- `npm run sync` para rodar localmente.
- `npm run sync:headless` para rodar em modo CI.
- `npm run typecheck` para checar tipos.

Se este clone ainda não tiver os navegadores do Playwright, rode `pnpm exec playwright install chromium` uma vez.

## Notes

O fluxo de Backloggd usa heurísticas de matching flexível para o Quick Log e não interrompe a sincronização inteira se um jogo não for encontrado.