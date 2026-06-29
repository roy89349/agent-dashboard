"use client"

import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg text-sm font-medium transition-all duration-150 disabled:pointer-events-none disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1B3A6B] focus-visible:ring-offset-2 cursor-pointer select-none",
  {
    variants: {
      variant: {
        default: "bg-[#1B3A6B] text-white hover:bg-[#152f58] active:scale-[0.98]",
        accent: "bg-[#10B981] text-white hover:bg-[#059669] active:scale-[0.98]",
        destructive: "bg-red-500 text-white hover:bg-red-600 active:scale-[0.98]",
        outline: "border border-[#E2E8F0] bg-white text-[#0F172A] hover:bg-[#F8FAFC] active:scale-[0.98]",
        secondary: "bg-[#F1F5F9] text-[#475569] hover:bg-[#E2E8F0] active:scale-[0.98]",
        ghost: "text-[#475569] hover:bg-[#F1F5F9] hover:text-[#0F172A] active:scale-[0.98]",
        link: "text-[#1B3A6B] underline-offset-4 hover:underline p-0 h-auto",
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
