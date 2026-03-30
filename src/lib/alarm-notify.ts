import { DeliveryConfig } from './manifest';
import { AlarmResult } from './alarm';

/**
 * Deliver alarm notifications via Slack and/or email.
 * Only sends for triggered, non-suppressed alarms.
 * Never throws — logs errors but doesn't crash the run.
 */
export async function deliverAlarmNotifications(
  reportName: string,
  results: AlarmResult[],
  delivery: DeliveryConfig,
): Promise<void> {
  const firedAlarms = results.filter(r => r.triggered && !r.suppressed);
  if (firedAlarms.length === 0) return;

  if (delivery.slack) {
    try {
      await deliverAlarmSlack(reportName, firedAlarms, delivery.slack);
    } catch (err: any) {
      console.error(`  Alarm Slack delivery failed: ${err.message}`);
    }
  }

  if (delivery.email) {
    try {
      await deliverAlarmEmail(reportName, firedAlarms, delivery.email);
    } catch (err: any) {
      console.error(`  Alarm email delivery failed: ${err.message}`);
    }
  }
}

/**
 * Deliver alarm notifications for a deck (aggregated across reports).
 */
export async function deliverDeckAlarmNotifications(
  deckTitle: string,
  reportAlarms: Array<{ reportName: string; results: AlarmResult[] }>,
  delivery: DeliveryConfig,
): Promise<void> {
  // Collect all fired, non-suppressed alarms across reports
  const allFired: Array<{ reportName: string; result: AlarmResult }> = [];
  for (const { reportName, results } of reportAlarms) {
    for (const result of results) {
      if (result.triggered && !result.suppressed) {
        allFired.push({ reportName, result });
      }
    }
  }

  if (allFired.length === 0) return;

  if (delivery.slack) {
    try {
      await deliverDeckAlarmSlack(deckTitle, allFired, delivery.slack);
    } catch (err: any) {
      console.error(`  Deck alarm Slack delivery failed: ${err.message}`);
    }
  }

  if (delivery.email) {
    try {
      await deliverDeckAlarmEmail(deckTitle, allFired, delivery.email);
    } catch (err: any) {
      console.error(`  Deck alarm email delivery failed: ${err.message}`);
    }
  }
}

// ---------------------------------------------------------------------------
// Slack alarm delivery
// ---------------------------------------------------------------------------

async function deliverAlarmSlack(
  reportName: string,
  alarms: AlarmResult[],
  config: { channels: string[]; mention_on_alarm?: string },
): Promise<void> {
  const token = process.env.SLACK_BOT_TOKEN;
  if (!token) {
    throw new Error('SLACK_BOT_TOKEN environment variable is required for Slack alarm delivery.');
  }

  const hasCritical = alarms.some(a => a.alarm.severity === 'critical');
  const mention = hasCritical && config.mention_on_alarm ? `${config.mention_on_alarm} ` : '';
  const color = hasCritical ? '#dc3545' : '#fd7e14'; // red for critical, orange for high
  const dateStr = new Date().toISOString().split('T')[0];

  const blocks = buildAlarmBlocks(reportName, alarms, dateStr);
  const fallbackText = `${mention}[ALARM] ${reportName} — ${alarms.length} alarm(s) triggered`;

  for (const channel of config.channels) {
    const body = {
      channel,
      text: fallbackText,
      attachments: [
        {
          color,
          blocks,
          fallback: fallbackText,
        },
      ],
    };

    const resp = await fetch('https://slack.com/api/chat.postMessage', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!resp.ok) {
      throw new Error(`Slack API HTTP error for channel ${channel}: ${resp.status} ${resp.statusText}`);
    }

    const result = (await resp.json()) as { ok: boolean; error?: string };
    if (!result.ok) {
      throw new Error(`Slack API error for channel ${channel}: ${result.error || 'unknown error'}`);
    }
  }
}

