import { Client } from 'ssh2';

const conn = new Client();

const config = {
  host: '217.114.8.131',
  port: 22,
  username: 'root',
  password: 'y&c5PuKZHVKE'
};

conn.on('ready', () => {
  console.log('SSH connection established for debugging.');
  
  // Show PM2 status and database contents
  conn.exec('curl -s http://localhost:3000/api/devices && echo "" && echo "=== PROXIES ===" && curl -s http://localhost:3000/api/proxies', (err, stream) => {
    if (err) throw err;
    stream.on('close', (code) => {
      conn.end();
    }).on('data', (data: Buffer) => {
      process.stdout.write(data);
    }).stderr.on('data', (data: Buffer) => {
      process.stderr.write(data);
    });
  });
}).connect(config);
