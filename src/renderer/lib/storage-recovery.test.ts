import { describe, expect, it } from 'vitest';
import { recoveryToast } from './storage-recovery';

describe('recoveryToast', () => {
  it('names the data in plain words and says the last good copy is back', () => {
    expect(recoveryToast({ file: 'messages.json', outcome: 'restored' })).toEqual({
      tone: 'info',
      title: 'Recovered a damaged file',
      description: 'Your message list was damaged, probably by a crash. The last good copy is back in place.',
    });
  });

  it('is an error when nothing could be recovered, and says what happens next', () => {
    const toast = recoveryToast({ file: 'associations.json', outcome: 'reset' });
    expect(toast.tone).toBe('error');
    expect(toast.title).toBe('Could not recover a damaged file');
    expect(toast.description).toContain('Your association tree');
    expect(toast.description).toContain('set aside');
  });

  it('tells the user the next sync refills mail that was reset', () => {
    expect(recoveryToast({ file: 'messages.json', outcome: 'reset' }).description).toContain('next sync');
  });

  it('falls back to the file name for anything it does not know', () => {
    expect(recoveryToast({ file: 'mystery.json', outcome: 'restored' }).description).toContain('mystery.json');
  });
});