async function deliverDeckAlarmSlack(
  deckTitle: string,
  allFired: Array<{ reportName: string; result: AlarmResult }>,
  config: { channels: string[]; mention_on_alarm?: string },
): Promise<void> {
  const token = process.env.SLACK_BOT_TOKEN;
  if (!token) {
    throw new Error('SLACK_BOT_TOKEN environment variable is required for Slack alarm delivery.');
  }

  const hasCritical = allFired.some(a => a.result.alarm.severity === 'critical');
  const mention = hasCritical && config.mention_on_alarm ? `${config.mention_on_alarm} ` : '';
  const color = hasCritical ? '#dc3545' : '#fd7e14';
  const dateStr = new Date().toISOString().split('T')[0];

  const blocks = buildDeckAlarmBlocks(deckTitle, allFired, dateStr);
  const fallbackText = `${mention}[ALARM] ${deckTitle} — ${allFired.length} alarm(s) triggered across reports`;

  for (const channel of config.channels) {
    const body = {
      channel,
      text: fallbackText,
      attachments: [
        {
          color,
          blocks,
          fallback: fallbackText,
        },
      ],
    };

    const resp = await fetch('https://slack.com/api/chat.postMessage', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!resp.ok) {
      throw new Error(`Slack API HTTP error for channel ${channel}: ${resp.status} ${resp.statusText}`);
    }

    const result = (await resp.json()) as { ok: boolean; error?: string };
    if (!result.ok) {
      throw new Error(`Slack API error for channel ${channel}: ${result.error || 'unknown error'}`);
    }
  }
}

function buildAlarmBlocks(reportName: string, alarms: AlarmResult[], dateStr: string): any[] {
  const blocks: any[] = [
    {
      type: 'header',
      text: { type: 'plain_text', text: `\u26a0\ufe0f ALARM: ${reportName}`, emoji: true },
    },
    {
      type: 'context',
      elements: [{ type: 'mrkdwn', text: dateStr }],
    },
  ];

  for (const alarm of alarms) {
    const severityIcon = alarm.alarm.severity === 'critical' ? '\ud83d\udd34' : '\ud83d\udfe0';
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `${severityIcon} *${alarm.alarm.name}* [${alarm.alarm.severity}]\n${alarm.reason}`,
      },
    });
  }

  return blocks;
}

