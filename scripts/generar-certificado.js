/**
 * Genera un certificado autofirmado para la red local del colegio.
 * Ejecuta:  npm run cert
 *
 * Usa el openssl que ya viene con XAMPP (C:\xampp\apache\bin\openssl.exe)
 * o el del sistema en Linux/macOS.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dirCerts = path.join(raiz, 'certs');
fs.mkdirSync(dirCerts, { recursive: true });

const candidatos =
  os.platform() === 'win32'
    ? ['C:/xampp/apache/bin/openssl.exe', 'openssl']
    : ['/usr/bin/openssl', 'openssl'];

const openssl = candidatos.find((c) => c === 'openssl' || fs.existsSync(c));

if (!openssl) {
  console.error('No se encontro openssl. Instala XAMPP o OpenSSL y vuelve a intentar.');
  process.exit(1);
}

const key = path.join(dirCerts, 'server.key');
const cert = path.join(dirCerts, 'server.crt');
const conf = path.join(dirCerts, 'openssl.cnf');

// SAN con localhost y la IP del servidor: sin esto los navegadores modernos rechazan el certificado.
const ips = Object.values(os.networkInterfaces())
  .flat()
  .filter((i) => i && i.family === 'IPv4' && !i.internal)
  .map((i) => i.address);

fs.writeFileSync(
  conf,
  `[req]
distinguished_name = dn
x509_extensions = ext
prompt = no

[dn]
C = HN
ST = Cortes
L = Choloma
O = Smart Campus IA
CN = smart-campus.local

[ext]
subjectAltName = @san
basicConstraints = CA:FALSE
keyUsage = digitalSignature, keyEncipherment
extendedKeyUsage = serverAuth

[san]
DNS.1 = localhost
DNS.2 = smart-campus.local
IP.1 = 127.0.0.1
${ips.map((ip, i) => `IP.${i + 2} = ${ip}`).join('\n')}
`
);

try {
  execFileSync(
    openssl,
    ['req', '-x509', '-nodes', '-days', '825', '-newkey', 'rsa:2048', '-keyout', key, '-out', cert, '-config', conf],
    { stdio: 'inherit' }
  );
  console.log(`\nCertificado creado:\n  ${cert}\n  ${key}`);
  console.log('\nAhora pon HTTPS_ENABLED=true en .env.');
  console.log('El navegador mostrara una advertencia la primera vez: es normal en un certificado autofirmado.');
  console.log('Para quitarla, instala server.crt como autoridad de confianza en los equipos del colegio.');
} catch (e) {
  console.error(`Fallo la generacion: ${e.message}`);
  process.exit(1);
}
