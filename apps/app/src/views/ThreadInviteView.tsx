import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import type { ThreadInvitePreview } from "@bb/server-contract";
import { Button } from "@bb/shared-ui/button";
import { sdk } from "@/lib/sdk";
import { getThreadRoutePath } from "@/lib/route-paths";
import { getMutationErrorMessage } from "@/lib/mutation-errors";

export function ThreadInviteView() {
  const { token } = useParams<{ token: string }>();
  const navigate = useNavigate();
  const [preview, setPreview] = useState<ThreadInvitePreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (!token) return;
    void sdk.threads.access
      .previewInvite({ token })
      .then(setPreview)
      .catch((loadError: unknown) =>
        setError(
          getMutationErrorMessage({
            error: loadError,
            fallbackMessage: "This invitation is invalid or expired.",
          }),
        ),
      );
  }, [token]);

  const accept = async () => {
    if (!token) return;
    setPending(true);
    setError(null);
    try {
      const participant = await sdk.threads.access.acceptInvite({ token });
      const thread = await sdk.threads.get({ threadId: participant.threadId });
      navigate(
        getThreadRoutePath({
          projectId: thread.projectId,
          threadId: thread.id,
        }),
        { replace: true },
      );
    } catch (acceptError) {
      setError(
        getMutationErrorMessage({
          error: acceptError,
          fallbackMessage: "Couldn't accept this invitation.",
        }),
      );
      setPending(false);
    }
  };

  return (
    <main className="grid min-h-dvh place-items-center bg-background p-6">
      <section className="grid w-full max-w-md gap-4 rounded-lg border border-border bg-card p-6 shadow-sm">
        <div className="grid gap-1">
          <h1 className="text-lg font-semibold">Join shared thread</h1>
          {preview === null ? null : (
            <p className="text-sm text-muted-foreground">
              You'll join as {preview.role}.
              {preview.email === null
                ? ""
                : ` This invite is for ${preview.email}.`}
            </p>
          )}
        </div>
        {error === null ? null : (
          <p className="text-sm text-destructive" role="alert">
            {error}
          </p>
        )}
        <Button
          type="button"
          disabled={preview === null || pending || token === undefined}
          onClick={() => void accept()}
        >
          {pending ? "Joining…" : "Accept invitation"}
        </Button>
      </section>
    </main>
  );
}
