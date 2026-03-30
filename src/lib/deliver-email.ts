import * as fs from 'fs';
import * as path from 'path';

/**
 * Deliver a file via email using one of the supported REST API providers.
 * Requires EMAIL_FROM environment variable for the sender address.
 */
export async function deliverEmail(
  filePath: string,
  fileName: string,
  config: { to: string[]; subject: string; provider: string },
): Promise<void> {
  const from = process.env.EMAIL_FROM;
  if (!from) {
    throw new Error(
      'EMAIL_FROM environment variable is required for email delivery (e.g., reports@mycompany.com).',
    );
  }

  const fileBuffer = fs.readFileSync(filePath);
  const contentType = fileName.endsWith('.pdf') ? 'application/pdf' : 'image/png';
  const reportName = path.basename(path.dirname(filePath));
  const dateStr = new Date().toISOString().split('T')[0];
  const htmlBody = `<p>Your scheduled report is attached.</p>\n<p><strong>${reportName}</strong> &mdash; Generated ${dateStr}</p>`;

  switch (config.provider.toLowerCase()) {
    case 'sendgrid':
      await sendViaSendGrid(fileBuffer, fileName, contentType, config.to, config.subject, from, htmlBody);
      break;
    case 'postmark':
      await sendViaPostmark(fileBuffer, fileName, contentType, config.to, config.subject, from, htmlBody);
      break;
    case 'mailgun':
      await sendViaMailgun(filePath, fileBuffer, fileName, contentType, config.to, config.subject, from, htmlBody);
      break;
    case 'resend':
      await sendViaResend(fileBuffer, fileName, config.to, config.subject, from, htmlBody);
      break;
    case 'ses':
      await sendViaSes(fileBuffer, fileName, contentType, config.to, config.subject, from, htmlBody);
      break;
    default:
      throw new Error(
        `Unsupported email provider: "${config.provider}". ` +
        'Supported providers: sendgrid, postmark, mailgun, resend, ses.',
      );
  }
}

// ---------------------------------------------------------------------------
// SendGrid
// ---------------------------------------------------------------------------

async function sendViaSendGrid(
  fileBuffer: Buffer,
  fileName: string,
  contentType: string,
  to: string[],
  subject: string,
  from: string,
  htmlBody: string,
): Promise<void> {
  const apiKey = requireEnv('SENDGRID_API_KEY', 'SendGrid');

  const body = {
    personalizations: [{ to: to.map((email) => ({ email })) }],
    from: { email: from },
    subject,
    content: [{ type: 'text/html', value: htmlBody }],
    attachments: [
      {
        content: fileBuffer.toString('base64'),
        filename: fileName,
        type: contentType,
        disposition: 'attachment',
      },
    ],
  };

  const resp = await fetch('https://api.sendgrid.com/v3/mail/send', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`SendGrid API error ${resp.status}: ${text}`);
  }
}

// ---------------------------------------------------------------------------
// Postmark
// ---------------------------------------------------------------------------

