"use client"

import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"

// Dark control-room button. Same variant + size names as before (every call site keeps working),
// but the palette is dark-theme: translucent whites + emerald accent, never solid light surfaces.
const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg text-sm font-medium transition-all duration-150 disabled:pointer-events-none disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/40 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0d1322] cursor-pointer select-none",
  {
    variants: {
      variant: {
        default: "border border-white/10 bg-white/10 text-white hover:bg-white/15 active:scale-[0.98]",
        accent: "bg-emerald-500 text-black hover:bg-emerald-400 active:scale-[0.98]",
        destructive: "bg-red-500 text-white hover:bg-red-400 active:scale-[0.98]",
        outline: "border border-white/15 bg-transparent text-white/80 hover:bg-white/5 hover:text-white active:scale-[0.98]",
        secondary: "bg-white/5 text-white/75 hover:bg-white/10 hover:text-white active:scale-[0.98]",
        ghost: "text-white/70 hover:bg-white/10 hover:text-white active:scale-[0.98]",
        link: "text-emerald-400 underline-offset-4 hover:underline p-0 h-auto",
      },
      size: {
        default: "h-10 px-4 py-2",
        sm: "h-8 px-3 text-xs",
        lg: "h-12 px-6 text-base",
        xl: "h-14 px-8 text-base",
        icon: "h-10 w-10",
        "icon-sm": "h-8 w-8",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button"
    return (
      <Comp className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />
    )
  }
)
Button.displayName = "Button"

export { Button, buttonVariants }
