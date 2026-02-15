const { execSync, spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

function getGitCommit() {
    try {
        return execSync('git rev-parse HEAD', { encoding: 'utf8' }).trim();
    } catch (error) {
        console.warn('Warning: unable to read git commit hash.');
        return '';
    }
}

function getBuildTime() {
    return new Date().toISOString();
}

function runDeploy(preview) {
    const buildTime = getBuildTime();
    const gitCommit = getGitCommit();
    const args = [
        'deploy',
        '--var', `BUILD_TIME:${buildTime}`,
        '--var', `GIT_COMMIT:${gitCommit}`
    ];

    if (preview) {
        args.push('--env', 'preview');
    }

    const result = spawnSync('wrangler', args, { stdio: 'inherit', shell: true });
    if (result.status !== 0) {
        process.exit(result.status ?? 1);
    }
}

const preview = process.argv.includes('--preview');
runDeploy(preview);
