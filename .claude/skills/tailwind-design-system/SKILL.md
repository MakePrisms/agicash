---
name: tailwind-design-system
description: Build scalable design systems with Tailwind CSS, design tokens, component libraries, and responsive patterns. Use when creating component libraries, implementing design systems, or standardizing UI patterns.
source: https://github.com/wshobson/agents/tree/main/plugins/frontend-mobile-development/skills/tailwind-design-system
---

# Tailwind Design System

Build production-ready design systems with Tailwind CSS, including design tokens, component variants, responsive patterns, and accessibility.

## App Context

**Agicash** is a mobile-first cryptocurrency wallet app (Bitcoin Lightning Network + Cashu eCash).

**Stack**: React 19 + React Router v7, Express SSR, shadcn-style components with CVA

**Design System Characteristics**:
- **Theming**: Multi-theme (USD teal, BTC blue) + dark mode via CSS variables (HSL format)
- **Typography**: Kode Mono (primary), Teko (numeric amounts)
- **Layout**: Mobile-first (sm:max-w-sm), full viewport (h-dvh)
- **Organization**: Feature-based (app/features/*), 18+ UI components in app/components/ui/
- **Custom Animations**: shake, slam, slide-out-up
- **Key Utilities**: `cn()` for class merging, MoneyDisplay for formatted amounts

## When to Use This Skill

- Creating new components for the wallet UI
- Extending the existing design system with new variants
- Implementing currency-specific or theme-aware components
- Building responsive mobile-first layouts
- Adding new animations or transitions
- Standardizing UI patterns across features
- Working with the multi-theme system (USD/BTC/dark mode)

## Core Concepts

### 1. Design Token Hierarchy

```
Brand Tokens (abstract)
    └── Semantic Tokens (purpose)
        └── Component Tokens (specific)

Example:
    blue-500 → primary → button-bg
```

### 2. Component Architecture

```
Base styles → Variants → Sizes → States → Overrides
```

## App Configuration Files

**Before modifying the design system, read these files to understand the current setup:**

1. **tailwind.config.ts** - Tailwind configuration
   - Custom fonts: `teko` (amounts), `mono` (primary)
   - Custom animations: `shake`, `slam`, `slide-out-up`
   - Semantic color tokens via CSS variables
   - Border radius system using `--radius` variable

2. **app/tailwind.css** - Theme definitions
   - Default light theme (`:root`)
   - USD theme (`.usd` class) - Teal colors
   - BTC theme (`.btc` class) - Blue colors
   - Dark mode (`.dark` class) - Overrides all themes
   - All use HSL format via CSS variables

3. **app/features/theme/theme-provider.tsx** - Theme management
   - Dual-theme system: currency theme (usd/btc) + color mode (light/dark/system)
   - Persistence via cookies for SSR
   - Context API for runtime access

4. **app/lib/utils.ts** - Core utilities
   - `cn()` function for class merging (tailwind-merge + clsx)
   - Use this for all component className composition

5. **app/components/ui/** - Existing component library
   - 18+ shadcn-style components (Button, Card, Input, Dialog, etc.)
   - All use CVA for variants, forward refs, and `cn()` utility
   - Read existing components before creating new ones

## Patterns

### Pattern 1: CVA (Class Variance Authority) Components

```typescript
// components/ui/button.tsx
import { cva, type VariantProps } from 'class-variance-authority'
import { forwardRef } from 'react'
import { cn } from '@/lib/utils'

const buttonVariants = cva(
  // Base styles
  'inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50',
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
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  }
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean
}

const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button'
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    )
  }
)
Button.displayName = 'Button'

export { Button, buttonVariants }

// Usage
<Button variant="destructive" size="lg">Delete</Button>
<Button variant="outline">Cancel</Button>
<Button asChild><Link href="/home">Home</Link></Button>
```

### Pattern 2: Compound Components

```typescript
// components/ui/card.tsx
import { cn } from '@/lib/utils'
import { forwardRef } from 'react'

const Card = forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        'rounded-lg border bg-card text-card-foreground shadow-sm',
        className
      )}
      {...props}
    />
  )
)
Card.displayName = 'Card'

const CardHeader = forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn('flex flex-col space-y-1.5 p-6', className)}
      {...props}
    />
  )
)
CardHeader.displayName = 'CardHeader'

const CardTitle = forwardRef<HTMLHeadingElement, React.HTMLAttributes<HTMLHeadingElement>>(
  ({ className, ...props }, ref) => (
    <h3
      ref={ref}
      className={cn('text-2xl font-semibold leading-none tracking-tight', className)}
      {...props}
    />
  )
)
CardTitle.displayName = 'CardTitle'

const CardDescription = forwardRef<HTMLParagraphElement, React.HTMLAttributes<HTMLParagraphElement>>(
  ({ className, ...props }, ref) => (
    <p
      ref={ref}
      className={cn('text-sm text-muted-foreground', className)}
      {...props}
    />
  )
)
CardDescription.displayName = 'CardDescription'

const CardContent = forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn('p-6 pt-0', className)} {...props} />
  )
)
CardContent.displayName = 'CardContent'

const CardFooter = forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn('flex items-center p-6 pt-0', className)}
      {...props}
    />
  )
)
CardFooter.displayName = 'CardFooter'

export { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter }

// Usage
<Card>
  <CardHeader>
    <CardTitle>Account</CardTitle>
    <CardDescription>Manage your account settings</CardDescription>
  </CardHeader>
  <CardContent>
    <form>...</form>
  </CardContent>
  <CardFooter>
    <Button>Save</Button>
  </CardFooter>
</Card>
```

### Pattern 3: Form Components

```typescript
// components/ui/input.tsx
import { forwardRef } from 'react'
import { cn } from '@/lib/utils'

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  error?: string
}

const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, error, ...props }, ref) => {
    return (
      <div className="relative">
        <input
          type={type}
          className={cn(
            'flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50',
            error && 'border-destructive focus-visible:ring-destructive',
            className
          )}
          ref={ref}
          aria-invalid={!!error}
          aria-describedby={error ? `${props.id}-error` : undefined}
          {...props}
        />
        {error && (
          <p
            id={`${props.id}-error`}
            className="mt-1 text-sm text-destructive"
            role="alert"
          >
            {error}
          </p>
        )}
      </div>
    )
  }
)
Input.displayName = 'Input'

// components/ui/label.tsx
import { cva, type VariantProps } from 'class-variance-authority'

const labelVariants = cva(
  'text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70'
)

const Label = forwardRef<HTMLLabelElement, React.LabelHTMLAttributes<HTMLLabelElement>>(
  ({ className, ...props }, ref) => (
    <label ref={ref} className={cn(labelVariants(), className)} {...props} />
  )
)
Label.displayName = 'Label'

// Usage with React Hook Form
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import * as z from 'zod'

const schema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
})

function LoginForm() {
  const { register, handleSubmit, formState: { errors } } = useForm({
    resolver: zodResolver(schema),
  })

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="email">Email</Label>
        <Input
          id="email"
          type="email"
          {...register('email')}
          error={errors.email?.message}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="password">Password</Label>
        <Input
          id="password"
          type="password"
          {...register('password')}
          error={errors.password?.message}
        />
      </div>
      <Button type="submit" className="w-full">Sign In</Button>
    </form>
  )
}
```

### Pattern 4: Responsive Grid System

```typescript
// components/ui/grid.tsx
import { cn } from '@/lib/utils'
import { cva, type VariantProps } from 'class-variance-authority'

const gridVariants = cva('grid', {
  variants: {
    cols: {
      1: 'grid-cols-1',
      2: 'grid-cols-1 sm:grid-cols-2',
      3: 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3',
      4: 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-4',
      5: 'grid-cols-2 sm:grid-cols-3 lg:grid-cols-5',
      6: 'grid-cols-2 sm:grid-cols-3 lg:grid-cols-6',
    },
    gap: {
      none: 'gap-0',
      sm: 'gap-2',
      md: 'gap-4',
      lg: 'gap-6',
      xl: 'gap-8',
    },
  },
  defaultVariants: {
    cols: 3,
    gap: 'md',
  },
})

interface GridProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof gridVariants> {}

export function Grid({ className, cols, gap, ...props }: GridProps) {
  return (
    <div className={cn(gridVariants({ cols, gap, className }))} {...props} />
  )
}

// Container component
const containerVariants = cva('mx-auto w-full px-4 sm:px-6 lg:px-8', {
  variants: {
    size: {
      sm: 'max-w-screen-sm',
      md: 'max-w-screen-md',
      lg: 'max-w-screen-lg',
      xl: 'max-w-screen-xl',
      '2xl': 'max-w-screen-2xl',
      full: 'max-w-full',
    },
  },
  defaultVariants: {
    size: 'xl',
  },
})

interface ContainerProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof containerVariants> {}

export function Container({ className, size, ...props }: ContainerProps) {
  return (
    <div className={cn(containerVariants({ size, className }))} {...props} />
  )
}

// Usage
<Container>
  <Grid cols={4} gap="lg">
    {products.map((product) => (
      <ProductCard key={product.id} product={product} />
    ))}
  </Grid>
</Container>
```

### Pattern 5: Animation Utilities

```typescript
// lib/animations.ts - Tailwind CSS Animate utilities
import { cn } from './utils'

export const fadeIn = 'animate-in fade-in duration-300'
export const fadeOut = 'animate-out fade-out duration-300'
export const slideInFromTop = 'animate-in slide-in-from-top duration-300'
export const slideInFromBottom = 'animate-in slide-in-from-bottom duration-300'
export const slideInFromLeft = 'animate-in slide-in-from-left duration-300'
export const slideInFromRight = 'animate-in slide-in-from-right duration-300'
export const zoomIn = 'animate-in zoom-in-95 duration-300'
export const zoomOut = 'animate-out zoom-out-95 duration-300'

// Compound animations
export const modalEnter = cn(fadeIn, zoomIn, 'duration-200')
export const modalExit = cn(fadeOut, zoomOut, 'duration-200')
export const dropdownEnter = cn(fadeIn, slideInFromTop, 'duration-150')
export const dropdownExit = cn(fadeOut, 'slide-out-to-top', 'duration-150')

// components/ui/dialog.tsx
import * as DialogPrimitive from '@radix-ui/react-dialog'

const DialogOverlay = forwardRef<
  React.ElementRef<typeof DialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Overlay
    ref={ref}
    className={cn(
      'fixed inset-0 z-50 bg-black/80',
      'data-[state=open]:animate-in data-[state=closed]:animate-out',
      'data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0',
      className
    )}
    {...props}
  />
))

const DialogContent = forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content>
>(({ className, children, ...props }, ref) => (
  <DialogPortal>
    <DialogOverlay />
    <DialogPrimitive.Content
      ref={ref}
      className={cn(
        'fixed left-[50%] top-[50%] z-50 grid w-full max-w-lg translate-x-[-50%] translate-y-[-50%] gap-4 border bg-background p-6 shadow-lg',
        'data-[state=open]:animate-in data-[state=closed]:animate-out',
        'data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0',
        'data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95',
        'data-[state=closed]:slide-out-to-left-1/2 data-[state=closed]:slide-out-to-top-[48%]',
        'data-[state=open]:slide-in-from-left-1/2 data-[state=open]:slide-in-from-top-[48%]',
        'sm:rounded-lg',
        className
      )}
      {...props}
    >
      {children}
    </DialogPrimitive.Content>
  </DialogPortal>
))
```

### Pattern 6: Multi-Theme System (App-Specific)

**Read:** `app/features/theme/theme-provider.tsx` for implementation details.

The app uses a dual-theme system:
- **Currency theme** (usd/btc) applied as class to `document.documentElement`
- **Color mode** (light/dark/system) applied as `dark` class when active
- Persisted via cookies for SSR compatibility
- Access via `useTheme()` hook

**Key classes to use**:
- Theme-aware colors: `bg-primary`, `text-foreground`, `border-border`
- Typography: `font-teko` for amounts, `font-mono` for code/addresses
- Custom animations: `animate-shake`, `animate-slam`, `animate-slide-out-up`

### Pattern 7: Mobile-First Wallet Layout (App-Specific)

**Read:** `app/components/page.tsx` for layout components.

Standard patterns:
- Full viewport: `h-dvh` (dynamic viewport height)
- Mobile-centered: `mx-auto w-full sm:max-w-sm`
- Flex column: `flex flex-col` with `overflow-hidden` on container
- Scrollable content: `flex-1 overflow-y-auto` on main content area

### Pattern 8: Money Display (App-Specific)

**Read:** `app/components/money-display.tsx` for the MoneyDisplay component.

Use `MoneyDisplay` for all monetary amounts:
- Uses `font-teko` and `tabular-nums` for consistent number display
- Supports size variants (sm, default, lg) and color variants
- Currency-aware formatting (USD, BTC, sats)
- Theme-aware currency selection via `useTheme()`

### Pattern 9: Existing Components (App-Specific)

**Read components in:** `app/components/ui/` before creating new ones.

Available components: Button, Card, Input, Label, Badge, Dialog, Drawer, Select, Tabs, Checkbox, Radio Group, Dropdown Menu, Hover Card, Scroll Area, Separator, Toast, Toaster, Carousel

All follow the same patterns:
- CVA for variants and sizes
- Forward refs for composition
- `cn()` for className merging
- Radix UI primitives where applicable

## Utility Functions

```typescript
// lib/utils.ts
import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

// Focus ring utility
export const focusRing = cn(
  'focus-visible:outline-none focus-visible:ring-2',
  'focus-visible:ring-ring focus-visible:ring-offset-2'
)

// Disabled utility
export const disabled = 'disabled:pointer-events-none disabled:opacity-50'
```

## Best Practices

### Do's - General
- **Use CSS variables** - Enable runtime theming with `hsl(var(--primary))`
- **Compose with CVA** - Type-safe variants for components
- **Use semantic colors** - `bg-primary` not `bg-blue-500`
- **Forward refs** - Enable composition with `forwardRef`
- **Add accessibility** - ARIA attributes, focus states, sr-only labels

### Do's - App-Specific
- **Use Teko font for money** - `font-teko` class for all monetary amounts
- **Test all themes** - USD light, BTC light, dark mode
- **Mobile-first layouts** - Start with mobile (h-dvh, sm:max-w-sm)
- **Feature-based organization** - Keep components near their features (app/features/*)
- **Use existing components** - Check app/components/ui/ before creating new ones
- **Theme-aware design** - Components should work on teal, blue, and dark backgrounds
- **Use custom animations** - `animate-shake`, `animate-slam`, `animate-slide-out-up` for feedback

### Don'ts - General
- **Don't use arbitrary values** - Extend theme in tailwind.config.ts instead
- **Don't nest @apply** - Hurts readability and defeats utility-first approach
- **Don't skip focus states** - Keyboard users need them (use ring utilities)
- **Don't hardcode colors** - Use semantic tokens that respond to themes
- **Don't forget dark mode** - Test all components in dark mode

### Don'ts - App-Specific
- **Don't break mobile layout** - Avoid fixed widths, test on mobile viewport
- **Don't add arbitrary fonts** - Stick to Kode Mono and Teko
- **Don't hardcode currency** - Use theme context for USD/BTC awareness
- **Don't skip h-dvh** - Use dynamic viewport height for full-screen layouts
- **Don't forget SSR** - Theme state persists via cookies, avoid localStorage-only

## App-Specific Quick Reference

**Key Files** (read as needed):
- `tailwind.config.ts` - Config, fonts, animations
- `app/tailwind.css` - Theme CSS variables
- `app/lib/utils.ts` - `cn()` utility
- `app/features/theme/theme-provider.tsx` - Theme context
- `app/components/ui/` - Base components (Button, Card, Input, etc.)
- `app/components/page.tsx` - Layout helpers
- `app/components/money-display.tsx` - Money formatting

**Feature Organization**:
- `app/features/` - Feature-based vertical slices (wallet, send, receive, transactions, contacts, settings, theme)

## Resources

**External Documentation**:
- [Tailwind CSS Documentation](https://tailwindcss.com/docs)
- [CVA Documentation](https://cva.style/docs)
- [shadcn/ui](https://ui.shadcn.com/)
- [Radix Primitives](https://www.radix-ui.com/primitives)

**App Documentation**:
- See `CLAUDE.md` for project setup and architecture
- See `GUIDELINES.md` for code quality standards
