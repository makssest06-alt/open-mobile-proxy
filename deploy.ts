import { Client } from 'ssh2';
import * as fs from 'fs';
import * as path from 'path';
import dotenv from 'dotenv';

dotenv.config();

const conn = new Client();

const config = {
  host: process.env.VPS_HOST || '217.114.8.131',
  port: Number(process.env.VPS_PORT) || 22,
  username: process.env.VPS_USER || 'root',
  password: process.env.VPS_PASS || (() => { throw new Error('VPS_PASS environment variable is required'); })(),
  readyTimeout: 30000
};

const REMOTE_DIR = '/root/open-mobile-proxy';

function executeCommand(command: string): Promise<string> {
  return new Promise((resolve, reject) => {
    conn.exec(command, (err, stream) => {
      if (err) return reject(err);
      let output = '';
      let errorOutput = '';
      stream.on('close', (code) => {
        if (code === 0) {
          resolve(output);
        } else {
          reject(new Error(`Command "${command}" failed with code ${code}. Error: ${errorOutput}`));
        }
      }).on('data', (data: Buffer) => {
        output += data.toString();
        console.log(data.toString().trim());
      }).stderr.on('data', (data: Buffer) => {
        errorOutput += data.toString();
        console.error(data.toString().trim());
      });
    });
  });
}

function uploadFile(sftp: any, localPath: string, remotePath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    sftp.fastPut(localPath, remotePath, (err: any) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

function makeRemoteDir(sftp: any, remotePath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    sftp.mkdir(remotePath, (err: any) => {
      // Ignore if directory already exists
      resolve();
    });
  });
}

async function uploadDir(sftp: any, localDir: string, remoteDir: string) {
  await makeRemoteDir(sftp, remoteDir);
  const entries = fs.readdirSync(localDir, { withFileTypes: true });

  for (const entry of entries) {
    const localPath = path.join(localDir, entry.name);
    // Use forward slashes for Linux paths
    const remotePath = `${remoteDir}/${entry.name}`;

    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === 'dist' || entry.name === 'drizzle') {
        continue;
      }
      await uploadDir(sftp, localPath, remotePath);
    } else {
      if (entry.name === 'sqlite.db' || entry.name === 'deploy.ts' || entry.name === 'drizzle.config.ts.timestamp' || entry.name.endsWith('.log')) {
        continue;
      }
      console.log(`Uploading ${localPath} -> ${remotePath}`);
      await uploadFile(sftp, localPath, remotePath);
    }
  }
}

conn.on('ready', () => {
  console.log('SSH connection established successfully.');
  
  conn.sftp(async (err, sftp) => {
    if (err) {
      console.error('SFTP error:', err);
      conn.end();
      return;
    }

    try {
      // Skip redundant apt and npm installs (already installed)
      // await executeCommand('apt-get update -y');
      // await executeCommand('apt-get install -y build-essential python3');
      // await executeCommand('which node || (curl -fsSL https://deb.nodesource.com/setup_20.x | bash - && apt-get install -y nodejs)');
      // await executeCommand('node -v && npm -v');
      // await executeCommand('npm install -g pm2');

      console.log('Exposing ports in firewall...');
      // Expose dashboard (3000) and proxy range (10000 to 60000)
      await executeCommand('ufw allow 3000/tcp || true');
      await executeCommand('ufw allow 10000:60000/tcp || true');
      // Or if iptables is used:
      await executeCommand('iptables -I INPUT -p tcp --dport 3000 -j ACCEPT || true');
      await executeCommand('iptables -I INPUT -p tcp --dport 10000:60000 -j ACCEPT || true');

      console.log(`Creating remote directory: ${REMOTE_DIR}`);
      await executeCommand(`mkdir -p ${REMOTE_DIR}`);

      console.log('Uploading project files...');
      const localProjectDir = process.cwd();
      await uploadDir(sftp, localProjectDir, REMOTE_DIR);

      console.log('Installing dependencies on remote VPS...');
      await executeCommand(`cd ${REMOTE_DIR} && npm install`);

      console.log('Building production React frontend on remote VPS...');
      await executeCommand(`cd ${REMOTE_DIR} && npm run build`);

      console.log('Running Drizzle DB schema push on remote VPS...');
      await executeCommand(`cd ${REMOTE_DIR} && npx drizzle-kit push`);

      console.log('Starting application under PM2 on remote VPS...');
      // Stop existing if any
      await executeCommand(`pm2 delete open-mobile-proxy || true`);
      // Start server using node via pm2
      await executeCommand(`cd ${REMOTE_DIR} && pm2 start --name "open-mobile-proxy" "node dist/server.cjs"`);
      await executeCommand('pm2 save');

      console.log('DEPLOYMENT COMPLETED SUCCESSFULLY!');
      console.log('You can access the dashboard at http://217.114.8.131:3000');
    } catch (e) {
      console.error('Deployment failed:', e);
    } finally {
      conn.end();
    }
  });
}).connect(config);
