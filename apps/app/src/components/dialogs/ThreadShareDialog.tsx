import { useEffect, useState } from "react";
import type {
  ThreadAccessResponse,
  ThreadInviteRole,
  ThreadParticipantRole,
} from "@bb/server-contract";
import { Button } from "@bb/shared-ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@bb/shared-ui/dialog";
import { Input } from "@bb/shared-ui/input";
import { sdk } from "@/lib/sdk";
import { getMutationErrorMessage } from "@/lib/mutation-errors";
import { appToast } from "@/components/ui/app-toast";

export interface ThreadShareDialogTarget {
  id: string;
  title: string;
}

export function ThreadShareDialog({
  target,
  onOpenChange,
}: {
  target: ThreadShareDialogTarget | null;
  onOpenChange: (open: boolean) => void;
}) {
  const [access, setAccess] = useState<ThreadAccessResponse | null>(null);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<ThreadInviteRole>("member");
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = async (threadId: string) => {
    setAccess(await sdk.threads.access.get({ threadId }));
  };

  useEffect(() => {
    setAccess(null);
    setEmail("");
    setInviteUrl(null);
    setError(null);
    if (target === null) return;
    void refresh(target.id).catch((loadError: unknown) => {
      setError(
        getMutationErrorMessage({
          error: loadError,
          fallbackMessage: "Couldn't load thread access.",
        }),
      );
    });
  }, [target]);

  const run = async (operation: () => Promise<void>) => {
    setPending(true);
    setError(null);
    try {
      await operation();
    } catch (operationError) {
      setError(
        getMutationErrorMessage({
          error: operationError,
          fallbackMessage: "Couldn't update thread access.",
        }),
      );
    } finally {
      setPending(false);
    }
  };

  return (
    <Dialog open={target !== null} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] max-w-[36rem] overflow-y-auto">
        {target === null ? null : (
          <div className="grid gap-5">
            <DialogHeader>
              <DialogTitle>Share thread</DialogTitle>
              <DialogDescription>
                Assign an Authentik user or create a single-use invitation for{" "}
                {target.title}.
              </DialogDescription>
            </DialogHeader>

            <div className="grid gap-2 sm:grid-cols-[1fr_9rem]">
              <Input
                aria-label="Email address"
                placeholder="person@example.com"
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
              <select
                aria-label="Role"
                className="h-9 rounded-md border border-input bg-background px-3 text-sm"
                value={role}
                onChange={(event) =>
                  setRole(event.target.value as ThreadInviteRole)
                }
              >
                <option value="maintainer">Maintainer</option>
                <option value="member">Member</option>
                <option value="viewer">Viewer</option>
              </select>
              <Button
                type="button"
                variant="outline"
                disabled={pending || email.trim() === ""}
                onClick={() =>
                  void run(async () => {
                    await sdk.threads.access.addParticipant({
                      email: email.trim(),
                      role,
                      threadId: target.id,
                    });
                    setEmail("");
                    await refresh(target.id);
                  })
                }
              >
                Add existing user
              </Button>
              <Button
                type="button"
                disabled={pending}
                onClick={() =>
                  void run(async () => {
                    const created = await sdk.threads.access.createInvite({
                      email: email.trim() === "" ? null : email.trim(),
                      expiresInHours: 24,
                      role,
                      threadId: target.id,
                    });
                    setInviteUrl(created.url);
                    await refresh(target.id);
                  })
                }
              >
                Create invite
              </Button>
            </div>

            {inviteUrl === null ? null : (
              <div className="grid gap-2">
                <p className="text-sm font-medium">Invitation link</p>
                <div className="flex gap-2">
                  <Input
                    readOnly
                    value={inviteUrl}
                    aria-label="Invitation link"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() =>
                      void navigator.clipboard.writeText(inviteUrl).then(
                        () => appToast.success("Invitation link copied"),
                        () => appToast.error("Couldn't copy invitation link"),
                      )
                    }
                  >
                    Copy
                  </Button>
                </div>
              </div>
            )}

            {error === null ? null : (
              <p className="text-sm text-destructive" role="alert">
                {error}
              </p>
            )}

            <div className="grid gap-2">
              <p className="text-sm font-medium">People with access</p>
              {access === null ? (
                <p className="text-sm text-muted-foreground">Loading…</p>
              ) : (
                access.participants.map((participant) => (
                  <div
                    key={participant.userId}
                    className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2"
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-sm">
                        {participant.name}
                      </span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {participant.email}
                      </span>
                    </span>
                    {access.currentRole === "owner" ? (
                      <span className="flex items-center gap-2">
                        <select
                          aria-label={`Role for ${participant.email}`}
                          className="h-8 rounded-md border border-input bg-background px-2 text-xs capitalize"
                          disabled={pending}
                          value={participant.role}
                          onChange={(event) =>
                            void run(async () => {
                              await sdk.threads.access.updateParticipant({
                                role: event.target
                                  .value as ThreadParticipantRole,
                                threadId: target.id,
                                userId: participant.userId,
                              });
                              await refresh(target.id);
                            })
                          }
                        >
                          <option value="owner">Owner</option>
                          <option value="maintainer">Maintainer</option>
                          <option value="member">Member</option>
                          <option value="viewer">Viewer</option>
                        </select>
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          disabled={pending}
                          onClick={() =>
                            void run(async () => {
                              await sdk.threads.access.removeParticipant({
                                threadId: target.id,
                                userId: participant.userId,
                              });
                              await refresh(target.id);
                            })
                          }
                        >
                          Remove
                        </Button>
                      </span>
                    ) : (
                      <span className="text-xs capitalize text-muted-foreground">
                        {participant.role}
                      </span>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
