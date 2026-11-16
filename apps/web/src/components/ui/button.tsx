import { cva, type VariantProps } from "class-variance-authority";
import { Slot } from "radix-ui";
import type * as React from "react";
import { cn } from "../cn";

const buttonVariants = cva(
  "tap-target inline-flex shrink-0 items-center justify-center gap-2 rounded-control px-4 text-body font-medium whitespace-normal transition-opacity disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        default: "bg-primary text-on-solid hover:opacity-90",
        primary: "bg-primary text-on-solid hover:opacity-90",
        signal: "bg-signal text-on-signal hover:opacity-90",
        destructive: "bg-danger text-on-solid hover:opacity-90",
        danger: "bg-danger text-on-solid hover:opacity-90",
        outline: "bg-surface text-ink shadow-card hover:bg-soft",
        secondary: "bg-surface text-ink shadow-card hover:bg-soft",
        tertiary: "text-ink-muted hover:bg-soft hover:text-ink",
        ghost: "text-ink-muted hover:bg-soft hover:text-ink",
        link: "text-ink underline-offset-4 hover:underline",
      },
      size: {
        default: "min-h-12 px-4 py-2 has-[>svg]:px-3",
        xs: "min-h-12 gap-1 rounded-md px-2 text-xs has-[>svg]:px-1.5 [&_svg:not([class*='size-'])]:size-3",
        sm: "min-h-12 gap-1.5 rounded-md px-3 has-[>svg]:px-2.5",
        lg: "min-h-12 rounded-md px-6 has-[>svg]:px-4",
        icon: "size-12",
        "icon-xs": "size-12 rounded-md [&_svg:not([class*='size-'])]:size-3",
        "icon-sm": "size-12",
        "icon-lg": "size-12",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

function Button({
  className,
  variant = "default",
  size = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean;
  }) {
  const Comp = asChild ? Slot.Root : "button";

  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  );
}

export { Button, buttonVariants };
