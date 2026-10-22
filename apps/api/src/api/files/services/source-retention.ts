import { ConflictException } from "@nestjs/common";
import { Prisma } from "@prisma/client";

/** Shared with attempt binding; hashing only chooses a lock, never authorizes access. */
export async function lockSourceObject(
  tx: Prisma.TransactionClient,
  bucket: string,
  storageKey: string,
): Promise<void> {
  const identity = JSON.stringify([bucket, storageKey]);
  await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtextextended(${identity}, 0))`;
}

/** Reserve all keys atomically before storage I/O. Keep reservations after failures:
 * an interrupted object-store request may have deleted the original already.
 */
export async function reserveSourceObjectDeletion(
  tx: Prisma.TransactionClient,
  bucket: string,
  keys: string[],
): Promise<void> {
  for (const storageKey of [...new Set(keys)].sort()) {
    await lockSourceObject(tx, bucket, storageKey);
    const bound = await tx.attemptSource.findFirst({
      where: { bucket, storageKey },
      select: { id: true },
    });
    if (bound)
      throw new ConflictException(
        "This original is retained for an assignment attempt.",
      );
    await tx.sourceObjectDeletion.upsert({
      where: { bucket_storageKey: { bucket, storageKey } },
      create: { bucket, storageKey },
      update: {},
    });
  }
}
