import fs from 'node:fs';
import path from 'node:path';
import { safeStorage } from 'electron';
import { writeFileAtomic } from './atomic-file';

const CREDENTIAL_FILE = 'credentials.bin';

// Passwords are encrypted with the OS keychain (DPAPI on Windows) and never sent to the renderer
export class CredentialStore {
  constructor(private readonly providersDir: string) {}

  public savePassword(providerId: string, password: string): void {
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error('OS encryption is unavailable, refusing to store the password in plain text.');
    }
    const dir = path.join(this.providersDir, providerId);
    // A torn write would lose the password for good, so it is replaced in one step
    writeFileAtomic(path.join(dir, CREDENTIAL_FILE), safeStorage.encryptString(password), { backup: false });
  }

  public getPassword(providerId: string): string {
    const file = path.join(this.providersDir, providerId, CREDENTIAL_FILE);
    if (!fs.existsSync(file)) {
      throw new Error('No saved password for this account. Remove it and add it again.');
    }
    return safeStorage.decryptString(fs.readFileSync(file));
  }
}
