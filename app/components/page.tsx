import { ChevronLeft, X } from 'lucide-react';
import React from 'react';
import {
  LinkWithViewTransition,
  type ViewTransitionLinkProps,
} from '~/lib/transitions';
import { cn } from '~/lib/utils';

interface PageProps extends React.HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode;
}

export function Page({ children, className, ...props }: PageProps) {
  return (
    <div
      className={cn(
        'mx-auto flex h-dvh w-full flex-col p-4 font-primary sm:items-center sm:px-6 lg:px-8',
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}

interface ClosePageButtonProps extends ViewTransitionLinkProps {}

export function ClosePageButton({ className, ...props }: ClosePageButtonProps) {
  return (
    <LinkWithViewTransition {...props}>
      <X />
    </LinkWithViewTransition>
  );
}

export interface PageBackButtonProps extends ViewTransitionLinkProps {}

export function PageBackButton({ className, ...props }: PageBackButtonProps) {
  return (
    <LinkWithViewTransition {...props}>
      <ChevronLeft />
    </LinkWithViewTransition>
  );
}

interface PageHeaderTitleProps extends React.HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode;
}

export function PageHeaderTitle({
  children,
  className,
  ...props
}: PageHeaderTitleProps) {
  return (
    <h1
      className={cn('flex items-center justify-start text-xl', className)}
      {...props}
    >
      {children}
    </h1>
  );
}

interface PageHeaderLeftProps extends React.HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode;
}

/**
 * Container for custom left-side content in PageHeader
 */
export function PageHeaderLeft({
  children,
  className,
  ...props
}: PageHeaderLeftProps) {
  return (
    <div className={cn('flex items-center', className)} {...props}>
      {children}
    </div>
  );
}

interface PageHeaderRightProps extends React.HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode;
}

/**
 * Container for custom right-side content in PageHeader
 */
export function PageHeaderRight({
  children,
  className,
  ...props
}: PageHeaderRightProps) {
  return (
    <div
      className={cn('flex items-center justify-end gap-2', className)}
      {...props}
    >
      {children}
    </div>
  );
}

interface PageHeaderProps extends React.HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode;
}

/**
 * Flexible header component with support for:
 * - Back/Close buttons (auto-placed left)
 * - Centered title
 * - Custom left/right slots via PageHeaderLeft/PageHeaderRight
 */
export function PageHeader({ children, className, ...props }: PageHeaderProps) {
  const childArray = React.Children.toArray(children);

  const hasCloseButton = childArray.some(
    (child) => React.isValidElement(child) && child.type === ClosePageButton,
  );
  const hasBackButton = childArray.some(
    (child) => React.isValidElement(child) && child.type === PageBackButton,
  );
  const hasLeftSlot = childArray.some(
    (child) => React.isValidElement(child) && child.type === PageHeaderLeft,
  );
  const hasRightSlot = childArray.some(
    (child) => React.isValidElement(child) && child.type === PageHeaderRight,
  );

  const leftSlotCount = childArray.filter(
    (child) => React.isValidElement(child) && child.type === PageHeaderLeft,
  ).length;
  const rightSlotCount = childArray.filter(
    (child) => React.isValidElement(child) && child.type === PageHeaderRight,
  ).length;

  // If using custom slots, render in slot-based mode
  const useSlotMode = hasLeftSlot || hasRightSlot;

  if (hasCloseButton && hasBackButton) {
    throw new Error(
      'PageHeader cannot have both ClosePageButton and PageBackButton',
    );
  }

  if (useSlotMode && (hasCloseButton || hasBackButton)) {
    throw new Error(
      'PageHeader cannot mix slot components (PageHeaderLeft/PageHeaderRight) with ClosePageButton/PageBackButton. Place navigation buttons inside PageHeaderLeft instead.',
    );
  }

  if (leftSlotCount > 1) {
    throw new Error('PageHeader can only have one PageHeaderLeft');
  }

  if (rightSlotCount > 1) {
    throw new Error('PageHeader can only have one PageHeaderRight');
  }

  const leftContent = useSlotMode
    ? childArray.find(
        (child) => React.isValidElement(child) && child.type === PageHeaderLeft,
      )
    : childArray.find(
        (child) =>
          React.isValidElement(child) &&
          (child.type === ClosePageButton || child.type === PageBackButton),
      );

  const titleContent = childArray.find(
    (child) => React.isValidElement(child) && child.type === PageHeaderTitle,
  );

  const rightContent = useSlotMode
    ? childArray.find(
        (child) =>
          React.isValidElement(child) && child.type === PageHeaderRight,
      )
    : childArray.filter(
        (child) =>
          !React.isValidElement(child) ||
          (child.type !== PageHeaderTitle &&
            child.type !== ClosePageButton &&
            child.type !== PageBackButton),
      );

  return (
    <header
      className={cn('mb-4 flex w-full items-center justify-between', className)}
      {...props}
    >
      {/* Left content */}
      {useSlotMode ? leftContent : <div>{leftContent}</div>}

      {/* Title - always in the center */}
      <div className="-translate-x-1/2 absolute left-1/2 transform">
        {titleContent}
      </div>

      {/* Right content */}
      {useSlotMode ? (
        rightContent
      ) : (
        <div className="flex items-center justify-end gap-2">
          {rightContent}
        </div>
      )}
    </header>
  );
}

interface PageContentProps extends React.HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode;
}

export function PageContent({
  children,
  className,
  ...props
}: PageContentProps) {
  return (
    <main
      className={cn(
        'flex flex-grow flex-col gap-2 p-2 sm:w-full sm:max-w-sm',
        className,
      )}
      {...props}
    >
      {children}
    </main>
  );
}

interface PageFooterProps extends React.HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode;
}

export function PageFooter({ children, className, ...props }: PageFooterProps) {
  return (
    <footer
      className={cn(
        'flex w-full flex-col items-center gap-2 p-2 sm:max-w-sm',
        className,
      )}
      {...props}
    >
      {children}
    </footer>
  );
}
