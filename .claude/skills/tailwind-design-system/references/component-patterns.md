# Component Patterns

## CVA Component Pattern

All UI components use CVA for type-safe variants with `cn()` for className merging:

```typescript
// app/components/ui/button.tsx
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '~/lib/utils';

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md font-medium text-sm ring-offset-background transition-colors focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground hover:bg-primary/90',
        destructive: 'bg-destructive text-destructive-foreground hover:bg-destructive/90',
        outline: 'border border-input bg-background hover:bg-accent hover:text-accent-foreground',
        secondary: 'bg-secondary text-secondary-foreground hover:bg-secondary/80',
        ghost: 'hover:bg-accent hover:text-accent-foreground',
        link: 'text-primary underline-offset-4 hover:underline',
      },
      size: {
        default: 'h-10 px-4 py-2',
        sm: 'h-9 rounded-md px-3',
        lg: 'h-11 rounded-md px-8',
        icon: 'h-10 w-10',
      },
    },
    defaultVariants: { variant: 'default', size: 'default' },
  },
);
```

**Button features**: `loading` prop with spinner, `asChild` via Radix `Slot`, `forwardRef`, `cn()` for overrides.

## MoneyDisplay Component

**Always use `MoneyDisplay` or `MoneyInputDisplay` for monetary amounts.**

File: `app/components/money-display.tsx`

```typescript
const valueVariants = cva('font-numeric', {
  variants: {
    size: {
      xs: 'pt-0.5 text-xl',
      sm: 'pt-1 text-2xl',
      md: 'pt-1.5 text-5xl',
      lg: 'pt-2 text-6xl',
    },
  },
});
```

Usage:
```tsx
<MoneyDisplay money={balance} size="lg" variant="default" />
<MoneyInputDisplay inputValue="1.5" currency="USD" unit="usd" />
```

## Available UI Components

Check `app/components/ui/` before creating new ones:

Badge, Button, Card (compound), Carousel, Checkbox, Dialog, Drawer (vaul), Dropdown Menu, Hover Card, Input, Label, Radio Group, Scroll Area, Select, Separator, Skeleton, Tabs, Toast, Toaster

All follow: CVA variants, `forwardRef`, `cn()`, Radix primitives.

## Compound Component Pattern (Card)

```typescript
const Card = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn('rounded-lg border bg-card text-card-foreground shadow-xs', className)}
      {...props}
    />
  ),
);
// Plus: CardHeader, CardTitle, CardDescription, CardContent, CardFooter
```

## Dialog/Drawer/Toast Animations

**Dialog** uses `tailwindcss-animate` data-attribute animations:
```tsx
// Overlay
'data-[state=open]:animate-in data-[state=closed]:animate-out'
'data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0'

// Content
'data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95'
'data-[state=closed]:slide-out-to-left-1/2 data-[state=closed]:slide-out-to-top-[48%]'
'data-[state=open]:slide-in-from-left-1/2 data-[state=open]:slide-in-from-top-[48%]'
```

**Drawer** (vaul):
```tsx
className="bg-gradient-to-b from-transparent via-black/70 to-black/80"  // overlay
className="fixed inset-x-0 bottom-0 rounded-t-[10px]"                   // content
className="h-[90svh] font-primary sm:h-[75vh]"                          // responsive height
```

**Toast** exit uses custom animation:
```tsx
'data-[state=closed]:animate-slide-out-up'
```

## View Transitions

File: `app/lib/transitions/view-transition.tsx` + `transitions.css`

```tsx
<LinkWithViewTransition to="/page" transition="slideLeft" applyTo="oldView">
  Go Forward
</LinkWithViewTransition>

const navigate = useNavigateWithViewTransition();
navigate('/page', { transition: 'slideRight', applyTo: 'bothViews' });
```

Types: `slideLeft`, `slideRight`, `slideUp`, `slideDown`, `fade`
Duration: 180ms (synced between CSS and TS — keep in sync!)
Apply modes: `newView`, `oldView`, `bothViews`

## Page Layout Components

File: `app/components/page.tsx`

```tsx
// Main page wrapper
<div className="mx-auto flex h-dvh w-full flex-col p-4 font-primary sm:items-center sm:px-6 lg:px-8">

// Content area
<div className="flex flex-grow flex-col gap-2 p-2 sm:w-full sm:max-w-sm">

// Footer
<div className="flex w-full flex-col items-center gap-2 p-2 sm:max-w-sm">

// Header — centered title with absolute positioning
<div className="-translate-x-1/2 absolute left-1/2 transform">
```

## Icons

Using **Lucide React**:
- Standard: `size-4` or `size-5`
- Large: `size-6`
- In buttons: `[&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0`
