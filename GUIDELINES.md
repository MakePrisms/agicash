# Project Structure Guidelines

## Directory Structure

```
app/
├── components/    # Reusable UI components (shadcn)
│   └── ui/        # Base UI components
├── lib/           # Utility functions and server-side code
├── features/      # Feature-specific components and logic
│   ├── shared/    # Shared feature code (if needed)
│   └── [feature]/ # Feature-specific code
├── routes/        # React router routes
└── root.tsx       # Root layout component
```

## Architectural Principles

### Import Hierarchy

1. **Components & Library Code** (`app/components/ui/*` and `app/lib/*`)
   - Most reusable, lowest-level code
   - Cannot import from `app/*` or `features/*`
   - Examples: shadcn components, utility functions
   - Can be used across any feature or app code

2. **Feature Code** (`app/features/*`)
   - Can import from `app/components/*` and `app/lib/*`
   - Cannot import from `app/routes/*`
   - Example: `app/features/theme/use-theme.tsx`

3. **App Code** (`app/routes/*`, `root.tsx`)
   - Can import from anywhere
   - Handles routing and app-level composition

### Feature Organization

Features are organized as vertical slices:
- Each feature has its own directory: `app/features/[feature-name]/`
- Contains all feature-specific components, hooks, and logic
- Example structure from the theme feature:
  ```
  features/theme/
  ├── index.ts
  ├── theme-provider.tsx
  ├── theme-cookies.server.tsx
  ├── theme.constants.ts
  ├── theme.types.ts
  └── use-theme.tsx
  ```

### File Naming Conventions


- Use kebab-case for all files and directories 
  - ✅ `open-settings-button.tsx`
  - ✅ `theme-provider.tsx`
  - ❌ `openSettingsButton.tsx`
  - ❌ `themeProvider.tsx`

## Examples

### Feature-Specific Components
```tsx
// app/features/settings/open-settings-button.tsx
import { Button } from "~/components/ui/button"

// Feature-specific component using base UI components
```

### Shared UI Components
```tsx
// app/components/ui/button.tsx
// Base button component that can be used anywhere
```

### Route Components
```tsx
// app/routes/_index.tsx
import { OpenSettingsButton } from "~/features/settings"
import { ThemeProvider } from "~/features/theme"

// Can import and compose everything
```
