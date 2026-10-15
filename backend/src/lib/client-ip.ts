import { BlockList, isIP } from "node:net";

/** Loopback, redes privadas y link-local: donde viven nginx y la red de Docker, nunca un cliente de internet. */
const privateNetworks = new BlockList();
privateNetworks.addSubnet("127.0.0.0", 8, "ipv4");
privateNetworks.addSubnet("10.0.0.0", 8, "ipv4");
privateNetworks.addSubnet("172.16.0.0", 12, "ipv4");
privateNetworks.addSubnet("192.168.0.0", 16, "ipv4");
privateNetworks.addSubnet("169.254.0.0", 16, "ipv4");
privateNetworks.addAddress("::1", "ipv6");
privateNetworks.addSubnet("fc00::", 7, "ipv6");
privateNetworks.addSubnet("fe80::", 10, "ipv6");

function stripIpv4Mapped(address: string): string {
  return address.replace(/^::ffff:/i, "");
}

export function isPrivateAddress(address: string): boolean {
  const ip = stripIpv4Mapped(address.trim());
  const family = isIP(ip);
  if (!family) return false;
  return privateNetworks.check(ip, family === 4 ? "ipv4" : "ipv6");
}

/**
 * `trust proxy` de Express: se cree en el `X-Forwarded-For` sólo si quien conecta es el proxy
 * propio (una dirección privada: nginx en la red de Docker) y sólo un salto.
 *
 * Así `req.ip` es el último valor de la cabecera, el que agrega nginx con la IP real (restaurada
 * de `CF-Connecting-IP`). Un cliente que se conecta directo al puerto de la API no puede dictar su
 * IP, y los valores que mande en la cabecera quedan a la izquierda y se ignoran.
 */
export function trustImmediatePrivateProxy(address: string, hop: number): boolean {
  return hop === 0 && isPrivateAddress(address);
}

/**
 * IP del cliente para auditoría, rate limit y listas de IPs permitidas.
 *
 * Sale siempre de `req.ip`. Nunca leer el primer valor de `X-Forwarded-For` a mano: lo escribe el
 * cliente, y con eso se falsificaba la IP de la auditoría, se evadía el rate limit y se pasaba la
 * lista de IPs de los lectores biométricos.
 */
export function clientIp(req: { ip?: string | undefined }): string | undefined {
  if (!req.ip) return undefined;
  return stripIpv4Mapped(String(req.ip)).slice(0, 45);
}
