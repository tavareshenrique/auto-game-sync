import { readFile, writeFile, mkdir } from 'node:fs/promises';
import * as path from 'node:path';

const SYNC_SUMMARY_PATH = process.env.SYNC_SUMMARY_PATH ?? 'storage/sync-summary.json';
const OUTPUT_PATH = process.env.EMAIL_OUTPUT_PATH ?? 'storage/email-body.html';

type SyncSummaryGame = {
  title: string;
  playedTime: string;
  registeredDay: string;
  coverUrl?: string;
};

type SyncSummary = {
  generatedAt: string;
  referenceDate: string;
  totalGames: number;
  games: SyncSummaryGame[];
};

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function placeholderGradient(title: string): string {
  const firstLetter = escapeHtml(title.charAt(0).toUpperCase());
  return `
    <table cellpadding="0" cellspacing="0" width="60" height="90" style="border-collapse: collapse; background: linear-gradient(135deg, #6366f1 0%, #4f46e5 100%); border-radius: 8px; width: 60px; height: 90px; text-align: center;">
      <tr>
        <td style="color: #ffffff; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; font-size: 24px; font-weight: bold; text-align: center; vertical-align: middle;">
          ${firstLetter}
        </td>
      </tr>
    </table>`;
}

function gameCoverHtml(game: SyncSummaryGame): string {
  if (game.coverUrl) {
    const escapedSrc = escapeHtml(game.coverUrl);
    const escapedAlt = escapeHtml(game.title);
    return `<img src="${escapedSrc}" width="60" height="90" style="display: block; border-radius: 8px; object-fit: cover; border: 1px solid #e2e8f0; width: 60px; height: 90px;" alt="${escapedAlt}" />`;
  }
  return placeholderGradient(game.title);
}

function gameCardHtml(game: SyncSummaryGame): string {
  const escapedTitle = escapeHtml(game.title);
  const escapedTime = escapeHtml(game.playedTime);
  const escapedDay = escapeHtml(game.registeredDay);
  const coverHtml = gameCoverHtml(game);

  return `
      <tr>
        <td style="padding: 16px 0; border-bottom: 1px solid #f1f5f9;">
          <table cellpadding="0" cellspacing="0" width="100%" style="border-collapse: collapse; width: 100%;">
            <tr>
              <td width="76" style="vertical-align: top; width: 76px;">
                ${coverHtml}
              </td>
              <td style="vertical-align: middle; padding-left: 4px;">
                <h3 style="margin: 0 0 6px 0; color: #0f172a; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; font-size: 16px; font-weight: 600; line-height: 1.4;">
                  ${escapedTitle}
                </h3>
                <table cellpadding="0" cellspacing="0" style="border-collapse: collapse;">
                  <tr>
                    <td style="padding-right: 12px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; font-size: 13px; color: #4f46e5; font-weight: 600; vertical-align: middle;">
                      <span style="display: inline-block; vertical-align: middle; margin-right: 4px;">⏱️</span>
                      <span style="vertical-align: middle;">${escapedTime}</span>
                    </td>
                    <td style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; font-size: 12px; color: #64748b; vertical-align: middle;">
                      <span style="display: inline-block; vertical-align: middle; margin-right: 4px;">📅</span>
                      <span style="vertical-align: middle;">Sincronizado: ${escapedDay}</span>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
          </table>
        </td>
      </tr>`;
}

function buildEmailHtml(summary: SyncSummary): string {
  const gamesHtml = summary.games.map(gameCardHtml).join('');

  const isSingular = summary.totalGames === 1;
  const gameCountText = isSingular
    ? '1 jogo sincronizado'
    : `${summary.totalGames} jogos sincronizados`;
  const verb = isSingular ? 'foi registrado' : 'foram registrados';

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Auto Game Sync - Sincronização Concluída</title>
</head>
<body style="margin: 0; padding: 0; background-color: #f8fafc; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; -webkit-font-smoothing: antialiased; -moz-osx-font-smoothing: grayscale;">
  <table cellpadding="0" cellspacing="0" width="100%" style="border-collapse: collapse; width: 100%; background-color: #f8fafc; padding: 40px 0 60px 0;">
    <tr>
      <td align="center">
        <table cellpadding="0" cellspacing="0" width="600" style="border-collapse: collapse; width: 600px; max-width: 600px; background-color: #ffffff; border-radius: 16px; border: 1px solid #e2e8f0; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05), 0 2px 4px -1px rgba(0, 0, 0, 0.03); margin-top: 40px;">

          <tr>
            <td style="padding: 40px 40px 24px 40px; border-bottom: 1px solid #f1f5f9;">
              <table cellpadding="0" cellspacing="0" width="100%" style="border-collapse: collapse; width: 100%;">
                <tr>
                  <td>
                    <table cellpadding="0" cellspacing="0" style="border-collapse: collapse;">
                      <tr>
                        <td style="background-color: #dcfce7; color: #15803d; font-size: 11px; font-weight: 700; padding: 6px 12px; border-radius: 9999px; text-transform: uppercase; letter-spacing: 0.05em; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">
                          ✓ Sincronizado
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
                <tr>
                  <td style="padding-top: 20px;">
                    <h1 style="margin: 0; font-size: 26px; font-weight: 800; color: #0f172a; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; letter-spacing: -0.02em;">
                      Auto Game Sync
                    </h1>
                    <p style="margin: 6px 0 0 0; font-size: 14px; color: #64748b; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; line-height: 1.5;">
                      ${gameCountText} no dia <strong>${escapeHtml(summary.games[0]?.registeredDay ?? '')}</strong> ${verb} com sucesso no Backloggd.
                    </p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <tr>
            <td style="padding: 16px 40px 32px 40px;">
              <table cellpadding="0" cellspacing="0" width="100%" style="border-collapse: collapse; width: 100%;">
                ${gamesHtml}
              </table>
            </td>
          </tr>

          <tr>
            <td style="padding: 24px 40px; background-color: #fafafa; border-bottom-left-radius: 16px; border-bottom-right-radius: 16px; border-top: 1px solid #f1f5f9; text-align: center;">
              <table cellpadding="0" cellspacing="0" width="100%" style="border-collapse: collapse; width: 100%;">
                <tr>
                  <td align="center">
                    <a href="https://backloggd.com" target="_blank" style="display: inline-block; background-color: #0f172a; color: #ffffff; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; font-size: 13px; font-weight: 600; text-decoration: none; padding: 10px 20px; border-radius: 8px;">
                      Ir para o Backloggd
                    </a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

        </table>

        <table cellpadding="0" cellspacing="0" width="600" style="border-collapse: collapse; width: 600px; max-width: 600px; margin-top: 24px;">
          <tr>
            <td align="center" style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; font-size: 12px; color: #94a3b8; line-height: 1.5; padding: 0 20px;">
              Este é um e-mail automático enviado pelo fluxo de integração do <strong>Auto Game Sync</strong>.<br>
              © 2026 Henrique Tavares. Todos os direitos reservados.
            </td>
          </tr>
        </table>

      </td>
    </tr>
  </table>
</body>
</html>`;
}

async function main(): Promise<void> {
  const raw = await readFile(SYNC_SUMMARY_PATH, 'utf8');
  const summary: SyncSummary = JSON.parse(raw);

  const html = buildEmailHtml(summary);

  const outputDir = path.dirname(OUTPUT_PATH);
  if (outputDir) {
    await mkdir(outputDir, { recursive: true }).catch(() => undefined);
  }

  await writeFile(OUTPUT_PATH, html, 'utf8');
  console.log(`Email body generated at ${OUTPUT_PATH}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
