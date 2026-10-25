import { useQueries, useQuery } from "@tanstack/react-query";
import type {
  ThreadAccessResponse,
  ThreadParticipantRole,
} from "@bb/server-contract";
import { sdk } from "@/lib/sdk";

export function canManageThreadSharing(
  role: ThreadParticipantRole | null | undefined,
): boolean {
  return role === null || role === "owner" || role === "maintainer";
}

export function threadAccessQueryKey(threadId: string) {
  return ["thread-access", threadId] as const;
}

function threadAccessQueryOptions(threadId: string) {
  return {
    queryKey: threadAccessQueryKey(threadId),
    queryFn: () => sdk.threads.access.get({ threadId }),
    retry: false,
    staleTime: 10_000,
  };
}

export function useThreadAccess(threadId: string) {
  return useQuery<ThreadAccessResponse>(threadAccessQueryOptions(threadId));
}

export function useThreadAccessRoles(threadIds: readonly string[]) {
  const queries = useQueries({
    queries: threadIds.map(threadAccessQueryOptions),
  });
  return new Map<string, ThreadParticipantRole | null | undefined>(
    threadIds.map((threadId, index) => [
      threadId,
      queries[index]?.data?.currentRole,
    ]),
  );
}