async function sendViaPostmark(
  fileBuffer: Buffer,
  fileName: string,
  contentType: string,
  to: string[],
  subject: string,
  from: string,
  htmlBody: string,
): Promise<void> {
  const apiKey = requireEnv('POSTMARK_API_KEY', 'Postmark');

  const body = {
    From: from,
    To: to.join(', '),
    Subject: subject,
    HtmlBody: htmlBody,
    Attachments: [
      {
        Name: fileName,
        Content: fileBuffer.toString('base64'),
        ContentType: contentType,
      },
    ],
  };

  const resp = await fetch('https://api.postmarkapp.com/email', {
    method: 'POST',
    headers: {
      'X-Postmark-Server-Token': apiKey,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Postmark API error ${resp.status}: ${text}`);
  }
}

// ---------------------------------------------------------------------------
// Mailgun
// ---------------------------------------------------------------------------

async function sendViaMailgun(
  filePath: string,
  fileBuffer: Buffer,
  fileName: string,
  _contentType: string,
  to: string[],
  subject: string,
  from: string,
  htmlBody: string,
): Promise<void> {
  const apiKey = requireEnv('MAILGUN_API_KEY', 'Mailgun');
  const domain = process.env.MAILGUN_DOMAIN;
  if (!domain) {
    throw new Error('MAILGUN_DOMAIN environment variable is required for Mailgun delivery.');
  }

  const form = new FormData();
  form.append('from', from);
  for (const recipient of to) {
    form.append('to', recipient);
  }
  form.append('subject', subject);
  form.append('html', htmlBody);
  form.append('attachment', new Blob([fileBuffer]), fileName);

  const credentials = Buffer.from(`api:${apiKey}`).toString('base64');

  const resp = await fetch(`https://api.mailgun.net/v3/${domain}/messages`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${credentials}`,
    },
    body: form,
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Mailgun API error ${resp.status}: ${text}`);
  }
}

// ---------------------------------------------------------------------------
// Resend
// ---------------------------------------------------------------------------

async function sendViaResend(
  fileBuffer: Buffer,
  fileName: string,
  to: string[],
  subject: string,
  from: string,
  htmlBody: string,
): Promise<void> {
  const apiKey = requireEnv('RESEND_API_KEY', 'Resend');

  const body = {
    from,
    to,
    subject,
    html: htmlBody,
    attachments: [
      {
        filename: fileName,
        content: fileBuffer.toString('base64'),
      },
    ],
  };

  const resp = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Resend API error ${resp.status}: ${text}`);
  }
}

// ---------------------------------------------------------------------------
// AWS SES (requires @aws-sdk/client-sesv2 as optional peer dependency)
// ---------------------------------------------------------------------------

async function sendViaSes(
  fileBuffer: Buffer,
  fileName: string,
  contentType: string,
  to: string[],
  subject: string,
  from: string,
  htmlBody: string,
): Promise<void> {
  let sesModule: any;
  try {
    sesModule = require('@aws-sdk/client-sesv2');
  } catch {
    throw new Error(
      'AWS SES requires @aws-sdk/client-sesv2. Install it with: npm install @aws-sdk/client-sesv2',
    );
  }

  const { SESv2Client, SendEmailCommand } = sesModule;

  // Build raw MIME message with attachment
  const boundary = `----boundary-${Date.now()}`;
  const mimeMessage = [
    `From: ${from}`,
    `To: ${to.join(', ')}`,
    `Subject: ${subject}`,
    `MIME-Version: 1.0`,
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    '',
    `--${boundary}`,
    'Content-Type: text/html; charset=UTF-8',
    'Content-Transfer-Encoding: 7bit',
    '',
    htmlBody,
    '',
    `--${boundary}`,
    `Content-Type: ${contentType}; name="${fileName}"`,
    'Content-Transfer-Encoding: base64',
    `Content-Disposition: attachment; filename="${fileName}"`,
    '',
    fileBuffer.toString('base64'),
    '',
    `--${boundary}--`,
  ].join('\r\n');

  const region = process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || 'us-east-1';
  const client = new SESv2Client({ region });

  const command = new SendEmailCommand({
    Content: {
      Raw: {
        Data: Buffer.from(mimeMessage),
      },
    },
  });

  await client.send(command);
}

// ---------------------------------------------------------------------------
// Alarm email delivery (no attachment — just HTML body with custom subject)
// ---------------------------------------------------------------------------

export async function sendAlarmEmail(
  htmlBody: string,
  subject: string,
  config: { to: string[]; provider: string },
): Promise<void> {
  const from = process.env.EMAIL_FROM;
  if (!from) {
    throw new Error('EMAIL_FROM environment variable is required for email alarm delivery.');
  }

  switch (config.provider.toLowerCase()) {
    case 'sendgrid':
      await sendAlarmViaSendGrid(config.to, subject, from, htmlBody);
      break;
    case 'postmark':
      await sendAlarmViaPostmark(config.to, subject, from, htmlBody);
      break;
    case 'mailgun':
      await sendAlarmViaMailgun(config.to, subject, from, htmlBody);
      break;
    case 'resend':
      await sendAlarmViaResend(config.to, subject, from, htmlBody);
      break;
    case 'ses':
      await sendAlarmViaSes(config.to, subject, from, htmlBody);
      break;
    default:
      throw new Error(`Unsupported email provider: "${config.provider}".`);
  }
}

