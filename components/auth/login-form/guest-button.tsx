"use client";

import { AlertCircle } from "lucide-react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";

export type GuestButtonProps = {
  guestError: string | null;
  handleGuest: () => void;
  isAnyPending: boolean;
  isGuestPending: boolean;
};

export function GuestButton({
  guestError,
  handleGuest,
  isAnyPending,
  isGuestPending,
}: GuestButtonProps) {
  return (
    <>
      {guestError && (
        <Alert variant="destructive" className="border-destructive/40 bg-destructive/10">
          <AlertCircle className="size-4" />
          <AlertDescription>{guestError}</AlertDescription>
        </Alert>
      )}

      <Button
        variant="outline"
        onClick={handleGuest}
        disabled={isAnyPending}
        aria-disabled={isAnyPending}
        className="hover:border-primary/40 hover:bg-primary/10 hover:text-primary h-9 w-full border-white/15 bg-transparent text-white/70"
      >
        {isGuestPending ? (
          <>
            <Spinner className="size-4" />
            Setting up guest session...
          </>
        ) : (
          "Continue as Guest"
        )}
      </Button>
    </>
  );
}
