import crypto from "crypto";
import { SignJWT, jwtVerify } from "jose";

const SCRYPT_KEYLEN = 64;
const SCRYPT_OPTIONS: crypto.ScryptOptions = {
  cost: 16384,
  blockSize: 8,
  parallelization: 1,
};

export async function hashPassword(plainText: string): Promise<string> {
  const salt = crypto.randomBytes(16).toString("hex");
  return new Promise((resolve, reject) => {
    crypto.scrypt(plainText, salt, SCRYPT_KEYLEN, SCRYPT_OPTIONS, (err, derivedKey) => {
      if (err) return reject(err);
      resolve(`${salt}:${derivedKey.toString("hex")}`);
    });
  });
}

export async function verifyPassword(plainText: string, storedHash: string): Promise<boolean> {
  const [salt, keyHex] = storedHash.split(":");
  if (!salt || !keyHex) return false;

  return new Promise((resolve) => {
    crypto.scrypt(plainText, salt, SCRYPT_KEYLEN, SCRYPT_OPTIONS, (err, derivedKey) => {
      if (err) return resolve(false);
      const keyBuffer = Buffer.from(keyHex, "hex");
      if (keyBuffer.length !== derivedKey.length) return resolve(false);
      try {
        resolve(crypto.timingSafeEqual(keyBuffer, derivedKey));
      } catch {
        resolve(false);
      }
    });
  });
}

export async function createAdminToken(secretString: string): Promise<string> {
  const secretKey = new TextEncoder().encode(secretString);
  return new SignJWT({ role: "admin" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("12h")
    .sign(secretKey);
}

export async function verifyAdminToken(token: string, secretString: string): Promise<boolean> {
  try {
    const secretKey = new TextEncoder().encode(secretString);
    const { payload } = await jwtVerify(token, secretKey, {
      algorithms: ["HS256"],
    });
    return payload.role === "admin";
  } catch {
    return false;
  }
}
