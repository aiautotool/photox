export type MediaProviderOperationGate = {
  run<T>(workspaceId: string, key: string, operation: () => Promise<T>): Promise<T>;
  pending(workspaceId: string, key: string): number;
};

function identity(workspaceId: string, key: string) {
  return `${workspaceId}\u0000${key}`;
}

/**
 * Serializes provider-side operations for one exact workspace + media identity.
 * Different media identities remain independent, while upload/delete/repair work
 * for the same asset cannot overlap and create remote orphans.
 */
export function createMediaProviderOperationGate(): MediaProviderOperationGate {
  const tails = new Map<string, Promise<void>>();
  const counts = new Map<string, number>();

  return {
    async run<T>(workspaceId: string, key: string, operation: () => Promise<T>): Promise<T> {
      const id = identity(workspaceId, key);
      const previous = tails.get(id) ?? Promise.resolve();
      counts.set(id, (counts.get(id) ?? 0) + 1);

      let release!: () => void;
      const turn = new Promise<void>(resolve => { release = resolve; });
      const tail = previous.catch(() => undefined).then(() => turn);
      tails.set(id, tail);

      await previous.catch(() => undefined);
      try {
        return await operation();
      } finally {
        release();
        const nextCount = (counts.get(id) ?? 1) - 1;
        if (nextCount <= 0) counts.delete(id);
        else counts.set(id, nextCount);
        if (tails.get(id) === tail) {
          await tail;
          if (tails.get(id) === tail) tails.delete(id);
        }
      }
    },
    pending(workspaceId: string, key: string): number {
      return counts.get(identity(workspaceId, key)) ?? 0;
    },
  };
}
