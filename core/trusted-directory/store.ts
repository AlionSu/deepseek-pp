import { createChromeStorageSlot, createVersionedRepository } from '../persistence/versioned-repository';
import { trustedDirectoryCodec } from './codec';
import type { TrustedDirectoryMeta } from './types';

export const TRUSTED_DIRECTORY_STORAGE_KEY = 'deepseek_pp_trusted_directory';

const trustedDirectoryRepository = createVersionedRepository<TrustedDirectoryMeta | null>({
  label: 'trustedDirectory',
  createDefault: () => null,
  codec: trustedDirectoryCodec,
  storage: createChromeStorageSlot(TRUSTED_DIRECTORY_STORAGE_KEY),
});

/**
 * Returns the persisted summary of the most recent authorization, or null
 * when no directory has ever been authorized. A present summary does NOT mean
 * File handles are available: the @ panel additionally requires the live
 * sidepanel session.
 */
export async function getTrustedDirectoryMeta(): Promise<TrustedDirectoryMeta | null> {
  return trustedDirectoryRepository.read();
}

export async function saveTrustedDirectoryMeta(meta: TrustedDirectoryMeta): Promise<void> {
  await trustedDirectoryRepository.writeAfterReadAlreadyLocked(meta);
}

export async function clearTrustedDirectoryMeta(): Promise<void> {
  await trustedDirectoryRepository.replaceAlreadyLocked(null);
}
