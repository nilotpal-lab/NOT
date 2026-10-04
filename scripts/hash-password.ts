import crypto from "crypto";
import readline from "readline";

const SCRYPT_KEYLEN = 64;
const SCRYPT_OPTIONS: crypto.ScryptOptions = {
  cost: 16384,
  blockSize: 8,
  parallelization: 1,
};

async function hashPassword(plainText: string): Promise<string> {
  const salt = crypto.randomBytes(16).toString("hex");
  return new Promise((resolve, reject) => {
    crypto.scrypt(plainText, salt, SCRYPT_KEYLEN, SCRYPT_OPTIONS, (err, derivedKey) => {
      if (err) return reject(err);
      resolve(`${salt}:${derivedKey.toString("hex")}`);
    });
  });
}

async function main() {
  const argPassword = process.argv[2];

  let password = argPassword;
  if (!password) {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    password = await new Promise<string>((resolve) => {
      rl.question("Enter admin password to hash: ", (answer) => {
        rl.close();
        resolve(answer.trim());
      });
    });
  }

  if (!password) {
    console.error("Error: Password cannot be empty.");
    process.exit(1);
  }

  const hash = await hashPassword(password);
  const sessionSecret = crypto.randomBytes(32).toString("hex");

  console.log("\n=======================================================");
  console.log("Admin Credentials Generated Successfully");
  console.log("=======================================================\n");
  console.log("Paste these two lines into your .env.local file:\n");
  console.log(`ADMIN_PASSWORD_HASH=${hash}`);
  console.log(`SESSION_SECRET=${sessionSecret}\n`);
  console.log("Keep your plain password safe in your notepad. You will use it to log in.");
  console.log("=======================================================\n");
}

main().catch((err) => {
  console.error("Failed to hash password:", err);
  process.exit(1);
});
