// Cifrado de secretos con safeStorage (DPAPI de Windows, ligado al usuario). Implementa el `cipher`
// que usa ConfigStore.
const { safeStorage } = require('electron');

const safeStorageCipher = {
  available: () => safeStorage.isEncryptionAvailable(),
  encrypt: (text) => safeStorage.encryptString(text).toString('base64'),
  decrypt: (b64) => safeStorage.decryptString(Buffer.from(b64, 'base64')),
};

module.exports = { safeStorageCipher };
