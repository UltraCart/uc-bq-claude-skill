import * as fs from 'fs';
import * as path from 'path';
import { ReportManifest } from './manifest';
import { deliverSlack } from './deliver-slack';
import { deliverEmail } from './deliver-email';

/**
 * Deliver a completed report via Slack and/or email based on manifest config.
 * Respects delivery mode: 'always' (default) delivers normally, 'alarm_only' skips delivery.
 * Never throws — delivery failures are logged but don't crash the run.
 */
export async function deliverReport(
  reportDir: string,
  manifest: ReportManifest,
  options?: { hasTriggeredAlarms?: boolean },
): Promise<void> {
  if (!manifest.delivery) {
    return;
  }

  // Check delivery mode
  const mode = manifest.delivery.mode || 'always';
  if (mode === 'alarm_only' && !options?.hasTriggeredAlarms) {
    console.log('  Delivery: mode is alarm_only and no alarms triggered, skipping.');
    return;
  }

  // Find the best attachment: prefer PDF, fall back to chart PNG
  const pdfPath = path.join(reportDir, 'report.pdf');
  const pngPath = path.join(reportDir, 'chart.png');
  let filePath: string;
  let fileName: string;

  if (fs.existsSync(pdfPath)) {
    filePath = pdfPath;
    fileName = 'report.pdf';
  } else if (fs.existsSync(pngPath)) {
    filePath = pngPath;
    fileName = 'chart.png';
  } else {
    console.log('  Delivery: No report.pdf or chart.png found, skipping delivery.');
    return;
  }

  // Slack delivery
  if (manifest.delivery.slack) {
    try {
      const comment = `${manifest.name} — ${new Date().toISOString().split('T')[0]}`;
      await deliverSlack(filePath, fileName, manifest.delivery.slack.channels, comment);
      console.log(`  Delivered to Slack channels: ${manifest.delivery.slack.channels.join(', ')}`);
    } catch (err: any) {
      console.error(`  Slack delivery failed: ${err.message}`);
    }
  }

  // Email delivery
  if (manifest.delivery.email) {
    try {
      await deliverEmail(filePath, fileName, manifest.delivery.email);
      console.log(`  Delivered via email (${manifest.delivery.email.provider}) to: ${manifest.delivery.email.to.join(', ')}`);
    } catch (err: any) {
      console.error(`  Email delivery failed: ${err.message}`);
    }
  }
}
