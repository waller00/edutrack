import fs from "node:fs";
import https from "node:https";
import path from "node:path";
import app from "./app.js";

const port = Number(process.env.PORT || 4000);
const sslDir = process.env.SSL_CERT_DIR ?? "/etc/ssl/cloudflare";
const keyPath = path.join(sslDir, "key.pem");
const certPath = path.join(sslDir, "cert.pem");

const tlsFilesPresent =
  fs.existsSync(keyPath) &&
  fs.existsSync(certPath) &&
  fs.statSync(keyPath).size > 0 &&
  fs.statSync(certPath).size > 0;

if (tlsFilesPresent) {
  const httpsOptions = {
    key: fs.readFileSync(keyPath),
    cert: fs.readFileSync(certPath),
  };
  https.createServer(httpsOptions, app).listen(port, () => {
    console.log(`Auth-service en https (puerto ${port})`);
  });
} else {
  app.listen(port, () => {
    console.log(`Auth-service en http://localhost:${port}`);
  });
}
