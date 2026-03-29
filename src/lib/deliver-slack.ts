import * as fs from 'fs';

/**
 * Deliver a file to one or more Slack channels via the files.upload API.
 * Requires SLACK_BOT_TOKEN environment variable.
 */
export async function deliverSlack(
  filePath: string,
  fileName: string,
  channels: string[],
  comment?: string,
): Promise<void> {
  const token = process.env.SLACK_BOT_TOKEN;
  if (!token) {
    throw new Error(
      'SLACK_BOT_TOKEN environment variable is required for Slack delivery. ' +
      'Create a Slack app with files:write and chat:write scopes, then set the bot token.',
    );
  }

  const fileBuffer = fs.readFileSync(filePath);

  for (const channel of channels) {
    const form = new FormData();
    form.append('file', new Blob([fileBuffer]), fileName);
    form.append('channels', channel);
    form.append('title', fileName);
    if (comment) {
      form.append('initial_comment', comment);
    }

    const resp = await fetch('https://slack.com/api/files.upload', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
      },
      body: form,
    });

    if (!resp.ok) {
      throw new Error(`Slack API HTTP error for channel ${channel}: ${resp.status} ${resp.statusText}`);
    }

    const body = (await resp.json()) as { ok: boolean; error?: string };
    if (!body.ok) {
      throw new Error(`Slack API error for channel ${channel}: ${body.error || 'unknown error'}`);
    }
  }
}
