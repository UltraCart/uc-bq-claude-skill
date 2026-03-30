import { Command } from 'commander';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const SKILL_NAME = 'uc-bq';
const SKILL_FILENAME = 'SKILL.md';

function getSkillSource(): string {
  return path.resolve(__dirname, '..', '..', 'skill', 'skill.md');
}

function getSkillTarget(): string {
  return path.join(os.homedir(), '.claude', 'skills', SKILL_NAME, SKILL_FILENAME);
}

export const installSkillCommand = new Command('install-skill')
  .description('Install the Claude Code skill to ~/.claude/skills/')
  .option('--dry-run', 'Show what would be installed without writing anything')
  .option('--uninstall', 'Remove the installed skill')
  .action(async (options) => {
    try {
      const source = getSkillSource();
      const target = getSkillTarget();
      const targetDir = path.dirname(target);

      if (options.uninstall) {
        console.log('');
        console.log('  Uninstalling Claude Code skill');
        console.log('  ' + '─'.repeat(46));

        if (!fs.existsSync(target)) {
          console.log('  Skill is not installed.');
          console.log('');
          return;
        }

        fs.unlinkSync(target);

        // Remove the directory if empty
        try {
          fs.rmdirSync(targetDir);
        } catch {
          // Directory not empty or doesn't exist — that's fine
        }

        console.log(`  Removed: ${target}`);
        console.log('');
        console.log('  Restart Claude Code for the change to take effect.');
        console.log('');
        return;
      }

      // Verify source exists
      if (!fs.existsSync(source)) {
        console.error(`Error: Skill source not found at ${source}`);
        console.error('This may indicate a broken installation. Try reinstalling the package:');
        console.error('  npm install -g @ultracart/bq-skill');
        process.exit(1);
      }

      const sourceSize = fs.statSync(source).size;
      const sourceLines = fs.readFileSync(source, 'utf-8').split('\n').length;

      console.log('');
      console.log('  Install Claude Code Skill');
      console.log('  ' + '─'.repeat(46));
      console.log('');
      console.log(`  Source:  ${source}`);
      console.log(`  Target:  ${target}`);
      console.log(`  Size:    ${(sourceSize / 1024).toFixed(1)} KB (${sourceLines} lines)`);
      console.log('');

      if (options.dryRun) {
        console.log('  Dry run — no files written.');
        console.log('');
        console.log('  To install, run:');
        console.log('    uc-bq install-skill');
        console.log('');
        return;
      }

      // Check if already installed
      if (fs.existsSync(target)) {
        const existingContent = fs.readFileSync(target, 'utf-8');
        const newContent = fs.readFileSync(source, 'utf-8');

        if (existingContent === newContent) {
          console.log('  Skill is already installed and up to date.');
          console.log('');
          return;
        }

        console.log('  Updating existing skill installation...');
      }

      // Create directory
      fs.mkdirSync(targetDir, { recursive: true });

      // Copy skill file
      fs.copyFileSync(source, target);

      console.log('  Installed successfully.');
      console.log('');
      console.log('  Restart Claude Code for the skill to take effect.');
      console.log('  You can verify by reading: ' + target);
      console.log('');
    } catch (err: any) {
      console.error(`Error: ${err.message}`);
      process.exit(1);
    }
  });
