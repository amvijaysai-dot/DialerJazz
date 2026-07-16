const http = require('http');

// Create a valid JWT-like token for testing
// The auth middleware uses jwt.decode() which doesn't verify signature
// Format: header.payload.signature (base64url encoded)
const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString('base64url');
const payload = Buffer.from(JSON.stringify({ sub: "f58393a2-f9f2-41ea-889b-0aadc21f382f", email: "test@example.com", role: "user" })).toString('base64url');
const signature = "fake";
const testToken = `${header}.${payload}.${signature}`;

console.log('Test token:', testToken);

const data = JSON.stringify({ name: "Test Campaign" });

const options = {
  hostname: 'localhost',
  port: 3001,
  path: '/api/campaigns',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(data),
    'Authorization': `Bearer ${testToken}`
  }
};

const req = http.request(options, (res) => {
  let body = '';
  res.on('data', (chunk) => { body += chunk; });
  res.on('end', () => {
    console.log('Status:', res.statusCode);
    console.log('Response:', body);
  });
});

req.on('error', (e) => {
  console.error('Error:', e.message);
});

req.write(data);
req.end();