function buildDeckAlarmBlocks(
  deckTitle: string,
  allFired: Array<{ reportName: string; result: AlarmResult }>,
  dateStr: string,
): any[] {
  const blocks: any[] = [
    {
      type: 'header',
      text: { type: 'plain_text', text: `\u26a0\ufe0f ALARM: ${deckTitle}`, emoji: true },
    },
    {
      type: 'context',
      elements: [{ type: 'mrkdwn', text: `${dateStr} \u2014 ${allFired.length} alarm(s) triggered across reports` }],
    },
  ];

  // Group by report
  const byReport = new Map<string, AlarmResult[]>();
  for (const { reportName, result } of allFired) {
    if (!byReport.has(reportName)) byReport.set(reportName, []);
    byReport.get(reportName)!.push(result);
  }

  for (const [reportName, alarms] of byReport) {
    const alarmLines = alarms.map(a => {
      const icon = a.alarm.severity === 'critical' ? '\ud83d\udd34' : '\ud83d\udfe0';
      return `${icon} *${a.alarm.name}* [${a.alarm.severity}]: ${a.reason}`;
    }).join('\n');

    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*${reportName}*\n${alarmLines}`,
      },
    });
  }

  return blocks;
}

// ---------------------------------------------------------------------------
// Email alarm delivery
// ---------------------------------------------------------------------------

async function deliverAlarmEmail(
  reportName: string,
  alarms: AlarmResult[],
  config: { to: string[]; subject: string; provider: string },
): Promise<void> {
  const { deliverEmail } = await import('./deliver-email');

  // Build a minimal HTML alarm email
  const htmlBody = buildAlarmEmailHtml(reportName, alarms);
  const subject = `[ALARM] ${reportName} — ${alarms.length} alarm(s) triggered`;

  await deliverAlarmEmailRaw(htmlBody, subject, config);
}

async function deliverDeckAlarmEmail(
  deckTitle: string,
  allFired: Array<{ reportName: string; result: AlarmResult }>,
  config: { to: string[]; subject: string; provider: string },
): Promise<void> {
  const htmlBody = buildDeckAlarmEmailHtml(deckTitle, allFired);
  const subject = `[ALARM] ${deckTitle} — ${allFired.length} alarm(s) triggered`;

  await deliverAlarmEmailRaw(htmlBody, subject, config);
}

async function deliverAlarmEmailRaw(
  htmlBody: string,
  subject: string,
  config: { to: string[]; subject: string; provider: string },
): Promise<void> {
  const { sendAlarmEmail } = await import('./deliver-email');
  await sendAlarmEmail(htmlBody, subject, config);
}

function buildAlarmEmailHtml(reportName: string, alarms: AlarmResult[]): string {
  const dateStr = new Date().toISOString().split('T')[0];
  const rows = alarms.map(a => {
    const color = a.alarm.severity === 'critical' ? '#dc3545' : '#fd7e14';
    return `<tr>
      <td style="padding: 8px; border-bottom: 1px solid #eee;"><span style="color: ${color}; font-weight: bold;">${a.alarm.severity.toUpperCase()}</span></td>
      <td style="padding: 8px; border-bottom: 1px solid #eee; font-weight: bold;">${a.alarm.name}</td>
      <td style="padding: 8px; border-bottom: 1px solid #eee;">${a.reason}</td>
    </tr>`;
  }).join('\n');

  return `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px;">
      <div style="background: #dc3545; color: white; padding: 16px; border-radius: 6px 6px 0 0;">
        <h2 style="margin: 0;">\u26a0\ufe0f Alarm: ${reportName}</h2>
        <p style="margin: 4px 0 0; opacity: 0.9;">${dateStr}</p>
      </div>
      <table style="width: 100%; border-collapse: collapse; border: 1px solid #ddd; border-top: none;">
        <thead>
          <tr style="background: #f8f9fa;">
            <th style="padding: 8px; text-align: left; border-bottom: 2px solid #ddd;">Severity</th>
            <th style="padding: 8px; text-align: left; border-bottom: 2px solid #ddd;">Alarm</th>
            <th style="padding: 8px; text-align: left; border-bottom: 2px solid #ddd;">Details</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
}

function buildDeckAlarmEmailHtml(
  deckTitle: string,
  allFired: Array<{ reportName: string; result: AlarmResult }>,
): string {
  const dateStr = new Date().toISOString().split('T')[0];
  const rows = allFired.map(({ reportName, result }) => {
    const color = result.alarm.severity === 'critical' ? '#dc3545' : '#fd7e14';
    return `<tr>
      <td style="padding: 8px; border-bottom: 1px solid #eee;">${reportName}</td>
      <td style="padding: 8px; border-bottom: 1px solid #eee;"><span style="color: ${color}; font-weight: bold;">${result.alarm.severity.toUpperCase()}</span></td>
      <td style="padding: 8px; border-bottom: 1px solid #eee; font-weight: bold;">${result.alarm.name}</td>
      <td style="padding: 8px; border-bottom: 1px solid #eee;">${result.reason}</td>
    </tr>`;
  }).join('\n');

  return `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 700px;">
      <div style="background: #dc3545; color: white; padding: 16px; border-radius: 6px 6px 0 0;">
        <h2 style="margin: 0;">\u26a0\ufe0f Alarm: ${deckTitle}</h2>
        <p style="margin: 4px 0 0; opacity: 0.9;">${dateStr} \u2014 ${allFired.length} alarm(s) across reports</p>
      </div>
      <table style="width: 100%; border-collapse: collapse; border: 1px solid #ddd; border-top: none;">
        <thead>
          <tr style="background: #f8f9fa;">
            <th style="padding: 8px; text-align: left; border-bottom: 2px solid #ddd;">Report</th>
            <th style="padding: 8px; text-align: left; border-bottom: 2px solid #ddd;">Severity</th>
            <th style="padding: 8px; text-align: left; border-bottom: 2px solid #ddd;">Alarm</th>
            <th style="padding: 8px; text-align: left; border-bottom: 2px solid #ddd;">Details</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
}
