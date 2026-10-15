import { describe, expect, it } from "vitest";
import express from "express";
import request from "supertest";
import { clientIp, isPrivateAddress, trustImmediatePrivateProxy } from "./client-ip.js";

describe("isPrivateAddress", () => {
  it.each(["127.0.0.1", "10.1.2.3", "172.18.0.5", "192.168.1.6", "::1", "::ffff:172.18.0.5", "fd00::1"])(
    "%s es de la red propia",
    (address) => {
      expect(isPrivateAddress(address)).toBe(true);
    },
  );

  it.each(["8.8.8.8", "172.32.0.1", "190.64.10.20", "2606:4700::1", "no-es-ip", ""])("%s no lo es", (address) => {
    expect(isPrivateAddress(address)).toBe(false);
  });
});

describe("trustImmediatePrivateProxy", () => {
  it("confía sólo en el primer salto y sólo si es privado", () => {
    expect(trustImmediatePrivateProxy("172.18.0.5", 0)).toBe(true);
    expect(trustImmediatePrivateProxy("190.64.10.20", 0)).toBe(false);
    // Un segundo salto privado escrito por el cliente no extiende la confianza.
    expect(trustImmediatePrivateProxy("10.0.0.1", 1)).toBe(false);
  });
});

describe("clientIp detrás de Express", () => {
  function app() {
    const a = express();
    a.set("trust proxy", trustImmediatePrivateProxy);
    a.get("/ip", (req, res) => res.json({ ip: clientIp(req) }));
    return a;
  }

  it("toma el valor que agrega el proxy, no el que manda el cliente a la izquierda", async () => {
    // Supertest conecta por loopback, que hace de nginx: el último valor es el que agregó el proxy.
    const res = await request(app()).get("/ip").set("X-Forwarded-For", "1.2.3.4, 190.64.10.20");
    expect(res.body.ip).toBe("190.64.10.20");
  });

  it("sin cabecera usa la dirección de la conexión", async () => {
    const res = await request(app()).get("/ip");
    expect(res.body.ip).toMatch(/^(127\.0\.0\.1|::1)$/);
  });

  it("limpia el prefijo IPv4-mapped y devuelve undefined sin IP", () => {
    expect(clientIp({ ip: "::ffff:10.0.0.1" })).toBe("10.0.0.1");
    expect(clientIp({ ip: undefined })).toBeUndefined();
  });
});
