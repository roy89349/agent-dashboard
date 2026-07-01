"use client";
// Dark control-room drawer (NOT the light ui/dialog). Bottom-sheet on phones, right side-panel on
// desktop. Built on @radix-ui/react-dialog so it is accessible (focus trap, Esc, scroll-lock) and
// needs no window.confirm/prompt. Open state is controlled by the caller.
import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

export const Drawer = DialogPrimitive.Root;
export const DrawerTrigger = DialogPrimitive.Trigger;
export const DrawerClose = DialogPrimitive.Close;

export const DrawerContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> & { title?: string }
>(({ className, children, title, ...props }, ref) => (
  <DialogPrimitive.Portal>
    <DialogPrimitive.Overlay
      className="fixed inset-0 z-50 bg-black/65 backdrop-blur-sm"
      style={{ animation: "mc-overlay-in 0.18s ease-out" }}
    />
    <DialogPrimitive.Content
      ref={ref}
      className={cn(
        // mobile: bottom sheet
        "fixed inset-x-0 bottom-0 z-50 flex max-h-[90dvh] flex-col rounded-t-2xl border-t border-white/10",
        // desktop: right side-panel, full height
        "sm:inset-y-0 sm:right-0 sm:left-auto sm:max-h-none sm:h-dvh sm:w-[30rem] sm:rounded-t-none sm:rounded-l-2xl sm:border-l sm:border-t-0",
        "glass-overlay text-[#e6eaf2]",
        "[animation:mc-drawer-up_0.22s_ease-out] sm:[animation:mc-drawer-right_0.24s_ease-out]",
        className,
      )}
      {...props}
    >
      {/* grab handle (mobile affordance) */}
      <div className="mx-auto mt-2 h-1 w-10 shrink-0 rounded-full bg-white/15 sm:hidden" />
      {title != null && (
        <div className="flex items-center justify-between gap-3 border-b border-white/10 px-5 py-3.5">
          <DialogPrimitive.Title className="text-sm font-semibold text-white">{title}</DialogPrimitive.Title>
          <DialogPrimitive.Close className="rounded-lg p-1.5 text-white/40 transition-colors hover:bg-white/10 hover:text-white">
            <X className="size-4" />
            <span className="sr-only">Close</span>
          </DialogPrimitive.Close>
        </div>
      )}
      <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
    </DialogPrimitive.Content>
  </DialogPrimitive.Portal>
));
DrawerContent.displayName = "DrawerContent";

// a hidden title for a11y when the visible header is custom/omitted
export const DrawerTitle = DialogPrimitive.Title;
export const DrawerDescription = DialogPrimitive.Description;
