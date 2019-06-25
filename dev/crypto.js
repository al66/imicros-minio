"use strict";

const crypto = require("crypto");

//const mySecret = "a3367e92ed5bc2fe0b236dab6c250c47";    // for iv must be 32 bytes!
const mySecret = crypto.createHash("SHA256")              // for iv must be 32 bytes!
.update("a3367e92ed5bc2fe0")
.digest();
//.slice(0,32);    // for iv must be 32 bytes!
console.log(mySecret.length);
const iv = crypto.randomBytes(16);

//const myKey = crypto.pbkdf2Sync(mySecret, mySalt, 100000, 32, "md5");

const cipher = crypto.createCipher("aes-256-cbc", mySecret);
let encrypted = cipher.update("Hier kommt der Text", "utf8", "hex");
encrypted += cipher.final("hex");
console.log("encrypted:", encrypted);
const decipher = crypto.createDecipher("aes-256-cbc", mySecret);
let decrypted = decipher.update(encrypted, "hex", "utf8");
decrypted += decipher.final("utf8");
console.log("decrypted:", decrypted);


//const cipheriv = crypto.createCipheriv("aes-256-cbc", myKey, mySalt);
const cipheriv = crypto.createCipheriv("aes-256-cbc", mySecret, iv);
let encryptediv = cipheriv.update("Hier kommt der Text", "utf8", "hex");
encryptediv += cipheriv.final("hex");
console.log("encryptediv:", encryptediv);
const decipheriv = crypto.createDecipheriv("aes-256-cbc", mySecret, iv);
let decryptediv = decipheriv.update(encryptediv, "hex", "utf8");
decryptediv += decipheriv.final("utf8");
console.log("decryptediv:", decryptediv);
