---
name: shadcn-ui
description: Using shadcn/ui component library for UI components. Use when creating or modifying UI components in .tsx files.
---

# Shadcn UI Components

This project uses @shadcn/ui for UI components. These are beautifully designed, accessible components that you can copy and paste into your apps.

## Finding and Using Components

Components are available in the `app/components/ui` directory, following the aliases configured in `components.json`

## Using Components

Import components from the ui directory using the configured aliases:

```tsx
import { Button } from '~/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '~/components/ui/tabs';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '~/components/ui/card';
```

Example usage:

```tsx
<Button variant="outline">Click me</Button>

<Card>
  <CardHeader>
    <CardTitle>Card Title</CardTitle>
    <CardDescription>Card Description</CardDescription>
  </CardHeader>
  <CardContent>
    <p>Card Content</p>
  </CardContent>
  <CardFooter>
    <p>Card Footer</p>
  </CardFooter>
</Card>
```

## Installing Additional Components

Many more components are available but not currently installed. You can view the complete list at https://ui.shadcn.com/r

To install additional components, use the Shadcn CLI:

```bash
bunx shadcn@latest add [component-name]
```

For example, to add the Accordion component:

```bash
bunx shadcn@latest add accordion
```

Note: `bunx shadcn-ui@latest` is deprecated, use `bunx shadcn@latest` instead

Some commonly used components are:

- Accordion, Alert, AlertDialog, AspectRatio, Avatar
- Calendar, Checkbox, Collapsible, Command, ContextMenu
- DataTable, DatePicker, Dropdown Menu, Form
- Hover Card, Menubar, Navigation Menu, Popover, Progress
- Radio Group, ScrollArea, Select, Separator, Sheet
- Skeleton, Slider, Switch, Table, Textarea
- Toast, Toggle, Tooltip

## Component Styling

This project uses the "default" style variant with the "neutral" base color and CSS variables for theming, as configured in `components.json`.
