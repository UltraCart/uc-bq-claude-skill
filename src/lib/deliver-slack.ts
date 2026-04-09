import * as fs from 'fs';

interface SlackUploadUrlResponse {
  ok: boolean;
  error?: string;
  upload_url: string;
  file_id: string;
}

interface SlackApiResponse {
  ok: boolean;
  error?: string;
}

/**
 * Deliver a file to one or more Slack channels via the files.uploadV2 flow
 * (getUploadURLExternal → upload → completeUploadExternal).
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
    // Step 1: Get a pre-signed upload URL
    const step1Resp = await fetch('https://slack.com/api/files.getUploadURLExternal', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        filename: fileName,
        length: String(fileBuffer.byteLength),
      }),
    });

    if (!step1Resp.ok) {
      throw new Error(`Slack getUploadURLExternal HTTP error for channel ${channel}: ${step1Resp.status} ${step1Resp.statusText}`);
    }

    const step1Body = (await step1Resp.json()) as SlackUploadUrlResponse;
    if (!step1Body.ok) {
      throw new Error(`Slack getUploadURLExternal error for channel ${channel}: ${step1Body.error || 'unknown error'}`);
    }

    // Step 2: Upload file bytes to the pre-signed URL
    const step2Resp = await fetch(step1Body.upload_url, {
      method: 'POST',
      body: fileBuffer,
    });

    if (!step2Resp.ok) {
      throw new Error(`Slack file upload HTTP error for channel ${channel}: ${step2Resp.status} ${step2Resp.statusText}`);
    }

    // Step 3: Complete the upload and share to channel
    const completeBody: Record<string, unknown> = {
      files: [{ id: step1Body.file_id, title: fileName }],
      channel_id: channel,
    };
    if (comment) {
      completeBody.initial_comment = comment;
    }

    const step3Resp = await fetch('https://slack.com/api/files.completeUploadExternal', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json; charset=utf-8',
      },
      body: JSON.stringify(completeBody),
    });

    if (!step3Resp.ok) {
      throw new Error(`Slack completeUploadExternal HTTP error for channel ${channel}: ${step3Resp.status} ${step3Resp.statusText}`);
    }

    const step3Body = (await step3Resp.json()) as SlackApiResponse;
    if (!step3Body.ok) {
      throw new Error(`Slack completeUploadExternal error for channel ${channel}: ${step3Body.error || 'unknown error'}`);
    }
  }
}
