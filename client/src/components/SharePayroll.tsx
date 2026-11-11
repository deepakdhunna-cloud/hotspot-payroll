/**
 * Sharing a payroll spreadsheet.
 *
 * `sharePayload` tries the device's own share sheet first — on a phone that
 * is Messages, Mail, AirDrop, WhatsApp, Save to Files — with the spreadsheet
 * attached and a short summary as the message.
 *
 * `ShareDialog` is what shows when that isn't possible:
 *  - the browser has no share sheet for files (most desktop browsers), or
 *  - it refused because building the file outlasted the tap (the dialog's
 *    Share button is a fresh tap, so it then opens at once).
 * It offers the same job by hand: share, email, copy the summary, download.
 */
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { canShareFile, downloadBlob, shareFile } from "@/lib/xlsx";
import { Check, Copy, Download, Mail, Share } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

export type SharePayload = {
  filename: string;
  blob: Blob;
  /** Subject line / share title, e.g. "Hotspot payroll · Oct 29 – Nov 4". */
  title: string;
  /** The message that goes with the file: a few plain lines of totals. */
  text: string;
};

/**
 * Share with the device's share sheet where possible.
 * Returns "dialog" when the caller should open `ShareDialog` instead.
 */
export async function sharePayload(
  payload: SharePayload,
): Promise<"shared" | "cancelled" | "dialog"> {
  if (!canShareFile(payload.blob, payload.filename)) return "dialog";
  const result = await shareFile(payload.blob, payload.filename, payload);
  return result === "blocked" ? "dialog" : result;
}

export function ShareDialog({
  payload,
  onOpenChange,
}: {
  payload: SharePayload | null;
  onOpenChange: (open: boolean) => void;
}) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!payload) setCopied(false);
  }, [payload]);

  const native = payload ? canShareFile(payload.blob, payload.filename) : false;

  const share = async () => {
    if (!payload) return;
    const result = await shareFile(payload.blob, payload.filename, payload);
    if (result === "shared") {
      toast.success("Payroll shared.");
      onOpenChange(false);
    } else if (result === "blocked") {
      toast.error("This browser couldn't open sharing. Use Email or Download instead.");
    }
  };

  const email = () => {
    if (!payload) return;
    // A mail link can't carry an attachment, so the file is downloaded for
    // the manager to attach — and the message says so.
    downloadBlob(payload.blob, payload.filename);
    const body = `${payload.text}\n\nSpreadsheet: ${payload.filename}`;
    window.location.href = `mailto:?subject=${encodeURIComponent(payload.title)}&body=${encodeURIComponent(body)}`;
    toast.success("Spreadsheet downloaded.", {
      description: "Attach it to the email that just opened.",
    });
  };

  const copy = async () => {
    if (!payload) return;
    try {
      await navigator.clipboard.writeText(payload.text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Couldn't copy. Select the text and copy it by hand.");
    }
  };

  const download = () => {
    if (!payload) return;
    downloadBlob(payload.blob, payload.filename);
    toast.success("Spreadsheet downloaded.", { description: payload.filename });
  };

  return (
    <Dialog open={payload !== null} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Share payroll</DialogTitle>
          <DialogDescription>
            {native
              ? "Send the spreadsheet with this summary."
              : "Send this summary, with the spreadsheet attached."}
          </DialogDescription>
        </DialogHeader>

        {payload ? (
          <>
            <div className="rounded-xl border border-border bg-muted/50 px-3.5 py-3">
              <p className="text-sm font-medium leading-snug">{payload.title}</p>
              <p className="mt-1.5 whitespace-pre-line text-[13px] leading-relaxed text-muted-foreground select-text">
                {payload.text}
              </p>
            </div>

            <div className="grid gap-2">
              {native ? (
                <Button className="h-11" onClick={() => void share()}>
                  <Share className="h-4 w-4" aria-hidden /> Share
                </Button>
              ) : null}
              <div className="grid grid-cols-3 gap-2">
                <Button variant="outline" className="h-11 px-2" onClick={email}>
                  <Mail className="h-4 w-4" aria-hidden /> Email
                </Button>
                <Button variant="outline" className="h-11 px-2" onClick={() => void copy()}>
                  {copied ? (
                    <Check className="h-4 w-4" aria-hidden />
                  ) : (
                    <Copy className="h-4 w-4" aria-hidden />
                  )}
                  {copied ? "Copied" : "Copy"}
                </Button>
                <Button variant="outline" className="h-11 px-2" onClick={download}>
                  <Download className="h-4 w-4" aria-hidden /> Download
                </Button>
              </div>
            </div>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