async function sendAlarmViaSendGrid(to: string[], subject: string, from: string, htmlBody: string): Promise<void> {
  const apiKey = requireEnv('SENDGRID_API_KEY', 'SendGrid');
  const body = {
    personalizations: [{ to: to.map((email) => ({ email })) }],
    from: { email: from },
    subject,
    content: [{ type: 'text/html', value: htmlBody }],
  };
  const resp = await fetch('https://api.sendgrid.com/v3/mail/send', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!resp.ok) throw new Error(`SendGrid API error ${resp.status}: ${await resp.text()}`);
}

async function sendAlarmViaPostmark(to: string[], subject: string, from: string, htmlBody: string): Promise<void> {
  const apiKey = requireEnv('POSTMARK_API_KEY', 'Postmark');
  const body = { From: from, To: to.join(', '), Subject: subject, HtmlBody: htmlBody };
  const resp = await fetch('https://api.postmarkapp.com/email', {
    method: 'POST',
    headers: { 'X-Postmark-Server-Token': apiKey, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body),
  });
  if (!resp.ok) throw new Error(`Postmark API error ${resp.status}: ${await resp.text()}`);
}

async function sendAlarmViaMailgun(to: string[], subject: string, from: string, htmlBody: string): Promise<void> {
  const apiKey = requireEnv('MAILGUN_API_KEY', 'Mailgun');
  const domain = process.env.MAILGUN_DOMAIN;
  if (!domain) throw new Error('MAILGUN_DOMAIN environment variable is required for Mailgun delivery.');
  const form = new FormData();
  form.append('from', from);
  for (const recipient of to) form.append('to', recipient);
  form.append('subject', subject);
  form.append('html', htmlBody);
  const credentials = Buffer.from(`api:${apiKey}`).toString('base64');
  const resp = await fetch(`https://api.mailgun.net/v3/${domain}/messages`, {
    method: 'POST',
    headers: { Authorization: `Basic ${credentials}` },
    body: form,
  });
  if (!resp.ok) throw new Error(`Mailgun API error ${resp.status}: ${await resp.text()}`);
}

async function sendAlarmViaResend(to: string[], subject: string, from: string, htmlBody: string): Promise<void> {
  const apiKey = requireEnv('RESEND_API_KEY', 'Resend');
  const body = { from, to, subject, html: htmlBody };
  const resp = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!resp.ok) throw new Error(`Resend API error ${resp.status}: ${await resp.text()}`);
}

async function sendAlarmViaSes(to: string[], subject: string, from: string, htmlBody: string): Promise<void> {
  let sesModule: any;
  try {
    sesModule = require('@aws-sdk/client-sesv2');
  } catch {
    throw new Error('AWS SES requires @aws-sdk/client-sesv2. Install it with: npm install @aws-sdk/client-sesv2');
  }
  const { SESv2Client, SendEmailCommand } = sesModule;
  const boundary = `----boundary-${Date.now()}`;
  const mimeMessage = [
    `From: ${from}`, `To: ${to.join(', ')}`, `Subject: ${subject}`,
    'MIME-Version: 1.0', `Content-Type: text/html; charset=UTF-8`, 'Content-Transfer-Encoding: 7bit', '', htmlBody,
  ].join('\r\n');
  const region = process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || 'us-east-1';
  const client = new SESv2Client({ region });
  await client.send(new SendEmailCommand({ Content: { Raw: { Data: Buffer.from(mimeMessage) } } }));
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function requireEnv(name: string, providerLabel: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} environment variable is required for ${providerLabel} email delivery.`);
  }
  return value;
}
