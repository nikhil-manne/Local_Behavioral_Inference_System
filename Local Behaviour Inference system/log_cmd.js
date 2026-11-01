import http from 'http';

const args = process.argv.slice(2);
if (args.length === 0) process.exit(0);

const command = args.join(' ');
const payload = JSON.stringify({
  event_type: 'terminal_command',
  command: command,
  app: 'terminal',
  metadata: { source: 'wmi_cmd' }
});

const req = http.request({
  hostname: 'localhost',
  port: 5050,
  path: '/api/cognitive/event',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(payload)
  }
}, (res) => {
  process.exit(0);
});

req.on('error', () => {
  process.exit(0);
});

req.write(payload);
req.end();
