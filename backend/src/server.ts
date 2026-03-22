import app from "./app.js";

// Definimos el puerto (4000 por defecto para el backend)
const port = Number(process.env.PORT || 4000);

/**
 * En producción, el backend corre en HTTP. 
 * El certificado SSL (HTTPS) lo gestiona Cloudflare o un Proxy externo.
 * Esto evita conflictos de certificados y errores de CORS en el 'preflight'.
 */
app.listen(port, () => {
  console.log(`🚀 Auth-service corriendo en HTTP (puerto ${port})`);
});